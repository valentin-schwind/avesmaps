import { describe, expect, it } from "vitest";
import { KANAL_BILD_TYPEN, bilderAus, ziehtDateien } from "../src/auth/kanal-bild-annahme.ts";

/**
 * Bilder ablegen und einfügen (Kanal OPS-000013, Thomas 2026-10-15). Die Regeln ohne Browser: was angenommen wird, wie viel
 * noch Platz ist, und dass ein eingefügter Text Text bleibt.
 */

const datei = (name: string, typ: string): File => new File(["x"], name, { type: typ });

describe("Was der Kanal als abgelegtes oder eingefügtes Bild annimmt", () => {
    it("die vier Rasterbilder, wie in der Dateiwahl", () => {
        const dateien = KANAL_BILD_TYPEN.map((typ, i) => datei(`b${String(i)}`, typ));
        expect(bilderAus(dateien, 10)).toHaveLength(4);
    });

    it("🔴 alles andere nicht — ein PDF und eine Textdatei fallen weg", () => {
        const dateien = [datei("a.pdf", "application/pdf"), datei("b.txt", "text/plain"), datei("c.png", "image/png")];
        expect(bilderAus(dateien, 10).map((d) => d.name)).toEqual(["c.png"]);
    });

    it("🪤 `platz` ist der RESTliche Platz: zwei von drei belegt, also kommt nur noch eines an", () => {
        const dateien = [datei("a.png", "image/png"), datei("b.png", "image/png")];
        expect(bilderAus(dateien, 1).map((d) => d.name)).toEqual(["a.png"]);
        expect(bilderAus(dateien, 0)).toEqual([]);
    });

    it("ohne Dateien kommt nichts — eingefügter Text bleibt Text", () => {
        expect(bilderAus(null, 3)).toEqual([]);
        expect(bilderAus(undefined, 3)).toEqual([]);
        expect(bilderAus([], 3)).toEqual([]);
    });

    it("der Hinweis leuchtet nur, wenn Dateien gezogen werden", () => {
        // 🪤 Beim Ziehen sind die Dateien noch nicht lesbar; „Files“ in `types` ist alles, was es gibt.
        expect(ziehtDateien({ types: ["Files"] })).toBe(true);
        expect(ziehtDateien({ types: ["text/plain"] })).toBe(false);
        expect(ziehtDateien(null)).toBe(false);
    });
});
