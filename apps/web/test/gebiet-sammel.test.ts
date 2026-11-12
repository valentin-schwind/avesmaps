import { describe, expect, it, vi } from "vitest";
import { TERRITORY_SAMMEL_MAX, type EditorTerritoryRow } from "@avesmaps3d/shared";
import {
    createGebietSammel,
    sammelKoerper,
    sammelWikiLage,
    sammelWikiWert,
    untergebieteHoch,
} from "../src/gebietseditor/gebiet-sammel.ts";

/**
 * Die Mehrfachauswahl der Herrschaftsgebiete (EDIT-0003 T57, Fassung 5). Problemfälle: „Fertig“ schickt unveränderte Felder mit oder
 * schreibt ohne gelesene Revision; „keins“ als Obergebiet geht verloren; ein Wiki-Feld zeigt einen Wert, wo die Gebiete verschiedene
 * tragen; ↺ bleibt wach, obwohl keines einen eigenen Wert hat, oder streicht einen Wiki-Wert durch, der nicht an allen derselbe ist.
 */
const STAND = {
    territories: [
        { id: "g1", revision: 4, details: {} },
        { id: "g2", revision: 9, status: "Lehen", details: {} },
    ],
};

describe("„Fertig“ der Gebiete-Mehrfachauswahl", () => {
    it("🔴 schickt nur Geändertes, je Gebiet gegen seine gelesene Revision; „keins“ ist die Wurzel", () => {
        expect(
            sammelKoerper(
                ["g1", "g2"],
                {
                    felder: { status: "Allod", parent: null, color: "#AABBCC", zoom: { von: 4, bis: undefined } },
                    wiki: [],
                },
                "op",
                STAND,
            ),
        ).toEqual({
            operationId: "op",
            territories: [
                { id: "g1", baseRevision: 4 },
                { id: "g2", baseRevision: 9 },
            ],
            changes: { status: "Allod", parent: "" },
            color: "#aabbcc",
            zoom: { minZoom: 4 },
        });
        expect(sammelKoerper(["g1"], { felder: { type: "Mark" }, wiki: ["ruler"] }, "op", STAND)).toEqual({
            operationId: "op",
            territories: [{ id: "g1", baseRevision: 4 }],
            changes: { type: "Mark" },
            wiki: ["ruler"],
        });
    });

    it("🔴 ohne gelesene Revision eines Gebiets schreibt es nicht", () => {
        expect(sammelKoerper(["g1", "g3"], { felder: { type: "Mark" }, wiki: [] }, "op", STAND)).toBeUndefined();
    });
});

describe("Wiki-Felder über alle gewählten", () => {
    const eigen = { value: "Baron Eigen", origin: "override" as const, wiki: "Baron Wiki" };
    const folgt = { value: "Baron Wiki", origin: "wiki" as const, wiki: "Baron Wiki" };

    it("🔴 gleich mit Wert oder gemischt; ↺ für alle zählt an den eigenen den Wiki-Wert", () => {
        expect(sammelWikiWert([folgt, folgt], false)).toEqual({ gleich: true, wert: "Baron Wiki" });
        expect(sammelWikiWert([eigen, folgt], false)).toEqual({ gleich: false });
        expect(sammelWikiWert([eigen, folgt], true)).toEqual({ gleich: true, wert: "Baron Wiki" });
        // Ohne Wert an beiden: gleich, leer.
        expect(sammelWikiWert([undefined, undefined], false)).toEqual({ gleich: true, wert: "" });
    });

    it("🔴 ↺ ist wach, solange eines einen eigenen Wert trägt; durchgestrichen nur ein Wiki-Wert, den alle teilen", () => {
        expect(sammelWikiLage([eigen, folgt], false)).toEqual({
            zustand: "weicht",
            abweichend: true,
            wikiText: "Baron Wiki",
            zurueck: true,
            mitZurueck: true,
        });
        expect(sammelWikiLage([eigen, { value: "X", origin: "wiki", wiki: "X" }], false)).toEqual({
            zustand: "weicht",
            abweichend: false,
            zurueck: true,
            mitZurueck: true,
        });
        expect(sammelWikiLage([folgt, undefined], false)).toMatchObject({ zurueck: false });
        expect(sammelWikiLage([eigen, folgt], true)).toMatchObject({ zustand: "folgt", zurueck: false });
    });
});

