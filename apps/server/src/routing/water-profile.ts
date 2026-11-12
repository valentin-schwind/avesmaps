import { werte } from "./einstellungen.ts";
import {
    AVENTURIA_FLIGHT_CARTOGRAPHY,
    airSurcharge,
    flightAltitude,
    routeDomain,
    type AirSurcharge,
    type ElevationSurface,
    type RouteAir,
    type TravelModel,
} from "@avesmaps3d/shared";
import { domainHeightAt } from "../terrain/domain/read.ts";
import { compactProfile, type ProfilePoint } from "./elevation-profile.ts";
import { reliefAt, type TerrainHeights } from "./relief.ts";

/**
 * Die Höhenlinie der Wasserabschnitte und des Flugs (WI-0065 Nachtrag 2026-10-03, Betreiber: „A: Durchgehend
 * zeichnen. Flüsse folgen dem Flussbett aus dem Geländemodell, Meer und Seen liegen auf ihrer Wasserhöhe“).
 *
 * 🔴 Das Profil wird zur Antwortzeit im schon geladenen Domain-Höhenmodell abgetastet (`terrain-load.ts`, nichts
 * abgeleitet, nichts gespeichert). Das Wasserprofil ist nur Anzeige und fließt in keine Zeit, keine Steigung (`slope`)
 * und keine Wegwahl: Wasser kostet keine Steigungszeit; die Zusammenfassung der Reise bleibt auf Land bezogen. Der Flug
 * ist die Ausnahme (WI-0051 F4): Seine Bahn bestimmt den Zuschlag über der Reisehöhe, der in Zeit und Wegwahl einfließt.
 *
 * - **Fluss:** das Flussbett, bilinear im Modell entlang der Geometrie des Abschnitts in Fahrtrichtung. Das Modell
 *   brennt Flüsse ein und lässt sie nicht bergauf fließen (ADR-0016); stromauf steigt die Linie also, stromab fällt sie.
 *   Wo das Modell einen geschützten Gipfel am Flussbett lässt, steht diese Stufe auch hier: nichts wird geglättet.
 * - **Seeweg:** liegt der Abschnitt im Meer (Höhe 0 im Modell), ist die Linie 0. Liegt er auf einem Binnensee, ist sie
 *   der ebene Spiegel des Sees (der Mittelwert der Abtastwerte; an den Ufern mischt die bilineare Abtastung Land in
 *   die Randwerte). Welche Art es ist, entscheidet der mittlere Abtastwert gegen `SEA_LEVEL`.
 * - **Flug:** das Gelände unter der Linie (Meer ist dort 0) und die Flughöhe über dem Meer nach `flightAltitude`
 *   (`shared`), derselben Rechnung wie die Bahn auf der Karte; dazu der Zuschlag über der Reisehöhe (`flightTrack`,
 *   `airSurcharge`).
 * - Ohne Höhenmodell gibt es keine Linie (Lücke), nie eine erfundene Höhe.
 */

/**
 * Wie weit die Abtastwerte auseinanderliegen: bewusst 0,25 E, wie `lineShape` (`LINE_STEP`), unabhängig von der
 * Auflösung des Höhenmodells (beim 8k-Raster ist die Zelle 0,125 E). Die Schrittweite bestimmt Anzeige und
 * Antwortgröße (Entscheidung der Koordination), nicht die Genauigkeit der Höhe.
 */
const SAMPLE_STEP = 0.25;
/** So viele Abtastwerte höchstens je Abschnitt; darüber wird gröber abgetastet. */
const MAX_SAMPLES = 2048;
/** Der Flug tastet je Abschnitt zwischen so vielen Proben ab, wie die Bahn auf der Karte (`proben` der Flugkartografie). */
const FLIGHT_SAMPLES = { min: 32, max: 1600 } as const;
/** Bis zu dieser mittleren Höhe in Schritt gilt ein Seeweg als Meer (Meer ist im Modell exakt 0). */
export const SEA_LEVEL = 0.5;

type Position = readonly [number, number];

/** Die Höhe des Bodens an einem Punkt, in Schritt: im Domain-Modell bilinear, sonst wie überall (`reliefAt`). */
export function groundHeightAt(heights: TerrainHeights, x: number, y: number): number {
    return heights.domain ? domainHeightAt(heights.domain, x, y) : reliefAt(heights, x, y).height;
}

