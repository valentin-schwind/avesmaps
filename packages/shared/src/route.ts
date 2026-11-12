import { Type, type Static } from "@sinclair/typebox";
import { airProfileIds, CUSTOM_AIR } from "./air.ts";
import { CALENDAR_MONTHS, DEPARTURE_MONTHS, SEASONS } from "./calendar.ts";
import { LANDMARKEN_ARTEN } from "./landmarken.ts";
import { TRAVEL_COST_KEYS } from "./travel-costs.ts";
import { AVENTURIA_TRAVEL_MODEL } from "./travel-model-registry.ts";
import { CLOSURE_REASONS, COST_STATUSES, LODGING_LEVELS, type LodgingLevel } from "./travel-model.ts";

/**
 * Der Vertrag der Route (WI-0017 R6, Kap. 6.47–6.49): `GET /api/route`.
 *
 * 🔴 SIE LIEST NUR. Eine Route ist eine Rechnung über den Bestand, kein Schreibpfad.
 *
 * ⭐ Die Abschnitte (`segments`) tragen Legacys Form und Legacys Namen (`from_node`, `distance_units`,
 * `cost_units`, …), deshalb snake_case im ganzen Vertrag: Aus genau dieser Folge baut die
 * Etappenrechnung ihre Etappen (route-plan.js), und ein Client, der Legacys Antwort liest, liest
 * auch diese.
 *
 * ⭐ **Eine Rechnung, auf dem Server** (WI-0017, Schritt 2): Die Etappen, ihre Stunden und die Rast
 * (`stages`, `rest_hours`, `total_hours`) kommen fertig aus dieser Antwort. Legacys Reiseplan hat sie
 * im Browser ein zweites Mal gerechnet, und die beiden Rechnungen sind schon einmal auseinander-
 * gelaufen (Meldung #101).
 *
 * ⭐ **Reisebeginn** (WI-0038, Legacy `departure`): Mit Monat und Tag trägt die Route ein Datum. Ein
 * Weg, der an dem Tag, an dem man ihn erreicht, nicht gangbar ist, wird gemieden (`closures`), und
 * der Boden der Jahreszeit verlangsamt die Reise. Ohne Reisebeginn sperrt nichts; die Antwort nennt
 * dann die Wege mit Sperrzeiten (`seasonal_ways`).
 *
 * ⭐ **Kartenpunkte** (WI-0030, Legacys „Hierher reisen“): Ein Wegpunkt darf statt eines Ortes ein
 * freier Punkt der Karte sein, `p:<x>:<y>`. Legacy kannte ihn nur als Start oder Ziel
 * (`from_point`, `to_point`); hier steht er in derselben Liste wie die Orte, auch als Zwischenziel.
 *
 * ⭐ **Landmarken** (WI-0271 L6, §4.3): Ein Wegpunkt darf eine Landmarke sein, `l:<public_id>` aus `terrain_peak`, wenn sie aktiv
 * ist und ihre Art Reiseziel sein darf (`LANDMARKEN_KATALOG`). Sie fährt wie ein Kartenpunkt an ihrer Lage (dieselbe
 * Querfeldein-Kante zum nächsten Netzpunkt), nennt im Ergebnis aber ihre Kennung und ihren Namen statt „Kartenpunkt“. Das Netz
 * ändert sich nicht; eine Route ohne Landmarke rechnet wie zuvor.
 *
 * ⭐ **Flug** (WI-0051, `air.ts`): Mit `air` fliegt die Reise von Wegpunkt zu Wegpunkt, je Paar ein Abschnitt
 * `Flug` (`AIR_EDGE_PREFIX`) und eine Etappe. Wegarten, Mittel, Optimierung und Umstiege gelten dann nicht;
 * Reisestunden, Rast und Reisebeginn wie an Land. Ohne `air` rechnet alles wie zuvor.
 */

/**
 * Höchstens so viele Wegpunkte je Anfrage: Start, Ziel und bis zu 98 Zwischenziele (Betreiber
 * 2026-09-23: „wegpunktgrenze von 100 ist ok“). Legacy fragte zu zwölft und reihte längere Reisen
 * nacheinander; jedes Zwischenziel kostet eine weitere Suche von rund 2 ms (Kap. 6.63).
 */
export const ROUTE_WAYPOINT_LIMIT = 100;

/**
 * Höchstens so viele Kartenpunkte je Anfrage (WI-0037, S-04): Jeder löst eine Rastersuche querfeldein
 * aus, gemessen rund 40 bis 50 ms auf dem Satz map147359. Zehn brauchen eine halbe Sekunde, fünfzig
 * liefen in die Zeitgrenze - und der Worker rechnet danach weiter. Legacy kannte nur zwei (Start, Ziel). Eine Landmarke
 * (`l:<uuid>`, WI-0271 L6) fährt wie ein Kartenpunkt und zählt hier mit.
 */
export const ROUTE_MAP_POINT_LIMIT = 10;

/**
 * Höchstens so viele Seereisen der freien Seefahrt je Anfrage (WI-0037, S-04 und S-10; Befund 1 des
 * Stage-Rollouts 2026-09-27). Eine Seereise ist EIN Abschnitt, trägt aber eine lange Linie (rund 140
 * Stützpunkte samt Zeichenlinie) und kostet eine Suche im Seegraphen: 100 Wegpunkte im Wechsel Riva/Al'Anfa
 * lieferten 941 Abschnitte - unter der Grenze aus S-10 - und 2,1 MB auf eine Anfrage von 1,4 KB. Eine Reise
 * über zwölf Häfen hat zwölf Seereisen, 1266 Stützpunkte und 105 KB. Wer mehr will, teilt die Reise.
 */
export const ROUTE_FREE_SEA_LIMIT = 25;

/**
 * Höchstens so viele Flugetappen je Anfrage, die um Gebirge suchen (WI-0051 F2; Claudio 2026-09-28,
 * `2026-09-28-flug-worker-budget-antwort.md`). Eine Etappe sucht, wenn ihre Luftlinie Gelände über der
 * absoluten Höchstflughöhe − Mindestabstand (seit 2026-10-04 für alle Flugmittel 4.800 Schritt) berührt; Etappen
 * auf der Luftlinie zählen nicht, wiederholte Etappen zählen je Vorkommen wie bei den Seereisen. 100 Wegpunkte
 * im Zickzack über Gebirge kosteten mit der damaligen Grenze des Hexenbesens (800 Schritt) lokal 857 ms, auf dem
 * VPS bis 2,1 s - an der Zeitgrenze des Runners; 20 kosten lokal 168 ms.
 */
export const ROUTE_FLIGHT_SEARCH_LIMIT = 20;

/**
 * Wie groß eine Antwort höchstens wird (WI-0037, S-10): Hundert Wegpunkte im Wechsel zwischen Riva und
 * Al'Anfa ergaben 9058 Abschnitte, 6,5 MB und über eine halbe Sekunde, in der der Server stillstand.
 * Eine echte Reise über acht Orte quer über den Kontinent hat 295 Abschnitte und 72 Etappen. Die
 * Etappengrenze ist die der Landschaften: Jede Route, die der Server liefert, bekommt ihre Landschaften.
 */
export const ROUTE_RESPONSE_LIMITS = {
    segments: 4000,
    stages: 1000,
} as const;

