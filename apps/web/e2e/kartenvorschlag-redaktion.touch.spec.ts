import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { stubBenachrichtigungen } from "./benachrichtigungen-stub.ts";
import { AUFNAHMEN, REDAKTION, datei, kennung, link, server } from "./kartenvorschlag-redaktion-stub.ts";
import { EDITOR_MODE, openMap } from "./map-handle.ts";
import { stubSitzung } from "./medien-quelle.ts";

/**
 * Die Redaktion der Kartenvorschläge am Telefon (WI-0275): Das Fenster liegt auf dem Panel, nicht dahinter (`community-redaktion.vue`); die Unterreiter laufen nicht über, die Blätter bleiben bedienbar. Der alte
 * Tiefe Link `?tab=kartenvorschlaege` führt seit WI-0305 auf die Meldungen, wo die Vorschläge stehen.
 */

test("🔴 Telefon: Das Fenster liegt obenauf und bleibt im Bild, das Blatt ist bedienbar, nach dem Schließen ist die Liste wieder da", async ({
    page,
}) => {
    await stubSitzung(page, REDAKTION);
    await stubBenachrichtigungen(page, []);
    await server(page, [datei({ ort: null }), link()]);
    await openMap(page, `${EDITOR_MODE}?tab=kartenvorschlaege`);
    await page.getByTestId("editor-panel-tab").tap();

    const zeile = page.getByTestId(`community-karte-zeile-${kennung(1)}`);
    await expect(zeile).toBeVisible();
    const unterreiter = await page
        .getByTestId("community-unterreiter")
        .evaluate((el) => ({ innen: el.scrollWidth, aussen: el.clientWidth }));
    expect(unterreiter.innen, "die Mulde läuft nicht über").toBeLessThanOrEqual(unterreiter.aussen);
    await expect(page.getByTestId("community-meldungen")).toBeVisible();
    const segment = await page
        .getByTestId("community-segmente-erledigt")
        .locator(".einzeilig")
        .evaluate((el) => ({ innen: el.scrollWidth, aussen: el.clientWidth }));
    expect(segment.innen, "„Erledigt“ steht ganz da").toBeLessThanOrEqual(segment.aussen);
    if (AUFNAHMEN !== undefined) await page.screenshot({ path: join(AUFNAHMEN, "karten-telefon-liste.png") });

    await zeile.tap();
    const fenster = page.getByTestId("community-karte-fenster");
    await expect(fenster).toBeVisible();
    const annehmen = page.getByTestId("community-karte-annehmen");
    await expect(annehmen).toBeVisible();
    const obenauf = await annehmen.evaluate((knopf) => {
        const { x, y, width, height } = knopf.getBoundingClientRect();
        return document.elementFromPoint(x + width / 2, y + height / 2)?.closest("button") === knopf;
    });
    expect(obenauf, "der Knopf des Fensters liegt obenauf").toBe(true);
    const breite = page.viewportSize()?.width ?? 0;
    const box = await fenster.boundingBox();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 9999)).toBeLessThanOrEqual(breite);
    if (AUFNAHMEN !== undefined) await page.screenshot({ path: join(AUFNAHMEN, "karten-telefon-fenster.png") });

    await annehmen.tap();
    await expect(page.getByTestId("community-karte-blatt-annehmen")).toBeVisible();
    await expect(page.getByTestId("community-karte-ohne-ort")).toBeVisible();
    const senden = page.getByTestId("community-karte-annehmen-senden");
    await senden.scrollIntoViewIfNeeded();
    await expect(senden).toBeInViewport();
    if (AUFNAHMEN !== undefined) await page.screenshot({ path: join(AUFNAHMEN, "karten-telefon-blatt.png") });

    await page.getByTestId("community-karte-blatt-abbrechen").tap();
    await expect(page.getByTestId("community-karte-fuss")).toBeVisible();
});
