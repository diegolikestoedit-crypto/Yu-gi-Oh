"""One-off content script: Tokens, hand ambushes, summoning Traps, life-draining continuous cards, Ritual
Summons, monster steal, battle walls and on-kill effects, then a rebuild of all 14 decks with them.
Run after add_roster2.py (it reuses that script's deck builder and pools)."""
import add_roster2 as R
from add_technical import P, eff, mon, spell, trap


def ritual(c):
    c["subtype"] = "ritual"
    return c


def with_flags(c, **flags):
    c.update(flags)
    if c["subtype"] == "normal":
        c["subtype"] = "effect"
    return c


def token(cid, name, attr, race, atk, df, rig, pal, scale):
    c = mon(cid, name, attr, race, 1, atk, df, rig, pal, "A Token. It vanishes as soon as it leaves the field.", scale=scale)
    c["subtype"] = "token"
    c["token"] = True
    return c


TOKENS = [
    token("LD-T01", "Shield Token", "EARTH", "Rock", 0, 1500, "golem", P("#b8a888", "#5e5038", "#9fe8ff", "#ffffff", "#2b9bff"), 0.7),
    token("LD-T02", "Decoy Token", "WIND", "Winged Beast", 0, 0, "bird", P("#e8f0ff", "#8a9ab8", "#ffd86a", "#ffffff", "#ff5a3a", wing="#c8d8f0"), 0.6),
]

AMBUSH = [
    with_flags(mon("LD-338", "Ambush Sentinel", "EARTH", "Warrior", 4, 1200, 2000, "knight", P("#a8a088", "#4e4838", "#9fe8ff", "#ffffff", "#2b9bff", cloth="#3a4a2a"),
                   "When an opponent's monster declares an attack: you can Special Summon this card from your hand in Defense Position. The attack is redirected to it.", "rare"),
               hand_trigger={"trigger": "opp_attack", "position": "def", "label": "leaps out of the hand to take the hit", "ops": [{"op": "redirect_attack"}]}),
    with_flags(mon("LD-339", "Veil Phantom", "DARK", "Fiend", 3, 0, 1800, "imp", P("#3a2a5a", "#140a24", "#c8b0ff", "#f0e8ff", "#ff5af0", wing="#2a1a48"),
                   "When your opponent summons a monster: you can Special Summon this card from your hand in Defense Position. That monster loses 1000 ATK this turn.", "rare"),
               hand_trigger={"trigger": "opp_summon", "position": "def", "label": "drains the new monster's strength", "ops": [{"op": "weaken_summoned", "atk": 1000}]}),
    with_flags(mon("LD-340", "Swift Swallow", "WIND", "Winged Beast", 2, 300, 300, "bird", P("#3a4a6a", "#141c2e", "#ff8a5a", "#ffe0d0", "#ffcf3a", wing="#2a3a5a"),
                   "When your opponent activates a Spell: you can Special Summon this card from your hand in Defense Position, then draw 1 card.", scale=0.75),
               hand_trigger={"trigger": "opp_spell", "position": "def", "label": "darts in and snatches a card", "ops": [{"op": "draw", "count": 1}]}),
]

WALLS = [
    with_flags(mon("LD-341", "Bulwark Tortoise", "EARTH", "Rock", 4, 500, 2400, "golem", P("#7a8a5a", "#34401e", "#e0c05a", "#f8f0c0", "#ffcf3a"),
                   "Cannot be destroyed by battle."), battle_indestructible=True),
    mon("LD-342", "Bloodfang Imp", "DARK", "Fiend", 4, 1600, 600, "imp", P("#6a1a2a", "#2a0810", "#ff5a5a", "#ffc0c0", "#ffcf3a", wing="#4a0e1a"),
        "When this card destroys a monster by battle: draw 1 card.", effect=eff("destroys_by_battle", "feeds and draws a card", {"op": "draw", "count": 1})),
    with_flags(mon("LD-343", "Gravefeeder Ghoul", "DARK", "Zombie", 4, 1000, 1000, "knight", P("#5a6a4a", "#20281a", "#9fffb0", "#e0ffe8", "#7affa0", cloth="#2a2a1a"),
                   "Gains 200 ATK for each monster in your Graveyard."), atk_per_gy=200),
]

