import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

/**
 * Ein kleiner WebSocket-Server nach RFC 6455 (JOBS-0001 4.9, V5): Handshake, Textnachrichten, Ping und Pong, Schließen mit Code.
 * Bewusst klein und ohne neue Abhängigkeit: der Server braucht für `/ws` nur Text (JSON) und die Kontrollrahmen, und eine neue
 * Laufzeitabhängigkeit ändert die Lieferkette (AGENTS.md: Builds müssen reproduzierbar bleiben, Claudio entscheidet über Pakete).
 *
 * 🔴 Die Regeln, die er einhält:
 *   - Der Client MUSS maskieren; ein unmaskierter Rahmen schließt mit 1002.
 *   - Binärnachrichten gibt es nicht (1003), eine Nachricht über `maxPayload` schließt mit 1009.
 *   - Der Handshake prüft die Herkunft: Sendet der Browser einen `Origin`, muss er zum `Host` passen (Schutz gegen fremde Seiten,
 *     die sich in eine Verbindung eines Editors einhängen); ohne `Origin` (kein Browser) geht es durch.
 *   - Beim Beenden des Servers kommt `1001` (going away); der Client verbindet mit Backoff und Jitter neu (Rollout-Antwort, Punkt 2).
 */

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export const WS_CLOSE = {
    normal: 1000,
    goingAway: 1001,
    protocolError: 1002,
    unsupportedData: 1003,
    policy: 1008,
    tooBig: 1009,
    tryAgainLater: 1013,
    /** Sitzung beendet oder Rechte geändert (WI-0120 A11): neu verbinden, der Handschlag sagt, was jetzt gilt. */
    rightsChanged: 4001,
} as const;

/** Höchstens so viele Rahmen je Nachricht (G4-04): leere Fortsetzungsrahmen zählen nicht als Bytes und müssen eigens begrenzt werden. */
export const WS_MAX_FRAGMENTS = 64;
/** Mehr als so viele Byte unterwegs zum Client: er liest nicht, die Verbindung wird beendet (G4-04), Pong und `send` hängen nichts mehr an. */
export const WS_MAX_BUFFERED_BYTES = 1024 * 1024;

/** Schließcodes, die ein Client senden darf (RFC 6455 7.4): 1005, 1006, 1015 und die ungenutzten Werte nie. */
function validClientCloseCode(code: number): boolean {
    return (code >= 1000 && code <= 1003) || (code >= 1007 && code <= 1014) || (code >= 3000 && code <= 4999);
}

export interface WebSocketConnection {
    /** Eine Textnachricht schicken; `false`, wenn die Verbindung zu ist. */
    send(text: string): boolean;
    /** Schließen mit Code (sendet den Schließrahmen, dann das Ende). */
    close(code: number, reason?: string): void;
    /** Ein Ping-Rahmen (Kontrolle). */
    ping(): void;
    /** Sofort beenden, ohne Schließrahmen. */
    terminate(): void;
    onMessage(listener: (text: string) => void): void;
    onClose(listener: (code: number) => void): void;
    readonly closed: boolean;
    /** Wann zuletzt irgendein Rahmen vom Client kam (ms). */
    readonly lastSeenMs: number;
    /** Wie viel noch zum Client unterwegs ist (Byte): ein langsamer Leser wird beendet. */
    readonly bufferedBytes: number;
}

export interface AcceptOptions {
    /** Größte erlaubte Nachricht des Clients, Byte. */
    maxPayload?: number;
    now?: () => number;
    /**
     * `Origin` gegen `Host` prüfen (Vorgabe). Aus, wenn der Aufrufer die Herkunft schon strenger geprüft hat: Mit eingerichteter
     * Anmeldung vergleicht der Einlass mit `PUBLIC_ORIGIN` (WI-0120 A11), und hinter einem Proxy muss `Host` nicht der öffentliche sein.
     */
    checkOrigin?: boolean;
}

/** `Sec-WebSocket-Accept` zu einem Schlüssel. */
export function acceptKey(key: string): string {
    return createHash("sha1")
        .update(key + GUID)
        .digest("base64");
}

function reject(socket: Duplex, status: number, message: string): void {
    const text = `HTTP/1.1 ${String(status)} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`;
    socket.end(text);
}

/** Prüft die Herkunft eines Browsers: `Origin` und `Host` müssen derselbe Ort sein. */
export function originMatchesHost(origin: string | undefined, host: string | undefined): boolean {
    if (origin === undefined) return true;
    if (host === undefined) return false;
    try {
        return new URL(origin).host.toLowerCase() === host.toLowerCase();
    } catch {
        return false;
    }
}

