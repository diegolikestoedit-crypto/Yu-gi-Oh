"""Card audit: puts every card through the situation it is built for and checks it really works.

Spells: activated from the hand, and Set then activated from the field (Quick-Plays on a later turn and in
response to an attack). Traps: Set, then the opponent does exactly what triggers them (attack, summon, Spell,
Trap) or, for "any" Traps, used in your own next Main Phase. Monsters: each effect trigger and static ability.

    python3 server/tools/audit_cards.py          # prints a line per card and a summary of failures
"""
from __future__ import annotations

import os
import sys
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from engine.cards import load_db  # noqa: E402
from engine.rules import Duel  # noqa: E402

DB = load_db()
POOL = ["LD-013", "LD-006", "LD-009", "LD-010", "LD-011", "LD-012", "LD-015", "LD-017", "LD-019", "LD-021", "LD-022",
        "LD-024", "LD-025", "LD-030", "LD-032", "LD-034", "LD-036", "LD-039", "LD-040", "LD-301", "LD-305", "LD-321"]
SPELL_POOL = ["LD-101", "LD-121", "LD-123", "LD-124", "LD-135", "LD-136"]
TRAP_POOL = ["LD-202", "LD-216", "LD-201"]


def deck(first, extra=()):
    main = [first] + POOL * 2 + SPELL_POOL + TRAP_POOL
    return {"main": main[:50], "extra": list(extra)}


class Setup:
    """A mid-game board where almost every card has something to work on."""

    def __init__(self, cid, profile="frontier"):
        self.cid = cid
        self.d = Duel(DB, [deck(cid, ["LD-F01", "LD-F01", "LD-A01"]), deck("LD-007")], ["P0", "P1"],
                      profile=profile, seed=11, first=0)
        self.d.start()
        self.events = []

    # -- setup helpers (direct state edits, before the tested action)
    def take(self, p, cid):
        d = self.d
        for z in ("hand", "deck", "extra", "gy"):
            for i in d.pl(p)[z]:
                if d.c(i)["cid"] == cid:
                    return i
        i = d._new_card(cid, p, "deck", set(d.state["cards"]))
        d.pl(p)["deck"].append(i)
        return i

    def to_hand(self, p, cid):
        d, i = self.d, self.take(p, cid)
        if d.c(i)["zone"] != "hand":
            d._remove(i)
            d.c(i).update(zone="hand")
            d.pl(p)["hand"].append(i)
        return i

    def place(self, p, cid, slot=None, position="atk", face_up=True):
        d = self.d
        i = self.take(p, cid)
        d._remove(i)
        slot = d._free_slot(d.pl(p)["monsters"]) if slot is None else slot
        d._place_monster(i, p, slot, position, face_up)
        d.c(i)["controller"] = p
        d.c(i)["turn_placed"] = d.state["turn"] - 1
        return i

    def set_st(self, p, cid, old=True):
        d = self.d
        i = self.take(p, cid)
        d._remove(i)
        d._place_st(i, p, d._free_slot(d.pl(p)["st"]), face_up=False)
        if old:
            d.c(i)["turn_placed"] = d.state["turn"] - 1
        return i

    def to_gy(self, p, cid):
        d = self.d
        i = self.take(p, cid)
        d._remove(i)
        d.c(i).update(zone="gy", face_up=True)
        d.pl(p)["gy"].append(i)
        return i

    def standard_board(self):
        """P0: two Fusion materials + a Fusion on the field, monsters in the Graveyard, Ritual pieces in hand.
        P1: a strong and a set monster, a Set Spell, monsters in the Graveyard and cards in hand."""
        self.lumen = self.place(0, "LD-002", 2)
        self.hawk = self.place(0, "LD-003", 1)
        self.fusion = self.place(0, "LD-F01", 3)
        self.to_gy(0, "LD-001")
        for c in ("LD-R01", "LD-004", "LD-024"):
            self.to_hand(0, c)
        self.foe = self.place(1, "LD-007", 2)
        self.foe2 = self.place(1, "LD-004", 1, position="def", face_up=False)
        self.set_st(1, "LD-101")
        self.to_gy(1, "LD-002")

    # -- acting
    def act(self, p, a):
        ev = self.d.act(p, a["id"] if isinstance(a, dict) else a)
        self.events += ev
        return ev

    def find(self, p, kind, card=None):
        return [a for a in self.d.legal_actions(p) if a["kind"] == kind and (card is None or a["card"] == card)]

    def settle(self, prefer=None):
        """Let response windows and choices pass (or take the preferred action when offered)."""
        for _ in range(20):
            pend = self.d.state["pending"]
            if not pend or self.d.state["winner"] is not None:
                return
            p = self.d.decider()
            acts = self.d.legal_actions(p)
            pick = next((a for a in acts if prefer and prefer(a)), None)
            pick = pick or next((a for a in acts if a["kind"] in ("pass", "skip")), None) or acts[0]
            self.act(p, pick)

    def end(self, p):
        self.settle()
        self.act(p, "end")
        while self.d.state["pending"] and self.d.state["pending"]["kind"] == "discard":
            self.act(p, self.find(p, "discard")[0])
        self.settle()

    def types(self):
        return [e["type"] for e in self.events]


