import { expect, test, type Page } from "@playwright/test";
import { EDITOR_MODE, GARETH, openMap, showPlace } from "./map-handle.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Zoomstufe 8 und die Zoomanzeige im Editor (WI-0129 R2; Betreiber 2026-10-10: E1 A Überzoom, E2 A Stufe 8 zeigt Stufe 7, E3 A
 * Anzeige unter dem Steuerring mit „ZOOM“).
 *
 * Problemfälle: die Karte endet weiter bei Stufe 7; Stufe 8 lädt Kacheln, die es nicht gibt; die Landschaftsnamen verschwinden auf
 * Stufe 8 (Discovery §2); die Anzeige zeigt den MapLibre-Zoom statt der Stufe; Besucher sehen sie; die Leiste schreibt „1 Meilen“;
 * Stufe 8 gibt es nur genau am Anschlag und fällt nach der Gelände-Nachrechnung auf 7 zurück (Betreiber 2026-10-10, „8,5 zulassen“).
 */

const EDITOR = ["view_flow_directions", "use_editor_menu", "view_editor_series"];

async function zoomTo(page: Page, zoom: number): Promise<void> {
    await page.evaluate(async (level) => {
        const map = globalThis.avesmapsMap;
        if (!map) throw new Error("map handle missing");
        map.jumpTo({ zoom: level });
        await new Promise<void>((resolve) => map.once("idle", resolve));
    }, zoom);
}

test("🔴 Editor: die Karte reicht bis Stufe 8,5 (MapLibre 9,5), die Anzeige zeigt die Stufe, nicht den MapLibre-Zoom", async ({
    page,
}) => {
    await stubAdmin(page, { capabilities: EDITOR, role: "editor" });
    await openMap(page, EDITOR_MODE);
    expect(
        await page.evaluate(() =>
            (globalThis.avesmapsMap as unknown as { getMaxZoom(): number } | undefined)?.getMaxZoom(),
        ),
    ).toBe(9.5);
    const zahl = page.getByTestId("zoomstufe-zahl");
    await expect(page.getByTestId("zoomstufe")).toBeVisible();
    await expect(page.getByTestId("zoomstufe")).toContainText(/zoom/i);

    await zoomTo(page, 6.4);
    await expect(zahl).toHaveText("5");
    await zoomTo(page, 8.99);
    await expect(zahl).toHaveText("7");
    await zoomTo(page, 9);
    await expect(zahl).toHaveText("8");
    // Bis 8,5 geht es weiter, die Stufe bleibt 8: Stufe 8 ist die höchste, darüber wird nur vergrößert.
    await zoomTo(page, 9.6);
    expect(await page.evaluate(() => globalThis.avesmapsMap?.getZoom())).toBe(9.5);
    await expect(zahl).toHaveText("8");
    // Ganz herangezoomt rechnet das Gelände den Zoom ein Stück zurück: Das bleibt Stufe 8 (vorher fiel 8,97 auf 7).
    await zoomTo(page, 9.2);
    await expect(zahl).toHaveText("8");

    // Sie hängt unter dem Steuerring, mittig.
    const ring = await page.getByTestId("camera-ring").boundingBox();
    const anzeige = await page.getByTestId("zoomstufe").boundingBox();
    expect(ring && anzeige).toBeTruthy();
    expect(anzeige!.y).toBeGreaterThan(ring!.y + ring!.height);
    expect(Math.abs(anzeige!.x + anzeige!.width / 2 - (ring!.x + ring!.width / 2))).toBeLessThan(2);
});

test("🔴 Besucher sehen keine Zoomanzeige, auch nicht mit ?besucher im Editor", async ({ page }) => {
    await openMap(page);
    await expect(page.getByTestId("camera-ring")).toBeVisible();
    await expect(page.getByTestId("zoomstufe")).toHaveCount(0);
    await stubAdmin(page, { capabilities: EDITOR, role: "editor" });
    await openMap(page, `${EDITOR_MODE}?besucher`);
    await expect(page.getByTestId("zoomstufe")).toHaveCount(0);
});

test("Stufe 8 lädt bis 8,5 keine neuen Kacheln (Überzoom), Landschaftsnamen stehen weiter, die Leiste sagt „1 Meile“", async ({
    page,
}) => {
    const hoechste = new Map<string, number>();
    page.on("request", (request) => {
        const match = /\/tiles\/(vector|raster|terrain)\/.*?\/(\d+)\/\d+\/\d+/.exec(request.url());
        if (match?.[1] && match[2]) hoechste.set(match[1], Math.max(hoechste.get(match[1]) ?? 0, Number(match[2])));
    });
    await openMap(page);
    await showPlace(page, GARETH, 9);
    await expect(page.getByTestId("scale-bar")).toContainText(/^\s*1 Meile\s*$/);
    const anker = await page.evaluate(
        () =>
            (
                globalThis.avesmapsMap?.queryRenderedFeatures({
                    layers: globalThis.avesmapsMap
                        .getStyle()
                        .layers.map((l) => l.id)
                        .filter((id) => id.startsWith("map-label-")),
                })[0]?.geometry as { coordinates: [number, number] } | undefined
            )?.coordinates,
    );
    expect(anker, "Legacys Obergrenze 7 steht seit R1 als 8 in der Datenbank").toBeTruthy();
    // Bis zum Anschlag 9,5 bleibt der Name stehen (die höchste Stufe heißt „bis ganz nah“). Dafür auf ihn selbst zoomen: Bei
    // Gareth steht er schon bei 9 in der Bildecke.
    await page.evaluate(async (center) => {
        const map = globalThis.avesmapsMap;
        if (!map || !center) throw new Error("map handle missing");
        map.jumpTo({ center: { lng: center[0], lat: center[1] }, zoom: 9.5 });
        await new Promise<void>((resolve) => map.once("idle", resolve));
    }, anker);
    const landschaftsnamen = await page.evaluate(
        () =>
            globalThis.avesmapsMap?.queryRenderedFeatures({
                layers: globalThis.avesmapsMap
                    .getStyle()
                    .layers.map((l) => l.id)
                    .filter((id) => id.startsWith("map-label-")),
            }).length ?? 0,
    );
    expect(landschaftsnamen, "auch über MapLibre 9, bis 9,5").toBeGreaterThan(0);
    expect(hoechste.get("vector") ?? 0).toBeLessThanOrEqual(8);
    expect(hoechste.get("raster") ?? 0).toBeLessThanOrEqual(6);
    expect(hoechste.get("terrain") ?? 0).toBeLessThanOrEqual(4);
});

test("ein geteilter Link mit z=9 öffnet Stufe 8; mehr als 9,5 wird auf 9,5 geklemmt", async ({ page }) => {
    await openMap(page, "/#x=551.625&y=532.969&z=9&series=modern&view=standard&layer=alle");
    expect(await page.evaluate(() => globalThis.avesmapsMap?.getZoom())).toBe(9);
    await openMap(page, "/#x=551.625&y=532.969&z=9.8&series=modern&view=standard&layer=alle");
    await page.reload();
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true);
    expect(await page.evaluate(() => globalThis.avesmapsMap?.getZoom())).toBe(9.5);
});
