import { expect, test } from "@playwright/test";
import { klappboxFarben, openKlappboxen } from "./klappbox-farben.ts";

/**
 * 🔴 Die Klappbox-Regel für Werte am Telefon (Design Guide §16.3, Betreiber 2026-10-04), hell und dunkel: dieselben Farben wie
 * am Rechner (`klappbox-werte.spec.ts`), an Höhenprofil, Reisekosten und der gemeinsamen Box der Landschaften und
 * politischen Gebiete (WI-0081) bei 360 px.
 */
const WINTER = "/?route=Greifenfurt~Lowangen&startMonth=firun&startDay=1";

for (const scheme of ["light", "dark"] as const) {
    test(`🔴 Am Telefon bei 360 px: Zahl hell, Einheit gedämpft, Titel und Kurzangabe nach ihrer Rolle: ${scheme}`, async ({
        page,
    }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width: 360, height: 800 });
        await page.goto(WINTER);
        await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, {
            timeout: 30_000,
        });
        const tab = page.getByTestId("route-planner-tab");
        if ((await tab.getAttribute("aria-expanded")) !== "true") await tab.tap();
        await openKlappboxen(page, ["profile-toggle", "costs-toggle", "areas-toggle"]);
        const { token, boxes } = await klappboxFarben(page, ["planning-profile", "planning-costs", "route-areas"]);
        expect(new Set([token.strong, token.muted, token.text]).size).toBe(3);
        for (const report of boxes) {
            expect(report.zahlenAnzahl, report.box).toBeGreaterThan(0);
            expect(report.zahlen, `${report.box}: Zahlen`).toEqual([token.strong]);
            if (report.einheitenAnzahl > 0) expect(report.einheiten, `${report.box}: Einheiten`).toEqual([token.muted]);
            for (const ziffern of report.ziffern) expect(ziffern, report.box).toContain("tabular-nums");
            for (const farbe of report.kurzangabe) expect(farbe, `${report.box}: Kurzangabe`).toBe(token.muted);
            for (const farbe of report.fliesstext) expect(farbe, `${report.box}: Fließtext`).toBe(token.text);
        }
    });
}
