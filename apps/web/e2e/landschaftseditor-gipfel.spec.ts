import { expect, test, type Page, type Route } from "@playwright/test";
import type {
    EditorLandscapeList,
    EditorPeakDetail,
    OperationReceipt,
    PeakCreateBody,
    PeakCreateReceipt,
    PeakRetireBody,
    PeakUpdateBody,
    RuecknahmeBody,
} from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap, settleFrame } from "./map-handle.ts";
import { editorPanelVorn } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Gipfel und Vulkane anklicken und verschieben (WI-0178 P2; Betreiber über Claudio 2026-10-18: „es gibt keine möglichkeit berge zu
 * verschieben, weil man kann nicht draufklicken :)“). Die Gipfel kommen aus den Kacheln der lokalen Karte; Detail und `peak.update` aus
 * einem Stub. 🔴 Kein Test schreibt in die Datenbank der Entwicklung; den Schreibweg prüft `apps/server/test/peak-update.test.ts`.
 *
 * Problemfälle: Ein Klick aufs ▲ trifft die Fläche darunter oder nichts; im Editor-Modus öffnet kein Fenster am Gipfel; „Auf der Karte
 * verschieben“ startet keinen Modus; ein Zug zählt nicht; „Fertig“ schreibt nicht EINE Operation mit der neuen Lage; in der Liste (P3) fehlt
 * der Gipfel, ein Klick auf seine Zeile öffnet ihn nicht, der Doppelklick fliegt nicht; „Gipfel setzen …“ (P7) fehlt in der Topographie,
 * setzt nicht an der Stelle oder öffnet das Fenster ohne markierten Namen; „Gipfel entfernen …“ fehlt im Menü, fragt nicht vorher mit dem
 * Gebirge, entfernt nicht oder lässt sich im Verlauf nicht zurückholen.
 */

test.use({ viewport: { width: 1920, height: 1080 } });

/** Der Kosch in der Topographie, für Stub-Gipfel und eine freie Stelle. */
const KOSCH = { x: 450, y: 560 };
/**
 * Östlich davon stehen in der lokalen Karte Gipfel dicht beieinander (Dotz 467 · 543, Greifenzinne 464 · 543, Donnerkogel 468 · 539;
 * gelesen aus der Kachel `terrain_peak_render/0/0/0` am 2026-10-18). Am Kosch selbst liegt bei Zoom 6 keiner im Bild. Die Voraussetzung
 * wird geprüft.
 */
const GIPFELFELD = { x: 467, y: 545 };

/** Der Gipfel, den „▲ Gipfel setzen …“ im Stub anlegt (P7). */
const NEU = "c8c8c8c8-0000-4000-8000-0000000000a7";

interface Server {
    gesendet: PeakUpdateBody[];
    angelegt: PeakCreateBody[];
    entfernt: PeakRetireBody[];
    zurueck: RuecknahmeBody[];
    geloescht: boolean;
    /** Wo der Gipfel liegt, den der Test anklickt (das Detail des Stubs nennt diese Lage). */
    lage: [number, number];
}

