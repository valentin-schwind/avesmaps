import { expect, test, type Page } from "@playwright/test";
import { openMap } from "./map-handle.ts";

/**
 * Die Suchkachel am Finger (WI-0026), im Telefonprofil - Legacys Verhalten
 * (`css/components/spotlight-search.css`, `js/ui/spotlight-search.js`): das Fenster sitzt unten auf
 * der Höhe der Lupe, das Feld wächst aus ihr nach links und deckt sie zu, die Lupe bleibt an ihrem Platz.
 */

interface Aufgezeichnet {
    klasse: string;
    keyframes: { clipPath?: string }[];
    duration: number;
}

/** Zeichnet jede Web-Animation auf, bevor die Seite lädt - so hängt der Test nicht an 220 ms. */
async function recordAnimations(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const liste: unknown[] = [];
        Object.assign(globalThis, { aufgezeichneteBewegungen: liste });
        const original = Element.prototype.animate;
        Element.prototype.animate = function (this: Element, keyframes, options) {
            liste.push({
                klasse: this.className,
                keyframes,
                duration: typeof options === "number" ? options : options?.duration,
            });
            return original.call(this, keyframes, options);
        };
    });
}

async function recorded(page: Page): Promise<Aufgezeichnet[]> {
    return page.evaluate(
        () => (globalThis as unknown as { aufgezeichneteBewegungen: Aufgezeichnet[] }).aufgezeichneteBewegungen,
    );
}

async function openSearch(page: Page): Promise<void> {
    await openMap(page);
    await page.getByTestId("search-open").tap();
    await expect(page.getByRole("dialog", { name: "Suche" })).toBeVisible();
}

test("🔴 am Finger sitzt das Fenster unten auf der Höhe der Lupe, das Feld unter den Treffern", async ({ page }) => {
    await openSearch(page);
    await page.getByTestId("search-input").fill("Gareth");
    await expect(page.getByTestId("search-hit").first()).toBeVisible();

    const lage = await page.evaluate(() => {
        const rechteck = (selektor: string) => document.querySelector(selektor)!.getBoundingClientRect();
        const kachel = rechteck('[data-testid="search-open"]');
        const fenster = rechteck(".spotlight__card");
        return {
            kachel: { right: kachel.right, bottom: kachel.bottom },
            fenster: { right: fenster.right, bottom: fenster.bottom },
            treffer: rechteck(".spotlight__results").bottom,
            feld: rechteck('[data-testid="search-input"]').top,
        };
    });
    expect(lage.fenster.bottom, "Unterkante wie die Lupe").toBeCloseTo(lage.kachel.bottom, 0);
    expect(lage.fenster.right, "rechte Kante wie die Lupe").toBeCloseTo(lage.kachel.right, 0);
    expect(lage.treffer, "die Treffer wachsen über dem Feld nach oben").toBeLessThanOrEqual(lage.feld + 1);
});

test("🔴 das Feld wächst über die Lupe, die Lupe bleibt an ihrem Platz - wie im laufenden Legacy", async ({ page }) => {
    await openMap(page);
    const lupe = page.getByTestId("search-open");
    const vorher = await lupe.boundingBox();
    await lupe.tap();
    await expect(page.getByTestId("search")).toBeVisible();

    const lage = await page.evaluate(() => {
        const box = document.querySelector('[data-testid="search-open"]')!.getBoundingClientRect();
        const oben = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return { box: { x: box.x, y: box.y }, feldObenauf: oben?.closest(".spotlight__card") !== null };
    });
    expect(lage.feldObenauf, "das Feld liegt über der Lupe (Legacy: elementFromPoint trifft das Suchfeld)").toBe(true);
    expect(lage.box.x, "die Lupe rührt sich nicht").toBeCloseTo(vorher!.x, 0);
    expect(lage.box.y).toBeCloseTo(vorher!.y, 0);

    await page.getByTestId("search-input").press("Escape");
    await expect(page.getByTestId("search")).toBeHidden();
    await expect(lupe).toBeVisible();
});

test("🔴 das Feld klappt aus der Lupe nach links auf - ein Reveal in 220 ms, keine Skalierung", async ({ page }) => {
    await recordAnimations(page);
    await openSearch(page);
    const breiten = await page.evaluate(() => ({
        fenster: document.querySelector(".spotlight__card")!.getBoundingClientRect().width,
        kachel: document.querySelector('[data-testid="search-open"]')!.getBoundingClientRect().width,
    }));

    const reveal = (await recorded(page)).find((bewegung) => bewegung.klasse.includes("spotlight__card"));
    expect(reveal, "das Fenster bewegt sich").toBeDefined();
    expect(reveal!.duration).toBe(220);
    const erstes = reveal!.keyframes[0]!.clipPath ?? "";
    const offen = Number(/inset\(0 0 0 ([\d.]+)px/.exec(erstes)?.[1]);
    expect(offen, "im ersten Bild steht nur die Lupe offen").toBeCloseTo(breiten.fenster - breiten.kachel, 0);
    expect(reveal!.keyframes.at(-1)!.clipPath).toMatch(/^inset\(0 0 0 0 /);
});

test("bei „Bewegung reduzieren“ steht das Fenster sofort da", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await recordAnimations(page);
    await openSearch(page);
    expect((await recorded(page)).filter((bewegung) => bewegung.klasse.includes("spotlight__card"))).toEqual([]);
});
