import { expect, test, type Page } from "@playwright/test";
import type { EditorPlaceList } from "@avesmaps3d/shared";
import { showPlace, settleFrame } from "./map-handle.ts";
import { FERDOK, GRATENFELS, GRATENFELS_LAGE, LISTE, fenster, oeffneOrtseditor } from "./ortseditor-stub.ts";

/**
 * Angehakte Orte leuchten auf der Karte (Betreiber 2026-10-20: „auf der karte, gelb markier wär auch toll“; WI-0243, Art `place` in
 * `map/mehrfach-markierung.ts`). Sie stehen im gelben Kreis der Einzelauswahl (`place-selection`); gezählt werden die gezeichneten Kreise.
 * Gratenfels und Ferdok aus dem Ort-Stub, dazu ein dritter Ort, den die lokale Karte am Kosch zeichnet.
 *
 * Problemfälle: Angehakt leuchtet nichts; abgehakt leuchtet es weiter; ausgeschaltet bleiben alle gelb.
 */

/** Ein dritter gezeichneter Ort mit Kennung, der nicht Gratenfels oder Ferdok ist. */
async function dritterOrt(page: Page): Promise<{ id: string; name: string }> {
    for (let versuch = 0; versuch < 20; versuch += 1) {
        const ort = await page.evaluate(
            ({ ohne }) => {
                const map = globalThis.avesmapsMap!;
                const ebenen = (map.getStyle().layers ?? [])
                    .map((l) => l.id)
                    .filter((id) => id.startsWith("place-marker"));
                for (const f of map.queryRenderedFeatures({ layers: ebenen })) {
                    const id = String(f.properties["public_id"] ?? "");
                    const name = String(f.properties["name"] ?? "").trim();
                    if (id !== "" && name !== "" && !ohne.includes(id)) return { id, name };
                }
                return undefined;
            },
            { ohne: [GRATENFELS, FERDOK] },
        );
        if (ort !== undefined) return ort;
        await page.waitForTimeout(500);
    }
    throw new Error("kein dritter gezeichneter Ort");
}

/** Die Orte, die gerade im Kreis der Auswahl stehen (ihre Kennungen). */
const kreise = (page: Page): Promise<string[]> =>
    page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        if (!map.getLayer("place-selection")) return [];
        return [
            ...new Set(
                map
                    .queryRenderedFeatures({ layers: ["place-selection"] })
                    .map((f) => String(f.properties["public_id"])),
            ),
        ].sort();
    });

test.use({ viewport: { width: 1920, height: 1080 } });

test("🔴 angehakte Orte stehen im gelben Kreis der Auswahl: drei angehakt, eins abgehakt, ausgeschaltet keiner", async ({
    page,
}) => {
    const liste: EditorPlaceList = { ...LISTE, rows: LISTE.rows.filter((row) => row.origin === "karte") };
    await oeffneOrtseditor(page, { liste, verb: false });
    await showPlace(page, GRATENFELS_LAGE, 7);
    const dritter = await dritterOrt(page);
    liste.rows.push({
        key: dritter.id,
        origin: "karte",
        name: dritter.name,
        circle: "voll",
        assignment: "assigned",
        subtype: "dorf",
        x: GRATENFELS_LAGE.x,
        y: GRATENFELS_LAGE.y,
    });
    await page.getByTestId("editorpanel-verb").click();
    await expect(fenster(page)).toHaveCount(1);
    const zeile = (name: string) =>
        fenster(page).locator('[data-testid$="-orte-zeile"]', {
            hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
        });
    await expect.poll(() => kreise(page)).toEqual([]);

    await fenster(page).locator('[data-testid$="-orte-mehrfach"]').click();
    for (const name of ["Gratenfels", "Ferdok", dritter.name]) await zeile(name).click();
    await expect(fenster(page).locator('[data-testid$="-orte-haken"]')).toContainText("3 angehakt");
    await settleFrame(page);
    await expect.poll(() => kreise(page), { timeout: 10_000 }).toContain(dritter.id);
    expect(await kreise(page)).toContain(GRATENFELS);
    // Kein Haken wählt einen Ort einzeln: Das Fenster zeigt keinen Ort, die Karte keinen gewählten.
    expect(await page.evaluate(() => globalThis.avesmapsSelectedSubject?.())).toBeFalsy();

    // Abhaken nimmt das Gelb sofort weg: In der Mehrfachauswahl wählt ein Klick den Ort nicht zusätzlich (WI-0243).
    await zeile(dritter.name).click();
    await expect(fenster(page).locator('[data-testid$="-orte-haken"]')).toContainText("2 angehakt");
    await expect.poll(() => kreise(page)).not.toContain(dritter.id);
    expect(await kreise(page)).toContain(GRATENFELS);

    await fenster(page).locator('[data-testid$="-orte-mehrfach"]').click();
    // Ausgeschaltet bleibt höchstens die zuletzt angeklickte Zeile gewählt (gemeinsame Liste), keine Haken mehr.
    await expect.poll(async () => (await kreise(page)).length).toBeLessThanOrEqual(1);
});
