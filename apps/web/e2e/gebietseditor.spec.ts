import { expect, test, type Page } from "@playwright/test";
import {
    AVENTURIA_POLITICAL_CARTOGRAPHY,
    politicalMinZoom,
    type EditorTerritoryDetail,
    type EditorTerritoryHierarchy,
    type EditorTerritoryList,
    type RuecknahmeBody,
    type RuecknahmePruefung,
    type RuecknahmeVorschauBody,
} from "@avesmaps3d/shared";
import { EDITOR_MODE, chooseView, openMap } from "./map-handle.ts";
import { editorPanelVorn } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Der Gebietseditor, lesend (WI-0209 Paket A3; EDIT-0005 §3; Blatt „Herrschaftsgebiete“). 🔴 Kein Test schreibt in die Datenbank der
 * Entwicklung: Liste, Detail und Hierarchie kommen aus einem Stub (den echten Leseweg samt „N2 im Teilbaum“ prüft
 * `apps/server/test/editor-territories-routes.test.ts` gegen die Testdatenbank, die Rechnung `test/gebiet-hierarchie.test.ts`).
 *
 * Problemfälle: „Herrschaftsgebiete“ bleibt „später“; das Verb öffnet einen anderen Editor; der Baum zeigt Legacys Kreis nicht; ein Feld
 * fehlt (Hauptstadt als Ort, Sitz aus dem Wiki, eigener Wert ✎, Farbe, Deckkraft, Wappen); der Reiter „Hierarchie“ zeigt nicht, was die
 * Karte je Band zeigt, oder verschweigt eine Lücke; das Fenster bietet Speichern an, obwohl es nur liest.
 *
 * D2 (Zoombänder bearbeiten im Reiter „Hierarchie“): Die Sperre und das Schreiben kommen ebenfalls aus Stubs; den Server prüft
 * `apps/server/test/territory-display.test.ts` im Wegwerf-Cluster.
 */
