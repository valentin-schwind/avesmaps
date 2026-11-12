import { expect, test } from "@playwright/test";
import { renderZoomForBand } from "@avesmaps3d/shared";
import { chooseSeries, GARETH, offeredSeries, openMap, selectedPlace, showPlace } from "./map-handle.ts";
import { wirksameSpanne } from "./zoombaender-wirksam.ts";

/**
 * Rendering slice check (chapter 11.8 browser test, evidence for ADR-0003).
 *
 * Verifies the whole chain in a real browser: PostGIS (SRID 0) -> derived render projection ->
 * Martin MVT -> MapLibre, and that a rendered feature maps back to its authoritative map
 * coordinate.
 *
 * Requires the tile server; without it the test fails loudly instead of passing silently
 * (chapter 11.155). Start it with: npm run tiles:dev
 */
const TILE_BASE = process.env["VITE_TILE_BASE"] ?? "http://127.0.0.1:3010";

test.beforeAll(async ({ request }) => {
    const response = await request.get(`${TILE_BASE}/place_render`);
    expect(response.ok(), `tile server not reachable at ${TILE_BASE} - start it with: npm run tiles:dev`).toBe(true);
});

test("renders the imported slice and maps features back to map coordinates", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error") {
            consoleErrors.push(message.text());
        }
    });
    // 🪤 Gezählt am Netz, nicht an `performance.getEntriesByType("resource")`: Dessen Puffer hält 250 Einträge,
    // und unter Vite ist jedes Modul einer. Mit WI-0052 lagen alle 250 vor der ersten Kachel.
    let tileRequests = 0;
    page.on("requestfinished", (request) => {
        if (request.url().includes("/tiles/")) {
            tileRequests += 1;
        }
    });

    await page.goto("/");

    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });

    // Drive the camera with the app's own projection: if that is wrong, nothing will be found.
    // So nah, dass nach ihrer gültigen Spanne auch die Dörfer stehen (WI-0221, verstellbar in der Systemsteuerung), mindestens Zoom 6.
    // Gezählt wird erst nach `idle`: Vorher steht die gröbere Kachel da, in der nur die großen Orte liegen (gemessen: Gareth allein).
    const dorf = await wirksameSpanne(page.request, "orte.dorf.zeichen");
    await page.evaluate(
        async ({ target, zoom }) => {
            const projection = globalThis.avesmapsRenderProjection;
            const map = globalThis.avesmapsMap;
            if (!projection || !map) {
                throw new Error("map or projection handle missing");
            }
            map.jumpTo({ center: projection.toRenderLngLat(target), zoom });
            await new Promise<void>((resolve) => map.once("idle", resolve));
        },
        { target: GARETH, zoom: Math.max(6, renderZoomForBand(dorf.von)) },
    );

    const found = await page.waitForFunction(
        (name) => {
            const features = globalThis.avesmapsMap?.queryRenderedFeatures({ layers: ["place-marker"] }) ?? [];
            const match = features.find((feature) => feature.properties["name"] === name);
            if (!match) {
                return false;
            }
            const point = globalThis.avesmapsRenderProjection?.fromRenderLngLat({
                lng: match.geometry.coordinates[0],
                lat: match.geometry.coordinates[1],
            });
            return {
                subtype: String(match.properties["subtype"]),
                x: point?.x ?? NaN,
                y: point?.y ?? NaN,
                total: features.length,
            };
        },
        "Gareth",
        { timeout: 30_000 },
    );

    const gareth = (await found.jsonValue()) as { subtype: string; x: number; y: number; total: number };

    expect(gareth.subtype).toBe("metropole");
    expect(gareth.total).toBeGreaterThan(10);
    // The round trip through the derived render projection must return the authoritative
    // coordinate. MVT quantises to the tile grid, so a tile-pixel tolerance applies.
    expect(gareth.x).toBeCloseTo(GARETH.x, 1);
    expect(gareth.y).toBeCloseTo(GARETH.y, 1);

    // The base map must come from our own tile route, on the same grid as the vector tiles.
    expect(tileRequests, "the base map raster tiles must load").toBeGreaterThan(0);

    expect(consoleErrors, "the map must load without console errors").toEqual([]);
});

