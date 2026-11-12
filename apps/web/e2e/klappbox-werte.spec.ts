import { expect, test, type Page } from "@playwright/test";
import { klappboxFarben, openKlappboxen, type KlappboxReport } from "./klappbox-farben.ts";

/**
 * 🔴 Die Klappbox-Regel für Werte (Design Guide §16.3 „Die Zahl wird hervorgehoben, das Wort nicht“, als allgemeine Regel für
 * strukturierte Werte, Betreiber 2026-10-04), hell und dunkel an den berechneten Farben:
 *
 * | Rolle | Farbe |
 * |---|---|
 * | Zahl (Mess-, Geldwert) | `--color-text-strong`, `tabular-nums` |
 * | Einheit, Abkürzung (%, Std., Schritt, D, S, H) | `--color-text-muted` |
 * | erläuternder Sekundärtext | `--color-text-muted` |
 * | Fließtext | `--color-text` |
 * | reiner Titel | `--color-text-strong` |
 *
 * Geprüft an Höhenprofil, Reisekosten, Schifffahrtshinweisen, der gemeinsamen Box der Landschaften und politischen Gebiete
 * (`route-areas`, WI-0081: ihr Deckel trägt ZWEI Zahlen) und der Klappbox „Reiseoptionen“: alle über
 * `AvmWert`/`AvmText`, keine Klappbox mit Sonderfarbe.
 */
const WINTER = "?route=Greifenfurt~Lowangen&startMonth=firun&startDay=1";
const SCHIFF = "?route=Boronaya~Moorburg&pathType=shortest&landTransport=lightRider&seaTransport=galley";
const TOGGLES = ["profile-toggle", "costs-toggle", "ships-toggle", "areas-toggle"];

async function open(page: Page, search: string): Promise<void> {
    await page.goto(`/${search}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    const tab = page.getByTestId("route-planner-tab");
    if ((await tab.getAttribute("aria-expanded")) !== "true") await tab.click();
}

/** Jede Zahl der Box hell mit Ziffern gleicher Breite, jede Einheit gedämpft, Kurzangabe und Titel nach ihrer Rolle. */
function pruefeWerte(report: KlappboxReport, token: { strong: string; muted: string; text: string }): void {
    const wo = report.box;
    expect(report.zahlenAnzahl, `${wo}: es gibt Zahlen`).toBeGreaterThan(0);
    expect(report.zahlen, `${wo}: Zahlen --color-text-strong`).toEqual([token.strong]);
    if (report.einheitenAnzahl > 0)
        expect(report.einheiten, `${wo}: Einheiten --color-text-muted`).toEqual([token.muted]);
    for (const ziffern of report.ziffern) expect(ziffern, `${wo}: tabular-nums`).toContain("tabular-nums");
    for (const farbe of report.kurzangabe) expect(farbe, `${wo}: Kurzangabe`).toBe(token.muted);
    for (const farbe of report.titel) expect(farbe, `${wo}: Titel`).toBe(token.strong);
    for (const farbe of report.fliesstext) expect(farbe, `${wo}: Fließtext`).toBe(token.text);
    for (const farbe of report.sekundaer) expect(farbe, `${wo}: Sekundärtext`).toBe(token.muted);
}

for (const scheme of ["light", "dark"] as const) {
    test(`🔴 Klappboxen: Zahl hell, Einheit gedämpft, Fließtext und Titel nach ihrer Rolle - Höhenprofil, Reisekosten, Landschaften und Gebiete: ${scheme}`, async ({
        page,
    }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await open(page, WINTER);
        await openKlappboxen(page, TOGGLES);
        const { token, boxes } = await klappboxFarben(page, ["planning-profile", "planning-costs", "route-areas"]);
        // Drei verschiedene Töne, sonst bewiese der Vergleich nichts.
        expect(new Set([token.strong, token.muted, token.text]).size).toBe(3);
        for (const report of boxes) pruefeWerte(report, token);

        const profile = boxes.find((report) => report.box === "planning-profile")!;
        // Steigung, Schritt, Stunden und die Kurzangabe: mehrere Zahlen und Einheiten, der Satz im Inhalt ist Fließtext.
        expect(profile.zahlenAnzahl).toBeGreaterThanOrEqual(6);
        expect(profile.einheitenAnzahl).toBeGreaterThanOrEqual(4);
        expect(profile.fliesstext.length).toBeGreaterThan(0);
        const costs = boxes.find((report) => report.box === "planning-costs")!;
        expect(costs.zahlenAnzahl).toBeGreaterThanOrEqual(5);
        expect(costs.einheitenAnzahl).toBeGreaterThanOrEqual(3);
        expect(costs.sekundaer.length).toBeGreaterThan(0);
        // 🔴 Der gemeinsame Deckel trägt BEIDE Zahlen hell (WI-0081): „Durch 19 Landschaften und 43 politische Gebiete“.
        const areas = boxes.find((report) => report.box === "route-areas")!;
        expect(areas.zahlenAnzahl, "zwei Zahlen im Deckel").toBeGreaterThanOrEqual(2);
        expect(areas.einheitenAnzahl, "keine Einheit im Deckel").toBe(0);

        // Der Satz im Inhalt des Höhenprofils: Zahl und Einheit einzeln, der Text darum bleibt Fließtext.
        const satz = await page.getByTestId("route-slope").evaluate((element) => ({
            text: getComputedStyle(element).color,
            einheiten: [...element.querySelectorAll(".wert__einheit")].map((einheit) => einheit.textContent),
        }));
        expect(satz.text).toBe(token.text);
        expect(satz.einheiten).toEqual(expect.arrayContaining(["%", "Schritt", "Stunden"]));

        // „Reiseoptionen“ ist seit WI-0089 P3 dieselbe Klappbox (`avm-disclosure.vue`) und fällt unter dieselbe Regel:
        // „Reiseoptionen: 8,0 h/Tag“ - Titel hell, Zahl hell, Einheit gedämpft.
        const { boxes: leisten } = await klappboxFarben(page, ["planner-options"]);
        pruefeWerte(leisten[0]!, token);
        expect(leisten[0]!.titel, "Titel der Leiste").toEqual([token.strong]);
        expect(leisten[0]!.kurzangabe, "Kurzangabe der Leiste").toEqual([token.muted]);
    });

    test(`🔴 Schifffahrtshinweise: Fließtext mit Zahl hell und Einheit „Stunden“ gedämpft: ${scheme}`, async ({
        page,
    }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await open(page, SCHIFF);
        await openKlappboxen(page, TOGGLES);
        const { token, boxes } = await klappboxFarben(page, ["planning-ships"]);
        const ships = boxes[0]!;
        pruefeWerte(ships, token);
        expect(ships.einheitenAnzahl).toBeGreaterThan(0);
        expect(ships.fliesstext).toEqual([token.text]);
    });
}
