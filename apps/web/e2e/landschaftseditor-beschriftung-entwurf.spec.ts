import { expect, test, type Page, type Route } from "@playwright/test";
import type { EditorLandscapeDetail } from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap, settleFrame } from "./map-handle.ts";
import { editorPanelVorn } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Eine verschobene Beschriftung steht schon im Entwurf an ihrer neuen Lage (WI-0178 C4; Betreiber 2026-10-18, wörtlich: „Auf karte
 * anzeigen und auf der karte verschieben klappt, aber kannst du nach "Verschieben beenden" auch das label korrekt positionieren?
 * unabhängig von "fertig" machen“). Die Beschriftung ist eine echte aus den Kacheln (Werte, Schrift, Band); Fenster, Detail und Sperre
 * kommen aus einem Stub. 🔴 Kein Test schreibt in die Datenbank der Entwicklung: „Fertig“ wird hier nicht gedrückt.
 */
const PUNKTE = "map-label-derographisch";
const KOPIE = "editor-entwurf-beschriftung-derographisch";

interface EchterName {
    id: string;
    region: string;
    name: string;
    regionType: string;
    x: number;
    y: number;
}

/** Ein Punktname der Derographie, den die Karte gerade zeichnet, in Kartenkoordinaten. */
async function echterName(page: Page): Promise<EchterName> {
    await page.waitForFunction(
        (ebene) => (globalThis.avesmapsMap?.queryRenderedFeatures({ layers: [ebene] }) ?? []).length > 0,
        PUNKTE,
        { timeout: 30_000 },
    );
    return page.evaluate((ebene) => {
        const map = globalThis.avesmapsMap!;
        const feature = map
            .queryRenderedFeatures({ layers: [ebene] })
            .find((f) => typeof f.properties["region_public_id"] === "string")!;
        const [lng, lat] = (feature.geometry as { coordinates: [number, number] }).coordinates;
        const punkt = globalThis.avesmapsRenderProjection!.fromRenderLngLat({ lng, lat });
        return {
            id: String(feature.properties["public_id"]),
            region: String(feature.properties["region_public_id"]),
            name: String(feature.properties["name"]),
            regionType: String(feature.properties["region_type"] ?? ""),
            x: punkt.x,
            y: punkt.y,
        };
    }, PUNKTE);
}

/** Wo die Karte diesen Namen zeichnet: in der Kachel, in der Kopie des Entwurfs (Bildpunkte der Karte). */
async function gezeichnet(page: Page, id: string): Promise<{ kachel: number; kopie: { x: number; y: number }[] }> {
    return page.evaluate(
        ({ id, ebenen }) => {
            const map = globalThis.avesmapsMap!;
            const da = (ebene: string) =>
                map.getLayer(ebene) === undefined
                    ? []
                    : map.queryRenderedFeatures({ layers: [ebene] }).filter((f) => f.properties["public_id"] === id);
            return {
                kachel: da(ebenen.punkte).length,
                kopie: da(ebenen.kopie).map((f) => {
                    const [lng, lat] = (f.geometry as { coordinates: [number, number] }).coordinates;
                    const p = map.project({ lng, lat });
                    return { x: p.x, y: p.y };
                }),
            };
        },
        { id, ebenen: { punkte: PUNKTE, kopie: KOPIE } },
    );
}

