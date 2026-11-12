import { expect, test, type Page } from "@playwright/test";
import { openMap } from "./map-handle.ts";

/**
 * Spike, third part: the real stack. PostgreSQL 18 with PostGIS 3.6, Martin 1.16.1, MapLibre.
 *
 * The first two parts measured against a GeoJSON source in the browser, which shares the mechanism
 * but not the path. The operator held ADR-0007 on exactly that gap: Martin's own clipping had never
 * been measured. This measures it end to end - a type run stored in map coordinates, projected,
 * trimmed and cut into a vector tile by PostGIS, served by Martin, drawn by MapLibre.
 *
 * What the real stack showed, and the browser-only spike could not:
 *
 *   MapLibre elects the tile itself. `addSymbolAtAnchor` drops a symbol whose anchor falls outside
 *   its own tile extent, in its own words "to prevent double-drawing symbols"
 *   (`symbol_layout.ts`). The test is half-open, so of all the tiles that carry a run, exactly one
 *   holds its middle and exactly one draws the name.
 *
 * That turns the duplication on its head. It was never caused by buffers - it was caused by
 * *clipping*: a clipped run becomes several different lines, each with a different middle, each
 * inside its own tile. Ship the same geometry unclipped to every tile that touches it and they all
 * agree where the middle is, so MapLibre's rule elects one of them.
 *
 * Prerequisites, and the test says so instead of passing quietly without them: the fixture applied
 * (`node --env-file-if-exists=.env scripts/dev/spike-label-runs.mjs`) and Martin restarted
 * afterwards, because it reads its catalogue once at startup.
 *
 * 🔴 Not part of the default run (WI-0248 S1): this is the ADR-0007 measurement, not a regression case. The fixture is development
 * tooling that is deliberately no migration, so a delivered database has no `spike_run_*` sources. `playwright.config.ts` runs the
 * file only when it is NAMED: `npx playwright test e2e/curve-label-martin.spec.ts`.
 */

/** The chosen path: trimmed for the zoom, unclipped, delivered to every tile that touches it. */
const UNCLIPPED_SOURCE = "spike_run_shared";
/** The naive path, for comparison: whole run, Martin's default clipping. */
const CLIPPED_SOURCE = "spike_run_clipped";
const LAYER = "spike-run-label";

/**
 * The fixture runs, with the point their name is anchored at - the middle of the run, which is the
 * point `line-center` picks. `from` is the lowest zoom at which the run is long enough to carry its
 * name; below it the tile function leaves the run out on purpose (invariant I2).
 */
const RUNS = [
    { id: "short", label: "DRACHENSTEINE", anchor: { x: 300, y: 302 }, from: 6 },
    { id: "medium", label: "KOSCHBERGE", anchor: { x: 700, y: 308 }, from: 4 },
    { id: "long", label: "SCHWARZE SICHEL", anchor: { x: 500, y: 730 }, from: 2 },
    { id: "huge", label: "RASCHTULSWALL", anchor: { x: 512, y: 925 }, from: 1 },
    // Its middle sits exactly on the vertical tile boundary that every zoom shares.
    { id: "corner", label: "FINSTERKAMM", anchor: { x: 512, y: 537 }, from: 2 },
] as const;

const ZOOMS = [2, 4, 5, 6, 8] as const;

interface StackMap {
    getStyle(): { layers: { id: string }[] };
    getSource(id: string): unknown;
    addSource(id: string, source: unknown): void;
    removeLayer(id: string): void;
    removeSource(id: string): void;
    addLayer(layer: unknown): void;
    getLayer(id: string): unknown;
    setLayoutProperty(layer: string, property: string, value: unknown): void;
    setPaintProperty(layer: string, property: string, value: unknown): void;
    jumpTo(options: { center: { lng: number; lat: number }; zoom: number }): void;
    queryRenderedFeatures(options: { layers: string[] }): { properties: Record<string, unknown> }[];
    once(event: string, handler: () => void): void;
    triggerRepaint(): void;
}

/** Fails loudly when the fixture is missing, rather than reporting an empty map as a pass. */
async function requireFixture(source: string): Promise<void> {
    // Der Martin, den auch die Test-Vite anspricht (`vite.config.ts`): `MARTIN_PORT`, sonst der des Entwicklungsstapels.
    const response = await fetch(`http://127.0.0.1:${process.env["MARTIN_PORT"] ?? "3010"}/${source}`);
    if (!response.ok) {
        throw new Error(
            `Martin does not serve "${source}" (${response.status}). Apply the fixture with ` +
                "`node --env-file-if-exists=.env scripts/dev/spike-label-runs.mjs` and restart Martin.",
        );
    }
}