async function stub(page: Page, liste: EditorLandscapeList = { rows: [] }): Promise<Server> {
    const server: Server = {
        gesendet: [],
        angelegt: [],
        entfernt: [],
        zurueck: [],
        geloescht: false,
        lage: [KOSCH.x, KOSCH.y],
    };
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
    await page.route("**/api/editor/landscapes", (route) => json(route, 200, liste));
    await page.route(/\/api\/editor\/locks(\/(heartbeat|release))?(\?.*)?$/, async (route) => {
        if (route.request().method() === "GET") return json(route, 200, { locks: [] });
        const url = route.request().url();
        if (url.endsWith("/release")) return route.fulfill({ status: 204 });
        if (url.endsWith("/heartbeat")) return json(route, 200, { lost: [] });
        const body = route.request().postDataJSON() as { kind: string; id: string; part: string };
        return json(route, 200, {
            lock: {
                ...body,
                person: { id: "a4a4a4a4-0000-4000-8000-0000000000f1", name: "Rondrikan" },
                since: "2026-10-18T12:00:00.000Z",
                heartbeatAt: "2026-10-18T12:00:00.000Z",
                own: true,
            },
        });
    });
    await page.route(/\/api\/editor\/peaks$/, (route) => {
        const body = route.request().postDataJSON() as PeakCreateBody;
        server.angelegt.push(body);
        server.lage = body.position;
        const quittung: PeakCreateReceipt = {
            operationId: body.operationId,
            status: "applied",
            environment: "development",
            affected: [{ kind: "peak", id: NEU, revision: 1 }],
            derivedWork: [],
            warnings: [],
            mapRevision: 4712,
            publicId: NEU,
            name: "Gipfel-001",
        };
        return json(route, 200, quittung);
    });
    // „Gipfel entfernen …“ und sein ↺; der Verlauf nennt das Entfernen, solange der Gipfel gelöscht ist.
    const ENTFERNT_OP = "c8c8c8c8-0000-4000-8000-0000000000e1";
    await page.route(/\/api\/editor\/peaks\/[0-9a-f-]{36}\/retire$/, (route) => {
        const id = route.request().url().split("/").at(-2)!;
        server.entfernt.push(route.request().postDataJSON() as PeakRetireBody);
        server.geloescht = true;
        const quittung: OperationReceipt = {
            operationId: ENTFERNT_OP,
            status: "applied",
            environment: "development",
            affected: [{ kind: "peak", id, revision: 2 }],
            derivedWork: [],
            warnings: [],
            mapRevision: 4713,
        };
        return json(route, 200, quittung);
    });
    // ↺ nimmt der Server zurück (WI-0265 B6c): Vorprüfung (liest nur), Rückfrage, EINE Rücknahme (`restore-series`); beide Antworten sind hier gestellt, der echte Ablauf steht in `ruecknahme-gipfel.test.ts`.
    await page.route(/\/api\/editor\/peaks\/[0-9a-f-]{36}\/restore-series\/preview$/, (route) => {
        const id = route.request().url().split("/").at(-3)!;
        return json(route, 200, {
            ergebnis: "ok",
            membersHash: "f".repeat(64),
            mitglieder: [
                {
                    operationId: ENTFERNT_OP,
                    seq: 42,
                    at: "2026-10-18T13:00:00.000Z",
                    operation: "peak.retire",
                    source: "editor",
                    actor: { kind: "person", name: "Thomas" },
                    status: "ruecknehmbar",
                    offen: true,
                    gegenstaende: [
                        {
                            kind: "peak",
                            id: id,
                            name: "Probezinne",
                            action: "peak.retired",
                            revisionBefore: 1,
                            revisionAfter: 2,
                            felder: [],
                        },
                    ],
                },
            ],
            offen: [ENTFERNT_OP],
            gegenstaende: [],
            konflikte: [],
            sperren: [],
            fehlendeRechte: [],
            fremdePersonen: [],
            reasonRequired: false,
            folgen: { gegenstaende: 1, gelaende: "keines" },
        });
    });
    await page.route(/\/api\/editor\/peaks\/[0-9a-f-]{36}\/restore-series$/, (route) => {
        const id = route.request().url().split("/").at(-2)!;
        server.zurueck.push(route.request().postDataJSON() as RuecknahmeBody);
        server.geloescht = false;
        const quittung = {
            operationId: "c8c8c8c8-0000-4000-8000-0000000000e2",
            status: "applied",
            environment: "development",
            affected: [{ kind: "peak", id, revision: 2 }],
            derivedWork: [],
            warnings: [],
            mapRevision: 4714,
            reverts: [ENTFERNT_OP],
        };
        return json(route, 200, quittung);
    });
    await page.route(/\/api\/editor\/peaks\/[0-9a-f-]{36}\/history/, (route) => {
        const id = route.request().url().split("/history")[0]!.split("/").at(-1)!;
        return json(route, 200, {
            entries: server.geloescht
                ? [
                      {
                          operationId: ENTFERNT_OP,
                          seq: 9,
                          at: "2026-10-19T12:00:00.000Z",
                          operation: "peak.retire",
                          source: "editor",
                          actor: { kind: "person", name: "Thomas" },
                          summary: "Probezinne: gelöscht",
                          objects: [
                              {
                                  kind: "peak",
                                  id,
                                  name: "Probezinne",
                                  action: "peak.retired",
                                  revisionBefore: 1,
                                  revisionAfter: 2,
                                  changes: { active: { before: true, after: false } },
                              },
                          ],
                      },
                  ]
                : [],
        });
    });
    await page.route(/\/api\/editor\/peaks\/[0-9a-f-]{36}$/, (route) => {
        const id = route.request().url().split("/").at(-1)!;
        if (route.request().method() === "PATCH") {
            const body = route.request().postDataJSON() as PeakUpdateBody;
            server.gesendet.push(body);
            const quittung: OperationReceipt = {
                operationId: body.operationId,
                status: "applied",
                environment: "development",
                affected: [{ kind: "peak", id, revision: 2 }],
                derivedWork: [],
                warnings: [],
                mapRevision: 4711,
            };
            return json(route, 200, quittung);
        }
        const detail: EditorPeakDetail = {
            id,
            name: id === NEU ? "Gipfel-001" : "Probezinne",
            subtype: "berggipfel",
            ...(id === NEU ? {} : { height: 3200 }),
            showName: true,
            position: server.lage,
            revision: server.geloescht ? 2 : 1,
            ...(server.geloescht ? { state: "retired" as const } : {}),
            ...(id === NEU ? {} : { mountains: [{ id: "c8c8c8c8-0000-4000-8000-0000000000b1", name: "Kosch" }] }),
        };
        return json(route, 200, detail);
    });
    return server;
}

