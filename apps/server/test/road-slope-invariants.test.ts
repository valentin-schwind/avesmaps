import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    AVENTURIA_TRAVEL_MODEL,
    familyStepFactor,
    routeDomain,
    SLOPE_FAMILIES,
    slopeFamily,
    type SlopeFamily,
} from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { openGateService, queryOf, type GateService } from "../src/routing/corpus-gate-run.ts";
import type { RouteLink } from "../src/routing/network.ts";
import {
    calibrate,
    NO_SLOPE,
    SCHRITT_PER_UNIT,
    slopeTimeFactor,
    starWalk,
    STEP_FLOATS,
    type SlopeCalibration,
    type SlopeSums,
} from "../src/routing/slope.ts";
import { pick, random, scaled } from "./support/invariants.ts";

/**
 * Steigung auf Wegen und Straßen außerhalb der Gebirge am echten Netz (WI-0049 F5c, Betreiber 2026-10-04 „F5: C“, revidiert
 * ADR-0016 vom 2026-10-02): Jeder Abtastschritt außerhalb der Gebirgsflächen kostet P / μ_aussen der Wegart in der Familie
 * des Landmittels, μ_aussen das längengewichtete Mittel von P über die Schritte dieser Wegart außerhalb der Gebirge.
 *
 * - Die Eichung hält das Mittel je Wegart und Familie, an jedem Netz nachgerechnet (die Schritte außerhalb der Gebirge
 *   jedes Wegs, hin und zurück).
 * - Der Gebirgsteil bleibt, wie er war: Ein Stück ganz im Gebirge rechnet nach der Formel von vor F5c, hier unabhängig
 *   angeschrieben (Pass 0,4 mit seiner Eichung, Straßeneichung, Sternregel).
 * - Die Wegprofile tragen alle Landwege; ohne Profil gälte dort Faktor 1.
 * - Jede Mehrzeit eines Abschnitts ist nie negativ und nie größer als seine Fahrzeit.
 *
 * Gegen `DATABASE_URL`, nur lesend; ohne Datenbank oder Wegprofile sichtbar übersprungen.
 */

const model = AVENTURIA_TRAVEL_MODEL;
const databaseUrl = process.env["DATABASE_URL"];
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const TIMEOUT = scaled(120_000, 1_800_000);
const TRANSPORTS = ["groupFoot", "lightRider", "horseCarriage"] as const;

/** Nur die Schritte, deren Gebirgsmarke `mountain` trägt, als eigene Summen (die Wege entlang ihrer Schrittfolge). */
function onlySteps(sums: SlopeSums, mountain: boolean): { sums: SlopeSums; run: number } {
    const steps = sums.steps as Float64Array;
    const kept: number[] = [];
    let run = 0;
    for (let index = 0; index + STEP_FLOATS <= steps.length; index += STEP_FLOATS) {
        if ((steps[index + 2] === 1) !== mountain || !((steps[index + 1] as number) > 0)) continue;
        kept.push(...Array.from(steps.subarray(index, index + STEP_FLOATS)));
        run += steps[index + 1] as number;
    }
    return { sums: { ...sums, steps: Float64Array.from(kept) }, run };
}

