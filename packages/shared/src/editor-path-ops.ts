import { Type, type Static } from "@sinclair/typebox";
import { EDITOR_LANDSCAPE_LAYERS, EditorLandscapeTargetEdge, type EditorLandscapeLayer } from "./landscape-editor.ts";

/**
 * Lesen und Schreiben eines Wegs im Wegeditor (WI-0177 Stufe 1, „Wegkurve bearbeiten“).
 *
 *     GET   /api/editor/paths/:id           Kontrollpolygon, Revision, woran die Enden hängen          use_editor_menu
 *     GET   /api/editor/paths/:id/targets   Andockziele um den Weg: Orte und Stützpunkte anderer Wege   edit_map_geometry
 *           ?layers=…                       bei einem Fluss dazu Flächenkanten dieser Ebenen und Linien anderer Flüsse
 *
 * 🔴 Gespeichert wird das KONTROLLPOLYGON (`path.geom`); die gezeichnete Kurve ist Catmull-Rom darüber und entsteht in
 * derselben Transaktion (`path_visual`). Geschrieben wird die Kurve seit W5b Schritt 3 mit den Feldern der Straße in EINER Operation
 * `path.update` (`editor-path-update.ts`, `shape`); der eigene Schreibweg `path.reshape` ist entfallen. Woran beide Enden NACH dem
 * Speichern hängen, rechnet der Server mit denselben Regeln und Werten wie die Wegfindung (Entscheid 2026-10-10: „den erfolgreich
 * gespeicherten Anschluss sichtbar bestätigen“).
 */

export const editorPathUrl = (publicId: string): string => `/api/editor/paths/${publicId}`;
export const editorPathTargetsUrl = (publicId: string): string => `/api/editor/paths/${publicId}/targets`;

/**
 * Die Ebenen der Derographie, deren Flächenkanten ein Fluss als Andockziel bekommt (`?layers=`, Liste mit Komma, leer: keine; ohne
 * Angabe alle drei). Wie bei „Ecken bearbeiten“ nur, was man sieht (EDIT-0003 T27 (1)).
 */
export const PATH_TARGET_LAYERS_PATTERN = `^((${EDITOR_LANDSCAPE_LAYERS.join("|")})(,(${EDITOR_LANDSCAPE_LAYERS.join("|")}))*)?$`;
export const pathTargetLayersParam = (ebenen: readonly EditorLandscapeLayer[]): string =>
    `layers=${encodeURIComponent(ebenen.join(","))}`;
/** Liest `?layers=`; ohne Angabe alle drei. */
export const pathTargetLayers = (wert: string | undefined): EditorLandscapeLayer[] =>
    wert === undefined
        ? [...EDITOR_LANDSCAPE_LAYERS]
        : (wert.split(",").filter((ebene) => ebene !== "") as EditorLandscapeLayer[]);

/** So weit um den Kasten des Wegs holt der Modus die Andockziele, in Karteneinheiten; einmal beim Start und nach jeder Quittung. */
export const PATH_TARGET_MARGIN = 15;

/** Mindestens zwei Stützpunkte; die Obergrenze schützt nur die Anfrage. */
export const PATH_MAX_POINTS = 4000;

const strict = { additionalProperties: false } as const;
const Point = Type.Object({ x: Type.Number(), y: Type.Number() }, strict);

/** Woran ein Wegende hängt, wie die Wegfindung es sieht (`routing/topology.ts`): ein Ort, ein anderer Weg oder nichts. */
export const EditorPathAttachment = Type.Union([
    Type.Object({ kind: Type.Literal("place"), publicId: Type.String(), name: Type.String() }, strict),
    Type.Object(
        {
            kind: Type.Literal("path"),
            publicId: Type.String(),
            /** Der gespeicherte Name; ob er ein Griff ist, entscheidet die Seite mit `pathReaderName` (WI-0105). */
            name: Type.String(),
            subtype: Type.String(),
            isBach: Type.Boolean(),
            /** Wie es den anderen Weg trifft: an dessen Ende, an einem Stützpunkt oder auf der Strecke dazwischen. */
            contact: Type.Union([Type.Literal("ende"), Type.Literal("stuetzpunkt"), Type.Literal("segment")]),
        },
        strict,
    ),
    Type.Object({ kind: Type.Literal("free") }, strict),
]);
export type EditorPathAttachment = Static<typeof EditorPathAttachment>;

export const EditorPathEnds = Type.Object({ start: EditorPathAttachment, end: EditorPathAttachment }, strict);
export type EditorPathEnds = Static<typeof EditorPathEnds>;

