# Simffee — Run plan: from the current tree to a publishable demo bundle

2026-09-20 · after `36b724e` · supersedes FIX_PLAN §5.6 and CHANGE_REPORT §7.3 as the work order

Read [CHANGE_REPORT.md](./CHANGE_REPORT.md) for what changed. This document is only *what to do
next*, in order, with the gate that lets you move to the next step.

## 0. Where we are, in five lines

1. Every offline check passes: 41 unit tests, analyzer (37), narrate (14), LLM path, pipeline.
2. **No compatible cache exists.** The 43 legacy files miss on the v2 key. `build_demo.sh --offline`
   → 230 fallbacks → bundle non-publishable. The demo does not exist until a live run happens.
3. FIX_PLAN §5.2–5.5 are landed (prompt veto-list fix, T01/T05 tolerances, `cf_null` day-6 wait
   shock, 3-seed minimum). **§5.1 (gossip roll) is still open** — `gossip.py:54` is one roll per
   twin, spec says per neighbour. Deciding it after the cache fill invalidates the cache.
4. Narration is deterministic. Analysis is suppressed on any fallback. `build_demo.sh` writes to
   a fresh temp dir and never touches `public/runs.json`.
5. Frontend is still the Vite starter. Not on this critical path, but it is the other half of
   the demo and nobody is on it.

## 1. Decisions before the first paid request

All four change the cache key. Decide once, then spend once.

| # | Decision | Recommendation | Why |
| --- | --- | --- | --- |
| D1 | Gossip roll (FIX_PLAN 5.1) | **Declare it won't change.** One roll per twin stays | Changing it now buys smoother gossip at the price of re-deciding everything downstream; the demo does not depend on it |
| D2 | Model | **Not `compound-mini`.** Use a plain instruct model with JSON mode: `llama-3.3-70b-versatile` (quality) or `llama-3.1-8b-instant` (cost, speed). If a reasoning model is wanted, `openai/gpt-oss-20b` **with `reasoning_effort: "low"`** | compound-* is an agent with tool use — nondeterministic, slower, and its "model" field is a router. The legacy cache shows gpt-oss spending 775 output tokens on a 40-word answer |
| D3 | `SIMFFEE_MAX_TOKENS` | **400** for an instruct model; 1600 only if reasoning tokens are in play | The response is ~60 tokens of JSON. 1600 is a ceiling for hidden reasoning, not for the answer |
| D4 | Accept the data edits already in the tree (T01 budget 70k / wait 8, T05 wait 8, `cf_null` day-6 wait 12) | **Accept.** They are FIX_PLAN 5.3/5.4 as written | Revisit only if the smoke run (§3) shows the wrong twins moving |

Write D2/D3 into `.env` (not committed) and into SPEC 4.3 (committed), so replay uses the same
key. `llm.py` only reads `GROQ_API_KEY`, `SIMFFEE_MODEL`, `SIMFFEE_MAX_TOKENS`, `SIMFFEE_MIN_INTERVAL`.

## 2. Environment (10 minutes)

```bash
python3 -m pip install -r requirements.txt        # groq is not installed in this checkout
python3 -c 'import groq; print(groq.__version__)'
printf 'SIMFFEE_MODEL=llama-3.3-70b-versatile\nSIMFFEE_MAX_TOKENS=400\nSIMFFEE_MIN_INTERVAL=2.2\n' > .env
# add GROQ_API_KEY=... to .env with an editor; never paste it in chat or a commit
chmod 600 .env
python3 -c 'from engine.llm import available; print(available())'   # True = client builds
rm -f '=0.5.0'                                                       # stray pip log
```

`available()` only constructs a client. The first real request in §3 is the authentication test.

## 3. Smoke run — one seed, baseline only (~25 calls, ~1 minute at 2.2 s pacing)

