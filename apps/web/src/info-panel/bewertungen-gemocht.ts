import { shallowRef, type ShallowRef } from "vue";

/**
 * „Gefällt mir“ einmal je Browser (WI-0269 C10, Fachkonzept §14.6a): Der Server zählt nur eine Zahl und weiß nicht, wer es war; dass dieser Browser eine Bewertung schon
 * mochte, merkt sich dieser Browser selbst (`localStorage`, höchstens 500 Kennungen, die ältesten fallen heraus). Ohne Speicher (privates Fenster, gesperrt) gilt das für die Sitzung
 * der Seite; nichts davon ist ein Konto oder eine Liste auf dem Server.
 *
 * Zurücknehmen geht im selben Browser: Ein zweiter Klick auf „♥ Gefällt mir“ nimmt es zurück.
 *
 * Dasselbe Gedächtnis dient den Reisebildern (WI-0304) unter eigenem Schlüssel (`createGemocht(speicher, schluessel)`); der Schlüssel der Bewertungen bleibt der Standard.
 */

export const GEMOCHT_SCHLUESSEL = "avesmaps.bewertungen.gefaellt";
export const GEMOCHT_MAX = 500;

type Speicher = Pick<Storage, "getItem" | "setItem">;

function standardSpeicher(): Speicher | undefined {
    try {
        return globalThis.localStorage;
    } catch {
        return undefined;
    }
}

function lies(speicher: Speicher | undefined, schluessel: string): string[] {
    try {
        const roh = speicher?.getItem(schluessel);
        const wert: unknown = roh === null || roh === undefined ? [] : JSON.parse(roh);
        return Array.isArray(wert) ? wert.filter((eintrag): eintrag is string => typeof eintrag === "string") : [];
    } catch {
        return [];
    }
}

export interface Gemocht {
    readonly kennungen: Readonly<ShallowRef<ReadonlySet<string>>>;
    hat(id: string): boolean;
    /** Setzt oder nimmt zurück und gibt den neuen Stand dieser Kennung zurück. */
    umschalten(id: string): boolean;
    /** Nimmt eine Kennung heraus, wo der Server das Setzen abgewiesen hat. */
    vergiss(id: string): void;
}

export function createGemocht(
    speicher: Speicher | undefined = standardSpeicher(),
    schluessel: string = GEMOCHT_SCHLUESSEL,
): Gemocht {
    const kennungen = shallowRef<ReadonlySet<string>>(new Set(lies(speicher, schluessel)));

    function setze(neu: Set<string>): void {
        kennungen.value = neu;
        try {
            speicher?.setItem(schluessel, JSON.stringify([...neu].slice(-GEMOCHT_MAX)));
        } catch {
            // Ohne Speicher bleibt es bei der Sitzung.
        }
    }

    return {
        kennungen,
        hat: (id) => kennungen.value.has(id),
        umschalten(id) {
            const neu = new Set(kennungen.value);
            const jetzt = !neu.delete(id);
            if (jetzt) neu.add(id);
            setze(neu);
            return jetzt;
        },
        vergiss(id) {
            if (!kennungen.value.has(id)) return;
            const neu = new Set(kennungen.value);
            neu.delete(id);
            setze(neu);
        },
    };
}

/** Das eine „Gefällt mir“-Gedächtnis der Seite. */
export const gemocht: Gemocht = createGemocht();
