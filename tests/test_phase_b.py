"""ROADMAP phase B, offline: exists_from_day (B1), new_entrant (B2), flows (B3), the S2
scenario family (B4/B6) and the translator's shop_enters path (B5). No API key.

    python3 -m unittest tests.test_phase_b -v
"""

import json
import pathlib
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import build_runs  # noqa: E402
from analyzer import flows, narrate  # noqa: E402
from analyzer.templates import question_for  # noqa: E402
from engine import loop, translate  # noqa: E402
from engine.disruption import with_new_entrant  # noqa: E402
from engine.gossip import apply_opening  # noqa: E402
from engine.habit import regular_shop  # noqa: E402
from engine.loader import load_chain, load_shops, load_twins, scenario_from_dict  # noqa: E402
from engine.resolve import opening_today, resolve  # noqa: E402
from engine.schema import DISRUPTION_SOURCES, Disruption, validate_row  # noqa: E402

SHOPS = load_shops()
TWINS = {t.id: t for t in load_twins(shop_ids=frozenset(SHOPS))}
S2 = load_chain("s2_entrant")


def row(day, twin, choice, driver="habit", failed=False, mode="autopilot"):
    return {"day": day, "twin": twin, "choice": choice, "primary_driver": driver,
            "llm_failed": failed, "mode": mode}


class ExistsFromDay(unittest.TestCase):
    def test_absent_before_opening_day(self):
        self.assertEqual(sorted(resolve(SHOPS, S2, 3)), ["simffee"])
        self.assertEqual(sorted(resolve(SHOPS, S2, 4)), ["simffee", "starbucks"])
        self.assertEqual(opening_today(S2, SHOPS, 4), ["starbucks"])
        self.assertEqual(opening_today(S2, SHOPS, 5), [])
        self.assertEqual(opening_today(S2, SHOPS, 1), [])

    def test_existence_is_run_wide_whatever_the_block_from_day(self):
        sc = scenario_from_dict({"id": "x", "parent": None, "overrides": [
            {"from_day": 4, "shop": "starbucks", "set": {"exists_from_day": 4}}]})
        self.assertNotIn("starbucks", resolve(SHOPS, [sc], 2))
        self.assertIn("starbucks", resolve(SHOPS, [sc], 4))

    def test_unset_restores_existence(self):
        child = scenario_from_dict({"id": "c", "parent": "s2_entrant", "overrides": [
            {"from_day": 1, "shop": "starbucks", "unset": ["exists_from_day"]}]})
        self.assertIn("starbucks", resolve(SHOPS, S2 + [child], 1))

    def test_v1_chain_is_untouched(self):
        for day in range(1, 8):
            self.assertEqual(sorted(resolve(SHOPS, load_chain("baseline"), day)), ["simffee", "starbucks"])
            self.assertEqual(opening_today(load_chain("baseline"), SHOPS, day), [])

    def test_regular_shop_ignores_absent_shops(self):
        habit = {"simffee": 0.2, "starbucks": 0.733}
        self.assertEqual(regular_shop(habit), "starbucks")
        self.assertEqual(regular_shop(habit, {"simffee": {}}), "simffee")

    def test_init_state_zeroes_a_shop_that_is_not_there(self):
        twins = list(TWINS.values())
        state = loop.init_state(twins, present=resolve(SHOPS, S2, 1))
        self.assertEqual(state["habit"]["T10"]["starbucks"], 0.0)
        self.assertEqual(state["latent_interest"]["T01"]["starbucks"], 0.0)
        self.assertNotIn("starbucks", state["visited"]["T10"])
        v1 = loop.init_state(twins)
        self.assertEqual(v1["habit"]["T10"]["starbucks"], TWINS["T10"].mechanism["habit"]["starbucks"])


