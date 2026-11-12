import { describe, expect, it } from "vitest";
import { MAP_VIEWS, SearchHitKind, type SearchHit } from "@avesmaps3d/shared";
import { focusForHit } from "../src/search/search-focus.ts";

/**
 * Was ein Suchtreffer an der Karte umstellt (Betreiberentscheidungen 2026-09-23).
 *
 * 🔴 „Jede Suchklasse braucht ihre bevorzugte Ansicht.“ Ein Treffer schaltet die Karte in die
 * Ansicht, in der er zu sehen ist: Die Standardkarte zeigt keine Klimabänder, die Klimaansicht
 * keine Orte. Sonst landet der Sprung richtig und zeigt nichts. Dieselbe Regel gilt später für
 * politische Gebiete und Kraftlinien.
 */

function treffer(kind: SearchHit["kind"], id: string): SearchHit {
    return { kind, id, name: id, x: 512, y: 276, zoom: 2 };
}

/** Alle Suchklassen, die der Vertrag kennt, aus dem Schema selbst und nicht abgeschrieben. */
const ALLE_KLASSEN = SearchHitKind.anyOf.map((literal) => literal.const);

describe("Wohin ein Suchtreffer die Karte schaltet", () => {
    it("🔴 jede Suchklasse hat eine bevorzugte Ansicht", () => {
        expect(ALLE_KLASSEN.length, "das Schema nennt Klassen").toBeGreaterThan(0);
        for (const kind of ALLE_KLASSEN) {
            const view = focusForHit(treffer(kind, "x")).view;
            expect(MAP_VIEWS, `${kind} braucht eine Ansicht`).toContain(view);
        }
    });

    it("🔴 eine Klimazone schaltet auf Landschaften → Klimazonen und hebt genau diese Zone hervor", () => {
        expect(focusForHit(treffer("klima", "trockene_subtropen"))).toEqual({
            view: "landscapes",
            landscape: "klima",
            climateZone: "trockene_subtropen",
        });
    });

    it("💣 Orte, Wege und Landschaftsnamen schalten zurück auf Standard und löschen die Hervorhebung", () => {
        // Die Gegenrichtung: Wer in der Klimaansicht „Gareth“ sucht, landet sonst dort, wo diese Ansicht
        // keine Orte zeigt. Landschaftsnamen stehen wie in Legacy auf der Standardkarte
        // (spotlight-search-focus.js: „a landscape label is only drawn in deregraphic“).
        for (const kind of ["ort", "weg", "landschaft"] as const) {
            expect(focusForHit(treffer(kind, "x")), kind).toEqual({ view: "standard" });
        }
    });
});
