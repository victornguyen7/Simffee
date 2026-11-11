#!/usr/bin/env bash
# AUDIT_FIX_PLAN #27: fill cache/ so every scenario (bundle or not) replays complete offline,
# waiting out Groq's daily token quota between attempts.
#
#   ./tools/fill_cache.sh                         # retry hourly until complete; give up after 36 h
#   WAIT_MIN=30 MAX_HOURS=48 ./tools/fill_cache.sh
#
# Groq only: the local Ollama fallback is switched off, so the cache never mixes two models'
# decisions for one scenario. Each attempt uses the committed cache's own model settings
# (--cache-defaults) and stops at the first daily-quota refusal (--stop-on-quota); decisions
# already answered stay cached, so the next attempt only makes the missing calls.
#
# Exit codes: 0 complete, 1 invalid engine output, 2 gave up at MAX_HOURS.
set -uo pipefail
cd "$(dirname "$0")/.."

PY="${PYTHON:-python3}"
WAIT_MIN="${WAIT_MIN:-60}"          # after a daily-quota stop
RETRY_MIN="${RETRY_MIN:-5}"         # after an incomplete run for other reasons (rate limits, bad replies)
MAX_HOURS="${MAX_HOURS:-36}"
SEEDS="${SEEDS:-0-2}"
deadline=$(( $(date +%s) + MAX_HOURS * 3600 ))

attempt=0
while :; do
  attempt=$((attempt + 1))
  out="$(mktemp -d "${TMPDIR:-/tmp}/simffee-fill.XXXXXX")"
  echo "== $(date '+%F %T') attempt $attempt"
  SIMFFEE_FALLBACK_MODEL= "$PY" -u -m engine.cli --all --include-all --seeds "$SEEDS" --cache-defaults \
    --require-complete --stop-on-quota --quiet --out "$out" --cache cache
  rc=$?
  rm -rf "$out"
  case $rc in
    0) echo "== $(date '+%F %T') complete: every scenario replays from cache/"; exit 0 ;;
    1) echo "== invalid engine output; stopping"; exit 1 ;;
    3) why="Groq's daily quota is spent"; wait_min=$WAIT_MIN ;;
    *) why="incomplete (rate limits or invalid replies)"; wait_min=$RETRY_MIN ;;
  esac
  if (( $(date +%s) + wait_min * 60 > deadline )); then
    echo "== giving up after ${MAX_HOURS} h: $why"
    exit 2
  fi
  echo "== $why; next attempt at $(date -v+"${wait_min}"M '+%H:%M' 2>/dev/null || date -d "+${wait_min} min" '+%H:%M')"
  sleep $((wait_min * 60))
done
