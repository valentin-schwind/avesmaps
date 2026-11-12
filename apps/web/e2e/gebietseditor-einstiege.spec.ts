import { expect, test, type Page } from "@playwright/test";
import {
    AVENTURIA_POLITICAL_CARTOGRAPHY,
    politicalMinZoom,
    type EditorTerritoryDetail,
    type EditorTerritoryForm,
    type EditorTerritoryList,
} from "@avesmaps3d/shared";
import { EDITOR_MODE, onPage, readCamera, settleFrame } from "./map-handle.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Die Einstiege des Gebietseditors auf der Karte (WI-0209 Paket A4; EDIT-0005 §7 „A4“, H3, H4; EDIT-0003 T23 Frage 2, T25, R3, T32). Die
 * Gebiete kommen aus den Kacheln der lokalen Karte wie in `territories.spec.ts`; Liste und Detail des Gebietseditors aus einem Stub.
 * 🔴 Kein Test schreibt in die Datenbank der Entwicklung.
 *
 * Problemfälle: Der Rechtsklick nimmt ein Gebiet, das das Band gar nicht zeigt (in Band 2 die Baronie statt der Provinz), oder in
 * Band 6 dasselbe wie in Band 2; „Eigenschaften bearbeiten“ öffnet ein anderes Gebiet; „Gebietsform bearbeiten“ ist vor C1
 * anklickbar; über zwei Gebieten wählt das Kartenmenü oder der Doppelklick still eines; der Doppelklick verlässt „Politisch“ oder sagt
 * nicht, warum nichts startet; ein Klick im Editor-Modus öffnet den geschlossenen Gebietseditor nicht.
 */

const bandBeginn = (band: number): number => politicalMinZoom(band, AVENTURIA_POLITICAL_CARTOGRAPHY.bandLeadZoom);
/** Mitten im Kosch (wie `landschaftseditor-kartenmenue.spec.ts`). */
const KOSCH = { x: 450, y: 560 };
/** Die Ecke der Baronie, die „Gebietsform bearbeiten“ zieht (Karte). */
const KOSCH_ECKE = { x: 460, y: 552 };
/** Wo sich im obersten Band Norburg und das Freie Land an Born und Walsach überlappen (lokal gemessen, 2026-10-17). */
const NORBURG = { x: 691.6, y: 756.5 };

/**
 * 🪤 Breit für jeden Doppelklick: Der erste Klick öffnet den Gebietseditor (T34 (1)), angedockt 960 px breit. Bei 1280 px deckt er die
 * Stelle, und der zweite Klick trifft das Fenster (wie `landschaftseditor-kartenmenue.spec.ts`; Variante A der Orchestrierung baut die
 * Kraftlinien-Sitzung).
 */
const BREIT = { width: 2400, height: 1000 };

/** Welche Gebiete der Stub des Gebietseditors gefragt wurde (Detail). */
let detailAbrufe: string[] = [];
/** Die Adressen, mit denen der Modus „Grenzen bearbeiten“ (C1) seinen Lesepfad gefragt hat, und die Aufrufe der Sperre. */
let formAbrufe: string[] = [];
let sperrAufrufe: { url: string; body: unknown }[] = [];
/** Was „Fertig“ geschickt hat (`territory.update`, B2); nie an einen Server, schon gar nicht an die Datenbank der Entwicklung. */
let formSchreiben: { url: string; body: unknown }[] = [];
/** Was der Lesepfad des Modus antwortet: ein Viereck mitten im Kosch, mit Kette; `requested` macht das gefragte Gebiet abgeleitet. */
const FORM = (requested?: { id: string; name: string }): EditorTerritoryForm => ({
    id: "c1c1c1c1-0000-4000-8000-000000000001",
    name: "Baronie Probe",
    ...(requested === undefined ? {} : { requested }),
    parents: [
        { id: "c1c1c1c1-0000-4000-8000-000000000002", name: "Grafschaft Probe" },
        { id: "c1c1c1c1-0000-4000-8000-000000000003", name: "Reich Probe" },
    ],
    margin: 15,
    areas: [
        {
            id: "c1c1c1c1-0000-4000-8000-000000000101",
            revision: 2,
            polygons: [
                [
                    [
                        [440, 552],
                        [460, 552],
                        [460, 568],
                        [440, 568],
                    ],
                ],
            ],
        },
    ],
    neighbors: [],
    edges: [],
});
let formAntwort: (id: string) => EditorTerritoryForm = () => FORM();

