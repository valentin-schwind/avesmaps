import { describe, expect, it } from "vitest";
import {
    AVENTURIA_TRAVEL_MODEL,
    buildRouteStages,
    mergeStageEntries,
    nameTransferPoints,
    rawStageEntries,
    restCounter,
    routeSlope,
    stageDayHours,
    stageSlope,
    type RouteLeg,
    type RouteSegment,
    type RouteStageContext,
    type RouteStagePoint,
    type StageEntry,
    type StagePlace,
} from "../src/index.ts";

/**
 * Die Etappen des Reiseplans (WI-0017, Schritt 2). Die Fälle stammen aus Legacys eigenen Tests
 * (avesmaps@770c80e, `js/routing/__tests__/`): rest-portions, land-wasser-etappe-trennen,
 * abgangspunkt-label, route-plan-offroad-tail, versteckte-etappe. Wo sie hier stehen, gilt Legacys
 * Begründung weiter - die Kommentare dort erklären, welcher Fehler dagegen steht.
 */

const model = AVENTURIA_TRAVEL_MODEL;
const MILES = model.meilenJeKarteneinheit.wert;

// ---------------------------------------------------------------------------------------------
// Rastportionen (Legacy rest-portions.test.js): EIN Zähler über die ganze Route.
// ---------------------------------------------------------------------------------------------

/** Legacys Hilfe: alle Etappen mit demselben Reisetag. */
function rests(legs: readonly [number, boolean?][], dayHours = 12, include = true): number[] {
    const book = restCounter(include);
    return legs.map(([travel, exempt]) => book(travel, dayHours, exempt === true));
}

describe("Rastportionen", () => {
    it("kurz bleibt kurz, und wer genau mit dem Reisetag ankommt, rastet nicht mehr", () => {
        expect(rests([[2]])).toEqual([0]);
        expect(rests([[10.6]])).toEqual([0]);
        expect(rests([[12]])).toEqual([0]);
    });

    it("die Portion kommt erst, wenn noch Weg bleibt", () => {
        expect(rests([[24]])).toEqual([12]);
        expect(rests([[36]])).toEqual([24]);
        expect(rests([[12.5]])).toEqual([12]);
    });

    it("sechs kurze Etappen teilen einen Reisetag - die Nacht fällt auf Etappe 5", () => {
        expect(rests([[3], [3], [3], [3], [3], [3]])).toEqual([0, 0, 0, 0, 12, 0]);
    });

    it("der Schnellsegler setzt zurück, ohne ihn kosten 16 Stunden Marsch eine Nacht", () => {
        expect(rests([[8], [40, true], [8]])).toEqual([0, 0, 0]);
        expect(rests([[8], [8]])).toEqual([0, 12]);
    });

    it("ohne Rastwunsch rastet niemand, und die Einstellung wirkt wirklich", () => {
        expect(rests([[30], [30]], 24, false)).toEqual([0, 0]);
        expect(rests([[20]], 16)).toEqual([8]);
        expect(rests([[7]], 6)).toEqual([18]);
    });

    it("floor(Gesamtzeit/24) ist die Zahl der Nächte - daran hängen später die Kosten", () => {
        for (const [travel, day] of [
            [2, 12],
            [12, 12],
            [24, 12],
            [36, 12],
            [122.4, 12],
            [20, 16],
            [100, 20],
            [7, 6],
        ] as const) {
            const [rest] = rests([[travel]], day);
            expect(Math.floor((travel + (rest ?? 0)) / 24)).toBe((rest ?? 0) / (24 - day));
        }
    });

    it("eine nicht-endliche Reisezeit hängt die Schleife nicht auf", () => {
        expect(rests([[Infinity]])).toEqual([0]);
    });

    it("gezählt wird der Anteil des Tages: 4 h Marsch und 6 h Segeln schulden 0,5 × 16 + 0,5 × 12", () => {
        const book = restCounter(true);
        expect(book(4, 8, false)).toBe(0);
        expect(book(6, 12, false)).toBe(0);
        expect(book(1, 12, false)).toBe(14);
    });

    it("Land folgt dem Planerfeld, Wasser seinem eigenen Tag", () => {
        expect(stageDayHours(model, "groupFoot", 10)).toBe(10);
        expect(stageDayHours(model, "riverSailer", 10)).toBe(12);
        expect(stageDayHours(model, "fastShip", 10)).toBe(24);
    });
});

