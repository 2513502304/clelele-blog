"""Expand explicit card/character/profile selections into an immutable paid-work plan.

Ranges select cards, not numeric hashes. Repeats create generation attempts and
reuse one text rewrite per exact template/character pair. Planning is read-only
against the Gallery; only the local snapshot is written.
"""
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
import re

import gallery_generation as workflow
import pixai_generation as pixai

DEFAULT_REWRITE = {'baseUrl': 'https://api.deepseek.com', 'model': 'deepseek-flash',
                   'keyEnv': 'DEEPSEEK_API_KEY'}
DEFAULT_PROFILE = {'provider': 'pixai', 'model': pixai.TSUBAKI3, 'ratio': '3:4',
                   'size': '1.5k', 'quality': 'ultra', 'batch_size': 4, 'seed': None}
BEIJING = timezone(timedelta(hours=8))


def fields(value, allowed, label):
    if not isinstance(value, dict) or set(value) - set(allowed):
        raise ValueError(f'{label}: expected an object with only {", ".join(sorted(allowed))}.')


def identifier(value, label='ID'):
    if not isinstance(value, str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,39}', value):
        raise ValueError(f'{label}: use 1–40 lowercase letters/digits/hyphens.')
    return value


def profile(value):
    """Validate all provider parameters before any rewrite can spend money."""
    fields(value, DEFAULT_PROFILE, 'profile')
    result = {**DEFAULT_PROFILE, **value}
    if result['provider'] == 'external':
        if set(value) - {'provider', 'model'} or not isinstance(value.get('model'), str) or not value['model'].strip():
            raise ValueError('external profiles require provider + model only; they export prompts without API calls.')
        return dict(value)
    if result['provider'] == 'codex-imagegen':
        if set(value) - {'provider'}:
            raise ValueError('codex-imagegen profiles accept only provider; builtin parameters are not API settings.')
        return {'provider': 'codex-imagegen', 'batch_size': 1}
    if result['provider'] != 'pixai':
        raise ValueError('Unsupported provider. For manual platforms use provider=external and --stage rewrite.')
    pixai.build_payload(pixai.Client(), 'validation only', {
        'model_version': result['model'], 'model_family': 'tsubaki', 'ratio': result['ratio'],
        'size': result['size'], 'mode': result['quality'], 'batch_size': result['batch_size'],
        'seed': result['seed'], 'negative_prompt': ''})
    return result


def config_input(path):
    """Resolve optional dictionaries relative to the config, never the current shell."""
    path = Path(path).resolve()
    config = workflow.read(path)
    fields(config, {'version', 'id', 'gallery', 'rewrite', 'characters', 'charactersFile',
                    'profiles', 'profilesFile', 'selections'}, 'config')
    if config.get('version') != 1:
        raise ValueError('Config version must be 1.')
    identifier(config.get('id'), 'campaign ID')
    for key in ('characters', 'profiles'):
        if key + 'File' in config:
            if key in config:
                raise ValueError(f'Use either {key} or {key}File, not both.')
            config[key] = workflow.read(path.parent / config.pop(key + 'File'))
    return config


def match_card(items, selector):
    """A prefix must identify exactly one whole card, including multi-image cards."""
    if not isinstance(selector, str) or not re.fullmatch(r'(?:[a-f0-9]{4,64}|\d{4}-\d{2}-\d{2}-[a-f0-9]+)', selector):
        raise ValueError(f'Invalid card hash/slug: {selector!r}.')
    found = [item for item in items if item['slug'] == selector or item['imageHash'].startswith(selector)]
    if len(found) != 1:
        raise ValueError(f'{selector}: expected one card, found {len(found)}. Use a unique hash or full slug.')
    return found[0]


def instant(item):
    value = datetime.fromisoformat(item['date'].replace('Z', '+00:00'))
    if value.tzinfo is None:
        raise ValueError('Catalog dates must contain a timezone.')
    return value


