import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 🔴 **Überfahren ist nie die einzige Handlung** (WI-0068 §19 Browser/UI, R8; Inventur 2026-10-18: ohne Fall). Am Telefon gibt es kein
 * Überfahren. Deshalb darf keine Regel der Medienverwaltung etwas erst unter `:hover` sichtbar oder bedienbar machen: kein `display`,
 * keine `visibility`, keine `opacity`, keine `pointer-events` in einer Regel mit `:hover`. Ein Hover färbt die Fläche (Hausregel), mehr
 * nicht.
 */
const ORDNER = fileURLToPath(new URL("../src/medien/", import.meta.url));
const VERBOTEN = /\b(display|visibility|opacity|pointer-events)\s*:/u;

/** Die Regeln aller `<style>`-Blöcke einer Datei als Paare aus Selektor und Körper (ohne verschachtelte Blöcke, wie sie dort stehen). */
function regeln(quelle: string): { selektor: string; koerper: string }[] {
    const stile = [...quelle.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gu)].map((treffer) => treffer[1] ?? "");
    return stile.flatMap((stil) =>
        [...stil.replace(/\/\*[\s\S]*?\*\//gu, "").matchAll(/([^{}]+)\{([^{}]*)\}/gu)].map((treffer) => ({
            selektor: (treffer[1] ?? "").trim(),
            koerper: treffer[2] ?? "",
        })),
    );
}

describe("Medienverwaltung: nichts nur beim Überfahren (WI-0068 R8)", () => {
    it("🔴 keine :hover-Regel blendet etwas ein, macht es sichtbar oder erst bedienbar", () => {
        const dateien = readdirSync(ORDNER).filter((name) => name.endsWith(".vue"));
        expect(dateien.length).toBeGreaterThan(20);
        const funde = dateien.flatMap((name) =>
            regeln(readFileSync(join(ORDNER, name), "utf8"))
                .filter((regel) => regel.selektor.includes(":hover") && VERBOTEN.test(regel.koerper))
                .map((regel) => `${name}: ${regel.selektor}`),
        );
        expect(funde).toEqual([]);
    });
});
