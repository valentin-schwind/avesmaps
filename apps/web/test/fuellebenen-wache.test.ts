import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Wache für Füllebenen, die nach einem Stilwechsel neu angelegt werden (WI-0249; Stage 2026-10-26, „Kämme zeichnen“ an den Blutzinnen:
 * fünfmal `TypeError: Cannot read properties of undefined (reading 'r')` in `setUniform` einer Füllebene). Eine Füllebene, die im
 * `styledata`-Zuhörer selbst angelegt wird, zeichnet MapLibre im laufenden Bild, bevor `recalculate` ihr die Umrissfarbe gibt. Muster: Wer zur
 * Laufzeit eine Füllebene anlegt, meldet sich mit `nachStilwechsel` (`map/style-ready.ts`) an, nie roh an `styledata`.
 */
function dateien(ordner: string): string[] {
    return readdirSync(ordner).flatMap((name) => {
        const pfad = join(ordner, name);
        if (statSync(pfad).isDirectory()) return dateien(pfad);
        return /\.(ts|vue)$/.test(name) ? [pfad] : [];
    });
}

describe("Füllebenen nach einem Stilwechsel", () => {
    it("🔴 wer zur Laufzeit eine Füllebene anlegt, hängt nicht roh an styledata", () => {
        const quelle = join(import.meta.dirname, "../src");
        const verstoesse: string[] = [];
        let gefunden = 0;
        for (const pfad of dateien(quelle)) {
            const text = readFileSync(pfad, "utf8");
            if (!text.includes('type: "fill"') || !text.includes("addLayer(")) continue;
            gefunden++;
            if (/\.(on|once)\("styledata"/.test(text)) verstoesse.push(pfad.slice(quelle.length + 1));
        }
        expect(gefunden).toBeGreaterThanOrEqual(3);
        expect(verstoesse).toEqual([]);
    });
});
