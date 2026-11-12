import { expect, test, type Page } from "@playwright/test";
import type { EditorLandscapeDetail, LandscapeBooleanPreview } from "@avesmaps3d/shared";
import { EDITOR_MODE, onPage, settleFrame } from "./map-handle.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * „Mit anderer Fläche ›“ im Kartenmenü (WI-0178 Werkzeug 1, Thomas 4.1; EDIT-0004 §2.8): Die Flächen kommen aus den Kacheln der lokalen
 * Karte, Vorschau und Schreiben aus einem Stub. 🔴 Kein Test schreibt in die Datenbank der Entwicklung.
 *
 * Problemfälle: Der Eintrag fehlt oder bleibt „Kommt später“; die Leiste erscheint nicht; das Zeigen auf die andere Fläche holt keine
 * Vorschau oder nennt sie nicht; der Klick schreibt gegen eine geratene Revision statt gegen die der Vorschau, oder mit den falschen
 * Teilflächen; Esc schreibt etwas oder lässt den Modus stehen.
 */

/** Vorgebirge des Kosch / Nablaquell-Wälder (wie `landschaftseditor-kartenmenue.spec.ts`). */
const LAND = { x: 450, y: 560 };

const VORSCHAU: LandscapeBooleanPreview = {
    polygons: [
        [
            [
                [440, 550],
                [460, 550],
                [460, 570],
                [440, 570],
            ],
        ],
    ],
    targetPolygons: [
        [
            [
                [450, 550],
                [460, 550],
                [460, 560],
            ],
        ],
    ],
    areaRevision: 4,
    targetAreaRevision: 7,
    targetName: "Probehain",
    consumesTarget: true,
    targetLandscapeGoes: false,
};

interface Aufruf {
    url: string;
    body: Record<string, unknown>;
}

async function oeffne(page: Page): Promise<{ vorschau: Aufruf[]; schreiben: Aufruf[] }> {
    const json = (status: number, body: unknown) => ({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
    });
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
    await page.route("**/api/editor/status", (route) => route.fulfill(json(200, { mapEditing: "testwelt" })));
    await page.route("**/api/editor/landscapes", (route) => route.fulfill(json(200, { rows: [] })));
    await page.route(/\/api\/editor\/locks(\/(heartbeat|release|lift))?(\?.*)?$/, (route) =>
        route.request().method() === "GET"
            ? route.fulfill(json(200, { locks: [] }))
            : route.fulfill(json(200, { lost: [] })),
    );
    const aufrufe = { vorschau: [] as Aufruf[], schreiben: [] as Aufruf[] };
    await page.route(/\/api\/editor\/landscapes\/[^/]+\/boolean(-preview)?$/, (route) => {
        const url = route.request().url();
        const body = route.request().postDataJSON() as Record<string, unknown>;
        if (url.endsWith("/boolean-preview")) {
            aufrufe.vorschau.push({ url, body });
            return route.fulfill(json(200, VORSCHAU));
        }
        aufrufe.schreiben.push({ url, body });
        const region = /landscapes\/([^/]+)\/boolean$/.exec(url)?.[1] ?? "";
        return route.fulfill(
            json(200, {
                operationId: body["operationId"],
                status: "applied",
                environment: "test",
                affected: [{ kind: "landscape", id: region, revision: 2 }],
                derivedWork: [],
                warnings: [],
            }),
        );
    });
    await page.route(/\/api\/editor\/landscapes\/[^/]+$/, (route) =>
        route.fulfill(json(200, { id: "x", areas: [], labels: [], neighbors: [] } as unknown as EditorLandscapeDetail)),
    );
    await page.goto(
        `${EDITOR_MODE}#x=${String(LAND.x)}&y=${String(LAND.y)}&z=6.5&series=original&view=landscapes&layer=vegetation`,
    );
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 30_000 });
    await settleFrame(page);
    return aufrufe;
}

interface Stelle {
    x: number;
    y: number;
    area: string;
    region: string;
}

