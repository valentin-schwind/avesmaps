import { describe, expect, it } from "vitest";
import type { EditorGebirge } from "@avesmaps3d/shared";
import {
    eigeneHoehe,
    hoehenOrte,
    loeschArt,
    mitHoehen,
    netzAus,
    ohneAuswahl,
    punkteDerAuswahl,
    teileAus,
    wasserBasis,
    wasserPunkteMitHoehe,
    type GebirgsNetz,
} from "../src/landschaftseditor/kamm-netz";
import { gewaesserAus } from "../src/landschaftseditor/kamm-netz-wasser";
import { netzZumSchreiben } from "../src/landschaftseditor/gebirge-stand";

/**
 * Flüsse und Seen im Kammeditor (WI-0249; Vali 2026-10-25: „ein fluss wird aber nicht im kammeditor erstellt, sondern automatisch erkannt und ist
 * einfach "da" wo er ist … bei seen will man im kammeditor ebenfalls die höhe einstellen können“; Vali wählte A, 2026-10-26). Problemfälle: ein
 * Fluss außerhalb der Fläche erscheint; ein Stück außerhalb verbindet zwei Stücke innen; Flüsse lassen sich ziehen; eine Höhe am Fluss trifft
 * einen Kamm an derselben Stelle; ein See trägt zwei Höhen; ohne eigene Höhen ändert sich das Netz.
 */

const QUADRAT = {
    type: "Polygon" as const,
    coordinates: [
        [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
            [0, 0],
        ],
    ],
};
const EINGABE = {
    bounds: { min_x: 0, min_y: 0, max_x: 10, max_y: 10 },
    geometry: QUADRAT,
    peaks: [],
    kurve: null,
    // Ein Fluss, der hinaus und wieder hinein läuft, und einer ganz außerhalb.
    fluesse: [
        {
            n: "Probefluss",
            bach: false,
            dir: null,
            p: [
                [-2, 5],
                [2, 5],
                [4, 5],
                [12, 5],
                [8, 6],
                [6, 6],
            ] as [number, number][],
        },
        {
            n: "Draußen",
            bach: false,
            dir: null,
            p: [
                [20, 20],
                [30, 20],
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
                        [6, 1],
                        [9, 1],
                        [9, 3],
                        [6, 3],
                        [6, 1],
                    ],
                ],
            },
        },
    ],
    saat: 1,
} as unknown as EditorGebirge["eingabe"];

const NETZ: GebirgsNetz = {
    kaemme: [
        {
            punkte: [
                [2, 5],
                [2, 8],
            ],
            rang: "haupt",
        },
    ],
    nebengipfel: [],
};

