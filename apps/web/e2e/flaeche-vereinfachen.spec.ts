import { expect, test, type Page, type Route } from "@playwright/test";
import type { EditorLandscapeDetail, EditorLandscapeList } from "@avesmaps3d/shared";
import { EDITOR_MODE, onPage, settleFrame } from "./map-handle.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * „Fläche vereinfachen“ im Browser (WI-0233; Thomas 4.1, Werkzeug 4 der Derographie; EDIT-0003 G4, T27 (4), (7), T44). Die Fläche unter
 * dem Rechtsklick kommt aus den Kacheln der lokalen Karte wie in `landschaftseditor-kartenmenue.spec.ts`; Detail, Andockziele, Sperre und
 * Schreibweg aus Stubs. 🔴 Kein Test schreibt in die Datenbank der Entwicklung.
 *
 * Problemfälle: Der Eintrag startet keinen Modus; die Leiste zeigt keinen Regler oder keine Zahlen; die gemeinsame Grenze mit der
 * Nachbarin wird ausgedünnt (Lücke); die Ecke am Fluss fällt weg; ↶ lässt den Regler stehen; „Fertig“ schreibt die Nachbarin mit oder
 * schreibt nichts; die Sperre bleibt nach dem Ende stehen.
 */

/** Eine Stelle mit Flächen in allen drei Ebenen (wie `landschaftseditor-kartenmenue.spec.ts`). */
const LAND = { x: 450, y: 560 };
const FLAECHE = "a4a4a4a4-0000-4000-8000-0000000000a1";
const NACHBARIN = "a4a4a4a4-0000-4000-8000-0000000000a2";

/** Ein Viereck 440..460 × 550..570 mit elf Ecken je Seite; die rechte Seite teilt es mit der Nachbarin, oben liegt ein Flusspunkt. */
const seite = (von: [number, number], bis: [number, number]): [number, number][] =>
    Array.from({ length: 10 }, (_, i) => [
        von[0] + ((bis[0] - von[0]) * i) / 10,
        von[1] + ((bis[1] - von[1]) * i) / 10,
    ]);
const UMRISS: [number, number][] = [
    ...seite([440, 550], [460, 550]),
    ...seite([460, 550], [460, 570]),
    ...seite([460, 570], [440, 570]),
    ...seite([440, 570], [440, 550]),
];
const GRENZE = UMRISS.filter(([x]) => x === 460);
const FLUSS: [number, number] = [452, 570];

const DETAIL: EditorLandscapeDetail = {
    id: "a4a4a4a4-0000-4000-8000-000000000001",
    name: "Probe",
    layer: "vegetation",
    circle: "halb-rechts",
    order: 1,
    clickLocked: false,
    areas: [{ id: FLAECHE, polygons: [[UMRISS]], affectsPaths: true, revision: 4 }],
    labels: [],
    neighbors: [],
    revision: 1,
};

interface Server {
    sperren: string[];
    geschrieben: { url: string; body: unknown }[];
}

