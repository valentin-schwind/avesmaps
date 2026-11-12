import { expect, test, type Page } from "@playwright/test";
import { DESIGN_CANON } from "@avesmaps3d/shared";
import { flushLeftShifts } from "./flush-left.ts";
import { showStages } from "./stage-groups.ts";
import { openStageGroups } from "./stage-groups.ts";

/**
 * Der Routenplaner am echten Stack (WI-0017, Schritt 2): Link, Eingabe, Etappen, Leerzustand.
 *
 * 🪤 Gemessen wird, was der Besucher sieht und was die Karte tut - nicht der Zustand im Speicher.
 * Eine Etappenliste, deren Wahl die Linie nicht gold färbt, wäre die halbe Funktion.
 */

async function openPlanner(page: Page, search = ""): Promise<void> {
    await page.goto(`/${search}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    // Am Rechner fährt der Planer herein, sobald die Karte steht (Legacy A1).
    await expect(page.getByTestId("route-planner-tab")).toHaveAttribute("aria-expanded", "true");
}

/**
 * Die Etappentexte der Route, ohne den nachgeladenen Zusatz „durch <Landschaften> … und <Herrschaftsgebiete> …“.
 *
 * 🪤 Der Zusatz kommt aus einer eigenen Abfrage (`/api/route/landscapes`, WI-0035/WI-0065), einen Augenblick nach der
 * Route. Unter Last weist der Server sie mit 503 `busy` ab (höchstens zwei gleichzeitig); der Browser fragt dann nach
 * der Pause aus `Retry-After` höchstens zweimal nach, und nach drei Absagen fehlt der Zusatz für diesen Ladevorgang ganz
 * (2026-10-03, `--workers=4`). Die Landschaften prüft `route-landscapes.spec.ts`; hier zählt die Reise.
 */
async function stageTexts(page: Page): Promise<string[]> {
    await showStages(page, 15_000);
    // Seit WI-0079 trägt die Zeile nur noch Nummer, Orte, Wegart, Distanz und Zeit - die Landschaften und
    // Gebiete stehen im Infopanel. Zu vergleichen ist also der ganze Text der Zeile.
    return page
        .getByTestId("route-stage")
        .evaluateAll((rows) => rows.map((row) => row.textContent!.replace(/\s+/g, " ").trim()));
}

/** Die Etappen, die auf der Karte gerade gold sind. */
async function goldStages(page: Page): Promise<number[]> {
    return page.evaluate(() => {
        const map = globalThis.avesmapsMap as unknown as {
            querySourceFeatures(source: string): { properties: { stage: number; selected: boolean } }[];
        };
        return [
            ...new Set(
                map
                    .querySourceFeatures("route")
                    .filter((feature) => feature.properties.selected)
                    .map((feature) => feature.properties.stage),
            ),
        ];
    });
}

test("🔴 ?route=Gareth~Perricum öffnet die Reise, übersteht Neuladen, und Legacys Form öffnet dieselbe", async ({
    page,
}) => {
    await openPlanner(page, "?route=Gareth~Perricum");
    await expect(page.getByTestId("waypoint-input").nth(0)).toHaveValue("Gareth");
    await expect(page.getByTestId("waypoint-input").nth(1)).toHaveValue("Perricum");
    await expect(page.getByTestId("route-title")).toHaveText(/Die Reise von\s+Gareth\s+nach\s+Perricum/);
    const stages = await stageTexts(page);
    expect(stages.length).toBeGreaterThan(1);
    // Zeile 1 nennt die beiden Orte (seit WI-0079 ohne „von“ und „bis“), die Kette beginnt in Gareth.
    expect(stages[0]).toContain("Gareth");
    expect(stages.at(-1)).toContain("Perricum");

    await page.reload();
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    expect(await stageTexts(page)).toEqual(stages);

    // Legacys wiederholtes `route` (AGENTS.md: Links von Legacy bleiben gültig) - und die Adresse
    // schreibt die Reise danach in der kurzen Form.
    await openPlanner(page, "?route=Gareth&route=Perricum");
    expect(await stageTexts(page)).toEqual(stages);
    await expect.poll(() => page.evaluate(() => globalThis.location.search)).toBe("?route=Gareth~Perricum");
});

test("🔴 Orte über die Vorschläge setzen: gerechnet, eingepasst, die Adresse schreibt mit", async ({ page }) => {
    await openPlanner(page);
    const first = page.getByTestId("waypoint-input").nth(0);
    await first.fill("Garet");
    // Keine Vorauswahl (Guide §17.5): erst ↓ markiert den ersten Vorschlag.
    await expect(page.getByTestId("waypoint-hits").first()).toContainText("Gareth");
    await first.press("ArrowDown");
    await first.press("Enter");
    await expect(first).toHaveValue("Gareth");

    await page.getByTestId("route-add").click();
    const second = page.getByTestId("waypoint-input").nth(1);
    await expect(second).toBeFocused();
    await second.fill("Perricum");
    await expect(page.getByTestId("waypoint-hits").first()).toContainText("Perricum");
    // Enter ohne Markierung nimmt den Ort, der genau so heißt (Legacy).
    await second.press("Enter");

    await expect(page.getByTestId("route-overview")).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => page.evaluate(() => globalThis.location.search)).toBe("?route=Gareth~Perricum");
    // Die Kästen sind zu und fassen zusammen, was eingestellt ist (Legacy C4).
    await expect(page.getByTestId("planner-options")).toContainText("8,0 h/Tag");
    // Die Routenwahl steht seit WI-0050 unter „Transportmittel“ und fasst sich dort zusammen.
    await expect(page.getByTestId("planner-transport")).toContainText("Lastensegler · Schnellste Route");
    // Die Karte hat die Route eingepasst: Gareth liegt im Bild, rechts neben dem Planer.
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 10_000 });
    const garethOnScreen = await page.evaluate(() => {
        const map = globalThis.avesmapsMap as unknown as {
            project(lngLat: { lng: number; lat: number }): { x: number; y: number };
            getCanvas(): HTMLCanvasElement;
        };
        const lngLat = globalThis.avesmapsRenderProjection!.toRenderLngLat({ x: 551.625, y: 532.969 });
        const point = map.project(lngLat);
        const panel = document.getElementById("route-planner-panel")!.getBoundingClientRect();
        return point.x > panel.right && point.x < map.getCanvas().clientWidth && point.y > 0;
    });
    expect(garethOnScreen, "Gareth liegt rechts neben dem Planer im Bild").toBe(true);
});

test("Eine Etappe wählen: Liste und Karte gold, Bild ↓ blättert weiter", async ({ page }) => {
    await openPlanner(page, "?route=Gareth~Perricum");
    await stageTexts(page);
    // Auf das Symbol: Orts- und Wegnamen in der Zeile sind eigene Knöpfe und führen zur Karte (E7).
    await page.getByTestId("route-stage").nth(1).locator("img").click();
    await expect(page.getByTestId("route-stage").nth(1)).toHaveClass(/is-active/);
    await expect.poll(() => goldStages(page)).toEqual([1]);

    await page.keyboard.press("PageDown");
    await expect(page.getByTestId("route-stage").nth(2)).toHaveClass(/is-active/);
    await expect.poll(() => goldStages(page)).toEqual([2]);
});

test("Pos1 und Ende wählen die Routenart, R hängt ein Ziel an und öffnet den Planer", async ({ page }) => {
    await openPlanner(page, "?route=Gareth~Perricum");
    await stageTexts(page);
    await page.keyboard.press("End");
    await expect.poll(() => page.evaluate(() => globalThis.location.search)).toContain("pathType=shortest");
    await page.keyboard.press("Home");
    await expect.poll(() => page.evaluate(() => globalThis.location.search)).toBe("?route=Gareth~Perricum");

    await page.getByTestId("route-planner-tab").click();
    await expect(page.getByTestId("route-planner-tab")).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("r");
    await expect(page.getByTestId("route-planner-tab")).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("waypoint-input")).toHaveCount(3);
    await expect(page.getByTestId("waypoint-input").nth(2)).toBeFocused();
});

test("🔴 Kein Medium erlaubt: ein Satz statt einer Route, und die Eingaben bleiben", async ({ page }) => {
    await page.goto("/?route=Gareth~Nirgendwo~Perricum&allowLand=0&allowRiver=0&allowSea=0");
    // Der unbekannte Name wird genannt, nicht still verworfen (Kap. 9.57). Gleich prüfen: Der Toast
    // steht 5 s, und die Namen sind oft aufgelöst, bevor die Karte fertig geladen hat.
    await expect(page.getByTestId("toast")).toContainText("Orte nicht gefunden: Nirgendwo");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(page.getByTestId("route-result")).toHaveText("Keine Route gefunden");
    await expect(page.getByTestId("waypoint-input")).toHaveCount(2);
    await expect(page.getByTestId("allow-land")).not.toBeChecked();
    // Wer ein Kästchen zurückstellt, bekommt seine Route wieder (Guide §17.11).
    await page.getByTestId("allow-land").check();
    await expect(page.getByTestId("route-overview")).toBeVisible({ timeout: 15_000 });
});

test("🔴 Ortsnamen sind Text, nie Markup (MCS-020, S1)", async ({ page }) => {
    const evil = '<img src=x onerror="globalThis.__eingeschleust=1">';
    // Eine echte Route, nur die Namen vergiftet - so, wie ein Kartenname es sein könnte.
    await page.route("**/api/route/waypoints/resolve**", async (route) => {
        const response = await route.fetch();
        const body = (await response.json()) as { places: ({ name: string } | null)[] };
        await route.fulfill({
            response,
            json: { places: body.places.map((place) => (place ? { ...place, name: `${place.name} ${evil}` } : null)) },
        });
    });
    await page.route("**/api/route?**", async (route) => {
        const response = await route.fetch();
        const body = (await response.json()) as {
            waypoints: { name: string }[];
            stages: { from: { name: string }; to: { name: string } }[];
        };
        body.waypoints = body.waypoints.map((waypoint) => ({ ...waypoint, name: `${waypoint.name} ${evil}` }));
        for (const stage of body.stages) {
            stage.from.name = `${stage.from.name} ${evil}`;
        }
        await route.fulfill({ response, json: body });
    });
    await openPlanner(page, "?route=Gareth~Perricum");
    await expect(page.getByTestId("route-title")).toContainText(evil);
    await expect(page.getByTestId("route-stage").first()).toContainText(evil);
    expect(await page.locator("[data-testid=route-planner] img[src='x']").count()).toBe(0);
    expect(await page.evaluate(() => (globalThis as { __eingeschleust?: number }).__eingeschleust)).toBeUndefined();
});

test("🔴 Die Vorschlagsliste ragt über den Planer hinaus, der Planer rollt nicht (Betreiber 2026-09-24)", async ({
    page,
}) => {
    await openPlanner(page, "?route=Gareth~Perricum~Rommilys");
    await stageTexts(page);
    const last = page.getByTestId("waypoint-input").nth(2);
    await last.fill("ga");
    const hits = page.getByTestId("waypoint-hits");
    await expect(hits).toBeVisible();
    const layout = await page.evaluate(() => {
        const list = document.querySelector('[data-testid="waypoint-hits"]') as HTMLElement;
        const panel = document.getElementById("route-planner-panel") as HTMLElement;
        return {
            inBody: list.parentElement === document.body,
            listBottom: list.getBoundingClientRect().bottom,
            panelScrolls: panel.scrollHeight > panel.clientHeight,
        };
    });
    expect(layout.inBody, "die Liste hängt am body, nicht im rollenden Panel").toBe(true);
    expect(layout.panelScrolls, "der Planer bekommt keinen Scrollbalken").toBe(false);
});

test("🔴 Ziehen: die Zeile hängt am Zeiger, die anderen rücken, erst das Loslassen ordnet neu", async ({ page }) => {
    await openPlanner(page, "?route=Gareth~Perricum~Rommilys");
    await stageTexts(page);
    const grips = page.locator(".waypoint__grip");
    const first = await grips.nth(0).boundingBox();
    const last = await grips.nth(2).boundingBox();
    if (!first || !last) throw new Error("Griffe fehlen");
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
    await page.mouse.down();
    await page.mouse.move(first.x + first.width / 2, last.y + last.height / 2 + 12, { steps: 8 });
    // Unterwegs: die gezogene Zeile ist verschoben, die Reihenfolge noch die alte.
    await expect(page.getByTestId("waypoint-row").nth(0)).toHaveClass(/waypoint--dragging/);
    await expect(page.getByTestId("waypoint-input").nth(0)).toHaveValue("Gareth");
    await page.mouse.up();
    await expect(page.getByTestId("waypoint-input").nth(2)).toHaveValue("Gareth");
    await expect.poll(() => page.evaluate(() => globalThis.location.search)).toBe("?route=Perricum~Rommilys~Gareth");
});

test("Eine Etappe lässt sich auch knapp neben der Linie wählen", async ({ page }) => {
    await openPlanner(page, "?route=Gareth~Perricum");
    await stageTexts(page);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 10_000 });
    // Ein Punkt 8 px neben der gezeichneten Linie, der sie selbst nicht mehr trifft.
    const probe = await page.evaluate(() => {
        const map = globalThis.avesmapsMap as unknown as {
            queryRenderedFeatures(point: [number, number], options: { layers: string[] }): unknown[];
            getCanvas(): HTMLCanvasElement;
        };
        const canvas = map.getCanvas();
        const panel = document.getElementById("route-planner-panel")!.getBoundingClientRect();
        for (let x = Math.ceil(panel.right) + 40; x < canvas.clientWidth - 80; x += 4) {
            for (let y = 60; y < canvas.clientHeight - 60; y += 2) {
                const onLine = map.queryRenderedFeatures([x, y], { layers: ["route-line"] }).length > 0;
                const beside = map.queryRenderedFeatures([x, y + 8], { layers: ["route-line"] }).length === 0;
                const hit = map.queryRenderedFeatures([x, y + 8], { layers: ["route-hit"] }).length > 0;
                const place = map.queryRenderedFeatures([x, y + 8], { layers: ["place-marker"] }).length > 0;
                if (onLine && beside && hit && !place) return { x, y: y + 8 };
            }
        }
        return null;
    });
    expect(probe, "ein Punkt neben der Linie, den nur die Trefferfläche trifft").not.toBeNull();
    const box = await page.getByTestId("map").boundingBox();
    await page.mouse.click((box?.x ?? 0) + probe!.x, (box?.y ?? 0) + probe!.y);
    await expect(page.locator("[data-testid=route-stage].is-active")).toHaveCount(1);
});

test("🔴 Ein Zwischenziel im Titel steht mit Leerzeichen da: „Gareth über Hartsteen nach Perricum“", async ({
    page,
}) => {
    // Regression 2026-09-24: Vue verwarf den Umbruch vor „über“, der Titel lautete „Garethüber Hartsteen“.
    await openPlanner(page, "?route=Gareth~Hartsteen~Perricum");
    await expect(page.getByTestId("route-title")).toHaveText(
        /Die Reise von\s+Gareth\s+über\s+Hartsteen\s+nach\s+Perricum/,
    );
});

test("🔴 Querfeldein: echte Pillen im festen Abstand bei jedem Zoom, auch zwischen den Stufen (Betreiber 2026-09-24)", async ({
    page,
}) => {
    // Ein Strichmuster streckt MapLibre zwischen zwei Zoomstufen mit der Kachel („Würste“), Bilder in fester
    // Größe lasen sich gedrückt und sprangen nach dem Zoom („ploppen“). Die eigene Ebene legt jede Pille in
    // jedem Bild: Strich plus Lücke von Mitte zu Mitte, bei jedem Zoom.
    // 🪤 Der Abstand wird als Sehne gemessen: Das Querfeldein-Stück muss GERADE sein. Seit R7 biegt es um Wasser,
    // ein Knick setzt zwei Pillen näher zusammen. Dieser Kartenpunkt ergibt in den Sätzen map147359 und
    // map154313 ein gerades Stück von 1,6 E (38 % der Reise). Der frühere (555.10, 532.50) lag im Satz 154313
    // an einer neuen Straße: 0,12 E querfeldein, eine einzige Pille.
    await openPlanner(page, "?route=Gareth~@552.48,530.62");
    await stageTexts(page);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 10_000 });
    const measure = (delta: number) =>
        page.evaluate(async (step) => {
            const map = globalThis.avesmapsMap!;
            map.jumpTo({ zoom: map.getZoom() + step });
            await new Promise<void>((resolve) => map.once("render", () => resolve()));
            const handle = globalThis as unknown as {
                avesmapsRoutePills: { drawn(): { x: number; y: number; alpha: number }[] };
            };
            const pills = handle.avesmapsRoutePills.drawn();
            return {
                type: (map.getLayer("route-offroad-pills") as { type?: string } | undefined)?.type,
                pills,
                gaps: pills
                    .slice(1)
                    .map((pill, index) => Math.hypot(pill.x - pills[index]!.x, pill.y - pills[index]!.y)),
            };
        }, delta);
    const [dash, gap] = DESIGN_CANON.route.offroadDash;
    for (const delta of [-0.37, -0.81]) {
        const { type, pills, gaps } = await measure(delta);
        expect(type).toBe("custom");
        expect(pills.length, "mehrere Pillen, sonst gibt es keinen Abstand").toBeGreaterThan(1);
        for (const between of gaps) expect(between).toBeGreaterThan(dash + gap - 1);
        expect(gaps.some((between) => Math.abs(between - (dash + gap)) < 0.5)).toBe(true);
    }

    // Gezeichnet wird wirklich: Die Mitte einer Pille trägt die Farbe der Route.
    const { pills } = await measure(0.29);
    const pill = pills.find((candidate) => candidate.alpha === 1)!;
    const box = (await page.getByTestId("map").boundingBox())!;
    const shot = await page.screenshot({
        clip: { x: Math.round(box.x + pill.x), y: Math.round(box.y + pill.y), width: 1, height: 1 },
    });
    const [red, green, blue] = await page.evaluate(async (png) => {
        const image = new Image();
        image.src = `data:image/png;base64,${png}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        return [...context.getImageData(0, 0, 1, 1).data];
    }, shot.toString("base64"));
    // #1452f7, die Farbe der Route aus der Tafel.
    expect(Math.abs(red! - 0x14) + Math.abs(green! - 0x52) + Math.abs(blue! - 0xf7)).toBeLessThan(40);
});

