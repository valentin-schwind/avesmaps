import { GRUENDE_BESUCHER } from "./gruende-besucher.ts";
import { GRUENDE_REDAKTION } from "./gruende-redaktion.ts";

/**
 * Der Fachcode zu einem Satz der Datenbankfunktionen (SQLSTATE `KC…`, `communityFehler`). Die Funktionen sagen nur einen deutschen Satz; das Fenster braucht einen Code, um in seiner
 * Sprache zu sagen, was zu tun ist (WI-0291, Vali 2026-11-08). Die Sätze stehen in den Migrationen; ein Muster hier trifft den Satz ohne den Präfix `community_…:`.
 *
 * - Zwei Tafeln, eine je Bereich: was Besucher erreichen (`gruende-besucher.ts`) und was die Redaktion erreicht (`gruende-redaktion.ts`).
 * - Ein Satz ohne Muster bleibt ohne Code: Das Fenster zeigt dann den Satz selbst (Rückfall von `genauerGrund`), nie einen Sammelsatz.
 * - Ein Muster darf nur EINEN Satz treffen; `community-gruende-besucher.test.ts` und `community-gruende-redaktion.test.ts` halten das gegen die Sätze der Migrationen fest.
 */
export interface DatenbankGrund {
    readonly muster: RegExp;
    readonly reason: string;
}

export const GRUENDE_DER_DATENBANK: readonly DatenbankGrund[] = [...GRUENDE_BESUCHER, ...GRUENDE_REDAKTION];

/** Der Fachcode zu einem Satz (ohne Präfix), oder `undefined`. */
export function grundZumSatz(satz: string): string | undefined {
    return GRUENDE_DER_DATENBANK.find((grund) => grund.muster.test(satz))?.reason;
}