/**
 * Every series in the catalog must actually be deliverable: the server allowlist, the tile
 * directory on disk and the style switch in the app have to agree. A series that is listed but
 * serves nothing would otherwise only show up as an empty map.
 */
test("serves every catalogued map series and switches between them", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error") {
            consoleErrors.push(message.text());
        }
    });

    await page.goto("/");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });

    const offered = await offeredSeries(page);
    expect(offered.length).toBeGreaterThan(1);

    // One tile per series, straight from the route: this is about delivery, not about rendering,
    // and it must not depend on what the browser happens to have cached. The way to the tile is the
    // map's own: the pointer names the revision, the revision names the tiles (ADR-0008).
    for (const id of offered) {
        const pointerResponse = await page.request.get(`/tiles/raster/${id}/current.json`);
        expect(pointerResponse.status(), `series ${id} must have a raster pointer`).toBe(200);
        expect(pointerResponse.headers()["cache-control"], "the pointer is asked for every time").toBe("no-cache");
        const pointer = (await pointerResponse.json()) as { revision: string; format: string };

        const response = await page.request.get(`/tiles/raster/${id}/${pointer.revision}/2/2/1.${pointer.format}`);
        expect(response.status(), `series ${id} must serve raster tiles`).toBe(200);
        expect(response.headers()["cache-control"], "a revision never changes").toBe(
            "public, max-age=31536000, immutable",
        );
        // Read the body, not a header: the dev proxy does not have to announce a length.
        const body = await response.body();
        expect(body.length, `tile of series ${id} must not be empty`).toBeGreaterThan(0);
        expect(
            `${body.subarray(0, 4).toString("ascii")}/${body.subarray(8, 12).toString("ascii")}`,
            `tile of series ${id} must be a WebP`,
        ).toBe("RIFF/WEBP");
    }

    // And the switch itself has to reach a different series in the running map.
    // Die Adresse nennt die gezeigte Serie (series=…), der Fächer bietet die anderen an.
    const current = new URLSearchParams((await page.evaluate(() => globalThis.location.hash)).slice(1)).get("series");
    const other = offered.find((id) => id !== current);
    expect(other, "the catalog must offer a second series").toBeDefined();

    const tile = page.waitForResponse(
        // 🪤 A TILE of the other series, not its pointer: current.json answers 200 first.
        (response) =>
            response.url().includes(`/tiles/raster/${other}/`) &&
            response.url().endsWith(".webp") &&
            response.status() === 200,
        { timeout: 30_000 },
    );
    await chooseSeries(page, other as string);
    await tile;
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });

    expect(consoleErrors, "switching series must not produce console errors").toEqual([]);
});

/**
 * The licence of the Ulisses map package permits the material only while its URI accompanies every
 * distribution and the result is marked as a fan project. That makes the licence notes a condition of
 * showing the map at all, not a piece of decoration someone may tidy away - so it is tested.
 *
 * 🔴 Seit WI-0033 ohne Lizenzleiste auf der Karte (Betreiber 2026-09-24: „können wir die
 * lizenzleiste insgesamt deaktivieren?“). Die Adresse und die Kennzeichnung stehen unter „Hinweise“,
 * wie in Legacy - und genau dort prüft dieser Test sie.
 */
test("shows the licence notes, without a licence bar on the map", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });

    await expect(page.locator(".maplibregl-ctrl-attrib")).toHaveCount(0);

    await page.getByTestId("notes-open").click();
    const notes = page.getByTestId("notes");
    await expect(notes).toBeVisible();
    // The official disclaimer required by the fan guidelines.
    await notes.getByTestId("notes-copyright").locator("summary").click();
    await expect(notes.getByTestId("notes-copyright")).toContainText("DAS SCHWARZE AUGE");
    await notes.getByTestId("notes-maps").locator("summary").click();
    await expect(notes.getByTestId("notes-maps").locator("a[href*='Kartenpaket/Lizenz']").first()).toBeVisible();

    await page.getByTestId("notes").getByTestId("fenster-schliessen").click();
    await expect(notes).not.toBeVisible();
});

