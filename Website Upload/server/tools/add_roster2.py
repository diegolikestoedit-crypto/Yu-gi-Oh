"""One-off content script: six new duelists, monsters with extra abilities (extra draws, card grabs, bounces,
double and direct attacks), new Spells/Traps, and a rebuild of all 14 decks so each has its own mix of
Monsters, Spells and Traps. Run after add_technical.py and add_combos.py."""
import collections
import json

from add_technical import CARDS, DECKS, P, eff, mon, spell, trap

PIERCE = "Piercing: inflicts battle damage through Defense Position monsters."
DOUBLE = "Can attack twice each Battle Phase."
DIRECT = "Can attack your opponent directly even while they control monsters."
HERALD = ("Can be used as any one Fusion Material. When this card is Normal Summoned: you can Special Summon "
          "1 Level 4 or lower monster from your hand.")
FUS = "Fusion (Level 7+): "
ASC = "Ascended (Level 10). Summoned only by Crown of Ascension or Ascension Rite, by offering {}. "


def ability(c, **flags):
    for k, v in flags.items():
        c[k] = v
    if flags:
        c["subtype"] = c["subtype"] if c["subtype"] in ("fusion", "ascended") else "effect"
    return c


def herald(cid, name, attr, race, rig, pal):
    c = mon(cid, name, attr, race, 4, 1400, 1000, rig, pal, HERALD, "rare",
            effect=eff("normal_summon", "calls an ally from the hand", {"op": "special_from_hand", "filter": {"max_level": 4}}))
    c["fusion_substitute"] = True
    return c


def fusion(cid, name, attr, race, lv, atk, df, rig, pal, mats, mat_names, text, effect=None, **flags):
    c = mon(cid, name, attr, race, lv, atk, df, rig, pal, FUS + f"{mat_names}. {text}", "ultra", 1.3, effect=effect, fusion=mats)
    return ability(c, **flags)


def ascended(cid, name, src, src_name, attr, race, atk, df, rig, pal, text, effect=None, scale=1.5, **flags):
    c = mon(cid, name, attr, race, 10, atk, df, rig, pal, ASC.format(src_name) + text, "ultra", scale, effect=effect, summon="grand_portal")
    c["subtype"] = "ascended"
    c["ascends_from"] = src
    return ability(c, **flags)


DRAW1 = {"op": "draw", "count": 1}

# ---------------------------------------------------------------- shared ability monsters
generic = [
    mon("LD-329", "Lucky Magpie", "WIND", "Winged Beast", 3, 1100, 900, "bird", P("#2a2a3a", "#0e0e18", "#e8f0ff", "#ffffff", "#ffd86a", wing="#3a5a8a"),
        "During each of your Standby Phases: draw 1 card.", "rare", effect=eff("standby", "steals you an extra card", DRAW1)),
    mon("LD-330", "Burrow Scavenger", "EARTH", "Beast", 3, 1000, 1000, "imp", P("#8a6a4a", "#3e2a18", "#ffd86a", "#fff0b0", "#3a1a08", wing="#5e4a30"),
        "When this card is summoned: add 1 monster from your Graveyard to your hand.",
        effect=eff("summon", "digs a monster out of the Graveyard", {"op": "recover_gy"})),
    mon("LD-331", "Arcane Scribe", "LIGHT", "Spellcaster", 4, 1300, 1400, "sorcerer", P("#e8e0f8", "#8a7ab0", "#7ae8ff", "#ffffff", "#5a3aa8", cloth="#3a4a8a", skin="#f0e0d8"),
        "When this card is summoned: add 1 Spell from your Deck to your hand.",
        effect=eff("summon", "copies a Spell from the Deck", {"op": "search_deck", "filter": {"card_type": "spell"}})),
    mon("LD-332", "Trapsmith Imp", "DARK", "Fiend", 3, 900, 1100, "imp", P("#5a3a2a", "#241410", "#ff8a3a", "#ffd0a0", "#ffcf3a", wing="#3a2418"),
        "When this card is summoned: add 1 Trap from your Deck to your hand.",
        effect=eff("summon", "builds a Trap from the Deck", {"op": "search_deck", "filter": {"card_type": "trap"}})),
    ability(mon("LD-333", "Twin-Blade Ronin", "EARTH", "Warrior", 4, 1500, 1000, "knight", P("#b8a888", "#4e4030", "#e04a3a", "#ffd0c0", "#ffcf3a", cloth="#3a1a1a"),
                DOUBLE, "rare"), double_attack=True),
    ability(mon("LD-334", "Phantom Stalker", "DARK", "Fiend", 4, 1300, 800, "imp", P("#3a2a4a", "#120a18", "#9fe8ff", "#e0f8ff", "#7ae8ff", wing="#2a1a38"),
                DIRECT), direct_attack=True),
    mon("LD-335", "Riptide Siren", "WATER", "Fairy", 4, 1400, 1200, "fairy", P("#9fe0ff", "#2a7ab0", "#ffffff", "#e8fbff", "#1e5ab8", wing="#5ad0ff"),
        "When this card is summoned: return the monster your opponent controls with the highest ATK to the hand.", "rare",
        effect=eff("summon", "washes their strongest monster away", {"op": "bounce_strongest_opp"})),
    mon("LD-336", "Wellspring Nymph", "WATER", "Fairy", 2, 500, 1500, "fairy", P("#c8f8ff", "#5ab0c8", "#7ff0d8", "#ffffff", "#2a6fd8", wing="#a8f0ff"),
        "During each of your Standby Phases: you gain 500 Life Points.", scale=0.85,
        effect=eff("standby", "restores 500 LP", {"op": "gain_lp", "amount": 500})),
]

