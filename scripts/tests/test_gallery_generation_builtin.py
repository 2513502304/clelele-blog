"""Offline regression checks for the paid-call boundary and immutable tool outputs."""
import base64
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

# Resolve the global skill symlink before looking for bundled or sibling resources.
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'lib'))
import builtin_receipt as bridge
import gallery_generation as workflow


class BuiltinReceiptTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.prepared = self.folder / 'prepared.json'
        workflow.save(self.prepared, {
            'id': 'sample',
            'source': {'slug': 'source', 'promptId': 'a' * 64, 'template': '[主体]，海边。'},
            'character': {'name': '伊蕾娜', 'tag': 'elaina', 'traits': '银发蓝眼'},
            'rewrite': {'provider': 'fixture', 'model': 'fixture', 'request': {},
                        'response': {}, 'prompt': '伊蕾娜，海边。'},
        })
        self.ledger = self.folder / 'ledger.json'
        self.provider = workflow.load_pixai()
        self.image = self.folder / 'actual.png'
        self.image.write_bytes(base64.b64decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6jGsAAAAASUVORK5CYII='))
        self.response = self.folder / 'response.json'
        workflow.save(self.response, {'output_hint': 'fixture output; model not reported'})

    def run_bridge(self, action, *extra):
        args = bridge.parser().parse_args([action, str(self.prepared), '--ledger', str(self.ledger),
                                          '--max-tasks', '1', *extra])
        with patch.object(bridge, 'load_pixai', return_value=self.provider):
            bridge.run(args)

    def record(self):
        self.run_bridge('record', '--image', str(self.image), '--response-json', str(self.response))

    def test_builtin_without_api_key_preserves_exact_bytes_and_unknown_model(self):
        with patch.dict(os.environ, {}, clear=True):
            self.run_bridge('reserve')
            self.record()
        receipt = workflow.read(self.folder / 'builtin/receipt.json')
        self.assertEqual(Path(receipt['outputs'][0]['file']).read_bytes(), self.image.read_bytes())
        self.assertEqual(receipt['generation']['model'], 'builtin-unspecified')
        self.assertEqual(receipt['generation']['request'], {'prompt': '伊蕾娜，海边。'})
        self.assertEqual(receipt['generation']['response'], workflow.read(self.response))

    def test_duplicate_reservation_is_rejected_and_record_is_idempotent(self):
        self.run_bridge('reserve')
        with self.assertRaises((self.provider.PixAIError, ValueError)):
            self.run_bridge('reserve')
        self.record()
        first = (self.folder / 'builtin/receipt.json').read_bytes()
        self.record()
        self.assertEqual((self.folder / 'builtin/receipt.json').read_bytes(), first)
        self.assertEqual(len(workflow.read(self.ledger)['attempts']), 1)

    def test_changed_prompt_cannot_reuse_reservation(self):
        self.run_bridge('reserve')
        prepared = workflow.read(self.prepared)
        prepared['rewrite']['prompt'] += '改变背景。'
        workflow.save(self.prepared, prepared)
        with self.assertRaisesRegex(ValueError, 'changed since reservation'):
            self.record()

    def test_planned_builtin_repeats_have_independent_ids_and_output_paths(self):
        with patch.object(bridge, 'load_pixai', return_value=self.provider):
            for number in range(3):
                options = ['--task-id',f'planned-{number}','--task-output',str(self.folder/'tasks'/str(number))]
                args = ['reserve',str(self.prepared),'--ledger',str(self.ledger),'--max-tasks','3',*options]
                bridge.run(bridge.parser().parse_args(args))
                args[0] = 'record'
                bridge.run(bridge.parser().parse_args([*args,'--image',str(self.image),'--response-json',str(self.response)]))
                receipt = workflow.read(self.folder/'tasks'/str(number)/'receipt.json')
                self.assertEqual(receipt['id'],f'planned-{number}')
        self.assertEqual(len(workflow.read(self.ledger)['attempts']),3)

    def test_modified_output_is_detected_on_resume(self):
        self.run_bridge('reserve')
        self.record()
        (self.folder / 'builtin/image.png').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'missing or changed'):
            self.record()


if __name__ == '__main__':
    unittest.main()
