// Duel HUD: corner life-point plates, turn medallion + phase menu, hand, card detail panel, action
// bubbles, prompts and the guide. Purely a view of server state; every button maps to a legal action id.
import { card as cardData, typeLine, monsterKind, subtypeName } from "./carddb.js";
import { cardURL } from "./render/cardart.js";
import { guideMessage } from "./guide.js";
import { settings } from "./settings.js";
import { audio } from "./audio.js";

const $ = (id) => document.getElementById(id);
const PHASE_LABEL = { draw: "Draw", standby: "Standby", main1: "Main 1", battle: "Battle", main2: "Main 2", end: "End" };
const PHASE_HINT = { enter_battle: "Show me", enter_main2: "Show me", end_turn: "Show me" };
const REASONS = { lp: "Life Points reached zero.", deck_out: "A duelist could not draw a card.", concede: "A duelist surrendered.", disconnect: "A duelist disconnected." };
const BUBBLE = {
  normal_summon: ["⬆", "Summon"], set_monster: ["▼", "Set"], tribute_summon: ["✦", "Tribute"], activate_spell: ["✧", "Activate"],
  set_spell_trap: ["▼", "Set"], flip_summon: ["↻", "Flip"], change_position: ["⟲", "Position"], attack: ["⚔", "Attack"], discard: ["✕", "Discard"],
  contact_fusion: ["✺", "Combine"],
};
const BUBBLE_ORDER = ["contact_fusion", "normal_summon", "tribute_summon", "activate_spell", "attack", "flip_summon", "change_position", "set_monster", "set_spell_trap", "discard"];
const SLOT_ORDER = [2, 1, 3, 0, 4]; // the engine fills zones centre-first

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }

export class DuelUI {
  constructor(stage, net) {
    this.stage = stage;
    this.net = net;
    this.view = null;
    this.actions = [];
    this.decider = null;
    this.busy = false;
    this.sent = false;
    this.sel = null;
    this.choose = null;   // action kind whose variants are being chosen
    this.handIds = [];
    this.onLeave = null;
    this.onRematch = null;
    this.hover = null;      // card under the pointer (previewed in the detail panel)
    this.hoverHand = null;
    this.lpShown = {};      // displayed (rolling) LP per plate
    this.autoPassTimer = null;
    stage.onClick = (hit) => this.stageClick(hit);
    $("guide-min").onclick = () => { settings.set("guideMin", !settings.get("guideMin")); this.renderGuide(); };
    $("guide-close").onclick = () => settings.set("guide", false);
    $("btn-guide").onclick = () => settings.set("guide", !settings.get("guide"));
    $("medallion").onclick = () => { audio.play("ui_click"); this.menuOpen = !this.menuOpen; this.renderMedallion(); };
    settings.onChange((k) => {
      if (k === "guide" || k === "guideMin" || k === "guideHints") { this.renderGuide(true); this.renderHighlights(); this.renderHand(); }
      if (k === "logOpen") this.renderLog();
    });
    $("btn-log").onclick = () => { audio.play("ui_click"); settings.set("logOpen", !settings.get("logOpen")); };
    $("log-close").onclick = () => settings.set("logOpen", false);
    stage.onHover = (hit) => { this.hover = hit && hit.iid ? hit.iid : null; if (!this.busy) this.renderSelection(); };
    addEventListener("keydown", (e) => this.shortcut(e));
    this.renderLog();
    const skip = () => { if (this.busy) this.stage.boost = 4; };
    stage.canvas.addEventListener("pointerdown", skip);
    addEventListener("keydown", (e) => { if (e.code === "Space" && $("screen-duel").offsetParent !== null) { e.preventDefault(); skip(); } });
    addEventListener("resize", () => this.renderBubbles());
  }

  reset() {
    this.view = null; this.actions = []; this.sel = null; this.choose = null; this.handIds = []; this.menuOpen = false;
    this.hover = null; this.hoverHand = null; this.lpShown = {};
    clearTimeout(this.autoPassTimer);
    $("log-list").innerHTML = "";
    $("confirm").classList.add("hidden");
    $("end-screen").classList.add("hidden");
    $("selection").classList.add("hidden");
    $("bubbles").classList.add("hidden");
    $("phase-menu").classList.add("hidden");
    $("prompt").classList.add("hidden");
    $("hand").innerHTML = "";
    this.stage.highlights.clear();
    this.stage.zoneHighlights = [];
  }

