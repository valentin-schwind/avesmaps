import { expect, test, type Page } from "@playwright/test";
import { settleFrame, showPlace } from "./map-handle.ts";
import { FERDOK_LAGE, fenster, oeffneOrtseditor, zeile } from "./ortseditor-stub.ts";

/**
 * Der Fluchtpunkt bleibt in der Bildmitte, die Ziele landen in der freien Fläche (WI-0218). Betreiber 2026-10-17 über die
 * Orchestrierung, auf den Vorschlag „Fluchtpunkt bleibt in der Bildmitte, nur Ziele beim Hinfliegen rücken in die freie Fläche“
 * wörtlich: „ok, aber beachte dass bei angedockten editoren ein klick auf die ziel objekte ebenfalls nicht in der bildmitte erfolgen
 * sollen“.
 *
 * Bis WI-0218 ging die freie Fläche als MapLibres `padding` in die Karte; klappte der angedockte Ortseditor (960 px) auf, rückte in
 * 3D der Fluchtpunkt mit, und die Perspektive verzerrte sich. Die Rechnung selbst prüft `camera-target-centre.test.ts`.
 *
 * Gemessen auf 1920 × 1080, dem Schirm des Betreibers, geneigt um 45°.
 */
test.use({ viewport: { width: 1920, height: 1080 } });

const NEIGUNG = 45;

/** Neigen ohne Flug (Testaufbau). */
async function neige(page: Page, pitch: number): Promise<void> {
    await page.evaluate((grad) => {
        (globalThis.avesmapsMap as unknown as { jumpTo(options: { pitch: number }): void }).jumpTo({ pitch: grad });
    }, pitch);
    await settleFrame(page);
}

/**
 * Wo der Fluchtpunkt der Karte steht: die Bildspalte, auf der die Mitte der Karte und ein Punkt weit voraus in Blickrichtung liegen
 * (Norden oben). Mit `padding` lag beides neben der Bildmitte.
 */
async function fluchtpunkt(page: Page): Promise<{ mitte: number; voraus: number; bildmitte: number; neigung: number }> {
    return page.evaluate(() => {
        const map = globalThis.avesmapsMap as unknown as {
            getCenter(): { lng: number; lat: number };
            getBearing(): number;
            getPitch(): number;
            getCanvas(): HTMLCanvasElement;
            project(lngLat: { lng: number; lat: number }): { x: number; y: number };
        };
        const centre = map.getCenter();
        return {
            mitte: map.project(centre).x,
            voraus: map.project({ lng: centre.lng, lat: centre.lat + 0.5 }).x,
            bildmitte: map.getCanvas().clientWidth / 2,
            neigung: map.getPitch(),
        };
    });
}

/** Wo ein Ort steht und wo die Mitte der Lücke zwischen den Panels liegt (wie `ortseditor-hinflug.spec.ts`). */
async function stand(page: Page, ort: { x: number; y: number }) {
    return page.evaluate((punkt) => {
        const map = globalThis.avesmapsMap!;
        const at = map.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(punkt));
        const canvas = map.getCanvas();
        const karte = canvas.getBoundingClientRect();
        const { top, bottom } = globalThis.avesmapsVisibleArea!.insets();
        const panels = (kante: string) =>
            [...document.querySelectorAll<HTMLElement>(`[data-map-overlay="${kante}"]`)]
                .filter((element) => !element.closest("[inert]") && element.getClientRects().length > 0)
                .map((element) => element.getBoundingClientRect());
        const links = Math.max(0, ...panels("left").map((box) => box.right - karte.left));
        const rechts = Math.min(canvas.clientWidth, ...panels("right").map((box) => box.left - karte.left));
        return {
            ort: { x: at.x, y: at.y },
            luecke: { x: (links + rechts) / 2, y: top + (canvas.clientHeight - top - bottom) / 2 },
        };
    }, ort);
}

test("🔴 klappt der angedockte Ortseditor auf, bleibt der Fluchtpunkt in der Bildmitte (3D)", async ({ page }) => {
    await oeffneOrtseditor(page, { verb: false });
    await showPlace(page, FERDOK_LAGE, 6.5);
    await neige(page, NEIGUNG);
    const vorher = await fluchtpunkt(page);
    expect(vorher.neigung).toBeCloseTo(NEIGUNG, 1);

    await page.getByTestId("editorpanel-verb").click();
    await expect(fenster(page)).toHaveAttribute("data-lage", "angedockt");
    await settleFrame(page);
    const nachher = await fluchtpunkt(page);
    // Die Mitte der Karte und die Blickrichtung stehen in der Bildmitte, vor und nach dem Aufklappen (± 1 px).
    for (const stand of [vorher, nachher]) {
        expect(Math.abs(stand.mitte - stand.bildmitte)).toBeLessThanOrEqual(1);
        expect(Math.abs(stand.voraus - stand.bildmitte)).toBeLessThanOrEqual(1);
    }
    expect(Math.abs(nachher.voraus - vorher.voraus)).toBeLessThanOrEqual(1);
    // Und die Karte stand still: Das Aufklappen bewegt nichts.
    expect(nachher.neigung).toBeCloseTo(NEIGUNG, 1);
});

test("🔴 Doppelklick in der Liste: das Ziel landet geneigt in der Mitte der freien Fläche neben dem Editor", async ({
    page,
}) => {
    await oeffneOrtseditor(page);
    await expect(fenster(page)).toHaveAttribute("data-lage", "angedockt");
    // Weit weg von Ferdok, damit die Kamera fliegen muss.
    await showPlace(page, { x: 700, y: 400 }, 6);
    await neige(page, NEIGUNG);
    await zeile(page, "Ferdok").dblclick();
    await expect(fenster(page).locator(".avm-fenster__titel")).toHaveText("Orte bearbeiten · Ferdok");
    await page.waitForFunction(() => !globalThis.avesmapsMap!.isMoving());
    await settleFrame(page);
    const jetzt = await stand(page, FERDOK_LAGE);
    expect(Math.abs(jetzt.ort.x - jetzt.luecke.x)).toBeLessThanOrEqual(8);
    expect(Math.abs(jetzt.ort.y - jetzt.luecke.y)).toBeLessThanOrEqual(8);
    // Geneigt geblieben, und der Fluchtpunkt steht weiter in der Bildmitte.
    const danach = await fluchtpunkt(page);
    expect(danach.neigung).toBeCloseTo(NEIGUNG, 1);
    expect(Math.abs(danach.voraus - danach.bildmitte)).toBeLessThanOrEqual(1);
});
