"""The only place the engine talks to an LLM.

Groq SDK, with the model selected by SIMFFEE_MODEL. GROQ_API_KEY is required
for live requests; offline/cache replay never constructs a client.

Two capabilities are probed once per model rather than assumed, because they
vary by model and by SDK version:

* `temperature` -- SPEC 4.3 wants 0.7 with a retry at 0.3.
* `response_format` -- schema-constrained JSON. If the model rejects it we
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
    allowed = {"GROQ_API_KEY", "SIMFFEE_MODEL", "SIMFFEE_MAX_TOKENS", "SIMFFEE_MIN_INTERVAL"}
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
TIMEOUT_S = 30.0

# Groq's on-demand tier caps requests per minute, and the `compound-*` models
# fan out to sub-models with their own smaller token-per-minute caps. A bulk run
# is ~350 calls, so without pacing roughly half of them come back 429 -- and a
# 429 that reaches decide.py becomes a permanently flagged llm_failed row, which
# is a transport hiccup masquerading as a simulation result. Pace the calls, and
# honour the retry hint when one gets through anyway.
MIN_INTERVAL_S = float(os.environ.get("SIMFFEE_MIN_INTERVAL", "2.2"))
RATE_LIMIT_RETRIES = 4
MAX_BACKOFF_S = 75.0

_throttle_lock = threading.Lock()
_last_call_at = 0.0
STATS = {"attempts": 0, "responses": 0, "input_tokens": 0, "output_tokens": 0, "quota_failures": 0}


def reset_stats() -> None:
    for key in STATS:
        STATS[key] = 0


def _pace() -> None:
    """Block until MIN_INTERVAL_S has passed since the previous call."""
    global _last_call_at
    with _throttle_lock:
        wait = MIN_INTERVAL_S - (time.monotonic() - _last_call_at)
        if wait > 0:
            time.sleep(wait)
        _last_call_at = time.monotonic()


def _retry_after(message: str) -> float | None:
    """Groq puts the wait in the error text: 'Please try again in 2.19s'."""
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
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise LLMUnavailable("GROQ_API_KEY must be set for live requests")
    try:
        from groq import Groq as GroqClient
    except ImportError as exc:                      # pragma: no cover
        _client_error = "groq SDK not installed"
        raise LLMUnavailable(_client_error) from None
    try:
        _client = GroqClient(api_key=api_key, timeout=TIMEOUT_S, max_retries=0)
    except Exception as exc:                        # missing key, bad profile
        _client_error = "could not build a Groq client"
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
    for attempt in range(RATE_LIMIT_RETRIES):
        _pace()
        try:
            transport = client().chat.completions
            STATS["attempts"] += 1
            return transport.create(**request)
        except Exception as exc:
            message = str(exc)
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
            "max_tokens": MAX_TOKENS,
            "messages": messages,
        }
        if _temperature_ok is not False:
            request["temperature"] = temperature
        if _structured_ok is not False:
            request["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": "response", "strict": True, "schema": schema},
            }

        # Add JSON schema instructions to system prompt
        messages[0]["content"] = system + f"\n\nYou must respond with a JSON object that matches this schema:\n{json.dumps(schema, indent=2)}"

        try:
            response = _create_with_backoff(request)
            _temperature_ok = "temperature" in request
            _structured_ok = "response_format" in request
            break
        except LLMUnavailable:
            raise
        except Exception as exc:
            message = str(exc).lower()
            unsupported = any(word in message for word in ("not support", "unsupported", "not allowed", "unknown parameter", "not permitted"))
            if unsupported and "temperature" in message and "temperature" in request:
                _temperature_ok = False
                continue
            if unsupported and any(word in message for word in ("response_format", "json_schema", "structured")) and "response_format" in request:
                _structured_ok = False
                continue
            # Sanitised (no provider text reaches a trajectory), but classified, so a run
            # summary can say *why* a fallback happened. A daily quota is the one that
            # matters operationally: it is not a bug and it will not fix itself in a retry.
            if "rate_limit" in message or "429" in message:
                kind = "quota: daily token limit" if "per day" in message or "tpd" in message else "rate limit"
                STATS["quota_failures"] = STATS.get("quota_failures", 0) + 1
                raise RuntimeError(f"LLM transport failed ({kind})") from None
            if "401" in message or "invalid api key" in message or "authentication" in message:
                raise RuntimeError("LLM transport failed (authentication)") from None
            if "404" in message and "model" in message:
                raise RuntimeError("LLM transport failed (model not found)") from None
            raise RuntimeError("LLM transport failed") from None
    else:
        raise ValueError("could not find a request shape this model accepts")

    usage = {
        "input_tokens": response.usage.prompt_tokens,
        "output_tokens": response.usage.completion_tokens,
    }
    STATS["responses"] += 1
    for key, value in usage.items():
        STATS[key] += value
    text = response.choices[0].message.content
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
