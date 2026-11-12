import { expect, test, type Page } from "@playwright/test";
import type { EditorPathStreet, StrasseStreckeAntwort, StrasseZuweisenBody } from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap } from "./map-handle.ts";
import { GRATENFELS_LAGE, editorPanelVorn } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Der Straßen-Assistent (WI-0310, Entwurf Fassung 3): der Knopf in der Wiki-Box des Wegs, das Fenster mit den Orten aus dem Wiki, die Strecke
 * je Ortspaar, die Vorschau „Zuweisen würde schreiben“ und EINE Operation. 🔴 Kein Test schreibt in die Datenbank der Entwicklung: Liste,
 * Straße, Wiki-Box, Strecke und Zuweisen kommen aus Stubs (den Server prüfen `strasse-strecke.test.ts` und `strasse-zuweisen.test.ts`).
 *
 * Problemfälle: Der Knopf fehlt oder steht ohne Schreibrecht da; das Fenster fragt die Strecke nicht oder mit fremden Orten; ein Abschnitt
 * einer anderen Straße ist von selbst angehakt; „Zuweisen …“ schreibt ohne Vorschau; die Vorschau verspricht Linien oder Wegtypen; der
 * Körper nennt fertige oder abgehakte Abschnitte, entfernt ungefragt Abschnitte abseits oder vergisst die Quellen.
 */

const RS = "c5c5c5c5-0000-4000-8000-0000000000a1";
const RS2 = "c5c5c5c5-0000-4000-8000-0000000000a2";
const LUECKE = "c5c5c5c5-0000-4000-8000-0000000000b1";
const FREMD = "c5c5c5c5-0000-4000-8000-0000000000b2";
const ABSEITS = "c5c5c5c5-0000-4000-8000-0000000000b3";
const CALMIR = "d6d6d6d6-0000-4000-8000-000000000001";
const ROSSOL = "d6d6d6d6-0000-4000-8000-000000000002";
const GARETH = "d6d6d6d6-0000-4000-8000-000000000003";
const G = GRATENFELS_LAGE;
const ARTIKEL = {
    key: "reichsstrasse-3",
    url: "https://de.wiki-aventurica.de/wiki/Reichsstra%C3%9Fe_3",
    name: "Reichsstraße 3",
};

const STRASSE: EditorPathStreet = {
    id: RS,
    name: "Reichsstraße 3",
    subtype: "Reichsstrasse",
    isBach: false,
    circle: "voll",
    labelVisible: true,
    wiki: { url: ARTIKEL.url, title: ARTIKEL.name },
    segments: [
        { id: RS, revision: 4, labelVisible: true, wiki: true, points: 7, bounds: [G.x - 20, G.y - 10, G.x, G.y] },
        { id: RS2, revision: 2, labelVisible: true, wiki: true, points: 3, bounds: [G.x, G.y, G.x + 20, G.y + 10] },
        { id: ABSEITS, revision: 6, labelVisible: true, wiki: true, points: 3, bounds: [G.x, G.y, G.x + 8, G.y + 30] },
    ],
    bounds: [G.x - 20, G.y - 10, G.x + 20, G.y + 30],
};

const linie = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
    [x0, y0],
    [x1, y1],
];
const abschnitt = (
    id: string,
    name: string,
    zustand: StrasseStreckeAntwort["abschnitte"][string]["zustand"],
    coordinates: [number, number][],
    wiki: { key: string; name: string } | null,
    quellen: number,
): StrasseStreckeAntwort["abschnitte"][string] => ({
    id,
    revision: 3,
    name,
    subtype: "Reichsstrasse",
    laenge: 12.5,
    zustand,
    wiki,
    quellen,
    coordinates,
});

