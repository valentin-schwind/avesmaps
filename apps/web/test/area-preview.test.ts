import { afterEach, describe, expect, it, vi } from "vitest";
import { featureFilter } from "@maplibre/maplibre-gl-style-spec";
import type { LandscapeSelection, MapView } from "@avesmaps3d/shared";
import type { Map as MapLibreMap } from "maplibre-gl";
import { installAreaSelection, outlineArea } from "../src/map/area-selection-input";
import {
    AREA_PREVIEW_OUTLINE_LAYER_ID,
    AREA_PREVIEW_OUTLINE_SOURCE_ID,
    PATH_PREVIEW_SOURCE_ID,
    buildAreaPreviewOutlineLayer,
    buildAreaPreviewOutlineSource,
} from "../src/map/area-selection";
import { createHarness, feature, mouse } from "./fake-interaction-map";
import {
    LANDSCAPE_FILL_LAYER_IDS,
    LANDSCAPE_SOURCE_ID,
    LANDSCAPE_SOURCE_LAYER,
    WATER_FILL_LAYER_ID,
    WATER_SEA_FILL_LAYER_ID,
    WATER_SOURCE_ID,
    WATER_SOURCE_LAYER,
    buildLandscapeSource,
    buildWaterSource,
} from "../src/map/landscape-layers";
import { displayDefaults } from "../src/map/map-display";
import { buildPlaceStyle } from "../src/map/place-layers";
import { inBand, territoryBandForZoom } from "../src/map/territory-band";
import { TERRITORY_SOURCE_ID, TERRITORY_SOURCE_LAYER, buildTerritorySource } from "../src/map/territory-layers";
import type { AreaCandidate } from "../src/map/area-candidates";

/**
 * Die Vorschau beim Zeigen ist EINE kleine GeoJSON-Quelle (`area-preview-outline`), gefüllt aus den Kacheln, die die Karte ohnehin geladen
 * hat (WI-0266, `vorschau-umriss.ts`). Geprüft wird hier die Wahl der Quelle und was in der Vorschau-Quelle landet: welche Kachelquelle samt
 * Filter `querySourceFeatures` bekommt und was `setData` erhält. Die Kartenseite (Feature-State, `setFilter`) darf nie mehr berührt werden.
 */

const LAND = LANDSCAPE_FILL_LAYER_IDS[0] as string;
const LEER = { type: "FeatureCollection", features: [] };

const candidate = (id: string): AreaCandidate => ({ kind: "landscape", id, name: id, type: "wald", area: 1 });

/** Eine Form in den geladenen Kacheln. Ihre Lage (`x`) sagt dem Test, welche Region die Vorschau gelesen hat. */
interface Tile {
    source: string;
    sourceLayer: string;
    properties: Record<string, unknown>;
    geometry: { type: "Polygon"; coordinates: [number, number][][] };
}
const form = (source: string, sourceLayer: string, properties: Record<string, unknown>, x: number): Tile => ({
    source,
    sourceLayer,
    properties,
    geometry: {
        type: "Polygon",
        coordinates: [
            [
                [x, 0],
                [x + 1, 0],
                [x + 1, 1],
                [x, 0],
            ],
        ],
    },
});
const landForm = (id: string, x: number): Tile =>
    form(LANDSCAPE_SOURCE_ID, LANDSCAPE_SOURCE_LAYER, { region_public_id: id }, x);
const waterForm = (id: string, x: number): Tile =>
    form(WATER_SOURCE_ID, WATER_SOURCE_LAYER, { region_public_id: id }, x);
const territoryForm = (id: string, x: number, band: number, bandTo: number = band): Tile =>
    form(TERRITORY_SOURCE_ID, TERRITORY_SOURCE_LAYER, { territory_public_id: id, band, band_to: bandTo }, x);

/** Der Filter einer Abfrage, wie MapLibre ihn an einer Kachelform auswertet. */
const passes = (filter: unknown, properties: Record<string, unknown>): boolean =>
    filter === undefined ||
    featureFilter(filter as never, "filter").filter({ zoom: 5 }, { type: 3, properties } as never, undefined as never);

