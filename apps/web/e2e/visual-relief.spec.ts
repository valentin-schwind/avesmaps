import { expect, test, type Page } from "@playwright/test";
import { chooseView, openMap, showCamera } from "./map-handle.ts";

/** Domain hillshade: one height source, distinct landscape lighting, flat 2D. Requires derived DEM and GPU. */
test.use({ launchOptions: { args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] } });

/** Flachland mit Fluss (Großer Fluss, Albernia). */
const EBENE = { x: 392, y: 505 };
const RELIEF_TILE = /\/tiles\/terrain\/visual-relief\/[0-9a-f]{12}\//;

interface ReliefMap {
    getTerrain(): { source: string } | null;
    getLayer(id: string): { source?: string } | undefined;
    getLayoutProperty(layer: string, name: string): unknown;
    getPaintProperty(layer: string, name: string): unknown;
    getStyle(): { sources: Record<string, unknown> };
}

async function readShade(page: Page): Promise<{
    terrain: string | null;
    source: string | null;
    visibility: unknown;
    method: unknown;
    reliefSource: boolean;
}> {
    return page.evaluate(() => {
        const map = globalThis.avesmapsMap as unknown as ReliefMap;
        return {
            terrain: map.getTerrain()?.source ?? null,
            source: map.getLayer("gelaende-schatten")?.source ?? null,
            visibility: map.getLayoutProperty("gelaende-schatten", "visibility"),
            method: map.getPaintProperty("gelaende-schatten", "hillshade-method"),
            reliefSource: "gelaende-relief-dem" in map.getStyle().sources,
        };
    });
}

function countReliefTiles(page: Page): string[] {
    const tiles: string[] = [];
    page.on("request", (request) => {
        if (RELIEF_TILE.test(request.url())) tiles.push(request.url());
    });
    return tiles;
}

test.beforeEach(async ({ page, request }) => {
    const gelaende = await request.get("/tiles/terrain/dem/current.json");
    test.skip(gelaende.status() === 404, "kein Gelände abgeleitet: npm run derive:terrain");
    let ohneKarte = false;
    page.on("console", (meldung) => {
        ohneKarte ||= meldung.text().startsWith("Gelände aus: keine Grafikkarte");
    });
    await openMap(page);
    test.skip(ohneKarte, "der Testbrowser hat keine Grafikkarte; ohne bleibt die Karte flach");
});

test("🔴 Landschaften geneigt: Schattierung und Gelände lesen das Domain-DEM", async ({ page }) => {
    const tiles = countReliefTiles(page);
    await chooseView(page, "landscapes");
    await showCamera(page, { point: EBENE, zoom: 5.5, pitch: 45 });
    const shade = await readShade(page);
    expect(shade.terrain, "setTerrain liest nie das Relief").toBe("gelaende-dem");
    expect(shade.source).toBe("gelaende-schatten-dem");
    expect(shade.visibility).toBe("visible");
    expect(shade.method, "R3").toBe("multidirectional");
    expect(tiles).toEqual([]);
});

test("🔴 direkt in den Landschaften geöffnet: Domain-Schattierung ohne Konsolenfehler und ohne Anfrage an das alte Relief", async ({
    page,
}) => {
    // Regression WI-0054: Der Zeiger kam, während der erste Stil noch lud, und der Neubau warf sechsmal
    // „Laufzeitbild … nicht angemeldet: Style is not done loading“.
    const fehler: string[] = [];
    page.on("console", (meldung) => {
        if (meldung.type() === "error") fehler.push(meldung.text());
    });
    page.on("pageerror", (error) => fehler.push(error.message));
    // WI-0067 P5: Seit dem Domain-DEM fragt die Karte das alte Relief gar nicht mehr, auch nicht seinen Zeiger beim Start
    // (`RELIEF_TILE` oben zählt nur Kacheln, und erst nach dem Öffnen). Die Prüfung stand bis WI-0123 nur im Blatt
    // `domain-terrain-review.spec.ts`.
    const altesRelief: string[] = [];
    page.on("request", (request) => {
        if (request.url().includes("/terrain/visual-relief/")) altesRelief.push(request.url());
    });
    // Neu laden: `beforeEach` hat die Karte schon offen, ein bloßer Hashwechsel lädt sie nicht neu.
    await page.goto("about:blank");
    await page.goto(`/#x=${String(EBENE.x)}&y=${String(EBENE.y)}&z=5.5&series=original&view=landscapes&p=45`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, {
        timeout: 30_000,
    });
    await expect.poll(async () => (await readShade(page)).source, { timeout: 15_000 }).toBe("gelaende-schatten-dem");
    await page.evaluate(
        () =>
            new Promise<void>((resolve) => {
                globalThis.avesmapsMap?.once("idle", () => resolve());
                setTimeout(resolve, 5000);
            }),
    );
    expect(fehler).toEqual([]);
    expect(altesRelief).toEqual([]);
});

test("🔴 Landschaften flach (2D): keine Schattierung und keine einzige Reliefkachel", async ({ page }) => {
    const tiles = countReliefTiles(page);
    await chooseView(page, "landscapes");
    await showCamera(page, { point: EBENE, zoom: 5.5 });
    const shade = await readShade(page);
    expect(shade.terrain).toBeNull();
    expect(shade.visibility).toBe("none");
    expect(tiles).toEqual([]);
});

test("🔴 andere Ansichten geneigt: wie vor WI-0054, ohne Reliefquelle und ohne Reliefkachel", async ({ page }) => {
    const tiles = countReliefTiles(page);
    for (const view of ["standard", "none", "powerlines"]) {
        await chooseView(page, view);
        await showCamera(page, { point: EBENE, zoom: 5.5, pitch: 45 });
        const shade = await readShade(page);
        expect(shade.reliefSource, view).toBe(false);
        expect(shade.source, view).toBe("gelaende-schatten-dem");
        expect(shade.method, view).toBe("standard");
    }
    expect(tiles).toEqual([]);
});
