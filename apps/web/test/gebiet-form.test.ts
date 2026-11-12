import { describe, expect, it, vi } from "vitest";
import type { EditorTerritoryDetail, EditorTerritoryForm, TerritoryUpdateBody } from "@avesmaps3d/shared";
import { createBearbeitung } from "../src/fenster/bearbeitung.ts";
import type { Entwurf } from "../src/fenster/entwurf-kern.ts";
import { createGebietArt } from "../src/gebietseditor/gebiet-art.ts";
import { createGebietsform, startAus, type GebietsformOptionen } from "../src/gebietseditor/gebietsform.ts";
import type { FormStand } from "../src/map/geometrie/formentwurf.ts";
import { operationAus } from "../src/map/geometrie/formoperation.ts";
import { aufGemeinsamerKante, mitPunkt, ohnePunkt, ohneTeil, stellenAn } from "../src/map/geometrie/rechnung.ts";
import type { Aufbau } from "../src/map/geometrie/formoperation.ts";
import { FLAECHE, GEBIET } from "../src/map/geometrie/arten.ts";
import type { Teil } from "../src/map/geometrie/geometrie.ts";
import type { GeometrieEingabe, GeometrieModus } from "../src/map/geometrie/modus.ts";

/**
 * Die Art „Herrschaftsgebiet“ im Geometrie-Modul und „Gebietsform bearbeiten“ als Quelle des Formentwurfs (WI-0209 C1, B2; EDIT-0005 §9
 * „C1“). Problemfälle: Die Vorschau rundet, obwohl die Karte Gebiete eckig zeichnet; die eigene Teilfläche ist ein Ziel; eine Ecke lässt
 * sich unter drei löschen; Strg löst nicht; „Fertig“ der Bearbeitung schreibt die Grenze nicht mit oder gegen falsche Revisionen.
 */
const RING: Teil = {
    objekt: "f-1",
    name: "Baronie",
    nr: 0,
    art: "ring",
    punkte: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
    ],
    revision: 1,
};
const stelle = { objekt: "f-1", nr: 0, index: 1 };

describe("Art Herrschaftsgebiet", () => {
    it("🔴 eckig: die Vorschau sind genau die Ecken, ohne den dünnen Umriss daneben", () => {
        const geschlossen = [...RING.punkte, RING.punkte[0]!];
        expect(GEBIET.rundung(geschlossen)).toEqual(geschlossen);
        expect(GEBIET.eckenZeigen).toBe(false);
        expect(FLAECHE.rundung(geschlossen)).not.toEqual(geschlossen);
    });

    it("🔴 sonst wie die Fläche: Ringe, Ecke und Kante als Ziel, nie die eigene Teilfläche, drei Ecken bleiben, Strg löst", () => {
        expect(GEBIET.teilart).toBe("ring");
        expect(GEBIET.ziele(stelle, RING)).toEqual(["ecke", "kante"]);
        expect(GEBIET.zielErlaubt({ art: "ecke", at: { x: 0, y: 0 }, objekt: "f-1", name: "" }, stelle, RING)).toBe(
            false,
        );
        expect(GEBIET.zielErlaubt({ art: "ecke", at: { x: 0, y: 0 }, objekt: "f-2", name: "" }, stelle, RING)).toBe(
            true,
        );
        expect(GEBIET.loeschbar(stelle, RING)).toBe(true);
        expect(GEBIET.loeschbar(stelle, { ...RING, punkte: RING.punkte.slice(0, 3) })).toBe(false);
        expect(GEBIET.mitziehen).toBe(true);
        expect(GEBIET.loesen).toBeUndefined();
    });
});

