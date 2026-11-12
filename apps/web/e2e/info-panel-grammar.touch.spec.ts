import { expect, test, type Page } from "@playwright/test";
import { MEDIA_PUBLIC_URL_PATTERN } from "@avesmaps3d/shared";
import { expectActionBandShape } from "./aktionsband.ts";

/**
 * Die Gestalt des Infopanels am Telefon (WI-0063 P6; Legacy: Panel in voller Höhe, `min(400 px, 100vw − 24 px)`, ✕ 26 × 26 oben rechts,
 * kein Bottom Sheet): Bild, Kopf, Aktionsband und Feldliste in einer schmalen Spalte, jede Kachel ein Fingerziel.
 */

async function openGareth(page: Page): Promise<void> {
    await page.goto("/?siedlung=Gareth");
    await expect(page.getByTestId("info-title")).toHaveText("Gareth", { timeout: 30_000 });
    await expect(page.getByTestId("info-panel")).toBeVisible();
    // Die Fahrt des Panels (0,22 s) abwarten.
    await expect
        .poll(async () => Math.round((await page.getByTestId("info-panel").boundingBox())?.width ?? 0))
        .toBeGreaterThan(300);
}

test("🔴 Kopf und Bild laufen von Kante zu Kante, 16:9; das ✕ steht oben rechts auf dem Bild", async ({ page }) => {
    await openGareth(page);
    const panel = await page.getByTestId("info-panel").boundingBox();
    const media = await page.getByTestId("info-media").boundingBox();
    expect(Math.round(media?.width ?? 0)).toBe(Math.round(panel?.width ?? 1));
    expect(Math.round(((media?.width ?? 0) / (media?.height ?? 1)) * 100)).toBe(178);
    // 🔴 Seit dem Medienzug hat Gareth EIGENE Bilder; die Grafik der Ortsgröße ist nur noch der Rückfall ohne eigenes Bild.
    await expect(page.getByTestId("info-header-image")).toHaveAttribute("src", new RegExp(MEDIA_PUBLIC_URL_PATTERN));
    const close = await page.getByTestId("info-panel-close").boundingBox();
    expect([Math.round(close?.width ?? 0), Math.round(close?.height ?? 0)]).toEqual([26, 26]);
    // Das ✕ liegt im Bildbereich, rechts oben.
    expect(close?.y ?? 99).toBeLessThan((media?.y ?? 0) + 20);
    expect((close?.x ?? 0) + (close?.width ?? 0)).toBeGreaterThan((panel?.x ?? 0) + (panel?.width ?? 0) - 20);
    await expect(page.getByTestId("info-title")).toBeVisible();
});

test("🔴 das Aktionsband steht in gleich breiten Spalten, jede Kachel ist ein Fingerziel", async ({ page }) => {
    await openGareth(page);
    // Die Zahl der Spalten folgt der Entscheidung vom 2026-10-06 und steht in `aktionsband.ts`, nicht hier.
    await expectActionBandShape(page);
    for (const id of ["addDestination", "share"]) {
        const box = await page.getByTestId(`info-action-${id}`).boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(60);
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    }
    // „Änderungen vorschlagen“ öffnet seit WI-0268 C2 das Meldeformular: kein gesperrter Knopf, keine Erklärung als Zeile.
    await expect(page.getByTestId("info-action-suggest")).toBeEnabled();
    await expect(page.getByTestId("info-actions-note")).toHaveCount(0);
});

test("🔴 die Feldliste behält ihre Tabellenform auch am Telefon: Beschriftung 96 px, der Wert bricht in seiner Spalte um", async ({
    page,
}) => {
    await openGareth(page);
    const row = page.getByTestId("info-fact").first();
    const columns = await row.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" "));
    expect(columns[0]).toBe("96px");
    // Nichts ragt über den Rand des Panels hinaus: kein waagerechtes Scrollen.
    const overflow = await page
        .locator(".info-panel__body")
        .evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
});

test("🔴 „Reiseziel hinzufügen“ legt den Wegpunkt an; Panel und Planer schließen einander aus", async ({ page }) => {
    await openGareth(page);
    await page.getByTestId("info-action-addDestination").tap();
    await expect(page.getByTestId("info-action-removeDestination")).toBeVisible();
    // Am Telefon geht der Planer nicht von selbst auf: Das Panel bleibt, die Reise steht.
    await expect(page.getByTestId("info-panel")).toBeVisible();
    await page.getByTestId("info-action-removeDestination").tap();
    await expect(page.getByTestId("info-action-addDestination")).toBeVisible();
});

test("🔴 „Link teilen“ meldet die Adresse in der Meldung, auch wenn die Zwischenablage nicht mitspielt", async ({
    page,
}) => {
    await openGareth(page);
    await page.getByTestId("info-action-share").tap();
    await expect(page.getByTestId("toast")).toContainText("?siedlung=Gareth");
});

test("🔴 das ✕ klappt das Panel ein; im Quellenkasten klappt ein Reiter die Liste beim Antippen auf", async ({
    page,
}) => {
    await openGareth(page);
    const box = page.getByTestId("info-source");
    await box.scrollIntoViewIfNeeded();
    // Die Reiter stehen ohne Antippen da; der Reiter klappt seine Liste auf, ein zweites Antippen wieder zu.
    const tab = box.getByTestId("info-sources-tab-described");
    await tab.tap();
    await expect(box.getByTestId("info-sources-list")).toBeVisible();
    const sheet = await box.boundingBox();
    const panel = await page.getByTestId("info-panel").boundingBox();
    // Die Liste passt in die schmale Spalte: Der Kasten läuft nicht über das Panel hinaus.
    expect((sheet?.x ?? 0) + (sheet?.width ?? 0)).toBeLessThanOrEqual((panel?.x ?? 0) + (panel?.width ?? 0) + 1);
    await tab.tap();
    await expect(box.getByTestId("info-sources-list")).toHaveCount(0);
    await page.getByTestId("info-panel-close").tap();
    await expect(page.getByTestId("info-panel")).toBeHidden();
});
