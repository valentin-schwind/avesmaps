import { Type, type Static } from "@sinclair/typebox";
import { DEPARTURE_MONTHS } from "./calendar.ts";
import { KARTENSERIE_KENNUNG_MUSTER } from "./system/kartenserien.ts";
import { DEFAULT_TOPOGRAPHY_VARIANT, LANDSCAPE_SELECTIONS, MAP_VIEWS, TOPOGRAPHY_VARIANTS } from "./map-views.ts";
import { mapPointId, parseMapPointId, ROUTE_WAYPOINT_LIMIT, WAYPOINT_ID_PATTERN, WaypointHit } from "./route.ts";
import { airProfileIds, CUSTOM_AIR } from "./air.ts";
import { AVENTURIA_TRAVEL_MODEL } from "./travel-model-registry.ts";
import { DEFAULT_LODGING, LODGING_LEVELS } from "./travel-model.ts";

/**
 * Der Kurzlink `?s=<code>` (WI-0034, WI-0017 F2): Legacys Teilen-Knopf mit Speicher.
 *
 * 🔴 **Gespeichert wird ein Zustand, kein Text.** Wegpunkte als feste Kennungen (`public_id`,
 * `p:<x>:<y>` oder eine Landmarke `l:<uuid>`, WI-0271 L6), Optionen und Ansicht als Werte aus festen
 * Listen. Namen reisen nicht mit: Eine Umbenennung bricht keinen geteilten Link. Und ein Feld für freien Text gibt es nicht, sonst wäre
 * der Endpunkt ein Pastebin (Claudio, `2026-09-24-kurzlink-einschaetzung-antwort.md`).
 *
 * Mittelpunkt und Zoom reisen nicht mit, wie in Legacy: Die Reise wird beim Öffnen eingepasst.
 */

/** Legacys Alphabet ohne 0, 1, l, o, I und O (`api/app/share-link.php`), damit man abtippen kann. */
export const SHARE_CODE_ALPHABET = "23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
export const SHARE_CODE_LENGTH = 8;
/** So sieht ein Code aus, den wir lesen; die übernommenen Legacy-Codes (F3) passen ebenfalls hinein. */
export const SHARE_CODE_PATTERN = "^[A-Za-z0-9]{4,16}$";

export const SHARE_LIMITS = {
    /** Größer ist kein Zustand des Planers; 100 Wegpunkte brauchen rund 4 KB. Nginx setzt dieselbe Grenze. */
    bodyBytes: 16 * 1024,
    /** Neue Codes je Stunde und Client-IP, wie in Legacy. */
    perIpPerHour: 40,
    /** Neue Codes an einem Tag insgesamt: Die Drossel je IP hilft nicht gegen viele IPs (Claudio). */
    perDay: 2000,
} as const;

const transports = AVENTURIA_TRAVEL_MODEL.transportmittel.wert;
/** Die Flugmittel des Reisemodells und das eigene (WI-0051) - eine feste Liste wie die Transportmittel. */
const airProfiles = [...airProfileIds(AVENTURIA_TRAVEL_MODEL), CUSTOM_AIR];
/** Eine Liste fester Werte; die Literaltypen bleiben erhalten (`MapView`, nicht `string`). */
const oneOf = <T extends string>(values: readonly T[]) => Type.Union(values.map((value) => Type.Literal(value)));
const strict = { additionalProperties: false } as const;

/** Die sechs Ortsklassen des Auge-Menüs (`PLACE_TIERS` der Oberfläche; ein Test hält beide gleich). */
export const SHARE_PLACE_LEVEL_MAX = 6;

/**
 * Die Schalter des Auge-Menüs, die von der Vorgabe der Ansicht abweichen (WI-0072). 🔴 Nur Abweichungen: Ein
 * Schlüssel, der fehlt, heißt „Vorgabe der Ansicht“ - dieselbe Regel wie in der Adresse. Die Namen sind die von
 * `MapDisplay` der Oberfläche, dazu das Kachelraster (Editorwerkzeug, für Besucher ohne Wirkung). Alles feste Werte,
 * kein Freitext.
 */
