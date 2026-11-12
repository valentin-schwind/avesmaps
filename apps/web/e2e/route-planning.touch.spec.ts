import { expect, test } from "@playwright/test";
import { expectLidRule, lidLines } from "./disclosure-lines.ts";
import { LID_ROUTES, openLids } from "./lid-routes.ts";
import { routeAnswer } from "./route-evidence.ts";

/**
 * 🔴 Die Deckel der Routendetails am Telefon (Betreiber 2026-10-03): „1 zeilig“, wo es passt; auf schmalen Geräten „A“ –
 * sonst rutscht die Kurzangabe als Ganzes in eine zweite Zeile unter den Titel. Nichts fehlt, nichts wird abgeschnitten.
 * Gemessen bei 320, 360 und 412 px (Pixel 7). Seit Höhe und Nächte aus der Kurzangabe gingen (Betreiber 2026-10-03:
 * „mach aus beiden wieder eine zeile“), ist bei 412 px jeder Deckel einzeilig.
 */
for (const width of [320, 360, 412]) {
    test(`🔴 Deckel bei ${width} px: nichts abgeschnitten, Kurzangabe notfalls als Ganzes in Zeile 2`, async ({
        page,
    }) => {
        await page.setViewportSize({ width, height: 800 });
        for (const route of LID_ROUTES) {
            const lids = await openLids(page, route.search);
            const lines = await lidLines(lids);
            expectLidRule(lines, `${width} px ${route.search}`);
            // 🔴 Der gemeinsame Deckel der Landschaften und Gebiete (WI-0081) hat keine Kurzangabe und bricht an seinen
            // Wörtern. Seit er ohne „Durch“ beginnt (Betreiber 2026-10-05), ist er bei 412 UND 360 px einzeilig;
            // bei 320 px bleiben zwei Zeilen - nie mehr. Gemessen, nicht gesetzt.
            const flaechen = lines.filter((lid) =>
                /^\d+ (?:Landschaft|Landschaften|politisches|politische)/.test(lid.text),
            );
            for (const lid of flaechen)
                expect(lid.lines, `${width} px ${route.search}: ${lid.text}`).toBeLessThanOrEqual(width >= 360 ? 1 : 2);
            if (width === 412) {
                for (const lid of lines) expect(lid.lines, `${route.search}: ${lid.text}`).toBe(1);
            }
            if (route.expect) await expect(lids.filter({ hasText: route.expect })).toHaveCount(1);
        }
    });
}

/**
 * Die Strecke der Kurzangabe mit Schnee. 🪤 Sie ist nur Träger: Greifenfurt → Lowangen trug früher ein Gefälle als
 * steilste Stelle (19 %), am 2026-10-29 eine Steigung (27 %; Code von Steigung und Kurzangabe unverändert, das Gelände ist
 * gewandert); dieselbe Strecke in Gegenrichtung hat ein Gefälle als steilste Stelle (-27 %) und damit die breiteste
 * Kurzangabe (mit Pfeil). Erwartet wird, was die Antwort des Servers verlangt; die Regel „Pfeil nur beim Gefälle“ steht in
 * `profile-costs.test.ts`.
 */
const SCHNEE_REISE = "?route=Lowangen~Greifenfurt&startMonth=firun&startDay=1";
const PFEIL = /\(bis \d+ % \u2193\uFE0E?, Schnee\)$/;
const KEIN_PFEIL = /\(bis \d+ %, Schnee\)$/;

/**
 * 🔴 Die Kurzangabe des Höhenprofils steht in EINER Zeile (Betreiber 2026-10-04: „+72,8 Std. (bis 19 %, Schnee)“, am Handy ohne
 * das Wort „Steigung“, Antwort „B“): bei 412 und 360 px mit und ohne Schnee (gemessen 227 px gegen 253 px Platz bei 360 px).
 * Bei 320 px (213 px) passt die Variante ohne Schnee (184 px), die mit Schnee (218 und 227 px) nicht: dort gilt „A“, die
 * Kurzangabe als Ganzes in Zeile 2, nichts abgeschnitten. Gemessen, nicht erzwungen.
 */
for (const width of [412, 360, 320]) {
    test(`🔴 Höhenprofil bei ${String(width)} px: die Kurzangabe ohne Schnee in einer Zeile, mit Schnee ${width === 320 ? "als Ganzes in Zeile 2" : "ebenso"}`, async ({
        page,
    }) => {
        await page.setViewportSize({ width, height: 800 });
        const kurz = await lidLines((await openLids(page, "?route=Punin~Fasar")).filter({ hasText: /^Höhenprofil: / }));
        expect(kurz).toHaveLength(1);
        expect(kurz[0]?.lines, kurz[0]?.text).toBe(1);
        // Die Strecke ist nur Träger (die breiteste Kurzangabe: Mehrzeit, steilste Stelle, Schnee); ob die steilste Stelle ein
        // Gefälle ist, sagt die Antwort des Servers.
        const answer = routeAnswer(page);
        const schnee = await lidLines(
            (await openLids(page, SCHNEE_REISE)).filter({
                hasText: /^Höhenprofil: /,
            }),
        );
        const route = await answer;
        expect(schnee).toHaveLength(1);
        expectLidRule(schnee, `${String(width)} px mit Schnee`);
        if (width >= 360) expect(schnee[0]?.lines, schnee[0]?.text).toBe(1);
        // Das Gefälle trägt den Pfeil, die Steigung nichts, und keins von beiden das Wort.
        const gefaelle = (route.slope?.steepest_grade ?? 0) < 0;
        expect(schnee[0]?.text).toMatch(gefaelle ? PFEIL : KEIN_PFEIL);
        expect(schnee[0]?.text).not.toContain("Steigung");
    });
}