/** Calmir → Rossol über RS (fertig) und die Lücke (ohne Namen), Rossol → Gareth über RS2 (fertig) und einen Abschnitt einer anderen Straße. */
const STRECKE: StrasseStreckeAntwort = {
    artikel: { ...ARTIKEL, verlauf: "Calmir → Rossol → Gareth" },
    name: "Reichsstraße 3",
    orte: [
        { id: CALMIR, name: "Calmir", x: G.x - 20, y: G.y - 10 },
        { id: ROSSOL, name: "Rossol", x: G.x, y: G.y },
        { id: GARETH, name: "Gareth", x: G.x + 30, y: G.y + 10 },
    ],
    unbekannt: [],
    teile: [
        { von: CALMIR, nach: ROSSOL, laenge: 25, umweg: 1.1, abschnitte: [RS, LUECKE] },
        { von: ROSSOL, nach: GARETH, laenge: 25, umweg: 1.05, abschnitte: [RS2, FREMD] },
    ],
    abschnitte: {
        [RS]: abschnitt(RS, "Reichsstraße 3", "fertig", linie(G.x - 20, G.y - 10, G.x - 10, G.y - 5), ARTIKEL, 2),
        [LUECKE]: abschnitt(LUECKE, "Strasse-11192", "name", linie(G.x - 10, G.y - 5, G.x, G.y), null, 0),
        [RS2]: abschnitt(RS2, "Reichsstraße 3", "fertig", linie(G.x, G.y, G.x + 20, G.y + 10), ARTIKEL, 2),
        [FREMD]: abschnitt(FREMD, "Alte Zollstraße", "fremd", linie(G.x + 20, G.y + 10, G.x + 30, G.y + 10), null, 0),
        [ABSEITS]: abschnitt(ABSEITS, "Reichsstraße 3", "fertig", linie(G.x, G.y, G.x + 8, G.y + 30), ARTIKEL, 2),
    },
    abseits: [ABSEITS],
    vorschlaege: [],
    quellen: [
        { id: "41", titel: "Geographia Aventurica" },
        { id: "42", titel: "Reich des Schwertes" },
    ],
};

const SCHREIBEN = ["use_editor_menu", "edit_map_objects", "edit_map_geometry"];
const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

async function stubs(page: Page, rechte: string[]): Promise<{ strecke: unknown[]; zuweisen: StrasseZuweisenBody[] }> {
    const gefragt = { strecke: [] as unknown[], zuweisen: [] as StrasseZuweisenBody[] };
    await stubAdmin(page, { capabilities: rechte, role: rechte.includes("edit_map_objects") ? "editor" : "reviewer" });
    await page.route("**/api/editor/status", (route) => route.fulfill(json({ mapEditing: "testwelt" })));
    await page.route("**/api/editor/paths", (route) =>
        route.fulfill(
            json({
                rows: [
                    {
                        id: RS,
                        name: "Reichsstraße 3",
                        subtype: "Reichsstrasse",
                        isBach: false,
                        circle: "voll",
                        segments: 3,
                        bounds: STRASSE.bounds,
                    },
                ],
            }),
        ),
    );
    await page.route(/\/api\/editor\/paths\/[0-9a-f-]{36}\/street$/, (route) => route.fulfill(json(STRASSE)));
    await page.route(/\/api\/editor\/wiki-box\/weg\/[0-9a-f-]{36}(\?.*)?$/, (route) =>
        route.fulfill(
            json({
                art: "weg",
                id: RS,
                name: "Reichsstraße 3",
                artikel: ARTIKEL,
                sync: { moeglich: false, grund: "kein_stand", laeuft: false, letzter: null, fehler: null },
                weitere: [],
            }),
        ),
    );
    await page.route("**/api/editor/paths/strassen-assistent/strecke", (route) => {
        gefragt.strecke.push(route.request().postDataJSON());
        return route.fulfill(json(STRECKE));
    });
    await page.route("**/api/editor/paths/strassen-assistent/zuweisen", (route) => {
        const body = route.request().postDataJSON() as StrasseZuweisenBody;
        gefragt.zuweisen.push(body);
        return route.fulfill(
            json({
                operationId: body.operationId,
                status: "applied",
                environment: "development",
                affected: body.sections.map((s) => ({ kind: "path", id: s.publicId, revision: s.baseRevision + 1 })),
                derivedWork: [],
                warnings: [],
                mapRevision: 92,
                anker: RS,
            }),
        );
    });
    return gefragt;
}