let runde = 0;
async function oeffne(page: Page, stelle: { x: number; y: number }, band: number): Promise<void> {
    runde += 1;
    detailAbrufe = [];
    formAbrufe = [];
    sperrAufrufe = [];
    formSchreiben = [];
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
    const liste: EditorTerritoryList = { yearBf: 1049, rows: [] };
    await page.route("**/api/editor/territories", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(liste) }),
    );
    await page.route(/\/api\/editor\/territories\/[^/?]+$/, (route) => {
        const url = route.request().url();
        if (route.request().method() === "GET") {
            const id = url.split("/").at(-1) ?? "";
            detailAbrufe.push(id);
            const detail: Partial<EditorTerritoryDetail> = {
                id,
                revision: 1,
                name: "Probe",
                parents: [],
                children: [],
                details: {},
                areas: [],
                claimedBy: [],
                claims: [],
            };
            return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(detail) });
        }
        formSchreiben.push({ url: url.slice(url.indexOf("/api/")), body: route.request().postDataJSON() });
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                operationId: "c1c1c1c1-0000-4000-8000-0000000000e1",
                status: "applied",
                environment: "test",
                affected: [],
                derivedWork: [{ kind: "territory_derive", state: "queued" }],
                warnings: [],
                mapRevision: 4711,
            }),
        });
    });
    await page.route(/\/api\/editor\/territories\/[^/]+\/form/, (route) => {
        const url = route.request().url();
        formAbrufe.push(url.slice(url.indexOf("/api/")));
        const id = url.split("/territories/")[1]?.split("/")[0] ?? "";
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(formAntwort(id)) });
    });
    // Die Sperre (EDIT-0003 §4): nehmen, schlagen, freigeben, nie gegen die Datenbank der Entwicklung.
    await page.route(/\/api\/editor\/locks(\/(heartbeat|release|lift))?(\?.*)?$/, (route) => {
        const url = route.request().url();
        if (route.request().method() === "GET")
            return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ locks: [] }) });
        sperrAufrufe.push({ url: url.slice(url.indexOf("/api/")), body: route.request().postDataJSON() });
        if (url.endsWith("/release")) return route.fulfill({ status: 204 });
        if (url.endsWith("/heartbeat"))
            return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ lost: [] }) });
        const body = route.request().postDataJSON() as { kind: string; id: string; part: string };
        const lock = {
            ...body,
            person: { id: "c1c1c1c1-0000-4000-8000-0000000000f1", name: "Ich" },
            since: "2026-10-17T12:00:00.000Z",
            heartbeatAt: "2026-10-17T12:00:00.000Z",
            own: true,
        };
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ lock }) });
    });
    await page.route("**/api/editor/status", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ mapEditing: "testwelt" }),
        }),
    );
    const zoom = bandBeginn(band) + 0.5;
    await page.goto(
        `${EDITOR_MODE}?r=${String(runde)}#x=${String(stelle.x)}&y=${String(stelle.y)}&z=${String(zoom)}&series=original&view=political`,
    );
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 30_000 });
    await settleFrame(page);
    const gezeigt = await page.evaluate(
        () =>
            (
                globalThis.avesmapsMap as unknown as { style: { getGlobalState(): Record<string, number> } }
            ).style.getGlobalState()["territoryBand"],
    );
    expect(gezeigt, "die Karte zeigt das verlangte Band").toBe(band);
}

/** Eine Stelle nahe `um` (Kartenpunkt), an der die Karte genau ein Gebiet zeigt oder mindestens zwei. */
async function stelleMit(
    page: Page,
    anzahl: 1 | "2+",
): Promise<{ at: { x: number; y: number }; ids: string[]; tiefe: number }> {
    const gefunden = await page.evaluate((wunsch) => {
        const map = globalThis.avesmapsMap;
        if (!map) throw new Error("map handle missing");
        const mitte = globalThis.avesmapsVisibleArea!.centre();
        for (let r = 0; r < 200; r += 2) {
            for (let w = 0; w < 360; w += 20) {
                const x = Math.round(mitte.x + r * Math.cos((w * Math.PI) / 180));
                const y = Math.round(mitte.y + r * Math.sin((w * Math.PI) / 180));
                const merkmale = map.queryRenderedFeatures([x, y], { layers: ["territory-fill"] });
                const ids = [...new Set(merkmale.map((f) => String(f.properties["territory_public_id"])))];
                if (wunsch === 1 ? ids.length === 1 : ids.length >= 2)
                    return { x, y, ids, tiefe: Math.max(...merkmale.map((f) => Number(f.properties["depth"]))) };
            }
        }
        return undefined;
    }, anzahl);
    expect(gefunden, `eine Stelle mit ${String(anzahl)} Gebiet(en)`).toBeDefined();
    const stelle = gefunden as { x: number; y: number; ids: string[]; tiefe: number };
    return { at: await onPage(page, stelle), ids: stelle.ids, tiefe: stelle.tiefe };
}

