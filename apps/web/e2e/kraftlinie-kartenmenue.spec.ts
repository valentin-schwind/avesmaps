import { expect, test, type Page, type Route } from "@playwright/test";
import type {
    EditorPowerlineDetail,
    EditorPowerlineList,
    OperationReceipt,
    PowerlineNetwork,
    PowerlineRetireBody,
    RuecknahmeBody,
    RuecknahmeVorschauBody,
} from "@avesmaps3d/shared";
import { chooseView, EDITOR_MODE, GARETH, openMap, settleFrame, showPlace } from "./map-handle.ts";
import { editorPanelGemerktZu } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Die Editor-Karte an einem Nodix in der Ansicht „Kraftlinien“ (EDIT-0003 T39, Betreiber 2026-10-17): nur „Eigenschaften bearbeiten“,
 * „Neue Kraftlinie“ und „Kraftlinie entfernen ›“ mit den Linien dort; die Wahl fragt im Kraftlinien-Fenster nach und legt die Linie
 * dann still. 🔴 Kein Test schreibt in die Datenbank der Entwicklung: Netz und Knoten sind echt (lesend), Liste, Linie, Sperre und
 * Schreibweg kommen aus Stubs (den echten Schreibweg prüft `editor-kraftlinien-schreiben.test.ts`).
 *
 * Problemfälle: Ort verschieben, Verbergen oder Ort entfernen stehen weiter da; das Untermenü fehlt oder nennt andere Linien als die am
 * Knoten; die Wahl entfernt ohne Nachfrage oder eine andere Linie; die Revisionen gehen nicht mit.
 */

test.use({ viewport: { width: 1920, height: 1080 } });

interface Knoten {
    x: number;
    y: number;
    id: string;
    linien: { anker: string; name: string }[];
}

/** Ein Nodix-Ort auf dem Schirm, an dem Kraftlinien enden, mit seinen Linien (aus dem Netz der Bögen). */
async function nodixMitLinien(page: Page): Promise<Knoten> {
    await page.waitForFunction(
        () =>
            (
                globalThis as unknown as { avesmapsPowerlineArcs?: { state(): { ready: boolean; active: boolean } } }
            ).avesmapsPowerlineArcs?.state().ready === true,
        undefined,
        { timeout: 30_000 },
    );
    await settleFrame(page);
    const knoten = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const arcs = (
            globalThis as unknown as {
                avesmapsPowerlineArcs: { linienAm(id: string): { anker: string; name: string }[] };
            }
        ).avesmapsPowerlineArcs;
        const rahmen = map.getCanvas().getBoundingClientRect();
        for (const feature of map.queryRenderedFeatures({ layers: ["nodix-treffer"] })) {
            if (feature.properties["node_kind"] !== "place") continue;
            const id = String(feature.properties["public_id"] ?? "");
            const linien = arcs.linienAm(id);
            if (linien.length === 0) continue;
            const [lng, lat] = (feature.geometry as { coordinates: [number, number] }).coordinates;
            const at = map.project({ lng, lat });
            // Nur ein Knoten mitten auf der Karte: Am Rand lägen Planer, Panel oder das Menü über ihm.
            if (at.x < 500 || at.x > rahmen.width - 700 || at.y < 150 || at.y > rahmen.height - 450) continue;
            return { x: rahmen.left + at.x, y: rahmen.top + at.y, id, linien };
        }
        return undefined;
    });
    if (knoten === undefined) throw new Error("kein Nodix-Ort mit Kraftlinien im Bild");
    return knoten;
}

/**
 * Ein Kraftlinienpunkt (`node_kind` nodix) mit einer Linie: aus dem Netz der Bögen das Ende einer Linie an einem Kraftlinienpunkt, die
 * Kamera dorthin, dann seine Stelle auf der Leinwand (EDIT-0003 T52).
 */
async function kraftlinienpunktMitLinie(
    page: Page,
): Promise<{ x: number; y: number; id: string; karte: { x: number; y: number } }> {
    const ziel = await page.evaluate(async () => {
        const netz = (await (await fetch("/api/powerlines")).json()) as {
            lines: { from: { id: string; kind: string }; to: { id: string; kind: string }; path: [number, number][] }[];
        };
        for (const linie of netz.lines) {
            if (linie.from.kind === "nodix") return { id: linie.from.id, x: linie.path[0]![0], y: linie.path[0]![1] };
            if (linie.to.kind === "nodix")
                return { id: linie.to.id, x: linie.path.at(-1)![0], y: linie.path.at(-1)![1] };
        }
        return undefined;
    });
    if (ziel === undefined) throw new Error("keine Kraftlinie an einem Kraftlinienpunkt");
    await showPlace(page, { x: ziel.x, y: ziel.y }, 5);
    await settleFrame(page);
    const stelle = await page.evaluate((id) => {
        const map = globalThis.avesmapsMap!;
        const rahmen = map.getCanvas().getBoundingClientRect();
        const knoten = map
            .queryRenderedFeatures({ layers: ["nodix-treffer"] })
            .find((f) => f.properties["node_kind"] === "nodix" && String(f.properties["public_id"] ?? "") === id);
        if (knoten === undefined) return undefined;
        const [lng, lat] = (knoten.geometry as { coordinates: [number, number] }).coordinates;
        const at = map.project({ lng, lat });
        return { x: rahmen.left + at.x, y: rahmen.top + at.y };
    }, ziel.id);
    if (stelle === undefined) throw new Error(`Kraftlinienpunkt ${ziel.id} nicht im Bild`);
    return { ...stelle, id: ziel.id, karte: { x: ziel.x, y: ziel.y } };
}

/**
 * Eine Stelle auf genau EINER Kraftlinie in der freien Karte, wie der Klick sie trifft (die Bögen, `hit`), fern von jedem Knoten (der
 * ginge der Linie vor), mit dem getroffenen Abschnitt.
 */