describe("Über der Grenze nie still scheitern (Betreiber 2026-10-20: „Die gewählten Gebiete konnten nicht gelesen werden.“)", () => {
    const ids = (n: number) =>
        Array.from({ length: n }, (_, i) => `a4a4a4a4-0000-4000-8000-${i.toString(16).padStart(12, "0")}`);

    it("🔴 über TERRITORY_SAMMEL_MAX sagt die Mehrfachauswahl den Grund, liest nichts und schickt nichts", async () => {
        const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
        const sammel = createGebietSammel(ids(TERRITORY_SAMMEL_MAX + 1), fetcher, { geschrieben: vi.fn() });
        await sammel.neuLesen();
        expect(sammel.grenze).toContain("4.096");
        expect(sammel.grenze).toContain("4.097");
        expect(await sammel.entferne("retire")).toEqual({ ok: false, satz: sammel.grenze });
        expect(fetcher).not.toHaveBeenCalled();
        expect(sammel.lesefehler.value).toBe(false);
        sammel.destroy();
    });

    it("🔴 700 angehakt (über der alten Grenze 512): gelesen wird wie immer", async () => {
        const fetcher = vi.fn(async () => new Response(JSON.stringify({ territories: [] }), { status: 200 }));
        const sammel = createGebietSammel(ids(700), fetcher, { geschrieben: vi.fn() });
        await sammel.neuLesen();
        expect(sammel.grenze).toBeUndefined();
        expect(fetcher).toHaveBeenCalled();
        sammel.destroy();
    });
});

describe("🔴 Entfernen mehrerer Gebiete: wessen Untergebiete rücken hoch (Fund 2026-10-25, Thorwal mit elf Untergebieten)", () => {
    const g = (id: string, name: string, parent?: string): EditorTerritoryRow =>
        ({ id, name, ...(parent === undefined ? {} : { parent }) }) as EditorTerritoryRow;
    const ALLE: EditorTerritoryRow[] = [
        g("thorwal", "Thorwal"),
        ...Array.from({ length: 10 }, (_, i) => g("jarl" + String(i), "Jarltum " + String(i), "thorwal")),
        g("nordhjaldor", "Nordhjaldor", "thorwal"),
        g("orkreich", "Orkreich"),
        g("ork1", "Orkland", "orkreich"),
        g("test1", "Neues Herrschaftsgebiet", "thorwal"),
        g("test2", "Neues Herrschaftsgebiet 2", "test1"),
        g("frei", "Neues Herrschaftsgebiet 3"),
        { ...g("alt", "Baronie Alt", "orkreich"), deleted: true },
    ];
    const wahl = (...ids: string[]): EditorTerritoryRow[] => ALLE.filter((z) => ids.includes(z.id));

    it("nennt Gebiet und Zahl der nicht gewählten unmittelbaren Untergebiete, die meisten zuerst", () => {
        // Thorwal hat zehn Jarltümer und Nordhjaldor (11); test1 ist sein Kind, aber gewählt, und zählt nicht. test1 hat test2.
        expect(untergebieteHoch(wahl("orkreich", "thorwal", "test1", "frei"), ALLE)).toEqual([
            { id: "thorwal", name: "Thorwal", n: 11 },
            { id: "orkreich", name: "Orkreich", n: 1 },
            { id: "test1", name: "Neues Herrschaftsgebiet", n: 1 },
        ]);
    });

    it("wer nur Gebiete ohne nicht gewählte Untergebiete wählt, bekommt keinen Hinweis; ein gewähltes Untergebiet zählt nicht", () => {
        expect(untergebieteHoch(wahl("test2", "frei"), ALLE)).toEqual([]);
        // Ein ganz gelöschtes Untergebiet rückt nicht hoch.
        expect(untergebieteHoch([...wahl("orkreich"), ...wahl("ork1")], ALLE)).toEqual([]);
        expect(untergebieteHoch(wahl("orkreich", "ork1"), ALLE)).toEqual([]);
    });
});
