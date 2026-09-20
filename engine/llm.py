"""The only place the engine talks to an LLM.

xAI's Responses API (https://api.x.ai/v1/responses) through the `openai` SDK, with the
model selected by SIMFFEE_MODEL. XAI_API_KEY is required for live requests; offline/cache
replay never constructs a client. Requests are sent with `store=False`: nothing about a
twin is kept on the provider's side.

Two capabilities are probed once per model rather than assumed, because they
vary by model and by SDK version:

* `temperature` -- SPEC 4.3 wants 0.7 with a retry at 0.3.
* `text.format` (json_schema) -- schema-constrained JSON. If the model rejects it we
  ask for JSON in words instead. Either way the caller validates the result.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import threading
import time
from pathlib import Path
from typing import Any


def load_environment(path: Path | None = None) -> None:
    path = path if path is not None else Path(__file__).resolve().parent.parent / ".env"
    if not path.exists():
        return
    allowed = {"XAI_API_KEY", "SIMFFEE_MODEL", "SIMFFEE_MAX_TOKENS", "SIMFFEE_MIN_INTERVAL"}
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        key, separator, raw = line.strip().removeprefix("export ").partition("=")
        key = key.strip()
        if not separator or key not in allowed:
            continue
        try:
            values = shlex.split(raw, comments=True)
            if len(values) > 1:
                raise ValueError()
        except ValueError:
            raise ValueError(f"Invalid .env value on line {number}") from None
        os.environ.setdefault(key, values[0] if values else "")


load_environment()
# Defaults MUST match what cache/ was filled with: both are part of the cache key, so a
# fresh clone with no .env replays the committed demo only if these agree (RUN_PLAN D2/D3).
MODEL = os.environ.get("SIMFFEE_MODEL", "qwen/qwen3.8-27b")
# SPEC 4.3 says 300. Reasoning models spend their budget thinking before they
# emit the object, so a 300-500 cap truncates the JSON and the reply is thrown
# away as invalid -- which shows up as retries and fallbacks, not as an error.
MAX_TOKENS = int(os.environ.get("SIMFFEE_MAX_TOKENS", "400"))
BASE_URL = "https://api.x.ai/v1"
TIMEOUT_S = 60.0          # reasoning models think before they answer

# Providers cap requests and tokens per minute. A bulk run is ~350 calls, so without
# pacing a good share come back 429 -- and a 429 that reaches decide.py becomes a
# permanently flagged llm_failed row, which is a transport hiccup masquerading as a
# simulation result. Pace the calls, and honour the retry hint when one gets through anyway.
MIN_INTERVAL_S = float(os.environ.get("SIMFFEE_MIN_INTERVAL", "2.2"))
RATE_LIMIT_RETRIES = 4
MAX_BACKOFF_S = 75.0

_throttle_lock = threading.Lock()
_last_call_at = 0.0
# Token budget as reported by the provider on the previous response. A 429 costs a
# request from the (small) daily cap, so a call that would not fit in the per-minute
# token window waits for the window to reset instead of being sent and refused.
_tokens_remaining: int | None = None
_tokens_reset_at = 0.0
STATS = {"attempts": 0, "responses": 0, "input_tokens": 0, "output_tokens": 0, "quota_failures": 0}


def reset_stats() -> None:
    for key in STATS:
        STATS[key] = 0


def _pace(need_tokens: int = 0) -> None:
    """Block until MIN_INTERVAL_S has passed since the previous call, and until the
    per-minute token window can take a request of `need_tokens`."""
    global _last_call_at, _tokens_remaining
    with _throttle_lock:
        wait = MIN_INTERVAL_S - (time.monotonic() - _last_call_at)
        if _tokens_remaining is not None and _tokens_remaining < need_tokens:
            wait = max(wait, min(_tokens_reset_at - time.monotonic(), 60.0))
            _tokens_remaining = None
        if wait > 0:
            time.sleep(wait)
        _last_call_at = time.monotonic()


def _duration(text: str | None) -> float | None:
    """Rate-limit header durations (x-ratelimit-reset-*): '5ms', '2.19s', '1m2.5s', '4h36m28.8s'."""
    if not text:
        return None
    parts = re.findall(r"([\d.]+)(ms|h|m|s)", text)
    if not parts:
        return None
    unit = {"ms": 0.001, "s": 1.0, "m": 60.0, "h": 3600.0}
    return sum(float(n) * unit[u] for n, u in parts)


def _note_budget(headers) -> None:
    """Remember the token window from a response (or a 429) so the next call can wait."""
    global _tokens_remaining, _tokens_reset_at
    if headers is None:
        return
    try:
        remaining = int(headers.get("x-ratelimit-remaining-tokens"))
    except (TypeError, ValueError):
        return
    reset = _duration(headers.get("x-ratelimit-reset-tokens"))
    if reset is None:
        return
    with _throttle_lock:
        _tokens_remaining = remaining
        _tokens_reset_at = time.monotonic() + reset


def _estimate_tokens(request: dict[str, Any]) -> int:
    """Conservative size of a request as the provider counts it against the window:
    prompt (JSON-heavy, so ~3 chars per token, plus the model's own preamble) + max_tokens."""
    chars = sum(len(str(m.get("content", ""))) for m in request.get("input", []))
    return chars // 3 + 500 + int(request.get("max_output_tokens", MAX_TOKENS))


def _retry_after(message: str) -> float | None:
    """Some providers put the wait in the error text: 'Please try again in 2.19s'."""
    match = re.search(r"try again in (?:(\d+)m)?([\d.]+)s", message)
    if not match:
        return None
    minutes = float(match.group(1) or 0)
    return minutes * 60 + float(match.group(2))


_client = None
_client_error: str | None = None
_temperature_ok: bool | None = None     # None = not probed yet
_structured_ok: bool | None = None
_capability_model = MODEL


class LLMUnavailable(RuntimeError):
    """No credentials, or the SDK is not installed."""


def client():
    """Lazily built so an all-cached run never needs credentials."""
    global _client, _client_error
    if _client is not None:
        return _client
    api_key = os.environ.get("XAI_API_KEY")
    if not api_key:
        raise LLMUnavailable("XAI_API_KEY must be set for live requests")
    try:
        from openai import OpenAI
    except ImportError as exc:                      # pragma: no cover
        _client_error = "openai SDK not installed"
        raise LLMUnavailable(_client_error) from None
    try:
        _client = OpenAI(api_key=api_key, base_url=BASE_URL, timeout=TIMEOUT_S, max_retries=0)
    except Exception as exc:                        # missing key, bad profile
        _client_error = "could not build an xAI client"
        raise LLMUnavailable(_client_error) from None
    return _client


def available() -> bool:
    try:
        client()
        return True
    except LLMUnavailable:
        return False


def _create_with_backoff(request: dict[str, Any]):
    """One paced call, retrying a 429 rather than letting it become a fallback.

    A rate limit says "ask me later", not "this twin could not decide". Only a
    wait longer than MAX_BACKOFF_S (a daily cap, typically) is given up on, and
    that one propagates so the run reports it honestly.
    """
    last: Exception | None = None
    need = _estimate_tokens(request)
    for attempt in range(RATE_LIMIT_RETRIES):
        _pace(need)
        try:
            transport = client().responses
            STATS["attempts"] += 1
            raw = getattr(transport, "with_raw_response", None)
            if raw is None:                 # a stubbed transport in tests
                return transport.create(**request)
            response = raw.create(**request)
            _note_budget(response.headers)
            return response.parse()
        except Exception as exc:
            message = str(exc)
            _note_budget(getattr(getattr(exc, "response", None), "headers", None))
            if "rate_limit" not in message and "429" not in message:
                raise
            last = exc
            wait = _retry_after(message)
            if wait is None:
                wait = 2.0 * (2 ** attempt)
            if wait > MAX_BACKOFF_S:
                raise
            if attempt + 1 < RATE_LIMIT_RETRIES:
                time.sleep(wait + 0.4)
    raise last          # pragma: no cover -- retries exhausted


def _output_text(response) -> str | None:
    """The assistant text of a Responses API reply: `output[].content[].text` for the
    message items (reasoning items are skipped). The SDK's `output_text` shortcut does the
    same and is used when present."""
    shortcut = getattr(response, "output_text", None)
    if isinstance(shortcut, str) and shortcut:
        return shortcut
    parts: list[str] = []
    for item in getattr(response, "output", None) or []:
        if getattr(item, "type", None) != "message":
            continue
        for block in getattr(item, "content", None) or []:
            text = getattr(block, "text", None)
            if isinstance(text, str):
                parts.append(text)
    return "".join(parts) if parts else None


def complete_json(
    system: str,
    user: str,
    schema: dict[str, Any],
    temperature: float,
) -> tuple[dict[str, Any], dict[str, int]]:
    """One call. Returns (parsed object, token usage).

    Raises ValueError when the reply is not usable JSON -- the caller owns the
    retry policy, because what to do with a bad reply is a simulation decision,
    not a transport one.
    """
    global _temperature_ok, _structured_ok, _capability_model
    if _capability_model != MODEL:
        _temperature_ok = _structured_ok = None
        _capability_model = MODEL

    for _ in range(3):          # at most one drop of each unsupported feature
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]
        request: dict[str, Any] = {
            "model": MODEL,
            "max_output_tokens": MAX_TOKENS,
            "input": messages,
            "store": False,             # nothing about a twin is kept server-side
        }
        if _temperature_ok is not False:
            request["temperature"] = temperature
        if _structured_ok is not False:
            request["text"] = {"format": {
                "type": "json_schema", "name": "response", "strict": True, "schema": schema,
            }}

        # Add JSON schema instructions to system prompt
        messages[0]["content"] = system + f"\n\nYou must respond with a JSON object that matches this schema:\n{json.dumps(schema, indent=2)}"

        try:
            response = _create_with_backoff(request)
            _temperature_ok = "temperature" in request
            _structured_ok = "text" in request
            break
        except LLMUnavailable:
            raise
        except Exception as exc:
            message = str(exc).lower()
            unsupported = any(word in message for word in ("not support", "unsupported", "not allowed", "unknown parameter", "not permitted", "invalid"))
            if unsupported and "temperature" in message and "temperature" in request:
                _temperature_ok = False
                continue
            if unsupported and any(word in message for word in ("text.format", "format", "json_schema", "structured", "schema")) and "text" in request:
                _structured_ok = False
                continue
            # Sanitised (no provider text reaches a trajectory), but classified, so a run
            # summary can say *why* a fallback happened. A daily quota is the one that
            # matters operationally: it is not a bug and it will not fix itself in a retry.
            if "rate_limit" in message or "429" in message:
                kind = "quota: daily token limit" if "per day" in message or "tpd" in message else "rate limit"
                STATS["quota_failures"] = STATS.get("quota_failures", 0) + 1
                raise RuntimeError(f"LLM transport failed ({kind})") from None
            if "401" in message or "api key" in message or "authentication" in message:
                raise RuntimeError("LLM transport failed (authentication)") from None
            if "404" in message and "model" in message:
                raise RuntimeError("LLM transport failed (model not found)") from None
            raise RuntimeError("LLM transport failed") from None
    else:
        raise ValueError("could not find a request shape this model accepts")

    usage = {
        "input_tokens": int(getattr(response.usage, "input_tokens", 0) or 0),
        "output_tokens": int(getattr(response.usage, "output_tokens", 0) or 0),
    }
    STATS["responses"] += 1
    for key, value in usage.items():
        STATS[key] += value
    text = _output_text(response)
    if not isinstance(text, str):
        raise ValueError("reply did not contain text")
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text.split("\n", 1)[1] if "\n" in text else text
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        raise ValueError("reply was not JSON") from None
    if not isinstance(parsed, dict):
        raise ValueError("reply was not a JSON object")
    return parsed, usage
