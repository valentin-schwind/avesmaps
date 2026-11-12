import { expect, test } from "@playwright/test";
import { stubReisebilder, stubReisebilderKarte, type KartenBild } from "./reisebild-stub.ts";
import { GARETH, openMap, showPlace } from "./map-handle.ts";

/**
 * Die Bildansicht der Reisebilder am Telefon (WI-0272 S4, Aufgabe 30): Wischen blättert, die Zeile bleibt lesbar und so breit wie das Bild. Rechner und Texte: `reisebild-ansicht.spec.ts`.
 *
 * Problemfälle: die Zeile läuft über den Rand oder wird abgeschnitten; „Zur Stelle“ und „Melden“ sind unter dem Daumen nicht erreichbar; ein Wischen blättert nicht.
 */

const ID = (n: number): string => `00000000-0000-4000-8000-0000000004${String(n).padStart(2, "0")}`;
const bilder: KartenBild[] = [0, 1, 2].map((n) => ({
    id: ID(n),
    lage: { x: GARETH.x + 40 + n * 0.4, y: GARETH.y + 25 },
    name: "Rahja",
    beschreibung: `Bild Nummer ${String(n + 1)} mit einem etwas längeren Titel, damit die Zeile umbrechen muss`,
    ...(n === 1 ? { hochformat: true } : {}),
}));

test("🔴 Telefon: die Zeile bleibt im Bild und lesbar, die Taten sind erreichbar, Wischen blättert", async ({
    page,
}) => {
    await stubReisebilder(page);
    await stubReisebilderKarte(page, bilder);
    await openMap(page);
    await showPlace(page, { x: GARETH.x + 40, y: GARETH.y + 25 }, 9);
    await expect(page.getByTestId("reisebilder-knopf")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("reisebilder-knopf").click();
    await expect.poll(() => page.getByTestId("reisebild-kachel").count(), { timeout: 15_000 }).toBe(3);
    await page.getByTestId("reisebild-kachel").first().tap();
    await expect(page.getByTestId("reisebild-ansicht")).toBeVisible();
    const viewport = page.viewportSize()!;
    const zeile = (await page.getByTestId("bildansicht-zeile").boundingBox())!;
    expect(zeile.x).toBeGreaterThanOrEqual(0);
    expect(zeile.x + zeile.width).toBeLessThanOrEqual(viewport.width + 1);
    const stelle = (await page.getByTestId("reisebild-zur-stelle").boundingBox())!;
    expect(stelle.y + stelle.height).toBeLessThanOrEqual(viewport.height);
    expect(stelle.height).toBeGreaterThanOrEqual(28);

    // Wischen nach links blättert zum nächsten Bild.
    await expect(page.getByTestId("reisebild-stand")).toHaveText("1 von 3");
    const box = (await page.getByTestId("bildansicht-bild").boundingBox())!;
    const y = box.y + box.height / 2;
    const client = await page.context().newCDPSession(page);
    const punkt = (x: number) => [{ x, y, id: 1 }];
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: punkt(box.x + box.width * 0.8) });
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: punkt(box.x + box.width * 0.4) });
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(page.getByTestId("reisebild-stand")).toHaveText("2 von 3");
});
