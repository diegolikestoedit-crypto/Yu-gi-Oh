import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from engine.cards import load_db, load_decks, validate_deck  # noqa: E402
from engine.rules import Duel, RuleError  # noqa: E402

DB = load_db()
DECKS = load_decks()

FILLER = ["LD-004"] * 20  # Thornback Golem: 1300 / 2000


def deck(*cids, extra=()):
    main = list(cids) + FILLER[: max(0, 20 - len(cids))]
    return {"main": main, "extra": list(extra)}


def make(d0, d1, profile="frontier", first=0):
    duel = Duel(DB, [d0, d1], ["Ana", "Ben"], profile=profile, seed=7, first=first)
    duel.start()
    return duel


def give(duel, p, cid):
    """Move a copy of cid from p's deck into their hand (test setup only)."""
    pl = duel.pl(p)
    given = duel.__dict__.setdefault("_given", set())
    for iid in pl["hand"]:
        if duel.c(iid)["cid"] == cid and iid not in given:
            given.add(iid)
            return iid
    for iid in pl["deck"]:
        if duel.c(iid)["cid"] == cid:
            pl["deck"].remove(iid); given.add(iid)
            # Swap with an ungiven hand card so the hand size (and hand-limit rule) is unaffected.
            back = next((h for h in pl["hand"] if h not in given), None)
            if back is not None:
                pl["hand"].remove(back)
                pl["deck"].append(back)
                duel.c(back)["zone"] = "deck"
            pl["hand"].append(iid)
            duel.c(iid)["zone"] = "hand"
            return iid
    raise AssertionError(f"{cid} not in deck")


def act_kind(duel, p, kind, card=None, **match):
    for a in duel.legal_actions(p):
        if a["kind"] != kind or (card is not None and a["card"] != card):
            continue
        if all(a.get(k) == v for k, v in match.items()):
            return duel.act(p, a["id"])
    raise AssertionError(f"No {kind} action for player {p}; have {[a['id'] for a in duel.legal_actions(p)]}")


def end_turn(duel, p):
    ev = act_kind(duel, p, "end_turn")
    while duel.state["pending"] and duel.state["pending"]["kind"] == "discard":
        ev += act_kind(duel, p, "discard")
    return ev


def kinds(duel, p):
    return {a["kind"] for a in duel.legal_actions(p)}


def types(events):
    return [e["type"] for e in events]


class VerticalSlice(unittest.TestCase):
    def test_dragon_beats_sorcerer(self):
        duel = make(deck("LD-001"), deck("LD-007"))
        dragon = give(duel, 0, "LD-001")
        ev = act_kind(duel, 0, "normal_summon", dragon)
        self.assertIn("MONSTER_SUMMONED", types(ev))
        self.assertNotIn("enter_battle", kinds(duel, 0), "first player cannot attack on turn 1")
        act_kind(duel, 0, "end_turn")

        sorcerer = give(duel, 1, "LD-007")
        act_kind(duel, 1, "normal_summon", sorcerer)
        self.assertEqual(duel.pl(1)["monsters"].count(sorcerer), 1)
        act_kind(duel, 1, "end_turn")

        act_kind(duel, 0, "enter_battle")
        ev = act_kind(duel, 0, "attack", dragon, target=sorcerer)
        t = types(ev)
        self.assertEqual(t[:2], ["ATTACK_DECLARED", "ATTACK_RESOLVED"])
        self.assertIn("MONSTER_DAMAGED", t)
        self.assertIn("MONSTER_DESTROYED", t)
        self.assertEqual(duel.pl(1)["lp"], 3000 - 500)
        self.assertIn(sorcerer, duel.pl(1)["gy"])
        self.assertEqual(duel.c(dragon)["zone"], "monster")
        # Each snapshot is the state after its event: the destroy snapshot no longer has the sorcerer.
        destroyed = next(e for e in ev if e["type"] == "MONSTER_DESTROYED")
        self.assertNotIn(sorcerer, destroyed["_state"]["players"][1]["monsters"])


