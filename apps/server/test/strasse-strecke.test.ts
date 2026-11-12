import { describe, expect, it } from "vitest";
import type { RouteNode } from "../src/routing/network.ts";
import {
    NAME_GEWICHT,
    TYP_GEWICHT_SONST,
    gewichtJeMeile,
    rechneStrecke,
    waehleOrte,
    zerlegeVerlauf,
    zustandVon,
    type StreckenEingabe,
    type StreckenStrasse,
    type StreckenWeg,
} from "../src/editor/strasse-strecke.ts";

/**
 * Die Rechnung der Strecke im Straßen-Assistenten (WI-0310, `editor/strasse-strecke.ts`), ohne Datenbank: Verlauf zerlegen, Orte wählen, Gewicht, Zustand je Abschnitt, Dijkstra über die Topologie der
 * Wegfindung.
 *
 * Problemfälle: Die Strecke nimmt die kürzere fremde Straße statt der eigenen (das Gewicht des Namens greift nicht) oder bleibt auf der eigenen, auch wenn sie weit außen herum führt; ein Ortspaar ohne
 * Verbindung bekommt eine erfundene Strecke; der Umweg rechnet in Karteneinheiten statt in Meilen; ein Griff wie „Strasse-11192“ zählt als Name; ein unbekannter oder doppelter Name im Verlauf landet
 * in der Liste; ein am Ort geteilter Abschnitt erscheint zweimal; ein Abschnitt der Straße abseits der Strecke und sein Endort fehlen.
 */

