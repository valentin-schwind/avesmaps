import type { MapHistoryEntry } from "@avesmaps3d/shared";
import { redaktion } from "../community/redaktion";
import { t } from "../i18n/i18n";

/**
 * Die Herkunft einer Operation aus einem Community-Vorgang in „Änderungen“ (WI-0265 B6g1; Server: WI-0268 C7, `map_operation.community_vorgang`): eine gedämpfte Zeile „aus COM-000123“.
 *
 * - **Text oder Link:** Die Zeile ist ein Link, wenn die Sitzung `moderate_submissions` hat (dasselbe Recht, das den Reiter „Community › Meldungen“ öffnet); der Klick öffnet den Vorgang
 *   (`redaktion.oeffneMeldung`). Ohne das Recht, oder wenn die Seite keine Redaktion hat (`oeffneMeldung` gibt `false` zurück), bleibt sie Text: Nichts verspricht einen Weg, den es nicht gibt.
 * - **Wo:** Das Detail trägt die Zeile mit dem Link; die Zeile der Liste ist ein Knopf, darin steht die Nummer nur als Text (kein Knopf im Knopf).
 */

/** Das Recht, das den Vorgang in der Redaktion öffnet. */
export const HERKUNFT_RECHT = "moderate_submissions";

export interface Herkunft {
    /** Die Nummer des Vorgangs, etwa `COM-000123`. */
    readonly nummer: string;
    /** „aus COM-000123“ in der Sprache der Oberfläche. */
    readonly text: string;
    /** Die Sitzung darf den Vorgang öffnen (sonst bleibt es Text). */
    readonly link: boolean;
    /** Der Hinweis am Link („Vorgang COM-000123 in der Redaktion öffnen“); nur mit `link`. */
    readonly titel: string | undefined;
}

/**
 * Die Herkunft eines Eintrags; `undefined`, wenn er aus keinem Vorgang stammt. `verbunden` sagt, ob die Seite eine Redaktion hat (`redaktion.verbunden`); ohne sie öffnet nichts und die Zeile
 * bleibt Text.
 */
export function herkunftVon(
    eintrag: Pick<MapHistoryEntry, "communityVorgang">,
    rechte: readonly string[],
    verbunden = true,
): Herkunft | undefined {
    const nummer = eintrag.communityVorgang;
    if (nummer === undefined || nummer === "") return undefined;
    const link = verbunden && rechte.includes(HERKUNFT_RECHT);
    return {
        nummer,
        text: t("aenderungen.herkunft", { nummer }),
        link,
        titel: link ? t("aenderungen.herkunft.oeffnen", { nummer }) : undefined,
    };
}

/** Öffnet den Vorgang in der Redaktion; `false`, wenn die Seite keine hat. */
export const oeffneHerkunft = (
    nummer: string,
    oeffne: (nummer: string) => boolean = (eine) => redaktion.oeffneMeldung(eine),
): boolean => oeffne(nummer);
