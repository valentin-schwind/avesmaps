import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { LANDSCAPE_SELECTIONS } from "@avesmaps3d/shared";
import { ortsStufenKennung, schalterKennung } from "../src/map/display-state.ts";
import { PLACE_TIERS } from "../src/map/map-display.ts";

/**
 * Was die Oberfläche der Besucherstatistik über die Anzeigeschalter und die Landschaftsebene meldet (WI-0159,
 * `BESUCH-0001 §13 D`).
 *
 * 🔴 **Der Maßstab ist Legacys Abzug, nicht eine Vereinbarung von heute.** Legacys importierte Tage und unsere eigenen
 * Meldungen summieren nur dann in einer Zeile, wenn sie denselben Schlüssel tragen. Trüge unsere Meldung `rivers:on`, stünde
 * in der Liste „Schalter" neben Legacys `toggleRivers:on` ein zweiter Balken, und beide wären halb so hoch wie die Wahrheit.
 * Darum liest dieser Test die Schlüssel aus dem Abzug selbst (`project-control/discovery/legacy-nutzung-2026-10-12/`) - nicht
 * aus einer Liste, die jemand abgeschrieben hat.
 */

const ABZUG = "project-control/discovery/legacy-nutzung-2026-10-12/visitor-metrics-besucher.json";

interface Abzug {
    metrics: Record<string, { dimension: string; c: string }[] | undefined>;
}

/** Die Ausprägungen, die Legacy für eine Metrik wirklich gezählt hat. */
function legacyWerte(metrik: string): string[] {
    const abzug = JSON.parse(readFileSync(ABZUG, "utf8")) as Abzug;
    const zeilen = abzug.metrics[metrik] ?? [];
    return zeilen.map((zeile) => zeile.dimension);
}

describe("Die Zählkennung der Anzeigeschalter", () => {
    it("trifft jeden Schalter, den Legacy gezählt hat", () => {
        // 🪤 Legacys Abzug trägt beide Formen in einer Metrik: Schalter (`toggleRivers:on`) und Ortsklasse (`gebaeude:on`).
        const legacy = legacyWerte("display_toggle");
        expect(legacy.length, "ohne Abzug kein Maßstab - dann ist dieser Test wertlos").toBeGreaterThan(0);

        const unsere = new Set<string>();
        for (const schalter of ["paths", "labels", "borders", "rivers", "layers", "flow", "tileGrid"] as const) {
            unsere.add(schalterKennung(schalter, true));
            unsere.add(schalterKennung(schalter, false));
        }
        for (let stufe = 0; stufe <= PLACE_TIERS.length; stufe += 1) unsere.add(ortsStufenKennung(stufe));

        // Jede Ausprägung aus Legacys Abzug muss eine von uns sein - sonst spaltet sich ihr Balken.
        for (const wert of legacy) expect([...unsere], `Legacys „${wert}“ hat bei uns keinen Sender`).toContain(wert);
    });

    it("schreibt Legacys Namen, nicht unsere inneren", () => {
        expect(schalterKennung("rivers", true)).toBe("toggleRivers:on");
        expect(schalterKennung("rivers", false)).toBe("toggleRivers:off");
        expect(schalterKennung("paths", true)).toBe("togglePaths:on");
        expect(schalterKennung("borders", true)).toBe("toggleTerritoryBorders:on");
        expect(schalterKennung("labels", false)).toBe("toggleMapLabels:off");
        // Die drei eigenen Schalter tragen ihre kurzen Namen: Legacy hat sie nicht, es gibt nichts zusammenzuführen.
        expect(schalterKennung("layers", true)).toBe("areas:on");
        expect(schalterKennung("flow", true)).toBe("flow:on");
        expect(schalterKennung("tileGrid", true)).toBe("grid:on");
    });

    it("nennt bei den Orten die höchste sichtbare Klasse, wie Legacy", () => {
        // Legacys vier Ortswerte im Abzug: gebaeude:on (2.786), metropole:on (2.052), dorf:on (1.878), grossstadt:on (1.614).
        expect(ortsStufenKennung(1)).toBe("metropole:on");
        expect(ortsStufenKennung(2)).toBe("grossstadt:on");
        expect(ortsStufenKennung(5)).toBe("dorf:on");
        expect(ortsStufenKennung(6)).toBe("gebaeude:on");
        // Keine Orte: Legacys Sammelschalter, aus.
        expect(ortsStufenKennung(0)).toBe("toggleLocations:off");
        // 🪤 Eine Stufe über der Kaskade ist kein Absturz und keine erfundene Klasse.
        expect(ortsStufenKennung(99)).toBe("toggleLocations:off");
    });
});

/** Ebenen, die es in Legacy nie gab und die deshalb in seinem Abzug fehlen: die Sprachen (WI-0261 S5a; Legacy führt keine Sprachen). */
const OHNE_LEGACY: readonly string[] = ["sprachen"];

describe("Die Zählkennung der Landschaftsebene", () => {
    it("ist die Ebene selbst - und genau Legacys fünf Werte", () => {
        const legacy = legacyWerte("eco_kind");
        expect(legacy.length).toBeGreaterThan(0);
        // Beide Richtungen: Legacy kennt keine Ebene, die wir nicht haben, und wir keine, die Legacy anders nannte. Was neu ist
        // und in Legacy nie bestand, steht ausdrücklich oben, damit keine umbenannte Ebene hier durchrutscht.
        expect([...legacy].sort()).toEqual(LANDSCAPE_SELECTIONS.filter((ebene) => !OHNE_LEGACY.includes(ebene)).sort());
        expect(legacy.filter((ebene) => OHNE_LEGACY.includes(ebene))).toEqual([]);
    });
});
