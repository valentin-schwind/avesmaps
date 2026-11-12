import { describe, expect, it } from "vitest";
import {
    berechne,
    fenster,
    gruppenKey,
    nachName,
    nachRang,
    naechsteWahl,
    ohneVerwaiste,
    vorhandeneWerte,
    rollenZu,
    type ListenOptionen,
    type ListenStand,
    type ListenZeile,
} from "../src/editor-liste/liste-modell";

/**
 * Das Listenmodell der Karteninhalte (WI-0128 E5, EDIT-0001 §7.1 E5): Zahlen der Facetten mit allen anderen Filtern, ohne sich
 * selbst (Reiter gibt es seit 2026-10-11 nicht mehr, Betreiber); Bilanzzeile nur bei geänderter Bilanz; Facetten gelten nur, wo sie passen; Pfeile wählen; Formen gruppiert und Baum an einer
 * Testtafel (Gruppe wählt alle Glieder, Baum klappt, Treffer bringen ihre Vorfahren mit).
 */

const zeile = (key: string, name: string, extra: Partial<ListenZeile> = {}): ListenZeile => ({
    key,
    name,
    kreis: "halb",
    facetten: {},
    ...extra,
});

const ORTE: readonly ListenZeile[] = [
    zeile("gratenfels", "Gratenfels", {
        kreis: "voll",
        facetten: { karte: "auf", typ: "stadt", wappen: "ja" },
        rang: { groesse: 3 },
    }),
    zeile("klein", "Klein-Gratenfels", {
        facetten: { karte: "auf", typ: "dorf", wappen: "nein" },
        rang: { groesse: 5 },
    }),
    zeile("tempel", "Dachs Gratenfels", {
        kreis: "leer",
        facetten: { karte: "nicht", typ: "staette", lage: "innerorts", wappen: "nein" },
    }),
    zeile("aelen", "Älenburg", { facetten: { karte: "auf", typ: "stadt", wappen: "nein" }, rang: { groesse: 3 } }),
    zeile("turm", "Schuldturm in Gratenfels", {
        kreis: "leer",
        facetten: { karte: "nicht", typ: "staette", lage: "innerorts", wappen: "nein" },
    }),
];

const OPTIONEN: ListenOptionen = {
    form: "flach",
    facetten: ["karte", "typ", "lage", "wappen"],
    sortierungen: { name: nachName, groesse: nachRang("groesse") },
};

const stand = (teil: Partial<ListenStand> = {}): ListenStand => ({
    suche: "",
    filter: new Map(),
    sortierung: "name",
    offen: new Set(),
    ...teil,
});

const keys = (zeilen: readonly { key: string }[]): string[] => zeilen.map((x) => x.key);

