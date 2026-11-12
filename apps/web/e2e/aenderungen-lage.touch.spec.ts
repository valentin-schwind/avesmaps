import { expect, test, type Page } from "@playwright/test";
import { GEBIET_KASTEN, RECHTE, json, pruefeKeinKartenrand, stubs } from "./aenderungen-lage-stub.ts";
import { EDITOR_MODE, openMap, settleFrame } from "./map-handle.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * „⊕ Auf der Karte zeigen“ am Telefon (WI-0265 B9: „Mobil gilt dasselbe“): Das Panel verdeckt die Karte, also blendet es sich beim Fliegen weg, die Karte zeigt den heutigen Ort, und ein
 * Rückweg auf der Leiste („‹ Zur Liste“ aus der Zeile, „‹ Zum Detail“ aus dem Detail) bringt das Panel zurück. Derselbe Weg wie bei jedem Vorher/Nachher (`map/aenderungen-overlay.ts`).
 *
 * B9c: Der untere Deckel des Flugs ist nicht die Startstufe, sondern die Stufe, bei der das Kartenbild die freie Fläche gerade noch füllt (`fillZoom`). Der Test stellt die Startstufe der Production (3,4;
 * `GET /api/map-settings`): Bei ihr wäre das Gebiet (100 × 70 Kartenpunkte) breiter als das Telefon, und doch wird es ganz gezeigt.
 */

/** Die Startstufe der Production (3,41): Bei ihr ist das Gebiet breiter als das Telefon. Der Flug richtet sich nicht nach ihr. */
const START_PRODUCTION = 3.4;

async function oeffneListe(page: Page): Promise<void> {
    await page.route("**/api/map-settings", (route) =>
        route.fulfill(json({ startPosition: { x: 518.75, y: 504 }, startZoom: START_PRODUCTION })),
    );
    await stubAdmin(page, { capabilities: RECHTE, role: "editor" });
    await stubs(page);
    await openMap(page, `${EDITOR_MODE}?tab=aenderungen`);
    await page.getByTestId("editor-panel-tab").tap();
    await expect(page.getByTestId("editor-panel")).toBeVisible();
    await expect(page.getByTestId("editorpanel-aenderung").first()).toBeVisible();
}

/** Liegt der Kasten (Karte `aventuria-v1`) ganz im Bild? Das Panel ist weg, die ganze Karte frei. */
const kastenImBild = (page: Page) =>
    page.evaluate((kasten) => {
        const karte = globalThis.avesmapsMap!;
        const rahmen = karte.getCanvas().getBoundingClientRect();
        return [
            { x: kasten[0], y: kasten[1] },
            { x: kasten[2], y: kasten[3] },
        ].map((p) => {
            const bild = karte.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(p));
            return bild.x > 0 && bild.x < rahmen.width && bild.y > 0 && bild.y < rahmen.height;
        });
    }, GEBIET_KASTEN);

test("🔴 Telefon: ⊕ in der Zeile blendet das Panel weg, fliegt zum Gebiet, ‹ Zur Liste bringt das Panel zurück", async ({
    page,
}) => {
    await oeffneListe(page);
    const vorher = await page.evaluate(() => globalThis.avesmapsMap!.getCenter().lng);
    await page.getByTestId("editorpanel-aenderung").nth(1).getByTestId("editorpanel-aenderung-karte-griff").tap();

    await expect(page.getByTestId("editor-panel")).toBeHidden();
    await expect(page.getByTestId("aenderungen-karte-leiste")).toBeVisible();
    await expect(page.getByTestId("aenderungen-karte-heute")).toHaveText("Heutiger Ort");
    // Am Telefon trägt die Leiste den Rückweg statt des ✕, und er führt dorthin, von wo die Karte gerufen wurde: in die Liste.
    await expect(page.getByTestId("aenderungen-karte-zu")).toHaveCount(0);
    await expect(page.getByTestId("aenderungen-karte-zum-detail")).toHaveText("‹ Zur Liste");
    await page.waitForFunction(
        (lng) => globalThis.avesmapsMap?.isMoving() === false && globalThis.avesmapsMap.getCenter().lng !== lng,
        vorher,
        { timeout: 15_000 },
    );
    await settleFrame(page);
    expect(await kastenImBild(page)).toEqual([true, true]);

    await page.getByTestId("aenderungen-karte-zum-detail").tap();
    await expect(page.getByTestId("aenderungen-karte-leiste")).toHaveCount(0);
    await expect(page.getByTestId("editor-panel")).toBeVisible();
    await expect(page.getByTestId("editorpanel-aenderung").first()).toBeVisible();
});

test("🔴 Telefon: ⊕ im Detail blendet das Panel weg; ‹ Zum Detail bringt es mit dem Detail zurück", async ({
    page,
}) => {
    await oeffneListe(page);
    await page.getByTestId("editorpanel-aenderung").nth(1).getByTestId("editorpanel-aenderung-zeile").tap();
    await expect(page.getByTestId("editorpanel-aenderungen-telefon-detail")).toBeVisible();
    await page.getByTestId("editorpanel-aenderung-karte").tap();

    await expect(page.getByTestId("editor-panel")).toBeHidden();
    await expect(page.getByTestId("aenderungen-karte-zum-detail")).toHaveText("‹ Zum Detail");
    await page.getByTestId("aenderungen-karte-zum-detail").tap();
    await expect(page.getByTestId("editor-panel")).toBeVisible();
    await expect(page.getByTestId("editorpanel-aenderungen-telefon-detail")).toBeVisible();
});

test("🔴 Telefon (B9c): Ein Lauf über ganz Aventurien zeigt keinen Kartenrand und fährt auf den größten Ausschnitt innerhalb der Kartengrenzen", async ({
    page,
}) => {
    await oeffneListe(page);
    const vorher = await page.evaluate(() => globalThis.avesmapsMap!.getCenter().lng);
    // Die fünfte Zeile: ein Lauf über 608 Sprachartikel, der Kasten reicht fast über die ganze Karte.
    await page.getByTestId("editorpanel-aenderung").nth(4).getByTestId("editorpanel-aenderung-karte-griff").tap();
    await expect(page.getByTestId("editor-panel")).toBeHidden();
    await page.waitForFunction(
        (lng) => globalThis.avesmapsMap?.isMoving() === false && globalThis.avesmapsMap.getCenter().lng !== lng,
        vorher,
        { timeout: 15_000 },
    );
    await settleFrame(page);
    const { kartenBreite } = await pruefeKeinKartenrand(page);
    // Das Kartenbild füllt die Leinwand ganz (die Karte ist quadratisch, das Telefon höher als breit) und ist nicht größer als nötig: Kein Kartenrand, und kein Zoom darüber hinaus.
    const hoehe = await page.evaluate(() => globalThis.avesmapsMap!.getCanvas().clientHeight);
    expect(kartenBreite).toBeGreaterThanOrEqual(hoehe - 2);
    expect(kartenBreite).toBeLessThanOrEqual(hoehe + 2);
});
