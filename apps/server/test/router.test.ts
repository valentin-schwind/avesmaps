import { describe, expect, it } from "vitest";
import { AVENTURIA_TRAVEL_MODEL } from "@avesmaps3d/shared";
import { offroadRamp } from "../src/routing/map-points.ts";
import { buildRouteNetwork, type RouteNode } from "../src/routing/network.ts";
import { prepareRivers } from "../src/routing/rivers.ts";
import { buildRouteGraph, findRoute, type RouteRequest } from "../src/routing/router.ts";
import { techNodeId } from "../src/routing/topology.ts";
import { NO_WATER, prepareWater } from "../src/routing/water.ts";

/**
 * Die Wegfindung (WI-0017, ROUTE-A) an einem Netz aus wenigen Punkten. Die Parität gegen Legacys
 * eigenen Router misst `src/routing/parity-cli.ts` an echten Daten; hier stehen die Regeln einzeln.
 */

const model = AVENTURIA_TRAVEL_MODEL;
/** Tempo zu Fuß aus der Tafel: Straße 4,61, Pfad 3,68, querfeldein 3,22 (WdE, WI-0258). */
const STRASSE = 4.4625;
const PFAD = 3.57;
const QUERFELDEIN = 3.1237;
const STUNDEN_JE_ZEIT = 3 * 1.19;

function ort(id: string, x: number, y: number, extra: Partial<RouteNode> = {}): RouteNode {
    return { id, name: id, kind: "place", isHidden: false, x, y, ...extra };
}

function weg(
    id: string,
    subtype: string,
    coordinates: [number, number][],
    extra: Partial<{ allowed: string[] | null; domain: string | null; flow: "forward" | "reverse" | null }> = {},
) {
    return {
        public_id: id,
        name: id,
        subtype,
        coordinates: JSON.stringify({ type: "LineString", coordinates }),
        allowed_transports: extra.allowed ?? null,
        transport_domain: extra.domain ?? null,
        flow_direction: extra.flow ?? null,
        flow_factor: null,
    };
}

/** Ein Quadrat offenen Wassers. */
function see(minX: number, minY: number, maxX: number, maxY: number) {
    return prepareWater([
        {
            geometry: {
                type: "Polygon",
                coordinates: [
                    [
                        [minX, minY],
                        [maxX, minY],
                        [maxX, maxY],
                        [minX, maxY],
                        [minX, minY],
                    ],
                ],
            },
            minX,
            minY,
            maxX,
            maxY,
        },
    ]);
}

const zuFuss: RouteRequest = {
    optimize: "fastest",
    transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
    enabled: { land: true, river: true, sea: true },
    minimizeTransfers: false,
};
const nurLand: RouteRequest = { ...zuFuss, enabled: { land: true, river: false, sea: false } };

const abfolge = (route: ReturnType<typeof findRoute>): string[] =>
    route.segments.map((segment) => `${segment.subtype}:${segment.from_node}>${segment.to_node}`);

describe("Netz", () => {
    it("hängt ein Wegende im Kasten ±0,5 an einen Ort, und ein exakter Treffer geht vor", () => {
        const network = buildRouteNetwork(
            [ort("A", 100, 100), ort("B", 110, 100), ort("K", 110.3, 100.3)],
            [
                weg("w1", "Strasse", [
                    [100.2, 100.1],
                    [110, 100],
                ]),
            ],
        );
        expect(network.links[0]).toMatchObject({ from: "A", to: "B" });
    });

    it("🔴 ein Wegende ohne Ort und ohne Weg wird eine Sackgasse: der Weg bleibt im Netz (WI-0132)", () => {
        const network = buildRouteNetwork(
            [ort("A", 100, 100)],
            [
                weg("w1", "Strasse", [
                    [100, 100],
                    [120, 100],
                ]),
            ],
        );
        const ende = techNodeId("120.00000:100.00000");
        expect(network.links.map((link) => [link.from, link.to])).toEqual([["A", ende]]);
        expect(network.nodes.get(ende)).toMatchObject({ kind: "technical", name: "", isHidden: false });
    });

    it("teilt einen Weg an einem Innenpunkt, der exakt auf einem Knoten liegt", () => {
        const network = buildRouteNetwork(
            [ort("A", 100, 100), ort("M", 105, 100), ort("B", 110, 100)],
            [
                weg("w1", "Strasse", [
                    [100, 100],
                    [105, 100],
                    [110, 100],
                ]),
            ],
        );
        expect(network.links.map((link) => `${link.from}>${link.to}`)).toEqual(["A>M", "M>B"]);
    });

    it("🪤 kennt Häfen auch an Seewegen, die ins Leere laufen", () => {
        const network = buildRouteNetwork(
            [ort("H", 100, 100), ort("M", 105, 100)],
            [
                weg("see", "Seeweg", [
                    [100, 100],
                    [105, 100],
                    [150, 100],
                ]),
            ],
        );
        const ende = techNodeId("150.00000:100.00000");
        expect(network.links.map((link) => `${link.from}>${link.to}`)).toEqual(["H>M", `M>${ende}`]);
        expect([...network.seaBound].sort()).toEqual(["H", "M", ende]);
    });
});

