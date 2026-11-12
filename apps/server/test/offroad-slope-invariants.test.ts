import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    AVENTURIA_TRAVEL_MODEL,
    mapPointId,
    SLOPE_FAMILIES,
    slopeFamily,
    travelSpeed,
    type SlopeFamily,
} from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { openGateService, queryOf, type GateService } from "../src/routing/corpus-gate-run.ts";
import { chordIsDry, offroadCost, offroadPathBetween, type OffroadWorld } from "../src/routing/map-points.ts";
import { buildOffroadBox, buildPlanes } from "../src/routing/offroad-grid.ts";
import { finishPath } from "../src/routing/offroad-search.ts";
import { KIND_NONE, reliefAt, reliefPlane, reliefStepFactor, terrainFromDomain } from "../src/routing/relief.ts";
import { areaIndexAt } from "../src/routing/water.ts";
import { domainMountainMask, type DomainHeightSource } from "../src/terrain/domain/read.ts";
import { FULL_INVARIANTS, pick, random, scaled } from "./support/invariants.ts";

/**
 * Steigung querfeldein auf offenem Land am echten Gelände (WI-0049 F5, Betreiber 2026-10-04: „A - schau ob du mit F4
 * kollidierst oder was von F4 brauchen kannst“): die Regeln aus `open-slope.test.ts` an gezogenen Gängen und Reisen der
 * lokalen Entwicklungsdatenbank, fester Seed.
 *
 * - μ_offen ist das Mittel von P über alle Schritte außerhalb der Gebirge: an Ausschnitten des echten Rasters unabhängig
 *   nachgerechnet, mit der anderen Zugehörigkeitsmaske (`domainMountainMask`, jede Zelle gegen die Polygone), also hält
 *   die Eichung das Mittel.
 * - Der gesuchte Gang ist nie teurer als die gerade Sehne, wo sie trocken ist (die Sehne ist ein zulässiger Weg).
 * - Jeder Schritt kostet mindestens `floor` (die Schätzung der Suche bleibt zulässig), und die Mehrzeit durch Steigung ist
 *   nie negativ: Die Bezugszeit ist dieselbe Strecke bei lauter ebenen Schritten.
 *
 * Wie die anderen Datenbank-Invarianten: gegen `DATABASE_URL`, nur lesend, ohne Datenbank oder Gelände sichtbar
 * übersprungen. Kleine Teilmenge in `npm test`, voller Satz mit `npm run gate:routing-invariants`.
 */

const model = AVENTURIA_TRAVEL_MODEL;
const databaseUrl = process.env["DATABASE_URL"];
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const TIMEOUT = scaled(120_000, 1_800_000);
/** Die Mittel, die querfeldein gehen und je eine andere Familie rechnen (zu Fuß, Reittier). */
const TRANSPORTS = ["groupFoot", "lightRider"] as const;

/** Ein quadratischer Ausschnitt des Rasters als eigene Quelle, mit den Gebirgsflächen, die ihn berühren. */
function windowOf(source: DomainHeightSource, left: number, bottom: number, size: number): DomainHeightSource {
    const { raster } = source;
    const samples = new Uint16Array(size * size);
    for (let row = 0; row < size; row += 1) {
        samples.set(
            raster.samples.subarray((bottom + row) * raster.width + left, (bottom + row) * raster.width + left + size),
            row * size,
        );
    }
    const originX = raster.originX + left * raster.cell;
    const originY = raster.originY + bottom * raster.cell;
    const maxX = originX + size * raster.cell;
    const maxY = originY + size * raster.cell;
    return {
        ...source,
        raster: { ...raster, originX, originY, width: size, height: size, samples },
        mountains: source.mountains.filter(
            (area) => area.maxX >= originX && area.minX <= maxX && area.maxY >= originY && area.minY <= maxY,
        ),
    };
}

