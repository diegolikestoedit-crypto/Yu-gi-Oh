// WebSocket connection to the authoritative server with automatic reconnection.
// The session token lives in sessionStorage so each browser tab is its own duelist and survives reloads.
const TOKEN_KEY = "living-duel-token";

function storedToken() {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function storeToken(t) {
  try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.status = "connecting";
    this.retry = 0;
    this.queue = [];
  }

  on(type, fn) { this.handlers.set(type, fn); }

  emit(type, msg) {
    const fn = this.handlers.get(type);
    if (fn) fn(msg);
  }

  connect() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    this.ws = ws;
    this.setStatus("connecting");
    ws.onopen = () => {
      this.retry = 0;
      this.setStatus("online");
      ws.send(JSON.stringify({ t: "hello", token: storedToken() }));
      for (const m of this.queue.splice(0)) ws.send(JSON.stringify(m));
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.t === "welcome") storeToken(msg.token);
      if (msg.t === "left") storeToken(null);
      this.emit(msg.t, msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.setStatus("offline");
      const delay = Math.min(8000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else this.queue.push(msg);
  }

  setStatus(s) {
    this.status = s;
    this.emit("status", { status: s });
  }

  clearSession() { storeToken(null); }
}
