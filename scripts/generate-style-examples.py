#!/usr/bin/env python3
"""Run Gallery → text API → PixAI → receipts without an agent or installed skills.

Generation uses Python 3.10+ standard library only. Optional --upload invokes the
repository's existing Node uploader and HF configuration. Paid POSTs are never
retried automatically; running the same command resumes saved task IDs/results.
"""
import argparse
import json
import os
from contextlib import contextmanager
import fcntl
from pathlib import Path
import re
import shutil
import subprocess
import sys
from types import SimpleNamespace
from urllib.parse import urlsplit
from urllib.request import urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent / 'lib'))
import gallery_generation as workflow
import pixai_generation as pixai
import gallery_generation_plan as planner

ROOT = Path(__file__).resolve().parents[1]


def public_json(url):
    """Read public Gallery data without carrying provider credentials."""
    if urlsplit(url).scheme != 'https':
        raise ValueError('Gallery base URL must use HTTPS.')
    with urlopen(url, timeout=120) as response:
        data = response.read(24 * 1024 * 1024 + 1)
    if len(data) > 24 * 1024 * 1024:
        raise ValueError('Gallery response exceeds 24 MiB.')
    return json.loads(data)


def resolve_source(source, base_url, prompt_id=None):
    """Resolve one exact card/variant, or validate an already captured template."""
    if isinstance(source, dict) and source.get('template'):
        return source
    selector = source.get('slug') if isinstance(source, dict) else source
    prompt_id = source.get('promptId', prompt_id) if isinstance(source, dict) else prompt_id
    if not isinstance(selector, str) or not re.fullmatch(r'[a-z0-9-]+', selector):
        raise ValueError('source must be a Gallery slug/hash or captured source object.')
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}-.+', selector):
        catalog = public_json(base_url + '/api/style-gallery/catalog')
        matches = [i for i in catalog['items'] if i.get('imageHash', '').startswith(selector)]
        if len(matches) != 1:
            raise ValueError(f'Source {selector} must match exactly one card; use its full slug.')
        selector = matches[0]['slug']
    item = public_json(base_url + '/api/style-gallery/prompts/' + selector)
    prompts = [p for p in item['prompts'] if not prompt_id or p['id'] == prompt_id]
    if len(prompts) != 1:
        raise ValueError(f'{selector} needs an explicit promptId because it has multiple/no matching variants.')
    return {'slug': item['slug'], 'promptId': prompts[0]['id'], 'template': prompts[0]['prompt']}


@contextmanager
def output_lock(output):
    """Two commands sharing an output folder must not both submit the same text rewrite."""
    output.mkdir(parents=True, exist_ok=True)
    with (output / '.pipeline.lock').open('a') as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('Another pipeline command is using this output directory.') from None
        yield


def legacy_plan(args, out):
    """Keep the original jobs format, paths and task IDs for already-running batches."""
    rows = workflow.read(args.jobs)
    if not isinstance(rows, list) or not rows or any(not isinstance(row, dict) for row in rows):
        raise ValueError('--jobs must contain a nonempty JSON array of objects.')
    if len({row.get('id') for row in rows}) != len(rows):
        raise ValueError('Duplicate job IDs.')
    jobs, tasks = [], []
    for row in rows:
        planner.fields(row, {'id', 'source', 'promptId', 'character', 'generation'}, 'job')
        job = {key: row[key] for key in ('id', 'character')}
        if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,87}', job['id']):
            raise ValueError('Job ID must be 1–88 lowercase letters/digits/hyphens.')
        captured = out / 'batch' / job['id'] / 'input.json'
        if captured.is_file():
            saved = workflow.read(captured)
            if saved['input'] != row:
                raise ValueError(f'Inputs changed for {job["id"]}; use a new ID.')
            job['source'] = saved['source']
        else:
            job['source'] = resolve_source(row['source'], (args.api_base or 'https://clelele-blog.vercel.app').rstrip('/'), row.get('promptId'))
        workflow.validate_job(job)
        params = {k: getattr(args, k) for k in planner.DEFAULT_PROFILE if k != 'provider' and getattr(args, k) is not None}
        params.update(row.get('generation', {}))
        params = planner.profile(params)
        jobs.append(job)
        tasks.append({'id': job['id'] + '-pixai', 'rewriteId': job['id'], 'parameters': params,
                      'output': str(out / 'batch' / job['id'] / 'pixai')})
    return {'rewrites': jobs, 'tasks': tasks, 'rows': rows,
            'rewrite': {'baseUrl': args.text_base_url or planner.DEFAULT_REWRITE['baseUrl'],
                        'model': args.text_model or planner.DEFAULT_REWRITE['model'],
                        'keyEnv': args.text_key_env or planner.DEFAULT_REWRITE['keyEnv']}}


