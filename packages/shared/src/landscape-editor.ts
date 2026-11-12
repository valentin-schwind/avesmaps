import { Type, type Static } from "@sinclair/typebox";
import { PEAK_HEIGHT_MAX } from "./editor-peaks.ts";
import { EditorGebirge, GebirgsAenderung } from "./gebirge/vertrag.ts";
import { GEFAHREN_ARTEN } from "./gefahren.ts";
import { GELAENDE_ARTEN, LANDMARKEN_ARTEN, LANDMARKEN_MERKMALE } from "./landmarken.ts";
import { AVENTURIA_CARTOGRAPHY, cartographyTypesOfLayer } from "./map-cartography-registry.ts";
import { OperationId, OperationReceipt, UUID_PATTERN } from "./operation.ts";

/**
 * Der Lesepfad des Landschaftseditors (WI-0178 Paket A1; EDIT-0004 §2.2, §5), nach dem Muster der Ortsliste (`editor-places.ts`).
 *
 * - 🔴 Recht `use_editor_menu` (ab Reviewer), am Server über `protect`; ohne Recht 403 vor jeder Abfrage.
 * - **Eine Landschaft ist ein Objekt** (Betreiber 2026-10-15, B1): `region` mit 0..n Teilflächen (`region_area`) und 0..n
 *   Beschriftungen (`map_label` mit `region_id`). Eine Landschaft ohne Fläche bleibt und steht unter „Nicht auf der Karte“ (B6).
 *   Klimazonen bleiben draußen: Der Import führt sie nicht als Flächen (EDIT-0004 §2.2). Ganz gelöschte (`is_active = false`) fehlen.
 * - **Der Kreis** in vier Zuständen (Betreiber 2026-10-16, EDIT-0003 T26 (5); EDIT-0004 §2.2): links die Hälfte für das Wiki, rechts
 *   die für die Karte. Dieselben Füllungen wie `avm-kreis.vue` und die Ortsliste (`kreisVon` in `apps/web/src/editor-liste/orte-liste.ts`):
 *   ● `voll` platziert und dem Wiki zugewiesen · ◐ `halb` nur im Wiki, nicht platziert · ◑ `halb-rechts` platziert, ohne Wiki-Artikel ·
 *   ○ `leer` nicht platziert, ohne Wiki-Artikel. „Dem Wiki zugewiesen“ heißt: `region.wiki_url` oder `wiki_region_key` gesetzt, wie
 *   das Infopanel (`apps/server/src/subjects/detail-area.ts`); einen eigenen Zuordnungsstand wie bei Orten gibt es für Regionen nicht.
 * - **Knapp:** rund 5.400 Zeilen auf einmal; was falsch, null oder 0 ist, fehlt in der Zeile. Der Server schickt die Liste gepackt, der
 *   schwache ETag über den Inhalt macht jeden weiteren Abruf zu einem 304, bis sich etwas ändert.
 * - **Kennungen** sind öffentliche (`public_id`). Koordinaten sind MCS `aventuria-v1`, wie gespeichert: eckig, nie die gerundete Fläche.
 */

export const EDITOR_LANDSCAPES_URL = "/api/editor/landscapes";
/** Die gemeinsamen Grenzen angedockter Gebirge, für die Linie auf der Karte (OPS-000089). */
export const EDITOR_LANDSCAPE_NAEHTE_URL = `${EDITOR_LANDSCAPES_URL}/naehte`;

/** Die Ebenen, die der Editor führt; `klima` bleibt draußen. */
export const EDITOR_LANDSCAPE_LAYERS = ["derographisch", "vegetation", "topographie"] as const;
export type EditorLandscapeLayer = (typeof EDITOR_LANDSCAPE_LAYERS)[number];

export const EDITOR_LANDSCAPE_CIRCLES = ["leer", "halb", "halb-rechts", "voll"] as const;
export type EditorLandscapeCircle = (typeof EDITOR_LANDSCAPE_CIRCLES)[number];

const strict = { additionalProperties: false } as const;
const Union = <T extends string>(values: readonly T[]) => Type.Union(values.map((value) => Type.Literal(value)));
/** Ein Merkmal, das nur dasteht, wenn es zutrifft. */
const Flag = () => Type.Optional(Type.Literal(true));
const PublicId = () => Type.String({ pattern: UUID_PATTERN });
const Punkt = Type.Tuple([Type.Number(), Type.Number()]);
/** Eine Gefahrenlage (WI-0308): jede Art höchstens einmal; leer heißt „ungefährlich“. */
const Gefahren = () => Type.Array(Union(GEFAHREN_ARTEN), { uniqueItems: true, maxItems: GEFAHREN_ARTEN.length });

const Wiki = Type.Object(
    {
        url: Type.String({ minLength: 1 }),
        /** Der Titel des Artikels aus Legacys Abzug (`wiki_region_snapshot.name`); fehlt ohne Abzug. */
        title: Type.Optional(Type.String()),
    },
    strict,
);

/** Die stillen Stände einer Landschaft (D2): `off_map` von der Karte genommen, `retired` gelöscht (beides weich). */
export const EDITOR_LANDSCAPE_STATES = ["off_map", "retired"] as const;
export type EditorLandscapeState = (typeof EDITOR_LANDSCAPE_STATES)[number];

export const EditorLandscapeRow = Type.Object(
    {
        id: PublicId(),
        name: Type.String(),
        layer: Union(EDITOR_LANDSCAPE_LAYERS),
        /** Die Art (`region.region_type`: tal, gebirge, kontinent …), roh. */
        type: Type.Optional(Type.String()),
        circle: Union(EDITOR_LANDSCAPE_CIRCLES),
        wiki: Type.Optional(Wiki),
        /** Zahl der Teilflächen auf der Karte; fehlt bei keiner („Nicht auf der Karte“). */
        areas: Type.Optional(Type.Integer({ minimum: 1 })),
        /** Zahl der Beschriftungen; fehlt bei keiner. */
        labels: Type.Optional(Type.Integer({ minimum: 1 })),
        /** Die Beschriftungen laufen entlang der Fläche (Legacys Kurvenbeschriftung, je Landschaft eine Art, T27 (9)). */
        curve: Flag(),
        /** Für Klicks gesperrt (Legacys dauerhafte Klicksperre `region.is_locked`, ⊘). */
        clickLocked: Flag(),
        /** Für Besucher verborgen (T41, `region.is_hidden`): Editoren sehen sie schraffiert. */
        hidden: Flag(),
        /** Die Gefahrenlage (WI-0308, `region.hazards`) in der Folge des Katalogs, auch wenn sie ruht; fehlt bei „ungefährlich“. */
        hazards: Type.Optional(Gefahren()),
        /** Der Platz in der Reihenfolge der Ebene (`region.stack_order`). */
        order: Type.Integer(),
        /** Der Rahmen der Teilflächen zum Hinfliegen: [x0, y0, x1, y1]; fehlt ohne Fläche. */
        bounds: Type.Optional(Type.Tuple([Type.Number(), Type.Number(), Type.Number(), Type.Number()])),
        /** Woher die Landschaft stammt, wenn nicht aus Legacy (`region.source_system`). */
        source: Type.Optional(Type.String()),
        /** Still (WI-0178 D2, EDIT-0003 T54): von der Karte genommen oder gelöscht; fehlt auf der Karte. */
        state: Type.Optional(Union(EDITOR_LANDSCAPE_STATES)),
    },
    strict,
);
export type EditorLandscapeRow = Static<typeof EditorLandscapeRow>;

/**
 * Ein Gipfel oder Vulkan als Zeile der Derographie-Liste (WI-0178 P3; Orchestrierung 2026-10-18: „Gipfel und Vulkane erscheinen als Zeilen
 * der Ebene Topographie mit Art „Berggipfel“ bzw. „Vulkan“, Facette Art wie bisher. Keine eigene Ebene „Gipfel“.“). Eigene Zeilen neben
 * `rows`, damit alles, was Flächen zählt (Ebenenleiste, Karteninhalte, Reihenfolge), sie nicht mitzählt. Seit WI-0271 L3 jede Landmarkenart.
 */
