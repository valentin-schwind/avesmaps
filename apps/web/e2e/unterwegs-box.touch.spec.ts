import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { expectLidRule, lidLines } from "./disclosure-lines.ts";

/**
 * „Vorkommen unterwegs“ am Telefon (WI-0257 S4, S5): Die Klappbox lässt sich antippen, die Liste bricht um statt abzuschneiden, ein Tipp auf den Kreis eines Eintrags wählt ihn (färbt die Etappen, lässt ihn
 * leuchten, öffnet seine Infobox eingeklappt mit der Pille - Planer und Panel schließen einander aus), und es gibt nirgends waagerechtes Scrollen. Dazu die Telefonbilder für die Sichtprüfung (`review/wi-0257-s4/`, nicht im Repository): Nur das Telefonprofil (`*.touch.spec.ts`) bildet ein Telefon ab.
 */

const ORDNER = join(import.meta.dirname, "..", "..", "..", "review", "wi-0257-s4");
const REISE = "/?route=@452.84,590.76~@492.50,564.96";

/** Öffnet den Planer (am Telefon ein Tippen) und wartet, bis die Box „Unterwegs“ da ist. */
async function openRoute(page: Page): Promise<void> {
    await page.goto(REISE);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 60_000 });
    const tab = page.getByTestId("route-planner-tab");
    if ((await tab.getAttribute("aria-expanded")) !== "true") await tab.tap();
    await expect(tab).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("route-unterwegs")).toBeVisible({ timeout: 60_000 });
}

/**
 * Wie weit die Box nach rechts über ihre Kante oder über den Bildschirm hinausragt (Bildpunkte, gerundet); 0 oder weniger heißt: Nichts schneidet ab, nichts schiebt die Seite breiter. Gemessen werden die Kinder der
 * Box gegen ihre Kante und die Kante gegen die Breite des Fensters; die Vorfahren zu lesen (`scrollWidth`) träfe die Schublade des Planers, die am Telefon neben dem Bild steht.
 */
async function ueberstand(page: Page): Promise<number> {
    return page.evaluate(() => {
        const ziel = document.querySelector<HTMLElement>('[data-testid="route-unterwegs"]');
        if (!ziel) return Number.NaN;
        const rand = ziel.getBoundingClientRect().right;
        let mehr = Math.round(rand - globalThis.innerWidth);
        for (const kind of ziel.querySelectorAll<HTMLElement>("*")) {
            if (kind.getClientRects().length === 0) continue;
            // Die Reiter rollen in ihrer Leiste, wo sie nicht passen (Guide §9, mit ‹ ›): Was dort hinter dem Rand liegt, ist erreichbar, nicht abgeschnitten.
            if (kind.closest(".fenster-reiter__rolle") !== null) continue;
            // Der Deckel kürzt am Ende mit „…“ (Betreiber 2026-10-30, `.einzeilig`): Was dahinter liegt, ist gekürzt, nicht übergelaufen.
            if (kind.closest(".einzeilig") !== null) continue;
            mehr = Math.max(mehr, Math.round(kind.getBoundingClientRect().right - rand));
        }
        return mehr;
    });
}

/** Die Zahl der Zeilen des Deckels und ob etwas übersteht, wie die Deckel der Routendetails sie messen (`disclosure-lines.ts`). */
async function deckelMass(page: Page): Promise<Awaited<ReturnType<typeof lidLines>>[number]> {
    const [lid] = await lidLines(page.getByTestId("unterwegs-toggle"));
    if (lid === undefined) throw new Error("kein Deckel");
    return lid;
}

