import { expect, test, type Page } from "@playwright/test";
import { openMap } from "./map-handle.ts";
import { showStages } from "./stage-groups.ts";
import { openStageGroups } from "./stage-groups.ts";

/**
 * Das Infopanel, Paket P7 (WI-0063 „Subject-Typen und Routing“), am echten Stack: „Weg als Route“ (B12), die Pfeile der Etappe (E13),
 * die Anspruchsteller und das Klima eines Gebiets, „In der Nähe“ einer Kartenstelle und die Gestalt einer Kraftlinie. Was das Modell
 * daraus macht, prüfen `test/panel-model.test.ts` und `test/panel-actions.test.ts`; die Rechnung des Servers `subjects-p7.test.ts`.
 *
 * Die Fälle stehen im Satz der Entwicklungsdatenbank (Satz 161832): die Herzogstraße (drei Orte), die Basiliuslinie (vier Enden,
 * vierzehn Segmente), das Heilige Neue Kaiserreich (zwei Anspruchsteller) und eine Kartenstelle bei Gareth.
 */

const KAISERREICH = "3359118f-bdfe-4569-8277-3f25c2d62463";
const BASILIUS = "01708433-9c43-45be-af68-4c408a5e84f7";

const subject = (page: Page): Promise<{ kind: string; id?: string; index?: number } | undefined> =>
    page.evaluate(() => globalThis.avesmapsSelectedSubject?.());

/** Öffnet ein Subject über die Öffnungsnaht und wartet, bis das Panel seinen Namen trägt. */
async function open(page: Page, ref: Record<string, unknown>, title: string | RegExp): Promise<void> {
    await openMap(page);
    await page.evaluate((target) => globalThis.avesmapsOpenSubject?.(target), ref);
    await expect(page.getByTestId("info-title")).toHaveText(title, { timeout: 20_000 });
}

const labelsOf = (page: Page): Promise<string[]> => page.getByTestId("info-fact-label").allTextContents();

