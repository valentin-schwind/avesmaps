import { expect, test, type Route } from "@playwright/test";

/**
 * 🔴 Lädt die Karte trotz geladener Seite nicht, sagt es EIN ruhiger Hinweis mit dem Satz der Störungsseite, und er geht von
 * selbst, sobald die Antworten zurück sind (WI-0127 SYS-6, Bauplan SYS-0001 §6.6, §7.1; WI-0119 E2). Nachgestellt wird der Ausfall
 * des Servers hinter der Seite: Kacheln und API antworten 503, die Seite selbst kommt noch.
 */
const ausfall = (route: Route) =>
    route.fulfill({ status: 503, contentType: "text/plain", body: "Service Unavailable" });

test("🔴 Kacheln und API fallen aus: ein Hinweis über der Karte, kein Fehler je Teil; zurück, und er geht von selbst", async ({
    page,
}) => {
    test.setTimeout(120_000);
    await page.route("**/tiles/**", ausfall);
    await page.route("**/api/**", ausfall);
    await page.goto("/");

    const hinweis = page.getByTestId("karte-gestoert");
    await expect(hinweis).toBeVisible({ timeout: 30_000 });
    await expect(hinweis).toHaveText(/Wartungsarbeiten, wir sind bald wieder da\./u);
    await expect(hinweis).toHaveAttribute("role", "status");
    await expect(page.getByTestId("karte-gestoert")).toHaveCount(1);
    // Auskunft, keine Schaltfläche: Klicks gehen an die Karte darunter.
    expect(await hinweis.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe("none");

    // Der Server ist zurück: Die Wache fragt die gescheiterten Quellen nach, die erste Kachel nimmt den Hinweis zurück.
    await page.unroute("**/tiles/**");
    await page.unroute("**/api/**");
    await expect(hinweis).toBeHidden({ timeout: 45_000 });
});

test("ein Aussetzer einer Kachel unter Last zeigt nichts", async ({ page }) => {
    let einmal = true;
    await page.route("**/tiles/vector/**", (route) => {
        if (einmal) {
            einmal = false;
            return ausfall(route);
        }
        return route.fallback();
    });
    await page.goto("/");
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 60_000 });
    await expect(page.getByTestId("karte-gestoert")).toHaveCount(0);
});
