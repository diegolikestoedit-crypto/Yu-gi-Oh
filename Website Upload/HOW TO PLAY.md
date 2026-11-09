# Living Duel — quick start

## What you need
- **Only the person hosting** needs this folder. Friends just open a link in their browser
  (Chrome, Edge, Firefox, Safari or Opera). Nothing to install for them.
- The host needs Python 3, which comes with macOS. On Windows, install it once from python.org
  (tick "Add Python to PATH").

---

## Try it on your own computer
1. Double-click **Play Living Duel.command** (Mac) or **Play Living Duel (Windows).bat**.
   - Mac: if it says "unidentified developer", right-click the file → **Open** → **Open** (only the first time).
2. The game opens in your browser. To test a duel alone, open the same address in a second browser tab:
   each tab is its own duelist.

---

## Play alone against the computer
Main menu → **Solo Duel** → pick a difficulty (**Easy**, **Normal** or **Hard**) → **Continue**.
Choose the battlefield, your duelist and, under **Opponent**, who the computer plays as. Then press **Start Duel**.
Solo Duel works on the online link too, so friends can practise on their own.

---

## Play with friends

### A) Friends anywhere: a link they paste into their browser
1. Host: double-click **Share Online (Mac).command** (or **Share Online (Windows).bat**).
2. A window opens and, after a few seconds, prints a link ending in **.lhr.life**. If your network blocks
   that service, it automatically tries a backup and prints one ending in **.pinggy.link** (press Enter if it
   asks for a password; backup links last 60 minutes). Send that link to your friend.
   **Keep the window open while you play**: closing it stops the link.
3. Host: open the link (or the game window) → **Online Duel** → enter your name → **Create Room**.
4. Send your friend the 5-letter **room code** (or press **Copy invite link** and send that instead).
5. Friend: open the link → **Online Duel** → enter their name and the code → **Join Room**.
6. The host picks the **battlefield**, each player picks a **duelist**, then both press **Ready**.

It's a new link every time you start sharing. Only share it with people you trust.

### B) Friends on the same Wi-Fi
1. Host: double-click **Play Living Duel.command**.
2. Find your computer's local address (Mac: System Settings → Wi-Fi → Details → IP address, e.g. `192.168.1.20`).
3. Friends type `http://192.168.1.20:8787` into their browser, then join with the room code as above.
   Allow Python through the firewall if your computer asks.

### C) A permanent link that's always online
See **PUT IT ONLINE.md** (free, about 10 minutes, once).

---

## How a duel works
| Step | What you do |
|---|---|
| **Main Phase** | Click a card in your hand: round buttons appear (**Summon**, **Set**, **Activate**…). |
| **Battle Phase** | Tap the round **turn medallion** on the right → **Battle**. Click your monster, then click a target. |
| **End Turn** | Tap the medallion → **End Turn** (or press **E**). |

## Rules at a glance
- **Decks:** 50 cards each (legal decks: 40-60, at most 3 copies; cards marked *Limited* only 1).
- **Your Set cards** show their face to you (with a SET tag); your opponent only sees the back.
- **Hands:** everyone starts with **7 cards**. Each Draw Phase you draw 1, then top up to **at least 4 cards**.
  Hand limit at the end of your turn: 7.
- **Rules sets:** *Citadel* (default): 8000 LP, Level 5-6 monsters need 1 Tribute, Level 7+ need 2.
  *Frontier*: 4000 LP, no Tributes.
- **Fusion Monsters are always Level 7+** (marked *FUSION · LV* on the card). Fusion Summon them with a Fusion
  Spell and their two exact materials from your hand or field.
- **Effect monsters** (orange frame): effects when summoned, FLIP effects, effects when destroyed in battle, and
  piercing damage.
- **Equip Spells** power up one of your monsters. **Quick-Play Spells** work in the Battle Phase, or Set them to
  use on your opponent's turn. **Counter Traps** negate a Spell your opponent activates.

## Combos
Every deck has the same combo route, built around its own Fusion:
1. **Herald** (blue "HERALD" badge): Normal Summon it and you may Special Summon a Level 4 or lower monster
   from your hand. A Herald can stand in for **any one** Fusion Material.
2. **Combine**: when a Fusion's materials are face-up on your field, select one of them and press
   **Combine**. No spell needed, once per turn.
3. **Ascend**: offer that Fusion with **Crown of Ascension** (Spell, your turn) or **Ascension Rite** (Trap,
   when your opponent attacks, summons or casts a Spell) to summon its **Level 10 Ascended** form (gold frame).
   Each one has a strong effect when it arrives.
