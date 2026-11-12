import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Die zwei Klappboxen über dem Ergebnis des Planers: „Transportmittel“ und „Reiseoptionen“.
 *
 * 🔴 Seit WI-0089 P3 sind sie dieselbe Klappbox wie die Deckel der Routendetails (`controls/avm-disclosure.vue`,
 * Betreiber 2026-10-06: „gib beiden den normalen stil der klappbox, die nach unten aufgeht und wo der header stabil
 * bleibt“). Vorher waren sie Rahmenkästen (`frame-box.vue`), deren Aufschrift beim Klappen 15 px wanderte.
 *
 * 🪤 Sie klappen mit der Route zu (Legacy `map-features-planner-groups.js`). Ein Fall, der an ihren Inhalt will, öffnet
 * sie deshalb selbst - genau wie ein Mensch es täte.
 */
export type PlannerBox = "transport" | "options";

/** Die Kopfzeile der Box: der Schalter, auf dem `aria-expanded` sitzt. */
export const plannerBoxToggle = (page: Page, box: PlannerBox): Locator => page.getByTestId(`${box}-toggle`);

/** Die ganze Box, samt Inhalt. */
export const plannerBox = (page: Page, box: PlannerBox): Locator => page.getByTestId(`planner-${box}`);

/** Die Kurzangabe der Kopfzeile („8,0 h/Tag · ab 15. Firun“); sie steht in beiden Zuständen da. */
export const plannerBoxSummary = (page: Page, box: PlannerBox): Locator =>
    plannerBox(page, box).locator(".disclosure__secondary");

/** Klappt die Box auf, falls sie zu ist, und wartet, bis die Fahrt vorbei ist. */
export async function openPlannerBox(page: Page, box: PlannerBox, options?: { tap?: boolean }): Promise<void> {
    const toggle = plannerBoxToggle(page, box);
    await expect(toggle).toBeVisible();
    if ((await toggle.getAttribute("aria-expanded")) === "false") {
        if (options?.tap === true) await toggle.tap();
        else await toggle.click();
    }
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await settlePlannerBox(page, box);
}

/** Klappt die Box zu, falls sie offen ist. */
export async function closePlannerBox(page: Page, box: PlannerBox): Promise<void> {
    const toggle = plannerBoxToggle(page, box);
    if ((await toggle.getAttribute("aria-expanded")) === "true") await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await settlePlannerBox(page, box);
}

/**
 * 🪤 `aria-expanded` kippt sofort, die Höhe fährt danach (`animateHeight`, 150 beziehungsweise 110 ms). Wer dazwischen
 * misst, liest eine Box, die noch an der alten Höhe hängt. Bei reduzierter Bewegung kehrt das hier sofort zurück.
 */
export async function settlePlannerBox(page: Page, box: PlannerBox): Promise<void> {
    await page.waitForFunction(
        (testid) => {
            const element = document.querySelector(`[data-testid="${testid}"]`);
            return element !== null && element.getAnimations({ subtree: true }).length === 0;
        },
        `planner-${box}`,
        { timeout: 10_000 },
    );
}
