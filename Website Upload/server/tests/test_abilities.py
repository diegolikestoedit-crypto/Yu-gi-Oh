"""New abilities: summon chain combo, Trap counters, Spell/Trap seals, bounces, extra draws, double/direct attacks."""
import collections
import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from engine.cards import load_db, load_decks  # noqa: E402
from test_rules import act_kind, deck, end_turn, give, make, skip_window, types  # noqa: E402

DB = load_db()


class Abilities(unittest.TestCase):
    def test_summon_chain_into_the_ace(self):
        """Rally Captain fetches Rally Call, which calls 2 monsters, which Grand Offering Tributes into the ace."""
        duel = make(deck("LD-337", "LD-135", "LD-136", "LD-002", "LD-003", "LD-001"), deck(), profile="citadel")
        captain = give(duel, 0, "LD-337")
        ev = act_kind(duel, 0, "normal_summon", captain)
        added = [e for e in ev if e["type"] == "CARD_ADDED_TO_HAND"]
        self.assertEqual(len(added), 1)
        self.assertIn(added[0]["cid"], ("LD-135", "LD-136"))
        call = give(duel, 0, "LD-135")
        ev = act_kind(duel, 0, "activate_spell", call)
        self.assertEqual(sum(1 for e in ev if e["type"] == "MONSTER_SUMMONED"), 2)
        self.assertEqual(len(duel._monsters(0)), 3)
        offering = give(duel, 0, "LD-136")
        ev = act_kind(duel, 0, "activate_spell", offering, search="LD-001")
        self.assertIn("TRIBUTE_SUMMON_STARTED", types(ev))
        self.assertEqual(sum(1 for e in ev if e["type"] == "MONSTER_TRIBUTED"), 2)
        self.assertIn("LD-001", [duel.c(i)["cid"] for i in duel._monsters(0)])

    def test_seal_breaker_counters_a_trap(self):
        duel = make(deck("LD-002", "LD-218"), deck("LD-201"), profile="frontier")
        breaker = give(duel, 0, "LD-218")
        act_kind(duel, 0, "set_spell_trap", breaker)
        end_turn(duel, 0)
        ward = give(duel, 1, "LD-201")
        act_kind(duel, 1, "set_spell_trap", ward)
        end_turn(duel, 1)
        knight = give(duel, 0, "LD-002")
        act_kind(duel, 0, "normal_summon", knight)
        act_kind(duel, 0, "enter_battle")
        act_kind(duel, 0, "attack", knight, target=None)
        act_kind(duel, 1, "activate_trap", ward)  # Prism Ward would destroy the knight...
        self.assertEqual(duel.state["pending"]["trigger"], "opp_trap")
        ev = act_kind(duel, 0, "activate_trap", breaker)  # ...but Seal Breaker negates it
        self.assertIn("SPELL_NEGATED", types(ev))
        self.assertEqual(duel.c(knight)["zone"], "monster")
        self.assertEqual(duel.pl(1)["lp"], 4000 - 1700, "the attack goes through afterwards")
        self.assertEqual(duel.pl(0)["lp"], 4000 - 500)

    def test_silence_field_stops_traps(self):
        duel = make(deck("LD-002", "LD-134"), deck("LD-201"), profile="frontier")
        end_turn(duel, 0)
        act_kind(duel, 1, "set_spell_trap", give(duel, 1, "LD-201"))
        end_turn(duel, 1)
        act_kind(duel, 0, "activate_spell", give(duel, 0, "LD-134"))
        knight = give(duel, 0, "LD-002")
        act_kind(duel, 0, "normal_summon", knight)
        act_kind(duel, 0, "enter_battle")
        ev = act_kind(duel, 0, "attack", knight, target=None)
        self.assertIsNone(duel.state["pending"], "no window: their Traps are sealed")
        self.assertIn("ATTACK_RESOLVED", types(ev))

    def test_arcane_gag_on_your_own_turn(self):
        duel = make(deck("LD-220"), deck("LD-103", "LD-002"), profile="frontier")
        gag = give(duel, 0, "LD-220")
        act_kind(duel, 0, "set_spell_trap", gag)
        end_turn(duel, 0)
        end_turn(duel, 1)
        act_kind(duel, 0, "activate_trap", gag)  # a Trap used in your own Main Phase
        self.assertTrue(duel.c(gag)["face_up"])
        end_turn(duel, 0)
        self.assertFalse(any(a["kind"] == "activate_spell" for a in duel.legal_actions(1)))

    def test_bounce_standby_double_and_direct(self):
        duel = make(deck("LD-329", "LD-333", "LD-334", "LD-335"), deck("LD-001"), profile="frontier")
        magpie = give(duel, 0, "LD-329")
        act_kind(duel, 0, "normal_summon", magpie)
        end_turn(duel, 0)
        dragon = give(duel, 1, "LD-001")
        act_kind(duel, 1, "normal_summon", dragon)
        end_turn(duel, 1)
        draws = [e for e in duel.take_events()]  # noqa: F841
        hand_before = len(duel.pl(0)["hand"])
        # Lucky Magpie drew an extra card in the Standby Phase.
        self.assertGreaterEqual(hand_before, 9)
        siren = give(duel, 0, "LD-335")
        ev = act_kind(duel, 0, "normal_summon", siren)
        self.assertIn("MONSTER_BOUNCED", types(ev))
        self.assertEqual(duel.c(dragon)["zone"], "hand")
        duel._remove(siren); duel._place_monster(siren, 0, 4, "atk", True)  # noqa: E702
        ronin, stalker = give(duel, 0, "LD-333"), give(duel, 0, "LD-334")
        for i, slot in ((ronin, 0), (stalker, 3)):
            duel._remove(i); duel._place_monster(i, 0, slot, "atk", True)  # noqa: E702
        golem = next(i for i in duel.pl(1)["hand"] if duel.c(i)["cid"] == "LD-004")
        duel._remove(golem); duel._place_monster(golem, 1, 2, "def", True)  # noqa: E702
        act_kind(duel, 0, "enter_battle")
        act_kind(duel, 0, "attack", stalker, target=None)  # direct, over the Golem
        self.assertEqual(duel.pl(1)["lp"], 4000 - 1300)
        lp = duel.pl(1)["lp"]
        act_kind(duel, 0, "attack", ronin, target=golem)
        self.assertTrue(any(a["kind"] == "attack" and a["card"] == ronin for a in duel.legal_actions(0)), "Ronin attacks twice")

    def test_every_deck_has_its_own_mix(self):
        mixes = set()
        for d in load_decks().values():
            self.assertEqual(len(d["main"]), 50)
            c = collections.Counter(DB[x]["type"] for x in d["main"])
            mixes.add((c["monster"], c["spell"], c["trap"]))
        self.assertGreaterEqual(len(load_decks()), 14)
        self.assertGreaterEqual(len(mixes), 12)


if __name__ == "__main__":
    unittest.main()