describe("Suche und Facetten", () => {
    it("ohne Suche und Filter: alles, deutsch sortiert (Ä bei A), keine Bilanzzeile", () => {
        const ergebnis = berechne(ORTE, stand(), OPTIONEN);
        expect(keys(ergebnis.treffer)).toEqual(["aelen", "tempel", "gratenfels", "klein", "turm"]);
        expect(ergebnis.facettenOptionen["karte"]).toEqual([
            { wert: "auf", zahl: 3 },
            { wert: "nicht", zahl: 2 },
        ]);
        expect(ergebnis.bilanz.zeigen).toBe(false);
    });

    it("🔴 die Start-Belegung des Trichters (`vorbelegt`, EDIT-0003 T54) zeigt keine Bilanzzeile, erst eine Abweichung davon", () => {
        const vorbelegt = new Map([["karte", new Set(["auf"])]]);
        const optionen: ListenOptionen = { ...OPTIONEN, vorbelegt };
        expect(berechne(ORTE, stand({ filter: new Map([["karte", new Set(["auf"])]]) }), optionen).bilanz.zeigen).toBe(
            false,
        );
        expect(berechne(ORTE, stand({ filter: new Map() }), optionen).bilanz.zeigen).toBe(true);
        expect(
            berechne(ORTE, stand({ filter: new Map([["karte", new Set(["auf", "nicht"])]]) }), optionen).bilanz.zeigen,
        ).toBe(true);
    });

    it("🔴 was ein Reiter war, ist eine Facette: „nicht auf der Karte“ filtert mit den anderen, seine Zahl ohne sich selbst", () => {
        const ergebnis = berechne(
            ORTE,
            stand({
                filter: new Map([
                    ["karte", new Set(["nicht"])],
                    ["typ", new Set(["stadt", "staette"])],
                ]),
            }),
            OPTIONEN,
        );
        expect(keys(ergebnis.treffer)).toEqual(["tempel", "turm"]);
        // Ohne das Dorf (Typ-Filter) zählt „auf der Karte“ 2, so wie früher der Reiter „Platziert“ unter demselben Filter.
        expect(ergebnis.facettenOptionen["karte"]).toEqual([
            { wert: "auf", zahl: 2 },
            { wert: "nicht", zahl: 2 },
        ]);
    });

    it("die Suche faltet: „gratenfels“ findet auch „Älenburg“ nicht, „alenburg“ schon", () => {
        expect(keys(berechne(ORTE, stand({ suche: "GRATENFELS" }), OPTIONEN).treffer)).toEqual([
            "tempel",
            "gratenfels",
            "klein",
            "turm",
        ]);
        expect(keys(berechne(ORTE, stand({ suche: "alenburg" }), OPTIONEN).treffer)).toEqual(["aelen"]);
    });

    it("🔴 eine Facette zählt unter allen anderen Filtern, ohne sich selbst", () => {
        const ergebnis = berechne(
            ORTE,
            stand({
                filter: new Map([
                    ["typ", new Set(["stadt"])],
                    ["wappen", new Set(["ja"])],
                ]),
            }),
            OPTIONEN,
        );
        expect(keys(ergebnis.treffer)).toEqual(["gratenfels"]);
        // Typ unter „Wappen: ja“: nur Gratenfels hat eins.
        expect(ergebnis.facettenOptionen["typ"]).toEqual([{ wert: "stadt", zahl: 1 }]);
        // Wappen unter „Typ: Stadt“: beide Städte.
        expect(ergebnis.facettenOptionen["wappen"]).toEqual([
            { wert: "ja", zahl: 1 },
            { wert: "nein", zahl: 1 },
        ]);
        expect(ergebnis.filterAnzahl).toBe(2);
    });

    it("🔴 eine Facette gilt nur, wo die Zeile einen Wert hat: „Lage: innerorts“ lässt die Städte stehen", () => {
        const ergebnis = berechne(ORTE, stand({ filter: new Map([["lage", new Set(["innerorts"])]]) }), OPTIONEN);
        expect(ergebnis.treffer).toHaveLength(5);
        expect(ergebnis.facettenOptionen["lage"]).toEqual([{ wert: "innerorts", zahl: 2 }]);
    });

    it("🔴 die Bilanzzeile steht nur, wenn Suche oder Filter die Menge ändern, und zählt die Kreise der Treffer", () => {
        const ergebnis = berechne(ORTE, stand({ suche: "gratenfels" }), OPTIONEN);
        expect(ergebnis.bilanz).toMatchObject({ zeigen: true, treffer: 4, voll: 1, halb: 1, leer: 2 });
    });

    it("ein gewählter Wert, den es nicht mehr gibt, filtert nicht unsichtbar weiter", () => {
        const filter = new Map([["typ", new Set(["stadt", "metropole"])]]);
        expect(ohneVerwaiste(filter, vorhandeneWerte(ORTE, OPTIONEN.facetten))).toEqual(
            new Map([["typ", new Set(["stadt"])]]),
        );
    });

    it("🔴 verwaist misst an allen Zeilen: Eine Suche, die „innerorts“ kurz leert, nimmt die Wahl nicht mit", () => {
        const filter = new Map([["lage", new Set(["innerorts"])]]);
        const gesucht = berechne(ORTE, stand({ filter, suche: "Älenburg" }), OPTIONEN);
        expect(gesucht.facettenOptionen["lage"]).toEqual([]);
        expect(ohneVerwaiste(filter, vorhandeneWerte(ORTE, OPTIONEN.facetten))).toEqual(filter);
    });

    it("Sortierung nach Rang, ohne Rang zuletzt, bei Gleichstand nach Name", () => {
        expect(keys(berechne(ORTE, stand({ sortierung: "groesse" }), OPTIONEN).treffer)).toEqual([
            "aelen",
            "gratenfels",
            "klein",
            "tempel",
            "turm",
        ]);
    });

    it("eine Maske lässt nur ihre Zeilen durch und zeigt die Bilanz", () => {
        const ergebnis = berechne(ORTE, stand({ maske: (x) => x.facetten["typ"] === "staette" }), OPTIONEN);
        expect(keys(ergebnis.treffer)).toEqual(["tempel", "turm"]);
        expect(ergebnis.bilanz.zeigen).toBe(true);
    });
});

