import { expect, test, type Page } from "@playwright/test";
import { routeAnswer } from "./route-evidence.ts";
import { showStages } from "./stage-groups.ts";

/**
 * Was Schnee und Eis kosten, im Höhenprofil der Routendetails (WI-0065 Nachtrag 2026-10-04, Betreiber: „kann man hier
 * auch listen, was der tiefschnee kostet“). Die Stunden rechnet der Server (`route.snow`): wie viel länger die Reise
 * durch den Boden der Jahreszeit ist, wo er Schnee oder Eis ist. Nur mit Reisebeginn.
 *
 * Eine echte Reise über das Gebirge im Firun: Greifenfurt → Lowangen. Im Winter liegt dort leichter Schnee, im Norden
 * Tiefschnee. 🔴 Braucht Wegprofile in der Datenbank (`npm run derive:terrain`), sonst gibt es keine Profilbox.
 */

test.beforeEach(async ({ request }) => {
    const zeiger = await request.get("/tiles/terrain/dem/current.json");
    const json = (zeiger.headers()["content-type"] ?? "").includes("json");
    test.skip(zeiger.status() === 404 || !json, "kein Gelände abgeleitet: npm run derive:terrain");
});

const WINTER = "?route=Greifenfurt~Lowangen&startMonth=firun&startDay=1";

