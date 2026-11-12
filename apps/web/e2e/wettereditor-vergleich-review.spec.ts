import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { WETTER_SYMBOL_VORGABEN, type EditorPowerlineDetail, type EditorPowerlineList } from "@avesmaps3d/shared";
import { oeffneLandmarkenListe, landmarkenStub } from "./landmarken-stub.ts";
import { EDITOR_MODE, openMap, settleFrame } from "./map-handle.ts";
import { editorPanelVorn, oeffneOrtseditor, zeile as ortZeile } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";
import { iconAufFreieStelle, stubWetter } from "./wetter-stub.ts";

/**
 * Vergleichsbilder Wetter-Editor neben Orten, Derographie und Kraftlinien (WI-0288, Betreiber 2026-11-08: „der wettereditor ist noch nicht so wie
 * die andern editoren“), 1600 × 900, nur, wenn jemand die Datei nennt. Geprüft wird hier nichts; das tun `wettereditor.spec.ts` und die
 * Vitest-Fälle. Die Bilder landen in `VERGLEICH_FOTOS` (sonst unter `test-results/`), vorn mit `VERGLEICH_STAND` („vorher“, „nachher“).
 * 🔴 Nichts Schreibendes erreicht einen Server: Jede schreibende Anfrage an `/api` endet im Browser, Listen und Wetter kommen aus Nachbauten.
 */

test.use({ viewport: { width: 1600, height: 900 } });
test.setTimeout(180_000);

const ORDNER = process.env["VERGLEICH_FOTOS"] ?? join("test-results", "editor-vergleich");
const STAND = process.env["VERGLEICH_STAND"] ?? "stand";
mkdirSync(ORDNER, { recursive: true });
const bild = (name: string): string => join(ORDNER, `${STAND}-${name}.png`);

async function nichtsSchreibendes(page: Page): Promise<void> {
    await page.route("**/api/**", (route) =>
        route.request().method() === "GET" ? route.fallback() : route.fulfill({ status: 204, body: "" }),
    );
}

async function wetterFenster(page: Page): Promise<Locator> {
    // Eingeschaltetes Bearbeiten (Testwelt), damit das Kartenmenü die schreibenden Handgriffe zeigt wie an Ort und Gipfel.
    await page.route("**/api/editor/status", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ mapEditing: "testwelt" }),
        }),
    );
    await nichtsSchreibendes(page);
    await stubWetter(page);
    await stubAdmin(page, { capabilities: ["use_editor_menu", "edit_weather"], role: "editor" });
    await openMap(page, EDITOR_MODE);
    await editorPanelVorn(page);
    await page.getByTestId("editorpanel-kachel-wetter").click();
    await settleFrame(page);
    await page.screenshot({ path: bild("panel-wetter") });
    await page.getByTestId("editorpanel-verb").click();
    const liste = page.locator('[data-testid^="wettereditor-"][data-testid$="-liste"]').first();
    await expect(liste).toBeVisible();
    return page.locator(".avm-fenster").filter({ has: liste });
}

test("Wetter-Editor: Preset, Icon, Karte mit Griffen", async ({ page }) => {
    const fenster = await wetterFenster(page);
    await expect(fenster.locator('[data-testid$="-preset"]')).toBeVisible();
    await settleFrame(page);
    await page.screenshot({ path: bild("wetter-preset") });
    const erstes = WETTER_SYMBOL_VORGABEN[0]!;
    // Doppelklick fliegt hin (G3): Das Icon liegt danach in der freien Kartenfläche.
    await fenster.locator('[data-testid$="-wetter-zeile"]').filter({ hasText: erstes.name! }).first().dblclick();
    await expect(fenster.locator('[data-testid$="-icon"]')).toBeVisible();
    await expect.poll(() => page.evaluate(() => globalThis.avesmapsMap?.isMoving() ?? true)).toBe(false);
    await settleFrame(page);
    await page.screenshot({ path: bild("wetter-icon") });
    // Die Karte um das gewählte Icon: Griffe und Farben.
    await iconAufFreieStelle(page, erstes.id, { x: 395, y: 330 });
    // Etwas weiter heraus, damit die Pfeilspitze in der freien Fläche steht; dann das Icon wieder an die freie Stelle.
    await page.evaluate(() => globalThis.avesmapsMap?.jumpTo({ zoom: (globalThis.avesmapsMap?.getZoom() ?? 4) - 1 }));
    await settleFrame(page);
    // Kurzer Pfeil und kleiner Ring (im Nachbau gespeichert), damit beide Griffe neben dem Icon in der freien Fläche stehen.
    await fenster.locator('[data-testid$="-wert-staerke-feld"]').fill("0.6");
    await fenster.locator('[data-testid$="-wert-staerke-feld"]').press("Enter");
    await fenster.locator('[data-testid$="-wert-reichweite-feld"]').fill("180");
    await fenster.locator('[data-testid$="-wert-reichweite-feld"]').press("Enter");
    await settleFrame(page);
    const mitte = await iconAufFreieStelle(page, erstes.id, { x: 395, y: 330 });
    const ausschnitt = { x: Math.max(0, mitte.x - 300), y: Math.max(0, mitte.y - 220), width: 600, height: 440 };
    await page.screenshot({ path: bild("wetter-griffe"), clip: ausschnitt });
    // Mitten im Zug an der Scheibe (Knallrot), dann Esc: nichts wird gespeichert.
    await page.mouse.move(mitte.x, mitte.y);
    await page.mouse.down();
    await page.mouse.move(mitte.x + 30, mitte.y + 20, { steps: 6 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: bild("wetter-zug"), clip: ausschnitt });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    // Mitten im Zug an der Pfeilspitze: der gefasste Griff größer.
    const spitze = await page.locator(`[data-wetter-icon="${erstes.id}"] .ws-griff`).first().boundingBox();
    if (spitze !== null) {
        const at = { x: spitze.x + spitze.width / 2, y: spitze.y + spitze.height / 2 };
        await page.mouse.move(at.x, at.y);
        await page.mouse.down();
        await page.mouse.move(at.x + 15, at.y - 25, { steps: 6 });
        // Während des Zugs wird die Karte nie ruhig: kurz warten statt auf "idle".
        await page.waitForTimeout(400);
        await page.screenshot({ path: bild("wetter-zug-pfeil"), clip: ausschnitt });
        await page.keyboard.press("Escape");
        await page.mouse.up();
    }
    // Rechtsklick auf das Icon: was das Kartenmenü daraus macht.
    await page.mouse.click(mitte.x, mitte.y, { button: "right" });
    await settleFrame(page);
    await page.screenshot({ path: bild("wetter-rechtsklick") });
    await page.keyboard.press("Escape");
});

