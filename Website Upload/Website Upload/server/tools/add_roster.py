"""One-off content script: adds the original duelist roster (monsters, a Field Spell, 8 preset decks)."""
import json, os
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CARDS = os.path.join(ROOT, "shared", "cards.json")
DECKS = os.path.join(ROOT, "shared", "decks.json")

def mon(cid, name, attr, race, lv, atk, df, rig, pal, text, rarity="common", scale=1.0, summon=None, attack=None, aura=None, variant=None):
    summon = summon or {"dragon": "flame_burst", "sorcerer": "arcane_circle", "knight": "light_pillar", "bird": "wind_swirl",
                        "golem": "earth_rise", "serpent": "water_spout", "imp": "shadow_pool", "fairy": "light_pillar"}[rig]
    attack = attack or {"dragon": "fire_breath", "sorcerer": "void_orb", "knight": "blade_dash", "bird": "dive",
                        "golem": "slam", "serpent": "water_jet", "imp": "shadow_bolt", "fairy": "shards"}[rig]
    aura = aura or {"LIGHT": "light", "DARK": "dark", "FIRE": "fire", "WATER": "water", "WIND": "wind", "EARTH": "earth"}[attr]
    v = {"rig": rig, "scale": scale, "summon": summon, "attack": attack, "aura": aura, "palette": pal}
    if variant: v["variant"] = variant
    return {"id": cid, "name": name, "type": "monster", "subtype": "normal", "attribute": attr, "race": race, "level": lv,
            "atk": atk, "def": df, "rarity": rarity, "text": text, "rulesets": ["frontier", "citadel"], "visual": v}

