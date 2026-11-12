import { expect, test, type Page } from "@playwright/test";
import type { EditorPathList, EditorPathStreet } from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap } from "./map-handle.ts";
import { GRATENFELS_LAGE, editorPanelVorn } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Die Lasche „Editor“ rückt mit, wenn ein angedocktes Editor-Fenster seine Liste einzieht (Betreiber 2026-10-17, mit Bildschirmfoto:
 * „passiert bei landschaften, kraftlinien und wegen, beim ortseditor klappts ein“). Problemfall: Landschafts-, Kraftlinien- und
 * Wege-Fenster hielten den Schalter « » nur für sich; `slotBreite` in `app.vue` kannte nur den Ortseditor, die Lasche blieb an der
 * Kante des breiten Fensters mitten über der Karte stehen. Geprüft am Wege-Fenster; alle drei teilen denselben Weg über `listenSchalter`.
 */
const G = GRATENFELS_LAGE;
const RS = "c5c5c5c5-0000-4000-8000-0000000000a1";
const LISTE: EditorPathList = {
    rows: [
        {
            id: RS,
            name: "Reichsstraße 3",
            subtype: "Reichsstrasse",
            isBach: false,
            circle: "halb-rechts",
            segments: 1,
            bounds: [G.x - 20, G.y - 10, G.x + 20, G.y + 10],
        },
    ],
};
const STRASSE: EditorPathStreet = {
    id: RS,
    name: "Reichsstraße 3",
    subtype: "Reichsstrasse",
    isBach: false,
    circle: "halb-rechts",
    labelVisible: null,
    segments: [
        { id: RS, revision: 1, labelVisible: true, wiki: false, points: 3, bounds: [G.x - 20, G.y - 10, G.x, G.y] },
    ],
    bounds: [G.x - 20, G.y - 10, G.x + 20, G.y + 10],
};

async function oeffneWegeFenster(page: Page): Promise<void> {
    await stubAdmin(page, { capabilities: ["use_editor_menu"], role: "reviewer" });
    await page.route("**/api/editor/paths", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(LISTE) }),
    );
    await page.route(/\/api\/editor\/paths\/[0-9a-f-]{36}\/street$/, (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(STRASSE) }),
    );
    await openMap(page, EDITOR_MODE);
    await editorPanelVorn(page);
    await page.getByTestId("editorpanel-kachel-wege").click();
    await page.getByTestId("editorpanel-verb").click();
}

/** Linke Kante des angedockten Fensters und rechte Kante der Lasche, nach dem Übergang (220 ms). */
async function kanten(page: Page): Promise<{ fenster: number; lasche: number }> {
    await page.waitForTimeout(400);
    const liste = page.locator('[data-testid^="wegeditor-"][data-testid$="-liste"]');
    const huelle = liste.locator("xpath=ancestor::*[contains(@class,'avm-fenster')][1]");
    const fenster = (await huelle.boundingBox())!;
    const lasche = (await page.getByTestId("editor-panel-tab").boundingBox())!;
    return { fenster: fenster.x, lasche: lasche.x + lasche.width };
}

test("🔴 die Lasche „Editor“ steht an der Kante des Wege-Fensters, auch nach « (Liste eingezogen) und »", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await oeffneWegeFenster(page);
    const vorher = await kanten(page);
    expect(Math.abs(vorher.lasche - vorher.fenster)).toBeLessThanOrEqual(2);

    await page.locator(".wegeditor__listenschalter").click();
    const eingezogen = await kanten(page);
    expect(eingezogen.fenster).toBeGreaterThan(vorher.fenster + 100);
    expect(Math.abs(eingezogen.lasche - eingezogen.fenster)).toBeLessThanOrEqual(2);

    await page.locator(".wegeditor__listenschalter").click();
    const wieder = await kanten(page);
    expect(Math.abs(wieder.lasche - wieder.fenster)).toBeLessThanOrEqual(2);
});