async function stelleAufLinie(
    page: Page,
    { nichtAnker = false }: { nichtAnker?: boolean } = {},
): Promise<{ x: number; y: number; anker: string; name: string; linie: string }> {
    await page.waitForFunction(
        () =>
            (
                globalThis as unknown as { avesmapsPowerlineArcs?: { state(): { ready: boolean; active: boolean } } }
            ).avesmapsPowerlineArcs?.state().ready === true,
        undefined,
        { timeout: 30_000 },
    );
    await settleFrame(page);
    // Der Anker jeder Linie (kleinster Abschnitt gleichen Namens), wie Server und Liste sie nennen.
    const linieVon = await page.evaluate(async () => {
        const netz = (await (await fetch("/api/powerlines")).json()) as { lines: { id: string; name: string }[] };
        const gruppe = (l: { id: string; name: string }) => (l.name.trim() === "" ? `#${l.id}` : l.name);
        const anker = new Map<string, string>();
        for (const l of netz.lines) {
            const bisher = anker.get(gruppe(l));
            if (bisher === undefined || l.id < bisher) anker.set(gruppe(l), l.id);
        }
        return Object.fromEntries(netz.lines.map((l) => [l.id, anker.get(gruppe(l))!]));
    });
    const stelle = await page.evaluate(
        ({ nichtAnker, linieVon }) => {
            const map = globalThis.avesmapsMap!;
            const arcs = (
                globalThis as unknown as {
                    avesmapsPowerlineArcs: {
                        hit(
                            punkt: { x: number; y: number },
                            reichweite: number,
                        ): { id: string; name: string }[] | undefined;
                    };
                }
            ).avesmapsPowerlineArcs;
            const rahmen = map.getCanvas().getBoundingClientRect();
            const knoten = map.queryRenderedFeatures({ layers: ["nodix-treffer"] }).map((f) => {
                const [lng, lat] = (f.geometry as { coordinates: [number, number] }).coordinates;
                return map.project({ lng, lat });
            });
            const linien = (treffer: { id: string; name: string }[] | undefined) =>
                new Set((treffer ?? []).map((t) => (t.name.trim() === "" ? t.id : t.name)));
            for (let y = 200; y < rahmen.height - 450; y += 7) {
                for (let x = 520; x < rahmen.width - 720; x += 7) {
                    if (knoten.some((k) => Math.hypot(k.x - x, k.y - y) < 30)) continue;
                    const nah = arcs.hit({ x, y }, 3);
                    // Auch mit der größeren Reichweite am Finger nur diese eine Linie: sonst stünde „Hier laufen N Kraftlinien“.
                    if (linien(nah).size !== 1 || linien(arcs.hit({ x, y }, 14)).size !== 1) continue;
                    const getroffen = nah![0]!;
                    // Wo verlangt, ein Abschnitt, der NICHT der Anker seiner Linie ist (Fund 2026-10-17).
                    if (nichtAnker && linieVon[getroffen.id] === getroffen.id) continue;
                    return {
                        x: rahmen.left + x,
                        y: rahmen.top + y,
                        anker: getroffen.id,
                        name: getroffen.name,
                        linie: linieVon[getroffen.id] ?? getroffen.id,
                    };
                }
            }
            return undefined;
        },
        { nichtAnker, linieVon },
    );
    if (stelle === undefined) throw new Error("keine Stelle auf genau einer Kraftlinie im Bild");
    return stelle;
}

interface Server {
    entfernt: { id: string; body: PowerlineRetireBody }[];
    /** Die übrigen Wechsel des Stands (K10): von der Karte nehmen, zurück auf die Karte, zurückholen. */
    wechsel: { art: string; id: string }[];
    /** Der Stand, den das Detail nennt, nachdem ein Wechsel geschrieben ist. */
    stand?: "abgenommen" | "geloescht" | undefined;
    /** Die Sperren anderer, die der Server nennt (K11). */
    sperren: unknown[];
    /** Der Anker der Linie zu einem Abschnitt, wie der Server ihn nennt (nach dem Laden der Liste). */
    anker(abschnitt: string): string;
}