  // ------------------------------------------------------------ state in
  setBusy(b) {
    this.busy = b;
    clearTimeout(this.skipTimer);
    if (b) {
      for (const id of ["selection", "bubbles", "phase-menu", "prompt"]) $(id).classList.add("hidden");
      this.stage.zoneHighlights = [];
      $("medallion").classList.remove("ready");
      this.skipTimer = setTimeout(() => $("skip-hint").classList.remove("hidden"), 900);
    } else {
      $("skip-hint").classList.add("hidden");
      this.render();
    }
  }

  updateView(view) {
    this.view = view;
    const me = view.you;
    for (const [p, id] of [[me, "lp-me"], [1 - me, "lp-opp"]]) {
      const pl = view.players[p];
      const box = $(id);
      const av = box.querySelector(".avatar");
      av.textContent = (pl.name || "?").trim().charAt(0).toUpperCase();
      const col = this.seatColors && this.seatColors[p];
      if (col) av.style.background = `radial-gradient(circle at 35% 30%, #fff 0, ${col} 30%, #0b0e1c 100%)`;
      box.querySelector(".lp-name").innerHTML = `${view.active === p ? '<span class="active-dot"></span>' : ""}${esc(pl.name)}`;
      this.rollLp(id, pl.lp);
      const max = view.profile === "frontier" ? 4000 : 8000;
      box.querySelector(".lp-fill").style.width = `${Math.max(0, Math.min(100, (pl.lp / max) * 100))}%`;
    }
    $("m-turn").textContent = view.active === null ? "Ready" : `Turn ${view.turn}`;
    $("m-phase").textContent = view.active === null ? "Duel" : PHASE_LABEL[view.phase] || "";
    $("medallion").classList.toggle("opp", view.active !== null && view.active !== me);
    const opp = view.players[1 - me];
    const backs = $("opp-hand");
    if (backs.childElementCount !== opp.hand_count) {
      backs.innerHTML = "";
      for (let i = 0; i < opp.hand_count; i++) {
        const b = el("div", "back");
        b.style.backgroundImage = `url(${cardURL(null)})`;
        backs.appendChild(b);
      }
    }
    this.renderHand();
  }

  // Life points count up/down instead of jumping.
  rollLp(id, target) {
    const el = $(id).querySelector(".lp-num");
    const from = this.lpShown[id] ?? target;
    this.lpShown[id] = target;
    if (from === target) { el.textContent = target; return; }
    if (target > from) { el.classList.remove("heal"); void el.offsetWidth; el.classList.add("heal"); }
    const t0 = performance.now(), dur = 700;
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(from + (target - from) * e);
      if (k < 1 && this.lpShown[id] === target) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  update(view, actions, decider, hint) {
    this.view = view;
    this.actions = actions || [];
    this.decider = decider;
    this.hint = hint && this.actions.some((a) => a.id === hint.id) ? hint : null;
    this.sent = false;
    this.menuOpen = false;
    if (this.sel && !this.cardExists(this.sel)) { this.sel = null; this.choose = null; }
    this.render();
    this.maybeAutoPass();
  }

  // When nothing can respond, pass automatically after a short random delay, so the timing reveals nothing.
  maybeAutoPass() {
    clearTimeout(this.autoPassTimer);
    const v = this.view;
    if (!settings.get("autoPass") || !v || !v.pending || v.pending.kind !== "response" || this.decider !== v.you) return;
    if (this.actions.length !== 1 || this.actions[0].kind !== "pass") return;
    const id = this.actions[0].id;
    this.autoPassTimer = setTimeout(() => { if (this.myTurnToAct() && this.actions.some((a) => a.id === id)) this.send(id); }, 700 + Math.random() * 900);
  }

  cardExists(iid) {
    return this.view.players.some((p) => (p.hand || []).some((c) => c.iid === iid) || p.monsters.some((m) => m && m.iid === iid) || p.st.some((c) => c && c.iid === iid) || (p.field && p.field.iid === iid));
  }

  lpHit(player) {
    const n = $(player === this.view.you ? "lp-me" : "lp-opp").querySelector(".lp-num");
    n.classList.remove("hurt"); void n.offsetWidth; n.classList.add("hurt");
  }

  banner(text, sub = "", color = "#fff", small = false) {
    const b = $("banner");
    b.classList.remove("hidden");
    b.style.color = color;
    b.style.fontSize = small ? "40px" : "54px";
    b.innerHTML = `<span class="ribbon">${sub ? `<small>${esc(sub)}</small>` : ""}${esc(text)}</span>`;
    b.style.animation = "none"; void b.offsetWidth; b.style.animation = "";
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => b.classList.add("hidden"), 1400 / Math.max(1, this.stage.speed * this.stage.boost));
  }