```bash
SMOKE="$(mktemp -d /tmp/simffee-smoke.XXXXXX)"
python3 -m engine.cli --scenario baseline --seeds 0 --out "$SMOKE/runs" --cache "$SMOKE/cache"
python3 tools/validate.py "$SMOKE/runs"
python3 - "$SMOKE/runs/baseline/0.jsonl" <<'PY'
import json, sys, collections
rows = [json.loads(l) for l in open(sys.argv[1])]
for d in range(1, 8):
    day = [r for r in rows if r["day"] == d]
    split = collections.Counter(r["choice"] for r in day)
    print(d, dict(split), "reapp", sum(r["mode"]=="reappraisal" for r in day),
          "fallback", sum(r["llm_failed"] for r in day))
for r in rows:
    if r["day"] == 4 and r["mode"] == "reappraisal":
        print(r["twin"], r["choice"], r["primary_driver"], "|", r["reasoning"])
PY
```

**Gate to proceed** (FIX_PLAN §6, items 2–3, on one seed):

- 0 fallbacks. If not → §7 troubleshooting; do not proceed.
- Day 4: ≥ 3 twins at `starbucks`, ≥ 1 `none`. Ideal 4 / 2.
- Day 7: ≥ 2 twins who started at Simffee are at Starbucks *and were there on day 6 too*.
- `primary_driver` on day-4 switchers is `hours` (or `hours` + `curiosity`), not `price`.
- CLI reports the response model you asked for, and tokens per call in the ~1k in / <150 out range.

If the gate fails on behaviour (not on infra), the fix is in `engine/prompt.py` or `data/twins/`,
and each iteration costs ~25 calls. Three iterations is the budget; after that, apply the
SPEC 10.3 decision rule — drop the +3k price, keep only the hours change.

## 4. Fill — five seeds, four scenarios (~230 calls, ~10 minutes)

Same `.env`, **new** output dir, **reuse the smoke cache** so seed 0 baseline is free:

```bash
LIVE="$(mktemp -d /tmp/simffee-live.XXXXXX)"
cp -r "$SMOKE/cache" "$LIVE/cache"
bash tools/build_demo.sh --live --out "$LIVE" --cache "$LIVE/cache"
```

The wrapper runs `--all --seeds 0-4 --require-complete`, validates, and builds
`$LIVE/runs.json` strictly. Exit 2 = a fallback slipped through; the cache keeps the successful
responses, so re-running into a new `--out` with the same `--cache` only pays for the misses.

**Gate** (FIX_PLAN §6, all six):

```bash
python3 - "$LIVE/runs.json" <<'PY'
import json, sys
b = json.load(open(sys.argv[1])); a = b["analysis"]; m = b["meta"]
print("publishable", m["publishable"], "| complete", a["complete"])
print("break", a["break_day"], "| naive", a["naive"]["driver"], "| actual", a["actual"]["driver"], "| surprise", a["surprise"])
print("impact", {k: a["impact"][k] for k in ("lost_total","lost_by_decision","lost_anyway")})
print("confidence", a["confidence"]["value"], a["confidence"].get("reason"))
for w in a["whatif"]: print(w["scenario"], w["returns"], "/", w["of"], "conf", w["confidence"])
print("narration:", a["narration"])
PY
```

| Check | Pass |
| --- | --- |
| `publishable` true, `complete` true | required |
| `naive == price`, `actual == hours`, `surprise` true | required — the demo thesis |
| `lost_anyway ≥ 1` | control arm subtracts something |
| `cf_restore_hours.returns − cf_discount.returns ≥ 2`, both `of ≥ 3` | the two buttons differ visibly |
| `0.5 ≤ confidence ≤ 0.9` | > 0.9 means something collapsed to no variance |
| narration non-null, two sentences | deterministic; null means a gate above failed |

## 5. Replay proof — offline, from the new cache, byte-identical

```bash
REPLAY="$(mktemp -d /tmp/simffee-replay.XXXXXX)"
bash tools/build_demo.sh --offline --out "$REPLAY" --cache "$LIVE/cache"
diff -r "$LIVE/runs" "$REPLAY/runs" && echo "trajectories identical"
```

