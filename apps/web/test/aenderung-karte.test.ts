import { beforeEach, describe, expect, it } from "vitest";
import { shallowRef } from "vue";
import { DESIGN_CANON } from "@avesmaps3d/shared";
import {
    hatBild,
    hatKartenFelder,
    kartenBild,
    leseGeometrie,
    leseNetz,
    type KartenGegenstand,
    type KartenZeile,
} from "../src/aenderungen/aenderung-karte-modell";
import {
    kartenAnzeige,
    kartenWunsch,
    schliesseKarte,
    schliesseKarteFuer,
    setzeKartenAnzeige,
    warteBis,
    zeigeAufKarte,
    zeigtKarte,
} from "../src/aenderungen/karte-ablage";

/**
 * Vorher und Nachher auf der Karte (WI-0265 B5b), das Bauen des Bildes aus dem Protokoll: die vier Formen der Geometrie (volle Linie und Ringe,
 * bewegte Stützpunkte mit Index, Wegende, mitgezogene Ecken ohne Index), `position`, das Netz des Gebirges, und vor allem die Ehrlichkeit: Fehlt die frühere
 * Form, gibt es kein Vorher, und ein Teil-Vorher bleibt ein Teil-Vorher. Ohne Karte und ohne Browser.
 */

/** Eine Zeile, wie das Detail sie führt; `vorher` oder `nachher` weggelassen heißt: das Protokoll führt den Wert nicht (nur bei `vorher` ist das eine Aussage). */
function zeile(feld: string, teil: Partial<KartenZeile> & Pick<KartenZeile, "vorher" | "nachher">): KartenZeile {
    return { feld, hatVorher: true, formFehlt: false, omitted: false, ...teil };
}

const weg = (...zeilen: KartenZeile[]): KartenGegenstand => ({ kind: "path", zeilen });
const flaeche = (...zeilen: KartenZeile[]): KartenGegenstand => ({ kind: "landscape", zeilen });

const LINIE_ALT: [number, number][] = [
    [10, 10],
    [20, 15],
    [30, 10],
];
const LINIE_NEU: [number, number][] = [
    [10, 10],
    [22, 18],
    [30, 10],
];

describe("Form 1: die volle Linie (path.reshaped)", () => {
    it("zeigt Vorher und Nachher als Linien, nichts verbunden, keine Lücke", () => {
        const bild = kartenBild([weg(zeile("geometry", { vorher: LINIE_ALT, nachher: LINIE_NEU }))]);
        expect(bild.vorher).toEqual([{ art: "linie", punkte: LINIE_ALT }]);
        expect(bild.nachher).toEqual([{ art: "linie", punkte: LINIE_NEU }]);
        expect(bild.verschiebungen).toEqual([]);
        expect(bild.hinweise).toEqual({ vorherFehlt: false, vorherTeilweise: false, nachherTeilweise: false });
        expect(bild.grenzen).toEqual([10, 10, 30, 18]);
        expect(hatBild(bild)).toBe(true);
    });

    it("dieselbe Liste von [x,y] ist bei einer Fläche NICHT eine Linie, sondern die mitgezogenen Ecken (siehe Form 5)", () => {
        expect(leseGeometrie(LINIE_ALT, "path")).toMatchObject({ form: "linien" });
        expect(leseGeometrie(LINIE_ALT, "landscape")).toMatchObject({ form: "punkte" });
    });
});

