"""One-off content script: effect monsters, Level 7+ Fusions, Equip/Quick-Play/Counter cards, 50-card decks."""
import collections
import json
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CARDS = os.path.join(ROOT, "shared", "cards.json")
DECKS = os.path.join(ROOT, "shared", "decks.json")
RULES = ["frontier", "citadel"]

SUMMON = {"dragon": "flame_burst", "sorcerer": "arcane_circle", "knight": "light_pillar", "bird": "wind_swirl",
          "golem": "earth_rise", "serpent": "water_spout", "imp": "shadow_pool", "fairy": "light_pillar"}
ATTACK = {"dragon": "fire_breath", "sorcerer": "void_orb", "knight": "blade_dash", "bird": "dive",
          "golem": "slam", "serpent": "water_jet", "imp": "shadow_bolt", "fairy": "shards"}
AURA = {"LIGHT": "light", "DARK": "dark", "FIRE": "fire", "WATER": "water", "WIND": "wind", "EARTH": "earth"}


def P(body, shade, accent, glow, eye, **k):
    return dict(body=body, shade=shade, accent=accent, glow=glow, eye=eye, **k)


def mon(cid, name, attr, race, lv, atk, df, rig, pal, text, rarity="common", scale=1.0, effect=None,
        piercing=False, fusion=None, summon=None, attack=None):
    c = {"id": cid, "name": name, "type": "monster", "subtype": "fusion" if fusion else "effect" if (effect or piercing) else "normal",
         "attribute": attr, "race": race, "level": lv, "atk": atk, "def": df, "rarity": rarity, "text": text,
         "rulesets": RULES,
         "visual": {"rig": rig, "scale": scale, "summon": "fusion_vortex" if fusion else summon or SUMMON[rig],
                    "attack": attack or ATTACK[rig], "aura": AURA[attr], "palette": pal}}
    if fusion:
        c["materials"] = fusion
    if effect:
        c["effect"] = effect
    if piercing:
        c["piercing"] = True
    return c


def eff(trigger, label, *ops):
    return {"trigger": trigger, "label": label, "ops": list(ops)}


PIERCE = "If this card attacks a Defense Position monster, it inflicts piercing battle damage (the difference in ATK and DEF)."

