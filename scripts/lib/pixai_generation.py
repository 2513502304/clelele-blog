"""Local PixAI REST transport: standard library only; one paid POST per ledger attempt.

Derived from the tested pixai-imagegen provider implementation. This repository owns
its REST-only adapter; running the pipeline never loads an installed agent skill.
"""

from __future__ import annotations

from contextlib import contextmanager
import fcntl
import hashlib
from http.client import HTTPException
import ipaddress
import json
import math
import os
from pathlib import Path
import re
import socket
import struct
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

API = "https://api.pixai.art"

TSUBAKI3 = "2024383379556065549"


MODES = ("lite", "standard", "pro", "ultra")

REST_RATIOS = {"1:1", "2:3", "3:2", "3:4", "4:3", "3:5", "5:3", "9:16", "16:9", "1:3", "3:1"}

PENDING = {"waiting", "queued", "running", "processing", "pending"}

COMPLETE = {"completed", "succeeded", "success"}

FAILED = {"failed", "canceled", "cancelled", "error"}



class PixAIError(RuntimeError):
    """An error message safe to print without response bodies or secret URLs."""

def read_json(path):
    try:
        return json.loads(Path(path).read_bytes().decode("utf-8"))
    except (OSError, ValueError, UnicodeError):
        raise PixAIError("Cannot read valid UTF-8 JSON input") from None

def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value):
        raise PixAIError("IDs must contain 1-128 letters, numbers, underscores or hyphens")
    return value

