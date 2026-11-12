import { expect, test, type Page, type Route } from "@playwright/test";
import type {
    EditorPowerlineDetail,
    EditorPowerlineList,
    EditorPowerlineTargets,
    MapHistoryPage,
    OperationReceipt,
    PowerlineUpdateBody,
    RuecknahmeBody,
    RuecknahmePruefung,
    RuecknahmeVorschauBody,
    WikiBoxStand,
} from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap, settleFrame } from "./map-handle.ts";
import { editorPanelVorn } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * „Kraftlinie bearbeiten“ im Browser (WI-0205 K6, K8 auf dem gemeinsamen Entwurf O3; EDIT-0003 T44, T27 (4), (7), §4). 🔴 Kein Test
 * schreibt in die Datenbank der Entwicklung: Linie, Ziele, Sperre und Schreibweg kommen aus Stubs (den echten Schreibweg prüft
 * `editor-kraftlinien-schreiben.test.ts`).
 *
 * Problemfälle: Die Felder bleiben lesend; jede Taste wird ein Schritt; Felder und Kurve gehen in zwei Operationen; der Scheitel ist
 * nicht zu greifen; „Fertig“ schickt unveränderte Felder mit; die Sperre wird nicht genommen oder nicht freigegeben; ein Konflikt
 * verwirft den Entwurf; nach dem Neuladen ist der Entwurf weg.
 */
const PUNIN = "b2b2b2b2-0000-4000-8000-000000000001";
const ZWEITER = "b2b2b2b2-0000-4000-8000-0000000000a2";
const GARETH = "c2c2c2c2-0000-4000-8000-000000000001";
const PUNKT = "c2c2c2c2-0000-4000-8000-000000000002";
const PUNIN_ORT = "c2c2c2c2-0000-4000-8000-000000000003";
/** Ein Nodix außerhalb der Linie: Ziel für „Nodix anfügen“. */
const WEHRHEIM = "c2c2c2c2-0000-4000-8000-000000000004";
const LISTE: EditorPowerlineList = {
    rows: [
        {
            id: PUNIN,
            name: "Punin–Gareth",
            circle: "voll",
            shape: "strang",
            segments: 2,
            nodes: 3,
            ends: ["Gareth", "Punin"],
            bounds: [551, 533, 640, 610],
        },
    ],
};
const DETAIL: EditorPowerlineDetail = {
    id: PUNIN,
    name: "Punin–Gareth",
    circle: "voll",
    shape: "strang",
    segments: [
        { id: PUNIN, from: GARETH, to: PUNKT, curve: null, labelVisible: true, revision: 3 },
        { id: ZWEITER, from: PUNKT, to: PUNIN_ORT, curve: null, labelVisible: true, revision: 4 },
    ],
    nodes: [
        { id: GARETH, kind: "place", name: "Gareth", x: 551.6, y: 533, nodix: true, meets: [] },
        { id: PUNKT, kind: "nodix", x: 595, y: 570, nodix: true, meets: [] },
        { id: PUNIN_ORT, kind: "place", name: "Punin", x: 640, y: 610, nodix: true, meets: [] },
    ],
    bounds: [551, 533, 640, 610],
};
const ZIELE: EditorPowerlineTargets = {
    targets: [
        { id: GARETH, kind: "place", name: "Gareth", x: 551.6, y: 533 },
        { id: PUNIN_ORT, kind: "place", name: "Punin", x: 640, y: 610 },
        { id: WEHRHEIM, kind: "place", name: "Wehrheim", x: 600, y: 640 },
    ],
};

/** Eine Umbenennung an beiden Abschnitten: Der Name steht im Verlauf einmal, ↺ holt ihn zurück. */
const UMBENANNT = "e7e7e7e7-0000-4000-8000-000000000001";
const VERLAUF: MapHistoryPage = {
    entries: [
        {
            operationId: UMBENANNT,
            seq: 40,
            at: "2026-10-17T12:00:00.000Z",
            operation: "powerline.update_line",
            source: "editor",
            summary: "Kraftlinie „Punin–Gareth“: Felder",
            actor: { kind: "person", name: "Thomas" },
            objects: [PUNIN, ZWEITER].map((id) => ({
                kind: "powerline" as const,
                id,
                name: "Punin–Gareth",
                action: "powerline.updated",
                revisionBefore: 2,
                revisionAfter: 3,
                changes: { name: { before: "Punin-Gareth", after: "Punin–Gareth" } },
            })),
        },
    ],
};

interface Server {
    gesendet: PowerlineUpdateBody[];
    sperren: string[];
    /** Was die Linie beim nächsten Lesen ist (ein anderer hat geschrieben). */
    detail: EditorPowerlineDetail;
    /** Die nächste Antwort auf `update`; ohne die Quittung. */
    antwort?: { status: number; body: unknown } | undefined;
    /** Was der Verlauf der Linie nennt. */
    verlauf: MapHistoryPage;
    /** Was die Oberfläche der Vorprüfung und der Rücknahme des Servers schickt (WI-0265 B6b). */
    vorschauen: RuecknahmeVorschauBody[];
    ruecknahmen: RuecknahmeBody[];
}

