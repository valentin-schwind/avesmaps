import { describe, expect, it } from "vitest";
import { AVENTURIA_TRAVEL_MODEL, mapPointId } from "@avesmaps3d/shared";
import { NO_GROUND, prepareGround } from "../src/routing/ground.ts";
import { buildRouteNetwork, type RouteNode } from "../src/routing/network.ts";
import { calibrateRelief, type TerrainHeights } from "../src/routing/relief.ts";
import { NO_RIVERS } from "../src/routing/rivers.ts";
import { buildRouteGraph, findRoute, type OffroadTerrain, type RouteRequest } from "../src/routing/router.ts";
import { barrierBlocksChord, barrierContainsPoint, vehicleBarrier } from "../src/routing/vehicle-barrier.ts";
import { NO_WATER, prepareWater } from "../src/routing/water.ts";

/**
 * Wagen querfeldein (WI-0258, Betreiber 2026-10-29, E2 und S-6): Karren, Fuhrwerk und Kutsche fahren abseits der Wege nur
 * über offenes Land, Tundra und Hochebenen. Wald und die anderen Landschaften des Bodens sind für sie gesperrt, ebenso die
 * Gebirgsflächen. Die Sperre wirkt im Raster des gesuchten Gangs, an den geraden Verbindungen (Anker, Brücken des Netzes)
 * und für Kartenpunkte selbst (`vehicle-barrier.ts`).
 */

const model = AVENTURIA_TRAVEL_MODEL;

function polygon(minX: number, minY: number, maxX: number, maxY: number) {
    return {
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
    };
}

function ort(id: string, x: number, y: number): RouteNode {
    return { id, name: id, kind: "place", isHidden: false, x, y };
}

function weg(id: string, subtype: string, coordinates: [number, number][]) {
    return {
        public_id: id,
        name: id,
        subtype,
        coordinates: JSON.stringify({ type: "LineString", coordinates }),
        allowed_transports: null,
        transport_domain: null,
        flow_direction: null,
        flow_factor: null,
    };
}

/** Ein Wald von 120|98 bis 140|112, daneben eine Hochebene (offen) von 60|60 bis 80|80. */
const WALD = { minX: 120, minY: 98, maxX: 140, maxY: 112 };
const ground = prepareGround([
    { ...polygon(WALD.minX, WALD.minY, WALD.maxX, WALD.maxY), factor: 1.4, type: "wald" },
    { ...polygon(60, 60, 80, 80), factor: 1.1, type: "hochebene" },
]);

/** Ein Gebirge von 150|90 bis 170|110, flach auf 1.000 Schritt (jede Zelle trägt Höhe, also Gebirgsfläche). */
function gebirge(): TerrainHeights {
    const cell = 0.25;
    const width = 81;
    const samples = new Uint16Array(width * width).fill(1000);
    const raster = { cell, originX: 150, originY: 90, width, height: width, samples, maxX: 170, maxY: 110 };
    const rule = { kind: "steigung" as const, steigung: 0.3 };
    return { rasters: [raster], cones: [], rule, mu: calibrateRelief([raster], [], rule, model) };
}
const heights = gebirge();

const land = prepareWater([polygon(0, 0, 300, 300)]);
const terrain: OffroadTerrain = { land, rivers: NO_RIVERS, ground, heights };

const request = (transport: string): RouteRequest => ({
    optimize: "fastest",
    transports: { land: transport, river: "riverSailer", sea: "cargoShip" },
    enabled: { land: true, river: true, sea: true },
    minimizeTransfers: false,
});

/** Eine Straße von A (100|100) nach B (110|100). */
const strasse = weg("strasse", "Strasse", [
    [100, 100],
    [110, 100],
]);
const netz = () => buildRouteNetwork([ort("A", 100, 100), ort("B", 110, 100)], [strasse]);

function graphOf(network: ReturnType<typeof netz>, transport: string) {
    return buildRouteGraph(
        network,
        model,
        request(transport),
        NO_WATER,
        null,
        vehicleBarrier(model, transport, ground, heights),
    );
}
const route = (transport: string, to: string) => {
    const network = netz();
    return findRoute(network, graphOf(network, transport), ["A", to], terrain);
};

const OFFEN = mapPointId({ x: 104, y: 104 });
const IM_WALD = mapPointId({ x: 130, y: 105 });
const IM_GEBIRGE = mapPointId({ x: 160, y: 100 });
const HINTER_DEM_WALD = mapPointId({ x: 146, y: 103 });
const AUF_DER_HOCHEBENE = mapPointId({ x: 70, y: 70 });
const HINTER_DEM_GEBIRGE = mapPointId({ x: 175, y: 100 });