export const EditorLandscapePeakRow = Type.Object(
    {
        id: PublicId(),
        name: Type.String(),
        subtype: Union(LANDMARKEN_ARTEN),
        /** Die Höhe in Schritt (`terrain_peak.height_schritt`); fehlt ohne (Legacy kennt keine). */
        height: Type.Optional(Type.Integer({ minimum: 0 })),
        /** Die Merkmale einer Landmarke (WI-0271 L4: in der Unterzeile), in der Folge des Katalogs; fehlt ohne. */
        merkmale: Type.Optional(Type.Array(Union(LANDMARKEN_MERKMALE))),
        /** Auf der Karte immer, mit oder ohne Artikel (`editorLandscapeCircle`). */
        circle: Union(EDITOR_LANDSCAPE_CIRCLES),
        wiki: Type.Optional(Wiki),
        /** Für Besucher nicht oder erst aus der Nähe auf der Karte: die Merkmale `verborgen` und `nur_gelaende` (`terrain_peak.merkmale`). */
        hidden: Flag(),
        /** Wo er steht, in Kartenkoordinaten: das Ziel des Hinflugs. */
        position: Punkt,
        /** Gelöscht („Gipfel entfernen …“): steht unter „Gelöscht“, ↺ im Verlauf holt ihn zurück. */
        state: Type.Optional(Type.Literal("retired")),
    },
    strict,
);
export type EditorLandscapePeakRow = Static<typeof EditorLandscapePeakRow>;

/** „Nicht auf die Karte“ an einem Landmarken-Kandidaten setzen oder lösen (WI-0271 L7; Schreibnaht `mapOperation`, Quelle `wikisync`, mit Rücknahme in „Änderungen“). */
export const editorLandmarkenKandidatUnterdrueckenUrl = (id: string): string =>
    `/api/editor/landmarken-kandidaten/${id}/unterdruecken`;

export const LandmarkenKandidatUnterdrueckenBody = Type.Object(
    { operationId: OperationId, baseRevision: Type.Integer({ minimum: 1 }), unterdrueckt: Type.Boolean() },
    strict,
);
export type LandmarkenKandidatUnterdrueckenBody = Static<typeof LandmarkenKandidatUnterdrueckenBody>;

/**
 * Ein Landmarken-Artikel des Wikis ohne Landmarke auf der Karte (WI-0271 L7, §4.2): ein Kandidat ◐ „nur im Wiki, nicht platziert“. Ihn legt der WikiSync an (`wiki_landmarke_artikel`); auf die Karte
 * kommt er allein durch einen Menschen („Auf der Karte setzen“, `PeakCreateBody.wikiKandidat`). Unterdrückt („nicht auf die Karte“) steht er weiter in der Liste, unter „unterdrückt“.
 */
export const EditorLandmarkenKandidat = Type.Object(
    {
        /** `wiki_landmarke_artikel.public_id` */
        id: PublicId(),
        titel: Type.String({ minLength: 1 }),
        /** Der Name aus der Infobox (sonst der Titel). */
        name: Type.String({ minLength: 1 }),
        /** Die Landmarkenart aus der Abbildung der Wiki-Art: die Vorgabe beim Setzen. */
        art: Union(LANDMARKEN_ARTEN),
        /** Die Wiki-Art, wie das Wiki sie nennt („Höhle“, „Klamm“). */
        wikiArt: Type.Optional(Type.String()),
        region: Type.Optional(Type.String()),
        height: Type.Optional(Type.Integer({ minimum: 0, maximum: PEAK_HEIGHT_MAX })),
        kurzbeschreibung: Type.Optional(Type.String()),
        wikiUrl: Type.String({ minLength: 1 }),
        unterdrueckt: Flag(),
        revision: Type.Integer({ minimum: 1 }),
    },
    strict,
);
export type EditorLandmarkenKandidat = Static<typeof EditorLandmarkenKandidat>;

/**
 * Ein Wiki-Artikel mit `{{Infobox Region}}`, an dem keine Fläche hängt (WI-0284; Vali 2026-11-06: „einfach listeneinträge mit dem wiki-eintrag (halt ohne fläche)“): eine ◐-Zeile der Liste. Ebene und Flächenart
 * kommen aus der Art des Artikels und sind nur die Vorgabe. Eine Fläche entsteht allein durch einen Menschen: zeichnen (`LandscapeCreateBody.wikiEintrag`) oder den Artikel in der Wiki-Box einer vorhandenen Fläche zuweisen.
 */
export const EditorWikiEintrag = Type.Object(
    {
        /** `wiki_region_snapshot.public_id` */
        id: PublicId(),
        titel: Type.String({ minLength: 1 }),
        name: Type.String({ minLength: 1 }),
        layer: Union(EDITOR_LANDSCAPE_LAYERS),
        type: Type.Optional(Type.String()),
        /** Die Art, wie das Wiki sie nennt. */
        art: Type.Optional(Type.String()),
        region: Type.Optional(Type.String()),
        kurzbeschreibung: Type.Optional(Type.String()),
        wikiUrl: Type.String({ minLength: 1 }),
    },
    strict,
);
export type EditorWikiEintrag = Static<typeof EditorWikiEintrag>;

/** Je gemeinsame Grenze ihre Linie in Karteneinheiten, wie die Karte sie zeichnet; leer, wo die Fassung gemeinsame Grenzen nicht kennt. */
export const EditorGebirgsNaehte = Type.Object(
    { kanten: Type.Array(Type.Array(Type.Array(Type.Number(), { minItems: 2, maxItems: 2 }))) },
    strict,
);
export type EditorGebirgsNaehte = Static<typeof EditorGebirgsNaehte>;

export const EditorLandscapeList = Type.Object(
    {
        rows: Type.Array(EditorLandscapeRow),
        peaks: Type.Optional(Type.Array(EditorLandscapePeakRow)),
        /** Die Landmarken-Kandidaten aus dem WikiSync (WI-0271 L7); fehlt, wo es keine gibt. */
        kandidaten: Type.Optional(Type.Array(EditorLandmarkenKandidat)),
        /** Die Wiki-Einträge ohne Fläche (WI-0284); fehlt, wo es keine gibt. */
        wikiEintraege: Type.Optional(Type.Array(EditorWikiEintrag)),
    },
    strict,
);
export type EditorLandscapeList = Static<typeof EditorLandscapeList>;

/** Eine Teilfläche, eckig wie gespeichert: je Polygon die Ringe (zuerst außen, dann Löcher), je Ring die Ecken ohne den Schlusspunkt. */
export const EditorLandscapeArea = Type.Object(
    {
        id: PublicId(),
        polygons: Type.Array(Type.Array(Type.Array(Punkt, { minItems: 3 }), { minItems: 1 }), { minItems: 1 }),
        /** Die Fläche zählt für die Wegfindung (`region_area.affects_paths`). */
        affectsPaths: Type.Boolean(),
        /** Die Fachrevision (Migration 0137, WI-0178 B1): die Basis jeder Änderung (`baseRevision`, sonst 409). */
        revision: Type.Integer({ minimum: 1 }),
        /**
         * Nur am Gebirge (WI-0178 P4): Typ und Abweichungen der Teilfläche (`terrain_control`, Vertrag WI-0226), der Anfang des Reiters
         * „Gebirge“ im EINEN Entwurf der Fläche. Vorschau, Presets und Grundhöhe liest der Reiter über `EDITOR_GEBIRGE_URL`.
         */
        gebirge: Type.Optional(EditorGebirge.properties.stand),
    },
    strict,
);
export type EditorLandscapeArea = Static<typeof EditorLandscapeArea>;

/**
 * Ein Gipfel in einem Gebirge (WI-0178 P5, Fassung 16): wie Legacy (`peaksInsideArea`) jeder aktive Gipfel, dessen Punkt in einer
 * Teilfläche liegt. Die Gipfelliste im Reiter „Gebirge“ ändert seine Höhe im Entwurf der Fläche; geschrieben wird sie gegen seine
 * Revision über denselben Weg wie im Fenster des Gipfels (`gipfelSchreiben`).
 */
export const EditorLandscapePeak = Type.Object(
    {
        id: PublicId(),
        name: Type.String(),
        /** Nur Arten mit Gelände: Die Liste liest die Sicht `terrain_peak_gelaende`. */
        subtype: Union(GELAENDE_ARTEN),
        height: Type.Optional(Type.Integer({ minimum: 0 })),
        hidden: Flag(),
        position: Punkt,
        revision: Type.Integer({ minimum: 1 }),
    },
    strict,
);
export type EditorLandscapePeak = Static<typeof EditorLandscapePeak>;

