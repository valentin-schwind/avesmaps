import { Type, type Static } from "@sinclair/typebox";
import { MEDIA_PUBLIC_URL_PATTERN } from "./media.ts";

/**
 * Der Lesepfad der Ortsliste (WI-0128 E4, EDIT-0001 §4.2, §6.2): EINE Liste für den Ortseditor, Legacys „Alle · Platziert · Fehlt“
 * (Mirror `cfbbe69c8`, `api/_internal/wiki/settlements.php:1488-1630`, `js/review/review-settlement-list.js`).
 *
 * - 🔴 Recht `use_editor_menu` (ab Reviewer), am Server über `protect`; ohne Recht 403 vor jeder Abfrage.
 * - **Drei Herkünfte:** `karte` (ein Ort mit Kartenpunkt), `wiki` (nur im Wiki, nicht platziert: eine Stätte aus
 *   `settlement_place` oder eine Wiki-Siedlung ohne Kartenpunkt), `ohne-lage` (ein eigener Ort ohne Kartenpunkt, etwa eine Stätte, die
 *   von der Karte genommen wurde; braucht die Migration von E8, `place.geom` ist NOT NULL). 🔴 „Fehlt“ hat **eine Zeile je Wiki-Artikel**
 *   (Betreiber 2026-10-10): die Wiki-Siedlungen ohne Kartenpunkt aus Legacys Export X3 (Betreiber 2026-10-10: A; Registry
 *   `wiki_settlement_registry`, Migration 0089, Schritt I28 von `legacy:update`), Zeilen `origin: "wiki"` mit `subtype` (Ortsklasse), `kind`
 *   (Bauwerksart), `region`, ohne Koordinaten; Stätten stehen wie in Legacys Liste nicht dort, sondern innerorts bei ihrer Siedlung (E18).
 *   Bei Bauwerken (platziert oder nicht) sagt `scope`, ob sie innerorts liegen oder unklar sind, und `within` in welcher Siedlung: Legacys
 *   Urteil über `standort` (`place-scope.php`), hier über Wiki-Keys gerechnet (`apps/server/src/editor/place-scope.ts`, Betreiber
 *   2026-10-11); ohne `scope` gilt außerorts. Bis zum ersten Zug mit X3 ist `wikiListe: false`:
 *   Dann stehen die Stätten ohne Kartenpunkt als Übergang in „Fehlt“, und die Oberfläche nennt für „Alle“ und „Fehlt“ keine Zahl (WI-0126
 *   §4.1: „Zahl für Alle und Fehlt erst mit der Wiki-Liste“).
 * - **Der Kreis** (Legacy `avesmapsStatuskreisOrt`, `js/ui/listen-statuskreis.js:83-90`): `leer` ○ nicht auf der Karte, `halb` ◐
 *   auf der Karte ohne Wiki-Artikel, `voll` ● auf der Karte und einem Artikel zugeordnet.
 * - **Kennungen** sind öffentliche: `key` ist die `public_id` eines Orts, `staette:<hash>` einer Stätte ohne Wiki-Liste (aus ihrer Identität
 *   Siedlung, Name, Punkt; 0078) und bei einer Wiki-Siedlung `wiki:…` = der kanonische Wiki-Key selbst, wie X1/X2 (`wiki:` + Slug,
 *   der Namensraum steckt im Slug: `wiki:gareth`, `wiki:inoffiziell-kleewiesen`; nie `wiki:wiki:…`).
 * - **Knapp:** Rund 5.000 Zeilen reisen auf einmal (gemessen 2026-10-10: 4.984 Orte). Was falsch, null oder leer ist, fehlt in der
 *   Zeile; `source` fehlt bei `legacy`. Der Server schickt die Liste gepackt (gzip), und der schwache ETag über den Inhalt macht
 *   jeden weiteren Abruf zu einem 304 ohne Körper, bis sich etwas ändert (später über `map_operation.seq`, E8).
 */

export const EDITOR_PLACES_URL = "/api/editor/places";

export const EDITOR_PLACE_ORIGINS = ["karte", "wiki", "ohne-lage"] as const;
export type EditorPlaceOrigin = (typeof EDITOR_PLACE_ORIGINS)[number];

export const EDITOR_PLACE_CIRCLES = ["leer", "halb", "voll"] as const;

/** Legacys Urteil über die Lage eines Bauwerks, soweit es nicht außerorts ist (`place-scope.php`: inside, ambiguous). */
export const EDITOR_PLACE_SCOPES = ["innerorts", "unklar"] as const;
export type EditorPlaceScope = (typeof EDITOR_PLACE_SCOPES)[number];
export type EditorPlaceCircle = (typeof EDITOR_PLACE_CIRCLES)[number];

/** Wie der Ort einem Wiki-Artikel zugeordnet ist (`place_wiki_assignment.assignment_state`, 0065), oder gar nicht. */
export const EDITOR_PLACE_ASSIGNMENTS = ["assigned", "address_only", "separated", "suppressed", "none"] as const;
export type EditorPlaceAssignment = (typeof EDITOR_PLACE_ASSIGNMENTS)[number];

const strict = { additionalProperties: false } as const;
const Union = <T extends string>(values: readonly T[]) => Type.Union(values.map((value) => Type.Literal(value)));
/** Ein Merkmal, das nur dasteht, wenn es zutrifft. */
const Flag = () => Type.Optional(Type.Literal(true));

