import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import type {
    EditorLandscapeDetail,
    EditorLandscapeList,
    EditorLandscapeRow,
    LandscapeUpdateBody,
    MapHistoryPage,
    OperationReceipt,
} from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap, settleFrame, showLandscapes } from "./map-handle.ts";
import { editorPanelVorn } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Felder der Landschaft über den gemeinsamen Entwurf (WI-0178 B2; O3, EDIT-0003 T44). 🔴 Kein Test schreibt in die Datenbank der
 * Entwicklung: Liste, Detail, Sperre und `landscape.update` kommen aus einem Stub (den Schreibweg prüft `landscape-update.test.ts`).
 *
 * Problemfälle: Name und Beschriftung gehen in zwei Operationen; die Leiste mit „Fertig“ erscheint erst nach einem Speichern-Knopf im
 * Fuß; der Fuß bietet Speichern an (T27 (4): nur „n ungespeichert“); ein Konflikt verwirft den Entwurf; Esc mit Ungeschriebenem
 * verwirft still; eine neue Ebene lässt die Karte stehen oder schreibt ohne Art (Betreiber 2026-10-17); ein Fenster, das „Offene
 * Bearbeitungen“ nach dem Neuladen hervorholt, lädt seine Liste nicht (Befund der Kraftlinien-Sitzung 2026-10-17).
 */
const BECKEN = "a3a3a3a3-0000-4000-8000-000000000001";
const LABEL = "a3a3a3a3-0000-4000-8000-0000000000b1";
const LISTE: EditorLandscapeList = {
    rows: [
        {
            id: BECKEN,
            name: "Gratenfelser Becken",
            layer: "topographie",
            type: "tal",
            circle: "voll",
            areas: 1,
            labels: 1,
            order: 740,
            bounds: [438, 500, 468, 540],
        },
    ],
};
const DETAIL: EditorLandscapeDetail = {
    id: BECKEN,
    name: "Gratenfelser Becken",
    layer: "topographie",
    type: "tal",
    circle: "voll",
    order: 740,
    clickLocked: false,
    areas: [
        {
            id: "a3a3a3a3-0000-4000-8000-0000000000a1",
            polygons: [
                [
                    [
                        [440, 502],
                        [466, 502],
                        [466, 538],
                        [440, 538],
                    ],
                ],
            ],
            affectsPaths: true,
            revision: 1,
        },
    ],
    labels: [
        {
            id: LABEL,
            text: "Gratenfelser Becken",
            x: 450,
            y: 520,
            size: 18,
            priority: 3,
            zoomMin: 2,
            zoomMax: 8,
            visible: true,
            primary: true,
            revision: 1,
        },
    ],
    neighbors: [],
    revision: 1,
};

/** Ebene und Art gewechselt, danach die Form: ↺ an beiden, der Server nimmt sie zurück (WI-0265 B6c). */
const UMGEZOGEN = "e8e8e8e8-0000-4000-8000-000000000001";
const VERLAUF: MapHistoryPage = {
    entries: [
        {
            operationId: "e8e8e8e8-0000-4000-8000-000000000002",
            seq: 41,
            at: "2026-10-18T12:05:00.000Z",
            operation: "landscape.update",
            source: "editor",
            summary: "Gratenfelser Becken: Form geändert",
            actor: { kind: "person", name: "Thomas" },
            objects: [
                {
                    kind: "area",
                    id: "a3a3a3a3-0000-4000-8000-0000000000a1",
                    name: "Gratenfelser Becken",
                    action: "area.reshaped",
                    revisionBefore: 0,
                    revisionAfter: 1,
                    changes: {
                        geometry: {
                            before: [
                                [
                                    [
                                        [0, 0],
                                        [1, 0],
                                        [1, 1],
                                    ],
                                ],
                            ],
                            after: DETAIL.areas[0]!.polygons,
                        },
                    },
                },
            ],
        },
        {
            operationId: UMGEZOGEN,
            seq: 40,
            at: "2026-10-18T12:00:00.000Z",
            operation: "landscape.update",
            source: "editor",
            summary: "Gratenfelser Becken: Ebene, Art geändert",
            actor: { kind: "person", name: "Thomas" },
            objects: [
                {
                    kind: "landscape",
                    id: BECKEN,
                    name: "Gratenfelser Becken",
                    action: "region.updated",
                    revisionBefore: 0,
                    revisionAfter: 1,
                    changes: {
                        layer: { before: "vegetation", after: "topographie" },
                        type: { before: "wald", after: "tal" },
                        order: { before: 12, after: 740 },
                    },
                },
            ],
        },
    ],
};

interface Server {
    gesendet: LandscapeUpdateBody[];
    /** Wie oft das Fenster die Fläche gelesen hat: ↺ liest danach neu. */
    gelesen: number;
    /** Die nächste Antwort auf `landscape.update`; ohne Angabe gespeichert. */
    antwort?: { status: number; body: unknown } | undefined;
    detail: EditorLandscapeDetail;
}

