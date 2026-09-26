#!/usr/bin/env python3
"""Run the official imagegen CLI unchanged, recording exact JSON exchanges without auth headers.

Disable SDK POST retries: an uncertain submission must consume its reserved attempt.
The resulting file is private and can include base64 images or provider metadata.
"""
import json
import os
from pathlib import Path
import runpy
import sys
import httpx
import openai

cli, destination, *arguments = sys.argv[1:]
exchanges = []
original = openai.OpenAI


def capture(response):
    response.read()
    exchanges.append({'path': response.request.url.path,
                      'request': json.loads(response.request.content),
                      'status': response.status_code,
                      'response': response.json()})
    target = Path(destination)
    temporary = target.with_suffix('.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(exchanges, stream, ensure_ascii=False)
    os.replace(temporary, target)


def recorded_client(*args, **kwargs):
    kwargs['max_retries'] = 0
    kwargs['http_client'] = httpx.Client(event_hooks={'response': [capture]})
    return original(*args, **kwargs)


openai.OpenAI = recorded_client
sys.argv = [cli, *arguments]
runpy.run_path(cli, run_name='__main__')
