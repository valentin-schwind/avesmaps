import { expect, test, type Page } from "@playwright/test";
import { alsEditorAmLand, landAufSeite } from "./kartenmenue-stub.ts";
import { EDITOR_MODE, settleFrame } from "./map-handle.ts";

/**
 * Hash-Wechsel ohne Neuladen (Fund der Hauptorchestrierung auf der Stage 2026-10-20, über die Editor-Orchestrierung): Im selben Tab stellte
 * sie nur den Hash auf `view=landscapes&layer=alle` um und klickte rechts in die Karte. Das Menü „Hier hinzufügen ›“ zeigte den Umfang
 * von Standard; nach echtem Neuladen stimmte er. Die Karte las den Hash nur beim Laden (`map/hash-folgen.ts`).
 *
 * Erwartet: Nach dem Hash-Wechsel zeigen Fächer und „Hier hinzufügen ›“ dasselbe wie nach einem Neuladen mit diesem Hash, und nicht
 * mehr das von Standard.
 */
test.use({ viewport: { width: 1280, height: 800 } });

/** Die Einträge unter „Hier hinzufügen ›“ an der leeren Stelle, danach ist das Menü wieder zu. */
async function hierHinzufuegen(page: Page): Promise<string[]> {
    const at = await landAufSeite(page);
    await page.mouse.click(at.x, at.y, { button: "right" });
    const hier = page.getByTestId("context-editor-hier-hinzufuegen");
    await expect(hier).toBeVisible();
    await hier.dispatchEvent("click");
    const unter = page.getByTestId("context-editor-hier-hinzufuegen-unter");
    await expect(unter).toBeVisible();
    const eintraege = (await unter.getByRole("menuitem").allTextContents()).map((text) => text.trim());
    for (let i = 0; i < 3 && (await hier.count()) > 0; i += 1) await page.keyboard.press("Escape");
    await expect(hier).toHaveCount(0);
    return eintraege;
}

/** Der geschriebene Hash mit anderer Wahl, Ausschnitt und Serie wie jetzt. */
async function mitWahl(page: Page, wahl: Record<string, string>): Promise<string> {
    const jetzt = new URLSearchParams((await page.evaluate(() => globalThis.location.hash)).slice(1));
    for (const [name, wert] of Object.entries(wahl)) jetzt.set(name, wert);
    return `#${jetzt.toString()}`;
}

test("🔴 Hash-Wechsel ohne Neuladen: `view=landscapes&layer=alle` stellt Ansicht und „Hier hinzufügen ›“ wie ein Neuladen", async ({
    page,
}) => {
    await alsEditorAmLand(page);
    await page.waitForFunction(() => globalThis.location.hash.includes("x="), undefined, { timeout: 15_000 });
    const kachel = page.getByTestId("fan-toggle");
    const standard = { titel: await kachel.getAttribute("title"), eintraege: await hierHinzufuegen(page) };

    // Nur der Hash, ohne Neuladen: wie in der Adresszeile geändert (ein `hashchange`).
    const ziel = await mitWahl(page, { view: "landscapes", layer: "alle" });
    await page.evaluate((hash) => {
        globalThis.location.hash = hash;
    }, ziel);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
    await settleFrame(page);
    const nachWechsel = { titel: await kachel.getAttribute("title"), eintraege: await hierHinzufuegen(page) };

    // Dieselbe Adresse, echt neu geladen. 🪤 Erst weg: `goto` auf dieselbe Adresse mit Hash bliebe im Dokument und lüde nichts neu.
    await page.goto("about:blank");
    await page.goto(`${EDITOR_MODE}${ziel}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 30_000 });
    await settleFrame(page);
    const neuGeladen = { titel: await kachel.getAttribute("title"), eintraege: await hierHinzufuegen(page) };

    expect(neuGeladen.titel, "der Neuladen zeigt eine andere Ansicht als Standard").not.toBe(standard.titel);
    expect(nachWechsel, "nach dem Hash-Wechsel wie nach dem Neuladen").toEqual(neuGeladen);
});

/**
 * Fund im dritten Release-Test (2026-10-24, `gebietseditor.spec.ts` „Umschalt-Klick auf einen Ort über dem Gebiet“, lokal 2 von 8 rot): Die
 * Karte schreibt ihre Lage gebündelt per `replaceState` (`writeViewState`, 150 ms nach der letzten Bewegung oder Panel-Änderung). Fiel
 * das zwischen das Setzen des Hashs und das `hashchange`, las der Handler `location.hash` und damit die ALTE Lage: Die Karte flog
 * dorthin zurück, wo sie war, der Link war verschluckt. Hier fällt der Schreibzug deterministisch dazwischen (im selben Aufruf, vor
 * dem Ereignis). Erwartet: Die Karte fliegt dorthin, wohin der Link zeigt.
 */
test("🔴 Hash-Wechsel, den die Karte gleich mit ihrer alten Lage überschreibt, gilt trotzdem: Der Zoom des Links kommt an", async ({
    page,
}) => {
    await alsEditorAmLand(page);
    await page.waitForFunction(() => globalThis.location.hash.includes("x="), undefined, { timeout: 15_000 });
    const zoomZiel = 7.5;
    const ziel = await mitWahl(page, { z: zoomZiel.toFixed(2) });
    const zoomVorher = await page.evaluate(() => globalThis.avesmapsMap!.getZoom());
    expect(zoomVorher, "der Link soll wirklich weiter heranzoomen").toBeLessThan(zoomZiel - 0.5);
    await page.evaluate((hash) => {
        const alt = globalThis.location.hash;
        globalThis.location.hash = hash;
        // Die Karte schreibt ihre Lage zurück, bevor das Ereignis kommt: `location.hash` ist wieder der alte.
        globalThis.history.replaceState(null, "", alt);
    }, ziel);
    await page.waitForFunction((z) => Math.abs(globalThis.avesmapsMap!.getZoom() - z) < 0.05, zoomZiel, {
        timeout: 15_000,
    });
});