/** Eine Beschriftung der Landschaft; ihr Text ist der Name der Landschaft, außer ein abweichender aus Legacy (EDIT-0004 §4 Nr. 2). */
export const EditorLandscapeLabel = Type.Object(
    {
        id: PublicId(),
        text: Type.String(),
        x: Type.Number(),
        y: Type.Number(),
        size: Type.Optional(Type.Number()),
        priority: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })),
        zoomMin: Type.Optional(Type.Integer({ minimum: 0, maximum: 8 })),
        zoomMax: Type.Optional(Type.Integer({ minimum: 0, maximum: 8 })),
        /**
         * Die Spanne der Art (`landscape_display_art`, sonst die Grundvorgabe `*`): Sie gilt, solange die Beschriftung keine eigene als
         * Paar trägt (Sicht `map_label_effective`, 0057). `max` unter `min` heißt: Die Art zeigt den Namen nicht. Fehlt ohne Tafel.
         */
        zoomDefault: Type.Optional(
            Type.Object(
                { min: Type.Integer({ minimum: 0, maximum: 8 }), max: Type.Integer({ minimum: -1, maximum: 8 }) },
                strict,
            ),
        ),
        /** „Auf der Karte anzeigen“ (`map_label.show_name`; ohne Angabe sichtbar). */
        visible: Type.Boolean(),
        /** Die erste Beschriftung der Landschaft (`region.primary_label_id`): Ihre Größe und ihr Zoom gelten für die Kurve. */
        primary: Flag(),
        /** Die Fachrevision (Migration 0137, WI-0178 B1): die Basis jeder Änderung (`baseRevision`, sonst 409). */
        revision: Type.Integer({ minimum: 1 }),
    },
    strict,
);
export type EditorLandscapeLabel = Static<typeof EditorLandscapeLabel>;

/** Eine Landschaft derselben Ebene, mit der diese Ecken teilt (gemeinsame Ecken ziehen mit, B4). */
export const EditorLandscapeNeighbor = Type.Object(
    {
        id: PublicId(),
        name: Type.String(),
        sharedCorners: Type.Integer({ minimum: 1 }),
    },
    strict,
);
export type EditorLandscapeNeighbor = Static<typeof EditorLandscapeNeighbor>;

export const EditorLandscapeDetail = Type.Object(
    {
        id: PublicId(),
        name: Type.String(),
        layer: Union(EDITOR_LANDSCAPE_LAYERS),
        type: Type.Optional(Type.String()),
        circle: Union(EDITOR_LANDSCAPE_CIRCLES),
        wiki: Type.Optional(
            Type.Object(
                {
                    url: Type.String({ minLength: 1 }),
                    title: Type.Optional(Type.String()),
                    key: Type.Optional(Type.String()),
                },
                strict,
            ),
        ),
        order: Type.Integer(),
        /** Für Besucher verborgen (T41): keine Fläche, kein Name, nicht in Suche und Infopanel; Editoren sehen sie schraffiert. */
        hidden: Flag(),
        /** Die Gefahrenlage (WI-0308): die Gefahrenarten in der Folge des Katalogs; fehlt bei „ungefährlich“ (keine Art). */
        hazards: Type.Optional(Gefahren()),
        /** Der Platz in der Ebene (WI-0178 D1): `n` von `of`; 1 liegt ganz vorn (der höchste Rang, `stack_order`). */
        place: Type.Optional(
            Type.Object({ n: Type.Integer({ minimum: 1 }), of: Type.Integer({ minimum: 1 }) }, strict),
        ),
        clickLocked: Type.Boolean(),
        /** Die Kurve: an, mit wie vielen Läufen (1 bis 3); fehlt, solange Legacy nichts gesagt hat. */
        curve: Type.Optional(
            Type.Object(
                { enabled: Type.Boolean(), max: Type.Optional(Type.Integer({ minimum: 1, maximum: 3 })) },
                strict,
            ),
        ),
        areas: Type.Array(EditorLandscapeArea),
        labels: Type.Array(EditorLandscapeLabel),
        neighbors: Type.Array(EditorLandscapeNeighbor),
        /** Nur am Gebirge (P5): die Gipfel in seinen Teilflächen, der höchste zuerst. */
        peaks: Type.Optional(Type.Array(EditorLandscapePeak)),
        source: Type.Optional(Type.String()),
        /**
         * Still (D2, T54): von der Karte genommen oder gelöscht; das Fenster liest dann nur, ↺ im Verlauf holt sie zurück. Teilflächen und
         * Beschriftungen sind die, die mit ihr still wurden.
         */
        state: Type.Optional(Union(EDITOR_LANDSCAPE_STATES)),
        /** Die Fachrevision (Migration 0137, WI-0178 B1): die Basis jeder Änderung (`baseRevision`, sonst 409). */
        revision: Type.Integer({ minimum: 1 }),
    },
    strict,
);
export type EditorLandscapeDetail = Static<typeof EditorLandscapeDetail>;

/**
 * Die Andockziele um eine Landschaft im Modus „Ecken bearbeiten“ (WI-0178 C1; EDIT-0004 §2.3), geholt beim Start und nach jeder
 * Quittung, nie während der Geste (Recht `edit_map_geometry`):
 *
 * - `neighbors`: die Teilflächen anderer Landschaften DERSELBEN Ebene, die mit dieser mindestens eine Ecke koordinatengleich teilen,
 *   ganz und mit Revision: Ihre gemeinsamen Ecken ziehen mit (B4), und gespeichert wird gegen ihre Revision.
 * - `edges`: Kanten anderer Teilflächen in den sichtbaren Ebenen (`?layers=`, Vorgabe alle drei) im Kasten der Landschaft plus
 *   `margin`, als Strecken; ihre Enden sind die Ecken. Ohne die eigene Landschaft und ohne die Nachbarn (die stehen ganz da).
 * - `riverPoints`: die Stützpunkte der Flusswege im Kasten (Ziel `ecke`, FL8: an Flüssen ja, an Straßen und Pfaden nein).
 */
export const editorLandscapeTargetsUrl = (id: string): string => `${EDITOR_LANDSCAPES_URL}/${id}/targets`;

/** So weit um den Kasten der Landschaft holt der Modus die Andockziele, in Karteneinheiten (wie beim Weg). */
export const LANDSCAPE_TARGET_MARGIN = 15;

export const EditorLandscapeTargetNeighbor = Type.Object(
    {
        /** Die Teilfläche (`region_area.public_id`). */
        id: PublicId(),
        regionId: PublicId(),
        name: Type.String(),
        revision: Type.Integer({ minimum: 1 }),
        polygons: Type.Array(Type.Array(Type.Array(Punkt, { minItems: 3 }), { minItems: 1 }), { minItems: 1 }),
    },
    strict,
);
export type EditorLandscapeTargetNeighbor = Static<typeof EditorLandscapeTargetNeighbor>;

export const EditorLandscapeTargetEdge = Type.Object(
    {
        areaId: PublicId(),
        name: Type.String(),
        /** Anfang und Ende der Strecke. */
        a: Punkt,
        b: Punkt,
    },
    strict,
);
export type EditorLandscapeTargetEdge = Static<typeof EditorLandscapeTargetEdge>;

export const EditorLandscapeTargetRiverPoint = Type.Object(
    { pathId: PublicId(), name: Type.String(), x: Type.Number(), y: Type.Number() },
    strict,
);
export type EditorLandscapeTargetRiverPoint = Static<typeof EditorLandscapeTargetRiverPoint>;

export const EditorLandscapeTargets = Type.Object(
    {
        margin: Type.Number(),
        neighbors: Type.Array(EditorLandscapeTargetNeighbor),
        edges: Type.Array(EditorLandscapeTargetEdge),
        riverPoints: Type.Array(EditorLandscapeTargetRiverPoint),
    },
    strict,
);
export type EditorLandscapeTargets = Static<typeof EditorLandscapeTargets>;

