import { expect, test, type Page } from "@playwright/test";
import { routeAnswer } from "./route-evidence.ts";
import { openStagePanel, stageField, stageFieldValue } from "./stage-panel.ts";
import { openPlannerBox } from "./planner-boxes.ts";

/**
 * Der schärfste Knick einer Punktfolge in Grad: der größte Richtungswechsel an einem ihrer Punkte. Länge und Breite
 * sind auf dieser Karte winkeltreu, also ist der Winkel in Karteneinheiten derselbe wie auf dem Bild.
 */
function sharpestAngle(points: readonly (readonly number[])[]): number {
    let sharpest = 0;
    for (let index = 1; index + 1 < points.length; index += 1) {
        const [ax = 0, ay = 0] = points[index - 1] ?? [];
        const [bx = 0, by = 0] = points[index] ?? [];
        const [cx = 0, cy = 0] = points[index + 1] ?? [];
        const first = Math.hypot(bx - ax, by - ay);
        const second = Math.hypot(cx - bx, cy - by);
        if (first === 0 || second === 0) continue;
        const cosine = ((bx - ax) * (cx - bx) + (by - ay) * (cy - by)) / (first * second);
        sharpest = Math.max(sharpest, (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI);
    }
    return sharpest;
}

/**
 * Die Reiseart „Flug“ im Routenplaner (WI-0050 Oberfläche, WI-0051 F1: Flug auf der Luftlinie).
 *
 * 🔴 Geprüft wird, was der Besucher sieht, und was an die Route-API geht: im Flug das Flugmittel,
 * zurück über Land und Wasser keines.
 */

async function openPlanner(page: Page, search = ""): Promise<void> {
    await page.goto(`/${search}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(page.getByTestId("route-planner-tab")).toHaveAttribute("aria-expanded", "true");
}

/** Klappt „Transportmittel“ auf, falls die Route sie zugeklappt hat. */
const openTransport = (page: Page): Promise<void> => openPlannerBox(page, "transport");

test("🔴 Flug blendet Land, Fluss und Meer aus, zeigt zwölf Flugmittel mit Werten und fragt mit dem Flugmittel an", async ({
    page,
}) => {
    await openPlanner(page, "?route=Gareth~Perricum");
    await expect(page.getByTestId("route-overview")).toBeVisible({ timeout: 15_000 });
    const routeRequests: string[] = [];
    page.on("request", (request) => {
        if (/\/api\/route\?/.test(request.url())) routeRequests.push(request.url());
    });

    await openTransport(page);
    const surface = page.getByTestId("travel-mode-surface");
    const air = page.getByTestId("travel-mode-air");
    await expect(surface).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("allow-land")).toBeVisible();
    await expect(page.getByTestId("optimize-fastest")).toBeVisible();

    await air.click();
    await expect(air).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("transport-surface")).toHaveCount(0);
    await expect(page.getByTestId("allow-land")).toHaveCount(0);
    await expect(page.getByTestId("optimize-fastest")).toHaveCount(0);

    // Zwölf Flugmittel und das eigene, in vier Gruppen; genau eines gewählt, jedes mit Meilen/h und Schritt.
    const list = page.getByRole("radiogroup", { name: "Flugmittel" });
    await expect(list.getByRole("radio")).toHaveCount(13);
    await expect(list.getByRole("group")).toHaveText([
        /^Fluggeräte/,
        /^Flugreittiere/,
        /^Beschworene Wesen/,
        /^Außergewöhnlich/,
    ]);
    await expect(list.getByRole("radio", { checked: true })).toHaveCount(1);
    await expect(page.getByTestId("air-witchFlight")).toBeChecked();
    await expect(page.locator(".air__option").first()).toContainText("Hexenfluggerät");
    await expect(page.locator(".air__option").first()).toContainText("40 Meilen/h · 100 Schritt");
    for (const row of await page.locator(".air__option").all()) {
        await expect(row).toContainText(/[\d,]+ Meilen\/h · [\d.]+ Schritt/);
    }
    // Das Luftschiff (Nachtrag des Betreibers) mit Nachkommastelle und Tausenderpunkt.
    await expect(page.locator(".air__option", { has: page.getByTestId("air-airship") })).toContainText(
        /Luftschiff\s*12,5 Meilen\/h · 1\.000 Schritt/,
    );
    // Jedes Bild ist geladen, nicht nur verlinkt.
    const broken = await page
        .locator(".air__option img")
        .evaluateAll((images) =>
            (images as HTMLImageElement[]).filter((image) => image.naturalWidth !== 80).map((image) => image.src),
        );
    expect(broken).toEqual([]);

    // Im Flug rechnet der Planer die Luftlinie mit dem gewählten Flugmittel (WI-0051 F1). Über der Liste
    // steht kein Vermerk (Betreiber 2026-09-27: „weg“).
    await expect(page.getByTestId("route-overview")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("route-stage")).toHaveCount(1);
    await expect(page.getByTestId("route-stage").first()).toContainText("Flug mit Hexenfluggerät");
    await expect(page.getByTestId("air-transport")).not.toContainText("Vorbereitete Flugprofile");

    await page.getByTestId("air-griffin").check();
    await expect(page.getByTestId("air-griffin")).toBeChecked();
    await expect(page.getByTestId("air-witchFlight")).not.toBeChecked();
    await expect(page.getByTestId("route-stage").first()).toContainText("Flug mit Greif");
    await expect.poll(() => routeRequests.length).toBe(2);
    expect(routeRequests[0]).toContain("air=witchFlight");
    expect(routeRequests[1]).toContain("air=griffin");
    await expect.poll(() => page.evaluate(() => globalThis.location.search)).toBe("?route=Gareth~Perricum&air=griffin");
    // Kosten sind für den Flug nicht entschieden: keine Zeile statt einer falschen.
    await expect(page.getByTestId("route-costs")).toHaveCount(0);

    // Zugeklappt fasst der Kasten das Flugmittel zusammen.
    await page.getByTestId("transport-toggle").click();
    await expect(page.getByTestId("planner-transport").locator(".disclosure__secondary")).toHaveText(
        "Greif · 50 Meilen/h · 800 Schritt",
    );
    await openTransport(page);

    // Zurück auf Land & Wasser: die Route kommt wieder, Land, Fluss und Meer unverändert.
    await surface.click();
    await expect(page.getByTestId("route-overview")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("allow-land")).toBeChecked();
    await expect(page.getByTestId("optimize-fastest")).toBeChecked();
    await expect.poll(() => routeRequests.length).toBe(3);
    expect(routeRequests[2]).not.toContain("air=");
    await expect.poll(() => page.evaluate(() => globalThis.location.search)).toBe("?route=Gareth~Perricum");
});

/** Die gezeichnete Linie der Route aus der Quelle der Karte: je Abschnitt ihre Punkte (Länge, Breite). */
async function drawnLines(page: Page): Promise<{ flight: boolean; points: [number, number][] }[]> {
    return page.evaluate(() => {
        interface RouteFeature {
            properties: { flight: boolean };
            geometry: { coordinates: [number, number][] };
        }
        const map = globalThis.avesmapsMap as unknown as {
            getSource(id: string): { serialize(): { data: { features: RouteFeature[] } } } | undefined;
        };
        return (map.getSource("route")?.serialize().data.features ?? []).map((feature) => ({
            flight: feature.properties.flight,
            points: feature.geometry.coordinates,
        }));
    });
}

/**
 * 🪤 **Der Flug ist am 2026-10-16 gewechselt, die Zusicherung nicht** (WI-0192 §2.5). Chalama → Keshal Rondra hatte
 * zuletzt einen Knick von 23,8 Grad, also mehr als die zugesicherten 20 — und das ist KEIN Fehler der Glättung:
 *
 * - Gegenprobe auf dem Code von vor der Verdrahtung der Kenngrößen (`4cca9bac`), dieselben Daten: dieselben Zahlen
 *   (14,50 h, roh 8 Punkte / 36,9 Grad, Bild 99 Punkte / 23,8 Grad). Kein Codewechsel wirkt hier.
 * - Die Rundung ist VOM GELÄNDE begrenzt: `roundedDisplay` rundet eine Ecke nur, solange die Abkürzung frei bleibt
 *   (`!chordAbove(...)`, `air-way.ts`). Wandert das Gebirge, bleibt eine Ecke eng — `eckenRunden: 3` ist seit
 *   2026-10-04 unverändert, und das Routing-Gate zählt am 2026-10-16 `DATA_CHANGE 46 · REGRESSION 0`.
 * - Von 572 Flügen mit echtem Umweg bleiben 548 unter 20 Grad; die Zusicherung stimmt, die Reise war der Ausreißer.
 *
 * Festum → Khunchom zeigte dasselbe deutlicher: roh 8 Punkte mit einer Ecke von 26,4 Grad, gezeichnet 99 Punkte mit
 * höchstens 1,9 Grad. Die Voraussetzung prüft darum ausdrücklich, dass der Weg eine Ecke HAT, die spitzer ist als die
 * Zusicherung — sonst bewiese ein runder Flug über flachem Land nichts.
 *
 * 🪤 **Auch dieser Flug ist gewandert (2026-10-29, Release-Test d80313c07):** Festum → Khunchom hatte nur noch 5 Punkte und eine
 * Ecke von 19,3 Grad, die Voraussetzung schlug an. Wieder KEIN Fehler der Glättung, sondern der Weg um das Gebirge ist ein anderer
 * (Daten- und Geländestand). Gemessen am selben Tag, Hexenbesen, roh → gezeichnet: Gareth → Fasar 51,5 → 6,9 Grad (9 → 117 Punkte),
 * Kuslik → Fasar 49,7 → 6,2, Chorhop → Khunchom 47,7 → 6,7, Gareth → Khunchom 44,5 → 5,9, Havena → Khunchom 41,1 → 3,3; Festum → Khunchom
 * 19,3 und Punin → Khunchom 19,8 lagen knapp unter der Schwelle. Gewählt ist Gareth → Fasar, weil beide Seiten der Zusicherung (roh über
 * 20, gezeichnet unter 20) weit von der Schwelle entfernt liegen. Wandert der Flug wieder, einen mit Abstand zur Schwelle suchen, die
 * Zusicherung unverändert lassen.
 */
test("🔴 Ein Flug um die Gebirge ist gerundet, nicht eckig (Befund 2026-10-03: „flug- und querfeldeinrouten sind nicht mehr geglättet“)", async ({
    page,
}) => {
    // Seit 2026-10-04 (Betreiber) wird nur noch Gelände über 5.000 − 200 = 4.800 Schritt umflogen, für alle Flugmittel:
    // Punin → Neersand ist jetzt die Luftlinie. Gareth → Fasar ist ein Umweg mit Ecken (51 Grad roh).
    const answer = routeAnswer(page);
    await openPlanner(page, "?route=Gareth~Fasar&air=witchFlight");
    await expect(page.getByTestId("route-overview")).toBeVisible({ timeout: 15_000 });
    // Voraussetzung: Der gerechnete Weg biegt wirklich um das Gebirge, und seine Ecke ist spitzer als die Zusicherung.
    const roh = (await answer).segments[0]?.geometry.coordinates ?? [];
    expect(roh.length, "Voraussetzung: der Flug weicht aus (mehr als die zwei Punkte der Luftlinie)").toBeGreaterThan(
        2,
    );
    expect(
        sharpestAngle(roh),
        "Voraussetzung: der Weg hat eine Ecke, die spitzer ist als die Zusicherung",
    ).toBeGreaterThan(20);
    await expect.poll(async () => (await drawnLines(page)).filter((line) => line.flight).length).toBe(1);
    const [line] = (await drawnLines(page)).filter((each) => each.flight);
    const points = line?.points ?? [];
    // Rund: viele Punkte statt der wenigen Ecken des Wegs, und kein Knick über 20 Grad (die Ecken des Wegs sind
    // spitzer; Länge und Breite sind auf der Karte winkeltreu).
    expect(points.length).toBeGreaterThan(40);
    expect(sharpestAngle(points), "der schärfste Knick der gezeichneten Linie in Grad").toBeLessThan(20);
    // Und die Rundung ist nicht bloß dichter, sondern milder als der Weg: die Ecke des Wegs bleibt die spitzere.
    expect(sharpestAngle(points)).toBeLessThan(sharpestAngle(roh));
});

test("🔴 Ein Link mit `air` öffnet den Flug: Luftlinie in einer Etappe, Zeit nach dem Tempo des Flugmittels", async ({
    page,
}) => {
    await openPlanner(page, "?route=Gareth~Punin&air=griffin");
    await expect(page.getByTestId("travel-mode-air")).toHaveAttribute("aria-pressed", "true");
    const stage = page.getByTestId("route-stage");
    await expect(stage).toHaveCount(1);
    // Seit WI-0079 steht die Zeile zweizeilig: „Gareth → Punin“, darunter „Flug mit Greif · 292,86 Meilen · 5,9 Std.“
    const text = (await stage.first().innerText()).replace(/\s+/g, " ");
    expect(text).toContain("Gareth");
    expect(text).toContain("Punin");
    expect(text).toContain("Flug mit Greif");
    // Die Zeit ist Strecke durch Tempo: Der Greif fliegt 50 Meilen/h.
    const zahl = (match: RegExpMatchArray | null): number =>
        Number(match?.[1]?.replace(/\./g, "").replace(",", ".") ?? "NaN");
    const miles = zahl(text.match(/([\d.]+,\d+) Meilen/));
    const hours = zahl(text.match(/([\d.]+,\d+) Std\./));
    expect(hours).toBeCloseTo(miles / 50, 1);
});

test("🔴 F4 (Betreiber 2026-10-04): Fliegen über der üblichen Flughöhe kostet Zeit und steht als „+x Std. über üblicher Flughöhe“ in Etappe, Höhenprofil und Zeit; der Greif über denselben Hügeln zahlt nichts", async ({
    page,
}) => {
    // Gareth → Punin: Hügelland bis rund 1.300 Schritt. Der Hexenbesen (Reisehöhe 100, Bahn Boden + 200) hält vor den
    // Hügeln die Höhe und zahlt dafür; der Greif fliegt auf seinen 800 darüber und zahlt nichts.
    await openPlanner(page, "?route=Gareth~Punin&air=witchFlight");
    const stage = page.getByTestId("route-stage");
    await expect(stage).toHaveCount(1);
    // Der Flugzuschlag steht seit WI-0079 im Infopanel der Etappe (§4), die Zahlen stehen in seinen Kacheln.
    await openStagePanel(page, 0);
    const extra = stageFieldValue(page, "airExtra");
    await expect(extra).toHaveText(/\+[\d,]+ Std\. über üblicher Flughöhe/);
    const figure = async (key: string): Promise<number> => {
        const text = (await page.getByTestId(`stage-figure-${key}`).textContent()) ?? "";
        return Number(
            text
                .match(/([\d.]+,[\d]+|[\d.]+)/)?.[1]
                ?.replace(/\./g, "")
                .replace(",", ".") ?? "NaN",
        );
    };
    const miles = await figure("distance");
    const hours = await figure("travel");
    const surcharge = Number(
        ((await extra.textContent()) ?? "").match(/\+([\d,]+) Std\./)?.[1]?.replace(",", ".") ?? "NaN",
    );
    expect(surcharge).toBeGreaterThan(0);
    // Die Zeit ist Strecke durch Tempo (Hexenbesen 40 Meilen/h) plus der Zuschlag.
    expect(hours).toBeCloseTo(miles / 40 + surcharge, 0);
    expect(hours).toBeGreaterThan(miles / 40);
    await page.keyboard.press("Escape");
    // Im Höhenprofil: Die Überschrift trägt die Zeit, aufgeklappt steht der Satz dazu.
    const profile = page.getByTestId("planning-profile");
    await expect(profile).toContainText(/\+[\d,]+ Std\. über üblicher Flughöhe/);
    await page.getByTestId("profile-toggle").click();
    await expect(page.getByTestId("route-air-extra")).toContainText("Über der üblichen Flughöhe:");

    await openPlanner(page, "?route=Gareth~Punin&air=griffin");
    await expect(page.getByTestId("route-stage")).toHaveCount(1);
    await openStagePanel(page, 0);
    await expect(stageField(page, "airExtra")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("planning-profile")).not.toContainText("über üblicher Flughöhe");
});

test("🔴 Der Wechsel der Reiseart klappt nichts auf und nichts zu, auch wenn die Route zurückkommt (Betreiber 2026-09-27)", async ({
    page,
}) => {
    await openPlanner(page, "?route=Gareth~Perricum");
    await expect(page.getByTestId("route-overview")).toBeVisible({ timeout: 15_000 });
    const transport = page.getByTestId("transport-toggle");
    const options = page.getByTestId("options-toggle");
    // Die Route steht: Beide Kästen sind zu (Legacy C4). Man öffnet „Transportmittel“, um umzuschalten.
    await expect(options).toHaveAttribute("aria-expanded", "false");
    await openTransport(page);

    for (const mode of ["air", "surface", "air", "surface"] as const) {
        await page.getByTestId(`travel-mode-${mode}`).click();
        // Beide Reisearten rechnen (WI-0051 F1): Die Übersicht kommt jedes Mal wieder, im Flug mit der Flugetappe.
        await expect(page.getByTestId("route-overview")).toBeVisible({ timeout: 15_000 });
        if (mode === "air") await expect(page.getByTestId("route-stage").first()).toContainText("Flug mit");
        // Länger als die 700 ms, nach denen die Kästen ohne Route wieder aufgehen würden.
        await page.waitForTimeout(900);
        await expect(transport, `nach „${mode}“`).toHaveAttribute("aria-expanded", "true");
        await expect(options, `nach „${mode}“`).toHaveAttribute("aria-expanded", "false");
    }
});

test("🪤 Nach dem Wechsel gilt die Regel wieder: Eine neue Reise klappt die Kästen zu (Legacy C4)", async ({
    page,
}) => {
    // Ohne Orte kommt keine Rechnung in Gang - der Halt muss trotzdem frei werden.
    await openPlanner(page);
    await page.getByTestId("travel-mode-air").click();
    await page.getByTestId("travel-mode-surface").click();
    const first = page.getByTestId("waypoint-input").nth(0);
    await first.fill("Gareth");
    await expect(page.getByTestId("waypoint-hits").first()).toContainText("Gareth");
    await first.press("Enter");
    await page.getByTestId("route-add").click();
    const second = page.getByTestId("waypoint-input").nth(1);
    await second.fill("Perricum");
    await expect(page.getByTestId("waypoint-hits").first()).toContainText("Perricum");
    await second.press("Enter");
    await expect(page.getByTestId("route-overview")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("transport-toggle")).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("options-toggle")).toHaveAttribute("aria-expanded", "false");
});

test("🔴 Schnellste/Kürzeste und Umsteigen stehen unter Transportmittel, Reiseoptionen nur noch allgemein", async ({
    page,
}) => {
    await openPlanner(page);
    const transport = page.getByTestId("planner-transport");
    const options = page.getByTestId("planner-options");
    await expect(transport.getByTestId("optimize-fastest")).toBeVisible();
    await expect(transport.getByTestId("optimize-shortest")).toBeVisible();
    await expect(transport.getByTestId("minimize-transfers")).toBeVisible();
    await expect(options.getByTestId("optimize-fastest")).toHaveCount(0);
    await expect(options.getByTestId("minimize-transfers")).toHaveCount(0);
    await expect(options.getByTestId("hours-per-day")).toBeVisible();
    await expect(options.getByTestId("travel-start-month")).toBeVisible();
    await expect(options.getByTestId("travel-lodging")).toBeVisible();

    // Die Wahl wirkt weiter wie bisher: Kürzeste steht in der Adresse, unter Legacys Namen.
    await page.getByTestId("optimize-shortest").check();
    await expect.poll(() => page.evaluate(() => globalThis.location.search)).toBe("?pathType=shortest");
});

test("🔴 Eigenes Flugmittel: Name, Meilen/h und Schritt direkt darunter, ohne Fenster", async ({ page }) => {
    await openPlanner(page);
    await page.getByTestId("travel-mode-air").click();
    await expect(page.getByTestId("air-custom-fields")).toHaveCount(0);

    await page.getByTestId("air-custom").check();
    const fields = page.getByTestId("air-custom-fields");
    await expect(fields).toBeVisible();
    await expect(page.locator('dialog[open], [role="dialog"]')).toHaveCount(0);
    await expect(fields.getByLabel("Name:")).toHaveAttribute("placeholder", "Eigenes Flugmittel");

    await fields.getByLabel("Name:").fill("Hexenbesen der Oberin");
    const speed = fields.getByLabel("Geschwindigkeit:");
    await speed.fill("62");
    await speed.press("Tab");
    await expect(fields.getByLabel("Flughöhe:")).toBeFocused();
    await fields.getByLabel("Flughöhe:").fill("0");
    await fields.getByLabel("Flughöhe:").press("Tab");
    // Unter 1 gibt es nicht: das Feld klemmt.
    await expect(fields.getByLabel("Flughöhe:")).toHaveValue("1");
    await expect(page.locator(".air__option").last()).toContainText("62 Meilen/h · 1 Schritt");

    await page.getByTestId("transport-toggle").click();
    await expect(page.getByTestId("planner-transport").locator(".disclosure__secondary")).toHaveText(
        "Hexenbesen der Oberin · 62 Meilen/h · 1 Schritt",
    );

    // Ein anderes Flugmittel blendet die Felder aus; die eigenen Werte bleiben für später.
    await page.getByTestId("transport-toggle").click();
    await page.getByTestId("air-karakil").check();
    await expect(fields).toHaveCount(0);
    await page.getByTestId("air-custom").check();
    await expect(page.getByTestId("air-custom-fields").getByLabel("Name:")).toHaveValue("Hexenbesen der Oberin");
});

test("Tastatur: Umschalter mit Enter, Flugmittel mit ↑/↓, und die Karte wandert dabei nicht", async ({ page }) => {
    await openPlanner(page);
    const air = page.getByTestId("travel-mode-air");
    await air.focus();
    await page.keyboard.press("Enter");
    await expect(air).toHaveAttribute("aria-pressed", "true");
    await expect(air).toBeFocused();

    // Tab führt vom Umschalter in die Liste, auf das gewählte Flugmittel.
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("air-witchFlight")).toBeFocused();
    const center = await page.evaluate(() => {
        const c = globalThis.avesmapsMap!.getCenter();
        return [c.lng, c.lat];
    });
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("air-flyingCarpet")).toBeChecked();
    await expect(page.getByTestId("air-flyingCarpet")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("air-airship")).toBeChecked();
    // Über die Gruppengrenze hinweg.
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("air-flyingLizard")).toBeChecked();
    expect(
        await page.evaluate(() => {
            const c = globalThis.avesmapsMap!.getCenter();
            return [c.lng, c.lat];
        }),
    ).toEqual(center);

    // Der Fokus ist sichtbar: Die Zeile zieht die goldbraune Kante nach (nach dem Übergang von 120 ms).
    const kante = (testid: string) =>
        page
            .locator(".air__option", { has: page.getByTestId(testid) })
            .evaluate((element) => getComputedStyle(element).borderTopColor);
    await expect.poll(() => kante("air-flyingLizard")).toBe("rgb(126, 101, 29)");
    await expect.poll(() => kante("air-griffin")).toBe("rgba(0, 0, 0, 0)");

    // Zurück mit Umschalt+Tab auf den Umschalter und mit Enter auf Land & Wasser.
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByTestId("travel-mode-surface")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("allow-land")).toBeVisible();
});