- **Champion's Call** (Spell): summon your best Level 7+ monster straight from your Deck.
- **Last Stand Rally** (Trap): stop an attack and bring back the strongest monster in your Graveyard.

Example (Ren): Dawn Herald → call Lumen Sentinel → Combine into Aegis Gryphon Knight → Crown of Ascension →
Aegis Gryphon Paragon (3300 ATK, destroys all your opponent's Spells and Traps).

## Starting a duel
A **coin toss** decides who chooses: the winner picks **Go first** (set up Traps before they can attack) or
**Go second** (draw and attack on your first turn).

## Using your Set cards
- Your Set cards show their face to you. A tag says **SET** when it is ready, or **NEXT TURN** when you Set it
  this turn: Set Traps and Quick-Plays can be used from your opponent's next turn.
- Click any of your Set cards to see when it works. Traps appear as a prompt the moment their condition happens
  (an attack, a Normal **or Special** Summon, a Spell, a Trap); "any time" Traps can also be used on your turn.
- Set Spells can be activated from the field whenever their condition is met.

## Playing on your opponent's turn
- **Ambush monsters** (e.g. Ambush Sentinel, Veil Phantom, Swift Swallow) leap from your **hand** onto the field
  when your opponent attacks, summons or casts a Spell.
- Traps that summon: **Ambush Call** (a defender from the Deck takes the hit), **Rally of Shields** (2 Shield
  Tokens), **Decoy Flock** (3 Decoy Tokens). Tokens vanish when they leave the field.
- Traps that drain Life Points every turn: **Cursed Brand** (400), **Blood Moon Pact** (300, and you heal 300),
  and the Spell **Scorched Earth** (both players).

## Big plays
**Ritual Summons** (Rite of the Titan + a Ritual monster), **Mind Lure** (borrow their best monster for a turn),
**Tempest Storm** (clear their Spells and Traps), **Spike Pit** and **Cataclysm Snare** (wipe the board),
monsters that can't be destroyed in battle, grow from your Graveyard, or draw/heal when they win a fight.

## The summon chain (every deck)
1. Normal Summon **Rally Captain**: it adds **Rally Call** or **Grand Offering** from your Deck to your hand.
2. **Rally Call**: Special Summon 2 different Level 4 or lower monsters from your Deck (they can't attack this turn).
3. **Grand Offering**: Tribute your 2 weakest monsters to summon a **Level 7+ ace** from your hand or Deck.
Mix it with Heralds, Combine and Ascension for even bigger turns.

## Shutting down your opponent
- **Null Seal** (Counter Trap): cancel a Spell. **Seal Breaker** (Counter Trap): cancel a Trap.
  **Grand Seal**: cancel either one.
- **Silence Field** (Spell): your opponent can't use Traps for 3 turns. **Arcane Gag** (Trap, usable on your own
  turn): they can't use Spells for 3 turns.

## Abilities to look for
Extra draws every turn (Lucky Magpie, Owl Familiar), card grabs from the Deck or Graveyard, sending a monster back
to the hand (Riptide Siren, Harlequin), attacking twice (Twin-Blade Ronin, Tempest Roc) and attacking directly
over monsters (Phantom Stalker, Mask Dancer).

## The 24 duelists
Each deck has its own mix of Monsters, Spells and Traps (shown on its tile): e.g. Milo Brasa 30/14/6 (all-out
attack), the Crystal Puppeteer 16/12/22 (traps everywhere), Lumen Vale 18/24/8 (a library of Spells).
Heroes: Ren, Rhea Steele, Kai Morrow, Nova Reyes, Mina Thorn. Friends: Milo, Lia, Tomas, Aria, Lumen Vale, Yuki Frost,
Bruno Ferro, Elio Quill. Villains include Doctor Vesper, the Drowned King and Countess Obsidia. And the wildcard:
**Pip** with **My First Deck** — tiny Level 1 monsters... that turn into giants in Pip's Playroom.

## The guide
The guide (bottom right) explains what you can do and shows a **★ Suggested play** with the reason.
**Show me** highlights the card; you still decide and click the move yourself. Turn suggestions off in
Settings → *Suggested plays*, or hide the whole guide with **×** or **G**.

## Keys
`Space` speed up animations · `B` battle · `M` main phase 2 · `E` end turn · `G` guide · `L` duel log ·
`Esc` close / deselect / settings
