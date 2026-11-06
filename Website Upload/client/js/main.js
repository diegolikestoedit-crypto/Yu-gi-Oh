// Application shell: screens, lobby, collection, settings, and the wiring between network, director and UI.
import { loadCards, allCards, card as cardData, typeLine } from "./carddb.js";
import { settings } from "./settings.js";
import { audio } from "./audio.js";
import { Net } from "./net.js";
import { Stage } from "./render/stage.js";
import { Director } from "./director.js";
import { DuelUI } from "./duelui.js";
import { cardURL } from "./render/cardart.js";
import { Showcase, spriteCover } from "./showcase.js";
import { ARENA_LIST } from "./render/arenas.js";
import { Environment } from "./render/env.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const state = { screen: "menu", decks: [], profiles: {}, room: null, seat: null, inDuel: false, showingEnd: false, solo: false, pick: "me", role: "" };
const DIFFICULTIES = [["easy", "Easy"], ["normal", "Normal"], ["hard", "Hard"]];
let stage, net, ui, director, showcase;
let profileChoice = settings.get("lastProfile") || "citadel";
let colType = "";

function show(screen) {
  state.screen = screen;
  for (const s of ["menu", "online", "collection", "duel"]) $(`screen-${s}`).classList.toggle("hidden", s !== screen);
  stage.active = screen === "duel";
  if (screen === "collection") renderCollection();
  if (screen === "online") renderLobby();
  if (showcase) screen === "menu" ? showcase.start() : showcase.stop();
}

// ------------------------------------------------------------------ lobby
function deckCounts(deck) {
  const n = { m: 0, s: 0, t: 0 };
  for (const cid of deck.main || []) { const c = cardData(cid); if (c) n[c.type[0]]++; }
  return n;
}

function renderDifficulty(seg, current, onPick) {
  seg.innerHTML = DIFFICULTIES.map(([k, n]) => `<button data-v="${k}" class="${k === current ? "on" : ""}">${n}</button>`).join("");
  seg.querySelectorAll("button").forEach((b) => (b.onclick = () => { if (b.dataset.v !== current) { audio.play("ui_click"); onPick(b.dataset.v); } }));
}

