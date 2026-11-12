import { afterEach, describe, expect, it, vi } from "vitest";
import type { FilterSpecification, Map as MapLibreMap } from "maplibre-gl";
import { KEIN_UMRISS, linienInKachel, setzeUmriss, umrissAusKacheln, zeigeUmriss } from "../src/map/vorschau-umriss.ts";

/**
 * Die Vorschau beim Zeigen liest ihre Form aus den Kacheln, die die Karte ohnehin geladen hat (WI-0266). Eine Kachel trägt ihre Polygone samt
 * Puffer über den Rand hinaus, dort beschnitten: Als Linie gezeichnet stünde jede Schnittkante als Strich im Bild, und im Puffer lägen zwei
 * Kacheln doppelt. Geprüft werden der Zuschnitt auf das eigene Quadrat und die Umrechnung in Längen und Breiten.
 */

const punkte = (...paare: [number, number][]): { x: number; y: number }[] => paare.map(([x, y]) => ({ x, y }));

/** Der Zuschnitt rechnet mit Bruchteilen der Strecke: auf eine Milliardstel gerundet vergleichen (und -0 als 0). */
const gerundet = (linien: [number, number][][]): [number, number][][] =>
    linien.map((linie) => linie.map(([x, y]) => [Math.round(x * 1e9) / 1e9 + 0, Math.round(y * 1e9) / 1e9 + 0]));

describe("linienInKachel: die Linien auf das Quadrat der eigenen Kachel zuschneiden", () => {
    it("eine Strecke ganz im Quadrat bleibt unverändert", () => {
        expect(
            gerundet(
                linienInKachel(
                    [
                        punkte([10, 10], [50, 60], [90, 20]),
                        // Auf dem Rand zählt als innen.
                        punkte([0, 0], [100, 0]),
                    ],
                    100,
                ),
            ),
        ).toEqual([
            [
                [10, 10],
                [50, 60],
                [90, 20],
            ],
            [
                [0, 0],
                [100, 0],
            ],
        ]);
    });

    it("ein Ring, der die ganze Kachel samt Puffer deckt, hat in ihr keine Kante: Die Schnittkanten im Puffer fallen weg", () => {
        const ring = punkte([-20, -20], [120, -20], [120, 120], [-20, 120], [-20, -20]);
        expect(linienInKachel([ring], 100)).toEqual([]);
    });

    it("ein Ring, der über den Rand reicht, behält nur die Strecken im Quadrat - auf den Rand gekappt", () => {
        // Die rechte Kante des Rings (x = 180) und die untere (y = 200) liegen im Puffer: Sie sind die Schnittkante der Kachel.
        const ring = punkte([60, 40], [180, 40], [180, 200], [60, 200], [60, 40]);
        const linien = gerundet(linienInKachel([ring], 100));
        expect(linien).toEqual([
            [
                [60, 40],
                [100, 40],
            ],
            [
                [60, 100],
                [60, 40],
            ],
        ]);
        for (const [x, y] of linien.flat()) {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(100);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(y).toBeLessThanOrEqual(100);
        }
    });

    it("eine Linie, die das Quadrat verlässt und wieder betritt, wird zu zwei Linien", () => {
        const linien = gerundet(linienInKachel([punkte([10, 50], [150, 50], [150, 80], [10, 80])], 100));
        expect(linien).toEqual([
            [
                [10, 50],
                [100, 50],
            ],
            [
                [100, 80],
                [10, 80],
            ],
        ]);
    });

    it("eine Strecke durch das Quadrat, deren Enden beide draußen liegen, wird auf beiden Seiten gekappt", () => {
        expect(gerundet(linienInKachel([punkte([-50, 40], [150, 40])], 100))).toEqual([
            [
                [0, 40],
                [100, 40],
            ],
        ]);
    });

    it("ein Punkt, eine doppelte Stelle und eine Linie ganz draußen ergeben nichts", () => {
        expect(linienInKachel([punkte([5, 5]), punkte([5, 5], [5, 5]), punkte([200, 200], [300, 250])], 100)).toEqual(
            [],
        );
    });
});

