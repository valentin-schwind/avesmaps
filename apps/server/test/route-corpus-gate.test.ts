import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AVENTURIA_TRAVEL_MODEL, type RouteAir } from "@avesmaps3d/shared";
import {
    classify,
    countClasses,
    differences,
    emptyResult,
    relevantParts,
    sameResult,
    summarize,
    type ClassifyInput,
    type ExpectedChange,
    type GateResult,
} from "../src/routing/corpus-gate.ts";
import {
    classifyRuns,
    GATE_FILES,
    GATE_VERGLEICH_ENV,
    loadComparison,
    loadGateFiles,
    openGateService,
    queryOf,
    resolveName,
    runCases,
    type GateRow,
    type GateService,
} from "../src/routing/corpus-gate-run.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { ROUTING_REVISION_PARTS, type RoutingDataRevision } from "../src/routing/revision.ts";
import { RouteService, type RouteQuery } from "../src/routing/service.ts";
import { wandQuelle } from "./support/air-terrain.ts";

/**
 * Das Routing-Gate über den Korpus (Plan 6.52, 11.51; `corpus-gate.ts`): die Klassifikation, die Dateien des Gates und
 * eine kleine Teilmenge (Land, See, Gebirge, Querfeldein, Zwischenziel, Flug, Saison) gegen die echten Daten der
 * lokalen Entwicklungsdatenbank. Der volle Korpus läuft mit `npm run gate:routing-corpus`.
 *
 * 🔴 In der Testsuite ist nur `REGRESSION` rot. Hat sich der Datenstand seit der Basislinie geändert (`DATA_CHANGE`),
 * wird der Fall mit Hinweis übersprungen: Dann ist die Basislinie neu aufzunehmen, nicht der Router zu ändern. Im Release-Test kommt es dazu nicht
 * mehr: Dort rechnet der Runner bei abweichender Revision die Fälle mit dem Code der Basislinie auf demselben Korpus und nennt den Vergleichsstand in
 * `AVESMAPS_ROUTING_VERGLEICH` (WI-0248, `scripts/dev/release-routing.ts`).
 * Ohne `DATABASE_URL` (oder ohne Routingdaten darin) überspringt die Teilmenge sichtbar.
 */

function greif(): RouteAir {
    return {
        profile: "griffin",
        speedMph: 50,
        altitudeSchritt: 800,
        maxAboveGroundSchritt: 8000,
        ceilingSchritt: 5000,
    };
}

const revision = (overrides: Partial<RoutingDataRevision> = {}): RoutingDataRevision => ({
    map: "m1",
    travelModel: "t1",
    terrain: "g1",
    pathProfiles: "p1",
    seaGraph: "s1",
    climate: "k1",
    territories: "z1",
    settings: "e1",
    settingsLive: "e2",
    ...overrides,
});

const result = (overrides: Partial<GateResult> = {}): GateResult => ({
    ...emptyResult("route"),
    travelHours: 10,
    totalHours: 30,
    distanceUnits: 12,
    segments: 3,
    stages: 2,
    modes: { "Strasse|groupFoot": 2 },
    path: "aaaaaaaaaaaa",
    geometry: "bbbbbbbbbbbb",
    ...overrides,
});

const input = (overrides: Partial<ClassifyInput> = {}): ClassifyInput => ({
    current: result(),
    baseline: result(),
    relevant: ["map", "terrain", "pathProfiles"],
    baselineRevision: revision(),
    currentRevision: revision(),
    expected: undefined,
    ...overrides,
});