// ---------------------------------------------------------------------------------------------
// Der Grenz-Lauf (Legacy land-wasser-etappe-trennen.test.js, Meldung #102).
// ---------------------------------------------------------------------------------------------

const place = (name: string): RouteStagePoint => ({ point: "place", place_id: name, name, x: 0, y: 0 });
const marker: RouteStagePoint = { point: "marker", place_id: null, name: "", x: 0, y: 0 };

const entry = (over: Partial<StageEntry>): StageEntry => ({
    type: "Weg",
    transport: "groupFoot",
    flowState: null,
    start: place("Anfang"),
    end: place("Ende"),
    pathNames: [],
    distanceUnits: 10,
    travelHours: 3,
    segmentIndexes: [0],
    ...over,
});

describe("Grenz-Lauf", () => {
    it("Land und Fluss bleiben zwei Etappen, jede mit Art, Mittel und Strömung", () => {
        const stages = mergeStageEntries(
            [
                entry({ start: place("Hausen"), end: marker, distanceUnits: 1.014, segmentIndexes: [9] }),
                entry({
                    type: "Flussweg",
                    transport: "riverSailer",
                    flowState: "downstream",
                    start: marker,
                    end: place("Perricum"),
                    distanceUnits: 62.556,
                    pathNames: ["Darpat"],
                    segmentIndexes: [10, 11, 12, 13, 14, 15],
                }),
            ],
            MILES,
        );
        expect(stages).toHaveLength(2);
        expect(stages[0]?.type).toBe("Weg");
        expect(stages[1]).toMatchObject({ type: "Flussweg", transport: "riverSailer", flowState: "downstream" });
        expect(stages[0]?.distanceUnits).toBeCloseTo(1.014, 9);
        expect(stages[1]?.segmentIndexes).toEqual([10, 11, 12, 13, 14, 15]);

        const named = nameTransferPoints(stages);
        expect(named[0]?.end.point).toBe("landing");
        expect(named[1]?.start.point).toBe("landing");
    });

    it("eine Wasser-Schlussetappe verschwindet nicht in der Landetappe davor", () => {
        const stages = mergeStageEntries(
            [
                entry({ start: place("Gareth"), end: place("Hausen"), distanceUnits: 40 }),
                entry({
                    type: "Flussweg",
                    transport: "riverSailer",
                    start: place("Hausen"),
                    end: marker,
                    segmentIndexes: [1],
                }),
            ],
            MILES,
        );
        expect(stages).toHaveLength(2);
        expect(stages[0]?.distanceUnits).toBe(40);
    });

    it("Fluss und See sind verschiedene Schiffe", () => {
        const stages = mergeStageEntries(
            [
                entry({ type: "Flussweg", transport: "riverSailer", end: marker, distanceUnits: 30 }),
                entry({
                    type: "Seeweg",
                    transport: "cargoShip",
                    start: marker,
                    end: place("Havena"),
                    segmentIndexes: [1],
                }),
            ],
            MILES,
        );
        expect(stages.map((stage) => stage.transport)).toEqual(["riverSailer", "cargoShip"]);
    });

    it("drei Wegarten desselben Mittels sind EIN Marsch bis zur nächsten Stadt", () => {
        const stages = mergeStageEntries(
            [
                entry({
                    type: "Reichsstrasse",
                    start: place("Gareth"),
                    end: marker,
                    distanceUnits: 12,
                    segmentIndexes: [0],
                }),
                entry({ type: "Strasse", start: marker, end: marker, distanceUnits: 8, segmentIndexes: [1] }),
                entry({ type: "Weg", start: marker, end: place("Hartsteen"), distanceUnits: 5, segmentIndexes: [2] }),
            ],
            MILES,
        );
        expect(stages).toHaveLength(1);
        expect(stages[0]).toMatchObject({ type: "Reichsstrasse", distanceUnits: 25, segmentIndexes: [0, 1, 2] });
        expect(stages[0]?.end).toEqual(place("Hartsteen"));
    });

    it("zwei gleichgerichtete Flussstücke bleiben eine Etappe, verschiedene Strömung trennt", () => {
        const same = mergeStageEntries(
            [
                entry({ type: "Flussweg", transport: "riverSailer", flowState: "downstream", end: marker }),
                entry({
                    type: "Flussweg",
                    transport: "riverSailer",
                    flowState: "downstream",
                    start: marker,
                    end: place("Perricum"),
                    segmentIndexes: [1],
                }),
            ],
            MILES,
        );
        expect(same).toHaveLength(1);
        const different = mergeStageEntries(
            [
                entry({ type: "Flussweg", transport: "riverSailer", flowState: "downstream", end: marker }),
                entry({
                    type: "Flussweg",
                    transport: "riverSailer",
                    flowState: "upstream",
                    start: marker,
                    end: place("Perricum"),
                    segmentIndexes: [1],
                }),
            ],
            MILES,
        );
        expect(different).toHaveLength(2);
    });

    it("ein echter Ort am Anleger behält seinen Namen; Gelände → Wasser heißt Anschlusspunkt", () => {
        const withPlace = nameTransferPoints([
            entry({ start: place("Gareth"), end: place("Hausen") }),
            entry({ type: "Flussweg", transport: "riverSailer", start: place("Hausen"), end: place("Perricum") }),
        ]);
        expect(withPlace[0]?.end).toEqual(place("Hausen"));
        const offroadToRiver = nameTransferPoints([
            entry({ type: "Querfeldein", start: place("Rovik"), end: marker }),
            entry({ type: "Flussweg", transport: "riverSailer", start: marker, end: place("Skarsten") }),
        ]);
        expect(offroadToRiver[0]?.end.point).toBe("join");
    });
});

