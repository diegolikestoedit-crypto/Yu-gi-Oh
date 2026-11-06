"""Living Duel game server: static files over HTTP plus the authoritative duel over WebSocket.

Run:  python3 server/server.py        (PORT env var, default 8787)
"""
from __future__ import annotations

import asyncio
import json
import logging
import mimetypes
import os
import secrets
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from engine.cards import ROOT, SHARED, load_db, load_decks, validate_deck  # noqa: E402
from engine.ai import DIFFICULTIES, DuelAI  # noqa: E402
from engine.rules import PROFILES, Duel, RuleError  # noqa: E402
from ws import ConnectionClosed, WebSocket  # noqa: E402

CLIENT = os.path.join(ROOT, "client")
GRACE_SECONDS = 90
PING_SECONDS = 20
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
MAX_MSGS_PER_SEC = 20
ARENAS = ("meadow", "neon", "frost", "arena")  # cosmetic battlefields; no effect on rules
BOT_PACE = 1.0  # scales the computer's thinking pause in solo duels (tests set 0)

log = logging.getLogger("living-duel")
DB = load_db()
DECKS = load_decks()

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("application/json", ".json")


def hint_for(duel: Duel, seat: int):
    """The guide's suggested play for whoever must decide: advice only, the player still chooses."""
    if duel.decider() != seat:
        return None
    try:
        return DuelAI(seat, "hard").advise(duel)
    except Exception:  # advice must never break a duel
        log.exception("hint failed")
        return None


def clean_name(raw) -> str:
    name = "".join(ch for ch in str(raw or "") if ch.isprintable()).strip()[:16]
    return name or "Duelist"


class Seat:
    def __init__(self, name, deck):
        self.token = secrets.token_urlsafe(18)
        self.name = name
        self.deck = deck
        self.ready = False
        self.ws: WebSocket | None = None
        self.room: Room | None = None
        self.index = 0
        self.drop_task: asyncio.Task | None = None
        self.bot = False

    @property
    def connected(self):
        return self.bot or (self.ws is not None and not self.ws.closed)


class BotSeat(Seat):
    """The computer opponent in a solo room: always connected, always ready."""

    def __init__(self, deck):
        super().__init__(bot_name(deck), deck)
        self.bot = True
        self.ready = True


def bot_name(deck):
    du = DECKS[deck].get("duelist") or {}
    return du.get("name") or "Computer"


class Room:
    def __init__(self, code):
        self.code = code
        self.seats: list = [None, None]
        self.profile = "citadel"
        self.showcase = True
        self.arena = "meadow"
        self.state = "lobby"  # lobby | duel | ended
        self.duel: Duel | None = None
        self.seq = 0
        self.created = time.time()
        self.solo = False
        self.difficulty = "normal"
        self.ai: DuelAI | None = None
        self.bot_task: asyncio.Task | None = None

    def summary(self):
        return {
            "code": self.code,
            "profile": self.profile,
            "profiles": {k: {"name": v["name"], "summary": v["summary"]} for k, v in PROFILES.items()},
            "showcase": self.showcase,
            "arena": self.arena,
            "state": self.state,
            "solo": self.solo,
            "difficulty": self.difficulty,
            "seats": [None if s is None else {
                "name": s.name, "deck": s.deck, "ready": s.ready, "connected": s.connected, "bot": s.bot,
            } for s in self.seats],
        }


