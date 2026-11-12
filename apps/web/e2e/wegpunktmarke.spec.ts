import { expect, test, type Page } from "@playwright/test";
import { openStageGroups } from "./stage-groups.ts";
import { ketteGegenAnker, vierMarken } from "./wegpunktmarke.ts";

/**
 * 🔴 **DIE WEGPUNKTMARKE IST OBEN UND UNTEN GLEICH GROSS** (WI-0097, Betreiber 2026-10-07: „die icons der
 * wegpunktmarkierung und der tropfen sollten im routenplaner und bei den etappen gleich groß sein").
 *
 * 💣 **Warum dieser Wächter:** Form und Farbe der Marke stehen seit WI-0087 P6 an EINER Stelle
 * (`waypoint-mark-shape.ts`), und die Kommentare an beiden Aufrufen sagten „DIESELBE Marke". Die GRÖSSE stand
 * trotzdem zweimal da - oben die Vorgabe 18, unten ein `:size="13"`. Gemessen am Bild (vierfache Pixeldichte):
 * Ring 18 × 18 oben gegen 13 × 13 unten, Nadel 14 × 24 gegen 10 × 17, also Faktor 1,385. Eine Zusicherung „die
 * Marke ist da" hätte das nie gefunden; deshalb messen beide Stellen hier im GLEICHEN Lauf und werden verglichen.
 *
 * Gemessen wird die Tinte im gezeichneten Bild, nicht das Stylesheet (Guide §3.2) - die Rechnung steht in
 * `wegpunktmarke.ts`.
 */

/** Die Reise aus dem Bildschirmfoto des Betreibers: Start, Zwischenziel, Ziel - Ring, Ring, Nadel. */
const REISE = "?route=Gareth~Perricum~Berchweiler";

/**
 * 🪤 **Ein halbes CSS-Pixel Spiel, nicht null.** Die Spitze der Nadel ist ein auslaufender Zipfel; wo sie auf einem
 * Bruchteil eines Gerätepixels sitzt, zählt die äußerste Reihe einmal mit und einmal nicht (gemessen 2026-10-07:
 * 23,75 px oben gegen 23,50 px unten im dunklen Thema, bei identischem Kasten von 24 px). Mehr als ein halbes Pixel
 * ist keine Rundung mehr, sondern ein Größenunterschied.
 */
const SPIEL = 0.5;

