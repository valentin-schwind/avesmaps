import { expect, test, type Page } from "@playwright/test";
import { openMap } from "./map-handle.ts";

/**
 * Was Besucher sehen, wenn die Systemsteuerung Inhalte ausblendet (WI-0127 SYS-10 Teil b, SYS-0001 §3.4, §6.6; Sätze des Blatts WI-0119
 * A2). Der Stand kommt aus einem Nachbau von `GET /api/content-state`; was der Server selbst zurückhält (`paused`, `switched_off`), prüft
 * `apps/server/test/inhaltsschalter-wirkung.test.ts`.
 *
 * - An der Stelle des Abschnitts steht sein Satz, die Zahl im Kopf fällt weg; die übrigen Abschnitte bleiben.
 * - Eine ausgeblendete Vorkommensart behält ihre Zeile, mit Satz statt Deckel.
 * - In den Hinweisen steht „Gerade pausiert: …“.
 * - Der Fächer bietet eine ausgeblendete Serie nicht an; zeigt die Karte gerade sie, wechselt er und sagt es.
 *
 * 🪤 Braucht einen Fastify mit Entwicklungsdatenbank hinter Vite (Gareth mit Literatur, Kartensammlung und Vorkommen):
 *   $env:E2E_PORT="4349"; npx playwright test e2e/inhalte-besucher.spec.ts --project=chromium --workers=1
 */

const GARETH = { kind: "place", id: "80558060-4299-54aa-b520-814b10819885" } as const;

async function stand(page: Page, off: string[]): Promise<void> {
    await page.route("**/api/content-state", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: { etag: '"c9-database"', "cache-control": "no-cache" },
            body: JSON.stringify({ revision: 9, off }),
        }),
    );
}

test("🔴 Literatur und Fauna ausgeblendet: Sätze an der Stelle, die Kartensammlung bleibt, die Hinweise nennen beides", async ({
    page,
}) => {
    await stand(page, ["panel.literature", "panel.lore.fauna"]);
    await openMap(page);
    await page.evaluate((target) => globalThis.avesmapsOpenSubject?.(target), GARETH);
    await page.getByTestId("info-title").waitFor({ timeout: 30_000 });

    const literatur = page.locator('[data-section="literature"]');
    await expect(literatur.getByTestId("info-catalog-paused")).toHaveText("Die Literatur ist gerade ausgeblendet.", {
        timeout: 30_000,
    });
    await expect(literatur.getByTestId("info-action-literatureAll")).toHaveCount(0);
    const karten = page.locator('[data-section="citymaps"]');
    await expect(karten.getByTestId("info-action-citymapsAll")).toBeVisible({ timeout: 30_000 });
    await expect(karten.getByTestId("info-catalog-paused")).toHaveCount(0);

    const fauna = page.locator('[data-field="lore:fauna"]');
    await expect(fauna.getByTestId("info-lore-paused")).toHaveText("Fauna ist gerade ausgeblendet.");
    await expect(page.locator('[data-field="lore:ware"]').getByTestId("info-lore-paused")).toHaveCount(0);

    await page.getByTestId("notes-open").click();
    await expect(page.getByTestId("notes-paused")).toHaveText("Gerade pausiert: Literatur, Fauna.");
});

test("eine ausgeblendete Serie bietet der Fächer nicht an; zeigt die Karte gerade sie, wechselt er und sagt es", async ({
    page,
}) => {
    await stand(page, ["map.series.modern"]);
    await openMap(page);
    await expect(page.getByTestId("fan-series-paused")).toHaveText("Diese Kartenansicht ist gerade nicht verfügbar.");
    // Die Karte zeigt jetzt die andere Serie.
    await expect
        .poll(
            () =>
                page.evaluate(() =>
                    JSON.stringify(
                        (globalThis.avesmapsMap?.getStyle() as { sources?: unknown } | undefined)?.sources ?? {},
                    ),
                ),
            { timeout: 15_000 },
        )
        .toContain("/tiles/raster/original/");
    // Mit einer einzigen Serie gibt es keine Unterreihe der Untergründe mehr: nichts zu wählen, und „Modern“ steht nirgends.
    await page.getByTestId("fan-toggle").click();
    await expect(page.getByTestId("fan-menu")).toBeVisible();
    await expect(page.getByTestId("fan-ohr-standard")).toHaveCount(0);
    await expect(page.getByTestId("fan-series-modern")).toHaveCount(0);
});

test("🔴 Reiseberechnung und 3D-Gelände pausiert (SYS-11): der Planer sagt es, das Auge-Menü sperrt „3D-Gelände“ mit Satz", async ({
    page,
}) => {
    await stand(page, ["route.compute", "map.terrain3d"]);
    await openMap(page);
    await expect(page.getByTestId("planner-paused")).toHaveText(
        "Die Reiseberechnung ist gerade pausiert. Die Karte funktioniert weiter.",
    );
    await page.getByTestId("display-open").click();
    const zeile = page.getByTestId("display-terrain-paused");
    await expect(zeile).toBeVisible();
    await expect(zeile).toHaveAttribute("title", "Das 3D-Gelände ist gerade pausiert. Die Karte bleibt flach.");
    await expect(zeile.locator("input")).toBeDisabled();
    await page.keyboard.press("Escape");
    await page.getByTestId("notes-open").click();
    await expect(page.getByTestId("notes-paused")).toHaveText("Gerade pausiert: Reiseberechnung, 3D-Gelände.");
});

test("ohne Pause gibt es weder den Satz im Planer noch die Zeile im Auge-Menü", async ({ page }) => {
    await stand(page, []);
    await openMap(page);
    await expect(page.getByTestId("planner-transport")).toBeVisible();
    await expect(page.getByTestId("planner-paused")).toHaveCount(0);
    await page.getByTestId("display-open").click();
    await expect(page.getByTestId("display-menu")).toBeVisible();
    await expect(page.getByTestId("display-terrain-paused")).toHaveCount(0);
});
