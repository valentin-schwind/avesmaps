import { expect, test, type Page } from "@playwright/test";
import { stubReisebilder } from "./reisebild-stub.ts";
import { chooseView, freeSpot, GARETH, openMap, showPlace } from "./map-handle.ts";

/**
 * „Eigenes Bild hinzufügen“ im Kartenmenü, das gelbe Platzhaltersymbol auf der Karte und die Linie vom Fensterkopf zur Stelle (WI-0272 S2b, Aufgabe 12).
 * Das Formular selbst prüft `reisebild-einreichen.spec.ts`, der Server ist eine Attrappe (`reisebild-stub.ts`).
 *
 * Problemfälle: der Eintrag steht auch in den anderen Ansichten; das Fenster steht nicht in der Mitte oder deckt die Stelle (die Kamera fliegt sie neben das Fenster, Entwurf 8); die Linie beginnt nicht
 * am Kopf des Fensters, folgt der Karte nicht oder bleibt, wenn das Fenster zugeht; das Symbol bleibt auf der Karte stehen; „Stelle ändern“ setzt die Stelle nicht oder lässt Esc die alte verlieren.
 */

/** Die Lage eines Punktes der Seite auf der Karte (Länge, Breite). Die Kamera fliegt die Stelle des Formulars neben das Fenster; was bleibt, ist ihre Lage auf der Karte, nicht ihr Platz auf dem Bildschirm. */
async function kartenLage(page: Page, bei: { x: number; y: number }): Promise<{ lng: number; lat: number }> {
    return page.evaluate((punkt) => {
        const map = globalThis.avesmapsMap!;
        const rahmen = map.getCanvas().getBoundingClientRect();
        const lage = map.unproject([punkt.x - rahmen.left, punkt.y - rahmen.top]);
        return { lng: lage.lng, lat: lage.lat };
    }, bei);
}

/** Wo das Symbol der Stelle auf der Karte liegt (Länge, Breite) und auf dem Bildschirm; `undefined`, solange es fehlt. */
async function symbol(page: Page): Promise<{ lng: number; lat: number; x: number; y: number } | undefined> {
    return page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        if (map.getLayer("photobox-stelle") === undefined) return undefined;
        const merkmal = map.querySourceFeatures("photobox-stelle")[0];
        if (merkmal === undefined) return undefined;
        const [lng, lat] = merkmal.geometry.coordinates as [number, number];
        const punkt = map.project({ lng, lat });
        const rahmen = map.getCanvas().getBoundingClientRect();
        return { lng, lat, x: rahmen.left + punkt.x, y: rahmen.top + punkt.y };
    });
}

/** Das Symbol steht an dieser Stelle der Karte, auf 14 Bildpunkte genau (die Stelle wird gerundet; die Kamera darf es inzwischen neben das Fenster geflogen haben). */
const symbolAn = async (page: Page, lage: { lng: number; lat: number }): Promise<boolean> =>
    page.evaluate((ziel) => {
        const map = globalThis.avesmapsMap!;
        if (map.getLayer("photobox-stelle") === undefined) return false;
        const merkmal = map.querySourceFeatures("photobox-stelle")[0];
        if (merkmal === undefined) return false;
        const [lng, lat] = merkmal.geometry.coordinates as [number, number];
        const da = map.project({ lng, lat });
        const soll = map.project(ziel);
        return Math.hypot(da.x - soll.x, da.y - soll.y) < 14;
    }, lage);

/** Wartet, bis die Kamera angekommen ist: Das Symbol bewegt sich zwischen zwei Messungen nicht mehr. */
async function symbolRuht(page: Page): Promise<{ lng: number; lat: number; x: number; y: number }> {
    let letzte = await symbol(page);
    await expect
        .poll(
            async () => {
                await page.waitForTimeout(350);
                const jetzt = await symbol(page);
                const ruht =
                    jetzt !== undefined &&
                    letzte !== undefined &&
                    Math.hypot(jetzt.x - letzte.x, jetzt.y - letzte.y) < 0.5;
                letzte = jetzt;
                return ruht;
            },
            { timeout: 20_000 },
        )
        .toBe(true);
    return letzte!;
}

async function oeffneFormular(page: Page, bei: { x: number; y: number }): Promise<void> {
    await page.mouse.click(bei.x, bei.y, { button: "right" });
    await page.getByTestId("context-photobox").click();
    await expect(page.getByTestId("reisebild-fenster")).toBeVisible();
}