describe("Klassifikation des Routing-Gates", () => {
    it("gleiches Ergebnis ist MATCH, auch wenn sich die Daten geändert haben", () => {
        expect(classify(input()).class).toBe("MATCH");
        expect(classify(input({ currentRevision: revision({ map: "m2" }) })).class).toBe("MATCH");
    });

    it("🔴 abweichend bei gleichen Daten und nicht erwartet ist REGRESSION", () => {
        const found = classify(input({ current: result({ travelHours: 10.5, path: "cccccccccccc" }) }));
        expect(found.class).toBe("REGRESSION");
        expect(found.differences).toEqual(["path: aaaaaaaaaaaa -> cccccccccccc", "travelHours: 10 -> 10.5"]);
    });

    it("abweichend, und ein maßgeblicher Datenteil hat sich geändert: DATA_CHANGE mit Hinweis", () => {
        const found = classify(
            input({ current: result({ travelHours: 11 }), currentRevision: revision({ pathProfiles: "p2" }) }),
        );
        expect(found.class).toBe("DATA_CHANGE");
        expect(found.changedParts).toEqual(["pathProfiles"]);
        expect(found.note).toContain("Basislinie neu aufnehmen");
    });

    it("🔴 ein Datenteil, von dem der Fall nicht abhängt, entschuldigt keine Abweichung", () => {
        // Flug: Klima und Seegraph zählen nicht.
        const flight = relevantParts({ enabled: { land: true, river: true, sea: true }, air: greif() });
        const found = classify(
            input({
                current: result({ travelHours: 11 }),
                relevant: flight,
                currentRevision: revision({ climate: "k2", seaGraph: "s2", pathProfiles: "p2" }),
            }),
        );
        expect(found.class).toBe("REGRESSION");
    });

    const expected = (change: GateResult): ExpectedChange => ({
        case: "x",
        wi: "WI-9999",
        reason: "bewusste Änderung",
        result: change,
    });

    it("eine erwartete Änderung gilt nur für genau das erwartete Ergebnis", () => {
        const now = result({ travelHours: 11 });
        const found = classify(input({ current: now, expected: expected(now) }));
        expect(found.class).toBe("EXPECTED_CHANGE");
        expect(found.note).toBe("WI-9999: bewusste Änderung");
        // Ändert sich der Fall danach noch einmal anders, ist er nicht mehr erwartet.
        const again = classify(input({ current: result({ travelHours: 12 }), expected: expected(now) }));
        expect(again.class).toBe("REGRESSION");
        expect(again.note).toContain("erwarteten");
    });

    it("erwartet geht vor Datenänderung", () => {
        const now = result({ travelHours: 11 });
        const found = classify(
            input({ current: now, expected: expected(now), currentRevision: revision({ map: "m2" }) }),
        );
        expect(found.class).toBe("EXPECTED_CHANGE");
    });

    it("🔴 ein Fall ohne Basislinie ist REGRESSION: Wer einen Fall dazunimmt, nimmt ihn auch auf", () => {
        const found = classify(input({ baseline: undefined }));
        expect(found.class).toBe("REGRESSION");
        expect(found.note).toContain("--record");
    });

    it("Kennzahlen gelten mit einer Luft von 1e-9, Weg, Linie und Etappen genau", () => {
        expect(sameResult(result(), result({ travelHours: 10 + 1e-12 }))).toBe(true);
        expect(sameResult(result(), result({ travelHours: 10 + 1e-6 }))).toBe(false);
        expect(sameResult(result(), result({ modes: { "Strasse|groupFoot": 1, "Weg|groupFoot": 1 } }))).toBe(false);
        expect(differences(result(), result({ stages: 3, arrival: "firun 1" }))).toEqual([
            "arrival:  -> firun 1",
            "stages: 2 -> 3",
        ]);
    });

    it("zählt die Klassen", () => {
        expect(countClasses(["MATCH", "MATCH", "REGRESSION", "DATA_CHANGE"])).toEqual({
            MATCH: 2,
            EXPECTED_CHANGE: 0,
            DATA_CHANGE: 1,
            REGRESSION: 1,
        });
    });
});

describe("maßgebliche Datenteile", () => {
    const query = (extra: Partial<RouteQuery> = {}): Parameters<typeof relevantParts>[0] => ({
        enabled: { land: true, river: true, sea: true },
        ...extra,
    });

    it("Land und Wasser: Karte, Gelände, Wegprofile, dazu der Seegraph der freien Seefahrt", () => {
        expect(relevantParts(query())).toEqual(["map", "terrain", "pathProfiles", "seaGraph"]);
        expect(relevantParts(query({ enabled: { land: true, river: false, sea: false } }))).toEqual([
            "map",
            "terrain",
            "pathProfiles",
        ]);
    });

    it("🔴 das Reisemodell ist nie dabei: Es liegt im Repository, eine Änderung dort ist eine Codeänderung", () => {
        for (const one of [query(), query({ air: greif() }), query({ departure: { month: "firun", day: 1 } })]) {
            expect(relevantParts(one)).not.toContain("travelModel");
        }
        const changed = classify(
            input({
                current: result({ travelHours: 11 }),
                relevant: relevantParts(query()),
                currentRevision: revision({ travelModel: "t2" }),
            }),
        );
        expect(changed.class).toBe("REGRESSION");
    });

    it("mit Reisebeginn kommt das Klima dazu, im Flug nie", () => {
        expect(relevantParts(query({ departure: { month: "firun", day: 1 } }))).toContain("climate");
        const flight = relevantParts(query({ departure: { month: "firun", day: 1 }, air: greif() }));
        expect(flight).toEqual(["map", "terrain"]);
    });
});

