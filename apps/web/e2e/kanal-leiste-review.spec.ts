import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { test, type Page } from "@playwright/test";
import { kanalServer, kanalVorgaenge, stubKanal } from "./kanal-stub.ts";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Nahaufnahme der Fortschrittsleiste, gebaute Fassung (Betreiber 2026-10-13: „Leiste bleibt, aber mit Status-Stationen“).
 *
 * Zwei Bilder, hell und dunkel je Fall:
 *   1. OPS-000134 „Stage lädt keine Kacheln“ — in Arbeit, KEIN Fix-Bericht, KEIN Nachweis: der Status-Weg.
 *      Das ist Thomas' Fall vom 2026-10-13, an dem vier Fix-Stationen auf „offen“ standen, obwohl Claudio geantwortet hatte.
 *   2. OPS-000127 „See-321 wird sichtbar“ — zur Abnahme, drei Nachweise: die Fix-Stationen wie bisher.
 *
 * 💣 Prüft nichts; die Zusicherungen stehen in `packages/shared/test/kanal-stationen.test.ts` und `kanal.spec.ts`.
 *
 *   npm run review:kanal-leiste
 *
 * Ablage: `review/kanal-leiste/` (nicht versioniert); `REVIEW_DIR` setzt einen anderen Ordner.
 */

const OUTPUT = process.env["REVIEW_DIR"] ?? resolve(import.meta.dirname, "../../../review/kanal-leiste");
const BETREIBER = [...ADMIN_CAPABILITIES, "manage_system_settings", "use_operator_channel"];
const FENSTER = '[data-testid="systemsteuerung-fenster"]';

test.use({ actionTimeout: 30_000 });

async function leiste(page: Page, reiter: string, ops: string, datei: string): Promise<void> {
    await page.getByTestId(`kanal-reiter-${reiter}`).click();
    await page.getByTestId(`kanal-zeile-${ops}`).click();
    const ziel = page.getByTestId("kanal-nachweise");
    await ziel.waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(400);
    await ziel.screenshot({ path: resolve(OUTPUT, datei) });
    await page
        .getByTestId("kanal-zurueck")
        .click()
        .catch(() => undefined);
}

test("Nahaufnahme: die Fortschrittsleiste je Weg", async ({ browser }, testInfo) => {
    test.setTimeout(600_000);
    mkdirSync(OUTPUT, { recursive: true });
    const baseURL = String(testInfo.project.use.baseURL);

    for (const schema of ["light", "dark"] as const) {
        const context = await browser.newContext({
            baseURL,
            colorScheme: schema,
            viewport: { width: 1600, height: 900 },
        });
        const page = await context.newPage();
        await stubAdmin(page, { capabilities: BETREIBER, role: "operator" });
        await stubKanal(page, kanalServer(kanalVorgaenge()));
        await page.goto("/edit");
        await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 60_000 });
        await page.getByTestId("kopfleiste-menue").click();
        await page.getByTestId("menue-systemsteuerung").click();
        await page.locator(FENSTER).waitFor();
        await page.getByTestId("verwaltung-eintrag-claudio").click();
        await page.getByTestId("kanal-zeile-OPS-000134").waitFor();

        await leiste(page, "offen", "OPS-000134", `ohne-fix-${schema}.png`);
        await leiste(page, "abnahme", "OPS-000127", `mit-fix-${schema}.png`);
        // 3. Der Fall vom 2026-10-16 (OPS-000002 auf der Stage): Fix committed und abgenommen, die zwei dazwischen
        //    entfallen. Vorher standen sie im Warteton und die Leiste sah aus wie zwei Laeufe nebeneinander.
        await leiste(page, "archiv", "OPS-000098", `entfallen-${schema}.png`);
        await context.close();
    }
});