/**
 * Die Andockziele im Kasten für „Neue Fläche“ (WI-0178 T47, C3; `GET /api/editor/landscapes/targets`, Recht `edit_map_geometry`): die
 * Kanten aller Teilflächen DERSELBEN Ebene und die Stützpunkte der Flüsse, in derselben Form wie die Ziele um eine Landschaft
 * (`neighbors` leer, `margin` 0). Eine Seite länger als `LANDSCAPE_TARGETS_MAX_SIDE` wird auf ihre Mitte gekürzt (wie beim Weg).
 */
export const EDITOR_LANDSCAPE_BOX_TARGETS_URL = `${EDITOR_LANDSCAPES_URL}/targets`;
export const LANDSCAPE_TARGETS_MAX_SIDE = 160;
export const LandscapeBoxTargetsQuery = Type.Object(
    {
        layer: Union(EDITOR_LANDSCAPE_LAYERS),
        x0: Type.Number(),
        y0: Type.Number(),
        x1: Type.Number(),
        y1: Type.Number(),
    },
    strict,
);
export type LandscapeBoxTargetsQuery = Static<typeof LandscapeBoxTargetsQuery>;

/**
 * Eine Teilfläche in `landscape.update` (WI-0178 C2, seit B2 dort, `areas`): eckig wie gespeichert (Ringe ohne Schlusspunkt), gegen
 * ihre Revision; dazu die Teilflächen der Nachbarn, deren gemeinsame Ecken mitgezogen sind (an ihnen darf sich nur bewegen, was auf
 * einer Ecke dieser Landschaft lag und auf eine ihrer neuen Ecken geht).
 */
/** So viele Teilflächen trägt eine Operation höchstens (eigene und mitgezogene). */
export const LANDSCAPE_RESHAPE_AREAS_MAX = 64;

export const LandscapeReshapeArea = Type.Object(
    {
        id: PublicId(),
        baseRevision: Type.Integer({ minimum: 1 }),
        polygons: Type.Array(Type.Array(Type.Array(Punkt, { minItems: 3 }), { minItems: 1 }), { minItems: 1 }),
    },
    strict,
);
export type LandscapeReshapeArea = Static<typeof LandscapeReshapeArea>;

/**
 * „Fertig“ im Landschaftseditor (WI-0178 B2; O3, EDIT-0003 T27 (4), G5): `landscape.update`, Felder der Landschaft, ihre Beschriftungen
 * und ihre Form als EINE Operation, `PATCH /api/editor/landscapes/:id`. Jedes Objekt gegen seine eigene Revision (G5 „Revision je
 * Objekt“, Orchestrierung 2026-10-17): die Landschaft (`baseRevision`, Pflicht, sobald `changes` etwas trägt) nur für ihre Felder, je
 * Beschriftung ihre, je Teilfläche ihre wie bei `area.reshape` (`areas`, mitgezogene Nachbarn dabei). Ein Konflikt an einem der Objekte
 * nimmt alles zurück (409 `edit_conflict`); hält ein anderer eine der Landschaften, 409 `object_locked`; läuft der Zug, 503.
 * Rechte: `edit_map_objects`, mit `areas` dazu `edit_map_geometry`.
 *
 * 🪤 Keine `null` in den Feldern: Fastifys ajv machte aus `null` in einer Vereinigung mit einer Zahl still eine 0. Zurücksetzen auf die
 * Vorgabe kommt mit einem eigenen Handgriff.
 */
export const editorLandscapeUrl = (id: string): string => `${EDITOR_LANDSCAPES_URL}/${id}`;

/**
 * Der Verlauf einer Fläche (WI-0178 D3; gemeinsamer Verlauf `apps/web/src/fenster/entwurf-verlauf.ts`): jede Operation, die sie, eine
 * ihrer Teilflächen oder Beschriftungen berührte, neueste zuerst (`MapHistoryPage`, seitenweise über `before`). Recht `use_editor_menu`.
 */
export const editorLandscapeHistoryUrl = (id: string): string => `${EDITOR_LANDSCAPES_URL}/${id}/history`;

/** So lang darf der Name einer Landschaft werden. */
export const LANDSCAPE_NAME_MAX = 120;
/** So viele Beschriftungen trägt eine Operation höchstens. */
export const LANDSCAPE_UPDATE_LABELS_MAX = 64;

/**
 * Die Arten, die eine Landschaft dieser Ebene im Editor bekommen kann: die der Kartografie-Tafel. Auch Meer, See, Insel und Kontinent
 * (EDIT-0003 T50 (a), Betreiber 2026-10-17: „Sollen wählbar sein, aber es muss der hinweis kommen, dass irgendwas neu gerechnet werden
 * muss“); was neu gerechnet werden muss, sagt das Fenster.
 */
export function landscapeTypesOfLayer(layer: EditorLandscapeLayer): string[] {
    return cartographyTypesOfLayer(layer).map((eintrag) => eintrag.type);
}

/**
 * Der Rahmen des Geländes (EDIT-0003 T50, Festlegung der Editor-Orchestrierung 2026-10-17): Das Höhenmodell erwartet genau eine Fläche
 * `derographisch`/`kontinent` mit dem Namen „Aventurien“ (`apps/server/src/terrain/domain/inputs.ts`); ändern sich Name, Ebene oder
 * Art, bricht der nächste Geländelauf ab. Bei dieser Landschaft bleiben die drei, bis das Gelände den Rahmen anders findet.
 */
export function isTerrainFrame(landscape: {
    readonly name: string;
    readonly layer: string;
    readonly type?: string | null | undefined;
}): boolean {
    return landscape.layer === "derographisch" && landscape.type === "kontinent" && landscape.name === "Aventurien";
}

/** Gehört die Art zur Ebene (Kartografie-Tafel)? */
export function landscapeTypeFits(layer: EditorLandscapeLayer, type: string): boolean {
    return AVENTURIA_CARTOGRAPHY.types[type]?.layer === layer;
}

/**
 * Die Felder der Landschaft. Ebene und Art (Betreiber 2026-10-17, EDIT-0003 T50): Eine neue Ebene kommt immer mit einer Art aus ihr;
 * die Art allein muss zur Ebene passen. Die Beschriftungen, deren Namensart der alten Art folgte (`map_label.subtype`), bekommen im
 * selben Schreiben die neue, und in einer neuen Ebene steht die Landschaft oben.
 */
export const LandscapeFieldChanges = Type.Object(
    {
        name: Type.Optional(Type.String({ minLength: 1, maxLength: LANDSCAPE_NAME_MAX })),
        layer: Type.Optional(Union(EDITOR_LANDSCAPE_LAYERS)),
        type: Type.Optional(Type.String({ pattern: "^[a-z_]{1,32}$" })),
        /** Für Klicks gesperrt (`region.is_locked`, Legacys dauerhafte Klicksperre). */
        locked: Type.Optional(Type.Boolean()),
        /**
         * Für Besucher verborgen (WI-0178 T41, `region.is_hidden`, Migration 0166; Wörter wie am Ort: „Verbergen“, „Zurückholen“). Geht
         * in keine Ableitung ein (Claudio 2026-10-18): Verbergen allein löst keinen Folgeauftrag aus, nur die Kachelrevision.
         */
        hidden: Type.Optional(Type.Boolean()),
        /**
         * Die Gefahrenlage (WI-0308): die ganze neue Auswahl, leer für „ungefährlich“; der Server legt sie in die Folge des Katalogs. Nur in
         * Derographie, Vegetation und Topographie wirksam (`gefahrWirkt`); eine Landschaft in einer anderen Ebene führt der Editor nicht.
         */
        hazards: Type.Optional(Gefahren()),
        /**
         * Ganz nach vorn oder ganz nach hinten in der Ebene (WI-0178 D1; Legacys `set_region_stack`, 19.08.2026): über den höchsten
         * bzw. unter den niedrigsten Rang der Ebene. Nur diese zwei Bewegungen, beide „ganz“; die anderen Landschaften bleiben, wo sie
         * sind. Mit einer neuen Ebene gilt sie dort (ohne sie steht die Landschaft dort vorn).
         */
        order: Type.Optional(Union(["front", "back"] as const)),
        /**
         * Die Beschriftung als Punkt oder entlang der Fläche, je Landschaft eine Art (F7; `region.label_curve_enabled`), und wie oft der
         * Name dann höchstens auf der Kurve steht (`label_curve_max`, 1 bis 3). Schreibt immer an oder aus: NULL heißt „nicht migriert“.
         */
        curve: Type.Optional(
            Type.Object(
                { enabled: Type.Boolean(), max: Type.Optional(Type.Integer({ minimum: 1, maximum: 3 })) },
                strict,
            ),
        ),
    },
    strict,
);
export type LandscapeFieldChanges = Static<typeof LandscapeFieldChanges>;

