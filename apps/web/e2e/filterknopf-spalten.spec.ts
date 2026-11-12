import { expect, test } from "@playwright/test";
import type { EditorPlaceList } from "@avesmaps3d/shared";
import { LISTE, fenster, oeffneOrtseditor } from "./ortseditor-stub.ts";

/**
 * Die Abschnitte im Blatt des Trichters verteilen sich gleichmäßig auf die Spalten (WI-0206, EDIT-0003 T36). Betreiber 2026-10-16:
 * „eine zelle mit den gebäuden ist riesengroß -also irgendwie dass sich die filter kategorien gleichmäßig aufteilen. wichtig: das soll
 * bei allen solchen filtern passieren“. Geprüft an der Ortsliste, weil sie den langen Abschnitt hat („Art“, lokal 302 Werte); das
 * Bauteil ist für alle Listen dasselbe (`controls/avm-filterknopf.vue`).
 */

/** Die Ortsliste mit 40 Bauwerken verschiedener Art: „Art“ wird lang, die übrigen Abschnitte bleiben kurz. */
const MIT_VIELEN_ARTEN: EditorPlaceList = {
    ...LISTE,
    rows: [
        ...LISTE.rows,
        ...Array.from({ length: 40 }, (_, i) => ({
            key: `wiki:bauwerk-${String(i).padStart(2, "0")}`,
            origin: "wiki" as const,
            name: `Bauwerk ${String(i).padStart(2, "0")}`,
            circle: "leer" as const,
            assignment: "none" as const,
            subtype: "gebaeude",
            kind: `Art ${String(i).padStart(2, "0")}`,
        })),
    ],
};

test.use({ viewport: { width: 1600, height: 1000 } });

test("🔴 T36: die Abschnitte verteilen sich gleichmäßig, ein langer läuft in die zweite Spalte weiter", async ({
    page,
}) => {
    await oeffneOrtseditor(page, { liste: MIT_VIELEN_ARTEN });
    await fenster(page).locator('[data-testid$="-orte-filter"]').click();
    const blatt = page.locator('[data-testid$="-orte-filter-blatt"]');
    await expect(blatt.locator('[data-testid$="-orte-filter-art"]')).toBeVisible();

    const mass = await blatt.evaluate((element) => {
        // Was die Abschnitte zeigen (Titel und Kästchen), in Bildpunkten; eine Zelle, die ein Raster auf Zeilenhöhe streckt, zählt nicht.
        const teile = [...element.querySelectorAll("fieldset legend, fieldset label")].map((teil) =>
            teil.getBoundingClientRect(),
        );
        const mitte = element.getBoundingClientRect().left + element.clientWidth / 2;
        const summe = teile.reduce((s, r) => s + r.height, 0);
        const spanne = Math.max(...teile.map((r) => r.bottom)) - Math.min(...teile.map((r) => r.top));
        return { spanne, haelfte: summe / 2, rechts: teile.filter((r) => r.left >= mitte).length };
    });
    // Gleichmäßig verteilt heißt: Der Inhalt ist kaum höher als die Hälfte aller Abschnitte zusammen (gemessen 1,28; den Rest machen
    // die Fugen zwischen den Kästchen). Das alte Raster legte jede Zeile so hoch wie ihren längsten Abschnitt, „Art“ mit 40 Werten
    // neben „Quelle“ mit zwei: gemessen 2,10.
    expect(mass.rechts).toBeGreaterThan(10);
    expect(mass.spanne / mass.haelfte).toBeLessThan(1.5);
});

test("am Telefon bleibt es EINE Spalte, in der Reihenfolge der Abschnitte", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await oeffneOrtseditor(page, { liste: MIT_VIELEN_ARTEN });
    await fenster(page).locator('[data-testid$="-orte-filter"]').click();
    const blatt = page.locator('[data-testid$="-orte-filter-blatt"]');
    await expect(blatt.locator("fieldset").first()).toBeVisible();
    const links = await blatt
        .locator("fieldset legend")
        .evaluateAll((legenden) => legenden.map((legende) => Math.round(legende.getBoundingClientRect().left)));
    expect(new Set(links).size).toBe(1);
});