describe("Ergebnis eines Falls (summarize)", () => {
    const service = (): RouteService =>
        new RouteService({ mapDomain: "aventuria", model: AVENTURIA_TRAVEL_MODEL, source: wandQuelle() });
    const zuFuss = {
        optimize: "fastest",
        transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
        enabled: { land: true, river: true, sea: true },
        minimizeTransfers: false,
    } as const;

    it("hält Kennzahlen, Modi und Fingerabdrücke einer gefundenen Route; dieselbe Route ergibt dieselbe Zusammenfassung", async () => {
        const one = summarize(await service().route({ ...zuFuss, waypoints: ["a", "b"] }));
        expect(one).toMatchObject({ outcome: "route", segments: 1, stages: 1, modes: { "Strasse|groupFoot": 1 } });
        expect(one.path).toMatch(/^[0-9a-f]{12}$/);
        expect(one.geometry).toMatch(/^[0-9a-f]{12}$/);
        expect(summarize(await service().route({ ...zuFuss, waypoints: ["a", "b"] }))).toEqual(one);
        // Eine andere Route, ein anderer Fingerabdruck.
        const flight = summarize(await service().route({ ...zuFuss, waypoints: ["a", "b"], air: greif() }));
        expect(flight.path).not.toBe(one.path);
        expect(flight.modes).toEqual({ "Flug|griffin": 1 });
    });

    it("🔴 der Fingerabdruck kennt keine Kante und keinen Knoten (WI-0132): Stücke desselben Weges sind ein Abschnitt", () => {
        const segment = (edge: string, from: string, to: string, coordinates: [number, number][]) => ({
            edge_id: edge,
            public_id: "w",
            from_node_id: from,
            to_node_id: to,
            transport_type: "groupFoot",
            subtype: "Strasse",
            synthetic: false,
            offroad: false,
            geometry: { type: "LineString", coordinates },
        });
        const route = (segments: ReturnType<typeof segment>[]) =>
            ({
                ok: true,
                response: {
                    found: true,
                    travel_hours: 1,
                    total_hours: 1,
                    distance_units: 2,
                    segments,
                    stages: [],
                    arrival: null,
                    warnings: [],
                },
            }) as never;
        const ganz = summarize(
            route([
                segment("w#0", "a", "b", [
                    [0, 0],
                    [1, 0],
                    [2, 0],
                ]),
            ]),
        );
        // Derselbe Weg, im Graphen an einem technischen Knoten geteilt: andere Kanten, andere Knoten, gleiches Ergebnis.
        const geteilt = summarize(
            route([
                segment("w#0", "a", "knoten:1.00000:0.00000", [
                    [0, 0],
                    [1, 0],
                ]),
                segment("w#1", "knoten:1.00000:0.00000", "b", [
                    [1, 0],
                    [2, 0],
                ]),
            ]),
        );
        expect(geteilt).toEqual(ganz);
        expect(ganz.segments).toBe(1);
    });

    it("hält, warum es keine Route gibt: kein Weg, abgelehnt", async () => {
        // Ohne jedes Medium gibt es kein Netz: A und B liegen zwar an einer Straße, aber niemand darf sie gehen.
        const nichts = { ...zuFuss, enabled: { land: false, river: false, sea: false } };
        expect(summarize(await service().route({ ...nichts, waypoints: ["a", "b"] })).outcome).toBe(
            "no_route:network_disconnected",
        );
        expect(summarize(await service().route({ ...zuFuss, waypoints: ["a", "gibt-es-nicht"] })).outcome).toBe(
            "error:unknown_waypoint:gibt-es-nicht",
        );
    });
});

