"""Dev tool: run scripted duels through the real rules engine and save what one player would receive.

The client plays these back with  http://localhost:8787/?replay=<name>  so every animation can be
watched deterministically, with no random draws and no second player. Output: client/dev/replays/*.json

    python3 server/tools/make_replays.py
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from engine.cards import ROOT, load_db  # noqa: E402
from engine.rules import Duel  # noqa: E402

DB = load_db()
OUT = os.path.join(ROOT, "client", "dev", "replays")
FILLER = "LD-004"


def deck(cids, extra=()):
    return {"main": list(cids) + [FILLER] * max(0, 20 - len(cids)), "extra": list(extra)}


class Script:
    def __init__(self, d0, d1, profile="frontier", viewer=0, extra0=()):
        self.duel = Duel(DB, [deck(d0, extra0), deck(d1)], ["Ana", "Ben"], profile=profile, seed=5, first=0)
        self.viewer = viewer
        self.msgs = []
        self.given = set()
        self.record(self.duel.start())

    def record(self, events):
        d, v = self.duel, self.viewer
        self.msgs.append({"events": [d.redact_event(e, v) for e in events], "view": d.view(v),
                          "actions": d.legal_actions(v), "decider": d.decider()})

    def give(self, p, cid):
        """Setup only: put a copy of cid in p's hand, swapping a filler card back into the deck."""
        d, pl = self.duel, self.duel.pl(p)
        for iid in pl["hand"]:
            if d.c(iid)["cid"] == cid and iid not in self.given:
                self.given.add(iid)
                return iid
        iid = next(i for i in pl["deck"] if d.c(i)["cid"] == cid)
        pl["deck"].remove(iid)
        back = next((h for h in pl["hand"] if h not in self.given), None)
        if back:
            pl["hand"].remove(back)
            pl["deck"].append(back)
            d.c(back)["zone"] = "deck"
        pl["hand"].append(iid)
        d.c(iid)["zone"] = "hand"
        self.given.add(iid)
        return iid

    def place(self, p, cid, slot, position="atk", face_up=True):
        """Setup only: put a monster straight onto the field (no summon event)."""
        d = self.duel
        pl = d.pl(p)
        iid = next(i for i in pl["deck"] + pl["hand"] if d.c(i)["cid"] == cid and i not in self.given)
        self.given.add(iid)
        d._remove(iid)
        d._place_monster(iid, p, slot, position, face_up)
        d.c(iid)["turn_placed"] = d.state["turn"] - 1
        return iid

    def act(self, p, kind, card=None, **match):
        for a in self.duel.legal_actions(p):
            if a["kind"] == kind and (card is None or a["card"] == card) and all(a.get(k) == v for k, v in match.items()):
                self.record(self.duel.act(p, a["id"]))
                return
        raise AssertionError(f"no {kind} for {p}: {[a['id'] for a in self.duel.legal_actions(p)]}")

    def end(self, p):
        self.act(p, "end_turn")
        while self.duel.state["pending"] and self.duel.state["pending"]["kind"] == "discard":
            self.act(p, "discard")

    def save(self, name):
        os.makedirs(OUT, exist_ok=True)
        with open(os.path.join(OUT, name + ".json"), "w") as f:
            json.dump({"name": name, "viewer": self.viewer, "messages": self.msgs}, f, separators=(",", ":"))
        print(f"{name}: {len(self.msgs)} updates")


def tribute():
    s = Script(["LD-001", "LD-002", "LD-003"], ["LD-008"], profile="citadel")
    dragon, knight, hawk = s.give(0, "LD-001"), s.give(0, "LD-002"), s.give(0, "LD-003")
    s.act(0, "normal_summon", knight)
    s.end(0)
    imp = s.give(1, "LD-008")
    s.act(1, "normal_summon", imp)
    s.end(1)
    s.act(0, "normal_summon", hawk)
    s.act(0, "enter_battle")
    s.act(0, "attack", knight, target=imp)          # blade_dash
    s.end(0)
    s.end(1)
    s.act(0, "tribute_summon", dragon)               # two tributes
    s.act(0, "enter_battle")
    s.act(0, "attack", dragon, target=None)          # radiant beam, direct
    s.save("tribute")