/** Die Kachelform, wie MapLibre sie bei `querySourceFeatures` liefert: Rohform samt Kachel (`_vectorTileFeature`, `_x`, `_y`, `_z`). */
function kachelform(
    linien: { x: number; y: number }[][],
    kachel: { x: number; y: number; z: number },
    extent: number,
    properties: Record<string, unknown> | null = {},
) {
    return {
        properties,
        geometry: { type: "Polygon", coordinates: [] },
        _vectorTileFeature: { extent, loadGeometry: () => linien },
        _x: kachel.x,
        _y: kachel.y,
        _z: kachel.z,
    };
}

/** Die Umrechnung von Kachelpunkten wie in MapLibres `GeoJSONFeature.projectPoint`, hier unabhängig noch einmal ausgeschrieben. */
function lngLat(px: number, py: number, kachel: { x: number; y: number; z: number }, extent: number): [number, number] {
    const size = extent * 2 ** kachel.z;
    const x0 = extent * kachel.x;
    const y0 = extent * kachel.y;
    const y2 = 180 - ((py + y0) * 360) / size;
    return [((px + x0) * 360) / size - 180, (360 / Math.PI) * Math.atan(Math.exp((y2 * Math.PI) / 180)) - 90];
}

const nachLngLat = (umriss: ReturnType<typeof umrissAusKacheln>, feature = 0): [number, number][][] =>
    umriss.features[feature]!.geometry.coordinates as [number, number][][];