/** Die Vorschau-Quelle der Karte: was `setData` bekam, steht auch in `serialize` (so liest sie das Nachführen nach einem neuen Stil). */
function vorschauQuelle() {
    let daten: unknown;
    const setData = vi.fn((neu: unknown) => {
        daten = neu;
    });
    return { setData, serialize: () => ({ type: "geojson", data: daten }) };
}

/**
 * Eine Karte als Testdoppel. `layers`: Was der Stil trägt (ohne Landschaftsebene kommt der Umriss vom Server, wie in den Höhenstufen);
 * `tiles`: Was `querySourceFeatures` in den geladenen Kacheln findet.
 */
function mapDouble(layers: readonly string[] = [LAND], tiles: readonly Tile[] = []) {
    let quelle = vorschauQuelle();
    const kachelquelle = {};
    const api = {
        on: vi.fn(),
        getLayer: (id: string) => (layers.includes(id) ? {} : undefined),
        getSource: (id: string) =>
            id === AREA_PREVIEW_OUTLINE_SOURCE_ID
                ? quelle
                : [LANDSCAPE_SOURCE_ID, WATER_SOURCE_ID, TERRITORY_SOURCE_ID].includes(id)
                  ? kachelquelle
                  : undefined,
        getZoom: () => 5,
        querySourceFeatures: vi.fn((source: string, abfrage: { sourceLayer?: string; filter?: unknown }) =>
            tiles.filter(
                (tile) =>
                    tile.source === source &&
                    tile.sourceLayer === abfrage.sourceLayer &&
                    passes(abfrage.filter, tile.properties),
            ),
        ),
        // Die Kartenseite (Zustand am Kachelobjekt, Filterwechsel) bleibt unberührt: Jeder Aufruf wäre ein Fehler.
        setFilter: vi.fn(),
        setFeatureState: vi.fn(),
        removeFeatureState: vi.fn(),
    };
    return {
        map: api as unknown as MapLibreMap,
        api,
        setData: quelle.setData,
        /** Ein neuer Stil: Die Quelle steht als neues, leeres Objekt da. */
        ersetzeQuelle: () => (quelle = vorschauQuelle()),
    };
}

/** Die Lage jeder Form, die eine Vorschau-Quelle trägt (siehe `form`): Welche Regionen sie zeigt. */
const gelesen = (daten: unknown): number[] =>
    (daten as { features: { geometry: { coordinates: number[][][] } }[] }).features.map(
        (entry) => entry.geometry.coordinates[0]![0]![0]!,
    );