/** `editorpanel`: Die Lasche „Editor“ steht vorn (so startet der Rechner); sonst ist das Editorpanel gemerkt zu. */
async function vorbereiten(page: Page, { editorpanel = false }: { editorpanel?: boolean } = {}): Promise<Server> {
    const server: Server = { entfernt: [], wechsel: [], sperren: [], anker: (id) => ankerVon(id) };
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
    if (!editorpanel) await editorPanelGemerktZu(page);
    // Wie der Server nennt das Detail eine Linie unter ihrem Anker (kleinster Abschnitt gleichen Namens), auch wenn ein Klick einen
    // anderen Abschnitt traf: Erst dann findet das Fenster ihre Zeile in der Liste.
    let ankerVon = (id: string): string => id;
    let netzDa = (): void => undefined;
    const netzGeladen = new Promise<void>((fertig) => {
        netzDa = fertig;
    });
    await page.route("**/api/editor/status", (route) => json(route, 200, { mapEditing: "testwelt" }));
    // Die Liste des Fensters aus dem echten Netz (lesend): je Linie eine Zeile unter ihrem Anker, wie der Server sie nennt. Das Fenster
    // zeigt Einzelheiten und die Nachfrage nur an einer Linie seiner Liste.
    await page.route("**/api/editor/powerlines", async (route) => {
        let netz: PowerlineNetwork;
        try {
            const antwort = await route.fetch({
                url: route.request().url().replace("/api/editor/powerlines", "/api/powerlines"),
            });
            netz = (await antwort.json()) as PowerlineNetwork;
        } catch {
            // 🪤 Endet der Test, während das Fenster seine Liste noch lädt, ist die Seite schon zu („Response has been disposed“):
            // Dann gibt es niemanden mehr, dem zu antworten wäre, und der Fehler gehörte nicht zum Test.
            return;
        }
        const anker = new Map<string, { id: string; name: string }>();
        for (const linie of netz.lines) {
            const gruppe = linie.name.trim() === "" ? `#${linie.id}` : linie.name;
            const bisher = anker.get(gruppe);
            if (bisher === undefined || linie.id < bisher.id) anker.set(gruppe, { id: linie.id, name: linie.name });
        }
        const gruppeVon = (linie: { id: string; name: string }) =>
            linie.name.trim() === "" ? `#${linie.id}` : linie.name;
        const jeAbschnitt = new Map(netz.lines.map((linie) => [linie.id, anker.get(gruppeVon(linie))!.id]));
        ankerVon = (id) => jeAbschnitt.get(id) ?? id;
        netzDa();
        const rows = [...anker.values()].map((linie): EditorPowerlineList["rows"][number] => ({
            id: linie.id,
            name: linie.name,
            circle: "voll",
            shape: "strang",
            segments: 1,
            nodes: 2,
            bounds: [500, 500, 600, 600],
        }));
        return json(route, 200, { rows } satisfies EditorPowerlineList);
    });
    const LINIE = /\/api\/editor\/powerlines\/([0-9a-f-]{36})(?:\/(retire|take-off-map|put-on-map|restore))?$/;
    await page.route(LINIE, async (route) => {
        const [, abschnitt, wechsel] = LINIE.exec(route.request().url())!;
        await Promise.race([netzGeladen, new Promise((weiter) => setTimeout(weiter, 5_000))]);
        const id = ankerVon(abschnitt!);
        if (wechsel !== undefined) {
            if (wechsel === "retire")
                server.entfernt.push({ id, body: route.request().postDataJSON() as PowerlineRetireBody });
            else server.wechsel.push({ art: wechsel, id });
            server.stand = wechsel === "retire" ? "geloescht" : wechsel === "take-off-map" ? "abgenommen" : undefined;
            return json(route, 200, {
                operationId: "op",
                status: "applied",
                environment: "test",
                affected: [],
                derivedWork: [],
                warnings: [],
                mapRevision: 901,
            } as unknown as OperationReceipt);
        }
        const detail: EditorPowerlineDetail = {
            id,
            name: "Gewählte Linie",
            circle: "voll",
            shape: "strang",
            segments: [
                { id, from: "a", to: "b", curve: null, labelVisible: true, revision: 5 },
                {
                    id: "f0f0f0f0-0000-4000-8000-0000000000f2",
                    from: "b",
                    to: "c",
                    curve: null,
                    labelVisible: true,
                    revision: 6,
                },
            ],
            nodes: [],
            bounds: [500, 500, 600, 600],
            ...(server.stand !== undefined ? { state: server.stand } : {}),
        };
        return json(route, 200, detail);
    });
    await page.route(/\/api\/editor\/locks(\/(heartbeat|release|lift))?(\?.*)?$/, (route) =>
        route.request().method() === "GET"
            ? json(route, 200, { locks: route.request().url().includes("kind=powerline") ? server.sperren : [] })
            : json(route, 200, { lost: [] }),
    );
    await openMap(page, EDITOR_MODE);
    await chooseView(page, "powerlines");
    await showPlace(page, GARETH, 4);
    return server;
}

const karte = (page: Page) => page.getByTestId("context-editor");

test("🔴 am Nodix nur Eigenschaften bearbeiten, Neue Kraftlinie und Kraftlinie entfernen ›; die Wahl fragt nach und legt still", async ({
    page,
}) => {
    const server = await vorbereiten(page);
    const knoten = await nodixMitLinien(page);
    await page.mouse.click(knoten.x, knoten.y, { button: "right" });

    await expect(page.getByTestId("context-editor-ort-bearbeiten")).toBeEnabled();
    // Seit K9 geht „Neue Kraftlinie“ (der eigene Fall unten zeichnet sie).
    await expect(page.getByTestId("context-editor-kraftlinie-neu")).toBeEnabled();
    await expect(page.getByTestId("context-editor-kraftlinie-entfernen")).toBeEnabled();
    for (const fort of ["ort-verschieben", "ort-verbergen", "ort-zeigen", "ort-entfernen"]) {
        await expect(page.getByTestId(`context-editor-${fort}`)).toHaveCount(0);
    }
    // Die Karte der Besucher bleibt.
    await expect(page.getByTestId("map-context-menu")).toBeVisible();

    await page.getByTestId("context-editor-kraftlinie-entfernen").click();
    const unter = page.getByTestId("context-editor-kraftlinie-entfernen-unter");
    await expect(unter.getByRole("menuitem")).toHaveText(knoten.linien.map((linie) => linie.name || "…"));
    const gewaehlt = knoten.linien.at(-1)!;
    await page.getByTestId(`context-editor-kraftlinie-entfernen#${gewaehlt.anker}`).click();
    await expect(karte(page)).toHaveCount(0);

    // Erst die Nachfrage im Kraftlinien-Fenster; geschrieben ist noch nichts.
    const frage = page.getByTestId(/^kraftlinieneditor-fenster-\d+-entfernen$/);
    await expect(frage).toContainText("Kraftlinie „Gewählte Linie“ entfernen?");
    expect(server.entfernt).toEqual([]);
    // Zwei Stufen (K10): „Ganz löschen“ wählen, der Knopf nennt die Handlung.
    await frage.getByTestId(/-entfernen-loeschen$/).click();
    await frage.getByRole("button", { name: "Ganz löschen" }).click();

    await expect.poll(() => server.entfernt.length).toBe(1);
    expect(server.entfernt[0]).toEqual({
        id: gewaehlt.anker,
        body: {
            operationId: expect.any(String),
            segments: [
                { id: gewaehlt.anker, baseRevision: 5 },
                { id: "f0f0f0f0-0000-4000-8000-0000000000f2", baseRevision: 6 },
            ],
        },
    });
    await expect(page.getByTestId("toast")).toContainText("„Gewählte Linie“ entfernt.");
    await expect(frage).toHaveCount(0);
});

