import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
    buildRouteNetwork,
    buildTopologyNetwork,
    storedLine,
    type PathRow,
    type RouteNetwork,
    type RouteNode,
} from "../src/routing/network.ts";
import { sliceProfile } from "../src/routing/profile-slice.ts";
import { NO_HEIGHT, pairSteps, PAIR_FLOATS, sampleOffsets, sumPairs } from "../src/routing/slope.ts";
import { NEAR_MISS, unmetSpots } from "../src/routing/topology-findings.ts";
import { deriveTopology, techNodeId } from "../src/routing/topology.ts";

/**
 * WI-0132 Release N: das Netz ohne Kreuzungsobjekte. Die Akzeptanzfälle der Betreiberentscheidung vom 2026-10-10
 * (`project-control/decisions/2026-10-10-wegenden-verbinden-ohne-kreuzungsobjekte.md`, samt Nachtrag „fünf Nachkommastellen“)
 * am echten `buildRouteNetwork`, ohne Datenbank: Hängen zwei Orte über Kanten zusammen, und wie?
 *
 * Problemfälle: zwei durchgehende Wege verbinden sich an ihrem Schnitt; ein Beinahe-Treffer wird still verbunden; ein T-Stoß
 * teilt das Höhenprofil falsch; ein technischer Knoten wird Wegpunkt; die Topologie hängt an der Reihenfolge der Eingabe; ein
 * Produktpfad liest die Tabelle `crossing`. Soll: die Regeln der Entscheidung, keine Toleranz, bitgleiche Profile ungeteilter
 * Stücke, und jede Stelle für den Prüfhaken „Wege treffen sich nicht“.
 */

const place = (id: string, x: number, y: number): RouteNode => ({
    id,
    name: id,
    kind: "place",
    isHidden: false,
    subtype: "dorf",
    x,
    y,
});

const row = (id: string, points: [number, number][], subtype = "Strasse"): PathRow => ({
    public_id: id,
    name: id,
    subtype,
    coordinates: JSON.stringify({ type: "LineString", coordinates: points }),
    allowed_transports: null,
    transport_domain: null,
    flow_direction: null,
    flow_factor: null,
});

/** Hängen zwei Knoten über Kanten zusammen? */
function connected(network: RouteNetwork, from: string, to: string): boolean {
    const next = new Map<string, string[]>();
    for (const link of network.links) {
        next.set(link.from, [...(next.get(link.from) ?? []), link.to]);
        next.set(link.to, [...(next.get(link.to) ?? []), link.from]);
    }
    const seen = new Set([from]);
    const stack = [from];
    while (stack.length > 0) {
        const node = stack.pop() as string;
        if (node === to) return true;
        for (const other of next.get(node) ?? []) {
            if (seen.has(other)) continue;
            seen.add(other);
            stack.push(other);
        }
    }
    return false;
}

const technical = (network: RouteNetwork): RouteNode[] =>
    [...network.nodes.values()].filter((node) => node.kind === "technical");

