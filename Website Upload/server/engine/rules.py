"""Authoritative duel rules engine.

The engine owns the duel state. Every state change emits an event carrying a
snapshot of the state *after* the change; clients animate the event and then
display that snapshot, so visuals can never disagree with the rules.

Players only ever act by choosing one of the action ids returned by
legal_actions(); act() recomputes the list and rejects anything not in it.
"""
from __future__ import annotations

import copy
import itertools
import random

PROFILES = {
    "frontier": {
        "id": "frontier",
        "name": "Frontier Rules",
        "lp": 3000,
        "tributes": False,
        "first_player_draws": True,
        "hand_limit": 6,
        "summary": "Early-era rules: 3000 LP, any monster can be Normal Summoned without tributes.",
    },
    "citadel": {
        "id": "citadel",
        "name": "Citadel Rules",
        "lp": 4000,
        "tributes": True,
        "first_player_draws": False,
        "hand_limit": 6,
        "summary": "Tournament-era rules: 4000 LP, Level 5-6 need 1 tribute, Level 7+ need 2. First player skips their first draw.",
    },
}

ZONES = 5
SLOT_ORDER = [2, 1, 3, 0, 4]  # fill from the centre outwards
STARTING_HAND = 5


class RuleError(Exception):
    pass


def tributes_needed(profile: dict, level: int) -> int:
    if not profile["tributes"]:
        return 0
    if level <= 4:
        return 0
    return 1 if level <= 6 else 2