class Server:
    def __init__(self):
        self.rooms: dict = {}
        self.sessions: dict = {}  # token -> Seat

    # ------------------------------------------------------------ messaging

    async def send(self, seat: Seat, msg: dict):
        if seat and not seat.bot and seat.connected:
            try:
                await seat.ws.send(json.dumps(msg, separators=(",", ":")))
            except ConnectionClosed:
                pass

    async def send_ws(self, ws: WebSocket, msg: dict):
        try:
            await ws.send(json.dumps(msg, separators=(",", ":")))
        except ConnectionClosed:
            pass

    async def broadcast_room(self, room: Room):
        for i, s in enumerate(room.seats):
            if s:
                await self.send(s, {"t": "room", "room": room.summary(), "you": i})

    async def broadcast_duel(self, room: Room, events: list):
        room.seq += 1
        duel = room.duel
        for i, s in enumerate(room.seats):
            if s is None:
                continue
            await self.send(s, {
                "t": "duel",
                "seq": room.seq,
                "events": [duel.redact_event(e, i) for e in events],
                "view": duel.view(i),
                "actions": duel.legal_actions(i),
                "decider": duel.decider(),
                "hint": hint_for(duel, i),
            })
        if duel.state["winner"] is not None and room.state == "duel":
            room.state = "ended"
            for s in room.seats:
                if s:
                    s.ready = s.bot
            await self.broadcast_room(room)
        else:
            self.schedule_bot(room, len(events))

    async def sync_duel(self, room: Room, seat: Seat):
        duel = room.duel
        i = seat.index
        await self.send(seat, {"t": "duel", "seq": room.seq, "sync": True, "events": [],
                               "view": duel.view(i), "actions": duel.legal_actions(i),
                               "decider": duel.decider(), "hint": hint_for(duel, i)})

    # ---------------------------------------------------------------- rooms

    def new_code(self):
        while True:
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(5))
            if code not in self.rooms:
                return code

    def attach(self, seat: Seat, ws: WebSocket):
        if seat.ws is not None and seat.ws is not ws and not seat.ws.closed:
            asyncio.ensure_future(seat.ws.close())
        seat.ws = ws
        if seat.drop_task:
            seat.drop_task.cancel()
            seat.drop_task = None

    async def start_duel(self, room: Room):
        decks = [DECKS[s.deck] for s in room.seats]
        showcase = {i: DECKS[s.deck].get("signature") for i, s in enumerate(room.seats)} if room.showcase else None
        room.duel = Duel(DB, decks, [s.name for s in room.seats], profile=room.profile,
                         first=0 if room.showcase else None, showcase=showcase)
        room.state = "duel"
        room.ai = DuelAI(1, room.difficulty) if room.solo else None
        events = room.duel.start()
        await self.broadcast_room(room)
        await self.broadcast_duel(room, events)
        log.info("room %s: duel started (%s)", room.code, room.profile)

    def close_room(self, room: Room):
        self.rooms.pop(room.code, None)
        if room.bot_task:
            room.bot_task.cancel()
        log.info("room %s closed", room.code)

    def schedule_bot(self, room: Room, n_events: int):
        """In a solo room, let the computer take its next action once the last one has had time to play out."""
        duel = room.duel
        if not room.ai or room.state != "duel" or duel.decider() != room.ai.p:
            return
        if room.bot_task and not room.bot_task.done():
            return
        # Long enough for the last move's animations to play, short enough that nobody waits on an idle board.
        delay = min(3.0, 0.6 + 0.3 * n_events) * BOT_PACE
        room.bot_task = asyncio.ensure_future(self.bot_move(room, delay))

    async def bot_move(self, room: Room, delay: float):
        try:
            await asyncio.sleep(delay)
        except asyncio.CancelledError:
            return
        room.bot_task = None
        duel = room.duel
        if room.state != "duel" or room.ai is None or duel.decider() != room.ai.p:
            return
        if not room.seats[0] or not room.seats[0].connected:
            return  # wait for the player to come back; reconnecting reschedules the AI
        aid = room.ai.choose(duel)
        if aid is None:
            return
        try:
            events = duel.act(room.ai.p, aid)
        except RuleError:
            log.exception("room %s: AI chose an illegal action", room.code)
            return
        await self.broadcast_duel(room, events)

    async def on_disconnect(self, seat: Seat):
        room = seat.room
        if room is None:
            return
        other = room.seats[1 - seat.index]
        await self.send(other, {"t": "opponent", "connected": False, "grace": GRACE_SECONDS})
        await self.broadcast_room(room)
        seat.drop_task = asyncio.ensure_future(self.drop_after_grace(seat))

    async def drop_after_grace(self, seat: Seat):
        try:
            await asyncio.sleep(GRACE_SECONDS)
        except asyncio.CancelledError:
            return
        room = seat.room
        if room is None or seat.connected:
            return
        if room.state == "duel" and room.duel and room.duel.state["winner"] is None:
            events = room.duel.concede(seat.index, reason="disconnect")
            await self.broadcast_duel(room, events)
        await self.remove_seat(seat)

    async def remove_seat(self, seat: Seat):
        room = seat.room
        self.sessions.pop(seat.token, None)
        if room is None:
            return
        room.seats[seat.index] = None
        seat.room = None
        if all(s is None or s.bot for s in room.seats):
            self.close_room(room)
            return
        if room.state != "duel":
            room.state = "lobby"
            for s in room.seats:
                if s:
                    s.ready = s.bot
        await self.broadcast_room(room)

    # ------------------------------------------------------------- handlers

    async def handle_ws(self, ws: WebSocket):
        seat: Seat | None = None
        window_start, count = time.monotonic(), 0
        try:
            while True:
                raw = await ws.recv()
                now = time.monotonic()
                if now - window_start > 1:
                    window_start, count = now, 0
                count += 1
                if count > MAX_MSGS_PER_SEC:
                    continue
                try:
                    msg = json.loads(raw)
                    if not isinstance(msg, dict):
                        raise ValueError
                except ValueError:
                    continue
                try:
                    seat = await self.dispatch(ws, seat, msg)
                except RuleError as e:
                    await self.send_ws(ws, {"t": "error", "msg": str(e)})
        except ConnectionClosed:
            pass
        finally:
            await ws.close()
            if seat is not None and seat.ws is ws:
                seat.ws = None
                await self.on_disconnect(seat)

    async def dispatch(self, ws: WebSocket, seat: Seat | None, msg: dict):
        t = msg.get("t")
        if t == "ping":
            await self.send_ws(ws, {"t": "pong", "at": msg.get("at")})
            return seat
        if t == "hello":
            await self.send_ws(ws, {"t": "hello", "decks": [
                {k: d.get(k) for k in ("id", "name", "description", "signature", "main", "extra", "duelist")} for d in DECKS.values()],
                "profiles": {k: {"name": v["name"], "summary": v["summary"]} for k, v in PROFILES.items()}})
            token = msg.get("token")
            found = self.sessions.get(token) if isinstance(token, str) else None
            if found and found.room:
                self.attach(found, ws)
                await self.send_ws(ws, {"t": "welcome", "token": found.token, "resumed": True})
                room = found.room
                await self.broadcast_room(room)
                other = room.seats[1 - found.index]
                await self.send(other, {"t": "opponent", "connected": True})
                if room.duel and room.state in ("duel", "ended"):
                    await self.sync_duel(room, found)
                    self.schedule_bot(room, 0)
                return found
            return None
        if t == "create":
            if seat and seat.room:
                raise RuleError("You are already in a room.")
            deck = msg.get("deck") if msg.get("deck") in DECKS else "radiant"
            room = Room(self.new_code())
            self.rooms[room.code] = room
            seat = Seat(clean_name(msg.get("name")), deck)
            seat.room, seat.index = room, 0
            room.seats[0] = seat
            if msg.get("profile") in PROFILES:
                room.profile = msg["profile"]
            room.showcase = bool(msg.get("showcase", True))
            if msg.get("arena") in ARENAS:
                room.arena = msg["arena"]
            if msg.get("solo"):
                room.solo = True
                if msg.get("difficulty") in DIFFICULTIES:
                    room.difficulty = msg["difficulty"]
                bot_deck = msg.get("bot_deck")
                if bot_deck not in DECKS:
                    bot_deck = secrets.choice([d for d in DECKS if d != deck] or list(DECKS))
                room.seats[1] = BotSeat(bot_deck)
                room.seats[1].room, room.seats[1].index = room, 1
            self.sessions[seat.token] = seat
            self.attach(seat, ws)
            await self.send_ws(ws, {"t": "welcome", "token": seat.token})
            await self.broadcast_room(room)
            log.info("room %s created", room.code)
            return seat
        if t == "join":
            if seat and seat.room:
                raise RuleError("You are already in a room.")
            code = str(msg.get("code", "")).strip().upper()
            room = self.rooms.get(code)
            if room is None:
                raise RuleError("No room with that code.")
            if room.solo:
                raise RuleError("That room is a solo duel against the computer.")
            if None not in room.seats:
                raise RuleError("That room is full.")
            idx = room.seats.index(None)
            deck = msg.get("deck") if msg.get("deck") in DECKS else "void"
            seat = Seat(clean_name(msg.get("name")), deck)
            seat.room, seat.index = room, idx
            room.seats[idx] = seat
            self.sessions[seat.token] = seat
            self.attach(seat, ws)
            await self.send_ws(ws, {"t": "welcome", "token": seat.token})
            await self.broadcast_room(room)
            return seat

        if seat is None or seat.room is None:
            raise RuleError("Join a room first.")
        room = seat.room

        if t == "leave":
            if room.state == "duel" and room.duel and room.duel.state["winner"] is None:
                await self.broadcast_duel(room, room.duel.concede(seat.index))
            await self.remove_seat(seat)
            await self.send_ws(ws, {"t": "left"})
            return None
        if t == "deck":
            if room.state == "duel":
                raise RuleError("Decks are locked during a duel.")
            if msg.get("deck") not in DECKS:
                raise RuleError("Unknown deck.")
            problems = validate_deck(DB, DECKS[msg["deck"]], room.profile)
            if problems:
                raise RuleError(problems[0])
            seat.deck = msg["deck"]
            seat.ready = False
            await self.broadcast_room(room)
            return seat
        if t == "settings":
            if seat.index != 0 or room.state == "duel":
                raise RuleError("Only the host can change settings before the duel.")
            if msg.get("profile") in PROFILES:
                room.profile = msg["profile"]
            if "showcase" in msg:
                room.showcase = bool(msg["showcase"])
            if msg.get("arena") in ARENAS:
                room.arena = msg["arena"]
            if msg.get("difficulty") in DIFFICULTIES and room.solo:
                room.difficulty = msg["difficulty"]
            if room.solo and msg.get("bot_deck") in DECKS:
                room.seats[1] = BotSeat(msg["bot_deck"])
                room.seats[1].room, room.seats[1].index = room, 1
            for s in room.seats:
                if s:
                    s.ready = s.bot
            await self.broadcast_room(room)
            return seat
        if t == "ready":
            if room.state == "duel":
                return seat
            seat.ready = bool(msg.get("ready"))
            if room.state == "ended":
                room.state = "lobby"
            await self.broadcast_room(room)
            if all(s is not None and s.ready and s.connected for s in room.seats):
                await self.start_duel(room)
            return seat
        if t == "act":
            if room.state != "duel" or room.duel is None:
                raise RuleError("No duel in progress.")
            events = room.duel.act(seat.index, str(msg.get("id", "")))
            await self.broadcast_duel(room, events)
            return seat
        if t == "concede":
            if room.state == "duel" and room.duel and room.duel.state["winner"] is None:
                await self.broadcast_duel(room, room.duel.concede(seat.index))
            return seat
        raise RuleError("Unknown message.")

    # ----------------------------------------------------------------- http

    async def handle_conn(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        try:
            head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=15)
        except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, asyncio.TimeoutError, ConnectionError):
            writer.close()
            return
        lines = head.decode("latin-1").split("\r\n")
        try:
            method, target, _ = lines[0].split(" ", 2)
        except ValueError:
            writer.close()
            return
        headers = {}
        for line in lines[1:]:
            if ":" in line:
                k, v = line.split(":", 1)
                headers[k.strip().lower()] = v.strip()
        path = target.split("?", 1)[0]
        if path == "/ws":
            try:
                ws = await WebSocket.handshake(reader, writer, headers)
            except ConnectionClosed:
                await self.http_response(writer, 400, b"Bad Request", "text/plain")
                return
            await self.handle_ws(ws)
            return
        if method not in ("GET", "HEAD"):
            await self.http_response(writer, 405, b"Method Not Allowed", "text/plain")
            return
        if path == "/healthz":
            await self.http_response(writer, 200, b"ok", "text/plain")
            return
        await self.serve_static(writer, path, head_only=method == "HEAD")

    async def serve_static(self, writer, path, head_only=False):
        if path == "/":
            path = "/index.html"
        base = SHARED if path.startswith("/shared/") else CLIENT
        rel = path[len("/shared/"):] if base is SHARED else path.lstrip("/")
        full = os.path.realpath(os.path.join(base, rel))
        if not full.startswith(os.path.realpath(base) + os.sep) or not os.path.isfile(full):
            await self.http_response(writer, 404, b"Not Found", "text/plain")
            return
        with open(full, "rb") as f:
            body = f.read()
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        await self.http_response(writer, 200, b"" if head_only else body, ctype, length=len(body))

    @staticmethod
    async def http_response(writer, status, body: bytes, ctype, length=None):
        reason = {200: "OK", 400: "Bad Request", 404: "Not Found", 405: "Method Not Allowed"}[status]
        if ctype.startswith("text/") or ctype in ("application/json", "text/javascript"):
            ctype += "; charset=utf-8"
        head = (f"HTTP/1.1 {status} {reason}\r\nContent-Type: {ctype}\r\n"
                f"Content-Length: {length if length is not None else len(body)}\r\n"
                "Cache-Control: no-cache\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n")
        try:
            writer.write(head.encode() + body)
            await writer.drain()
        except ConnectionError:
            pass
        finally:
            writer.close()

    async def ping_loop(self):
        while True:
            await asyncio.sleep(PING_SECONDS)
            for seat in list(self.sessions.values()):
                if seat.connected:
                    try:
                        await seat.ws.ping()
                    except ConnectionClosed:
                        pass


async def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    port = int(os.environ.get("PORT", "8787"))
    host = os.environ.get("HOST", "0.0.0.0")
    srv = Server()
    server = await asyncio.start_server(srv.handle_conn, host, port, limit=16384)
    asyncio.ensure_future(srv.ping_loop())
    log.info("Living Duel server on http://%s:%d", "localhost" if host == "0.0.0.0" else host, port)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