# ---------------------------------------------------------------- the six new duelists
storm = [
    ability(mon("LD-401", "Tempest Roc", "WIND", "Winged Beast", 8, 2800, 2200, "bird", P("#e8f4ff", "#6a8ab0", "#7ef0d8", "#ffffff", "#ffd86a", wing="#a8d8f0"),
                DOUBLE, "ultra", 1.4), double_attack=True),
    mon("LD-402", "Gale Falcon", "WIND", "Winged Beast", 4, 1700, 1000, "bird", P("#8ab0d0", "#2a4a6a", "#ffe07a", "#fff0b0", "#ffcf3a", wing="#5a7aa0"),
        "It rides the jet stream so high that it has seen the curve of the world."),
    mon("LD-403", "Zephyr Sprite", "WIND", "Fairy", 3, 1100, 1200, "fairy", P("#d8fff4", "#6ab8a0", "#ffffff", "#ffffff", "#2a8f6a", wing="#a8ffe0"),
        "When this card is summoned: draw 1 card.", effect=eff("summon", "catches a card on the wind", DRAW1)),
    ability(mon("LD-404", "Cyclone Hawk", "WIND", "Winged Beast", 4, 1500, 1100, "bird", P("#6ab0a0", "#1e4a40", "#e8fff8", "#ffffff", "#ffe14a", wing="#3a8a78"),
                DIRECT), direct_attack=True),
    ability(mon("LD-405", "Windrider Knight", "WIND", "Warrior", 5, 2100, 1400, "knight", P("#c8e0f0", "#5a7a90", "#7ef0d8", "#ffffff", "#2a8f6a", cloth="#2a6a5a"),
                PIERCE), piercing=True),
    herald("LD-406", "Sky Herald", "WIND", "Winged Beast", "bird", P("#e0fff8", "#6ab0a0", "#ffd86a", "#ffffff", "#2a8f6a", wing="#b8f0e0")),
    mon("LD-407", "Thunderhead Djinn", "WIND", "Spellcaster", 6, 2300, 1700, "sorcerer", P("#5a7ab0", "#1e2e4a", "#fff07a", "#ffffd0", "#fff36a", cloth="#3a4a7a", skin="#c8d8f0"),
        "When this card is summoned: destroy 1 Spell/Trap your opponent controls.", "rare",
        effect=eff("summon", "blasts a Spell/Trap with lightning", {"op": "destroy_opp_st"})),
    fusion("LD-F09", "Stormwing Paladin", "WIND", "Winged Beast", 7, 2700, 2000, "bird", P("#f0fbff", "#7a9ab8", "#7ef0d8", "#ffffff", "#ffd86a", wing="#c8ecff"),
           ["LD-402", "LD-405"], "Gale Falcon + Windrider Knight", DOUBLE, double_attack=True),
    ascended("LD-A09", "Skyrend Paladin Ascendant", "LD-F09", "Stormwing Paladin", "WIND", "Winged Beast", 3300, 2600, "bird",
             P("#ffffff", "#9ab8d0", "#7ef0d8", "#ffffff", "#ffd86a", wing="#e0f8ff"),
             "Can attack twice. When summoned: return your opponent's strongest monster to the hand.",
             effect=eff("summon", "blows their strongest monster away", {"op": "bounce_strongest_opp"}), double_attack=True),
]
iron = [
    mon("LD-411", "Bastion Mech Colossus", "EARTH", "Machine", 8, 2900, 2700, "golem", P("#9aa4b0", "#3a4048", "#ffcf3a", "#fff0b0", "#ff5a3a"),
        "When this card is summoned: destroy 1 Spell/Trap your opponent controls.", "ultra", 1.4,
        effect=eff("summon", "crushes a Spell/Trap", {"op": "destroy_opp_st"})),
    mon("LD-412", "Gearwork Soldier", "EARTH", "Machine", 4, 1600, 1500, "knight", P("#a8b0b8", "#4a5058", "#ffcf3a", "#fff0b0", "#3ad6c8", cloth="#3a4048"),
        "Wind it up once and it marches for a week."),
    mon("LD-413", "Rivet Drone", "LIGHT", "Machine", 3, 1000, 800, "bird", P("#d8e0e8", "#6a7480", "#ffcf3a", "#ffffff", "#ff5a3a", wing="#a8b0b8"),
        "When this card is summoned: add 1 Level 4 or lower Machine monster from your Deck to your hand.",
        effect=eff("summon", "fetches a Machine from the Deck", {"op": "search_deck", "filter": {"max_level": 4, "race": "Machine"}})),
    mon("LD-414", "Steam Sentinel", "EARTH", "Machine", 4, 1300, 2000, "golem", P("#8a7a6a", "#3a3028", "#e0e8f0", "#ffffff", "#ffcf3a"),
        "When this card is destroyed by battle: draw 1 card.", effect=eff("destroyed_by_battle", "vents a card from the Deck", DRAW1)),
    ability(mon("LD-415", "Cannon Walker", "EARTH", "Machine", 6, 2400, 1600, "golem", P("#6a7480", "#262a30", "#ff8a3a", "#ffd0a0", "#ff5a3a"),
                PIERCE, "rare"), piercing=True),
    herald("LD-416", "Iron Herald", "EARTH", "Machine", "knight", P("#c0c8d0", "#5a6068", "#ffcf3a", "#fff0b0", "#3ad6c8", cloth="#4a5058")),
    fusion("LD-F10", "Ironclad Warmaster", "EARTH", "Machine", 8, 2800, 2600, "knight", P("#b0b8c0", "#3a4048", "#ffd86a", "#fff8d0", "#ff5a3a", cloth="#2a3038"),
           ["LD-412", "LD-415"], "Gearwork Soldier + Cannon Walker", PIERCE, piercing=True),
    ascended("LD-A10", "Warmaster Omega", "LD-F10", "Ironclad Warmaster", "EARTH", "Machine", 3500, 3000, "golem",
             P("#d0d8e0", "#4a5058", "#ffd86a", "#ffffff", "#ff3a3a"),
             "Piercing. When summoned: destroy every Spell and Trap your opponent controls.",
             effect=eff("summon", "levels every enemy Spell and Trap", {"op": "destroy_all_opp_st"}), piercing=True),
]
wyrm = [
    ability(mon("LD-421", "Aurora Dragon Emperor", "LIGHT", "Dragon", 8, 3000, 2500, "dragon", P("#f0f4ff", "#9aa8d8", "#ff9bf0", "#ffffff", "#7ae8ff", wing="#c8d8ff"),
                PIERCE, "ultra", 1.45, attack="radiant_beam", summon="grand_portal"), piercing=True),
    mon("LD-422", "Storm Drake", "WIND", "Dragon", 4, 1700, 1300, "dragon", P("#7ab0a0", "#2a4a40", "#fff07a", "#ffffd0", "#ffe14a", wing="#4a8a78"),
        "It sleeps inside thunderclouds and wakes hungry."),
    mon("LD-423", "Ember Wyrmling", "FIRE", "Dragon", 3, 1200, 900, "dragon", P("#ff7a3a", "#8a2a10", "#ffe07a", "#fff0b0", "#3a1a08", wing="#e2502a"),
        "When this card is summoned: add 1 Level 4 or lower Dragon monster from your Deck to your hand.", scale=0.8,
        effect=eff("summon", "calls a Dragon from the Deck", {"op": "search_deck", "filter": {"max_level": 4, "race": "Dragon"}})),
    mon("LD-424", "Frost Wyvern", "WATER", "Dragon", 5, 2000, 1700, "dragon", P("#b8e8ff", "#4a88b0", "#ffffff", "#ffffff", "#1e5ab8", wing="#8ad0f0"),
        "Its breath freezes waterfalls in mid-fall."),
    herald("LD-425", "Dragon Herald", "LIGHT", "Warrior", "knight", P("#f0d8a0", "#a0784a", "#ff7a3a", "#fff0b0", "#2b9bff", cloth="#b83a2a")),
    mon("LD-426", "Scale Guardian", "EARTH", "Dragon", 4, 1200, 2000, "dragon", P("#a89a6a", "#4a4028", "#c8e06a", "#f0ffb0", "#ffb43a", wing="#7a6a40"),
        "During each of your Standby Phases: you gain 500 Life Points.", effect=eff("standby", "restores 500 LP", {"op": "gain_lp", "amount": 500})),
    ability(mon("LD-427", "Thunder Wyrm", "LIGHT", "Dragon", 6, 2300, 1800, "dragon", P("#fff4a8", "#b09a3a", "#7ae8ff", "#ffffff", "#2b9bff", wing="#f0d870"),
                DOUBLE, "rare", 1.1), double_attack=True),
    fusion("LD-F11", "Prism Dragon Overlord", "LIGHT", "Dragon", 8, 3000, 2400, "dragon", P("#f8f0ff", "#a89ad8", "#7ae8ff", "#ffffff", "#ff5ad8", wing="#e0d0ff"),
           ["LD-422", "LD-424"], "Storm Drake + Frost Wyvern", "When Fusion Summoned: draw 1 card.", effect=eff("summon", "draws 1 card", DRAW1)),
    ascended("LD-A11", "Prism Dragon Ascendant", "LD-F11", "Prism Dragon Overlord", "LIGHT", "Dragon", 3600, 3000, "dragon",
             P("#ffffff", "#c0b8e8", "#7ae8ff", "#ffffff", "#ff5ad8", wing="#f0e8ff"),
             "When summoned: destroy the monster your opponent controls with the highest ATK.",
             effect=eff("summon", "erases the strongest enemy", {"op": "destroy_strongest_opp"}), scale=1.45),
]
spirit = [
    mon("LD-431", "Lantern Wraith King", "DARK", "Zombie", 8, 2800, 2400, "knight", P("#3a3a4a", "#121218", "#9fffb0", "#e0ffe8", "#7affa0", cloth="#1a2a1a"),
        "When this card is summoned: add 1 monster from your Graveyard to your hand.", "ultra", 1.35,
        effect=eff("summon", "calls a soul back from the Graveyard", {"op": "recover_gy"})),
    mon("LD-432", "Wisp Lantern", "LIGHT", "Fairy", 2, 600, 1000, "fairy", P("#f0ffe0", "#9ac080", "#9fffb0", "#ffffff", "#2a8f6a", wing="#d8ffc8"),
        "When this card is destroyed by battle: draw 1 card.", scale=0.8, effect=eff("destroyed_by_battle", "leaves a card behind", DRAW1)),
    mon("LD-433", "Bone Sentry", "DARK", "Zombie", 4, 1600, 1200, "knight", P("#d8d0c0", "#6a6050", "#9fffb0", "#e0ffe8", "#7affa0", cloth="#2a2a2a"),
        "It has guarded the same crypt door for four hundred years and never once asked to sit down."),
    mon("LD-434", "Restless Shade", "DARK", "Zombie", 3, 1100, 800, "imp", P("#4a4a5a", "#18181e", "#9fffb0", "#e0ffe8", "#7affa0", wing="#2a2a38"),
        "When this card is summoned: add 1 monster from your Graveyard to your hand.",
        effect=eff("summon", "drags a monster back from the Graveyard", {"op": "recover_gy"})),
    mon("LD-435", "Gravebloom Fairy", "LIGHT", "Fairy", 4, 1200, 1600, "fairy", P("#f8e8ff", "#b09ac0", "#9fffb0", "#ffffff", "#7a3aa8", wing="#e8d0ff"),
        "During each of your Standby Phases: you gain 500 Life Points.", effect=eff("standby", "restores 500 LP", {"op": "gain_lp", "amount": 500})),
    herald("LD-436", "Spirit Herald", "DARK", "Zombie", "sorcerer", P("#3a4a3a", "#141c14", "#9fffb0", "#e0ffe8", "#7affa0", cloth="#1a2a1a", skin="#c8d8c0")),
    mon("LD-437", "Crypt Colossus", "DARK", "Zombie", 6, 2300, 2000, "golem", P("#5a5a4a", "#20201a", "#9fffb0", "#e0ffe8", "#7affa0"),
        "When this card is destroyed by battle: Special Summon 1 DARK monster with 1500 or less ATK from your Deck.", "rare",
        effect=eff("destroyed_by_battle", "raises another body", {"op": "special_from_deck", "filter": {"max_atk": 1500, "attribute": "DARK"}})),
    fusion("LD-F12", "Phantom Choir Conductor", "DARK", "Spellcaster", 7, 2600, 2300, "sorcerer", P("#2a2a3a", "#0e0e14", "#9fffb0", "#e0ffe8", "#7affa0", cloth="#2a3a2a", skin="#d8e8d0"),
           ["LD-433", "LD-435"], "Bone Sentry + Gravebloom Fairy", "When Fusion Summoned: add 1 monster from your Graveyard to your hand.",
           effect=eff("summon", "summons a soul back to the hand", {"op": "recover_gy"})),
    ascended("LD-A12", "Choir of the Hollow Moon", "LD-F12", "Phantom Choir Conductor", "DARK", "Spellcaster", 3300, 2900, "sorcerer",
             P("#1a1a2a", "#06060c", "#9fffb0", "#ffffff", "#7affa0", cloth="#2a4a2a", skin="#e0f0e0"),
             "When summoned: Special Summon the monster with the highest ATK from your Graveyard.",
             effect=eff("summon", "raises the strongest fallen monster", {"op": "revive_best"})),
]
jester = [
    mon("LD-441", "Harlequin of a Thousand Masks", "DARK", "Fiend", 7, 2600, 2100, "imp", P("#3a1a3a", "#140814", "#ff5a8a", "#ffd0e0", "#ffcf3a", wing="#5a1a3a"),
        "When this card is summoned: return the monster your opponent controls with the highest ATK to the hand.", "ultra", 1.6,
        effect=eff("summon", "makes their strongest monster vanish", {"op": "bounce_strongest_opp"})),
    mon("LD-442", "Prank Imp", "DARK", "Fiend", 3, 1000, 900, "imp", P("#6a2a4a", "#2a0e1e", "#ffcf3a", "#fff0b0", "#ff3a8a", wing="#4a1a30"),
        "When this card is summoned: add 1 Trap from your Deck to your hand.",
        effect=eff("summon", "slips a Trap into your hand", {"op": "search_deck", "filter": {"card_type": "trap"}})),
    ability(mon("LD-443", "Mask Dancer", "DARK", "Spellcaster", 4, 1500, 1300, "sorcerer", P("#4a1a3a", "#1a0814", "#ffcf3a", "#fff0b0", "#ff5a8a", cloth="#8a1a4a", skin="#f0e0e8"),
                DIRECT), direct_attack=True),
    mon("LD-444", "Juggling Golem", "DARK", "Machine", 4, 1400, 1600, "golem", P("#7a3a5a", "#2e1020", "#ffcf3a", "#fff0b0", "#3ad6c8"),
        "When this card is destroyed by battle: inflict 600 damage to your opponent.",
        effect=eff("destroyed_by_battle", "drops its pins on the opponent for 600", {"op": "damage_opponent", "amount": 600})),
    herald("LD-445", "Jester Herald", "DARK", "Fiend", "imp", P("#5a1a4a", "#200a1a", "#ffcf3a", "#fff0b0", "#ff5a8a", wing="#3a0e2a")),
    mon("LD-446", "Puppet Box Mimic", "DARK", "Fiend", 3, 700, 1500, "imp", P("#8a5a3a", "#3a2414", "#ff5a8a", "#ffd0e0", "#ffcf3a", wing="#5a3a24"),
        "FLIP: Return the monster your opponent controls with the highest ATK to the hand.",
        effect=eff("flip", "springs out and boxes up their strongest monster", {"op": "bounce_strongest_opp"})),
    ability(fusion("LD-F13", "Carnival Phantom", "DARK", "Fiend", 7, 2600, 2000, "imp", P("#2a0a2a", "#0e040e", "#ff5a8a", "#ffd0e0", "#ffcf3a", wing="#4a0a3a"),
                   ["LD-442", "LD-443"], "Prank Imp + Mask Dancer", DIRECT), direct_attack=True),
    ascended("LD-A13", "Carnival King Ascendant", "LD-F13", "Carnival Phantom", "DARK", "Fiend", 3200, 2800, "imp",
             P("#3a0a3a", "#120412", "#ffd86a", "#ffffff", "#ff3a8a", wing="#6a0a4a"),
             "Can attack directly. When summoned: destroy every Spell and Trap your opponent controls.",
             effect=eff("summon", "tears down every enemy Spell and Trap", {"op": "destroy_all_opp_st"}), scale=1.7, direct_attack=True),
]
arcana = [
    mon("LD-451", "Archmage of the Silver Tower", "LIGHT", "Spellcaster", 8, 2800, 2500, "sorcerer", P("#e8f0ff", "#8a9ac0", "#9fd8ff", "#ffffff", "#2b9bff", cloth="#3a5aa8", skin="#f0e0d8"),
        "When this card is summoned: add 1 Spell from your Deck to your hand.", "ultra", 1.35,
        effect=eff("summon", "summons a Spell from the library", {"op": "search_deck", "filter": {"card_type": "spell"}})),
    mon("LD-452", "Starlit Apprentice", "LIGHT", "Spellcaster", 3, 1000, 1200, "sorcerer", P("#f0f0ff", "#9a9ac0", "#ffd86a", "#ffffff", "#5a3aa8", cloth="#5a6ab8", skin="#f0e0d8"),
        "When this card is summoned: add 1 Spell from your Deck to your hand.",
        effect=eff("summon", "borrows a Spell from the library", {"op": "search_deck", "filter": {"card_type": "spell"}})),
    mon("LD-453", "Runic Golem", "LIGHT", "Rock", 4, 1400, 1900, "golem", P("#c8d0e0", "#5a6070", "#9fd8ff", "#ffffff", "#2b9bff"),
        "Every rune on its body is a spell that someone forgot to finish."),
    mon("LD-454", "Glyph Knight", "LIGHT", "Warrior", 4, 1700, 1200, "knight", P("#e0e8f8", "#7a8aa8", "#9fd8ff", "#ffffff", "#2b9bff", cloth="#3a5aa8"),
        "Its sword is a single glowing word of power."),
    mon("LD-455", "Owl Familiar", "LIGHT", "Winged Beast", 2, 700, 700, "bird", P("#e8d8b8", "#8a7a5a", "#9fd8ff", "#ffffff", "#ffcf3a", wing="#b8a888"),
        "During each of your Standby Phases: draw 1 card.", scale=0.8, effect=eff("standby", "brings you an extra card", DRAW1)),
    herald("LD-456", "Arcana Herald", "LIGHT", "Spellcaster", "sorcerer", P("#f0f8ff", "#9ab0d0", "#ffd86a", "#ffffff", "#2b9bff", cloth="#5a7ac8", skin="#f0e0d8")),
    mon("LD-457", "Tome Guardian", "LIGHT", "Spellcaster", 6, 2200, 2000, "sorcerer", P("#d8d0e8", "#6a6080", "#ffd86a", "#ffffff", "#5a3aa8", cloth="#4a3a8a", skin="#e8d8d0"),
        "When this card is destroyed by battle: add 1 Spell from your Deck to your hand.", "rare",
        effect=eff("destroyed_by_battle", "leaves a Spell behind", {"op": "search_deck", "filter": {"card_type": "spell"}})),
    fusion("LD-F14", "Grand Arcanist", "LIGHT", "Spellcaster", 7, 2600, 2400, "sorcerer", P("#f0f4ff", "#8a9ac8", "#9fd8ff", "#ffffff", "#ffcf3a", cloth="#2a4a9a", skin="#f0e0d8"),
           ["LD-453", "LD-454"], "Runic Golem + Glyph Knight", "When Fusion Summoned: draw 2 cards.", effect=eff("summon", "draws 2 cards", {"op": "draw", "count": 2})),
    ascended("LD-A14", "Arcanist Ascendant", "LD-F14", "Grand Arcanist", "LIGHT", "Spellcaster", 3300, 3000, "sorcerer",
             P("#ffffff", "#a8b8e0", "#9fd8ff", "#ffffff", "#ffcf3a", cloth="#1a3a9a", skin="#f8e8e0"),
             "When summoned: add 1 Spell from your Deck to your hand, then draw 1 card.",
             effect=eff("summon", "opens the whole library", {"op": "search_deck", "filter": {"card_type": "spell"}}, DRAW1)),
]

