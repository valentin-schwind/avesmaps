import { expect, test } from "@playwright/test";
import {
    GARETH,
    REICHSSTRASSE,
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
 * Der Bildbezug auf dem Kopfbild am Rechner (Betreiber 2026-10-11, wörtlich „1A … 2 B … 3 A ja das gilt für alle“; Arbeitsanweisung
 * `project-control/work-items/bildbezug-ortsansicht-typbild-2026-10-11.md`, Mockup `project-control/mockups/bildbezug-2026-10-11.html`).
 * Das Telefon prüft `info-panel-bildbezug.touch.spec.ts`, die Regeln ohne Browser `test/bildbezug.test.ts`.
 *
 * Gestellt ist nur die Liste der Kopfbilder samt ihrem Bildbezug (`bildbezug-quelle.ts`); was der Server wann liefert, prüft
 * `apps/server/test/bildbezug.test.ts`.
 */

const plakette = (page: import("@playwright/test").Page) => page.getByTestId("info-header-bildbezug");
const ansicht = (page: import("@playwright/test").Page) => page.getByTestId("info-bildansicht");

test.describe("🔴 Ortsansichten: Gareth mit sieben eigenen Bildern", () => {
    test.beforeEach(async ({ page }) => {
        await bedieneBilder(page);
        await stelleKopf(
            page,
            GARETH,
            [1, 2, 3, 4, 5, 6, 7].map((n) => kopfbild(n, "place_view")),
        );
        await openMap(page);
        await oeffne(page, { kind: "place", id: GARETH }, "Gareth");
    });

    test("„Ortsansichten“ mit Bildsymbol unten rechts im Bild, frei von Pfeilen und Seitenmarken", async ({ page }) => {
        await expect(plakette(page)).toHaveText("Ortsansichten");
        await expect(plakette(page)).toHaveAttribute("data-bezug", "ortsansicht");
        await expect(page.getByTestId("info-header-bildbezug-zeichen")).toBeVisible();
        const { plakette: box } = await sitztUntenRechts(page);
        const pfeile = [
            await kasten(page.getByTestId("info-header-prev")),
            await kasten(page.getByTestId("info-header-next")),
        ];
        const marken = huelle(
            await Promise.all((await page.getByTestId("info-header-mark").all()).map((mark) => kasten(mark))),
        );
        for (const pfeil of pfeile) expect(ueberdecken(box, pfeil)).toBe(false);
        expect(ueberdecken(box, marken)).toBe(false);
        // Die Plakette hat einen eigenen Grund (Guide §16.1) und Rand; die Schrift ist voll deckend.
        const look = await plakette(page).evaluate((node) => {
            const style = getComputedStyle(node);
            return { background: style.backgroundColor, border: style.borderTopWidth, colour: style.color };
        });
        expect(look.background).not.toBe("rgba(0, 0, 0, 0)");
        expect(look.border).toBe("1px");
        expect(look.colour).toBe("rgb(255, 255, 255)");
    });

    test("ein Klick auf die Fläche öffnet die Bildansicht, ein Pfeil blättert nur; Tasten und Esc wie gehabt", async ({
        page,
    }) => {
        // Der Pfeil wechselt nur das Bild.
        await page.getByTestId("info-header-next").click();
        await expect(ansicht(page)).toBeHidden();
        await expect(page.getByTestId("info-header-mark").nth(1)).toHaveClass(/is-on/);
        await expect(plakette(page)).toHaveText("Ortsansichten");
        // Die Fläche öffnet groß, beim gezeigten Bild.
        const medien = await kasten(page.getByTestId("info-media"));
        await page.mouse.click(medien.x + medien.width / 2, medien.y + medien.height / 3);
        await expect(ansicht(page)).toBeVisible();
        await expect(ansicht(page).getByTestId("bildansicht-stand")).toHaveText("2 von 7");
        await page.keyboard.press("ArrowRight");
        await expect(ansicht(page).getByTestId("bildansicht-stand")).toHaveText("3 von 7");
        await page.keyboard.press("Escape");
        await expect(ansicht(page)).toBeHidden();
        // Der Kopf steht danach beim dritten Bild, das Panel bleibt offen.
        await expect(page.getByTestId("info-header-mark").nth(2)).toHaveClass(/is-on/);
        await expect(page.getByTestId("info-title")).toHaveText("Gareth");
    });

    test("🔴 leiser Zoom im Ausschnitt beim Zeigen, die Außenmaße bleiben; mit reduzierter Bewegung keiner", async ({
        page,
    }) => {
        const vorher = await kasten(page.getByTestId("info-media"));
        expect(await transformDesBildes(page)).toBe("none");
        await page.mouse.move(vorher.x + vorher.width / 2, vorher.y + vorher.height / 3);
        await expect.poll(() => transformDesBildes(page)).toBe("matrix(1.025, 0, 0, 1.025, 0, 0)");
        expect(await kasten(page.getByTestId("info-media"))).toEqual(vorher);
        // Ein Übergang, nie ein Sprung: 150 ms, die Zeit des Hauses nahe den „ca. 180 ms“ des Betreibers (Guide §30.4).
        const uebergang = await page
            .getByTestId("info-header-image")
            .evaluate((node) => getComputedStyle(node).transitionDuration);
        expect(uebergang).toBe("0.15s");
        await page.mouse.move(0, 0);
        await expect.poll(() => transformDesBildes(page)).toBe("none");

        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.mouse.move(vorher.x + vorher.width / 2, vorher.y + vorher.height / 3);
        await page.waitForTimeout(300);
        expect(await transformDesBildes(page)).toBe("none");
    });

    test("Tastatur: die Fläche ist ein Knopf mit Fokusring, Enter öffnet, Esc schließt", async ({ page }) => {
        const gross = page.getByTestId("info-header-gross");
        await expect(gross).toHaveAttribute("aria-label", "Bild groß ansehen");
        await gross.focus();
        await page.keyboard.press("Enter");
        await expect(ansicht(page)).toBeVisible();
        await expect(ansicht(page).getByTestId("bildansicht-stand")).toHaveText("1 von 7");
        await page.keyboard.press("Escape");
        await expect(ansicht(page)).toBeHidden();
        // Der Fokusring liegt im Bild, gezeichnet über den Schatten (Guide §30.3).
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        const ring = await gross.evaluate((node) => getComputedStyle(node).boxShadow);
        expect(ring).not.toBe("none");
    });
});

test("🔴 eine einzige Ortsansicht: „Ortsansicht“, ohne Pfeile und Marken, und groß ohne Blättern", async ({ page }) => {
    await bedieneBilder(page);
    await stelleKopf(page, GARETH, [kopfbild(1, "place_view")]);
    await openMap(page);
    await oeffne(page, { kind: "place", id: GARETH }, "Gareth");
    await expect(plakette(page)).toHaveText("Ortsansicht");
    await expect(page.getByTestId("info-header-prev")).toHaveCount(0);
    await expect(page.getByTestId("info-header-mark")).toHaveCount(0);
    await sitztUntenRechts(page);
    await page.getByTestId("info-header-gross").click();
    await expect(ansicht(page)).toBeVisible();
    await expect(ansicht(page).getByTestId("bildansicht-stand")).toHaveCount(0);
    await expect(ansicht(page).getByTestId("bildansicht-weiter")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(ansicht(page)).toBeHidden();
});

test.describe("🔴 Typbild: ein Bild, das auch an anderen Orten hängt (Akiras)", () => {
    test("nur die Schrift, halb durchsichtig mit Schatten - das Bild bleibt unverändert; kein Klick, kein Zoom", async ({
        page,
    }) => {
        await bedieneBilder(page);
        await stelleKopf(page, GARETH, [kopfbild(5, "type_image")]);
        await openMap(page);
        await oeffne(page, { kind: "place", id: GARETH }, "Gareth");
        await expect(plakette(page)).toHaveText("Typbild");
        await expect(plakette(page)).toHaveAttribute("data-bezug", "typbild");
        await expect(page.getByTestId("info-header-bildbezug-zeichen")).toHaveCount(0);
        await sitztUntenRechts(page);
        const look = await page.evaluate(() => {
            const label = getComputedStyle(document.querySelector("[data-testid=info-header-bildbezug]")!);
            const image = getComputedStyle(document.querySelector("[data-testid=info-header-image]")!);
            const media = getComputedStyle(document.querySelector("[data-testid=info-media]")!);
            return {
                colour: label.color,
                shadow: label.textShadow,
                background: label.backgroundColor,
                border: label.borderTopWidth,
                labelOpacity: label.opacity,
                imageOpacity: image.opacity,
                imageFilter: image.filter,
                cursor: image.cursor,
                mediaCursor: media.cursor,
            };
        });
        // 50 % nur an der Schrift: Farbe mit halber Deckkraft, das Element selbst und das Bild voll.
        expect(look.colour).toBe("rgba(255, 255, 255, 0.5)");
        expect(look.labelOpacity).toBe("1");
        expect(look.imageOpacity).toBe("1");
        expect(look.imageFilter).toBe("none");
        expect(look.shadow).not.toBe("none");
        expect(look.background).toBe("rgba(0, 0, 0, 0)");
        expect(look.border).toBe("0px");
        expect(look.cursor).not.toBe("zoom-in");
        expect(look.mediaCursor).not.toBe("zoom-in");
        // Kein Knopf auf dem Bild: ein Klick öffnet nichts, das Zeigen zoomt nicht.
        await expect(page.getByTestId("info-header-gross")).toHaveCount(0);
        const medien = await kasten(page.getByTestId("info-media"));
        await page.mouse.move(medien.x + medien.width / 2, medien.y + medien.height / 3);
        await page.mouse.click(medien.x + medien.width / 2, medien.y + medien.height / 3);
        await page.waitForTimeout(300);
        await expect(ansicht(page)).toBeHidden();
        expect(await transformDesBildes(page)).toBe("none");
    });

    test("mehrere Typbilder blättern wie bisher, bleiben aber „Typbild“ und öffnen nichts", async ({ page }) => {
        await bedieneBilder(page);
        await stelleKopf(page, GARETH, [kopfbild(5, "type_image"), kopfbild(6)]);
        await openMap(page);
        await oeffne(page, { kind: "place", id: GARETH }, "Gareth");
        await expect(page.getByTestId("info-header-mark")).toHaveCount(2);
        await expect(plakette(page)).toHaveText("Typbild");
        await page.getByTestId("info-header-next").click();
        // Ein Bild ohne Feld (Vorversion des Servers) ist Typbild, nie Ortsansicht.
        await expect(plakette(page)).toHaveText("Typbild");
        await expect(page.getByTestId("info-header-gross")).toHaveCount(0);
    });
});

test("eine gemischte Folge (falls je geliefert): die Plakette folgt dem Bild, groß nur die Ortsansicht", async ({
    page,
}) => {
    await bedieneBilder(page);
    await stelleKopf(page, GARETH, [kopfbild(1, "place_view"), kopfbild(2, "type_image")]);
    await openMap(page);
    await oeffne(page, { kind: "place", id: GARETH }, "Gareth");
    await expect(plakette(page)).toHaveText("Ortsansicht");
    await page.getByTestId("info-header-next").click();
    await expect(plakette(page)).toHaveText("Typbild");
    await expect(page.getByTestId("info-header-gross")).toHaveCount(0);
    await page.getByTestId("info-header-prev").click();
    await page.getByTestId("info-header-gross").click();
    await expect(ansicht(page)).toBeVisible();
    // Nur die eine Ortsansicht ist groß zu sehen: kein Blättern zum Typbild.
    await expect(ansicht(page).getByTestId("bildansicht-stand")).toHaveCount(0);
    await page.keyboard.press("Escape");
});

test("🔴 ein Bild, das nicht lädt, fällt samt Beschriftung heraus: die Mehrzahl zählt nur, was da ist", async ({
    page,
}) => {
    await bedieneBilder(page, [2]);
    await stelleKopf(page, GARETH, [kopfbild(1, "place_view"), kopfbild(2, "place_view")]);
    await openMap(page);
    await oeffne(page, { kind: "place", id: GARETH }, "Gareth");
    await expect(plakette(page)).toHaveText("Ortsansichten");
    // Das zweite Bild scheitert erst, wenn es gezeigt wird (der Kopf lädt nur das gezeigte): Es fällt heraus, samt Pfeilen und Marken,
    // und aus der Mehrzahl wird die Einzahl - keine leere Fläche, keine Beschriftung über nichts.
    await page.getByTestId("info-header-next").click();
    await expect(page.getByTestId("info-header-mark")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId("info-header-next")).toHaveCount(0);
    await expect(plakette(page)).toHaveText("Ortsansicht");
    await expect(page.getByTestId("info-header-gross")).toHaveCount(1);
});

test("🔴 alle Bilder kaputt oder keine: die Grafik der Art, beschriftet „Typbild“", async ({ page }) => {
    await bedieneBilder(page, [1]);
    await stelleKopf(page, GARETH, [kopfbild(1, "place_view")]);
    await openMap(page);
    await page.evaluate((id) => globalThis.avesmapsOpenSubject?.({ kind: "place", id }), GARETH);
    await expect(page.getByTestId("info-header-image")).toHaveAttribute("data-graphic", "metropole", {
        timeout: 30_000,
    });
    await expect(plakette(page)).toHaveText("Typbild");
    await expect(page.getByTestId("info-header-gross")).toHaveCount(0);
});

test("🔴 3: die Grafik der Art an einem Weg ist „Typbild“ und öffnet nichts", async ({ page }) => {
    await openMap(page);
    await oeffne(page, REICHSSTRASSE, "Reichsstraße 3");
    await expect(page.getByTestId("info-header-image")).toHaveAttribute("data-graphic", /.+/);
    await expect(plakette(page)).toHaveText("Typbild");
    await sitztUntenRechts(page);
    await expect(page.getByTestId("info-header-gross")).toHaveCount(0);
});

test("die Nennung bleibt unter dem Bild, wie der Rechtevertrag sie verlangt", async ({ page }) => {
    await bedieneBilder(page);
    await stelleKopf(page, GARETH, [
        kopfbild(3, "place_view", { creator: "Fotografin", licenseName: "CC BY 4.0", attribution: "Foto: Fotografin" }),
    ]);
    await openMap(page);
    await oeffne(page, { kind: "place", id: GARETH }, "Gareth");
    await expect(page.getByTestId("info-header-credit")).toHaveText("Foto: Fotografin");
    await expect(plakette(page)).toHaveText("Ortsansicht");
    // Die Nennung liegt unter dem Bild, die Beschriftung im Bild.
    const medien = await kasten(page.getByTestId("info-media"));
    const nennung = await kasten(page.getByTestId("info-header-credit"));
    expect(nennung.y).toBeGreaterThanOrEqual(medien.y + medien.height - 1);
});

test("Englisch: „Place views“ und „Type image“", async ({ page }) => {
    await bedieneBilder(page);
    await stelleKopf(page, GARETH, [kopfbild(1, "place_view"), kopfbild(2, "place_view")]);
    await page.addInitScript(() => localStorage.setItem("avesmaps-lang", "en"));
    await openMap(page);
    await oeffne(page, { kind: "place", id: GARETH }, "Gareth");
    await expect(plakette(page)).toHaveText("Place views");
});
