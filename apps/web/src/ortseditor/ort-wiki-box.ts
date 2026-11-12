import { EDITOR_PLACE_TEXT_FIELDS, type EditorPlaceDetail, type EditorPlaceTextField } from "@avesmaps3d/shared";
import type { WikiBoxFeld } from "../fenster/wiki-box";
import { groesseZeile, nameZeile, wikiZeile, type Entwurf } from "./entwurf";

/**
 * Die Felder des Orts für die Wiki-Box (WI-0253): Name, Ortsgröße, Einwohner, Oberhaupt, Lage und Beschreibung, je mit der Zeile des Wiki-Felds (`entwurf.ts`, dieselbe Rechnung wie das Formular) und
 * dem Vermerk, ob der Wert dem Wiki folgt. Die Box rechnet daraus „Das Wiki ist neuer“, „n von m Feldern folgen dem Wiki“ und die Zeilen „vorher → nachher“. Reine Rechnung ohne Vue und ohne Texte.
 *
 * `plan` nennt die Felder des Servers (`settlement_class` heißt in der Oberfläche Ortsgröße), damit „Übernommen: …“ die Namen des Fensters zeigt.
 */
export function ortWikiBoxFelder(
    detail: EditorPlaceDetail,
    entwurf: Entwurf,
    namen: Readonly<Record<"name" | "subtype" | EditorPlaceTextField, string>>,
    beschrifteGroesse: (schluessel: string) => string,
): WikiBoxFeld[] {
    const text = (feld: EditorPlaceTextField): WikiBoxFeld => ({
        id: feld,
        plan: [feld],
        name: namen[feld],
        lage: wikiZeile(detail, entwurf, feld),
        folgt: entwurf.texte[feld].wiki,
        eigen: entwurf.texte[feld].wert,
        mehrzeilig: feld === "description",
    });
    return [
        {
            id: "name",
            plan: ["name"],
            name: namen.name,
            lage: nameZeile(detail, entwurf),
            folgt: entwurf.nameWiki === true,
            eigen: entwurf.name,
        },
        {
            id: "subtype",
            plan: ["settlement_class"],
            name: namen.subtype,
            lage: groesseZeile(detail, entwurf, beschrifteGroesse),
            folgt: entwurf.subtypeWiki === true,
            eigen: beschrifteGroesse(entwurf.subtype),
        },
        ...EDITOR_PLACE_TEXT_FIELDS.map(text),
    ];
}