  error(msg) {
    audio.play("ui_error");
    this.sent = false;
    const g = $("guide-body");
    if (g) { g.textContent = msg; $("guide").classList.add("pulse"); setTimeout(() => $("guide").classList.remove("pulse"), 700); }
    this.render();
  }

  showEnd(won, reason) {
    const e = $("end-screen");
    e.classList.remove("hidden");
    e.innerHTML = `<div class="e-title ${won ? "win" : "lose"}">${won ? "Victory" : "Defeat"}</div>
      <div class="e-sub">${esc(REASONS[reason] || "")}</div>
      <div class="e-btns"><button class="btn primary" id="btn-rematch">Back to room</button><button class="btn" id="btn-end-leave">Leave room</button></div>`;
    $("btn-rematch").onclick = () => { audio.play("ui_click"); this.onRematch && this.onRematch(); };
    $("btn-end-leave").onclick = () => { audio.play("ui_click"); this.onLeave && this.onLeave(); };
  }

  // ------------------------------------------------------------- render
  myTurnToAct() { return this.view && this.decider === this.view.you && !this.busy && !this.sent; }
  // Actions for the selected card. A Combine belongs to every one of its materials.
  selActions() {
    if (!this.myTurnToAct() || !this.sel) return [];
    return this.actions.filter((a) => a.card === this.sel || (a.kind === "contact_fusion" && a.materials.includes(this.sel)));
  }

  render() {
    if (!this.view) return;
    this.renderHand();
    this.renderHighlights();
    this.renderMedallion();
    this.renderPrompt();
    this.renderSelection();
    this.renderBubbles();
    this.renderGuide();
  }

  renderHand() {
    const v = this.view;
    if (!v) return;
    const hand = v.players[v.you].hand || [];
    const box = $("hand");
    const ids = hand.map((c) => c.iid);
    const playable = new Set(this.myTurnToAct() ? this.actions.filter((a) => a.card).map((a) => a.card) : []);
    if (ids.join() !== this.handIds.join()) {
      const old = new Set(this.handIds);
      box.innerHTML = "";
      hand.forEach((c) => {
        const d = el("div", "hand-card" + (old.has(c.iid) ? "" : " enter"));
        d.dataset.iid = c.iid;
        const img = el("img"); img.src = cardURL(c.cid); img.alt = cardData(c.cid).name; img.draggable = false;
        d.appendChild(img);
        d.onclick = () => this.clickHand(c.iid);
        d.onmouseenter = () => { audio.play("ui_hover"); this.hoverHand = c.iid; this.hover = c.iid; this.layoutHand(); if (!this.busy) this.renderSelection(); };
        d.onmouseleave = () => { if (this.hoverHand === c.iid) { this.hoverHand = null; this.hover = null; this.layoutHand(); if (!this.busy) this.renderSelection(); } };
        d.addEventListener("transitionend", () => this.renderBubbles());
        box.appendChild(d);
      });
      this.handIds = ids;
    }
    for (const d of box.children) {
      d.classList.toggle("playable", playable.has(d.dataset.iid));
      const hint = this.activeHint();
      d.classList.toggle("suggested", !!hint && hint.card === d.dataset.iid);
      d.classList.toggle("sel", d.dataset.iid === this.sel);
    }
    this.layoutHand();
  }

  // Fan the hand along an arc; the hovered or selected card straightens and lifts.
  layoutHand() {
    const cards = [...$("hand").children], n = cards.length;
    const spread = Math.min(96, 720 / Math.max(1, n)), arc = Math.min(5, 30 / Math.max(1, n));
    cards.forEach((d, i) => {
      const k = i - (n - 1) / 2;
      const up = d.dataset.iid === this.sel ? -78 : d.dataset.iid === this.hoverHand ? -62 : 0;
      const rot = up ? 0 : k * arc, drop = up ? 0 : Math.abs(k) * Math.abs(k) * 1.6;
      d.style.transform = `translateX(${k * spread}px) translateY(${70 + drop + up}px) rotate(${rot}deg) scale(${up ? 1.12 : 1})`;
      d.style.zIndex = up ? 20 : i + 1;
    });
    this.renderBubbles();
  }