class NewEntrant(unittest.TestCase):
    def test_sixth_source_exists_and_validates(self):
        self.assertIn("new_entrant", DISRUPTION_SOURCES)

    def test_shock_is_a_max_not_a_sum(self):
        sb = resolve(SHOPS, S2, 4)["starbucks"]
        t01 = TWINS["T01"]                       # 06:45, Starbucks opens 06:00 -> open
        self.assertEqual(with_new_entrant(Disruption(0.0, "none"), t01, [sb]).to_dict(),
                         {"score": 0.5, "source": "new_entrant"})
        self.assertEqual(with_new_entrant(Disruption(1.0, "hours"), t01, [sb]).source, "hours")
        self.assertEqual(with_new_entrant(Disruption(0.3, "price"), t01, []).source, "price")
        late = {**sb, "open": "09:00"}
        self.assertEqual(with_new_entrant(Disruption(0.0, "none"), t01, [late]).score, 0.2)

    def test_opening_bump_within_two_walk_tolerances(self):
        today = resolve(SHOPS, S2, 4)
        latent = {"simffee": 0.0, "starbucks": 0.0}
        apply_opening(latent, TWINS["T01"], ["starbucks"], today)     # home (0,1), walk 5 -> 4 blocks
        self.assertAlmostEqual(latent["starbucks"], 0.15)
        latent = {"simffee": 0.0, "starbucks": 0.0}
        apply_opening(latent, TWINS["T03"], ["starbucks"], today)     # home (2,1), walk 1 -> 3 > 2
        self.assertEqual(latent["starbucks"], 0.0)

    def test_offline_s2_run_reappraises_on_opening_day(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = pathlib.Path(tmp)
            rows = loop.run("s2_entrant", 0, out=out, offline=True, cache_dir=out / "cache")
            self.assertEqual(len(rows), 70)
            for r in rows:
                self.assertEqual(validate_row(r, frozenset(SHOPS)), [])
            early = [r for r in rows if r["day"] <= 3]
            self.assertTrue(all(r["choice"] in ("simffee", "none") for r in early))
            self.assertTrue(all(r["state_before"]["habit"]["starbucks"] == 0.0 for r in early if r["day"] == 1))
            d4 = {r["twin"]: r for r in rows if r["day"] == 4}
            self.assertEqual(d4["T04"]["disruption"], {"score": 0.5, "source": "new_entrant"})
            self.assertEqual(d4["T04"]["mode"], "autopilot")                  # threshold 0.5: not enough alone
            self.assertEqual(d4["T01"]["disruption"]["source"], "hours")     # the S1 shock still wins
            self.assertNotIn("new_entrant", {r["disruption"]["source"] for r in rows if r["day"] != 4})
            # B4: the control fork shares days 1-3 byte for byte and differs only in what Simffee did
            only = loop.run("s2_entrant_only", 0, out=out, offline=True, cache_dir=out / "cache")
            strip = lambda r: {k: v for k, v in r.items() if k != "scenario"}
            self.assertEqual([strip(r) for r in rows if r["day"] <= 3], [strip(r) for r in only if r["day"] <= 3])
            o4 = {r["twin"]: r for r in only if r["day"] == 4}
            self.assertEqual({r["disruption"]["source"] for r in o4.values()}, {"new_entrant"})
            # B2 done-when: the early-morning twins (threshold < 0.5) reappraise on the entrant alone
            self.assertEqual(sorted(t for t, r in o4.items() if r["mode"] == "reappraisal"
                                    and TWINS[t].disruption_threshold < 0.5), ["T01", "T02", "T05", "T06"])
            # B6: the rename ablation is a full rerun with the label in every prompt-facing row
            abl = loop.run("abl_rename", 0, out=out, offline=True, cache_dir=out / "cache")
            self.assertEqual(len(abl), 70)
            self.assertEqual(resolve(SHOPS, load_chain("abl_rename"), 4)["starbucks"]["prompt"]["shop_label"], "Shop B")


class Flows(unittest.TestCase):
    ROWS = [
        row(1, "A", "simffee"), row(1, "B", "simffee"), row(1, "C", "starbucks"),
        row(2, "A", "starbucks", "curiosity", mode="reappraisal"), row(2, "B", "simffee"), row(2, "C", "starbucks"),
        row(3, "A", "simffee", "price", mode="reappraisal"), row(3, "B", "none", "hours", mode="reappraisal"),
        row(3, "C", "simffee", "social", mode="reappraisal"),
    ]

    def test_lost_gained_returned_net(self):
        f = flows.flows(self.ROWS, "simffee", 3)
        d2, d3 = f["by_day"]
        self.assertEqual(d2["lost_to"]["starbucks"], {"twins": ["A"], "count": 1, "drivers": {"curiosity": 1}})
        self.assertEqual((d2["lost"], d2["gained"], d2["net"]), (1, 0, -1))
        self.assertEqual(d3["gained_from"]["starbucks"]["twins"], ["A", "C"])
        self.assertEqual(d3["lost_to"]["none"]["drivers"], {"hours": 1})
        self.assertEqual(d3["returned"], ["A"])
        self.assertEqual(d3["net"], 1)
        self.assertEqual(f["totals"]["lost_to"], {"none": ["B"], "starbucks": ["A"]})
        self.assertEqual(f["totals"]["gained_from"], {"starbucks": ["A", "C"]})
        self.assertEqual(f["totals"]["returned"], ["A"])
        self.assertEqual(f["end"]["kept"], [])
        self.assertEqual(f["end"]["lost"], {"none": ["B"]})
        self.assertEqual(f["end"]["gained"], {"starbucks": ["C"]})
        self.assertEqual(f["end"]["net"], 0)

    def test_runs_on_s1_fixtures(self):
        rows = build_runs.load_rows(ROOT / "tests/fixtures/runs", "baseline", 0)
        f = flows.flows(rows, "simffee", 7)
        self.assertEqual(len(f["by_day"]), 6)
        self.assertGreater(f["totals"]["moves"], 0)
        lost = {t for ts in f["end"]["lost"].values() for t in ts}
        self.assertEqual(lost, set(f["end"]["start_customers"]) - set(f["end"]["end_customers"]))

    def test_agreement(self):
        a = self.ROWS
        b = [dict(r, choice="none") if (r["twin"], r["day"]) == ("A", 3) else r for r in a]
        g = flows.agreement(a, b)
        self.assertEqual((g["twin_days"], g["value"]), (9, round(8 / 9, 3)))
        self.assertEqual(g["diverged"], [{"twin": "A", "day": 3, "a": "simffee", "b": "none"}])
        self.assertEqual(g["reappraisal_twin_days"], 4)
        c = [dict(r, llm_failed=True) for r in a]
        self.assertTrue(flows.agreement(a, c)["unmeasured"])


class Templates(unittest.TestCase):
    def setUp(self):
        self.files = build_runs.load_scenarios(bundle_only=False)

    def test_question_follows_the_scenario(self):
        self.assertEqual(question_for(self.files, "baseline", "simffee")["situation"], "incumbent_change")
        q = question_for(self.files, "s2_entrant", "simffee")
        self.assertEqual((q["situation"], q["entrant"]), ("competitor_enters", {"shop": "starbucks", "day": 4}))
        self.assertEqual(question_for(self.files, "s2_entrant_only", "simffee")["entrant"]["day"], 4)

    def test_bundle_filter_and_hero_agreement(self):
        self.assertNotIn("s2_entrant", build_runs.load_scenarios())
        self.assertIn("s2_entrant", self.files)
        with tempfile.TemporaryDirectory() as tmp:
            out = pathlib.Path(tmp)
            for sid in ("s2_entrant", "abl_rename"):
                loop.run(sid, 0, out=out, offline=True, cache_dir=out / "cache")
            files = {sid: dict(self.files[sid]) for sid in ("s2_entrant", "abl_rename")}
            files["s2_entrant"]["role"] = "baseline"
            groups = {sid: [build_runs.load_rows(out, sid, 0)] for sid in files}
            analysis = build_runs.build_analysis(out, SHOPS, files, {}, groups, [0])
            self.assertEqual(analysis["question"]["situation"], "competitor_enters")
            self.assertEqual(analysis["flows"]["focus_shop"], "simffee")
            hero = analysis["hero_agreement"]["abl_rename"]
            self.assertEqual(hero["compare_to"], "s2_entrant")
            self.assertIn("0", hero["seeds"])

    def test_s2_narration_leads_with_flows(self):
        rows = Flows.ROWS
        analysis = {
            "complete": True, "break_day": 2, "direction": "drop",
            "confidence": {"unmeasured": False},
            "naive": {"label": "x", "driver": "curiosity"}, "actual": {"driver": "hours", "switchers": ["A"]},
            "impact": {"lost_total": 1, "lost_by_decision": 1, "lost_anyway": 0},
            "question": question_for(self.files, "s2_entrant", "simffee"),
            "flows": flows.flows(rows, "simffee", 3),
        }
        text = narrate.narrate(analysis)["narration"]
        self.assertTrue(text.startswith("A competitor opened on day 4; 1 customers went to it at least once, "
                                        "mostly citing curiosity, 0 never left, and 1 came back."), text)
        self.assertEqual(narrate.unsupported_numbers(text, analysis), [])


class TranslatorS2(unittest.TestCase):
    def setUp(self):
        self.shops, self.actions, self.chain = SHOPS, translate.load_actions(), load_chain("baseline")

    def compile(self, actions, **kw):
        reply = {"situation": kw.get("situation", "competitor_enters"), "focus_shop": "simffee",
                 "label": "Starbucks opens, we open at 6", "actions": actions, "unsupported": []}
        return translate.compile_actions(reply, self.chain, self.shops, self.actions, "u", "text")

    def test_shop_enters_becomes_a_root_scenario_with_the_story_inlined(self):
        sc, problems = self.compile([
            {"action": "shop_enters", "shop": "starbucks", "from_day": 4, "item": None, "value": None},
            {"action": "set_open", "shop": "simffee", "from_day": 5, "item": None, "value": "06:00"},
        ])
        self.assertEqual(problems, [])
        self.assertIsNone(sc["parent"])
        self.assertEqual(sc["derived_from"], "baseline")
        self.assertEqual(sc["situation"], "competitor_enters")
        self.assertEqual(sc["overrides"][0], {"from_day": 1, "shop": "starbucks", "set": {"exists_from_day": 4}})
        self.assertEqual(sc["overrides"][1], self.chain[-1].overrides[0])        # the v1 shock still happens
        self.assertEqual(sc["overrides"][2]["set"], {"open": "06:00"})
        chain = [scenario_from_dict(sc)]
        self.assertNotIn("starbucks", resolve(self.shops, chain, 3))
        self.assertEqual(resolve(self.shops, chain, 5)["simffee"]["open"], "06:00")
        self.assertGreaterEqual(sc["days"], 7)

    def test_opening_day_from_value_when_from_day_missing(self):
        sc, problems = self.compile([{"action": "shop_enters", "shop": "starbucks", "from_day": None,
                                      "item": None, "value": "5"}])
        self.assertEqual((problems, sc["overrides"][0]["set"]), ([], {"exists_from_day": 5}))

    def test_rejections(self):
        for bad in (
            {"action": "shop_enters", "shop": "simffee", "from_day": 4, "item": None, "value": None},   # S3
            {"action": "shop_enters", "shop": "starbucks", "from_day": 1, "item": None, "value": None},
            {"action": "shop_enters", "shop": "starbucks", "from_day": None, "item": None, "value": None},
        ):
            sc, problems = self.compile([bad])
            self.assertTrue(problems, bad)
            self.assertIsNone(sc)

    def test_duplicate_entrant_in_chain_is_rejected(self):
        reply = {"situation": "competitor_enters", "focus_shop": "simffee", "label": "x", "unsupported": [],
                 "actions": [{"action": "shop_enters", "shop": "starbucks", "from_day": 5, "item": None, "value": None}]}
        sc, problems = translate.compile_actions(reply, S2, self.shops, self.actions, "u", "text")
        self.assertTrue(problems)

    def test_menu_and_schema_know_the_action(self):
        self.assertIn("shop_enters", self.actions["actions"])
        schema = translate.response_schema(list(self.shops), list(self.actions["actions"]))
        self.assertIn("competitor_enters", schema["properties"]["situation"]["enum"])
        self.assertIn("shop_enters", schema["properties"]["actions"]["items"]["properties"]["action"]["enum"])
        msg = translate.user_message("x", self.shops, "simffee", 5, 7, self.actions, [])
        self.assertIn("shop_enters", msg)


if __name__ == "__main__":
    unittest.main()