function renderLobby() {
  const room = state.room;
  const solo = room ? !!room.solo : state.solo;
  $("screen-online").classList.toggle("solo", solo);
  $("lobby-title").textContent = solo ? "Solo Duel" : "Online Duel";
  if (!room) renderDifficulty($("seg-difficulty-entry"), settings.get("difficulty") || "normal", (v) => { settings.set("difficulty", v); renderLobby(); });
  $("lobby-entry").classList.toggle("hidden", !!room);
  $("lobby-room").classList.toggle("hidden", !room);
  if (!room) return;
  $("room-code").textContent = room.code;
  const prof = room.profiles[room.profile];
  $("room-rules").innerHTML = `<b>${esc(prof.name)}</b><br>${esc(prof.summary)}${room.showcase ? "<br>Showcase opening on" : ""}`;
  const seats = $("seats");
  seats.innerHTML = "";
  room.seats.forEach((s, i) => {
    if (i === 1) { const vs = document.createElement("div"); vs.className = "vs"; vs.textContent = "VS"; seats.appendChild(vs); }
    const d = document.createElement("div");
    if (!s) {
      d.className = "seat empty";
      d.innerHTML = `<span class="pulse"></span>&nbsp;${i === 1 ? "Waiting for an opponent… share the room code" : "Empty seat"}`;
    } else {
      const deck = state.decks.find((x) => x.id === s.deck);
      const du = deck && deck.duelist;
      d.className = `seat p${i + 1}` + (i === state.seat ? " you" : "") + (s.ready ? " ready" : "");
      const level = s.bot && DIFFICULTIES.find(([k]) => k === room.difficulty);
      d.innerHTML = `<div class="s-av${s.bot ? " bot" : ""}">${s.bot ? "♜" : esc(s.name.charAt(0).toUpperCase())}</div>
        <div class="s-info"><div class="s-name">${esc(s.name)}${i === state.seat ? " (you)" : ""}${s.bot ? `<span class="s-bot">COMPUTER</span>` : ""}</div>
        <div class="s-meta">${s.bot ? `${level ? level[1] : ""} · ` : i === 0 && !room.solo ? "Host · " : ""}${du && !s.bot ? `Playing as <b>${esc(du.name)}</b> · ` : ""}${esc(deck ? deck.name : s.deck)}${s.connected ? "" : " · <span style='color:var(--bad)'>disconnected</span>"}</div>
        <span class="s-ready ${s.ready ? "on" : ""}">${s.bot ? "WAITING FOR YOU" : s.ready ? "READY" : "CHOOSING…"}</span></div>
        ${deck && deck.signature ? `<img class="s-cover" src="${spriteCover(deck.signature, 72)}" alt="">` : ""}`;
    }
    seats.appendChild(d);
  });
  const me = room.seats[state.seat];
  if (room.solo) {
    renderDifficulty($("seg-difficulty-room"), room.difficulty, (v) => { settings.set("difficulty", v); net.send({ t: "settings", difficulty: v }); });
    $("seg-pick").querySelectorAll("button").forEach((b) => {
      b.classList.toggle("on", b.dataset.v === state.pick);
      b.onclick = () => { audio.play("ui_click"); state.pick = b.dataset.v; renderLobby(); };
    });
  } else state.pick = "me";
  $("deck-step-title").textContent = room.solo ? (state.pick === "bot" ? "Choose your opponent" : "Choose your duelist") : "Choose your deck";
  renderArenas(room);
  renderDecks(me, room);
  ui.seatColors = room.seats.map((s) => { const dk = s && state.decks.find((x) => x.id === s.deck); return dk && dk.duelist ? dk.duelist.color : null; });
  if (me) {
    $("btn-ready").textContent = room.solo ? "Start Duel" : me.ready ? "Cancel Ready" : "Ready";
    $("btn-leave").textContent = room.solo ? "Back" : "Leave Room";
    $("btn-ready").disabled = !room.seats[1 - state.seat];
    $("deck-hint").textContent = room.solo
      ? (state.pick === "bot" ? "Pick who the computer plays as." : "Pick your deck, then press Start Duel.")
      : me.ready ? "You're ready. Cancel ready to change decks." : "Pick a preset deck, then press Ready.";
  }
}

// Arena previews are rendered from the real arena art, once each.
const arenaThumbs = new Map();
let thumbEnv = null;
function arenaThumb(id) {
  if (arenaThumbs.has(id)) return arenaThumbs.get(id);
  thumbEnv = thumbEnv || new Environment();
  const cv = document.createElement("canvas");
  cv.width = 480; cv.height = 270;
  const c = cv.getContext("2d");
  const k = cv.width / 1600;
  c.scale(k, k);
  thumbEnv.board = true;
  thumbEnv.current = id;
  thumbEnv.drawTheme(c, id, { x0: 0, y0: 0, x1: 1600, y1: 900 }, 0, k);
  const url = cv.toDataURL("image/jpeg", 0.85);
  arenaThumbs.set(id, url);
  return url;
}

function renderArenas(room) {
  const g = $("arena-gallery");
  const host = state.seat === 0;
  const me = room.seats[state.seat];
  $("arena-hint").textContent = room.solo ? "Pick where the duel takes place." : host ? "You're the host: pick where the duel takes place." : "The host picks the battlefield.";
  g.innerHTML = "";
  for (const a of ARENA_LIST) {
    const t = document.createElement("div");
    t.className = "arena-tile" + (room.arena === a.id ? " on" : "") + (host ? "" : " locked");
    t.innerHTML = `<div class="dt-check">✓</div><img src="${arenaThumb(a.id)}" alt=""><div class="at-body"><div class="at-name">${esc(a.name)}</div><div class="at-desc">${esc(a.desc)}</div></div>`;
    t.onclick = () => {
      if (!host || room.arena === a.id || (me && me.ready)) return;
      audio.play("ui_click");
      settings.set("lastArena", a.id);
      net.send({ t: "settings", arena: a.id });
    };
    g.appendChild(t);
  }
  // Preview the chosen arena behind the lobby.
  if (stage.baseEnv !== room.arena) { stage.baseEnv = room.arena; stage.env.transition(room.arena, 1.2, { x: 800, y: 450 }); }
}

