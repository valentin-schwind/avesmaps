import type { Page } from "@playwright/test";

/**
 * Wie weit ein umbrechender Name von einem linksbündigen Satz abweicht (Betreiber 2026-09-24: ein umbrechender
 * Name steht linksbündig, nicht mittig). Jeder Treffer von `selector` in `scope` bekommt `text`, dann wird jedes
 * Fragment mit demselben Satz unter erzwungenem `text-align: left` verglichen. Die Ausrichtung ändert keinen Umbruch:
 * Linksbündig steht jedes Fragment auf den Pixel gleich, ein mittiger Satz oder ein <button> mit der Vorgabe des
 * Browsers (`text-align: center`) nicht. Je Treffer: Zahl der Zeilen und größte Abweichung in Pixeln.
 */
export async function flushLeftShifts(
    page: Page,
    scope: string,
    selector: string,
    text: string,
): Promise<{ lines: number; shift: number }[]> {
    return page.evaluate(
        ({ scope, selector, text }) => {
            const names = [...document.querySelectorAll<HTMLElement>(`${scope} ${selector}`)];
            const fragments = (): DOMRect[][] =>
                names.map((name) => {
                    const range = document.createRange();
                    range.selectNodeContents(name);
                    return [...range.getClientRects()];
                });
            for (const name of names) name.textContent = text;
            const actual = fragments();
            const flush = document.createElement("style");
            flush.textContent = `${scope}, ${scope} * { text-align: left !important; }`;
            document.head.append(flush);
            const reference = fragments();
            flush.remove();
            return actual.map((rects, index) => {
                const expected = reference[index]!;
                return {
                    lines: new Set(rects.map((rect) => Math.round(rect.top))).size,
                    shift:
                        rects.length === expected.length
                            ? Math.max(...rects.map((rect, at) => Math.abs(Math.round(rect.left - expected[at]!.left))))
                            : Number.POSITIVE_INFINITY,
                };
            });
        },
        { scope, selector, text },
    );
}
