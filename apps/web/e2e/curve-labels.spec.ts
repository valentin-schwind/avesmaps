import { expect, test, type Page } from "@playwright/test";
import { openMap } from "./map-handle.ts";

/**
 * Spike: what does MapLibre do with a landscape name set along a curve?
 *
 * Legacy draws landscape names along a curve it computes through the area, in a canvas overlay of
 * its own with eleven tuning values (finding MCS-008). MapLibre offers `symbol-placement: line`,
 * but whether that reaches the legacy look was never measured - and the answer decides what the
 * region model has to store. This file measures it rather than assuming it.
 *
 * The decisive detail is in MapLibre's own source: `getCenterAnchor` takes the arc-length middle of
 * the line and nothing else, and drops the label entirely when the angle check fails there
 * (`maplibre-gl/src/symbol/get_anchors.ts`). MapLibre places along a line; it never searches a line
 * for the calmest stretch, never lengthens it, and never shrinks the type to make it fit. So the
 * hypothesis under test is not "one curve per area" but:
 *
 *   store one finished type run per label - the stretch already chosen, already smoothed, and
 *   already long enough for the name at that zoom.
 *
 * Every run here is built in screen pixels and unprojected, so the numbers are the numbers a reader
 * sees rather than tile units.
 */

/** Same ink as the place labels, so the threshold below matches the existing measurement. */
const INK = "#2b2117";
const SPIKE_SOURCE = "spike-run";
const SPIKE_LAYER = "spike-curve-label";
/** A real reference area of the legacy design (spec section 4.1), and long enough to bend visibly. */
const NAME = "DRACHENSTEINE";
/** Font size in px for every measurement here; the band table is not what is under test. */
const SIZE = 28;

interface RunShape {
    /** Chord length in screen pixels. */
    length: number;
    /** Bulge of the arc at its middle, in screen pixels. 0 is a straight line. */
    sagitta: number;
}

interface LabelPaint {
    letterSpacing: number;
    /** Off by default, which is what a real style uses; on only to show the tile duplicate raw. */
    overlap?: boolean;
}

interface SpikeMap {
    getSource(id: string): unknown;
    addSource(id: string, source: unknown): void;
    removeLayer(id: string): void;
    removeSource(id: string): void;
    addLayer(layer: unknown): void;
    getLayer(id: string): unknown;
    setLayoutProperty(layer: string, property: string, value: unknown): void;
    setPaintProperty(layer: string, property: string, value: unknown): void;
    unproject(point: [number, number]): { lng: number; lat: number };
    queryRenderedFeatures(options: { layers: string[] }): unknown[];
    once(event: string, handler: () => void): void;
    getCanvas(): HTMLCanvasElement;
}

/**
 * The crop the ink is measured in: a band across the middle of the viewport, below the app's own
 * panel. Measuring the whole window once made two different runs report the identical bounding box,
 * because the dark pixels of that panel were the outermost ink in both shots - the label was never
 * what was being measured.
 */
const INK_CLIP = { x: 0, y: 260, width: 1280, height: 220 };

/**
 * Isolates the ink: no base map, no place layer, no halo. Then every dark pixel is a glyph.
 *
 * 💣 Seit dem Kartenfaecher (WI-0009) muss JEDER Layer weg, der Schrift zeichnet - nicht nur die
 * Ortsnamen. Die echten Landschaftsnamen standen vorher zufaellig nicht im Messfenster; mit einem
 * anderen Stilaufbau verschiebt sich ihre Kollisionslage, und dann zaehlt die Tintenmessung fremde
 * Buchstaben mit. Ein Test, der misst, was er nicht gezeichnet hat, misst nichts.
 *
 * 🪤 Jeder Zugriff ist geprueft: welche Layer es gibt, haengt seither an der Ansicht.
 */
async function isolate(page: Page): Promise<void> {
    await page.evaluate(() => {
        const map = globalThis.avesmapsMap as unknown as SpikeMap & {
            getStyle(): { layers: { id: string }[] };
        };
        // 🪤 ALLES aus, der Probelayer kommt erst danach. Hier stand eine Liste von Hand, und jede
        // neue Ebene lief an ihr vorbei — die Wegnamen mit schwarzem Saum (WI-0010), Haarlinie und
        // Goldring der Marker. Deren Tinte lag mit im Kasten, und ein gerader Name war plötzlich
        // „genauso hoch" wie ein gebogener (gemessen 2026-09-23: 220 gegen 330 erwartet).
        for (const { id } of map.getStyle().layers) {
            map.setLayoutProperty(id, "visibility", "none");
        }
    });
}

/**
 * Draws one run through the middle of the viewport and waits until the renderer is idle.
 *
 * The run is built in screen pixels and unprojected, so a sagitta of 60 really is a bulge of 60
 * pixels on the screen the assertions then measure.
 */