class Summoning(unittest.TestCase):
    def test_citadel_requires_tributes(self):
        duel = make(deck("LD-001", "LD-002", "LD-003"), deck(), profile="citadel")
        dragon = give(duel, 0, "LD-001")
        self.assertNotIn("ns:" + dragon, [a["id"] for a in duel.legal_actions(0)])
        self.assertNotIn("tribute_summon", kinds(duel, 0))

    def test_tribute_summon_flow(self):
        duel = make(deck("LD-001", "LD-002", "LD-003"), deck(), profile="citadel")
        dragon = give(duel, 0, "LD-001")
        knight = give(duel, 0, "LD-002")
        hawk = give(duel, 0, "LD-003")
        act_kind(duel, 0, "normal_summon", knight)
        act_kind(duel, 0, "end_turn")
        golem = give(duel, 1, "LD-004")
        act_kind(duel, 1, "normal_summon", golem)
        act_kind(duel, 1, "end_turn")
        act_kind(duel, 0, "normal_summon", hawk)
        act_kind(duel, 0, "end_turn")
        act_kind(duel, 1, "end_turn")
        ev = act_kind(duel, 0, "tribute_summon", dragon)
        self.assertEqual(types(ev), ["TRIBUTE_SUMMON_STARTED", "MONSTER_TRIBUTED", "MONSTER_TRIBUTED",
                                     "MONSTER_SUMMONED"])
        self.assertEqual(ev[-1]["method"], "tribute")
        self.assertEqual(set(duel.pl(0)["gy"]), {knight, hawk})
        self.assertNotIn("normal_summon", kinds(duel, 0), "only one normal summon per turn")

    def test_one_normal_summon_per_turn(self):
        duel = make(deck("LD-002", "LD-003"), deck())
        act_kind(duel, 0, "normal_summon", give(duel, 0, "LD-002"))
        give(duel, 0, "LD-003")
        self.assertNotIn("normal_summon", kinds(duel, 0))
        self.assertNotIn("set_monster", kinds(duel, 0))

    def test_set_and_flip(self):
        duel = make(deck("LD-002"), deck())
        knight = give(duel, 0, "LD-002")
        ev = act_kind(duel, 0, "set_monster", knight)
        self.assertEqual(ev[0]["type"], "MONSTER_SET")
        self.assertNotIn("flip_summon", kinds(duel, 0), "cannot flip the turn it was set")
        act_kind(duel, 0, "end_turn")
        act_kind(duel, 1, "end_turn")
        ev = act_kind(duel, 0, "flip_summon", knight)
        self.assertEqual(ev[0]["type"], "MONSTER_FLIPPED")
        self.assertEqual(duel.c(knight)["position"], "atk")


class Battle(unittest.TestCase):
    def setup_battle(self, a_cid, d_cid, defend=False):
        duel = make(deck(a_cid), deck(d_cid))
        act_kind(duel, 0, "end_turn")
        d = give(duel, 1, d_cid)
        act_kind(duel, 1, "set_monster" if defend else "normal_summon", d)
        act_kind(duel, 1, "end_turn")
        a = give(duel, 0, a_cid)
        act_kind(duel, 0, "normal_summon", a)
        act_kind(duel, 0, "enter_battle")
        return duel, a, d

    def test_attack_into_higher_defense(self):
        duel, a, d = self.setup_battle("LD-008", "LD-004", defend=True)  # 1100 vs DEF 2000
        ev = act_kind(duel, 0, "attack", a, target=d)
        self.assertIn("MONSTER_FLIPPED", types(ev))
        self.assertEqual(duel.pl(0)["lp"], 3000 - 900)
        self.assertEqual(duel.c(a)["zone"], "monster")
        self.assertEqual(duel.c(d)["zone"], "monster")

    def test_equal_attack_destroys_both(self):
        duel, a, d = self.setup_battle("LD-004", "LD-004")
        act_kind(duel, 0, "attack", a, target=d)
        self.assertEqual(duel.c(a)["zone"], "gy")
        self.assertEqual(duel.c(d)["zone"], "gy")
        self.assertEqual(duel.pl(0)["lp"], 3000)
        self.assertEqual(duel.pl(1)["lp"], 3000)

    def test_weaker_attacker_is_destroyed(self):
        duel, a, d = self.setup_battle("LD-008", "LD-002")  # 1100 vs 1700
        act_kind(duel, 0, "attack", a, target=d)
        self.assertEqual(duel.c(a)["zone"], "gy")
        self.assertEqual(duel.pl(0)["lp"], 3000 - 600)

    def test_direct_attack_and_win(self):
        duel = make(deck("LD-001"), deck())
        act_kind(duel, 0, "end_turn")
        act_kind(duel, 1, "end_turn")
        dragon = give(duel, 0, "LD-001")
        act_kind(duel, 0, "normal_summon", dragon)
        act_kind(duel, 0, "enter_battle")
        ev = act_kind(duel, 0, "attack", dragon, target=None)
        self.assertEqual(duel.pl(1)["lp"], 100)
        self.assertFalse(any(a["kind"] == "attack" for a in duel.legal_actions(0)), "one attack per monster")
        self.assertNotIn("DUEL_WON", types(ev))

    def test_lp_zero_wins(self):
        duel = make(deck("LD-001"), deck())
        duel.pl(1)["lp"] = 500
        act_kind(duel, 0, "end_turn")
        act_kind(duel, 1, "end_turn")
        dragon = give(duel, 0, "LD-001")
        act_kind(duel, 0, "normal_summon", dragon)
        act_kind(duel, 0, "enter_battle")
        ev = act_kind(duel, 0, "attack", dragon, target=None)
        self.assertEqual(ev[-1]["type"], "DUEL_WON")
        self.assertEqual(duel.state["winner"], 0)
        self.assertEqual(duel.legal_actions(0), [])


