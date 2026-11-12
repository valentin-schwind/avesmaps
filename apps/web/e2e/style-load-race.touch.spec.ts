import { expect, test } from "@playwright/test";

/**
 * Ein Stilneubau, solange der erste Stil noch lädt (Befund 2026-10-04, `src/map/style-ready.ts`).
 *
 * Beim Laden standen siebenmal „Laufzeitbild … nicht angemeldet: Style is not done loading“ in der Konsole, obwohl
 * jedes Bild stand: Ein Neubau des Stils vor seinem ersten Laden lässt MapLibre von vorn bauen, die Bilder werden am
 * neuen, noch ladenden Stil angemeldet, jedes meldet `styledata`, und die Ebene der Reisenden warf darin mit
 * `addLayer` in den Aufrufer.
 *
 * Nachgestellt wie im verborgenen Tab: Kein Bild wird gezeichnet, bis der Test es freigibt, und MapLibre lädt seinen
 * Stil erst im ersten. Den Neubau löst der Wechsel vom Telefon zum Rechnerfenster aus (`phoneViewport`); deshalb
 * läuft der Test im Telefonprofil.
 */

/** Die Laufzeitbilder (`src/map/runtime-images.ts`), so wie sie im Befund standen. */
const LAUFZEITBILDER = [
    "fliessrichtung-dreieck",
    "bauwerk-raute",
    "bauwerk-raute-haarlinie",
    "place-marker-structure-active",
    "route-marker-disc",
    "route-marker-drop",
    "gipfel-dreieck",
];

/** Die Karte, wie die Seite sie für Tests ablegt (`avesmapsMap`); gelesen nur im Browser. */
interface Karte {
    style: { _loaded: boolean } | undefined;
    isStyleLoaded(): boolean;
    hasImage(id: string): boolean;
    getLayersOrder(): string[];
}

test("🔴 ein Neubau vor dem ersten Laden meldet keinen Fehler; Bilder und die Ebene der Reisenden kommen mit dem Laden", async ({
    page,
}) => {
    const fehler: string[] = [];
    const warnungen: string[] = [];
    page.on("console", (meldung) => {
        if (meldung.type() === "error") fehler.push(meldung.text());
        if (meldung.type() === "warning") warnungen.push(meldung.text());
    });
    page.on("pageerror", (error) => fehler.push(error.message));

    await page.addInitScript(() => {
        const zeichnen = globalThis.requestAnimationFrame.bind(globalThis);
        const abbrechen = globalThis.cancelAnimationFrame.bind(globalThis);
        const wartend = new Map<number, FrameRequestCallback>();
        let naechste = -1;
        let angehalten = true;
        globalThis.requestAnimationFrame = (callback) => {
            if (!angehalten) return zeichnen(callback);
            const id = naechste--;
            wartend.set(id, callback);
            return id;
        };
        globalThis.cancelAnimationFrame = (id) => {
            if (!wartend.delete(id)) abbrechen(id);
        };
        Object.assign(globalThis, {
            bilderFreigeben: () => {
                angehalten = false;
                for (const callback of wartend.values()) zeichnen(callback);
                wartend.clear();
            },
        });
    });

    await page.goto("/");
    // Mit festem Takt: Ohne `polling` fragt Playwright über das `requestAnimationFrame` der Seite nach, das hier
    // angehalten ist; stand die Karte beim ersten Blick noch nicht, kam keine zweite Prüfung.
    await page.waitForFunction(() => "avesmapsMap" in globalThis, undefined, { polling: 100, timeout: 30_000 });
    expect(
        await page.evaluate(() => (globalThis as unknown as { avesmapsMap: Karte }).avesmapsMap.style?._loaded),
    ).toBe(false);

    await page.setViewportSize({ width: 1280, height: 900 });
    // Nur dann ist der Test eine Aussage: MapLibre musste den Stil von vorn bauen, während der erste noch lud.
    await expect.poll(() => warnungen.some((text) => text.includes("Rebuilding the style from scratch"))).toBe(true);

    await page.evaluate(() => (globalThis as unknown as { bilderFreigeben(): void }).bilderFreigeben());
    await page.waitForFunction(
        () => (globalThis as unknown as { avesmapsMap: Karte }).avesmapsMap.isStyleLoaded(),
        undefined,
        { timeout: 30_000 },
    );

    const stand = await page.evaluate((ids) => {
        const map = (globalThis as unknown as { avesmapsMap: Karte }).avesmapsMap;
        return { fehlend: ids.filter((id) => !map.hasImage(id)), oben: map.getLayersOrder().at(-1) };
    }, LAUFZEITBILDER);
    expect(stand.fehlend).toEqual([]);
    expect(stand.oben).toBe("route-traveler");
    expect(fehler).toEqual([]);
    // Fehlt einer Symbolebene ihr Bild, sagt MapLibre es nur als Warnung.
    expect(warnungen.filter((text) => LAUFZEITBILDER.some((id) => text.includes(`"${id}"`)))).toEqual([]);
});