test("🔴 K10: „Von der Karte nehmen“ lässt das Fenster mit dem Stand stehen; „Zurück auf die Karte“ holt die Linie wieder", async ({
    page,
}) => {
    const server = await vorbereiten(page);
    const knoten = await nodixMitLinien(page);
    await page.mouse.click(knoten.x, knoten.y, { button: "right" });
    await page.getByTestId("context-editor-kraftlinie-entfernen").click();
    const gewaehlt = knoten.linien[0]!;
    await page.getByTestId(`context-editor-kraftlinie-entfernen#${gewaehlt.anker}`).click();
    const frage = page.getByTestId(/^kraftlinieneditor-fenster-\d+-entfernen$/);
    // Vorgewählt ist die harmlose Stufe.
    await frage.getByRole("button", { name: "Von der Karte nehmen" }).click();
    await expect.poll(() => server.wechsel).toEqual([{ art: "take-off-map", id: gewaehlt.anker }]);
    expect(server.entfernt).toEqual([]);
    await expect(page.getByTestId("toast")).toContainText("„Gewählte Linie“ von der Karte genommen.");
    const stand = page.getByTestId(/^kraftlinieneditor-fenster-\d+-stand$/);
    await expect(stand).toContainText("Nicht auf der Karte.");
    await page.getByTestId(/^kraftlinieneditor-fenster-\d+-zurueck$/).click();
    await expect.poll(() => server.wechsel.at(-1)).toEqual({ art: "put-on-map", id: gewaehlt.anker });
    await expect(stand).toHaveCount(0);
});

test("🔴 K10: eine abgenommene Linie holt ↺ im Verlauf zurück auf die Karte (der Server nimmt das Abnehmen mit EINER Rücknahme zurück)", async ({
    page,
}) => {
    const server = await vorbereiten(page);
    const knoten = await nodixMitLinien(page);
    const gewaehlt = knoten.linien[0]!;
    const ABNEHMEN = "e8e8e8e8-0000-4000-8000-000000000001";
    await page.route(/\/api\/editor\/powerlines\/[0-9a-f-]{36}\/history(\?.*)?$/, (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                entries: [
                    {
                        operationId: ABNEHMEN,
                        seq: 9,
                        at: "2026-10-18T08:00:00.000Z",
                        operation: "powerline.take_off_map",
                        source: "editor",
                        summary: "Kraftlinie „Gewählte Linie“ von der Karte genommen",
                        actor: { kind: "person", name: "Thomas" },
                        objects: [
                            {
                                kind: "powerline",
                                id: gewaehlt.anker,
                                action: "powerline.taken_off_map",
                                revisionBefore: 5,
                                revisionAfter: 6,
                                changes: {
                                    active: { before: true, after: false },
                                    offMap: { before: false, after: true },
                                },
                            },
                        ],
                    },
                ],
            }),
        }),
    );
    // ↺ geht seit WI-0265 B6b über den Server: Vorprüfung und Rücknahme (restore-series), hier gestellt.
    const vorschauen: RuecknahmeVorschauBody[] = [];
    const ruecknahmen: RuecknahmeBody[] = [];
    await page.route(/\/api\/editor\/powerlines\/[0-9a-f-]{36}\/restore-series\/preview$/, (route) => {
        vorschauen.push(route.request().postDataJSON() as RuecknahmeVorschauBody);
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                ergebnis: "ok",
                membersHash: "f".repeat(64),
                mitglieder: [
                    {
                        operationId: ABNEHMEN,
                        seq: 9,
                        at: "2026-10-18T08:00:00.000Z",
                        operation: "powerline.take_off_map",
                        source: "editor",
                        actor: { kind: "person", name: "Thomas" },
                        status: "ruecknehmbar",
                        offen: true,
                        gegenstaende: [
                            {
                                kind: "powerline",
                                id: gewaehlt.anker,
                                action: "powerline.taken_off_map",
                                revisionBefore: 5,
                                revisionAfter: 6,
                                felder: ["active", "offMap"],
                            },
                        ],
                    },
                ],
                offen: [ABNEHMEN],
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
    await page.route(/\/api\/editor\/powerlines\/[0-9a-f-]{36}\/restore-series$/, (route) => {
        ruecknahmen.push(route.request().postDataJSON() as RuecknahmeBody);
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                operationId: "op",
                status: "applied",
                environment: "test",
                affected: [],
                derivedWork: [],
                warnings: [],
                mapRevision: 902,
                reverts: [ABNEHMEN],
            }),
        });
    });
    await page.mouse.click(knoten.x, knoten.y, { button: "right" });
    await page.getByTestId("context-editor-kraftlinie-entfernen").click();
    await page.getByTestId(`context-editor-kraftlinie-entfernen#${gewaehlt.anker}`).click();
    await page
        .getByTestId(/^kraftlinieneditor-fenster-\d+-entfernen$/)
        .getByRole("button", { name: "Von der Karte nehmen" })
        .click();
    await expect(page.getByTestId(/^kraftlinieneditor-fenster-\d+-stand$/)).toContainText("Nicht auf der Karte.");
    await page.getByTestId(/^kraftlinieneditor-fenster-\d+-reiter-verlauf$/).click();
    const eintrag = page.getByTestId(/^kraftlinieneditor-fenster-\d+-verlauf-eintrag$/);
    await eintrag.locator("summary").click();
    await eintrag.locator('[data-testid$="-ruecknahme"]').click();
    await eintrag
        .locator('[data-testid$="-ruecknahme-frage"]')
        .getByRole("button", { name: "Zurücknehmen", exact: true })
        .click();
    await expect.poll(() => ruecknahmen.length).toBe(1);
    expect(vorschauen).toEqual([{ members: [ABNEHMEN] }]);
    expect(ruecknahmen[0]).toEqual({
        operationId: expect.any(String),
        members: [ABNEHMEN],
        membersHash: "f".repeat(64),
    });
    // Geschrieben hat der Server, nicht die Oberfläche: kein `put-on-map` des Clients.
    expect(server.wechsel.filter((w) => w.art === "put-on-map")).toEqual([]);
});

