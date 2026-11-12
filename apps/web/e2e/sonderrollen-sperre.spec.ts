import { expect, test, type Page } from "@playwright/test";
import { EDITOR_MODE } from "./map-handle.ts";
import { oeffneGebirge, probegebirge } from "./gebirge-stub.ts";

/**
 * Die Sperre der Sonderrollen in der Derographie (WI-0279, Paket 6; E2, E2a): Ein normaler Editor ändert Eigenschaften, aber Form und Gebirge stehen grau mit der zuständigen
 * Sonderrolle; ein Derograph bekommt die Form, das Gebirge nur der Topograph. Die Rechte prüft der Server (`sonderrollen-durchsetzung.test.ts`), hier nur, was man sieht.
 */
const reiter = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });
const FORM = "edit_landscape_form";
const GEBIRGE = "edit_mountains";

test("🔴 ein Editor ohne Sonderrolle: „Form“ und „Gebirge“ grau mit der Sonderrolle, Ebene und Art eines Gebirges stehen still, der Name bleibt", async ({
    page,
}) => {
    await oeffneGebirge(page, probegebirge(), EDITOR_MODE, [FORM, GEBIRGE]);
    await expect(reiter(page, "Form")).toHaveAttribute("aria-disabled", "true");
    await expect(reiter(page, "Form")).toHaveAttribute("title", "nur mit der Sonderrolle Derograph oder Topograph");
    await expect(reiter(page, "Gebirge")).toHaveAttribute("aria-disabled", "true");
    await expect(reiter(page, "Gebirge")).toHaveAttribute("title", "nur mit der Sonderrolle Topograph");
    // Der Klick geht auf den grauen Reiter selbst: Playwright wartet sonst, bis er frei wird.
    await reiter(page, "Gebirge").click({ force: true });
    await expect(reiter(page, "Eigenschaften")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId(/^landschaftseditor-fenster-\d+-feld-name$/).locator("input")).toBeEnabled();
    for (const feld of [/^landschaftseditor-fenster-\d+-feld-ebene$/, /^landschaftseditor-fenster-\d+-feld-art$/]) {
        const auswahl = page.getByTestId(feld).locator("select");
        await expect(auswahl).toBeDisabled();
        await expect(auswahl).toHaveAttribute("title", "nur mit der Sonderrolle Topograph");
    }
    await expect(page.getByTestId(/^landschaftseditor-fenster-\d+-entfernen-abschnitt$/)).toHaveCount(0);
});

test("🔴 ein Derograph: die Form ja, „Gebirge“ grau", async ({ page }) => {
    await oeffneGebirge(page, probegebirge(), EDITOR_MODE, [GEBIRGE]);
    await expect(reiter(page, "Form")).not.toHaveAttribute("aria-disabled", "true");
    await expect(reiter(page, "Gebirge")).toHaveAttribute("aria-disabled", "true");
    await reiter(page, "Form").click();
    await expect(reiter(page, "Form")).toHaveAttribute("aria-selected", "true");
});

test("🔴 mit allen Rechten steht nichts grau: So sehen es Admins und Betreiber", async ({ page }) => {
    await oeffneGebirge(page, probegebirge());
    for (const name of ["Form", "Gebirge"]) {
        await expect(reiter(page, name)).not.toHaveAttribute("aria-disabled", "true");
    }
    await reiter(page, "Gebirge").click();
    await expect(reiter(page, "Gebirge")).toHaveAttribute("aria-selected", "true");
});
