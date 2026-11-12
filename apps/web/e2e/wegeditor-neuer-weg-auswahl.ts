import { expect, type Locator, type Page, type Route } from "@playwright/test";
import type { EditorPathList, EditorPathStreet, PathNeuerWegBody } from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap } from "./map-handle.ts";
import { GRATENFELS_LAGE, editorPanelAuf } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Stubs für „Auswahl zu neuem Weg“ (WI-0252), geteilt von `wegeditor-auswahl-zu-neuem-weg.spec.ts` und der Telefonfassung
 * (`wegeditor-auswahl.touch.spec.ts`). 🔴 Nichts geht an den Server der Entwicklung: Liste, Straßen und der Schreibweg kommen von hier.
 *
 * Drei Wege: die Reichsstraße 3 (zwei Abschnitte, einer mit Artikel), der Nordweg (ein Abschnitt) und ein namenloser Pfad (ein Griff).
 */

export const RS = "c5c5c5c5-0000-4000-8000-0000000002a1";
export const RS2 = "c5c5c5c5-0000-4000-8000-0000000002a2";
export const NORD = "c5c5c5c5-0000-4000-8000-0000000002b1";
export const PFAD = "c5c5c5c5-0000-4000-8000-0000000002c1";
const G = GRATENFELS_LAGE;

export const LISTE: EditorPathList = {
    rows: [
        {
            id: RS,
            name: "Reichsstraße 3",
            subtype: "Reichsstrasse",
            isBach: false,
            circle: "halb-rechts",
            segments: 2,
            wiki: { url: "https://de.wiki-aventurica.de/wiki/Reichsstra%C3%9Fe_3", title: "Reichsstraße 3" },
            wikiSegments: 1,
            bounds: [G.x - 20, G.y - 10, G.x + 20, G.y + 10],
        },
        { id: NORD, name: "Nordweg", subtype: "Weg", isBach: false, circle: "halb-rechts", segments: 1 },
        { id: PFAD, name: "Pfad-3443", subtype: "Pfad", isBach: false, circle: "halb-rechts", segments: 1 },
    ],
};

export const strasse = (id: string): EditorPathStreet => {
    if (id === NORD)
        return {
            id: NORD,
            name: "Nordweg",
            subtype: "Weg",
            isBach: false,
            circle: "halb-rechts",
            labelVisible: true,
            segments: [
                { id: NORD, revision: 3, labelVisible: true, wiki: false, points: 4, art: "Weg", von: "Rossol" },
            ],
        };
    if (id === PFAD)
        return {
            id: PFAD,
            name: "Pfad-3443",
            subtype: "Pfad",
            isBach: false,
            circle: "halb-rechts",
            labelVisible: true,
            segments: [{ id: PFAD, revision: 2, labelVisible: true, wiki: false, points: 2, art: "Pfad" }],
        };
    return {
        id: RS,
        name: "Reichsstraße 3",
        subtype: "Reichsstrasse",
        isBach: false,
        circle: "halb-rechts",
        labelVisible: null,
        wiki: { url: "https://de.wiki-aventurica.de/wiki/Reichsstra%C3%9Fe_3", title: "Reichsstraße 3" },
        segments: [
            {
                id: RS,
                revision: 4,
                labelVisible: true,
                wiki: true,
                points: 7,
                art: "Reichsstrasse",
                von: "Calmir",
                bis: "Rossol",
            },
            {
                id: RS2,
                revision: 2,
                labelVisible: false,
                wiki: false,
                points: 3,
                art: "Reichsstrasse",
                von: "Rossol",
                bis: "Gareth",
            },
        ],
        bounds: [G.x - 20, G.y - 10, G.x + 20, G.y + 10],
    };
};

const json = (route: Route, body: unknown) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

/** Öffnet das Wege-Fenster als Editor mit den drei Wegen; gibt die Körper zurück, die „Zu neuem Weg“ schickt. */
export async function oeffneMitStubs(page: Page): Promise<PathNeuerWegBody[]> {
    const gesendet: PathNeuerWegBody[] = [];
    let umbenannt: string | undefined;
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
    await page.route("**/api/editor/paths", (route) =>
        json(
            route,
            umbenannt === undefined
                ? LISTE
                : {
                      rows: [
                          {
                              ...LISTE.rows[0]!,
                              id: NORD,
                              name: umbenannt,
                              segments: 4,
                              wiki: undefined,
                              wikiSegments: undefined,
                          },
                      ],
                  },
        ),
    );
    await page.route(/\/api\/editor\/paths\/[0-9a-f-]{36}\/street$/, (route) => {
        const id = route.request().url().split("/").at(-2)!;
        const s = strasse(id === RS2 ? RS : id);
        if (umbenannt === undefined) return json(route, s);
        // Nach dem Schreiben: EIN Weg aus allen vier Abschnitten unter dem neuen Namen, ohne Artikel.
        const alle = [strasse(RS), strasse(NORD), strasse(PFAD)].flatMap((x) => x.segments);
        return json(route, {
            ...strasse(NORD),
            name: umbenannt,
            segments: alle.map((a) => ({ ...a, wiki: false, revision: a.revision + 1 })),
        });
    });
    await page.route(/\/api\/editor\/paths\/[0-9a-f-]{36}\/history(\?.*)?$/, (route) => json(route, { entries: [] }));
    await page.route(/\/api\/editor\/locks(\/(heartbeat|release|lift))?(\?.*)?$/, (route) =>
        route.request().method() === "GET" ? json(route, { locks: [] }) : json(route, { lost: [] }),
    );
    await page.route("**/api/editor/paths/neuer-weg", (route) => {
        const body = route.request().postDataJSON() as PathNeuerWegBody;
        gesendet.push(body);
        umbenannt = body.name;
        return json(route, {
            operationId: body.operationId,
            status: "applied",
            environment: "development",
            affected: body.sections.map((a) => ({ kind: "path", id: a.publicId, revision: a.baseRevision + 1 })),
            derivedWork: [],
            warnings: [],
            mapRevision: 4252,
            anker: NORD,
        });
    });
    await openMap(page, EDITOR_MODE);
    await editorPanelAuf(page);
    await page.getByTestId("editorpanel-kachel-wege").click();
    await page.getByTestId("editorpanel-verb").click();
    await expect(page.locator('dialog[open][data-testid^="wegeditor-"]')).toHaveCount(1);
    return gesendet;
}

export const offen = (page: Page): Locator => page.locator('dialog[open][data-testid^="wegeditor-"]');
export const zeile = (page: Page, name: string | RegExp): Locator =>
    offen(page)
        .locator('[data-testid$="-liste"]')
        .first()
        .getByRole("option", { name: typeof name === "string" ? new RegExp(name) : name });
