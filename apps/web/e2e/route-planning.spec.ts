import { test, expect } from "@playwright/test";
import { expectLidRule, lidLines } from "./disclosure-lines.ts";
import { LID_ROUTES, openLids } from "./lid-routes.ts";
import { routeAnswer } from "./route-evidence.ts";
import { showStages } from "./stage-groups.ts";

/**
 * Der gemeinsame Deckel der Landschaften und politischen Gebiete (WI-0081): EIN Deckel, die Landschaften zuerst,
 * Einzahl und Mehrzahl je Seite des „und“. 🔴 Er beginnt mit der ZAHL (Betreiber 2026-10-05: „Durch 19 Landschaften
 * und 43 politische Gebiete → 19 Landschaften und 43 politische Gebiete“).
 */
const AREAS_LID = /^\d+ (?:Gegend|Gegenden) und \d+ (?:politisches Gebiet|politische Gebiete)$/;
/** „Unterwegs gibt es:“ (WI-0257 S4): der Titel, dahinter je Art (Waren, Fauna, Flora, Spezies) das Zeichen mit seiner Zahl; die Wörter dazu stehen im title. */
const UNTERWEGS_LID = /^Vorkommen unterwegs:\s*\d+(?:\s*\d+){1,3}$/;

test("Routendetails: ohne abgeleitetes Höhenprofil gibt es keine Profilbox", async ({ page }) => {
    await page.route("**/api/route?**", async (request) => {
        const response = await request.fetch();
        const route = await response.json();
        delete route.slope;
        for (const segment of route.segments) {
            delete segment.slope;
            delete segment.elevation_profile;
        }
        for (const stage of route.stages) delete stage.slope;
        await request.fulfill({ response, json: route });
    });
    await page.goto("/?route=Greifenfurt~Lowangen");
    await showStages(page, 15_000);
    await expect(page.getByTestId("route-planning")).toContainText("Routendetails");
    await expect(page.getByTestId("planning-costs")).toBeVisible();
    await expect(page.getByTestId("planning-profile")).toHaveCount(0);
    await expect(page.getByTestId("elevation-chart")).toHaveCount(0);
});

test("Routendetails: eine Steigungs-Zusammenfassung ohne Profilpunkte behält die Box, aber ohne Diagramm", async ({
    page,
}) => {
    let slope: unknown;
    await page.route("**/api/route?**", async (request) => {
        const response = await request.fetch();
        const route = await response.json();
        slope = route.slope;
        for (const segment of route.segments) delete segment.elevation_profile;
        await request.fulfill({ response, json: route });
    });
    await page.goto("/?route=Greifenfurt~Lowangen");
    await showStages(page, 15_000);
    expect(slope).toBeDefined();
    await expect(page.getByTestId("planning-profile")).toBeVisible();
    await page.getByTestId("profile-toggle").click();
    await expect(page.getByTestId("route-slope")).toContainText("höchster Punkt");
    await expect(page.getByTestId("elevation-chart")).toHaveCount(0);
});

