import { expect, test } from "@playwright/test";
import { openEverything, scrollReport } from "./scroll-containers.ts";

/**
 * 🔴 Es rollt genau EIN Ding im Routenplaner (Betreiber 2026-10-04: „der routenplaner hat schon einen“, „doppelte
 * scrollbalken passieren z.b. wenn ich die grenzübertritte aufklappe“). Ursache war der Text der Fußnoten für Screenreader
 * (`position: absolute` ohne eigenen Bezugsrahmen, das Panel wurde sein Bezugsrahmen und rollte mit): Er lag außerhalb des
 * Rollbereichs der Übersicht und machte das Panel zu einem zweiten Scroll-Container, sobald der Kostenkasten offen war.
 */
const ROUTES = [
    // Gemischte Nächte, Fußnoten, eine Landesgrenze: der Fall der Editoren.
    "?route=Wargentrutz~@478.44,610.97&landTransport=lightRider&seaTransport=galley&startMonth=firun",
    // Zwei Landesgrenzen, Schiffe, lange Gebietsnamen.
    "?route=Gareth~Fasar",
];

for (const search of ROUTES) {
    test(`🔴 Am Rechner rollt nur die Übersicht, nie ein zweiter Container, nichts seitlich: ${search.slice(0, 40)}`, async ({
        page,
    }) => {
        // Niedrig, damit auch eine kurze Übersicht rollen muss.
        await page.setViewportSize({ width: 1280, height: 700 });
        await page.goto(`/${search}`);
        await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, {
            timeout: 30_000,
        });
        await expect(page.getByTestId("route-planner-tab")).toHaveAttribute("aria-expanded", "true");

        // Zu, offen, Grenzübertritte offen: jedes Mal genau ein Scroll-Container.
        // Erst wenn die Route steht, sind alle Deckel da.
        await expect(page.getByTestId("areas-toggle")).toBeVisible({ timeout: 20_000 });
        const closed = await scrollReport(page);
        expect(closed.vertical, "alles zu").toHaveLength(1);
        await openEverything(page);
        const open = await scrollReport(page);
        expect(open.vertical, "alles offen, Grenzübertritte offen").toHaveLength(1);
        // Es ist dasselbe Ding: die Übersicht unter den feststehenden Eingaben, nicht das Panel.
        expect(open.vertical).toEqual(closed.vertical);
        expect(open.horizontal).toEqual([]);
        expect(open.panelClipsSideways).toBe(false);
    });
}