/** μ_offen je Familie, von Hand: jede Zelle auf offenem Land mit ihren Nachbarn nach Osten, Norden und den beiden Schrägen. */
function bruteOpenMeans(source: DomainHeightSource): Record<SlopeFamily, number> {
    const { raster } = source;
    const mountain = domainMountainMask(source);
    const { samples, width, height } = raster;
    const stride = Math.max(1, Math.round(0.25 / raster.cell));
    const directions = [
        [1, 0],
        [0, 1],
        [1, 1],
        [1, -1],
    ] as const;
    const counts = directions.map(() => new Uint32Array(65536));
    for (let d = 0; d < directions.length; d += 1) {
        const [di, dj] = directions[d] as readonly [number, number];
        const own = counts[d] as Uint32Array;
        for (let j = 0; j < height; j += stride) {
            const nj = j + dj * stride;
            if (nj < 0 || nj >= height) continue;
            for (let i = 0; i + di * stride < width; i += stride) {
                const here = samples[j * width + i] as number;
                if (here === 0 || mountain[j * width + i] === 1) continue;
                const there = samples[nj * width + i + di * stride] as number;
                if (there === 0 || mountain[nj * width + i + di * stride] === 1) continue;
                const rise = there > here ? there - here : here - there;
                own[rise] = (own[rise] as number) + 1;
            }
        }
    }
    const result = {} as Record<SlopeFamily, number>;
    for (const family of SLOPE_FAMILIES) {
        let weight = 0;
        let sum = 0;
        directions.forEach(([di, dj], d) => {
            const run = raster.cell * stride * Math.hypot(di, dj);
            (counts[d] as Uint32Array).forEach((count, rise) => {
                if (count === 0) return;
                weight += count * 2 * run;
                sum +=
                    count *
                    run *
                    (reliefStepFactor(family, rise, run, model) + reliefStepFactor(family, -rise, run, model));
            });
        });
        result[family] = weight > 0 ? sum / weight : 1;
    }
    return result;
}