/** Ein Gipfel in der Mitte des Bilds, wie die Karte ihn zeichnet: Kennung und Punkt auf der Seite. */
async function gipfelImBild(
    page: Page,
): Promise<{ id: string; x: number; y: number; karte: [number, number] } | undefined> {
    return page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        if (map.getLayer("gipfel") === undefined) return undefined;
        const rahmen = map.getCanvas().getBoundingClientRect();
        const treffer = map
            .queryRenderedFeatures({ layers: ["gipfel"] })
            .map((f) => {
                const [lng, lat] = (f.geometry as { coordinates: [number, number] }).coordinates;
                const at = map.project({ lng, lat });
                const karte = globalThis.avesmapsRenderProjection!.fromRenderLngLat({ lng, lat });
                return {
                    id: String(f.properties["public_id"]),
                    x: at.x,
                    y: at.y,
                    karte: [karte.x, karte.y] as [number, number],
                };
            })
            // In der freien Mitte, weg von Panelen und Leisten.
            .filter((p) => p.x > 500 && p.x < rahmen.width - 700 && p.y > 200 && p.y < rahmen.height - 200);
        const erster = treffer[0];
        return erster === undefined
            ? undefined
            : { id: erster.id, x: rahmen.left + erster.x, y: rahmen.top + erster.y, karte: erster.karte };
    });
}