describe("Die Sperre der Wagen (vehicle-barrier.ts)", () => {
    it("🔴 Karren, Fuhrwerk und Kutsche haben eine, jedes andere Mittel nicht", () => {
        for (const transport of ["cart", "wagon", "horseCarriage"]) {
            expect(vehicleBarrier(model, transport, ground, heights), transport).not.toBeNull();
        }
        for (const transport of ["groupFoot", "lightWalker", "groupHorse", "lightRider", "caravan", "sleigh"]) {
            expect(vehicleBarrier(model, transport, ground, heights), transport).toBeNull();
        }
        // Ohne Boden und Gelände sperrt nichts.
        expect(vehicleBarrier(model, "horseCarriage", NO_GROUND, null)).toBeNull();
    });

    it("🔴 gesperrt ist jede Landschaft des Bodens außer den offenen (Hochebene), dazu das Gebirge", () => {
        const barrier = vehicleBarrier(model, "wagon", ground, heights);
        expect(barrier?.areas.map((area) => area.type)).toEqual(["wald"]);
        expect(barrier?.mountains).toBe(heights);
        // Ohne `gebirge` in der Regel bleibt es bei den Landschaften.
        const ohneGebirge = structuredClone(model);
        ohneGebirge.querfeldeinFahrzeuge.wert.gebirge = false;
        expect(vehicleBarrier(ohneGebirge, "wagon", ground, heights)?.mountains).toBeNull();
        // Fehlt das Gelände, sperrt das Gebirge nicht.
        expect(vehicleBarrier(model, "wagon", ground, null)?.mountains).toBeNull();
    });

    it("🔴 eine Sehne durch den Wald oder das Gebirge ist gesperrt, drumherum und über die Hochebene nicht", () => {
        const barrier = vehicleBarrier(model, "horseCarriage", ground, heights);
        if (!barrier) throw new Error("Sperre erwartet");
        expect(barrierBlocksChord(barrier, 110, 105, 146, 105)).toBe(true);
        expect(barrierBlocksChord(barrier, 145, 100, 175, 100)).toBe(true);
        expect(barrierBlocksChord(barrier, 100, 100, 110, 100)).toBe(false);
        expect(barrierBlocksChord(barrier, 110, 90, 146, 90)).toBe(false);
        expect(barrierBlocksChord(barrier, 55, 70, 85, 70)).toBe(false);
        // Ein Ende, das den Waldrand nur streift (eine Rasterzelle), bleibt Ausgangspunkt.
        expect(barrierBlocksChord(barrier, 110, 105, 120.1, 105)).toBe(false);
    });

    it("ein Punkt im Wald oder im Gebirge liegt in gesperrtem Land, einer daneben nicht", () => {
        const barrier = vehicleBarrier(model, "horseCarriage", ground, heights);
        if (!barrier) throw new Error("Sperre erwartet");
        expect(barrierContainsPoint(barrier, 130, 105)).toBe(true);
        expect(barrierContainsPoint(barrier, 160, 100)).toBe(true);
        expect(barrierContainsPoint(barrier, 104, 104)).toBe(false);
        expect(barrierContainsPoint(barrier, 70, 70)).toBe(false);
    });
});