/** Zwei Stellen nahe der Mitte mit je genau einer Teilfläche der Vegetation, verschiedene Teilflächen, beide frei für Klicks. */
async function zweiTeilflaechen(page: Page): Promise<[Stelle, Stelle]> {
    const gefunden = await page.evaluate(() => {
        const map = globalThis.avesmapsMap;
        if (!map) throw new Error("map handle missing");
        const canvas = map.getCanvas();
        const rect = canvas.getBoundingClientRect();
        const ids = (map.getStyle().layers ?? [])
            .map((layer) => layer.id)
            .filter((id) => id.startsWith("landscape-fill-"));
        const mitte = globalThis.avesmapsVisibleArea!.centre();
        const stellen: Stelle[] = [];
        for (let r = 0; r < 160; r += 8) {
            for (let w = 0; w < 360; w += 30) {
                const x = Math.round(mitte.x + r * Math.cos((w * Math.PI) / 180));
                const y = Math.round(mitte.y + r * Math.sin((w * Math.PI) / 180));
                const treffer = map.queryRenderedFeatures([x, y], { layers: ids });
                if (treffer.length !== 1 || treffer[0]!.properties["is_locked"] === true) continue;
                if (document.elementFromPoint(rect.left + x, rect.top + y) !== canvas) continue;
                stellen.push({
                    x,
                    y,
                    area: String(treffer[0]!.properties["public_id"]),
                    region: String(treffer[0]!.properties["region_public_id"]),
                });
            }
        }
        const erste = stellen[0];
        const zweite = stellen.find((s) => erste !== undefined && s.area !== erste.area);
        return erste && zweite ? [erste, zweite] : undefined;
    });
    expect(gefunden, "zwei Teilflächen nahe der Mitte").toBeDefined();
    const [a, b] = gefunden as [Stelle, Stelle];
    return [
        { ...a, ...(await onPage(page, a)) },
        { ...b, ...(await onPage(page, b)) },
    ];
}

/** Rechtsklick auf die Quelle, „Mit anderer Fläche ›“ → „Mit anderer vereinigen …“. */
async function starteVereinigen(page: Page, quelle: Stelle): Promise<void> {
    await page.mouse.click(quelle.x, quelle.y, { button: "right" });
    await page.getByTestId("context-editor-gruppe-andere").hover();
    const eintrag = page.getByTestId("context-editor-flaeche-vereinigen");
    await expect(eintrag).toBeEnabled();
    await eintrag.click();
    await expect(page.getByTestId("context-editor")).toHaveCount(0);
    await expect(page.getByTestId("mit-anderer-leiste")).toBeVisible();
}

test("🔴 vereinigen: zeigen holt die Vorschau, der Klick schreibt EINE Operation gegen die Revisionen der Vorschau", async ({
    page,
}) => {
    const aufrufe = await oeffne(page);
    const [quelle, ziel] = await zweiTeilflaechen(page);
    await starteVereinigen(page, quelle);
    const leiste = page.getByTestId("mit-anderer-leiste");
    await expect(leiste).toContainText("Mit anderer vereinigen");

    await page.mouse.move(ziel.x, ziel.y, { steps: 4 });
    await expect(leiste).toContainText("Probehain");
    expect(aufrufe.vorschau.at(-1)?.body).toEqual({
        operation: "vereinigen",
        areaId: quelle.area,
        targetAreaId: ziel.area,
    });
    expect(aufrufe.schreiben).toHaveLength(0);
    await page.screenshot({ path: "test-results/werkzeug1-vorschau.png" });

    await page.mouse.click(ziel.x, ziel.y);
    await expect(leiste).toHaveCount(0);
    expect(aufrufe.schreiben).toHaveLength(1);
    expect(aufrufe.schreiben[0]!.url).toContain(`/landscapes/${quelle.region}/boolean`);
    expect(aufrufe.schreiben[0]!.body).toMatchObject({
        operation: "vereinigen",
        areaId: quelle.area,
        baseRevision: 4,
        targetAreaId: ziel.area,
        targetBaseRevision: 7,
    });
});

test("🔴 Esc bricht ab, ohne zu schreiben; danach öffnet der Rechtsklick wieder das Kartenmenü", async ({ page }) => {
    const aufrufe = await oeffne(page);
    const [quelle, ziel] = await zweiTeilflaechen(page);
    await starteVereinigen(page, quelle);
    await page.mouse.move(ziel.x, ziel.y, { steps: 4 });
    await expect(page.getByTestId("mit-anderer-leiste")).toContainText("Probehain");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("mit-anderer-leiste")).toHaveCount(0);
    expect(aufrufe.schreiben).toHaveLength(0);
    await page.mouse.click(quelle.x, quelle.y, { button: "right" });
    await expect(page.getByTestId("context-editor")).toBeVisible();
});
