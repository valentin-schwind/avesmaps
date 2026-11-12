import { expect, test, type Page, type Route } from "@playwright/test";
import {
    GEBIRGS_PRESETS_VORGABE,
    rueckennetzVorgabe,
    type EditorGebirge,
    type EditorLandscapeDetail,
    type LandscapeUpdateBody,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap } from "./map-handle.ts";
import { editorPanelVorn } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Der Reiter „Gebirge“ der Derographie (WI-0178 P4, Fassung 16). 🔴 Kein Test schreibt in die Datenbank der Entwicklung: Liste, Detail,
 * Gebirge, Sperre und `landscape.update` kommen aus einem Stub; den Schreibweg prüft `landscape-update-gebirge.test.ts` als App-Rolle.
 *
 * Problemfälle: Der Reiter steht an jeder Fläche; ↺ reist als `null` (ajv macht 0 daraus); der Typwechsel behält Legacys alte Werte;
 * „Fertig“ schickt das Gebirge in einer zweiten Operation; die Presets der Vorgabe wirken, ohne dass das Fenster es sagt.
 */
const GEBIRGE = "a5a5a5a5-0000-4000-8000-000000000001";
const FLAECHE = "a5a5a5a5-0000-4000-8000-0000000000a1";
const ZINNE = "a5a5a5a5-0000-4000-8000-0000000000b1";
const SPITZE = "a5a5a5a5-0000-4000-8000-0000000000b2";
const DETAIL: EditorLandscapeDetail = {
    id: GEBIRGE,
    name: "Probegebirge",
    layer: "topographie",
    type: "gebirge",
    circle: "halb-rechts",
    order: 10,
    clickLocked: false,
    areas: [
        {
            id: FLAECHE,
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
            gebirge: {
                typ: null,
                muster: null,
                kammhoehe: 4000,
                werte: { plateau: 0.9, koernung: 14 },
                modell: {},
                netz: { kaemme: [], nebengipfel: [] },
                revision: 1,
            },
        },
    ],
    labels: [],
    neighbors: [],
    peaks: [
        { id: ZINNE, name: "Probezinne", subtype: "berggipfel", height: 3200, position: [450, 520], revision: 2 },
        { id: SPITZE, name: "Probespitze", subtype: "vulkan", position: [460, 510], revision: 1 },
    ],
    revision: 1,
};
const GELESEN: EditorGebirge = {
    area: FLAECHE,
    // Eine kleine echte Eingabe der V12: Die Vorschau (P6) rechnet im Worker.
    eingabe: {
        bounds: { min_x: 440, min_y: 502, max_x: 466, max_y: 538 },
        geometry: {
            type: "Polygon",
            coordinates: [
                [
                    [440, 502],
                    [466, 502],
                    [466, 538],
                    [440, 538],
                    [440, 502],
                ],
            ],
        },
        peaks: [{ x: 450, y: 520, h: 3200 }],
        kurve: null,
        // Ein Fluss quer durch die Fläche (26 von 40 E drin) und durch einen See ganz in ihr (WI-0245, Lücke e).
        fluesse: [
            {
                n: "Probefluss",
                bach: false,
                dir: null,
                p: [
                    [430, 521],
                    [470, 521],
                ],
            },
        ],
        seen: [
            {
                n: "Probesee",
                g: {
                    type: "Polygon",
                    coordinates: [
                        [
                            [454, 519],
                            [460, 519],
                            [460, 524],
                            [454, 524],
                            [454, 519],
                        ],
                    ],
                },
            },
        ],
        saat: 7,
    } as EditorGebirge["eingabe"],
    stand: DETAIL.areas[0]!.gebirge!,
    grundhoehe: 1500,
    presets: { quelle: "vorgabe", fassung: 18, gruppe: GEBIRGS_PRESETS_VORGABE },
};

async function oeffne(page: Page, detail: EditorLandscapeDetail = DETAIL): Promise<LandscapeUpdateBody[]> {
    const gesendet: LandscapeUpdateBody[] = [];
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
    await page.route("**/api/editor/landscapes", (route) =>
        json(route, 200, {
            rows: [
                {
                    id: GEBIRGE,
                    name: DETAIL.name,
                    layer: "topographie",
                    type: "gebirge",
                    circle: "halb-rechts",
                    areas: 1,
                    labels: 0,
                    order: 10,
                    bounds: [440, 502, 466, 538],
                },
            ],
        }),
    );
    await page.route(`**/api/editor/landscapes/${GEBIRGE}`, (route) => {
        if (route.request().method() !== "PATCH") return json(route, 200, detail);
        gesendet.push(route.request().postDataJSON() as LandscapeUpdateBody);
        const quittung: OperationReceipt = {
            operationId: "op",
            status: "applied",
            environment: "test",
            affected: [{ kind: "terrain_control", id: FLAECHE }],
            derivedWork: [],
            warnings: [],
            mapRevision: 902,
        };
        return json(route, 200, quittung);
    });
    await page.route(`**/api/editor/gebirge/${FLAECHE}`, (route) => json(route, 200, GELESEN));
    // Die Höhenprofile (WI-0245): der Fluss fällt von 900 auf 300 Schritt; die Linie beginnt an der Mündung (sie steht dann gespiegelt).
    // Von 24 bis 30 E liegt er im Probesee und steht flach auf 650 (WI-0249: die Platte des Sees).
    await page.route(`**/api/editor/gebirge/${FLAECHE}/profile`, (route) =>
        json(route, 200, {
            verfuegbar: true,
            fluesse: [{ at: [0, 10, 20, 24.5, 27, 29.5, 40], h: [300, 450, 600, 650, 650, 650, 900] }],
            paesse: [],
            objekte: {
                fluesse: [{ id: "f1f1f1f1-0000-4000-8000-0000000000f1", kreis: "voll" }],
                seen: [{ id: "f1f1f1f1-0000-4000-8000-0000000000f2", kreis: "halb-rechts" }],
                paesse: [],
            },
        }),
    );
    await page.route(`**/api/editor/peaks/${ZINNE}`, (route) =>
        json(route, 200, {
            id: ZINNE,
            name: "Probezinne",
            subtype: "berggipfel",
            height: 3200,
            showName: true,
            position: [450, 520],
            revision: 2,
        }),
    );
    await page.route(`**/api/editor/landscapes/${GEBIRGE}/history**`, (route) => json(route, 200, { entries: [] }));
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
    await openMap(page, EDITOR_MODE);
    await editorPanelVorn(page);
    await page.getByTestId("editorpanel-kachel-regionen").click();
    await page.getByTestId("editorpanel-verb").click();
    await page
        .locator('[data-testid^="landschaftseditor-"][data-testid$="-liste"]')
        .getByRole("option", { name: /Probegebirge/ })
        .click();
    return gesendet;
}