async function oeffne(page: Page): Promise<Server> {
    const server: Server = { sperren: [], geschrieben: [] };
    const json = (route: Route, status: number, body: unknown) =>
        route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    await stubAdmin(page, {
        capabilities: [
            "use_editor_menu",
            "edit_map_objects",
            "edit_map_geometry",
            "edit_territories",
            "edit_landscapes",
            "edit_territory_form",
            "edit_landscape_form",
            "edit_mountains",
        ],
        role: "editor",
    });
    await page.route("**/api/editor/status", (route) => json(route, 200, { mapEditing: "testwelt" }));
    await page.route("**/api/editor/landscapes", (route) => json(route, 200, liste));
    await page.route("**/api/editor/landscapes/*", (route) => {
        if (route.request().method() !== "PATCH") return json(route, 200, DETAIL);
        server.geschrieben.push({ url: route.request().url(), body: route.request().postDataJSON() });
        return json(route, 200, {
            operationId: "a4a4a4a4-0000-4000-8000-0000000000e1",
            status: "applied",
            environment: "test",
            affected: [],
            derivedWork: [],
            warnings: [],
            mapRevision: 4712,
        });
    });
    await page.route(/\/api\/editor\/landscapes\/[^/]+\/targets/, (route) =>
        json(route, 200, {
            margin: 15,
            neighbors: [
                {
                    id: NACHBARIN,
                    regionId: "a4a4a4a4-0000-4000-8000-000000000002",
                    name: "Nachbarin",
                    revision: 7,
                    polygons: [[[...GRENZE, [480, 570], [480, 550]]]],
                },
            ],
            edges: [],
            riverPoints: [{ pathId: "a4a4a4a4-0000-4000-8000-0000000000c1", name: "Gadang", x: FLUSS[0], y: FLUSS[1] }],
        }),
    );
    await page.route(/\/api\/editor\/locks(\/(heartbeat|release|lift))?(\?.*)?$/, (route) => {
        const url = route.request().url();
        if (route.request().method() === "GET") return json(route, 200, { locks: [] });
        server.sperren.push(url.slice(url.indexOf("/api/editor/locks")));
        if (url.endsWith("/release")) return route.fulfill({ status: 204 });
        if (url.endsWith("/heartbeat")) return json(route, 200, { lost: [] });
        const body = route.request().postDataJSON() as { kind: string; id: string; part: string };
        return json(route, 200, {
            lock: {
                ...body,
                person: { id: "a4a4a4a4-0000-4000-8000-0000000000f1", name: "Rondrikan" },
                since: "2026-10-19T08:00:00.000Z",
                heartbeatAt: "2026-10-19T08:00:00.000Z",
                own: true,
            },
        });
    });
    await page.goto(
        `${EDITOR_MODE}?r=vereinfachen#x=${String(LAND.x)}&y=${String(LAND.y)}&z=6.5&series=original&view=landscapes&layer=vegetation`,
    );
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 30_000 });
    await settleFrame(page);
    return server;
}

let liste: EditorLandscapeList = { rows: [] };

/** Eine Stelle nahe der Mitte, an der genau eine Landschaft der Ebene liegt. */
async function stelle(page: Page): Promise<{ at: { x: number; y: number }; id: string }> {
    const gefunden = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const ids = (map.getStyle().layers ?? []).map((l) => l.id).filter((id) => id.startsWith("landscape-fill-"));
        const mitte = globalThis.avesmapsVisibleArea!.centre();
        for (let r = 0; r < 240; r += 8)
            for (let w = 0; w < 360; w += 30) {
                const x = Math.round(mitte.x + r * Math.cos((w * Math.PI) / 180));
                const y = Math.round(mitte.y + r * Math.sin((w * Math.PI) / 180));
                const regionen = new Set(
                    map
                        .queryRenderedFeatures([x, y], { layers: ids })
                        .map((f) => String(f.properties["region_public_id"])),
                );
                if (regionen.size === 1) return { x, y, id: [...regionen][0] ?? "" };
            }
        return undefined;
    });
    expect(gefunden, "eine Stelle mit einer Landschaft").toBeDefined();
    return { at: await onPage(page, gefunden!), id: gefunden!.id };
}

const zahlen = (page: Page) => page.getByTestId("flaeche-vereinfachen-zahlen");
const ungespeichert = (page: Page) => page.getByTestId("flaeche-vereinfachen-leiste-ungespeichert");

/** Den Regler wie mit der Hand auf `wert` stellen: Ziehen (`input`), dann Loslassen (`change`). */
async function stelleRegler(page: Page, wert: number): Promise<void> {
    await page.getByTestId("flaeche-vereinfachen-staerke").evaluate((element, w) => {
        const regler = element as HTMLInputElement;
        regler.value = String(w);
        regler.dispatchEvent(new Event("input", { bubbles: true }));
        regler.dispatchEvent(new Event("change", { bubbles: true }));
    }, wert);
}

test.use({ viewport: { width: 1920, height: 1080 } });