class Duel:
    def __init__(self, db, decks, names, profile="citadel", seed=None, first=None, showcase=None):
        if profile not in PROFILES:
            raise RuleError(f"Unknown rules profile {profile}")
        self.db = db
        self.profile = PROFILES[profile]
        self.rng = random.Random(seed)
        self.events = []
        self.state = {
            "profile": profile,
            "turn": 0,
            "active": None,
            "phase": None,
            "winner": None,
            "win_reason": None,
            "pending": None,
            "battle": None,
            "cards": {},
            "players": [],
        }
        used = set()
        for p in (0, 1):
            deck = decks[p]
            pl = {
                "name": names[p], "lp": self.profile["lp"],
                "deck": [], "hand": [], "gy": [], "extra": [],
                "monsters": [None] * ZONES, "st": [None] * ZONES, "field": None,
                "normal_summoned": False,
            }
            self.state["players"].append(pl)
            main = list(deck["main"])
            self.rng.shuffle(main)
            if showcase and showcase.get(p) in main:
                main.remove(showcase[p])
                main.insert(0, showcase[p])
            for cid in main:
                pl["deck"].append(self._new_card(cid, p, "deck", used))
            for cid in deck.get("extra", []):
                pl["extra"].append(self._new_card(cid, p, "extra", used))
        self.first = first if first is not None else self.rng.randrange(2)

    # ------------------------------------------------------------------ setup

    def _new_card(self, cid, owner, zone, used):
        if cid not in self.db:
            raise RuleError(f"Unknown card {cid}")
        while True:
            iid = "c%08x" % self.rng.getrandbits(32)
            if iid not in used:
                used.add(iid)
                break
        self.state["cards"][iid] = {
            "iid": iid, "cid": cid, "owner": owner, "zone": zone, "slot": None,
            "face_up": False, "position": None, "turn_placed": None,
            "attacked": False, "pos_changed": False, "counters": {},
        }
        return iid

    def start(self):
        self._emit("DUEL_STARTED", first=self.first, profile=self.profile["id"])
        for p in (0, 1):
            self._draw(p, STARTING_HAND, reason="opening")
        self._begin_turn(self.first)
        return self.take_events()

    # ---------------------------------------------------------------- helpers

    def _emit(self, etype, secret_owner=None, secret_keys=(), **data):
        ev = {"type": etype, **data}
        if secret_owner is not None:
            ev["_secret"] = {"owner": secret_owner, "keys": list(secret_keys)}
        ev["_state"] = copy.deepcopy(self.state)
        self.events.append(ev)

    def take_events(self):
        out, self.events = self.events, []
        return out

    def c(self, iid):
        return self.state["cards"][iid]

    def data(self, iid):
        return self.db[self.c(iid)["cid"]]

    def pl(self, p):
        return self.state["players"][p]

    @staticmethod
    def opp(p):
        return 1 - p

    def stats(self, iid, state=None):
        """Effective ATK/DEF including continuous field modifiers."""
        state = state or self.state
        card = state["cards"][iid]
        d = self.db[card["cid"]]
        atk, dfn = d.get("atk", 0), d.get("def", 0)
        for pl in state["players"]:
            f = pl["field"]
            if f is None:
                continue
            for op in self.db[state["cards"][f]["cid"]]["effect"]["ops"]:
                for m in op.get("modifiers", []):
                    if m.get("attribute") and m["attribute"] != d.get("attribute"):
                        continue
                    if m.get("race") and m["race"] != d.get("race"):
                        continue
                    atk += m.get("atk", 0)
                    dfn += m.get("def", 0)
        return max(0, atk), max(0, dfn)

    def _free_slot(self, row):
        for i in SLOT_ORDER:
            if row[i] is None:
                return i
        return None

    def _remove(self, iid):
        card = self.c(iid)
        z = card["zone"]
        # Cards on the field sit in their controller's zones; everything else is in the owner's.
        pl = self.pl(card.get("controller", card["owner"]) if z == "monster" else card["owner"])
        if z in ("deck", "hand", "gy", "extra"):
            pl[z].remove(iid)
        elif z == "monster":
            pl["monsters"][card["slot"]] = None
        elif z == "st":
            pl["st"][card["slot"]] = None
        elif z == "field":
            pl["field"] = None
        card.pop("controller", None)
        card.update(zone=None, slot=None, attacked=False, pos_changed=False, counters={})

    def _to_gy(self, iid):
        self._remove(iid)
        card = self.c(iid)
        card.update(zone="gy", face_up=True, position=None)
        self.pl(card["owner"])["gy"].append(iid)

    def _place_monster(self, iid, p, slot, position, face_up):
        card = self.c(iid)
        card.update(zone="monster", slot=slot, position=position, face_up=face_up,
                    turn_placed=self.state["turn"], attacked=False, pos_changed=False)
        self.pl(p)["monsters"][slot] = iid

    def _place_st(self, iid, p, slot, face_up):
        card = self.c(iid)
        card.update(zone="st", slot=slot, face_up=face_up, turn_placed=self.state["turn"])
        self.pl(p)["st"][slot] = iid

    def _monsters(self, p):
        return [i for i in self.pl(p)["monsters"] if i is not None]

    def _all_monsters(self):
        return self._monsters(0) + self._monsters(1)

    def _set_cards(self, p):
        return [i for i in self.pl(p)["st"] if i is not None and not self.c(i)["face_up"]]

    def _attack_locked(self, p):
        for i in self.pl(self.opp(p))["st"]:
            if i is None or not self.c(i)["face_up"]:
                continue
            if any(op["op"] == "lock_attacks" for op in self.data(i)["effect"]["ops"]):
                return True
        return False

    # ------------------------------------------------------------ turn flow

    def _set_phase(self, phase):
        self.state["phase"] = phase
        self._emit("PHASE_CHANGED", player=self.state["active"], phase=phase)

    def _begin_turn(self, p):
        st = self.state
        st["turn"] += 1
        st["active"] = p
        self.pl(p)["normal_summoned"] = False
        for iid in self._monsters(p):
            self.c(iid).update(attacked=False, pos_changed=False)
        self._emit("TURN_STARTED", player=p, turn=st["turn"])
        self._set_phase("draw")
        if not (st["turn"] == 1 and not self.profile["first_player_draws"]):
            self._draw(p, 1)
            if st["winner"] is not None:
                return
        self._set_phase("standby")
        self._set_phase("main1")

    def _draw(self, p, n, reason="draw"):
        pl = self.pl(p)
        drawn = []
        for _ in range(n):
            if not pl["deck"]:
                if drawn:
                    self._emit("CARD_DRAWN", secret_owner=p, secret_keys=("iids", "cids"), player=p,
                               iids=drawn, cids=[self.c(i)["cid"] for i in drawn], count=len(drawn), reason=reason)
                self._win(self.opp(p), "deck_out")
                return
            iid = pl["deck"].pop(0)
            self.c(iid).update(zone="hand")
            pl["hand"].append(iid)
            drawn.append(iid)
        self._emit("CARD_DRAWN", secret_owner=p, secret_keys=("iids", "cids"), player=p,
                   iids=drawn, cids=[self.c(i)["cid"] for i in drawn], count=len(drawn), reason=reason)

    def _win(self, p, reason):
        if self.state["winner"] is not None:
            return
        self.state["winner"] = p
        self.state["win_reason"] = reason
        self.state["pending"] = None
        self._emit("DUEL_WON", player=p, reason=reason)

    def concede(self, p, reason="concede"):
        self._win(self.opp(p), reason)
        return self.take_events()

    def _change_lp(self, p, delta, reason):
        pl = self.pl(p)
        pl["lp"] = max(0, pl["lp"] + delta)
        self._emit("LIFE_POINTS_CHANGED", player=p, delta=delta, lp=pl["lp"], reason=reason)
        if pl["lp"] <= 0:
            self._win(self.opp(p), "lp")

    def _end_turn(self):
        p = self.state["active"]
        self.state["battle"] = None
        self._set_phase("end")
        self._continue_end_phase()

    def _continue_end_phase(self):
        p = self.state["active"]
        if len(self.pl(p)["hand"]) > self.profile["hand_limit"]:
            self.state["pending"] = {"kind": "discard", "player": p}
            return
        self.state["pending"] = None
        # Lingering effects owned by the opponent count down at the end of this player's turn.
        q = self.opp(p)
        for iid in list(self.pl(q)["st"]):
            if iid is None or not self.c(iid)["face_up"]:
                continue
            card = self.c(iid)
            if "turns_left" in card["counters"]:
                card["counters"]["turns_left"] -= 1
                if card["counters"]["turns_left"] <= 0:
                    slot = card["slot"]
                    self._to_gy(iid)
                    self._emit("EFFECT_EXPIRED", iid=iid, cid=card["cid"], player=q, slot=slot)
                else:
                    self._emit("COUNTER_CHANGED", iid=iid, cid=card["cid"], player=q,
                               turns_left=card["counters"]["turns_left"])
        self._begin_turn(q)

    # ---------------------------------------------------------- legal actions

    def decider(self):
        st = self.state
        if st["winner"] is not None:
            return None
        if st["pending"]:
            return st["pending"]["player"]
        return st["active"]

    def legal_actions(self, p):
        st = self.state
        if st["winner"] is not None or self.decider() != p:
            return []
        pend = st["pending"]
        if pend:
            if pend["kind"] == "response":
                acts = [self._a("trap:" + i, "activate_trap", i, f"Activate {self.data(i)['name']}")
                        for i in self._eligible_traps(p, pend)]
                acts.append(self._a("pass", "pass", None, "Don't respond"))
                return acts
            if pend["kind"] == "discard":
                return [self._a("discard:" + i, "discard", i, f"Discard {self.data(i)['name']}")
                        for i in self.pl(p)["hand"]]
            return []

        phase = st["phase"]
        acts = []
        pl = self.pl(p)
        if phase in ("main1", "main2"):
            acts += self._summon_actions(p)
            acts += self._spell_actions(p)
            free_st = self._free_slot(pl["st"]) is not None
            for iid in pl["hand"]:
                d = self.data(iid)
                if d["type"] in ("spell", "trap") and d["subtype"] != "field" and free_st:
                    acts.append(self._a("setst:" + iid, "set_spell_trap", iid, f"Set {d['name']}"))
            for iid in self._monsters(p):
                card = self.c(iid)
                if card["pos_changed"] or card["turn_placed"] == st["turn"]:
                    continue
                if not card["face_up"]:
                    acts.append(self._a("flip:" + iid, "flip_summon", iid, f"Flip Summon {self.data(iid)['name']}"))
                else:
                    to = "def" if card["position"] == "atk" else "atk"
                    acts.append(self._a("pos:" + iid, "change_position", iid,
                                        f"Switch to {'Defense' if to == 'def' else 'Attack'} Position", position=to))
            if phase == "main1" and st["turn"] > 1:
                acts.append(self._a("battle", "enter_battle", None, "Enter Battle Phase"))
        elif phase == "battle":
            if not self._attack_locked(p):
                targets = self._monsters(self.opp(p))
                for iid in self._monsters(p):
                    card = self.c(iid)
                    if not card["face_up"] or card["position"] != "atk" or card["attacked"]:
                        continue
                    name = self.data(iid)["name"]
                    if targets:
                        for t in targets:
                            tc = self.c(t)
                            tname = self.data(t)["name"] if tc["face_up"] else "face-down monster"
                            acts.append(self._a(f"atk:{iid}:{t}", "attack", iid, f"{name} attacks {tname}", target=t))
                    else:
                        acts.append(self._a(f"atk:{iid}:direct", "attack", iid, f"{name} attacks directly", target=None))
            acts.append(self._a("main2", "enter_main2", None, "Go to Main Phase 2"))
        if phase in ("main1", "battle", "main2"):
            acts.append(self._a("end", "end_turn", None, "End Turn"))
        return acts

    @staticmethod
    def _a(aid, kind, card, label, **extra):
        return {"id": aid, "kind": kind, "card": card, "label": label, **extra}

    def _summon_actions(self, p):
        pl = self.pl(p)
        acts = []
        if pl["normal_summoned"]:
            return acts
        own = self._monsters(p)
        free = self._free_slot(pl["monsters"]) is not None
        for iid in pl["hand"]:
            d = self.data(iid)
            if d["type"] != "monster" or d.get("subtype") == "fusion":
                continue
            n = tributes_needed(self.profile, d["level"])
            if n == 0:
                if free:
                    acts.append(self._a("ns:" + iid, "normal_summon", iid, f"Summon {d['name']}"))
                    acts.append(self._a("set:" + iid, "set_monster", iid, f"Set {d['name']}"))
            elif len(own) >= n:
                for combo in itertools.combinations(own, n):
                    names = " + ".join(self._public_name(t) for t in combo)
                    acts.append(self._a("ts:%s:%s" % (iid, ",".join(combo)), "tribute_summon", iid,
                                        f"Tribute {names}", tributes=list(combo)))
        return acts

    def _public_name(self, iid):
        return self.data(iid)["name"]

    def _spell_actions(self, p):
        pl = self.pl(p)
        acts = []
        sources = [i for i in pl["hand"] if self.data(i)["type"] == "spell"]
        sources += [i for i in pl["st"] if i is not None and not self.c(i)["face_up"] and self.data(i)["type"] == "spell"]
        free_st = self._free_slot(pl["st"]) is not None
        for iid in sources:
            d = self.data(iid)
            from_hand = self.c(iid)["zone"] == "hand"
            if d["subtype"] != "field" and from_hand and not free_st:
                continue
            for variant in self._spell_variants(p, iid):
                acts.append(self._a(f"spell:{iid}" + variant["suffix"], "activate_spell", iid,
                                    variant["label"], **variant.get("extra", {})))
        return acts

    def _spell_variants(self, p, iid):
        """Every legal way to activate a spell, or [] if its conditions are not met."""
        d = self.data(iid)
        eff = d["effect"]
        ops = eff["ops"]
        name = d["name"]
        kinds = [o["op"] for o in ops]
        if "draw" in kinds:
            need = next(o["count"] for o in ops if o["op"] == "draw")
            return [{"suffix": "", "label": f"Activate {name}"}] if len(self.pl(p)["deck"]) >= need else []
        if "destroy_all_monsters" in kinds:
            return [{"suffix": "", "label": f"Activate {name}"}] if self._all_monsters() else []
        if "destroy_target" in kinds:
            return [{"suffix": ":" + t, "label": f"{name}: destroy {self._target_name(t)}", "extra": {"target": t}}
                    for t in self._monsters(self.opp(p))]
        if "special_summon_target" in kinds:
            if self._free_slot(self.pl(p)["monsters"]) is None:
                return []
            out = []
            for q in (p, self.opp(p)):
                for t in self.pl(q)["gy"]:
                    td = self.data(t)
                    if td["type"] == "monster":
                        whose = "your" if q == p else "opponent's"
                        out.append({"suffix": ":" + t, "label": f"{name}: revive {td['name']} ({whose} Graveyard)",
                                    "extra": {"target": t}})
            return out
        if "lock_attacks" in kinds or "field" in kinds:
            return [{"suffix": "", "label": f"Activate {name}"}]
        if "fusion_summon" in kinds:
            return self._fusion_variants(p, iid)
        return []

    def _target_name(self, t):
        return self.data(t)["name"] if self.c(t)["face_up"] else "a face-down monster"

    def _fusion_variants(self, p, spell_iid):
        pl = self.pl(p)
        pool = [i for i in pl["hand"] if i != spell_iid and self.data(i)["type"] == "monster"] + self._monsters(p)
        out = []
        for fx in pl["extra"]:
            fd = self.data(fx)
            mats = fd.get("materials", [])
            cands = [[i for i in pool if self.c(i)["cid"] == m] for m in mats]
            seen = set()
            for combo in itertools.product(*cands):
                if len(set(combo)) != len(combo):
                    continue
                key = tuple(sorted(combo))
                if key in seen:
                    continue
                seen.add(key)
                # The result needs a zone once on-field materials have left.
                frees = sum(1 for i in combo if self.c(i)["zone"] == "monster")
                if self._free_slot(pl["monsters"]) is None and frees == 0:
                    continue
                desc = " + ".join(
                    f"{self.data(i)['name']} ({'field' if self.c(i)['zone'] == 'monster' else 'hand'})" for i in combo)
                out.append({"suffix": f":{fx}:{','.join(combo)}", "label": f"Fuse {desc} into {fd['name']}",
                            "extra": {"fusion": fx, "materials": list(combo)}})
        return out

    def _eligible_traps(self, p, pend):
        out = []
        for iid in self._set_cards(p):
            card = self.c(iid)
            d = self.data(iid)
            if d["type"] != "trap" or card["turn_placed"] == self.state["turn"]:
                continue
            if d.get("trigger") != pend["trigger"]:
                continue
            if pend["trigger"] == "opp_summon":
                cond = d.get("condition", {})
                s = pend["summoned"]
                if self.c(s)["zone"] != "monster":
                    continue
                if pend["method"] not in cond.get("methods", [pend["method"]]):
                    continue
                if self.stats(s)[0] < cond.get("min_atk", 0):
                    continue
            if pend["trigger"] == "opp_attack" and self.state["battle"] is None:
                continue
            out.append(iid)
        return out

    # ------------------------------------------------------------------- act

    def act(self, p, action_id):
        legal = {a["id"]: a for a in self.legal_actions(p)}
        if action_id not in legal:
            raise RuleError("That action is not available right now.")
        a = legal[action_id]
        k = a["kind"]
        if k == "normal_summon":
            self._normal_summon(p, a["card"], face_up=True)
        elif k == "set_monster":
            self._normal_summon(p, a["card"], face_up=False)
        elif k == "tribute_summon":
            self._tribute_summon(p, a["card"], a["tributes"])
        elif k == "flip_summon":
            self._flip_summon(p, a["card"])
        elif k == "change_position":
            self._change_position(a["card"], a["position"])
        elif k == "set_spell_trap":
            self._set_spell_trap(p, a["card"])
        elif k == "activate_spell":
            self._activate_spell(p, a)
        elif k == "enter_battle":
            self._set_phase("battle")
        elif k == "enter_main2":
            self.state["battle"] = None
            self._set_phase("main2")
        elif k == "end_turn":
            self._end_turn()
        elif k == "attack":
            self._declare_attack(p, a["card"], a["target"])
        elif k == "activate_trap":
            self._activate_trap(p, a["card"])
        elif k == "pass":
            self._resolve_pending_pass()
        elif k == "discard":
            card = self.c(a["card"])
            self._to_gy(a["card"])
            self._emit("CARD_DISCARDED", iid=a["card"], cid=card["cid"], player=p)
            self._continue_end_phase()
        return self.take_events()

    # -------------------------------------------------------------- summoning

    def _normal_summon(self, p, iid, face_up):
        pl = self.pl(p)
        slot = self._free_slot(pl["monsters"])
        self._remove(iid)
        pl["normal_summoned"] = True
        if face_up:
            self._place_monster(iid, p, slot, "atk", True)
            self._emit("MONSTER_SUMMONED", iid=iid, cid=self.c(iid)["cid"], player=p, slot=slot,
                       method="normal", position="atk")
            self._open_summon_window(p, iid, "normal")
        else:
            self._place_monster(iid, p, slot, "def", False)
            self._emit("MONSTER_SET", secret_owner=p, secret_keys=("cid",), iid=iid,
                       cid=self.c(iid)["cid"], player=p, slot=slot)

    def _tribute_summon(self, p, iid, tributes):
        pl = self.pl(p)
        self._emit("TRIBUTE_SUMMON_STARTED", iid=iid, cid=self.c(iid)["cid"], player=p,
                   tributes=[{"iid": t, "cid": self.c(t)["cid"], "slot": self.c(t)["slot"]} for t in tributes])
        for t in tributes:
            card = self.c(t)
            slot = card["slot"]
            self._to_gy(t)
            self._emit("MONSTER_TRIBUTED", iid=t, cid=card["cid"], player=p, slot=slot)
        slot = self._free_slot(pl["monsters"])
        self._remove(iid)
        pl["normal_summoned"] = True
        self._place_monster(iid, p, slot, "atk", True)
        self._emit("MONSTER_SUMMONED", iid=iid, cid=self.c(iid)["cid"], player=p, slot=slot,
                   method="tribute", position="atk")
        self._open_summon_window(p, iid, "tribute")

    def _flip_summon(self, p, iid):
        card = self.c(iid)
        card.update(face_up=True, position="atk", pos_changed=True)
        self._emit("MONSTER_FLIPPED", iid=iid, cid=card["cid"], player=p, slot=card["slot"], reason="flip_summon")
        self._open_summon_window(p, iid, "flip")

    def _change_position(self, iid, position):
        card = self.c(iid)
        card.update(position=position, pos_changed=True)
        self._emit("POSITION_CHANGED", iid=iid, cid=card["cid"], player=card["owner"], slot=card["slot"],
                   position=position)

    def _special_summon(self, p, iid, method):
        pl = self.pl(p)
        slot = self._free_slot(pl["monsters"])
        from_zone = self.c(iid)["zone"]
        from_owner = self.c(iid)["owner"]
        self._remove(iid)
        # Control moves to the summoning player; ownership is tracked for the Graveyard.
        card = self.c(iid)
        card["controller"] = p
        self._place_monster(iid, p, slot, "atk", True)
        self._emit("MONSTER_SUMMONED", iid=iid, cid=card["cid"], player=p, slot=slot, method=method,
                   position="atk", from_zone=from_zone, from_player=from_owner)

    def _open_summon_window(self, p, iid, method):
        q = self.opp(p)
        if self._set_cards(q) and self.state["winner"] is None:
            self.state["pending"] = {"kind": "response", "player": q, "trigger": "opp_summon",
                                     "summoned": iid, "method": method}

    # --------------------------------------------------------- spells & traps

    def _set_spell_trap(self, p, iid):
        pl = self.pl(p)
        slot = self._free_slot(pl["st"])
        self._remove(iid)
        self._place_st(iid, p, slot, face_up=False)
        self._emit("CARD_SET", secret_owner=p, secret_keys=("cid",), iid=iid, cid=self.c(iid)["cid"],
                   player=p, slot=slot)

    def _activate_spell(self, p, a):
        iid = a["card"]
        d = self.data(iid)
        pl = self.pl(p)
        card = self.c(iid)
        from_zone = card["zone"]
        if d["subtype"] == "field":
            old = pl["field"]
            if old is not None:
                self._to_gy(old)
                self._emit("FIELD_SPELL_REMOVED", iid=old, cid=self.c(old)["cid"], player=p, reason="replaced")
            self._remove(iid)
            card.update(zone="field", face_up=True, turn_placed=self.state["turn"])
            pl["field"] = iid
            op = d["effect"]["ops"][0]
            self._emit("SPELL_ACTIVATED", iid=iid, cid=d["id"], player=p, from_zone=from_zone, zone="field")
            self._emit("FIELD_SPELL_ACTIVATED", iid=iid, cid=d["id"], player=p, env=op["env"])
            return
        if from_zone == "hand":
            slot = self._free_slot(pl["st"])
            self._remove(iid)
            self._place_st(iid, p, slot, face_up=True)
        else:
            card["face_up"] = True
        self._emit("SPELL_ACTIVATED", iid=iid, cid=d["id"], player=p, from_zone=from_zone,
                   slot=card["slot"], target=a.get("target"))
        for op in d["effect"]["ops"]:
            self._run_op(p, iid, op, a)
            if self.state["winner"] is not None:
                return
        if d["subtype"] == "normal" and self.c(iid)["zone"] == "st":
            slot = self.c(iid)["slot"]
            self._to_gy(iid)
            self._emit("SPELL_RESOLVED", iid=iid, cid=d["id"], player=p, slot=slot)

    def _activate_trap(self, p, iid):
        d = self.data(iid)
        card = self.c(iid)
        card["face_up"] = True
        pend = self.state["pending"]
        self.state["pending"] = None
        ctx = {"trigger": pend["trigger"]}
        if pend["trigger"] == "opp_attack":
            ctx["attacker"] = self.state["battle"]["attacker"]
        else:
            ctx["summoned"] = pend["summoned"]
        self._emit("TRAP_ACTIVATED", iid=iid, cid=d["id"], player=p, slot=card["slot"], **ctx)
        for op in d["effect"]["ops"]:
            self._run_op(p, iid, op, ctx)
            if self.state["winner"] is not None:
                return
        if self.c(iid)["zone"] == "st":
            slot = self.c(iid)["slot"]
            self._to_gy(iid)
            self._emit("TRAP_RESOLVED", iid=iid, cid=d["id"], player=p, slot=slot)
        if pend["trigger"] == "opp_attack":
            self._continue_attack()

    def _destroy(self, iid, reason, by=None):
        card = self.c(iid)
        controller = card.get("controller", card["owner"])
        slot = card["slot"]
        self._to_gy(iid)
        card.pop("controller", None)
        self._emit("MONSTER_DESTROYED", iid=iid, cid=card["cid"], player=controller, slot=slot,
                   reason=reason, by=by)

    def _run_op(self, p, src, op, ctx):
        kind = op["op"]
        q = self.opp(p)
        if kind == "draw":
            self._draw(p, op["count"], reason="effect")
        elif kind == "destroy_all_monsters":
            for iid in self._monsters(p) + self._monsters(q):
                self._destroy(iid, "effect", by=src)
        elif kind == "destroy_target":
            t = ctx["target"]
            if self.c(t)["zone"] == "monster":
                if not self.c(t)["face_up"]:
                    self.c(t)["face_up"] = True
                self._destroy(t, "effect", by=src)
        elif kind == "special_summon_target":
            t = ctx["target"]
            if self.c(t)["zone"] == "gy" and self._free_slot(self.pl(p)["monsters"]) is not None:
                self._special_summon(p, t, "revive")
        elif kind == "lock_attacks":
            self.c(src)["counters"]["turns_left"] = op["turns"]
            self._emit("EFFECT_APPLIED", iid=src, cid=self.c(src)["cid"], player=p, effect="lock_attacks",
                       turns_left=op["turns"])
        elif kind == "fusion_summon":
            fx, mats = ctx["fusion"], ctx["materials"]
            info = [{"iid": m, "cid": self.c(m)["cid"], "from_zone": self.c(m)["zone"], "slot": self.c(m)["slot"]}
                    for m in mats]
            for m in mats:
                self._to_gy(m)
            self._emit("FUSION_SUMMON_STARTED", player=p, result=fx, result_cid=self.c(fx)["cid"], materials=info)
            self._special_summon(p, fx, "fusion")
        elif kind == "destroy_opponent_attack_position":
            for iid in self._monsters(q):
                if self.c(iid)["position"] == "atk" and self.c(iid)["face_up"]:
                    self._destroy(iid, "effect", by=src)
            if self.state["battle"] and self.c(self.state["battle"]["attacker"])["zone"] != "monster":
                self.state["battle"]["negated"] = True
        elif kind == "negate_attack":
            b = self.state["battle"]
            if b:
                b["negated"] = True
                self._emit("ATTACK_NEGATED", attacker=b["attacker"], by=src, player=p)
        elif kind == "damage_attacker_controller":
            b = self.state["battle"]
            if b and self.c(b["attacker"])["zone"] == "monster":
                atk = self.stats(b["attacker"])[0]
                self._change_lp(q, -atk, "effect")
        elif kind == "end_battle_phase":
            if self.state["battle"]:
                self.state["battle"]["end_phase"] = True
        elif kind == "destroy_summoned":
            s = ctx["summoned"]
            if self.c(s)["zone"] == "monster":
                self._destroy(s, "effect", by=src)
        else:
            raise RuleError(f"Unimplemented effect op {kind}")

    def _resolve_pending_pass(self):
        pend = self.state["pending"]
        self.state["pending"] = None
        self._emit("RESPONSE_PASSED", player=pend["player"], trigger=pend["trigger"])
        if pend["trigger"] == "opp_attack":
            self._continue_attack()

    # ----------------------------------------------------------------- battle

    def _declare_attack(self, p, attacker, target):
        self.c(attacker)["attacked"] = True
        self.state["battle"] = {"attacker": attacker, "target": target, "negated": False}
        self._emit("ATTACK_DECLARED", attacker=attacker, target=target, player=p,
                   direct=target is None)
        q = self.opp(p)
        if self._set_cards(q):
            self.state["pending"] = {"kind": "response", "player": q, "trigger": "opp_attack"}
        else:
            self._continue_attack()

    def _continue_attack(self):
        b = self.state["battle"]
        if b is None or self.state["winner"] is not None:
            return
        end_phase = b.get("end_phase")
        if not b["negated"] and self.c(b["attacker"])["zone"] == "monster":
            self._resolve_battle(b)
        self.state["battle"] = None
        if end_phase and self.state["winner"] is None and self.state["phase"] == "battle":
            self._set_phase("main2")

    def _resolve_battle(self, b):
        a = b["attacker"]
        t = b["target"]
        p = self.c(a).get("controller", self.c(a)["owner"])
        q = self.opp(p)
        a_atk = self.stats(a)[0]
        if t is None:
            self._emit("ATTACK_RESOLVED", attacker=a, target=None, direct=True, player=p,
                       attacker_value=a_atk, destroyed=[], damage={"player": q, "amount": a_atk})
            self._change_lp(q, -a_atk, "battle")
            return
        if self.c(t)["zone"] != "monster":
            self._emit("ATTACK_RESOLVED", attacker=a, target=None, direct=False, fizzled=True, player=p,
                       attacker_value=a_atk, destroyed=[], damage=None)
            return
        tc = self.c(t)
        if not tc["face_up"]:
            tc["face_up"] = True
            self._emit("MONSTER_FLIPPED", iid=t, cid=tc["cid"], player=q, slot=tc["slot"], reason="attacked")
        t_atk, t_def = self.stats(t)
        destroyed, damage = [], None
        if tc["position"] == "atk":
            t_val = t_atk
            if a_atk > t_atk:
                destroyed = [t]
                damage = {"player": q, "amount": a_atk - t_atk}
            elif a_atk < t_atk:
                destroyed = [a]
                damage = {"player": p, "amount": t_atk - a_atk}
            else:
                destroyed = [a, t] if a_atk > 0 else []
        else:
            t_val = t_def
            if a_atk > t_def:
                destroyed = [t]
            elif a_atk < t_def:
                damage = {"player": p, "amount": t_def - a_atk}
        self._emit("ATTACK_RESOLVED", attacker=a, target=t, direct=False, player=p, attacker_value=a_atk,
                   target_value=t_val, target_position=tc["position"], destroyed=destroyed, damage=damage)
        self._emit("MONSTER_DAMAGED", iid=t, survived=t not in destroyed, by=a)
        if a in destroyed or (damage and damage["player"] == p):
            self._emit("MONSTER_DAMAGED", iid=a, survived=a not in destroyed, by=t, recoil=True)
        if damage and damage["amount"] > 0:
            self._change_lp(damage["player"], -damage["amount"], "battle")
        for iid in destroyed:
            if self.c(iid)["zone"] == "monster":
                self._destroy(iid, "battle")

    # ------------------------------------------------------------------ views

    def view(self, viewer, state=None):
        """The state as one player may see it: no opponent hand, deck order, or face-down identities."""
        state = state or self.state
        cards = state["cards"]

        def pub(iid, reveal):
            card = cards[iid]
            out = {"iid": iid, "face_up": card["face_up"], "position": card["position"], "slot": card["slot"]}
            if reveal or card["face_up"]:
                out["cid"] = card["cid"]
                if card["zone"] == "monster":
                    atk, dfn = self.stats(iid, state)
                    out.update(atk=atk, defense=dfn)
                if card["counters"]:
                    out["counters"] = dict(card["counters"])
            else:
                out["cid"] = None
            out["owner"] = card["owner"]
            if card["zone"] == "monster":
                out["attacked"] = card["attacked"]
                out["summoned_this_turn"] = card["turn_placed"] == state["turn"]
            return out

        players = []
        for p, pl in enumerate(state["players"]):
            mine = p == viewer
            players.append({
                "name": pl["name"],
                "lp": pl["lp"],
                "deck_count": len(pl["deck"]),
                "hand_count": len(pl["hand"]),
                "hand": [pub(i, True) for i in pl["hand"]] if mine else None,
                "extra_count": len(pl["extra"]),
                "extra": [pub(i, True) for i in pl["extra"]] if mine else None,
                "gy": [pub(i, True) for i in pl["gy"]],
                "monsters": [pub(i, mine) if i else None for i in pl["monsters"]],
                "st": [pub(i, mine) if i else None for i in pl["st"]],
                "field": pub(pl["field"], True) if pl["field"] else None,
                "normal_summoned": pl["normal_summoned"],
            })
        field_env = None
        for pl in state["players"]:
            if pl["field"]:
                # The most recently activated field spell sets the environment.
                f = cards[pl["field"]]
                if field_env is None or f["turn_placed"] >= field_env[1]:
                    field_env = (self.db[f["cid"]]["effect"]["ops"][0]["env"], f["turn_placed"])
        pend = state["pending"]
        b = state["battle"]
        return {
            "you": viewer,
            "turn": state["turn"],
            "active": state["active"],
            "phase": state["phase"],
            "profile": state["profile"],
            "winner": state["winner"],
            "win_reason": state["win_reason"],
            "pending": {"kind": pend["kind"], "player": pend["player"], "trigger": pend.get("trigger")} if pend else None,
            "battle": {"attacker": b["attacker"], "target": b["target"]} if b else None,
            "env": field_env[0] if field_env else None,
            "players": players,
        }

    def redact_event(self, ev, viewer):
        out = {k: v for k, v in ev.items() if not k.startswith("_")}
        sec = ev.get("_secret")
        if sec and sec["owner"] != viewer:
            for k in sec["keys"]:
                out.pop(k, None)
        out["view"] = self.view(viewer, ev["_state"])
        return out
