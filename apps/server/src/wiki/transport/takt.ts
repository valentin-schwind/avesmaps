import { join } from "node:path";
import { TAKT_ABSTAND_MS, TAKT_JITTER_MAX_MS, TAKT_MAX_WARTESCHLANGE } from "./konstanten.ts";
import { leseDatei, schreibeAtomar, type TaktOrt } from "./ort.ts";

/**
 * Der Takt der Wiki-Anfragen (WI-0253 B-1, B1-Vertrag; Legacy `drossel.php`): mindestens 20 Sekunden plus Jitter zwischen zwei Anfragen an
 * das Wiki, EINSCHLIESSLICH Anmelde-POSTs und Dump-Abrufen, und zwar über Prozess-, Worker- und Umgebungsgrenzen hinweg.
 *
 * ⭐ ES WIRD EIN PLATZ RESERVIERT, NICHT DIE SPERRE GEHALTEN. Der Aufrufer trägt unter der Sperre ein, WANN er dran ist, gibt sie sofort
 * wieder frei und schläft erst danach. Zwei gleichzeitige Aufrufer bekommen so aufeinanderfolgende Plätze, ohne einander zu blockieren.
 *
 * Der Vermerk `letzte-anfrage` ist eine Zeile mit dem vergebenen Platz in Unix-Millisekunden.
 *
 * 🔴 GESCHLOSSEN. Ohne nutzbaren Ort (`ort.ts`) geht nichts hinaus. Und der Vermerk selbst:
 *   - FEHLT er oder ist er KAPUTT (kein Zahlenwert), gilt „vor einem Augenblick war eine Anfrage“: voller Abstand, nie null. Ob es je eine
 *     gab, lässt sich nicht unterscheiden, also die sichere Richtung (Legacy ließ die erste durch; das kostet hier einmal 20 Sekunden).
 *     Der Vermerk wird dabei sofort neu geschrieben, damit er heilt, auch wenn nur der nicht wartende Zweig fragt.
 *   - Liegt der Platz absurd weit vorn (mehr als 20 Abstände: verstellte Uhr, von Hand angefasst), ist er kaputt, nicht Warteschlange.
 *
 * Zwei Zweige, ein Vermerk (zwei Drosseln nebeneinander wären keine):
 *   - `nimm` wartet. Richtig für jeden Lauf, den jemand ausdrücklich gestartet hat.
 *   - `versuche` wartet NICHT und meldet, ob der Platz frei war. Richtig für alles, worauf ein Mensch wartet. Er reserviert NICHTS, wenn er
 *     abweist: Ein abgewiesener Abruf hat nichts geholt, belegte er trotzdem einen Platz, schöbe jeder abgewiesene Klick den nächsten
 *     echten Abruf um einen vollen Abstand nach hinten. Er streut auch nicht (Jitter): Es wird nicht gewartet, und eine zufällig größere
 *     Schranke machte die Abweisung unreproduzierbar.
 */

export interface TaktOptionen {
    abstandMs?: number | undefined;
    jitterMaxMs?: number | undefined;
    /** Gleichverteilte Zahl in [0, 1); nur Tests ersetzen sie. */
    zufall?: (() => number) | undefined;
}

export type VermerkZustand = "gueltig" | "fehlt" | "kaputt" | "zu_weit_vorn";

export interface Platz {
    /** Wann der Aufrufer dran ist (Unix-Millisekunden). */
    platzMs: number;
    /** So lange hat er (zum Zeitpunkt der Reservierung) noch zu warten. */
    wartetMs: number;
    vermerk: VermerkZustand;
}

export type Versuch = { frei: true; platz: Platz } | { frei: false; freiInMs: number; vermerk: VermerkZustand };

