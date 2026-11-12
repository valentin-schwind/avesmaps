import { expect, type Page } from "@playwright/test";

/**
 * Wer im Routenplaner rollt (Betreiber 2026-10-04: „aus irgendeinem grund hat die ganze reiseübersicht jetzt auch einen
 * scrollbalken, den braucht es nicht. der routenplaner hat schon einen“). Gemessen wird, was ein Mensch sieht: jedes Element
 * im Panel mit `overflow` auto oder scroll, dessen Inhalt wirklich höher (oder breiter) ist als es selbst.
 *
 * - **Genau EIN Scroll-Container** im Planer, nie zwei ineinander: Am Rechner rollt die Übersicht unter den feststehenden
 *   Eingaben (Legacy 12.08.2026), am Telefon das ganze Panel. Ein zweiter machte doppelte Scrollbalken, etwa beim Aufklappen
 *   der Grenzübertritte.
 * - **Kein waagerechter Überlauf**: weder rollt etwas seitlich, noch ragt Inhalt über den Rand des Panels, das ihn abschneidet.
 */
export interface ScrollReport {
    /** Elemente, die senkrecht rollen: genau eines. */
    vertical: string[];
    /** Elemente, die waagerecht rollen könnten: keines. */
    horizontal: string[];
    /** Das Panel schneidet seitlich Inhalt ab (`scrollWidth > clientWidth`): nein. */
    panelClipsSideways: boolean;
}

export async function scrollReport(page: Page): Promise<ScrollReport> {
    return page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>("#route-planner-panel");
        if (!panel) throw new Error("Planer fehlt");
        const vertical: string[] = [];
        const horizontal: string[] = [];
        for (const element of [panel, ...panel.querySelectorAll<HTMLElement>("*")]) {
            const style = getComputedStyle(element);
            const name = `${element.tagName.toLowerCase()}.${String(element.className).split(" ")[0] ?? ""}`;
            const scrollsY = style.overflowY === "auto" || style.overflowY === "scroll";
            const scrollsX = style.overflowX === "auto" || style.overflowX === "scroll";
            if (scrollsY && element.scrollHeight > element.clientHeight + 1) vertical.push(name);
            if (scrollsX && element.scrollWidth > element.clientWidth + 1) horizontal.push(name);
        }
        return { vertical, horizontal, panelClipsSideways: panel.scrollWidth > panel.clientWidth + 1 };
    });
}

/** Öffnet alles, was die Übersicht lang macht: Kosten samt Grenzübertritten, Landschaften und Gebiete, Höhenprofil. */
export async function openEverything(page: Page): Promise<void> {
    await expect(page.getByTestId("costs-toggle")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("areas-toggle")).toBeVisible({ timeout: 20_000 });
    for (const testid of ["costs-toggle", "areas-toggle", "profile-toggle"]) {
        const toggle = page.getByTestId(testid);
        if ((await toggle.count()) > 0) await toggle.click();
    }
    const borders = page.getByTestId("borders-toggle");
    await borders.scrollIntoViewIfNeeded();
    await borders.click();
    await expect(page.getByTestId("border-step").first()).toBeVisible();
    // Die Aufklappbewegung (150 ms) ist vorbei, bevor gemessen wird.
    await page.waitForTimeout(400);
}
