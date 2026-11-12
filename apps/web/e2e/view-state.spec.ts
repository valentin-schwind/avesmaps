import { expect, test } from "@playwright/test";
import { GARETH, openMap, showPlace } from "./map-handle.ts";

/**
 * The view in the address (integration gate 4.17.3).
 *
 * The point of this is a link someone can send: it has to reopen the same place, and it has to
 * carry map coordinates rather than the derived render coordinates, which belong to the current
 * rendering path and to nothing else (ADR-0003).
 */

test("puts the current view into the address in map coordinates", async ({ page }) => {
    await openMap(page);
    await showPlace(page, GARETH, 5.5);

    // moveend fires after the jump; give the listener its turn.
    await page.waitForFunction(() => globalThis.location.hash.includes("x="), undefined, { timeout: 10_000 });
    const hash = await page.evaluate(() => globalThis.location.hash);

    const parameters = new URLSearchParams(hash.slice(1));
    expect(Number(parameters.get("x"))).toBeCloseTo(GARETH.x, 2);
    expect(Number(parameters.get("y"))).toBeCloseTo(GARETH.y, 2);
    expect(Number(parameters.get("z"))).toBeCloseTo(5.5, 2);
    // Ohne Link startet die Karte mit der Serie „modern“ (Betreiber 2026-09-24).
    expect(parameters.get("series")).toBe("modern");
});

test("reopens the view a shared link describes", async ({ page }) => {
    await page.goto("/#x=551.625&y=532.969&z=6.00&series=modern");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });

    const view = await page.evaluate(() => {
        const map = globalThis.avesmapsMap;
        const projection = globalThis.avesmapsRenderProjection;
        if (!map || !projection) {
            throw new Error("map handle missing");
        }
        // Seit WI-0218 steht der Link in der Mitte der FREIEN Fläche (der Planer ist offen), nicht in der Bildmitte: gelesen wird, was dort liegt.
        const { x, y } = globalThis.avesmapsVisibleArea!.centre();
        return { center: projection.fromRenderLngLat(map.unproject([x, y])), zoom: map.getZoom() };
    });

    expect(view.center.x).toBeCloseTo(551.625, 2);
    expect(view.center.y).toBeCloseTo(532.969, 2);
    expect(view.zoom).toBeCloseTo(6, 2);
    // The link also chose the series, and the map fan shows it.
    await expect(page.getByTestId("fan-toggle")).toContainText("Modern");
});

test("falls back to the default view instead of opening nowhere", async ({ page }) => {
    // Outside the domain: a stale or hand-edited link must not drop the reader into empty space.
    await page.goto("/#x=99999&y=1&z=12&series=original");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });

    const inside = await page.evaluate(() => {
        const map = globalThis.avesmapsMap;
        const projection = globalThis.avesmapsRenderProjection;
        if (!map || !projection) {
            throw new Error("map handle missing");
        }
        const point = projection.fromRenderLngLat(map.getCenter());
        return point.x >= 0 && point.x <= 1024 && point.y >= 0 && point.y <= 1024;
    });
    expect(inside, "the camera must be inside the domain").toBe(true);
});

test("does not fill the back button while panning", async ({ page }) => {
    await openMap(page);
    const before = await page.evaluate(() => globalThis.history.length);

    for (const zoom of [4, 4.5, 5, 5.5]) {
        await showPlace(page, GARETH, zoom);
    }

    const after = await page.evaluate(() => globalThis.history.length);
    expect(after, "panning is not navigation").toBe(before);
});

test("🔴 ein Link trägt Drehung und Neigung und öffnet genau diesen Blick (WI-0016)", async ({ page }) => {
    await page.goto("/#x=551.625&y=532.969&z=5.50&series=original&b=-35.0&p=45.0");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    const opened = await page.evaluate(() => {
        const map = globalThis.avesmapsMap;
        if (!map) {
            throw new Error("map handle missing");
        }
        return { bearing: map.getBearing(), pitch: map.getPitch() };
    });
    expect(opened.bearing).toBeCloseTo(-35, 1);
    expect(opened.pitch).toBeCloseTo(45, 1);

    // Und umgekehrt: wer dreht und neigt, findet beides in der Adresse wieder.
    await page.evaluate(() => globalThis.avesmapsMap?.jumpTo({ bearing: 90, pitch: 30 }));
    await page.waitForFunction(() => globalThis.location.hash.includes("b=90.0"), undefined, { timeout: 10_000 });
    const parameters = new URLSearchParams((await page.evaluate(() => globalThis.location.hash)).slice(1));
    expect(parameters.get("b")).toBe("90.0");
    expect(parameters.get("p")).toBe("30.0");
});

test("🔴 ein Link mit zu starker Neigung für den Überblick öffnet in der Grenze (D3)", async ({ page }) => {
    await page.goto("/#x=512.000&y=512.000&z=3.00&series=original&p=60.0");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    const pitch = await page.evaluate(() => globalThis.avesmapsMap?.getPitch() ?? -1);
    expect(pitch).toBeLessThanOrEqual(30.001);
});
