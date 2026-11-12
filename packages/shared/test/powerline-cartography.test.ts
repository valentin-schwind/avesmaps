import { describe, expect, it } from "vitest";
import { AVENTURIA_POWERLINE_CARTOGRAPHY, rgbaColour } from "../src/index.ts";

/**
 * Die Kartografie der Kraftlinien (WI-0025).
 *
 * 🔴 Legacys Werte, nicht ungefähr: die drei Leuchtlagen aus `getPowerlineRenderStyles` und
 * css/features/powerlines.css, die Magiersicht aus `syncPowerlineMapTint` (avesmaps@770c80e).
 */

describe("Kraftlinien-Kartografie", () => {
    it("🔴 trägt Legacys drei Leuchtlagen in Legacys Reihenfolge", () => {
        const lagen = AVENTURIA_POWERLINE_CARTOGRAPHY.glow.map((lage) => ({
            id: lage.id,
            strich: rgbaColour(lage.color, lage.alpha),
            deckkraft: lage.opacity,
            breite: lage.widthPx,
        }));
        expect(lagen).toEqual([
            { id: "aura", strich: "rgba(255, 70, 90, 0.42)", deckkraft: 0.34, breite: 10 },
            { id: "mitte", strich: "rgba(255, 105, 130, 0.82)", deckkraft: 0.72, breite: 4.6 },
            { id: "kern", strich: "rgba(255, 235, 240, 1)", deckkraft: 0.98, breite: 1.5 },
        ]);
    });

    it("die Namen und die Magiersicht wie Legacy", () => {
        const { label, magiersicht } = AVENTURIA_POWERLINE_CARTOGRAPHY;
        expect(rgbaColour(label.color, label.alpha)).toBe("rgba(255, 196, 214, 0.98)");
        expect(label).toMatchObject({ sizePx: 18, offsetPx: 10, fromLegacyZoom: 2 });
        // CSS `saturate(0.1) brightness(0.6)` mit `transition: filter 0.6s ease`.
        expect(magiersicht).toEqual({ saturation: 0.1, brightness: 0.6, transitionMs: 600 });
    });

    it("💣 der Schein der Namen bleibt unter dem, was MapLibres Glyphenrand trägt", () => {
        // Legacys 0,14 × Schriftgröße für Saum und Weichzeichnung füllte die Glyphenkachel: grauer
        // Kasten hinter jedem Buchstaben (2026-09-23). Der Rand trägt 3 px bei 24 px, also 0,125.
        const { label } = AVENTURIA_POWERLINE_CARTOGRAPHY;
        expect(label.haloWidthRatio + label.haloBlurRatio).toBeLessThan(0.125);
    });

    it("🔴 die Stränge wabern mit Legacys Stellschrauben, Ziffer für Ziffer (POWERLINE_RENDER_CONFIG)", () => {
        const s = AVENTURIA_POWERLINE_CARTOGRAPHY.straenge;
        expect(s).toMatchObject({
            anzahl: 3,
            phaseStep: 1.73,
            tremorNormalAmplitude: 2.1,
            tremorTangentAmplitude: 0.3,
            tremorNormalSpeed: 0.85,
            tremorTangentSpeed: 0.65,
            tremorNormalFrequency: 0.38,
            tremorTangentFrequency: 0.29,
            tremorPhaseMultiplier: 2.4,
            interferenceAmplitude: 1.6,
            interferenceSpeed: 2.4,
            frameIntervalMs: 33,
        });
        // 💣 Je Strang ein Eintrag - ein fehlender fiele im Shader still auf 0 zurück.
        expect(s.normalScales.length).toBeGreaterThanOrEqual(s.anzahl);
        expect(s.waveOffsets.slice(0, s.anzahl)).toEqual([-2, 2, 2]);
    });

    it("🔴 mehr Stützpunkte als Legacys 8 und Fäden neben den Strängen (Betreiber 2026-10-11), höchstens acht je Linie", () => {
        const { straenge, faeden } = AVENTURIA_POWERLINE_CARTOGRAPHY;
        // „ihnen mehr Punkte und vielleicht sogar Glättung geben“
        expect(straenge.segmente).toBeGreaterThan(8);
        // „mehr leuchtende Fäden unterschiedlicher Stärke“: Fäden, und keiner so stark wie ein Strang.
        expect(faeden.anzahl).toBeGreaterThan(0);
        expect(faeden.breite[0]).toBeLessThan(faeden.breite[1]);
        expect(faeden.breite[1]).toBeLessThan(1);
        // Jeder Faden zeichnet das ganze Netz noch einmal: acht je Linie sind die Grenze (die Registry wirft darüber).
        expect(straenge.anzahl + faeden.anzahl).toBeLessThanOrEqual(8);
    });

    it("🔴 Glättung gerade so fein, dass die Kanten kaum zu sehen sind: 3 Proben bei der Bezugslänge (Betreiber 2026-10-11)", () => {
        // „kannst du die glättung der kraftlinien gerade so runterschrauben, dass kanten fast nicht mehr sichtbar sind?“ -
        // gemessen: 95 % der Knicke unter 3,3° (mit 6 Proben 1,8°, mit 2 Proben 4,9°), halb so viele Ecken wie vorher.
        expect(AVENTURIA_POWERLINE_CARTOGRAPHY.straenge.proben).toBe(3);
        // Die Bezugslänge des Rauschens liegt unter der mittleren Linie (5 bis 376 Karteneinheiten, die Hälfte unter 63): „ein
        // kleines bisschen "unruhiger" geht auch“ - 50 statt 63. Der Fächer: „ein bisschen breiter gehen die stränge schon noch
        // auseinander“ - anderthalbmal Legacys Versätze.
        expect(AVENTURIA_POWERLINE_CARTOGRAPHY.straenge.bezugslaenge).toBe(50);
        expect(AVENTURIA_POWERLINE_CARTOGRAPHY.straenge.faecherbreite).toBe(1.5);
    });

    it("🔴 die gewählte Linie glüht gelb-orange (Betreiber 2026-10-11), hell im Kern, breiter als die rosa Lagen", () => {
        // „viel geiler wär, wenn die streifen bei einem klick gelb-orange und hell glühen würden“
        const { auswahl, glow } = AVENTURIA_POWERLINE_CARTOGRAPHY;
        const kanal = (hex: string, start: number): number => Number.parseInt(hex.slice(start, start + 2), 16);
        for (const lage of auswahl) {
            // Warm: Rot vor Grün vor Blau, wo Rosa Blau vor Grün hat.
            expect(kanal(lage.color, 1), lage.id).toBeGreaterThanOrEqual(kanal(lage.color, 3));
            expect(kanal(lage.color, 3), lage.id).toBeGreaterThan(kanal(lage.color, 5));
        }
        const kern = auswahl[auswahl.length - 1];
        expect(kern?.alpha).toBe(1);
        expect(Math.max(...auswahl.map((lage) => lage.widthPx))).toBeGreaterThan(
            Math.max(...glow.map((lage) => lage.widthPx)),
        );
    });

    it("die Bögen: auf Wunsch des Betreibers etwas niedriger als im Entwurf (0,22 und 220 px)", () => {
        const b = AVENTURIA_POWERLINE_CARTOGRAPHY.boegen;
        expect(b.anteil).toBeLessThan(0.22);
        expect(b.hoechstensPx).toBeLessThan(220);
        // Der 3D-Knopf kippt auf 45°: dort stehen die Bögen ganz.
        expect(b.vollAbNeigung).toBeLessThanOrEqual(45);
    });

    it("die Nodices als Legacys Ley-Knoten: Schein, helle Scheibe, rosa Scheibe, pinker Punkt", () => {
        const ley = AVENTURIA_POWERLINE_CARTOGRAPHY.leyKnoten;
        // map-features-location-canvas-layer.js `_redraw`: shadowBlur 16, Radien 1 / 0,92 / 0,42.
        expect(ley).toMatchObject({ glowPx: 16, ringShare: 0.92, kernShare: 0.42, radiusFactor: 1.7 });
        expect(ley.kernShare).toBeLessThan(ley.ringShare);
    });
});
