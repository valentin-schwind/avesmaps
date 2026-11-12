import { describe, expect, it } from "vitest";
import { hitTypeLabel, moveActive } from "../src/search/search-client";

// F und Leertaste öffnen die Suche über die Tastaturtafel der Karte (WI-0016): geprüft in keyboard.test.ts.
describe("Suchfeld: Tastatur", () => {
    it("Pfeiltasten wandern im Kreis", () => {
        expect(moveActive(0, 3, 1)).toBe(1);
        expect(moveActive(2, 3, 1)).toBe(0);
        expect(moveActive(0, 3, -1)).toBe(2);
        expect(moveActive(0, 0, 1)).toBe(-1);
    });
});

describe("Suchfeld: Typangabe", () => {
    const hit = { id: "x", name: "n", x: 0, y: 0, zoom: 5 };

    it("zeigt Ortsklasse und Wegart auf Deutsch, nicht den Schlüssel", () => {
        expect(hitTypeLabel({ ...hit, kind: "ort", subtype: "grossstadt" })).toBe("Großstadt");
        expect(hitTypeLabel({ ...hit, kind: "weg", subtype: "Reichsstrasse" })).toBe("Reichsstraße");
        expect(hitTypeLabel({ ...hit, kind: "klima" })).toBe("Klimazone");
    });

    it("🔴 eine Landschaft nennt ihre Art, damit gleichnamige zu unterscheiden sind (WI-0047)", () => {
        // „Große Öde“ gibt es als Tiefebene und als Steppe: zwei Zeilen, die sonst gleich aussähen.
        expect(hitTypeLabel({ ...hit, kind: "landschaft", subtype: "huegelland" })).toBe("Hügelland");
        expect(hitTypeLabel({ ...hit, kind: "landschaft", subtype: "tiefebene" })).not.toBe(
            hitTypeLabel({ ...hit, kind: "landschaft", subtype: "steppe" }),
        );
    });

    it("🪤 fällt bei unbekanntem Subtyp auf die Art zurück, nie auf den rohen Schlüssel", () => {
        expect(hitTypeLabel({ ...hit, kind: "ort", subtype: "neu_erfunden" })).toBe("Ort");
        expect(hitTypeLabel({ ...hit, kind: "weg" })).toBe("Weg");
        expect(hitTypeLabel({ ...hit, kind: "landschaft", subtype: "neu_erfunden" })).toBe("Derographie");
        expect(hitTypeLabel({ ...hit, kind: "landschaft" })).toBe("Derographie");
    });
});
