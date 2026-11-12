import { describe, expect, it } from "vitest";
import { catmullRomLine, type EditorGebirge } from "@avesmaps3d/shared";
import { GEBIRGSNETZ } from "../src/map/geometrie/arten";
import type { Teil } from "../src/map/geometrie/geometrie";
import {
    enddeutung,
    flussAnsicht,
    flussAnsichten,
    flussHoehenZahlen,
    flussZeichnung,
    KEIN_FLUSS,
    steigendeFluesse,
    STEIGT_AB,
    teilImFluss,
    teilImSee,
    zahlDerFluesse,
    type FlussUmfeld,
} from "../src/landschaftseditor/kamm-netz-fluss";
import { gewaesserAus } from "../src/landschaftseditor/kamm-netz-wasser";

/**
 * Der Fluss als Tal im Kammeditor (WI-0259, OPS-071): wirksame Höhe, Steigen und Fließrichtung; die Rechnung, die Karte („!“) und Profil
 * (Gelb) teilen. Problemfälle: Ein Fluss ohne eigene Höhe warnt (das Gelände fällt ohnehin); eigene Höhen gelten nur bis zum Lauf; zwischen zwei
 * Höhen läuft der Fluss nach Bogenlänge, nicht nach Punktzahl; ein See mit eigener Höhe steht flach im Lauf und lässt den Fluss davor oder
 * dahinter steigen; die Fließrichtung gegen die Zeichenrichtung dreht das Steigen um.
 */

const FLAECHE = {
    type: "Polygon" as const,
    coordinates: [
        [
            [0, 0],
            [100, 0],
            [100, 20],
            [0, 20],
            [0, 0],
        ],
    ],
};

/** Fünf Punkte auf einer Geraden, ungleich weit auseinander (Bogenlängen 0, 10, 20, 50, 80). */
const P: [number, number][] = [
    [10, 10],
    [20, 10],
    [30, 10],
    [60, 10],
    [90, 10],
];
const OHNE_GELAENDE = (): number | undefined => undefined;
const GELAENDE = [500, 480, 460, 440, 420];
const UMFELD: FlussUmfeld = { seen: [], flaeche: FLAECHE };

describe("Wirksame Höhe (`flussAnsicht`)", () => {
    it("🔴 ohne eigene Höhe gilt das Gelände und nichts steigt, auch wenn das Gelände Haken schlägt", () => {
        const a = flussAnsicht({ p: P, dir: "forward" }, UMFELD, (i) => [500, 480, 490, 440, 420][i]);
        expect(a.punkte.map((q) => q.hoehe)).toEqual([500, 480, 490, 440, 420]);
        expect(a.punkte.some((q) => q.steigt)).toBe(false);
        expect(a.eigeneHoehen).toBe(false);
        expect(a.von).toBe(-1);
    });

    it("🔴 zwischen zwei eigenen Höhen läuft der Fluss linear nach Bogenlänge, davor und dahinter gilt das Gelände", () => {
        const a = flussAnsicht(
            { p: P, dir: "forward" },
            {
                ...UMFELD,
                flussHoehen: [
                    { x: 20, y: 10, h: 2000 },
                    { x: 90, y: 10, h: 1000 },
                ],
            },
            (i) => GELAENDE[i],
        );
        // Bogenlängen 0, 10, 20, 50, 80: Punkt 3 (s = 20) liegt 10/70 hinter der ersten Höhe, Punkt 4 (s = 50) 40/70.
        expect(a.punkte[0]!.hoehe).toBe(500);
        expect(a.punkte[1]!.hoehe).toBe(2000);
        expect(a.punkte[2]!.hoehe).toBeCloseTo(2000 - (1000 * 10) / 70, 6);
        expect(a.punkte[3]!.hoehe).toBeCloseTo(2000 - (1000 * 40) / 70, 6);
        expect(a.punkte[4]!.hoehe).toBe(1000);
        // Der Lauf reicht vom Punkt vor der ersten bis zum letzten Punkt (hier ist der letzte selbst die letzte Höhe).
        expect([a.von, a.bis]).toEqual([0, 4]);
        expect(a.punkte.map((q) => q.eigen)).toEqual([null, 2000, null, null, 1000]);
    });

    it("🔴 eine einzelne eigene Höhe gilt an ihrem Punkt; steigt der Fluss zu ihr hin, trägt sie das „!“", () => {
        const a = flussAnsicht(
            { p: P, dir: "forward" },
            { ...UMFELD, flussHoehen: [{ x: 30, y: 10, h: 2300 }] },
            (i) => GELAENDE[i],
        );
        expect(a.punkte.map((q) => q.hoehe)).toEqual([500, 480, 2300, 440, 420]);
        expect([a.von, a.bis]).toEqual([1, 3]);
        // Vor Punkt 3 (500 → 2300) steigt der Fluss; danach fällt er. Punkt 1 (500 → 480) liegt am Rand des Laufs und fällt.
        expect(a.punkte.map((q) => q.steigt)).toEqual([false, false, true, false, false]);
    });

    it("🔴 Steigen heißt mehr als `STEIGT_AB` Schritt; ein ebenes Stück steigt nicht", () => {
        const eben = flussAnsicht(
            { p: P, dir: "forward" },
            {
                ...UMFELD,
                flussHoehen: [
                    { x: 20, y: 10, h: 400 },
                    { x: 30, y: 10, h: 400 + STEIGT_AB },
                    { x: 60, y: 10, h: 300 },
                ],
            },
            (i) => [500, 0, 0, 0, 250][i],
        );
        expect(eben.punkte.some((q) => q.steigt)).toBe(false);
    });
});