Expected: 0 API attempts, 0 fallbacks, identical `runs/`. `runs.json` differs only in
`meta.generated_at`. This is BACKEND_PLAN §6 done-criterion #1 and the thing that makes the
demo key-free on stage.

## 6. Promote and commit — deliberately

Nothing above touched the repo. This step does.

1. `cp "$LIVE/runs.json" public/runs.json`
2. Cache: the 43 legacy files are untracked and dead. **Do not `rm` without a team OK.** Suggested:
   `mkdir -p cache-legacy && mv cache/*.json cache-legacy/ && cp "$LIVE"/cache/*.json cache/`,
   then `git add cache/`; leave `cache-legacy/` untracked and gitignored or delete it later.
3. `git add public/runs.json cache/ spec/SPEC.md .gitignore` — commit message names the model,
   `MAX_TOKENS`, and the six gate values.
4. Fresh-clone check: `git clone … /tmp/x && cd /tmp/x && bash tools/build_demo.sh --offline` →
   exit 0, 0 fallbacks, `publishable` true. **Note:** `tools/check_pipeline.py` currently
   *expects* the repo cache to be incompatible (CHANGE_REPORT §5.2) — flip that expectation in
   the same commit or it will fail.

## 7. Troubleshooting the smoke run

| Symptom | Likely cause | Do |
| --- | --- | --- |
| Every reappraisal is a fallback, `API attempts > 0`, `responses 0` | Auth or model-name rejection | Check `GROQ_API_KEY`; try the model name in Groq's console; `--model` overrides `.env` |
| Some fallbacks, `retries > 0` | Rate limit or invalid JSON | Raise `SIMFFEE_MIN_INTERVAL` to 3–4 s; if JSON, the model may not support `response_format` — llm.py probes and drops it, but a weak model still may not comply; switch to 70B |
| 0 fallbacks but day 4 is all `none` | Veto-list regression or a model that over-weights cost | Read the reasonings; if they cite budget/wait, re-check `prompt.py` option block; if they cite "too far", the raw distance string is doing it |
| Switchers cite `price` as `primary_driver` | Model rationalising | SPEC 7.3: drop latte to 47k *and* raise the price coefficient in `attribution.py` in the same commit (B2_STATUS §5) |
| Day 7 everyone is back at Simffee | New habit not forming; hours still late so they should stay | Check `habit[starbucks]` in `state_after` on days 5–6; if < 0.3, valence at Starbucks is negative — read why |
| `confidence` null on a complete run | < 3 usable reappraisal seeds for every twin | Only possible if seeds 1–4 fell back; see first row |

## 8. After the bundle exists

In this order — each depends on a compatible cache existing:

1. **Frontend.** Someone has to build screens 1–5 against `public/runs.json`. It is the other
   half of the demo and it is at zero.
2. **Cost ledger** ([COST_PLAN.md](./COST_PLAN.md) §6 steps 1–2) — needs the live run's real
   token numbers to be worth anything.
3. **Elasticsearch** ([ELASTIC_PLAN.md](./ELASTIC_PLAN.md) §7 steps 1–3) — ingest and index do
   not touch twin files; step 4 (`derive --write`) does, and would invalidate the cache you just
   filled. Run derive in *compare* mode first (see ELASTIC_PLAN §3 update).
4. **Housekeeping** from FIX_PLAN §7: stale file trees, the eight spec gaps, `SPEC 4.3` model
   name, T10 claim.

## 9. Budget

~230 reappraisals at ~1.1k in / ~100 out tokens on `llama-3.3-70b-versatile` (Groq list
$0.59 / $0.79 per M as of the last public sheet — **verify before quoting**): roughly
**$0.15–0.20 for the full fill**, plus ~$0.02 per smoke iteration. Time is the real cost:
2.2 s pacing → ~9 minutes for the fill, ~1 minute per smoke iteration.
