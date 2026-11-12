import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { kanalServer, kanalVorgaenge, stubKanal } from "./kanal-stub.ts";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Die Liste des Kanals: Fortschritt je Zeile und die Sortierung nach Datum (WI-0162).
 *
 * 💣 Betreiber 2026-10-15, mit einem Pfeil auf die vier leeren Kreise: „kann man da den fortschritt anzeigen - war das nicht
 * dafür gedacht? schön wärs auch mann die liste nach datum sortieren könnte“. Im Vorgang war die Leiste längst repariert, die
 * Liste füllte ihre vier Punkte weiter mit der Zahl der Nachweise.
 *
 * Dieser Lauf **prüft** beides und legt das Blatt ab:
 *   1. OPS-000134 (in Arbeit, ohne Fix) zeigt Fortschritt aus dem Status statt vier leeren Kreisen.
 *   2. OPS-000127 (zur Abnahme, drei Nachweise) zeigt weiter die Nachweise.
 *   3. „Älteste zuerst“ dreht die Reihenfolge der Liste um.
 *
 *   npm run review:kanal-liste
 *
 * Ablage: `review/wi-0162/` (nicht versioniert); `REVIEW_DIR` setzt einen anderen Ordner.
 */

const OUTPUT = process.env["REVIEW_DIR"] ?? resolve(import.meta.dirname, "../../../review/wi-0162");
const BETREIBER = [...ADMIN_CAPABILITIES, "manage_system_settings", "use_operator_channel"];
const FENSTER = '[data-testid="systemsteuerung-fenster"]';

test.use({ actionTimeout: 30_000 });

test("Liste: Fortschritt je Zeile und Sortierung nach Datum", async ({ page }) => {
    test.setTimeout(600_000);
    mkdirSync(OUTPUT, { recursive: true });
    await page.setViewportSize({ width: 1600, height: 900 });
    await stubAdmin(page, { capabilities: BETREIBER, role: "operator" });
    await stubKanal(page, kanalServer(kanalVorgaenge()));
    await page.goto("/edit");
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 60_000 });
    await page.getByTestId("kopfleiste-menue").click();
    await page.getByTestId("menue-systemsteuerung").click();
    await page.locator(FENSTER).waitFor();
    await page.getByTestId("verwaltung-eintrag-claudio").click();
    await page.getByTestId("kanal-zeile-OPS-000134").waitFor();

    // 1. Ohne Fix zählt der Status: „in Arbeit“ ist Schritt 2 von 4, also zwei volle Punkte.
    const punkte = async (ops: string): Promise<{ alle: number; voll: number }> => {
        const zeile = page.getByTestId(`kanal-zeile-${ops}`);
        return {
            alle: await zeile.locator(".punkt").count(),
            voll: await zeile.locator(".punkt--voll").count(),
        };
    };
    expect(await punkte("OPS-000134")).toEqual({ alle: 4, voll: 2 });

    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(400);
    await page.locator(FENSTER).screenshot({ path: resolve(OUTPUT, "liste-offen.png") });

    // 2. Mit Nachweisen bleibt es bei den Nachweisen (drei von vier).
    await page.getByTestId("kanal-reiter-abnahme").click();
    await page.getByTestId("kanal-zeile-OPS-000127").waitFor();
    expect(await punkte("OPS-000127")).toEqual({ alle: 4, voll: 3 });

    // 3. Die Sortierung nach Datum: „Älteste zuerst“ dreht die Reihenfolge um.
    await page.getByTestId("kanal-reiter-offen").click();
    await page.getByTestId("kanal-zeile-OPS-000134").waitFor();
    const reihenfolge = async (): Promise<string[]> =>
        (await page.locator('[data-testid^="kanal-zeile-"]').all()).reduce<Promise<string[]>>(
            async (sammlung, zeile) => [
                ...(await sammlung),
                (await zeile.getAttribute("data-testid"))?.replace("kanal-zeile-", "") ?? "",
            ],
            Promise.resolve([]),
        );
    const vorher = await reihenfolge();
    await page.getByTestId("kanal-sortierung").click();
    await page.getByRole("menuitemradio", { name: "Älteste zuerst" }).click();
    await page.waitForTimeout(300);
    expect(await reihenfolge()).toEqual([...vorher].reverse());

    // Das Blatt mit offenem Menü, damit die Wahl sichtbar ist.
    await page.getByTestId("kanal-sortierung").click();
    await page.waitForTimeout(400);
    await page.locator(FENSTER).screenshot({ path: resolve(OUTPUT, "sortierung.png") });
});
