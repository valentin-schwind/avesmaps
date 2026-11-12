import { Type, type Static } from "@sinclair/typebox";
import { EDITOR_PLACES_URL } from "./editor-places.ts";
import { OperationId, UUID_PATTERN } from "./operation.ts";

/**
 * Die Mehrfachauswahl der Ortsliste (WI-0237, EDIT-0003 T57; Betreiber 2026-10-19: „gemeinsame operationen bleiben auswählbar (z.b.
 * entfernen)“): Was für mehrere Orte zugleich geht, schreibt EINE Operation.
 *
 *     POST /api/editor/places/sammel          place.sammel  (↺ auf Wiki-Werte für alle gewählten)      edit_map_objects
 *     POST /api/editor/places/sammel/delete   place.delete  („Ganz löschen“ für alle gewählten, weich)  edit_map_objects
 *
 * - Gemeinsam sind bei den Orten zunächst nur „Entfernen …“ (Ganz löschen) und ↺ auf Wiki-Werte (T57, Vorschlag der Orchestrierung:
 *   „Orte und Kraftlinien zunächst nur „Entfernen …“ und ↺“). Alles andere geht nur einzeln.
 * - 🔴 Das Löschen mehrerer heißt im Protokoll weiter `place.delete`, mit einem Eintrag je Ort: So holt `place.restore` (↺ unter
 *   „Änderungen“) jeden Ort einzeln zurück, denn es sucht den Ort in der Operation über ihren Namen und die Kennung des Orts.
 * - Je Ort gelten dieselben Regeln wie einzeln: Revision (409 `edit_conflict`), eine Kraftlinie am Ort und ein innerorts-Punkt sperren
 *   (400, mit dem Namen des Orts), Stätten gehen umkehrbar mit, Wegenden bleiben liegen. Dazu sperrt, wenn ein anderer einen der Orte
 *   gerade bearbeitet (409 `object_locked`).
 */

/** Höchstens so viele Orte schreibt eine Operation; die Oberfläche sperrt darüber mit Grund. */
export const PLACE_SAMMEL_MAX = 200;

export const EDITOR_PLACES_SAMMEL_URL = `${EDITOR_PLACES_URL}/sammel`;
export const EDITOR_PLACES_SAMMEL_DELETE_URL = `${EDITOR_PLACES_URL}/sammel/delete`;

/** Die Wiki-Felder eines Orts, die ↺ auf den Wiki-Wert setzt (wie einzeln im Ortseditor). */
export const PLACE_WIKI_FIELDS = ["name", "subtype", "einwohner", "oberhaupt", "lage", "description"] as const;
export type PlaceWikiField = (typeof PLACE_WIKI_FIELDS)[number];

const strict = { additionalProperties: false } as const;

/** Ein gewählter Ort mit der Revision, die die Oberfläche gelesen hat. */
export const PlaceSammelOrt = Type.Object(
    { id: Type.String({ pattern: UUID_PATTERN }), baseRevision: Type.Integer({ minimum: 1 }) },
    strict,
);
export type PlaceSammelOrt = Static<typeof PlaceSammelOrt>;

const Orte = Type.Array(PlaceSammelOrt, { minItems: 1, maxItems: PLACE_SAMMEL_MAX });

/** `place.sammel`: die genannten Wiki-Felder an allen gewählten Orten auf den Wiki-Wert. */
export const PlaceSammelBody = Type.Object(
    {
        operationId: OperationId,
        orte: Orte,
        wiki: Type.Array(Type.Union(PLACE_WIKI_FIELDS.map((feld) => Type.Literal(feld))), {
            minItems: 1,
            uniqueItems: true,
        }),
    },
    strict,
);
export type PlaceSammelBody = Static<typeof PlaceSammelBody>;

/** `place.delete` für mehrere: alle gewählten Orte „Ganz löschen“, weich, ein Eintrag je Ort. */
export const PlaceDeleteManyBody = Type.Object({ operationId: OperationId, orte: Orte }, strict);
export type PlaceDeleteManyBody = Static<typeof PlaceDeleteManyBody>;
