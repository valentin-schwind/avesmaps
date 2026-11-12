/**
 * Cookies lesen und schreiben (WI-0120 A3). Eigener kleiner Code statt `@fastify/cookie`: Der WebSocket-Handshake läuft an
 * Fastify vorbei (`routes/realtime.ts`) und braucht denselben Leser, und eine neue Laufzeitabhängigkeit hätte eine ADR
 * gebraucht (AUTH-0001 §0 Nr. 8).
 */

/** Alle Cookies eines `Cookie`-Kopfes; bei doppeltem Namen gilt der erste (RFC 6265 §5.4: der spezifischere steht vorn). */
export function parseCookies(header: string | undefined): ReadonlyMap<string, string> {
    const cookies = new Map<string, string>();
    if (header === undefined || header === "") return cookies;
    for (const part of header.split(";")) {
        const separator = part.indexOf("=");
        if (separator <= 0) continue;
        const name = part.slice(0, separator).trim();
        if (name === "" || cookies.has(name)) continue;
        let value = part.slice(separator + 1).trim();
        if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1);
        cookies.set(name, value);
    }
    return cookies;
}

export interface CookieOptions {
    secure: boolean;
    /** Sekunden; ohne Wert ein Sitzungscookie des Browsers. 0 löscht. */
    maxAge?: number;
    sameSite?: "Lax" | "Strict";
}

const SAFE_VALUE = /^[A-Za-z0-9_\-.~]*$/u;
const SAFE_NAME = /^[A-Za-z0-9_-]+$/u;

/** Ein `Set-Cookie`-Wert: immer `HttpOnly`, `Path=/`, nie `Domain` (host-gebunden). */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
    if (!SAFE_NAME.test(name)) throw new Error(`Cookie-Name nicht erlaubt: ${name}`);
    if (!SAFE_VALUE.test(value)) throw new Error("Cookie-Wert nicht erlaubt");
    const parts = [`${name}=${value}`, "Path=/", "HttpOnly", `SameSite=${options.sameSite ?? "Lax"}`];
    if (options.secure) parts.push("Secure");
    if (options.maxAge !== undefined) parts.push(`Max-Age=${String(Math.max(0, Math.floor(options.maxAge)))}`);
    return parts.join("; ");
}