/** `liste`: über die Kachel und die Liste; `ablage`: nur bis zum Editorpanel (ein gesicherter Entwurf liegt unter „Offene Bearbeitungen“). */
async function oeffne(
    page: Page,
    wie: "liste" | "ablage" = "liste",
    mehr: readonly EditorLandscapeRow[] = [],
): Promise<Server> {
    const server: Server = { gesendet: [], gelesen: 0, detail: DETAIL };
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
    // Die Liste folgt dem Stand des Servers: Nach „Fertig“ lädt das Fenster sie neu.
    await page.route("**/api/editor/landscapes", (route) =>
        json(route, 200, {
            rows: [
                {
                    ...LISTE.rows[0]!,
                    name: server.detail.name,
                    layer: server.detail.layer,
                    ...(server.detail.type === undefined ? {} : { type: server.detail.type }),
                },
                ...mehr,
            ],
        }),
    );
    await page.route(`**/api/editor/landscapes/${BECKEN}`, (route) => {
        if (route.request().method() !== "PATCH") {
            server.gelesen += 1;
            return json(route, 200, server.detail);
        }
        const body = route.request().postDataJSON() as LandscapeUpdateBody;
        server.gesendet.push(body);
        const antwort = server.antwort;
        server.antwort = undefined;
        if (antwort !== undefined) return json(route, antwort.status, antwort.body);
        // Ebene und Art gehen wie auf dem Server in den Stand (Fund „Tal am Donnerkessel“).
        server.detail = {
            ...server.detail,
            name: "Gratenfelser Kessel",
            layer: body.changes?.layer ?? server.detail.layer,
            ...(body.changes?.type === undefined ? {} : { type: body.changes.type }),
            revision: server.detail.revision + 1,
        };
        const quittung: OperationReceipt = {
            operationId: "op",
            status: "applied",
            environment: "test",
            affected: [{ kind: "landscape", id: BECKEN, revision: server.detail.revision }],
            derivedWork: [],
            warnings: [],
            mapRevision: 901,
        };
        return json(route, 200, quittung);
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
    await page.route(`**/api/editor/landscapes/${BECKEN}/history**`, (route) => json(route, 200, VERLAUF));
    await openMap(page, EDITOR_MODE);
    await editorPanelVorn(page);
    if (wie === "ablage") return server;
    await page.getByTestId("editorpanel-kachel-regionen").click();
    await page.getByTestId("editorpanel-verb").click();
    await page
        .locator('[data-testid^="landschaftseditor-"][data-testid$="-liste"]')
        .getByRole("option", { name: /Gratenfelser Becken/ })
        .click();
    return server;
}

// Wie „Kraftlinie bearbeiten“: Bei 1280 px deckt das angedockte Fenster mit offener Liste die Leiste (Befund an die Orchestrierung, WI-0218).
test.use({ viewport: { width: 1920, height: 1080 } });

const leiste = (page: Page) => page.getByTestId("landschaft-leiste");
/** Was die Schicht der Entwürfe zeichnet (`map/entwurfs-flaechen.ts`): Kennungen in der Quelle und die Ebenen, die ihr Filter durchlässt. */
const entwurfAufKarte = (page: Page) =>
    page.evaluate(() => {
        // Der Entwicklungsgriff kennt Quelle und Filter nicht als Typ; die Karte dahinter ist MapLibre.
        const map = globalThis.avesmapsMap! as unknown as {
            getSource(id: string): unknown;
            getLayer(id: string): unknown;
            getFilter(id: string): unknown;
        };
        const quelle = map.getSource("editor-entwurf-flaechen") as
            { serialize(): { data: { features: { properties: { id: string } }[] } } } | undefined;
        const filter = map.getLayer("editor-entwurf-flaeche") ? map.getFilter("editor-entwurf-flaeche") : undefined;
        const ebenen = Array.isArray(filter) ? ((filter[2] as unknown[])[1] as string[]) : [];
        return { ids: [...new Set((quelle?.serialize().data.features ?? []).map((f) => f.properties.id))], ebenen };
    });
const nameFeld = (page: Page) => page.getByTestId(/^landschaftseditor-fenster-\d+-feld-name$/).locator("input");

test("🔴 Name und Beschriftung im EINEN Entwurf: die Leiste kommt mit der ersten Änderung, „Fertig“ schickt EINE Operation", async ({
    page,
}) => {
    const server = await oeffne(page);
    const name = nameFeld(page);
    await name.fill("Gratenfelser Kessel");
    await expect(leiste(page)).toContainText("Eigenschaften bearbeiten");
    await name.press("Tab");
    await page.getByRole("tab", { name: /Beschriftungen/ }).click();
    await page
        .getByTestId(/^landschaftseditor-fenster-\d+-beschriftung-0-prioritaet$/)
        .locator("select")
        .selectOption("5");
    await expect(page.getByTestId("landschaft-leiste-ungespeichert")).toContainText("2");
    // Der Fuß zeigt nur „n ungespeichert“, kein Speichern (T27 (4)).
    await expect(page.getByTestId(/^landschaftseditor-fenster-\d+-ungespeichert$/)).toContainText("2");
    await expect(page.locator(".avm-fenster__fuss").getByRole("button", { name: "Speichern" })).toHaveCount(0);
    await page.getByTestId("landschaft-leiste-fertig").click();
    await expect.poll(() => server.gesendet.length).toBe(1);
    expect(server.gesendet[0]).toMatchObject({
        baseRevision: 1,
        changes: { name: "Gratenfelser Kessel" },
        labels: [{ id: LABEL, baseRevision: 1, changes: { priority: 5 } }],
    });
    expect(server.gesendet[0]).not.toHaveProperty("areas");
    await expect(leiste(page)).toHaveCount(0);
    await expect(page.getByTestId(/^landschaftseditor-fenster-\d+-zustand$/)).toContainText("Revision 2");
    // Die Liste zeigt den neuen Namen, nicht erst nach dem Neuladen der Seite.
    await expect(
        page
            .locator('[data-testid^="landschaftseditor-"][data-testid$="-liste"]')
            .getByRole("option", { name: /Gratenfelser Kessel/ }),
    ).toBeVisible();
    await page.screenshot({ path: "test-results/landschaftseditor-b2.png" });
});

test("🔴 ein Konflikt lässt den Entwurf stehen: anwenden · übernehmen · überschreiben; Esc fragt erst", async ({
    page,
}) => {
    const server = await oeffne(page);
    await nameFeld(page).fill("Gratenfelser Kessel");
    server.antwort = {
        status: 409,
        body: { error: { code: "edit_conflict", message: "Jemand war schneller.", details: {} } },
    };
    server.detail = { ...DETAIL, revision: 2, labels: [{ ...DETAIL.labels[0]!, revision: 2, size: 20 }] };
    await page.getByTestId("landschaft-leiste-fertig").click();
    const kasten = page.getByTestId(/^landschaftseditor-fenster-\d+-konflikt$/);
    await expect(kasten).toBeVisible();
    await expect(kasten.getByRole("button")).toHaveCount(3);
    await expect(nameFeld(page)).toHaveValue("Gratenfelser Kessel");
    // Nur die Beschriftung des anderen hat sich geändert: Die eigene Änderung geht auf seinen Stand.
    await kasten.getByTestId(/-konflikt-anwenden$/).click();
    await expect.poll(() => server.gesendet.length).toBe(2);
    expect(server.gesendet[1]).toMatchObject({ baseRevision: 2, changes: { name: "Gratenfelser Kessel" } });
    expect(server.gesendet[1]).not.toHaveProperty("labels");

    // Esc mit Ungeschriebenem fragt „Speichern · Verwerfen · Weiter bearbeiten“ (R2). Erst, wenn das Schreiben durch ist: Solange
    // gespeichert wird, ruhen die Felder.
    await expect(page.getByTestId(/^landschaftseditor-fenster-\d+-zustand$/)).toContainText("Gespeichert");
    await nameFeld(page).fill("Kessel");
    // Verlassen, nicht Tab: Tab führt in das nächste Feld (Ebene), und Esc in einem Feld gehört dem Feld (`install-keyboard.ts`).
    await nameFeld(page).blur();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("landschaft-leiste-frage")).toBeVisible();
    await expect(page.getByTestId("landschaft-leiste-frage-speichern")).toBeVisible();
    await page.getByTestId("landschaft-leiste-frage-ja").click();
    await expect(leiste(page)).toHaveCount(0);
    expect(server.gesendet).toHaveLength(2);
});

test("🔴 Ebene gewechselt: die Karte zeigt die neue Ebene, die Art ist leer und „Fertig“ gesperrt, bis eine gewählt ist", async ({
    page,
}) => {
    const server = await oeffne(page);
    const ebene = page.getByTestId(/^landschaftseditor-fenster-\d+-feld-ebene$/).locator("select");
    const art = page.getByTestId(/^landschaftseditor-fenster-\d+-feld-art$/).locator("select");
    await ebene.selectOption("vegetation");
    // Betreiber 2026-10-17: „und er dann ins Vegetationslayer geht“, ohne Flug.
    await expect(page).toHaveURL(/[#&]layer=vegetation/);
    await expect(page).toHaveURL(/[#&]view=landscapes/);
    await expect(art).toHaveValue("");
    await expect(page.getByTestId("landschaft-leiste-fertig")).toBeDisabled();
    await expect(leiste(page)).toContainText("Vegetation");
    // Topographie und Vegetation speisen das Gelände: Der Hinweis nennt den Knopf, der es neu rechnet (T18).
    await expect(page.getByTestId(/^landschaftseditor-fenster-\d+-hinweis$/)).toContainText("„Gelände neu rechnen“");
    await expect(page.getByTestId(/^landschaftseditor-fenster-\d+-hoehenmodell$/)).toHaveText("Höhenmodell");
    // Die Liste der neuen Ebene hält die Landschaft sichtbar, bis „Fertig“ sie dorthin schreibt.
    await expect(
        page
            .locator('[data-testid^="landschaftseditor-"][data-testid$="-liste"]')
            .getByRole("option", { name: /Gratenfelser Becken.*Ebene geändert/ }),
    ).toBeVisible();
    await page.locator('dialog[data-lage="angedockt"]').screenshot({ path: "test-results/landschaftseditor-t50.png" });
    await art.selectOption("wald");
    await page.getByTestId("landschaft-leiste-fertig").click();
    await expect.poll(() => server.gesendet.length).toBe(1);
    expect(server.gesendet[0]).toMatchObject({ baseRevision: 1, changes: { layer: "vegetation", type: "wald" } });
    expect(server.gesendet[0]!.changes).not.toHaveProperty("name");
});

test("🔴 Fund 2026-10-18 („Tal am Donnerkessel“): nach Ebenenwechsel und „Fertig“ steht die Karte in der neuen Ebene, die Liste zeigt die Fläche dort und in „Alle“", async ({
    page,
}) => {
    // Betreiber auf der Stage, wörtlich: „ich habe ein tal "Tal am Donnerkessel" -> topographie. ich änder auf vegetation und flusstal
    // -> plötzlich ist es weg und nicht wieder auffindbar“.
    const server = await oeffne(page);
    const liste = page.locator('[data-testid^="landschaftseditor-"][data-testid$="-liste"]');
    await page
        .getByTestId(/^landschaftseditor-fenster-\d+-feld-ebene$/)
        .locator("select")
        .selectOption("vegetation");
    await page
        .getByTestId(/^landschaftseditor-fenster-\d+-feld-art$/)
        .locator("select")
        .selectOption("flussland_flusstal");
    await page.getByTestId("landschaft-leiste-fertig").click();
    await expect.poll(() => server.gesendet.length).toBe(1);
    expect(server.gesendet[0]).toMatchObject({ changes: { layer: "vegetation", type: "flussland_flusstal" } });
    // Nach „Fertig“ lädt das Fenster Detail und Liste neu; die Karte bleibt in der neuen Ebene.
    /*
     * 🪤 Kein `settleFrame` hier: „Fertig“ hebt die Kachelrevision, und die Karte lädt jede Vektorquelle neu, bei Zoom 2 vom Testserver
     * gerechnet. Neben einem zweiten Worker dauerte das bis `idle` 8 bis 19 s (Trace 2026-10-19), und die Zusicherungen hier lesen nur
     * Adresse und Liste. Die zwei Ebenenwechsel unten warten je auf gezeichnete Flächen; dafür die Luft.
     */
    test.setTimeout(120_000);
    await expect.poll(() => server.gelesen).toBeGreaterThan(1);
    await expect(page).toHaveURL(/[#&]layer=vegetation/);
    await expect(liste.getByRole("option", { name: /Gratenfelser Kessel/ })).toBeVisible();
    await expect(liste.getByRole("option", { name: /Ebene geändert/ })).toHaveCount(0);
    await page.screenshot({ path: "test-results/fund-donnerkessel-nach-fertig.png" });
    // In „Alle“ steht sie auch, und in der alten Ebene nicht mehr.
    await showLandscapes(page, "alle");
    await expect(liste.getByRole("option", { name: /Gratenfelser Kessel/ })).toBeVisible();
    await showLandscapes(page, "topographie");
    await expect(liste.getByRole("option", { name: /Gratenfelser Kessel/ })).toHaveCount(0);
});

/** Die Quellen der Derographie und die, die eine Landschaftsänderung nicht berührt (Kachelsichten am Schema geprüft, 2026-10-19). */
const DEROGRAPHIE_QUELLEN = ["landscapes", "landscape-runs", "map-labels", "gewaesser", "gipfel"];
const FREMDE_QUELLEN = ["places", "paths", "path-labels", "powerlines", "ley-nodes"];
const FREMDE_KACHELN = /^(place_tile|path_tile|path_label_run_tile|powerline_render|ley_node_tile)$/;

test("🔴 nach „Fertig“ lädt die Karte nur die Quellen der Derographie neu; Orte, Wege und Kraftlinien behalten ihre Kacheln", async ({
    page,
}) => {
    // Editor-Orchestrierung 2026-10-19: Nach jedem „Fertig“ lud die Karte alle Vektorquellen neu, bei Zoom 2 64 Kacheln. Unter Last
    // kommen die neuen Kachelanfragen erst nach Sekunden (Prüfbank 2026-10-19): daher die langen Wartezeiten unten.
    test.setTimeout(90_000);
    const server = await oeffne(page);
    const neuGeladen: string[] = [];
    page.on("request", (anfrage) => {
        const url = anfrage.url();
        if (url.includes("/tiles/vector/") && url.includes("r=901"))
            neuGeladen.push(url.split("/tiles/vector/")[1]!.split("/")[0]!);
    });
    await nameFeld(page).fill("Gratenfelser Kessel");
    await page.getByTestId("landschaft-leiste-fertig").click();
    await expect.poll(() => server.gesendet.length).toBe(1);
    const adressen = () =>
        page.evaluate(
            (ids) => {
                const map = globalThis.avesmapsMap! as unknown as {
                    getSource(id: string): { tiles?: string[] } | undefined;
                };
                return Object.fromEntries(ids.map((id) => [id, map.getSource(id)?.tiles?.[0] ?? null]));
            },
            [...DEROGRAPHIE_QUELLEN, ...FREMDE_QUELLEN],
        );
    await expect.poll(async () => (await adressen())["landscapes"]).toContain("r=901");
    const stand = await adressen();
    for (const id of DEROGRAPHIE_QUELLEN) if (stand[id] !== null) expect(stand[id], id).toContain("r=901");
    for (const id of FREMDE_QUELLEN) expect(stand[id] ?? "", id).not.toContain("r=901");
    // Das Bild: Die Flächen kommen aus den neuen Kacheln wieder; keine Anfrage ging an Orte, Wege oder Kraftlinien.
    await expect.poll(() => neuGeladen.includes("region_area_tile"), { timeout: 30_000 }).toBe(true);
    await expect
        .poll(
            () =>
                page.evaluate(() => {
                    const map = globalThis.avesmapsMap!;
                    const flaechen = (map.getStyle().layers ?? [])
                        .map((l) => l.id)
                        .filter((id) => id.startsWith("landscape-fill-"));
                    return map.queryRenderedFeatures({ layers: flaechen }).length;
                }),
            { timeout: 30_000 },
        )
        .toBeGreaterThan(0);
    expect(neuGeladen.filter((quelle) => FREMDE_KACHELN.test(quelle))).toEqual([]);
});

test("🔴 Fund 2026-10-18 („Tal am Donnerkessel“): im Entwurf steht die Fläche gestrichelt in der neuen Ebene; ✕ ohne „Fertig“ stellt die Karte zurück, hervorgeholt folgt sie wieder dem Entwurf", async ({
    page,
}) => {
    // Der Ebenenwechsel stellt die Karte schon im Entwurf um (T50); bis „Fertig“ steht die Fläche aber in der alten Ebene. ✕ verwirft
    // nie (F1), es legt das Fenster samt Entwurf ab: Ohne Rückkehr blieb die Karte in der Vegetation, und das Tal schien verschwunden.
    const server = await oeffne(page);
    await page
        .getByTestId(/^landschaftseditor-fenster-\d+-feld-ebene$/)
        .locator("select")
        .selectOption("vegetation");
    await expect(page).toHaveURL(/[#&]layer=vegetation/);
    // Betreiber 2026-10-18 „A“: Die Karte zeichnet die Fläche schon in der neuen Ebene, gestrichelt, in der Farbe der neuen Art.
    await page
        .getByTestId(/^landschaftseditor-fenster-\d+-feld-art$/)
        .locator("select")
        .selectOption("flussland_flusstal");
    await expect.poll(() => entwurfAufKarte(page)).toEqual({ ids: [BECKEN], ebenen: ["vegetation"] });
    await page.screenshot({ path: "test-results/fund-donnerkessel-entwurf.png" });
    await page
        .locator('dialog[data-lage="angedockt"]')
        .filter({ has: page.locator('[data-testid^="landschaftseditor-"]') })
        .getByTestId("fenster-schliessen")
        .click();
    await expect(page).toHaveURL(/[#&]layer=topographie/);
    expect(server.gesendet).toHaveLength(0);
    // Abgelegt bleibt der Entwurf ein Entwurf (A): In der Topographie zeichnet ihn die Karte nicht, der Hinweis sagt, wo er liegt.
    await expect.poll(() => entwurfAufKarte(page)).toEqual({ ids: [BECKEN], ebenen: [] });
    await expect(page.getByTestId("toast")).toContainText("Entwurf liegt unter „Offene Bearbeitungen“.");
    // Unter „Offene Bearbeitungen“ liegt der Entwurf; hervorgeholt steht die Karte wieder in seiner Ebene.
    await editorPanelVorn(page);
    await page
        .getByTestId("editor-panel-bearbeitungen")
        .getByRole("button", { name: /Gratenfelser/ })
        .first()
        .click();
    await expect(page).toHaveURL(/[#&]layer=vegetation/);
    await expect(page.getByTestId(/^landschaftseditor-fenster-\d+-feld-ebene$/).locator("select")).toHaveValue(
        "vegetation",
    );
    await expect.poll(() => entwurfAufKarte(page)).toEqual({ ids: [BECKEN], ebenen: ["vegetation"] });
});

test("🔴 Fund 2026-10-18, Weg nach Claudio (ca058e4db): öffnet nach dem Ebenenwechsel eine andere Fläche an der Stelle, bleibt der Entwurf gestrichelt in der Vegetation, und der Hinweis sagt, wo er liegt", async ({
    page,
}) => {
    // Auf der Stage: das Tal im Entwurf nach Vegetation, dann „Bragensrode“ (Vegetation) geöffnet; das Tal lag abgelegt, die Karte blieb
    // in der Vegetation, und das Tal war nirgends zu sehen.
    const AUE = "a3a3a3a3-0000-4000-8000-0000000000e1";
    await page.route(`**/api/editor/landscapes/${AUE}`, (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                ...DETAIL,
                id: AUE,
                name: "Bragenauer Aue",
                layer: "vegetation",
                type: "kulturlandschaft",
            }),
        }),
    );
    await oeffne(page, "liste", [
        {
            id: AUE,
            name: "Bragenauer Aue",
            layer: "vegetation",
            type: "kulturlandschaft",
            circle: "halb-rechts",
            order: 1,
        },
    ]);
    await page
        .getByTestId(/^landschaftseditor-fenster-\d+-feld-ebene$/)
        .locator("select")
        .selectOption("vegetation");
    await page
        .getByTestId(/^landschaftseditor-fenster-\d+-feld-art$/)
        .locator("select")
        .selectOption("flussland_flusstal");
    await expect(page).toHaveURL(/[#&]layer=vegetation/);
    await page
        .locator('[data-testid^="landschaftseditor-"][data-testid$="-liste"]')
        .getByRole("option", { name: /Bragenauer Aue/ })
        .click();
    // Das Tal liegt abgelegt (sein Fenster bleibt im Dokument, nur versenkt); angedockt steht jetzt die Aue (D19).
    await expect(
        page
            .locator('dialog[data-lage="angedockt"]')
            .getByTestId(/^landschaftseditor-fenster-\d+-feld-name$/)
            .locator("input"),
    ).toHaveValue("Bragenauer Aue");
    await expect(page.getByTestId("toast")).toContainText("Entwurf liegt unter „Offene Bearbeitungen“.");
    await expect(page).toHaveURL(/[#&]layer=vegetation/);
    await expect.poll(() => entwurfAufKarte(page)).toEqual({ ids: [BECKEN], ebenen: ["vegetation"] });
    await page.screenshot({ path: "test-results/fund-donnerkessel-claudio-weg.png" });
});

test("🔴 nach dem Neuladen: „Offene Bearbeitungen“ holt das Fenster samt Entwurf hervor, und es lädt seine Liste", async ({
    page,
}) => {
    const beschriftung = { size: 18, priority: 3, zoomMin: 2, zoomMax: 8, visible: true, followName: true };
    const felder = (name: string) => ({
        name,
        ebene: "topographie",
        art: "tal",
        gesperrt: false,
        labels: { [LABEL]: beschriftung },
    });
    const gesichert = {
        art: "landscape",
        id: BECKEN,
        titel: "Gratenfelser Becken",
        zeit: "2026-10-17T12:00:00.000Z",
        version: 3,
        basis: DETAIL,
        start: { felder: felder("Gratenfelser Becken") },
        jetzt: { felder: felder("Gratenfelser Kessel") },
    };
    await page.addInitScript(([schluessel, wert]) => localStorage.setItem(schluessel, wert), [
        `avesmaps3d.entwurf.landscape.${BECKEN}`,
        JSON.stringify(gesichert),
    ] as const);
    await oeffne(page, "ablage");
    await page
        .getByTestId("editor-panel-bearbeitungen")
        .getByRole("button", { name: /Gratenfelser/ })
        .first()
        .click();
    await expect(
        page
            .locator('[data-testid^="landschaftseditor-"][data-testid$="-liste"]')
            .getByRole("option", { name: /Gratenfelser Becken/ }),
    ).toBeVisible();
    await expect(nameFeld(page)).toHaveValue("Gratenfelser Kessel");
});

test("🔴 Klicksperre und „entlang der Fläche“ sind Felder im EINEN Entwurf; „Läufe“ erst mit der Kurve", async ({
    page,
}) => {
    const server = await oeffne(page);
    await page.getByRole("tab", { name: /^Form/ }).click();
    await page.getByTestId(/^landschaftseditor-fenster-\d+-feld-klick$/).check();
    await page.getByRole("tab", { name: /Beschriftungen/ }).click();
    const laeufe = page.getByTestId(/^landschaftseditor-fenster-\d+-feld-laeufe$/).locator("select");
    await expect(laeufe).toBeDisabled();
    await page.getByTestId(/^landschaftseditor-fenster-\d+-feld-kurve$/).check();
    await laeufe.selectOption("2");
    await page.getByTestId("landschaft-leiste-fertig").click();
    await expect.poll(() => server.gesendet.length).toBe(1);
    expect(server.gesendet[0]).toMatchObject({
        baseRevision: 1,
        changes: { locked: true, curve: { enabled: true, max: 2 } },
    });
});

test("🔴 Zoomspanne je Beschriftung: der Anfasser schreibt das Paar, ↺ „Vorgabe der Art“ nimmt es weg", async ({
    page,
}) => {
    const server = await oeffne(page);
    await page.getByRole("tab", { name: /Beschriftungen/ }).click();
    const bis = page.getByTestId(/^landschaftseditor-fenster-\d+-beschriftung-0-zoom-griff-bis$/);
    await expect(bis).toHaveAttribute("aria-valuenow", "8");
    await bis.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(bis).toHaveAttribute("aria-valuenow", "7");
    await page
        .locator('dialog[data-lage="angedockt"]')
        .screenshot({ path: "test-results/landschaftseditor-zoomspanne.png" });
    await page.getByTestId("landschaft-leiste-fertig").click();
    await expect.poll(() => server.gesendet.length).toBe(1);
    expect(server.gesendet[0]!.labels).toEqual([{ id: LABEL, baseRevision: 1, changes: { zoomMin: 2, zoomMax: 7 } }]);
    await expect(page.getByTestId(/^landschaftseditor-fenster-\d+-zustand$/)).toContainText("Gespeichert");
    await page.getByTestId(/^landschaftseditor-fenster-\d+-beschriftung-0-zoom-vorgabe$/).click();
    await page.getByTestId("landschaft-leiste-fertig").click();
    await expect.poll(() => server.gesendet.length).toBe(2);
    expect(server.gesendet[1]!.labels).toEqual([{ id: LABEL, baseRevision: 1, changes: { zoomReset: true } }]);
});

test("🔴 D1: Platz n von m in der Ebene; „In den Hintergrund“ ist ein Wunsch im EINEN Entwurf, ganz vorn ist „In den Vordergrund“ gesperrt", async ({
    page,
}) => {
    const server = await oeffne(page);
    server.detail = { ...DETAIL, place: { n: 1, of: 5 } };
    await page.reload();
    await editorPanelVorn(page);
    await page.getByTestId("editorpanel-kachel-regionen").click();
    await page.getByTestId("editorpanel-verb").click();
    await page
        .locator('[data-testid^="landschaftseditor-"][data-testid$="-liste"]')
        .getByRole("option", { name: /Gratenfelser Becken/ })
        .click();
    await page.getByRole("tab", { name: /^Form/ }).click();
    await expect(page.getByTestId(/^landschaftseditor-fenster-\d+-platz$/)).toHaveText("1 von 5 in Topographie");
    const vorn = page.getByTestId(/^landschaftseditor-fenster-\d+-platz-vorn$/);
    const hinten = page.getByTestId(/^landschaftseditor-fenster-\d+-platz-hinten$/);
    await expect(vorn).toBeDisabled();
    await expect(page.getByText("Liegt schon ganz vorn.")).toBeVisible();
    await hinten.click();
    await expect(hinten).toHaveAttribute("aria-pressed", "true");
    await expect(hinten).toContainText("kommt mit „Fertig“");
    await expect(leiste(page)).toBeVisible();
    // Ein zweiter Druck nimmt den Wunsch zurück; ein dritter setzt ihn wieder.
    await hinten.click();
    await expect(hinten).toHaveAttribute("aria-pressed", "false");
    await hinten.click();
    await page.getByTestId("landschaft-leiste-fertig").click();
    await expect.poll(() => server.gesendet.length).toBe(1);
    expect(server.gesendet[0]).toEqual({
        operationId: expect.any(String),
        baseRevision: 1,
        changes: { order: "back" },
    });
});

test("🔴 Verlauf: Ebene und Art mit Namen, ↺ nimmt der Server zurück (Vorprüfung, Rückfrage, EINE Rücknahme) und die Fläche liest neu; die Form hat es auch; gesperrt beim Bearbeiten", async ({
    page,
}) => {
    const server = await oeffne(page);
    // WI-0265 B6c: Beide Antworten des Servers sind hier gestellt, der echte Ablauf steht in `ruecknahme-flaeche.test.ts`.
    const vorschau: unknown[] = [];
    const zurueck: unknown[] = [];
    await page.route(`**/api/editor/landscapes/${BECKEN}/restore-series/preview`, (route) => {
        vorschau.push(route.request().postDataJSON());
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                ergebnis: "ok",
                membersHash: "f".repeat(64),
                mitglieder: [
                    {
                        operationId: UMGEZOGEN,
                        seq: 42,
                        at: "2026-10-18T13:00:00.000Z",
                        operation: "landscape.update",
                        source: "editor",
                        actor: { kind: "person", name: "Thomas" },
                        status: "ruecknehmbar",
                        offen: true,
                        gegenstaende: [
                            {
                                kind: "landscape",
                                id: BECKEN,
                                name: "Gratenfelser Becken",
                                action: "region.updated",
                                revisionBefore: 1,
                                revisionAfter: 2,
                                felder: ["layer", "type", "order"],
                            },
                        ],
                    },
                ],
                offen: [UMGEZOGEN],
                gegenstaende: [],
                konflikte: [],
                sperren: [],
                fehlendeRechte: [],
                fremdePersonen: [],
                reasonRequired: false,
                folgen: { gegenstaende: 0, gelaende: "keines" },
            }),
        });
    });
    await page.route(`**/api/editor/landscapes/${BECKEN}/restore-series`, (route) => {
        zurueck.push(route.request().postDataJSON());
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                operationId: "a3a3a3a3-0000-4000-8000-0000000000e9",
                status: "applied",
                environment: "test",
                affected: [{ kind: "landscape", id: BECKEN, revision: 3 }],
                derivedWork: [],
                warnings: [],
                mapRevision: 903,
                reverts: [UMGEZOGEN],
            }),
        });
    });
    await page.getByTestId(/^landschaftseditor-fenster-\d+-reiter-verlauf$/).click();
    const eintrag = page.getByTestId(/^landschaftseditor-fenster-\d+-verlauf-eintrag$/);
    await expect(eintrag).toHaveCount(2);
    const umzug = eintrag.nth(1);
    await umzug.locator("summary").click();
    // Der Platz in der Ebene folgt der Ebene: Er steht im Verlauf, ↺ schickt ihn nicht.
    await expect(umzug.locator("dt")).toHaveText(["Ebene", "Flächenart", "Platz"]);
    await expect(umzug.locator("dd").first()).not.toContainText("vegetation");
    // ↺ steht im aufgeklappten Eintrag: Ebene und Art haben es, die Form (seit B6c) ebenso.
    const ruecknahme = (e: Locator) => e.locator('[data-testid$="-ruecknahme"]');
    const aufklappen = async (e: Locator): Promise<void> => {
        if (!(await e.evaluate((el) => (el as HTMLDetailsElement).open))) await e.locator("summary").click();
    };
    await expect(ruecknahme(umzug)).toHaveCount(1);
    await eintrag.nth(0).locator("summary").click();
    await expect(eintrag.nth(0).locator("dd")).toContainText("4 Ecken");
    await expect(ruecknahme(eintrag.nth(0))).toHaveCount(1);

    // Mitten in einer Bearbeitung geht ↺ nicht.
    await page.getByTestId(/^landschaftseditor-fenster-\d+-reiter-eigenschaften$/).click();
    await nameFeld(page).fill("Gratenfelser Kessel");
    await page.getByTestId(/^landschaftseditor-fenster-\d+-reiter-verlauf$/).click();
    // Der Reiter baut den Verlauf neu auf: Der Eintrag ist wieder zu.
    await aufklappen(umzug);
    await expect(ruecknahme(umzug)).toBeDisabled();
    await page.getByTestId("landschaft-leiste-verwerfen").click();
    // Unter Last kam Escape vor dem Verwerfen an und traf noch die Änderung (Prüfbank 2026-10-19): erst ist der Entwurf leer.
    await expect(page.getByTestId("landschaft-leiste-verwerfen")).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(leiste(page)).toHaveCount(0);
    await expect(ruecknahme(umzug)).toBeEnabled();
    const vorher = server.gelesen;
    await ruecknahme(umzug).click();
    const frage = umzug.locator('[data-testid$="-ruecknahme-frage"]');
    await expect(frage).toContainText("Diese Änderung zurücknehmen?");
    expect(vorschau).toEqual([{ members: [UMGEZOGEN] }]);
    expect(zurueck).toHaveLength(0);
    await frage.getByRole("button", { name: "Zurücknehmen", exact: true }).click();
    await expect.poll(() => zurueck.length).toBe(1);
    expect(zurueck[0]).toEqual({ operationId: expect.any(String), members: [UMGEZOGEN], membersHash: "f".repeat(64) });
    // Kein PATCH: Der Anschluss schreibt nichts selbst.
    expect(server.gesendet).toHaveLength(0);
    await expect.poll(() => server.gelesen).toBeGreaterThan(vorher);
});

test("🔴 C4: „Auf der Karte verschieben“ – der Anfasser zieht die Beschriftung, „Fertig“ schreibt ihre Lage in EINER Operation", async ({
    page,
}) => {
    const server = await oeffne(page);
    await page.getByRole("tab", { name: /Beschriftungen/ }).click();
    const knopf = page.getByTestId(/^landschaftseditor-fenster-\d+-beschriftung-0-verschieben$/);
    await expect(knopf).toHaveText("Auf der Karte verschieben");
    await knopf.click();
    await expect(knopf).toHaveText("Verschieben beenden");
    // Die Beschriftung links neben das Fenster holen, dann ihren Anfasser greifen.
    const label = DETAIL.labels[0]!;
    await page.evaluate((p) => {
        globalThis.avesmapsMap!.jumpTo({ center: globalThis.avesmapsRenderProjection!.toRenderLngLat(p), zoom: 6 });
    }, label);
    const box = (await page.getByTestId("map").boundingBox())!;
    const schirm = async (p: { x: number; y: number }) => {
        const at = await page.evaluate(
            (ziel) => globalThis.avesmapsMap!.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(ziel)),
            p,
        );
        return { x: box.x + at.x, y: box.y + at.y };
    };
    // Erst wenn die Karte steht, liegt der Anfasser greifbar unter dem Zeiger.
    await settleFrame(page);
    const von = await schirm(label);
    await page.mouse.move(von.x, von.y);
    await page.mouse.down();
    await page.mouse.move(von.x - 60, von.y + 30, { steps: 8 });
    await page.mouse.up();
    // Der Zug steht im EINEN Entwurf: die Leiste „Felder“ zählt ihn.
    await expect(leiste(page)).toBeVisible();
    await page.getByTestId("landschaft-leiste-fertig").click();
    await expect.poll(() => server.gesendet.length).toBe(1);
    const gesendet = server.gesendet[0]!;
    expect(gesendet.changes).toBeUndefined();
    expect(gesendet.labels).toHaveLength(1);
    const lage = gesendet.labels![0]!.changes.position!;
    expect(gesendet.labels![0]).toMatchObject({ id: LABEL, baseRevision: 1 });
    expect(lage[0]).toBeLessThan(label.x);
    expect(lage[1]).not.toBe(label.y);
    // Nach „Fertig“ endet der Modus.
    await expect(knopf).toHaveText("Auf der Karte verschieben");
});

test("C4: entlang der Fläche ist „Auf der Karte verschieben“ gesperrt, mit Grund", async ({ page }) => {
    const server = await oeffne(page);
    server.detail = { ...DETAIL, curve: { enabled: true, max: 1 } };
    await page.reload();
    await editorPanelVorn(page);
    await page.getByTestId("editorpanel-kachel-regionen").click();
    await page.getByTestId("editorpanel-verb").click();
    await page
        .locator('[data-testid^="landschaftseditor-"][data-testid$="-liste"]')
        .getByRole("option", { name: /Gratenfelser Becken/ })
        .click();
    await page.getByRole("tab", { name: /Beschriftungen/ }).click();
    const knopf = page.getByTestId(/^landschaftseditor-fenster-\d+-beschriftung-0-verschieben$/);
    await expect(knopf).toBeDisabled();
    // Der Grund steht EINMAL über den Beschriftungen, nicht als Zeile unter jedem Knopf (WI-0232, Kleinfund der Hauptorchestrierung
    // 2026-10-19: fünf fast gleiche Zeilen untereinander); am Knopf bleibt er als `title`.
    await expect(knopf).toHaveAttribute("title", /^Steht entlang der Fläche;/);
    await expect(page.getByText("Diese Landschaft ist entlang der Fläche beschriftet;")).toHaveCount(1);
    await expect(page.getByText("Steht entlang der Fläche;")).toHaveCount(0);
});

test("🔴 D2: „Fläche entfernen …“ nimmt sie in EINER Operation von der Karte; danach liest das Fenster nur, ↺ im Verlauf holt sie zurück", async ({
    page,
}) => {
    const server = await oeffne(page);
    const entfernt: unknown[] = [];
    const zurueck: unknown[] = [];
    const ENTFERNT = "e9e9e9e9-0000-4000-8000-000000000001";
    const quittung = (revision: number): OperationReceipt => ({
        operationId: "op",
        status: "applied",
        environment: "test",
        affected: [{ kind: "landscape", id: BECKEN, revision }],
        derivedWork: [],
        warnings: [],
        mapRevision: 902,
    });
    await page.route(`**/api/editor/landscapes/${BECKEN}/retire`, (route) => {
        entfernt.push(route.request().postDataJSON());
        server.detail = { ...server.detail, state: "off_map", revision: server.detail.revision + 1 };
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(quittung(2)) });
    });
    // ↺ nimmt der Server zurück (WI-0265 B6c): Vorprüfung (liest nur), Rückfrage, EINE Rücknahme (`restore-series`); beide Antworten sind hier gestellt, der echte Ablauf steht in `ruecknahme-flaeche.test.ts`.
    const vorschau: unknown[] = [];
    await page.route(`**/api/editor/landscapes/${BECKEN}/restore-series/preview`, (route) => {
        vorschau.push(route.request().postDataJSON());
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                ergebnis: "ok",
                membersHash: "f".repeat(64),
                mitglieder: [
                    {
                        operationId: ENTFERNT,
                        seq: 42,
                        at: "2026-10-18T13:00:00.000Z",
                        operation: "landscape.retire",
                        source: "editor",
                        actor: { kind: "person", name: "Thomas" },
                        status: "ruecknehmbar",
                        offen: true,
                        gegenstaende: [
                            {
                                kind: "landscape",
                                id: BECKEN,
                                name: "Gratenfelser Becken",
                                action: "region.taken_off_map",
                                revisionBefore: 1,
                                revisionAfter: 2,
                                felder: [],
                            },
                        ],
                    },
                ],
                offen: [ENTFERNT],
                gegenstaende: [],
                konflikte: [],
                sperren: [],
                fehlendeRechte: [],
                fremdePersonen: [],
                reasonRequired: false,
                folgen: { gegenstaende: 1, gelaende: "keines" },
            }),
        });
    });
    await page.route(`**/api/editor/landscapes/${BECKEN}/restore-series`, (route) => {
        zurueck.push(route.request().postDataJSON());
        const wieder = { ...server.detail, revision: server.detail.revision + 1 };
        delete wieder.state;
        server.detail = wieder;
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ ...quittung(3), reverts: [ENTFERNT] }),
        });
    });
    await page.route(`**/api/editor/landscapes/${BECKEN}/history**`, (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                entries: [
                    {
                        operationId: ENTFERNT,
                        seq: 50,
                        at: "2026-10-18T13:00:00.000Z",
                        operation: "landscape.retire",
                        source: "editor",
                        summary: "Gratenfelser Becken: von der Karte genommen",
                        actor: { kind: "person", name: "Rondrikan" },
                        objects: [
                            {
                                kind: "landscape",
                                id: BECKEN,
                                name: "Gratenfelser Becken",
                                action: "region.taken_off_map",
                                revisionBefore: 1,
                                revisionAfter: 2,
                                changes: {
                                    active: { before: true, after: false },
                                    offMap: { before: false, after: true },
                                },
                            },
                        ],
                    },
                ],
            } satisfies MapHistoryPage),
        }),
    );
    await page.getByTestId(/^landschaftseditor-fenster-\d+-entfernen-oeffnen$/).click();
    const blatt = page.getByTestId(/^landschaftseditor-fenster-\d+-entfernen$/);
    await expect(blatt).toContainText("„Gratenfelser Becken“ entfernen?");
    await expect(blatt).toContainText("1 Teilflächen und 1 Beschriftungen");
    await blatt.getByRole("button", { name: "Entfernen" }).click();
    await expect.poll(() => entfernt.length).toBe(1);
    expect(entfernt[0]).toEqual({ operationId: expect.any(String), baseRevision: 1, stage: "off_map" });
    // Still: das Band, keine Felder zum Schreiben, kein zweites Entfernen.
    const band = page.getByTestId(/^landschaftseditor-fenster-\d+-stand$/);
    await expect(band).toContainText("Nicht auf der Karte. Der Verlauf holt sie zurück.");
    await expect(nameFeld(page)).toHaveCount(0);
    await expect(page.getByTestId(/^landschaftseditor-fenster-\d+-entfernen-oeffnen$/)).toHaveCount(0);
    await band.getByRole("button", { name: "Verlauf" }).click();
    // ↺ steht im aufgeklappten Eintrag, fragt den Server und danach mit der Rückfrage; geschrieben ist bis zur Bestätigung nichts.
    const eintrag = page.getByTestId(/^landschaftseditor-fenster-\d+-verlauf-eintrag$/);
    await eintrag.locator("summary").click();
    await eintrag.locator('[data-testid$="-ruecknahme"]').click();
    const frage = eintrag.locator('[data-testid$="-ruecknahme-frage"]');
    await expect(frage).toContainText("Diese Änderung zurücknehmen?");
    expect(vorschau).toEqual([{ members: [ENTFERNT] }]);
    expect(zurueck).toHaveLength(0);
    await frage.getByRole("button", { name: "Zurücknehmen", exact: true }).click();
    await expect.poll(() => zurueck.length).toBe(1);
    expect(zurueck[0]).toEqual({ operationId: expect.any(String), members: [ENTFERNT], membersHash: "f".repeat(64) });
    await expect(band).toHaveCount(0);
});