function frame(opcode: number, payload: Buffer): Buffer {
    const length = payload.length;
    let header: Buffer;
    if (length < 126) {
        header = Buffer.from([0x80 | opcode, length]);
    } else if (length < 65_536) {
        header = Buffer.alloc(4);
        header[0] = 0x80 | opcode;
        header[1] = 126;
        header.writeUInt16BE(length, 2);
    } else {
        header = Buffer.alloc(10);
        header[0] = 0x80 | opcode;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(length), 2);
    }
    return Buffer.concat([header, payload]);
}

/**
 * Nimmt eine Aufwertung (`Upgrade: websocket`) an. `null`, wenn der Handshake abgewiesen wurde (die Antwort ist dann schon geschickt).
 */
export function acceptWebSocket(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    options: AcceptOptions = {},
): WebSocketConnection | null {
    const maxPayload = options.maxPayload ?? 64 * 1024;
    const now = options.now ?? Date.now;
    const key = request.headers["sec-websocket-key"];
    const upgrade = String(request.headers["upgrade"] ?? "").toLowerCase();
    const connection = String(request.headers["connection"] ?? "").toLowerCase();
    if (
        request.method !== "GET" ||
        upgrade !== "websocket" ||
        !connection
            .split(",")
            .map((part) => part.trim())
            .includes("upgrade")
    ) {
        reject(socket, 400, "Bad Request");
        return null;
    }
    if (typeof key !== "string" || Buffer.from(key, "base64").length !== 16) {
        reject(socket, 400, "Bad Request");
        return null;
    }
    if (request.headers["sec-websocket-version"] !== "13") {
        socket.end(
            "HTTP/1.1 426 Upgrade Required\r\nSec-WebSocket-Version: 13\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
        );
        return null;
    }
    if (options.checkOrigin !== false && !originMatchesHost(request.headers["origin"], request.headers["host"])) {
        reject(socket, 403, "Forbidden");
        return null;
    }
    socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
    );

    const messageListeners: ((text: string) => void)[] = [];
    const closeListeners: ((code: number) => void)[] = [];
    let closed = false;
    let closing = false;
    let lastSeenMs = now();
    let buffer: Buffer = Buffer.alloc(0);
    // Eingang als Liste mit Summe: erst zusammenfügen, wenn der nächste Rahmen vollständig sein kann (kein concat je Stück).
    let inbound: Buffer[] = [];
    let inboundBytes = 0;
    let needBytes = 2;
    let fragments: Buffer[] = [];
    let fragmentBytes = 0;
    let fragmentOpcode = 0;

    const finish = (code: number): void => {
        if (closed) return;
        closed = true;
        for (const listener of closeListeners) listener(code);
    };
    const write = (data: Buffer): boolean => {
        if (closed || socket.destroyed || !socket.writable) return false;
        socket.write(data);
        return true;
    };
    const closeWith = (code: number, reason = ""): void => {
        if (closed || closing) return;
        closing = true;
        const reasonBytes = Buffer.from(reason, "utf8").subarray(0, 120);
        const payload = Buffer.alloc(2 + reasonBytes.length);
        payload.writeUInt16BE(code, 0);
        reasonBytes.copy(payload, 2);
        write(frame(0x8, payload));
        socket.end();
        // Antwortet der Client nicht mit seinem Schließrahmen, gibt es nach kurzer Frist das Ende.
        setTimeout(() => socket.destroy(), 2000).unref();
        finish(code);
    };

    const terminate = (): void => {
        socket.destroy();
        finish(1006);
    };

    const handleFrame = (fin: boolean, opcode: number, payload: Buffer): void => {
        lastSeenMs = now();
        if (opcode === 0x8) {
            if (payload.length === 1) {
                closeWith(WS_CLOSE.protocolError, "ungültiger Schließrahmen");
                return;
            }
            const code = payload.length >= 2 ? payload.readUInt16BE(0) : WS_CLOSE.normal;
            closeWith(validClientCloseCode(code) ? code : WS_CLOSE.protocolError);
            return;
        }
        if (opcode === 0x9) {
            // Liest der Client nie, würde jeder Ping die Warteschlange füllen.
            if (socket.writableLength > WS_MAX_BUFFERED_BYTES) {
                terminate();
                return;
            }
            write(frame(0xa, payload));
            return;
        }
        if (opcode === 0xa) return;
        if (opcode === 0x2) {
            closeWith(WS_CLOSE.unsupportedData, "nur Text");
            return;
        }
        if (opcode !== 0x1 && opcode !== 0x0) {
            closeWith(WS_CLOSE.protocolError, "unbekannter Rahmen");
            return;
        }
        if (opcode === 0x1) {
            if (fragments.length > 0) {
                closeWith(WS_CLOSE.protocolError, "unterbrochene Nachricht");
                return;
            }
            fragmentOpcode = 0x1;
        } else if (fragments.length === 0) {
            closeWith(WS_CLOSE.protocolError, "Fortsetzung ohne Anfang");
            return;
        }
        fragments.push(payload);
        fragmentBytes += payload.length;
        if (fragments.length > WS_MAX_FRAGMENTS || fragmentBytes > maxPayload) {
            closeWith(WS_CLOSE.tooBig, "zu groß");
            return;
        }
        if (!fin) return;
        const message = Buffer.concat(fragments);
        fragments = [];
        fragmentBytes = 0;
        if (fragmentOpcode === 0x1) {
            for (const listener of messageListeners) listener(message.toString("utf8"));
        }
    };

    const consume = (): void => {
        while (!closed && !closing) {
            if (buffer.length < 2) {
                needBytes = 2;
                return;
            }
            const first = buffer[0] as number;
            const second = buffer[1] as number;
            const fin = (first & 0x80) !== 0;
            const opcode = first & 0x0f;
            const masked = (second & 0x80) !== 0;
            let length = second & 0x7f;
            let offset = 2;
            if ((first & 0x70) !== 0) {
                closeWith(WS_CLOSE.protocolError, "reservierte Bits");
                return;
            }
            if (length === 126) {
                if (buffer.length < 4) {
                    needBytes = 4;
                    return;
                }
                length = buffer.readUInt16BE(2);
                offset = 4;
            } else if (length === 127) {
                if (buffer.length < 10) {
                    needBytes = 10;
                    return;
                }
                const big = buffer.readBigUInt64BE(2);
                if (big > BigInt(maxPayload)) {
                    closeWith(WS_CLOSE.tooBig, "zu groß");
                    return;
                }
                length = Number(big);
                offset = 10;
            }
            if (!masked) {
                closeWith(WS_CLOSE.protocolError, "der Client muss maskieren");
                return;
            }
            if (length > maxPayload) {
                closeWith(WS_CLOSE.tooBig, "zu groß");
                return;
            }
            if (buffer.length < offset + 4 + length) {
                needBytes = offset + 4 + length;
                return;
            }
            const mask = buffer.subarray(offset, offset + 4);
            const payload = Buffer.from(buffer.subarray(offset + 4, offset + 4 + length));
            for (let index = 0; index < payload.length; index += 1) {
                payload[index] = (payload[index] as number) ^ (mask[index % 4] as number);
            }
            buffer = buffer.subarray(offset + 4 + length);
            // Kontrollrahmen dürfen nicht fragmentiert sein und höchstens 125 Byte tragen.
            if (opcode >= 0x8 && (!fin || length > 125)) {
                closeWith(WS_CLOSE.protocolError, "ungültiger Kontrollrahmen");
                return;
            }
            handleFrame(fin, opcode, payload);
        }
    };

    const feed = (chunk: Buffer): void => {
        inbound.push(chunk);
        inboundBytes += chunk.length;
        if (buffer.length + inboundBytes < needBytes) return;
        buffer = Buffer.concat([buffer, ...inbound]);
        inbound = [];
        inboundBytes = 0;
        consume();
    };
    socket.on("data", (chunk: Buffer) => {
        // Nach dem Schließen wird nichts mehr angehängt, bis der Timer den Socket zerstört.
        if (closing || closed) return;
        feed(chunk);
    });
    // 🪤 Der HTTP-Server hält Verbindungen halb offen (`allowHalfOpen`): Beendet der Client seine Seite ohne Schließrahmen, muss der Server
    // seine Seite selbst schließen, sonst bleibt der Socket für immer stehen.
    socket.on("end", () => {
        socket.end();
        finish(1006);
    });
    socket.on("close", () => finish(1006));
    socket.on("error", () => {
        socket.destroy();
        finish(1006);
    });
    if (head.length > 0) {
        buffer = Buffer.from(head);
        needBytes = 2;
        consume();
    }

    return {
        send: (text) => {
            if (!closed && socket.writableLength > WS_MAX_BUFFERED_BYTES) {
                terminate();
                return false;
            }
            return write(frame(0x1, Buffer.from(text, "utf8")));
        },
        close: closeWith,
        ping: () => {
            write(frame(0x9, Buffer.alloc(0)));
        },
        terminate,
        onMessage: (listener) => {
            messageListeners.push(listener);
        },
        onClose: (listener) => {
            closeListeners.push(listener);
        },
        get closed() {
            return closed;
        },
        get lastSeenMs() {
            return lastSeenMs;
        },
        get bufferedBytes() {
            return socket.writableLength;
        },
    };
}
