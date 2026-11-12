import { describe, expect, it } from "vitest";
import {
    AVENTURIA_POLITICAL_CARTOGRAPHY,
    borderNameAllowed,
    borderNameValueForBand,
    claimStripeWidthPx,
    MAP_VIEWS,
    politicalBandForCameraZoom,
    politicalMinZoom,
    politicalTileMinBand,
} from "../src/index.ts";

/**
 * Die Kartografie der Herrschaftsgebiete (WI-0062 und Nachtrag Grenznamen und Konturdesign, 2026-09-29).
 *
 * 🔴 Legacys Werte, nicht ungefähr: `js/map-features/map-features-boundary-canvas-overlay.js` (avesmaps@ce24bbff0).
 * Die Zeilenzahlen stehen in den `$…Comment`-Feldern der Tafel; hier steht, was daraus folgt.
 */

const TAFEL = AVENTURIA_POLITICAL_CARTOGRAPHY;

describe("Konturdesign wie Legacy", () => {
    it("🔴 die Außengrenze ist hellgrau und liegt innen; sichtbar ist die HALBE Strichbreite des Canvas", () => {
        expect(TAFEL.outer.color).toBe("#d3d3d3");
        expect(TAFEL.outer.placement).toBe("inside");
        // Legacy: OUTER_LINE_WIDTH 2 / _ROOT 4 (sichtbar 1 / 2 px), auf Zoom 0 und 1 _FINE 1 / _ROOT_FINE 3 (0,5 / 1,5 px).
        expect(TAFEL.outer.otherWidthPx).toEqual([0.5, 0.5, 1, 1, 1, 1, 1]);
        expect(TAFEL.outer.rootWidthPx).toEqual([1.5, 1.5, 2, 2, 2, 2, 2]);
    });

    it("🔴 der schwache Modus hat EIGENE Breiten (Legacy 3 / 4 / 6 auf Zoom 4 / 5 / 6, sonst 2) und blendet nach Band ein", () => {
        expect(TAFEL.weak.outerWidthPx).toEqual([1, 1, 1, 1, 1.5, 2, 3]);
        expect(TAFEL.weak.outerAlpha).toEqual([0, 0.15, 0.3, 0.5, 1, 1, 1]);
        // Innen 0,5 / 0,75 / 1 ab Zoom 4, darunter 0,6 × die Außendeckkraft.
        expect(TAFEL.weak.innerAlpha).toEqual([0, 0.09, 0.18, 0.3, 0.5, 0.75, 1]);
        for (let band = 0; band <= 3; band += 1) {
            expect(TAFEL.weak.innerAlpha[band]).toBeCloseTo(0.6 * (TAFEL.weak.outerAlpha[band] as number), 10);
        }
    });

    it("die Innengrenze ist weiß, gestrichelt und durchsichtig (Legacy 0,6, hier 0,75: Betreiberwunsch 2026-09-30), auf Zoom 0 aus", () => {
        expect(TAFEL.inner.color).toBe("#ffffff");
        expect(TAFEL.inner.alpha).toBe(0.75);
        expect(TAFEL.inner.groups).toEqual([
            { fromBand: 1, toBand: 2, widthPx: 0.75, dashPx: [2, 3] },
            { fromBand: 3, toBand: 3, widthPx: 1.25, dashPx: [4, 3] },
            { fromBand: 4, toBand: 8, widthPx: 2, dashPx: [5, 4] },
        ]);
    });

    it("🔴 WI-0188 A4: die Bänder reichen bis 8, und was je Band gilt, gilt in 7 und 8 wie in 6", () => {
        expect(TAFEL.maxBand).toBe(8);
        // Die Innengrenzen enden nicht vor dem obersten Band (sonst fehlten sie in 7 und 8).
        expect(Math.max(...TAFEL.inner.groups.map((gruppe) => gruppe.toBand))).toBe(TAFEL.maxBand);
        // Die Werte je Band sind Legacys 0 bis 6; der letzte gilt weiter (Stufenausdruck), also zeigen 7 und 8, was 6 zeigt.
        for (const werte of [
            TAFEL.outer.rootWidthPx,
            TAFEL.outer.otherWidthPx,
            TAFEL.weak.outerAlpha,
            TAFEL.weak.innerAlpha,
            TAFEL.weak.outerWidthPx,
        ]) {
            expect(werte).toHaveLength(7);
        }
    });
});