describe("Fließrichtung", () => {
    const hoehen: FlussUmfeld = {
        ...UMFELD,
        flussHoehen: [
            { x: 10, y: 10, h: 300 },
            { x: 90, y: 10, h: 900 },
        ],
    };
    it("🔴 `reverse` dreht das Steigen um: Was in Zeichenrichtung fällt, steigt dagegen", () => {
        // Von 300 am ersten bis 900 am letzten Punkt: in Zeichenrichtung steigt der Fluss überall …
        const vor = flussAnsicht({ p: P, dir: "forward" }, hoehen, OHNE_GELAENDE);
        expect(vor.punkte.map((q) => q.steigt)).toEqual([false, true, true, true, true]);
        // … gegen sie fließt er bergab und steigt nirgends.
        const rueck = flussAnsicht({ p: P, dir: "reverse" }, hoehen, OHNE_GELAENDE);
        expect(rueck.vorwaerts).toBe(false);
        expect(rueck.punkte.some((q) => q.steigt)).toBe(false);
    });

    it("🔴 ohne Angabe fließt er vom höheren zum tieferen Ende des Geländes, bei Gleichstand in Zeichenrichtung", () => {
        expect(flussAnsicht({ p: P, dir: null }, UMFELD, (i) => GELAENDE[i]).vorwaerts).toBe(true);
        expect(flussAnsicht({ p: P, dir: null }, UMFELD, (i) => [...GELAENDE].reverse()[i]).vorwaerts).toBe(false);
        expect(flussAnsicht({ p: P, dir: null }, UMFELD, () => 700).vorwaerts).toBe(true);
        expect(flussAnsicht({ p: P, dir: null }, UMFELD, OHNE_GELAENDE).vorwaerts).toBe(true);
    });

    it("Quelle und Mündung stehen an den Enden nach der Fließrichtung", () => {
        const vor = flussAnsicht({ p: P, dir: "forward" }, UMFELD, (i) => GELAENDE[i]);
        const rueck = flussAnsicht({ p: P, dir: "reverse" }, UMFELD, (i) => GELAENDE[i]);
        expect([enddeutung(vor, 0), enddeutung(vor, 2), enddeutung(vor, 4)]).toEqual(["quelle", undefined, "muendung"]);
        expect([enddeutung(rueck, 0), enddeutung(rueck, 4)]).toEqual(["muendung", "quelle"]);
    });
});

