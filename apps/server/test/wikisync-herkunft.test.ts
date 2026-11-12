import {
    WIKISYNC_EIGENTUEMER,
    WIKISYNC_WIRKUNG,
    type WikisyncEigentuemer,
    type WikisyncWirkung,
} from "@avesmaps3d/shared";
import { describe, expect, it } from "vitest";
import {
    leiteEigentuemerAb,
    leiteWirkungAb,
    leiteZuweisungsEigentuemerAb,
    vermerkAus,
    zuweisungsHerkunftAus,
    zuweisungszustandAus,
    type FeldWertZustand,
    type HerkunftsEingabe,
    type Vermerk,
    type Zuweisungszustand,
} from "../src/wiki/abgleich/herkunft.ts";

/**
 * Die Ableitungstabelle der Herkunft (WI-0253 C): aus den drei Orten, an denen die Datenbank Herkunft führt, EINER von sechs Eigentümern, und was jeder
 * Eigentümer für die Wirkung bedeutet.
 *
 * - **Soll:** jede Zeile der Tabelle in `herkunft.ts` als ein Fall; die sechs Eigentümer × ihre Wirkung.
 * - **Problemfälle:** „unbekannt“ ist weder NULL noch leer (ein Wert ohne Vermerk ist unbekannt, ein Feld ohne Wert hat nichts zu schützen, ein BEWUSST leeres
 *   Feld gilt nur mit dem Vermerk `manual`); eine getrennte oder unterdrückte Zuordnung gewinnt gegen jeden Vermerk; der Legacy-Bereich nimmt dem WikiSync nur
 *   die wiki-eigenen Felder, nie die Entscheidungen der Redaktion.
 */

const eingabe = (teil: Partial<HerkunftsEingabe>): HerkunftsEingabe => ({
    zuweisung: "zugewiesen",
    wert: "text",
    vermerk: "wiki",
    bereichBeiLegacy: false,
    ...teil,
});

describe("Eigentümer eines Felds", () => {
    it.each<[string, Partial<HerkunftsEingabe>, WikisyncEigentuemer]>([
        ["1 getrennte Zuordnung gewinnt gegen jeden Vermerk", { zuweisung: "getrennt", vermerk: "manual" }, "getrennt"],
        [
            "2 unterdrückte Zuordnung gewinnt gegen jeden Vermerk",
            { zuweisung: "unterdrueckt", vermerk: "wiki" },
            "unterdrueckt",
        ],
        [
            "2 auch gegen einen bewusst leeren Wert",
            { zuweisung: "unterdrueckt", wert: "leer", vermerk: "manual" },
            "unterdrueckt",
        ],
        ["3 bewusst leer mit Vermerk manual: eine eigene Entscheidung", { wert: "leer", vermerk: "manual" }, "manual"],
        [
            "4 bewusst leer ohne Entscheidung ist unbekannt (Vermerk wiki)",
            { wert: "leer", vermerk: "wiki" },
            "unbekannt",
        ],
        ["4 bewusst leer ohne Vermerk ist unbekannt", { wert: "leer", vermerk: "kein" }, "unbekannt"],
        ["5 Vermerk manual", { vermerk: "manual" }, "manual"],
        [
            "5 Vermerk manual bleibt manual, auch im Legacy-Bereich",
            { vermerk: "manual", bereichBeiLegacy: true },
            "manual",
        ],
        ["6 Vermerk wiki folgt dem Wiki", { vermerk: "wiki" }, "wiki"],
        [
            "6 Vermerk wiki im Legacy-Bereich gehört dem Legacy-Zug",
            { vermerk: "wiki", bereichBeiLegacy: true },
            "legacy",
        ],
        ["6 ein Feld nur im Schnappschuss (ungeführt) ist wiki-eigen", { vermerk: "ungefuehrt" }, "wiki"],
        ["6 … im Legacy-Bereich gehört es dem Legacy-Zug", { vermerk: "ungefuehrt", bereichBeiLegacy: true }, "legacy"],
        [
            "7 kein Vermerk, kein Wert: nichts zu schützen, das Feld folgt dem Wiki",
            { vermerk: "kein", wert: "kein" },
            "wiki",
        ],
        [
            "7 … im Legacy-Bereich gehört auch das Füllen dem Legacy-Zug",
            { vermerk: "kein", wert: "kein", bereichBeiLegacy: true },
            "legacy",
        ],
        ["8 kein Vermerk, Wert da: die Herkunft ist nicht belegt", { vermerk: "kein", wert: "text" }, "unbekannt"],
        [
            "8 … auch im Legacy-Bereich (der Wert kann von Hand stammen)",
            { vermerk: "kein", wert: "text", bereichBeiLegacy: true },
            "unbekannt",
        ],
    ])("%s", (_name, teil, erwartet) => {
        expect(leiteEigentuemerAb(eingabe(teil))).toBe(erwartet);
    });

    it("🔴 jede der 96 Kombinationen ergibt genau einen der sechs Eigentümer, und nur ein Wert ohne Beleg ist unbekannt", () => {
        const zustaende: Zuweisungszustand[] = ["zugewiesen", "nur_adresse", "getrennt", "unterdrueckt"];
        const werte: FeldWertZustand[] = ["kein", "leer", "text"];
        const vermerke: Vermerk[] = ["wiki", "manual", "kein", "ungefuehrt"];
        let anzahl = 0;
        for (const zuweisung of zustaende)
            for (const wert of werte)
                for (const vermerk of vermerke)
                    for (const bereichBeiLegacy of [false, true]) {
                        anzahl += 1;
                        const eigentuemer = leiteEigentuemerAb({ zuweisung, wert, vermerk, bereichBeiLegacy });
                        expect(WIKISYNC_EIGENTUEMER).toContain(eigentuemer);
                        if (eigentuemer === "unbekannt") {
                            // Unbekannt gibt es nur für einen Wert (Text oder bewusst leer) ohne belegten Vermerk, nie für ein leeres Feld ohne Wert.
                            expect(wert).not.toBe("kein");
                            expect(["zugewiesen", "nur_adresse"]).toContain(zuweisung);
                        }
                        if (zuweisung === "getrennt") expect(eigentuemer).toBe("getrennt");
                        if (zuweisung === "unterdrueckt") expect(eigentuemer).toBe("unterdrueckt");
                        if (eigentuemer === "legacy") expect(bereichBeiLegacy).toBe(true);
                    }
        expect(anzahl).toBe(96);
    });
});