monsters = [
    mon("LD-301", "Dawnward Scout", "LIGHT", "Warrior", 3, 1200, 1000, "knight", P("#f4e6b8", "#a8926a", "#7ae7ff", "#fff6d0", "#2b9bff", cloth="#3a6ab8"),
        "When this card is summoned: add 1 Level 4 or lower LIGHT monster from your Deck to your hand.",
        effect=eff("summon", "searches a LIGHT monster", {"op": "search_deck", "filter": {"max_level": 4, "attribute": "LIGHT"}})),
    mon("LD-302", "Halo Wisp", "LIGHT", "Fairy", 2, 600, 1400, "fairy", P("#fffbe8", "#d8c890", "#ffd86a", "#ffffff", "#ff9b3a", wing="#fff0b0"),
        "FLIP: You gain 1000 Life Points, then draw 1 card.", scale=0.85,
        effect=eff("flip", "restores 1000 LP and draws", {"op": "gain_lp", "amount": 1000}, {"op": "draw", "count": 1})),
    mon("LD-303", "Sunlance Paladin", "LIGHT", "Warrior", 6, 2300, 1500, "knight", P("#ffe9a8", "#b08a3a", "#ffffff", "#fff6d0", "#ffcf3a", cloth="#b83a2a"),
        PIERCE, "rare", 1.1, piercing=True),
    mon("LD-304", "Hex Mimic", "DARK", "Fiend", 3, 800, 1200, "imp", P("#5a2a6a", "#24102e", "#ffcf3a", "#ffe8a0", "#ff3a5a", wing="#3a1a48"),
        "FLIP: Destroy the monster your opponent controls with the highest ATK.", "rare",
        effect=eff("flip", "destroys the strongest enemy", {"op": "destroy_strongest_opp"})),
    mon("LD-305", "Void Acolyte", "DARK", "Spellcaster", 4, 1500, 1100, "sorcerer", P("#3a2a5a", "#160e26", "#b45cff", "#e0b8ff", "#c87aff", cloth="#2a1a48", skin="#d8c8e8"),
        "When this card is destroyed by battle: Special Summon 1 DARK monster with 1500 or less ATK from your Deck.",
        effect=eff("destroyed_by_battle", "calls a DARK ally from the Deck", {"op": "special_from_deck", "filter": {"max_atk": 1500, "attribute": "DARK"}})),
    mon("LD-306", "Blaze Cub", "FIRE", "Dragon", 3, 1300, 800, "dragon", P("#ff7a3a", "#9a3014", "#ffe07a", "#fff0b0", "#3a1a08", wing="#e24a1c"),
        "When this card is summoned: inflict 500 damage to your opponent.", scale=0.8,
        effect=eff("summon", "burns the opponent for 500", {"op": "damage_opponent", "amount": 500})),
    mon("LD-307", "Inferno Lancer", "FIRE", "Warrior", 4, 1800, 600, "knight", P("#d8502a", "#6a1a10", "#ffd24a", "#ffe6a0", "#fff36a", cloth="#3a1a14"),
        PIERCE, piercing=True),
    mon("LD-308", "Tidecaller Nymph", "WATER", "Fairy", 4, 1400, 1500, "fairy", P("#bff0ff", "#4a98c0", "#3ad6c8", "#ffffff", "#1e5ab8", wing="#7fe0ff"),
        "When this card is summoned: destroy 1 Spell/Trap your opponent controls (a Set card if possible).", "rare",
        effect=eff("summon", "washes away a Spell/Trap", {"op": "destroy_opp_st"})),
    mon("LD-309", "Abyss Lurker", "WATER", "Sea Serpent", 3, 1000, 1600, "serpent", P("#1e4a6a", "#0a1e2e", "#7ff0d8", "#c8fff4", "#ffd86a", fin="#2e7a94"),
        "FLIP: Draw 2 cards.", scale=0.85,
        effect=eff("flip", "draws 2 cards", {"op": "draw", "count": 2})),
    mon("LD-310", "Rampart Tortoise", "EARTH", "Rock", 4, 600, 2200, "golem", P("#7a8a5a", "#3a4428", "#d8c06a", "#f0f8b0", "#ffcf3a"),
        "When this card is destroyed by battle: draw 1 card.",
        effect=eff("destroyed_by_battle", "draws a card", {"op": "draw", "count": 1})),
    mon("LD-311", "Quarry Scout", "EARTH", "Warrior", 3, 1100, 1300, "knight", P("#b0a080", "#5e5038", "#9fe06a", "#e8f8c0", "#ffcf3a", cloth="#5a7a2a"),
        "When this card is summoned: add 1 Level 4 or lower EARTH monster from your Deck to your hand.",
        effect=eff("summon", "searches an EARTH monster", {"op": "search_deck", "filter": {"max_level": 4, "attribute": "EARTH"}})),
    mon("LD-312", "Night Courtier", "DARK", "Spellcaster", 4, 1700, 1000, "sorcerer", P("#2a1a3a", "#100818", "#e0b04a", "#ffb0c8", "#ff3a5a", cloth="#6a1a3a", skin="#e0d0e0"),
        "When this card is destroyed by battle: inflict 800 damage to your opponent.",
        effect=eff("destroyed_by_battle", "curses the opponent for 800", {"op": "damage_opponent", "amount": 800})),
    mon("LD-313", "Shadow Leech", "DARK", "Fiend", 2, 500, 500, "imp", P("#2a2a3a", "#0e0e18", "#5af0c8", "#b0fff0", "#5af0c8", wing="#1e1e2e"),
        "FLIP: Destroy 1 Spell/Trap your opponent controls (a Set card if possible).", scale=0.85,
        effect=eff("flip", "devours a Spell/Trap", {"op": "destroy_opp_st"})),
    mon("LD-314", "Glass Marionette", "LIGHT", "Fairy", 4, 1300, 1700, "fairy", P("#e8f4ff", "#8aa8c8", "#ff9bf0", "#ffffff", "#5a3aa8", wing="#c8e8ff"),
        "When this card is destroyed by battle: Special Summon 1 LIGHT monster with 1500 or less ATK from your Deck.",
        effect=eff("destroyed_by_battle", "pulls a LIGHT puppet from the Deck", {"op": "special_from_deck", "filter": {"max_atk": 1500, "attribute": "LIGHT"}})),
    mon("LD-315", "Prism Weaver", "LIGHT", "Spellcaster", 4, 1400, 1200, "sorcerer", P("#d8e8f8", "#6a7aa0", "#ff9bf0", "#ffffff", "#7ae8ff", cloth="#5a3aa8", skin="#f0e0f0"),
        "When this card is summoned: destroy 1 Spell/Trap your opponent controls (a Set card if possible).", "rare",
        effect=eff("summon", "shatters a Spell/Trap", {"op": "destroy_opp_st"})),
    mon("LD-316", "Clockwork Thief", "DARK", "Machine", 4, 1500, 1300, "golem", P("#6a5a48", "#2e261e", "#e0b04a", "#ffe8a0", "#3ad6c8"),
        "When this card is summoned: draw 1 card.",
        effect=eff("summon", "steals a card", {"op": "draw", "count": 1})),
    mon("LD-317", "Gear Hound", "DARK", "Machine", 3, 1300, 900, "imp", P("#5a5a62", "#26262c", "#e0b04a", "#ffe8a0", "#ff5a3a", wing="#3a3a42"),
        PIERCE, piercing=True),
    mon("LD-318", "Ashen Salamander", "FIRE", "Reptile", 4, 1500, 1200, "serpent", P("#c8482a", "#5a1608", "#ffd24a", "#ffe9a0", "#fff36a", fin="#ff8a3a"),
        "When this card is destroyed by battle: inflict 500 damage to your opponent.",
        effect=eff("destroyed_by_battle", "erupts for 500 damage", {"op": "damage_opponent", "amount": 500})),
    mon("LD-319", "Brine Warden", "WATER", "Warrior", 5, 2000, 1500, "knight", P("#4a8ab8", "#1e3a62", "#e8f0ff", "#c8e8ff", "#7ff0d8", cloth="#1e4a6a"),
        "When this card is summoned: you gain 1000 Life Points.",
        effect=eff("summon", "restores 1000 LP", {"op": "gain_lp", "amount": 1000})),
    mon("LD-320", "Crag Rhino", "EARTH", "Beast", 4, 1800, 1000, "golem", P("#8a7a64", "#463a2c", "#c8e06a", "#f0ffb0", "#ff8a3a"),
        PIERCE, piercing=True),
]

