import { describe, expect, it, vi } from "vitest";
import type { SpracheEditorFlaecheForm } from "@avesmaps3d/shared";
import { anlegenZiele } from "../src/map/geometrie/anlegen.ts";
import { GEBIET, GEBIET_ANLEGEN, SPRACHE, SPRACHE_ANLEGEN } from "../src/map/geometrie/arten.ts";
import type { Teil, Ziel } from "../src/map/geometrie/geometrie.ts";
import { ausKennung, laufKennung, polygoneAus, startAus } from "../src/spracheditor/sprachflaeche-form.ts";
import { sprachflaecheZeichnen } from "../src/spracheditor/sprachflaeche-neu.ts";
import type { SprachSperre } from "../src/spracheditor/sprach-sperre.ts";

/**
 * Die Geometrie der Sprachen (WI-0261 S5d2; E2, E4; Betreiber 2026-10-30: „flächen dürfen sich überlappen und sind unabhängig voneinander“):
 * die Art `SPRACHE` im gemeinsamen Geometrie-Modul nach dem Muster `GEBIET`, aber ohne Einrasten und ohne Mitziehen, und „✚ Teilfläche
 * zeichnen“ ohne Ziele.
 *
 * Problemfälle: Eine Ecke rastet an der Kante einer anderen Sprache ein (dann teilten sich zwei unabhängige Flächen eine Grenze); eine fremde
 * Ecke zieht mit; der neue Ring schließt nicht mehr, weil ohne Ziele auch der eigene Anfang fehlt; „Fertig“ verliert die Löcher.
 */

const SPRACHE_ID = "5d2c0000-0000-4000-8000-000000000001";
const FLAECHE = "5d2c0000-0000-4000-8000-0000000000f1";
const RING: Teil = {
    objekt: FLAECHE,
    name: "Garethi",
    nr: 0,
    art: "ring",
    punkte: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
    ],
    revision: 3,
};
const stelle = { objekt: FLAECHE, nr: 0, index: 1 };
const FREMDE_ECKE: Ziel = { art: "ecke", at: { x: 10, y: 0 }, objekt: "andere-sprache", name: "Tulamidya" };
const FREMDE_KANTE: Ziel = {
    art: "kante",
    at: { x: 20, y: 0 },
    bis: { x: 20, y: 20 },
    objekt: "andere-sprache",
    name: "Tulamidya",
};

describe("Die Art „Sprache“ (WI-0261 S5d2)", () => {
    it("🔴 eckig wie das Gebiet, aber ohne Einrasten und ohne Mitziehen (E4)", () => {
        expect(SPRACHE.teilart).toBe("ring");
        expect(SPRACHE.rundung(RING.punkte, RING)).toEqual(RING.punkte);
        expect(SPRACHE.ziele(stelle, RING)).toEqual([]);
        expect(SPRACHE.zielErlaubt(FREMDE_ECKE, stelle, RING)).toBe(false);
        expect(SPRACHE.zielErlaubt(FREMDE_KANTE, stelle, RING)).toBe(false);
        expect(SPRACHE.mitziehen).toBe(false);
        // Das Gebiet rastet an fremden Ecken ein und zieht mit: genau das darf die Sprache nicht.
        expect(GEBIET.ziele(stelle, RING)).toEqual(["ecke", "kante"]);
        expect(GEBIET.mitziehen).toBe(true);
        // Löschen und Einfügen wie bei der Fläche: drei Ecken bleiben.
        expect(SPRACHE.loeschbar(stelle, RING)).toBe(true);
        expect(SPRACHE.loeschbar(stelle, { ...RING, punkte: RING.punkte.slice(0, 3) })).toBe(false);
        expect(SPRACHE.einfuegen).toBe(true);
    });

    it("🔴 die neue Teilfläche rastet an keiner fremden Ecke ein, schließt aber am eigenen Anfang", () => {
        expect(SPRACHE_ANLEGEN.ziele({ punkte: 0 } as never)).toEqual([]);
        expect(GEBIET_ANLEGEN.ziele({ punkte: 0 } as never)).toEqual(["ecke", "kante"]);
        const entwurf = {
            punkte: [{ at: { x: 0, y: 0 } }, { at: { x: 10, y: 0 } }, { at: { x: 10, y: 10 } }],
        } as never;
        const ziele = anlegenZiele(SPRACHE_ANLEGEN, entwurf, []);
        expect(ziele).toHaveLength(1);
        expect(ziele[0]?.at).toEqual({ x: 0, y: 0 });
    });

    it("„✚ Teilfläche zeichnen“: Derographie › Sprachen, keine Ziele, ein Polygon gegen die Revision der Sprache unter ihrer Sperre", async () => {
        const flaecheAnlegen = vi.fn(async () => ({
            ok: true as const,
            quittung: {
                operationId: "op",
                status: "applied" as const,
                environment: "development",
                affected: [],
                derivedWork: [],
                warnings: [],
                mapRevision: 88,
                flaecheId: "neu-1",
            },
        }));
        const unter = vi.fn(<T>(_id: string, schreibe: () => Promise<T>): Promise<T> =>
            schreibe(),
        ) as unknown as SprachSperre["unter"];
        const geoeffnet = vi.fn();
        const andockung = sprachflaecheZeichnen({
            sprache: { id: SPRACHE_ID, name: "Garethi", revision: 7 },
            daten: { flaecheAnlegen },
            sperre: { unter },
            geoeffnet,
        });
        expect(andockung.ansicht).toEqual({ view: "landscapes", layer: "sprachen" });
        expect(andockung.art).toBe(SPRACHE_ANLEGEN);
        expect(await andockung.ziele({ x0: 0, y0: 0, x1: 1, y1: 1 }, undefined, new AbortController().signal)).toEqual(
            [],
        );
        const ergebnis = await andockung.schreibe(
            [
                { x: 1, y: 2 },
                { x: 3, y: 2 },
                { x: 3, y: 5 },
            ],
            "op-9",
        );
        expect(unter).toHaveBeenCalledWith(SPRACHE_ID, expect.any(Function));
        expect(flaecheAnlegen).toHaveBeenCalledWith(SPRACHE_ID, {
            operationId: "op-9",
            baseRevision: 7,
            polygons: [
                [
                    [
                        [1, 2],
                        [3, 2],
                        [3, 5],
                    ],
                ],
            ],
        });
        expect(ergebnis).toEqual({ ok: true, publicId: SPRACHE_ID, name: "Garethi", mapRevision: 88 });
        andockung.geoeffnet({ publicId: SPRACHE_ID, name: "Garethi" });
        expect(geoeffnet).toHaveBeenCalledWith(SPRACHE_ID, "neu-1");
    });
});

