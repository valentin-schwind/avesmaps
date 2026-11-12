import { expect, test, type Page } from "@playwright/test";
import { stubReisebilder, stubReisebilderKarte, type KartenBild } from "./reisebild-stub.ts";
import { GARETH, openMap, showPlace } from "./map-handle.ts";

/**
 * Die Bildansicht der Reisebilder mit Nennung (WI-0272 S4, Aufgabe 30): ein Klick auf eine Kachel öffnet das Bild groß, die Zeile darunter ist so breit wie das Bild, „Zur Stelle“ und „Melden“, Esc.
 * Der Lesepfad ist eine Attrappe (`reisebild-stub.ts`); das Telefon prüft `reisebild-ansicht.touch.spec.ts`; die Texte der Zeile prüft `test/reisebild-ansicht.test.ts`.
 *
 * Problemfälle: der Nennungsblock ist breiter oder schmaler als das Bild (Hochformat, kleiner Schirm); ‹ › blättern nicht im Kreis oder die Zahl stimmt nicht; „Zur Stelle“ springt die Kamera, lässt
 * den Ring weg oder die Kachel unmarkiert; „Melden“ öffnet ein Formular ohne die Stelle; Esc schließt auch die Leiste; die Bildansicht der Infobox und der Medienverwaltung ändert sich.
 */

const ID = (n: number): string => `00000000-0000-4000-8000-0000000003${String(n).padStart(2, "0")}`;
const bild = (n: number, dx: number, dy: number, mehr: Partial<KartenBild> = {}): KartenBild => ({
    id: ID(n),
    lage: { x: GARETH.x + dx, y: GARETH.y + dy },
    ...mehr,
});

async function aufbau(page: Page, bilder: KartenBild[]): Promise<void> {
    await stubReisebilder(page);
    await stubReisebilderKarte(page, bilder);
    await openMap(page);
    await showPlace(page, { x: GARETH.x + 40, y: GARETH.y + 25 }, 7);
    await expect(page.getByTestId("reisebilder-knopf")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("reisebilder-knopf").click();
    await expect(page.getByTestId("reisebilder-leiste")).toBeVisible();
    await expect.poll(() => page.getByTestId("reisebild-kachel").count(), { timeout: 15_000 }).toBe(bilder.length);
}

const ansicht = (page: Page) => page.getByTestId("reisebild-ansicht");

test("🔴 Klick auf eine Kachel öffnet das Bild groß; ‹ › und Pfeiltasten blättern im Kreis; der Nennungsblock ist so breit wie das Bild, auch im Hochformat", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await aufbau(page, [
        bild(1, 40, 25, { name: "Rahja", beschreibung: "Erstes Bild" }),
        bild(2, 40.3, 25, { hochformat: true, beschreibung: "Zweites Bild, hoch" }),
        bild(3, 40.6, 25, { entstehung: "ai_generated", beschreibung: "Drittes Bild" }),
    ]);
    // Die Kacheln stehen von West nach Ost: die erste ist das erste Bild.
    await page.getByTestId("reisebild-kachel").first().click();
    await expect(ansicht(page)).toBeVisible();
    await expect(page.getByTestId("reisebild-titel")).toHaveText("Erstes Bild");
    await expect(page.getByTestId("reisebild-stand")).toHaveText("1 von 3");
    await expect(page.getByTestId("reisebild-nennung")).toHaveText("Bild von Rahja");

    const passt = async (): Promise<void> => {
        await expect(page.getByTestId("bildansicht-bild")).toBeVisible();
        const bildBox = (await page.getByTestId("bildansicht-bild").boundingBox())!;
        const zeileBox = (await page.getByTestId("bildansicht-zeile").boundingBox())!;
        expect(Math.abs(zeileBox.width - bildBox.width)).toBeLessThanOrEqual(1);
        // Ohne Lücke: die Zeile beginnt am Bild (höchstens ein paar Bildpunkte Abstand durch Rundung).
        expect(zeileBox.y - (bildBox.y + bildBox.height)).toBeLessThanOrEqual(3);
    };
    await passt();

    await page.getByTestId("bildansicht-weiter").click();
    await expect(page.getByTestId("reisebild-stand")).toHaveText("2 von 3");
    await expect(page.getByTestId("reisebild-nennung")).toHaveText("Bild von anonym");
    await passt();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("reisebild-stand")).toHaveText("3 von 3");
    await expect(page.getByTestId("reisebild-mehr")).toContainText("KI-generiert");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("reisebild-stand")).toHaveText("1 von 3");
    await page.getByTestId("bildansicht-vorher").click();
    await expect(page.getByTestId("reisebild-stand")).toHaveText("3 von 3");

    // Esc schließt nur die Ansicht, die Leiste bleibt offen.
    await page.keyboard.press("Escape");
    await expect(ansicht(page)).toBeHidden();
    await expect(page.getByTestId("reisebilder-leiste")).toBeVisible();
});