def audit_spell(cid):
    c = DB[cid]
    results = []
    # 1. From the hand, this turn.
    s = Setup(cid)
    s.standard_board()
    i = s.to_hand(0, cid)
    acts = s.find(0, "activate_spell", i)
    if not acts:
        return [("hand", False, "no activation offered from the hand")]
    s.act(0, acts[0])
    s.settle()
    ok = "SPELL_ACTIVATED" in s.types()
    results.append(("hand", ok, "" if ok else "activation produced no SPELL_ACTIVATED"))
    if c["subtype"] == "field":
        return results
    # 2. Set, then activate from the field (Quick-Plays must wait a turn).
    s = Setup(cid)
    s.standard_board()
    i = s.to_hand(0, cid)
    if not s.find(0, "set_spell_trap", i):
        return results + [("set", False, "cannot be Set")]
    s.act(0, s.find(0, "set_spell_trap", i)[0])
    if c["subtype"] == "quickplay":
        if s.find(0, "activate_spell", i):
            results.append(("set-same-turn", False, "a Set Quick-Play activated the turn it was Set"))
        s.end(0)
        s.end(1)
    acts = s.find(0, "activate_spell", i)
    if not acts:
        return results + [("set", False, "Set card offers no activation")]
    before = len(s.events)
    s.act(0, acts[0])
    s.settle()
    ok = "SPELL_ACTIVATED" in [e["type"] for e in s.events[before:]]
    results.append(("set", ok, "" if ok else "no SPELL_ACTIVATED from the Set card"))
    zone = s.d.c(i)["zone"]
    if c["subtype"] in ("normal", "quickplay", "ritual") and zone == "st":
        results.append(("cleanup", False, "a used Normal/Quick-Play Spell stayed on the field"))
    # 3. Quick-Play from a Set position in answer to an attack.
    if c["subtype"] == "quickplay":
        s = Setup(cid)
        s.standard_board()
        i = s.set_st(0, cid)
        s.end(0)
        s.act(1, "battle")
        atk = next(a for a in s.d.legal_actions(1) if a["kind"] == "attack" and a["card"] == s.foe)
        s.act(1, atk)
        quick = s.find(0, "activate_quick", i)
        results.append(("response", bool(quick), "" if quick else "no response option when the opponent attacked"))
        if quick:
            s.act(0, quick[0])
            s.settle()
    return results


def audit_trap(cid):
    c = DB[cid]
    trigs = c.get("trigger")
    trigs = trigs if isinstance(trigs, list) else [trigs]
    results = []
    for trig in trigs:
        s = Setup(cid)
        s.standard_board()
        i = s.to_hand(0, cid)
        s.act(0, s.find(0, "set_spell_trap", i)[0])
        if s.find(0, "activate_trap", i):
            results.append((trig, False, "a Trap activated the turn it was Set"))
        if trig in ("any", "main"):
            s.end(0)
            s.end(1)
            acts = s.find(0, "activate_trap", i)
            results.append(("own turn", bool(acts), "" if acts else "an 'any' Trap can't be used in your own Main Phase"))
            if acts:
                s.act(0, acts[0])
                s.settle()
            # it must also answer the opponent's attack
            s2 = Setup(cid)
            s2.standard_board()
            i2 = s2.set_st(0, cid)
            s2.end(0)
            s2.act(1, "battle")
            s2.act(1, next(a for a in s2.d.legal_actions(1) if a["kind"] == "attack" and a["card"] == s2.foe))
            acts = s2.find(0, "activate_trap", i2)
            results.append(("vs attack", bool(acts), "" if acts else "an 'any' Trap can't answer an attack"))
            continue
        s.end(0)
        if trig == "opp_attack":
            s.act(1, "battle")
            s.act(1, next(a for a in s.d.legal_actions(1) if a["kind"] == "attack" and a["card"] == s.foe))
        elif trig == "opp_summon":
            m = s.to_hand(1, "LD-034")
            s.act(1, s.find(1, "normal_summon", m)[0])
            # and against a Special Summon (Rally Call), when the card has no Normal-only condition
            if "normal" not in c.get("condition", {}).get("methods", []):
                s2 = Setup(cid)
                s2.standard_board()
                i2 = s2.set_st(0, cid)
                s2.end(0)
                s2.d._to_gy(s2.foe2)
                s2.act(1, s2.find(1, "activate_spell", s2.to_hand(1, "LD-135"))[0])
                ok = bool(s2.find(0, "activate_trap", i2))
                results.append(("vs special summon", ok, "" if ok else "no answer to the opponent's Special Summon"))
        elif trig == "opp_spell":
            sp = s.to_hand(1, "LD-121")
            s.act(1, s.find(1, "activate_spell", sp)[0])
        elif trig == "opp_trap":
            # the opponent springs a Trap of its own: Treasure Cache, Set a turn earlier
            s.set_st(1, "LD-216")
            s.act(1, s.find(1, "activate_trap")[0])
        acts = s.find(0, "activate_trap", i)
        if not acts:
            results.append((trig, False, f"no activation offered on {trig}"))
            continue
        before = len(s.events)
        s.act(0, acts[0])
        s.settle()
        new = [e["type"] for e in s.events[before:]]
        ok = "TRAP_ACTIVATED" in new
        results.append((trig, ok, "" if ok else "no TRAP_ACTIVATED"))
        if c["subtype"] != "continuous" and s.d.c(i)["zone"] == "st":
            results.append(("cleanup", False, "a used Trap stayed on the field"))
    return results


