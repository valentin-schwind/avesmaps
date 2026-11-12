import { describe, expect, it } from "vitest";
import type { MamKarteDetail, SearchHit } from "@avesmaps3d/shared";
import {
    ORTE_TREFFER_MAX,
    hinweisText,
    ortZeilen,
    schonAngehaengt,
    trefferAusSuche,
    zielSchluessel,
    zielZeile,
} from "../src/medien/medien-karte-orte-modell";
import { leererKartenStand, neuerEintragAnfrage, ortZiele } from "../src/medien/medien-karte-neu-modell";

const ID = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
type Ort = MamKarteDetail["places"][number];

const treffer = (hit: Partial<SearchHit> & Pick<SearchHit, "kind" | "id" | "name">): SearchHit => ({
    x: 0,
    y: 0,
    zoom: 3,
    ...hit,
});

describe("Orte und Regionen am Eintrag der Kartensammlung: die zweite Zeile (WI-0287 Stufe 3)", () => {
    it("Art und Gruppe, bei gleicher Art und Gruppe oder ohne Art nur die Gruppe", () => {
        expect(zielZeile("region", "kueste")).toBe("Küste · Region");
        expect(zielZeile("place", "dorf")).toBe("Dorf · Ort");
        // Legacy-Zeilen führen keine Art: nur die Gruppe, nie ein roher Schlüssel.
        expect(zielZeile("territory", null)).toBe("Herrschaftsgebiet");
        expect(zielZeile("terrain_peak", null)).toBe("Gipfel");
        expect(zielZeile("path", null)).toBe("Weg");
        expect(zielZeile("region", "gibt-es-nicht")).toBe("Region");
        expect(zielZeile("region", undefined)).toBe("Region");
        expect(zielZeile("region", "region")).toBe("Region");
    });

    it("die Zeilen des Kastens: Name des Ziels sonst der Rohname; nicht aufgelöst ohne zweite Zeile; „Auf Karte zeigen“ nur für Orte und Herrschaftsgebiete", () => {
        const orte: Ort[] = [
            {
                name: "Siebenwind-Küste (roh)",
                target: { kind: "region", id: ID(1), name: "Siebenwind-Küste", active: true, type: "kueste" },
                targetState: "resolved",
            },
            {
                name: "Porto Paligan",
                target: { kind: "place", id: ID(2), name: "Porto Paligan", active: true, type: "stadt" },
                targetState: "resolved",
            },
            {
                name: "Fürstentum",
                target: { kind: "territory", id: ID(3), name: "Fürstentum Albernia", active: true },
                targetState: "resolved",
            },
            {
                name: "Alt",
                target: { kind: "place", id: ID(4), name: "Alt", active: false, type: "dorf" },
                targetState: "resolved",
            },
            { name: "Siebenwindküste", target: null, targetState: "unmatched" },
        ];
        const zeilen = ortZeilen(orte);
        expect(zeilen.map((z) => [z.index, z.name, z.zeile2, z.aufgeloest, z.aufKarte?.kind ?? null])).toEqual([
            [0, "Siebenwind-Küste", "Küste · Region", true, "region"],
            [1, "Porto Paligan", "Stadt · Ort", true, "place"],
            [2, "Fürstentum Albernia", "Herrschaftsgebiet", true, "territory"],
            [3, "Alt", "Dorf · Ort", true, null],
            [4, "Siebenwindküste", null, false, null],
        ]);
        expect(zeilen[4]!.rohname).toBe("Siebenwindküste");
        expect([...schonAngehaengt(orte)].sort()).toEqual(
            [
                zielSchluessel("region", ID(1)),
                zielSchluessel("place", ID(2)),
                zielSchluessel("territory", ID(3)),
                zielSchluessel("place", ID(4)),
            ].sort(),
        );
    });
});