def select_cards(items, selector):
    fields(selector, {'hashes', 'range', 'excludeHashes'}, 'select')
    if ('hashes' in selector) == ('range' in selector):
        raise ValueError('Each selection requires exactly one of hashes or range.')
    excluded = {match_card(items, h)['slug'] for h in selector.get('excludeHashes', [])}
    if 'hashes' in selector:
        if not isinstance(selector['hashes'], list) or not selector['hashes']:
            raise ValueError('hashes must be a nonempty array.')
        rows = [match_card(items, h) for h in selector['hashes']]
        if len({r['slug'] for r in rows}) != len(rows):
            raise ValueError('Repeated cards in hashes; express extra attempts with runs/tasksPerHash.')
        rows = [r for r in rows if r['slug'] not in excluded]
    else:
        limits = selector['range']
        fields(limits, {'dateFrom', 'dateThrough', 'positions', 'order'}, 'range')
        order = limits.get('order', 'date-desc')
        if order not in ('date-desc', 'date-asc'):
            raise ValueError('range.order must be date-asc or date-desc.')
        lower = datetime.combine(date.fromisoformat(limits['dateFrom']), time.min, BEIJING) if limits.get('dateFrom') else None
        upper = datetime.combine(date.fromisoformat(limits['dateThrough']) + timedelta(days=1), time.min, BEIJING) if limits.get('dateThrough') else None
        if lower and upper and lower >= upper:
            raise ValueError('Date range is reversed.')
        rows = [r for r in items if r['slug'] not in excluded and
                (not lower or instant(r) >= lower) and (not upper or instant(r) < upper)]
        # Stable secondary ordering makes equal timestamps independent of catalog order.
        rows.sort(key=lambda r: (r['imageHash'], r['slug']))
        rows.sort(key=instant, reverse=order == 'date-desc')
        if 'positions' in limits:
            bounds = limits['positions']
            if (not isinstance(bounds, list) or len(bounds) != 2 or
                    any(type(n) is not int for n in bounds) or not 1 <= bounds[0] <= bounds[1] <= len(rows)):
                raise ValueError('positions must be [first,last], 1-based inclusive, inside the filtered result.')
            rows = rows[bounds[0] - 1:bounds[1]]
    if not rows:
        raise ValueError('Selection contains no cards.')
    return rows


