import { expect, test, type Page } from "@playwright/test";
import { NORD, PFAD, RS, RS2, oeffneMitStubs, offen, zeile } from "./wegeditor-neuer-weg-auswahl.ts";

/**
 * „Auswahl zu neuem Weg“ im Wege-Fenster (WI-0252; Betreiber 2026-10-24: „schön wäre, wenn es einen button "Auswahl zu neuem Weg" geben
 * könnte (bei Form bzw. im kontextmenü). bestehende zuweisungen werden aufgehoben und die neue straße kann einen namen bekommen (alles was
 * "gemischt" wird dann zu einem namen)“). 🔴 Kein Test schreibt in die Datenbank: Liste, Straßen und der Schreibweg kommen aus Stubs; den
 * echten Schreibweg prüft `apps/server/test/editor-path-neuer-weg.test.ts`.
 *
 * Problemfälle: Der Knopf fehlt im Kasten „Form“ oder geht ohne Rückfrage; das Namensfeld steht bei gemischten Namen mit dem Namen des
 * ersten Wegs vor; ein Griff lässt sich als Name schreiben; „Zu neuem Weg“ schickt nicht alle Abschnitte oder mehrere Operationen; danach
 * steht die Mehrfachauswahl weiter, und das Fenster zeigt nicht den neuen Weg.
 */

/** Die Bilder für den Betreiber (Auftrag WI-0252): nur, wenn der Ordner genannt ist. */
const BILDER = process.env["WEGE_MEHRFACH_BILDER"];

async function dreiWegeAngehakt(page: Page): Promise<void> {
    await zeile(page, "Reichsstraße 3").click();
    await offen(page).locator('[data-testid$="-wege-mehrfach"]').first().click();
    await zeile(page, "Nordweg").click();
    await zeile(page, "Unbezeichneter Pfad").click();
    await expect(offen(page).locator('[data-testid$="-wege-haken"]').first()).toContainText("3 angehakt");
}

for (const groesse of [
    { width: 1920, height: 1080 },
    { width: 1280, height: 800 },
]) {
    test.describe(`bei ${String(groesse.width)} px`, () => {
        test.use({ viewport: groesse });

        test("🔴 drei Wege angehakt: „Auswahl zu neuem Weg …“ fragt mit leerem Namen und „gemischt“, ein Griff geht nicht; „Zu neuem Weg“ schreibt EINE Operation über alle Abschnitte", async ({
            page,
        }) => {
            const gesendet = await oeffneMitStubs(page);
            await dreiWegeAngehakt(page);
            const sammel = offen(page).locator('[data-testid$="-sammel"]').first();
            await expect(sammel.locator('[data-testid$="-sammel-zahl"]')).toHaveText("3 Wege gewählt");
            const knopf = offen(page).locator('[data-testid$="-neuer-weg-knopf"]').first();
            await expect(knopf).toBeEnabled();
            await expect(knopf).toHaveAttribute("title", /ein Weg mit einem Namen/);
            if (BILDER) await page.screenshot({ path: `${BILDER}/wege-mehrfach-${String(groesse.width)}.png` });
            await knopf.click();
            const frage = offen(page).locator('[data-testid$="-neuer-weg"]').first();
            await expect(frage).toBeVisible();
            await expect(frage).toContainText("4 Abschnitte werden ein neuer Weg");
            await expect(frage).toContainText("Die gewählten Wege heißen verschieden");
            await expect(frage).toContainText("Ihre Wiki-Zuordnungen werden aufgehoben.");
            const name = frage.locator('[data-testid$="-neuer-weg-name"]').locator("input").first();
            await expect(name).toHaveValue("");
            await expect(name).toHaveAttribute("placeholder", "gemischt");
            const bestaetigen = frage.getByRole("button", { name: "Zu neuem Weg" });
            // Leer und ein Griff sind kein Name.
            await expect(bestaetigen).toBeDisabled();
            await name.fill("Pfad-77");
            await expect(bestaetigen).toBeDisabled();
            await expect(frage).toContainText("Das ist kein Name, sondern ein Griff.");
            await name.fill("Grenzlandstraße");
            await expect(bestaetigen).toBeEnabled();
            if (BILDER) {
                // Die Frage ganz im Bild und die Knöpfe nach ihrem Übergang (bei 1280 px steht die Frage unter dem Falz).
                await frage.scrollIntoViewIfNeeded();
                await page.waitForTimeout(400);
                await page.screenshot({ path: `${BILDER}/wege-neuer-weg-${String(groesse.width)}.png` });
            }
            expect(gesendet).toEqual([]);
            await bestaetigen.click();
            await expect.poll(() => gesendet.length).toBe(1);
            expect(gesendet[0]).toEqual({
                operationId: expect.any(String),
                name: "Grenzlandstraße",
                sections: [
                    { publicId: RS, baseRevision: 4 },
                    { publicId: RS2, baseRevision: 2 },
                    { publicId: NORD, baseRevision: 3 },
                    { publicId: PFAD, baseRevision: 2 },
                ],
            });
            // Danach: die Mehrfachauswahl ist aus, das Fenster zeigt den neuen Weg.
            await expect(offen(page).locator('[data-testid$="-wege-mehrfach"]').first()).toHaveAttribute(
                "aria-pressed",
                "false",
            );
            await expect(offen(page).locator('[data-testid$="-sammel"]')).toHaveCount(0);
            await expect(offen(page)).toContainText("Grenzlandstraße");
            await expect(page.getByText("„Grenzlandstraße“ ist jetzt ein Weg aus 4 Abschnitten")).toBeVisible();
        });
    });
}

test.describe("mit gleichem Namen", () => {
    test.use({ viewport: { width: 1920, height: 1080 } });

    test("🔴 ein Teil der Abschnitte EINES Wegs (Leiste): der Knopf unter der Leiste, der Name steht vor; Abbrechen schreibt nichts", async ({
        page,
    }) => {
        const gesendet = await oeffneMitStubs(page);
        await zeile(page, "Reichsstraße 3").click();
        const knopf = offen(page).locator('[data-testid$="-neuer-weg-knopf"]');
        // Der ganze Weg ist kein neuer Weg: Erst ein Teil der Abschnitte bietet den Knopf an.
        await expect(knopf).toHaveCount(0);
        await offen(page).locator('[data-testid$="-wahl-2"]').first().click();
        await knopf.first().click();
        const frage = offen(page).locator('[data-testid$="-neuer-weg"]').first();
        await expect(frage).toBeVisible();
        await expect(frage).toContainText("1 Abschnitt wird ein neuer Weg");
        await expect(frage.locator('[data-testid$="-neuer-weg-name"]').locator("input").first()).toHaveValue(
            "Reichsstraße 3",
        );
        await frage.getByRole("button", { name: "Abbrechen" }).click();
        await expect(frage).toHaveCount(0);
        expect(gesendet).toEqual([]);
    });
});