class Traps(unittest.TestCase):
    def defender_with_trap(self, trap):
        duel = make(deck("LD-002", "LD-003"), deck(trap))
        act_kind(duel, 0, "end_turn")
        t = give(duel, 1, trap)
        act_kind(duel, 1, "set_spell_trap", t)
        act_kind(duel, 1, "end_turn")
        return duel, t

    def test_trap_cannot_activate_turn_it_is_set(self):
        duel = make(deck("LD-002", "LD-204"), deck())
        t = give(duel, 0, "LD-204")
        act_kind(duel, 0, "set_spell_trap", t)
        self.assertNotIn("activate_trap", kinds(duel, 0))

    def test_prism_ward_destroys_attack_position(self):
        duel, t = self.defender_with_trap("LD-201")
        knight = give(duel, 0, "LD-002")
        act_kind(duel, 0, "normal_summon", knight)
        act_kind(duel, 1, "pass")
        act_kind(duel, 0, "enter_battle")
        ev = act_kind(duel, 0, "attack", knight, target=None)
        self.assertEqual(types(ev), ["ATTACK_DECLARED"])
        self.assertEqual(duel.decider(), 1)
        self.assertEqual(duel.legal_actions(0), [])
        ev = act_kind(duel, 1, "activate_trap", t)
        self.assertEqual(types(ev)[:2], ["TRAP_ACTIVATED", "MONSTER_DESTROYED"])
        self.assertEqual(duel.c(knight)["zone"], "gy")
        self.assertEqual(duel.pl(1)["lp"], 3000)
        self.assertEqual(duel.c(t)["zone"], "gy")

    def test_pass_lets_attack_through(self):
        duel, t = self.defender_with_trap("LD-201")
        knight = give(duel, 0, "LD-002")
        act_kind(duel, 0, "normal_summon", knight)
        act_kind(duel, 1, "pass")
        act_kind(duel, 0, "enter_battle")
        act_kind(duel, 0, "attack", knight, target=None)
        ev = act_kind(duel, 1, "pass")
        self.assertIn("ATTACK_RESOLVED", types(ev))
        self.assertEqual(duel.pl(1)["lp"], 3000 - 1700)

    def test_echo_chamber_reflects(self):
        duel, t = self.defender_with_trap("LD-202")
        knight = give(duel, 0, "LD-002")
        act_kind(duel, 0, "normal_summon", knight)
        act_kind(duel, 1, "pass")
        act_kind(duel, 0, "enter_battle")
        act_kind(duel, 0, "attack", knight, target=None)
        ev = act_kind(duel, 1, "activate_trap", t)
        self.assertIn("ATTACK_NEGATED", types(ev))
        self.assertNotIn("ATTACK_RESOLVED", types(ev))
        self.assertEqual(duel.pl(0)["lp"], 3000 - 1700)
        self.assertEqual(duel.pl(1)["lp"], 3000)

    def test_stasis_barrier_ends_battle(self):
        duel, t = self.defender_with_trap("LD-203")
        knight = give(duel, 0, "LD-002")
        act_kind(duel, 0, "normal_summon", knight)
        act_kind(duel, 1, "pass")
        act_kind(duel, 0, "enter_battle")
        act_kind(duel, 0, "attack", knight, target=None)
        act_kind(duel, 1, "activate_trap", t)
        self.assertEqual(duel.state["phase"], "main2")

    def test_sinkhole_on_summon(self):
        duel, t = self.defender_with_trap("LD-204")
        knight = give(duel, 0, "LD-002")
        act_kind(duel, 0, "normal_summon", knight)
        self.assertEqual(duel.decider(), 1)
        act_kind(duel, 1, "activate_trap", t)
        self.assertEqual(duel.c(knight)["zone"], "gy")
        self.assertEqual(duel.decider(), 0)

    def test_sinkhole_ignores_set_monsters(self):
        duel, t = self.defender_with_trap("LD-204")
        act_kind(duel, 0, "set_monster", give(duel, 0, "LD-002"))
        self.assertEqual(duel.decider(), 0, "setting is not a Normal Summon, so no response window")