def audit_monster(cid):
    c = DB[cid]
    eff = c.get("effect") or {}
    trig = eff.get("trigger")
    sub = c["subtype"]
    out = []

    def effect_seen(s, start=0):
        return any(e["type"] == "MONSTER_EFFECT" and e["cid"] == cid for e in s.events[start:])

    if trig in ("summon", "normal_summon"):
        s = Setup(cid)
        s.standard_board()
        if sub in ("fusion", "ascended", "ritual"):
            m = s.take(0, cid)
            s.d._special_summon(0, m, sub)
            s.d._after_summon(m, sub)
            s.events += s.d.take_events()
        else:
            # make room and summon it for real (Frontier: no tributes needed)
            s.d._to_gy(s.fusion)
            m = s.to_hand(0, cid)
            acts = s.find(0, "normal_summon", m)
            if not acts:
                return [(trig, False, "cannot be Normal Summoned")]
            s.act(0, acts[0])
        s.settle(prefer=lambda a: a["kind"] == "choose")
        out.append((trig, effect_seen(s), "" if effect_seen(s) else "summon effect did not trigger"))
    if trig == "flip":
        s = Setup(cid)
        s.standard_board()
        s.d._to_gy(s.fusion)
        m = s.to_hand(0, cid)
        s.act(0, s.find(0, "set_monster", m)[0])
        s.end(0)
        s.end(1)
        acts = s.find(0, "flip_summon", m)
        if not acts:
            return [("flip", False, "no Flip Summon offered")]
        s.act(0, acts[0])
        s.settle()
        out.append(("flip", effect_seen(s), "" if effect_seen(s) else "FLIP effect did not trigger"))
    if trig == "destroyed_by_battle":
        s = Setup(cid)
        s.standard_board()
        s.d._to_gy(s.lumen)
        m = s.place(0, cid, 2)
        titan = s.place(1, "LD-598", 3)
        s.end(0)
        s.act(1, "battle")
        s.act(1, next(a for a in s.d.legal_actions(1) if a["kind"] == "attack" and a["card"] == titan and a["target"] == m))
        s.settle()
        if s.d.c(m)["zone"] == "gy":
            out.append(("destroyed_by_battle", effect_seen(s), "" if effect_seen(s) else "death effect did not trigger"))
    if trig == "standby":
        s = Setup(cid)
        s.standard_board()
        s.d._to_gy(s.lumen)
        s.place(0, cid, 2)
        s.end(0)
        s.end(1)
        out.append(("standby", effect_seen(s), "" if effect_seen(s) else "Standby effect did not trigger"))
    if trig == "destroys_by_battle":
        s = Setup(cid)
        s.standard_board()
        s.d._to_gy(s.lumen)
        m = s.place(0, cid, 2)
        weak = s.place(1, "LD-026", 3)  # 700 ATK
        s.end(0)
        s.end(1)
        s.act(0, "battle")
        s.act(0, next(a for a in s.d.legal_actions(0) if a["kind"] == "attack" and a["card"] == m and a["target"] == weak))
        s.settle()
        if s.d.c(weak)["zone"] == "gy":
            out.append(("destroys_by_battle", effect_seen(s), "" if effect_seen(s) else "kill effect did not trigger"))
    if c.get("hand_trigger"):
        ht = c["hand_trigger"]["trigger"]
        s = Setup(cid)
        s.standard_board()
        m = s.to_hand(0, cid)
        s.end(0)
        if ht == "opp_attack":
            s.act(1, "battle")
            s.act(1, next(a for a in s.d.legal_actions(1) if a["kind"] == "attack" and a["card"] == s.foe))
        elif ht == "opp_summon":
            s.act(1, s.find(1, "normal_summon", s.to_hand(1, "LD-034"))[0])
        elif ht == "opp_spell":
            s.act(1, s.find(1, "activate_spell", s.to_hand(1, "LD-121"))[0])
        acts = s.find(0, "hand_summon", m)
        out.append(("ambush", bool(acts), "" if acts else f"no ambush offered on {ht}"))
        if acts:
            s.act(0, acts[0])
            s.settle()
            came = any(e["type"] == "MONSTER_SUMMONED" and e["iid"] == m and e["method"] == "ambush" for e in s.events)
            out.append(("ambush-field", came, "" if came else "ambush monster never reached the field"))
    if c.get("piercing") or c.get("double_attack") or c.get("direct_attack"):
        s = Setup(cid)
        s.standard_board()
        s.d._to_gy(s.lumen)
        m = s.place(0, cid, 2)
        s.d.c(m)["counters"]["boost_turn"] = 3  # setup: make sure it can beat the defender
        s.d.c(m)["counters"]["boost_atk"] = 3000
        pebble = s.place(1, "LD-026", 3, position="def")  # DEF 1200
        s.end(0)
        s.end(1)
        s.act(0, "battle")
        if c.get("direct_attack"):
            ok = any(a["kind"] == "attack" and a["card"] == m and a["target"] is None for a in s.d.legal_actions(0))
            out.append(("direct", ok, "" if ok else "no direct attack over monsters"))
        lp = s.d.pl(1)["lp"]
        a = next((a for a in s.d.legal_actions(0) if a["kind"] == "attack" and a["card"] == m and a["target"] == pebble), None)
        if a:
            s.act(0, a)
            s.settle()
            if c.get("piercing"):
                out.append(("piercing", s.d.pl(1)["lp"] < lp, "" if s.d.pl(1)["lp"] < lp else "no piercing damage"))
            if c.get("double_attack"):
                again = any(x["kind"] == "attack" and x["card"] == m for x in s.d.legal_actions(0))
                out.append(("double", again, "" if again else "no second attack"))
    if c.get("battle_indestructible"):
        s = Setup(cid)
        s.standard_board()
        s.d._to_gy(s.lumen)
        m = s.place(0, cid, 2, position="def")
        titan = s.place(1, "LD-598", 3)
        s.end(0)
        s.act(1, "battle")
        s.act(1, next(a for a in s.d.legal_actions(1) if a["kind"] == "attack" and a["card"] == titan and a["target"] == m))
        s.settle()
        out.append(("wall", s.d.c(m)["zone"] == "monster", "" if s.d.c(m)["zone"] == "monster" else "destroyed by battle"))
    if c.get("atk_per_gy"):
        s = Setup(cid)
        s.standard_board()
        m = s.place(0, cid, 0)
        before = s.d.stats(m)[0]
        s.d._to_gy(s.lumen)
        out.append(("gy_atk", s.d.stats(m)[0] > before, "" if s.d.stats(m)[0] > before else "ATK did not grow"))
    return out


def main():
    fails = []
    counts = {"spell": 0, "trap": 0, "monster": 0}
    for cid, c in sorted(DB.items()):
        if c.get("subtype") == "token":
            continue
        try:
            res = audit_spell(cid) if c["type"] == "spell" else audit_trap(cid) if c["type"] == "trap" else audit_monster(cid)
        except Exception:
            res = [("crash", False, traceback.format_exc().strip().splitlines()[-1])]
        counts[c["type"]] += 1
        bad = [r for r in res if not r[1]]
        if bad:
            fails.append((cid, c["name"], bad))
        if res:
            print(f"{'FAIL' if bad else 'ok  '} {cid} {c['name']}: " + ", ".join(f"{k}{'' if ok else ' ✗ ' + why}" for k, ok, why in res))
    print(f"\naudited {counts['spell']} spells, {counts['trap']} traps, {counts['monster']} monsters; {len(fails)} with problems")
    for cid, name, bad in fails:
        print(" -", cid, name, bad)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
