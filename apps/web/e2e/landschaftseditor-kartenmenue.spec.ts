import { fromVectorTileJs } from "@maplibre/vt-pbf";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { expect, test, type Page } from "@playwright/test";
import type { EditorLandscapeDetail, EditorLandscapeList } from "@avesmaps3d/shared";
import { EDITOR_MODE, onPage, settleFrame } from "./map-handle.ts";
import { editorPanelGemerktZu } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Flächen im Kartenmenü der Editoren (WI-0178 A4, C1; EDIT-0003 T25, T27 (1), (2), (4), (7), T34 (1), (4), F18; Probierblatt). Die Flächen
 * kommen aus den Kacheln der lokalen Karte wie in `area-view-scope.spec.ts`; Liste, Detail und Andockziele des Landschaftseditors aus
 * einem Stub. 🔴 Kein Test schreibt in die Datenbank der Entwicklung.
 *
 * Problemfälle: Auf mehreren Flächen fehlt die Liste „Hier liegen N Flächen“ oder sie wählt still eine; das Untermenü einer Fläche
 * fehlt oder bietet Gesperrtes anklickbar an; in einer Ebene nehmen Flächen anderer Ebenen teil; bei einer Fläche steht ihr Menü hinter
 * einem weiteren Eintrag statt gleich in der Karte; „Beschriftung …“ öffnet nicht den Reiter „Beschriftungen“; „Eigenschaften
 * bearbeiten“ öffnet das Fenster nicht an der Landschaft; bei offenem Fenster wählt ein Klick auf die Fläche sie dort nicht; „Gebietsform
 * bearbeiten“ startet keinen Modus, zählt einen Zug nicht, ↶ geht nicht zurück, Esc beendet ungespeicherte Züge ohne Frage.
 */

/** Eine Stelle mit Flächen in allen drei Ebenen: Vorgebirge des Kosch / Nablaquell-Wälder (wie `area-view-scope.spec.ts`). */
const LAND = { x: 450, y: 560 };

/** Die Liste des Stubs; der Fall mit „Beschriftung …“ setzt die angeklickte Landschaft hinein (das Fenster zeigt nur, was sie führt). */
let liste: EditorLandscapeList = { rows: [] };
/** Die Teilflächen im Detail; leer außer im Fall „Ecken bearbeiten“, der ein Viereck um `LAND` hineinsetzt. */
let flaechen: EditorLandscapeDetail["areas"] = [];
/** Die Nachbarn in den Zielen der Landschaft (Strg + Klick auf eine gemeinsame Kante); leer außer in jenem Fall. */
let nachbarFlaechen: unknown[] = [];
/** Wer die Landschaft hält (EDIT-0003 §4); ohne Angabe bekommt sie, wer fragt. */
let gehaltenVon: string | undefined;
/** Was der Stub der Sperre gesehen hat. */
let sperrAufrufe: string[] = [];
/** Die Sperren anderer, die die Liste nennt (S3); ohne Angabe keine. */
let fremdeSperren: unknown[] = [];
/** So lange lässt die Liste der Sperren auf sich warten (ms): Die frische Antwort kommt nach dem Zeigen aufs Untermenü. */
let sperrListeVerzoegert = 0;
/** Zusätzliche Rechte für einen Fall (etwa `manage_people` zum Aufheben). */
let mehrRechte: string[] = [];
/** Was „Fertig“ geschickt hat (`landscape.update`, C2, B2); nie an einen Server, schon gar nicht an die Datenbank der Entwicklung. */
let formAufrufe: { url: string; body: unknown }[] = [];
const DETAIL: EditorLandscapeDetail = {
    id: "a4a4a4a4-0000-4000-8000-000000000001",
    name: "Probe",
    layer: "vegetation",
    circle: "halb-rechts",
    order: 1,
    clickLocked: false,
    areas: [],
    labels: [
        {
            id: "a4a4a4a4-0000-4000-8000-0000000000b1",
            text: "Probe",
            x: 450,
            y: 560,
            visible: true,
            primary: true,
            revision: 1,
        },
    ],
    neighbors: [],
    revision: 1,
};

/** Die Zeile einer Landschaft im offenen Landschaftseditor. */
const landschaftZeile = (page: Page, name: RegExp) =>
    page.locator('[data-testid^="landschaftseditor-"][data-testid$="-liste"]').getByRole("option", { name });

let runde = 0;
async function oeffne(page: Page, ebene: string, infopanel = false): Promise<void> {
    runde += 1;
    await stubAdmin(page, {
        capabilities: [
            "use_editor_menu",
            "edit_map_objects",
            "edit_map_geometry",
            ...mehrRechte,
            "edit_territories",
            "edit_landscapes",
            "edit_territory_form",
            "edit_landscape_form",
            "edit_mountains",
        ],
        role: mehrRechte.length > 0 ? "admin" : "editor",
    });
    // Die Gruppe steht im Infopanel; das beim Laden offene Editorpanel stünde davor (wie `ortseditor-handgriffe.spec.ts`).
    if (infopanel) await editorPanelGemerktZu(page);
    await page.route("**/api/editor/landscapes", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(liste) }),
    );
    // „Fertig“ schreibt Felder und Form als EINE Operation `landscape.update` (B2, O3): `PATCH` an die Landschaft, mit einer Quittung.
    formAufrufe = [];
    await page.route("**/api/editor/landscapes/*", (route) => {
        if (route.request().method() === "PATCH") {
            formAufrufe.push({ url: route.request().url(), body: route.request().postDataJSON() });
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    operationId: "a4a4a4a4-0000-4000-8000-0000000000e1",
                    status: "applied",
                    environment: "test",
                    affected: [],
                    derivedWork: [],
                    warnings: [],
                    mapRevision: 4711,
                }),
            });
        }
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ ...DETAIL, areas: flaechen }),
        });
    });
    await page.route(/\/api\/editor\/landscapes\/[^/]+\/targets/, (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ margin: 15, neighbors: nachbarFlaechen, edges: [], riverPoints: [] }),
        }),
    );
    // Die Sperre während der Bearbeitung (EDIT-0003 §4): nehmen, schlagen, freigeben, nie gegen die Datenbank der Entwicklung.
    sperrAufrufe = [];
    await page.route(/\/api\/editor\/locks(\/(heartbeat|release|lift))?(\?.*)?$/, async (route) => {
        const url = route.request().url();
        // Die Liste der geltenden Sperren (für gemeinsame Ecken): hier keine fremden.
        if (route.request().method() === "GET") {
            if (sperrListeVerzoegert > 0) await new Promise((fertig) => setTimeout(fertig, sperrListeVerzoegert));
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ locks: fremdeSperren }),
            });
        }
        sperrAufrufe.push(url.slice(url.indexOf("/api/editor/locks")));
        if (url.endsWith("/release")) return route.fulfill({ status: 204 });
        if (url.endsWith("/lift")) {
            fremdeSperren = [];
            return route.fulfill({ status: 204 });
        }
        if (url.endsWith("/heartbeat"))
            return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ lost: [] }) });
        const body = route.request().postDataJSON() as { kind: string; id: string; part: string };
        const lock = {
            ...body,
            person: { id: "a4a4a4a4-0000-4000-8000-0000000000f1", name: gehaltenVon ?? "Rondrikan" },
            since: "2026-10-16T12:00:00.000Z",
            heartbeatAt: "2026-10-16T12:00:00.000Z",
            own: gehaltenVon === undefined,
        };
        return gehaltenVon === undefined
            ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ lock }) })
            : route.fulfill({
                  status: 409,
                  contentType: "application/json",
                  body: JSON.stringify({ error: { code: "object_locked", message: "…", details: { lock } } }),
              });
    });
    // „Gebietsform bearbeiten“ fragt wie am Ort, ob Bearbeiten hier an ist.
    await page.route("**/api/editor/status", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ mapEditing: "testwelt" }),
        }),
    );
    await page.goto(
        `${EDITOR_MODE}?r=${String(runde)}#x=${String(LAND.x)}&y=${String(LAND.y)}&z=6.5&series=original&view=landscapes&layer=${ebene}`,
    );
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 30_000 });
    await settleFrame(page);
}

/** Ganz im Fenster, mit dem Rand des Menüs (8 px), bis auf Rundung. */
function imFenster(page: Page, kasten: { x: number; y: number; width: number; height: number }): void {
    const fenster = page.viewportSize()!;
    expect(kasten.x).toBeGreaterThanOrEqual(4);
    expect(kasten.y).toBeGreaterThanOrEqual(4);
    expect(kasten.x + kasten.width).toBeLessThanOrEqual(fenster.width - 4);
    expect(kasten.y + kasten.height).toBeLessThanOrEqual(fenster.height - 4);
}

/** Eine Stelle nahe der Mitte, an der genau `anzahl` Landschaften der gezeichneten Ebenen liegen (oder mindestens zwei bei `2+`). */
test("🔴 Thomas 4.1/4.2: ein Untermenü der Editoren liegt über der Karte der Besucher; kein Werkzeug ist verdeckt", async ({
    page,
}) => {
    // Die Größe des Fundes auf der Stage: Die Untermenüs klappen nach links und unten über „Was ist hier?“.
    await page.setViewportSize({ width: 1024, height: 768 });
    await oeffne(page, "alle");
    const { at } = await stelleMit(page, "2+");
    await page.mouse.click(at.x, at.y, { button: "right" });
    const karte = page.getByTestId("context-editor");
    await karte.locator('[data-testid^="context-editor-flaeche-"]').first().hover();
    await karte.locator('[data-testid$="|gruppe-form"]').first().hover();
    const form = page.locator('[data-testid$="|gruppe-form-unter"]').first();
    await expect(form).toBeVisible();
    const verdeckt = await form.evaluate((unter) => {
        const besucher = document.querySelector('[data-testid="map-context-menu"]')!.getBoundingClientRect();
        const kasten = unter.getBoundingClientRect();
        const ueberlappt =
            kasten.left < besucher.right &&
            kasten.right > besucher.left &&
            kasten.top < besucher.bottom &&
            kasten.bottom > besucher.top;
        const zugedeckt = [...unter.querySelectorAll<HTMLElement>('[role="menuitem"]')]
            .filter((eintrag) => {
                const r = eintrag.getBoundingClientRect();
                const oben = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                return oben === null || !eintrag.contains(oben);
            })
            .map((eintrag) => eintrag.textContent?.trim());
        return { ueberlappt, zugedeckt };
    });
    expect(verdeckt.ueberlappt, "das Untermenü liegt in dieser Größe über der Karte der Besucher").toBe(true);
    expect(verdeckt.zugedeckt).toEqual([]);
});

