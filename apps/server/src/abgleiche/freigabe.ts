import { UUID_PATTERN } from "@avesmaps3d/shared";

/**
 * Die Freigabe eines Legacy-Werkzeugs, das schreibt (`legacy:update`, `migrate:media`, `legacy:media-fetch`, `migrate:media-files`;
 * WI-0127 SYS-14 §13.4 Nr. 5). Zwei Wege, die sich ausschließen:
 *
 * - **`--operator-said "<Zitat>"`**: der Zuruf des Betreibers an einen Agenten („zieh mal“). Er ist die persönliche, scope-genaue
 *   Freigabe genau dieses einen Laufs (Map Mutation Guard, AGENTS.md) und kommt wörtlich in den Bericht.
 * - **`--auftrag <Job>`**: ein Auftrag aus der Verwaltung („Abgleiche“), den eine berechtigte Person mit dem Knopf ausgelöst hat. Das ist
 *   ein deterministischer Produktprozess, keine Agentenmutation (AGENTS.md: „Normale deterministische Produktprozesse, die durch
 *   berechtigte Nutzer ausgelöst werden, gelten nicht als Agentenmutation“). Wer ihn ausgelöst hat, steht mit Person im Protokoll
 *   (`system.sync_requested`); Bericht und Ausgabe nennen nur die Kennung des Auftrags, keinen Namen.
 *
 * Ohne beides rechnet das Werkzeug nur, wie bisher.
 */
export interface Freigabe {
    /** Wird eingespielt? */
    apply: boolean;
    /** Die Zeile für Ausgabe und Bericht; `null` ohne Freigabe. */
    zeile: string | null;
    /** Die Kurzform für Listen (`zug` im Download-Fach); `null` ohne Freigabe. */
    kurz: string | null;
    /** Die Kennung des Auftrags aus der Verwaltung, sonst `null`. */
    auftrag: string | null;
}

export class FreigabeFehler extends Error {
    constructor(message: string) {
        super(message);
        this.name = "FreigabeFehler";
    }
}

const AUFTRAG = new RegExp(UUID_PATTERN, "u");

export function freigabeAus(werte: { "operator-said"?: string | undefined; auftrag?: string | undefined }): Freigabe {
    const said = werte["operator-said"];
    const auftrag = werte.auftrag;
    if (said !== undefined && auftrag !== undefined) {
        throw new FreigabeFehler("--operator-said und --auftrag schließen sich aus: ein Lauf hat genau eine Freigabe");
    }
    if (auftrag !== undefined) {
        if (!AUFTRAG.test(auftrag)) throw new FreigabeFehler(`--auftrag braucht die Kennung eines Jobs: ${auftrag}`);
        return {
            apply: true,
            zeile: `Freigabe (Auftrag aus der Verwaltung, „Abgleiche“): ${auftrag}`,
            kurz: `Auftrag ${auftrag} (Verwaltung)`,
            auftrag,
        };
    }
    if (said !== undefined) {
        return { apply: true, zeile: `Freigabe (Betreiberzitat): „${said}“`, kurz: said, auftrag: null };
    }
    return { apply: false, zeile: null, kurz: null, auftrag: null };
}

/** Für die Kommandozeile: ein Aufruffehler beendet mit Exit 2 und dem Satz, ohne Stapel. */
export function freigabeOderEnde(werte: {
    "operator-said"?: string | undefined;
    auftrag?: string | undefined;
}): Freigabe {
    try {
        return freigabeAus(werte);
    } catch (error) {
        if (!(error instanceof FreigabeFehler)) throw error;
        console.error(error.message);
        process.exit(2);
    }
}