async function oeffne(page: Page): Promise<EchterName> {
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
    const json = (route: Route, status: number, body: unknown) =>
        route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    // Das Detail entsteht erst aus dem echten Namen; die Stubs lesen es beim Abruf.
    const server: { detail?: EditorLandscapeDetail } = {};
    await page.route("**/api/editor/status", (route) => json(route, 200, { mapEditing: "testwelt" }));
    await page.route("**/api/editor/landscapes", (route) =>
        json(route, 200, {
            rows:
                server.detail === undefined
                    ? []
                    : [
                          {
                              id: server.detail.id,
                              name: server.detail.name,
                              layer: server.detail.layer,
                              circle: server.detail.circle,
                              areas: 0,
                              order: server.detail.order,
                          },
                      ],
        }),
    );
    await page.route(/\/api\/editor\/landscapes\/[0-9a-f-]{36}(\?.*)?$/, (route) =>
        server.detail === undefined ? json(route, 404, {}) : json(route, 200, server.detail),
    );
    await page.route(/\/api\/editor\/landscapes\/[0-9a-f-]{36}\/history/, (route) => json(route, 200, { entries: [] }));
    await page.route(/\/api\/editor\/locks(\/(heartbeat|release|lift))?(\?.*)?$/, (route) => {
        const url = route.request().url();
        if (route.request().method() === "GET") return json(route, 200, { locks: [] });
        if (url.endsWith("/release")) return route.fulfill({ status: 204 });
        if (url.endsWith("/heartbeat")) return json(route, 200, { lost: [] });
        const body = route.request().postDataJSON() as { kind: string; id: string; part: string };
        return json(route, 200, {
            lock: {
                ...body,
                person: { id: "a6a6a6a6-0000-4000-8000-0000000000f1", name: "Rondrikan" },
                since: "2026-10-19T12:00:00.000Z",
                heartbeatAt: "2026-10-19T12:00:00.000Z",
                own: true,
            },
        });
    });
    await openMap(page, EDITOR_MODE);
    const name = await echterName(page);
    server.detail = {
        id: name.region,
        name: name.name,
        layer: "derographisch",
        ...(name.regionType === "" ? {} : { type: name.regionType }),
        circle: "halb-rechts",
        order: 10,
        clickLocked: false,
        areas: [],
        labels: [{ id: name.id, text: name.name, x: name.x, y: name.y, visible: true, primary: true, revision: 1 }],
        neighbors: [],
        revision: 1,
    };
    await editorPanelVorn(page);
    await page.getByTestId("editorpanel-kachel-regionen").click();
    await page.getByTestId("editorpanel-verb").click();
    await page
        .locator('[data-testid^="landschaftseditor-"][data-testid$="-liste"]')
        .getByRole("option", { name: name.name })
        .click();
    return name;
}

test.use({ viewport: { width: 1600, height: 900 } });

test("🔴 nach „Verschieben beenden“ steht der Name an der neuen Stelle, ohne „Fertig“; die Kachel zeigt ihn nicht doppelt", async ({
    page,
}) => {
    const name = await oeffne(page);
    await page.getByRole("tab", { name: /Beschriftungen/ }).click();
    const knopf = page.getByTestId(/^landschaftseditor-fenster-\d+-beschriftung-0-verschieben$/);
    await knopf.click();
    await expect(knopf).toHaveText("Verschieben beenden");
    // Den Namen in die Mitte der Karte holen, zwischen Planer und Fenster, im selben Zoom (sein Band).
    await page.evaluate((p) => {
        const map = globalThis.avesmapsMap!;
        map.jumpTo({ center: globalThis.avesmapsRenderProjection!.toRenderLngLat(p), zoom: map.getZoom() });
    }, name);
    await settleFrame(page);
    const box = (await page.getByTestId("map").boundingBox())!;
    const von = await page.evaluate(
        (p) => globalThis.avesmapsMap!.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(p)),
        name,
    );
    await page.mouse.move(box.x + von.x, box.y + von.y);
    await page.mouse.down();
    await page.mouse.move(box.x + von.x - 80, box.y + von.y + 40, { steps: 8 });
    await page.mouse.up();
    await knopf.click();
    await expect(knopf).toHaveText("Auf der Karte verschieben");
    await settleFrame(page);
    // Die Leiste zählt den Zug, „Fertig“ ist nicht gedrückt.
    await expect(page.getByTestId("landschaft-leiste")).toBeVisible();
    const jetzt = await gezeichnet(page, name.id);
    expect(jetzt.kachel, "die Kachel zeichnet den Namen nicht mehr an der alten Stelle").toBe(0);
    expect(jetzt.kopie, "der Name steht einmal an der neuen Stelle").toHaveLength(1);
    expect(Math.abs(jetzt.kopie[0]!.x - (von.x - 80))).toBeLessThan(4);
    expect(Math.abs(jetzt.kopie[0]!.y - (von.y + 40))).toBeLessThan(4);

    // Verwerfen: Der Name steht wieder in der Kachel, die Kopie ist weg.
    await page.getByTestId("landschaft-leiste-verwerfen").click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("landschaft-leiste")).toHaveCount(0);
    await settleFrame(page);
    await expect.poll(async () => (await gezeichnet(page, name.id)).kachel).toBe(1);
    expect((await gezeichnet(page, name.id)).kopie).toHaveLength(0);
});