test("🔴 ein Klick aufs ▲ öffnet im Editor-Modus das Derographie-Fenster am Gipfel; verschieben, „Fertig“ schreibt EINE Operation mit der Lage", async ({
    page,
}) => {
    const server = await stub(page);
    await page.goto(
        `${EDITOR_MODE}#x=${String(GIPFELFELD.x)}&y=${String(GIPFELFELD.y)}&z=6&series=original&view=landscapes&layer=topographie`,
    );
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 30_000 });
    await settleFrame(page);
    const gipfel = await gipfelImBild(page);
    expect(gipfel, "Voraussetzung: ein gezeichneter Gipfel in der Mitte des Bilds").toBeDefined();
    const { id, x, y } = gipfel!;
    server.lage = gipfel!.karte;

    // Das Schild beim Zeigen, dann der Klick: das Fenster am Gipfel.
    await page.mouse.move(x, y, { steps: 3 });
    await page.mouse.click(x, y);
    const fenster = page.locator('[data-testid^="landschaftseditor-"][data-testid$="-gipfel"]');
    await expect(fenster).toBeVisible();
    await expect(fenster).toContainText("Probezinne");
    // Mit Schreibrecht nicht „nur lesen“, und die Spalte heißt nach dem Gipfel (Fund am Bild des ersten Laufs).
    await expect(page.getByText("Eigenschaften des Gipfels")).toBeVisible();
    await expect(page.getByText("nur lesen", { exact: true })).toHaveCount(0);

    // „Auf der Karte verschieben“, ein Zug am Anfasser, „Fertig“ in der Leiste.
    await page.locator('[data-testid$="-gipfel-verschieben"]').click();
    await settleFrame(page);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 60, y + 30, { steps: 6 });
    await page.mouse.up();
    await expect(page.getByTestId("landschaft-leiste")).toBeVisible();
    await page.screenshot({ path: "test-results/p2-gipfel-verschieben.png" });
    await page.getByTestId("landschaft-leiste-fertig").click();
    await expect.poll(() => server.gesendet.length).toBe(1);
    const body = server.gesendet[0]!;
    expect(body.baseRevision).toBe(1);
    expect(Object.keys(body.changes)).toEqual(["position"]);
    expect(body.changes.position![0]).toBeGreaterThan(gipfel!.karte[0]);
    expect(page.url()).toContain("view=landscapes");
    void id;
});

test("🔴 P2: der Rechtsklick aufs ▲ zeigt das Menü am Gipfel; der Doppelklick startet „Auf der Karte verschieben“", async ({
    page,
}) => {
    const server = await stub(page);
    await page.goto(
        `${EDITOR_MODE}#x=${String(GIPFELFELD.x)}&y=${String(GIPFELFELD.y)}&z=6&series=original&view=landscapes&layer=topographie`,
    );
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 30_000 });
    await settleFrame(page);
    const gipfel = await gipfelImBild(page);
    expect(gipfel, "Voraussetzung: ein gezeichneter Gipfel in der Mitte des Bilds").toBeDefined();
    server.lage = gipfel!.karte;

    // Fassung 16: „Eigenschaften bearbeiten“ und „Auf der Karte verschieben“ mit dem Kürzel „Doppelklick“.
    await page.mouse.click(gipfel!.x, gipfel!.y, { button: "right" });
    await expect(page.getByTestId("context-editor-gipfel-bearbeiten")).toBeVisible();
    const verschieben = page.getByTestId("context-editor-gipfel-verschieben");
    await expect(verschieben).toBeEnabled();
    await expect(verschieben).toContainText("Doppelklick");
    await page.screenshot({ path: "test-results/p2-gipfel-menue.png" });
    await page.keyboard.press("Escape");

    await page.mouse.dblclick(gipfel!.x, gipfel!.y);
    await expect(page.locator('[data-testid^="landschaftseditor-"][data-testid$="-gipfel-verschieben"]')).toContainText(
        "Verschieben beenden",
    );
});

