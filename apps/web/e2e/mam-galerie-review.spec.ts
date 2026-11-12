import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { MIT_MEDIEN, bedieneMedienrouten, medienQuelle, schliesseMedienQuelle, stubSitzung } from "./medien-quelle.ts";

/**
 * Abnahmeblatt „Die Galerie bearbeiten“ (WI-0068 P6): Was in der Medienverwaltung an einer Galerie steht, seit die Handlungen
 * verdrahtet sind — die Liste mit „Neue Galerie“ und der Inspector mit Bildfolge, Zeichen je Bild und Ortsliste.
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt EIN Blatt vor, damit ein Mensch am Bild entscheidet, ob die Form trägt. Die Prüfungen
 * stehen in `apps/server/test/media-galerie-schreibpfad.test.ts` (22 Fälle) und `apps/web/test/medien-galerien.test.ts`.
 *
 * 🔴 Gezeigt wird eine ECHTE Galerie aus `avesmaps3d_dev`, und zwar die mit den MEISTEN Bildern: Nur dort steht die Frage, die am
 * Bild zu entscheiden ist — ob fünf Zeichen unter einer Kachel bei vier Spalten noch lesbar sind. Die Handlungen sind verdrahtet,
 * aber dieser Lauf klickt sie nicht: Die Leserouten kommen aus der Entwicklungsdatenbank, Schreiben ginge an den echten Server.
 *
 *   npm run review:mam-galerie
 *
 * Ablage: `review/wi-0068-p6/galerie-bearbeiten.png` (`review/` ist nicht versioniert); `REVIEW_DIR` setzt einen anderen Ordner.
 */

const OUTPUT = process.env["REVIEW_DIR"] ?? resolve(import.meta.dirname, "../../../review/wi-0068-p6");

type Schema = "light" | "dark";

async function oeffne(
    browser: Browser,
    baseURL: string,
    quelle: NonNullable<Awaited<ReturnType<typeof medienQuelle>>>,
    pfad: string,
    options: BrowserContextOptions,
): Promise<{ page: Page; close: () => Promise<void> }> {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 1440, height: 980 },
        ...options,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.0.${String(120 + Math.floor(Math.random() * 100))}` },
    });
    const page = await context.newPage();
    await stubSitzung(page, [...MIT_MEDIEN, "upload_media"]);
    await bedieneMedienrouten(page, quelle);
    await page.goto(pfad);
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.getByTestId("medien-fenster").waitFor({ timeout: 30_000 });
    return { page, close: () => context.close() };
}

/** Das Fenster als Bild, ohne die Karte darunter. */
async function fensterBild(page: Page): Promise<Buffer> {
    const fenster = page.getByTestId("medien-fenster");
    await fenster.waitFor();
    return fenster.screenshot();
}

test.describe("Abnahmeblatt: die Galerie bearbeiten (WI-0068 P6)", () => {
    test.afterAll(async () => {
        await schliesseMedienQuelle();
    });

    test("Liste und Inspector, hell und dunkel", async ({ browser, baseURL }) => {
        const quelle = await medienQuelle();
        test.skip(quelle === undefined, "Ohne DATABASE_URL gibt es keine echten Galerien.");
        if (quelle === undefined || baseURL === undefined) return;

        // Die Galerie mit den meisten Bildern: dort steht die Frage nach den Zeichen unter der Kachel.
        const liste = await quelle.galleryList(quelle.db, { limit: 200, offset: 0 });
        const voll = [...liste.items].sort((a, b) => b.items - a.items)[0];
        test.skip(voll === undefined, "In dieser Datenbank steht keine Galerie.");
        if (voll === undefined) return;

        mkdirSync(OUTPUT, { recursive: true });
        // Die beiden Auswahlfenster, hell: Bilder (bytegleiche Werke zusammengefasst) und Orte (mit Titelbild markiert).
        {
            const { page, close } = await oeffne(
                browser,
                baseURL,
                quelle,
                `/edit?medien&medien-objekt=galerien&medien-galerie=${voll.id}`,
                { colorScheme: "light" },
            );
            await page.getByTestId("medien-spalte-galerie").waitFor({ timeout: 30_000 });
            await page.getByTestId("medien-galerie-hochladen").click();
            await page.getByTestId("medien-galerie-bilder-fenster").waitFor({ timeout: 30_000 });
            // Die Vorschauen liegen unter `/media/` und laufen nicht über den Stub: erst warten, bis sie wirklich da sind.
            await page.waitForFunction(
                () =>
                    [...document.querySelectorAll('[data-testid="medien-auswahl-eintrag"] img')]
                        .slice(0, 8)
                        .every((bild) => (bild as HTMLImageElement).complete),
                undefined,
                { timeout: 30_000 },
            );
            await page.waitForTimeout(600);
            writeFileSync(resolve(OUTPUT, "galerie-bilder-waehlen.png"), await page.screenshot());
            await page.getByTestId("medien-galerie-bilder-abbrechen").click();
            await page.getByTestId("medien-galerie-binden").click();
            await page.getByTestId("medien-galerie-ort-fenster").waitFor({ timeout: 30_000 });
            // 🪤 Die testid sitzt an der Hülle des Feldes (`avm-eingabe.vue`), getippt wird in das `input` darin.
            await page.getByTestId("medien-galerie-ort-suche").locator("input").fill("Gareth");
            await page.waitForTimeout(800);
            writeFileSync(resolve(OUTPUT, "galerie-ort-waehlen.png"), await page.screenshot());
            await close();
        }
        for (const schema of ["light", "dark"] as Schema[]) {
            const { page, close } = await oeffne(
                browser,
                baseURL,
                quelle,
                `/edit?medien&medien-objekt=galerien&medien-galerie=${voll.id}`,
                { colorScheme: schema },
            );
            await page.getByTestId("medien-spalte-galerie").waitFor({ timeout: 30_000 });
            await page.getByTestId("medien-galerie-folge").waitFor({ timeout: 30_000 });
            await page.waitForTimeout(1200);
            writeFileSync(resolve(OUTPUT, `galerie-bearbeiten-${schema}.png`), await fensterBild(page));
            await close();
        }
        // eslint-disable-next-line no-console
        console.log(
            `Blatt: ${OUTPUT}\\galerie-bearbeiten-{light,dark}.png — Galerie ${voll.id} mit ${String(voll.items)} Bildern`,
        );
    });
});