async function stelleMit(page: Page, anzahl: 1 | "2+"): Promise<{ at: { x: number; y: number }; id: string }> {
    const gefunden = await page.evaluate((wunsch) => {
        const map = globalThis.avesmapsMap;
        if (!map) throw new Error("map handle missing");
        const ids = (map.getStyle().layers ?? [])
            .map((layer) => layer.id)
            .filter((id) => id.startsWith("landscape-fill-"));
        const mitte = globalThis.avesmapsVisibleArea!.centre();
        // Nur eine Stelle, an der die Karte obenauf liegt: Bei 800 px bleibt neben Planer und Editorpanel keine Lücke, die Mitte der
        // Fläche liegt unter einem Panel, und der Rechtsklick dort öffnete kein Kartenmenü (formmodus A bei 800 × 600).
        const leinwand = map.getCanvas();
        const rahmen = leinwand.getBoundingClientRect();
        const frei = (x: number, y: number): boolean =>
            document.elementFromPoint(rahmen.left + x, rahmen.top + y) === leinwand;
        for (let r = 0; r < 240; r += 8) {
            for (let w = 0; w < 360; w += 30) {
                const x = Math.round(mitte.x + r * Math.cos((w * Math.PI) / 180));
                const y = Math.round(mitte.y + r * Math.sin((w * Math.PI) / 180));
                if (!frei(x, y)) continue;
                const regionen = new Set(
                    map
                        .queryRenderedFeatures([x, y], { layers: ids })
                        .map((f) => String(f.properties["region_public_id"])),
                );
                if (wunsch === 1 ? regionen.size === 1 : regionen.size >= 2)
                    return { x, y, id: [...regionen][0] ?? "" };
            }
        }
        return undefined;
    }, anzahl);
    expect(gefunden, `eine Stelle mit ${String(anzahl)} Landschaft(en)`).toBeDefined();
    const stelle = gefunden as { x: number; y: number; id: string };
    return { at: await onPage(page, stelle), id: stelle.id };
}

test("🔴 „Alle“: der Rechtsklick auf mehrere Flächen beginnt mit „Hier liegen N Flächen“, jede mit ihrem Untermenü", async ({
    page,
}) => {
    await oeffne(page, "alle");
    const { at } = await stelleMit(page, "2+");
    await page.mouse.click(at.x, at.y, { button: "right" });
    const karte = page.getByTestId("context-editor");
    await expect(karte).toContainText("Hier liegen");
    const flaechen = karte.locator('[data-testid^="context-editor-flaeche-"]');
    expect(await flaechen.count()).toBeGreaterThanOrEqual(2);
    // Die Karte der Besucher steht darunter wie immer.
    await expect(page.getByTestId("context-what-is-here")).toBeVisible();

    await flaechen.first().hover();
    const unter = karte.locator('[data-testid$="-unter"]').first();
    await expect(unter).toBeVisible();
    await expect(unter.getByRole("menuitem", { name: "Eigenschaften bearbeiten" })).toBeEnabled();
    await expect(unter.getByRole("menuitem", { name: /Gebietsform bearbeiten/ })).toBeEnabled();
    await expect(unter.getByRole("menuitem", { name: "Beschriftung …", exact: true })).toBeEnabled();
    await expect(unter).toContainText("Reihenfolge und Sperren");
    // Zweite Ebene wie Legacy: „Form ändern ›“ öffnet seine Werkzeuge; seit Thomas 4.1 gehen alle.
    await unter.locator('[data-testid$="|gruppe-form"]').hover();
    const form = page.locator('[data-testid$="|gruppe-form-unter"]').first();
    await expect(form).toBeVisible();
    await expect(form.getByRole("menuitem", { name: "Verschieben" })).toBeEnabled();
    await expect(form.getByRole("menuitem", { name: "Fläche malen" })).toBeEnabled();
    // Alles im Fenster, auch unten.
    const kasten = (await form.boundingBox())!;
    expect(kasten.y + kasten.height).toBeLessThanOrEqual((page.viewportSize()?.height ?? 0) - 4);
    await page.screenshot({ path: "test-results/a4-flaechen-liste.png" });
});

test("🔴 eine Ebene, eine Fläche: gleich ihr Menü in der Karte; „Beschriftung …“ öffnet den Reiter „Beschriftungen“", async ({
    page,
}) => {
    await oeffne(page, "vegetation");
    const { at, id } = await stelleMit(page, 1);
    liste = { rows: [{ id, name: "Probe", layer: "vegetation", circle: "halb-rechts", order: 1 }] };
    await page.mouse.click(at.x, at.y, { button: "right" });
    const karte = page.getByTestId("context-editor");
    await expect(page.getByTestId("context-editor-flaeche-bearbeiten")).toHaveText(/Eigenschaften bearbeiten/);
    await expect(page.getByTestId("context-editor-flaeche-gebietsform")).toBeEnabled();
    await expect(karte).not.toContainText("Hier liegen");
    await expect(karte).toContainText("Form ändern");
    // Beide Karten ganz im Fenster; bei 720 px Höhe reicht es nicht übereinander, sie stehen nebeneinander (T41, Variante a).
    const editorKarte = (await karte.boundingBox())!;
    const besucherKarte = (await page.getByTestId("map-context-menu").boundingBox())!;
    for (const kasten of [editorKarte, besucherKarte]) imFenster(page, kasten);
    expect(besucherKarte.x).toBeGreaterThanOrEqual(editorKarte.x + editorKarte.width);
    await page.getByTestId("context-editor-gruppe-reihenfolge").hover();
    await expect(page.getByTestId("context-editor-gruppe-reihenfolge-unter")).toContainText("Für Klicks sperren");
    await expect(page.getByTestId("context-editor-flaeche-vorn")).toBeEnabled();
    await page.screenshot({ path: "test-results/a4-flaeche-einzeln.png" });

    await page.getByTestId("context-editor-flaeche-beschriftung").click();
    await expect(page.getByTestId("context-editor")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: /Beschriftungen/ })).toHaveAttribute("aria-selected", "true");
});

for (const groesse of [
    { width: 1920, height: 1080 },
    { width: 1280, height: 800 },
]) {
    test(`🔴 ${String(groesse.width)}: der Linksklick auf EINE Fläche wählt sie wie im Frontend, ohne Menü; das Editor-Menü bringt der Rechtsklick`, async ({
        page,
    }) => {
        // WI-0178, Betreiber 2026-10-21, wörtlich: „kannst du zum abschluss noch verhindern, dass beim linksklick diese menüs kommen und
        // nur eine normale auswahl wie im frontend passiert.“ Kehrt T58 (2) um.
        await page.setViewportSize(groesse);
        await oeffne(page, "vegetation");
        const { at, id } = await stelleMit(page, 1);
        liste = { rows: [{ id, name: "Probe", layer: "vegetation", circle: "halb-rechts", order: 1 }] };
        await page.mouse.click(at.x, at.y);
        await expect
            .poll(() =>
                page.evaluate(() => (globalThis.avesmapsSelectedSubject?.() as { kind?: string } | undefined)?.kind),
            )
            .toBe("area");
        await expect(page.getByTestId("context-editor")).toHaveCount(0);
        await expect(page.getByTestId("map-context-menu")).toHaveCount(0);
        await expect(page.getByTestId("area-choices")).toHaveCount(0);
        await expect(page.getByTestId("editor-menu")).toHaveCount(0);
        // Der Rechtsklick an derselben Stelle bringt das Editor-Menü wie bisher.
        await page.mouse.click(at.x, at.y, { button: "right" });
        await expect(page.getByTestId("context-editor-flaeche-bearbeiten")).toHaveText(/Eigenschaften bearbeiten/);
        await expect(page.getByTestId("context-editor-flaeche-gebietsform")).toBeEnabled();
    });
}

test("🔴 1920 × 1080: die zwei Karten stehen übereinander wie bisher, die der Editoren über dem Punkt", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await oeffne(page, "vegetation");
    const { at } = await stelleMit(page, 1);
    await page.mouse.click(at.x, at.y, { button: "right" });
    const editorKarte = (await page.getByTestId("context-editor").boundingBox())!;
    const besucherKarte = (await page.getByTestId("map-context-menu").boundingBox())!;
    for (const kasten of [editorKarte, besucherKarte]) imFenster(page, kasten);
    expect(besucherKarte.y).toBeGreaterThanOrEqual(editorKarte.y + editorKarte.height);
    expect(await page.getByTestId("context-editor").evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
});

test("🔴 schmales Fenster: weder übereinander noch nebeneinander Platz - die Karte der Editoren rollt, ihre Untermenüs stehen darin", async ({
    page,
}) => {
    // 660 px: links und rechts vom Punkt zu wenig für zwei Karten nebeneinander, und noch kein Telefon (bis 640 px).
    await page.setViewportSize({ width: 660, height: 720 });
    // Ohne Editorpanel: Im schmalen Fenster deckte es die Mitte der Karte.
    await oeffne(page, "vegetation", true);
    const { at } = await stelleMit(page, 1);
    await page.mouse.click(at.x, at.y, { button: "right" });
    const karte = page.getByTestId("context-editor");
    await expect(karte).toContainText("Form ändern");
    const editorKarte = (await karte.boundingBox())!;
    const besucherKarte = (await page.getByTestId("map-context-menu").boundingBox())!;
    for (const kasten of [editorKarte, besucherKarte]) imFenster(page, kasten);
    expect(besucherKarte.y).toBeGreaterThanOrEqual(editorKarte.y + editorKarte.height);
    expect(await karte.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    // Das Untermenü klappt im Menü auf, unter seinem Eintrag, und bleibt in der Karte.
    await page.getByTestId("context-editor-gruppe-reihenfolge").scrollIntoViewIfNeeded();
    await page.getByTestId("context-editor-gruppe-reihenfolge").click();
    const unter = page.getByTestId("context-editor-gruppe-reihenfolge-unter");
    await expect(unter).toContainText("Für Klicks sperren");
    const unterKasten = (await unter.boundingBox())!;
    expect(unterKasten.x).toBeGreaterThanOrEqual(editorKarte.x);
    expect(unterKasten.x + unterKasten.width).toBeLessThanOrEqual(editorKarte.x + editorKarte.width + 1);
});

test("🔴 T41 (2): die Ebenenleiste oben wählt die Ebene wie der Fächer, zählt ⊘ und Auge je Ebene, das Auge filtert die Liste", async ({
    page,
}) => {
    liste = {
        rows: [
            {
                id: "a4a4a4a4-0000-4000-8000-0000000000c1",
                name: "Gesperrter Forst",
                layer: "vegetation",
                circle: "voll",
                order: 1,
                clickLocked: true,
            },
            {
                id: "a4a4a4a4-0000-4000-8000-0000000000c2",
                name: "Verborgener Hain",
                layer: "vegetation",
                circle: "voll",
                order: 2,
                hidden: true,
            },
            {
                id: "a4a4a4a4-0000-4000-8000-0000000000c3",
                name: "Verborgener Gipfelkamm",
                layer: "topographie",
                circle: "voll",
                order: 3,
                hidden: true,
            },
        ],
    };
    await oeffne(page, "vegetation");
    await expect(page.getByTestId("ebenenleiste")).toBeVisible();
    await expect(page.getByTestId("ebenenleiste-ebene-vegetation")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("ebenenleiste-gesperrt")).toHaveText("⊘ 1");
    await expect(page.getByTestId("ebenenleiste-verborgen")).toHaveText("1");
    await page.screenshot({ path: "test-results/t41-ebenenleiste.png" });
    // Dieselbe Ebene wie im Fächer: Die Adresse trägt sie, die Zahlen folgen ihr; ohne gesperrte fehlt die Pille.
    await page.getByTestId("ebenenleiste-ebene-topographie").click();
    await expect(page).toHaveURL(/layer=topographie/);
    await expect(page.getByTestId("ebenenleiste-ebene-topographie")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("ebenenleiste-gesperrt")).toHaveCount(0);
    await expect(page.getByTestId("ebenenleiste-verborgen")).toHaveText("1");
    // Das Auge öffnet die Liste, gefiltert auf „verborgen“.
    await page.getByTestId("ebenenleiste-verborgen").click();
    await expect(page.getByText("Verborgener Gipfelkamm")).toBeVisible();
    await expect(page.getByText("Gesperrter Forst")).toHaveCount(0);
    // Auf dem Schirm des Betreibers (1920 × 1080) stehen die Wörter ganz.
    await page.setViewportSize({ width: 1920, height: 1080 });
    await settleFrame(page);
    await page.screenshot({ path: "test-results/t41-ebenenleiste-1920.png" });
});

test("🔴 T41 (2): Besucher sehen die Ebenenleiste nicht, sie wählen im Kartenfächer", async ({ page }) => {
    await page.goto(
        `/?r=t41#x=${String(LAND.x)}&y=${String(LAND.y)}&z=6.5&series=original&view=landscapes&layer=vegetation`,
    );
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 30_000 });
    await settleFrame(page);
    await expect(page.getByTestId("ebenenleiste")).toHaveCount(0);
    // Für Besucher kein Untergrund in der Derographie (T47, Legacy-Profil `untergrund: 0`).
    expect(await page.evaluate(() => globalThis.avesmapsMap?.getLayer("basemap") === undefined)).toBe(true);
});

