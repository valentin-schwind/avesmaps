import { expect, test, type Page } from "@playwright/test";
import { routeAnswer } from "./route-evidence.ts";
import { openStagePanel, stageField, stageFieldValue } from "./stage-panel.ts";
import { openStageGroups } from "./stage-groups.ts";

/**
 * Landschaften im Etappenplan am echten Stack (WI-0035, Legacy „Führt durch“).
 *
 * 🪤 Gemessen wird, was der Besucher liest und was ein Klick tut. Die Namen hängen am Datenstand;
 * geprüft werden deshalb Aufbau und Verhalten, nicht die genaue Liste.
 *
 * 🔴 Seit WI-0079 stehen die Landschaften und Gebiete EINER ETAPPE im Infopanel, nicht mehr im Fließtext
 * ihrer Zeile im Planer (§4: „die meisten Angaben existieren bereits im Infopanel“). Die Listen der GANZEN Reise
 * bleiben, wo sie waren - in der gemeinsamen Klappbox der Routendetails.
 */

/**
 * Der gemeinsame Deckel der Landschaften UND der politischen Gebiete (WI-0081). 🔴 Seit dem 2026-10-05 beginnt er
 * mit der ZAHL, ohne „Durch“ (Betreiber: „Durch 19
 * Landschaften und 43 politische Gebiete“): EIN Deckel (`route-areas`), die Landschaften zuerst; innen bleiben die
 * beiden Listen getrennt erkennbar (`route-landscapes`, `route-territories`). Einzahl und Mehrzahl gelten je Seite des
 * „und“.
 *
 * Berührt die Route Sprachflächen (WI-0261 O8), nennt der Deckel auch sie und kürzt die Gebiete, damit er einzeilig bleibt:
 * „17 Gegenden, 4 Sprachen und 81 Gebiete“. Welche Fassung kommt, hängt an den Daten; beide sind richtig.
 */
const AREAS_LID_DE =
    /^\d+ (?:Gegend|Gegenden)(?: und \d+ (?:politisches Gebiet|politische Gebiete)|, \d+ (?:Sprache|Sprachen) und \d+ (?:Gebiet|Gebiete))$/;
const AREAS_LID_EN =
    /^\d+ (?:area|areas)(?: and \d+ (?:political territory|political territories)|, \d+ (?:language|languages) and \d+ (?:territory|territories))$/;

/**
 * Antwortet mit der echten Antwort des Servers, nachdem `change` sie verändert hat: So entstehen die Fälle, in denen
 * eine der beiden Listen fehlt (`territories = null`, `regions = {}` - dann trägt keine Landschaft einen Namen).
 */
async function withLandscapes(page: Page, change: (body: Record<string, unknown>) => void): Promise<void> {
    await page.unroute("**/api/route/landscapes");
    await page.route("**/api/route/landscapes", async (request) => {
        const response = await request.fetch();
        // Eine Absage wegen Last (503 `busy`) bleibt, wie sie ist: Der Planer fragt dann selbst noch einmal.
        if (!response.ok()) return request.fulfill({ response });
        const body = (await response.json()) as Record<string, unknown>;
        change(body);
        await request.fulfill({ response, json: body });
    });
}