/**
 * Was sich an einer Beschriftung ändert (Grenzen wie die Spalten von `map_label`, 0010). Die eigene Spanne geht als Paar (`zoomMin` UND
 * `zoomMax`): Nur so wirkt sie (Sicht `map_label_effective`, 0057); dass sie der Spanne der Art vorgeht, ist WI-0221 F2. `zoomReset`
 * (↺ „Vorgabe der Art“) nimmt beide weg.
 */
export const LandscapeLabelChanges = Type.Object(
    {
        size: Type.Optional(Type.Number({ minimum: 4, maximum: 60 })),
        priority: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })),
        zoomMin: Type.Optional(Type.Integer({ minimum: 0, maximum: 8 })),
        zoomMax: Type.Optional(Type.Integer({ minimum: 0, maximum: 8 })),
        /** „Auf der Karte anzeigen“ (`map_label.show_name`). */
        visible: Type.Optional(Type.Boolean()),
        /** ↺ „Namen übernehmen“ (FL3): Ein abweichender Text aus Legacy folgt wieder dem Namen der Landschaft. */
        followName: Type.Optional(Type.Literal(true)),
        /** ↺ „Vorgabe der Art“: Die eigene Spanne fällt weg (`label_min_zoom` und `label_max_zoom` leer), es gilt die der Art. */
        zoomReset: Type.Optional(Type.Literal(true)),
        /**
         * Die Lage der Beschriftung „an einem Punkt“ in Karteneinheiten (WI-0178 C4, EDIT-0004 §2.5: auf der Karte gezogen wie der Ort);
         * innerhalb der Karte (`map_label_inside_domain`).
         */
        position: Type.Optional(Punkt),
    },
    strict,
);
export type LandscapeLabelChanges = Static<typeof LandscapeLabelChanges>;

export const LandscapeLabelUpdate = Type.Object(
    { id: PublicId(), baseRevision: Type.Integer({ minimum: 1 }), changes: LandscapeLabelChanges },
    strict,
);
export type LandscapeLabelUpdate = Static<typeof LandscapeLabelUpdate>;

/**
 * Eine Änderung am Gebirge (WI-0178 P4; Vertrag WI-0226, `GebirgsAenderung`): Die Gebirgswerte hängen an der Teilfläche
 * (`terrain_control`), darum je Teilfläche eine Zeile. Geschrieben über `gebirgSchreiben` in derselben Operation wie die Felder; ↺ steht
 * in `zurueck`, nie als `null` im Feld (Fastifys ajv macht daraus still eine 0).
 */
export const LandscapeGebirgeUpdate = Type.Object({ area: PublicId(), changes: GebirgsAenderung }, strict);
export type LandscapeGebirgeUpdate = Static<typeof LandscapeGebirgeUpdate>;

/** Die Höhe eines Gipfels aus der Gipfelliste des Gebirges (P5): gegen seine Revision, nur Gipfel in dieser Fläche. */
export const LandscapePeakUpdate = Type.Object(
    {
        id: PublicId(),
        baseRevision: Type.Integer({ minimum: 1 }),
        height: Type.Integer({ minimum: 0, maximum: PEAK_HEIGHT_MAX }),
    },
    strict,
);
export type LandscapePeakUpdate = Static<typeof LandscapePeakUpdate>;

export const LandscapeUpdateBody = Type.Object(
    {
        operationId: OperationId,
        baseRevision: Type.Optional(Type.Integer({ minimum: 1 })),
        changes: Type.Optional(LandscapeFieldChanges),
        labels: Type.Optional(Type.Array(LandscapeLabelUpdate, { maxItems: LANDSCAPE_UPDATE_LABELS_MAX })),
        areas: Type.Optional(Type.Array(LandscapeReshapeArea, { maxItems: LANDSCAPE_RESHAPE_AREAS_MAX })),
        gebirge: Type.Optional(Type.Array(LandscapeGebirgeUpdate, { maxItems: LANDSCAPE_RESHAPE_AREAS_MAX })),
        peaks: Type.Optional(Type.Array(LandscapePeakUpdate, { maxItems: LANDSCAPE_UPDATE_LABELS_MAX })),
    },
    strict,
);
export type LandscapeUpdateBody = Static<typeof LandscapeUpdateBody>;

export const LandscapeUpdateReceipt = OperationReceipt;
export type LandscapeUpdateReceipt = Static<typeof LandscapeUpdateReceipt>;

/**
 * „Fläche entfernen …“ (WI-0178 D2; EDIT-0004 §2.6, FL6; EDIT-0003 T43, T54; Claudio 2026-10-18): EIN Blatt mit zwei Stufen wie am Ort und
 * an Wegen. `off_map` nimmt die Fläche von der Karte (`region.off_map`, Migration 0163; sie steht danach unter „Nicht auf der Karte“),
 * `retire` löscht sie weich. Beides legt in derselben Operation ihre Teilflächen und Beschriftungen still; das Protokoll hält jede
 * Zeile. Endet eine Kraftlinie an einer ihrer Beschriftungen, 409 `powerline_endpoint` (wie am Kraftlinienpunkt, T52). Der Kontinent
 * „Aventurien“ bleibt (400). Rechte `edit_map_objects` und `edit_map_geometry`.
 */
export const editorLandscapeRetireUrl = (id: string): string => `${EDITOR_LANDSCAPES_URL}/${id}/retire`;

export const LANDSCAPE_RETIRE_STAGES = ["off_map", "retire"] as const;

/**
 * Die verborgenen Landschaften für Editoren (T41; Claudio 2026-10-18: keine zweite volle Kachelquelle, eine kleine Zusatzschicht über die
 * App, `private, no-store`): je Landschaft ihre aktiven Teilflächen in Karteneinheiten, die Karte zeichnet sie schraffiert in der Farbe
 * ihrer Art mit durchgestrichenem Auge. Recht `use_editor_menu`.
 */
export const EDITOR_LANDSCAPES_HIDDEN_URL = `${EDITOR_LANDSCAPES_URL}/hidden`;

export const EditorHiddenLandscape = Type.Object(
    {
        id: PublicId(),
        name: Type.String(),
        layer: Union(EDITOR_LANDSCAPE_LAYERS),
        type: Type.Optional(Type.String()),
        /** Je Teilfläche ihre Polygone, die Ringe ohne doppelten Schlusspunkt (wie im Detail). */
        polygons: Type.Array(Type.Array(Type.Array(Punkt))),
        /** Wo das Auge steht: die erste Beschriftung, sonst ein Punkt in der größten Teilfläche. */
        at: Type.Optional(Punkt),
    },
    strict,
);
export type EditorHiddenLandscape = Static<typeof EditorHiddenLandscape>;
export const EditorHiddenLandscapes = Type.Object({ rows: Type.Array(EditorHiddenLandscape) }, strict);
export type EditorHiddenLandscapes = Static<typeof EditorHiddenLandscapes>;

export const LandscapeRetireBody = Type.Object(
    { operationId: OperationId, baseRevision: Type.Integer({ minimum: 1 }), stage: Union(LANDSCAPE_RETIRE_STAGES) },
    strict,
);
export type LandscapeRetireBody = Static<typeof LandscapeRetireBody>;

/**
 * Die Mehrfachauswahl der Derographie (EDIT-0003 T57, Betreiber 2026-10-19 zu Fassung 5 der Gebiete: „perfekt genau das wollen wir“):
 * gemeinsam sind Ebene, Art und „Verbergen“, dazu „Entfernen …“. Name und alle Formmodi gehen nur einzeln. Je EINE Operation für alle
 * gewählten Landschaften, ↺ im Verlauf nimmt sie zusammen zurück. Revisionen gibt es keine je Landschaft: Die Auswahl ist flüchtig, der
 * Server schreibt gegen den Stand beim Schreiben (Sperren anderer prüft er wie immer).
 *
 * Gipfel und Vulkane stehen als Zeilen in derselben Liste (P3) und gehen mit (`peaks`, Stage-Fund 2026-10-19): gemeinsam ist mit ihnen
 * nur „Besucher“ (`hidden`, beim Gipfel „Auf der Karte anzeigen“ aus); Ebene und Art tragen Gipfel nicht, entfernen lassen sie sich nicht.
 */