new_spells = [
    spell("LD-129", "Second Wind", "normal", "Add 1 monster from your Graveyard to your hand.", [{"op": "recover_gy"}], "revive", "light", "#0a3a2a", "#9fffc4"),
    spell("LD-130", "Riptide Recall", "normal", "Return the monster your opponent controls with the highest ATK to its owner's hand. (Limited: 1 per deck.)",
          [{"op": "bounce_strongest_opp"}], "squall", "water", "#0a2a4a", "#7ad8ff", "rare", limit=1),
    spell("LD-131", "Spellbook Search", "normal", "Add 1 Spell from your Deck to your hand.",
          [{"op": "search_deck", "filter": {"card_type": "spell"}}], "lantern", "light", "#1a1a4a", "#9fd8ff"),
    spell("LD-132", "Gale Peaks", "field", "All WIND monsters gain 400 ATK and 200 DEF.",
          [{"op": "field", "env": "frost", "modifiers": [{"attribute": "WIND", "atk": 400, "def": 200}]}], "field", "wind", "#1a3a4a", "#bff7ef", "rare"),
    spell("LD-133", "Iron Foundry", "field", "All Machine monsters gain 400 ATK and 300 DEF.",
          [{"op": "field", "env": "neon", "modifiers": [{"race": "Machine", "atk": 400, "def": 300}]}], "field", "fire", "#2a1a0a", "#ffb347", "rare"),
]
# The summon chain: Rally Captain fetches Rally Call, which calls two monsters, which Grand Offering turns into your ace.
combo_cards = [
    mon("LD-337", "Rally Captain", "LIGHT", "Warrior", 4, 1500, 1200, "knight", P("#f0e0b0", "#9a7a4a", "#ff7a3a", "#fff0b0", "#2b9bff", cloth="#2a4a9a"),
        "When this card is summoned: add 1 combo Spell (Rally Call or Grand Offering) from your Deck to your hand.", "rare",
        effect=eff("summon", "sounds the rally and fetches a combo Spell", {"op": "search_deck", "filter": {"card_type": "spell", "combo": True}})),
    dict(spell("LD-135", "Rally Call", "normal", "Combo Spell. Special Summon 2 Level 4 or lower monsters with different names from your Deck. They can't attack this turn.",
               [{"op": "special_two_from_deck", "count": 2, "filter": {"max_level": 4}}], "champion", "light", "#2a1a0a", "#ffb34a", "rare"), combo=True),
    dict(spell("LD-136", "Grand Offering", "normal", "Combo Spell. Tribute your 2 weakest monsters: Special Summon 1 Level 7 or higher monster from your hand or Deck.",
               [{"op": "tribute_for_best"}], "crown", "fire", "#3a0a0a", "#ffd86a", "ultra"), combo=True),
    spell("LD-134", "Silence Field", "continuous", "Continuous: for your opponent's next 3 turns, they can't activate Trap cards.",
          [{"op": "lock_traps", "turns": 3}], "barrier", "barrier", "#0a1a3a", "#9fb8ff", "rare"),
]