def export_prompts(jobs, out):
    """Export portable text without requiring or contacting an image-generation provider."""
    entries = []
    for job in jobs:
        path = out / 'batch' / job['id'] / 'prepared.json'
        if not path.exists():
            continue
        prepared = workflow.read(path)
        prompt = prepared['rewrite']['prompt']
        # Generic filename deliberately avoids implying an OpenAI-specific prompt format.
        (path.parent / 'prompt.txt').write_text(prompt, encoding='utf-8')
        entries.append({'id': job['id'], 'source': prepared['source'], 'character': prepared['character'],
                        'prompt': prompt, 'tagPrompt': workflow.provider_prompt(prompt, prepared['character']),
                        'prepared': str(path)})
    workflow.save(out / 'prompts.json', entries)
    print(f'Prompt export: {len(entries)} complete rewrite(s); {out / "prompts.json"}')


def preflight_budget(tasks, ledger_path, maximum, increase):
    """Check the whole batch before paid text work; each image POST also reserves under lock."""
    if type(maximum) is not int or maximum < 1:
        raise ValueError('Image generation requires a positive --max-tasks shared budget.')
    ledger = pixai.Ledger(ledger_path)
    with ledger.locked() as data:
        old = data.get('max_tasks', maximum)
        if old != maximum:
            if not increase or maximum <= old:
                raise ValueError(f'Ledger budget is {old}; an authorized increase needs --increase-budget.')
        existing = {attempt['job_id'] for attempt in data['attempts']}
        pending = [t['id'] for t in tasks if t['id'] not in existing]
        if len(data['attempts']) + len(pending) > maximum:
            raise ValueError(f'Budget insufficient: {len(data["attempts"])} used + {len(pending)} new tasks > {maximum}; no API calls made.')
        if old != maximum:
            data.setdefault('budget_changes', []).append({'from': old, 'to': maximum, 'at': workflow.stamp(), 'reason': 'explicit CLI increase'})
            data['max_tasks'] = maximum
            pixai.atomic_json(ledger.path, data)
        print(f'Ledger: {len(data["attempts"])} / {maximum} attempts used; {len(pending)} new submissions; '
              f'{len(tasks)-len(pending)} existing tasks to inspect/resume.')


def upload_receipt(receipt):
    """Serialize publication across batches: different cards still share HF indexes."""
    lock = ROOT / 'output/gallery-generation/.upload.lock'
    lock.parent.mkdir(parents=True, exist_ok=True)
    with lock.open('a') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        subprocess.run(['node', '--disable-warning=DEP0205', '--use-env-proxy',
            '--env-file-if-exists=.env.local', '--import', 'tsx',
            'scripts/upload-generated-examples.ts', str(receipt), '--apply'], cwd=ROOT, check=True)


def bound_ledger(out, supplied):
    """Omitting --ledger on resume must never forget already-paid provider task IDs."""
    binding = out / 'execution.json'
    requested = str(Path(supplied).resolve()) if supplied else None
    if binding.exists():
        existing = workflow.read(binding)['pixaiLedger']
        if requested and requested != existing:
            raise ValueError('This output is bound to a different PixAI ledger. Reuse it; changing ledgers could repeat paid submissions.')
        if not Path(existing).is_file():
            raise ValueError('The bound PixAI ledger is missing. Restore it before resuming; an empty replacement could repeat a paid submission.')
        return Path(existing)
    path = Path(requested) if requested else out / 'pixai-ledger.json'
    # Initialize before binding, so absence later means lost history rather than
    # a first run. Do not overwrite a ledger shared with another campaign.
    ledger = pixai.Ledger(path)
    with ledger.locked() as data:
        if not path.exists():
            pixai.atomic_json(path, data)
    workflow.save(binding, {'pixaiLedger': str(path)})
    return path


def run(args):
    out = Path(args.output).resolve()
    with output_lock(out):
        execute(args, out)


