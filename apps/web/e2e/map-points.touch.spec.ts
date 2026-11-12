import { expect, test } from "@playwright/test";
import { freeSpot, openMap } from "./map-handle.ts";

/**
 * Der lange Druck am Finger (WI-0030, WI-0063 4.3, seit WI-0108 neu belegt): Er ist der **Rechtsklick** und öffnet
 * das Kartenmenü (Betreiber 2026-10-08: „langer tap ist rechtsklick“). „Was ist hier?“ ist darin der erste Eintrag -
 * es verschwindet nicht, es wandert. iOS kennt kein `contextmenu`, die Karte misst den Druck deshalb selbst
 * (`map/interaction/long-press.ts`).
 *
 * 🪤 Playwright kennt nur den kurzen Tipp; der lange Druck kommt über CDP als echtes Touch-Ereignis. Ausführlich am
 * Menü: `kartenmenue.touch.spec.ts`; am echten Panel: `info-panel.touch.spec.ts`.
 */

test("🔴 Langer Druck öffnet das Kartenmenü, ein kurzer Tipp nicht - und „Was ist hier?“ steht darin", async ({
    page,
}) => {
    await openMap(page);
    const client = await page.context().newCDPSession(page);
    // 💣 Hier stand die MITTE des Fensters. Seit WI-0090 trägt jede Wegart eine unsichtbare Trefferfläche in der Breite
    // der Route (28 px am Finger), und mitten in der Karte liegt eine Straße: Der kurze Tipp wählte korrekt den Weg
    // („Nach Wulfenhag"), das Panel ging auf, und der Fall war dauerhaft rot - an der Stelle, nicht an der Zusicherung.
    // Gemessen wird deshalb an einer Stelle, die der Stil selbst als unbelegt ausweist (`freeSpot`).
    const { x, y } = await freeSpot(page);
    const press = async (ms: number): Promise<void> => {
        await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 0 }] });
        await page.waitForTimeout(ms);
        await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };

    await press(120);
    await page.waitForTimeout(700);
    await expect(page.getByTestId("map-context-menu")).toHaveCount(0);
    await expect(page.getByTestId("info-panel")).toBeHidden();

    await press(800);
    // Der lange Druck ist der Rechtsklick: dasselbe Menü, an derselben Stelle. Das Panel geht erst mit dem Eintrag auf.
    await expect(page.getByTestId("map-context-menu")).toBeVisible();
    await expect(page.getByTestId("info-panel")).toBeHidden();
    await page.getByTestId("context-what-is-here").tap();
    await expect(page.getByTestId("info-panel")).toBeVisible();
    await expect(page.getByTestId("map-context-menu")).toHaveCount(0);
});
