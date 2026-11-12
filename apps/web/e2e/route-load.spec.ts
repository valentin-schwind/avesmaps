import { expect, test, type Page, type Route } from "@playwright/test";
import { openStagePanel, stageField } from "./stage-panel.ts";

/**
 * Absagen wegen Last am echten Planer (Betreiber 2026-09-27): Der Planer fragt selbst noch einmal und gibt
 * nach drei Versuchen mit einem eigenen Satz auf.
 *
 * 🪤 Die Absagen des Servers werden hier nachgestellt. Unter echter Last kommen sie nur manchmal, im parallelen
 * Volllauf etwa bei route-departure.spec.ts:18 (503 routing_timeout nach 2045 ms, 2026-09-27).
 */

async function openPlanner(page: Page, search: string): Promise<void> {
    await page.goto(`/${search}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
}

/** Nur die Route selbst, nicht Wegpunkte oder Landschaften unter `/api/route/…`. */
const routeRequest = (url: URL): boolean => url.pathname === "/api/route";

const refuse = (route: Route, error: "routing_busy" | "routing_timeout") =>
    route.fulfill({
        status: 503,
        contentType: "application/json",
        // Die Pause bestimmt der Server; hier keine, damit der Test nicht wartet.
        headers: { "Retry-After": "0" },
        body: JSON.stringify({ error }),
    });

test("🔴 eine Absage wegen Last fragt der Planer selbst noch einmal", async ({ page }) => {
    let requests = 0;
    await page.route(routeRequest, async (route) => {
        requests += 1;
        await (requests <= 2 ? refuse(route, requests === 1 ? "routing_busy" : "routing_timeout") : route.continue());
    });
    await openPlanner(page, "?route=Gareth~Perricum");

    await expect(page.getByTestId("route-title")).toHaveText(/Die Reise von\s+Gareth\s+nach\s+Perricum/);
    expect(requests, "zwei Absagen, dann die Route").toBe(3);
});

test("🔴 eine Absage wegen Last fragen auch die Landschaften selbst noch einmal", async ({ page }) => {
    // Befund 2026-10-03: Der Server rechnet je Prozess höchstens zwei Landschaftsabfragen und weist die dritte sofort ab.
    let requests = 0;
    await page.route(
        (url) => url.pathname === "/api/route/landscapes",
        async (route) => {
            requests += 1;
            await (requests === 1
                ? route.fulfill({
                      status: 503,
                      contentType: "application/json",
                      headers: { "Retry-After": "0" },
                      body: JSON.stringify({ error: "busy" }),
                  })
                : route.continue());
        },
    );
    await openPlanner(page, "?route=Gareth~Perricum");

    await openStagePanel(page, 0);
    await expect(stageField(page, "landscapes")).toContainText(/\S/);
    // Unter echter Last kann auch die zweite Frage abgewiesen werden; dann kommt die Zeile mit der dritten.
    expect(requests, "eine Absage, dann die Landschaften").toBeGreaterThanOrEqual(2);
});

test("🔴 nach drei Absagen wegen Last steht der Satz", async ({ page }) => {
    let requests = 0;
    await page.route(routeRequest, async (route) => {
        requests += 1;
        await refuse(route, "routing_timeout");
    });
    await openPlanner(page, "?route=Gareth~Perricum");

    await expect(page.getByTestId("toast")).toContainText("Route aufgrund von zu viel Last abgelehnt.");
    expect(requests, "drei Versuche, kein vierter").toBe(3);
});