// ---------------------------------------------------------------------------------------------
// Querfeldein (Legacy route-plan-offroad-tail.test.js und abgangspunkt-label.test.js).
// ---------------------------------------------------------------------------------------------

describe("Querfeldein", () => {
    it("trennt jede Etappe und heißt am Übergang Abgangs- bzw. Anschlusspunkt", () => {
        const stages = nameTransferPoints(
            mergeStageEntries(
                [
                    entry({ start: place("Salmingen"), end: marker, segmentIndexes: [0] }),
                    entry({ type: "Querfeldein", start: marker, end: marker, segmentIndexes: [1] }),
                    entry({ start: marker, end: place("Tarnelfurt"), segmentIndexes: [2] }),
                ],
                MILES,
            ),
        );
        expect(stages.map((stage) => stage.type)).toEqual(["Weg", "Querfeldein", "Weg"]);
        expect(stages[0]?.end.point).toBe("exit");
        expect(stages[1]?.start.point).toBe("exit");
        expect(stages[1]?.end.point).toBe("join");
        expect(stages[2]?.start.point).toBe("join");
    });

    it("eine Querfeldein-Schlussetappe bleibt sichtbar - außer sie misst 0,00 Meilen", () => {
        const visible = mergeStageEntries(
            [
                entry({ type: "Flussweg", transport: "riverSailer", start: place("Rovik"), end: marker }),
                entry({
                    type: "Querfeldein",
                    transport: "riverSailer",
                    start: marker,
                    end: marker,
                    distanceUnits: 1.7,
                    segmentIndexes: [1],
                }),
            ],
            MILES,
        );
        expect(visible).toHaveLength(2);
        const invisible = mergeStageEntries(
            [
                entry({ start: place("Skarsten"), end: place("Rovik") }),
                entry({
                    type: "Querfeldein",
                    start: place("Rovik"),
                    end: place("Rovik"),
                    distanceUnits: 0.001,
                    segmentIndexes: [1],
                }),
            ],
            MILES,
        );
        expect(invisible).toHaveLength(1);
        expect(invisible[0]?.segmentIndexes).toEqual([0, 1]);
    });
});

/**
 * Betreiber 2026-10-11: „ein teilstück von 0 meilen findet sich zwischen moorbrück und gerrun … das darf weder auf der
 * karte noch im routenplaner in den etappen auftauchen.“ Seit WI-0132 überbrückt der Router zwei Wegenden, die sich in der
 * Karte um 0,00026 Einheiten verfehlen, mit einem Stück querfeldein; der Reiseplan zeigte es als eigene Etappe
 * „Abgangspunkt → Anschlusspunkt · Unwegsames Gelände · 0,00 Meilen“. Soll: so, als wären die Wege verbunden.
 */
