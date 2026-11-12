import { Type, type Static } from "@sinclair/typebox";
import { AVENTURIA } from "./map-domain-registry.ts";
import { ROUTE_RESPONSE_LIMITS } from "./route.ts";
import { MapBounds } from "./map-bounds.ts";
import { SubjectSprache } from "./subject.ts";
import { ROUTE_UNTERWEGS_LIMITS, RouteUnterwegsMitfahrt, RouteUnterwegsMitfahrtAntwort } from "./route-lore.ts";

/**
 * Die Landschaften entlang einer Route (WI-0035, Legacys „Führt durch“, V10): „Landschaften auf der
 * Route: …“ in der Übersicht und „durch …“ in jeder Etappenzeile.
 *
 * ⭐ **Das befahrene Stück.** Gerechnet wird an den Linien, die die Route wirklich fährt, auch
 * querfeldein. Legacy zählte je Weg die ganze Länge, auch wo die Reise nur ein Stück davon nutzt
 * (Inventur E9: „verbessern“).
 *
 * 🪤 Die Antwort trägt Längen, keine fertige Zeile: Schwelle, Reihenfolge und Zusammenfassen gleicher
 * Namen rechnet die Oberfläche, denn eine namenlose Fläche heißt dort nach ihrer Art - und die Art
 * heißt in der Sprache der Seite.
 */

/** Unter diesem Anteil fällt eine Landschaft weg (Legacy `AVESMAPS_LANDSCAPE_MIN_SHARE`). */
export const LANDSCAPE_MIN_SHARE = 0.05;

export const ROUTE_LANDSCAPE_LIMITS = {
    /** Die Linien der Etappen; dazu kommt höchstens der Körper von Unterwegs, wenn es mitfährt (`unterwegs`, WI-0292). */
    bodyBytes: 1024 * 1024 + ROUTE_UNTERWEGS_LIMITS.bodyBytes,
    /** So viele Etappen, wie eine Route höchstens hat (WI-0037, S-10). */
    stages: ROUTE_RESPONSE_LIMITS.stages,
    /** Punkte über alle Etappen. Eine Reise über den halben Kontinent hat rund 500. */
    points: 100_000,
    /**
     * Die Länge aller Linien zusammen, in Karteneinheiten (WI-0037, S-01): 120 000 Meilen, gut dreißigmal
     * quer über die Karte. Der Angriffskörper der Sicherheitsprüfung (1000 Diagonalen) hatte 1,45 Mio.
     */
    lengthUnits: 40_000,
    /** So viele Abfragen rechnen höchstens gleichzeitig; die nächste bekommt 503 `busy` (S-01). */
    concurrent: 2,
    /** Nach so vielen Millisekunden bricht PostgreSQL die Abfrage ab (S-01, Claudio 2026-09-24). */
    statementMs: 2_000,
} as const;

const strict = { additionalProperties: false } as const;
// 🔴 Nur Punkte auf der Karte (S-01): Die Abfrage kostet mit der Fläche, die eine Linie überstreicht.
const { bounds } = AVENTURIA.coordinateSpace;
const Line = Type.Array(
    Type.Tuple([
        Type.Number({ minimum: bounds.minX, maximum: bounds.maxX }),
        Type.Number({ minimum: bounds.minY, maximum: bounds.maxY }),
    ]),
    { minItems: 2 },
);

/** Die Länge aller Linien einer Anfrage, in Karteneinheiten. */
export function routeLandscapeLength(stages: readonly (readonly (readonly (readonly [number, number])[])[])[]): number {
    let length = 0;
    for (const lines of stages) {
        for (const line of lines) {
            for (let index = 1; index < line.length; index += 1) {
                const [x0, y0] = line[index - 1] as readonly [number, number];
                const [x1, y1] = line[index] as readonly [number, number];
                length += Math.hypot(x1 - x0, y1 - y0);
            }
        }
    }
    return length;
}

/**
 * `POST /api/route/landscapes`: je Etappe ihre Linien in `aventuria-v1`, wie die Route sie liefert.
 *
 * 🔴 **Unterwegs fährt mit** (WI-0292, Vali 2026-11-09: der Planer lief in Production schnell in die Drossel der Reise, 429): Jede neue Route kostete drei Fragen in derselben
 * Zone je Adresse (Route, Landschaften, Unterwegs). Mit `unterwegs` trägt dieselbe Frage den Körper von `POST /api/route/unterwegs`, und die Antwort bringt dessen Antwort im
 * Feld `unterwegs` mit: zwei Fragen je Route statt drei. Fehlt das Feld in der Antwort (Schranke voll, Zeitbudget, ein Server vor WI-0292, der das Feld still verwirft), fragt
 * der Browser Unterwegs einzeln, wie bisher. `POST /api/route/unterwegs` bleibt für das vorige Release.
 */