def build(config, fetch, resolve):
    fields(config.get('gallery', {}), {'baseUrl'}, 'gallery')
    base = config.get('gallery', {}).get('baseUrl', 'https://clelele-blog.vercel.app').rstrip('/')
    if not base.startswith('https://'):
        raise ValueError('Gallery base URL must use HTTPS.')
    fields(config.get('rewrite', {}), DEFAULT_REWRITE, 'rewrite')
    rewrite = {**DEFAULT_REWRITE, **config.get('rewrite', {})}
    if not all(isinstance(v, str) and v.strip() for v in rewrite.values()) or not rewrite['baseUrl'].startswith('https://'):
        raise ValueError('Rewrite needs an HTTPS baseUrl, model and keyEnv.')
    characters = config.get('characters')
    if not isinstance(characters, dict) or not characters:
        raise ValueError('characters must be a nonempty named dictionary.')
    for key, value in characters.items():
        identifier(key, 'character key')
        fields(value, {'name', 'tag', 'traits'}, 'character')
        workflow.validate_job({'id': key, 'source': {'slug': 'validation', 'promptId': 'a'*64, 'template': 'template'}, 'character': value})
    profiles = config.get('profiles', {})
    if not isinstance(profiles, dict):
        raise ValueError('profiles must be a named dictionary.')
    profiles = {identifier(k, 'profile key'): profile(v) for k, v in profiles.items()}
    selections = config.get('selections')
    if not isinstance(selections, list) or not selections:
        raise ValueError('selections must be a nonempty array.')
    catalog = fetch(base + '/api/style-gallery/catalog')
    items = catalog['items']
    rewrites, tasks, seen_cards, selection_ids = {}, [], set(), set()
    selected = []
    for selection in selections:
        fields(selection, {'id', 'select', 'runs', 'promptIds'}, 'selection')
        sid = identifier(selection.get('id'), 'selection ID')
        if sid in selection_ids:
            raise ValueError('Duplicate selection ID.')
        selection_ids.add(sid)
        rows = select_cards(items, selection['select'])
        overlap = seen_cards.intersection(r['slug'] for r in rows)
        if overlap:
            raise ValueError(f'Overlapping selections: {", ".join(sorted(overlap))}. Use excludeHashes or one selection with multiple runs.')
        seen_cards.update(r['slug'] for r in rows)
        choices = selection.get('promptIds', {})
        if not isinstance(choices, dict):
            raise ValueError('promptIds must map card hashes/slugs to prompt IDs.')
        variants = {}
        for key, value in choices.items():
            slug = match_card(rows, key)['slug']
            if slug in variants:
                raise ValueError('Repeated promptIds mapping for the same card.')
            variants[slug] = value
        runs = selection.get('runs')
        if not isinstance(runs, list) or not runs:
            raise ValueError('Each selection needs at least one run.')
        run_ids = set()
        for run in runs:
            fields(run, {'id', 'character', 'profile', 'tasksPerHash'}, 'run')
            rid = identifier(run.get('id'), 'run ID')
            if rid in run_ids or run.get('character') not in characters:
                raise ValueError('Duplicate run ID or unknown character.')
            run_ids.add(rid)
            if 'profile' in run and run['profile'] not in profiles:
                raise ValueError('Unknown profile.')
            if 'profile' not in run and 'tasksPerHash' in run:
                raise ValueError('tasksPerHash requires a generation profile; omit it for rewrite-only runs.')
            count = run.get('tasksPerHash', 1)
            if type(count) is not int or not 1 <= count <= 1000:
                raise ValueError('tasksPerHash must be an integer from 1 to 1000.')
        for item in rows:
            source = resolve(item['slug'], base, variants.get(item['slug']))
            selected.append({'hash': item['imageHash'], 'date': item['date'], 'source': source})
            for run in runs:
                character = characters[run['character']]
                rewrite_id = config['id'] + '-r-' + workflow.fingerprint({'source': source, 'character': character})[:20]
                rewrites[rewrite_id] = {'id': rewrite_id, 'source': source, 'character': character}
                if 'profile' not in run:
                    continue
                params = profiles[run['profile']]
                for repeat in range(1, run.get('tasksPerHash', 1) + 1):
                    identity = {'selection': sid, 'run': run['id'], 'source': source, 'repeat': repeat}
                    task_id = config['id'] + '-t-' + workflow.fingerprint(identity)[:20]
                    tasks.append({'id': task_id, 'rewriteId': rewrite_id, 'parameters': params,
                                  'selection': sid, 'run': run['id'], 'repeat': repeat})
    return {'version': 1, 'campaign': config['id'], 'catalogUpdatedAt': catalog.get('updatedAt'),
            'rewrite': rewrite, 'cards': selected, 'rewrites': list(rewrites.values()), 'tasks': tasks}


def frozen_plan(config_path, output, fetch, resolve):
    """Resume the same card set even after the website changes; changed config needs a new folder."""
    config = config_input(config_path)
    signature = workflow.fingerprint(config)
    target = Path(output) / 'plan.json'
    if target.exists():
        saved = workflow.read(target)
        digest = saved.pop('planFingerprint', None)
        if saved.get('inputFingerprint') != signature or workflow.fingerprint(saved) != digest:
            raise ValueError('Config or frozen plan changed. Use a new output directory/campaign ID.')
        return saved
    plan = build(config, fetch, resolve)
    plan['inputFingerprint'] = signature
    plan['config'] = config
    workflow.save(target, {**plan, 'planFingerprint': workflow.fingerprint(plan)})
    return plan
