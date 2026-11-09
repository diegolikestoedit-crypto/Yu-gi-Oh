"""One-off content script: ten more duelists (3 heroes, 3 friends, 3 villains and one wildcard: a tiny,
harmless-looking deck that is secretly the strongest), built from ability templates. Run after add_roster3.py
(it applies that script's setup, adds these decks, and rebuilds all 24)."""
import add_roster2 as R
import add_roster3 as R3
from add_technical import P, eff, mon  # noqa: F401

DRAW1 = {"op": "draw", "count": 1}

# Ability templates: key -> (rules text, effect, flags)
ABIL = {
    "draw_summon": ("When this card is summoned: draw 1 card.", eff("summon", "draws a card", DRAW1), {}),
    "draw2_summon": ("When this card is summoned: draw 2 cards.", eff("summon", "draws 2 cards", {"op": "draw", "count": 2}), {}),
    "standby_draw": ("During each of your Standby Phases: draw 1 card.", eff("standby", "brings an extra card", DRAW1), {}),
    "standby_heal": ("During each of your Standby Phases: you gain 500 Life Points.", eff("standby", "restores 500 LP", {"op": "gain_lp", "amount": 500}), {}),
    "pierce": ("Piercing: inflicts battle damage through Defense Position monsters.", None, {"piercing": True}),
    "double": ("Can attack twice each Battle Phase.", None, {"double_attack": True}),
    "direct": ("Can attack your opponent directly even while they control monsters.", None, {"direct_attack": True}),
    "wall": ("Cannot be destroyed by battle.", None, {"battle_indestructible": True}),
    "bounce": ("When this card is summoned: return the monster your opponent controls with the highest ATK to the hand.",
               eff("summon", "sends their strongest monster away", {"op": "bounce_strongest_opp"}), {}),
    "destroy_st": ("When this card is summoned: destroy 1 Spell/Trap your opponent controls.", eff("summon", "breaks a Spell/Trap", {"op": "destroy_opp_st"}), {}),
    "destroy_strong": ("When this card is summoned: destroy the monster your opponent controls with the highest ATK.",
                       eff("summon", "destroys the strongest enemy", {"op": "destroy_strongest_opp"}), {}),
    "flip_destroy": ("FLIP: Destroy the monster your opponent controls with the highest ATK.", eff("flip", "destroys the strongest enemy", {"op": "destroy_strongest_opp"}), {}),
    "burn": ("When this card is summoned: inflict 500 damage to your opponent.", eff("summon", "burns for 500", {"op": "damage_opponent", "amount": 500}), {}),
    "burn_death": ("When this card is destroyed by battle: inflict 800 damage to your opponent.",
                   eff("destroyed_by_battle", "curses the opponent for 800", {"op": "damage_opponent", "amount": 800}), {}),
    "recover": ("When this card is summoned: add 1 monster from your Graveyard to your hand.", eff("summon", "recovers a monster", {"op": "recover_gy"}), {}),
    "kill_draw": ("When this card destroys a monster by battle: draw 1 card.", eff("destroys_by_battle", "draws after a kill", DRAW1), {}),
    "gy_atk": ("Gains 200 ATK for each monster in your Graveyard.", None, {"atk_per_gy": 200}),
    "search_spell": ("When this card is summoned: add 1 Spell from your Deck to your hand.",
                     eff("summon", "fetches a Spell", {"op": "search_deck", "filter": {"card_type": "spell"}}), {}),
    "search_trap": ("When this card is summoned: add 1 Trap from your Deck to your hand.",
                    eff("summon", "fetches a Trap", {"op": "search_deck", "filter": {"card_type": "trap"}}), {}),
    "death_call": ("When this card is destroyed by battle: Special Summon 1 monster with 1500 or less ATK from your Deck.",
                   eff("destroyed_by_battle", "calls a replacement", {"op": "special_from_deck", "filter": {"max_atk": 1500}}), {}),
    "champion": ("When this card is summoned: Special Summon your strongest Level 7 or higher monster from your Deck. It can't attack this turn.",
                 eff("summon", "calls the strongest champion from the Deck", {"op": "summon_best_from_deck", "filter": {"min_level": 7}}), {}),
    "all_st": ("When summoned: destroy every Spell and Trap your opponent controls.", eff("summon", "clears every enemy Spell and Trap", {"op": "destroy_all_opp_st"}), {}),
    "revive": ("When summoned: Special Summon the monster with the highest ATK from your Graveyard.", eff("summon", "raises the strongest fallen monster", {"op": "revive_best"}), {}),
}
AMBUSH_ATTACK = {"trigger": "opp_attack", "position": "def", "label": "leaps from the hand to take the hit", "ops": [{"op": "redirect_attack"}]}


