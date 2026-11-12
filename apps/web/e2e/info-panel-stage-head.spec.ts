import { expect, test, type Page } from "@playwright/test";
import type { RouteLandscapesResponse, RouteResponse } from "@avesmaps3d/shared";
import { routeAnswer } from "./route-evidence.ts";
import { openStageGroups } from "./stage-groups.ts";

/**
 * Der Kopf einer Etappe im Infopanel (WI-0063 4.7, E13, 27.13; Betreiber 2026-10-04: „kann man die buttons < > rechts fixieren, dass sie
 * nicht immer hin und herspringen. schön wär eigentlich bei etappen, wenn Titel und Subtitle der Etappe zentriert, links < und recht >
 * wäre“) am echten Stack: „Etappe n von m“ und „Von → Bis“ mittig, die Pfeile fest an den Rändern der Untertitelzeile - gemessen beim
 * Blättern über Etappen mit kurzen UND langen Namen, höchstens 0,5 px Abweichung. Dazu die Feldliste mit dem, was der Planer weiß, und die
 * Objektlinks (Ort, Landschaft, Gebiet). Das Modell prüft `test/panel-stage.test.ts`; das Telefon `info-panel-p7.touch.spec.ts`.
 *
 * Die direkte Flussreise Burg Willenbach → Mardramund prüft Ortsenden, Strömung und eine lange Gebietskette.
 * Gareth → Perricum und der Tempel des Schwarzen Raben zu Derrelsbach → Gareth prüfen das Blättern über kurze und lange Namen.
 */

const RIVER = "/?route=Burg%20Willenbach~Mardramund";
const SHORT = "/?route=Gareth~Perricum";
const LONG = "/?route=Tempel%20des%20Schwarzen%20Raben%20zu%20Derrelsbach~Gareth";

const subject = (page: Page): Promise<{ kind: string; id?: string } | undefined> =>
    page.evaluate(() => globalThis.avesmapsSelectedSubject?.());

/** Lädt die Reise, wählt die Etappe über das Bild ihrer Zeile (die Mitte der Zeile kann ein Link sein) und wartet, bis die Kamera da ist. */
async function openStage(page: Page, url: string, index = 0): Promise<RouteResponse> {
    const answer = routeAnswer(page);
    await page.goto(url);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await openStageGroups(page);
    const rows = page.getByTestId("route-stage");
    await expect(rows.first()).toBeVisible({ timeout: 20_000 });
    await rows.nth(index).locator("img").first().click();
    await expect(page.getByTestId("info-title")).toHaveText(new RegExp(`^Etappe ${String(index + 1)} von \\d+$`));
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 15_000 });
    return answer;
}

interface HeadGeometry {
    /** Die Mitte des Inhalts der Kopfzeile (ohne Polster). */
    center: number;
    left: number;
    right: number;
    titleTextCenter: number;
    subtitleTextCenter: number;
    subtitle: { left: number; right: number; top: number; height: number };
    prev: { left: number; right: number; top: number; width: number; height: number };
    next: { left: number; right: number; top: number; width: number; height: number };
}

/** Misst den Kopf im Bild: Kästen der Pfeile und des Untertitels, die Mitte des gesetzten Texts (Range, nicht der Kasten). */
function measureHead(page: Page): Promise<HeadGeometry> {
    return page.evaluate(() => {
        const byId = (id: string): HTMLElement => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
        const textCenter = (element: HTMLElement): number => {
            const range = document.createRange();
            range.selectNodeContents(element);
            const box = range.getBoundingClientRect();
            return box.left + box.width / 2;
        };
        const head = byId("info-stage-head");
        const style = getComputedStyle(head);
        const box = head.getBoundingClientRect();
        const left = box.left + Number.parseFloat(style.paddingLeft);
        const right = box.right - Number.parseFloat(style.paddingRight);
        const rect = (
            element: HTMLElement,
        ): { left: number; right: number; top: number; width: number; height: number } => {
            const r = element.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, width: r.width, height: r.height };
        };
        const subtitle = rect(byId("info-subtitle"));
        return {
            center: (left + right) / 2,
            left,
            right,
            titleTextCenter: textCenter(byId("info-title")),
            subtitleTextCenter: textCenter(byId("info-subtitle")),
            subtitle,
            prev: rect(byId("info-stage-prev")),
            next: rect(byId("info-stage-next")),
        };
    });
}