describeWithDatabase("Steigung auf Wegen außerhalb der Gebirge (F5c) gegen die Entwicklungsdaten", () => {
    let database: Database | undefined;
    let gate: GateService | undefined;
    let unavailable: string | undefined;
    let links: RouteLink[] = [];
    let calibration: SlopeCalibration | null = null;

    beforeAll(async () => {
        if (!databaseUrl) return;
        try {
            database = createDatabase(databaseUrl, { max: 2 });
            gate = await openGateService(database);
            const network = gate.data.network;
            if (!network.hasProfiles) {
                unavailable = "keine Wegprofile in der Datenbank (derive:terrain)";
                return;
            }
            links = network.links.filter((link) => routeDomain(link.subtype) === "land" && link.slope?.steps);
            // Dieselben Stücke wie der Graph (`networkCalibration`, route-graph.ts).
            calibration = calibrate(
                network.links.map((link) => ({
                    subtype: link.subtype,
                    distance: link.distance,
                    sums: link.slope ?? NO_SLOPE,
                })),
                model,
            );
        } catch (error) {
            unavailable = `die Datenbank ist nicht lesbar (${error instanceof Error ? error.name : "unbekannt"})`;
        }
    }, 120_000);

    afterAll(async () => {
        await database?.end({ timeout: 5 });
    });

    it(
        "🔴 die Eichung hält das Mittel je Wegart und Familie: über alle Schritte außerhalb der Gebirge, hin und zurück, genau 1",
        (context) => {
            if (unavailable || !calibration) return context.skip(`übersprungen: ${unavailable ?? "keine Eichung"}`);
            let checked = 0;
            for (const family of SLOPE_FAMILIES) {
                const byType = new Map<string, { run: number; weighted: number }>();
                for (const link of links) {
                    const { sums, run } = onlySteps(link.slope as SlopeSums, false);
                    if (!(run > 0)) continue;
                    const distance = run / SCHRITT_PER_UNIT;
                    // Allein die Schritte außerhalb: Stück ohne Gebirge, volle Länge, beide Richtungen.
                    const both =
                        slopeTimeFactor(link.subtype, distance, sums, true, model, calibration, family) +
                        slopeTimeFactor(link.subtype, distance, sums, false, model, calibration, family);
                    const entry = byType.get(link.subtype) ?? { run: 0, weighted: 0 };
                    entry.run += 2 * run;
                    entry.weighted += run * both;
                    byType.set(link.subtype, entry);
                }
                for (const [subtype, { run, weighted }] of byType) {
                    expect(weighted / run, `${family} ${subtype}`).toBeCloseTo(1, 9);
                    checked += 1;
                }
            }
            // Mindestens die Wegarten des Netzes in jeder Familie.
            expect(checked).toBeGreaterThanOrEqual(SLOPE_FAMILIES.length * 4);
        },
        TIMEOUT,
    );

    it(
        "🔴 ein ebenes Stück außerhalb der Gebirge geht schneller als das Mittel, ein Anstieg langsamer; der Faktor liegt nie unter 1 / μ_aussen",
        (context) => {
            if (unavailable || !calibration) return context.skip(`übersprungen: ${unavailable ?? "keine Eichung"}`);
            let tested = 0;
            for (const family of SLOPE_FAMILIES) {
                for (const link of links.filter((one) => one.subtype === "Strasse").slice(0, scaled(40, 400))) {
                    const mu = calibration[family].outside["Strasse"] as number;
                    const { sums, run } = onlySteps(link.slope as SlopeSums, false);
                    if (!(run > 0)) continue;
                    const distance = run / SCHRITT_PER_UNIT;
                    const forward = slopeTimeFactor("Strasse", distance, sums, true, model, calibration, family);
                    const backward = slopeTimeFactor("Strasse", distance, sums, false, model, calibration, family);
                    const flat = slopeTimeFactor(
                        "Strasse",
                        distance,
                        sums,
                        true,
                        model,
                        calibration,
                        family,
                        null,
                        true,
                    );
                    expect(flat, family).toBeCloseTo(1 / mu, 9);
                    expect(forward, family).toBeGreaterThanOrEqual(flat - 1e-12);
                    expect(backward, family).toBeGreaterThanOrEqual(flat - 1e-12);
                    tested += 1;
                }
            }
            expect(tested).toBeGreaterThan(0);
        },
        TIMEOUT,
    );

    it(
        "🔴 der Gebirgsteil bleibt, wie er war: Stücke ganz im Gebirge rechnen nach der Formel von vor F5c (Straßeneichung, Pass, Sternregel)",
        (context) => {
            if (unavailable || !calibration) return context.skip(`übersprungen: ${unavailable ?? "keine Eichung"}`);
            const rule = model.steigung.wert;
            let tested = 0;
            for (const link of links) {
                const { sums: only, run } = onlySteps(link.slope as SlopeSums, true);
                if (!(run > 0)) continue;
                // Länge des Stücks = Länge seiner Gebirgsschritte (1 E = 3.000 Schritt).
                const distance = run / SCHRITT_PER_UNIT;
                const ga = rule.gaMitSteigung.includes(link.subtype);
                const steps = only.steps as Float64Array;
                for (const transport of ["groupFoot", "lightRider"]) {
                    const family: SlopeFamily = slopeFamily(model, transport);
                    const star = starWalk(model, transport, link.subtype);
                    const walker = star?.family ?? family;
                    const mu = ga ? calibration[walker].gaSlope[link.subtype] : calibration[walker].street;
                    for (const forward of [true, false]) {
                        // Der Mehrweg der Gebirgsschritte von Hand: run · (p − 1) je Schritt in Fahrtrichtung.
                        let extra = 0;
                        for (let index = 0; index + STEP_FLOATS <= steps.length; index += STEP_FLOATS) {
                            const rise = steps[index] as number;
                            const stepRun = steps[index + 1] as number;
                            extra +=
                                stepRun * (familyStepFactor(walker, (forward ? rise : -rise) / stepRun, model) - 1);
                        }
                        const expected = ((star?.ratio ?? 1) * (run + extra)) / (mu ?? 1) / run;
                        const actual = slopeTimeFactor(
                            link.subtype,
                            distance,
                            only,
                            forward,
                            model,
                            calibration,
                            family,
                            star,
                        );
                        expect(actual, `${link.subtype} ${transport} ${forward ? "hin" : "zurück"}`).toBeCloseTo(
                            expected,
                            9,
                        );
                    }
                    tested += 1;
                }
                if (tested > scaled(200, 3000)) break;
            }
            expect(tested).toBeGreaterThan(0);
        },
        TIMEOUT,
    );

    it(
        "die Wegprofile tragen alle Landwege: Abtastschritte an jedem, sonst gälte dort Faktor 1",
        (context) => {
            if (unavailable || !gate) return context.skip(`übersprungen: ${unavailable ?? "kein Netz"}`);
            const land = gate.data.network.links.filter((link) => routeDomain(link.subtype) === "land");
            const without = land.filter((link) => !link.slope?.known || !link.slope.steps?.length);
            const lengthWithout = without.reduce((sum, link) => sum + link.distance, 0);
            const lengthAll = land.reduce((sum, link) => sum + link.distance, 0);
            expect(land.length).toBeGreaterThan(1000);
            expect(lengthWithout / lengthAll, `${String(without.length)} Landwege ohne Profil`).toBeLessThan(0.005);
        },
        TIMEOUT,
    );

    it(
        "🔴 Reisen über Land: die Mehrzeit jedes Abschnitts ist nie negativ und nie größer als seine Fahrzeit, in jeder Familie",
        async (context) => {
            const data = gate?.data;
            if (unavailable || !gate || !data) return context.skip(`übersprungen: ${unavailable ?? "kein Netz"}`);
            const places = [...data.network.nodes.values()].filter((node) => node.kind === "place" && !node.isHidden);
            const next = random(20261008);
            let routes = 0;
            let withExtra = 0;
            for (const transport of TRANSPORTS) {
                const query = queryOf({ land: transport, optimize: "fastest", domains: "land" });
                if ("invalid" in query) throw new Error(query.invalid);
                for (let index = 0; index < scaled(12, 80); index += 1) {
                    const a = pick(places, next);
                    const b = pick(places, next);
                    if (a.id === b.id) continue;
                    const outcome = await gate.service.route({ ...query, waypoints: [a.id, b.id] });
                    if (!outcome.ok || !outcome.response.found) continue;
                    routes += 1;
                    for (const segment of outcome.response.segments) {
                        if (!segment.slope) continue;
                        const where = `${transport}: ${a.name} -> ${b.name}, ${segment.edge_id}`;
                        expect(segment.slope.extra_hours, where).toBeGreaterThanOrEqual(0);
                        expect(segment.slope.extra_hours, where).toBeLessThanOrEqual(segment.travel_hours + 1e-9);
                        if (segment.slope.extra_hours > 0.01) withExtra += 1;
                    }
                }
            }
            expect(routes).toBeGreaterThan(0);
            expect(withExtra).toBeGreaterThan(0);
        },
        TIMEOUT,
    );
});
