import { describe, expect, it } from "vitest";
import { PUNKT_HOEHE_GRENZEN } from "@avesmaps3d/shared";
import {
    gezogeneHoehe,
    hoeheAmProfil,
    hoeheVonY,
    PROFIL_SCHRITT,
    profilAchse,
    profilGriffe,
    profilRand,
    profilX,
    seePlatten,
    yVonHoehe,
} from "../src/landschaftseditor/gebirge-profil-fluss";
import { flussAnsicht } from "../src/landschaftseditor/kamm-netz-fluss";

/**
 * Das Höhenprofil eines Flusses mit eigenen Höhen (WI-0259, OPS-071): Griffe, Achse, Umrechnung zwischen Zeiger und Höhe, Platten der Seen.
 * Problemfälle: Ein Griff sitzt nicht an der Bogenlänge seines Stützpunkts; die Quelle steht rechts, wenn der Fluss gegen die Zeichenrichtung
 * fließt; ein Griff im See zählt als Punkt des Flusses; ein Zug lässt sich unter 0 oder über die Grenzen ziehen; die Achse hat keine Luft zum
 * Hochziehen.
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
const P: [number, number][] = [
    [10, 10],
    [20, 10],
    [30, 10],
    [60, 10],
    [90, 10],
];

describe("Griffe an den Stützpunkten", () => {
    const ansicht = (dir: "forward" | "reverse") =>
        flussAnsicht(
            { p: P, dir },
            { seen: [], flaeche: FLAECHE, flussHoehen: [{ x: 30, y: 10, h: 2300 }] },
            (i) => [500, 480, 460, 440, 420][i],
        );

    it("🔴 x ist die Bogenlänge des Stützpunkts, geteilt durch die Länge; links steht die Quelle", () => {
        const g = profilGriffe(ansicht("forward"));
        expect(g.map((q) => q.k)).toEqual([0, 1, 2, 3, 4]);
        // Bogenlängen 0, 10, 20, 50, 80 von 80.
        expect(g.map((q) => q.x)).toEqual([0, 10 / 80, 20 / 80, 50 / 80, 1]);
        expect(g.map((q) => q.h)).toEqual([500, 480, 2300, 440, 420]);
        expect(g.map((q) => q.eigen)).toEqual([false, false, true, false, false]);
        expect(g[2]!.steigt).toBe(true);
    });

    it("🔴 gegen die Zeichenrichtung steht die Quelle rechts: Das Profil dreht sich, nicht die Daten", () => {
        const g = profilGriffe(ansicht("reverse"));
        expect(g.map((q) => q.k)).toEqual([0, 1, 2, 3, 4]);
        expect(g.map((q) => q.x)).toEqual([1, 70 / 80, 60 / 80, 30 / 80, 0]);
    });

    it("🔴 Punkte im See tragen keinen Griff (dort gilt der See), Punkte außerhalb der Fläche sind nicht „drin“", () => {
        const a = flussAnsicht(
            { p: [...P, [120, 10]], dir: "forward" },
            {
                flaeche: FLAECHE,
                seen: [
                    {
                        g: {
                            type: "Polygon",
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
                    },
                ],
            },
            () => 300,
        );
        const g = profilGriffe(a);
        expect(g.map((q) => q.k)).toEqual([0, 1, 2, 4, 5]);
        expect(g.map((q) => q.drin)).toEqual([true, true, true, true, false]);
    });

    it("ein Punkt ohne bekannte Höhe hat keinen Griff", () => {
        const a = flussAnsicht({ p: P, dir: "forward" }, { seen: [], flaeche: FLAECHE }, (i) =>
            i === 2 ? undefined : 300,
        );
        expect(profilGriffe(a).map((q) => q.k)).toEqual([0, 1, 3, 4]);
        // Ein Punkt außerhalb der Fläche bekommt seinen grauen Griff auf der Höhe des Höhenmodells, wenn es sie kennt.
        const aussen = flussAnsicht({ p: [...P, [120, 10]], dir: "forward" }, { seen: [], flaeche: FLAECHE }, (i) =>
            i === 5 ? undefined : 300,
        );
        expect(profilGriffe(aussen).map((q) => q.k)).toEqual([0, 1, 2, 3, 4]);
        const mit = profilGriffe(aussen, (k) => (k === 5 ? 250 : undefined));
        expect(mit.at(-1)).toMatchObject({ k: 5, h: 250, drin: false });
    });
});

describe("Achse und Umrechnung", () => {
    it("🔴 mit Luft: unten ein Zehntel, oben über ein Drittel der Spanne; ohne wie bisher knapp", () => {
        expect(profilAchse([500, 2300], true)).toEqual({ lo: 320, hi: 2930 });
        expect(profilAchse([500, 2300], false)).toEqual({ lo: 500, hi: 2300 });
        // Nie unter 0, auch wenn das Zehntel darunter fiele.
        expect(profilAchse([50, 2300], true).lo).toBe(0);
        // Eine flache Linie hat trotzdem eine Spanne.
        expect(profilAchse([700, 700], false)).toEqual({ lo: 700, hi: 701 });
        expect(profilAchse([], true)).toEqual({ lo: 0, hi: 1 });
    });

    it("y und Höhe sind Umkehrungen voneinander, der Rand bleibt frei", () => {
        const achse = profilAchse([500, 2300], true);
        const H = 160;
        const rand = profilRand(true);
        expect(rand).toBe(11);
        expect(profilRand(false)).toBe(4);
        expect(yVonHoehe(achse.lo, achse, H, rand)).toBeCloseTo(H - rand, 9);
        expect(yVonHoehe(achse.hi, achse, H, rand)).toBeCloseTo(rand, 9);
        for (const h of [320, 500, 1234, 2300, 2930])
            expect(hoeheVonY(yVonHoehe(h, achse, H, rand), achse, H, rand)).toBeCloseTo(h, 6);
    });

    it("🔴 ein Zug rundet auf 10er-Schritt und bleibt in der Achse und in den Grenzen einer Punkthöhe", () => {
        const achse = { lo: 320, hi: 2930 };
        expect(PROFIL_SCHRITT).toBe(10);
        expect(gezogeneHoehe(1234, achse)).toBe(1230);
        expect(gezogeneHoehe(1235, achse)).toBe(1240);
        expect(gezogeneHoehe(100, achse)).toBe(320);
        expect(gezogeneHoehe(5000, achse)).toBe(2930);
        // Ohne Achse (Tastatur) gelten nur die Grenzen der Punkthöhe.
        const offen = { lo: Number.NEGATIVE_INFINITY, hi: Number.POSITIVE_INFINITY };
        expect(gezogeneHoehe(-40, offen)).toBe(PUNKT_HOEHE_GRENZEN.min);
        expect(gezogeneHoehe(70000, offen)).toBe(PUNKT_HOEHE_GRENZEN.max);
    });
});

describe("Höhe des Höhenmodells am Profil", () => {
    const profil = { at: [0, 10, 20, 30], h: [900, null, 700, 300] };
    it("linear zwischen den bekannten Proben, an den Enden die erste und die letzte", () => {
        expect(hoeheAmProfil(profil, 0)).toBe(900);
        expect(hoeheAmProfil(profil, 10)).toBe(800);
        expect(hoeheAmProfil(profil, 15)).toBe(750);
        expect(hoeheAmProfil(profil, 25)).toBe(500);
        expect(hoeheAmProfil(profil, 99)).toBe(300);
        expect(hoeheAmProfil({ at: [], h: [] }, 5)).toBeUndefined();
    });
});

describe("Platten der Seen", () => {
    const SEE = {
        g: {
            type: "Polygon" as const,
            coordinates: [
                [
                    [35, 5],
                    [75, 5],
                    [75, 15],
                    [35, 15],
                    [35, 5],
                ],
            ],
        },
    };
    // Abtastung alle 10 E entlang der Geraden y = 10.
    const profil = { at: [0, 10, 20, 30, 40, 50, 60, 70, 80], h: [900, 880, 860, 840, 800, 790, 780, 600, 500] };
    const lagen = profil.at.map((s) => [10 + s, 10] as const);
    const achse = { vorwaerts: true, gesamt: 80 };

    it("🔴 die Platte reicht über die Proben im See; ohne eigenen Spiegel steht ihre Oberkante an der höchsten Stelle", () => {
        const [p] = seePlatten(achse, profil, lagen, [SEE], [null]);
        expect(p).toMatchObject({ see: 0, eigen: false, h: 840 });
        // Im See liegen die Proben bei x = 40 … 70 (Bogenlänge 30 bis 60).
        expect(p!.x0).toBeCloseTo(30 / 80, 9);
        expect(p!.x1).toBeCloseTo(60 / 80, 9);
        expect(p!.kurve.map(([, h]) => h)).toEqual([840, 800, 790, 780]);
    });

    it("🔴 mit eigenem Spiegel steht die Platte darauf, flach, und gilt als eigen", () => {
        const [p] = seePlatten(achse, profil, lagen, [SEE], [1500]);
        expect(p).toMatchObject({ see: 0, eigen: true, h: 1500 });
    });

    it("gegen die Zeichenrichtung steht die Platte gespiegelt; ein See ohne zwei Proben hat keine", () => {
        const [p] = seePlatten({ vorwaerts: false, gesamt: 80 }, profil, lagen, [SEE], [null]);
        expect(p!.x0).toBeCloseTo(1 - 60 / 80, 9);
        expect(p!.x1).toBeCloseTo(1 - 30 / 80, 9);
        expect(
            seePlatten(
                achse,
                { at: [0, 10, 20], h: [1, 2, 3] },
                [
                    [1, 1],
                    [2, 2],
                    [3, 3],
                ],
                [SEE],
                [null],
            ),
        ).toEqual([]);
        expect(profilX({ vorwaerts: true, gesamt: 0 }, 5)).toBe(0);
    });
});
