"""Hand size, deck size, Fusion levels, and the technical card mechanics."""
import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from engine.cards import load_db, load_decks, validate_deck  # noqa: E402
from engine.rules import Duel  # noqa: E402
from test_rules import act_kind, deck, end_turn, give, make, types  # noqa: E402

DB = load_db()
DECKS = load_decks()


def pass_all(duel):
    """Let every pending response window go by."""
    ev = []
    while duel.state["pending"] and duel.state["pending"]["kind"] == "response":
        ev += duel.act(duel.decider(), "pass")
    return ev


class HandAndDeck(unittest.TestCase):
    def test_preset_decks_are_50_cards_and_legal(self):
        for d in DECKS.values():
            self.assertEqual(len(d["main"]), 50, d["id"])
            self.assertEqual(validate_deck(DB, d, "citadel"), [], d["id"])

    def test_limited_cards(self):
        d = {"main": ["LD-102"] * 2 + ["LD-004"] * 48, "extra": []}
        self.assertTrue(any("At most 1 copy" in p for p in validate_deck(DB, d, "citadel")))

    def test_opening_hand_is_seven(self):
        duel = make(deck(), deck(), profile="citadel")
        self.assertEqual(len(duel.pl(0)["hand"]), 7)
        self.assertEqual(len(duel.pl(1)["hand"]), 7)

    def test_draw_phase_refills_hand_to_four(self):
        duel = make(deck(), deck(), profile="citadel")
        end_turn(duel, 0)
        pl = duel.pl(1)
        for iid in list(pl["hand"])[:6]:  # leave 2 cards in hand (test setup)
            pl["hand"].remove(iid)
            pl["deck"].append(iid)
            duel.c(iid)["zone"] = "deck"
        end_turn(duel, 1)
        end_turn(duel, 0)
        ev = duel.take_events()
        self.assertGreaterEqual(len(pl["hand"]), 4)
        self.assertEqual(len(pl["hand"]), 4)  # 2 + 1 draw + 1 refill


class Fusion(unittest.TestCase):
    def test_every_fusion_is_level_seven_or_more(self):
        for c in DB.values():
            if c.get("subtype") == "fusion":
                self.assertGreaterEqual(c["level"], 7, c["name"])

    def test_low_level_fusion_rejected(self):
        import json, tempfile
        data = {"cards": [dict(DB["LD-F01"], level=6)]}
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump(data, f)
        with self.assertRaises(ValueError):
            load_db(f.name)
        os.unlink(f.name)


class Equip(unittest.TestCase):
    def test_equip_boosts_and_dies_with_monster(self):
        duel = make(deck("LD-002", "LD-121"), deck("LD-103"))
        knight = give(duel, 0, "LD-002")
        blade = give(duel, 0, "LD-121")
        act_kind(duel, 0, "normal_summon", knight)
        ev = act_kind(duel, 0, "activate_spell", blade, target=knight)
        self.assertIn("EQUIP_ATTACHED", types(ev))
        self.assertEqual(duel.stats(knight)[0], 1700 + 700)
        end_turn(duel, 0)
        bolt = give(duel, 1, "LD-103")
        ev = act_kind(duel, 1, "activate_spell", bolt, target=knight)
        ev += pass_all(duel)
        self.assertEqual(duel.c(blade)["zone"], "gy")
        self.assertIn("CARD_DESTROYED", types(ev))


