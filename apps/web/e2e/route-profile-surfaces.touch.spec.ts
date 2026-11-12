import { expect, test } from "@playwright/test";
import "./map-handle";
import {
    LAND_RIVER_SEA,
    openProfile,
    openProfileWithRoute,
    strokeAgainstToken,
    surfaceOrder,
} from "./profile-surfaces.ts";

/**
 * Die Höhenlinie nach Art am Telefon (WI-0065 Nachtrag 2026-10-03; Pixel 7, 412 px): Land, Fluss, Meer und die rote
 * Flughöhe, ohne dass die Seite seitwärts wächst, in beiden Themen.
 */

for (const scheme of ["light", "dark"] as const) {
    test(`🔴 Alderstein → Thures Tor am Telefon (${scheme}): alle drei Arten in der Legende, nichts läuft über`, async ({
        page,
    }) => {
        await page.emulateMedia({ colorScheme: scheme });
        const { chart, order } = await openProfileWithRoute(page, LAND_RIVER_SEA);
        // Die Folge der Arten nennt die Antwort des Servers (`expectedSurfaceOrder`), nicht der Test.
        expect(await surfaceOrder(chart)).toEqual(order);
        for (const id of ["legend-land", "legend-river", "legend-sea"])
            await expect(chart.getByTestId(id)).toBeVisible();
        for (const [kind, token] of [
            ["land", "--color-profile-land"],
            ["river", "--color-profile-river"],
            ["sea", "--color-profile-sea"],
        ] as const) {
            const line = await strokeAgainstToken(chart, `[data-surface="${kind}"] path.profile__terrain`, token);
            expect(line.stroke, kind).toBe(line.token);
        }
        const overflow = await page.evaluate(() => ({
            page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            chart: (document.querySelector('[data-testid="elevation-chart"]') as HTMLElement).scrollWidth,
            width: (document.querySelector('[data-testid="elevation-chart"]') as HTMLElement).clientWidth,
        }));
        expect(overflow.page).toBeLessThanOrEqual(0);
        expect(overflow.chart).toBeLessThanOrEqual(overflow.width + 1);
    });
}

test("🔴 ein Flug am Telefon: die rote Linie und ihr Eintrag in der Legende", async ({ page }) => {
    const chart = await openProfile(page, "?route=Punin~Perricum&air=witchFlight");
    await expect(chart.getByTestId("legend-air")).toBeVisible();
    expect(await chart.getByTestId("air-path").count()).toBeGreaterThan(0);
    const red = await strokeAgainstToken(chart, '[data-testid="air-path"]', "--color-profile-air");
    expect(red.stroke).toBe(red.token);
});