async function drawRun(page: Page, shape: RunShape, paint: LabelPaint): Promise<void> {
    await page.evaluate(
        async ({ shape: run, paint: style, name, ink, size, sourceId, layerId }) => {
            const map = globalThis.avesmapsMap as unknown as SpikeMap;
            const canvas = map.getCanvas();
            const centreX = canvas.clientWidth / 2;
            const centreY = canvas.clientHeight / 2;

            // The offset follows a sine, so the curvature is gentlest at the ends and strongest in
            // the middle - the shape a landscape name actually sits on.
            const points: [number, number][] = [];
            for (let index = 0; index <= 64; index++) {
                const t = index / 64;
                const x = centreX - run.length / 2 + t * run.length;
                const y = centreY - Math.sin(t * Math.PI) * run.sagitta;
                const { lng, lat } = map.unproject([x, y]);
                points.push([lng, lat]);
            }

            const overlap = style.overlap ?? false;
            if (map.getLayer(layerId)) {
                map.removeLayer(layerId);
            }
            if (map.getSource(sourceId)) {
                map.removeSource(sourceId);
            }
            map.addSource(sourceId, {
                type: "geojson",
                data: { type: "Feature", properties: { name }, geometry: { type: "LineString", coordinates: points } },
            });
            map.addLayer({
                id: layerId,
                type: "symbol",
                source: sourceId,
                layout: {
                    "text-field": ["get", "name"],
                    "text-font": ["Faculty Glyphic Regular"],
                    "text-size": size,
                    "text-letter-spacing": style.letterSpacing,
                    "symbol-placement": "line-center",
                    "text-allow-overlap": overlap,
                    "text-ignore-placement": overlap,
                },
                paint: { "text-color": ink, "text-halo-width": 0 },
            });

            await new Promise<void>((resolve) => map.once("idle", resolve));
        },
        { shape, paint, name: NAME, ink: INK, size: SIZE, sourceId: SPIKE_SOURCE, layerId: SPIKE_LAYER },
    );
}

interface InkBox {
    width: number;
    height: number;
    pixels: number;
}

/** Bounding box of the dark pixels inside {@link INK_CLIP}, in screen pixels. */
async function inkBox(page: Page): Promise<InkBox> {
    // 🪤 Gemessen wird nur die KARTE: die Bedienelemente darüber sind aus. Seit der Kartenfächer
    // Legacys Kachel trägt (WI-0024), ist der Eckbund höher und reicht mit dem Steuerring in diesen
    // Streifen - dessen Zeichen zählten sonst als „Tinte“.
    await page.addStyleTag({ content: ".corner, .route-planner { visibility: hidden !important; }" });
    const shot = await page.screenshot({ clip: INK_CLIP });
    return page.evaluate(
        async (dataUrl) => {
            const image = new Image();
            image.src = dataUrl;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext("2d");
            if (!context) {
                throw new Error("no 2d context");
            }
            context.drawImage(image, 0, 0);
            const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
            let left = Number.POSITIVE_INFINITY;
            let right = -1;
            let top = Number.POSITIVE_INFINITY;
            let bottom = -1;
            let pixels = 0;
            for (let index = 0; index < data.length; index += 4) {
                if ((data[index] ?? 255) < 90 && (data[index + 1] ?? 255) < 80 && (data[index + 2] ?? 255) < 70) {
                    const pixel = index / 4;
                    const x = pixel % canvas.width;
                    const y = Math.floor(pixel / canvas.width);
                    left = Math.min(left, x);
                    right = Math.max(right, x);
                    top = Math.min(top, y);
                    bottom = Math.max(bottom, y);
                    pixels += 1;
                }
            }
            return pixels === 0
                ? { width: 0, height: 0, pixels: 0 }
                : { width: right - left + 1, height: bottom - top + 1, pixels };
        },
        `data:image/png;base64,${shot.toString("base64")}`,
    );
}

async function namesOnMap(page: Page): Promise<number> {
    return page.evaluate(
        (layerId) =>
            (globalThis.avesmapsMap as unknown as SpikeMap).queryRenderedFeatures({ layers: [layerId] }).length,
        SPIKE_LAYER,
    );
}

/** Measures one run and refuses to report ink unless exactly one name is on the map. */
async function measureSingle(page: Page, shape: RunShape, paint: LabelPaint): Promise<InkBox> {
    await drawRun(page, shape, paint);
    expect(await namesOnMap(page), `a run of ${shape.length}px must carry exactly one name`).toBe(1);
    return inkBox(page);
}

