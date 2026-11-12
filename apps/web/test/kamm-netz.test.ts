import { describe, expect, it } from "vitest";
import { GEBIRGSNETZ } from "../src/map/geometrie/arten";
import {
    GEBIRGE_LEER,
    mitKammhoeheSkaliert,
    netzZumSchreiben,
    type GebirgsEntwurf,
} from "../src/landschaftseditor/gebirge-stand";
import {
    eigeneHoehe,
    istKamm,
    istNebengipfel,
    LEERES_NETZ,
    mitHoehe,
    mitHoehen,
    netzSkaliert,
    punkteDerAuswahl,
    mitKamm,
    mitNebengipfel,
    mitMulde,
    istMulde,
    mitRang,
    netzAus,
    netzHatTeile,
    netzZiele,
    ohneTeil,
    startWerkzeug,
    teileAus,
    type GebirgsNetz,
} from "../src/landschaftseditor/kamm-netz";

/**
 * Das Netz eines Gebirges im Entwurf (WI-0245 D2). Problemfälle: Nach dem Ziehen gehen Rang oder Höhe verloren; ein Nebengipfel wird zum
 * Kamm, weil die `nr` verrutschen; ein Kammende rastet am eigenen Kamm ein; ein Gipfel fehlt unter den Zielen; eine Höhe kommt als
 * Bruch oder unter 0 an.
 */
const F = "f1f1f1f1-0000-4000-8000-0000000000a1";
const NETZ: GebirgsNetz = {
    kaemme: [
        {
            punkte: [
                [500, 510],
                [510, 512],
            ],
            rang: "haupt",
        },
        {
            punkte: [
                [510, 512],
                [512, 520],
                [515, 525],
            ],
            rang: "neben",
        },
    ],
    nebengipfel: [{ x: 505, y: 505, h: 1800 }],
};

