import { expect, type Page } from "@playwright/test";

/**
 * Die Mediengruppen der Etappenliste aufklappen.
 *
 * 🔴 **Seit WI-0087 P4 öffnet eine Reise ZUGEKLAPPT** (Betreiber 2026-10-05: „kannst du doch lieber alle
 * etappenzusammenfassungen standardmäßg einklappen"). Ein Browserfall, der Etappenzeilen sehen oder anklicken will,
 * klappt sie deshalb selbst auf - genau wie ein Mensch es täte. Wer die Vorgabe selbst prüft, ruft das hier NICHT.
 *
 * 🪤 Geklickt wird immer der ERSTE noch zugeklappte Kopf, und danach wird gewartet, bis sich die Zahl der zugeklappten
 * Köpfe ÄNDERT: Die Boxen fahren auf (`animateHeight`), und ein Klick auf eine Liste, die gerade wächst, träfe sonst
 * daneben.
 *
 * 💣 **Hier stand `toHaveCount(count - 1)` gegen eine vorher gemerkte Zahl, und das kann unerfüllbar sein.** Wird die
 * Etappenliste zwischen Zählen und Klicken ERSETZT - etwa weil gerade eine neue Reise eintrifft, wie bei „Ganze Straße
 * als Route“ (WI-0063 B12) -, hat die neue Liste eine andere Zahl zugeklappter Köpfe, und „genau einer weniger als
 * vorher“ tritt nie ein. Der Helfer lief dann in seinen Timeout und machte den Fall rot, obwohl er nichts zu meckern
 * hatte (gemessen am 2026-10-06: erwartet 1, gesehen 4). Gewartet wird deshalb auf eine ÄNDERUNG, und die Zusicherung
 * steht am Ende: am Schluss ist kein Kopf mehr zu.
 *
 * 💣 **Gezählt wird nur an der FRISCHEN Liste** (WI-0248, Release-Lauf f80bb5c83: `ziel-hinzufuegen.spec.ts` „vierte hinten“, erwartet „nicht 5“,
 * zehn Sekunden lang 5). Rechnet eine Route neu, steht die alte Liste gedämpft und ohne Zeigerereignisse da (`.stages.is-stale`,
 * `pointer-events: none`), und ihre Gruppen sind schon wieder zu, sobald sich die Namen der Wegpunkte ändern (`route-stage-list.vue`: ein neues
 * Modell klappt alle zu). Der Helfer zählte dort 5, der Klick wartete (Actionability), bis die NEUE Route die Liste ersetzte, und klappte an ihr
 * eine von 6 auf: wieder 5, also „keine Änderung“. Gemessen mit Protokoll: `stale=true` und der Treffer unter dem Kopf war das Eingabefeld
 * des Wegpunkts. Darum wird zuerst gewartet, bis die Liste nicht mehr gedämpft ist; dann gilt die Zahl bis zum Klick.
 */
export async function openStageGroups(page: Page): Promise<void> {
    const closed = page.locator('[data-testid="route-stage-group"] [aria-expanded="false"]');
    for (let guard = 0; guard < 40; guard += 1) {
        await expect(page.getByTestId("route-stages")).not.toHaveClass(/(^|\s)is-stale(\s|$)/);
        const count = await closed.count();
        if (count === 0) break;
        await closed.first().click();
        await expect.poll(() => closed.count(), { timeout: 10_000 }).not.toBe(count);
    }
    // 🔴 Das ist die Zusicherung des Helfers, nicht die Zwischenzahl: Alle Gruppen sind offen.
    await expect(closed).toHaveCount(0);
    await settleStages(page);
}

/**
 * Warten, bis die Boxen zu Ende gefahren sind.
 *
 * 🪤 **Gemessen 2026-10-05:** `aria-expanded` kippt sofort, die Höhe fährt danach rund 200 ms (`animateHeight`). Wer
 * dazwischen misst, liest eine Kette, die noch an der alten Höhe hängt - in einer Messung lag ihr Ende 1.598 px zu
 * hoch. Das ist kein Fehler der Kette, sondern eine zu frühe Messung; die Kette selbst stimmt, sobald die Fahrt
 * vorbei ist. Bei reduzierter Bewegung gibt es keine Animation, dann kehrt das hier sofort zurück.
 */
export async function settleStages(page: Page, timeout = 10_000): Promise<void> {
    await page.waitForFunction(
        () => {
            const list = document.querySelector("[data-testid=route-stages]");
            return list !== null && list.getAnimations({ subtree: true }).length === 0;
        },
        undefined,
        { timeout },
    );
}

/** Die Etappenliste ist da und ihre Zeilen sind sichtbar: warten, aufklappen, auf die erste Zeile warten. */
export async function showStages(page: Page, timeout = 20_000): Promise<void> {
    await expect(page.getByTestId("route-stages")).toBeVisible({ timeout });
    await openStageGroups(page);
    await expect(page.getByTestId("route-stage").first()).toBeVisible({ timeout });
}