def card(cid, name, attr, race, lv, atk, df, rig, pal, abil=(), flavor="", rarity="common", scale=1.0, ambush=False, **kw):
    texts, effect, flags = [], None, {}
    for key in abil:
        t, e, f = ABIL[key]
        texts.append(t)
        effect = effect or e
        flags.update(f)
    if ambush:
        texts.insert(0, "When an opponent's monster declares an attack: you can Special Summon this card from your hand in Defense Position; the attack is redirected to it.")
    c = mon(cid, name, attr, race, lv, atk, df, rig, pal, " ".join(texts) or flavor, rarity, scale, effect=effect, **kw)
    c.update(flags)
    if ambush:
        c["hand_trigger"] = AMBUSH_ATTACK
    if (flags or ambush) and c["subtype"] == "normal":
        c["subtype"] = "effect"
    return c


def deck_cards(prefix, n, spec):
    """Signature, six monsters, a Herald, a Level 7+ Fusion of the two materials, and its Ascended form."""
    attr, pal = spec["attr"], spec["pal"]
    ids = [f"LD-{prefix}{i}" for i in range(1, 8)]
    out = []
    for cid, m in zip(ids, spec["mons"]):
        name, race, lv, atk, df, rig, abil = m[:7]
        extra = m[7] if len(m) > 7 else {}
        out.append(card(cid, name, attr if not extra.get("attr") else extra["attr"], race, lv, atk, df, rig, pal(extra.get("tone", 0)), abil,
                        extra.get("flavor", ""), extra.get("rarity", "ultra" if cid == ids[0] else "common"),
                        extra.get("scale", 1.35 if cid == ids[0] else 1.0), ambush=extra.get("ambush", False)))
    h = R.herald(f"LD-{prefix}8", spec["herald"], attr, spec["mons"][1][1], spec["mons"][1][5], pal(1))
    out.append(h)
    fa, fb = ids[1], ids[2]
    fname, frace, flv, fatk, fdf, frig, fabil = spec["fusion"]
    fus = card(f"LD-F{n}", fname, attr, frace, flv, fatk, fdf, frig, pal(2), fabil, rarity="ultra", scale=1.3, fusion=[fa, fb])
    fus["subtype"] = "fusion"
    fus["text"] = f"Fusion (Level 7+): {spec['mons'][1][0]} + {spec['mons'][2][0]}. " + fus["text"]
    out.append(fus)
    aname, arace, aatk, adf, arig, aabil = spec["ascended"]
    asc = card(f"LD-A{n}", aname, attr, arace, 10, aatk, adf, arig, pal(3), aabil, rarity="ultra", scale=1.5, summon="grand_portal")
    asc["subtype"] = "ascended"
    asc["ascends_from"] = fus["id"]
    asc["text"] = f"Ascended (Level 10). Summoned only by Crown of Ascension or Ascension Rite, by offering {fname}. " + asc["text"]
    out.append(asc)
    return out, ids, [fus["id"], fus["id"], asc["id"]]


def pal(body, shade, accent, glow, eye, second):
    """A deck palette; tone shifts which colour leads so each monster reads differently."""
    def f(tone):
        cols = [body, shade, accent, glow, eye]
        if tone == 1:
            cols = [accent, shade, body, glow, eye]
        elif tone == 2:
            cols = [glow, shade, accent, "#ffffff", eye]
        elif tone == 3:
            cols = ["#ffffff", body, accent, "#ffffff", eye]
        return P(*cols, wing=second, cloth=second, fin=second, skin="#f0e0d8")
    return f