test("🔴 Ein umbrechender Name im Etappenplan steht linksbündig im Satz, nicht mittig (Betreiber 2026-09-24)", async ({
    page,
}) => {
    // Ein <button> bringt vom Browser `text-align: center` mit, und `font: inherit` holt die Ausrichtung
    // nicht zurück. Solange ein Name in die Zeile passt, sieht man nichts; bricht er um („Grenzfelden-
    // Zweifelsfels-Falding, Grafenpfad“), stand er mittig im Fließtext (Legacy hatte denselben Fehler).
    // Seit WI-0065 fließen die Namen als Inline-Fragmente im Satz (`.stage__link`, kein <button> mehr);
    // `button` träfe in der Etappe nur noch die Pillen „…“/„«“. Die echten Knöpfe der Übertritte prüft
    // `route-costs.spec.ts` mit derselben Messung.
    await openPlanner(page, "?route=Gareth~Perricum");
    await openStageGroups(page);
    await stageTexts(page);
    const names = await flushLeftShifts(
        page,
        "[data-testid=route-stage]",
        ".stage-link",
        "Grenzfelden-Zweifelsfels-Falding, Grafenpfad, Reichsstraße von Gareth nach Perricum",
    );
    expect(names.length).toBeGreaterThan(0);
    for (const line of names) {
        expect(line.lines, "der lange Name bricht um").toBeGreaterThan(1);
        expect(line.shift, "jede Zeile steht, wo ein linksbündiger Satz sie hinstellt").toBeLessThanOrEqual(1);
    }
});