describe("Gebirgsnetz im Entwurf (WI-0245 D2)", () => {
    it("setzt die Höhe eines ganzen Kamms an allen Stützpunkten, auch am deckungsgleichen Ende des Nachbarn; leeres Feld setzt zurück", () => {
        const netz = mitHoehe(NETZ, 1, 2100);
        // Der Knoten (510, 512) gehört beiden Kämmen: EIN Ort, EINE Höhe (WI-0249 P9).
        expect(netz.kaemme[0]!.hoehen).toEqual([null, 2100]);
        expect(netz.kaemme[1]!.hoehen).toEqual([2100, 2100, 2100]);
        expect(netz.nebengipfel).toEqual(NETZ.nebengipfel);
        const teile = teileAus(F, "Probe", netz, 1);
        teile[1] = {
            ...teile[1]!,
            punkte: [
                { x: 510, y: 512 },
                { x: 512, y: 520 },
                { x: 516, y: 526 },
            ],
        };
        expect(netzAus(teile, netz).kaemme[1]!.hoehen).toEqual([2100, 2100, 2100]);
        const zurueck = mitHoehe(netz, 1, null);
        expect(zurueck.kaemme[1]).not.toHaveProperty("hoehen");
        expect(zurueck.kaemme[0]).not.toHaveProperty("hoehen");
    });
    it("🔴 Teile: Kämme als Linien mit nr 0…, Nebengipfel als Punkte dahinter; zurück bleiben Rang und Höhe", () => {
        const teile = teileAus(F, "Probe", NETZ, 3);
        expect(teile.map((t) => [t.nr, t.art, t.punkte.length])).toEqual([
            [0, "linie", 2],
            [1, "linie", 3],
            [2, "punkt", 1],
        ]);
        const gezogen = teile.map((t) =>
            t.nr === 2
                ? { ...t, punkte: [{ x: 506, y: 506 }] }
                : t.nr === 0
                  ? { ...t, punkte: [t.punkte[0]!, { x: 511, y: 513 }] }
                  : t,
        );
        expect(netzAus(gezogen, NETZ)).toEqual({
            kaemme: [
                {
                    punkte: [
                        [500, 510],
                        [511, 513],
                    ],
                    rang: "haupt",
                },
                NETZ.kaemme[1],
            ],
            nebengipfel: [{ x: 506, y: 506, h: 1800 }],
        });
    });

    it("🔴 Anhängen, Rang, Höhe, Entfernen: Ein Nebengipfel bleibt ein Nebengipfel", () => {
        const mehr = mitNebengipfel(
            mitKamm(
                NETZ,
                [
                    { x: 1, y: 2 },
                    { x: 3, y: 4 },
                ],
                "neben",
            ),
            { x: 7, y: 8 },
        );
        expect(mehr.kaemme).toHaveLength(3);
        expect(mehr.nebengipfel.at(-1)).toEqual({ x: 7, y: 8, h: null });
        expect(istKamm(mehr, 2)).toBe(true);
        expect(istNebengipfel(mehr, 3)).toBe(true);
        expect(mitRang(NETZ, 1, "haupt").kaemme[1]!.rang).toBe("haupt");
        expect(mitRang(NETZ, 2, "haupt")).toBe(NETZ);
        expect(mitHoehe(NETZ, 2, 1234.6).nebengipfel[0]!.h).toBe(1235);
        expect(mitHoehe(NETZ, 2, -5).nebengipfel[0]!.h).toBe(0);
        expect(mitHoehe(NETZ, 2, null).nebengipfel[0]!.h).toBeNull();
        expect(ohneTeil(NETZ, 0).kaemme).toEqual([NETZ.kaemme[1]]);
        expect(ohneTeil(NETZ, 2).nebengipfel).toEqual([]);
        expect(ohneTeil(LEERES_NETZ, 0)).toBe(LEERES_NETZ);
    });

    it("🔴 Ziele: Gipfel und Nebengipfel als `gipfel`, Kammpunkte als `ecke`; ein Ende rastet nie am eigenen Kamm", () => {
        const ziele = netzZiele(F, "Probe", NETZ, [{ id: "g1", name: "Zinne", position: [520, 530] }]);
        expect(ziele.filter((z) => z.art === "gipfel").map((z) => z.objekt)).toEqual(["g1", F]);
        expect(ziele.filter((z) => z.art === "ecke")).toHaveLength(5);
        const teile = teileAus(F, "Probe", NETZ, 1);
        const ende = { objekt: F, nr: 1, index: 2 };
        const eigene = ziele.find((z) => z.stelle?.nr === 1)!;
        const fremde = ziele.find((z) => z.stelle?.nr === 0)!;
        expect(GEBIRGSNETZ.ziele(ende, teile[1]!)).toEqual(["gipfel", "ecke"]);
        expect(GEBIRGSNETZ.ziele({ ...ende, index: 1 }, teile[1]!)).toEqual([]);
        expect(GEBIRGSNETZ.zielErlaubt(eigene, ende, teile[1]!)).toBe(false);
        expect(GEBIRGSNETZ.zielErlaubt(fremde, ende, teile[1]!)).toBe(true);
        expect(GEBIRGSNETZ.loeschbar({ objekt: F, nr: 2, index: 0 }, teile[2]!)).toBe(false);
        expect(GEBIRGSNETZ.loeschbar({ objekt: F, nr: 1, index: 1 }, teile[1]!)).toBe(true);
    });
});

describe("Startwerkzeug von „Kämme zeichnen“ (OPS-055, OPS-057)", () => {
    it("🔴 ohne Netz beginnt das Zeichnen, mit Kamm, Nebengipfel, Tal oder Mulde „Wählen“", () => {
        expect(netzHatTeile(LEERES_NETZ)).toBe(false);
        expect(startWerkzeug(LEERES_NETZ)).toBe("kamm");
        // Ein Netz ohne `mulden` (älterer Stand) ist leer wie das leere Netz.
        expect(startWerkzeug({ kaemme: [], nebengipfel: [] })).toBe("kamm");
        expect(startWerkzeug({ kaemme: [], nebengipfel: [], mulden: [] })).toBe("kamm");
        expect(startWerkzeug(NETZ)).toBe("waehlen");
        // Nur Nebengipfel, nur Mulde, nur ein Tal (Kamm vom Rang `tal`): Es steht schon etwas da, das sich bearbeiten lässt.
        expect(startWerkzeug({ kaemme: [], nebengipfel: [{ x: 1, y: 2, h: null }] })).toBe("waehlen");
        expect(startWerkzeug(mitMulde(LEERES_NETZ, { x: 1, y: 2 }))).toBe("waehlen");
        expect(
            startWerkzeug(
                mitKamm(
                    LEERES_NETZ,
                    [
                        { x: 1, y: 2 },
                        { x: 3, y: 4 },
                    ],
                    "tal",
                ),
            ),
        ).toBe("waehlen");
        // Nach „Alles leeren“ beginnt der Modus wieder mit dem Zeichnen.
        expect(startWerkzeug(ohneTeil(mitNebengipfel(LEERES_NETZ, { x: 1, y: 2 }), 0))).toBe("kamm");
    });
});

