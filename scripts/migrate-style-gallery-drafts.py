"""Migrate the generation-drafts namespace with the authenticated Hugging Face CLI.

Run stage while the old origin is serving. After replacing all legacy writers,
run stage again, verify, then activate. The new origin waits for the ready marker.
Exercise owner-only previews and history in the deployed UI before running cleanup.
Use the same local, private checkpoint file for every invocation.
"""
import argparse
import fcntl
import hashlib
import json
import os
import re
import subprocess
import tempfile
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

DEFAULT_PREFIX = "image-style-prompt-gallery"


def hf(*args, data=None):
    """Avoid logging object names, signed URLs or record bodies on CLI errors."""
    result = subprocess.run(["hf", "buckets", *args], input=data, capture_output=True)
    if result.returncode:
        raise RuntimeError(f"HF buckets {args[0]} failed (exit {result.returncode}).")
    return result.stdout


def inventory(bucket, prefix):
    rows = json.loads(hf("list", bucket + "/" + prefix, "--recursive", "--no-truncate", "--format", "json") or "[]")
    files = {}
    for row in rows:
        if row["type"] != "file":
            continue
        path = row["path"]
        digest = row["xet_hash"]
        if (not path.startswith(prefix) or any(part in ("", ".", "..") for part in path.split("/"))
                or not re.fullmatch(r"[0-9a-f]{64}", digest) or row["size"] < 0 or path in files):
            raise RuntimeError("Unexpected bucket listing. No objects will be removed.")
        files[path] = [row["size"], digest]
    return files


def persist(path, state):
    """Atomically replace the checkpoint without making private key names world-readable."""
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as out:
        out.write(json.dumps(state).encode())
        out.flush()
        os.fsync(out.fileno())
    os.replace(out.name, path)


def uri(bucket, key):
    return f"hf://buckets/{bucket}/{key}"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("phase", choices=("stage", "verify", "activate", "cleanup"))
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("--source", default="clelele0722/raw-datasets")
    parser.add_argument("--destination", default="clelele0722/gallery-studio-private")
    parser.add_argument("--prefix", default=DEFAULT_PREFIX)
    args = parser.parse_args()
    # A stage and an activation sharing a checkpoint must never run concurrently.
    with open(str(args.checkpoint) + ".lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        migrate(args)


def migrate(args):
    src, dst = args.source, args.destination
    if not all(re.fullmatch(r"[a-zA-Z0-9_-]+", part) for part in args.prefix.split("/")):
        raise ValueError("Specify the Gallery prefix used by the deployed origin.")
    drafts = args.prefix + "/generation-drafts/"
    operations = args.prefix + "/operations/"
    marker = operations + "gallery-drafts-ready-v1"
    if src == dst or not all(re.fullmatch(r"[\w.-]+/[\w.-]+", name) for name in (src, dst)):
        raise ValueError("Specify two different HF bucket IDs.")
    if json.loads(hf("info", dst, "--format", "json")).get("private") is not True:
        raise ValueError("The destination must be a private bucket.")
    identity = [src, dst, drafts]
    state = json.loads(args.checkpoint.read_text()) if args.checkpoint.exists() else {"identity": identity, "known": {}}
    if state["identity"] != identity:
        raise ValueError("Checkpoint belongs to a different migration.")
    source, target = inventory(src, drafts), inventory(dst, drafts)
    active = marker in inventory(dst, operations)
    if args.phase == "cleanup":
        verified = state.get("verified")
        if not active or verified is None or any(verified.get(k) != v or target.get(k) != v for k, v in source.items()):
            raise RuntimeError("Cleanup requires a ready private copy matching every remaining verified source object.")
        # The rollout must have retired legacy writers. Remove exact verified keys only.
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda k: hf("remove", src + "/" + k, "--yes", "--quiet"), source))
        if inventory(src, drafts):
            raise RuntimeError("Legacy objects remain. Recheck before retrying cleanup.")
        print(f"Removed {len(source)} verified legacy objects. Source namespace is empty.")
        return
    if active:
        raise RuntimeError("The private store is active. Further staging could overwrite live drafts.")
    if args.phase == "stage":
        known = state["known"]
        # A previous run may have been interrupted after copying some planned revisions.
        # Stop on foreign destination data instead of overwriting it.
        if any(target[k] != source.get(k) and target[k] not in known.get(k, []) for k in target):
            raise RuntimeError("Unrecognized destination revision. Reconcile before staging.")
        for key, revision in target.items():
            if revision == source.get(key) and revision not in known.setdefault(key, []):
                known[key].append(revision)
        state.pop("verified", None)
        # A live source may change after listing. Pin a private, run-owned snapshot
        # before copying to the real key. On restart we can recognize exactly which
        # destination revisions we wrote, even when a copy acknowledgement was lost.
        scratch_id = state.setdefault("scratchId", uuid.uuid4().hex)
        scratch = operations + "draft-migrations/" + uuid.UUID(scratch_id).hex + "/"
        persist(args.checkpoint, state)
        changed = {k: scratch + hashlib.sha256(k.encode()).hexdigest() for k in source if source[k] != target.get(k)}
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda k: hf("cp", uri(src, k), uri(dst, changed[k]), "--quiet"), changed))
            pinned = inventory(dst, scratch)
            for key, name in changed.items():
                revision = pinned[name]
                if revision not in known.setdefault(key, []):
                    known[key].append(revision)
            # A crash after this checkpoint can only leave a previously known revision
            # or the pinned one in the destination, independent of later source edits.
            persist(args.checkpoint, state)
            list(pool.map(lambda k: hf("cp", uri(dst, changed[k]), uri(dst, k), "--quiet"), changed))
            list(pool.map(lambda k: hf("remove", dst + "/" + k, "--yes", "--quiet"), target.keys() - source.keys()))
            list(pool.map(lambda k: hf("remove", dst + "/" + k, "--yes", "--quiet"), pinned))
        source, target = inventory(src, drafts), inventory(dst, drafts)
    if source != target:
        raise RuntimeError("Listings differ. Stage again before activation.")
    if args.phase in ("verify", "activate") and state.get("scratchId"):
        scratch = operations + "draft-migrations/" + uuid.UUID(state["scratchId"]).hex + "/"
        if inventory(dst, scratch):
            raise RuntimeError("An interrupted stage has temporary copies. Run stage to reconcile them.")
    if args.phase == "activate":
        if state.get("verified") != source:
            raise RuntimeError("Run verify against the final quiescent source before activation.")
        hf("cp", "-", uri(dst, marker), "--quiet", data=b"v1\n")
    elif args.phase == "verify":
        state["verified"] = source
        persist(args.checkpoint, state)
    print(f"{args.phase}: {len(source)} objects, {sum(v[0] for v in source.values())} bytes; all Xet hashes match.")


if __name__ == "__main__":
    main()

