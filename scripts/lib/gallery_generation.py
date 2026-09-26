#!/usr/bin/env python3
"""Prepare small character substitutions and write portable generation receipts.

Generation and publication are separate. Paid attempts are reserved before submission;
unknown submissions are never retried automatically. Files contain private provider metadata.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from datetime import datetime, timezone
from urllib.request import Request, build_opener, HTTPRedirectHandler

SYSTEM = '''你是图像提示词模板编辑器。只返回 JSON 对象，字段为 prompt。
把 source.template 的主体占位符替换为 character.name，并依据 character.traits 修正冲突的发色、眼睛、肤色、发型等身份特征。
不要改写环境、角度、画风、服饰、表情或构图；不冲突的句子原样保留。删除用于标记可替换特征的尖括号，保留其不冲突内容。
尖括号里的辨识性发饰属于原角色身份，不是通用服装；只有目标角色确实具有该发饰才保留，否则删除或替换为 character.traits 中明确提供的目标角色发饰。
如有文字占位符，使用 character.name，不要新增标语。不要增加质量标签、负面词、额外人物或背景。
输出须包含 character.name 的原始名称，不要翻译成英文；不留下任何占位符。图片必须适合全年龄，保持非色情。'''


def stamp():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
    os.replace(temporary, path)


def load_pixai(folder=None):
    spec = importlib.util.spec_from_file_location('pixai_provider', Path(folder) / 'scripts/pixai.py' if folder else Path(__file__).with_name('pixai_generation.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def validate_job(job):
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,87}', job['id']):
        raise ValueError('Job ID must be 1–88 lowercase letters/digits/hyphens.')
    if not re.fullmatch(r'[a-z0-9-]+', job['source']['slug']):
        raise ValueError('Invalid source slug.')
    if not re.fullmatch(r'[a-f0-9]{64}', job['source']['promptId']):
        raise ValueError('Use the actual Gallery prompt variant ID.')
    for value in [job['source']['template'], *[job['character'][key] for key in ('name', 'tag', 'traits')]]:
        if not isinstance(value, str) or not value.strip():
            raise ValueError('Template and character fields must be nonempty strings.')


def provider_prompt(prompt, character):
    if character['name'] not in prompt or '[在此处替换' in prompt:
        raise ValueError('Rewrite is missing the character name or still contains placeholders.')
    name = character['name']
    pattern = re.escape(name)
    # Preserve adjacent Chinese prose, while refusing partial Latin-name matches such as Annette.
    if re.search('[A-Za-z]', name):
        pattern = r'(?<![A-Za-z0-9_])' + pattern + r'(?![A-Za-z0-9_])'
    if not re.search(pattern, prompt):
        raise ValueError('Rewrite is missing a complete character name.')
    return re.sub(pattern, lambda _: character['tag'], prompt)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise ValueError('Refusing an API redirect carrying credentials.')


def prepare(args):
    jobs = read(args.jobs)
    if len({job['id'] for job in jobs}) != len(jobs):
        raise ValueError('Duplicate job IDs.')
    for job in jobs:
        validate_job(job)
        folder = Path(args.output) / job['id']
        target = folder / 'prepared.json'
        identity = {'job': job, 'baseUrl': args.base_url, 'model': args.model, 'system': SYSTEM}
        if target.exists():
            if read(target)['inputFingerprint'] != fingerprint(identity):
                raise ValueError('Job ID inputs changed; choose a new ID.')
            print(f"Prepared already: {job['id']}")
            continue
        body = {'model': args.model, 'messages': [
            {'role': 'system', 'content': SYSTEM},
            {'role': 'user', 'content': json.dumps(job, ensure_ascii=False)}],
            'response_format': {'type': 'json_object'}, 'temperature': 0.2}
        if not args.apply:
            print(f"Plan rewrite: {job['id']} ({args.model}); no API calls.")
            continue
        if not args.base_url.startswith('https://'):
            raise ValueError('Rewrite API must use HTTPS.')
        response_path = folder / 'rewrite-response.json'
        attempt_path = folder / 'rewrite-attempt.json'
        if response_path.exists():
            saved = read(response_path)
            if saved.get('inputFingerprint') != fingerprint(identity):
                raise ValueError('Saved rewrite response belongs to different/unverified inputs; inspect it rather than resubmit.')
            raw = saved['response']
        else:
            if attempt_path.exists():
                raise ValueError('Text API submission outcome unknown. Recover its response or explicitly start a new job; no automatic paid retry.')
            key = os.environ.get(args.key_env)
            if not key:
                raise ValueError(f'Missing {args.key_env}; provide it in the local process environment.')
            req = Request(args.base_url.rstrip('/') + '/chat/completions', json.dumps(body).encode(),
                          {'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
            # Reserve text attempts too: a valid HTTP response may still contain an
            # invalid rewrite. Preserve/revalidate that response instead of paying again.
            save(attempt_path, {'inputFingerprint': fingerprint(identity), 'request': body, 'at': stamp()})
            with build_opener(NoRedirect()).open(req, timeout=180) as response:
                raw = json.load(response)
            save(response_path, {'inputFingerprint': fingerprint(identity), 'request': body, 'response': raw})
        prompt = json.loads(raw['choices'][0]['message']['content'])['prompt']
        pixai_prompt = provider_prompt(prompt, job['character'])
        receipt = {**job, 'inputFingerprint': fingerprint(identity), 'createdAt': stamp(),
                   'rewrite': {'provider': args.base_url, 'model': args.model, 'request': body,
                               'response': raw, 'prompt': prompt}}
        save(target, receipt)
        (folder / 'openai-prompt.txt').write_text(prompt, encoding='utf-8')
        (folder / 'pixai-prompt.txt').write_text(pixai_prompt, encoding='utf-8')
        print(f"Prepared: {job['id']}; review character identity before a new template family is scheduled.")


def manifest(prepared, job_id, provider, model, prompt, params, request, response, outputs, task_id=None):
    generation = {'provider': provider, 'model': model, 'prompt': prompt, 'parameters': params,
                  'request': request, 'response': response}
    if task_id:
        generation['taskId'] = task_id
    return {'version': 1, 'id': job_id, 'createdAt': stamp(), 'source': prepared['source'],
            'character': prepared['character'], 'rewrite': prepared['rewrite'],
            'generation': generation, 'outputs': outputs}


def generate(args):
    module = load_pixai(args.pixai_skill)
    prepared = read(args.prepared)
    validate_job(prepared)
    # A rewrite is shared by repeats and parameter profiles. A generation task has
    # its own ID/output directory; the legacy one-task-per-rewrite layout stays valid.
    folder = Path(args.task_output).resolve() if getattr(args, 'task_output', None) else Path(args.prepared).resolve().parent / args.provider
    output = folder / 'receipt.json'
    job_id = getattr(args, 'task_id', None) or prepared['id'] + '-' + args.provider
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,95}', job_id):
        raise ValueError('Task ID must be 1–96 lowercase letters/digits/hyphens.')
    prompt = prepared['rewrite']['prompt']
    if args.provider == 'pixai':
        prompt = provider_prompt(prompt, prepared['character'])
        params = {'model_version': args.model or module.TSUBAKI3, 'model_family': 'tsubaki',
                  'ratio': args.ratio, 'size': args.size, 'mode': args.quality,
                  'batch_size': args.batch_size, 'seed': args.seed, 'negative_prompt': ''}
        request = module.build_payload(module.Client(), prompt, params)
    else:
        if not args.model:
            raise ValueError('The standalone OpenAI adapter is unverified here. Supply an API model ID with --model; a Codex builtin model label is not an API model ID.')
        params = {'model': args.model, 'size': args.openai_size,
                  'quality': 'high', 'n': 1, 'output_format': 'png'}
        request = {**params, 'prompt': prompt}
    signature = fingerprint({'prepared': prepared, 'request': request})
    ledger = module.Ledger(args.ledger)
    if output.exists():
        saved = read(output)
        if (saved['id'] != job_id or saved['generation']['request'] != request or saved['rewrite'] != prepared['rewrite']
                or saved['source'] != prepared['source'] or saved['character'] != prepared['character']):
            raise ValueError('Completed task inputs changed; use a new job ID.')
        for item in saved['outputs']:
            image = Path(item['file'])
            if not image.is_file() or hashlib.sha256(image.read_bytes()).hexdigest() != item['sha256']:
                raise ValueError('Completed output missing or changed; recover the recorded task output, never regenerate.')
        print(f'Already complete: {output}')
        return
    if not args.apply:
        print(json.dumps({'job': job_id, 'request': request, 'paidSubmission': False}, ensure_ascii=False, indent=2))
        return
    if not args.max_tasks or args.max_tasks < 1:
        raise ValueError('--apply requires --max-tasks and a shared per-provider ledger.')
    try:
        previous = ledger.get(job_id)
    except module.PixAIError as error:
        if 'absent or duplicated' not in str(error):
            raise
        previous = None
    if previous and previous.get('input_fingerprint') != signature:
        raise ValueError('Task inputs changed or a submission was interrupted before its input record; inspect ledger.')
    folder.mkdir(parents=True, exist_ok=True)
    if args.provider == 'pixai':
        calls_path = folder / 'provider-calls.json'
        if calls_path.exists() and not previous:
            raise ValueError('Provider activity exists without its ledger reservation. Restore the original ledger; do not submit again.')
        calls = read(calls_path) if calls_path.exists() else []
        class RecordingClient(module.Client):
            def request(self, path, payload=None, public=False):
                result = super().request(path, payload, public)
                calls.append({'path': path, 'request': payload, 'response': result})
                save(calls_path, calls)  # Exact JSON bodies, never authorization headers.
                return result
        credential = module.credential()
        if not credential:
            raise ValueError('Missing PIXAI_API_KEY; no paid attempt was reserved.')
        client = RecordingClient(credential)
        if previous:
            if not previous.get('task_id'):
                raise ValueError('Submission outcome unknown; never resubmit. Inspect provider/ledger first.')
            task_id = previous['task_id']
        else:
            # Provider submit reserves before POST. Fingerprint must also exist before network I/O.
            ledger.reserve({'job_id': job_id, 'input_fingerprint': signature}, args.max_tasks)
            try:
                task = client.create(request)
                task_id = task['id']
                ledger.update(job_id, state='submitted', task_id=task_id)
            except BaseException:
                ledger.update(job_id, state='unknown')
                raise
        task = module.poll(client, task_id, 5, args.timeout)
        if task['status'] not in module.COMPLETE:
            # A known terminal failure is distinct from a lost submission response. Keep its
            # exact evidence for review without fabricating outputs or retrying the paid POST.
            save(folder / 'failure.json', {'jobId': job_id, 'source': prepared['source'],
                 'character': prepared['character'], 'rewrite': prepared['rewrite'],
                 'request': request, 'response': task, 'calls': calls})
            ledger.update(job_id, state='failed', failure=str(folder / 'failure.json'))
            raise ValueError(f'PixAI task {task_id} returned {task["status"]}; '
                             'no replacement was submitted. See failure.json for provider evidence.')
        files = module.download(client, task, folder / 'images')
        if len(files) != args.batch_size:
            raise ValueError('Incomplete image download; rerun to resume this task, not regenerate.')
        outputs = [{'file': str(Path(f['path']).resolve()), 'sha256': f['sha256'],
                    'providerIndex': f['index'] - 1} for f in files]
        result = manifest(prepared, job_id, 'pixai', params['model_version'], prompt, params, request,
                          {'calls': calls, 'finalTask': task}, outputs, task_id)
    else:
        if previous:
            raise ValueError('OpenAI attempt already reserved; recover its files/response before any new submission.')
        if not os.environ.get('OPENAI_API_KEY'):
            raise ValueError('OPENAI_API_KEY is required for the standalone API adapter; Codex builtin is separate.')
        if not all(importlib.util.find_spec(name) for name in ('openai', 'httpx')):
            raise ValueError('Use a Python environment with openai and httpx installed; no paid attempt was reserved.')
        if not (Path(args.imagegen_skill) / 'scripts/image_gen.py').is_file():
            raise ValueError('Set --imagegen-skill to the installed official skill directory.')
        ledger.reserve({'job_id': job_id, 'input_fingerprint': signature}, args.max_tasks)
        prompt_path = folder / 'prompt.txt'
        prompt_path.write_text(prompt, encoding='utf-8')
        image_path = folder / 'image.png'
        raw_path = folder / 'provider-calls.json'
        command = [sys.executable, str(Path(__file__).with_name('openai_capture.py')),
                   str(Path(args.imagegen_skill) / 'scripts/image_gen.py'), str(raw_path),
                   'generate', '--model', params['model'], '--prompt-file', str(prompt_path),
                   '--size', args.openai_size, '--quality', 'high', '--out', str(image_path), '--n', '1', '--no-augment']
        try:
            subprocess.run(command, check=True, timeout=args.timeout)
        except BaseException:
            ledger.update(job_id, state='unknown')
            raise
        outputs = [{'file': str(image_path), 'sha256': hashlib.sha256(image_path.read_bytes()).hexdigest(), 'providerIndex': 0}]
        result = manifest(prepared, job_id, 'openai', params['model'], prompt, params, request, read(raw_path), outputs)
    save(output, result)
    ledger.update(job_id, state='complete', receipt=str(output))
    print(f'Completed: {output}; publication is a separate upload-generated-examples command.')


def parser():
    cli = argparse.ArgumentParser(description=__doc__)
    commands = cli.add_subparsers(dest='command', required=True)
    prep = commands.add_parser('prepare', help='Use a configurable OpenAI-compatible text API for minimal substitution')
    prep.add_argument('jobs'); prep.add_argument('--output', required=True)
    prep.add_argument('--base-url', default='https://api.deepseek.com')
    prep.add_argument('--model', default='deepseek-flash'); prep.add_argument('--key-env', default='DEEPSEEK_API_KEY')
    prep.add_argument('--apply', action='store_true')
    gen = commands.add_parser('generate', help='Dry-run or resume one prepared provider task')
    gen.add_argument('prepared'); gen.add_argument('--provider', choices=['pixai', 'openai'], required=True)
    gen.add_argument('--pixai-skill', default=None, help=argparse.SUPPRESS)
    gen.add_argument('--imagegen-skill', default=str(Path.home() / '.codex/skills/.system/imagegen'))
    gen.add_argument('--task-id', help='Distinct generation attempt ID; repeats can share one prepared rewrite')
    gen.add_argument('--task-output', help='Distinct generation output directory for a planned repeat')
    gen.add_argument('--model'); gen.add_argument('--ratio', default='3:4')
    gen.add_argument('--size', choices=['1k', '1.5k'], default='1.5k')
    gen.add_argument('--quality', default='ultra'); gen.add_argument('--batch-size', type=int, choices=[1, 4], default=4)
    gen.add_argument('--seed', type=int); gen.add_argument('--openai-size', default='1024x1536')
    gen.add_argument('--ledger', required=True); gen.add_argument('--max-tasks', type=int)
    gen.add_argument('--timeout', type=int, default=1200); gen.add_argument('--apply', action='store_true')
    return cli


if __name__ == '__main__':
    try:
        args = parser().parse_args()
        (prepare if args.command == 'prepare' else generate)(args)
    except Exception as error:
        # API response bodies and secrets belong in private receipts, never exception output.
        safe_message = str(error) if isinstance(error, ValueError) or type(error).__name__ == 'PixAIError' else 'Operation failed; inspect the private receipt/ledger. No generation POST was retried.'
        print(f'{type(error).__name__}: {safe_message}', file=sys.stderr)
        sys.exit(1)