test.use({ viewport: { width: 1920, height: 1080 } });

const id = (page: Page, rest: string) =>
    page.getByTestId(new RegExp(`^landschaftseditor-fenster-\\d+-gebirge${rest}$`));

test("🔴 Reiter „Gebirge“: Typ, Kammhöhe und ↺ im EINEN Entwurf; „Fertig“ schickt ↺ als `zurueck`, nie als null", async ({
    page,
}) => {
    const gesendet = await oeffne(page);
    await page.getByRole("tab", { name: "Gebirge" }).click();
    // Die große Vorschau (Entwurf V16): Gipfel mit Namen und Höhe, darunter die Höhenskala bis zur höchsten Stelle.
    await expect(page.getByTestId("gebirge-vorschau-gipfelname").filter({ hasText: "Probezinne" })).toHaveText(
        /Probezinne 3[.,]?200/,
    );
    // Das erste Bild rechnet der Worker erst nach seinem Start (kalt bis einige Sekunden).
    await expect(id(page, "-vorschau-skala")).toContainText("Schritt", { timeout: 20_000 });
    // Flüsse und Seen (Lücke e): je Eintrag Art, ⌖ und ein Satz; ⌖ lässt die Kamera fliegen.
    const gewaesser = id(page, "-gewaesser");
    await expect(gewaesser).toContainText("Flüsse und Seen in diesem Gebirge (2)");
    await expect(gewaesser).toContainText("schneidet die Fläche auf 65 % seiner Länge · durchquert Probesee");
    await expect(gewaesser).toContainText("liegt ganz in der Fläche · durchflossen von Probefluss");
    // Je Zeile der Kreis (Hausregel „Kreis in jeder Liste“) und der Name als Link zum Objekt (Entwurf V16/V17).
    await expect(id(page, "-objekt-f0")).toHaveText("Probefluss");
    await expect(gewaesser.locator('[data-kreis="voll"]')).toHaveCount(1);
    await expect(gewaesser.locator('[data-kreis="halb-rechts"]')).toHaveCount(1);
    // Das Höhenprofil des Flusses mit Quelle (das höhere Ende), Mündung und Gefälle.
    await expect(gewaesser.getByTestId("gebirge-profil-zahlen")).toHaveText(
        /Quelle 900 Schritt · Mündung 300 Schritt · Gefälle 600 Schritt/,
    );
    // WI-0249 (Vali 2026-10-25): die Kurve des Flusses blau, der durchquerte See als Platte darunter, mit Marke „See“ in der Legende.
    const profil = gewaesser.getByTestId("gebirge-profil-fluss");
    await expect(profil.locator(".profil__see")).toHaveCount(1);
    await expect(profil.locator(".profil__seelinie")).toHaveCount(1);
    await expect(profil.locator(".profil__legende")).toContainText("See");
    const farben = await profil.evaluate((el) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--color-profile-river)";
        document.body.append(probe);
        const blau = getComputedStyle(probe).color;
        probe.remove();
        return { linie: getComputedStyle(el.querySelector(".profil__linie--fluss")!).stroke, blau };
    });
    expect(farben.linie).toBe(farben.blau);
    await gewaesser.screenshot({ path: "test-results/landschaftseditor-gebirge-gewaesser.png" });
    const mitteVorher = await page.evaluate(() => (({ lng, lat }) => [lng, lat])(globalThis.avesmapsMap!.getCenter()));
    await id(page, "-gewaesser-s0-ziel").click();
    await expect
        .poll(() => page.evaluate(() => (({ lng, lat }) => [lng, lat])(globalThis.avesmapsMap!.getCenter())), {
            message: "⌖ lässt die Kamera fliegen",
        })
        .not.toEqual(mitteVorher);
    // Die Vorgabe der Presets wirkt erst mit Fassung 19: Das Fenster sagt es.
    await expect(id(page, "-vorgabe")).toBeVisible();
    await expect(id(page, "-kamm")).toHaveValue("4000");
    await expect(id(page, "-kamm-zurueck")).toBeVisible();
    // Ohne gezeichnete Kämme rechnet das Gebirge die V12: Die Werte des Rückennetzes stehen nicht da (WI-0245).
    await expect(id(page, "-wert-modell-grat")).toHaveCount(0);

    await id(page, "-typ-kammgebirge").click();
    await expect(id(page, "-typ-kammgebirge")).toHaveAttribute("aria-checked", "true");
    // Der Typ gilt ganz: Legacys alte Körnung (14) ist zurückgenommen, es gilt die des Presets.
    await expect(id(page, "-wert-koernung")).toHaveValue(
        String(GEBIRGS_PRESETS_VORGABE.typen.kammgebirge.werte.koernung),
    );
    await id(page, "-kamm-zurueck").click();
    await expect(id(page, "-kamm")).toHaveValue("1500");
    await id(page, "-wert-plateau").fill("0.5");
    await id(page, "-wert-plateau").press("Tab");
    await expect(id(page, "-wert-plateau-zurueck")).toBeVisible();
    await expect(page.getByTestId("landschaft-leiste")).toBeVisible();
    await page.screenshot({ path: "test-results/landschaftseditor-gebirge-p4.png" });

    await page.getByTestId("landschaft-leiste-fertig").click();
    await expect.poll(() => gesendet.length).toBe(1);
    expect(gesendet[0]).toEqual({
        operationId: expect.any(String),
        gebirge: [
            {
                area: FLAECHE,
                changes: {
                    typ: "kammgebirge",
                    werte: { plateau: 0.5 },
                    zurueck: ["kammhoehe", "koernung"],
                    // Gegen die Revision der Gebirgswerte (WI-0245).
                    baseRevision: 1,
                },
            },
        ],
    });
    expect(JSON.stringify(gesendet[0])).not.toContain("null");
});

