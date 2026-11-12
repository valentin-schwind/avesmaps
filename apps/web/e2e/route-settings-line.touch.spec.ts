import { expect, test } from "@playwright/test";
import { openOverview, settingsLine } from "./route-settings-line.ts";

/**
 * 🔴 Die Einstellungszeile am Telefon (Betreiber 2026-10-04: „one line“; „die transportmittel kannst du weglassen“; „A
 * aber datum braucht es nicht, da steht schon drunter“; „lasst das 8.0/Tag auch weg, steht ja ein paar zeilen drüber“):
 * EINE Zeile bei 320, 360 und 412 px, unter dem Titel, ohne Transportmittel, Reisebeginn und Reisestunden. Die Zeile hat
 * Platz von 292 px (412), 272 px (360) und 232 px (320): Das Panel ist 304, 284 und 244 px breit, abzüglich 2 × 6 px
 * Einrückung. Gemessen (Textbreite): „Schnellste Route“ 83 px, „Flug“ 22 px, die längste Zeile „Schnellste Route · Umsteigen
 * minimieren“ 205 px (englisch „Shortest route · Minimize transfers“ 174 px). **Alles passt bei jeder Breite ohne „…“.**
 *
 * Die Kürzung am Ende (Regel A, `.einzeilig`) bleibt als Sicherheit; ein Text, der zu lang wäre, wird auf dem Telefon
 * gezwungen: eine Zeile, „…“, der volle Text im DOM.
 */

/** Kurz: Kürzeste Route. */
const SHORT = "?route=@395.53,712.67~@539.63,620.53&pathType=shortest&landTransport=lightRider&seaTransport=galley";
/** Die längste Zeile: Routenart und Umsteigen; Reisebeginn und Reisestunden stehen nicht darin. */
const LONGEST = "?route=Gareth~Perricum&minimizeTransfers=1&startMonth=firun&startDay=15&restHours=14";

for (const width of [320, 360, 412]) {
    test(`🔴 Einstellungszeile bei ${width} px: eine Zeile, nichts abgeschnitten, die Sicherheit kürzt am Ende`, async ({
        page,
    }) => {
        await page.setViewportSize({ width, height: 800 });

        const short = await openOverview(page, SHORT);
        await expect(short).toHaveText("Kürzeste Route");
        const fits = await settingsLine(page);
        expect(fits.lines, `${width} px kurz`).toBe(1);
        expect(fits.belowTitle).toBe(true);
        expect(fits.truncated, `${width} px kurz: nichts abgeschnitten`).toBe(false);

        const flight = await openOverview(page, "?route=Gareth~Perricum&air=griffin&startMonth=firun&startDay=15");
        await expect(flight).toHaveText("Flug");
        expect((await settingsLine(page)).truncated, `${width} px Flug`).toBe(false);

        const long = await openOverview(page, LONGEST);
        await expect(long).toHaveText("Schnellste Route · Umsteigen minimieren");
        const longest = await settingsLine(page);
        expect(longest.lines, `${width} px längste`).toBe(1);
        expect(longest.height).toBeLessThan(longest.lineHeight * 1.5);
        expect(longest.truncated, `${width} px längste: nichts abgeschnitten`).toBe(false);
        expect(longest.text).not.toMatch(/Firun|h\/Tag|\d/);
        expect(longest.title).toBe(longest.text);

        // Die Sicherheit: Wäre der Text zu lang, bliebe es EINE Zeile mit „…“, und der volle Text stünde im DOM.
        const forced =
            "Schnellste Route · Umsteigen minimieren · ein sehr langer künftiger Zusatz, der nie in eine Zeile passt";
        await long.evaluate((element, text) => (element.textContent = text), forced);
        const cut = await settingsLine(page);
        expect(cut.lines, `${width} px erzwungen`).toBe(1);
        expect(cut.height).toBeLessThan(cut.lineHeight * 1.5);
        expect(cut.truncated).toBe(true);
        expect(cut.ellipsis).toBe("ellipsis");
        expect(cut.text).toBe(forced);
    });
}
