import { shallowRef, type ShallowRef } from "vue";
import { istSchluessel } from "../community/api";

/**
 * Die Merkliste „Meine Reisebilder“ (WI-0272 S3, Aufgabe 19a; Entwurf 9, Betreiber 2026-11-01: „ok dann mach das so, auch in dem stil“): Wer ein Reisebild eingereicht hat, kann den persönlichen
 * Link auf diesem Gerät merken und findet seine Einreichungen im Kartenmenü unter „Meine Reisebilder“ wieder. Gemerkt wird nur im Browserspeicher; auf dem Server gibt es dafür nichts, kein Konto und
 * keinen Cookie.
 *
 * - 🔴 **EIN Schlüssel im Browserspeicher** (`MERKLISTE_SCHLUESSEL`), darin eine Liste von `{ schluessel, gemerktAm }`: der rohe Schlüssel des Links und die Zeit des Merkens. Nichts sonst, keine
 *   Bytes des Bildes und keine Beschreibung; was die Liste zeigt, holt das Fenster beim Öffnen vom Server (`meine-reisebilder-modell.ts`).
 * - 🔴 **Der rohe Schlüssel liegt nur dort.** Er geht nie in eine Adresse außer dem Fragment `/reisebild#…`, nie in ein Log und nie an einen anderen Ort als in den Rumpf einer Anfrage.
 * - 🔴 **Jeder Zugriff auf den Speicher steht in `try/catch`** (gesperrte Website-Daten, privates Fenster, voller Speicher): Es wirft nie. Ohne Speicher verschwindet die Funktion still: kein Häkchen,
 *   kein Menüeintrag, kein Eintrag (`verfuegbar`). Beim Lesen wird geprüft: Kaputtes und Fremdes zählt als leer (`pruefeMerkeintraege`), ein einzelner kaputter Eintrag fällt allein heraus.
 * - 🔴 **Geschrieben wird erst auf ausdrücklichen Wunsch, nie vorher** (Review S3 M1; § 25 Abs. 2 Nr. 2 TDDDG trägt nur, was jemand mit dem Häkchen verlangt): `verfuegbar` LIEST nur (ein Zugriff auf
 *   den Speicher, der nicht wirft) und legt nie einen Eintrag an, auch keinen vorübergehenden. Safari im privaten Fenster liest ohne Fehler und lehnt erst das Schreiben ab: Dann erscheint das Häkchen, und
 *   erst sein Setzen sagt es (`versuche` → „gesperrt“, der Kasten nennt den Grund). Beim Anlegen und beim Start der Seite wird nichts geschrieben.
 * - **Höchstens `MERKLISTE_MAX` Einträge:** Das Öffnen des Fensters fragt je Eintrag einmal den Stand und, wo das Bild noch eine Rolle spielt, einmal die Vorschau (Lesegrenze 120 je Stunde und Adresse):
 *   30 Einträge kosten höchstens 60. Weil der Rückweg Liste → Karte → Liste aus dem Zwischenspeicher der Sitzung kommt (`meine-reisebilder-modell.ts`, 60 s), kostet er dazu nur die zwei Aufrufe der
 *   Statusseite (Review S3 M2). Darüber wird nicht mehr gemerkt, und kein Eintrag fällt heraus (ein verlorener Link wäre schlimmer als ein abgelehntes Merken).
 */

export const MERKLISTE_SCHLUESSEL = "avesmaps.reisebilder.gemerkt";
export const MERKLISTE_MAX = 30;

export interface Merkeintrag {
    /** Der rohe Schlüssel des Links `/reisebild#…` (43 Zeichen). */
    readonly schluessel: string;
    /** Wann gemerkt wurde (ISO). */
    readonly gemerktAm: string;
}

/** Wie ein Versuch zu merken ausging: gemerkt, die Liste ist voll (`MERKLISTE_MAX`) oder der Speicher lässt das Schreiben nicht zu. */
export type MerkAusgang = "gemerkt" | "voll" | "gesperrt";

/** Was die Merkliste vom Browserspeicher braucht; `localStorage` passt. */
export type MerkSpeicher = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface Merkliste {
    /** Die gemerkten Einträge, die zuletzt gemerkten zuerst. */
    readonly eintraege: Readonly<ShallowRef<readonly Merkeintrag[]>>;
    /** Ist der Browserspeicher da und lesbar? Erst beim ersten Fragen geprüft, dann gemerkt; `false` heißt weder Häkchen noch Menüeintrag. 🔴 Schreibt nie (Review S3 M1). */
    verfuegbar(): boolean;
    hat(schluessel: string): boolean;
    /** Versucht zu merken und sagt, wie es ausging; geht es nicht, bleibt alles, wie es war. */
    versuche(schluessel: string, jetzt?: Date): MerkAusgang;
    /** Merkt den Schlüssel; `true`, wenn er danach gemerkt ist (auch, wenn er es schon war). Geht es nicht, bleibt alles, wie es war. */
    merke(schluessel: string, jetzt?: Date): boolean;
    /** Vergisst den Schlüssel auf diesem Gerät; ein unbekannter ist kein Fehler. Das Reisebild selbst bleibt eingereicht. */
    vergiss(schluessel: string): void;
    /** Liest den Speicher neu (ein anderer Tab hat gemerkt oder vergessen). */
    liesNeu(): void;
}

export interface MerklisteUmfeld {
    /** Der Browserspeicher; schon der Zugriff darauf kann werfen. */
    readonly speicher?: () => MerkSpeicher | undefined;
    readonly jetzt?: () => Date;
}

const ZEIT_MUSTER = /^\d{4}-\d{2}-\d{2}T/u;