new_traps = [
    trap("LD-218", "Seal Breaker", "counter", "opp_trap", "Counter Trap: when your opponent activates a Trap: pay 500 LP; negate it and destroy it.",
         [{"op": "pay_lp", "amount": 500}, {"op": "negate_spell"}], "null_seal", "barrier", "#2a0a1a", "#ff8ab0", "rare", cost_lp=500),
    trap("LD-219", "Grand Seal", "counter", ["opp_spell", "opp_trap"], "Counter Trap: when your opponent activates a Spell or Trap: pay 1500 LP; negate it and destroy it.",
         [{"op": "pay_lp", "amount": 1500}, {"op": "negate_spell"}], "null_seal", "barrier", "#1a0a2a", "#e0a0ff", "ultra", cost_lp=1500),
    trap("LD-220", "Arcane Gag", "continuous", "any", "Continuous Trap (usable on your turn too): for your opponent's next 3 turns, they can't activate Spell cards.",
         [{"op": "lock_spells", "turns": 3}], "null_seal", "energy", "#0a2a2a", "#7af0d8", "rare"),
    trap("LD-215", "Recoil Gate", "normal", "opp_attack", "When an opponent's monster declares an attack: return it to its owner's hand. The attack is stopped.",
         [{"op": "bounce_attacker"}], "barrier", "barrier", "#0a2a3a", "#9fe8ff"),
    trap("LD-216", "Treasure Cache", "normal", "any", "Can be activated whenever your opponent attacks, summons, or activates a Spell: draw 2 cards. (Limited: 1 per deck.)",
         [{"op": "draw", "count": 2}], "draw", "light", "#3a2a0a", "#ffd86a", "rare", limit=1),
    trap("LD-217", "Soul Siphon", "normal", "opp_attack", "When an opponent's monster declares an attack: you gain Life Points equal to its ATK.",
         [{"op": "gain_attacker_atk"}], "echo_chamber", "energy", "#0a3a1a", "#9fffb0"),
]