/** Die Deckkraft der Rasterebene des Untergrunds; ohne Ebene `null`. */
const untergrundDeckkraft = (page: Page) =>
    page.evaluate(() => {
        const map = globalThis.avesmapsMap;
        if (map?.getLayer("basemap") === undefined) return null;
        return map.getPaintProperty("basemap", "raster-opacity") as number;
    });

test("🔴 T47: ◐ in der Ebenenleiste zeigt den Untergrund (Vorgabe 50 %), klappt den Regler auf; 0 % nimmt die Ebene weg, gemerkt im Browser", async ({
    page,
}) => {
    liste = { rows: [] };
    await oeffne(page, "vegetation");
    const knopf = page.getByTestId("ebenenleiste-untergrund-knopf");
    await expect(knopf).toContainText("50 %");
    await expect.poll(() => untergrundDeckkraft(page)).toBe(0.5);
    await expect(page.getByTestId("ebenenleiste-untergrund-zeile")).toHaveCount(0);
    await knopf.click();
    await expect(knopf).toHaveAttribute("aria-expanded", "true");
    await page.getByTestId("ebenenleiste-untergrund-bahn").fill("80");
    await expect(knopf).toContainText("80 %");
    await expect.poll(() => untergrundDeckkraft(page)).toBe(0.8);
    await page.screenshot({ path: "test-results/t47-untergrund.png" });
    await page.getByTestId("ebenenleiste-untergrund-bahn").fill("0");
    await expect.poll(() => untergrundDeckkraft(page)).toBeNull();
    // Ein Klick auf die Karte schließt die Reglerzeile; der Wert bleibt im Browser, auch nach dem Neuladen.
    await page.mouse.click(400, 600);
    await expect(page.getByTestId("ebenenleiste-untergrund-zeile")).toHaveCount(0);
    await page.reload();
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 30_000 });
    await expect(page.getByTestId("ebenenleiste-untergrund-knopf")).toContainText("0 %");
    expect(await untergrundDeckkraft(page)).toBeNull();
});

test("🔴 T47: ☰ steht in der Leiste der Liste rechtsbündig gleich hinter der Sortierung; beide ☰ gedrückt, solange die Liste nach Reihenfolge steht", async ({
    page,
}) => {
    liste = {
        rows: [
            {
                id: "a4a4a4a4-0000-4000-8000-0000000000c1",
                name: "Gesperrter Forst",
                layer: "vegetation",
                circle: "voll",
                order: 1,
                clickLocked: true,
            },
        ],
    };
    await oeffne(page, "vegetation");
    await page.getByTestId("ebenenleiste-stapel").click();
    const leiste = page.locator('[data-testid^="landschaftseditor-"][data-testid$="-landschaften-leiste"]');
    const reihen = page.locator('[data-testid^="landschaftseditor-"][data-testid$="-leiste-reihenfolge"]');
    await expect(reihen).toBeVisible();
    await expect(reihen).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("ebenenleiste-stapel")).toHaveAttribute("aria-pressed", "true");
    // Derselbe Satz wie ☰ in der Ebenenleiste: mit der Zahl der gesperrten Flächen.
    await expect(reihen).toHaveAttribute(
        "aria-label",
        (await page.getByTestId("ebenenleiste-stapel").getAttribute("aria-label")) ?? "",
    );
    await expect(reihen).toHaveAttribute("aria-label", /1/);
    // Leisten-Hausregel (Design Guide §13.45): Suche links, Trichter und Sortierung rechtsbündig, ☰ gleich dahinter am rechten Rand.
    const [suche, filter, sortierung, knopf, ganz] = await Promise.all(
        ["-landschaften-leiste-suche", "-landschaften-filter", "-landschaften-sortierung", "-leiste-reihenfolge"]
            .map((ende) => page.locator(`[data-testid^="landschaftseditor-"][data-testid$="${ende}"]`).boundingBox())
            .concat(leiste.boundingBox()),
    );
    expect(suche!.x).toBeLessThan(filter!.x);
    expect(filter!.x).toBeLessThan(sortierung!.x);
    expect(sortierung!.x).toBeLessThan(knopf!.x);
    expect(Math.abs(knopf!.x + knopf!.width - (ganz!.x + ganz!.width))).toBeLessThanOrEqual(1);
    expect(Math.abs(knopf!.height - sortierung!.height)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: "test-results/t47-liste-reihenfolge.png" });
    // Ein zweiter Druck nimmt es zurück: nach Namen, beide ☰ nicht mehr gedrückt.
    await reihen.click();
    await expect(reihen).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("ebenenleiste-stapel")).toHaveAttribute("aria-pressed", "false");
});

test("🔴 Infopanel einer Landschaft: „Bearbeiten · nur Editoren“ mit Bearbeiten, Reihenfolge und Entfernen; „Beschriftung …“ geht", async ({
    page,
}) => {
    await oeffne(page, "vegetation", true);
    const { at, id } = await stelleMit(page, 1);
    liste = { rows: [{ id, name: "Probe", layer: "vegetation", circle: "halb-rechts", order: 1 }] };
    await page.mouse.click(at.x, at.y);
    // Die Lasche „Info“ ist vorn: Der Klick lässt das Infopanel stehen und öffnet keinen Landschaftseditor (wie am Ort, 182a8519).
    await expect(page.locator('[data-testid^="landschaftseditor-"][data-testid$="-liste"]')).toHaveCount(0);
    const gruppe = page.getByTestId("handgriff-gruppe");
    await expect(gruppe).toBeVisible();
    // Mit „Verbergen“ (T41) acht.
    await expect(gruppe.getByRole("button")).toHaveCount(8);
    await expect(page.getByTestId("griff-flaeche-bearbeiten")).toBeEnabled();
    await expect(page.getByTestId("griff-flaeche-gebietsform")).toBeEnabled();
    // „Fläche entfernen …“ geht seit D2.
    await expect(page.getByTestId("griff-flaeche-entfernen")).toBeEnabled();
    // Die Werkzeuge der Form stehen nur im Kartenmenü.
    await expect(page.getByTestId("griff-flaeche-zerschneiden")).toHaveCount(0);
    await page.getByTestId("griff-flaeche-beschriftung").click();
    await expect(page.getByRole("tab", { name: /Beschriftungen/ })).toHaveAttribute("aria-selected", "true");
});

test("🔴 D1, T53: an derselben Stelle wählt der Klick die Fläche, für Klicks gesperrt nicht mehr", async ({ page }) => {
    // Die Flächenkacheln melden JEDE Fläche als gesperrt (`is_locked`, wie `region_area_render` sie trägt); keine Kartenänderung,
    // nur die Antwort wird umgeschrieben. Gezeichnet werden sie weiter.
    let sperren = false;
    await page.route("**/tiles/vector/region_area_tile/**", async (route) => {
        // Ohne Bedingung und ohne Zwischenspeicher: Sonst käme nach dem Neuladen die umgeschriebene Kachel aus dem Browser zurück (304).
        const frage = Object.fromEntries(
            Object.entries(route.request().headers()).filter(
                ([name]) => !["if-none-match", "if-modified-since"].includes(name),
            ),
        );
        const antwort = await route.fetch({ headers: frage });
        const headers: Record<string, string> = { ...antwort.headers(), "cache-control": "no-store" };
        if (!sperren || antwort.status() !== 200) return route.fulfill({ response: antwort, headers });
        const kachel = new VectorTile(new PbfReader(await antwort.body()));
        for (const ebene of Object.values(kachel.layers)) {
            const lies = ebene.feature.bind(ebene);
            ebene.feature = (i: number) => {
                const flaeche = lies(i);
                flaeche.properties["is_locked"] = true;
                return flaeche;
            };
        }
        delete headers["content-encoding"];
        delete headers["content-length"];
        return route.fulfill({ status: 200, headers, body: Buffer.from(fromVectorTileJs(kachel)) });
    });
    const gewaehlt = () =>
        page.evaluate(() =>
            (
                globalThis as unknown as { avesmapsAreaSelection?: () => { id?: string } | undefined }
            ).avesmapsAreaSelection?.(),
        );
    // Ohne Sperre trifft der Klick die Fläche an der Stelle.
    await oeffne(page, "vegetation", true);
    const { at, id } = await stelleMit(page, 1);
    await page.mouse.click(at.x, at.y);
    await expect.poll(async () => (await gewaehlt())?.id).toBe(id);
    // Dieselbe Ansicht mit gesperrten Flächen: gezeichnet, aber der Klick nimmt keine.
    sperren = true;
    await oeffne(page, "vegetation", true);
    await page.mouse.click(at.x, at.y);
    await expect(page.getByTestId("area-choices")).toHaveCount(0);
    await expect.poll(gewaehlt).toBeUndefined();
    await expect(page.getByTestId("handgriff-gruppe")).toHaveCount(0);
});

