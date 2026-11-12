import { expect, test, type Page } from "@playwright/test";
import type { MapBounds, SearchHit } from "@avesmaps3d/shared";
import { GARETH, readCamera, showCamera } from "./map-handle.ts";

/**
 * Suche und Planer rahmen Wege und Landschaften ein (WI-0044, Betreiber 2026-09-26: „ja - und ihn auch
 * markieren - (wie legacy, achte auf die farbe)“): Der ganze Weg oder die ganze Landschaft steht in der
 * sichtbaren Fläche, der Weg leuchtet golden, und Escape hebt die Auswahl auf.
 */

const PATH_LAYER = "area-selection-path";
const AREA_LAYER = "area-selection-fill";

async function openApp(page: Page, path = "/"): Promise<void> {
    await page.goto(path);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(page.getByTestId("route-planner-tab")).toHaveAttribute("aria-expanded", "true");
}

async function settled(page: Page): Promise<void> {
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 10_000 });
}

/** Die Treffer der Suche, wie der Server sie liefert - samt Ausschnitt. */
async function hits(page: Page, query: string): Promise<SearchHit[]> {
    return page.evaluate(async (q) => {
        const response = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        return ((await response.json()) as { hits: SearchHit[] }).hits;
    }, query);
}

/** Liegt der Ausschnitt ganz in der sichtbaren Fläche (rechts vom Planer)? Mit einem Pixel Spiel. */
async function framed(page: Page, bounds: MapBounds): Promise<boolean> {
    return page.evaluate(([minX, minY, maxX, maxY]) => {
        const map = globalThis.avesmapsMap as unknown as {
            project(lngLat: { lng: number; lat: number }): { x: number; y: number };
            getCanvas(): HTMLCanvasElement;
        };
        const projection = globalThis.avesmapsRenderProjection!;
        const canvas = map.getCanvas();
        const { top, right, bottom, left } = globalThis.avesmapsVisibleArea!.insets();
        const corners = [
            { x: minX, y: minY },
            { x: maxX, y: maxY },
            { x: minX, y: maxY },
            { x: maxX, y: minY },
        ].map((corner) => map.project(projection.toRenderLngLat(corner)));
        return corners.every(
            (at) =>
                at.x >= left - 1 &&
                at.x <= canvas.clientWidth - right + 1 &&
                at.y >= top - 1 &&
                at.y <= canvas.clientHeight - bottom + 1,
        );
    }, bounds);
}

async function choose(page: Page, query: string, type: string): Promise<void> {
    await page.getByTestId("search-open").click();
    await page.getByTestId("search-input").fill(query);
    const row = page.getByTestId("search-hit").filter({ hasText: query }).filter({ hasText: type }).first();
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.getByTestId("search")).toBeHidden();
}

const drawn = (page: Page, layer: string): Promise<number> =>
    page.evaluate((id) => {
        const map = globalThis.avesmapsMap as unknown as {
            getLayer(id: string): unknown;
            queryRenderedFeatures(options: { layers: string[] }): unknown[];
        };
        return map.getLayer(id) ? map.queryRenderedFeatures({ layers: [id] }).length : -1;
    }, layer);

test("🔴 ein Weg zeigt sich ganz, auch weit heraus, und leuchtet golden - Escape hebt es auf", async ({ page }) => {
    await openApp(page);
    await showCamera(page, { point: GARETH, zoom: 7 });
    const [fluss] = (await hits(page, "Der Große Fluss")).filter((hit) => hit.kind === "weg");
    expect(fluss?.bounds, "der Weg trägt seinen Ausschnitt").toBeDefined();
    await choose(page, "Der Große Fluss", "Flussweg");
    await settled(page);
    expect(await framed(page, fluss!.bounds!), "der ganze Fluss steht in der freien Fläche").toBe(true);
    expect((await readCamera(page)).zoom, "dafür weit heraus").toBeLessThan(6);
    await expect.poll(() => drawn(page, PATH_LAYER), { message: "der Weg leuchtet" }).toBeGreaterThan(0);

    await page.keyboard.press("Escape");
    await expect.poll(() => drawn(page, PATH_LAYER), { message: "Escape hebt die Markierung auf" }).toBe(-1);
});

test("🔴 ein kurzer Weg holt nur bis zum Deckel heran (Legacy maxZoom 5, bei uns 6)", async ({ page }) => {
    await openApp(page);
    await showCamera(page, { point: { x: 250, y: 450 }, zoom: 3 });
    await choose(page, "Holzpfad", "Pfad");
    await settled(page);
    expect((await readCamera(page)).zoom).toBeCloseTo(6, 1);
});

test("🔴 eine Landschaft aus der Suche zeigt ihre ganze Region und leuchtet", async ({ page }) => {
    // Unter Last großzügig: Die Landschaftskachel der Übersicht ist groß (Weiden landet mit offenem Infopanel bei Zoom 2,4, dort
    // 2026-10-19 rund 1 MB je Kachel `region_area_render`); der Leistungsbefund liegt bei WI-0235.
    test.slow();
    await openApp(page);
    await showCamera(page, { point: { x: 250, y: 450 }, zoom: 7 });
    const [weiden] = (await hits(page, "Weiden")).filter((hit) => hit.kind === "landschaft" && hit.name === "Weiden");
    expect(weiden?.bounds).toBeDefined();
    // Die Zeile nennt die Art der Landschaft, bei Weiden „Region“ (WI-0047).
    await choose(page, "Weiden", "Region");
    await settled(page);
    expect(await framed(page, weiden!.bounds!)).toBe(true);
    // Erst wenn die Quelle der Landschaften geladen ist, kann die Auswahl leuchten: Vorher zeigte der Fall unter Last null
    // Landschaftsfeatures, obwohl Auswahl und Filter stimmten (Gegenprobe der Kamera-Sitzung 2026-10-19).
    await page.waitForFunction(
        () => {
            const map = globalThis.avesmapsMap as unknown as
                { getSource(id: string): unknown; isSourceLoaded(id: string): boolean } | undefined;
            return map?.getSource("landscapes") !== undefined && map.isSourceLoaded("landscapes");
        },
        undefined,
        { timeout: 90_000 },
    );
    await expect.poll(() => drawn(page, AREA_LAYER), { timeout: 30_000 }).toBeGreaterThan(0);
});

test("🔴 ein Landschaftsname im Planer rahmt seine Region genauso ein", async ({ page }) => {
    await openApp(page, "/?route=Gareth~Perricum");
    // Die Box ist zugeklappt (WI-0065); ihre Knöpfe stehen erst offen im Barrierefreiheitsbaum.
    await page.getByTestId("areas-toggle").press("Enter");
    const link = page.getByTestId("route-landscapes").getByRole("button").first();
    await expect(link).toBeVisible({ timeout: 15_000 });
    await settled(page);
    await showCamera(page, { point: { x: 250, y: 450 }, zoom: 7 });
    const name = (await link.textContent())?.trim() ?? "";
    await link.click();
    await settled(page);
    const region = await page.evaluate(
        () =>
            (
                globalThis as unknown as { avesmapsAreaSelection?: () => { id: string } | undefined }
            ).avesmapsAreaSelection?.()?.id,
    );
    const [hit] = (await hits(page, name)).filter((entry) => entry.region === region);
    expect(hit?.bounds, `„${name}“ hat einen Ausschnitt`).toBeDefined();
    expect(await framed(page, hit!.bounds!)).toBe(true);
});
