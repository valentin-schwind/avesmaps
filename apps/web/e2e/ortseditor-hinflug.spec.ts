import { expect, test, type Page } from "@playwright/test";
import { chooseView, clickMap, settleFrame, showPlace } from "./map-handle.ts";
import { FERDOK_LAGE, GRATENFELS_LAGE, fenster, langeListe, oeffneOrtseditor, zeile } from "./ortseditor-stub.ts";

/**
 * Hinflug und Auswahl am echten Stack (WI-0128 E7, EDIT-0001 §4.5, T7.1 bis T7.10): Der Einfachklick wählt ohne Kamera, Doppelklick
 * und Verb fliegen in die freie Fläche, wie sie NACH der Landung ist (W5), das Verb öffnet erst nach dem Flug; ein Klick auf einen Ort
 * der Karte wählt ihn in der Liste. Die Rechnung selbst prüft `ortseditor-hinflug.test.ts`.
 *
 * 🪤 Gemessen auf 1920 × 1080, dem Schirm des Betreibers. Bei 1280 px decken im Editor-Modus der Planer links (350 px) und der angedockte
 * Ortseditor (960 px) die ganze Karte; dann zielt die Kamera wie ohne Angabe (Vitest „bleibt nichts frei“). Erwartet wird die Mitte der
 * Lücke zwischen den Panels, gemessen an ihnen, nicht die Mitte des Bezugs (`insets`, bis WI-0218 MapLibres `padding`): Schmale
 * Panels sind dort Seitenleisten und fehlen im Bezug, freigehalten werden sie trotzdem (`keepFree`).
 */
test.use({ viewport: { width: 1920, height: 1080 } });

type Punkt = { x: number; y: number };

/** Weit weg von Gratenfels und Ferdok (rund 250 Einheiten östlich): Von dort muss die Kamera fliegen. */
const FERNE: Punkt = { x: 700, y: 400 };

/**
 * Wo ein Ort gerade auf der Karte steht (Kartenpixel), dazu die Mitte der Lücke links vom angedockten Ortseditor, falls einer steht,
 * sonst die Mitte der Fläche der Kamera.
 */
async function stand(page: Page, ort: Punkt) {
    return page.evaluate((punkt) => {
        const map = globalThis.avesmapsMap!;
        const at = map.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(punkt));
        const canvas = map.getCanvas();
        const karte = canvas.getBoundingClientRect();
        const { top, bottom } = globalThis.avesmapsVisibleArea!.insets();
        // Die Panels, die sich bei der Kamera melden, wie `measureOverlays`: sichtbar und nicht zugeklappt.
        const panels = (kante: string) =>
            [...document.querySelectorAll<HTMLElement>(`[data-map-overlay="${kante}"]`)]
                .filter((element) => !element.closest("[inert]") && element.getClientRects().length > 0)
                .map((element) => element.getBoundingClientRect());
        const left = Math.max(0, ...panels("left").map((box) => box.right - karte.left));
        const rechts = Math.min(canvas.clientWidth, ...panels("right").map((box) => box.left - karte.left));
        return {
            ort: { x: at.x, y: at.y },
            luecke: { x: (left + rechts) / 2, y: top + (canvas.clientHeight - top - bottom) / 2, rechts },
            karteLinks: karte.left,
            center: map.getCenter(),
            zoom: map.getZoom(),
            faehrt: map.isMoving(),
        };
    }, ort);
}

/** Legt einen Ort ohne Flug (Testaufbau) in die Mitte der Lücke zwischen den Panels, auf diesen Zoom. */
async function inDieLuecke(page: Page, ort: Punkt, zoom: number): Promise<void> {
    await page.evaluate(
        ({ punkt, stufe }) => {
            globalThis.avesmapsMap!.jumpTo({
                center: globalThis.avesmapsRenderProjection!.toRenderLngLat(punkt),
                zoom: stufe,
            });
        },
        { punkt: ort, stufe: zoom },
    );
    const { ort: ist, luecke } = await stand(page, ort);
    await page.evaluate(
        ({ dx, dy }) => {
            const map = globalThis.avesmapsMap!;
            const mitte = map.project(map.getCenter());
            map.jumpTo({ center: map.unproject([mitte.x - dx, mitte.y - dy]) });
        },
        { dx: luecke.x - ist.x, dy: luecke.y - ist.y },
    );
    await settleFrame(page);
}