async function oeffne(page: Page): Promise<void> {
    await openMap(page, EDITOR_MODE);
    await editorPanelVorn(page);
    await page.getByTestId("editorpanel-kachel-wege").click();
    const verb = page.getByTestId("editorpanel-verb");
    await expect(verb).toContainText("Wege bearbeiten");
    await verb.click();
    await page
        .locator('[data-testid^="wegeditor-"][data-testid$="-liste"]')
        .getByText("Reichsstraße 3")
        .first()
        .click();
}

const id = (s: string) => new RegExp(`^wegeditor-fenster-\\d+-${s}$`);

test.describe("Straßen-Assistent (WI-0310)", () => {
    test.use({ viewport: { width: 1920, height: 1080 } });

    test("🔴 Wiki-Box „Straßen-Assistent“: Orte aus dem Wiki, ⇄ nicht angehakt, Vorschau ohne Linien; „Wirklich zuweisen“ schreibt EINE Operation nur mit der Lücke", async ({
        page,
    }) => {
        const gefragt = await stubs(page, SCHREIBEN);
        await oeffne(page);
        const knopf = page.getByTestId(id("wiki-assistent"));
        await expect(knopf).toBeEnabled();
        await knopf.click();

        // Das Fenster fragt die Strecke am Anker, ohne eigene Orte: Die kommen aus dem Verlauf des Artikels.
        await expect.poll(() => gefragt.strecke.length).toBeGreaterThan(0);
        expect(gefragt.strecke[0]).toMatchObject({ anker: RS });
        expect(gefragt.strecke[0]).not.toHaveProperty("orte");
        await expect(page.getByTestId(id("assistent-ort"))).toHaveText([/Calmir/, /Rossol/, /Gareth/]);

        // Vier Abschnitte auf der Strecke; der der anderen Straße ist nicht angehakt.
        const zeilen = page.getByTestId(id("assistent-abschnitt"));
        await expect(zeilen).toHaveCount(4);
        const fremd = zeilen.filter({ hasText: "Alte Zollstraße" });
        await expect(fremd.getByTestId(id("assistent-haken"))).not.toBeChecked();
        await expect(page.getByTestId(id("assistent-abseits"))).toBeVisible();

        // „Zuweisen …“ zeigt erst, was geschrieben würde; nichts ist gesendet.
        await page.getByTestId(id("assistent-zuweisen")).click();
        const schreibt = page.getByTestId(id("assistent-schreibt"));
        await expect(schreibt).toContainText("Linien, Wegtyp, Reisemittel und Reisezeiten bleiben, wie sie sind.");
        await expect(schreibt).toContainText("↺ nimmt alles zurück");
        await expect(page.getByTestId(id("assistent-wirklich"))).toBeInViewport();
        expect(gefragt.zuweisen).toHaveLength(0);
        await page.screenshot({ path: "test-results/strassen-assistent-vorschau.png" });

        await page.getByTestId(id("assistent-wirklich")).click();
        await expect.poll(() => gefragt.zuweisen.length).toBe(1);
        const body = gefragt.zuweisen[0]!;
        expect(body.name).toBe("Reichsstraße 3");
        expect(body.key).toBe("reichsstrasse-3");
        expect(body.quellen).toBe(true);
        expect(body.sections.map((s) => s.publicId)).toEqual([LUECKE]);
        expect(body.entfernen).toEqual([]);
        await expect(page.getByTestId(id("assistent-fertig"))).toContainText("Zugewiesen.");
        await page.screenshot({ path: "test-results/strassen-assistent-zugewiesen.png" });
    });

    test("ohne Schreibrecht steht kein Knopf „Straßen-Assistent“ in der Wiki-Box", async ({ page }) => {
        const rechte = ["use_editor_menu"];
        await stubs(page, rechte);
        await oeffne(page);
        await expect(page.getByTestId(id("wiki-artikel"))).toBeVisible();
        await expect(page.getByTestId(id("wiki-assistent"))).toHaveCount(0);
    });
});
