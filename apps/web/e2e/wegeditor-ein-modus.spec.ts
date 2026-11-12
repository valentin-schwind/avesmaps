import { expect, test, type Page, type Route } from "@playwright/test";
import type { EditorLandscapeDetail, EditorPathDetail, EditorPathStreet, EditorPathTargets } from "@avesmaps3d/shared";
import { EDITOR_MODE, onPage, openMap, settleFrame, showPlace } from "./map-handle.ts";
import { GRATENFELS, GRATENFELS_LAGE } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Ein Modus zur Zeit im Geometrie-Modul (Editor-Orchestrierung 2026-10-17; `map/geometrie/besitzer.ts`): Startet ein Modus der Form
 * oder das Anlegen, während schon einer läuft, wird der neue Start abgewiesen, der laufende bleibt, ein Hinweis sagt es, und nichts
 * wirft (vorher: der Koordinator warf bei der zweiten Anmeldung von `geometry-edit`).
 *
 * 🔴 Kein Test schreibt in die Datenbank der Entwicklung: Weg, Landschaft, Ziele und Sperren kommen aus Stubs.
 */

declare global {
    var avesmapsWegkurve:
        { starte(publicId: string): Promise<void>; laufend: { value: { publicId: string } | undefined } } | undefined;
    var avesmapsNeuerWeg:
        | {
              starte(anfang: { ort: string } | { punkt: { x: number; y: number } }): Promise<void>;
              laufend: { value: { phase: string; stand: { punkte: number; abschnitte: number } } | undefined };
          }
        | undefined;
}

test.use({ viewport: { width: 1920, height: 1080 } });

const RECHTE = [
    "use_editor_menu",
    "edit_map_objects",
    "edit_map_geometry",
    "edit_territories",
    "edit_landscapes",
    "edit_territory_form",
    "edit_landscape_form",
    "edit_mountains",
];
const WEG = "0b6f0c55-0000-4000-8000-0000000000d1";
const G = GRATENFELS_LAGE;
const WEG_PUNKTE = [G, { x: G.x + 4, y: G.y + 2 }, { x: G.x + 8, y: G.y }];
const HINWEIS = "Erst den laufenden Bearbeiten-Modus beenden.";

const WEG_DETAIL: EditorPathDetail = {
    publicId: WEG,
    revision: 3,
    name: "Probeweg",
    subtype: "Weg",
    labelVisible: true,
    isBach: false,
    flowDirection: null,
    sourceSystem: "legacy",
    active: true,
    points: WEG_PUNKTE,
    ends: { start: { kind: "place", publicId: GRATENFELS, name: "Gratenfels" }, end: { kind: "free" } },
};
const ZIELE: EditorPathTargets = { margin: 15, places: [], vertices: [], peaks: [] };

/** Die Landschaft des Falls „Gebietsform“: ein Viereck an der Stelle mit Flächen aller Ebenen (wie `landschaftseditor-kartenmenue`). */
const LAND = { x: 450, y: 560 };
const LANDSCHAFT: EditorLandscapeDetail = {
    id: "a4a4a4a4-0000-4000-8000-0000000000d1",
    name: "Probe",
    layer: "vegetation",
    circle: "halb-rechts",
    order: 1,
    clickLocked: false,
    areas: [
        {
            id: "a4a4a4a4-0000-4000-8000-0000000000d2",
            polygons: [
                [
                    [
                        [440, 552],
                        [460, 552],
                        [462, 568],
                        [441, 570],
                    ],
                ],
            ],
            affectsPaths: true,
            revision: 4,
        },
    ],
    labels: [],
    neighbors: [],
    revision: 1,
};

