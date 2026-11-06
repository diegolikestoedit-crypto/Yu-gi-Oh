"""One-off content script: the combo layer. Heralds bring a second monster out and stand in for a Fusion
Material; Fusions can be Combined straight from the field; Ascended monsters grow out of a Fusion through a
Spell or Trap; and two cards call out your best monster. Run after add_technical.py."""
import collections
import json
import os

from add_technical import CARDS, DECKS, RULES, P, eff, mon, spell, trap

HERALD = ("Can be used as any one Fusion Material. When this card is Normal Summoned: you can Special Summon "
          "1 Level 4 or lower monster from your hand.")


def herald(cid, name, attr, race, rig, pal):
    c = mon(cid, name, attr, race, 4, 1400, 1000, rig, pal, HERALD, "rare",
            effect=eff("normal_summon", "calls an ally from the hand", {"op": "special_from_hand", "filter": {"max_level": 4}}))
    c["fusion_substitute"] = True
    return c


heralds = {
    "radiant": herald("LD-321", "Dawn Herald", "LIGHT", "Warrior", "knight", P("#fff0c0", "#b89a5a", "#7ae7ff", "#fffbe8", "#2b9bff", cloth="#e8c050")),
    "void": herald("LD-322", "Void Herald", "DARK", "Spellcaster", "sorcerer", P("#2a1a48", "#100820", "#c87aff", "#e8c8ff", "#ff5af0", cloth="#4a2a7a", skin="#d0c0e8")),
    "ember": herald("LD-323", "Ember Herald", "FIRE", "Warrior", "knight", P("#e2683a", "#6a2010", "#ffe07a", "#fff0b0", "#fff36a", cloth="#4a1a10")),
    "tides": herald("LD-324", "Tide Herald", "WATER", "Fairy", "fairy", P("#aee8ff", "#3a88b0", "#e8fff8", "#ffffff", "#1e5ab8", wing="#6fd8ff")),
    "stone": herald("LD-325", "Stone Herald", "EARTH", "Warrior", "knight", P("#b8a888", "#5e5038", "#c8e06a", "#f0ffb0", "#ffcf3a", cloth="#3a5a1a")),
    "umbral": herald("LD-326", "Dusk Herald", "DARK", "Zombie", "knight", P("#4a3a5a", "#1a1024", "#ff5a8a", "#ffb0c8", "#ff3a5a", cloth="#3a0a1a")),
    "crystal": herald("LD-327", "Glass Herald", "LIGHT", "Fairy", "fairy", P("#f4f8ff", "#9ab0d0", "#ff9bf0", "#ffffff", "#5a3aa8", wing="#d8ecff")),
    "vault": herald("LD-328", "Vault Herald", "DARK", "Machine", "golem", P("#7a6a50", "#30281c", "#ffd86a", "#fff0b0", "#3ad6c8")),
}

ASC = "Ascended (Level 10). Summoned only by Crown of Ascension or Ascension Rite, by offering {}. "


def ascended(cid, name, src_cid, src_name, attr, race, atk, df, rig, pal, text, effect=None, piercing=False, scale=1.5):
    c = mon(cid, name, attr, race, 10, atk, df, rig, pal, ASC.format(src_name) + text, "ultra", scale,
            effect=effect, piercing=piercing, summon="grand_portal")
    c["subtype"] = "ascended"
    c["ascends_from"] = src_cid
    return c


ascendeds = {
    "radiant": ascended("LD-A01", "Aegis Gryphon Paragon", "LD-F01", "Aegis Gryphon Knight", "LIGHT", "Winged Beast", 3300, 2600, "bird",
                        P("#fffbe8", "#c8b070", "#ffd86a", "#ffffff", "#2b9bff", wing="#fff0b0"),
                        "When summoned: destroy every Spell and Trap your opponent controls.",
                        effect=eff("summon", "blows away every enemy Spell and Trap", {"op": "destroy_all_opp_st"})),
    "void": ascended("LD-A02", "Nyxar, Void Sovereign", "LD-F02", "Eclipse Archmage", "DARK", "Spellcaster", 3500, 2800, "sorcerer",
                     P("#140a24", "#06020c", "#ffd86a", "#f0d0ff", "#ff5af0", cloth="#5a1a9a", skin="#e0d0f0"),
                     "When summoned: destroy the monster your opponent controls with the highest ATK.",
                     effect=eff("summon", "erases the strongest enemy", {"op": "destroy_strongest_opp"})),
    "ember": ascended("LD-A03", "Inferno Dragoon Ascendant", "LD-F03", "Blazeguard Dragoon", "FIRE", "Dragon", 3400, 2400, "dragon",
                      P("#ff5a2a", "#7a1a08", "#fff07a", "#fff8c8", "#ffffff", wing="#ffb03a"),
                      "Piercing. When summoned: inflict 1000 damage to your opponent.",
                      effect=eff("summon", "rains fire for 1000", {"op": "damage_opponent", "amount": 1000}), piercing=True, scale=1.45),
    "tides": ascended("LD-A04", "Tempest Oracle Ascendant", "LD-F04", "Maelstrom Oracle", "WATER", "Spellcaster", 3200, 3000, "sorcerer",
                      P("#1e7ab0", "#0a3050", "#bffff4", "#ffffff", "#7ff0d8", cloth="#f0e8c0", skin="#c8f0f8"),
                      "When summoned: draw 2 cards.",
                      effect=eff("summon", "foresees 2 cards", {"op": "draw", "count": 2})),
    "stone": ascended("LD-A05", "Bastion Basilisk Titan", "LD-F05", "Bastion Basilisk", "EARTH", "Reptile", 3000, 3800, "serpent",
                      P("#8aaa4a", "#344a18", "#ffe07a", "#f8ffc8", "#ffcf3a", fin="#c8e06a"),
                      "Piercing. When summoned: you gain 2000 Life Points.",
                      effect=eff("summon", "restores 2000 LP", {"op": "gain_lp", "amount": 2000}), piercing=True),
    "umbral": ascended("LD-A06", "Dusk Reaper Eternal", "LD-F06", "Dusk Reaper", "DARK", "Zombie", 3400, 2200, "knight",
                       P("#2a2a3a", "#0a0a12", "#ff5af0", "#ffc8f0", "#ff3a8a", cloth="#3a0a3a"),
                       "When summoned: destroy the monster your opponent controls with the highest ATK.",
                       effect=eff("summon", "reaps the strongest enemy", {"op": "destroy_strongest_opp"}), scale=1.4),
    "crystal": ascended("LD-A07", "Kaleido Paladin Radiant", "LD-F07", "Kaleido Paladin", "LIGHT", "Warrior", 3400, 3000, "knight",
                        P("#f4faff", "#8a9ac0", "#ffb0f8", "#ffffff", "#7ae8ff", cloth="#7a4ad8"),
                        "Piercing. When summoned: destroy every Spell and Trap your opponent controls.",
                        effect=eff("summon", "shatters every enemy Spell and Trap", {"op": "destroy_all_opp_st"}), piercing=True, scale=1.4),
    "vault": ascended("LD-A08", "Grand Curator Prime", "LD-F08", "Grand Curator", "DARK", "Machine", 3300, 3000, "golem",
                      P("#8a7a4a", "#2e2814", "#ffe88a", "#fff8d0", "#3ad6c8"),
                      "When summoned: add 1 Level 4 or lower monster from your Deck to your hand, then draw 1 card.",
                      effect=eff("summon", "catalogues the Deck", {"op": "search_deck", "filter": {"max_level": 4}}, {"op": "draw", "count": 1})),
}

