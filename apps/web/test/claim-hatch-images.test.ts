import { describe, expect, it } from "vitest";
import { AVENTURIA_POLITICAL_CARTOGRAPHY, claimStripeWidthPx } from "@avesmaps3d/shared";
import {
    claimPatternImage,
    claimPatternLayout,
    claimHatchImageResolver,
    parseClaimPatternName,
} from "../src/map/claim-hatch-images.ts";
import { installStyleImageResolvers } from "../src/map/style-image-resolver.ts";

/**
 * Die Muster der Schraffur umstrittener Gebiete (Nachtrag WI-0062, Betreiber 2026-09-30): Diagonalstreifen in den Farben
 * der Parteien, wie Legacys Canvas-Overlay.
 */

const HATCH = AVENTURIA_POLITICAL_CARTOGRAPHY.claimHatch;

/** Die Farbe eines Bildpunkts als Hex. */
function farbe(bild: { width: number; data: Uint8ClampedArray }, x: number, y: number): string {
    const at = (y * bild.width + x) * 4;
    return [0, 1, 2].map((i) => (bild.data[at + i] as number).toString(16).padStart(2, "0")).join("");
}

describe("Name des Musters", () => {
    it("🔴 Band und Farben stehen im Namen, den die Kachel nennt: nie ein Muster ohne Gebiet, keine Farbtabelle im Code", () => {
        expect(parseClaimPatternName("claim-4-67b060-a9b263")).toEqual({ band: 4, colors: ["67b060", "a9b263"] });
        expect(parseClaimPatternName("claim-0-aabbcc-112233-ff0000")).toEqual({
            band: 0,
            colors: ["aabbcc", "112233", "ff0000"],
        });
        for (const unlesbar of [
            "",
            "hatch-4-67b060",
            "claim-x-67b060",
            "claim-4",
            "claim-4-67b06",
            "claim-4-67B060",
            "claim--1-67b060",
            "claim-4-67b060-zzzzzz",
        ]) {
            expect(parseClaimPatternName(unlesbar), unlesbar).toBeUndefined();
        }
    });
});

