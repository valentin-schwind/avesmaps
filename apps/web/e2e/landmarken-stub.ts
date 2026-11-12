import { expect, type Page, type Route } from "@playwright/test";
import type {
    EditorLandscapeList,
    EditorPeakDetail,
    PeakCreateBody,
    PeakCreateReceipt,
    PeakUpdateBody,
} from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap } from "./map-handle.ts";
import { editorPanelVorn } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Der Stub der Landmarken (WI-0271 L4) für `landschaftseditor-landmarken.spec.ts` und `landschaftseditor-landmarken.touch.spec.ts`: Liste mit zwei
 * Flächen, einem Berggipfel und einer Höhle, Detail, Wiki-Box, Quellen, Verlauf und die Schreibwege. Kein Aufruf erreicht eine Datenbank.
 */

export const KOSCH = { x: 450, y: 560 };
export const ZINNE = "c8c8c8c8-0271-4000-8000-000000000001";
export const HOEHLE = "c8c8c8c8-0271-4000-8000-000000000002";
export const NEU = "c8c8c8c8-0271-4000-8000-0000000000a7";

/** Die Liste des Stubs (auch für `landschaftseditor-kandidaten.spec.ts`, das die Kandidaten dazulegt). */
export const LISTE: EditorLandscapeList = {
    rows: [
        {
            id: "c8c8c8c8-0271-4000-8000-0000000000b1",
            name: "Koschberge",
            layer: "topographie",
            type: "gebirge",
            circle: "voll",
            order: 1,
            areas: 1,
            labels: 1,
            wiki: { url: "https://de.wiki-aventurica.de/wiki/Koschberge" },
        },
        {
            id: "c8c8c8c8-0271-4000-8000-0000000000b2",
            name: "Angbarer See",
            layer: "topographie",
            type: "see",
            circle: "halb-rechts",
            order: 2,
            areas: 1,
        },
    ],
    peaks: [
        {
            id: ZINNE,
            name: "Probezinne",
            subtype: "berggipfel",
            height: 3200,
            circle: "halb-rechts",
            position: [KOSCH.x, KOSCH.y],
        },
        {
            id: HOEHLE,
            name: "Probehöhle",
            subtype: "hoehle",
            merkmale: ["heilig"],
            circle: "halb-rechts",
            position: [KOSCH.x + 4, KOSCH.y + 3],
        },
    ],
};

export interface LandmarkenServer {
    gesendet: PeakUpdateBody[];
    angelegt: PeakCreateBody[];
}

export async function landmarkenStub(page: Page): Promise<LandmarkenServer> {
    const server: LandmarkenServer = { gesendet: [], angelegt: [] };
    const json = (route: Route, status: number, body: unknown) =>
        route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    await stubAdmin(page, {
        capabilities: [
            "use_editor_menu",
            "edit_map_objects",
            "edit_map_geometry",
            "manage_sources",
            "edit_territories",
            "edit_landscapes",
            "edit_territory_form",
            "edit_landscape_form",
            "edit_mountains",
        ],
        role: "editor",
    });
    await page.route("**/api/editor/status", (route) => json(route, 200, { mapEditing: "testwelt" }));
    await page.route("**/api/editor/landscapes", (route) => json(route, 200, LISTE));
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
                since: "2026-10-31T12:00:00.000Z",
                heartbeatAt: "2026-10-31T12:00:00.000Z",
                own: true,
            },
        });
    });
    await page.route("**/api/editor/wiki-box/gipfel/*", (route) =>
        json(route, 200, {
            art: "gipfel",
            id: route.request().url().split("/").at(-1),
            name: "Probehöhle",
            artikel: null,
            sync: { moeglich: false, grund: "kein_artikel", laeuft: false, letzter: null, fehler: null },
        }),
    );
    await page.route(/\/api\/editor\/inhalte\/traeger\/peak\/[0-9a-f-]{36}\/quellen$/, (route) =>
        json(route, 200, {
            traeger: { kind: "peak", id: route.request().url().split("/").at(-2), name: "Probehöhle", aktiv: true },
            aenderbar: true,
            wiki: null,
            quellen: [],
        }),
    );
    await page.route(/\/api\/editor\/peaks\/[0-9a-f-]{36}\/history/, (route) => json(route, 200, { entries: [] }));
    await page.route(/\/api\/editor\/peaks$/, (route) => {
        const body = route.request().postDataJSON() as PeakCreateBody;
        server.angelegt.push(body);
        const quittung: PeakCreateReceipt = {
            operationId: body.operationId,
            status: "applied",
            environment: "development",
            affected: [{ kind: "peak", id: NEU, revision: 1 }],
            derivedWork: [],
            warnings: [],
            mapRevision: 4712,
            publicId: NEU,
            name: "Landmarke-001",
        };
        return json(route, 200, quittung);
    });
    await page.route(/\/api\/editor\/peaks\/[0-9a-f-]{36}$/, (route) => {
        const id = route.request().url().split("/").at(-1)!;
        if (route.request().method() === "PATCH") {
            server.gesendet.push(route.request().postDataJSON() as PeakUpdateBody);
            return json(route, 200, {
                operationId: "op",
                status: "applied",
                environment: "development",
                affected: [{ kind: "peak", id, revision: 2 }],
                derivedWork: [],
                warnings: [],
                mapRevision: 4711,
            });
        }
        const detail: EditorPeakDetail =
            id === ZINNE
                ? {
                      id,
                      name: "Probezinne",
                      subtype: "berggipfel",
                      height: 3200,
                      showName: true,
                      position: [KOSCH.x, KOSCH.y],
                      revision: 1,
                      mountains: [{ id: "c8c8c8c8-0271-4000-8000-0000000000b1", name: "Koschberge" }],
                  }
                : {
                      id,
                      name: id === NEU ? "Landmarke-001" : "Probehöhle",
                      subtype: id === NEU ? "quelle" : "hoehle",
                      ...(id === NEU ? {} : { merkmale: ["heilig" as const] }),
                      showName: true,
                      position: [KOSCH.x + 4, KOSCH.y + 3],
                      revision: 1,
                  };
        return json(route, 200, detail);
    });
    return server;
}

/** Das Derographie-Fenster über das Editorpanel, in der Ebene Topographie. */
export async function oeffneLandmarkenListe(page: Page): Promise<ReturnType<Page["locator"]>> {
    await openMap(
        page,
        `${EDITOR_MODE}#x=${String(KOSCH.x)}&y=${String(KOSCH.y)}&z=6&view=landscapes&layer=topographie`,
    );
    if ((page.viewportSize()?.width ?? 1920) >= 768) await editorPanelVorn(page);
    else {
        // Am Telefon trägt das offene Panel keine Lasche mehr (`editor-panel.touch.spec.ts`).
        await page.getByTestId("editor-panel-tab").click();
        await expect(page.getByTestId("editor-panel")).toBeVisible();
    }
    await page.getByTestId("editorpanel-kachel-regionen").click();
    await page.getByTestId("editorpanel-verb").click();
    return page.locator('[data-testid^="landschaftseditor-"][data-testid$="-liste"]');
}