for (const width of [412, 360, 320]) {
    test(`🔴 bei ${String(width)} px: der Deckel ${width >= 360 ? "bleibt einzeilig" : "kürzt am Ende mit „…“"}, die Liste schneidet nichts ab, ein Tipp wählt den Eintrag`, async ({
        page,
    }) => {
        await page.setViewportSize({ width, height: 900 });
        await openRoute(page);
        const deckel = page.getByTestId("unterwegs-toggle");
        await deckel.scrollIntoViewIfNeeded();
        // Zeichen statt Wörter (Betreiber 2026-10-29): je Art das Kategoriezeichen mit der Zahl; die Wörter der Infobox stehen im title und als Name des Bildes.
        await expect(deckel).toHaveText(/^Vorkommen unterwegs:\s*\d+\s*\d+\s*\d+\s*\d+$/u);
        await expect(page.getByTestId("unterwegs-zahlen")).toHaveAttribute(
            "aria-label",
            /^\d+ Handelswaren?, \d+ Tierarten?, \d+ Pflanzenarten?, \d+ Spezies$/u,
        );
        // Einzeilig bei 412 und 360 px; erst bei 320 px gilt Regel „A“ (die Kurzangabe als Ganzes in Zeile 2). Nichts wird abgeschnitten.
        const lid = await deckelMass(page);
        if (width >= 360) expect(lid.lines, lid.text).toBe(1);
        expectLidRule([lid], `${String(width)} px`);
        await deckel.tap();
        await expect(page.getByTestId("unterwegs-eintrag").first()).toBeVisible();
        expect(await ueberstand(page)).toBeLessThanOrEqual(1);
        // Die kleine Reiterleiste rollt nicht: Ab 360 px passen alle Reiter (Vali 2026-10-30, gemessen an der Probierseite bei 310 und 294 px Leiste); schmaler rollt sie wie jede.
        if (width >= 360)
            expect(
                await page
                    .getByTestId("route-unterwegs")
                    .locator(".fenster-reiter__rolle")
                    .evaluate((el) => el.scrollWidth > el.clientWidth + 1),
            ).toBe(false);
        // Der Name bricht um, statt abzuschneiden: Keine Zeile der Liste ist breiter als ihr Rahmen.
        const zeilen = page.getByTestId("unterwegs-eintrag");
        const kreis = zeilen.first().getByTestId("unterwegs-kreis");
        await kreis.scrollIntoViewIfNeeded();
        await kreis.tap();
        await expect(kreis).toHaveAttribute("aria-pressed", "true");
        await expect(page.getByTestId("unterwegs-wahl")).toHaveCount(1);
        // Die Infobox des gewählten geht auf wie jede (eingeklappt, mit der Pille), und der Planer fährt dafür zu.
        await expect(page.getByTestId("eintrag-pille")).toBeVisible();
        await expect
            .poll(async () => page.locator("[data-testid=route-stage].stage--treffer, .group--treffer").count())
            .toBeGreaterThan(0);
        // Ein zweiter Tipp beendet die Wahl.
        const tab = page.getByTestId("route-planner-tab");
        await tab.tap();
        await expect(tab).toHaveAttribute("aria-expanded", "true");
        await kreis.scrollIntoViewIfNeeded();
        expect(await ueberstand(page)).toBeLessThanOrEqual(1);
        await kreis.tap();
        await expect(kreis).toHaveAttribute("aria-pressed", "false");
        await expect(page.locator(".stage--treffer")).toHaveCount(0);
    });
}

test("Bilder am Telefon: zu, auf, mit gewähltem Eintrag, Etappen gefärbt", async ({ page }) => {
    test.setTimeout(180_000);
    mkdirSync(ORDNER, { recursive: true });
    await page.setViewportSize({ width: 412, height: 915 });
    await openRoute(page);
    await page.waitForTimeout(1000);
    const box = page.getByTestId("route-unterwegs");
    await box.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(ORDNER, "unterwegs-zu-tel.png") });
    await page.getByTestId("unterwegs-toggle").tap();
    await expect(page.getByTestId("unterwegs-eintrag").first()).toBeVisible();
    await page.waitForTimeout(400);
    await box.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(ORDNER, "unterwegs-auf-tel.png") });
    await page.getByTestId("unterwegs-kreis").nth(2).tap();
    await expect(page.getByTestId("unterwegs-wahl")).toHaveCount(1);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(ORDNER, "unterwegs-wahl-tel.png") });
    const tab = page.getByTestId("route-planner-tab");
    if ((await tab.getAttribute("aria-expanded")) !== "true") await tab.tap();
    await page.getByTestId("route-stages").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(ORDNER, "unterwegs-etappen-tel.png") });
});
