import { expect, test } from "@playwright/test";
import { alsEditorAmLand, landAufSeite } from "./kartenmenue-stub.ts";

/**
 * Am Telefon gibt es kein Darüberfahren (Fund der Hauptorchestrierung auf der Stage 2026-10-19): Ein Tipp auf einen Eintrag mit › öffnet
 * sein Untermenü, darunter im Menü (bis 640 px). Das Menü selbst öffnet der lange Druck (WI-0108).
 */
test("🔴 Telefon: langer Druck öffnet das Kartenmenü, ein Tipp „Hier hinzufügen ›“, ein zweiter „Neue Fläche ›“ mit den Ebenen", async ({
    page,
}) => {
    await alsEditorAmLand(page);
    const at = await landAufSeite(page);
    const client = await page.context().newCDPSession(page);
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...at, id: 0 }] });
    await page.waitForTimeout(800);
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const hier = page.getByTestId("context-editor-hier-hinzufuegen");
    await expect(hier).toBeVisible();
    await hier.tap();
    await expect(page.getByTestId("context-editor-hier-hinzufuegen-unter")).toBeVisible();
    const neu = page.getByTestId("context-editor-neue-flaeche");
    await neu.tap();
    const unter = page.getByTestId("context-editor-neue-flaeche-unter");
    await expect(unter).toBeVisible();
    await expect(unter.getByTestId("context-editor-neue-flaeche-vegetation")).toBeVisible();
    await page.screenshot({ path: "test-results/kartenmenue-untermenue-telefon.png" });
});
