"""Groq -> local Ollama fallback: only when Groq is out of tokens, with honest provenance."""

import io
import json
import shutil
import sys
import tempfile
import threading
import unittest
from contextlib import redirect_stderr
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engine import cache, decide, llm, translate  # noqa: E402

GOOD = {"choice": "starbucks", "primary_driver": "hours", "secondary_driver": None,
        "valence": 0.2, "reasoning": "My place was shut, so I went to Starbucks."}
QUOTA = RuntimeError("Error code: 429 - rate_limit_exceeded: Limit 500000 tokens per day (TPD), try again in 9m3s")
MINUTE = RuntimeError("Error code: 429 - rate_limit_exceeded on tokens per minute")


def reply(content=None):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content or json.dumps(GOOD)))],
                           usage=SimpleNamespace(prompt_tokens=10, completion_tokens=5))


class FallbackCase(unittest.TestCase):
    def setUp(self):
        for name, value in [("FALLBACK_MODEL", "qwen3.8"), ("FALLBACK_URL", "http://localhost:11434/v1"),
                            ("_primary_blocked_until", 0.0), ("_fallback_client", None)]:
            patcher = patch.object(llm, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        llm._fallback_caps.update(temperature=None, structured=None)
        llm._fallback_warned.clear()
        llm.take_answered_by()


class Routing(FallbackCase):
    def test_quota_switches_to_fallback_and_skips_groq_while_cooling_down(self):
        with patch.object(llm, "_create_with_backoff", side_effect=QUOTA) as groq, \
                patch.object(llm, "_create_fallback", return_value=reply()) as local:
            parsed, _ = llm.complete_json("system", "user", {}, 0.7)
            self.assertEqual(parsed["choice"], "starbucks")
            self.assertEqual(llm.take_answered_by(), "ollama/qwen3.8")
            self.assertTrue(llm.fallback_active())
            llm.complete_json("system", "user", {}, 0.7)
        self.assertEqual(groq.call_count, 1)            # the second call went straight to Ollama
        self.assertEqual(local.call_count, 2)
        self.assertEqual(local.call_args.args[0]["model"], "qwen3.8")
        self.assertEqual(local.call_args.args[0]["max_tokens"], llm.FALLBACK_MAX_TOKENS)
        self.assertEqual(local.call_args.args[0]["reasoning_effort"], "none")   # thinking off by default

    def test_groq_is_tried_again_after_the_cooldown(self):
        with patch.object(llm, "_create_with_backoff", side_effect=[MINUTE, reply()]) as groq, \
                patch.object(llm, "_create_fallback", return_value=reply()):
            llm.complete_json("system", "user", {}, 0.7)
            self.assertEqual(llm.take_answered_by(), "ollama/qwen3.8")
            with patch.object(llm, "_primary_blocked_until", 0.0):
                llm.complete_json("system", "user", {}, 0.7)
            self.assertEqual(llm.take_answered_by(), llm.MODEL)
        self.assertEqual(groq.call_count, 2)

    def test_other_failures_do_not_switch(self):
        for error, label in [(RuntimeError("401 invalid api key"), "authentication"),
                             (TimeoutError("slow"), "timeout"),
                             (RuntimeError("404 model not found"), "model not found")]:
            with self.subTest(label), patch.object(llm, "_create_with_backoff", side_effect=error), \
                    patch.object(llm, "_create_fallback") as local, self.assertRaises(RuntimeError) as caught:
                llm.complete_json("system", "user", {}, 0.7)
            local.assert_not_called()
            self.assertIn(label, str(caught.exception))

    def test_fallback_down_reports_groqs_reason_and_warns_once(self):
        down = ConnectionError("refused")
        stderr = io.StringIO()
        with patch.object(llm, "_create_with_backoff", side_effect=QUOTA), \
                patch.object(llm, "_create_fallback", side_effect=down), redirect_stderr(stderr):
            for _ in range(2):
                with self.assertRaises(RuntimeError) as caught:
                    llm.complete_json("system", "user", {}, 0.7)
                self.assertEqual(str(caught.exception), "LLM transport failed (quota: daily token limit)")
        self.assertEqual(stderr.getvalue().count("fallback ollama/qwen3.8"), 1)
        self.assertIsNone(llm.take_answered_by())

    def test_disabled_fallback_is_never_called(self):
        with patch.object(llm, "FALLBACK_MODEL", ""), patch.object(llm, "_create_with_backoff", side_effect=QUOTA), \
                patch.object(llm, "_create_fallback") as local, self.assertRaises(RuntimeError):
            llm.complete_json("system", "user", {}, 0.7)
        local.assert_not_called()
        self.assertFalse(llm.fallback_active())


class StopOnQuota(FallbackCase):
    """`engine.cli --stop-on-quota` (cache fills): a spent daily quota ends the run."""

    def test_daily_quota_stops_only_when_asked_and_nothing_can_answer(self):
        cases = [
            (dict(STOP_ON_QUOTA=True, FALLBACK_MODEL=""), QUOTA, llm.QuotaExhausted),
            (dict(STOP_ON_QUOTA=False, FALLBACK_MODEL=""), QUOTA, RuntimeError),    # old behaviour
            (dict(STOP_ON_QUOTA=True, FALLBACK_MODEL=""), MINUTE, RuntimeError),    # per-minute: not daily
        ]
        for settings, error, expected in cases:
            with self.subTest(settings=settings, error=str(error)[:40]), \
                    patch.multiple(llm, **settings), patch.object(llm, "_create_with_backoff", side_effect=error), \
                    self.assertRaises(RuntimeError) as caught:
                llm.complete_json("system", "user", {}, 0.7)
            self.assertIs(type(caught.exception), expected)

    def test_a_fallback_still_answers_instead_of_stopping(self):
        with patch.object(llm, "STOP_ON_QUOTA", True), patch.object(llm, "_create_with_backoff", side_effect=QUOTA), \
                patch.object(llm, "_create_fallback", return_value=reply()):
            parsed, _ = llm.complete_json("system", "user", {}, 0.7)
        self.assertEqual(parsed["choice"], "starbucks")

    def test_decision_layer_lets_the_stop_through(self):
        from tests.test_repairs import Repairs
        fixture = Repairs("test_cache_invalidates_each_decision_input")
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        with patch.object(llm, "complete_json", side_effect=llm.QuotaExhausted("LLM transport failed (quota: daily token limit)")), \
                self.assertRaises(llm.QuotaExhausted):
            fixture.decision()
        self.assertEqual(list((fixture.out / "cache").glob("*.json")), [])     # nothing faked into the cache


class FakeOllama(BaseHTTPRequestHandler):
    """Speaks just enough of Ollama's OpenAI-compatible API for the real SDK path."""
    seen: list = []

    def do_POST(self):  # noqa: N802
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        FakeOllama.seen.append((self.path, self.headers.get("Authorization"), body))
        data = json.dumps({"id": "x", "object": "chat.completion", "created": 0, "model": body["model"],
                           "choices": [{"index": 0, "finish_reason": "stop",
                                        "message": {"role": "assistant",
                                                    "content": "<think>hmm</think>" + json.dumps(GOOD)}}],
                           "usage": {"prompt_tokens": 12, "completion_tokens": 7, "total_tokens": 19}}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


class RealHttpPath(FallbackCase):
    def test_fallback_reaches_a_local_openai_compatible_server(self):
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), FakeOllama)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        self.addCleanup(httpd.server_close)
        self.addCleanup(httpd.shutdown)
        FakeOllama.seen.clear()
        with patch.object(llm, "FALLBACK_URL", f"http://127.0.0.1:{httpd.server_address[1]}/v1"), \
                patch.object(llm, "_create_with_backoff", side_effect=QUOTA):
            parsed, usage = llm.complete_json("system", "user", {"type": "object"}, 0.7)
        self.assertEqual(parsed, GOOD)
        self.assertEqual(usage, {"input_tokens": 12, "output_tokens": 7})
        path, auth, body = FakeOllama.seen[0]
        self.assertEqual(path, "/v1/chat/completions")
        self.assertEqual(auth, "Bearer ollama")                 # no real credential is sent
        self.assertEqual(body["model"], "qwen3.8")
        self.assertEqual(body["response_format"]["type"], "json_schema")


