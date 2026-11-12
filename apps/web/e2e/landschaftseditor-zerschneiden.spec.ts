import { expect, test, type Page } from "@playwright/test";
import type { EditorLandscapeDetail } from "@avesmaps3d/shared";
import { json, oeffneFlaechenWerkzeug, stellen, type Stelle } from "./landschaft-werkzeug-stub.ts";

/**
 * „Zerschneiden“ im Kartenmenü (WI-0178 Werkzeug 5, Betreiber 2026-10-19; EDIT-0004 §2.10): Die Fläche unter dem Rechtsklick kommt aus
 * den Kacheln der lokalen Karte, ihre Form aus dem Detail eines Stubs, das Schreiben fängt ein Stub. 🔴 Kein Test schreibt in die
 * Datenbank der Entwicklung.
 *
 * Problemfälle: Der Eintrag bleibt „Kommt später“; die Leiste erscheint nicht; „Fertig“ schreibt andere Punkte als die gezeichneten oder
 * gegen eine geratene Revision; Esc mit gezeichneter Linie verwirft ohne Frage oder schreibt etwas.
 */

/** Ein Quadrat von 80 px um eine Stelle der Leinwand, in Kartenkoordinaten. */
async function quadratUm(page: Page, m: { x: number; y: number }): Promise<[number, number][][][]> {
    return page.evaluate((p) => {
        const map = globalThis.avesmapsMap!;
        const projektion = globalThis.avesmapsRenderProjection!;
        const karte = (x: number, y: number) => {
            const k = projektion.fromRenderLngLat(map.unproject([x, y]));
            return [k.x, k.y] as [number, number];
        };
        return [
            [
                [
                    karte(p.x - 40, p.y - 40),
                    karte(p.x + 40, p.y - 40),
                    karte(p.x + 40, p.y + 40),
                    karte(p.x - 40, p.y + 40),
                ],
            ],
        ];
    }, m);
}

interface Aufruf {
    url: string;
    body: Record<string, unknown>;
}

async function aufbau(page: Page): Promise<{ stelle: Stelle; schreiben: Aufruf[] }> {
    const stub: { detail?: EditorLandscapeDetail } = {};
    await oeffneFlaechenWerkzeug(page, (route) =>
        route.fulfill(json(stub.detail === undefined ? 404 : 200, stub.detail ?? { message: "unbekannt" })),
    );
    const schreiben: Aufruf[] = [];
    await page.route(/\/api\/editor\/landscapes\/[^/]+\/split$/, (route) => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        schreiben.push({ url: route.request().url(), body });
        const region = /landscapes\/([^/]+)\/split$/.exec(route.request().url())?.[1] ?? "";
        return route.fulfill(
            json(200, {
                operationId: body["operationId"],
                status: "applied",
                environment: "test",
                affected: [{ kind: "landscape", id: region, revision: 2 }],
                derivedWork: [],
                warnings: [],
                name: "Probewald",
            }),
        );
    });
    const [stelle] = await stellen(page, [
        { dx: -60, dy: 0 },
        { dx: 60, dy: 0 },
    ]);
    stub.detail = {
        id: stelle!.region,
        name: "Probewald",
        layer: "vegetation",
        circle: "halb-rechts",
        order: 1,
        clickLocked: false,
        areas: [{ id: stelle!.area, polygons: await quadratUm(page, stelle!.canvas), affectsPaths: true, revision: 8 }],
        labels: [],
        neighbors: [],
        revision: 1,
    };
    return { stelle: stelle!, schreiben };
}

async function starte(page: Page, stelle: Stelle): Promise<void> {
    await page.mouse.click(stelle.x, stelle.y, { button: "right" });
    await page.getByTestId("context-editor-gruppe-form").hover();
    const eintrag = page.getByTestId("context-editor-flaeche-zerschneiden");
    await expect(eintrag).toBeEnabled();
    await eintrag.click();
    await expect(page.getByTestId("zerschneiden-leiste")).toBeVisible();
}

test("🔴 eine Linie quer durch die Fläche, Enter: EINE Operation mit genau den zwei gezeichneten Punkten gegen die Revision des Details", async ({
    page,
}) => {
    const { stelle, schreiben } = await aufbau(page);
    await starte(page, stelle);
    await expect(page.getByTestId("zerschneiden-leiste")).toContainText("Probewald");
    await page.mouse.click(stelle.x - 60, stelle.y);
    await page.waitForTimeout(450);
    await page.mouse.click(stelle.x + 60, stelle.y);
    await expect(page.getByTestId("zerschneiden-leiste-ungespeichert")).toContainText("1");
    await page.screenshot({ path: "test-results/werkzeug5-linie.png" });
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("zerschneiden-leiste")).toHaveCount(0);
    expect(schreiben).toHaveLength(1);
    expect(schreiben[0]!.url).toContain(`/landscapes/${stelle.region}/split`);
    expect(schreiben[0]!.body).toMatchObject({ areaId: stelle.area, baseRevision: 8 });
    const linie = schreiben[0]!.body["line"] as [number, number][];
    expect(linie).toHaveLength(2);
    // Links und rechts außerhalb der Fläche, auf derselben Höhe.
    expect(linie[0]![0]).toBeLessThan(linie[1]![0]);
    expect(Math.abs(linie[0]![1] - linie[1]![1])).toBeLessThan(0.5);
    await expect(page.getByText("das Stück ist jetzt eine eigene Landschaft")).toBeVisible();
});

test("🔴 Esc mit gezeichneter Linie fragt erst; das zweite Esc verwirft, ohne zu schreiben", async ({ page }) => {
    const { stelle, schreiben } = await aufbau(page);
    await starte(page, stelle);
    await page.mouse.click(stelle.x - 60, stelle.y);
    await page.waitForTimeout(450);
    await page.mouse.click(stelle.x + 60, stelle.y);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("zerschneiden-leiste-frage")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("zerschneiden-leiste")).toHaveCount(0);
    expect(schreiben).toHaveLength(0);
});
