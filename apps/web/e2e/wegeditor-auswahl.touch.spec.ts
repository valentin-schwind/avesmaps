import { expect, test } from "@playwright/test";
import { oeffneMitStubs, offen, zeile } from "./wegeditor-neuer-weg-auswahl.ts";

/**
 * Mehrfachauswahl der Wege und „Auswahl zu neuem Weg“ am Telefon (WI-0252). Am Telefon sind Liste und Eigenschaften ein Drill-down: In der
 * Mehrfachauswahl hakt ein Tippen an und wechselt nicht; „Liste schließen“ führt zur Sammelansicht, dort steht „Auswahl zu neuem Weg …“.
 * 🔴 Kein Test schreibt in die Datenbank (Stubs aus `wegeditor-neuer-weg-auswahl.ts`).
 *
 * Problemfälle: Das Tippen in der Mehrfachauswahl springt zu den Eigenschaften einer Straße; die Sammelansicht ist unerreichbar; die
 * Rückfrage passt nicht ins Telefon.
 */

const BILDER = process.env["WEGE_MEHRFACH_BILDER"];

test("🔴 Telefon: zwei Wege anhaken, zur Sammelansicht, „Auswahl zu neuem Weg …“ fragt mit „gemischt“", async ({
    page,
}) => {
    await oeffneMitStubs(page);
    await offen(page).locator('[data-testid$="-wege-mehrfach"]').first().click();
    await zeile(page, "Reichsstraße 3").click();
    await zeile(page, "Nordweg").click();
    await expect(offen(page).locator('[data-testid$="-wege-haken"]').first()).toContainText("2 angehakt");
    if (BILDER) await page.screenshot({ path: `${BILDER}/wege-mehrfach-telefon.png` });
    await offen(page).getByRole("button", { name: "Liste schließen" }).first().click();
    const sammel = offen(page).locator('[data-testid$="-sammel"]').first();
    await expect(sammel.locator('[data-testid$="-sammel-zahl"]')).toHaveText("2 Wege gewählt");
    await offen(page).locator('[data-testid$="-neuer-weg-knopf"]').first().click();
    const frage = offen(page).locator('[data-testid$="-neuer-weg"]').first();
    await expect(frage).toContainText("3 Abschnitte werden ein neuer Weg");
    await expect(frage.locator('[data-testid$="-neuer-weg-name"]').locator("input").first()).toHaveAttribute(
        "placeholder",
        "gemischt",
    );
    await frage.scrollIntoViewIfNeeded();
    if (BILDER) await page.screenshot({ path: `${BILDER}/wege-neuer-weg-telefon.png` });
});