describe("Ein See mit eigener Höhe im Lauf", () => {
    // Der See deckt den Punkt bei x = 60 ab (und nur ihn).
    const SEE = {
        g: {
            type: "Polygon" as const,
            coordinates: [
                [
                    [55, 5],
                    [65, 5],
                    [65, 15],
                    [55, 15],
                    [55, 5],
                ],
            ],
        },
    };
    const mitSee = (seeH: number | undefined, fluss: UMFELD_TYP["flussHoehen"] = []): FlussUmfeld => ({
        seen: [SEE],
        flaeche: FLAECHE,
        flussHoehen: fluss,
        ...(seeH === undefined ? {} : { seeHoehen: [{ x: 60, y: 10, h: seeH }] }),
    });
    type UMFELD_TYP = FlussUmfeld;

    it("🔴 der Spiegel gilt flach im See; ein Fluss, der davor tiefer liegt als der See, steigt am See", () => {
        const a = flussAnsicht({ p: P, dir: "forward" }, mitSee(1500), (i) => GELAENDE[i]);
        // Punkt 4 (x = 60) liegt im See: Spiegel 1500. Davor das Gelände (460 bei Punkt 3), also steigt der Fluss hinein.
        expect(a.punkte[3]!.see).toBe(0);
        expect(a.punkte[3]!.fest).toBe(1500);
        expect(a.punkte[3]!.eigen).toBeNull();
        expect(a.punkte[3]!.hoehe).toBe(1500);
        expect(a.punkte[3]!.steigt).toBe(true);
        expect(a.seenSteigen).toEqual([0]);
        // Dahinter fällt er zum Gelände zurück.
        expect(a.punkte[4]!.steigt).toBe(false);
        expect([a.von, a.bis]).toEqual([2, 4]);
    });

    it("🔴 ein Fluss, der hinter dem See höher liegt als der See, steigt am Punkt hinter ihm", () => {
        const a = flussAnsicht(
            { p: P, dir: "forward" },
            mitSee(300, [
                { x: 20, y: 10, h: 400 },
                { x: 90, y: 10, h: 800 },
            ]),
            (i) => GELAENDE[i],
        );
        // Zwischen den Marken 400 (s = 10) und See 300 (s = 50) fällt er, zwischen See und 800 (s = 80) steigt er.
        expect(a.punkte[3]!.hoehe).toBe(300);
        expect(a.punkte[4]!.hoehe).toBe(800);
        expect(a.punkte[4]!.steigt).toBe(true);
        expect(a.seenSteigen).toEqual([]);
    });

    it("🔴 ein See ohne eigene Höhe ist kein fester Punkt; ein Stützpunkt im See trägt keine eigene Höhe", () => {
        const a = flussAnsicht(
            { p: P, dir: "forward" },
            mitSee(undefined, [{ x: 60, y: 10, h: 999 }]),
            (i) => GELAENDE[i],
        );
        expect(a.punkte[3]!.fest).toBeNull();
        expect(a.punkte[3]!.eigen).toBeNull();
        expect(a.eigeneHoehen).toBe(false);
        expect(a.punkte.some((q) => q.steigt)).toBe(false);
    });
});

