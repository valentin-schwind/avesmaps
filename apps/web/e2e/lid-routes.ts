import { expect, type Locator, type Page } from "@playwright/test";

export interface LidRoute {
    search: string;
    /** Ein Deckel, den diese Strecke zeigen muss. */
    expect?: RegExp;
}

/**
 * Die Strecken, an denen die Regel der Deckel gemessen wird (Betreiber 2026-10-03: „1 zeilig“, auf schmalen Geräten
 * „A“): lange Kostenangabe, zwei Reiterstrecken (der Fall der WI-0069-Sitzung: Boronaya → Moorburg), eine mit
 * Schifffahrtshinweisen und zwei Gebirgsreisen mit vierstelliger Höhe, zweistelligen Dukaten und zweistelliger Mehrzeit.
 */
export const LID_ROUTES: readonly LidRoute[] = [
    { search: "?route=Gareth~Fasar", expect: /^Reisekosten je Person: / },
    { search: "?route=Thorwal~Al'Anfa", expect: /^Reisekosten je Person: \d+ D/ },
    { search: "?route=Gareth~Fasar&landTransport=groupHorse", expect: /^Reisekosten je Person: / },
    { search: "?route=Boronaya~Moorburg&landTransport=groupHorse", expect: /^Reisekosten je Person: / },
    { search: "?route=Gareth~Kuslik", expect: /Schifffahrtshinweise/ },
    { search: "?route=Gareth~Vinsalt", expect: /^Reisekosten je Person: \d{2} D/ },
    {
        search: "?route=Punin~Fasar",
        expect: /^Höhenprofil: \+\d{2},\d Std\. \(bis \d+ %(?: \u2193\uFE0E?)?(?:, Schnee)?\)$/,
    },
    // Die längste Kurzangabe des Höhenprofils (Betreiber 2026-10-04: „Höhenprofil: +72,8 Std. (bis 19 %, Schnee)“ (B: ohne „Steigung“),
    // eine Zeile): Mehrzeit aus Steigung und Schnee zusammen. Am Rechner, bei 412 und 360 px eine Zeile; bei 320 px gilt „A“.
    {
        search: "?route=Greifenfurt~Lowangen&startMonth=firun&startDay=1",
        expect: /^Höhenprofil: \+\d{2},\d Std\. \(bis \d+ %(?: \u2193\uFE0E?)?, Schnee\)$/,
    },
];

/** Öffnet die Strecke, am Telefon auch den Planer, und wartet, bis die nachgeladenen Deckel stehen. */
export async function openLids(page: Page, search: string): Promise<Locator> {
    await page.goto(`/${search}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    const tab = page.getByTestId("route-planner-tab");
    // Am Rechner fährt der Planer von selbst herein (Legacy A1), am Telefon öffnet ihn ein Tippen.
    const phone = await page.evaluate(() => globalThis.matchMedia("(pointer: coarse)").matches);
    if (phone && (await tab.getAttribute("aria-expanded")) !== "true") await tab.tap();
    await expect(tab).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("costs-toggle")).toBeVisible({ timeout: 20_000 });
    // Gebiete und Landschaften kommen nach der Route; erst mit ihnen stehen alle Deckel.
    await expect(page.getByTestId("areas-toggle")).toBeVisible({ timeout: 20_000 });
    // „Unterwegs gibt es:“ (WI-0257 S4) kommt mit einer eigenen Frage nach den anderen Deckeln; wo es die Box gibt, gilt für ihren Deckel dieselbe Regel (einzeilig, nichts abgeschnitten).
    await page
        .getByTestId("unterwegs-toggle")
        .waitFor({ state: "visible", timeout: 20_000 })
        .catch(() => undefined);
    return page.getByTestId("route-planning").locator(":scope > details > summary");
}