/** Rechtsklick auf ein Gebiet, „Eigenschaften bearbeiten“: Welches Gebiet öffnet der Gebietseditor? */
async function oeffnetPerRechtsklick(page: Page, at: { x: number; y: number }): Promise<string> {
    await page.mouse.click(at.x, at.y, { button: "right" });
    const karte = page.getByTestId("context-editor");
    await expect(karte.getByTestId("context-editor-gebiet-bearbeiten")).toHaveText(/Eigenschaften bearbeiten/);
    // „Gebietsform bearbeiten“ steht da, mit dem Kürzel „Doppelklick“, und geht (C1).
    const form = karte.getByTestId("context-editor-gebiet-gebietsform");
    await expect(form).toContainText("Gebietsform bearbeiten");
    await expect(form).toContainText("Doppelklick");
    await expect(form).toBeEnabled();
    await karte.getByTestId("context-editor-gebiet-bearbeiten").click();
    await expect.poll(() => detailAbrufe.length).toBeGreaterThan(0);
    return detailAbrufe.at(-1)!;
}

for (const band of [2, 6]) {
    test(`🔴 Band ${String(band)}: der Rechtsklick nimmt das Gebiet, das die Karte dort zeigt, und öffnet es im Gebietseditor`, async ({
        page,
    }) => {
        await oeffne(page, KOSCH, band);
        const { at, ids } = await stelleMit(page, 1);
        expect(await oeffnetPerRechtsklick(page, at)).toBe(ids[0]);
        await expect(page.locator('[data-testid^="gebietseditor-"]').first()).toBeVisible();
        await expect(page).toHaveURL(/view=political/);
    });

    test(`🔴 Band ${String(band)}: der Doppelklick auf ein Gebiet bleibt in „Politisch“ und startet „Grenzen bearbeiten“`, async ({
        page,
    }) => {
        await page.setViewportSize(BREIT);
        await oeffne(page, KOSCH, band);
        const { at } = await stelleMit(page, 1);
        await page.mouse.dblclick(at.x, at.y);
        await expect(page.getByTestId("grenzen-leiste")).toBeVisible();
        await expect(page).toHaveURL(/view=political/);
        await expect(page.getByTestId("doppelklick-flaechen")).toHaveCount(0);
    });
}

test("🔴 im Editor-Modus öffnet ein Klick auf ein Gebiet den Gebietseditor an ihm, auch wenn er zu war (T34 (1), Regel 7)", async ({
    page,
}) => {
    await oeffne(page, KOSCH, 6);
    const { at, ids } = await stelleMit(page, 1);
    await expect(page.locator('[data-testid^="gebietseditor-"]')).toHaveCount(0);
    await page.mouse.click(at.x, at.y);
    await expect.poll(() => detailAbrufe.at(-1)).toBe(ids[0]);
    await expect(page.locator('[data-testid^="gebietseditor-"]').first()).toBeVisible();
});

/** Wo eine Ecke des Probe-Vierecks am Schirm liegt. */
async function schirm(page: Page, punkt: { x: number; y: number }): Promise<{ x: number; y: number }> {
    const box = await page.getByTestId("map").boundingBox();
    const at = await page.evaluate(
        (ziel) => globalThis.avesmapsMap!.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(ziel)),
        punkt,
    );
    return { x: (box?.x ?? 0) + at.x, y: (box?.y ?? 0) + at.y };
}