/** Was `setData` zuletzt bekam. */
const zuletzt = (setData: { mock: { lastCall: readonly unknown[] | undefined } }): number[] =>
    gelesen(setData.mock.lastCall?.[0]);

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("Hover preview is the latest state", () => {
    it("A → B → C retains only C without style/filter work or deferred old states", async () => {
        const { map, api, setData } = mapDouble([LAND], [landForm("A", 1), landForm("B", 2), landForm("C", 3)]);
        for (const id of ["A", "B", "C"]) outlineArea(map, candidate(id));
        await Promise.resolve();
        expect(api.setFilter).not.toHaveBeenCalled();
        expect(api.setFeatureState).not.toHaveBeenCalled();
        expect(api.removeFeatureState).not.toHaveBeenCalled();
        // Jede Vorschau trägt genau ihre eine Form; am Ende steht nur C da.
        expect(setData.mock.calls.map(([daten]) => gelesen(daten))).toEqual([[1], [2], [3]]);
        expect(api.querySourceFeatures).toHaveBeenLastCalledWith(LANDSCAPE_SOURCE_ID, {
            sourceLayer: LANDSCAPE_SOURCE_LAYER,
            filter: ["==", ["get", "region_public_id"], "C"],
        });
        outlineArea(map, undefined);
        expect(setData).toHaveBeenLastCalledWith(LEER);
    });
    it("repeated moves in the same region do not mutate the preview", () => {
        const { map, api, setData } = mapDouble([LAND], [landForm("same", 1)]);
        for (let i = 0; i < 50; i += 1) outlineArea(map, candidate("same"));
        expect(api.setFilter).not.toHaveBeenCalled();
        expect(api.querySourceFeatures).toHaveBeenCalledTimes(1);
        expect(setData).toHaveBeenCalledTimes(1);
        // Die Karte hört einmal auf neue Kacheln, Bewegung und Stil - nicht einmal je Zeigerbewegung.
        expect(api.on.mock.calls.map(([name]) => name).sort()).toEqual(["moveend", "sourcedata", "styledata"]);
    });
    it("aborts A on B, clears the old outline immediately, rejects late A and aborts on hover end", async () => {
        const pending: { signal: AbortSignal; resolve: (response: Response) => void }[] = [];
        vi.stubGlobal(
            "fetch",
            vi.fn(
                (_url: string, options: RequestInit) =>
                    new Promise<Response>((resolve) =>
                        pending.push({ signal: options.signal as AbortSignal, resolve }),
                    ),
            ),
        );
        // Ohne Landschaftsebene im Stil kommt der Umriss vom Server (WI-0058).
        const { map, setData } = mapDouble([]);
        outlineArea(map, candidate("server-A"));
        outlineArea(map, candidate("server-B"));
        expect(pending[0]?.signal?.aborted).toBe(true);
        // Noch nichts gezeigt, also auch nichts Altes zu räumen.
        expect(setData).not.toHaveBeenCalled();
        const response = (id: string) =>
            new Response(
                JSON.stringify({
                    features: [
                        {
                            properties: { region_public_id: id, region_type: "wald" },
                            geometry: { type: "Polygon", coordinates: [] },
                        },
                    ],
                }),
            );
        pending[1]!.resolve(response("server-B"));
        await vi.waitFor(() =>
            expect(setData).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    features: [
                        expect.objectContaining({
                            properties: expect.objectContaining({ region_public_id: "server-B" }),
                        }),
                    ],
                }),
            ),
        );
        const calls = setData.mock.calls.length;
        pending[0]!.resolve(response("server-A"));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(setData).toHaveBeenCalledTimes(calls);
        // Der Umriss von B geht sofort weg, noch ehe C antwortet.
        outlineArea(map, candidate("server-C"));
        expect(setData).toHaveBeenLastCalledWith(LEER);
        outlineArea(map, undefined);
        expect(pending[2]?.signal.aborted).toBe(true);
        expect(setData).toHaveBeenLastCalledWith(LEER);
        outlineArea(map, candidate("server-B"));
        await Promise.resolve();
        expect(pending).toHaveLength(3);
        expect(setData).toHaveBeenLastCalledWith(
            expect.objectContaining({
                features: [
                    expect.objectContaining({ properties: expect.objectContaining({ region_public_id: "server-B" }) }),
                ],
            }),
        );
    });
});