test("🔴 Rückennetz (WI-0245, D3): mit Kämmen stehen Gratlinie, Gratbreite und Talboden mit Preset des Typs; „Fertig“ schickt `modell` gegen die Revision", async ({
    page,
}) => {
    const flaeche = DETAIL.areas[0]!;
    const mitKamm: EditorLandscapeDetail = {
        ...DETAIL,
        areas: [
            {
                ...flaeche,
                gebirge: {
                    ...flaeche.gebirge!,
                    netz: {
                        kaemme: [
                            {
                                punkte: [
                                    [445, 510],
                                    [460, 530],
                                ],
                                rang: "haupt",
                            },
                        ],
                        nebengipfel: [],
                    },
                },
            },
        ],
    };
    const gesendet = await oeffne(page, mitKamm);
    await page.getByRole("tab", { name: "Gebirge" }).click();
    const vorschlag = rueckennetzVorgabe(GEBIRGS_PRESETS_VORGABE, null);
    await expect(id(page, "-wert-modell-grat")).toHaveValue(String(vorschlag.grat));
    await expect(id(page, "-wert-modell-gratBreite")).toHaveValue(String(vorschlag.gratBreite));
    await expect(id(page, "-wert-modell-talboden")).toHaveValue(String(vorschlag.talboden));
    await expect(id(page, "-wert-modell-grat-zurueck")).toHaveCount(0);
    await id(page, "-wert-modell-grat").fill("0.25");
    await id(page, "-wert-modell-grat").press("Tab");
    await expect(id(page, "-wert-modell-grat-zurueck")).toBeVisible();
    // Höhe und Erosion (WI-0249, Entwurf Variante 2, Vali 2026-10-25: „das ist perfekt“): EIN Kasten vor „Werte“ mit der Höhe des Kamms, dem leisen
    // Hinweis, den Stufen als Band in einer Zeile und der Erosionsfestigkeit in Prozent (↺ zurück auf 0 %); sie steht nicht unter den Werten.
    const kasten = page.locator("section.gebirge__kasten");
    const titel = await kasten.locator("h4.gebirge__titel").allTextContents();
    expect(titel.map((t) => t.trim()).indexOf("Höhe und Erosion")).toBeGreaterThanOrEqual(0);
    expect(titel.some((t) => t.trim() === "Erosion")).toBe(false);
    expect(titel.findIndex((t) => t.startsWith("Werte"))).toBe(
        titel.map((t) => t.trim()).indexOf("Höhe und Erosion") + 1,
    );
    const hoehe = id(page, "-hoehe");
    await expect(hoehe.locator(".gebirge__ableitung")).toContainText("abgeleitet wäre");
    await expect(hoehe.locator(".gebirge__stufe")).toHaveCount(5);
    // Das Band steht in EINER Zeile: Alle fünf Stufen auf derselben Höhe.
    const oben = await hoehe
        .locator(".gebirge__stufe")
        .evaluateAll((knoepfe) => knoepfe.map((k) => Math.round(k.getBoundingClientRect().top)));
    expect(new Set(oben).size).toBe(1);
    await expect(id(page, "-stufe-hochgebirge")).toHaveAttribute("aria-pressed", "false");
    await id(page, "-stufe-hochgebirge").click();
    await expect(id(page, "-kamm")).toHaveValue(String(GEBIRGS_PRESETS_VORGABE.hoehenstufen.hochgebirge));
    await expect(id(page, "-stufe-hochgebirge")).toHaveAttribute("aria-pressed", "true");
    await expect(id(page, "-wert-modell-erosionsfestigkeit")).toHaveValue("0");
    await expect(id(page, "-wert-modell-erosionsfestigkeit-zurueck")).toHaveCount(0);
    await expect(id(page, "-erosion")).toContainText("100 %");
    await id(page, "-wert-modell-erosionsfestigkeit").fill("60");
    await id(page, "-wert-modell-erosionsfestigkeit").press("Tab");
    await expect(id(page, "-wert-modell-erosionsfestigkeit-zurueck")).toBeVisible();
    await page.getByTestId("landschaft-leiste-fertig").click();
    await expect.poll(() => gesendet.length).toBe(1);
    expect(gesendet[0]).toEqual({
        operationId: expect.any(String),
        gebirge: [
            {
                area: FLAECHE,
                changes: {
                    kammhoehe: GEBIRGS_PRESETS_VORGABE.hoehenstufen.hochgebirge,
                    modell: { grat: 0.25, erosionsfestigkeit: 60 },
                    baseRevision: 1,
                },
            },
        ],
    });
});