/** Was gilt, wenn die Anfrage nichts sagt - Legacys Vorgabe (`AVESMAPS_ROUTE_DEFAULT_REQUEST`). */
export const ROUTE_DEFAULTS = {
    optimize: "fastest",
    land: "groupFoot",
    river: "riverSailer",
    sea: "cargoShip",
    domains: "land,river,sea",
    minimize_transfers: false,
    /** Reisestunden an Land je Tag: der Landtag des Reisemodells (WdE S. 160-162), wie Legacys Planerfeld. */
    hours_per_day: AVENTURIA_TRAVEL_MODEL.reisetagStunden.wert.land,
    /**
     * Eiltempo (WI-0078): aus. 🔴 Es wählt die Route nicht - dieselben Wegpunkte und Optionen ergeben mit und ohne
     * Eiltempo dieselbe Kantenfolge, nur die Zeit geeigneter Abschnitte sinkt.
     */
    hurry: false,
} as const;

const transports = AVENTURIA_TRAVEL_MODEL.transportmittel.wert;
const airLimits = AVENTURIA_TRAVEL_MODEL.flug.wert.eigenes;
/** Was `air` sein darf: ein Flugmittel des Reisemodells oder das eigene. */
const AIR_CHOICES = [...airProfileIds(AVENTURIA_TRAVEL_MODEL), CUSTOM_AIR];
/** Eine Liste fester Werte; die Literaltypen bleiben erhalten (`CalendarMonth`, nicht `string`). */
const oneOf = <T extends string>(values: readonly T[]) => Type.Union(values.map((value) => Type.Literal(value)));
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

/**
 * Die Kennung eines Kartenpunkts: seine Lage in `aventuria-v1`, auf drei Stellen (rund 5 m bei
 * 3 Meilen je Einheit - genauer zielt kein Finger). Die Kennung IST die Lage: Zwei Klicks auf
 * dieselbe Stelle sind derselbe Punkt.
 */
const MAP_POINT = String.raw`p:-?\d{1,5}(?:\.\d{1,3})?:-?\d{1,5}(?:\.\d{1,3})?`;
const MAP_POINT_ID = new RegExp(`^${MAP_POINT}$`);
/**
 * Die Kennung einer Landmarke als Wegpunkt (WI-0271 L6): `l:` und die `public_id` ihrer Zeile in `terrain_peak`, klein geschrieben
 * wie jede Kennung der Adresse. Die Lage steht NICHT darin: Die Landmarke kann verschoben werden, die Kennung bleibt.
 */
const LANDMARK = `l:${UUID}`;
const LANDMARK_ID = new RegExp(`^${LANDMARK}$`);
const WAYPOINT = `(?:${UUID}|${MAP_POINT}|${LANDMARK})`;
/** Ein einzelner Wegpunkt, Ort, Kartenpunkt oder Landmarke - etwa im gespeicherten Zustand eines Kurzlinks. */
export const WAYPOINT_ID_PATTERN = `^${WAYPOINT}$`;

const roundPoint = (value: number): number => Math.round(value * 1000) / 1000;

export function mapPointId(point: { x: number; y: number }): string {
    return `p:${String(roundPoint(point.x))}:${String(roundPoint(point.y))}`;
}

/** Die Lage hinter einer Kennung; `null`, wenn sie kein Kartenpunkt ist. */
export function parseMapPointId(id: string): { x: number; y: number } | null {
    if (!MAP_POINT_ID.test(id)) return null;
    const [, x, y] = id.split(":");
    return { x: Number(x), y: Number(y) };
}

/** Der Wegpunkt einer Landmarke (`terrain_peak.public_id`): `l:<uuid>`. */
export function landmarkWaypointId(publicId: string): string {
    return `l:${publicId.toLowerCase()}`;
}

/** Die `public_id` hinter einer Kennung, klein; `null`, wenn sie keine Landmarke ist. */
export function parseLandmarkWaypointId(id: string): string | null {
    return LANDMARK_ID.test(id) ? id.slice(2).toLowerCase() : null;
}

/**
 * Die früheren Werte von `sea_routing` (WI-0046). Seit WI-0153 Schnitt 7e fährt die Seefahrt immer frei über den Seegraphen
 * (Betreiber 2026-10-17: das alte, vorgefertigte Seewegesystem wird nicht mehr benutzt); die Adresse nimmt den Parameter nur
 * noch an, damit gespeicherte Links mit `seaways` nicht scheitern, und übergeht ihn.
 */
export const SEA_ROUTINGS = ["seaways", "free"] as const;
/** Die Kennung eines Abschnitts der freien Seefahrt beginnt so; dahinter stehen die beiden Häfen. */
export const FREE_SEA_EDGE_PREFIX = "see-frei-";

/**
 * Worauf die Höhenlinie eines Abschnitts liegt (WI-0065 Nachtrag 2026-10-03, Betreiber: Land hellbraun, Fluss blau,
 * Meer dunkelblau): `land` für Wege und Querfeldein (und für das Gelände unter einem Flug), `river` für das Flussbett,
 * `lake` für den Spiegel eines Binnensees, `sea` für das Meer (0). Die Oberfläche färbt danach; die Rechnung kennt die
 * Art nicht.
 */
export const ELEVATION_SURFACES = ["land", "river", "lake", "sea"] as const;
export type ElevationSurface = (typeof ELEVATION_SURFACES)[number];