test("Abbrechen schließt die Nachfrage, ohne zu schreiben", async ({ page }) => {
    const server = await vorbereiten(page);
    const knoten = await nodixMitLinien(page);
    await page.mouse.click(knoten.x, knoten.y, { button: "right" });
    await page.getByTestId("context-editor-kraftlinie-entfernen").click();
    await page.getByTestId(`context-editor-kraftlinie-entfernen#${knoten.linien[0]!.anker}`).click();
    const frage = page.getByTestId(/^kraftlinieneditor-fenster-\d+-entfernen$/);
    await frage.getByRole("button", { name: "Abbrechen" }).click();
    await expect(frage).toHaveCount(0);
    expect(server.entfernt).toEqual([]);
});

test("🔴 K3 Rechtsklick auf eine Linie: Eigenschaften bearbeiten, Kurve bearbeiten (Doppelklick), Kraftlinie entfernen; das Fenster nur mit den Eigenschaften", async ({
    page,
}) => {
    await vorbereiten(page);
    const stelle = await stelleAufLinie(page);
    await page.mouse.click(stelle.x, stelle.y, { button: "right" });
    await expect(page.getByTestId("context-editor-kraftlinie-eigenschaften")).toBeEnabled();
    await expect(page.getByTestId("context-editor-kraftlinie-kurve")).toBeEnabled();
    await expect(page.getByTestId("context-editor-kraftlinie-kurve")).toContainText("Doppelklick");
    await expect(page.getByTestId("context-editor-kraftlinie-linie-entfernen")).toBeEnabled();
    await expect(page.getByTestId("map-context-menu")).toBeVisible();
    await page.getByTestId("context-editor-kraftlinie-eigenschaften").click();
    // Von der Karte geöffnet: nur die Eigenschaften, die Liste eingezogen (EDIT-0003, Variante A).
    await expect(page.getByTestId(/^kraftlinieneditor-fenster-\d+-listenschalter$/)).toHaveAttribute(
        "aria-expanded",
        "false",
    );
});

test("🔴 K3 Doppelklick auf eine Linie startet „Kurve bearbeiten“ an genau ihr (R3)", async ({ page }) => {
    const server = await vorbereiten(page);
    const ziele: string[] = [];
    // Nur der Modus der Form fragt die Ziele: Der Aufruf zeigt, dass die Kurve an diesem Abschnitt startet.
    await page.route(/\/api\/editor\/powerlines\/[0-9a-f-]{36}\/targets$/, (route) => {
        ziele.push(route.request().url());
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ targets: [] }) });
    });
    const stelle = await stelleAufLinie(page);
    await page.mouse.dblclick(stelle.x, stelle.y);
    // Erst öffnet das Fenster der Linie (unter ihrem Anker), dann hängt die Kurve an; der Stub hält das Detail, bis die Liste da ist.
    await expect.poll(() => ziele.length, { timeout: 15_000 }).toBe(1);
    expect(ziele[0]).toContain(`/api/editor/powerlines/${server.anker(stelle.anker)}/targets`);
});

test("🔴 K3 Linksklick auf eine Linie öffnet im Editor-Modus den Kraftlinien-Editor an ihr, nur mit den Eigenschaften (T34 (1))", async ({
    page,
}) => {
    await vorbereiten(page, { editorpanel: true });
    const stelle = await stelleAufLinie(page);
    const fenster = page.locator('[data-testid^="kraftlinieneditor-fenster-"][data-map-overlay]');
    await expect(fenster).toHaveCount(0);
    await page.mouse.click(stelle.x, stelle.y);
    // Die Eigenschaften stehen nur an einer gewählten Linie der Liste: hier an der getroffenen, unter ihrem Namen.
    const eigenschaften = page.getByTestId(/^kraftlinieneditor-fenster-\d+-eigenschaften$/);
    await expect(eigenschaften).toBeVisible();
    if (stelle.name.trim() !== "") await expect(fenster).toContainText(stelle.name);
    await expect(page.getByTestId(/^kraftlinieneditor-fenster-\d+-listenschalter$/)).toHaveAttribute(
        "aria-expanded",
        "false",
    );
});