describe("WI-0132: Akzeptanzfälle der Entscheidung", () => {
    it("Ende–Ende: verbunden über einen technischen Knoten ohne Namen", () => {
        const { network, topology } = buildTopologyNetwork(
            [place("start", 0, 0), place("ziel", 20, 0)],
            [
                row("a", [
                    [0, 0],
                    [10, 0],
                ]),
                row("b", [
                    [10, 0],
                    [20, 0],
                ]),
            ],
        );
        expect(connected(network, "start", "ziel")).toBe(true);
        expect(technical(network)).toEqual([
            { id: techNodeId("10.00000:0.00000"), name: "", kind: "technical", isHidden: false, x: 10, y: 0 },
        ]);
        expect(topology.ends.filter((end) => end.contact === "ende").map((end) => end.pathPublicId)).toEqual([
            "a",
            "b",
        ]);
    });

    it("|- T-Stoß auf ein Segment ohne Stützpunkt: verbunden; der durchgehende Weg bleibt EIN Weg, nur der Graph teilt ihn", () => {
        const { network, topology } = buildTopologyNetwork(
            [place("west", 0, 0), place("ost", 20, 0), place("nord", 10, 10)],
            [
                row("durchgehend", [
                    [0, 0],
                    [20, 0],
                ]),
                row("stich", [
                    [10, 0],
                    [10, 10],
                ]),
            ],
        );
        expect(topology.insertedKeys).toEqual(["10.00000:0.00000"]);
        expect(connected(network, "west", "nord")).toBe(true);
        expect(connected(network, "ost", "nord")).toBe(true);
        const pieces = network.links.filter((link) => link.pathPublicId === "durchgehend");
        expect(pieces.map((link) => `${link.from}>${link.to}`)).toEqual([
            `west>${techNodeId("10.00000:0.00000")}`,
            `${techNodeId("10.00000:0.00000")}>ost`,
        ]);
        expect(pieces.reduce((sum, link) => sum + link.distance, 0)).toBeCloseTo(20, 12);
        // Die gespeicherte Linie bleibt, wie sie ist: Die Karte und die gezeichnete Route kennen keinen T-Punkt.
        expect(network.paths.get("durchgehend")).toEqual([
            [0, 0],
            [20, 0],
        ]);
    });

    it("|- T-Stoß auf einen inneren Stützpunkt: verbunden, nichts eingefügt", () => {
        const { network, topology } = buildTopologyNetwork(
            [place("west", 0, 0), place("ost", 20, 0), place("nord", 10, 10)],
            [
                row("durchgehend", [
                    [0, 0],
                    [10, 0],
                    [20, 0],
                ]),
                row("stich", [
                    [10, 0],
                    [10, 10],
                ]),
            ],
        );
        expect(topology.insertedKeys).toEqual([]);
        expect(topology.ends.find((end) => end.pathPublicId === "stich" && end.which === "anfang")?.contact).toBe(
            "stuetzpunkt",
        );
        expect(connected(network, "west", "nord")).toBe(true);
    });

    it("+ zwei durchgehende Wege, geometrischer Schnitt ohne Stützpunkt: nicht verbunden", () => {
        const network = buildRouteNetwork(
            [place("west", 0, 0), place("ost", 20, 0), place("sued", 10, -10), place("nord", 10, 10)],
            [
                row("waagrecht", [
                    [0, 0],
                    [20, 0],
                ]),
                row("senkrecht", [
                    [10, -10],
                    [10, 10],
                ]),
            ],
        );
        expect(technical(network)).toEqual([]);
        expect(connected(network, "west", "nord")).toBe(false);
    });

    it("+ mit identischen inneren Stützpunkten: weiterhin nicht verbunden", () => {
        const network = buildRouteNetwork(
            [place("west", 0, 0), place("ost", 20, 0), place("sued", 10, -10), place("nord", 10, 10)],
            [
                row("waagrecht", [
                    [0, 0],
                    [10, 0],
                    [20, 0],
                ]),
                row("senkrecht", [
                    [10, -10],
                    [10, 0],
                    [10, 10],
                ]),
            ],
        );
        expect(technical(network)).toEqual([]);
        expect(connected(network, "west", "nord")).toBe(false);
        expect(network.links.filter((link) => link.pathPublicId === "waagrecht")).toHaveLength(1);
    });

    it("Brücke ohne endenden Weg (Straße über Fluss, gleicher Stützpunkt): nicht verbunden", () => {
        const network = buildRouteNetwork(
            [place("west", 0, 0), place("ost", 20, 0), place("quelle", 10, -10), place("muendung", 10, 10)],
            [
                row("strasse", [
                    [0, 0],
                    [10, 0],
                    [20, 0],
                ]),
                row(
                    "fluss",
                    [
                        [10, -10],
                        [10, 0],
                        [10, 10],
                    ],
                    "Flussweg",
                ),
            ],
        );
        expect(connected(network, "west", "muendung")).toBe(false);
    });

    it("Beinahe-Treffer ÜBER dem Fangradius (Ende neben Ende, Ende neben Segment): keine Router-Verbindung", () => {
        const { network, topology } = buildTopologyNetwork(
            [place("start", 0, 0), place("ziel", 20, 0), place("nord", 30, 10), place("ost", 40, 0)],
            [
                row("a", [
                    [0, 0],
                    [10, 0],
                ]),
                // 🔴 0,05 liegt ÜBER `END_SNAP` (0,02 seit WI-0147): Der Fangradius am Wegende greift hier nicht.
                row("b", [
                    [10.05, 0],
                    [20, 0],
                ]),
                row("durchgehend", [
                    [20.6, 0],
                    [40, 0],
                ]),
                row("stich", [
                    [30, 0.05],
                    [30, 10],
                ]),
            ],
        );
        expect(connected(network, "start", "ziel")).toBe(false);
        expect(connected(network, "nord", "ost")).toBe(false);
        expect(topology.ends.filter((end) => end.contact === "offen").map((end) => end.pathPublicId)).toEqual([
            "a",
            "b",
            "durchgehend",
            "stich",
        ]);
    });

    it("🔴 der Fangradius am Wegende: bis 0,02 verbindet, darüber nicht", () => {
        // Seit 2026-10-14 entscheidet `END_SNAP`, nicht mehr der Fünfstellen-Schlüssel allein; seit WI-0147 steht er auf
        // 0,02 (Lücke hinter Gareth → Kaiserhain 0,0175). Hier: 0,0009 verbindet, 0,05 nicht.
        const verbunden = buildRouteNetwork(
            [place("start", 0, 0), place("ziel", 20, 0)],
            [
                row("a", [
                    [0, 0],
                    [10.000004, 0],
                ]),
                row("b", [
                    [10.0009, 0],
                    [20, 0],
                ]),
            ],
        );
        expect(connected(verbunden, "start", "ziel")).toBe(true);
        const getrennt = buildRouteNetwork(
            [place("start", 0, 0), place("ziel", 20, 0)],
            [
                row("a", [
                    [0, 0],
                    [10, 0],
                ]),
                row("b", [
                    [10.05, 0],
                    [20, 0],
                ]),
            ],
        );
        expect(connected(getrennt, "start", "ziel")).toBe(false);
    });

    /**
     * 💣 **Der Fall Kreuzung-9** (Betreiber 2026-10-14, Nutzerbericht Hallingen → Althof). An dieser ehemaligen Legacy-Kreuzung
     * stoßen zwei Stücke derselben Reichsstraße 1 aneinander. Legacy liefert beide Enden auf `561.429 572.836`; in der
     * Datenbank steht das eine Stück seit einem Import von 2026-09-22 (Contract 1) auf der Kreuzungskoordinate
     * `561.42859 572.83594`. Abstand: 0,00041 — nach `exactKey` zwei Schlüssel, also getrennt.
     *
     * 🔴 Gemessen in allen drei Umgebungen: Wehrheim → Althof rechnet 33,7 statt 7,7 Einheiten, weil die Straße in der Mitte
     * zerfällt. 325 der 3426 ehemaligen Kreuzungen hinterlassen so ein getrenntes Netz (lokale Messung 2026-10-14).
     *
     * Solange ein ORT im Kasten ±0,5 liegt, fängt ihn Regel 1 — deshalb fiel es nur dort auf, wo keiner liegt.
     */
    it("🔴 Kreuzung-9: zwei Enden derselben Straße 0,0004 auseinander sind verbunden", () => {
        const network = buildRouteNetwork(
            [place("althof", 566.25, 573.031), place("wehrheim", 558.5, 572.74307)],
            [
                row("nach-althof", [
                    [566.234, 573.016],
                    [561.429, 572.836],
                ]),
                row("nach-wehrheim", [
                    [561.42859, 572.83594],
                    [558.5, 572.74307],
                ]),
            ],
        );
        expect(connected(network, "althof", "wehrheim")).toBe(true);
    });

    it("🔴 die Toleranz gilt nur für ENDEN: zwei durchgehende Wege kreuzen sich weiterhin ohne Anschluss", () => {
        const network = buildRouteNetwork(
            [place("nord", 10, 10), place("sued", 10, -10), place("west", -10, 0.0004), place("ost", 30, 0.0004)],
            [
                row("nordsued", [
                    [10, 10],
                    [10, 0],
                    [10, -10],
                ]),
                row("westost", [
                    [-10, 0.0004],
                    [10, 0.0004],
                    [30, 0.0004],
                ]),
            ],
        );
        expect(connected(network, "nord", "west")).toBe(false);
    });

    /**
     * 🔴 **Die drei Formen mit Versatz unter dem Fangradius** (Betreiber 2026-10-14: „kann er das: >- oder -< oder |-“).
     * Jeder Versatz hier ist 0,0004 — die Größenordnung von Kreuzung-9, also das, was Legacy an ehemaligen Kreuzungen liefert.
     */
    it("🔴 >- drei Enden treffen sich mit Versatz: alle verbunden", () => {
        const network = buildRouteNetwork(
            [place("nordwest", -10, 10), place("suedwest", -10, -10), place("ost", 20, 0)],
            [
                row("von-nordwest", [
                    [-10, 10],
                    [0, 0],
                ]),
                row("von-suedwest", [
                    [-10, -10],
                    [0.0004, 0.0004],
                ]),
                row("nach-ost", [
                    [0.0002, -0.0003],
                    [20, 0],
                ]),
            ],
        );
        expect(connected(network, "nordwest", "ost")).toBe(true);
        expect(connected(network, "suedwest", "ost")).toBe(true);
        expect(connected(network, "nordwest", "suedwest")).toBe(true);
    });

    it("🔴 -< ein Weg endet, zwei gehen ab, mit Versatz: alle verbunden", () => {
        const network = buildRouteNetwork(
            [place("west", -20, 0), place("nordost", 10, 10), place("suedost", 10, -10)],
            [
                row("von-west", [
                    [-20, 0],
                    [0, 0],
                ]),
                row("nach-nordost", [
                    [0.0004, 0.0001],
                    [10, 10],
                ]),
                row("nach-suedost", [
                    [-0.0003, 0.0004],
                    [10, -10],
                ]),
            ],
        );
        expect(connected(network, "west", "nordost")).toBe(true);
        expect(connected(network, "west", "suedost")).toBe(true);
    });

    it("🔴 |- T-Stoß: ein Ende knapp NEBEN einem durchgehenden Weg", () => {
        const network = buildRouteNetwork(
            [place("nord", 0, 10), place("west", -10, 0), place("ost", 10, 0)],
            [
                // Durchgehend von West nach Ost, mit Stützpunkt genau auf (0|0).
                row("durchgehend", [
                    [-10, 0],
                    [0, 0],
                    [10, 0],
                ]),
                // Der Stich endet 0,0004 daneben - in Legacy hing hier eine Kreuzung.
                row("stich", [
                    [0.0004, 0.0004],
                    [0, 10],
                ]),
            ],
        );
        expect(connected(network, "nord", "west")).toBe(true);
    });

    it("Ort zuerst wie bisher: Enden im Kasten ±0,5 hängen am Ort, ein Innenpunkt genau auf einem Ort teilt", () => {
        const network = buildRouteNetwork(
            [place("start", 0, 0), place("dorf", 10, 0.3), place("ziel", 20, 0), place("hof", 5, 5)],
            [
                row("a", [
                    [0, 0],
                    [10, 0],
                ]),
                row("b", [
                    [10.2, 0.1],
                    [20, 0],
                ]),
                row("bogen", [
                    [0, 0],
                    [5, 5],
                    [20, 0],
                ]),
            ],
        );
        expect(technical(network)).toEqual([]);
        expect(connected(network, "start", "ziel")).toBe(true);
        expect(network.links.some((link) => link.pathPublicId === "a" && link.to === "dorf")).toBe(true);
        expect(network.links.some((link) => link.pathPublicId === "bogen" && link.to === "hof")).toBe(true);
    });

    it("Wegende ins Leere: Sackgasse, der Weg bleibt im Netz", () => {
        const network = buildRouteNetwork(
            [place("start", 0, 0)],
            [
                row("a", [
                    [0, 0],
                    [10, 0],
                ]),
            ],
        );
        expect(network.links.map((link) => [link.from, link.to])).toEqual([["start", techNodeId("10.00000:0.00000")]]);
    });

    it("ein Seeweg macht auch seinen T-Punkt zum Hafen", () => {
        const network = buildRouteNetwork(
            [place("hafen", 0, 0), place("ziel", 20, 0)],
            [
                row(
                    "see",
                    [
                        [0, 0],
                        [20, 0],
                    ],
                    "Seeweg",
                ),
                row(
                    "abzweig",
                    [
                        [10, 0],
                        [10, 10],
                    ],
                    "Seeweg",
                ),
            ],
        );
        expect([...network.seaBound].sort()).toEqual(
            ["hafen", "ziel", techNodeId("10.00000:0.00000"), techNodeId("10.00000:10.00000")].sort(),
        );
    });

    it("🔴 die Topologie hängt nicht an der Reihenfolge der Wege: gleiche Knoten, gleiche Lage", () => {
        const rows = [
            row("z", [
                [0, 0],
                [10.000001, 0],
            ]),
            row("a", [
                [10.000004, 0],
                [20, 0],
            ]),
            row("m", [
                [10, 0],
                [10, 5],
            ]),
        ];
        const one = buildRouteNetwork([], rows);
        const two = buildRouteNetwork([], [...rows].reverse());
        const nodes = (network: RouteNetwork): string[] =>
            technical(network)
                .map((node) => `${node.id}@${String(node.x)},${String(node.y)}`)
                .sort();
        expect(nodes(two)).toEqual(nodes(one));
        // Der Knoten steht auf dem Ende des nach Kennung ersten Weges ("a"), nicht auf dem zuerst gelesenen.
        expect(one.nodes.get(techNodeId("10.00000:0.00000"))).toMatchObject({ x: 10.000004, y: 0 });
    });
});

