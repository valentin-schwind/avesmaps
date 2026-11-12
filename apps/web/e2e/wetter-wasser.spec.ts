import { expect, test, type Page } from "@playwright/test";
import { openMap, settleFrame } from "./map-handle.ts";

/**
 * Das Wasser in 3D (WI-0288 Stufe 5), mit echter Grafikkarte (ANGLE über D3D11; ohne sie zeichnet der Browser auf der CPU, das Gelände
 * bleibt flach und das Wasser käme nie). Nur in PC-Größe. 🔴 Kein Test schreibt in eine Datenbank: Jede schreibende Anfrage an `/api`
 * endet im Browser.
 *
 * Problemfälle: Flach lädt das Wasser oder die Engine, obwohl kein Wetterschalter an ist; geneigt bleibt das Wasser aus oder steht still;
 * angehalten flimmert es weiter; zurück in 2D bleibt die Ebene liegen.
 */

test.use({
    viewport: { width: 1600, height: 900 },
    launchOptions: { args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] },
});

/** Die Küste bei Havena, in Karteneinheiten (x, z von Norden). */
const KUESTE = { x: 336, z: 515 };
/** Offenes Meer in diesem Blick, fern von allen Tafeln (die Sonne im Kopf des Planers bewegt sich selbst). */
const MEER = { x: 600, y: 120, width: 600, height: 200 };

async function geh(page: Page, zoom: number, pitch: number, bearing = 300): Promise<void> {
    await page.evaluate(
        ({ x, z, zoom, pitch, bearing }) => {
            const n = Math.PI * (1 - (2 * z) / 1024);
            const center = { lng: (x / 1024) * 360 - 180, lat: (Math.atan(Math.sinh(n)) * 180) / Math.PI };
            globalThis.avesmapsMap!.jumpTo({ center, zoom, pitch, bearing });
        },
        { ...KUESTE, zoom, pitch, bearing },
    );
    await page.waitForFunction(() => globalThis.avesmapsMap!.loaded(), undefined, { timeout: 60_000 });
    await settleFrame(page);
}

const wasser = (page: Page) =>
    page.evaluate(() =>
        (globalThis as { avesmapsWasser?: { stand(): { bereit: boolean; hz: number } } }).avesmapsWasser?.stand(),
    );

test.beforeEach(async ({ page }) => {
    await page.route("**/api/**", (route) =>
        route.request().method() === "GET" ? route.fallback() : route.fulfill({ status: 204, body: "" }),
    );
});

test("🔴 flach und ohne Wetterschalter: weder die Engine noch das Wasser werden geladen", async ({ page }) => {
    const geladen: string[] = [];
    page.on("request", (anfrage) => geladen.push(anfrage.url()));
    await openMap(page);
    await geh(page, 6.6, 0, 0);
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => localStorage.getItem("avesmaps3d.wetter") ?? "")).toBe("");
    expect(geladen.filter((url) => /wetter-engine|wasser-ebene|wetter-ebene/.test(url))).toEqual([]);
    expect(await page.evaluate(() => globalThis.avesmapsMap!.getLayer("wasser-3d") === undefined)).toBe(true);
    expect(await page.evaluate(() => globalThis.avesmapsMap!.getLayer("wetter-probe") === undefined)).toBe(true);
});

test("🔴 geneigt liegt das Wasser auf der Karte und bewegt sich; angehalten steht es; flach ist es wieder weg", async ({
    page,
}) => {
    const geladen: string[] = [];
    page.on("request", (anfrage) => geladen.push(anfrage.url()));
    await openMap(page);
    await geh(page, 6.6, 62);
    await page.waitForFunction(
        () =>
            (globalThis as { avesmapsWasser?: { stand(): { bereit: boolean } } }).avesmapsWasser?.stand().bereit ===
            true,
        undefined,
        {
            timeout: 60_000,
        },
    );
    await settleFrame(page);
    expect((await wasser(page))?.hz).toBeGreaterThan(0);
    expect(await page.evaluate(() => globalThis.avesmapsMap!.getLayer("wasser-3d") !== undefined)).toBe(true);
    // Zwei Bilder im Abstand einer knappen halben Sekunde: Das Wasser hat sich bewegt.
    const a = await page.screenshot({ clip: MEER });
    await page.waitForTimeout(400);
    const b = await page.screenshot({ clip: MEER });
    expect(a.equals(b)).toBe(false);
    // Angehalten (letzte Stufe der Automatik) steht das Bild.
    await page.evaluate(() =>
        (globalThis as { avesmapsWasser?: { setzeStufe(s: number): void } }).avesmapsWasser!.setzeStufe(3),
    );
    await page.waitForTimeout(500);
    await settleFrame(page);
    const c = await page.screenshot({ clip: MEER });
    await page.waitForTimeout(400);
    const d = await page.screenshot({ clip: MEER });
    expect(c.equals(d)).toBe(true);
    expect(c.equals(b)).toBe(false);
    // Das Wasser zieht die Rechnung des Wetters nicht nach.
    expect(geladen.some((url) => /wasser-ebene/.test(url))).toBe(true);
    expect(geladen.filter((url) => /wetter-engine|wetter-ebene/.test(url))).toEqual([]);

    await geh(page, 6.6, 0, 0);
    await expect
        .poll(() => page.evaluate(() => globalThis.avesmapsMap!.getLayer("wasser-3d") === undefined))
        .toBe(true);
});