class Spells(unittest.TestCase):
    def test_draw_spell(self):
        duel = make(deck("LD-101"), deck())
        s = give(duel, 0, "LD-101")
        before = len(duel.pl(0)["hand"])
        ev = act_kind(duel, 0, "activate_spell", s)
        self.assertEqual(types(ev), ["SPELL_ACTIVATED", "CARD_DRAWN", "SPELL_RESOLVED"])
        self.assertEqual(len(duel.pl(0)["hand"]), before - 1 + 2)
        self.assertIn(s, duel.pl(0)["gy"])

    def test_void_rift_needs_targets_and_clears_field(self):
        duel = make(deck("LD-102", "LD-002"), deck("LD-008"))
        rift = give(duel, 0, "LD-102")
        self.assertNotIn("activate_spell", kinds(duel, 0))
        act_kind(duel, 0, "normal_summon", give(duel, 0, "LD-002"))
        act_kind(duel, 0, "end_turn")
        act_kind(duel, 1, "normal_summon", give(duel, 1, "LD-008"))
        act_kind(duel, 1, "end_turn")
        ev = act_kind(duel, 0, "activate_spell", rift)
        self.assertEqual(types(ev).count("MONSTER_DESTROYED"), 2)
        self.assertEqual(duel._all_monsters(), [])

    def test_field_spell_boost_and_env(self):
        duel = make(deck("LD-107"), deck("LD-009"))
        act_kind(duel, 0, "activate_spell", give(duel, 0, "LD-107"))
        act_kind(duel, 0, "end_turn")
        serpent = give(duel, 1, "LD-009")
        act_kind(duel, 1, "normal_summon", serpent)
        self.assertEqual(duel.stats(serpent), (2100, 1800))
        self.assertEqual(duel.view(0)["env"], "abyss")

    def test_field_spell_replacement(self):
        duel = make(deck("LD-108", "LD-109"), deck())
        a = give(duel, 0, "LD-108")
        b = give(duel, 0, "LD-109")
        act_kind(duel, 0, "activate_spell", a)
        ev = act_kind(duel, 0, "activate_spell", b)
        self.assertEqual(types(ev)[0], "FIELD_SPELL_REMOVED")
        self.assertIn(a, duel.pl(0)["gy"])
        self.assertEqual(duel.view(1)["env"], "sanctum")

    def test_veil_locks_attacks_for_three_turns(self):
        duel = make(deck("LD-105"), deck("LD-002"))
        veil = give(duel, 0, "LD-105")
        act_kind(duel, 0, "activate_spell", veil)
        act_kind(duel, 0, "end_turn")
        knight = give(duel, 1, "LD-002")
        act_kind(duel, 1, "normal_summon", knight)
        for n in range(3):
            act_kind(duel, 1, "enter_battle")
            self.assertNotIn("attack", kinds(duel, 1), f"locked on opponent turn {n + 1}")
            ev = end_turn(duel, 1)
            if n < 2:
                self.assertEqual(duel.c(veil)["zone"], "st")
                end_turn(duel, 0)
        self.assertIn("EFFECT_EXPIRED", types(ev))
        self.assertEqual(duel.c(veil)["zone"], "gy")
        end_turn(duel, 0)
        act_kind(duel, 1, "enter_battle")
        self.assertIn("attack", kinds(duel, 1))

    def test_arc_bolt_destroys_target(self):
        duel = make(deck("LD-103"), deck("LD-008"))
        bolt = give(duel, 0, "LD-103")
        act_kind(duel, 0, "end_turn")
        imp = give(duel, 1, "LD-008")
        act_kind(duel, 1, "set_monster", imp)
        act_kind(duel, 1, "end_turn")
        act_kind(duel, 0, "activate_spell", bolt, target=imp)
        self.assertEqual(duel.c(imp)["zone"], "gy")

    def test_rite_of_return_revives_opponents_monster(self):
        duel = make(deck("LD-104", "LD-103"), deck("LD-007"))
        rite = give(duel, 0, "LD-104")
        bolt = give(duel, 0, "LD-103")
        act_kind(duel, 0, "end_turn")
        nyx = give(duel, 1, "LD-007")
        act_kind(duel, 1, "normal_summon", nyx)
        act_kind(duel, 1, "end_turn")
        act_kind(duel, 0, "activate_spell", bolt, target=nyx)
        ev = act_kind(duel, 0, "activate_spell", rite, target=nyx)
        summon = next(e for e in ev if e["type"] == "MONSTER_SUMMONED")
        self.assertEqual(summon["method"], "revive")
        self.assertIn(nyx, duel.pl(0)["monsters"])
        # Destroying it sends it back to its owner's Graveyard.
        duel._destroy(nyx, "test")
        self.assertIn(nyx, duel.pl(1)["gy"])
        self.assertNotIn(nyx, duel.pl(0)["monsters"])

    def test_fusion(self):
        duel = Duel(DB, [deck("LD-106", "LD-002", "LD-003", extra=["LD-F01"]), deck()], ["A", "B"],
                    profile="citadel", seed=3, first=0)
        duel.start()
        rite = give(duel, 0, "LD-106")
        knight = give(duel, 0, "LD-002")
        hawk = give(duel, 0, "LD-003")
        act_kind(duel, 0, "normal_summon", knight)
        ev = act_kind(duel, 0, "activate_spell", rite)
        t = types(ev)
        self.assertEqual(t[:3], ["SPELL_ACTIVATED", "FUSION_SUMMON_STARTED", "MONSTER_SUMMONED"])
        self.assertEqual(set(duel.pl(0)["gy"]), {knight, hawk, rite})
        fusion = ev[2]["iid"]
        self.assertEqual(duel.c(fusion)["cid"], "LD-F01")
        self.assertEqual(duel.pl(0)["extra"], [])