test("🔴 Rechtsklick in der Standardansicht: der Eintrag steht, das Formular öffnet mittig, die Stelle trägt das Symbol neben dem Fenster, die Linie geht vom Kopf zur Stelle", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await stubReisebilder(page);
    await openMap(page);
    await showPlace(page, GARETH, 5);
    const spot = await freeSpot(page, { x: 420, y: 260 });
    const lage = await kartenLage(page, spot);
    await page.mouse.click(spot.x, spot.y, { button: "right" });
    await expect(page.getByTestId("context-photobox")).toContainText("Eigenes Bild hinzufügen");
    await page.getByTestId("context-photobox").click();

    const fenster = page.getByTestId("reisebild-fenster");
    await expect(fenster).toBeVisible();
    // Das Fenster steht in der Mitte, nicht auf der Seite der Stelle.
    const kasten = (await fenster.boundingBox())!;
    expect(kasten.x + kasten.width / 2).toBeCloseTo(640, -1);

    // Das Symbol steht an der Stelle des Klicks (Ebene `photobox-stelle`); die Kamera fliegt es neben das Fenster, und dort bleibt es.
    await expect.poll(() => symbolAn(page, lage)).toBe(true);
    const ruhe = await symbolRuht(page);
    expect(ruhe.x < kasten.x || ruhe.x > kasten.x + kasten.width).toBe(true);

    // Die Linie beginnt an der Kante des Fensters, die der Stelle zugewandt ist, in der Höhe des Titels, und endet am Rand des Symbols.
    const linie = page.getByTestId("reisebild-linie");
    await expect(linie).toBeVisible();
    const pfad = await linie.locator(".reisebild-linie__strich path").getAttribute("d");
    const [, vonX, vonY, bisX, bisY] = /^M([\d.-]+) ([\d.-]+)L([\d.-]+) ([\d.-]+)$/u.exec(pfad ?? "")!.map(Number) as [
        number,
        number,
        number,
        number,
        number,
    ];
    expect(vonX).toBeCloseTo(ruhe.x < kasten.x ? kasten.x : kasten.x + kasten.width, 0);
    const titel = (await fenster.locator(".avm-fenster__titel").boundingBox())!;
    expect(vonY).toBeCloseTo(titel.y + titel.height / 2, 0);
    expect(Math.hypot(bisX - ruhe.x, bisY - ruhe.y)).toBeCloseTo(17, 0);

    // ✕ schließt das Fenster: Symbol und Linie gehen mit.
    await fenster.getByRole("button", { name: "Schließen" }).click();
    await expect(fenster).toBeHidden();
    await expect(linie).toHaveCount(0);
    await expect
        .poll(() => page.evaluate(() => globalThis.avesmapsMap!.getLayer("photobox-stelle") === undefined))
        .toBe(true);
});

test("🔴 die Linie folgt der Karte: Verschiebt sich die Karte, wandert ihr Ende mit dem Symbol", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await stubReisebilder(page);
    await openMap(page);
    await showPlace(page, GARETH, 5);
    const spot = await freeSpot(page, { x: 420, y: 260 });
    await oeffneFormular(page, spot);
    const linie = page.getByTestId("reisebild-linie");
    await expect(linie).toBeVisible();
    const vorher = await symbolRuht(page);
    // Die Karte wandert um (60, 40): Das Symbol und mit ihm das Ende der Linie.
    await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const mitte = map.getCanvas();
        map.jumpTo({ center: map.unproject([mitte.clientWidth / 2 - 60, mitte.clientHeight / 2 - 40]) });
    });
    const nachher = { x: vorher.x + 60, y: vorher.y + 40 };
    await expect
        .poll(async () => {
            const jetzt = await symbol(page);
            return jetzt === undefined ? 1e9 : Math.hypot(jetzt.x - nachher.x, jetzt.y - nachher.y);
        })
        .toBeLessThan(2);
    await expect
        .poll(async () => {
            const pfad = (await linie.locator(".reisebild-linie__strich path").getAttribute("d")) ?? "";
            const ende = /L([\d.-]+) ([\d.-]+)$/u.exec(pfad);
            return ende === null ? 1e9 : Math.hypot(Number(ende[1]) - nachher.x, Number(ende[2]) - nachher.y);
        })
        .toBeLessThan(18);
});

test("🔴 nur in der Standardansicht: in den Landschaften fehlt der Eintrag, die übrigen stehen", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await stubReisebilder(page);
    await openMap(page);
    await showPlace(page, GARETH, 5);
    await chooseView(page, "landscapes");
    const spot = await freeSpot(page, { x: 420, y: 260 });
    await page.mouse.click(spot.x, spot.y, { button: "right" });
    await expect(page.getByTestId("context-report")).toBeVisible();
    await expect(page.getByTestId("context-photobox")).toHaveCount(0);
});

test("Stelle ändern: Der Wählmodus klappt das Fenster ein, der Klick setzt die Stelle; Esc lässt die alte stehen", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await stubReisebilder(page);
    await openMap(page);
    await showPlace(page, GARETH, 5);
    const erste = await freeSpot(page, { x: 420, y: 260 });
    const ersteLage = await kartenLage(page, erste);
    await oeffneFormular(page, erste);
    await expect.poll(() => symbolAn(page, ersteLage)).toBe(true);

    // Esc beendet den Modus, die Stelle bleibt, das Fenster klappt wieder auf; die Linie fehlt im Modus.
    await page.getByTestId("reisebild-stelle-aendern").click();
    await expect(page.getByTestId("reisebild-modusleiste")).toBeVisible();
    await expect(page.getByTestId("reisebild-linie")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("reisebild-modusleiste")).toBeHidden();
    await expect(page.getByTestId("reisebild-fenster")).toBeVisible();
    expect(await symbolAn(page, ersteLage)).toBe(true);
    await symbolRuht(page);

    // Der nächste Klick auf die Karte setzt die Stelle und beendet den Modus.
    await page.getByTestId("reisebild-stelle-aendern").click();
    const zweite = await freeSpot(page, { x: 1000, y: 560 });
    const zweiteLage = await kartenLage(page, zweite);
    await page.mouse.click(zweite.x, zweite.y);
    await expect(page.getByTestId("reisebild-modusleiste")).toBeHidden();
    await expect.poll(() => symbolAn(page, zweiteLage)).toBe(true);
    expect(await symbolAn(page, ersteLage)).toBe(false);
    // Das Menü ging dabei nicht auf, und die Auswahl der Karte blieb leer: Der Klick gehörte dem Modus.
    await expect(page.getByTestId("map-context-menu")).toHaveCount(0);
});