test("🔴 „Fläche vereinfachen“: Regler mit Zahlen, gemeinsame Grenze und Flusspunkt bleiben, ↶ holt den Regler zurück, „Fertig“ schreibt nur die eigene Fläche", async ({
    page,
}) => {
    const server = await oeffne(page);
    const { at, id } = await stelle(page);
    liste = { rows: [{ id, name: "Probe", layer: "vegetation", circle: "halb-rechts", order: 1 }] };
    await page.mouse.click(at.x, at.y, { button: "right" });
    // Zweite Ebene wie Legacy: „Form ändern ›“ trägt den Eintrag (die Derographie, 84092a757).
    await page.getByTestId("context-editor-gruppe-form").hover();
    await page.getByTestId("context-editor-flaeche-vereinfachen").click();

    const leiste = page.getByTestId("flaeche-vereinfachen-leiste");
    await expect(leiste).toBeVisible();
    await expect(leiste).toContainText("Fläche vereinfachen");
    await expect(leiste).toContainText("Probe");
    // Nach der Landung der Kamera gilt die Vorgabe (Stärke 4) als EIN Schritt; die geraden Seiten verlieren ihre Zwischenecken.
    await expect(ungespeichert(page)).toHaveText("1 ungespeichert");
    await expect(page.getByTestId("flaeche-vereinfachen-staerke")).toHaveValue("4");
    const fest = GRENZE.length + 1;
    await expect(zahlen(page)).toContainText(`${String(UMRISS.length)} → `);
    await expect(zahlen(page)).toContainText(`· ${String(fest)} fest`);
    const nachVorgabe = await zahlen(page).textContent();

    // Zurück auf 0 ändert die Form (alle Ecken wieder da): ein Schritt. Eine Stärke, bei der nichts weiter wegfällt, wäre keiner.
    await stelleRegler(page, 0);
    await expect(ungespeichert(page)).toHaveText("2 ungespeichert");
    await page.getByTestId("flaeche-vereinfachen-leiste-zurueck").click();
    await expect(ungespeichert(page)).toHaveText("1 ungespeichert");
    await expect(page.getByTestId("flaeche-vereinfachen-staerke")).toHaveValue("4");
    await expect(zahlen(page)).toHaveText(nachVorgabe!);

    await page.getByTestId("flaeche-vereinfachen-leiste-fertig").click();
    await expect(leiste).toHaveCount(0);
    await expect.poll(() => server.geschrieben.length).toBe(1);
    expect(server.geschrieben[0]!.url).toMatch(new RegExp(`/api/editor/landscapes/${id}$`));
    const body = server.geschrieben[0]!.body as {
        areas: { id: string; baseRevision: number; polygons: number[][][][] }[];
    };
    // Nur die eigene Teilfläche: Die Nachbarin wird weder geschrieben noch gesperrt.
    expect(body.areas.map((a) => [a.id, a.baseRevision])).toEqual([[FLAECHE, 4]]);
    const ring = body.areas[0]!.polygons[0]![0]!;
    expect(ring.length).toBeLessThan(UMRISS.length);
    for (const ecke of [...GRENZE, FLUSS]) expect(ring).toContainEqual(ecke);
    await expect(page.getByText(/✓ „Probe“ vereinfacht: \d+ → \d+ Stützpunkte\./)).toBeVisible();
    expect(server.sperren.filter((s) => s === "/api/editor/locks")).toHaveLength(1);
    await expect.poll(() => server.sperren.at(-1)).toBe("/api/editor/locks/release");
});

test("🔴 das Fenster trägt die Form: Legt man es ab, endet der Modus, und der Entwurf liegt unter „Offene Bearbeitungen“", async ({
    page,
}) => {
    await oeffne(page);
    const { at, id } = await stelle(page);
    liste = { rows: [{ id, name: "Probe", layer: "vegetation", circle: "halb-rechts", order: 1 }] };
    await page.mouse.click(at.x, at.y, { button: "right" });
    await page.getByTestId("context-editor-gruppe-form").hover();
    await page.getByTestId("context-editor-flaeche-vereinfachen").click();
    await expect(ungespeichert(page)).toHaveText("1 ungespeichert");
    // Auf der Stage gefunden (2026-10-19): Esc mit dem Fokus im Fenster legte es ab, und der Regler blieb oben stehen.
    await page
        .locator('dialog[data-lage][open][data-testid^="landschaftseditor-"]')
        .getByTestId("fenster-ablegen")
        .click();
    await expect(page.getByTestId("flaeche-vereinfachen-leiste")).toHaveCount(0);
    const ablage = page.getByTestId("editor-panel-bearbeitungen");
    await expect(ablage).toContainText("Probe");
    await expect(ablage).toContainText("ungespeichert");
});

