import { describe, expect, it } from "vitest";
import { ersterSatz, saetzeVon } from "../src/saetze.ts";

/**
 * Der erste Satz einer Kurzbeschreibung (WI-0257 S5, Vali 2026-10-30: „der erste satz reicht“): Er bricht nicht an Abkürzungen. Die Zerlegung selbst prüft auch
 * `apps/server/test/wiki-kurzbeschreibung.test.ts` (dieselbe Regel, seit S5 geteilt).
 */
describe("ersterSatz", () => {
    it("🔴 Kürzel, einzelne Buchstaben und Ordnungszahlen beenden den ersten Satz nicht", () => {
        expect(ersterSatz("Sie wächst z. B. im Kosch. Sie blüht im Praios.")).toBe("Sie wächst z. B. im Kosch.");
        expect(ersterSatz("Ein Kraut, ca. zwei Spann hoch, bzw. etwas mehr. Es duftet.")).toBe(
            "Ein Kraut, ca. zwei Spann hoch, bzw. etwas mehr.",
        );
        expect(ersterSatz("Sie ist nachtaktiv, d. h. Sie ruht am Tag. Sie singt.")).toBe(
            "Sie ist nachtaktiv, d. h. Sie ruht am Tag.",
        );
        expect(ersterSatz("Benannt nach St. Boron und A. Rohal. Selten.")).toBe("Benannt nach St. Boron und A. Rohal.");
        expect(ersterSatz("Am 3. Praios beginnt die Ernte. Danach ruht sie.")).toBe("Am 3. Praios beginnt die Ernte.");
    });

    it("Fragezeichen und Ausrufezeichen beenden ihn; ohne Satzgrenze bleibt der Text ganz, leer bleibt leer", () => {
        expect(ersterSatz("Was ist das? Ein Insekt!")).toBe("Was ist das?");
        expect(ersterSatz("  Ein Satz ohne Punkt  ")).toBe("Ein Satz ohne Punkt");
        expect(ersterSatz("")).toBe("");
        expect(saetzeVon("Eins. Zwei.")).toEqual(["Eins.", "Zwei."]);
    });
});