const GID = (n: number): string => `c1c1c1c1-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const quadrat = (x: number): [number, number][][][] => [
    [
        [
            [x, 400],
            [x + 10, 400],
            [x + 10, 410],
            [x, 410],
        ],
    ],
];
const FORM: EditorTerritoryForm = {
    id: GID(1),
    name: "Baronie Firnholz",
    requested: { id: GID(9), name: "Kaiserreich" },
    parents: [
        { id: GID(2), name: "Gratenfels" },
        { id: GID(9), name: "Kaiserreich" },
    ],
    margin: 15,
    areas: [{ id: GID(0x101), revision: 3, polygons: quadrat(400) }],
    neighbors: [
        { id: GID(0x102), territory: GID(3), name: "Baronie Ost", revision: 5, polygons: quadrat(410) },
        { id: GID(0x103), territory: GID(3), name: "Baronie Ost", revision: 6, polygons: quadrat(420) },
    ],
    edges: [{ areaId: GID(0x104), name: "Baronie Süd", a: [390, 390], b: [395, 390] }],
};

describe("Gebietsform: der Start aus dem Lesepfad", () => {
    it("🔴 Nachbarn je Gebiet (so werden sie gesperrt), Ziele mit Stelle nur an freien Nachbarn, „darunter“ am abgeleiteten Gebiet", () => {
        const start = startAus(FORM);
        expect(start).toMatchObject({ sperrId: GID(1), name: "Baronie Firnholz" });
        expect(start.teile.map((t) => [t.objekt, t.revision])).toEqual([[GID(0x101), 3]]);
        expect(start.nachbarn.map((n) => [n.sperrId, n.teile.length])).toEqual([[GID(3), 2]]);
        expect(start.hinweis).toEqual({ art: "darunter", name: "Baronie Firnholz", von: "Kaiserreich" });
        const frei = start.ziele(start.nachbarn[0]!.teile, []);
        expect(frei.filter((z) => z.objekt === GID(0x102)).every((z) => z.stelle !== undefined)).toBe(true);
        expect(frei.filter((z) => z.objekt === GID(0x104)).map((z) => z.art)).toEqual(["ecke", "ecke", "kante"]);
        const gehalten = start.ziele([], start.nachbarn[0]!.teile);
        expect(gehalten.filter((z) => z.objekt === GID(0x102)).every((z) => z.stelle === undefined)).toBe(true);
        const { requested, ...selbst } = FORM;
        expect(requested).toBeDefined();
        expect(startAus(selbst).hinweis).toBeUndefined();
    });
});

describe("Gebietsform: die Steuerung", () => {
    function aufbau(extra: Partial<GebietsformOptionen> = {}) {
        let eingabe: GeometrieEingabe | undefined;
        const modus: GeometrieModus = {
            aktualisiere: vi.fn(),
            markiere: vi.fn(),
            sperre: vi.fn(),
            abbrechen: vi.fn(() => false),
            aus: vi.fn(),
        };
        const daten = { form: vi.fn(async () => FORM) };
        const sperre = {
            nimm: vi.fn(async () => ({ art: "genommen", sperre: {} })),
            gib: vi.fn(),
            liste: vi.fn(async () => []),
            beiVerlust: vi.fn(() => () => undefined),
        } as unknown as GebietsformOptionen["sperre"];
        const form = createGebietsform({
            daten,
            sperre,
            fangradius: () => 12,
            karte: {
                ein: (e) => {
                    eingabe = e;
                    return modus;
                },
                zeige: vi.fn(),
                geaendert: vi.fn(),
            },
            ...extra,
        });
        return { form, daten, sperre, eingabe: () => eingabe! };
    }

    it("🔴 Start mit dem schon gelesenen Stand (die Baronie unter dem Klickpunkt): kein zweites Lesen, gesperrt wird das bearbeitete Gebiet", async () => {
        const { form, daten, sperre, eingabe } = aufbau();
        await form.starteMit(GID(1), FORM);
        expect(daten.form).not.toHaveBeenCalled();
        expect(sperre.nimm).toHaveBeenCalledWith({ kind: "territory", id: GID(1) }, "form");
        expect(sperre.liste).toHaveBeenCalledWith("territory");
        expect(form.laufend.value).toMatchObject({ name: "Baronie Firnholz", phase: "bereit" });
        expect(form.obergebiete.value).toEqual(["Gratenfels", "Kaiserreich"]);
        expect(form.meldung.value).toEqual({ art: "darunter", name: "Baronie Firnholz", von: "Kaiserreich" });
        expect(eingabe().art).toBe(GEBIET);
        // Einen eigenen Schreibweg hat die Form nicht mehr (B2 Teil 2): „Fertig“ ist die Bearbeitung.
        expect(form.schreibbar).toBe(false);
    });

    /** Die erste Ecke von 400,400 auf 411,400, die gemeinsame Ecke des Nachbarn zieht mit. */
    const ziehe = (eingabe: GeometrieEingabe): void => {
        const teile = eingabe.teile();
        eingabe.handbewegung({
            art: "ziehen",
            stelle: { objekt: GID(0x101), nr: 0, index: 1 },
            teile: teile.map((t) => ({ ...t, punkte: t.punkte.map((p, j) => (j === 1 ? { x: 411, y: 400 } : p)) })),
            mitgezogen: [
                {
                    stelle: { objekt: GID(0x102), nr: 0, index: 0 },
                    revision: 5,
                    von: { x: 410, y: 400 },
                    nach: { x: 411, y: 400 },
                },
            ],
            treffer: undefined,
            getrennt: false,
        });
    };

    it("🔴 B2: im EINEN Entwurf schreibt „Fertig“ der Bearbeitung die Grenze als territory.update, eigene Fläche und Nachbar je gegen ihre Revision", async () => {
        const DETAIL: EditorTerritoryDetail = {
            id: GID(1),
            revision: 2,
            name: "Baronie Firnholz",
            color: "#b2b065",
            opacity: 0.7,
            order: 0,
            parents: [],
            children: [],
            details: {},
            areas: [{ id: GID(0x101), revision: 3, bounds: [400, 400, 410, 410] }],
            claimedBy: [],
            claims: [],
        };
        const gesendet: { url: string; methode: string; body: TerritoryUpdateBody }[] = [];
        const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
            if (init?.method === "PATCH") {
                gesendet.push({ url: String(url), methode: init.method, body: JSON.parse(String(init.body)) });
                return new Response(
                    JSON.stringify({
                        operationId: "op",
                        status: "applied",
                        environment: "test",
                        affected: [{ kind: "territory", id: GID(1), revision: 2 }],
                        derivedWork: [],
                        warnings: [],
                        mapRevision: 4711,
                    }),
                    { status: 200 },
                );
            }
            return new Response(JSON.stringify(DETAIL), { status: 200 });
        });
        const art = createGebietArt(fetcher as unknown as typeof fetch);
        const bearbeitung = createBearbeitung(art, {
            id: GID(1),
            titel: "Baronie Firnholz",
            sperre: {
                nimm: vi.fn(async () => ({ art: "genommen" as const, sperre: {} as never })),
                gib: vi.fn(),
                beiVerlust: () => () => undefined,
            },
            neueKennung: () => "c1c1c1c1-0000-4000-8000-0000000000e1",
        });
        await vi.waitFor(() => expect(bearbeitung.detail.value?.revision).toBe(2));
        // Der Vermittler wie in `gebietsform-anbindung.ts`: alles an die Sicht der Bearbeitung, der Start meldet der Art die Form.
        // Bis die Bearbeitung ihre Sicht gibt (unten), antwortet der Vermittler mit den Vorgaben.
        let sicht: Entwurf<FormStand> | undefined = undefined;
        let gemerkt: Aufbau = new Map();
        const vermittler: Entwurf<FormStand> = {
            beginne: (stand) => {
                art.merkeForm(gemerkt, stand);
                sicht?.beginne(stand);
            },
            leere: () => sicht?.leere(),
            schritt: (stand, verschmelze) => sicht?.schritt(stand, verschmelze),
            schluss: () => sicht?.schluss(),
            ersetzeAlle: (neu) => sicht?.ersetzeAlle(neu),
            start: () => sicht?.start(),
            jetzt: () => sicht?.jetzt(),
            zurueck: () => sicht?.zurueck() ?? false,
            wieder: () => sicht?.wieder() ?? false,
            verwerfen: () => sicht?.verwerfen() ?? false,
            esc: () => sicht?.esc() ?? "ende",
            antworte: (verwerfen) => sicht?.antworte(verwerfen) ?? "ende",
            lage: () => sicht?.lage() ?? { ungespeichert: 0, zurueck: false, wieder: false, frage: false },
        };
        const { form, eingabe } = aufbau({
            entwurf: vermittler,
            merkeAufbau: (aufbau) => {
                gemerkt = aufbau;
            },
        });
        sicht = bearbeitung.formEntwurf({
            zurueck: () => form.zurueck(),
            wieder: () => form.wieder(),
            verwerfen: () => form.verwerfen(),
            abbrechen: () => form.abbrechen(),
            beende: () => form.beende(),
        });
        await form.starteMit(GID(1), FORM);
        ziehe(eingabe());
        expect(bearbeitung.lage.value).toMatchObject({ aktiv: true, form: true, ungespeichert: 1 });
        expect(art.geaendert(DETAIL, bearbeitung.stand.value!)).toEqual(["form"]);
        await bearbeitung.fertig();
        expect(gesendet).toHaveLength(1);
        expect(gesendet[0]!.methode).toBe("PATCH");
        expect(gesendet[0]!.url).toBe(`/api/editor/territories/${GID(1)}`);
        expect(gesendet[0]!.body).not.toHaveProperty("changes");
        expect(gesendet[0]!.body.areas!.map((a) => [a.id, a.baseRevision])).toEqual([
            [GID(0x101), 3],
            [GID(0x102), 5],
        ]);
        expect(gesendet[0]!.body.areas![0]!.polygons[0]![0]![1]).toEqual([411, 400]);
        // Geschrieben: Die Bearbeitung beendet die Form (Griffe aus).
        expect(form.laufend.value).toBeUndefined();
        bearbeitung.destroy();
    });
});

/**
 * 5.2 (Thomas 2026-10-19, wörtlich: „Wird auf einer gemeinsamen Grenze zweier Herrschaftsgebiete ein neuer Punkt hinzugefügt, soll dieser
 * automatisch auch beim angrenzenden Gebiet als verknüpfter Grenzpunkt eingefügt werden“): gerechnet wie im Modus über die Nachbarn,
 * die die Gebietsform ihm reicht; die Operation schreibt dann beide Gebietsflächen.
 */
describe("Gebietsform: neuer Punkt auf einer gemeinsamen Grenze (5.2)", () => {
    it("🔴 Gebiet–Gebiet: derselbe Punkt kommt in die Baronie Ost, die übernächste bleibt, und beide Flächen gehen in die Operation", async () => {
        let eingabe: GeometrieEingabe | undefined;
        const form = createGebietsform({
            daten: { form: vi.fn(async () => FORM) },
            sperre: {
                nimm: vi.fn(async () => ({ art: "genommen", sperre: {} })),
                gib: vi.fn(),
                liste: vi.fn(async () => []),
                beiVerlust: vi.fn(() => () => undefined),
            } as unknown as GebietsformOptionen["sperre"],
            fangradius: () => 12,
            karte: {
                ein: (e) => {
                    eingabe = e;
                    return {
                        aktualisiere: vi.fn(),
                        markiere: vi.fn(),
                        sperre: vi.fn(),
                        abbrechen: vi.fn(() => false),
                        aus: vi.fn(),
                    };
                },
                zeige: vi.fn(),
                geaendert: vi.fn(),
            },
        });
        await form.starteMit(GID(1), FORM);
        const vorher = form.entwurf()!;
        const teil = eingabe!.teile()[0]!;
        // Die gemeinsame Grenze (410,400)–(410,410): in der Baronie Firnholz die Strecke 1→2, also Stelle 2.
        const at = { x: 410, y: 404 };
        const eingefuegt = aufGemeinsamerKante(teil, 2, at, eingabe!.nachbarn());
        expect(eingefuegt).toEqual([{ stelle: { objekt: GID(0x102), nr: 0, index: 4 }, revision: 5, at }]);
        eingabe!.handbewegung({
            art: "einfuegen",
            stelle: { objekt: GID(0x101), nr: 0, index: 2 },
            teile: [{ ...teil, punkte: mitPunkt(teil.punkte, 2, at) }],
            mitgezogen: [],
            eingefuegt,
            treffer: undefined,
            getrennt: false,
        });
        const jetzt = form.entwurf()!;
        expect(jetzt.nachbarn.find((n) => n.objekt === GID(0x102))?.punkte.at(-1)).toEqual(at);
        expect(jetzt.nachbarn.find((n) => n.objekt === GID(0x103))?.punkte).toHaveLength(4);
        const operation = operationAus(
            vorher,
            jetzt,
            new Map([
                [GID(0x101), [1]],
                [GID(0x102), [1]],
                [GID(0x103), [1]],
            ]),
            "op",
        );
        expect(operation.areas.map((a) => [a.id, a.baseRevision, a.polygons[0]![0]!.length])).toEqual([
            [GID(0x101), 3, 5],
            [GID(0x102), 5, 5],
        ]);
    });

    describe("die Ecke wieder gelöscht (OPS-000079, 23 × 404 an Fürstenhort, 44 × 400 an Metenar und Havena)", () => {
        const gestartet = async (): Promise<{
            form: ReturnType<typeof createGebietsform>;
            eingabe: GeometrieEingabe;
        }> => {
            let eingabe: GeometrieEingabe | undefined;
            const form = createGebietsform({
                daten: { form: vi.fn(async () => FORM) },
                sperre: {
                    nimm: vi.fn(async () => ({ art: "genommen", sperre: {} })),
                    gib: vi.fn(),
                    liste: vi.fn(async () => []),
                    beiVerlust: vi.fn(() => () => undefined),
                } as unknown as GebietsformOptionen["sperre"],
                fangradius: () => 12,
                karte: {
                    ein: (e) => {
                        eingabe = e;
                        return {
                            aktualisiere: vi.fn(),
                            markiere: vi.fn(),
                            sperre: vi.fn(),
                            abbrechen: vi.fn(() => false),
                            aus: vi.fn(),
                        };
                    },
                    zeige: vi.fn(),
                    geaendert: vi.fn(),
                },
            });
            await form.starteMit(GID(1), FORM);
            return { form, eingabe: eingabe! };
        };
        const AUFBAU: Aufbau = new Map([
            [GID(0x101), [1]],
            [GID(0x102), [1]],
            [GID(0x103), [1]],
        ]);
        const stelle = { objekt: GID(0x101), nr: 0, index: 2 };
        const loesche = (eingabe: GeometrieEingabe, index: number): void => {
            const teil = eingabe.teile()[0]!;
            eingabe.handbewegung({
                art: "loeschen",
                stelle: { ...stelle, index },
                teile: [{ ...teil, punkte: ohnePunkt(teil.punkte, index) }],
                mitgezogen: [],
                entfernt: stellenAn(teil.punkte[index]!, eingabe.nachbarn()).map(({ objekt, nr, index }) => ({
                    stelle: { objekt, nr, index },
                })),
                treffer: undefined,
                getrennt: false,
            });
        };

        it("🔴 ein neuer Punkt auf der gemeinsamen Grenze geht beim Löschen auch beim Nachbarn: Nichts bleibt zu schreiben", async () => {
            const { form, eingabe } = await gestartet();
            const vorher = form.entwurf()!;
            const teil = eingabe.teile()[0]!;
            const at = { x: 410, y: 404 };
            eingabe.handbewegung({
                art: "einfuegen",
                stelle,
                teile: [{ ...teil, punkte: mitPunkt(teil.punkte, 2, at) }],
                mitgezogen: [],
                eingefuegt: aufGemeinsamerKante(teil, 2, at, eingabe.nachbarn()),
                treffer: undefined,
                getrennt: false,
            });
            expect(form.entwurf()!.nachbarn).not.toEqual(vorher.nachbarn);
            loesche(eingabe, 2);
            const jetzt = form.entwurf()!;
            expect(jetzt.nachbarn).toEqual(vorher.nachbarn);
            expect(operationAus(vorher, jetzt, AUFBAU, "op").areas).toEqual([]);
        });

        it("🔴 eine Ecke, die der Nachbar schon vorher hatte, bleibt ihm", async () => {
            const { form, eingabe } = await gestartet();
            const vorher = form.entwurf()!;
            loesche(eingabe, 1);
            const jetzt = form.entwurf()!;
            expect(jetzt.nachbarn).toEqual(vorher.nachbarn);
            expect(operationAus(vorher, jetzt, AUFBAU, "op").areas.map((a) => a.id)).toEqual([GID(0x101)]);
        });
    });

    describe("ein Splitter aus drei Ecken (OPS-000078)", () => {
        const ring = (objekt: string, nr: number, punkte: number): Teil => ({
            objekt,
            name: "Baronie",
            nr,
            art: "ring",
            punkte: Array.from({ length: punkte }, (_, i) => ({ x: nr * 100 + i, y: i * i })),
            revision: 7,
        });
        const haupt = ring("f", 0, 5);
        const splitter = ring("f", 1, 3);
        const aufbau = new Map([["f", [1, 1]]]);

        it("🔴 nur ein Teil mit der Mindestzahl geht, und nur, wenn das Objekt danach noch einen Teil hat", () => {
            expect(ohneTeil([haupt, splitter], splitter, 3)).toEqual([haupt]);
            expect(ohneTeil([haupt, splitter], haupt, 3)).toBeUndefined();
            expect(ohneTeil([splitter], splitter, 3)).toBeUndefined();
            expect(ohneTeil([splitter, ring("anders", 0, 5)], splitter, 3)).toBeUndefined();
        });

        it("🔴 die Operation schickt die Fläche ohne den Teil, ohne leeres Polygon", () => {
            const op = operationAus(
                { teile: [haupt, splitter], nachbarn: [] },
                { teile: [haupt], nachbarn: [] },
                aufbau,
                "op",
            );
            expect(op.areas).toHaveLength(1);
            expect(op.areas[0]!.polygons).toHaveLength(1);
            expect(op.areas[0]!.polygons[0]![0]).toHaveLength(5);
        });

        it("fällt der äußere Ring eines Polygons weg, gehen seine Löcher mit; ein Loch allein geht auch", () => {
            const loch = ring("f", 2, 3);
            const start = { teile: [haupt, splitter, loch], nachbarn: [] };
            const mitLoch = new Map([["f", [1, 2]]]);
            const ohneAussen = operationAus(start, { teile: [haupt, loch], nachbarn: [] }, mitLoch, "op");
            expect(ohneAussen.areas[0]!.polygons).toHaveLength(1);
            const ohneLoch = operationAus(start, { teile: [haupt, splitter], nachbarn: [] }, mitLoch, "op");
            expect(ohneLoch.areas[0]!.polygons.map((p) => p.length)).toEqual([1, 1]);
        });
    });
});
