import { describe, expect, it } from "vitest";
import type { Benachrichtigung } from "@avesmaps3d/shared";
import { kreisVon, satzTeile, standSatz } from "../src/auth/benachrichtigungen.ts";

/**
 * Die andere Hälfte des Versprechens aus 0118 (WI-0181): Ein älteres Release liest eine Art, die erst ein neueres schreibt. Der Server
 * liefert sie aus; die Glocke zeigt den unbekannten Satz (`notify.text.unbekannt`) und bricht nicht.
 */
const unbekannt: Benachrichtigung = {
    id: 7,
    art: "erst_im_naechsten_release",
    von: { art: "claudio", id: null, name: null },
    ops: "OPS-000127",
    text: "Befund",
    frageGeloest: false,
    erstelltAt: "2026-10-16T09:00:00.000Z",
    gelesenAt: null,
    beantwortetAt: null,
    antwort: null,
    vorgang: null,
};

describe("Glocke: eine Art, die dieses Release nicht kennt", () => {
    it("🔴 zeigt den unbekannten Satz mit der OPS-Nummer, ungelesen, ohne Stand", () => {
        expect(satzTeile(unbekannt)).toEqual({ vor: "", ops: "OPS-000127", nach: "" });
        expect(kreisVon(unbekannt)).toBe("leer");
        expect(standSatz(unbekannt, (iso) => iso)).toBeNull();
    });

    it("bricht auch ohne OPS-Nummer nicht", () => {
        expect(() => satzTeile({ ...unbekannt, ops: null })).not.toThrow();
    });
});
