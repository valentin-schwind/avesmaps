import { expect, test, type Page, type Route } from "@playwright/test";
import type { EditorLandscapeDetail, LandscapeCreateBody, LandscapeCreateReceipt } from "@avesmaps3d/shared";
import { EDITOR_MODE, settleFrame } from "./map-handle.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * „Neue Fläche“ der Derographie (WI-0178 T47; gemeinsamer Ablauf C3, Betreiber 2026-10-18: „neue fläche als untermenü der ebenen“ und
 * „Nach dem Zeichnen / Fertig: bleiben · Abbruch: zurück“): aus der Ansicht Standard über „Hier hinzufügen › Neue Fläche › Vegetation“.
 *
 * 🔴 Kein Test schreibt in die Datenbank der Entwicklung: Ziele, `landscape.create` und das Detail der neuen Fläche kommen aus einem
 * Stub; den Schreibweg prüft `apps/server/test/landscape-create.test.ts` im Wegwerf-Cluster.
 *
 * Problemfälle: Die Karte wechselt nicht in die Ebene der Fläche; der Klickpunkt des Menüs ist nicht die erste Ecke; der Regler fehlt
 * beim Zeichnen; „Fertig“ schreibt nicht EINE Operation mit Ebene und Ring; danach öffnet kein Fenster oder der Name ist nicht markiert;
 * nach „Fertig“ springt die Ansicht zurück; nach einem Abbruch bleibt sie in der Derographie.
 */

test.use({ viewport: { width: 1920, height: 1080 } });

const NEU = "a4a4a4a4-0000-4000-8000-0000000000d1";
/** Eine Stelle am Rand der Karte, wo wenig liegt (wie in `landschaftseditor-kartenmenue.spec.ts`). */
const LAND = { x: 450, y: 560 };

interface Server {
    gesendet: LandscapeCreateBody[];
    zielfragen: string[];
}

async function stub(page: Page): Promise<Server> {
    const server: Server = { gesendet: [], zielfragen: [] };
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
    await page.route(/\/api\/editor\/locks(\/(heartbeat|release))?(\?.*)?$/, (route) =>
        route.request().method() === "GET" ? json(route, 200, { locks: [] }) : json(route, 200, { lost: [] }),
    );
    await page.route(/\/api\/editor\/landscapes\/targets\?/, (route) => {
        server.zielfragen.push(route.request().url());
        return json(route, 200, { margin: 0, neighbors: [], edges: [], riverPoints: [] });
    });
    await page.route(/\/api\/editor\/landscapes(\?.*)?$/, (route) => {
        if (route.request().method() !== "POST")
            return json(route, 200, {
                rows:
                    server.gesendet.length > 0
                        ? [{ id: NEU, name: "Fläche-008", layer: "vegetation", circle: "halb-rechts", order: 9 }]
                        : [],
            });
        const body = route.request().postDataJSON() as LandscapeCreateBody;
        server.gesendet.push(body);
        const quittung: LandscapeCreateReceipt = {
            operationId: body.operationId,
            status: "applied",
            environment: "development",
            affected: [{ kind: "landscape", id: NEU, revision: 1 }],
            derivedWork: [],
            warnings: [],
            mapRevision: 4711,
            publicId: NEU,
            name: "Fläche-008",
        };
        return json(route, 200, quittung);
    });
    const detail: EditorLandscapeDetail = {
        id: NEU,
        name: "Fläche-008",
        layer: "vegetation",
        circle: "halb-rechts",
        order: 9,
        clickLocked: false,
        areas: [],
        labels: [],
        neighbors: [],
        revision: 1,
    };
    await page.route(`**/api/editor/landscapes/${NEU}`, (route) => json(route, 200, detail));
    await page.route(`**/api/editor/landscapes/${NEU}/history*`, (route) =>
        json(route, 200, { entries: [], next: null }),
    );
    return server;
}

async function aufSeite(page: Page, punkt: { x: number; y: number }): Promise<{ x: number; y: number }> {
    return page.evaluate((pt) => {
        const map = globalThis.avesmapsMap!;
        const render = globalThis.avesmapsRenderProjection!.toRenderLngLat(pt);
        const at = map.project(render);
        const rahmen = map.getCanvas().getBoundingClientRect();
        return { x: rahmen.left + at.x, y: rahmen.top + at.y };
    }, punkt);
}

const leiste = (page: Page) => page.getByTestId("neue-flaeche-leiste");

async function oeffneStandard(page: Page): Promise<Server> {
    const server = await stub(page);
    await page.goto(`${EDITOR_MODE}#x=${String(LAND.x)}&y=${String(LAND.y)}&z=6.5&series=original&view=standard`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 30_000 });
    await settleFrame(page);
    return server;
}