test.describe("Kopf der Etappe: mittig, Pfeile fest", () => {
    test("🔴 Titel „Etappe n von m“ und Untertitel „Von → Bis“ stehen mittig im Panel (Betreiber: „zentriert“)", async ({
        page,
    }) => {
        const route = await openStage(page, RIVER);
        const stage = route.stages[0]!;
        expect(stage.from.name).toBe("Burg Willenbach");
        expect(stage.to.name).toBe("Mardramund");
        await expect(page.getByTestId("info-subtitle")).toHaveText(`${stage.from.name} → ${stage.to.name}`);
        const head = await measureHead(page);
        expect(Math.abs(head.titleTextCenter - head.center), "der Titel").toBeLessThanOrEqual(1);
        expect(Math.abs(head.subtitleTextCenter - head.center), "der Untertitel").toBeLessThanOrEqual(1);
        // ‹ links, › rechts, der Untertitel dazwischen: eine Zeile, die Pfeile auf der Höhe der Textzeile.
        expect(head.prev.right).toBeLessThanOrEqual(head.subtitle.left);
        expect(head.subtitle.right).toBeLessThanOrEqual(head.next.left);
        const arrowMiddle = head.prev.top + head.prev.height / 2;
        const lineMiddle = head.subtitle.top + head.subtitle.height / 2;
        expect(Math.abs(arrowMiddle - lineMiddle), "die Textzeile sitzt mittig zum Pfeil").toBeLessThanOrEqual(1.5);
    });

    test("🔴 die Pfeile stehen beim Blättern über alle Etappen an derselben Stelle - auch bei langen Namen (höchstens 0,5 px)", async ({
        page,
    }) => {
        await openStage(page, LONG, 0);
        const count = Number((await page.getByTestId("info-title").textContent())?.match(/von (\d+)/)?.[1]);
        expect(count).toBeGreaterThan(5);
        const seen: HeadGeometry[] = [];
        for (let step = 0; step < count; step += 1) {
            if (step > 0) {
                await page.getByTestId("info-stage-next").click();
                await expect(page.getByTestId("info-title")).toHaveText(
                    `Etappe ${String(step + 1)} von ${String(count)}`,
                );
            }
            seen.push(await measureHead(page));
        }
        const first = seen[0]!;
        for (const [at, head] of seen.entries()) {
            expect(Math.abs(head.prev.left - first.prev.left), `‹ x, Etappe ${String(at + 1)}`).toBeLessThanOrEqual(
                0.5,
            );
            expect(Math.abs(head.next.left - first.next.left), `› x, Etappe ${String(at + 1)}`).toBeLessThanOrEqual(
                0.5,
            );
            expect(Math.abs(head.prev.top - first.prev.top), `‹ y, Etappe ${String(at + 1)}`).toBeLessThanOrEqual(0.5);
            expect(Math.abs(head.next.top - first.next.top), `› y, Etappe ${String(at + 1)}`).toBeLessThanOrEqual(0.5);
            // Fest an den Rändern der Zeile, in fester Breite.
            expect(Math.abs(head.prev.left - head.left), "‹ am linken Rand").toBeLessThanOrEqual(0.5);
            expect(Math.abs(head.next.right - head.right), "› am rechten Rand").toBeLessThanOrEqual(0.5);
            expect(head.prev.width).toBeCloseTo(32, 0);
            expect(head.next.width).toBeCloseTo(32, 0);
            expect(Math.abs(head.titleTextCenter - head.center), "Titel mittig").toBeLessThanOrEqual(1);
            expect(head.prev.right, "der Untertitel bleibt zwischen den Pfeilen").toBeLessThanOrEqual(
                head.subtitle.left,
            );
            expect(head.subtitle.right).toBeLessThanOrEqual(head.next.left);
        }
        // Die Messung hätte ein Springen gesehen: Die Untertitel dieser Reise sind verschieden hoch (kurze Namen eine Zeile, der Tempel zwei).
        const heights = seen.map((head) => head.subtitle.height);
        expect(Math.max(...heights), "es gibt Untertitel in zwei Zeilen").toBeGreaterThan(Math.min(...heights) + 5);
    });

    test("🔴 bricht der Untertitel um, bleiben die Pfeile an der ersten Zeile (die Mitte wanderte mit der Zeilenzahl)", async ({
        page,
    }) => {
        await openStage(page, LONG, 0);
        await expect(page.getByTestId("info-subtitle")).toContainText("Tempel des Schwarzen Raben zu Derrelsbach");
        const head = await measureHead(page);
        expect(head.subtitle.height, "der lange Name bricht um").toBeGreaterThan(40);
        // Die erste Zeile liegt auf der Höhe des Pfeils, nicht die Mitte des ganzen Untertitels.
        const first = head.prev.top + head.prev.height / 2;
        const lineHeight = await page
            .getByTestId("info-subtitle")
            .evaluate((element) => Number.parseFloat(getComputedStyle(element).lineHeight));
        const padding = await page
            .getByTestId("info-subtitle")
            .evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingTop));
        expect(
            Math.abs(head.subtitle.top + padding + lineHeight / 2 - first),
            "erste Zeile mittig zum Pfeil",
        ).toBeLessThanOrEqual(1.5);
    });

    test("🔴 Zustände des Pfeils (Guide §30.5): Hover, Fokus, Gesperrt ohne `opacity`, Übergang 120 ms", async ({
        page,
    }) => {
        await openStage(page, SHORT, 0);
        const prev = page.getByTestId("info-stage-prev");
        const next = page.getByTestId("info-stage-next");
        const style = (locator: typeof next) =>
            locator.evaluate((element) => {
                const computed = getComputedStyle(element);
                return {
                    background: computed.backgroundColor,
                    border: computed.borderColor,
                    shadow: computed.boxShadow,
                    cursor: computed.cursor,
                    opacity: computed.opacity,
                    transition: computed.transitionDuration,
                };
            });
        // Gesperrt: gedämpfte Fläche, `not-allowed`, nie Deckkraft.
        const locked = await style(prev);
        const rest = await style(next);
        expect(locked.cursor).toBe("not-allowed");
        expect(locked.opacity).toBe("1");
        expect(locked.background).not.toBe(rest.background);
        expect(locked.shadow).toBe("none");
        // Ruhe: Zeiger, Übergang auf die geänderten Eigenschaften.
        expect(rest.cursor).toBe("pointer");
        expect(rest.transition).toContain("0.12s");
        // Hover: Fläche und Rand ändern sich.
        await next.hover();
        await expect.poll(async () => (await style(next)).background).not.toBe(rest.background);
        expect((await style(next)).border).not.toBe(rest.border);
        // Gesperrt reagiert nicht auf den Zeiger.
        await prev.hover();
        expect((await style(prev)).background).toBe(locked.background);
        // Fokus (Tastatur): der Ring wird mit dem eigenen Schatten komponiert, nie `outline`.
        await page.mouse.move(0, 0);
        await next.focus();
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        await expect(next).toBeFocused();
        const focused = await next.evaluate((element) => {
            const computed = getComputedStyle(element);
            return { shadow: computed.boxShadow, outline: computed.outlineStyle };
        });
        expect(focused.shadow).not.toBe("none");
        expect(focused.outline).toBe("none");
    });
});

