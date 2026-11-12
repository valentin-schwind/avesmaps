import { expect, test } from "@playwright/test";
import { openStagePanel, stageField, stageFieldValue } from "./stage-panel.ts";
import { showStages } from "./stage-groups.ts";

/**
 * Die Steigung im Planer (WI-0049 S5d; Betreiber 2026-09-28: der Satz wie Legacy und dann „Details zur
 * Höhenberechnung“). Legacys Wortlaut vom Owner 30.07.2026: „(max. 21 % Steigung, 1.539 ↑, 809 ↓ Schritt)“.
 *
 * 🔴 Braucht Wegprofile in der Datenbank (`npm run derive:terrain`). Ohne sie trägt die Route keine
 * Steigung, und die Tests überspringen sichtbar. Eine Grafikkarte braucht es nicht: Die Zahlen rechnet
 * der Server.
 */

test.beforeEach(async ({ request }) => {
    const zeiger = await request.get("/tiles/terrain/dem/current.json");
    const json = (zeiger.headers()["content-type"] ?? "").includes("json");
    test.skip(zeiger.status() === 404 || !json, "kein Gelände abgeleitet: npm run derive:terrain");
});

async function openRoute(page: import("@playwright/test").Page, search: string): Promise<void> {
    await page.goto(`/${search}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await showStages(page, 15_000);
}

test("🔴 über den Saljethweg: Steigung, Auf und Ab und Mehrzeit; der Link öffnet den Reiter „Gebirge“", async ({
    page,
}) => {
    await openRoute(page, "?route=Greifenfurt~Lowangen");
    await page.getByTestId("profile-toggle").click();
    const summary = page.getByTestId("route-slope");
    await expect(summary).toContainText(/Max\. (Steigung|Gefälle): \d+ %/);
    await expect(summary).toContainText(/höchster Punkt [\d.]+ Schritt/);
    // Die Pfeile sind Wörter für Vorleser, nicht nur Zeichen.
    await expect(summary.getByLabel("bergauf")).toHaveCount(1);
    await expect(summary.getByLabel("bergab")).toHaveCount(1);
    // Die Steigung EINER Etappe steht seit WI-0079 im Infopanel (§4), nicht mehr in der Zeile des Planers.
    await openStagePanel(page, 0);
    await expect(stageFieldValue(page, "slope")).toContainText(
        /max\. \d+ % (Steigung|Gefälle), [\d.]+ .+, [\d.]+ .+ Schritt/,
    );
    await page.keyboard.press("Escape");

    await page.getByTestId("route-slope-details").click();
    const fenster = page.getByRole("dialog", { name: "Transportmittel" });
    await expect(fenster.getByRole("tab", { name: "Im Gebirge", exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
    );
    await expect(fenster.getByTestId("transport-info-steigungsbild")).toBeVisible();
    // Das ⓘ selbst öffnet weiter die Tempotafel.
    await page.keyboard.press("Escape");
    await page.getByTestId("transport-info-open").click();
    await expect(fenster.getByRole("tab", { name: "Zu Land und Wasser", exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
    );
});

test("🔴 ohne Höhen schweigt der Planer: keine Zeile, keine leere Klammer", async ({ page }) => {
    // Dieselbe Reise, aber die Antwort ohne Steigung - so, wie sie ohne Wegprofile käme.
    await page.route("**/api/route?*", async (route) => {
        const response = await route.fetch();
        const body = (await response.json()) as { slope?: unknown; stages: { slope?: unknown }[] };
        delete body.slope;
        for (const stage of body.stages) delete stage.slope;
        await route.fulfill({ response, json: body });
    });
    await openRoute(page, "?route=Greifenfurt~Lowangen");
    await expect(page.getByTestId("route-slope")).toHaveCount(0);
    await openStagePanel(page, 0);
    await expect(stageField(page, "slope")).toHaveCount(0);
});

test("🔴 der Gang querfeldein im Hügelland zeigt Steigung und Mehrzeit wie ein Weg (WI-0049 F5)", async ({ page }) => {
    // Ein Kartenpunkt im Hügelland, außerhalb der Gebirgsflächen; der Gang zu Wallerheim ist rund neun Karteneinheiten lang.
    // Seit F5 kostet auch dort die Steigung Zeit (vorher nur im Gebirge): „(max. … % Steigung, … ↑, … ↓ Schritt, kostet … h)“.
    await openRoute(page, "?route=@455.91,516.01~Wallerheim");
    const gang = page.getByTestId("route-stage").first();
    await expect(gang).toContainText("Unwegsames Gelände");
    await openStagePanel(page, 0);
    const slope = stageFieldValue(page, "slope");
    await expect(slope).toContainText(/max\. \d+ % (Steigung|Gefälle), [\d.]+ .+, [\d.]+ .+ Schritt, kostet [\d,]+ h/);
});
