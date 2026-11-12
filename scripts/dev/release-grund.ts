// Die Notizen `offen` und `rot` des Release-Runners (WI-0248 R1): Text und Begründung.
//
// 🔴 Die Notiz steht im öffentlichen Git (`refs/notes/sammellauf`) und wird von Claudios Lesern und der Oberfläche gezeigt: Die zweite Zeile
// nennt den Grund kurz und trägt nie einen lokalen Pfad, eine Adresse mit Zugangsdaten oder ein Geheimnis. Die erste Zeile (`<sha40> <ISO> rot`)
// lesen die Leser allein; die Begründung ist für Menschen.

/** Eine Voraussetzung des Laufs fehlt (Testpaket, Manifest, PostgreSQL, Martin, npm): Der Satz ist vom Runner geschrieben und pfadfrei. */
export class VoraussetzungFehlt extends Error {
    constructor(text: string) {
        super(text);
        this.name = "VoraussetzungFehlt";
    }
}

/** Die längste zweite Zeile. */
export const GRUND_MAX = 200;

const ERSETZUNGEN: readonly (readonly [RegExp, string])[] = [
    [/\b[a-z][a-z0-9+.-]*:\/\/\S+/giu, "<url>"],
    [/\b[A-Za-z]:[\\/]\S*/gu, "<pfad>"],
    [/\\\\[^\s\\]+\\\S*/gu, "<pfad>"],
    [/(^|[\s("'=])\/(?:[^\s/"')]+\/)+[^\s"')]*/gu, "$1<pfad>"],
    [/\b(\w*(?:token|secret|password|passwort|api[_-]?key)\w*)\s*[=:]\s*\S+/giu, "$1=<verborgen>"],
];

/** Die erste nicht leere Zeile eines Textes, ohne Pfade, Adressen und Geheimnisse, in einer Zeile und höchstens `GRUND_MAX` Zeichen lang. */
export function bereinigeGrund(text: string): string {
    let zeile = text.split(/\r?\n/).find((z) => z.trim() !== "") ?? "";
    for (const [muster, ersatz] of ERSETZUNGEN) zeile = zeile.replace(muster, ersatz);
    zeile = zeile.replace(/\s+/gu, " ").trim();
    if (zeile === "") return "unbekannter Fehler";
    return zeile.length > GRUND_MAX ? `${zeile.slice(0, GRUND_MAX - 1)}…` : zeile;
}

/**
 * Die zweite Zeile der roten Notiz zu einem Fehler: „Voraussetzung fehlt: …“ für eine fehlende Voraussetzung, sonst „Lauf fehlgeschlagen: …“.
 * Ein gescheiterter Schritt nennt nur Namen und Exitcode; was das Protokoll des Schritts sagt, bleibt auf dem Rechner (Daten, Pfade).
 */
export function notizGrund(fehler: unknown): string {
    const text = fehler instanceof Error ? fehler.message : "Runner fehlgeschlagen";
    if (fehler instanceof VoraussetzungFehlt) return `Voraussetzung fehlt: ${bereinigeGrund(text)}`;
    if (text.startsWith("timeout")) return "Lauf fehlgeschlagen: Zeitüberschreitung eines Schritts";
    const schritt = /^([a-z0-9-]+): (?:pg_restore )?Exit (-?\d+)/u.exec(text);
    if (schritt !== null) return `Lauf fehlgeschlagen: ${schritt[1] ?? ""}: Exit ${schritt[2] ?? ""}`;
    return `Lauf fehlgeschlagen: ${bereinigeGrund(text)}`;
}

/**
 * Die zweite Zeile der roten Notiz, wenn MEHRERE Teile rot sind (der Lauf läuft seit WI-0248 bis zum Ende): die Kurzfassungen der roten Teile in der
 * Reihenfolge des Laufs, mit „; “ verbunden. Jede Kurzfassung nennt nur Namen und Zahlen (`Vitest: 3 rot …`, `Browserteil 2: 1 rot`, `lint: Exit 1`);
 * `rotNotiz` kürzt die Zeile auf `GRUND_MAX` und nimmt Pfade und Adressen heraus.
 */
export function notizGrundTeile(kurz: readonly string[]): string {
    return `Lauf fehlgeschlagen: ${kurz.join("; ")}`;
}

/** Die Notiz „offen“: Der Auftrag läuft, es gibt keinen Freigabenachweis. */
export function offenNotiz(sha: string, start: string): string {
    return `${sha} ${start} offen\nRelease-Auftrag läuft; kein Freigabenachweis.\n`;
}

/** Die Notiz „rot“ mit der Begründung (`notizGrund`) in der zweiten Zeile. */
export function rotNotiz(sha: string, ende: string, grund: string): string {
    return `${sha} ${ende} rot\n${bereinigeGrund(grund)}\n`;
}

/** Der Teil des Vitest-Berichts (Reporter `json`, `vitest.json`), den die Prüfung der Teststufe liest. */
export interface VitestBericht {
    success?: boolean;
    numTotalTests?: number;
    numPendingTests?: number;
    numFailedTests?: number;
    numFailedTestSuites?: number;
    numTodoTests?: number;
    numPassedTests?: number;
    testResults?: { name?: string; status?: string }[];
}

const zahlOder0 = (wert: unknown): number => (typeof wert === "number" && Number.isFinite(wert) ? wert : 0);
const glatt = (pfad: string): string => pfad.replace(/\\/gu, "/");

/**
 * Das Urteil der Teststufe über den Vitest-Bericht: `null`, wenn alles grün ist (kein roter, übersprungener oder leerer Fall, jede erwartete
 * Testdatei grün im Bericht), sonst die Meldung des Fehlschlags mit den Zahlen, damit die Karte „Release-Test“ und die Notiz sagen, WAS fehlt:
 * „Vitest: 0 rot, 0 übersprungen, 40 todo (Fälle ohne Inhalt)“. `erwartet` sind die absoluten Pfade der Testdateien des Klons (wie `name`).
 *
 * 🔴 Die Meldung nennt nur Zahlen, nie Namen oder Pfade (sie steht in der öffentlichen Notiz); die Namen der Fälle stehen im Bericht
 * (`release-bericht.ts`).
 */
export function vitestMeldung(
    v: VitestBericht,
    erwartet: readonly string[],
    optionen: { readonly todoGruen?: boolean } = {},
): string | null {
    const gesamt = zahlOder0(v.numTotalTests);
    const dateien = v.testResults ?? [];
    const rotDateien = dateien.filter((d) => d.status === "failed").length;
    // Eine Datei, die gar nicht lief (Import fehlt, Absturz), zählt als ein roter Fall; sonst die roten Fälle.
    const rot =
        zahlOder0(v.numFailedTests) > 0
            ? zahlOder0(v.numFailedTests)
            : Math.max(rotDateien, zahlOder0(v.numFailedTestSuites));
    const uebersprungen = zahlOder0(v.numPendingTests);
    const todo = zahlOder0(v.numTodoTests);
    const vorhanden = new Set(dateien.map((d) => glatt(d.name ?? "")));
    const gruen = new Set(dateien.filter((d) => d.status === "passed").map((d) => glatt(d.name ?? "")));
    // Fehlend ist eine Datei, die im Bericht gar nicht vorkommt; eine rote zählt unter „rot“, nicht doppelt.
    const fehlend = erwartet.filter((pfad) => !vorhanden.has(glatt(pfad))).length;
    const ohneErgebnis = gesamt - zahlOder0(v.numPassedTests) - rot - uebersprungen - todo;
    if (
        v.success === true &&
        gesamt > 0 &&
        rot === 0 &&
        uebersprungen === 0 &&
        (todo === 0 || optionen.todoGruen === true) &&
        ohneErgebnis <= 0 &&
        erwartet.every((pfad) => gruen.has(glatt(pfad)))
    )
        return null;
    const teile = [`${String(rot)} rot`, `${String(uebersprungen)} übersprungen`, `${String(todo)} todo`];
    if (todo > 0) teile[2] += " (Fälle ohne Inhalt)";
    if (fehlend > 0)
        teile.push(
            fehlend === 1
                ? "1 erwartete Testdatei fehlt im Bericht"
                : `${String(fehlend)} erwartete Testdateien fehlen im Bericht`,
        );
    if (gesamt === 0) teile.push("keine Fälle im Bericht");
    else if (ohneErgebnis > 0) teile.push(`${String(ohneErgebnis)} ohne Ergebnis`);
    else if (teile.length === 3 && rot + uebersprungen + todo === 0) teile.push("Bericht ist nicht grün");
    return `Vitest: ${teile.join(", ")}`;
}