/**
 * Wie viele Landschaften (und je ebenso viele Gipfel) EINE Operation der Mehrfachauswahl trägt: alle Zeilen der Stage (6.613 mit Gipfeln)
 * mit Luft. Bis 2026-10-20 standen hier 500, und darüber schlugen Sammel-Ändern und -Entfernen still fehl (Fund der Gebiete, 55b7d2280).
 * Gemessen als App-Rolle im Wegwerf-Cluster über 6.100 Landschaften (`landscape-sammel-gross.test.ts`): Verbergen 5,2 s, ↺ 10,5 s;
 * Entfernen 14 s, ↺ 13 s; Halde höchstens 52 MB. Darüber nennt das Fenster den Grund (`landschaft-mehrfach.vue`).
 */
export const LANDSCAPE_BATCH_MAX = 8192;
/** `landscape.batch`: die gemeinsamen Felder für alle. Eine neue Ebene kommt mit einer Art aus ihr (wie bei einer Landschaft). */
export const editorLandscapesBatchUrl = `${EDITOR_LANDSCAPES_URL}/batch`;
export const LandscapeBatchBody = Type.Object(
    {
        operationId: OperationId,
        /** Die Landschaften; leer, wenn nur Gipfel gewählt sind. */
        ids: Type.Array(PublicId(), { maxItems: LANDSCAPE_BATCH_MAX, uniqueItems: true }),
        /** Die Gipfel und Vulkane der Auswahl; mit ihnen geht nur `hidden`. */
        peaks: Type.Optional(Type.Array(PublicId(), { minItems: 1, maxItems: LANDSCAPE_BATCH_MAX, uniqueItems: true })),
        changes: Type.Object(
            {
                layer: Type.Optional(Union(EDITOR_LANDSCAPE_LAYERS)),
                type: Type.Optional(Type.String({ pattern: "^[a-z_]{1,32}$" })),
                hidden: Type.Optional(Type.Boolean()),
            },
            strict,
        ),
    },
    strict,
);
export type LandscapeBatchBody = Static<typeof LandscapeBatchBody>;
/** „Entfernen …“ für alle gewählten: `landscape.retire` über mehrere Landschaften, ↺ wie bei einer. */
export const editorLandscapesBatchRetireUrl = `${EDITOR_LANDSCAPES_URL}/batch-retire`;
export const LandscapeBatchRetireBody = Type.Object(
    {
        operationId: OperationId,
        /** Die Landschaften; leer, wenn nur Gipfel gewählt sind. */
        ids: Type.Array(PublicId(), { maxItems: LANDSCAPE_BATCH_MAX, uniqueItems: true }),
        /** Die Gipfel der Auswahl: Sie werden gelöscht (weich), `stage` gilt für die Landschaften. */
        peaks: Type.Optional(Type.Array(PublicId(), { minItems: 1, maxItems: LANDSCAPE_BATCH_MAX, uniqueItems: true })),
        stage: Union(LANDSCAPE_RETIRE_STAGES),
    },
    strict,
);
export type LandscapeBatchRetireBody = Static<typeof LandscapeBatchRetireBody>;

/**
 * „Neue Fläche“ (WI-0178 T47, gemeinsamer Ablauf C3 `apps/web/src/map/geometrie/neue-flaeche.ts`): `landscape.create`, `POST
 * /api/editor/landscapes`, eine Fläche samt erster Teilfläche als EINE Operation. Wie Legacy (`saveEcosystemAreaRing`,
 * `avesmapsCreateEcosystemRegion`, Mirror a7f2dac8): der Griff „Fläche-001“ (die nächste freie Nummer), noch ohne Art und ohne
 * Beschriftung (Owner 26.08.2026: „zeichnen -> Name und Art vergeben -> Beschriftung anlegen“), ganz vorn in ihrer Ebene; danach geht
 * ihr Fenster auf. Der Ring kommt eckig, mit oder ohne Schlusspunkt; ein Ring, der sich selbst kreuzt, wird wie in Legacy repariert.
 * Rechte: `edit_map_objects` und `edit_map_geometry`.
 */
export const LANDSCAPE_CREATE_HANDLE = "Fläche";
/** Stellen der laufenden Nummer im Griff (Legacy `ECOSYSTEM_AUTO_NAME_DIGITS`); gelesen wird jede Zahl. */
export const LANDSCAPE_CREATE_DIGITS = 3;
/** So viele Ecken trägt eine neue Fläche höchstens. */
export const LANDSCAPE_CREATE_POINTS_MAX = 4000;

export const LandscapeCreateBody = Type.Object(
    {
        operationId: OperationId,
        layer: Union(EDITOR_LANDSCAPE_LAYERS),
        ring: Type.Array(Punkt, { minItems: 3, maxItems: LANDSCAPE_CREATE_POINTS_MAX }),
        /** Die Fläche entsteht für diesen Wiki-Eintrag (WI-0284): Sie heißt wie er, trägt seine Flächenart und hängt an seinem Artikel. */
        wikiEintrag: Type.Optional(PublicId()),
    },
    strict,
);
export type LandscapeCreateBody = Static<typeof LandscapeCreateBody>;

/** Die Quittung: die gewöhnliche, dazu die neue Fläche (ihr Fenster geht auf, der Name markiert). */
export const LandscapeCreateReceipt = Type.Object(
    { ...OperationReceipt.properties, publicId: Type.String(), name: Type.String() },
    strict,
);
export type LandscapeCreateReceipt = Static<typeof LandscapeCreateReceipt>;

/** Der Kreis einer Landschaft aus ihren zwei Hälften: links das Wiki, rechts die Karte (EDIT-0003 T26 (5)). */
export function editorLandscapeCircle(placed: boolean, wiki: boolean): EditorLandscapeCircle {
    if (placed) return wiki ? "voll" : "halb-rechts";
    return wiki ? "halb" : "leer";
}

/**
 * Beschriftungen einer Landschaft anlegen, duplizieren und löschen (WI-0232, Werkzeug 2 des Werkzeugplans der Derographie; Thomas 4.1):
 * je EINE Sofort-Operation gegen die Revision der Landschaft, wie „Gipfel setzen“ (Server `apps/server/src/editor/landscape-labels.ts`).
 * „Position zurücksetzen“ geht über den Entwurf (`labels[].changes.position`, Punkt aus `beschriftung-punkt.ts`).
 * - `label.create` (`POST …/:id/labels`): Text und Art von der Landschaft (FL3), an einem Punkt; ohne `position` ein Punkt in der Fläche.
 *   Mit `from` ein Duplikat mit Größe, Rang, eigener Spanne und Sichtbarkeit des Originals. An einer Landschaft „entlang der Fläche“ 400 (F7).
 * - `label.retire` (`POST …/:id/labels/:labelId/retire`): legt still. Die letzte Beschriftung nicht: 409 `last_label`, sie nimmt die
 *   Landschaft mit, über „Fläche entfernen …“ (`landscape.retire`; Betreiber 2026-07-28 in Legacy, Editor-Orchestrierung 2026-10-19 „B“).
 * - ↺ im Verlauf: das Gegenstück mit `reverts` (`label.retire` nimmt ein `label.create` zurück, `label.create` holt ein `label.retire`
 *   zurück), wenn die Beschriftung noch so steht, wie die Operation sie hinterließ.
 */
export const editorLandscapeLabelsUrl = (id: string): string => `${EDITOR_LANDSCAPES_URL}/${id}/labels`;
export const editorLandscapeLabelRetireUrl = (id: string, labelId: string): string =>
    `${EDITOR_LANDSCAPES_URL}/${id}/labels/${labelId}/retire`;

