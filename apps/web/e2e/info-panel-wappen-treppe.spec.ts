import { expect, test, type Locator, type Page } from "@playwright/test";
import { openMap } from "./map-handle.ts";

/**
 * Die Wappen in der Treppe „Liegt in“ (WI-0094) am echten Stack. Betreiber 2026-10-06: „in legacy sind die wappen als kleine thumbs
 * immer vor den territorien oder siedlungen, die ein wappen haben, kannst du das auch so machen?“
 *
 * 🔴 Dieser Fall SIEHT das Bild, er glaubt dem Modell nicht: Er prüft die geladenen Bytes (`naturalWidth`), die gemessene Kantenlänge
 * im Browser und dass das Bild IM Link vor dem Namen steht. Was das Modell daraus macht, prüft `test/panel-text.test.ts`; dass der
 * Server das Wappen in EINER Abfrage anhängt, `apps/server/test/media-resolver.test.ts` und `apps/server/test/subjects.test.ts`.
 *
 * Legacys Maße (Discovery-Mirror `6fafd5c2f`, `css/features/infopanel.css` L695–703, `.location-popup__breadcrumb-coat`):
 * `width`/`height: 15px`, `margin-right: 4px`, `vertical-align: -3px`, `object-fit: contain`, `border-radius: var(--radius-sm)`.
 *
 * 🪤 Die Fälle hängen am Satz der Entwicklungsdatenbank: Waldfang liegt in vier Gebieten, die ALLE ein Wappen tragen (es ist die
 * Treppe aus dem Bildschirmfoto des Betreibers); Gareths Kette endet in „Alt-Gareth“, das KEINES hat. Zieht ein Import ein Wappen
 * nach oder weg, ist dieser Fall nachzuziehen - nicht die Regel.
 */

/** Waldfang: Reich → Garetien → Grafschaft Reichsforst → Baronie Waldfang, alle vier mit Wappen. */
const WALDFANG = "be3fd56f-61f6-516c-b7f0-f84098f788a8";
/** Gareth: die ersten drei Stufen tragen ein Wappen, „Alt-Gareth“ nicht. */
const GARETH_ORT = "80558060-4299-54aa-b520-814b10819885";

/** Legacys Kantenlänge und Luft zum Namen. */
const EDGE = 15;
const GAP = 4;

async function openPlace(page: Page, id: string, title: string): Promise<void> {
    await openMap(page);
    await page.evaluate((target) => globalThis.avesmapsOpenSubject?.(target), { kind: "place", id });
    await expect(page.getByTestId("info-title")).toHaveText(title, { timeout: 20_000 });
    await expect(page.getByTestId("info-stairs")).toBeVisible({ timeout: 20_000 });
}

const rows = (page: Page): Locator => page.getByTestId("info-stairs-row");

test.describe("Wappen in der Treppe „Liegt in“", () => {
    test("🔴 das Wappen ist wirklich da: geladene Bytes, 15 px Kante, im Link VOR dem Namen", async ({ page }) => {
        await openPlace(page, WALDFANG, "Waldfang");
        const stairs = rows(page);
        await expect(stairs).toHaveCount(4);

        const coats = page.getByTestId("info-stairs-coat");
        await expect(coats).toHaveCount(4);

        for (let index = 0; index < 4; index += 1) {
            const coat = coats.nth(index);
            await expect(coat).toBeVisible();
            // Die Bytes sind angekommen und entschlüsselt - ein kaputter Pfad hätte `naturalWidth` 0.
            const natural = await coat.evaluate((node) => (node as HTMLImageElement).naturalWidth);
            expect(natural, `Wappen ${String(index)} hat keine Bytes`).toBeGreaterThan(0);

            const box = await coat.boundingBox();
            expect(box?.width).toBeCloseTo(EDGE, 0);
            expect(box?.height).toBeCloseTo(EDGE, 0);

            // Es steht IM goldenen Link (wie Legacy), nicht daneben.
            await expect(coat.locator("xpath=ancestor::*[@data-testid='info-link']")).toHaveCount(1);
        }

        // Vor dem Namen, mit Legacys Luft: die linke Kante des Textes beginnt eine Kante plus Abstand weiter rechts.
        const first = stairs.first();
        const coatBox = await first.getByTestId("info-stairs-coat").boundingBox();
        const linkBox = await first.getByTestId("info-link").boundingBox();
        expect(coatBox && linkBox && coatBox.x).toBeCloseTo(linkBox?.x ?? -1, 0);
        const gap = await first
            .getByTestId("info-stairs-coat")
            .evaluate((node) => Number.parseFloat(getComputedStyle(node).marginRight));
        expect(gap).toBeCloseTo(GAP, 1);
    });

    test("🔴 ohne Wappen kein Platzhalter: die Zeile rückt auf, wie in Legacy", async ({ page }) => {
        await openPlace(page, GARETH_ORT, "Gareth");
        const stairs = rows(page);
        await expect(stairs).toHaveCount(4);
        // Drei Stufen tragen ein Wappen, die vierte („Alt-Gareth“) nicht - und bekommt KEIN leeres Kästchen.
        await expect(page.getByTestId("info-stairs-coat")).toHaveCount(3);
        await expect(stairs.nth(3)).toHaveText(/Alt-Gareth/);
        await expect(stairs.nth(3).getByTestId("info-stairs-coat")).toHaveCount(0);

        // Der Name beginnt an der linken Kante seines Links, nicht um eine Wappenbreite eingerückt.
        const link = stairs.nth(3).getByTestId("info-link");
        const indent = await stairs.nth(3).evaluate((node) => Number.parseFloat(getComputedStyle(node).paddingLeft));
        const rowBox = await stairs.nth(3).boundingBox();
        const linkBox = await link.boundingBox();
        expect((linkBox?.x ?? 0) - (rowBox?.x ?? 0)).toBeCloseTo(indent, 0);
    });

    test("der Einrückungswinkel bleibt VOR dem Wappen stehen", async ({ page }) => {
        await openPlace(page, WALDFANG, "Waldfang");
        const second = rows(page).nth(1);
        // Der Winkel ist das `::before` der Zeile; er hängt am Einzug, nicht am Textanfang.
        const elbowLeft = await second.evaluate((node) => Number.parseFloat(getComputedStyle(node, "::before").left));
        const rowBox = await second.boundingBox();
        const coatBox = await second.getByTestId("info-stairs-coat").boundingBox();
        expect((rowBox?.x ?? 0) + elbowLeft).toBeLessThan(coatBox?.x ?? 0);
    });
});