const ROLES = [["hero", "Hero"], ["rival", "Rival"], ["friend", "Friends"], ["villain", "Villains"]];

function renderDecks(me, room) {
  const bot = room && room.solo ? room.seats[1] : null;
  const pickBot = bot && state.pick === "bot";
  const g = $("deck-gallery");
  g.innerHTML = "";
  const order = (d) => ROLES.findIndex(([r]) => r === (d.duelist && d.duelist.role));
  const decks = [...state.decks].sort((a, b) => order(a) - order(b)).filter((d) => !state.role || (d.duelist && d.duelist.role === state.role));
  $("seg-role").querySelectorAll("button").forEach((b) => {
    b.classList.toggle("on", b.dataset.v === state.role);
    b.onclick = () => { audio.play("ui_click"); state.role = b.dataset.v; renderLobby(); };
  });
  for (const d of decks) {
    const du = d.duelist || { name: d.name, title: "", role: "", color: "#f4cf6a" };
    const n = deckCounts(d);
    const t = document.createElement("div");
    const chosen = pickBot ? bot.deck === d.id : me && me.deck === d.id;
    t.className = "deck-tile" + (chosen ? pickBot ? " on opp-pick" : " on" : "");
    t.style.setProperty("--duelist", du.color);
    t.innerHTML = `${bot && bot.deck === d.id && !pickBot ? `<div class="dt-vs">OPPONENT</div>` : ""}<div class="dt-check">✓</div><button class="dt-view">View list</button>
      <div class="dt-art">${d.signature ? `<img src="${spriteCover(d.signature, 80)}" alt="">` : ""}</div>
      <div class="dt-body"><div class="dt-role">${esc(du.role.toUpperCase())}</div><div class="dt-name">${esc(du.name)}</div>
      <div class="dt-title">${esc(du.title)} · <b>${esc(d.name)}</b></div><div class="dt-desc">${esc(d.description || "")}</div>
      <div class="dt-stats"><span class="m">${n.m} Monsters</span><span class="s">${n.s} Spells</span><span class="t">${n.t} Traps</span></div></div>`;
    t.onclick = (e) => {
      if (e.target.classList.contains("dt-view")) return;
      if (pickBot) {
        if (bot.deck === d.id) return;
        audio.play("ui_click");
        settings.set("lastBotDeck", d.id);
        return net.send({ t: "settings", bot_deck: d.id });
      }
      if (!me || me.ready || me.deck === d.id) return;
      audio.play("ui_click");
      settings.set("lastDeck", d.id);
      net.send({ t: "deck", deck: d.id });
    };
    t.querySelector(".dt-view").onclick = () => {
      audio.play("ui_click");
      const list = [...d.main, ...(d.extra || [])].map((cid) => ({ cid }));
      if (list.length) ui.inspect(d.signature || list[0].cid, list);
    };
    g.appendChild(t);
  }
}

function lobbyError(msg) {
  $("lobby-error").textContent = msg || "";
  if (msg) audio.play("ui_error");
}

function populateSelects() {
  const seg = $("seg-profile");
  seg.innerHTML = Object.entries(state.profiles).map(([k, p]) => `<button data-v="${k}">${esc(p.name)}</button>`).join("");
  const sync = () => {
    seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === profileChoice));
    $("profile-summary").textContent = state.profiles[profileChoice]?.summary || "";
  };
  seg.querySelectorAll("button").forEach((b) => (b.onclick = () => { audio.play("ui_click"); profileChoice = b.dataset.v; settings.set("lastProfile", profileChoice); sync(); }));
  if (!state.profiles[profileChoice]) profileChoice = Object.keys(state.profiles)[0];
  sync();
}

function playerName() {
  const n = $("in-name").value.trim() || "Duelist";
  settings.set("name", n);
  return n;
}

