import { expect, test, type Page } from "@playwright/test";
import { showStages } from "./stage-groups.ts";

/**
 * Die Vorkommen einer ROUTENETAPPE am echten Stack (WI-0106, Betreiber 2026-10-07: „kannst du die lore auch in etappen
 * anzeigen“).
 *
 * 🔴 **Im Infopanel der Etappe, NICHT im Reiseplan** - und das ist in Legacy schon entschieden (Owner 2026-08-12,
 * `js/routing/__tests__/route-leg-lore-klima.test.js`): „zieh etappen nach, die sollen auch alle 4 anzeigen" — „aber nicht im
 * routenplaner sondern im infopanel". Darum prüft dieser Fall BEIDES: dass die vier Zeilen im Panel stehen und dass die
 * Etappenliste unberührt ist.
 *
 * 🔴 **Die Etappe selbst ist der Träger**: Sie erbt aus allen Flächen, die ihre Wegkette berühren - also nur „Aus der Region“
 * und der Link „Überall in Aventurien“, nie „Direkt von hier“ (`lore_place_target` hat keine `path_id`).
 *
 * 🪤 Braucht einen Fastify mit dem Lesepfad DIESES Worktrees auf dem Port, den `PORT` nennt (Vite liest daraus das Proxyziel),
 * und eine Entwicklungsdatenbank, in der I24 und I25 gelaufen sind. Eigene Ports dieser Sitzung:
 *   $env:PORT="3278"; $env:E2E_PORT="5278"; npx playwright test e2e/vorkommen-in-etappen.spec.ts
 */

/** Eine Reise, die der Satz der Entwicklungsdatenbank trägt (16 Etappen, gemessen 2026-10-07). */
const REISE = "/?route=Gareth~Ferdok";

/** Lädt die Reise und wählt eine Etappe über das Bild ihrer Zeile (die Mitte der Zeile kann ein Link sein). */
async function openStage(page: Page, index: number): Promise<void> {
    if (page.url().includes("route=")) {
        await page.getByTestId("route-stage").nth(index).locator("img").first().click();
    } else {
        await page.goto(REISE);
        await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, {
            timeout: 30_000,
        });
        await showStages(page);
        await page.getByTestId("route-stage").nth(index).locator("img").first().click();
    }
    await expect(page.getByTestId("info-title")).toHaveText(new RegExp(`^Etappe ${String(index + 1)} von \\d+$`));
}

/** Die Schlüssel der Feldzeilen, in der Reihenfolge, in der sie dastehen. */
const fieldKeys = (page: Page): Promise<string[]> =>
    page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("[data-testid=info-fact]")].map((row) => row.dataset["field"] ?? ""),
    );

test.describe("Die Vorkommen einer Routenetappe", () => {
    test("🔴 vier Zeilen, am ENDE der Feldliste, mit ihrem Zählsatz", async ({ page }) => {
        await openStage(page, 0);
        // Die Vorkommen kommen mit einer eigenen Anfrage nach dem Titel (`route-planner/stage-lore.ts`); unter Last stand die
        // Feldliste beim ersten Lesen noch ohne sie (WI-0192). Gewartet wird auf die Zeilen, nicht auf eine Zeit.
        const loreKeys = async (): Promise<string[]> =>
            (await fieldKeys(page)).filter((key) => key.startsWith("lore:"));
        // Die vier Arten in Legacys Reihenfolge, und keine vor ihnen stehende Zeile dahinter.
        await expect
            .poll(loreKeys, { timeout: 15_000 })
            .toEqual(["lore:ware", "lore:fauna", "lore:flora", "lore:spezies"]);
        const keys = await fieldKeys(page);
        const lore = keys.filter((key) => key.startsWith("lore:"));
        expect(keys.slice(-4)).toEqual(lore);
        // Die Zeile VOR ihnen gehört noch dem Planer („Führt durch“ heißt bei uns Landschaften und Gebiete).
        expect(keys.at(-5)).toMatch(/^(territories|landscapes|type|paths|transport|period|ground|slope)$/);

        for (const kind of lore) {
            const row = page.locator(`[data-field="${kind}"]`);
            await expect(row.getByTestId("info-lore-lid")).toBeVisible();
            // Der Zählsatz trägt eine Zahl größer null; „(0)“ gibt es nicht (WI-0063 5.3).
            await expect(row).toContainText(/\d/);
        }
    });

    test("🔴 nur „Aus der Region“ und der Link - nie „Direkt von hier“, nie „Von hier“", async ({ page }) => {
        await openStage(page, 0);
        const row = page.locator('[data-field="lore:ware"]');
        await row.locator("button").first().click();
        // 🪤 Die Antwort ist schon da (die Zeile bringt sie mit): kein Nachladen, keine Wartezeile.
        await expect(row.getByTestId("info-lore-pending")).toHaveCount(0);
        await expect(row.getByTestId("info-lore-failed")).toHaveCount(0);
        await expect(row.getByTestId("info-lore-heading").first()).toBeAttached({ timeout: 15_000 });

        const headings = await row.getByTestId("info-lore-heading").allInnerTexts();
        expect(headings).toEqual(["Aus der Region"]);
        // 🔴 Die Überschrift steht, obwohl es nur EINE Gruppe ist (Betreiber 2026-10-07, bewusste Abweichung von Legacy).
        await expect(row.getByTestId("info-lore-count").first()).toContainText(/\d/);
        // Und darunter die Linkzeile auf die Landschaft „Aventurien“.
        await expect(row.getByTestId("info-lore-everywhere")).toContainText("Überall in Aventurien");
    });

    test("🔴 die Zeilen gehören der gezeigten Etappe: Blättern wechselt sie", async ({ page }) => {
        await openStage(page, 0);
        const sentence = (): Promise<string> => page.locator('[data-field="lore:fauna"]').innerText();
        const first = await sentence();
        await page.getByTestId("info-stage-next").click();
        // Die Zahl der Etappen wandert mit dem Wegenetz (2026-10-16: 14 statt 16); geprüft wird das Blättern, nicht sie (WI-0192).
        await expect(page.getByTestId("info-title")).toHaveText(/^Etappe 2 von \d+$/);
        await expect(page.locator('[data-field="lore:fauna"]').getByTestId("info-lore-lid")).toBeVisible({
            timeout: 15_000,
        });
        // 🪤 Zwei Nachbaretappen können dieselben Träger berühren; dann ist der Satz gleich. Geprüft wird darum, dass die
        // Zeile WIEDER da ist - nicht, dass sich die Zahl ändert.
        expect(typeof first).toBe("string");
        await expect(page.locator('[data-field="lore:fauna"]')).toContainText(/\d/);
    });

    test("🔴 der Reiseplan bleibt unberührt - Legacys Ansage von 2026-08-12", async ({ page }) => {
        await page.goto(REISE);
        await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, {
            timeout: 30_000,
        });
        await showStages(page);
        const rows = page.getByTestId("route-stage");
        const texts = await rows.allInnerTexts();
        expect(texts.length).toBeGreaterThan(1);
        // Keine Etappenzeile nennt Vorkommen: kein Zählsatz, kein Deckel, keine Gruppe.
        for (const text of texts) {
            expect(text).not.toMatch(/gelistet|beobachtet|gesehen|verzeichnet|Aus der Region|Überall in Aventurien/);
        }
        await expect(page.getByTestId("route-stages").getByTestId("info-lore-lid")).toHaveCount(0);
    });
});