test("🔴 P3: in der Liste steht der Gipfel als Zeile der Topographie; ein Klick öffnet ihn im Fenster, der Doppelklick fliegt zu ihm", async ({
    page,
}) => {
    await stub(page, {
        rows: [],
        peaks: [
            {
                id: "c8c8c8c8-0000-4000-8000-000000000001",
                name: "Probezinne",
                subtype: "berggipfel",
                height: 3200,
                circle: "halb-rechts",
                position: [KOSCH.x, KOSCH.y],
            },
        ],
    });
    await openMap(page, EDITOR_MODE);
    await editorPanelVorn(page);
    await page.getByTestId("editorpanel-kachel-regionen").click();
    await page.getByTestId("editorpanel-verb").click();
    const liste = page.locator('[data-testid^="landschaftseditor-"][data-testid$="-liste"]');
    const zeile = liste.getByRole("option", { name: /Probezinne/ });
    await expect(zeile).toContainText("Berggipfel");
    await expect(zeile).toContainText("3.200 Schritt");

    await zeile.click();
    await expect(page.locator('[data-testid^="landschaftseditor-"][data-testid$="-gipfel"]')).toContainText(
        "Probezinne",
    );
    await expect(page).toHaveURL(/layer=topographie/);
    await expect(zeile).toHaveAttribute("aria-selected", "true");

    const vorher = await page.evaluate(() => {
        const mitte = globalThis.avesmapsMap!.getCenter();
        return { lng: mitte.lng, lat: mitte.lat };
    });
    await zeile.dblclick();
    await page.waitForFunction(
        (alt) => {
            const jetzt = globalThis.avesmapsMap!.getCenter();
            return !globalThis.avesmapsMap!.isMoving() && (jetzt.lng !== alt.lng || jetzt.lat !== alt.lat);
        },
        vorher,
        { timeout: 15_000 },
    );
    await page.screenshot({ path: "test-results/p3-gipfel-liste.png" });
});

test("🔴 P7, WI-0271 L4: „Hier hinzufügen › ▲ Landmarke setzen › Berggipfel“ in der Topographie, „Fertig“ setzt EINEN Gipfel an der Stelle; sein Fenster öffnet mit markiertem Namen", async ({
    page,
}) => {
    const server = await stub(page);
    await page.goto(
        `${EDITOR_MODE}#x=${String(KOSCH.x)}&y=${String(KOSCH.y)}&z=6&series=original&view=landscapes&layer=topographie`,
    );
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 30_000 });
    await settleFrame(page);
    // Eine Stelle in der freien Mitte, weg von jedem Gipfel, samt ihrer Lage in Karteneinheiten.
    const stelle = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const rahmen = map.getCanvas().getBoundingClientRect();
        const gipfel = map.queryRenderedFeatures({ layers: ["gipfel"] }).map((f) => {
            const [lng, lat] = (f.geometry as { coordinates: [number, number] }).coordinates;
            return map.project({ lng, lat });
        });
        for (let y = 240; y < rahmen.height - 300; y += 20)
            for (let x = 560; x < rahmen.width - 760; x += 20) {
                if (gipfel.some((g) => Math.hypot(g.x - x, g.y - y) < 60)) continue;
                const karte = globalThis.avesmapsRenderProjection!.fromRenderLngLat(map.unproject([x, y]));
                return { x: rahmen.left + x, y: rahmen.top + y, karte: [karte.x, karte.y] as [number, number] };
            }
        return undefined;
    });
    expect(stelle, "eine freie Stelle").toBeDefined();
    await page.mouse.click(stelle!.x, stelle!.y, { button: "right" });
    await page.getByTestId("context-editor-hier-hinzufuegen").click();
    // „▲ Landmarke setzen › Berggipfel“ (WI-0271 L4, Kartenmenü A): erst „Fertig“ legt ihn an (G4).
    const eintrag = page.getByTestId("context-editor-landmarke-setzen");
    await expect(eintrag).toBeEnabled();
    await expect(eintrag).toContainText("Landmarke setzen");
    await eintrag.hover();
    await page.getByTestId("context-editor-landmarke-setzen-berggipfel").click();
    await expect(page.getByTestId("landmarke-setzen-leiste")).toContainText("Berggipfel");
    expect(server.angelegt).toHaveLength(0);
    await page.getByTestId("landmarke-setzen-leiste-fertig").click();
    await expect.poll(() => server.angelegt.length).toBe(1);
    expect(server.angelegt[0]!.position[0]).toBeCloseTo(stelle!.karte[0], 1);
    expect(server.angelegt[0]!.position[1]).toBeCloseTo(stelle!.karte[1], 1);
    await expect(page.getByTestId("toast")).toContainText("Gipfel-001 gesetzt.");

    // Das Fenster am neuen Gipfel, der Griff markiert: Tippen überschreibt ihn.
    await expect(page.locator('[data-testid^="landschaftseditor-"][data-testid$="-gipfel"]')).toContainText(
        "Gipfel-001",
    );
    await expect
        .poll(() =>
            page.evaluate(() => {
                const feld = document.activeElement as HTMLInputElement | null;
                return feld?.tagName === "INPUT"
                    ? [feld.value, feld.selectionStart, feld.selectionEnd]
                    : [undefined, undefined, undefined];
            }),
        )
        .toEqual(["Gipfel-001", 0, "Gipfel-001".length]);
    await page.screenshot({ path: "test-results/p7-gipfel-gesetzt.png" });
});