describe("Zahlen und Zuordnung", () => {
    it("Quelle, Mündung und Gefälle folgen den wirksamen Höhen", () => {
        const a = flussAnsicht(
            { p: P, dir: "forward" },
            { ...UMFELD, flussHoehen: [{ x: 30, y: 10, h: 2300 }] },
            (i) => GELAENDE[i],
        );
        expect(flussHoehenZahlen(a)).toEqual({ quelle: 2300, muendung: 420, gefaelle: 1880 });
        expect(a.hoechste).toBe(2300);
        expect(a.tiefste).toBe(420);
        expect(flussHoehenZahlen(flussAnsicht({ p: P, dir: "forward" }, UMFELD, OHNE_GELAENDE))).toBeUndefined();
    });

    const EINGABE = {
        bounds: { min_x: 0, min_y: 0, max_x: 100, max_y: 20 },
        geometry: FLAECHE,
        peaks: [],
        kurve: null,
        // Ein Fluss, der vor der Fläche beginnt (Punkt 0 draußen), dann zwei Stücke drinnen, dazwischen einer draußen.
        fluesse: [
            {
                n: "Probefluss",
                bach: false,
                dir: "forward",
                p: [
                    [-5, 10],
                    [10, 10],
                    [20, 10],
                    [120, 10],
                    [80, 10],
                    [90, 10],
                ] as [number, number][],
            },
        ],
        seen: [
            {
                n: "Probesee",
                g: {
                    type: "Polygon" as const,
                    coordinates: [
                        [
                            [30, 5],
                            [40, 5],
                            [40, 15],
                            [30, 15],
                            [30, 5],
                        ],
                    ],
                },
            },
        ],
        saat: 1,
    } as unknown as EditorGebirge["eingabe"];
    const gew = gewaesserAus(EINGABE);

    it("🔴 jedes Stück kennt seinen Fluss, seinen Anfang im Flussweg und seine Nachbarn (für die Rundung wie auf der Karte)", () => {
        const fluesse = gew.teile.filter((t) => t.art === "fluss");
        expect(fluesse.map((t) => [t.herkunft, t.ab, t.punkte.length])).toEqual([
            [0, 1, 2],
            [0, 4, 2],
        ]);
        expect(fluesse[0]!.vor).toEqual({ x: -5, y: 10 });
        expect(fluesse[0]!.nach).toEqual({ x: 120, y: 10 });
        expect(fluesse[1]!.vor).toEqual({ x: 120, y: 10 });
        expect(fluesse[1]!.nach).toBeUndefined();
        expect(gew.teile.find((t) => t.art === "see")).toMatchObject({ herkunft: 0, ab: 0 });
        expect(zahlDerFluesse(gew)).toBe(1);
    });

    it("Punkte des Flusswegs finden ihr Stück; draußen und im See liegt keiner", () => {
        expect(teilImFluss(gew, 0, 0)).toBeUndefined();
        expect(teilImFluss(gew, 0, 1)).toEqual({ teil: 0, index: 0 });
        expect(teilImFluss(gew, 0, 2)).toEqual({ teil: 0, index: 1 });
        expect(teilImFluss(gew, 0, 3)).toBeUndefined();
        expect(teilImFluss(gew, 0, 5)).toEqual({ teil: 1, index: 1 });
        expect(teilImFluss(gew, 1, 1)).toBeUndefined();
        expect(teilImSee(gew, 0)).toBe(2);
        expect(teilImSee(gew, 3)).toBeUndefined();
    });

    it("🔴 Punkte außerhalb der Fläche sind nicht „drin“ und also im Profil nicht ziehbar", () => {
        const a = flussAnsicht(EINGABE.fluesse[0]!, { seen: EINGABE.seen, flaeche: EINGABE.geometry }, OHNE_GELAENDE);
        expect(a.punkte.map((q) => q.drin)).toEqual([false, true, true, false, true, true]);
    });
});