/** Eine Höhe auf eine Zehntelstufe gerundet: kleiner in der Antwort, die Ordnung der Werte bleibt. */
const tenth = (value: number): number => Math.round(value * 10) / 10;

export interface LineSamples {
    /** Abstand ab Beginn der Linie, in Karteneinheiten. */
    at: number[];
    height: number[];
    /** Länge der Linie in Karteneinheiten. */
    length: number;
}

/**
 * Tastet die Höhe einer Linie in gleichen Abständen ab, erster und letzter Punkt eingeschlossen: höchstens alle
 * `SAMPLE_STEP`, zwischen `min` und `max` Werten. Null bei einer Linie ohne Länge.
 */
function sampleLine(
    heights: TerrainHeights,
    coordinates: readonly Position[],
    count: { min: number; max: number },
): LineSamples | null {
    const run = [0];
    for (let i = 1; i < coordinates.length; i += 1) {
        const [ax, ay] = coordinates[i - 1] as Position;
        const [bx, by] = coordinates[i] as Position;
        run.push((run[i - 1] as number) + Math.hypot(bx - ax, by - ay));
    }
    const length = run[run.length - 1] ?? 0;
    if (!(length > 0)) return null;
    const total = Math.min(count.max, Math.max(count.min, Math.ceil(length / SAMPLE_STEP) + 1));
    const at: number[] = [];
    const height: number[] = [];
    let piece = 1;
    for (let k = 0; k < total; k += 1) {
        const s = (length * k) / (total - 1);
        while (piece < coordinates.length - 1 && (run[piece] as number) < s) piece += 1;
        const [ax, ay] = coordinates[piece - 1] as Position;
        const [bx, by] = coordinates[piece] as Position;
        const from = run[piece - 1] as number;
        const span = (run[piece] as number) - from;
        const f = span > 0 ? Math.min(1, Math.max(0, (s - from) / span)) : 0;
        at.push(s);
        height.push(groundHeightAt(heights, ax + (bx - ax) * f, ay + (by - ay) * f));
    }
    return { at, height, length };
}

/** Höchstens so viele Abtastwerte je Linie im Reiter „Gebirge“ (WI-0245): ein Profil ist eine kleine Zeichnung. */
const LINIE_MAX = 256;

/**
 * Höhen entlang einer Linie (Karteneinheiten) im geladenen Höhenmodell, dieselbe Abtastung wie das Flussbett der Route (WI-0245, Profile
 * der Flüsse und Pässe im Reiter „Gebirge“). `null` ohne Länge.
 */
export function linienHoehen(
    heights: TerrainHeights,
    coordinates: readonly Position[],
): { at: number[]; height: number[] } | null {
    const samples = sampleLine(heights, coordinates, { min: 2, max: LINIE_MAX });
    return samples === null ? null : { at: samples.at, height: samples.height };
}

const median = (values: readonly number[]): number =>
    [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] as number;

/** Die Linie eines Wasserabschnitts samt der Art, auf der sie liegt. */
export interface SurfaceProfile {
    surface: ElevationSurface;
    profile: ProfilePoint[];
}

/**
 * Die Höhenlinie eines Fluss- oder Seeabschnitts in Fahrtrichtung; Null für jeden Landabschnitt, ohne Höhenmodell
 * und bei einem Abschnitt ohne Länge. `distance` ist die gemeldete Länge des Abschnitts in Karteneinheiten (bei der
 * freien Seefahrt nicht die der Linie): Die Abstände der Linie werden darauf gestreckt, damit sie über den Abschnitt
 * reicht wie das Profil eines Wegs.
 */
export function waterSurfaceProfile(
    subtype: string,
    coordinates: readonly Position[],
    distance: number,
    heights: TerrainHeights | null | undefined,
    limit: number,
): SurfaceProfile | null {
    const domain = routeDomain(subtype);
    if (domain === "land" || !heights || !(distance > 0)) return null;
    const samples = sampleLine(heights, coordinates, { min: 2, max: MAX_SAMPLES });
    if (!samples) return null;
    if (domain === "river") {
        const scale = distance / samples.length;
        const points: ProfilePoint[] = samples.at.map((at, k) => [at * scale, tenth(samples.height[k] as number)]);
        return { surface: "river", profile: compactProfile(points, limit) };
    }
    const level = median(samples.height);
    if (level <= werte().seaLevel) {
        return {
            surface: "sea",
            profile: [
                [0, 0],
                [distance, 0],
            ],
        };
    }
    return {
        surface: "lake",
        profile: [
            [0, tenth(level)],
            [distance, tenth(level)],
        ],
    };
}

