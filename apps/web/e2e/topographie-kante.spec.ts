import { expect, test, type Page } from "@playwright/test";
import { settleFrame } from "./map-handle.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Die kräftige Kante der Topographie (OPS-000039; Probierseite „Topographie über dem Untergrund“, Thomas über den Betreiber 2026-10-19:
 * „kräftige kante“): an der laufenden Karte bei Greifenfurt, als Editor in der Ebene Topographie, mit dem Regler „Untergrund“ auf 0, 50 und
 * 100 %, in den Höhenlinien und den Höhenstufen. In den Höhenstufen färbt die Höhe das Land; dort stehen keine Topographie-Flächen, also auch
 * keine Kante (`topography.test.ts`). Liest nur.
 *
 * Problemfälle: Bei vollem Untergrund verschwinden die Flächen (Thomas' Bild); die Kante fehlt in einer Stellung oder Ansicht; der Saum
 * liegt über statt unter der Kante; die Küste der Meere wird mit dick.
 */

const GREIFENFURT = { x: 520, y: 571 };

async function zeige(page: Page, untergrund: number, topographie: "hoehenlinien" | "hoehenstufen"): Promise<void> {
    await page.addInitScript((wert) => {
        try {
            localStorage.setItem("avesmaps3d.untergrund", String(wert));
        } catch {
            // ohne Speicher gilt die Vorgabe
        }
    }, untergrund);
    await stubAdmin(page, {
        capabilities: ["use_editor_menu", "edit_map_objects", "edit_territories", "edit_landscapes"],
        role: "editor",
    });
    await page.goto(
        `/edit#x=${String(GREIFENFURT.x)}&y=${String(GREIFENFURT.y)}&z=5&view=landscapes&layer=topographie&topo=${topographie}`,
    );
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 60_000 });
    await page.evaluate(({ x, y }) => {
        const center = globalThis.avesmapsRenderProjection!.toRenderLngLat({ x, y });
        globalThis.avesmapsMap!.jumpTo({ center, zoom: 4.9 });
    }, GREIFENFURT);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 10_000 });
    await settleFrame(page);
}

/** Was der Stil an der Kante trägt, in der Reihenfolge des Stils. */
const kante = (page: Page) =>
    page.evaluate(() => {
        const map = globalThis.avesmapsMap! as unknown as {
            getStyle(): { layers: { id: string }[] };
            getPaintProperty(id: string, key: string): unknown;
        };
        const ids = map.getStyle().layers.map((l) => l.id);
        const wert = (id: string, key: string) => (ids.includes(id) ? map.getPaintProperty(id, key) : undefined);
        return {
            breite: wert("landscape-line-topographie", "line-width"),
            deckkraft: wert("landscape-line-topographie", "line-opacity"),
            // Den hellen Saum unter der Kante nahm der Betreiber am 2026-10-31 heraus (WI-0266: „ganz weg“).
            saum: ids.some((id) => id.startsWith("landscape-saum-")),
            kueste: wert("gewaesser-kante", "line-width"),
        };
    });

for (const breite of [1920, 1280]) {
    test.describe(`${String(breite)} px`, () => {
        test.use({ viewport: { width: breite, height: breite === 1920 ? 1080 : 800 } });
        for (const untergrund of [0, 50, 100])
            for (const topographie of ["hoehenlinien", "hoehenstufen"] as const)
                test(`🔴 ◐ ${String(untergrund)} %, ${topographie}: kräftige Kante ohne Saum (Höhenstufen: keine Flächen)`, async ({
                    page,
                }) => {
                    test.setTimeout(120_000);
                    await zeige(page, untergrund, topographie);
                    const stand = await kante(page);
                    if (topographie === "hoehenstufen") expect(stand).toMatchObject({ breite: undefined, saum: false });
                    else expect(stand).toMatchObject({ breite: 1.5, deckkraft: 1, saum: false });
                    if (stand.kueste !== undefined) expect(stand.kueste).toBeLessThan(1);
                    await page.screenshot({
                        path: `test-results/topographie-kante-${String(breite)}-${topographie}-${String(untergrund)}.png`,
                    });
                });
    });
}