RITUALS = [
    with_flags(ritual(mon("LD-R01", "Colossus of the Seventh Sun", "LIGHT", "Rock", 8, 3200, 2800, "golem", P("#fff0c0", "#b0904a", "#ffffff", "#ffffff", "#ff9a3a"),
                          "Ritual Monster: summoned only with Rite of the Titan. Cannot be destroyed by battle.", "ultra", 1.45, summon="grand_portal")),
               battle_indestructible=True),
    ritual(mon("LD-R02", "Leviathan Rex", "WATER", "Sea Serpent", 7, 3000, 2200, "serpent", P("#1e5a8a", "#0a1e34", "#ffe07a", "#fff8d0", "#ff5a3a", fin="#3a9ad0"),
               "Ritual Monster: summoned only with Rite of the Titan. When it destroys a monster by battle: you gain Life Points equal to that monster's ATK.", "ultra", 1.45,
               effect=eff("destroys_by_battle", "devours its prey and heals", {"op": "gain_victim_atk"}), summon="grand_portal")),
    with_flags(ritual(mon("LD-R03", "Ashen Empress of the Grave", "DARK", "Zombie", 8, 2600, 2400, "knight", P("#3a3a42", "#121216", "#9fffb0", "#ffffff", "#7affa0", cloth="#1a0a1a"),
                          "Ritual Monster: summoned only with Rite of the Titan. Gains 100 ATK for each monster in your Graveyard.", "ultra", 1.4, summon="grand_portal")),
               atk_per_gy=100),
    with_flags(ritual(mon("LD-R04", "Kragmor, Inferno Titan", "FIRE", "Dragon", 8, 3000, 2500, "dragon", P("#c8301a", "#4a0a04", "#ffe07a", "#fff8d0", "#ffffff", wing="#ff6a2a"),
                          "Ritual Monster: summoned only with Rite of the Titan. Can attack twice each Battle Phase.", "ultra", 1.45, summon="grand_portal")),
               double_attack=True),
]

SPELLS = [
    spell("LD-137", "Scorched Earth", "continuous", "Continuous: during each player's Standby Phase, that player loses 300 LP.",
          [{"op": "drain_standby", "amount": 300, "target": "both"}], "field", "fire", "#3a0a04", "#ff7a2a"),
    spell("LD-138", "Mind Lure", "normal", "Take control of the monster your opponent controls with the highest ATK until the End Phase. It can attack. (Limited: 1 per deck.)",
          [{"op": "steal_strongest"}], "echo_chamber", "darkness", "#2a0a3a", "#e07aff", "ultra", limit=1),
    spell("LD-139", "Decoy Flock", "quickplay", "Quick-Play: Special Summon 3 Decoy Tokens (0 ATK / 0 DEF) in Defense Position. Works from a Set position on your opponent's turn.",
          [{"op": "summon_tokens", "cid": "LD-T02", "count": 3, "position": "def"}], "blades", "wind", "#1a2a3a", "#e8f0ff"),
    spell("LD-140", "Tempest Storm", "normal", "Destroy every Spell and Trap your opponent controls. (Limited: 1 per deck.)",
          [{"op": "destroy_all_opp_st"}], "tempest", "energy", "#0a2a2a", "#7af0d8", "ultra", limit=1),
    spell("LD-141", "Rite of the Titan", "ritual", "Ritual Spell: Tribute monsters from your hand or field whose Levels add up to at least a Ritual Monster's Level, then Ritual Summon it from your hand.",
          [{"op": "ritual_summon"}], "crown", "fire", "#2a0a0a", "#ffb34a", "rare"),
]

