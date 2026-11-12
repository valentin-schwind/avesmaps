import { expect, test } from "@playwright/test";
import { alignmentReport, costBoxProblems, nightLineReports } from "./cost-box.ts";

/**
 * Die Zölle im Kasten „Reisekosten je Person“ am Telefon (WI-0065 Z3): Die Liste der Grenzübertritte klappt am Finger auf,
 * das Häkchen legt die Marken auf die Karte, und im Hochformat läuft nichts über die Panelbreite.
 */
test("🔴 Am Telefon: Zollzeile, Liste und Häkchen im Hochformat, ohne über die Breite zu laufen", async ({ page }) => {
    await page.goto("/?route=Gareth~Fasar");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await page.getByTestId("route-planner-tab").tap();
    await page.getByTestId("costs-toggle").tap();
    await expect(page.getByTestId("route-planner-tab")).toHaveAttribute("aria-expanded", "true");

    await expect(page.getByTestId("cost-tolls")).toHaveText("2 D", { timeout: 15_000 });
    await expect(page.getByTestId("route-costs")).toContainText("2 Landesgrenzen, als Söldner veranlagt");

    const toggle = page.getByTestId("borders-toggle");
    await toggle.scrollIntoViewIfNeeded();
    await toggle.tap();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("border-step")).toHaveCount(2);

    // Nichts läuft über die Panelbreite: weder die langen Namen noch das Häkchen.
    const overflow = await page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>("#route-planner-panel");
        const list = document.querySelector<HTMLElement>('[data-testid="route-borders"]');
        if (!panel || !list) throw new Error("Planer oder Liste fehlt");
        const box = panel.getBoundingClientRect();
        return {
            panelScrolls: panel.scrollWidth > panel.clientWidth + 1,
            listRight: list.getBoundingClientRect().right,
            panelRight: box.right,
        };
    });
    expect(overflow.panelScrolls).toBe(false);
    expect(overflow.listRight).toBeLessThanOrEqual(overflow.panelRight + 1);

    // Das Häkchen ist am Finger treffbar und legt zwei Marken auf die Karte.
    await page.getByTestId("borders-show").tap();
    await expect
        .poll(() =>
            page.evaluate(() => {
                const map = globalThis.avesmapsMap as unknown as {
                    querySourceFeatures(source: string): { properties: { order: number } }[];
                };
                return new Set(map.querySourceFeatures("route-borders").map((feature) => feature.properties.order))
                    .size;
            }),
        )
        .toBe(2);
});

test("🔴 Am Telefon bleiben Marken und Schilder des Häkchens, wenn der Planer zugeht (Betreiber 2026-10-03)", async ({
    page,
}) => {
    // Der Planer deckt am Telefon fast die ganze Karte: Die Marken sieht man erst, wenn er zu ist. Bisher nahm das
    // Zuklappen das Häkchen mit, und am Telefon erschien nie eine Marke. Sie gehen mit der Route, beim Neuladen und
    // beim Ausschalten des Häkchens (WI-0065 Z3 C), nicht mit dem Planer.
    await page.goto("/?route=Gareth~Fasar");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    const tab = page.getByTestId("route-planner-tab");
    await tab.tap();
    await page.getByTestId("costs-toggle").tap();
    await page.getByTestId("borders-toggle").tap();
    await page.getByTestId("borders-show").tap();
    await expect(page.getByTestId("borders-show")).toBeChecked();
    await tab.tap();
    await expect(tab).toHaveAttribute("aria-expanded", "false");
    await expect.poll(() => page.evaluate(() => globalThis.avesmapsMap?.isMoving())).toBe(false);
    const marker = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const first = map
            .queryRenderedFeatures({ layers: ["route-border-body"] })
            .find((feature) => feature.properties["order"] === 0);
        if (!first) return null;
        const coordinates = first.geometry.coordinates as [number, number];
        return map.project({ lng: coordinates[0], lat: coordinates[1] });
    });
    expect(marker, "die Marke steht nach dem Zuklappen auf der Karte").not.toBeNull();
    // Das Schild steht ohne Tippen über jeder Marke (Betreiber 2026-10-03).
    await expect(page.getByTestId("border-label")).toHaveCount(2);
    await expect(page.getByTestId("border-label").first()).toBeVisible();
    await expect(page.getByTestId("border-label").first()).toContainText("Aranien");
    await tab.tap();
    await expect(page.getByTestId("borders-show")).toBeChecked();
});

test("🔴 Am Telefon bricht die Herleitung nie mitten im Wort um, auch nicht im Dunkelmodus (Betreiber 2026-09-30)", async ({
    page,
}) => {
    for (const scheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto("/?route=Pildek~Estoria");
        await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, {
            timeout: 30_000,
        });
        const tab = page.getByTestId("route-planner-tab");
        if ((await tab.getAttribute("aria-expanded")) !== "true") await tab.tap();
        await page.getByTestId("costs-toggle").tap();
        // Die Zahl der Nächte gehört den Daten, nicht diesem Test (auf Satz 179380 vier statt einer, siehe route-costs.spec.ts).
        await expect(page.getByTestId("route-costs")).toContainText(/\d+ × im Gemeinschaftszimmer/u, {
            timeout: 15_000,
        });
        await expect(page.getByTestId("route-costs")).toContainText("1 Landesgrenze, als Söldner veranlagt");
        expect(await costBoxProblems(page), scheme).toEqual({ broken: [], overflows: false });
    }
});