describe("Ringe: die eigene Fläche (area.reshaped, Anlegen)", () => {
    const ring: [number, number][] = [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
    ];
    const polygone = [[ring]];

    it("zeichnet den Umriss als geschlossene Linie, auch wenn der erste Punkt am Ende fehlt", () => {
        const gelesen = leseGeometrie(polygone, "landscape");
        expect(gelesen).toEqual({ form: "linien", linien: [[...ring, ring[0]]] });
    });

    it("lässt einen schon geschlossenen Ring, wie er ist, und nimmt alle Ringe aller Polygone mit (Loch, zweites Stück)", () => {
        const geschlossen = [...ring, ring[0]!];
        const loch: [number, number][] = [
            [3, 3],
            [6, 3],
            [6, 6],
            [3, 3],
        ];
        const zweites: [number, number][] = [
            [20, 0],
            [30, 0],
            [30, 10],
            [20, 0],
        ];
        const gelesen = leseGeometrie([[geschlossen, loch], [zweites]], "territory_area");
        expect(gelesen).toEqual({ form: "linien", linien: [geschlossen, loch, zweites] });
    });

    it("Anlegen kennt nur ein Nachher: kein Vorher, und keine Lücke gemeldet (es gab nichts davor)", () => {
        const bild = kartenBild([
            flaeche(zeile("geometry", { vorher: undefined, hatVorher: false, nachher: polygone })),
        ]);
        expect(bild.vorher).toEqual([]);
        expect(bild.nachher).toHaveLength(1);
        expect(bild.hinweise.vorherFehlt).toBe(false);
    });
});

describe("Form 3: bewegte Stützpunkte mit Index (path.carried)", () => {
    const vorher = [
        { index: 2, x: 30, y: 10 },
        { index: 5, x: 50, y: 12 },
    ];
    const nachher = [
        { index: 2, x: 31, y: 11 },
        { index: 5, x: 52, y: 12 },
    ];

    it("zeigt nur diese Punkte, je Index vorher mit nachher verbunden, und sagt „Vorher nur teilweise“", () => {
        const bild = kartenBild([weg(zeile("geometry", { vorher, nachher, formFehlt: true }))]);
        expect(bild.vorher).toEqual([
            { art: "punkt", punkt: [30, 10] },
            { art: "punkt", punkt: [50, 12] },
        ]);
        expect(bild.nachher).toEqual([
            { art: "punkt", punkt: [31, 11] },
            { art: "punkt", punkt: [52, 12] },
        ]);
        expect(bild.verschiebungen).toEqual([
            { von: [30, 10], nach: [31, 11] },
            { von: [50, 12], nach: [52, 12] },
        ]);
        expect(bild.hinweise).toEqual({ vorherFehlt: false, vorherTeilweise: true, nachherTeilweise: false });
    });

    it("verbindet nur gleiche Indizes: ein Punkt ohne Gegenstück bleibt allein", () => {
        const bild = kartenBild([
            weg(
                zeile("geometry", {
                    vorher: [{ index: 2, x: 30, y: 10 }],
                    nachher: [{ index: 3, x: 31, y: 11 }],
                    formFehlt: true,
                }),
            ),
        ]);
        expect(bild.verschiebungen).toEqual([]);
        expect(bild.vorher).toHaveLength(1);
        expect(bild.nachher).toHaveLength(1);
    });
});

describe("Form 4: nur das Wegende (path.endpoint_moved)", () => {
    it("zeigt die Enden als Punkte, je Ende verbunden, ohne die Linie zu erfinden", () => {
        const bild = kartenBild([
            weg(
                zeile("geometry", {
                    vorher: [{ end: "start", x: 5, y: 5 }],
                    nachher: [{ end: "start", x: 6, y: 7 }],
                    formFehlt: true,
                }),
            ),
        ]);
        expect(bild.vorher).toEqual([{ art: "punkt", punkt: [5, 5] }]);
        expect(bild.nachher).toEqual([{ art: "punkt", punkt: [6, 7] }]);
        expect(bild.verschiebungen).toEqual([{ von: [5, 5], nach: [6, 7] }]);
        expect(bild.hinweise.vorherTeilweise).toBe(true);
    });

    it("Anfang und Ende desselben Wegs bleiben getrennte Paare", () => {
        const bild = kartenBild([
            weg(
                zeile("geometry", {
                    vorher: [
                        { end: "start", x: 0, y: 0 },
                        { end: "end", x: 9, y: 9 },
                    ],
                    nachher: [
                        { end: "end", x: 9, y: 10 },
                        { end: "start", x: 0, y: 1 },
                    ],
                    formFehlt: true,
                }),
            ),
        ]);
        expect(bild.verschiebungen).toEqual([
            { von: [0, 0], nach: [0, 1] },
            { von: [9, 9], nach: [9, 10] },
        ]);
    });
});