/** Die Anfrage, als Adresse: `/api/route?waypoints=<id>,<id>&land=groupFoot&domains=land,river`. */
export const RouteQuerystring = Type.Object(
    {
        /** Orte (`public_id`), Kartenpunkte (`p:<x>:<y>`) oder Landmarken (`l:<uuid>`), kommagetrennt: Start, Zwischenziele, Ziel. */
        waypoints: Type.String({
            pattern: `^${WAYPOINT}(,${WAYPOINT}){1,${String(ROUTE_WAYPOINT_LIMIT - 1)}}$`,
        }),
        optimize: Type.Optional(Type.Union([Type.Literal("fastest"), Type.Literal("shortest")])),
        land: Type.Optional(oneOf(transports.land)),
        river: Type.Optional(oneOf(transports.river)),
        sea: Type.Optional(oneOf(transports.sea)),
        /** Welche Wegarten die Reise nutzen darf. Querfeldein gehört zu Land. */
        domains: Type.Optional(Type.String({ pattern: "^(land|river|sea)(,(land|river|sea)){0,2}$" })),
        /** Umstiege kosten einen Aufschlag - innerhalb einer Etappe, nie an einem Wegpunkt. */
        minimize_transfers: Type.Optional(Type.Boolean()),
        /**
         * Eiltempo (WI-0078): Wo Transportmittel und Abschnitt es zulassen, wird geeilt. 🔴 Die Wegwahl bleibt
         * unberührt; nur die Reisezeit geeigneter Abschnitte sinkt. Ohne Angabe wie bisher, also aus.
         */
        hurry: Type.Optional(Type.Boolean()),
        /** Ohne Wirkung seit WI-0153 Schnitt 7e: angenommen, damit alte Links nicht scheitern (`SEA_ROUTINGS`). */
        sea_routing: Type.Optional(oneOf(SEA_ROUTINGS)),
        /**
         * „Reisestunden pro Tag“ aus dem Planer: der Reisetag an Land, in halben Stunden. Wasser fährt
         * seinen eigenen Tag. 24 heißt: keine Rast, auch nicht an Bord (Legacys Schalter).
         */
        hours_per_day: Type.Optional(Type.Number({ minimum: 0.5, maximum: 24, multipleOf: 0.5 })),
        /** Reisebeginn: der Monat oder `namenlos` für die Namenlosen Tage (seit 2026-11-07, Legacy kannte sie nicht als Aufbruch). */
        start_month: Type.Optional(oneOf(DEPARTURE_MONTHS)),
        /**
         * Reisebeginn: der Tag im Monat, 1 bis 30, an den Namenlosen Tagen 1 bis 5 (das prüft die Route, das Schema kann es
         * nicht); gilt nur mit `start_month`, ohne Angabe der 1.
         */
        start_day: Type.Optional(Type.Integer({ minimum: 1, maximum: 30 })),
        /**
         * Fliegen (WI-0051): ein Flugmittel des Reisemodells (`flug.profile`) oder `custom`. Dann gelten
         * `domains`, `land`, `river`, `sea`, `optimize` und `minimize_transfers` nicht.
         */
        air: Type.Optional(oneOf(AIR_CHOICES)),
        /**
         * Nur mit `air=custom`, dort Pflicht: Meilen je Stunde, höchstens eine Nachkommastelle (`flug.eigenes`;
         * die Stellen prüft `resolveAirQuery`).
         */
        air_speed: Type.Optional(Type.Number({ minimum: airLimits.tempo.min, maximum: airLimits.tempo.max })),
        /** Nur mit `air=custom`: Reisehöhe in ganzen Schritt über Grund; ohne Angabe die Vorgabe. */
        air_altitude: Type.Optional(
            Type.Number({ minimum: airLimits.reisehoehe.min, maximum: airLimits.reisehoehe.max }),
        ),
    },
    { $id: "RouteQuerystring", additionalProperties: false },
);
export type RouteQuerystring = Static<typeof RouteQuerystring>;

/**
 * Die Steigung eines Abschnitts, einer Etappe oder der Reise (WI-0049 S5d, Gutachten MCS-026 Punkt 8).
 * Ungerundet; runden und „modelliert“ dazuschreiben ist Sache der Oberfläche. Das Feld fehlt, wo keine
 * Höhe bekannt ist - die Oberfläche schweigt dann (Legacy: ohne Höhendaten keine Zeile).
 */
const SlopeFigures = {
    /** Anstieg und Abstieg in Fahrtrichtung, in Schritt. */
    ascent_schritt: Type.Number(),
    descent_schritt: Type.Number(),
    /** Der höchste modellierte Punkt, in Schritt. */
    highest_schritt: Type.Number(),
    /**
     * Der steilste Abschnitt: die größte mittlere Steigung über `steigung.anzeigeFensterSchritt` (3.000
     * Schritt, Betreiber 2026-09-28 „1 B“), als Anteil mit Vorzeichen in Fahrtrichtung: 0,21 heißt 21 %
     * bergauf, −0,21 bergab. Ein kürzeres Stück mit Höhe zählt als Ganzes.
     */
    steepest_grade: Type.Number(),
    /**
     * Die Mehrzeit durch Steigung: Reisestunden minus dieselben Stunden, wenn jeder Abtastschritt eben wäre -
     * dasselbe Mittel, dieselbe Eichung, Sternregel und Bodenklasse. Nie negativ, bei ebenem Profil 0.
     */
    extra_hours: Type.Number(),
};
// 🪤 Kein `$id`: Die Schemata stehen vielfach in der Antwort (siehe `RouteStagePoint`).
export const RouteSegmentSlope = Type.Object(SlopeFigures, { additionalProperties: false });
export type RouteSegmentSlope = Static<typeof RouteSegmentSlope>;
/** Die Steigung einer Etappe: summiert über ihre Abschnitte mit Höhe, dazu wie viele Meilen das sind. */
export const RouteStageSlope = Type.Object(
    { ...SlopeFigures, covered_miles: Type.Number() },
    { additionalProperties: false },
);
export type RouteStageSlope = Static<typeof RouteStageSlope>;
/** Die Steigung der Reise: über die Etappen mit Höhe, samt Legacys Erfassungsvermerk (x von y Etappen). */
export const RouteSlope = Type.Object(
    { ...SlopeFigures, covered_miles: Type.Number(), covered_stages: Type.Integer(), total_stages: Type.Integer() },
    { additionalProperties: false },
);
export type RouteSlope = Static<typeof RouteSlope>;

/**
 * Der Zuschlag des Flugs über der Reisehöhe (WI-0051 F4, Betreiber 2026-10-04: „der aufstieg zur durchschnittlichen
 * flughöhe kostet nichts“, darüber kostet Steigen und Halten Zeit). Ungerundet; fehlt, wo der Flug kein Höhenmodell hat.
 * - `extra_hours`: die Stunden, um die die Reisezeit des Abschnitts länger ist als die Luftlinienzeit (Steigen und Halten).
 * - `peak_schritt`: der größte Überstand der Bahn über Boden + Reisehöhe.
 */
const AirExtraFigures = {
    extra_hours: Type.Number(),
    peak_schritt: Type.Number(),
};
// 🪤 Kein `$id`: Die Schemata stehen vielfach in der Antwort (siehe `RouteStagePoint`).
export const RouteSegmentAirExtra = Type.Object(
    { ...AirExtraFigures, climb_hours: Type.Number(), hold_hours: Type.Number() },
    { additionalProperties: false },
);
export type RouteSegmentAirExtra = Static<typeof RouteSegmentAirExtra>;
export const RouteAirExtra = Type.Object(AirExtraFigures, { additionalProperties: false });
export type RouteAirExtra = Static<typeof RouteAirExtra>;

/**
 * Die Mehrzeit durch Schnee und Eis (WI-0065 Nachtrag 2026-10-04, Betreiber: „kann man hier auch listen, was der
 * tiefschnee kostet“): die Reisestunden minus dieselben Stunden ohne den Boden der Jahreszeit, nur wo dieser Boden
 * Schnee oder Eis ist (`isSnowCondition`; Nässe zählt nicht). Dieselbe Rechnung wie die Reisezeit, `travel_hours`
 * enthält die Stunden schon. Nur mit Reisebeginn, ungerundet; fehlt, wo nichts zu zählen ist. Über der Schneegrenze
 * kostet der Schnee nichts eigenes: Das Reisemodell bremst nur mit dem Boden der Klimazone und Jahreszeit.
 */
export const RouteSegmentSnow = Type.Object(
    {
        /** Der Zustand (`jahreszeitBoden.zustaende`); bei zusammengefügten Stücken der des längeren mit Schnee. */
        condition: Type.String(),
        extra_hours: Type.Number(),
    },
    { additionalProperties: false },
);
export type RouteSegmentSnow = Static<typeof RouteSegmentSnow>;
/** Über die ganze Reise, dazu die Zustände der Abschnitte in der Folge ihres ersten Auftretens. */
export const RouteSnow = Type.Object(
    { extra_hours: Type.Number(), conditions: Type.Array(Type.String()) },
    { additionalProperties: false },
);
export type RouteSnow = Static<typeof RouteSnow>;

