#!/usr/bin/env python3
"""Reserve one Codex imagegen call, then preserve its actual output and receipt.

This bridge never generates images itself. The agent passes the saved prompt
unchanged to image_gen and records the result without claiming an API model version.
"""
import argparse
import hashlib
import re
from pathlib import Path
import shutil
import sys

from gallery_generation import fingerprint, load_pixai, manifest, read, save, validate_job


def run(args):
    prepared = read(args.prepared)
    validate_job(prepared)
    prompt = prepared['rewrite']['prompt']
    if prepared['character']['name'] not in prompt or '[在此处替换' in prompt:
        raise ValueError('Use a completed character rewrite with no placeholders.')
    request = {'prompt': prompt}
    identity = fingerprint({'prepared': prepared, 'request': request})
    job_id = args.task_id or prepared['id'] + '-builtin'
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,95}', job_id):
        raise ValueError('Invalid builtin task ID.')
    folder = Path(args.task_output).resolve() if args.task_output else Path(args.prepared).resolve().parent / 'builtin'
    module = load_pixai(args.pixai_skill)
    ledger = module.Ledger(args.ledger)
    if args.action == 'reserve':
        if (folder / 'request.json').exists():
            raise ValueError('Builtin request already exists. Recover that attempt; do not reserve with a new ledger.')
        # Duplicate reservations stop rather than disguising an uncertain paid attempt as a retry.
        ledger.reserve({'job_id': job_id, 'input_fingerprint': identity, 'provider': 'codex-imagegen'}, args.max_tasks)
        save(folder / 'request.json', request)
        (folder / 'prompt.txt').write_text(prompt, encoding='utf-8')
        print(f'Reserved one builtin task: {job_id}; exact prompt: {folder / "prompt.txt"}')
        return
    reserved = ledger.get(job_id)
    if reserved.get('input_fingerprint') != identity:
        raise ValueError('Prepared inputs changed since reservation.')
    output = folder / 'receipt.json'
    if output.exists():
        previous = read(output)
        if previous['id'] != job_id or previous['generation']['request'] != request:
            raise ValueError('Existing receipt belongs to a different builtin task.')
        image = Path(previous['outputs'][0]['file'])
        if not image.is_file() or hashlib.sha256(image.read_bytes()).hexdigest() != previous['outputs'][0]['sha256']:
            raise ValueError('Saved output is missing or changed; recover the original tool output.')
        print(f'Already recorded: {output}')
        return
    if not args.image or not args.response_json:
        raise ValueError('record requires --image and --response-json from the actual tool result.')
    source = Path(args.image).resolve()
    if not source.is_file() or source.suffix.lower() not in {'.png', '.jpg', '.jpeg', '.webp'}:
        raise ValueError('Record the tool-generated raster file, not a placeholder.')
    response = read(args.response_json)
    target = folder / ('image' + source.suffix.lower())
    if target.exists() and target.read_bytes() != source.read_bytes():
        raise ValueError('A different output already exists; refusing to overwrite it.')
    if target != source:
        shutil.copyfile(source, target)
    result = manifest(prepared, job_id, 'codex-imagegen', 'builtin-unspecified', prompt,
                      {'execution': 'codex-builtin', 'requestedImages': 1}, request, response,
                      [{'file': str(target), 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
                        'providerIndex': 0}])
    save(output, result)
    ledger.update(job_id, state='complete', receipt=str(output))
    print(f'Recorded: {output}; no independent OpenAI API call was made.')


def parser():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('action', choices=['reserve', 'record'])
    cli.add_argument('prepared')
    cli.add_argument('--ledger', required=True)
    cli.add_argument('--max-tasks', type=int, default=10)
    cli.add_argument('--task-id', help='Use the task ID from plan.json for planned repeats')
    cli.add_argument('--task-output', help='Use the planned tasks/<task-id> output directory')
    cli.add_argument('--pixai-skill', default=None, help=argparse.SUPPRESS)
    cli.add_argument('--image')
    cli.add_argument('--response-json')
    return cli


if __name__ == '__main__':
    try:
        run(parser().parse_args())
    except Exception as error:
        print(f'{type(error).__name__}: {error}', file=sys.stderr)
        sys.exit(1)