describe("WI-0132: das Höhenprofil eines geteilten Weges", () => {
    // Zwei Paare: (0|0)-(1|0) und (1|0)-(2|0), je 3.000 Schritt, je drei Abtastpunkte (zwei Schritte zu 1.500).
    const pairs = Float32Array.from([30, 0, 0, 0, 130, 0.02, 0, 0, 40, 0, 40, 140, 0, 0.0267]);
    const samples = Float32Array.from([3, 1500, 100, 1, 115, 1, 130, 1, 3, 1500, 140, 0, 120, 0, 100, 0]);
    const offsets = sampleOffsets(samples, 2) as Int32Array;
    const lengths = [3000, 3000];
    const profile = { pairs, samples: { values: samples, offsets }, lengths };

    it("🔴 ein Stück von Stützpunkt zu Stützpunkt bekommt bitgleich die Werte von bisher", () => {
        for (const [start, count] of [
            [0, 2],
            [0, 1],
            [1, 1],
        ] as const) {
            const expected = {
                ...sumPairs(pairs, start, count),
                steps: pairSteps(samples, offsets, start, count, lengths),
            };
            const sliced = sliceProfile(profile, { pair: start, t: 0 }, { pair: start + count, t: 0 });
            expect(sliced).toEqual(expected);
        }
    });

    it("🔴 geteilt mitten im Paar: Strecke und Anstieg beider Stücke ergeben genau die des ganzen Weges", () => {
        const whole = sliceProfile(profile, { pair: 0, t: 0 }, { pair: 2, t: 0 });
        const head = sliceProfile(profile, { pair: 0, t: 0 }, { pair: 0, t: 0.4 });
        const tail = sliceProfile(profile, { pair: 0, t: 0.4 }, { pair: 2, t: 0 });
        const sum = (steps: Float64Array | null, offset: number): number => {
            let total = 0;
            for (let index = 0; index + 4 < (steps?.length ?? 0); index += 5) total += steps?.[index + offset] ?? 0;
            return total;
        };
        expect(sum(head.steps, 1) + sum(tail.steps, 1)).toBeCloseTo(sum(whole.steps, 1), 9);
        expect(sum(head.steps, 0) + sum(tail.steps, 0)).toBeCloseTo(sum(whole.steps, 0), 9);
        // Das erste Stück endet bei 0,4 des ersten Paars, also 1.200 Schritt: ein Teilschritt ab 0 bis 1.200.
        expect(Array.from(head.steps ?? [])).toEqual([12, 1200, 1, 100, 0]);
        // Das zweite beginnt mit dem Rest des ersten Schritts (300) an Lage 0, dann die übrigen Schritte.
        const first = Array.from(tail.steps ?? []).slice(0, 5);
        [3, 300, 1, 112, 0].forEach((value, index) => expect(first[index]).toBeCloseTo(value, 9));
        expect(head.known && tail.known).toBe(true);
    });

    it("🔴 im Netz: ein T-Stoß teilt das Profil, die Summe über den Weg bleibt", () => {
        // Ohne Orte an den Enden des durchgehenden Weges: Sonst hinge der Stich (0,4 E daneben) im Kasten am Ort.
        const network = buildRouteNetwork(
            [place("nord", 0.4, 3)],
            [
                row("durchgehend", [
                    [0, 0],
                    [1, 0],
                    [2, 0],
                ]),
                row("stich", [
                    [0.4, 0],
                    [0.4, 3],
                ]),
            ],
            { profiles: new Map([["durchgehend", pairs]]), samples: new Map([["durchgehend", samples]]) },
        );
        const pieces = network.links.filter((link) => link.pathPublicId === "durchgehend");
        expect(pieces).toHaveLength(2);
        const run = pieces.reduce((total, link) => {
            const steps = link.slope?.steps ?? new Float64Array(0);
            for (let index = 1; index < steps.length; index += 5) total += steps[index] ?? 0;
            return total;
        }, 0);
        expect(run).toBeCloseTo(6000, 6);
        expect(pieces[0]?.slope?.highest, "Profil von vor S5c nur als Näherung, mit S5c die Schritte").not.toBe(
            NO_HEIGHT,
        );
        expect(pairs.length / PAIR_FLOATS).toBe(2);
    });
});