export const EditorPlaceRow = Type.Object(
    {
        key: Type.String({ minLength: 1 }),
        origin: Union(EDITOR_PLACE_ORIGINS),
        name: Type.String(),
        circle: Union(EDITOR_PLACE_CIRCLES),
        assignment: Union(EDITOR_PLACE_ASSIGNMENTS),
        /** Die Ortsgröße (`place.subtype`: metropole … stadtviertel). */
        subtype: Type.Optional(Type.String()),
        /** Die Ortsart (`place.place_kind`: Festung, Kloster …), sonst der Gebäudetyp aus dem Wiki. */
        kind: Type.Optional(Type.String()),
        /** Der Artikel; ohne Titel bei einer bloßen Adresse. */
        wiki: Type.Optional(Type.Object({ url: Type.String(), title: Type.Optional(Type.String()) }, strict)),
        /** Die Lage aus dem Wiki (Region, sonst Staat), roh. */
        region: Type.Optional(Type.String()),
        /**
         * Die Siedlung, in der die Zeile liegt: bei einer Stätte wörtlich aus Legacys Export, bei einem Bauwerk aus dem Urteil `scope`
         * (der Titel des Artikels der Siedlung, sonst der größte Ort, dem ihr Key zugewiesen ist).
         */
        within: Type.Optional(Type.String()),
        /** Bei einem Bauwerk Legacys Urteil über `standort`: innerorts oder unklar; fehlt bei außerorts und wo es nicht gilt. */
        scope: Type.Optional(Union(EDITOR_PLACE_SCOPES)),
        /** Kartenkoordinaten (MCS `aventuria-v1`); fehlen ohne Kartenpunkt. */
        x: Type.Optional(Type.Number()),
        y: Type.Optional(Type.Number()),
        hidden: Flag(),
        ruined: Flag(),
        nodix: Flag(),
        hasCoat: Flag(),
        /** Das Wappen links in der Zeile (E19): die veröffentlichte Fassung; fehlt ohne gerenderte Fassung. */
        coat: Type.Optional(Type.String({ pattern: MEDIA_PUBLIC_URL_PATTERN })),
        /** Zahl der Titelbilder, ab 1. */
        imageCount: Type.Optional(Type.Integer({ minimum: 1 })),
        /** Woher der Ort stammt, wenn nicht aus Legacy (`place.source_system`). */
        source: Type.Optional(Type.String()),
    },
    strict,
);
export type EditorPlaceRow = Static<typeof EditorPlaceRow>;

export const EditorPlaceList = Type.Object(
    {
        /** Die Liste ist vollständig nur mit der Wiki-Liste; ohne sie fehlen in „Fehlt“ die Wiki-Siedlungen ohne Kartenpunkt. */
        wikiListe: Type.Boolean(),
        rows: Type.Array(EditorPlaceRow),
    },
    strict,
);
export type EditorPlaceList = Static<typeof EditorPlaceList>;

/**
 * Die Ortsarten zur Wahl im Feld „Art“ (WI-0295; Legacys Liste „Ortsarten aus dem Wiki“, `api/app/place-kinds.php` und
 * `js/ui/place-kind-autocomplete.js`, Mirror 96dda99b4): der Katalog der Bauwerks- und Siedlungsarten des Wiki ohne Ruine (ein Merkmal),
 * ohne „Bauwerk“ (sagt nichts) und ohne lineare Anlagen, alphabetisch. `count` ist die Zahl der Zeilen der Ortsliste mit dieser Art
 * (auf der Karte und nur im Wiki), eine Auskunft, wie gebräuchlich sie ist; 0 heißt „noch nie benutzt“. Recht `use_editor_menu`.
 */
export const EDITOR_PLACE_KINDS_URL = `${EDITOR_PLACES_URL}/kinds`;

export const EditorPlaceKind = Type.Object(
    {
        kind: Type.String({ minLength: 1 }),
        count: Type.Integer({ minimum: 0 }),
    },
    strict,
);
export type EditorPlaceKind = Static<typeof EditorPlaceKind>;

export const EditorPlaceKindList = Type.Object({ kinds: Type.Array(EditorPlaceKind) }, strict);
export type EditorPlaceKindList = Static<typeof EditorPlaceKindList>;

/**
 * Der Kreis einer Zeile (Legacy `avesmapsStatuskreisOrt`): nicht auf der Karte ○, sonst ● mit Artikel, ◐ ohne. Eine Zuordnung nur
 * mit Adresse (`address_only`) hat keinen Artikel im Nest und zählt wie keine.
 */
export function editorPlaceCircle(onMap: boolean, assignment: EditorPlaceAssignment): EditorPlaceCircle {
    if (!onMap) return "leer";
    return assignment === "assigned" ? "voll" : "halb";
}

/** Die `public_id` des Orts einer Zeile; was nur im Wiki steht (Stätte, Wiki-Siedlung), hat keinen. */
export const editorPlacePublicId = (row: Pick<EditorPlaceRow, "key" | "origin">): string | undefined =>
    row.origin === "wiki" ? undefined : row.key;

/** Die Vorsilbe der Schlüssel von Stätten (`staette:<hash>`). */
export const EDITOR_STAETTE_KEY_PREFIX = "staette:";