describe("Querfeldein von 0,00 Meilen ist keine Etappe", () => {
    const bridge = (over: Partial<StageEntry>): StageEntry =>
        entry({
            type: "Querfeldein",
            start: marker,
            end: marker,
            distanceUnits: 0.00026,
            travelHours: 0.00025,
            ...over,
        });
    const total = (stages: readonly StageEntry[]) => ({
        units: stages.reduce((sum, stage) => sum + stage.distanceUnits, 0),
        hours: stages.reduce((sum, stage) => sum + stage.travelHours, 0),
        segments: stages.flatMap((stage) => stage.segmentIndexes),
    });

    it("🔴 Moorbrück → Gerrun: Pfad, Brücke, Straße sind EIN Marsch; Strecke und Zeit der Brücke zählen mit", () => {
        const raw = [
            entry({
                type: "Pfad",
                start: place("Moorbrück"),
                end: marker,
                distanceUnits: 4.5976,
                travelHours: 4.3266,
                segmentIndexes: [0],
            }),
            bridge({ segmentIndexes: [1] }),
            entry({
                type: "Strasse",
                start: marker,
                end: place("Gerrun"),
                pathNames: ["Treidelstraße"],
                distanceUnits: 3.7079,
                travelHours: 2.6532,
                segmentIndexes: [2],
            }),
        ];
        const stages = nameTransferPoints(mergeStageEntries(raw, MILES));
        expect(stages.map((stage) => [stage.type, stage.start.name, stage.end.name])).toEqual([
            ["Pfad", "Moorbrück", "Gerrun"],
        ]);
        expect(stages[0]?.pathNames).toEqual(["Treidelstraße"]);
        expect(total(stages)).toEqual(total(raw));
        expect(stages.some((stage) => stage.type === "Querfeldein")).toBe(false);
    });

    it("ein Wechsel des Reisemittels dahinter bleibt: der Übergang heißt Anlegestelle, nicht Abgangspunkt", () => {
        const stages = nameTransferPoints(
            mergeStageEntries(
                [
                    entry({ start: place("Hausen"), end: marker, segmentIndexes: [0] }),
                    bridge({ segmentIndexes: [1] }),
                    entry({
                        type: "Flussweg",
                        transport: "riverSailer",
                        flowState: "downstream",
                        start: marker,
                        end: place("Ferdok"),
                        segmentIndexes: [2],
                    }),
                ],
                MILES,
            ),
        );
        expect(stages.map((stage) => [stage.type, stage.transport, stage.segmentIndexes])).toEqual([
            ["Weg", "groupFoot", [0, 1]],
            ["Flussweg", "riverSailer", [2]],
        ]);
        expect(stages[0]?.end.point).toBe("landing");
    });

    it("ist keine Etappe offen, gehört es zur nächsten: am Anfang der Reise und hinter einem Ort", () => {
        const atStart = mergeStageEntries(
            [
                bridge({ start: place("Anfang"), segmentIndexes: [0] }),
                entry({ start: marker, end: place("Ende"), segmentIndexes: [1] }),
            ],
            MILES,
        );
        expect(atStart.map((stage) => [stage.type, stage.start.name, stage.end.name, stage.segmentIndexes])).toEqual([
            ["Weg", "Anfang", "Ende", [0, 1]],
        ]);
        const afterPlace = mergeStageEntries(
            [
                entry({ start: place("Anfang"), end: place("Mitte"), segmentIndexes: [0] }),
                bridge({ start: place("Mitte"), segmentIndexes: [1] }),
                entry({ start: marker, end: place("Ende"), segmentIndexes: [2] }),
            ],
            MILES,
        );
        expect(afterPlace.map((stage) => [stage.start.name, stage.end.name, stage.segmentIndexes])).toEqual([
            ["Anfang", "Mitte", [0]],
            ["Mitte", "Ende", [1, 2]],
        ]);
    });

    it("die Schwelle ist die Anzeigegenauigkeit: ab 0,01 Meilen bleibt es eine Querfeldein-Etappe", () => {
        const around = (units: number) =>
            mergeStageEntries(
                [
                    entry({ start: place("Anfang"), end: marker, segmentIndexes: [0] }),
                    bridge({ distanceUnits: units, segmentIndexes: [1] }),
                    entry({ start: marker, end: place("Ende"), segmentIndexes: [2] }),
                ],
                MILES,
            ).map((stage) => stage.type);
        expect(around(0.0101 / MILES)).toEqual(["Weg", "Querfeldein", "Weg"]);
        expect(around(0.0099 / MILES)).toEqual(["Weg"]);
    });
});

