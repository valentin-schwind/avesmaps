import { createFinding, formatShare, type Finding, type FindingObject } from "../findings.ts";

/**
 * Wie viel ein Lauf stilllegen darf, bevor er es MELDET (nicht: bevor er abbricht).
 *
 * 🔴 Betreiberentscheidung 2026-10-03: Die Stilllegequote hält keinen Import mehr an („genau wie die 5% max.
 * änderungen“, Betreiber im Chat der Koordination). Grenzwert und Berechnung bleiben; wird sie überschritten,
 * steht im Bericht ein Befund `stilllegequote` mit den Zahlen und allen betroffenen Objekten, und der Lauf
 * geht weiter. Früher (WI-0001) war sie ein Riegel gegen einen halben Abruf, der wie eine Massenlöschung aussieht.
 */
export const MAX_RETIRE_FRACTION = 0.05;

export interface RetirePressure {
    /** Aktive Zeilen der Tabelle im Bereich des Laufs. */
    active: number;
    /** Davon Zeilen, die der Satz nicht mehr nennt und die der Lauf deshalb stilllegt. */
    retiring: number;
}

/**
 * Der Befund `stilllegequote`, wenn der Lauf mehr als `MAX_RETIRE_FRACTION` seiner aktiven Zeilen stilllegt, sonst
 * nichts. `listObjects` wird nur im Befundfall aufgerufen: Es nennt Tabelle, öffentliche ID und Name der Zeilen,
 * die dieser Lauf stilllegt (dieselbe Auswahl wie das `UPDATE`, innerhalb derselben Transaktion).
 */
export async function retireFinding(
    table: string,
    pressure: RetirePressure | undefined,
    listObjects: () => Promise<FindingObject[]>,
): Promise<Finding | undefined> {
    const active = pressure?.active ?? 0;
    const retiring = pressure?.retiring ?? 0;
    if (active <= 0 || retiring / active <= MAX_RETIRE_FRACTION) {
        return undefined;
    }
    const share = retiring / active;
    return createFinding(
        "stilllegequote",
        `${table}: der Lauf legt ${String(retiring)} von ${String(active)} aktiven Zeilen still ` +
            `(${formatShare(share)}, Grenzwert ${formatShare(MAX_RETIRE_FRACTION)}); der Lauf geht weiter`,
        { table, active, retiring, share: Number(share.toFixed(4)), limit: MAX_RETIRE_FRACTION },
        await listObjects(),
        retiring,
    );
}