def atomic_json(path, value):
    """Replace a private JSON file and fsync it before a paid operation proceeds."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".pixai-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def credential(key_file=None):
    """Resolve an explicitly selected credential file or PIXAI_API_KEY only when needed."""
    try:
        key = Path(key_file).read_bytes().decode("utf-8").strip() if key_file else os.environ.get("PIXAI_API_KEY", "").strip()
    except (OSError, UnicodeError):
        raise PixAIError("Cannot read credential file") from None
    if any(c in key for c in "\r\n"):
        raise PixAIError("Credential contains invalid line breaks")
    return key

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise PixAIError("API redirect refused; no credential forwarded")

def public_url(url):
    """Reject non-HTTPS, local-network and credential-bearing download destinations."""
    try:
        parsed = urlsplit(url)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.port not in (None, 443):
            raise ValueError
        addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
            raise ValueError
    except (ValueError, TypeError, OSError):
        raise PixAIError("Download destination must be public HTTPS") from None
    return url

class PublicRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        public_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)

class Client:
    """Small single-attempt API client with separate unauthenticated CDN transport."""
    def __init__(self, key="", transport="rest"):
        if transport != "rest":
            raise PixAIError("The standalone pipeline supports official REST only")
        self.key, self.transport = key, transport
        self.api = build_opener(NoRedirect())
        self.cdn = build_opener(PublicRedirect())

    def request(self, path, payload=None, public=False):
        if not public and not self.key:
            raise PixAIError("Missing PIXAI_API_KEY")
        headers = {"Content-Type": "application/json", "User-Agent": "Gallery-Pipeline/1.0"}
        if not public:
            headers["Authorization"] = "Bearer " + self.key
        body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        try:
            with self.api.open(Request(API + path, body, headers), timeout=90) as response:
                result = json.load(response)
        except HTTPError as exc:
            exc.close()
            raise PixAIError(f"PixAI HTTP {exc.code}; response omitted; generation POST was not retried") from None
        except (URLError, TimeoutError, HTTPException, ConnectionError, ValueError, OSError):
            raise PixAIError("PixAI network or response error; generation POST was not retried") from None
        if not isinstance(result, dict) or result.get("errors"):
            raise PixAIError("PixAI returned a malformed response or GraphQL error; details omitted")
        return result

    def create(self, payload):
        result = self.request("/v2/image/create", payload)
        if not isinstance(result, dict):
            raise PixAIError("Missing task object; submission outcome may be unknown")
        # Other fields may be malformed; the caller must save any returned ID first.
        return {**result, "id": identifier(result.get("id") or result.get("taskId"))}

    def task(self, task_id):
        task_id = identifier(task_id)
        result = self.request("/v1/task/" + task_id)
        task = normalize_task(result)
        if task["id"] != task_id:
            raise PixAIError("Returned task ID differs from the requested task")
        return task

    def config(self, model, kind):
        suffix = {"sizes": "size-config", "profiles": "inference-profiles"}[kind]
        return self.request("/v2/generation-model/" + identifier(model) + "/" + suffix, public=True)

def normalize_task(task):
    if not isinstance(task, dict):
        raise PixAIError("Missing task object; submission outcome may be unknown")
    task = dict(task)
    task["id"] = identifier(task.get("id") or task.get("taskId"))
    status = task.get("status", "pending")
    if not isinstance(status, str) or status.lower() not in PENDING | COMPLETE | FAILED:
        raise PixAIError("Unrecognized task status; retain task ID and inspect before proceeding")
    task["status"] = status.lower()
    return task

def build_payload(client, prompt, params):
    """Keep the prompt string exact; omit helpers, defaults and extras from captured tasks."""
    if not isinstance(prompt, str) or not prompt.strip():
        raise PixAIError("Prompt must be a nonempty UTF-8 string")
    if params.get("model_family", "other") not in {"tsubaki", "other"}:
        raise PixAIError("Unsupported model family")
    if params.get("size") not in {"1k", "1.5k"} or params.get("batch_size") not in {1, 4} or type(params.get("batch_size")) is not int:
        raise PixAIError("Size must be 1k/1.5k and batch_size must be integer 1/4")
    if not isinstance(params.get("ratio"), str) or not re.fullmatch(r"[1-9][0-9]?:[1-9][0-9]?", params["ratio"]):
        raise PixAIError("Ratio must use positive integer W:H notation")
    if params.get("seed") is not None and (type(params["seed"]) is not int or not 0 <= params["seed"] <= 4294967295):
        raise PixAIError("Seed must be an integer in 0..4294967295")
    if not isinstance(params.get("negative_prompt", ""), str):
        raise PixAIError("negative_prompt must be a string")
    mode = params.get("mode")
    if mode is not None and mode not in MODES:
        raise PixAIError("Unsupported inference mode")
    model = params.get("model_version")
    if client.transport == "rest":
        if not model:
            raise PixAIError("REST requires explicit --model-version")
        if params["ratio"] not in REST_RATIOS:
            raise PixAIError("Aspect ratio is not supported by the official REST API")
        if mode and params.get("model_family", "other") != "tsubaki":
            raise PixAIError("REST --mode requires explicit --model-family tsubaki")
        result = {"modelVersionId": identifier(model), "prompt": prompt,
                  "negativePrompt": params.get("negative_prompt", ""), "aspectRatio": params["ratio"],
                  "size": params["size"], "batchSize": params["batch_size"], "promptHelper": "disable"}
        if params.get("model_family") == "tsubaki":
            result["mode"] = mode or "pro"
        if params.get("seed") is not None:
            result["seed"] = params["seed"]
        return result
    raise PixAIError("The standalone pipeline supports official REST only")


class Ledger:
    """Serialize reservations with a separate lock file, counting ambiguous attempts."""
    def __init__(self, path):
        self.path = Path(path)

    @contextmanager
    def locked(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(str(self.path) + ".lock", os.O_CREAT | os.O_RDWR, 0o600)
        with os.fdopen(fd, "a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            data = read_json(self.path) if self.path.exists() else {"version": 1, "attempts": []}
            if not isinstance(data, dict) or data.get("version") != 1 or not isinstance(data.get("attempts"), list):
                raise PixAIError("Invalid ledger; refusing to submit")
            yield data

    def check(self, data, ids, maximum):
        if type(maximum) is not int or maximum < 1:
            raise PixAIError("--submit requires positive --max-tasks per ledger")
        if data.get("max_tasks", maximum) != maximum:
            raise PixAIError("Ledger max_tasks is fixed; use its existing limit")
        if len(ids) != len(set(ids)) or any(a.get("job_id") in ids for a in data["attempts"]):
            raise PixAIError("Job ID already reserved; use resume, never repeat a submission")
        if len(data["attempts"]) + len(ids) > maximum:
            raise PixAIError("Ledger task budget exhausted, including reserved/unknown attempts")

    def preflight(self, ids, maximum):
        with self.locked() as data:
            self.check(data, ids, maximum)

    def reserve(self, job, maximum):
        with self.locked() as data:
            self.check(data, [job["job_id"]], maximum)
            data["max_tasks"] = maximum
            data["attempts"].append({**job, "state": "reserved", "reserved_at": time.time()})
            atomic_json(self.path, data)

    def update(self, job_id, **fields):
        with self.locked() as data:
            for job in data["attempts"]:
                if job.get("job_id") == job_id:
                    job.update(fields)
                    atomic_json(self.path, data)
                    return
        raise PixAIError("Job ID absent from ledger")

    def get(self, job_id):
        with self.locked() as data:
            matches = [job for job in data["attempts"] if job.get("job_id") == job_id]
            if len(matches) != 1:
                raise PixAIError("Job ID absent or duplicated in ledger")
            return dict(matches[0])

def poll(client, task_id, interval, timeout, on_task=None):
    """Poll a known task with a finite deadline; timeout leaves a resumable ID."""
    if not math.isfinite(interval) or not math.isfinite(timeout) or interval < 1.5 or timeout <= 0:
        raise PixAIError("Poll interval must be >=1.5 seconds and timeout must be positive")
    deadline = time.monotonic() + timeout
    while True:
        task = client.task(task_id)
        if on_task:
            on_task(task)
        if task["status"] in COMPLETE | FAILED:
            return task
        remaining = deadline - time.monotonic()
        if remaining < interval:
            raise PixAIError(f"Polling timeout; resume existing task {identifier(task_id)}")
        time.sleep(interval)

def output_sources(client, task):
    """Preserve server ordering and resolve media IDs to the original variant."""
    outputs = task.get("outputs")
    if not isinstance(outputs, dict):
        raise PixAIError("Task has no recognized output object")
    ids, urls = outputs.get("mediaIds"), outputs.get("mediaUrls")
    if ids is None and outputs.get("mediaId"):
        ids = [outputs["mediaId"]]
    if not ids and outputs.get("batch") is not None:
        batch = outputs["batch"]
        if not isinstance(batch, list) or any(not isinstance(i, dict) or not i.get("mediaId") for i in batch):
            raise PixAIError("Malformed output batch")
        ids = [i["mediaId"] for i in batch]
    if ids:
        if not isinstance(ids, list):
            raise PixAIError("Malformed media ID list")
        sources = []
        for media_id in ids:
            media = client.request("/v1/media/" + identifier(media_id))
            variants = media.get("urls")
            if not isinstance(variants, list) or not variants or any(not isinstance(v, dict) for v in variants):
                raise PixAIError("Media response lacks URL variants")
            original = next((v for v in variants if str(v.get("variant", "")).lower() == "original"), variants[0])
            if not isinstance(original.get("url"), str):
                raise PixAIError("Media variant lacks a URL")
            sources.append((original["url"], media_id))
        return sources
    if not isinstance(urls, list) or not urls or any(not isinstance(u, str) for u in urls):
        raise PixAIError("Task has no recognized output media IDs/URLs")
    return [(url, None) for url in urls]

def image_info(data):
    """Read common original-image headers without re-encoding the downloaded bytes."""
    if data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
        return ".png", struct.unpack(">II", data[16:24])
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        if data[12:16] == b"VP8X" and len(data) >= 30:
            return ".webp", (int.from_bytes(data[24:27], "little") + 1, int.from_bytes(data[27:30], "little") + 1)
        return ".webp", None
    if data.startswith(b"\xff\xd8"):
        offset = 2
        while offset + 9 <= len(data):
            if data[offset] != 255:
                break
            marker = data[offset + 1]
            if marker in (0xD8, 0xD9) or marker == 0xDA:
                break
            length = int.from_bytes(data[offset + 2:offset + 4], "big")
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                h, w = struct.unpack(">HH", data[offset + 5:offset + 9])
                return ".jpg", (w, h)
            if length < 2:
                break
            offset += 2 + length
        return ".jpg", None
    raise PixAIError("Downloaded output is not a recognized PNG/JPEG/WebP image")

def download(client, task, directory):
    task = normalize_task(task)
    if task["status"] not in COMPLETE:
        raise PixAIError("Task is not completed; no outputs downloaded")
    sources = output_sources(client, task)
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    images = []
    for index, (url, media_id) in enumerate(sources, 1):
        public_url(url)
        # The CDN opener and every redirect receive no API bearer or cookies.
        request = Request(url, headers={"User-Agent": "Gallery-Pipeline/1.0"})
        fd, temporary = tempfile.mkstemp(prefix=".pixai-image-", dir=directory)
        try:
            digest, header, size = hashlib.sha256(), bytearray(), 0
            with os.fdopen(fd, "wb") as target, client.cdn.open(request, timeout=120) as response:
                while block := response.read(1024 * 1024):
                    size += len(block)
                    if size > 256 * 1024 * 1024:
                        raise PixAIError("Output exceeds the 256 MiB per-image download limit")
                    digest.update(block)
                    if len(header) < 256 * 1024:
                        header.extend(block[:256 * 1024 - len(header)])
                    target.write(block)
                target.flush()
                os.fsync(target.fileno())
            suffix, dimensions_found = image_info(header)
            sha = digest.hexdigest()
            destination = directory / f"{task['id']}_{index:02d}_{sha[:16]}{suffix}"
            os.replace(temporary, destination)
            item = {"index": index, "path": str(destination.resolve()), "sha256": sha, "bytes": size}
            if media_id:
                item["media_id"] = media_id
            if dimensions_found:
                item.update(zip(("width", "height"), dimensions_found))
            images.append(item)
        except HTTPError as exc:
            exc.close()
            raise PixAIError(f"Image HTTP {exc.code}; URL omitted") from None
        except (URLError, TimeoutError, HTTPException, ConnectionError, OSError):
            raise PixAIError("Image download failed; URL omitted") from None
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    return images
