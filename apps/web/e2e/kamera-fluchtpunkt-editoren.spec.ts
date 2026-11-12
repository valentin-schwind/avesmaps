import { appendFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type {
    EditorLandscapeDetail,
    EditorLandscapeList,
    EditorPathList,
    EditorPathStreet,
    EditorPowerlineDetail,
    EditorPowerlineList,
    EditorTerritoryDetail,
    EditorTerritoryHierarchy,
    EditorTerritoryList,
} from "@avesmaps3d/shared";
import { ERSTER_BESUCH } from "./erster-besuch.ts";
import { EDITOR_MODE, openMap, settleFrame, showLandscapes } from "./map-handle.ts";
import {
    FERDOK_LAGE,
    GRATENFELS_LAGE,
    editorPanelVorn,
    oeffneOrtseditor,
    zeile as ortZeile,
} from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Der Fluchtpunkt bleibt in der Bildmitte, in ALLEN fünf Editorfenstern (WI-0218 Nachprüfung; Orte, Wege, Landschaften,
 * Herrschaftsgebiete, Kraftlinien). 🔴 Kein Test schreibt in die Datenbank der Entwicklung: Listen und Details kommen aus Stubs wie in den
 * Specs der einzelnen Editoren (`wegeditor-fenster`, `landschaftseditor`, `gebietseditor`, `kraftlinieneditor`, `ortseditor-hinflug`).
 *
 * Geprüft wird je Editor:
 * - (a) Öffnen, Einziehen der Liste, Schließen bei geneigter UND gedrehter Karte: kein Innenabstand, die Mitte der Karte und ein Punkt
 *   voraus (und einer zurück) in Blickrichtung stehen in der Bildmitte, und die Kamera steht still.
 * - (b) Doppelklick auf einen Listeneintrag: das Ziel landet in der Mitte der freien Fläche zwischen den Panels, Neigung und Drehung bleiben.
 * - (c) Klick auf ein Kartenobjekt mit offenem bzw. schließendem Editor.
 * - (d) Breiten 1280, 1920 und 2560.
 *
 * Gemessen wird nur; ist etwas nicht prüfbar, steht es als Zeile im Protokoll (`WI0218_OUT`, JSON je Zeile), nicht als Annahme.
 */
const AUSGABE = process.env["WI0218_OUT"];
function protokoll(zeile: Record<string, unknown>): void {
    if (AUSGABE !== undefined) appendFileSync(AUSGABE, `${JSON.stringify(zeile)}\n`);
}

/**
 * Nur die Fälle (c) lassen jede gezeichnete Straße und Fläche auch in der Liste des Stubs stehen, damit ein Klick auf einen echten Weg
 * oder eine echte Fläche seine Zeile findet. 🪤 In den übrigen Fällen wüchse die Liste um hundert Zeilen, und die Zeile, auf die der
 * Doppelklick zielt, läge außerhalb des Sichtbaren.
 */
let echteZeilen = false;
// Die (d)-Fälle prüfen den Hinweis beim ersten Besuch selbst; sonst gilt er als gesehen (`e2e/erster-besuch.ts`).
test.use(ERSTER_BESUCH);

/**
 * Die Fälle teilen nichts und laufen deshalb auf beiden Arbeitern eines Laufs (WI-0248): Jeder öffnet eine eigene Seite mit eigenen Stubs
 * (`lade`), der Server wird nur gelesen, `echteZeilen` gilt je Arbeiter und wird vor jedem Fall zurückgesetzt, und die Bilder
 * (`WI0218_BILDER`) tragen Editor, Breite und Zustand im Namen. Seriell band die Datei EINEN Arbeiter für ihre 73 Fälle, im Release-Test
 * 71d9cf937 1.933 s am Stück; so verteilen sich die Fälle einzeln auf beide Arbeiter, und ein langer Fall am Ende hält keinen allein auf.
 * 🪤 Ein neuer Fall darf keinen Zustand außerhalb seiner Seite voraussetzen, den ein anderer Fall setzt.
 */
test.describe.configure({ mode: "parallel" });

test.beforeEach(() => {
    echteZeilen = false;
});

const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

/** Weit weg von allem, damit die Kamera fliegen muss (wie `ortseditor-hinflug.spec.ts`). */
const FERNE = { x: 700, y: 400 };
const G = GRATENFELS_LAGE;

type Punkt = { x: number; y: number };
type Rahmen = [number, number, number, number];

/** Wohin die Kamera eines Listeneintrags zielt: ein Punkt (Ort) oder ein Ausschnitt (alle übrigen). */
type Ziel = { punkt: Punkt } | { rahmen: Rahmen };

interface Editor {
    name: string;
    /** Das Werkzeug im `data-testid` des Fensters. */
    werkzeug: string;
    /** Lädt die Karte im Editor-Modus mit den Stubs und wählt die Kachel; das Fenster bleibt zu. */
    lade(page: Page): Promise<void>;
    /** Die Zeile, auf die der Doppelklick fliegt, und was sie anzielt. */
    zeile(page: Page): Locator;
    ziel: Ziel;
    /** Ein Kartenobjekt, auf das ein Klick den Editor öffnet bzw. ihm folgt (c). */
    objekt: {
        /** Anfang der Ebenenkennungen, in denen der Treffer liegt; `punkt` stattdessen: ein bekannter Ort, projiziert. */
        schichten: string;
        punkt?: Punkt;
        /** Um was die Kamera für den Klick steht (Vorgabe Gratenfels). */
        mitte?: Punkt;
        /** Nur Stellen, an denen genau ein Objekt liegt, gemessen an dieser Eigenschaft (sonst fragt der Klick zuerst, welches). */
        eindeutig?: string;
        /** Stellt die Karte so, dass die Objekte einzeln liegen (Landschaften: eine Ebene statt „Alle“). */
        vorbereite?(page: Page): Promise<void>;
    };
}

// ---------------------------------------------------------------------------------------------------------------- Stubs

// Wege
const RS = "c5c5c5c5-0000-4000-8000-0000000000a1";
const RS2 = "c5c5c5c5-0000-4000-8000-0000000000a2";
const PFAD = "c5c5c5c5-0000-4000-8000-0000000000c1";
const WEGE: EditorPathList = {
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
        { id: PFAD, name: "Pfad-3443", subtype: "Pfad", isBach: false, circle: "halb-rechts", segments: 1 },
    ],
};
const strasse = (id: string): EditorPathStreet => ({
    id: id === RS2 ? RS : id,
    name: id === PFAD ? "Pfad-3443" : "Reichsstraße 3",
    subtype: id === PFAD ? "Pfad" : "Reichsstrasse",
    isBach: false,
    circle: "halb-rechts",
    labelVisible: null,
    wiki: { url: "https://de.wiki-aventurica.de/wiki/Reichsstra%C3%9Fe_3", title: "Reichsstraße 3" },
    segments: [
        {
            id: id === RS2 ? RS : id,
            revision: 4,
            labelVisible: true,
            wiki: true,
            points: 7,
            bounds: [G.x - 20, G.y - 10, G.x, G.y],
        },
        { id: RS2, revision: 2, labelVisible: false, wiki: false, points: 3, bounds: [G.x, G.y, G.x + 20, G.y + 10] },
    ],
    bounds: [G.x - 20, G.y - 10, G.x + 20, G.y + 10],
});

