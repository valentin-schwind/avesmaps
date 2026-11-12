import { expect, test, type Locator } from "@playwright/test";
import { fenster, oeffneOrtseditor, zeile } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * In den Listen der Editoren kein linker Balken (WI-0184; EDIT-0003 §6, T26 (4)). Betreiber 2026-10-16, wörtlich: „erstmal nur in den
 * editor listen, z.b. in der systemsteuerung find ichs super“. Gemessen wird der GERECHNETE Rand der gewählten Zeile: Die Liste des
 * Ortseditors und die Kacheln des Editorpanels (WI-0212) zeigen die Wahl nur mit der Fläche, die Systemsteuerung behält den goldenen
 * Balken.
 * Die Grenze in den Quellen sichert `test/fenster-schiene-ohne-balken.test.ts`.
 */

const DURCHSICHTIG = "rgba(0, 0, 0, 0)";
/** Der Rand nach dem Übergang (120 ms): Mitten darin stünde die Fläche noch halb durchsichtig da. */
const rand = async (element: Locator) => {
    await element.page().waitForTimeout(250);
    return element.evaluate((el) => {
        const stil = getComputedStyle(el);
        return { farbe: stil.borderLeftColor, breite: stil.borderLeftWidth, flaeche: stil.backgroundColor };
    });
};

test("🔴 Ortseditor: die gewählte Zeile zeigt nur die Fläche, kein Balken; der Rand bleibt stehen, damit nichts springt", async ({
    page,
}) => {
    await oeffneOrtseditor(page);
    await zeile(page, "Gratenfels").click();
    const gewaehlt = fenster(page).locator(".liste__eintrag.is-gewaehlt");
    await expect(gewaehlt).toHaveCount(1);
    const stil = await rand(gewaehlt);
    expect(stil.farbe).toBe(DURCHSICHTIG);
    expect(stil.breite).not.toBe("0px");
    expect(stil.flaeche).not.toBe(DURCHSICHTIG);
});

test("🔴 Editorpanel: die gewählte Kachel zeigt Fläche und Rand ringsum, keinen Balken links (WI-0212)", async ({
    page,
}) => {
    await oeffneOrtseditor(page, { verb: false });
    const gewaehlt = page.getByTestId("editorpanel-kacheln").locator(".kachel.is-gewaehlt");
    await expect(gewaehlt).toHaveCount(1);
    const stil = await rand(gewaehlt);
    const oben = await gewaehlt.evaluate((el) => {
        const s = getComputedStyle(el);
        return { farbe: s.borderTopColor, breite: s.borderTopWidth };
    });
    // Links wie oben: kein eigener Rand, kein Balken.
    expect(stil.farbe).toBe(oben.farbe);
    expect(stil.breite).toBe(oben.breite);
    expect(stil.flaeche).not.toBe(DURCHSICHTIG);
});

test("🔴 Systemsteuerung: die Schiene behält den goldenen Balken („in der systemsteuerung find ichs super“)", async ({
    page,
}) => {
    await stubAdmin(page);
    await page.goto("/edit");
    await page.getByTestId("kopfleiste-menue").click();
    await page.getByTestId("menue-systemsteuerung").click();
    const aktiv = page.getByRole("dialog", { name: "Systemsteuerung" }).locator(".fenster-schiene__eintrag.is-aktiv");
    await expect(aktiv).toHaveCount(1);
    const stil = await rand(aktiv);
    expect(stil.farbe).not.toBe(DURCHSICHTIG);
});