  renderHighlights() {
    const H = this.stage.highlights;
    H.clear();
    this.stage.zoneHighlights = [];
    if (!this.myTurnToAct()) return;
    const mine = this.view.players[this.view.you];
    for (const a of this.actions) {
      if (!a.card) continue;
      if (mine.monsters.some((m) => m && m.iid === a.card) || mine.st.some((c) => c && c.iid === a.card)) H.set(a.card, "actionable");
    }
    const hint = this.activeHint();
    if (hint && hint.card && H.has(hint.card)) H.set(hint.card, "hint");
    if (!this.sel) return;
    H.set(this.sel, "selected");
    const acts = this.selActions();
    const showTargets = this.choose ? acts.filter((a) => a.kind === this.choose) : acts.filter((a) => a.kind === "attack");
    for (const a of showTargets) if (a.target) H.set(a.target, "target");
    for (const a of acts) if (this.choose === a.kind) for (const t of a.tributes || a.materials || []) H.set(t, "target");
    // Show exactly which zone the card will occupy (the engine fills centre-first).
    const kinds = new Set(acts.map((a) => a.kind));
    if (kinds.has("normal_summon") || kinds.has("set_monster")) {
      const slot = SLOT_ORDER.find((i) => !mine.monsters[i]);
      if (slot !== undefined) this.stage.zoneHighlights.push({ side: 0, kind: "mon", slot });
    }
    if (kinds.has("set_spell_trap") || (kinds.has("activate_spell") && mine.hand.some((c) => c.iid === this.sel) && cardData(mine.hand.find((c) => c.iid === this.sel).cid).subtype !== "field")) {
      const slot = SLOT_ORDER.find((i) => !mine.st[i]);
      if (slot !== undefined) this.stage.zoneHighlights.push({ side: 0, kind: "st", slot });
    }
  }

  renderMedallion() {
    const med = $("medallion");
    const menu = $("phase-menu");
    const can = this.myTurnToAct() && !this.view.pending;
    const phaseActs = can ? this.actions.filter((a) => ["enter_battle", "enter_main2", "end_turn"].includes(a.kind)) : [];
    med.classList.toggle("ready", phaseActs.length > 0 && !this.actions.some((a) => a.card));
    if (!this.menuOpen || !phaseActs.length) { menu.classList.add("hidden"); return; }
    menu.classList.remove("hidden");
    menu.innerHTML = "";
    const label = { enter_battle: "Battle", enter_main2: "Main 2", end_turn: "End Turn" };
    for (const a of phaseActs) {
      const b = el("button", "", label[a.kind]);
      b.title = { enter_battle: "B", enter_main2: "M", end_turn: "E" }[a.kind];
      b.onclick = () => this.phaseAction(a);
      menu.appendChild(b);
    }
  }

  renderPrompt() {
    const p = $("prompt");
    const v = this.view;
    const pend = v.pending;
    if (!pend || this.busy || v.winner !== null) { p.classList.add("hidden"); return; }
    p.classList.remove("hidden");
    if (pend.player !== v.you) {
      p.className = "prompt waiting";
      p.textContent = pend.kind === "response" ? "Waiting for your opponent to respond…" : pend.kind === "choice" ? "Your opponent is choosing an effect…" : "Your opponent is discarding…";
      return;
    }
    p.className = "prompt";
    if (pend.kind === "discard") { p.innerHTML = `<div class="p-title">Hand limit: choose a card in your hand to discard.</div>`; return; }
    if (pend.kind === "choice") {
      p.innerHTML = `<div class="p-title">${esc(pend.text || "Choose")}</div><div class="p-btns"></div>`;
      const btns = p.querySelector(".p-btns");
      for (const a of this.actions) {
        const b = el("button", "btn" + (a.kind === "skip" ? "" : " primary"), esc(a.label));
        b.onclick = () => this.send(a.id);
        btns.appendChild(b);
      }
      return;
    }
    const about = pend.card && this.findCard(pend.card);
    const aboutName = about && about.cid ? cardData(about.cid).name : "";
    const title = pend.trigger === "opp_attack" ? "Your opponent declared an attack!"
      : pend.trigger === "opp_spell" ? `Your opponent activated ${esc(aboutName || "a Spell")}!`
      : `Your opponent summoned ${esc(aboutName || "a monster")}!`;
    p.innerHTML = `<div class="p-title">${title} Respond with a Set card?</div><div class="p-btns"></div>`;
    const btns = p.querySelector(".p-btns");
    for (const a of this.actions) {
      const b = el("button", "btn" + (a.kind === "pass" ? "" : " primary"), esc(a.label));
      b.onclick = () => this.send(a.id);
      btns.appendChild(b);
    }
  }

