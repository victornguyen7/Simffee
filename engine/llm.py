"""The only place the engine talks to an LLM.

Groq's OpenAI-compatible Chat Completions API (https://api.groq.com/openai/v1) through
the `openai` SDK, with the model selected by SIMFFEE_MODEL. GROQ_API_KEY is required for
live requests; offline/cache replay never constructs a client.

Fallback: when Groq refuses for tokens (a daily quota, or a rate limit that outlasts the
retries), the same request goes to a local Ollama server's OpenAI-compatible endpoint
(SIMFFEE_FALLBACK_URL, default http://localhost:11434/v1) with SIMFFEE_FALLBACK_MODEL
(default qwen3.8; empty disables). Groq is then skipped for a cool-down, and every answer
records which model actually gave it (answered_by()), so provenance stays honest.

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
import sys
import threading
import time
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from typing import Any


def load_environment(path: Path | None = None) -> None:
    path = path if path is not None else Path(__file__).resolve().parent.parent / ".env"
    if not path.exists():
        return
    allowed = {"GROQ_API_KEY", "SIMFFEE_MODEL", "SIMFFEE_MAX_TOKENS", "SIMFFEE_MIN_INTERVAL",
               "SIMFFEE_TIMEOUT_S", "SIMFFEE_REASONING_EFFORT", "SIMFFEE_DECISION_MODEL",
               "SIMFFEE_FALLBACK_MODEL", "SIMFFEE_FALLBACK_URL", "SIMFFEE_FALLBACK_MAX_TOKENS",
               "SIMFFEE_FALLBACK_REASONING_EFFORT"}
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
DEFAULT_MODEL = "qwen/qwen3.8-27b"
DEFAULT_MAX_TOKENS = 400
MODEL = os.environ.get("SIMFFEE_MODEL", DEFAULT_MODEL)
DECISION_MODEL = os.environ.get("SIMFFEE_DECISION_MODEL", "").strip() or None
# SPEC 4.3 says 300. Reasoning models spend their budget thinking before they
# emit the object, so a 300-500 cap truncates the JSON and the reply is thrown
# away as invalid -- which shows up as retries and fallbacks, not as an error.
MAX_TOKENS = int(os.environ.get("SIMFFEE_MAX_TOKENS", str(DEFAULT_MAX_TOKENS)))
BASE_URL = "https://api.groq.com/openai/v1"

# Local Ollama, used only when Groq is out of tokens. Local Qwen3 models "think" before they
# answer and, left on, spent a 2000-token budget thinking without ever answering (qwen3:4b,
# 75 s, empty reply); with reasoning_effort "none" the same request answers in ~4 s and ~60
# tokens. Thinking is therefore off by default ("" sends no setting, for models without it).
FALLBACK_MODEL = os.environ.get("SIMFFEE_FALLBACK_MODEL", "qwen3.8").strip()
FALLBACK_URL = os.environ.get("SIMFFEE_FALLBACK_URL", "http://localhost:11434/v1").strip()
FALLBACK_MAX_TOKENS = int(os.environ.get("SIMFFEE_FALLBACK_MAX_TOKENS", "800"))
FALLBACK_REASONING_EFFORT = os.environ.get("SIMFFEE_FALLBACK_REASONING_EFFORT", "none").strip().lower()
# How long Groq is skipped after it refuses: a daily quota will not clear in a minute.
PRIMARY_COOLDOWN_S = {"quota": 900.0, "rate limit": 60.0}
TIMEOUT_S = float(os.environ.get("SIMFFEE_TIMEOUT_S", "180"))          # reasoning models think before they answer

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
_local_stats: ContextVar[dict[str, int] | None] = ContextVar("llm_stats", default=None)


@contextmanager
def isolated_stats():
    counters = {key: 0 for key in STATS}
    token = _local_stats.set(counters)
    try:
        yield counters
    finally:
        _local_stats.reset(token)


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
    chars = sum(len(str(m.get("content", ""))) for m in request.get("messages", []))
    return chars // 3 + 500 + int(request.get("max_tokens", MAX_TOKENS))


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
_fallback_client = None
_fallback_caps: dict[str, bool | None] = {"temperature": None, "structured": None}
_primary_blocked_until = 0.0
_primary_block_reason = "LLM transport failed (rate limit)"   # Groq's refusal that started the cool-down
_fallback_warned: set[str] = set()
_answered_by: ContextVar[str | None] = ContextVar("llm_answered_by", default=None)


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
        from openai import OpenAI
    except ImportError as exc:                      # pragma: no cover
        _client_error = "openai SDK not installed"
        raise LLMUnavailable(_client_error) from None
    try:
        _client = OpenAI(api_key=api_key, base_url=BASE_URL, timeout=TIMEOUT_S, max_retries=0)
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


def fallback_label() -> str | None:
    """How a fallback answer is labelled in provenance, or None when no fallback is set."""
    return f"ollama/{FALLBACK_MODEL}" if FALLBACK_MODEL and FALLBACK_URL else None


def fallback_active() -> bool:
    """True while Groq is being skipped after refusing for tokens."""
    return bool(fallback_label()) and time.monotonic() < _primary_blocked_until


def fallback_options() -> dict[str, Any]:
    """Extra request fields for the fallback; part of its cache identity, as they change answers."""
    return {"reasoning_effort": FALLBACK_REASONING_EFFORT} if FALLBACK_REASONING_EFFORT else {}


def take_answered_by() -> str | None:
    """The model that answered the last complete_json call in this context, then cleared:
    the primary model name, or fallback_label(). None when nothing has answered (or a test
    stubbed complete_json), in which case the caller's requested model is the answer."""
    value = _answered_by.get()
    _answered_by.set(None)
    return value