describe("Fälle: Namen und Anfragen", () => {
    const places = [
        { id: "1", name: "Gareth", hidden: false },
        { id: "2", name: "Dûar", hidden: false },
        { id: "3", name: "Dorp", hidden: false },
        { id: "4", name: "Dorp", hidden: true },
    ];

    it("löst einen Namen auf, wie er geschrieben ist, sonst ohne Akzente, nur wenn er eindeutig ist", () => {
        expect(resolveName(places, "Gareth")).toEqual({ id: "1" });
        expect(resolveName(places, "Duar")).toEqual({ id: "2" });
        expect(resolveName(places, "Dorp")).toEqual({ unresolved: "ambiguous:Dorp" });
        expect(resolveName(places, "Perricum")).toEqual({ unresolved: "not_found:Perricum" });
    });

    it("baut die Anfrage wie der Endpunkt: Vorgaben, Medien, Reisebeginn, Flugmittel", () => {
        expect(queryOf({ domains: "land", land: "horseCarriage", start_month: "firun", start_day: 3 })).toMatchObject({
            optimize: "fastest",
            transports: { land: "horseCarriage", river: "riverSailer", sea: "cargoShip" },
            enabled: { land: true, river: false, sea: false },
            departure: { month: "firun", day: 3 },
        });
        expect(queryOf({ air: "witchFlight" })).toMatchObject({ air: { profile: "witchFlight", speedMph: 40 } });
        expect(queryOf({ air: "custom" })).toEqual({ invalid: "air_speed is required with air=custom" });
    });
});

describe("Dateien des Routing-Gates", () => {
    const files = loadGateFiles();

    it("der Korpus hat 40 Fälle, dazu kommen die Ergänzungen; jede Kennung steht einmal da", () => {
        const ids = files.cases.map((one) => one.id);
        expect(ids.filter((id) => id.startsWith("corpus-"))).toHaveLength(40);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.some((id) => id.startsWith("extra-flug"))).toBe(true);
        expect(ids.some((id) => id.startsWith("extra-saison"))).toBe(true);
    });

    it("🔴 die Basislinie kennt jeden Fall, mit Datenstand und allen Teilen der Revision, die das Gate kennt", () => {
        const { baseline } = files;
        if (!baseline) throw new Error("route-gate-baseline.json fehlt: npm run gate:routing-corpus -- --record");
        expect(Object.keys(baseline.cases).sort()).toEqual(files.cases.map((one) => one.id).sort());
        // Der Recorder hält die vollständige Revision fest. Zollgebiete dürfen trotzdem keine
        // Routenabweichung als DATA_CHANGE entschuldigen: maßgeblich ist relevantParts.
        expect(Object.keys(baseline.revision).sort()).toEqual([...ROUTING_REVISION_PARTS].sort());
        for (const one of files.cases) {
            const query = queryOf(one.request);
            if ("invalid" in query) throw new Error(query.invalid);
            expect(relevantParts(query)).not.toContain("territories");
        }
        expect(baseline.keys.routing_graph_revision).toMatch(/^[0-9a-f]{12}$/);
        expect(baseline.keys.map_revision).toMatch(/^[0-9a-f]{12}$/);
        // Jeder Fall ist festgehalten, auch einer ohne Route, mit seinem Grund.
        for (const { result: recorded } of Object.values(baseline.cases)) {
            expect(Object.keys(recorded).sort()).toEqual(Object.keys(emptyResult("x")).sort());
        }
    });

    it("🔴 ein von Legacy umbenannter Ort: Der Korpus bleibt unverändert, der Fall fragt nach dem heutigen Namen", () => {
        const roh = JSON.parse(readFileSync(GATE_FILES.cases, "utf8")) as { umbenannt?: Record<string, string> };
        const korpus = readFileSync(GATE_FILES.corpus, "utf8");
        const umbenannt = Object.entries(roh.umbenannt ?? {});
        for (const [alt, neu] of umbenannt) {
            expect(korpus, alt).toContain(`"${alt}"`);
            expect(neu, alt).not.toBe(alt);
            expect(
                files.cases.some((one) => one.names.includes(alt)),
                alt,
            ).toBe(false);
        }
        // Schwarzkuhl heißt seit dem Legacy-Zug im Oktober Schwarzenschlag (gleiche Stelle); ohne den Eintrag stünde corpus-12 ohne Ort da.
        expect(files.cases.find((one) => one.id === "corpus-12")?.names).toEqual(["Unterfels", "Schwarzenschlag"]);
    });

    it("die Teilmenge ist klein und vollständig: Land, See, Gebirge, Querfeldein, Zwischenziel, Flug, Saison", () => {
        expect(files.subset.length).toBeGreaterThanOrEqual(5);
        expect(files.subset.length).toBeLessThanOrEqual(8);
        const known = new Set(files.cases.map((one) => one.id));
        for (const id of files.subset) expect(known.has(id), id).toBe(true);
        expect(files.subset.some((id) => id.startsWith("extra-flug"))).toBe(true);
        expect(files.subset.some((id) => id.startsWith("extra-saison"))).toBe(true);
    });

    it("jede erwartete Änderung nennt Fall, Arbeitspaket, Grund und das erwartete Ergebnis", () => {
        const known = new Set(files.cases.map((one) => one.id));
        for (const change of files.expected) {
            expect(known.has(change.case), change.case).toBe(true);
            expect(change.wi, change.case).toMatch(/^WI-\d{4}$/);
            expect(change.reason.length, change.case).toBeGreaterThan(10);
            expect(Object.keys(change.result).sort(), change.case).toEqual(Object.keys(emptyResult("x")).sort());
        }
        // Höchstens ein Eintrag je Fall.
        expect(new Set(files.expected.map((change) => change.case)).size).toBe(files.expected.length);
    });
});

