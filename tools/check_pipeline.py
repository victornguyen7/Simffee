import argparse
import copy
import io
import json
import os
import subprocess
import sys
from collections import Counter
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import build_runs
from engine import decide, llm, loop
from engine.cli import ALL_SCENARIOS
from engine.loader import load_shops, load_twins
from engine.schema import SKIP_LATENT_FLOOR, coverage, validate_row
from tools.validate import check_file

MODEL = 'test-stub-pipeline-v1'


def stub(system, user, schema, temperature):
    options = [line for line in user.splitlines() if line.startswith('- **') and not line.startswith('- **Skip it')]
    available = [line for line in options if ' -- shut at ' not in line]
    usual = next((line for line in available if '(your usual place)' in line), None)
    chosen = usual or next(iter(available), None)
    shops = load_shops()
    choice = next((sid for sid, shop in shops.items() if chosen and chosen.startswith(f'- **{shop["name"]}')), 'none')
    driver = 'hours' if usual is None else 'wait' if 'the queue is running' in user else 'habit'
    return {
        'choice': choice, 'primary_driver': driver, 'secondary_driver': None,
        'valence': 0.6 if choice != 'none' else -0.3,
        'reasoning': 'Synthetic test decision: prefer an open usual shop, otherwise an open alternative.',
    }, {'input_tokens': 0, 'output_tokens': 0}


def run_command(args, log, expected=0, env=None):
    result = subprocess.run([sys.executable, *args], cwd=ROOT, capture_output=True, text=True, env=env)
    log.write_text(result.stdout + result.stderr, encoding="utf-8")
    if result.returncode != expected:
        raise AssertionError(f'{args[0]} returned {result.returncode}, expected {expected}; see {log}')
    return result


