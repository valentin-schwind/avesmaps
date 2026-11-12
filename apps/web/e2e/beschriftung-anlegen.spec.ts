import { expect, test, type Page, type Route } from "@playwright/test";
import type {
    EditorLandscapeDetail,
    EditorLandscapeList,
    LandscapeLabelCreateBody,
    LandscapeLabelCreateReceipt,
    LandscapeLabelRetireBody,
    LandscapeRetireBody,
    OperationReceipt,
} from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap } from "./map-handle.ts";
import { editorPanelVorn } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Beschriftungen anlegen, duplizieren, löschen und zurücksetzen im Reiter „Beschriftungen“ (WI-0232, Thomas 4.1: „Beschriftungen
 * hinzufügen oder bearbeiten“). 🔴 Kein Test schreibt in die Datenbank der Entwicklung: Liste, Detail, Sperre und die Operationen
 * `label.create`, `label.retire` und `landscape.retire` kommen aus einem Stub (den Schreibweg prüft `landscape-labels.test.ts`).
 *
 * Problemfälle: „+ Neue Beschriftung“ schreibt nicht oder das Fenster liest danach nicht neu; „Duplizieren“ verliert die Vorlage;
 * „Löschen …“ löscht ohne Rückfrage; die letzte Beschriftung geht ohne den Satz der Rückfrage oder nicht über „Fläche entfernen …“
 * (Betreiber 2026-07-28 in Legacy, Editor-Orchestrierung 2026-10-19 „B“); „Position zurücksetzen“ schreibt sofort statt in den Entwurf;
 * während eines Entwurfs schreiben Neu, Duplizieren oder Löschen trotzdem.
 */
