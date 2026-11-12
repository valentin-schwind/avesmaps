import { expect, test, type Page } from "@playwright/test";
import { openMap, showPlace, GARETH } from "./map-handle.ts";

/**
 * Der Schriftgrößen-Regler (Betreiberauftrag 2026-09-22).
 *
 * 🪤 Ein WERKZEUG, kein Produktmerkmal: ohne `?labeltune=1` darf davon nichts zu sehen sein. Der
 * erste Test prüft genau das — ein Entwicklungspanel, das versehentlich ausgeliefert wird, fällt
 * niemandem auf, bis es jemandem auffällt.
 */

interface MapHandle {
    getLayoutProperty(layer: string, property: string): unknown;
}

/**
 * Einen Schieberegler stellen.
 *
 * 🪤 `fill()` geht bei `type="range"` nicht — Playwright meldet „Malformed value". Der Wert wird
 * direkt gesetzt und das Ereignis von Hand ausgelöst, wie es ein Ziehen auch täte.
 */
async function stelle(page: Page, testid: string, wert: string): Promise<void> {
    await page.getByTestId(testid).evaluate((element, value) => {
        const regler = element as HTMLInputElement;
        regler.value = value;
        regler.dispatchEvent(new Event("input", { bubbles: true }));
    }, wert);
    await page.waitForTimeout(350);
}

test("🪤 bleibt ohne ?labeltune=1 vollständig unsichtbar", async ({ page }) => {
    await openMap(page);
    await showPlace(page, GARETH, 5);
    await expect(page.locator(".label-tuner")).toHaveCount(0);
});

test("🔴 skaliert die Schriftgröße, ohne die Zoomkurve wegzuwerfen", async ({ page }) => {
    await page.goto("/?labeltune=1");
    await page.waitForFunction(() => Boolean(globalThis.avesmapsMap));
    await page.waitForTimeout(2500);
    await expect(page.getByTestId("labeltune-orte")).toBeVisible();

    const groesse = async (): Promise<string> =>
        page.evaluate(() =>
            JSON.stringify(
                (globalThis.avesmapsMap as unknown as MapHandle).getLayoutProperty(
                    "place-label-dorf-right",
                    "text-size",
                ),
            ),
        );

    const vorher = await groesse();
    // 💣 Die Ortsgröße ist eine Band-Interpolation über sieben Klassen. Sie durch eine feste Zahl
    // zu ersetzen wäre der naheliegende Fehler - dann stünde beim Loslassen eine kaputte Karte da.
    expect(vorher).toContain("interpolate");

    await stelle(page, "labeltune-orte", "1.5");

    const nachher = await groesse();
    expect(nachher, "der Faktor liegt UM die Kurve, nicht an ihrer Stelle").toContain("interpolate");
    expect(nachher).not.toBe(vorher);
    await expect(page.getByTestId("labeltune-orte-wert")).toHaveText("1.50");
});

test("🪤 setzt zurück, ohne den Faktor aufzumultiplizieren", async ({ page }) => {
    // Jede Skalierung geht vom AUSGANGSausdruck aus, nicht vom letzten Stand. Sonst wüchse die
    // Schrift bei jedem Ziehen weiter, und der Regler zeigte etwas anderes als die Karte.
    await page.goto("/?labeltune=1");
    await page.waitForFunction(() => Boolean(globalThis.avesmapsMap));
    await page.waitForTimeout(2500);

    const groesse = async (): Promise<string> =>
        page.evaluate(() =>
            JSON.stringify(
                (globalThis.avesmapsMap as unknown as MapHandle).getLayoutProperty("path-label", "text-size"),
            ),
        );
    const ausgang = await groesse();

    for (const wert of ["2", "0.8", "1.4"]) {
        await stelle(page, "labeltune-wege", wert);
    }
    await page.getByRole("button", { name: "Zurücksetzen" }).click();
    await page.waitForTimeout(500);

    // Faktor 1 lässt den Ausdruck unverändert - Zahlen mal eins sind dieselben Zahlen.
    expect(JSON.parse(await groesse())).toEqual(JSON.parse(ausgang));
});

test("💣 erscheint auch, wenn die Kacheln nie fertig werden", async ({ page }) => {
    // Der Regler hing an `once("idle")`. `idle` heisst: Stil geladen UND alle Kacheln da UND nichts
    // mehr unterwegs. Hakt eine einzige Quelle, kommt der Zustand nie - und das Werkzeug erscheint
    // nie, stumm, auf einer Karte, die sonst aussieht wie immer. Genau so hat der Betreiber es
    // vorgefunden. Hier werden die Kacheln absichtlich blockiert: der Regler muss trotzdem da sein.
    await page.route("**/tiles/**", (route) => route.abort());

    await page.goto("/?labeltune=1");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });

    await expect(page.getByTestId("labeltune-orte")).toBeVisible();
    await expect(page.getByTestId("labeltune-wege")).toBeVisible();
    await expect(page.getByTestId("labeltune-landschaften")).toBeVisible();
});

test("🪤 verdeckt den Kartenfächer nicht", async ({ page }) => {
    // Zwei Tafeln in derselben Ecke verdecken einander je nach Fensterhöhe. Der Regler sitzt oben
    // rechts unter der Zoomsteuerung, der Fächer unten rechts - das muss so bleiben.
    await page.goto("/?labeltune=1");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(page.locator(".label-tuner")).toBeVisible();

    const regler = await page.locator(".label-tuner").boundingBox();
    const faecher = await page.locator(".fan").boundingBox();
    if (!regler || !faecher) {
        throw new Error("Regler oder Kartenfächer nicht im Bild");
    }
    const ueberlappt =
        regler.x < faecher.x + faecher.width &&
        faecher.x < regler.x + regler.width &&
        regler.y < faecher.y + faecher.height &&
        faecher.y < regler.y + regler.height;
    expect(ueberlappt, "Regler und Kartenfächer überlappen").toBe(false);
});