DUELISTS = {
    "storm": ("Skyward Gale", "Fast fliers that strike twice or go straight for your Life Points.", "LD-401",
              {"name": "Aria Volante", "title": "The Wind Courier", "role": "friend", "color": "#7ef0d8"}),
    "iron": ("Iron Legion", "Machines that grind through Defense and tear down your Spells and Traps.", "LD-411",
             {"name": "Rhea Steele", "title": "The Iron Captain", "role": "hero", "color": "#c8d0dc"}),
    "wyrm": ("Dragon Pact", "Dragons of every element, led by an emperor who pierces any defense.", "LD-421",
             {"name": "Sora Ryujin", "title": "The Dragon Tamer", "role": "rival", "color": "#ffb347"}),
    "spirit": ("Lantern Requiem", "The dead never stay down: recover, revive and outlast.", "LD-431",
               {"name": "Old Man Hollow", "title": "The Lantern Keeper", "role": "villain", "color": "#9fffb0"}),
    "jester": ("Masquerade", "Tricks and Traps: bounce your strongest monster and strike from nowhere.", "LD-441",
               {"name": "The Grinning Jester", "title": "Master of Tricks", "role": "villain", "color": "#ff5a8a"}),
    "arcana": ("Silver Tower", "A library of Spells: search, draw, and out-think the opponent.", "LD-451",
               {"name": "Lumen Vale", "title": "The Spellbound Scholar", "role": "friend", "color": "#9fd8ff"}),
}

