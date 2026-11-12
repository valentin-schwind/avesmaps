import { describe, expect, it } from "vitest";
import type { GebirgsNetzStand } from "@avesmaps3d/shared";
import { alsAenderung, klassifiziereStartwerte, ohneStartwerte, protokollStaende } from "../src/terrain/startwerte.ts";

/**
 * Startwerte erkennen (WI-0249; Vali wählte 2026-10-26: Startwerte 2.300 gelten nicht als eigene Höhe und werden auf der Stage entfernt). Rein,
 * ohne Datenbank. Problemfälle: ein gesetzter Wert, der zufällig gleich der Kammhöhe ist, wird entfernt; ein Startwert nach einer Änderung der
 * Kammhöhe bleibt; ein Punkt ohne Beleg wird geraten; Täler, Mulden, Flüsse oder Seen verlieren etwas.
 */
const netz = (h: (number | null)[], neben: number | null): GebirgsNetzStand => ({
    kaemme: [
        {
            punkte: [
                [0, 0],
                [1, 0],
                [2, 0],
            ],
            rang: "haupt",
            hoehen: h,
        },
        {
            punkte: [
                [0, 1],
                [2, 1],
            ],
            rang: "tal",
            hoehen: [2300, 900],
        },
    ],
    nebengipfel: [{ x: 5, y: 5, h: neben }],
    mulden: [{ x: 7, y: 7, h: 2300 }],
    seeHoehen: [{ x: 9, y: 9, h: 800 }],
});

describe("Startwerte im Gebirgsnetz", () => {
    it("🔴 gleich der Kammhöhe und im Protokoll nie anders: Startwert; abweichend oder einmal anders: eigen; ohne Beleg: unklar", () => {
        const jetzt = netz([2300, 2300, 1800], 2300);
        const verlauf = protokollStaende(
            [
                // Angelegt: alle Punkte mit dem Startwert 2000 (damals die Kammhöhe), der Nebengipfel ohne Höhe.
                {
                    vorher: { maximalhoehe: null },
                    nachher: { netz: netz([2000, 2000, 2000], null), maximalhoehe: 2000 },
                },
                // Kammhöhe 2000 → 2300: die eigenen Höhen verhältnisgleich mit; der dritte Punkt danach von Hand auf 1800.
                {
                    vorher: { maximalhoehe: 2000 },
                    nachher: { maximalhoehe: 2300, netz: netz([2300, 2300, 2300], 2300) },
                },
                { vorher: { netz: netz([2300, 2300, 2300], 2300) }, nachher: { netz: jetzt } },
            ],
            2300,
            1000,
        );
        const punkte = klassifiziereStartwerte({ netz: jetzt, kammhoehe: 2300 }, verlauf);
        expect(punkte.map((p) => [p.art, p.punkt, p.klasse])).toEqual([
            ["kamm", 0, "startwert"],
            ["kamm", 1, "startwert"],
            ["kamm", 2, "eigen"],
            // Der Nebengipfel war einmal ohne Höhe: jemand hat 2.300 gesetzt.
            ["nebengipfel", 0, "eigen"],
        ]);
        // Ohne Beleg im Protokoll (verschoben, eingespielt): unklar, bleibt.
        expect(klassifiziereStartwerte({ netz: jetzt, kammhoehe: 2300 }, []).map((p) => p.klasse)).toEqual([
            "unklar",
            "unklar",
            "eigen",
            "unklar",
        ]);
    });

    it("die Bereinigung nimmt nur Startwerte; Tal, Mulde, See und eigene Höhen bleiben, die Änderung trägt keine null", () => {
        const jetzt = netz([2300, 2300, 1800], 2300);
        const punkte = klassifiziereStartwerte({ netz: jetzt, kammhoehe: 2300 }, [
            { netz: netz([2300, 2300, 1800], 2300), kammhoehe: 2300 },
        ]);
        const neu = ohneStartwerte(jetzt, punkte);
        expect(neu.kaemme[0]!.hoehen).toEqual([null, null, 1800]);
        expect(neu.kaemme[1]).toEqual(jetzt.kaemme[1]);
        expect(neu.nebengipfel[0]!.h).toBeNull();
        expect(neu.mulden).toEqual(jetzt.mulden);
        expect(neu.seeHoehen).toEqual(jetzt.seeHoehen);
        const aenderung = alsAenderung(neu);
        expect(aenderung.kaemme[0]!.hoehen).toEqual([[2, 1800]]);
        expect(aenderung.kaemme[1]!.hoehen).toEqual([
            [0, 2300],
            [1, 900],
        ]);
        expect(aenderung.nebengipfel).toEqual([{ x: 5, y: 5 }]);
        expect(JSON.stringify(aenderung)).not.toContain("null");
        // Alle Höhen eines Kamms weg: kein Feld `hoehen` mehr.
        const ganz = ohneStartwerte(
            netz([2300, 2300, 2300], null),
            klassifiziereStartwerte({ netz: netz([2300, 2300, 2300], null), kammhoehe: 2300 }, [
                { netz: netz([2300, 2300, 2300], null), kammhoehe: 2300 },
            ]),
        );
        expect(ganz.kaemme[0]).not.toHaveProperty("hoehen");
    });
});