class QuickPlayAndCounter(unittest.TestCase):
    def test_set_surge_strike_turns_an_attack_around(self):
        duel = make(deck("LD-002"), deck("LD-034", "LD-123"))
        end_turn(duel, 0)
        mirror = give(duel, 1, "LD-034")  # 1600 ATK
        surge = give(duel, 1, "LD-123")
        act_kind(duel, 1, "normal_summon", mirror)
        act_kind(duel, 1, "set_spell_trap", surge)
        end_turn(duel, 1)
        knight = give(duel, 0, "LD-002")  # 1700 ATK
        act_kind(duel, 0, "normal_summon", knight)
        pass_all(duel)
        act_kind(duel, 0, "enter_battle")
        act_kind(duel, 0, "attack", knight, target=mirror)
        ev = act_kind(duel, 1, "activate_quick", surge, target=mirror)
        self.assertIn("MONSTER_BOOSTED", types(ev))
        self.assertEqual(duel.c(knight)["zone"], "gy")  # 1700 vs 2600
        self.assertEqual(duel.c(mirror)["zone"], "monster")

    def test_null_seal_negates_a_spell(self):
        duel = make(deck("LD-103"), deck("LD-211", "LD-004"))
        end_turn(duel, 0)
        seal = give(duel, 1, "LD-211")
        golem = give(duel, 1, "LD-004")
        act_kind(duel, 1, "normal_summon", golem)
        act_kind(duel, 1, "set_spell_trap", seal)
        end_turn(duel, 1)
        bolt = give(duel, 0, "LD-103")
        act_kind(duel, 0, "activate_spell", bolt, target=golem)
        self.assertEqual(duel.state["pending"]["trigger"], "opp_spell")
        ev = act_kind(duel, 1, "activate_trap", seal)
        self.assertIn("SPELL_NEGATED", types(ev))
        self.assertEqual(duel.c(golem)["zone"], "monster")
        self.assertEqual(duel.c(bolt)["zone"], "gy")
        self.assertEqual(duel.pl(1)["lp"], 4000 - 1000)

    def test_mystic_squall_chains_onto_the_spell(self):
        duel = make(deck("LD-121", "LD-002"), deck("LD-126"))
        end_turn(duel, 0)
        squall = give(duel, 1, "LD-126")
        act_kind(duel, 1, "set_spell_trap", squall)
        end_turn(duel, 1)
        knight = give(duel, 0, "LD-002")
        blade = give(duel, 0, "LD-121")
        act_kind(duel, 0, "normal_summon", knight)
        pass_all(duel)
        act_kind(duel, 0, "activate_spell", blade, target=knight)
        act_kind(duel, 1, "activate_quick", squall, target=blade)
        self.assertEqual(duel.c(blade)["zone"], "gy")
        self.assertEqual(duel.stats(knight)[0], 1700)


class MonsterEffects(unittest.TestCase):
    def test_piercing_damage(self):
        duel = make(deck("LD-307", "LD-121"), deck())
        end_turn(duel, 0)
        golem = give(duel, 1, "LD-004")
        act_kind(duel, 1, "set_monster", golem)  # DEF 2000
        end_turn(duel, 1)
        lancer = give(duel, 0, "LD-307")  # 1800 ATK, piercing
        blade = give(duel, 0, "LD-121")
        act_kind(duel, 0, "normal_summon", lancer)
        act_kind(duel, 0, "activate_spell", blade, target=lancer)  # 2500 ATK
        act_kind(duel, 0, "enter_battle")
        act_kind(duel, 0, "attack", lancer, target=golem)
        self.assertEqual(duel.c(golem)["zone"], "gy")
        self.assertEqual(duel.pl(1)["lp"], 4000 - 500)

    def test_flip_effect_on_being_attacked(self):
        duel = make(deck("LD-001"), deck("LD-304"))
        end_turn(duel, 0)
        mimic = give(duel, 1, "LD-304")
        act_kind(duel, 1, "set_monster", mimic)
        end_turn(duel, 1)
        dragon = give(duel, 0, "LD-001")
        act_kind(duel, 0, "normal_summon", dragon)
        pass_all(duel)
        act_kind(duel, 0, "enter_battle")
        ev = act_kind(duel, 0, "attack", dragon, target=mimic)
        self.assertIn("MONSTER_EFFECT", types(ev))
        self.assertEqual(duel.c(dragon)["zone"], "gy")  # the Mimic's FLIP takes the dragon with it

    def test_summon_search(self):
        duel = make(deck("LD-301", "LD-002"), deck())
        scout = give(duel, 0, "LD-301")
        ev = act_kind(duel, 0, "normal_summon", scout)
        self.assertIn("CARD_ADDED_TO_HAND", types(ev))
        added = next(e for e in ev if e["type"] == "CARD_ADDED_TO_HAND")
        self.assertEqual(DB[added["cid"]]["attribute"], "LIGHT")

    def test_battle_destruction_summons_from_deck(self):
        duel = make(deck("LD-001"), deck("LD-305", *["LD-008"] * 20))
        end_turn(duel, 0)
        acolyte = give(duel, 1, "LD-305")
        act_kind(duel, 1, "normal_summon", acolyte)
        end_turn(duel, 1)
        dragon = give(duel, 0, "LD-001")
        act_kind(duel, 0, "normal_summon", dragon)
        pass_all(duel)
        act_kind(duel, 0, "enter_battle")
        ev = act_kind(duel, 0, "attack", dragon, target=acolyte)
        summoned = [e for e in ev if e["type"] == "MONSTER_SUMMONED" and e["method"] == "effect"]
        self.assertEqual(len(summoned), 1)
        self.assertEqual(DB[summoned[0]["cid"]]["attribute"], "DARK")


if __name__ == "__main__":
    unittest.main()
