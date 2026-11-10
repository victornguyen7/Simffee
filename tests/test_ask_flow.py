"""Phase 6 regressions (AUDIT_FIX_PLAN #5): a what-if that outlives the server's timeout
keeps running, and GET /runs/<id> hands over its answer when it lands."""

import concurrent.futures
import http.client
import json
import shutil
import sys
import tempfile
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from api import server, service as service_module  # noqa: E402
from api.service import WhatIfService  # noqa: E402

LIBRARY = ROOT / "tests" / "fixtures" / "runs"


def scenario(sid):
    return {"id": sid, "parent": "baseline",
            "overrides": [{"from_day": 5, "shop": "simffee", "set": {"avg_wait_min": 3}}]}


class HeldRun:
    """Stands in for _run_and_analyse: blocks until released, then returns `answer`."""

    def __init__(self, answer=None, error=None):
        self.release = threading.Event()
        self.answer, self.error = answer, error

    def __call__(self, scenario, sc_obj, seeds):
        self.release.wait(10)
        if self.error:
            raise self.error
        return self.answer or {"run_id": scenario["id"], "scenario": scenario, "seeds": seeds,
                               "result": {"0": {"rows": []}}, "fallback_used": False}


class RunStatus(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.service = WhatIfService(LIBRARY, live_dir=self.tmp / "live", offline=True)
        self.addCleanup(self.service._pool.shutdown, True)

    def start(self, sid, held):
        with patch.object(self.service, "_run_and_analyse", held):
            out = self.service.run(scenario(sid), seeds=[0], deadline=time.monotonic() + 0.05)
        self.assertEqual((out["fallback_used"], out["reason"], out["pending_run_id"]), (True, "timeout", sid))
        return out

    def settle(self, sid):
        concurrent.futures.wait([self.service._jobs[sid]], timeout=10)

    def test_timed_out_run_is_collected_when_it_lands(self):
        held = HeldRun()
        self.start("user_slow", held)
        self.assertEqual(self.service.run_status("user_slow"), {"status": "running", "run_id": "user_slow"})
        held.release.set()
        self.settle("user_slow")
        done = self.service.run_status("user_slow")
        self.assertEqual(done["status"], "done")
        self.assertEqual(done["result"], {"0": {"rows": []}})

    def test_failed_and_crashed_runs_report_failed(self):
        bad = HeldRun(answer={"error": "engine output failed validation: x"})
        self.start("user_bad", bad)
        bad.release.set()
        self.settle("user_bad")
        self.assertEqual(self.service.run_status("user_bad")["status"], "failed")
        self.assertIn("validation", self.service.run_status("user_bad")["error"])

        crash = HeldRun(error=RuntimeError("PRIVATE_DETAIL"))
        self.start("user_crash", crash)
        crash.release.set()
        self.settle("user_crash")
        status = self.service.run_status("user_crash")
        self.assertEqual(status["status"], "failed")
        self.assertNotIn("PRIVATE_DETAIL", status["error"])

    def test_unknown_and_recorded_runs(self):
        self.assertIsNone(self.service.run_status("user_never"))
        self.service._register("user_old", {"scenario": scenario("user_old"), "run_dir": "/somewhere/private",
                                            "seeds": [0], "at": "t", "days": 7})
        recorded = self.service.run_status("user_old")
        self.assertEqual(recorded["status"], "recorded")
        self.assertNotIn("run_dir", recorded)          # no local paths over HTTP

    def test_finished_jobs_are_bounded(self):
        with patch.object(service_module, "KEEP_JOBS", 3):
            for i in range(6):
                held = HeldRun()
                held.release.set()
                with patch.object(self.service, "_run_and_analyse", held):
                    self.service.run(scenario(f"user_{i}"), seeds=[0])
        self.assertLessEqual(len(self.service._jobs), 4)
        self.assertIn("user_5", self.service._jobs)


class FailureReasons(unittest.TestCase):
    """A failed review or decision says why, without leaking provider text."""

    def test_transport_failures_are_classified(self):
        from engine import llm
        APIConnectionError = type("APIConnectionError", (Exception,), {})
        OddProviderError = type("OddProviderError", (Exception,), {})
        for exc, expected in [(APIConnectionError("PRIVATE_MARKER"), "LLM transport failed (connection)"),
                              (OddProviderError("PRIVATE_MARKER"), "LLM transport failed (OddProviderError)")]:
            with self.subTest(expected), patch.object(llm, "_create_with_backoff", side_effect=exc), \
                    self.assertRaises(RuntimeError) as caught:
                llm.complete_json("system", "user", {}, 0.7)
            self.assertEqual(str(caught.exception), expected)

    def test_decision_rows_keep_a_safe_reason(self):
        from engine import decide
        from engine.loader import load_shops, load_twins
        shops = load_shops()
        twin = load_twins(shop_ids=frozenset(shops))[0]
        for reason, shown in [("transport failed: connection", "transport failed: connection"),
                              ("transport failed: OddProviderError", "transport failed"),
                              ("something else", "LLM unavailable")]:
            with self.subTest(reason):
                row = decide._fallback(twin, "simffee", shops, reason)
                self.assertTrue(row["reasoning"].startswith(f"[llm unavailable: {shown}]"))

    def test_review_says_why_it_is_unavailable(self):
        from analyzer import review
        from engine import llm
        self.assertEqual(review._why(llm.LLMUnavailable("x")), "no model key")
        self.assertEqual(review._why(RuntimeError("LLM transport failed (rate limit)")), "transport failed: rate limit")
        self.assertEqual(review._why(ValueError("PRIVATE_MARKER")), "the model's reply was not a usable review")


class RunStatusHttp(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        cls.service = WhatIfService(LIBRARY, live_dir=cls.tmp / "live", offline=True)
        cls.saved = (server.SERVICE, set(server.ALLOWED_HOSTS))
        server.SERVICE = cls.service
        server.ALLOWED_HOSTS.clear()
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.service._pool.shutdown(wait=True)
        server.SERVICE, hosts = cls.saved
        server.ALLOWED_HOSTS.update(hosts)
        shutil.rmtree(cls.tmp, True)

    def get(self, path):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            conn.request("GET", path)
            res = conn.getresponse()
            return res.status, json.loads(res.read() or b"{}")
        finally:
            conn.close()

    def test_polling_over_http(self):
        held = HeldRun()
        with patch.object(self.service, "_run_and_analyse", held):
            self.service.run(scenario("user_http"), seeds=[0], deadline=time.monotonic() + 0.05)
        status, body = self.get("/runs/user_http")
        self.assertEqual((status, body["status"]), (202, "running"))
        held.release.set()
        self.service._jobs["user_http"].result(timeout=10)
        status, body = self.get("/runs/user_http")
        self.assertEqual((status, body["status"]), (200, "done"))
        self.assertIn("result", body)

    def test_unknown_or_malformed_ids_are_404(self):
        for path in ["/runs/user_nope", "/runs/..%2F..%2Fetc", "/runs/", "/runs/a/b"]:
            with self.subTest(path=path):
                self.assertEqual(self.get(path)[0], 404)


if __name__ == "__main__":
    unittest.main()
