import { expect, test, type Page } from "@playwright/test";
import { onPage, settleFrame } from "./map-handle.ts";

/**
 * Überfahren und Wählen eines Sees folgen der weichen Form (Betreiber 2026-10-04: „der see wird angezeigt, aber
 * ungeglättet“). In „Alle“ kommt der See aus der Sicht `terrain_water_render`; Kontur und Leuchten lesen dieselbe Quelle,
 * nicht die eckige Fläche der Landschaftskacheln.
 */

/** Die Mitte des Ochsenwassers, dem größten See Aventuriens (Kartenkoordinaten, Legacy-Bestand). */
const OCHSENWASSER = { x: 597.841, y: 549.016 };

async function openAtLake(page: Page): Promise<{ x: number; y: number }> {
    await page.goto(
        `/#x=${String(OCHSENWASSER.x)}&y=${String(OCHSENWASSER.y)}&z=7.5&series=original&view=landscapes&layer=alle`,
    );
    await page.waitForFunction(
        () => {
            const map = globalThis.avesmapsMap;
            return (
                map?.isStyleLoaded() === true &&
                map.loaded() &&
                map.queryRenderedFeatures({ layers: ["gewaesser-flaeche"] }).length > 0
            );
        },
        undefined,
        { timeout: 30_000 },
    );
    await settleFrame(page);
    // Ein Punkt im See rechts vom Planer: dort fängt kein Panel den Zeiger.
    const point = await page.evaluate(() => {
        const map = globalThis.avesmapsMap;
        if (!map) throw new Error("map handle missing");
        const canvas = map.getCanvas();
        for (let y = 200; y < canvas.clientHeight - 200; y += 25) {
            for (let x = 480; x < canvas.clientWidth - 200; x += 25) {
                const hits = map.queryRenderedFeatures([x, y], { layers: ["gewaesser-flaeche"] });
                if (hits.some((hit) => hit.properties["region_type"] === "see")) return { x, y };
            }
        }
        return undefined;
    });
    if (!point) throw new Error("kein See im Bild");
    // Gesucht in Kartenkoordinaten, geklickt in Seitenkoordinaten (im Editor-Modus steht über der Karte die Kopfleiste).
    return onPage(page, point);
}

test("🔴 ein Klick auf den See in „Alle“ wählt ihn, und er leuchtet in der weichen Form", async ({ page }) => {
    const point = await openAtLake(page);
    await page.mouse.click(point.x, point.y);
    await expect.poll(() => page.evaluate(() => globalThis.avesmapsAreaSelection?.()?.type)).toBe("see");
    // Die Hervorhebung liest die weiche Quelle, nicht die Landschaftskacheln.
    const source = await page.evaluate(
        () =>
            (
                globalThis.avesmapsMap?.getStyle() as unknown as { layers: { id: string; source?: string }[] }
            ).layers.find((layer) => layer.id === "area-selection-fill")?.source,
    );
    expect(source).toBe("gewaesser");
    await settleFrame(page);
    const lit = await page.evaluate(
        () => globalThis.avesmapsMap?.queryRenderedFeatures({ layers: ["area-selection-fill"] }).length ?? 0,
    );
    expect(lit, "die gewählte Fläche ist gezeichnet").toBeGreaterThan(0);
});

test("🔴 das Überfahren des Sees zeigt die Kontur an der weichen Form", async ({ page }) => {
    const point = await openAtLake(page);
    await page.mouse.move(point.x - 10, point.y - 10);
    await page.mouse.move(point.x, point.y, { steps: 4 });
    await page.waitForTimeout(300);
    // Seit WI-0266 ist die Vorschau EINE Ebene (`area-preview-outline`) an einer kleinen eigenen Quelle. Wo die Karte den See an der weichen Form
    // zeichnet (`gewaesser-flaeche` steht im Stil, siehe `openAtLake`), liest die Eingabe die Linien aus den Kacheln des Wassers; hier steht sie.
    const layer = await page.evaluate(() =>
        (globalThis.avesmapsMap?.getStyle() as unknown as { layers: { id: string; source?: string }[] }).layers.find(
            (entry) => entry.id === "area-preview-outline",
        ),
    );
    expect(layer?.source, "die Vorschau-Ebene hängt an ihrer eigenen Quelle").toBe("area-preview-outline");
    await expect
        .poll(() =>
            page.evaluate(() => {
                const map = globalThis.avesmapsMap as unknown as
                    | { getSource(id: string): { serialize(): { data?: { features?: unknown[] } } } | undefined }
                    | undefined;
                return map?.getSource("area-preview-outline")?.serialize().data?.features?.length ?? 0;
            }),
        )
        .toBeGreaterThan(0);
});