describe("Route", () => {
    const network = buildRouteNetwork(
        [ort("A", 100, 100), ort("B", 110, 100), ort("C", 120, 100)],
        [
            weg("strasse", "Strasse", [
                [100, 100],
                [110, 100],
            ]),
            weg(
                "fluss",
                "Flussweg",
                [
                    [110, 100],
                    [120, 100],
                ],
                { flow: "forward" },
            ),
        ],
    );

    it("liefert Abschnitte in Legacys Form, mit Stunden wie Legacy", () => {
        const route = findRoute(network, buildRouteGraph(network, model, zuFuss), ["A", "C"]);
        expect(route.found).toBe(true);
        expect(abfolge(route)).toEqual(["Strasse:A>B", "Flussweg:B>C"]);
        // 10 Einheiten / 4,61 (Straße zu Fuß) + 10 / 5,95 (Flusssegler stromab), je x 3 x 1,19.
        expect(route.travelHours).toBeCloseTo((10 / STRASSE + 10 / 5.95) * STUNDEN_JE_ZEIT, 6);
        expect(route.segments[1]?.flow_state).toBe("downstream");
    });

    it("🔴 stromauf kostet Zeit x 2, wenn am Weg kein Faktor steht", () => {
        const route = findRoute(network, buildRouteGraph(network, model, zuFuss), ["C", "B"]);
        expect(route.segments[0]).toMatchObject({ flow_state: "upstream", flow_time_factor: 2 });
        expect(route.segments[0]?.cost_units).toBeCloseTo((10 / 5.95) * 2, 9);
    });

    it("ohne Fluss verbindet Querfeldein, ohne Land findet sich nichts", () => {
        const route = findRoute(network, buildRouteGraph(network, model, nurLand), ["A", "C"]);
        // C hängt nur am Fluss: Ohne ihn führen Brücke und Anker querfeldein zu B, 10 Einheiten.
        expect(abfolge(route)).toEqual(["Strasse:A>B", "Querfeldein:B>C"]);
        const ohneLand = { ...zuFuss, enabled: { land: false, river: false, sea: true } };
        const gesperrt = findRoute(network, buildRouteGraph(network, model, ohneLand), ["A", "C"]);
        expect(gesperrt.found).toBe(false);
        expect(gesperrt.failedLegIndex).toBe(0);
    });

    it("🪤 eine leere Transportliste mit Domäne sperrt den Weg für jedes Mittel", () => {
        const gesperrt = buildRouteNetwork(
            [ort("A", 100, 100), ort("B", 110, 100)],
            [
                weg(
                    "w1",
                    "Strasse",
                    [
                        [100, 100],
                        [110, 100],
                    ],
                    { allowed: [], domain: "land" },
                ),
            ],
        );
        const graph = buildRouteGraph(gesperrt, model, zuFuss);
        expect(graph.drawn.get("A")).toEqual([]);
        // Wie in Legacy bleibt dann nur die Notbrücke querfeldein.
        expect(abfolge(findRoute(gesperrt, graph, ["A", "B"]))).toEqual(["Querfeldein:A>B"]);
    });
});