  findCard(iid) {
    for (const pl of this.view.players) for (const c of [...(pl.hand || []), ...pl.monsters, ...pl.st, pl.field]) if (c && c.iid === iid) return c;
    return null;
  }
  selectedCard() { return this.findCard(this.sel); }

  renderSelection() {
    const box = $("selection");
    // A selection locks the panel; otherwise it previews whatever is under the pointer.
    const c = (this.sel && this.selectedCard()) || (this.hover && this.findCard(this.hover));
    if (!c || this.busy) { box.classList.add("hidden"); return; }
    box.classList.remove("hidden");
    const d = cardData(c.cid);
    box.innerHTML = "";
    if (!d) {
      box.innerHTML = `<div class="d-head"><div class="d-name">Face-down card</div></div><div class="d-text">Its identity stays hidden until it's revealed.</div>`;
      return;
    }
    const head = el("div", "d-head", `<div class="d-name">${esc(d.name)}</div><div class="d-attr">${esc(d.type === "monster" ? d.attribute : d.type.toUpperCase())}</div>`);
    box.appendChild(head);
    const top = el("div", "d-top");
    const img = el("img"); img.src = cardURL(c.cid); img.alt = d.name; img.onclick = () => this.inspect(c.cid);
    top.appendChild(img);
    if (d.type === "monster") {
      const atk = c.atk ?? d.atk, def = c.defense ?? d.def;
      top.appendChild(el("div", "d-stats", `<span><i>LEVEL</i>★ ${d.level}</span><span class="${atk > d.atk ? "up" : ""}"><i>ATK</i>${atk}</span><span class="${def > d.def ? "up" : ""}"><i>DEF</i>${def}</span>${c.position ? `<span><i>POS</i>${c.position === "atk" ? "Attack" : "Defense"}</span>` : ""}`));
    } else {
      top.appendChild(el("div", "d-stats", `<span><i>TYPE</i>${esc(subtypeName(d) || "Normal")}</span>`));
    }
    box.appendChild(top);
    box.appendChild(el("div", "d-type", esc(d.type === "monster" ? `[${d.race} / ${monsterKind(d)}]` : typeLine(d))));
    box.appendChild(el("div", "d-text", esc(d.text)));
    // Variant choices (which tributes, which target, which materials).
    if (c.iid !== this.sel) return; // hover preview: no choices
    const acts = this.selActions().filter((a) => a.kind === this.choose);
    if (acts.length) {
      const list = el("div", "d-variants");
      const title = { tribute_summon: "Choose tributes", attack: "Choose a target", activate_spell: "Choose how to activate" }[this.choose] || "Choose";
      list.appendChild(el("div", "v-title", title));
      for (const a of acts) {
        const b = el("button", "act-btn", esc(a.label));
        b.onclick = () => this.send(a.id);
        const hl = a.tributes || a.materials || (a.target ? [a.target] : null);
        if (hl) {
          b.onmouseenter = () => { for (const t of hl) this.stage.highlights.set(t, "target"); };
          b.onmouseleave = () => this.renderHighlights();
        }
        list.appendChild(b);
      }
      box.appendChild(list);
    } else if (this.myTurnToAct() && !this.selActions().length) {
      box.appendChild(el("div", "sel-note", "No actions for this card right now. The guide explains why."));
    }
  }

  // Round action buttons above the selected card (hand or field).
  renderBubbles() {
    const box = $("bubbles");
    const acts = this.selActions();
    if (!acts.length || this.busy) { box.classList.add("hidden"); return; }
    const pos = this.selAnchor();
    if (!pos) { box.classList.add("hidden"); return; }
    box.classList.remove("hidden");
    box.style.left = `${pos.x}px`;
    box.style.top = `${pos.y}px`;
    box.innerHTML = "";
    const groups = new Map();
    for (const a of acts) { if (!groups.has(a.kind)) groups.set(a.kind, []); groups.get(a.kind).push(a); }
    for (const kind of BUBBLE_ORDER) {
      const g = groups.get(kind);
      if (!g) continue;
      const [icon, label] = BUBBLE[kind] || ["•", kind];
      const b = el("button", "bubble" + (kind.startsWith("set") ? " secondary" : kind === "discard" ? " danger" : "" ) + (this.choose === kind ? " on" : ""),
        `<span class="b-icon">${icon}</span><span class="b-label">${label}</span>`);
      b.onclick = () => {
        audio.play("ui_click");
        if (g.length === 1) return this.send(g[0].id);
        this.choose = this.choose === kind ? null : kind;
        this.render();
      };
      box.appendChild(b);
    }
  }

