import { describe, expect, it } from "vitest";
import type { SubjectRef } from "@avesmaps3d/shared";
import {
    canonicalWikiKey,
    lookupWikiKey,
    pageKeysOf,
    type WikiKeyKind,
    type WikiKeyLookup,
    type WikiKeyTarget,
} from "../src/subjects/wiki-key-lookup.ts";

/**
 * Die Zuordnung „Wiki-Key → Kartenobjekt“ (WI-0063 27.12, Betreiber 2026-10-05, AGENTS.md „Karteninteraktion“): Ein Linkziel wird nur ein Link, wenn sein
 * KANONISCHER Key - den Legacy in Export X1 für das Ziel liefert und in Export X2 für jedes zugewiesene Objekt - genau ein Objekt der Karte trägt. Ein Name
 * macht nie einen Link, auch kein eindeutiger. Die reinen Fälle stehen hier ohne Datenbank; wie der Lookup aus der Zuordnungstafel entsteht, prüft
 * `subject-text-links.test.ts` gegen PostgreSQL, wie ein Link an seine Stelle im Text kommt `link-pieces.test.ts`, und dass der Linkpfad keinen Namen mehr kennt
 * `link-path-by-key.test.ts`.
 */

const id = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const place = (n: number): SubjectRef => ({ kind: "place", id: id(n) });
const territory = (n: number): SubjectRef => ({ kind: "territory", id: id(n) });
const road = (n: number): SubjectRef => ({ kind: "path", anchor: id(n), wiki: `wiki-key-${String(n)}` });

/** Ein Lookup aus der Zuordnung: je kanonischem Key die Objekte, denen er zugewiesen ist. */
function lookupOf(
    assignments: Record<string, [WikiKeyKind, SubjectRef][]>,
    pageKeys: Record<string, string> = {},
): WikiKeyLookup {
    const byKey = new Map<string, WikiKeyTarget[]>();
    for (const [key, targets] of Object.entries(assignments)) {
        byKey.set(
            canonicalWikiKey(key),
            targets.map(([kind, ref]) => ({ kind, ref })),
        );
    }
    return { byKey, pageKeys: new Map(Object.entries(pageKeys)) };
}

describe("Zuordnung eines Wiki-Keys (lookupWikiKey)", () => {
    const lookup = lookupOf({
        "wiki:reichsstrasse-2": [["path", road(1)]],
        "wiki:fasar": [
            ["place", place(2)],
            ["territory", territory(3)],
        ],
        "wiki:rathila": [
            ["place", place(4)],
            ["place", place(5)],
        ],
    });

    it("ein Objekt mit genau diesem Key ist ein Treffer", () => {
        expect(lookupWikiKey(lookup, "wiki:reichsstrasse-2")).toEqual({ kind: "one", ref: road(1) });
    });

    it("🔴 zwei Objekte mit demselben Key sind mehrdeutig, auch wenn es zwei Arten sind: kein Link, nichts wird gewählt", () => {
        expect(lookupWikiKey(lookup, "wiki:fasar")).toEqual({ kind: "many" });
        expect(lookupWikiKey(lookup, "wiki:rathila")).toEqual({ kind: "many" });
    });

    it("ein Key ohne Objekt und der leere Key sind keine Treffer", () => {
        expect(lookupWikiKey(lookup, "wiki:gibtesnicht")).toEqual({ kind: "none" });
        expect(lookupWikiKey(lookup, "")).toEqual({ kind: "none" });
    });

    it("🔴 der Key ist der kanonische von Legacy und wird nicht umgeschrieben: andere Schreibweisen derselben Seite treffen NICHT", () => {
        // Ein Titel, ein Name oder ein Schlüssel in anderer Schreibweise ist kein Key; der Lookup normalisiert nicht, er vergleicht wörtlich.
        for (const spelling of [
            "reichsstrasse-2",
            "Reichsstraße 2",
            "wiki:Reichsstrasse-2",
            "wiki:reichsstrasse2",
            "reichsstrasse2",
        ]) {
            expect(lookupWikiKey(lookup, spelling), spelling).toEqual({ kind: "none" });
        }
    });

    it("🔴 der Namensraum gehört zum Key: „Inoffiziell:Dju'imen“ und „Dju'imen“ sind zwei Artikel, zwei Keys, zwei Objekte - keine Mehrdeutigkeit, kein Abschneiden", () => {
        const both = lookupOf({
            "wiki:dju-imen": [["place", place(7)]],
            "wiki:inoffiziell-dju-imen": [["place", place(8)]],
        });
        expect(both.byKey.size).toBe(2);
        expect(lookupWikiKey(both, "wiki:dju-imen")).toEqual({ kind: "one", ref: place(7) });
        expect(lookupWikiKey(both, "wiki:inoffiziell-dju-imen")).toEqual({ kind: "one", ref: place(8) });
        // Trägt nur der inoffizielle Artikel ein Objekt, trifft der offizielle Key NICHT dieses (das Präfix wird nie abgeschnitten) - und umgekehrt.
        const onlyUnofficial = lookupOf({ "wiki:inoffiziell-dju-imen": [["place", place(8)]] });
        expect(lookupWikiKey(onlyUnofficial, "wiki:dju-imen")).toEqual({ kind: "none" });
        const onlyOfficial = lookupOf({ "wiki:dju-imen": [["place", place(7)]] });
        expect(lookupWikiKey(onlyOfficial, "wiki:inoffiziell-dju-imen")).toEqual({ kind: "none" });
    });

    it("🔴 eine andere Seite ist ein anderer Key: Reichsstraße 12 ist nicht Reichsstraße 2", () => {
        expect(lookupWikiKey(lookup, "wiki:reichsstrasse-12")).toEqual({ kind: "none" });
        expect(lookupWikiKey(lookup, "wiki:reichsstrasse-3")).toEqual({ kind: "none" });
    });

    it("der Umlaut ist im Key schon gefaltet (Legacys Tafel): `wiki:f-rstentum-kosch`, nicht `wiki:fuerstentum-kosch`", () => {
        const kosch = lookupOf({ "wiki:f-rstentum-kosch": [["territory", territory(9)]] });
        expect(lookupWikiKey(kosch, "wiki:f-rstentum-kosch")).toEqual({ kind: "one", ref: territory(9) });
        expect(lookupWikiKey(kosch, "wiki:fuerstentum-kosch")).toEqual({ kind: "none" });
    });
});

