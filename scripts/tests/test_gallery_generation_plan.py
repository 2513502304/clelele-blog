"""Cost and selection invariants: no network or credentials required."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'lib'))
import gallery_generation_plan as planner
import gallery_generation as workflow
import pixai_generation as pixai

spec = importlib.util.spec_from_file_location('pipeline', ROOT / 'generate-style-examples.py')
pipeline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pipeline)


class PlanTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.items = [
            {'slug': '2026-09-20-aaaa1111', 'imageHash': 'aaaa1111'+'0'*56, 'date': '2026-09-19T16:00:00Z'},
            {'slug': '2026-09-20-bbbb2222', 'imageHash': 'bbbb2222'+'0'*56, 'date': '2026-09-20T15:59:59Z'},
            {'slug': '2026-09-21-cccc3333', 'imageHash': 'cccc3333'+'0'*56, 'date': '2026-09-20T16:00:00Z'},
        ]
        self.config = {'version': 1, 'id': 'campaign',
            'characters': {'elaina': {'name': '伊蕾娜', 'tag': 'elaina', 'traits': '银发蓝眼'}},
            'profiles': {'four': {'provider': 'pixai', 'batch_size': 4}},
            'selections': [{'id': 'cards', 'select': {'hashes': ['aaaa1111']},
                'runs': [{'id': 'repeat', 'character': 'elaina', 'profile': 'four', 'tasksPerHash': 3}]}]}

    def resolve(self, slug, base, prompt_id=None):
        return {'slug': slug, 'promptId': prompt_id or 'a'*64, 'template': '[在此处替换为您想要生成的主体内容]，海边。'}

    def build(self, config=None):
        return planner.build(config or self.config, lambda _: {'items': self.items}, self.resolve)

    def config_file(self, config=None):
        path = self.root / 'config.json'
        workflow.save(path, config or self.config)
        return path

    def args(self, *extra):
        return pipeline.parser().parse_args(['--config', str(self.config_file()), '--output', str(self.root/'out'), *extra])

    def test_three_attempts_share_one_rewrite_and_request_twelve_images(self):
        plan = self.build()
        self.assertEqual(len(plan['rewrites']), 1)
        self.assertEqual(len({t['id'] for t in plan['tasks']}), 3)
        self.assertEqual(sum(t['parameters']['batch_size'] for t in plan['tasks']), 12)

    def test_explicit_runs_sum_instead_of_cartesian_product(self):
        self.config['profiles']['wide'] = {'ratio': '4:3'}
        self.config['selections'][0]['runs'].append({'id': 'wide', 'character': 'elaina', 'profile': 'wide', 'tasksPerHash': 2})
        plan = self.build()
        self.assertEqual(len(plan['rewrites']), 1)
        self.assertEqual(len(plan['tasks']), 5)

    def test_beijing_day_boundaries(self):
        rows = planner.select_cards(self.items, {'range': {'dateFrom': '2026-09-20', 'dateThrough': '2026-09-20', 'order': 'date-asc'}})
        self.assertEqual([r['slug'] for r in rows], [r['slug'] for r in self.items[:2]])

    def test_positions_after_exclusion_and_stable_ties(self):
        self.items[1]['date'] = self.items[0]['date']
        rows = planner.select_cards(list(reversed(self.items)), {'range': {'positions': [1,1]}, 'excludeHashes': ['cccc3333']})
        self.assertEqual(rows[0]['slug'], self.items[0]['slug'])

    def test_invalid_range_or_prefix_rejected(self):
        for selector in ({'hashes':['deadbeef']}, {'range':{'positions':[0,2]}},
                         {'range':{'positions':[1,10]}}, {'range':{'dateFrom':'2026-09-21','dateThrough':'2026-09-20'}},
                         {'hashes':['aaaa1111'],'range':{}}, {'hashes':['aaaa1111','aaaa1111']}):
            with self.subTest(selector=selector), self.assertRaises(ValueError):
                planner.select_cards(self.items, selector)
        self.items.append({**self.items[0], 'slug':'other'})
        with self.assertRaises(ValueError):
            planner.match_card(self.items, 'aaaa')

    def test_overlapping_groups_do_not_silently_add_paid_attempts(self):
        other = copy.deepcopy(self.config['selections'][0]); other['id'] = 'other'
        self.config['selections'].append(other)
        with self.assertRaisesRegex(ValueError, 'Overlapping'):
            self.build()

    def test_missing_variant_is_not_silently_chosen(self):
        with patch.object(pipeline, 'public_json', return_value={'slug':'2026-09-20-aaaa','prompts':[{'id':'a'*64,'prompt':'a'},{'id':'b'*64,'prompt':'b'}]}):
            with self.assertRaisesRegex(ValueError, 'promptId'):
                pipeline.resolve_source('2026-09-20-aaaa', 'https://example.com')
            self.assertEqual(pipeline.resolve_source('2026-09-20-aaaa', 'https://example.com', 'b'*64)['template'], 'b')

    def test_frozen_plan_never_requeries_live_catalog(self):
        path = self.config_file()
        plan = planner.frozen_plan(path, self.root/'out', lambda _: {'items':self.items}, self.resolve)
        with patch.object(pipeline, 'public_json', side_effect=AssertionError('network')):
            again = planner.frozen_plan(path, self.root/'out', pipeline.public_json, self.resolve)
        self.assertEqual(again['tasks'], plan['tasks'])
        self.config['selections'][0]['runs'][0]['tasksPerHash'] = 2
        self.config_file()
        with self.assertRaisesRegex(ValueError, 'changed'):
            planner.frozen_plan(path, self.root/'out', lambda _: {}, self.resolve)

    def test_split_files_resolve_from_config_directory(self):
        workflow.save(self.root/'characters.json', self.config.pop('characters'))
        self.config['charactersFile'] = 'characters.json'
        expanded = planner.config_input(self.config_file())
        self.assertEqual(expanded['characters']['elaina']['name'], '伊蕾娜')
        self.config['characters'] = {}
        with self.assertRaisesRegex(ValueError, 'either'):
            planner.config_input(self.config_file())

    def test_insufficient_budget_spends_no_text_or_image_calls(self):
        plan = self.build()
        with patch.object(pipeline.planner, 'frozen_plan', return_value=plan), patch.object(workflow, 'prepare') as text, patch.object(workflow, 'generate') as image:
            with self.assertRaisesRegex(ValueError, 'Budget insufficient'):
                pipeline.run(self.args('--apply','--max-tasks','2'))
        text.assert_not_called(); image.assert_not_called()

    def test_rewrite_only_needs_no_image_key_or_budget_even_for_external_profile(self):
        self.config['profiles']['four'] = {'provider':'external','model':'Nano Banana'}
        plan = self.build()
        with patch.object(pipeline.planner, 'frozen_plan', return_value=plan), \
                patch.object(workflow, 'prepare') as text, patch.object(workflow, 'generate') as image, \
                patch.object(pixai, 'credential', side_effect=AssertionError('image key lookup')):
            pipeline.run(self.args('--stage','rewrite','--apply'))
        self.assertEqual(text.call_count, 1); image.assert_not_called()

    def test_unsupported_automatic_provider_stops_before_text(self):
        self.config['profiles']['four'] = {'provider':'codex-imagegen'}
        with patch.object(pipeline.planner, 'frozen_plan', return_value=self.build()), patch.object(workflow,'prepare') as text:
            with self.assertRaisesRegex(ValueError, 'Automatic generation unavailable'):
                pipeline.run(self.args('--apply','--max-tasks','20'))
        text.assert_not_called()

    def test_config_business_cli_conflicts_rejected(self):
        with self.assertRaisesRegex(ValueError, 'cannot be combined'):
            pipeline.run(self.args('--ratio','4:3'))

    def test_rewrite_only_config_needs_no_generation_profile(self):
        run = self.config['selections'][0]['runs'][0]
        run.pop('profile');run.pop('tasksPerHash'); self.config.pop('profiles')
        self.assertEqual(self.build()['tasks'], [])

    def test_unknown_fields_and_boolean_counts_rejected(self):
        self.config['selections'][0]['runs'][0]['tasksPerHash'] = True
        with self.assertRaises(ValueError): self.build()

    def test_resume_binds_ledger_even_if_flag_is_omitted(self):
        ledger = (self.root / 'shared.json').resolve()
        self.assertEqual(pipeline.bound_ledger(self.root, str(ledger)), ledger)
        self.assertEqual(pipeline.bound_ledger(self.root, None), ledger)
        self.assertTrue(ledger.is_file())
        with self.assertRaisesRegex(ValueError, 'different PixAI ledger'):
            pipeline.bound_ledger(self.root, str(self.root/'other.json'))
        ledger.unlink()
        with self.assertRaisesRegex(ValueError, 'ledger is missing'):
            pipeline.bound_ledger(self.root, None)
        self.assertFalse(ledger.exists())
        self.config['selections'][0]['runs'][0]['tasksPerHash'] = 1
        self.config['selections'][0]['select']['tag'] = '插画'
        with self.assertRaises(ValueError): self.build()


if __name__ == '__main__':
    unittest.main()