/**
 * Was das Eiltempo auf einer Etappe oder auf der ganzen Reise gebracht hat (WI-0078): die Strecke, auf der es
 * gewirkt hat, und die gesparten Stunden. Es wirkt ABSCHNITTSWEISE - eine Etappe kann teilweise betroffen sein, dann
 * ist `distance_units` kleiner als ihre Strecke. Das Feld fehlt, wo kein Abschnitt geeilt ist; `travel_hours` ist
 * überall schon die kürzere Zeit.
 */
export const RouteHurry = Type.Object(
    {
        distance_units: Type.Number(),
        saved_hours: Type.Number(),
        /**
         * Die Reisestunden, die wirklich im erhöhten Tempo zurückgelegt wurden - also die Stunden an den Eiltagen
         * (WI-0078 §10b). Geteilt durch die Reisestunden am Tag ergeben sie die **Zahl der Eiltage**, die eigentliche
         * Auskunft der Taktung. Sie sind kleiner als `travel_hours` der betroffenen Etappen, weil jeder zweite
         * Reisetag normal läuft.
         */
        hurried_hours: Type.Number(),
    },
    { additionalProperties: false },
);
export type RouteHurry = Static<typeof RouteHurry>;

export const RouteSegment = Type.Object(
    {
        index: Type.Integer(),
        /**
         * Kennung des Abschnitts; Querfeldein `synthetic-…` oder `offroad-…`, geteilte Wege `wp-slice-…`, freie
         * Seefahrt `see-frei-<Hafen>-<Hafen>` (`FREE_SEA_EDGE_PREFIX`), Flug `flug-<Wegpunkt>-<Wegpunkt>`
         * (`AIR_EDGE_PREFIX`; Wegart `Flug`, Reisemittel das Flugmittel oder `custom`).
         */
        edge_id: Type.String(),
        /** Der Weg (`public_id`); leer bei Querfeldein. */
        public_id: Type.String(),
        from_node: Type.String(),
        to_node: Type.String(),
        from_node_id: Type.String(),
        to_node_id: Type.String(),
        subtype: Type.String(),
        path_name: Type.String(),
        transport_type: Type.String(),
        /** Die gereiste Strecke in Karteneinheiten; bei Querfeldein die Länge ihrer Linie, gerade oder gebogen. */
        distance_units: Type.Number(),
        /** Die Zeit, die die Suche bezahlt hat - bei Querfeldein mit Aufschlag, wie in Legacy. */
        cost_units: Type.Number(),
        cost_factor: Type.Number(),
        /** Reisestunden dieses Abschnitts, OHNE Querfeldein-Aufschlag, stromauf mit Strömungsfaktor. */
        travel_hours: Type.Number(),
        flow_time_factor: Type.Number(),
        flow_state: Type.String(),
        /**
         * Der Boden der Jahreszeit auf diesem Abschnitt (WI-0038): Zustand und der Faktor, um den er die
         * Reisestunden verlängert hat. Nur mit Reisebeginn und wo er wirkt.
         */
        ground: Type.Optional(
            Type.Object({ condition: Type.String(), factor: Type.Number() }, { additionalProperties: false }),
        ),
        /** Was Schnee und Eis davon kosten (`RouteSegmentSnow`); fehlt ohne Schnee oder Eis. */
        snow: Type.Optional(RouteSegmentSnow),
        /**
         * Der wirksame Eilfaktor dieses Abschnitts (WI-0078), nur wo das Eiltempo tatsächlich gegriffen hat:
         * `travel_hours` ist die normale Zeit GETEILT durch ihn. Liegt der Abschnitt ganz in einem Eiltag, ist er
         * der volle Faktor der Geographia (1,5 beziehungsweise 1,25); liegt er über einer Tagesgrenze, der
         * gewichtete Wert dazwischen; an einem gewöhnlichen Reisetag fehlt das Feld (`hurryPacedHours`). So bleibt
         * nachvollziehbar, warum die Zeit von der Kantenzeit abweicht.
         */
        hurry_factor: Type.Optional(Type.Number()),
        /**
         * Die Steigung (WI-0049 S5d), nur wo der Abschnitt Höhen trägt: ein Landweg mit Wegprofil oder
         * querfeldein durch Gebirge oder Gipfelkegel. Ein geteilter Weg (`wp-slice-…`) trägt nur seinen Teil.
         */
        slope: Type.Optional(RouteSegmentSlope),
        /**
         * Abstand ab Abschnittsbeginn in Karteneinheiten, Höhe in Schritt; null markiert Datenlücken. Seit dem
         * Nachtrag 2026-10-03 tragen auch Wasserabschnitte eine Linie, abgetastet im Geländemodell zur Antwortzeit:
         * ein Flussweg das Flussbett entlang seiner Geometrie, ein Seeweg das Meer (0) oder den ebenen Spiegel eines
         * Binnensees; ein Flug das Gelände unter seiner Linie. Die Reisezeit und die Steigung (`slope`) bleiben davon
         * unberührt: Wasser kostet keine Steigungszeit, der Flug nur den Zuschlag über der Reisehöhe (`air_extra`).
         */
        elevation_profile: Type.Optional(
            Type.Array(Type.Tuple([Type.Number(), Type.Unsafe<number | null>({ type: ["number", "null"] })]), {
                maxItems: 256,
            }),
        ),
        /** Worauf `elevation_profile` liegt; fehlt ohne Linie. Im Flug `land`: das Gelände unter der Bahn (Meer dort 0). */
        elevation_surface: Type.Optional(oneOf(ELEVATION_SURFACES)),
        /**
         * Nur im Flug: die Höhe der Flugbahn in Schritt über dem Meer, Abstand ab Abschnittsbeginn in Karteneinheiten
         * wie bei `elevation_profile` (Regel `flightAltitude`: Reisehöhe, vor Gebirgen höher, höchstens 10 × Reisehöhe
         * über dem Boden und 5.000 Schritt über dem Meer, Steigen und Sinken mit 1 : 4). Die Linie verläuft nie
         * unter dem Boden von `elevation_profile`.
         */
        air_profile: Type.Optional(Type.Array(Type.Tuple([Type.Number(), Type.Number()]), { maxItems: 256 })),
        /**
         * Nur im Flug mit Höhenmodell (F4): Was die Bahn über der Reisehöhe über Grund kostet. `travel_hours` enthält die
         * Stunden schon; hier steht, wie viele es sind, getrennt nach Steigen und Halten.
         */
        air_extra: Type.Optional(RouteSegmentAirExtra),
        /** Längengewichtete Klimazone des Abschnitts, nur bei gewähltem Reisebeginn. */
        climate_zone: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        /** Querfeldein, ohne gezeichneten Weg: eine Notverbindung oder der Gang zu einem Kartenpunkt. */
        synthetic: Type.Boolean(),
        /** Der Gang zu einem Kartenpunkt (Legacys `offroad`) - gewollt, keine Notverbindung. */
        offroad: Type.Boolean(),
        /** Punkte in FAHRTRICHTUNG, in `aventuria-v1`. */
        geometry: Type.Object({
            type: Type.Literal("LineString"),
            coordinates: Type.Array(Type.Tuple([Type.Number(), Type.Number()])),
        }),
        /**
         * Wie der Abschnitt gezeichnet wird, wo das von `geometry` abweicht (WI-0030, Betreiber
         * 2026-09-25): ein an einem Anker geteilter Weg als Stück der gezeichneten Wegkurve, ein Gang
         * querfeldein mit dem Kurvenpunkt seines Ankers. Gemessen wird weiter an `geometry`.
         *
         * Dazu (Befund 2026-10-03: „flug- und querfeldeinrouten sind nicht mehr geglättet“): ein Flug um Gebirge
         * mit gerundeten Ecken, soweit sie frei bleiben (die Karte rundet ihn nicht noch einmal), und ein
         * gesuchter Gang querfeldein als begradigte Treppe der Suche, höchstens 0,5 E von `geometry` entfernt;
         * die Karte glättet ihn mit Catmull-Rom wie einen Weg.
         */
        display: Type.Optional(
            Type.Object({
                type: Type.Literal("LineString"),
                coordinates: Type.Array(Type.Tuple([Type.Number(), Type.Number()])),
            }),
        ),
        /**
         * Welches Ende von `geometry` ein **Anschlussstück** an einen Knoten ist und nicht zur gezeichneten Wegkurve
         * gehört (`toNodes`, WI-0147).
         *
         * 💣 **Warum die Karte das wissen muss** (Messung 2026-10-15,
         * `discovery/seegraph-kehren-2026-10-14.md`, Nachtrag 2): Die Karte glättet die Abschnittslinie mit
         * Catmull-Rom (`segmentShape`). Die Tangente am vorletzten Stützpunkt ist `(nächster − vorheriger) × 0,5` —
         * liegt der nächste Punkt nahe am vorletzten, behält sie die Länge der langen Strecke davor, und die Kurve
         * schießt über das kurze Endstück hinaus. Gemessen über 3.802 Stellen des Netzes: im Mittel ein
         * **Sechzehntel der Strecke davor**, bis zu 0,71 Einheiten, und **unabhängig von der Länge des
         * Anschlussstücks** (0,002 oder 0,45 Einheiten ändern daran fast nichts).
         *
         * 🔴 Die Karte nimmt diese Enden deshalb aus der Glättung und hängt sie als gerade Stücke an. Gemessen wird
         * weiter an `geometry`, und zwar unverändert: Die Strecke kennt kein Anschlussstück.
         */
        joints: Type.Optional(
            Type.Object(
                { start: Type.Boolean(), end: Type.Boolean() },
                { $id: "RouteSegmentJoints", additionalProperties: false },
            ),
        ),
    },
    { $id: "RouteSegment", additionalProperties: false },
);
export type RouteSegment = Static<typeof RouteSegment>;