/** Rechtsklick an der Stelle, „Hier hinzufügen › Neue Fläche ›“ und die Ebene. */
async function neueFlaeche(page: Page, stelle: { x: number; y: number }, ebene: string): Promise<void> {
    const at = await aufSeite(page, stelle);
    await page.mouse.click(at.x, at.y, { button: "right" });
    await page.getByTestId("context-editor-hier-hinzufuegen").hover();
    await page.getByTestId("context-editor-neue-flaeche").hover();
    await page.getByTestId(`context-editor-neue-flaeche-${ebene}`).click();
}

test("🔴 aus Standard „Neue Fläche › Vegetation“: Derographie in der Vegetation, erste Ecke am Klick, Regler in der Leiste; „Fertig“ schreibt EINE Operation, bleibt und öffnet das Fenster mit markiertem Namen", async ({
    page,
}) => {
    const server = await oeffneStandard(page);
    const ecken = [
        { x: LAND.x, y: LAND.y },
        { x: LAND.x + 2, y: LAND.y },
        { x: LAND.x + 2, y: LAND.y + 2 },
        { x: LAND.x, y: LAND.y + 2 },
    ];
    // Im Untermenü die drei Ebenen; ohne Fläche der Ebene der Karte steht „zuletzt“ an keiner.
    const at = await aufSeite(page, ecken[0]!);
    await page.mouse.click(at.x, at.y, { button: "right" });
    await page.getByTestId("context-editor-hier-hinzufuegen").hover();
    await page.getByTestId("context-editor-neue-flaeche").hover();
    const unter = page.getByTestId("context-editor-neue-flaeche-unter");
    await expect(unter).toBeVisible();
    for (const ebene of ["derographisch", "vegetation", "topographie"])
        await expect(unter.getByTestId(`context-editor-neue-flaeche-${ebene}`)).toBeVisible();
    await page.getByTestId("context-editor-neue-flaeche-vegetation").click();

    await expect(leiste(page)).toBeVisible();
    await expect(leiste(page)).toContainText("Vegetation");
    await expect(page).toHaveURL(/view=landscapes/);
    await expect(page).toHaveURL(/layer=vegetation/);
    await expect(leiste(page).getByTestId("untergrund-knopf")).toBeVisible();
    await expect.poll(() => server.zielfragen.some((url) => url.includes("layer=vegetation"))).toBe(true);
    await page.screenshot({ path: "test-results/t47-neue-flaeche-zeichnen.png" });

    for (const ecke of ecken.slice(1)) {
        const p = await aufSeite(page, ecke);
        await page.mouse.click(p.x, p.y);
    }
    const erste = await aufSeite(page, ecken[0]!);
    await page.mouse.click(erste.x, erste.y);

    await expect.poll(() => server.gesendet.length).toBe(1);
    const body = server.gesendet[0]!;
    expect(body.layer).toBe("vegetation");
    expect(body.ring).toHaveLength(4);
    expect(body.ring[0]![0]).toBeCloseTo(ecken[0]!.x, 3);
    expect(body.ring[0]![1]).toBeCloseTo(ecken[0]!.y, 3);
    await expect(leiste(page)).toBeHidden();
    // Fertig: bleiben (Betreiber 2026-10-18).
    await expect(page).toHaveURL(/view=landscapes/);
    // Das Fenster an der neuen Fläche, der Name markiert.
    const name = page.locator('[data-testid^="landschaftseditor-"][data-testid$="-feld-name"]');
    await expect(name).toBeVisible();
    await expect
        .poll(() =>
            page.evaluate(() => {
                const feld = document.activeElement as HTMLInputElement | null;
                return feld?.tagName === "INPUT"
                    ? [feld.value, feld.selectionStart, feld.selectionEnd]
                    : [undefined, undefined, undefined];
            }),
        )
        .toEqual(["Fläche-008", 0, "Fläche-008".length]);
    await page.screenshot({ path: "test-results/t47-neue-flaeche-fenster.png" });
});

test("🔴 Abbruch: Esc ohne Abschnitt beendet und führt zurück in Standard; nichts wird geschrieben", async ({
    page,
}) => {
    const server = await oeffneStandard(page);
    await neueFlaeche(page, LAND, "topographie");
    await expect(leiste(page)).toBeVisible();
    await expect(page).toHaveURL(/layer=topographie/);
    await page.keyboard.press("Escape");
    await expect(leiste(page)).toBeHidden();
    await expect(page).toHaveURL(/view=standard/);
    expect(server.gesendet).toEqual([]);
});