test("🔴 T41: eine verborgene Fläche steht für Editoren schraffiert mit Auge; der Rechtsklick bietet „Zurückholen“, das Auge öffnet ihr Fenster", async ({
    page,
}) => {
    const VERBORGEN = "a4a4a4a4-0000-4000-8000-0000000000b9";
    // Nach `oeffne`: Dessen Stub für `landscapes/*` ginge sonst vor (die zuletzt angemeldete Route gewinnt).
    await oeffne(page, "vegetation");
    await page.route("**/api/editor/landscapes/hidden", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                rows: [
                    {
                        id: VERBORGEN,
                        name: "Verborgener Hain",
                        layer: "vegetation",
                        type: "wald",
                        polygons: [
                            [
                                [
                                    [LAND.x - 8, LAND.y - 8],
                                    [LAND.x + 8, LAND.y - 8],
                                    [LAND.x + 8, LAND.y + 8],
                                    [LAND.x - 8, LAND.y + 8],
                                ],
                            ],
                        ],
                        at: [LAND.x, LAND.y],
                    },
                ],
            }),
        }),
    );
    await page.reload();
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 30_000 });
    const auge = page.getByTestId("verborgen-auge");
    await expect(auge).toBeVisible();
    await expect(auge).toHaveAttribute("title", /Verborgener Hain: für Besucher verborgen/);
    await expect
        .poll(() =>
            page.evaluate(() =>
                globalThis.avesmapsMap!.getStyle().layers?.some((l) => l.id === "editor-verborgen-schraffur"),
            ),
        )
        .toBe(true);
    // Ihr Stand: verborgen (der allgemeine Stub nimmt weiter das PATCH).
    await page.route(`**/api/editor/landscapes/${VERBORGEN}`, (route) =>
        route.request().method() === "GET"
            ? route.fulfill({
                  status: 200,
                  contentType: "application/json",
                  body: JSON.stringify({ ...DETAIL, id: VERBORGEN, name: "Verborgener Hain", hidden: true }),
              })
            : route.fallback(),
    );
    // Der Rechtsklick trifft die schraffierte Fläche (neben dem Auge): Ihr Menü bietet „Zurückholen“ statt „Verbergen“, flach vor
    // „Reihenfolge und Sperren ›“, und es schreibt sofort wie am Ort (T41 (4), Blatt B und C).
    await settleFrame(page);
    const daneben = await onPage(page, { x: LAND.x + 6, y: LAND.y + 6 });
    await page.mouse.click(daneben.x, daneben.y, { button: "right" });
    const karte = page.getByTestId("context-editor");
    const eintrag = karte.locator('[data-testid^="context-editor-flaeche-"]', { hasText: "Verborgener Hain" });
    await eintrag.hover();
    const menue = page.getByRole("menu", { name: "Verborgener Hain" });
    await expect(menue.getByRole("menuitem", { name: "Verbergen" })).toHaveCount(0);
    await menue.getByRole("menuitem", { name: "Zurückholen" }).click();
    await expect.poll(() => formAufrufe.length).toBe(1);
    expect(formAufrufe[0]!.url).toContain(VERBORGEN);
    expect(formAufrufe[0]!.body).toEqual({
        operationId: expect.any(String),
        baseRevision: DETAIL.revision,
        changes: { hidden: false },
    });
    await expect(page.getByText(/Verborgener Hain ist zurückgeholt und für Besucher wieder sichtbar/)).toBeVisible();
    // Das Auge öffnet ihr Fenster; das Band sagt „Verborgen: …“ und holt ebenso sofort zurück.
    await auge.click();
    await expect(page.getByTestId(/^landschaftseditor-fenster-\d+-eigenschaften$/)).toBeVisible();
    await expect(page.getByTestId(/^landschaftseditor-fenster-\d+-verborgen$/)).toContainText(
        "Verborgen: Besucher sehen weder Fläche noch Namen, Editoren sehen sie.",
    );
    await page.getByTestId(/^landschaftseditor-fenster-\d+-zurueckholen$/).click();
    await expect.poll(() => formAufrufe.length).toBe(2);
    expect(formAufrufe[1]!.body).toMatchObject({ changes: { hidden: false } });
});

test("🔴 Linksklick auf mehrere Flächen: die Liste ohne Untermenü; ein Eintrag wählt seine Fläche, ohne Menü", async ({
    page,
}) => {
    // WI-0178, Betreiber 2026-10-21, wörtlich: „Das Hier liegen 3 Flächen soll aber bleiben und bei der auswahl die fläche halt
    // auswählen“, „aber keine untermenüs mehr haben“.
    await oeffne(page, "alle", true);
    const { at, id } = await stelleMit(page, "2+");
    liste = { rows: [{ id, name: "Probe", layer: "vegetation", circle: "halb-rechts", order: 1 }] };
    await page.mouse.click(at.x, at.y);
    const auswahl = page.getByTestId("area-choices");
    await expect(auswahl).toBeVisible();
    const erster = auswahl.getByTestId("area-choice").first();
    await erster.hover();
    await expect(auswahl.getByRole("menu")).toHaveCount(0);
    await expect(erster).not.toHaveAttribute("aria-haspopup", /.+/);
    await erster.click();
    await expect(page.getByTestId("area-choices")).toHaveCount(0);
    await expect(page.getByTestId("context-editor")).toHaveCount(0);
    await expect(page.getByTestId("editor-menu")).toHaveCount(0);
    expect(
        await page.evaluate(() => (globalThis.avesmapsSelectedSubject?.() as { kind?: string } | undefined)?.kind),
    ).toBe("area");
});

for (const groesse of [
    { width: 1920, height: 1080 },
    { width: 1280, height: 800 },
]) {
    test(`🔴 ${String(groesse.width)}: in der Linksklick-Liste heißt eine Region ohne Art „Region“, und die Zeile der gelb markierten Fläche steht gelb`, async ({
        page,
    }) => {
        await page.setViewportSize(groesse);
        await oeffne(page, "alle", true);
        const { at } = await stelleMit(page, "2+");
        await page.mouse.click(at.x, at.y);
        const auswahl = page.getByTestId("area-choices");
        await expect(auswahl).toBeVisible();
        // Rechts steht bei jeder Fläche eine Art; Regionen wie Svelltland oder Gjalskerland „Region“ (Betreiber 2026-10-20).
        const arten = await auswahl.locator(".area-choices__type").allTextContents();
        expect(arten.length).toBeGreaterThanOrEqual(2);
        for (const art of arten) expect(art.trim()).not.toBe("");
        // Gelb wie die Karte: erst die gewählte Fläche, beim Darüberfahren wandert es mit.
        const eintraege = auswahl.getByTestId("area-choice");
        const gelb = await page.evaluate(() => {
            const probe = document.createElement("span");
            probe.style.color = "var(--color-list-selection-text)";
            document.body.append(probe);
            const farbe = getComputedStyle(probe).color;
            probe.remove();
            return farbe;
        });
        const markiert = auswahl.locator(".area-choices__item.is-markiert");
        await expect(markiert).toHaveCount(1);
        await expect(markiert).toHaveAttribute("aria-checked", "true");
        await expect(markiert).toHaveCSS("color", gelb);
        // 🔴 Auch der Name steht gelb, nicht nur die Art (Fund der Hauptorchestrierung 2026-10-20: `.area-choices__name` hatte eine eigene Farbe).
        await expect(markiert.locator(".area-choices__name")).toHaveCSS("color", gelb);
        // 🔴 Beim Darüberfahren zeigt die Karte die gewählte UND die überfahrene gelb, die Liste ebenso (Editor-Orchestrierung 2026-10-20).
        const andere = auswahl.locator('[data-testid="area-choice"][aria-checked="false"]').first();
        await andere.hover();
        await expect(andere).toHaveClass(/is-markiert/);
        await expect(andere.locator(".area-choices__name")).toHaveCSS("color", gelb);
        await expect(markiert).toHaveCount(2);
        // Verlässt der Zeiger die Zeile, bleibt nur die gewählte gelb.
        await auswahl.locator(".area-choices__title").hover();
        await expect(markiert).toHaveCount(1);
        await expect(markiert).toHaveAttribute("aria-checked", "true");
        await expect(eintraege.first()).toBeVisible();
        await page.screenshot({ path: `test-results/liste-gelb-${String(groesse.width)}.png` });
    });
}

/** Bildschirmlage eines Kartenpunkts (MCS) wie in `editor-menu.spec.ts`. */
async function schirm(page: Page, punkt: { x: number; y: number }): Promise<{ x: number; y: number }> {
    const box = await page.getByTestId("map").boundingBox();
    const at = await page.evaluate(
        (ziel) => globalThis.avesmapsMap!.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(ziel)),
        punkt,
    );
    return { x: (box?.x ?? 0) + at.x, y: (box?.y ?? 0) + at.y };
}

/** Eine Ecke greifen und um `dx` Bildpunkte nach rechts ziehen. */
async function zieheEcke(page: Page, ecke: { x: number; y: number }, dx: number): Promise<void> {
    const von = await schirm(page, ecke);
    await page.mouse.move(von.x, von.y);
    await page.mouse.down();
    await page.mouse.move(von.x + dx, von.y + 6, { steps: 8 });
    await page.mouse.up();
}