# Every deck: (monsters, spells, traps) and priority-ordered pools. Earlier entries are kept first.
RATIO = {"radiant": (22, 16, 12), "void": (18, 22, 10), "ember": (30, 14, 6), "tides": (20, 12, 18),
         "stone": (28, 10, 12), "umbral": (20, 10, 20), "crystal": (16, 12, 22), "vault": (22, 20, 8),
         "storm": (26, 16, 8), "iron": (24, 18, 8), "wyrm": (28, 14, 8), "spirit": (20, 16, 14),
         "jester": (18, 12, 20), "arcana": (18, 24, 8)}

COMBO_SPELLS = [("LD-135", 2), ("LD-136", 2), ("LD-106", 2), ("LD-128", 1), ("LD-127", 1)]
GEN_SPELLS = [("LD-101", 1), ("LD-104", 1), ("LD-129", 2), ("LD-124", 1), ("LD-125", 1), ("LD-103", 1), ("LD-131", 2),
              ("LD-134", 1), ("LD-121", 2), ("LD-123", 2), ("LD-126", 2), ("LD-122", 2), ("LD-105", 1), ("LD-130", 1), ("LD-102", 1)]
COMBO_TRAPS = [("LD-213", 2), ("LD-214", 1)]
GEN_TRAPS = [("LD-216", 1), ("LD-211", 2), ("LD-218", 1), ("LD-219", 1), ("LD-220", 1), ("LD-202", 2), ("LD-203", 2), ("LD-204", 2), ("LD-212", 2), ("LD-215", 2),
             ("LD-217", 2), ("LD-201", 1)]