def _create_fallback(request: dict[str, Any]):
    """One call to the local Ollama server. No pacing: there is no provider quota locally."""
    global _fallback_client
    stats = _local_stats.get() or STATS
    if _fallback_client is None:
        from openai import OpenAI
        # Ollama ignores the key, but the SDK requires one.
        _fallback_client = OpenAI(api_key="ollama", base_url=FALLBACK_URL, timeout=TIMEOUT_S, max_retries=0)
    stats["attempts"] += 1
    return _fallback_client.chat.completions.create(**request)


def _create_with_backoff(request: dict[str, Any]):
    """One paced call, retrying a 429 rather than letting it become a fallback.

    A rate limit says "ask me later", not "this twin could not decide". Only a
    wait longer than MAX_BACKOFF_S (a daily cap, typically) is given up on, and
    that one propagates so the run reports it honestly.
    """
    last: Exception | None = None
    stats = _local_stats.get() or STATS
    need = _estimate_tokens(request)
    for attempt in range(RATE_LIMIT_RETRIES):
        _pace(need)
        try:
            transport = client().chat.completions
            stats["attempts"] += 1
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
    """The assistant text of a Chat Completions reply (`choices[0].message.content`).
    Some reasoning models prepend a <think>...</think> block; it is not part of the answer."""
    choices = getattr(response, "choices", None) or []
    if not choices:
        return None
    text = getattr(getattr(choices[0], "message", None), "content", None)
    if not isinstance(text, str):
        return None
    return re.sub(r"^\s*<think>.*?</think>", "", text, flags=re.DOTALL)


def decision_model() -> str:
    return DECISION_MODEL or MODEL


# Groq's `reasoning_effort` values per model family. Nothing is sent unless an effort is
# asked for (argument or SIMFFEE_REASONING_EFFORT) and the model supports it, so the
# default request -- and therefore the committed cache key -- carries no reasoning option.
_REASONING_EFFORTS = {
    "openai/gpt-oss-": {"low", "medium", "high"},
    "qwen/": {"none", "default"},
}


def _supported_efforts(model: str) -> set[str]:
    return next((v for prefix, v in _REASONING_EFFORTS.items() if model.startswith(prefix)), set())


def inference_options(reasoning_effort: str | None = None, *, model: str | None = None) -> dict[str, Any]:
    """An explicit effort (translation and review ask for "high") wins over
    SIMFFEE_REASONING_EFFORT, which tunes decisions; an explicit effort the model cannot take
    is dropped silently, a configured one is an error."""
    model = model or MODEL
    supported = _supported_efforts(model)
    requested = (reasoning_effort or "").strip().lower()
    if requested:
        return {"reasoning_effort": requested} if requested in supported else {}
    configured = os.environ.get("SIMFFEE_REASONING_EFFORT", "").strip().lower()
    if not configured:
        return {}
    if configured not in supported:
        raise ValueError(f"SIMFFEE_REASONING_EFFORT for {model} must be one of "
                         + (", ".join(sorted(supported)) or "(nothing: this model has no reasoning control)"))
    return {"reasoning_effort": configured}