describe("🔴 die Formen gruppiert und Baum an einer Testtafel (G2)", () => {
    const WEGE: readonly ListenZeile[] = [
        zeile("w1", "Reichsstraße 1 (Abschnitt 1)", { gruppe: "r1", gruppenName: "Reichsstraße 1", kreis: "voll" }),
        zeile("w2", "Reichsstraße 1 (Abschnitt 2)", { gruppe: "r1", gruppenName: "Reichsstraße 1", kreis: "leer" }),
        zeile("w3", "Kaiser-Raul-Straße", { gruppe: "k", gruppenName: "Kaiser-Raul-Straße", kreis: "voll" }),
        zeile("w4", "Einzelpfad", { kreis: "leer" }),
    ];
    const gruppiert: ListenOptionen = { ...OPTIONEN, form: "gruppiert" };

    it("zu: je Gruppe ein Kopf mit allen Gliedern und gemischtem Kreis; Einzelne stehen für sich", () => {
        const { darstellung } = berechne(WEGE, stand(), gruppiert);
        expect(darstellung.map((x) => [x.art, x.key])).toEqual([
            ["zeile", "w4"],
            ["gruppe", gruppenKey("k")],
            ["gruppe", gruppenKey("r1")],
        ]);
        const r1 = darstellung.find((x) => x.key === gruppenKey("r1"));
        expect(r1).toMatchObject({ art: "gruppe", name: "Reichsstraße 1", kreis: "halb", offen: false });
        expect(r1?.art === "gruppe" ? keys(r1.glieder) : []).toEqual(["w1", "w2"]);
    });

    it("auf: die Glieder stehen eingerückt unter dem Kopf", () => {
        const { darstellung } = berechne(WEGE, stand({ offen: new Set([gruppenKey("r1")]) }), gruppiert);
        expect(darstellung.map((x) => [x.key, x.art === "zeile" ? x.tiefe : "kopf"])).toEqual([
            ["w4", 0],
            [gruppenKey("k"), "kopf"],
            [gruppenKey("r1"), "kopf"],
            ["w1", 1],
            ["w2", 1],
        ]);
    });

    const GEBIETE: readonly ListenZeile[] = [
        zeile("reich", "Mittelreich", { kreis: "halb-rechts" }),
        zeile("kosch", "Fürstentum Kosch", { eltern: "reich" }),
        zeile("ferdok", "Grafschaft Ferdok", { eltern: "kosch", kreis: "voll" }),
        zeile("garetien", "Garetien", { eltern: "reich" }),
        zeile("horas", "Horasreich"),
    ];
    const baum: ListenOptionen = { ...OPTIONEN, form: "baum" };

    it("zu: nur die Wurzeln, mit Zahl der Kinder", () => {
        const { darstellung } = berechne(GEBIETE, stand(), baum);
        expect(darstellung.map((x) => [x.key, x.art === "zeile" ? x.kinder : 0])).toEqual([
            ["horas", 0],
            ["reich", 2],
        ]);
    });

    it("aufgeklappt: Kinder eine Stufe tiefer, sortiert", () => {
        const { darstellung } = berechne(GEBIETE, stand({ offen: new Set(["reich"]) }), baum);
        expect(darstellung.map((x) => [x.key, x.art === "zeile" ? x.tiefe : -1])).toEqual([
            ["horas", 0],
            ["reich", 0],
            ["kosch", 1],
            ["garetien", 1],
        ]);
    });

    it("🔴 ein Treffer bringt seine Vorfahren als Zusammenhang mit, aufgeklappt", () => {
        const { darstellung, treffer } = berechne(GEBIETE, stand({ suche: "ferdok" }), baum);
        expect(keys(treffer)).toEqual(["ferdok"]);
        expect(
            darstellung.map((x) => [
                x.key,
                x.art === "zeile" ? x.tiefe : -1,
                x.art === "zeile" && x.zusammenhang === true,
            ]),
        ).toEqual([
            ["reich", 0, true],
            ["kosch", 1, true],
            ["ferdok", 2, false],
        ]);
    });
});

describe("Tasten und virtuelles Fenster", () => {
    const darstellung = berechne(ORTE, stand(), OPTIONEN).darstellung;

    it("🔴 Pfeile wählen ohne Umlauf; ohne Wahl beginnt ↓ oben und ↑ unten", () => {
        expect(naechsteWahl(darstellung, undefined, "ArrowDown")).toBe("aelen");
        expect(naechsteWahl(darstellung, undefined, "ArrowUp")).toBe("turm");
        expect(naechsteWahl(darstellung, "aelen", "ArrowUp")).toBe("aelen");
        expect(naechsteWahl(darstellung, "turm", "ArrowDown")).toBe("turm");
        expect(naechsteWahl(darstellung, "aelen", "End")).toBe("turm");
        expect(naechsteWahl(darstellung, "turm", "Home")).toBe("aelen");
        expect(naechsteWahl(darstellung, "aelen", "PageDown", 2)).toBe("gratenfels");
        expect(naechsteWahl(darstellung, "aelen", "Enter")).toBeUndefined();
    });

    it("das Fenster zeichnet nur, was sichtbar ist, samt Überhang", () => {
        expect(fenster(9000, 44, 0, 440, 8)).toEqual({ anfang: 0, ende: 18 });
        expect(fenster(9000, 44, 4400, 440, 8)).toEqual({ anfang: 92, ende: 118 });
        expect(fenster(10, 44, 0, 4400, 8)).toEqual({ anfang: 0, ende: 10 });
        expect(fenster(0, 44, 0, 440)).toEqual({ anfang: 0, ende: 0 });
    });

    it("rollt nur, wenn die Zeile nicht ganz sichtbar ist", () => {
        expect(rollenZu(5, 44, 0, 440)).toBeUndefined();
        expect(rollenZu(20, 44, 0, 440)).toBe(21 * 44 - 440);
        expect(rollenZu(2, 44, 400, 440)).toBe(88);
    });
});
