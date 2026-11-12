import { expect, test, type Page } from "@playwright/test";
import { EDITOR_MODE, GARETH, openMap, settleFrame, showPlace } from "./map-handle.ts";
import { editorPanelGemerktZu } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Der gelbe Kreis um den gewählten Ort (WI-0194, EDIT-0003 T33 (2)). Betreiber 2026-10-16: „Ein gelber Kreis um selektierte Orte wäre
 * analog zur dicken Markierung bei Wegen angemessen (auch im Frontend). Manche Orte sind einfach sehr klein aus der Entfernung, wär gut,
 * wenn man sieht, dass/wann man einen selektiert hat.“ Wie er gebaut ist (Gold und Deckkraft der Wegauswahl, Radius je Band), prüft
 * `apps/web/test/place-layers.test.ts`; hier, dass er an der echten Karte am gewählten Ort steht und mit der Auswahl geht.
 */

test.use({ viewport: { width: 1920, height: 1080 } });

async function klickeGareth(page: Page): Promise<void> {
    await showPlace(page, GARETH, 5);
    const box = await page.getByTestId("map").boundingBox();
    const at = await page.evaluate(
        (target) => globalThis.avesmapsMap!.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(target)),
        GARETH,
    );
    await page.mouse.click((box?.x ?? 0) + at.x, (box?.y ?? 0) + at.y);
    await expect(page.getByTestId("info-title")).toHaveText("Gareth");
}

/** Die Namen der Orte, um die der Kreis gerade gezeichnet ist. */
const imKreis = (page: Page) =>
    page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        if (map.getLayer("place-selection") === undefined) return [];
        return map
            .queryRenderedFeatures({ layers: ["place-selection"] })
            .map((feature) => String(feature.properties["name"]));
    });

for (const wer of ["Besucher", "Editor"] as const) {
    test(`🔴 ${wer}: der gewählte Ort trägt den gelben Kreis, und er geht mit der Auswahl`, async ({ page }) => {
        if (wer === "Editor") {
            await stubAdmin(page, { capabilities: ["use_editor_menu", "pin_selection"], role: "editor" });
            await editorPanelGemerktZu(page);
        }
        await openMap(page, wer === "Editor" ? EDITOR_MODE : undefined);
        expect(await imKreis(page)).toEqual([]);
        await klickeGareth(page);
        await expect.poll(() => imKreis(page)).toEqual(["Gareth"]);
        // Er liegt unter der Marke: Die Marke des Orts bleibt obenauf und anklickbar.
        const reihenfolge = await page.evaluate(() => {
            const ids = globalThis.avesmapsMap!.getStyle().layers.map((layer) => layer.id);
            return { kreis: ids.indexOf("place-selection"), marke: ids.indexOf("place-marker") };
        });
        expect(reihenfolge.kreis).toBeGreaterThanOrEqual(0);
        expect(reihenfolge.kreis).toBeLessThan(reihenfolge.marke);
        await page.keyboard.press("Escape");
        if (wer === "Editor") await page.keyboard.press("Escape");
        await settleFrame(page);
        await expect.poll(() => imKreis(page)).toEqual([]);
    });
}
