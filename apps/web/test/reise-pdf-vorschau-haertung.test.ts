import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Die Vorschau von „Reise als PDF“ liest ihr PDF mit pdf.js (WI-0306). 🔴 Härtung gegen CVE-2024-4367 (Schadcode über eine Schriftmatrix,
 * behoben in pdf.js 4.2.67): Die Fassung liegt darüber, das gebaute Paket kennt kein `eval` und kein `new Function`, und `vorschau.ts` setzt
 * `isEvalSupported: false` trotzdem (pdf.js 5 kennt die Option nicht mehr; zurück auf 4.x wirkte sie wieder).
 */

const web = resolve(import.meta.dirname, "..");
const paketDatei = createRequire(join(web, "package.json")).resolve("pdfjs-dist/package.json");
const paket = JSON.parse(readFileSync(paketDatei, "utf8")) as { version: string };

const zahlen = (fassung: string): number[] => fassung.split(".").map((teil) => Number.parseInt(teil, 10));
const mindestens = (fassung: string, grenze: string): boolean => {
    const [a, b] = [zahlen(fassung), zahlen(grenze)];
    for (let i = 0; i < 3; i += 1) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
    return true;
};

describe("🔴 pdf.js ist gehärtet (CVE-2024-4367)", () => {
    it("mindestens 4.2.67", () => {
        expect(mindestens(paket.version, "4.2.67"), paket.version).toBe(true);
    });

    it("weder Bündel noch Worker erzeugen Code zur Laufzeit", () => {
        for (const datei of ["build/pdf.mjs", "build/pdf.worker.mjs", "build/pdf.worker.min.mjs"]) {
            const code = readFileSync(join(dirname(paketDatei), datei), "utf8");
            expect(code.includes("new Function("), datei).toBe(false);
        }
    });

    it("`vorschau.ts` öffnet das PDF mit `isEvalSupported: false`", () => {
        const quelle = readFileSync(join(web, "src/reise-pdf/vorschau.ts"), "utf8");
        expect(quelle).toMatch(/isEvalSupported:\s*false/);
    });
});