  selAnchor() {
    const mine = this.view.players[this.view.you];
    if ((mine.hand || []).some((c) => c.iid === this.sel)) {
      const elx = document.querySelector(`.hand-card[data-iid="${this.sel}"]`);
      if (!elx) return null;
      const ui = $("ui").getBoundingClientRect(), r = elx.getBoundingClientRect(), f = this.stage.fit;
      return { x: (r.left + r.width / 2 - ui.left) / f, y: (r.top - ui.top) / f - 12 };
    }
    const p = this.stage.cardPos(this.sel);
    return { x: p.x, y: p.y - 70 * (p.s || 1) };
  }

  renderGuide(force) {
    const g = $("guide");
    const on = settings.get("guide");
    $("btn-guide").classList.toggle("off", !on);
    g.classList.toggle("hidden", !on || !this.view);
    g.classList.toggle("min", !!settings.get("guideMin"));
    $("guide-min").textContent = settings.get("guideMin") ? "+" : "–";
    if (!on || !this.view) return;
    // Never change mid-animation or while our action is in flight (the action list is stale then).
    if ((this.busy || this.sent) && !force) return;
    const acts = this.view && this.decider === this.view.you ? this.actions : [];
    const body = $("guide-body");
    body.innerHTML = `<div class="g-text">${esc(guideMessage(this.view, acts, this.decider, this.sel, this.choose))}</div>`;
    const h = this.activeHint();
    if (!h) return;
    // Advice only: "Show me" selects the card so the player can see the option; it never plays it.
    const box = el("div", "g-hint", `<div class="g-hint-title">★ Suggested play</div><div class="g-hint-label">${esc(h.label)}</div>${h.why ? `<div class="g-hint-why">${esc(h.why)}</div>` : ""}`);
    const show = el("button", "g-show", h.card && this.isMine(h.card) ? "Show me" : PHASE_HINT[h.kind] || "");
    if (show.textContent) {
      show.onclick = () => this.showHint(h);
      box.appendChild(show);
    }
    body.appendChild(box);
  }

  activeHint() {
    if (!settings.get("guide") || !settings.get("guideHints") || !this.hint || !this.myTurnToAct() || this.busy || this.sent) return null;
    return this.hint;
  }

  isMine(iid) {
    const mine = this.view.players[this.view.you];
    return (mine.hand || []).some((c) => c.iid === iid) || mine.monsters.some((m) => m && m.iid === iid) || mine.st.some((c) => c && c.iid === iid);
  }

  showHint(h) {
    audio.play("ui_click");
    if (h.card && this.isMine(h.card)) {
      this.sel = h.card;
      const variants = this.selActions().filter((a) => a.kind === h.kind);
      this.choose = variants.length > 1 ? h.kind : null;
      this.render();
      if (h.target) this.stage.highlights.set(h.target, "target");
      return;
    }
    // Phase moves: point at the turn medallion.
    const m = $("medallion");
    m.classList.remove("hint-pulse"); void m.offsetWidth; m.classList.add("hint-pulse");
  }

  // ------------------------------------------------------------- input
  // Phase changes from the medallion or keyboard; ending the turn can ask for confirmation.
  phaseAction(a) {
    if (a.kind !== "end_turn" || !settings.get("confirmEnd")) return this.send(a.id);
    const canAttack = this.actions.some((x) => x.kind === "attack");
    const canSummon = this.actions.some((x) => x.kind === "normal_summon" || x.kind === "tribute_summon");
    const canBattle = this.actions.some((x) => x.kind === "enter_battle") && this.view.players[this.view.you].monsters.some((m) => m && m.face_up && m.position === "atk");
    if (!canAttack && !canSummon && !canBattle) return this.send(a.id);
    const what = canAttack ? "attack with a monster" : canBattle ? "enter the Battle Phase and attack" : "summon a monster";
    const box = $("confirm");
    box.classList.remove("hidden");
    box.innerHTML = `<div class="c-title">End your turn?</div><div class="c-text">You can still ${what} this turn.</div>
      <div class="c-btns"><button class="btn" id="c-no">Keep playing</button><button class="btn primary" id="c-yes">End Turn</button></div>`;
    this.menuOpen = false; this.renderMedallion();
    $("c-no").onclick = () => { audio.play("ui_click"); box.classList.add("hidden"); };
    $("c-yes").onclick = () => { box.classList.add("hidden"); this.send(a.id); };
  }