describe("🔴 Ein Kartenpunkt für einen Wagen (WI-0258)", () => {
    it("auf offenem Land erreicht ihn die Kutsche querfeldein, mit dem Tempo ihrer Tafel", () => {
        const kutsche = route("horseCarriage", OFFEN);
        expect(kutsche.found).toBe(true);
        const gang = kutsche.segments.at(-1);
        expect(gang?.transport_type).toBe("horseCarriage");
        expect(gang?.subtype).toBe("Querfeldein");
        // Karren und Fuhrwerk ebenso.
        expect(route("cart", OFFEN).found).toBe(true);
        expect(route("wagon", OFFEN).found).toBe(true);
    });

    it("in einer Waldfläche erreicht ihn kein Wagen, die Gruppe zu Fuß schon", () => {
        for (const transport of ["horseCarriage", "cart", "wagon"]) {
            const outcome = route(transport, IM_WALD);
            expect(outcome.found, transport).toBe(false);
            expect(outcome.refused?.reason, transport).toBe("no_offroad_route");
        }
        expect(route("groupFoot", IM_WALD).found).toBe(true);
    });

    it("in einer Gebirgsfläche erreicht ihn kein Wagen, die Gruppe zu Fuß schon", () => {
        for (const transport of ["horseCarriage", "cart", "wagon"]) {
            const outcome = route(transport, IM_GEBIRGE);
            expect(outcome.found, transport).toBe(false);
            expect(outcome.refused?.reason, transport).toBe("no_offroad_route");
        }
        expect(route("groupFoot", IM_GEBIRGE).found).toBe(true);
    });

    it("auf einer Hochebene fährt er, sie ist offenes Land", () => {
        expect(route("horseCarriage", AUF_DER_HOCHEBENE).found).toBe(true);
    });

    it("hinter dem Wald fährt die Kutsche um ihn herum, der Wanderer geht gerade hindurch", () => {
        const kutsche = route("horseCarriage", HINTER_DEM_WALD);
        expect(kutsche.found).toBe(true);
        const gang = kutsche.segments.at(-1);
        const linie = (gang?.geometry.coordinates ?? []) as [number, number][];
        // Kein Stützpunkt, keine Stelle der Linie im Wald.
        for (let index = 1; index < linie.length; index += 1) {
            const [x1, y1] = linie[index - 1] as [number, number];
            const [x2, y2] = linie[index] as [number, number];
            for (let step = 0; step <= 40; step += 1) {
                const x = x1 + ((x2 - x1) * step) / 40;
                const y = y1 + ((y2 - y1) * step) / 40;
                expect(x > WALD.minX && x < WALD.maxX && y > WALD.minY && y < WALD.maxY).toBe(false);
            }
        }
        const fuss = route("groupFoot", HINTER_DEM_WALD).segments.at(-1);
        expect(gang?.distance_units ?? 0).toBeGreaterThan(fuss?.distance_units ?? Infinity);
    });
});

describe("🔴 Das Gebirge im Raster des gesuchten Gangs (WI-0258)", () => {
    it("hinter dem Gebirge fährt die Kutsche um die Gebirgsfläche herum, durch kein Stück von ihr", () => {
        const kutsche = route("horseCarriage", HINTER_DEM_GEBIRGE);
        expect(kutsche.found).toBe(true);
        const linie = (kutsche.segments.at(-1)?.geometry.coordinates ?? []) as [number, number][];
        for (let index = 1; index < linie.length; index += 1) {
            const [x1, y1] = linie[index - 1] as [number, number];
            const [x2, y2] = linie[index] as [number, number];
            for (let step = 0; step <= 40; step += 1) {
                const x = x1 + ((x2 - x1) * step) / 40;
                const y = y1 + ((y2 - y1) * step) / 40;
                expect(x > 150 && x < 170 && y > 90 && y < 110).toBe(false);
                expect(x > WALD.minX && x < WALD.maxX && y > WALD.minY && y < WALD.maxY).toBe(false);
            }
        }
    });
});

describe("🔴 Orte ohne Weg und Brücken für einen Wagen (WI-0258)", () => {
    /** A und B an der Straße; C liegt auf offenem Land, D im Wald, beide ohne Landweg. */
    const orte = () =>
        buildRouteNetwork([ort("A", 100, 100), ort("B", 110, 100), ort("C", 104, 106), ort("D", 130, 105)], [strasse]);

    it("ein Ort auf offenem Land bekommt seine Brücke oder seinen Anker, einer im Wald keinen", () => {
        const network = orte();
        for (const transport of ["horseCarriage", "cart", "wagon"]) {
            const graph = graphOf(network, transport);
            expect(findRoute(network, graph, ["A", "C"], terrain).found, `${transport} C`).toBe(true);
            expect(findRoute(network, graph, ["A", "D"], terrain).found, `${transport} D`).toBe(false);
        }
        // Zu Fuß geht es auch in den Wald: Er bremst nur.
        const fuss = graphOf(network, "groupFoot");
        expect(findRoute(network, fuss, ["A", "D"], terrain).found).toBe(true);
    });

    it("die Brücke zwischen Netzteilen quert keinen Wald: mit Sperre keine, ohne sie eine", () => {
        const network = orte();
        const ohne = buildRouteGraph(network, model, request("horseCarriage"));
        const mit = graphOf(network, "horseCarriage");
        // C liegt am Weg (eine Brücke); D im Wald gar nicht erst erreichbar.
        expect(ohne.bridgeCount).toBe(2);
        expect(mit.bridgeCount).toBe(1);
    });
});
