import { expect, test, type Page, type Route } from "@playwright/test";
import type { EditorLandscapeDetail } from "@avesmaps3d/shared";
import { settleFrame } from "./map-handle.ts";
import { json, oeffneFlaechenWerkzeug, stellen, type Stelle } from "./landschaft-werkzeug-stub.ts";

/**
 * „Verschieben“ im Kartenmenü (WI-0178 Werkzeug 7; Betreiber 2026-10-19 „A“; EDIT-0004 §2.11): Die Fläche unter dem Rechtsklick kommt aus
 * den Kacheln der lokalen Karte, ihre Form, die Nachbarin, Sperre und Schreibweg aus Stubs. 🔴 Kein Test schreibt in die Datenbank der
 * Entwicklung.
 *
 * Problemfälle: Der Eintrag bleibt „Kommt später“; die Fläche hängt nicht an der Maus; das Absetzen schreibt sofort (wie Legacy) statt in
 * den Entwurf; „Fertig“ schreibt die Nachbarin mit oder einen anderen Versatz als den gezeigten; Esc ohne Absetzen schreibt etwas.
 */

const NACHBARIN = "a7a7a7a7-0000-4000-8000-0000000000a2";

/** Kartenkoordinaten einer Stelle der Leinwand, wie die Karte jetzt steht. */
const karte = (page: Page, p: { x: number; y: number }): Promise<[number, number]> =>
    page.evaluate((q) => {
        const k = globalThis.avesmapsRenderProjection!.fromRenderLngLat(globalThis.avesmapsMap!.unproject([q.x, q.y]));
        return [k.x, k.y] as [number, number];
    }, p);

interface Server {
    geschrieben: { url: string; body: unknown }[];
}

async function aufbau(page: Page): Promise<{ stelle: Stelle; server: Server; umriss: [number, number][] }> {
    const server: Server = { geschrieben: [] };
    const stub: { detail?: EditorLandscapeDetail } = {};
    await oeffneFlaechenWerkzeug(page, (route: Route) => {
        if (route.request().method() === "PATCH") {
            server.geschrieben.push({ url: route.request().url(), body: route.request().postDataJSON() });
            return route.fulfill(
                json(200, {
                    operationId: "a7a7a7a7-0000-4000-8000-0000000000e1",
                    status: "applied",
                    environment: "test",
                    affected: [],
                    derivedWork: [],
                    warnings: [],
                }),
            );
        }
        return route.fulfill(json(stub.detail === undefined ? 404 : 200, stub.detail ?? { message: "unbekannt" }));
    });
    const [stelle] = await stellen(page, [{ dx: 100, dy: 0 }]);
    // Ein Quadrat von 80 px um die Stelle; die Nachbarin teilt seine rechte Kante.
    const [l, o] = await karte(page, { x: stelle!.canvas.x - 40, y: stelle!.canvas.y - 40 });
    const [r, u] = await karte(page, { x: stelle!.canvas.x + 40, y: stelle!.canvas.y + 40 });
    const umriss: [number, number][] = [
        [l, o],
        [r, o],
        [r, u],
        [l, u],
    ];
    stub.detail = {
        id: stelle!.region,
        name: "Probewald",
        layer: "vegetation",
        circle: "halb-rechts",
        order: 1,
        clickLocked: false,
        areas: [{ id: stelle!.area, polygons: [[umriss]], affectsPaths: true, revision: 8 }],
        labels: [],
        neighbors: [],
        revision: 1,
    };
    await page.route(/\/api\/editor\/landscapes\/[^/]+\/targets/, (route) =>
        route.fulfill(
            json(200, {
                margin: 15,
                neighbors: [
                    {
                        id: NACHBARIN,
                        regionId: "a7a7a7a7-0000-4000-8000-000000000002",
                        name: "Nachbarin",
                        revision: 7,
                        polygons: [
                            [
                                [
                                    [r, o],
                                    [r + (r - l), o],
                                    [r + (r - l), u],
                                    [r, u],
                                ],
                            ],
                        ],
                    },
                ],
                edges: [],
                riverPoints: [],
            }),
        ),
    );
    await page.route(/\/api\/editor\/locks(\/(heartbeat|release|lift))?(\?.*)?$/, (route) => {
        const url = route.request().url();
        if (route.request().method() === "GET") return route.fulfill(json(200, { locks: [] }));
        if (url.endsWith("/release")) return route.fulfill({ status: 204 });
        if (url.endsWith("/heartbeat")) return route.fulfill(json(200, { lost: [] }));
        const body = route.request().postDataJSON() as Record<string, unknown>;
        return route.fulfill(
            json(200, {
                lock: {
                    ...body,
                    person: { id: "a7a7a7a7-0000-4000-8000-0000000000f1", name: "Rondrikan" },
                    since: "2026-10-19T08:00:00.000Z",
                    heartbeatAt: "2026-10-19T08:00:00.000Z",
                    own: true,
                },
            }),
        );
    });
    return { stelle: stelle!, server, umriss };
}

