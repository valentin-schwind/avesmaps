import { beforeEach, describe, expect, it, vi } from "vitest";
import { sessionViewer, type EditorTerritoryForm } from "@avesmaps3d/shared";
import { fuehreAus, handgriffZeilen } from "../src/editor-menu/action.ts";
import { gebietHandgriffe, gebietSubjekt, TEILE_GRIFF, type GebietLage } from "../src/editor-menu/handgriffe-gebiet.ts";
import { kartenAbschnitte } from "../src/editor-menu/kartenmenue.ts";
import {
    createGebietTeile,
    groesseText,
    groesseVon,
    leuchtendeWahl,
    ohneTeil,
    teileAus,
    teileUrl,
    wahlenAus,
} from "../src/gebietseditor/gebiet-teile.ts";
import { locale, t } from "../src/i18n/i18n.ts";
import { createGebietTeileLeuchten, teilAlsFeatures } from "../src/map/gebiet-teile-leuchten.ts";

/**
 * „Unterpolygone löschen …“ am Herrschaftsgebiet (OPS-000075; Melder: „Beim Editieren entstandene Unterpolygone wie z.B. außerhalb von Uhdenwald
 * sind nicht löschbar … rechtsklick … Unterpolygone löschen -> 1, 2, 3 … und markierst die betroffenen in dem augenblick rot“).
 *
 * Problemfälle: Die Liste zeigt die Hauptfläche löschbar oder lässt sich so bis auf den letzten Teil leeren; die Reihenfolge ist nicht „kleinster
 * zuerst, der Teil unter dem Rechtsklick vorn“; ein Teil leuchtet nicht, wenn man auf seine Zeile zeigt, oder der falsche; die Operation schickt
 * die ganze Fläche statt der Fläche ohne den Teil, mit der falschen Revision oder an das falsche Gebiet; das Menü bietet den Eintrag bei einer
 * Fläche mit einem Teil, ohne Recht oder im laufenden Modus an; in „Hier liegen N Flächen“ fehlt das Untermenü.
 */

