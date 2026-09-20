#!/usr/bin/env bash
# BACKEND_PLAN 6.1: `git clone` + one command reproduces public/runs.json with no API key,
# from the committed cache/. This is that command.
#
#   ./tools/build_demo.sh            # cached engine run -> validate -> runs.json
#   ./tools/build_demo.sh --offline  # same, but never call the API even if a key is set
#
# Steps, each of which fails loudly:
#   1. engine: every scenario x seeds 0-4 into runs/ (gitignored). With a warm cache/ this
#      makes zero API calls; without one and without a key, pass --offline and the
#      reappraisals fall back and are flagged llm_failed.
#   2. validate: every row against the frozen contract.
#   3. build_runs: analyzer over runs/ -> public/runs.json. Narration is attempted only
#      when credentials are present.
set -euo pipefail
cd "$(dirname "$0")/.."

OFFLINE=()
if [[ "${1:-}" == "--offline" ]]; then OFFLINE=(--offline); fi
if [[ ${#OFFLINE[@]} -eq 0 && -z "${ANTHROPIC_API_KEY:-}" && ! -d cache ]]; then
  echo "no ANTHROPIC_API_KEY and no cache/ — running --offline (reappraisals will be flagged llm_failed)"
  OFFLINE=(--offline)
fi

echo "== 1/3 engine =="
python3 -m engine.cli --all --seeds 0-4 "${OFFLINE[@]}" --quiet

echo "== 2/3 validate =="
python3 tools/validate.py runs

echo "== 3/3 build runs.json =="
python3 build_runs.py runs

echo "== done =="