test("🔴 T41: „für Besucher verborgen“ ist ein Feld neben der Klicksperre; „Fertig“ schreibt hidden in EINER Operation", async ({
    page,
}) => {
    const server = await oeffne(page);
    await page.getByRole("tab", { name: /^Form/ }).click();
    await page.getByTestId(/^landschaftseditor-fenster-\d+-feld-verborgen$/).check();
    await expect(leiste(page)).toBeVisible();
    await page.getByTestId("landschaft-leiste-fertig").click();
    await expect.poll(() => server.gesendet.length).toBe(1);
    expect(server.gesendet[0]).toEqual({ operationId: expect.any(String), baseRevision: 1, changes: { hidden: true } });
});

test.describe("bei 1280 px mit offener Liste (EDIT-0003 T45 (3))", () => {
    test.use({ viewport: { width: 1280, height: 720 } });

    test("🔴 keine Lücke neben Planer und Fenster: dieselbe Leiste steht unten im Fenster, „Fertig“ ist klickbar", async ({
        page,
    }) => {
        const server = await oeffne(page);
        await nameFeld(page).fill("Gratenfelser Kessel");
        await nameFeld(page).press("Tab");
        const imFenster = page.locator('dialog[data-lage="angedockt"]').getByTestId("landschaft-leiste");
        await expect(imFenster).toBeVisible();
        await expect(page.getByTestId("landschaft-leiste-fertig")).toHaveCount(1);
        await page.screenshot({ path: "test-results/landschaftseditor-b2-1280.png" });
        await page.getByTestId("landschaft-leiste-fertig").click();
        await expect.poll(() => server.gesendet.length).toBe(1);
        await expect(leiste(page)).toHaveCount(0);
    });
});