test("🔴 K9: „Neue Kraftlinie“ am Nodix zeichnet bis zum nächsten Nodix und schreibt EINE Operation; danach öffnet das Fenster", async ({
    page,
}) => {
    await vorbereiten(page);
    const knoten = await nodixMitLinien(page);
    // Start und ein zweiter Nodix in der freien Karte, aus der Trefferebene der Knoten, samt Lage in Karteneinheiten.
    const lage = await page.evaluate((startId) => {
        const map = globalThis.avesmapsMap!;
        const projektion = globalThis.avesmapsRenderProjection!;
        const rahmen = map.getCanvas().getBoundingClientRect();
        const alle = map.queryRenderedFeatures({ layers: ["nodix-treffer"] }).map((f) => {
            const [lng, lat] = (f.geometry as { coordinates: [number, number] }).coordinates;
            const at = map.project({ lng, lat });
            return {
                id: String(f.properties["public_id"] ?? ""),
                x: rahmen.left + at.x,
                y: rahmen.top + at.y,
                karte: projektion.fromRenderLngLat({ lng, lat }),
                frei: at.x > 500 && at.x < rahmen.width - 700 && at.y > 150 && at.y < rahmen.height - 450,
            };
        });
        const start = alle.find((k) => k.id === startId)!;
        const ziel = alle.find((k) => k.frei && k.id !== startId && Math.hypot(k.x - start.x, k.y - start.y) > 60);
        return { start, ziel };
    }, knoten.id);
    expect(lage.ziel, "ein zweiter Nodix in der freien Karte").toBeDefined();
    const ziel = lage.ziel!;
    await page.route("**/api/editor/powerline-targets", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                targets: [
                    { id: lage.start.id, kind: "place", name: "Start", ...lage.start.karte },
                    { id: ziel.id, kind: "place", name: "Ziel", ...ziel.karte },
                ],
            }),
        }),
    );
    const NEU = "f0f0f0f0-0000-4000-8000-0000000000a9";
    const angelegt: unknown[] = [];
    await page.route("**/api/editor/powerlines", (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        angelegt.push(route.request().postDataJSON());
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                operationId: "op",
                status: "applied",
                environment: "test",
                affected: [{ kind: "powerline", id: NEU, revision: 1 }],
                derivedWork: [],
                warnings: [],
                mapRevision: 903,
                publicId: NEU,
                name: "Start - Ziel",
            }),
        });
    });

    await page.mouse.click(knoten.x, knoten.y, { button: "right" });
    await expect(page.getByTestId("context-editor-kraftlinie-neu")).toBeEnabled();
    await page.getByTestId("context-editor-kraftlinie-neu").click();
    await expect(page.getByTestId("neue-kraftlinie-leiste")).toBeVisible();
    // Ein Klick ins Leere setzt nichts (R4); der Klick auf den zweiten Nodix schließt ab.
    await page.mouse.click(ziel.x + 40, ziel.y + 40);
    expect(angelegt).toEqual([]);
    await page.mouse.click(ziel.x, ziel.y);
    await expect.poll(() => angelegt.length).toBe(1);
    expect(angelegt[0]).toMatchObject({ from: lage.start.id, to: ziel.id });
    expect(angelegt[0]).not.toHaveProperty("name");
    await expect(page.getByTestId("neue-kraftlinie-leiste")).toHaveCount(0);
    await expect(page.getByTestId("toast")).toContainText("„Start - Ziel“ angelegt");
    await expect(page.locator('[data-testid^="kraftlinieneditor-fenster-"][data-map-overlay]')).toBeVisible();
});

test("🔴 Standard: „Hier hinzufügen › Neue Kraftlinie“ stellt auf die Kraftlinien und wartet auf den ersten Nodix; Esc stellt Standard zurück", async ({
    page,
}) => {
    // Betreiber 2026-10-18 zum Menü der Ansicht Standard: „Neue Kraftlinie (automatischer Wechsel zur kraftlnie)“. In der Ansicht
    // Kraftlinien steht sie unter „Bearbeiten“ am Nodix, und dort gibt es an einem Nodix kein „Hier hinzufügen“ (F21).
    await vorbereiten(page);
    const knoten = await nodixMitLinien(page);
    await page.mouse.click(knoten.x, knoten.y, { button: "right" });
    await expect(page.getByTestId("context-editor-kraftlinie-neu")).toBeVisible();
    await expect(page.getByTestId("context-editor-hier-hinzufuegen")).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.route("**/api/editor/powerline-targets", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ targets: [] }),
        }),
    );
    // Eine Stelle fern von jedem Knoten, gemessen, solange die Knoten gezeichnet sind.
    const fern = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const rahmen = map.getCanvas().getBoundingClientRect();
        const knoten = map.queryRenderedFeatures({ layers: ["nodix-treffer"] }).map((f) => {
            const [lng, lat] = (f.geometry as { coordinates: [number, number] }).coordinates;
            return map.project({ lng, lat });
        });
        for (let y = 200; y < rahmen.height - 450; y += 20)
            for (let x = 520; x < rahmen.width - 720; x += 20)
                if (knoten.every((k) => Math.hypot(k.x - x, k.y - y) > 80))
                    return { x: rahmen.left + x, y: rahmen.top + y };
        return undefined;
    });
    expect(fern, "eine Stelle fern von jedem Knoten").toBeDefined();
    await chooseView(page, "standard");
    const kachel = page.getByTestId("fan-toggle");
    await expect(kachel).toHaveAttribute("title", /Standard/);
    await page.mouse.click(fern!.x, fern!.y, { button: "right" });
    await page.getByTestId("context-editor-hier-hinzufuegen").click();
    await expect(page.getByTestId("context-editor-neuer-kraftlinienpunkt")).toHaveCount(0);
    await expect(page.getByTestId("context-editor-neue-kraftlinie")).toBeEnabled();
    const ziele = page.waitForRequest("**/api/editor/powerline-targets");
    await page.getByTestId("context-editor-neue-kraftlinie").click();
    await ziele;
    // Die Ansicht steht auf den Kraftlinien, der Modus wartet auf den ersten Nodix.
    await expect(kachel).toHaveAttribute("title", /Kraftlinien/);
    await expect(page.getByTestId("neue-kraftlinie-leiste")).toContainText("ab dem ersten gewählten Nodix");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("neue-kraftlinie-leiste")).toHaveCount(0);
    await expect(kachel).toHaveAttribute("title", /Standard/);
});