test.describe("Feldliste der Etappe: was der Planer weiß", () => {
    const row = (page: Page, label: string) =>
        page
            .getByTestId("info-fact")
            .filter({ has: page.getByTestId("info-fact-label").getByText(label, { exact: true }) });

    test("🔴 Wegart, Wege, Transportmittel, Landschaften, Gebiete - in den Worten des Planers; Distanz, Reisezeit und Rastzeit stehen als Kacheln darüber (WI-0079 §3)", async ({
        page,
    }) => {
        const route = await openStage(page, RIVER);
        expect(route.stages[0]!.flow_state, "die Testetappe hat eine gemessene Flussrichtung").toBe("downstream");
        const labels = page.getByTestId("info-fact-label");
        await expect(row(page, "Derographie")).toBeVisible({ timeout: 20_000 });
        // 🔴 Seit WI-0106 stehen die vier Vorkommenszeilen HINTER Landschaften und Gebieten (Betreiber 2026-10-07:
        // „kannst du die lore auch in etappen anzeigen“; der Platz ist Legacys eigener, Owner 2026-08-12). Sie kommen
        // einen Augenblick später als der Rest, darum wird auf die letzte gewartet, nicht auf eine Zeitspanne.
        await expect(row(page, "Spezies")).toBeVisible({ timeout: 20_000 });
        await expect(labels).toHaveText([
            "Wegart",
            "Wege",
            "Transportmittel",
            "Derographie",
            "Gebiete",
            "Waren",
            "Fauna",
            "Flora",
            "Spezies",
        ]);
        // Das Wort der Strömung steht beim Transportmittel (wie in der Etappenzeile des Planers); die Richtung gibt der Fluss vor.
        await expect(row(page, "Transportmittel").getByTestId("info-fact-value")).toHaveText(
            "Flusssegler, flussabwärts",
        );
        // Die drei Kennzahlen stehen über der Feldliste, in EINEM Kasten mit feinen Trennern.
        await expect(page.getByTestId("stage-figure-distance")).toContainText(/^\d+,\d\dMeilen$/);
        await expect(page.getByTestId("stage-figure-travel")).toContainText(/^\d+,\d hReisezeit$/);
        await expect(page.getByTestId("stage-figure-rest")).toContainText(/^\d+,\d hRastzeit$/);
    });

    test("🔴 Messwerte nach der Klappbox-Regel: die Zahl hell mit Ziffern gleicher Breite, die Einheit gedämpft", async ({
        page,
    }) => {
        await openStage(page, RIVER);
        // Die Zeitkachel: Sie trägt beides, Zahl und Einheit. Die Distanz hat ihre Einheit in der Beschriftung.
        const value = page.getByTestId("stage-figure-travel");
        const colours = await value.evaluate((element) => {
            const number = element.querySelector(".wert__zahl")!;
            const unit = element.querySelector(".wert__einheit")!;
            return {
                number: getComputedStyle(number).color,
                unit: getComputedStyle(unit).color,
                digits: getComputedStyle(number).fontVariantNumeric,
            };
        });
        expect(colours.number).not.toBe(colours.unit);
        expect(colours.digits).toContain("tabular-nums");
    });

    test("🔴 kein zweiter Abruf: Landschaften und Gebiete kommen aus der Antwort des Planers (eine Abfrage je Route)", async ({
        page,
    }) => {
        const calls = { landscapes: 0, routes: 0, lore: 0 };
        page.on("request", (request) => {
            if (request.url().includes("/api/route/landscapes")) calls.landscapes += 1;
            else if (request.url().includes("/api/route/stage/lore")) calls.lore += 1;
            else if (request.url().includes("/api/route?")) calls.routes += 1;
        });
        await openStage(page, SHORT, 0);
        await expect(row(page, "Derographie")).toBeVisible({ timeout: 20_000 });
        await expect(row(page, "Spezies")).toBeVisible({ timeout: 20_000 });
        await page.getByTestId("info-stage-next").click();
        await expect(page.getByTestId("info-title")).toHaveText(/^Etappe 2 von/);
        await expect(row(page, "Derographie")).toBeVisible({ timeout: 20_000 });
        await expect(row(page, "Spezies")).toBeVisible({ timeout: 20_000 });
        expect(calls.landscapes, "je Route eine Abfrage, nicht je Etappe oder Panel").toBe(calls.routes);
        // 🔴 **Die Vorkommen sind der eine Abruf JE ETAPPE** (WI-0106, gemessen Median 11 ms und 2,6 kB): Zwei gezeigte
        // Etappen ergeben zwei Fragen - und der Weg ZURÜCK keine weitere, denn dieselbe Wegkette liegt im Speicher.
        expect(calls.lore, "eine Frage je gezeigter Etappe").toBe(2);
        await page.getByTestId("info-stage-prev").click();
        await expect(page.getByTestId("info-title")).toHaveText(/^Etappe 1 von/);
        await expect(row(page, "Spezies")).toBeVisible({ timeout: 20_000 });
        expect(calls.lore, "der Weg zurück kommt aus dem Speicher").toBe(2);
    });
});