const ID = (n: number): string => `75757575-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const WALD = ID(1);
const BARONIE = ID(3);
const FLAECHE = ID(0xa1);
const FLAECHE_B = ID(0xa3);

type Ring = [number, number][];
const quadrat = (x: number, y: number, kante: number): Ring => [
    [x, y],
    [x + kante, y],
    [x + kante, y + kante],
    [x, y + kante],
];
/** Hauptfläche 40 × 40 = 1600 mit einem Loch 10 × 10 (Größe 1500), ein Splitter 0,02 × 0,02 und ein kleiner Teil 2 × 2 (Größe 4). */
const HAUPT: Ring[] = [quadrat(300, 300, 40), quadrat(310, 310, 10)];
const SPLITTER: Ring[] = [quadrat(500, 500, 0.02)];
const KLEIN: Ring[] = [quadrat(600, 600, 2)];

function form(overrides: Partial<EditorTerritoryForm> = {}): EditorTerritoryForm {
    return {
        id: WALD,
        name: "Uhdenwald",
        parents: [],
        margin: 15,
        areas: [{ id: FLAECHE, revision: 7, polygons: [HAUPT, SPLITTER, KLEIN] }],
        neighbors: [],
        edges: [],
        ...overrides,
    };
}

beforeEach(() => {
    locale.value = "de";
});

describe("Die Teile einer Fläche", () => {
    it("🔴 Größe: außen minus Löcher, unabhängig von der Umlaufrichtung", () => {
        expect(groesseVon(HAUPT)).toBe(1500);
        expect(groesseVon([quadrat(0, 0, 2).reverse()])).toBe(4);
        expect(groesseVon(SPLITTER)).toBeCloseTo(0.0004, 10);
    });

    it("🔴 kleinster zuerst; der größte Teil ist die Hauptfläche; die Zahl der Teile stimmt", () => {
        const stand = teileAus(form())!;
        expect(stand.teile.map((teil) => [teil.index, teil.haupt])).toEqual([
            [1, false],
            [2, false],
            [0, true],
        ]);
        expect(stand.teile.map((teil) => teil.wahl)).toEqual([`${FLAECHE}:1`, `${FLAECHE}:2`, `${FLAECHE}:0`]);
        expect(stand.vorgewaehlt).toBeUndefined();
        expect(stand.gebiet).toBe(WALD);
        expect(stand.name).toBe("Uhdenwald");
    });

    it("🔴 liegt der Rechtsklick auf einem kleinen Teil, steht dieser vorn und ist vorgewählt", () => {
        const stand = teileAus(form(), { x: 601, y: 600.5 })!;
        expect(stand.vorgewaehlt).toBe(`${FLAECHE}:2`);
        expect(stand.teile.map((teil) => teil.index)).toEqual([2, 1, 0]);
    });

    it("🔴 auf der Hauptfläche (auch im Loch) oder daneben wird nichts vorgewählt: Sie ist nicht löschbar", () => {
        for (const punkt of [
            { x: 305, y: 305 },
            { x: 315, y: 315 },
            { x: 0, y: 0 },
        ]) {
            const stand = teileAus(form(), punkt)!;
            expect(stand.vorgewaehlt).toBeUndefined();
            expect(stand.teile.map((teil) => teil.index)).toEqual([1, 2, 0]);
        }
    });

    it("🔴 eine Fläche mit nur einem Teil trägt nichts bei; ohne Fläche mit mehreren Teilen gibt es nichts zu löschen", () => {
        expect(teileAus(form({ areas: [{ id: FLAECHE, revision: 1, polygons: [HAUPT] }] }))).toBeUndefined();
        expect(teileAus(form({ areas: [] }))).toBeUndefined();
        // Zwei Flächen, nur eine mit mehreren Teilen: Die Liste nennt nur deren Teile; beide Revisionen bleiben für das Schreiben gemerkt.
        const stand = teileAus(
            form({
                areas: [
                    { id: FLAECHE_B, revision: 2, polygons: [HAUPT] },
                    { id: FLAECHE, revision: 7, polygons: [HAUPT, KLEIN] },
                ],
            }),
        )!;
        expect(stand.teile.map((teil) => teil.flaeche)).toEqual([FLAECHE, FLAECHE]);
        expect(stand.flaechen.get(FLAECHE_B)?.revision).toBe(2);
    });

    it("🔴 je Fläche bleibt ihr größter Teil: Bei zwei Flächen ist es je einer", () => {
        const stand = teileAus(
            form({
                areas: [
                    { id: FLAECHE, revision: 7, polygons: [KLEIN, HAUPT] },
                    { id: FLAECHE_B, revision: 2, polygons: [SPLITTER, KLEIN] },
                ],
            }),
        )!;
        expect(stand.teile.filter((teil) => teil.haupt).map((teil) => [teil.flaeche, teil.index])).toEqual([
            [FLAECHE_B, 1],
            [FLAECHE, 1],
        ]);
    });
});

describe("Die Zeilen des Untermenüs", () => {
    it("🔴 „Teil n“ mit der Größe; die Hauptfläche grau mit Grund und ohne Vorschau, alle anderen mit Vorschau", () => {
        const wahlen = wahlenAus(teileAus(form())!);
        expect(wahlen).toEqual([
            { id: `${FLAECHE}:1`, text: "Teil 1", hinweis: "0,0004", vorschau: true },
            { id: `${FLAECHE}:2`, text: "Teil 2", hinweis: "4", vorschau: true },
            {
                id: `${FLAECHE}:0`,
                text: "Teil 3",
                hinweis: "1.500 · Hauptfläche",
                grund: "gebietseditor.unterpolygone.hauptGrund",
            },
        ]);
    });

    it("die Größe in der Sprache der Seite, mit genug Stellen für Splitter", () => {
        expect(groesseText(0.0005)).toBe("0,0005");
        expect(groesseText(0.000123)).toBe("0,00012");
        expect(groesseText(3.14159)).toBe("3,14");
        expect(groesseText(158.8)).toBe("158,8");
        expect(groesseText(12345.6)).toBe("12.346");
        expect(groesseText(0)).toBe("0");
    });

    it("🔴 die Nummern zählen die Liste, auch wenn der vorgewählte Teil vorn steht", () => {
        const wahlen = wahlenAus(teileAus(form(), { x: 601, y: 600.5 })!);
        expect(wahlen.map((wahl) => [wahl.text, wahl.id])).toEqual([
            ["Teil 1", `${FLAECHE}:2`],
            ["Teil 2", `${FLAECHE}:1`],
            ["Teil 3", `${FLAECHE}:0`],
        ]);
    });
});

describe("Die Fläche ohne den Teil", () => {
    it("🔴 ein kleiner Teil geht, die übrigen bleiben mit ihrer Reihenfolge und ihren Löchern", () => {
        const ziel = ohneTeil(teileAus(form())!, `${FLAECHE}:1`)!;
        expect(ziel).toMatchObject({ flaeche: FLAECHE, revision: 7 });
        expect(ziel.rest).toEqual([HAUPT, KLEIN]);
    });

    it("🔴 die Hauptfläche, ein unbekannter Teil und der letzte Teil einer Fläche lassen sich nicht entfernen", () => {
        const stand = teileAus(form())!;
        expect(ohneTeil(stand, `${FLAECHE}:0`)).toBeUndefined();
        expect(ohneTeil(stand, `${FLAECHE}:9`)).toBeUndefined();
        expect(ohneTeil(stand, "gibt-es-nicht")).toBeUndefined();
        // Zwei gleich große Teile: Der vordere ist die Hauptfläche, der andere geht.
        const gleich = teileAus(form({ areas: [{ id: FLAECHE, revision: 1, polygons: [KLEIN, KLEIN] }] }))!;
        expect(gleich.teile.map((teil) => teil.haupt)).toEqual([true, false]);
        expect(ohneTeil(gleich, `${FLAECHE}:1`)?.rest).toEqual([KLEIN]);
        // Verteidigung: Bestünde die Fläche nur aus dem einen Polygon, das gelöscht werden soll, bliebe nichts - das schreibt keiner (der Server verlangt ein Polygon).
        const eines = {
            ...gleich,
            teile: [{ ...gleich.teile[1]!, index: 0 }],
            flaechen: new Map([[FLAECHE, { revision: 1, polygons: [KLEIN] }]]),
        };
        expect(ohneTeil(eines, eines.teile[0]!.wahl)).toBeUndefined();
    });
});

describe("Lesen und Löschen über den Server", () => {
    const antwort = (body: unknown, status = 200): Response =>
        new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const quittung = {
        operationId: ID(0x10),
        status: "applied",
        affected: [],
        derivedWork: [{ kind: "territory_derive", jobId: "job-7" }],
        warnings: [],
        mapRevision: 12,
    };

    it("🔴 der Lesepfad ist der schlanke der Form, mit Klickpunkt", async () => {
        expect(teileUrl(WALD, { x: 12.5, y: 7 })).toBe(`/api/editor/territories/${WALD}/form?x=12.5&y=7&nur=flaechen`);
        expect(teileUrl(WALD, undefined)).toBe(`/api/editor/territories/${WALD}/form?nur=flaechen`);
        const urls: string[] = [];
        const abruf = vi.fn((url: string | URL | Request) => {
            urls.push(String(url));
            return Promise.resolve(antwort(form()));
        });
        const dienst = createGebietTeile(abruf as unknown as typeof fetch);
        expect(dienst.wahlen(WALD)).toEqual([]);
        await dienst.bereit([WALD], { x: 601, y: 600.5 });
        expect(abruf).toHaveBeenCalledTimes(1);
        expect(urls[0]).toBe(`/api/editor/territories/${WALD}/form?x=601&y=600.5&nur=flaechen`);
        expect(dienst.wahlen(WALD).map((wahl) => wahl.text)).toEqual(["Teil 1", "Teil 2", "Teil 3"]);
        // Dieselbe Stelle noch einmal: nicht noch einmal lesen; eine andere Stelle: neu.
        await dienst.bereit([WALD], { x: 601, y: 600.5 });
        expect(abruf).toHaveBeenCalledTimes(1);
        await dienst.bereit([WALD], { x: 305, y: 305 });
        expect(abruf).toHaveBeenCalledTimes(2);
        dienst.vergiss();
        expect(dienst.wahlen(WALD)).toEqual([]);
    });

    it("🔴 ein Fehler beim Lesen (kein Recht, kein Netz) ergibt keine Zeilen, keine Meldung und kein Aufhängen", async () => {
        const dienst = createGebietTeile((() =>
            Promise.resolve(antwort({ error: { code: "forbidden", message: "x" } }, 403))) as typeof fetch);
        await dienst.bereit([WALD], undefined);
        expect(dienst.wahlen(WALD)).toEqual([]);
        const offline = createGebietTeile((() => Promise.reject(new TypeError("offline"))) as typeof fetch);
        await offline.bereit([WALD], undefined);
        expect(offline.wahlen(WALD)).toEqual([]);
    });

    it("🔴 der Umriss zur Zeile; ohne Zeile der vorgewählte Teil", async () => {
        const dienst = createGebietTeile((() => Promise.resolve(antwort(form()))) as typeof fetch);
        await dienst.bereit([WALD], { x: 601, y: 600.5 });
        expect(dienst.umriss(WALD, `${FLAECHE}:1`)).toEqual(SPLITTER);
        expect(dienst.umriss(WALD, undefined)).toEqual(KLEIN);
        expect(dienst.umriss(WALD, "gibt-es-nicht")).toBeUndefined();
        await dienst.bereit([BARONIE], undefined);
        expect(dienst.umriss(BARONIE, undefined)).toBeUndefined();
    });

    it("🔴 Löschen schickt EINE Operation an das Gebiet, dem die Fläche gehört: die Fläche ohne den Teil, gegen die gelesene Revision", async () => {
        const abrufe: { url: string; methode: string | undefined; body: unknown }[] = [];
        const abruf = vi.fn((url: string | URL | Request, init?: RequestInit) => {
            abrufe.push({
                url: String(url),
                methode: init?.method,
                body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
            });
            return Promise.resolve(init?.method === "PATCH" ? antwort(quittung) : antwort(form({ id: BARONIE })));
        });
        const dienst = createGebietTeile(abruf as unknown as typeof fetch);
        // Gefragt wird am abgeleiteten Gebiet; die Flächen gehören der Baronie darunter.
        await dienst.bereit([WALD], { x: 500, y: 500 });
        const ergebnis = await dienst.loesche(WALD, `${FLAECHE}:1`);
        const patch = abrufe.at(-1)!;
        expect(patch.url).toBe(`/api/editor/territories/${BARONIE}`);
        expect(patch.methode).toBe("PATCH");
        expect(patch.body).toEqual({
            operationId: expect.any(String) as string,
            areas: [{ id: FLAECHE, baseRevision: 7, polygons: [HAUPT, KLEIN] }],
        });
        expect(ergebnis).toMatchObject({ ok: true, name: "Uhdenwald" });
        if (!ergebnis.ok) throw new Error("erwartet: ok");
        // Die Karte zeigt die geschriebene Fläche, bis die Ableitung sie zeichnet.
        expect(ergebnis.flaeche).toEqual({ flaeche: FLAECHE, gebiet: BARONIE, polygone: [HAUPT, KLEIN], job: "job-7" });
        // Nach dem Schreiben ist das Gelesene alt.
        expect(dienst.wahlen(WALD)).toEqual([]);
    });

    it("🔴 der Satz des Servers kommt zurück (veraltete Revision 409); die Hauptfläche und Unbekanntes gehen gar nicht erst hin", async () => {
        const abruf = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
            Promise.resolve(
                init?.method === "PATCH"
                    ? antwort(
                          { error: { code: "edit_conflict", message: "Die Fläche wurde inzwischen geändert." } },
                          409,
                      )
                    : antwort(form()),
            ),
        );
        const dienst = createGebietTeile(abruf as unknown as typeof fetch);
        await dienst.bereit([WALD], undefined);
        expect(await dienst.loesche(WALD, `${FLAECHE}:1`)).toEqual({
            ok: false,
            satz: "Die Fläche wurde inzwischen geändert.",
        });
        await dienst.bereit([WALD], undefined);
        const patches = (): number => abruf.mock.calls.filter(([, init]) => init?.method === "PATCH").length;
        const vorher = patches();
        const haupt = await dienst.loesche(WALD, `${FLAECHE}:0`);
        expect(haupt).toEqual({ ok: false, satz: t("gebietseditor.unterpolygone.veraltet") });
        expect(await dienst.loesche(ID(99), "x:1")).toEqual({
            ok: false,
            satz: t("gebietseditor.unterpolygone.veraltet"),
        });
        expect(patches()).toBe(vorher);
    });
});

describe("Welcher Teil leuchtet", () => {
    it("🔴 aus dem, was das Kartenmenü meldet: der offene Eintrag und die gezeigte Zeile", () => {
        // Ein Gebiet unter dem Rechtsklick: kein Gebiet vor dem Handgriff.
        expect(leuchtendeWahl(TEILE_GRIFF, `${TEILE_GRIFF}#${FLAECHE}:1`, WALD)).toEqual({
            gebiet: WALD,
            wahl: `${FLAECHE}:1`,
        });
        // Ohne gezeigte Zeile: der vorgewählte (die Wahl bleibt offen, `umriss` nimmt ihn).
        expect(leuchtendeWahl(TEILE_GRIFF, undefined, WALD)).toEqual({ gebiet: WALD, wahl: undefined });
        // „Hier liegen N Flächen“: das Gebiet steht vor dem Handgriff.
        expect(
            leuchtendeWahl(`${BARONIE}|${TEILE_GRIFF}`, `${BARONIE}|${TEILE_GRIFF}#${FLAECHE}:2`, undefined),
        ).toEqual({
            gebiet: BARONIE,
            wahl: `${FLAECHE}:2`,
        });
        // Ein anderes Untermenü, zu oder kein Gebiet bekannt: nichts.
        expect(leuchtendeWahl("gebiet-gebietsform", undefined, WALD)).toBeUndefined();
        expect(leuchtendeWahl(`gebiet-${WALD}`, undefined, WALD)).toBeUndefined();
        expect(leuchtendeWahl(undefined, undefined, WALD)).toBeUndefined();
        expect(leuchtendeWahl(TEILE_GRIFF, undefined, undefined)).toBeUndefined();
    });
});

