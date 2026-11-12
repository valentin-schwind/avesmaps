import { expect, test } from "@playwright/test";
import { hoehenmodellServer, hoehenmodellTestStand } from "./hoehenmodell-stub.ts";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Die Werte von „19 (Test)“ am Telefon (WI-0240): Der Name steht über dem Feld, die Säulen fallen untereinander, und keine Zeile ist
 * breiter als das Fenster. `BILDER` (Ordner) legt die Bilder für die Sichtprüfung dort ab.
 */
test("am Telefon: Name über dem Feld, eine Säule, nichts breiter als das Fenster", async ({ page }) => {
    const server = hoehenmodellServer(hoehenmodellTestStand());
    await stubAdmin(page, {
        capabilities: [...ADMIN_CAPABILITIES, "manage_system_settings", "manage_terrain_recipe"],
        role: "operator",
        person: { passkeyCount: 1 },
        answer: (call) => server.handle(call),
    });
    await page.goto("/edit");
    await page.getByTestId("kopfleiste-menue").tap();
    await page.getByTestId("menue-systemsteuerung").tap();
    await expect(page.getByRole("dialog", { name: "Systemsteuerung" })).toBeVisible();
    await page
        .getByTestId("verwaltung-auswahl")
        .getByRole("combobox", { name: "Bereiche der Verwaltung" })
        .selectOption("hoehenmodell");
    await expect(page.getByTestId("hoehenmodell-test")).toBeVisible();

    await page.getByTestId("hoehenmodell-test-kachel-gelaende-rueckverteilung").click();
    const zeile = page.getByTestId("hoehenmodell-test-r:radius");
    const name = await zeile.locator(".wertzeile__name").boundingBox();
    const feld = await page.getByTestId("hoehenmodell-test-feld-r:radius").boundingBox();
    expect(name !== null && feld !== null && name.y + name.height <= feld.y + 1).toBe(true);

    const breit = await page.getByTestId("hoehenmodell-test").evaluate((wurzel) => {
        const rand = wurzel.getBoundingClientRect().right;
        return [...wurzel.querySelectorAll<HTMLElement>("*")]
            .filter((el) => el.getBoundingClientRect().right > rand + 1)
            .map((el) => el.className)
            .slice(0, 5);
    });
    expect(breit).toEqual([]);

    const ordner = process.env["BILDER"];
    if (ordner !== undefined) {
        await page.screenshot({ path: `${ordner}/telefon-1-oben.png` });
        await page.getByTestId("hoehenmodell-test-leiste").scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${ordner}/telefon-2-werte.png` });
        await page.getByTestId("hoehenmodell-test-panel-presets").scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${ordner}/telefon-3-presets.png` });
        await page.getByTestId("hoehenmodell-test-typ-kammgebirge").scrollIntoViewIfNeeded();
        await page.getByTestId("hoehenmodell-test-feld-m:kammgebirge").scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${ordner}/telefon-4-preset-zeilen.png` });
    }
});
