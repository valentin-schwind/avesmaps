import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { oeffneStatistik } from "./besucherstatistik-stub.ts";

/**
 * Das Messfenster bleibt offen und steht links unten (WI-0150, Kanal OPS-000002 von Thomas: „Links unten immer sichtbar
 * (im Editormodus) ein Informationsfenster").
 *
 * Zwei Dinge in einem Lauf: die **Probe**, dass es nach dem Neuladen von selbst wieder dasteht (die Naht in `app.vue`,
 * die der Einheitentest nicht sieht), und das **Blatt** für den Betreiber unter `review/wi-0150/`.
 */

const ZIEL = resolve(import.meta.dirname, "..", "..", "..", "review", "wi-0150");

/** Der Rand, in dem das Fenster unten links steht (`--space-10`); etwas Spiel für Rundung und Schatten. */
const RAND = 10;

test("Messfenster: links unten, und nach dem Neuladen wieder da", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await oeffneStatistik(page);
    await page.getByRole("tab", { name: "Status" }).click();
    await page.getByTestId("statistik-sorte-server").click();
    await page.getByTestId("statistik-messfenster").click();
    const fenster = page.getByTestId("mess-fenster");
    await expect(fenster).toBeVisible();

    // Links unten über der Karte: ohne gemerkte Box trägt die Ecke die Lage (`vorgabeEckeKlasse`).
    const box = await fenster.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
        expect(box.x).toBeLessThanOrEqual(RAND * 3);
        expect(900 - (box.y + box.height)).toBeLessThanOrEqual(RAND * 3);
    }

    mkdirSync(ZIEL, { recursive: true });
    writeFileSync(resolve(ZIEL, "blatt.png"), await page.screenshot());
    writeFileSync(resolve(ZIEL, "blatt-nah.png"), await fenster.screenshot());

    // 🔴 Die Probe: neu laden, nichts anklicken - das Fenster ist wieder da.
    await page.reload();
    await expect(page.getByTestId("mess-fenster")).toBeVisible();

    // Und ein eigenes Zumachen hält es zu.
    await page.getByTestId("mess-fenster").getByTestId("fenster-schliessen").click();
    await expect(page.getByTestId("mess-fenster")).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("mess-fenster")).toHaveCount(0);
});