const ID = (n: number): string => `a3a3a3a3-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const REICH = ID(1);
const PROVINZ = ID(2);
const GRAFSCHAFT = ID(3);
const LUECKE = ID(4);
const LEER = ID(5);
const BORNLAND = ID(6);
/** Ganz gelöscht (D3); steht nur unter der Facette „Gelöscht“ (T54). */
const WUESTENEI = ID(7);
const STADT = ID(0x200);

const LISTE: EditorTerritoryList = {
    yearBf: 1049,
    rows: [
        {
            id: REICH,
            name: "Mittelreich",
            type: "Kaiserreich",
            circle: "halb",
            minZoom: 0,
            maxZoom: 1,
            color: "#c0392b",
            order: 0,
            bounds: [400, 450, 520, 560],
        },
        {
            id: PROVINZ,
            name: "Nordmarken",
            type: "Herzogtum",
            parent: REICH,
            circle: "halb",
            minZoom: 2,
            maxZoom: 3,
            color: "#7a8c3c",
            order: 0,
            bounds: [430, 480, 500, 540],
        },
        {
            id: GRAFSCHAFT,
            name: "Grafschaft Albenhus",
            type: "Grafschaft",
            parent: PROVINZ,
            circle: "voll",
            area: true,
            minZoom: 4,
            maxZoom: 8,
            color: "#b2b065",
            wiki: "https://de.wiki-aventurica.de/wiki/Grafschaft_Albenhus",
            order: 0,
            bounds: [440, 490, 470, 520],
        },
        {
            id: LUECKE,
            name: "Baronie Lückenhof",
            type: "Baronie",
            parent: PROVINZ,
            circle: "voll",
            area: true,
            minZoom: 6,
            maxZoom: 8,
            color: "#a39a55",
            order: 1,
            bounds: [470, 490, 500, 520],
        },
        {
            id: LEER,
            name: "Grafschaft Isenhag",
            type: "Grafschaft",
            parent: PROVINZ,
            circle: "leer",
            minZoom: 4,
            maxZoom: 8,
            color: "#9c9a60",
            order: 2,
        },
        {
            id: BORNLAND,
            name: "Bornland",
            type: "Adelsrepublik",
            circle: "leer",
            minZoom: 0,
            maxZoom: 8,
            color: "#5c7fa3",
            order: 1,
        },
        {
            id: WUESTENEI,
            name: "Baronie Wüstenei",
            type: "Baronie",
            parent: PROVINZ,
            circle: "leer",
            minZoom: 6,
            maxZoom: 8,
            color: "#8a8460",
            order: 3,
            deleted: true,
        },
    ],
};

const WAPPEN = `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="48"><path d="M2 2h36v24c0 10-8 18-18 20C10 44 2 36 2 26z" fill="#b2b065"/></svg>',
)}`;
const DETAIL: EditorTerritoryDetail = {
    id: GRAFSCHAFT,
    revision: 9,
    name: "Grafschaft Albenhus",
    shortName: "Albenhus",
    type: "Grafschaft",
    wikiType: "Grafschaft",
    status: "Grafschaft der Nordmarken",
    color: "#b2b065",
    opacity: 0.7,
    minZoom: 4,
    maxZoom: 8,
    validFromBf: 100,
    order: 0,
    wiki: { url: "https://de.wiki-aventurica.de/wiki/Grafschaft_Albenhus", key: "Grafschaft Albenhus" },
    parents: [
        { id: PROVINZ, name: "Nordmarken" },
        { id: REICH, name: "Mittelreich" },
    ],
    children: [],
    capital: { id: STADT, name: "Albenhus", kind: "stadt" },
    details: {
        form_of_government: { value: "Feudalherrschaft", origin: "wiki" },
        capital_name: { value: "Albenhus", origin: "wiki" },
        seat_name: { value: "Burg Albenstein", origin: "wiki" },
        ruler: { value: "Graf Ghambir", origin: "override", wiki: "Graf Growin" },
        currency: { value: null, wiki: "Dukaten" },
        language: { value: "Garethi", origin: "wiki" },
        population: { value: "12.000", origin: "wiki" },
    },
    areas: [{ id: ID(0x101), bounds: [440, 490, 470, 520] }],
    claimedBy: [],
    claims: [],
    hasCoat: true,
    coat: WAPPEN,
};
const NORDMARKEN: EditorTerritoryDetail = {
    id: PROVINZ,
    name: "Nordmarken",
    type: "Herzogtum",
    color: "#7a8c3c",
    opacity: 0.7,
    minZoom: 2,
    maxZoom: 3,
    order: 0,
    parents: [{ id: REICH, name: "Mittelreich" }],
    children: [
        { id: GRAFSCHAFT, name: "Grafschaft Albenhus" },
        { id: LUECKE, name: "Baronie Lückenhof" },
        { id: LEER, name: "Grafschaft Isenhag" },
    ],
    details: {},
    areas: [],
    claimedBy: [],
    claims: [],
};
/** Ab den Nordmarken: das Reich darüber, drei Untergebiete, zwei mit Fläche. Lückenhof (6 bis 8) lässt Band 4 und 5 leer. */
const HIERARCHIE: EditorTerritoryHierarchy = {
    yearBf: 1049,
    derivedMaxBand: 8,
    territories: [
        {
            id: REICH,
            name: "Mittelreich",
            type: "Kaiserreich",
            minZoom: 0,
            maxZoom: 1,
            color: "#c0392b",
            order: 0,
            above: true,
        },
        {
            id: PROVINZ,
            revision: 4,
            name: "Nordmarken",
            type: "Herzogtum",
            parent: REICH,
            minZoom: 2,
            maxZoom: 3,
            color: "#7a8c3c",
            order: 0,
        },
        {
            id: GRAFSCHAFT,
            revision: 5,
            name: "Grafschaft Albenhus",
            type: "Grafschaft",
            parent: PROVINZ,
            minZoom: 4,
            maxZoom: 8,
            color: "#b2b065",
            order: 0,
        },
        {
            id: LUECKE,
            revision: 6,
            name: "Baronie Lückenhof",
            type: "Baronie",
            parent: PROVINZ,
            minZoom: 6,
            maxZoom: 8,
            color: "#a39a55",
            order: 1,
        },
        {
            id: LEER,
            revision: 7,
            name: "Grafschaft Isenhag",
            type: "Grafschaft",
            parent: PROVINZ,
            minZoom: 4,
            maxZoom: 8,
            color: "#9c9a60",
            order: 2,
        },
    ],
    areas: [
        { id: ID(0x101), territory: GRAFSCHAFT },
        { id: ID(0x102), territory: LUECKE },
    ],
};

const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

async function oeffneGebietseditor(
    page: Page,
    vorher?: (page: Page) => Promise<void>,
    /** Als Editor mit `edit_map_objects` und „Bearbeiten an“ (D2); sonst Reviewer, lesend. */
    editor = false,
    /** Weitere Rechte des Editors (5.5: `edit_map_geometry`, sonst steht „Neues Untergebiet …“ nicht da). */
    mehr: readonly string[] = [],
    /** Rechte, die dem Editor fehlen (WI-0279, Paket 6). */
    ohne: readonly string[] = [],
): Promise<{ hierarchieAbrufe: string[] }> {
    const hierarchieAbrufe: string[] = [];
    await stubAdmin(
        page,
        editor
            ? {
                  capabilities: [
                      "use_editor_menu",
                      "edit_map_objects",
                      ...mehr,
                      "edit_territories",
                      "edit_territory_form",
                      "edit_landscapes",
                  ].filter((recht) => !ohne.includes(recht)),
                  role: "editor",
              }
            : // Lesend, aber mit dem Recht an der Form: Ohne es stehen Hierarchie und Form grau (WI-0279, Paket 6).
              { capabilities: ["use_editor_menu", "edit_territory_form"], role: "reviewer" },
    );
    if (editor) await page.route("**/api/editor/status", (route) => route.fulfill(json({ mapEditing: "testwelt" })));
    await page.route("**/api/editor/territories", (route) => route.fulfill(json(LISTE)));
    await page.route(`**/api/editor/territories/${GRAFSCHAFT}`, (route) => route.fulfill(json(DETAIL)));
    await page.route(`**/api/editor/territories/${PROVINZ}`, (route) => route.fulfill(json(NORDMARKEN)));
    // Der Artikel des Gebiets kommt seit WI-0253 (08a5d3d6b) aus der Wiki-Box, nicht mehr aus dem Detail: Stand der Box des einen Gebiets, sonst „nicht gefunden“.
    await page.route("**/api/editor/wiki-box/gebiet/*", (route) =>
        route.request().url().endsWith(`/${GRAFSCHAFT}`)
            ? route.fulfill(
                  json({
                      art: "gebiet",
                      id: GRAFSCHAFT,
                      name: DETAIL.name,
                      artikel: { key: DETAIL.wiki?.key, url: DETAIL.wiki?.url, name: DETAIL.name },
                      sync: { moeglich: false, grund: "abruf_gesperrt", laeuft: false, letzter: null, fehler: null },
                  }),
              )
            : route.fulfill({ status: 404, contentType: "application/json", body: "{}" }),
    );
    await page.route("**/api/editor/territories/*/hierarchy", (route) => {
        hierarchieAbrufe.push(route.request().url());
        return route.fulfill(json(HIERARCHIE));
    });
    await openMap(page, EDITOR_MODE);
    await editorPanelVorn(page);
    // Die Kachel stellt die Karte schon auf „Politisch“ (WI-0212, EDIT-0003 T37).
    await page.getByTestId("editorpanel-kachel-territorien").click();
    // Den Fächer erreicht ein Klick nur, solange kein angedocktes Werkzeugfenster die Karte schmaler macht.
    if (vorher) await vorher(page);
    const verb = page.getByTestId("editorpanel-verb");
    await expect(verb).toContainText("Herrschaftsgebiete bearbeiten");
    await verb.click();
    return { hierarchieAbrufe };
}
const liste = (page: Page) => page.locator('[data-testid^="gebietseditor-"][data-testid$="-liste"]');
/** Das ganze Fenster samt Kopf (`AvmFenster` trägt die Kennung des Werkzeugs). */
const fenster = (page: Page) => page.getByTestId(/^gebietseditor-fenster-\d+$/);
const reiter = (page: Page, name: string | RegExp) => fenster(page).getByRole("tab", { name });

test("🔴 Herrschaftsgebiete → „Herrschaftsgebiete bearbeiten“ öffnet den Gebietseditor: der Baum mit Legacys Kreis, lesend", async ({
    page,
}) => {
    await oeffneGebietseditor(page);
    await expect(liste(page)).toBeVisible();
    // Der Baum beginnt zugeklappt bei den Wurzeln.
    await expect(liste(page).getByRole("option")).toHaveCount(2);
    // Legacys Bedeutung des Kreises unter der Liste (EDIT-0003 T26 (5)).
    await expect(liste(page)).toContainText("Gebiet und alle Untergebiete auf der Karte");
    await expect(liste(page)).toContainText("nur über Untergebiete, unvollständig");
    // Lesend: „nur lesen“, kein Speichern; kein anderer Editor ist aufgegangen.
    await expect(fenster(page)).toContainText("nur lesen");
    await expect(fenster(page).getByRole("button", { name: "Speichern" })).toHaveCount(0);
    await expect(page.locator('[data-testid^="ortseditor-"][data-testid$="-liste"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="landschaftseditor-"][data-testid$="-liste"]')).toHaveCount(0);
});

test("🔴 ein Gebiet wählen: alle Felder, Hauptstadt als Ort, Sitz aus dem Wiki, Wiki-Wert am eigenen Wert, Farbe, Deckkraft, Wappen", async ({
    page,
}) => {
    await oeffneGebietseditor(page);
    // Die Suche bringt die Vorfahren als Zusammenhang mit.
    await liste(page).getByRole("searchbox").fill("Albenhus");
    await expect(liste(page).getByRole("option")).toHaveCount(3);
    await liste(page)
        .getByRole("option", { name: /Grafschaft Albenhus/ })
        .click();
    const felder = page.getByTestId(/^gebietseditor-fenster-\d+-felder$/);
    await expect(felder).toContainText("Grafschaft Albenhus");
    await expect(felder).toContainText("Albenhus · Stadt");
    await expect(felder).toContainText("„Burg Albenstein“ (Wiki)");
    await expect(felder).toContainText("Feudalherrschaft");
    await expect(felder).toContainText("Graf Ghambir");
    // G6: Der eigene Wert steht als Zeile des Wiki-Felds, der des Wiki durchgestrichen dahinter; lesend ohne ↺.
    const herrscher = page.getByTestId(/^gebietseditor-fenster-\d+-zeile-ruler$/).filter({ visible: true });
    await expect(herrscher).toHaveAttribute("data-zustand", "lesend");
    await expect(herrscher.locator("s")).toHaveText("Graf Growin");
    await expect(herrscher.getByRole("button")).toHaveCount(0);
    await expect(
        page.getByTestId(/^gebietseditor-fenster-\d+-zeile-language$/).filter({ visible: true }),
    ).toHaveAttribute("data-zustand", "unbekannt");
    await expect(felder).toContainText("Mittelreich › Nordmarken");
    await expect(felder).toContainText("#b2b065");
    await expect(felder).toContainText("70 % in den Daten");
    await expect(felder).toContainText("Band 4–8");
    await expect(felder.getByRole("link", { name: "Grafschaft Albenhus" })).toHaveAttribute(
        "href",
        "https://de.wiki-aventurica.de/wiki/Grafschaft_Albenhus",
    );
    await page.screenshot({ path: "test-results/gebietseditor-a3-eigenschaften.png" });
    // Das Wappen steht seit WI-0253 (08a5d3d6b, Betreiber 2026-10-26: „Wappen gehören zu einem Bilder-Tab“) im Reiter „Bilder“, nicht mehr in den Eigenschaften.
    await expect(felder.getByRole("img", { name: "Wappen von Grafschaft Albenhus" })).toHaveCount(0);
    await reiter(page, "Bilder").click();
    await expect(
        page
            .getByTestId(/^gebietseditor-fenster-\d+-bilder$/)
            .getByRole("img", { name: "Wappen von Grafschaft Albenhus" }),
    ).toBeVisible();

    await reiter(page, "Form").click();
    await expect(fenster(page)).toContainText("Teilflächen");
    await expect(fenster(page)).toContainText("wie das Gebiet");
    await reiter(page, "Untergebiete (0)").click();
    await expect(fenster(page)).toContainText("Keine Untergebiete.");
});

test("🔴 5.5 Reiter „Untergebiete“: auch wer zeichnen darf, sieht die Liste, und jedes Untergebiet ist direkt wählbar (Thomas 2026-10-19)", async ({
    page,
}) => {
    await oeffneGebietseditor(page, undefined, true, [
        "edit_map_geometry",
        "edit_territory_form",
        "edit_landscape_form",
        "edit_mountains",
    ]);
    await liste(page).getByRole("searchbox").fill("Nordmarken");
    await liste(page)
        .getByRole("option", { name: /Nordmarken/ })
        .click();
    await reiter(page, "Untergebiete (3)").click();
    // Der Knopf zum Anlegen steht da, und die Liste daneben (bis 5.5 verdrängte der Knopf sie).
    await expect(page.getByTestId(/^gebietseditor-fenster-\d+-untergebiet-anlegen$/)).toBeVisible();
    const kinder = page.getByTestId(/^gebietseditor-fenster-\d+-kind$/);
    await expect(kinder).toHaveText([/Grafschaft Albenhus/, /Baronie Lückenhof/, /Grafschaft Isenhag/]);
    await kinder.filter({ hasText: "Grafschaft Albenhus" }).click();
    // Im Editor geht das Untergebiet in einem eigenen Fenster auf (D19), das des Obergebiets liegt abgelegt daneben.
    await expect(reiter(page, "Untergebiete (0)")).toBeVisible();
    await expect(fenster(page).filter({ visible: true })).toContainText("Keine Untergebiete.");
});

test("🔴 Reiter „Hierarchie“: je Band gezeigt oder verdeckt nach der Regel, ∅ an der Lücke; abwärts lädt nichts nach", async ({
    page,
}) => {
    const { hierarchieAbrufe } = await oeffneGebietseditor(page);
    await liste(page).getByRole("searchbox").fill("Nordmarken");
    await liste(page)
        .getByRole("option", { name: /Nordmarken/ })
        .click();
    await reiter(page, "Hierarchie").click();
    // Je Gebiet ein Fenster (D19, B2): Wer abwärts wählt, öffnet an derselben Stelle, das alte Fenster ist abgelegt (bleibt im DOM).
    const kopf = page.getByTestId(/^gebietseditor-fenster-\d+-hierarchie-kopf$/).filter({ visible: true });
    await expect(kopf).toHaveText("Ab Nordmarken abwärts · Gebiete: 4");
    const zeile = (id: string) => page.locator(`[data-hier="${id}"]`);
    await expect(page.getByTestId("hierarchie-zeile")).toHaveCount(4);
    const stufen = async (id: string): Promise<(string | null)[]> => {
        // `evaluateAll` wartet nicht: erst die neun Bänder abwarten, dann lesen.
        await expect(zeile(id).locator(".zs__zelle")).toHaveCount(9);
        return zeile(id)
            .locator(".zs__zelle")
            .evaluateAll((zellen) => zellen.map((z) => z.getAttribute("data-stufe")));
    };
    // Die Nordmarken zeigen sich in Band 2 und 3, Albenhus ab 4; Lückenhof erst ab 6, in 4 und 5 zeigt seine Fläche nichts.
    expect(await stufen(PROVINZ)).toEqual(["aus", "aus", "gezeigt", "gezeigt", "aus", "aus", "aus", "aus", "aus"]);
    expect(await stufen(GRAFSCHAFT)).toEqual([
        "aus",
        "aus",
        "aus",
        "aus",
        "gezeigt",
        "gezeigt",
        "gezeigt",
        "gezeigt",
        "gezeigt",
    ]);
    expect(await stufen(LUECKE)).toEqual(["aus", "aus", "aus", "aus", "aus", "aus", "gezeigt", "gezeigt", "gezeigt"]);
    await expect(zeile(LUECKE).getByTitle("Lücke: In Band 4, 5 zeigt eine eigene Fläche nichts")).toBeVisible();
    await expect(zeile(GRAFSCHAFT).getByText("∅")).toHaveCount(0);
    expect(hierarchieAbrufe).toHaveLength(1);
    await page.screenshot({ path: "test-results/gebietseditor-a3-hierarchie.png" });

    // Abwärts wählen: Albenhus wird Wurzel, aus denselben Daten.
    await zeile(GRAFSCHAFT).getByRole("button", { name: "Grafschaft Albenhus" }).click();
    await expect(kopf).toHaveText("Ab Grafschaft Albenhus abwärts · Gebiete: 1");
    expect(hierarchieAbrufe).toHaveLength(1);
});

test("🔴 F17 und T32: der Einfachklick stellt die Ansicht „Politisch“ ohne Flug, der Doppelklick fliegt dazu hin", async ({
    page,
}) => {
    // Die Kachel hat die Karte schon auf „Politisch“ gestellt; erst eine andere Ansicht zeigt, dass die LISTE wechselt. Die Kachel folgt
    // der Ansicht (WI-0212, 69ebebeef): Vor dem Öffnen stünde nach „Standard“ wieder „Orte“ und das Verb hieße „⚙ Orte bearbeiten“. Darum
    // erst das Fenster öffnen, dann den Fächer umstellen; auf 1920 × 1080 erreicht ihn der Klick neben dem angedockten Fenster.
    await page.setViewportSize({ width: 1920, height: 1080 });
    await oeffneGebietseditor(page);
    await chooseView(page, "standard");
    await expect(page).not.toHaveURL(/view=political/);
    const mitte = () =>
        page.evaluate(() => {
            const jetzt = globalThis.avesmapsMap!.getCenter();
            return { lng: jetzt.lng, lat: jetzt.lat, bewegt: globalThis.avesmapsMap!.isMoving() };
        });
    const vorher = await mitte();
    await liste(page)
        .getByRole("option", { name: /Bornland/ })
        .click();
    await expect(page).toHaveURL(/view=political/);
    expect(await mitte()).toEqual({ ...vorher, bewegt: false });
    // Ohne Rahmen (keine Fläche) fliegt nichts; das Mittelreich hat einen.
    await liste(page)
        .getByRole("option", { name: /Mittelreich/ })
        .dblclick();
    await page.waitForFunction(
        (alt) => {
            const jetzt = globalThis.avesmapsMap!.getCenter();
            return !globalThis.avesmapsMap!.isMoving() && (jetzt.lng !== alt.lng || jetzt.lat !== alt.lat);
        },
        vorher,
        { timeout: 15_000 },
    );
    await expect(page).toHaveURL(/view=political/);
});

test("🔴 « zieht die Liste ein, und die Lasche „Editor“ rückt an die Kante des Fensters mit (wie bei den anderen Editoren)", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await oeffneGebietseditor(page);
    /** Linke Kante des angedockten Fensters und rechte Kante der Lasche, nach dem Übergang (220 ms). */
    const kanten = async (): Promise<{ fenster: number; lasche: number }> => {
        await page.waitForTimeout(400);
        const rumpf = liste(page).locator("xpath=ancestor::*[contains(@class,'avm-fenster')][1]");
        const box = (await rumpf.boundingBox())!;
        const lasche = (await page.getByTestId("editor-panel-tab").boundingBox())!;
        return { fenster: box.x, lasche: lasche.x + lasche.width };
    };
    const vorher = await kanten();
    expect(Math.abs(vorher.lasche - vorher.fenster)).toBeLessThanOrEqual(2);
    await page.getByTestId(/^gebietseditor-fenster-\d+-listenschalter$/).click();
    const eingezogen = await kanten();
    expect(eingezogen.fenster).toBeGreaterThan(vorher.fenster + 100);
    expect(Math.abs(eingezogen.lasche - eingezogen.fenster)).toBeLessThanOrEqual(2);
});

test("🔴 D2 Zoombänder bearbeiten: Anfasser und ⇉ sperren nur die geänderten Gebiete, die Lücke schließt sich, „Fertig“ schreibt EINE Operation", async ({
    page,
}) => {
    const sperren: { kind: string; id: string; part: string }[] = [];
    const geschrieben: unknown[] = [];
    // Die Sperre (EDIT-0003 §4) und der Schreibweg, nie gegen die Datenbank der Entwicklung.
    await page.route(/\/api\/editor\/locks(\/(heartbeat|release|lift))?(\?.*)?$/, (route) => {
        const url = route.request().url();
        if (route.request().method() === "GET") return route.fulfill(json({ locks: [] }));
        if (url.endsWith("/release")) return route.fulfill({ status: 204 });
        if (url.endsWith("/heartbeat")) return route.fulfill(json({ lost: [] }));
        const body = route.request().postDataJSON() as { kind: string; id: string; part: string };
        sperren.push({ kind: body.kind, id: body.id, part: body.part });
        const lock = {
            ...body,
            person: { id: ID(0xf1), name: "Ich" },
            since: "2026-10-17T12:00:00.000Z",
            heartbeatAt: "2026-10-17T12:00:00.000Z",
            own: true,
        };
        return route.fulfill(json({ lock }));
    });
    await page.route("**/api/editor/territories/display", (route) => {
        geschrieben.push(route.request().postDataJSON());
        return route.fulfill(
            json({
                operationId: ID(0xe2),
                status: "applied",
                environment: "test",
                affected: [],
                derivedWork: [{ kind: "territory_derive", state: "queued" }],
                warnings: [],
                mapRevision: 4712,
            }),
        );
    });
    const { hierarchieAbrufe } = await oeffneGebietseditor(page, undefined, true);
    await liste(page).getByRole("searchbox").fill("Nordmarken");
    await liste(page)
        .getByRole("option", { name: /Nordmarken/ })
        .click();
    await reiter(page, "Hierarchie").click();
    const zeile = (id: string) => page.locator(`[data-hier="${id}"]`);
    const leiste = page.getByTestId("baender-leiste");
    await expect(leiste).toHaveCount(0);

    // Die Zeilen kommen erst mit der Antwort der Hierarchie, `evaluateAll` wartet nicht: erst die neun Bänder abwarten, dann lesen (dritter
    // Release-Test d863f283e: unter Last lieferte es `[]`).
    await expect(zeile(LUECKE).locator(".zs__zelle")).toHaveCount(9);
    // Gepunktet die Vorgabe nach Tiefe: Mittelreich › Nordmarken › Baronie ist eine Kette der Länge 3, die Baronie 3–8.
    const vorgabe = await zeile(LUECKE)
        .locator(".zs__zelle")
        .evaluateAll((zellen) => zellen.map((z) => z.classList.contains("zs__zelle--vorgabe")));
    expect(vorgabe).toEqual([false, false, false, true, true, true, true, true, true]);

    // ←← am linken Anfasser von Lückenhof: 6 → 4; die Lücke in Band 4 und 5 ist weg, die Leiste steht.
    const von = zeile(LUECKE).getByTestId("hierarchie-griff-von");
    await expect(von).toHaveAttribute("aria-valuenow", "6");
    await von.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(von).toHaveAttribute("aria-valuenow", "5");
    await page.keyboard.press("ArrowLeft");
    await expect(von).toHaveAttribute("aria-valuenow", "4");
    await expect(leiste).toContainText("Zoombänder bearbeiten");
    await expect(leiste).toContainText("Nordmarken");
    await expect(page.getByTestId("baender-leiste-ungespeichert")).toContainText("2");
    await expect(zeile(LUECKE).getByText("∅")).toHaveCount(0);

    // Den rechten Anfasser von Albenhus mit der Maus auf Band 6 ziehen, dann ⇉: Lückenhof und Isenhag bekommen 4–6.
    const bis = zeile(GRAFSCHAFT).getByTestId("hierarchie-griff-bis");
    const zellen = zeile(GRAFSCHAFT).locator(".zs__zelle");
    const griff = (await bis.boundingBox())!;
    const band6 = (await zellen.nth(6).boundingBox())!;
    await page.mouse.move(griff.x + griff.width / 2, griff.y + griff.height / 2);
    await page.mouse.down();
    await page.mouse.move(band6.x + band6.width / 2, band6.y + band6.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect(bis).toHaveAttribute("aria-valuenow", "6");
    await zeile(GRAFSCHAFT).getByTestId("hierarchie-geschwister").click();
    await expect(zeile(LEER).getByTestId("hierarchie-griff-bis")).toHaveAttribute("aria-valuenow", "6");
    await expect(zeile(LUECKE).getByTestId("hierarchie-griff-bis")).toHaveAttribute("aria-valuenow", "6");
    // Gesperrt wurde je geändertes Gebiet genau einmal, nie die Nordmarken.
    expect(sperren.map((x) => x.id).sort()).toEqual([GRAFSCHAFT, LUECKE, LEER].sort());
    expect(new Set(sperren.map((x) => `${x.kind}/${x.part}`))).toEqual(new Set(["territory/felder"]));
    await page.screenshot({ path: "test-results/gebietseditor-d2-zoombaender.png" });

    // „Fertig“: EINE Operation mit den drei Spannen, je gegen die Revision aus dem Reiter; danach liest der Reiter neu.
    await page.getByTestId("baender-leiste-fertig").click();
    await expect(leiste).toHaveCount(0);
    expect(geschrieben).toHaveLength(1);
    const koerper = geschrieben[0] as { territories: { id: string }[] };
    expect([...koerper.territories].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
        [
            { id: GRAFSCHAFT, baseRevision: 5, zoom: { minZoom: 4, maxZoom: 6 } },
            { id: LUECKE, baseRevision: 6, zoom: { minZoom: 4, maxZoom: 6 } },
            { id: LEER, baseRevision: 7, zoom: { minZoom: 4, maxZoom: 6 } },
        ].sort((a, b) => a.id.localeCompare(b.id)),
    );
    await expect(page.getByTestId("toast")).toContainText("Zoombänder gespeichert");
    await expect.poll(() => hierarchieAbrufe.length).toBe(2);
});

test("🔴 D4 Farben im selben Entwurf: das Farbfeld zieht die Untergebiete mit, abwählbar; „Farbhierarchie erstellen“ ist EIN Schritt; „Fertig“ schreibt nur Farben", async ({
    page,
}) => {
    const sperren = await stubSperre(page);
    const geschrieben: unknown[] = [];
    await page.route("**/api/editor/territories/display", (route) => {
        geschrieben.push(route.request().postDataJSON());
        return route.fulfill(
            json({
                operationId: ID(0xe4),
                status: "applied",
                environment: "test",
                affected: [],
                derivedWork: [{ kind: "tiles", state: "done" }],
                warnings: [],
                mapRevision: 4714,
            }),
        );
    });
    await oeffneGebietseditor(page, undefined, true);
    await liste(page).getByRole("searchbox").fill("Nordmarken");
    await liste(page)
        .getByRole("option", { name: /Nordmarken/ })
        .click();
    await reiter(page, "Hierarchie").click();
    const zeile = (id: string) => page.locator(`[data-hier="${id}"]`);
    const farbe = (id: string) => zeile(id).getByTestId("hierarchie-farbe");
    const vorher = (id: string): string => HIERARCHIE.territories.find((g) => g.id === id)!.color;
    const leiste = page.getByTestId("baender-leiste");
    const ungespeichert = page.getByTestId("baender-leiste-ungespeichert");

    // Die Nordmarken bekommen eine neue Farbe: Albenhus, Lückenhof und Isenhag ziehen mit derselben Verschiebung mit (H2).
    await farbe(PROVINZ).fill("#b0685f");
    await expect(leiste).toContainText("Farben bearbeiten");
    await expect(ungespeichert).toContainText("1");
    await expect(farbe(PROVINZ)).toHaveValue("#b0685f");
    for (const id of [GRAFSCHAFT, LUECKE, LEER]) await expect(farbe(id)).not.toHaveValue(vorher(id));
    expect(sperren.map((x) => x.id).sort()).toEqual([PROVINZ, GRAFSCHAFT, LUECKE, LEER].sort());

    // Abgewählt: nur das Gebiet selbst.
    await page
        .getByTestId(/-hierarchie-mitziehen$/)
        .filter({ visible: true })
        .click();
    // EIN Schalter beim Besitzer der Bänder (T51): Die Eigenschaften zeigen ihn ebenso abgewählt; das Kind schreibt nicht ins Prop.
    await reiter(page, "Eigenschaften").click();
    await expect(page.getByTestId(/-farbe-mitziehen$/).filter({ visible: true })).not.toBeChecked();
    await reiter(page, "Hierarchie").click();
    await farbe(GRAFSCHAFT).fill("#3060c0");
    await expect(ungespeichert).toContainText("2");
    await expect(farbe(GRAFSCHAFT)).toHaveValue("#3060c0");
    // Die Karte zeigt die Farben im Entwurf gleich.
    const fuellung = (): Promise<string> =>
        page.evaluate(() => JSON.stringify(globalThis.avesmapsMap!.getPaintProperty("territory-fill", "fill-color")));
    await expect.poll(fuellung).toContain(`"${GRAFSCHAFT}","#3060c0"`);

    // „Farbhierarchie erstellen“ leitet alle Untergebiete ab, als EIN Schritt; ↶ nimmt ihn zurück.
    await page
        .getByTestId(/-hierarchie-farbhierarchie$/)
        .filter({ visible: true })
        .click();
    await expect(ungespeichert).toContainText("3");
    await page.screenshot({ path: "test-results/gebietseditor-d4-farben.png" });
    await page.getByTestId("baender-leiste-zurueck").click();
    await expect(ungespeichert).toContainText("2");
    await expect(farbe(GRAFSCHAFT)).toHaveValue("#3060c0");

    // „Fertig“: EINE Operation, nur Farben, je gegen die Revision aus dem Reiter.
    await page.getByTestId("baender-leiste-fertig").click();
    await expect(leiste).toHaveCount(0);
    expect(geschrieben).toHaveLength(1);
    const koerper = geschrieben[0] as { territories: { id: string; color?: string; zoom?: unknown }[] };
    expect(koerper.territories.map((g) => g.id).sort()).toEqual([PROVINZ, GRAFSCHAFT, LUECKE, LEER].sort());
    for (const g of koerper.territories) {
        expect(g.zoom).toBeUndefined();
        expect(g.color).toMatch(/^#[0-9a-f]{6}$/u);
    }
    expect(koerper.territories.find((g) => g.id === GRAFSCHAFT)).toEqual({
        id: GRAFSCHAFT,
        baseRevision: 5,
        color: "#3060c0",
    });
    await expect(page.getByTestId("toast")).toContainText("Farben gespeichert");
    await expect.poll(fuellung).toBe(JSON.stringify(["get", "color"]));
});

test("🔴 T51 die Farbe in den Eigenschaften: das Farbfeld schreibt in den Entwurf „Farben und Zoombänder“, „Fertig“ schreibt territory.display", async ({
    page,
}) => {
    const sperren = await stubSperre(page);
    const geschrieben: unknown[] = [];
    await page.route("**/api/editor/territories/display", (route) => {
        geschrieben.push(route.request().postDataJSON());
        return route.fulfill(
            json({
                operationId: ID(0xe5),
                status: "applied",
                environment: "test",
                affected: [],
                derivedWork: [{ kind: "tiles", state: "done" }],
                warnings: [],
                mapRevision: 4715,
            }),
        );
    });
    await oeffneGebietseditor(page, undefined, true);
    await liste(page).getByRole("searchbox").fill("Albenhus");
    await liste(page)
        .getByRole("option", { name: /Grafschaft Albenhus/ })
        .click();
    const wahl = page.getByTestId(/^gebietseditor-fenster-\d+-farbe-wahl$/).filter({ visible: true });
    await wahl.fill("#3060c0");
    const leiste = page.getByTestId("baender-leiste");
    await expect(leiste).toContainText("Farben bearbeiten");
    await expect(page.getByTestId(/^gebietseditor-fenster-\d+-feld-farbe$/).filter({ visible: true })).toHaveText(
        "#3060c0",
    );
    expect(sperren).toEqual([{ kind: "territory", id: GRAFSCHAFT, part: "felder" }]);
    await page.getByTestId("baender-leiste-fertig").click();
    await expect(leiste).toHaveCount(0);
    expect(geschrieben).toEqual([
        { operationId: expect.any(String), territories: [{ id: GRAFSCHAFT, baseRevision: 5, color: "#3060c0" }] },
    ]);
});

test("🔴 D1 Umhängen am Feld „Obergebiet“: Suche ohne das Gebiet selbst, Blatt mit den Folgen je Band, „Umhängen“ in den Entwurf, „Fertig“ schreibt", async ({
    page,
}) => {
    const sperren = await stubSperre(page);
    const folgenAbrufe: string[] = [];
    await page.route(/\/api\/editor\/territories\/[^/]+\/reparent\?parent=/, (route) => {
        const url = route.request().url();
        folgenAbrufe.push(url.slice(url.indexOf("/api/")));
        return route.fulfill(
            json({
                id: GRAFSCHAFT,
                name: "Grafschaft Albenhus",
                from: { id: PROVINZ, name: "Nordmarken" },
                to: { id: LEER, name: "Grafschaft Isenhag" },
                kreis: false,
                descendants: 0,
                changes: [
                    {
                        bands: [2, 3],
                        from: { id: PROVINZ, name: "Nordmarken" },
                        to: { id: LEER, name: "Grafschaft Isenhag" },
                        areas: 1,
                    },
                ],
            }),
        );
    });
    await oeffneGebietseditor(page, undefined, true);
    const geschrieben = await stubFertig(page);
    await liste(page).getByRole("searchbox").fill("Albenhus");
    await liste(page)
        .getByRole("option", { name: /Grafschaft Albenhus/ })
        .click();
    await page
        .getByTestId(/^gebietseditor-fenster-\d+-obergebiet-aendern$/)
        .filter({ visible: true })
        .click();
    await page
        .getByTestId(/^gebietseditor-fenster-\d+-obergebiet-suche$/)
        .filter({ visible: true })
        .locator("input")
        .fill("Grafschaft");
    const wahl = page.getByTestId(/^gebietseditor-fenster-\d+-obergebiet-liste$/).filter({ visible: true });
    // Das Gebiet selbst steht nicht zur Wahl.
    await expect(wahl.locator(`[data-gebiet="${GRAFSCHAFT}"]`)).toHaveCount(0);
    await wahl.locator(`[data-gebiet="${LEER}"]`).click();
    const blatt = page.getByTestId(/^gebietseditor-fenster-\d+-umhaengen-blatt$/).filter({ visible: true });
    await expect(blatt).toContainText("Grafschaft Albenhus unter Grafschaft Isenhag hängen?");
    await expect(blatt).toContainText("Band 2 und 3");
    await expect(blatt).toContainText("(1) zählen dann zu Grafschaft Isenhag statt zu Nordmarken");
    expect(folgenAbrufe).toEqual([`/api/editor/territories/${GRAFSCHAFT}/reparent?parent=${LEER}`]);
    await page.screenshot({ path: "test-results/gebietseditor-d1-umhaengen.png" });
    await blatt.getByRole("button", { name: "Umhängen" }).click();
    await expect(blatt).toHaveCount(0);
    const feld = page.getByTestId(/^gebietseditor-fenster-\d+-feld-obergebiet$/).filter({ visible: true });
    await expect(feld).toContainText("Grafschaft Isenhag");
    await expect(feld).toContainText("✎");
    await expect(page.getByTestId("gebiet-leiste-ungespeichert")).toContainText("1");
    expect(sperren).toEqual([{ kind: "territory", id: GRAFSCHAFT, part: "felder" }]);
    await page.getByTestId("gebiet-leiste-fertig").click();
    await expect.poll(() => geschrieben.length).toBe(1);
    expect(geschrieben[0]!.body).toMatchObject({ baseRevision: 9, changes: { parent: LEER } });
});

test("🔴 D1 Umhängen per Ziehen im Baum: über sich selbst der Satz, über einem erlaubten Ziel „Hierher hängen“; abgelegt steht das Blatt, geschrieben wird nichts", async ({
    page,
}) => {
    await stubSperre(page);
    await page.route(/\/api\/editor\/territories\/[^/]+\/reparent\?parent=/, (route) =>
        route.fulfill(
            json({
                id: GRAFSCHAFT,
                name: "Grafschaft Albenhus",
                from: { id: PROVINZ, name: "Nordmarken" },
                to: { id: LEER, name: "Grafschaft Isenhag" },
                kreis: false,
                descendants: 0,
                changes: [],
            }),
        ),
    );
    await oeffneGebietseditor(page, undefined, true);
    const geschrieben = await stubFertig(page);
    await liste(page).getByRole("searchbox").fill("Grafschaft");
    const zeile = (id: string) => liste(page).locator(`[data-key="${id}"]`);
    const ablage = page.getByTestId(/^gebietseditor-fenster-\d+-gebiete-ablage$/).filter({ visible: true });
    // Über sich selbst: der Satz, warum nicht (HTML-Ziehen mit der Maus in Schritten, sonst beginnt es nicht).
    const mitte = async (id: string, dx = 0): Promise<{ x: number; y: number }> => {
        const box = (await zeile(id).boundingBox())!;
        return { x: box.x + box.width / 2 + dx, y: box.y + box.height / 2 };
    };
    const start = await mitte(GRAFSCHAFT);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    const daneben = await mitte(GRAFSCHAFT, 30);
    await page.mouse.move(daneben.x, daneben.y, { steps: 6 });
    await expect(ablage).toHaveText("Das ist das Gebiet selbst.");
    await expect(zeile(GRAFSCHAFT)).toHaveAttribute("data-ablage", "nein");
    // Über Isenhag: „Hierher hängen“.
    const ziel = await mitte(LEER);
    await page.mouse.move(ziel.x, ziel.y, { steps: 6 });
    await expect(ablage).toHaveText("Hierher hängen");
    await expect(zeile(LEER)).toHaveAttribute("data-ablage", "ja");
    await page.mouse.up();
    // Abgelegt: Albenhus steht im Fenster, am Feld „Obergebiet“ das Blatt mit den Folgen; geschrieben ist nichts.
    const blatt = page.getByTestId(/^gebietseditor-fenster-\d+-umhaengen-blatt$/).filter({ visible: true });
    await expect(blatt).toContainText("Grafschaft Albenhus unter Grafschaft Isenhag hängen?");
    await blatt.getByRole("button", { name: "Abbrechen" }).click();
    await expect(blatt).toHaveCount(0);
    expect(geschrieben).toEqual([]);
});

/**
 * ↺ geht seit WI-0265 B6b über den Server: Vorprüfung (`restore-series/preview`), Rückfrage, Rücknahme (`restore-series`). Die Fälle stellen beide Antworten und prüfen, was die
 * Oberfläche schickt; dass der echte Server so antwortet, belegt `apps/server/test/ruecknahme-gebiet.test.ts` im Wegwerf-Cluster.
 */
const pruefungGebiet = (
    operationId: string,
    operation: string,
    gegenstaende: {
        kind: "territory" | "territory_area";
        id: string;
        name?: string;
        action: string;
        felder: string[];
    }[],
): RuecknahmePruefung => ({
    ergebnis: "ok",
    membersHash: "f".repeat(64),
    mitglieder: [
        {
            operationId,
            seq: 41,
            at: "2026-10-18T10:00:00.000Z",
            operation,
            source: "editor",
            actor: { kind: "person", name: "Thomas" },
            status: "ruecknehmbar",
            offen: true,
            gegenstaende: gegenstaende.map((g) => ({ ...g, revisionBefore: 8, revisionAfter: 9 })),
        },
    ],
    offen: [operationId],
    gegenstaende: [],
    konflikte: [],
    sperren: [],
    fehlendeRechte: [],
    fremdePersonen: [],
    reasonRequired: false,
    folgen: { gegenstaende: gegenstaende.length, gelaende: "keines" },
});
async function ruecknahmeStubs(page: Page, gebiet: string, pruefung: RuecknahmePruefung) {
    const vorschau: RuecknahmeVorschauBody[] = [];
    const zurueck: RuecknahmeBody[] = [];
    await page.route(`**/api/editor/territories/${gebiet}/restore-series/preview`, (route) => {
        vorschau.push(route.request().postDataJSON() as RuecknahmeVorschauBody);
        return route.fulfill(json(pruefung));
    });
    await page.route(`**/api/editor/territories/${gebiet}/restore-series`, (route) => {
        zurueck.push(route.request().postDataJSON() as RuecknahmeBody);
        return route.fulfill(
            json({
                operationId: ID(0xd4),
                status: "applied",
                environment: "test",
                affected: [],
                derivedWork: [{ kind: "territory_derive", state: "queued" }],
                warnings: [],
                mapRevision: 4717,
                reverts: pruefung.offen,
            }),
        );
    });
    return { vorschau, zurueck };
}

test("🔴 D5 Verlauf: das Umhängen steht mit vorher und nachher da, ↺ fragt den Server und nimmt es als EINE Rücknahme zurück (restore-series mit der Kennung der Operation)", async ({
    page,
}) => {
    await stubSperre(page);
    const historie: string[] = [];
    await page.route(/\/api\/editor\/territories\/[^/]+\/history/, (route) => {
        historie.push(route.request().url());
        return route.fulfill(
            json({
                entries: [
                    {
                        operationId: ID(0xd5),
                        seq: 41,
                        at: "2026-10-18T10:00:00.000Z",
                        operation: "territory.update",
                        source: "editor",
                        summary: "Grafschaft Albenhus: Felder geändert",
                        actor: { kind: "person", name: "Thomas" },
                        objects: [
                            {
                                kind: "territory",
                                id: GRAFSCHAFT,
                                name: "Grafschaft Albenhus",
                                action: "territory.updated",
                                revisionBefore: 8,
                                revisionAfter: 9,
                                changes: { parent: { before: LEER, after: PROVINZ } },
                            },
                        ],
                    },
                ],
            }),
        );
    });
    const { vorschau, zurueck } = await ruecknahmeStubs(
        page,
        GRAFSCHAFT,
        pruefungGebiet(ID(0xd5), "territory.update", [
            {
                kind: "territory",
                id: GRAFSCHAFT,
                name: "Grafschaft Albenhus",
                action: "territory.updated",
                felder: ["parent"],
            },
        ]),
    );
    await oeffneGebietseditor(page, undefined, true);
    await liste(page).getByRole("searchbox").fill("Albenhus");
    await liste(page)
        .getByRole("option", { name: /Grafschaft Albenhus/ })
        .click();
    await reiter(page, "Verlauf").click();
    const eintrag = page.getByTestId(/^gebietseditor-fenster-\d+-verlauf-eintrag$/).filter({ visible: true });
    await eintrag.locator("summary").click();
    const felder = eintrag.locator(".verlauf__felder");
    await expect(felder).toBeVisible();
    await expect(felder).toContainText("Obergebiet");
    await expect(felder.locator("s")).toHaveText("Grafschaft Isenhag");
    await expect(felder).toContainText("Nordmarken");
    await page.screenshot({ path: "test-results/gebietseditor-d5-verlauf.png" });
    // Klick: Der Server prüft, es wird noch nichts geschrieben; die Rückfrage steht im Fenster.
    await eintrag.locator('[data-testid$="-ruecknahme"]').click();
    const frage = eintrag.locator('[data-testid$="-ruecknahme-frage"]');
    await expect(frage).toContainText("Diese Änderung zurücknehmen?");
    expect(vorschau).toEqual([{ members: [ID(0xd5)] }]);
    expect(zurueck).toHaveLength(0);
    await frage.getByRole("button", { name: "Zurücknehmen", exact: true }).click();
    await expect.poll(() => zurueck.length).toBe(1);
    expect(zurueck[0]).toEqual({ operationId: expect.any(String), members: [ID(0xd5)], membersHash: "f".repeat(64) });
    // Danach liest der Verlauf neu.
    await expect.poll(() => historie.length).toBeGreaterThan(1);
});

test("🔴 T54 Gelöscht: nur unter der Facette „Gelöscht“, das Fenster lesend mit Band; ↺ fragt den Server, nennt die Folgen und holt es mit EINER Rücknahme zurück", async ({
    page,
}) => {
    await stubSperre(page);
    await page.route(`**/api/editor/territories/${WUESTENEI}`, (route) =>
        route.fulfill(
            json({
                ...DETAIL,
                id: WUESTENEI,
                revision: 3,
                name: "Baronie Wüstenei",
                areas: [],
                deleted: true,
            } satisfies EditorTerritoryDetail),
        ),
    );
    await page.route(/\/api\/editor\/territories\/[^/]+\/history/, (route) =>
        route.fulfill(
            json({
                entries: [
                    {
                        operationId: ID(0xd3),
                        seq: 52,
                        at: "2026-10-18T11:00:00.000Z",
                        operation: "territory.retire",
                        source: "editor",
                        summary: "Baronie Wüstenei: gelöscht",
                        actor: { kind: "person", name: "Thomas" },
                        objects: [
                            {
                                kind: "territory",
                                id: WUESTENEI,
                                name: "Baronie Wüstenei",
                                action: "territory.retired",
                                revisionBefore: 2,
                                revisionAfter: 3,
                                changes: { active: { before: true, after: false } },
                            },
                            {
                                kind: "territory",
                                id: ID(0x71),
                                name: "Junkertum Sandig",
                                action: "territory.updated",
                                revisionBefore: 1,
                                revisionAfter: 2,
                                changes: { parent: { before: WUESTENEI, after: PROVINZ } },
                            },
                        ],
                    },
                ],
            }),
        ),
    );
    const { vorschau, zurueck } = await ruecknahmeStubs(
        page,
        WUESTENEI,
        pruefungGebiet(ID(0xd3), "territory.retire", [
            {
                kind: "territory",
                id: WUESTENEI,
                name: "Baronie Wüstenei",
                action: "territory.retired",
                felder: ["active"],
            },
            {
                kind: "territory",
                id: ID(0x71),
                name: "Junkertum Sandig",
                action: "territory.updated",
                felder: ["parent"],
            },
        ]),
    );
    await oeffneGebietseditor(page, undefined, true);
    // Standardmäßig aus: Die Suche findet das Gelöschte nicht.
    await liste(page).getByRole("searchbox").fill("Wüstenei");
    await expect(liste(page).getByRole("option")).toHaveCount(0);
    await page.locator('[data-testid$="-gebiete-filter"]').filter({ visible: true }).click();
    await page.locator('[data-testid$="-gebiete-filter-stand-geloescht"]').filter({ visible: true }).click();
    await page.keyboard.press("Escape");
    await liste(page)
        .getByRole("option", { name: /Baronie Wüstenei/ })
        .click();
    await expect(liste(page)).toContainText("Gelöscht");
    // Lesend, mit dem Band; kein „Entfernen“.
    const band = page.getByTestId(/^gebietseditor-fenster-\d+-stand$/).filter({ visible: true });
    await expect(band).toContainText("Gelöscht. Der Verlauf holt es zurück.");
    await expect(fenster(page)).toContainText("nur lesen");
    await expect(page.getByTestId(/^gebietseditor-fenster-\d+-entfernen-oeffnen$/)).toHaveCount(0);
    await band.getByRole("button", { name: "Verlauf" }).click();
    // ↺ fragt erst den Server und nennt die Folgen (R13), dann schreibt es EINE Rücknahme (restore-series).
    const eintrag = page.getByTestId(/^gebietseditor-fenster-\d+-verlauf-eintrag$/).filter({ visible: true });
    await eintrag.locator("summary").click();
    await eintrag.locator('[data-testid$="-ruecknahme"]').click();
    const frage = eintrag.locator('[data-testid$="-ruecknahme-frage"]');
    await expect(frage).toContainText("Baronie Wüstenei: zurück in Karte und Baum.");
    await expect(frage).toContainText("Sie hängen wieder wie vorher (1).");
    await page.screenshot({ path: "test-results/gebietseditor-t54-zurueckholen.png" });
    expect(vorschau).toEqual([{ members: [ID(0xd3)] }]);
    expect(zurueck).toEqual([]);
    await frage.getByRole("button", { name: "Zurücknehmen", exact: true }).click();
    await expect.poll(() => zurueck.length).toBe(1);
    expect(zurueck[0]).toEqual({ operationId: expect.any(String), members: [ID(0xd3)], membersHash: "f".repeat(64) });
});

test("🔴 D3 Entfernen: Blatt mit Stufe, Untergebieten und Folgen; „Von der Karte nehmen“ und „Ganz löschen“ schreiben territory.retire", async ({
    page,
}) => {
    await stubSperre(page);
    const entfernt: unknown[] = [];
    await page.route(/\/api\/editor\/territories\/[^/]+\/retire$/, (route) => {
        entfernt.push(route.request().postDataJSON());
        return route.fulfill(
            json({
                operationId: ID(0xd3),
                status: "applied",
                environment: "test",
                affected: [],
                derivedWork: [{ kind: "territory_derive", state: "queued" }],
                warnings: [],
                mapRevision: 4716,
            }),
        );
    });
    await oeffneGebietseditor(page, undefined, true);
    await liste(page).getByRole("searchbox").fill("Albenhus");
    await liste(page)
        .getByRole("option", { name: /Grafschaft Albenhus/ })
        .click();
    const knopf = page.getByTestId(/^gebietseditor-fenster-\d+-entfernen-oeffnen$/).filter({ visible: true });
    await knopf.click();
    const blatt = page.getByTestId(/^gebietseditor-fenster-\d+-entfernen$/).filter({ visible: true });
    await expect(blatt).toContainText("Grafschaft Albenhus entfernen?");
    // Mit eigener Fläche steht „Von der Karte nehmen“ vorn; die Folgen nennen die Obergebiete.
    await expect(blatt).toContainText("Mittelreich › Nordmarken");
    await page.screenshot({ path: "test-results/gebietseditor-d3-entfernen.png" });
    await blatt.getByRole("button", { name: "Entfernen" }).click();
    await expect.poll(() => entfernt.length).toBe(1);
    expect(entfernt[0]).toMatchObject({ baseRevision: 9, stage: "off_map" });
    expect(entfernt[0]).not.toHaveProperty("children");
    await expect(page.getByTestId("toast")).toContainText("Grafschaft Albenhus: von der Karte genommen");
    // Ganz löschen: die Stufe wählen, dann schreiben.
    await knopf.click();
    await page
        .getByTestId(/^gebietseditor-fenster-\d+-entfernen-retire$/)
        .filter({ visible: true })
        .click();
    await expect(blatt).toContainText("Weg aus Karte und Baum");
    await blatt.getByRole("button", { name: "Entfernen" }).click();
    await expect.poll(() => entfernt.length).toBe(2);
    expect(entfernt[1]).toMatchObject({ stage: "retire" });
});

test("D2: ein Klick auf eine Bandspalte zeigt das Band auf der Karte", async ({ page }) => {
    await oeffneGebietseditor(page);
    await liste(page).getByRole("searchbox").fill("Nordmarken");
    await liste(page)
        .getByRole("option", { name: /Nordmarken/ })
        .click();
    await reiter(page, "Hierarchie").click();
    await fenster(page).locator('.zsk__b[data-band="6"]').click();
    // Am Rechner beginnt Band 6 bei Zoom 7 (Band + 1, ohne Vorzug); die Karte landet in der Mitte des Bandes.
    await expect
        .poll(
            () => page.evaluate(() => (globalThis.avesmapsMap!.isMoving() ? -1 : globalThis.avesmapsMap!.getZoom())),
            {
                timeout: 15_000,
            },
        )
        .toBeCloseTo(7.5, 1);
    await expect(page).toHaveURL(/view=political/);
});

test("🔴 D6 „Prüfen“: die Befunde des Gebiets oben in den Eigenschaften, nie eine Sperre; Lücke führt zur Hierarchie", async ({
    page,
}) => {
    await page.route("**/api/editor/territories/findings", (route) =>
        route.fulfill(
            json({
                yearBf: 1049,
                findings: [
                    { territory: GRAFSCHAFT, kind: "hauptstadt", place: STADT },
                    { territory: GRAFSCHAFT, kind: "luecke", bands: [7] },
                    {
                        territory: GRAFSCHAFT,
                        kind: "ueberlappung",
                        other: { id: BORNLAND, name: "Bornland" },
                        size: 12,
                    },
                    { territory: LUECKE, kind: "platzhalter" },
                ],
            }),
        ),
    );
    await oeffneGebietseditor(page);
    await liste(page).getByRole("searchbox").fill("Albenhus");
    await liste(page)
        .getByRole("option", { name: /Grafschaft Albenhus/ })
        .click();
    const pruefen = page.getByTestId(/^gebietseditor-fenster-\d+-pruefen$/);
    await expect(pruefen).toBeVisible();
    // In fester Folge, nur die eigenen (der Platzhalter gehört Lückenhof); die Unterzeile in der Liste nennt die Zahl.
    await expect(pruefen.locator("li")).toHaveText([
        /Lücke: In Band 7 zeigt eine eigene Fläche nichts\./,
        /Überlappt „Bornland“ \(12 E²\)/,
        /Die Hauptstadt liegt außerhalb des Gebiets\./,
    ]);
    await expect(pruefen).toContainText("Befunde sperren nichts.");
    await expect(liste(page).getByRole("option", { name: /Grafschaft Albenhus/ })).toContainText("Befunde: 3");
    await page.screenshot({ path: "test-results/gebietseditor-d6-pruefen.png" });
    await pruefen.getByRole("button", { name: "Zur Hierarchie" }).click();
    await expect(reiter(page, "Hierarchie")).toHaveAttribute("aria-selected", "true");
});

/** Die Sperre im Stub (EDIT-0003 §4): nehmen, schlagen, freigeben; gibt die genommenen zurück. */
async function stubSperre(page: Page): Promise<{ kind: string; id: string; part: string }[]> {
    const sperren: { kind: string; id: string; part: string }[] = [];
    await page.route(/\/api\/editor\/locks(\/(heartbeat|release|lift))?(\?.*)?$/, (route) => {
        const url = route.request().url();
        if (route.request().method() === "GET") return route.fulfill(json({ locks: [] }));
        if (url.endsWith("/release")) return route.fulfill({ status: 204 });
        if (url.endsWith("/heartbeat")) return route.fulfill(json({ lost: [] }));
        const body = route.request().postDataJSON() as { kind: string; id: string; part: string };
        sperren.push({ kind: body.kind, id: body.id, part: body.part });
        const lock = {
            ...body,
            person: { id: ID(0xf1), name: "Ich" },
            since: "2026-10-18T12:00:00.000Z",
            heartbeatAt: "2026-10-18T12:00:00.000Z",
            own: true,
        };
        return route.fulfill(json({ lock }));
    });
    return sperren;
}

/** „Fertig“ an der Grafschaft im Stub, erst nach dem Öffnen (der Stub des Details beantwortet GET, dieser PATCH; spätere Routen gewinnen). */
async function stubFertig(page: Page): Promise<{ url: string; methode: string; body: unknown }[]> {
    const geschrieben: { url: string; methode: string; body: unknown }[] = [];
    await page.route(`**/api/editor/territories/${GRAFSCHAFT}`, (route) => {
        if (route.request().method() !== "PATCH") return route.fallback();
        geschrieben.push({
            url: route.request().url(),
            methode: route.request().method(),
            body: route.request().postDataJSON(),
        });
        return route.fulfill(
            json({
                operationId: ID(0xe3),
                status: "applied",
                environment: "test",
                affected: [{ kind: "territory", id: GRAFSCHAFT, revision: 10 }],
                derivedWork: [{ kind: "territory_derive", state: "queued" }],
                warnings: [],
                mapRevision: 4713,
            }),
        );
    });
    return geschrieben;
}

/** Das Namensfeld der Grafschaft im sichtbaren Fenster. */
const grafschaftName = (page: Page) =>
    page
        .getByTestId(/^gebietseditor-fenster-\d+-feld-name$/)
        .filter({ visible: true })
        .locator("input");

test("🔴 B2 Felder schreiben: Name tippen und Hauptstadt per Ortssuche, die Leiste zählt, „Fertig“ schreibt EINE Operation territory.update", async ({
    page,
}) => {
    // Breit, damit die Leiste über der freien Karte steht; bei 1280 px steht sie im Fenster (der Fall darunter, T45 (3)).
    await page.setViewportSize({ width: 1920, height: 1080 });
    const sperren = await stubSperre(page);
    await page.route("**/api/editor/places", (route) =>
        route.fulfill(
            json({
                wikiListe: true,
                rows: [
                    { key: ID(0x201), origin: "karte", name: "Neu-Albenhus", kind: "stadt", region: "Nordmarken" },
                    { key: ID(0x202), origin: "wiki", name: "Nur im Wiki" },
                ],
            }),
        ),
    );
    await oeffneGebietseditor(page, undefined, true);
    const geschrieben = await stubFertig(page);
    await liste(page).getByRole("searchbox").fill("Albenhus");
    await liste(page)
        .getByRole("option", { name: /Grafschaft Albenhus/ })
        .click();
    const name = grafschaftName(page);
    await expect(name).toHaveValue("Grafschaft Albenhus");
    await name.fill("Grafschaft Albenhus am See");
    await name.blur();
    const leiste = page.getByTestId("gebiet-leiste");
    await expect(leiste).toBeVisible();
    await expect(leiste).toContainText("Grafschaft Albenhus");
    // Die Hauptstadt per Ortssuche: nur Orte auf der Karte.
    await page
        .getByTestId(/^gebietseditor-fenster-\d+-hauptstadt-aendern$/)
        .filter({ visible: true })
        .click();
    await page
        .getByTestId(/^gebietseditor-fenster-\d+-hauptstadt-suche$/)
        .filter({ visible: true })
        .locator("input")
        .fill("Albenhus");
    const wahl = page.getByTestId(/^gebietseditor-fenster-\d+-hauptstadt-liste$/).filter({ visible: true });
    await expect(wahl.getByRole("button")).toHaveCount(1);
    await wahl.getByRole("button", { name: /Neu-Albenhus/ }).click();
    await expect(page.getByTestId(/^gebietseditor-fenster-\d+-hauptstadt$/).filter({ visible: true })).toContainText(
        "Neu-Albenhus",
    );
    await expect(page.getByTestId("gebiet-leiste-ungespeichert")).toContainText("2");
    expect(sperren).toEqual([{ kind: "territory", id: GRAFSCHAFT, part: "felder" }]);
    await page.screenshot({ path: "test-results/gebietseditor-b2-felder.png" });

    await page.getByTestId("gebiet-leiste-fertig").click();
    await expect(leiste).toHaveCount(0);
    expect(geschrieben).toHaveLength(1);
    expect(geschrieben[0]!.body).toMatchObject({
        baseRevision: 9,
        changes: { name: "Grafschaft Albenhus am See", capital: ID(0x201) },
    });
    expect(geschrieben[0]!.body).not.toHaveProperty("areas");
});

test("🔴 G6 Detailfelder: ↺ setzt den Wiki-Wert, Tippen den eigenen; „Fertig“ schreibt changes.details in EINER Operation", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const sperren = await stubSperre(page);
    await oeffneGebietseditor(page, undefined, true);
    const geschrieben = await stubFertig(page);
    await liste(page).getByRole("searchbox").fill("Albenhus");
    await liste(page)
        .getByRole("option", { name: /Grafschaft Albenhus/ })
        .click();
    const zeile = (feld: string) =>
        page.getByTestId(new RegExp(`^gebietseditor-fenster-\\d+-zeile-${feld}$`)).filter({ visible: true });
    const eingabe = (feld: string) =>
        page
            .getByTestId(new RegExp(`^gebietseditor-fenster-\\d+-detail-${feld}$`))
            .filter({ visible: true })
            .locator("input");
    // Der Herrscher weicht vom Wiki ab: ↺ holt „Graf Growin“, die Zeile folgt dann dem Wiki.
    await expect(zeile("ruler")).toHaveAttribute("data-zustand", "weicht");
    await expect(eingabe("ruler")).toHaveValue("Graf Ghambir");
    await zeile("ruler").getByRole("button", { name: "Oberhaupt auf den Wiki-Wert zurück" }).click();
    await expect(eingabe("ruler")).toHaveValue("Graf Growin");
    await expect(zeile("ruler")).toHaveAttribute("data-zustand", "folgt");
    // Die Währung hat keinen eigenen Wert, das Wiki nennt einen; getippt ist er eigen.
    await expect(zeile("currency").locator("s")).toHaveText("Dukaten");
    await eingabe("currency").fill("Silbertaler");
    await eingabe("currency").blur();
    // Ein Feld ohne Wiki-Wert (unbekannt) hat kein ↺.
    await expect(zeile("blazon")).toHaveAttribute("data-zustand", "unbekannt");
    await expect(zeile("blazon").getByRole("button")).toHaveCount(0);
    await expect(page.getByTestId("gebiet-leiste-ungespeichert")).toContainText("2");
    expect(sperren).toEqual([{ kind: "territory", id: GRAFSCHAFT, part: "felder" }]);
    await page.screenshot({ path: "test-results/gebietseditor-g6-detailfelder.png" });

    await page.getByTestId("gebiet-leiste-fertig").click();
    await expect(page.getByTestId("gebiet-leiste")).toHaveCount(0);
    expect(geschrieben).toHaveLength(1);
    expect(geschrieben[0]!.body).toMatchObject({
        baseRevision: 9,
        changes: { details: { ruler: { revert: "wiki" }, currency: { value: "Silbertaler" } } },
    });
    expect((geschrieben[0]!.body as { changes: object }).changes).toEqual({
        details: { ruler: { revert: "wiki" }, currency: { value: "Silbertaler" } },
    });
});

test("🔴 Eine Feldkante (Betreiber 2026-10-19: „glaubst man kann das so angleichen?“): eigene Felder, Verweise und Wiki-Felder beginnen an derselben Kante, die Eingaben enden an derselben", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await stubSperre(page);
    await oeffneGebietseditor(page, undefined, true);
    await liste(page).getByRole("searchbox").fill("Albenhus");
    await liste(page)
        .getByRole("option", { name: /Grafschaft Albenhus/ })
        .click();
    await expect(grafschaftName(page)).toHaveValue("Grafschaft Albenhus");
    // Gemessen über alle sichtbaren Zeilen der Eigenschaften: Identität und Herrschaft aus `FensterFeldzeilen`, die Detailfelder aus
    // dem Wiki-Feld. Vorher begannen die einen bei 38,2 % der Spalte, die anderen nach 130 px.
    const kanten = await page.evaluate(() => {
        const sichtbar = (element: Element): boolean => (element as HTMLElement).offsetParent !== null;
        const felder = [...document.querySelectorAll(".fenster-feldzeilen > dd, .fenster-feldzeile__feld")].filter(
            sichtbar,
        );
        const eingaben = [
            ...document.querySelectorAll(
                ".fenster-feldzeilen > dd > .eingabe-huelle, .fenster-feldzeile__feld > .eingabe-huelle",
            ),
        ].filter(sichtbar);
        const spanne = (werte: number[]): number => Math.max(...werte) - Math.min(...werte);
        return {
            zeilen: felder.length,
            eingaben: eingaben.length,
            links: spanne(felder.map((element) => element.getBoundingClientRect().left)),
            rechts: spanne(eingaben.map((element) => element.getBoundingClientRect().right)),
        };
    });
    expect(kanten.zeilen, "Zeilen gemessen").toBeGreaterThan(10);
    expect(kanten.eingaben, "Eingaben gemessen").toBeGreaterThan(5);
    expect(kanten.links, "alle Felder beginnen an einer Kante").toBeLessThanOrEqual(1);
    expect(kanten.rechts, "alle Eingaben enden an einer Kante").toBeLessThanOrEqual(1);
    await page.screenshot({ path: "test-results/gebietseditor-feldkante.png" });
});

test.describe("bei 1280 px mit offener Liste (EDIT-0003 T45 (3))", () => {
    test.use({ viewport: { width: 1280, height: 720 } });

    test("🔴 B2: keine Lücke neben Planer und Fenster, die Leiste der Felder steht unten im Fenster, „Fertig“ ist klickbar", async ({
        page,
    }) => {
        await stubSperre(page);
        await oeffneGebietseditor(page, undefined, true);
        const geschrieben = await stubFertig(page);
        await liste(page).getByRole("searchbox").fill("Albenhus");
        await liste(page)
            .getByRole("option", { name: /Grafschaft Albenhus/ })
            .click();
        await expect(liste(page)).toBeVisible();
        const name = grafschaftName(page);
        await expect(name).toHaveValue("Grafschaft Albenhus");
        await name.fill("Grafschaft Albenhus am See");
        await name.press("Tab");
        const imFenster = page.locator('dialog[data-lage="angedockt"]').getByTestId("gebiet-leiste");
        await expect(imFenster).toBeVisible();
        await expect(page.getByTestId("gebiet-leiste-fertig")).toHaveCount(1);
        await page.screenshot({ path: "test-results/gebietseditor-b2-1280.png" });
        await page.getByTestId("gebiet-leiste-fertig").click();
        await expect.poll(() => geschrieben.length).toBe(1);
        expect(geschrieben[0]!.body).toMatchObject({ changes: { name: "Grafschaft Albenhus am See" } });
        await expect(page.getByTestId("gebiet-leiste")).toHaveCount(0);
    });
});

test("🔴 T57 Mehrfachauswahl: Umschalter, zwei anhaken, gemischt und gemeinsam, ↺ für alle; „Fertig“ schreibt EINE Operation territory.sammel", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await stubSperre(page);
    await oeffneGebietseditor(page, undefined, true);
    await page.route("**/api/editor/territories/sammel/stand", (route) =>
        route.fulfill(
            json({
                territories: [
                    {
                        id: PROVINZ,
                        revision: 3,
                        status: "Herzogtum des Reichs",
                        details: { ruler: { value: "Herzog Eigen", origin: "override", wiki: "Herzog Jast" } },
                    },
                    {
                        id: GRAFSCHAFT,
                        revision: 9,
                        status: "Grafschaft der Nordmarken",
                        details: { ruler: { value: "Graf Ghambir", origin: "override", wiki: "Graf Growin" } },
                    },
                ],
            }),
        ),
    );
    const geschrieben: unknown[] = [];
    await page.route("**/api/editor/territories/sammel", (route) => {
        geschrieben.push(route.request().postDataJSON());
        return route.fulfill(
            json({
                operationId: ID(0xe5),
                status: "applied",
                environment: "test",
                affected: [
                    { kind: "territory", id: PROVINZ, revision: 4 },
                    { kind: "territory", id: GRAFSCHAFT, revision: 10 },
                ],
                derivedWork: [{ kind: "tiles", state: "queued" }],
                warnings: [],
                mapRevision: 4714,
            }),
        );
    });

    // Aus ist die Vorgabe: ein Klick wählt. An hakt er an; bei genau einem steht es wie gewählt da.
    const schalter = page.getByTestId(/^gebietseditor-fenster-\d+-gebiete-mehrfach$/).filter({ visible: true });
    await expect(schalter).toHaveAttribute("aria-pressed", "false");
    await schalter.click();
    await expect(schalter).toHaveAttribute("aria-pressed", "true");
    // Über die Suche: Die Häkchen bleiben, wenn die Suche wechselt.
    const suche = liste(page).getByRole("searchbox");
    await suche.fill("Nordmarken");
    await liste(page)
        .getByRole("option", { name: /^Nordmarken/ })
        .click();
    await expect(fenster(page)).toContainText("Nordmarken");
    await suche.fill("Albenhus");
    await liste(page)
        .getByRole("option", { name: /Grafschaft Albenhus/ })
        .click();

    const mehrfach = page.getByTestId(/^gebietseditor-fenster-\d+-mehrfach$/).filter({ visible: true });
    await expect(mehrfach).toContainText("2 Gebiete gewählt");
    await expect(reiter(page, /Hierarchie/)).toHaveAttribute("aria-disabled", "true");
    // Art und Status verschieden: leer mit „gemischt“; Name nur einzeln.
    const art = page
        .getByTestId(/^gebietseditor-fenster-\d+-mehrfach-art$/)
        .filter({ visible: true })
        .locator("input");
    await expect(art).toHaveValue("");
    await expect(art).toHaveAttribute("placeholder", "gemischt");
    await expect(mehrfach).toContainText("Nur einzeln");
    const status = page.getByTestId(/^gebietseditor-fenster-\d+-mehrfach-status$/).filter({ visible: true });
    await expect(status.locator("input")).toHaveAttribute("placeholder", "gemischt");

    await art.fill("Baronie");
    await art.blur();
    await expect(mehrfach).toContainText("gilt für alle 2");
    await page
        .getByTestId(/^gebietseditor-fenster-\d+-mehrfach-zeile-ruler-zurueck$/)
        .filter({ visible: true })
        .click();
    await expect(mehrfach).toContainText("auf Wiki-Werte, gilt für alle 2");
    const leiste = page.getByTestId("gebiet-leiste");
    await expect(leiste).toContainText("2 Gebiete gewählt");
    await expect(page.getByTestId("gebiet-leiste-ungespeichert")).toContainText("2");
    await page.screenshot({ path: "test-results/gebietseditor-t57-mehrfach.png" });

    await page.getByTestId("gebiet-leiste-fertig").click();
    await expect(leiste).toHaveCount(0);
    expect(geschrieben).toHaveLength(1);
    expect(geschrieben[0]).toMatchObject({
        territories: [
            { id: PROVINZ, baseRevision: 3 },
            { id: GRAFSCHAFT, baseRevision: 9 },
        ],
        changes: { type: "Baronie" },
        wiki: ["ruler"],
    });
    expect(geschrieben[0]).not.toHaveProperty("color");

    // Ausschalten: das zuletzt angeklickte bleibt allein gewählt.
    await schalter.click();
    await expect(mehrfach).toHaveCount(0);
    await expect(fenster(page)).toContainText("Grafschaft Albenhus");
});

/**
 * Fund 2026-10-25 (WI-0209): Bei Suche oder Filter zeigt der Baum die Vorfahren der Treffer als Kontext. „Alle n“ hakte sie mit an, und
 * „Entfernen“ legte am 20.10. so Thorwal und Orkreich still. Der Stub liefert die Liste des Tests; Stand und Schreiben sind Stubs.
 */
async function stubSammelEntfernen(
    page: Page,
): Promise<{ territories: { id: string; baseRevision: number }[]; stage: string }[]> {
    await page.route("**/api/editor/territories/sammel/stand", (route) => {
        const ids = (route.request().postDataJSON() as { ids: string[] }).ids;
        return route.fulfill(json({ territories: ids.map((id) => ({ id, revision: 5, details: {} })) }));
    });
    const entfernt: { territories: { id: string; baseRevision: number }[]; stage: string }[] = [];
    await page.route("**/api/editor/territories/sammel/retire", (route) => {
        entfernt.push(route.request().postDataJSON() as (typeof entfernt)[number]);
        return route.fulfill(
            json({
                operationId: ID(0xe6),
                status: "applied",
                environment: "test",
                affected: [],
                derivedWork: [{ kind: "territory_derive", state: "queued" }],
                warnings: [],
                mapRevision: 4720,
            }),
        );
    });
    return entfernt;
}

test("🔴 T57 Kontext-Zeilen sind nie wählbar: „Alle 2“, Strg+A und ein Klick auf den Vorfahren hängen Mittelreich und Nordmarken nicht an; Entfernen schickt nur die Treffer", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await stubSperre(page);
    await oeffneGebietseditor(page, undefined, true);
    const entfernt = await stubSammelEntfernen(page);

    await page
        .getByTestId(/^gebietseditor-fenster-\d+-gebiete-mehrfach$/)
        .filter({ visible: true })
        .click();
    await liste(page).getByRole("searchbox").fill("Grafschaft");
    // Zwei Treffer (Albenhus, Isenhag) und ihre Vorfahren Nordmarken und Mittelreich als Kontext.
    const optionen = liste(page).getByRole("option");
    await expect(optionen).toHaveCount(4);
    const alle = page.getByTestId(/^gebietseditor-fenster-\d+-gebiete-alle$/).filter({ visible: true });
    await expect(alle).toHaveText("Alle 2");
    await alle.click();
    const haken = page.getByTestId(/^gebietseditor-fenster-\d+-gebiete-haken$/).filter({ visible: true });
    await expect(haken).toContainText("2 angehakt");
    const nordmarken = liste(page).getByRole("option", { name: /^Nordmarken/ });
    const mittelreich = liste(page).getByRole("option", { name: /^Mittelreich/ });
    await expect(liste(page).getByRole("option", { name: /^Grafschaft Albenhus/ })).toHaveAttribute(
        "aria-selected",
        "true",
    );
    await expect(nordmarken).toHaveAttribute("aria-selected", "false");
    await expect(mittelreich).toHaveAttribute("aria-selected", "false");

    // Ein Klick auf den Vorfahren hakt nichts an; Strg+A auch nicht.
    await nordmarken.click();
    await expect(haken).toContainText("2 angehakt");
    await expect(nordmarken).toHaveAttribute("aria-selected", "false");
    await page
        .getByTestId(/^gebietseditor-fenster-\d+-gebiete-rumpf$/)
        .filter({ visible: true })
        .press("Control+a");
    await expect(haken).toContainText("2 angehakt");
    await expect(mittelreich).toHaveAttribute("aria-selected", "false");
    await page.screenshot({ path: "test-results/gebietseditor-kontext-nicht-waehlbar.png" });

    // Die Treffer ohne nicht gewählte Untergebiete: kein Hinweis, und der Server bekommt genau die zwei.
    await page
        .getByTestId(/^gebietseditor-fenster-\d+-mehrfach-entfernen-oeffnen$/)
        .filter({ visible: true })
        .click();
    const blatt = page.getByTestId(/^gebietseditor-fenster-\d+-mehrfach-entfernen$/).filter({ visible: true });
    await expect(blatt).toContainText("2 Gebiete ganz löschen?");
    await expect(blatt).not.toContainText("rücken hoch");
    await blatt.getByRole("button", { name: "Entfernen" }).click();
    await expect.poll(() => entfernt.length).toBe(1);
    expect(entfernt[0]!.stage).toBe("retire");
    expect(entfernt[0]!.territories.map((g) => g.id).sort()).toEqual([GRAFSCHAFT, LEER].sort());
});

test("🔴 T57 Entfernen mehrerer Gebiete nennt, wessen nicht gewählte Untergebiete hochrücken (nur ein Hinweis, keine Sperre)", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await stubSperre(page);
    await oeffneGebietseditor(page, undefined, true);
    const entfernt = await stubSammelEntfernen(page);

    await page
        .getByTestId(/^gebietseditor-fenster-\d+-gebiete-mehrfach$/)
        .filter({ visible: true })
        .click();
    // Nordmarken bewusst als Treffer anhaken, dann die beiden Grafschaften über „Alle 2“; Lückenhof bleibt Untergebiet ohne Haken.
    const suche = liste(page).getByRole("searchbox");
    await suche.fill("Nordmarken");
    await liste(page)
        .getByRole("option", { name: /^Nordmarken/ })
        .click();
    await suche.fill("Grafschaft");
    await page
        .getByTestId(/^gebietseditor-fenster-\d+-gebiete-alle$/)
        .filter({ visible: true })
        .click();
    await expect(page.getByTestId(/^gebietseditor-fenster-\d+-gebiete-haken$/).filter({ visible: true })).toContainText(
        "3 angehakt",
    );
    // Der schon gesetzte Haken an Nordmarken bleibt sichtbar, auch wenn es jetzt nur als Kontext dasteht.
    await expect(liste(page).getByRole("option", { name: /^Nordmarken/ })).toHaveAttribute("aria-selected", "true");

    await page
        .getByTestId(/^gebietseditor-fenster-\d+-mehrfach-entfernen-oeffnen$/)
        .filter({ visible: true })
        .click();
    const blatt = page.getByTestId(/^gebietseditor-fenster-\d+-mehrfach-entfernen$/).filter({ visible: true });
    await expect(blatt).toContainText("3 Gebiete ganz löschen?");
    // Lückenhof rückt hoch; die ganz gelöschte Baronie Wüstenei zählt nicht mit.
    await expect(blatt).toContainText("Nordmarken (1 Untergebiet rückt hoch)");
    await page.screenshot({ path: "test-results/gebietseditor-entfernen-hinweis.png" });
    // Keine neue Sperre: Entfernen geht weiterhin.
    await blatt.getByRole("button", { name: "Entfernen" }).click();
    await expect.poll(() => entfernt.length).toBe(1);
    expect(entfernt[0]!.territories.map((g) => g.id).sort()).toEqual([GRAFSCHAFT, LEER, PROVINZ].sort());
});

test("🔴 T57 A „Unter neues Obergebiet …“: Blatt mit Name, Spanne vor den gewählten und Folgen; EINE Operation territory.create_parent", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await stubSperre(page);
    await oeffneGebietseditor(page, undefined, true);
    await page.route("**/api/editor/territories/sammel/stand", (route) =>
        route.fulfill(
            json({
                territories: [
                    { id: REICH, revision: 2, details: {} },
                    { id: BORNLAND, revision: 5, details: {} },
                ],
            }),
        ),
    );
    const geschrieben: unknown[] = [];
    // Nach dem Anlegen liest der Editor die Liste und das neue Gebiet so, wie der Server sie liefert (alle Felder des Details; Befund
    // an Fassung 5: dort fehlte dem neuen Gebiet ein Feld, und die Eigenschaften brachen ab).
    const NEU = ID(0x300);
    let angelegt = false;
    await page.route("**/api/editor/territories", (route) => {
        if (!angelegt) return route.fallback();
        return route.fulfill(
            json({
                ...LISTE,
                rows: [
                    {
                        id: NEU,
                        name: "Bund der Reiche",
                        circle: "halb",
                        minZoom: 0,
                        maxZoom: 0,
                        color: "#888888",
                        order: 0,
                        source: "avesmaps3d",
                    },
                    ...LISTE.rows.map((r) => (r.id === REICH || r.id === BORNLAND ? { ...r, parent: NEU } : r)),
                ],
            }),
        );
    });
    await page.route(`**/api/editor/territories/${NEU}`, (route) =>
        route.fulfill(
            json({
                id: NEU,
                revision: 1,
                name: "Bund der Reiche",
                color: "#888888",
                opacity: 0.33,
                minZoom: 0,
                maxZoom: 0,
                order: 0,
                parents: [],
                children: [
                    { id: REICH, name: "Mittelreich" },
                    { id: BORNLAND, name: "Bornland" },
                ],
                details: {},
                areas: [],
                claimedBy: [],
                claims: [],
            } satisfies EditorTerritoryDetail),
        ),
    );
    const zurueck: unknown[] = [];
    await page.route(`**/api/editor/territories/${NEU}/restore`, (route) => {
        zurueck.push(route.request().postDataJSON());
        return route.fulfill(
            json({
                operationId: ID(0xe7),
                status: "applied",
                environment: "test",
                affected: [],
                derivedWork: [],
                warnings: [],
                mapRevision: 4716,
            }),
        );
    });
    await page.route("**/api/editor/territories/sammel/obergebiet", (route) => {
        geschrieben.push(route.request().postDataJSON());
        angelegt = true;
        return route.fulfill(
            json({
                operationId: ID(0xe6),
                status: "applied",
                environment: "test",
                affected: [
                    { kind: "territory", id: ID(0x300), revision: 1 },
                    { kind: "territory", id: REICH, revision: 3 },
                    { kind: "territory", id: BORNLAND, revision: 6 },
                ],
                derivedWork: [{ kind: "territory_derive", state: "queued" }],
                warnings: [],
                mapRevision: 4715,
                publicId: ID(0x300),
                name: "Bund der Reiche",
            }),
        );
    });

    const schalter = page.getByTestId(/^gebietseditor-fenster-\d+-gebiete-mehrfach$/).filter({ visible: true });
    await schalter.click();
    const suche = liste(page).getByRole("searchbox");
    await suche.fill("Mittelreich");
    await liste(page)
        .getByRole("option", { name: /^Mittelreich/ })
        .click();
    await suche.fill("Bornland");
    await liste(page)
        .getByRole("option", { name: /^Bornland/ })
        .click();
    const mehrfach = page.getByTestId(/^gebietseditor-fenster-\d+-mehrfach$/).filter({ visible: true });
    await expect(mehrfach).toContainText("2 Gebiete gewählt");

    await page
        .getByTestId(/^gebietseditor-fenster-\d+-obergebiet-neu-oeffnen$/)
        .filter({ visible: true })
        .click();
    const blatt = page.getByTestId(/^gebietseditor-fenster-\d+-obergebiet-neu$/).filter({ visible: true });
    await expect(blatt).toContainText("2 Gebiete unter ein neues Obergebiet hängen?");
    // Beide sind Wurzeln ab Band 0: Das neue hängt ganz oben und steht in Band 0.
    await expect(blatt).toContainText("Band 0–0");
    await expect(
        page.getByTestId(/^gebietseditor-fenster-\d+-obergebiet-neu-unter$/).filter({ visible: true }),
    ).toContainText("keins (Wurzel)");
    await expect(blatt).toContainText("Mittelreich und Bornland hängen danach unter dem neuen Gebiet.");
    await page
        .getByTestId(/^gebietseditor-fenster-\d+-obergebiet-neu-name$/)
        .filter({ visible: true })
        .locator("input")
        .fill("Bund der Reiche");
    await page.screenshot({ path: "test-results/gebietseditor-t57-obergebiet.png" });
    await blatt.getByRole("button", { name: "Obergebiet anlegen" }).click();

    await expect.poll(() => geschrieben.length).toBe(1);
    expect(geschrieben[0]).toMatchObject({
        territories: [
            { id: REICH, baseRevision: 2 },
            { id: BORNLAND, baseRevision: 5 },
        ],
        name: "Bund der Reiche",
        zoom: { minZoom: 0, maxZoom: 0 },
    });
    expect(geschrieben[0]).not.toHaveProperty("parent");
    expect((geschrieben[0] as { color: string }).color).toMatch(/^#[0-9a-f]{6}$/);
    // Danach ist die Mehrfachauswahl aus; das Fenster steht am neuen Gebiet, seine Eigenschaften lesen sich ganz, darüber die Meldung.
    await expect(schalter).toHaveAttribute("aria-pressed", "false");
    await expect(mehrfach).toHaveCount(0);
    // Das Fenster an Mittelreich liegt danach unter „Offene Bearbeitungen“, wie nach jedem Klick in der Liste (D19).
    await expect(fenster(page).filter({ visible: true })).toContainText(
        "Herrschaftsgebiete bearbeiten · Bund der Reiche",
    );
    await expect(
        page
            .getByTestId(/^gebietseditor-fenster-\d+-feld-name$/)
            .filter({ visible: true })
            .locator("input"),
    ).toHaveValue("Bund der Reiche");
    const meldung = page.getByTestId(/^gebietseditor-fenster-\d+-obergebiet-meldung$/).filter({ visible: true });
    await expect(meldung).toContainText(
        "Bund der Reiche angelegt; 2 Gebiete hängen darunter. Auf der Karte nach der Ableitung.",
    );
    await page.screenshot({ path: "test-results/gebietseditor-t57-obergebiet-angelegt.png" });
    await page
        .getByTestId(/^gebietseditor-fenster-\d+-obergebiet-zurueck$/)
        .filter({ visible: true })
        .click();
    await expect.poll(() => zurueck.length).toBe(1);
    expect(zurueck[0]).toMatchObject({ reverts: ID(0xe6) });
    await expect(meldung).toHaveCount(0);
});

test("🔴 T51 A Zoomspanne in den Eigenschaften: EIN Haken für Farbe und Spanne, die Untergebiete rücken um dieselben Bänder, vor „Fertig“ steht was", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await stubSperre(page);
    const geschrieben: unknown[] = [];
    await page.route("**/api/editor/territories/display", (route) => {
        geschrieben.push(route.request().postDataJSON());
        return route.fulfill(
            json({
                operationId: ID(0xe7),
                status: "applied",
                environment: "test",
                affected: [],
                derivedWork: [{ kind: "territory_derive", state: "queued" }],
                warnings: [],
                mapRevision: 4716,
            }),
        );
    });
    await oeffneGebietseditor(page, undefined, true);
    await liste(page).getByRole("searchbox").fill("Nordmarken");
    await liste(page)
        .getByRole("option", { name: /^Nordmarken/ })
        .click();
    // EIN Haken unter Farbe und Zoomspanne, an ist die Vorgabe.
    await expect(
        page.getByTestId(/^gebietseditor-fenster-\d+-farbe-mitziehen$/).filter({ visible: true }),
    ).toBeChecked();
    // „bis“ eins höher: Nordmarken 2–3 → 2–4, die Untergebiete rücken um ein Band und bleiben in 0–8.
    const spanne = page.getByTestId(/^gebietseditor-fenster-\d+-spanne$/).filter({ visible: true });
    await spanne.getByRole("slider").nth(1).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId(/^gebietseditor-fenster-\d+-feld-spanne$/).filter({ visible: true })).toHaveText(
        "Band 2–4",
    );
    const folgen = page.getByTestId(/^gebietseditor-fenster-\d+-spanne-folgen$/).filter({ visible: true });
    await expect(folgen).toContainText("Zieht mit");
    await expect(folgen).toContainText("Baronie Lückenhof: Band 6–8 → Band 7–8");
    await expect(folgen).toContainText("Grafschaft Albenhus: Band 4–8 → Band 5–8");
    await page.screenshot({ path: "test-results/gebietseditor-t51-spanne.png" });
    await page.getByTestId("baender-leiste-fertig").click();
    await expect.poll(() => geschrieben.length).toBe(1);
    const territories = (geschrieben[0] as { territories: { id: string; zoom?: unknown }[] }).territories;
    expect(Object.fromEntries(territories.map((t) => [t.id, t.zoom]))).toEqual({
        [PROVINZ]: { minZoom: 2, maxZoom: 4 },
        [GRAFSCHAFT]: { minZoom: 5, maxZoom: 8 },
        [LUECKE]: { minZoom: 7, maxZoom: 8 },
        [LEER]: { minZoom: 5, maxZoom: 8 },
    });
});

test("🔴 T51 A Reiter „Hierarchie“: derselbe Haken zieht beim Anfasser die Untergebiete mit, darunter steht vor „Fertig“, was sich verschiebt", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await stubSperre(page);
    const geschrieben: unknown[] = [];
    await page.route("**/api/editor/territories/display", (route) => {
        geschrieben.push(route.request().postDataJSON());
        return route.fulfill(
            json({
                operationId: ID(0xe8),
                status: "applied",
                environment: "test",
                affected: [],
                derivedWork: [{ kind: "territory_derive", state: "queued" }],
                warnings: [],
                mapRevision: 4717,
            }),
        );
    });
    await oeffneGebietseditor(page, undefined, true);
    await liste(page).getByRole("searchbox").fill("Nordmarken");
    await liste(page)
        .getByRole("option", { name: /^Nordmarken/ })
        .click();
    await reiter(page, "Hierarchie").click();
    await expect(
        page.getByTestId(/^gebietseditor-fenster-\d+-hierarchie-mitziehen$/).filter({ visible: true }),
    ).toBeChecked();
    // „bis“ von Nordmarken eins höher: 2–3 → 2–4; die Untergebiete rücken um ein Band.
    const bis = page.locator(`[data-hier="${PROVINZ}"]`).getByTestId("hierarchie-griff-bis");
    await bis.focus();
    await page.keyboard.press("ArrowRight");
    const folgen = page.getByTestId(/^gebietseditor-fenster-\d+-hierarchie-spanne-folgen$/).filter({ visible: true });
    await expect(folgen).toContainText("Zieht mit");
    await expect(folgen).toContainText("Baronie Lückenhof: Band 6–8 → Band 7–8");
    await expect(page.locator(`[data-hier="${LUECKE}"]`).getByTestId("hierarchie-griff-von")).toHaveAttribute(
        "aria-valuenow",
        "7",
    );
    await page.getByTestId("baender-leiste-fertig").click();
    await expect.poll(() => geschrieben.length).toBe(1);
    const zoom = Object.fromEntries(
        (geschrieben[0] as { territories: { id: string; zoom?: unknown }[] }).territories.map((t) => [t.id, t.zoom]),
    );
    expect(zoom).toEqual({
        [PROVINZ]: { minZoom: 2, maxZoom: 4 },
        [GRAFSCHAFT]: { minZoom: 5, maxZoom: 8 },
        [LUECKE]: { minZoom: 7, maxZoom: 8 },
        [LEER]: { minZoom: 5, maxZoom: 8 },
    });
});

test("🔴 Mehrfachauswahl gelb auf der Karte (Betreiber 2026-10-20): drei angehakt leuchten, abgehakt geht, ausgeschaltet nichts mehr", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await stubSperre(page);
    await oeffneGebietseditor(page, undefined, true);
    /** Die Kennungen, die die gelbe Mehrfachmarkierung im Stil trägt; `null` ohne Ebene. */
    const markiert = () =>
        page.evaluate(() => {
            const map = globalThis.avesmapsMap!;
            if (map.getLayer("mehrfach-territory-fill") === undefined) return null;
            const text = JSON.stringify(map.getFilter("mehrfach-territory-fill"));
            return [...text.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g)]
                .map((m) => m[0])
                .sort();
        });
    await page
        .getByTestId(/^gebietseditor-fenster-\d+-gebiete-mehrfach$/)
        .filter({ visible: true })
        .click();
    const suche = liste(page).getByRole("searchbox");
    for (const [wort, name] of [
        ["Nordmarken", /^Nordmarken/],
        ["Albenhus", /Grafschaft Albenhus/],
        ["Bornland", /^Bornland/],
    ] as const) {
        await suche.fill(wort);
        await liste(page).getByRole("option", { name }).click();
    }
    await expect.poll(markiert).toEqual([PROVINZ, GRAFSCHAFT, BORNLAND].sort());
    // Die Farbe ist die der Einzelauswahl.
    expect(
        await page.evaluate(() => globalThis.avesmapsMap!.getPaintProperty("mehrfach-territory-line", "line-color")),
    ).toEqual(
        await page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue("--color-map-selection").trim(),
        ),
    );

    // Abhaken nimmt die Markierung weg.
    await suche.fill("Albenhus");
    await liste(page)
        .getByRole("option", { name: /Grafschaft Albenhus/ })
        .click();
    await expect.poll(markiert).toEqual([PROVINZ, BORNLAND].sort());

    // Ausgeschaltet bleibt nur die gewöhnliche Auswahl: keine Mehrfachmarkierung mehr.
    await page
        .getByTestId(/^gebietseditor-fenster-\d+-gebiete-mehrfach$/)
        .filter({ visible: true })
        .click();
    await expect.poll(markiert).toBeNull();
});

test("🔴 Umschalt-Klick (Betreiber 2026-10-20): auf der Karte hakt er ein Gebiet an und ab und schaltet ein, ohne Rechteck-Zoom; in der Liste schaltet er ein und hakt den Bereich an", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await stubSperre(page);
    await oeffneGebietseditor(page, undefined, true);
    const schalter = page.getByTestId(/^gebietseditor-fenster-\d+-gebiete-mehrfach$/).filter({ visible: true });
    await expect(schalter).toHaveAttribute("aria-pressed", "false");
    await expect(schalter).toHaveAttribute("title", "Mehrfachauswahl (auch Umschalt-Klick)");
    const markiert = () =>
        page.evaluate(() => {
            const map = globalThis.avesmapsMap!;
            if (map.getLayer("mehrfach-territory-fill") === undefined) return null;
            const text = JSON.stringify(map.getFilter("mehrfach-territory-fill"));
            return [...text.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g)]
                .map((m) => m[0])
                .sort();
        });

    // Karte: im Kosch auf dem Zoom von Band 6 (wie `neue-flaeche.spec.ts`; in der Übersicht liegen Orte auf fast jedem Fleck), eine
    // Stelle mit genau einem Gebiet in der freien Fläche, ohne Ort, Weg oder Namen darüber.
    const zoomBand6 = politicalMinZoom(6, AVENTURIA_POLITICAL_CARTOGRAPHY.bandLeadZoom) + 0.5;
    await page.evaluate((z) => {
        globalThis.location.hash = `#x=450.000&y=560.000&z=${z.toFixed(2)}&view=political`;
    }, zoomBand6);
    await page.waitForFunction((z) => Math.abs(globalThis.avesmapsMap!.getZoom() - z) < 0.05, zoomBand6, {
        timeout: 20_000,
    });
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
    // Die Gebietskacheln kommen erst nach dem Wechsel auf „Politisch“.
    await page.waitForFunction(
        () => globalThis.avesmapsMap!.queryRenderedFeatures({ layers: ["territory-fill"] }).length > 0,
        undefined,
        { timeout: 20_000 },
    );
    // Erst wenn alles steht: Ortsmarken setzt MapLibre nach den Flächen.
    await page.waitForFunction(
        () => globalThis.avesmapsMap!.loaded() && !globalThis.avesmapsMap!.isMoving(),
        undefined,
        {
            timeout: 20_000,
        },
    );
    await page.evaluate(() => new Promise((fertig) => requestAnimationFrame(() => requestAnimationFrame(fertig))));
    const sucheFleck = () =>
        page.evaluate(() => {
            const map = globalThis.avesmapsMap!;
            const mitte = globalThis.avesmapsVisibleArea!.centre();
            for (let r = 0; r < 240; r += 4)
                for (let w = 0; w < 360; w += 20) {
                    const x = Math.round(mitte.x + r * Math.cos((w * Math.PI) / 180));
                    const y = Math.round(mitte.y + r * Math.sin((w * Math.PI) / 180));
                    const ids = new Set(
                        map
                            .queryRenderedFeatures([x, y], { layers: ["territory-fill"] })
                            .map((f) => String(f.properties["territory_public_id"])),
                    );
                    // Nur ein Gebiet und nichts darüber (ein Ort nähme den Klick vor dem Gebiet).
                    const darueber = map
                        .queryRenderedFeatures([
                            [x - 30, y - 30],
                            [x + 30, y + 30],
                        ])
                        .some((f) => /place|nodix|path|peak|powerline|route|label|name/.test(f.layer.id));
                    if (ids.size === 1 && !darueber) {
                        const rahmen = map.getCanvas().getBoundingClientRect();
                        return { x: x + rahmen.left, y: y + rahmen.top, id: [...ids][0]! };
                    }
                }
            return undefined;
        });
    // Ortsmarken setzt MapLibre nach den Flächen: Ein Fleck zählt erst, wenn er nach einer Weile noch frei ist.
    let stelle: Awaited<ReturnType<typeof sucheFleck>>;
    for (let versuch = 0; versuch < 6; versuch += 1) {
        const kandidat = await sucheFleck();
        await page.waitForTimeout(800);
        const frei =
            kandidat !== undefined &&
            (await page.evaluate(({ x, y }) => {
                const map = globalThis.avesmapsMap!;
                const rahmen = map.getCanvas().getBoundingClientRect();
                return (
                    map.queryRenderedFeatures(
                        [
                            [x - rahmen.left - 30, y - rahmen.top - 30],
                            [x - rahmen.left + 30, y - rahmen.top + 30],
                        ],
                        {
                            layers: ["place-marker", "place-marker-structure", "nodix-treffer"].filter(
                                (id) => map.getLayer(id) !== undefined,
                            ),
                        },
                    ).length === 0
                );
            }, kandidat));
        if (frei) {
            stelle = kandidat;
            break;
        }
    }
    expect(stelle, "eine Stelle mit genau einem Gebiet").toBeDefined();
    const zoom = await page.evaluate(() => globalThis.avesmapsMap!.getZoom());
    const umschaltKlick = async () => {
        // Ein Ort über dem Gebiet nähme den Klick vorher (Rang `place`); geprüft wird hier der Klick auf das Gebiet.
        await page.evaluate(() => {
            // Der Entwicklungsgriff nennt nicht alles von MapLibre; die Karte dahinter kann es.
            const map = globalThis.avesmapsMap as unknown as {
                getLayer(id: string): unknown;
                setLayoutProperty(id: string, name: string, value: string): void;
            };
            for (const id of ["place-marker", "place-marker-structure", "nodix-treffer"])
                if (map.getLayer(id) !== undefined) map.setLayoutProperty(id, "visibility", "none");
        });
        await page.evaluate(() => new Promise((fertig) => requestAnimationFrame(() => requestAnimationFrame(fertig))));
        await page.keyboard.down("Shift");
        await page.mouse.click(stelle!.x, stelle!.y);
        await page.keyboard.up("Shift");
    };
    await umschaltKlick();
    await expect(schalter).toHaveAttribute("aria-pressed", "true");
    await expect.poll(markiert).toEqual([stelle!.id]);
    await umschaltKlick();
    await expect.poll(markiert).toBeNull();
    // Kein Rechteck-Zoom aus einem Klick ohne Zug.
    expect(await page.evaluate(() => globalThis.avesmapsMap!.getZoom())).toBe(zoom);

    // Liste: ausgeschaltet, ein Klick wählt, Umschalt-Klick schaltet ein und hakt den Bereich an.
    await schalter.click();
    await expect(schalter).toHaveAttribute("aria-pressed", "false");
    const suche = liste(page).getByRole("searchbox");
    await suche.fill("Grafschaft");
    await liste(page)
        .getByRole("option", { name: /Grafschaft Albenhus/ })
        .click();
    await expect(fenster(page).filter({ visible: true })).toContainText("Albenhus");
    await liste(page)
        .getByRole("option", { name: /Grafschaft Isenhag/ })
        .click({ modifiers: ["Shift"] });
    await expect(schalter).toHaveAttribute("aria-pressed", "true");
    await expect.poll(markiert).toEqual(expect.arrayContaining([GRAFSCHAFT, LEER]));
});

