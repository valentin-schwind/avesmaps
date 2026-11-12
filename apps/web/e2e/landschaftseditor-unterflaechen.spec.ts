import { expect, test, type Page } from "@playwright/test";
import type { EditorLandscapeDetail } from "@avesmaps3d/shared";
import { json, oeffneFlaechenWerkzeug, stellen, type Stelle } from "./landschaft-werkzeug-stub.ts";

/**
 * „Unterflächen ›“ im Kartenmenü (WI-0178 Werkzeug 3, Thomas 4.1; EDIT-0004 §2.8): Die Fläche unter dem Rechtsklick kommt aus den
 * Kacheln der lokalen Karte, ihre Stücke aus dem Detail eines Stubs, das Schreiben fängt ein Stub. 🔴 Kein Test schreibt in die
 * Datenbank der Entwicklung.
 *
 * Problemfälle: Die Einträge bleiben „Kommt später“; vorgewählt ist nicht das Stück unter dem Rechtsklick; Zeigen wählt kein anderes
 * Stück; der Klick nimmt ein anderes Stück als das darunter oder schreibt gegen eine geratene Revision; „Alle vereinigen“ verlangt eine
 * Wahl.
 */

/** Zwei Stücke als Quadrate um Bildpunkte der Leinwand, in Kartenkoordinaten (je 40 px Kantenlänge). */
async function zweiStuecke(page: Page, a: { x: number; y: number }, b: { x: number; y: number }) {
    return page.evaluate(
        ([p, q]) => {
            const map = globalThis.avesmapsMap!;
            const projektion = globalThis.avesmapsRenderProjection!;
            const karte = (x: number, y: number) => {
                const m = projektion.fromRenderLngLat(map.unproject([x, y]));
                return [m.x, m.y] as [number, number];
            };
            const quadrat = (m: { x: number; y: number }) => [
                [
                    karte(m.x - 20, m.y - 20),
                    karte(m.x + 20, m.y - 20),
                    karte(m.x + 20, m.y + 20),
                    karte(m.x - 20, m.y + 20),
                ],
            ];
            return [quadrat(p!), quadrat(q!)];
        },
        [a, b],
    );
}

interface Aufruf {
    url: string;
    body: Record<string, unknown>;
}

/** Öffnet die Karte, wählt eine Stelle mit Platz rechts daneben und gibt der Teilfläche dort zwei Stücke (Revision 5). */
async function aufbau(page: Page): Promise<{ stelle: Stelle; rechts: { x: number; y: number }; schreiben: Aufruf[] }> {
    const stub: { detail?: EditorLandscapeDetail } = {};
    await oeffneFlaechenWerkzeug(page, (route) =>
        route.fulfill(json(stub.detail === undefined ? 404 : 200, stub.detail ?? { message: "unbekannt" })),
    );
    const schreiben: Aufruf[] = [];
    await page.route(/\/api\/editor\/landscapes\/[^/]+\/parts$/, (route) => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        schreiben.push({ url: route.request().url(), body });
        const region = /landscapes\/([^/]+)\/parts$/.exec(route.request().url())?.[1] ?? "";
        return route.fulfill(
            json(200, {
                operationId: body["operationId"],
                status: "applied",
                environment: "test",
                affected: [{ kind: "landscape", id: region, revision: 2 }],
                derivedWork: [],
                warnings: [],
                partsBefore: 2,
                partsAfter: 1,
            }),
        );
    });
    const [stelle] = await stellen(page, [{ dx: 80, dy: 0 }]);
    const teile = await zweiStuecke(page, stelle!.canvas, { x: stelle!.canvas.x + 80, y: stelle!.canvas.y });
    stub.detail = {
        id: stelle!.region,
        name: "Probewald",
        layer: "vegetation",
        circle: "halb-rechts",
        order: 1,
        clickLocked: false,
        areas: [{ id: stelle!.area, polygons: teile, affectsPaths: true, revision: 5 }],
        labels: [],
        neighbors: [],
        revision: 1,
    };
    return { stelle: stelle!, rechts: { x: stelle!.x + 80, y: stelle!.y }, schreiben };
}

async function waehleEintrag(page: Page, stelle: Stelle, eintrag: string): Promise<void> {
    await page.mouse.click(stelle.x, stelle.y, { button: "right" });
    await page.getByTestId("context-editor-gruppe-unter").hover();
    const zeile = page.getByTestId(`context-editor-${eintrag}`);
    await expect(zeile).toBeEnabled();
    await zeile.click();
    await expect(page.getByTestId("context-editor")).toHaveCount(0);
}

test("🔴 löschen: vorgewählt das Stück unter dem Rechtsklick, Zeigen wählt das andere, der Klick schreibt genau dieses", async ({
    page,
}) => {
    const { stelle, rechts, schreiben } = await aufbau(page);
    await waehleEintrag(page, stelle, "unterflaeche-loeschen");
    const leiste = page.getByTestId("unterflaechen-leiste");
    await expect(leiste).toContainText("Probewald · Teil 1 von 2");
    await page.mouse.move(rechts.x, rechts.y, { steps: 4 });
    await expect(leiste).toContainText("Teil 2 von 2");
    expect(schreiben).toHaveLength(0);
    await page.screenshot({ path: "test-results/werkzeug3-wahl.png" });
    await page.mouse.click(rechts.x, rechts.y);
    await expect(leiste).toHaveCount(0);
    expect(schreiben).toHaveLength(1);
    expect(schreiben[0]!.url).toContain(`/landscapes/${stelle.region}/parts`);
    expect(schreiben[0]!.body).toMatchObject({ operation: "loeschen", areaId: stelle.area, baseRevision: 5, part: 1 });
});

test("🔴 „Alle Unterflächen vereinigen“ schreibt ohne Wahl und sagt, was blieb; Esc beendet das Herauslösen, ohne zu schreiben", async ({
    page,
}) => {
    const { stelle, schreiben } = await aufbau(page);
    await waehleEintrag(page, stelle, "unterflaechen-vereinigen");
    await expect(page.getByTestId("unterflaechen-leiste")).toHaveCount(0);
    await expect.poll(() => schreiben.length).toBe(1);
    expect(schreiben[0]!.body).toMatchObject({ operation: "vereinigen", areaId: stelle.area, baseRevision: 5 });
    expect(schreiben[0]!.body).not.toHaveProperty("part");
    await expect(page.getByText("jetzt eine Fläche")).toBeVisible();

    await waehleEintrag(page, stelle, "unterflaeche-herausloesen");
    await expect(page.getByTestId("unterflaechen-leiste")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("unterflaechen-leiste")).toHaveCount(0);
    expect(schreiben).toHaveLength(1);
});
