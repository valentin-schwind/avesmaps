import { describe, expect, it, vi } from "vitest";
import type {
    EditorTerritoryDetail,
    TerritoryAreaCreateBody,
    TerritoryCreateBody,
    TerritoryCreateReceipt,
} from "@avesmaps3d/shared";
import type { SchreibAntwort } from "../src/fenster/entwurf-senden";
import { createGebietAnlegenFuerSeite } from "../src/gebietseditor/neue-flaeche-gebiet-anbindung";
import {
    FARBE_OHNE_OBERGEBIET,
    gebietAnlegen,
    gebietsKasten,
    grenzeZeichnen,
    neueGebietsfarbe,
    zieleAusGebieten,
    type GebietAnlegenDaten,
} from "../src/gebietseditor/neue-flaeche-gebiet";
import { GEBIET_ANLEGEN } from "../src/map/geometrie/arten";
import type { NeueFlaecheAuftrag, NeueFlaecheStart } from "../src/map/geometrie/neue-flaeche";
import { neueFlaecheMeldungText } from "../src/map/geometrie/neue-flaeche-texte";

/**
 * Die Andockung der Herrschaftsgebiete an „Neue Fläche“ (WI-0209 C3; EDIT-0003 §6, Fragen 1 bis 4) gegen gestellte Daten. Problemfälle:
 * Die Leiste nennt ein anderes Obergebiet, als „Fertig“ schreibt; ein festes Obergebiet („Untergebiet anlegen“) folgt doch dem Punkt;
 * die Farbe ist die des Obergebiets statt einer Variante oder trägt Großbuchstaben, die der Server ablehnt; „Grenze zeichnen“ schreibt ohne
 * Revision; ein Fehler des Servers kommt als Satz statt als Status; nach dem Anlegen steht der Name nicht markiert.
 */

const REICH = "11111111-1111-4111-8111-111111111111";
const NEU = "22222222-2222-4222-8222-222222222222";
const FLAECHE = "33333333-3333-4333-8333-333333333333";

const quittung = (name: string): TerritoryCreateReceipt =>
    ({
        operationId: "op-1",
        status: "applied",
        environment: "test",
        affected: [],
        derivedWork: [{ kind: "territory_derive", jobId: "job-1", state: "queued" }],
        warnings: [],
        mapRevision: 12,
        publicId: NEU,
        name,
        areaId: FLAECHE,
    }) as unknown as TerritoryCreateReceipt;

function daten(
    optionen: { reich?: EditorTerritoryDetail | null; antwort?: SchreibAntwort<TerritoryCreateReceipt> } = {},
) {
    const angelegt: TerritoryCreateBody[] = [];
    const grenzen: { id: string; body: TerritoryAreaCreateBody }[] = [];
    const d: GebietAnlegenDaten = {
        ziele: vi.fn(async () => ({
            corners: [{ areaId: FLAECHE, name: "Reich", x: 1, y: 2 }],
            edges: [{ areaId: FLAECHE, name: "Reich", a: [1, 2] as [number, number], b: [3, 4] as [number, number] }],
            truncated: false,
        })),
        gebiet: vi.fn(async () =>
            optionen.reich === undefined
                ? ({
                      id: REICH,
                      color: "#B2B065",
                      parents: [],
                      children: [{ id: "x", name: "Alt" }],
                  } as unknown as EditorTerritoryDetail)
                : optionen.reich,
        ),
        legeAn: vi.fn(async (body: TerritoryCreateBody) => {
            angelegt.push(body);
            return optionen.antwort ?? { ok: true as const, quittung: quittung("Neues Herrschaftsgebiet") };
        }),
        zeichneGrenze: vi.fn(async (id: string, body: TerritoryAreaCreateBody) => {
            grenzen.push({ id, body });
            return { ok: true as const, quittung: { ...quittung("Baronie"), publicId: id } };
        }),
    };
    return { d, angelegt, grenzen };
}

const RING = [
    { x: 10, y: 10 },
    { x: 20, y: 10 },
    { x: 20, y: 20 },
];