test.describe("Weg als Route (B12)", () => {
    // 🪤 Die Misamunder Straße, an der dieser Fall bis 2026-10-29 hing, taugt nicht mehr: Im Bestand endet ihr Weg nicht mehr in Vallusa
    // (Wegende gewandert), die Orte der Straße sind fünf statt sechs, und ohne zwei benannte offene Enden hat sie keine Markierungszeile.
    // Die Herzogstraße hat ein Wiki, drei Orte in Reihenfolge und ein „Von – Bis“. Die Namen sind Träger; was der Server für die Straße
    // nennt (`routePlaces`, `stretch`), ist die Erwartung - das Panel und der Planer müssen genau das zeigen.
    const ROAD = { kind: "path", chain: "Herzogstraße:Strasse" };
    const ROAD_TITLE = "Herzogstraße";

    async function roadAnswer(page: Page): Promise<{ places: string[]; from: string; to: string }> {
        const response = await page.request.get(`/api/subjects/path/${encodeURIComponent(ROAD.chain)}`);
        expect(response.ok(), "Voraussetzung: der Lesepfad kennt die Straße").toBe(true);
        const body = (await response.json()) as {
            routePlaces?: { name: string }[];
            stretch?: { from: string; to: string };
        };
        const places = (body.routePlaces ?? []).map((place) => place.name);
        expect(
            places.length,
            "Voraussetzung: die Straße nennt mindestens drei Orte in Reihenfolge",
        ).toBeGreaterThanOrEqual(3);
        expect(
            body.stretch,
            "Voraussetzung: die Straße hat ein „Von – Bis“ (zwei benannte offene Enden)",
        ).toBeDefined();
        return { places, from: body.stretch?.from ?? "", to: body.stretch?.to ?? "" };
    }

    test("🔴 die Kachel steht als vierte im Band, mit der Ziel-Nadel; die Markierungszeile nennt „Ganze Straße: Von – Bis“", async ({
        page,
    }) => {
        const road = await roadAnswer(page);
        await open(page, ROAD, ROAD_TITLE);
        const tiles = page.getByTestId("info-actions").locator("button");
        await expect(tiles).toHaveCount(4);
        await expect(tiles.nth(3)).toHaveAttribute("data-testid", "info-action-pathAsRoute");
        await expect(tiles.nth(3)).toContainText("Weg als Route");
        await expect(tiles.nth(3)).toBeEnabled();
        // Die Ziel-Nadel ist ein Bild, nicht umgefärbt und nicht gedimmt.
        const icon = tiles.nth(3).locator("img");
        await expect(icon).toHaveAttribute("src", "/icons/menu/waypoint-end.webp");
        await expect
            .poll(() => icon.evaluate((element) => (element as HTMLImageElement).naturalWidth))
            .toBeGreaterThan(0);
        await expect(page.getByTestId("info-note")).toHaveText(`Ganze Straße: ${road.from} – ${road.to}`);
    });

    test("🔴 ein Klick ersetzt die Wegpunkte des Planers durch die Orte der Straße in Reihenfolge und rechnet die Reise", async ({
        page,
    }) => {
        const road = await roadAnswer(page);
        // Eine bestehende Reise, die verschwinden muss.
        await page.goto("/?route=Gareth~Perricum");
        await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, {
            timeout: 30_000,
        });
        await showStages(page, 20_000);
        await page.evaluate((target) => globalThis.avesmapsOpenSubject?.(target), ROAD);
        await expect(page.getByTestId("info-title")).toHaveText(ROAD_TITLE, { timeout: 20_000 });
        await page.getByTestId("info-action-pathAsRoute").click();

        await showStages(page, 20_000);
        // Genau die Orte der Straße, in der Reihenfolge des Servers; Gareth und Perricum sind weg.
        await expect
            .poll(() => page.evaluate(() => new URLSearchParams(globalThis.location.search).get("route")))
            .toBe(road.places.join("~"));
        await expect(page.getByTestId("route-planner")).toHaveClass(/is-open/);
        await expect(page.getByTestId("waypoints")).toBeVisible();
        // Die Zeilen des Planers tragen die Orte als Wert ihrer Felder.
        const fields = page.getByTestId("waypoints").locator("input");
        await expect
            .poll(() => fields.evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value)))
            .toEqual(road.places);
    });

    test("🔴 nur im vollständigen Weg-Panel: Ort, Fläche und Fluss ohne Artikel tragen die Kachel nicht", async ({
        page,
    }) => {
        await open(page, { kind: "place", id: "80558060-4299-54aa-b520-814b10819885" }, "Gareth");
        await expect(page.getByTestId("info-action-pathAsRoute")).toHaveCount(0);
        // Eine Straße ohne Wiki-Artikel hat keine Kachel (die Anzeigen-Kachel allein trägt der Server dort nicht an).
        await page.evaluate(() => globalThis.avesmapsOpenSubject?.({ kind: "path", chain: "Gardel:Flussweg" }));
        await expect(page.getByTestId("info-title")).toHaveText("Gardel", { timeout: 20_000 });
        await expect(page.getByTestId("info-action-pathAsRoute")).toHaveCount(0);
    });
});

