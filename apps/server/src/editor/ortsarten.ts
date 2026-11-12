import type { EditorPlaceKindList, EditorPlaceRow } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { istAusgeschlossenerBauwerkTyp } from "../wiki/kategorien/auswerten.ts";
import { BAUWERK_ARTEN_LEGACY } from "../wiki/kategorien/bauwerkarten.ts";
import { BAUWERK_AUSGESCHLOSSEN } from "../wiki/kategorien/konstanten.ts";
import { listEditorPlaces } from "./places.ts";

/**
 * Die Ortsarten zur Wahl im Feld „Art“ (WI-0295; Discord 2026-11-09: „Burg/Festung und Gut/Gutshof seh ich nimmie“). Legacys Ortseditor
 * schlug unter „Art“ die „Ortsarten aus dem Wiki“ vor (`api/app/place-kinds.php`, `js/ui/place-kind-autocomplete.js`, Mirror 96dda99b4); unser
 * Feld war bis hierher ein leeres Textfeld, und seit dem Cutoff am 02.11. arbeiten die Editoren nur noch hier.
 *
 * - **Katalog:** dieselbe Liste wie die Bauwerkart des WikiSync (`BAUWERK_ARTEN_LEGACY`, EINE Quelle), ohne die Namen, die Legacy dem Editor nicht
 *   anbot: „Ruine“ (ein Merkmal am Ort, sonst gäbe es „Festung“ und „Festung + Ruine“ doppelt), „Bauwerk“ (sagt nichts, gleich „leer lassen“) und die
 *   linearen Anlagen (Mauer, Damm, Deich, Kanalisation, Äquadukt: Wege, keine Punkte). Gewählt wird nach dem Alphabet, nicht nach der Reihenfolge des
 *   Katalogs, die nur der WikiSync braucht (Legacy Fall #64: „alphabetisch, damit man zu einem Buchstaben blättern kann“).
 * - **Zahl:** wie oft die Art in der Ortsliste steht (auf der Karte und nur im Wiki), also dieselbe Zahl, die der Art-Filter der Liste nennt. Legacy
 *   zählte ebenso Wiki-Seiten und Kartenpunkte zusammen. 0 heißt „noch nie benutzt“; die Oberfläche zeigt dann „—“.
 * - Eine Art, die nicht im Katalog steht, darf der Editor weiter frei eintragen; hier wird nichts gesperrt.
 */

/** Die Namen des Katalogs, die der Editor nicht angeboten bekommt (Legacy `AVESMAPS_PLACE_KIND_HIDDEN`). */
export const ORTSARTEN_VERBORGEN: ReadonlySet<string> = new Set(["Ruine", "Bauwerk"]);

const SORTIERUNG = new Intl.Collator("de", { sensitivity: "base", numeric: true });

/** Die wählbaren Arten, alphabetisch. */
export function waehlbareOrtsarten(): string[] {
    return BAUWERK_ARTEN_LEGACY.filter(
        (art) => !ORTSARTEN_VERBORGEN.has(art) && !istAusgeschlossenerBauwerkTyp(art, BAUWERK_AUSGESCHLOSSEN),
    ).sort((a, b) => SORTIERUNG.compare(a, b));
}

/** Die wählbaren Arten mit der Zahl der Zeilen, die sie tragen (Gleichheit genau, wie der Art-Filter der Ortsliste zählt). */
export function ortsartenMitZahl(zeilen: readonly Pick<EditorPlaceRow, "kind">[]): EditorPlaceKindList {
    const zahl = new Map<string, number>();
    for (const zeile of zeilen) {
        const art = zeile.kind?.trim();
        if (art) zahl.set(art, (zahl.get(art) ?? 0) + 1);
    }
    return { kinds: waehlbareOrtsarten().map((kind) => ({ kind, count: zahl.get(kind) ?? 0 })) };
}

/** Die Liste für `GET /api/editor/places/kinds`: gezählt über dieselben Zeilen wie die Ortsliste. */
export async function listEditorPlaceKinds(database: Queryable): Promise<EditorPlaceKindList> {
    const liste = await listEditorPlaces(database);
    return ortsartenMitZahl(liste.rows);
}
