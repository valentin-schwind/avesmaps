import { expect, test, type Route } from "@playwright/test";
import type { SearchResponse, SubjectDetail } from "@avesmaps3d/shared";
import { openMap, settleFrame } from "./map-handle.ts";

/**
 * Eine Landmarke in der Spotlight-Suche und ihr Panel (WI-0271 L6): Die Sektion „Landmarken“ nennt Name und Art, die Wahl öffnet das Panel mit dem Typbild der
 * Art. Suche und Detail kommen aus Stubs: Keine Zeile einer neuen Art liegt in einer Datenbank.
 *
 * Problemfälle: Die Höhle steht als fünfte Trefferart zwischen den Orten (die Photobox kennt nur vier); die Zeile nennt „Gipfel“ statt „Höhle“; das Panel zeigt das
 * Bild des Berggipfels.
 */

test.use({ viewport: { width: 1920, height: 1080 } });

const HOEHLE = "c8c8c8c8-0271-4006-8000-000000000001";
const PUNKT = { x: 450, y: 560 };

const json = (route: Route, body: unknown): Promise<void> =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

test("🔴 eine Höhle: eigene Sektion mit ihrer Art, ihr Panel mit dem Typbild der Höhle", async ({ page }) => {
    const antwort: SearchResponse = {
        query: "Probehöhle",
        hits: [],
        truncated: false,
        landmarken: { hits: [{ id: HOEHLE, name: "Probehöhle", art: "hoehle", ...PUNKT }], total: 1 },
    };
    await page.route(/\/api\/search\?q=/, (route) => json(route, antwort));
    const detail: SubjectDetail = {
        subject: { kind: "peak", id: HOEHLE },
        revision: "test",
        title: "Probehöhle",
        subtitle: [{ part: "type", key: "hoehle" }],
        target: { ...PUNKT, zoom: 5 },
    };
    await page.route(`**/api/subjects/peak/${HOEHLE}*`, (route) => json(route, detail));

    await openMap(page, "/#x=500.000&y=500.000&z=2.50&series=original");
    await page.keyboard.press("f");
    await page.getByTestId("search-input").fill("Probehöhle");
    const zeile = page.getByTestId("search-landmarke");
    await expect(zeile).toHaveCount(1);
    await expect(page.getByTestId("search-sektion-landmarken")).toHaveText("Landmarken");
    await expect(zeile).toContainText("Probehöhle");
    await expect(zeile).toContainText("Höhle");
    await expect(page.getByTestId("search-hit")).toHaveCount(0);
    await page.screenshot({ path: "test-results/l6-suche-landmarke.png" });

    await zeile.click();
    const bild = page.getByTestId("info-header-image");
    await expect(bild).toHaveAttribute("data-graphic", "hoehle");
    await expect(page.getByText("Probehöhle").first()).toBeVisible();
    await settleFrame(page);
    await page.screenshot({ path: "test-results/l6-panel-landmarke.png" });
});
