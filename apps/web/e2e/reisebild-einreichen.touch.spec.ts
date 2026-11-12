import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { kleinesPng, stubReisebilder } from "./reisebild-stub.ts";
import { freeSpot, GARETH, openMap, showPlace } from "./map-handle.ts";

/**
 * Das Formular „Eigenes Bild hinzufügen“ am Telefon (WI-0272 S2b, Aufgabe 13; Probierseite 7.1 „Telefonblatt“): Der lange Druck öffnet das Kartenmenü, das Formular ist ein Blatt unten, so hoch wie
 * sein Inhalt, und die Kamera fliegt die Stelle in die freie Fläche darüber. Der Rechner steht in `reisebild-einreichen.spec.ts`.
 *
 * Problemfälle: Das Fenster steht von oben bis unten statt als Blatt; die Stelle bleibt unter dem Blatt; das Blatt wird breiter als der Schirm; „Einreichen“ liegt außerhalb des Bildes; der Wählmodus
 * lässt das Blatt hoch stehen und deckt die Karte, die gewählt werden soll.
 */

/** Der lange Druck: Finger auf, liegen lassen, los (Playwright kennt nur den kurzen Tipp). */
async function longPress(client: CDPSession, page: Page, at: { x: number; y: number }, hold = 800): Promise<void> {
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: at.x, y: at.y, id: 0 }] });
    await page.waitForTimeout(hold);
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** Wo das Symbol der Stelle auf dem Bildschirm steht (Seitenkoordinaten), oder `undefined`. */
async function symbolPunkt(page: Page): Promise<{ x: number; y: number } | undefined> {
    return page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        if (map.getLayer("photobox-stelle") === undefined) return undefined;
        const merkmal = map.querySourceFeatures("photobox-stelle")[0];
        if (merkmal === undefined) return undefined;
        const [lng, lat] = merkmal.geometry.coordinates;
        const punkt = map.project({ lng, lat });
        const rahmen = map.getCanvas().getBoundingClientRect();
        return { x: rahmen.left + punkt.x, y: rahmen.top + punkt.y };
    });
}