describe("Form 5: mitgezogene Nachbarecken einer Fläche ohne Index (area.carried)", () => {
    it("zeigt nur Punkte, VERBINDET nichts (kein Ring- und kein Eckenindex im Protokoll) und sagt „Vorher nur teilweise“", () => {
        const bild = kartenBild([
            flaeche(
                zeile("geometry", {
                    vorher: [
                        [10, 10],
                        [20, 20],
                    ],
                    nachher: [
                        [11, 10],
                        [21, 20],
                    ],
                    formFehlt: true,
                }),
            ),
        ]);
        expect(bild.vorher).toEqual([
            { art: "punkt", punkt: [10, 10] },
            { art: "punkt", punkt: [20, 20] },
        ]);
        expect(bild.nachher).toHaveLength(2);
        expect(bild.verschiebungen).toEqual([]);
        expect(bild.hinweise.vorherTeilweise).toBe(true);
    });
});

describe("🔴 formFehlt: nie ein Vorher aus dem heutigen Stand", () => {
    it("ohne `before` bei einem schon vorhandenen Gegenstand: kein Vorher, nur das Nachher, und der Satz dazu", () => {
        const bild = kartenBild([
            weg(zeile("geometry", { vorher: undefined, hatVorher: false, nachher: LINIE_NEU, formFehlt: true })),
        ]);
        expect(bild.vorher).toEqual([]);
        expect(bild.nachher).toEqual([{ art: "linie", punkte: LINIE_NEU }]);
        expect(bild.hinweise).toEqual({ vorherFehlt: true, vorherTeilweise: false, nachherTeilweise: false });
        // Das Bild zeigt sich trotzdem: Das Nachher ist belegt.
        expect(hatBild(bild)).toBe(true);
    });

    it("auch ein `vorher`, das irgendwie am Feld hängt, zählt nicht, solange das Protokoll keines führt (`hatVorher` aus)", () => {
        const bild = kartenBild([
            weg(zeile("geometry", { vorher: LINIE_ALT, hatVorher: false, nachher: LINIE_NEU, formFehlt: true })),
        ]);
        expect(bild.vorher).toEqual([]);
        expect(bild.hinweise.vorherFehlt).toBe(true);
    });

    it("ein Gegenstand ohne Vorher nimmt die anderen nicht mit: Die Hinweise gelten für die Karte als Ganze, die Linien je Gegenstand", () => {
        const bild = kartenBild([
            weg(zeile("geometry", { vorher: LINIE_ALT, nachher: LINIE_NEU })),
            weg(zeile("geometry", { vorher: undefined, hatVorher: false, nachher: LINIE_NEU, formFehlt: true })),
        ]);
        expect(bild.vorher).toHaveLength(1);
        expect(bild.nachher).toHaveLength(2);
        expect(bild.hinweise.vorherFehlt).toBe(true);
    });

    it("eine Serie, die ein ganzes Vorher mit einem Teil-Nachher verbindet, sagt es", () => {
        const bild = kartenBild([
            weg(
                zeile("geometry", {
                    vorher: LINIE_ALT,
                    nachher: [{ index: 1, x: 22, y: 18 }],
                }),
            ),
        ]);
        expect(bild.vorher).toHaveLength(1);
        expect(bild.hinweise).toEqual({ vorherFehlt: false, vorherTeilweise: false, nachherTeilweise: true });
    });
});