export const ShareDisplay = Type.Object(
    {
        placeLevel: Type.Optional(Type.Integer({ minimum: 0, maximum: SHARE_PLACE_LEVEL_MAX })),
        paths: Type.Optional(Type.Boolean()),
        layers: Type.Optional(Type.Boolean()),
        labels: Type.Optional(Type.Boolean()),
        rivers: Type.Optional(Type.Boolean()),
        borders: Type.Optional(Type.Boolean()),
        flow: Type.Optional(Type.Boolean()),
        tileGrid: Type.Optional(Type.Boolean()),
        /** Das Gradnetz (WI-0273), für alle; wie das Kachelraster an keine Ansicht gebunden. */
        gradnetz: Type.Optional(Type.Boolean()),
        /** Das Hexraster (WI-0273): die Feldgröße in Meilen, nur wenn es an ist; es schließt das Gradnetz aus. */
        hexraster: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
    },
    strict,
);
export type ShareDisplay = Static<typeof ShareDisplay>;

/** Die Schlüssel von `ShareDisplay` in der einen Reihenfolge, in der sie gespeichert werden. */
export const SHARE_DISPLAY_KEYS = [
    "placeLevel",
    "paths",
    "layers",
    "labels",
    "rivers",
    "borders",
    "flow",
    "tileGrid",
    "gradnetz",
    "hexraster",
] as const;

export const SharePayload = Type.Object(
    {
        /** Die Fassung des Zustands: Was heute gespeichert wird, muss auch in Jahren noch aufgehen. */
        v: Type.Literal(1),
        waypoints: Type.Array(Type.String({ pattern: WAYPOINT_ID_PATTERN }), {
            minItems: 2,
            maxItems: ROUTE_WAYPOINT_LIMIT,
        }),
        options: Type.Object(
            {
                optimize: oneOf(["fastest", "shortest"] as const),
                minimizeTransfers: Type.Boolean(),
                enabled: Type.Object({ land: Type.Boolean(), river: Type.Boolean(), sea: Type.Boolean() }, strict),
                transports: Type.Object(
                    { land: oneOf(transports.land), river: oneOf(transports.river), sea: oneOf(transports.sea) },
                    strict,
                ),
                hoursPerDay: Type.Number({ minimum: 0.5, maximum: 24, multipleOf: 0.5 }),
                /** Der Reisebeginn (WI-0038); fehlt er oder ist er leer, rechnet die Reise ohne Datum. */
                departure: Type.Optional(
                    Type.Union([
                        Type.Object(
                            // An den Namenlosen Tagen (`namenlos`) gelten nur die Tage 1 bis 5; der Planer klemmt beim Lesen.
                            { month: oneOf(DEPARTURE_MONTHS), day: Type.Integer({ minimum: 1, maximum: 30 }) },
                            strict,
                        ),
                        Type.Null(),
                    ]),
                ),
                /** Die Unterbringung (WI-0042); fehlt sie, gilt die Vorgabe (Legacy Meldung #103: sie reist mit). */
                lodging: Type.Optional(oneOf(LODGING_LEVELS)),
                /**
                 * Eiltempo (WI-0078); `false` fehlt kanonisch ganz, damit ein Zustand von vor WI-0078 seinen Code
                 * behält und ein fehlendes Feld beim Einlesen „aus“ heißt.
                 */
                hurry: Type.Optional(Type.Boolean()),
            },
            strict,
        ),
        view: Type.Object(
            {
                /**
                 * Die Kennung einer Serie, nicht mehr die Liste der JSON (WI-0220): Serien entstehen zur Laufzeit. Ob es sie gibt,
                 * entscheidet die Karte beim Öffnen; eine unbekannte fällt dort auf die Vorgabe zurück.
                 */
                series: Type.String({ pattern: KARTENSERIE_KENNUNG_MUSTER }),
                view: oneOf(MAP_VIEWS),
                layer: oneOf(LANDSCAPE_SELECTIONS),
                /**
                 * Die Unterwahl der Topographie und die abweichenden Schalter des Auge-Menüs (WI-0072). Beide fehlen
                 * ganz, wo sie der Vorgabe folgen: Ein Zustand von vor WI-0072 behält seinen Code.
                 */
                topo: Type.Optional(oneOf(TOPOGRAPHY_VARIANTS)),
                display: Type.Optional(ShareDisplay),
            },
            strict,
        ),
        /**
         * Der Flug (WI-0051): ein Flugmittel aus dem Reisemodell oder `custom` mit eigenen Werten. Fehlt
         * er, reist die Route über Land und Wasser, und ein Zustand von vor WI-0051 behält seinen Code.
         * 🔴 Der Name des eigenen Flugmittels reist NICHT mit: Er wäre freier Text (siehe oben); in der
         * Adresse steht er, im Kurzlink heißt es „Eigenes Flugmittel“.
         */
        air: Type.Optional(
            Type.Object(
                {
                    profile: oneOf(airProfiles),
                    speedMph: Type.Optional(Type.Number({ minimum: 1, maximum: 999 })),
                    altitudePaces: Type.Optional(Type.Integer({ minimum: 1, maximum: 9999 })),
                },
                strict,
            ),
        ),
    },
    { $id: "SharePayload", ...strict },
);
export type SharePayload = Static<typeof SharePayload>;

