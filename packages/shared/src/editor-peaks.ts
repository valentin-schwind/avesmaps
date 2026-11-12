import { Type, type Static } from "@sinclair/typebox";
import { LANDMARKEN_ARTEN, LANDMARKEN_MERKMALE } from "./landmarken.ts";
import { OperationId, OperationReceipt, UUID_PATTERN } from "./operation.ts";

/**
 * Gipfel und Vulkane im Derographie-Editor (WI-0178 P1; EDIT-0003 T55, Betreiber 2026-10-18, wörtlich: „Berggipfel und Vulkane sind
 * "derographische" objekte und haben eine höhe. diese höhe soll sowohl durch klick auf das objekt als auch in der gipfel-liste der gebirge
 * verändert werden“): Lesen und `peak.update` an `terrain_peak`.
 *
 * - `GET /api/editor/peaks/:id` (Recht `use_editor_menu`): Name, Art, Höhe, „Auf der Karte anzeigen“ (`show_name`, 0164), Lage, Revision.
 *   `height` fehlt, wo Legacy keine Höhe kennt (die Ableitung nimmt dann ihre Vorgabe).
 * - `PATCH /api/editor/peaks/:id` (`edit_map_objects`, mit `position` dazu `edit_map_geometry`): `peak.update`, EINE Operation gegen
 *   `baseRevision` (409 `edit_conflict`); hält ein anderer den Gipfel, 409 `object_locked`. Höhe und Lage gehen ins Gelände und reihen
 *   das Gelände im Umkreis ein (WI-0223, `affected` `{ kind: "peak" }`); Name und Anzeige nicht. Denselben Schreibweg nimmt die
 *   Gipfelliste des Gebirges (P5).
 * - `POST /api/editor/peaks` (`edit_map_objects` und `edit_map_geometry`, P7, Fassung 16: „Hier hinzufügen › ▲ Gipfel setzen …“, Legacy
 *   „Höhenpunkt setzen“): `peak.create`, ein Berggipfel an einer Stelle mit dem Griff „Gipfel-001“ wie eine neue Fläche, ohne Höhe;
 *   danach öffnet sein Fenster mit markiertem Namen.
 * - `POST /api/editor/peaks/:id/retire` („Gipfel entfernen …“, Editor-Orchestrierung 2026-10-19, wie „Fläche entfernen“): `peak.retire`,
 *   weich (`is_active` FALSE) gegen `baseRevision`; das Gelände im Umkreis rechnet neu. `POST …/:id/restore-series` (WI-0265 B6c, `editor-ruecknahme.ts`)
 *   holt ihn zurück (auch aus einem „Entfernen …“ der Mehrfachauswahl); `GET …/:id/history` ist sein Verlauf.
 * - Der Gelöschte liest sich weiter (`state` „retired“), sein Fenster zeigt ihn mit Verlauf. `mountains` nennt die Gebirge, in deren
 *   aktiven Teilflächen er liegt (dort zählt seine Höhe): Die Rückfrage vor dem Entfernen sagt es.
 * - 🪤 Keine `null` in den Feldern: Fastifys ajv machte aus `null` in einer Vereinigung mit einer Zahl still eine 0.
 * - Koordinaten MCS `aventuria-v1`, wie gespeichert.
 * - **Landmarken** (WI-0271 L3, Variante D): Dieselben Wege tragen jede Landmarkenart (`LANDMARKEN_ARTEN`) mit ihren Merkmalen. Nur Berggipfel
 *   und Vulkan formen Gelände und tragen eine Höhe; eine Höhe an einer anderen Art ist 400, ein Wechsel zu einer Art ohne Gelände leert sie.
 *   Ein Artwechsel reiht das Gelände nur ein, wenn sich die Geländewirkung ändert (`gelaende-folgen.ts`, Eingabeindex über die Sicht).
 */

export const EDITOR_PEAKS_URL = "/api/editor/peaks";
export const editorPeakUrl = (id: string): string => `${EDITOR_PEAKS_URL}/${id}`;
export const editorPeakRetireUrl = (id: string): string => `${editorPeakUrl(id)}/retire`;
export const editorPeakHistoryUrl = (id: string): string => `${editorPeakUrl(id)}/history`;

/** Grenzen der Felder (Spalte `height_schritt` 0 bis 65535; Name wie an der Fläche). */
export const PEAK_HEIGHT_MAX = 65535;
export const PEAK_NAME_MAX = 120;

const strict = { additionalProperties: false } as const;
const Punkt = Type.Tuple([Type.Number(), Type.Number()]);
const Art = Type.Union(LANDMARKEN_ARTEN.map((art) => Type.Literal(art)));
/** Die Merkmale einer Landmarke, jedes höchstens einmal; leer heißt: keine. */
const Merkmale = Type.Array(Type.Union(LANDMARKEN_MERKMALE.map((merkmal) => Type.Literal(merkmal))), {
    uniqueItems: true,
    maxItems: LANDMARKEN_MERKMALE.length,
});