FUS = "Fusion (Level 7+): "
fusions = [
    mon("LD-F02", "Eclipse Archmage", "DARK", "Spellcaster", 8, 2900, 2400, "sorcerer", P("#1e1030", "#0a0414", "#ffcf3a", "#e0b8ff", "#b45cff", cloth="#3a1a6a", skin="#d8c8e8"),
        FUS + "Nyxar, Void Sorcerer + Shade Apprentice. When Fusion Summoned: destroy 1 Spell/Trap your opponent controls.", "ultra", 1.3,
        effect=eff("summon", "erases a Spell/Trap", {"op": "destroy_opp_st"}), fusion=["LD-007", "LD-011"]),
    mon("LD-F03", "Blazeguard Dragoon", "FIRE", "Dragon", 7, 2700, 2000, "dragon", P("#d8402a", "#5a1208", "#ffd84a", "#fff0a8", "#fff36a", wing="#ff7a2a"),
        FUS + "Ember Drake + Flamecrest Knight. Piercing: inflicts battle damage through Defense Position monsters.", "ultra", 1.3, piercing=True, fusion=["LD-006", "LD-015"]),
    mon("LD-F04", "Maelstrom Oracle", "WATER", "Spellcaster", 7, 2600, 2300, "sorcerer", P("#1e5a8a", "#0a2440", "#7ff0d8", "#c8fff4", "#7ff0d8", cloth="#e8d8a8", skin="#b8e0e8"),
        FUS + "Storm Petrel + Deepsea Oracle. When Fusion Summoned: draw 1 card.", "ultra", 1.25,
        effect=eff("summon", "reads the currents and draws", {"op": "draw", "count": 1}), fusion=["LD-021", "LD-022"]),
    mon("LD-F05", "Bastion Basilisk", "EARTH", "Reptile", 7, 2400, 2900, "serpent", P("#6a8a3a", "#2a3a14", "#e0c05a", "#f0ffb0", "#ffcf3a", fin="#9ac04a"),
        FUS + "Quarry Knight + Moss Serpent. When Fusion Summoned: you gain 1000 Life Points.", "ultra", 1.3,
        effect=eff("summon", "restores 1000 LP", {"op": "gain_lp", "amount": 1000}), fusion=["LD-024", "LD-025"]),
    mon("LD-F06", "Dusk Reaper", "DARK", "Zombie", 7, 2700, 1800, "knight", P("#3a3a4a", "#121218", "#b45cff", "#e0b8ff", "#c87aff", cloth="#1a0a2a"),
        FUS + "Dread Revenant + Wraith Raven. When Fusion Summoned: inflict 700 damage to your opponent.", "ultra", 1.25,
        effect=eff("summon", "reaps 700 LP", {"op": "damage_opponent", "amount": 700}), fusion=["LD-030", "LD-032"]),
    mon("LD-F07", "Kaleido Paladin", "LIGHT", "Warrior", 8, 2800, 2500, "knight", P("#e0f0ff", "#7a8ab0", "#ff9bf0", "#ffffff", "#7ae8ff", cloth="#5a3aa8"),
        FUS + "Mirror Knight + Prism Golem. Piercing: inflicts battle damage through Defense Position monsters.", "ultra", 1.25, piercing=True, fusion=["LD-034", "LD-036"]),
    mon("LD-F08", "Grand Curator", "DARK", "Machine", 7, 2600, 2400, "golem", P("#6a5a3a", "#2a2414", "#ffd86a", "#fff0b0", "#3ad6c8"),
        FUS + "Relic Hunter + Curio Imp. When Fusion Summoned: add 1 Level 4 or lower monster from your Deck to your hand.", "ultra", 1.3,
        effect=eff("summon", "catalogues a monster from the Deck", {"op": "search_deck", "filter": {"max_level": 4}}), fusion=["LD-039", "LD-040"]),
]