// Landschaften
const BECKEN = "a3a3a3a3-0000-4000-8000-000000000001";
const VORGEBIRGE = "a3a3a3a3-0000-4000-8000-000000000002";
/** Eine kleine Fläche (4 × 4 Einheiten), für den Zoom nach der Größe (e). */
const SEE = "a3a3a3a3-0000-4000-8000-000000000003";
const LANDSCHAFTEN: EditorLandscapeList = {
    rows: [
        {
            id: BECKEN,
            name: "Gratenfelser Becken",
            layer: "topographie",
            type: "tal",
            circle: "voll",
            wiki: { url: "https://de.wiki-aventurica.de/wiki/Gratenfelser_Becken", title: "Gratenfelser Becken" },
            areas: 1,
            labels: 1,
            order: 740,
            bounds: [438, 500, 468, 540],
        },
        {
            id: VORGEBIRGE,
            name: "Vorgebirge des Kosch",
            layer: "topographie",
            type: "huegelland",
            circle: "halb-rechts",
            areas: 3,
            order: 280,
            bounds: [455, 495, 500, 545],
        },
        {
            id: SEE,
            name: "Kleiner Bergsee",
            layer: "topographie",
            type: "see",
            circle: "halb-rechts",
            areas: 1,
            order: 900,
            bounds: [450, 515, 454, 519],
        },
    ],
};
const LANDSCHAFT: EditorLandscapeDetail = {
    id: BECKEN,
    name: "Gratenfelser Becken",
    layer: "topographie",
    type: "tal",
    circle: "voll",
    order: 740,
    clickLocked: false,
    curve: { enabled: false },
    areas: [
        {
            id: "a3a3a3a3-0000-4000-8000-0000000000a1",
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
    labels: [],
    neighbors: [],
    revision: 1,
};

// Herrschaftsgebiete
const ID = (n: number): string => `a3a3a3a3-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const REICH = ID(1);
const PROVINZ = ID(2);
const BORNLAND = ID(6);
const GEBIETE: EditorTerritoryList = {
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
            id: BORNLAND,
            name: "Bornland",
            type: "Adelsrepublik",
            circle: "leer",
            minZoom: 0,
            maxZoom: 8,
            color: "#5c7fa3",
            order: 1,
        },
    ],
};
const gebiet = (id: string): EditorTerritoryDetail => ({
    id,
    name: id === REICH ? "Mittelreich" : "Nordmarken",
    type: id === REICH ? "Kaiserreich" : "Herzogtum",
    color: "#c0392b",
    opacity: 0.7,
    minZoom: 0,
    maxZoom: 1,
    order: 0,
    parents: [],
    children: [],
    details: {},
    areas: [],
    claimedBy: [],
    claims: [],
});
const HIERARCHIE: EditorTerritoryHierarchy = { yearBf: 1049, derivedMaxBand: 8, territories: [], areas: [] };

// Kraftlinien
const PUNIN = "b2b2b2b2-0000-4000-8000-000000000001";
const RING = "b2b2b2b2-0000-4000-8000-000000000002";
const KRAFTLINIEN: EditorPowerlineList = {
    rows: [
        {
            id: PUNIN,
            name: "Punin–Gareth",
            circle: "voll",
            shape: "strang",
            segments: 3,
            nodes: 4,
            wiki: { url: "https://de.wiki-aventurica.de/wiki/Kraftlinie", title: "Kraftlinie" },
            ends: ["Gareth", "Punin"],
            bounds: [551, 533, 640, 610],
        },
        { id: RING, name: "Ring um Gareth", circle: "halb-rechts", shape: "ring", segments: 3, nodes: 3 },
    ],
};
const KRAFTLINIE: EditorPowerlineDetail = {
    id: PUNIN,
    name: "Punin–Gareth",
    circle: "voll",
    shape: "strang",
    segments: [],
    nodes: [{ id: "p:gareth", kind: "place", name: "Gareth", x: 551.6, y: 533, nodix: true, meets: [] }],
    bounds: [551, 533, 640, 610],
};

/** Karte im Editor-Modus mit den Stubs eines Subjekts, dann seine Kachel; das Fenster bleibt zu. */
async function ladeSubjekt(page: Page, kachel: string, routen: () => Promise<void>): Promise<void> {
    await stubAdmin(page, { capabilities: ["use_editor_menu"], role: "reviewer" });
    await routen();
    await openMap(page, EDITOR_MODE);
    await editorPanelVorn(page);
    await page.getByTestId(`editorpanel-kachel-${kachel}`).click();
}

const EDITOREN: Editor[] = [
    {
        name: "Orte",
        werkzeug: "ortseditor",
        lade: (page) => oeffneOrtseditor(page, { verb: false }),
        zeile: (page) => ortZeile(page, "Ferdok"),
        ziel: { punkt: FERDOK_LAGE },
        objekt: { schichten: "place-marker", punkt: GRATENFELS_LAGE },
    },
    {
        name: "Wege",
        werkzeug: "wegeditor",
        lade: (page) =>
            ladeSubjekt(page, "wege", async () => {
                // Jede Straße, die gerade gezeichnet ist, steht auch in der Liste: Ein Klick auf einen echten Weg findet seine Zeile.
                await page.route("**/api/editor/paths", async (route) => {
                    const ids = echteZeilen ? await gerenderteIds(page, "path-hit-", "public_id") : [];
                    const rows = [
                        ...WEGE.rows,
                        ...ids.map((id, i) => ({
                            id,
                            name: `Echter Weg ${String(i + 1)}`,
                            subtype: "Strasse",
                            isBach: false,
                            circle: "halb-rechts" as const,
                            segments: 1,
                        })),
                    ];
                    return route.fulfill(json({ rows }));
                });
                await page.route(/\/api\/editor\/paths\/[0-9a-f-]{36}\/street$/, (route) =>
                    route.fulfill(json(strasse(route.request().url().split("/").at(-2)!))),
                );
            }),
        zeile: (page) =>
            page
                .locator('[data-testid^="wegeditor-"][data-testid$="-liste"]')
                .getByRole("option", { name: /Reichsstraße 3/ }),
        ziel: { rahmen: [G.x - 20, G.y - 10, G.x + 20, G.y + 10] },
        objekt: { schichten: "path-hit-" },
    },
    {
        name: "Landschaften",
        werkzeug: "landschaftseditor",
        lade: (page) =>
            ladeSubjekt(page, "regionen", async () => {
                await page.route("**/api/editor/landscapes", async (route) => {
                    const ids = echteZeilen ? await gerenderteIds(page, "landscape-fill-", "region_public_id") : [];
                    const rows = [
                        ...LANDSCHAFTEN.rows,
                        ...ids.map((id, i) => ({
                            id,
                            name: "Echte Fläche " + String(i + 1),
                            layer: "vegetation" as const,
                            circle: "halb-rechts" as const,
                            order: i + 1,
                        })),
                    ];
                    return route.fulfill(json({ rows }));
                });
                await page.route(/\/api\/editor\/landscapes\/[0-9a-f-]{36}$/, (route) =>
                    route.fulfill(json({ ...LANDSCHAFT, id: route.request().url().split("/").at(-1)! })),
                );
            }),
        zeile: (page) =>
            page
                .locator('[data-testid^="landschaftseditor-"][data-testid$="-liste"]')
                .getByRole("option", { name: /Gratenfelser Becken/ }),
        ziel: { rahmen: [438, 500, 468, 540] },
        objekt: {
            schichten: "landscape-fill-",
            eindeutig: "region_public_id",
            vorbereite: (page) => showLandscapes(page, "vegetation"),
        },
    },
    {
        name: "Herrschaftsgebiete",
        werkzeug: "gebietseditor",
        lade: (page) =>
            ladeSubjekt(page, "territorien", async () => {
                await page.route("**/api/editor/territories", (route) => route.fulfill(json(GEBIETE)));
                await page.route(/\/api\/editor\/territories\/[0-9a-f-]{36}$/, (route) =>
                    route.fulfill(json(gebiet(route.request().url().split("/").at(-1)!))),
                );
                await page.route("**/api/editor/territories/*/hierarchy", (route) => route.fulfill(json(HIERARCHIE)));
            }),
        zeile: (page) =>
            page
                .locator('[data-testid^="gebietseditor-"][data-testid$="-liste"]')
                .getByRole("option", { name: /Mittelreich/ }),
        ziel: { rahmen: [400, 450, 520, 560] },
        objekt: { schichten: "territory-fill" },
    },
    {
        name: "Kraftlinien",
        werkzeug: "kraftlinieneditor",
        lade: (page) =>
            ladeSubjekt(page, "kraftlinien", async () => {
                await page.route("**/api/editor/powerlines", (route) => route.fulfill(json(KRAFTLINIEN)));
                await page.route(/\/api\/editor\/powerlines\/[0-9a-f-]{36}$/, (route) =>
                    route.fulfill(json(KRAFTLINIE)),
                );
            }),
        zeile: (page) =>
            page
                .locator('[data-testid^="kraftlinieneditor-"][data-testid$="-liste"]')
                .getByRole("option", { name: /Punin–Gareth/ }),
        ziel: { rahmen: [551, 533, 640, 610] },
        objekt: { schichten: "powerline-hit", mitte: { x: 551.625, y: 532.969 } },
    },
];

/**
 * Die Kennungen der Objekte, die in den Ebenen mit diesem Anfang gezeichnet sind (für die Listen der Stubs). 🪤 Die Liste fragt oft, während
 * die Karte nach einem Ansichtswechsel oder beim Öffnen des Editors neu zeichnet: Dann liegt kurz nichts in den Ebenen, und die Liste stand
 * leer da (Sammellauf 2, „(e) Landschaften“, Zeitüberschreitung am Klick). Darum wartet die Abfrage, bis etwas gezeichnet ist, höchstens 15 s.
 */
async function gerenderteIds(page: Page, praefix: string, eigenschaft: string): Promise<string[]> {
    const ende = Date.now() + 15_000;
    for (;;) {
        const ids = await einmalGerendert(page, praefix, eigenschaft);
        if (ids.length > 0 || Date.now() > ende) return ids;
        await new Promise((fertig) => setTimeout(fertig, 250));
    }
}

async function einmalGerendert(page: Page, praefix: string, eigenschaft: string): Promise<string[]> {
    try {
        return await page.evaluate(
            ([anfang, name]) => {
                const map = globalThis.avesmapsMap!;
                const ebenen = map
                    .getStyle()
                    .layers.map((layer) => layer.id)
                    .filter((id) => id.startsWith(anfang!));
                if (ebenen.length === 0) return [];
                const ids = new Set<string>();
                for (const feature of map.queryRenderedFeatures({ layers: ebenen }))
                    ids.add(String(feature.properties[name!] ?? feature.id ?? ""));
                return [...ids].filter((id) => /^[0-9a-f-]{36}$/.test(id));
            },
            [praefix, eigenschaft],
        );
    } catch {
        return [];
    }
}

/** Das sichtbare Fenster des Werkzeugs (ein abgelegtes ist eingehängt, aber nicht gezeichnet). */
const fensterVon = (page: Page, e: Editor): Locator =>
    page.locator(`dialog[data-lage][open][data-testid^="${e.werkzeug}-"]`);

/** Öffnet das Fenster über das Verb des Editorpanels und wartet, bis es angedockt steht. */
async function oeffne(page: Page, e: Editor): Promise<void> {
    await page.getByTestId("editorpanel-verb").click();
    await expect(fensterVon(page, e)).toHaveCount(1);
    await expect(fensterVon(page, e)).toHaveAttribute("data-lage", "angedockt");
    await ruhe(page);
}

async function schliesse(page: Page, e: Editor): Promise<void> {
    await fensterVon(page, e).getByTestId("fenster-schliessen").click();
    await expect(fensterVon(page, e)).toHaveCount(0);
    await ruhe(page);
}

/** Übergänge der Hülle (220 ms, Platzhalterflug 240 ms) und der Kamera abwarten, dann einen Frame darüber hinaus. */
async function ruhe(page: Page): Promise<void> {
    await page.waitForTimeout(600);
    await page.waitForFunction(() => !globalThis.avesmapsMap!.isMoving(), undefined, { timeout: 15_000 });
    await settleFrame(page);
}

// ---------------------------------------------------------------------------------------------------------------- Messung

interface Aufnahme {
    breite: number;
    hoehe: number;
    kamera: { lng: number; lat: number; zoom: number; pitch: number; bearing: number; bewegt: boolean };
    padding: { top: number; right: number; bottom: number; left: number };
    /** `project(getCenter())` */
    mitte: Punkt;
    /** Ein Punkt 400 Bildpunkte (Weltpixel) voraus in Blickrichtung und einer 150 zurück, über Mercator gerechnet. */
    voraus: Punkt;
    zurueck: Punkt;
    insets: { top: number; right: number; bottom: number; left: number };
    keepFree: { top: number; right: number; bottom: number; left: number };
}

/** Die Projektion und die Kamera, in einem Zug gelesen. */
async function aufnahme(page: Page): Promise<Aufnahme> {
    return page.evaluate(() => {
        const map = globalThis.avesmapsMap as unknown as {
            getCenter(): { lng: number; lat: number };
            getZoom(): number;
            getPitch(): number;
            getBearing(): number;
            isMoving(): boolean;
            getPadding(): { top: number; right: number; bottom: number; left: number };
            getCanvas(): HTMLCanvasElement;
            project(p: { lng: number; lat: number }): { x: number; y: number };
        };
        const canvas = map.getCanvas();
        const c = map.getCenter();
        const bearing = map.getBearing();
        const zoom = map.getZoom();
        const merc = (lng: number, lat: number) => ({
            x: (lng + 180) / 360,
            y: 0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI),
        });
        const lngLat = (x: number, y: number) => ({
            lng: x * 360 - 180,
            lat: (360 / Math.PI) * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - 90,
        });
        // Mercator: x nach Osten, y nach Süden; Blickrichtung `bearing` (im Uhrzeigersinn von Norden) ist (sin, -cos).
        const rad = (bearing * Math.PI) / 180;
        const welt = 512 * 2 ** zoom;
        const m = merc(c.lng, c.lat);
        const entlang = (abstand: number) => {
            const d = abstand / welt;
            const p = map.project(lngLat(m.x + Math.sin(rad) * d, m.y - Math.cos(rad) * d));
            return { x: p.x, y: p.y };
        };
        const mitte = map.project(c);
        const area = globalThis.avesmapsVisibleArea!;
        return {
            breite: canvas.clientWidth,
            hoehe: canvas.clientHeight,
            kamera: {
                lng: c.lng,
                lat: c.lat,
                zoom,
                pitch: map.getPitch(),
                bearing,
                bewegt: map.isMoving(),
            },
            padding: map.getPadding(),
            mitte: { x: mitte.x, y: mitte.y },
            voraus: entlang(400),
            zurueck: entlang(-150),
            insets: area.insets(),
            keepFree: area.keepFree(),
        };
    });
}

/** Die Kamera ohne Flug stellen (Testaufbau): Mitte, Zoom, Neigung, Drehung; die Mitte bleibt in der Bildmitte. */
async function stelleKamera(
    page: Page,
    ort: Punkt,
    ansicht: { zoom: number; pitch: number; bearing: number },
): Promise<void> {
    await page.evaluate(
        async ({ punkt, zoom, pitch, bearing }) => {
            const map = globalThis.avesmapsMap!;
            map.jumpTo({ center: globalThis.avesmapsRenderProjection!.toRenderLngLat(punkt), zoom, pitch, bearing });
            await new Promise<void>((fertig) => {
                map.once("idle", () => fertig());
                setTimeout(fertig, 10_000);
            });
        },
        { punkt: ort, ...ansicht },
    );
    await settleFrame(page);
}

/** Der Fluchtpunkt steht in der Bildmitte (±1 px) und der Innenabstand ist null. Weicht etwas ab, nennt die Meldung, wo. */
function pruefeFluchtpunkt(a: Aufnahme, wo: string): void {
    const bx = a.breite / 2;
    const by = a.hoehe / 2;
    expect.soft(a.padding, `${wo}: Innenabstand`).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect
        .soft(Math.abs(a.mitte.x - bx), `${wo}: Mitte x ${String(a.mitte.x)} statt ${String(bx)}`)
        .toBeLessThanOrEqual(1);
    expect
        .soft(Math.abs(a.mitte.y - by), `${wo}: Mitte y ${String(a.mitte.y)} statt ${String(by)}`)
        .toBeLessThanOrEqual(1);
    expect
        .soft(Math.abs(a.voraus.x - bx), `${wo}: voraus x ${String(a.voraus.x)} statt ${String(bx)}`)
        .toBeLessThanOrEqual(1);
    expect
        .soft(Math.abs(a.zurueck.x - bx), `${wo}: zurück x ${String(a.zurueck.x)} statt ${String(bx)}`)
        .toBeLessThanOrEqual(1);
}

/** Die Kamera hat sich nicht bewegt: dieselben Werte, kein Flug. */
function pruefeStill(vorher: Aufnahme, nachher: Aufnahme, wo: string): void {
    const k0 = vorher.kamera;
    const k1 = nachher.kamera;
    expect.soft(k1.bewegt, `${wo}: Flug läuft`).toBe(false);
    expect.soft(Math.abs(k1.lng - k0.lng), `${wo}: lng ${String(k0.lng)} → ${String(k1.lng)}`).toBeLessThan(1e-7);
    expect.soft(Math.abs(k1.lat - k0.lat), `${wo}: lat ${String(k0.lat)} → ${String(k1.lat)}`).toBeLessThan(1e-7);
    expect.soft(Math.abs(k1.zoom - k0.zoom), `${wo}: Zoom ${String(k0.zoom)} → ${String(k1.zoom)}`).toBeLessThan(1e-6);
    expect
        .soft(Math.abs(k1.pitch - k0.pitch), `${wo}: Neigung ${String(k0.pitch)} → ${String(k1.pitch)}`)
        .toBeLessThan(1e-6);
    expect
        .soft(Math.abs(k1.bearing - k0.bearing), `${wo}: Drehung ${String(k0.bearing)} → ${String(k1.bearing)}`)
        .toBeLessThan(1e-6);
}

function zusammen(a: Aufnahme): Record<string, unknown> {
    const r = (n: number) => Math.round(n * 100) / 100;
    return {
        kamera: {
            lng: a.kamera.lng,
            lat: a.kamera.lat,
            zoom: r(a.kamera.zoom),
            pitch: r(a.kamera.pitch),
            bearing: r(a.kamera.bearing),
        },
        padding: a.padding,
        mitte: { x: r(a.mitte.x), y: r(a.mitte.y) },
        voraus: { x: r(a.voraus.x), y: r(a.voraus.y) },
        zurueck: { x: r(a.zurueck.x), y: r(a.zurueck.y) },
        insets: a.insets,
        bildmitte: { x: a.breite / 2, y: a.hoehe / 2 },
    };
}

// ---------------------------------------------------------------------------------------------------------------- (a)

const NEIGUNGEN = [45, 60];
const DREHUNGEN = [0, 30, -120];
const ZOOMSTUFEN = [5.5, 7.5];

/** Eine Runde (a): Kamera stellen, Fenster öffnen, Liste ein- und ausfahren, schließen; jedes Mal Fluchtpunkt und Kamera prüfen. */
async function rundeA(
    page: Page,
    e: Editor,
    ansicht: { zoom: number; pitch: number; bearing: number },
    breite: number,
): Promise<void> {
    const wo =
        e.name +
        " " +
        String(breite) +
        " z" +
        String(ansicht.zoom) +
        " n" +
        String(ansicht.pitch) +
        " d" +
        String(ansicht.bearing);
    await stelleKamera(page, G, ansicht);
    const zu = await aufnahme(page);
    pruefeFluchtpunkt(zu, wo + " vorher");
    await oeffne(page, e);
    const offen = await aufnahme(page);
    pruefeFluchtpunkt(offen, wo + " offen");
    pruefeStill(zu, offen, wo + " offen");
    // Die Liste einziehen und wieder ausfahren, wo es den Schalter gibt.
    const schalter = fensterVon(page, e).locator('[data-testid$="-listenschalter"]');
    let eingezogen: Aufnahme | undefined;
    if ((await schalter.count()) > 0) {
        await schalter.click();
        await ruhe(page);
        eingezogen = await aufnahme(page);
        pruefeFluchtpunkt(eingezogen, wo + " Liste eingezogen");
        pruefeStill(zu, eingezogen, wo + " Liste eingezogen");
        await schalter.click();
        await ruhe(page);
    }
    await schliesse(page, e);
    const danach = await aufnahme(page);
    pruefeFluchtpunkt(danach, wo + " geschlossen");
    pruefeStill(zu, danach, wo + " geschlossen");
    protokoll({
        pruefung: "a",
        editor: e.name,
        breite,
        zoom: ansicht.zoom,
        pitch: zu.kamera.pitch,
        bearing: zu.kamera.bearing,
        vorher: zusammen(zu),
        offen: { insetsRechts: offen.insets.right, keepFreeRechts: offen.keepFree.right },
        eingezogen:
            eingezogen === undefined
                ? "kein Schalter"
                : { insetsRechts: eingezogen.insets.right, keepFreeRechts: eingezogen.keepFree.right },
        nachher: zusammen(danach),
    });
}

for (const e of EDITOREN) {
    test(
        "(a) " + e.name + ": Öffnen, Liste einziehen, Schließen bei geneigter und gedrehter Karte (1920 × 1080)",
        async ({ page }) => {
            test.setTimeout(900_000);
            await page.setViewportSize({ width: 1920, height: 1080 });
            await e.lade(page);
            let zaehler = 0;
            for (const zoom of ZOOMSTUFEN)
                for (const pitch of NEIGUNGEN)
                    for (const bearing of DREHUNGEN) {
                        await rundeA(page, e, { zoom, pitch, bearing }, 1920);
                        zaehler += 1;
                    }
            expect(zaehler).toBe(ZOOMSTUFEN.length * NEIGUNGEN.length * DREHUNGEN.length);
        },
    );
    for (const [breite, hoehe] of [
        [1280, 720],
        [2560, 1440],
    ] as [number, number][]) {
        test(
            "(a) " +
                e.name +
                ": Öffnen, Liste einziehen, Schließen, Neigung 45 und Drehung 30 (" +
                String(breite) +
                " × " +
                String(hoehe) +
                ")",
            async ({ page }) => {
                test.setTimeout(300_000);
                await page.setViewportSize({ width: breite, height: hoehe });
                await e.lade(page);
                await rundeA(page, e, { zoom: 6.5, pitch: 45, bearing: 30 }, breite);
                await rundeA(page, e, { zoom: 7.5, pitch: 60, bearing: -120 }, breite);
            },
        );
    }
}

// ---------------------------------------------------------------------------------------------------------------- Kontrolle

test("(Kontrolle) die Messung erkennt einen verschobenen Fluchtpunkt: MapLibres padding rechts 480 px", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openMap(page, EDITOR_MODE);
    await stelleKamera(page, G, { zoom: 6.5, pitch: 45, bearing: 30 });
    const gut = await aufnahme(page);
    expect(Math.abs(gut.mitte.x - gut.breite / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(gut.voraus.x - gut.breite / 2)).toBeLessThanOrEqual(1);
    // Wie vor WI-0218: die freie Fläche als Innenabstand. Die Messung muss anschlagen.
    await page.evaluate(() => {
        (globalThis.avesmapsMap as unknown as { jumpTo(o: { padding: Record<string, number> }): void }).jumpTo({
            padding: { top: 0, right: 480, bottom: 0, left: 0 },
        });
    });
    await settleFrame(page);
    const schlecht = await aufnahme(page);
    protokoll({ pruefung: "kontrolle", gut: zusammen(gut), mitPadding: zusammen(schlecht) });
    expect(schlecht.padding.right).toBe(480);
    expect(Math.abs(schlecht.mitte.x - schlecht.breite / 2)).toBeGreaterThan(200);
    expect(Math.abs(schlecht.voraus.x - schlecht.breite / 2)).toBeGreaterThan(200);
});

// ---------------------------------------------------------------------------------------------------------------- (b)

interface ZielStand {
    ziel: Punkt;
    luecke: Punkt;
    /** Links endet das linke Panel, rechts beginnt das rechte (Bildpunkte der Karte). */
    links: number;
    rechts: number;
    breiteLuecke: number;
    untenPanel: boolean;
    /** Bei einem Ausschnitt: Anteil seiner Breite im Bild, der rechts der Kante des rechten Panels liegt (unter dem Fenster). */
    anteilUnterFenster: number | undefined;
}

/** Wo das Ziel eines Eintrags auf der Karte steht und wo die Mitte der Lücke zwischen den Panels liegt (wie `stand()` in `kamera-fluchtpunkt.spec.ts`). */
async function zielStand(page: Page, ziel: Ziel): Promise<ZielStand> {
    return page.evaluate((z) => {
        const map = globalThis.avesmapsMap!;
        const projektion = globalThis.avesmapsRenderProjection!;
        let at: { x: number; y: number };
        let ausdehnung: { min: number; max: number } | undefined;
        if ("punkt" in z) {
            at = map.project(projektion.toRenderLngLat(z.punkt));
        } else {
            const a = projektion.toRenderLngLat({ x: z.rahmen[0], y: z.rahmen[1] });
            const b = projektion.toRenderLngLat({ x: z.rahmen[2], y: z.rahmen[3] });
            const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
            const lat =
                (2 * Math.atan(Math.exp((mercY(Math.min(a.lat, b.lat)) + mercY(Math.max(a.lat, b.lat))) / 2)) -
                    Math.PI / 2) *
                (180 / Math.PI);
            at = map.project({ lng: (a.lng + b.lng) / 2, lat });
            const ecken = [
                map.project({ lng: a.lng, lat: a.lat }),
                map.project({ lng: a.lng, lat: b.lat }),
                map.project({ lng: b.lng, lat: a.lat }),
                map.project({ lng: b.lng, lat: b.lat }),
            ];
            ausdehnung = { min: Math.min(...ecken.map((p) => p.x)), max: Math.max(...ecken.map((p) => p.x)) };
        }
        const canvas = map.getCanvas();
        const karte = canvas.getBoundingClientRect();
        const { top, bottom } = globalThis.avesmapsVisibleArea!.insets();
        const panels = (kante: string) =>
            [...document.querySelectorAll<HTMLElement>(`[data-map-overlay="${kante}"]`)]
                .filter((element) => !element.closest("[inert]") && element.getClientRects().length > 0)
                .map((element) => element.getBoundingClientRect());
        const links = Math.max(0, ...panels("left").map((box) => box.right - karte.left));
        const rechts = Math.min(canvas.clientWidth, ...panels("right").map((box) => box.left - karte.left));
        return {
            ziel: { x: at.x, y: at.y },
            luecke: { x: (links + rechts) / 2, y: top + (canvas.clientHeight - top - bottom) / 2 },
            links,
            rechts,
            breiteLuecke: rechts - links,
            untenPanel: at.x < links - 0.5 || at.x > rechts + 0.5,
            anteilUnterFenster:
                ausdehnung === undefined
                    ? undefined
                    : Math.max(
                          0,
                          Math.min(
                              1,
                              (ausdehnung.max - Math.max(rechts, ausdehnung.min)) / (ausdehnung.max - ausdehnung.min),
                          ),
                      ),
        };
    }, ziel);
}

const BREITEN: [number, number][] = [
    [1280, 720],
    [1920, 1080],
    [2560, 1440],
];

for (const e of EDITOREN) {
    for (const [breite, hoehe] of BREITEN) {
        test(`(b) ${e.name}: Doppelklick auf den Eintrag landet in der freien Fläche, geneigt 45 und gedreht 30 (${String(breite)} × ${String(hoehe)})`, async ({
            page,
        }) => {
            test.setTimeout(180_000);
            await page.setViewportSize({ width: breite, height: hoehe });
            await e.lade(page);
            await oeffne(page, e);
            await stelleKamera(page, FERNE, { zoom: 6, pitch: 45, bearing: 30 });
            const vorher = await aufnahme(page);
            await e.zeile(page).dblclick();
            // Der Flug beginnt erst nach der Geste: warten, bis sich die Mitte bewegt hat und die Kamera wieder steht.
            let flug = true;
            try {
                await page.waitForFunction(
                    (alt) => {
                        const map = globalThis.avesmapsMap!;
                        const jetzt = map.getCenter();
                        return !map.isMoving() && (jetzt.lng !== alt.lng || jetzt.lat !== alt.lat);
                    },
                    { lng: vorher.kamera.lng, lat: vorher.kamera.lat },
                    { timeout: 15_000 },
                );
            } catch {
                flug = false;
            }
            await ruhe(page);
            const nachher = await aufnahme(page);
            const stand = await zielStand(page, e.ziel);
            const dx = stand.ziel.x - stand.luecke.x;
            const dy = stand.ziel.y - stand.luecke.y;
            const toleranz = "punkt" in e.ziel ? 8 : 16;
            const wo = `${e.name} ${String(breite)}`;
            protokoll({
                pruefung: "b",
                editor: e.name,
                breite,
                flug,
                zielArt: "punkt" in e.ziel ? "punkt" : "rahmen",
                ziel: { x: Math.round(stand.ziel.x), y: Math.round(stand.ziel.y) },
                luecke: { x: Math.round(stand.luecke.x), y: Math.round(stand.luecke.y) },
                abweichung: { dx: Math.round(dx * 10) / 10, dy: Math.round(dy * 10) / 10 },
                links: Math.round(stand.links),
                rechts: Math.round(stand.rechts),
                breiteLuecke: Math.round(stand.breiteLuecke),
                untenPanel: stand.untenPanel,
                anteilUnterFenster: stand.anteilUnterFenster,
                bildmitte: { x: nachher.breite / 2, y: nachher.hoehe / 2 },
                insets: nachher.insets,
                keepFree: nachher.keepFree,
                vorher: { zoom: vorher.kamera.zoom, pitch: vorher.kamera.pitch, bearing: vorher.kamera.bearing },
                nachher: { zoom: nachher.kamera.zoom, pitch: nachher.kamera.pitch, bearing: nachher.kamera.bearing },
                fluchtpunkt: zusammen(nachher),
            });
            // Neigung und Drehung bleiben, der Fluchtpunkt steht wieder in der Bildmitte – immer.
            expect.soft(flug, `${wo}: die Kamera fliegt`).toBe(true);
            // Die Neigung bleibt – außer die Kamera deckelt sie zum Zoom des Ausschnitts (`maxPitchForZoom`): dann nur kleiner.
            expect
                .soft(
                    nachher.kamera.pitch - vorher.kamera.pitch,
                    `${wo}: Neigung ${String(vorher.kamera.pitch)} → ${String(nachher.kamera.pitch)} bei Zoom ${String(nachher.kamera.zoom)}`,
                )
                .toBeLessThan(1e-3);
            expect.soft(Math.abs(nachher.kamera.bearing - vorher.kamera.bearing), `${wo}: Drehung`).toBeLessThan(1e-3);
            pruefeFluchtpunkt(nachher, `${wo} nach dem Flug`);
            // Bei 1280 deckt der angedockte Editor mit dem Planer fast alles: nur dokumentieren, nichts erzwingen.
            if (breite >= 1920 && stand.breiteLuecke > 0) {
                expect
                    .soft(
                        Math.abs(dx),
                        `${wo}: ${String(Math.round(dx))} px waagerecht neben der Mitte der Lücke (${String(Math.round(stand.luecke.x))})`,
                    )
                    .toBeLessThanOrEqual(toleranz);
                expect
                    .soft(Math.abs(dy), `${wo}: ${String(Math.round(dy))} px senkrecht neben der Mitte der Lücke`)
                    .toBeLessThanOrEqual(toleranz);
                expect.soft(stand.untenPanel, `${wo}: Ziel unter einem Panel`).toBe(false);
            }
        });
    }
}

// ---------------------------------------------------------------------------------------------------------------- (c)

interface Treffer {
    /** Bildpunkte der Karte */
    x: number;
    y: number;
    lng: number;
    lat: number;
    ebene?: string;
}

/**
 * Ein Kartenobjekt dieses Editors in einem Rechteck der Karte (Bildpunkte): das, das dem Zielpunkt am nächsten liegt und nicht unter einem
 * Panel oder Bedienelement. Orte kommen über ihre bekannte Lage, alle übrigen aus den gezeichneten Ebenen (`queryRenderedFeatures`).
 */
async function sucheObjekt(
    page: Page,
    e: Editor,
    bereich: { x0: number; x1: number; y0: number; y1: number; zielX: number; zielY: number },
): Promise<Treffer | undefined> {
    return page.evaluate(
        ({ schichten, punkt, eindeutig, rechteck }) => {
            const map = globalThis.avesmapsMap!;
            const canvas = map.getCanvas();
            const rahmen = canvas.getBoundingClientRect();
            const frei = (x: number, y: number): boolean =>
                document.elementFromPoint(rahmen.left + x, rahmen.top + y) === canvas;
            if (punkt !== undefined) {
                const at = map.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(punkt));
                if (at.x < 0 || at.y < 0 || at.x > canvas.clientWidth || at.y > canvas.clientHeight) return undefined;
                if (!frei(at.x, at.y)) return undefined;
                const p = map.unproject([at.x, at.y]);
                return { x: at.x, y: at.y, lng: p.lng, lat: p.lat };
            }
            const ebenen = map
                .getStyle()
                .layers.map((layer) => layer.id)
                .filter((id) => id.startsWith(schichten));
            // Ein Klick auf einen Ort, Nodix, Weg oder eine Kraftlinie gehört diesem (sie gehen Flächen vor): Objekte anderer Art in der Nähe zählen nicht.
            const orte = map
                .getStyle()
                .layers.map((layer) => layer.id)
                .filter(
                    (id) =>
                        (id.startsWith("place-marker") || id.startsWith("nodix") || id.includes("-hit")) &&
                        !id.startsWith(schichten),
                );
            let bester: { x: number; y: number; ebene: string; abstand: number } | undefined;
            for (let y = rechteck.y0; y <= rechteck.y1; y += 6) {
                for (let x = rechteck.x0; x <= rechteck.x1; x += 6) {
                    if (!frei(x, y)) continue;
                    const treffer = map.queryRenderedFeatures([x, y], { layers: ebenen });
                    if (treffer.length === 0) continue;
                    if (
                        eindeutig !== undefined &&
                        new Set(treffer.map((f) => String(f.properties[eindeutig]))).size !== 1
                    )
                        continue;
                    if (
                        map.queryRenderedFeatures(
                            [
                                [x - 24, y - 24],
                                [x + 24, y + 24],
                            ],
                            { layers: orte },
                        ).length > 0
                    )
                        continue;
                    const abstand = Math.hypot(x - rechteck.zielX, y - rechteck.zielY);
                    if (bester === undefined || abstand < bester.abstand)
                        bester = { x, y, ebene: treffer[0]!.layer.id, abstand };
                }
            }
            if (bester === undefined) return undefined;
            const p = map.unproject([bester.x, bester.y]);
            return { x: bester.x, y: bester.y, lng: p.lng, lat: p.lat, ebene: bester.ebene };
        },
        { schichten: e.objekt.schichten, punkt: e.objekt.punkt, eindeutig: e.objekt.eindeutig, rechteck: bereich },
    );
}

interface ObjektStand {
    /** Wo der geklickte Geländepunkt jetzt im Bild steht. */
    x: number;
    y: number;
    /** Liegt er unter einem Panel (links, rechts, oben, unten) oder außerhalb des Bildes? */
    verdeckt: string | null;
    /** Linke Kante des rechten Panels, falls eines die Karte deckt (Bildpunkte der Karte). */
    fensterLinks: number | null;
}

async function objektStand(page: Page, ort: { lng: number; lat: number }): Promise<ObjektStand> {
    return page.evaluate((p) => {
        const map = globalThis.avesmapsMap!;
        const canvas = map.getCanvas();
        const karte = canvas.getBoundingClientRect();
        const at = map.project(p);
        let verdeckt: string | null = null;
        let fensterLinks: number | null = null;
        for (const element of document.querySelectorAll<HTMLElement>("[data-map-overlay]")) {
            if (element.closest("[inert]") || element.getClientRects().length === 0) continue;
            const box = element.getBoundingClientRect();
            const kante = element.getAttribute("data-map-overlay");
            if (kante === "right") fensterLinks = Math.min(fensterLinks ?? Infinity, box.left - karte.left);
            const x = karte.left + at.x;
            const y = karte.top + at.y;
            if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) {
                verdeckt =
                    (kante ?? "?") + " " + (element.getAttribute("data-testid") ?? element.tagName.toLowerCase());
            }
        }
        if (at.x < 0 || at.y < 0 || at.x > canvas.clientWidth || at.y > canvas.clientHeight)
            verdeckt = verdeckt ?? "außerhalb";
        return { x: at.x, y: at.y, verdeckt, fensterLinks };
    }, ort);
}

/** Was das Fenster nach dem Klick zeigt: sein Titel und die gewählte Zeile seiner Liste (der Editor folgt dem Klick). */
async function fensterStand(
    page: Page,
    e: Editor,
): Promise<{ offen: number; titel: string | null; gewaehlt: string | null }> {
    const fenster = fensterVon(page, e);
    const offen = await fenster.count();
    if (offen === 0) return { offen, titel: null, gewaehlt: null };
    const titel = await fenster.first().locator(".avm-fenster__titel").first().textContent();
    const gewaehlt = fenster.first().locator('[role="option"][aria-selected="true"]').first();
    return {
        offen,
        titel: titel?.trim() ?? null,
        gewaehlt: (await gewaehlt.count()) > 0 ? ((await gewaehlt.textContent())?.trim().slice(0, 40) ?? null) : null,
    };
}

/** Wartet, bis die Kamera steht (ein Klick kann einen Flug auslösen) und die Übergänge der Fenster durch sind. */
async function klickRuhe(page: Page): Promise<void> {
    await page.waitForTimeout(1500);
    await ruhe(page);
}

/** Die Kamera: hat sie sich bewegt? Nennt, was sich geändert hat. */
function kameraDifferenz(vorher: Aufnahme, nachher: Aufnahme): Record<string, number> {
    const k0 = vorher.kamera;
    const k1 = nachher.kamera;
    const r = (n: number) => Math.round(n * 1e6) / 1e6;
    return {
        lng: r(k1.lng - k0.lng),
        lat: r(k1.lat - k0.lat),
        zoom: r(k1.zoom - k0.zoom),
        pitch: r(k1.pitch - k0.pitch),
        bearing: r(k1.bearing - k0.bearing),
    };
}

/**
 * (c1) Der Editor ist zu, das Objekt liegt dort, wo das angedockte Fenster gleich stehen wird, ein Klick darauf: Öffnet er den Editor, liegt das
 * Objekt danach nicht unter ihm (die Kamera fliegt), und der Fluchtpunkt bleibt in der Bildmitte.
 * (c2) Der Editor ist offen und angedockt, das Objekt liegt in der freien Fläche: Der Klick lässt es dort und den Fluchtpunkt stehen.
 */
async function klickAufObjekt(page: Page, e: Editor, breite: number, offen: boolean): Promise<void> {
    const wo = e.name + " " + String(breite) + (offen ? " Fenster offen" : " Fenster zu");
    echteZeilen = true;
    await e.lade(page);
    const mitte = e.objekt.mitte ?? G;
    await stelleKamera(page, mitte, { zoom: 7, pitch: 45, bearing: 30 });
    await e.objekt.vorbereite?.(page);
    let bereich: { x0: number; x1: number; y0: number; y1: number; zielX: number; zielY: number };
    if (offen) {
        await oeffne(page, e);
        const lage = await zielStand(page, { punkt: mitte });
        if (lage.breiteLuecke <= 120) {
            protokoll({
                pruefung: "c",
                editor: e.name,
                breite,
                fenster: "offen",
                ergebnis: "kein freier Raum neben dem Fenster",
                luecke: lage.breiteLuecke,
            });
            return;
        }
        // Den Ort in die Mitte der Lücke rücken (Testaufbau, ohne Flug), dann dort suchen.
        await page.evaluate(
            ({ dx, dy }) => {
                const map = globalThis.avesmapsMap!;
                const mitte = map.project(map.getCenter());
                map.jumpTo({ center: map.unproject([mitte.x - dx, mitte.y - dy]) });
            },
            { dx: lage.luecke.x - lage.ziel.x, dy: lage.luecke.y - lage.ziel.y },
        );
        await settleFrame(page);
        bereich = {
            x0: lage.links + 30,
            x1: lage.rechts - 30,
            y0: 80,
            y1: (await aufnahme(page)).hoehe - 80,
            zielX: lage.luecke.x,
            zielY: lage.luecke.y,
        };
    } else {
        const a = await aufnahme(page);
        // Der Bereich, den das angedockte Fenster einnehmen wird, aber noch nicht das Editorpanel: zwischen der linken Kante des künftigen
        // Fensters und der des Panels. 🪤 Ein Klick öffnet das Fenster nur mit den Eigenschaften, die Liste eingezogen (EDIT-0003,
        // Variante A): Es ist `--avm-fenster-werkzeug` minus `--avm-fenster-inspektor` breit (560 px), nicht 960. Bei 960 lag die Stelle
        // danach frei, und der Fall „unter dem Fenster“ wurde nie geprüft. Der Ort wird dorthin gerückt (Testaufbau), alle anderen
        // Objekte werden dort gesucht.
        const kanten = await page.evaluate(() => {
            const wurzel = getComputedStyle(document.documentElement);
            const px = (name: string) => Number.parseFloat(wurzel.getPropertyValue(name)) || 0;
            const karte = globalThis.avesmapsMap!.getCanvas().getBoundingClientRect();
            const panel = [...document.querySelectorAll<HTMLElement>('[data-map-overlay="right"]')]
                .filter((element) => !element.closest("[inert]") && element.getClientRects().length > 0)
                .map((element) => element.getBoundingClientRect().left - karte.left);
            return {
                fenster: karte.width - (px("--avm-fenster-werkzeug") - px("--avm-fenster-inspektor")),
                panel: Math.min(karte.width, ...panel),
            };
        });
        const ziel = {
            x: kanten.panel - kanten.fenster >= 60 ? (kanten.fenster + kanten.panel) / 2 : a.breite - 960 + 140,
            y: a.hoehe / 2,
        };
        await page.evaluate(
            ({ zx, zy }) => {
                const map = globalThis.avesmapsMap!;
                const mitte = map.project(map.getCenter());
                map.jumpTo({ center: map.unproject([2 * mitte.x - zx, 2 * mitte.y - zy]) });
            },
            { zx: ziel.x, zy: ziel.y },
        );
        await settleFrame(page);
        // Nur in dem Streifen, den das Fenster gleich deckt (ohne den Rand des Panels).
        const streifen = kanten.panel - kanten.fenster >= 60;
        bereich = {
            x0: streifen ? Math.max(ziel.x - 90, kanten.fenster + 12) : ziel.x - 90,
            x1: streifen ? Math.min(ziel.x + 90, kanten.panel - 12) : ziel.x + 90,
            y0: 100,
            y1: a.hoehe - 100,
            zielX: ziel.x,
            zielY: ziel.y,
        };
    }
    const treffer = await sucheObjekt(page, e, bereich);
    if (treffer === undefined) {
        protokoll({
            pruefung: "c",
            editor: e.name,
            breite,
            fenster: offen ? "offen" : "zu",
            ergebnis: "kein Objekt im Suchbereich",
            bereich,
        });
        test.info().annotations.push({ type: "luecke", description: wo + ": kein Objekt im Suchbereich" });
        return;
    }
    const vorher = await aufnahme(page);
    const vorherStand = await objektStand(page, treffer);
    const seite = await page.evaluate(() => {
        const box = globalThis.avesmapsMap!.getCanvas().getBoundingClientRect();
        return { left: box.left, top: box.top };
    });
    await page.mouse.click(seite.left + treffer.x, seite.top + treffer.y);
    await klickRuhe(page);
    const nachher = await aufnahme(page);
    const nachherStand = await objektStand(page, treffer);
    const fenster = await fensterStand(page, e);
    const gewaehlt = await page.evaluate(() => globalThis.avesmapsSelectedSubject?.());
    if (process.env["WI0218_BILDER"] !== undefined)
        await page.screenshot({
            path:
                process.env["WI0218_BILDER"] +
                "/c-" +
                e.name +
                "-" +
                String(breite) +
                (offen ? "-offen" : "-zu") +
                ".png",
        });
    protokoll({
        pruefung: "c",
        editor: e.name,
        breite,
        fenster: offen ? "offen" : "zu",
        ebene: treffer.ebene ?? "Ort",
        objektVorher: { x: Math.round(vorherStand.x), y: Math.round(vorherStand.y), verdeckt: vorherStand.verdeckt },
        objektNachher: {
            x: Math.round(nachherStand.x),
            y: Math.round(nachherStand.y),
            verdeckt: nachherStand.verdeckt,
            fensterLinks: nachherStand.fensterLinks === null ? null : Math.round(nachherStand.fensterLinks),
        },
        kameraDifferenz: kameraDifferenz(vorher, nachher),
        bewegt: Object.values(kameraDifferenz(vorher, nachher)).some((v) => v !== 0),
        fensterNachKlick: fenster,
        gewaehltesSubjekt: gewaehlt?.kind ?? null,
        fluchtpunkt: zusammen(nachher),
    });
    pruefeFluchtpunkt(nachher, wo + " nach dem Klick");
    expect.soft(Math.abs(nachher.kamera.pitch - vorher.kamera.pitch), wo + ": Neigung").toBeLessThan(1e-3);
    expect.soft(Math.abs(nachher.kamera.bearing - vorher.kamera.bearing), wo + ": Drehung").toBeLessThan(1e-3);
    if (breite >= 1920)
        expect.soft(nachherStand.verdeckt, wo + ": das Objekt liegt nach dem Klick unter einem Panel").toBeNull();
}

for (const e of EDITOREN) {
    for (const [breite, hoehe] of BREITEN) {
        test(
            "(c1) " +
                e.name +
                ": Klick auf ein Objekt bei zugeklapptem Editor (" +
                String(breite) +
                " × " +
                String(hoehe) +
                ")",
            async ({ page }) => {
                test.setTimeout(180_000);
                await page.setViewportSize({ width: breite, height: hoehe });
                await klickAufObjekt(page, e, breite, false);
            },
        );
        test(
            "(c2) " +
                e.name +
                ": Klick auf ein Objekt neben dem angedockten Editor (" +
                String(breite) +
                " × " +
                String(hoehe) +
                ")",
            async ({ page }) => {
                test.setTimeout(180_000);
                await page.setViewportSize({ width: breite, height: hoehe });
                await klickAufObjekt(page, e, breite, true);
            },
        );
    }
}

// ---------------------------------------------------------------------------------------------------------------- (d)

/**
 * (d) Der einmalige Kamera-Hinweis steht ganz in der freien Fläche (Editor-Orchestrierung 2026-10-19, nach den Funden der Gebiete an
 * ortseditor.spec): Erst lag er auf `--z-map-hint` über dem Kopf des angedockten Fensters, dann unter dem Planer, und „Verstanden“ war
 * nicht zu drücken. Steht er da, ist „Verstanden“ oben, und weder Fensterkopf noch Planer liegen unter ihm. Passt er gerade nirgends ganz
 * hin, wartet er und kommt, sobald das Fenster zu ist.
 */
async function hinweisLage(
    page: Page,
): Promise<{ da: boolean; obenAuf: boolean; getroffen: string; ueberDeckendem: string[] }> {
    return page.evaluate(() => {
        const hinweis = document.querySelector<HTMLElement>('[data-testid="camera-hint"]');
        const knopf = document.querySelector<HTMLElement>('[data-testid="camera-hint-close"]');
        if (!hinweis || !knopf) return { da: false, obenAuf: false, getroffen: "", ueberDeckendem: [] };
        const k = knopf.getBoundingClientRect();
        const getroffen = document.elementFromPoint(k.left + k.width / 2, k.top + k.height / 2);
        const h = hinweis.getBoundingClientRect();
        const ueber = (el: Element | null, name: string): string[] => {
            if (!el) return [];
            const r = el.getBoundingClientRect();
            const schnitt = h.left < r.right && h.right > r.left && h.top < r.bottom && h.bottom > r.top;
            return schnitt ? [name] : [];
        };
        // Was statt des Knopfs getroffen wurde, mit Lage: für die Meldung, wenn er nicht obenauf liegt.
        const name = (el: Element | null): string => {
            if (!el) return "nichts";
            const r = el.getBoundingClientRect();
            const wer = el.getAttribute("data-testid") ?? `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`;
            return `${wer} [${String(Math.round(r.left))},${String(Math.round(r.top))} ${String(Math.round(r.width))}×${String(Math.round(r.height))}]`;
        };
        return {
            da: true,
            obenAuf: getroffen === knopf || knopf.contains(getroffen),
            getroffen: `${name(getroffen)} über Knopf ${name(knopf)}`,
            ueberDeckendem: [
                ...ueber(document.querySelector("#route-planner-panel"), "Planer"),
                ...ueber(document.querySelector('dialog[data-lage="angedockt"][open]'), "Fenster"),
            ],
        };
    });
}

for (const [breite, hoehe] of [
    [1280, 720],
    [1280, 800],
    [1920, 1080],
] as [number, number][]) {
    test(`(d) Kamera-Hinweis mit angedocktem Fenster: ganz in der freien Fläche oder wartend, danach zu drücken (${String(breite)} × ${String(hoehe)})`, async ({
        page,
    }) => {
        await page.setViewportSize({ width: breite, height: hoehe });
        await oeffneOrtseditor(page);
        const fenster = page.locator('dialog[data-lage="angedockt"][open]');
        await expect(fenster).toHaveCount(1);
        await ruhe(page);
        await page.waitForTimeout(400);
        const mitFenster = await hinweisLage(page);
        if (mitFenster.da) {
            expect(mitFenster.obenAuf, `„Verstanden“ liegt oben (getroffen: ${mitFenster.getroffen})`).toBe(true);
            expect(mitFenster.ueberDeckendem, "der Hinweis liegt über keinem Planer und keinem Fenster").toEqual([]);
        }
        // Kein Punkt des Fensterkopfs liegt unter dem Kamerabund.
        const unterDemBund = await fenster.locator(".avm-fenster__kopf").evaluate((kopf) => {
            const box = kopf.getBoundingClientRect();
            const stellen: number[] = [];
            for (let x = box.left + 4; x < box.right - 4; x += 16) {
                const oben = document.elementFromPoint(x, box.top + box.height / 2);
                if (oben?.closest(".corner--top")) stellen.push(Math.round(x));
            }
            return stellen;
        });
        expect(unterDemBund, "keine Stelle des Kopfs liegt unter Ring oder Hinweis").toEqual([]);
        // Nach dem Schließen des Fensters steht der Hinweis frei da und lässt sich schließen.
        await fenster.getByTestId("fenster-schliessen").click();
        await expect(fenster).toHaveCount(0);
        await expect(page.getByTestId("camera-hint")).toBeVisible();
        await page.waitForTimeout(400);
        const ohneFenster = await hinweisLage(page);
        expect(ohneFenster.obenAuf, "„Verstanden“ liegt oben").toBe(true);
        expect(ohneFenster.ueberDeckendem).toEqual([]);
        await page.getByTestId("camera-hint-close").click();
        await expect(page.getByTestId("camera-hint")).toHaveCount(0);
    });

    test(`(d) Kamera-Hinweis ohne Fenster: „Verstanden“ ist zu drücken (${String(breite)} × ${String(hoehe)})`, async ({
        page,
    }) => {
        await page.setViewportSize({ width: breite, height: hoehe });
        await stubAdmin(page, { capabilities: ["use_editor_menu"], role: "reviewer" });
        await openMap(page, EDITOR_MODE);
        await ruhe(page);
        await expect(page.getByTestId("camera-hint")).toBeVisible();
        const lage = await hinweisLage(page);
        expect(lage.obenAuf, "„Verstanden“ liegt oben").toBe(true);
        expect(lage.ueberDeckendem, "der Hinweis liegt über keinem Planer").toEqual([]);
        await page.getByTestId("camera-hint-close").click();
        await expect(page.getByTestId("camera-hint")).toHaveCount(0);
    });
}

/**
 * (d) Der Besucher auf dem kleinen Laptop (Fund der Gebiete 2026-10-19, Hauptorchestrierung: „muss vor der nächsten Freigabe nach
 * Production gerichtet sein“): Bei 1280 × 720 lag der Routenplaner über „Verstanden“; seit 5d62cdd23 liegt der Hinweis unter Fenstern und
 * Planer. Er steht jetzt in der freien Fläche neben dem offenen Planer und lässt sich wegklicken.
 */
test("🔴 (d) Besucher bei 1280 × 720 mit offenem Planer: „Verstanden“ liegt frei und schließt den Hinweis", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openMap(page);
    await expect(page.getByTestId("route-planner-tab")).toHaveAttribute("aria-expanded", "true");
    await ruhe(page);
    await expect(page.getByTestId("camera-hint")).toBeVisible();
    await page.waitForTimeout(400);
    const lage = await hinweisLage(page);
    expect(lage.obenAuf, `„Verstanden“ liegt oben (getroffen: ${lage.getroffen})`).toBe(true);
    expect(lage.ueberDeckendem, "der Hinweis liegt über keinem Planer").toEqual([]);
    await page.getByTestId("camera-hint-close").click();
    await expect(page.getByTestId("camera-hint")).toHaveCount(0);
});

/**
 * (d) … und nie vor einem offenen Menü (Befund der Koordination 2026-10-17 zu `0acaa659a`): Auf `--z-map-menu` lag der Bund mit dem
 * Hinweis über dem Menü der Kopfleiste, „Medien“ und „Abmelden“ waren nicht zu drücken (`medien.spec.ts` lief in den Timeout). Seit
 * 2026-10-19 hebt der Hinweis den Bund gar nicht mehr an.
 */
for (const [breite, hoehe] of [
    [1280, 720],
    [1920, 1080],
] as [number, number][]) {
    test(`(d) Hinweis offen, Kopfleistenmenü offen: die Einträge des Menüs sind zu drücken (${String(breite)} × ${String(hoehe)})`, async ({
        page,
    }) => {
        await page.setViewportSize({ width: breite, height: hoehe });
        // Ohne Panel rechts: Der Bund steht oben rechts unter dem Menü der Kopfleiste (wie in `medien.spec.ts`, gemessen 1280 px: Bund
        // x 862–1238, „Medien“ y 154–201).
        await stubAdmin(page, { capabilities: ["use_editor_menu"], role: "reviewer" });
        await openMap(page, EDITOR_MODE);
        const lasche = page.getByTestId("editor-panel-tab");
        if ((await lasche.getAttribute("aria-expanded")) === "true") await lasche.click();
        await expect(lasche).toHaveAttribute("aria-expanded", "false");
        await ruhe(page);
        await expect(page.getByTestId("camera-hint")).toBeVisible();
        await page.getByTestId("kopfleiste-menue").click();
        const eintraege = page.locator('[data-testid^="menue-"]');
        await expect(eintraege.first()).toBeVisible();
        const verdeckt = await eintraege.evaluateAll((elemente) =>
            elemente
                .filter((element) => element.getClientRects().length > 0)
                .flatMap((element) => {
                    const box = element.getBoundingClientRect();
                    const getroffen = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
                    return getroffen === element || element.contains(getroffen)
                        ? []
                        : [
                              `${element.getAttribute("data-testid") ?? "?"} unter ${getroffen?.closest("[data-testid]")?.getAttribute("data-testid") ?? "?"}`,
                          ];
                }),
        );
        expect(verdeckt, "kein Eintrag des Kopfleistenmenüs liegt unter dem Kamera-Hinweis").toEqual([]);
        // Und der Hinweis ist wieder zu sehen, sobald das Menü zu ist.
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("camera-hint-close")).toBeVisible();
    });
}

// ---------------------------------------------------------------------------------------------------------------- (e)

/**
 * (e) Die Listen der Flächen (WI-0218 Nachbesserung; Betreiber 2026-10-17 über die Orchestrierung: „was noch fehlt is die richtige zoomstufe
 * bei kleinen objekten auf zoom 4 is total winzig (und zu hoch für große regionen) … außerdem wird beim klick auf die liste die entsprechende
 * fläche nicht gelb“; auf der Stage: „wenn ich draufklick, sehe ich immer noch nicht die region ausgwählt (gelb markiert)“).
 */
const LANDSCHAFTEN_EDITOR = EDITOREN.find((e) => e.name === "Landschaften")!;
const GEBIETE_EDITOR = EDITOREN.find((e) => e.name === "Herrschaftsgebiete")!;

/** Was die Karte gerade gewählt zeigt und wo sie steht. */
async function auswahlUndKamera(page: Page) {
    return page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const auswahl = globalThis.avesmapsAreaSelection?.();
        const c = map.getCenter();
        return {
            auswahl: auswahl === undefined ? null : { kind: auswahl.kind, id: auswahl.id },
            gelb: map.getLayer("area-selection-fill")
                ? map.queryRenderedFeatures({ layers: ["area-selection-fill"] }).length
                : 0,
            kamera: { lng: c.lng, lat: c.lat, zoom: map.getZoom() },
            ansicht: /view=([a-z]+)/.exec(location.hash)?.[1] ?? null,
        };
    });
}

test("(e) Landschaften: ein Klick in der Liste markiert die Fläche gelb auf der Karte, Kamera und Ansicht bleiben (1920 × 1080)", async ({
    page,
}) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    echteZeilen = true;
    await LANDSCHAFTEN_EDITOR.lade(page);
    await stelleKamera(page, G, { zoom: 7, pitch: 45, bearing: 30 });
    await showLandscapes(page, "vegetation");
    await oeffne(page, LANDSCHAFTEN_EDITOR);
    const vorher = await auswahlUndKamera(page);
    const zeile = page
        .locator('[data-testid^="landschaftseditor-"][data-testid$="-liste"]')
        .getByRole("option", { name: /Echte Fläche/ })
        .first();
    await zeile.click();
    await ruhe(page);
    await expect.poll(async () => (await auswahlUndKamera(page)).auswahl?.kind, { timeout: 10_000 }).toBe("landscape");
    const nachher = await auswahlUndKamera(page);
    protokoll({ pruefung: "e", editor: "Landschaften", vorher, nachher });
    expect(nachher.gelb, "die Fläche leuchtet auf der Karte").toBeGreaterThan(0);
    expect(nachher.kamera, "die Kamera bleibt stehen").toEqual(vorher.kamera);
    expect(nachher.ansicht, "die Ansicht der Liste bleibt").toBe(vorher.ansicht);
});

test("(e) Herrschaftsgebiete: ein Klick in der Liste wählt das Gebiet auf der Karte, die Kamera bleibt (1920 × 1080)", async ({
    page,
}) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await GEBIETE_EDITOR.lade(page);
    await oeffne(page, GEBIETE_EDITOR);
    const vorher = await auswahlUndKamera(page);
    await GEBIETE_EDITOR.zeile(page).click();
    await ruhe(page);
    await expect
        .poll(async () => (await auswahlUndKamera(page)).auswahl, { timeout: 10_000 })
        .toEqual({
            kind: "territory",
            id: REICH,
        });
    const nachher = await auswahlUndKamera(page);
    expect(nachher.kamera, "die Kamera bleibt stehen").toEqual(vorher.kamera);
});

test("(e) Landschaften: der Doppelklick holt eine kleine Fläche groß in die freie Fläche, nicht auf Stufe 4 (1920 × 1080)", async ({
    page,
}) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await LANDSCHAFTEN_EDITOR.lade(page);
    await oeffne(page, LANDSCHAFTEN_EDITOR);
    await stelleKamera(page, FERNE, { zoom: 4, pitch: 0, bearing: 0 });
    await page
        .locator('[data-testid^="landschaftseditor-"][data-testid$="-liste"]')
        .getByRole("option", { name: /Kleiner Bergsee/ })
        .dblclick();
    await page.waitForFunction(() => globalThis.avesmapsMap!.getZoom() > 4.5, undefined, { timeout: 15_000 });
    await ruhe(page);
    const stand = await zielStand(page, { rahmen: [450, 515, 454, 519] });
    const zoom = await page.evaluate(() => globalThis.avesmapsMap!.getZoom());
    const breite = (await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const projektion = globalThis.avesmapsRenderProjection!;
        const a = map.project(projektion.toRenderLngLat({ x: 450, y: 515 }));
        const b = map.project(projektion.toRenderLngLat({ x: 454, y: 519 }));
        return Math.abs(b.x - a.x);
    })) as number;
    protokoll({ pruefung: "e", editor: "Landschaften", zoom, breite, luecke: stand.breiteLuecke });
    // Vorher deckelte Stufe 4 (MapLibre 5) den Zoom: 4 Einheiten waren 64 px breit, „total winzig“. Jetzt füllt der See die Lücke, so weit
    // die höchste Flugstufe reicht.
    expect(zoom, "näher als Stufe 4").toBeGreaterThan(6);
    expect(breite, "der See ist groß im Bild").toBeGreaterThan(stand.breiteLuecke * 0.25);
    expect(stand.untenPanel, "und liegt in der freien Fläche").toBe(false);
});
