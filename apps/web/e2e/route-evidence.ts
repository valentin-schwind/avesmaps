import { expect, type Page } from "@playwright/test";
import type { RouteResponse } from "@avesmaps3d/shared";

/** Vor der Navigation registrieren: Die UI wird gegen die unveränderte Antwort des Servers geprüft. */
export async function routeAnswer(page: Page): Promise<RouteResponse> {
    const response = await page.waitForResponse(
        (candidate) => candidate.url().includes("/api/route?") && candidate.ok(),
    );
    const route = (await response.json()) as RouteResponse;
    expect(route.found, "Voraussetzung: die angefragte Reise ist möglich").toBe(true);
    expect(route.stages.length).toBeGreaterThan(0);
    return route;
}