def spell(cid, name, sub, text, ops, fx, element, a, b, rarity="common", limit=None, **extra):
    c = {"id": cid, "name": name, "type": "spell", "subtype": sub, "rarity": rarity, "text": text, "rulesets": RULES,
         "effect": {"ops": ops}, "visual": {"fx": fx, "element": element, "palette": {"a": a, "b": b}}, **extra}
    if limit:
        c["limit"] = limit
    return c


def trap(cid, name, sub, trigger, text, ops, fx, element, a, b, rarity="common", limit=None, **extra):
    c = spell(cid, name, sub, text, ops, fx, element, a, b, rarity, limit, **extra)
    c["type"] = "trap"
    c["trigger"] = trigger
    return c


spells = [
    spell("LD-121", "Sunforged Blade", "equip", "Equip only to a face-up monster you control. It gains 700 ATK.",
          [{"op": "equip", "atk": 700}], "equip_blade", "fire", "#5a2a0a", "#ffcf5a"),
    spell("LD-122", "Aegis Mantle", "equip", "Equip only to a face-up monster you control. It gains 300 ATK and 800 DEF.",
          [{"op": "equip", "atk": 300, "def": 800}], "equip_shield", "barrier", "#0e2e4a", "#9fe8ff"),
    spell("LD-123", "Surge Strike", "quickplay", "Quick-Play: target 1 face-up monster you control; it gains 1000 ATK until the end of this turn. "
          "Can be used during the Battle Phase, or from a Set position on your opponent's turn.",
          [{"op": "boost", "atk": 1000}], "surge", "lightning", "#2a1a5a", "#ffe86a", "rare"),
    spell("LD-124", "Tempest Sweep", "normal", "Target 1 Spell/Trap your opponent controls; destroy it. (Limited: 1 per deck.)",
          [{"op": "destroy_target_st"}], "tempest", "energy", "#0a3a3a", "#9fffe0", "rare", limit=1),
    spell("LD-125", "Scout's Lantern", "normal", "Add 1 Level 4 or lower monster from your Deck to your hand. (Limited: 1 per deck.)",
          [{"op": "search_deck", "filter": {"max_level": 4}}], "lantern", "light", "#3a2a0a", "#ffd86a", limit=1),
    spell("LD-126", "Mystic Squall", "quickplay", "Quick-Play: target 1 Spell/Trap your opponent controls; destroy it. "
          "Can be chained from a Set position, even to destroy the card your opponent is activating.",
          [{"op": "destroy_target_st"}], "squall", "energy", "#0a2a3a", "#7af0ff", "rare"),
]
traps = [
    trap("LD-211", "Null Seal", "counter", "opp_spell", "Counter Trap: when your opponent activates a Spell: pay 1000 LP; negate the activation and destroy it.",
         [{"op": "pay_lp", "amount": 1000}, {"op": "negate_spell"}], "null_seal", "barrier", "#2a0a2a", "#ff6ad8", "rare", cost_lp=1000),
    trap("LD-212", "Gravity Snare", "normal", "opp_attack", "When an opponent's monster declares an attack: change all Attack Position monsters your opponent controls to Defense Position. The attack is stopped.",
         [{"op": "all_opp_to_defense"}], "gravity", "darkness", "#14082a", "#a07aff"),
]
LIMITS = {"LD-101": 1, "LD-102": 1, "LD-103": 1, "LD-104": 1, "LD-201": 1}

