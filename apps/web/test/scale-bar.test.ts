import { describe, expect, it } from "vitest";
import { AVENTURIA, DESIGN_CANON, labelFamily } from "@avesmaps3d/shared";
import {
    MAX_WIDTH,
    MAX_WIDTH_SHARE,
    MIN_WIDTH_SHARE,
    SCHRITT_PER_MILE,
    niceSchritt,
    readScale,
    scaleBarMaxWidth,
    scaleLabel,
} from "../src/scale/scale-reading.ts";
import { setLocale } from "../src/i18n/i18n.ts";

/**
 * Die Maßstabsleiste (WI-0096), Rechnung ohne Browser.
 *
 * 🔴 Legacys Leiste hängt an ganzen Zoomstufen (Finding MCS-029: Tafel mit sieben Zeilen, Zugriff über
 * `Math.round(map.getZoom())`, Leaflets `zoomSnap: 1`). Unser Zoom rastet nicht. Die Fälle hier messen
 * deshalb den ganzen Zoombereich UND die Zwischenstände, die es in Legacy nicht gibt.
 */

const SPACE = AVENTURIA.coordinateSpace;

/**
 * Wie viele Schritt Karte auf einen Bildpunkt gehen, bei MapLibre-Zoom `z` und ungeneigter Kamera:
 * 2^(z-1) Bildpunkte je Karteneinheit (`packages/shared/src/zoom-bands.ts`, an beiden laufenden Karten
 * gemessen), 3.000 Schritt je Einheit.
 */
const schrittPerPixel = (zoom: number): number => SPACE.distance.schrittPerUnit / 2 ** (zoom - 1);

describe("Maßstabsleiste: der Rundungsweg", () => {
    it("nimmt die größte Sprosse der Leiter 1 / 2 / 5, nie etwas dazwischen", () => {
        expect(niceSchritt(1)).toBe(1);
        expect(niceSchritt(1.9)).toBe(1);
        expect(niceSchritt(2)).toBe(2);
        expect(niceSchritt(4.9)).toBe(2);
        expect(niceSchritt(5)).toBe(5);
        expect(niceSchritt(9.9)).toBe(5);
        expect(niceSchritt(10)).toBe(10);
        expect(niceSchritt(999)).toBe(500);
        expect(niceSchritt(1_000)).toBe(1_000);
        expect(niceSchritt(2_999)).toBe(2_000);
        expect(niceSchritt(3_000)).toBe(2_000);
        expect(niceSchritt(48_750)).toBe(20_000);
        expect(niceSchritt(390_000)).toBe(200_000);
    });

    it("liefert unter einem Schritt nichts, statt eine Null zu zeigen", () => {
        expect(niceSchritt(0.9)).toBeUndefined();
        expect(niceSchritt(0)).toBeUndefined();
        expect(niceSchritt(Number.NaN)).toBeUndefined();
        expect(niceSchritt(Number.POSITIVE_INFINITY)).toBeUndefined();
    });

    it("hat an jeder Zehnerpotenz genau drei Sprossen - die Rundung kennt kein viertes Ergebnis", () => {
        const seen = new Set<number>();
        for (let limit = 1; limit < 1_000_000; limit *= 1.01) {
            const step = niceSchritt(limit);
            if (step !== undefined) seen.add(step / 10 ** Math.floor(Math.log10(step)));
        }
        expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 5]);
    });
});

