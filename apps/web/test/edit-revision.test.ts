import { describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import {
    createEditRevision,
    createRevisionsDrossel,
    ladeKachelStand,
    loeseHaengendeKacheln,
    mitStand,
    NACHSCHAU_MS,
    quellenFuer,
} from "../src/map/edit-revision.ts";

/**
 * Die Kachelrevision der bearbeitbaren Quellen (WI-0128 E13; EDIT-0001 §6.3, Test „`?r=` steigt nach jeder Operation“): Nach einer
 * Operation tragen Orte, Wege und Wegnamen die Revision der Quittung bzw. des Ereignisses `map.changed`; dieselbe Revision zweimal
 * (eigene Quittung und Ereignis) lädt einmal, eine ältere nie.
 */
describe("Kachelrevision", () => {
    const quellen = {
        places: "/tiles/vector/place_render/{z}/{x}/{y}",
        paths: "/tiles/vector/path_render/{z}/{x}/{y}",
    };
    const karte = () => {
        const setTiles = { places: vi.fn(), paths: vi.fn() };
        const map = {
            getSource: (id: string) =>
                id in setTiles ? { setTiles: setTiles[id as keyof typeof setTiles] } : undefined,
        } as unknown as MapLibreMap;
        return { map, setTiles };
    };

    it("🔴 ohne Operation keine Revision; danach trägt jede Quelle ?r=<Revision>, und der Stil baut dieselbe Adresse", () => {
        const revision = createEditRevision(quellen);
        expect(revision.url(quellen.places)).toBe(quellen.places);
        const { map, setTiles } = karte();
        expect(revision.advance(map, 41)).toBe(true);
        expect(setTiles.places).toHaveBeenCalledWith(["/tiles/vector/place_render/{z}/{x}/{y}?r=41"]);
        expect(setTiles.paths).toHaveBeenCalledWith(["/tiles/vector/path_render/{z}/{x}/{y}?r=41"]);
        expect(revision.url(quellen.paths)).toBe("/tiles/vector/path_render/{z}/{x}/{y}?r=41");
    });

    it("🔴 die Revision geht nur vorwärts: Quittung und Ereignis derselben Operation laden einmal, eine ältere nie", () => {
        const revision = createEditRevision(quellen);
        const { map, setTiles } = karte();
        revision.advance(map, 41);
        expect(revision.advance(map, 41)).toBe(false);
        expect(revision.advance(map, 40)).toBe(false);
        expect(setTiles.places).toHaveBeenCalledTimes(1);
        expect(revision.advance(map, 42)).toBe(true);
        expect(setTiles.places).toHaveBeenCalledTimes(2);
        expect(revision.current).toBe(42);
    });

    it("ohne Karte merkt sie die Revision für den ersten Stil; eine fehlende Quelle (andere Ansicht) stört nicht", () => {
        const revision = createEditRevision({ ...quellen, labels: "/tiles/vector/path_label_run_tile/{z}/{x}/{y}" });
        expect(revision.advance(undefined, 7)).toBe(true);
        expect(revision.url(quellen.places)).toBe("/tiles/vector/place_render/{z}/{x}/{y}?r=7");
        const { map, setTiles } = karte();
        expect(revision.advance(map, 8)).toBe(true);
        expect(setTiles.paths).toHaveBeenCalledOnce();
    });

    it("🔴 eine Wegänderung ändert die Adresse der Orte nicht: Ein Stilwechsel lädt sie nicht neu (WI-0283 H3)", () => {
        const revision = createEditRevision(quellen);
        const { map } = karte();
        revision.advance(map, 10);
        revision.advance(map, 11, ["paths"]);
        expect(revision.url(quellen.paths)).toContain("r=11");
        expect(revision.url(quellen.places)).toContain("r=10");
    });

    describe("Die Revision von Anfang an (WI-0283 H3)", () => {
        const nachArt = { path: ["paths"], region: ["flaechen"] };
        const drei = { ...quellen, flaechen: "/tiles/vector/region_area_tile/{z}/{x}/{y}" };

        it("🔴 je Quelle das jüngste Ereignis, das sie betrifft; eine Art ohne Eintrag und ein Ereignis ohne Art betreffen alle", () => {
            const revision = createEditRevision(drei);
            revision.beginne({ schemaVersion: 1, ohneArt: 5, arten: { path: 9, region: 3 } }, nachArt);
            expect(revision.url(drei.paths)).toContain("r=9");
            expect(revision.url(drei.flaechen)).toContain("r=5");
            expect(revision.url(drei.places)).toContain("r=5");
            revision.beginne({ schemaVersion: 1, ohneArt: 5, arten: { path: 9, place: 12 } }, nachArt);
            expect(revision.url(drei.flaechen)).toContain("r=12");
        });

        it("🔴 auch ohne aufbewahrtes Ereignis trägt jede Quelle eine Revision", () => {
            const revision = createEditRevision(quellen);
            revision.beginne({ schemaVersion: 1, ohneArt: 0, arten: {} }, nachArt);
            expect(revision.url(quellen.places)).toContain("?r=1");
        });

        it("🔴 der Start lädt nichts und zählt nicht als gehört; die nächste Quittung gilt, auch für die betroffene Quelle allein", () => {
            const revision = createEditRevision(quellen);
            const { map, setTiles } = karte();
            revision.beginne({ schemaVersion: 1, ohneArt: 0, arten: { path: 40, place: 20 } }, nachArt);
            expect(revision.current).toBe(0);
            expect(setTiles.places).not.toHaveBeenCalled();
            expect(revision.advance(map, 41, ["paths"])).toBe(true);
            expect(setTiles.paths).toHaveBeenCalledWith(["/tiles/vector/path_render/{z}/{x}/{y}?r=41"]);
            expect(setTiles.places).not.toHaveBeenCalled();
            expect(revision.url(quellen.places)).toContain("r=20");
        });

        it("🔴 scheitert das Lesen, startet die Karte wie zuvor ohne Revision", async () => {
            const revision = createEditRevision(quellen);
            for (const fetcher of [
                () => Promise.reject(new Error("weg")),
                () => Promise.resolve(new Response("<html>", { status: 200 })),
                () => Promise.resolve(new Response("{}", { status: 404 })),
                () => Promise.resolve(new Response(JSON.stringify({ schemaVersion: 2 }), { status: 200 })),
            ])
                expect(await ladeKachelStand(fetcher as unknown as typeof fetch)).toBeUndefined();
            expect(revision.url(quellen.places)).toBe(quellen.places);
            expect(
                await ladeKachelStand((() =>
                    Promise.resolve(
                        new Response(JSON.stringify({ schemaVersion: 1, ohneArt: 2, arten: {} }), { status: 200 }),
                    )) as unknown as typeof fetch),
            ).toEqual({ schemaVersion: 1, ohneArt: 2, arten: {} });
        });

        it("eine Quelle mit Zeiger trägt ?rev=", () => {
            expect(mitStand("/tiles/vector/terrain_contour_tile/{z}/{x}/{y}", "abc123")).toBe(
                "/tiles/vector/terrain_contour_tile/{z}/{x}/{y}?rev=abc123",
            );
        });
    });

    it("hoere: jede neuere Revision einmal, auch ohne Karte (die Bögen der Kraftlinien laden ihr Netz neu, WI-0205 K5)", () => {
        const revision = createEditRevision({});
        const gehoert: number[] = [];
        revision.hoere((r) => gehoert.push(r));
        revision.advance(undefined, 3);
        revision.advance(undefined, 3);
        revision.advance(undefined, 2);
        revision.advance(undefined, 5);
        expect(gehoert).toEqual([3, 5]);
    });
});

describe("Hängende Kacheln (Stage 2026-10-19, Thomas 4.2)", () => {
    const kachel = (state: string, mehr: Record<string, unknown> = {}, x = 16) => ({
        state,
        tileID: { canonical: { x, y: 8, z: 5 } },
        ...mehr,
    });
    const karte = (kacheln: ReturnType<typeof kachel>[]) => {
        const refreshTiles = vi.fn();
        const map = {
            style: { tileManagers: { landscapes: { _inViewTiles: { getAllTiles: () => kacheln } } } },
            refreshTiles,
            getSource: () => ({ setTiles: vi.fn() }),
        } as unknown as MapLibreMap;
        return { map, refreshTiles };
    };

    it("🔴 nur die Kachel, die auf eine vergangene Anfrage wartet, wird als gescheitert frisch geladen", () => {
        const haengt = kachel("loading", { reloadPromise: {} }, 16);
        const unterwegs = kachel("loading", { reloadPromise: {}, abortController: {} }, 17);
        const beginnt = kachel("loading", {}, 15);
        const fertig = kachel("loaded", {}, 14);
        const { map, refreshTiles } = karte([haengt, unterwegs, beginnt, fertig]);
        expect(loeseHaengendeKacheln(map, ["landscapes", "fehlt"])).toBe(1);
        expect(haengt.state).toBe("errored");
        expect([unterwegs.state, beginnt.state, fertig.state]).toEqual(["loading", "loading", "loaded"]);
        expect(refreshTiles).toHaveBeenCalledWith("landscapes", [{ x: 16, y: 8, z: 5 }]);
    });

    it("ohne die Innereien von MapLibre (andere Fassung) tut sie nichts", () => {
        expect(loeseHaengendeKacheln({} as MapLibreMap, ["landscapes"])).toBe(0);
    });

    it("🔴 nach jedem Wechsel sieht sie zweimal nach; ein neuer Wechsel ersetzt die alte Nachschau", () => {
        const geplant: { ms: number; f: () => void; ab: boolean }[] = [];
        const revision = createEditRevision(
            { landscapes: "/tiles/vector/region_area_render/{z}/{x}/{y}" },
            {
                setTimeout: (f, ms) => {
                    const eintrag = { ms, f, ab: false };
                    geplant.push(eintrag);
                    return eintrag;
                },
                clearTimeout: (handle) => {
                    (handle as { ab: boolean }).ab = true;
                },
            },
        );
        const haengt = kachel("loading", { reloadPromise: {} });
        const { map, refreshTiles } = karte([haengt]);
        revision.advance(map, 5);
        revision.advance(map, 6);
        expect(geplant.map((g) => [g.ms, g.ab])).toEqual([
            [NACHSCHAU_MS[0], true],
            [NACHSCHAU_MS[1], true],
            [NACHSCHAU_MS[0], false],
            [NACHSCHAU_MS[1], false],
        ]);
        geplant[2]!.f();
        expect(refreshTiles).toHaveBeenCalledOnce();
        expect(haengt.state).toBe("errored");
    });
});

/**
 * Nur, was sich geändert hat, und fremde Ereignisse gedrosselt (WI-0177, Thomas 2.3; Hauptorchestrierung 2026-10-19): Schreiben Editoren in
 * kurzer Folge, lädt eine Wegänderung nur Wege und Wegnamen, und eine zuschauende Karte nimmt höchstens alle 3 s eine Revision.
 */
describe("Kachelrevision je Quelle und gedrosselt", () => {
    const quellen = {
        places: "/tiles/vector/place_render/{z}/{x}/{y}",
        paths: "/tiles/vector/path_render/{z}/{x}/{y}",
    };
    const karte = () => {
        const setTiles = { places: vi.fn(), paths: vi.fn() };
        const map = {
            getSource: (id: string) =>
                id in setTiles ? { setTiles: setTiles[id as keyof typeof setTiles] } : undefined,
        } as unknown as MapLibreMap;
        return { map, setTiles };
    };

    it("🔴 eine Wegänderung lädt nur die Wege; die Orte holen mit der nächsten Revision, die sie betrifft, auf", () => {
        const revision = createEditRevision(quellen);
        const { map, setTiles } = karte();
        revision.advance(map, 10);
        expect(revision.advance(map, 11, ["paths"])).toBe(true);
        expect(setTiles.paths).toHaveBeenLastCalledWith(["/tiles/vector/path_render/{z}/{x}/{y}?r=11"]);
        expect(setTiles.places).toHaveBeenCalledTimes(1);
        // Ein fremdes Ereignis an den Orten (Revision 10 < 11) kommt nach der eigenen Quittung an: Die Orte laden trotzdem, mit 11.
        expect(revision.advance(map, 10)).toBe(false);
        expect(setTiles.places).toHaveBeenLastCalledWith(["/tiles/vector/place_render/{z}/{x}/{y}?r=11"]);
        expect(setTiles.paths).toHaveBeenCalledTimes(2);
    });

    it("Hörer mit Quellen hören nur, was sie betrifft; ohne Quellen jede neuere Revision", () => {
        const revision = createEditRevision(quellen);
        const wege: number[] = [];
        const orte: number[] = [];
        const alle: number[] = [];
        revision.hoere((r) => wege.push(r), ["paths"]);
        revision.hoere((r) => orte.push(r), ["places"]);
        revision.hoere((r) => alle.push(r));
        revision.advance(undefined, 3, ["paths"]);
        revision.advance(undefined, 4);
        expect(wege).toEqual([3, 4]);
        expect(orte).toEqual([4]);
        expect(alle).toEqual([3, 4]);
    });

    it("quellenFuer: nur Wege berührt heißt die Wege-Quellen, sonst (auch ohne affected) alle", () => {
        const wege = ["paths", "path-labels"];
        expect(quellenFuer([{ kind: "path", id: "a", revision: 2 }], { path: wege })).toEqual(wege);
        expect(quellenFuer([{ kind: "path" }, { kind: "place" }], { path: wege })).toBeUndefined();
        expect(quellenFuer(undefined, { path: wege })).toBeUndefined();
        expect(quellenFuer([], { path: wege })).toBeUndefined();
    });

    it("🔴 quellenFuer: eine Landschaftsänderung lädt nur die Quellen der Derographie, gemischt die Vereinigung; ein Ort alle", () => {
        const derographie = ["landscapes", "landscape-runs", "map-labels", "gewaesser", "gipfel"];
        const nachArt = { path: ["paths", "path-labels"], region: derographie, area: derographie, label: derographie };
        expect(quellenFuer([{ kind: "region" }, { kind: "area" }, { kind: "label" }], nachArt)).toEqual(derographie);
        expect(quellenFuer([{ kind: "region" }, { kind: "path" }], nachArt)).toEqual([
            ...derographie,
            "paths",
            "path-labels",
        ]);
        expect(quellenFuer([{ kind: "region" }, { kind: "place" }], nachArt)).toBeUndefined();
        // Ein geerbter Name ist keine Art.
        expect(quellenFuer([{ kind: "toString" }], nachArt)).toBeUndefined();
    });

    it("🔴 10 fremde Wegänderungen in 20 s: höchstens 7-mal angewandt, nur Wege, am Ende die letzte Revision", () => {
        let jetzt = 0;
        const uhren: { at: number; fn: () => void }[] = [];
        const angewandt: { revision: number; nur: readonly string[] | undefined }[] = [];
        const drossel = createRevisionsDrossel({
            abstandMs: 3000,
            anwenden: (revision, nur) => angewandt.push({ revision, nur }),
            now: () => jetzt,
            setTimeout: (fn, ms) => uhren.push({ at: jetzt + ms, fn }),
        });
        const bis = (t: number): void => {
            for (;;) {
                uhren.sort((a, b) => a.at - b.at);
                const naechste = uhren[0];
                if (naechste === undefined || naechste.at > t) break;
                uhren.shift();
                jetzt = naechste.at;
                naechste.fn();
            }
            jetzt = t;
        };
        for (let k = 0; k < 10; k++) {
            bis(k * 2000);
            drossel.melde(100 + k, ["paths", "path-labels"]);
        }
        bis(30_000);
        expect(angewandt.length).toBeLessThanOrEqual(7);
        expect(angewandt.at(-1)?.revision).toBe(109);
        expect(angewandt.every((a) => a.nur?.join() === "paths,path-labels")).toBe(true);
    });

    it("die Drossel fasst zusammen: höchste Revision, Quellen aller Ereignisse; eines ohne Quellen heißt alle", () => {
        let jetzt = 0;
        const uhren: (() => void)[] = [];
        const angewandt: { revision: number; nur: readonly string[] | undefined }[] = [];
        const drossel = createRevisionsDrossel({
            abstandMs: 3000,
            anwenden: (revision, nur) => angewandt.push({ revision, nur }),
            now: () => jetzt,
            setTimeout: (fn) => uhren.push(fn),
        });
        drossel.melde(5, ["paths"]);
        expect(angewandt).toEqual([]);
        jetzt = 3000;
        uhren.shift()?.();
        expect(angewandt).toEqual([{ revision: 5, nur: ["paths"] }]);
        jetzt = 4000;
        drossel.melde(7, ["paths"]);
        drossel.melde(6, ["places"]);
        expect(angewandt).toHaveLength(1);
        jetzt = 7000;
        uhren.shift()?.();
        expect(angewandt[1]).toEqual({ revision: 7, nur: ["paths", "places"] });
        jetzt = 8000;
        drossel.melde(8, ["paths"]);
        drossel.melde(9, undefined);
        jetzt = 11_000;
        uhren.shift()?.();
        expect(angewandt[2]).toEqual({ revision: 9, nur: undefined });
    });
});

/**
 * Fund der Sichtprüfung WI-0261 S5d2 (2026-10-30): Nach „Fertig“ einer Farbe trug die Quelle `sprachen` `?r=` der neuen Revision und zeigte
 * doch die alte Farbe. MapLibre 6.10 hält den Verwalter einer Quelle an, wenn sich an einer ihrer Ebenen eine datengetriebene Eigenschaft
 * ändert (die Farbvorschau ging im selben Takt zurück auf `["get", "farbe"]`), und verwirft in dieser Zeit den Inhalt von `setTiles`. Die
 * Attrappe spielt genau das nach: Ereignisse `sourcedata` und `render`, der Verwalter mit `_paused`.
 */
describe("Ein angehaltener Kachelverwalter verliert das Neuladen nicht (WI-0261 S5d2)", () => {
    const quellen = {
        sprachen: "/tiles/vector/sprache_flaeche_render/{z}/{x}/{y}",
        "sprachen-misch": "/tiles/vector/sprache_misch_render/{z}/{x}/{y}",
    };
    const ohneUhr = { setTimeout: () => 0, clearTimeout: () => undefined };
    function ereignisKarte() {
        const hoerer = new Map<string, Set<(e: unknown) => void>>();
        const verwalter: Record<string, { _paused?: boolean }> = { sprachen: {}, "sprachen-misch": {} };
        const setTiles = { sprachen: vi.fn(), "sprachen-misch": vi.fn() };
        const refreshTiles = vi.fn();
        const map = {
            style: { tileManagers: verwalter },
            getSource: (id: string) =>
                id in setTiles ? { setTiles: setTiles[id as keyof typeof setTiles] } : undefined,
            on(typ: string, f: (e: unknown) => void) {
                const menge = hoerer.get(typ) ?? new Set();
                menge.add(f);
                hoerer.set(typ, menge);
                return map;
            },
            off(typ: string, f: (e: unknown) => void) {
                hoerer.get(typ)?.delete(f);
                return map;
            },
            once(typ: string, f: (e: unknown) => void) {
                const einmal = (e: unknown): void => {
                    map.off(typ, einmal);
                    f(e);
                };
                return map.on(typ, einmal);
            },
            refreshTiles,
            triggerRepaint: vi.fn(),
        };
        const feuere = (typ: string, e: unknown = {}): void => {
            for (const f of [...(hoerer.get(typ) ?? [])]) f(e);
        };
        const inhalt = (sourceId: string) => ({ sourceId, sourceDataType: "content", sourceDataChanged: true });
        return { map: map as unknown as MapLibreMap, verwalter, setTiles, refreshTiles, feuere, inhalt, hoerer };
    }

    it("🔴 war der Verwalter beim Inhalt von setTiles angehalten, holt advance die Kacheln nach dem nächsten Bild frisch", () => {
        const revision = createEditRevision(quellen, ohneUhr);
        const k = ereignisKarte();
        revision.advance(k.map, 1134, ["sprachen", "sprachen-misch"]);
        expect(k.setTiles.sprachen).toHaveBeenCalledWith([`${quellen.sprachen}?r=1134`]);
        // Die Vorschau setzt im selben Takt eine datengetriebene Farbe an „sprachen“: MapLibre hält deren Verwalter an, nicht den der Schraffur.
        k.verwalter["sprachen"]!._paused = true;
        k.feuere("sourcedata", k.inhalt("sprachen"));
        k.feuere("sourcedata", k.inhalt("sprachen-misch"));
        expect(k.refreshTiles).not.toHaveBeenCalled();
        // Das nächste Bild: noch angehalten, es wartet; im übernächsten läuft er wieder.
        k.feuere("render");
        expect(k.refreshTiles).not.toHaveBeenCalled();
        k.verwalter["sprachen"]!._paused = false;
        k.feuere("render");
        expect(k.refreshTiles).toHaveBeenCalledExactlyOnceWith("sprachen");
        k.feuere("render");
        expect(k.refreshTiles).toHaveBeenCalledOnce();
        // Kein Wächter bleibt hängen.
        expect(k.hoerer.get("sourcedata")?.size ?? 0).toBe(0);
    });

    it("lief der Verwalter, lädt nichts doppelt; fremde Quellen und Inhalt ohne neue Adresse wecken den Wächter nicht", () => {
        const revision = createEditRevision(quellen, ohneUhr);
        const k = ereignisKarte();
        revision.advance(k.map, 7, ["sprachen"]);
        k.verwalter["sprachen"]!._paused = true;
        k.feuere("sourcedata", k.inhalt("sprachen-misch"));
        k.feuere("sourcedata", { sourceId: "sprachen", sourceDataType: "metadata" });
        k.feuere("sourcedata", { sourceId: "sprachen", sourceDataType: "content", sourceDataChanged: false });
        expect(k.hoerer.get("sourcedata")?.size).toBe(1);
        k.verwalter["sprachen"]!._paused = false;
        k.feuere("sourcedata", k.inhalt("sprachen"));
        k.feuere("render");
        expect(k.refreshTiles).not.toHaveBeenCalled();
        expect(k.hoerer.get("sourcedata")?.size ?? 0).toBe(0);
    });

    it("eine neue Revision ersetzt den wartenden Wächter derselben Quelle", () => {
        const revision = createEditRevision(quellen, ohneUhr);
        const k = ereignisKarte();
        revision.advance(k.map, 8, ["sprachen"]);
        revision.advance(k.map, 9, ["sprachen"]);
        expect(k.hoerer.get("sourcedata")?.size).toBe(1);
        expect(k.setTiles.sprachen).toHaveBeenLastCalledWith([`${quellen.sprachen}?r=9`]);
    });
});