describe("Tal und Mulde im gemeinsamen Geometriemodus", () => {
    it("erhält Rang und Bodenhöhe beim Ziehen und entfernt gezielt die Mulde", () => {
        const netz = mitMulde(
            mitKamm(
                LEERES_NETZ,
                [
                    { x: 500, y: 500 },
                    { x: 510, y: 510 },
                ],
                "tal",
            ),
            { x: 505, y: 505 },
        );
        expect(istMulde(netz, 1)).toBe(true);
        const mitBoden = mitHoehe(netz, 1, 0);
        const teile = teileAus(F, "Gebirge", mitBoden, 1);
        teile[1] = { ...teile[1]!, punkte: [{ x: 506, y: 507 }] };
        const gezogen = netzAus(teile, mitBoden);
        expect(gezogen.kaemme[0]!.rang).toBe("tal");
        expect(gezogen.mulden).toEqual([{ x: 506, y: 507, h: 0 }]);
        expect(mitHoehe(gezogen, 1, null).mulden![0]!.h).toBeNull();
        expect(ohneTeil(gezogen, 1).mulden).toEqual([]);
        expect(gezogen.kaemme).toEqual(netz.kaemme);
    });
});

/**
 * Höhen je Punkt (WI-0249 P9). Problemfälle: Ein Ort trägt zwei Höhen (Knoten, Kammende auf einem Nebengipfel); eine Höhe springt nach dem
 * Einfügen oder Löschen eines Punkts zum Nachbarn; eine Höhe kommt als `null`-Liste zum Server (ajv macht daraus 0); die Kammhöhe ändert sich,
 * und die eigenen Punkthöhen bleiben stehen oder Vorgaben werden zu eigenen Werten; eine Mehrfachauswahl trifft nicht alle Punkte.
 */