test("🔴 K9: „Hier hinzufügen › Neuer Kraftlinienpunkt“ setzt ihn an der Stelle des Rechtsklicks, EINE Operation", async ({
    page,
}) => {
    await vorbereiten(page);
    await nodixMitLinien(page);
    const gesetzt: { x: number; y: number }[] = [];
    await page.route("**/api/editor/nodices", (route) => {
        gesetzt.push(route.request().postDataJSON() as { x: number; y: number });
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                operationId: "op",
                status: "applied",
                environment: "test",
                affected: [{ kind: "nodix", id: "f0f0f0f0-0000-4000-8000-0000000000b1", revision: 1 }],
                derivedWork: [],
                warnings: [],
                mapRevision: 904,
                publicId: "f0f0f0f0-0000-4000-8000-0000000000b1",
            }),
        });
    });
    // Eine Stelle fern von jedem Knoten und jeder Linie, samt ihrer Lage in Karteneinheiten. 🪤 Die Linie trifft der Rechtsklick an den
    // gezeichneten Bögen (`avesmapsPowerlineArcs.hit`), nicht nur an der Trefferfläche der Kacheln; dort fehlt „Hier hinzufügen“ (F21).
    const stelle = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const projektion = globalThis.avesmapsRenderProjection!;
        const arcs = (
            globalThis as unknown as {
                avesmapsPowerlineArcs?: {
                    hit(punkt: { x: number; y: number }, reichweite: number): unknown[] | undefined;
                };
            }
        ).avesmapsPowerlineArcs;
        const rahmen = map.getCanvas().getBoundingClientRect();
        const knoten = map.queryRenderedFeatures({ layers: ["nodix-treffer"] }).map((f) => {
            const [lng, lat] = (f.geometry as { coordinates: [number, number] }).coordinates;
            return map.project({ lng, lat });
        });
        for (let y = 200; y < rahmen.height - 450; y += 20)
            for (let x = 520; x < rahmen.width - 720; x += 20) {
                if (knoten.some((k) => Math.hypot(k.x - x, k.y - y) < 80)) continue;
                if (map.queryRenderedFeatures([x, y], { layers: ["powerline-hit"] }).length > 0) continue;
                if ((arcs?.hit({ x, y }, 30)?.length ?? 0) > 0) continue;
                return {
                    x: rahmen.left + x,
                    y: rahmen.top + y,
                    karte: projektion.fromRenderLngLat(map.unproject([x, y])),
                };
            }
        return undefined;
    });
    expect(stelle, "eine freie Stelle").toBeDefined();
    await page.mouse.click(stelle!.x, stelle!.y, { button: "right" });
    await page.getByTestId("context-editor-hier-hinzufuegen").click();
    await expect(page.getByTestId("context-editor-neuer-kraftlinienpunkt")).toBeEnabled();
    await page.getByTestId("context-editor-neuer-kraftlinienpunkt").click();
    await expect.poll(() => gesetzt.length).toBe(1);
    expect(gesetzt[0]!.x).toBeCloseTo(stelle!.karte.x, 1);
    expect(gesetzt[0]!.y).toBeCloseTo(stelle!.karte.y, 1);
    await expect(page.getByTestId("toast")).toContainText("Kraftlinienpunkt gesetzt");
});

test("🔴 Fund 2026-10-17: „Kraftlinie entfernen“ an der Linie fragt an IHR nach und legt sie still, auch am zweiten Abschnitt", async ({
    page,
}) => {
    // Betreiber auf der Stage: „nur kraftlinie entfernen hat keinen effekt“. Die Nachfrage hing am getroffenen Abschnitt, das Fenster zeigt
    // sie nur an der Linie seines Details (ihr Anker): Sie erschien nie, und nichts wurde geschrieben.
    const server = await vorbereiten(page);
    const stelle = await stelleAufLinie(page, { nichtAnker: true });
    expect(stelle.anker).not.toBe(stelle.linie);
    await page.mouse.click(stelle.x, stelle.y, { button: "right" });
    await page.getByTestId("context-editor-kraftlinie-linie-entfernen").click();
    const frage = page.getByTestId(/^kraftlinieneditor-fenster-\d+-entfernen$/);
    await expect(frage).toContainText("Kraftlinie „Gewählte Linie“ entfernen?");
    // Zwei Stufen (K10): „Ganz löschen“ wählen, der Knopf nennt die Handlung.
    await frage.getByTestId(/-entfernen-loeschen$/).click();
    await frage.getByRole("button", { name: "Ganz löschen" }).click();
    await expect.poll(() => server.entfernt.length).toBe(1);
    expect(server.entfernt[0]!.id).toBe(stelle.linie);
    await expect(page.getByTestId("toast")).toContainText("„Gewählte Linie“ entfernt.");
});

test("🔴 K11: bearbeitet ein anderer die Linie, steht der Kasten über den Einträgen und Kurve, Anfügen, Entfernen sind gesperrt", async ({
    page,
}) => {
    const server = await vorbereiten(page);
    const stelle = await stelleAufLinie(page, { nichtAnker: true });
    // Gesperrt ist der Anker; der Rechtsklick trifft einen anderen Abschnitt derselben Linie (`sections`).
    server.sperren = [
        {
            kind: "powerline",
            id: stelle.linie,
            part: "form",
            person: { id: "a4a4a4a4-0000-4000-8000-0000000000f9", name: "Thomas" },
            since: new Date(Date.now() - 60_000).toISOString(),
            heartbeatAt: new Date().toISOString(),
            own: false,
            sections: [stelle.linie, stelle.anker],
        },
    ];
    await page.mouse.click(stelle.x, stelle.y, { button: "right" });
    await expect(karte(page)).toContainText("Thomas bearbeitet");
    for (const griff of ["kraftlinie-kurve", "kraftlinie-anfuegen", "kraftlinie-linie-entfernen"])
        await expect(page.getByTestId(`context-editor-${griff}`)).toBeDisabled();
    await expect(page.getByTestId("context-editor-kraftlinie-eigenschaften")).toBeEnabled();
});

test("🔴 T52: Rechtsklick auf einen Kraftlinienpunkt zeigt seine Griffe; mit Linie ist „Kraftlinienpunkt entfernen“ gesperrt samt Grund", async ({
    page,
}) => {
    await vorbereiten(page);
    const punkt = await kraftlinienpunktMitLinie(page);
    await page.mouse.click(punkt.x, punkt.y, { button: "right" });
    for (const griff of ["kraftlinie-herausnehmen", "kraftlinie-neu", "kraftlinie-entfernen"])
        await expect(page.getByTestId(`context-editor-${griff}`)).toBeEnabled();
    const entfernen = page.getByTestId("context-editor-kraftlinienpunkt-entfernen");
    await expect(entfernen).toBeDisabled();
    await expect(entfernen).toHaveAttribute("title", /Hier enden noch Kraftlinien/);
});