describe("position: Ort, Gipfel, Beschriftung", () => {
    const ort = (...zeilen: KartenZeile[]): KartenGegenstand => ({ kind: "place", zeilen });

    it("verschieben: ein Punkt vorher, einer nachher", () => {
        const bild = kartenBild([ort(zeile("position", { vorher: [100, 200], nachher: [110, 205] }))]);
        expect(bild.vorher).toEqual([{ art: "punkt", punkt: [100, 200] }]);
        expect(bild.nachher).toEqual([{ art: "punkt", punkt: [110, 205] }]);
        // Die Lage ist ganz gespeichert: frühere und neue Lage desselben Orts sind verbunden, und es gibt keine Lücke.
        expect(bild.verschiebungen).toEqual([{ von: [100, 200], nach: [110, 205] }]);
        expect(bild.hinweise).toEqual({ vorherFehlt: false, vorherTeilweise: false, nachherTeilweise: false });
        expect(bild.grenzen).toEqual([100, 200, 110, 205]);
    });

    it("anlegen (`before: null`): nur Nachher, keine Lücke; löschen (`after: null`): nur Vorher", () => {
        const neu = kartenBild([ort(zeile("position", { vorher: null, nachher: [1, 2] }))]);
        expect(neu.vorher).toEqual([]);
        expect(neu.nachher).toHaveLength(1);
        expect(neu.verschiebungen).toEqual([]);
        expect(neu.hinweise.vorherFehlt).toBe(false);
        const weg = kartenBild([ort(zeile("position", { vorher: [1, 2], nachher: null }))]);
        expect(weg.vorher).toHaveLength(1);
        expect(weg.nachher).toEqual([]);
    });

    it("ein Ort ohne frühere Lage im Protokoll (`formFehlt`): kein Vorher, der Satz dazu", () => {
        const bild = kartenBild([
            ort(zeile("position", { vorher: undefined, hatVorher: false, nachher: [1, 2], formFehlt: true })),
        ]);
        expect(bild.vorher).toEqual([]);
        expect(bild.hinweise.vorherFehlt).toBe(true);
    });

    it("ein Wert, der keine Lage ist, bleibt weg", () => {
        const bild = kartenBild([ort(zeile("position", { vorher: "x", nachher: ["a", "b"] }))]);
        expect(hatBild(bild)).toBe(false);
    });
});

describe("das Netz des Gebirges (gebirge:netz)", () => {
    const netz = {
        kaemme: [
            {
                rang: "haupt",
                punkte: [
                    [0, 0],
                    [5, 5],
                    [10, 0],
                ],
            },
            {
                rang: "tal",
                punkte: [
                    [1, 1],
                    [2, 2],
                ],
            },
            { rang: "neben", punkte: [[7, 7]] },
        ],
        nebengipfel: [{ x: 3, y: 3, h: null }],
        mulden: [{ x: 4, y: 4, h: 12 }],
        flussHoehen: [{ x: 9, y: 9, h: 5 }],
    };

    it("Kämme (auch Täler) als Linien, Nebengipfel und Mulden als Punkte; eine Linie aus einem Punkt und die Wasserhöhen bleiben weg", () => {
        const gelesen = leseNetz(netz);
        expect(gelesen?.linien).toEqual([
            [
                [0, 0],
                [5, 5],
                [10, 0],
            ],
            [
                [1, 1],
                [2, 2],
            ],
        ]);
        expect(gelesen?.punkte).toEqual([
            [3, 3],
            [4, 4],
        ]);
    });

    it("Vorher und Nachher, auch wenn das ganze Gebirge (`gebirge` mit `netz`) noch nicht zerlegt ist", () => {
        const getrennt = kartenBild([
            {
                kind: "landscape",
                zeilen: [
                    zeile("gebirge:netz", { vorher: netz, nachher: { kaemme: [], nebengipfel: [{ x: 8, y: 8 }] } }),
                ],
            },
        ]);
        expect(getrennt.vorher).toHaveLength(4);
        expect(getrennt.nachher).toEqual([{ art: "punkt", punkt: [8, 8] }]);
        const ganz = kartenBild([
            { kind: "landscape", zeilen: [zeile("gebirge", { vorher: { netz }, nachher: { netz } })] },
        ]);
        expect(ganz.vorher).toHaveLength(4);
    });
});