/**
 * Marker size at fractional zoom (operator decision 2026-09-20).
 *
 * The band table stays the cartographic definition, but MapLibre zooms continuously, so the size
 * has to travel between two band values instead of jumping at the boundary. Measured through the
 * renderer's own hit test: queryRenderedFeatures answers against the circle as drawn, so the
 * largest offset that still hits the marker is its rendered radius - no pixel reading, no guess
 * about what the style compiled to.
 */
test("scales markers continuously between the bands and keeps the band values", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });

    const measure = async (zoom: number): Promise<number> =>
        page.evaluate(async (targetZoom) => {
            const map = globalThis.avesmapsMap;
            const projection = globalThis.avesmapsRenderProjection;
            if (!map || !projection) {
                throw new Error("map handle missing");
            }
            map.jumpTo({ center: projection.toRenderLngLat({ x: 551.625, y: 532.969 }), zoom: targetZoom });
            await new Promise<void>((resolve) => map.once("idle", resolve));
            // Ein Frame über `idle` hinaus (settleFrame in map-handle.ts).
            await new Promise<void>((resolve) => {
                map.once("idle", resolve);
                map.triggerRepaint();
            });

            // Gareth steht in der Mitte der Karte (der Sprung oben; seit WI-0218 die Bildmitte, auch bei offenem Planer).
            const { x: cx, y: cy } = map.project(map.getCenter());
            // 🪤 Nur Gareths eigener Marker zählt. Seit Satz map154313 liegen rechts daneben weitere Orte,
            // und die Suche landete auf einem fremden Marker (106,8 px statt rund 23).
            const hits = (offset: number): boolean =>
                map
                    .queryRenderedFeatures([cx + offset, cy], { layers: ["place-marker"] })
                    .some((feature) => feature.properties["name"] === "Gareth");

            // Binary search on the offset: the last one that still hits is the drawn radius.
            let low = 0;
            let high = 200;
            for (let step = 0; step < 24; step += 1) {
                const middle = (low + high) / 2;
                if (hits(middle)) {
                    low = middle;
                } else {
                    high = middle;
                }
            }
            return low;
        }, zoom);

    // 🪤 Bänder, nicht MapLibre-Stufen: Avesmaps3D z = Legacy-Band + 1 (WI-0015). Hier stand
    // measure(5) für Band 5 — seit dem Zoomversatz maß der Test Band 4 und war rot.
    const atFive = await measure(renderZoomForBand(5));
    const atHalf = await measure(renderZoomForBand(5.5));
    const atSix = await measure(renderZoomForBand(6));

    // 💣 Der Bandwert IST der Außendurchmesser, Kontur eingeschlossen (Legacy teilt ihn in Kern und
    // Kontur). Hier stand „halber Durchmesser PLUS Kontur" — der Test hatte die um ein Drittel zu
    // großen Marker als Sollwert festgeschrieben.
    const drawnRadius = (diameter: number): number => diameter / 2;
    expect(atFive).toBeCloseTo(drawnRadius(37.62), 0);
    expect(atSix).toBeCloseTo(drawnRadius(53.2), 0);

    // The point of the whole change: halfway between the bands the marker is halfway grown.
    expect(atHalf).toBeGreaterThan(atFive + 1);
    expect(atHalf).toBeLessThan(atSix - 1);
    expect(atHalf).toBeCloseTo((drawnRadius(37.62) + drawnRadius(53.2)) / 2, 0);
});

/**
 * Visibility stays a band decision even though the size interpolates: a class appears at its own
 * band, not gradually during the band below it.
 */