describe("Höhen je Punkt (WI-0249 P9)", () => {
    const MIT_HOEHEN: GebirgsNetz = {
        kaemme: [
            {
                punkte: [
                    [500, 510],
                    [505, 511],
                    [510, 512],
                ],
                rang: "haupt",
                hoehen: [2000, null, 3000],
            },
            {
                punkte: [
                    [510, 512],
                    [505, 505],
                ],
                rang: "tal",
            },
        ],
        nebengipfel: [{ x: 505, y: 505, h: null }],
        mulden: [{ x: 520, y: 520, h: 400 }],
    };

    it("🔴 ein Ort, eine Höhe: Setzen trifft deckungsgleiche Stützpunkte, Nebengipfel und Mulden", () => {
        const netz = mitHoehen(MIT_HOEHEN, [{ nr: 1, index: 1, h: 2600.4 }]);
        expect(netz.kaemme[1]!.hoehen).toEqual([null, 2600]);
        expect(netz.nebengipfel[0]!.h).toBe(2600);
        const knoten = mitHoehen(MIT_HOEHEN, [{ nr: 0, index: 2, h: 70000 }]);
        expect(knoten.kaemme[0]!.hoehen).toEqual([2000, null, 65535]);
        expect(knoten.kaemme[1]!.hoehen).toEqual([65535, null]);
        expect(eigeneHoehe(knoten, { nr: 1, index: 0 })).toBe(65535);
    });

    it("🔴 Mehrfachauswahl: ganze Linien zählen mit allen Stützpunkten, Doppel einmal", () => {
        expect(punkteDerAuswahl(MIT_HOEHEN, [{ nr: 0 }, { nr: 0, index: 1 }, { nr: 2 }, { nr: 3 }, { nr: 9 }])).toEqual(
            [
                { nr: 0, index: 0 },
                { nr: 0, index: 1 },
                { nr: 0, index: 2 },
                { nr: 2, index: 0 },
                { nr: 3, index: 0 },
            ],
        );
    });

    it("🔴 ein eingefügter Punkt bekommt die Höhe zwischen seinen Nachbarn, ein gelöschter nimmt seine mit", () => {
        const teile = teileAus(F, "Probe", MIT_HOEHEN, 1);
        const eingefuegt = teile.map((t) =>
            t.nr === 0
                ? {
                      ...t,
                      punkte: [
                          { x: 500, y: 510 },
                          { x: 505, y: 511 },
                          { x: 507.5, y: 511.5 },
                          { x: 510, y: 512 },
                      ],
                  }
                : t,
        );
        const mehr = netzAus(eingefuegt, MIT_HOEHEN).kaemme[0]!.hoehen!;
        expect(mehr[0]).toBe(2000);
        expect(mehr[1]).toBeNull();
        // Zwischen 2000 (bei 500) und 3000 (bei 510): an 507,5 rund drei Viertel des Wegs.
        expect(mehr[2]).toBeGreaterThan(2700);
        expect(mehr[2]).toBeLessThan(2800);
        expect(mehr[3]).toBe(3000);
        const geloescht = teile.map((t) =>
            t.nr === 0
                ? {
                      ...t,
                      punkte: [
                          { x: 500, y: 510 },
                          { x: 510, y: 512 },
                      ],
                  }
                : t,
        );
        expect(netzAus(geloescht, MIT_HOEHEN).kaemme[0]!.hoehen).toEqual([2000, 3000]);
    });

    it("🔴 ein neuer Kamm trägt seine Startwerte; ohne eigene Höhe kein Feld `hoehen`", () => {
        const neu = mitKamm(
            LEERES_NETZ,
            [
                { x: 1, y: 1 },
                { x: 2, y: 2 },
            ],
            "neben",
            [4000, null],
        );
        expect(neu.kaemme[0]!.hoehen).toEqual([4000, null]);
        const ohne = mitKamm(
            LEERES_NETZ,
            [
                { x: 1, y: 1 },
                { x: 2, y: 2 },
            ],
            "tal",
            [null, null],
        );
        expect(ohne.kaemme[0]).not.toHaveProperty("hoehen");
        expect(mitNebengipfel(LEERES_NETZ, { x: 3, y: 3 }, 4000).nebengipfel[0]!.h).toBe(4000);
    });

    it("🔴 geschrieben als Paare `[Stelle, Höhe]`, nie als Liste mit null", () => {
        const geschrieben = netzZumSchreiben(MIT_HOEHEN);
        expect(geschrieben.kaemme[0]).toEqual({
            punkte: MIT_HOEHEN.kaemme[0]!.punkte,
            rang: "haupt",
            hoehen: [
                [0, 2000],
                [2, 3000],
            ],
        });
        expect(geschrieben.kaemme[1]).toEqual({ punkte: MIT_HOEHEN.kaemme[1]!.punkte, rang: "tal" });
        expect(JSON.stringify(geschrieben)).not.toContain("null");
    });

    it("🔴 Kammhöhe ändern nimmt die eigenen Punkthöhen verhältnisgleich mit; Vorgaben bleiben Vorgaben", () => {
        const vorher: GebirgsEntwurf = { ...GEBIRGE_LEER, kammhoehe: 2000, netz: MIT_HOEHEN };
        const neu = mitKammhoeheSkaliert(vorher, { ...vorher, kammhoehe: 3000 }, null);
        expect(neu.kammhoehe).toBe(3000);
        expect(neu.netz!.kaemme[0]!.hoehen).toEqual([3000, null, 4500]);
        expect(neu.netz!.kaemme[1]).not.toHaveProperty("hoehen");
        expect(neu.netz!.nebengipfel[0]!.h).toBeNull();
        expect(neu.netz!.mulden![0]!.h).toBe(600);
        // Zurück auf die Grundhöhe (↺): das Verhältnis zur Kammhöhe, die dann gilt.
        expect(mitKammhoeheSkaliert(neu, { ...neu, kammhoehe: null }, 1500).netz!.kaemme[0]!.hoehen).toEqual([
            1500,
            null,
            2250,
        ]);
        // Ohne Änderung der Kammhöhe bleibt alles, wie es ist.
        const gleich = { ...vorher, typ: "kettengebirge" as const };
        expect(mitKammhoeheSkaliert(vorher, gleich, null)).toBe(gleich);
        expect(netzSkaliert(MIT_HOEHEN, 1)).toBe(MIT_HOEHEN);
    });
});
