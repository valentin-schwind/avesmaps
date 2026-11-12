import { expect, type Page, type Route } from "@playwright/test";
import { EDITOR_MODE, onPage, settleFrame } from "./map-handle.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Gemeinsamer Aufbau für die Werkzeuge an Flächen im Kartenmenü (WI-0178, Werkzeuge 1 und 3): ein Editor mit Rechten an der Geometrie,
 * Bearbeiten an, keine Sperren; Liste und Detail aus einem Stub, die Flächen aus den Kacheln der lokalen Karte. 🔴 Kein Test schreibt
 * in die Datenbank der Entwicklung: Was ein Werkzeug schreibt, fängt der Aufrufer mit eigenen Routen.
 */

/** Vorgebirge des Kosch / Nablaquell-Wälder (wie `landschaftseditor-kartenmenue.spec.ts`). */
export const LAND = { x: 450, y: 560 };

export const json = (status: number, body: unknown): { status: number; contentType: string; body: string } => ({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
});

/**
 * Die Karte im Editor-Modus über `LAND`, Ansicht Vegetation; `detail` beantwortet `GET …/landscapes/:id`, `liste` die Liste (ohne: leer).
 */
export async function oeffneFlaechenWerkzeug(
    page: Page,
    detail: (route: Route) => unknown,
    liste: () => unknown = () => ({ rows: [] }),
): Promise<void> {
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
    await page.route("**/api/editor/landscapes", (route) => route.fulfill(json(200, liste())));
    await page.route(/\/api\/editor\/locks(\/(heartbeat|release|lift))?(\?.*)?$/, (route) =>
        route.request().method() === "GET"
            ? route.fulfill(json(200, { locks: [] }))
            : route.fulfill(json(200, { lost: [] })),
    );
    await page.route(/\/api\/editor\/landscapes\/[^/]+$/, (route) => detail(route));
    // Der Hinweis zum Drehen und Neigen gilt als gesehen, wie bei jedem, der die Karte vorher besucht hat (`camera-controls.vue`,
    // `avesmaps3d.hinweis-3d`; wie `ortseditor.spec.ts`). Seit WI-0218 steht er nach rund 1,5 s in der freien Fläche und lag im Sammellauf
    // c252aba3 über dem zweiten Stück von „Unterfläche löschen …“: Zeigen und Klick trafen „Verstanden“ statt der Karte.
    await page.addInitScript(() => {
        try {
            globalThis.localStorage.setItem("avesmaps3d.hinweis-3d", "gesehen");
        } catch {
            // Ohne Speicher steht der Hinweis; der Fall zeigt es dann.
        }
    });
    await page.goto(
        `${EDITOR_MODE}#x=${String(LAND.x)}&y=${String(LAND.y)}&z=6.5&series=original&view=landscapes&layer=vegetation`,
    );
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 30_000 });
    await settleFrame(page);
}

export interface Stelle {
    /** Seitenkoordinaten für `page.mouse`. */
    x: number;
    y: number;
    /** Die Leinwand (für Rechnungen in der Seite). */
    canvas: { x: number; y: number };
    area: string;
    region: string;
}

/**
 * Stellen nahe der Mitte mit genau einer Teilfläche der Vegetation, frei für Klicks und mit der Karte obenauf; `frei` verlangt
 * zusätzlich, dass die Leinwand auch an diesen Versätzen (Bildpunkte) obenauf liegt.
 */
export async function stellen(page: Page, frei: readonly { dx: number; dy: number }[] = []): Promise<Stelle[]> {
    const gefunden = await page.evaluate((versatz) => {
        const map = globalThis.avesmapsMap;
        if (!map) throw new Error("map handle missing");
        const canvas = map.getCanvas();
        const rect = canvas.getBoundingClientRect();
        const ids = (map.getStyle().layers ?? [])
            .map((layer) => layer.id)
            .filter((id) => id.startsWith("landscape-fill-"));
        const mitte = globalThis.avesmapsVisibleArea!.centre();
        const oben = (x: number, y: number) => document.elementFromPoint(rect.left + x, rect.top + y) === canvas;
        const liste: { x: number; y: number; area: string; region: string }[] = [];
        for (let r = 0; r < 160; r += 8) {
            for (let w = 0; w < 360; w += 30) {
                const x = Math.round(mitte.x + r * Math.cos((w * Math.PI) / 180));
                const y = Math.round(mitte.y + r * Math.sin((w * Math.PI) / 180));
                const treffer = map.queryRenderedFeatures([x, y], { layers: ids });
                if (treffer.length !== 1 || treffer[0]!.properties["is_locked"] === true) continue;
                if (!oben(x, y) || versatz.some((v) => !oben(x + v.dx, y + v.dy))) continue;
                liste.push({
                    x,
                    y,
                    area: String(treffer[0]!.properties["public_id"]),
                    region: String(treffer[0]!.properties["region_public_id"]),
                });
            }
        }
        return liste;
    }, frei);
    expect(gefunden.length, "Stellen mit genau einer Teilfläche nahe der Mitte").toBeGreaterThan(0);
    return Promise.all(gefunden.map(async (s) => ({ ...s, canvas: { x: s.x, y: s.y }, ...(await onPage(page, s)) })));
}
