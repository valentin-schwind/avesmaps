import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Die Einstellungszeile unter dem Reisetitel am echten Stack (Betreiber 2026-10-04): Wie sie steht - Zahl der Zeilen,
 * ob am Ende gekürzt wird, was Titel und Vorleser tragen - und der Weg zu ihr.
 */

export interface SettingsLine {
    /** Der Text, wie ein Vorleser ihn liest: das DOM, ungekürzt. */
    text: string;
    title: string | null;
    /** Wie viele Textzeilen sie hat. */
    lines: number;
    /** Wird am Ende mit „…“ gekürzt (der Text ragt über den Rand)? */
    truncated: boolean;
    /** Beschnitten am Ende der Zeile, nicht in der Mitte: Auslassungspunkt gesetzt, eine Zeile hoch. */
    ellipsis: string;
    /** Höhe der Zeile in px und die Höhe einer Textzeile. */
    height: number;
    lineHeight: number;
    /** Beginnt die Zeile unter dem Titel (oberhalb des Titels darf sie nicht stehen)? */
    belowTitle: boolean;
}

export async function settingsLine(page: Page): Promise<SettingsLine> {
    return page.getByTestId("route-settings").evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const tops = [...range.getClientRects()]
            .filter((rect) => rect.width > 0)
            .map((rect) => rect.top)
            .sort((a, b) => a - b);
        const style = getComputedStyle(element);
        const title = document.querySelector("[data-testid=route-title]")!.getBoundingClientRect();
        return {
            text: (element.textContent ?? "").replace(/\s+/g, " ").trim(),
            title: element.getAttribute("title"),
            lines: tops.filter((top, index) => index === 0 || top - tops[index - 1]! > 3).length,
            truncated: element.scrollWidth > element.clientWidth + 1,
            ellipsis: style.textOverflow,
            height: element.getBoundingClientRect().height,
            lineHeight: Number.parseFloat(style.lineHeight),
            belowTitle: element.getBoundingClientRect().top >= title.bottom - 1,
        };
    });
}

/** Öffnet die Reise, am Telefon auch den Planer, und wartet auf die Übersicht mit ihrer Zeile. */
export async function openOverview(page: Page, search: string): Promise<Locator> {
    await page.goto(`/${search}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    const tab = page.getByTestId("route-planner-tab");
    // Am Rechner fährt der Planer von selbst herein (Legacy A1), am Telefon öffnet ihn ein Tippen.
    const phone = await page.evaluate(() => globalThis.matchMedia("(pointer: coarse)").matches);
    if (phone && (await tab.getAttribute("aria-expanded")) !== "true") await tab.tap();
    await expect(tab).toHaveAttribute("aria-expanded", "true");
    const line = page.getByTestId("route-settings");
    await expect(line).toBeVisible({ timeout: 20_000 });
    return line;
}
