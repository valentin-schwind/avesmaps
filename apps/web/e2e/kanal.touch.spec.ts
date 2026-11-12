import { expect, test } from "@playwright/test";
import { stubKanal } from "./kanal-stub.ts";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Der Betreiber-Kanal am Telefon (WI-0124, KANAL-0001 K3): „Claudia & Claudio“ steht in der Auswahl der Leiste, die Vorgänge sind Karten,
 * „Vorgang melden“ ist einspaltig und passt in die Breite.
 */
test("🔴 am Telefon: der Kanal in der Auswahl, Vorgänge als Karten, Melden einspaltig", async ({ page }) => {
    await stubAdmin(page, { role: "operator", capabilities: [...ADMIN_CAPABILITIES, "use_operator_channel"] });
    await stubKanal(page);
    await page.goto("/edit");
    await page.getByTestId("kopfleiste-menue").tap();
    await page.getByTestId("menue-systemsteuerung").tap();
    const fenster = page.getByRole("dialog", { name: "Systemsteuerung" });
    await expect(fenster).toBeVisible();
    const auswahl = page.getByTestId("verwaltung-auswahl").getByRole("combobox", { name: "Bereiche der Verwaltung" });
    await expect(auswahl.locator("option[value='claudio']")).toHaveText(/^Claudia & Claudio/u); // ohne „Bereich ›“ seit `34593e61`
    await auswahl.selectOption("claudio");

    const karte = page.getByTestId("kanal-zeile-OPS-000134");
    await expect(karte).toBeVisible();
    expect(await karte.evaluate((element) => element.tagName)).toBe("BUTTON");
    await expect(page.locator("table.tafel")).toHaveCount(0);
    await karte.tap();
    await expect(page.getByTestId("kanal-vorgang-OPS-000134")).toBeVisible();
    await page.getByTestId("kanal-zurueck").tap();

    await page.getByTestId("kanal-melden").tap();
    const formular = page.getByTestId("kanal-melden-formular");
    await expect(formular).toBeVisible();
    const viewport = page.viewportSize();
    const box = await formular.boundingBox();
    expect(box !== null && viewport !== null && box.width <= viewport.width).toBe(true);
    // Einspaltig: die Kategorien stehen untereinander.
    const erste = await page.getByTestId("kanal-kategorie-feinjustierung").boundingBox();
    const zweite = await page.getByTestId("kanal-kategorie-bug").boundingBox();
    expect(erste !== null && zweite !== null && zweite.y > erste.y + erste.height - 1).toBe(true);
});
