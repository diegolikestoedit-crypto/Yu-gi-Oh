"""Computer opponent for solo duels, and the move adviser behind the in-duel guide.

The AI only ever picks from Duel.legal_actions(), so it plays by exactly the same rules as a person. It reads
the public state plus its own cards; the opponent's hand, deck order and face-down cards stay unknown to it.
Each legal action gets a heuristic score and a short reason; the best one wins. Difficulty adds noise and a few
blind spots. The same scoring, without noise, powers the guide's "suggested play" for a human player.
"""
from __future__ import annotations

import random

DIFFICULTIES = {
    # noise: random spread added to every score; careless: chance to skip a good trap or attack
    "easy": {"noise": 45, "careless": 0.35},
    "normal": {"noise": 12, "careless": 0.1},
    "hard": {"noise": 0, "careless": 0.0},
}
UNKNOWN_DEF = 1500  # what the AI assumes a face-down monster can take


class DuelAI:
    def __init__(self, seat: int, difficulty: str = "normal", seed=None):
        self.p = seat
        self.level = DIFFICULTIES.get(difficulty, DIFFICULTIES["normal"])
        self.rng = random.Random(seed)

    # ---------------------------------------------------------------- helpers

    def _setup(self, duel):
        self.d = duel
        self.q = 1 - self.p
        self.me = duel.pl(self.p)
        self.them = duel.pl(self.q)

    def atk(self, iid):
        return self.d.stats(iid)[0]

    def dfn(self, iid):
        return self.d.stats(iid)[1]

    def name(self, iid):
        return self.d.data(iid)["name"]

    def threat(self, iid):
        """How dangerous an opposing monster looks, from what the AI can see."""
        if not self.d.c(iid)["face_up"]:
            return UNKNOWN_DEF
        return self.atk(iid)

    def opp_best_atk(self):
        vals = [self.atk(i) for i in self.d._monsters(self.q) if self.d.c(i)["face_up"]]
        unknown = any(not self.d.c(i)["face_up"] for i in self.d._monsters(self.q))
        return max(vals + ([UNKNOWN_DEF] if unknown else []), default=0)

    def my_best_atk(self):
        return max((self.atk(i) for i in self.d._monsters(self.p) if self.d.c(i)["face_up"]), default=0)

    def field_power(self, p):
        return sum(self.atk(i) if self.d.c(i)["face_up"] or p == self.p else UNKNOWN_DEF
                   for i in self.d._monsters(p))

    def hand_monsters(self):
        return [i for i in self.me["hand"] if self.d.data(i)["type"] == "monster"]

    def opp_set_count(self):
        return len(self.d._set_cards(self.q))

    def ops(self, iid):
        return [o["op"] for o in self.d.data(iid).get("effect", {}).get("ops", [])]

    # ----------------------------------------------------------------- choose

    def choose(self, duel):
        best = self.ranked(duel, noise=True)
        return best[0][2]["id"] if best else None

    def advise(self, duel):
        """The best play with a reason a person can read, or None when there is nothing to decide."""
        ranked = self.ranked(duel, noise=False)
        if not ranked:
            return None
        score, why, a = ranked[0]
        return {"id": a["id"], "kind": a["kind"], "card": a.get("card"), "target": a.get("target"),
                "label": a["label"], "why": why}

    def ranked(self, duel, noise):
        acts = duel.legal_actions(self.p)
        if not acts:
            return []
        self._setup(duel)
        out = []
        for a in acts:
            s, why = self.score(a)
            # Noise varies the order of useful moves; it never promotes a pointless one.
            if noise and s > 0:
                s = max(0.5, s + self.rng.uniform(-1, 1) * self.level["noise"])
            out.append((s, why, a))
        out.sort(key=lambda x: -x[0])
        return out

    def score(self, a):
        fn = getattr(self, "s_" + a["kind"], None)
        if not fn:
            return -1, ""
        r = fn(a)
        return r if isinstance(r, tuple) else (r, "")

    # --------------------------------------------------------------- responses

    def s_pass(self, a):
        return 0, "Nothing here is worth spending a card on. Save your Set cards for a bigger threat."

    def careless(self):
        return self.rng.random() < self.level["careless"]

    def attack_hurts(self):
        b = self.d.state["battle"]
        if not b:
            return False, 0
        attacker = self.atk(b["attacker"])
        t = b["target"]
        if t is None:
            return attacker >= 800 or attacker >= self.me["lp"], attacker
        mine = self.atk(t) if self.d.c(t)["position"] == "atk" else self.dfn(t)
        return attacker >= mine, attacker

    def s_activate_trap(self, a):
        if self.careless():
            return -5, ""
        st = self.d.state
        pend = st["pending"]
        ops = self.ops(a["card"])
        nm = self.name(a["card"])
        if "ascend" in ops:
            t, r = max(self.d._ascend_options(self.p), key=lambda o: self.d.data(o[1])["atk"])
            return 80, f"Spring {nm}: {self.name(t)} ascends into {self.name(r)} ({self.d.data(r)['atk']} ATK) right now."
        if "revive_best" in ops:
            hurt, _ = self.attack_hurts()
            best = max((self.atk(g) for g in self.me["gy"] if self.d.data(g)["type"] == "monster"), default=0)
            if hurt or not self.d._monsters(self.p):
                return 40 + best / 100, f"Use {nm}: stop this attack and bring back your {best}-ATK monster."
            return -5, ""
        if pend["trigger"] == "opp_summon":
            v = self.atk(pend["summoned"])
            return 20 + v / 50, f"Use {nm}: their {self.name(pend['summoned'])} ({v} ATK) is a real threat."
        if pend["trigger"] == "opp_spell":
            return self.counter_value(pend["spell"], nm)
        hurt, attacker = self.attack_hurts()
        if not hurt:
            return -5, ""
        if "destroy_opponent_attack_position" in ops:
            n = sum(1 for i in self.d._monsters(self.q)
                    if self.d.c(i)["face_up"] and self.d.c(i)["position"] == "atk")
            return 30 + 15 * n, f"Use {nm}: it wipes out all {n} of their Attack Position monsters."
        if "all_opp_to_defense" in ops:
            n = sum(1 for i in self.d._monsters(self.q)
                    if self.d.c(i)["face_up"] and self.d.c(i)["position"] == "atk")
            return 24 + 8 * n, f"Use {nm}: it stops this attack and locks their monsters in Defense."
        if "damage_attacker_controller" in ops:
            return 30 + attacker / 100, f"Use {nm}: it stops the attack and reflects {attacker} damage back."
        return 25 + attacker / 150, f"Use {nm}: this attack would cost you dearly."

    def counter_value(self, spell, nm):
        """How much a spell is worth stopping, for Counter Traps and responses."""
        ops = self.ops(spell)
        sname = self.name(spell)
        lp_ok = self.me["lp"] > 2000
        if "destroy_all_monsters" in ops and self.field_power(self.p) > self.field_power(self.q):
            return 70, f"Negate {sname} with {nm}: it would wipe out your stronger field."
        if "fusion_summon" in ops or "special_summon_target" in ops:
            return 50 if lp_ok else 20, f"Negate {sname} with {nm}: it would bring out a big monster."
        if "destroy_target" in ops or "destroy_target_st" in ops:
            return 40 if lp_ok else 10, f"Negate {sname} with {nm}: it is about to destroy one of your cards."
        if "field" in ops or "equip" in ops or "lock_attacks" in ops:
            return 18 if lp_ok else -5, f"Negate {sname} with {nm}."
        return -5, ""

    def s_activate_quick(self, a):
        pend = self.d.state["pending"]
        ops = self.ops(a["card"])
        nm = self.name(a["card"])
        if "destroy_target_st" in ops:
            t = a["target"]
            if pend and pend["trigger"] == "opp_spell" and t == pend["spell"]:
                v, _ = self.counter_value(t, nm)
                return v + 5, f"Chain {nm} to destroy {self.name(t)} before it resolves."
            if not self.d.c(t)["face_up"] and pend and pend["trigger"] == "opp_attack":
                return 8, ""
            return -5, ""
        if "boost" in ops and pend and pend["trigger"] == "opp_attack":
            b = self.d.state["battle"]
            if b and b["target"] == a["target"]:
                need = self.atk(b["attacker"]) - (self.atk(a["target"]) if self.d.c(a["target"])["position"] == "atk"
                                                  else self.dfn(a["target"]))
                if 0 <= need < 1000:
                    return 55, f"Use {nm} on {self.name(a['target'])}: +1000 ATK turns this attack around."
            return -5, ""
        return -5, ""

    def s_choose(self, a):
        iid = a["card"]
        fusable = self.completes_fusion(iid)
        if fusable:
            return 60, f"Special Summon {self.name(iid)}: together with your Herald it can Combine into {fusable}."
        return 30 + self.atk(iid) / 100, f"Special Summon {self.name(iid)} ({self.atk(iid)} ATK) for free."

    def s_skip(self, a):
        return 0, "Keep the cards in your hand for later."

    def completes_fusion(self, iid):
        """The name of a Fusion that iid plus what is already on the field could Combine into, if any."""
        pool = [i for i in self.d._monsters(self.p) if self.d.c(i)["face_up"]] + [iid]
        for fx in self.me["extra"]:
            if self.d.data(fx)["subtype"] == "fusion" and any(iid in c for c in self.d._material_combos(fx, pool)):
                return self.name(fx)
        return None

    def can_ascend_later(self):
        hand = any("ascend" in self.ops(i) for i in self.me["hand"])
        setc = any("ascend" in self.ops(i) for i in self.d._set_cards(self.p))
        return hand or setc

    def s_contact_fusion(self, a):
        fx = a["fusion"]
        best_mat = max(self.atk(m) for m in a["materials"])
        bonus = 22 if self.can_ascend_later() else 0
        why = f"Combine them into {self.name(fx)} ({self.d.data(fx)['atk']} ATK, Level {self.d.data(fx)['level']})."
        if bonus:
            why += " Then you can Ascend it with your Crown of Ascension / Ascension Rite."
        return 42 + (self.d.data(fx)["atk"] - best_mat) / 40 + bonus, why

    def s_discard(self, a):
        d = self.d.data(a["card"])
        if d["type"] == "monster":
            return -self.atk(a["card"]) / 100, f"Discard {d['name']}: it is your weakest card right now."
        return -20, f"Discard {d['name']}."

    # --------------------------------------------------------------- main phase

    def s_normal_summon(self, a):
        iid = a["card"]
        atk = self.atk(iid)
        bonus = self.summon_effect_bonus(iid)
        if not self.d._monsters(self.q):
            extra = " Its effect triggers on summon." if bonus else ""
            return 40 + atk / 100 + bonus, f"Summon {self.name(iid)} ({atk} ATK): your opponent has no monsters to stop it.{extra}"
        if atk >= self.opp_best_atk():
            return 40 + atk / 100 + bonus, f"Summon {self.name(iid)} in Attack Position: at {atk} ATK it beats everything they show."
        if bonus:
            return 30 + bonus, f"Summon {self.name(iid)}: its effect is worth it even if it can't win a fight."
        return 8 + atk / 300, ""

    def summon_effect_bonus(self, iid):
        eff = self.d.data(iid).get("effect")
        if eff and eff.get("trigger") == "normal_summon":
            # A Herald is worth most when the monster it calls can finish a Fusion.
            pool = [i for i in self.d._monsters(self.p) if self.d.c(i)["face_up"]] + [iid]
            for h in self.me["hand"]:
                if h != iid and self.d._matches(h, {"max_level": 4}):
                    for fx in self.me["extra"]:
                        if self.d.data(fx)["subtype"] == "fusion" and self.d._material_combos(fx, pool + [h]):
                            return 30
            return 16
        if not eff or eff.get("trigger") != "summon":
            return 0
        ops = [o["op"] for o in eff["ops"]]
        if "destroy_opp_st" in ops:
            return 18 if self.opp_set_count() else 0
        if "search_deck" in ops or "draw" in ops:
            return 14
        if "damage_opponent" in ops or "gain_lp" in ops:
            return 8
        return 5

    def s_set_monster(self, a):
        iid = a["card"]
        atk, dfn = self.atk(iid), self.dfn(iid)
        eff = self.d.data(iid).get("effect")
        flip = eff and eff.get("trigger") == "flip"
        if flip:
            return 38 + dfn / 200, f"Set {self.name(iid)} face-down: its FLIP effect triggers when they attack it."
        if atk >= self.opp_best_atk() and self.d._monsters(self.q):
            return 10, ""
        return 30 + dfn / 100, f"Set {self.name(iid)} in Defense Position ({dfn} DEF): it can't win a fight yet, so protect your LP."

    def s_tribute_summon(self, a):
        iid = a["card"]
        gain = self.atk(iid) - sum(self.atk(t) for t in a["tributes"])
        if gain < 400:
            return -20, ""
        names = " and ".join(self.name(t) for t in a["tributes"])
        return 45 + gain / 60 + self.atk(iid) / 200, f"Tribute {names} to summon {self.name(iid)} ({self.atk(iid)} ATK): a big upgrade."

    def s_flip_summon(self, a):
        iid = a["card"]
        atk = self.atk(iid)
        eff = self.d.data(iid).get("effect")
        if eff and eff.get("trigger") == "flip":
            return 34, f"Flip Summon {self.name(iid)} to trigger its FLIP effect now."
        return (32 + atk / 200, f"Flip Summon {self.name(iid)}: at {atk} ATK it can go on the attack.") \
            if atk >= self.opp_best_atk() else (-5, "")

    def s_change_position(self, a):
        iid = a["card"]
        atk, dfn = self.atk(iid), self.dfn(iid)
        best = self.opp_best_atk()
        if a["position"] == "atk":
            return (22, f"Switch {self.name(iid)} to Attack Position: it now out-muscles their field.") if atk > best else (-10, "")
        return (15, f"Switch {self.name(iid)} to Defense Position: {dfn} DEF holds where {atk} ATK would lose.") \
            if atk < best and dfn > atk else (-10, "")

    def s_set_spell_trap(self, a):
        d = self.d.data(a["card"])
        if d["type"] == "trap":
            return 26, f"Set {d['name']}: traps must be Set a turn before they can be used."
        if d["subtype"] == "quickplay":
            return 14, f"Set {d['name']}: a Set Quick-Play can be used on your opponent's turn."
        return -30, ""

    def s_activate_spell(self, a):
        iid = a["card"]
        d = self.d.data(iid)
        nm = d["name"]
        ops = self.ops(iid)
        if "ascend" in ops:
            r = a["result"]
            return 82, f"Activate {nm}: {self.name(a['target'])} ascends into {self.name(r)} ({self.d.data(r)['atk']} ATK)."
        if "summon_best_from_deck" in ops:
            v = self.d.db[a["search"]]["atk"]
            return 55 + v / 100, f"Activate {nm}: call {self.d.db[a['search']]['name']} ({v} ATK) straight from your Deck."
        if "draw" in ops:
            return 62, f"Activate {nm}: free cards are always good."
        if "destroy_all_monsters" in ops:
            mine, theirs = self.field_power(self.p), self.field_power(self.q)
            return (70 + (theirs - mine) / 100, f"Activate {nm}: their field is stronger than yours, so wipe the board.") \
                if theirs > mine + 600 else (-40, "")
        if "destroy_target" in ops:
            t = a["target"]
            th = self.threat(t)
            if th < 1000 and self.my_best_atk() > th:
                return 12, ""
            return 50 + th / 80, f"Activate {nm} on {self.d._target_name(t)}: it is their biggest threat."
        if "destroy_target_st" in ops:
            t = a["target"]
            if self.d.state["phase"] == "battle" and self.d.c(t)["face_up"]:
                return 4, ""
            v = 44 if not self.d.c(t)["face_up"] else 30
            if self.d.c(t)["face_up"] and "lock_attacks" in self.ops(t):
                v = 58
            return v, f"Activate {nm} on {self.d._st_name(t)}: clear the way before you attack."
        if "special_summon_target" in ops:
            v = self.atk(a["target"])
            return (25 + v / 60, f"Activate {nm}: bring back {self.name(a['target'])} ({v} ATK).") if v >= 1200 else (-10, "")
        if "search_deck" in ops:
            v = self.d.db[a["search"]]["atk"]
            return 40 + v / 200, f"Activate {nm} and add {self.d.db[a['search']]['name']}: it is the strongest search you have."
        if "equip" in ops:
            t = a["target"]
            bonus = next(o.get("atk", 0) for o in self.d.data(iid)["effect"]["ops"] if o["op"] == "equip")
            new = self.atk(t) + bonus
            if new > self.opp_best_atk() >= self.atk(t) or not self.d._monsters(self.q):
                return 45 + new / 200, f"Equip {nm} to {self.name(t)}: at {new} ATK it beats their best monster."
            return 20 + new / 300, f"Equip {nm} to {self.name(t)}."
        if "boost" in ops:
            if self.d.state["phase"] != "battle":
                return -10, ""
            t = a["target"]
            c = self.d.c(t)
            if c["attacked"] or c["position"] != "atk":
                return -10, ""
            new = self.atk(t) + 1000
            for o in self.d._monsters(self.q):
                if self.d.c(o)["face_up"] and self.d.c(o)["position"] == "atk" and self.atk(t) <= self.atk(o) < new:
                    return 50, f"Use {nm} on {self.name(t)}: at {new} ATK it can destroy {self.name(o)}."
            if not self.d._monsters(self.q):
                return 30, f"Use {nm} on {self.name(t)} for {new} direct damage."
            return -10, ""
        if "lock_attacks" in ops:
            return (55, f"Activate {nm}: their monsters out-gun yours, so stop them attacking for 3 turns.") \
                if self.opp_best_atk() > self.my_best_atk() else (6, "")
        if "field" in ops:
            mods = d["effect"]["ops"][0].get("modifiers", [])
            attr = mods[0].get("attribute") if mods else None
            if self.me["field"] is not None:
                own_attr = self.d.data(self.me["field"])["effect"]["ops"][0].get("modifiers", [{}])[0].get("attribute")
                if own_attr == attr:
                    return -30, ""
            pool = self.d._monsters(self.p) + self.hand_monsters()
            ours = sum(1 for i in pool if self.d.data(i).get("attribute") == attr)
            theirs = sum(1 for i in self.d._monsters(self.q)
                         if self.d.c(i)["face_up"] and self.d.data(i).get("attribute") == attr)
            return (18 + 14 * ours - 12 * theirs, f"Activate {nm}: it powers up {ours} of your {attr} monsters.") \
                if ours else (-15, "")
        if "fusion_summon" in ops:
            fx = a["fusion"]
            gain = self.atk(fx) - sum(self.atk(m) for m in a["materials"] if self.d.c(m)["zone"] == "monster")
            return 50 + gain / 80, f"Activate {nm}: Fusion Summon {self.name(fx)} ({self.d.data(fx)['atk']} ATK, Level {self.d.data(fx)['level']})."
        return 5, ""

    def s_enter_battle(self, a):
        s = self.best_attack_score()
        return (10, "Go to the Battle Phase: you have a winning attack.") if s > 0 else (-5, "")

    # ------------------------------------------------------------------ battle

    def best_attack_score(self):
        best = -1
        for iid in self.d._monsters(self.p):
            c = self.d.c(iid)
            if not c["face_up"] or c["position"] != "atk" or c["attacked"]:
                continue
            targets = self.d._monsters(self.q) or [None]
            for t in targets:
                best = max(best, self.attack_value(iid, t)[0])
        return best

    def attack_value(self, iid, t):
        a = self.atk(iid)
        nm = self.name(iid)
        if t is None:
            return 100 + a / 50, f"Attack directly with {nm} for {a} damage."
        tc = self.d.c(t)
        if not tc["face_up"]:
            return (30 + a / 200, f"Attack the face-down monster with {nm}: {a} ATK should get through.") \
                if a >= 1800 else (-20, "")
        tn = self.name(t)
        if tc["position"] == "atk":
            ta = self.atk(t)
            if a > ta:
                return 60 + (a - ta) / 100 + ta / 200, f"Attack {tn} with {nm}: {a} beats {ta}, dealing {a - ta} damage."
            if a == ta:
                return (6, f"Trade {nm} with {tn}: equal ATK, both are destroyed.") if ta >= 2000 else (-30, "")
            return -100, ""
        td = self.dfn(t)
        if a > td:
            pierce = " with piercing damage" if self.d.data(iid).get("piercing") else ""
            return 40 + td / 200 + (a - td) / 100 * bool(pierce), f"Attack {tn} with {nm}: {a} ATK breaks its {td} DEF{pierce}."
        return -100, ""

    def s_attack(self, a):
        v, why = self.attack_value(a["card"], a["target"])
        if v > 0 and self.rng.random() < self.level["careless"] / 2:
            return -2, ""
        return v, why

    def s_enter_main2(self, a):
        return 1, "Move to Main Phase 2: no attack left is worth it, and you can still Set cards."

    def s_end_turn(self, a):
        # Leave Battle through Main Phase 2 so the AI can still set cards afterwards.
        if self.d.state["phase"] == "battle":
            return -1, ""
        return 0, "End your turn: nothing else improves your position."
