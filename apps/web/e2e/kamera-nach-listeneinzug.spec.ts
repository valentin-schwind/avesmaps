import { expect, test, type Page, type Route } from "@playwright/test";
import type { EditorPowerlineDetail, EditorPowerlineList, EditorPowerlineTargets } from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap, settleFrame } from "./map-handle.ts";
import { editorPanelVorn } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Ein Modus der Form passt beim Start sein Objekt ein, und erst DANACH zieht das angedockte Fenster seine Liste ein (EDIT-0003 Regel 7,
 * „Liste beim Modus“). Bei 1280 px bleibt vor dem Einzug zwischen Planer und Fenster keine Lücke (`leavesGap`), die Kamera zielte auf die
 * Bildmitte, und ein Griff lag unter dem Fenster (Befund der Kraftlinien-Sitzung, 2026-10-18). Seit WI-0218 §10 passt die Kamera nach
 * dem Einzug EINMAL neu ein, mit derselben Rechnung (`map/geometrie/kamera.ts`).
 *
 * Gemessen an der Kraftlinie; Ecken, Gebietsform und Wegkurve gehen über dieselbe Stelle (`zeigeFrei`). Linie, Ziele und Sperre kommen aus
 * Stubs; kein Fall schreibt.
 */

const LINIE = "b2b2b2b2-0000-4000-8000-000000000001";
const GARETH = "c2c2c2c2-0000-4000-8000-000000000001";
const PUNKT = "c2c2c2c2-0000-4000-8000-000000000002";
const PUNIN = "c2c2c2c2-0000-4000-8000-000000000003";

const LISTE: EditorPowerlineList = {
    rows: [
        {
            id: LINIE,
            name: "Punin–Gareth",
            circle: "voll",
            shape: "strang",
            segments: 2,
            nodes: 3,
            ends: ["Gareth", "Punin"],
            bounds: [551, 533, 640, 610],
        },
    ],
};

const DETAIL: EditorPowerlineDetail = {
    id: LINIE,
    name: "Punin–Gareth",
    circle: "voll",
    shape: "strang",
    segments: [
        { id: LINIE, from: GARETH, to: PUNKT, curve: null, labelVisible: true, revision: 3 },
        {
            id: "b2b2b2b2-0000-4000-8000-0000000000a2",
            from: PUNKT,
            to: PUNIN,
            curve: null,
            labelVisible: true,
            revision: 4,
        },
    ],
    nodes: [
        { id: GARETH, kind: "place", name: "Gareth", x: 551.6, y: 533, nodix: true, meets: [] },
        { id: PUNKT, kind: "nodix", x: 595, y: 570, nodix: true, meets: [] },
        { id: PUNIN, kind: "place", name: "Punin", x: 640, y: 610, nodix: true, meets: [] },
    ],
    bounds: [551, 533, 640, 610],
};

const ZIELE: EditorPowerlineTargets = {
    targets: [
        { id: GARETH, kind: "place", name: "Gareth", x: 551.6, y: 533 },
        { id: PUNIN, kind: "place", name: "Punin", x: 640, y: 610 },
    ],
};

async function stubs(page: Page): Promise<void> {
    const json = (route: Route, body: unknown) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
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
    await page.route("**/api/editor/status", (route) => json(route, { mapEditing: "testwelt" }));
    await page.route("**/api/editor/powerlines", (route) => json(route, LISTE));
    await page.route(`**/api/editor/powerlines/${LINIE}`, (route) => json(route, DETAIL));
    await page.route(`**/api/editor/powerlines/${LINIE}/targets`, (route) => json(route, ZIELE));
    await page.route(`**/api/editor/powerlines/${LINIE}/history**`, (route) => json(route, { entries: [] }));
    await page.route(/\/api\/editor\/locks(\/(heartbeat|release|lift))?(\?.*)?$/, (route) => {
        const url = route.request().url();
        if (route.request().method() === "GET") return json(route, { locks: [] });
        if (url.endsWith("/release")) return route.fulfill({ status: 204 });
        if (url.endsWith("/heartbeat")) return json(route, { lost: [] });
        const body = route.request().postDataJSON() as { kind: string; id: string; part: string };
        return json(route, {
            lock: {
                ...body,
                person: { id: "a4a4a4a4-0000-4000-8000-0000000000f1", name: "Rondrikan" },
                since: "2026-10-18T12:00:00.000Z",
                heartbeatAt: "2026-10-18T12:00:00.000Z",
                own: true,
            },
        });
    });
}

/**
 * Die Griffe des Modus auf dem Schirm. `frei`: in der Lücke zwischen Planer und Fenster. `greifbar`: obenauf liegt die Karte selbst,
 * auch nicht der Kameraring, der bei 1280 px IN der Lücke steht (588 bis 678 px; WI-0218 §10, Orchestrierung 2026-10-18, A).
 */
