// Contextual mini-guide. A pure function of the player's own view, the server-provided legal actions and
// the current selection. It explains; it never chooses, acts, or reveals anything the player can't see.
import { card as cardData } from "./carddb.js";

const TRIBUTES = { frontier: () => 0, citadel: (lv) => (lv <= 4 ? 0 : lv <= 6 ? 1 : 2) };

function short(text) {
  return text.length > 90 ? text.slice(0, 88) + "…" : text;
}

export function guideMessage(view, actions, decider, sel, choose) {
  if (!view) return "";
  const me = view.you;
  const mine = view.players[me];
  const opp = view.players[1 - me];
  if (view.winner !== null && view.winner !== undefined) return "The duel is over. Return to the lobby for a rematch.";
  const has = (k) => actions.some((a) => a.kind === k);
  const pend = view.pending;

  if (decider !== me) {
    if (pend && pend.kind === "response") return "Your opponent is deciding whether to respond to your move.";
    return "It's your opponent's turn. Click any face-up card or monster to inspect it while you wait.";
  }
  if (pend && pend.kind === "response") {
    const traps = actions.filter((a) => a.kind === "activate_trap" || a.kind === "activate_quick");
    const what = pend.trigger === "opp_attack" ? "Your opponent declared an attack."
      : pend.trigger === "opp_spell" ? "Your opponent is activating a Spell. A Counter Trap or a Set Quick-Play can answer it before it resolves."
      : "Your opponent just summoned a monster.";
    return traps.length
      ? `${what} You have a Set card that can respond: use it now, or let it go.`
      : `${what} None of your Set cards can respond to this, so choose "Don't respond".`;
  }
  if (pend && pend.kind === "discard") return `Hand limit: you hold ${mine.hand.length} cards. Choose one to discard.`;

  const phase = view.phase;
  const inMain = phase === "main1" || phase === "main2";

  if (sel) {
    const forCard = actions.filter((a) => a.card === sel);
    const handCard = mine.hand.find((c) => c.iid === sel);
    const fieldMon = mine.monsters.find((m) => m && m.iid === sel);
    const setCard = mine.st.find((c) => c && c.iid === sel);
    const oppCard = opp.monsters.find((m) => m && m.iid === sel) || opp.st.find((c) => c && c.iid === sel);
    if (oppCard) {
      if (!oppCard.face_up) return "That card is face-down. You can't see what it is until it's revealed.";
      return "That's your opponent's card. Its details are shown on the right.";
    }
    const c = cardData((handCard || fieldMon || setCard || {}).cid);
    if (c && handCard) {
      if (c.type === "monster") {
        if (forCard.some((a) => a.kind === "normal_summon"))
          return `You can summon ${c.name} to an open monster zone, or Set it face-down in Defense Position.`;
        if (forCard.some((a) => a.kind === "tribute_summon")) {
          const n = TRIBUTES[view.profile](c.level);
          return choose === "tribute_summon"
            ? `Pick which monster${n > 1 ? "s" : ""} to release: hover an option to see it highlighted on the field.`
            : `${c.name} needs ${n} tribute${n > 1 ? "s" : ""}. Press Tribute, then pick which of your monsters to release.`;
        }
        if (!inMain) return "Monsters can only be summoned during your Main Phase.";
        if (mine.normal_summoned) return "You've already Normal Summoned or Set a monster this turn. You can summon again next turn.";
        const need = TRIBUTES[view.profile](c.level);
        const count = mine.monsters.filter(Boolean).length;
        if (need > count) return `${c.name} is Level ${c.level}, so it needs ${need} tribute${need > 1 ? "s" : ""}. You control ${count} monster${count === 1 ? "" : "s"}. Summon smaller monsters first.`;
        if (count >= 5) return "All your monster zones are full.";
        return "This monster can't be summoned right now.";
      }
      if (c.type === "spell") {
        if (forCard.some((a) => a.kind === "activate_spell")) {
          if (c.subtype === "equip") return `Equip ${c.name} to one of your face-up monsters: ${short(c.text)}`;
          if (c.subtype === "quickplay") return `${c.name} is a Quick-Play: use it now, or Set it to spring on your opponent's turn.`;
          return `Activate ${c.name}: ${short(c.text)}`;
        }
        if (phase === "battle" && c.subtype !== "quickplay") return "Only Quick-Play Spells can be used during the Battle Phase.";
        if (!inMain && c.subtype !== "quickplay") return "Spells are used during your Main Phase.";
        const reason = spellReason(c, view);
        return `${reason} You can still Set it face-down for later.`;
      }
      if (c.type === "trap") return c.subtype === "counter"
        ? `${c.name} is a Counter Trap: Set it, and from your opponent's next turn it can negate a Spell they activate.`
        : `Traps must be Set first. Once Set, ${c.name} can activate from your opponent's next turn, when its condition happens.`;
    }
    if (c && fieldMon) {
      if (phase === "battle") {
        if (forCard.some((a) => a.kind === "attack"))
          return forCard.some((a) => a.target === null)
            ? `Your opponent has no monsters: ${c.name} can attack directly!`
            : `Choose a target for ${c.name}. Highlighted monsters can be attacked.`;
        if (fieldMon.attacked) return `${c.name} has already attacked this turn.`;
        if (fieldMon.position === "def") return "Monsters in Defense Position can't attack.";
        if (forCard.some((a) => a.kind === "activate_spell")) return "Use a Quick-Play Spell on this monster before attacking.";
        return "An effect is preventing your monsters from attacking.";
      }
      if (forCard.some((a) => a.kind === "flip_summon")) return "You can Flip Summon this face-down monster into Attack Position.";
      if (forCard.some((a) => a.kind === "change_position")) return `You can change ${c.name}'s battle position once this turn.`;
      if (fieldMon.summoned_this_turn) return "A monster can't change position on the turn it arrived.";
      if (phase === "main1" && has("enter_battle")) return "To attack with this monster, enter the Battle Phase first: tap the turn medallion on the right.";
      return `${c.name} is ready on the field.`;
    }
    if (c && setCard) {
      if (forCard.some((a) => a.kind === "activate_spell")) return `You can activate your Set ${c.name} now.`;
      if (c.type === "trap") return `${c.name} will offer to activate when its condition happens on your opponent's turn.`;
      return `${c.name} is waiting face-down.`;
    }
  }

  if (phase === "battle") {
    const attacks = actions.filter((a) => a.kind === "attack");
    if (attacks.some((a) => a.target === null)) return "Your opponent has no monsters. Select a glowing monster to attack directly!";
    if (attacks.length) return "Select one of your glowing monsters, then choose which monster to attack.";
    if (mine.monsters.some((m) => m && m.face_up && m.position === "atk" && !m.attacked)) return "An effect prevents you from attacking this turn.";
    return "No monster can attack right now. Use the turn medallion to go to Main Phase 2 or end your turn.";
  }
  if (inMain) {
    const playable = actions.filter((a) => a.card && mine.hand.some((c) => c.iid === a.card));
    if (view.turn === 1 && phase === "main1")
      return playable.length
        ? "Select a card from your hand to see what you can do with it. Glowing cards can be played. (Nobody can attack on the first turn.)"
        : "Nobody can attack on the first turn. Tap the turn medallion to end your turn when you're ready.";
    if (!mine.normal_summoned && playable.some((a) => a.kind === "normal_summon" || a.kind === "tribute_summon"))
      return "You can still summon a monster this turn. Glowing hand cards can be played.";
    if (phase === "main1" && has("enter_battle") && mine.monsters.some((m) => m && m.face_up && m.position === "atk"))
      return "When you're ready, tap the turn medallion on the right and choose Battle to attack.";
    if (playable.length) return "Glowing cards in your hand can still be played. Select one to see its options.";
    if (phase === "main2") return "Main Phase 2: play anything you held back, then end your turn from the turn medallion.";
    return "Review your hand, or end your turn from the turn medallion when you're ready.";
  }
  return "Review your hand or finish your current phase when you're ready.";
}