test.describe("a landscape name on a curve", () => {
    test.beforeEach(async ({ page }) => {
        await openMap(page);
        await isolate(page);
    });

    /**
     * The base case: one area, one name. Everything else is built on this working, including the
     * distribution of two and three names as separate runs.
     */
    test("sets the name once on a run that fits it", async ({ page }) => {
        await drawRun(page, { length: 500, sagitta: 40 }, { letterSpacing: 0.3 });
        expect(await namesOnMap(page)).toBe(1);
    });

    /**
     * The first thing legacy guarantees and MapLibre does not: legacy accepts a single name without
     * any check and shrinks the type down to 8px rather than lose it. MapLibre has no auto-fit - a
     * run shorter than the name simply carries no name at all, with no warning.
     *
     * That makes the length of a stored run a correctness property, not a matter of taste.
     */
    test("drops the name when the run is shorter than the name", async ({ page }) => {
        await drawRun(page, { length: 300, sagitta: 0 }, { letterSpacing: 0.3 });
        expect(await namesOnMap(page)).toBe(0);
    });

    /**
     * The second thing, and the more dangerous one: a GeoJSON or vector source is tiled, and a run
     * that crosses a tile boundary is clipped into two pieces. Each piece then gets its own centre
     * anchor, so the name is printed twice. Collision hides it while the two copies overlap and
     * stops hiding it once the run is long enough that they do not.
     *
     * Legacy hit the same symptom from a different cause and the operator read it as "you added a
     * label". A stored run therefore has to be short enough to stay inside one tile, or the layer
     * has to be built so that tiling cannot split it.
     */
    test("prints the name twice when the run crosses a tile boundary", async ({ page }) => {
        await drawRun(page, { length: 1100, sagitta: 0 }, { letterSpacing: 0.3 });
        expect(await namesOnMap(page), "the long run carries the name twice").toBeGreaterThan(1);
    });

    /**
     * Do the glyphs follow the curve, or does MapLibre only set a straight name at a point on the
     * line? A bent name is taller than a straight one - that is the whole difference, and it is
     * measurable in ink.
     */
    test("bends the name along the run instead of setting it straight", async ({ page }) => {
        const straight = await measureSingle(page, { length: 500, sagitta: 0 }, { letterSpacing: 0.3 });
        const bent = await measureSingle(page, { length: 500, sagitta: 60 }, { letterSpacing: 0.3 });

        expect(straight.pixels, "the straight name must be drawn at all").toBeGreaterThan(200);
        // A straight name is one line of type; a bent one spans the bulge as well.
        expect(bent.height).toBeGreaterThan(straight.height * 1.5);
    });

    /**
     * The tracking is the signature of a landscape name. Legacy computes it from the space left in
     * the window; MapLibre's `text-letter-spacing` is a static value in ems. This measures that the
     * static one at least reaches the same widths, so the look can come from a style property
     * instead of a per-glyph layer of our own.
     */
    test("widens the name by the tracking it is given", async ({ page }) => {
        const tight = await measureSingle(page, { length: 600, sagitta: 0 }, { letterSpacing: 0 });
        const tracked = await measureSingle(page, { length: 600, sagitta: 0 }, { letterSpacing: 0.3 });

        // Tracking is specified in ems and applies after every glyph: one gap per glyph.
        const expected = NAME.length * 0.3 * SIZE;
        expect(tracked.width - tight.width).toBeGreaterThan(expected * 0.6);
        expect(tracked.width - tight.width).toBeLessThan(expected * 1.4);
    });

    /**
     * The legacy measurement says the name occupies a constant 133.9px whatever the curve is long,
     * because the window is sized to the name and not to the area. MapLibre behaves the same way,
     * and confirming it matters: it means a stored run only has to be long enough, never exactly
     * right - and that the name does not span the area, which is an open operator question.
     */
    test("sizes the name from the type, not from the length of the run", async ({ page }) => {
        const short = await measureSingle(page, { length: 500, sagitta: 0 }, { letterSpacing: 0.3 });
        const long = await measureSingle(page, { length: 600, sagitta: 0 }, { letterSpacing: 0.3 });

        expect(short.pixels).toBeGreaterThan(200);
        // Same type, same tracking, a fifth more run: the drawn name must not grow with it.
        expect(Math.abs(long.width - short.width)).toBeLessThan(6);
    });

    /**
     * Legacy calms its curve before it sets type on it. MapLibre has one blunt rule instead -
     * `text-max-angle`, 45 degrees by default - and it does not soften the curve, it drops the name.
     * A stored run has to stay on the safe side of that edge, which is the third thing the run has
     * to be responsible for besides its position and its length.
     */
    test("drops the name when the run bends too sharply", async ({ page }) => {
        await drawRun(page, { length: 500, sagitta: 30 }, { letterSpacing: 0.3 });
        expect(await namesOnMap(page), "a gentle bend must still carry the name").toBe(1);

        await drawRun(page, { length: 220, sagitta: 260 }, { letterSpacing: 0.3 });
        expect(await namesOnMap(page), "a hairpin must not be typeset").toBe(0);
    });
});
