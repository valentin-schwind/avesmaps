import { describe, expect, it } from "vitest";
import { WASSER_RAUSCHEN_GROESSE, wasserRauschen } from "../src/map/wasser/wasser-rauschen.ts";
import { WASSER_FS } from "../src/map/wasser/wasser-shader.ts";

/**
 * Das Rauschen, das die Wellenzüge des Wassers verbiegt (WI-0288). Problemfall (Betreiber 2026-11-09: „sieht noch ein bisschen aus wie ein
 * säurebad - das war am anfang schöner“): Ein Zufallswert je Bildpunkt faltete die Wellen zu Wirbeln, Ringen und Marmor. Gefaltet wird,
 * sobald der Verzug sich über eine Strecke stärker ändert als die Strecke selbst; die Wellen werden dann zurückgeschoben und überkreuzen sich.
 */

const N = WASSER_RAUSCHEN_GROESSE;
const daten = wasserRauschen();
const wert = (x: number, y: number, k: number): number =>
    daten[((((y % N) + N) % N) * N + (((x % N) + N) % N)) * 2 + k]! / 255;

/** Größte Änderung zwischen Nachbarn je Bildpunkt, über die Naht hinweg (`nurNaht`: nur dort). */
function groessterSprung(k: number, nurNaht = false): number {
    let m = 0;
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            if (nurNaht && x !== N - 1 && y !== N - 1) continue;
            m = Math.max(m, Math.abs(wert(x + 1, y, k) - wert(x, y, k)), Math.abs(wert(x, y + 1, k) - wert(x, y, k)));
        }
    }
    return m;
}

/** Maßstab und Stärke beider Verzüge, wie der Shader sie liest: `p += (texture(uRauschen, p * s).rg - .5) * a`. */
function verzuege(): { s: number; a: number }[] {
    const treffer = [...WASSER_FS.matchAll(/texture\(uRauschen,p\*([\d.]+)\)\.rg-\.5\)\*([\d.]+)/g)];
    return treffer.map((t) => ({ s: Number(t[1]), a: Number(t[2]) }));
}

describe("Wasser: Rauschen für den Verzug der Wellen", () => {
    it("🔴 faltet die Wellen nicht: Jeder Verzug ändert sich über eine Strecke weniger als die Strecke", () => {
        const liste = verzuege();
        expect(liste).toHaveLength(2);
        for (const { s, a } of liste) {
            // Ein Bildpunkt der Textur misst 1 / (N · s) Karteneinheiten.
            for (const k of [0, 1]) expect(a * groessterSprung(k) * N * s, `Maßstab ${s}, Kanal ${k}`).toBeLessThan(1);
        }
    });

    it("schließt an den Rändern ohne Naht an", () => {
        for (const k of [0, 1]) expect(groessterSprung(k, true)).toBeLessThanOrEqual(groessterSprung(k) + 1e-9);
    });

    it("ist fest gesät und nicht flach", () => {
        expect(wasserRauschen()).toEqual(daten);
        for (const k of [0, 1]) {
            let summe = 0;
            let quadrate = 0;
            for (let i = k; i < daten.length; i += 2) {
                summe += daten[i]! / 255;
                quadrate += (daten[i]! / 255) ** 2;
            }
            const mittel = summe / (N * N);
            expect(Math.sqrt(quadrate / (N * N) - mittel * mittel), `Kanal ${k}`).toBeGreaterThan(0.05);
        }
    });
});
