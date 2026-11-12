import { createServer, type Server } from "node:http";
import { connect, type AddressInfo, type Socket } from "node:net";
import { randomBytes } from "node:crypto";
import { Duplex } from "node:stream";
import type { IncomingMessage } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    WS_CLOSE,
    WS_MAX_BUFFERED_BYTES,
    acceptKey,
    acceptWebSocket,
    originMatchesHost,
    type WebSocketConnection,
} from "../src/realtime/websocket.ts";

/**
 * Der kleine WebSocket-Server (RFC 6455, JOBS-0001 4.9). Geprüft wird auf Byte-Ebene mit einem rohen Client: Handshake,
 * Maskierung, Ping und Pong, Fragmente, Größe, Schließen mit Code. Das Verhalten mit dem Browser-Client prüft
 * `jobs-realtime.test.ts` und der Browsertest der Statusseite.
 */

const KEY = randomBytes(16).toString("base64");

interface Fixture {
    server: Server;
    port: number;
    connections: WebSocketConnection[];
    messages: string[];
    closes: number[];
}

let fixture: Fixture | undefined;
const sockets: Socket[] = [];

afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.destroy();
    await new Promise<void>((resolve) => (fixture ? fixture.server.close(() => resolve()) : resolve()));
    fixture = undefined;
});

