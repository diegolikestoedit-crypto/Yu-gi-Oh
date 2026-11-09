"""Coin toss, hand ambushes, Tokens, life drains, Ritual Summons, monster steal, walls and on-kill effects."""
import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from engine.cards import load_db  # noqa: E402
from engine.rules import Duel  # noqa: E402
from test_rules import DB, act_kind, deck, end_turn, give, make, skip_window, types  # noqa: E402


def place(duel, p, cid, slot, position="atk"):
    i = give(duel, p, cid)
    duel._remove(i)
    duel._place_monster(i, p, slot, position, True)
    duel.c(i)["turn_placed"] = duel.state["turn"] - 1
    return i


class Mechanics(unittest.TestCase):
    def test_coin_toss_winner_chooses(self):
        duel = Duel(DB, [deck(), deck()], ["A", "B"], profile="citadel", seed=3)
        ev = duel.start()
        flip = next(e for e in ev if e["type"] == "COIN_FLIP")
        self.assertEqual(duel.state["pending"]["kind"], "turn_order")
        self.assertEqual(duel.decider(), flip["winner"])
        self.assertEqual(len(duel.pl(0)["hand"]), 0, "hands are drawn after the choice")
        duel.act(flip["winner"], "second")
        self.assertEqual(duel.state["active"], 1 - flip["winner"])
        self.assertEqual(len(duel.pl(0)["hand"]) + len(duel.pl(1)["hand"]), 14)  # 7 + 7; the first player skips the draw

    def test_hand_ambush_redirects_an_attack(self):
        duel = make(deck("LD-001"), deck("LD-338"), profile="frontier")
        end_turn(duel, 0)
        end_turn(duel, 1)
        dragon = give(duel, 0, "LD-001")
        act_kind(duel, 0, "normal_summon", dragon)
        skip_window(duel)
        sentinel = give(duel, 1, "LD-338")
        act_kind(duel, 0, "enter_battle")
        act_kind(duel, 0, "attack", dragon, target=None)
        ev = act_kind(duel, 1, "hand_summon", sentinel)
        self.assertIn("HAND_TRAP", types(ev))
        self.assertIn("ATTACK_REDIRECTED", types(ev))
        self.assertEqual(duel.pl(1)["lp"], 4000, "the direct attack hit the Sentinel instead")

    def test_tokens_vanish(self):
        duel = make(deck("LD-222"), deck("LD-102"), profile="frontier")
        shields = give(duel, 0, "LD-222")
        act_kind(duel, 0, "set_spell_trap", shields)
        end_turn(duel, 0)
        end_turn(duel, 1)
        act_kind(duel, 0, "activate_trap", shields)
        tokens = [i for i in duel._monsters(0) if DB[duel.c(i)["cid"]].get("token")]
        self.assertEqual(len(tokens), 2)
        duel._destroy(tokens[0], "effect")
        self.assertEqual(duel.c(tokens[0])["zone"], "gone")
        self.assertNotIn(tokens[0], duel.pl(0)["gy"])

    def test_cursed_brand_drains_every_turn(self):
        duel = make(deck("LD-224"), deck(), profile="frontier")
        brand = give(duel, 0, "LD-224")
        act_kind(duel, 0, "set_spell_trap", brand)
        end_turn(duel, 0)
        end_turn(duel, 1)
        act_kind(duel, 0, "activate_trap", brand)
        end_turn(duel, 0)
        self.assertEqual(duel.pl(1)["lp"], 4000 - 400)
        end_turn(duel, 1)
        end_turn(duel, 0)
        self.assertEqual(duel.pl(1)["lp"], 4000 - 800)

    def test_ritual_summon(self):
        duel = make(deck("LD-R01", "LD-141", "LD-002", "LD-003"), deck(), profile="citadel")
        colossus = give(duel, 0, "LD-R01")
        rite = give(duel, 0, "LD-141")
        give(duel, 0, "LD-002"); give(duel, 0, "LD-003")  # noqa: E702
        self.assertFalse(any(a["card"] == colossus and a["kind"] == "normal_summon" for a in duel.legal_actions(0)))
        ev = act_kind(duel, 0, "activate_spell", rite, target=colossus)
        self.assertIn("RITUAL_STARTED", types(ev))
        self.assertEqual(duel.c(colossus)["zone"], "monster")
        self.assertEqual(duel.c(rite)["zone"], "gy")

    def test_mind_lure_borrows_until_end_phase(self):
        duel = make(deck("LD-138"), deck("LD-001"), profile="frontier")
        end_turn(duel, 0)
        dragon = give(duel, 1, "LD-001")
        act_kind(duel, 1, "normal_summon", dragon)
        end_turn(duel, 1)
        ev = act_kind(duel, 0, "activate_spell", give(duel, 0, "LD-138"))
        self.assertIn("CONTROL_CHANGED", types(ev))
        self.assertIn(dragon, duel._monsters(0))
        end_turn(duel, 0)
        self.assertIn(dragon, duel._monsters(1), "it goes home in the End Phase")

    def test_wall_gy_atk_and_kill_trigger(self):
        duel = make(deck("LD-341", "LD-342", "LD-343", "LD-004"), deck("LD-004"), profile="frontier")
        end_turn(duel, 0)
        end_turn(duel, 1)
        tortoise = place(duel, 0, "LD-341", 0, "atk")
        imp = place(duel, 0, "LD-342", 1)
        ghoul = place(duel, 0, "LD-343", 2)
        golem = place(duel, 1, "LD-004", 2)  # 1300 ATK
        base = duel.stats(ghoul)[0]
        act_kind(duel, 0, "enter_battle")
        act_kind(duel, 0, "attack", tortoise, target=golem)  # 500 vs 1300: the Tortoise survives
        self.assertEqual(duel.c(tortoise)["zone"], "monster")
        hand = len(duel.pl(0)["hand"])
        act_kind(duel, 0, "attack", imp, target=golem)  # 1600 beats 1300: Bloodfang draws
        self.assertEqual(len(duel.pl(0)["hand"]), hand + 1)
        duel._destroy(tortoise, "effect")
        self.assertEqual(duel.stats(ghoul)[0], base + 200)


if __name__ == "__main__":
    unittest.main()
