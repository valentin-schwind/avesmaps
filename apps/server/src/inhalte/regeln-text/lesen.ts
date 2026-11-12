import {
    INHALTE_REGELTEXT_ZEILEN_MAX,
    type InhalteRegelTextAlsText,
    type InhalteRegelTextErgebnis,
    type InhalteRegelTextPruefenBody,
} from "@avesmaps3d/shared";
import type { Database } from "../../database.ts";
import { fehlerbild } from "../vorkommen-regeln-schreiben.ts";
import { pruefeText } from "./ergebnis.ts";
import { ladeWelt } from "./laden.ts";
import { schreibeRegelBlock } from "./schreibe.ts";

/**
 * Die zwei lesenden Wege von „Regeln als Text“ (WI-0254 §13 und §14): das Prüfen eines Texts und der Rückweg „Als Text“ für die Regeln eines Eintrags. Beide schreiben nichts; die Welt wird bei jeder Anfrage neu geladen,
 * in EINER lesenden Transaktion (`repeatable read`), damit alle Tafeln denselben Stand haben.
 */

const LESEND = "isolation level repeatable read read only";

/** Höchstens so viele Zeilen je Text (die Zeichen prüft das Schema): ein Stapel aus einem Buch; mehr ist ein 400. */
export function begrenzeText(text: string): void {
    // Die Zeilen zählen, ohne den Text zu zerlegen: Ein Text voller Zeilenumbrüche soll nichts kosten, bevor er abgelehnt ist.
    let zeilen = 1;
    for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) {
        zeilen += 1;
        if (zeilen > INHALTE_REGELTEXT_ZEILEN_MAX) {
            throw fehlerbild(
                "text",
                "size",
                `Der Text hat mehr als ${String(INHALTE_REGELTEXT_ZEILEN_MAX)} Zeilen; bitte in Teilen prüfen.`,
            );
        }
    }
}

/** Den Text lesen und gegen den Katalog auflösen; nur lesend. */
export async function pruefeRegelText(
    database: Database,
    body: InhalteRegelTextPruefenBody,
): Promise<InhalteRegelTextErgebnis> {
    begrenzeText(body.text);
    const welt = await database.begin(LESEND, (tx) => ladeWelt(tx));
    return pruefeText(body.text, welt).ergebnis;
}

/** Die aktiven Regeln eines Eintrags in der Kurzschrift; `undefined`, wo es den Eintrag nicht gibt. */
export async function leseRegelTextAlsText(
    database: Database,
    publicId: string,
): Promise<InhalteRegelTextAlsText | undefined> {
    const welt = await database.begin(LESEND, (tx) => ladeWelt(tx, { nurEintrag: publicId }));
    const eintrag = welt.eintragNachId.get(publicId);
    if (eintrag === undefined) return undefined;
    return { text: schreibeRegelBlock(eintrag, welt.regelnVon(publicId), welt) };
}
