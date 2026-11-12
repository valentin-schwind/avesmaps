import { expect, test, type Page } from "@playwright/test";
import { EDITOR_MODE, openMap } from "./map-handle.ts";
import { GRATENFELS, LISTE, ORTSEDITOR_RECHTE } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Tiefe Links ins Editorpanel und auf die Karte (WI-0218 Nachbesserung; Zuteilung der Editor-Orchestrierung 2026-10-17, EDIT-0001 §3.2):
 *
 * - `?tab=<werkzeug>` öffnet das Fenster dieses Werkzeugs wie das Verb im Editorpanel, für alle fünf Editoren über EINE Stelle in `app.vue`.
 *   Bis dahin wählte der Link nur die Kachel, und der Betreiber sah kein Fenster („das tab öffnet nicht“).
 * - `?tab=ortseditor&place=<public_id>` öffnet den Ortseditor an diesem Ort, nachdem der Objektlink ihn aufgelöst hat.
 * - Ein Hash mit Lage und Ansicht, aber ohne `series`, öffnet die Karte dort (Betreiber 2026-10-17 zu
 *   `/edit#x=518.750&y=504.000&z=4.5&view=powerlines`: „ich weiss was du öffnen willst, er aber tuts nicht.“). Bis dahin verwarf die Seite
 *   den ganzen Link und zeigte die Startansicht.
 *
 * Kein Fall schreibt in die Datenbank der Entwicklung: Listen und Details kommen aus Stubs; nur der Objektlink fragt den Server.
 */

const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

/** Ein offenes, sichtbares Fenster eines Werkzeugs. */
const fensterVon = (page: Page, werkzeug: string) =>
    page.locator(`dialog[data-lage][open][data-testid^="${werkzeug}-"]`);

test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
});

test("🔴 ?tab=landschaftseditor öffnet das Fenster der Landschaften", async ({ page }) => {
    await stubAdmin(page, { capabilities: ["use_editor_menu"], role: "reviewer" });
    await page.route("**/api/editor/landscapes", (route) => route.fulfill(json({ rows: [] })));
    await openMap(page, `${EDITOR_MODE}?tab=landschaftseditor`);
    await expect(fensterVon(page, "landschaftseditor")).toHaveCount(1);
    await expect(fensterVon(page, "landschaftseditor")).toHaveAttribute("data-lage", "angedockt");
    await expect(page.getByTestId("editorpanel-kachel-regionen")).toBeVisible();
});

test("🔴 ?tab=gebietseditor öffnet das Fenster der Herrschaftsgebiete", async ({ page }) => {
    await stubAdmin(page, { capabilities: ["use_editor_menu"], role: "reviewer" });
    await page.route("**/api/editor/territories", (route) => route.fulfill(json({ yearBf: 1049, rows: [] })));
    await openMap(page, `${EDITOR_MODE}?tab=gebietseditor`);
    await expect(fensterVon(page, "gebietseditor")).toHaveCount(1);
});

for (const [werkzeug, liste] of [
    ["wegeditor", "**/api/editor/paths"],
    ["kraftlinieneditor", "**/api/editor/powerlines"],
] as const) {
    test(`?tab=${werkzeug} öffnet sein Fenster`, async ({ page }) => {
        await stubAdmin(page, { capabilities: ["use_editor_menu"], role: "reviewer" });
        await page.route(liste, (route) => route.fulfill(json({ rows: [] })));
        await openMap(page, `${EDITOR_MODE}?tab=${werkzeug}`);
        await expect(fensterVon(page, werkzeug)).toHaveCount(1);
    });
}

test("🔴 ?tab=ortseditor&place=<id> öffnet den Ortseditor an diesem Ort", async ({ page }) => {
    await stubAdmin(page, { capabilities: ORTSEDITOR_RECHTE, role: "editor" });
    await page.route("**/api/editor/places", (route) => route.fulfill(json(LISTE)));
    await openMap(page, `${EDITOR_MODE}?tab=ortseditor&place=${GRATENFELS}`);
    await expect(fensterVon(page, "ortseditor")).toHaveCount(1, { timeout: 20_000 });
    await expect(fensterVon(page, "ortseditor").locator(".avm-fenster__titel").first()).toContainText("Gratenfels");
    await expect
        .poll(() => page.evaluate(() => globalThis.avesmapsSelectedSubject?.()))
        .toMatchObject({ kind: "place", id: GRATENFELS });
});

test("ohne Werkzeug im Link bleibt es bei der Kachel: ?tab=regionen öffnet kein Fenster", async ({ page }) => {
    await stubAdmin(page, { capabilities: ["use_editor_menu"], role: "reviewer" });
    await page.route("**/api/editor/landscapes", (route) => route.fulfill(json({ rows: [] })));
    await openMap(page, `${EDITOR_MODE}?tab=regionen`);
    await expect(page.getByTestId("editorpanel-kachel-regionen")).toBeVisible();
    await page.waitForTimeout(500);
    await expect(fensterVon(page, "landschaftseditor")).toHaveCount(0);
});

test("🔴 ein Hash ohne series öffnet Lage, Zoom und Ansicht, statt die Startansicht zu zeigen", async ({ page }) => {
    await stubAdmin(page, { capabilities: ["use_editor_menu"], role: "reviewer" });
    await openMap(page, `${EDITOR_MODE}#x=518.750&y=504.000&z=4.5&view=powerlines`);
    const stand = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        return { zoom: map.getZoom(), hash: location.hash };
    });
    expect(stand.zoom).toBeCloseTo(4.5, 1);
    expect(stand.hash).toContain("view=powerlines");
    expect(stand.hash).toContain("series=modern");
});
