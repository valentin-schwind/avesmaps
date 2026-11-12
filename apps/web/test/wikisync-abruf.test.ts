import { describe, expect, it } from "vitest";
import {
    WIKISYNC_ARTIKEL_URL,
    WIKISYNC_BEREICHE_URL,
    WIKISYNC_BERICHT_URL,
    WIKISYNC_STAND_URL,
    type WikisyncAbruf,
} from "@avesmaps3d/shared";
import { createWikisync } from "../src/wikisync/wikisync.ts";
import { abrufSperre } from "../src/wikisync/wikisync-text.ts";

/**
 * Was vom Wiki-Teil bleibt (WI-0294): Der Reiter liest vier Wege und keinen zum Wiki-Teil mehr, und die Sperre „kein Abruf beim Wiki“ gilt nur noch für den Vergleich EINES Artikels; die Auskunft
 * dazu kommt mit der Liste der Vergleiche (`GET /api/admin/wikisync/artikel`, Feld `abruf`).
 */

const abruf = (extra: Partial<WikisyncAbruf>): WikisyncAbruf => ({ erlaubt: false, grund: null, text: null, ...extra });

describe("Die Sperre des Einzelartikels (abrufSperre)", () => {
    it("ohne Auskunft oder bei erlaubtem Abruf gibt es keine Sperre", () => {
        expect(abrufSperre(undefined)).toBeUndefined();
        expect(abrufSperre(abruf({ erlaubt: true }))).toBeUndefined();
    });

    it("🔴 lokal (oder ohne genannten Grund) sagt der Satz zur harten Sperre; auf Stage und Production nennt sie den Grund", () => {
        const lokal = "Lokal gibt es keine Wiki-Abrufe: Beim Wiki ist nur die IP des Servers freigegeben.";
        expect(abrufSperre(abruf({ grund: "umgebung" }))).toBe(lokal);
        expect(abrufSperre(abruf({ grund: null }))).toBe(lokal);
        expect(abrufSperre(abruf({ grund: "release" }))).toBe("ohne echtes Release keine Wiki-Abrufe");
        expect(abrufSperre(abruf({ grund: "takt" }))).toBe("ohne Ordner des Takts keine Wiki-Abrufe");
    });
});

describe("Die Lesewege des Reiters", () => {
    it("🔴 load() liest Stand, Bereiche, Berichtskopf und Artikelliste, aber nichts vom Wiki-Teil; die Auskunft zum Abruf kommt aus der Artikelliste", async () => {
        const gelesen: string[] = [];
        const fetcher = (async (url: RequestInfo | URL) => {
            const pfad = String(url);
            gelesen.push(pfad);
            const antwort = pfad.startsWith(WIKISYNC_ARTIKEL_URL)
                ? { jetzt: "2026-11-09T10:00:00.000Z", abruf: abruf({ grund: "umgebung" }), vergleiche: [] }
                : pfad.startsWith(WIKISYNC_STAND_URL)
                  ? { auftraege: [] }
                  : {};
            return new Response(JSON.stringify(antwort), { status: 200 });
        }) as typeof fetch;
        const ws = createWikisync({ fetcher, ask: async () => false });
        await ws.load();
        expect(gelesen).toHaveLength(4);
        expect(gelesen).toEqual(
            expect.arrayContaining([
                WIKISYNC_STAND_URL,
                WIKISYNC_BEREICHE_URL,
                `${WIKISYNC_BERICHT_URL}?limit=1`,
                WIKISYNC_ARTIKEL_URL,
            ]),
        );
        expect(gelesen.some((pfad) => pfad.includes("wiki-teil"))).toBe(false);
        expect(ws.loadProblems.value).toEqual([]);
        expect(abrufSperre(ws.artikel.value?.abruf)).toMatch(/^Lokal gibt es keine Wiki-Abrufe/u);
        expect("wikiTeil" in ws).toBe(false);
    });
});