// -------------------------------------------------------------- collection
function renderCollection() {
  const q = $("col-search").value.trim().toLowerCase();
  const type = colType;
  const grid = $("col-grid");
  grid.innerHTML = "";
  for (const c of allCards()) {
    if (type && c.type !== type) continue;
    if (q && !(c.name.toLowerCase().includes(q) || c.text.toLowerCase().includes(q) || (c.race || "").toLowerCase().includes(q))) continue;
    const d = document.createElement("div");
    d.className = "col-card";
    d.innerHTML = `<img src="${cardURL(c.id)}" alt="${esc(c.name)}" title="${esc(c.name)} · ${esc(typeLine(c))}">`;
    d.onclick = () => { audio.play("ui_click"); ui.inspect(c.id); };
    grid.appendChild(d);
  }
}

// ---------------------------------------------------------------- settings
function wireSettings() {
  const modal = $("modal-settings");
  const refresh = () => {
    modal.querySelectorAll(".seg").forEach((seg) => {
      const k = seg.dataset.setting;
      seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", String(settings.get(k)) === b.dataset.v));
    });
    modal.querySelectorAll("input[type=range]").forEach((r) => (r.value = settings.get(r.dataset.setting)));
    $("btn-concede").classList.toggle("hidden", !(state.inDuel && ui.view && ui.view.winner === null));
  };
  modal.querySelectorAll(".seg button").forEach((b) => {
    b.onclick = () => {
      const k = b.parentElement.dataset.setting, raw = b.dataset.v;
      const v = raw === "true" ? true : raw === "false" ? false : isNaN(Number(raw)) ? raw : Number(raw);
      settings.set(k, v);
      audio.play("ui_click");
      refresh();
    };
  });
  modal.querySelectorAll("input[type=range]").forEach((r) => (r.oninput = () => settings.set(r.dataset.setting, Number(r.value))));
  modal.querySelectorAll("#set-tabs button").forEach((b) => (b.onclick = () => {
    audio.play("ui_click");
    modal.querySelectorAll("#set-tabs button").forEach((x) => x.classList.toggle("on", x === b));
    modal.querySelectorAll(".set-page").forEach((pg) => pg.classList.toggle("hidden", pg.dataset.page !== b.dataset.tab));
  }));
  const open = () => { refresh(); modal.classList.remove("hidden"); };
  $("btn-settings").onclick = open;
  $("btn-close-settings").onclick = () => { audio.play("ui_click"); modal.classList.add("hidden"); };
  modal.onclick = (e) => { if (e.target === modal) modal.classList.add("hidden"); };
  $("btn-concede").onclick = () => {
    if (confirm("Surrender this duel?")) { net.send({ t: "concede" }); modal.classList.add("hidden"); }
  };
  settings.onChange((k, v) => {
    if (k === "animSpeed") stage.speed = Number(v);
    if (k === "quality") { stage.quality = v; stage.particles.setQuality(v); stage.perfFloor = v === "low" ? 2 : 0; stage.setPerf(stage.perfFloor); }
    if (k === "camera") stage.cameraMotion = !!v;
    if (k === "figures") stage.figures = v;
    refresh();
  });
  stage.speed = Number(settings.get("animSpeed"));
  stage.quality = settings.get("quality");
  stage.particles.setQuality(stage.quality);
  stage.perfFloor = stage.quality === "low" ? 2 : 0;
  stage.setPerf(stage.perfFloor);
  stage.cameraMotion = !!settings.get("camera");
  stage.figures = settings.get("figures");
  return open;
}