export const LandscapeLabelCreateBody = Type.Object(
    {
        operationId: OperationId,
        /** Die Revision der Landschaft. */
        baseRevision: Type.Integer({ minimum: 1 }),
        /** Die Lage in Karteneinheiten (an der Stelle des Menüs; beim Duplizieren versetzt), in der Karte. */
        position: Type.Optional(Punkt),
        /** Duplizieren: die Beschriftung derselben Landschaft, deren Werte die neue übernimmt. */
        from: Type.Optional(PublicId()),
        /** ↺ eines `label.retire`: holt genau diese Beschriftung zurück (ohne `position` und `from`). */
        reverts: Type.Optional(PublicId()),
    },
    strict,
);
export type LandscapeLabelCreateBody = Static<typeof LandscapeLabelCreateBody>;

/** Die Quittung: die gewöhnliche, dazu die Kennung der neuen (oder zurückgeholten) Beschriftung. */
export const LandscapeLabelCreateReceipt = Type.Object(
    { ...OperationReceipt.properties, publicId: Type.String() },
    strict,
);
export type LandscapeLabelCreateReceipt = Static<typeof LandscapeLabelCreateReceipt>;

export const LandscapeLabelRetireBody = Type.Object(
    {
        operationId: OperationId,
        /** Die Revision der Landschaft. */
        baseRevision: Type.Integer({ minimum: 1 }),
        /** Die Revision der Beschriftung. */
        labelRevision: Type.Integer({ minimum: 1 }),
        /** ↺ eines `label.create`: nimmt diese Beschriftung zurück, auch die letzte (der Stand davor). */
        reverts: Type.Optional(PublicId()),
    },
    strict,
);
export type LandscapeLabelRetireBody = Static<typeof LandscapeLabelRetireBody>;

/**
 * „Mit anderer Fläche ›“ (Werkzeug 1 im Plan der Editor-Orchestrierung 2026-10-19, Thomas 4.1; Legacy `TARGET_OPERATIONS`, Mirror
 * 5ff58118 `map-features-ecosystem-geometry-ops.js#L49-L55`, `map-features-ecosystem-boolean.js`): Die Teilfläche der Landschaft, an der
 * das Menü steht, bekommt die neue Form. „vereinigen“ (∪) und „ausschneiden“ (Quelle ohne Ziel) nehmen die andere Teilfläche von der
 * Karte; „… behalten“ (Legacy „… und andere beibehalten“, die andere als Schablone, sinnvoll zwischen zwei Ebenen) und „schnittmenge“
 * (Menü „Neue von anderer ausschneiden …“, ∩) lassen sie stehen. Geschrieben wird sofort als EINE Operation, ↺ im Verlauf holt beides
 * zurück (Editor-Orchestrierung 2026-10-19: Ausnahme von EDIT-0003 G4 wie „Verbergen“).
 */
export const LANDSCAPE_BOOLEAN_OPERATIONS = [
    "vereinigen",
    "vereinigen-behalten",
    "ausschneiden",
    "ausschneiden-behalten",
    "schnittmenge",
] as const;
export type LandscapeBooleanOperation = (typeof LANDSCAPE_BOOLEAN_OPERATIONS)[number];

/** Nimmt die Operation die andere Teilfläche von der Karte? (Legacy `ecosystemBooleanConsumesTarget`) */
export function landscapeBooleanConsumesTarget(operation: LandscapeBooleanOperation): boolean {
    return operation === "vereinigen" || operation === "ausschneiden";
}

/** `POST /api/editor/landscapes/:id/boolean-preview`: rechnet, schreibt nichts. */
export const editorLandscapeBooleanPreviewUrl = (id: string): string =>
    `${EDITOR_LANDSCAPES_URL}/${id}/boolean-preview`;
export const LandscapeBooleanPreviewBody = Type.Object(
    { operation: Union(LANDSCAPE_BOOLEAN_OPERATIONS), areaId: PublicId(), targetAreaId: PublicId() },
    strict,
);
export type LandscapeBooleanPreviewBody = Static<typeof LandscapeBooleanPreviewBody>;

/** Das Ergebnis für die Quelle: je Polygon die Ringe (außen, dann Löcher), eckig, ohne Schlusspunkt. */
export const LandscapeBooleanPreview = Type.Object(
    {
        polygons: Type.Array(Type.Array(Type.Array(Punkt))),
        /** Die andere Teilfläche, wie sie gespeichert ist (gelb umrissen, solange gewählt wird). */
        targetPolygons: Type.Array(Type.Array(Type.Array(Punkt))),
        /** Die Revisionen beider, gegen die dann geschrieben wird (`LandscapeBooleanBody`). */
        areaRevision: Type.Integer({ minimum: 1 }),
        targetAreaRevision: Type.Integer({ minimum: 1 }),
        /** Name der anderen Landschaft (für die Leiste und den Satz „… geht mit“). */
        targetName: Type.String(),
        consumesTarget: Type.Boolean(),
        /** Die andere Teilfläche ist die letzte ihrer Landschaft: Mit ihr geht die ganze Landschaft samt Beschriftungen. */
        targetLandscapeGoes: Type.Boolean(),
    },
    strict,
);
export type LandscapeBooleanPreview = Static<typeof LandscapeBooleanPreview>;

/** `POST /api/editor/landscapes/:id/boolean`: `landscape.boolean`, gegen die Revisionen beider Teilflächen. */
export const editorLandscapeBooleanUrl = (id: string): string => `${EDITOR_LANDSCAPES_URL}/${id}/boolean`;
export const LandscapeBooleanBody = Type.Object(
    {
        operationId: OperationId,
        operation: Union(LANDSCAPE_BOOLEAN_OPERATIONS),
        areaId: PublicId(),
        baseRevision: Type.Integer({ minimum: 1 }),
        targetAreaId: PublicId(),
        targetBaseRevision: Type.Integer({ minimum: 1 }),
    },
    strict,
);
export type LandscapeBooleanBody = Static<typeof LandscapeBooleanBody>;

/**
 * „Unterflächen ›“ (Werkzeug 3 im Plan der Editor-Orchestrierung 2026-10-19, Thomas 4.1; Legacy Mirror 5ff58118
 * `map-features-ecosystem-geometry-ops.js#L580-L760`, `map-features-ecosystem-boolean.js#L270-L310`): Eine Unterfläche ist ein Polygon
 * der Teilfläche, an der das Menü steht (die Teile einer Fläche aus mehreren Stücken). „vereinigen“ verschmilzt alle Teile, die sich
 * berühren; „herausloesen“ macht den gewählten Teil zu einer neuen Landschaft gleicher Ebene und Art; „loeschen“ nimmt ihn weg, ohne
 * Rückfrage. Alle drei erst ab zwei Teilen. Geschrieben wird sofort als EINE Operation `landscape.parts`, ↺ im Verlauf holt sie zurück
 * (Ausnahme von EDIT-0003 G4 wie „Mit anderer Fläche“).
 */
export const LANDSCAPE_PARTS_OPERATIONS = ["vereinigen", "herausloesen", "loeschen"] as const;
export type LandscapePartsOperation = (typeof LANDSCAPE_PARTS_OPERATIONS)[number];

/** `POST /api/editor/landscapes/:id/parts`: `landscape.parts`, gegen die Revision der Teilfläche. */
export const editorLandscapePartsUrl = (id: string): string => `${EDITOR_LANDSCAPES_URL}/${id}/parts`;
export const LandscapePartsBody = Type.Object(
    {
        operationId: OperationId,
        operation: Union(LANDSCAPE_PARTS_OPERATIONS),
        areaId: PublicId(),
        baseRevision: Type.Integer({ minimum: 1 }),
        /** Der Teil (ab 0, in der Folge der Polygone der Teilfläche); nur beim Herauslösen und Löschen. */
        part: Type.Optional(Type.Integer({ minimum: 0 })),
    },
    strict,
);
export type LandscapePartsBody = Static<typeof LandscapePartsBody>;

/** Die Quittung: die gewöhnliche, dazu die Zahl der Teile vorher und nachher und beim Herauslösen die neue Landschaft. */
export const LandscapePartsReceipt = Type.Object(
    {
        ...OperationReceipt.properties,
        partsBefore: Type.Optional(Type.Integer({ minimum: 0 })),
        partsAfter: Type.Optional(Type.Integer({ minimum: 0 })),
        publicId: Type.Optional(Type.String()),
        name: Type.Optional(Type.String()),
    },
    strict,
);
export type LandscapePartsReceipt = Static<typeof LandscapePartsReceipt>;

