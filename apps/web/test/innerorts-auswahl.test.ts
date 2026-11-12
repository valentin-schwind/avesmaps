import { describe, expect, it } from "vitest";
import type { EditorSiteCandidate } from "@avesmaps3d/shared";
import {
    KEINE_HANDGRIFFE,
    ZEILEN_MAX,
    gewaehlt,
    hinzufuegenKoerper,
    kandidatSchluessel,
    umschalten,
    zeilen,
} from "../src/ortseditor/innerorts-auswahl.ts";

/**
 * Die Auswahl von „Innerorts hinzufügen“ (WI-0196, EDIT-0003 T33 (3)): Vorauswahl im Umkreis von N Meilen, Handgriffe dagegen,
 * die Liste und der Körper für `site.add`.
 */

const TEMPEL: EditorSiteCandidate = { kind: "kartenpunkt", id: "a", name: "Tempel", type: "Tempel", meilen: 0.3 };
const KONTOR: EditorSiteCandidate = { kind: "staette", id: "7", name: "Kontor", sourceKind: "punkt", meilen: 0.9 };
const TURM: EditorSiteCandidate = { kind: "kartenpunkt", id: "b", name: "Turm", meilen: 6 };
const SITZ: EditorSiteCandidate = { kind: "staette", id: "8", name: "Sitz der Gilde", sourceKind: "sitz" };
const ALLE = [TEMPEL, KONTOR, TURM, SITZ];
const schluessel = (...kandidaten: EditorSiteCandidate[]) => new Set(kandidaten.map(kandidatSchluessel));

describe("Innerorts hinzufügen: die Auswahl", () => {
    it("🔴 vorgewählt ist, was im Umkreis liegt (Vorgabe 1 Meile); ohne Lage nie", () => {
        expect(gewaehlt(ALLE, 1, KEINE_HANDGRIFFE)).toEqual(schluessel(TEMPEL, KONTOR));
        expect(gewaehlt(ALLE, 0.5, KEINE_HANDGRIFFE)).toEqual(schluessel(TEMPEL));
        expect(gewaehlt(ALLE, 10, KEINE_HANDGRIFFE)).toEqual(schluessel(TEMPEL, KONTOR, TURM));
        expect(gewaehlt(ALLE, Number.NaN, KEINE_HANDGRIFFE)).toEqual(new Set());
    });

    it("🔴 Handgriffe überleben einen anderen Umkreis: abgehakt bleibt ab, angehakt bleibt an", () => {
        let handgriffe = umschalten(KONTOR, 1, KEINE_HANDGRIFFE, true);
        handgriffe = umschalten(SITZ, 1, handgriffe, false);
        expect(gewaehlt(ALLE, 1, handgriffe)).toEqual(schluessel(TEMPEL, SITZ));
        expect(gewaehlt(ALLE, 10, handgriffe)).toEqual(schluessel(TEMPEL, TURM, SITZ));
        // Ein zweiter Klick nimmt den Handgriff zurück.
        handgriffe = umschalten(KONTOR, 1, handgriffe, false);
        expect(gewaehlt(ALLE, 1, handgriffe)).toEqual(schluessel(TEMPEL, KONTOR, SITZ));
    });

    it("die Liste: zuerst das Gewählte, dann die Treffer der Suche in Name und Art; höchstens ZEILEN_MAX", () => {
        const wahl = schluessel(KONTOR);
        expect(zeilen(ALLE, wahl, "").zeilen.map((kandidat) => kandidat.name)).toEqual([
            "Kontor",
            "Tempel",
            "Turm",
            "Sitz der Gilde",
        ]);
        expect(zeilen(ALLE, wahl, "gilde").zeilen.map((kandidat) => kandidat.name)).toEqual([
            "Kontor",
            "Sitz der Gilde",
        ]);
        const viele = Array.from({ length: ZEILEN_MAX + 5 }, (_, n) => ({ ...SITZ, id: String(n + 10) }));
        expect(zeilen(viele, new Set(), "").weitere).toBe(5);
    });

    it("🔴 der Körper für site.add trennt Stätten (site.id) und Kartenpunkte (public_id)", () => {
        expect(hinzufuegenKoerper(ALLE, schluessel(TEMPEL, KONTOR, SITZ), "op")).toEqual({
            operationId: "op",
            sites: ["7", "8"],
            places: ["a"],
        });
    });
});