describe("preview sources and ownership", () => {
    it("promotes stable region/territory identities; the preview hangs on its own GeoJSON source without feature-state paint", () => {
        expect(buildLandscapeSource("tiles")).toMatchObject({
            promoteId: { [LANDSCAPE_SOURCE_LAYER]: "region_public_id" },
        });
        expect(buildWaterSource("tiles")).toMatchObject({
            promoteId: { [WATER_SOURCE_LAYER]: "region_public_id" },
        });
        expect(buildTerritorySource("tiles")).toMatchObject({
            promoteId: { [TERRITORY_SOURCE_LAYER]: "territory_public_id" },
        });
        // Die Vorschau zeichnet MapLibre in jedem Bild ganz (WI-0266): Sie hängt darum an einer kleinen eigenen Quelle, nicht an einer
        // Kachelquelle, und ihre Deckkraft hängt an keinem Feature-State.
        const layer = buildAreaPreviewOutlineLayer();
        expect(layer).toMatchObject({
            id: AREA_PREVIEW_OUTLINE_LAYER_ID,
            type: "line",
            source: AREA_PREVIEW_OUTLINE_SOURCE_ID,
        });
        expect(layer).not.toHaveProperty("source-layer");
        expect(JSON.stringify(layer)).not.toContain("feature-state");
        expect(layer).not.toHaveProperty("paint.line-opacity");
        expect(buildAreaPreviewOutlineSource()).toEqual({ type: "geojson", data: LEER });
    });
    it("switches landscapes, smooth water and territories without retaining another target", () => {
        const band = territoryBandForZoom(5);
        const { map, api, setData } = mapDouble(
            [LAND, WATER_FILL_LAYER_ID],
            [
                landForm("land", 1),
                waterForm("lake", 2),
                territoryForm("realm", 3, band),
                // Dasselbe Gebiet in einem anderen Band: Die Kachel trägt alle Bänder, die Vorschau nur das der Ansicht.
                territoryForm("realm", 9, band + 1, band + 2),
            ],
        );
        outlineArea(map, candidate("land"));
        expect(api.querySourceFeatures).toHaveBeenLastCalledWith(LANDSCAPE_SOURCE_ID, {
            sourceLayer: LANDSCAPE_SOURCE_LAYER,
            filter: ["==", ["get", "region_public_id"], "land"],
        });
        expect(zuletzt(setData)).toEqual([1]);
        // Ein See wird an der weichen Form umrissen, wo die Karte sie zeichnet (WI-0055).
        outlineArea(map, { ...candidate("lake"), type: "see" });
        expect(api.querySourceFeatures).toHaveBeenLastCalledWith(WATER_SOURCE_ID, {
            sourceLayer: WATER_SOURCE_LAYER,
            filter: ["==", ["get", "region_public_id"], "lake"],
        });
        expect(zuletzt(setData)).toEqual([2]);
        outlineArea(map, { ...candidate("realm"), kind: "territory" });
        expect(api.querySourceFeatures).toHaveBeenLastCalledWith(TERRITORY_SOURCE_ID, {
            sourceLayer: TERRITORY_SOURCE_LAYER,
            filter: inBand(band, ["==", ["get", "territory_public_id"], "realm"]),
        });
        expect(zuletzt(setData)).toEqual([3]);
        expect(api.setFilter).not.toHaveBeenCalled();
        expect(api.setFeatureState).not.toHaveBeenCalled();
        outlineArea(map, undefined);
        expect(setData).toHaveBeenLastCalledWith(LEER);
    });
    it.each([
        ["a landscape reads the landscape tiles", [LAND], "wald", LANDSCAPE_SOURCE_ID, LANDSCAPE_SOURCE_LAYER],
        [
            "a lake reads the smooth form where the map draws it",
            [LAND, WATER_FILL_LAYER_ID],
            "see",
            WATER_SOURCE_ID,
            WATER_SOURCE_LAYER,
        ],
        [
            "a sea reads the smooth form of its ground layer",
            [LAND, WATER_SEA_FILL_LAYER_ID],
            "meer",
            WATER_SOURCE_ID,
            WATER_SOURCE_LAYER,
        ],
        [
            "a lake without smooth water keeps to the landscape tiles",
            [LAND],
            "see",
            LANDSCAPE_SOURCE_ID,
            LANDSCAPE_SOURCE_LAYER,
        ],
        [
            "smooth water does not take a landscape that is no water",
            [LAND, WATER_FILL_LAYER_ID],
            "wald",
            LANDSCAPE_SOURCE_ID,
            LANDSCAPE_SOURCE_LAYER,
        ],
    ])("%s", (_name, layers, type, source, sourceLayer) => {
        const { map, api } = mapDouble(layers);
        outlineArea(map, { ...candidate("x"), type });
        expect(api.querySourceFeatures).toHaveBeenCalledTimes(1);
        expect(api.querySourceFeatures).toHaveBeenCalledWith(source, {
            sourceLayer,
            filter: ["==", ["get", "region_public_id"], "x"],
        });
    });
    it("where no landscape layer is drawn, the tiles are not read: the outline comes from the server", () => {
        const fetched = vi.fn(() => new Promise<Response>(() => undefined));
        vi.stubGlobal("fetch", fetched);
        // Die Höhenstufen: Das Wasser ist da, die Landschaftsflächen sind es nicht.
        const { map, api } = mapDouble([WATER_FILL_LAYER_ID]);
        outlineArea(map, { ...candidate("hoehe"), type: "gebirge" });
        expect(api.querySourceFeatures).not.toHaveBeenCalled();
        expect(fetched).toHaveBeenCalledTimes(1);
    });
    it("reapplies the same target after a source replacement", () => {
        const { map, api, setData, ersetzeQuelle } = mapDouble([LAND], [landForm("reload", 4)]);
        outlineArea(map, candidate("reload"));
        expect(setData).toHaveBeenCalledTimes(1);
        const neu = ersetzeQuelle();
        outlineArea(map, candidate("reload"));
        expect(zuletzt(neu.setData)).toEqual([4]);
        expect(neu.setData).toHaveBeenCalledTimes(1);
        expect(setData).toHaveBeenCalledTimes(1);
        expect(api.removeFeatureState).not.toHaveBeenCalled();
    });
    it("a new style brings the preview source back empty: the shown form goes back in without another hover", () => {
        const { map, api, ersetzeQuelle } = mapDouble([LAND], [landForm("stil", 5)]);
        outlineArea(map, candidate("stil"));
        const imStil = api.on.mock.calls.find(([name]) => name === "styledata")?.[1] as () => void;
        const neu = ersetzeQuelle();
        imStil();
        expect(zuletzt(neu.setData)).toEqual([5]);
        // Ein zweites `styledata` ändert nichts mehr: Die Quelle trägt die Form schon.
        imStil();
        expect(neu.setData).toHaveBeenCalledTimes(1);
    });
    it("ending hover on one map does not cancel another map's preview", () => {
        const signals: AbortSignal[] = [];
        vi.stubGlobal(
            "fetch",
            vi.fn(
                (_url: string, options: RequestInit) =>
                    new Promise<Response>(() => {
                        signals.push(options.signal as AbortSignal);
                    }),
            ),
        );
        const first = mapDouble([]);
        const second = mapDouble([]);
        outlineArea(first.map, candidate("independent-first"));
        outlineArea(second.map, candidate("independent-second"));
        outlineArea(first.map, undefined);
        expect(signals[0]?.aborted).toBe(true);
        expect(signals[1]?.aborted).toBe(false);
        outlineArea(second.map, undefined);
        expect(signals[1]?.aborted).toBe(true);
    });
    it("M8 coalesces A/B/C and clears outline work on mouseout, suspension, loss of priority and disposal", async () => {
        const signals: AbortSignal[] = [];
        vi.stubGlobal(
            "fetch",
            vi.fn(
                (_url: string, options: RequestInit) =>
                    new Promise<Response>((_resolve, reject) => {
                        const signal = options.signal as AbortSignal;
                        signals.push(signal);
                        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {
                            once: true,
                        });
                    }),
            ),
        );
        const harness = createHarness();
        const { api, setData } = mapDouble([]);
        Object.assign(harness.map, { getSource: api.getSource });
        // Der Treffer kommt aus der Ebene des Wassers; eine Landschaftsebene steht nicht im Stil, die Vorschau holt den Umriss also vom
        // Server (die Höhenstufen, WI-0058). Der Treffer selbst ist nicht der Gegenstand dieses Falls.
        const hitLayer = WATER_FILL_LAYER_ID;
        harness.map.layers.add(hitLayer);
        const dispose = installAreaSelection(harness.map as unknown as MapLibreMap, harness.coordinator, {
            current: () => undefined,
            select: vi.fn(),
            hint: vi.fn(),
            choices: vi.fn(),
        });
        const move = (id: string) => {
            harness.map.hits = [feature(hitLayer, { region_public_id: id, region_type: "gebirge", name: id, area: 1 })];
            harness.map.fire("mousemove", mouse(5, 5));
        };
        for (const id of ["ownership-A", "ownership-B", "ownership-C"]) move(id);
        harness.flushFrames();
        expect(signals).toHaveLength(1);
        harness.map.fire("mouseout", mouse(0, 0));
        expect(signals[0]?.aborted).toBe(true);
        move("ownership-D");
        harness.flushFrames();
        const resume = harness.coordinator.suspendHover("test");
        expect(signals[1]?.aborted).toBe(true);
        resume();
        move("ownership-E");
        harness.flushFrames();
        const unregisterHigher = harness.coordinator.register({
            id: "higher",
            priority: 100,
            kinds: ["hover"],
            layers: () => [],
            hit: () => ({}),
            apply: vi.fn(),
        });
        move("ownership-F");
        harness.flushFrames();
        expect(signals[2]?.aborted).toBe(true);
        // Keine abgebrochene Antwort landet in der Vorschau.
        expect(setData).not.toHaveBeenCalled();
        unregisterHigher();
        move("ownership-G");
        harness.flushFrames();
        dispose();
        expect(signals[3]?.aborted).toBe(true);
        harness.coordinator.destroy();
        await Promise.resolve();
    });
});