def fusion():
    s = Script(["LD-106", "LD-002", "LD-003"], ["LD-009"], extra0=["LD-F01"])
    rite, knight, hawk = s.give(0, "LD-106"), s.give(0, "LD-002"), s.give(0, "LD-003")
    s.act(0, "normal_summon", knight)
    s.act(0, "activate_spell", rite)                 # knight (field) + hawk (hand)
    s.end(0)
    serpent = s.give(1, "LD-009")
    s.act(1, "normal_summon", serpent)
    gryphon = s.duel.pl(0)["monsters"][s.duel.pl(0)["monsters"].index(next(i for i in s.duel.pl(0)["monsters"] if i))]
    s.act(1, "enter_battle")
    s.act(1, "attack", serpent, target=gryphon)      # water_jet into a stronger monster
    s.end(1)
    s.act(0, "enter_battle")
    s.act(0, "attack", gryphon, target=None)         # dive, direct
    s.save("fusion")


def spells():
    s = Script(["LD-101", "LD-105", "LD-103", "LD-104"], ["LD-010"])
    chalice, veil = s.give(0, "LD-101"), s.give(0, "LD-105")
    bolt, rite = s.give(0, "LD-103"), s.give(0, "LD-104")
    s.act(0, "activate_spell", chalice)
    s.act(0, "activate_spell", veil)
    s.end(0)
    gk = s.give(1, "LD-010")
    s.act(1, "normal_summon", gk)
    s.act(1, "enter_battle")
    s.end(1)                                          # veil counts down
    s.act(0, "activate_spell", bolt, target=gk)
    s.act(0, "activate_spell", rite, target=gk)      # revive the opponent's monster
    s.end(0)
    s.end(1)
    s.end(0)
    s.end(1)                                          # veil expires
    s.save("spells")


def traps():
    s = Script(["LD-201", "LD-202", "LD-203"], ["LD-006", "LD-012"])
    ward, echo, stasis = s.give(0, "LD-201"), s.give(0, "LD-202"), s.give(0, "LD-203")
    for t in (stasis, echo, ward):
        s.act(0, "set_spell_trap", t)
    s.end(0)
    drake = s.give(1, "LD-006")
    s.act(1, "normal_summon", drake)
    s.act(0, "pass")
    s.act(1, "enter_battle")
    s.act(1, "attack", drake, target=None)
    s.act(0, "activate_trap", stasis)                 # negate + end battle
    s.end(1)
    s.end(0)
    wyrm = s.give(1, "LD-012")
    s.act(1, "normal_summon", wyrm)
    s.act(0, "pass")
    s.act(1, "enter_battle")
    s.act(1, "attack", wyrm, target=None)
    s.act(0, "activate_trap", echo)                   # negate + reflect damage
    s.act(1, "attack", drake, target=None)
    s.act(0, "activate_trap", ward)                   # destroy all attack-position attackers
    s.save("traps")


def attacks():
    s = Script(["LD-006", "LD-012", "LD-009", "LD-004", "LD-008", "LD-005"], ["LD-004"] * 3)
    s.end(0)
    s.duel.pl(1)["lp"] = 12000
    s.end(1)
    mine = [s.place(0, cid, slot) for cid, slot in
            (("LD-006", 2), ("LD-012", 1), ("LD-009", 3), ("LD-004", 0), ("LD-008", 4))]
    g1 = s.place(1, "LD-004", 2, position="def")
    g2 = s.place(1, "LD-004", 1, position="def")
    g3 = s.place(1, "LD-004", 3, position="def", face_up=False)
    s.record([])
    drake, wyrm, serpent, golem, imp = mine
    s.act(0, "enter_battle")
    s.act(0, "attack", drake, target=g1)              # fire_breath, destroys DEF 2000
    s.act(0, "attack", wyrm, target=g2)               # dark_flame
    s.act(0, "attack", serpent, target=g3)            # flips face-down, water_jet, recoil damage
    s.act(0, "attack", golem, target=g3)              # slam, equal-ish: 1300 vs DEF 2000
    s.act(0, "attack", imp, target=g3)                # shadow_bolt
    s.end(0)
    s.end(1)
    s.duel._to_gy(imp)  # setup: free a zone for the Fairy
    fairy = s.give(0, "LD-005")
    s.act(0, "normal_summon", fairy)
    s.act(0, "enter_battle")
    s.act(0, "attack", fairy, target=g3)              # shards
    s.save("attacks")


if __name__ == "__main__":
    for fn in (tribute, fusion, spells, traps, attacks):
        fn()