describe("WI-0132 P2: „Wege treffen sich nicht“", () => {
    const findingsOf = (places: RouteNode[], rows: PathRow[]) => {
        const { network, topology } = buildTopologyNetwork(places, rows);
        return unmetSpots(
            topology,
            network,
            rows.map((one) => ({ publicId: one.public_id, coordinates: storedLine(one) })),
        );
    };
    const spotsOf = (places: RouteNode[], rows: PathRow[]) => findingsOf(places, rows).spots;

    it("ein offenes Ende neben einem Weg: Stelle mit Abstand; unter dem Fangradius gibt es sie nicht mehr", () => {
        // 🔴 Seit 2026-10-14 verbindet `END_SNAP` ein Ende neben einem Segment (T-Stoß `|-`), seit WI-0147 bis 0,005. Offen
        // bleibt nur, was weiter weg liegt — hier 0,05. Was darunter liegt, ist verbunden und erscheint gar nicht als Stelle.
        const spots = spotsOf(
            [],
            [
                row("quer", [
                    [10, -5],
                    [10, 5],
                ]),
                row("knapp", [
                    [0, 0],
                    [9.95, 0],
                ]),
            ],
        );
        const knapp = spots.filter((spot) => spot.path === "knapp");
        expect(knapp.map((spot) => [spot.kind, spot.x, spot.other, spot.nearMiss])).toEqual([
            ["offen", 0, null, false],
            ["offen", 9.95, "quer", false],
        ]);
        expect(knapp[1]?.distance).toBeCloseTo(0.05, 9);
        expect(NEAR_MISS).toBe(0.02);

        // Dieselbe Stelle 0,0004 daneben: kein offenes Ende mehr, der Fangradius hat sie geschlossen.
        const gefangen = spotsOf(
            [],
            [
                row("quer", [
                    [10, -5],
                    [10, 5],
                ]),
                row("knapp", [
                    [0, 0],
                    [9.9996, 0],
                ]),
            ],
        );
        expect(gefangen.filter((spot) => spot.path === "knapp" && spot.x === 9.9996)).toEqual([]);
    });

    it("eine reparierte Stelle verschwindet: das Ende genau auf dem Weg ist ein T-Stoß", () => {
        const spots = spotsOf(
            [],
            [
                row("quer", [
                    [10, -5],
                    [10, 5],
                ]),
                row("knapp", [
                    [0, 0],
                    [10, 0],
                ]),
            ],
        );
        expect(spots.filter((spot) => spot.x === 10 && spot.y === 0)).toEqual([]);
    });

    it("zwei Treffpunkte ÜBER dem Fangradius sind getrennt (P1 „zerfallen“); über eine Kante verbunden nicht", () => {
        const spots = spotsOf(
            [place("w", -10, 0), place("o", 10, 0), place("n", 0, 10), place("s", 0, -10)],
            [
                row("a", [
                    [-10, 0],
                    [0, 0],
                ]),
                row("b", [
                    [0, 0],
                    [10, 0],
                ]),
                // 🔴 0,05 liegt über `END_SNAP`: Ohne diesen Abstand fänden sich die Enden jetzt und der Haken schwiege zu Recht.
                row("c", [
                    [0, 0.05],
                    [0, 10],
                ]),
                // Nicht durch (0|0): Sonst läge der erste Treffpunkt auf diesem Weg (T-Stoß) und beide hingen zusammen.
                row("d", [
                    [0, 0.05],
                    [5, 10],
                ]),
            ],
        );
        const getrennt = spots.filter((spot) => spot.kind === "getrennt");
        expect(getrennt.map((spot) => spot.path).sort()).toEqual(["a", "b", "c", "d"]);
        // 🔴 Kein `nearMiss` mehr: 0,05 liegt über `END_SNAP`, ist also kein Rundungsfall, sondern ein echter Abstand.
        // Was darunter liegt, verbindet der Fangradius und erscheint hier gar nicht erst (Betreiber 2026-10-14).
        expect(getrennt.every((spot) => spot.nearMiss)).toBe(false);

        const verbunden = spotsOf(
            [],
            [
                row("a", [
                    [-10, 0],
                    [0, 0],
                ]),
                row("brücke", [
                    [0, 0],
                    [0.2, 0],
                ]),
                row("c", [
                    [0.2, 0],
                    [0.2, 10],
                ]),
            ],
        );
        expect(verbunden.filter((spot) => spot.kind === "getrennt")).toEqual([]);
    });

    it("🔴 ein Ende genau auf einem Weg, aber am Ort im Kasten, den der Weg nicht erreicht: nur als Zahl (Entscheidung B)", () => {
        const findings = findingsOf(
            [place("dorf", 10.3, 0.3), place("west", 0, 0), place("ost", 20, 0), place("nord", 10, 10)],
            [
                row("strasse", [
                    [0, 0],
                    [20, 0],
                ]),
                row("stich", [
                    [10, 0],
                    [10, 10],
                ]),
            ],
        );
        expect(findings.atPlace).toBe(1);
        expect(
            findings.spots.filter((spot) => spot.path === "stich"),
            "keine Einzelstelle",
        ).toEqual([]);
    });

    it("zwei durchgehende Wege mit deckungsgleichem Stützpunkt: kreuzt, als Hinweis, nie als Verbindung", () => {
        const spots = spotsOf(
            [place("west", 0, 0), place("ost", 20, 0), place("sued", 10, -10), place("nord", 10, 10)],
            [
                row("waagrecht", [
                    [0, 0],
                    [10, 0],
                    [20, 0],
                ]),
                row("senkrecht", [
                    [10, -10],
                    [10, 0],
                    [10, 10],
                ]),
            ],
        );
        expect(spots.map((spot) => [spot.kind, spot.path, spot.other, spot.x, spot.y])).toEqual([
            ["kreuzt", "waagrecht", "senkrecht", 10, 0],
        ]);
    });
});