test("🔴 Telefon: das Formular ist ein Blatt unten, die Stelle liegt darüber, „Einreichen“ steht im Bild", async ({
    page,
}) => {
    const attrappe = await stubReisebilder(page);
    await openMap(page);
    await showPlace(page, GARETH, 5);
    const spot = await freeSpot(page, { x: 60, y: 80 });
    const client = await page.context().newCDPSession(page);
    await longPress(client, page, spot);
    await page.getByTestId("context-photobox").tap();

    const fenster = page.getByTestId("reisebild-fenster");
    await expect(fenster).toBeVisible();
    const schirm = page.viewportSize()!;
    // Ein Blatt: über die ganze Breite, unten am Rand, nicht von oben bis unten.
    await expect(fenster).toHaveAttribute("data-map-overlay", "bottom");
    // Am Telefon gibt es nur das Blatt: kein ⧉ im Kopf, das nichts löst (Review S3 M11).
    await expect(page.getByTestId("fenster-loesen")).toHaveCount(0);
    await expect
        .poll(async () => {
            const kasten = (await fenster.boundingBox())!;
            return {
                links: Math.round(kasten.x),
                breite: Math.round(kasten.width),
                unten: Math.round(kasten.y + kasten.height),
                niedriger: kasten.height < schirm.height - 40,
            };
        })
        .toEqual({ links: 0, breite: schirm.width, unten: schirm.height, niedriger: true });

    // Die Kamera fliegt die Stelle über das Blatt (nie darunter): Sie fliegt, also warten, bis sie steht.
    await expect
        .poll(
            async () => {
                const blatt = (await fenster.boundingBox())!;
                const symbol = await symbolPunkt(page);
                return symbol !== undefined && symbol.y < blatt.y - 10 && symbol.x > 0 && symbol.x < schirm.width;
            },
            { timeout: 15_000 },
        )
        .toBe(true);

    // „Einreichen“ liegt im Bild (der Fuß steht), und das Formular rollt, wenn es höher ist als das Blatt.
    const knopf = page.getByTestId("reisebild-einreichen");
    const knopfKasten = (await knopf.boundingBox())!;
    expect(knopfKasten.y + knopfKasten.height).toBeLessThanOrEqual(schirm.height);
    expect(knopfKasten.x + knopfKasten.width).toBeLessThanOrEqual(schirm.width);

    // Ausfüllen und einreichen.
    await page
        .getByTestId("reisebild-datei")
        .setInputFiles({ name: "x.png", mimeType: "image/png", buffer: kleinesPng() });
    await expect(page.getByTestId("reisebild-vorschau")).toBeVisible();
    await page.getByTestId("reisebild-text").fill("Der Markt am Morgen.");
    await page.getByTestId("reisebild-entstehung-drawing").scrollIntoViewIfNeeded();
    await page.getByTestId("reisebild-entstehung-drawing").tap();
    await page.getByTestId("reisebild-haken").scrollIntoViewIfNeeded();
    await page.getByTestId("reisebild-haken").tap();
    await expect(knopf).toBeEnabled();
    await knopf.tap();
    await expect(page.getByTestId("reisebild-fertig")).toBeVisible();
    // Die Bestätigung beginnt oben, auch wenn das Formular darunter bis zum Häkchen gerollt war.
    await expect(page.getByTestId("reisebild-fertig-hinweis")).toBeInViewport();
    expect(attrappe.aufrufe.filter((aufruf) => aufruf.pfad === "/einreichungen")).toHaveLength(1);
    await expect(page.getByTestId("reisebild-fertig-link")).toHaveAttribute("title", /\/reisebild#[A-Za-z0-9_-]{43}$/u);
});

test("Telefon: im Wählmodus schrumpft das Blatt auf Kopf und Moduszeile; ein Tipp auf die Karte setzt die Stelle", async ({
    page,
}) => {
    await stubReisebilder(page);
    await openMap(page);
    await showPlace(page, GARETH, 5);
    const spot = await freeSpot(page, { x: 60, y: 80 });
    const client = await page.context().newCDPSession(page);
    await longPress(client, page, spot);
    await page.getByTestId("context-photobox").tap();
    const fenster = page.getByTestId("reisebild-fenster");
    await expect(fenster).toBeVisible();
    const hoch = (await fenster.boundingBox())!.height;

    await page.getByTestId("reisebild-stelle-aendern").tap();
    await expect(page.getByTestId("reisebild-modusleiste")).toBeVisible();
    await expect.poll(async () => (await fenster.boundingBox())!.height).toBeLessThan(hoch);
    const schirm = page.viewportSize()!;
    const klein = (await fenster.boundingBox())!;
    expect(klein.y + klein.height).toBeCloseTo(schirm.height, 0);

    // Ein Tipp auf die freie Karte darüber beendet den Modus.
    await page.mouse.click(spot.x + 40, spot.y + 60);
    await expect(page.getByTestId("reisebild-modusleiste")).toBeHidden();
    await expect(page.getByTestId("reisebild-formular")).toBeVisible();
});

test("🔴 Telefon: die Statusseite ist ein Blatt unten; „Auf der Karte zeigen“ fliegt die Stelle über das Blatt", async ({
    page,
}) => {
    await stubReisebilder(page, {
        status: {
            zustand: "approved",
            eingereichtAm: "2026-10-31T10:00:00.000Z",
            beschreibung: "Der Markt am Morgen.",
            entstehung: "photo",
            nutzung: "avesmaps_only",
            name: "Alrik",
            lage: { x: 200, y: 300 },
            vorschauBereit: true,
            angepasst: false,
        },
    });
    await openMap(page, "/reisebild#kQ3vZp9Xw2Lh7Rt5Yb8Nc1Jd4Fa6Ge0Hs-_MuoTiPKq");
    const fenster = page.getByTestId("reisebild-status-fenster");
    await expect(fenster).toBeVisible();
    await expect(fenster).toHaveAttribute("data-map-overlay", "bottom");
    const schirm = page.viewportSize()!;
    await expect
        .poll(async () => {
            const kasten = (await fenster.boundingBox())!;
            return {
                links: Math.round(kasten.x),
                breite: Math.round(kasten.width),
                unten: Math.round(kasten.y + kasten.height),
            };
        })
        .toEqual({ links: 0, breite: schirm.width, unten: schirm.height });
    await expect(page.getByTestId("reisebild-status-zustand")).toHaveText("Veröffentlicht");

    await page.getByTestId("reisebild-status-zeigen").tap();
    await expect
        .poll(
            async () => {
                const blatt = (await fenster.boundingBox())!;
                return page.evaluate((oben) => {
                    const map = globalThis.avesmapsMap!;
                    const punkt = map.project(globalThis.avesmapsRenderProjection!.toRenderLngLat({ x: 200, y: 300 }));
                    const rahmen = map.getCanvas().getBoundingClientRect();
                    const x = rahmen.left + punkt.x;
                    const y = rahmen.top + punkt.y;
                    return y > 0 && y < oben && x > 0 && x < innerWidth;
                }, blatt.y);
            },
            { timeout: 20_000 },
        )
        .toBe(true);
    // Platzhalter und Linie stehen auch hier: Die Linie beginnt an der Oberkante des Blatts und endet am Rand des Symbols.
    expect(await page.evaluate(() => globalThis.avesmapsMap!.getLayer("photobox-stelle") !== undefined)).toBe(true);
    await expect(page.getByTestId("reisebild-linie")).toHaveCount(1);
    await page.getByTestId("reisebild-status-fenster").getByTestId("fenster-schliessen").tap();
    await expect(page.getByTestId("reisebild-linie")).toHaveCount(0);
    expect(await page.evaluate(() => globalThis.avesmapsMap!.getLayer("photobox-stelle") !== undefined)).toBe(false);
});
