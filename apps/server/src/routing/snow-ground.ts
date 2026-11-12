import { snowlineHeight, type TravelModel } from "@avesmaps3d/shared";
import type { RouteLink } from "./network.ts";
import { KIND_MOUNTAIN, reliefAt, type TerrainHeights } from "./relief.ts";
import { STEP_FLOATS } from "./slope.ts";
import { werte } from "./einstellungen.ts";

/**
 * Schnee im Gebirge (WI-0069, Betreiber 2026-10-03: „die ausnahme ist in gebirgen über der schneegrenze - dort darf
 * er immer“): Ein Wegstück liegt im ewigen Schnee des Tages, wenn es ganz in Gebirgsflächen und ganz über der
 * Schneegrenze (`snowlineHeight`) liegt. Dort fährt der Schlitten zu jeder Jahreszeit (`aboveSnowline`).
 *
 * Der Boden über der Schneegrenze (`schneegrenze.bodenDarueber`, Betreiber 2026-10-04; `closures.ts`) liegt für jedes
 * andere Landmittel entweder auf dem ganzen Stück, wenn es ganz darüber liegt (Fassung A), oder auf dem Teil des Stücks,
 * der im Gebirge über der Grenze liegt (Fassung B, `bodenAnteilig`; Betreiber 2026-10-04: „schnee B“, nach der Messung „Welche Schneeregel einschalten? B“):
 * `snowShare`.
 *
 * - **Gezeichnete Wege** tragen ihre Abtastschritte aus `terrain_path_profile` (Höhe am Anfang, Anstieg, Gebirge an
 *   beiden Enden), dieselben, mit denen die Steigung rechnet.
 * - **Gänge querfeldein** haben kein Profil; ihre Linie wird im Gelände abgetastet (`reliefAt`), wie die Steigung
 *   querfeldein es tut. Ohne Gelände weiß ein Gang nichts über seine Höhe und liegt nie im Schnee.
 * - Je Wegstück einmal gerechnet; die Schneegrenze hängt am Tag und wird je Betreten verglichen.
 */

/** So dicht wird ein Gang querfeldein im Gelände abgetastet, in Karteneinheiten (wie die Steigung, 0,25 E). */
const SAMPLE_UNITS = 0.25;

/**
 * Die Gebirgsabschnitte eines Stücks für den Anteil über der Schneegrenze: je Abschnitt (ein Abtastschritt im
 * Gebirge, an einem Anker auf den Teil des Stücks beschnitten) die tiefste und die höchste Höhe und die Länge, alles in
 * Schritt; dazu die Länge des Stücks und sein höchster Gebirgspunkt. Der zuletzt gefragte Anteil bleibt gemerkt: Die
 * Schneegrenze ist auf 100 Schritt gerundet und ändert sich innerhalb einer Suche selten.
 */
interface AlpineProfile {
    pieces: Float64Array;
    total: number;
    top: number;
    snowline: number;
    share: number;
}

/** Je Abschnitt in `AlpineProfile.pieces`: tiefste Höhe, höchste Höhe, Länge. */
const PIECE_FLOATS = 3;

const profileCache = new WeakMap<RouteLink, AlpineProfile | null>();

function profile(pieces: number[], total: number): AlpineProfile | null {
    if (pieces.length === 0 || !(total > 0)) return null;
    let top = -Infinity;
    for (let index = 1; index < pieces.length; index += PIECE_FLOATS) top = Math.max(top, pieces[index] as number);
    return { pieces: Float64Array.from(pieces), total, top, snowline: Number.NaN, share: 0 };
}

/** Aus den Abtastschritten des Höhenprofils; an einem Anker nur der Teil des Stücks, den die Kante trägt (`span`). */
function profileFromSteps(link: RouteLink, steps: Float64Array): AlpineProfile | null {
    // Derselbe Maßstab, mit dem das Netz die Abtastschritte gelegt hat (`network.ts`, WI-0214); vorher die Konstante.
    const schritt = werte().schrittPerUnit;
    const from = (link.span?.from ?? 0) * schritt;
    const to = link.span ? link.span.to * schritt : Infinity;
    const pieces: number[] = [];
    for (let index = 0; index + STEP_FLOATS <= steps.length; index += STEP_FLOATS) {
        if (steps[index + 2] !== 1) continue;
        const rise = steps[index] as number;
        const run = steps[index + 1] as number;
        const height = steps[index + 3] as number;
        const start = steps[index + 4] as number;
        const a = Math.max(start, from);
        const b = Math.min(start + run, to);
        if (!(b > a) || !(run > 0)) continue;
        const ha = height + (rise * (a - start)) / run;
        const hb = height + (rise * (b - start)) / run;
        pieces.push(Math.min(ha, hb), Math.max(ha, hb), b - a);
    }
    const total = link.span ? (link.span.to - link.span.from) * schritt : link.distance * schritt;
    return profile(pieces, total);
}