ASCEND_TEXT = "Offer 1 Fusion Monster you control: Special Summon its Ascended form from your Extra Deck."
cards = [
    spell("LD-127", "Champion's Call", "normal", "Special Summon 1 Level 7 or higher monster from your Deck. It can't attack this turn. (Limited: 1 per deck.)",
          [{"op": "summon_best_from_deck", "filter": {"min_level": 7}}], "champion", "light", "#3a2a0a", "#ffe58a", "ultra", limit=1),
    spell("LD-128", "Crown of Ascension", "normal", ASCEND_TEXT,
          [{"op": "ascend"}], "crown", "light", "#2a1a0a", "#fff0b0", "ultra"),
    trap("LD-213", "Ascension Rite", "normal", "any", "Can be activated whenever your opponent attacks, summons, or activates a Spell. " + ASCEND_TEXT,
         [{"op": "ascend"}], "crown", "energy", "#1a0a2a", "#ffe58a", "ultra"),
    trap("LD-214", "Last Stand Rally", "normal", "opp_attack", "When an opponent's monster declares an attack: negate it, then Special Summon the monster with the highest ATK from your Graveyard.",
         [{"op": "negate_attack"}, {"op": "revive_best"}], "rally", "light", "#2a0a0a", "#ffb34a", "rare"),
]

ADD = {"herald": 3, "LD-127": 1, "LD-128": 1, "LD-213": 2, "LD-214": 1}


def main():
    data = json.load(open(CARDS, encoding="utf-8"))
    new = {c["id"]: c for c in list(heralds.values()) + list(ascendeds.values()) + cards}
    data["cards"] = [c for c in data["cards"] if c["id"] not in new] + list(new.values())
    json.dump(data, open(CARDS, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    db = {c["id"]: c for c in data["cards"]}

    decks = json.load(open(DECKS, encoding="utf-8"))
    for d in decks["decks"]:
        counts = collections.Counter(c for c in d["main"] if c not in new)
        add = {heralds[d["id"]]["id"]: ADD["herald"], **{k: v for k, v in ADD.items() if k != "herald"}}
        keep = {d["signature"], "LD-106"} | {m for fx in d["extra"] if fx in db and "materials" in db[fx] for m in db[fx]["materials"]}
        # Make room: weakest Normal monsters first, then the most-copied Spells/Traps (never below 1 copy).
        need = 50 - sum(add.values())
        mons = sorted((c for c in counts if db[c]["type"] == "monster" and db[c]["subtype"] == "normal" and c not in keep),
                      key=lambda c: db[c]["atk"])
        sts = sorted((c for c in counts if db[c]["type"] != "monster" and c not in keep), key=lambda c: -counts[c])
        cut_m = 0
        while sum(counts.values()) > need:
            pool = mons if cut_m < 4 else sts
            pool = [c for c in pool if counts[c] > 1] or [c for c in (mons + sts) if counts[c] > 1]
            pool.sort(key=lambda c: (db[c]["atk"] if db[c]["type"] == "monster" else 0, -counts[c]))
            victim = pool[0] if cut_m < 4 else max(pool, key=lambda c: counts[c])
            counts[victim] -= 1
            cut_m += 1
        counts.update(add)
        main = [c for c, n in counts.items() for _ in range(n)]
        assert len(main) == 50, (d["id"], len(main))
        d["main"] = main
        fusion = next(fx for fx in d["extra"] if db[fx]["subtype"] == "fusion")
        d["extra"] = [fx for fx in d["extra"] if db[fx]["subtype"] == "fusion"] + [ascendeds[d["id"]]["id"]]
        assert db[d["extra"][-1]]["ascends_from"] == fusion
        print(d["id"], dict(collections.Counter(db[c]["type"] for c in main)), d["extra"])
    json.dump(decks, open(DECKS, "w", encoding="utf-8"), indent=2, ensure_ascii=False)


if __name__ == "__main__":
    main()