describe("„◇ Fläche bearbeiten“ an einer Teilfläche (WI-0261 S5d2)", () => {
    const FORM: SpracheEditorFlaecheForm = {
        id: FLAECHE,
        sprache: SPRACHE_ID,
        revision: 3,
        herkunft: "sprachenkarte",
        quelleRevision: "e0619e909dcc",
        aktiv: true,
        polygons: [
            [
                [
                    [0, 0],
                    [10, 0],
                    [10, 10],
                    [0, 10],
                ],
                [
                    [2, 2],
                    [4, 2],
                    [4, 4],
                ],
            ],
            [
                [
                    [20, 20],
                    [30, 20],
                    [30, 30],
                ],
            ],
        ],
    };

    it("gesperrt wird die Sprache, ohne Nachbarn und ohne Ziele; die Kennung des Laufs nennt Sprache und Teilfläche", () => {
        const start = startAus(FORM, "Garethi · Teilfläche 1");
        expect(start.sperrId).toBe(SPRACHE_ID);
        expect(start.nachbarn).toEqual([]);
        expect(start.ziele([], [])).toEqual([]);
        expect(start.teile).toHaveLength(3);
        expect(start.aufbau).toEqual([2, 1]);
        expect(ausKennung(laufKennung(SPRACHE_ID, FLAECHE))).toEqual({ sprache: SPRACHE_ID, flaeche: FLAECHE });
        expect(ausKennung("nur-eins")).toBeUndefined();
    });

    it("🔴 „Fertig“ schickt die ganze Form im Aufbau vom Lesen, Löcher eingeschlossen; unverändert nichts", () => {
        const start = startAus(FORM, "Garethi");
        const vorher = { teile: start.teile, nachbarn: [] };
        expect(polygoneAus(start, vorher, vorher)).toBeUndefined();
        const teile = start.teile.map((teil) =>
            teil.nr === 0 ? { ...teil, punkte: teil.punkte.map((p, i) => (i === 1 ? { x: 12, y: 0 } : p)) } : teil,
        );
        expect(polygoneAus(start, vorher, { teile, nachbarn: [] })).toEqual([
            [
                [
                    [0, 0],
                    [12, 0],
                    [10, 10],
                    [0, 10],
                ],
                [
                    [2, 2],
                    [4, 2],
                    [4, 4],
                ],
            ],
            [
                [
                    [20, 20],
                    [30, 20],
                    [30, 30],
                ],
            ],
        ]);
    });
});
