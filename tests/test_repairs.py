import copy
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from dataclasses import asdict, replace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import build_runs
from analyzer import attribution, confidence, impact, narrate, pairwise
from engine import cache, cli, decide, llm, loop, prompt
from engine.loader import load_chain, load_shops, load_twins
from engine.resolve import resolve
from engine.schema import Disruption, validate_row
from tools import validate

GOOD = {
    'choice': 'starbucks', 'primary_driver': 'hours', 'secondary_driver': 'curiosity',
    'valence': 0.7, 'reasoning': 'My usual shop is shut, so I tried Starbucks.',
}
USAGE = {'input_tokens': 100, 'output_tokens': 20}
FIX = ROOT / 'tests' / 'fixtures' / 'runs'


class Repairs(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.out = Path(self.tmp.name)
        self.shops = load_shops()
        self.twins = load_twins(shop_ids=frozenset(self.shops))
        self.twin = next(t for t in self.twins if t.id == 'T01')
        self.today = resolve(self.shops, load_chain('baseline'), 4)
        self.state = {'habit': dict(self.twin.mechanism['habit']),
                      'latent_interest': dict(self.twin.mechanism['latent_interest']), 'history': []}
        self.rows = [build_runs.load_rows(FIX, 'baseline', s) for s in range(5)]
        self.records = {t.id: asdict(t) for t in self.twins}
        self.client_guard = patch.object(llm, 'client', side_effect=AssertionError('unexpected network path'))
        self.client_guard.start()
        self.addCleanup(self.client_guard.stop)
        decide.reset_stats()

    def decision(self, twin=None, state=None, **kwargs):
        return decide.reappraise(twin or self.twin, state or self.state, self.today,
                                 Disruption(1.0, 'hours'), 'simffee', None, 4, 'baseline', 0,
                                 cache_dir=self.out / 'cache', **kwargs)

    def test_repeat_visitors_reach_deliberation_for_positive_and_negative_experience(self):
        for valence, choice in [(0.7, 'starbucks'), (-0.7, 'none')]:
            with self.subTest(valence=valence):
                state = copy.deepcopy(self.state)
                state['latent_interest']['starbucks'] = 0.0
                state['history'] = [{'day': 3, 'choice': 'starbucks', 'valence': valence,
                                     'reasoning': 'A previous visit.'}]
                reply = {**GOOD, 'choice': choice, 'valence': valence}
                with patch.object(llm, 'complete_json', return_value=(reply, USAGE)) as transport:
                    result = self.decision(state=state)
                self.assertEqual(transport.call_count, 1)
                self.assertEqual(result['choice'], choice)

    def test_untried_low_interest_still_skips(self):
        twin = replace(self.twin, what_log=[])
        state = {**self.state, 'latent_interest': {'simffee': 0.0, 'starbucks': 0.1}}
        with patch.object(llm, 'complete_json') as transport:
            result = self.decision(twin=twin, state=state)
        self.assertEqual(result['choice'], 'none')
        self.assertFalse(result['llm_failed'])
        transport.assert_not_called()

    def test_visit_record_survives_short_memory_and_snapshot(self):
        state = loop.init_state(self.twins)
        with patch.object(llm, 'complete_json', return_value=(GOOD, USAGE)):
            import random
            rng = random.Random(0)
            loop.run_day(4, self.twins, state, self.today, self.shops, rng, 'baseline', 0,
                         cache_dir=self.out / 'cache')
            self.assertIn('starbucks', state['visited']['T01'])
            state['history']['T01'] = []
            loop.save_snapshot(state, self.out, 'baseline', 0, 4, rng)
            restored, _ = loop.load_snapshot(self.out, 'baseline', 0, 4)
            self.assertEqual(restored['visited'], state['visited'])
            view = loop._twin_view(restored, 'T01')
            result = self.decision(state=view)
            self.assertEqual(result['choice'], 'starbucks')

    def test_closed_shop_rejected_and_autopilot_preserved(self):
        with self.assertRaises(ValueError):
            decide._validate({**GOOD, 'choice': 'simffee'}, self.twin, self.today)
        self.assertEqual(decide.autopilot(self.twin, 'simffee', self.shops)['choice'], 'simffee')
        self.assertEqual(decide.autopilot(self.twin, 'simffee', self.today)['choice'], 'none')
        closed = copy.deepcopy(self.today)
        closed['starbucks']['permanently_closed'] = True
        with self.assertRaises(ValueError):
            decide._validate(GOOD, self.twin, closed)

    def render(self, twin, shops, source):
        options = decide.options_block(twin, self.state, shops)
        return prompt.build(twin, options, 0.7, source, 'simffee', [], shops)

    def test_prompt_only_claims_verified_unavailability(self):
        for source in ('price', 'wait'):
            with self.subTest(source=source):
                text = self.render(self.twin, self.shops, source)
                self.assertNotIn('cannot serve you today', text)
        self.assertIn('cannot serve you today', self.render(self.twin, self.today, 'hours'))
        products = copy.deepcopy(self.shops)
        products['simffee']['products'].remove(self.twin.usual_order)
        text = self.render(self.twin, products, 'product')
        self.assertIn('no latte on the menu', text)
        self.assertNotIn('Your usual place cannot serve you today', text)

    def test_prompt_includes_behavior_log_and_no_invented_endorsement(self):
        twin = replace(self.twin, say_do_gap={'says': 'I try everything.', 'log_shows': 'Thirty identical purchases.'})
        text = self.render(twin, self.today, 'hours')
        self.assertIn('Thirty identical purchases.', text)
        words = prompt._latent_in_words(0.8, 'Starbucks', twin, 'starbucks')
        self.assertNotIn('colleague', words)
        self.assertNotIn('heard good things', words)

    def test_cache_invalidates_each_decision_input(self):
        with patch.object(llm, 'complete_json', return_value=(GOOD, USAGE)) as transport:
            self.decision()
            self.decision(offline=True)
            self.assertEqual(transport.call_count, 1)
            changes = [
                {'twin': replace(self.twin, profile={**self.twin.profile, 'daily_budget_vnd': 1000})},
                {'twin': replace(self.twin, why_transcript=[{'q': 'Coffee?', 'a': 'I dislike Starbucks.'}])},
                {'state': {**self.state, 'history': [{'day': 3, 'choice': 'none', 'valence': -0.5, 'reasoning': 'No coffee.'}]}},
            ]
            for index, args in enumerate(changes, 2):
                self.decision(**args)
                self.assertEqual(transport.call_count, index)
            with patch.object(llm, 'MODEL', 'different-test-model'):
                self.decision()
            with patch.object(llm, 'MAX_TOKENS', llm.MAX_TOKENS + 1):
                self.decision()
            with patch.object(prompt, 'SYSTEM', prompt.SYSTEM + '\nDifferent policy.'):
                self.decision()
            with patch.object(prompt, 'response_schema', return_value={'type': 'object'}):
                self.decision()
            self.assertEqual(transport.call_count, 8)

    def test_malformed_and_invalid_cache_entries_fall_back_safely(self):
        with patch.object(llm, 'complete_json', return_value=(GOOD, USAGE)):
            self.decision()
        path = next((self.out / 'cache').glob('*.json'))
        original = json.loads(path.read_text())
        for content in ['not json', '[]', json.dumps({**original, 'choice': 'simffee'}),
                        json.dumps({**original, '_model': 'wrong-model'}),
                        json.dumps({**original, 'reasoning': 'word ' * 55})]:
            with self.subTest(content_kind=content[:12]):
                path.write_text(content)
                self.assertTrue(self.decision(offline=True)['llm_failed'])

    def test_legacy_cache_key_is_not_reused(self):
        legacy = cache.key(self.twin.id, 4, 'baseline', 0,
                           {'habit': self.state['habit'], 'latent_interest': self.state['latent_interest']}, self.today)
        cache.put(legacy, {**GOOD, 'llm_failed': False}, self.out / 'cache')
        self.assertTrue(self.decision(offline=True)['llm_failed'])

    def test_reasoning_limit_and_error_sanitization(self):
        result = decide._validate({**GOOD, 'reasoning': 'word ' * 55}, self.twin, self.today)
        self.assertLessEqual(len(result['reasoning'].split()), 40)
        with patch.object(llm, 'complete_json', side_effect=RuntimeError('PRIVATE_ERROR_MARKER ' * 60)):
            result = self.decision()
        self.assertTrue(result['llm_failed'])
        self.assertNotIn('PRIVATE_ERROR_MARKER', result['reasoning'])
        self.assertLessEqual(len(result['reasoning'].split()), 40)
        row = {**self.rows[0][30], 'reasoning': 'word ' * 55}
        self.assertTrue(validate_row(row, frozenset(self.shops)))

    def test_validator_supports_external_files_and_reports_multiple_rows(self):
        path = self.out / '0.jsonl'
        path.write_text('\n'.join(json.dumps(r) for r in self.rows[0]) + '\n')
        errors = []
        self.assertEqual(validate.check_file(path, set(self.records), set(self.shops), errors), 70)
        self.assertEqual(errors, [])
        for n in range(2):
            validate.check_row({**self.rows[0][n], 'primary_driver': 'invalid'},
                               set(self.records), set(self.shops), str(n), errors)
        self.assertEqual(len(errors), 2)

    def test_confidence_requires_enough_reappraisal_seeds(self):
        for usable in range(4):
            with self.subTest(usable=usable):
                sparse = [[{**r, 'llm_failed': not (r['twin'] == 'T01' and seed < usable)}
                           if r['mode'] == 'reappraisal' else dict(r) for r in rs]
                          for seed, rs in enumerate(self.rows)]
                result = confidence.confidence(sparse, 4, self.records)
                self.assertEqual(result['unmeasured'], usable < 3)
                self.assertEqual(result['detail']['stability']['per_twin']['T01']['seeds_used'], usable)
                if usable < 3:
                    self.assertIsNone(result['value'])
                else:
                    self.assertIsNotNone(result['value'])
                    self.assertTrue(result['reason'])

    def test_fallbacks_cannot_become_causal_evidence(self):
        bad = [{**r, 'llm_failed': True} if r['day'] == 4 else r for r in self.rows[0]]
        self.assertIsNone(attribution.actual_driver(bad, 4)['driver'])
        self.assertEqual(attribution.select_evidence(bad, 4, 'hours', 'simffee'), [])
        control = build_runs.load_rows(FIX, 'cf_null', 0)
        self.assertIsNone(impact.impact(bad, control, 'simffee')['lost_by_decision'])
        self.assertIsNone(pairwise.returns(bad, control, 'simffee')['returns'])

    def test_incomplete_bundle_suppresses_claims_and_narration(self):
        def load(base, scenario, seed):
            rs = build_runs.load_rows(FIX, scenario, seed)
            if scenario == 'cf_null':
                rs = [{**r, 'llm_failed': True} if r['day'] == 6 else r for r in rs]
            return rs
        original = build_runs.load_rows
        def patched_load(base, scenario, seed):
            with patch.object(build_runs, 'load_rows', original):
                return load(base, scenario, seed)
        scenarios = {sid: json.loads((ROOT / 'data' / 'scenarios' / f'{sid}.json').read_text())
                     for sid in cli.ALL_SCENARIOS}
        with patch.object(build_runs, 'load_rows', side_effect=patched_load):
            result = build_runs.build_analysis(FIX, self.shops, scenarios, self.records)
        self.assertFalse(result['complete'])
        self.assertIsNone(result['impact'])
        self.assertIsNone(result['narration'])

    def test_cli_strict_completeness_and_per_seed_coverage(self):
        args = ['engine.cli', '--scenario', 'baseline', '--seeds', '0', '--offline',
                '--out', str(self.out / 'runs'), '--cache', str(self.out / 'empty'), '--require-complete', '--quiet']
        output = io.StringIO()
        with patch.object(sys, 'argv', args), redirect_stdout(output):
            code = cli.main()
        self.assertEqual(code, 2)
        self.assertIn('baseline seed 0', output.getvalue())
        self.assertIn('incomplete', output.getvalue().lower())

    def test_build_cli_is_offline_configurable_and_strict(self):
        out = self.out / 'bundle.json'
        args = ['build_runs.py', str(FIX), '--out', str(out), '--offline']
        with patch.object(sys, 'argv', args), redirect_stdout(io.StringIO()):
            self.assertEqual(build_runs.main(), 0)
        doc = json.loads(out.read_text())
        self.assertIn('coverage', doc['meta'])
        self.assertFalse(doc['meta']['publishable'])
        with patch.object(sys, 'argv', args + ['--require-complete']), redirect_stdout(io.StringIO()):
            self.assertEqual(build_runs.main(), 2)

    def test_invalid_reply_shapes_get_validation_retry(self):
        bad_replies = [{**GOOD, 'choice': []}, {**GOOD, 'primary_driver': []},
                       {**GOOD, 'secondary_driver': []},
                       {k: v for k, v in GOOD.items() if k != 'secondary_driver'}]
        for index, bad in enumerate(bad_replies):
            with self.subTest(index=index), patch.object(llm, 'complete_json', side_effect=[(bad, USAGE), (GOOD, USAGE)]) as transport:
                state = {**self.state, 'history': [{'day': index, 'choice': 'none', 'valence': 0, 'reasoning': 'Test memory.'}]}
                result = self.decision(state=state)
                self.assertFalse(result['llm_failed'])
                self.assertEqual(transport.call_count, 2)

    def test_malformed_rows_do_not_stop_validation(self):
        errors = []
        validate.check_row({**self.rows[0][0], 'twin': []}, set(self.records), set(self.shops), 'bad twin', errors)
        self.assertTrue(errors)
        path = self.out / 'malformed.jsonl'
        bad = {**self.rows[0][1], 'primary_driver': 'invalid'}
        path.write_text('not json\n' + json.dumps(bad) + '\n' + json.dumps(bad) + '\n')
        errors = []
        validate.check_file(path, set(self.records), set(self.shops), errors)
        self.assertGreaterEqual(sum('bad primary_driver' in e for e in errors), 2)

    def test_short_run_is_not_complete(self):
        args = ['engine.cli', '--days', '1', '--offline', '--quiet', '--require-complete',
                '--out', str(self.out / 'short'), '--cache', str(self.out / 'empty')]
        with patch.object(sys, 'argv', args), redirect_stdout(io.StringIO()):
            self.assertEqual(cli.main(), 2)

    def test_repeated_same_seed_does_not_inflate_sample_count(self):
        result = confidence.confidence([self.rows[0]] * 5, 4, self.records)
        self.assertTrue(result['unmeasured'])
        self.assertEqual(result['detail']['stability']['per_twin']['T01']['seeds_used'], 1)

    def test_removed_product_uses_actual_available_price(self):
        shop = copy.deepcopy(self.shops['simffee'])
        shop['products'].remove(self.twin.usual_order)
        expected = min(shop['price'][p] for p in shop['products'])
        self.assertEqual(decide.price_for(self.twin, shop), expected)

    def test_invalid_json_usage_is_still_counted(self):
        llm.reset_stats()
        response = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='not JSON'))],
                                   usage=SimpleNamespace(prompt_tokens=17, completion_tokens=9))
        with patch.object(llm, '_create_with_backoff', return_value=response):
            with self.assertRaises(ValueError):
                llm.complete_json('system', 'user', {}, 0.7)
        self.assertEqual(llm.STATS['input_tokens'], 17)
        self.assertEqual(llm.STATS['output_tokens'], 9)

    def test_narration_is_deterministic_and_bound_to_facts(self):
        analysis = {'break_day': 4, 'complete': True,
                    'naive': {'driver': 'price', 'label': 'Price +3k'},
                    'actual': {'driver': 'hours', 'switchers': ['T01']},
                    'impact': {'lost_total': 6, 'lost_by_decision': 6, 'lost_anyway': 0},
                    'confidence': {'unmeasured': False, 'value': 0.8}}
        with patch.object(llm, 'complete_json', side_effect=AssertionError('narration must be offline')) as transport:
            result = narrate.narrate(analysis)
        transport.assert_not_called()
        self.assertIsNotNone(result['narration'])
        self.assertIn('6 customers', result['narration'])
        self.assertNotIn('3 customers', result['narration'])
        self.assertIn('opening hours', result['narration'])
        self.assertEqual(len([s for s in result['narration'].split('.') if s.strip()]), 2)
        self.assertIsNone(narrate.narrate({**analysis, 'complete': False})['narration'])


