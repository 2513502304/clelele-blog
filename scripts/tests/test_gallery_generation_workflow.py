import importlib.util
import json
import os
from pathlib import Path
import unittest
import tempfile
from io import StringIO
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('workflow', Path(__file__).resolve().parents[1] / 'lib/gallery_generation.py')
workflow = importlib.util.module_from_spec(spec)
spec.loader.exec_module(workflow)

class WorkflowTests(unittest.TestCase):
    def prepared_job(self, folder):
        path = Path(folder) / 'prepared.json'
        workflow.save(path, {
            'id': 'fixture-character',
            'source': {'slug': 'fixture-source', 'promptId': 'a' * 64, 'template': '[主体]，站在海边。'},
            'character': {'name': '伊蕾娜', 'tag': 'elaina', 'traits': '银发，蓝眼'},
            'rewrite': {'provider': 'fixture', 'model': 'fixture', 'request': {}, 'response': {},
                        'prompt': '伊蕾娜，站在海边。'},
        })
        return path

    def generation_args(self, prepared, provider, ledger, *extra):
        return workflow.parser().parse_args([
            'generate', str(prepared), '--provider', provider, '--ledger', str(ledger),
            '--max-tasks', '1', '--apply', *extra,
        ])

    def test_only_character_name_changes(self):
        self.assertEqual(workflow.provider_prompt('Ann meets Annette. Ann smiles.', {'name': 'Ann', 'tag': 'A'}),
                         'A meets Annette. A smiles.')
        with self.assertRaises(ValueError):
            workflow.provider_prompt('Annette smiles.', {'name': 'Ann', 'tag': 'A'})
        self.assertEqual(workflow.provider_prompt('喜多郁代，玫红头发。\n海边，喜多郁代。',
                        {'name': '喜多郁代', 'tag': 'kita ikuyo'}), 'kita ikuyo，玫红头发。\n海边，kita ikuyo。')
        with self.assertRaises(ValueError):
            workflow.provider_prompt('喜多郁代 [在此处替换文字]', {'name':'喜多郁代','tag':'kita ikuyo'})
    def test_receipts_are_private(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'receipt.json'
            workflow.save(path, {'private':'data'})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(workflow.read(path), {'private':'data'})
    def test_inputs_identify_configuration_changes(self):
        self.assertNotEqual(workflow.fingerprint({'seed': 1}), workflow.fingerprint({'seed': 2}))
    def test_path_escape_is_rejected(self):
        with self.assertRaises(ValueError):
            workflow.validate_job({'id': '../../escape'})

    def test_missing_pixai_key_does_not_reserve_attempt(self):
        with tempfile.TemporaryDirectory() as folder:
            prepared = self.prepared_job(folder)
            ledger = Path(folder) / 'ledger.json'
            provider = workflow.load_pixai()
            args = self.generation_args(prepared, 'pixai', ledger)
            with patch.object(workflow, 'load_pixai', return_value=provider), \
                    patch.object(provider, 'credential', return_value=''):
                with self.assertRaisesRegex(ValueError, 'no paid attempt was reserved'):
                    workflow.generate(args)
            self.assertFalse(ledger.exists())

    def test_openai_disables_prompt_augmentation_and_records_exact_prompt(self):
        with tempfile.TemporaryDirectory() as folder:
            prepared = self.prepared_job(folder)
            ledger = Path(folder) / 'ledger.json'
            imagegen = Path(folder) / 'imagegen'
            (imagegen / 'scripts').mkdir(parents=True)
            (imagegen / 'scripts/image_gen.py').touch()
            provider = workflow.load_pixai()
            args = self.generation_args(prepared, 'openai', ledger, '--imagegen-skill', str(imagegen), '--model', 'fixture-model')
            commands = []

            def fake_run(command, **kwargs):
                commands.append(command)
                Path(command[command.index('--out') + 1]).write_bytes(b'fixture-image')
                Path(command[3]).write_text(json.dumps({'response': 'fixture'}), encoding='utf-8')

            with patch.object(workflow, 'load_pixai', return_value=provider), \
                    patch.object(workflow.subprocess, 'run', side_effect=fake_run), \
                    patch.object(workflow.importlib.util, 'find_spec', return_value=object()), \
                    patch.dict(os.environ, {'OPENAI_API_KEY': 'fixture-key'}):
                workflow.generate(args)

            self.assertEqual(len(commands), 1)
            self.assertIn('--no-augment', commands[0])
            self.assertEqual(Path(commands[0][commands[0].index('--prompt-file') + 1]).read_text(),
                             '伊蕾娜，站在海边。')
            receipt = workflow.read(Path(folder) / 'openai/receipt.json')
            self.assertEqual(receipt['generation']['prompt'], '伊蕾娜，站在海边。')
            self.assertEqual(receipt['generation']['response'], {'response': 'fixture'})
            self.assertEqual(workflow.read(ledger)['attempts'][0]['state'], 'complete')
            args.task_id = 'different-task'
            with self.assertRaisesRegex(ValueError, 'inputs changed'):
                workflow.generate(args)
            self.assertEqual(len(commands), 1)

    def test_openai_requires_explicit_api_model_before_reservation(self):
        with tempfile.TemporaryDirectory() as folder:
            prepared = self.prepared_job(folder)
            ledger = Path(folder) / 'ledger.json'
            args = self.generation_args(prepared, 'openai', ledger)
            with self.assertRaisesRegex(ValueError, 'Supply an API model ID'):
                workflow.generate(args)
            self.assertFalse(ledger.exists())

    def test_invalid_rewrite_response_is_reused_without_another_paid_post(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.prepared_job(folder)
            job = workflow.read(path); job.pop('rewrite')
            jobs = Path(folder)/'jobs.json'; workflow.save(jobs, [job])
            args = workflow.parser().parse_args(['prepare',str(jobs),'--output',str(Path(folder)/'out'),'--apply'])
            class Opener:
                calls = 0
                def open(self, *args, **kwargs):
                    self.calls += 1
                    return StringIO(json.dumps({'choices':[{'message':{'content':'not JSON'}}]}))
            opener = Opener()
            with patch.object(workflow, 'build_opener', return_value=opener), patch.dict(os.environ, {'DEEPSEEK_API_KEY':'fixture'}):
                for _ in range(2):
                    with self.assertRaises(ValueError): workflow.prepare(args)
            self.assertEqual(opener.calls, 1)

    def test_unknown_text_attempt_is_not_automatically_submitted_again(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.prepared_job(folder)
            job = workflow.read(path); job.pop('rewrite')
            jobs = Path(folder)/'jobs.json'; workflow.save(jobs,[job])
            workflow.save(Path(folder)/'out'/job['id']/'rewrite-attempt.json', {'state':'unknown'})
            args = workflow.parser().parse_args(['prepare',str(jobs),'--output',str(Path(folder)/'out'),'--apply'])
            with patch.object(workflow,'build_opener') as network, self.assertRaisesRegex(ValueError,'outcome unknown'):
                workflow.prepare(args)
            network.assert_not_called()

if __name__ == '__main__': unittest.main()