DECKS = {
    # ---------------------------------------------------------------- heroes
    "dawnblade": dict(prefix="50", n="15", attr="LIGHT", role="hero", ratio=(24, 16, 10), field="LD-109",
        duelist=("Kai Morrow", "The Dawnblade", "#ffd86a"), name="Dawnblade Order", desc="Knights of the morning: piercing blades and walls that never fall.",
        pal=pal("#f4e2a8", "#9a7a3a", "#ff9a3a", "#fff6d0", "#2b9bff", "#c83a2a"), herald="Dawn Squire",
        mons=[("Sol Paragon, the Dawnblade", "Warrior", 8, 3000, 2500, "knight", ("pierce",)),
              ("Aurora Swordsman", "Warrior", 4, 1800, 1100, "knight", ()),
              ("Morning Shieldbearer", "Warrior", 4, 1300, 2000, "knight", ("wall",), {"tone": 1}),
              ("Lantern Page", "Spellcaster", 3, 1000, 1200, "sorcerer", ("search_spell",)),
              ("Sunrise Griffin", "Winged Beast", 4, 1600, 1200, "bird", ("double",), {"tone": 2}),
              ("Radiant Lancer", "Warrior", 6, 2300, 1700, "knight", ("kill_draw",), {"rarity": "rare"}),
              ("Dawn Sentry", "Warrior", 4, 1000, 2100, "knight", (), {"ambush": True, "tone": 1})],
        fusion=("Dawnblade Champion", "Warrior", 8, 2900, 2400, "knight", ("pierce",)),
        ascended=("Dawnblade Eternal", "Warrior", 3500, 3000, "knight", ("all_st", "pierce"))),
    "starfire": dict(prefix="51", n="16", attr="FIRE", role="hero", ratio=(26, 14, 10), field="LD-108",
        duelist=("Nova Reyes", "The Starfire Pilot", "#ff7a3a"), name="Starfire Squadron", desc="Rocket-fuelled machines that hit fast and burn on the way out.",
        pal=pal("#e8602a", "#6a1a0a", "#ffe07a", "#fff0b0", "#7ae8ff", "#3a4a5a"), herald="Launch Herald",
        mons=[("Starfire Interceptor", "Machine", 8, 2900, 2200, "dragon", ("double",)),
              ("Rocket Lancer", "Machine", 4, 1800, 1000, "knight", ()),
              ("Thruster Golem", "Machine", 4, 1500, 1600, "golem", ("burn",), {"tone": 1}),
              ("Ignition Drone", "Machine", 3, 1100, 800, "bird", ("draw_summon",), {"tone": 2}),
              ("Afterburner Hawk", "Machine", 4, 1600, 900, "bird", ("direct",)),
              ("Meteor Breaker", "Machine", 6, 2400, 1500, "golem", ("burn_death",), {"rarity": "rare"}),
              ("Blast Shield Unit", "Machine", 4, 800, 2000, "golem", (), {"ambush": True, "tone": 1})],
        fusion=("Starfire Vanguard", "Machine", 7, 2800, 2100, "dragon", ("burn",)),
        ascended=("Supernova Vanguard", "Machine", 3400, 2700, "dragon", ("destroy_strong", "double"))),
    "verdant": dict(prefix="52", n="17", attr="EARTH", role="hero", ratio=(22, 14, 14), field="LD-111",
        duelist=("Mina Thorn", "The Forest Warden", "#9ff07a"), name="Verdant Grove", desc="A living forest: it heals every turn and its roots never break.",
        pal=pal("#6aa84a", "#2a4a1a", "#ffd86a", "#e8ffb0", "#ff7a9a", "#8a5a3a"), herald="Seedling Herald",
        mons=[("Elderoak Guardian", "Plant", 8, 2800, 3000, "golem", ("wall",)),
              ("Thornvine Ranger", "Plant", 4, 1700, 1200, "knight", ()),
              ("Mossback Toad", "Plant", 4, 1200, 1800, "serpent", ("standby_heal",), {"tone": 1}),
              ("Bloom Sprite", "Fairy", 3, 900, 1300, "fairy", ("recover",), {"tone": 2}),
              ("Briar Wolf", "Beast", 4, 1600, 1000, "imp", ("pierce",)),
              ("Grove Shaman", "Spellcaster", 6, 2200, 2000, "sorcerer", ("standby_draw",), {"rarity": "rare"}),
              ("Root Snare", "Plant", 3, 600, 1900, "serpent", (), {"ambush": True, "tone": 1})],
        fusion=("Thornwood Colossus", "Plant", 8, 2800, 3000, "golem", ("wall",)),
        ascended=("World Tree Ascendant", "Plant", 3300, 3800, "golem", ("revive", "wall"))),
    # ---------------------------------------------------------------- friends
    "frostbite": dict(prefix="53", n="18", attr="WATER", role="friend", ratio=(22, 16, 12), field="LD-107",
        duelist=("Yuki Frost", "The Ice Skater", "#bff4ff"), name="Frostbite Rink", desc="Graceful ice dancers that freeze attackers and slide past defenses.",
        pal=pal("#c8f0ff", "#4a88b0", "#ffffff", "#ffffff", "#1e5ab8", "#7ad0f0"), herald="Frost Herald",
        mons=[("Glacier Empress Seraphine", "Fairy", 8, 2800, 2600, "fairy", ("bounce",)),
              ("Ice Skater Lynx", "Beast", 4, 1700, 1100, "imp", ()),
              ("Snowdrift Sprite", "Fairy", 4, 1400, 1600, "fairy", ("draw_summon",), {"tone": 1}),
              ("Icicle Imp", "Fiend", 3, 1100, 900, "imp", ("search_trap",), {"tone": 2}),
              ("Arctic Swan", "Winged Beast", 4, 1500, 1200, "bird", ("direct",)),
              ("Frozen Knight", "Warrior", 6, 2200, 2100, "knight", ("wall",), {"rarity": "rare"}),
              ("Ice Wall Golem", "Rock", 4, 500, 2200, "golem", (), {"ambush": True, "tone": 1})],
        fusion=("Aurora Ice Dancer", "Fairy", 7, 2600, 2400, "fairy", ("bounce",)),
        ascended=("Absolute Zero Empress", "Fairy", 3300, 3200, "fairy", ("all_st",))),
    "beastrider": dict(prefix="54", n="19", attr="EARTH", role="friend", ratio=(30, 12, 8), field="LD-111",
        duelist=("Bruno Ferro", "The Beast Rider", "#e0a060"), name="Wild Stampede", desc="A stampede of beasts: lots of monsters, double hits and raw power.",
        pal=pal("#b07a4a", "#4a2a14", "#ffd86a", "#fff0c0", "#3a1a08", "#6a4a2a"), herald="Stampede Herald",
        mons=[("King Tusk, the Mammoth Lord", "Beast", 8, 3000, 2400, "golem", ("double",)),
              ("Saber Lion", "Beast", 4, 1800, 1200, "imp", ()),
              ("Ironhide Rhino", "Beast", 4, 1600, 1500, "golem", ("pierce",), {"tone": 1}),
              ("Scout Ferret", "Beast", 3, 1000, 800, "imp", ("draw_summon",), {"tone": 2}),
              ("Thunder Bison", "Beast", 4, 1700, 1300, "golem", ("kill_draw",)),
              ("Alpha Direwolf", "Beast", 6, 2300, 1600, "imp", ("double",), {"rarity": "rare"}),
              ("Tortoise Guard", "Beast", 4, 700, 2100, "golem", (), {"ambush": True, "tone": 1})],
        fusion=("Stampede Warbeast", "Beast", 8, 2900, 2200, "golem", ("pierce",)),
        ascended=("Primal Stampede Ascendant", "Beast", 3600, 2800, "golem", ("double", "pierce"))),
    "chronos": dict(prefix="55", n="20", attr="LIGHT", role="friend", ratio=(20, 20, 10), field="LD-133",
        duelist=("Elio Quill", "The Clockmaker", "#ffe8a0"), name="Clockwork Hours", desc="Ticking gadgets that draw extra cards every turn and outlast anyone.",
        pal=pal("#e8d8a8", "#7a6a3a", "#7ae8ff", "#fffbe8", "#ff5a3a", "#5a4a3a"), herald="Tick Herald",
        mons=[("Grand Chronomaton", "Machine", 8, 2800, 2800, "golem", ("standby_draw",)),
              ("Pendulum Knight", "Machine", 4, 1700, 1300, "knight", ()),
              ("Gearspring Owl", "Machine", 4, 1300, 1600, "bird", ("standby_draw",), {"tone": 1}),
              ("Cog Apprentice", "Spellcaster", 3, 1000, 1100, "sorcerer", ("search_spell",), {"tone": 2}),
              ("Hourglass Sentinel", "Machine", 4, 1200, 1900, "golem", ("wall",)),
              ("Tempo Mechanist", "Machine", 6, 2200, 1900, "golem", ("draw2_summon",), {"rarity": "rare"}),
              ("Alarm Clock Golem", "Machine", 3, 600, 1800, "golem", (), {"ambush": True, "tone": 1})],
        fusion=("Clocktower Paladin", "Machine", 7, 2700, 2600, "knight", ("standby_draw",)),
        ascended=("Eternity Engine", "Machine", 3300, 3300, "golem", ("draw2_summon",))),
    # ---------------------------------------------------------------- villains
    "plague": dict(prefix="56", n="21", attr="DARK", role="villain", ratio=(20, 12, 18), field="LD-110",
        duelist=("Doctor Vesper", "The Plague Doctor", "#9aff5a"), name="Miasma Ward", desc="Poison and patience: burn their Life Points every turn and wait.",
        pal=pal("#3a4a2a", "#141c0e", "#9aff5a", "#e0ffc0", "#ffcf3a", "#2a2a2a"), herald="Miasma Herald",
        mons=[("Doctor Vesper's Plague Wyrm", "Dragon", 8, 2800, 2300, "dragon", ("burn",)),
              ("Bile Ghoul", "Zombie", 4, 1700, 1000, "knight", ()),
              ("Blight Moth", "Insect", 4, 1400, 1400, "bird", ("burn_death",), {"tone": 1}),
              ("Rot Rat", "Beast", 3, 900, 700, "imp", ("search_trap",), {"tone": 2}),
              ("Fever Shade", "Fiend", 4, 1500, 1100, "imp", ("gy_atk",)),
              ("Plague Bearer", "Zombie", 6, 2200, 1800, "knight", ("burn_death",), {"rarity": "rare"}),
              ("Carrion Crow", "Winged Beast", 3, 800, 1600, "bird", (), {"ambush": True, "tone": 1})],
        fusion=("Pestilence Knight", "Zombie", 7, 2700, 2000, "knight", ("burn",)),
        ascended=("Pandemic Sovereign", "Zombie", 3300, 2800, "knight", ("destroy_strong",))),
    "abyss": dict(prefix="57", n="22", attr="WATER", role="villain", ratio=(24, 10, 16), field="LD-107",
        duelist=("The Drowned King", "Lord of the Sunken Crown", "#3ad6c8"), name="Sunken Court", desc="The drowned never stay down: recover, revive and drag foes under.",
        pal=pal("#1e4a5a", "#0a1a22", "#3ad6c8", "#c8fff4", "#ffd86a", "#2a6a6a"), herald="Drowned Herald",
        mons=[("The Drowned King", "Zombie", 8, 2900, 2500, "knight", ("revive",)),
              ("Barnacle Knight", "Zombie", 4, 1700, 1300, "knight", ()),
              ("Kelp Wraith", "Zombie", 4, 1300, 1500, "serpent", ("recover",), {"tone": 1}),
              ("Lantern Angler", "Fish", 3, 1000, 900, "serpent", ("search_trap",), {"tone": 2}),
              ("Abyssal Eel", "Sea Serpent", 4, 1600, 1000, "serpent", ("gy_atk",)),
              ("Leviathan Husk", "Zombie", 6, 2300, 2000, "serpent", ("death_call",), {"rarity": "rare"}),
              ("Siren Shell", "Aqua", 3, 500, 1900, "fairy", (), {"ambush": True, "tone": 1})],
        fusion=("Admiral of the Deep", "Zombie", 8, 2800, 2400, "knight", ("recover",)),
        ascended=("Abyssal Crown Ascendant", "Zombie", 3400, 3000, "serpent", ("revive",))),
    "obsidian": dict(prefix="58", n="23", attr="DARK", role="villain", ratio=(22, 18, 10), field="LD-110",
        duelist=("Countess Obsidia", "The Glass Tyrant", "#b45cff"), name="Obsidian Throne", desc="Black-glass dragons and sorcery that break every defence.",
        pal=pal("#2a1a3a", "#0a0614", "#b45cff", "#e8c8ff", "#ff3a5a", "#4a2a6a"), herald="Shard Herald",
        mons=[("Obsidian Tyrant Dragon", "Dragon", 8, 3000, 2400, "dragon", ("destroy_strong",)),
              ("Glass Knight", "Warrior", 4, 1800, 1100, "knight", ()),
              ("Shard Witch", "Spellcaster", 4, 1400, 1300, "sorcerer", ("destroy_st",), {"tone": 1}),
              ("Prism Bat", "Fiend", 3, 1000, 800, "imp", ("search_spell",), {"tone": 2}),
              ("Onyx Drake", "Dragon", 4, 1700, 1200, "dragon", ("pierce",)),
              ("Mirrorblade Duelist", "Warrior", 6, 2300, 1800, "knight", ("double",), {"rarity": "rare"}),
              ("Black Glass Golem", "Rock", 4, 800, 2100, "golem", (), {"ambush": True, "tone": 1})],
        fusion=("Obsidian Matriarch", "Spellcaster", 8, 2900, 2400, "sorcerer", ("destroy_st",)),
        ascended=("Obsidia, Empress Ascendant", "Spellcaster", 3500, 2900, "sorcerer", ("all_st", "pierce"))),
    # ---------------------------------------------------------------- wildcard: sounds flimsy, plays like a final boss
    "first": dict(prefix="59", n="24", attr="LIGHT", role="wildcard", ratio=(26, 16, 8), field="LD-109",
        duelist=("Pip", "The Smallest Duelist", "#ffb0d8"), name="My First Deck", desc="Crayons, a pebble and a duckling... and somehow it wins every time.",
        pal=pal("#ffe8f4", "#c8a0b8", "#7ae8ff", "#ffffff", "#ff5ab0", "#ffd86a"), herald="Nursery Herald",
        mons=[("Pip-Pip, the Tiny Monarch", "Fairy", 1, 500, 500, "fairy", ("champion",), {"scale": 0.9}),
              ("Pebble Sprout", "Plant", 1, 100, 100, "imp", ("wall",), {"scale": 0.7}),
              ("Fuzzy Duckling", "Winged Beast", 1, 200, 200, "bird", ("standby_draw",), {"scale": 0.7, "tone": 1}),
              ("Lucky Clover Sprite", "Fairy", 1, 100, 300, "fairy", ("draw2_summon",), {"scale": 0.75, "tone": 2}),
              ("Crayon Knight", "Warrior", 2, 900, 500, "knight", ("double",), {"scale": 0.8}),
              ("Bubble Bunny", "Beast", 2, 300, 300, "imp", ("flip_destroy",), {"scale": 0.75, "tone": 1}),
              ("Blanket Fort", "Rock", 1, 0, 2500, "golem", ("wall",), {"ambush": True, "scale": 0.8, "tone": 2})],
        fusion=("Best Friends Forever", "Fairy", 8, 3600, 3000, "fairy", ("double",)),
        ascended=("Pip's Imaginary Friend", "Fairy", 4500, 4000, "dragon", ("all_st", "double"))),
}
# Pip's secret: the playroom where tiny monsters are giants, and the giants Pip-Pip calls out.
FIRST_EXTRA = [
    dict(R.spell("LD-142", "Pip's Playroom", "field", "Field Spell: your Level 2 or lower monsters gain 1800 ATK and 1500 DEF.",
                 [{"op": "field", "env": "meadow", "modifiers": [{"max_level": 2, "owner_only": True, "atk": 1800, "def": 1500}]}],
                 "field", "light", "#3a2a3a", "#ffb0d8", "ultra")),
    card("LD-598", "Imaginary Titan", "LIGHT", "Fairy", 8, 4000, 3500, "golem", DECKS["first"]["pal"](3), ("destroy_strong", "pierce", "wall"),
         rarity="ultra", scale=1.5),
]
GENERIC_BY_ROLE = {"hero": [("LD-338", 1)], "friend": [("LD-329", 1)], "villain": [("LD-339", 2), ("LD-342", 1)], "wildcard": [("LD-340", 2)]}
TRAPS_BY_ROLE = {"villain": [("LD-224", 2), ("LD-225", 1), ("LD-226", 2), ("LD-227", 1)], "hero": [("LD-221", 2), ("LD-222", 1)],
                 "friend": [("LD-222", 2), ("LD-221", 1)], "wildcard": [("LD-222", 2), ("LD-219", 1)]}


