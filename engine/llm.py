"""The only place the engine talks to an LLM.

Anthropic SDK, one cheap model, JSON constrained by a json_schema. Runs on
Claude Haiku 4.5 -- SPEC 4.3 asks for a cheap model, and the Opus/Sonnet 5
family rejects `temperature` outright. Override with SIMFFEE_MODEL.

Two capabilities are probed once per process rather than assumed, because they
vary by model and by SDK version:

* `temperature` -- SPEC 4.3 wants 0.7 with a retry at 0.3. The Python SDK
  dropped it from the typed signature in 1.x, so it goes through `extra_body`.
  If the API rejects it, we stop sending it and the "retry at 0.3" becomes a
  plain second attempt. Seed-to-seed variance still exists either way: each
  seed is its own cache key, so each seed gets its own sample.
* `output_config.format` -- schema-constrained JSON. If the model rejects it we
  ask for JSON in words instead. Either way the caller validates the result.
"""

from __future__ import annotations

import json
import os
from typing import Any

MODEL = os.environ.get("SIMFFEE_MODEL", "claude-haiku-4-5")
MAX_TOKENS = 300          # SPEC 4.3
TIMEOUT_S = 30.0

_client = None
_client_error: str | None = None
_temperature_ok: bool | None = None     # None = not probed yet
_structured_ok: bool | None = None


class LLMUnavailable(RuntimeError):
    """No credentials, or the SDK is not installed."""


def client():
    """Lazily built so an all-cached run never needs credentials."""
    global _client, _client_error
    if _client is not None:
        return _client
    if _client_error is not None:
        raise LLMUnavailable(_client_error)
    try:
        import anthropic
    except ImportError as exc:                      # pragma: no cover
        _client_error = f"anthropic SDK not installed: {exc}"
        raise LLMUnavailable(_client_error) from exc
    try:
        _client = anthropic.Anthropic(timeout=TIMEOUT_S, max_retries=3)
    except Exception as exc:                        # missing key, bad profile
        _client_error = f"could not build an Anthropic client: {exc}"
        raise LLMUnavailable(_client_error) from exc
    return _client


def available() -> bool:
    try:
        client()
        return True
    except LLMUnavailable:
        return False


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
    global _temperature_ok, _structured_ok
    import anthropic

    for _ in range(3):          # at most one drop of each unsupported feature
        request: dict[str, Any] = {
            "model": MODEL,
            "max_tokens": MAX_TOKENS,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        }
        if _structured_ok is not False:
            request["output_config"] = {"format": {"type": "json_schema", "schema": schema}}
        else:
            request["system"] = system + "\n\nReply with a single JSON object and nothing else."
        if _temperature_ok is not False:
            request["extra_body"] = {"temperature": temperature}

        try:
            response = client().messages.create(**request)
            if "extra_body" in request:
                _temperature_ok = True
            if "output_config" in request:
                _structured_ok = True
            break
        except (anthropic.BadRequestError, TypeError) as exc:
            message = str(exc).lower()
            if "temperature" in message and _temperature_ok is not False:
                _temperature_ok = False
                continue
            if _structured_ok is not False and (
                "output_config" in message or "format" in message or "schema" in message
            ):
                _structured_ok = False
                continue
            raise
    else:
        raise ValueError("could not find a request shape this model accepts")

    text = "".join(block.text for block in response.content if block.type == "text").strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text.split("\n", 1)[1] if "\n" in text else text
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"reply was not JSON: {text[:200]!r}") from exc
    if not isinstance(parsed, dict):
        raise ValueError(f"reply was not a JSON object: {text[:200]!r}")

    usage = {
        "input_tokens": response.usage.input_tokens,
        "output_tokens": response.usage.output_tokens,
    }
    return parsed, usage