test.describe("Etappen-Navigation (E13)", () => {
    /** Drückt den Pfeil und zeichnet die Kamera Bild für Bild auf: Ein Sprung wäre EIN Bild, ein Flug sind viele. */
    function pressAndRecord(
        page: Page,
        testid: string,
        duration = 1200,
    ): Promise<{ lng: number; lat: number; zoom: number }[]> {
        return page.evaluate(
            ([id, span]) =>
                new Promise<{ lng: number; lat: number; zoom: number }[]>((resolve) => {
                    const map = globalThis.avesmapsMap!;
                    const press = document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
                    const seen: { lng: number; lat: number; zoom: number }[] = [];
                    let start: number | undefined;
                    press.click();
                    const frame = (time: number): void => {
                        start ??= time;
                        const { lng, lat } = map.getCenter();
                        seen.push({ lng, lat, zoom: map.getZoom() });
                        if (time - start < span) requestAnimationFrame(frame);
                        else resolve(seen);
                    };
                    requestAnimationFrame(frame);
                }),
            [testid, duration] as const,
        );
    }

    async function openFirstStage(page: Page): Promise<void> {
        await page.goto("/?route=Gareth~Perricum");
        await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, {
            timeout: 30_000,
        });
        await openStageGroups(page);
        const rows = page.getByTestId("route-stage");
        await expect(rows.first()).toBeVisible({ timeout: 20_000 });
        // 🪤 Auf das BILD der Zeile: Ihre Mitte trägt seit WI-0087 P1 den Wegnamen, und der ist ein eigener Link.
        await rows.first().locator("img").first().click();
        await expect(page.getByTestId("info-title")).toHaveText(/^Etappe 1 von \d+$/);
        // Die Kamera des ersten Klicks ist angekommen, ehe die Pfeile gemessen werden.
        await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 15_000 });
    }

    test("🔴 „Etappe n von m“ mit ‹ ›: an der ersten Etappe ist ‹ gesperrt, › wählt die nächste - gold im Planer, das Panel folgt", async ({
        page,
    }) => {
        await openFirstStage(page);
        const prev = page.getByTestId("info-stage-prev");
        const next = page.getByTestId("info-stage-next");
        await expect(page.getByTestId("info-stage-nav")).toBeVisible();
        await expect(prev).toBeDisabled();
        await expect(next).toBeEnabled();
        // Gesperrt heißt eine gedämpfte Fläche und `not-allowed`, nie Deckkraft (Guide §30.2, §30.5).
        const locked = await prev.evaluate((element) => {
            const style = getComputedStyle(element);
            return { opacity: style.opacity, cursor: style.cursor, background: style.backgroundColor };
        });
        expect(locked.opacity).toBe("1");
        expect(locked.cursor).toBe("not-allowed");
        expect(locked.background).not.toBe(await next.evaluate((element) => getComputedStyle(element).backgroundColor));

        await next.click();
        await expect(page.getByTestId("info-title")).toHaveText(/^Etappe 2 von \d+$/);
        await expect(page.getByTestId("route-stage").nth(1)).toHaveClass(/is-active/);
        await expect(page.getByTestId("route-stage").first()).not.toHaveClass(/is-active/);
        expect(await subject(page)).toMatchObject({ kind: "routeStage", index: 1 });
        await expect(prev).toBeEnabled();

        await prev.click();
        await expect(page.getByTestId("info-title")).toHaveText(/^Etappe 1 von \d+$/);
        await expect(page.getByTestId("route-stage").first()).toHaveClass(/is-active/);
        expect(await subject(page)).toMatchObject({ kind: "routeStage", index: 0 });
    });

    test("🔴 an der letzten Etappe ist › gesperrt; ein weiterer Druck geschieht nicht", async ({ page }) => {
        await openFirstStage(page);
        const count = Number((await page.getByTestId("info-title").textContent())?.match(/von (\d+)/)?.[1]);
        expect(count).toBeGreaterThan(2);
        const next = page.getByTestId("info-stage-next");
        for (let step = 1; step < count; step += 1) {
            await expect(next).toBeEnabled();
            await next.click();
            await expect(page.getByTestId("info-title")).toHaveText(`Etappe ${String(step + 1)} von ${String(count)}`);
        }
        await expect(next).toBeDisabled();
        await expect(page.getByTestId("info-stage-prev")).toBeEnabled();
        expect(await subject(page)).toMatchObject({ kind: "routeStage", index: count - 1 });
    });

    test("🔴 die Kamera FLIEGT zur nächsten Etappe - nie ein Sprung (Betreiber 2026-09-29)", async ({ page }) => {
        await openFirstStage(page);
        const frames = await pressAndRecord(page, "info-stage-next");
        const first = frames[0]!;
        const last = frames[frames.length - 1]!;
        const total = Math.hypot(last.lng - first.lng, last.lat - first.lat);
        expect(total, "die Karte zeigt jetzt eine andere Stelle").toBeGreaterThan(0);
        // Viele verschiedene Bilder, und kein einzelner Schritt trägt den Großteil des Weges.
        const distinct = new Set(
            frames.map((frame) => `${String(frame.lng)}|${String(frame.lat)}|${String(frame.zoom)}`),
        );
        expect(distinct.size).toBeGreaterThan(5);
        let biggest = 0;
        for (let at = 1; at < frames.length; at += 1) {
            const before = frames[at - 1]!;
            const after = frames[at]!;
            biggest = Math.max(biggest, Math.hypot(after.lng - before.lng, after.lat - before.lat));
        }
        expect(biggest, "kein Bild springt den Großteil des Weges").toBeLessThan(total * 0.6);
    });
});