async function useSource(page: Page, source: string): Promise<void> {
    await page.evaluate(
        async ({ sourceId, layerId, sources }) => {
            const map = globalThis.avesmapsMap as unknown as StackMap;
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

            if (map.getLayer(layerId)) {
                map.removeLayer(layerId);
            }
            for (const previous of sources) {
                if (map.getSource(previous)) {
                    map.removeSource(previous);
                }
            }
            map.addSource(sourceId, {
                type: "vector",
                tiles: [`${globalThis.location.origin}/tiles/vector/${sourceId}/{z}/{x}/{y}`],
                minzoom: 0,
                maxzoom: 8,
            });
            map.addLayer({
                id: layerId,
                type: "symbol",
                source: sourceId,
                "source-layer": sourceId,
                layout: {
                    "text-field": ["get", "label"],
                    "text-font": ["Faculty Glyphic Regular"],
                    "text-size": 28,
                    "text-letter-spacing": 0.3,
                    "symbol-placement": "line-center",
                },
                paint: { "text-color": "#2b2117", "text-halo-color": "#f6f1e4", "text-halo-width": 1 },
            });
            await new Promise<void>((resolve) => map.once("idle", resolve));
        },
        { sourceId: source, layerId: LAYER, sources: [UNCLIPPED_SOURCE, CLIPPED_SOURCE] },
    );
}

/** Moves to a point, waits for the renderer, and counts the drawn names per run id. */
async function namesAt(page: Page, anchor: { x: number; y: number }, zoom: number): Promise<Record<string, number>> {
    return page.evaluate(
        async ({ target, level, layerId }) => {
            const map = globalThis.avesmapsMap as unknown as StackMap;
            const projection = globalThis.avesmapsRenderProjection;
            if (!projection) {
                throw new Error("render projection handle missing");
            }
            map.jumpTo({ center: projection.toRenderLngLat(target), zoom: level });
            await new Promise<void>((resolve) => map.once("idle", resolve));
            // Ein Frame über `idle` hinaus (settleFrame in map-handle.ts): gezählt werden die Namen, die
            // wirklich stehen, nicht die einer Kachel, die MapLibre noch zum Ausblenden festhält.
            await new Promise<void>((resolve) => {
                map.once("idle", resolve);
                map.triggerRepaint();
            });
            const counted: Record<string, number> = {};
            for (const feature of map.queryRenderedFeatures({ layers: [layerId] })) {
                const id = String(feature.properties["id"]);
                counted[id] = (counted[id] ?? 0) + 1;
            }
            return counted;
        },
        { target: anchor, level: zoom, layerId: LAYER },
    );
}

test.describe("a type run through PostGIS, Martin and MapLibre", () => {
    test.beforeEach(async ({ page }) => {
        await requireFixture(UNCLIPPED_SOURCE);
        await openMap(page);
    });

    /**
     * The acceptance criterion on the real path: one name per derived run, none missing, none
     * doubled, and the same answer at every zoom - including the runs that span dozens of tiles.
     *
     * A run below its band is expected to be absent. The tile function leaves it out on purpose
     * rather than shipping something the renderer would drop without a trace (invariant I2).
     */
    test("draws exactly one name per run, at every zoom", async ({ page }) => {
        await useSource(page, UNCLIPPED_SOURCE);

        for (const run of RUNS) {
            for (const zoom of ZOOMS) {
                const counted = await namesAt(page, run.anchor, zoom);
                const expected = zoom >= run.from ? 1 : 0;
                expect(counted[run.id] ?? 0, `${run.id} at zoom ${zoom}`).toBe(expected);
            }
        }
    });

    /**
     * The run whose middle lands exactly on a tile boundary, at every zoom that divides it. It earns
     * its own test because a half-open rule is only worth having if it holds precisely there: one
     * neighbour must take the name and the other must decline it.
     */
    test("keeps one name when the anchor lands on a tile boundary", async ({ page }) => {
        await useSource(page, UNCLIPPED_SOURCE);

        for (const zoom of [2, 3, 4, 5, 6, 7, 8]) {
            const counted = await namesAt(page, { x: 512, y: 537 }, zoom);
            expect(counted["corner"] ?? 0, `boundary anchor at zoom ${zoom}`).toBe(1);
        }
    });

    /**
     * The counter-measurement, so the fix is not credited to something else: the same fixture
     * through Martin's default clipping. The longest run is cut into 176 fragments at zoom 8, and
     * every fragment that reaches the viewport carries its own name.
     */
    test("Martin's default clipping draws the same run many times", async ({ page }) => {
        await useSource(page, CLIPPED_SOURCE);

        const counted = await namesAt(page, { x: 512, y: 925 }, 8);
        expect(counted["huge"] ?? 0, "the naive path repeats the name").toBeGreaterThan(1);
    });
});