test("Reiseplanung shows ordered disclosures, a real profile and seasonal snow line", async ({ page }) => {
    const response = page.waitForResponse((r) => r.url().includes("/api/route?") && r.status() === 200);
    await page.goto("/?route=Greifenfurt~Lowangen&startMonth=praios&startDay=15");
    const route = await (await response).json();
    expect(route.segments.some((s: { elevation_profile?: unknown[] }) => s.elevation_profile?.length)).toBe(true);
    await expect(page.getByTestId("areas-toggle")).toBeVisible({ timeout: 20000 });
    const planning = page.getByTestId("route-planning");
    const lids = planning.locator(":scope > details > summary");
    await expect(lids).toHaveText([
        /^Höhenprofil: \+\d+,\d Std\. \(bis \d+ %(?: \u2193\uFE0E?)?(?:, Schnee)?\)$/,
        /^Reisekosten je Person: \d+ [DSH](?: \d+ [DSH])*$/,
        // EIN Deckel für Landschaften und Gebiete (WI-0081), die Landschaften zuerst.
        AREAS_LID,
        // Zuletzt „Unterwegs gibt es:“ (WI-0257 S4): hinter dem Titel je Art ein Zeichen mit seiner Zahl.
        UNTERWEGS_LID,
    ]);
    // 🔴 Am Rechner ist jeder Deckel dieser Strecke einzeilig (Betreiber 2026-10-03: „1 zeilig“), nichts abgeschnitten.
    const lines = await lidLines(lids);
    expectLidRule(lines, "Rechner");
    for (const lid of lines) expect(lid.lines, lid.text).toBe(1);
    await expect(page.getByTestId("elevation-chart").locator("svg")).not.toBeVisible();
    await page.getByTestId("profile-toggle").press("Enter");
    await expect(page.getByTestId("elevation-chart").locator("svg")).toBeVisible();
    expect(await page.getByTestId("snowline-path").count()).toBeGreaterThan(0);
    await expect(page.getByTestId("elevation-chart")).toContainText("Richtwert");
    const chart = page.getByTestId("elevation-chart");
    await page.getByTestId("planning-profile").evaluate(async (element) => {
        await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished));
    });
    const beforeHover = await chart.boundingBox();
    await chart.locator("svg").hover();
    await expect(chart.locator(".profile__reading")).toBeVisible();
    expect((await chart.boundingBox())!.height).toBe(beforeHover!.height);
    await page.mouse.move(0, 0);
    await expect(chart.locator(".profile__reading")).not.toBeVisible();
    expect((await chart.boundingBox())!.height).toBe(beforeHover!.height);
    await page.getByTestId("costs-toggle").click();
    await expect(page.getByTestId("cost-total")).toBeVisible();
});

test("no departure date means no invented snow line", async ({ page }) => {
    await page.goto("/?route=Greifenfurt~Lowangen");
    await page.getByTestId("profile-toggle").click();
    // Ein Satz statt einer Aufforderung (WI-0076, Betreiber 2026-10-04: nie Anrede).
    await expect(page.getByTestId("elevation-chart")).toContainText("erscheint mit einem Reisebeginn");
    await expect(page.getByTestId("snowline-path")).toHaveCount(0);
});

test("🔴 Schifffahrtshinweise: nur mit Schiff, nur dessen Zeiten, der Rhythmus der Besatzung (WI-0069)", async ({
    page,
}) => {
    const CREW = "An Bord gilt der Rhythmus der Besatzung, nicht die Reisestunden der Reisenden.";
    /**
     * 🪤 Die Strecke ist nur Träger, die Zusicherung gilt den Hinweisen der benutzten Galeere. Bis 2026-10-29 stand hier
     * „Kürzeste Route“ (`pathType=shortest`); Boronaya → Moorburg liegt dort auf der Kante zwischen Seeweg und Land mit Fluss
     * (angezeigt 174,9 gegen 179,5 Einheiten); die Suche zahlt für die Seereise die Kosten des Küstenabstands, gemeldet wird
     * ihre Länge (`request-graph.ts`, „Wie Querfeldein“). Am 2026-10-29 fuhr die Reise dort über den Fluss (Flusssegler
     * statt Galeere; Routing-Code unverändert, die Daten wandern). Mit der schnellsten Route (Vorgabe) gewinnt die Galeere
     * deutlich (rund 65 gegen 102 Reisestunden). Fällt die Voraussetzung trotzdem, ist es wieder die Strecke und nicht das
     * Produkt.
     */
    const answer = routeAnswer(page);
    await page.goto("/?route=Boronaya~Moorburg&landTransport=lightRider&seaTransport=galley");
    const route = await answer;
    expect(
        route.stages.some((stage) => stage.transport === "galley"),
        "Voraussetzung: diese Reise fährt die Galeere",
    ).toBe(true);
    const lid = page.getByTestId("ships-toggle");
    // Die Zahl vorn wie bei Landschaften und Gebieten: Satz zur Besatzung, Zeitzeile und Hinweis der Galeere.
    await expect(lid).toHaveText("3 Schifffahrtshinweise", { timeout: 20000 });
    // Nach den Reisekosten, vor Landschaften und politischen Gebieten.
    await expect(page.getByTestId("route-planning").locator(":scope > details > summary")).toHaveText([
        /^Höhenprofil/,
        /^Reisekosten je Person/,
        "3 Schifffahrtshinweise",
        // EIN Deckel für Landschaften und Gebiete (WI-0081), die Landschaften zuerst.
        AREAS_LID,
        // Zuletzt „Unterwegs gibt es:“ (WI-0257 S4).
        UNTERWEGS_LID,
    ]);
    await expect(page.getByTestId("planner-transport")).not.toContainText("Std.");
    await lid.click();
    await expect(page.getByTestId("ship-line")).toHaveText([
        CREW,
        "Galeere: 8 Stunden gerudert, danach 16 Stunden Rast der Ruderer.",
        "Ruderschiffe besitzen nur begrenzten Frachtraum.",
    ]);
    await expect(page.getByTestId("ship-line").first()).toBeVisible();

    // Gemischt: nur die Schiffe dieser Reise, nichts zu Land.
    await page.goto("/?route=Gareth~Fasar");
    await page.getByTestId("ships-toggle").click({ timeout: 20000 });
    const lines = page.getByTestId("ship-line");
    await expect(lines.first()).toHaveText(CREW);
    await expect(lines.nth(1)).toHaveText("Flusssegler: 12 Stunden Fahrt am Tag, danach 12 Stunden vor Anker.");
    await expect(lines.nth(2)).toHaveText("Flusssegler benötigen ausreichend breite und gut befahrbare Gewässer.");
    await expect(page.getByTestId("planning-ships")).not.toContainText("An Land");
    // Nur Hinweise zu benutzten Schiffen: nichts vom Kahn, von der Galeere, vom Schnellsegler.
    await expect(page.getByTestId("planning-ships")).not.toContainText(/Treidel|Ruderschiffe|Kurier|Schnelle Schiffe/);
    // Die Zahl vorn ist die Zahl der Zeilen, keine doppelt.
    const texts = await lines.allTextContents();
    expect(new Set(texts).size).toBe(texts.length);
    await expect(page.getByTestId("ships-toggle")).toHaveText(`${texts.length} Schifffahrtshinweise`);

    // Ohne Fluss und Meer keine Schiffsetappe, also kein Deckel.
    await page.goto("/?route=Gareth~Fasar&allowRiver=0&allowSea=0");
    await expect(page.getByTestId("route-planning")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("planning-ships")).toHaveCount(0);
});

