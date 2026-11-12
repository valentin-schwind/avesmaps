import { WETTER_SYMBOL_TYPEN, type SubjectDetail, type SubjectFact, type WetterSymbolTyp } from "@avesmaps3d/shared";
import { t, type MessageKey } from "../i18n/i18n";
import { headerGraphicOf } from "./header-graphic";
import { wetterSymbolActions } from "./panel-action-model";
import { wikiOf } from "./panel-header";
import type { PanelEnv, PanelModel, RowModel } from "./panel-types";
import type { ShownSubject } from "./subject-selection";
import { lizenzTeile } from "./vorkommen-sammel";

/**
 * Das Infopanel eines Wetter-Icons mit Wiki-Verweis (WI-0288; Betreiber 2026-11-08: „ja infopanel bauen“), gebaut aus der Detailantwort
 * (`apps/server/src/subjects/detail-wetter.ts`) in das Modell, das jedes Subject zeichnet, im Muster der Sprache (`sprache-model.ts`):
 *
 * - **Kopf:** das Typbild seines Typs (Wind, Wirbelsturm, Meeresströmung oder Mahlstrom), der Name, darunter die Art.
 * - **Band:** Anzeigen (die Kamera fliegt auf das Icon und seine Reichweite) und Link teilen (`?wetter=<Kennung>`).
 * - **Feldtafel:** Region und Beschreibung, was der Wiki-Stand des Artikels kennt; darunter die Herkunft des Texts samt Lizenz wie bei den Vorkommen (`lizenzTeile`).
 * - **Quellenkasten:** die Wikizeile des Artikels. Weitere Quellen hat ein Icon nicht; es gibt keinen leeren Kasten.
 *
 * 🔴 Tolerant gelesen: Ein unbekannter Typ (ein neuerer Server) zeigt das allgemeine Bild und keine Art, ein unbekanntes Feld fällt weg.
 */

const istTyp = (wert: string | undefined): wert is WetterSymbolTyp =>
    wert !== undefined && (WETTER_SYMBOL_TYPEN as readonly string[]).includes(wert);

/** Die Felder der Tafel in ihrer Reihenfolge und ihre Beschriftung. */
const FELDER: readonly { field: SubjectFact["field"]; label: MessageKey }[] = [
    { field: "regionParent", label: "wetterSymbol.feld.region" },
    { field: "description", label: "infoPanel.field.description" },
];

/** Die Zeilen der Feldtafel: nur Textfelder mit Inhalt, in der Reihenfolge der Tafel (WI-0063 5.3: Leeres steht nicht da). */
export function wetterSymbolZeilen(facts: readonly SubjectFact[] | undefined): RowModel[] {
    const zeilen: RowModel[] = [];
    for (const { field, label } of FELDER) {
        const fact = (facts ?? []).find((eins) => eins.field === field);
        if (fact === undefined || !("value" in fact) || fact.value.trim() === "") continue;
        zeilen.push({ key: `${field}:0`, label: t(label), value: { kind: "text", text: fact.value } });
    }
    return zeilen;
}

/** Das Wort der Art („Wind“, „Wirbel“, „Meeresströmung“, „Mahlstrom“); leer bei einem unbekannten Typ. */
export function wetterSymbolArtWort(typ: string | undefined): string {
    return istTyp(typ) ? t(`wetterSymbol.art.${typ}`) : "";
}

export function wetterSymbolModel(shown: ShownSubject, detail: SubjectDetail, env: PanelEnv): PanelModel {
    const part = detail.subtitle?.find((eins) => eins.part === "type");
    const typ = part?.part === "type" ? part.key : undefined;
    const art = wetterSymbolArtWort(typ);
    const rows = wetterSymbolZeilen(detail.facts);
    const wiki = wikiOf(detail);
    // Die Herkunft samt Lizenz nur, wo ein Wiki-Text dasteht (wie in der Infobox einer Sprache).
    const mitText = rows.some((row) => row.key.startsWith("description:"));
    return {
        header: {
            title: detail.title ?? shown.title ?? t("infoPanel.untitled"),
            subtitle: art === "" ? [] : [{ parts: [{ text: art }] }],
            graphic: headerGraphicOf("wetterSymbol", istTyp(typ) ? typ : undefined),
            images: [],
        },
        actions: wetterSymbolActions(detail, env),
        rows,
        ...(mitText && detail.wiki !== undefined ? { lizenz: [lizenzTeile({ wiki: detail.wiki })] } : {}),
        ...(wiki === undefined ? {} : { wiki }),
        catalogs: [],
    };
}