// Die Teilmenge gegen die echten Daten: die Entwicklungsdatenbank, nicht die Testdatenbank (die leert jeder Test).
const databaseUrl = process.env["DATABASE_URL"];
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("Teilmenge des Routing-Gates gegen die Entwicklungsdaten", () => {
    const files = loadGateFiles();
    const subset = files.cases.filter((one) => files.subset.includes(one.id));
    let database: Database | undefined;
    let gate: GateService | undefined;
    let unavailable: string | undefined;
    let rows: GateRow[] = [];

    beforeAll(async () => {
        if (!databaseUrl) return;
        try {
            database = createDatabase(databaseUrl, { max: 2 });
            gate = await openGateService(database);
            if (gate.data.network.nodes.size < 100) unavailable = "die Datenbank enthält keine Routingdaten";
        } catch (error) {
            unavailable = `die Datenbank ist nicht lesbar (${error instanceof Error ? error.name : "unbekannt"})`;
        }
        // Im Release-Test bei abweichender Revision: der Vergleichsstand des Laufs (Code der Basislinie auf diesem Korpus) statt der Basislinie.
        const vergleich = process.env[GATE_VERGLEICH_ENV];
        const massstab = vergleich ? loadComparison(vergleich) : files.baseline;
        if (unavailable || !gate || !massstab) return;
        rows = classifyRuns(await runCases(gate, subset), massstab, files.expected, gate.data.revision);
    }, 120_000);

    afterAll(async () => {
        await database?.end({ timeout: 5 });
    });

    it.for(subset)("$id: $label", (one, context) => {
        if (unavailable) return context.skip(`Routing-Gate übersprungen: ${unavailable}`);
        const row = rows.find((candidate) => candidate.case.id === one.id);
        if (!row) throw new Error(`${one.id}: kein Ergebnis (Basislinie fehlt?)`);
        // Nur REGRESSION ist rot; MATCH und EXPECTED_CHANGE bestehen.
        expect(row.class === "REGRESSION" ? [row.class, ...row.differences] : []).toEqual([]);
        // Andere Daten als bei der Basislinie: kein Codefehler, der Fall wird mit Hinweis übersprungen.
        if (row.class === "DATA_CHANGE") return context.skip(`DATA_CHANGE ${row.note}`);
    });

    it("🔴 dieselben Fälle in wechselnder Reihenfolge, dreimal: jedes Mal genau dasselbe (Determinismus auf echtem Gelände)", async (context) => {
        if (unavailable || !gate) return context.skip(`Routing-Gate übersprungen: ${unavailable ?? "kein Dienst"}`);
        const first = (await runCases(gate, subset)).map((run) => run.result);
        for (const shift of [3, 5, 1]) {
            const turned = [...subset.slice(shift), ...subset.slice(0, shift)].reverse();
            const again = await runCases(gate, turned);
            for (const run of again) {
                const index = subset.findIndex((one) => one.id === run.case.id);
                expect(run.result, run.case.id).toEqual(first[index]);
            }
        }
    });
});
