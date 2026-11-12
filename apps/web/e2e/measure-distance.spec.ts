import { expect, test, type Page } from "@playwright/test";
import { chooseFromFan, settleFrame, showPlace, type MeasurementHandle } from "./map-handle.ts";

/**
 * Das Messwerkzeug am echten Stack (WI-0095, Finding MCS-030): bedient, nicht nachgerechnet.
 *
 * Der Test macht das, was ein Mensch macht - Rechtsklick, „Entfernung messen", zweiter Klick -, und
 * LIEST die Pille ab. Die Rechnung selbst prüft `apps/web/test/measure-distance.test.ts` gegen Legacys
 * eigene Erwartungswerte; hier geht es darum, dass das Werkzeug wirklich bedienbar ist.
 */

const MENU = "map-context-menu";

/** Zwei Stellen nahe Gareth, 20 Karteneinheiten auseinander: 60,0 Meilen, bequem auf einen Schirm. */
const FROM = { x: 545, y: 533 };
const TO = { x: 565, y: 533 };

async function openMap(page: Page): Promise<void> {
    await page.goto("/");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
}

/**
 * Die Kamera auf die Mitte beider Stellen, weit genug heraus, dass beide im Bild liegen, und zwar in der Mitte der FREIEN Fläche
 * (`showPlace`): Seit WI-0218 (Fluchtpunkt in der Bildmitte) rückt kein `padding` die Kamera mehr neben den Planer; die linke Stelle
 * lag sonst unter ihm, und der Rechtsklick traf den Planer statt der Karte (Sammellauf 3, 14fb1eab).
 */
async function showBoth(page: Page, zoom = 6): Promise<void> {
    await showPlace(page, { x: (FROM.x + TO.x) / 2, y: (FROM.y + TO.y) / 2 }, zoom);
}

/** Wo eine Kartenstelle im Fenster liegt, in Seitenpixeln. */
async function screenOf(page: Page, point: { x: number; y: number }): Promise<{ x: number; y: number }> {
    const box = await page.getByTestId("map").boundingBox();
    const at = await page.evaluate((target) => {
        const map = globalThis.avesmapsMap;
        const projection = globalThis.avesmapsRenderProjection;
        if (!map || !projection) throw new Error("map handle missing");
        return map.project(projection.toRenderLngLat(target));
    }, point);
    return { x: (box?.x ?? 0) + at.x, y: (box?.y ?? 0) + at.y };
}

async function chooseFromMenu(page: Page, at: { x: number; y: number }, entry: string): Promise<void> {
    await page.mouse.click(at.x, at.y, { button: "right" });
    await expect(page.getByTestId(MENU)).toBeVisible();
    await page.getByTestId(entry).click();
    await expect(page.getByTestId(MENU)).toHaveCount(0);
}

const measurement = (page: Page): Promise<MeasurementHandle | undefined> =>
    page.evaluate(() => globalThis.avesmapsMeasurement?.());

/** Die GERECHNETEN Stilwerte der Wertpille, so wie der Browser sie am Ende hat. */
const pillStyle = (page: Page): Promise<Record<string, string>> =>
    page.evaluate(() => {
        const pill = document.querySelector('[data-testid="measure-value"]');
        if (!pill) throw new Error("Wertpille fehlt");
        const style = getComputedStyle(pill);
        const container = document.querySelector(".maplibregl-map");
        return {
            family: style.fontFamily,
            size: style.fontSize,
            weight: style.fontWeight,
            synthesis: style.fontSynthesisWeight,
            borderWidth: style.borderTopWidth,
            borderStyle: style.borderTopStyle,
            // Der Beleg, dass die Familie nicht geerbt ist: der Container trägt eine andere.
            containerFamily: container === null ? "" : getComputedStyle(container).fontFamily,
        };
    });