const BECKEN = "a5a5a5a5-0000-4000-8000-000000000001";
const LABEL = "a5a5a5a5-0000-4000-8000-0000000000b1";
const NEU = "a5a5a5a5-0000-4000-8000-0000000000b2";
const LISTE: EditorLandscapeList = {
    rows: [
        {
            id: BECKEN,
            name: "Schriftbecken",
            layer: "topographie",
            type: "tal",
            circle: "voll",
            areas: 1,
            labels: 1,
            order: 741,
            bounds: [440, 502, 466, 538],
        },
    ],
};
const label = (id: string, x: number, y: number) => ({
    id,
    text: "Schriftbecken",
    x,
    y,
    size: 18,
    priority: 3,
    visible: true,
    revision: 1,
});
const DETAIL: EditorLandscapeDetail = {
    id: BECKEN,
    name: "Schriftbecken",
    layer: "topographie",
    type: "tal",
    circle: "voll",
    order: 741,
    clickLocked: false,
    areas: [
        {
            id: "a5a5a5a5-0000-4000-8000-0000000000a1",
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
    labels: [{ ...label(LABEL, 445, 510), primary: true }],
    neighbors: [],
    revision: 1,
};

interface Server {
    detail: EditorLandscapeDetail;
    angelegt: LandscapeLabelCreateBody[];
    geloescht: LandscapeLabelRetireBody[];
    entfernt: LandscapeRetireBody[];
}

async function oeffne(page: Page, detail: EditorLandscapeDetail = DETAIL): Promise<Server> {
    const server: Server = { detail, angelegt: [], geloescht: [], entfernt: [] };
    const json = (route: Route, status: number, body: unknown) =>
        route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const quittung = (): OperationReceipt => ({
        operationId: "op",
        status: "applied",
        environment: "test",
        affected: [{ kind: "landscape", id: BECKEN, revision: server.detail.revision }],
        derivedWork: [],
        warnings: [],
        mapRevision: 902,
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
    await page.route("**/api/editor/status", (route) => json(route, 200, { mapEditing: "testwelt" }));
    await page.route("**/api/editor/landscapes", (route) =>
        json(route, 200, { rows: [{ ...LISTE.rows[0]!, labels: server.detail.labels.length }] }),
    );
    await page.route(`**/api/editor/landscapes/${BECKEN}`, (route) => json(route, 200, server.detail));
    await page.route(`**/api/editor/landscapes/${BECKEN}/labels`, (route) => {
        const body = route.request().postDataJSON() as LandscapeLabelCreateBody;
        server.angelegt.push(body);
        const [x, y] = body.position ?? [453, 520];
        server.detail = {
            ...server.detail,
            labels: [...server.detail.labels, label(NEU, x, y)],
            revision: server.detail.revision + 1,
        };
        return json(route, 200, { ...quittung(), publicId: NEU } satisfies LandscapeLabelCreateReceipt);
    });
    await page.route(new RegExp(`/api/editor/landscapes/${BECKEN}/labels/[0-9a-f-]{36}/retire$`), (route) => {
        const body = route.request().postDataJSON() as LandscapeLabelRetireBody;
        server.geloescht.push(body);
        const id = route.request().url().split("/labels/")[1]!.split("/")[0]!;
        server.detail = {
            ...server.detail,
            labels: server.detail.labels.filter((l) => l.id !== id),
            revision: server.detail.revision + 1,
        };
        return json(route, 200, quittung());
    });
    await page.route(`**/api/editor/landscapes/${BECKEN}/retire`, (route) => {
        server.entfernt.push(route.request().postDataJSON() as LandscapeRetireBody);
        return json(route, 200, quittung());
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
                person: { id: "a5a5a5a5-0000-4000-8000-0000000000f1", name: "Rondrikan" },
                since: "2026-10-19T12:00:00.000Z",
                heartbeatAt: "2026-10-19T12:00:00.000Z",
                own: true,
            },
        });
    });
    await page.route(`**/api/editor/landscapes/${BECKEN}/history**`, (route) => json(route, 200, { entries: [] }));
    await openMap(page, EDITOR_MODE);
    await editorPanelVorn(page);
    await page.getByTestId("editorpanel-kachel-regionen").click();
    await page.getByTestId("editorpanel-verb").click();
    await page
        .locator('[data-testid^="landschaftseditor-"][data-testid$="-liste"]')
        .getByRole("option", { name: /Schriftbecken/ })
        .click();
    await page.getByRole("tab", { name: /Beschriftungen/ }).click();
    return server;
}

test.use({ viewport: { width: 1920, height: 1080 } });

const knopf = (page: Page, rest: string) => page.getByTestId(new RegExp(`^landschaftseditor-fenster-\\d+-${rest}$`));
const beschriftungen = (page: Page) => page.getByTestId(/^landschaftseditor-fenster-\d+-beschriftung$/);

test("🔴 „+ Neue Beschriftung“ schreibt sofort, das Fenster liest neu und zeigt sie; „Duplizieren“ schickt die Vorlage", async ({
    page,
}) => {
    const server = await oeffne(page);
    await expect(beschriftungen(page)).toHaveCount(1);
    await knopf(page, "beschriftung-neu").click();
    await expect(beschriftungen(page)).toHaveCount(2);
    expect(server.angelegt).toHaveLength(1);
    expect(server.angelegt[0]).toMatchObject({ baseRevision: 1 });
    expect(server.angelegt[0]!.position).toBeUndefined();

    await knopf(page, "beschriftung-0-duplizieren").click();
    await expect.poll(() => server.angelegt.length).toBe(2);
    expect(server.angelegt[1]).toMatchObject({ baseRevision: 2, from: LABEL });
    // Unter dem Original (y wächst nach Norden), an seiner x-Stelle.
    expect(server.angelegt[1]!.position![0]).toBeCloseTo(445, 5);
    expect(server.angelegt[1]!.position![1]).toBeLessThan(510);
});

test("🔴 „Löschen …“ fragt; bei mehreren nur die Beschriftung, die letzte geht über „Fläche entfernen …“ mit dem Satz der Rückfrage", async ({
    page,
}) => {
    const server = await oeffne(page, { ...DETAIL, labels: [...DETAIL.labels, label(NEU, 455, 525)] });
    await knopf(page, "beschriftung-1-loeschen").click();
    const frage = knopf(page, "beschriftung-1-loeschfrage");
    await expect(frage).toContainText("Beschriftung 2 löschen?");
    expect(server.geloescht).toHaveLength(0);
    await frage.getByRole("button", { name: "Löschen" }).click();
    await expect(beschriftungen(page)).toHaveCount(1);
    expect(server.geloescht).toEqual([expect.objectContaining({ baseRevision: 1, labelRevision: 1 })]);

    await knopf(page, "beschriftung-0-loeschen").click();
    const letzte = knopf(page, "beschriftung-0-loeschfrage");
    await expect(letzte).toContainText(
        "Das ist die letzte Beschriftung von „Schriftbecken“. Die Landschaft mit ihrer Fläche wird mit entfernt.",
    );
    await letzte.getByRole("button", { name: "Entfernen" }).click();
    await expect.poll(() => server.entfernt.length).toBe(1);
    expect(server.entfernt[0]).toMatchObject({ stage: "retire", baseRevision: 2 });
    expect(server.geloescht).toHaveLength(1);
});

test("🔴 „Position zurücksetzen“ ist ein Schritt im Entwurf; solange er steht, sind Neu, Duplizieren und Löschen gesperrt", async ({
    page,
}) => {
    const server = await oeffne(page);
    await knopf(page, "beschriftung-0-zuruecksetzen").click();
    await expect(page.getByTestId("landschaft-leiste")).toBeVisible();
    expect(server.angelegt).toHaveLength(0);
    for (const name of ["beschriftung-neu", "beschriftung-0-duplizieren", "beschriftung-0-loeschen"])
        await expect(knopf(page, name)).toBeDisabled();
    await expect(knopf(page, "beschriftung-neu").locator("..")).toContainText("Erst „Fertig“ oder „Verwerfen“.");
});