/** Die Linien eines Flugabschnitts: der Boden darunter und die Höhe der Bahn, beide über dem Meer, dazu ihr Zuschlag. */
export interface FlightProfiles {
    elevation_profile: ProfilePoint[];
    air_profile: [distance: number, altitude: number][];
    /** Was die Bahn über der Reisehöhe kostet (F4): in Stunden und Schritt, aus den ungerundeten Proben. */
    surcharge: AirSurcharge;
}

/** Die Flugparameter, die Bahn und Zuschlag brauchen. */
export type FlightAir = Pick<RouteAir, "altitudeSchritt" | "maxAboveGroundSchritt" | "ceilingSchritt" | "speedMph">;

/** Die Bahn eines Flugabschnitts, abgetastet: Boden, Höhe der Bahn, Zuschlag. */
export interface FlightTrack {
    /** Abstand ab Beginn der Linie in Karteneinheiten und der Boden darunter in Schritt, je Probe. */
    samples: LineSamples;
    /** Die Höhe der Bahn je Probe in Schritt über dem Meer (`flightAltitude`). */
    altitude: Float64Array;
    surcharge: AirSurcharge;
}

/**
 * Die Bahn über einer Linie: Gelände unter ihr abgetastet (Meer ist dort 0), die Flughöhe darüber nach `flightAltitude`
 * (Werte der Flugkartografie `bahn`, Mindestabstand des Reisemodells) und der Zuschlag über der Reisehöhe
 * (`airSurcharge`). Die EINE Rechnung für Höhenprofil, Zeit und die Wahl des Wegs (`air-weigh.ts`). Null ohne
 * Höhenmodell und bei einer Linie ohne Länge.
 */
export function flightTrack(
    coordinates: readonly Position[],
    heights: TerrainHeights | null | undefined,
    air: FlightAir,
    model: TravelModel,
): FlightTrack | null {
    if (!heights) return null;
    const samples = sampleLine(heights, coordinates, FLIGHT_SAMPLES);
    if (!samples) return null;
    const bahn = AVENTURIA_FLIGHT_CARTOGRAPHY.bahn;
    // Schritt je Karteneinheit dieses Datenstands (WI-0214), wie Flugfeld und Flugabwägung; vorher die Konstante.
    const schritt = werte().schrittPerUnit;
    const lengthSchritt = samples.length * schritt;
    const altitude = flightAltitude({
        ground: samples.height,
        length: lengthSchritt,
        cruise: air.altitudeSchritt,
        ceiling: air.ceilingSchritt,
        reach: air.maxAboveGroundSchritt,
        clearance: model.flug.wert.mindestabstandSchritt,
        hold: bahn.haltenEinheiten * schritt,
        slope: bahn.steigung,
    });
    const surcharge = airSurcharge(model, air, { ground: samples.height, altitude, lengthSchritt });
    return { samples, altitude, surcharge };
}

/**
 * Das Gelände unter einem Flugabschnitt und die Flughöhe darüber (Regel `flightAltitude` mit den Werten der
 * Flugkartografie `bahn` und dem Mindestabstand des Reisemodells), dazu der Zuschlag über der Reisehöhe. Null ohne
 * Höhenmodell. `coordinates` ist die Linie des Abschnitts in Flugrichtung, `distance` ihre Länge.
 */
export function flightProfiles(
    coordinates: readonly Position[],
    distance: number,
    heights: TerrainHeights | null | undefined,
    air: FlightAir,
    model: TravelModel,
    limit: number,
): FlightProfiles | null {
    if (!(distance > 0)) return null;
    const track = flightTrack(coordinates, heights, air, model);
    if (!track) return null;
    const { samples, altitude } = track;
    const scale = distance / samples.length;
    const ground: ProfilePoint[] = samples.at.map((at, k) => [at * scale, tenth(samples.height[k] as number)]);
    const path: ProfilePoint[] = samples.at.map((at, k) => [at * scale, tenth(altitude[k] as number)]);
    return {
        elevation_profile: compactProfile(ground, limit),
        air_profile: compactProfile(path, limit).map(([at, value]) => [at, value as number]),
        surcharge: track.surcharge,
    };
}
