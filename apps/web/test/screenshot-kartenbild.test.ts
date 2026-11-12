import { describe, expect, it } from "vitest";
import {
    dateiname,
    FELD_MIN,
    feldGrenzen,
    feldMasse,
    formatName,
    legeFeld,
    naechstesRechteck,
    QUADRAT,
    RECHTECK_VORGABE,
    RECHTECKE,
} from "../src/screenshot/kartenbild";

/** Der Screenshot der Karte (WI-0274): Formate, Größe und Lage des Felds. */

describe("Die Formate des Rechtecks", () => {
    it("laufen von breit nach hoch, beginnen bei 16:9 und kennen 1:1 nicht (das ist die Kachel Quadratisch)", () => {
        const r = RECHTECKE.map((f) => f.r);
        expect([...r].sort((a, b) => b - a)).toEqual(r);
        expect(RECHTECKE[RECHTECK_VORGABE]?.zahl).toBe("16:9");
        expect(r).not.toContain(1);
        expect(RECHTECKE.map((f) => f.zahl ?? f.text)).toEqual([
            "2:1",
            "16:9",
            "screenshot.format.a4Quer",
            "4:3",
            "3:4",
            "screenshot.format.a4Hoch",
            "9:16",
            "1:2",
        ]);
    });

    it("das Mausrad hält an den Enden, der Knopf am Finger beginnt wieder vorn", () => {
        expect(naechstesRechteck(0, -1)).toBe(0);
        expect(naechstesRechteck(RECHTECKE.length - 1, 1)).toBe(RECHTECKE.length - 1);
        expect(naechstesRechteck(RECHTECKE.length - 1, 1, true)).toBe(0);
        expect(naechstesRechteck(2, 1)).toBe(3);
    });

    it("heißt nach seiner Zahl oder nach der Sprachtafel", () => {
        const t = (key: string): string => `«${key}»`;
        expect(formatName(RECHTECKE[1] ?? QUADRAT, t)).toBe("16:9");
        expect(formatName(QUADRAT, t)).toBe("«screenshot.quadrat»");
    });
});

describe("Das Feld", () => {
    const grenzen = feldGrenzen(2560, 1271);

    it("lässt oben Platz für die Leiste, unten für das Maß und Rand an den Seiten", () => {
        expect(grenzen).toEqual({ x: 24, y: 64, w: 2512, h: 1167 });
    });

    it("🔴 ist in jedem Format so groß, wie es passt, und schrumpft beim Hin und Her nicht", () => {
        const erst = RECHTECKE.map((f) => feldMasse(f.r, grenzen));
        for (const [nr, f] of RECHTECKE.entries()) {
            const m = erst[nr];
            if (!m) throw new Error("fehlt");
            // Eine Seite stößt an die Grenze, die andere passt.
            expect(m.w <= grenzen.w && m.h <= grenzen.h).toBe(true);
            expect(Math.max(m.w / grenzen.w, m.h / grenzen.h)).toBeGreaterThan(0.995);
            expect(Math.abs(m.w / m.h - f.r)).toBeLessThan(0.01);
        }
        // Dreimal durch alle Formate und zurück: dieselben Größen (Vali 2026-11-01: „das rechteck wird immer kleiner“).
        for (let runde = 0; runde < 3; runde += 1) {
            expect(RECHTECKE.map((f) => feldMasse(f.r, grenzen))).toEqual(erst);
        }
    });

    it("folgt einer kleineren Breite, wird aber nicht kleiner als die Mindestseite", () => {
        expect(feldMasse(1, grenzen, 500)).toEqual({ w: 500, h: 500 });
        expect(feldMasse(1, grenzen, 10)).toEqual({ w: FELD_MIN, h: FELD_MIN });
        expect(feldMasse(2, grenzen, 10)).toEqual({ w: 2 * FELD_MIN, h: FELD_MIN });
        expect(feldMasse(1, grenzen, 99_999)).toEqual({ w: grenzen.h, h: grenzen.h });
    });

    it("liegt mit der Mitte am Zeiger, aber immer ganz in den Grenzen", () => {
        const masse = { w: 400, h: 300 };
        expect(legeFeld({ x: 1000, y: 600 }, masse, grenzen)).toEqual({ x: 800, y: 450, w: 400, h: 300 });
        expect(legeFeld({ x: 0, y: 0 }, masse, grenzen)).toEqual({ x: 24, y: 64, w: 400, h: 300 });
        expect(legeFeld({ x: 9999, y: 9999 }, masse, grenzen)).toEqual({
            x: 24 + 2512 - 400,
            y: 64 + 1167 - 300,
            w: 400,
            h: 300,
        });
    });
});

describe("Der Dateiname", () => {
    it("trägt Datum und Uhrzeit", () => {
        expect(dateiname(new Date(2026, 10, 1, 9, 5))).toBe("avesmaps-2026-11-01-0905.png");
    });
});