// ------------------------------------------------------------------- net
function wireNet() {
  net.on("status", ({ status }) => {
    const c = $("conn-status");
    c.className = "conn " + (status === "online" ? "ok" : status === "offline" ? "bad" : "");
    c.querySelector(".txt").textContent = status === "online" ? "Connected to server" : status === "offline" ? "Disconnected: reconnecting…" : "Connecting…";
    if (state.inDuel && status === "offline") {
      $("opp-status").classList.remove("hidden");
      $("opp-status").textContent = "Connection lost. Reconnecting…";
    }
  });
  net.on("hello", (m) => {
    state.decks = m.decks;
    state.profiles = m.profiles;
    populateSelects();
    renderLobby();
  });
  net.on("welcome", () => lobbyError(""));
  net.on("room", (m) => {
    state.room = m.room;
    state.seat = m.you;
    if (m.room.state === "duel") {
      if (!state.inDuel) {
        state.inDuel = true;
        state.showingEnd = false;
        ui.reset();
        stage.actors.clear();
        stage.impacts = [];
        stage.baseEnv = m.room.arena || "meadow";
        show("duel");
      }
    } else if (state.inDuel && m.room.state === "ended") {
      state.showingEnd = true; // keep the end screen up until the player leaves it
    } else if (!state.showingEnd) {
      state.inDuel = false;
      if (state.screen === "duel" || state.screen === "menu") show("online");
    }
    renderLobby();
  });
  net.on("duel", (m) => {
    if (m.sync) {
      ui.reset();
      stage.actors.clear();
      if (state.room) stage.baseEnv = state.room.arena || stage.baseEnv;
      state.inDuel = true;
      if (m.view.winner === null) state.showingEnd = false;
      show("duel");
      $("opp-status").classList.add("hidden");
    }
    director.push(m);
  });
  net.on("opponent", (m) => {
    const s = $("opp-status");
    if (m.connected) { s.classList.add("hidden"); return; }
    s.classList.remove("hidden");
    s.textContent = `Opponent disconnected. Waiting up to ${m.grace}s for them to return…`;
  });
  net.on("error", (m) => (state.inDuel ? ui.error(m.msg) : lobbyError(m.msg)));
  net.on("left", () => {
    state.room = null; state.inDuel = false; state.showingEnd = false;
    audio.stopMusic();
    show("online");
    renderLobby();
  });
}

// ---------------------------------------------------------- dev replays
// ?replay=<name> plays a scripted duel recorded by server/tools/make_replays.py through the real director,
// with no server. For screenshots, window.__freeze("ATTACK_RESOLVED", 1.2) freezes time 1.2s into the
// next event of that type; window.__resume() continues.
async function runReplay(name) {
  const data = await (await fetch(`dev/replays/${encodeURIComponent(name)}.json`)).json();
  state.inDuel = true;
  ui.reset();
  show("duel");
  const R = (window.__replay = { name, total: data.messages.length, index: 0, done: false, events: [] });
  Object.assign(window, { __stage: stage, __director: director });
  const pending = [];
  window.__freeze = (type, after = 0) => pending.push({ type, after });
  window.__resume = () => { stage.speed = Number(settings.get("animSpeed")); };
  for (const type of Object.getOwnPropertyNames(Object.getPrototypeOf(director))) {
    if (!/^[A-Z_]+$/.test(type)) continue;
    const orig = director[type].bind(director);
    director[type] = (ev) => {
      R.events.push(type);
      const i = pending.findIndex((p) => p.type === type);
      if (i >= 0) {
        // Freeze on the stage clock, not wall time, so the frame is the same however fast the page renders.
        const { after } = pending.splice(i, 1)[0];
        const t0 = stage.time;
        const poll = setInterval(() => {
          if (stage.time - t0 >= after * stage.speed) { clearInterval(poll); stage.speed = 0; R.frozen = type; }
        }, 5);
      }
      return orig(ev);
    };
  }
  for (const [i, m] of data.messages.entries()) {
    R.index = i;
    director.push(m);
    while (director.busy || director.queue.length) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 600));
  }
  R.done = true;
}

// Card faces are painted (and PNG-encoded) on first use, which can stall a draw or a summon mid-animation.
// Paint them all ahead of time in idle moments instead, a couple per slice.
function prewarmCards() {
  const ids = allCards().map((c) => c.id);
  const idle = window.requestIdleCallback || ((fn) => setTimeout(() => fn({ timeRemaining: () => 8 }), 30));
  const step = (deadline) => {
    while (ids.length && deadline.timeRemaining() > 4) cardURL(ids.shift());
    if (ids.length) idle(step);
  };
  idle(step);
}