/** Die Vorprüfung des Servers für diese Mitglieder: alles in Ordnung, mit den Gegenständen, die der Verlauf nennt. */
function pruefungAus(verlauf: MapHistoryPage, members: string[]): RuecknahmePruefung {
    const eintraege = verlauf.entries.filter((e) => members.includes(e.operationId));
    return {
        ergebnis: "ok",
        membersHash: "f".repeat(64),
        mitglieder: eintraege.map((e) => ({
            operationId: e.operationId,
            seq: e.seq,
            at: e.at,
            operation: e.operation,
            source: e.source,
            actor: e.actor,
            status: "ruecknehmbar" as const,
            offen: true,
            gegenstaende: e.objects.map((o) => ({
                kind: o.kind,
                id: o.id,
                ...(o.name === undefined ? {} : { name: o.name }),
                action: o.action,
                revisionBefore: o.revisionBefore,
                revisionAfter: o.revisionAfter,
                felder: Object.keys(o.changes),
            })),
        })),
        offen: members,
        gegenstaende: [],
        konflikte: [],
        sperren: [],
        fehlendeRechte: [],
        fremdePersonen: [],
        reasonRequired: false,
        folgen: { gegenstaende: 2, gelaende: "keines" },
    };
}

async function stubs(page: Page): Promise<Server> {
    const server: Server = {
        gesendet: [],
        sperren: [],
        detail: DETAIL,
        verlauf: VERLAUF,
        vorschauen: [],
        ruecknahmen: [],
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
    await page.route("**/api/editor/powerlines", (route) => json(route, 200, LISTE));
    await page.route(`**/api/editor/powerlines/${PUNIN}`, (route) => json(route, 200, server.detail));
    await page.route(`**/api/editor/powerlines/${PUNIN}/targets`, (route) => json(route, 200, ZIELE));
    await page.route(`**/api/editor/powerlines/${PUNIN}/history**`, (route) => json(route, 200, server.verlauf));
    await page.route(`**/api/editor/powerlines/${PUNIN}/update`, (route) => {
        server.gesendet.push(route.request().postDataJSON() as PowerlineUpdateBody);
        const anders = server.antwort;
        server.antwort = undefined;
        if (anders !== undefined) return json(route, anders.status, anders.body);
        const quittung: OperationReceipt = {
            operationId: "op",
            status: "applied",
            environment: "test",
            affected: [],
            derivedWork: [],
            warnings: [],
            mapRevision: 900,
        } as OperationReceipt;
        return json(route, 200, quittung);
    });
    // ↺ geht seit WI-0265 B6b über den Server: Vorprüfung und Rücknahme (restore-series). Die Vorprüfung antwortet aus dem Verlauf, den der Fall stellt.
    await page.route(`**/api/editor/powerlines/${PUNIN}/restore-series/preview`, (route) => {
        const body = route.request().postDataJSON() as RuecknahmeVorschauBody;
        server.vorschauen.push(body);
        return json(route, 200, pruefungAus(server.verlauf, body.members));
    });
    await page.route(`**/api/editor/powerlines/${PUNIN}/restore-series`, (route) => {
        const body = route.request().postDataJSON() as RuecknahmeBody;
        server.ruecknahmen.push(body);
        return json(route, 200, {
            operationId: "op",
            status: "applied",
            environment: "test",
            affected: [],
            derivedWork: [],
            warnings: [],
            mapRevision: 900,
            reverts: body.members,
        });
    });
    await page.route(/\/api\/editor\/locks(\/(heartbeat|release|lift))?(\?.*)?$/, (route) => {
        const url = route.request().url();
        if (route.request().method() === "GET") return json(route, 200, { locks: [] });
        server.sperren.push(url.slice(url.indexOf("/api/editor/locks")));
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
    return server;
}

async function oeffne(page: Page, vorDemOeffnen?: (server: Server) => Promise<void>): Promise<Server> {
    const server = await stubs(page);
    await vorDemOeffnen?.(server);
    await openMap(page, EDITOR_MODE);
    await editorPanelVorn(page);
    await page.getByTestId("editorpanel-kachel-kraftlinien").click();
    await page.getByTestId("editorpanel-verb").click();
    await page
        .locator('[data-testid^="kraftlinieneditor-"][data-testid$="-liste"]')
        .getByRole("option", { name: /Punin–Gareth/ })
        .click();
    return server;
}

// Das angedockte Werkzeugfenster ist breit: Erst auf einem großen Schirm bleibt neben ihm Karte für Griffe und Leiste.
test.use({ viewport: { width: 1920, height: 1080 } });

const leiste = (page: Page) => page.getByTestId("kraftlinie-leiste");
const ungespeichert = (page: Page) => page.getByTestId("kraftlinie-leiste-ungespeichert");

/** Das Feld steht in der Zeile des Wiki-Felds, nicht mehr in einem `<label>`: gegriffen wird das `<input>` selbst. */
const nameFeld = (page: Page) => page.getByTestId(/^kraftlinieneditor-fenster-\d+-feld-name$/).locator("input");

test("🔴 Eigenschaften: die erste Änderung beginnt, ein Feld ist EIN Schritt bis zum Verlassen, „Fertig“ schickt nur Geändertes", async ({
    page,
}) => {
    const server = await oeffne(page);
    // Kein Knopf „Eigenschaften bearbeiten“ mehr: Die Felder sind schreibbar, die Leiste kommt mit der ersten Änderung (T44 (1)).
    await expect(page.getByTestId(/^kraftlinieneditor-fenster-\d+-eigenschaften-bearbeiten$/)).toHaveCount(0);
    await expect(leiste(page)).toHaveCount(0);
    const name = nameFeld(page);
    await name.fill("Punin–Gareth–Linie");
    await expect(leiste(page)).toContainText("Eigenschaften bearbeiten");
    await expect.poll(() => server.sperren).toEqual(["/api/editor/locks"]);
    // Tippen in einem Feld ist EIN Schritt, auch nach dem Verlassen (T44 (3)).
    await name.press("End");
    await name.pressSequentially("s");
    await expect(ungespeichert(page)).toContainText("1");
    await name.press("Tab");
    await expect(ungespeichert(page)).toContainText("1");
    await page.getByTestId(/^kraftlinieneditor-fenster-\d+-feld-beschriftung$/).click();
    await expect(ungespeichert(page)).toContainText("2");
    // Der Fuß zeigt nur „n ungespeichert“, kein Speichern (T27 (4)).
    await expect(page.getByTestId(/^kraftlinieneditor-fenster-\d+-ungespeichert$/)).toContainText("2");
    await page.getByTestId("kraftlinie-leiste-fertig").click();
    await expect.poll(() => server.gesendet.length).toBe(1);
    expect(server.gesendet[0]).toMatchObject({
        segments: [
            { id: PUNIN, baseRevision: 3 },
            { id: ZWEITER, baseRevision: 4 },
        ],
        name: "Punin–Gareth–Linies",
        labelVisible: false,
    });
    expect(server.gesendet[0]).not.toHaveProperty("description");
    await expect(leiste(page)).toHaveCount(0);
    await expect.poll(() => server.sperren.at(-1)).toBe("/api/editor/locks/release");
});

test("🔴 ein Konflikt lässt den Entwurf stehen: anwenden · übernehmen · überschreiben im Fenster", async ({ page }) => {
    const server = await oeffne(page);
    await nameFeld(page).fill("Punin–Gareth–Linie");
    await nameFeld(page).press("Tab");
    server.antwort = {
        status: 409,
        body: { error: { code: "edit_conflict", message: "Jemand war schneller.", details: {} } },
    };
    // Ein anderer hat inzwischen die Beschreibung geschrieben: Das überschneidet sich nicht mit dem Namen.
    server.detail = {
        ...DETAIL,
        description: "Von Thomas.",
        segments: DETAIL.segments.map((a) => ({ ...a, revision: a.revision + 1 })),
    };
    await page.getByTestId("kraftlinie-leiste-fertig").click();
    const kasten = page.getByTestId(/^kraftlinieneditor-fenster-\d+-konflikt$/);
    await expect(kasten).toBeVisible();
    await expect(kasten).toContainText("Beschreibung");
    await expect(kasten.getByRole("button")).toHaveCount(3);
    await expect(nameFeld(page)).toHaveValue("Punin–Gareth–Linie");
    await kasten.getByTestId(/-konflikt-anwenden$/).click();
    await expect.poll(() => server.gesendet.length).toBe(2);
    expect(server.gesendet[1]).toMatchObject({
        segments: [
            { id: PUNIN, baseRevision: 4 },
            { id: ZWEITER, baseRevision: 5 },
        ],
        name: "Punin–Gareth–Linie",
    });
    expect(server.gesendet[1]).not.toHaveProperty("description");
    await expect(kasten).toHaveCount(0);
});

test("🔴 nach dem Neuladen steht der Entwurf unter „Offene Bearbeitungen“ und kommt mit dem Fenster zurück (R1, D19)", async ({
    page,
}) => {
    await oeffne(page);
    await nameFeld(page).fill("Punin–Gareth–Linie");
    await nameFeld(page).press("Tab");
    await expect(ungespeichert(page)).toContainText("1");
    // Gesichert wird kurz nach dem letzten Schritt.
    await expect
        .poll(() =>
            page.evaluate(() =>
                Object.keys(globalThis.localStorage).some((k) => k.includes("powerline") && k.includes("b2b2b2b2")),
            ),
        )
        .toBe(true);
    await page.reload();
    await editorPanelVorn(page);
    const ablage = page.getByTestId("editor-panel-bearbeitungen");
    await expect(ablage).toContainText("Punin–Gareth");
    await ablage.getByRole("button", { name: /Punin–Gareth/ }).click();
    await expect(nameFeld(page)).toHaveValue("Punin–Gareth–Linie");
    await expect(page.getByTestId(/^kraftlinieneditor-fenster-\d+-ungespeichert$/)).toContainText("1");
});

// 🔴 Die Wiki-Box der Linie (WI-0253, `fenster/wiki-box.vue`; Betreiber 2026-10-25: „perfekt das wollen wir“). Sie löste den Kasten „Wiki-Artikel“ im Entwurf ab, dessen Fall hier stand
// („Wiki-Artikel je Linie“, bis 08a5d3d6b auf `fixme`): Zuweisen wirkt SOFORT auf dem Server und braucht kein „Fertig“, die Felder lesen die Linie danach neu. Die Wiki-Felder und die
// Feldkante, die der alte Fall mitprüfte, stehen unverändert darin. Server: `apps/server/test/wiki-box.test.ts`, Rechnung: `apps/web/test/wiki-box.test.ts`.
test("🔴 Wiki-Box der Linie: Zuweisen wirkt sofort ohne „Fertig“, die Wiki-Felder zeigen gleich seine Werte, ↺ ist EIN Schritt, „Fertig“ schreibt nur ihn", async ({
    page,
}) => {
    const json = (route: Route, body: unknown) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    const ARTIKEL = {
        key: "punin-gareth-ader",
        url: "https://de.wiki-aventurica.de/wiki/Punin-Gareth-Ader",
        name: "Punin-Gareth-Ader",
        werte: {
            name: "Punin-Gareth-Ader",
            description: "Eine Ader im Garetischen.",
            staerke: "stark",
            affinitaet: "Feuer",
            laenge: "80 Meilen",
            regionen: "Garetien",
        },
    };
    const box = { suchen: [] as (string | null)[], zuweisen: [] as unknown[], zugewiesen: false };
    const stand = (): WikiBoxStand => ({
        art: "kraftlinie",
        id: PUNIN,
        name: "Punin–Gareth",
        artikel: box.zugewiesen ? { key: ARTIKEL.key, url: ARTIKEL.url, name: ARTIKEL.name } : null,
        // Lokal gibt es keinen Abruf (409 `abruf_gesperrt`): Zuweisen wirkt trotzdem, der Sync wartet nicht.
        sync: {
            moeglich: false,
            grund: box.zugewiesen ? "abruf_gesperrt" : "kein_artikel",
            laeuft: false,
            letzter: null,
            fehler: null,
        },
    });
    const server = await oeffne(page, async (s) => {
        await page.route(`**/api/editor/wiki-box/kraftlinie/${PUNIN}`, (route) => json(route, stand()));
        await page.route(`**/api/editor/wiki-box/kraftlinie/${PUNIN}/suche**`, (route) => {
            const q = new URL(route.request().url()).searchParams.get("q");
            box.suchen.push(q);
            const treffer = [
                ARTIKEL,
                { key: "nebelband", url: "https://de.wiki-aventurica.de/wiki/Nebelband", name: "Nebelband", werte: {} },
            ].filter((a) => q === null || a.name.toLowerCase().includes(q.toLowerCase()));
            return json(route, { articles: treffer });
        });
        await page.route(`**/api/editor/wiki-box/kraftlinie/${PUNIN}/zuweisen`, (route) => {
            box.zuweisen.push(route.request().postDataJSON());
            box.zugewiesen = true;
            // Der Server schreibt den Artikel an alle Abschnitte (neue Revision); das Fenster liest die Linie danach neu.
            s.detail = {
                ...DETAIL,
                wiki: { url: ARTIKEL.url, title: ARTIKEL.name },
                article: ARTIKEL,
                segments: DETAIL.segments.map((a) => ({
                    ...a,
                    revision: a.revision + 1,
                    wiki: { url: ARTIKEL.url, title: ARTIKEL.name },
                })),
            };
            return json(route, {
                operationId: "op",
                status: "applied",
                environment: "test",
                affected: [],
                derivedWork: [],
                warnings: [],
                mapRevision: 901,
            });
        });
    });
    const kennung = /^kraftlinieneditor-fenster-\d+-wiki-/;
    const wiki = (teil: string) => page.getByTestId(new RegExp(`${kennung.source}${teil}$`));
    await expect(wiki("ohne-artikel")).toBeVisible();
    await wiki("zuweisen").click();
    await wiki("suche").fill("gareth");
    await expect(wiki("treffer")).toHaveCount(1);
    await expect(wiki("treffer")).toContainText("stark · Garetien");
    await wiki("treffer").click();
    // Zugewiesen ist es SOFORT: auf dem Server, ohne Entwurf, ohne „Fertig“ und ohne Operation der Felder.
    await expect(wiki("artikel")).toContainText("Punin-Gareth-Ader");
    expect(box.zuweisen).toHaveLength(1);
    expect(box.zuweisen[0]).toMatchObject({ key: "punin-gareth-ader" });
    expect(box.suchen).toContain("gareth");
    expect(server.gesendet).toEqual([]);
    await expect(leiste(page)).toHaveCount(0);
    // Die Wiki-Felder zeigen sofort die Werte des Artikels (WI-0225, §13.8): Der Name weicht ab (braun, Wiki-Wert durchgestrichen,
    // ↺ wach), die leere Beschreibung folgt dem Wiki (Legacy: „Handgetipptes schlägt Wiki“), was nur das Wiki führt, steht lesend da.
    const zeile = (feld: string) => page.getByTestId(new RegExp(`^kraftlinieneditor-fenster-\\d+-zeile-${feld}$`));
    const feld = (name: string) => page.getByTestId(new RegExp(`^kraftlinieneditor-fenster-\\d+-feld-${name}$`));
    await expect(zeile("name")).toHaveAttribute("data-zustand", "weicht");
    await expect(zeile("name").getByTestId(/-zeile-name-wiki$/)).toHaveText("Punin-Gareth-Ader");
    await expect(zeile("beschreibung")).toHaveAttribute("data-zustand", "folgt");
    await expect(feld("beschreibung")).toHaveValue("Eine Ader im Garetischen.");
    await expect(zeile("affinitaet")).toHaveAttribute("data-zustand", "lesend");
    await expect(feld("affinitaet").locator("input")).toHaveValue("Feuer");
    await expect(feld("affinitaet").locator("input")).toBeDisabled();
    await expect(zeile("affinitaet").getByTestId(/-zurueck$/)).toHaveCount(0);
    // Eine Feldkante (Betreiber 2026-10-19: „glaubst man kann das so angleichen?“): alle Zeilen der Identität beginnen an derselben
    // Kante, die Eingaben enden an derselben (wie `gebietseditor.spec` „Eine Feldkante …“).
    const kanten = await page.evaluate(() => {
        const kasten = document.querySelector('[data-testid^="kraftlinieneditor-fenster-"][data-testid$="-felder"]');
        const sichtbar = (element: Element): boolean => (element as HTMLElement).offsetParent !== null;
        const felder = [...(kasten?.querySelectorAll(".fenster-feldzeile__feld") ?? [])].filter(sichtbar);
        const eingaben = [...(kasten?.querySelectorAll(".fenster-feldzeile__feld > .eingabe-huelle") ?? [])].filter(
            sichtbar,
        );
        const spanne = (werte: number[]): number => Math.max(...werte) - Math.min(...werte);
        return {
            zeilen: felder.length,
            eingaben: eingaben.length,
            links: spanne(felder.map((element) => element.getBoundingClientRect().left)),
            rechts: spanne(eingaben.map((element) => element.getBoundingClientRect().right)),
        };
    });
    expect(kanten.zeilen, "Zeilen gemessen: Name, Beschriftung, Beschreibung und vier lesende").toBeGreaterThanOrEqual(
        7,
    );
    expect(kanten.eingaben, "Eingaben gemessen").toBeGreaterThanOrEqual(5);
    expect(kanten.links, "alle Felder beginnen an einer Kante").toBeLessThanOrEqual(1);
    expect(kanten.rechts, "alle Eingaben enden an einer Kante").toBeLessThanOrEqual(1);
    // ↺ am Namen: EIN Schritt, das Feld steht auf dem Wiki-Namen, danach still.
    await zeile("name")
        .getByTestId(/-zeile-name-zurueck$/)
        .click();
    await expect(nameFeld(page)).toHaveValue("Punin-Gareth-Ader");
    // ↺ setzt Wert und Herkunft wiki (Modell c): Die Zeile folgt dem Wiki.
    await expect(zeile("name")).toHaveAttribute("data-zustand", "folgt");
    await expect(ungespeichert(page)).toContainText("1");
    // Mit dem Entwurf sperrt die Box (Zuweisen und Entfernen wirken auf dem Server, ein Entwurf ginge beim Neulesen verloren).
    await expect(wiki("zuweisen")).toBeDisabled();
    await expect(wiki("entfernen")).toBeDisabled();
    await page.getByTestId("kraftlinie-leiste-fertig").click();
    await expect.poll(() => server.gesendet.length).toBe(1);
    // ↺ geht als `{ revert: "wiki" }` (WI-0225, Herkunft wiki); den Artikel schickt „Fertig“ nicht mehr mit - er ist schon zugewiesen.
    expect(server.gesendet[0]).toMatchObject({ name: { revert: "wiki" } });
    expect(server.gesendet[0]).not.toHaveProperty("wiki");
    await expect(wiki("zuweisen")).toBeEnabled();
});

test("🔴 Verlauf: der Name einmal, ↺ fragt den Server und nimmt ihn mit EINER Rücknahme zurück; während einer Bearbeitung gesperrt (T44)", async ({
    page,
}) => {
    const server = await oeffne(page);
    await page.getByTestId(/^kraftlinieneditor-fenster-\d+-reiter-verlauf$/).click();
    const eintrag = page.getByTestId(/^kraftlinieneditor-fenster-\d+-verlauf-eintrag$/);
    await expect(eintrag).toHaveCount(1);
    await expect(eintrag).toContainText("Kraftlinie „Punin–Gareth“: Felder");
    await eintrag.locator("summary").click();
    await expect(eintrag.locator("dt")).toHaveText(["Name"]);
    const zurueck = eintrag.locator('[data-testid$="-ruecknahme"]');
    // Mitten in einer Bearbeitung geht ↺ nicht: erst eine Änderung in den Eigenschaften, dann zurück zum Verlauf.
    await page.getByTestId(/^kraftlinieneditor-fenster-\d+-reiter-eigenschaften$/).click();
    await nameFeld(page).fill("Punin–Gareth–Linie");
    await page.getByTestId(/^kraftlinieneditor-fenster-\d+-reiter-verlauf$/).click();
    // Der Reiter zeichnet den Verlauf neu: Das Detail des Eintrags ist wieder zu.
    await eintrag.locator("summary").click();
    await expect(zurueck).toBeDisabled();
    await page.getByTestId("kraftlinie-leiste-verwerfen").click();
    await page.keyboard.press("Escape");
    await expect(leiste(page)).toHaveCount(0);
    await expect(zurueck).toBeEnabled();
    await zurueck.click();
    const frage = eintrag.locator('[data-testid$="-ruecknahme-frage"]');
    await expect(frage).toContainText("Diese Änderung zurücknehmen?");
    expect(server.vorschauen).toEqual([{ members: [UMBENANNT] }]);
    expect(server.ruecknahmen).toHaveLength(0);
    await frage.getByRole("button", { name: "Zurücknehmen", exact: true }).click();
    await expect.poll(() => server.ruecknahmen.length).toBe(1);
    expect(server.ruecknahmen[0]).toEqual({
        operationId: expect.any(String),
        members: [UMBENANNT],
        membersHash: "f".repeat(64),
    });
    // Geschrieben hat der Server, nicht die Oberfläche: kein `update` des Clients.
    expect(server.gesendet).toHaveLength(0);
});

test("🔴 ↺ an „Nodix anfügen“ und ↺ an „Nodix herausnehmen“ gehen je als EINE Rücknahme an den Server (die Abschnitte entfallen und kommen dort zurück)", async ({
    page,
}) => {
    const DRITTER = "b2b2b2b2-0000-4000-8000-0000000000a3";
    const eintrag = (operationId: string, seq: number, objects: MapHistoryPage["entries"][number]["objects"]) => ({
        operationId,
        seq,
        at: "2026-10-17T12:00:00.000Z",
        operation: "powerline.update_line",
        source: "editor" as const,
        summary: "Kraftlinie „Punin–Gareth“: Form und Felder",
        actor: { kind: "person" as const, name: "Thomas" },
        objects,
    });
    const abschnitt = (id: string, action: string, changes: Record<string, { before?: unknown; after?: unknown }>) => ({
        kind: "powerline" as const,
        id,
        name: "Punin–Gareth",
        action,
        revisionBefore: 2,
        revisionAfter: 3,
        changes,
    });
    const ANGEFUEGT = "e7e7e7e7-0000-4000-8000-000000000002";
    const HERAUS = "e7e7e7e7-0000-4000-8000-000000000003";
    const server = await stubs(page);
    server.verlauf = {
        entries: [
            // Zuletzt: an Punkt angefügt bis Punin (der zweite Abschnitt).
            eintrag(ANGEFUEGT, 42, [
                abschnitt(PUNIN, "powerline.updated", {}),
                {
                    ...abschnitt(ZWEITER, "powerline.created", {
                        from: { after: PUNKT },
                        to: { after: PUNIN_ORT },
                        active: { after: true },
                    }),
                    revisionBefore: null,
                    revisionAfter: 4,
                },
            ]),
            // Davor: Wehrheim herausgenommen (Gareth – Wehrheim – Punkt war die Linie).
            eintrag(HERAUS, 41, [
                abschnitt(PUNIN, "powerline.updated", { to: { before: WEHRHEIM, after: PUNKT } }),
                {
                    ...abschnitt(DRITTER, "powerline.removed", { active: { before: true, after: false } }),
                    revisionAfter: 6,
                },
            ]),
        ],
    };
    await openMap(page, EDITOR_MODE);
    await editorPanelVorn(page);
    await page.getByTestId("editorpanel-kachel-kraftlinien").click();
    await page.getByTestId("editorpanel-verb").click();
    await page
        .locator('[data-testid^="kraftlinieneditor-"][data-testid$="-liste"]')
        .getByRole("option", { name: /Punin–Gareth/ })
        .click();
    await page.getByTestId(/^kraftlinieneditor-fenster-\d+-reiter-verlauf$/).click();
    const eintraege = page.getByTestId(/^kraftlinieneditor-fenster-\d+-verlauf-eintrag$/);
    const ruecknahme = (n: number) => eintraege.nth(n).locator('[data-testid$="-ruecknahme"]');
    await expect(eintraege).toHaveCount(2);
    // Das Detail eines Eintrags trägt das ↺; nach einer Rücknahme liest der Verlauf neu und zeichnet die Einträge wieder zu.
    await eintraege.nth(0).locator("summary").click();
    await ruecknahme(0).click();
    await eintraege
        .nth(0)
        .locator('[data-testid$="-ruecknahme-frage"]')
        .getByRole("button", { name: "Zurücknehmen", exact: true })
        .click();
    await expect.poll(() => server.ruecknahmen.length).toBe(1);
    expect(server.ruecknahmen[0]).toMatchObject({ members: [ANGEFUEGT] });
    await eintraege.nth(1).locator("summary").click();
    await expect(ruecknahme(1)).toBeEnabled();
    await ruecknahme(1).click();
    await eintraege
        .nth(1)
        .locator('[data-testid$="-ruecknahme-frage"]')
        .getByRole("button", { name: "Zurücknehmen", exact: true })
        .click();
    await expect.poll(() => server.ruecknahmen.length).toBe(2);
    expect(server.ruecknahmen[1]).toMatchObject({ members: [HERAUS] });
    expect(server.vorschauen).toEqual([{ members: [ANGEFUEGT] }, { members: [HERAUS] }]);
    // Geschrieben hat der Server, nicht die Oberfläche: kein `update` des Clients.
    expect(server.gesendet).toHaveLength(0);
});

test("🔴 R5: „✕“ an einem Nodix in der Mitte verbindet die Nachbarn; „Fertig“ schreibt Umhängen und Entfallen in EINER Operation", async ({
    page,
}) => {
    const server = await oeffne(page);
    await page.getByTestId(new RegExp(`^kraftlinieneditor-fenster-\\d+-heraus-${PUNKT}$`)).click();
    // Die Kurve hängt an (der Schritt ist auf der Karte zu sehen), die Kette zeigt den Entwurf: Gareth – Punin.
    await expect(leiste(page)).toContainText("Kurve bearbeiten");
    await expect(ungespeichert(page)).toContainText("1");
    const kette = page.getByTestId(/^kraftlinieneditor-fenster-\d+-nodices$/);
    await expect(kette.locator("[data-knoten]")).toHaveCount(2);
    await page.getByTestId("kraftlinie-leiste-fertig").click();
    await expect.poll(() => server.gesendet.length).toBe(1);
    expect(server.gesendet[0]).toMatchObject({
        segments: [
            { id: PUNIN, baseRevision: 3, to: PUNIN_ORT },
            { id: ZWEITER, baseRevision: 4, remove: true },
        ],
    });
});

test("🔴 „✚ Nodix anfügen“: von einem Ende zu einem Nodix außerhalb der Linie, ein Schritt; „Fertig“ schreibt ihn als neuen Abschnitt", async ({
    page,
}) => {
    const server = await oeffne(page);
    await page.getByTestId(/^kraftlinieneditor-fenster-\d+-anfuegen$/).click();
    const kasten = page.getByTestId(/^kraftlinieneditor-fenster-\d+-anfuegen-kasten$/);
    // Nur Nodices außerhalb der Linie stehen zur Wahl.
    await expect(kasten.getByTestId(/-anfuegen-ziel$/)).toHaveText(["Wehrheim"]);
    await kasten.getByTestId(/-anfuegen-ziel$/).click();
    await expect(ungespeichert(page)).toContainText("1");
    await page.getByTestId("kraftlinie-leiste-fertig").click();
    await expect.poll(() => server.gesendet.length).toBe(1);
    expect(server.gesendet[0]).toMatchObject({ add: [{ from: PUNIN_ORT, to: WEHRHEIM }] });
});

test("🔴 Kurve bearbeiten: der Scheitel je Abschnitt ist ein Griff; sein Zug ist ein Schritt, „Fertig“ schreibt den Bogen", async ({
    page,
}) => {
    const server = await oeffne(page);
    // Ein Modus der Form zieht die Liste des angedockten Fensters ein und stellt sie am Ende wieder her (EDIT-0003, Regel 7).
    const schalter = page.getByTestId(/^kraftlinieneditor-fenster-\d+-listenschalter$/);
    await expect(schalter).toHaveAttribute("aria-expanded", "true");
    await page.getByTestId(/^kraftlinieneditor-fenster-\d+-kurve-bearbeiten$/).click();
    await expect(leiste(page)).toContainText("Kurve bearbeiten");
    await expect(schalter).toHaveAttribute("aria-expanded", "false");
    await page.waitForFunction(
        () => (globalThis.avesmapsMap?.queryRenderedFeatures({ layers: ["geometrie-steuer"] }) ?? []).length === 2,
        undefined,
        { timeout: 20_000 },
    );
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
    await settleFrame(page);
    const griff = await page.evaluate((id) => {
        const map = globalThis.avesmapsMap!;
        const f = map
            .queryRenderedFeatures({ layers: ["geometrie-steuer"] })
            .find((x) => x.properties["objekt"] === id)!;
        const [lng, lat] = (f.geometry as { coordinates: [number, number] }).coordinates;
        const at = map.project({ lng, lat });
        const rahmen = map.getCanvas().getBoundingClientRect();
        return { x: rahmen.left + at.x, y: rahmen.top + at.y };
    }, PUNIN);
    await page.mouse.move(griff.x, griff.y);
    await page.mouse.down();
    await page.mouse.move(griff.x + 30, griff.y - 30, { steps: 8 });
    await page.mouse.up();
    await expect(ungespeichert(page)).toContainText("1");
    await page.getByTestId("kraftlinie-leiste-fertig").click();
    await expect.poll(() => server.gesendet.length).toBe(1);
    const [erster, zweiter] = server.gesendet[0]!.segments;
    expect(erster?.id).toBe(PUNIN);
    expect(typeof erster?.curve).toBe("number");
    expect(erster?.curve).not.toBe(0);
    expect(zweiter).toEqual({ id: ZWEITER, baseRevision: 4 });
    await expect(schalter).toHaveAttribute("aria-expanded", "true");
    await page.screenshot({ path: "test-results/kraftlinie-kurve.png" });
});

test.describe("auf dem Standardschirm 1280 × 720", () => {
    test.use({ viewport: { width: 1280, height: 720 } });

    test("🔴 Kurve bearbeiten: Die Liste zieht ein, die Leiste steht ganz zu sehen und behält ihren Platz, beide Griffe liegen auf der Karte (EDIT-0003, Regel 7, T45 (3); WI-0218 §10)", async ({
        page,
    }) => {
        // Der Hinweis zur Kamera stünde beim ersten Besuch mitten in der schmalen freien Karte: als gesehen gemerkt.
        await page.addInitScript(() => globalThis.localStorage.setItem("avesmaps3d.hinweis-3d", "gesehen"));
        const server = await oeffne(page);
        const schalter = page.getByTestId(/^kraftlinieneditor-fenster-\d+-listenschalter$/);
        await page.getByTestId(/^kraftlinieneditor-fenster-\d+-kurve-bearbeiten$/).click();
        await expect(schalter).toHaveAttribute("aria-expanded", "false");
        await page.waitForFunction(
            () => (globalThis.avesmapsMap?.queryRenderedFeatures({ layers: ["geometrie-steuer"] }) ?? []).length === 2,
            undefined,
            { timeout: 20_000 },
        );
        await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
        await settleFrame(page);
        // Die Leiste wählt ihren Platz einmal beim Erscheinen und behält ihn (EDIT-0003 T45 (3), nachgeschärft 2026-10-19, 24723238f):
        // auf der Karte nur, wenn sie dort samt Laschen in einer Zeile Platz hat, sonst unten im Fenster. Bei 1280 px reicht die Lücke
        // neben dem Planer nicht: Sie steht im Fenster, ganz zu sehen und nicht gequetscht.
        await expect(leiste(page)).toBeInViewport({ ratio: 1 });
        const fenster = await page
            .locator('[data-testid^="kraftlinieneditor-fenster-"][data-map-overlay]')
            .first()
            .boundingBox();
        /** Wo die Leiste steht: links neben dem Fenster auf der Karte oder im Fenster; `undefined`, wenn gequetscht oder dazwischen. */
        const lageDerLeiste = async (): Promise<"karte" | "fenster" | undefined> => {
            const box = await leiste(page).boundingBox();
            if (box === null || fenster === null || box.width < 240) return undefined;
            if (box.x + box.width <= fenster.x) return "karte";
            return box.x >= fenster.x - 1 && box.x + box.width <= fenster.x + fenster.width + 1 ? "fenster" : undefined;
        };
        await expect.poll(lageDerLeiste).not.toBe(undefined);
        const platz = await lageDerLeiste();
        // Die Kamera passt beim Start ein, als die Liste noch offen stand, und nach ihrem Einzug noch einmal (WI-0218 §10, c403191fe);
        // der Kameraring, der bei 1280 px IN der Lücke steht, zählt für das Ziel als Deckung (4da19a18f). Dann liegen beide Griffe
        // zwischen Planer und Fenster, und an beiden liegt obenauf die Karte selbst: keiner unter dem Fenster, keiner unter dem Ring.
        const griffe = (): Promise<
            { objekt: unknown; x: number; y: number; zwischen: boolean; aufDerKarte: boolean }[] | undefined
        > =>
            page.evaluate(() => {
                const map = globalThis.avesmapsMap!;
                if (map.isMoving()) return undefined;
                const rahmen = map.getCanvas().getBoundingClientRect();
                const links =
                    document.querySelector("#route-planner-panel")?.getBoundingClientRect().right ?? rahmen.left;
                const rechts =
                    document
                        .querySelector('[data-testid^="kraftlinieneditor-fenster-"][data-map-overlay]')
                        ?.getBoundingClientRect().left ?? rahmen.right;
                return map.queryRenderedFeatures({ layers: ["geometrie-steuer"] }).map((f) => {
                    const [lng, lat] = (f.geometry as { coordinates: [number, number] }).coordinates;
                    const at = map.project({ lng, lat });
                    const x = rahmen.left + at.x;
                    const y = rahmen.top + at.y;
                    return {
                        objekt: f.properties["objekt"],
                        x,
                        y,
                        zwischen: x > links && x < rechts && y > rahmen.top && y < rahmen.bottom,
                        aufDerKarte: document.elementFromPoint(x, y) === map.getCanvas(),
                    };
                });
            });
        await expect
            .poll(async () => (await griffe())?.every((g) => g.zwischen && g.aufDerKarte) === true, {
                timeout: 15_000,
                message: "beide Griffe zwischen Planer und Fenster, keiner unter dem Kameraring",
            })
            .toBe(true);
        await settleFrame(page);
        // Beide greifbar: Jeder Zug ist ein Schritt, „Fertig“ schreibt beide Bögen. Vor jedem Zug steht die Karte still, und der Griff wird
        // neu gelesen (nach dem ersten Zug darf die Leiste wachsen oder die Kamera nachführen); er liegt dann noch auf der Karte.
        expect(((await griffe()) ?? []).map((g) => g.objekt).sort()).toEqual([PUNIN, ZWEITER].sort());
        for (const objekt of [PUNIN, ZWEITER]) {
            await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
            await settleFrame(page);
            const griff = ((await griffe()) ?? []).find((g) => g.objekt === objekt);
            expect(griff, `Griff an ${objekt}`).toMatchObject({ zwischen: true, aufDerKarte: true });
            await page.mouse.move(griff!.x, griff!.y);
            await page.mouse.down();
            await page.mouse.move(griff!.x + 20, griff!.y - 20, { steps: 8 });
            await page.mouse.up();
        }
        // Den Platz behält sie, auch nach den Zügen (T45 (3)): Sie springt nicht zwischen Karte und Fenster.
        await expect.poll(lageDerLeiste).toBe(platz);
        // Zwei Züge, zwei Schritte; beide Bögen gehen in EINER Operation.
        await expect(ungespeichert(page)).toContainText("2");
        await page.getByTestId("kraftlinie-leiste-fertig").click();
        await expect.poll(() => server.gesendet.length).toBe(1);
        for (const abschnitt of server.gesendet[0]!.segments) {
            expect(typeof abschnitt.curve, `Bogen an ${abschnitt.id}`).toBe("number");
            expect(abschnitt.curve).not.toBe(0);
        }
        await expect(schalter).toHaveAttribute("aria-expanded", "true");
        await page.screenshot({ path: "test-results/kraftlinie-kurve-1280.png" });
    });
});
