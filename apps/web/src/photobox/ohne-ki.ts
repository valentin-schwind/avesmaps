import type { PhotoboxCreationKind } from "@avesmaps3d/shared";

/**
 * Der Filter „Ohne KI“ (WI-0272, Vali 2026-11-03, Probierseite Fassung 2): was er durchlässt und wo er gemerkt wird. „Reisebilder ausblenden“ (Vali 2026-11-04) wird genauso gemerkt.
 *
 * - 🔴 **Nur bekannte Angaben ohne KI gehen durch** (`OHNE_KI_ERLAUBT`), alles andere fällt mit heraus (Vali: „Bilder unbekannter Herkunft dürfen nicht als garantiert KI-frei gelten“). Die Entstehung ist beim
 *   Hochladen Pflicht, bleibt aber eine Selbstauskunft: Darum heißt nirgends etwas „KI-frei“, und der Hinweis am Knopf nennt die Angabe „keine Garantie“.
 * - 🔴 **Geschrieben wird erst beim Einschalten**, ausgeschaltet bleibt nichts liegen, kein Cookie (wie `meine-reisebilder.ts` und `camera-settings.ts`): Der Besucher verlangt die Einstellung selbst, ein
 *   Banner braucht sie nicht. Jeder Zugriff steht in `try/catch` (gesperrte Website-Daten, privates Fenster); ohne Speicher gilt der Filter bis zum Neuladen.
 */

export const OHNE_KI_SCHLUESSEL = "avesmaps.reisebilder.ohne-ki";
export const AUSGEBLENDET_SCHLUESSEL = "avesmaps.reisebilder.ausgeblendet";

/** Was vom Browserspeicher gebraucht wird; `localStorage` passt, ein Test legt eine Tafel hin. */
export type OhneKiSpeicher = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const OHNE_KI_ERLAUBT: ReadonlySet<string> = new Set<PhotoboxCreationKind>(["drawing", "photo", "avesmaps_capture"]);

/** Darf ein Reisebild dieser Entstehung bei „Ohne KI“ stehen bleiben? */
export const ohneKiZeigbar = (entstehung: string | undefined): boolean =>
    entstehung !== undefined && OHNE_KI_ERLAUBT.has(entstehung);

function standardSpeicher(): OhneKiSpeicher | undefined {
    try {
        return globalThis.localStorage;
    } catch {
        return undefined;
    }
}

function liesSchalter(schluessel: string, speicher: OhneKiSpeicher | undefined): boolean {
    try {
        return speicher?.getItem(schluessel) === "an";
    } catch {
        return false;
    }
}

function merkeSchalter(schluessel: string, an: boolean, speicher: OhneKiSpeicher | undefined): void {
    try {
        if (an) speicher?.setItem(schluessel, "an");
        else speicher?.removeItem(schluessel);
    } catch {
        // Ohne Speicher gilt der Schalter bis zum Neuladen.
    }
}

export function liesOhneKi(speicher: OhneKiSpeicher | undefined = standardSpeicher()): boolean {
    return liesSchalter(OHNE_KI_SCHLUESSEL, speicher);
}

export function merkeOhneKi(an: boolean, speicher: OhneKiSpeicher | undefined = standardSpeicher()): void {
    merkeSchalter(OHNE_KI_SCHLUESSEL, an, speicher);
}

export function liesAusgeblendet(speicher: OhneKiSpeicher | undefined = standardSpeicher()): boolean {
    return liesSchalter(AUSGEBLENDET_SCHLUESSEL, speicher);
}

export function merkeAusgeblendet(an: boolean, speicher: OhneKiSpeicher | undefined = standardSpeicher()): void {
    merkeSchalter(AUSGEBLENDET_SCHLUESSEL, an, speicher);
}