async function openRoute(page: Page, search: string): Promise<void> {
    await page.goto(`/${search}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await showStages(page, 15_000);
}

/** Die Zahl einer Angabe wie „12,3“ oder „12.3“. */
const hoursIn = (text: string, pattern: RegExp): number => {
    const match = pattern.exec(text);
    if (!match?.[1]) throw new Error(`keine Stunden in „${text}“`);
    return Number(match[1].replace(",", "."));
};

test("🔴 im Firun über das Gebirge: Deckel und Satz nennen, was der Schnee kostet, mit den Zuständen der Bodentafel", async ({
    page,
}) => {
    const response = page.waitForResponse((r) => r.url().includes("/api/route?"));
    await openRoute(page, WINTER);
    const route = (await (await response).json()) as {
        snow?: { extra_hours: number; conditions: string[] };
        slope?: { extra_hours: number };
        segments: { travel_hours: number; slope?: { extra_hours: number }; snow?: { extra_hours: number } }[];
    };
    expect(route.snow?.extra_hours).toBeGreaterThan(1);

    // 🔴 Der Deckel nennt die Mehrzeit aus Steigung UND Schnee zusammen, eine Zeile: „+72,8 Std. (bis 19 %, Schnee)“ (ein Gefälle trägt „↓“)
    // (Betreiber 2026-10-04).
    const deckel = page.getByTestId("profile-toggle");
    await expect(deckel).toContainText(/^Höhenprofil: \+[\d,]+ Std\. \(bis \d+ %(?: \u2193\uFE0E?)?, Schnee\)$/);
    const kurz = hoursIn((await deckel.textContent()) ?? "", /\+([\d,]+) Std\./);
    // Mit beidem minus ohne beides, aus den Abschnitten: s + n − s·n / T. Nicht die einfache Summe, die zählt doppelt.
    const zusammen = route.segments.reduce((summe, segment) => {
        const s = segment.slope?.extra_hours ?? 0;
        const n = segment.snow?.extra_hours ?? 0;
        return summe + s + n - (segment.travel_hours > 0 ? (s * n) / segment.travel_hours : 0);
    }, 0);
    expect(kurz).toBeCloseTo(zusammen, 1);
    const summe = (route.slope?.extra_hours ?? 0) + (route.snow?.extra_hours ?? 0);
    expect(kurz).toBeLessThan(summe);

    await deckel.click();
    const satz = page.getByTestId("route-slope");
    // Der Satz im Inhalt nennt Steigung und Schnee einzeln, mit den Zahlen des Servers.
    await expect(satz).toContainText(/Die Steigung kostet [\d,]+ Stunden, der Schnee [\d,]+ Stunden \(.+\)\./);
    const lang = hoursIn((await satz.textContent()) ?? "", /der Schnee ([\d,]+) Stunden/);
    expect(lang).toBeCloseTo(route.snow?.extra_hours ?? 0, 1);
    // Die Zustände stehen mit ihren Namen in Klammern, wie am Ende der Etappen („· leichter Schnee +14 %“).
    const namen = { schnee_leicht: "leichter Schnee", tiefschnee: "Tiefschnee", eis: "Eis" } as Record<string, string>;
    const erwartet = (route.snow?.conditions ?? []).map((condition) => namen[condition] ?? condition).join(", ");
    await expect(satz).toContainText(`(${erwartet}).`);
    // Der Knopf „Details zur Höhenberechnung“ bleibt am Ende des Satzes.
    await expect(satz.getByTestId("route-slope-details")).toBeVisible();
});

test("🔴 ohne Schnee kein Wort davon: Sommerreise unter der Schneegrenze und ohne Reisebeginn", async ({ page }) => {
    for (const search of ["?route=Gareth~Punin&startMonth=praios&startDay=1", "?route=Greifenfurt~Lowangen"]) {
        const answer = routeAnswer(page);
        await openRoute(page, search);
        const route = await answer;
        expect(route.snow?.extra_hours ?? 0, "Voraussetzung: kein Schnee auf dieser Reise").toBe(0);
        expect(
            route.slope?.extra_hours ?? 0,
            "Voraussetzung: sichtbares Höhenprofil mit Steigungskosten",
        ).toBeGreaterThan(0);
        const deckel = page.getByTestId("profile-toggle");
        await expect(deckel).toContainText(/^Höhenprofil: \+[\d,]+ Std\. \(bis \d+ %(?: \u2193\uFE0E?)?\)$/);
        await expect(deckel).not.toContainText("Schnee");
        await deckel.click();
        await expect(page.getByTestId("route-slope")).toContainText("Die Steigung kostet");
        await expect(page.getByTestId("route-slope")).not.toContainText("Schnee");
    }
});

test("englisch: „+… h (up to … %, snow)“ und der Satz ohne Anrede", async ({ page }) => {
    await openRoute(page, `${WINTER}&lang=en`);
    const deckel = page.getByTestId("profile-toggle");
    await expect(deckel).toContainText(/^Elevation profile: \+[\d.]+ h \(up to \d+ %(?: \u2193\uFE0E?)?, snow\)$/);
    await deckel.click();
    await expect(page.getByTestId("route-slope")).toContainText(
        /The slopes cost [\d.]+ hours, snow [\d.]+ hours \((light snow|deep snow|ice)(, (light snow|deep snow|ice))*\)\./,
    );
});

/**
 * 🪤 **Die Sommerreise ist am 2026-10-16 gewechselt, die Zusicherung nicht** (WI-0192 §2.5): Greifenfurt → Lowangen im
 * Praios geht jetzt südlich über Corwick (8 Etappen) und berührt die Schneegrenze nicht mehr. Kein Codefehler — das
 * Routing-Gate zählt am 2026-10-16 `DATA_CHANGE 46 · REGRESSION 0`, die Daten sind seit der Basislinie gewandert.
 * Lowangen → **Andergast** erfüllt die Voraussetzung wieder: dieselbe Gebirgskante, 7 Etappen, 0,18 Stunden Tiefschnee
 * im Praios. 🪤 Eine kleine Zahl ist leichter verloren als eine große; fällt die Voraussetzung wieder, ist es wieder
 * die Landschaft und nicht das Produkt.
 */
test("🔴 die Schneegrenze gilt auch im Sommer: Schneekosten bleiben im Höhenprofil sichtbar", async ({ page }) => {
    const answer = routeAnswer(page);
    await openRoute(page, "?route=Lowangen~Andergast&startMonth=praios&startDay=1");
    const route = await answer;
    expect(
        route.snow?.extra_hours ?? 0,
        "Voraussetzung: diese Sommerreise überschreitet die Schneegrenze",
    ).toBeGreaterThan(0);
    const deckel = page.getByTestId("profile-toggle");
    await expect(deckel).toContainText("Schnee");
    await deckel.click();
    const sentence = (await page.getByTestId("route-slope").textContent()) ?? "";
    expect(hoursIn(sentence, /der Schnee ([\d,]+) Stunden/)).toBeCloseTo(route.snow!.extra_hours, 1);
});