test("🔴 „Gebietsform bearbeiten“: Leiste „Ecken bearbeiten“, ein Zug zählt, ↶ nimmt ihn zurück, Esc fragt vor dem Verwerfen", async ({
    page,
}) => {
    try {
        await oeffne(page, "vegetation");
        // Die Fläche ganz im freien Bild: Seit formmodus A (Kamera, WI-0218) bleibt der Zoom stehen, solange ein Teil zu sehen ist;
        // eine feste Fläche um (450, 560) lag bei z 6,5 mit ihren Ecken außerhalb des Bildes.
        const ecken = await flaecheImBild(page);
        const { at, id } = await stelleMit(page, 1);
        liste = { rows: [{ id, name: "Probe", layer: "vegetation", circle: "halb-rechts", order: 1 }] };
        await page.mouse.click(at.x, at.y, { button: "right" });
        await page.getByTestId("context-editor-flaeche-gebietsform").click();

        const leiste = page.getByTestId("ecken-leiste");
        await expect(leiste).toBeVisible();
        // Die Ebenenleiste bleibt stehen, die Leiste des Modus steht darunter (WI-0225; vorher wich sie ihr, T41 (2)).
        await expect(page.getByTestId("ebenenleiste")).toBeVisible();
        await expect(leiste).toContainText("Ecken bearbeiten");
        await expect(leiste).toContainText("Probe");
        await expect(page.getByTestId("ecken-leiste-ungespeichert")).toHaveText("0 ungespeichert");
        // „Fertig“ geht immer: ohne Schritt endet der Modus, sonst speichert er (C2).
        await expect(page.getByTestId("ecken-leiste-fertig")).toBeEnabled();
        await expect(page.getByTestId("ecken-leiste-zurueck")).toBeDisabled();
        // Die Kamera fliegt zur Fläche (Hausregel „Kamera fliegt immer“); gezogen wird erst, wenn sie steht.
        await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
        await settleFrame(page);

        // R schaltet die Rundung aus und an (Betreiber 2026-11-06); das Kürzel „Ziel hinzufügen“ kommt dabei nicht durch. Aus bleibt sie bis zum Ende des Modus.
        const rollen = (): Promise<string[]> =>
            page.evaluate(() => {
                const quelle = globalThis.avesmapsMap?.getSource?.("geometrie") as unknown as
                    { serialize(): { data: { features: { properties: { rolle: string } }[] } } } | undefined;
                return (quelle?.serialize().data.features ?? []).map((f) => f.properties.rolle);
            });
        const wegpunkte = await page.getByTestId("waypoint-input").count();
        await expect.poll(rollen).toContain("ecken");
        await page.keyboard.press("r");
        await expect.poll(rollen).not.toContain("ecken");
        expect(await rollen()).toContain("kante");
        await page.keyboard.press("r");
        await expect.poll(rollen).toContain("ecken");
        await page.keyboard.press("r");
        await expect.poll(rollen).not.toContain("ecken");
        await expect(page.getByTestId("waypoint-input")).toHaveCount(wegpunkte);

        // Die Ecke liegt in der freien Karte: Kein Panel und kein leerer Kasten nimmt der Karte dort den Griff.
        const ecke = await schirm(page, ecken[1]!);
        expect(await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.tagName, [ecke.x, ecke.y])).toBe(
            "CANVAS",
        );
        await zieheEcke(page, ecken[1]!, 40);
        await expect(page.getByTestId("ecken-leiste-ungespeichert")).toHaveText("1 ungespeichert");
        await expect(page.getByTestId("ecken-leiste-zurueck")).toBeEnabled();
        await settleFrame(page);
        await page.screenshot({ path: "test-results/c1-ecken.png" });

        await page.getByTestId("ecken-leiste-zurueck").click();
        await expect(page.getByTestId("ecken-leiste-ungespeichert")).toHaveText("0 ungespeichert");
        await page.keyboard.press("Control+y");
        await expect(page.getByTestId("ecken-leiste-ungespeichert")).toHaveText("1 ungespeichert");

        // Esc mit einem ungespeicherten Zug: erst die Frage; „Weiter bearbeiten“ bleibt im Modus, „Verwerfen“ beendet ihn.
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("ecken-leiste-frage")).toBeVisible();
        await page.getByTestId("ecken-leiste-frage-nein").click();
        await expect(page.getByTestId("ecken-leiste-frage")).toHaveCount(0);
        await expect(page.getByTestId("ecken-leiste-ungespeichert")).toHaveText("1 ungespeichert");
        await page.keyboard.press("Escape");
        await page.getByTestId("ecken-leiste-frage-ja").click();
        await expect(leiste).toHaveCount(0);
        // Erst gesperrt, dann bearbeitet; das Ende gibt frei (EDIT-0003 §4).
        expect(sperrAufrufe[0]).toBe("/api/editor/locks");
        await expect.poll(() => sperrAufrufe.at(-1)).toBe("/api/editor/locks/release");
        expect(formAufrufe).toEqual([]);

        // „Fertig“ (C2): EINE Operation mit der Fläche gegen ihre Revision, die Karte lädt mit der neuen Kachelrevision, der Modus endet.
        // Die Kamera stand still (die Fläche war ganz zu sehen): dieselbe Stelle noch einmal.
        await page.mouse.click(at.x, at.y, { button: "right" });
        await page.getByTestId("context-editor-flaeche-gebietsform").click();
        await expect(leiste).toBeVisible();
        await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
        await settleFrame(page);
        // Der neue Modus beginnt wieder gerundet.
        await expect.poll(rollen).toContain("ecken");
        await zieheEcke(page, ecken[1]!, 40);
        await expect(page.getByTestId("ecken-leiste-ungespeichert")).toHaveText("1 ungespeichert");
        await page.getByTestId("ecken-leiste-fertig").click();
        await expect(leiste).toHaveCount(0);
        await expect(page.getByText("✓ Gebietsform von „Probe“ gespeichert.")).toBeVisible();
        expect(formAufrufe).toHaveLength(1);
        expect(formAufrufe[0]!.url).toMatch(new RegExp(`/api/editor/landscapes/${id}$`));
        expect(formAufrufe[0]!.body).toMatchObject({
            areas: [{ id: "a4a4a4a4-0000-4000-8000-0000000000a1", baseRevision: 4 }],
        });
        const ring = (formAufrufe[0]!.body as { areas: { polygons: number[][][][] }[] }).areas[0]!.polygons[0]![0]!;
        expect(ring).toHaveLength(4);
        expect(ring[1]![0]).toBeGreaterThan(ecken[1]!.x);
        await expect
            .poll(() =>
                page.evaluate(() =>
                    JSON.stringify(
                        (
                            globalThis.avesmapsMap?.getStyle() as unknown as
                                { sources: Record<string, { tiles?: string[] }> } | undefined
                        )?.sources["landscapes"]?.tiles,
                    ),
                ),
            )
            .toContain("r=4711");
        await expect.poll(() => sperrAufrufe.at(-1)).toBe("/api/editor/locks/release");
    } finally {
        flaechen = [];
    }
});

test("🔴 Strg über einer Kante zeigt vier Punkte, Strg + Klick setzt sie (Betreiber 2026-10-20, Legacy), auf der gemeinsamen Kante auch beim Nachbarn; an der Ecke gehört Strg dem Trennen", async ({
    page,
}) => {
    const teilungsPunkte = () =>
        page.evaluate(
            () => globalThis.avesmapsMap!.queryRenderedFeatures({ layers: ["geometrie-teilung-punkt"] }).length,
        );
    try {
        await oeffne(page, "vegetation");
        const ecken = await flaecheImBild(page);
        // Ein Nachbar teilt die rechte Kante (Ecke 1 → Ecke 2): Seine zwei Ecken liegen genau auf ihren.
        nachbarFlaechen = [
            {
                id: "a4a4a4a4-0000-4000-8000-0000000000a2",
                regionId: "a4a4a4a4-0000-4000-8000-000000000002",
                name: "Nachbar",
                revision: 3,
                polygons: [
                    [
                        [
                            [ecken[1]!.x, ecken[1]!.y],
                            [ecken[2]!.x, ecken[2]!.y],
                            [ecken[2]!.x + 3, ecken[2]!.y],
                            [ecken[1]!.x + 3, ecken[1]!.y],
                        ],
                    ],
                ],
            },
        ];
        const { at, id } = await stelleMit(page, 1);
        liste = { rows: [{ id, name: "Probe", layer: "vegetation", circle: "halb-rechts", order: 1 }] };
        await page.mouse.click(at.x, at.y, { button: "right" });
        await page.getByTestId("context-editor-flaeche-gebietsform").click();
        await expect(page.getByTestId("ecken-leiste")).toBeVisible();
        await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
        await settleFrame(page);

        // An der Ecke gehört Strg dem Trennen: keine Vorschau.
        const ecke = await schirm(page, ecken[1]!);
        await page.mouse.move(ecke.x + 3, ecke.y + 2);
        await page.keyboard.down("Control");
        await page.mouse.move(ecke.x + 4, ecke.y + 3);
        await settleFrame(page);
        expect(await teilungsPunkte()).toBe(0);
        await page.keyboard.up("Control");

        // Über der Mitte der Kante: Strg drücken, ohne die Maus zu bewegen, zeigt die vier; loslassen nimmt sie weg.
        const mitte = await schirm(page, { x: (ecken[1]!.x + ecken[2]!.x) / 2, y: (ecken[1]!.y + ecken[2]!.y) / 2 });
        await page.mouse.move(mitte.x + 6, mitte.y);
        await settleFrame(page);
        expect(await teilungsPunkte()).toBe(0);
        await page.keyboard.down("Control");
        await expect.poll(teilungsPunkte).toBe(4);
        await page.keyboard.up("Control");
        await expect.poll(teilungsPunkte).toBe(0);

        // Strg + Doppelklick: der erste Klick setzt die vier, der zweite nichts (350 ms), und kein einzelner Punkt dazu.
        await page.keyboard.down("Control");
        await page.mouse.dblclick(mitte.x + 6, mitte.y);
        await page.keyboard.up("Control");
        await expect(page.getByTestId("ecken-leiste-ungespeichert")).toHaveText("1 ungespeichert");
        await expect
            .poll(() =>
                page.evaluate(
                    () => globalThis.avesmapsMap!.queryRenderedFeatures({ layers: ["geometrie-anfasser"] }).length,
                ),
            )
            .toBe(8);

        await page.getByTestId("ecken-leiste-fertig").click();
        await expect(page.getByTestId("ecken-leiste")).toHaveCount(0);
        expect(formAufrufe).toHaveLength(1);
        const flaechenIm = (formAufrufe[0]!.body as { areas: { id: string; polygons: number[][][][] }[] }).areas;
        const ring = (areaId: string) => flaechenIm.find((a) => a.id === areaId)!.polygons[0]![0]!;
        expect(ring("a4a4a4a4-0000-4000-8000-0000000000a1")).toHaveLength(8);
        // B: Der Nachbar bekommt dieselben vier Punkte auf der gemeinsamen Kante.
        const seiner = ring("a4a4a4a4-0000-4000-8000-0000000000a2");
        expect(seiner).toHaveLength(8);
        expect(seiner.slice(1, 5).map((q) => q[0])).toEqual(
            ring("a4a4a4a4-0000-4000-8000-0000000000a1")
                .slice(2, 6)
                .map((q) => q[0]),
        );
    } finally {
        flaechen = [];
        nachbarFlaechen = [];
    }
});

