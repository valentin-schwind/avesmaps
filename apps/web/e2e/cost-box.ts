import type { Page } from "@playwright/test";

/**
 * Wörter im Kasten „Reisekosten je Person“, die an einer BELIEBIGEN Stelle abgeschnitten werden (WI-0065, Betreiber 2026-09-30:
 * „1 × Gemeinschaftszimme“ / „r“ im Dunkelmodus am Rechner). Dazu, ob der Kasten über seine Breite hinausläuft.
 *
 * 💣 **Hier zählte jeder Umbruch im Wort als Fehler, und seit WI-0088 P3 ist das falsch.** Der Betreiber hat am 2026-10-06
 * deutsche Silbentrennung verlangt („und kannst du auf deutsche silbentrennung achten - auch bei links“), sie steht als
 * `html { hyphens: auto }` im Kanon und erbt in jede Fläche - also auch hierher. Seitdem brach jedes lange Wort im Kasten
 * regelgerecht MIT Trennstrich um, und dieser Helfer meldete es als Verstoß: zwei Telefonfälle waren dauerhaft rot
 * („Wiedererstandenes“ bei 360 px, „Gemeinschaftszimmer:“, „Kaiserreich“ und „Greifenthron“ bei 320 px).
 *
 * 🔴 Die Zusicherung von 2026-09-30 bleibt unverändert: Ein Wort darf nicht an einer beliebigen Stelle abgeschnitten werden.
 * Unterschieden wird mit der GEGENPROBE, die `silbentrennung.spec.ts` schon benutzt („Bricht es dann trotzdem in die Spalte,
 * hat der Browser getrennt“): Am Wort, das umbricht, wird der Beliebig-Umbruch kurz abgeschaltet (`overflow-wrap: normal`,
 * `word-break: normal`; `hyphens` bleibt). Bricht es DANN noch, konnte nur die Trennung es brechen - erlaubt. Bricht es
 * nicht mehr, sondern rutscht als Ganzes in die nächste Zeile, dann war der Umbruch vorher ein Abschneiden - Befund.
 *
 * 🪤 Gezählt werden ZEILEN, nicht Rechtecke: `getClientRects()` liefert einen Kasten je Textfragment, und eine Zeile
 * zerfällt gern in zwei (gemessen: `280+22` und `302+4` auf derselben Oberkante). Wer Rechtecke zählt, hält ein Fragment
 * für einen Umbruch.
 *
 * 🪤 Die zweite Hälfte der Aussage steckt in `overflows`: Ein Wort, für das es keine Trennstelle gibt, bricht nicht, sondern
 * läuft über - beides zusammen deckt den Fall ab, keines allein.
 */
export async function costBoxProblems(page: Page): Promise<{ broken: string[]; overflows: boolean }> {
    return page.evaluate(() => {
        const box = document.querySelector<HTMLElement>('[data-testid="route-costs"]');
        if (!box) throw new Error("Kasten fehlt");
        const broken: string[] = [];
        const range = document.createRange();
        /** Über wie viele Zeilen das Wort gesetzt ist (Rechtecke mit gleicher Oberkante sind eine Zeile). */
        const zeilen = (): number =>
            new Set([...range.getClientRects()].filter((rect) => rect.width > 0.5).map((rect) => Math.round(rect.top)))
                .size;
        const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const text = node.textContent ?? "";
            for (const match of text.matchAll(/\S+/g)) {
                range.setStart(node, match.index);
                range.setEnd(node, match.index + match[0].length);
                if (zeilen() <= 1) continue;
                const parent = node.parentElement;
                if (parent === null) continue;
                // Die Gegenprobe am selben Wort: nur noch die Trennung darf brechen.
                const vorher = { wrap: parent.style.overflowWrap, brk: parent.style.wordBreak };
                parent.style.overflowWrap = "normal";
                parent.style.wordBreak = "normal";
                const nurMitTrennung = zeilen();
                parent.style.overflowWrap = vorher.wrap;
                parent.style.wordBreak = vorher.brk;
                if (nurMitTrennung <= 1) broken.push(match[0]);
            }
        }
        return { broken, overflows: box.scrollWidth > box.clientWidth + 1 };
    });
}

/**
 * 🔴 Die Unterzeilen der Übernachtung laufen nie über (Betreiber 2026-10-04: „das "8 × im Gemeinschaftszimmer: 4 S 8 H1" bricht
 * nicht um“): Gemessen werden die Rechtecke ALLES Sichtbaren in der Zeile - nicht die Kiste der Zeile, denn Inhalt, der nicht
 * umbricht, ragt aus ihr hinaus und lässt sie unverändert. Passt eine Zeile nicht in eine Zeile, bricht sie nach dem Doppelpunkt
 * und der Betrag samt Fußnotenzahl rutscht als Ganzes darunter: Betrag und Nummer teilen eine Zeile, die Münzstellen stehen
 * zusammen.
 */
