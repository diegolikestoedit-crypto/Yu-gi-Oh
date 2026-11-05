"""Card database loading and deck validation. Card data lives in shared/cards.json."""
from __future__ import annotations

import json
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SHARED = os.path.join(ROOT, "shared")

MIN_DECK = 20
MAX_DECK = 40
MAX_EXTRA = 15
MAX_COPIES = 3


def load_db(path: str | None = None) -> dict:
    path = path or os.path.join(SHARED, "cards.json")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return {c["id"]: c for c in data["cards"]}


def load_decks(path: str | None = None) -> dict:
    path = path or os.path.join(SHARED, "decks.json")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return {d["id"]: d for d in data["decks"]}


def validate_deck(db: dict, deck: dict, profile: str) -> list:
    """Return a list of human-readable problems; empty means the deck is legal."""
    problems = []
    main = deck.get("main", [])
    extra = deck.get("extra", [])
    if not (MIN_DECK <= len(main) <= MAX_DECK):
        problems.append(f"Main deck must have {MIN_DECK}-{MAX_DECK} cards (has {len(main)}).")
    if len(extra) > MAX_EXTRA:
        problems.append(f"Extra deck may have at most {MAX_EXTRA} cards.")
    counts: dict = {}
    for cid in main + extra:
        card = db.get(cid)
        if card is None:
            problems.append(f"Unknown card {cid}.")
            continue
        if profile not in card.get("rulesets", []):
            problems.append(f"{card['name']} is not legal under this ruleset.")
        counts[cid] = counts.get(cid, 0) + 1
    for cid, n in counts.items():
        if n > MAX_COPIES:
            problems.append(f"At most {MAX_COPIES} copies of {db[cid]['name']}.")
    for cid in main:
        if db.get(cid, {}).get("subtype") == "fusion":
            problems.append(f"{db[cid]['name']} belongs in the Extra Deck.")
    for cid in extra:
        if db.get(cid, {}).get("subtype") != "fusion":
            problems.append(f"{db.get(cid, {}).get('name', cid)} cannot go in the Extra Deck.")
    return problems