describe("Flüsse und Seen erkannt (`gewaesserAus`)", () => {
    const gew = gewaesserAus(EINGABE);

    it("🔴 je Fluss die zusammenhängenden Stücke in der Fläche, ein Fluss draußen fehlt; je See sein Platz", () => {
        expect(gew.teile.map((t) => [t.art, t.punkte.map((p) => [p.x, p.y])])).toEqual([
            [
                "fluss",
                [
                    [2, 5],
                    [4, 5],
                ],
            ],
            [
                "fluss",
                [
                    [8, 6],
                    [6, 6],
                ],
            ],
            ["see", [[7.5, 2]]],
        ]);
    });

    it("🔴 ein Stützpunkt im See gehört nicht zum Fluss: Dort gilt der See, das Stück endet davor", () => {
        const durchDenSee = gewaesserAus({
            ...EINGABE,
            fluesse: [
                {
                    n: "Seefluss",
                    bach: false,
                    dir: null,
                    p: [
                        [5, 2],
                        [7, 2],
                        [8, 2],
                        [9.5, 2],
                    ],
                },
            ],
        } as unknown as EditorGebirge["eingabe"]);
        expect(durchDenSee.teile.filter((t) => t.art === "fluss").map((t) => t.punkte.map((q) => [q.x, q.y]))).toEqual([
            [[5, 2]],
            [[9.5, 2]],
        ]);
    });

    it("🔴 hinter dem Netz nummeriert, nur zum Wählen (`fest`), nie in einer Handbewegung", () => {
        const teile = teileAus("f", "Probe", NETZ, 1, gew);
        const wasser = teile.filter((t) => t.fest === true);
        expect(wasser.map((t) => [t.nr, t.art])).toEqual([
            [1, "linie"],
            [2, "linie"],
            [3, "punkt"],
        ]);
        expect(wasserBasis(NETZ)).toBe(1);
        // Ein Zug am Kamm lässt die Flüsse, wie sie sind; das Netz trägt sie nicht.
        expect(netzAus(teile, NETZ)).toEqual(NETZ);
    });

    it("🔴 Höhen nach Lage: am Fluss je Stützpunkt, ein Kamm an derselben Stelle bleibt; ein See trägt EINE Höhe", () => {
        // Der Kamm beginnt bei (2, 5), wo auch der Fluss einen Stützpunkt hat.
        let netz = mitHoehen(netz0(), [{ nr: 1, index: 0, h: 1200 }], gew);
        expect(netz.flussHoehen).toEqual([{ x: 2, y: 5, h: 1200 }]);
        expect(netz.kaemme[0]!.hoehen).toBeUndefined();
        expect(eigeneHoehe(netz, { nr: 1, index: 0 }, gew)).toBe(1200);
        expect(eigeneHoehe(netz, { nr: 1, index: 1 }, gew)).toBeNull();
        netz = mitHoehen(netz, [{ nr: 3, index: 0, h: 800 }], gew);
        netz = mitHoehen(netz, [{ nr: 3, index: 0, h: 850 }], gew);
        expect(netz.seeHoehen).toEqual([{ x: 7.5, y: 2, h: 850 }]);
        // Ein ganzes Stück ist gewählt wie ein ganzer Kamm: alle seine Punkte.
        expect(punkteDerAuswahl(netz, [{ nr: 2 }], gew)).toEqual([
            { nr: 2, index: 0 },
            { nr: 2, index: 1 },
        ]);
        // Die Beschriftung kennt sie: eigen mit Höhe, sonst ohne Zahl (NaN, die Fläche der Vorschau setzt sie ein).
        const orte = hoehenOrte(
            netz,
            {
                linien: [
                    [
                        { h: 2300, eigen: false },
                        { h: 2300, eigen: false },
                    ],
                ],
                nebengipfel: [],
                mulden: [],
            },
            gew,
        );
        expect(orte.find((o) => o.punkte[0]?.nr === 3)).toMatchObject({ h: 850, eigen: true });
        expect(Number.isNaN(orte.find((o) => o.punkte[0]?.nr === 2)!.h)).toBe(true);
        // Leer gesetzt fällt die Liste weg: Das Netz ist wieder das ohne Wasserhöhen.
        netz = mitHoehen(
            netz,
            [
                { nr: 1, index: 0, h: null },
                { nr: 3, index: 0, h: null },
            ],
            gew,
        );
        expect(netz).toEqual(NETZ);
    });

    it("geschrieben werden beide Listen immer (leer nimmt die gespeicherten weg)", () => {
        expect(netzZumSchreiben(NETZ)).toMatchObject({ flussHoehen: [], seeHoehen: [] });
        expect(netzZumSchreiben({ ...NETZ, seeHoehen: [{ x: 7.5, y: 2, h: 900 }] }).seeHoehen).toEqual([
            { x: 7.5, y: 2, h: 900 },
        ]);
    });
});