export interface NightLineReport {
    text: string;
    /** Wie weit Sichtbares über den rechten Rand der Wertspalte ragt (px, positiv = Überlauf). */
    overflowRight: number;
    /** Wie weit es links vor der Wertspalte beginnt. */
    overflowLeft: number;
    /** Die Zeile rollt (`scrollWidth > clientWidth`). */
    scrolls: boolean;
    /** Steht der Betrag samt Fußnotenzahl in einer Zeile (die Hülle `costs__keep` hat ein Rechteck von Zeilenhöhe)? */
    keepOnOneLine: boolean | null;
    /** Brach die Zeile um, beginnt der Betrag unter dem Text und der Text endet mit dem Doppelpunkt. */
    breaksAfterColon: boolean | null;
    /** Zeilenhöhe der Unterzeile in px: eine Zeile ist etwa 16. */
    height: number;
}

export async function nightLineReports(page: Page): Promise<NightLineReport[]> {
    return page.evaluate(() => {
        const range = document.createRange();
        return [...document.querySelectorAll<HTMLElement>('[data-testid="cost-night"]')].map((night) => {
            const column = night.closest<HTMLElement>('[data-testid="cost-lodging"]')!.getBoundingClientRect();
            let right = -Infinity;
            let left = Infinity;
            const walker = document.createTreeWalker(night, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                if (!/\S/.test(node.textContent ?? "")) continue;
                // Der Text für Screenreader ist aus dem Bild genommen und zählt nicht.
                if (node.parentElement?.closest(".fnref__sr")) continue;
                range.selectNodeContents(node);
                for (const rect of range.getClientRects()) {
                    if (rect.width < 0.5) continue;
                    right = Math.max(right, rect.right);
                    left = Math.min(left, rect.left);
                }
            }
            const keep = night.querySelector<HTMLElement>(".costs__keep");
            const keepRect = keep?.getBoundingClientRect();
            const nightRect = night.getBoundingClientRect();
            const wrapped = nightRect.height > 22;
            // Der letzte Text vor dem Betrag (Vue setzt leere Ankerknoten dazwischen).
            let previous = keep?.previousSibling ?? null;
            while (previous && !(previous.textContent ?? "").trim()) previous = previous.previousSibling;
            const before = previous?.textContent ?? "";
            return {
                text: (night.textContent ?? "").replace(/\s+/g, " ").trim(),
                overflowRight: Math.round((right - column.right) * 10) / 10,
                overflowLeft: Math.round((column.left - left) * 10) / 10,
                scrolls: night.scrollWidth > night.clientWidth + 1,
                keepOnOneLine: keepRect ? keepRect.height < 22 : null,
                breaksAfterColon:
                    keepRect && wrapped && night.querySelector(".costs__night-amount")
                        ? keepRect.top - nightRect.top > 8 && before.trim().endsWith(":")
                        : null,
                height: Math.round(nightRect.height),
            };
        });
    });
}

/**
 * Die linke Kante der Zeilenbeschriftungen und der Fußnoten fluchtet mit dem Text der Kopfzeile (Betreiber 2026-10-04: „schau
 * dass es mit dem header aligned“). Gemessen am ersten sichtbaren Text, nicht an der Kiste: Die Kiste hat Polster, der Text
 * nicht. Dazu jede andere Klappbox des Planers, deren Inhalt mit Text beginnt - sie teilen die Klasse und das Polster.
 */
export interface AlignmentReport {
    /** Linke Kante des Textes der Kopfzeile des Kostenkastens. */
    head: number;
    /** Linke Kante der Zeilenbeschriftungen (Übernachtung, Verpflegung, …). */
    labels: number[];
    /** Linke Kante der Fußnotennummern. */
    footnotes: number[];
    /** Alle übrigen Klappboxen: Kopfzeile und erster Text des Inhalts. */
    others: { box: string; head: number; content: number }[];
}

export async function alignmentReport(page: Page): Promise<AlignmentReport> {
    return page.evaluate(() => {
        const range = document.createRange();
        const textLeft = (root: Element): number | null => {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                if (!/\S/.test(node.textContent ?? "")) continue;
                const parent = node.parentElement;
                if (parent && getComputedStyle(parent).position === "absolute") continue;
                range.selectNodeContents(node);
                const rect = range.getClientRects()[0];
                if (rect && rect.width > 0) return Math.round(rect.left * 10) / 10;
            }
            return null;
        };
        const headOf = (box: Element): number => {
            const title = box.querySelector(".disclosure__labels > span");
            return (title && textLeft(title)) ?? Number.NaN;
        };
        const costs = document.querySelector('[data-testid="planning-costs"]')!;
        const labels = [...document.querySelectorAll('[data-testid="route-costs"] .figure__label')].map(
            (label) => textLeft(label) ?? Number.NaN,
        );
        const footnotes = [...document.querySelectorAll('[data-testid="cost-footnote"] sup')].map(
            (number) => Math.round(number.getBoundingClientRect().left * 10) / 10,
        );
        const others = [...document.querySelectorAll('[data-testid="route-planning"] > details')]
            .filter((box) => box !== costs)
            .map((box) => ({
                box: (box as HTMLElement).dataset["testid"] ?? "",
                head: headOf(box),
                content: textLeft(box.querySelector(".disclosure__content")!) ?? Number.NaN,
            }))
            // Das Höhenprofil beginnt mit einer Zeichnung (Achsenbeschriftung), nicht mit Text am Rand.
            .filter((entry) => entry.box !== "planning-profile");
        return { head: headOf(costs), labels, footnotes, others };
    });
}
