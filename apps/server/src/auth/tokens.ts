import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Geheimnisse der Anmeldung (AUTH-0001 §5): 32 Byte Zufall, im Cookie oder Link als base64url, in der Datenbank nur als
 * SHA-256. Bei 256 Bit Zufall genügt ein schneller Hash (OWASP Session Management); ein Datenbankabbild enthält so keine
 * nutzbaren Werte (Kap. 10.70).
 */
export function randomToken(): string {
    return randomBytes(32).toString("base64url");
}

export function tokenHash(token: string): Buffer {
    return createHash("sha256").update(token, "utf8").digest();
}

/** Ein Token hat genau die Form, die `randomToken` erzeugt; alles andere wird gar nicht erst nachgeschlagen. */
export function isWellFormedToken(value: string | undefined): value is string {
    return value !== undefined && /^[A-Za-z0-9_-]{43}$/u.test(value);
}

/** Zwei Werte gleicher Herkunft in konstanter Zeit vergleichen. */
export function sameSecret(left: Buffer, right: Buffer): boolean {
    return left.length === right.length && timingSafeEqual(left, right);
}
