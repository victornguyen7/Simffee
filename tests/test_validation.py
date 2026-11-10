"""Phase 3 regressions (AUDIT_FIX_PLAN #8, #9): malformed scenarios and requests are refused
with a 400 before any engine run, and the live registry is safe to read during a write."""

import copy
import http.client
import json
import shutil
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from api import server  # noqa: E402
from api.service import MAX_DAYS, WhatIfService  # noqa: E402
from engine import decide, loop  # noqa: E402
from engine.loader import discover_scenarios, load_chain, load_shops, load_twins, scenario_from_dict  # noqa: E402
from engine.resolve import check_overrides  # noqa: E402

LIBRARY = ROOT / "tests" / "fixtures" / "runs"
SHOPS = load_shops()


def scenario(*overrides, **extra):
    return {"id": "probe", "parent": "baseline", "overrides": list(overrides), **extra}


def ov(set_=None, shop="simffee", from_day=5, **extra):
    block = {"from_day": from_day, "shop": shop, **extra}
    if set_ is not None:
        block["set"] = set_
    return block


def problems(raw):
    sc = scenario_from_dict(raw)
    chain = load_chain(sc.id, extra={sc.id: sc})
    return check_overrides(SHOPS, chain, loop.scenario_days(chain))


class LoaderStructure(unittest.TestCase):
    def test_structural_errors(self):
        cases = {
            "empty set": scenario(ov({})),
            "empty set and unset": scenario(ov({}, unset=[])),
            "shop not a string": scenario(ov({"avg_wait_min": 3}, shop=["simffee"])),
            "unset not names": scenario(ov(None, unset=[3])),
            "override not an object": scenario("open at six"),
            "overrides not a list": {"id": "probe", "overrides": {"from_day": 5}},
            "from_day boolean": scenario(ov({"avg_wait_min": 3}, from_day=True)),
            "days boolean": scenario(ov({"avg_wait_min": 3}), days=True),
        }
        for name, raw in cases.items():
            with self.subTest(name), self.assertRaises(ValueError):
                scenario_from_dict(raw)


class OverridePreflight(unittest.TestCase):
    def test_library_scenarios_pass(self):
        for sid in discover_scenarios(include_all=True):
            chain = load_chain(sid)
            with self.subTest(sid):
                self.assertEqual(check_overrides(SHOPS, chain, loop.scenario_days(chain)), [])

    def test_bad_overrides_are_named(self):
        cases = {
            "unknown shop": (ov({"avg_wait_min": 3}, shop="nope"), "unknown shop"),
            "unknown field": (ov({"wifi": True}), "does not exist"),
            "unset unknown field": (ov(None, unset=["wifi"]), "does not exist"),
            "price as text": (ov({"price.latte": "40k"}), "price.latte must be a price"),
            "negative price": (ov({"price.latte": -1}), "price.latte must be a price"),
            "time format": (ov({"open": "7am"}), "open must be a time"),
            "time out of range": (ov({"close": "24:30"}), "close must be a time"),
            "quality above 1": (ov({"quality": 1.5}), "between 0 and 1"),
            "wait as text": (ov({"avg_wait_min": "long"}), "avg_wait_min must be a number"),
            "whole price object": (ov({"price": 40000}), "group of fields"),
            "duplicate products": (ov({"products": ["latte", "latte"]}), "distinct product names"),
            "empty products": (ov({"products": []}), "distinct product names"),
            "new product unpriced": (ov({"products": ["latte", "croissant"]}), "croissant with no price"),
            "starts after the run": (ov({"avg_wait_min": 3}, from_day=30), "starts on day 30"),
            "exists_from_day zero": (ov({"exists_from_day": 0}, from_day=1), "day number"),
            "closed not boolean": (ov({"permanently_closed": "yes"}), "true or false"),
        }
        for name, (block, needle) in cases.items():
            with self.subTest(name):
                found = problems(scenario(block))
                self.assertTrue(any(needle in p for p in found), found)

    def test_valid_overrides_pass(self):
        good = scenario(ov({"open": "06:00", "products": ["latte", "americano", "cold_brew", "croissant"],
                            "price.croissant": 30000, "quality": 0.9, "marketing.message": "Fresh daily"}))
        self.assertEqual(problems(good), [])

    def test_price_for_skips_unpriced_items(self):
        # shops.json lists Starbucks' frappuccino with no price; the cheapest-item fallback
        # must not KeyError on it when a twin's usual order is gone.
        twin = load_twins(shop_ids=frozenset(SHOPS))[0]
        shop = copy.deepcopy(SHOPS["starbucks"])
        shop["products"] = [p for p in shop["products"] if p != twin.usual_order]
        self.assertIn("frappuccino", shop["products"])
        expected = min(v for k, v in shop["price"].items() if k in shop["products"])
        self.assertEqual(decide.price_for(twin, shop), expected)