// ---------------------------------------------------------------------------------------------
// Aus Abschnitten: Namen, Wasser zusammengefasst, versteckte Orte, Wegnamen.
// ---------------------------------------------------------------------------------------------

interface TestNode {
    place?: StagePlace;
    x: number;
    y: number;
}

function contextOf(nodes: Record<string, TestNode>, waypointIds: string[]): RouteStageContext {
    const places = Object.values(nodes).filter((node): node is TestNode & { place: StagePlace } => !!node.place);
    return {
        model,
        waypointIds,
        placeAt: (id) => nodes[id]?.place,
        placeNear: (x, y, radius, accept) => {
            let best: StagePlace | undefined;
            let bestDistance = radius;
            for (const node of places) {
                const distance = Math.hypot(node.x - x, node.y - y);
                if (distance <= bestDistance && accept(node.place)) {
                    best = node.place;
                    bestDistance = distance;
                }
            }
            return best;
        },
    };
}

let segmentCount = 0;
function segment(
    from: string,
    to: string,
    nodes: Record<string, TestNode>,
    over: Partial<RouteSegment> = {},
): RouteSegment {
    const a = nodes[from] as TestNode;
    const b = nodes[to] as TestNode;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    return {
        index: segmentCount++,
        edge_id: `${from}-${to}`,
        public_id: `p-${from}-${to}`,
        from_node: from,
        to_node: to,
        from_node_id: from,
        to_node_id: to,
        subtype: "Weg",
        path_name: "",
        transport_type: "groupFoot",
        distance_units: length,
        cost_units: length,
        cost_factor: 1,
        travel_hours: length,
        flow_time_factor: 1,
        flow_state: "",
        synthetic: false,
        offroad: false,
        geometry: {
            type: "LineString",
            coordinates: [
                [a.x, a.y],
                [b.x, b.y],
            ],
        },
        ...over,
    };
}

const town = (id: string, x: number, y: number, hidden = false): TestNode => ({
    place: { id, name: id, hidden, x, y },
    x,
    y,
});