DECKLISTS = {
    "radiant": ({"LD-001": 2, "LD-002": 3, "LD-003": 3, "LD-004": 3, "LD-005": 3, "LD-006": 1, "LD-301": 3, "LD-302": 2, "LD-303": 2, "LD-034": 2, "LD-035": 1, "LD-036": 1,
                 "LD-101": 1, "LD-103": 1, "LD-104": 1, "LD-105": 1, "LD-106": 2, "LD-109": 2, "LD-121": 2, "LD-123": 2, "LD-124": 1, "LD-125": 1,
                 "LD-201": 1, "LD-203": 2, "LD-202": 2, "LD-211": 2, "LD-212": 2, "LD-204": 1}, ["LD-F01", "LD-F01"]),
    "void": ({"LD-007": 3, "LD-008": 3, "LD-009": 2, "LD-010": 3, "LD-011": 3, "LD-012": 2, "LD-304": 2, "LD-305": 3, "LD-312": 2, "LD-031": 2, "LD-040": 1,
              "LD-101": 1, "LD-102": 1, "LD-104": 1, "LD-106": 2, "LD-110": 2, "LD-107": 1, "LD-122": 2, "LD-126": 2, "LD-125": 1, "LD-103": 1,
              "LD-202": 2, "LD-204": 2, "LD-211": 2, "LD-201": 1, "LD-203": 1, "LD-212": 2}, ["LD-F02", "LD-F02"]),
    "ember": ({"LD-013": 2, "LD-006": 3, "LD-014": 3, "LD-015": 3, "LD-016": 3, "LD-017": 3, "LD-306": 3, "LD-307": 3, "LD-318": 3,
               "LD-108": 3, "LD-101": 1, "LD-103": 1, "LD-104": 1, "LD-106": 2, "LD-121": 3, "LD-123": 3,
               "LD-203": 2, "LD-204": 2, "LD-202": 2, "LD-211": 2, "LD-212": 1, "LD-201": 1}, ["LD-F03", "LD-F03"]),
    "tides": ({"LD-018": 3, "LD-009": 3, "LD-019": 3, "LD-020": 3, "LD-021": 3, "LD-022": 3, "LD-308": 3, "LD-309": 3, "LD-319": 2,
               "LD-107": 3, "LD-101": 1, "LD-104": 1, "LD-105": 1, "LD-106": 2, "LD-122": 2, "LD-126": 2, "LD-124": 1, "LD-125": 1,
               "LD-201": 1, "LD-203": 2, "LD-211": 2, "LD-212": 2, "LD-202": 2, "LD-204": 1}, ["LD-F04", "LD-F04"]),
    "stone": ({"LD-023": 2, "LD-004": 3, "LD-024": 3, "LD-025": 3, "LD-026": 3, "LD-027": 2, "LD-310": 3, "LD-311": 3, "LD-019": 2, "LD-320": 2,
               "LD-111": 3, "LD-101": 1, "LD-104": 1, "LD-105": 2, "LD-106": 2, "LD-122": 3, "LD-125": 1, "LD-124": 1,
               "LD-203": 2, "LD-202": 2, "LD-212": 2, "LD-204": 2, "LD-211": 1, "LD-201": 1}, ["LD-F05", "LD-F05"]),
    "umbral": ({"LD-028": 2, "LD-029": 2, "LD-030": 3, "LD-031": 3, "LD-032": 3, "LD-008": 2, "LD-010": 2, "LD-312": 3, "LD-313": 3, "LD-304": 2, "LD-305": 1,
                "LD-110": 3, "LD-102": 1, "LD-101": 1, "LD-104": 1, "LD-106": 2, "LD-121": 2, "LD-126": 2, "LD-103": 1, "LD-124": 1,
                "LD-202": 2, "LD-204": 2, "LD-201": 1, "LD-211": 3, "LD-212": 2}, ["LD-F06", "LD-F06"]),
    "crystal": ({"LD-033": 2, "LD-034": 3, "LD-035": 3, "LD-036": 3, "LD-005": 3, "LD-314": 3, "LD-315": 3, "LD-302": 2,
                 "LD-109": 2, "LD-105": 2, "LD-101": 1, "LD-104": 1, "LD-106": 2, "LD-122": 1, "LD-126": 2, "LD-125": 1,
                 "LD-201": 1, "LD-203": 3, "LD-202": 3, "LD-204": 3, "LD-211": 3, "LD-212": 3}, ["LD-F07", "LD-F07"]),
    "vault": ({"LD-037": 2, "LD-038": 2, "LD-039": 3, "LD-040": 3, "LD-012": 1, "LD-010": 2, "LD-316": 3, "LD-317": 3, "LD-304": 2, "LD-305": 2, "LD-008": 2, "LD-031": 1,
               "LD-104": 1, "LD-103": 1, "LD-102": 1, "LD-101": 1, "LD-105": 1, "LD-106": 2, "LD-121": 2, "LD-122": 1, "LD-123": 2, "LD-124": 1, "LD-125": 1,
               "LD-204": 2, "LD-202": 2, "LD-211": 2, "LD-212": 2, "LD-201": 1, "LD-203": 1}, ["LD-F08", "LD-F08"]),
}


