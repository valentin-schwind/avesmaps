import { isIPv4, isIPv6 } from "node:net";
import type { FastifyRequest } from "fastify";

/**
 * Die Adresse eines Besuchers, wie sie im Protokoll des Servers stehen darf: IPv4 auf /24, IPv6 auf /48 gekürzt (WI-0085,
 * Betreiber 2026-10-06 über Claudio: „Die gekürzte IP in Fastify/Pino bitte zusätzlich als Folgeschritt vorsehen; Nginx darf die
 * vollständige IP für maximal 14 Tage behalten.“).
 *
 * 🔴 Gekürzt wird NUR, was im Protokoll steht. Die Drossel je Client (`request.ip`, WI-0037 S-04) und alles andere in der Anfrage
 * sehen weiter die volle Adresse; sie wird nirgends gespeichert.
 *
 * Eine IPv4 in IPv6-Schreibweise (`::ffff:a.b.c.d`) bleibt eine IPv4 und verliert wie sie das letzte Oktett. Eine Zonenangabe
 * (`%eth0`) fällt weg. Was keine Adresse ist, wird nicht protokolliert.
 */
export function truncatedAddress(address: string | undefined): string | undefined {
    if (address === undefined || address === "") return undefined;
    const bare = address.split("%")[0] ?? "";
    if (isIPv4(bare)) return truncatedV4(bare);
    if (!isIPv6(bare)) return undefined;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/iu.exec(bare);
    if (mapped?.[1] !== undefined) return `::ffff:${truncatedV4(mapped[1])}`;
    return `${expandedV6(bare).slice(0, 3).join(":")}::`;
}

function truncatedV4(address: string): string {
    return `${address.split(".").slice(0, 3).join(".")}.0`;
}

/**
 * Der Schlüssel der Drossel je Client (WI-0120 A12, AUTH-0001 T7): IPv4 einzeln, IPv6 je /64. Ein Anschluss bekommt meist ein ganzes
 * /64; wer darin die Adresse wechselt, umginge sonst die Drossel. Der Schlüssel lebt nur im Speicher und wird nirgends gespeichert.
 */
export function throttleAddress(address: string): string {
    const bare = address.split("%")[0] ?? "";
    if (!isIPv6(bare)) return bare;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/iu.exec(bare);
    if (mapped?.[1] !== undefined) return mapped[1];
    return `${expandedV6(bare).slice(0, 4).join(":")}::/64`;
}

/** Die acht Gruppen einer IPv6-Adresse ohne führende Nullen; `::` wird aufgefüllt. Eingebettete IPv4 zählt als zwei Gruppen. */
function expandedV6(address: string): string[] {
    const groups = (part: string): string[] =>
        part === ""
            ? []
            : part.split(":").flatMap((group) => {
                  if (!group.includes(".")) return [group];
                  const [a = 0, b = 0, c = 0, d = 0] = group.split(".").map(Number);
                  return [((a << 8) | b).toString(16), ((c << 8) | d).toString(16)];
              });
    const [head = "", tail] = address.split("::");
    const front = groups(head);
    const back = tail === undefined ? [] : groups(tail);
    const fill = Array.from({ length: 8 - front.length - back.length }, () => "0");
    return [...front, ...fill, ...back].map((group) => Number.parseInt(group, 16).toString(16));
}

/** Die Anfragezeile im Protokoll; Felder ohne Wert fehlen, statt `undefined` zu tragen. */
export interface RequestLogValue {
    [key: string]: unknown;
    method: string;
    url: string;
    host: string;
    version?: string;
    remoteAddress?: string;
    remotePort?: number;
}

/**
 * Fastifys eigene Anfragezeile (`logger-pino.js`, `asReqValue`: dieselben Felder), nur mit gekürzter Adresse.
 */
export function requestLogValue(
    request: Pick<FastifyRequest, "method" | "url" | "headers" | "host" | "ip" | "socket">,
): RequestLogValue {
    const version = [request.headers["accept-version"]].flat()[0];
    const remoteAddress = truncatedAddress(request.ip);
    const remotePort = request.socket?.remotePort;
    return {
        method: request.method,
        // Unter `/api/auth/` nie die Query: Discords Rückkehr trägt `code` und `state` (WI-0120, AUTH-0001 T14).
        url: request.url.startsWith("/api/auth/") ? request.url.split("?")[0]! : request.url,
        host: request.host,
        ...(version === undefined ? {} : { version }),
        ...(remoteAddress === undefined ? {} : { remoteAddress }),
        ...(remotePort === undefined ? {} : { remotePort }),
    };
}