describe("Etappen aus Abschnitten", () => {
    it("ein Ort trägt seine Klasse in die Etappe, eine Kreuzung keine (WI-0039)", () => {
        segmentCount = 0;
        const nodes: Record<string, TestNode> = {
            A: { place: { id: "A", name: "A", hidden: false, subtype: "metropole", x: 0, y: 0 }, x: 0, y: 0 },
            k: { x: 5, y: 3 },
            C: { place: { id: "C", name: "C", hidden: false, subtype: "dorf", x: 20, y: 0 }, x: 20, y: 0 },
        };
        const stages = rawStageEntries(
            [segment("A", "k", nodes), segment("k", "C", nodes)],
            contextOf(nodes, ["A", "C"]),
        );
        expect(stages[0]?.start).toMatchObject({ point: "place", subtype: "metropole" });
        expect(stages.at(-1)?.end).toMatchObject({ point: "place", subtype: "dorf" });
        const kreuzung = stages.flatMap((stage) => [stage.start, stage.end]).filter((point) => point.place_id === null);
        for (const point of kreuzung) expect(point).not.toHaveProperty("subtype");
    });

    it("eine Kreuzung höchstens 0,15 neben einem Ort heißt wie der Ort und schließt die Etappe", () => {
        segmentCount = 0;
        const nodes: Record<string, TestNode> = {
            A: town("A", 0, 0),
            k1: { x: 5, y: 0 },
            B: town("B", 10.1, 0),
            k2: { x: 10, y: 0 },
            C: town("C", 20, 0),
        };
        const segments = [segment("A", "k1", nodes), segment("k1", "k2", nodes), segment("k2", "C", nodes)];
        const stages = mergeStageEntries(rawStageEntries(segments, contextOf(nodes, ["A", "C"])), MILES);
        expect(stages.map((stage) => [stage.start.name, stage.end.name])).toEqual([
            ["A", "B"],
            ["B", "C"],
        ]);
    });

    it("🔴 benannt wird nach der Geometrie: hängt ein Weg an einem Ort, endet aber 0,2 daneben, schließt dort nichts", () => {
        segmentCount = 0;
        // Wie Gluckenhang (compare:stages): Das Netz hängt das Wegende an den Ort im Kasten ±0,5,
        // Legacys Reiseplan benennt aber den Punkt, an dem die Linie endet - und der liegt zu weit weg.
        const nodes: Record<string, TestNode> = {
            A: town("A", 0, 0),
            B: town("B", 10, 0.2),
            C: town("C", 20, 0),
        };
        const line = (points: [number, number][]): Partial<RouteSegment> => ({
            geometry: { type: "LineString", coordinates: points },
        });
        const segments = [
            segment(
                "A",
                "B",
                nodes,
                line([
                    [0, 0],
                    [10, 0],
                ]),
            ),
            segment(
                "B",
                "C",
                nodes,
                line([
                    [10, 0],
                    [20, 0],
                ]),
            ),
        ];
        const stages = mergeStageEntries(rawStageEntries(segments, contextOf(nodes, ["A", "C"])), MILES);
        expect(stages.map((stage) => [stage.start.name, stage.end.name])).toEqual([["A", "C"]]);
        // Als Wegpunkt bleibt er das Ziel seiner Etappe.
        const via = mergeStageEntries(rawStageEntries(segments, contextOf(nodes, ["A", "B", "C"])), MILES);
        expect(via).toHaveLength(1);
    });

    it("ein versteckter Durchgangsort ist still vorbei, als Wegpunkt aber sichtbar (Owner 15.08.2026)", () => {
        segmentCount = 0;
        const nodes: Record<string, TestNode> = {
            Luring: town("Luring", 0, 0),
            Feenplatz: town("Feenplatz", 5, 0, true),
            Spinnried: town("Spinnried", 10, 0),
        };
        const segments = [segment("Luring", "Feenplatz", nodes), segment("Feenplatz", "Spinnried", nodes)];
        const silent = mergeStageEntries(rawStageEntries(segments, contextOf(nodes, ["Luring", "Spinnried"])), MILES);
        expect(silent.map((stage) => [stage.start.name, stage.end.name])).toEqual([["Luring", "Spinnried"]]);
        const named = mergeStageEntries(
            rawStageEntries(segments, contextOf(nodes, ["Luring", "Feenplatz", "Spinnried"])),
            MILES,
        );
        expect(named.map((stage) => stage.end.name)).toEqual(["Feenplatz", "Spinnried"]);
    });

    it("Wasser wird über Markierungen zusammengefasst, mit allen Flussnamen, aber an Wegpunkten geteilt", () => {
        segmentCount = 0;
        const nodes: Record<string, TestNode> = {
            Rindsfurt: town("Rindsfurt", 0, 0),
            m1: { x: 5, y: 0 },
            Tuzak: town("Tuzak", 10, 0),
            m2: { x: 15, y: 0 },
            Perricum: town("Perricum", 20, 0),
        };
        const river = { subtype: "Flussweg", transport_type: "riverSailer" };
        const segments = [
            segment("Rindsfurt", "m1", nodes, { ...river, path_name: "Gardel" }),
            segment("m1", "Tuzak", nodes, { ...river, path_name: "Natter" }),
            segment("Tuzak", "m2", nodes, { ...river, path_name: "Darpat" }),
            segment("m2", "Perricum", nodes, { ...river, path_name: "Flussweg-12" }),
        ];
        // 🪤 Ein Hafen, der kein Wegpunkt ist, teilt NICHT - wie Legacy (MCS-020, DISPUTED gegen
        // `routing-featurestand.md:114`, das Häfen behalten wollte; der Code schneidet nur an Wegpunkten).
        const through = mergeStageEntries(
            rawStageEntries(segments, contextOf(nodes, ["Rindsfurt", "Perricum"])),
            MILES,
        );
        expect(through.map((stage) => stage.pathNames)).toEqual([["Gardel", "Natter", "Darpat"]]);
        const viaTuzak = mergeStageEntries(
            rawStageEntries(segments, contextOf(nodes, ["Rindsfurt", "Tuzak", "Perricum"])),
            MILES,
        );
        expect(viaTuzak.map((stage) => stage.end.name)).toEqual(["Tuzak", "Perricum"]);
    });

    it("rechnet Stunden, Rast, Etappe je Wegpunktpaar und behält die Enden der Reise", () => {
        segmentCount = 0;
        const nodes: Record<string, TestNode> = {
            A: town("A", 0, 0),
            k: { x: 6, y: 0 },
            B: town("B", 12, 0),
        };
        const segments = [
            segment("A", "k", nodes, { travel_hours: 6 }),
            segment("k", "B", nodes, { travel_hours: 6 }),
            segment("B", "A", nodes, { travel_hours: 12 }),
        ];
        const legs: RouteLeg[] = [
            { from: "A", to: "B", segment_start: 0, segment_count: 2, distance_units: 12, travel_hours: 12 },
            { from: "B", to: "A", segment_start: 2, segment_count: 1, distance_units: 12, travel_hours: 12 },
        ];
        const stages = buildRouteStages(segments, legs, contextOf(nodes, ["A", "B", "A"]), { hoursPerDay: 8 });
        expect(stages.map((stage) => [stage.from.name, stage.to.name, stage.leg_index])).toEqual([
            ["A", "B", 0],
            ["B", "A", 1],
        ]);
        expect(stages.map((stage) => stage.travel_hours)).toEqual([12, 12]);
        // 8 h Tag: nach 8 h eine Portion (16 h) in Etappe 1, nach 16 h die zweite, nach 24 h keine mehr.
        expect(stages.map((stage) => stage.rest_hours)).toEqual([16, 16]);
        expect(stages[0]).toMatchObject({ segment_start: 0, segment_count: 2 });
        const noRest = buildRouteStages(segments, legs, contextOf(nodes, ["A", "B", "A"]), { hoursPerDay: 24 });
        expect(noRest.map((stage) => stage.rest_hours)).toEqual([0, 0]);
    });
});

