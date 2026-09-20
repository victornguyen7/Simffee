# B1 status report — engine vs. spec

2026-09-19 · covers `engine/`, `tools/` · reconciles the implementation against
[SPEC.md](./SPEC.md) and [BACKEND_PLAN.md](./BACKEND_PLAN.md)

Read this if you are B2 (the row contract and its invariants), the frontend
person (where `runs.json` will come from), or whoever owns twin tuning (the data
fix in section 5).

---

## 1. Where B1 is

| Plan milestone | State |
| --- | --- |
| Hour 0–0.25 — `schema.py` frozen, importable by B2 | **done** |
| Hour 0–2 — loader, resolve, disruption, habit, gossip, loop + stub reappraisal | **done** |
| Hour 2–4 — real `reappraise()`: prompt, JSON validation, retry, cache, fallback | **code done, never run live** |
| Hour 4–6 — 5 seeds, tune until the day-4 break is stable | not started (blocked on an API key + the section 5 data fix) |
| Hour 6–8 — snapshot/fork, 3 counterfactuals, commit `cache/` | fork works and is asserted; `cache/` is still empty |

### What runs today

```bash
pip install -r requirements.txt
python3 -m engine.cli --all --seeds 0-4 --offline   # 20 runs, 70 rows each, no API key
./tools/check_determinism.sh                        # replay + fork fairness
python3 tools/check_llm_path.py                     # 18 checks on the LLM path, stubbed
```

All three pass. Days 1–3 reproduce SPEC 7.1 exactly (8 Simffee / 2 Starbucks,
zero reappraisals); day 4 puts exactly the six twins with `usual_time` before
07:00 into reappraisal.

### Modules that exist

`schema.py` `loader.py` `resolve.py` `disruption.py` `habit.py` `gossip.py`
`decide.py` `prompt.py` `llm.py` `cache.py` `loop.py` `cli.py` `timeutil.py`

---

## 2. Decisions the spec did not cover

Eight places where SPEC.md was silent or unimplementable and I had to choose.
Each needs an edit to one side or the other. **My recommendation is in the last
column**; none of these are settled until someone says so.

| # | What the spec says | What the code does | Recommended fix |
| --- | --- | --- | --- |
| 1 | 2.4: "with probability `talkativeness`, the twin tells **each** neighbor" | One roll per twin — they tell every neighbour or none | **Change the code.** Per-neighbour is what the spec says and it spreads gossip more smoothly. See the warning below |
| 2 | 2.1 is silent on what a skip does to habit | A skip reinforces nothing and decays every shop by δ | **Change the spec.** Add the line — it is load-bearing for T08 |
| 3 | 2.2 is silent on what "expectation" is anchored to | Pinned to the day-1 resolved world, so the 48k latte still reads as a shock on days 5–7 | **Change the spec.** This is what lets `cf_restore_hours` return twins to autopilot; make it an explicit knob |
| 4 | 2.3: "after visiting `o` for the **first** time" | Zeroes latent on any non-regular visit; no visited-set is tracked | **Change the spec**, or tighten later. Behaviourally identical across 7 days |
| 5 | 3.4 `abandoned` (in `what_log` it means walking away from the queue) | Set to `choice == "none"`, i.e. skipped | **Change the plan.** Define it in BACKEND_PLAN 2.1, or drop the field — `choice` already encodes it |
| 6 | 4.3 schema: `secondary_driver` mandatory | Accepts `"none"` and stores null | **Change the spec** to match the plan, which already allows null |
| 7 | 4.3: "≤ 40 words" | Truncates at 40 rather than rejecting the reply | **Change the spec.** Rejecting burns a retry on a cosmetic fault |
| 8 | 4.2 gives only the +0.3 autopilot valence | Invented −0.2 (autopilot skip) and −0.3 (reappraisal skip) | **Change the spec.** These feed gossip, so they are not cosmetic |

> **Decide #1 before spending money.** Changing the gossip roll changes the
> random stream → changes `state_before` → changes the cache key. Every cached
> LLM response is invalidated. Do it before filling `cache/`, not after.

---

## 3. SPEC 4.3 describes an API that no longer exists

> "Cheap model, `temperature 0.7`, `max_tokens 300`, JSON required... on failure
> → retry once at `temperature 0.3`"