POOLS = {
    "radiant": ([("LD-001", 2), ("LD-002", 3), ("LD-003", 3), ("LD-321", 3), ("LD-301", 3), ("LD-302", 2), ("LD-331", 2), ("LD-303", 2), ("LD-034", 2), ("LD-005", 2), ("LD-004", 2)],
                [("LD-109", 2)], []),
    "void": ([("LD-007", 3), ("LD-011", 3), ("LD-322", 3), ("LD-305", 3), ("LD-012", 2), ("LD-304", 2), ("LD-331", 2), ("LD-010", 2), ("LD-008", 2)],
             [("LD-110", 2), ("LD-131", 3), ("LD-107", 1)], [("LD-211", 3)]),
    "ember": ([("LD-013", 2), ("LD-006", 3), ("LD-015", 3), ("LD-323", 3), ("LD-306", 3), ("LD-307", 3), ("LD-318", 3), ("LD-014", 3), ("LD-016", 3), ("LD-017", 3), ("LD-333", 3)],
              [("LD-108", 3), ("LD-121", 3), ("LD-123", 3)], [("LD-203", 2)]),
    "tides": ([("LD-018", 2), ("LD-021", 3), ("LD-022", 3), ("LD-324", 3), ("LD-308", 3), ("LD-335", 2), ("LD-336", 2), ("LD-309", 2), ("LD-319", 2), ("LD-019", 2), ("LD-020", 2)],
              [("LD-107", 3), ("LD-130", 1)], [("LD-215", 3), ("LD-217", 2), ("LD-203", 3)]),
    "stone": ([("LD-023", 2), ("LD-024", 3), ("LD-025", 3), ("LD-325", 3), ("LD-311", 3), ("LD-310", 3), ("LD-330", 2), ("LD-320", 3), ("LD-333", 2), ("LD-027", 2), ("LD-004", 3), ("LD-026", 2), ("LD-019", 2)],
              [("LD-111", 3), ("LD-122", 2)], [("LD-203", 3), ("LD-212", 2)]),
    "umbral": ([("LD-028", 2), ("LD-030", 3), ("LD-032", 3), ("LD-326", 3), ("LD-312", 3), ("LD-313", 2), ("LD-332", 2), ("LD-029", 2), ("LD-304", 2), ("LD-031", 2)],
               [("LD-110", 2), ("LD-134", 1)], [("LD-219", 1), ("LD-211", 3), ("LD-217", 2), ("LD-202", 3), ("LD-204", 3)]),
    "crystal": ([("LD-033", 2), ("LD-034", 3), ("LD-036", 3), ("LD-327", 3), ("LD-314", 3), ("LD-315", 2), ("LD-332", 2), ("LD-302", 2), ("LD-005", 2), ("LD-035", 2)],
                [("LD-109", 2)], [("LD-219", 2), ("LD-218", 2), ("LD-220", 2), ("LD-203", 3), ("LD-202", 3), ("LD-204", 3), ("LD-211", 3), ("LD-212", 3), ("LD-215", 3)]),
    "vault": ([("LD-037", 2), ("LD-039", 3), ("LD-040", 3), ("LD-328", 3), ("LD-316", 3), ("LD-317", 3), ("LD-330", 2), ("LD-038", 2), ("LD-305", 2), ("LD-304", 2), ("LD-010", 2)],
              [("LD-133", 2), ("LD-131", 2), ("LD-121", 2)], []),
    "storm": ([("LD-401", 2), ("LD-402", 3), ("LD-405", 3), ("LD-406", 3), ("LD-403", 3), ("LD-404", 3), ("LD-329", 2), ("LD-407", 2), ("LD-003", 3), ("LD-017", 2), ("LD-021", 2)],
              [("LD-132", 3), ("LD-123", 3)], []),
    "iron": ([("LD-411", 2), ("LD-412", 3), ("LD-415", 3), ("LD-416", 3), ("LD-413", 3), ("LD-414", 3), ("LD-333", 2), ("LD-316", 2), ("LD-038", 2), ("LD-317", 2)],
             [("LD-133", 3), ("LD-122", 3), ("LD-121", 2)], [("LD-212", 2)]),
    "wyrm": ([("LD-421", 2), ("LD-422", 3), ("LD-424", 3), ("LD-425", 3), ("LD-423", 3), ("LD-427", 2), ("LD-426", 3), ("LD-006", 2), ("LD-012", 2), ("LD-027", 2), ("LD-014", 2), ("LD-029", 1)],
             [("LD-109", 2), ("LD-121", 2)], []),
    "spirit": ([("LD-431", 2), ("LD-433", 3), ("LD-435", 3), ("LD-436", 3), ("LD-434", 3), ("LD-437", 2), ("LD-432", 2), ("LD-330", 2), ("LD-010", 2), ("LD-030", 1)],
               [("LD-110", 2), ("LD-129", 3)], [("LD-214", 2), ("LD-217", 3)]),
    "jester": ([("LD-441", 2), ("LD-442", 3), ("LD-443", 3), ("LD-445", 3), ("LD-446", 2), ("LD-444", 2), ("LD-334", 2), ("LD-332", 1)],
               [("LD-110", 1), ("LD-130", 1), ("LD-134", 1)], [("LD-218", 2), ("LD-220", 2), ("LD-215", 3), ("LD-211", 3), ("LD-212", 3), ("LD-204", 3), ("LD-202", 3)]),
    "arcana": ([("LD-451", 2), ("LD-453", 3), ("LD-454", 3), ("LD-456", 3), ("LD-452", 3), ("LD-455", 2), ("LD-457", 2), ("LD-331", 2)],
               [("LD-131", 3), ("LD-109", 2), ("LD-121", 2), ("LD-123", 2), ("LD-126", 2), ("LD-122", 2)], []),
}
EXTRA = {"storm": ["LD-F09", "LD-F09", "LD-A09"], "iron": ["LD-F10", "LD-F10", "LD-A10"], "wyrm": ["LD-F11", "LD-F11", "LD-A11"],
         "spirit": ["LD-F12", "LD-F12", "LD-A12"], "jester": ["LD-F13", "LD-F13", "LD-A13"], "arcana": ["LD-F14", "LD-F14", "LD-A14"]}


