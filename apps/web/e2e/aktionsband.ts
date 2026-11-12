import { expect, type Page } from "@playwright/test";

/**
 * Die Form des Aktionsbandes im Infopanel, an EINER Stelle.
 *
 * 🔴 **Vier Kacheln stehen in ZWEI Reihen à zwei Spalten, weniger stehen in einer Reihe** (Betreiberentscheidung vom
 * 2026-10-06: „ja, mach die zwei reihen beim weg“; Regel in `info-panel/info-actions.vue` als
 * `.info-actions__grid:has(> :nth-child(4))`, gezählt am DOM, nicht an der Objektart). Der Grund steht dort: Mit vier
 * Spalten in einer Reihe blieb jede Kachel 81,25 px schmal, und „Änderungen vorschlagen“ brauchte am Rechner drei und
 * bei 360 px vier Zeilen.
 *
 * 💣 Vor dieser Entscheidung stand das Band immer in vier Spalten, und genau diese Zahl prüften `info-panel-grammar`
 * (Rechner) und `info-panel-grammar.touch` (Telefon) fest nach. Gareth hat drei Kacheln; beide Fälle waren deshalb
 * dauerhaft rot mit „Expected 4, Received 3“, in zwei Dateien, an einer Ursache. Die Form steht jetzt hier, und ein
 * Wechsel der Entscheidung ist eine Änderung an einer Stelle.
 *
 * Geprüft wird beides zusammen, denn einzeln sagt keines etwas: die ZAHL der Spuren nach der Regel UND dass alle
 * Spuren gleich breit sind (das war die eigentliche Aussage „gleich breite Spalten“).
 */
export async function expectActionBandShape(page: Page): Promise<{ kacheln: number; spalten: number }> {
    const band = page.locator(".info-actions__grid").first();
    const form = await band.evaluate((element) => ({
        kacheln: element.children.length,
        spuren: getComputedStyle(element)
            .gridTemplateColumns.split(" ")
            .filter((track) => track.length > 0),
    }));
    expect(form.kacheln, "das Band trägt überhaupt Kacheln").toBeGreaterThan(0);
    const erwartet = form.kacheln >= 4 ? 2 : form.kacheln;
    expect(form.spuren.length, `${String(form.kacheln)} Kacheln stehen in ${String(erwartet)} Spalten`).toBe(erwartet);
    const breiten = form.spuren.map((track) => Number.parseFloat(track));
    expect(
        breiten.some((width) => Number.isNaN(width)),
        `Spurbreiten in px: ${form.spuren.join(" ")}`,
    ).toBe(false);
    expect(Math.max(...breiten) - Math.min(...breiten), "alle Spalten sind gleich breit").toBeLessThanOrEqual(0.5);
    return { kacheln: form.kacheln, spalten: form.spuren.length };
}
