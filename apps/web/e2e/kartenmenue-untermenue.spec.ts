import { expect, test } from "@playwright/test";
import { alsEditorAmLand, landAufSeite } from "./kartenmenue-stub.ts";

/**
 * Ein Klick auf einen Eintrag mit › öffnet sein Untermenü (Fund der Hauptorchestrierung auf der Stage 2026-10-19: „Neue Fläche ›“ ging
 * nur beim Darüberfahren auf, ein Klick öffnete nichts; am Telefon gibt es kein Darüberfahren). Das Darüberfahren bleibt. Der Klick
 * kommt hier ohne Zeigen davor (`dispatchEvent`), so wie ihn ein Tipp oder eine Tastatur auslöst; das Telefon prüft
 * `kartenmenue-untermenue.touch.spec.ts`.
 */
test.use({ viewport: { width: 1920, height: 1080 } });

test("🔴 ein Klick ohne Zeigen öffnet „Hier hinzufügen ›“ und darin „Neue Fläche ›“; ein Eintrag darin ist wählbar", async ({
    page,
}) => {
    await alsEditorAmLand(page);
    const at = await landAufSeite(page);
    await page.mouse.click(at.x, at.y, { button: "right" });
    const hier = page.getByTestId("context-editor-hier-hinzufuegen");
    await expect(hier).toBeVisible();
    // Der Zeiger steht fern vom Menü: Nur der Klick kann öffnen.
    await page.mouse.move(5, 5);
    await hier.dispatchEvent("click");
    await expect(page.getByTestId("context-editor-hier-hinzufuegen-unter")).toBeVisible();
    await expect(hier).toHaveAttribute("aria-expanded", "true");
    const neu = page.getByTestId("context-editor-neue-flaeche");
    await neu.dispatchEvent("click");
    const unter = page.getByTestId("context-editor-neue-flaeche-unter");
    await expect(unter).toBeVisible();
    await expect(neu).toHaveAttribute("aria-expanded", "true");
    await expect(unter.getByTestId("context-editor-neue-flaeche-vegetation")).toBeVisible();
});

test("das Darüberfahren öffnet weiter, und ein Klick danach schließt nichts", async ({ page }) => {
    await alsEditorAmLand(page);
    const at = await landAufSeite(page);
    await page.mouse.click(at.x, at.y, { button: "right" });
    await page.getByTestId("context-editor-hier-hinzufuegen").hover();
    await expect(page.getByTestId("context-editor-hier-hinzufuegen-unter")).toBeVisible();
    const neu = page.getByTestId("context-editor-neue-flaeche");
    await neu.hover();
    await expect(page.getByTestId("context-editor-neue-flaeche-unter")).toBeVisible();
    await neu.click();
    await expect(page.getByTestId("context-editor-neue-flaeche-unter")).toBeVisible();
});