class TransportRepairs(unittest.TestCase):
    def response(self, content=None):
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content or json.dumps(GOOD)))],
                               usage=SimpleNamespace(prompt_tokens=10, completion_tokens=5))

    def test_unsupported_capabilities_are_removed_persistently(self):
        requests = []
        def create(**request):
            requests.append(request)
            if 'temperature' in request:
                raise ValueError('temperature is not supported')
            if 'response_format' in request:
                raise ValueError('response_format is not supported')
            return self.response()
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
        with patch.object(llm, 'client', return_value=client), patch.object(llm, '_pace'), \
                patch.object(llm, '_temperature_ok', None), patch.object(llm, '_structured_ok', None):
            llm.complete_json('system', 'user', {}, 0.7)
            llm.complete_json('system', 'user', {}, 0.3)
        self.assertIn('response_format', requests[0])
        self.assertEqual(len(requests), 4)
        self.assertNotIn('temperature', requests[-1])
        self.assertNotIn('response_format', requests[-1])

    def test_json_errors_do_not_echo_model_content(self):
        with patch.object(llm, '_create_with_backoff', return_value=self.response('PRIVATE_RESPONSE_MARKER')):
            with self.assertRaises(ValueError) as caught:
                llm.complete_json('system', 'user', {}, 0.7)
        self.assertNotIn('PRIVATE_RESPONSE_MARKER', str(caught.exception))

    def test_credentials_required_without_embedded_fallback(self):
        factory = Mock()
        with patch.dict(os.environ, {}, clear=True), patch.dict(sys.modules, {'groq': SimpleNamespace(Groq=factory)}), \
                patch.object(llm, '_client', None), patch.object(llm, '_client_error', None):
            with self.assertRaises(llm.LLMUnavailable):
                llm.client()
        self.assertEqual(factory.call_count, 0)

    def test_rate_limit_backoff_is_bounded(self):
        create = Mock(side_effect=RuntimeError('429 rate_limit Please try again in 0.1s'))
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
        with patch.object(llm, 'client', return_value=client), patch.object(llm, '_pace'), patch.object(llm.time, 'sleep'):
            with self.assertRaises(RuntimeError):
                llm._create_with_backoff({})
        self.assertEqual(create.call_count, llm.RATE_LIMIT_RETRIES)


if __name__ == '__main__':
    unittest.main()