test("🔴 sind alle Ecken mit Nachbarflächen verbunden, steht der Satz, der Regler ist gesperrt, und „0 ungespeichert“", async ({
    page,
}) => {
    await oeffne(page);
    // Hier teilt die Nachbarin jede Ecke (die zuletzt angemeldete Route gilt).
    await page.route(/\/api\/editor\/landscapes\/[^/]+\/targets/, (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                margin: 15,
                neighbors: [
                    {
                        id: NACHBARIN,
                        regionId: "a4a4a4a4-0000-4000-8000-000000000002",
                        name: "Nachbarin",
                        revision: 7,
                        polygons: [[UMRISS]],
                    },
                ],
                edges: [],
                riverPoints: [],
            }),
        }),
    );
    const { at, id } = await stelle(page);
    liste = { rows: [{ id, name: "Probe", layer: "vegetation", circle: "halb-rechts", order: 1 }] };
    await page.mouse.click(at.x, at.y, { button: "right" });
    await page.getByTestId("context-editor-gruppe-form").hover();
    await page.getByTestId("context-editor-flaeche-vereinfachen").click();
    await expect(page.getByTestId("flaeche-vereinfachen-allesfest")).toHaveText(
        "Alle Ecken sind mit Nachbarflächen oder Flüssen verbunden; hier lässt sich nichts vereinfachen.",
    );
    await expect(page.getByTestId("flaeche-vereinfachen-staerke")).toBeDisabled();
    await expect(ungespeichert(page)).toHaveText("0 ungespeichert");
});

/**
 * „formmodus A“ an Vorderkosch (Fund der Kraftlinien-Sitzung auf der Stage, 2026-10-19): Eine große Fläche, deren Ecken alle mit Nachbarn
 * verbunden sind und alle außerhalb des Bilds liegen, deckt die freie Fläche ganz. Beim Start ging die Kamera eine Stufe hinaus (6,35 auf
 * 5,35), weil nur Ecken als „zu sehen“ zählten. Jetzt zählt die Fläche selbst (`map/geometrie/kamera.ts`, `trifftFlaeche`).
 */
for (const [breite, hoehe] of [
    [1920, 1080],
    [1280, 800],
] as [number, number][]) {
    test(`🔴 formmodus A: eine Fläche, die das Bild ganz deckt, mit allen Ecken draußen und fest, lässt den Zoom stehen (${String(breite)} × ${String(hoehe)})`, async ({
        page,
    }) => {
        await page.setViewportSize({ width: breite, height: hoehe });
        await oeffne(page);
        // Ein Viereck um das ganze Bild, jede Ecke eine halbe Bildbreite draußen (die zuletzt angemeldete Route gilt).
        const um = await page.evaluate(() => {
            const map = globalThis.avesmapsMap!;
            const leinwand = map.getCanvas();
            const bei = (fx: number, fy: number) => {
                const p = globalThis.avesmapsRenderProjection!.fromRenderLngLat(
                    map.unproject([leinwand.clientWidth * fx, leinwand.clientHeight * fy]),
                );
                return [p.x, p.y] as [number, number];
            };
            return [bei(-0.5, -0.5), bei(1.5, -0.5), bei(1.5, 1.5), bei(-0.5, 1.5)];
        });
        const json = (route: Route, body: unknown) =>
            route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
        await page.route("**/api/editor/landscapes/*", (route) =>
            json(route, { ...DETAIL, areas: [{ id: FLAECHE, polygons: [[um]], affectsPaths: true, revision: 4 }] }),
        );
        await page.route(/\/api\/editor\/landscapes\/[^/]+\/targets/, (route) =>
            json(route, {
                margin: 15,
                neighbors: [
                    {
                        id: NACHBARIN,
                        regionId: "a4a4a4a4-0000-4000-8000-000000000002",
                        name: "Nachbarin",
                        revision: 7,
                        polygons: [[um]],
                    },
                ],
                edges: [],
                riverPoints: [],
            }),
        );
        const { at, id } = await stelle(page);
        liste = { rows: [{ id, name: "Probe", layer: "vegetation", circle: "halb-rechts", order: 1 }] };
        const vorher = await page.evaluate(() => globalThis.avesmapsMap!.getZoom());
        await page.mouse.click(at.x, at.y, { button: "right" });
        await page.getByTestId("context-editor-gruppe-form").hover();
        await page.getByTestId("context-editor-flaeche-vereinfachen").click();
        await expect(page.getByTestId("flaeche-vereinfachen-allesfest")).toBeVisible();
        // Hinflug beim Start, Einzug der Liste (220 ms) und das zweite Einpassen danach.
        await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
        await page.waitForTimeout(700);
        await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
        const nachher = await page.evaluate(() => globalThis.avesmapsMap!.getZoom());
        expect(nachher, "kein Hinauszoomen: die Fläche deckt das Bild").toBeCloseTo(vorher, 2);
    });
}