test("🔴 C1/B2 „Gebietsform bearbeiten“: Leiste „Grenzen bearbeiten“ mit den Obergebieten, ein Zug zählt, ↶ und Strg+Y, Esc fragt, „Fertig“ schreibt territory.update", async ({
    page,
}) => {
    // 🪤 Breit: Der Modus öffnet das Fenster des Gebiets (D19, B2); bei 1280 px bleibt neben ihm so wenig Karte, dass die Knöpfe der
    // Karte über der gezogenen Ecke liegen.
    await page.setViewportSize(BREIT);
    await oeffne(page, KOSCH, 6);
    const { at } = await stelleMit(page, 1);
    await page.mouse.click(at.x, at.y, { button: "right" });
    await page.getByTestId("context-editor-gebiet-gebietsform").click();
    const leiste = page.getByTestId("grenzen-leiste");
    await expect(leiste).toBeVisible();
    await expect(leiste).toContainText("Grenzen bearbeiten");
    await expect(leiste).toContainText("Baronie Probe");
    // Frage 1: Die Leiste nennt die Obergebiete, deren Grenze sich mitändert.
    await expect(leiste).toContainText("Ändert mit: Grafschaft Probe und Reich Probe");
    await expect(page.getByTestId("grenzen-leiste-ungespeichert")).toHaveText("0 ungespeichert");
    // Der Klickpunkt geht an den Lesepfad (abgeleitet → Baronie darunter); gesperrt wird das bearbeitete Gebiet.
    expect(formAbrufe[0]).toMatch(/\/form\?x=[\d.]+&y=[\d.]+$/);
    expect(sperrAufrufe[0]?.body).toMatchObject({ kind: "territory", id: "c1c1c1c1-0000-4000-8000-000000000001" });
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
    // Seit WI-0218 (`f0367791d`, Betreiber „formmodus A“) passt der Modus das Gebiet beim Start nicht mehr ein, solange ein Teil zu
    // sehen ist; die gezogene Ecke lag darum unter dem Bildrand (y ≈ 1247 bei 1000 px). Der Test holt sie wie ein Mensch in die freie Fläche.
    await page.evaluate((ziel) => {
        const map = globalThis.avesmapsMap!;
        const ecke = map.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(ziel));
        const mitte = globalThis.avesmapsVisibleArea!.centre();
        const jetzt = map.project(map.getCenter());
        map.jumpTo({ center: map.unproject([jetzt.x + ecke.x - mitte.x, jetzt.y + ecke.y - mitte.y]) });
    }, KOSCH_ECKE);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
    await settleFrame(page);

    const von = await schirm(page, KOSCH_ECKE);
    await page.mouse.move(von.x, von.y);
    await page.mouse.down();
    await page.mouse.move(von.x + 40, von.y + 6, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByTestId("grenzen-leiste-ungespeichert")).toHaveText("1 ungespeichert");
    await expect(page.getByTestId("grenzen-leiste-fertig")).toBeEnabled();
    await page.getByTestId("grenzen-leiste-zurueck").click();
    await expect(page.getByTestId("grenzen-leiste-ungespeichert")).toHaveText("0 ungespeichert");
    await page.keyboard.press("Control+y");
    await expect(page.getByTestId("grenzen-leiste-ungespeichert")).toHaveText("1 ungespeichert");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("grenzen-leiste-frage")).toBeVisible();
    await page.getByTestId("grenzen-leiste-frage-nein").click();
    await expect(page.getByTestId("grenzen-leiste-frage")).toHaveCount(0);
    // B2: „Fertig“ der Bearbeitung schreibt EINE Operation territory.update mit der geänderten Fläche gegen ihre Revision; danach
    // endet der Modus und gibt frei. Der Modus hängt an der Bearbeitung des Gebiets: Sein Fenster ist offen (D19).
    await expect(
        page.locator('[data-testid^="gebietseditor-fenster-"]').filter({ visible: true }).first(),
    ).toBeVisible();
    await page.getByTestId("grenzen-leiste-fertig").click();
    await expect(leiste).toHaveCount(0);
    expect(formSchreiben).toHaveLength(1);
    expect(formSchreiben[0]!.url).toBe("/api/editor/territories/c1c1c1c1-0000-4000-8000-000000000001");
    expect(formSchreiben[0]!.body).toMatchObject({
        areas: [{ id: "c1c1c1c1-0000-4000-8000-000000000101", baseRevision: 2 }],
    });
    expect(formSchreiben[0]!.body).not.toHaveProperty("changes");
    await expect(page.getByTestId("toast")).toContainText("gespeichert");
    expect(sperrAufrufe.at(-1)?.url).toBe("/api/editor/locks/release");
});