test.describe("Gebiet: Umstritten mit, Klimazone", () => {
    test("🔴 die Anspruchsteller sind Links mit dem Kästchen in der Farbe ihres Gebiets, dazu die Klimazone mit Anteilen", async ({
        page,
    }) => {
        await open(
            page,
            { kind: "territory", id: KAISERREICH },
            "Heiliges Neues Kaiserreich vom Greifenthron zu Gareth",
        );
        const labels = await labelsOf(page);
        expect(labels).toContain("Umstritten mit");
        expect(labels.indexOf("Umstritten mit")).toBe(labels.indexOf("Status") + 1);
        const row = page.getByTestId("info-fact").filter({ hasText: "Umstritten mit" });
        await expect(row.getByTestId("info-link")).toHaveText(["Markgrafschaft Perricum", "Bergkönigreich Tosch Mur"]);
        const swatches = row.getByTestId("info-swatch");
        await expect(swatches).toHaveCount(2);
        const colours = await swatches.evaluateAll((elements) =>
            elements.map((element) => getComputedStyle(element).backgroundColor),
        );
        expect(colours).toEqual(["rgb(169, 178, 99)", "rgb(195, 65, 65)"]);
        // Ein Link öffnet das Gebiet des Anspruchstellers über die eine Öffnungsnaht.
        await row.getByTestId("info-link").first().click();
        await expect(page.getByTestId("info-title")).toHaveText("Markgrafschaft Perricum", { timeout: 20_000 });
        expect(await subject(page)).toMatchObject({ kind: "territory" });
    });

    test("die Klimazone des Gebiets steht am Ende der Tabelle, bei mehreren Bändern mit Anteil", async ({ page }) => {
        await open(
            page,
            { kind: "territory", id: KAISERREICH },
            "Heiliges Neues Kaiserreich vom Greifenthron zu Gareth",
        );
        const labels = await labelsOf(page);
        expect(labels.at(-1)).toBe("Klimazone");
        const value = await page
            .getByTestId("info-fact")
            .filter({ hasText: "Klimazone" })
            .getByTestId("info-fact-value")
            .textContent();
        expect(value).toMatch(/Gemäßigte Zone \(\d+ %\)/);
    });
});