describe("Orte und Regionen am Eintrag der Kartensammlung: die Trefferauswahl (WI-0287 Stufe 3)", () => {
    it("Orte und Regionen, nur mit öffentlicher Kennung; bei einer Landschaft zählt die Region, nicht das Label", () => {
        const liste = trefferAusSuche(
            [
                treffer({ kind: "ort", id: ID(1), name: "Havena", subtype: "metropole" }),
                // Ein Label mit Region: Ziel ist die Region.
                treffer({ kind: "landschaft", id: ID(20), name: "Siebenwind-Küste", subtype: "kueste", region: ID(2) }),
                // Ein freies Label ohne Region ist kein Ziel.
                treffer({ kind: "landschaft", id: ID(21), name: "Freies Label" }),
                // Wege und Klimazonen gehören nicht in die Liste.
                treffer({ kind: "weg", id: "name:Reichsstraße 1", name: "Reichsstraße 1" }),
                treffer({ kind: "klima", id: "gemaessigt", name: "gemäßigt" }),
                // Keine öffentliche Kennung.
                treffer({ kind: "ort", id: "kein-uuid", name: "Kaputt" }),
                // Eine Landschaft ohne eigenes Label: id und Region sind dieselbe Region.
                treffer({ kind: "landschaft", id: ID(3), name: "Khôm", subtype: "wueste", region: ID(3) }),
            ],
            new Set(),
        );
        expect(liste).toEqual([
            { kind: "place", id: ID(1), name: "Havena", zeile2: "Metropole · Ort", schon: false },
            { kind: "region", id: ID(2), name: "Siebenwind-Küste", zeile2: "Küste · Region", schon: false },
            { kind: "region", id: ID(3), name: "Khôm", zeile2: "Wüste · Region", schon: false },
        ]);
    });

    it("schon angehängte stehen gesperrt (nicht entfernt); höchstens acht", () => {
        const viele = Array.from({ length: 12 }, (_, i) =>
            treffer({ kind: "ort", id: ID(100 + i), name: `Ort ${String(i)}`, subtype: "dorf" }),
        );
        const liste = trefferAusSuche(viele, new Set([zielSchluessel("place", ID(100))]));
        expect(liste).toHaveLength(ORTE_TREFFER_MAX);
        expect(liste[0]).toMatchObject({ id: ID(100), schon: true });
        expect(liste.slice(1).every((eintrag) => !eintrag.schon)).toBe(true);
        // Ort und Region mit derselben Kennung sind verschiedene Ziele.
        const beides = trefferAusSuche(
            [treffer({ kind: "landschaft", id: ID(5), name: "X", region: ID(5) })],
            new Set([zielSchluessel("place", ID(5))]),
        );
        expect(beides[0]!.schon).toBe(false);
    });

    it("die Hinweise nach dem Speichern, wörtlich", () => {
        expect(hinweisText({ art: "gespeichert", name: "Siebenwind-Küste", kind: "region" })).toBe(
            "Gespeichert. Die Karte steht jetzt in der Infobox von „Siebenwind-Küste“ und im Derographie-Editor im Reiter „Karten“.",
        );
        expect(hinweisText({ art: "gespeichert", name: "Havena", kind: "place" })).toBe(
            "Gespeichert. Die Karte steht jetzt in der Infobox von „Havena“ und im Ortseditor im Reiter „Karten“.",
        );
        expect(hinweisText({ art: "geloest", name: "Havena" })).toBe(
            "Gelöst. Die Karte steht nicht mehr in der Infobox von „Havena“.",
        );
        expect(hinweisText({ art: "geloestOffen", name: "Siebenwindküste" })).toBe(
            "Gelöst. Der Name „Siebenwindküste“ passte zu nichts.",
        );
    });
});

describe("Neuer Eintrag: Regionen gehen als `targets` in der gewählten Folge (WI-0287 Stufe 3)", () => {
    it("nur Orte: `places` wie bisher, ohne `targets`", () => {
        expect(
            ortZiele([
                { id: "a", name: "A" },
                { id: "b", name: "B", kind: "place" },
            ]),
        ).toEqual({ places: ["a", "b"] });
        expect(ortZiele([])).toEqual({ places: [] });
    });

    it("mit einer Region: alle als `targets`, `places` bleibt leer", () => {
        const anfrage = neuerEintragAnfrage("Siebenwindküste", leererKartenStand(), [
            { id: "ort-1", name: "Havena" },
            { id: "region-1", name: "Siebenwind-Küste", kind: "region" },
            { id: "ort-2", name: "Gareth", kind: "place" },
        ]).anfrage;
        expect(anfrage).toMatchObject({
            places: [],
            targets: [
                { kind: "place", id: "ort-1" },
                { kind: "region", id: "region-1" },
                { kind: "place", id: "ort-2" },
            ],
        });
    });
});
