import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { entfernenZiel } from "../src/wegeditor/weg-entfernen.ts";

/** „Weg entfernen …“ im Wege-Fenster (OPS-000085): Thomas' Fall ist ein Weg mit nur einem Abschnitt. */
const A = { id: "a", revision: 3 };
const B = { id: "b", revision: 4 };
const C = { id: "c", revision: 5 };

describe("Weg entfernen im Wege-Fenster", () => {
    it("🔴 ein einziger Abschnitt öffnet das Blatt für ihn, auch bei (W)", () => {
        expect(entfernenZiel([A], null)).toEqual({ art: "abschnitt", publicId: "a" });
    });
    it("(W) bei mehreren Abschnitten öffnet das Blatt der ganzen Straße mit allen Revisionen", () => {
        expect(entfernenZiel([A, B], null)).toEqual({
            art: "strasse",
            abschnitte: [
                { publicId: "a", revision: 3 },
                { publicId: "b", revision: 4 },
            ],
        });
    });
    it("ein gewählter Abschnitt von mehreren: nur er; ein Teil von mehreren: gesperrt", () => {
        expect(entfernenZiel([A, B, C], new Set(["b"]))).toEqual({ art: "abschnitt", publicId: "b" });
        expect(entfernenZiel([A, B, C], new Set(["a", "b"]))).toEqual({ art: "mehrere" });
        expect(entfernenZiel([A, B], new Set(["a", "b"]))?.art).toBe("strasse");
    });
    it("🔴 der Knopf steht außerhalb der Leiste für mehrere Abschnitte und sperrt bei Entwurf und ohne Recht", () => {
        const text = readFileSync(new URL("../src/wegeditor/wegeditor-fenster.vue", import.meta.url), "utf8");
        const knopf = text.indexOf("-weg-entfernen`");
        expect(knopf).toBeGreaterThan(text.indexOf("</template>", text.indexOf("strasse.segments.length > 1 &&")));
        expect(text).toContain('if (!schreibt.value) return t("editorPanel.verb.lesen")');
        expect(text).toContain('wikiBoxUngespeichert.value) return t("verlauf.gesperrtBearbeitung")');
    });
});