P = lambda body, shade, accent, glow, eye, **k: dict(body=body, shade=shade, accent=accent, glow=glow, eye=eye, **k)
new = [
  # --- Milo Brasa: fire dragons
  mon("LD-013", "Magmaw Wyvern", "FIRE", "Dragon", 7, 2500, 2000, "dragon", P("#e2552a", "#6e1c10", "#ffcc4a", "#ffe08a", "#fff36a", wing="#a8321c"), "Its roar cracks open the earth so it can drink the magma beneath.", "ultra", 1.3, attack="fire_breath"),
  mon("LD-014", "Pyre Hatchling", "FIRE", "Dragon", 2, 800, 600, "dragon", P("#ff8a3c", "#a03a18", "#ffe07a", "#fff0b0", "#3a1a08", wing="#e2602c"), "Still learning to breathe fire. Mostly it breathes warm smoke and hiccups.", scale=0.8),
  mon("LD-015", "Flamecrest Knight", "FIRE", "Warrior", 4, 1750, 1100, "knight", P("#c8483a", "#6a1a14", "#ffc14a", "#ffe6a0", "#ffd23a", cloth="#2a1a14"), "Its plume is a living flame that never goes out, even in the rain."),
  mon("LD-016", "Cinder Imp", "FIRE", "Fiend", 3, 1200, 700, "imp", P("#c2401e", "#5a1608", "#ffd24a", "#ffe9a0", "#fff36a", wing="#7a2010"), "It juggles embers it stole from blacksmiths' forges."),
  mon("LD-017", "Phoenix Kestrel", "FIRE", "Winged Beast", 4, 1600, 1000, "bird", P("#ff6a2a", "#8a2410", "#ffd84a", "#fff0a8", "#ffe14a", wing="#ffa53a"), "Wherever it lands, the grass is left warm for an hour."),
  # --- Lia Corriente: tides
  mon("LD-018", "Tidequeen Leviathan", "WATER", "Sea Serpent", 8, 2800, 2300, "serpent", P("#2aa6b8", "#0e4a5e", "#f4e6c8", "#c8fbff", "#ffd86a", fin="#7ff0e0"), "The ocean's oldest monarch. Storms bow to the sound of her voice.", "ultra", 1.35),
  mon("LD-019", "Coral Sentinel", "WATER", "Rock", 4, 1200, 2100, "golem", P("#e07a8a", "#7a3448", "#3fc8b8", "#bff8f0", "#7ff0ff"), "A reef that slowly stood up. Fish still live inside it."),
  mon("LD-020", "Reef Sprite", "WATER", "Fairy", 3, 900, 1300, "fairy", P("#c8f4ff", "#5aa8c8", "#3ad6c8", "#ffffff", "#2a6fd8", wing="#9ff0ff"), "It paints the coral with colours borrowed from the sunset."),
  mon("LD-021", "Storm Petrel", "WATER", "Winged Beast", 4, 1500, 1000, "bird", P("#4a7fb8", "#1e3a62", "#e8f0ff", "#c8e8ff", "#ffe14a", wing="#2e5c94"), "Sailors say that when it sings, a wave three times taller follows."),
  mon("LD-022", "Deepsea Oracle", "WATER", "Spellcaster", 4, 1500, 1300, "sorcerer", P("#1e6a8a", "#0a2e40", "#7ff0d8", "#c8fff4", "#7ff0d8", cloth="#e8d8a8", skin="#b8e0e8"), "She reads the future in the currents, and rarely likes what she sees."),
  # --- Tomas Granito: earth
  mon("LD-023", "Granite Colossus", "EARTH", "Rock", 8, 2700, 3000, "golem", P("#9a8e7c", "#4e463a", "#e0b04a", "#ffe8a0", "#ffcf3a"), "A mountain that learned to walk. Each step is felt three valleys away.", "ultra", 1.35),
  mon("LD-024", "Quarry Knight", "EARTH", "Warrior", 4, 1500, 1800, "knight", P("#a89a7a", "#5a4e38", "#d8b45a", "#f4e4b0", "#9fe06a", cloth="#4a6a2a"), "Its shield was cut from the same stone as the first castle wall."),
  mon("LD-025", "Moss Serpent", "EARTH", "Reptile", 4, 1400, 1600, "serpent", P("#5a8a3a", "#2a4a1a", "#c8a85a", "#e8ffb0", "#ffe14a", fin="#8ac04a"), "It sleeps for decades at a time, so long that forests grow on its back."),
  mon("LD-026", "Pebble Imp", "EARTH", "Rock", 2, 700, 1200, "imp", P("#8a8070", "#4a4238", "#7ab04a", "#d8f0a0", "#ffcf3a", wing="#5a5244"), "It throws pebbles at anyone who tries to skip stones on its pond."),
  mon("LD-027", "Boulder Drake", "EARTH", "Dragon", 6, 2200, 2100, "dragon", P("#8a7a5e", "#463a28", "#c8e06a", "#f0ffb0", "#ffb43a", wing="#6a5a40"), "It sheds its stony scales once a year, and villagers build houses from them.", "rare", 1.1),
  # --- Umbral Empress: shadow court
  mon("LD-028", "The Umbral Empress", "DARK", "Spellcaster", 8, 2800, 2500, "sorcerer", P("#2a1430", "#12060f", "#e0b04a", "#ff8aa8", "#ff3a5a", cloth="#8a1a2a", skin="#d8c0d0"), "She rules a kingdom no map shows, where the sun has never been invited.", "ultra", 1.3),
  mon("LD-029", "Nightmare Wyrm", "DARK", "Dragon", 7, 2600, 2000, "dragon", P("#3a2a5a", "#160e26", "#5af0c8", "#b0fff0", "#5af0c8", wing="#4a2a6a"), "It feeds on bad dreams, and has never once gone hungry.", "rare", 1.2, attack="dark_flame"),
  mon("LD-030", "Dread Revenant", "DARK", "Zombie", 5, 2000, 1400, "knight", P("#4a4a5a", "#1e1e28", "#b45cff", "#e0b8ff", "#c87aff", cloth="#2a0a2a"), "A general who refused to stay buried. His army is still looking for him."),
  mon("LD-031", "Shade Bat", "DARK", "Fiend", 3, 1000, 1000, "imp", P("#3a2a48", "#160e1e", "#ff5a8a", "#ffb0c8", "#ff3a5a", wing="#2a1a38"), "It hangs from the ceiling of the Empress's throne room, listening."),
  mon("LD-032", "Wraith Raven", "DARK", "Winged Beast", 4, 1600, 900, "bird", P("#2a2a3a", "#0e0e18", "#8a5cff", "#c8b0ff", "#ff3a5a", wing="#1a1a2a"), "Its shadow arrives a moment before it does. So does the cold."),
  # --- Crystal Puppeteer: glass theatre
  mon("LD-033", "Crystal Seraph", "LIGHT", "Fairy", 7, 2500, 2200, "fairy", P("#f0f8ff", "#9ab8d8", "#7ae8ff", "#ffffff", "#ff5ad8", wing="#c8f4ff"), "The Puppeteer's masterpiece. Its strings are made of light.", "ultra", 1.3),
  mon("LD-034", "Mirror Knight", "LIGHT", "Warrior", 4, 1600, 1500, "knight", P("#d8e8f8", "#7a8aa8", "#ff9bf0", "#ffffff", "#7ae8ff", cloth="#5a3aa8"), "Strike it and you will only see yourself in the pieces."),
  mon("LD-035", "Shard Sprite", "LIGHT", "Fairy", 2, 700, 900, "fairy", P("#ffe8f8", "#c89ab8", "#ffd86a", "#ffffff", "#5a3aa8", wing="#ffd0f0"), "A splinter of a broken chandelier, still dancing to old music.", scale=0.8),
  mon("LD-036", "Prism Golem", "LIGHT", "Rock", 5, 1900, 2200, "golem", P("#b8d8f0", "#5a7aa0", "#ff9bf0", "#ffffff", "#7ae8ff"), "Light that enters it never leaves the same colour.", "rare"),
  # --- The Collector: vault
  mon("LD-037", "Gilded Wyrm", "LIGHT", "Dragon", 7, 2600, 2100, "dragon", P("#e8c050", "#8a6018", "#3a2a1a", "#fff0b0", "#3ad6c8", wing="#d8a838"), "The Collector's prize. Its hoard is said to include several smaller dragons.", "ultra", 1.25, attack="radiant_beam", summon="grand_portal"),
  mon("LD-038", "Vault Golem", "DARK", "Machine", 6, 2100, 2500, "golem", P("#5a5048", "#26201c", "#e0b04a", "#ffe8a0", "#ff5a3a"), "It guards the vault so well that it has forgotten what is inside."),
  mon("LD-039", "Relic Hunter", "DARK", "Warrior", 4, 1700, 1200, "knight", P("#6a5a48", "#2e261e", "#e0b04a", "#fff0b0", "#ffcf3a", cloth="#1e3a4a"), "It has never failed to bring back what it was sent for. Never asks why."),
  mon("LD-040", "Curio Imp", "DARK", "Fiend", 3, 1000, 1100, "imp", P("#4a6a5a", "#1e2e26", "#e0b04a", "#fff0b0", "#ffcf3a", wing="#2a3e34"), "It catalogues everything it steals, with very neat handwriting."),
]
field = {
  "id": "LD-111", "name": "Verdant Bastion", "type": "spell", "subtype": "field", "rarity": "rare",
  "text": "All EARTH monsters gain 300 ATK and 500 DEF.", "rulesets": ["frontier", "citadel"],
  "effect": {"ops": [{"op": "field", "env": "meadow", "modifiers": [{"attribute": "EARTH", "atk": 300, "def": 500}]}]},
  "visual": {"fx": "field", "element": "nature", "palette": {"a": "#2f5a2a", "b": "#9ff07a"}},
}

