"""Phase 2 security regressions: scenario ids cannot escape live/, and the local API only
serves its own frontend (CORS allowlist, JSON-only POSTs, Host check)."""

import http.client
import json
import shutil
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from api import server  # noqa: E402
from api.service import WhatIfService  # noqa: E402
from engine.loader import check_scenario_id, scenario_from_dict  # noqa: E402

LIBRARY = ROOT / "tests" / "fixtures" / "runs"     # only read: run() refuses before writing
BAD_IDS = ["../victim", "..", "/tmp/elsewhere", "a/b", "a\\b", "", ".hidden", "x" * 65, None, 7]
OVERRIDE = [{"from_day": 5, "shop": "simffee", "set": {"avg_wait_min": 3}}]


class ScenarioIds(unittest.TestCase):
    def test_bad_ids_are_rejected(self):
        for bad in BAD_IDS:
            with self.subTest(id=bad), self.assertRaises(ValueError):
                scenario_from_dict({"id": bad, "overrides": OVERRIDE})

    def test_bad_parent_is_rejected(self):
        with self.assertRaises(ValueError):
            scenario_from_dict({"id": "ok", "parent": "../baseline", "overrides": OVERRIDE})

    def test_library_and_generated_ids_are_accepted(self):
        for good in ["baseline", "cf_null", "s2_entrant_only", "user_38af337235", "user_" + "a" * 32]:
            self.assertEqual(check_scenario_id(good), good)


class LiveDirectoryContainment(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.service = WhatIfService(LIBRARY, live_dir=self.tmp / "live", offline=True)
        self.addCleanup(self.service._pool.shutdown, True)

    def test_traversal_id_cannot_delete_outside_live(self):
        canary = self.tmp / "victim" / "runs" / "canary.txt"
        canary.parent.mkdir(parents=True)
        canary.write_text("important")
        for bad in ["../victim", str(self.tmp / "victim")]:
            with self.subTest(id=bad):
                out = self.service.run({"id": bad, "overrides": OVERRIDE}, seeds=[0])
                self.assertIn("invalid scenario", out.get("error", ""))
        self.assertTrue(canary.exists())
        self.assertEqual(self.service.registry, {})

    def test_live_path_refuses_escape_even_without_the_id_check(self):
        with self.assertRaises(ValueError):
            self.service._live_path("../victim")
        self.assertEqual(self.service._live_path("user_abc").parent, (self.tmp / "live").resolve())


class LocalOnlyHttp(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        cls.service = WhatIfService(LIBRARY, live_dir=cls.tmp / "live", offline=True)
        cls.saved = (server.SERVICE, set(server.ALLOWED_HOSTS))
        server.SERVICE = cls.service
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.port = cls.httpd.server_address[1]
        server.ALLOWED_HOSTS.clear()
        server.ALLOWED_HOSTS.update({f"127.0.0.1:{cls.port}", f"localhost:{cls.port}"})
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.service._pool.shutdown(wait=True)
        server.SERVICE, hosts = cls.saved
        server.ALLOWED_HOSTS.clear()
        server.ALLOWED_HOSTS.update(hosts)
        shutil.rmtree(cls.tmp, True)

    def request(self, method, path, headers=None, body=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            conn.request(method, path, body=body, headers=headers or {})
            res = conn.getresponse()
            data = res.read()
            return res.status, dict(res.getheaders()), (json.loads(data) if data else None)
        finally:
            conn.close()

    def test_frontend_origin_gets_cors(self):
        origin = "http://localhost:5173"
        status, headers, body = self.request("OPTIONS", "/run", {"Origin": origin,
                                                                "Access-Control-Request-Method": "POST"})
        self.assertEqual(status, 204)
        self.assertIsNone(body)
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), origin)
        status, headers, _ = self.request("GET", "/health", {"Origin": origin})
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), origin)

    def test_other_origins_are_refused_without_cors(self):
        evil = {"Origin": "https://evil.example"}
        for method, path, extra, body in [
            ("OPTIONS", "/run", {"Access-Control-Request-Method": "POST"}, None),
            ("GET", "/health", {}, None),
            ("POST", "/run", {"Content-Type": "application/json"},
             json.dumps({"scenario": {"id": "x", "overrides": OVERRIDE}})),
        ]:
            with self.subTest(method=method):
                status, headers, _ = self.request(method, path, {**evil, **extra}, body)
                self.assertEqual(status, 403)
                self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_simple_cross_site_post_is_rejected(self):
        # text/plain needs no CORS preflight, so the server itself must refuse it.
        body = json.dumps({"scenario": {"id": "x", "overrides": OVERRIDE}})
        status, _, out = self.request("POST", "/run", {"Content-Type": "text/plain"}, body)
        self.assertEqual(status, 400)
        self.assertIn("application/json", out["error"])

    def test_foreign_host_header_is_refused(self):
        status, _, _ = self.request("GET", "/health", {"Host": f"rebind.example:{self.port}"})
        self.assertEqual(status, 403)

    def test_scripts_without_origin_still_work(self):
        status, headers, body = self.request("GET", "/health")
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_traversal_over_http_is_a_400(self):
        body = json.dumps({"scenario": {"id": "../victim", "overrides": OVERRIDE}})
        status, _, out = self.request("POST", "/run", {"Content-Type": "application/json"}, body)
        self.assertEqual(status, 400)
        self.assertIn("invalid scenario", out["error"])


if __name__ == "__main__":
    unittest.main()
