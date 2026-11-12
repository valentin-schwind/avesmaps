import { expect, type Locator } from "@playwright/test";

export interface LidLines {
    text: string;
    /** Wie viele Textzeilen der Deckel hat. */
    lines: number;
    /** Ragt etwas über den Rand des Deckels? */
    clipped: boolean;
    /** Hat der Deckel überhaupt eine Kurzangabe? Ohne sie gibt es nichts, was als Ganzes umbrechen könnte. */
    hasSecondary: boolean;
    /** Beginnt die Kurzangabe in einer eigenen Zeile am linken Rand (als Ganzes umgebrochen)? */
    moved: boolean;
}

/**
 * Wie die Deckel der Routendetails stehen: Zahl der Textzeilen, ob etwas über den Rand ragt, und ob eine umgebrochene
 * Kurzangabe als Ganzes in der zweiten Zeile beginnt. Zeilen werden an den Textrechtecken gezählt, nicht an der Höhe.
 */
export async function lidLines(lids: Locator): Promise<LidLines[]> {
    return lids.evaluateAll((summaries) =>
        summaries.map((summary) => {
            const labels = summary.querySelector<HTMLElement>(".disclosure__labels")!;
            const range = document.createRange();
            range.selectNodeContents(labels);
            const tops = [...range.getClientRects()]
                .filter((rect) => rect.width > 0)
                .map((rect) => rect.top)
                .sort((a, b) => a - b);
            const lines = tops.filter((top, index) => index === 0 || top - tops[index - 1]! > 3).length;
            const title = labels.firstElementChild!.getBoundingClientRect();
            const secondary = summary.querySelector(".disclosure__secondary")?.getBoundingClientRect();
            const left = labels.getBoundingClientRect().left;
            return {
                text: (summary.textContent ?? "").replace(/\s+/g, " ").trim(),
                lines,
                clipped: labels.scrollWidth > labels.clientWidth + 1 || summary.scrollWidth > summary.clientWidth + 1,
                hasSecondary: secondary !== undefined,
                moved: secondary !== undefined && secondary.top > title.top + 1 && Math.abs(secondary.left - left) < 1,
            };
        }),
    );
}

/**
 * 🔴 Die Regel der Deckel (Betreiber 2026-10-03): „1 zeilig“, wo es passt; auf schmalen Geräten „A“: sonst rutscht die
 * Kurzangabe als Ganzes in eine zweite Zeile unter den Titel. Nichts fehlt, nichts wird abgeschnitten.
 *
 * 🪤 **Die Regel gilt der Kurzangabe.** Ein Deckel OHNE Kurzangabe ist EIN Satz und bricht an seinen Wörtern - da gibt es
 * nichts, was „als Ganzes“ rutschen könnte. Seit WI-0081 gibt es so einen Deckel mit zwei Zahlen („Durch 18 Landschaften
 * und 46 politische Gebiete“, Wortlaut des Betreibers 2026-10-05): am Rechner und bei 412 px einzeilig, bei 360 und
 * 320 px gemessen zweizeilig, nichts abgeschnitten.
 */
export function expectLidRule(lids: readonly LidLines[], context: string): void {
    for (const lid of lids) {
        expect(lid.clipped, `${context}: nichts abgeschnitten – ${lid.text}`).toBe(false);
        if (lid.lines > 1 && lid.hasSecondary)
            expect(lid.moved, `${context}: Kurzangabe als Ganzes in Zeile 2 – ${lid.text}`).toBe(true);
    }
}