describe("Wirkung je Eigentümer", () => {
    it("🔴 die sechs Eigentümer × ihre Wirkung: nur wiki wird übernommen, nur manual bleibt eigen, alles andere ist ein Befund", () => {
        const erwartet: Record<WikisyncEigentuemer, WikisyncWirkung> = {
            wiki: "uebernommen",
            manual: "eigen",
            legacy: "befund",
            unterdrueckt: "befund",
            getrennt: "befund",
            unbekannt: "befund",
        };
        expect(Object.keys(erwartet).sort()).toEqual([...WIKISYNC_EIGENTUEMER].sort());
        for (const eigentuemer of WIKISYNC_EIGENTUEMER) {
            expect(leiteWirkungAb(eigentuemer), eigentuemer).toBe(erwartet[eigentuemer]);
            expect(WIKISYNC_WIRKUNG).toContain(leiteWirkungAb(eigentuemer));
        }
    });

    it("Ende zu Ende: aus den Eingaben, die zu jedem Eigentümer führen, kommt die Wirkung der Tabelle", () => {
        const faelle: [Partial<HerkunftsEingabe>, WikisyncEigentuemer, WikisyncWirkung][] = [
            [{ vermerk: "wiki" }, "wiki", "uebernommen"],
            [{ vermerk: "manual" }, "manual", "eigen"],
            [{ vermerk: "wiki", bereichBeiLegacy: true }, "legacy", "befund"],
            [{ zuweisung: "unterdrueckt" }, "unterdrueckt", "befund"],
            [{ zuweisung: "getrennt" }, "getrennt", "befund"],
            [{ vermerk: "kein" }, "unbekannt", "befund"],
        ];
        for (const [teil, eigentuemer, wirkung] of faelle) {
            const abgeleitet = leiteEigentuemerAb(eingabe(teil));
            expect(abgeleitet).toBe(eigentuemer);
            expect(leiteWirkungAb(abgeleitet)).toBe(wirkung);
        }
    });
});

describe("Eigentümer der Zuordnung selbst", () => {
    it.each<[Zuweisungszustand, Parameters<typeof leiteZuweisungsEigentuemerAb>[1], WikisyncEigentuemer]>([
        ["getrennt", "editor", "getrennt"],
        ["unterdrueckt", "legacy_editor", "unterdrueckt"],
        ["zugewiesen", "legacy_editor", "legacy"],
        ["zugewiesen", "legacy_verlauf_sync", "legacy"],
        ["nur_adresse", "editor", "manual"],
        ["zugewiesen", "wiki_sync", "wiki"],
        ["zugewiesen", "unknown", "unbekannt"],
        ["zugewiesen", "bulk", "unbekannt"],
        ["zugewiesen", null, "unbekannt"],
    ])("%s / %s -> %s", (zustand, herkunft, erwartet) => {
        expect(leiteZuweisungsEigentuemerAb(zustand, herkunft)).toBe(erwartet);
    });
});

describe("Die Wörter der Datenbank", () => {
    it("assignment_state, assignment_origin und die drei Vermerk-Spalten", () => {
        expect(zuweisungszustandAus("assigned")).toBe("zugewiesen");
        expect(zuweisungszustandAus("address_only")).toBe("nur_adresse");
        expect(zuweisungszustandAus("separated")).toBe("getrennt");
        expect(zuweisungszustandAus("suppressed")).toBe("unterdrueckt");
        expect(zuweisungsHerkunftAus("legacy_editor")).toBe("legacy_editor");
        expect(zuweisungsHerkunftAus("wiki_sync")).toBe("wiki_sync");
        expect(zuweisungsHerkunftAus("etwas anderes")).toBeNull();
        expect(zuweisungsHerkunftAus(null)).toBeNull();
        // field_origin und place_detail: wiki | manual | NULL; territory_detail_field_origin: wiki | override.
        expect(vermerkAus("wiki")).toBe("wiki");
        expect(vermerkAus("manual")).toBe("manual");
        expect(vermerkAus("override")).toBe("manual");
        expect(vermerkAus(null)).toBe("kein");
        expect(vermerkAus(undefined)).toBe("kein");
        expect(vermerkAus("")).toBe("kein");
    });
});