describeWithDatabase("Steigung querfeldein auf offenem Land (F5) gegen die Entwicklungsdaten", () => {
    let database: Database | undefined;
    let gate: GateService | undefined;
    let unavailable: string | undefined;

    beforeAll(async () => {
        if (!databaseUrl) return;
        try {
            database = createDatabase(databaseUrl, { max: 2 });
            gate = await openGateService(database);
            if (!gate.data.heights?.domain) unavailable = "kein Domain-Gelände in der Datenbank";
        } catch (error) {
            unavailable = `die Datenbank ist nicht lesbar (${error instanceof Error ? error.name : "unbekannt"})`;
        }
    }, 120_000);

    afterAll(async () => {
        await database?.end({ timeout: 5 });
    });

    /** Offenes Land: an Land, nicht im Wasser, außerhalb der Gebirge, mit Höhe. */
    const openPoint = (x: number, y: number): boolean => {
        const data = gate?.data;
        if (!data?.heights) return false;
        if (areaIndexAt(x, y, data.land) === null || areaIndexAt(x, y, data.water) !== null) return false;
        const here = reliefAt(data.heights, x, y);
        return here.kind === KIND_NONE && here.height > 0;
    };

    /** Beine zwischen zwei Punkten auf offenem Land, 4 bis 40 E lang, Anfang an einem Ort. */
    const legs = (count: number, seed: number): { from: { x: number; y: number }; to: { x: number; y: number } }[] => {
        const places = [...(gate?.data.network.nodes.values() ?? [])].filter(
            (node) => node.kind === "place" && !node.isHidden,
        );
        const next = random(seed);
        const found: { from: { x: number; y: number }; to: { x: number; y: number } }[] = [];
        for (let tries = 0; found.length < count && tries < count * 200; tries += 1) {
            const place = pick(places, next);
            const round = (value: number): number => Math.round(value * 1000) / 1000;
            const from = { x: round(place.x + (next() - 0.5) * 6), y: round(place.y + (next() - 0.5) * 6) };
            const angle = next() * 2 * Math.PI;
            const length = 4 + next() * 36;
            const to = { x: round(from.x + Math.cos(angle) * length), y: round(from.y + Math.sin(angle) * length) };
            if (openPoint(from.x, from.y) && openPoint(to.x, to.y)) found.push({ from, to });
        }
        return found;
    };

    it(
        "🔴 μ_offen ist das Mittel von P über alle Schritte auf offenem Land: an Ausschnitten des echten Rasters unabhängig nachgerechnet",
        (context) => {
            const heights = gate?.data.heights;
            if (unavailable || !heights?.domain) {
                return context.skip(`übersprungen: ${unavailable ?? "kein Gelände"}`);
            }
            // Der Dienst lädt die Eichung mit dem Gelände (`terrainFromDomain`); fehlt sie, ist das ein Fehler, kein Skip.
            if (!heights.muOpen) throw new Error("das geladene Gelände trägt keine Eichung des offenen Landes");
            const muOpen = heights.muOpen;
            // Das ganze Raster gegen die Maske jeder Zelle kostet über 30 s; Ausschnitte haben dieselbe Auflösung, dieselben
            // Gebirgsflächen am Rand und dieselbe Eichung (`terrainFromDomain`, wie im Dienst).
            const { raster } = heights.domain;
            const size = Math.min(raster.width, scaled(640, 1536));
            const next = random(20261006);
            const windows = scaled(2, 6);
            for (let index = 0; index < windows; index += 1) {
                const left = Math.floor(next() * (raster.width - size));
                const bottom = Math.floor(next() * (raster.height - size));
                const part = windowOf(heights.domain, left, bottom, size);
                const calibrated = terrainFromDomain(part, model).muOpen as Record<SlopeFamily, number>;
                const brute = bruteOpenMeans(part);
                for (const family of SLOPE_FAMILIES) {
                    expect(calibrated[family], `Ausschnitt ${String(left)}/${String(bottom)}, ${family}`).toBeCloseTo(
                        brute[family],
                        9,
                    );
                }
            }
            // Ein Wert, kein Zufall: P liegt nie unter 1, und das offene Land ist hügelig, aber nicht das Gebirge.
            for (const family of SLOPE_FAMILIES) {
                expect(muOpen[family]).toBeGreaterThanOrEqual(1);
                expect(muOpen[family]).toBeLessThan(1.5);
            }
        },
        TIMEOUT,
    );

    it(
        "🔴 der gesuchte Gang ist nie teurer als die gerade Sehne, jeder Schritt kostet mindestens floor, die Mehrzeit ist nie negativ",
        (context) => {
            const data = gate?.data;
            if (unavailable || !data?.heights) return context.skip(`übersprungen: ${unavailable ?? "kein Gelände"}`);
            const stats = { legs: 0, dry: 0, cheaper: 0, around: 0 };
            for (const transport of TRANSPORTS) {
                const speed = travelSpeed(model, transport, "Querfeldein") as number;
                const cost = offroadCost(model, { transport, speed }, "fastest");
                const world: OffroadWorld = {
                    water: data.water,
                    rivers: data.rivers,
                    ground: data.ground,
                    heights: { terrain: data.heights, model, transport },
                };
                for (const leg of legs(scaled(16, 200), 20261004)) {
                    stats.legs += 1;
                    const where = `${transport}: ${mapPointId(leg.from)} -> ${mapPointId(leg.to)}`;
                    if (!chordIsDry(world, leg.from, leg.to)) continue;
                    const path = offroadPathBetween(world, cost, leg.from, leg.to);
                    if (!path) continue;
                    stats.dry += 1;
                    const box = buildOffroadBox(leg.from.x, leg.from.y, leg.to.x, leg.to.y);
                    const planes = buildPlanes(
                        box,
                        data.water,
                        data.rivers,
                        { search: false },
                        data.ground,
                        [],
                        world.heights,
                    );
                    const chord = finishPath(
                        planes,
                        cost,
                        [
                            [leg.from.x, leg.from.y],
                            [leg.to.x, leg.to.y],
                        ],
                        false,
                    );
                    expect(path.time, where).toBeLessThanOrEqual(chord.time * (1 + 1e-9));
                    if (path.time < chord.time * (1 - 1e-3)) stats.cheaper += 1;
                    if (path.points.length > 2) stats.around += 1;
                    // Die Bezugszeit (alles eben) ist nie größer als die Zeit, und jeder Schritt kostet mindestens floor.
                    expect(path.levelTime, where).toBeDefined();
                    expect(path.time, where).toBeGreaterThanOrEqual((path.levelTime as number) - 1e-9);
                    const plane = reliefPlane(box, data.heights, model, transport);
                    const ramp = cost.ramp(Math.hypot(leg.to.x - leg.from.x, leg.to.y - leg.from.y));
                    expect((path.levelTime as number) / ramp, where).toBeGreaterThanOrEqual(
                        (path.distance / speed) * (plane?.floor ?? 1) - 1e-9,
                    );
                }
            }
            if (FULL_INVARIANTS) console.warn(`Gänge am offenen Land: ${JSON.stringify(stats)}`);
            expect(stats.dry).toBeGreaterThan(0);
            // Im Hügelland spart die Suche regelmäßig gegen die Sehne.
            expect(stats.cheaper).toBeGreaterThan(0);
        },
        TIMEOUT,
    );

    it(
        "🔴 Reisen zu Kartenpunkten: die Mehrzeit eines Gangs ist nie negativ und nie größer als seine Fahrzeit, und die Reise ist stabil",
        async (context) => {
            const data = gate?.data;
            if (unavailable || !gate || !data?.heights) {
                return context.skip(`übersprungen: ${unavailable ?? "kein Gelände"}`);
            }
            const places = [...data.network.nodes.values()].filter((node) => node.kind === "place" && !node.isHidden);
            const next = random(20261005);
            let routes = 0;
            let withSlope = 0;
            let withExtra = 0;
            for (const transport of TRANSPORTS) {
                const family: SlopeFamily = slopeFamily(model, transport);
                const query = queryOf({ land: transport, optimize: "fastest", domains: "land" });
                if ("invalid" in query) throw new Error(query.invalid);
                for (let index = 0; index < scaled(10, 80); index += 1) {
                    const place = pick(places, next);
                    const target = pick(places, next);
                    if (place.id === target.id) continue;
                    const angle = next() * 2 * Math.PI;
                    const length = 4 + next() * 24;
                    const point = {
                        x: Math.round((place.x + Math.cos(angle) * length) * 1000) / 1000,
                        y: Math.round((place.y + Math.sin(angle) * length) * 1000) / 1000,
                    };
                    if (!openPoint(point.x, point.y)) continue;
                    const waypoints = [mapPointId(point), target.id];
                    const outcome = await gate.service.route({ ...query, waypoints });
                    if (!outcome.ok || !outcome.response.found) continue;
                    routes += 1;
                    const where = `${transport} (${family}): ${waypoints.join(" -> ")}`;
                    for (const segment of outcome.response.segments) {
                        if (!segment.synthetic) continue;
                        if (segment.slope) {
                            withSlope += 1;
                            if (segment.slope.extra_hours > 0.01) withExtra += 1;
                            expect(segment.slope.extra_hours, where).toBeGreaterThanOrEqual(0);
                            expect(segment.slope.extra_hours, where).toBeLessThanOrEqual(segment.travel_hours + 1e-9);
                        }
                    }
                    // Dieselbe Frage, dieselbe Antwort: Das Gelände und die Eichung ändern sich nicht zwischen zwei Rechnungen.
                    const again = await gate.service.route({ ...query, waypoints });
                    expect(again.ok && again.response.found ? again.response.travel_hours : null, where).toBe(
                        outcome.response.travel_hours,
                    );
                }
            }
            expect(routes).toBeGreaterThan(0);
            // Gänge im Hügelland tragen ihre Steigung, wie Wege.
            expect(withSlope).toBeGreaterThan(0);
            // Und auf offenem Land kostet sie Zeit (vor F5 nur im Gebirge: dort lagen diese Gänge nicht).
            expect(withExtra).toBeGreaterThan(0);
        },
        TIMEOUT,
    );
});