def execute(args, out):
    if args.config:
        business = ('api_base', 'text_base_url', 'text_model', 'text_key_env', 'model', 'ratio', 'size', 'quality', 'batch_size', 'seed')
        if any(getattr(args, key) is not None for key in business):
            raise ValueError('--config cannot be combined with model/ratio/text API CLI overrides; put business settings in the config.')
        plan = planner.frozen_plan(args.config, out, public_json, resolve_source)
        for task in plan['tasks']:
            task['output'] = str(out / 'tasks' / task['id'])
    else:
        plan = legacy_plan(args, out)
    jobs, tasks, rewrite = plan['rewrites'], plan['tasks'], plan['rewrite']
    print(f'Plan: {len({j["source"]["slug"] for j in jobs})} card(s), {len(jobs)} distinct template/character rewrite(s), {len(tasks)} generation task(s).')
    for provider in sorted({t['parameters']['provider'] for t in tasks}):
        selected = [t for t in tasks if t['parameters']['provider'] == provider]
        count = sum(t['parameters'].get('batch_size', 0) for t in selected)
        print(f'  {provider}: {len(selected)} task(s)' + (f', up to {count} image(s).' if count else '; manual output count is unspecified.'))
    print('A task is one provider submission, not one image. Repeats share the saved text rewrite. Failed/unknown submissions still count; they are not automatically replaced.')
    if any(t['parameters'].get('seed') is not None for t in tasks):
        print('Fixed seed requested: repeated identical parameters may yield identical images.')
    if args.stage == 'plan' or not args.apply:
        print('Plan only: no paid API calls or HF writes. Use --stage rewrite --apply for prompts only, or --apply for the full supported pipeline.')
        return
    make_text = args.stage in ('rewrite', 'all')
    make_images = args.stage in ('generate', 'all') and bool(tasks)
    do_upload = args.stage == 'upload' or args.upload
    if args.upload and args.stage not in ('generate', 'all'):
        raise ValueError('--upload is valid with all/generate only; use --stage upload for existing receipts.')
    if do_upload and (not shutil.which('node') or not (ROOT / 'node_modules/tsx').exists()):
        raise ValueError('HF upload needs Node and this repository dependencies (npm install).')
    if make_images:
        unavailable = {t['parameters']['provider'] for t in tasks} - {'pixai'}
        if unavailable:
            raise ValueError(f'Automatic generation unavailable for {", ".join(sorted(unavailable))}. Run --stage rewrite; builtin needs an Agent and external targets are manual. No paid API calls made.')
        ledger_path = bound_ledger(out, args.ledger)
        preflight_budget(tasks, ledger_path, args.max_tasks, args.increase_budget)
        if any(not (Path(t['output']) / 'receipt.json').exists() for t in tasks) and not pixai.credential():
            raise ValueError('Missing PIXAI_API_KEY; image work cannot run, so no text API call was made. Use --stage rewrite for prompts only.')
    if args.stage == 'generate':
        missing = [j['id'] for j in jobs if not (out / 'batch' / j['id'] / 'prepared.json').exists()]
        if missing:
            raise ValueError('Missing rewrites; run --stage rewrite first: ' + ', '.join(missing))
    failures, completed = [], []

    def failure(identity, error):
        safe = isinstance(error, ValueError) or type(error).__name__ == 'PixAIError'
        message = str(error) if safe else 'Operation failed; inspect saved task/receipt. No paid POST was retried.'
        failures.append({'job': identity, 'message': message})
        print(f'Failed {identity}: {message}', file=sys.stderr)

    if make_text:
        for index, job in enumerate(jobs):
            folder = out / 'batch' / job['id']
            if not args.config:
                workflow.save(folder / 'input.json', {'input': plan['rows'][index], 'source': job['source']})
            workflow.save(folder / 'rewrite-input.json', [job])
            try:
                workflow.prepare(SimpleNamespace(jobs=folder / 'rewrite-input.json', output=out / 'batch',
                    base_url=rewrite['baseUrl'], model=rewrite['model'], key_env=rewrite['keyEnv'], apply=True))
            except Exception as error:
                failure(job['id'], error)
                if not args.continue_on_error:
                    break
        export_prompts(jobs, out)
    if (make_images or do_upload) and (not failures or args.continue_on_error):
        for task in tasks:
            prepared = out / 'batch' / task['rewriteId'] / 'prepared.json'
            receipt = Path(task['output']) / 'receipt.json'
            try:
                if make_images:
                    if not prepared.is_file():
                        raise ValueError('Rewrite failed or absent; generation was not submitted.')
                    workflow.generate(SimpleNamespace(prepared=prepared, task_id=task['id'], task_output=task['output'],
                        pixai_skill=None, ledger=ledger_path,
                        max_tasks=args.max_tasks, timeout=args.timeout, apply=True, **task['parameters']))
                if do_upload:
                    upload_receipt(receipt)
                completed.append(task['id'])
            except Exception as error:
                failure(task['id'], error)
                if not args.continue_on_error:
                    break
            finally:
                workflow.save(out / 'run-summary.json', {'completed': completed, 'failures': failures, 'stage': args.stage, 'updatedAt': workflow.stamp()})
    workflow.save(out / 'run-summary.json', {'completed': completed, 'failures': failures, 'stage': args.stage, 'updatedAt': workflow.stamp()})
    print(f'Result: stage={args.stage}; {len(completed)} generation/upload task(s) completed; {len(failures)} failure(s).')
    if failures:
        raise SystemExit(1)