test("Orte: Ortseditor mit gewähltem Ort", async ({ page }) => {
    await nichtsSchreibendes(page);
    await oeffneOrtseditor(page, { verb: false });
    await settleFrame(page);
    await page.screenshot({ path: bild("panel-orte") });
    await page.getByTestId("editorpanel-verb").click();
    await ortZeile(page, "Gratenfels").first().click();
    await settleFrame(page);
    await page.screenshot({ path: bild("orte") });
});

test("Derographie: Landschaftseditor mit gewählter Fläche", async ({ page }) => {
    await nichtsSchreibendes(page);
    await landmarkenStub(page);
    const liste = await oeffneLandmarkenListe(page);
    await expect(liste.getByRole("option", { name: /Koschberge/ })).toBeVisible();
    await liste.getByRole("option", { name: /Koschberge/ }).click();
    await settleFrame(page);
    await page.screenshot({ path: bild("derographie") });
});

const PUNIN = "b2b2b2b2-0000-4000-8000-000000000001";
const KRAFT_LISTE: EditorPowerlineList = {
    rows: [
        {
            id: PUNIN,
            name: "Punin–Gareth",
            circle: "voll",
            shape: "strang",
            segments: 1,
            nodes: 2,
            ends: ["Gareth", "Punin"],
            bounds: [551, 533, 640, 610],
        },
    ],
};
const KRAFT_DETAIL: EditorPowerlineDetail = {
    id: PUNIN,
    name: "Punin–Gareth",
    circle: "voll",
    shape: "strang",
    segments: [
        {
            id: "b2b2b2b2-0000-4000-8000-0000000000a1",
            from: "p:gareth",
            to: "p:punin",
            curve: 12,
            labelVisible: true,
            revision: 1,
        },
    ],
    nodes: [
        { id: "p:gareth", kind: "place", name: "Gareth", x: 551.6, y: 533, nodix: true, meets: [] },
        { id: "p:punin", kind: "place", name: "Punin", x: 640, y: 610, nodix: true, meets: [] },
    ],
    bounds: [551, 533, 640, 610],
};

test("Kraftlinien: Kraftlinien-Editor mit gewählter Linie", async ({ page }) => {
    await nichtsSchreibendes(page);
    await stubAdmin(page, {
        capabilities: ["use_editor_menu", "edit_map_objects", "edit_map_geometry"],
        role: "editor",
    });
    await page.route("**/api/editor/powerlines", (route) =>
        route.request().method() === "GET"
            ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(KRAFT_LISTE) })
            : route.fulfill({ status: 204, body: "" }),
    );
    await page.route(`**/api/editor/powerlines/${PUNIN}`, (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(KRAFT_DETAIL) }),
    );
    await openMap(page, EDITOR_MODE);
    await editorPanelVorn(page);
    await page.getByTestId("editorpanel-kachel-kraftlinien").click();
    await page.getByTestId("editorpanel-verb").click();
    const liste = page.locator('[data-testid^="kraftlinieneditor-"][data-testid$="-liste"]');
    await liste.getByRole("option", { name: /Punin/ }).click();
    await settleFrame(page);
    await page.screenshot({ path: bild("kraftlinien") });
});