describe("Querfeldein", () => {
    const strasse = weg("strasse", "Strasse", [
        [100, 100],
        [110, 100],
    ]);

    it("🔴 überbrückt einen abgetrennten Netzteil zum nächsten Knoten, mit Aufschlag x 25 nur im Gewicht", () => {
        const network = buildRouteNetwork(
            [ort("A", 100, 100), ort("B", 110, 100), ort("D", 130, 100), ort("E", 140, 100)],
            [
                strasse,
                weg("pfad", "Pfad", [
                    [130, 100],
                    [140, 100],
                ]),
            ],
        );
        const graph = buildRouteGraph(network, model, { ...nurLand, optimize: "shortest" });
        expect(graph.bridgeCount).toBe(1);
        const route = findRoute(network, graph, ["A", "E"]);
        expect(abfolge(route)).toEqual(["Strasse:A>B", "Querfeldein:B>D", "Pfad:D>E"]);
        const bruecke = route.segments[1];
        expect(bruecke).toMatchObject({ synthetic: true, cost_factor: 25, distance_units: 20, public_id: "" });
        expect(bruecke?.cost_units).toBeCloseTo((20 * 25) / QUERFELDEIN, 9);
        // Die Reisezeit rechnet ohne den Aufschlag - wie der Reiseplan der Karte.
        expect(route.travelHours).toBeCloseTo((10 / STRASSE + 20 / QUERFELDEIN + 10 / PFAD) * STUNDEN_JE_ZEIT, 6);

        // 🔴 Unter „Schnellste“ wird die benutzte Brücke gemessen wie jeder Gang querfeldein (R7): mit dem
        // Längenaufschlag ihrer Luftlinie. Die Sehne ist trocken, sie bleibt gerade (Entscheidung h).
        const schnell = findRoute(network, buildRouteGraph(network, model, nurLand), ["A", "E"]);
        const gemessen = schnell.segments[1];
        expect(gemessen).toMatchObject({
            edge_id: "synthetic-D->B",
            cost_factor: 25,
            distance_units: 20,
            offroad: false,
        });
        expect(gemessen?.geometry.coordinates).toEqual([
            [110, 100],
            [130, 100],
        ]);
        expect(gemessen?.cost_units).toBeCloseTo(((20 * 25) / QUERFELDEIN) * offroadRamp(model, 20), 9);
        expect(schnell.travelHours).toBeCloseTo(
            (10 / STRASSE + (20 / QUERFELDEIN) * offroadRamp(model, 20) + 10 / PFAD) * STUNDEN_JE_ZEIT,
            6,
        );
    });

    it("🔴 verankert einen Ort ohne Weg am Fußpunkt und teilt die Straße dort", () => {
        const network = buildRouteNetwork([ort("A", 100, 100), ort("B", 110, 100), ort("C", 106, 103)], [strasse]);
        const route = findRoute(network, buildRouteGraph(network, model, nurLand), ["A", "C"]);
        // Der Fußpunkt (106, 100) ist 3 Einheiten entfernt; die Brücke zum nächsten Ort B wären 5.
        expect(abfolge(route)).toEqual(["Strasse:A>__wp_anchor_0", "Querfeldein:__wp_anchor_0>C"]);
        expect(route.segments[0]).toMatchObject({ edge_id: "wp-slice-0-a", public_id: "strasse", distance_units: 6 });
        expect(route.segments[1]?.distance_units).toBeCloseTo(3, 9);
    });

    it("🔴 quert kein offenes Wasser: weder Brücke noch Anker", () => {
        const network = buildRouteNetwork([ort("A", 100, 100), ort("B", 110, 100), ort("D", 140, 100)], [strasse]);
        const trocken = findRoute(network, buildRouteGraph(network, model, nurLand), ["A", "D"]);
        expect(trocken.found).toBe(true);
        const nass = buildRouteGraph(network, model, nurLand, see(115, 90, 135, 110));
        expect(nass.bridgeCount).toBe(0);
        expect(findRoute(network, nass, ["A", "D"]).found).toBe(false);
    });

    it("nimmt das nächste TROCKENE Paar, wenn das nächste nass ist", () => {
        // D-B (20) quert den See, D-E (20,6) läuft an ihm vorbei.
        const network = buildRouteNetwork(
            [ort("A", 100, 100), ort("B", 110, 100), ort("E", 125, 120), ort("D", 130, 100)],
            [
                strasse,
                weg("weg", "Weg", [
                    [110, 100],
                    [125, 120],
                ]),
            ],
        );
        const graph = buildRouteGraph(network, model, nurLand, see(115, 95, 125, 105));
        const bruecke = graph.adjacency.get("D")?.find((edge) => edge.synthetic);
        expect(bruecke?.to).toBe("E");
    });

    it("🔴 WI-0117: ein zweiter Graph über demselben Wasser findet dieselben Brücken - die Sehnen sind gemerkt, nicht anders gerechnet", () => {
        const network = buildRouteNetwork(
            [ort("A", 100, 100), ort("B", 110, 100), ort("E", 125, 120), ort("D", 130, 100)],
            [
                strasse,
                weg("weg", "Weg", [
                    [110, 100],
                    [125, 120],
                ]),
            ],
        );
        const wasser = see(115, 95, 125, 105);
        const kanten = (graph: ReturnType<typeof buildRouteGraph>) =>
            [...graph.adjacency].map(([id, edges]) => [
                id,
                edges.map((edge) => [edge.to, edge.synthetic, edge.distance]),
            ]);
        const erster = buildRouteGraph(network, model, nurLand, wasser);
        const zweiter = buildRouteGraph(network, model, nurLand, wasser);
        // Ein anderes Profil über demselben Wasser sucht seine Brücken über dieselben Orte.
        const reiter = buildRouteGraph(
            network,
            model,
            { ...nurLand, transports: { ...nurLand.transports, land: "lightRider" } },
            wasser,
        );
        expect(erster.bridgeCount).toBe(1);
        expect(kanten(zweiter)).toEqual(kanten(erster));
        expect(reiter.bridgeCount).toBe(1);
        // Frisches Wasser mit denselben Flächen rechnet von vorn und kommt zum selben Ergebnis.
        expect(kanten(buildRouteGraph(network, model, nurLand, see(115, 95, 125, 105)))).toEqual(kanten(erster));
    });

    it("🪤 die Kutsche fährt querfeldein (WI-0258): Brücke und Anker wie jedes Mittel, nur nicht durch Wald und Gebirge", () => {
        const network = buildRouteNetwork([ort("A", 100, 100), ort("B", 110, 100), ort("C", 106, 103)], [strasse]);
        const kutsche = { ...nurLand, transports: { ...nurLand.transports, land: "horseCarriage" } };
        const graph = buildRouteGraph(network, model, kutsche);
        expect(graph.synthetic).toMatchObject({ transport: "horseCarriage" });
        expect(findRoute(network, graph, ["A", "C"]).found).toBe(true);
    });

    it("🔴 eine Insel ohne Landweg bleibt unerreichbar, auch über einen gezeichneten Seeweg (WI-0153 Schnitt 7e)", () => {
        const network = buildRouteNetwork(
            [ort("A", 100, 100), ort("B", 110, 100), ort("I", 110, 130)],
            [
                strasse,
                weg("see", "Seeweg", [
                    [110, 100],
                    [110, 130],
                ]),
            ],
        );
        expect(findRoute(network, buildRouteGraph(network, model, nurLand), ["A", "I"]).found).toBe(false);
        // Mit See, aber ohne Seegraph: Den gezeichneten Seeweg fährt der Router nicht mehr; dorthin fährt nur der Seegraph.
        const mitSee = findRoute(network, buildRouteGraph(network, model, zuFuss), ["A", "I"]);
        expect(mitSee.segments.some((segment) => segment.subtype === "Seeweg")).toBe(false);
    });

    it("🔴 ein versteckter Ort ist nur dann Brückenende, wenn die Anfrage ihn nennt", () => {
        const network = buildRouteNetwork(
            [
                ort("A", 100, 100),
                ort("B", 110, 100),
                ort("Y", 130, 100, { isHidden: true }),
                ort("Z", 140, 100, { isHidden: true }),
            ],
            [
                strasse,
                weg("pfad", "Pfad", [
                    [130, 100],
                    [140, 100],
                ]),
            ],
        );
        const graph = buildRouteGraph(network, model, nurLand);
        expect(graph.bridgeCount).toBe(0);
        const route = findRoute(network, graph, ["A", "Z"]);
        // Z hat einen Landweg, also keinen Anker. Die Brücke geht von Z aus, obwohl Y näher an B läge:
        // Y ist versteckt und nicht genannt.
        expect(abfolge(route)).toEqual(["Strasse:A>B", "Querfeldein:B>Z"]);
    });
});