export const RouteLeg = Type.Object(
    {
        from: Type.String(),
        to: Type.String(),
        segment_start: Type.Integer(),
        segment_count: Type.Integer(),
        distance_units: Type.Number(),
        travel_hours: Type.Number(),
    },
    { $id: "RouteLeg", additionalProperties: false },
);
export type RouteLeg = Static<typeof RouteLeg>;

/**
 * Anfang oder Ende einer Etappe. `place` ist ein Ort, auf den man klicken kann; `point` ein
 * Kartenpunkt der Anfrage (`place_id` ist dann seine Kennung `p:<x>:<y>`) oder eine Landmarke der Anfrage (`place_id` ist
 * `l:<uuid>`, `name` ihr Name, `subtype` ihre Art; WI-0271 L6). Alles andere hat keinen
 * Ort: `marker` (Legacy zeigt „Markierung"), `exit` („Abgangspunkt", dort verlässt die Reise den
 * Weg), `join` („Anschlusspunkt", dort trifft sie auf ihn), `landing` („Anlegestelle", dort wechselt
 * sie aufs Wasser oder von ihm herunter). Die Wörter setzt die Oberfläche.
 */
export const RouteStagePoint = Type.Object(
    {
        point: Type.Union([
            Type.Literal("place"),
            Type.Literal("point"),
            Type.Literal("marker"),
            Type.Literal("exit"),
            Type.Literal("join"),
            Type.Literal("landing"),
        ]),
        place_id: Type.Union([Type.String(), Type.Null()]),
        /** Der Ortsname; leer, wenn kein Ort da ist. */
        name: Type.String(),
        /**
         * Die Ortsklasse (`metropole`, `dorf` …), nur bei einem Ort. Die Oberfläche fliegt damit so nah
         * heran wie die Suche (`placeNearZoom`, WI-0039). Bei einer Landmarke der Anfrage ihre Art (`hoehle` …, WI-0271 L6).
         */
        subtype: Type.Optional(Type.String()),
        /**
         * Das UNTERSTE Herrschaftsgebiet mit Namen, in dem der Ort liegt (WI-0087 P3, additiv): dieselbe Ebene, die
         * der Untertitel des Infopanels nennt (`panel-header.ts`, letztes Glied der ersten Kette). Nur an einem
         * Wegpunkt der Anfrage und nur bei einem Ort; fehlt, wo der Ort in keinem Gebiet liegt. Die Etappenliste
         * nennt es als Objektlink und soll dafür nicht nachladen.
         */
        territory: Type.Optional(
            Type.Object({ id: Type.String(), name: Type.String() }, { additionalProperties: false }),
        ),
        /** Wo das Ende liegt, in `aventuria-v1`: beim Ort seine Lage, sonst der Knoten der Route. */
        x: Type.Number(),
        y: Type.Number(),
    },
    // 🪤 Kein `$id`: Das Schema steht zweimal in jeder Etappe (`from`, `to`), und Fastifys Serialisierer
    // weist eine Kennung ab, die „auf mehr als ein Schema" zeigt - die ganze Route würde 500.
    { additionalProperties: false },
);
export type RouteStagePoint = Static<typeof RouteStagePoint>;

/**
 * Ein Tag der Reise im aventurischen Kalender (WI-0038). `month` ist leer an einem Namenlosen Tag,
 * `day` zählt dann die Namenlosen Tage (1 bis 5).
 */
export const RouteDate = Type.Object(
    {
        month: Type.Union([oneOf(CALENDAR_MONTHS), Type.Literal("")]),
        day: Type.Integer(),
        nameless: Type.Boolean(),
        season: oneOf(SEASONS),
        years_passed: Type.Integer(),
    },
    // 🪤 Kein `$id`: dasselbe Schema steht mehrfach in der Antwort (siehe `RouteStagePoint`).
    { additionalProperties: false },
);
export type RouteDate = Static<typeof RouteDate>;

/** Die Grenze eines Sperrfensters: Monat und Tag, ohne Jahr. */
const WindowEnd = Type.Object({ month: oneOf(CALENDAR_MONTHS), day: Type.Integer() }, { additionalProperties: false });

/** Ein Weg mit Sperrzeit auf der Route, zusammengefasst über seine Stücke. */
const SeasonalWayFields = {
    path_name: Type.String(),
    public_ids: Type.Array(Type.String()),
    subtype: Type.String(),
    transport: Type.String(),
    /** Wo die Route den Weg erreicht (Ortsname, sonst leer). */
    from_node: Type.String(),
    /** Das Fenster, in dem der Weg für dieses Reisemittel gangbar ist. */
    open_from: WindowEnd,
    open_to: WindowEnd,
    /** Warum er sonst nicht gangbar ist, wo bekannt (`CLOSURE_REASONS`); ohne heißt es „Gesperrt“. */
    reason: Type.Optional(oneOf(CLOSURE_REASONS)),
};

