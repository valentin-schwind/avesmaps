import { expect, test } from "@playwright/test";

/**
 * Die Fensterhülle am Telefon (WI-0045): Das Blatt füllt die Breite mit Rand, trägt keinen Griff (am
 * Finger zieht niemand), und die Tempotafel rollt waagerecht für sich - nie das Fenster.
 */
test("🔴 Am Telefon: volle Breite mit Rand, kein Griff, die Tafel rollt für sich, Tipp daneben schließt", async ({
    page,
}) => {
    await page.goto("/");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await page.getByTestId("route-planner-tab").tap();
    await expect(page.getByTestId("route-planner-tab")).toHaveAttribute("aria-expanded", "true");
    await page.getByTestId("transport-info-open").tap();
    const fenster = page.getByRole("dialog", { name: "Transportmittel" });
    await expect(fenster).toBeVisible();

    const viewport = page.viewportSize()!;
    const box = (await fenster.boundingBox())!;
    const rand = Math.round(box.x);
    expect(rand).toBe(14);
    expect(Math.round(viewport.width - box.x - box.width)).toBe(rand);
    await expect(fenster.locator(".avm-fenster__griff")).toBeHidden();

    const rollen = await fenster.evaluate((element) => {
        const rumpf = element.querySelector<HTMLElement>(".avm-fenster__rumpf")!;
        const tafel = element.querySelector<HTMLElement>(".fenster-tafel")!;
        return {
            tafelRollt: tafel.scrollWidth > tafel.clientWidth,
            rumpfWaagerecht: rumpf.scrollWidth > rumpf.clientWidth,
            huelleRollt: element.scrollHeight > element.clientHeight,
        };
    });
    expect(rollen).toEqual({ tafelRollt: true, rumpfWaagerecht: false, huelleRollt: false });

    // Oben über dem Fenster liegt der Schleier: ein Tipp dort schließt.
    await page.touchscreen.tap(viewport.width / 2, Math.max(2, box.y / 2));
    await expect(fenster).toBeHidden();
});

test("„Hinweise“ am Telefon: volle Breite mit Rand, Kacheln untereinander, nichts rollt seitlich", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await page.getByTestId("notes-open").tap();
    const fenster = page.getByRole("dialog", { name: "Hinweise" });
    await expect(fenster).toBeVisible();
    expect(Math.round((await fenster.boundingBox())!.x)).toBe(14);
    await fenster.getByTestId("notes-controls").locator("summary").tap();
    await expect(fenster.getByTestId("ring-on-touch")).toBeVisible();
    const lage = await fenster.evaluate((element) => {
        const [links, rechts] = [...element.querySelectorAll<HTMLElement>(".kachel")].map((k) =>
            k.getBoundingClientRect(),
        );
        const rumpf = element.querySelector<HTMLElement>(".avm-fenster__rumpf")!;
        return {
            untereinander: rechts!.top > links!.bottom - 1,
            rumpfWaagerecht: rumpf.scrollWidth > rumpf.clientWidth,
            huelleRollt: element.scrollHeight > element.clientHeight,
        };
    });
    expect(lage).toEqual({ untereinander: true, rumpfWaagerecht: false, huelleRollt: false });
    await fenster.getByTestId("fenster-schliessen").tap();
    await expect(fenster).toBeHidden();
});

test("ⓘ Reiseoptionen am Telefon: eine Spalte, volle Breite, nur der Rumpf rollt", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await page.getByTestId("route-planner-tab").tap();
    await expect(page.getByTestId("route-planner-tab")).toHaveAttribute("aria-expanded", "true");
    await page.getByTestId("options-info-open").tap();
    const fenster = page.getByRole("dialog", { name: "Reiseoptionen" });
    await expect(fenster).toBeVisible();
    const box = (await fenster.boundingBox())!;
    expect(Math.round(box.x)).toBe(14);
    // Das Mauerwerk (WI-0076) ist am Telefon eine Spalte: Alle Karten stehen links bündig untereinander.
    const lage = await fenster.evaluate((element) => {
        const karten = [...element.querySelectorAll<HTMLElement>(".fenster-mauer > .fenster-karte")].map((k) =>
            k.getBoundingClientRect(),
        );
        const rumpf = element.querySelector<HTMLElement>(".avm-fenster__rumpf")!;
        return {
            spalten: new Set(karten.map((k) => Math.round(k.left))).size,
            untereinander: karten.slice(1).every((k, i) => k.top > karten[i]!.bottom - 1),
            rumpfWaagerecht: rumpf.scrollWidth > rumpf.clientWidth,
            huelleRollt: element.scrollHeight > element.clientHeight,
        };
    });
    expect(lage).toEqual({ spalten: 1, untereinander: true, rumpfWaagerecht: false, huelleRollt: false });
    await fenster.getByTestId("fenster-schliessen").tap();
    await expect(fenster).toBeHidden();
});

test.describe("Telefon 360 px", () => {
    test.use({ viewport: { width: 360, height: 780 } });

    test("🔴 „Die Flugmittel“ passen ganz hinein: kein seitliches Rollen (WI-0076, „Tabelle B“)", async ({ page }) => {
        await page.goto("/");
        await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, {
            timeout: 30_000,
        });
        await page.getByTestId("route-planner-tab").tap();
        await expect(page.getByTestId("route-planner-tab")).toHaveAttribute("aria-expanded", "true");
        await page.getByTestId("transport-info-open").tap();
        const fenster = page.getByRole("dialog", { name: "Transportmittel" });
        await expect(fenster).toBeVisible();
        await fenster.getByRole("tab", { name: "In der Luft", exact: true }).tap();
        const lage = await fenster.getByTestId("transport-info-flugmittel").evaluate((table) => {
            const tafel = table.closest<HTMLElement>(".fenster-tafel")!;
            const rumpf = table.closest<HTMLElement>(".avm-fenster__rumpf")!;
            const rechts = tafel.getBoundingClientRect().right + 0.5;
            return {
                tafelRollt: tafel.scrollWidth > tafel.clientWidth,
                rumpfWaagerecht: rumpf.scrollWidth > rumpf.clientWidth,
                zahlenImBild: [...table.querySelectorAll("td")].every(
                    (td) => td.getBoundingClientRect().right <= rechts,
                ),
            };
        });
        expect(lage).toEqual({ tafelRollt: false, rumpfWaagerecht: false, zahlenImBild: true });
    });
});