async function starte(page: Page, stelle: Stelle): Promise<void> {
    await page.mouse.click(stelle.x, stelle.y, { button: "right" });
    await page.getByTestId("context-editor-gruppe-form").hover();
    const eintrag = page.getByTestId("context-editor-flaeche-verschieben");
    await expect(eintrag).toBeEnabled();
    await eintrag.click();
    await expect(page.getByTestId("flaeche-verschieben-leiste")).toBeVisible();
    await settleFrame(page);
}

const ungespeichert = (page: Page) => page.getByTestId("flaeche-verschieben-leiste-ungespeichert");

test.use({ viewport: { width: 1920, height: 1080 } });

test("🔴 die Fläche hängt an der Maus, der Klick setzt sie im Entwurf ab, „Fertig“ schreibt nur sie, um genau den Versatz", async ({
    page,
}) => {
    const { stelle, server, umriss } = await aufbau(page);
    const griff = await karte(page, stelle.canvas);
    await starte(page, stelle);
    const leiste = page.getByTestId("flaeche-verschieben-leiste");
    await expect(leiste).toContainText("Fläche verschieben");
    await expect(leiste).toContainText("Probewald");
    await expect(ungespeichert(page)).toHaveText("0 ungespeichert");

    await page.mouse.move(stelle.x + 50, stelle.y, { steps: 5 });
    await page.mouse.move(stelle.x + 100, stelle.y, { steps: 5 });
    const ziel = await karte(page, { x: stelle.canvas.x + 100, y: stelle.canvas.y });
    await page.screenshot({ path: "test-results/werkzeug7-haengt.png" });
    await page.mouse.click(stelle.x + 100, stelle.y);
    // Abgesetzt ist ein Schritt im Entwurf, noch nichts geschrieben (Legacy schrieb hier sofort).
    await expect(ungespeichert(page)).toHaveText("1 ungespeichert");
    expect(server.geschrieben).toHaveLength(0);

    await page.getByTestId("flaeche-verschieben-leiste-fertig").click();
    await expect(leiste).toHaveCount(0);
    await expect.poll(() => server.geschrieben.length).toBe(1);
    expect(server.geschrieben[0]!.url).toMatch(new RegExp(`/api/editor/landscapes/${stelle.region}$`));
    const body = server.geschrieben[0]!.body as {
        areas: { id: string; baseRevision: number; polygons: number[][][][] }[];
    };
    // Nur die eigene Teilfläche: Die Nachbarin bleibt stehen, die gemeinsame Kante löst sich.
    expect(body.areas.map((a) => [a.id, a.baseRevision])).toEqual([[stelle.area, 8]]);
    const dx = ziel[0] - griff[0];
    const dy = ziel[1] - griff[1];
    expect(dx).toBeGreaterThan(0);
    const ring = body.areas[0]!.polygons[0]![0]!;
    for (const [i, [x, y]] of umriss.entries()) {
        expect(ring[i]![0]).toBeCloseTo(x + dx, 3);
        expect(ring[i]![1]).toBeCloseTo(y + dy, 3);
    }
    await expect(page.getByText("„Probewald“ verschoben.")).toBeVisible();
});

test("🔴 Esc, solange die Fläche noch hängt und nichts abgesetzt ist: der Modus endet, nichts wird geschrieben", async ({
    page,
}) => {
    const { stelle, server } = await aufbau(page);
    await starte(page, stelle);
    await page.mouse.move(stelle.x + 100, stelle.y, { steps: 5 });
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("flaeche-verschieben-leiste")).toHaveCount(0);
    expect(server.geschrieben).toHaveLength(0);
});