describe("Der Eintrag im Register und im Kartenmenü", () => {
    const ALLE = [
        "use_editor_menu",
        "edit_map_objects",
        "edit_map_geometry",
        "edit_territories",
        "edit_landscapes",
        "edit_territory_form",
        "edit_landscape_form",
        "edit_mountains",
    ];
    const GEBIET = gebietSubjekt({ id: WALD }, "Uhdenwald", "Wald");
    const ANDERES = gebietSubjekt({ id: BARONIE }, "Baronie Lückenhof", "Baronie");
    const lage =
        (rechte: string[], laeuft = false, mapEditing = "testwelt"): (() => GebietLage) =>
        () => ({ rechte, bearbeiten: { mapEditing } as never, laeuft });
    const viewer = (rechte: string[]) => sessionViewer("test", rechte);
    const uebersetze = (key: string, params?: Record<string, string>): string =>
        `«${key}»${params === undefined ? "" : JSON.stringify(params)}`;
    /** Zwei Gebiete: das erste hat die Teile von `form()`, das zweite hat nur eine Fläche. */
    const wirkung = (teile: Record<string, ReturnType<typeof wahlenAus>> = {}) => ({
        oeffnen: vi.fn(),
        gebietsform: vi.fn(),
        teile: vi.fn((id: string) => teile[id] ?? []),
        teilLoeschen: vi.fn(),
    });
    const wahlen = wahlenAus(teileAus(form(), { x: 601, y: 600.5 })!);

    it("🔴 ohne Teile steht der Eintrag nicht da, in keiner Stelle; mit Teilen nur im Kartenmenü, rot und zuletzt", () => {
        const ohne = gebietHandgriffe(lage(ALLE), wirkung());
        expect(handgriffZeilen(ohne, GEBIET, "karte").map((zeile) => zeile.id)).toEqual([
            "gebiet-bearbeiten",
            "gebiet-gebietsform",
        ]);
        const mit = gebietHandgriffe(lage(ALLE), wirkung({ [WALD]: wahlen }));
        const zeilen = handgriffZeilen(mit, GEBIET, "karte");
        expect(zeilen.map((zeile) => zeile.id)).toEqual(["gebiet-bearbeiten", "gebiet-gebietsform", TEILE_GRIFF]);
        expect(zeilen[2]).toMatchObject({
            text: "gebietseditor.griff.unterpolygone",
            zeichen: "loeschen",
            gefahr: true,
            grund: undefined,
        });
        expect(zeilen[2]!.auswahl?.map((wahl) => wahl.text)).toEqual(["Teil 1", "Teil 2", "Teil 3"]);
        // Weder im Infopanel noch am Objekt (Linksklick): gemeint ist die Fläche unter dem Zeiger.
        expect(handgriffZeilen(mit, GEBIET, "infopanel").map((zeile) => zeile.id)).not.toContain(TEILE_GRIFF);
        // Am anderen Gebiet ohne Teile fehlt er.
        expect(handgriffZeilen(mit, ANDERES, "karte").map((zeile) => zeile.id)).not.toContain(TEILE_GRIFF);
    });

    it("🔴 gesperrt ohne eines der beiden Rechte, im laufenden Modus (dann fehlt die Zeile) und bei ausgeschaltetem Bearbeiten", () => {
        const w = wirkung({ [WALD]: wahlen });
        const grund = (l: () => GebietLage) =>
            handgriffZeilen(gebietHandgriffe(l, w), GEBIET, "karte").find((zeile) => zeile.id === TEILE_GRIFF)?.grund;
        expect(grund(lage(ALLE))).toBeUndefined();
        expect(
            grund(
                lage([
                    "use_editor_menu",
                    "edit_map_geometry",
                    "edit_territory_form",
                    "edit_landscape_form",
                    "edit_mountains",
                ]),
            ),
        ).toBe("ortseditor.handgriff.grund.recht");
        expect(grund(lage(["use_editor_menu", "edit_map_objects", "edit_territories", "edit_landscapes"]))).toBe(
            "sonderrollen.grund.gebiet",
        );
        expect(grund(lage(ALLE, false, "aus"))).toBe("ortseditor.handgriff.grund.aus");
        expect(
            handgriffZeilen(gebietHandgriffe(lage(ALLE, true), w), GEBIET, "karte").map((zeile) => zeile.id),
        ).not.toContain(TEILE_GRIFF);
    });

    it("🔴 die Wahl löscht genau diesen Teil dieses Gebiets; die Hauptfläche, eine unbekannte Wahl und ein gesperrter Betrachter nicht", () => {
        const w = wirkung({ [WALD]: wahlen });
        const griffe = gebietHandgriffe(lage(ALLE), w);
        expect(fuehreAus(griffe, `${TEILE_GRIFF}#${FLAECHE}:1`, GEBIET, viewer(ALLE))).toBe(true);
        expect(w.teilLoeschen).toHaveBeenCalledWith(WALD, `${FLAECHE}:1`);
        // Die Hauptfläche hat einen Grund: Sie läuft nie, auch nicht über die Kennung.
        expect(fuehreAus(griffe, `${TEILE_GRIFF}#${FLAECHE}:0`, GEBIET, viewer(ALLE))).toBe(false);
        // Ohne Wahl und mit einer, die das Untermenü nicht nennt: nichts.
        expect(fuehreAus(griffe, TEILE_GRIFF, GEBIET, viewer(ALLE))).toBe(false);
        expect(fuehreAus(griffe, `${TEILE_GRIFF}#${FLAECHE}:9`, GEBIET, viewer(ALLE))).toBe(false);
        expect(
            fuehreAus(
                gebietHandgriffe(
                    lage([
                        "use_editor_menu",
                        "edit_map_geometry",
                        "edit_territory_form",
                        "edit_landscape_form",
                        "edit_mountains",
                    ]),
                    w,
                ),
                `${TEILE_GRIFF}#${FLAECHE}:1`,
                GEBIET,
                viewer(ALLE),
            ),
        ).toBe(false);
        expect(w.teilLoeschen).toHaveBeenCalledTimes(1);
    });

    it("🔴 ein Gebiet unter dem Rechtsklick: „Unterpolygone löschen …“ mit den Zeilen 1, 2, 3; die Hauptfläche grau, nur die übrigen zeigen auf der Karte", () => {
        const abschnitte = kartenAbschnitte({
            actions: gebietHandgriffe(lage(ALLE), wirkung({ [WALD]: wahlen })),
            subject: undefined,
            liste: { id: "flaechen", titel: "areaChoice.count", gegenstaende: [GEBIET] },
            anlegen: [],
            uebersetze,
        });
        const eintrag = abschnitte[0]?.eintraege.find((x) => x.id === TEILE_GRIFF);
        expect(eintrag).toMatchObject({
            text: "«gebietseditor.griff.unterpolygone»",
            zeichen: "loeschen",
            gefahr: true,
        });
        expect(
            eintrag?.unter?.map((zeile) => [zeile.id, zeile.text, zeile.hinweis, zeile.vorschau, zeile.grund]),
        ).toEqual([
            [`${TEILE_GRIFF}#${FLAECHE}:2`, "Teil 1", "4", true, undefined],
            [`${TEILE_GRIFF}#${FLAECHE}:1`, "Teil 2", "0,0004", true, undefined],
            [
                `${TEILE_GRIFF}#${FLAECHE}:0`,
                "Teil 3",
                "1.500 · Hauptfläche",
                false,
                "«gebietseditor.unterpolygone.hauptGrund»",
            ],
        ]);
    });

    it("🔴 zwei Gebiete unter dem Rechtsklick: Das Untermenü steht auch in „Hier liegen N Flächen“, die Kennung nennt das Gebiet", () => {
        const abschnitte = kartenAbschnitte({
            actions: gebietHandgriffe(lage(ALLE), wirkung({ [WALD]: wahlen })),
            subject: undefined,
            liste: { id: "flaechen", titel: "areaChoice.count", gegenstaende: [ANDERES, GEBIET] },
            anlegen: [],
            uebersetze,
        });
        const eintraege = abschnitte[0]?.eintraege ?? [];
        // Die Baronie hat keine Teile: kein Eintrag. Das Gebiet hat ihn mit Untermenü.
        const baronie = eintraege[0]?.unter ?? [];
        expect(baronie.map((x) => x.id)).not.toContain(`${BARONIE}|${TEILE_GRIFF}`);
        const wald = eintraege[1]?.unter?.find((x) => x.id === `${WALD}|${TEILE_GRIFF}`);
        expect(wald?.unter?.map((zeile) => zeile.id)).toEqual([
            `${WALD}|${TEILE_GRIFF}#${FLAECHE}:2`,
            `${WALD}|${TEILE_GRIFF}#${FLAECHE}:1`,
            `${WALD}|${TEILE_GRIFF}#${FLAECHE}:0`,
        ]);
    });
});