data = json.load(open(CARDS))
have = {c["id"] for c in data["cards"]}
for c in new + [field]:
    if c["id"] not in have:
        data["cards"].append(c)
open(CARDS, "w").write(json.dumps(data, indent=2, ensure_ascii=False) + "\n")

def deck(i, name, desc, sig, duelist, title, role, color, main, extra=()):
    assert len(main) == 20, (i, len(main))
    return {"id": i, "name": name, "description": desc, "signature": sig, "main": main, "extra": list(extra),
            "duelist": {"name": duelist, "title": title, "role": role, "color": color}}

S = ["LD-101", "LD-104"]  # Chalice of Plenty + Rite of Return: shared staples
decks = [
  deck("radiant", "Radiant Dawn", "LIGHT warriors and the dragon Celestine. Strong attackers backed by protective traps.", "LD-001",
       "Ren Asakura", "The Dawnbearer", "hero", "#5cc8ff",
       ["LD-001", "LD-001", "LD-002", "LD-002", "LD-002", "LD-003", "LD-003", "LD-004", "LD-004", "LD-005", "LD-006",
        "LD-101", "LD-103", "LD-104", "LD-105", "LD-106", "LD-109", "LD-108", "LD-201", "LD-203"], ["LD-F01"]),
  deck("void", "Void Tide", "DARK spellcasters and deep-sea horrors led by Nyxar. Disruptive spells and punishing traps.", "LD-007",
       "Kael Varga", "The Silent Rival", "rival", "#b45cff",
       ["LD-007", "LD-007", "LD-008", "LD-008", "LD-009", "LD-009", "LD-009", "LD-010", "LD-010", "LD-010", "LD-011", "LD-011",
        "LD-012", "LD-101", "LD-102", "LD-104", "LD-107", "LD-110", "LD-202", "LD-204"]),
  deck("ember", "Ember Forge", "Hot-headed fire dragons that hit hard and fast. Built to end duels quickly.", "LD-013",
       "Milo Brasa", "The Hothead", "friend", "#ff7a3a",
       ["LD-013", "LD-013", "LD-006", "LD-006", "LD-014", "LD-014", "LD-015", "LD-015", "LD-015", "LD-016", "LD-016",
        "LD-017", "LD-017", "LD-108", "LD-108", "LD-103", *S, "LD-203", "LD-204"]),
  deck("tides", "Deep Tides", "Patient sea creatures that grow stronger in the Sunken Abyss.", "LD-018",
       "Lia Corriente", "The Tidecaller", "friend", "#3fc8d8",
       ["LD-018", "LD-018", "LD-009", "LD-009", "LD-019", "LD-019", "LD-020", "LD-020", "LD-021", "LD-021", "LD-022", "LD-022",
        "LD-022", "LD-107", "LD-107", *S, "LD-105", "LD-201", "LD-203"]),
  deck("stone", "Stone Bulwark", "A wall of earth that is almost impossible to break, then crushes back.", "LD-023",
       "Tomas Granito", "The Unbreakable", "friend", "#c8a050",
       ["LD-023", "LD-023", "LD-004", "LD-004", "LD-024", "LD-024", "LD-024", "LD-025", "LD-025", "LD-026", "LD-026",
        "LD-027", "LD-027", "LD-111", "LD-111", *S, "LD-105", "LD-203", "LD-202"]),
  deck("umbral", "Court of Shadows", "The Umbral Empress and her nightmares. Wipes the board and rules the dark.", "LD-028",
       "The Umbral Empress", "Queen of the Unlit Realm", "villain", "#ff3a5a",
       ["LD-028", "LD-028", "LD-029", "LD-029", "LD-030", "LD-030", "LD-031", "LD-031", "LD-031", "LD-032", "LD-032",
        "LD-008", "LD-010", "LD-110", "LD-102", *S, "LD-202", "LD-204", "LD-201"]),
  deck("crystal", "Glass Theatre", "The Crystal Puppeteer's stage: fragile-looking fairies hiding a wall of traps.", "LD-033",
       "The Crystal Puppeteer", "Master of Strings", "villain", "#ff9bf0",
       ["LD-033", "LD-033", "LD-034", "LD-034", "LD-034", "LD-035", "LD-035", "LD-036", "LD-036", "LD-005", "LD-005",
        "LD-109", "LD-105", *S, "LD-201", "LD-201", "LD-203", "LD-202", "LD-204"]),
  deck("vault", "The Collector's Vault", "Steals your best monsters from the Graveyard and destroys the rest.", "LD-037",
       "The Collector", "Keeper of Stolen Things", "villain", "#e0b04a",
       ["LD-037", "LD-037", "LD-038", "LD-038", "LD-039", "LD-039", "LD-039", "LD-040", "LD-040", "LD-012", "LD-010",
        "LD-104", "LD-104", "LD-103", "LD-103", "LD-102", "LD-101", "LD-105", "LD-204", "LD-202"]),
]
json.dump({"decks": decks}, open(DECKS, "w"), indent=2, ensure_ascii=False)
open(DECKS, "a").write("\n")
print(len(data["cards"]), "cards;", len(decks), "decks")