def main():
    data = json.load(open(CARDS, encoding="utf-8"))
    new = {c["id"]: c for c in monsters + fusions + spells + traps}
    data["cards"] = [c for c in data["cards"] if c["id"] not in new] + list(new.values())
    db = {c["id"]: c for c in data["cards"]}
    for cid, n in LIMITS.items():
        db[cid]["limit"] = n
        if "(Limited" not in db[cid]["text"]:
            db[cid]["text"] += " (Limited: 1 per deck.)"
    db["LD-F01"]["text"] = FUS + "Lumen Sentinel + Skyreach Hawk. When knight and hawk swear the same oath, the sky itself takes up arms."
    json.dump(data, open(CARDS, "w", encoding="utf-8"), indent=2, ensure_ascii=False)

    decks = json.load(open(DECKS, encoding="utf-8"))
    for d in decks["decks"]:
        counts, extra = DECKLISTS[d["id"]]
        main = [cid for cid, n in counts.items() for _ in range(n)]
        types = collections.Counter(db[c]["type"] for c in main)
        assert len(main) == 50, (d["id"], len(main))
        for cid, n in counts.items():
            assert n <= db[cid].get("limit", 3), (d["id"], cid)
        for fx in extra:
            assert all(m in counts for m in db[fx]["materials"]), (d["id"], fx)
        assert d["signature"] in counts
        d["main"], d["extra"] = main, extra
        print(d["id"], len(main), dict(types), "extra", extra)
    json.dump(decks, open(DECKS, "w", encoding="utf-8"), indent=2, ensure_ascii=False)


if __name__ == "__main__":
    main()