async function stubs(page: Page): Promise<{ fehler: string[] }> {
    const json = (route: Route, status: number, body: unknown) =>
        route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    await stubAdmin(page, { capabilities: RECHTE, role: "editor" });
    await page.route("**/api/editor/status", (route) => json(route, 200, { mapEditing: "testwelt" }));
    await page.route(/\/api\/editor\/locks(\/(heartbeat|release|lift))?(\?.*)?$/, (route) => {
        const url = route.request().url();
        if (route.request().method() === "GET") return json(route, 200, { locks: [] });
        if (url.endsWith("/release")) return route.fulfill({ status: 204 });
        if (url.endsWith("/heartbeat")) return json(route, 200, { lost: [] });
        const body = route.request().postDataJSON() as { kind: string; id: string; part: string };
        return json(route, 200, {
            lock: {
                ...body,
                person: { id: "a4a4a4a4-0000-4000-8000-0000000000f1", name: "Rondrikan" },
                since: "2026-10-17T12:00:00.000Z",
                heartbeatAt: "2026-10-17T12:00:00.000Z",
                own: true,
            },
        });
    });
    await page.route(/\/api\/editor\/paths\/[0-9a-f-]{36}$/, (route) => json(route, 200, WEG_DETAIL));
    await page.route(/\/api\/editor\/paths\/[0-9a-f-]{36}\/targets(\?.*)?$/, (route) => json(route, 200, ZIELE));
    // Die Straße des Abschnitts für das Wege-Fenster, das die Wegkurve öffnet (W5b): Er ist ihr Anker.
    await page.route(/\/api\/editor\/paths\/[0-9a-f-]{36}\/street$/, (route) => {
        const id = route.request().url().split("/").at(-2)!;
        const strasse: EditorPathStreet = {
            id,
            name: WEG_DETAIL.name,
            subtype: WEG_DETAIL.subtype,
            isBach: false,
            circle: "halb-rechts",
            labelVisible: true,
            segments: [
                {
                    id,
                    revision: WEG_DETAIL.revision,
                    labelVisible: true,
                    wiki: false,
                    points: WEG_DETAIL.points.length,
                },
            ],
        };
        return json(route, 200, strasse);
    });
    await page.route(/\/api\/editor\/path-targets\?/, (route) => json(route, 200, ZIELE));
    await page.route(`**/api/editor/places/${GRATENFELS}`, (route) =>
        json(route, 200, { publicId: GRATENFELS, name: "Gratenfels", position: G, active: true }),
    );
    await page.route("**/api/editor/landscapes", (route) =>
        json(route, 200, {
            rows: [{ id: LANDSCHAFT.id, name: "Probe", layer: "vegetation", circle: "halb-rechts", order: 1 }],
        }),
    );
    await page.route("**/api/editor/landscapes/*", (route) => json(route, 200, LANDSCHAFT));
    await page.route(/\/api\/editor\/landscapes\/[^/]+\/targets/, (route) =>
        json(route, 200, { margin: 15, neighbors: [], edges: [], riverPoints: [] }),
    );
    const fehler: string[] = [];
    page.on("pageerror", (error) => fehler.push(error.message));
    return { fehler };
}

const hinweis = (page: Page) => page.getByTestId("toast");

test("🔴 läuft die Wegkurve, beginnt „Neuer Weg“ nicht: Hinweis, die Wegkurve bleibt, nichts wirft; danach geht es", async ({
    page,
}) => {
    const { fehler } = await stubs(page);
    await openMap(page, EDITOR_MODE);
    await showPlace(page, { x: G.x + 4, y: G.y + 1 }, 7);
    await page.waitForFunction(() => globalThis.avesmapsWegkurve !== undefined);
    await page.evaluate((id) => globalThis.avesmapsWegkurve!.starte(id), WEG);
    await expect(page.getByTestId("wegkurve-leiste")).toBeVisible();

    await page.evaluate((id) => globalThis.avesmapsNeuerWeg!.starte({ ort: id }), GRATENFELS);
    await expect(hinweis(page)).toContainText(HINWEIS);
    await expect(page.getByTestId("wegkurve-leiste")).toBeVisible();
    await expect(page.getByTestId("neuer-weg-leiste")).toBeHidden();
    expect(await page.evaluate(() => globalThis.avesmapsNeuerWeg!.laufend.value)).toBeUndefined();

    // Eine zweite Wegkurve an einem anderen Abschnitt beendet die laufende nicht still.
    await page.evaluate(() => globalThis.avesmapsWegkurve!.starte("0b6f0c55-0000-4000-8000-0000000000d9"));
    expect(await page.evaluate(() => globalThis.avesmapsWegkurve!.laufend.value?.publicId)).toBe(WEG);

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("wegkurve-leiste")).toBeHidden();
    await page.evaluate((id) => globalThis.avesmapsNeuerWeg!.starte({ ort: id }), GRATENFELS);
    await expect(page.getByTestId("neuer-weg-leiste")).toBeVisible();
    expect(fehler).toEqual([]);
});

test("🔴 läuft „Gebietsform bearbeiten“, beginnen Wegkurve und „Neuer Weg“ nicht: Hinweis, die Gebietsform bleibt", async ({
    page,
}) => {
    const { fehler } = await stubs(page);
    await page.goto(
        `${EDITOR_MODE}#x=${String(LAND.x)}&y=${String(LAND.y)}&z=6.5&series=original&view=landscapes&layer=vegetation`,
    );
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 30_000 });
    await settleFrame(page);
    // Eine Stelle mit genau einer Landschaft, nahe der Mitte.
    const stelle = await page.evaluate(() => {
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
                if (regionen.size === 1) return { x, y };
            }
        return undefined;
    });
    expect(stelle).toBeDefined();
    const at = await onPage(page, stelle!);
    await page.mouse.click(at.x, at.y, { button: "right" });
    await page.getByTestId("context-editor-flaeche-gebietsform").click();
    await expect(page.getByTestId("ecken-leiste")).toBeVisible();

    await page.evaluate((id) => globalThis.avesmapsWegkurve!.starte(id), WEG);
    await expect(hinweis(page)).toContainText(HINWEIS);
    await expect(page.getByTestId("wegkurve-leiste")).toBeHidden();
    await page.evaluate((id) => globalThis.avesmapsNeuerWeg!.starte({ ort: id }), GRATENFELS);
    await expect(page.getByTestId("neuer-weg-leiste")).toBeHidden();
    await expect(page.getByTestId("ecken-leiste")).toBeVisible();
    expect(fehler).toEqual([]);
});