TRAPS = [
    trap("LD-221", "Ambush Call", "normal", "opp_attack", "When an opponent's monster attacks: Special Summon 1 Level 4 or lower monster from your Deck in Defense Position, and redirect the attack to it.",
         [{"op": "special_from_deck", "filter": {"max_level": 4}, "position": "def"}, {"op": "redirect_attack"}], "rally", "light", "#2a1a0a", "#ffd86a", "rare"),
    trap("LD-222", "Rally of Shields", "normal", "any", "Usable on either player's turn: Special Summon 2 Shield Tokens (0 ATK / 1500 DEF) in Defense Position.",
         [{"op": "summon_tokens", "cid": "LD-T01", "count": 2, "position": "def"}], "barrier", "earth", "#2a2a0a", "#e0d08a"),
    trap("LD-224", "Cursed Brand", "continuous", "any", "Continuous Trap: during each of your opponent's Standby Phases, they lose 400 LP.",
         [{"op": "drain_standby", "amount": 400}], "null_seal", "darkness", "#2a0a0a", "#ff3a5a", "rare"),
    trap("LD-225", "Blood Moon Pact", "continuous", "any", "Continuous Trap: during each of your opponent's Standby Phases, they lose 300 LP and you gain 300 LP.",
         [{"op": "drain_standby", "amount": 300, "heal": 300}], "echo_chamber", "darkness", "#3a0a1a", "#ff5a8a", "rare"),
    trap("LD-226", "Spike Pit", "normal", "opp_attack", "When an opponent's monster declares an attack: destroy it.",
         [{"op": "destroy_attacker"}], "sinkhole", "earth", "#2a1a0a", "#ff8a3a"),
    trap("LD-227", "Cataclysm Snare", "normal", "opp_summon", "When your opponent summons a monster: destroy every monster on the field. (Limited: 1 per deck.)",
         [{"op": "destroy_all_monsters"}], "void_rift", "darkness", "#1a0630", "#b45cff", "ultra", limit=1),
]

RITUAL_FOR = {"radiant": "LD-R01", "stone": "LD-R01", "tides": "LD-R02", "vault": "LD-R02", "spirit": "LD-R03", "umbral": "LD-R03",
              "ember": "LD-R04", "wyrm": "LD-R04"}
MONSTER_ADDS = {
    "stone": [("LD-341", 2), ("LD-338", 2)], "iron": [("LD-338", 2), ("LD-341", 1)], "crystal": [("LD-338", 1), ("LD-339", 2)],
    "umbral": [("LD-339", 2), ("LD-343", 2), ("LD-342", 1)], "jester": [("LD-339", 2), ("LD-342", 2)], "void": [("LD-339", 2), ("LD-342", 1)],
    "storm": [("LD-340", 2)], "arcana": [("LD-340", 2)], "spirit": [("LD-343", 3)], "ember": [("LD-342", 2)], "tides": [("LD-338", 1)],
    "radiant": [("LD-338", 1)], "vault": [("LD-342", 1)], "wyrm": [],
}
SPELL_ADDS = {"ember": [("LD-137", 2)], "storm": [("LD-139", 2)], "tides": [("LD-139", 1)], "crystal": [("LD-139", 1)], "jester": [("LD-138", 1)]}
TRAP_ADDS = {"umbral": [("LD-224", 2), ("LD-225", 2), ("LD-227", 1)], "jester": [("LD-224", 2), ("LD-226", 2)], "spirit": [("LD-225", 2)],
             "crystal": [("LD-222", 2), ("LD-221", 2), ("LD-226", 1)], "stone": [("LD-222", 2), ("LD-221", 2)], "iron": [("LD-222", 1)],
             "tides": [("LD-221", 2), ("LD-227", 1)], "ember": [("LD-226", 2)], "radiant": [("LD-221", 1)]}


def setup():
    R.generic.extend(TOKENS + AMBUSH + WALLS + RITUALS)
    R.new_spells.extend(SPELLS)
    R.new_traps.extend(TRAPS)
    # Generic picks that every deck may draw on, early in the pools so even small Trap/Spell counts get one.
    R.GEN_TRAPS[:0] = [("LD-226", 1), ("LD-221", 1)]
    R.GEN_SPELLS[:0] = [("LD-140", 1), ("LD-138", 1)]
    for did, (mons, spells, traps) in R.POOLS.items():
        rit = RITUAL_FOR.get(did)
        if rit:
            mons.insert(2, (rit, 2))
            spells.insert(0, ("LD-141", 2))
        for cid, n in reversed(MONSTER_ADDS.get(did, [])):
            mons.insert(3, (cid, n))
        spells[0:0] = SPELL_ADDS.get(did, [])
        traps[0:0] = TRAP_ADDS.get(did, [])


def main():
    setup()
    R.main()


if __name__ == "__main__":
    main()