test("lets a class appear exactly at its band, not before", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });

    const subtypesAt = async (zoom: number): Promise<string[]> =>
        page.evaluate(async (targetZoom) => {
            const map = globalThis.avesmapsMap;
            const projection = globalThis.avesmapsRenderProjection;
            if (!map || !projection) {
                throw new Error("map handle missing");
            }
            map.jumpTo({ center: projection.toRenderLngLat({ x: 551.625, y: 532.969 }), zoom: targetZoom });
            await new Promise<void>((resolve) => map.once("idle", resolve));
            // Ein Frame über `idle` hinaus (settleFrame in map-handle.ts).
            await new Promise<void>((resolve) => {
                map.once("idle", resolve);
                map.triggerRepaint();
            });
            const features = map.queryRenderedFeatures({ layers: ["place-marker"] });
            return [...new Set(features.map((feature) => String(feature.properties["subtype"])))];
        }, zoom);

    // Das Band des Dorfs ist seine gültige Spanne (WI-0221: Legacys gespeicherter Stand, verstellbar in der Systemsteuerung), keine
    // feste Zahl. Im halben Band davor darf es gar nicht auf der Karte stehen - entschiede die Größe allein, wüchse es hier schon.
    const dorf = await wirksameSpanne(page.request, "orte.dorf.zeichen");
    if (dorf.von > 0) expect(await subtypesAt(renderZoomForBand(dorf.von - 0.5))).not.toContain("dorf");
    expect(await subtypesAt(renderZoomForBand(dorf.von))).toContain("dorf");
});

/**
 * Aventuria exists once (chapter 5.1). Web Mercator is the projection of a globe and repeats east
 * and west, which would put a second Aventuria next to the first one and let the camera wander
 * into it.
 */
test("shows the domain once and keeps the camera inside it", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error") {
            consoleErrors.push(message.text());
        }
    });

    await page.goto("/");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });

    const result = await page.evaluate(async () => {
        const map = globalThis.avesmapsMap;
        if (!map) {
            throw new Error("map handle missing");
        }
        map.jumpTo({ center: { lng: 0, lat: 0 }, zoom: 2 });
        await new Promise<void>((resolve) => map.once("idle", resolve));
        const copies = map.getRenderWorldCopies();

        // Ask for a centre two worlds to the east; the camera must refuse to go there.
        map.jumpTo({ center: { lng: 540, lat: 0 }, zoom: 2 });
        await new Promise<void>((resolve) => map.once("idle", resolve));
        return { copies, center: map.getCenter() };
    });

    expect(result.copies, "world copies must be off").toBe(false);
    expect(Math.abs(result.center.lng), "the camera must stay inside the domain").toBeLessThanOrEqual(180);
    expect(consoleErrors).toEqual([]);
});

/**
 * Picking: clicking a marker has to identify the place and answer in map coordinates, not in the
 * render coordinates the click actually happened in.
 */
test("identifies a place when it is clicked", async ({ page }) => {
    await openMap(page);
    await showPlace(page, GARETH, 6);

    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (!box) {
        return;
    }

    // Gareth sits in the middle of the visible map - right of the open planner (WI-0039).
    const marker = await page.evaluate(() => globalThis.avesmapsVisibleArea!.centre());
    await page.mouse.click(box.x + marker.x, box.y + marker.y);

    await expect.poll(async () => (await selectedPlace(page))?.name).toBe("Gareth");
    const place = await selectedPlace(page);
    expect(place?.subtype).toBe("metropole");
    // The selection is in map coordinates; the rendering path never leaks into the interface.
    expect(place?.x).toBeCloseTo(GARETH.x, 2);
    expect(place?.y).toBeCloseTo(GARETH.y, 2);
    // Und die Marke steht gold (Legacy, Betreiber 2026-09-24).
    const colour = await page.evaluate(() =>
        JSON.stringify(
            (
                globalThis.avesmapsMap as unknown as { getPaintProperty(layer: string, name: string): unknown }
            ).getPaintProperty("place-marker", "circle-color"),
        ),
    );
    expect(colour).toContain(place?.id ?? "-");
});
