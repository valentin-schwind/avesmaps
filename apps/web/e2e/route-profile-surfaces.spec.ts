import { expect, test } from "@playwright/test";
import "./map-handle";
import {
    LAND_RIVER_SEA,
    openProfile,
    openProfileWithRoute,
    runExtents,
    strokeAgainstToken,
    strokes,
    surfaceOrder,
} from "./profile-surfaces.ts";

/**
 * Die Höhenlinie nach Art (WI-0065 Nachtrag 2026-10-03, Betreiber: „A. Durchgehend zeichnen … hellbraun bei land, blau
 * bei fluss, dunkelblau bei meer, rot bei luft (eine zweite linie über dem profil)“). Braucht Wegprofile und das
 * Domain-Höhenmodell in der Entwicklungsdatenbank (`npm run derive:terrain`).
 */

const TOKENS = {
    land: "--color-profile-land",
    river: "--color-profile-river",
    sea: "--color-profile-sea",
    air: "--color-profile-air",
} as const;

for (const scheme of ["light", "dark"] as const) {
    test(`🔴 Alderstein → Thures Tor (${scheme}): Land, Fluss und Meer in der Folge der Reise - durchgehend, jede Art in ihrer Farbe`, async ({
        page,
    }) => {
        await page.emulateMedia({ colorScheme: scheme });
        const { chart, order } = await openProfileWithRoute(page, LAND_RIVER_SEA);
        await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
        // Das Profil zeichnet die Arten in der Folge, in der die Reise sie fährt (Antwort des Servers).
        expect(await surfaceOrder(chart)).toEqual(order);

        // Jede Art zeichnet in ihrem Token, die drei Farben unterscheiden sich, und die Legende benennt sie.
        const drawn = await strokes(chart);
        expect(Object.keys(drawn).sort()).toEqual([...new Set(order)].sort());
        for (const kind of ["land", "river", "sea"] as const) {
            const line = await strokeAgainstToken(
                chart,
                `[data-surface="${kind}"] path.profile__terrain`,
                TOKENS[kind],
            );
            expect(line.stroke, `${scheme} ${kind}`).toBe(line.token);
        }
        expect(new Set(Object.values(drawn)).size).toBe(3);
        await expect(chart.getByTestId("legend-land")).toHaveText("Land");
        await expect(chart.getByTestId("legend-river")).toHaveText("Fluss und See");
        await expect(chart.getByTestId("legend-sea")).toHaveText("Meer");
        // Eine Landreise hat keine rote Linie.
        await expect(chart.getByTestId("legend-air")).toHaveCount(0);
        await expect(chart.getByTestId("air-path")).toHaveCount(0);

        // Durchgehend: Jeder Lauf beginnt dort, wo der vorige endet, von der ersten bis zur letzten Meile.
        const extents = await runExtents(chart);
        expect(extents.length).toBeGreaterThanOrEqual(order.length);
        for (let i = 1; i < extents.length; i += 1) {
            expect(Math.abs(extents[i]!.x - extents[i - 1]!.right), `Lauf ${i}`).toBeLessThan(0.05);
        }
    });
}

test("🔴 die Farben des Diagramms sind je Thema andere (Hell und Dunkel), die Karte bleibt unberührt", async ({
    page,
}) => {
    const chart = await openProfile(page, LAND_RIVER_SEA);
    const light = await strokes(chart);
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const dark = await strokes(chart);
    for (const kind of ["land", "river", "sea"]) expect(dark[kind], kind).not.toBe(light[kind]);
});

test("🔴 ein Flug: das Gelände darunter, darüber die rote Flughöhe, über jedem Punkt", async ({ page }) => {
    const chart = await openProfile(page, "?route=Punin~Perricum&air=witchFlight");
    await expect(chart.getByTestId("legend-air")).toHaveText("Flughöhe");
    await expect(chart.getByTestId("legend-land")).toHaveText("Land");
    const air = chart.getByTestId("air-path");
    expect(await air.count()).toBeGreaterThan(0);
    const red = await strokeAgainstToken(chart, '[data-testid="air-path"]', TOKENS.air);
    expect(red.stroke).toBe(red.token);
    // Die Bahn liegt in jedem Punkt auf dem Boden oder darüber: Ihr oberster Punkt steht nicht unter dem des Geländes.
    const tops = await chart.locator("svg").evaluate((svg) => {
        const top = (selector: string): number =>
            Math.min(
                ...[...svg.querySelectorAll(selector)].map(
                    (line) => (line as unknown as SVGGraphicsElement).getBBox().y,
                ),
            );
        return { air: top('[data-testid="air-path"]'), ground: top("path.profile__terrain") };
    });
    expect(tops.air).toBeLessThanOrEqual(tops.ground);
    // Der Zeiger nennt Boden und Flughöhe.
    await chart.locator("svg").hover();
    await expect(chart.locator(".profile__reading")).toContainText(/Boden [\d.]+ Schritt, Flug [\d.]+ Schritt/);
});

test("🔴 ein Flug mit Reisebeginn zeichnet die Schneegrenze, kein „Klimazone unbekannt“ (Betreiber 2026-10-04)", async ({
    page,
}) => {
    const chart = await openProfile(page, "?route=Punin~Perricum&air=hippogriff&startMonth=firun&startDay=15");
    await expect(chart.getByTestId("legend-air")).toBeVisible();
    expect(await chart.getByTestId("snowline-path").count()).toBeGreaterThan(0);
    await expect(chart).not.toContainText("Klimazone unbekannt");
    await expect(chart).not.toContainText("erscheint mit einem Reisebeginn");
});

test("🔴 ein Flug über das Meer: dort, wo das Gelände 0 ist, zeichnet der Boden als Meer, ohne zu reißen", async ({
    page,
}) => {
    const chart = await openProfile(page, "?route=Havena~Thorwal&air=griffin");
    const order = await surfaceOrder(chart);
    expect(order).toContain("sea");
    await expect(chart.getByTestId("legend-sea")).toHaveText("Meer");
    await expect(chart.getByTestId("legend-air")).toBeVisible();
    const extents = await runExtents(chart);
    for (let i = 1; i < extents.length; i += 1) {
        expect(Math.abs(extents[i]!.x - extents[i - 1]!.right), `Lauf ${i}`).toBeLessThan(0.05);
    }
});