export interface Takt {
    /** Reserviert den nächsten Platz und wartet, bis er da ist. */
    nimm(signal?: AbortSignal): Promise<Platz>;
    /** Nimmt den Platz nur, wenn er sofort frei ist; sonst Absage mit Restzeit und ohne jede Spur im Vermerk. */
    versuche(): Promise<Versuch>;
    /** Wann wäre ein Platz frei (0: sofort)? Liest nur, ändert nichts. */
    freiInMs(): Promise<number>;
}

const VERMERK_DATEI = "letzte-anfrage";

type Gelesen = { zustand: VermerkZustand; letzteMs: number };

function lies(roh: string | null, jetzt: number, abstandMs: number): Gelesen {
    if (roh === null) return { zustand: "fehlt", letzteMs: jetzt };
    const text = roh.trim();
    // Nur ganze Millisekunden aus Ziffern: alles andere (leer, Text, Gleitkomma, Minus) ist kaputt, nie „0“.
    if (!/^\d{10,16}$/u.test(text)) return { zustand: "kaputt", letzteMs: jetzt };
    const letzteMs = Number(text);
    if (letzteMs > jetzt + abstandMs * TAKT_MAX_WARTESCHLANGE) return { zustand: "zu_weit_vorn", letzteMs: jetzt };
    return { zustand: "gueltig", letzteMs };
}

export function erzeugeTakt(ort: TaktOrt, optionen: TaktOptionen = {}): Takt {
    const abstandMs = optionen.abstandMs ?? TAKT_ABSTAND_MS;
    const jitterMaxMs = optionen.jitterMaxMs ?? TAKT_JITTER_MAX_MS;
    const zufall = optionen.zufall ?? Math.random;

    async function leseVermerk(verzeichnis: string, jetzt: number): Promise<Gelesen> {
        return lies(await leseDatei(join(verzeichnis, VERMERK_DATEI)), jetzt, abstandMs);
    }

    async function schreibeVermerk(verzeichnis: string, platzMs: number): Promise<void> {
        await schreibeAtomar(join(verzeichnis, VERMERK_DATEI), `${String(Math.ceil(platzMs))}\n`);
    }

    return {
        async nimm(signal?: AbortSignal): Promise<Platz> {
            const platz = await ort.mitSperre(async (verzeichnis) => {
                const jetzt = ort.jetzt();
                const gelesen = await leseVermerk(verzeichnis, jetzt);
                const jitter = Math.floor(zufall() * (jitterMaxMs + 1));
                const platzMs = Math.max(jetzt, gelesen.letzteMs + abstandMs + jitter);
                await schreibeVermerk(verzeichnis, platzMs);
                return { platzMs, wartetMs: platzMs - jetzt, vermerk: gelesen.zustand };
            });
            // Erst NACH der Sperre schlafen: Wer wartet, hält niemanden auf.
            if (platz.wartetMs > 0) await ort.schlafe(platz.wartetMs, signal);
            return platz;
        },

        async versuche(): Promise<Versuch> {
            return ort.mitSperre(async (verzeichnis) => {
                const jetzt = ort.jetzt();
                const gelesen = await leseVermerk(verzeichnis, jetzt);
                const platzMs = Math.max(jetzt, gelesen.letzteMs + abstandMs);
                if (platzMs > jetzt) {
                    // Fehlt oder zerstört: neu vermerken, sonst bliebe der Zweig für immer „belegt“. Ein gültiger Vermerk bleibt unberührt.
                    if (gelesen.zustand !== "gueltig") await schreibeVermerk(verzeichnis, jetzt);
                    return { frei: false as const, freiInMs: platzMs - jetzt, vermerk: gelesen.zustand };
                }
                await schreibeVermerk(verzeichnis, jetzt);
                return { frei: true as const, platz: { platzMs: jetzt, wartetMs: 0, vermerk: gelesen.zustand } };
            });
        },

        async freiInMs(): Promise<number> {
            const verzeichnis = await ort.ordner();
            const jetzt = ort.jetzt();
            const gelesen = await leseVermerk(verzeichnis, jetzt);
            return Math.max(0, gelesen.letzteMs + abstandMs - jetzt);
        },
    };
}