def summary(base):
    rows = [build_runs.load_rows(base, sid, seed) for sid in ALL_SCENARIOS for seed in range(5)]
    baseline = build_runs.load_rows(base, 'baseline', 0)
    return {
        'coverage': coverage([r for rs in rows for r in rs]),
        'baseline_seed0_daily': [
            {'day': day, 'choices': dict(Counter(r['choice'] for r in baseline if r['day'] == day)),
             'simffee_sales': sum(r['spent'] for r in baseline if r['day'] == day and r['choice'] == 'simffee')}
            for day in range(1, 8)
        ],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', type=Path, required=True)
    args = ap.parse_args()
    out = args.out.resolve()
    if out.exists() and any(out.iterdir()):
        ap.error('output directory must be new or empty')
    out.mkdir(parents=True, exist_ok=True)
    shops = load_shops()
    twins = {t.id for t in load_twins(shop_ids=frozenset(shops))}
    generated = out / 'stubbed-runs'
    warm_cache = out / 'stubbed-cache'
    actual_run_day = loop.run_day
    forks_checked = []

    def checked_day(day, people, state, today, remembered, rng, scenario, seed, **kwargs):
        if scenario in ('cf_discount', 'cf_restore_hours') and day == 5:
            parent, parent_rng = loop.load_snapshot(generated, 'baseline', seed, 4)
            assert state == parent
            assert rng.getstate() == parent_rng.getstate()
            forks_checked.append((scenario, seed))
        return actual_run_day(day, people, state, today, remembered, rng, scenario, seed, **kwargs)

    with patch.object(llm, 'MODEL', MODEL), patch.object(llm, 'complete_json', side_effect=stub), \
            patch.object(llm, 'client', side_effect=AssertionError('live transport forbidden')), \
            patch.object(loop, 'run_day', side_effect=checked_day):
        decide.reset_stats()
        for sid in ALL_SCENARIOS:
            for seed in range(5):
                rows = loop.run(sid, seed, out=generated, cache_dir=warm_cache)
                assert len(rows) == 70
                assert not any(validate_row(r, frozenset(shops)) for r in rows)
                assert not any(r['llm_failed'] for r in rows)
    assert len(forks_checked) == 10
    generated_stats = dict(decide.STATS)

    file_errors = []
    checked_rows = sum(check_file(generated / sid / f'{seed}.jsonl', twins, set(shops), file_errors)
                       for sid in ALL_SCENARIOS for seed in range(5))
    assert checked_rows == 1400 and not file_errors, file_errors
    for seed in range(5):
        base = build_runs.load_rows(generated, 'baseline', seed)
        for sid, through in [('cf_null', 3), ('cf_discount', 4), ('cf_restore_hours', 4)]:
            strip = lambda rs: [{k: v for k, v in r.items() if k != 'scenario'} for r in rs if r['day'] <= through]
            assert strip(base) == strip(build_runs.load_rows(generated, sid, seed))

    replay_counts = {}
    for salt in ('0', '777'):
        replay = out / f'replay-{salt}'
        env = {**os.environ, 'PYTHONHASHSEED': salt, 'SIMFFEE_MODEL': MODEL}
        run_command(['-m', 'engine.cli', '--all', '--seeds', '0-4', '--offline', '--quiet',
                     '--require-complete', '--out', str(replay), '--cache', str(warm_cache)],
                    out / f'replay-{salt}.log', env=env)
        files = [p for p in generated.rglob('*') if p.is_file()]
        for source in files:
            target = replay / source.relative_to(generated)
            assert source.read_bytes() == target.read_bytes(), str(target)
        replay_counts[salt] = len(files)

    run_command(['build_runs.py', str(generated), '--offline', '--synthetic', '--require-complete',
                 '--out', str(out / 'stubbed-bundle.json')], out / 'stubbed-build.log')
    bundle = json.loads((out / 'stubbed-bundle.json').read_text(encoding="utf-8"))
    assert bundle['meta']['synthetic_run'] and not bundle['meta']['publishable']
    assert bundle['meta']['coverage']['complete']
    assert bundle['analysis']['complete'] and bundle['analysis']['narration']
    for sid in ALL_SCENARIOS:
        for seed in range(5):
            assert bundle['scenarios'][sid]['seeds'][str(seed)]['rows'] == build_runs.load_rows(generated, sid, seed)

    actual_reappraise = decide.reappraise
    def old_gate(twin, state, shops_today, disr, regular, *a, **kw):
        highest = max((v for sid, v in state['latent_interest'].items() if sid != regular), default=0.0)
        if highest < SKIP_LATENT_FLOOR and disr.source == 'hours':
            return decide.Decision(choice='none', primary_driver='habit', secondary_driver=None, valence=-0.3,
                                   reasoning='Synthetic control: legacy low-interest gate forced skipping.',
                                   llm_failed=False, decision_source='rule')
        return actual_reappraise(twin, state, shops_today, disr, regular, *a, **kw)
    control = out / 'legacy-gate-stubbed-runs'
    with patch.object(llm, 'MODEL', MODEL), patch.object(llm, 'complete_json', side_effect=stub), \
            patch.object(llm, 'client', side_effect=AssertionError('live transport forbidden')), \
            patch.object(decide, 'reappraise', side_effect=old_gate):
        for sid in ALL_SCENARIOS:
            for seed in range(5):
                loop.run(sid, seed, out=control, cache_dir=out / 'legacy-gate-stubbed-cache')

    baseline = build_runs.load_rows(generated, 'baseline', 0)
    legacy = build_runs.load_rows(control, 'baseline', 0)
    original_customers = {r['twin'] for r in legacy if r['day'] == 1 and r['choice'] == 'simffee'}
    previous_switchers = {r['twin'] for r in legacy if r['day'] == 4 and r['choice'] == 'starbucks' and r['twin'] in original_customers}
    old_skips = sum(r['day'] == 5 and r['twin'] in previous_switchers and r['choice'] == 'none' for r in legacy)
    new_skips = sum(r['day'] == 5 and r['twin'] in previous_switchers and r['choice'] == 'none' for r in baseline)
    assert previous_switchers and old_skips == len(previous_switchers) and new_skips == 0

    # The committed cache/ is the demo (SPEC 10.4). Seeds 0-2 must replay complete and
    # publishable with zero API calls; seeds 3-4 were never filled and must be rejected.
    diagnostic = out / 'offline-diagnostic-runs'
    run_command(['-m', 'engine.cli', '--all', '--seeds', '0-4', '--offline', '--quiet', '--require-complete',
                 '--out', str(diagnostic), '--cache', str(ROOT / 'cache')], out / 'offline-diagnostic.log', expected=2)
    run_command(['tools/validate.py', str(diagnostic)], out / 'offline-validation.log')
    run_command(['build_runs.py', str(diagnostic), '--offline', '--out', str(out / 'offline-diagnostic-bundle.json')],
                out / 'offline-build.log')
    run_command(['build_runs.py', str(diagnostic), '--offline', '--require-complete',
                 '--out', str(out / 'must-not-exist.json')], out / 'strict-rejection.log', expected=2)
    assert not (out / 'must-not-exist.json').exists()
    diagnostic_bundle = json.loads(
        (out / 'offline-diagnostic-bundle.json').read_text(encoding="utf-8"))
    assert diagnostic_bundle['analysis']['impact'] is None
    assert diagnostic_bundle['analysis']['narration'] is None
    assert not diagnostic_bundle['meta']['publishable']

    promoted = out / 'promoted-runs'
    run_command(['-m', 'engine.cli', '--all', '--seeds', '0-2', '--offline', '--quiet', '--require-complete',
                 '--out', str(promoted), '--cache', str(ROOT / 'cache')], out / 'promoted.log')
    run_command(['build_runs.py', str(promoted), '--offline', '--require-complete', '--seeds', '0-2',
                 '--out', str(out / 'promoted-bundle.json')], out / 'promoted-build.log')
    promoted_bundle = json.loads((out / 'promoted-bundle.json').read_text(encoding="utf-8"))
    assert promoted_bundle['meta']['publishable'], 'committed cache must rebuild a publishable bundle'
    assert promoted_bundle['analysis']['surprise'] is True
    assert promoted_bundle['analysis']['confidence']['value'] is not None

    report = {
        'kind': 'offline verification; stub choices are NOT real model output',
        'rows_validated': checked_rows,
        'fork_rng_checks': len(forks_checked), 'fork_prefix_checks': 15,
        'byte_identical_replay_files': replay_counts,
        'stubbed_generation_stats': generated_stats,
        'legacy_gate_control': summary(control),
        'repaired_stubbed_pipeline': summary(generated),
        'repaired_stubbed_analysis': {k: v for k, v in bundle['analysis'].items() if k not in ('evidence', 'coverage')},
        'day5_old_gate_skips': old_skips, 'day5_repaired_skips': new_skips,
        'offline_diagnostic': summary(diagnostic),
        'real_model_verification': {'publishable': promoted_bundle['meta']['publishable'], 'models': promoted_bundle['meta']['coverage']['models'], 'confidence': promoted_bundle['analysis']['confidence']['value']},
    }
    (out / 'verification.json').write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding="utf-8")
    print(f'PASS: {checked_rows} rows, 15 fork prefixes, 10 fork RNG states, two byte-identical replays')
    print(f'SYNTHETIC paired gate check: day-5 forced skips {old_skips} -> {new_skips}')
    print(f'Seeds 3-4 correctly rejected; seeds 0-2 rebuild a publishable bundle from cache/ ({promoted_bundle["meta"]["coverage"]["models"]}); report: {out / "verification.json"}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
