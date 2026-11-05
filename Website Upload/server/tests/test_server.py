"""End-to-end test: two WebSocket clients play the vertical slice through the real server."""
import asyncio
import base64
import json
import os
import struct
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import server as srvmod  # noqa: E402


class Client:
    def __init__(self, reader, writer):
        self.r, self.w = reader, writer
        self.inbox = []

    @classmethod
    async def connect(cls, port):
        r, w = await asyncio.open_connection("127.0.0.1", port)
        key = base64.b64encode(os.urandom(16)).decode()
        w.write((f"GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                 f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        await w.drain()
        head = await r.readuntil(b"\r\n\r\n")
        assert b"101" in head.split(b"\r\n")[0]
        return cls(r, w)

    async def send(self, msg):
        data = json.dumps(msg).encode()
        mask = os.urandom(4)
        n = len(data)
        header = struct.pack("!BB", 0x81, 0x80 | n) if n < 126 else struct.pack("!BBH", 0x81, 0x80 | 126, n)
        self.w.write(header + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))
        await self.w.drain()

    async def recv(self):
        b1, b2 = await self.r.readexactly(2)
        ln = b2 & 0x7F
        if ln == 126:
            ln = struct.unpack("!H", await self.r.readexactly(2))[0]
        elif ln == 127:
            ln = struct.unpack("!Q", await self.r.readexactly(8))[0]
        payload = await self.r.readexactly(ln)
        if b1 & 0x0F != 1:
            return await self.recv()
        return json.loads(payload)

    async def until(self, pred, timeout=3):
        async def loop():
            while True:
                for i, m in enumerate(self.inbox):
                    if pred(m):
                        return self.inbox.pop(i)
                self.inbox.append(await self.recv())
        return await asyncio.wait_for(loop(), timeout)

    async def latest_duel(self):
        """Drain pending messages and return the newest duel update."""
        last = await self.until(lambda m: m["t"] == "duel")
        try:
            while True:
                m = await asyncio.wait_for(self.recv(), 0.15)
                if m["t"] == "duel":
                    last = m
        except asyncio.TimeoutError:
            pass
        return last

    def close(self):
        self.w.close()


def action(update, kind, **match):
    for a in update["actions"]:
        if a["kind"] == kind and all(a.get(k) == v for k, v in match.items()):
            return a["id"]
    raise AssertionError(f"no {kind} in {[a['id'] for a in update['actions']]}")


def card_in_hand(update, cid):
    me = update["view"]["you"]
    return next(c["iid"] for c in update["view"]["players"][me]["hand"] if c["cid"] == cid)


class ServerSlice(unittest.TestCase):
    def test_two_players_full_slice(self):
        asyncio.run(self.scenario())

    async def scenario(self):
        srvmod.GRACE_SECONDS = 1
        srv = srvmod.Server()
        server = await asyncio.start_server(srv.handle_conn, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        try:
            a = await Client.connect(port)
            b = await Client.connect(port)
            await a.send({"t": "hello"})
            await b.send({"t": "hello"})
            await a.send({"t": "create", "name": "Ana", "deck": "radiant", "profile": "frontier", "showcase": True})
            room = await a.until(lambda m: m["t"] == "room")
            code = room["room"]["code"]
            await b.send({"t": "join", "code": code, "name": "Ben", "deck": "void"})
            await b.until(lambda m: m["t"] == "room" and m["room"]["seats"][1])
            await a.send({"t": "ready", "ready": True})
            await b.send({"t": "ready", "ready": True})

            ua = await a.latest_duel()
            ub = await b.latest_duel()
            self.assertEqual(ua["view"]["active"], 0)
            # Hidden information: Ben's view of the opening draws carries no card ids for Ana.
            first_draw_b = next(e for e in ub["events"] if e["type"] == "CARD_DRAWN" and e["player"] == 0)
            self.assertNotIn("cids", first_draw_b)
            self.assertIsNone(ub["view"]["players"][0]["hand"])

            dragon = card_in_hand(ua, "LD-001")
            await a.send({"t": "act", "id": action(ua, "normal_summon", card=dragon)})
            ua, ub = await a.latest_duel(), await b.latest_duel()
            self.assertEqual([e["type"] for e in ub["events"]], ["MONSTER_SUMMONED"])
            self.assertEqual(ub["events"][0]["cid"], "LD-001")
            await a.send({"t": "act", "id": action(ua, "end_turn")})
            ua, ub = await a.latest_duel(), await b.latest_duel()

            sorcerer = card_in_hand(ub, "LD-007")
            await b.send({"t": "act", "id": action(ub, "normal_summon", card=sorcerer)})
            ua, ub = await a.latest_duel(), await b.latest_duel()
            # Ben may not act for Ana and vice versa.
            await a.send({"t": "act", "id": "end"})
            err = await a.until(lambda m: m["t"] == "error")
            self.assertIn("not available", err["msg"])
            await b.send({"t": "act", "id": action(ub, "end_turn")})
            ua, ub = await a.latest_duel(), await b.latest_duel()

            await a.send({"t": "act", "id": action(ua, "enter_battle")})
            ua = await a.latest_duel()
            await b.latest_duel()
            await a.send({"t": "act", "id": action(ua, "attack", card=dragon, target=sorcerer)})
            ua, ub = await a.latest_duel(), await b.latest_duel()
            ta = [e["type"] for e in ua["events"]]
            tb = [e["type"] for e in ub["events"]]
            self.assertEqual(ta, tb, "both clients receive the same event sequence")
            self.assertIn("MONSTER_DESTROYED", ta)
            self.assertEqual(ua["view"]["players"][1]["lp"], 2500)
            self.assertEqual(ub["view"]["players"][1]["lp"], 2500)
            self.assertEqual(ua["view"]["players"][1]["monsters"], ub["view"]["players"][1]["monsters"])

            # Reconnection: Ben drops and resumes with his token, receiving a full sync.
            token_b = next(s.token for s in srv.sessions.values() if s.name == "Ben")
            b.close()
            await asyncio.sleep(0.1)
            b2 = await Client.connect(port)
            await b2.send({"t": "hello", "token": token_b})
            welcome = await b2.until(lambda m: m["t"] == "welcome")
            self.assertTrue(welcome.get("resumed"))
            sync = await b2.until(lambda m: m["t"] == "duel")
            self.assertTrue(sync["sync"])
            self.assertEqual(sync["view"]["players"][1]["lp"], 2500)
            await asyncio.sleep(1.3)  # past the (shortened) grace period: Ben must still be seated
            self.assertIsNone(srv.rooms[code].duel.state["winner"])
            a.close()
            b2.close()
        finally:
            server.close()


if __name__ == "__main__":
    unittest.main()