describe("WI-0132: keine produktive Abfrage auf `crossing`", () => {
    const SRC = resolve(import.meta.dirname, "..", "src");
    const files = (directory: string): string[] =>
        readdirSync(directory).flatMap((entry) => {
            const path = join(directory, entry);
            return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
        });

    it("🔴 kein Quelltext des Servers liest, schreibt oder verknüpft die Tabelle `crossing`", () => {
        const offenders = files(SRC).filter((file) =>
            /\b(FROM|INTO|UPDATE|JOIN)\s+crossing\b/i.test(readFileSync(file, "utf8")),
        );
        expect(offenders).toEqual([]);
    });

    it("die Topologie leitet sich nur aus Orten und Wegen ab (keine Kreuzung, kein Nodix als Knoten)", () => {
        const topology = deriveTopology(
            [place("ort", 0, 0)],
            [
                {
                    publicId: "w",
                    coordinates: [
                        [0, 0],
                        [5, 0],
                    ],
                },
            ],
        );
        expect(topology.techNodes.map((node) => node.id)).toEqual([techNodeId("5.00000:0.00000")]);
        const network = readFileSync(join(SRC, "routing", "network.ts"), "utf8");
        expect(network).not.toMatch(/\bFROM\s+(crossing|nodix)\b/);
    });
});