/** Ein Punkt der Karte (Karteneinheiten) auf der Seite, in Bildpunkten. */
async function aufSeite(page: Page, punkt: { x: number; y: number }): Promise<{ x: number; y: number }> {
    return page.evaluate((pt) => {
        const map = globalThis.avesmapsMap!;
        const render = globalThis.avesmapsRenderProjection!.toRenderLngLat(pt);
        const at = map.project(render);
        const rahmen = map.getCanvas().getBoundingClientRect();
        return { x: rahmen.left + at.x, y: rahmen.top + at.y };
    }, punkt);
}

test("🔴 Kämme zeichnen (WI-0245 D2): ein Kamm rastet am Gipfel ein, ein Nebengipfel mit der Kammhöhe; „Fertig“ schickt das Netz als Ganzes gegen die Revision", async ({
    page,
}) => {
    const gesendet = await oeffne(page);
    await page.getByRole("tab", { name: "Gebirge" }).click();
    // Formmodus A (Stage-Fund 2026-10-20): Liegt das Gebirge außerhalb des Bilds, fliegt die Kamera beim Start hin.
    await page.evaluate(() =>
        globalThis.avesmapsMap!.jumpTo({
            center: globalThis.avesmapsRenderProjection!.toRenderLngLat({ x: 150, y: 150 }),
        }),
    );
    await id(page, "-kaemme-zeichnen").click();
    const leiste = page.getByTestId("kamm-netz-leiste");
    await expect(leiste).toBeVisible();
    await expect
        .poll(
            () =>
                page.evaluate(() => {
                    const map = globalThis.avesmapsMap!;
                    if (map.isMoving()) return false;
                    const at = map.project(globalThis.avesmapsRenderProjection!.toRenderLngLat({ x: 453, y: 520 }));
                    const leinwand = map.getCanvas();
                    return at.x > 0 && at.y > 0 && at.x < leinwand.clientWidth && at.y < leinwand.clientHeight;
                }),
            { message: "die Kamera fliegt zum Gebirge", timeout: 10_000 },
        )
        .toBe(true);
    // Ohne Netz beginnt das Zeichnen (mit Netz „Wählen“, `landschaftseditor-kammhoehen.spec.ts`); die Gestenzeile sagt, was die Maus tut (OPS-055).
    await expect(page.getByTestId("kamm-netz-werkzeug-kamm")).toHaveAttribute("aria-checked", "true");
    const gesten = page.getByTestId("kamm-netz-gesten");
    await expect(gesten).toBeVisible();
    await expect(gesten).toContainText("Ein Klick setzt einen Punkt · Doppelklick oder Enter beendet den Kamm");
    await expect(gesten).toContainText("fertige Kämme ändern: Werkzeug „Wählen“");
    // Die Fläche in die Mitte der FREIEN Fläche (neben dem angedockten Fenster), damit jeder Klick die Karte trifft.
    await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        map.jumpTo({ center: globalThis.avesmapsRenderProjection!.toRenderLngLat({ x: 453, y: 520 }), zoom: 6 });
        const frei = globalThis.avesmapsVisibleArea!.centre();
        const jetzt = map.project(map.getCenter());
        map.jumpTo({ center: map.unproject([2 * jetzt.x - frei.x, 2 * jetzt.y - frei.y]) });
    });
    const aufKarte = (p: { x: number; y: number }) =>
        page.evaluate(
            ([x, y]) => document.elementFromPoint(x!, y!) === globalThis.avesmapsMap!.getCanvas(),
            [p.x, p.y],
        );
    const p1 = await aufSeite(page, { x: 445, y: 510 });
    // Knapp neben der Probezinne (450, 520): Der Punkt rastet am Gipfel ein.
    const p2 = await aufSeite(page, { x: 450.2, y: 520.15 });
    const p3 = await aufSeite(page, { x: 460, y: 530 });
    for (const p of [p1, p2, p3]) expect(await aufKarte(p), "der Klick trifft die Karte").toBe(true);
    // Regression: Der Stand des Modus kreiste mit dem Lauf („Maximum recursive updates exceeded“), kein Punkt kam an.
    const fehler: string[] = [];
    page.on("pageerror", (e) => fehler.push(e.message));
    await page.mouse.click(p1.x, p1.y);
    // Der erste Punkt steht: Der entstehende Kamm ist ein Schritt, den ↶ zurücknehmen könnte, noch nichts ist ungespeichert.
    await expect(page.getByTestId("kamm-netz-leiste-ungespeichert")).toContainText("0");
    await page.mouse.click(p2.x, p2.y);
    await page.mouse.dblclick(p3.x, p3.y);
    await expect(page.getByTestId("kamm-netz-zahl")).toHaveAttribute(
        "aria-label",
        /Kämme 1 · Nebengipfel 0 · Hauptkämme 0 · Nebenkämme 1/,
    );
    // Über der Vorschau (Betreiber 2026-10-21): „Kämme zeichnen“ steht gedrückt, die Zählung unten links im Bild, „Kämme anzeigen“
    // blendet das Netz in Vorschau und Karte aus und wieder ein.
    await expect(id(page, "-kaemme-zeichnen")).toHaveAttribute("aria-pressed", "true");
    await expect(id(page, "-vorschau-zahl")).toHaveText("Kämme 1 · Nebengipfel 0");
    const netzSichtbar = () =>
        page.evaluate(
            () =>
                (
                    globalThis.avesmapsMap as unknown as { getLayoutProperty(ebene: string, wert: string): unknown }
                ).getLayoutProperty("editor-gebirgsnetz-kaemme", "visibility") !== "none",
        );
    await id(page, "-kaemme-anzeigen").click();
    await expect.poll(netzSichtbar).toBe(false);
    await expect(id(page, "-vorschau-gross").locator(".gross__kamm")).toHaveCount(0);
    await id(page, "-kaemme-anzeigen").click();
    await expect.poll(netzSichtbar).toBe(true);
    await expect(id(page, "-vorschau-gross").locator(".gross__kamm")).toHaveCount(1);
    expect(fehler).toEqual([]);

    await page.getByTestId("kamm-netz-werkzeug-nebengipfel").click();
    await expect(gesten).toContainText("Ein Klick setzt den Punkt · gesetzte Punkte ändern oder löschen");
    // Beim Zeichnen ohne Auswahl kein Wert: Neue Punkte haben keine eigene Höhe, keinen Startwert (c0a24807b, Vali wählte 2026-10-26; zuvor die Kammhöhe, WI-0249 P9).
    await expect(page.getByTestId("kamm-netz-hoehe")).toHaveValue("");
    await expect(page.getByTestId("kamm-netz-hoehe")).toBeDisabled();
    const g = await aufSeite(page, { x: 455, y: 515 });
    await page.mouse.click(g.x, g.y);
    await expect(page.getByTestId("kamm-netz-zahl")).toHaveAttribute("aria-label", /Kämme 1 · Nebengipfel 1/);
    // Der neue Nebengipfel steht gewählt, seine Höhe ist gleich stellbar (Blatt Gebirge, Bild 14); er hat keine eigene Höhe, das Feld zeigt blass das Gelände (c0a24807b).
    await expect(page.getByTestId("kamm-netz-hoehe")).toBeEnabled();
    await expect(page.getByTestId("kamm-netz-hoehe")).toHaveAttribute("data-vorgabe", "true");
    // Wählen: ein Klick auf die Kante wählt den ganzen Kamm; die Höhe gilt dann an allen seinen Stützpunkten.
    await page.getByTestId("kamm-netz-werkzeug-waehlen").click();
    await expect(gesten).toContainText("Ziehen: Punkt verschieben · Doppelklick auf einen Punkt: löschen");
    await expect(gesten).toContainText("Entf: Gewähltes löschen");
    const k = await aufSeite(page, { x: 455, y: 525 });
    await page.mouse.click(k.x, k.y);
    await expect(page.getByTestId("kamm-netz-hoehe")).toBeEnabled();
    await page.getByTestId("kamm-netz-hoehe").fill("2100");
    await page.mouse.click(g.x, g.y);
    await expect(page.getByTestId("kamm-netz-hoehe")).toBeEnabled();
    await expect(page.getByTestId("kamm-netz-hoehe")).toHaveAttribute("data-vorgabe", "true");
    await page.mouse.click(k.x, k.y);
    await expect(page.getByTestId("kamm-netz-hoehe")).toHaveValue("2100");
    await expect(page.getByTestId("kamm-netz-zahl")).toHaveAttribute("aria-label", /Kämme 1 · Nebengipfel 1/);
    await expect(page.getByTestId("kamm-netz-zoom-rein")).toHaveCount(0);
    await expect(page.getByTestId("kamm-netz-zoom-raus")).toHaveCount(0);
    // „⌖ Gebirge“ passt die ganze Fläche ein: Die Karte geht wieder hinaus, die Ecken der Fläche stehen im Bild.
    await page.getByTestId("kamm-netz-ganz").click();
    await expect
        .poll(() =>
            page.evaluate(() => {
                const map = globalThis.avesmapsMap!;
                if (map.isMoving()) return false;
                const leinwand = map.getCanvas();
                return [
                    { x: 440, y: 502 },
                    { x: 466, y: 538 },
                ].every((p) => {
                    const at = map.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(p));
                    return at.x > 0 && at.y > 0 && at.x < leinwand.clientWidth && at.y < leinwand.clientHeight;
                });
            }),
        )
        .toBe(true);
    // Über der Vorschau nur die drei Umschalter in einer Zeile, ohne Satz darunter (Betreiber 2026-10-21).
    await expect(id(page, "-modell-satz")).toHaveCount(0);
    // Die Leiste macht das angedockte Fenster nie breiter: nichts darin ist seitlich verschoben (Prüfbank 2026-10-21).
    expect(
        await page.evaluate(() =>
            [...document.querySelectorAll('[data-lage="angedockt"], [data-lage="angedockt"] *')].some(
                (e) => e.scrollLeft > 0,
            ),
        ),
    ).toBe(false);
    await page.screenshot({ path: "test-results/landschaftseditor-gebirge-kaemme.png" });

    await page.getByTestId("kamm-netz-leiste-fertig").click();
    await expect.poll(() => gesendet.length).toBe(1);
    const changes = gesendet[0]!.gebirge![0]!.changes;
    expect(changes.baseRevision).toBe(1);
    const kamm = changes.netz!.kaemme[0]!;
    // Höhe je Stützpunkt als Paare [Stelle, Höhe] (WI-0249 P9): der ganze Kamm auf 2100.
    expect(kamm.hoehen).toEqual([
        [0, 2100],
        [1, 2100],
        [2, 2100],
    ]);
    expect(kamm).not.toHaveProperty("h");
    expect(kamm.rang).toBe("neben");
    expect(kamm.punkte).toHaveLength(3);
    expect(kamm.punkte[1]).toEqual([450, 520]);
    expect(kamm.punkte[0]![0]).toBeCloseTo(445, 0);
    expect(kamm.punkte[2]![1]).toBeCloseTo(530, 0);
    expect(changes.netz!.nebengipfel).toHaveLength(1);
    // Der Nebengipfel trägt keine eigene Höhe (kein Startwert, c0a24807b): Im Netz steht kein `h` (wie in `landschaftseditor-kammhoehen.spec.ts`).
    expect(changes.netz!.nebengipfel[0]).not.toHaveProperty("h");
    expect(JSON.stringify(gesendet[0])).not.toContain("null");
});

