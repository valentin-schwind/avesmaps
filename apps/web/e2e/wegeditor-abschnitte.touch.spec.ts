import { expect, test, type Page, type Route } from "@playwright/test";
import type { EditorPathDetail, EditorPathStreet, EditorPathTargets } from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap, settleFrame, showPlace } from "./map-handle.ts";
import { GRATENFELS_LAGE } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Abschnitte im Menü am Finger (WI-0177; EDIT-0003 T49; Probierseite „Abschnitte im Menü“): Am Telefon gibt es kein Menü am Objekt. Das
 * Blatt des langen Drucks auf einen Weg trägt deshalb „Wegkurve bearbeiten ›“ mit den Abschnitten der Straße statt des Eintrags am
 * Abschnitt unter dem Finger. Es gibt kein Zeigen: Das erste Tippen auf einen Abschnitt lässt ihn leuchten, das zweite wählt.
 *
 * 🔴 Nichts geht an den Server der Entwicklung: Straße, Weg, Andockziele und Sperre kommen aus Stubs. 🪤 Playwright kennt nur den
 * kurzen Tipp; der lange Druck kommt über CDP als echtes Touch-Ereignis (wie `kartenmenue.touch.spec.ts`).
 */

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
const FERN = "0b6f0c55-0000-4000-8000-0000000000f9";

const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** Der Weg des Tests unter der Kennung, nach der gefragt wird (ein Abschnitt aus den echten Kacheln). */
const weg = (publicId: string): EditorPathDetail => ({
    publicId,
    revision: 5,
    name: "Gratenfelser Weg",
    subtype: "Weg",
    labelVisible: true,
    isBach: false,
    flowDirection: null,
    sourceSystem: "legacy",
    active: true,
    points: [
        { x: GRATENFELS_LAGE.x, y: GRATENFELS_LAGE.y },
        { x: GRATENFELS_LAGE.x + 6, y: GRATENFELS_LAGE.y },
    ],
    ends: { start: { kind: "free" }, end: { kind: "free" } },
});

const ZIELE: EditorPathTargets = { margin: 15, places: [], peaks: [], vertices: [] };

async function stubs(page: Page, stelle: () => string | undefined): Promise<void> {
    await stubAdmin(page, { capabilities: RECHTE, role: "editor" });
    await page.route("**/api/editor/status", (route) => json(route, 200, { mapEditing: "testwelt" }));
    await page.route(/\/api\/editor\/paths\/[0-9a-f-]{36}$/, (route) =>
        json(route, 200, weg(route.request().url().split("/").at(-1)!)),
    );
    await page.route(/\/api\/editor\/paths\/[0-9a-f-]{36}\/targets(\?.*)?$/, (route) => json(route, 200, ZIELE));
    await page.route(/\/api\/editor\/paths\/[0-9a-f-]{36}\/street$/, (route) => {
        const id = stelle() ?? route.request().url().split("/").at(-2)!;
        const strasse: EditorPathStreet = {
            id,
            name: "Gratenfelser Weg",
            subtype: "Weg",
            isBach: false,
            circle: "halb-rechts",
            labelVisible: true,
            segments: [
                { id, revision: 5, labelVisible: true, wiki: false, points: 4, von: "Gratenfels" },
                {
                    id: FERN,
                    revision: 9,
                    labelVisible: true,
                    wiki: false,
                    points: 3,
                    bounds: [1, 1, 2, 2],
                    von: "Ferdok",
                },
            ],
        };
        return json(route, 200, strasse);
    });
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
}

/** Eine Stelle auf einem gezeichneten Weg, an der die Leinwand vorn ist, samt der Kennung seines Abschnitts. */
const wegStelle = (page: Page) =>
    page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const ids = (map.getStyle().layers ?? []).map((layer) => layer.id).filter((id) => id.startsWith("path-hit-"));
        const canvas = map.getCanvas();
        const box = canvas.getBoundingClientRect();
        for (let y = 200; y < canvas.clientHeight - 200; y += 5)
            for (let x = 40; x < canvas.clientWidth - 40; x += 5) {
                if (document.elementFromPoint(box.left + x, box.top + y) !== canvas) continue;
                const f = map.queryRenderedFeatures([x, y], { layers: ids })[0];
                const id = f?.properties["public_id"] ?? f?.id;
                if (typeof id === "string") return { x: box.left + x, y: box.top + y, id };
            }
        return undefined;
    });

const hervor = (page: Page) =>
    page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        if (map.getLayer("weg-abschnitte-hervor") === undefined) return undefined;
        // Hervorgehoben ist seit der Wahl mehrerer Abschnitte eine Liste (`["literal", [...]]`); hier als Kennungen mit Komma.
        const roh = (map.getFilter("weg-abschnitte-hervor") as unknown[]).at(-1);
        return Array.isArray(roh) && roh[0] === "literal" ? (roh[1] as string[]).join(",") : roh;
    });

const modusAktiv = (page: Page) =>
    page.evaluate(() => globalThis.avesmapsMap?.getStyle().layers.some((l) => l.id === "geometrie-kante") === true);

test("🔴 am Finger (T49): das Blatt des langen Drucks trägt „Wegkurve bearbeiten ›“ mit den Abschnitten; erstes Tippen leuchtet, zweites startet", async ({
    page,
}) => {
    const gefunden: { id?: string } = {};
    await stubs(page, () => gefunden.id);
    await openMap(page, EDITOR_MODE);
    await showPlace(page, { x: GRATENFELS_LAGE.x + 3, y: GRATENFELS_LAGE.y }, 7);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
    await settleFrame(page);
    const stelle = await wegStelle(page);
    expect(stelle, "eine Stelle auf einem Weg").toBeDefined();
    gefunden.id = stelle!.id;

    const client = await page.context().newCDPSession(page);
    await client.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: stelle!.x, y: stelle!.y, id: 0 }],
    });
    await page.waitForTimeout(800);
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

    const gruppe = page.getByTestId("context-editor-weg-wegkurve-finger");
    await expect(gruppe).toContainText("Wegkurve bearbeiten");
    // Der flache Eintrag am Abschnitt unter dem Finger weicht dem Untermenü.
    await expect(page.getByTestId("context-editor-weg-wegkurve")).toHaveCount(0);
    await expect(page.getByTestId("context-editor-weg-entfernen-finger")).toBeVisible();
    await gruppe.tap();
    const erster = page.getByTestId(`context-editor-weg-wegkurve-finger#${stelle!.id}`);
    await expect(erster).toHaveText("1 · Gratenfels – Abzweig");
    await expect(page.getByTestId(`context-editor-weg-wegkurve-finger#${FERN}`)).toContainText("außerhalb");

    await erster.tap();
    await expect.poll(() => hervor(page)).toBe(stelle!.id);
    expect(await modusAktiv(page)).toBe(false);
    await erster.tap();
    await expect.poll(() => modusAktiv(page)).toBe(true);
    const gelesen = await page.evaluate(() => globalThis.avesmapsWegkurve?.laufend.value?.publicId);
    expect(gelesen).toBe(stelle!.id);
    // Danach zeigt die Karte die Nummern des Wege-Fensters (Leiste (W) (1) (2), Betreiber 2026-10-19), ohne Leuchten: (W).
    await expect.poll(() => hervor(page)).toBe("");
});
