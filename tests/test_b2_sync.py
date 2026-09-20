import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest
from dataclasses import asdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import build_runs
from analyzer import confidence, pairwise
from engine.loader import load_shops, load_twins

FIX = ROOT / 'tests/fixtures/runs'


class B2Integration(unittest.TestCase):
    def setUp(self):
        self.shops = load_shops()
        self.twins = {t.id: asdict(t) for t in load_twins(shop_ids=frozenset(self.shops))}
        self.baseline = build_runs.load_rows(FIX, 'baseline', 0)
        self.lost = pairwise.lost(self.baseline, 'simffee')
        self.branches = [build_runs.load_rows(FIX, 'cf_discount', seed) for seed in range(5)]

    def test_upstream_branch_confidence_and_cohort_are_preserved(self):
        result = confidence.whatif_confidence(self.branches, self.lost, 5, 7, self.twins)
        self.assertFalse(result['unmeasured'])
        self.assertEqual(set(result['detail']['stability']['per_twin']), set(self.lost))
        self.assertEqual(result['value'], round(0.7 * result['stability'] + 0.3 * result['support'], 4))

    def test_branch_confidence_requires_three_usable_seeds(self):
        for usable in range(4):
            with self.subTest(usable=usable):
                rows = [[{**r, 'llm_failed': seed >= usable} if r['mode'] == 'reappraisal' else dict(r)
                         for r in rs] for seed, rs in enumerate(self.branches)]
                result = confidence.whatif_confidence(rows, self.lost, 5, 7, self.twins)
                self.assertEqual(result['unmeasured'], usable < 3)
                if usable < 3:
                    self.assertIsNone(result['value'])

    def test_prior_fallback_invalidates_later_autopilot_outcome(self):
        rows = copy.deepcopy(self.branches)
        for rs in rows:
            for r in rs:
                if r['day'] == 5 and r['twin'] == self.lost[0]:
                    r['llm_failed'] = True
                if r['day'] == 7:
                    r['llm_failed'] = False
                    r['mode'] = 'autopilot'
        result = confidence.whatif_confidence(rows, self.lost, 5, 7, self.twins)
        self.assertTrue(result['unmeasured'])
        self.assertIsNone(result['value'])

    def test_branch_default_seed_is_an_id_not_list_position(self):
        rows = copy.deepcopy(self.branches)
        for rs in rows:
            for r in rs:
                r['primary_driver'] = 'price' if r['seed'] == 4 else 'hours'
        shuffled = [rows[4], rows[0], rows[1], rows[2], rows[3]]
        result = confidence.whatif_confidence(shuffled, self.lost, 5, 7, self.twins, default_seed=4)
        self.assertTrue(result['detail']['support']['per_twin'])
        self.assertEqual({r['driver'] for r in result['detail']['support']['per_twin'].values()}, {'price'})

    def test_bundle_keeps_upstream_contract_and_local_details(self):
        scenarios = {f.stem: json.loads(f.read_text()) for f in (ROOT / 'data/scenarios').glob('*.json')}
        result = build_runs.build_analysis(FIX, self.shops, scenarios, self.twins)
        for row in result['impact']['per_twin']:
            self.assertIn('cf_null', row)
            self.assertNotIn('control', row)
        for button in result['whatif']:
            self.assertIn('confidence', button)
            detail = button['confidence_detail']
            self.assertIn('unmeasured', detail)
            self.assertIn('detail', detail)
            self.assertEqual(set(detail['detail']['stability']['per_twin']), set(self.lost))

    def test_empty_cohort_remains_unmeasured(self):
        result = confidence.whatif_confidence(self.branches, [], 5, 7, self.twins)
        self.assertTrue(result['unmeasured'])
        self.assertIsNone(result['value'])


class DemoCommand(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        fake = self.bin / 'python3'
        fake.write_text('printf "%s\\n" "$@" >> "$CALL_LOG"\n')
        fake.chmod(0o755)
        self.log = self.root / 'calls.log'
        self.env = {**os.environ, 'PATH': str(self.bin) + os.pathsep + os.environ['PATH'], 'CALL_LOG': str(self.log)}

    def test_demo_defaults_to_offline_strict_isolated_build(self):
        out = self.root / 'output'
        result = subprocess.run(['bash', str(ROOT / 'tools/build_demo.sh'), '--out', str(out),
                                 '--cache', str(self.root / 'cache')], cwd=ROOT, env=self.env,
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = self.log.read_text()
        self.assertGreaterEqual(calls.count('--offline'), 2)
        self.assertGreaterEqual(calls.count('--require-complete'), 2)
        self.assertIn(str(out / 'runs'), calls)
        self.assertIn(str(out / 'runs.json'), calls)

    def test_demo_refuses_nonempty_output(self):
        out = self.root / 'output'
        out.mkdir()
        (out / 'keep.txt').write_text('keep')
        result = subprocess.run(['bash', str(ROOT / 'tools/build_demo.sh'), '--out', str(out)],
                                cwd=ROOT, env=self.env, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.log.exists())
        self.assertEqual((out / 'keep.txt').read_text(), 'keep')


if __name__ == '__main__':
    unittest.main()
