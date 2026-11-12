import { SOURCE_REFERENCE_KINDS, type MapHistoryEntry } from "@avesmaps3d/shared";
import { t, type MessageKey } from "../i18n/i18n";
import { wikiKlartext } from "../inhalte/wiki-klartext";
import {
    feldWechsel,
    quellenZeilen,
    type Kennungen,
    type QuellenFeldWechsel,
    type QuellenZeile,
} from "./quellen-verlauf-modell";

/**
 * Die Zeilen der Quellen im Verlauf als Text (WI-0254 §12): „Quelle „Titel“ angehängt“, „… geändert: Seiten 12 → 14“, „… gelöst“, „… zurückgeholt“. Die Rechnung steht in `quellen-verlauf-modell.ts`.
 * Eine Notiz steht als Text statt der Vorlagen des Wikis und gekürzt; ein leerer Wert ist „–“.
 */

const WECHSEL_TEXTE: Readonly<Record<QuellenZeile["wechsel"], MessageKey>> = {
    angehaengt: "fenster.traegerQuellen.verlauf.angehaengt",
    geloest: "fenster.traegerQuellen.verlauf.geloest",
    zurueckgeholt: "fenster.traegerQuellen.verlauf.zurueckgeholt",
    geaendert: "fenster.traegerQuellen.verlauf.geaendert",
};

const FELD_NAMEN: Readonly<Record<QuellenFeldWechsel["feld"], MessageKey>> = {
    seiten: "fenster.traegerQuellen.verlauf.feld.seiten",
    art: "fenster.traegerQuellen.verlauf.feld.art",
    notiz: "fenster.traegerQuellen.verlauf.feld.notiz",
};

const ART_NAMEN: Readonly<Record<(typeof SOURCE_REFERENCE_KINDS)[number], MessageKey>> = {
    ausfuehrlich: "inhalte.bezug.ausfuehrlich",
    ergaenzend: "inhalte.bezug.ergaenzend",
    erwaehnung: "inhalte.bezug.erwaehnung",
};

/** Wie lang ein Wert im Text höchstens wird, bevor „…“ ihn kürzt. */
const KURZ = 60;

function wertText(wechsel: QuellenFeldWechsel, wert: string | null): string {
    if (wert === null) return "–";
    if (wechsel.feld === "art") {
        const art = SOURCE_REFERENCE_KINDS.find((eins) => eins === wert);
        return art === undefined ? wert : t(ART_NAMEN[art]);
    }
    const text = wechsel.feld === "notiz" ? wikiKlartext(wert) : wert;
    if (text === "") return "–";
    return text.length > KURZ ? `${text.slice(0, KURZ - 1)}…` : text;
}

/** Die Wechsel der Angaben als Text: „Seiten 12 → 14; Art Ausführlich → Ergänzend“. */
export const aenderungenText = (zeile: QuellenZeile): string =>
    feldWechsel(zeile.vorher, zeile.nachher)
        .map((w) =>
            t("fenster.traegerQuellen.verlauf.wechsel", {
                feld: t(FELD_NAMEN[w.feld]),
                vorher: wertText(w, w.vorher),
                nachher: wertText(w, w.nachher),
            }),
        )
        .join("; ");

/** Die Zeile als Satz. */
export function zeilenText(zeile: QuellenZeile): string {
    return t(WECHSEL_TEXTE[zeile.wechsel], {
        titel: zeile.titel === "" ? t("inhalte.verwendung.ohneName") : zeile.titel,
        aenderungen: aenderungenText(zeile),
    });
}

/**
 * Die Überschrift eines Eintrags, der aus GENAU EINER Änderung an Quellen besteht („Quelle „Titel“ angehängt“); sonst `undefined` (dann gilt die Zusammenfassung des Eintrags, und die Zeilen stehen darunter).
 */
export function kopfText(eintrag: MapHistoryEntry, traegerId: Kennungen | undefined): string | undefined {
    const zeilen = quellenZeilen(eintrag, traegerId);
    const einzige = zeilen[0];
    return zeilen.length === 1 && einzige !== undefined ? zeilenText(einzige) : undefined;
}