test("🔴 Deckel am Rechner: einzeilig, nichts abgeschnitten (Betreiber 2026-10-03: „mach aus beiden wieder eine zeile“, „A“)", async ({
    page,
}) => {
    for (const route of LID_ROUTES) {
        const lids = await openLids(page, route.search);
        const lines = await lidLines(lids);
        expectLidRule(lines, `Rechner ${route.search}`);
        // Am Rechner ist jeder Deckel einzeilig; „A“ greift erst auf schmalen Geräten.
        for (const lid of lines) expect(lid.lines, `${route.search}: ${lid.text}`).toBe(1);
        if (route.expect) await expect(lids.filter({ hasText: route.expect })).toHaveCount(1);
    }
});

test("🔴 die Nächte stehen bei der Übernachtung als Unterzeilen je Dach, nicht im Deckel (Betreiber 2026-10-03, 2026-10-04)", async ({
    page,
}) => {
    const lids = await openLids(page, "?route=Gareth~Vinsalt");
    await expect(lids.filter({ hasText: /^Reisekosten je Person: / })).not.toContainText("N.");
    await expect(lids.filter({ hasText: /^Reisekosten je Person: / })).not.toContainText("Nächte");
    await expect(lids.filter({ hasText: /^Höhenprofil: / })).not.toContainText("Schritt");
    await page.getByTestId("costs-toggle").click();
    // Gareth → Vinsalt fährt ein Stück zu Schiff: je Dach eine Zeile, die Zahl vor dem „×“ und das Dach dahinter.
    const nights = page.getByTestId("cost-night");
    await expect(nights.first()).toBeVisible();
    for (const text of await nights.allTextContents()) {
        expect(text).toMatch(/^\d+ × (?:im (?:Gemeinschaftszimmer|Freien)|an Bord)/);
    }
    // Der Betrag steht einmal, an den Gasthausnächten; keine Klammer mit der Summe aller Nächte mehr.
    await expect(page.getByTestId("cost-lodging").locator(".costs__night-amount")).toHaveCount(1);
    await expect(page.getByTestId("cost-lodging")).not.toContainText("(");
});