/** Merkt die nächste Fahrt: ihre Dauer und ob bei ihrem Ende schon ein Ortseditor offen war. */
async function beobachteFlug(page: Page): Promise<void> {
    await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const flug: { start?: number; ende?: number; fensterAmEnde?: number } = {};
        (globalThis as unknown as { flug: typeof flug }).flug = flug;
        map.once("movestart", () => {
            flug.start = performance.now();
        });
        map.once("moveend", () => {
            flug.ende = performance.now();
            flug.fensterAmEnde = document.querySelectorAll(
                'dialog[data-lage][open][data-testid^="ortseditor-"]',
            ).length;
        });
    });
}
const flug = (page: Page) =>
    page.evaluate(
        () => (globalThis as unknown as { flug: { start?: number; ende?: number; fensterAmEnde?: number } }).flug,
    );
const gelandet = (page: Page) => page.waitForFunction(() => !globalThis.avesmapsMap!.isMoving());

/** Einen Ort wählen und das Fenster schließen: Die Auswahl bleibt, das Verb öffnet sie danach. */
async function waehleUndSchliesse(page: Page, name: string): Promise<void> {
    await zeile(page, name).click();
    await fenster(page).getByTestId("fenster-schliessen").click();
    await expect(fenster(page)).toHaveCount(0);
}

test("🔴 T7.2, T7.4: das Verb fliegt, öffnet erst am Ende des Flugs, und der Ort liegt danach in der Mitte der freien Fläche", async ({
    page,
}) => {
    await oeffneOrtseditor(page);
    await waehleUndSchliesse(page, "Gratenfels");
    await showPlace(page, FERNE, 6);
    await beobachteFlug(page);
    await page.getByTestId("editorpanel-verb").click();
    await expect(fenster(page)).toHaveCount(1);
    // Ein Flug, kein Sprung, und bei seinem Ende war der Ortseditor noch nicht da.
    const gemessen = await flug(page);
    expect((gemessen.ende ?? 0) - (gemessen.start ?? 0)).toBeGreaterThan(300);
    expect(gemessen.fensterAmEnde).toBe(0);
    await expect(fenster(page)).toHaveAttribute("data-lage", "angedockt");
    await settleFrame(page);
    // W5: Der Ort liegt NACH dem Öffnen in der Mitte der freien Fläche, nicht unter dem Fenster (± 8 px).
    const jetzt = await stand(page, GRATENFELS_LAGE);
    expect(Math.abs(jetzt.ort.x - jetzt.luecke.x)).toBeLessThanOrEqual(8);
    expect(Math.abs(jetzt.ort.y - jetzt.luecke.y)).toBeLessThanOrEqual(8);
    expect(jetzt.ort.x).toBeLessThan(jetzt.luecke.rechts);
});

test("🔴 T7.1: der Einfachklick wählt ohne Kamera; T7.3: liegt der Ort schon frei, fliegt auch der Doppelklick nicht", async ({
    page,
}) => {
    await oeffneOrtseditor(page);
    await expect(fenster(page)).toHaveAttribute("data-lage", "angedockt");
    await inDieLuecke(page, GRATENFELS_LAGE, 7.5);
    const vorher = await stand(page, GRATENFELS_LAGE);

    await zeile(page, "Ferdok").click();
    await zeile(page, "Gratenfels").click();
    await expect(fenster(page).locator(".avm-fenster__titel")).toHaveText("Orte bearbeiten · Gratenfels");
    await zeile(page, "Gratenfels").dblclick();
    await settleFrame(page);
    const nachher = await stand(page, GRATENFELS_LAGE);
    expect(nachher.faehrt).toBe(false);
    expect(nachher.center).toEqual(vorher.center);
    expect(nachher.zoom).toBe(vorher.zoom);
    // Gewählt ist er trotzdem, auf der Karte wie in der Liste.
    await expect(zeile(page, "Gratenfels")).toHaveAttribute("aria-selected", "true");
    expect((await page.evaluate(() => globalThis.avesmapsSelectedPlace?.()))?.name).toBe("Gratenfels");
});

