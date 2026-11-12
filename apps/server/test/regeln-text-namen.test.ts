import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
    INHALTE_VORKOMMEN_ARTEN,
    INHALTE_VORKOMMEN_BEZIEHUNGEN,
    WIKISYNC_KLIMAZONEN,
    WIKISYNC_LAGE_RICHTUNGEN,
    WIKISYNC_LANDSCHAFTSARTEN,
} from "@avesmaps3d/shared";
import {
    ARTEN_NAMEN,
    BEZIEHUNGS_NAMEN,
    DE_SCHLUESSEL,
    KATEGORIE_NAMEN,
    RICHTUNG_NAMEN,
    ZONEN_NAMEN,
} from "../src/inhalte/regeln-text/namen.ts";

/**
 * „Regeln als Text“ schreibt die Wörter der Oberfläche (WI-0254 §13): Der Server führt eine kleine Kopie der deutschen Anzeigenamen (`regeln-text/namen.ts`), weil er die Tafel der Oberfläche nicht einlesen darf.
 * Dieser Test liest `apps/web/src/i18n/de.ts` als Text und hält jeden Wert gegen seinen Schlüssel, damit die beiden Tafeln nicht auseinanderlaufen.
 */

const DE_TS = readFileSync(fileURLToPath(new URL("../../web/src/i18n/de.ts", import.meta.url)), "utf8");

/** Der Wert eines Schlüssels in `de.ts` (eine Zeichenkette in Anführungszeichen, auch auf der Zeile darunter); `undefined`, wo es ihn nicht gibt. */
function deWert(schluessel: string): string | undefined {
    const maskiert = schluessel.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const treffer = new RegExp(`^\\s*"${maskiert}":\\s*("(?:[^"\\\\]|\\\\.)*")`, "mu").exec(DE_TS);
    return treffer === null ? undefined : (JSON.parse(treffer[1]!) as string);
}

describe("Anzeigenamen von „Regeln als Text“ gegen die deutsche Tafel der Oberfläche", () => {
    for (const { tafel, anfang, schluessel } of DE_SCHLUESSEL) {
        it(`${anfang}…: jeder Schlüssel hat dasselbe Wort wie in de.ts`, () => {
            expect(schluessel.length).toBeGreaterThan(0);
            for (const eins of schluessel) {
                const ziel = `${anfang}${eins}`;
                expect(deWert(ziel), `de.ts kennt „${ziel}“ nicht`).toBeDefined();
                expect(tafel[eins], `namen.ts kennt „${eins}“ nicht`).toBe(deWert(ziel));
            }
            // Und nichts steht in der Tafel, was der Vertrag nicht kennt.
            expect(Object.keys(tafel).sort()).toEqual([...schluessel].sort());
        });
    }

    it("die Tafeln decken genau die Wortlisten des Vertrags", () => {
        expect(Object.keys(ARTEN_NAMEN).sort()).toEqual(WIKISYNC_LANDSCHAFTSARTEN.map((a) => a.art).sort());
        expect(Object.keys(ZONEN_NAMEN)).toEqual([...WIKISYNC_KLIMAZONEN]);
        expect(Object.keys(RICHTUNG_NAMEN)).toEqual([...WIKISYNC_LAGE_RICHTUNGEN]);
        expect(Object.keys(BEZIEHUNGS_NAMEN)).toEqual([...INHALTE_VORKOMMEN_BEZIEHUNGEN]);
        expect(Object.keys(KATEGORIE_NAMEN)).toEqual([...INHALTE_VORKOMMEN_ARTEN]);
    });
});
