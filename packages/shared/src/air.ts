import { flightSurcharge } from "./flight-altitude.ts";
import type { TravelModel } from "./travel-model.ts";

/**
 * Der Flug als Verkehrsart (WI-0051, Plan 6.34–6.37, 12.26): die Flugmittel des Reisemodells (`flug`), die
 * Flugparameter einer Anfrage und die Namen, unter denen ein Flug in der Route steht.
 *
 * - **Keine Wegart der Karte, keine Domäne.** Ein Flug nimmt keinen Weg und kein Wasser; Wegarten, Mittel je
 *   Domäne und Optimierung gelten im Flug nicht. `routeDomain("Flug")` bleibt „Land“, wie jede fremde Wegart.
 * - **Reisetag wie an Land** (Betreiber 2026-09-28, F-E2 = A): die Reisestunden des Planers und dieselbe Rast
 *   (`stageDayHours`, `travelDayHours`).
 * - **Das Tempo ist echt**, anders als die Tafel `tempo` nicht um den Zeitfaktor überhöht: Stunden = Meilen /
 *   Tempo.
 * - Die Reisehöhe ist Höhe über Grund (F-E1 = C), für Anzeige und Flugbogen.
 * - **Zwei Höchstgrenzen** (Betreiber 2026-10-04, ersetzt „Höchstflughöhe über dem Meer = Reisehöhe × 1.000 %“,
 *   das Hexenbesen, Teppich und Flugechse um fast jedes Gebirge schickte):
 *   - über Grund: ein Flugmittel steigt höchstens auf Reisehöhe × `hoechstflughoeheProzent` über dem Boden direkt
 *     unter ihm (`airMaxAboveGround`; „das Flugmittel erreicht das 10x der Höhe über Grund“);
 *   - über dem Meer: nie höher als `hoechstflughoeheAbsolutSchritt` (`airCeilingAbsolute`, 5.000 Schritt, für alle
 *     Flugmittel gleich, auch das eigene; „in großen Höhen wird der Sauerstoff knapp“).
 *   Umflogen wird nur Gelände, das höher liegt als die absolute Höchstflughöhe minus den Mindestabstand (F2); darunter
 *   steigt das Flugmittel über das Gelände.
 * - **Höhe kostet Zeit** (F4, Betreiber 2026-10-04: „ich will, dass die lieber um hohe berge herumfliegen als einfach
 *   drüber“): Auf der Standardflughöhe über Grund (`airStandardHeight`) zu fliegen und der Aufstieg dorthin kosten nichts;
 *   Steigen und Halten darüber kosten Zeit (`airSurcharge`, `flightSurcharge` in `flight-altitude.ts`; die Faktoren
 *   `steigkostenFaktor` und `haltekostenFaktor` stehen je einmal im Reisemodell). Der Dienst nimmt je Etappe den Weg mit
 *   der kürzesten Zeit samt Zuschlag (`air-weigh.ts`).
 */

/** Die Gruppen der Flugmittel, in der Reihenfolge des Zielbilds (WI-0050). */
export const AIR_GROUPS = ["devices", "mounts", "summoned", "extraordinary"] as const;
export type AirGroup = (typeof AIR_GROUPS)[number];

/** Das eigene Flugmittel: Tempo und Höhe stehen in der Anfrage, nicht im Reisemodell. */
export const CUSTOM_AIR = "custom";

/** Die Wegart des Flugs: Ein Flugabschnitt (`subtype`) und seine Etappe (`type`) heißen so. */
export const AIR_TYPE = "Flug";
/** Die Kennung eines Flugabschnitts beginnt so; dahinter stehen die beiden Wegpunkte. */
export const AIR_EDGE_PREFIX = "flug-";

export type AirProfile = TravelModel["flug"]["wert"]["profile"][number];
/** Die Grenzen eines Werts des eigenen Flugmittels. */
export type AirLimit = TravelModel["flug"]["wert"]["eigenes"]["tempo"];

/** Die Kennungen der Flugmittel des Reisemodells, in seiner Reihenfolge; ohne `custom`. */
export function airProfileIds(model: TravelModel): string[] {
    return model.flug.wert.profile.map((profile) => profile.id);
}

export function airProfile(model: TravelModel, id: string): AirProfile | undefined {
    return model.flug.wert.profile.find((profile) => profile.id === id);
}

/** Ist das Reisemittel ein Flugmittel - ein Profil des Reisemodells oder das eigene? */
export function isAirTransport(model: TravelModel, transport: string): boolean {
    return transport === CUSTOM_AIR || airProfile(model, transport) !== undefined;
}