test("🔴 Umschalt-Klick auf einen Ort über dem Gebiet (Editor-Orchestrierung 2026-10-20 „A“): Kein Ortseditor nimmt ihn, das Gebiet darunter wird angehakt; kein Linksklick-Menü", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await stubSperre(page);
    await oeffneGebietseditor(page, undefined, true);
    const schalter = page.getByTestId(/^gebietseditor-fenster-\d+-gebiete-mehrfach$/).filter({ visible: true });
    await expect(schalter).toHaveAttribute("aria-pressed", "false");
    const markiert = () =>
        page.evaluate(() => {
            const map = globalThis.avesmapsMap!;
            if (map.getLayer("mehrfach-territory-fill") === undefined) return null;
            const text = JSON.stringify(map.getFilter("mehrfach-territory-fill"));
            return [...text.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g)].map((m) => m[0]);
        });
    const zoomBand6 = politicalMinZoom(6, AVENTURIA_POLITICAL_CARTOGRAPHY.bandLeadZoom) + 0.5;
    await page.evaluate((z) => {
        globalThis.location.hash = `#x=450.000&y=560.000&z=${z.toFixed(2)}&view=political`;
    }, zoomBand6);
    await page.waitForFunction((z) => Math.abs(globalThis.avesmapsMap!.getZoom() - z) < 0.05, zoomBand6, {
        timeout: 20_000,
    });
    await page.waitForFunction(
        () =>
            globalThis.avesmapsMap!.loaded() &&
            !globalThis.avesmapsMap!.isMoving() &&
            globalThis.avesmapsMap!.queryRenderedFeatures({ layers: ["territory-fill"] }).length > 0,
        undefined,
        { timeout: 20_000 },
    );
    await page.waitForTimeout(800);
    // Eine Stelle auf einer Ortsmarke, unter der genau ein Gebiet liegt, frei auf der Leinwand (nicht unter dem Fenster). Die Marke
    // sitzt nicht immer mittig auf ihrem Punkt; gesucht wird darum um ihn herum. Ortsmarken setzt MapLibre nach den Flächen: mehrmals.
    // 🪤 In „Politisch“ stehen nur die Hauptstädte der gezeigten Gebiete (`IS_CAPITAL_OF_SHOWN_TERRITORY`); an mancher Stelle keine
    // (gemessen bei x=450, y=560: keine Marke). Darum geht die Suche über mehrere Stellen im selben Band.
    const sucheOrt = () =>
        page.evaluate(() => {
            const map = globalThis.avesmapsMap!;
            const orte = ["place-marker", "place-marker-structure"].filter((id) => map.getLayer(id) !== undefined);
            const rahmen = map.getCanvas().getBoundingClientRect();
            const zahl = { marken: 0, frei: 0, getroffen: 0 };
            for (const f of map.queryRenderedFeatures({ layers: orte })) {
                zahl.marken += 1;
                const [lng, lat] = (f.geometry as { coordinates: [number, number] }).coordinates;
                const mitte = map.project({ lng, lat });
                for (const dy of [0, -4, 4, -8, -12])
                    for (const dx of [0, -4, 4]) {
                        const x = Math.round(mitte.x + dx);
                        const y = Math.round(mitte.y + dy);
                        if (document.elementFromPoint(x + rahmen.left, y + rahmen.top)?.tagName !== "CANVAS") continue;
                        zahl.frei += 1;
                        if (map.queryRenderedFeatures([x, y], { layers: orte }).length === 0) continue;
                        zahl.getroffen += 1;
                        const gebiete = new Set(
                            map
                                .queryRenderedFeatures([x, y], { layers: ["territory-fill"] })
                                .map((g) => String(g.properties["territory_public_id"])),
                        );
                        if (gebiete.size === 1)
                            return { stelle: { x: x + rahmen.left, y: y + rahmen.top, id: [...gebiete][0]! }, zahl };
                    }
            }
            return { stelle: undefined, zahl };
        });
    // Erst hier, dann bei Gratenfels, Ferdok, Gareth und daneben.
    const lagen = [
        undefined,
        { x: 450.2, y: 535.64 },
        { x: 492.97, y: 524.69 },
        { x: 551.625, y: 532.969 },
        { x: 470, y: 560 },
        { x: 430, y: 520 },
        { x: 520, y: 500 },
    ];
    let fund = await sucheOrt();
    for (const lage of lagen) {
        if (lage !== undefined) {
            await page.evaluate(
                ({ lage, z }) => {
                    globalThis.location.hash = `#x=${lage.x.toFixed(3)}&y=${lage.y.toFixed(3)}&z=${z.toFixed(2)}&view=political`;
                },
                { lage, z: zoomBand6 },
            );
            // Die Kamera fliegt hin; erst danach ruht sie wieder.
            await page.waitForTimeout(300);
            await page.waitForFunction(
                () => globalThis.avesmapsMap!.loaded() && !globalThis.avesmapsMap!.isMoving(),
                undefined,
                { timeout: 20_000 },
            );
        }
        for (let versuch = 0; versuch < 4; versuch += 1) {
            fund = await sucheOrt();
            if (fund.stelle !== undefined) break;
            await page.waitForTimeout(800);
        }
        if (fund.stelle !== undefined) break;
    }
    const stelle = fund.stelle;
    expect(stelle, `eine Ortsmarke über genau einem Gebiet (${JSON.stringify(fund.zahl)})`).toBeDefined();
    const umschaltKlick = async () => {
        await page.keyboard.down("Shift");
        await page.mouse.click(stelle!.x, stelle!.y);
        await page.keyboard.up("Shift");
    };
    await umschaltKlick();
    await expect(schalter).toHaveAttribute("aria-pressed", "true");
    await expect.poll(markiert).toEqual([stelle!.id]);
    // Der Ort wurde nicht gewählt, und kein Menü ging auf.
    expect(
        await page.evaluate(
            () =>
                (
                    (
                        globalThis as unknown as { avesmapsSelectedSubject?: () => unknown }
                    ).avesmapsSelectedSubject?.() as { kind?: string } | undefined
                )?.kind,
        ),
    ).not.toBe("place");
    await expect(page.getByTestId("map-context-pointer")).toHaveCount(0);
    // Zwei Klicks am selben Fleck binnen 400 ms wären ein Doppelklick (`object-dblclick`).
    await page.waitForTimeout(500);
    await umschaltKlick();
    await expect.poll(markiert).toBeNull();
    await expect(page.getByTestId("map-context-pointer")).toHaveCount(0);
});