export const EditorPathDetail = Type.Object(
    {
        publicId: Type.String(),
        revision: Type.Integer({ minimum: 1 }),
        name: Type.String(),
        subtype: Type.String(),
        labelVisible: Type.Boolean(),
        isBach: Type.Boolean(),
        flowDirection: Type.Union([Type.Literal("forward"), Type.Literal("reverse"), Type.Null()]),
        sourceSystem: Type.String(),
        active: Type.Boolean(),
        /** Von der Karte genommen (WI-0177 Stufe 3b, `path.take_off_map`); dann ist `active` falsch. */
        offMap: Type.Optional(Type.Boolean()),
        /** Das Kontrollpolygon in Karteneinheiten, Anfang zuerst. */
        points: Type.Array(Point, { minItems: 2 }),
        ends: EditorPathEnds,
    },
    strict,
);
export type EditorPathDetail = Static<typeof EditorPathDetail>;

/** Ein Ort als Andockziel. */
export const EditorPathTargetPlace = Type.Object(
    { publicId: Type.String(), name: Type.String(), x: Type.Number(), y: Type.Number() },
    strict,
);
export type EditorPathTargetPlace = Static<typeof EditorPathTargetPlace>;

/** Ein Stützpunkt eines anderen aktiven Wegs als Andockziel; `index` zählt ab 0 im Kontrollpolygon dieses Wegs. */
export const EditorPathTargetVertex = Type.Object(
    {
        pathId: Type.String(),
        name: Type.String(),
        index: Type.Integer({ minimum: 0 }),
        x: Type.Number(),
        y: Type.Number(),
        /** Anfang oder Ende seines Wegs. */
        end: Type.Boolean(),
        revision: Type.Integer({ minimum: 1 }),
    },
    strict,
);
export type EditorPathTargetVertex = Static<typeof EditorPathTargetVertex>;

/** Eine Geländemarke (`terrain_peak`) als Andockziel eines Flussendes (OPS-000088). */
export const EditorPathTargetPeak = Type.Object(
    { publicId: Type.String(), name: Type.String(), x: Type.Number(), y: Type.Number() },
    strict,
);
export type EditorPathTargetPeak = Static<typeof EditorPathTargetPeak>;

/**
 * Eine Strecke eines anderen Flusses zwischen zwei Stützpunkten als Andockziel eines Flusses (`kante`); `index` ist ihr Anfang im
 * Kontrollpolygon, die Stützpunkte selbst stehen in `vertices`.
 */
export const EditorPathTargetRiverEdge = Type.Object(
    {
        pathId: Type.String(),
        name: Type.String(),
        index: Type.Integer({ minimum: 0 }),
        a: Type.Tuple([Type.Number(), Type.Number()]),
        b: Type.Tuple([Type.Number(), Type.Number()]),
    },
    strict,
);
export type EditorPathTargetRiverEdge = Static<typeof EditorPathTargetRiverEdge>;

/**
 * Die Andockziele eines Wegs. Nur ein Fluss oder Bach bekommt dazu (Vali 2026-11-08: „dass beim Editieren von Flussverläufen in der
 * Derographie Flüsse an Seen, anderen Flächen und anderen Flüssen "andocken" können“) die Kanten der Teilflächen in den verlangten
 * Ebenen (`areaEdges`, Seeufer liegen in der Topographie; Form wie bei „Ecken bearbeiten“) und die Abschnitte anderer Flüsse
 * (`riverEdges`). Ein Weg bekommt beide nicht; ein älterer Server kennt sie nicht, darum optional.
 */
export const EditorPathTargets = Type.Object(
    {
        margin: Type.Number(),
        places: Type.Array(EditorPathTargetPlace),
        vertices: Type.Array(EditorPathTargetVertex),
        peaks: Type.Array(EditorPathTargetPeak),
        areaEdges: Type.Optional(Type.Array(EditorLandscapeTargetEdge)),
        riverEdges: Type.Optional(Type.Array(EditorPathTargetRiverEdge)),
    },
    strict,
);
export type EditorPathTargets = Static<typeof EditorPathTargets>;

/**
 * Ein Punkt eines ANDEREN Wegs, der mitzieht (Betreiber 2026-10-15, Frage 3: „ja“): Er lag genau auf dem gezogenen Stützpunkt
 * (`from`, fünf Stellen) an einem Knoten ohne Ort und geht nach `to`, in derselben Operation.
 */
export const PathCarriedPoint = Type.Object(
    {
        pathId: Type.String(),
        index: Type.Integer({ minimum: 0 }),
        baseRevision: Type.Integer({ minimum: 1 }),
        from: Point,
        to: Point,
    },
    strict,
);
export type PathCarriedPoint = Static<typeof PathCarriedPoint>;