test("Ein Grenzübertritt gibt am Telefon die Karte frei, das Schild steht über seiner Marke", async ({ page }) => {
    await page.goto("/?route=Gareth~Fasar");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true);
    await page.getByTestId("route-planner-tab").tap();
    await page.getByTestId("costs-toggle").tap();
    await page.getByTestId("borders-toggle").tap();
    await page.getByTestId("border-step").first().getByRole("button").tap();
    await expect(page.getByTestId("route-planner-tab")).toHaveAttribute("aria-expanded", "false");
    await expect.poll(() => page.evaluate(() => globalThis.avesmapsMap?.isMoving())).toBe(false);
    expect(await page.evaluate(() => globalThis.avesmapsMap!.getZoom())).toBeCloseTo(8, 6);
    const visible = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        return map
            .queryRenderedFeatures({ layers: ["route-border-body"] })
            .some((feature) => feature.properties["order"] === 0);
    });
    expect(visible, "Gewählter Grenzmarker im Ausschnitt").toBe(true);
    await expect(page.getByTestId("border-label").first()).toBeVisible();
    await expect(page.getByTestId("border-label").first()).toContainText("Aranien");
    await page.getByTestId("route-planner-tab").tap();
    await page.getByTestId("costs-toggle").tap();
    await expect(page.getByTestId("borders-show")).toBeChecked();
});

/**
 * Der Kasten mit Unterzeilen und Fußnoten am Telefon (Betreiber 2026-10-04): Der Betrag bricht nie um, ein Umbruch steht
 * an sinnvoller Stelle, kein Wort bricht mittendrin, nichts läuft über die Panelbreite.
 */
for (const width of [320, 360, 412]) {
    test(`🔴 Am Telefon bei ${String(width)} px: Übernachtung als Unterzeilen mit Fußnoten, nichts läuft über (Betreiber 2026-10-04)`, async ({
        page,
    }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(
            "/?route=Wargentrutz~@478.44,610.97&landTransport=lightRider&seaTransport=galley&startMonth=firun",
        );
        await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, {
            timeout: 30_000,
        });
        const tab = page.getByTestId("route-planner-tab");
        if ((await tab.getAttribute("aria-expanded")) !== "true") await tab.tap();
        await page.getByTestId("costs-toggle").tap();
        await expect(page.getByTestId("cost-footnotes")).toBeVisible({ timeout: 15_000 });

        expect(await costBoxProblems(page), `${String(width)} px`).toEqual({ broken: [], overflows: false });
        const layout = await page.evaluate(() => {
            const panel = document.querySelector<HTMLElement>("#route-planner-panel");
            const box = document.querySelector<HTMLElement>('[data-testid="planning-costs"]');
            return {
                // Der Kasten liegt in der Panelbreite (dass das Panel selbst nicht seitlich rollt, hält
                // `route-planner-scroll.touch.spec.ts`).
                insidePanel:
                    panel && box ? box.getBoundingClientRect().right <= panel.getBoundingClientRect().right + 1 : null,
                // Ein Betrag steht in einer Zeile: „4 S 8 H“ bricht nie, auch wenn die Zeile davor umbricht.
                brokenAmounts: [...document.querySelectorAll('[data-testid="route-costs"] .wert')]
                    .filter(
                        (element) =>
                            new Set(
                                [...element.querySelectorAll("span")].map((part) =>
                                    Math.round(part.getBoundingClientRect().top),
                                ),
                            ).size > 1,
                    )
                    .map((element) => element.textContent),
            };
        });
        expect(layout).toEqual({ insidePanel: true, brokenAmounts: [] });
        // 🔴 Die Unterzeile läuft nie über (Betreiber 2026-10-04): Was nicht in eine Zeile passt, bricht nach dem
        // Doppelpunkt, der Betrag samt Fußnotenzahl bleibt zusammen, nichts ragt über die Wertspalte oder rollt.
        for (const report of await nightLineReports(page)) {
            const where = `${String(width)} px: ${report.text}`;
            expect(report.overflowRight, where).toBeLessThanOrEqual(0.5);
            expect(report.overflowLeft, where).toBeLessThanOrEqual(0.5);
            expect(report.scrolls, where).toBe(false);
            expect(report.keepOnOneLine ?? true, `${where}: Betrag und Nummer zusammen`).toBe(true);
            expect(report.breaksAfterColon ?? true, `${where}: Umbruch nach dem Doppelpunkt`).toBe(true);
        }
        // Die Kante der Beschriftungen und Fußnoten fluchtet mit der Kopfzeile, wie am Rechner.
        const aligned = await alignmentReport(page);
        for (const left of [...aligned.labels, ...aligned.footnotes]) {
            expect(
                Math.abs(left - aligned.head),
                `${String(width)} px: ${String(left)} gegen ${String(aligned.head)}`,
            ).toBeLessThanOrEqual(1);
        }
        // Die Fußnoten stehen unten, jede lesbar.
        await expect(page.getByTestId("cost-footnote").first()).toBeVisible();
    });
}
