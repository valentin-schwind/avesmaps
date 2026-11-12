import { expect, test, type Page } from "@playwright/test";
import { openMap } from "./map-handle.ts";

/**
 * Spike, second part: can a source configuration alone guarantee one name per type run?
 *
 * The first spike (`curve-labels.spec.ts`) showed that MapLibre reaches the legacy look but prints
 * the name twice once a run crosses a tile boundary. A run is the unit Avesmaps derives, so that
 * would silently turn one landscape name into several. This file works through the levers a source
 * offers and records what each one actually does.
 *
 * The answer is no, and the reason is in MapLibre's own source rather than in these numbers.
 * Cross-tile deduplication keys a symbol by `murmur3(shaping.text)` plus its anchor position,
 * rounded to a shared grid (`symbol_layout.ts`, `cross_tile_symbol_index.ts`). Two fragments of one
 * run produce anchors in different places, so they are two distinct labels by construction - no
 * feature id, and therefore no `promoteId`, takes part in that key at all.
 *
 * What the numbers add is which levers fail and how: some leave the duplicate untouched, some trade
 * it for a lost name, and the one that works - the tile buffer - has a ceiling the specification
 * puts at one tile width. That ceiling turns the guarantee into a bound on the run rather than a
 * setting, and both edges of that bound are measured here. A lost name is worse than a duplicate,
 * because nothing on the map shows that it is missing.
 */

const LAYER = "tile-probe";
const SOURCE = "tile-probe";
const NAME = "DRACHENSTEINE";

interface ProbeOptions {
    /** Chord length of the run in screen pixels. */
    length: number;
    zoom: number;
    /** Tile units of overlap the source keeps around each tile. MapLibre's default is 128. */
    buffer?: number;
    /** Highest zoom the source builds tiles for; above it MapLibre overzooms one coarser tile. */
    maxzoom?: number;
    placement?: "line" | "line-center";
    avoidEdges?: boolean;
    /** Shifts the run sideways, so it falls differently against the tile grid. */
    offsetX?: number;
}

interface ProbeMap {
    getStyle(): { layers: { id: string }[] };
    getSource(id: string): unknown;
    addSource(id: string, source: unknown): void;
    removeLayer(id: string): void;
    removeSource(id: string): void;
    addLayer(layer: unknown): void;
    getLayer(id: string): unknown;
    setLayoutProperty(layer: string, property: string, value: unknown): void;
    setPaintProperty(layer: string, property: string, value: unknown): void;
    jumpTo(options: { center: unknown; zoom: number }): void;
    getCenter(): unknown;
    unproject(point: [number, number]): { lng: number; lat: number };
    queryRenderedFeatures(options: { layers: string[] }): unknown[];
    once(event: string, handler: () => void): void;
    getCanvas(): HTMLCanvasElement;
}

/** Draws one run under the given source settings and returns how many names ended up on the map. */
async function namesFor(page: Page, options: ProbeOptions): Promise<number> {
    return page.evaluate(
        async ({ options: probe, name, sourceId, layerId }) => {
            const map = globalThis.avesmapsMap as unknown as ProbeMap;
            map.jumpTo({ center: map.getCenter(), zoom: probe.zoom });
            await new Promise<void>((resolve) => map.once("idle", resolve));

            const canvas = map.getCanvas();
            const centreX = canvas.clientWidth / 2 + (probe.offsetX ?? 0);
            const centreY = canvas.clientHeight / 2;
            const points: [number, number][] = [];
            for (let index = 0; index <= 64; index++) {
                const t = index / 64;
                const x = centreX - probe.length / 2 + t * probe.length;
                const y = centreY - Math.sin(t * Math.PI) * 20;
                const { lng, lat } = map.unproject([x, y]);
                points.push([lng, lat]);
            }

            if (map.getLayer(layerId)) {
                map.removeLayer(layerId);
            }
            if (map.getSource(sourceId)) {
                map.removeSource(sourceId);
            }
            const source: Record<string, unknown> = {
                type: "geojson",
                // No simplification, so nothing but the tiling is under test.
                tolerance: 0,
                buffer: probe.buffer ?? 128,
                data: {
                    type: "Feature",
                    properties: { name },
                    geometry: { type: "LineString", coordinates: points },
                },
            };
            if (probe.maxzoom !== undefined) {
                source.maxzoom = probe.maxzoom;
            }
            map.addSource(sourceId, source);
            map.addLayer({
                id: layerId,
                type: "symbol",
                source: sourceId,
                layout: {
                    "text-field": ["get", "name"],
                    "text-font": ["Faculty Glyphic Regular"],
                    "text-size": 28,
                    "text-letter-spacing": 0.3,
                    "symbol-placement": probe.placement ?? "line-center",
                    "symbol-avoid-edges": probe.avoidEdges ?? false,
                },
                paint: { "text-color": "#2b2117", "text-halo-width": 0 },
            });
            await new Promise<void>((resolve) => map.once("idle", resolve));
            return map.queryRenderedFeatures({ layers: [layerId] }).length;
        },
        { options, name: NAME, sourceId: SOURCE, layerId: LAYER },
    );
}