/** Ein Gang querfeldein, im Gelände abgetastet: je zwei Proben im Gebirge ein Abschnitt. */
function profileFromTerrain(coordinates: readonly [number, number][], heights: TerrainHeights): AlpineProfile | null {
    const pieces: number[] = [];
    let total = 0;
    let previous: { height: number; mountain: boolean } | null = null;
    const schritt = werte().schrittPerUnit;
    for (let index = 1; index < coordinates.length; index += 1) {
        const [ax, ay] = coordinates[index - 1] as [number, number];
        const [bx, by] = coordinates[index] as [number, number];
        const length = Math.hypot(bx - ax, by - ay);
        const steps = Math.max(1, Math.ceil(length / SAMPLE_UNITS));
        const run = (length / steps) * schritt;
        total += length * schritt;
        for (let step = index === 1 ? 0 : 1; step <= steps; step += 1) {
            const at = reliefAt(heights, ax + ((bx - ax) * step) / steps, ay + ((by - ay) * step) / steps);
            const here = { height: at.height, mountain: at.kind === KIND_MOUNTAIN };
            if (previous && previous.mountain && here.mountain && Number.isFinite(previous.height + here.height)) {
                pieces.push(Math.min(previous.height, here.height), Math.max(previous.height, here.height), run);
            }
            previous = here;
        }
    }
    return profile(pieces, total);
}

function alpineProfile(link: RouteLink, heights: TerrainHeights | null): AlpineProfile | null {
    const known = profileCache.get(link);
    if (known !== undefined) return known;
    const steps = link.slope?.steps ?? null;
    const made = steps ? profileFromSteps(link, steps) : heights ? profileFromTerrain(link.coordinates, heights) : null;
    profileCache.set(link, made);
    return made;
}

/**
 * Welcher Anteil der Länge eines Wegstücks an diesem Tag im Gebirge über der Schneegrenze seiner Klimazone liegt, 0 bis
 * 1 (Fassung B). Ein Abtastschritt, der die Grenze schneidet, zählt mit dem Teil darüber (die Höhe verläuft in ihm
 * gerade). Was keine Höhe hat oder nicht im Gebirge liegt, zählt nicht.
 */
export function snowShare(
    model: TravelModel,
    link: RouteLink,
    zone: string | null,
    day: number,
    heights: TerrainHeights | null,
): number {
    const alpine = alpineProfile(link, heights);
    if (alpine === null) return 0;
    const snowline = snowlineHeight(model, zone, day);
    if (snowline === null || alpine.top <= snowline) return 0;
    if (alpine.snowline === snowline) return alpine.share;
    const { pieces } = alpine;
    let above = 0;
    for (let index = 0; index + PIECE_FLOATS <= pieces.length; index += PIECE_FLOATS) {
        const low = pieces[index] as number;
        const high = pieces[index + 1] as number;
        const length = pieces[index + 2] as number;
        if (low >= snowline) above += length;
        else if (high > snowline) above += (length * (high - snowline)) / (high - low);
    }
    alpine.snowline = snowline;
    alpine.share = Math.min(1, above / alpine.total);
    return alpine.share;
}

/**
 * Der tiefste Punkt eines Wegstücks in Schritt, wenn es ganz in Gebirgsflächen liegt; sonst null (auch ohne Höhe). Die
 * Suche fragt bei jedem Betreten (Schlitten, Boden über der Schneegrenze), und die meisten Stücke liegen nicht ganz im
 * Gebirge: Für sie bleibt es bei einem Blick in diesen Speicher.
 */
const alpineCache = new WeakMap<RouteLink, number | null>();

function fromSteps(steps: Float64Array): number | null {
    if (steps.length < STEP_FLOATS) return null;
    let lowest = Infinity;
    for (let index = 0; index + STEP_FLOATS <= steps.length; index += STEP_FLOATS) {
        if (steps[index + 2] !== 1) return null;
        const rise = steps[index] as number;
        const start = steps[index + 3] as number;
        lowest = Math.min(lowest, start, start + rise);
    }
    return lowest;
}

function fromTerrain(coordinates: readonly [number, number][], heights: TerrainHeights): number | null {
    if (coordinates.length < 2) return null;
    let lowest = Infinity;
    for (let index = 1; index < coordinates.length; index += 1) {
        const [ax, ay] = coordinates[index - 1] as [number, number];
        const [bx, by] = coordinates[index] as [number, number];
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / SAMPLE_UNITS));
        for (let step = index === 1 ? 0 : 1; step <= steps; step += 1) {
            const at = reliefAt(heights, ax + ((bx - ax) * step) / steps, ay + ((by - ay) * step) / steps);
            if (at.kind !== KIND_MOUNTAIN) return null;
            lowest = Math.min(lowest, at.height);
        }
    }
    return lowest;
}

function alpineLowest(link: RouteLink, heights: TerrainHeights | null): number | null {
    const known = alpineCache.get(link);
    if (known !== undefined) return known;
    const steps = link.slope?.steps ?? null;
    const lowest = steps ? fromSteps(steps) : heights ? fromTerrain(link.coordinates, heights) : null;
    alpineCache.set(link, lowest);
    return lowest;
}

/** Liegt das Wegstück an diesem Tag ganz in Gebirgsflächen über der Schneegrenze seiner Klimazone? */
export function aboveSnowline(
    model: TravelModel,
    link: RouteLink,
    zone: string | null,
    day: number,
    heights: TerrainHeights | null,
): boolean {
    // Erst das Gebirge (gemerkt je Stück), dann die Schneegrenze des Tages: Die meisten Stücke enden beim ersten.
    const lowest = alpineLowest(link, heights);
    if (lowest === null) return false;
    const snowline = snowlineHeight(model, zone, day);
    return snowline !== null && lowest >= snowline;
}