describe("Namen entlang der Außengrenze", () => {
    const namen = TAFEL.borderName;

    it("🔴 nur in Standard (Legacy: currentMapLayerMode === deregraphic), ab Legacy-Zoom 4 = MapLibre-Zoom 5", () => {
        expect(namen.views).toEqual(["standard"]);
        for (const ansicht of namen.views) expect(MAP_VIEWS).toContain(ansicht);
        expect(namen.fromBand).toBe(4);
        // Legacys Abbildung (Vorzug 0, der des Rechners): Band 4 beginnt bei MapLibre-Zoom 5; am Telefon (Vorzug 1) bei Zoom 4.
        expect(politicalMinZoom(namen.fromBand, 0)).toBe(5);
        expect(politicalMinZoom(namen.fromBand, TAFEL.bandLeadZoom)).toBe(5 - TAFEL.bandLeadZoom);
        expect(politicalMinZoom(namen.fromBand, TAFEL.bandLeadZoomPhone)).toBe(5 - TAFEL.bandLeadZoomPhone);
        for (const vorzug of [TAFEL.bandLeadZoom, TAFEL.bandLeadZoomPhone]) {
            expect(politicalBandForCameraZoom(5 - vorzug, TAFEL.maxBand, vorzug)).toBe(namen.fromBand);
        }
    });

    it("🔴 weiß, leicht durchsichtig, ohne Saum; Versalien mit 3 px Sperrung; 9 / 11 / 16 px und 10 / 12 / 20 px Abstand", () => {
        expect(namen.color).toBe("#ffffff");
        expect(namen.alpha).toBe(0.75);
        expect(namen.uppercase).toBe(true);
        expect(namen.letterSpacingPx).toBe(3);
        expect(namen.sizePx).toEqual([9, 11, 16]);
        expect(namen.offsetPx).toEqual([10, 12, 20]);
        expect(namen.minPoints).toBe(8);
    });

    it("die Tafel ist in sich stimmig: ein Wert je Band ab fromBand, nie über das höchste Band hinaus", () => {
        expect(namen.sizePx.length).toBe(namen.offsetPx.length);
        expect(namen.fromBand + namen.sizePx.length - 1).toBeLessThanOrEqual(TAFEL.maxBand);
        // Der Wert des ersten Bandes ist der erste, der des letzten gilt für jedes höhere (Legacy klemmt auf 4 bis 6).
        expect([4, 5, 6, 7, 20].map((band) => borderNameValueForBand(namen.sizePx, namen.fromBand, band))).toEqual([
            9, 11, 16, 16, 16,
        ]);
        expect(borderNameValueForBand(namen.offsetPx, namen.fromBand, 4)).toBe(10);
        expect(borderNameValueForBand(namen.offsetPx, namen.fromBand, 0)).toBe(10);
    });

    it("🔴 die Ausnahmen wie Legacys TERRITORY_LABEL_EXCLUDE: Baronie, Junkertum, Vogtei, Rittergut, Freiherrschaft, Reichsstadt, Stadt", () => {
        const erlaubt = (name: string): boolean => borderNameAllowed(name, namen.excludeNamePattern);
        for (const name of [
            "Baronie Ehrenstein",
            "baronie Kleinsteinfurt",
            "Junkertum Weidenau",
            "Vogtei Nordwacht",
            "Rittergut Tannenhain",
            "Freiherrschaft Schwarztannen",
            "Reichsstadt Gareth",
            "Stadt Perricum",
            "  Baronie mit Leerzeichen",
        ]) {
            expect(erlaubt(name), name).toBe(false);
        }
        for (const name of [
            "Grafschaft Ferdok",
            "Markgrafschaft Perricum",
            "Herzogtum Weiden",
            "Königreich Garetien",
            "Mittelreich",
            // Am Wortanfang, nicht mitten im Namen, und nur ganze Wörter (Legacy `\b`).
            "Gräfliche Baronie Ehrenstein",
            "Stadtmark Tobrien",
            "Baronien im Norden",
        ]) {
            expect(erlaubt(name), name).toBe(true);
        }
        expect(erlaubt("")).toBe(false);
        expect(erlaubt("   ")).toBe(false);
    });
});