describe("Die Stelle der Weiterleitungen (canonicalWikiKey)", () => {
    it("die Identität: Die Keys von X1 und X2 haben die Weiterleitungen schon durchlaufen (`weiterleitung_auf` nennt sie in den Daten)", () => {
        expect(canonicalWikiKey("wiki:ambossgebirge")).toBe("wiki:ambossgebirge");
        expect(canonicalWikiKey("")).toBe("");
    });

    it("ein Link auf eine Weiterleitung („Ambossberge“) trägt den Key der Zielseite und trifft deren Objekt", () => {
        // X1: anzeige „Ambossberge“, ziel „Ambossberge“, ziel_key `wiki:ambossgebirge`; X2: das Objekt der Seite „Ambossgebirge“ trägt denselben Key.
        const lookup = lookupOf({ "wiki:ambossgebirge": [["area", { kind: "area", id: id(10) }]] });
        expect(lookupWikiKey(lookup, "wiki:ambossgebirge")).toEqual({ kind: "one", ref: { kind: "area", id: id(10) } });
    });
});

describe("Die Artikel eines Trägers (pageKeysOf)", () => {
    const lookup = lookupOf(
        {},
        {
            [`place:${id(1)}`]: "wiki:gareth",
            [`path:${id(2)}`]: "wiki:reichsstrasse-2",
            [`path:${id(3)}`]: "wiki:reichsstrasse-2",
            [`path:${id(4)}`]: "wiki:alte-strasse",
            [`area:${id(5)}`]: "wiki:weiden",
        },
    );

    it("liefert den Key des Artikels eines Trägers", () => {
        expect(pageKeysOf(lookup, "place", [id(1)])).toEqual(["wiki:gareth"]);
        expect(pageKeysOf(lookup, "area", [id(5)])).toEqual(["wiki:weiden"]);
    });

    it("die Abschnitte eines Wegs teilen EINEN Artikel: jeder Key einmal, in der Reihenfolge der Abschnitte", () => {
        expect(pageKeysOf(lookup, "path", [id(2), id(3)])).toEqual(["wiki:reichsstrasse-2"]);
        expect(pageKeysOf(lookup, "path", [id(4), id(2), id(3)])).toEqual([
            "wiki:alte-strasse",
            "wiki:reichsstrasse-2",
        ]);
    });

    it("🔴 ein Träger ohne Zuweisung in der Zuordnung hat keinen Artikel: es gibt keinen Key, und es wird keiner geraten", () => {
        expect(pageKeysOf(lookup, "place", [id(99)])).toEqual([]);
        expect(pageKeysOf(lookup, "peak", [id(1)])).toEqual([]);
        expect(pageKeysOf(lookup, "powerline", [])).toEqual([]);
    });
});
