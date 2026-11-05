"""Minimal RFC 6455 WebSocket implementation on asyncio streams (standard library only)."""
from __future__ import annotations

import asyncio
import base64
import hashlib
import struct

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
MAX_MESSAGE = 1 << 20


class ConnectionClosed(Exception):
    pass


def accept_key(key: str) -> str:
    return base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()


class WebSocket:
    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        self.reader = reader
        self.writer = writer
        self.closed = False
        self._lock = asyncio.Lock()

    @classmethod
    async def handshake(cls, reader, writer, headers: dict) -> "WebSocket":
        key = headers.get("sec-websocket-key")
        if not key or headers.get("upgrade", "").lower() != "websocket":
            raise ConnectionClosed("not a websocket request")
        writer.write((
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept_key(key)}\r\n\r\n").encode())
        await writer.drain()
        return cls(reader, writer)

    async def recv(self) -> str:
        """Return the next text message; raises ConnectionClosed when the peer goes away."""
        parts = []
        while True:
            try:
                b1, b2 = await self.reader.readexactly(2)
                opcode = b1 & 0x0F
                fin = b1 & 0x80
                ln = b2 & 0x7F
                if ln == 126:
                    ln = struct.unpack("!H", await self.reader.readexactly(2))[0]
                elif ln == 127:
                    ln = struct.unpack("!Q", await self.reader.readexactly(8))[0]
                if ln > MAX_MESSAGE:
                    raise ConnectionClosed("message too large")
                mask = await self.reader.readexactly(4) if b2 & 0x80 else None
                payload = await self.reader.readexactly(ln)
            except (asyncio.IncompleteReadError, ConnectionError) as e:
                self.closed = True
                raise ConnectionClosed(str(e))
            if mask:
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
            if opcode == 0x8:
                await self.close()
                raise ConnectionClosed("closed by peer")
            if opcode == 0x9:
                await self._send_frame(0xA, payload)
                continue
            if opcode == 0xA:
                continue
            if opcode in (0x1, 0x2, 0x0):
                parts.append(payload)
                if sum(len(p) for p in parts) > MAX_MESSAGE:
                    raise ConnectionClosed("message too large")
                if fin:
                    return b"".join(parts).decode("utf-8", errors="replace")

    async def send(self, text: str):
        await self._send_frame(0x1, text.encode("utf-8"))

    async def ping(self):
        await self._send_frame(0x9, b"")

    async def _send_frame(self, opcode: int, payload: bytes):
        if self.closed:
            raise ConnectionClosed("closed")
        n = len(payload)
        if n < 126:
            header = struct.pack("!BB", 0x80 | opcode, n)
        elif n < 65536:
            header = struct.pack("!BBH", 0x80 | opcode, 126, n)
        else:
            header = struct.pack("!BBQ", 0x80 | opcode, 127, n)
        async with self._lock:
            try:
                self.writer.write(header + payload)
                await self.writer.drain()
            except (ConnectionError, RuntimeError) as e:
                self.closed = True
                raise ConnectionClosed(str(e))

    async def close(self):
        if not self.closed:
            try:
                self.writer.write(struct.pack("!BB", 0x88, 0))
                await self.writer.drain()
            except Exception:
                pass
            self.closed = True
        try:
            self.writer.close()
        except Exception:
            pass