/** Die Ansicht in einer Schreibweise: Vorgaben und leere Abweichungen fehlen ganz, die Schlüssel stehen in fester Folge. */
function canonicalShareView(view: SharePayload["view"]): SharePayload["view"] {
    const display: ShareDisplay = {};
    for (const key of SHARE_DISPLAY_KEYS) {
        const value = view.display?.[key];
        if (value !== undefined) Object.assign(display, { [key]: value });
    }
    return {
        series: view.series,
        view: view.view,
        layer: view.layer,
        ...(view.topo !== undefined && view.topo !== DEFAULT_TOPOGRAPHY_VARIANT ? { topo: view.topo } : {}),
        ...(Object.keys(display).length > 0 ? { display } : {}),
    };
}

/**
 * Die eine Schreibweise eines Zustands: feste Reihenfolge der Schlüssel, Kennungen klein, Kartenpunkte
 * auf ihre drei Stellen. Derselbe Zustand ergibt so dieselben Bytes und damit denselben Code.
 */
export function canonicalSharePayload(payload: SharePayload): SharePayload {
    const { options, view } = payload;
    return {
        v: 1,
        waypoints: payload.waypoints.map((id) => {
            const point = parseMapPointId(id);
            return point ? mapPointId(point) : id.toLowerCase();
        }),
        options: {
            optimize: options.optimize,
            minimizeTransfers: options.minimizeTransfers,
            enabled: { land: options.enabled.land, river: options.enabled.river, sea: options.enabled.sea },
            transports: {
                land: options.transports.land,
                river: options.transports.river,
                sea: options.transports.sea,
            },
            hoursPerDay: options.hoursPerDay,
            // Ohne Reisebeginn fehlt der Schlüssel ganz: Ein Zustand von vor WI-0038 behält seinen Code.
            ...(options.departure ? { departure: { month: options.departure.month, day: options.departure.day } } : {}),
            // Die Vorgabe fehlt ebenso: Ein Zustand von vor WI-0042 behält seinen Code.
            ...(options.lodging !== undefined && options.lodging !== DEFAULT_LODGING
                ? { lodging: options.lodging }
                : {}),
            // Nur ein gesetzter Haken reist mit: Ein Zustand von vor WI-0078 behält seinen Code.
            ...(options.hurry === true ? { hurry: true } : {}),
        },
        view: canonicalShareView(view),
        // Ohne Flug fehlt der Schlüssel ganz; ein eigenes Flugmittel trägt seine Werte, ein benanntes nur die Kennung.
        ...(payload.air
            ? {
                  air:
                      payload.air.profile === "custom"
                          ? {
                                profile: "custom",
                                ...(payload.air.speedMph !== undefined ? { speedMph: payload.air.speedMph } : {}),
                                ...(payload.air.altitudePaces !== undefined
                                    ? { altitudePaces: payload.air.altitudePaces }
                                    : {}),
                            }
                          : { profile: payload.air.profile },
              }
            : {}),
    };
}

/** `POST /api/share`: 201 für einen neuen Code, 200 für den vorhandenen desselben Zustands. */
export const ShareCreated = Type.Object({ code: Type.String() }, { $id: "ShareCreated", ...strict });
export type ShareCreated = Static<typeof ShareCreated>;

/**
 * `GET /api/share/<code>`: der Zustand, dazu die Orte hinter seinen Kennungen, wie sie HEUTE heißen und
 * liegen. `null` steht für einen Kartenpunkt (er trägt seine Lage selbst) und für einen Ort, den es
 * nicht mehr gibt - die Seite sagt das, statt still eine andere Reise zu öffnen (Kap. 9.57).
 */
export const ShareResolved = Type.Object(
    {
        code: Type.String(),
        payload: SharePayload,
        places: Type.Array(Type.Union([WaypointHit, Type.Null()])),
    },
    { $id: "ShareResolved", ...strict },
);
export type ShareResolved = Static<typeof ShareResolved>;

export const SHARE_ERRORS = [
    "forbidden_origin",
    "rate_limited",
    "daily_budget",
    "unknown_code",
    "database_unavailable",
] as const;
export type ShareErrorCode = (typeof SHARE_ERRORS)[number];

export const ShareError = Type.Object({ error: oneOf(SHARE_ERRORS) }, { $id: "ShareError", ...strict });
export type ShareError = Static<typeof ShareError>;
