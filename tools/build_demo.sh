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

OFFLINE=1
OUT=""
CACHE="cache"
MODEL=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --offline) OFFLINE=1; shift ;;
    --live) OFFLINE=0; shift ;;
    --out|--cache|--model)
      if [[ $# -lt 2 ]]; then echo "missing value for $1" >&2; exit 2; fi
      case "$1" in
        --out) OUT="$2" ;;
        --cache) CACHE="$2" ;;
        --model) MODEL="$2" ;;
      esac
      shift 2 ;;
    *) echo "usage: $0 [--offline|--live] [--out NEW_DIRECTORY] [--cache DIRECTORY] [--model MODEL]" >&2; exit 2 ;;
  esac
done
if [[ "$OFFLINE" -eq 0 ]]; then
  if ! python3 -c 'import sys; from engine.llm import available; sys.exit(0 if available() else 2)'; then
    echo "A valid local Groq configuration is required; set GROQ_API_KEY in .env or the environment" >&2
    exit 2
  fi
fi
if [[ -z "$OUT" ]]; then
  OUT="$(mktemp -d "${TMPDIR:-/tmp}/simffee-demo.XXXXXX")"
elif [[ -e "$OUT" && ( ! -d "$OUT" || -n "$(ls -A "$OUT")" ) ]]; then
  echo "output directory must be new or empty: $OUT" >&2
  exit 2
fi
mkdir -p "$OUT"
ENGINE_ARGS=(--all --seeds 0-4 --quiet --require-complete --out "$OUT/runs" --cache "$CACHE")
if [[ -n "$MODEL" ]]; then ENGINE_ARGS+=(--model "$MODEL"); fi
if [[ "$OFFLINE" -eq 1 ]]; then ENGINE_ARGS+=(--offline); fi

echo "== 1/3 engine: $OUT =="
python3 -m engine.cli "${ENGINE_ARGS[@]}"

echo "== 2/3 validate =="
python3 tools/validate.py "$OUT/runs"

echo "== 3/3 build runs.json =="
python3 build_runs.py "$OUT/runs" --offline --require-complete --out "$OUT/runs.json"

echo "== done: $OUT/runs.json =="
