#!/usr/bin/env bash
# The demo, from a fresh clone, no API key needed for the cached part:
#
#   ./tools/serve_demo.sh            # library from cache/ -> API on :8765 -> Vite on :5173
#   ./tools/serve_demo.sh --no-web   # API only (for curl)
#
# 1. Replays every library scenario x seeds 0-2 from the committed cache/ into runs/library
#    (gitignored). Strict: exits if a single decision is missing from the cache.
# 2. Starts api/server.py on that library. Live what-ifs need GROQ_API_KEY in .env; without
#    it the API still serves cached scenarios and answers plans that need no new decisions.
# 3. Starts the Vite dev server unless --no-web.
set -euo pipefail
cd "$(dirname "$0")/.."

PY="${PYTHON:-python3}"
if [[ -x "$HOME/.venvs/simffee/bin/python" ]]; then PY="$HOME/.venvs/simffee/bin/python"; fi
SEEDS="${SEEDS:-0-2}"
LIB="runs/library"
WEB=1
[[ "${1:-}" == "--no-web" ]] && WEB=0

echo "== 1/3 library from cache/ (seeds $SEEDS) =="
rm -rf "$LIB"
"$PY" -m engine.cli --all --seeds "$SEEDS" --offline --quiet --require-complete --out "$LIB" --cache cache
"$PY" tools/validate.py "$LIB"

echo "== 2/3 API on http://127.0.0.1:8765 =="
"$PY" -m api.server --library "$LIB" --cache cache --live-dir runs/live --port 8765 --timeout 60 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true' EXIT
sleep 1
curl -sf http://127.0.0.1:8765/health >/dev/null && echo "   API up" || { echo "   API failed to start"; exit 1; }

if [[ $WEB -eq 1 ]]; then
  echo "== 3/3 web on http://localhost:5173 =="
  [[ -d node_modules ]] || npm ci
  npm run dev -- --port 5173 --strictPort
else
  echo "== API only; Ctrl-C to stop =="
  wait $API_PID
fi
