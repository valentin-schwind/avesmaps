import { expect, test } from "@playwright/test";
import { feldwerte, oeffneGareth, pruefeSatzzeichen, zeilen } from "./info-panel-komma.ts";

/** Dasselbe am Telefon (Pixel 7, 412 px): Das Panel füllt die Breite, die Zeilen brechen anders, die Regel bleibt. */

test("🔴 Gareth am Telefon: kein Komma am Zeilenanfang, im Untertitel und in der Feldliste", async ({ page }) => {
    expect(page.viewportSize()?.width).toBe(412);
    await oeffneGareth(page);
    const untertitel = page.getByTestId("info-subtitle");
    expect((await zeilen(untertitel)).length).toBeGreaterThan(3);
    await pruefeSatzzeichen(untertitel);
    for (const wert of feldwerte(page)) {
        await expect(wert.getByTestId("info-link").first()).toBeAttached();
        await pruefeSatzzeichen(wert);
    }
});