describe("Maßstabsleiste: die Zoomstufen", () => {
    /**
     * Die acht ganzen Zoomstufen, die die Karte heute führt (`maxZoom: 8`, app.vue). Zum Vergleich steht
     * daneben, was Legacy an derselben Stelle zeigt - sein Zoom liegt um EINE Stufe niedriger
     * (`RENDER_ZOOM_OFFSET`), seine Tafel kennt nur 100 und 10 Meilen.
     */
    const CASES: [zoom: number, miles: number, width: number, legacy: string][] = [
        [1, 200, 67, "Legacy z0: 100 Meilen / 33 px"],
        [2, 100, 67, "Legacy z1: 100 Meilen / 67 px"],
        [3, 50, 67, "Legacy z2: 100 Meilen / 133 px"],
        [4, 20, 53, "Legacy z3: 100 Meilen / 267 px"],
        [5, 20, 107, "Legacy z4: 10 Meilen / 53 px"],
        [6, 10, 107, "Legacy z5: 10 Meilen / 107 px"],
        [7, 5, 107, "Legacy z6: 10 Meilen / 213 px"],
        [8, 2, 85, "Legacy z7: 10 Meilen / 427 px"],
    ];

    for (const [zoom, miles, width, legacy] of CASES) {
        it(`z${String(zoom)} zeigt ${String(miles)} Meilen auf ${String(width)} px (${legacy})`, () => {
            const reading = readScale(schrittPerPixel(zoom));
            expect(reading).toBeDefined();
            expect(reading?.unit).toBe("miles");
            expect(reading?.value).toBe(miles);
            expect(reading?.width).toBe(width);
        });
    }

    it("arbeitet auch auf den Zwischenständen, die Legacy nicht hat", () => {
        // 🔴 Der Kern des Auftrags: Zwischen zwei Sprossen wächst nur die BREITE, die Zahl bleibt stehen.
        const steps = [5, 5.1, 5.2, 5.28].map((zoom) => readScale(schrittPerPixel(zoom)));
        expect(steps.map((step) => step?.value)).toEqual([20, 20, 20, 20]);
        expect(steps.map((step) => step?.width)).toEqual([107, 114, 123, 130]);
        // Und an der Sprosse wechselt sie genau einmal, ohne Zwischenwert: 20 Meilen auf 130 px werden
        // 10 Meilen auf 65 px. Die Sprosse liegt bei z ≈ 5,285 - mitten in einer Zoomstufe, die Legacy
        // gar nicht hat.
        expect(readScale(schrittPerPixel(5.29))).toMatchObject({ value: 10, width: 65 });
    });

    it("wechselt über eine ganze Zoomstufe höchstens einmal die Zahl", () => {
        for (let zoom = 1; zoom < 8; zoom += 1) {
            const values = new Set<number>();
            for (let step = 0; step <= 100; step += 1) {
                values.add(readScale(schrittPerPixel(zoom + step / 100))?.value ?? 0);
            }
            expect(values.size, `z${String(zoom)} bis z${String(zoom + 1)}`).toBeLessThanOrEqual(2);
        }
    });
});

describe("Maßstabsleiste: Einheitenwechsel", () => {
    it("zeigt eine Meile als Meile, nicht als 1.000 Schritt", () => {
        const reading = readScale(SCHRITT_PER_MILE / MAX_WIDTH);
        expect(reading).toEqual({ schritt: 1_000, width: MAX_WIDTH, unit: "miles", value: 1 });
    });

    it("geht unter einer Meile auf Schritt, die zweite Einheit des Koordinatenraums", () => {
        // Die Schwelle ist genau eine Meile: darunter gibt es keine Sprosse in Meilen mehr, und
        // „0 Meilen" oder „0,5 Meilen" wäre beides falsch.
        const reading = readScale((SCHRITT_PER_MILE - 1) / MAX_WIDTH);
        expect(reading?.unit).toBe("schritt");
        expect(reading?.value).toBe(500);
    });

    it("kennt nur diese beiden Einheiten - Spann führt der Koordinatenraum nicht", () => {
        expect(Object.keys(SPACE.distance).sort()).toEqual(["milesPerUnit", "schrittPerUnit", "unit"]);
        for (let perPixel = 0.01; perPixel < 10_000; perPixel *= 1.07) {
            const unit = readScale(perPixel)?.unit;
            if (unit !== undefined) expect(["miles", "schritt"]).toContain(unit);
        }
    });

    it("leitet Schritt je Meile aus dem Raum ab, statt die 1.000 zu setzen", () => {
        expect(SCHRITT_PER_MILE).toBe(SPACE.distance.schrittPerUnit / SPACE.distance.milesPerUnit);
        expect(SCHRITT_PER_MILE).toBe(1_000);
    });
});