  shortcut(e) {
    if ($("screen-duel").offsetParent === null || e.target.tagName === "INPUT" || e.metaKey || e.ctrlKey) return;
    const modalOpen = !$("modal-settings").classList.contains("hidden") || !$("modal-inspect").classList.contains("hidden");
    if (e.code === "Escape") {
      if (!$("modal-inspect").classList.contains("hidden")) $("modal-inspect").classList.add("hidden");
      else if (!$("confirm").classList.contains("hidden")) $("confirm").classList.add("hidden");
      else if (this.sel || this.menuOpen) { this.sel = null; this.choose = null; this.menuOpen = false; this.render(); }
      else $("btn-settings").click();
      return;
    }
    if (modalOpen) return;
    if (e.code === "KeyG") return settings.set("guide", !settings.get("guide"));
    if (e.code === "KeyL") return settings.set("logOpen", !settings.get("logOpen"));
    const kind = { KeyB: "enter_battle", KeyM: "enter_main2", KeyE: "end_turn" }[e.code];
    if (!kind || !this.myTurnToAct() || this.view.pending) return;
    const a = this.actions.find((x) => x.kind === kind);
    if (a) this.phaseAction(a);
  }

  renderLog() {
    const open = !!settings.get("logOpen");
    $("log").classList.toggle("hidden", !open);
    $("btn-log").classList.toggle("on", open);
  }

  // One readable line per meaningful event, from the viewer's own (redacted) information.
  logEvent(ev) {
    const v = ev.view;
    if (!v) return;
    const me = v.you;
    const who = (p) => (p === me ? "You" : esc(v.players[p].name));
    const nm = (cid) => (cid ? `<b>${esc(cardData(cid).name)}</b>` : "a card");
    const cidOf = (iid) => { for (const pl of v.players) for (const c of [...pl.monsters, ...pl.st, ...pl.gy, pl.field]) if (c && c.iid === iid && c.cid) return c.cid; return null; };
    let text = null, cls = ev.player === me ? "me" : ev.player !== undefined ? "opp" : "";
    switch (ev.type) {
      case "TURN_STARTED": text = `Turn ${ev.turn} · ${ev.player === me ? "Your turn" : `${esc(v.players[ev.player].name)}'s turn`}`; cls = "turn"; break;
      case "MONSTER_SUMMONED": text = `${who(ev.player)} ${{ tribute: "Tribute Summoned", fusion: "Fusion Summoned", revive: "revived", ascension: "Ascension Summoned", effect: "Special Summoned" }[ev.method] || "summoned"} ${nm(ev.cid)}.`; break;
      case "MONSTER_SET": text = `${who(ev.player)} Set a monster.`; break;
      case "CARD_SET": text = `${who(ev.player)} Set a card.`; break;
      case "MONSTER_FLIPPED": text = `${nm(ev.cid)} was flipped face-up.`; break;
      case "SPELL_ACTIVATED": text = `${who(ev.player)} activated ${nm(ev.cid)}.`; break;
      case "TRAP_ACTIVATED": text = `${who(ev.player)} sprang ${nm(ev.cid)}!`; break;
      case "ATTACK_DECLARED": text = `${nm(cidOf(ev.attacker))} attacks ${ev.target ? nm(cidOf(ev.target)) : "directly"}.`; break;
      case "ATTACK_NEGATED": text = `The attack was negated.`; break;
      case "MONSTER_DESTROYED": text = `${nm(ev.cid)} was destroyed.`; cls = ev.player === me ? "me" : "opp"; break;
      case "LIFE_POINTS_CHANGED": text = `${who(ev.player)} ${ev.delta < 0 ? "took" : "gained"} <b>${Math.abs(ev.delta)}</b> (LP ${ev.lp}).`; break;
      case "FIELD_SPELL_ACTIVATED": text = `The field became ${nm(ev.cid)}.`; break;
      case "EFFECT_EXPIRED": text = `${nm(ev.cid)} faded away.`; break;
      case "FUSION_SUMMON_STARTED": if (!ev.contact) return; text = `${who(ev.player)} combined ${ev.materials.map((m) => nm(m.cid)).join(" + ")}!`; break;
      case "ASCENSION_STARTED": text = `${who(ev.player)} offered ${nm(ev.material.cid)} to Ascend!`; cls = "turn"; break;
      case "MONSTER_EFFECT": text = `${nm(ev.cid)}'s effect: ${esc(ev.text || "activated")}.`; break;
      case "EQUIP_ATTACHED": text = `${nm(ev.cid)} was equipped to ${nm(cidOf(ev.target))} (+${ev.atk} ATK${ev.defense ? `, +${ev.defense} DEF` : ""}).`; break;
      case "MONSTER_BOOSTED": text = `${nm(ev.cid)} gained <b>${ev.amount}</b> ATK this turn.`; break;
      case "CARD_DESTROYED": text = `${ev.was_face_up ? nm(ev.cid) : `A Set ${nm(ev.cid)}`} was destroyed.`; cls = ev.player === me ? "me" : "opp"; break;
      case "SPELL_NEGATED": text = `${nm(ev.cid)} was negated!`; cls = ev.player === me ? "me" : "opp"; break;
      case "CARD_ADDED_TO_HAND": text = `${who(ev.player)} added ${nm(ev.cid)} from the Deck to the hand.`; break;
      case "FIELD_SPELL_REMOVED": if (ev.reason !== "destroyed") return; text = `${nm(ev.cid)} was destroyed.`; break;
      case "CARD_DRAWN": if (ev.reason !== "refill") return; text = `${who(ev.player)} refilled the hand to 4 cards.`; break;
      case "DUEL_WON": text = `${ev.player === me ? "You win" : `${esc(v.players[ev.player].name)} wins`}!`; cls = "turn"; break;
      default: return;
    }
    const list = $("log-list");
    const li = el("li", cls, text);
    list.appendChild(li);
    while (list.childElementCount > 80) list.firstChild.remove();
    list.scrollTop = list.scrollHeight;
  }