def fill(entries, target, db):
    """Take entries in priority order (merging repeats), then top up earlier entries until target is reached."""
    order, want = [], {}
    for cid, n in entries:
        if cid not in want:
            order.append(cid)
            want[cid] = 0
        want[cid] = max(want[cid], n)
    out = collections.Counter()
    for cid in order:
        room = target - sum(out.values())
        if room <= 0:
            break
        out[cid] = min(want[cid], db[cid].get("limit", 3), room)
    while sum(out.values()) < target:
        grew = False
        for cid in order:
            if sum(out.values()) >= target:
                break
            if out[cid] < db[cid].get("limit", 3):
                out[cid] += 1
                grew = True
        assert grew, ("pool too small", target)
    return out


def with_captain(pools):
    for did, (mons, sp, tr) in pools.items():
        if not any(c == "LD-337" for c, _ in mons):
            mons.insert(1, ("LD-337", 2))
    return pools


def main():
    with_captain(POOLS)
    data = json.load(open(CARDS, encoding="utf-8"))
    new = {c["id"]: c for c in generic + storm + iron + wyrm + spirit + jester + arcana + new_spells + combo_cards + new_traps}
    data["cards"] = [c for c in data["cards"] if c["id"] not in new] + list(new.values())
    json.dump(data, open(CARDS, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    db = {c["id"]: c for c in data["cards"]}

    decks = json.load(open(DECKS, encoding="utf-8"))
    by_id = {d["id"]: d for d in decks["decks"]}
    for did, (name, desc, sig, duelist) in DUELISTS.items():
        by_id[did] = {"id": did, "name": name, "description": desc, "signature": sig, "main": [], "extra": EXTRA[did], "duelist": duelist}
    for did, d in by_id.items():
        m, s, t = RATIO[did]
        mons, spells, traps = POOLS[did]
        counts = fill(mons, m, db) + fill(COMBO_SPELLS + spells + GEN_SPELLS, s, db) + fill(COMBO_TRAPS + traps + GEN_TRAPS, t, db)
        main = [c for c, n in counts.items() for _ in range(n)]
        assert len(main) == 50, (did, len(main))
        assert d["signature"] in counts
        for fx in d["extra"]:
            for mat in db[fx].get("materials", []):
                assert counts[mat] >= 2, (did, mat)
        d["main"] = main
        types = collections.Counter(db[c]["type"] for c in main)
        print(f"{did:8} {types['monster']:2} M {types['spell']:2} S {types['trap']:2} T  extra {d['extra']}")
    decks["decks"] = list(by_id.values())
    json.dump(decks, open(DECKS, "w", encoding="utf-8"), indent=2, ensure_ascii=False)


if __name__ == "__main__":
    main()