const ID = (n: number): string => `03100310-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const ort = (n: number, name: string, x: number, y: number): RouteNode => ({
    id: ID(n),
    name,
    kind: "place",
    isHidden: false,
    x,
    y,
});
const weg = (
    n: number,
    name: string,
    subtype: string,
    punkte: [number, number][],
    wikiKey: string | null = null,
): StreckenWeg => ({
    id: ID(0x100 + n),
    name,
    subtype,
    coordinates: punkte,
    wikiKey,
});
const STRASSE: StreckenStrasse = { namen: new Set(["Reichsstraße X"]), key: "reichsstrasse-x" };

const A = ort(1, "Agilsburg", 0, 0);
const B = ort(2, "Beilunk", 10, 0);
const C = ort(3, "Calbrozim", 50, 50);
const D = ort(4, "Dunkelstein", 20, 0);
const M = ort(5, "Mittenfeld", 5, 0);
const alsOrt = (knoten: RouteNode) => ({ id: knoten.id, name: knoten.name, x: knoten.x, y: knoten.y });

const eingabe = (teil: Partial<StreckenEingabe> & Pick<StreckenEingabe, "orte" | "wege">): StreckenEingabe => ({
    knoten: [A, B, C, D, M],
    strasse: STRASSE,
    kandidaten: [],
    optionen: {},
    meilenJe: 2,
    ...teil,
});

describe("Straßen-Assistent: die Rechnung der Strecke (WI-0310)", () => {
    it("🔴 der Verlauf zerfällt an den Pfeilen, leere Teile fallen weg", () => {
        expect(zerlegeVerlauf(" Punin → Madasee →  → Al'Muktur ")).toEqual(["Punin", "Madasee", "Al'Muktur"]);
        expect(zerlegeVerlauf("Tuzak")).toEqual(["Tuzak"]);
    });

    it("🔴 Orte aus dem Verlauf: ohne Groß- und Kleinschreibung, der nächste von gleichnamigen, ein unbekannter Name in `unbekannt`, ein doppelter Ort nur einmal", () => {
        const { orte, unbekannt } = waehleOrte(
            ["Gareth", "Unbekanntdorf", " gareth ", "Wehrheim", "UNBEKANNTDORF"],
            [
                { id: ID(10), name: "Gareth", x: 1, y: 1, abstand: 0 },
                { id: ID(12), name: "Wehrheim", x: 90, y: 90, abstand: 40 },
                { id: ID(11), name: "wehrheim", x: 5, y: 5, abstand: 2 },
            ],
        );
        expect(orte.map((o) => o.id)).toEqual([ID(10), ID(11)]);
        expect(unbekannt).toEqual(["Unbekanntdorf"]);
    });

    it("🔴 Zustand je Abschnitt: fertig, Artikel fehlt oder ein anderer, ohne echten Namen (leer, Name der Art, Griff Strasse-11192), fremd", () => {
        const ziel = { name: "Reichsstraße X", key: "reichsstrasse-x" };
        const z = (name: string, wikiKey: string | null, subtype = "Strasse") =>
            zustandVon({ name, subtype, wikiKey }, ziel);
        expect(z("Reichsstraße X", "reichsstrasse-x")).toBe("fertig");
        expect(z("Reichsstraße X", null)).toBe("artikel");
        expect(z("Reichsstraße X", "anderer-artikel")).toBe("artikel");
        expect(z("", null)).toBe("name");
        expect(z("Strasse", null)).toBe("name");
        expect(z("Strasse-11192", "reichsstrasse-x")).toBe("name");
        expect(z("Alte Handelsstraße", "reichsstrasse-x")).toBe("fremd");
        // Ohne Artikel ist der Name allein fertig; ohne echten Namen der Straße ist jeder echte Name fremd.
        expect(
            zustandVon(
                { name: "Reichsstraße X", subtype: "Weg", wikiKey: null },
                { name: "Reichsstraße X", key: null },
            ),
        ).toBe("fertig");
        expect(zustandVon({ name: "Reichsstraße X", subtype: "Weg", wikiKey: null }, { name: "", key: null })).toBe(
            "fremd",
        );
    });

    it("🔴 das Gewicht je Meile: Name mal Wegtyp", () => {
        expect(
            gewichtJeMeile({ name: "Reichsstraße X", subtype: "Reichsstrasse", wikiKey: null }, STRASSE),
        ).toBeCloseTo(0.8);
        // Schon der Artikel zählt wie der Name, auch an einem Griff.
        expect(gewichtJeMeile({ name: "Pfad-12", subtype: "Pfad", wikiKey: "reichsstrasse-x" }, STRASSE)).toBeCloseTo(
            0.8 * 1.25,
        );
        expect(gewichtJeMeile({ name: "Weg-6029", subtype: "Weg", wikiKey: null }, STRASSE)).toBeCloseTo(
            NAME_GEWICHT.ohne * 1.1,
        );
        expect(gewichtJeMeile({ name: "Bärenpfad", subtype: "Gebirgspass", wikiKey: null }, STRASSE)).toBeCloseTo(
            1.2 * 1.4,
        );
        expect(gewichtJeMeile({ name: "Alter Kanal", subtype: "Treidelpfad", wikiKey: null }, STRASSE)).toBeCloseTo(
            1.2 * TYP_GEWICHT_SONST,
        );
    });

    it("🔴 die Gewichte bevorzugen den Namen: die eigene Straße, auch etwas länger, vor der kürzeren fremden; Länge und Umweg in Meilen", () => {
        const eigene = weg(1, "Reichsstraße X", "Strasse", [
            [0, 0],
            [0, 1],
            [10, 1],
            [10, 0],
        ]);
        const fremde = weg(2, "Alte Handelsstraße", "Strasse", [
            [0, 0],
            [10, 0],
        ]);
        const { teile } = rechneStrecke(eingabe({ orte: [alsOrt(A), alsOrt(B)], wege: [eigene, fremde] }));
        // 12 × 0,8 = 9,6 schlägt 10 × 1,2 = 12; die Länge ist die echte, in Meilen (12 Karteneinheiten × 2), der Umweg gegen die Luftlinie (20 Meilen).
        expect(teile).toEqual([{ von: A.id, nach: B.id, laenge: 24, umweg: 1.2, abschnitte: [eigene.id] }]);
    });

    it("🔴 ein Umweg zu weit: ein Abschnitt ohne Namen schlägt die eigene Straße, wenn die zu weit außen herum führt", () => {
        const eigene = weg(1, "Reichsstraße X", "Strasse", [
            [0, 0],
            [0, 2],
            [10, 2],
            [10, 0],
        ]);
        const griff = weg(3, "Strasse-11192", "Strasse", [
            [0, 0],
            [10, 0],
        ]);
        // 14 × 0,8 = 11,2 gegen 10 × 1 = 10: der Griff.
        const { teile } = rechneStrecke(eingabe({ orte: [alsOrt(A), alsOrt(B)], wege: [eigene, griff] }));
        expect(teile[0]).toMatchObject({ laenge: 20, umweg: 1, abschnitte: [griff.id] });
        // Mit dem Namen wäre es die eigene Straße geblieben (11,2 gegen 12).
        const fremd = { ...griff, name: "Alte Handelsstraße" };
        expect(
            rechneStrecke(eingabe({ orte: [alsOrt(A), alsOrt(B)], wege: [eigene, fremd] })).teile[0]?.abschnitte,
        ).toEqual([eigene.id]);
    });

    it("🔴 kein Weg: ein Ortspaar ohne Verbindung bekommt keine Strecke (`laenge` und `umweg` null)", () => {
        const eigene = weg(1, "Reichsstraße X", "Strasse", [
            [0, 0],
            [10, 0],
        ]);
        const { teile } = rechneStrecke(eingabe({ orte: [alsOrt(A), alsOrt(B), alsOrt(C)], wege: [eigene] }));
        expect(teile).toEqual([
            { von: A.id, nach: B.id, laenge: 20, umweg: 1, abschnitte: [eigene.id] },
            { von: B.id, nach: C.id, laenge: null, umweg: null, abschnitte: [] },
        ]);
    });

    it("🔴 ein an einem Ort geteilter Abschnitt ist EIN Abschnitt der Strecke; über den Ort zerfällt er in zwei Teile", () => {
        const durch = weg(4, "Reichsstraße X", "Strasse", [
            [0, 0],
            [5, 0],
            [10, 0],
        ]);
        expect(rechneStrecke(eingabe({ orte: [alsOrt(A), alsOrt(B)], wege: [durch] })).teile[0]?.abschnitte).toEqual([
            durch.id,
        ]);
        const ueberM = rechneStrecke(eingabe({ orte: [alsOrt(A), alsOrt(M), alsOrt(B)], wege: [durch] })).teile;
        expect(ueberM.map((teil) => [teil.abschnitte, teil.laenge])).toEqual([
            [[durch.id], 10],
            [[durch.id], 10],
        ]);
    });

    it("🔴 abseits: ein Abschnitt der Straße, der nicht auf der Strecke liegt, mit seinem Endort als Vorschlag (nur Orte, die nicht in der Liste stehen); Längen je Abschnitt", () => {
        const drauf = weg(1, "Reichsstraße X", "Strasse", [
            [0, 0],
            [10, 0],
        ]);
        const weiter = weg(5, "Reichsstraße X", "Strasse", [
            [10, 0],
            [20, 0],
        ]);
        const ergebnis = rechneStrecke(
            eingabe({
                orte: [alsOrt(A), alsOrt(B)],
                wege: [drauf, weiter],
                kandidaten: [weiter.id, drauf.id, weiter.id],
            }),
        );
        expect(ergebnis.abseits).toEqual([weiter.id]);
        expect(ergebnis.vorschlaege).toEqual([D.id]);
        expect(ergebnis.laengen.get(weiter.id)).toBe(20);
    });
});
