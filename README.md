# Simffee — the coffee shop what-if machine

Built at **HackMIT 2026**.

Simffee simulates a coffee shop's regulars as ten synthetic "twins," each carrying two
layers of data — a 30-day purchase log (**what** they do) and an interview transcript
(**why** they do it). Run a scenario (a price change, new hours, a competitor opening
nearby) across seven simulated days and Simffee doesn't just report that sales moved —
it attributes *which lever moved which customer, and why*, and lets you compare that
against a counterfactual where the lever wasn't pulled.

The pitch: a static read of a sales dip almost always blames the obvious thing (a price
rise). Simffee's seeded scenario shows the obvious reading getting refuted — the real
mechanism is a later opening time, not the price — because the simulation tracks habit,
disruption tolerance, and word-of-mouth per twin instead of one aggregate number.

**Everything here is synthetic.** No real customer data is used or claimed to be
predictive; see [PROTOCOL.md](PROTOCOL.md) for what a real validation study would look
like, and [ARCHITECTURE.md](ARCHITECTURE.md) for the full backend/frontend breakdown.

## How it works

- **Deterministic rules, selective LLM calls.** Routine purchases follow habit with no
  model call. A disruption (price/hours/competitor change), weak habit, or enough
  curiosity opens the door to a model-backed reappraisal, which is cached and validated.
- **Two shops, ten twins, a 5×5 grid.** Simffee Coffee and Starbucks, connected by
  Manhattan-distance social links that carry gossip and marketing.
- **Two ways to see it**: a precomputed demo bundle (`public/runs.json`, no backend
  needed) and an interactive what-if flow (type or build a scenario, get back rows,
  mechanism attribution, and cost/coverage info from a local API).

See [spec/SPEC.md](spec/SPEC.md) for the full mechanism spec and
[engine/README.md](engine/README.md) for engine internals and cache/decision behavior.

## Quick start

Requires Node (for the frontend) and Python 3.11+ (for the engine/API). No API key is
needed to see the demo — a committed decision cache (`cache/`) makes the default run
fully offline.

```bash
git clone <this-repo>
cd Simffee
npm install
pip install -r requirements.txt

./tools/serve_demo.sh
```

This replays the library scenarios from `cache/`, starts the API on
`http://127.0.0.1:8765`, and starts the Vite dev server on `http://localhost:5173`.
Open the second URL to use the app. Pass `--no-web` to run the API alone (for `curl`).

To just rebuild the static demo bundle without running a server:

```bash
./tools/build_demo.sh --offline
```

### Live model calls (optional)

Interactive what-ifs that aren't already cached need a provider key. Copy your key into
a local `.env` (git-ignored, keep it `600`):

```
XAI_API_KEY=...
SIMFFEE_MODEL=qwen/qwen3.8-27b   # optional override
```

See [engine/README.md](engine/README.md) for the full list of `SIMFFEE_*` environment
variables and their defaults.

## Project layout

| Path | What's there |
| --- | --- |
| [engine/](engine/) | Simulation loop, habit/disruption/gossip rules, LLM transport, decision cache, CLI |
| [analyzer/](analyzer/) | Attribution, counterfactual comparison, flows, confidence, narration |
| [api/](api/) | Local HTTP API (`server.py` routing, `service.py` orchestration) |
| [data/](data/) | Shops, twins, scenarios, allowed translator actions |
| [src/](src/) | React/TypeScript frontend (dashboard, playback, what-if UI, town view) |
| [tools/](tools/) | Demo build/serve scripts, determinism and pipeline checks |
| [tests/](tests/) | Python test suite for engine, API, analyzer, translation |
| [spec/](spec/) | Design spec, roadmap, and status docs |

## Running tests

```bash
python3 tests/test_repairs.py -v
python3 tests/test_b2_sync.py -v
python3 tests/test_analyzer.py
python3 tests/test_narrate.py
python3 tools/check_llm_path.py
python3 tools/validate.py
python3 tools/check_pipeline.py --out /tmp/simffee-pipeline-check
```

Frontend: `npm run lint` and `npm run build` (runs `tsc -b` then `vite build`).

## Tech stack

Python (stdlib `http.server`, `dataclasses`, OpenAI SDK pointed at xAI's Responses API)
on the backend; React 19 + TypeScript + Vite on the frontend. No database — everything
is JSON/JSONL on the local filesystem. Full rationale in
[ARCHITECTURE.md](ARCHITECTURE.md).

## Status and known limitations

This is a hackathon-stage demo, not a validated forecasting tool. See the "Known
modeling decisions still requiring review" section of [engine/README.md](engine/README.md)
and [PROTOCOL.md](PROTOCOL.md) for what's still open and how a real-world test would be
run before trusting any of this on a real shop.
