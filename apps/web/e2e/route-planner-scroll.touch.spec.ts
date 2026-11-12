import { expect, test } from "@playwright/test";
import { openEverything, scrollReport } from "./scroll-containers.ts";

/**
 * 🔴 Am Telefon rollt genau EIN Ding im Routenplaner und nichts seitlich (Betreiber 2026-10-04): das Panel, nicht zusätzlich
 * die Übersicht. Bei 320 px schnitt die Tagline („Dein Routenplaner für Aventurien aus „Das Schwarze Auge“.“, eine Zeile von
 * 333 px im 294-px-Panel) Inhalt am Rand ab; sie bricht jetzt um. Gemessen bei 320, 360 und 412 px.
 */
for (const width of [320, 360, 412]) {
    test(`🔴 Am Telefon bei ${String(width)} px: ein Scroll-Container, kein waagerechter Überlauf, auch mit offenen Grenzübertritten`, async ({
        page,
    }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(
            "/?route=Wargentrutz~@478.44,610.97&landTransport=lightRider&seaTransport=galley&startMonth=firun",
        );
        await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, {
            timeout: 30_000,
        });
        const tab = page.getByTestId("route-planner-tab");
        if ((await tab.getAttribute("aria-expanded")) !== "true") await tab.tap();
        await expect(tab).toHaveAttribute("aria-expanded", "true");

        // Die Tagline läuft nicht über das Panel hinaus (sie brach bei 320 px nicht um und wurde abgeschnitten).
        const tagline = await page.evaluate(() => {
            const element = document.querySelector<HTMLElement>(".planner__tagline");
            return element ? element.scrollWidth <= element.clientWidth + 1 : null;
        });
        expect(tagline, "Tagline passt in die Breite").toBe(true);

        // Erst wenn die Route steht, sind alle Deckel da.
        await expect(page.getByTestId("areas-toggle")).toBeVisible({ timeout: 20_000 });
        const closed = await scrollReport(page);
        expect(closed.vertical, "alles zu").toHaveLength(1);
        await openEverything(page);
        const open = await scrollReport(page);
        expect(open.vertical, `${String(width)} px, alles offen, Grenzübertritte offen`).toHaveLength(1);
        expect(open.horizontal).toEqual([]);
        expect(open.panelClipsSideways, `${String(width)} px: das Panel schneidet nichts seitlich ab`).toBe(false);
    });
}