- **`temperature` was removed from the Python SDK's typed signature** in the
  0.x → 1.x major version. `messages.create()` raises `TypeError` on it. It now
  goes through `extra_body`, probed once per process; if the API rejects it the
  call retries without it and the "retry at 0.3" degrades to a plain second
  attempt. Seed-to-seed variance survives regardless — each seed is its own
  cache key, so each seed is its own sample, which is what the stability metric
  in 6.5 actually needs.
- **The spec never names the model.** The code pins `claude-haiku-4-5`
  (override: `SIMFFEE_MODEL` or `--model`). That choice is what makes the
  temperature requirement satisfiable at all — the Opus/Sonnet 5 family rejects
  the parameter outright. It belongs in the spec.
- **`output_config.format`** (schema-constrained JSON) is probed the same way,
  falling back to asking for JSON in prose. Either path is validated by the
  caller.

---

## 4. Both documents have stale file trees

SPEC 10.4 and the module list in BACKEND_PLAN section 3 no longer match reality.
B2 and the frontend person read these to find things.

| Documented | Actual |
| --- | --- |
| `engine/reappraise.py`, `engine/autopilot.py` | `engine/decide.py` (both modes), `engine/prompt.py`, `engine/llm.py` |
| — | `engine/schema.py`, `engine/timeutil.py` |
| `web/public/runs.json` | `public/runs.json` — the Vite app is at the repo root |
| `web/src/...` | `src/...` |

---

## 5. Data fix needed before tuning

**T07 and T08 no longer hit the T08 skip gate on day 4.** Marketing accrues
daily per 2.3, and Starbucks' 0.40 reach lifts them across days 1–3:

| Twin | `latent_interest` day 1 | by day 4 | gate floor |
| --- | --- | --- | --- |
| T07 Vy | 0.05 (`ad_sensitivity` 0.15) | **0.20** | 0.20 — just misses |
| T08 Mai | 0.15 (`ad_sensitivity` 0.05) | **0.21** | 0.20 — just misses |

SPEC 7.1 wants both of them skipping, and T08 is the evidence card for *"same
shock, no switch — because there was nothing to be curious about."* The fix is
one number in `data/twins/T07.json` / `T08.json` (lower `latent_interest` or
`ad_sensitivity`). Left alone deliberately: BACKEND_PLAN says twin tuning is a
joint call with whoever owns content, because every change invalidates cache for
the days after it.

---

## 6. Not verified

- **No live LLM call has ever been made.** No `ANTHROPIC_API_KEY` and no `ant`
  CLI in this environment. The path is exercised end to end against a stubbed
  transport — `tools/check_llm_path.py`, 18 checks, all passing — but the real
  request shape (whether `extra_body` temperature and `output_config.format` are
  accepted on Haiku 4.5) is untested.
- **`cache/` is empty.** SPEC 10.4 calls it "the demo". It stays empty until a
  live run. It is deliberately *not* in `.gitignore`.
- **Cost may exceed the spec's ~25 calls/seed.** SPEC 4.4 assumes days 5–7 taper
  as new habits form, but switchers sit below the 0.6 autopilot floor for
  several days and keep reappraising. Measured shape: ~900 input / ~60 output
  tokens per call. Still comfortably under $1 for all 20 runs.

---

## 7. What is guaranteed to B2

These hold today and are asserted by `tools/check_determinism.sh` on every run:

- 10 twins × 7 days = **70 rows per file**, ordered by day then twin id, in
  every scenario including the forks.
- `spent == 0` exactly when `choice == "none"`; never null.
- `primary_driver` always set; `secondary_driver` may be null.
- `llm_failed: true` rows still carry a valid `choice` (autopilot fallback) and
  must be **excluded from stability** per SPEC 4.3.
- Same seed replays **byte for byte**.
- A fork shares its parent's random stream and its opening days, so the override
  is the only difference between branches (`cf_null` days 1–3, `cf_*` days 1–4).

`cf_null` has `parent: null` and re-runs from day 1 rather than forking. It
matches baseline days 1–3 by determinism, not by snapshot inheritance — the
check asserts this, so it is safe, but it is worth knowing when reading SPEC 5.1.

---

## 8. Suggested order of work

1. **Decide the gossip roll (section 2, item 1)** — before any cached spend.
2. Put an API key in the environment; run one live baseline seed and confirm the
   request shape from section 3.
3. Fix T07/T08 with whoever owns content, then run 5 seeds and tune to the
   SPEC 7.1 target.
4. Patch the two file trees (section 4) and the eight spec gaps (section 2) in
   one editing pass.