describe("Muster als Bild", () => {
    it("🔴 quadratisch und eine Zweierpotenz: sonst bricht das Muster an der Kachelgrenze (MapLibre verankert es an der Kachel)", () => {
        for (let band = 0; band <= 6; band += 1) {
            for (const parteien of [2, 3]) {
                const farben = ["67b060", "a9b263", "c34141"].slice(0, parteien);
                const bild = claimPatternImage(HATCH, { band, colors: farben });
                expect(bild.width, `Band ${String(band)}`).toBe(bild.height);
                expect([32, 64, 128]).toContain(bild.width);
                expect(bild.data.length).toBe(bild.width * bild.height * 4);
            }
        }
        // Auf einem Bildschirm mit doppelter Dichte verdoppelt sich die Kachel samt Dichte: weiter eine Zweierpotenz.
        const doppelt = claimPatternImage(HATCH, { band: 5, colors: ["67b060", "a9b263"] }, 2);
        expect(doppelt.pixelRatio).toBe(2);
        expect([64, 128, 256]).toContain(doppelt.width);
    });

    it("🔴 nahtlos: über den Rand hinaus setzt sich der Streifenlauf fort, in x wie in y", () => {
        const bild = claimPatternImage(HATCH, { band: 4, colors: ["67b060", "a9b263"] });
        const breite = bild.width;
        // Die Farbe hängt nur an x + y, und deren Periode ist die Kantenlänge: Ein Schritt nach rechts und einer nach oben
        // (mit Umbruch am Rand) lässt jeden Bildpunkt gleich. Das ist genau die Nahtlosigkeit an der Kachelgrenze.
        for (let y = 0; y < breite; y += 1) {
            for (let x = 0; x < breite; x += 1) {
                expect(farbe(bild, (x + 1) % breite, (y + breite - 1) % breite), `(${String(x)}, ${String(y)})`).toBe(
                    farbe(bild, x, y),
                );
            }
        }
    });

    it("🔴 Streifen laufen von rechts oben nach links unten (Legacy dreht das Canvas um 45°): die Farbe hängt nur an x + y", () => {
        const bild = claimPatternImage(HATCH, { band: 5, colors: ["ff0000", "0000ff"] });
        const mitte = (x: number, y: number) => farbe(bild, x, y);
        // Auf einer Linie x + y = konstant bleibt die Farbe stehen (abseits der Kanten der Streifen).
        let gleich = 0;
        let gesamt = 0;
        for (let summe = 8; summe < bild.width - 8; summe += 1) {
            const punkte = [
                [summe - 3, 3],
                [Math.floor(summe / 2), summe - Math.floor(summe / 2)],
                [3, summe - 3],
            ] as const;
            const erste = mitte(punkte[0][0], punkte[0][1]);
            for (const [x, y] of punkte.slice(1)) {
                gesamt += 1;
                if (mitte(x, y) === erste) gleich += 1;
            }
        }
        expect(gleich / gesamt).toBeGreaterThan(0.9);
    });

    it("🔴 die Parteien folgen einander in ihrer Reihenfolge, das umstrittene Gebiet zuerst, alle gleich breit", () => {
        const bild = claimPatternImage(HATCH, { band: 3, colors: ["ff0000", "00ff00", "0000ff"] });
        // Entlang der Diagonale durch die Kachel (x + y läuft über zwei Perioden): jede Farbe kommt vor, in der Folge Rot, Grün, Blau, Rot, …
        const folge: string[] = [];
        for (let summe = 0; summe <= 2 * bild.width - 2; summe += 1) {
            const c = farbe(bild, Math.floor(summe / 2), summe - Math.floor(summe / 2));
            if (c === "ff0000" || c === "00ff00" || c === "0000ff") {
                if (folge[folge.length - 1] !== c) folge.push(c);
            }
        }
        expect(folge.slice(0, 6)).toEqual(["ff0000", "00ff00", "0000ff", "ff0000", "00ff00", "0000ff"]);
        // Gleiche Breiten: Jede Farbe deckt (fast) ein Drittel der Bildpunkte (kantenglättende Mischfarben eingerechnet).
        const anzahl: Record<string, number> = {};
        for (let y = 0; y < bild.height; y += 1) {
            for (let x = 0; x < bild.width; x += 1) anzahl[farbe(bild, x, y)] = (anzahl[farbe(bild, x, y)] ?? 0) + 1;
        }
        for (const rein of ["ff0000", "00ff00", "0000ff"]) {
            expect((anzahl[rein] ?? 0) / (bild.width * bild.height), rein).toBeGreaterThan(0.25);
            expect((anzahl[rein] ?? 0) / (bild.width * bild.height), rein).toBeLessThan(0.34);
        }
        // Undurchsichtig: die Deckkraft setzt die Ebene.
        for (let i = 3; i < bild.data.length; i += 4) expect(bild.data[i]).toBe(255);
    });

    it("🔴 die Streifenbreite trifft Legacys Wert je Band, so gut die Zweierpotenz es erlaubt", () => {
        for (let band = 0; band <= 6; band += 1) {
            for (const parteien of [2, 3]) {
                const ziel = claimStripeWidthPx(HATCH, band);
                const lage = claimPatternLayout(HATCH, band, parteien);
                // Senkrecht gemessen: Kante / (Parteien · Wiederholungen · √2).
                expect(lage.widthPx).toBeCloseTo(lage.edge / (parteien * lage.repeats * Math.SQRT2), 10);
                expect(
                    Math.abs(lage.widthPx - ziel) / ziel,
                    `Band ${String(band)}, ${String(parteien)} Parteien`,
                ).toBeLessThan(0.35);
            }
        }
        // Wächst mit dem Band (Legacy: je Stufe × 1,25).
        expect(claimPatternLayout(HATCH, 0, 2).widthPx).toBeLessThan(claimPatternLayout(HATCH, 6, 2).widthPx);
    });
});

describe("Anmelden an der Karte", () => {
    it("🔴 legt ein Muster im Auflöser an, der VOR dem Fehlschlag läuft (das Ereignis kommt seit MapLibre 6 zu spät)", () => {
        const bilder = new Map<string, unknown>();
        let aufloeser: ((id: string) => void | Promise<void>) | null = null;
        const karte = {
            hasImage: (id: string) => bilder.has(id),
            addImage: (id: string, bild: unknown) => bilder.set(id, bild),
            setMissingStyleImageResolver: (funktion: ((id: string) => void | Promise<void>) | null) => {
                aufloeser = funktion;
            },
        };
        // Gesetzt wird der Auflöser an EINER Stelle für alle Arten von Laufzeitbildern (`style-image-resolver.ts`).
        const abmelden = installStyleImageResolvers(karte as never, [claimHatchImageResolver(karte)]);
        expect(aufloeser).not.toBeNull();
        const frage = aufloeser as unknown as (id: string) => void;
        frage("claim-4-67b060-a9b263");
        expect(bilder.has("claim-4-67b060-a9b263")).toBe(true);
        // Ein fremder Name bleibt unbeantwortet, ein vorhandenes Muster wird nicht doppelt gebaut.
        frage("marker-diamond");
        expect(bilder.size).toBe(1);
        const erstes = bilder.get("claim-4-67b060-a9b263");
        frage("claim-4-67b060-a9b263");
        expect(bilder.get("claim-4-67b060-a9b263")).toBe(erstes);
        abmelden();
        expect(aufloeser).toBeNull();
    });
});