test("🔴 Doppelklick aus dem Ortseditor: Flug, die Auswahl wechselt, das Fenster bleibt; T7.7: ein Ort ohne Lage fliegt nicht", async ({
    page,
}) => {
    await oeffneOrtseditor(page);
    await zeile(page, "Gratenfels").click();
    await showPlace(page, FERNE, 6);
    await beobachteFlug(page);
    await zeile(page, "Ferdok").dblclick();
    await expect(fenster(page).locator(".avm-fenster__titel")).toHaveText("Orte bearbeiten · Ferdok");
    await gelandet(page);
    const gemessen = await flug(page);
    expect((gemessen.ende ?? 0) - (gemessen.start ?? 0)).toBeGreaterThan(300);
    // Das Fenster blieb die ganze Zeit offen.
    expect(gemessen.fensterAmEnde).toBe(1);
    const jetzt = await stand(page, FERDOK_LAGE);
    expect(Math.abs(jetzt.ort.x - jetzt.luecke.x)).toBeLessThanOrEqual(8);
    expect(Math.abs(jetzt.ort.y - jetzt.luecke.y)).toBeLessThanOrEqual(8);

    // Die Lage ist wie bei Legacy auf „außerorts + unklar“ vorbelegt; die Stätte liegt innerorts und kommt erst mit „innerorts“.
    await expect(zeile(page, "Albenhuser Tor")).toHaveCount(0);
    await fenster(page).locator('[data-testid$="-orte-filter"]').click();
    await page.locator('[data-testid$="-orte-filter-lage-innerorts"]').click();
    await page.keyboard.press("Escape");
    await zeile(page, "Albenhuser Tor").dblclick();
    await expect(fenster(page).locator('[data-testid$="-status"]')).toContainText("keine Lage");
    await settleFrame(page);
    expect((await stand(page, FERDOK_LAGE)).center).toEqual(jetzt.center);
});

test("🔴 EDIT-0003 T32 (1): der Doppelklick stellt die Karte mit dem Flug auf Standard, der Einfachklick nicht", async ({
    page,
}) => {
    // Betreiber 2026-10-16: „Doppelklick auf einen Eintrag in den Listen … sollte nicht nur an die Stelle, sondern auch auf die
    // Ansicht wechseln. … Wege und Orte -> Standard“. In den Kraftlinien stehen keine Orte (`composeView`).
    // 🪤 Die Antwort zum Ort bleibt aus: Sie stellt die Ansicht sonst ohnehin auf Standard, bei jedem Klick in der Liste
    // (`presentationFromDetail`, der Ortseditor öffnet als `link`) - dann zeigte dieser Fall nicht, dass der FLUG umstellt.
    await page.route("**/api/subjects/place/**", (route) => route.abort());
    // 🪤 Seit 69ebebeef (WI-0212, F17) folgt die Kachel in „Karteninhalte“ der Ansicht: In den Kraftlinien öffnet das Verb den
    // Kraftlinieneditor. Der Ortseditor geht darum in Standard auf, danach stellt der Fächer die Karte auf Kraftlinien; das offene
    // Fenster bleibt.
    await oeffneOrtseditor(page);
    await expect(fenster(page)).toHaveAttribute("data-lage", "angedockt");
    await chooseView(page, "powerlines");
    const kachel = page.getByTestId("fan-toggle");
    await expect(kachel).toHaveAttribute("title", /Kraftlinien/);
    await zeile(page, "Gratenfels").click();
    await expect(fenster(page).locator(".avm-fenster__titel")).toHaveText("Orte bearbeiten · Gratenfels");
    await expect(kachel).toHaveAttribute("title", /Kraftlinien/);
    await showPlace(page, FERNE, 6);
    await zeile(page, "Ferdok").dblclick();
    await expect(kachel).toHaveAttribute("title", /Standard/);
    await gelandet(page);
    const jetzt = await stand(page, FERDOK_LAGE);
    expect(Math.abs(jetzt.ort.x - jetzt.luecke.x)).toBeLessThanOrEqual(8);
});