async function openRoute(page: Page): Promise<void> {
    await page.goto(`/${REISE}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(page.getByTestId("route-stages")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("route-station").first()).toBeVisible({ timeout: 20_000 });
    const tab = page.getByTestId("route-planner-tab");
    if ((await tab.getAttribute("aria-expanded")) !== "true") await tab.click();
    await openStageGroups(page);
}

/** Beide Marken im GLEICHEN Lauf messen und vergleichen - getrennte Läufe wären zwei Aussagen, nicht eine. */
async function gleicheGroesse(page: Page): Promise<void> {
    const masse = await vierMarken(page);
    for (const [was, oben, unten] of [
        ["Ring (Start und Zwischenziel)", masse.ringOben, masse.ringUnten],
        ["Nadel (Ziel)", masse.nadelOben, masse.nadelUnten],
    ] as const) {
        expect(oben.tinte.breite, `${was}: oben ist Tinte zu sehen`).toBeGreaterThan(0);
        expect(unten.tinte.breite, `${was}: unten ist Tinte zu sehen`).toBeGreaterThan(0);
        expect(
            Math.abs(oben.tinte.breite - unten.tinte.breite),
            `${was}: gleich BREIT - oben ${String(oben.tinte.breite)} px, unten ${String(unten.tinte.breite)} px`,
        ).toBeLessThanOrEqual(SPIEL);
        expect(
            Math.abs(oben.tinte.hoehe - unten.tinte.hoehe),
            `${was}: gleich HOCH - oben ${String(oben.tinte.hoehe)} px, unten ${String(unten.tinte.hoehe)} px`,
        ).toBeLessThanOrEqual(SPIEL);
        // Der Layoutkasten muss dazu passen: Eine Marke, die im Kasten schrumpft, wäre ein zweiter Weg zum Fehler.
        expect(oben.kasten, `${was}: derselbe Kasten oben und unten`).toEqual(unten.kasten);
    }
}

test.describe("Rechner, helles Thema", () => {
    test.use({ deviceScaleFactor: 4, viewport: { width: 1280, height: 1000 } });

    test("🔴 M1: Wegpunkteingabe und Etappenliste zeigen Ring und Nadel in DERSELBEN Größe", async ({ page }) => {
        await openRoute(page);
        await gleicheGroesse(page);
    });

    test("M2: die größere Marke verschiebt die Kette nicht und schiebt keine Zeile auf", async ({ page }) => {
        await openRoute(page);
        /**
         * 🔴 Die Zusicherung aus WI-0079 §1.2 bleibt: Die Kette beginnt und endet am Ankerpunkt der ersten und
         * letzten sichtbaren Marke. Sie hängt an einem ANTEIL der Markenhöhe, gilt also in jeder Größe - und genau
         * das wird hier nachgewiesen, nachdem die Marke der Liste von 13 auf 18 px gewachsen ist.
         */
        const kette = await ketteGegenAnker(page);
        expect(kette.stuecke, "die Kette besteht aus Stücken").toBeGreaterThan(0);
        expect(Math.abs(kette.oben), `Anfang der Kette am Anker: ${String(kette.oben)} px`).toBeLessThan(1.5);
        expect(Math.abs(kette.unten), `Ende der Kette am Anker: ${String(kette.unten)} px`).toBeLessThan(1.5);

        const zeilen = await page.evaluate(() => {
            const stationen = [...document.querySelectorAll('[data-testid="route-station"]')];
            const letzte = stationen[stationen.length - 1];
            const spur = getComputedStyle(
                document.querySelector('[data-testid="route-stages"]') as Element,
            ).getPropertyValue("--mark-size");
            return {
                hoehen: stationen.map((zeile) => Math.round(zeile.getBoundingClientRect().height * 100) / 100),
                nadelSpanBreite:
                    Math.round((letzte?.querySelector(".station__mark")?.getBoundingClientRect().width ?? 0) * 100) /
                    100,
                spur: spur.trim(),
            };
        });
        /**
         * 🔴 **Keine Zeile wächst mit der Marke.** Die Höhe einer Station kommt aus ihrem zweizeiligen Text
         * (13 px Name plus 11 px Zweitzeile), nicht aus der Marke; die Nadel ist mit 24 px niedriger. Nachgewiesen
         * wird das daran, dass die Zeile mit der NADEL genauso hoch ist wie die Zeilen mit dem Ring - wäre die
         * Marke das höhere Glied, wäre die letzte Zeile 7 px höher.
         */
        const erste = zeilen.hoehen[0] ?? 0;
        for (const hoehe of zeilen.hoehen) {
            expect(
                Math.abs(hoehe - erste),
                `alle Stationszeilen gleich hoch: ${JSON.stringify(zeilen.hoehen)}`,
            ).toBeLessThan(0.5);
        }
        /**
         * ⭐ Die Nadel füllt die Markenspur der Liste jetzt genau aus: 14 px Bild plus 3 px Grund je Seite sind die
         * 20 px von `--mark-size`. Das ist der Wert, aus dem die gemeinsame Größe abgeleitet ist (WI-0097); vorher
         * standen dort 16 von 20 px.
         */
        expect(`${String(zeilen.nadelSpanBreite)}px`, "die Nadel füllt die Markenspur").toBe(zeilen.spur);
    });
});

test.describe("Telefonbreite, dunkles Thema", () => {
    test.use({ deviceScaleFactor: 4, viewport: { width: 360, height: 900 }, colorScheme: "dark" });

    test("🔴 M3: gleich groß auch bei 360 px und im dunklen Thema", async ({ page }) => {
        await openRoute(page);
        await gleicheGroesse(page);
    });
});
