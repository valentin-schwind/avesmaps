import { expect, test } from "@playwright/test";
import { openMap, showCamera } from "./map-handle.ts";

/**
 * Ohne Grafikkarte bleibt die Karte auch geneigt flach (WI-0049, Betreiber 2026-09-27: „3: A“).
 *
 * Headless zeichnet Chromium ohne weitere Schalter mit SwiftShader, also genau ohne Grafikkarte.
 * Das Gelände selbst prüft `terrain.spec.ts` mit Grafikkarte.
 */

/** Mitten in den Koschbergen, bei Koschim. */
const KOSCHBERGE = { x: 462, y: 548 };

test("🔴 ohne Grafikkarte: 3D und Kippen wie vor dem Gelände, keine einzige Geländeanfrage", async ({ page }) => {
    const anfragen: string[] = [];
    page.on("request", (anfrage) => {
        if (anfrage.url().includes("/tiles/terrain/dem/")) {
            anfragen.push(anfrage.url());
        }
    });
    // Die App sagt selbst, wenn sie ohne Grafikkarte zeichnet (software-rendering.ts).
    let ohneKarte = false;
    page.on("console", (meldung) => {
        ohneKarte ||= meldung.text().startsWith("Gelände aus: keine Grafikkarte");
    });
    await openMap(page);
    test.skip(!ohneKarte, "der Testbrowser zeichnet mit Grafikkarte; das Gelände prüft terrain.spec.ts");

    await showCamera(page, { point: KOSCHBERGE, zoom: 5.6, pitch: 45 });
    const zustand = await page.evaluate(() => {
        const map = globalThis.avesmapsMap as unknown as {
            getTerrain(): unknown;
            getLayer(id: string): unknown;
            getPitch(): number;
        };
        return { pitch: map.getPitch(), terrain: map.getTerrain(), schatten: map.getLayer("gelaende-schatten") };
    });
    expect(zustand.pitch, "gekippt wird trotzdem").toBe(45);
    expect(zustand.terrain).toBeNull();
    expect(zustand.schatten).toBeUndefined();
    expect(anfragen, "nicht einmal der Zeiger wird gelesen").toEqual([]);
});