describe("umrissAusKacheln: die Form der Vorschau aus den Kachelformen", () => {
    it("rechnet Kachelpunkte in Längen und Breiten um, wie MapLibre selbst", () => {
        // Ganze Welt in einer Kachel: Ecke links oben und rechts unten.
        const welt = umrissAusKacheln([kachelform([punkte([0, 0], [4096, 4096])], { x: 0, y: 0, z: 0 }, 4096)]);
        const nordwest = nachLngLat(welt)[0]![0]!;
        const suedost = nachLngLat(welt)[0]![1]!;
        expect(nordwest[0]).toBeCloseTo(-180, 9);
        expect(nordwest[1]).toBeCloseTo(85.0511287798, 6);
        expect(suedost[0]).toBeCloseTo(180, 9);
        expect(suedost[1]).toBeCloseTo(-85.0511287798, 6);
        // Mitte der Welt: Länge 0, Breite 0.
        const mitte = nachLngLat(
            umrissAusKacheln([kachelform([punkte([0, 4096], [100, 4096])], { x: 1, y: 0, z: 1 }, 4096)]),
        );
        expect(mitte[0]![0]![0]).toBeCloseTo(0, 9);
        expect(mitte[0]![0]![1]).toBeCloseTo(0, 9);
        // Eine tiefere Kachel gegen die ausgeschriebene Formel.
        const kachel = { x: 17, y: 11, z: 5 };
        const punkt = nachLngLat(
            umrissAusKacheln([kachelform([punkte([1234, 2345], [20, 30])], kachel, 8192)]),
        )[0]![0]!;
        const erwartet = lngLat(1234, 2345, kachel, 8192);
        expect(punkt[0]).toBeCloseTo(erwartet[0], 9);
        expect(punkt[1]).toBeCloseTo(erwartet[1], 9);
    });

    it("schneidet jede Form auf ihr eigenes Kachelquadrat: Nachbarkacheln legen eine Strecke genau einmal, ohne Doppel im Puffer", () => {
        // Dieselbe Straße über die Grenze zweier Kacheln (z = 1): Jede Kachel trägt sie samt Puffer über den Rand hinaus.
        const westen = { x: 0, y: 0, z: 1 };
        const osten = { x: 1, y: 0, z: 1 };
        const umriss = umrissAusKacheln([
            kachelform([punkte([50, 10], [120, 10])], westen, 100),
            kachelform([punkte([-20, 10], [60, 10])], osten, 100),
        ]);
        expect(umriss.features).toHaveLength(2);
        const [links] = nachLngLat(umriss, 0);
        const [rechts] = nachLngLat(umriss, 1);
        // Westlich endet sie an der Grenze (Länge 0), östlich beginnt sie dort: nichts liegt zweimal.
        expect(links!.at(-1)![0]).toBeCloseTo(0, 9);
        expect(rechts![0]![0]).toBeCloseTo(0, 9);
        expect(links![0]![0]).toBeLessThan(0);
        expect(rechts!.at(-1)![0]).toBeGreaterThan(0);
    });

    it("eine Form, die in ihrer Kachel nur Puffer ist, ergibt keine Linie", () => {
        const ring = punkte([-20, -20], [120, -20], [120, 120], [-20, 120], [-20, -20]);
        expect(umrissAusKacheln([kachelform([ring], { x: 3, y: 3, z: 3 }, 100)]).features).toEqual([]);
    });

    it("behält von den Eigenschaften genau die genannten: die Art des Wegs für den Abstand der Striche", () => {
        const form = kachelform([punkte([10, 10], [20, 20])], { x: 0, y: 0, z: 0 }, 100, {
            subtype: "Pfad",
            name: "Alter Saumpfad",
            public_id: "p1",
        });
        expect(umrissAusKacheln([form], ["subtype"]).features[0]!.properties).toEqual({ subtype: "Pfad" });
        expect(umrissAusKacheln([form]).features[0]!.properties).toEqual({});
        // Eine Form ohne Eigenschaften (`null`) trägt auch dann keine.
        const ohne = kachelform([punkte([10, 10], [20, 20])], { x: 0, y: 0, z: 0 }, 100, null);
        expect(umrissAusKacheln([ohne], ["subtype"]).features[0]!.properties["subtype"]).toBeUndefined();
    });

    it("ohne Angaben zur Kachel gilt die Form, wie geliefert: Ringe und Linien als Linien, Punkte gar nicht", () => {
        const ring: [number, number][] = [
            [1, 1],
            [2, 1],
            [2, 2],
            [1, 1],
        ];
        const umriss = umrissAusKacheln([
            { properties: { n: 1 }, geometry: { type: "Polygon", coordinates: [ring] } },
            { properties: {}, geometry: { type: "MultiPolygon", coordinates: [[ring], [ring, ring]] } },
            {
                properties: {},
                geometry: {
                    type: "LineString",
                    coordinates: [
                        [5, 5],
                        [6, 6],
                    ],
                },
            },
            { properties: {}, geometry: { type: "Point", coordinates: [9, 9] } },
        ]);
        expect(umriss.features.map((entry) => entry.geometry.type)).toEqual([
            "MultiLineString",
            "MultiLineString",
            "MultiLineString",
        ]);
        expect(umriss.features.map((entry) => entry.geometry.coordinates.length)).toEqual([1, 3, 1]);
        expect(umriss.features[0]!.geometry.coordinates[0]).toEqual(ring);
    });
});

