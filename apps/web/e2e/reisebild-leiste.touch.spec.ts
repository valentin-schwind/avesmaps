import { expect, test } from "@playwright/test";
import { stubReisebilder, stubReisebilderKarte, type KartenBild } from "./reisebild-stub.ts";
import { GARETH, openMap, selectedPlace, showPlace } from "./map-handle.ts";

/**
 * Die Leiste der Reisebilder am Telefon (WI-0272 S4, Aufgabe 28): 92 px hoch, die Kacheln laufen waagerecht, ein offenes Panel verdeckt die Leiste und setzt die Höhe auf 0 (die Vollbildpanels bleiben
 * unverändert). Der Lesepfad ist eine Attrappe (`reisebild-stub.ts`). Der Rechner steht in `reisebild-leiste.spec.ts`.
 *
 * Problemfälle: die Leiste ist höher als 92 px oder deckt Eckbund und Maßstab nicht frei; sie lässt sich nicht waagerecht wischen (die Seite scrollt mit); sie bleibt neben einem offenen Infopanel stehen und
 * lässt dessen Unterkante hochrutschen (`--avm-reisebilder-leiste` bleibt auf der Höhe).
 */

const ID = (n: number): string => `00000000-0000-4000-8000-0000000002${String(n).padStart(2, "0")}`;
const bilder: KartenBild[] = Array.from({ length: 14 }, (_, n) => ({
    id: ID(n),
    lage: { x: GARETH.x + 40 + (n % 7) * 0.4, y: GARETH.y + 25 + Math.floor(n / 7) * 0.4 },
}));

test("🔴 Telefon: 92 px hoch, waagerecht zu wischen; ein offenes Infopanel verdeckt sie und setzt die Höhe auf 0", async ({
    page,
}) => {
    await stubReisebilder(page);
    await stubReisebilderKarte(page, bilder);
    await openMap(page);
    await showPlace(page, { x: GARETH.x + 40, y: GARETH.y + 25 }, 9);
    await expect(page.getByTestId("reisebilder-knopf")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("reisebilder-knopf").click();
    const leiste = page.getByTestId("reisebilder-leiste");
    await expect(leiste).toBeVisible();
    await page.waitForTimeout(450);
    const box = await leiste.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs(box!.height - 92)).toBeLessThanOrEqual(1);
    const viewport = page.viewportSize()!;
    expect(Math.abs(box!.width - viewport.width)).toBeLessThanOrEqual(1);

    // Die Kacheln laufen waagerecht: Die Reihe fängt das Wischen (pan-x, kein Weiterreichen) und scrollt.
    const reihe = leiste.locator(".reisebilder-leiste__reihe");
    const stil = await reihe.evaluate((el) => {
        const s = getComputedStyle(el);
        return {
            aktion: s.touchAction,
            overscroll: s.overscrollBehaviorX,
            x: s.overflowX,
            breit: el.scrollWidth > el.clientWidth,
        };
    });
    expect(stil.aktion).toBe("pan-x");
    expect(stil.overscroll).toBe("contain");
    expect(stil.x).toBe("auto");
    expect(stil.breit).toBe(true);
    await reihe.evaluate((el) => {
        el.scrollLeft = 120;
    });
    expect(await reihe.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);

    // Keine Linie von der Kachel zum Symbol am Telefon (es gibt keinen Zeiger): auch nicht, wenn eine Kachel hervorgehoben ist.
    await page.evaluate((id) => {
        (
            globalThis as unknown as { avesmapsReisebilder: { setzeHervor: (id: string, quelle: string) => void } }
        ).avesmapsReisebilder.setzeHervor(id, "kachel");
    }, ID(0));
    await page.waitForTimeout(300);
    await expect(page.getByTestId("reisebilder-linie")).toHaveCount(0);

    // Der Eckbund steht über der Leiste.
    const bund = await page.locator(".corner").first().boundingBox();
    if (bund !== null) expect(bund.y + bund.height).toBeLessThanOrEqual(box!.y + 1);

    // Ein Infopanel (Vollbild am Telefon) verdeckt die Leiste: unsichtbar, Höhe 0.
    await showPlace(page, GARETH, 5);
    const ort = await page.evaluate((p) => {
        const map = globalThis.avesmapsMap!;
        const am = map.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(p));
        const rahmen = map.getCanvas().getBoundingClientRect();
        return { x: rahmen.left + am.x, y: rahmen.top + am.y };
    }, GARETH);
    await page.touchscreen.tap(ort.x, Math.min(ort.y, box!.y - 20));
    await expect.poll(async () => (await selectedPlace(page))?.name, { timeout: 15_000 }).toBe("Gareth");
    await expect(page.getByTestId("info-panel")).toBeVisible();
    await expect(leiste).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--avm-reisebilder-leiste"))).toBe(
        "0px",
    );
});