/** Ohne Reisebeginn: ein Weg der Route, der nur zu bestimmten Zeiten gangbar ist (Legacy `seasonal_ways`). */
export const RouteSeasonalWay = Type.Object(SeasonalWayFields, { additionalProperties: false });
export type RouteSeasonalWay = Static<typeof RouteSeasonalWay>;

/** Die Zahlen einer Etappe zwischen zwei Wegpunkten: Strecke, Reisestunden und die Zeit samt Rast. */
const RouteLegFigures = Type.Object(
    { distance_units: Type.Number(), travel_hours: Type.Number(), total_hours: Type.Number() },
    { additionalProperties: false },
);

/**
 * Eine Sperre, die die Route umgeht (Legacy `closures[]`, Owner 14.09.2026 „Variante C“): Zwischen
 * den Wegpunkten `leg_index` hätte die Route ohne Sperre einen gesperrten Weg genommen. Sie zweigt an
 * `diverges_at_*` ab. `blocked` heißt: Es gibt gar keine offene Route, `actual` ist dann null.
 *
 * `avoided_anyway` (WI-0082, Betreiber 2026-10-05 „JA!“, Fassung C) ist der zweite Fall: Der Weg ist gesperrt, aber
 * die Route meidet ihn ohnehin - sie ist also **nicht wegen der Sperre** länger, sondern wegen der Jahreszeit.
 * Gemeldet wird er, weil er auf der Route läge, die diese Reise **ohne jede Wirkung der Jahreszeit** nähme.
 * Der Hinweis trägt dann einen eigenen Wortlaut OHNE Zeitangabe.
 */
export const RouteClosure = Type.Object(
    {
        leg_index: Type.Integer(),
        blocked: Type.Boolean(),
        /**
         * Der Weg ist gesperrt, aber die Route meidet ihn aus einem anderen Grund (WI-0082): Dann sagt der Hinweis
         * das, und `actual` und `unrestricted` nennen dieselben oder nahezu dieselben Zahlen - eine Verlängerung
         * durch die Sperre gibt es nicht. Fehlt im alten Fall „wegen der Sperre anders geführt“.
         */
        avoided_anyway: Type.Optional(Type.Boolean()),
        diverges_at_node: Type.String(),
        diverges_at_node_id: Type.String(),
        /** Die erste Kante der offenen Route, die von der gesperrten abweicht; leer bei `blocked`. */
        diverges_at_edge_id: Type.String(),
        avoided: Type.Array(
            Type.Object(
                {
                    kind: Type.Literal("season"),
                    ...SeasonalWayFields,
                    /** Der Tag, an dem die Route den Weg erreicht hätte. */
                    reached_on: RouteDate,
                },
                { additionalProperties: false },
            ),
        ),
        actual: Type.Union([RouteLegFigures, Type.Null()]),
        unrestricted: RouteLegFigures,
    },
    { additionalProperties: false },
);
export type RouteClosure = Static<typeof RouteClosure>;

/**
 * Eine Etappe des Reiseplans, gebildet wie Legacys (route-plan.js, `buildRoutePlanEntries` und
 * `cleanRoutePlanNoiseEntries`): Land bis zum nächsten echten Ort, gleichartiges Wasser zusammen,
 * und Querfeldein, Umstieg und Strömung trennen. Ihre Abschnitte sind `segment_count` Stück ab
 * `segment_start`.
 */
export const RouteStage = Type.Object(
    {
        index: Type.Integer(),
        /** Zwischen welchen Wegpunkten sie liegt: Etappe `legs[leg_index]`. */
        leg_index: Type.Integer(),
        segment_start: Type.Integer(),
        segment_count: Type.Integer(),
        /** Die Wegart der ERSTEN Teilstrecke, wie in Legacy; Querfeldein heißt `Querfeldein`. */
        type: Type.String(),
        transport: Type.String(),
        flow_state: Type.Union([Type.Literal("upstream"), Type.Literal("downstream"), Type.Null()]),
        /** Echte Wegnamen in Reihenfolge, ohne Wiederholung und ohne erzeugte Namen („Flussweg-12"). */
        path_names: Type.Array(Type.String()),
        from: RouteStagePoint,
        to: RouteStagePoint,
        distance_units: Type.Number(),
        travel_hours: Type.Number(),
        /** Die Rast, die auf DIESER Etappe fällig wird (Legacys Portionsregel über die ganze Route). */
        rest_hours: Type.Number(),
        /** Mit Reisebeginn: der Tag, an dem die Etappe beginnt, und der, an dem sie endet. */
        start_date: Type.Optional(RouteDate),
        end_date: Type.Optional(RouteDate),
        /** Der Boden der Jahreszeit auf der Etappe und um wie viel Prozent er sie verlängert (Legacys Vermerk). */
        ground: Type.Optional(
            Type.Object({ condition: Type.String(), percent: Type.Number() }, { additionalProperties: false }),
        ),
        /** Die Steigung der Etappe (WI-0049 S5d); fehlt, wenn keiner ihrer Abschnitte Höhen trägt. */
        slope: Type.Optional(RouteStageSlope),
        /** Der Zuschlag eines Flugs über der Reisehöhe (F4), summiert über die Abschnitte; fehlt an Land und ohne Höhenmodell. */
        air_extra: Type.Optional(RouteAirExtra),
        /** Was das Eiltempo auf dieser Etappe gebracht hat (WI-0078); fehlt, wo keiner ihrer Abschnitte geeilt ist. */
        hurry: Type.Optional(RouteHurry),
    },
    { $id: "RouteStage", additionalProperties: false },
);
export type RouteStage = Static<typeof RouteStage>;

/**
 * Womit ein Flug gerechnet wurde (WI-0051): das Flugmittel oder `custom`, Tempo in Meilen je Stunde,
 * Reisehöhe in Schritt über Grund - bei einem Profil die Werte des Reisemodells -, die daraus abgeleitete
 * höchste Höhe über Grund (`airMaxAboveGround`: Reisehöhe × 1.000 %) und die höchste Höhe über dem Meer
 * (`airCeilingAbsolute`: 5.000 Schritt, für alle gleich; Betreiber 2026-10-04).
 */
export const RouteAirEcho = Type.Object(
    {
        profile: oneOf(AIR_CHOICES),
        speed_mph: Type.Number(),
        altitude_schritt: Type.Number(),
        max_above_ground_schritt: Type.Number(),
        ceiling_schritt: Type.Number(),
    },
    { additionalProperties: false },
);
export type RouteAirEcho = Static<typeof RouteAirEcho>;

/**
 * Die Reisekosten je Person für EINE Unterbringungsstufe (`TravelCosts` aus `travel-costs.ts`, WI-0065): Posten
 * mit Status, die Nächte nach ihrem Dach, Reisetage, Reittiere, Summe und ob jeder Posten eine Zahl hat.
 * 🪤 Kein `$id`: Das Schema steht vier Mal in `by_lodging` (siehe `RouteStagePoint`).
 */
