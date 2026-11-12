import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test, type Page } from "@playwright/test";
import { EDITOR_MODE, openMap } from "./map-handle.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Abnahmebilder zu WI-0288 Stufe 5 (nur, wenn jemand die Datei nennt): Wasser in 3D an der Küste und auf einem See, 2D ohne Wasser, die
 * Schneefallgrenze unter „Prüfen“ (Editor) und das Wetter zu zwei Reisedaten. Mit echter Grafikkarte, 1600 × 900. Die Bilder landen in
 * `WETTER_FOTOS` (sonst unter `test-results/`). Geprüft wird hier nichts; das tun `wetter-wasser.spec.ts` und die Vitest-Fälle.
 * 🔴 Nichts Schreibendes erreicht einen Server.
 */

test.use({
    viewport: { width: 1600, height: 900 },
    launchOptions: { args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] },
});
test.setTimeout(600_000);

const ORDNER = process.env["WETTER_FOTOS"] ?? join("test-results", "wetter-stufe5");
mkdirSync(ORDNER, { recursive: true });

const ANSICHTEN = {
    kueste: { x: 336, z: 515, zoom: 6.6, pitch: 62, bearing: 300 },
    see: { x: 593, z: 472, zoom: 7, pitch: 55, bearing: 20 },
    flach: { x: 336, z: 515, zoom: 6.6, pitch: 0, bearing: 0 },
    gebirge: { x: 461, z: 474, zoom: 7.4, pitch: 60, bearing: 330 },
    weit: { x: 520, z: 470, zoom: 4.6, pitch: 50, bearing: 0 },
} as const;

async function geh(page: Page, a: (typeof ANSICHTEN)[keyof typeof ANSICHTEN]): Promise<void> {
    await page.evaluate((a) => {
        const n = Math.PI * (1 - (2 * a.z) / 1024);
        const center = { lng: (a.x / 1024) * 360 - 180, lat: (Math.atan(Math.sinh(n)) * 180) / Math.PI };
        globalThis.avesmapsMap!.jumpTo({ center, zoom: a.zoom, pitch: a.pitch, bearing: a.bearing });
    }, a);
    await page.waitForFunction(() => globalThis.avesmapsMap!.loaded(), undefined, { timeout: 120_000 });
    await page.waitForTimeout(1500);
}

/** Die Tafeln links verdecken die Karte; für die Bilder treten sie zurück. */
async function nurKarte(page: Page): Promise<void> {
    await page.addStyleTag({
        content: ".route-planner, [data-testid='route-planner'] { visibility: hidden !important; }",
    });
}

async function wetterBereit(page: Page): Promise<void> {
    await page.waitForFunction(
        () => {
            const w = (globalThis as { avesmapsWetter?: { stand(): { bereit: boolean; fehler: string | null } } })
                .avesmapsWetter;
            return w !== undefined && (w.stand().bereit || w.stand().fehler !== null);
        },
        undefined,
        { timeout: 300_000 },
    );
}

test.beforeEach(async ({ page }) => {
    await page.route("**/api/**", (route) =>
        route.request().method() === "GET" ? route.fallback() : route.fulfill({ status: 204, body: "" }),
    );
});

test("Wasser: Küste und See in 3D, flach ohne", async ({ page }) => {
    await openMap(page);
    await nurKarte(page);
    await geh(page, ANSICHTEN.flach);
    await page.screenshot({ path: join(ORDNER, "2d-ohne-wasser.png") });
    for (const name of ["kueste", "see"] as const) {
        await geh(page, ANSICHTEN[name]);
        await page.waitForFunction(
            () =>
                (globalThis as { avesmapsWasser?: { stand(): { bereit: boolean } } }).avesmapsWasser?.stand().bereit ===
                true,
            undefined,
            { timeout: 60_000 },
        );
        await page.waitForTimeout(800);
        await page.screenshot({ path: join(ORDNER, `3d-${name}.png`) });
    }
});

test("Schneefallgrenze unter „Prüfen“ (Editor), 15. Hesinde", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("avesmaps3d.wetter", "schneefallgrenze"));
    await stubAdmin(page, { capabilities: ["use_editor_menu"], role: "editor" });
    await openMap(page, `${EDITOR_MODE}?startMonth=hesinde&startDay=15`);
    await nurKarte(page);
    await geh(page, ANSICHTEN.gebirge);
    await wetterBereit(page);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: join(ORDNER, "schneefallgrenze-editor-hesinde.png") });
    // Dazu die Schneedecke (über das Messhandle, nur im Entwicklungsbuild): Sie beginnt an derselben Linie.
    await page.evaluate(() => {
        (globalThis as { avesmapsWetter?: { cfg: Record<string, unknown> } }).avesmapsWetter!.cfg["schnee"] = true;
    });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: join(ORDNER, "schneefallgrenze-und-schneedecke-hesinde.png") });
});

for (const [name, monat] of [
    ["sommer", "rondra"],
    ["winter", "tsa"],
] as const) {
    test(`Wetter am 15. ${monat} (${name})`, async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem("avesmaps3d.wetter", "schneedecke,wolken"));
        await openMap(page, `/?startMonth=${monat}&startDay=15`);
        await nurKarte(page);
        await geh(page, ANSICHTEN.weit);
        await wetterBereit(page);
        await page.waitForTimeout(6000);
        await page.screenshot({ path: join(ORDNER, `wetter-${name}.png`) });
    });
}