describe("Maßstabsleiste: Mindest- und Höchstbreite", () => {
    it("bleibt unter dem Deckel und über 40 % davon - über den ganzen Bereich", () => {
        for (let perPixel = 0.5; perPixel < 100_000; perPixel *= 1.013) {
            const reading = readScale(perPixel);
            if (reading === undefined) continue;
            expect(reading.width, `${String(perPixel)} Schritt/px`).toBeLessThanOrEqual(MAX_WIDTH);
            expect(reading.width).toBeGreaterThanOrEqual(Math.floor(MAX_WIDTH * MIN_WIDTH_SHARE));
        }
    });

    it("die Mindestbreite ist der größte Sprung der Leiter, keine eigene Zahl", () => {
        expect(MIN_WIDTH_SHARE).toBe(2 / 5);
    });

    it("nimmt den Deckel aus dem Kanon und nicht aus einer neuen Zahl", () => {
        expect(MAX_WIDTH).toBe(DESIGN_CANON.control.labelWidth);
    });

    it("gibt am Telefon nach: höchstens 40 % der freien Kartenbreite", () => {
        expect(scaleBarMaxWidth(1280)).toBe(MAX_WIDTH);
        expect(scaleBarMaxWidth(360)).toBe(MAX_WIDTH);
        // Unter rund 325 px freier Breite greift der Anteil - der Planer am Telefon lässt so wenig übrig.
        expect(scaleBarMaxWidth(200)).toBe(Math.floor(200 * MAX_WIDTH_SHARE));
        expect(scaleBarMaxWidth(0)).toBe(MAX_WIDTH);
    });

    it("rechnet mit einem schmalen Deckel dieselbe Leiter", () => {
        const reading = readScale(schrittPerPixel(6), 80);
        expect(reading?.value).toBe(5);
        expect(reading?.width).toBe(53);
    });
});

describe("Maßstabsleiste: was keine Leiste ergibt", () => {
    it("antwortet auf einen unbrauchbaren Maßstab mit nichts", () => {
        expect(readScale(0)).toBeUndefined();
        expect(readScale(-1)).toBeUndefined();
        expect(readScale(Number.NaN)).toBeUndefined();
        expect(readScale(Number.POSITIVE_INFINITY)).toBeUndefined();
        expect(readScale(100, 0)).toBeUndefined();
    });
});

describe("Maßstabsleiste: woher ihr Aussehen kommt", () => {
    /**
     * 🔴 Betreiber 2026-10-07: „die dynamische skala zentriert, ohne hintergrund, schatten wie bei
     * legacy". Ohne Fläche trägt die Leiste nur ihr Saum - und der ist nicht erfunden.
     */
    it("nimmt Tinte und Saumfarbe aus der Kartenschrift, nicht aus einer eigenen Farbe", () => {
        const place = labelFamily("place");
        expect(place.color).toBe("#ffffff");
        expect(place.haloColor).toBe("#000000");
    });

    it("der Saum ist Legacys gemessener Wert und hat die Geometrie von `mediaMark`", () => {
        expect(DESIGN_CANON.shadow["mapInk"]).toBe("0 1px 2px rgba(0, 0, 0, 0.95)");
        const geometry = (value: string): string => value.slice(0, value.indexOf("rgba"));
        expect(geometry(DESIGN_CANON.shadow["mapInk"] ?? "")).toBe(geometry(DESIGN_CANON.shadow["mediaMark"] ?? ""));
        // Und er ist schwarz wie der Saum der Kartenschrift, nicht irgendein dunkler Ton.
        expect(DESIGN_CANON.shadow["mapInk"]).toContain("rgba(0, 0, 0");
    });

    it("hat KEINEN Dunkelwert - er trennt von der Karte, und die hat kein dunkles Thema", () => {
        expect(DESIGN_CANON.shadowDark?.["mapInk"]).toBeUndefined();
        // Dieselbe Entscheidung wie bei den anderen Schatten, die auf fremdem Bild liegen.
        expect(DESIGN_CANON.shadowDark?.["mediaMark"]).toBeUndefined();
        expect(DESIGN_CANON.shadowDark?.["tooltip"]).toBeUndefined();
    });
});

describe("Maßstabsleiste: die Beschriftung", () => {
    /**
     * 🔴 WI-0129 R2: Auf Stufe 8 zeigt die Leiste am Rechner eine Meile, und dort stand „1 Meilen“ (Discovery §2, B4). Die Einzahl
     * gilt nur für die ganze 1; die Leiter kennt keine Bruchteile von Meilen (darunter Schritt).
     */
    it("🔴 eine Meile heißt „1 Meile“ und „1 mile“, alle anderen bleiben in der Mehrzahl", () => {
        setLocale("de");
        expect(scaleLabel({ schritt: 1_000, width: 100, unit: "miles", value: 1 })).toBe("1 Meile");
        expect(scaleLabel({ schritt: 2_000, width: 100, unit: "miles", value: 2 })).toBe("2 Meilen");
        expect(scaleLabel({ schritt: 500, width: 100, unit: "schritt", value: 500 })).toBe("500 Schritt");
        setLocale("en");
        expect(scaleLabel({ schritt: 1_000, width: 100, unit: "miles", value: 1 })).toBe("1 mile");
        expect(scaleLabel({ schritt: 10_000, width: 100, unit: "miles", value: 10 })).toBe("10 miles");
        setLocale("de");
    });
});