describe("the style carries the preview as small own sources, never as layers over the tile sources", () => {
    function stil(view: MapView, selection: LandscapeSelection, extra: { territories?: boolean } = {}) {
        return buildPlaceStyle({
            tileUrl: "/t/{z}/{x}/{y}",
            landscapeUrl: "/l/{z}/{x}/{y}",
            landscapeRunUrl: "/r/{z}/{x}/{y}",
            mapLabelUrl: "/m/{z}/{x}/{y}",
            climateUrl: "/c/{z}/{x}/{y}",
            pathUrl: "/p/{z}/{x}/{y}",
            pathLabelUrl: "/pl/{z}/{x}/{y}",
            powerlineUrl: "/pw/{z}/{x}/{y}",
            leyNodeUrl: "/n/{z}/{x}/{y}",
            waterUrl: "/tiles/vector/terrain_water_render/{z}/{x}/{y}",
            seriesId: "original",
            view,
            landscapeSelection: selection,
            display: { ...displayDefaults(view) },
            ...(extra.territories
                ? { territories: { schemaVersion: 1 as const, revision: "abcdef012345", displayYearBf: 1049 } }
                : {}),
        } as never);
    }
    const ansichten = [
        ["standard", stil("standard", "alle"), undefined],
        ["landscapes/alle", stil("landscapes", "alle"), true],
        ["landscapes/vegetation", stil("landscapes", "vegetation"), true],
        ["political", stil("political", "alle", { territories: true }), true],
    ] as const;

    it.each(ansichten)(
        "%s: jede Vorschau-Ebene liest eine GeoJSON-Quelle, und die alten Ebenen sind weg",
        (_name, s) => {
            const vorschau = s.layers.filter((layer) => layer.id.includes("preview"));
            for (const layer of vorschau) {
                expect(s.sources[(layer as { source: string }).source], layer.id).toMatchObject({ type: "geojson" });
                expect(layer, layer.id).not.toHaveProperty("source-layer");
            }
            const namen = vorschau.map((layer) => layer.id);
            for (const alt of ["area-preview-line", "area-preview-water", "area-preview-territory"]) {
                expect(namen).not.toContain(alt);
            }
            // Die Quellen stehen immer da (leer kosten sie nichts); ob gezeigt wird, sagen die Ebenen.
            expect(s.sources[AREA_PREVIEW_OUTLINE_SOURCE_ID]).toMatchObject({ type: "geojson" });
            expect(s.sources[PATH_PREVIEW_SOURCE_ID]).toMatchObject({ type: "geojson" });
        },
    );

    it.each(ansichten)("%s: die Flächenvorschau steht, wo es eine Fläche zu zeigen gibt", (_name, s, mitFlaechen) => {
        const ebene = s.layers.some((layer) => layer.id === AREA_PREVIEW_OUTLINE_LAYER_ID);
        expect(ebene).toBe(mitFlaechen === true);
    });
});