describe("Bänder nach Kamerazoom, Vorzug und Schraffur (Nachtrag 2026-09-30)", () => {
    it("🔴 der Vorzug der Bänder ist je Gerät EINE Zahl in der Tafel: Rechner Baronien ab Zoom 5, Telefon ab Zoom 4 (Betreiber 2026-09-30)", () => {
        // Betreiber 2026-09-30: „kannst du fürs handy 4 und für desktop 5 machen?“ - die Baronien sind Band 4.
        expect(politicalMinZoom(4, TAFEL.bandLeadZoom)).toBe(5);
        expect(politicalMinZoom(4, TAFEL.bandLeadZoomPhone)).toBe(4);
        // Ohne Vorzug ist es Legacys Abbildung (Legacy z + 1 = MapLibre z), mit 1 eine ganze Stufe früher.
        expect([0, 1, 2, 3, 4, 5, 6].map((band) => politicalMinZoom(band, 0))).toEqual([0, 2, 3, 4, 5, 6, 7]);
        expect([0, 1, 2, 3, 4, 5, 6].map((band) => politicalMinZoom(band, 1))).toEqual([0, 1, 2, 3, 4, 5, 6]);
        expect([0, 1, 2, 3, 4, 5, 6].map((band) => politicalMinZoom(band, TAFEL.bandLeadZoom))).toEqual([
            0, 2, 3, 4, 5, 6, 7,
        ]);
        expect([0, 1, 2, 3, 4, 5, 6].map((band) => politicalMinZoom(band, TAFEL.bandLeadZoomPhone))).toEqual([
            0, 1, 2, 3, 4, 5, 6,
        ]);
        // Das Telefon zeigt die Bänder früher, nie später; beide Werte liegen in dem Bereich, den die Kachel trägt (0 bis 3).
        expect(TAFEL.bandLeadZoomPhone).toBeGreaterThan(TAFEL.bandLeadZoom);
        for (const vorzug of [TAFEL.bandLeadZoom, TAFEL.bandLeadZoomPhone]) {
            expect(vorzug).toBeGreaterThanOrEqual(0);
            expect(vorzug).toBeLessThanOrEqual(3);
        }
    });

    it("🔴 das Band ist floor(Zoom − 1 + Vorzug): stufenlos, Rechner 4,99 → Band 3 und 5,0 → Band 4, Telefon 3,99 → Band 3 und 4,0 → Band 4", () => {
        const rechner = TAFEL.bandLeadZoom;
        const telefon = TAFEL.bandLeadZoomPhone;
        expect(politicalBandForCameraZoom(4.99, 6, rechner)).toBe(3);
        expect(politicalBandForCameraZoom(5, 6, rechner)).toBe(4);
        expect(politicalBandForCameraZoom(5.99, 6, rechner)).toBe(4);
        expect(politicalBandForCameraZoom(6, 6, rechner)).toBe(5);
        expect(politicalBandForCameraZoom(3.99, 6, telefon)).toBe(3);
        expect(politicalBandForCameraZoom(4, 6, telefon)).toBe(4);
        expect(politicalBandForCameraZoom(4.99, 6, telefon)).toBe(4);
        expect(politicalBandForCameraZoom(5, 6, telefon)).toBe(5);
        const zoome = [0.4, 0.5, 1.49, 1.5, 2.9, 3.5, 6.49, 6.5, 7.5, 20];
        expect(zoome.map((zoom) => politicalBandForCameraZoom(zoom, 6, rechner))).toEqual([
            0, 0, 0, 0, 1, 2, 5, 5, 6, 6,
        ]);
        expect(zoome.map((zoom) => politicalBandForCameraZoom(zoom, 6, telefon))).toEqual([
            0, 0, 1, 1, 2, 3, 6, 6, 6, 6,
        ]);
        // Ganzzahlige Vorzüge tun, was sie taten: 1 = eine ganze Stufe früher, 0 = Legacys Abbildung.
        expect([0.5, 1, 2.9, 3, 6, 7.5, 20].map((zoom) => politicalBandForCameraZoom(zoom, 6, 1))).toEqual([
            0, 1, 2, 3, 6, 6, 6,
        ]);
        expect([0.5, 1, 2.9, 3, 6, 7.5, 20].map((zoom) => politicalBandForCameraZoom(zoom, 6, 0))).toEqual([
            0, 0, 1, 2, 5, 6, 6,
        ]);
        for (const vorzug of [rechner, telefon]) {
            expect(politicalBandForCameraZoom(Number.NaN, 6, vorzug)).toBe(0);
            expect(politicalBandForCameraZoom(-3, 6, vorzug)).toBe(0);
        }
    });

    it("die Umkehrung: jedes Band beginnt genau bei politicalMinZoom, für ganze und für krumme Vorzüge", () => {
        for (const lead of [0, 0.25, 0.3, 0.5, 0.7, 1, 1.5, 2]) {
            for (let band = 1; band <= 6; band += 1) {
                const beginn = politicalMinZoom(band, lead);
                expect(
                    politicalBandForCameraZoom(beginn, 6, lead),
                    `Vorzug ${String(lead)}, Band ${String(band)}`,
                ).toBe(band);
                expect(politicalBandForCameraZoom(beginn - 0.01, 6, lead)).toBe(band - 1);
            }
        }
    });

    it("die Kachel trägt ab Zoom − 3 alle Bänder nach oben (die Kachelfunktion rechnet GREATEST(0, z − 3))", () => {
        expect([0, 1, 3, 4, 8, 10].map(politicalTileMinBand)).toEqual([0, 0, 0, 1, 5, 7]);
    });

    it("🔴 die Kachel trägt für JEDEN Vorzug ab 0 genug Bänder: das Band der Kamera liegt nie unter z − 3", () => {
        // Eine Kachel im Zoom z erscheint bei Kamerazoom z − 2 (nah) bis z + 3 (fern, Gelände, 60°).
        for (const lead of [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 3]) {
            for (let kachel = 0; kachel <= 8; kachel += 1) {
                for (let kamera = kachel - 2; kamera <= kachel + 3; kamera += 0.125) {
                    expect(
                        politicalBandForCameraZoom(kamera, 6, lead),
                        `Kachel ${String(kachel)}, Kamera ${String(kamera)}, Vorzug ${String(lead)}`,
                    ).toBeGreaterThanOrEqual(politicalTileMinBand(kachel));
                }
            }
        }
    });

    it("🔴 Schraffur wie Legacy: 45°, 20 px bei Legacy-Zoom 6, je Stufe × 1,25, zwischen 3 und 22 px, nur in Politisch", () => {
        const hatch = TAFEL.claimHatch;
        expect(hatch.views).toEqual(["political"]);
        expect(hatch.angleDeg).toBe(45);
        // Legacy stripeWidthForZoom: 20 * 1,25^(z − 6), geklemmt; die Breite im Muster gleicht MapLibres Zoomen aus.
        const legacy = (band: number): number => Math.min(22, Math.max(3, 20 * Math.pow(1.25, band - 6)));
        for (let band = 0; band <= 6; band += 1) {
            expect(claimStripeWidthPx(hatch, band), `Band ${String(band)}`).toBeCloseTo(
                legacy(band) * hatch.patternScale,
                10,
            );
        }
        expect(claimStripeWidthPx(hatch, 6) / hatch.patternScale).toBeCloseTo(20, 10);
        // Auf jedem Band wächst die Breite (bis zur Grenze).
        expect(claimStripeWidthPx(hatch, 0)).toBeLessThan(claimStripeWidthPx(hatch, 3));
        expect(claimStripeWidthPx(hatch, 3)).toBeLessThan(claimStripeWidthPx(hatch, 6));
        // MapLibre zoomt ein Muster innerhalb einer Stufe von 1× auf 2×: im Mittel 1 / ln 2.
        expect(hatch.patternScale).toBeGreaterThan(0.6);
        expect(hatch.patternScale).toBeLessThan(0.75);
    });

    it("🔴 die Sichtbarkeit der Grenzen ist gegenüber Legacy angehoben und benennt es: Saum unter der hellen Linie, Innengrenze deckender", () => {
        expect(TAFEL.outer.casing.widthPx).toBeGreaterThan(0);
        expect(TAFEL.outer.casing.alpha).toBeGreaterThan(0);
        expect(TAFEL.outer.casing.alpha).toBeLessThan(1);
        expect(TAFEL.inner.alpha).toBeGreaterThan(0.6);
    });
});