describe("Neue Fläche: die Andockung der Herrschaftsgebiete (WI-0209 C3)", () => {
    it("🔴 neues Gebiet: das Obergebiet am Punkt nennt die Leiste, und mit genau ihm schreibt „Fertig“ (Frage 2)", async () => {
        const { d, angelegt } = daten();
        const amPunkt = vi.fn((p: { x: number; y: number }) => (p.x < 100 ? { id: REICH, name: "Reich" } : undefined));
        const andockung = gebietAnlegen({ daten: d, amPunkt, geoeffnet: vi.fn(), zufall: () => 0.5 });
        expect(andockung).toMatchObject({ id: "gebiet", art: GEBIET_ANLEGEN, ansicht: { view: "political" } });
        expect(andockung.objekt?.({ x: 10, y: 10 })).toBe("wird Untergebiet von Reich");
        const ergebnis = await andockung.schreibe(RING, "op-1");
        expect(ergebnis).toEqual({ ok: true, publicId: NEU, name: "Neues Herrschaftsgebiet", mapRevision: 12 });
        expect(d.gebiet).toHaveBeenCalledWith(REICH);
        expect(angelegt).toHaveLength(1);
        expect(angelegt[0]).toMatchObject({
            operationId: "op-1",
            parent: REICH,
            ring: [
                [10, 10],
                [20, 10],
                [20, 20],
            ],
        });
        // Eine Variante des Obergebiets, in Kleinbuchstaben (der Server nimmt nur sie).
        expect(angelegt[0]!.color).toMatch(/^#[0-9a-f]{6}$/u);
        expect(angelegt[0]!.color).not.toBe("#b2b065");
        // Eine andere erste Ecke ohne Gebiet darunter: ohne Obergebiet, Legacys Grau.
        expect(andockung.objekt?.({ x: 500, y: 10 })).toBe("ohne Obergebiet");
        await andockung.schreibe(RING, "op-2");
        expect(angelegt[1]).toMatchObject({ color: FARBE_OHNE_OBERGEBIET });
        expect(angelegt[1]).not.toHaveProperty("parent");
    });

    it("🔴 „Untergebiet anlegen“: das Obergebiet steht fest, auch wenn die Karte am Punkt ein anderes zeigt", async () => {
        const { d, angelegt } = daten();
        const amPunkt = vi.fn(() => ({ id: "anderes", name: "Anderes" }));
        const andockung = gebietAnlegen({
            daten: d,
            obergebiet: { id: REICH, name: "Reich" },
            amPunkt,
            geoeffnet: vi.fn(),
        });
        expect(andockung.id).toBe("untergebiet");
        expect(andockung.objekt?.(undefined)).toBe("wird Untergebiet von Reich");
        expect(andockung.objekt?.({ x: 1, y: 1 })).toBe("wird Untergebiet von Reich");
        await andockung.schreibe(RING, "op-1");
        expect(amPunkt).not.toHaveBeenCalled();
        expect(angelegt[0]).toMatchObject({ parent: REICH });
    });

    it("ein Obergebiet, das sich nicht mehr lesen lässt, schreibt nicht; ein Serverfehler kommt als Status, eine Ablehnung als Satz", async () => {
        const weg = daten({ reich: null });
        const a = gebietAnlegen({ daten: weg.d, obergebiet: { id: REICH, name: "Reich" }, geoeffnet: vi.fn() });
        expect(await a.schreibe(RING, "op")).toEqual({
            ok: false,
            satz: "Das Obergebiet ließ sich nicht lesen; vielleicht ist es inzwischen gelöscht.",
        });
        expect(weg.angelegt).toEqual([]);
        const fehler = (status: number, message: string) =>
            daten({ antwort: { ok: false, status, fehler: { code: "x", message } } });
        const kaputt = fehler(503, "weg");
        expect(await gebietAnlegen({ daten: kaputt.d, geoeffnet: vi.fn() }).schreibe(RING, "op")).toEqual({
            ok: false,
            status: 503,
        });
        const abgelehnt = fehler(400, "Eine Ecke liegt außerhalb der Karte.");
        expect(await gebietAnlegen({ daten: abgelehnt.d, geoeffnet: vi.fn() }).schreibe(RING, "op")).toEqual({
            ok: false,
            satz: "Eine Ecke liegt außerhalb der Karte.",
        });
    });

    it("🔴 „Grenze zeichnen“: gegen die Revision des Gebiets; die Leiste nennt es", async () => {
        const { d, grenzen } = daten();
        const andockung = grenzeZeichnen({
            daten: d,
            gebiet: { id: REICH, name: "Reich", revision: 7 },
            geoeffnet: vi.fn(),
        });
        expect(andockung.objekt?.(undefined)).toBe("Grenze von Reich");
        expect(await andockung.schreibe(RING, "op-9")).toMatchObject({ ok: true, publicId: REICH });
        expect(grenzen).toEqual([
            {
                id: REICH,
                body: {
                    operationId: "op-9",
                    baseRevision: 7,
                    ring: [
                        [10, 10],
                        [20, 10],
                        [20, 20],
                    ],
                },
            },
        ]);
    });

    it("🔴 Claudios §4: vor „Fertig“ liest die Andockung nur, ein Abbruch legt also nichts an; nach einem Serverfehler schreibt sie nicht von selbst neu", async () => {
        const { d, angelegt, grenzen } = daten({
            antwort: { ok: false, status: 503, fehler: { code: "x", message: "weg" } },
        });
        const andockung = gebietAnlegen({
            daten: d,
            amPunkt: () => ({ id: REICH, name: "Reich" }),
            geoeffnet: vi.fn(),
        });
        // Was der Ablauf vor „Fertig“ fragt: das Objekt der Leiste und die Ziele zum Einrasten.
        andockung.objekt?.({ x: 10, y: 10 });
        await andockung.ziele({ x0: 0, y0: 0, x1: 100, y1: 50 }, { x: 10, y: 10 }, new AbortController().signal);
        expect(d.legeAn).not.toHaveBeenCalled();
        expect(d.zeichneGrenze).not.toHaveBeenCalled();
        // „Fertig“ mit Serverfehler: genau EIN Versuch, danach nichts mehr ohne den Nutzer.
        expect(await andockung.schreibe(RING, "op-1")).toEqual({ ok: false, status: 503 });
        expect(angelegt).toHaveLength(1);
        expect(grenzen).toEqual([]);
    });

    it("🔴 gespeichert meldet die Fläche für die Karte bis zur Ableitung: Ring, Farbe, Gebiet, Auftrag; ein Fehler meldet nichts", async () => {
        const { d } = daten();
        const gespeichert = vi.fn();
        const andockung = gebietAnlegen({ daten: d, geoeffnet: vi.fn(), gespeichert });
        await andockung.schreibe(RING, "op-1");
        expect(gespeichert).toHaveBeenCalledWith({
            flaeche: FLAECHE,
            gebiet: NEU,
            farbe: FARBE_OHNE_OBERGEBIET,
            polygone: [
                [
                    [
                        [10, 10],
                        [20, 10],
                        [20, 20],
                    ],
                ],
            ],
            job: "job-1",
        });
        // „Grenze zeichnen“: die Farbe kennt die Liste.
        const grenze = grenzeZeichnen({
            daten: d,
            geoeffnet: vi.fn(),
            gespeichert,
            gebiet: { id: REICH, name: "Reich", revision: 4 },
        });
        await grenze.schreibe(RING, "op-2");
        expect(gespeichert).toHaveBeenLastCalledWith(expect.objectContaining({ gebiet: REICH, farbe: undefined }));
        const kaputt = daten({ antwort: { ok: false, status: 503, fehler: { code: "x", message: "weg" } } });
        const still = vi.fn();
        await gebietAnlegen({ daten: kaputt.d, geoeffnet: vi.fn(), gespeichert: still }).schreibe(RING, "op-3");
        expect(still).not.toHaveBeenCalled();
    });

    it("🔴 ein Untergebiet ab Band 4: die Meldung nach „Fertig“ sagt, ab welchem Band die Karte es zeigt; eine Wurzel nicht", async () => {
        const unter = daten({ antwort: { ok: true, quittung: { ...quittung("Claudios Reich"), minZoom: 4 } } });
        const ergebnis = await gebietAnlegen({ daten: unter.d, geoeffnet: vi.fn() }).schreibe(RING, "op-1");
        expect(ergebnis).toMatchObject({ ok: true, hinweis: "Auf der Karte ab Band 4." });
        expect(
            neueFlaecheMeldungText({
                art: "gespeichert",
                publicId: NEU,
                name: "Claudios Reich",
                hinweis: "Auf der Karte ab Band 4.",
            }),
        ).toBe("✓ „Claudios Reich“ angelegt. Auf der Karte ab Band 4.");
        const wurzel = daten({ antwort: { ok: true, quittung: { ...quittung("Valis Reich"), minZoom: 0 } } });
        expect(await gebietAnlegen({ daten: wurzel.d, geoeffnet: vi.fn() }).schreibe(RING, "op-2")).not.toHaveProperty(
            "hinweis",
        );
    });

    it("die Ziele sind Ecken und Kanten der Gebietsflächen; der Kasten bleibt höchstens 160 breit um die letzte Ecke", async () => {
        const { d } = daten();
        expect(
            zieleAusGebieten({
                corners: [{ areaId: FLAECHE, name: "Reich", x: 1, y: 2 }],
                edges: [{ areaId: FLAECHE, name: "Reich", a: [1, 2], b: [3, 4] }],
                truncated: false,
            }),
        ).toEqual([
            { art: "ecke", at: { x: 1, y: 2 }, objekt: FLAECHE, name: "Reich" },
            { art: "kante", at: { x: 1, y: 2 }, bis: { x: 3, y: 4 }, objekt: FLAECHE, name: "Reich" },
        ]);
        expect(gebietsKasten({ x0: 0, y0: 0, x1: 100, y1: 50 }, undefined)).toEqual({ x0: 0, y0: 0, x1: 100, y1: 50 });
        expect(gebietsKasten({ x0: 0, y0: 0, x1: 1000, y1: 50 }, { x: 300, y: 20 })).toEqual({
            x0: 220,
            y0: 0,
            x1: 380,
            y1: 50,
        });
        const andockung = gebietAnlegen({ daten: d, geoeffnet: vi.fn() });
        const ziele = await andockung.ziele(
            { x0: 0, y0: 0, x1: 1000, y1: 50 },
            { x: 300, y: 20 },
            new AbortController().signal,
        );
        expect(ziele).toHaveLength(2);
        expect(d.ziele).toHaveBeenCalledWith({ x0: 220, y0: 0, x1: 380, y1: 50 }, expect.any(AbortSignal));
    });

    it("die Farbe: ohne Obergebiet Legacys Grau; mit ihm wiederholbar zu Seed und Würfel", () => {
        expect(neueGebietsfarbe(undefined, "a")).toBe(FARBE_OHNE_OBERGEBIET);
        const eltern = { color: "#b2b065", parents: [], children: [] };
        const eins = neueGebietsfarbe(eltern, "seed", () => 0.25);
        expect(neueGebietsfarbe(eltern, "seed", () => 0.25)).toBe(eins);
        expect(eins).toMatch(/^#[0-9a-f]{6}$/u);
        expect(eins).not.toBe("#b2b065");
    });

    it("🔴 für die Seite: nach dem Speichern öffnet das Gebiet, und sein Name steht markiert, bis das Fenster es meldet", async () => {
        const { d } = daten();
        const starte = vi.fn<(auftrag: NeueFlaecheAuftrag) => Promise<NeueFlaecheStart>>(async () => "laeuft");
        const oeffne = vi.fn();
        const seite = createGebietAnlegenFuerSeite(
            { karte: () => undefined, starte, gebieteBereit: () => false, oeffne },
            d,
        );
        seite.untergebiet({ id: REICH, name: "Reich" });
        const auftrag = starte.mock.calls[0]![0];
        expect(auftrag.anfang).toBeUndefined();
        // Ohne geladene Gebiete gibt es die Ansicht „Politisch“ nicht.
        expect(auftrag.andockung.darf()).toBe("gebietseditor.neu.nichtGeladen");
        auftrag.andockung.geoeffnet({ publicId: NEU, name: "Neues Herrschaftsgebiet" });
        expect(oeffne).toHaveBeenCalledWith(NEU);
        expect(seite.nameMarkieren.value).toBe(NEU);
        seite.markiert();
        expect(seite.nameMarkieren.value).toBeUndefined();
        seite.neu({ x: 5, y: 6 });
        expect(starte.mock.calls[1]![0]).toMatchObject({ anfang: { x: 5, y: 6 } });
        seite.grenze({ id: REICH, name: "Reich", revision: 3 });
        expect(starte.mock.calls[2]![0].andockung.id).toBe("gebiet-grenze");
    });
});
