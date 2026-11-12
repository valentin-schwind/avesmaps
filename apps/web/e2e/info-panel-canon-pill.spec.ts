import { test, webkit } from "@playwright/test";
import { existsSync } from "node:fs";
import { expectCanonPillsCentred } from "./canon-pill-look.ts";

/**
 * 🔴 Die Kanon-Pille am Rechner: Kanonwort fett, Schrift vertikal exakt mittig (höchstens 0,5 px), beide Formen 18 px hoch - in Chromium
 * und in WebKit, hell und dunkel (Betreiber 2026-10-04). Gemessen bei vierfacher Pixeldichte, sonst ist die Rasterung schon so grob wie
 * die Toleranz. Das Telefon prüft `info-panel-canon-pill.touch.spec.ts`.
 */

test.use({ deviceScaleFactor: 4, viewport: { width: 1280, height: 900 } });

test("🔴 Kanon-Pille in Chromium: fett nur das Kanonwort, exakt mittig, 18 px", async ({ page }) => {
    test.setTimeout(180_000);
    await expectCanonPillsCentred(page);
});

const webkitInstalled = ((): boolean => {
    try {
        return existsSync(webkit.executablePath());
    } catch {
        return false;
    }
})();

test("🔴 Kanon-Pille in WebKit am Rechner: dieselbe Mitte", async ({ baseURL }) => {
    test.setTimeout(180_000);
    test.skip(!webkitInstalled, "WebKit ist nicht installiert (npx playwright install webkit)");
    const browser = await webkit.launch();
    try {
        const context = await browser.newContext({
            baseURL: baseURL ?? "http://localhost:4178",
            viewport: { width: 1280, height: 900 },
            deviceScaleFactor: 4,
        });
        await expectCanonPillsCentred(await context.newPage());
    } finally {
        await browser.close();
    }
});