/**
 * Wie hoch ein Flugmittel über dem Boden direkt unter ihm höchstens steigt, in Schritt: die Reisehöhe mal
 * `hoechstflughoeheProzent` des Reisemodells (Betreiber 2026-10-04). Dieselbe Rechnung für jedes Flugmittel und das
 * eigene; Server und Oberfläche fragen nur hier.
 */
export function airMaxAboveGround(model: TravelModel, altitudeSchritt: number): number {
    return (altitudeSchritt * model.flug.wert.hoechstflughoeheProzent) / 100;
}

/**
 * Die höchste Flughöhe über dem Meer, in Schritt: für alle Flugmittel gleich (`hoechstflughoeheAbsolutSchritt`,
 * Betreiber 2026-10-04). Gelände darüber, samt Mindestabstand, wird umflogen.
 */
export function airCeilingAbsolute(model: TravelModel): number {
    return model.flug.wert.hoechstflughoeheAbsolutSchritt;
}

/**
 * Die Standardflughöhe über Grund, in Schritt: die Reisehöhe, mindestens der Mindestabstand (die Bahn fliegt nie
 * tiefer als Boden + Mindestabstand, `flightAltitude`; ein Hexenbesen mit 100 Schritt Reisehöhe fliegt also 200
 * über dem Boden). Auf ihr zu fliegen kostet nichts (F4, `flightSurcharge`).
 */
export function airStandardHeight(model: TravelModel, altitudeSchritt: number): number {
    return Math.max(altitudeSchritt, model.flug.wert.mindestabstandSchritt);
}

/** Die Werte, mit denen die Bahn über der Reisehöhe bewertet wird (`flightSurcharge`), für ein Flugmittel. */
export interface AirSurchargeRule {
    standard: number;
    scale: number;
    climbFactor: number;
    holdFactor: number;
}

export function airSurchargeRule(model: TravelModel, altitudeSchritt: number): AirSurchargeRule {
    return {
        standard: airStandardHeight(model, altitudeSchritt),
        scale: airMaxAboveGround(model, altitudeSchritt),
        climbFactor: model.flug.wert.steigkostenFaktor,
        holdFactor: model.flug.wert.haltekostenFaktor,
    };
}

/** 1 Meile = 1.000 Schritt. */
const SCHRITT_JE_MEILE = 1000;

/** Die Stunden einer zusätzlichen Strecke in Schritt bei dem Tempo des Flugmittels. */
export function airSurchargeHours(extraSchritt: number, speedMph: number): number {
    return extraSchritt / SCHRITT_JE_MEILE / speedMph;
}

/** Der Zuschlag einer Bahn über der Reisehöhe, in Schritt Strecke und in Stunden, dazu der größte Überstand. */
export interface AirSurcharge {
    climbSchritt: number;
    holdSchritt: number;
    climbHours: number;
    holdHours: number;
    /** Steigen und Halten zusammen, in Stunden. */
    hours: number;
    /** Der größte Überstand über Boden + Standardflughöhe, in Schritt. */
    peakSchritt: number;
}

/**
 * Der Zuschlag einer Flugbahn (F4): `ground` und `altitude` je Probe in Schritt über dem Meer, `lengthSchritt` die
 * Länge der Strecke. Ohne Probe und ohne Länge 0.
 */
export function airSurcharge(
    model: TravelModel,
    air: Pick<RouteAir, "altitudeSchritt" | "speedMph">,
    track: { ground: ArrayLike<number>; altitude: ArrayLike<number>; lengthSchritt: number },
): AirSurcharge {
    const rule = airSurchargeRule(model, air.altitudeSchritt);
    const { climb, hold, peak } = flightSurcharge({
        ground: track.ground,
        altitude: track.altitude,
        length: track.lengthSchritt,
        ...rule,
    });
    const climbHours = airSurchargeHours(climb, air.speedMph);
    const holdHours = airSurchargeHours(hold, air.speedMph);
    return {
        climbSchritt: climb,
        holdSchritt: hold,
        climbHours,
        holdHours,
        hours: climbHours + holdHours,
        peakSchritt: peak,
    };
}

/** Womit ein Flug rechnet: das Flugmittel (Profil oder `custom`), sein Tempo, seine Reisehöhe und die Höchstgrenzen. */
export interface RouteAir {
    profile: string;
    /** Meilen je Stunde, echt. */
    speedMph: number;
    /** Schritt über Grund. */
    altitudeSchritt: number;
    /** Schritt über Grund (`airMaxAboveGround`): Höher als so weit über dem Boden darunter steigt das Flugmittel nie. */
    maxAboveGroundSchritt: number;
    /**
     * Schritt über dem Meer (`airCeilingAbsolute`), für alle Flugmittel gleich: Darüber ragendes Gelände, samt
     * Mindestabstand, wird umflogen, und höher als so steigt die Bahn nie.
     */
    ceilingSchritt: number;
}