export const RouteCosts = Type.Object(
    {
        rows: Type.Array(
            Type.Object(
                {
                    key: oneOf(TRAVEL_COST_KEYS),
                    /** Ganze Heller; `null`: nicht ermittelbar (Plan 6.20, 6.62), nie 0. */
                    heller: Type.Union([Type.Number(), Type.Null()]),
                    status: oneOf(COST_STATUSES),
                    /** Was der Posten zählt: Nächte, Reisetage, Meilen oder Landesgrenzen. */
                    count: Type.Number(),
                },
                { additionalProperties: false },
            ),
        ),
        nights: Type.Object(
            { inn: Type.Integer(), open: Type.Integer(), aboard: Type.Integer() },
            { additionalProperties: false },
        ),
        days: Type.Integer(),
        mounts: Type.Integer(),
        total: Type.Number(),
        complete: Type.Boolean(),
    },
    { additionalProperties: false },
);
export type RouteCosts = Static<typeof RouteCosts>;

/**
 * Ein Gebiet an einer Landesgrenze: Kennung, Name und Kurzname (Legacy `short_name`, sonst der Name) für die Liste im
 * Planer - „Heiliges Neues Kaiserreich vom Greifenthron zu Gareth“ ist für eine Zeile zu lang.
 */
const RouteBorderTerritory = Type.Object(
    { id: Type.String(), name: Type.String(), short_name: Type.String() },
    { additionalProperties: false },
);

/**
 * Die Landesgrenzen der Reise nach Legacys Regel (`travel-borders.ts`): ihre Zahl und je Übertritt von wo nach wo
 * und an welchem Punkt (der erste Abtastpunkt im neuen Gebiet, `aventuria-v1`).
 */
export const RouteBorders = Type.Object(
    {
        count: Type.Integer(),
        /**
         * WI-0065 Z1 (A+): Ein Schiffsstück der Reise verbindet zwei verschiedene Reiche. Kein Zoll (Legacy: offene See
         * trägt keinen), aber die Quelle nennt den Hafenzoll „nicht beziffert“: Die Oberfläche sagt es im Vermerk.
         */
        harbour_toll_unknown: Type.Boolean(),
        crossings: Type.Array(
            Type.Object(
                {
                    from: RouteBorderTerritory,
                    to: RouteBorderTerritory,
                    x: Type.Number(),
                    y: Type.Number(),
                },
                { additionalProperties: false },
            ),
        ),
    },
    { additionalProperties: false },
);
export type RouteBorders = Static<typeof RouteBorders>;

/**
 * Die Reisekosten im Result (WI-0065, Hardening Review M3 „B′“): der Server rechnet alle vier Unterbringungsstufen
 * mit derselben `shared`-Funktion (`buildRouteTravelCosts`); der Browser wählt die Stufe und rechnet nichts. Der
 * Plan nennt das Feld `monetary_cost` (Kap. 6.10, 6.48); gemeint ist `travel_costs.by_lodging.<stufe>.total`.
 * 🪤 Kein `$id`, wie bei den anderen Teilen der Antwort.
 */
export const RouteTravelCosts = Type.Object(
    {
        /** Die Landesgrenzen; `null`: nicht ermittelbar (keine Gebiete abgeleitet), dann ist der Zoll `null`, nie 0. */
        borders: Type.Union([RouteBorders, Type.Null()]),
        /** Das Anzeigejahr (BF), für das die Gebiete gelten; `null`, wenn `borders` `null` ist. */
        territory_year_bf: Type.Union([Type.Integer(), Type.Null()]),
        by_lodging: Type.Object(
            Object.fromEntries(LODGING_LEVELS.map((level) => [level, RouteCosts])) as Record<
                LodgingLevel,
                typeof RouteCosts
            >,
            { additionalProperties: false },
        ),
    },
    { additionalProperties: false },
);
export type RouteTravelCosts = Static<typeof RouteTravelCosts>;

export const RouteResponse = Type.Object(
    {
        found: Type.Boolean(),
        /**
         * Warum es keine Route gibt (Kap. 6.49): kein zusammenhängendes Netz, oder nur über Wege, die zu
         * der Zeit gesperrt sind (`season_closed`, dann steht die Sperre in `closures`).
         */
        reason: Type.Optional(Type.Union([Type.Literal("network_disconnected"), Type.Literal("season_closed")])),
        /** Die Etappe zwischen zwei Wegpunkten, an der die Route scheiterte. */
        failed_leg_index: Type.Union([Type.Integer(), Type.Null()]),
        /** Nur im Flug: womit gerechnet wurde. */
        air: Type.Optional(RouteAirEcho),
        map_domain: Type.String(),
        /** Fingerabdruck des Reisemodells (`config/travel-model/`). */
        travel_model_version: Type.String(),
        /**
         * Änderungsmelder des Wegenetzes, aus dem gerechnet wurde: Anzahl und letzter
         * Änderungszeitpunkt je Tabelle. Er wechselt, sobald sich die Daten ändern, ist aber nur
         * innerhalb EINER Umgebung vergleichbar, denn Importzeitpunkte gehen ein. Lokal und Stage
         * vergleicht man über die Ergebnisse (Proben), nicht über diesen Wert.
         */
        routing_graph_revision: Type.String(),
        /**
         * Die zwei Teile der Revision, an denen eine Route am häufigsten hängt, einzeln (Plan 6.48, Hardening Review
         * M6): der Kartenstand (Orte, Kreuzungen, Wege, Regionen, Flächen) und das Gelände (null ohne Gelände). So
         * sieht man an zwei Antworten, ob sich die Karte oder das Gelände geändert hat. Vergleichbar wie oben nur
         * innerhalb einer Umgebung.
         */
        map_revision: Type.Optional(Type.String()),
        terrain_revision: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        waypoints: Type.Array(Type.Object({ id: Type.String(), name: Type.String() })),
        legs: Type.Array(RouteLeg),
        segments: Type.Array(RouteSegment),
        distance_units: Type.Number(),
        /** Reisestunden ohne Querfeldein-Aufschlag, wie der Reiseplan der Karte. */
        travel_hours: Type.Number(),
        travel_days: Type.Number(),
        /** Die Reisestunden je Tag an Land, mit denen gerechnet wurde. */
        hours_per_day: Type.Number(),
        rest_hours: Type.Number(),
        /** Reisezeit und Rast zusammen, Legacys „Gesamte Reisezeit". */
        total_hours: Type.Number(),
        /** Meilen je Karteneinheit, damit keine Oberfläche die 3 selbst kennen muss. */
        miles_per_unit: Type.Number(),
        /** Der Drachenflug: je Paar aufeinanderfolgender Wegpunkte die Luftlinie, in Karteneinheiten. */
        air_legs_units: Type.Array(Type.Number()),
        stages: Type.Array(RouteStage),
        /** Die Steigung der Reise (WI-0049 S5d); fehlt, wenn keine Etappe Höhen trägt. */
        slope: Type.Optional(RouteSlope),
        /** Der Zuschlag des Flugs über der Reisehöhe (F4) über die ganze Reise; fehlt an Land und ohne Höhenmodell. */
        air_extra: Type.Optional(RouteAirExtra),
        /** Die Mehrzeit durch Schnee und Eis über die ganze Reise (`RouteSnow`); nur mit Reisebeginn und wo es sie gibt. */
        snow: Type.Optional(RouteSnow),
        /**
         * Was das Eiltempo über die ganze Reise gebracht hat (WI-0078); fehlt ohne Eiltempo und dann, wenn kein
         * Abschnitt geeignet war - dass der Haken gesetzt war, weiß der Planer selbst.
         */
        hurry: Type.Optional(RouteHurry),
        /** Die Reisekosten je Person für alle vier Unterbringungsstufen (WI-0065); fehlt im Flug (keine Kosten, Plan 6.37). */
        travel_costs: Type.Optional(RouteTravelCosts),
        /** Der Reisebeginn der Anfrage und der Tag der Ankunft; beide nur mit Reisebeginn. */
        departure: Type.Optional(RouteDate),
        arrival: Type.Optional(RouteDate),
        /** Die Sperren, die die Route umgeht oder an denen sie scheitert; nur mit Reisebeginn und nie leer. */
        closures: Type.Optional(Type.Array(RouteClosure)),
        /** Ohne Reisebeginn: die Wege der Route mit Sperrzeiten; nie leer. */
        seasonal_ways: Type.Optional(Type.Array(RouteSeasonalWay)),
        /**
         * `cross_country`: Die Route nutzt eine Querfeldein-Notverbindung (nicht den Gang zu einem Kartenpunkt).
         * `free_sea_unavailable`: See war verlangt, aber es gibt keinen passenden Seegraphen für das Schiff; die Route hat
         * keine Seereise (seit WI-0153 Schnitt 7e kein Rückfall auf gezeichnete Seewege).
         */
        warnings: Type.Array(Type.Union([Type.Literal("cross_country"), Type.Literal("free_sea_unavailable")])),
    },
    { $id: "RouteResponse", additionalProperties: false },
);
export type RouteResponse = Static<typeof RouteResponse>;

