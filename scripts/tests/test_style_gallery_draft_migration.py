import contextlib
import hashlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("migration", Path(__file__).parents[1] / "migrate-style-gallery-drafts.py")
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


class GalleryMigrationTest(unittest.TestCase):
    def test_cutover_reconciles_legacy_changes_and_cleanup_requires_intact_private_copies(self):
        src, dst = "owner/old", "owner/new"
        first, second = "gallery/generation-drafts/one", "gallery/generation-drafts/two"
        buckets = {src: {first: b"v1", second: b"old", "gallery/public": b"keep"}, dst: {}}

        change_during_copy = True
        interrupt = True

        def split(path):
            owner, bucket, key = path.removeprefix("hf://buckets/").split("/", 2)
            return buckets[f"{owner}/{bucket}"], key

        def hf(cmd, *argv, data=None):
            nonlocal change_during_copy, interrupt
            if cmd == "info":
                return json.dumps({"private": argv[0] == dst})
            if cmd == "list":
                bucket, prefix = split(argv[0])
                return json.dumps([dict(type="file", path=k, size=len(v), xet_hash=hashlib.sha256(v).hexdigest())
                                   for k, v in bucket.items() if k.startswith(prefix)])
            if cmd == "remove":
                bucket, key = split(argv[0])
                del bucket[key]
            if cmd == "cp":
                bucket, key = split(argv[1])
                if data is None:
                    origin, name = split(argv[0])
                    if origin is buckets[src] and name == first and change_during_copy:
                        origin[name] = b"changed during copy"
                        change_during_copy = False
                    data = origin[name]
                bucket[key] = data
                if key == first and interrupt:
                    interrupt = False
                    raise RuntimeError("Lost copy acknowledgement")

        with tempfile.TemporaryDirectory() as tmp, patch.object(migration, "hf", hf), contextlib.redirect_stdout(io.StringIO()):
            args = SimpleNamespace(source=src, destination=dst, prefix="gallery", checkpoint=Path(tmp) / "ledger")

            def run(phase):
                args.phase = phase
                migration.migrate(args)

            with self.assertRaisesRegex(RuntimeError, "Lost copy acknowledgement"):
                run("stage")
            buckets[src][first] = b"changed again before restart"
            run("stage")
            with self.assertRaisesRegex(RuntimeError, "verify"):
                run("activate")
            del buckets[src][second]
            buckets[src][first] = b"v2"
            run("stage")
            self.assertNotIn(second, buckets[dst])
            run("verify")
            run("activate")
            buckets[dst][first] = b"new revision"
            with self.assertRaisesRegex(RuntimeError, "active"):
                run("stage")
            with self.assertRaisesRegex(RuntimeError, "matching"):
                run("cleanup")
            self.assertEqual(buckets[src][first], b"v2")
            buckets[dst][first] = b"v2"
            run("cleanup")
            run("cleanup")
            self.assertEqual(buckets[src], {"gallery/public": b"keep"})