describe("was nicht auf die Karte gehört", () => {
    it("Felder ohne Lage und Werte, die noch ausstehen (`omitted`), bleiben weg; die Karte zeigt, was belegt ist", () => {
        const bild = kartenBild([
            weg(
                zeile("name", { vorher: "A", nachher: "B" }),
                zeile("geometry", { vorher: undefined, nachher: undefined, omitted: true }),
            ),
        ]);
        expect(hatBild(bild)).toBe(false);
        expect(bild.grenzen).toBeUndefined();
        // Der Knopf ist trotzdem da: Das Feld gibt es, sein Wert lädt beim Zeigen nach.
        expect(
            hatKartenFelder([weg(zeile("geometry", { vorher: undefined, nachher: undefined, omitted: true }))]),
        ).toBe(true);
        expect(hatKartenFelder([weg(zeile("name", { vorher: "A", nachher: "B" }))])).toBe(false);
    });

    it("kaputte Werte lassen das Bild leer, statt zu werfen", () => {
        for (const wert of [null, "x", 3, [], [null], [[]], [{ index: "a" }], {}, [[1]], [[["x"]]]]) {
            expect(() => leseGeometrie(wert, "path")).not.toThrow();
            expect(() => leseGeometrie(wert, "landscape")).not.toThrow();
        }
        expect(leseGeometrie([{ index: "a" }], "path")).toBeUndefined();
        expect(leseNetz(null)).toBeUndefined();
        expect(leseNetz({ kaemme: "x" })).toBeUndefined();
    });
});

describe("die Ablage zwischen Detail und Karte", () => {
    const bild = kartenBild([weg(zeile("geometry", { vorher: LINIE_ALT, nachher: LINIE_NEU }))]);

    beforeEach(() => {
        schliesseKarte();
        setzeKartenAnzeige("beide");
    });

    it("ein Wunsch hat einen Besitzer, ein zweites Zeigen löst das erste ab, und „Beide“ beginnt neu", () => {
        zeigeAufKarte("a", bild);
        setzeKartenAnzeige("vorher");
        zeigeAufKarte("b", bild);
        expect(kartenWunsch.value?.besitzer).toBe("b");
        expect(zeigtKarte("a")).toBe(false);
        expect(zeigtKarte("b")).toBe(true);
        expect(kartenAnzeige.value).toBe("beide");
    });

    it("das Schließen eines anderen Details lässt die Überlagerung stehen; das eigene nimmt sie weg", () => {
        zeigeAufKarte("a", bild);
        schliesseKarteFuer("b");
        expect(kartenWunsch.value?.besitzer).toBe("a");
        schliesseKarteFuer("a");
        expect(kartenWunsch.value).toBeUndefined();
    });

    it("warteBis wartet auf die Bedingung und kehrt sofort zurück, wenn sie schon gilt", async () => {
        await warteBis(() => true);
        const fertig = shallowRef(false);
        let weiter = false;
        const wartend = warteBis(() => fertig.value).then(() => {
            weiter = true;
        });
        await Promise.resolve();
        expect(weiter).toBe(false);
        fertig.value = true;
        await wartend;
        expect(weiter).toBe(true);
    });
});

describe("Kanon: die Kartentöne von Vorher und Nachher", () => {
    const farben = DESIGN_CANON.colour;
    const NAMEN = [
        "mapChangeBeforeFill",
        "mapChangeBeforeLine",
        "mapChangeBeforeHalo",
        "mapChangeBeforeInk",
        "mapChangeAfterFill",
        "mapChangeAfterLine",
        "mapChangeAfterHalo",
        "mapChangeAfterInk",
        "mapChangeLink",
    ];

    it("stehen alle da", () => {
        for (const name of NAMEN) expect(farben[name], name).toBeTypeOf("string");
    });

    it("🔴 haben keinen Dunkelwert: die Karte bleibt in beiden Themen hell (Guide §23.1)", () => {
        const dunkel = DESIGN_CANON.colourDark ?? {};
        expect(Object.keys(dunkel).filter((name) => name.startsWith("mapChange"))).toEqual([]);
    });

    it("Nachher ist nicht das Gold der Auswahl und Vorher nicht dasselbe wie Nachher", () => {
        expect(farben["mapChangeAfterLine"]).not.toBe(farben["mapSelection"]);
        expect(farben["mapChangeBeforeLine"]).not.toBe(farben["mapChangeAfterLine"]);
    });
});