export const EditorPeakDetail = Type.Object(
    {
        id: Type.String({ pattern: UUID_PATTERN }),
        name: Type.String(),
        subtype: Art,
        height: Type.Optional(Type.Integer({ minimum: 0, maximum: PEAK_HEIGHT_MAX })),
        /** Die Merkmale (heilig, magisch …); fehlt ohne. */
        merkmale: Type.Optional(Merkmale),
        showName: Type.Boolean(),
        position: Punkt,
        revision: Type.Integer({ minimum: 1 }),
        /** Gelöscht („Gipfel entfernen …“): Das Fenster liest nur, ↺ im Verlauf holt ihn zurück. */
        state: Type.Optional(Type.Literal("retired")),
        /** Die Gebirge, in deren aktiven Teilflächen er liegt; fehlt ohne. */
        mountains: Type.Optional(
            Type.Array(Type.Object({ id: Type.String({ pattern: UUID_PATTERN }), name: Type.String() }, strict)),
        ),
    },
    strict,
);
export type EditorPeakDetail = Static<typeof EditorPeakDetail>;

/** `peak.retire`: „Gipfel entfernen …“ gegen den Stand, den das Fenster zeigt. */
export const PeakRetireBody = Type.Object(
    { operationId: OperationId, baseRevision: Type.Integer({ minimum: 1 }) },
    strict,
);
export type PeakRetireBody = Static<typeof PeakRetireBody>;

export const PeakChanges = Type.Object(
    {
        name: Type.Optional(Type.String({ minLength: 1, maxLength: PEAK_NAME_MAX })),
        /** Die Art; zu einer Art ohne Gelände leert sie die Höhe. */
        subtype: Type.Optional(Art),
        /** Nur bei Berggipfel und Vulkan (nach dem Wechsel der Art, wenn er mitkommt). */
        height: Type.Optional(Type.Integer({ minimum: 0, maximum: PEAK_HEIGHT_MAX })),
        /** Die ganze Menge der Merkmale; `[]` nimmt alle weg. */
        merkmale: Type.Optional(Merkmale),
        showName: Type.Optional(Type.Boolean()),
        position: Type.Optional(Punkt),
    },
    strict,
);
export type PeakChanges = Static<typeof PeakChanges>;

export const PeakUpdateBody = Type.Object(
    { operationId: OperationId, baseRevision: Type.Integer({ minimum: 1 }), changes: PeakChanges },
    strict,
);
export type PeakUpdateBody = Static<typeof PeakUpdateBody>;

export const PeakUpdateReceipt = OperationReceipt;

/**
 * Der Griff eines neuen Gipfels (P7), wie der einer neuen Fläche (`LANDSCAPE_CREATE_HANDLE`): „Gipfel-001“, gelesen wird jede Zahl. Eine Landmarke
 * ohne Gelände (WI-0271 L3) heißt „Landmarke-001“ und zählt für sich.
 */
export const PEAK_CREATE_HANDLE = "Gipfel";
export const LANDMARKE_CREATE_HANDLE = "Landmarke";
export const PEAK_CREATE_DIGITS = 3;

/**
 * `subtype` fehlt: ein Berggipfel wie bisher. Merkmale gibt es von Anfang an nur, wenn sie mitkommen. `wikiKandidat` (WI-0271 L7, „Auf der Karte setzen“ an einem Kandidaten ◐): die Kennung des
 * Landmarken-Artikels (`wiki_landmarke_artikel.public_id`); die Landmarke heißt dann wie der Artikel, trägt seine Art (wo `subtype` fehlt) und seine Höhe (nur Berg und Vulkan) und hängt an seiner Adresse.
 */
export const PeakCreateBody = Type.Object(
    {
        operationId: OperationId,
        position: Punkt,
        subtype: Type.Optional(Art),
        merkmale: Type.Optional(Merkmale),
        wikiKandidat: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
    },
    strict,
);
export type PeakCreateBody = Static<typeof PeakCreateBody>;

/** Die Quittung: die gewöhnliche, dazu der neue Gipfel (sein Fenster geht auf, der Name markiert). */
/**
 * „In Landmarke umwandeln …“ an einem Ort (WI-0271 L8; Schreibweg `apps/server/src/editor/ort-in-landmarke.ts`): EIN Ort, EINE Operation. Die Art schlägt `landmarkenArtVorschlag` vor; der Editor ändert sie danach im
 * Fenster der Landmarke, das sich öffnet. Die Rücknahme hängt an der Landmarke.
 */
export const editorPlaceInLandmarkeUrl = (id: string): string => `/api/editor/places/${id}/in-landmarke`;
export const editorUmwandlungRestoreSeriesUrl = (id: string): string =>
    `/api/editor/landmarken-umwandlung/${id}/restore-series`;
export const editorUmwandlungRestoreSeriesPreviewUrl = (id: string): string =>
    `/api/editor/landmarken-umwandlung/${id}/restore-series/preview`;
export const PlaceInLandmarkeBody = Type.Object(
    { operationId: OperationId, baseRevision: Type.Integer({ minimum: 1 }) },
    strict,
);
export type PlaceInLandmarkeBody = Static<typeof PlaceInLandmarkeBody>;
export const PlaceInLandmarkeReceipt = Type.Object(
    { ...OperationReceipt.properties, peakId: Type.String(), name: Type.String(), subtype: Type.String() },
    strict,
);
export type PlaceInLandmarkeReceipt = Static<typeof PlaceInLandmarkeReceipt>;

export const PeakCreateReceipt = Type.Object(
    { ...OperationReceipt.properties, publicId: Type.String(), name: Type.String() },
    strict,
);
export type PeakCreateReceipt = Static<typeof PeakCreateReceipt>;
export type PeakUpdateReceipt = Static<typeof PeakUpdateReceipt>;