def main():
    R3.setup()
    for did, spec in DECKS.items():
        cards, ids, extra = deck_cards(spec["prefix"], spec["n"], spec)
        if did == "first":
            cards += FIRST_EXTRA
        R.generic.extend(cards)
        name, title, color = spec["duelist"]
        R.DUELISTS[did] = (spec["name"], spec["desc"], ids[0], {"name": name, "title": title, "role": spec["role"], "color": color})
        R.RATIO[did] = spec["ratio"]
        R.EXTRA[did] = extra
        sig, m2, m3 = ids[0], ids[1], ids[2]
        mons = [(sig, 3 if did == "first" else 2), (m2, 3), (m3, 3), (f"LD-{spec['prefix']}8", 3)] + [(i, 2) for i in ids[3:]]
        spells = [(spec["field"], 2)]
        if did == "first":
            mons = [(sig, 3), ("LD-598", 3), (ids[3], 3), (ids[4], 3), (ids[1], 3), (ids[2], 3), (ids[5], 3), (ids[6], 2), (f"LD-{spec['prefix']}8", 2)]
            spells = [("LD-142", 3)]
        mons += GENERIC_BY_ROLE[spec["role"]]
        traps = list(TRAPS_BY_ROLE[spec["role"]])
        R.POOLS[did] = (mons, spells, traps)
    R.main()


if __name__ == "__main__":
    main()