describe("Die Notverbindungen biegen (R7, Legacy synthetic-refine)", () => {
    // Zwei Straßeninseln, A1–A2 im Westen, B1–B2 im Osten: Die Brücke geht A1–B1, 40 Einheiten auf y = 0.
    const network = buildRouteNetwork(
        [ort("A1", 0, 0), ort("A2", 0, 10), ort("B1", 40, 0), ort("B2", 40, 10)],
        [
            weg("west", "Strasse", [
                [0, 0],
                [0, 10],
            ]),
            weg("ost", "Strasse", [
                [40, 0],
                [40, 10],
            ]),
        ],
    );
    const fluss = (coordinates: [number, number][]) =>
        prepareRivers([{ coordinates, isBach: false, flowDirection: null, flowFactor: null }], model);
    /** Ein Fluss quer über die Sehne der Brücke, mit seinem Kopf bei y = 5. */
    const quer = fluss([
        [20, -30],
        [20, 5],
    ]);
    const brueckeVon = (route: ReturnType<typeof findRoute>) => route.segments.find((segment) => segment.synthetic);

    it("🔴 biegt die Brücke um einen Fluss, den sie quert: länger als die Sehne, und kein Stück quert ihn", () => {
        const graph = buildRouteGraph(network, model, nurLand);
        const vorher = brueckeVon(findRoute(network, graph, ["A1", "B1"]));
        expect(vorher?.geometry.coordinates).toHaveLength(2);
        const route = findRoute(network, graph, ["A1", "B1"], { land: NO_WATER, rivers: quer });
        const bruecke = brueckeVon(route);
        const linie = bruecke?.geometry.coordinates ?? [];
        expect(linie.length).toBeGreaterThan(2);
        expect(linie[0]).toEqual([0, 0]);
        expect(linie[linie.length - 1]).toEqual([40, 0]);
        expect(Math.max(...linie.map(([, y]) => y))).toBeGreaterThanOrEqual(5);
        // Die Kante bleibt eine Notverbindung: Kennung, Aufschlag x 25 im Gewicht, Warnung.
        expect(bruecke).toMatchObject({
            edge_id: "synthetic-B1->A1",
            cost_factor: 25,
            offroad: false,
            synthetic: true,
        });
        expect(bruecke?.distance_units).toBeGreaterThan(40);
        expect(bruecke?.cost_units).toBeGreaterThan(((bruecke?.distance_units ?? 0) * 25) / QUERFELDEIN);
    });

    it("🔴 unter „Kürzeste“ bleibt die Sehne, wie in Legacy", () => {
        const graph = buildRouteGraph(network, model, { ...nurLand, optimize: "shortest" });
        const bruecke = brueckeVon(findRoute(network, graph, ["A1", "B1"], { land: NO_WATER, rivers: quer }));
        expect(bruecke?.geometry.coordinates).toEqual([
            [0, 0],
            [40, 0],
        ]);
        expect(bruecke?.cost_units).toBeCloseTo((40 * 25) / QUERFELDEIN, 9);
    });

    it("führt kein Weg um das Hindernis, bleibt die Sehne - lieber grob als gar nicht", () => {
        const wand = fluss([
            [20, -300],
            [20, 300],
        ]);
        const route = findRoute(network, buildRouteGraph(network, model, nurLand), ["A1", "B1"], {
            land: NO_WATER,
            rivers: wand,
        });
        expect(route.found).toBe(true);
        expect(brueckeVon(route)?.geometry.coordinates).toHaveLength(2);
    });

    it("eine reine Straßenroute bleibt, wie sie war", () => {
        const graph = buildRouteGraph(network, model, nurLand);
        const ohne = findRoute(network, graph, ["A1", "A2"]);
        const mit = findRoute(network, graph, ["A1", "A2"], { land: NO_WATER, rivers: quer });
        expect(mit.segments).toEqual(ohne.segments);
        expect(mit.cost).toBe(ohne.cost);
    });
});

describe("🔴 WI-0258: Wege zu Fuß ohne Reisebeginn rechnen wie vor der Umstellung auf Wege des Entdeckers", () => {
    it("eine Reise nur auf Straße und Weg hat dieselbe Kantenfolge und dieselbe Zeit", () => {
        const network = buildRouteNetwork(
            [ort("A", 100, 100), ort("B", 110, 100), ort("C", 120, 100)],
            [
                weg("s", "Strasse", [
                    [100, 100],
                    [110, 100],
                ]),
                weg("w", "Weg", [
                    [110, 100],
                    [120, 100],
                ]),
            ],
        );
        const route = findRoute(network, buildRouteGraph(network, model, nurLand), ["A", "C"]);
        expect(abfolge(route)).toEqual(["Strasse:A>B", "Weg:B>C"]);
        // Die Tafelwerte der Gruppe zu Fuß auf Straße (30 Meilen) und Weg (24) sind die der Geographia geblieben.
        expect(route.travelHours).toBeCloseTo((10 / 4.4625 + 10 / 3.57) * STUNDEN_JE_ZEIT, 9);
    });
});
