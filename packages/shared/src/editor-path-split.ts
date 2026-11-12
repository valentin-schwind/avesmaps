import { Type, type Static } from "@sinclair/typebox";
import { EditorPathEnds } from "./editor-path-ops.ts";
import { OperationId, OperationReceipt, UUID_PATTERN } from "./operation.ts";

/**
 * „Weg hier teilen“ und „Weg entfernen“ im Wegeditor (WI-0177 Stufe 3; EDIT-0003 T24 (3), F12).
 *
 *     POST  /api/editor/paths/:id/split     path.split: am inneren Stützpunkt in zwei Wege, EINE Operation   edit_map_objects + edit_map_geometry
 *     POST  /api/editor/paths/:id/delete    path.delete: „Ganz löschen“, weich (`is_active`)                   edit_map_objects
 *     POST  /api/editor/paths/:id/restore   path.restore: ↺ eines path.delete                                  edit_map_objects
 *     POST  /api/editor/paths/:id/take-off-map  path.take_off_map: „Von der Karte nehmen“ (Stufe 3b)          edit_map_geometry
 *     POST  /api/editor/paths/:id/put-on-map    path.put_on_map: „Zurück auf die Karte“                        edit_map_geometry
 *     POST  /api/editor/paths/:id/street/delete         „Ganze Straße“ ganz löschen, EINE Operation (T49)      edit_map_objects
 *     POST  /api/editor/paths/:id/street/take-off-map   „Ganze Straße“ von der Karte nehmen, EINE Operation    edit_map_geometry
 *     GET   /api/editor/paths/:id/history       der Verlauf der Straße (T54, `editor-history.ts`)            use_editor_menu
 *
 * Wie Legacy (`split_path`, `api/_internal/map/path-split.php`, Mirror 5ff58118): geteilt wird nur an einem inneren Stützpunkt, der
 * Teilungspunkt liegt in beiden Teilen, und beide behalten Name, Art, Reisemittel, Jahreszeiten, Fließrichtung, Wiki-Zuordnung und
 * Quellen. Ohne Kreuzungsobjekt (Entscheid 2026-10-10): Die zwei Enden am Teilungspunkt verbindet die Wegfindung aus der Lage.
 * Abweichung: Legacy legt BEIDE Teile neu an und legt das Original still; hier behält der vordere Teil seine Kennung, damit Links,
 * Verlauf und die Anker aus Literatur und Stadtplänen (`adventure_place.path_id`, `citymap_place.path_id`) bleiben. Der hintere Teil
 * ist neu. Löschen ist weich wie in Legacy (`delete_feature`): Wiki-Zuordnung und Quellen bleiben am Weg und kommen mit ↺ zurück.
 *
 * „Von der Karte nehmen“ (EDIT-0003 F12 „ja, wie Orte“, T43; Migration 0150) hat in Legacy kein Gegenstück: Der Weg behält seine Linie,
 * verschwindet aus Kacheln, Wegfindung, Suche und Prüfungen und steht in der Liste unter „Nicht auf der Karte“. Das Recht ist das der
 * Lage wie bei `place.take_off_map`.
 */

export const editorPathSplitUrl = (publicId: string): string => `/api/editor/paths/${publicId}/split`;
export const editorPathDeleteUrl = (publicId: string): string => `/api/editor/paths/${publicId}/delete`;
export const editorPathRestoreUrl = (publicId: string): string => `/api/editor/paths/${publicId}/restore`;
export const editorPathTakeOffMapUrl = (publicId: string): string => `/api/editor/paths/${publicId}/take-off-map`;
export const editorPathPutOnMapUrl = (publicId: string): string => `/api/editor/paths/${publicId}/put-on-map`;
/** „Weg entfernen › Ganze Straße (n Abschnitte) …“ (EDIT-0003 T49): alle Abschnitte in EINER Operation; `publicId` ist einer davon. */
export const editorPathStreetDeleteUrl = (publicId: string): string => `/api/editor/paths/${publicId}/street/delete`;
export const editorPathStreetTakeOffMapUrl = (publicId: string): string =>
    `/api/editor/paths/${publicId}/street/take-off-map`;
/** Der Verlauf der Straße eines Abschnitts: jede Operation an einem ihrer Abschnitte, neueste zuerst. */
export const editorPathHistoryUrl = (publicId: string): string => `/api/editor/paths/${publicId}/history`;

/** Die vier Wechsel des Stands und ihr Gegenwechsel (↺ im Verlauf, T54). */
export const PATH_STATE_REVERSE = {
    "path.delete": "path.restore",
    "path.restore": "path.delete",
    "path.take_off_map": "path.put_on_map",
    "path.put_on_map": "path.take_off_map",
} as const;
export type PathStateChange = keyof typeof PATH_STATE_REVERSE;

const strict = { additionalProperties: false } as const;
const Point = Type.Object({ x: Type.Number(), y: Type.Number() }, strict);

/**
 * `path.split`: der Index des inneren Stützpunkts im gespeicherten Kontrollpolygon (1 bis Länge − 2) und seine Lage, wie der Editor sie
 * sieht. Stimmt sie nicht (auf fünf Stellen) mit dem Gespeicherten überein, ist der Stand veraltet (409), wie Legacys
 * `expected_coordinates`.
 */
export const PathSplitBody = Type.Object(
    {
        operationId: OperationId,
        baseRevision: Type.Integer({ minimum: 1 }),
        index: Type.Integer({ minimum: 1 }),
        at: Point,
    },
    strict,
);
export type PathSplitBody = Static<typeof PathSplitBody>;

/** Die Quittung: die gewöhnliche, dazu der neue hintere Teil und woran die Enden beider Teile jetzt hängen. */
export const PathSplitReceipt = Type.Object(
    {
        ...OperationReceipt.properties,
        publicId: Type.String(),
        ends: Type.Object({ vorne: EditorPathEnds, hinten: EditorPathEnds }, strict),
    },
    strict,
);
export type PathSplitReceipt = Static<typeof PathSplitReceipt>;

/** `path.delete`, `path.restore`, `path.take_off_map` und `path.put_on_map`: gegen die Revision des Wegs. */
export const PathRemovalBody = Type.Object(
    { operationId: OperationId, baseRevision: Type.Integer({ minimum: 1 }) },
    strict,
);
export type PathRemovalBody = Static<typeof PathRemovalBody>;

/** Die ganze Straße: jeder Abschnitt gegen seine Revision, alle in EINER Operation (alle oder keiner). */
export const PathStreetRemovalBody = Type.Object(
    {
        operationId: OperationId,
        sections: Type.Array(
            Type.Object(
                { publicId: Type.String({ pattern: UUID_PATTERN }), baseRevision: Type.Integer({ minimum: 1 }) },
                strict,
            ),
            { minItems: 1, maxItems: 500 },
        ),
    },
    strict,
);
export type PathStreetRemovalBody = Static<typeof PathStreetRemovalBody>;