test("der Reiter „Gebirge“ fehlt an einer Fläche, die kein Gebirge ist, und kommt, sobald sie im Entwurf eins wird", async ({
    page,
}) => {
    await oeffne(page);
    await expect(page.getByRole("tab", { name: "Gebirge" })).toBeVisible();
    await page
        .getByTestId(/^landschaftseditor-fenster-\d+-feld-art$/)
        .locator("select")
        .selectOption("huegelland");
    await expect(page.getByRole("tab", { name: "Gebirge" })).toHaveCount(0);
    await page
        .getByTestId(/^landschaftseditor-fenster-\d+-feld-art$/)
        .locator("select")
        .selectOption("gebirge");
    await expect(page.getByRole("tab", { name: "Gebirge" })).toBeVisible();
});

/** Wie viele Ringe die Hervorhebung der Gipfelliste gerade zeichnet (`landschaftseditor/gipfel-hervorhebung.ts`). */
const ringe = (page: Page) =>
    page.evaluate(() => {
        const map = globalThis.avesmapsMap! as unknown as { getSource(id: string): unknown };
        const quelle = map.getSource("editor-gipfel-ring") as
            { serialize(): { data: { features: unknown[] } } } | undefined;
        return quelle?.serialize().data.features.length ?? 0;
    });