test("Eine Zweipunktmessung: Menü, zweiter Klick, und die Pille nennt die Meilen", async ({ page }) => {
    await openMap(page);
    await showBoth(page);

    // 1. Der Eintrag ist bedienbar (bis WI-0095 stand er gesperrt da).
    await page.mouse.click((await screenOf(page, FROM)).x, (await screenOf(page, FROM)).y, { button: "right" });
    await expect(page.getByTestId(MENU)).toBeVisible();
    await expect(page.getByTestId("context-measure")).toBeEnabled();
    // Solange keine Messung läuft, gibt es den Löscheintrag nicht - wie bei Legacy.
    await expect(page.getByTestId("context-measure-clear")).toHaveCount(0);
    await page.getByTestId("context-measure").click();
    await expect(page.getByTestId(MENU)).toHaveCount(0);

    // 2. Der erste Punkt steht, der Satz sagt, was fehlt, und es gibt noch keine Linie.
    await expect(page.getByTestId("toast")).toContainText("Startpunkt gesetzt");
    const started = await measurement(page);
    expect(started?.start).toBeDefined();
    expect(started?.end).toBeUndefined();
    await expect(page.getByTestId("measure-value")).toHaveCount(0);

    // 3. Der nächste Linksklick setzt den Zielpunkt.
    const to = await screenOf(page, TO);
    await page.mouse.click(to.x, to.y);
    await expect(page.getByTestId("measure-value")).toBeVisible();

    // 4. Abgelesen: 20 Karteneinheiten sind 60,0 Meilen.
    await expect(page.getByTestId("measure-value")).toHaveText("60,0 Meilen");
    const done = await measurement(page);
    expect(done?.end).toBeDefined();
    expect(Math.abs((done?.miles ?? 0) - 60)).toBeLessThan(0.5);

    // 5. Beide Ebenen stehen im Stil: die gestrichelte Linie und die zwei Griffe.
    // 🪤 Erst ein Bild abwarten: `queryRenderedFeatures` liest das GEZEICHNETE, und die Quelle wurde gerade getauscht.
    await settleFrame(page);
    const drawn = await page.evaluate(() => {
        const map = globalThis.avesmapsMap;
        if (!map) throw new Error("map handle missing");
        return {
            line: map.queryRenderedFeatures({ layers: ["measure-line"] }).length,
            handles: map.queryRenderedFeatures({ layers: ["measure-handle-ring"] }).length,
        };
    });
    expect(drawn.line).toBeGreaterThan(0);
    expect(drawn.handles).toBe(2);
});

test("🔴 Die Pille steht in der Hausschrift, regulär und ohne Rahmen", async ({ page }) => {
    await openMap(page);
    await showBoth(page);
    await chooseFromMenu(page, await screenOf(page, FROM), "context-measure");
    const to = await screenOf(page, TO);
    await page.mouse.click(to.x, to.y);
    await expect(page.getByTestId("measure-value")).toBeVisible();
    const style = await pillStyle(page);

    // 💣 **Die Falle, die das kostet:** Die Pille hängt an einem MapLibre-Marker, also IM Kartencontainer,
    // und der trägt `12px "Helvetica Neue", Arial`. Ohne eigenes `font-family` steht sie in Arial - genau
    // wie der Kartentooltip 2026-10-03 (Guide §15.3). Deshalb wird hier GEGEN den Container geprüft: Wäre
    // die Familie geerbt, wären beide Zeilen gleich.
    expect(style.family).toContain("Faculty Glyphic");
    expect(style.containerFamily).not.toContain("Faculty Glyphic");
    expect(style.family).not.toBe(style.containerFamily);

    // 🔴 Kein Gewicht: Die Hausschrift bringt nur den Regular mit, ein `font-weight` darüber wäre eine vom
    // Browser GEFÄLSCHTE Fettung (Betreiber 2026-10-07: „die schriftart … ist noch falsch").
    expect(style.weight).toBe("400");
    expect(style.synthesis).toBe("none");
    expect(style.size).toBe("12px");

    // 🔴 Kein Rahmen (Betreiber 2026-10-07: „die pille braucht keinen rahmen").
    expect(style.borderWidth).toBe("0px");
    expect(style.borderStyle).toBe("none");
});

test("Ein Griff lässt sich ziehen, und der Wert rechnet dabei mit", async ({ page }) => {
    await openMap(page);
    await showBoth(page);
    await chooseFromMenu(page, await screenOf(page, FROM), "context-measure");
    const to = await screenOf(page, TO);
    await page.mouse.click(to.x, to.y);
    await expect(page.getByTestId("measure-value")).toHaveText("60,0 Meilen");

    // Den Zielgriff um die halbe Strecke zurückziehen: aus 60 werden rund 30 Meilen.
    const middle = await screenOf(page, { x: (FROM.x + TO.x) / 2, y: FROM.y });
    await page.mouse.move(to.x, to.y);
    await page.mouse.down();
    await page.mouse.move(middle.x, middle.y, { steps: 8 });
    await page.mouse.up();

    await expect.poll(async () => (await measurement(page))?.miles ?? 0, { timeout: 10_000 }).toBeLessThan(40);
    const moved = await measurement(page);
    expect(Math.abs((moved?.miles ?? 0) - 30)).toBeLessThan(3);
});