function spellReason(c, view) {
  const me = view.you;
  const ops = c.effect.ops.map((o) => o.op);
  const all = view.players.flatMap((p) => p.monsters.filter(Boolean));
  if (ops.includes("draw") && view.players[me].deck_count < 2) return "You don't have enough cards left in your deck.";
  if (ops.includes("destroy_all_monsters") && !all.length) return "There are no monsters on the field to destroy.";
  if (ops.includes("destroy_target")) return "Your opponent controls no monsters to target.";
  if (ops.includes("special_summon_target")) {
    if (view.players[me].monsters.every(Boolean)) return "Your monster zones are full.";
    return "There are no monsters in either Graveyard to bring back.";
  }
  if (ops.includes("fusion_summon")) return "Fusion Summons need a Level 7+ Fusion Monster in your Extra Deck and both of its exact materials in your hand or on your field.";
  if (ops.includes("equip") || ops.includes("boost")) return "You need a face-up monster on your field to target.";
  if (ops.includes("destroy_target_st")) return "Your opponent has no Spell or Trap cards to destroy.";
  if (ops.includes("search_deck")) return "There are no matching monsters left in your Deck.";
  if (view.players[me].st.every(Boolean)) return "Your Spell & Trap zones are full.";
  return "Its activation conditions aren't met right now.";
}
