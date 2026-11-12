import { expect, test } from "@playwright/test";
import { EDITOR_MODE, openMap } from "./map-handle.ts";
import { ORTSEDITOR_RECHTE } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Das Editorpanel am Telefon (WI-0128 E3, EDIT-0001 §7.1 E3): Es startet eingeklappt, auch mit Tiefem Link; die Lasche öffnet
 * es über die volle Höhe, ✕ schließt es, und der Planer geht dabei zu (Planer und Slot schließen einander aus).
 *
 * 🪤 Seit `3c75c88d` („ohne Anmeldung überall die Besucheransicht“) braucht das Panel eine Sitzung mit `use_editor_menu`.
 */
test.beforeEach(async ({ page }) => {
    await stubAdmin(page, { capabilities: ORTSEDITOR_RECHTE, role: "editor" });
});
test("🔴 am Telefon startet das Editorpanel eingeklappt; die Lasche öffnet, ✕ schließt", async ({ page }) => {
    await openMap(page, `${EDITOR_MODE}?tab=karteninhalte`);
    const panel = page.getByTestId("editor-panel");
    await expect(panel).toBeHidden();
    await page.getByTestId("editor-panel-tab").tap();
    await expect(panel).toBeVisible();
    // Volle Höhe, keine Lasche, solange es offen ist.
    const box = (await panel.boundingBox())!;
    const hoehe = page.viewportSize()!.height;
    expect(box.y + box.height).toBeGreaterThan(hoehe - 2);
    await expect(page.getByTestId("editor-panel-tab")).toHaveCount(0);
    // Die Karteninhalte als Kacheln in zwei Spalten, ohne Überlauf (WI-0212, EDIT-0003 T37). Gemessen wird nach der Fahrt des Panels.
    await panel.evaluate((el) =>
        Promise.all(
            el
                .closest(".editor-panel")!
                .getAnimations({ subtree: true })
                .map((fahrt) => fahrt.finished),
        ),
    );
    const [eins, zwei] = [
        (await page.getByTestId("editorpanel-kachel-orte").boundingBox())!,
        (await page.getByTestId("editorpanel-kachel-territorien").boundingBox())!,
    ];
    expect(Math.abs(eins.y - zwei.y)).toBeLessThan(1);
    expect(zwei.x).toBeGreaterThan(eins.x + eins.width - 1);
    const flaeche = (await panel.boundingBox())!;
    expect(zwei.x + zwei.width).toBeLessThanOrEqual(flaeche.x + flaeche.width);
    const ueberlauf = await panel.evaluate(
        (el) =>
            [...el.querySelectorAll<HTMLElement>(".editor-panel__rumpf, .kacheln, .kachel, .steckbrief")].filter(
                (teil) => teil.scrollWidth > teil.clientWidth + 1,
            ).length,
    );
    expect(ueberlauf).toBe(0);
    await page.getByTestId("editor-panel-close").tap();
    await expect(panel).toBeHidden();
    await expect(page.getByTestId("editor-panel-tab")).toBeVisible();
});