test("🔴 Der Klick, der den Zielpunkt setzt, öffnet KEIN Objekt (Legacy schluckt ihn)", async ({ page }) => {
    await openMap(page);
    // Gareth selbst als Zielpunkt: Ein Klick darauf öffnet normalerweise sein Panel.
    await showBoth(page);
    await chooseFromMenu(page, await screenOf(page, FROM), "context-measure");
    const gareth = await screenOf(page, { x: 551.625, y: 532.969 });
    await page.mouse.click(gareth.x, gareth.y);
    await expect(page.getByTestId("measure-value")).toBeVisible();
    // Keine Auswahl: Der Klick gehörte der Messung.
    expect(await page.evaluate(() => globalThis.avesmapsSelectedSubject?.())).toBeUndefined();
});

test("Abbrechen: Escape nimmt die wartende Messung, das Menü löscht die fertige", async ({ page }) => {
    await openMap(page);
    await showBoth(page);

    // Escape während des Wartens: die halb begonnene Messung ist weg.
    await chooseFromMenu(page, await screenOf(page, FROM), "context-measure");
    expect(await measurement(page)).toBeDefined();
    await page.keyboard.press("Escape");
    await expect.poll(() => measurement(page)).toBeUndefined();

    // Fertig gemessen, dann über das Menü gelöscht - mit Legacys Meldung.
    await chooseFromMenu(page, await screenOf(page, FROM), "context-measure");
    const to = await screenOf(page, TO);
    await page.mouse.click(to.x, to.y);
    await expect(page.getByTestId("measure-value")).toBeVisible();
    await chooseFromMenu(page, to, "context-measure-clear");
    // 🪤 Der Startpunkt-Toast blendet gerade aus: `getByTestId("toast")` trifft dann zwei Elemente.
    await expect(page.getByTestId("toast").last()).toContainText("Entfernungsmessung gelöscht");
    await expect(page.getByTestId("measure-value")).toHaveCount(0);
    expect(await measurement(page)).toBeUndefined();
});

test("Eine neue Messung ersetzt die alte - es gibt immer nur eine, und keine Kette", async ({ page }) => {
    await openMap(page);
    await showBoth(page);
    await chooseFromMenu(page, await screenOf(page, FROM), "context-measure");
    const to = await screenOf(page, TO);
    await page.mouse.click(to.x, to.y);
    await expect(page.getByTestId("measure-value")).toHaveText("60,0 Meilen");

    // Ein dritter Klick verlängert nichts: Die Messung steht, der Klick geht an die Karte.
    // 🪤 Die Stelle muss IM freien Bild liegen: auf z6 sind 32 px eine Karteneinheit, der halbe Schirm
    // also 20 Einheiten breit und gut 11 hoch - und links deckt der offene Planer rund 12 Einheiten.
    const third = await screenOf(page, { x: 560, y: 528 });
    await page.mouse.click(third.x, third.y);
    await expect(page.getByTestId("measure-value")).toHaveText("60,0 Meilen");

    // „Entfernung messen" ein zweites Mal beginnt neu, mit genau einer Messung.
    await chooseFromMenu(page, third, "context-measure");
    const fresh = await measurement(page);
    expect(fresh?.end).toBeUndefined();
    await expect(page.getByTestId("measure-value")).toHaveCount(0);
    // 🪤 Erst ein Bild abwarten, dann das Gezeichnete lesen (sonst zählt der Test das vorige Bild mit zwei Griffen).
    await settleFrame(page);
    const handles = await page.evaluate(
        () => globalThis.avesmapsMap?.queryRenderedFeatures({ layers: ["measure-handle-ring"] }).length ?? -1,
    );
    expect(handles).toBe(1);
});

test("💣 Die Messung übersteht einen Wechsel der Ansicht", async ({ page }) => {
    await openMap(page);
    await showBoth(page);
    await chooseFromMenu(page, await screenOf(page, FROM), "context-measure");
    const to = await screenOf(page, TO);
    await page.mouse.click(to.x, to.y);
    await expect(page.getByTestId("measure-value")).toHaveText("60,0 Meilen");

    // 💣 `setStyle` mit `diff` entfernt, was der neue Stil nicht nennt: Hinge die Messung neben dem Stil,
    // wäre sie nach dem Wechsel weg - lautlos. Deshalb nennt sie JEDER Stil (`withMeasure` in `composeStyle`).
    await chooseFromFan(page, "landscapes", "fan-layer-topographie");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await settleFrame(page);

    await expect(page.getByTestId("measure-value")).toHaveText("60,0 Meilen");
    const drawn = await page.evaluate(() => {
        const map = globalThis.avesmapsMap;
        if (!map) throw new Error("map handle missing");
        return {
            line: map.queryRenderedFeatures({ layers: ["measure-line"] }).length,
            handles: map.queryRenderedFeatures({ layers: ["measure-handle-ring"] }).length,
        };
    });
    expect(drawn.line).toBeGreaterThan(0);
    expect(drawn.handles).toBe(2);
});