test("🔴 hält ein anderer die Landschaft, beginnt „Gebietsform bearbeiten“ nicht und sagt, wer sie bearbeitet (EDIT-0003 §4)", async ({
    page,
}) => {
    flaechen = [
        {
            id: "a4a4a4a4-0000-4000-8000-0000000000a1",
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
    ];
    gehaltenVon = "Thomas";
    try {
        await oeffne(page, "vegetation");
        const { at, id } = await stelleMit(page, 1);
        liste = { rows: [{ id, name: "Probe", layer: "vegetation", circle: "halb-rechts", order: 1 }] };
        await page.mouse.click(at.x, at.y, { button: "right" });
        await page.getByTestId("context-editor-flaeche-gebietsform").click();
        await expect(page.getByText("„Probe“ bearbeitet gerade Thomas.")).toBeVisible();
        await expect(page.getByTestId("ecken-leiste")).toHaveCount(0);
        expect(sperrAufrufe).toEqual(["/api/editor/locks"]);
    } finally {
        flaechen = [];
        gehaltenVon = undefined;
    }
});

test.describe("Landschaftseditor offen, die Fläche daneben auf der Karte", () => {
    // Das angedockte Fenster ist 960 px breit: Erst auf einem breiten Schirm mit eingeklapptem Planer bleibt Karte neben ihm frei.
    test.use({ viewport: { width: 1920, height: 1080 } });

    test("🔴 „Eigenschaften bearbeiten“ öffnet das Fenster an der Fläche; bei offenem Fenster wählt der Klick auf die Fläche sie dort (T34 (1))", async ({
        page,
    }) => {
        await oeffne(page, "vegetation");
        await page.getByTestId("route-planner-tab").click();
        await expect(page.getByTestId("route-planner-tab")).toHaveAttribute("aria-expanded", "false");
        const { at, id } = await stelleMit(page, 1);
        const ort = await page.evaluate(
            ([x, y]) => {
                const box = globalThis.avesmapsMap!.getCanvas().getBoundingClientRect();
                const lngLat = globalThis.avesmapsMap!.unproject([x! - box.left, y! - box.top]);
                return { lng: lngLat.lng, lat: lngLat.lat };
            },
            [at.x, at.y],
        );
        liste = {
            rows: [
                { id, name: "Probe", layer: "vegetation", circle: "halb-rechts", order: 1 },
                {
                    id: "a4a4a4a4-0000-4000-8000-0000000000c2",
                    name: "Andere",
                    layer: "vegetation",
                    circle: "voll",
                    order: 2,
                },
            ],
        };
        await page.mouse.click(at.x, at.y, { button: "right" });
        await page.getByTestId("context-editor-flaeche-bearbeiten").click();
        // Von der Karte geöffnet, steht das Fenster nur mit den Eigenschaften (EDIT-0003, Variante A); der Pfeil holt die Liste.
        const schalter = page.getByTestId(/^landschaftseditor-fenster-\d+-listenschalter$/);
        await expect(schalter).toHaveAttribute("aria-expanded", "false");
        await schalter.click();
        await expect(landschaftZeile(page, /Probe/)).toHaveAttribute("aria-selected", "true");

        // Im Fenster eine andere Landschaft wählen, dann die Fläche neben dem Fenster anklicken: Sie wählt sich dort, wie am Ort.
        await landschaftZeile(page, /Andere/).click();
        await expect(landschaftZeile(page, /Andere/)).toHaveAttribute("aria-selected", "true");
        const neben = await page.evaluate(async (mitte) => {
            const map = globalThis.avesmapsMap!;
            map.jumpTo({ center: mitte });
            // Seit WI-0218 steht die Mitte der Karte in der Bildmitte, unter dem angedockten Fenster: die Fläche in die freie Mitte
            // daneben rücken, wie es früher MapLibres `padding` von selbst tat.
            const canvas = map.getCanvas();
            const frei = globalThis.avesmapsVisibleArea!.centre();
            map.jumpTo({ center: map.unproject([canvas.clientWidth - frei.x, canvas.clientHeight - frei.y]) });
            await new Promise<void>((resolve) => map.once("idle", resolve));
            const box = map.getCanvas().getBoundingClientRect();
            const p = map.project(mitte);
            return { x: box.left + p.x, y: box.top + p.y };
        }, ort);
        expect(await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.tagName, [neben.x, neben.y])).toBe(
            "CANVAS",
        );
        await page.mouse.click(neben.x, neben.y);
        await expect(landschaftZeile(page, /Probe/)).toHaveAttribute("aria-selected", "true");
        await expect(landschaftZeile(page, /Probe/)).toBeVisible();
    });

    test("🔴 ist der Landschaftseditor zu, öffnet ihn der Klick auf eine Fläche an ihrer Landschaft (T34 (1): „muss automatisch kommen“)", async ({
        page,
    }) => {
        await oeffne(page, "vegetation");
        const { at, id } = await stelleMit(page, 1);
        liste = { rows: [{ id, name: "Probe", layer: "vegetation", circle: "halb-rechts", order: 1 }] };
        await expect(page.locator('[data-testid^="landschaftseditor-"][data-testid$="-liste"]')).toHaveCount(0);
        await page.mouse.click(at.x, at.y);
        await expect(landschaftZeile(page, /Probe/)).toHaveAttribute("aria-selected", "true");
        await expect(landschaftZeile(page, /Probe/)).toBeVisible();
    });
});

test("🔴 ein offenes Untermenü bleibt offen, wenn die frischen Sperren nach dem Zeigen kommen; der schräge Weg mit der Maus trifft den Eintrag", async ({
    page,
}) => {
    // Befund der Wege-Sitzung (2026-10-17): Ein echter Mausklick auf einen Eintrag im Untermenü tat nichts, Tastatur und ein ausgelöster
    // Klick gingen. Zwei Ursachen, beide hier gegen den alten Stand rot: (1) Nach dem Öffnen fragt das Kartenmenü die Sperren frisch und
    // baut seine Abschnitte neu; das schloss jedes offene Untermenü. (2) Der Weg schräg hinunter zu einem Eintrag des Untermenüs streift
    // den Rand des Menüs; das Untermenü ging sofort zu, und der Klick traf, was dahinter lag (hier das Editorpanel).
    // In der Derographie steht unter „Hier hinzufügen“ nur „Neue Fläche ›“, in der Topographie dazu „Gipfel setzen …“ (Betreiber
    // 2026-10-18, EDIT-0003 §6): Der Fall klickt diesen Eintrag. Der Stub nimmt das Setzen an; nichts erreicht den Server.
    await page.route("**/api/editor/peaks", (route) =>
        route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
    );
    await oeffne(page, "topographie");
    const { at, id } = await stelleMit(page, 1);
    liste = { rows: [{ id, name: "Probe", layer: "topographie", circle: "halb-rechts", order: 1 }] };
    sperrListeVerzoegert = 600;
    try {
        const frisch = page.waitForResponse((antwort) => /\/api\/editor\/locks\?/.test(antwort.url()));
        await page.mouse.click(at.x, at.y, { button: "right" });
        await page.getByTestId("context-editor-hier-hinzufuegen").hover();
        const unter = page.getByTestId("context-editor-hier-hinzufuegen-unter");
        await expect(unter).toBeVisible();
        // Ein Blatt des Menüs (WI-0271 L4: „▲ Landmarke setzen ›“ ist ein Untermenü, darin die Arten).
        await page.getByTestId("context-editor-landmarke-setzen").hover();
        const box = (await page.getByTestId("context-editor-landmarke-setzen-hoehle").boundingBox())!;
        // Die frischen Sperren kommen, während der Zeiger auf dem Untermenü steht.
        await frisch;
        await settleFrame(page);
        await expect(unter).toBeVisible();
        // Ein echter Mausklick (pointerdown, mousedown, mouseup, click) kommt beim Eintrag an, und das Menü schließt über ihn.
        await page.evaluate(() => {
            const ziele: string[] = [];
            (globalThis as unknown as { klickZiele: string[] }).klickZiele = ziele;
            for (const art of ["pointerdown", "click"])
                document.addEventListener(
                    art,
                    (event) => {
                        const ziel = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-testid]");
                        ziele.push(`${art}:${ziel?.dataset["testid"] ?? "nichts"}`);
                    },
                    { capture: true },
                );
        });
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        expect(await page.evaluate(() => (globalThis as unknown as { klickZiele: string[] }).klickZiele)).toEqual([
            "pointerdown:context-editor-landmarke-setzen-hoehle",
            "click:context-editor-landmarke-setzen-hoehle",
        ]);
        await expect(page.getByTestId("context-editor")).toHaveCount(0);
    } finally {
        sperrListeVerzoegert = 0;
    }
});

test("🔴 Esc in „Ecken bearbeiten“ mit offenem Kartenmenü: das erste schließt das Menü, erst das zweite fragt (Stage-Fund 2026-10-20)", async ({
    page,
}) => {
    try {
        await oeffne(page, "vegetation");
        const ecken = await flaecheImBild(page);
        const { at, id } = await stelleMit(page, 1);
        liste = { rows: [{ id, name: "Probe", layer: "vegetation", circle: "halb-rechts", order: 1 }] };
        await page.mouse.click(at.x, at.y, { button: "right" });
        await page.getByTestId("context-editor-flaeche-gebietsform").click();
        const leiste = page.getByTestId("ecken-leiste");
        await expect(leiste).toBeVisible();
        await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
        await settleFrame(page);
        await zieheEcke(page, ecken[1]!, 40);
        await expect(page.getByTestId("ecken-leiste-ungespeichert")).toHaveText("1 ungespeichert");
        // Rechtsklick ins Innere der Fläche: das Kartenmenü mit den Handgriffen der Fläche, der Modus läuft weiter.
        const innen = await schirm(page, {
            x: (ecken[0]!.x + ecken[1]!.x + ecken[2]!.x + ecken[3]!.x) / 4,
            y: (ecken[0]!.y + ecken[1]!.y + ecken[2]!.y + ecken[3]!.y) / 4,
        });
        await page.mouse.click(innen.x, innen.y, { button: "right" });
        const menue = page.getByTestId("context-editor");
        await expect(menue).toBeVisible();
        // Das erste Esc schließt nur das Menü (innen vor außen): keine Frage, der Zug bleibt ungespeichert im Modus.
        await page.keyboard.press("Escape");
        await expect(menue).toHaveCount(0);
        await expect(page.getByTestId("ecken-leiste-frage")).toHaveCount(0);
        await expect(page.getByTestId("ecken-leiste-ungespeichert")).toHaveText("1 ungespeichert");
        // Erst das zweite fragt (R2).
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("ecken-leiste-frage")).toBeVisible();
        await page.getByTestId("ecken-leiste-frage-ja").click();
        await expect(leiste).toHaveCount(0);
        expect(formAufrufe).toEqual([]);
    } finally {
        flaechen = [];
    }
});

test("🔴 Doppelklick (R3, T59): auf eine Fläche startet „Ecken bearbeiten“; im Modus setzt er in der Fläche und bis 22 px daneben einen Punkt, erst weiter draußen heißt er „Fertig“ und speichert", async ({
    page,
}) => {
    try {
        // Standardgröße 1280 px: Der erste Klick öffnet den Landschaftseditor (T34 (1)) nur mit den Eigenschaften (EDIT-0003, Variante A),
        // die Stelle bleibt frei, und der zweite Klick trifft die Fläche, nicht das Fenster.
        await oeffne(page, "vegetation");
        const ecken = await flaecheImBild(page);
        const { at, id } = await stelleMit(page, 1);
        liste = { rows: [{ id, name: "Probe", layer: "vegetation", circle: "halb-rechts", order: 1 }] };
        await page.mouse.dblclick(at.x, at.y);
        const leiste = page.getByTestId("ecken-leiste");
        await expect(leiste).toBeVisible();
        await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
        await settleFrame(page);
        // Die Fläche liegt ganz im freien Bild (formmodus A: die Kamera bleibt); Ecke und Doppelklick links, fern vom Fenster.
        await zieheEcke(page, ecken[0]!, 40);
        await expect(page.getByTestId("ecken-leiste-ungespeichert")).toHaveText("1 ungespeichert");
        const anfasser = () =>
            page.evaluate(
                () => globalThis.avesmapsMap!.queryRenderedFeatures({ layers: ["geometrie-anfasser"] }).length,
            );
        // T59 (OPS-000043, Legacy): 15 px rechts neben der rechten Kante, also im Saum von 22 px, setzt der Doppelklick einen Punkt.
        const rechts = await schirm(page, { x: (ecken[1]!.x + ecken[2]!.x) / 2, y: (ecken[1]!.y + ecken[2]!.y) / 2 });
        await page.mouse.dblclick(rechts.x + 15, rechts.y);
        await expect(page.getByTestId("ecken-leiste-ungespeichert")).toHaveText("2 ungespeichert");
        await expect.poll(anfasser).toBe(5);
        // Mitten in der Fläche, fern von Ecken und Kanten: auch dort ein Punkt an der Klickstelle, in die nächste Kante.
        const innen = await schirm(page, {
            x: (ecken[0]!.x + ecken[1]!.x + ecken[2]!.x + ecken[3]!.x) / 4,
            y: (ecken[0]!.y + ecken[1]!.y + ecken[2]!.y + ecken[3]!.y) / 4,
        });
        await page.mouse.dblclick(innen.x, innen.y);
        await expect(page.getByTestId("ecken-leiste-ungespeichert")).toHaveText("3 ungespeichert");
        await expect.poll(anfasser).toBe(6);
        await expect(leiste).toBeVisible();
        // Weiter draußen (60 px über der oberen Kante): Das gehört nicht mehr dem Modus, der Doppelklick heißt „Fertig“.
        const oben = await schirm(page, { x: (ecken[0]!.x + ecken[1]!.x) / 2, y: (ecken[0]!.y + ecken[1]!.y) / 2 });
        await page.mouse.dblclick(oben.x, oben.y - 60);
        await expect(leiste).toHaveCount(0);
        expect(formAufrufe).toHaveLength(1);
        expect(formAufrufe[0]!.body).toMatchObject({
            areas: [{ id: "a4a4a4a4-0000-4000-8000-0000000000a1", baseRevision: 4 }],
        });
        const ring = (formAufrufe[0]!.body as { areas: { polygons: number[][][][] }[] }).areas[0]!.polygons[0]![0]!;
        expect(ring).toHaveLength(6);
        // Der innere Punkt sitzt an der Klickstelle (auf einen Bildpunkt genau).
        const gesetzt = await Promise.all(ring.map(async ([x, y]) => schirm(page, { x: x!, y: y! })));
        expect(gesetzt.some((q) => Math.hypot(q.x - innen.x, q.y - innen.y) < 1.5)).toBe(true);
        expect(gesetzt.some((q) => Math.hypot(q.x - rechts.x - 15, q.y - rechts.y) < 1.5)).toBe(true);
    } finally {
        flaechen = [];
    }
});