test.describe("Objektlinks: Ort, Landschaft, Gebiet (Regel „Was auf der Karte ist, ist anklickbar“)", () => {
    test("🔴 Von und Bis sind Links: ein Klick öffnet das Panel des Orts über dieselbe Naht", async ({ page }) => {
        const route = await openStage(page, RIVER);
        const stage = route.stages[0]!;
        expect(stage.from.place_id).toBeTruthy();
        expect(stage.to.place_id).toBeTruthy();
        const links = page.getByTestId("info-subtitle").getByTestId("info-link");
        await expect(links).toHaveText(["Burg Willenbach", "Mardramund"]);
        await links.first().click();
        await expect(page.getByTestId("info-title")).toHaveText("Burg Willenbach", { timeout: 20_000 });
        expect(await subject(page)).toMatchObject({ kind: "place", id: stage.from.place_id });
    });

    test("🔴 eine Landschaft der Etappe öffnet ihre Fläche im Panel", async ({ page }) => {
        await openStage(page, RIVER);
        const value = page.getByTestId("info-fact").filter({ hasText: "Derographie" }).getByTestId("info-fact-value");
        await expect(value.getByTestId("info-link").first()).toBeVisible({ timeout: 20_000 });
        const name = (await value.getByTestId("info-link").first().textContent())!.trim();
        await value.getByTestId("info-link").first().click();
        await expect(page.getByTestId("info-title")).toHaveText(name, { timeout: 20_000 });
        expect(await subject(page)).toMatchObject({ kind: "area" });
    });

    test("🔴 die Gebiete einer langen Kette stehen im Deckel mit der Zahl; ein Gebiet darin öffnet sein Panel", async ({
        page,
    }) => {
        const answer = page.waitForResponse(
            (response) => response.url().endsWith("/api/route/landscapes") && response.ok(),
        );
        await openStage(page, RIVER);
        const areas = (await (await answer).json()) as RouteLandscapesResponse;
        const territories = areas.territories?.[0] ?? [];
        expect(territories.length, "Voraussetzung: lange Gebietskette, Deckel ab fünf").toBeGreaterThanOrEqual(5);
        const lid = page.getByTestId("info-fact").filter({ hasText: "Gebiete" }).getByTestId("info-lid");
        await expect(lid).toBeVisible({ timeout: 20_000 });
        await expect(lid.getByTestId("info-lid-count")).toHaveText(String(territories.length));
        await lid.locator("button.info-lid__summary").click();
        const first = lid.getByTestId("info-link").first();
        await expect(first).toBeVisible();
        await expect(lid.getByTestId("info-link")).toHaveText(territories.map((entry) => entry.name));
        const name = territories[0]!.name;
        await first.click();
        await expect(page.getByTestId("info-title")).toHaveText(name, { timeout: 20_000 });
        expect(await subject(page)).toMatchObject({ kind: "territory", id: territories[0]!.id });
    });
});