test.describe("one type run, one name", () => {
    test.beforeEach(async ({ page }) => {
        await openMap(page);
        await page.evaluate(() => {
            const map = globalThis.avesmapsMap as unknown as ProbeMap;
            // 🪤 Seit WI-0009 haengt es an der Ansicht, welche Layer es gibt - jeder Zugriff
            // wird geprueft. Und ausgeblendet wird JEDER Layer, der Schrift zeichnet: eine
            // Tintenmessung, die fremde Buchstaben mitzaehlt, misst nicht, was sie behauptet.
            // Die Ortsnamen stehen seit WI-0135 je Klasse und Seite in eigenen Ebenen.
            const ortsnamen = map
                .getStyle()
                .layers.map((layer) => layer.id)
                .filter(
                    (id) =>
                        id.startsWith("place-label-") ||
                        id.startsWith("map-label-") ||
                        id.startsWith("landscape-label-run-"),
                );
            for (const id of ["basemap", ...ortsnamen]) {
                if (map.getLayer(id)) {
                    map.setLayoutProperty(id, "visibility", "none");
                }
            }
            if (map.getLayer("place-marker")) {
                map.setPaintProperty("place-marker", "circle-opacity", 0);
                map.setPaintProperty("place-marker", "circle-stroke-width", 0);
            }
        });
    });

    /**
     * The shape of the problem: the name is printed once per fragment, and the number of fragments
     * follows the number of boundaries the run crosses. It is not a rare edge case at one length.
     */
    test("prints one name per fragment the run is cut into", async ({ page }) => {
        expect(await namesFor(page, { length: 900, zoom: 5 }), "inside one tile").toBe(1);
        expect(await namesFor(page, { length: 1500, zoom: 5 }), "across a boundary").toBeGreaterThan(1);
        expect(await namesFor(page, { length: 2400, zoom: 5 }), "across several").toBeGreaterThan(1);
    });

    /** The same holds at every zoom, so it cannot be tuned away with a zoom range either. */
    test("cuts the run at every zoom, not only at one", async ({ page }) => {
        for (const zoom of [2, 5, 8]) {
            expect(await namesFor(page, { length: 2400, zoom }), `zoom ${zoom}`).toBeGreaterThan(1);
        }
    });

    /**
     * `symbol-avoid-edges` reads like the answer and is not: it keeps a symbol from straddling a
     * tile edge, which is about collisions between neighbouring tiles, not about one feature that
     * was cut in two. Measured, it changes nothing at all.
     */
    test("symbol-avoid-edges does not merge the fragments", async ({ page }) => {
        const plain = await namesFor(page, { length: 2400, zoom: 5 });
        const guarded = await namesFor(page, { length: 2400, zoom: 5, avoidEdges: true });
        expect(guarded).toBe(plain);
    });

    /**
     * The tile buffer is the lever that works, and it has a hard ceiling: the style specification
     * caps it at 512, which is "a buffer as wide as the tile itself". Every touching tile then
     * carries the whole of a short enough run, all of them compute the same middle, and MapLibre's
     * own cross-tile deduplication collapses them into one name.
     *
     * The ceiling is why this is a bound on the run rather than a setting on its own: a run long
     * enough to outreach a full tile of overlap gets cut again, and no larger buffer exists.
     */
    test("the maximum tile buffer is one tile wide and cannot be raised", async ({ page }) => {
        expect(
            await namesFor(page, { length: 1500, zoom: 5, buffer: 512 }),
            "a full tile of overlap merges this run",
        ).toBe(1);
        expect(
            await namesFor(page, { length: 2600, zoom: 5, buffer: 512 }),
            "a run that outreaches it is cut again",
        ).toBeGreaterThan(1);
    });

    /**
     * The invariant the design rests on, stated as a measurement: with the maximum buffer, a run
     * that stays inside the safe window carries exactly one name - at every zoom, and wherever it
     * happens to fall relative to the tile grid. The offsets matter: a run that is safe when it sits
     * in the middle of a tile must stay safe when it straddles a corner.
     *
     * The window has two edges and both were measured. Below it the run is shorter than the name and
     * the name is dropped without a trace; above roughly 1600px it reaches past a full tile of
     * overlap and is duplicated again. This pins the middle.
     */
    test("a bounded run carries exactly one name at every zoom and position", async ({ page }) => {
        for (const zoom of [3, 5, 8]) {
            for (const offset of [0, 137, 263]) {
                for (const length of [600, 1200]) {
                    const names = await namesFor(page, { length, zoom, buffer: 512, offsetX: offset });
                    expect(names, `zoom ${zoom}, offset ${offset}, length ${length}`).toBe(1);
                }
            }
        }
    });

    /**
     * Capping the zoom the source builds tiles for makes MapLibre overzoom one coarser tile, and a
     * coarser tile is cut in fewer places. It moves the problem rather than solving it: below the
     * cap the duplicates are back, and far above it the geometry is quantised so hard that the name
     * is dropped instead.
     */
    test("capping the source zoom moves the problem instead of solving it", async ({ page }) => {
        expect(await namesFor(page, { length: 2400, zoom: 8, maxzoom: 2 }), "above the cap").toBe(1);
        expect(await namesFor(page, { length: 2400, zoom: 2, maxzoom: 2 }), "at the cap").toBeGreaterThan(1);
        // One tile for the whole world survives every boundary and loses the name to precision.
        expect(await namesFor(page, { length: 900, zoom: 8, maxzoom: 0 }), "no tile left to cut").toBe(0);
    });

    /**
     * `symbol-placement: line` is not a control either. It repeats the name along the run at
     * `symbol-spacing`, and its anchors are additionally rejected outside the tile bounds
     * (`get_anchors.ts`, `resample`), so the count swings between none and several with no rule an
     * editor could hold on to. `line-center` has no such bounds check, which is why the design
     * builds on it.
     */
    test("line placement gives no count to rely on", async ({ page }) => {
        const counts = [
            await namesFor(page, { length: 500, zoom: 3, placement: "line" }),
            await namesFor(page, { length: 900, zoom: 3, placement: "line" }),
            await namesFor(page, { length: 2400, zoom: 3, placement: "line" }),
        ];
        expect(new Set(counts).size, `counts were ${counts.join(", ")}`).toBeGreaterThan(1);
    });
});