describe("Steigung je Etappe und Reise (WI-0049 S5d)", () => {
    const hang = (ascent: number, descent: number, steepest: number, extra: number) => ({
        slope: {
            ascent_schritt: ascent,
            descent_schritt: descent,
            highest_schritt: 1000 + ascent,
            steepest_grade: steepest,
            extra_hours: extra,
        },
    });

    it("summiert über die Abschnitte mit Höhe; steilster nach Betrag, mit Vorzeichen", () => {
        segmentCount = 0;
        const nodes: Record<string, TestNode> = {
            A: town("A", 0, 0),
            k1: { x: 4, y: 0 },
            k2: { x: 8, y: 0 },
            B: town("B", 12, 0),
            C: town("C", 24, 0),
        };
        const segments = [
            segment("A", "k1", nodes, hang(300, 100, 0.12, 1.5)),
            segment("k1", "k2", nodes),
            segment("k2", "B", nodes, hang(50, 400, -0.3, -0.25)),
            segment("B", "C", nodes),
        ];
        const legs: RouteLeg[] = [
            { from: "A", to: "C", segment_start: 0, segment_count: 4, distance_units: 24, travel_hours: 24 },
        ];
        const stages = buildRouteStages(segments, legs, contextOf(nodes, ["A", "C"]), { hoursPerDay: 8 });
        expect(stages).toHaveLength(2);
        expect(stages[0]?.slope).toEqual({
            ascent_schritt: 350,
            descent_schritt: 500,
            highest_schritt: 1300,
            steepest_grade: -0.3,
            extra_hours: 1.25,
            covered_miles: 8 * MILES,
        });
        // 🔴 Ohne Höhe fehlt das Feld ganz, die Oberfläche schweigt dann.
        expect(stages[1]).not.toHaveProperty("slope");
        expect(routeSlope(stages)).toEqual({ ...stages[0]?.slope, covered_stages: 1, total_stages: 2 });
    });

    it("🔴 ohne Höhen gibt es keine Steigung, weder je Etappe noch für die Reise", () => {
        segmentCount = 0;
        const nodes: Record<string, TestNode> = { A: town("A", 0, 0), B: town("B", 12, 0) };
        const segments = [segment("A", "B", nodes)];
        const legs: RouteLeg[] = [
            { from: "A", to: "B", segment_start: 0, segment_count: 1, distance_units: 12, travel_hours: 12 },
        ];
        const stages = buildRouteStages(segments, legs, contextOf(nodes, ["A", "B"]), { hoursPerDay: 8 });
        expect(stages.some((stage) => "slope" in stage)).toBe(false);
        expect(routeSlope(stages)).toBeUndefined();
        expect(stageSlope([], MILES)).toBeUndefined();
    });
});