describe("„Löschen“ an Flüssen und Seen (WI-0259, OPS-071)", () => {
    const gew = gewaesserAus(EINGABE);
    const mitHoehen0 = (): GebirgsNetz =>
        mitHoehen(
            netz0(),
            [
                { nr: 1, index: 0, h: 1200 },
                { nr: 1, index: 1, h: 1100 },
                { nr: 3, index: 0, h: 800 },
            ],
            gew,
        );

    it("🔴 Löschen nimmt die eigenen Höhen gewählter Flusspunkte weg und lässt den Verlauf stehen", () => {
        const netz = mitHoehen0();
        const aus = ohneAuswahl(netz, [{ nr: 1, index: 0 }], gew);
        expect(aus.flussHoehen).toEqual([{ x: 4, y: 5, h: 1100 }]);
        // Der Verlauf ist unberührt: gleiche Kämme, gleiche Punkte der Flussstücke, der See behält seine Höhe.
        expect(aus.kaemme).toEqual(netz.kaemme);
        expect(aus.seeHoehen).toEqual(netz.seeHoehen);
        expect(gewaesserAus(EINGABE).teile.map((t) => t.punkte)).toEqual(gew.teile.map((t) => t.punkte));
    });

    it("🔴 ein ganzes Stück gewählt: alle seine Höhen weg; ist danach nichts mehr da, fällt die Liste weg", () => {
        const aus = ohneAuswahl(mitHoehen0(), [{ nr: 1 }, { nr: 3 }], gew);
        expect(aus.flussHoehen).toBeUndefined();
        expect(aus.seeHoehen).toBeUndefined();
        expect(aus).toEqual(NETZ);
    });

    it("🔴 ein Punkt ohne eigene Höhe gibt dem Löschen nichts zu tun; ein Kamm in der Auswahl macht daraus „Teile“", () => {
        const netz = mitHoehen0();
        expect(loeschArt(netz, [{ nr: 2, index: 0 }], gew)).toBeUndefined();
        expect(loeschArt(netz, [{ nr: 1, index: 0 }], gew)).toBe("hoehen");
        expect(loeschArt(netz, [{ nr: 3 }], gew)).toBe("hoehen");
        expect(loeschArt(netz, [{ nr: 0 }], gew)).toBe("teile");
        expect(loeschArt(netz, [{ nr: 0 }, { nr: 1, index: 0 }], gew)).toBe("teile");
        expect(loeschArt(netz, [], gew)).toBeUndefined();
        expect(wasserPunkteMitHoehe(netz, [{ nr: 1 }, { nr: 2 }], gew)).toEqual([
            { nr: 1, index: 0 },
            { nr: 1, index: 1 },
        ]);
    });

    it("🔴 Kamm und Flusshöhen in EINER Auswahl: der Kamm geht, die Höhe am Fluss auch, die Nummern der Gewässer rücken nach", () => {
        const aus = ohneAuswahl(mitHoehen0(), [{ nr: 0 }, { nr: 1, index: 0 }], gew);
        expect(aus.kaemme).toEqual([]);
        expect(aus.flussHoehen).toEqual([{ x: 4, y: 5, h: 1100 }]);
        expect(aus.seeHoehen).toEqual([{ x: 7.5, y: 2, h: 800 }]);
    });
});

describe("Die Rundung der Flüsse (WI-0259)", () => {
    it("🔴 ein Stück trägt seine Nachbarn im Flussweg als Anschluss, damit die Kurve an der Grenze die der Karte ist", () => {
        const teile = teileAus("f", "Probe", NETZ, 1, gewaesserAus(EINGABE)).filter((t) => t.fest === true);
        // Der erste Fluss: (-2,5) draußen, (2,5) und (4,5) drin, (12,5) draußen, (8,6) und (6,6) drin.
        expect(teile[0]!.anschluss).toEqual({ vor: { x: -2, y: 5 }, nach: { x: 12, y: 5 } });
        expect(teile[1]!.anschluss).toEqual({ vor: { x: 12, y: 5 }, nach: undefined });
        // Der See hat keinen.
        expect(teile[2]!.anschluss).toBeUndefined();
    });
});

function netz0(): GebirgsNetz {
    return { ...NETZ, kaemme: NETZ.kaemme.map((k) => ({ ...k })) };
}