test("🔴 T7.8: bei „Bewegung reduzieren“ springt die Kamera, und das Verb öffnet sofort", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await oeffneOrtseditor(page);
    await waehleUndSchliesse(page, "Gratenfels");
    await showPlace(page, FERNE, 6);
    await beobachteFlug(page);
    await page.getByTestId("editorpanel-verb").click();
    await expect(fenster(page)).toHaveCount(1);
    const gemessen = await flug(page);
    expect((gemessen.ende ?? 0) - (gemessen.start ?? 0)).toBeLessThan(50);
    await expect(fenster(page)).toHaveAttribute("data-lage", "angedockt");
    await settleFrame(page);
    const jetzt = await stand(page, GRATENFELS_LAGE);
    expect(Math.abs(jetzt.ort.x - jetzt.luecke.x)).toBeLessThanOrEqual(8);
    expect(Math.abs(jetzt.ort.y - jetzt.luecke.y)).toBeLessThanOrEqual(8);
});

test("🔴 T7.9: gelöst zielt der Flug in die größere Lücke neben dem Fenster, ohne das Panel", async ({ page }) => {
    // Das gelöste Fenster steht links; rechts von ihm bleibt bis zum Editorpanel die größere Lücke.
    await page.addInitScript(() => {
        localStorage.setItem(
            "avesmaps3d.fenster.ortseditor",
            JSON.stringify({ lage: "geloest", box: { left: 40, top: 120, width: 560, height: 420 } }),
        );
    });
    await oeffneOrtseditor(page);
    await expect(fenster(page)).toHaveAttribute("data-lage", "geloest");
    await showPlace(page, FERNE, 6);
    await zeile(page, "Gratenfels").dblclick();
    await gelandet(page);
    await settleFrame(page);
    const jetzt = await stand(page, GRATENFELS_LAGE);
    const box = (await fenster(page).boundingBox())!;
    const panel = (await page.getByTestId("editor-panel").boundingBox())!;
    const luecke = (box.x + box.width + panel.x) / 2 - jetzt.karteLinks;
    expect(Math.abs(jetzt.ort.x - luecke)).toBeLessThanOrEqual(8);
    expect(Math.abs(jetzt.ort.y - jetzt.luecke.y)).toBeLessThanOrEqual(8);
});

test("🔴 T7.10: ein Klick auf einen Ort der Karte wählt ihn in der Liste und rollt sie dorthin; die Seite steht", async ({
    page,
}) => {
    await oeffneOrtseditor(page, { liste: langeListe() });
    await expect(fenster(page)).toHaveAttribute("data-lage", "angedockt");
    await expect(zeile(page, "Gratenfels")).toHaveCount(0);
    await inDieLuecke(page, GRATENFELS_LAGE, 7.5);
    await clickMap(page, (await stand(page, GRATENFELS_LAGE)).ort);
    await expect(zeile(page, "Gratenfels")).toHaveAttribute("aria-selected", "true");
    await expect(zeile(page, "Gratenfels")).toBeInViewport();
    // Und er steht in den Ortseigenschaften (Betreiber 2026-10-11), wie nach einem Klick in der Liste.
    await expect(fenster(page).locator(".avm-fenster__titel")).toHaveText("Orte bearbeiten · Gratenfels");
    // Gerollt hat nur die Liste, nie die Seite; der Ortseditor bleibt vorn.
    expect(
        await page.evaluate(() => [window.scrollX, window.scrollY, document.scrollingElement?.scrollTop ?? 0]),
    ).toEqual([0, 0, 0]);
    await expect(fenster(page)).toHaveAttribute("data-lage", "angedockt");
});