/**
 * Die Prüfung beim Lesen: aus allem, was im Speicher stehen kann, die gültigen Einträge (Schlüssel im Format des Links, Zeit als ISO-Text), ohne Doppelte, höchstens `MERKLISTE_MAX`, in der
 * Reihenfolge des Speichers. Was keine Liste ist, ist leer; fremde Felder werden nicht übernommen.
 */
export function pruefeMerkeintraege(wert: unknown): Merkeintrag[] {
    if (!Array.isArray(wert)) return [];
    const gesehen = new Set<string>();
    const eintraege: Merkeintrag[] = [];
    for (const kandidat of wert as unknown[]) {
        if (typeof kandidat !== "object" || kandidat === null || Array.isArray(kandidat)) continue;
        const { schluessel, gemerktAm } = kandidat as Record<string, unknown>;
        if (typeof schluessel !== "string" || !istSchluessel(schluessel) || gesehen.has(schluessel)) continue;
        if (typeof gemerktAm !== "string" || !ZEIT_MUSTER.test(gemerktAm) || Number.isNaN(Date.parse(gemerktAm)))
            continue;
        gesehen.add(schluessel);
        eintraege.push({ schluessel, gemerktAm });
        if (eintraege.length >= MERKLISTE_MAX) break;
    }
    return eintraege;
}

/** Der Browserspeicher der Seite; schon der Zugriff kann werfen (gesperrte Website-Daten), dann keiner. */
function standardSpeicher(): MerkSpeicher | undefined {
    try {
        return globalThis.localStorage;
    } catch {
        return undefined;
    }
}

export function createMerkliste(umfeld: MerklisteUmfeld = {}): Merkliste {
    const holeSpeicher = umfeld.speicher ?? standardSpeicher;
    const jetzt = umfeld.jetzt ?? (() => new Date());
    /** Älteste zuerst, wie im Speicher; nach außen `eintraege` (neueste zuerst). */
    let abgelegt: Merkeintrag[] = [];
    const eintraege = shallowRef<readonly Merkeintrag[]>([]);
    let moeglich: boolean | undefined;

    const speicher = (): MerkSpeicher | undefined => {
        try {
            return holeSpeicher();
        } catch {
            return undefined;
        }
    };

    function zeige(): void {
        eintraege.value = [...abgelegt].reverse();
    }

    function lies(): Merkeintrag[] {
        try {
            const roh = speicher()?.getItem(MERKLISTE_SCHLUESSEL);
            if (roh === null || roh === undefined) return [];
            return pruefeMerkeintraege(JSON.parse(roh) as unknown);
        } catch {
            return [];
        }
    }

    /** Legt die Liste ab (die leere nimmt den Schlüssel heraus); `false`, wenn der Speicher es nicht hergab. */
    function schreibe(neu: readonly Merkeintrag[]): boolean {
        try {
            const ziel = speicher();
            if (ziel === undefined) return false;
            if (neu.length === 0) ziel.removeItem(MERKLISTE_SCHLUESSEL);
            else ziel.setItem(MERKLISTE_SCHLUESSEL, JSON.stringify(neu));
            return true;
        } catch {
            return false;
        }
    }

    /** Ist der Speicher da und lesbar? Es wird nur gelesen, nie geschrieben. */
    function liesbar(): boolean {
        try {
            const ziel = speicher();
            if (ziel === undefined) return false;
            ziel.getItem(MERKLISTE_SCHLUESSEL);
            return true;
        } catch {
            return false;
        }
    }

    /** Versucht zu merken und sagt, wie es ausging. */
    function versuche(schluessel: string, zeit: Date = jetzt()): MerkAusgang {
        // Der Speicher gilt, nicht der Stand der Seite: Was ein anderer Tab inzwischen abgelegt hat, geht beim Schreiben nicht verloren.
        const frisch = lies();
        if (frisch.some((eintrag) => eintrag.schluessel === schluessel)) {
            abgelegt = frisch;
            zeige();
            return "gemerkt";
        }
        if (!istSchluessel(schluessel)) return "gesperrt";
        if (frisch.length >= MERKLISTE_MAX) return "voll";
        const neu = [...frisch, { schluessel, gemerktAm: zeit.toISOString() }];
        if (!schreibe(neu)) return "gesperrt";
        abgelegt = neu;
        zeige();
        return "gemerkt";
    }

    abgelegt = lies();
    zeige();

    return {
        eintraege,
        verfuegbar() {
            moeglich ??= liesbar();
            return moeglich;
        },
        // Über `eintraege` gelesen, damit eine Anzeige, die danach fragt, dem Merken und Vergessen folgt.
        hat: (schluessel) => eintraege.value.some((eintrag) => eintrag.schluessel === schluessel),
        versuche,
        merke: (schluessel, zeit) => versuche(schluessel, zeit) === "gemerkt",
        vergiss(schluessel) {
            const frisch = lies();
            // In der Sitzung gilt das Vergessen auch dann, wenn der Speicher das Schreiben nicht hergibt.
            abgelegt = abgelegt.filter((eintrag) => eintrag.schluessel !== schluessel);
            if (frisch.some((eintrag) => eintrag.schluessel === schluessel))
                schreibe(frisch.filter((eintrag) => eintrag.schluessel !== schluessel));
            zeige();
        },
        liesNeu() {
            abgelegt = lies();
            zeige();
        },
    };
}

/** Die eine Merkliste der Seite. */
export const merkliste: Merkliste = createMerkliste();

// Ein anderer Tab desselben Browsers hat gemerkt oder vergessen: Menüeintrag und Fenster ziehen nach.
if (typeof globalThis.addEventListener === "function") {
    globalThis.addEventListener("storage", (ereignis) => {
        if (ereignis.key === null || ereignis.key === MERKLISTE_SCHLUESSEL) merkliste.liesNeu();
    });
}