test("🔴 T59: ein Doppelklick in die Fläche nahe einer gemeinsamen Kante setzt den Punkt auch beim Nachbarn, wie die Strg-Kante", async ({
    page,
}) => {
    try {
        await oeffne(page, "vegetation");
        const ecken = await flaecheImBild(page);
        // Ein Nachbar teilt die rechte Kante (Ecke 1 → Ecke 2) wie im Fall der Strg-Kante.
        nachbarFlaechen = [
            {
                id: "a4a4a4a4-0000-4000-8000-0000000000a2",
                regionId: "a4a4a4a4-0000-4000-8000-000000000002",
                name: "Nachbar",
                revision: 3,
                polygons: [
                    [
                        [
                            [ecken[1]!.x, ecken[1]!.y],
                            [ecken[2]!.x, ecken[2]!.y],
                            [ecken[2]!.x + 3, ecken[2]!.y],
                            [ecken[1]!.x + 3, ecken[1]!.y],
                        ],
                    ],
                ],
            },
        ];
        const { at, id } = await stelleMit(page, 1);
        liste = { rows: [{ id, name: "Probe", layer: "vegetation", circle: "halb-rechts", order: 1 }] };
        await page.mouse.click(at.x, at.y, { button: "right" });
        await page.getByTestId("context-editor-flaeche-gebietsform").click();
        await expect(page.getByTestId("ecken-leiste")).toBeVisible();
        await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
        await settleFrame(page);
        // 12 px links der gemeinsamen Kante, in der Fläche und neben der gezeichneten Kantenlinie: die nächste Kante ist die gemeinsame.
        const mitte = await schirm(page, { x: (ecken[1]!.x + ecken[2]!.x) / 2, y: (ecken[1]!.y + ecken[2]!.y) / 2 });
        await page.mouse.dblclick(mitte.x - 12, mitte.y);
        await expect(page.getByTestId("ecken-leiste-ungespeichert")).toHaveText("1 ungespeichert");
        await page.getByTestId("ecken-leiste-fertig").click();
        await expect(page.getByTestId("ecken-leiste")).toHaveCount(0);
        expect(formAufrufe).toHaveLength(1);
        const flaechenIm = (formAufrufe[0]!.body as { areas: { id: string; polygons: number[][][][] }[] }).areas;
        const ring = (areaId: string) => flaechenIm.find((a) => a.id === areaId)!.polygons[0]![0]!;
        const meiner = ring("a4a4a4a4-0000-4000-8000-0000000000a1");
        const seiner = ring("a4a4a4a4-0000-4000-8000-0000000000a2");
        expect(meiner).toHaveLength(5);
        expect(seiner).toHaveLength(5);
        // Derselbe Punkt in beiden: hinter Ecke 1 bei mir, zwischen seinen ersten beiden Ecken beim Nachbarn.
        expect(seiner[1]).toEqual(meiner[2]);
    } finally {
        flaechen = [];
        nachbarFlaechen = [];
    }
});

test("Doppelklick auf übereinanderliegende Flächen fragt zuerst „Welche Fläche bearbeiten?“", async ({ page }) => {
    // Standardgröße wie oben: Der Landschaftseditor steht nach dem ersten Klick nur mit den Eigenschaften.
    await oeffne(page, "alle");
    const { at } = await stelleMit(page, "2+");
    await page.mouse.dblclick(at.x, at.y);
    const auswahl = page.getByTestId("doppelklick-flaechen");
    await expect(auswahl).toBeVisible();
    expect(await auswahl.getByRole("menuitemradio").count()).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId("ecken-leiste")).toHaveCount(0);
});

test("🔴 Malen und Radieren sind zwei Einträge unter „Form ändern ›“, jeder mit eigenem Zeichen (T34 (4))", async ({
    page,
}) => {
    await oeffne(page, "vegetation");
    const { at, id } = await stelleMit(page, 1);
    liste = { rows: [{ id, name: "Probe", layer: "vegetation", circle: "halb-rechts", order: 1 }] };
    await page.mouse.click(at.x, at.y, { button: "right" });
    await page.getByTestId("context-editor-gruppe-form").hover();
    const form = page.getByTestId("context-editor-gruppe-form-unter");
    await expect(form.getByRole("menuitem")).toHaveText([
        /Verschieben/,
        /zerschneiden/,
        /Fläche malen/,
        /Fläche radieren/,
        /vereinfachen/,
    ]);
    await page.screenshot({ path: "test-results/t34-flaechenmenue.png" });
});

test("🔴 S3: hält ein anderer die Landschaft, zeigt die Karte Schraffur und Schild, das Menü den Kasten; „Gebietsform bearbeiten“ ist gesperrt; ein Admin hebt auf", async ({
    page,
}) => {
    // Erst die Stelle finden, dann mit der Sperre an ihrer Landschaft neu laden.
    await oeffne(page, "vegetation");
    const { id } = await stelleMit(page, 1);
    const ort = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        return globalThis.avesmapsRenderProjection!.fromRenderLngLat(map.getCenter());
    });
    fremdeSperren = [
        {
            kind: "landscape",
            id,
            part: "form",
            person: { id: "a4a4a4a4-0000-4000-8000-0000000000f2", name: "Thomas" },
            since: new Date(Date.now() - 5 * 60_000).toISOString(),
            heartbeatAt: new Date(Date.now() - 60_000).toISOString(),
            own: false,
            at: ort,
            layer: "vegetation",
        },
    ];
    mehrRechte = ["manage_people"];
    liste = { rows: [{ id, name: "Probe", layer: "vegetation", circle: "halb-rechts", order: 1 }] };
    try {
        await oeffne(page, "vegetation");
        const schild = page.getByTestId("sperre-schild");
        await expect(schild).toBeVisible();
        await expect(schild).toContainText("🔒 Thomas · Form · seit");
        const { at } = await stelleMit(page, 1);
        expect(
            await page.evaluate(
                ([x, y]) => {
                    const box = globalThis.avesmapsMap!.getCanvas().getBoundingClientRect();
                    return globalThis.avesmapsMap!.queryRenderedFeatures([x! - box.left, y! - box.top], {
                        layers: ["editor-sperre-schraffur"],
                    }).length;
                },
                [at.x, at.y],
            ),
        ).toBeGreaterThan(0);
        await page.screenshot({ path: "test-results/s3-sperre-karte.png" });

        await page.mouse.click(at.x, at.y, { button: "right" });
        const kasten = page.getByTestId("context-editor-sperre-objekt");
        await expect(kasten).toContainText("🔒 Thomas bearbeitet die Form seit");
        await expect(kasten).toContainText("ohne Aktivität frei ab");
        await expect(page.getByTestId("context-editor-flaeche-gebietsform")).toBeDisabled();
        await page.screenshot({ path: "test-results/s3-sperre-menue.png" });

        await page.getByTestId("context-editor-sperre-objekt-aufheben").click();
        await expect(page.getByTestId("context-editor-sperre-objekt-frage")).toContainText(
            "Thomas verliert die Sperre und sieht „Sperre abgelaufen“; der Entwurf bleibt.",
        );
        await page.getByTestId("context-editor-sperre-objekt-ja").click();
        // Der Name kommt aus der Kachel (die echte Landschaft), nicht aus der gestubbten Liste.
        await expect(page.getByText(/Die Sperre an „.+“ ist aufgehoben\./)).toBeVisible();
        expect(sperrAufrufe).toContain("/api/editor/locks/lift");
        await expect(page.getByTestId("sperre-schild")).toHaveCount(0);
    } finally {
        fremdeSperren = [];
        mehrRechte = [];
    }
});

test("S3: ohne das Recht zum Aufheben steht der Kasten ohne Knopf", async ({ page }) => {
    await oeffne(page, "vegetation");
    const { at, id } = await stelleMit(page, 1);
    fremdeSperren = [
        {
            kind: "landscape",
            id,
            part: "felder",
            person: { id: "a4a4a4a4-0000-4000-8000-0000000000f2", name: "Thomas" },
            since: new Date().toISOString(),
            heartbeatAt: new Date().toISOString(),
            own: false,
        },
    ];
    liste = { rows: [{ id, name: "Probe", layer: "vegetation", circle: "halb-rechts", order: 1 }] };
    try {
        await page.mouse.click(at.x, at.y, { button: "right" });
        const kasten = page.getByTestId("context-editor-sperre-objekt");
        await expect(kasten).toContainText("🔒 Thomas bearbeitet die Eigenschaften seit");
        await expect(page.getByTestId("context-editor-sperre-objekt-aufheben")).toHaveCount(0);
    } finally {
        fremdeSperren = [];
    }
});

/**
 * „formmodus A“ (Betreiber 2026-10-19): Beim Start eines Formmodus bleibt die Kamera stehen, solange ein Teil des Objekts frei zu sehen
 * ist; liegt nichts frei, fliegt sie hin und zoomt höchstens eine Stufe hinaus (`map/geometrie/kamera.ts`). Vorher passte sie eine große
 * Fläche ganz ein: das Vorgebirge des Kosch bei 1280 × 800 von 6,5 auf 4,3, bei 800 px bis Stufe 1.
 */
/**
 * Die Stub-Fläche als Viereck im freien Bild zwischen Planer und Fenster (Anteile der Leinwand wie die formmodus-Fälle), damit ihre Ecken
 * zu sehen sind, ohne dass die Kamera fliegt. Gibt die Ecken in Kartenkoordinaten zurück: links oben, rechts oben, rechts unten, links unten.
 */
