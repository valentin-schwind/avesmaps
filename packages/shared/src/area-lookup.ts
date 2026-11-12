import { Type, type Static } from "@sinclair/typebox";

/**
 * Die Kartenauswahl fragt den Server (WI-0058, Betreiber 2026-09-28: Landschaftsflächen „nur bei Bedarf“ laden,
 * „mach das, ja“).
 *
 * Wo die Karte Landschaftsflächen zeichnet, nimmt die Auswahl ihre Kandidaten aus den Kacheln (WI-0043). Wo sie
 * keine zeichnet (Topographie → Höhenstufen), lud sie die Kacheln bisher nur fürs Anklicken: 443 KB in der
 * Übersicht. Dort fragt sie jetzt:
 * - `GET /api/areas/at`: Flächen unter einem Punkt und Flüsse im Umkreis, als Rohzeilen mit denselben Feldern
 *   wie die Kacheln. Reihenfolge und Namen rechnet der Browser mit denselben Funktionen wie für die Kacheln
 *   (`areaCandidates`, `riverCandidates`): eine Regel, eine Stelle.
 * - `GET /api/areas/outline`: die Umrisse einer Region oder einer Gruppe (WI-0047) für Vorschau und Leuchten,
 *   je Zoom vereinfacht, See und Meer auf Wunsch geglättet wie in der Topographie (WI-0055).
 *
 * Koordinaten in Karteneinheiten (`aventuria-v1`, ADR-0003), wie jede andere Antwort des Servers.
 */

export const AREA_LOOKUP_URL = "/api/areas/at";
export const AREA_OUTLINE_URL = "/api/areas/outline";

export const AREA_LOOKUP_LIMITS = {
    /** So weit (E) sucht die Abfrage Flüsse um den Punkt. Fünf Bildpunkte sind bei Zoom 1 rund 5 E. */
    reachMax: 8,
    /** Höchstens so viele Regionen je Umrissanfrage (Gruppen gleichnamiger Regionen, WI-0047). */
    outlineIds: 64,
    /** Höchste Zoomstufe, für die vereinfacht wird; darüber bleibt die Form, wie sie ist. */
    outlineZoomMax: 14,
    /** Abfragen je Prozess gleichzeitig; mehr belegten den Pool (sonst 503 `busy`). */
    concurrent: 4,
    /** Zeitgrenze je Abfrage in PostgreSQL (ms). Gemessen wenige Millisekunden. */
    statementMs: 1000,
} as const;

/** Die Ebenen, deren Flächen die Auswahl kennt (Klima hat eigene Bänder, keine Auswahl). */
export const AREA_LOOKUP_LAYERS = ["topographie", "vegetation", "derographisch"] as const;
export type AreaLookupLayer = (typeof AREA_LOOKUP_LAYERS)[number];

const LAYER = "(topographie|vegetation|derographisch)";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const strict = { additionalProperties: false } as const;

/**
 * Die Kachelrevision der Karte (`map.changed`, WI-0128 E13), die der Browser mitschickt, sobald jemand die Karte geändert hat (WI-0178
 * B3; EDIT-0004 §6 „Umrisse und Auswahl“). Der Server liest sie nicht: Sie macht nur die Adresse neu, damit Browser und Zwischenspeicher
 * nach einer Änderung an einer Landschaft nicht die Antwort von vorher liefern.
 */
const AREA_LOOKUP_REVISION = Type.Optional(Type.Integer({ minimum: 0 }));

export const AreaAtQuery = Type.Object(
    {
        x: Type.Number({ minimum: 0, maximum: 1024 }),
        y: Type.Number({ minimum: 0, maximum: 1024 }),
        /** Die Ebenen der Ansicht, durch Komma getrennt. */
        layers: Type.String({ pattern: `^${LAYER}(,${LAYER}){0,2}$` }),
        /** Seen mitnehmen? Aus, wenn der Schalter „Flüsse und Seen“ sie ausblendet. */
        lakes: Type.Optional(Type.Boolean()),
        /** Flüsse in diesem Umkreis (E); ohne Angabe keine. */
        reach: Type.Optional(Type.Number({ minimum: 0, maximum: AREA_LOOKUP_LIMITS.reachMax })),
        r: AREA_LOOKUP_REVISION,
    },
    { $id: "AreaAtQuery", ...strict },
);
export type AreaAtQuery = Static<typeof AreaAtQuery>;

export const AreaAtResponse = Type.Object(
    {
        /** Je gezeichnetem Polygon eine Zeile, Felder wie in `region_area_render`. */
        areas: Type.Array(
            Type.Object(
                {
                    region_public_id: Type.String(),
                    name: Type.Union([Type.String(), Type.Null()]),
                    region_type: Type.String(),
                    region_layer: Type.String(),
                    area: Type.Number(),
                    /**
                     * Für Klicks gesperrt (`region.is_locked`; WI-0178 D1, EDIT-0003 T53): Die Kartenauswahl lässt die Fläche aus, „Was ist
                     * hier?“ nennt sie weiter. Fehlt bei einem Server von vorher.
                     */
                    is_locked: Type.Optional(Type.Boolean()),
                },
                strict,
            ),
        ),
        /** Flusslinien im Umkreis, Felder wie in den Wegkacheln. */
        rivers: Type.Array(
            Type.Object({ name: Type.String(), subtype: Type.String(), is_bach: Type.Boolean() }, strict),
        ),
    },
    { $id: "AreaAtResponse", ...strict },
);
export type AreaAtResponse = Static<typeof AreaAtResponse>;

export const AreaOutlineQuery = Type.Object(
    {
        /** `region.public_id`, durch Komma getrennt. */
        ids: Type.String({ pattern: `^${UUID}(,${UUID}){0,${String(AREA_LOOKUP_LIMITS.outlineIds - 1)}}$` }),
        /** Die Zoomstufe der Karte: vereinfacht wird auf einen halben Bildpunkt. */
        z: Type.Integer({ minimum: 0, maximum: AREA_LOOKUP_LIMITS.outlineZoomMax }),
        /** Die geglättete Form, wie die Karte sie zeigt: alle Flächen aus dem gemeinsamen Netz (WI-0077). */
        smooth: Type.Optional(Type.Boolean()),
        r: AREA_LOOKUP_REVISION,
    },
    { $id: "AreaOutlineQuery", ...strict },
);
export type AreaOutlineQuery = Static<typeof AreaOutlineQuery>;

export const AreaOutlineResponse = Type.Object(
    {
        type: Type.Literal("FeatureCollection"),
        features: Type.Array(
            Type.Object(
                {
                    type: Type.Literal("Feature"),
                    properties: Type.Object({ region_public_id: Type.String(), region_type: Type.String() }, strict),
                    geometry: Type.Object(
                        {
                            type: Type.Union([Type.Literal("Polygon"), Type.Literal("MultiPolygon")]),
                            coordinates: Type.Array(Type.Unknown()),
                        },
                        strict,
                    ),
                },
                strict,
            ),
        ),
    },
    { $id: "AreaOutlineResponse", ...strict },
);
export type AreaOutlineResponse = Static<typeof AreaOutlineResponse>;

/** Die Toleranz der Vereinfachung bei Zoom `z`: ein halber Bildpunkt (die Welt, 1024 E, ist 512 · 2^z px breit). */
export function outlineTolerance(z: number): number {
    return 1 / 2 ** z;
}
