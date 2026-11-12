import { expect, test, type Page } from "@playwright/test";
import { alignmentReport, costBoxProblems, nightLineReports } from "./cost-box.ts";
import { flushLeftShifts } from "./flush-left.ts";
import { expectTooltipLook } from "./map-tooltip-look.ts";

/**
 * Unterbringung und Reisekosten am echten Stack (WI-0042, WI-0065): Feld, Adresse und der Kasten „Reisekosten
 * je Person“. Die Beträge prüft `route-costs.test.ts` von Hand; hier zählt, dass alles zusammenspielt: dass der
 * Server rechnet und der Browser nur wählt, dass ein Wechsel der Unterbringung ohne neue Anfrage die Zahl ändert,
 * dass die Zölle aus den Herrschaftsgebieten stimmen und dass die Übertritte als Liste und als Marken erscheinen.
 *
 * Die Zahlen gelten für den Satz `map158230-eco106114-list20260930` mit den Herrschaftsgebieten `ca7f4157a0d5`
 * (Anzeigejahr 1049): Gareth → Perricum 0 Landesgrenzen, Gareth → Fasar 2, Perricum → Mengbilla 1 mit Hafenhinweis.
 */

async function openPlanner(page: Page, search: string): Promise<void> {
    await page.goto(`/${search}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(page.getByTestId("route-planner-tab")).toHaveAttribute("aria-expanded", "true");
    if (!search.includes("air=")) await page.getByTestId("costs-toggle").click();
}

/** Wie viele Übertrittsmarken die Karte gerade in ihrer Quelle hält (Anzeige, nicht Zustand im Speicher). */
async function borderMarks(page: Page): Promise<number> {
    return page.evaluate(() => {
        const map = globalThis.avesmapsMap as unknown as {
            querySourceFeatures(source: string): { properties: { order: number } }[];
        };
        // Eine Quelle meldet einen Punkt je Kachel, auf der er liegt: gezählt wird je Übertritt einmal.
        return new Set(map.querySourceFeatures("route-borders").map((feature) => feature.properties.order)).size;
    });
}

/** Wie viele dieser Marken die Karte tatsächlich zeichnet. */
async function drawnBorderMarks(page: Page): Promise<number> {
    return page.evaluate(() => {
        const map = globalThis.avesmapsMap;
        return map ? map.queryRenderedFeatures({ layers: ["route-border-body"] }).length : 0;
    });
}

async function cameraOf(page: Page): Promise<{ lng: number; lat: number; zoom: number }> {
    return page.evaluate(() => {
        const map = globalThis.avesmapsMap;
        if (!map) throw new Error("map handle missing");
        const center = map.getCenter();
        return { lng: center.lng, lat: center.lat, zoom: map.getZoom() };
    });
}

test("🔴 die Unterbringung ändert die Kosten, schreibt die Adresse und fragt den Server nicht", async ({ page }) => {
    await openPlanner(page, "?route=Gareth~Perricum");
    await expect(page.getByTestId("route-costs")).toContainText("Übernachtung");
    // Gareth → Perricum liegt ganz im Kaiserreich: 0 Landesgrenzen sind eine Antwort - „—“ und Legacys Vermerk, keine
    // Liste, und die Summe hat nichts mehr zu entschuldigen.
    await expect(page.getByTestId("cost-tolls")).toHaveText("—");
    await expect(page.getByTestId("route-costs")).toContainText("0 Landesgrenzen, als Söldner veranlagt");
    await expect(page.getByTestId("cost-total-note")).not.toContainText("ohne Zölle");
    await expect(page.getByTestId("route-borders")).toHaveCount(0);
    const before = await page.getByTestId("cost-total").textContent();

    await page.getByTestId("options-toggle").click();
    await expect(page.getByTestId("travel-lodging")).toHaveText("Gemeinschaftszimmer");
    let routeRequests = 0;
    page.on("request", (request) => {
        if (new URL(request.url()).pathname === "/api/route") routeRequests += 1;
    });
    await page.getByTestId("travel-lodging").getByRole("button").click();
    await page.getByRole("option", { name: "Einzelzimmer" }).click();

    await expect.poll(() => page.evaluate(() => globalThis.location.search)).toContain("lodging=zimmer");
    await expect(page.getByTestId("cost-total")).not.toHaveText(before ?? "");
    expect(routeRequests).toBe(0);
});

test("🔴 Gareth → Fasar im Einzelzimmer: 2 Landesgrenzen, 10 D Zoll, vom Server gerechnet; der geteilte Link öffnet dieselbe Zahl", async ({
    page,
}) => {
    await openPlanner(page, "?route=Gareth~Fasar&lodging=zimmer");
    await expect(page.getByTestId("cost-tolls")).toHaveText("10 D");
    await expect(page.getByTestId("route-costs")).toContainText("2 Landesgrenzen, als gutverdienender Beruf veranlagt");
    // Kein Hafenhinweis: Die Reise geht über Land.
    await expect(page.getByTestId("cost-tolls-extra")).toHaveCount(0);
    await page.getByTestId("options-toggle").click();
    await expect(page.getByTestId("travel-lodging")).toHaveText("Einzelzimmer");

    // Legacys wiederholtes `route` mit `lodging` öffnet dieselbe Unterbringung und dieselbe Zahl.
    await openPlanner(page, "?route=Gareth&route=Fasar&lodging=zimmer");
    await expect(page.getByTestId("cost-tolls")).toHaveText("10 D");

    // Die drei anderen Stufen von Hand: im Freien 2 H, Schlafsaal 10 H, Gemeinschaftszimmer 2 D.
    await openPlanner(page, "?route=Gareth~Fasar&lodging=frei");
    await expect(page.getByTestId("cost-tolls")).toHaveText("2 H");
    await expect(page.getByTestId("route-costs")).toContainText("2 Landesgrenzen, als Tagelöhner veranlagt");
    await openPlanner(page, "?route=Gareth~Fasar&lodging=strohsack");
    await expect(page.getByTestId("cost-tolls")).toHaveText("1 S");
    await openPlanner(page, "?route=Gareth~Fasar");
    await expect(page.getByTestId("cost-tolls")).toHaveText("2 D");
    await expect(page.getByTestId("route-costs")).toContainText("2 Landesgrenzen, als Söldner veranlagt");
});

test("🔴 die Liste der Übertritte klappt auf, das Häkchen legt Marken auf die Karte - ohne die Kamera zu bewegen", async ({
    page,
}) => {
    await openPlanner(page, "?route=Gareth~Fasar");
    const toggle = page.getByTestId("borders-toggle");
    await expect(toggle).toHaveText(/Grenzübertritte \(2\)/);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    const body = page.getByTestId("borders-list");
    await expect(body).not.toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(body).toBeVisible();
    const steps = page.getByTestId("border-step");
    await expect(steps).toHaveCount(2);
    // „Reich → Reich“ in Fahrtrichtung: von Gareth nach Süden.
    await expect(steps.nth(0)).toContainText("Kaiserreich");
    await expect(steps.nth(0)).toContainText("→");
    await expect(steps.nth(0)).toContainText("Aranien");
    await expect(steps.nth(1)).toContainText("Aranien");
    await expect(steps.nth(1)).toContainText("Kalifat");
    // Der volle Name steht als Hinweis daneben.
    await expect(steps.nth(0)).toHaveAttribute("title", /Kaiserreich.*→.*Aranien/);

    // Vorgabe aus: keine Marken.
    const show = page.getByTestId("borders-show");
    await expect(show).not.toBeChecked();
    expect(await borderMarks(page)).toBe(0);

    const cameraBefore = await cameraOf(page);
    await show.check();
    await expect.poll(() => borderMarks(page)).toBe(2);
    // Gezeichnet sind sie auch, im Bild der Route.
    await expect.poll(() => drawnBorderMarks(page)).toBeGreaterThanOrEqual(1);
    // 🔴 Über jeder Marke steht ihr Schild, ohne Zeigen (Betreiber 2026-10-03): „Reich → Reich“, darunter „Landesgrenze“.
    const labels = page.getByTestId("border-label");
    await expect(labels).toHaveCount(2);
    await expect(labels.nth(0)).toHaveText(/^Heiliges Neues Kaiserreich.* → Mhaharanyat Aranien\s*Landesgrenze$/);
    await expect(labels.nth(1)).toHaveText(/^Mhaharanyat Aranien → Kalifat\s*Landesgrenze$/);
    const placement = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const first = map
            .queryRenderedFeatures({ layers: ["route-border-rim"] })
            .find((feature) => feature.properties["order"] === 0);
        if (!first) throw new Error("Erster Grenzmarker fehlt im Ausschnitt");
        const coordinates = first.geometry.coordinates as [number, number];
        const point = map.project({ lng: coordinates[0], lat: coordinates[1] });
        const box = document.querySelector<HTMLElement>('[data-testid="map"]')!.getBoundingClientRect();
        const label = document.querySelector<HTMLElement>('[data-testid="border-label"]')!.getBoundingClientRect();
        return {
            x: box.left + point.x,
            y: box.top + point.y,
            center: label.left + label.width / 2,
            bottom: label.bottom,
            arrow: Number.parseFloat(
                getComputedStyle(document.documentElement).getPropertyValue("--avm-tooltip-arrow"),
            ),
        };
    });
    // Das Schild sitzt mittig über seiner Marke, die Pfeilspitze 10 px über ihrer Mitte (Legacy, Guide §15.3).
    expect(Math.abs(placement.center - placement.x)).toBeLessThan(2);
    expect(placement.arrow).toBe(15);
    expect(Math.abs(placement.bottom + placement.arrow - (placement.y - 10))).toBeLessThan(1.5);
    // Legacys Zettel, kleiner und mit größerer Spitze (Guide §15.3): dieselbe Prüfung für jedes Kartenschild.
    await expectTooltipLook(labels.first(), { meta: true });
    // 🔴 Im dunklen Thema kippt das Schild mit (Legacy: `--color-panel`), anders als die Karte darunter.
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    const dark = await labels.first().evaluate((element) => {
        const box = getComputedStyle(element);
        const arrow = getComputedStyle(element, "::after");
        return { ground: box.backgroundColor, ink: box.color, arrow: arrow.borderTopColor };
    });
    expect(dark).toEqual({ ground: "rgb(49, 46, 38)", ink: "rgb(238, 231, 218)", arrow: "rgb(49, 46, 38)" });
    await page.screenshot({ path: "../../review/tooltips/grenzschild-dunkel.png" });
    await page.evaluate(() => document.documentElement.removeAttribute("data-theme"));
    await page.screenshot({ path: "../../review/tooltips/grenzschild-hell.png" });
    // 🔴 Keine Kamerabewegung: Die Marken zeigen nur, sie fliegen nirgends hin.
    await page.waitForTimeout(600);
    const cameraAfter = await cameraOf(page);
    expect(cameraAfter.lng).toBeCloseTo(cameraBefore.lng, 6);
    expect(cameraAfter.lat).toBeCloseTo(cameraBefore.lat, 6);
    expect(cameraAfter.zoom).toBeCloseTo(cameraBefore.zoom, 6);
    // Weder Adresse noch Kurzlink tragen das Häkchen.
    expect(await page.evaluate(() => globalThis.location.search)).toBe("?route=Gareth~Fasar");

    // Ein Wechsel der Unterbringung ändert den Zoll, nicht die Marken.
    await page.getByTestId("options-toggle").click();
    await page.getByTestId("travel-lodging").getByRole("button").click();
    await page.getByRole("option", { name: "Einzelzimmer" }).click();
    await expect(page.getByTestId("cost-tolls")).toHaveText("10 D");
    expect(await borderMarks(page)).toBe(2);

    await show.uncheck();
    await expect.poll(() => borderMarks(page)).toBe(0);
    await expect(labels).toHaveCount(0);
});

interface BorderLabelState {
    dir: string;
    hidden: boolean;
    rect: { left: number; top: number; right: number; bottom: number };
    at: { x: number; y: number };
}

/** Seite, Sichtbarkeit, Rechteck und Punkt der Marke je Grenzschild, wie die Seite sie gerade zeigt. */
async function borderLabelLayout(page: Page): Promise<BorderLabelState[]> {
    return page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-testid="border-label"]')].map((label) => {
            const box = label.getBoundingClientRect();
            const point = label.parentElement!.getBoundingClientRect();
            return {
                dir: label.dataset["dir"] ?? "",
                hidden: label.hasAttribute("data-hidden"),
                rect: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
                at: { x: point.left, y: point.top },
            };
        }),
    );
}

/** Wie viele Paare sichtbarer Schilder einander überdecken (eine bloße Berührung zählt nicht). */
function overlappingPairs(layout: readonly BorderLabelState[]): number {
    const shown = layout.filter((entry) => !entry.hidden);
    let pairs = 0;
    for (let i = 0; i < shown.length; i++) {
        for (let j = i + 1; j < shown.length; j++) {
            const a = shown[i]!.rect;
            const b = shown[j]!.rect;
            if (
                Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
                Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
            )
                pairs++;
        }
    }
    return pairs;
}

test("🔴 dicht beieinander weichen die Schilder aus, und was nicht passt, bleibt weg (Betreiber 2026-10-03)", async ({
    page,
}) => {
    // Punin → Unterfels: viele Übertritte dicht entlang des Yaquir, wie in der Abnahme des Betreibers.
    await openPlanner(page, "?route=Punin~Unterfels");
    await page.getByTestId("borders-toggle").click();
    await page.getByTestId("borders-show").check();
    const labels = page.getByTestId("border-label");
    await expect.poll(() => labels.count()).toBeGreaterThanOrEqual(8);
    await expect.poll(() => page.evaluate(() => globalThis.avesmapsMap?.isMoving())).toBe(false);
    // Die Seiten sind gerechnet, sobald die Karte steht (nach dem Einpassen der Route).
    await page.waitForTimeout(400);
    const placed = await borderLabelLayout(page);
    // Jedes sichtbare Schild liegt auf der Seite seiner Marke, die es angibt.
    for (const entry of placed.filter((item) => !item.hidden)) {
        const { dir, rect, at } = entry;
        if (dir === "top") expect(rect.bottom).toBeLessThanOrEqual(at.y);
        else if (dir === "bottom") expect(rect.top).toBeGreaterThanOrEqual(at.y);
        else if (dir === "left") expect(rect.right).toBeLessThanOrEqual(at.x);
        else if (dir === "right") expect(rect.left).toBeGreaterThanOrEqual(at.x);
        else throw new Error(`unbekannte Seite: ${dir}`);
    }
    const shown = placed.filter((entry) => !entry.hidden);
    // Es werden mehrere Seiten benutzt, die meisten Schilder bleiben, und keines überdeckt ein anderes.
    expect(new Set(shown.map((entry) => entry.dir)).size).toBeGreaterThanOrEqual(2);
    expect(shown.length).toBeGreaterThanOrEqual(5);
    expect(overlappingPairs(placed)).toBe(0);
    // Regel A: Das erste Schild der Reise bleibt immer sichtbar.
    expect(placed[0]!.hidden).toBe(false);
    // Ein ausgeblendetes Schild ist unsichtbar und für Vorleser verborgen.
    const hidden = placed.filter((entry) => entry.hidden);
    if (hidden.length > 0) {
        await expect(page.locator('[data-testid="border-label"][data-hidden]').first()).toBeHidden();
        await expect(page.locator('[data-testid="border-label"][data-hidden]').first()).toHaveAttribute(
            "aria-hidden",
            "true",
        );
    }
    await page.screenshot({ path: "../../review/tooltips/grenzschilder-viele.png" });
});

test("🔴 die Schilder blenden kurz ein und aus: 140 ms ein, 110 ms aus, nur die Deckkraft (Betreiber 2026-10-03)", async ({
    page,
}) => {
    await openPlanner(page, "?route=Gareth~Fasar");
    await page.getByTestId("borders-toggle").click();
    await page.getByTestId("borders-show").check();
    const labels = page.getByTestId("border-label");
    await expect(labels).toHaveCount(2);
    const style = (state: "shown" | "hidden") =>
        page.evaluate((which) => {
            const label = document.querySelector<HTMLElement>('[data-testid="border-label"]')!;
            if (which === "hidden") label.setAttribute("data-hidden", "");
            const computed = getComputedStyle(label);
            const result = {
                property: computed.transitionProperty,
                duration: computed.transitionDuration,
                easing: computed.transitionTimingFunction,
                opacity: computed.opacity,
                animation: computed.animationName,
            };
            label.removeAttribute("data-hidden");
            return result;
        }, state);
    const shown = await style("shown");
    expect(shown.duration.split(",")[0]!.trim()).toBe("0.14s");
    expect(shown.property).toContain("opacity");
    // Beim Erscheinen läuft das Einblenden als Animation (kein Übergang von nirgendwo her).
    expect(shown.animation).not.toBe("none");
    expect(shown.easing.split(",")[0]!.trim()).toBe("ease");
    const hidden = await style("hidden");
    expect(hidden.duration.split(",")[0]!.trim()).toBe("0.11s");
    expect(hidden.animation).toBe("none");
    // Mit dem Häkchen gehen die Schilder: erst ausblenden, dann weg.
    await page.getByTestId("borders-show").uncheck();
    await expect(labels).toHaveCount(0);
    await expect.poll(() => page.locator(".map-tooltip").count()).toBe(0);
});

test("🔴 bei reduzierter Bewegung gibt es kein Ein- und Ausblenden: die Schilder sind sofort da und weg (§30.6)", async ({
    page,
}) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openPlanner(page, "?route=Gareth~Fasar");
    await page.getByTestId("borders-toggle").click();
    await page.getByTestId("borders-show").check();
    const labels = page.getByTestId("border-label");
    await expect(labels).toHaveCount(2);
    const motion = await page.evaluate(() => {
        const computed = getComputedStyle(document.querySelector<HTMLElement>('[data-testid="border-label"]')!);
        return { duration: computed.transitionDuration, animation: computed.animationName };
    });
    expect(motion).toEqual({ duration: "0s", animation: "none" });
    await page.getByTestId("borders-show").uncheck();
    // Kein Nachlauf: Das Schild steht nach dem Abhaken nicht mehr im Dokument.
    await expect.poll(() => page.locator(".map-tooltip").count(), { timeout: 100 }).toBe(0);
});

test("🔴 Ein umbrechender Übertritt steht linksbündig in der Liste, nicht mittig (Betreiber 2026-09-24)", async ({
    page,
}) => {
    // Die Übertritte sind echte <button> (`display: block`). Ein Knopf bringt vom Browser `text-align: center` mit;
    // erst `text-align: inherit` an `.stage__link` holt die Ausrichtung zurück. Ohne sie stünde ein langer Übertritt,
    // der umbricht, mittig in der Liste.
    await openPlanner(page, "?route=Gareth~Fasar");
    await page.getByTestId("borders-toggle").click();
    await expect(page.getByTestId("border-step")).toHaveCount(2);
    const steps = await flushLeftShifts(
        page,
        "[data-testid=borders-list]",
        "button",
        "Kaiserreich Garetien, Markgrafschaft Greifenfurt → Kalifat, Emirat Mherwed",
    );
    expect(steps).toHaveLength(2);
    for (const step of steps) {
        expect(step.lines, "der lange Übertritt bricht um").toBeGreaterThan(1);
        expect(step.shift, "jede Zeile steht, wo ein linksbündiger Satz sie hinstellt").toBeLessThanOrEqual(1);
    }
});

test("🔴 die Marken bleiben, wenn der Planer zugeht, und verschwinden mit einer neuen Route und beim Neuladen", async ({
    page,
}) => {
    await openPlanner(page, "?route=Gareth~Fasar");
    await page.getByTestId("borders-toggle").click();
    await page.getByTestId("borders-show").check();
    await expect.poll(() => borderMarks(page)).toBe(2);

    // Planer zu: Die Marken bleiben (WI-0065 Z3 C nennt Route, Neuladen und Häkchen, nicht den Planer; am Telefon
    // sieht man sie erst mit geschlossenem Planer, Betreiber 2026-10-03).
    await page.getByTestId("route-planner-tab").click();
    await expect(page.getByTestId("route-planner-tab")).toHaveAttribute("aria-expanded", "false");
    await page.waitForTimeout(500);
    expect(await borderMarks(page)).toBe(2);
    await expect(page.getByTestId("border-label")).toHaveCount(2);
    await page.getByTestId("route-planner-tab").click();
    await expect(page.getByTestId("route-planner-tab")).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("borders-show")).toBeChecked();

    // Eine neue Route (andere Optionen) beginnt wieder mit „aus“.
    await page.getByTestId("options-toggle").click();
    await page.getByTestId("hours-per-day").fill("10");
    await page.getByTestId("hours-per-day").blur();
    await expect.poll(() => borderMarks(page)).toBe(0);
    // Die Schilder gehen mit den Marken (Betreiber 2026-10-03: neu berechnet heißt Häkchen aus).
    await expect(page.getByTestId("border-label")).toHaveCount(0);
    if ((await page.getByTestId("costs-toggle").getAttribute("aria-expanded")) !== "true")
        await page.getByTestId("costs-toggle").click();
    await expect(page.getByTestId("cost-tolls")).toBeVisible();
    await expect(page.getByTestId("borders-show")).not.toBeChecked();

    // Neuladen: nichts hängt im Link.
    if ((await page.getByTestId("borders-toggle").getAttribute("aria-expanded")) !== "true")
        await page.getByTestId("borders-toggle").click();
    await page.getByTestId("borders-show").check();
    await expect.poll(() => borderMarks(page)).toBe(2);
    await page.reload();
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    if ((await page.getByTestId("costs-toggle").getAttribute("aria-expanded")) !== "true")
        await page.getByTestId("costs-toggle").click();
    await expect(page.getByTestId("cost-tolls")).toBeVisible();
    expect(await borderMarks(page)).toBe(0);
    await expect(page.getByTestId("border-label")).toHaveCount(0);
});

test("🔴 Perricum → Mengbilla: 1 Landesgrenze und der Hinweis „Hafenzoll nicht beziffert“ (Z1), ohne einen Betrag zu erfinden", async ({
    page,
}) => {
    await openPlanner(page, "?route=Perricum~Mengbilla");
    await expect(page.getByTestId("route-costs")).toContainText("1 Landesgrenze, als Söldner veranlagt");
    await expect(page.getByTestId("cost-tolls")).toHaveText("1 D");
    await expect(page.getByTestId("cost-tolls-extra")).toHaveText("Hafenzoll nicht beziffert");
});

test("im Flug gibt es keine Kosten: kein Kasten, keine Liste (Plan 6.37)", async ({ page }) => {
    await openPlanner(page, "?route=Gareth~Fasar&air=griffin");
    await expect(page.getByTestId("route-title")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("route-costs")).toHaveCount(0);
    await expect(page.getByTestId("route-borders")).toHaveCount(0);
});

test("die Sprache: englisch nach Legacys Wortlaut", async ({ page }) => {
    await openPlanner(page, "?route=Gareth~Fasar&lang=en");
    await expect(page.getByTestId("route-costs")).toContainText("2 national borders, assessed as mercenaries");
    await expect(page.getByTestId("borders-toggle")).toHaveText(/Border crossings \(2\)/);
});

for (const scheme of ["light", "dark"] as const) {
    test(`🔴 die Herleitung bricht nie mitten im Wort um: ${scheme}, mit den langen Zollvermerken (Betreiber 2026-09-30)`, async ({
        page,
    }) => {
        await page.emulateMedia({ colorScheme: scheme });
        // „N × im Gemeinschaftszimmer“ und „1 Landesgrenze, als Söldner veranlagt“. Die Zahl der Nächte gehört den Daten, nicht
        // diesem Test: Auf Satz 179380 (Wegezug 2026-10-10) sind es vier statt einer, auch mit dem Code vom 2026-10-04.
        await openPlanner(page, "?route=Pildek~Estoria");
        await expect(page.getByTestId("route-costs")).toContainText(/\d+ × im Gemeinschaftszimmer/u);
        await expect(page.getByTestId("route-costs")).toContainText("1 Landesgrenze, als Söldner veranlagt");
        expect(await costBoxProblems(page)).toEqual({ broken: [], overflows: false });

        // Der längste Vermerk: „als gutverdienender Beruf veranlagt“, dazu große Beträge.
        await openPlanner(page, "?route=Gareth~Fasar&lodging=zimmer");
        await expect(page.getByTestId("route-costs")).toContainText("als gutverdienender Beruf veranlagt");
        expect(await costBoxProblems(page)).toEqual({ broken: [], overflows: false });

        // Mit dem Hafenhinweis.
        await openPlanner(page, "?route=Perricum~Mengbilla&lodging=zimmer");
        await expect(page.getByTestId("cost-tolls-extra")).toHaveText("Hafenzoll nicht beziffert");
        expect(await costBoxProblems(page)).toEqual({ broken: [], overflows: false });

        // Mit Nächten im Freien, den Fußnoten und ihrem Betrag in der Unterzeile (Betreiber 2026-10-04).
        await openPlanner(page, EDITORS_ROUTE);
        await expect(page.getByTestId("cost-footnotes")).toBeVisible();
        expect(await costBoxProblems(page)).toEqual({ broken: [], overflows: false });
    });
}

test("Ein Grenzübertritt aktiviert die Marken und führt zur gewählten Stelle", async ({ page }) => {
    await openPlanner(page, "?route=Gareth~Fasar");
    await page.getByTestId("borders-toggle").click();
    const before = await cameraOf(page);
    let requests = 0;
    page.on("request", (request) => {
        if (request.url().includes("/api/route?")) requests += 1;
    });
    await page.getByTestId("border-step").first().getByRole("button").click();
    await expect(page.getByTestId("borders-show")).toBeChecked();
    await expect.poll(() => page.evaluate(() => globalThis.avesmapsMap?.isMoving())).toBe(false);
    const after = await cameraOf(page);
    expect(after.zoom).toBeCloseTo(8, 6);
    expect(Math.abs(after.lng - before.lng) + Math.abs(after.lat - before.lat)).toBeGreaterThan(0.001);
    const marker = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const first = map
            .queryRenderedFeatures({ layers: ["route-border-body"] })
            .find((feature) => feature.properties["order"] === 0);
        if (!first) throw new Error("Gewählter Grenzmarker fehlt im Ausschnitt");
        const coordinates = first.geometry.coordinates as [number, number];
        return map.project({ lng: coordinates[0], lat: coordinates[1] });
    });
    expect(marker.x).toBeGreaterThan(360);
    await expect(page.getByTestId("border-label").first()).toContainText("Aranien");
    expect(requests).toBe(0);
});

/**
 * Die Frage der Editoren (Betreiber 2026-10-04): „bei übernachtung "20 Nächte" dransteht, aber nur 8x für ein
 * gemeineschaftszimmer bezahlt werden muss“. Leichtreiter, Galeere, Firun: acht Nächte im Gasthaus, zwölf im Freien.
 */
const EDITORS_ROUTE = "?route=Wargentrutz~@478.44,610.97&landTransport=lightRider&seaTransport=galley&startMonth=firun";

test("🔴 Übernachtung: eine Unterzeile je Dach, der Betrag einmal, die Hinweise als Fußnoten unten (Betreiber 2026-10-04)", async ({
    page,
}) => {
    const response = page.waitForResponse((r) => r.url().includes("/api/route?") && r.status() === 200);
    await openPlanner(page, EDITORS_ROUTE);
    const route = await (await response).json();
    const nights = route.travel_costs.by_lodging.bett.nights as { inn: number; open: number; aboard: number };
    // Gemischt, sonst prüfte der Test nichts: Nächte unter Dach UND im Freien.
    expect(nights.inn).toBeGreaterThan(0);
    expect(nights.open).toBeGreaterThan(0);
    const aboard = nights.aboard > 0;

    const lines = page.getByTestId("cost-night");
    await expect(lines).toHaveCount(aboard ? 3 : 2);
    // 🔴 Die Unterzeile läuft nie über (Betreiber 2026-10-04: „bricht nicht um“): Was nicht in eine Zeile passt, bricht nach dem
    // Doppelpunkt, der Betrag samt Fußnotenzahl bleibt zusammen und nichts ragt über die Wertspalte, links wie rechts.
    for (const report of await nightLineReports(page)) {
        expect(report.overflowRight, `${report.text}: rechts`).toBeLessThanOrEqual(0.5);
        expect(report.overflowLeft, `${report.text}: links`).toBeLessThanOrEqual(0.5);
        expect(report.scrolls, `${report.text}: rollt`).toBe(false);
        expect(report.keepOnOneLine ?? true, `${report.text}: Betrag und Nummer zusammen`).toBe(true);
        expect(report.breaksAfterColon ?? true, `${report.text}: Umbruch nach dem Doppelpunkt`).toBe(true);
    }
    // „8 × im Gemeinschaftszimmer: 4 S 8 H ¹“ - der Betrag steht hier und sonst nirgends in der Übernachtung.
    await expect(lines.nth(0)).toContainText(`${String(nights.inn)} × im Gemeinschaftszimmer: `);
    await expect(lines.nth(0).locator(".costs__night-amount")).toHaveText(/^\d+ [DSH](?: \d+ [DSH])*$/);
    await expect(lines.nth(0).getByTestId("cost-fn-ref")).toHaveAttribute("data-fn", "1");
    // „12 × im Freien ²“ - ohne Betrag, mit dem Grund als Fußnote.
    await expect(lines.nth(1)).toContainText(`${String(nights.open)} × im Freien`);
    await expect(lines.nth(1).locator(".costs__night-amount")).toHaveCount(0);
    await expect(lines.nth(1).getByTestId("cost-fn-ref")).toHaveAttribute("data-fn", "2");
    await expect(page.getByTestId("cost-lodging").locator(".costs__night-amount")).toHaveCount(1);
    // Die alte Klammer mit der Summe aller Nächte und der Grundsatz zwischen den Zeilen sind weg.
    await expect(page.getByTestId("cost-lodging")).not.toContainText("(");
    await expect(page.getByTestId("cost-lodging-extra")).toHaveCount(0);

    // Die Nummern in der Reihenfolge des ersten Auftretens; die Quelle der Preise bleibt an Gasthaus, Verpflegung und
    // Reittier dieselbe 1, die Geographia kommt an die Zölle.
    const geographia = aboard ? 4 : 3;
    const expected = [1, 2, ...(aboard ? [3] : []), 1, 1, geographia].map(String);
    const refs = page.getByTestId("route-costs").getByTestId("cost-fn-ref");
    expect(await refs.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-fn")))).toEqual(
        expected,
    );

    // Unten die Fußnoten, nur die zu gezeigten Zeilen, im Wortlaut des Betreibers; ein Satz unter dem Kasten ist es nicht mehr.
    const notes = page.getByTestId("cost-footnote");
    await expect(notes).toHaveText([
        /Fußnote 1: Bett, Verpflegung und Futter aus dem DSA5-Regelwerk und dem Kodex der Helden\. 1 Dukat = 10 Silbertaler = 100 Heller\.$/,
        /Fußnote 2: Im Freien schläft, wer den Reisetag auf Pfad, Pass, Wüstenpfad oder querfeldein beendet\.$/,
        ...(aboard
            ? [
                  /Fußnote 3: An Bord schläft, wer den Reisetag auf Fluss oder See beendet; die Koje steckt in der Passage\.$/,
              ]
            : []),
        new RegExp(`Fußnote ${String(geographia)}: Zölle und Passagen nach der Geographia Aventurica\\.$`),
    ]);
    await expect(page.getByTestId("route-costs")).not.toContainText(
        "Zölle und Passage nach der Geographia Aventurica. Bett",
    );

    // Reittier und Verpflegung hängen an der Quelle, ihre Zahl ist die der Gasthausnächte.
    await expect(page.getByTestId("route-costs")).toContainText(
        `${String(nights.inn)} × Stall mit Futter (Gasthausnächte)`,
    );
    // Die Summe nennt alle Nächte.
    await expect(page.getByTestId("cost-total-note")).toContainText(
        `${String(nights.inn + nights.open + nights.aboard)} Nächte`,
    );
    // Die Nächte stehen nicht im Deckel (Betreiber 2026-10-03).
    await expect(page.getByTestId("costs-toggle")).not.toContainText("Gasthaus");
});

/**
 * 🔴 Eine Regel für jeden Betrag im Kasten (Betreiber 2026-10-04: „in der titeleiste sind text und zahlen, aber nicht die
 * einheiten hevorgehoben. bei übernachtung sind zahlen und einheiten hervorgehoben“): Die Zahl ist hervorgehoben, die
 * Einheit D/S/H gedämpft - in der Übernachtung, den Zeilenwerten und der Summe in derselben Farbe wie in der Kopfzeile
 * des Deckels (Design Guide §16.3).
 */
for (const scheme of ["light", "dark"] as const) {
    test(`🔴 jeder Betrag im Kasten: Zahl hervorgehoben, Einheit gedämpft - wie in der Titelleiste: ${scheme}`, async ({
        page,
    }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await openPlanner(page, EDITORS_ROUTE);
        await expect(page.getByTestId("cost-footnotes")).toBeVisible();
        const style = await page.evaluate(() => {
            const colour = (element: Element | null | undefined): string | null =>
                element ? getComputedStyle(element).color : null;
            const head = document.querySelector('[data-testid="costs-toggle"] .disclosure__secondary');
            const unique = (selector: string): string[] => [
                ...new Set(
                    [...document.querySelectorAll(`[data-testid="route-costs"] ${selector}`)].map(
                        (element) => colour(element) ?? "",
                    ),
                ),
            ];
            return {
                headNumber: colour(head?.querySelector(".wert__zahl")),
                headUnit: colour(head),
                boxNumbers: unique(".wert__zahl"),
                boxUnits: unique(".wert__einheit"),
                amounts: document.querySelectorAll('[data-testid="route-costs"] .wert').length,
                totals: document.querySelectorAll('[data-testid="cost-total"] .wert__zahl').length,
            };
        });
        expect(style.headNumber).not.toBe(style.headUnit);
        // Alle Zahlen im Kasten haben die Farbe der Zahlen der Titelleiste, alle Einheiten die ihrer Einheiten.
        expect(style.boxNumbers).toEqual([style.headNumber]);
        expect(style.boxUnits).toEqual([style.headUnit]);
        // Übernachtung, Verpflegung, Reittier, Zölle und Summe: Es gibt Beträge, auch in der Summe.
        expect(style.amounts).toBeGreaterThanOrEqual(5);
        expect(style.totals).toBeGreaterThan(0);
    });
}

/**
 * 🔴 Die Fußnoten (Betreiber 2026-10-04: „den text einheitlich einrücken und ein bisschen abstand zwischen den fussnoten“,
 * „fußnotenzahle (und fußnoten) hell machen wie die andern zahlen“): Die Nummer steht in einer festen Spalte, der Text beginnt
 * in jeder Fußnote an derselben Stelle und jede Folgezeile bündig unter dem ersten Wort; zwischen den Fußnoten ist Abstand; die
 * Nummern - an den Werten und in der Liste - haben die Farbe der Zahlen der Beträge, der Text bleibt gedämpft.
 */
for (const scheme of ["light", "dark"] as const) {
    test(`🔴 Fußnoten: hängender Einzug, Abstand dazwischen, Nummern hell wie die Zahlen der Beträge: ${scheme}`, async ({
        page,
    }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await openPlanner(page, EDITORS_ROUTE);
        await expect(page.getByTestId("cost-footnotes")).toBeVisible();
        const look = await page.evaluate(() => {
            const items = [...document.querySelectorAll<HTMLElement>('[data-testid="cost-footnote"]')];
            const colour = (element: Element | null | undefined): string | null =>
                element ? getComputedStyle(element).color : null;
            const range = document.createRange();
            /**
             * Der linke Rand JEDER SICHTBAREN ZEILE des Fußnotentextes.
             *
             * 💣 Hier stand „der linke Rand jedes Kastens“, und das ist nicht dasselbe. `getClientRects()` liefert einen
             * Kasten je Textfragment, nicht je Zeile - gemessen am 2026-10-06 zerfiel Fußnote 1 in fünf Kästen: die
             * unsichtbare Vorlesefassung („Fußnote 1: “, 1 px weiter links), Zeile 1 mit 240 px Breite, ein 4 px
             * breiter REST derselben Zeile bei x+241, dann Zeile 2 und Zeile 3. Der Rest mitten in der Zeile galt als
             * Zeilenanfang, und der Fall meldete hell und dunkel „241 px“ Versatz, während nichts verrutscht war.
             *
             * 🔴 Die Schranke bleibt 1 px. Nur die Frage ist jetzt die gemeinte: Beginnt jede Zeile bündig?
             */
            const lineStarts = (element: HTMLElement): number[] => {
                range.selectNodeContents(element);
                // Die Vorlesefassung der Fußnotenzahl steht für Lesegeräte da und ist nicht gesetzter Text.
                const sr = element.querySelector(".footnotes__sr");
                if (sr !== null) range.setStartAfter(sr);
                const lines: { top: number; left: number }[] = [];
                for (const rect of [...range.getClientRects()]
                    .filter((rect) => rect.width > 1)
                    .sort((a, b) => a.top - b.top)) {
                    // Dieselbe Zeile, wenn die Oberkanten näher liegen als eine halbe Zeilenhöhe.
                    const last = lines.at(-1);
                    if (last !== undefined && Math.abs(rect.top - last.top) <= 6) {
                        last.left = Math.min(last.left, rect.left);
                    } else {
                        lines.push({ top: rect.top, left: rect.left });
                    }
                }
                return [...new Set(lines.map((line) => Math.round(line.left)))];
            };
            return {
                count: items.length,
                numberLefts: [
                    ...new Set(items.map((item) => Math.round(item.children[0]!.getBoundingClientRect().left))),
                ],
                textLefts: [
                    ...new Set(items.map((item) => Math.round(item.children[1]!.getBoundingClientRect().left))),
                ],
                // Jede Zeile jedes Textes beginnt am Anfang der Textspalte, auch die zweite und dritte.
                lineStarts: [...new Set(items.flatMap((item) => lineStarts(item.children[1] as HTMLElement)))],
                wrapped: items.some((item) => item.children[1]!.getBoundingClientRect().height > 20),
                gaps: items
                    .slice(1)
                    .map((item, index) =>
                        Math.round(item.getBoundingClientRect().top - items[index]!.getBoundingClientRect().bottom),
                    ),
                amountNumber: colour(document.querySelector('[data-testid="route-costs"] .wert__zahl')),
                unit: colour(document.querySelector('[data-testid="route-costs"] .wert__einheit')),
                listNumbers: [...new Set(items.map((item) => colour(item.children[0])))],
                refs: [
                    ...new Set([...document.querySelectorAll('[data-testid="cost-fn-ref"]')].map((ref) => colour(ref))),
                ],
                texts: [...new Set(items.map((item) => colour(item.children[1])))],
            };
        });
        expect(look.count).toBeGreaterThanOrEqual(3);
        // Eine Spalte für die Nummern, eine für den Text; mindestens eine Fußnote bricht um (sonst prüfte der Einzug nichts).
        expect(look.numberLefts).toHaveLength(1);
        expect(look.textLefts).toHaveLength(1);
        expect(look.wrapped).toBe(true);
        // (±1 px: Der erste Buchstabe trägt je nach Form einen Seitenabstand.)
        const starts = look.lineStarts;
        expect(
            Math.max(...starts) - Math.min(...starts),
            "jede Zeile beginnt bündig unter dem ersten Wort",
        ).toBeLessThanOrEqual(1);
        expect(Math.abs(Math.min(...starts) - look.textLefts[0]!)).toBeLessThanOrEqual(1);
        // Zwischen den Fußnoten steht Abstand (der kleinste des Kanons, 4 px).
        for (const gap of look.gaps) expect(gap).toBeGreaterThanOrEqual(3);
        // Die Nummern haben die Farbe der hervorgehobenen Zahlen, der Text die gedämpfte der Einheiten.
        expect(look.listNumbers).toEqual([look.amountNumber]);
        expect(look.refs).toEqual([look.amountNumber]);
        expect(look.texts).toEqual([look.unit]);
        expect(look.amountNumber).not.toBe(look.unit);
    });
}

/**
 * 🔴 Die linke Kante der Zeilenbeschriftungen und der Fußnoten fluchtet mit dem Text der Kopfzeile „Reisekosten je Person“
 * (Betreiber 2026-10-04: „jetzt hast du bei denn tabelle in den klappboxen zuviel weggenommen. schau dass es mit dem header
 * aligned“). Gemessen am ersten sichtbaren Text je Zeile, nicht an der Kiste; dazu jede andere Klappbox des Planers, die mit
 * Text beginnt: Schifffahrtshinweise sowie Landschaften und Gebiete teilen das Polster des Deckels.
 */
test("🔴 Klappboxen: Zeilenbeschriftungen und Fußnoten fluchten mit dem Text der Kopfzeile (Betreiber 2026-10-04)", async ({
    page,
}) => {
    await openPlanner(page, EDITORS_ROUTE);
    await expect(page.getByTestId("areas-toggle")).toBeVisible({ timeout: 20_000 });
    // „Unterwegs gibt es:“ (WI-0257 S4) kommt mit der eigenen Frage nach den Landschaften; wo es die Box gibt, steht sie unter derselben Regel.
    await page
        .getByTestId("unterwegs-toggle")
        .waitFor({ state: "visible", timeout: 20_000 })
        .catch(() => undefined);
    for (const testid of ["ships-toggle", "areas-toggle", "unterwegs-toggle"]) {
        const toggle = page.getByTestId(testid);
        if ((await toggle.count()) > 0) await toggle.click();
    }
    await page.waitForTimeout(400);
    const report = await alignmentReport(page);
    expect(report.head).not.toBeNaN();
    // Mindestens vier Beschriftungen und drei Fußnoten, sonst prüfte der Test nichts.
    expect(report.labels.length).toBeGreaterThanOrEqual(4);
    expect(report.footnotes.length).toBeGreaterThanOrEqual(3);
    // Auf einen Pixel genau: dieselbe linke Kante wie der Titel der Kopfzeile.
    for (const left of report.labels)
        expect(Math.abs(left - report.head), `Beschriftung bei ${String(left)}`).toBeLessThanOrEqual(1);
    for (const left of report.footnotes)
        expect(Math.abs(left - report.head), `Fußnote bei ${String(left)}`).toBeLessThanOrEqual(1);
    // Die übrigen Klappboxen mit Text am Rand (Landschaften, Gebiete, Schifffahrtshinweise) tun dasselbe.
    expect(report.others.length).toBeGreaterThan(0);
    for (const other of report.others) {
        expect(Math.abs(other.content - other.head), other.box).toBeLessThanOrEqual(1);
    }
});