async function start(maxPayload?: number): Promise<Fixture> {
    const connections: WebSocketConnection[] = [];
    const messages: string[] = [];
    const closes: number[] = [];
    const server = createServer();
    server.on("upgrade", (request, socket, head) => {
        const connection = acceptWebSocket(request, socket, head, maxPayload === undefined ? {} : { maxPayload });
        if (!connection) return;
        connections.push(connection);
        connection.onMessage((text) => messages.push(text));
        connection.onClose((code) => closes.push(code));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    fixture = { server, port: (server.address() as AddressInfo).port, connections, messages, closes };
    return fixture;
}

/** Ein roher Client: schickt den Handshake und liest, was zurückkommt. */
function client(
    port: number,
    headers: Record<string, string> = {},
): Promise<{ socket: Socket; handshake: string; chunks: Buffer[] }> {
    return new Promise((resolve) => {
        const socket = connect(port, "127.0.0.1");
        sockets.push(socket);
        const chunks: Buffer[] = [];
        let handshake = "";
        let done = false;
        socket.on("data", (chunk: Buffer) => {
            if (!done) {
                handshake += chunk.toString("latin1");
                const end = handshake.indexOf("\r\n\r\n");
                if (end >= 0) {
                    done = true;
                    const rest = Buffer.from(handshake.slice(end + 4), "latin1");
                    handshake = handshake.slice(0, end);
                    if (rest.length > 0) chunks.push(rest);
                    resolve({ socket, handshake, chunks });
                }
            } else {
                chunks.push(chunk);
            }
        });
        const all = {
            Host: `127.0.0.1:${String(port)}`,
            Upgrade: "websocket",
            Connection: "Upgrade",
            "Sec-WebSocket-Key": KEY,
            "Sec-WebSocket-Version": "13",
            ...headers,
        };
        socket.write(
            `GET /ws HTTP/1.1\r\n${Object.entries(all)
                .map(([key, value]) => `${key}: ${value}`)
                .join("\r\n")}\r\n\r\n`,
        );
    });
}

/** Ein maskierter Rahmen des Clients. */
function maskedFrame(opcode: number, payload: Buffer, options: { fin?: boolean; mask?: boolean } = {}): Buffer {
    const fin = options.fin ?? true;
    const masked = options.mask ?? true;
    const length = payload.length;
    const head: number[] = [(fin ? 0x80 : 0) | opcode];
    const maskBit = masked ? 0x80 : 0;
    if (length < 126) head.push(maskBit | length);
    else if (length < 65_536) head.push(maskBit | 126, length >> 8, length & 0xff);
    else {
        const big = Buffer.alloc(8);
        big.writeBigUInt64BE(BigInt(length));
        head.push(maskBit | 127, ...big);
    }
    if (!masked) return Buffer.concat([Buffer.from(head), payload]);
    const mask = randomBytes(4);
    const body = Buffer.from(payload);
    for (let index = 0; index < body.length; index += 1)
        body[index] = (body[index] as number) ^ (mask[index % 4] as number);
    return Buffer.concat([Buffer.from(head), mask, body]);
}

/** Liest die Rahmen des Servers (unmaskiert) aus den empfangenen Bytes. */
function serverFrames(chunks: Buffer[]): { opcode: number; payload: Buffer }[] {
    const buffer = Buffer.concat(chunks);
    const frames: { opcode: number; payload: Buffer }[] = [];
    let offset = 0;
    while (offset + 2 <= buffer.length) {
        const opcode = (buffer[offset] as number) & 0x0f;
        let length = (buffer[offset + 1] as number) & 0x7f;
        let head = 2;
        if (length === 126) {
            length = buffer.readUInt16BE(offset + 2);
            head = 4;
        } else if (length === 127) {
            length = Number(buffer.readBigUInt64BE(offset + 2));
            head = 10;
        }
        if (offset + head + length > buffer.length) break;
        frames.push({ opcode, payload: buffer.subarray(offset + head, offset + head + length) });
        offset += head + length;
    }
    return frames;
}

const until = async (condition: () => boolean, timeoutMs = 3000): Promise<void> => {
    const started = Date.now();
    while (!condition()) {
        if (Date.now() - started > timeoutMs) throw new Error("Zeit abgelaufen");
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
};

const closeCode = (chunks: Buffer[]): number | undefined => {
    const close = serverFrames(chunks).find((frame) => frame.opcode === 0x8);
    return close && close.payload.length >= 2 ? close.payload.readUInt16BE(0) : undefined;
};

describe("WebSocket: Handshake", () => {
    it("🔴 Sec-WebSocket-Accept ist SHA-1 über Schlüssel und GUID (RFC 6455, Beispiel aus dem Standard)", () => {
        expect(acceptKey("dGhlIHNhbXBsZSBub25jZQ==")).toBe("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
    });

    it("antwortet 101 mit dem richtigen Accept", async () => {
        const { port } = await start();
        const { handshake } = await client(port);
        expect(handshake.split("\r\n")[0]).toBe("HTTP/1.1 101 Switching Protocols");
        expect(handshake).toContain(`Sec-WebSocket-Accept: ${acceptKey(KEY)}`);
    });

    it("weist ab: falsche Version (426), kaputter Schlüssel (400), kein Upgrade (400)", async () => {
        const { port } = await start();
        expect((await client(port, { "Sec-WebSocket-Version": "8" })).handshake).toContain("426 Upgrade Required");
        expect((await client(port, { "Sec-WebSocket-Key": "zu-kurz" })).handshake).toContain("400 Bad Request");
        expect((await client(port, { Upgrade: "h2c" })).handshake).toContain("400 Bad Request");
    });

    it("🔴 Herkunft: ein Browser einer fremden Seite wird abgewiesen (403), derselbe Ort und ein Client ohne Origin gehen durch", async () => {
        const { port } = await start();
        expect((await client(port, { Origin: "https://boese.example" })).handshake).toContain("403 Forbidden");
        expect((await client(port, { Origin: `http://127.0.0.1:${String(port)}` })).handshake).toContain(
            "101 Switching Protocols",
        );
        expect((await client(port)).handshake).toContain("101 Switching Protocols");
        expect(originMatchesHost("http://stage.avesmaps.de", "stage.avesmaps.de")).toBe(true);
        expect(originMatchesHost("https://stage.avesmaps.de", "stage.avesmaps.de:8443")).toBe(false);
        expect(originMatchesHost("kaputt", "x")).toBe(false);
        expect(originMatchesHost(undefined, undefined)).toBe(true);
        expect(originMatchesHost("http://x", undefined)).toBe(false);
    });
});

describe("WebSocket: Nachrichten", () => {
    it("Text kurz, mittellang und lang kommt an (7, 16 und 64 Bit Länge)", async () => {
        const { port, messages } = await start(200_000);
        const { socket } = await client(port);
        const texts = ["hallo", "ä".repeat(300), "x".repeat(70_000)];
        for (const text of texts) socket.write(maskedFrame(0x1, Buffer.from(text)));
        await until(() => messages.length === 3);
        expect(messages).toEqual(texts);
    });

    it("Fragmente werden zu einer Nachricht", async () => {
        const { port, messages } = await start();
        const { socket } = await client(port);
        socket.write(maskedFrame(0x1, Buffer.from("Hal"), { fin: false }));
        socket.write(maskedFrame(0x0, Buffer.from("lo "), { fin: false }));
        socket.write(maskedFrame(0x0, Buffer.from("Welt")));
        await until(() => messages.length === 1);
        expect(messages[0]).toBe("Hallo Welt");
    });

    it("ein Rahmen, der in kleinen Stücken ankommt, wird richtig zusammengesetzt", async () => {
        const { port, messages } = await start();
        const { socket } = await client(port);
        const bytes = maskedFrame(0x1, Buffer.from("stückchenweise"));
        for (let index = 0; index < bytes.length; index += 3) {
            socket.write(bytes.subarray(index, index + 3));
            await new Promise((resolve) => setTimeout(resolve, 2));
        }
        await until(() => messages.length === 1);
        expect(messages[0]).toBe("stückchenweise");
    });

    it("Ping des Clients wird mit Pong und demselben Inhalt beantwortet", async () => {
        const { port } = await start();
        const { socket, chunks } = await client(port);
        socket.write(maskedFrame(0x9, Buffer.from("42")));
        await until(() => serverFrames(chunks).some((frame) => frame.opcode === 0xa));
        expect(
            serverFrames(chunks)
                .find((frame) => frame.opcode === 0xa)
                ?.payload.toString(),
        ).toBe("42");
    });

    it("send schreibt einen unmaskierten Textrahmen; ping einen Ping-Rahmen", async () => {
        const { port, connections } = await start();
        const { chunks } = await client(port);
        await until(() => connections.length === 1);
        expect(connections[0]?.send('{"op":"hello"}')).toBe(true);
        connections[0]?.ping();
        await until(() => serverFrames(chunks).length === 2);
        const [text, ping] = serverFrames(chunks);
        expect(text?.opcode).toBe(0x1);
        expect(text?.payload.toString()).toBe('{"op":"hello"}');
        expect(ping?.opcode).toBe(0x9);
    });
});

describe("WebSocket: Verstöße schließen mit dem richtigen Code", () => {
    it("🔴 ein unmaskierter Rahmen des Clients: 1002", async () => {
        const { port, closes } = await start();
        const { socket, chunks } = await client(port);
        socket.write(maskedFrame(0x1, Buffer.from("x"), { mask: false }));
        await until(() => closeCode(chunks) !== undefined);
        expect(closeCode(chunks)).toBe(WS_CLOSE.protocolError);
        await until(() => closes.length === 1);
    });

    it("Binärnachricht: 1003; zu große Nachricht: 1009; ein Kontrollrahmen über 125 Byte: 1002", async () => {
        const { port } = await start(150);
        const binary = await client(port);
        binary.socket.write(maskedFrame(0x2, Buffer.from("bin")));
        await until(() => closeCode(binary.chunks) !== undefined);
        expect(closeCode(binary.chunks)).toBe(WS_CLOSE.unsupportedData);

        const big = await client(port);
        big.socket.write(maskedFrame(0x1, Buffer.alloc(151, 0x61)));
        await until(() => closeCode(big.chunks) !== undefined);
        expect(closeCode(big.chunks)).toBe(WS_CLOSE.tooBig);

        const control = await client(port);
        control.socket.write(maskedFrame(0x9, Buffer.alloc(126, 1)));
        await until(() => closeCode(control.chunks) !== undefined);
        expect(closeCode(control.chunks)).toBe(WS_CLOSE.protocolError);
    });

    it("eine Fortsetzung ohne Anfang: 1002", async () => {
        const { port } = await start();
        const { socket, chunks } = await client(port);
        socket.write(maskedFrame(0x0, Buffer.from("x")));
        await until(() => closeCode(chunks) !== undefined);
        expect(closeCode(chunks)).toBe(WS_CLOSE.protocolError);
    });

    it("🔴 Beim Beenden: 1001 going away mit Begründung, der Client bekommt den Schließrahmen", async () => {
        const { port, connections, closes } = await start();
        const { chunks } = await client(port);
        await until(() => connections.length === 1);
        connections[0]?.close(WS_CLOSE.goingAway, "going away");
        await until(() => closeCode(chunks) !== undefined);
        const frame = serverFrames(chunks).find((entry) => entry.opcode === 0x8);
        expect(frame?.payload.readUInt16BE(0)).toBe(1001);
        expect(frame?.payload.subarray(2).toString()).toBe("going away");
        expect(closes).toEqual([1001]);
        expect(connections[0]?.closed).toBe(true);
        expect(connections[0]?.send("zu spät")).toBe(false);
    });

    it("schließt der Client mit seinem Schließrahmen, antwortet der Server mit seinem und meldet den Code", async () => {
        const { port, closes } = await start();
        const { socket, chunks } = await client(port);
        const code = Buffer.alloc(2);
        code.writeUInt16BE(1000);
        socket.write(maskedFrame(0x8, code));
        await until(() => closes.length === 1);
        expect(closes).toEqual([1000]);
        await until(() => closeCode(chunks) !== undefined);
    });

    it("bricht der Client einfach ab, meldet der Server 1006", async () => {
        const { port, closes } = await start();
        const { socket } = await client(port);
        socket.destroy();
        await until(() => closes.length === 1);
        expect(closes).toEqual([1006]);
    });
});

describe("Grenzen gegen unbegrenztes Wachstum (G4-04)", () => {
    /** Ein Fake-Duplex: `writableLength` ist einstellbar, geschriebene Rahmen werden gesammelt, nichts wird je gelesen. */
    function fake(): {
        socket: Duplex;
        written: Buffer[];
        connection: WebSocketConnection;
        closes: number[];
        push: (b: Buffer) => void;
    } {
        const written: Buffer[] = [];
        const socket = new Duplex({
            read() {},
            write(chunk: Buffer, _encoding, callback) {
                written.push(Buffer.from(chunk));
                callback();
            },
        });
        const request = {
            method: "GET",
            headers: {
                upgrade: "websocket",
                connection: "Upgrade",
                "sec-websocket-key": KEY,
                "sec-websocket-version": "13",
            },
        } as unknown as IncomingMessage;
        const connection = acceptWebSocket(request, socket, Buffer.alloc(0)) as WebSocketConnection;
        const closes: number[] = [];
        connection.onClose((code) => closes.push(code));
        return { socket, written, connection, closes, push: (b) => void socket.emit("data", b) };
    }

    it("schließt mit 1009 bei sehr vielen leeren Fortsetzungsrahmen ohne FIN", () => {
        const { connection, closes, push } = fake();
        push(maskedFrame(0x1, Buffer.alloc(0), { fin: false }));
        for (let index = 0; index < 100 && !connection.closed; index += 1) {
            push(maskedFrame(0x0, Buffer.alloc(0), { fin: false }));
        }
        expect(closes).toEqual([WS_CLOSE.tooBig]);
    });

    it("hängt nach dem Schließen nichts mehr an", () => {
        const { connection, socket, push } = fake();
        connection.close(WS_CLOSE.normal);
        const first = maskedFrame(0x1, Buffer.from("x"), { fin: false });
        const second = maskedFrame(0x1, Buffer.from("x"), { fin: false });
        const spy = vi.spyOn(Buffer, "concat");
        push(first);
        push(second);
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
        socket.destroy();
    });

    it("beendet die Verbindung, wenn der Client nicht liest, statt jeden Ping zu beantworten", () => {
        const { connection, socket, closes, push } = fake();
        Object.defineProperty(socket, "writableLength", { value: WS_MAX_BUFFERED_BYTES + 1 });
        push(maskedFrame(0x9, Buffer.alloc(0)));
        expect(closes).toEqual([1006]);
        expect(connection.closed).toBe(true);
    });

    it("send beendet die Verbindung bei zu viel Gepuffertem", () => {
        const { connection, socket, closes } = fake();
        Object.defineProperty(socket, "writableLength", { value: WS_MAX_BUFFERED_BYTES + 1 });
        expect(connection.send("x")).toBe(false);
        expect(closes).toEqual([1006]);
    });

    it("spiegelt keinen unerlaubten Schließcode des Clients", () => {
        for (const wire of [1005, 1006, 1015, 999, 5000]) {
            const { written, closes, push, socket } = fake();
            const code = Buffer.alloc(2);
            code.writeUInt16BE(wire);
            push(maskedFrame(0x8, code));
            expect(closes).toEqual([WS_CLOSE.protocolError]);
            const close = serverFrames(written.slice(1)).find((entry) => entry.opcode === 0x8);
            expect(close?.payload.readUInt16BE(0)).toBe(1002);
            socket.destroy();
        }
    });

    it("fügt zerstückelte Rahmen weiterhin richtig zusammen", () => {
        const { connection, push } = fake();
        const received: string[] = [];
        connection.onMessage((text) => received.push(text));
        const bytes = maskedFrame(0x1, Buffer.from("hallo welt"));
        for (const byte of bytes) push(Buffer.from([byte]));
        expect(received).toEqual(["hallo welt"]);
    });
});