def parser():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    source = p.add_mutually_exclusive_group(required=True)
    source.add_argument('--jobs', help='Legacy JSON array: id, source, character; optional generation overrides')
    source.add_argument('--config', help='Campaign JSON: card hashes/ranges, characters, profiles and explicit per-card runs')
    p.add_argument('--stage', choices=['plan', 'rewrite', 'generate', 'upload', 'all'], default='all',
                   help='Stages run independently. rewrite requires no image key or task budget; default all is still dry-run without --apply')
    p.add_argument('--output', default='output/gallery-generation/manual', help='Stable output/plan directory; reuse for resuming')
    for key in ('api-base', 'text-base-url', 'text-model', 'text-key-env', 'model', 'ratio'):
        p.add_argument('--' + key, help='Legacy jobs only; config mode reads this setting from JSON')
    p.add_argument('--size', choices=['1k', '1.5k']); p.add_argument('--quality', choices=pixai.MODES)
    p.add_argument('--batch-size', type=int, choices=[1, 4]); p.add_argument('--seed', type=int)
    p.add_argument('--timeout', type=int, default=1200)
    p.add_argument('--ledger', help='Shared per-provider ledger including agent runs')
    p.add_argument('--max-tasks', type=int, help='Lifetime image task cap including failures; not required for rewrite/upload')
    p.add_argument('--increase-budget', action='store_true', help='Explicitly raise an existing ledger cap; never discard attempts')
    p.add_argument('--apply', action='store_true', help='Execute the selected stage; otherwise plan without paid API/HF writes')
    p.add_argument('--upload', action='store_true', help='After all/generate, publish via existing Node/HF uploader')
    p.add_argument('--continue-on-error', action='store_true', help='Continue independent jobs without replacing failed paid submissions')
    return p


if __name__ == '__main__':
    try:
        run(parser().parse_args())
    except Exception as error:
        message = str(error) if isinstance(error, ValueError) or type(error).__name__ == 'PixAIError' else 'Unable to complete pipeline; inspect local receipts. Credentials/provider response bodies are omitted.'
        print(f'{type(error).__name__}: {message}', file=sys.stderr)
        sys.exit(1)

# 运行示例（计划和生图仅需 Python 标准库；HF 上传另外使用 blog 的 Node 依赖）：
# python3 scripts/generate-style-examples.py --config campaign.json --output output/gallery-generation/autumn
# 只改写并导出 prompt：仅需文本 API key，不需要 PixAI/OpenAI key 或 Agent。
# python3 scripts/generate-style-examples.py --config campaign.json --output output/gallery-generation/autumn --stage rewrite --apply
# 复用已改写文本生图：只需 PixAI key，不会再次调用文本 API；2 次任务 × 每次4张 = 最多8张。
# python3 scripts/generate-style-examples.py --config campaign.json --output output/gallery-generation/autumn --stage generate --max-tasks 20 --apply
# 上传已完成结果，无需生图 key：将上一行的 stage 改为 upload，可去掉 max-tasks。
# 全流程：--stage all --max-tasks 20 --apply --upload。重跑继续原任务，不自动替换失败/未知提交。
# 旧命令兼容：--jobs jobs.json；配置示例在 scripts/examples/gallery-generation/。