async function openRoute(page: Page, search: string): Promise<void> {
    await page.goto(`/${search}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(page.getByTestId("route-title")).toBeVisible({ timeout: 15_000 });
}

test("🔴 die Route nennt ihre Landschaften, jede Etappe ihre eigenen, und ein Name fliegt zur Beschriftung", async ({
    page,
}) => {
    await openRoute(page, "?route=Gareth~Perricum");
    await expect(page.getByTestId("areas-toggle")).toHaveText(AREAS_LID_DE, { timeout: 15_000 });
    const summary = page.getByTestId("route-landscapes");
    // Die Reise über Gareth läuft durch das Herz des Kontinents (Legacys eigenes Beispiel, V10 §3.4).
    await expect(summary).toContainText("Herz des Kontinents");
    // Keine Prozente im Planer (Owner 2026-07-29).
    await expect(summary).not.toContainText("%");

    // Die Landschaften EINER Etappe stehen im Infopanel (WI-0079 §3).
    await openStagePanel(page, 0);
    await expect(stageField(page, "landscapes")).toContainText(/\S/);
    await page.keyboard.press("Escape");

    const link = summary.locator("button.stage__link").first();
    await expect(link).not.toBeVisible();
    await page.getByTestId("areas-toggle").press("Enter");
    await expect(link).toBeVisible();
    const name = (await link.textContent())?.trim() ?? "";
    expect(name).not.toBe("");
    const before = await page.evaluate(() => [
        globalThis.avesmapsMap!.getCenter().lng,
        globalThis.avesmapsMap!.getCenter().lat,
    ]);
    await link.click();
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 10_000 });
    const after = await page.evaluate(() => [
        globalThis.avesmapsMap!.getCenter().lng,
        globalThis.avesmapsMap!.getCenter().lat,
    ]);
    expect(after, `Klick auf ${name} fliegt dorthin`).not.toEqual(before);
    // Wie ein Landschaftstreffer der Suche: die Standardansicht.
    await expect.poll(() => new URL(page.url()).hash).toContain("view=standard");
});

test("auf Englisch nennt der Deckel beide Zahlen, und die Namen bleiben Namen", async ({ page }) => {
    await openRoute(page, "?route=Gareth~Perricum&lang=en");
    await expect(page.getByTestId("areas-toggle")).toHaveText(AREAS_LID_EN, { timeout: 15_000 });
    const summary = page.getByTestId("route-landscapes");
    await expect(summary).toContainText("Herz des Kontinents", { timeout: 15_000 });
    await openStagePanel(page, 0);
    await expect(stageField(page, "landscapes").getByTestId("info-fact-label")).toHaveText("Derography");
});

test("🔴 die Etappenzeile nennt die Wegart, die Landschaften stehen vollständig im Panel (WI-0079 §2, §3)", async ({
    page,
}) => {
    const answer = routeAnswer(page);
    await openRoute(page, "?route=Gareth~Perricum");
    const route = await answer;
    const unnamedIndex = route.stages.findIndex((stage) => stage.type === "Strasse" && stage.path_names.length === 0);
    const namedIndex = route.stages.findIndex((stage) => stage.path_names.length === 1);
    expect(unnamedIndex, "Voraussetzung: namenlose Straße").toBeGreaterThanOrEqual(0);
    expect(namedIndex, "Voraussetzung: Etappe mit genau einem Wegnamen").toBeGreaterThanOrEqual(0);
    await openStageGroups(page);
    const unnamed = page.getByTestId("route-stage").nth(unnamedIndex);
    await expect(unnamed.getByTestId("stage-path")).toHaveCount(0);
    await expect(unnamed.locator(".stage__line2")).toContainText("Straße");
    const named = page.getByTestId("route-stage").nth(namedIndex);
    await expect(named.getByTestId("stage-path")).toHaveText(route.stages[namedIndex]!.path_names[0]!);
    for (const index of [unnamedIndex, namedIndex]) {
        const row = page.getByTestId("route-stage").nth(index);
        await expect(row).toContainText(/Meilen/);
        await expect(row.getByRole("button", { name: "Weitere Flächen anzeigen" })).toHaveCount(0);
        await openStagePanel(page, index);
        const landscapes = stageFieldValue(page, "landscapes");
        await expect(landscapes).toContainText(/\S/);
        expect((await landscapes.innerText()).trim()).not.toBe("");
    }
});

test("Gebiete einer Etappe im Panel: Zeile für Zeile, Einzahl und Niemandsland", async ({ page }) => {
    await page.route("**/api/route/landscapes", async (request) => {
        const response = await request.fetch();
        // Eine Absage wegen Last (503 `busy`) bleibt, wie sie ist: Der Planer fragt dann selbst noch einmal.
        if (!response.ok()) return request.fulfill({ response });
        const body = await response.json();
        body.territories = body.stages.map((_: unknown, index: number) =>
            index === 0
                ? [
                      { id: "a", name: "Reich A" },
                      { id: "b", name: "Provinz B" },
                  ]
                : index === 1
                  ? [{ id: "c", name: "Gebiet C" }]
                  : [],
        );
        await request.fulfill({ response, json: body });
    });
    await openRoute(page, "?route=Gareth~Perricum");
    await openStagePanel(page, 0);
    // Wenige Gebiete stehen offen da (unter fünf), lange Namen Zeile für Zeile.
    await expect(stageFieldValue(page, "territories")).toContainText("Reich A");
    await expect(stageFieldValue(page, "territories")).toContainText("Provinz B");
    await page.getByTestId("info-stage-next").click();
    await expect(page.getByTestId("info-title")).toHaveText(/^Etappe 2 von/);
    await expect(stageFieldValue(page, "territories")).toHaveText("Gebiet C");
    await page.getByTestId("info-stage-next").click();
    await expect(page.getByTestId("info-title")).toHaveText(/^Etappe 3 von/);
    await expect(stageFieldValue(page, "territories")).toHaveText("Niemandsland");
});

test("Eine fehlende Gebietsableitung wird nicht als Niemandsland ausgegeben", async ({ page }) => {
    await withLandscapes(page, (body) => {
        body["territories"] = null;
    });
    await openRoute(page, "?route=Gareth~Perricum");
    await openStagePanel(page, 0);
    await expect(stageField(page, "landscapes")).toBeVisible();
    await expect(stageField(page, "territories")).toHaveCount(0);
    await expect(page.getByTestId("info-facts")).not.toContainText("Niemandsland");
});

test("🔴 Fehlt eine der beiden Listen, nennt der Deckel nur die vorhandene; ohne beide gibt es keine Box (WI-0081)", async ({
    page,
}) => {
    // Nur Landschaften: die Gebietsableitung fehlt (ein Flug, eine sehr kurze Reise, ein unbekannter Gebietsstand).
    // Ohne Sprachen, damit der Deckel genau diesen Fall zeigt (mit Sprachen: siehe AREAS_LID_DE).
    await withLandscapes(page, (body) => {
        body["territories"] = null;
        delete body["sprachen"];
    });
    await openRoute(page, "?route=Gareth~Perricum");
    await expect(page.getByTestId("areas-toggle")).toHaveText(/^\d+ (?:Gegend|Gegenden)$/, {
        timeout: 15_000,
    });
    await expect(page.getByTestId("route-landscapes")).toHaveCount(1);
    await expect(page.getByTestId("route-territories")).toHaveCount(0);

    // Nur Gebiete: keine Landschaft trägt einen Namen, also nennt der Deckel allein die Gebiete.
    await withLandscapes(page, (body) => {
        body["regions"] = {};
        delete body["sprachen"];
    });
    await openRoute(page, "?route=Gareth~Perricum");
    await expect(page.getByTestId("areas-toggle")).toHaveText(/^\d+ (?:politisches Gebiet|politische Gebiete)$/, {
        timeout: 15_000,
    });
    await expect(page.getByTestId("route-territories")).toHaveCount(1);
    await expect(page.getByTestId("route-landscapes")).toHaveCount(0);

    // Keine von beiden: keine Box, und die übrigen Deckel bleiben. Gewartet wird auf die Antwort, sonst prüfte das
    // „keine Box“ nur, dass sie noch nicht da ist.
    // Auch ohne Sprachen: Eine Sprache allein füllte die Box (WI-0261 O8).
    await withLandscapes(page, (body) => {
        body["regions"] = {};
        body["territories"] = null;
        delete body["sprachen"];
    });
    const answered = page.waitForResponse((response) => response.url().endsWith("/api/route/landscapes"));
    await openRoute(page, "?route=Gareth~Perricum");
    await answered;
    await expect(page.getByTestId("costs-toggle")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("route-areas")).toHaveCount(0);
});

test("Territorienlinks zeigen und markieren das gewählte Gebiet in der politischen Karte", async ({ page }) => {
    const answer = page.waitForResponse(
        (response) => response.url().endsWith("/api/route/landscapes") && response.ok(),
    );
    await openRoute(page, "?route=Gareth~Perricum");
    const body = await (await answer).json();
    const territory = body.territories[0][0];
    // Die Liste der GANZEN Reise steht in der gemeinsamen Klappbox; ein Klick dort zeigt das Gebiet politisch.
    await page.getByTestId("areas-toggle").press("Enter");
    const link = page
        .getByTestId("route-territories")
        .getByRole("button", { name: territory.name, exact: true })
        .first();
    await expect(link).toBeVisible();
    await link.press("Space");
    await expect.poll(() => new URL(page.url()).hash).toContain("view=political");
    await expect
        .poll(() =>
            page.evaluate((id) => {
                const map = globalThis.avesmapsMap!;
                if (!map.getLayer("area-selection-fill")) return false;
                return map
                    .queryRenderedFeatures({ layers: ["area-selection-fill"] })
                    .some((feature) => feature.properties["territory_public_id"] === id);
            }, territory.id),
        )
        .toBe(true);
});

test("Aufklappen animiert beide Richtungen, verträgt Gegenklicks und respektiert reduzierte Bewegung", async ({
    page,
}) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openRoute(page, "?route=Gareth~Fasar");
    const box = page.getByTestId("route-areas");
    const summary = page.getByTestId("areas-toggle");
    const inset = await box.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const head = element.querySelector("summary")!.getBoundingClientRect();
        return { left: head.left - box.left, right: box.right - head.right, top: head.top - box.top };
    });
    expect(inset).toEqual({ left: 1, right: 1, top: 1 });
    // 🪤 Klick und `getAnimations()` müssen in EINEM `evaluate` liegen (die Fahrt ist kurz und unter Last vorbei, bevor
    // ein Poll kommt) - aber mit einem Tick dazwischen: `animate-height` startet die Animation erst nach Vues nächstem
    // Durchlauf. Ohne den Tick stand hier 0 statt 1, dauerhaft, auch seriell. Der zweite Teil dieses Falls (die
    // Mediengruppe, weiter unten) hat den Tick von Anfang an; nur diese Messung hatte ihn nicht.
    const openingAnimations = await summary.evaluate(async (element) => {
        (element as HTMLElement).click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        return element.closest("details")!.getAnimations().length;
    });
    expect(openingAnimations).toBe(1);
    await page.waitForTimeout(50);
    await summary.evaluate((element) => (element as HTMLElement).click());
    await expect(summary).toHaveAttribute("aria-expanded", "false");
    await expect.poll(() => box.evaluate((element) => (element as HTMLDetailsElement).open)).toBe(false);
    await expect.poll(() => box.evaluate((element) => element.getAnimations().length)).toBe(0);
    // Die Mediengruppe klappt mit derselben Rezeptur wie der Deckel (WI-0079 §7 P4, `animate-height`).
    // 🪤 Seit WI-0087 P4 ist die Vorgabe ZU: erst aufklappen, damit der folgende Klick wirklich zuklappt.
    await openStageGroups(page);
    const group = page.getByTestId("route-stage-group").first();
    const groupHead = group.getByRole("button").first();
    const groupAnimations = await groupHead.evaluate(async (element) => {
        (element as HTMLElement).click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        return element.closest("[data-testid=route-stage-group]")!.getAnimations().length;
    });
    expect(groupAnimations).toBe(1);
    await expect.poll(() => group.evaluate((element) => element.getAnimations().length)).toBe(0);
    await expect(groupHead).toHaveAttribute("aria-expanded", "false");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await summary.evaluate((element) => (element as HTMLElement).click());
    expect(await box.evaluate((element) => element.getAnimations().length)).toBe(0);
    await expect(summary).toHaveAttribute("aria-expanded", "true");
    await groupHead.click();
    expect(await group.evaluate((element) => element.getAnimations().length)).toBe(0);
    await expect(groupHead).toHaveAttribute("aria-expanded", "true");
});

test("Die Routenübersicht zählt Landschaften und nennt jedes politische Gebiet genau einmal", async ({ page }) => {
    const answer = page.waitForResponse(
        (response) => response.url().endsWith("/api/route/landscapes") && response.ok(),
    );
    await openRoute(page, "?route=Gareth~Perricum");
    const body = await (await answer).json();
    const unique = new Map<string, { id: string; name: string; parentId?: string | null }>();
    for (const stage of body.territories)
        for (const entry of stage) if (!unique.has(entry.id)) unique.set(entry.id, entry);
    const entries = [...unique.values()];
    const box = page.getByTestId("route-territories");
    await expect(box.getByRole("button").first()).not.toBeVisible();
    await page.getByTestId("areas-toggle").press("Enter");
    const names = await box.getByRole("button").allTextContents();
    expect(names.sort()).toEqual(entries.map((entry) => entry.name).sort());
    const hierarchy = await box.locator("li").evaluateAll((items) =>
        items.map((item) => ({
            id: (item as HTMLElement).dataset.territoryId!,
            indent: parseFloat(getComputedStyle(item).paddingInlineStart),
        })),
    );
    expect(entries.some((entry) => entry.parentId && unique.has(entry.parentId))).toBe(true);
    for (const entry of entries) {
        if (!entry.parentId || !unique.has(entry.parentId)) continue;
        const parentIndex = hierarchy.findIndex((row) => row.id === entry.parentId);
        const childIndex = hierarchy.findIndex((row) => row.id === entry.id);
        expect(parentIndex).toBeLessThan(childIndex);
        expect(hierarchy[childIndex]!.indent).toBeGreaterThan(hierarchy[parentIndex]!.indent);
    }
    const landscapes = page.getByTestId("route-landscapes");
    const landscapeCount = await landscapes.locator(":scope > button, :scope > span").count();
    // 🔴 EIN Deckel nennt beide Zahlen (WI-0081): zuerst die Landschaften, dann die Gebiete.
    // Berührt die Route Sprachflächen, nennt der Deckel sie und kürzt die Gebiete (WI-0261 O8).
    const sprachenCount = await page.getByTestId("route-sprache-swatch").count();
    await expect(page.getByTestId("areas-toggle")).toHaveText(
        sprachenCount === 0
            ? `${landscapeCount} Gegenden und ${entries.length} politische Gebiete`
            : `${landscapeCount} Gegenden, ${sprachenCount} ${sprachenCount === 1 ? "Sprache" : "Sprachen"} und ${entries.length} Gebiete`,
    );
    await box.getByRole("button").first().click();
    await expect.poll(() => new URL(page.url()).hash).toContain("view=political");
});