test("🔴 Strg + Klick auf eine Grenze setzt vier Punkte auf die Strecke (Betreiber 2026-10-20, Legacy), als EIN Schritt; „Fertig“ schreibt sie", async ({
    page,
}) => {
    await page.setViewportSize(BREIT);
    await oeffne(page, KOSCH, 6);
    const { at } = await stelleMit(page, 1);
    await page.mouse.click(at.x, at.y, { button: "right" });
    await page.getByTestId("context-editor-gebiet-gebietsform").click();
    await expect(page.getByTestId("grenzen-leiste")).toBeVisible();
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
    // Die rechte Grenze (460, 552) – (460, 568) ganz in die freie Fläche holen, wie ein Mensch: eine Stufe hinaus (sonst ist sie
    // länger als das Bild hoch), dann ihre Mitte in die Mitte.
    const mitteDerGrenze = { x: 460, y: 560 };
    await page.evaluate((ziel) => {
        const map = globalThis.avesmapsMap!;
        map.jumpTo({ zoom: map.getZoom() - 1.5 });
        const stelle = map.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(ziel));
        const mitte = globalThis.avesmapsVisibleArea!.centre();
        const jetzt = map.project(map.getCenter());
        map.jumpTo({ center: map.unproject([jetzt.x + stelle.x - mitte.x, jetzt.y + stelle.y - mitte.y]) });
    }, mitteDerGrenze);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
    await settleFrame(page);

    const stelle = await schirm(page, mitteDerGrenze);
    await page.mouse.move(stelle.x + 5, stelle.y);
    await page.keyboard.down("Control");
    await expect
        .poll(() =>
            page.evaluate(
                () => globalThis.avesmapsMap!.queryRenderedFeatures({ layers: ["geometrie-teilung-punkt"] }).length,
            ),
        )
        .toBe(4);
    // Im Modus dreht Strg + Ziehen die Karte nicht (Vali 2026-11-06), und der Zug setzt nichts.
    await page.mouse.down();
    await page.mouse.move(stelle.x + 105, stelle.y + 60, { steps: 10 });
    await page.mouse.up();
    const kamera = await readCamera(page);
    expect(kamera.bearing).toBeCloseTo(0, 3);
    expect(kamera.pitch).toBeCloseTo(0, 3);
    await expect(page.getByTestId("grenzen-leiste-ungespeichert")).not.toContainText("1");
    await page.mouse.move(stelle.x + 5, stelle.y);
    await page.mouse.click(stelle.x + 5, stelle.y);
    await page.keyboard.up("Control");
    await expect(page.getByTestId("grenzen-leiste-ungespeichert")).toHaveText("1 ungespeichert");
    await page.getByTestId("grenzen-leiste-fertig").click();
    await expect(page.getByTestId("grenzen-leiste")).toHaveCount(0);
    expect(formSchreiben).toHaveLength(1);
    const ring = (formSchreiben[0]!.body as { areas: { polygons: number[][][][] }[] }).areas[0]!.polygons[0]![0]!;
    // Die vier gleichmäßig zwischen (460, 552) und (460, 568): bei 555,2, 558,4, 561,6 und 564,8.
    expect(ring).toHaveLength(8);
    expect(ring.slice(2, 6).map(([x, y]) => [x, Number(y!.toFixed(4))])).toEqual([
        [460, 555.2],
        [460, 558.4],
        [460, 561.6],
        [460, 564.8],
    ]);
});