def complete_json(
    system: str,
    user: str,
    schema: dict[str, Any],
    temperature: float,
    *,
    reasoning_effort: str | None = None,
    model: str | None = None,
) -> tuple[dict[str, Any], dict[str, int]]:
    """One call. Returns (parsed object, token usage); answered_by() says who answered.

    Raises ValueError when the reply is not usable JSON -- the caller owns the
    retry policy, because what to do with a bad reply is a simulation decision,
    not a transport one.
    """
    global _temperature_ok, _structured_ok, _capability_model, _primary_blocked_until, _primary_block_reason
    stats = _local_stats.get() or STATS
    model = model or MODEL
    _answered_by.set(None)
    if _capability_model != model:
        _temperature_ok = _structured_ok = None
        _capability_model = model

    if fallback_active():
        primary_error = RuntimeError(_primary_block_reason)
    else:
        caps = {"temperature": _temperature_ok, "structured": _structured_ok}
        try:
            out = _request_json(_create_with_backoff, system, user, schema, temperature, model=model,
                                options=inference_options(reasoning_effort, model=model),
                                max_tokens=MAX_TOKENS, caps=caps, stats=stats)
            _answered_by.set(model)
            return out
        except RuntimeError as exc:
            kind = _out_of_tokens(exc)
            if kind is None or not fallback_label():
                raise
            _primary_blocked_until = time.monotonic() + PRIMARY_COOLDOWN_S[kind]
            _primary_block_reason = str(exc)
            primary_error = exc
        finally:
            _temperature_ok, _structured_ok = caps["temperature"], caps["structured"]

    try:
        out = _request_json(_create_fallback, system, user, schema, temperature, model=FALLBACK_MODEL,
                            options=fallback_options(), max_tokens=FALLBACK_MAX_TOKENS,
                            caps=_fallback_caps, stats=stats)
    except RuntimeError as exc:
        # The fallback is down too. Report Groq's reason (it is the root cause) and say once,
        # server-side, why the fallback could not help.
        reason = str(exc)
        if reason not in _fallback_warned:
            _fallback_warned.add(reason)
            print(f"[llm] fallback {fallback_label()} at {FALLBACK_URL} failed: {reason}", file=sys.stderr)
        raise primary_error from None
    _answered_by.set(fallback_label())
    return out


def _out_of_tokens(exc: RuntimeError) -> str | None:
    """'quota' or 'rate limit' when the primary refused for tokens, else None."""
    text = str(exc)
    if text.startswith("LLM transport failed (quota"):
        return "quota"
    if text == "LLM transport failed (rate limit)":
        return "rate limit"
    return None


def _request_json(create, system: str, user: str, schema: dict[str, Any], temperature: float, *,
                  model: str, options: dict[str, Any], max_tokens: int, caps: dict[str, bool | None],
                  stats: dict[str, int]) -> tuple[dict[str, Any], dict[str, int]]:
    """Send one request through `create`, dropping unsupported features (recorded in `caps`),
    classify transport failures without provider text, and parse the JSON reply."""
    for _ in range(3):          # at most one drop of each unsupported feature
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]
        request: dict[str, Any] = {
            "model": model,
            **options,
            "max_tokens": max_tokens,
            "messages": messages,
        }
        if caps["temperature"] is not False:
            request["temperature"] = temperature
        if caps["structured"] is not False:
            request["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": "response", "strict": True, "schema": schema},
            }

        # Add JSON schema instructions to system prompt
        messages[0]["content"] = system + f"\n\nYou must respond with a JSON object that matches this schema:\n{json.dumps(schema, indent=2)}"

        try:
            response = create(request)
            caps["temperature"] = "temperature" in request
            caps["structured"] = "response_format" in request
            break
        except LLMUnavailable:
            raise
        except Exception as exc:
            message = str(exc).lower()
            unsupported = any(word in message for word in ("not support", "unsupported", "not allowed", "unknown parameter", "not permitted", "invalid"))
            if unsupported and "temperature" in message and "temperature" in request:
                caps["temperature"] = False
                continue
            if unsupported and any(word in message for word in ("response_format", "json_schema", "structured", "schema")) and "response_format" in request:
                caps["structured"] = False
                continue
            # Sanitised (no provider text reaches a trajectory), but classified, so a run
            # summary can say *why* a fallback happened. A daily quota is the one that
            # matters operationally: it is not a bug and it will not fix itself in a retry.
            if "rate_limit" in message or "429" in message:
                kind = "quota: daily token limit" if "per day" in message or "tpd" in message else "rate limit"
                stats["quota_failures"] = stats.get("quota_failures", 0) + 1
                raise RuntimeError(f"LLM transport failed ({kind})") from None
            if "401" in message or "api key" in message or "authentication" in message:
                raise RuntimeError("LLM transport failed (authentication)") from None
            if "404" in message and "model" in message:
                raise RuntimeError("LLM transport failed (model not found)") from None
            if isinstance(exc, TimeoutError) or type(exc).__name__ == "APITimeoutError":
                raise RuntimeError("LLM transport failed (timeout)") from None
            if isinstance(exc, ConnectionError) or type(exc).__name__ == "APIConnectionError":
                raise RuntimeError("LLM transport failed (connection)") from None
            # The class name is safe to surface (no provider text) and makes the failure diagnosable.
            raise RuntimeError(f"LLM transport failed ({type(exc).__name__})") from None
    else:
        raise ValueError("could not find a request shape this model accepts")

    raw_usage = getattr(response, "usage", None)
    usage = {
        "input_tokens": int(getattr(raw_usage, "prompt_tokens", 0) or 0),
        "output_tokens": int(getattr(raw_usage, "completion_tokens", 0) or 0),
    }
    stats["responses"] += 1
    for key, value in usage.items():
        stats[key] += value
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