/**
 * „Zerschneiden“ (Werkzeug 5, Betreiber 2026-10-19 wörtlich: „gern aus zwei oder mehr punkten. ja aber in legacy war noch ein random
 * abstand dazwischen, hier soll ein schnitt exakt sein und in zwei flächen teilen und trennen. die schnittlinie soll nicht fortgeführt
 * werden - nur zwischen den punkten wo geschnitten wurde sollen kanten enstehen“): Die Schnittlinie aus zwei oder mehr Punkten teilt
 * die Teilfläche exakt, beide Stücke teilen die Schnittkante; das größte Stück jedes geschnittenen Teils bleibt, die übrigen werden
 * EINE neue Landschaft mit Ebene und Art der Quelle (Legacy `ecosystemSplitGeometry`, `createArea`). Quert die Linie die Fläche nicht
 * vollständig, wird nicht geschnitten. EINE Operation `landscape.split`, ↺ im Verlauf.
 */
export const editorLandscapeSplitUrl = (id: string): string => `${EDITOR_LANDSCAPES_URL}/${id}/split`;
export const LandscapeSplitBody = Type.Object(
    {
        operationId: OperationId,
        areaId: PublicId(),
        baseRevision: Type.Integer({ minimum: 1 }),
        /** Die Schnittlinie in Kartenkoordinaten, nicht verlängert. */
        line: Type.Array(Punkt, { minItems: 2, maxItems: LANDSCAPE_CREATE_POINTS_MAX }),
    },
    strict,
);
export type LandscapeSplitBody = Static<typeof LandscapeSplitBody>;
/** Die Quittung: die gewöhnliche, dazu die neue Landschaft aus dem abgeschnittenen Stück. */
export const LandscapeSplitReceipt = Type.Object(
    { ...OperationReceipt.properties, publicId: Type.Optional(Type.String()), name: Type.Optional(Type.String()) },
    strict,
);
export type LandscapeSplitReceipt = Static<typeof LandscapeSplitReceipt>;

/**
 * „Kopieren …“ (Werkzeug 8, Betreiber 2026-10-19 wörtlich: „wie legacy B mit haken“; Legacy `map-features-ecosystem-transfer.js`): Die
 * Teilfläche noch einmal, als KOPIE mit eigener Kennung, in einer Zielebene (die andere zuerst, die eigene zuletzt) und dort in einer
 * bestehenden Landschaft (`targetId`) oder einer neuen mit Name und Art. Mit `deleteSource` („Originalfläche löschen“) wird aus dem Kopieren
 * ein Umziehen: Die Quelle geht von der Karte, und war sie die letzte ihrer Landschaft, die Landschaft samt Beschriftungen. Anders als
 * Legacy (drei Schreibvorgänge nacheinander) EINE Operation `landscape.copy`: Es gibt kein halbes Umziehen. ↺ im Verlauf des Ziels.
 */
export const editorLandscapeCopyUrl = (id: string): string => `${EDITOR_LANDSCAPES_URL}/${id}/copy`;
export const LandscapeCopyBody = Type.Object(
    {
        operationId: OperationId,
        areaId: PublicId(),
        baseRevision: Type.Integer({ minimum: 1 }),
        /** Die Zielebene. */
        layer: Union(EDITOR_LANDSCAPE_LAYERS),
        /** Eine bestehende Landschaft der Zielebene; fehlt sie, entsteht eine neue mit `name` und `type`. */
        targetId: Type.Optional(PublicId()),
        name: Type.Optional(Type.String({ minLength: 1, maxLength: LANDSCAPE_NAME_MAX })),
        type: Type.Optional(Type.String({ pattern: "^[a-z_]{1,32}$" })),
        /** „Originalfläche löschen“. */
        deleteSource: Type.Boolean(),
    },
    strict,
);
export type LandscapeCopyBody = Static<typeof LandscapeCopyBody>;
/** Die Quittung: die gewöhnliche, dazu die Landschaft, in der die Kopie liegt, und die Kopie selbst. */
export const LandscapeCopyReceipt = Type.Object(
    {
        ...OperationReceipt.properties,
        publicId: Type.Optional(Type.String()),
        name: Type.Optional(Type.String()),
        areaId: Type.Optional(Type.String()),
    },
    strict,
);
export type LandscapeCopyReceipt = Static<typeof LandscapeCopyReceipt>;

/**
 * „Fläche malen“ und „Fläche radieren“ (Werkzeug 6; EDIT-0003 T34 (4), T41 (5), Betreiber 2026-10-17 „Ja, Alt und Zeichen“; Legacy
 * `map-features-ecosystem-brush.js`): EIN Strich mit dem Pinsel, gerechnet und nicht geschrieben. Der Strich ist die Spur des Zeigers mit
 * dem Radius in Kartenkoordinaten (der Pinsel lebt in Bildpunkten der Karte, umgerechnet beim Strich); Malen vereinigt, Radieren zieht ab,
 * exakt in PostGIS. `polygons` ist die Teilfläche, wie sie im Entwurf steht (sie kann vom Gespeicherten abweichen); das Ergebnis geht als
 * Schritt in den Entwurf, „Fertig“ schreibt `landscape.update`. Ganz wegradieren geht nicht (Legacy): 400.
 */
export const LANDSCAPE_BRUSH_MODES = ["malen", "radieren"] as const;
export type LandscapeBrushMode = (typeof LANDSCAPE_BRUSH_MODES)[number];
export const editorLandscapeBrushUrl = (id: string): string => `${EDITOR_LANDSCAPES_URL}/${id}/brush`;
/**
 * Der Strich selbst, ohne die Fläche, an der er rechnet: Die Landschaft nennt ihre Teilfläche im Körper (`LandscapeBrushBody`), die Sprache
 * im Pfad (`editorSpracheFlaechePinselUrl`, WI-0261 Stufe 2). Gerechnet wird er an beiden gleich (`apps/server/src/editor/pinsel-strich.ts`).
 */
export const PinselStrich = Type.Object(
    {
        mode: Union(LANDSCAPE_BRUSH_MODES),
        /** Die Teilfläche im Entwurf: je Polygon die Ringe (außen, dann Löcher). */
        polygons: Type.Array(Type.Array(Type.Array(Punkt, { minItems: 3 }), { minItems: 1 }), { minItems: 1 }),
        /** Die Spur des Zeigers in Kartenkoordinaten; ein Punkt ist ein einzelner Stempel. */
        line: Type.Array(Punkt, { minItems: 1, maxItems: LANDSCAPE_CREATE_POINTS_MAX }),
        /** Der Radius in Kartenkoordinaten. */
        radius: Type.Number({ exclusiveMinimum: 0 }),
        /** Wie fein der Kreis ist: Abschnitte je Viertelkreis (Legacy: 8 bis 32 Ecken je Kreis nach seiner Größe). */
        quadSegs: Type.Integer({ minimum: 2, maximum: 8 }),
    },
    strict,
);
export type PinselStrich = Static<typeof PinselStrich>;
export const LandscapeBrushBody = Type.Object({ areaId: PublicId(), ...PinselStrich.properties }, strict);
export type LandscapeBrushBody = Static<typeof LandscapeBrushBody>;
/** Was ein Strich ergibt: die Teilfläche danach, je Polygon die Ringe (außen, dann Löcher), ohne Schlusspunkt. */
export const PinselErgebnis = Type.Object({ polygons: Type.Array(Type.Array(Type.Array(Punkt))) }, strict);
export type PinselErgebnis = Static<typeof PinselErgebnis>;
export const LandscapeBrushResult = PinselErgebnis;
export type LandscapeBrushResult = PinselErgebnis;

/** Die Zielebenen beim Kopieren: der Zwilling zuerst (Vegetation ↔ Topographie), die eigene Ebene zuletzt (Legacy). */
export function landscapeCopyLayers(source: EditorLandscapeLayer): EditorLandscapeLayer[] {
    const zwilling: Partial<Record<EditorLandscapeLayer, EditorLandscapeLayer>> = {
        vegetation: "topographie",
        topographie: "vegetation",
    };
    const andere = EDITOR_LANDSCAPE_LAYERS.filter((layer) => layer !== source);
    const z = zwilling[source];
    return [...(z === undefined ? andere : [z, ...andere.filter((layer) => layer !== z)]), source];
}
