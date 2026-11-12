import { describe, expect, it } from "vitest";
import type { WetterMetrik } from "@avesmaps3d/shared";
import {
    erzeugeWetterMessung,
    MESSFENSTER_MS,
    type MessStand,
    type MessUmgebung,
} from "../src/map/wetter/wetter-messung.ts";

/**
 * Die Messung des Wetters für die Besucherstatistik (WI-0288) mit einer Uhr von Hand: einmal je Seitenaufruf, nur bei sichtbarer Seite
 * und laufendem Wetter, Klassen statt Messwerte.
 */
function bau(vorgabe: Partial<MessStand> = {}) {
    const z = {
        jetzt: 0,
        sichtbar: true,
        laeuft: true,
        stand: {
            bereit: true,
            anteil: 0.27,
            gpu: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11)",
            ...vorgabe,
        } as MessStand,
        start: 0 as number | undefined,
        gemeldet: [] as [WetterMetrik, string | undefined][],
    };
    const umgebung: MessUmgebung = {
        jetzt: () => z.jetzt,
        sichtbar: () => z.sichtbar,
        laeuft: () => z.laeuft,
        stand: () => z.stand,
        startBeginn: () => z.start,
        melde: (metrik, klasse) => z.gemeldet.push([metrik, klasse]),
    };
    const messung = erzeugeWetterMessung(umgebung);
    /** Lässt `ms` vergehen: ein Bild alle `abstand` ms, ein Tick alle 500 ms. */
    const laufe = (ms: number, abstand = 16.7): void => {
        const ende = z.jetzt + ms;
        let naechstesBild = z.jetzt + abstand;
        let naechsterTick = z.jetzt + 500;
        while (z.jetzt < ende) {
            z.jetzt = Math.min(naechstesBild, naechsterTick, ende);
            if (z.jetzt >= naechstesBild) {
                messung.bild();
                naechstesBild += abstand;
            }
            if (z.jetzt >= naechsterTick) {
                messung.tick();
                naechsterTick += 500;
            }
        }
    };
    return { z, messung, laufe };
}

const metriken = (g: [WetterMetrik, string | undefined][]): string[] => g.map(([m]) => m);

describe("Messung des Wetters", () => {
    it("meldet vor dem ersten `bereit` nichts", () => {
        const { z, laufe } = bau({ bereit: false });
        laufe(60_000);
        expect(z.gemeldet).toEqual([]);
    });

    it("🔴 meldet Nutzung und Start genau einmal, sobald `bereit` kommt - die Startzeit vom ersten Einschalten an", () => {
        const { z, laufe } = bau({ bereit: false });
        z.start = 0;
        laufe(6_100);
        z.stand = { ...z.stand, bereit: true };
        laufe(60_000);
        expect(z.gemeldet.filter(([m]) => m === "wetter_lauf")).toEqual([["wetter_lauf", undefined]]);
        // Eingeschaltet bei 0 ms, bereit nach gut sechs Sekunden.
        expect(z.gemeldet.filter(([m]) => m === "wetter_start")).toEqual([["wetter_start", "6-7s"]]);
    });

    it("meldet keinen Start, wenn das Wetter nie angelaufen ist (nur der Editor)", () => {
        const { z, laufe } = bau();
        z.start = undefined;
        laufe(1_000);
        expect(metriken(z.gemeldet)).toEqual(["wetter_lauf"]);
    });

    it("🔴 meldet die Leistung einmal, nach dem Fenster, als Klassen: Bildrate, Spitze, Auflösung, Familie der Grafikkarte", () => {
        const { z, laufe } = bau();
        laufe(MESSFENSTER_MS + 2_000);
        expect(z.gemeldet).toEqual([
            ["wetter_lauf", undefined],
            ["wetter_start", "u1s"],
            ["wetter_bildrate", "50-60"],
            ["wetter_spitze", "10-20"],
            ["wetter_aufloesung", "25"],
            ["wetter_gpu", "nvidia"],
        ]);
        // Danach nie wieder, wie lange die Seite auch läuft.
        laufe(120_000);
        expect(z.gemeldet.filter(([m]) => m === "wetter_bildrate")).toHaveLength(1);
    });

    it("🔴 die Spitze ist das 95. Perzentil, nicht der Mittelwert: ein Ruckler alle 15 Bilder zählt", () => {
        const { z, messung } = bau();
        // Ein Tick eröffnet das Fenster, dann Bilder mit einem Ruckler alle 15 (120 ms) bei sonst 16 ms.
        messung.tick();
        for (let i = 1; z.jetzt < MESSFENSTER_MS + 100; i++) {
            z.jetzt += i % 15 === 0 ? 120 : 16;
            messung.bild();
            if (i % 30 === 0) messung.tick();
        }
        messung.tick();
        expect(z.gemeldet.find(([m]) => m === "wetter_spitze")?.[1]).toBe("ab100");
        // Der Median bleibt bei 16 ms, also über 60 Bildern je Sekunde.
        expect(z.gemeldet.find(([m]) => m === "wetter_bildrate")?.[1]).toBe("60-70");
    });

    it("🔴 verwirft das Fenster, sobald die Seite verborgen wird, und beginnt beim nächsten sichtbaren Lauf neu", () => {
        const { z, laufe } = bau();
        laufe(15_000);
        z.sichtbar = false;
        laufe(10_000);
        z.sichtbar = true;
        // Die 15 s vor dem Verbergen zählen nicht mehr: Es braucht ein volles neues Fenster.
        laufe(MESSFENSTER_MS - 2_000);
        expect(metriken(z.gemeldet)).not.toContain("wetter_bildrate");
        laufe(4_000);
        expect(z.gemeldet.filter(([m]) => m === "wetter_bildrate")).toHaveLength(1);
    });

    it("zählt kein Fenster, solange das Wetter aus ist", () => {
        const { z, laufe } = bau();
        z.laeuft = false;
        laufe(MESSFENSTER_MS * 2);
        expect(metriken(z.gemeldet)).toEqual(["wetter_lauf", "wetter_start"]);
    });

    it("meldet keine Leistung aus einem Fenster ohne Bilder (die Seite stand)", () => {
        const { z, messung } = bau();
        for (let t = 0; t <= MESSFENSTER_MS + 2_000; t += 500) {
            z.jetzt = t;
            messung.tick();
        }
        expect(metriken(z.gemeldet)).not.toContain("wetter_bildrate");
    });

    it("🔴 sendet nie einen Messwert oder Namen: jede Klasse hat die Form, die der Server annimmt", () => {
        const { z, laufe } = bau({ gpu: "ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)" });
        laufe(MESSFENSTER_MS + 2_000);
        for (const [, klasse] of z.gemeldet) if (klasse !== undefined) expect(klasse).toMatch(/^[A-Za-z0-9-]{1,12}$/);
        expect(z.gemeldet.find(([m]) => m === "wetter_gpu")?.[1]).toBe("adreno");
    });
});