  send(id) {
    if (!this.myTurnToAct()) return;
    clearTimeout(this.autoPassTimer);
    audio.play("ui_click");
    this.sent = true;
    this.sel = null;
    this.choose = null;
    this.menuOpen = false;
    this.net.send({ t: "act", id });
    this.render();
  }

  clickHand(iid) {
    audio.play("ui_click");
    const v = this.view;
    if (v.pending && v.pending.kind === "discard" && v.pending.player === v.you) {
      const a = this.actions.find((x) => x.kind === "discard" && x.card === iid);
      if (a) return this.send(a.id);
    }
    this.sel = this.sel === iid ? null : iid;
    this.choose = null;
    this.render();
  }

  stageClick(hit) {
    if (this.busy) return;
    if (this.menuOpen) { this.menuOpen = false; this.renderMedallion(); }
    if (!hit || hit.kind === "zone") { if (this.sel) { this.sel = null; this.choose = null; this.render(); } return; }
    if (hit.kind === "gy") { this.showGraveyard(hit.player); return; }
    audio.play("ui_click");
    // Clicking a highlighted target with an attacker / targeted spell selected performs that action.
    if (this.sel && this.myTurnToAct()) {
      const a = this.actions.find((x) => x.card === this.sel && x.target === hit.iid && (!this.choose || x.kind === this.choose));
      if (a) return this.send(a.id);
    }
    this.sel = this.sel === hit.iid ? null : hit.iid;
    this.choose = null;
    // Selecting an attacker goes straight to choosing its target.
    if (this.sel && this.selActions().filter((a) => a.kind === "attack").length > 1) this.choose = "attack";
    this.render();
  }

  inspect(cid, list) {
    const m = $("modal-inspect");
    const body = $("inspect-body");
    const show = (id) => {
      const c = cardData(id);
      body.innerHTML = `<img src="${cardURL(id)}" alt="${esc(c.name)}"><div class="i-info"><div class="i-name">${esc(c.name)}</div><div class="i-meta">${esc(typeLine(c))}</div>
        ${c.type === "monster" ? `<div class="i-meta">ATK ${c.atk} · DEF ${c.def}</div>` : ""}<div class="i-text">${esc(c.text)}</div>
        ${list ? `<div class="i-list">${list.map((x) => `<img data-cid="${x.cid}" src="${cardURL(x.cid)}" alt="">`).join("")}</div>` : ""}
        <button class="btn" id="btn-close-inspect" style="align-self:flex-start;margin-top:auto">Close</button></div>`;
      body.querySelectorAll(".i-list img").forEach((im) => (im.onclick = () => show(im.dataset.cid)));
      $("btn-close-inspect").onclick = () => m.classList.add("hidden");
    };
    show(cid);
    m.classList.remove("hidden");
    m.onclick = (e) => { if (e.target === m) m.classList.add("hidden"); };
  }

  showGraveyard(player) {
    const gy = this.view.players[player].gy;
    if (!gy.length) return;
    audio.play("ui_click");
    this.inspect(gy[gy.length - 1].cid, [...gy].reverse());
  }
}
