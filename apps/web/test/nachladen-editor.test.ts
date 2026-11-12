import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Was nur Editoren brauchen, bleibt aus dem Startpaket der Besucher (WI-0235; WI-0272 S3, Review M9): Die Fassung für den Bau (`nachladen.ts`, lädt nach) und die für den Entwicklungsserver
 * (`nachladen.entwicklung.ts`, statisch) nennen dieselben Bauteile, und `app.vue` holt die Hinweiszeile der Kartenwahl der Redaktion von dort, nicht über einen eigenen statischen Import. Ob der Bau
 * wirklich nachlädt, prüft die Rauchprobe gegen den gebauten Stand.
 */

const wurzel = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const lies = (pfad: string): string => readFileSync(join(wurzel, pfad), "utf8");
const namen = (quelle: string, muster: RegExp): string[] => [...quelle.matchAll(muster)].map((treffer) => treffer[1]!);

describe("🔴 Nachladen: der Bau und der Entwicklungsserver kennen dieselben Bauteile", () => {
    const bau = lies("apps/web/src/nachladen.ts");
    const entwicklung = lies("apps/web/src/nachladen.entwicklung.ts");
    const imBau = namen(bau, /^export const (\w+) = defineAsyncComponent\(/gmu);
    const inEntwicklung = namen(entwicklung, /^export \{ default as (\w+) \} from /gmu);

    it("jedes nachgeladene Bauteil steht auch in der statischen Fassung des Entwicklungsservers", () => {
        expect(imBau.length).toBeGreaterThan(20);
        for (const name of imBau) expect(inEntwicklung, name).toContain(name);
    });

    it("🔴 die Hinweiszeile der Kartenwahl (nur für die Redaktion) lädt mit den Editorfenstern nach, nicht mit dem Startpaket", () => {
        expect(imBau).toContain("MedienStelleHinweis");
        expect(inEntwicklung).toContain("MedienStelleHinweis");
        // Editoren bekommen es vor dem Einhängen der Seite aufgelöst wie die Medienverwaltung daneben.
        expect(bau).toMatch(/const EDITORFENSTER = \[[^\]]*\bMedienStelleHinweis,/u);
        expect(bau).toContain('MedienStelleHinweis: mitTexten(() => import("./medien/medien-stelle-hinweis.vue")),');
    });
});

describe("🔴 app.vue hält den Editorcode der Kartenwahl von Besuchern fern", () => {
    const app = lies("apps/web/src/app.vue");

    it("das Bauteil kommt aus `nachladen`, nicht aus einem eigenen statischen Import", () => {
        expect(app).not.toMatch(/import\s+MedienStelleHinweis\s+from/u);
        expect(app).toMatch(/\bMedienStelleHinweis,\n/u);
        expect(app).toContain('<MedienStelleHinweis v-if="medienErlaubt" />');
    });

    it("🔴 die Karte nimmt den Klick der Kartenwahl nur bei `medienErlaubt` an", () => {
        const aufrufe = [...app.matchAll(/^(\s*)(?:if \(medienErlaubt\)\s*)?installMedienStelle\(/gmu)];
        expect(aufrufe).toHaveLength(1);
        expect(app).toMatch(/if \(medienErlaubt\)\s+installMedienStelle\(map,/u);
    });
});

describe("🔴 Der Wetter-Editor lädt nach: im Start steht nur seine Hülle (WI-0288, Besucherpaket 2026-11-08)", () => {
    const bau = lies("apps/web/src/nachladen.ts");
    const entwicklung = lies("apps/web/src/nachladen.entwicklung.ts");
    const app = lies("apps/web/src/app.vue");

    it("beide Fassungen nennen den Lader der Steuerung und den geladenen Stand", () => {
        for (const quelle of [bau, entwicklung]) {
            expect(quelle).toMatch(/^export const ladeWettereditor = /mu);
            expect(quelle).toMatch(/^export const wettereditorGeladen = /mu);
        }
        // Der Bau lädt die Steuerung mit den späten Texten (`wettereditor.*`) und für Editoren vor dem Einhängen.
        expect(bau).toContain('mitTexten(() => import("./wettereditor/wettereditor-steuerung"))');
        const vorEinhaengen = bau.slice(bau.indexOf("export async function ladeEditorVor()"));
        expect(vorEinhaengen.slice(0, vorEinhaengen.indexOf("\n}\n"))).toContain("ladeWettereditor(),");
    });

    it("🔴 kein Modul im Start bindet Steuerung, Modell, Speicher, Wiki-Suche oder Leseweg des Editors statisch ein", () => {
        expect(app).toContain("createWettereditorHuelle(");
        expect(app).toContain("{ laden: ladeWettereditor, geladen: wettereditorGeladen }");
        const imStart = [
            "apps/web/src/app.vue",
            "apps/web/src/wettereditor/wettereditor-huelle.ts",
            "apps/web/src/wettereditor/wettereditor-seite.vue",
            "apps/web/src/wettereditor/wetter-kartenmenue.ts",
            "apps/web/src/wettereditor/wetter-zaehlung.ts",
            "apps/web/src/map/wetter/wetter-wiki-name.ts",
            "apps/web/src/editor-panel/karteninhalte-zahlen.ts",
            "apps/web/src/map/wetter/wetter-schalter.ts",
        ];
        const editor =
            /^import\s+(?!type\b)[^;]*from\s+"[./]*(?:wettereditor\/)?(?:wettereditor-steuerung|wetter-editor-modell|wetter-speicher|wetter-wiki|wetter-editor-daten)";/gmu;
        for (const datei of imStart) expect(lies(datei).match(editor), datei).toBeNull();
    });
});
