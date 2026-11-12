import { PIPELINE_STEPS } from "../migration/pipeline-steps.ts";

/**
 * Wie ein Werkzeug dem Auftrag, der es gestartet hat, seinen Stand meldet (WI-0127 SYS-14 §13.4 Nr. 4): zwei Arten von Zeilen auf der
 * Standardausgabe, nur im Lauf mit `--auftrag`. Der Handler im Job-Prozess liest sie mit, meldet die Phase an die Warteschlange und
 * nimmt das Ergebnis in die Jobzeile; jede andere Zeile geht unverändert ins Journal des Workers.
 *
 *     ::abgleich-phase I11
 *     ::abgleich-ergebnis {"luecken":["I24"],"befunde":12,"satz":"map169042-eco163884-live20261011t1405z"}
 *
 * Ein eigener Prozess je Werkzeug statt eines Aufrufs im Job-Prozess: Das Werkzeug bleibt die EINE Stelle für Zuruf und Knopf, und ein
 * Abbruch an der Phasengrenze beendet genau diesen Prozess.
 */
export const PHASE_MARKE = "::abgleich-phase ";

/**
 * Der grobe Fortschritt eines Legacy-Zugs aus seinem Schritt (Betreiber 2026-10-10: „grob reicht, einfach ein fortschrittsbalken, der
 * abschätzen kann wieviel erledigt ist“): I1 bis I28 füllen 5 bis 80 %, der zweite Lauf (Idempotenzprobe) 80 bis 100 %. Aus dem
 * Schritt, nicht aus Datensätzen; die Schritte dauern verschieden lang. EINE Formel für den Knopf (`job.ts`) und den Zuruf
 * (`legacy-update-cli.ts`). Unbekannter Schritt: `null`.
 */
export function zugAnteil(schritt: string, zweiterLauf: boolean): number | null {
    const index = PIPELINE_STEPS.findIndex((step) => step.id === schritt);
    if (index < 0) return null;
    const share = index / PIPELINE_STEPS.length;
    return zweiterLauf ? 0.8 + share * 0.2 : 0.05 + share * 0.75;
}
export const ERGEBNIS_MARKE = "::abgleich-ergebnis ";

export interface AbgleichErgebnis {
    /** Was entfiel: Schritte (`I24`) oder Teile (`dateien`). */
    luecken: string[];
    /** Zahl der Befunde. */
    befunde: number;
    /** Der Satzname eines Zugs. */
    satz?: string | null;
}

export type Meldung = { art: "phase"; phase: string } | { art: "ergebnis"; ergebnis: AbgleichErgebnis };

const PHASE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/u;

export function phaseZeile(phase: string): string {
    if (!PHASE.test(phase)) throw new Error(`Phase ohne gültigen Namen: ${phase}`);
    return `${PHASE_MARKE}${phase}`;
}

export function ergebnisZeile(ergebnis: AbgleichErgebnis): string {
    return `${ERGEBNIS_MARKE}${JSON.stringify(ergebnis)}`;
}

/** Schreibt das Ergebnis, aber nur im Lauf mit `--auftrag`: Für den Zuruf bleibt die Ausgabe, wie sie war. */
export function meldeErgebnis(auftrag: string | null, ergebnis: AbgleichErgebnis): void {
    if (auftrag !== null) process.stdout.write(`${ergebnisZeile(ergebnis)}\n`);
}

/** Liest eine Zeile; `null` für alles, was keine Meldung ist (auch eine kaputte Meldung: sie geht dann nur ins Journal). */
export function leseMeldung(line: string): Meldung | null {
    if (line.startsWith(PHASE_MARKE)) {
        const phase = line.slice(PHASE_MARKE.length).trim();
        return PHASE.test(phase) ? { art: "phase", phase } : null;
    }
    if (line.startsWith(ERGEBNIS_MARKE)) {
        try {
            const raw = JSON.parse(line.slice(ERGEBNIS_MARKE.length)) as Record<string, unknown>;
            const luecken = Array.isArray(raw["luecken"])
                ? raw["luecken"].filter((entry): entry is string => typeof entry === "string").slice(0, 64)
                : [];
            const befunde = typeof raw["befunde"] === "number" && raw["befunde"] >= 0 ? Math.floor(raw["befunde"]) : 0;
            const satz = typeof raw["satz"] === "string" ? raw["satz"].slice(0, 120) : null;
            return { art: "ergebnis", ergebnis: { luecken, befunde, satz } };
        } catch {
            return null;
        }
    }
    return null;
}

/**
 * Die Schritte eines Zugs, die entfielen (eine Quelle nicht geholt, eine Antwort unbrauchbar, eine Migration fehlt). Der Zug schreibt
 * sie seit jeher mit „uebersprungen“ am Anfang oder „entfaellt“/„entfallen“ in der Zusammenfassung (`legacy-update-cli.ts`); das Lesen
 * steht hier an EINER Stelle, damit der Kreis (F2) eine Lücke nicht an einem anderen Wort festmacht als der Bericht.
 */
export function entfalleneSchritte(outcomes: readonly { id: string; label?: string; summary: string }[]): string[] {
    const gap = /^(uebersprungen|übersprungen)|entf(ae|ä)ll|entfallen/u;
    // Mit Namen („I24 Wiki-Linkziele“): Die Kennung allein sagt dem Betreiber nichts.
    const named = outcomes
        .filter((outcome) => gap.test(outcome.summary))
        .map((outcome) => (outcome.label === undefined ? outcome.id : `${outcome.id} ${outcome.label}`));
    return [...new Set(named)];
}
