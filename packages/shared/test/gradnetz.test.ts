import { describe, expect, it } from "vitest";
import {
    GARETH_KARTENPUNKT,
    GRADNETZ_STUFEN,
    gradAusKartenpunkt,
    gradnetzLinien,
    gradnetzStufe,
    gradPunktText,
    gradText,
    kartenpunktAusGrad,
} from "../src/gradnetz.ts";

const DE = { nord: "N", sued: "S", ost: "O", west: "W" };

describe("Gradnetz nach DereGlobus (WI-0273)", () => {
    it("legt 0° auf Gareth, im Maß von DereGlobus", () => {
        const punkt = kartenpunktAusGrad({ lon: 0, lat: 0 });
        expect(punkt.x).toBeCloseTo(GARETH_KARTENPUNKT.x, 9);
        expect(punkt.y).toBeCloseTo(GARETH_KARTENPUNKT.y, 9);
        // Ein Grad Breite gut 100 km (33,6 Einheiten zu 3 km), ein Grad Länge gut 90 km.
        const norden = kartenpunktAusGrad({ lon: 0, lat: 1 });
        const osten = kartenpunktAusGrad({ lon: 1, lat: 0 });
        expect(norden.y - GARETH_KARTENPUNKT.y).toBeCloseTo(33.58, 2);
        expect(osten.x - GARETH_KARTENPUNKT.x).toBeCloseTo(30.32, 2);
    });

    it("rechnet hin und zurück ohne Verlust", () => {
        const grad = gradAusKartenpunkt(kartenpunktAusGrad({ lon: -7.25, lat: 41.5 }));
        expect(grad.lon).toBeCloseTo(-7.25, 9);
        expect(grad.lat).toBeCloseTo(41.5, 9);
    });

    it("zeigt feinere Stufen erst, wenn ihre Linien 90 px auseinanderliegen", () => {
        const ab = GRADNETZ_STUFEN.map((s) => s.abZoom);
        expect(ab).toEqual([...ab].sort((a, b) => a - b));
        expect(gradnetzStufe(0)).toBe(0);
        expect(GRADNETZ_STUFEN[gradnetzStufe(3)]?.schritt).toBe(1);
        expect(GRADNETZ_STUFEN[gradnetzStufe(7)]?.schritt).toBeCloseTo(1 / 12);
    });

    it("ordnet jede Linie ihrer gröbsten Stufe zu und beschneidet sie auf den Kartenraum", () => {
        const linien = gradnetzLinien();
        const finde = (achse: "lon" | "lat", wert: number) =>
            linien.find((l) => l.achse === achse && Math.abs(l.wert - wert) < 1e-9);
        expect(finde("lat", 0)?.stufe).toBe(0);
        expect(finde("lon", 0)?.stufe).toBe(0);
        expect(finde("lat", 10)?.stufe).toBe(0);
        expect(finde("lat", 5)?.stufe).toBe(1);
        expect(finde("lon", -3)?.stufe).toBe(2);
        expect(finde("lat", -0.5)?.stufe).toBe(3);
        expect(finde("lat", 0.25)?.stufe).toBe(4);
        expect(finde("lat", 5 / 60)?.stufe).toBe(5);
        for (const linie of linien) {
            for (const p of [linie.von, linie.bis]) {
                expect(p.x).toBeGreaterThanOrEqual(-1e-6);
                expect(p.x).toBeLessThanOrEqual(1024 + 1e-6);
                expect(p.y).toBeGreaterThanOrEqual(-1e-6);
                expect(p.y).toBeLessThanOrEqual(1024 + 1e-6);
            }
        }
    });

    it("schreibt Grade wie auf einer Karte", () => {
        expect(gradText(29.5, "lat", true, DE)).toBe("29° 30′ N");
        expect(gradText(29.5, "lat", false, DE)).toBe("29° N");
        expect(gradText(-3, "lon", true, DE)).toBe("3° W");
        expect(gradText(4 + 59.9999 / 60, "lon", true, DE)).toBe("5° O");
        expect(gradText(0, "lon", true, DE)).toBe("0°");
    });

    it("schreibt die Grade eines Punktes immer mit Minuten", () => {
        expect(gradPunktText(-0.15, "lat", DE)).toBe("0° 09′ S");
        expect(gradPunktText(12, "lon", DE)).toBe("12° 00′ O");
        expect(gradPunktText(-(2 + 59.9 / 60), "lon", DE)).toBe("3° 00′ W");
        expect(gradPunktText(0.001, "lat", DE)).toBe("0° 00′");
    });
});
