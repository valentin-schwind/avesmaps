import { expect, test } from "@playwright/test";
import {
    FASAR,
    GARETH,
    bedieneBilder,
    huelle,
    kasten,
    kopfbild,
    oeffne,
    sitztUntenRechts,
    stelleKopf,
    transformDesBildes,
    ueberdecken,
} from "./bildbezug-quelle.ts";
import { openMap } from "./map-handle.ts";

/**
 * Der Bildbezug am Telefon (Betreiber 2026-10-11; Arbeitsanweisung `project-control/work-items/bildbezug-ortsansicht-typbild-2026-10-11.md`
 * §1, §5, §6): unten rechts, weil oben rechts das ✕ des Panels sitzt; bei Fasar mit zehn Seitenmarken neben den Marken und unter dem
 * Pfeil; kein Zeigen voraussetzen, ein Tipp öffnet nur eine Ortsansicht. Gestellt ist nur die Liste der Kopfbilder
 * (`bildbezug-quelle.ts`).
 */

test("🔴 Fasar mit zehn Ortsansichten: unten rechts, frei vom ✕, den Pfeilen und den zehn Marken; ein Tipp öffnet groß", async ({
    page,
}) => {
    await bedieneBilder(page);
    await stelleKopf(
        page,
        FASAR,
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => kopfbild(n, "place_view")),
    );
    await openMap(page);
    await oeffne(page, { kind: "place", id: FASAR }, "Fasar");
    const plakette = page.getByTestId("info-header-bildbezug");
    await expect(plakette).toHaveText("Ortsansichten");
    const { plakette: box, medien } = await sitztUntenRechts(page);
    const marken = await page.getByTestId("info-header-mark").all();
    expect(marken).toHaveLength(10);
    const hindernisse = [
        await kasten(page.getByTestId("info-panel-close")),
        await kasten(page.getByTestId("info-header-prev")),
        await kasten(page.getByTestId("info-header-next")),
        huelle(await Promise.all(marken.map((mark) => kasten(mark)))),
    ];
    for (const hindernis of hindernisse) expect(ueberdecken(box, hindernis)).toBe(false);

    // Ein Tipp auf die Fläche öffnet die Bildansicht; das ✕ der Ansicht schließt sie.
    await page.touchscreen.tap(medien.x + medien.width / 2, medien.y + medien.height / 3);
    const ansicht = page.getByTestId("info-bildansicht");
    await expect(ansicht).toBeVisible();
    await expect(ansicht.getByTestId("bildansicht-stand")).toHaveText("1 von 10");
    await ansicht.getByTestId("bildansicht-schliessen").tap();
    await expect(ansicht).toBeHidden();
    // Am Finger kein Zoom: es gibt kein Zeigen, also auch keinen Zustand, der hängen bliebe.
    expect(await page.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches)).toBe(false);
    expect(await transformDesBildes(page)).toBe("none");
});

test("🔴 ein Typbild am Telefon: ein Tipp öffnet nichts, und das Bild bleibt, wie es ist", async ({ page }) => {
    await bedieneBilder(page);
    await stelleKopf(page, GARETH, [kopfbild(5, "type_image")]);
    await openMap(page);
    await oeffne(page, { kind: "place", id: GARETH }, "Gareth");
    await expect(page.getByTestId("info-header-bildbezug")).toHaveText("Typbild");
    const { medien, plakette } = await sitztUntenRechts(page);
    expect(ueberdecken(plakette, await kasten(page.getByTestId("info-panel-close")))).toBe(false);
    await page.touchscreen.tap(medien.x + medien.width / 2, medien.y + medien.height / 3);
    await page.waitForTimeout(300);
    await expect(page.getByTestId("info-bildansicht")).toBeHidden();
    expect(await transformDesBildes(page)).toBe("none");
    expect(await page.getByTestId("info-header-image").evaluate((node) => getComputedStyle(node).opacity)).toBe("1");
});