class TurnStructure(unittest.TestCase):
    def test_citadel_first_player_skips_draw(self):
        duel = make(deck(), deck(), profile="citadel")
        self.assertEqual(len(duel.pl(0)["hand"]), 5)
        act_kind(duel, 0, "end_turn")
        self.assertEqual(len(duel.pl(1)["hand"]), 6)

    def test_frontier_first_player_draws(self):
        duel = make(deck(), deck(), profile="frontier")
        self.assertEqual(len(duel.pl(0)["hand"]), 6)

    def test_hand_limit_discard(self):
        duel = make(deck(), deck())
        for _ in range(2):
            iid = duel.pl(0)["deck"].pop(0)
            duel.pl(0)["hand"].append(iid)
            duel.c(iid)["zone"] = "hand"
        act_kind(duel, 0, "end_turn")
        self.assertEqual(duel.state["pending"]["kind"], "discard")
        act_kind(duel, 0, "discard")
        act_kind(duel, 0, "discard")
        self.assertEqual(duel.state["active"], 1)
        self.assertEqual(len(duel.pl(0)["hand"]), 6)

    def test_deck_out_loses(self):
        duel = make(deck(), deck())
        duel.pl(1)["deck"].clear()
        ev = act_kind(duel, 0, "end_turn")
        self.assertEqual(ev[-1]["type"], "DUEL_WON")
        self.assertEqual(duel.state["winner"], 0)

    def test_illegal_actions_rejected(self):
        duel = make(deck(), deck())
        with self.assertRaises(RuleError):
            duel.act(1, "end")
        with self.assertRaises(RuleError):
            duel.act(0, "atk:fake:direct")

    def test_change_position_once(self):
        duel = make(deck("LD-002"), deck())
        k = give(duel, 0, "LD-002")
        act_kind(duel, 0, "normal_summon", k)
        self.assertNotIn("change_position", kinds(duel, 0), "not on the turn it was summoned")
        act_kind(duel, 0, "end_turn")
        act_kind(duel, 1, "end_turn")
        act_kind(duel, 0, "change_position", k)
        self.assertEqual(duel.c(k)["position"], "def")
        self.assertNotIn("change_position", kinds(duel, 0))