describe("Die Zeichen auf der Karte (`flussZeichnung`)", () => {
    const EINGABE = {
        bounds: { min_x: 0, min_y: 0, max_x: 100, max_y: 20 },
        geometry: FLAECHE,
        peaks: [],
        kurve: null,
        fluesse: [
            {
                n: "Probefluss",
                bach: false,
                dir: "forward",
                p: [
                    [-5, 10],
                    [10, 10],
                    [20, 10],
                    [120, 10],
                    [80, 10],
                    [90, 10],
                ] as [number, number][],
            },
        ],
        seen: [
            {
                n: "Probesee",
                g: {
                    type: "Polygon" as const,
                    coordinates: [
                        [
                            [30, 5],
                            [40, 5],
                            [40, 15],
                            [30, 15],
                            [30, 5],
                        ],
                    ],
                },
            },
        ],
        saat: 1,
    } as unknown as EditorGebirge["eingabe"];
    const gew = gewaesserAus(EINGABE);
    const TEXTE = { quelle: "Q", muendung: "M" };
    const ansichten = (
        flussHoehen: { x: number; y: number; h: number }[],
        seeHoehen: { x: number; y: number; h: number }[] = [],
    ) => flussAnsichten(EINGABE, { flussHoehen, seeHoehen }, gew, () => 500);

    it("🔴 gefüllt sind nur Stützpunkte mit eigener Höhe; das „!“ sitzt am Punkt, vor dem der Fluss steigt", () => {
        const z = flussZeichnung(ansichten([{ x: 20, y: 10, h: 2300 }]), gew, 0, new Set(), TEXTE);
        expect(z.punkte.map((p) => [p.at.x, p.eigen])).toEqual([
            [10, false],
            [20, true],
            [80, false],
            [90, false],
        ]);
        expect(z.warnungen).toEqual([{ x: 20, y: 10 }]);
        expect(z.seen).toEqual([{ at: { x: 35, y: 10 }, gewaehlt: false }]);
    });

    it("🔴 „Quelle“ und „Mündung“ stehen nur an Enden des Flusswegs, die in der Fläche liegen", () => {
        // Der Weg beginnt draußen (kein „Quelle“) und endet bei (90, 10) in der Fläche (die Mündung).
        const z = flussZeichnung(ansichten([]), gew, 0, new Set(), TEXTE);
        expect(z.enden).toEqual([{ at: { x: 90, y: 10 }, text: "M" }]);
        expect(z.warnungen).toEqual([]);
    });

    it("die gewählten Seen tragen es im Zeichen; der See, in den der Fluss steigt, trägt das „!“", () => {
        // Der Fluss läuft (hier erfunden) durch den See: ein Fluss, dessen Punkt im See liegt, und ein See mit hoher Höhe.
        const durch = {
            ...EINGABE,
            fluesse: [
                {
                    n: "Seefluss",
                    bach: false,
                    dir: "forward",
                    p: [
                        [10, 10],
                        [20, 10],
                        [35, 10],
                        [60, 10],
                    ] as [number, number][],
                },
            ],
        } as unknown as EditorGebirge["eingabe"];
        const g2 = gewaesserAus(durch);
        const a = flussAnsichten(durch, { seeHoehen: [{ x: 35, y: 10, h: 1500 }] }, g2, () => 400);
        const basis = 0;
        const seeNr = basis + g2.teile.findIndex((t) => t.art === "see");
        const z = flussZeichnung(a, g2, basis, new Set([`${String(seeNr)}:0`]), TEXTE);
        expect(z.seen).toEqual([{ at: { x: 35, y: 10 }, gewaehlt: true }]);
        expect(z.warnungen).toContainEqual({ x: 35, y: 10 });
        expect(steigendeFluesse(a, g2, durch)).toEqual(["Seefluss"]);
    });

    it("die Namen der steigenden Flüsse stehen für die Gestenzeile bereit; ohne Steigen keiner", () => {
        expect(steigendeFluesse(ansichten([{ x: 20, y: 10, h: 2300 }]), gew, EINGABE)).toEqual(["Probefluss"]);
        expect(steigendeFluesse(ansichten([]), gew, EINGABE)).toEqual([]);
        expect(KEIN_FLUSS.punkte).toEqual([]);
    });
});

describe("Die Rundung wie auf der Karte (`GEBIRGSNETZ.rundung`)", () => {
    const VOLL = [
        { x: -5, y: 10 },
        { x: 10, y: 12 },
        { x: 20, y: 8 },
        { x: 30, y: 14 },
        { x: 120, y: 10 },
    ];
    const teil = (anschluss: boolean, art: "linie" | "punkt" = "linie", fest = true): Teil => ({
        objekt: "f",
        name: "x",
        nr: 1,
        art,
        punkte: VOLL.slice(1, 4),
        revision: 1,
        ...(fest ? { fest: true } : {}),
        ...(anschluss ? { anschluss: { vor: VOLL[0], nach: VOLL[4] } } : {}),
    });

    it("🔴 ein Stück mitten im Flussweg hat genau die Kurve des ganzen Wegs auf der Karte (Catmull-Rom, Nachbarn in den Tangenten)", () => {
        const karte = catmullRomLine(VOLL);
        const t = teil(true);
        expect(GEBIRGSNETZ.rundung(t.punkte, t)).toEqual(karte.slice(8, 8 * 3 + 1));
    });

    it("ohne Nachbarn ist es die Kurve durch das Stück allein; Anfang und Ende bleiben die Stützpunkte", () => {
        const t = teil(false);
        const kurve = GEBIRGSNETZ.rundung(t.punkte, t);
        expect(kurve).toEqual(catmullRomLine(t.punkte));
        expect(kurve[0]).toEqual(VOLL[1]);
        expect(kurve.at(-1)).toEqual(VOLL[3]);
    });

    it("🔴 Kämme bleiben gerade: nur ein Teil nur zum Wählen (Fluss) wird gerundet", () => {
        const kamm = teil(false, "linie", false);
        expect(GEBIRGSNETZ.rundung(kamm.punkte, kamm)).toEqual(kamm.punkte);
        expect(GEBIRGSNETZ.rundung(kamm.punkte)).toEqual(kamm.punkte);
    });
});