/**
 * Wie viele Vorschläge die Wegpunktsuche höchstens liefert - wie Legacys Planer (20).
 */
export const WAYPOINT_LOOKUP_LIMIT = 20;

/**
 * Ein Vorschlag für ein Wegpunktfeld (`GET /api/route/waypoints?q=`). Orte und Landmarken, denn nur sie sind
 * Wegpunkte (WI-0271 L6, §4.3) - und anders als die Spotlightsuche auch VERSTECKTE, mit `hidden`: Legacys Planer bietet
 * sie mit dem Vermerk „(verborgen)" an (Betreiber 2026-09-23: wie Legacy).
 *
 * Eine Landmarke trägt `id` = `l:<uuid>`, in `subtype` und `landmark` ihre Art; `hidden` heißt bei ihr „nicht auf der Karte
 * angezeigt“ (`terrain_peak.show_name`). Ein Ort trägt `landmark` nie: Seine Antwort ist dieselbe wie vor WI-0271.
 */
export const WaypointHit = Type.Object(
    {
        id: Type.String(),
        name: Type.String(),
        subtype: Type.String(),
        hidden: Type.Boolean(),
        /** Kartenkoordinate in `aventuria-v1`. */
        x: Type.Number(),
        y: Type.Number(),
        /** Nur bei einer Landmarke (WI-0271 L6): ihre Art aus `LANDMARKEN_KATALOG`, immer eine, die Reiseziel sein darf. */
        landmark: Type.Optional(oneOf(LANDMARKEN_ARTEN)),
    },
    { $id: "WaypointHit", additionalProperties: false },
);
export type WaypointHit = Static<typeof WaypointHit>;

export const WaypointResponse = Type.Object(
    {
        query: Type.String(),
        hits: Type.Array(WaypointHit),
        truncated: Type.Boolean(),
    },
    { $id: "WaypointResponse", additionalProperties: false },
);
export type WaypointResponse = Static<typeof WaypointResponse>;

/**
 * Der nächste sichtbare Ort zu einem Kartenpunkt (`GET /api/route/waypoints/nearest?x=&y=`), für
 * „Nächsten Ort finden“ im Kontextmenü und die Beschriftung eines Kartenpunkts („bei Gareth“).
 * `distance` in Karteneinheiten; ohne Orte `null`.
 */
export const WaypointNearestResponse = Type.Object(
    {
        place: Type.Union([WaypointHit, Type.Null()]),
        distance: Type.Union([Type.Number(), Type.Null()]),
    },
    { $id: "WaypointNearestResponse", additionalProperties: false },
);
export type WaypointNearestResponse = Static<typeof WaypointNearestResponse>;

/**
 * Warum ein Kartenpunkt nicht erreichbar ist (422, Legacys Codes aus `offroad-leg.php`), in Legacys
 * Reihenfolge geprüft: `point_not_on_land` (im Wasser oder auf keiner Landfläche),
 * `offroad_transport_not_allowed` (das Landmittel darf nicht querfeldein, die Kutsche),
 * `no_exit_node` (kein Weg und kein Ort, an dem man aufbrechen könnte), `no_offroad_route` (keiner
 * davon ist querfeldein zu erreichen). `detail` nennt den Kartenpunkt.
 */
export const MAP_POINT_REFUSALS = [
    "point_not_on_land",
    "offroad_transport_not_allowed",
    "no_exit_node",
    "no_offroad_route",
] as const;
export type MapPointRefusal = (typeof MAP_POINT_REFUSALS)[number];

/**
 * Wenn keine Rechnung zustande kommt. `unknown_waypoint` (400): kein Ort mit dieser Kennung, oder keine aktive
 * Landmarke, deren Art Reiseziel sein darf (`l:<uuid>`, WI-0271 L6).
 * `routing_busy` und `routing_timeout` (503, `Retry-After`): Claudios Budget - höchstens eine
 * Rechnung zur Zeit, Warteschlange begrenzt, Antwort nach spätestens 2 s. Dazu die Absagen eines
 * Kartenpunkts (422, `MAP_POINT_REFUSALS`) und `route_too_large` (422, `ROUTE_RESPONSE_LIMITS`;
 * `detail` nennt, was überlief; `sea_legs:<n>` bei mehr als `ROUTE_FREE_SEA_LIMIT` Seereisen,
 * `flight_legs:<n>` bei mehr als `ROUTE_FLIGHT_SEARCH_LIMIT` Flugetappen um Gebirge).
 * `too_many_map_points` (400): mehr als `ROUTE_MAP_POINT_LIMIT`
 * Kartenpunkte und Landmarken zusammen. `routing_busy` kommt auch, wenn DIESER Client schon zu viele offene Rechnungen hat.
 */
export const RouteError = Type.Object(
    {
        error: Type.Union([
            Type.Literal("unknown_waypoint"),
            Type.Literal("routing_busy"),
            Type.Literal("routing_timeout"),
            Type.Literal("routing_failed"),
            Type.Literal("database_unavailable"),
            Type.Literal("point_not_on_land"),
            Type.Literal("offroad_transport_not_allowed"),
            Type.Literal("no_exit_node"),
            Type.Literal("no_offroad_route"),
            Type.Literal("route_too_large"),
            Type.Literal("too_many_map_points"),
        ]),
        detail: Type.Optional(Type.String()),
    },
    { $id: "RouteError", additionalProperties: false },
);
export type RouteError = Static<typeof RouteError>;
