import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { stubReisebilder } from "./reisebild-stub.ts";
import { freeSpot, GARETH, openMap, showPlace } from "./map-handle.ts";

/**
 * „Meine Reisebilder“ am Telefon (WI-0272 S3, Fixrunde zum Review I4, M5c, M11): Die Karten laufen bei den Marken „Stand gerade nicht abrufbar“ und „Nicht mehr vorhanden“ nicht über den Rand (auch nicht
 * auf Französisch und bei 360 px, der häufigen Androidbreite), „Vergessen“ und „‹ Meine Reisebilder“ haben Fingerhöhe (44 px), und die Fenster der Reisebilder zeigen am Telefon kein ⧉, das nichts tut.
 * Der Rechner steht in `reisebild-merken.spec.ts`.
 *
 * Problemfälle: „Vergessen“ ragt aus der Karte, wenn die Marke lang ist; die Liste wird breiter als der Schirm; der Fingerknopf ist 24 px hoch; das Blatt trägt einen Knopf zum Lösen, der nichts löst.
 */

const SPEICHER = "avesmaps.reisebilder.gemerkt";
/** Gültige Schlüssel (43 Zeichen, base64url), je Nummer ein anderer. */
const schluessel = (nr: number): string => `${String(nr)}`.padStart(2, "0").repeat(21) + "A";
const K = [1, 2, 3].map(schluessel);

/** Was dieses Gerät schon gemerkt hat, bevor die Seite lädt. */
async function gemerktVorab(page: Page): Promise<void> {
    const eintraege = K.map((wert, nr) => ({
        schluessel: wert,
        gemerktAm: `2026-11-01T0${String(nr + 1)}:00:00.000Z`,
    }));
    await page.addInitScript(
        ([key, wert]) => {
            localStorage.setItem(key as string, wert as string);
        },
        [SPEICHER, JSON.stringify(eintraege)] as const,
    );
}

/** Der lange Druck: Finger auf, liegen lassen, los (Playwright kennt nur den kurzen Tipp). */
async function longPress(client: CDPSession, page: Page, at: { x: number; y: number }, hold = 800): Promise<void> {
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: at.x, y: at.y, id: 0 }] });
    await page.waitForTimeout(hold);
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** Die Liste „Meine Reisebilder“ über das Kartenmenü des langen Drucks. */
async function oeffneListe(page: Page, breite: number, sprache: string): Promise<void> {
    await page.setViewportSize({ width: breite, height: 740 });
    await openMap(page, `/?lang=${sprache}`);
    await showPlace(page, GARETH, 5);
    const spot = await freeSpot(page, { x: 60, y: 80 });
    const client = await page.context().newCDPSession(page);
    await longPress(client, page, spot);
    await page.getByTestId("context-meine-reisebilder").tap();
    await expect(page.getByTestId("reisebild-meine-fenster")).toBeVisible();
}

for (const breite of [360, 390]) {
    for (const sprache of ["de", "fr"]) {
        test(`🔴 Telefon ${String(breite)} px, ${sprache}: die Karten mit „nicht abrufbar“ und „nicht mehr vorhanden“ laufen nicht über, „Vergessen“ hat Fingerhöhe, kein ⧉`, async ({
            page,
        }) => {
            await gemerktVorab(page);
            await stubReisebilder(page, {
                statusJeSchluessel: {
                    // Ein Serverfehler betrifft nur seine Karte („nicht abrufbar“), ein 404 heißt „Nicht mehr vorhanden“.
                    [K[0]!]: { fehler: { status: 500, code: "photobox_server" } },
                    [K[1]!]: undefined,
                    [K[2]!]: { fehler: { status: 500, code: "photobox_server" } },
                },
            });
            await oeffneListe(page, breite, sprache);

            const marken = page.getByTestId("reisebild-meine-marke");
            await expect(marken).toHaveCount(3);
            const karten = page.getByTestId("reisebild-meine-karte");
            await expect(karten).toHaveCount(3);

            for (let nr = 0; nr < 3; nr += 1) {
                const karte = karten.nth(nr);
                // Nichts ragt über den Rand: weder die Karte selbst noch ihre rechte Spalte, die Marke oder „Vergessen“.
                const mass = await karte.evaluate((element) => {
                    const rahmen = element.getBoundingClientRect();
                    const aussen = (selektor: string): number[] =>
                        [...element.querySelectorAll<HTMLElement>(selektor)].map(
                            (kind) => kind.getBoundingClientRect().right - rahmen.right,
                        );
                    return {
                        scrollWidth: element.scrollWidth,
                        clientWidth: element.clientWidth,
                        rechts: [...aussen(".mr__marke"), ...aussen(".mr__vergessen"), ...aussen(".mr__rechts")],
                    };
                });
                expect(mass.scrollWidth, `Karte ${String(nr)}`).toBeLessThanOrEqual(mass.clientWidth);
                for (const ueberstand of mass.rechts)
                    expect(ueberstand, `Karte ${String(nr)}`).toBeLessThanOrEqual(0.5);
                const kasten = (await karte.boundingBox())!;
                expect(kasten.x + kasten.width, `Karte ${String(nr)} im Schirm`).toBeLessThanOrEqual(breite);

                // Fingerhöhe, ohne dass die Karte dafür wächst oder die Schrift größer wird.
                const vergessen = (await karte.getByTestId("reisebild-meine-vergessen").boundingBox())!;
                expect(vergessen.height, `Vergessen ${String(nr)}`).toBeGreaterThanOrEqual(43.5);
            }
            // Die Liste selbst und das Fenster werden nicht breiter als der Schirm.
            const liste = await page.getByTestId("reisebild-meine-fenster").evaluate((fenster) => ({
                scrollWidth: fenster.scrollWidth,
                clientWidth: fenster.clientWidth,
            }));
            expect(liste.scrollWidth).toBeLessThanOrEqual(liste.clientWidth);

            // Am Telefon steht im Kopf kein ⧉: Das Blatt lässt sich nicht lösen.
            await expect(page.getByTestId("fenster-loesen")).toHaveCount(0);

            // Die Statusseite, aus der Liste geöffnet: auch dort kein ⧉, und „‹ Meine Reisebilder“ hat Fingerhöhe.
            await karten.first().getByTestId("reisebild-meine-titel").tap();
            await expect(page.getByTestId("reisebild-status-fenster")).toBeVisible();
            await expect(page.getByTestId("fenster-loesen")).toHaveCount(0);
            const zurueck = (await page.getByTestId("reisebild-status-zurueck").boundingBox())!;
            expect(zurueck.height).toBeGreaterThanOrEqual(43.5);
        });
    }
}