describe("Das rote Leuchten", () => {
    it("🔴 das Polygon als geschlossene Ringe in Renderkoordinaten, außen zuerst, dann die Löcher; ohne Teil nichts", () => {
        const daten = teilAlsFeatures(HAUPT);
        expect(daten.features).toHaveLength(1);
        const ringe = daten.features[0]!.geometry.coordinates;
        expect(ringe).toHaveLength(2);
        for (const ring of ringe) {
            expect(ring).toHaveLength(5);
            expect(ring[0]).toEqual(ring[4]);
        }
        expect(teilAlsFeatures(undefined).features).toEqual([]);
        expect(teilAlsFeatures([]).features).toEqual([]);
    });

    it("🔴 Zeigen legt Quelle und drei Ebenen an, ein anderer Teil tauscht nur die Daten, Wegnehmen räumt alles ab", () => {
        const quellen = new Map<string, { setData: (daten: unknown) => void }>();
        const ebenen = new Map<string, unknown>();
        const setData = vi.fn();
        const karte = {
            getSource: (id: string) => quellen.get(id),
            addSource: vi.fn((id: string) => quellen.set(id, { setData })),
            removeSource: vi.fn((id: string) => quellen.delete(id)),
            getLayer: (id: string) => ebenen.get(id),
            addLayer: vi.fn((ebene: { id: string }) => ebenen.set(ebene.id, ebene)),
            removeLayer: vi.fn((id: string) => ebenen.delete(id)),
        };
        const leuchten = createGebietTeileLeuchten(() => karte as never);
        leuchten.zeige(SPLITTER);
        expect(karte.addSource).toHaveBeenCalledTimes(1);
        expect([...ebenen.keys()].sort()).toEqual([
            "gebiet-teile-fuellung",
            "gebiet-teile-kontur",
            "gebiet-teile-saum",
        ]);
        // Die Füllung und die Kontur sind Signalrot (`editEdge`), der Saum weiß: kein Farbwert im Bauteil.
        const kontur = ebenen.get("gebiet-teile-kontur") as { paint: Record<string, unknown> };
        expect(kontur.paint["line-color"]).toBe("#ee1c25");
        leuchten.zeige(KLEIN);
        expect(karte.addSource).toHaveBeenCalledTimes(1);
        expect(setData).toHaveBeenCalledTimes(1);
        expect(karte.addLayer).toHaveBeenCalledTimes(3);
        leuchten.zeige(undefined);
        expect(ebenen.size).toBe(0);
        expect(quellen.size).toBe(0);
        // Ohne Karte tut es nichts.
        expect(() => createGebietTeileLeuchten(() => undefined).zeige(SPLITTER)).not.toThrow();
    });
});