async function flaecheImBild(page: Page): Promise<{ x: number; y: number }[]> {
    const ecken = [
        await karteBei(page, { x: 0.37, y: 0.44 }),
        await karteBei(page, { x: 0.45, y: 0.44 }),
        await karteBei(page, { x: 0.455, y: 0.57 }),
        await karteBei(page, { x: 0.372, y: 0.575 }),
    ];
    flaechen = [
        {
            id: "a4a4a4a4-0000-4000-8000-0000000000a1",
            polygons: [[ecken.map((e) => [e.x, e.y] as [number, number])]],
            affectsPaths: true,
            revision: 4,
        },
    ];
    return ecken;
}

async function karteBei(page: Page, anteil: { x: number; y: number }): Promise<{ x: number; y: number }> {
    return page.evaluate(
        ([fx, fy]) => {
            const map = globalThis.avesmapsMap!;
            const leinwand = map.getCanvas();
            return globalThis.avesmapsRenderProjection!.fromRenderLngLat(
                map.unproject([leinwand.clientWidth * fx!, leinwand.clientHeight * fy!]),
            );
        },
        [anteil.x, anteil.y],
    );
}

async function startEcken(page: Page): Promise<number> {
    const { at, id } = await stelleMit(page, 1);
    liste = { rows: [{ id, name: "Probe", layer: "vegetation", circle: "halb-rechts", order: 1 }] };
    const vorher = await page.evaluate(() => globalThis.avesmapsMap!.getZoom());
    await page.mouse.click(at.x, at.y, { button: "right" });
    await page.getByTestId("context-editor-flaeche-gebietsform").click();
    await expect(page.getByTestId("ecken-leiste")).toBeVisible();
    // Hinflug beim Start, Einzug der Liste (220 ms) und das zweite Einpassen danach.
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
    await page.waitForTimeout(700);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
    return vorher;
}

for (const [breite, hoehe] of [
    [1280, 800],
    [800, 600],
] as [number, number][]) {
    test(`🔴 formmodus A: eine große, teils sichtbare Fläche lässt den Zoom stehen (${String(breite)} × ${String(hoehe)})`, async ({
        page,
    }) => {
        await page.setViewportSize({ width: breite, height: hoehe });
        try {
            await oeffne(page, "vegetation");
            // Eine Ecke dort, wo nach dem Andocken des Fensters frei bleibt (zwischen Planer und Fenster), die anderen weit draußen: groß
            // wie ein Gebirge, und es passte nicht in den Ausschnitt.
            const frei = await karteBei(page, { x: 0.4, y: 0.5 });
            flaechen = [
                {
                    id: "a4a4a4a4-0000-4000-8000-0000000000a2",
                    polygons: [
                        [
                            [
                                [frei.x, frei.y],
                                [frei.x + 60, frei.y - 50],
                                [frei.x + 70, frei.y + 60],
                                [frei.x - 50, frei.y + 70],
                                [frei.x - 60, frei.y - 40],
                            ],
                        ],
                    ],
                    affectsPaths: true,
                    revision: 4,
                },
            ];
            const vorher = await startEcken(page);
            const nachher = await page.evaluate(() => globalThis.avesmapsMap!.getZoom());
            expect(nachher, "kein Hinauszoomen, solange ein Teil frei zu sehen ist").toBeCloseTo(vorher, 2);
        } finally {
            flaechen = [];
        }
    });

    test(`🔴 formmodus A: eine Fläche ganz außerhalb holt die Kamera, höchstens eine Stufe hinaus (${String(breite)} × ${String(hoehe)})`, async ({
        page,
    }) => {
        await page.setViewportSize({ width: breite, height: hoehe });
        try {
            await oeffne(page, "vegetation");
            const fern = await karteBei(page, { x: 0.5, y: 0.5 });
            const ecken: [number, number][] = [
                [fern.x + 150, fern.y - 40],
                [fern.x + 230, fern.y - 40],
                [fern.x + 230, fern.y + 40],
                [fern.x + 150, fern.y + 40],
            ];
            flaechen = [
                {
                    id: "a4a4a4a4-0000-4000-8000-0000000000a3",
                    polygons: [[ecken]],
                    affectsPaths: true,
                    revision: 4,
                },
            ];
            const vorher = await startEcken(page);
            const nachher = await page.evaluate(() => globalThis.avesmapsMap!.getZoom());
            expect(nachher, "höchstens eine Stufe hinaus").toBeGreaterThanOrEqual(vorher - 1 - 0.01);
            // Die Mitte der Fläche steht danach im Bild.
            const mitte = await schirm(page, { x: fern.x + 190, y: fern.y });
            const box = (await page.getByTestId("map").boundingBox())!;
            expect(mitte.x).toBeGreaterThan(box.x);
            expect(mitte.x).toBeLessThan(box.x + box.width);
            expect(mitte.y).toBeGreaterThan(box.y);
            expect(mitte.y).toBeLessThan(box.y + box.height);
        } finally {
            flaechen = [];
        }
    });
}

/**
 * Eine Stelle ohne Fläche in dieser Ebene, an der die Karte obenauf liegt (wie `stelleMit`). Am Kosch ist bei Zoom 6,5 jede Stelle
 * bedeckt: Die Suche geht auf Zoom 2,5 hinaus, dort liegt Meer frei.
 */
async function stelleOhne(page: Page): Promise<{ x: number; y: number }> {
    await page.evaluate(() => globalThis.avesmapsMap?.jumpTo({ zoom: 2.5 }));
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 30_000 });
    await settleFrame(page);
    const gefunden = await page.evaluate(() => {
        const map = globalThis.avesmapsMap;
        if (!map) throw new Error("map handle missing");
        const ids = (map.getStyle().layers ?? [])
            .map((layer) => layer.id)
            .filter((id) => id.startsWith("landscape-fill-"));
        const mitte = globalThis.avesmapsVisibleArea!.centre();
        const leinwand = map.getCanvas();
        const rahmen = leinwand.getBoundingClientRect();
        for (let r = 0; r < 900; r += 16) {
            for (let w = 0; w < 360; w += 15) {
                const x = Math.round(mitte.x + r * Math.cos((w * Math.PI) / 180));
                const y = Math.round(mitte.y + r * Math.sin((w * Math.PI) / 180));
                if (document.elementFromPoint(rahmen.left + x, rahmen.top + y) !== leinwand) continue;
                if (map.queryRenderedFeatures([x, y], { layers: ids }).length === 0) return { x, y };
            }
        }
        return undefined;
    });
    expect(gefunden, "eine Stelle ohne Fläche").toBeDefined();
    return gefunden!;
}

/**
 * Wächter (Editor-Orchestrierung 2026-10-20): „Hier hinzufügen ›“ zeigte auf der Stage in der Derographie alles wie in Standard (Neuer
 * Ort, Neuer Weg, Neues Herrschaftsgebiet, Neue Kraftlinie). Nicht nachstellbar (Release 1efa1b3); vermutlich ein Tab, der vor dem
 * Ausrollen offen war. Soll nach dem Register 2026-10-18: in der Derographie nur „Neue Fläche ›“ und „Neuer Fluss/Bach ›“, dazu
 * „▲ Landmarke setzen ›“ in den Ebenen, in denen die Karte Landmarken zeichnet (bis 2026-11-11 nur Topographie; seitdem auch Alle und
 * Regionen, Betreiber „Ja, überall“, OPS-000111) - auf freiem Grund wie auf einer Fläche.
 */
test("🔴 Wächter: in der Derographie bietet „Hier hinzufügen ›“ nur Fläche, Fluss/Bach und, wo Landmarken stehen, die Landmarke", async ({
    page,
}) => {
    const NIE = ["neuer-ort", "neuer-weg", "neues-gebiet", "neue-kraftlinie", "neuer-kraftlinienpunkt"];
    const pruefe = async (at: { x: number; y: number }, gipfel: boolean): Promise<void> => {
        await page.mouse.click(at.x, at.y, { button: "right" });
        await page.getByTestId("context-editor-hier-hinzufuegen").hover();
        const unter = page.getByTestId("context-editor-hier-hinzufuegen-unter");
        await expect(unter).toBeVisible();
        await expect(page.getByTestId("context-editor-neue-flaeche")).toBeVisible();
        await expect(page.getByTestId("context-editor-neuer-fluss")).toBeVisible();
        await expect(page.getByTestId("context-editor-landmarke-setzen")).toHaveCount(gipfel ? 1 : 0);
        for (const id of NIE) await expect(page.getByTestId(`context-editor-${id}`), id).toHaveCount(0);
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("context-editor")).toHaveCount(0);
    };

    await oeffne(page, "alle");
    await pruefe((await stelleMit(page, "2+")).at, true);
    await pruefe(await stelleOhne(page), true);

    // Die Vegetation zeichnet keine Landmarken: Eine dort gesetzte bliebe unsichtbar (OPS-000111).
    await oeffne(page, "vegetation");
    await pruefe((await stelleMit(page, 1)).at, false);

    await oeffne(page, "topographie");
    await pruefe((await stelleMit(page, 1)).at, true);
    await pruefe(await stelleOhne(page), true);
});

/**
 * Die gelbe Auswahl eines Editors gehört zu seinem Fenster (Fund der Hauptorchestrierung 2026-10-20, `editor-panel/editor-auswahl.ts`):
 * Nach dem Schließen des Fensters der Derographie oder dem Wechsel in einen anderen Editor bleibt keine Fläche gelb, die wie ein
 * angehaktes Gebiet aussähe.
 */
const gewaehlt = (page: Page) =>
    page.evaluate(() => (globalThis.avesmapsSelectedSubject?.() as { kind?: string } | undefined)?.kind);
const landschaftsFenster = (page: Page) => page.locator('dialog[data-lage][open][data-testid^="landschaftseditor-"]');

async function waehleFlaeche(page: Page): Promise<void> {
    await oeffne(page, "vegetation");
    const { at, id } = await stelleMit(page, 1);
    liste = { rows: [{ id, name: "Probe", layer: "vegetation", circle: "halb-rechts", order: 1 }] };
    await page.mouse.click(at.x, at.y);
    await expect.poll(() => gewaehlt(page)).toBe("area");
    await expect(landschaftsFenster(page)).toHaveCount(1);
}

test("🔴 schließt das Fenster der Derographie, endet die gelbe Auswahl ihrer Fläche", async ({ page }) => {
    await waehleFlaeche(page);
    await landschaftsFenster(page).getByTestId("fenster-schliessen").click();
    await expect(landschaftsFenster(page)).toHaveCount(0);
    await expect.poll(() => gewaehlt(page)).toBeUndefined();
});

test("🔴 der Wechsel zu den Herrschaftsgebieten beendet die gelbe Auswahl der Fläche", async ({ page }) => {
    await waehleFlaeche(page);
    // Die angedockte Fensterspalte deckt die Kacheln; gewechselt wird an der Kachel selbst, wie per Tastatur.
    await page.getByTestId("editorpanel-kachel-territorien").dispatchEvent("click");
    await expect.poll(() => gewaehlt(page)).toBeUndefined();
});