test("🔴 T59: in „Gebietsform bearbeiten“ setzt ein Doppelklick ins Gebiet und bis 22 px neben die Grenze einen Punkt an der Klickstelle (OPS-000043, Legacy)", async ({
    page,
}) => {
    await page.setViewportSize(BREIT);
    await oeffne(page, KOSCH, 6);
    const { at } = await stelleMit(page, 1);
    await page.mouse.click(at.x, at.y, { button: "right" });
    await page.getByTestId("context-editor-gebiet-gebietsform").click();
    await expect(page.getByTestId("grenzen-leiste")).toBeVisible();
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
    // Das Viereck ganz in die freie Fläche holen wie im Fall der Strg-Kante: eine Stufe hinaus, seine Mitte in die Mitte.
    await page.evaluate((ziel) => {
        const map = globalThis.avesmapsMap!;
        map.jumpTo({ zoom: map.getZoom() - 1.5 });
        const stelle = map.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(ziel));
        const mitte = globalThis.avesmapsVisibleArea!.centre();
        const jetzt = map.project(map.getCenter());
        map.jumpTo({ center: map.unproject([jetzt.x + stelle.x - mitte.x, jetzt.y + stelle.y - mitte.y]) });
    }, KOSCH);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
    await settleFrame(page);

    // Mitten im Gebiet (450, 560), fern von jeder Grenze: ein Punkt an der Klickstelle in die nächste Kante.
    const innen = await schirm(page, KOSCH);
    await page.mouse.dblclick(innen.x, innen.y);
    await expect(page.getByTestId("grenzen-leiste-ungespeichert")).toHaveText("1 ungespeichert");
    // 15 px rechts neben der rechten Grenze, auf Höhe von (460, 556): im Saum, also noch ein Punkt.
    const rechts = await schirm(page, { x: 460, y: 556 });
    await page.mouse.dblclick(rechts.x + 15, rechts.y);
    await expect(page.getByTestId("grenzen-leiste-ungespeichert")).toHaveText("2 ungespeichert");
    await expect(page.getByTestId("grenzen-leiste")).toBeVisible();
    await page.getByTestId("grenzen-leiste-fertig").click();
    await expect(page.getByTestId("grenzen-leiste")).toHaveCount(0);
    expect(formSchreiben).toHaveLength(1);
    const ring = (formSchreiben[0]!.body as { areas: { polygons: number[][][][] }[] }).areas[0]!.polygons[0]![0]!;
    expect(ring).toHaveLength(6);
    const gesetzt = await Promise.all(ring.map(async ([x, y]) => schirm(page, { x: x!, y: y! })));
    expect(gesetzt.some((q) => Math.hypot(q.x - innen.x, q.y - innen.y) < 1.5)).toBe(true);
    expect(gesetzt.some((q) => Math.hypot(q.x - rechts.x - 15, q.y - rechts.y) < 1.5)).toBe(true);
});

test("🔴 C1 Frage 2: Doppelklick auf ein abgeleitetes Gebiet in Band 2 bearbeitet die Baronie darunter und sagt es", async ({
    page,
}) => {
    await page.setViewportSize(BREIT);
    formAntwort = (id) => FORM({ id, name: "Gezeigtes Gebiet" });
    try {
        await oeffne(page, KOSCH, 2);
        const { at, ids } = await stelleMit(page, 1);
        await page.mouse.dblclick(at.x, at.y);
        await expect(page.getByTestId("grenzen-leiste")).toContainText("Baronie Probe");
        await expect(page.getByTestId("toast")).toContainText(
            "„Gezeigtes Gebiet“ ist abgeleitet: Bearbeitet wird „Baronie Probe“ darunter.",
        );
        expect(formAbrufe[0]).toContain(`/territories/${ids[0]!}/form?x=`);
        await expect(page).toHaveURL(/view=political/);
    } finally {
        formAntwort = () => FORM();
    }
});

test("🔴 Band 2 und 6 an derselben Stelle: in Band 6 ein tieferes Gebiet als in Band 2", async ({ page }) => {
    await oeffne(page, KOSCH, 2);
    const oben = await stelleMit(page, 1);
    await oeffne(page, KOSCH, 6);
    const unten = await stelleMit(page, 1);
    expect(unten.ids[0]).not.toBe(oben.ids[0]);
    expect(unten.tiefe).toBeGreaterThan(oben.tiefe);
});

test("🔴 zwei Gebiete übereinander: Rechtsklick „Hier liegen 2 Flächen“ mit Untermenü je Gebiet, Doppelklick fragt zuerst", async ({
    page,
}) => {
    await page.setViewportSize(BREIT);
    await oeffne(page, NORBURG, 6);
    const { at, ids } = await stelleMit(page, "2+");
    await page.mouse.click(at.x, at.y, { button: "right" });
    const karte = page.getByTestId("context-editor");
    await expect(karte).toContainText(`Hier liegen ${String(ids.length)} Flächen`);
    for (const id of ids) await expect(karte.getByTestId(`context-editor-gebiet-${id}`)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(karte).toHaveCount(0);
    await page.mouse.dblclick(at.x, at.y);
    const auswahl = page.getByTestId("doppelklick-flaechen");
    await expect(auswahl).toBeVisible();
    await expect(auswahl.getByRole("menuitemradio")).toHaveCount(ids.length);
});