export const RouteLandscapesRequest = Type.Object(
    {
        stages: Type.Array(Type.Array(Line), { minItems: 1, maxItems: ROUTE_LANDSCAPE_LIMITS.stages }),
        unterwegs: Type.Optional(RouteUnterwegsMitfahrt),
    },
    { $id: "RouteLandscapesRequest", ...strict },
);
export type RouteLandscapesRequest = Static<typeof RouteLandscapesRequest>;

export const RouteLandscapeRegion = Type.Object(
    {
        /**
         * Der Name, wie ein Leser ihn sieht - `null`, wo nur ein Griff steht („Wald-925“,
         * „Fläche-048“). Dann zeigt die Oberfläche die Art (Legacy `ecosystemRegionLeserName`).
         */
        name: Type.Union([Type.String(), Type.Null()]),
        /** Die Art (`region_type`), leer ohne Art. */
        type: Type.String(),
        /**
         * Wohin ein Klick fliegt: die Beschriftung, wie ein Landschaftstreffer der Suche. Hat die Region keine,
         * aber einen echten Namen, ein Punkt auf ihrer größten Fläche (WI-0047, E1). `null` nur bei einem Griff
         * ohne Beschriftung.
         */
        target: Type.Union([
            Type.Object(
                {
                    /** Die Beschriftung, zu der geflogen wird; fehlt, wo die Region keine trägt. */
                    label: Type.Optional(Type.String()),
                    x: Type.Number(),
                    y: Type.Number(),
                    zoom: Type.Number(),
                    /** Alle Flächen der Region: Die Karte passt sie ganz ein, wie nach der Suche (WI-0044). */
                    bounds: Type.Optional(MapBounds),
                },
                strict,
            ),
            Type.Null(),
        ]),
    },
    { $id: "RouteLandscapeRegion", ...strict },
);
export type RouteLandscapeRegion = Static<typeof RouteLandscapeRegion>;

export const RouteLandscapeStage = Type.Object(
    {
        /** Die Länge der Etappe in Karteneinheiten. */
        length: Type.Number(),
        /** Je Region `[public_id, Länge]`, nach erster Durchquerung in Fahrtrichtung geordnet. */
        in: Type.Array(Type.Tuple([Type.String(), Type.Number()])),
    },
    { $id: "RouteLandscapeStage", ...strict },
);
export type RouteLandscapeStage = Static<typeof RouteLandscapeStage>;

export const RouteLandscapesResponse = Type.Object(
    {
        regions: Type.Record(Type.String(), RouteLandscapeRegion),
        stages: Type.Array(RouteLandscapeStage),
        /** Je Etappe die durchquerten Gebiete; null ohne gültige Ableitung, leer heißt Niemandsland. */
        territories: Type.Optional(
            Type.Union([
                Type.Null(),
                Type.Array(
                    Type.Array(
                        Type.Object(
                            {
                                id: Type.String(),
                                name: Type.String(),
                                parentId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
                                target: Type.Optional(
                                    Type.Object(
                                        {
                                            x: Type.Number(),
                                            y: Type.Number(),
                                            band: Type.Integer({ minimum: 0, maximum: 8 }),
                                            type: Type.String(),
                                            parentName: Type.Union([Type.String(), Type.Null()]),
                                        },
                                        strict,
                                    ),
                                ),
                            },
                            strict,
                        ),
                    ),
                ),
            ]),
        ),
        /**
         * Je Etappe die Sprachen, deren Flächen sie durchquert (WI-0261; Betreiber 2026-10-31: „sprachen soll immer zwischen "Regionen" und "Derographie"
         * bzw. über "Waren, Fauna, ..." in der tabelle gelistet werden"): Anteil an der Länge wie bei einem Weg, ab dem Mindestanteil der
         * Karteneinstellungen, der größte zuerst. Fehlt, wo keine Etappe eine Sprache berührt.
         */
        sprachen: Type.Optional(Type.Array(Type.Array(SubjectSprache))),
        /** Die Vorkommen unterwegs, wenn die Anfrage sie mitgefragt hat und sie gelangen (WI-0292); sonst fehlt das Feld, und der Browser fragt einzeln. */
        unterwegs: Type.Optional(RouteUnterwegsMitfahrtAntwort),
    },
    { $id: "RouteLandscapesResponse", ...strict },
);
export type RouteLandscapesResponse = Static<typeof RouteLandscapesResponse>;
