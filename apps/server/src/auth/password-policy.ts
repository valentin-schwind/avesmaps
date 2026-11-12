/**
 * Regeln für neue Passwörter (WI-0120 A4, AUTH-0001 §6.4; NIST SP 800-63B-4 §3.1.1, Passwort als einziger Faktor):
 * mindestens 15 Zeichen, bis 256 Zeichen und 1024 Byte, gezählt in Unicode-Zeichen nach NFC; KEINE Zeichenklassen-Pflicht,
 * kein Ablaufzwang. Abgelehnt wird, was häufig, erwartbar oder kontextbezogen ist (SHALL): eine kleine lokale Liste langer
 * häufiger Passwörter, einfache Muster (Wiederholung, Folgen, Tastaturreihen) und Wörter aus dem Kontext (Benutzername,
 * Anzeigename, „avesmaps“, „aventurien“, „dsa“). Ein externer Abgleich mit Datenlecks findet nicht statt (Kap. 10.46).
 */
export const PASSWORD_MIN_CHARS = 15;
export const PASSWORD_MAX_CHARS = 256;
export const PASSWORD_MAX_BYTES = 1024;

export type PasswordProblem = "too_short" | "too_long" | "common" | "pattern" | "contextual";

/** Häufige Passwörter ab 15 Zeichen und häufige Grundwörter, die durch Wiederholen lang werden (kleingeschrieben). */
const COMMON = new Set([
    "passwordpassword",
    "password123456789",
    "123456789012345",
    "1234567890123456",
    "qwertyuiopasdfghjkl",
    "qwertzuiopasdfghjkl",
    "iloveyouiloveyou",
    "abcdefghijklmnop",
    "letmeinletmein",
    "passwortpasswort",
    "hallohallohallo",
    "geheimgeheimgeheim",
    "administrator123",
    "correcthorsebatterystaple",
    "trustno1trustno1",
]);

const BASE_WORDS = [
    "password",
    "passwort",
    "qwerty",
    "qwertz",
    "admin",
    "letmein",
    "welcome",
    "iloveyou",
    "geheim",
    "hallo",
];
const CONTEXT_WORDS = ["avesmaps", "aventurien", "aventuria", "dsa"];
const KEYBOARD_ROWS = [
    "qwertzuiopasdfghjklyxcvbnm",
    "qwertyuiopasdfghjklzxcvbnm",

    "1234567890",
    "qwertyuiop",
    "qwertzuiop",
    "asdfghjkl",
    "yxcvbnm",
    "zxcvbnm",
    "abcdefghijklmnopqrstuvwxyz",
];

function chars(value: string): string[] {
    return [...value];
}

/** Besteht das Passwort nur aus einer Wiederholung einer kurzen Einheit („abcabcabc…“, „aaaa…“)? */
function isRepetition(value: string): boolean {
    const list = chars(value);
    for (let unit = 1; unit <= Math.min(8, Math.floor(list.length / 2)); unit += 1) {
        if (list.length % unit !== 0) continue;
        const head = list.slice(0, unit).join("");
        if (head.repeat(list.length / unit) === value) return true;
    }
    return false;
}

/** Läuft es eine Tastaturreihe oder das Alphabet entlang (vorwärts oder rückwärts, zyklisch)? */
function isWalk(value: string): boolean {
    for (const row of KEYBOARD_ROWS) {
        const cycle = row + row + row + row;
        const reversed = [...cycle].reverse().join("");
        if (cycle.includes(value) || reversed.includes(value)) return true;
    }
    return false;
}

/** Was übrig bleibt, wenn alle Kontext- und Grundwörter entfernt sind. */
function residue(value: string, words: readonly string[]): string {
    let rest = value;
    for (const word of words) {
        if (word.length >= 3) rest = rest.split(word).join("");
    }
    return rest.replace(/[\d\s\W_]/gu, "");
}

export function checkPassword(
    password: string,
    context: { loginName?: string | undefined; displayName?: string | undefined } = {},
): PasswordProblem[] {
    const normalized = password.normalize("NFC");
    const length = chars(normalized).length;
    if (length < PASSWORD_MIN_CHARS) return ["too_short"];
    if (length > PASSWORD_MAX_CHARS || Buffer.byteLength(normalized, "utf8") > PASSWORD_MAX_BYTES) return ["too_long"];
    const lower = normalized.toLowerCase();
    const compact = lower.replace(/\s+/gu, "");
    const problems: PasswordProblem[] = [];
    if (COMMON.has(compact)) problems.push("common");
    if (isRepetition(compact) || isWalk(compact)) problems.push("pattern");
    const personal = [context.loginName, context.displayName]
        .filter((word): word is string => word !== undefined && word.trim().length >= 3)
        .map((word) => word.toLowerCase().replace(/\s+/gu, ""));
    const words = [...personal, ...CONTEXT_WORDS, ...BASE_WORDS];
    // Kontextbezogen: Entfernt man Kontext- und Grundwörter, bleibt fast nichts (weniger als acht Buchstaben).
    if (words.some((word) => compact.includes(word)) && chars(residue(compact, words)).length < 8)
        problems.push("contextual");
    return problems;
}
