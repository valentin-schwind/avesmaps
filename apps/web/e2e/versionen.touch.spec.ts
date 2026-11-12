import { expect, test } from "@playwright/test";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";

/**
 * „Versionen“ am Telefon (WI-0137, Blatt 1 (c)): zwei Zeilen je Änderung statt der Tafel, der Commit als Link; kein Vergleichslink im Kopf.
 */
test("🔴 am Telefon Karten statt Tafel, der Commit bleibt ein Link, das Fenster passt in die Breite", async ({
    page,
}) => {
    await stubAdmin(page, { capabilities: ADMIN_CAPABILITIES });
    await page.goto("/edit");
    await page.getByTestId("kopfleiste-menue").tap();
    await page.getByTestId("menue-systemsteuerung").tap();
    const system = page.getByRole("dialog", { name: "Systemsteuerung" });
    await expect(system).toBeVisible();
    await page
        .getByTestId("verwaltung-auswahl")
        .getByRole("combobox", { name: "Bereiche der Verwaltung" })
        .selectOption("versionen");
    const liste = page.getByTestId("versionen-liste-2026-10-11-df6f840c");
    await expect(liste).toBeVisible();
    await expect(liste.locator("table")).toHaveCount(0);
    await expect(liste.locator(".karte")).toHaveCount(22);
    await expect(liste.getByRole("link", { name: "db978930", exact: true })).toBeVisible();
    await expect(page.getByTestId("versionen-kopf").getByRole("link", { name: /vergleichen/u })).toHaveCount(0);
    const box = await system.boundingBox();
    const viewport = page.viewportSize();
    expect(box !== null && viewport !== null && box.width <= viewport.width).toBe(true);
});
