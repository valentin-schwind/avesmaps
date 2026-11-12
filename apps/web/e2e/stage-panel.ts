import { expect, type Locator, type Page } from "@playwright/test";
import { openStageGroups } from "./stage-groups.ts";

/**
 * Das Infopanel einer Etappe öffnen und seine Felder lesen (WI-0079 §3, §4).
 *
 * Seit WI-0079 ist die Etappenzeile des Planers kompakt: Zeile 1 nennt die beiden Orte, Zeile 2 Wegart, Distanz
 * und Reisezeit. Alles Übrige - Wege, Zeitraum, Boden, Steigung, Flugzuschlag, Landschaften, Gebiete, der lange
 * Querfeldein-Hinweis und der Sperrhinweis der Etappe - steht im Infopanel. Die Browserfälle, die diese Angaben
 * prüfen, öffnen sie deshalb hier.
 */

/** Die Etappenzeile `index` der Liste; sie liegt in ihrem Mediengruppenkasten. */
export const stageRow = (page: Page, index = 0): Locator => page.getByTestId("route-stage").nth(index);

/**
 * Öffnet das Infopanel der Etappe `index`. Geklickt wird auf das BILD der Zeile: Die Mitte der Zeile trägt die
 * Ortsnamen, und die sind eigene Objektlinks.
 */
export async function openStagePanel(page: Page, index = 0): Promise<void> {
    // 🔴 Seit WI-0087 P4 öffnet eine Reise zugeklappt: erst aufklappen, dann die Zeile anklicken.
    await openStageGroups(page);
    const row = stageRow(page, index);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.locator("img").first().click();
    // Das Wort kommt aus der Sprachtafel: „Etappe 1 von 7“, „Stage 1 of 7“, „Étape 1 sur 7“ (WI-0158).
    // 🪤 Niederländisch braucht hier kein eigenes Wort (WI-0165): „Etappe 1 van 7“ trifft denselben Zweig.
    // Italienisch schon (WI-0167): „Tappa 1 di 7“. Spanisch auch (WI-0170): „Etapa 1 de 7“.
    // Polnisch auch (WI-0174): „Etap 1 z 7“, Dänisch (WI-0210): „Etape 1 af 7“, Schwedisch (WI-0211): „Etapp 1 av 7“. 🪤 Das längere Wort steht davor; umgekehrt bliebe bei „Etapa 1 de 7“
    // das „a“ stehen und der Fall liefe nicht mehr.
    await expect(page.getByTestId("info-title")).toHaveText(
        new RegExp(`^(Etappe|Stage|Étape|Tappa|Etapa|Etape|Etapp|Etap) ${String(index + 1)} `),
        {
            timeout: 15_000,
        },
    );
}

/** Das Feld `key` der Feldliste des Panels („type“, „paths“, „period“, „ground“, „slope“, „landscapes“, …). */
export const stageField = (page: Page, key: string): Locator =>
    page.getByTestId("info-facts").locator(`[data-field="${key}"]`);

/** Der Wert dieses Feldes. */
export const stageFieldValue = (page: Page, key: string): Locator =>
    stageField(page, key).getByTestId("info-fact-value");