test("🔴 K5: „Kraftlinienpunkt verschieben“ zieht den Punkt auf der Punkt-Art; Loslassen schreibt EINE Operation gegen seine Revision", async ({
    page,
}) => {
    await vorbereiten(page);
    const punkt = await kraftlinienpunktMitLinie(page);
    // Die Nodices mit Revision und der Schreibweg kommen aus Stubs; Karte und Netz sind echt.
    await page.route("**/api/editor/powerline-targets", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ targets: [{ id: punkt.id, kind: "nodix", ...punkt.karte, revision: 6 }] }),
        }),
    );
    const gesendet: { baseRevision: number; x: number; y: number }[] = [];
    await page.route(/\/api\/editor\/nodices\/[0-9a-f-]{36}\/move$/, (route) => {
        gesendet.push(route.request().postDataJSON() as { baseRevision: number; x: number; y: number });
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                operationId: "op",
                status: "applied",
                environment: "test",
                affected: [],
                derivedWork: [],
                warnings: [],
                mapRevision: 902,
            }),
        });
    });
    await page.mouse.click(punkt.x, punkt.y, { button: "right" });
    await page.getByTestId("context-editor-kraftlinienpunkt-verschieben").click();
    await page.waitForFunction(
        () =>
            (globalThis.avesmapsMap?.queryRenderedFeatures({ layers: ["geometrie-anfasser-treffer"] }) ?? []).length >
            0,
        undefined,
        { timeout: 20_000 },
    );
    await settleFrame(page);
    await page.mouse.move(punkt.x, punkt.y);
    await page.mouse.down();
    await page.mouse.move(punkt.x + 30, punkt.y + 20, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => gesendet.length).toBe(1);
    expect(gesendet[0]!.baseRevision).toBe(6);
    expect(Math.hypot(gesendet[0]!.x - punkt.karte.x, gesendet[0]!.y - punkt.karte.y)).toBeGreaterThan(0.5);
    await expect(page.getByTestId("toast")).toContainText("Kraftlinienpunkt verschoben");
});

test("🔴 Nodix-Weg wie auf der Stage: nach „Kraftlinie entfernen ›“ verschwindet die Linie ohne Neuladen, auch hinter Zwischenspeichern", async ({
    page,
}) => {
    // Beim Neuladen der Bögen hing die Ebene der glühenden Knoten ein zweites Mal ein („Layer … already exists“).
    const doppelt: string[] = [];
    page.on("console", (meldung) => {
        if (meldung.type() === "error" && meldung.text().includes("already exists")) doppelt.push(meldung.text());
    });
    // Wie die Stage: Nginx hält /api/subjects/ 60 s für alle (WI-0193), das Netz der Bögen liegt mit `?r=` dauerhaft im Speicher. Ein
    // Zwischenspeicher je Adresse stellt beides nach (`page.route` schaltet den des Browsers ab). Nach dem Stilllegen liefert der „Server“
    // das Netz ohne die Linie, aber nur unter einer NEUEN Adresse.
    const entfernt = new Set<string>();
    const gespeichert = new Map<string, string>();
    await page.route(/\/api\/(powerlines(\?.*)?|subjects\/.*)$/, async (route) => {
        const url = route.request().url();
        const vorher = gespeichert.get(url);
        if (vorher !== undefined) return route.fulfill({ status: 200, contentType: "application/json", body: vorher });
        let body: string;
        try {
            const antwort = await route.fetch();
            body = await antwort.text();
        } catch {
            return;
        }
        if (/\/api\/powerlines(\?|$)/.test(url)) {
            const netz = JSON.parse(body) as PowerlineNetwork;
            body = JSON.stringify({ ...netz, lines: netz.lines.filter((l) => !entfernt.has(l.id)) });
        }
        gespeichert.set(url, body);
        return route.fulfill({ status: 200, contentType: "application/json", body });
    });
    const server = await vorbereiten(page);
    const knoten = await nodixMitLinien(page);
    const gewaehlt = knoten.linien.at(-1)!;
    // Die Abschnitte der gewählten Linie (gleicher Name), die der Stilllege-Stub aus dem Netz nimmt.
    const abschnitte = await page.evaluate(async (name) => {
        const netz = (await (await fetch("/api/powerlines")).json()) as { lines: { id: string; name: string }[] };
        return netz.lines.filter((l) => l.name === name).map((l) => l.id);
    }, gewaehlt.name);
    await page.route(/\/api\/editor\/powerlines\/[0-9a-f-]{36}\/retire$/, async (route) => {
        for (const id of abschnitte) entfernt.add(id);
        return route.fallback();
    });
    const linienAm = () =>
        page.evaluate(
            (id) =>
                (
                    globalThis as unknown as {
                        avesmapsPowerlineArcs: { linienAm(id: string): { anker: string; name: string }[] };
                    }
                ).avesmapsPowerlineArcs
                    .linienAm(id)
                    .map((l) => l.anker),
            knoten.id,
        );
    expect(await linienAm()).toContain(gewaehlt.anker);

    await page.mouse.click(knoten.x, knoten.y, { button: "right" });
    await page.getByTestId("context-editor-kraftlinie-entfernen").click();
    await page.getByTestId(`context-editor-kraftlinie-entfernen#${gewaehlt.anker}`).click();
    const frage = page.getByTestId(/^kraftlinieneditor-fenster-\d+-entfernen$/);
    // Zwei Stufen (K10): „Ganz löschen“ wählen, der Knopf nennt die Handlung.
    await frage.getByTestId(/-entfernen-loeschen$/).click();
    await frage.getByRole("button", { name: "Ganz löschen" }).click();
    await expect.poll(() => server.entfernt.length).toBe(1);
    // Ohne Neuladen: Die Bögen laden ihr Netz unter der neuen Revision, und die Linie hängt nicht mehr am Knoten.
    await expect.poll(linienAm, { timeout: 10_000 }).not.toContain(gewaehlt.anker);
    await settleFrame(page);
    expect(doppelt).toEqual([]);
});
