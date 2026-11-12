import { Type, type Static } from "@sinclair/typebox";
import { OperationId } from "./operation.ts";

/**
 * „Ort entfernen“ (WI-0128 E22; Betreiber 2026-10-12: „ort-entfernen-konzept ist prima, genau das wollte ich“, Blatt
 * `review/wi-0128/ort-entfernen-blatt.png`): EIN Knopf, EIN Blatt für alle Fälle. Das Blatt fragt, was mit dem Ort geschieht, bei Stätten,
 * was mit ihnen geschieht, und zeigt die Folgen.
 *
 *     GET  /api/editor/places/:id/removal        was das Entfernen trifft                                  use_editor_menu
 *     POST /api/editor/places/:id/take-off-map   place.take_off_map („Von der Karte nehmen“)               edit_map_geometry
 *     POST /api/editor/places/:id/delete         place.delete („Ganz löschen“, weich)                      edit_map_objects
 *     POST /api/editor/places/:id/restore        place.restore (↺ eines place.delete unter „Änderungen“)   edit_map_objects
 *
 * - **Eine Kraftlinie am Ort sperrt** jedes Entfernen (EDIT-0001 D20, wie Legacy): erst die Kraftlinie lösen.
 * - **Wegenden bleiben liegen** (G1): Sie stehen danach als offene Wegenden unter „Prüfen“.
 * - **Ganz löschen ist weich**: Die Zeile bleibt stillgelegt mit allem, was an ihr hängt (Wiki-Zuordnung, Bilder, Quellen), und kommt mit
 *   ↺ zurück. Der Wiki-Artikel steht derweil wieder unter „Nicht auf der Karte“.
 * - 🔴 Was die feste Bindung der Stätten an den Ort braucht, kommt mit E18 (`settlement_place.place_id`): Stätten umhängen oder
 *   eigenständig machen, Stätte eines anderen Orts werden, eine Stadt samt Stätten löschen, einen innerorts-Punkt entfernen. Bis dahin
 *   sperrt das Blatt diese Wahlen mit Grund, und der Server lehnt sie ab.
 */

export const editorPlaceRemovalUrl = (publicId: string): string => `/api/editor/places/${publicId}/removal`;
export const editorPlaceDeleteUrl = (publicId: string): string => `/api/editor/places/${publicId}/delete`;
export const editorPlaceRestoreUrl = (publicId: string): string => `/api/editor/places/${publicId}/restore`;

const strict = { additionalProperties: false } as const;

/** Was mit dem Ort geschieht (Abschnitt „Der Ort“, eine Wahl, Pflicht). */
export const PLACE_REMOVAL_WAYS = ["abnehmen", "staette", "loeschen"] as const;
export type PlaceRemovalWay = (typeof PLACE_REMOVAL_WAYS)[number];

/** Was mit seinen Stätten geschieht (Abschnitt „Innerorts“, vorbelegt `bleiben`; bei „Ganz löschen“ heißt das „Mitlöschen“). */
export const STAETTEN_WAYS = ["bleiben", "anderer", "eigenstaendig"] as const;
export type StaettenWay = (typeof STAETTEN_WAYS)[number];

export const PlaceRemovalStaette = Type.Object({ name: Type.String(), art: Type.Optional(Type.String()) }, strict);
export type PlaceRemovalStaette = Static<typeof PlaceRemovalStaette>;

export const PlaceRemovalGebiet = Type.Object(
    { name: Type.String(), rolle: Type.Union([Type.Literal("hauptstadt"), Type.Literal("sitz")]) },
    strict,
);
export type PlaceRemovalGebiet = Static<typeof PlaceRemovalGebiet>;

/** Eine Kraftlinie, die am Ort endet; `gegenueber` ist der Ort am anderen Ende, wenn es ihn gibt. */
export const PlaceRemovalKraftlinie = Type.Object(
    { name: Type.String(), gegenueber: Type.Optional(Type.String()) },
    strict,
);
export type PlaceRemovalKraftlinie = Static<typeof PlaceRemovalKraftlinie>;

/** Was am Ort hängen bleibt (beim Löschen stillgelegt mit ihm, beim Abnehmen weiter da). */
export const PlaceRemovalBleibt = Type.Object(
    {
        wiki: Type.Boolean(),
        bilder: Type.Integer({ minimum: 0 }),
        quellen: Type.Integer({ minimum: 0 }),
        stadtplaene: Type.Integer({ minimum: 0 }),
        abenteuer: Type.Integer({ minimum: 0 }),
        bewertungen: Type.Integer({ minimum: 0 }),
    },
    strict,
);
export type PlaceRemovalBleibt = Static<typeof PlaceRemovalBleibt>;

export const PlaceRemoval = Type.Object(
    {
        publicId: Type.String(),
        name: Type.String(),
        revision: Type.Integer({ minimum: 1 }),
        /** Der Ort hat einen Kartenpunkt; ohne steht er schon unter „Nicht auf der Karte“ (dann gibt es nur „Ganz löschen“). */
        onMap: Type.Boolean(),
        /** Die Ortsgröße (`place.subtype`): Der Flug neben das Blatt wählt danach den Zoom. */
        subtype: Type.String(),
        /** Der Kartenpunkt, wenn er einen hat: Die Kamera legt ihn neben das Blatt. */
        position: Type.Optional(Type.Object({ x: Type.Number(), y: Type.Number() }, strict)),
        staetten: Type.Array(PlaceRemovalStaette),
        /** Der Ort ist selbst ein innerorts-Punkt dieser Stadt (eine Stätte mit Kartenpunkt). */
        innerortsVon: Type.Optional(Type.String()),
        /** Die Namen der Wege, deren Ende am Ort liegt (je Ende einer). */
        wegenden: Type.Array(Type.String()),
        gebiete: Type.Array(PlaceRemovalGebiet),
        kraftlinien: Type.Array(PlaceRemovalKraftlinie),
        bleibt: PlaceRemovalBleibt,
    },
    strict,
);
export type PlaceRemoval = Static<typeof PlaceRemoval>;

/** `place.delete`: „Ganz löschen“, weich; die Zeile bleibt stillgelegt und kommt mit `place.restore` zurück. */
export const PlaceDeleteBody = Type.Object(
    { operationId: OperationId, baseRevision: Type.Integer({ minimum: 1 }) },
    strict,
);
export type PlaceDeleteBody = Static<typeof PlaceDeleteBody>;

/** `place.restore`: nimmt ein `place.delete` zurück (↺ unter „Änderungen“), solange der Ort seitdem unverändert gelöscht ist. */
export const PlaceRestoreBody = Type.Object({ operationId: OperationId, reverts: OperationId }, strict);
export type PlaceRestoreBody = Static<typeof PlaceRestoreBody>;