const griffe = (page: Page): Promise<{ x: number; y: number; frei: boolean; greifbar: boolean }[]> =>
    page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const rahmen = map.getCanvas().getBoundingClientRect();
        const links = document.querySelector("#route-planner-panel")?.getBoundingClientRect().right ?? rahmen.left;
        const rechts =
            document
                .querySelector('[data-testid^="kraftlinieneditor-fenster-"][data-map-overlay]')
                ?.getBoundingClientRect().left ?? rahmen.right;
        return map.queryRenderedFeatures({ layers: ["geometrie-steuer"] }).map((f) => {
            const [lng, lat] = (f.geometry as { coordinates: [number, number] }).coordinates;
            const at = map.project({ lng, lat });
            const x = rahmen.left + at.x;
            const y = rahmen.top + at.y;
            return {
                x: Math.round(x),
                y: Math.round(y),
                frei: x > links && x < rechts && y > rahmen.top && y < rahmen.bottom,
                greifbar: document.elementFromPoint(x, y) === map.getCanvas(),
            };
        });
    });

test.use({ viewport: { width: 1280, height: 720 } });

/** Liste offen, „Kurve bearbeiten“, warten, bis die Griffe gezeichnet sind und der Einzug begonnen hat. */
async function starteKurve(page: Page): Promise<void> {
    await page.addInitScript(() => globalThis.localStorage.setItem("avesmaps3d.hinweis-3d", "gesehen"));
    await stubs(page);
    await openMap(page, EDITOR_MODE);
    await editorPanelVorn(page);
    await page.getByTestId("editorpanel-kachel-kraftlinien").click();
    await page.getByTestId("editorpanel-verb").click();
    await page
        .locator('[data-testid^="kraftlinieneditor-"][data-testid$="-liste"]')
        .getByRole("option", { name: /Punin–Gareth/ })
        .click();
    const schalter = page.getByTestId(/^kraftlinieneditor-fenster-\d+-listenschalter$/);
    await expect(schalter, "die Liste steht vor dem Modus offen").toHaveAttribute("aria-expanded", "true");

    await page.getByTestId(/^kraftlinieneditor-fenster-\d+-kurve-bearbeiten$/).click();
    await expect(schalter).toHaveAttribute("aria-expanded", "false");
    await page.waitForFunction(
        () => (globalThis.avesmapsMap?.queryRenderedFeatures({ layers: ["geometrie-steuer"] }) ?? []).length === 2,
        undefined,
        { timeout: 20_000 },
    );
}

/**
 * Wie lange auf den Stand gewartet wird, in dem alles steht. 🪤 Der Stand kommt immer, aber nicht schnell: Eine Messung wartet auf das Ende
 * der Fahrt UND auf das `idle` der Karte (`stehend`), und das dauert unter Last Sekunden - gemessen mit gedrosselter CPU (Faktor 4 bis 12):
 * 4 bis 10 s bis zum ersten Treffer, ohne Last unter 1 s. Im Volllauf (Browserteil 3, mehrere Arbeiter, Software-Rendering) riss die alte
 * Grenze von 15 s einmal beim zweiten der beiden Fälle (gleicher Ablauf wie der erste, der grün blieb); zehn Läufe des Ablaufs mit Faktor 1
 * bis 12 meldeten jedes Mal den erwarteten Stand. Die Grenze ist eine Obergrenze: Wer den Stand erreicht, kehrt sofort zurück.
 */
const STAND_WARTEN = 60_000;

/** Der Stand, wenn alles steht: Der Einzug dauert 220 ms, der zweite Hinflug folgt ihm. */
async function stehend(page: Page): Promise<{ x: number; y: number; frei: boolean; greifbar: boolean }[]> {
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
    await settleFrame(page);
    return griffe(page);
}

test("🔴 1280 px, Liste offen: Nach dem Start von „Kurve bearbeiten“ liegen alle Griffe zwischen Planer und Fenster, keiner unter dem Fenster", async ({
    page,
}) => {
    test.slow();
    await starteKurve(page);
    await expect
        .poll(async () => (await stehend(page)).every((g) => g.frei), {
            timeout: STAND_WARTEN,
            message: "jeder Griff liegt in der Lücke zwischen Planer und Fenster",
        })
        .toBe(true);
});

test("🔴 1280 px: Kein Griff liegt unter dem Kameraring, er zählt für das Ziel als Deckung (WI-0218 §10, A)", async ({
    page,
}) => {
    test.slow();
    await starteKurve(page);
    await expect
        .poll(async () => (await stehend(page)).every((g) => g.frei && g.greifbar), {
            timeout: STAND_WARTEN,
            message: "jeder Griff liegt frei, auch neben dem Ring",
        })
        .toBe(true);
});
