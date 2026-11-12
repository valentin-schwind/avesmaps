import { Type, type Static } from "@sinclair/typebox";
import {
    EditorPathEnds,
    PATH_MAX_POINTS,
    PATH_TARGET_LAYERS_PATTERN,
    pathTargetLayersParam,
} from "./editor-path-ops.ts";
import type { EditorLandscapeLayer } from "./landscape-editor.ts";
import { OperationId, OperationReceipt } from "./operation.ts";

/**
 * „Neuer Weg“ im Wegeditor (WI-0177; EDIT-0003 T40 (3), Betreiber 2026-10-17: „aktiviere außerdem neuer weg und neue fläche“).
 *
 *     GET   /api/editor/path-targets?x0=…&y0=…&x1=…&y1=…   Andockziele im Kasten: Orte und Stützpunkte aktiver Wege   edit_map_geometry
 *     POST  /api/editor/paths                              path.create: ein neuer Weg, EINE Operation                 edit_map_objects + edit_map_geometry
 *
 * Wie Legacy (`create_path`, Mirror 5ff58118): Ein neuer Weg ist ein `Weg` mit einem Griff als Namen („Weg-7012“, die nächste freie
 * Nummer), ohne Namen auf der Karte, mit den Reisemitteln seiner Art (keine eigene Liste) und ohne Quellen. Die Art und alles Weitere
 * ändert man danach im Wege-Fenster. Gespeichert wird das Kontrollpolygon auf fünf Nachkommastellen; die gezeichnete Kurve entsteht in
 * derselben Transaktion. Die Quittung nennt den neuen Weg und woran seine Enden NACH dem Speichern hängen (Entscheid 2026-10-10).
 */

export const EDITOR_PATH_TARGETS_URL = "/api/editor/path-targets";

/**
 * Die Ziele im Kasten um den sichtbaren Ausschnitt; der Modus holt sie zwischen den Gesten (`map/geometrie/anlegen.ts`). Für einen
 * neuen Fluss oder Bach (`fluss`) dazu die Flächenkanten der Ebenen `ebenen` und die Abschnitte der Flüsse (wie um einen Fluss).
 */
export const editorPathTargetsAreaUrl = (
    kasten: {
        readonly x0: number;
        readonly y0: number;
        readonly x1: number;
        readonly y1: number;
    },
    fluss?: { readonly art: Exclude<PathCreateArt, "weg">; readonly ebenen: readonly EditorLandscapeLayer[] },
): string => {
    const zahl = (wert: number): string => String(Math.round(wert * 1000) / 1000);
    const kern = `${EDITOR_PATH_TARGETS_URL}?x0=${zahl(kasten.x0)}&y0=${zahl(kasten.y0)}&x1=${zahl(kasten.x1)}&y1=${zahl(kasten.y1)}`;
    return fluss === undefined ? kern : `${kern}&art=${fluss.art}&${pathTargetLayersParam(fluss.ebenen)}`;
};

/**
 * Die größte Seite des Kastens in Karteneinheiten (die Karte ist 1024 breit). Größer wird auf die Mitte gekürzt: Bei so weitem
 * Blick rastet niemand mehr gezielt ein, und die Antwort bleibt klein.
 */
export const PATH_TARGETS_MAX_SIDE = 160;

/**
 * Was „Neuer Weg“ anlegt (WI-0177, Plan Fluss/Bach 2026-10-19; Betreiber: „oje wichtiges feature fehlt: wege sind noch keine flüsse /
 * bäche“): ein Landweg wie bisher, ein Fluss oder ein Bach. Legacy kannte nur den Landweg und machte ihn erst im Dialog danach zum Fluss.
 */
export const PATH_CREATE_ARTEN = ["weg", "fluss", "bach"] as const;
export type PathCreateArt = (typeof PATH_CREATE_ARTEN)[number];

/** Der Kasten; `art` Fluss oder Bach holt dazu die Flächenkanten der Ebenen `layers` (ohne Angabe alle drei) und die Abschnitte der Flüsse. */
export const PathTargetsQuery = Type.Object(
    {
        x0: Type.Number(),
        y0: Type.Number(),
        x1: Type.Number(),
        y1: Type.Number(),
        art: Type.Optional(Type.Union(PATH_CREATE_ARTEN.map((art) => Type.Literal(art)))),
        layers: Type.Optional(Type.String({ pattern: PATH_TARGET_LAYERS_PATTERN })),
    },
    { additionalProperties: false },
);
export type PathTargetsQuery = Static<typeof PathTargetsQuery>;

/** Die Art eines neuen Wegs (Legacy: `feature_subtype: "Weg"` beim Anlegen, geändert wird sie danach). */
export const PATH_CREATE_SUBTYPE = "Weg";

/** Der Wegtyp einer neuen Art: Fluss und Bach sind beide `Flussweg`, der Bach mit `is_bach`. */
export const pathCreateSubtype = (art: PathCreateArt): string => (art === "weg" ? PATH_CREATE_SUBTYPE : "Flussweg");

const Point = Type.Object({ x: Type.Number(), y: Type.Number() }, { additionalProperties: false });

/** `path.create`: das Kontrollpolygon des neuen Wegs, Anfang zuerst; der Server rundet auf fünf Nachkommastellen. */
export const PathCreateBody = Type.Object(
    {
        operationId: OperationId,
        points: Type.Array(Point, { minItems: 2, maxItems: PATH_MAX_POINTS }),
        /**
         * Weg, Fluss oder Bach; fehlt: Weg. Ein Fluss fließt in Zeichenrichtung (`flow_direction` `forward`, vom ersten zum letzten
         * Punkt; Topographie 2026-10-19: „vom ersten zum letzten Stützpunkt bergab“) und nimmt die Boote seiner Art; ein Bach ebenso, aber
         * ohne Boote (F14: leere Liste, Domäne `none`).
         */
        art: Type.Optional(Type.Union(PATH_CREATE_ARTEN.map((art) => Type.Literal(art)))),
    },
    { additionalProperties: false },
);
export type PathCreateBody = Static<typeof PathCreateBody>;

/** Die Quittung: die gewöhnliche, dazu der neue Weg und woran seine Enden jetzt hängen. */
export const PathCreateReceipt = Type.Object(
    {
        ...OperationReceipt.properties,
        publicId: Type.String(),
        name: Type.String(),
        subtype: Type.String(),
        /** Ein Bach (`is_bach`); fehlt bei Weg und Fluss. */
        isBach: Type.Optional(Type.Literal(true)),
        ends: EditorPathEnds,
    },
    { additionalProperties: false },
);
export type PathCreateReceipt = Static<typeof PathCreateReceipt>;