test("🔴 „Gipfel entfernen …“: im Menü am ▲, die Rückfrage nennt das Gebirge; gelöscht sagt das Fenster es, ↺ im Verlauf holt ihn zurück", async ({
    page,
}) => {
    // Editor-Orchestrierung 2026-10-19: „Bau „Gipfel entfernen …“ wie „Fläche entfernen“: weich, mit ↺ über „Gelöscht“ und im Verlauf“.
    const server = await stub(page);
    await page.goto(
        `${EDITOR_MODE}#x=${String(GIPFELFELD.x)}&y=${String(GIPFELFELD.y)}&z=6&series=original&view=landscapes&layer=topographie`,
    );
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 30_000 });
    await settleFrame(page);
    const gipfel = await gipfelImBild(page);
    expect(gipfel, "Voraussetzung: ein gezeichneter Gipfel in der Mitte des Bilds").toBeDefined();
    server.lage = gipfel!.karte;

    await page.mouse.click(gipfel!.x, gipfel!.y, { button: "right" });
    const eintrag = page.getByTestId("context-editor-gipfel-entfernen");
    await expect(eintrag).toBeEnabled();
    await expect(eintrag).toContainText("Gipfel entfernen …");
    await eintrag.click();
    // Die Rückfrage im Fenster nennt die Folgen vorher.
    const frage = page.locator('[data-testid^="landschaftseditor-"][data-testid$="-gipfel-entfernen-frage"]');
    await expect(frage).toBeVisible();
    await expect(frage).toContainText("„Probezinne“ entfernen?");
    await expect(frage).toContainText("Gebirge Kosch");
    await expect(frage).toContainText("„Gelöscht“");
    await frage.getByRole("button", { name: "Entfernen", exact: true }).click();
    await expect.poll(() => server.entfernt.length).toBe(1);
    expect(server.entfernt[0]).toEqual({ operationId: expect.any(String), baseRevision: 1 });

    // Gelöscht: Das Fenster sagt es, die Felder ruhen, der Verlauf holt ihn zurück.
    await expect(page.locator('[data-testid$="-gipfel-geloescht"]')).toContainText(
        "Gelöscht. Der Verlauf holt ihn zurück.",
    );
    await expect(page.locator('[data-testid$="-gipfel-name"]')).toHaveCount(0);
    const eintragImVerlauf = page.locator('[data-testid^="landschaftseditor-"][data-testid$="-verlauf-eintrag"]');
    await expect(eintragImVerlauf).toBeVisible();
    await eintragImVerlauf.locator("summary").click();
    await eintragImVerlauf.locator('[data-testid$="-ruecknahme"]').click();
    await eintragImVerlauf
        .locator('[data-testid$="-ruecknahme-frage"]')
        .getByRole("button", { name: "Zurücknehmen", exact: true })
        .click();
    await expect.poll(() => server.zurueck.length).toBe(1);
    expect(server.zurueck[0]).toEqual({
        operationId: expect.any(String),
        members: ["c8c8c8c8-0000-4000-8000-0000000000e1"],
        membersHash: "f".repeat(64),
    });
    await expect(page.locator('[data-testid$="-gipfel-geloescht"]')).toHaveCount(0);
});
