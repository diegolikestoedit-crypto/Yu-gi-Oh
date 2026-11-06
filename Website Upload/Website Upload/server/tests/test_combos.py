"""The combo layer: Heralds, Combining on the field, Ascension, and calling your best monster."""
import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from engine.cards import load_decks, validate_deck, load_db  # noqa: E402
from test_rules import act_kind, deck, end_turn, give, make, types  # noqa: E402
from test_technical import pass_all  # noqa: E402

DB = load_db()


def radiant(*extra_main):
    return deck("LD-321", "LD-002", "LD-003", "LD-128", "LD-127", "LD-001", *extra_main, extra=["LD-F01", "LD-A01"])


class Combos(unittest.TestCase):
    def herald_line(self, duel):
        """Normal Summon the Herald, call Lumen Sentinel from the hand, then Combine into Aegis Gryphon Knight."""
        herald = give(duel, 0, "LD-321")
        lumen = give(duel, 0, "LD-002")
        ev = act_kind(duel, 0, "normal_summon", herald)
        ev += pass_all(duel)
        self.assertEqual(duel.state["pending"]["kind"], "choice")
        ev += act_kind(duel, 0, "choose", lumen)
        self.assertEqual(duel.c(lumen)["zone"], "monster")
        ev += act_kind(duel, 0, "contact_fusion")
        knight = next(e["iid"] for e in ev if e["type"] == "MONSTER_SUMMONED" and e["method"] == "fusion")
        self.assertEqual(duel.c(knight)["cid"], "LD-F01")
        self.assertEqual({duel.c(herald)["zone"], duel.c(lumen)["zone"]}, {"gy"})
        return knight, ev

    def test_herald_calls_and_substitutes_for_a_material(self):
        duel = make(radiant(), deck(), profile="citadel")
        _, ev = self.herald_line(duel)
        self.assertIn("FUSION_SUMMON_STARTED", types(ev))
        self.assertTrue(next(e for e in ev if e["type"] == "FUSION_SUMMON_STARTED")["contact"])
        self.assertNotIn("contact_fusion", {a["kind"] for a in duel.legal_actions(0)}, "once per turn")

    def test_herald_effect_can_be_skipped(self):
        duel = make(radiant(), deck(), profile="citadel")
        herald = give(duel, 0, "LD-321")
        give(duel, 0, "LD-002")
        act_kind(duel, 0, "normal_summon", herald)
        act_kind(duel, 0, "skip")
        self.assertIsNone(duel.state["pending"])
        self.assertEqual(len(duel._monsters(0)), 1)

    def test_crown_of_ascension(self):
        duel = make(radiant(), deck("LD-204"), profile="citadel")
        end_turn(duel, 0)
        snare = give(duel, 1, "LD-204")
        act_kind(duel, 1, "set_spell_trap", snare)
        end_turn(duel, 1)
        knight, _ = self.herald_line(duel)
        crown = give(duel, 0, "LD-128")
        ev = act_kind(duel, 0, "activate_spell", crown, target=knight)
        ev += pass_all(duel)
        self.assertIn("ASCENSION_STARTED", types(ev))
        paragon = next(e["iid"] for e in ev if e["type"] == "MONSTER_SUMMONED" and e["method"] == "ascension")
        self.assertEqual(duel.c(paragon)["cid"], "LD-A01")
        self.assertEqual(duel.c(snare)["zone"], "gy", "Paragon's effect clears the opponent's Spells/Traps")

    def test_ascension_rite_from_a_set_trap(self):
        duel = make(radiant("LD-213"), deck(), profile="citadel")
        knight, _ = self.herald_line(duel)
        rite = give(duel, 0, "LD-213")
        act_kind(duel, 0, "set_spell_trap", rite)
        end_turn(duel, 0)
        # The opponent summons; the Set Rite answers by ascending the Gryphon Knight.
        act_kind(duel, 1, "normal_summon", give(duel, 1, "LD-004"))
        self.assertEqual(duel.state["pending"]["trigger"], "opp_summon")
        ev = act_kind(duel, 0, "activate_trap", rite)
        self.assertIn("ASCENSION_STARTED", types(ev))
        self.assertEqual(duel.c(knight)["zone"], "gy")

    def test_champions_call(self):
        duel = make(radiant(), deck(), profile="citadel")
        call = give(duel, 0, "LD-127")
        ev = act_kind(duel, 0, "activate_spell", call, search="LD-001")
        summoned = [e for e in ev if e["type"] == "MONSTER_SUMMONED"]
        self.assertEqual(summoned[0]["cid"], "LD-001")
        self.assertTrue(duel.c(summoned[0]["iid"])["attacked"], "can't attack the turn it is called")

    def test_last_stand_rally(self):
        duel = make(deck("LD-214", "LD-001"), deck("LD-002"), profile="frontier")
        dragon = give(duel, 0, "LD-001")
        rally = give(duel, 0, "LD-214")
        act_kind(duel, 0, "normal_summon", dragon)
        duel._destroy(dragon, "effect")  # setup: the dragon is in the Graveyard
        act_kind(duel, 0, "set_spell_trap", rally)
        end_turn(duel, 0)
        knight = give(duel, 1, "LD-002")
        act_kind(duel, 1, "normal_summon", knight)
        pass_all(duel)
        act_kind(duel, 1, "enter_battle")
        act_kind(duel, 1, "attack", knight, target=None)
        ev = act_kind(duel, 0, "activate_trap", rally)
        self.assertIn("ATTACK_NEGATED", types(ev))
        self.assertEqual(duel.c(dragon)["zone"], "monster")
        self.assertEqual(duel.pl(0)["lp"], 4000)

    def test_ascended_cards_are_extra_deck_only(self):
        d = {"main": ["LD-A01"] + ["LD-004"] * 49, "extra": []}
        self.assertTrue(any("Extra Deck" in p for p in validate_deck(DB, d, "citadel")))
        for dk in load_decks().values():
            self.assertEqual(validate_deck(DB, dk, "citadel"), [])
            self.assertEqual(len(dk["main"]), 50)


if __name__ == "__main__":
    unittest.main()