test.describe("Kartenstelle: In der Nähe", () => {
    test("🔴 ein Abschnitt „In der Nähe (n)“: Art links, Name als Link, Meilen und die Nadel mit der Peilung", async ({
        page,
    }) => {
        await page.goto("/?pin=532.969,551.625");
        await expect(page.getByTestId("info-title")).toHaveText("Was ist hier?", { timeout: 20_000 });
        const section = page.getByTestId("info-section").filter({ hasText: "In der Nähe" });
        await expect(section).toBeVisible({ timeout: 20_000 });
        await expect(section.getByTestId("info-section-count")).toHaveText(/^\(\d+\)$/);
        const rows = section.getByTestId("info-fact");
        expect(await rows.count()).toBeGreaterThanOrEqual(3);
        await expect(rows.first().getByTestId("info-fact-value")).toContainText(/\d+,\d Meilen/);
        const arrow = rows.first().getByTestId("info-bearing");
        await expect(arrow).toBeVisible();
        await expect(arrow).toHaveAttribute("aria-label", /\(\d+,\d°\)$/);
        // Die Nadel dreht sich: Die Eigenschaft trägt die Peilung in Grad.
        const turned = await arrow.evaluate((element) => (element as HTMLElement).style.getPropertyValue("--info-dir"));
        expect(turned).toMatch(/^\d+(\.\d+)?deg$/);
        // Die Liste liegt bündig im Abschnitt: kein doppeltes seitliches Polster.
        const head = await section.getByTestId("info-section-title").boundingBox();
        const label = await rows.first().getByTestId("info-fact-label").boundingBox();
        expect(Math.round(label?.x ?? 0)).toBe(Math.round(head?.x ?? -1));
    });

    test("ein Ort in der Nähe ist ein Link und öffnet seinen Subject", async ({ page }) => {
        await page.goto("/?pin=532.969,551.625");
        const section = page.getByTestId("info-section").filter({ hasText: "In der Nähe" });
        await expect(section).toBeVisible({ timeout: 20_000 });
        const link = section.getByTestId("info-link").first();
        const name = (await link.textContent())?.trim() ?? "";
        expect(name).not.toBe("");
        await link.click();
        await expect(page.getByTestId("info-title")).toHaveText(name, { timeout: 20_000 });
    });
});

test.describe("Kraftlinie: Verbindet, Verläuft über, Abschnitte", () => {
    test("🔴 die Basiliuslinie: vier Enden mit „ · “, die Stationen, sechzehn Abschnitte, davon zwei ohne Artikel - vor Stärke, jeder Name ein Link", async ({
        page,
    }) => {
        await open(page, { kind: "powerline", anchor: BASILIUS }, "Basiliuslinie");
        const labels = await labelsOf(page);
        expect(labels.slice(0, 3)).toEqual(["Verbindet", "Verläuft über", "Abschnitte"]);
        expect(labels.indexOf("Stärke")).toBeGreaterThan(2);
        const ends = page.getByTestId("info-fact").filter({ hasText: "Verbindet" });
        await expect(ends.getByTestId("info-link")).toHaveCount(4);
        await expect(ends).toContainText("Äußerster Süden");
        await expect(ends).toContainText("Gareth");
        // Eine Linie ist die Gruppe ihrer Segmente gleichen Namens wie Legacy (WI-0205, Befund K1): 16, zwei davon ohne den Artikel.
        await expect(
            page.getByTestId("info-fact").filter({ hasText: "Abschnitte" }).getByTestId("info-fact-value"),
        ).toHaveText("16 · davon 2 ohne Wiki-Artikel");
        // Ein Name öffnet den Ort.
        await ends.getByTestId("info-link").filter({ hasText: "Gareth" }).click();
        await expect(page.getByTestId("info-title")).toHaveText("Gareth", { timeout: 20_000 });
    });
});

test.describe("Kraftlinie mit Teilzuordnung (WI-0205, Befund K1)", () => {
    test("🔴 EINE Linie: die Abschnitte ohne ihren Artikel stehen in der Zeile „Abschnitte“, nicht als zweite Linie", async ({
        page,
    }) => {
        const ANKER = "c8c8c8c8-0000-4000-8000-000000000001";
        await page.route(`**/api/subjects/powerline/${ANKER}*`, (route) =>
            route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    subject: { kind: "powerline", anchor: ANKER },
                    revision: "abcdefabcdef",
                    title: "Gruppenader",
                    lineShape: { segments: 3, segmentsWithoutWiki: 1 },
                }),
            }),
        );
        await open(page, { kind: "powerline", anchor: ANKER }, "Gruppenader");
        await expect(
            page.getByTestId("info-fact").filter({ hasText: "Abschnitte" }).getByTestId("info-fact-value"),
        ).toHaveText("3 · davon 1 ohne Wiki-Artikel");
    });
});