test("🔴 „Zur Stelle“: die Ansicht geht zu, die Kamera fliegt, der Ring steht, die Kachel ist markiert", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await aufbau(page, [bild(1, 40, 25)]);
    await page.getByTestId("reisebild-kachel").first().click();
    await expect(ansicht(page)).toBeVisible();
    // Die Karte steht weit weg, damit die Kamera fahren muss.
    await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        map.jumpTo({
            center: map.unproject([map.getCanvas().clientWidth / 2 + 220, map.getCanvas().clientHeight / 2]),
        });
    });
    await page.getByTestId("reisebild-zur-stelle").click();
    await expect(ansicht(page)).toBeHidden();
    await expect(page.getByTestId("reisebild-kachel").first()).toHaveClass(/is-markiert/);
    // Geflogen, nicht gesprungen: Die Karte bewegt sich eine Weile und kommt an.
    await expect.poll(() => page.evaluate(() => globalThis.avesmapsMap!.isMoving()), { timeout: 5_000 }).toBe(true);
    await expect.poll(() => page.evaluate(() => globalThis.avesmapsMap!.isMoving()), { timeout: 15_000 }).toBe(false);
    // Der Ring (Puls) steht an der Gruppe.
    await expect
        .poll(
            () =>
                page.evaluate(() => {
                    const map = globalThis.avesmapsMap!;
                    const m = map.querySourceFeatures("photobox-bilder")[0];
                    if (m === undefined) return false;
                    const stand = (
                        map as unknown as {
                            getFeatureState: (f: { source: string; id: string }) => Record<string, unknown>;
                        }
                    ).getFeatureState({ source: "photobox-bilder", id: String(m.properties["schluessel"]) });
                    return stand["puls"] === true || stand["hervor"] === true;
                }),
            { timeout: 8_000 },
        )
        .toBe(true);
});

test("„Melden“: das Meldeformular öffnet mit der Stelle des Bildes, die Ansicht geht zu", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await aufbau(page, [bild(1, 40, 25)]);
    await page.getByTestId("reisebild-kachel").first().click();
    await expect(ansicht(page)).toBeVisible();
    await page.getByTestId("reisebild-melden").click();
    await expect(ansicht(page)).toBeHidden();
    await expect(page.getByTestId("community-besucher")).toBeVisible({ timeout: 15_000 });
});

test("Die Lizenz steht als Link nur bei CC BY", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await aufbau(page, [
        bild(1, 40, 25, { lizenz: { name: "CC BY 4.0", uri: "https://creativecommons.org/licenses/by/4.0/" } }),
        bild(2, 40.3, 25),
    ]);
    await page.getByTestId("reisebild-kachel").first().click();
    const link = page.getByTestId("reisebild-lizenz");
    await expect(link).toHaveAttribute("href", "https://creativecommons.org/licenses/by/4.0/");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
    await page.getByTestId("bildansicht-weiter").click();
    await expect(page.getByTestId("reisebild-lizenz")).toHaveCount(0);
});