describe("zeigeUmriss und setzeUmriss: die Vorschau folgt den Kacheln, nur solange sie etwas zeigt", () => {
    const abfrage = (filter: FilterSpecification | (() => FilterSpecification) = ["==", ["get", "a"], 1] as never) => ({
        source: "kacheln",
        sourceLayer: "schicht",
        filter,
    });
    const linie = {
        properties: {},
        geometry: {
            type: "LineString",
            coordinates: [
                [1, 2],
                [3, 4],
            ],
        },
    };
    let bilder: (() => void)[];

    /** Eine Karte mit der Vorschau-Quelle `vorschau` und der Kachelquelle `kacheln`; die Ereignisse löst der Test von Hand aus. */
    function karte() {
        const handlers = new Map<string, (event: object) => void>();
        const setData = vi.fn();
        const querySourceFeatures = vi.fn(() => [linie]);
        const map = {
            on: (name: string, handler: (event: object) => void) => handlers.set(name, handler),
            getSource: (id: string) =>
                id === "vorschau" ? { setData, serialize: () => ({}) } : id === "kacheln" ? {} : undefined,
            querySourceFeatures,
        } as unknown as MapLibreMap;
        return { map, handlers, setData, querySourceFeatures };
    }

    function stubBild(): void {
        bilder = [];
        vi.stubGlobal("requestAnimationFrame", (callback: () => void) => bilder.push(callback));
    }
    afterEach(() => vi.unstubAllGlobals());

    it("liest die Form beim Zeigen und danach höchstens einmal je Bild, wenn eine Kachel der Quelle nachkommt", () => {
        stubBild();
        const { map, handlers, setData, querySourceFeatures } = karte();
        zeigeUmriss(map, "vorschau", abfrage());
        expect(querySourceFeatures).toHaveBeenCalledTimes(1);
        expect(querySourceFeatures).toHaveBeenCalledWith("kacheln", {
            sourceLayer: "schicht",
            filter: ["==", ["get", "a"], 1],
        });
        expect(setData).toHaveBeenCalledTimes(1);
        // Zwei Kacheln im selben Bild: ein Lesen. Eine fremde Quelle oder ein Ereignis ohne Kachel löst nichts aus.
        handlers.get("sourcedata")!({ sourceId: "kacheln", tile: {} });
        handlers.get("sourcedata")!({ sourceId: "kacheln", tile: {} });
        handlers.get("sourcedata")!({ sourceId: "andere", tile: {} });
        handlers.get("sourcedata")!({ sourceId: "kacheln" });
        expect(bilder).toHaveLength(1);
        bilder.shift()!();
        expect(querySourceFeatures).toHaveBeenCalledTimes(2);
        expect(setData).toHaveBeenCalledTimes(2);
    });

    it("liest nach jeder Kamerabewegung neu, ein Filter als Funktion dabei neu bestimmt; ohne Form liest sie nichts", () => {
        stubBild();
        const { map, handlers, querySourceFeatures } = karte();
        const filter = vi.fn(() => ["==", ["get", "a"], 2] as unknown as FilterSpecification);
        zeigeUmriss(map, "vorschau", abfrage(filter));
        expect(filter).toHaveBeenCalledTimes(1);
        handlers.get("moveend")!({});
        bilder.shift()!();
        expect(filter).toHaveBeenCalledTimes(2);
        expect(querySourceFeatures).toHaveBeenCalledTimes(2);
        // Nichts mehr gezeigt: Eine Bewegung plant kein Lesen.
        zeigeUmriss(map, "vorschau", undefined);
        handlers.get("moveend")!({});
        handlers.get("sourcedata")!({ sourceId: "kacheln", tile: {} });
        expect(bilder).toHaveLength(0);
        expect(querySourceFeatures).toHaveBeenCalledTimes(2);
    });

    it("leert die Quelle, wenn nichts mehr gezeigt wird - und fasst sie nicht an, solange sie schon leer ist", () => {
        stubBild();
        const { map, setData } = karte();
        zeigeUmriss(map, "vorschau", undefined);
        expect(setData).not.toHaveBeenCalled();
        zeigeUmriss(map, "vorschau", abfrage());
        zeigeUmriss(map, "vorschau", undefined);
        expect(setData).toHaveBeenLastCalledWith(KEIN_UMRISS);
        const aufrufe = setData.mock.calls.length;
        zeigeUmriss(map, "vorschau", undefined);
        expect(setData).toHaveBeenCalledTimes(aufrufe);
    });

    it("ein Umriss vom Server folgt keinen Kacheln: Er bleibt stehen, bis etwas Neues gezeigt wird", () => {
        stubBild();
        const { map, handlers, setData, querySourceFeatures } = karte();
        const vomServer = { type: "FeatureCollection" as const, features: [] };
        setzeUmriss(map, "vorschau", vomServer);
        expect(setData).toHaveBeenLastCalledWith(vomServer);
        handlers.get("moveend")!({});
        handlers.get("sourcedata")!({ sourceId: "kacheln", tile: {} });
        expect(bilder).toHaveLength(0);
        expect(querySourceFeatures).not.toHaveBeenCalled();
        zeigeUmriss(map, "vorschau", undefined);
        expect(setData).toHaveBeenLastCalledWith(KEIN_UMRISS);
    });
});