// ------------------------------------------------------------------ boot
async function boot() {
  stage = new Stage($("stage"));
  net = new Net();
  ui = new DuelUI(stage, net);
  director = new Director(stage, ui);
  await loadCards();
  prewarmCards();
  const openSettings = wireSettings();
  wireNet();

  addEventListener("pointerdown", () => audio.unlock(), { once: false });
  document.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => {
    audio.unlock(); audio.play("ui_click");
    let go = b.dataset.go;
    if (go === "settings") return openSettings();
    if (go === "solo" || go === "online") {
      if (!state.room) state.solo = go === "solo";
      go = "online";
    }
    show(go);
  }));
  $("in-name").value = settings.get("name") || "";
  const params = new URLSearchParams(location.search);
  if (params.get("room")) $("in-code").value = params.get("room").toUpperCase();

  $("btn-create").onclick = () => {
    audio.play("ui_click");
    net.send({ t: "create", name: playerName(), deck: settings.get("lastDeck") || "radiant", profile: profileChoice, showcase: $("in-showcase").checked, arena: settings.get("lastArena") || "meadow" });
  };
  $("btn-solo").onclick = () => {
    audio.play("ui_click");
    state.pick = "me";
    net.send({ t: "create", solo: true, name: playerName(), deck: settings.get("lastDeck") || "radiant", profile: profileChoice,
      showcase: $("in-showcase").checked, arena: settings.get("lastArena") || "meadow",
      difficulty: settings.get("difficulty") || "normal", bot_deck: settings.get("lastBotDeck") || undefined });
  };
  $("btn-join").onclick = () => {
    audio.play("ui_click");
    const code = $("in-code").value.trim().toUpperCase();
    if (code.length !== 5) return lobbyError("Room codes have 5 characters.");
    net.send({ t: "join", code, name: playerName(), deck: settings.get("lastDeck") || "void" });
  };
  $("in-code").onkeydown = (e) => { if (e.key === "Enter") $("btn-join").click(); };
  $("btn-ready").onclick = () => {
    audio.play("ui_click");
    const me = state.room.seats[state.seat];
    net.send({ t: "ready", ready: !me.ready });
  };
  $("btn-leave").onclick = () => { audio.play("ui_click"); net.send({ t: "leave" }); };
  $("btn-copy").onclick = async () => {
    const url = `${location.origin}${location.pathname}?room=${state.room.code}`;
    try { await navigator.clipboard.writeText(url); $("btn-copy").textContent = "Copied!"; } catch { $("btn-copy").textContent = url; }
    setTimeout(() => ($("btn-copy").textContent = "Copy invite link"), 1800);
  };
  $("col-search").oninput = renderCollection;
  $("col-type").querySelectorAll("button").forEach((b) => (b.onclick = () => {
    audio.play("ui_click"); colType = b.dataset.v;
    $("col-type").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    renderCollection();
  }));
  // Featured monsters on the main menu.
  const featured = ["LD-001", "LD-007", "LD-F01", "LD-006", "LD-012", "LD-009", "LD-002", "LD-004"];
  showcase = new Showcase($("showcase"), featured, (c) => {
    $("sp-name").textContent = c.name;
    $("sp-meta").textContent = `${c.attribute} · LV ${c.level} · ATK ${c.atk} / DEF ${c.def}`;
  });
  // Menu shortcuts.
  addEventListener("keydown", (e) => {
    if (state.screen !== "menu" || e.target.tagName === "INPUT" || !$("modal-settings").classList.contains("hidden")) return;
    const go = { Digit1: "solo", Digit2: "online", Digit3: "collection", Digit4: "settings" }[e.code];
    if (go) document.querySelector(`[data-go="${go}"]`).click();
  });
  ui.onRematch = () => {
    state.showingEnd = false; state.inDuel = false;
    $("end-screen").classList.add("hidden");
    audio.stopMusic();
    show("online");
    renderLobby();
  };
  ui.onLeave = () => { state.showingEnd = false; net.send({ t: "leave" }); };

  stage.env.set(stage.baseEnv);
  if (params.get("replay")) return runReplay(params.get("replay"));
  net.connect();
  show(params.get("room") ? "online" : "menu");
}

boot();