/** Die Flugparameter einer Anfrage, so wie sie in der Adresse stehen (`RouteQuerystring`). */
export interface AirQuery {
    air?: string | undefined;
    air_speed?: number | undefined;
    air_altitude?: number | undefined;
}

export type AirQueryResult =
    | { ok: true; air: RouteAir | null }
    | { ok: false; parameter: "air" | "air_speed" | "air_altitude"; message: string };

/** Liegt der Wert in den Grenzen, mit höchstens so vielen Nachkommastellen? */
function withinLimit(value: number, limit: AirLimit): string | null {
    if (!Number.isFinite(value) || value < limit.min || value > limit.max) {
        return `must be between ${String(limit.min)} and ${String(limit.max)}`;
    }
    const scaled = value * 10 ** limit.nachkommastellen;
    if (Math.abs(scaled - Math.round(scaled)) > 1e-6) {
        return `must have at most ${String(limit.nachkommastellen)} decimal places`;
    }
    return null;
}

/**
 * Die Flugparameter einer Anfrage, aufgelöst gegen das Reisemodell. Ohne `air` wird nicht geflogen (`null`).
 *
 * - Ein Profil bringt Tempo und Höhe aus dem Reisemodell mit; `air_speed` und `air_altitude` sind dann
 *   **verboten**, damit keine Oberfläche glaubt, sie hätte ein Profil verstellt.
 * - `custom` verlangt `air_speed`; ohne `air_altitude` gilt die Vorgabe des eigenen Flugmittels.
 * - Die Höchstgrenzen folgen immer aus dem Reisemodell (`airMaxAboveGround` aus der Reisehöhe, `airCeilingAbsolute`),
 *   auch beim eigenen Flugmittel; einen eigenen Parameter dafür gibt es nicht.
 * - Ohne `air` sind `air_speed` und `air_altitude` ebenfalls verboten.
 * - Die Grenzen des eigenen Flugmittels samt Nachkommastellen (`flug.eigenes`). Die Stellen prüft erst diese
 *   Funktion: `multipleOf: 0.1` scheitert im Schema an der Fließkommadivision (0,3 / 0,1).
 */
export function resolveAirQuery(model: TravelModel, query: AirQuery): AirQueryResult {
    const { air, air_speed: speed, air_altitude: altitude } = query;
    if (air === undefined) {
        if (speed !== undefined) return { ok: false, parameter: "air_speed", message: "requires air=custom" };
        if (altitude !== undefined) return { ok: false, parameter: "air_altitude", message: "requires air=custom" };
        return { ok: true, air: null };
    }
    const limits = model.flug.wert.eigenes;
    if (air === CUSTOM_AIR) {
        if (speed === undefined) return { ok: false, parameter: "air_speed", message: "is required with air=custom" };
        const speedProblem = withinLimit(speed, limits.tempo);
        if (speedProblem) return { ok: false, parameter: "air_speed", message: speedProblem };
        const altitudeSchritt = altitude ?? limits.reisehoehe.vorgabe;
        const altitudeProblem = withinLimit(altitudeSchritt, limits.reisehoehe);
        if (altitudeProblem) return { ok: false, parameter: "air_altitude", message: altitudeProblem };
        return {
            ok: true,
            air: {
                profile: CUSTOM_AIR,
                speedMph: speed,
                altitudeSchritt,
                maxAboveGroundSchritt: airMaxAboveGround(model, altitudeSchritt),
                ceilingSchritt: airCeilingAbsolute(model),
            },
        };
    }
    const profile = airProfile(model, air);
    if (!profile) return { ok: false, parameter: "air", message: "must be a flight profile or custom" };
    if (speed !== undefined) return { ok: false, parameter: "air_speed", message: "is only allowed with air=custom" };
    if (altitude !== undefined) {
        return { ok: false, parameter: "air_altitude", message: "is only allowed with air=custom" };
    }
    return {
        ok: true,
        air: {
            profile: profile.id,
            speedMph: profile.tempo,
            altitudeSchritt: profile.reisehoehe,
            maxAboveGroundSchritt: airMaxAboveGround(model, profile.reisehoehe),
            ceilingSchritt: airCeilingAbsolute(model),
        },
    };
}
