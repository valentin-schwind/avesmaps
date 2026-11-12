import { argon2, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Passwörter als Argon2id (WI-0120 A4, AUTH-0001 §6.4; Kap. 4.2 FIXED, 10.47). Aus `node:crypto` (seit Node 24.7, stabil seit
 * 24.19), ohne native Abhängigkeit. Parameter nach OWASP Password Storage Cheat Sheet: 19 MiB, zwei Durchläufe, eine Spur,
 * 16 Byte Salz, 32 Byte Ergebnis; lokal etwa 50 ms.
 *
 * Gespeichert wird der PHC-Text `$argon2id$v=19$m=19456,t=2,p=1$<salz>$<hash>` (Base64 ohne Auffüllung). Er trägt Verfahren und
 * Kosten: Ändern sich die Parameter, rechnet der nächste erfolgreiche Login neu (`needsRehash`).
 */
export const ARGON2_PARAMETERS = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 } as const;
const SALT_BYTES = 16;
const VERSION = 19;

interface Argon2Cost {
    memory: number;
    passes: number;
    parallelism: number;
    tagLength: number;
}

function derive(password: string, salt: Buffer, parameters: Argon2Cost): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        argon2(
            "argon2id",
            {
                message: Buffer.from(password, "utf8"),
                nonce: salt,
                parallelism: parameters.parallelism,
                tagLength: parameters.tagLength,
                memory: parameters.memory,
                passes: parameters.passes,
            },
            (error, key) => (error ? reject(error) : resolve(Buffer.from(key))),
        );
    });
}

const b64 = (buffer: Buffer): string => buffer.toString("base64").replace(/=+$/u, "");

/** Normalisiert wie NIST SP 800-63B-4 empfiehlt: NFC; sonst unverändert (keine Kürzung, keine Kleinschreibung). */
export function normalizePassword(password: string): string {
    return password.normalize("NFC");
}

export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const key = await derive(normalizePassword(password), salt, ARGON2_PARAMETERS);
    const { memory, passes, parallelism } = ARGON2_PARAMETERS;
    return `$argon2id$v=${String(VERSION)}$m=${String(memory)},t=${String(passes)},p=${String(parallelism)}$${b64(salt)}$${b64(key)}`;
}

interface ParsedHash {
    memory: number;
    passes: number;
    parallelism: number;
    salt: Buffer;
    key: Buffer;
}

const PHC = /^\$argon2id\$v=19\$m=(\d{1,8}),t=(\d{1,3}),p=(\d{1,3})\$([A-Za-z0-9+/]{16,})\$([A-Za-z0-9+/]{16,})$/u;

export function parseHash(phc: string): ParsedHash | undefined {
    const match = PHC.exec(phc);
    if (match === null) return undefined;
    return {
        memory: Number(match[1]),
        passes: Number(match[2]),
        parallelism: Number(match[3]),
        salt: Buffer.from(match[4]!, "base64"),
        key: Buffer.from(match[5]!, "base64"),
    };
}

export async function verifyPassword(password: string, phc: string): Promise<{ ok: boolean; needsRehash: boolean }> {
    const parsed = parseHash(phc);
    if (parsed === undefined) return { ok: false, needsRehash: false };
    const key = await derive(normalizePassword(password), parsed.salt, {
        memory: parsed.memory,
        passes: parsed.passes,
        parallelism: parsed.parallelism,
        tagLength: parsed.key.length,
    });
    const ok = key.length === parsed.key.length && timingSafeEqual(key, parsed.key);
    const needsRehash =
        parsed.memory !== ARGON2_PARAMETERS.memory ||
        parsed.passes !== ARGON2_PARAMETERS.passes ||
        parsed.parallelism !== ARGON2_PARAMETERS.parallelism ||
        parsed.key.length !== ARGON2_PARAMETERS.tagLength;
    return { ok, needsRehash: ok && needsRehash };
}

let dummy: Promise<string> | undefined;

/**
 * Ein fester Blindwert für unbekannte Benutzernamen: Gegen ihn wird genauso lange gerechnet wie gegen ein echtes Konto, damit
 * die Antwortzeit nicht verrät, ob es den Namen gibt (Legacy: 0,075 s gegen 0,315 s; AUTH-0001 T8).
 */
export function dummyHash(): Promise<string> {
    dummy ??= hashPassword(randomBytes(24).toString("base64"));
    return dummy;
}

/** Beim Start: Argon2 muss da sein und rechnen, sonst startet der Server nicht (fail closed, Recherche B4). */
export async function selfTestArgon2(): Promise<void> {
    if (typeof argon2 !== "function")
        throw new Error("node:crypto.argon2 fehlt (Node ≥ 24.19 mit OpenSSL ≥ 3.2 nötig)");
    const phc = await hashPassword("Selbsttest der Anmeldung");
    const { ok } = await verifyPassword("Selbsttest der Anmeldung", phc);
    if (!ok) throw new Error("Argon2id-Selbsttest gescheitert");
}