class Provenance(FallbackCase):
    def setUp(self):
        super().setUp()
        from tests.test_repairs import Repairs   # reuse its twin/shops/state fixture
        self.fixture = Repairs("test_cache_invalidates_each_decision_input")
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)

    def test_fallback_decision_is_labelled_cached_and_replayed_as_the_fallbacks(self):
        def stub(*args, **kwargs):
            llm._answered_by.set("ollama/qwen3.8")
            return GOOD, {"input_tokens": 1, "output_tokens": 1}
        with patch.object(llm, "complete_json", side_effect=stub):
            live = self.fixture.decision()
        self.assertEqual(live["llm_model"], "ollama/qwen3.8")
        entry = json.loads((self.fixture.out / "cache" / f"{live['llm_cache_key']}.json").read_text())
        self.assertEqual(entry["_model"], "ollama/qwen3.8")
        replay = self.fixture.decision(offline=True)
        self.assertFalse(replay["llm_failed"])
        self.assertEqual((replay["llm_model"], replay["llm_cache_key"]), (live["llm_model"], live["llm_cache_key"]))

    def test_groq_cache_identity_is_unchanged_by_the_fallback(self):
        # Turning the fallback on must not move Groq's keys, or the committed cache breaks.
        with patch.object(llm, "complete_json", return_value=(GOOD, {"input_tokens": 1, "output_tokens": 1})):
            on = self.fixture.decision()
            with patch.object(llm, "FALLBACK_MODEL", ""):
                off = self.fixture.decision(offline=True)
        self.assertEqual(on["llm_model"], llm.MODEL)
        self.assertEqual(on["llm_cache_key"], off["llm_cache_key"])
        self.assertFalse(off["llm_failed"])

    def test_fallback_translation_is_labelled_and_not_cached(self):
        reply_ = {"situation": "incumbent_change", "focus_shop": "simffee", "label": "Open at six",
                  "actions": [{"action": "set_open", "shop": "simffee", "from_day": 5,
                               "item": None, "value": "06:00"}], "unsupported": []}

        def stub(*args, **kwargs):
            llm._answered_by.set("ollama/qwen3.8")
            return reply_, {"input_tokens": 0, "output_tokens": 0}
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, True)
        result = translate.translate("open at 6", cache_dir=tmp, complete_json=stub)
        self.assertEqual(result["scenario"]["source"]["translator_model"], "ollama/qwen3.8")
        self.assertEqual(list(tmp.glob("*.json")), [])


if __name__ == "__main__":
    unittest.main()