test("🔴 Gipfelliste (P5): der höchste zuerst, Marke unter der Kammhöhe; die Höhe hier geht mit „Fertig“ gegen die Revision des Gipfels", async ({
    page,
}) => {
    const gesendet = await oeffne(page);
    await page.getByRole("tab", { name: "Gebirge" }).click();
    const liste = id(page, "-gipfel");
    await expect(liste).toContainText("Gipfel in dieser Fläche (2)");
    // Die Spitze ohne Höhe rechnet mit 5.000 und steht oben; die Zinne (3.200) liegt unter der Kammhöhe 4.000.
    await expect(liste.locator("li").first()).toContainText("Probespitze");
    await expect(id(page, "-gipfel-unter")).toContainText("(4.000): 1");
    // Überfahren hebt den Gipfel auf der Karte hervor, Verlassen nimmt den Ring weg.
    await page.getByTestId(new RegExp(`gebirge-gipfel-${ZINNE}$`)).hover();
    await expect.poll(() => ringe(page)).toBe(1);
    await page.mouse.move(5, 5);
    await expect.poll(() => ringe(page)).toBe(0);
    // ⌖ am Gipfel lässt die Kamera hinfliegen (Entwurf V16).
    const vorher = await page.evaluate(() => (({ lng, lat }) => [lng, lat])(globalThis.avesmapsMap!.getCenter()));
    await page.getByTestId(new RegExp(`gebirge-gipfel-${ZINNE}-ziel$`)).click();
    await expect
        .poll(() => page.evaluate(() => (({ lng, lat }) => [lng, lat])(globalThis.avesmapsMap!.getCenter())))
        .not.toEqual(vorher);

    const feld = page.getByTestId(new RegExp(`gebirge-gipfel-${ZINNE}-hoehe$`));
    await feld.fill("4200");
    await feld.press("Tab");
    await expect(page.getByTestId("landschaft-leiste")).toBeVisible();
    await page.getByTestId("landschaft-leiste-fertig").click();
    await expect.poll(() => gesendet.length).toBe(1);
    expect(gesendet[0]).toEqual({
        operationId: expect.any(String),
        peaks: [{ id: ZINNE, baseRevision: 2, height: 4200 }],
    });
});

test("ein Klick auf den Namen in der Gipfelliste öffnet den Gipfel selbst", async ({ page }) => {
    await oeffne(page);
    await page.getByRole("tab", { name: "Gebirge" }).click();
    await page.getByRole("button", { name: "„Probezinne“ öffnen" }).click();
    await expect(page.getByTestId(/^landschaftseditor-fenster-\d+-gipfel-hoehe$/)).toHaveValue("3200");
});