class HiddenInformation(unittest.TestCase):
    def test_views_hide_opponent_secrets(self):
        duel = make(deck("LD-002", "LD-201"), deck())
        knight = give(duel, 0, "LD-002")
        trap = give(duel, 0, "LD-201")
        ev_set = act_kind(duel, 0, "set_monster", knight)
        ev_trap = act_kind(duel, 0, "set_spell_trap", trap)
        v1 = duel.view(1)
        self.assertIsNone(v1["players"][0]["hand"])
        self.assertEqual(v1["players"][0]["hand_count"], len(duel.pl(0)["hand"]))
        slot = duel.c(knight)["slot"]
        self.assertIsNone(v1["players"][0]["monsters"][slot]["cid"])
        self.assertNotIn("atk", v1["players"][0]["monsters"][slot])
        self.assertIsNone(v1["players"][0]["st"][duel.c(trap)["slot"]]["cid"])
        v0 = duel.view(0)
        self.assertEqual(v0["players"][0]["monsters"][slot]["cid"], "LD-002")
        self.assertNotIn("cid", duel.redact_event(ev_set[0], 1))
        self.assertNotIn("cid", duel.redact_event(ev_trap[0], 1))
        self.assertEqual(duel.redact_event(ev_trap[0], 0)["cid"], "LD-201")
        act_kind(duel, 0, "end_turn")

    def test_draw_events_hidden_from_opponent(self):
        duel = Duel(DB, [deck(), deck()], ["A", "B"], profile="frontier", seed=1, first=0)
        ev = duel.start()
        draws = [e for e in ev if e["type"] == "CARD_DRAWN" and e["player"] == 0]
        r = duel.redact_event(draws[0], 1)
        self.assertNotIn("cids", r)
        self.assertNotIn("iids", r)
        self.assertEqual(r["count"], 5)
        self.assertIn("cids", duel.redact_event(draws[0], 0))

    def test_instance_ids_do_not_reveal_deck_order(self):
        duel = make(deck(), deck())
        ids = duel.pl(0)["deck"]
        self.assertNotEqual(ids, sorted(ids))


class Decks(unittest.TestCase):
    def test_preset_decks_valid(self):
        for d in DECKS.values():
            for profile in ("frontier", "citadel"):
                self.assertEqual(validate_deck(DB, d, profile), [], d["id"])

    def test_invalid_deck(self):
        problems = validate_deck(DB, {"main": ["LD-001"] * 4, "extra": ["LD-002"]}, "citadel")
        self.assertTrue(any("Main deck" in p for p in problems))
        self.assertTrue(any("copies" in p for p in problems))
        self.assertTrue(any("Extra Deck" in p for p in problems))

    def test_showcase_puts_signature_in_opening_hand(self):
        d = [DECKS["radiant"], DECKS["void"]]
        for seed in range(10):
            duel = Duel(DB, d, ["A", "B"], profile="frontier", seed=seed, first=0,
                        showcase={0: "LD-001", 1: "LD-007"})
            duel.start()
            self.assertIn("LD-001", [duel.c(i)["cid"] for i in duel.pl(0)["hand"]])
            self.assertIn("LD-007", [duel.c(i)["cid"] for i in duel.pl(1)["hand"]])


if __name__ == "__main__":
    unittest.main()