class ServiceRefusesBeforeRunning(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.service = WhatIfService(LIBRARY, live_dir=self.tmp / "live", offline=True)
        self.addCleanup(self.service._pool.shutdown, True)

    def test_malformed_scenarios_never_reach_the_engine(self):
        cases = [
            scenario(ov({})),                                    # was IndexError in chip()
            scenario(ov({"avg_wait_min": 3}, shop="nope")),      # was KeyError mid-run
            scenario(ov({"price.latte": "cheap"})),               # was TypeError in chip()
            scenario(ov({"products": ["latte", "croissant"]})),
            scenario(ov({"avg_wait_min": 3}), days=MAX_DAYS + 1),
            scenario(ov({"avg_wait_min": 3}), parent="no_such_parent"),
        ]
        with patch.object(loop, "run", side_effect=AssertionError("engine must not run")) as engine:
            for raw in cases:
                with self.subTest(raw=raw["overrides"]):
                    out = self.service.run(raw, seeds=[0])
                    self.assertIn("error", out)
        engine.assert_not_called()
        self.assertEqual(self.service.registry, {})
        self.assertFalse((self.tmp / "live" / "probe").exists())

    def test_registry_can_be_iterated_while_a_run_lands(self):
        self.service._register("user_a", {"scenario": {"id": "user_a"}, "at": "t"})
        items = iter(self.service.registry.items())
        next(items)
        self.service._register("user_b", {"scenario": {"id": "user_b"}, "at": "t"})
        list(items)                       # would raise "dictionary changed size" if mutated
        saved = json.loads((self.tmp / "live" / "registry.json").read_text())
        self.assertEqual(set(saved), {"user_a", "user_b"})
        self.assertFalse((self.tmp / "live" / "registry.json.tmp").exists())


class RequestValidationHttp(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        cls.service = WhatIfService(LIBRARY, live_dir=cls.tmp / "live", offline=True)
        cls.saved = (server.SERVICE, set(server.ALLOWED_HOSTS))
        server.SERVICE = cls.service
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.port = cls.httpd.server_address[1]
        server.ALLOWED_HOSTS.clear()
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.service._pool.shutdown(wait=True)
        server.SERVICE, hosts = cls.saved
        server.ALLOWED_HOSTS.update(hosts)
        shutil.rmtree(cls.tmp, True)

    def post(self, path, body, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            data = body if isinstance(body, (bytes, str)) else json.dumps(body)
            conn.request("POST", path, body=data, headers={"Content-Type": "application/json", **(headers or {})})
            res = conn.getresponse()
            return res.status, json.loads(res.read() or b"{}")
        finally:
            conn.close()

    def test_bad_requests_are_400_not_500(self):
        good = scenario(ov({"avg_wait_min": 3}))
        cases = {
            "seed not a number": ("/run", {"scenario": good, "seeds": "x"}),
            "seed boolean": ("/run", {"scenario": good, "seeds": [True]}),
            "seed negative": ("/run", {"scenario": good, "seeds": [-1]}),
            "huge range": ("/run", {"scenario": good, "seeds": "0-100000000"}),
            "descending range": ("/run", {"scenario": good, "seeds": "3-1"}),
            "seeds object": ("/run", {"scenario": good, "seeds": {"a": 1}}),
            "too many seeds": ("/run", {"scenario": good, "seeds": list(range(11))}),
            "empty set": ("/run", {"scenario": scenario(ov({}))}),
            "unknown shop": ("/run", {"scenario": scenario(ov({"avg_wait_min": 3}, shop="nope"))}),
            "text not a string": ("/whatif", {"text": ["open at 6"]}),
            "parent not a string": ("/whatif", {"text": "open at 6", "parent": ["baseline"]}),
            "missing text": ("/whatif", {}),
            "run_id not a string": ("/review", {"run_id": 7}),
            "sketch text not a string": ("/sketch", {"text": 1, "sketch": {"headline": "", "movements": [],
                                                                         "drivers": [], "net": ""}}),
        }
        for name, (path, body) in cases.items():
            with self.subTest(name):
                status, out = self.post(path, body)
                self.assertEqual(status, 400, out)
                self.assertNotEqual(out.get("error"), "internal error")

    def test_bad_content_length_is_400(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            conn.putrequest("POST", "/run")
            conn.putheader("Content-Type", "application/json")
            conn.putheader("Content-Length", "lots")
            conn.endheaders()
            self.assertEqual(conn.getresponse().status, 400)
        finally:
            conn.close()

    def test_query_strings_do_not_break_routing(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            conn.request("GET", "/health?x=1")
            res = conn.getresponse()
            self.assertEqual(res.status, 200)
            self.assertTrue(json.loads(res.read())["ok"])
        finally:
            conn.close()
        status, _ = self.post("/run?debug=1", {"scenario": scenario(ov({}))})
        self.assertEqual(status, 400)


if __name__ == "__main__":
    unittest.main()