test("🔴 Vorschau (P6): im offenen Reiter und mit einer Änderung am Gebirge steht die Grundform im Umriss auf der Karte, ohne beides (nach „Verwerfen“) ist sie weg", async ({
    page,
}) => {
    await oeffne(page);
    const vorschauDa = () =>
        page.evaluate(() => {
            const map = globalThis.avesmapsMap! as unknown as {
                getSource(id: string): unknown;
                getLayer(id: string): unknown;
            };
            return (
                map.getSource("editor-gebirge-vorschau") !== undefined &&
                map.getLayer("editor-gebirge-vorschau") !== undefined
            );
        });
    // Das Fenster steht auf „Eigenschaften“: Ohne offenen Reiter „Gebirge“ und ohne Änderung zeigt die Karte ihr Gelände.
    expect(await vorschauDa()).toBe(false);
    await page.getByRole("tab", { name: "Gebirge" }).click();
    // Der offene Reiter genügt, auch ohne Änderung (Betreiberauftrag 2026-10-21: „Kartenvorschau funktioniert auch ohne Änderung im offenen
    // Gebirgsreiter“, WI-0245; c140c4376). Das Bild kommt, sobald die Daten gelesen und gerechnet sind.
    await expect.poll(vorschauDa, { timeout: 15_000 }).toBe(true);
    await id(page, "-typ-rumpfgebirge").click();
    await expect(id(page, "-vorschau")).toContainText("Zellen", { timeout: 15_000 });
    await expect.poll(vorschauDa, { timeout: 15_000 }).toBe(true);
    // „Kartenvorschau“ über der Vorschau (Betreiber 2026-10-21) nimmt das Bild im Umriss weg und bringt es wieder.
    await id(page, "-kartenvorschau").click();
    await expect.poll(vorschauDa).toBe(false);
    await id(page, "-kartenvorschau").click();
    await expect.poll(vorschauDa, { timeout: 15_000 }).toBe(true);
    // Ein Stilwechsel der Karte (setStyle mit diff, wie beim Neigen mit Gelände oder beim Umschalten der Ansicht) nimmt Quelle und
    // Ebene mit; das Bild muss danach wiederkommen (Stage-Fund 2026-10-21: im Umriss nichts zu sehen, der Regler ohne Wirkung).
    await page.evaluate(() => {
        const map = globalThis.avesmapsMap! as unknown as {
            getStyle(): { layers: { id: string }[]; sources: Record<string, unknown> };
            setStyle(stil: unknown, optionen: { diff: boolean }): void;
        };
        const stil = map.getStyle();
        const sources = { ...stil.sources };
        delete sources["editor-gebirge-vorschau"];
        map.setStyle(
            { ...stil, sources, layers: stil.layers.filter((ebene) => ebene.id !== "editor-gebirge-vorschau") },
            { diff: true },
        );
    });
    await expect.poll(vorschauDa, { timeout: 15_000 }).toBe(true);
    // Die große Vorschau oben im Reiter (V1, Bauvorlage V16/V17) zeigt dasselbe Bild, mit dem Umriss darüber.
    await expect(id(page, "-vorschau-gross").locator("img")).toBeVisible();
    await expect(id(page, "-vorschau-gross").locator("path").first()).toBeAttached();
    await page.screenshot({ path: "test-results/landschaftseditor-gebirge-p6.png" });
    // Mit der Änderung im Entwurf (P6) bleibt das Bild auch bei geschlossenem Reiter stehen ...
    await page.getByRole("tab", { name: "Eigenschaften" }).click();
    await expect(page.getByRole("tab", { name: "Eigenschaften" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("landschaft-leiste-fertig")).toBeVisible();
    expect(await vorschauDa()).toBe(true);
    // ... und mit „Verwerfen“ ist es weg: kein Entwurf mehr und kein offener Reiter (im offenen Reiter bliebe es, siehe oben).
    await page.getByTestId("landschaft-leiste-verwerfen").click();
    await expect.poll(vorschauDa).toBe(false);
});

test("🔴 Saat ⟳ neu würfeln (Migration 0214): eine neue Saat im Entwurf, ↺ zurück auf die abgeleitete", async ({
    page,
}) => {
    await oeffne(page);
    await page.getByRole("tab", { name: "Gebirge" }).click();
    // Die abgeleitete Saat der Eingabe (Fixture: 7).
    await expect(id(page, "-saat")).toHaveText("7");
    await expect(id(page, "-saat-zurueck")).toHaveCount(0);
    await id(page, "-saat-wuerfeln").click();
    await expect(id(page, "-saat")).not.toHaveText("7");
    await expect(id(page, "-saat-zurueck")).toBeVisible();
    await expect(page.getByTestId("landschaft-leiste")).toBeVisible();
    await id(page, "-saat-zurueck").click();
    await expect(id(page, "-saat")).toHaveText("7");
});

test.describe("Kamm-Leiste bei 1280 × 800 (Mockup des Betreibers, WI-0245)", () => {
    test.use({ viewport: { width: 1280, height: 800 } });
    test("die Leiste steht ganz im Bild, alle Zeichen sichtbar, das Fenster nicht seitlich verschoben", async ({
        page,
    }) => {
        await oeffne(page);
        await page.getByRole("tab", { name: "Gebirge" }).click();
        // Das Profil des Flusses mit der Platte des Sees auch bei 1280 (WI-0249, Sichtprüfung).
        await expect(id(page, "-gewaesser").locator(".profil__see")).toHaveCount(1);
        await id(page, "-gewaesser").screenshot({ path: "test-results/landschaftseditor-gebirge-gewaesser-1280.png" });
        await id(page, "-kaemme-zeichnen").click();
        const leiste = page.getByTestId("kamm-netz-leiste");
        await expect(leiste).toBeVisible();
        for (const kennung of [
            "kamm-netz-werkzeug-kamm",
            "kamm-netz-rang-haupt",
            "kamm-netz-ganz",
            "kamm-netz-leiste-fertig",
        ])
            await expect(page.getByTestId(kennung)).toBeInViewport();
        const erster = await page.getByTestId("kamm-netz-werkzeug-kamm").boundingBox();
        const letzter = await page.getByTestId("kamm-netz-leiste-fertig").boundingBox();
        expect(erster).not.toBeNull();
        expect(letzter).not.toBeNull();
        expect(letzter!.y).toBe(erster!.y);
        const status = leiste.locator(".kl__unten");
        expect(
            await status.evaluate((element) => {
                const stil = getComputedStyle(element);
                return [stil.paddingLeft, stil.paddingRight, stil.paddingBottom].every((wert) => parseFloat(wert) > 0);
            }),
        ).toBe(true);
        expect(
            await page.evaluate(() =>
                [...document.querySelectorAll('[data-lage="angedockt"], [data-lage="angedockt"] *')].some(
                    (e) => e.scrollLeft > 0,
                ),
            ),
        ).toBe(false);
        await page.screenshot({ path: "test-results/landschaftseditor-gebirge-kaemme-1280.png" });
    });
});

for (const mitTal of [false, true]) {
    test(`Tal und Mulde: ${mitTal ? "Tal und" : "nur"} Mulde zeichnen und speichern`, async ({ page }) => {
        const gesendet = await oeffne(page);
        await page.getByRole("tab", { name: "Gebirge" }).click();
        await id(page, "-kaemme-zeichnen").click();
        await expect(page.getByTestId("kamm-netz-leiste")).toBeVisible();
        await expect.poll(() => page.evaluate(() => globalThis.avesmapsMap!.isMoving())).toBe(false);
        await page.evaluate(() => {
            const map = globalThis.avesmapsMap!;
            map.jumpTo({ center: globalThis.avesmapsRenderProjection!.toRenderLngLat({ x: 453, y: 520 }), zoom: 6 });
            const frei = globalThis.avesmapsVisibleArea!.centre();
            const jetzt = map.project(map.getCenter());
            map.jumpTo({ center: map.unproject([2 * jetzt.x - frei.x, 2 * jetzt.y - frei.y]) });
        });
        if (mitTal) {
            await page.getByTestId("kamm-netz-rang-tal").click();
            const a = await aufSeite(page, { x: 445, y: 510 });
            const b = await aufSeite(page, { x: 460, y: 530 });
            await page.mouse.click(a.x, a.y);
            await page.mouse.dblclick(b.x, b.y);
            await expect(page.locator(".gross__tal")).toHaveCount(1);
        }
        await page.getByTestId("kamm-netz-werkzeug-mulde").click();
        const at = await aufSeite(page, { x: 455, y: 515 });
        await page.mouse.click(at.x, at.y);
        const hoehe = page.getByTestId("kamm-netz-hoehe");
        await expect(hoehe).toBeEnabled();
        // Eine neue Mulde hat keinen Startwert (WI-0249 P9): Das Feld zeigt ihre Vorgabe aus dem Talboden, blass.
        await expect(hoehe).toHaveAttribute("data-vorgabe", "true");
        await expect(hoehe).not.toHaveValue("");
        await hoehe.fill("1200");
        await expect(hoehe).toBeFocused();
        await expect(page.getByTestId("kamm-netz-leiste-ungespeichert")).not.toContainText("0");
        await page.getByTestId("kamm-netz-leiste-zurueck").click();
        await expect(hoehe).toHaveAttribute("data-vorgabe", "true");
        await expect(hoehe).not.toHaveValue("1200");
        await page.getByTestId("kamm-netz-leiste-wieder").click();
        await expect(hoehe).toHaveValue("1200");
        await hoehe.fill("0");
        await hoehe.press("Tab");
        await expect(page.locator(".gross__mulde")).toHaveCount(1);
        expect(
            await page.locator(".gross__mulde").evaluate((node) => {
                const probe = document.createElement("span");
                probe.style.color = "var(--color-profile-river)";
                document.body.append(probe);
                const gleich = getComputedStyle(node).fill === getComputedStyle(probe).color;
                probe.remove();
                return gleich;
            }),
        ).toBe(true);
        await expect(id(page, "-vorschau-skala")).toContainText("Schritt", { timeout: 30_000 });
        await page.getByTestId("kamm-netz-leiste-fertig").click();
        await expect.poll(() => gesendet.length).toBe(1);
        const netz = gesendet[0]!.gebirge![0]!.changes.netz!;
        expect(netz.kaemme).toHaveLength(mitTal ? 1 : 0);
        if (mitTal) expect(netz.kaemme[0]!.rang).toBe("tal");
        // Täler bekommen keinen Startwert: ohne eigene Punkthöhen (WI-0249 P9).
        if (mitTal) expect(netz.kaemme[0]).not.toHaveProperty("hoehen");
        expect(netz.mulden).toHaveLength(1);
        expect(netz.mulden![0]!.h).toBe(0);
        // Erneutes Laden kommt ausschließlich aus dem gespeicherten Stub, ohne Kartendaten zu verändern.
        const detail = structuredClone(DETAIL);
        detail.areas[0]!.gebirge!.netz = {
            kaemme: netz.kaemme.map((k) => ({ punkte: k.punkte, rang: k.rang })),
            nebengipfel: [],
            mulden: netz.mulden!.map((m) => ({ ...m, h: m.h ?? null })),
        };
        await page.unrouteAll({ behavior: "wait" });
        await oeffne(page, detail);
        await page.getByRole("tab", { name: "Gebirge" }).click();
        await expect(page.locator(".gross__mulde")).toHaveCount(1);
    });
}