// Betreiber 2026-11-03 (WI-0279, E1): Editoren „dürfen die Eigenschaften von Herrschaftsgebieten verändern, aber nicht mehr ihre geometrischen Abbildungen“.
test("🔴 WI-0279 Paket 6, ein Editor ohne Sonderrolle: „Hierarchie“ und „Form“ grau mit der Sonderrolle, Obergebiet und Zoomspanne lesend, die Felder und die Farbe bleiben", async ({
    page,
}) => {
    await oeffneGebietseditor(page, undefined, true, [], ["edit_territory_form"]);
    await liste(page).getByRole("searchbox").fill("Nordmarken");
    await liste(page)
        .getByRole("option", { name: /Nordmarken/ })
        .click();
    const felder = page.getByTestId(/^gebietseditor-fenster-\d+-felder$/);
    await expect(felder).toBeVisible();
    for (const name of ["Hierarchie", "Form"]) {
        await expect(reiter(page, name)).toHaveAttribute("aria-disabled", "true");
        await expect(reiter(page, name)).toHaveAttribute("title", "nur mit der Sonderrolle Politologe");
    }
    // Der Klick geht auf den grauen Reiter selbst: Playwright wartet sonst, bis er frei wird.
    await reiter(page, "Hierarchie").click({ force: true });
    await expect(reiter(page, "Eigenschaften")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId(/^gebietseditor-fenster-\d+-obergebiet-aendern$/)).toHaveCount(0);
    await expect(page.getByTestId(/^gebietseditor-fenster-\d+-spanne$/)).toHaveCount(0);
    await expect(page.getByTestId(/^gebietseditor-fenster-\d+-farbe-wahl$/).filter({ visible: true })).toBeVisible();
    await expect(fenster(page)).not.toContainText("nur lesen");
});
