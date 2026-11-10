"""SPEC_FUNCTIONAL 5 / ROADMAP A3 — the local what-if API. Stdlib only.

    python3 -m api.server --library /path/to/promoted/runs --cache /path/to/cache
    python3 -m api.server --library ... --cache ... --offline       # never calls the model

    POST /whatif   {"text": "open at 6 and add croissants", "parent": "baseline", "seeds": [0]}
    POST /run      {"scenario": {...SPEC_FUNCTIONAL 2...}, "seeds": [0]}     # structured, no translation
    GET  /library                                                            # promoted bundle summary + live runs
    GET  /runs/<run_id>    # 202 {"status": "running"} while a timed-out run continues;
                           # 200 with the full answer ("done"), an error ("failed"), or just
                           # the registry entry for a run from an earlier process ("recorded")
    GET  /health

Runs on the demo laptop; the key lives in .env; no GPU anywhere. Nothing here writes to
public/ or the library directory.

Browser access is limited to the local frontend: CORS is granted only to the allowed
origins (the Vite dev/preview servers by default, more with --allow-origin), a request
carrying any other Origin is refused, POST bodies must be `application/json` (so a
cross-site form or `text/plain` post cannot skip the CORS preflight), and the Host header
must name this server (so a DNS-rebinding page cannot reach it under another name).
Clients without an Origin header (curl, scripts) are unaffected.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
from urllib.parse import urlsplit
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from api.service import WhatIfService  # noqa: E402
from engine.cache import CACHE  # noqa: E402
from engine.loader import SCENARIO_ID  # noqa: E402

SERVICE: WhatIfService | None = None
DEFAULT_ORIGINS = tuple(f"http://{host}:{port}" for port in (5173, 4173)
                        for host in ("localhost", "127.0.0.1"))
ALLOWED_ORIGINS: set[str] = set(DEFAULT_ORIGINS)
ALLOWED_HOSTS: set[str] = set()       # filled from the bound port in main(); empty = any


MAX_SEEDS = 10


class BadRequest(ValueError):
    """A client error: answered with 400 and this message, never a 500."""


def _seed(value) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise BadRequest("seeds must be whole numbers, e.g. [0, 1, 2] or \"0-2\"")
    try:
        seed = int(value.strip()) if isinstance(value, str) else value
    except ValueError:
        raise BadRequest(f"seed {value!r} is not a whole number") from None
    if seed < 0:
        raise BadRequest("seeds must be >= 0")
    return seed


def parse_seeds(value) -> list[int]:
    """[0, 1], "0-2", "0,2" or a single number -> sorted distinct seeds. Raises BadRequest."""
    if value is None:
        return [0]
    out: set[int] = set()
    if isinstance(value, list):
        out = {_seed(v) for v in value}
    elif isinstance(value, (int, str)) and not isinstance(value, bool):
        for part in str(value).split(","):
            part = part.strip()
            if "-" in part:
                a, b = (_seed(x) for x in part.split("-", 1))
                if b < a or b - a >= MAX_SEEDS:
                    raise BadRequest(f"seed range {part!r} must ascend and hold at most {MAX_SEEDS} seeds")
                out.update(range(a, b + 1))
            elif part:
                out.add(_seed(part))
    else:
        raise BadRequest("seeds must be a list or a string like \"0-2\"")
    if len(out) > MAX_SEEDS:
        raise BadRequest(f"at most {MAX_SEEDS} seeds per request")
    return sorted(out) or [0]


def _text(body: dict, key: str, required: bool = False) -> str:
    value = body.get(key)
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise BadRequest(f"{key} must be a string")
    value = value.strip()
    if required and not value:
        raise BadRequest(f"{key} is required")
    return value


class Handler(BaseHTTPRequestHandler):
    server_version = "simffee/0.3"

    def _send(self, code: int, body: dict | None) -> None:
        data = b"" if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        if body is not None:
            self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(data)

    def _refused(self) -> bool:
        """Send 403 and return True for a request this local server must not serve."""
        host = (self.headers.get("Host") or "").lower()
        if ALLOWED_HOSTS and host not in ALLOWED_HOSTS:
            self._send(403, {"error": "unexpected Host header"})
            return True
        origin = self.headers.get("Origin")
        if origin is not None and origin not in ALLOWED_ORIGINS:
            self._send(403, {"error": "origin not allowed; start the server with --allow-origin to add one"})
            return True
        return False

    def _body(self) -> dict:
        ctype = (self.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
        if ctype != "application/json":
            raise ValueError("Content-Type must be application/json")
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise ValueError("Content-Length must be a number") from None
        raw = self.rfile.read(n) if n else b"{}"
        try:
            body = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            raise ValueError("body is not JSON")
        if not isinstance(body, dict):
            raise ValueError("body must be a JSON object")
        return body

    def do_OPTIONS(self) -> None:  # noqa: N802
        if self._refused():
            return
        self._send(204, None)

    def do_GET(self) -> None:  # noqa: N802
        assert SERVICE is not None
        if self._refused():
            return
        path = urlsplit(self.path).path
        if path == "/health":
            return self._send(200, SERVICE.health())
        if path == "/library":
            return self._send(200, SERVICE.library_summary())
        if path.startswith("/runs/"):
            rid = path[len("/runs/"):]
            status = SERVICE.run_status(rid) if SCENARIO_ID.fullmatch(rid) else None
            if status is None:
                return self._send(404, {"error": f"no live run {rid!r}"})
            return self._send(202 if status["status"] == "running" else 200, status)
        self._send(404, {"error": "unknown path", "paths": ["/health", "/library", "/runs/<id>", "POST /whatif", "POST /run"]})

    def do_POST(self) -> None:  # noqa: N802
        assert SERVICE is not None
        if self._refused():
            return
        try:
            body = self._body()
        except ValueError as exc:
            return self._send(400, {"error": str(exc)})
        path = urlsplit(self.path).path
        try:
            if path == "/whatif":
                text = _text(body, "text", required=True)
                parent = _text(body, "parent") or "baseline"
                out = SERVICE.whatif(text, parent=parent,
                                     seeds=parse_seeds(body.get("seeds")), fresh=body.get("fresh") is True)
            elif path == "/run":
                sc = body.get("scenario")
                if not isinstance(sc, dict) or "id" not in sc or "overrides" not in sc:
                    return self._send(400, {"error": "scenario with id and overrides is required"})
                out = SERVICE.run(sc, seeds=parse_seeds(body.get("seeds")))
            elif path == "/review":
                run_id = _text(body, "run_id", required=True)
                out = SERVICE.review(run_id, refresh=body.get("refresh") is True)
            elif path == "/sketch":
                sketch = body.get("sketch")
                if not isinstance(sketch, dict) or not {"headline", "movements", "drivers", "net"} <= sketch.keys():
                    return self._send(400, {"error": "sketch with headline, movements, drivers and net is required"})
                out = SERVICE.sketch(_text(body, "text"), sketch)
            else:
                return self._send(404, {"error": "unknown path"})
        except BadRequest as exc:
            return self._send(400, {"error": str(exc)})
        except Exception as exc:  # never leak a traceback to the demo screen; log it
            self.log_error("%s", repr(exc))
            return self._send(500, {"error": "internal error", "detail": str(exc)[:200]})
        self._send(400 if "error" in out else 200, out)

    def log_message(self, fmt, *args) -> None:  # quieter default log
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main() -> int:
    global SERVICE
    ap = argparse.ArgumentParser(prog="api.server")
    ap.add_argument("--library", type=pathlib.Path, required=True,
                    help="promoted run directory (baseline/, cf_null/, ... with rows and snapshots)")
    ap.add_argument("--cache", type=pathlib.Path, default=CACHE)
    ap.add_argument("--live-dir", type=pathlib.Path, default=ROOT / "runs" / "live")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--timeout", type=float, default=240.0, help="seconds before a live run falls back")
    ap.add_argument("--offline", action="store_true", help="never call the model (cached decisions only)")
    ap.add_argument("--allow-origin", action="append", default=[], metavar="ORIGIN",
                    help="also grant browser access to this origin, e.g. http://localhost:5174 (repeatable)")
    args = ap.parse_args()

    ALLOWED_ORIGINS.update(o.rstrip("/") for o in args.allow_origin)
    ALLOWED_HOSTS.update({f"127.0.0.1:{args.port}", f"localhost:{args.port}"})

    SERVICE = WhatIfService(args.library, cache_dir=args.cache, live_dir=args.live_dir,
                            offline=args.offline, timeout_s=args.timeout)
    h = SERVICE.health()
    print(f"simffee what-if API on http://127.0.0.1:{args.port}  model {h['model']}  "
          f"llm {'yes' if h['llm'] else 'no'}  library seeds {h['library_seeds']}  cache files {h['cache_files']}")
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
