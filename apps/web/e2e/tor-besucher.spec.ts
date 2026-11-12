import { devices, expect, test, type Page } from "@playwright/test";
import { GARETH, openMap, showPlace } from "./map-handle.ts";
import { OHNE_WELT, WELT_TOKEN_DATEI } from "./welt.ts";

/**
 * Release-Tor, Kernabläufe 1 bis 4: was ein Besucher tut, gegen den ECHTEN Server des Kandidaten (WI-0264, `release-tor.json`). Kein
 * `page.route` auf `/api`: Karte, Suche, Infobox und Route kommen aus der Datenbank des Laufs (Testpaket), über Fastify und Martin.
 *
 * Ein Fall prüft das Ergebnis, das ein Mensch sieht, und dass der Server ohne 5xx und die Seite ohne Fehler geantwortet hat. Was die
 * Fachspecs im Detail prüfen (Abstände, Reihenfolgen, Texte), gehört nicht hierher: Das Tor soll nur fallen, wenn eine Kernfunktion fehlt.
 */

test.use({ viewport: { width: 1920, height: 1080 } });

/** Was dieser Fall von der Karte liest; der globale Griff ist schmaler getypt (wie `cartography.spec.ts`). */
interface KartenGriff {
    areTilesLoaded(): boolean;
    getStyle(): { sources: Record<string, unknown> };
}

/** Ein Punkt der Karte (Kartenkoordinaten) als Punkt der Seite, über die Projektion der Darstellung (wie `info-panel.spec.ts`). */
async function aufDerSeite(page: Page, punkt: { x: number; y: number }): Promise<{ x: number; y: number }> {
    const box = await page.getByTestId("map").boundingBox();
    const bild = await page.evaluate(
        (ziel) => globalThis.avesmapsMap!.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(ziel)),
        punkt,
    );
    return { x: (box?.x ?? 0) + bild.x, y: (box?.y ?? 0) + bild.y };
}

/** Jeder 5xx einer API-Antwort und jeder Fehler der Seite oder der Konsole. */
function horche(page: Page): string[] {
    const fehler: string[] = [];
    page.on("response", (r) => {
        if (r.url().includes("/api/") && r.status() >= 500)
            fehler.push(`${r.request().method()} ${r.url()} -> ${String(r.status())}`);
    });
    page.on("pageerror", (e) => fehler.push(`Fehler der Seite: ${e.message.slice(0, 200)}`));
    page.on("console", (m) => {
        if (m.type() === "error") fehler.push(`Konsole: ${m.text().slice(0, 200)}`);
    });
    return fehler;
}

test.describe("Tor: Besucher", () => {
    test.skip(WELT_TOKEN_DATEI === undefined, OHNE_WELT);

    test("1 die Karte lädt mit Kacheln und Gelände, ohne Fehler", async ({ page }) => {
        const fehler = horche(page);
        await openMap(page);
        await page.waitForFunction(
            () => (globalThis.avesmapsMap as unknown as KartenGriff | undefined)?.areTilesLoaded() === true,
            undefined,
            {
                timeout: 60_000,
            },
        );
        const quellen = await page.evaluate(() =>
            Object.keys((globalThis.avesmapsMap as unknown as KartenGriff).getStyle().sources),
        );
        expect(quellen.length, "die Karte hat Quellen").toBeGreaterThan(0);
        expect(fehler).toEqual([]);
    });

    test("2 die Suche „Gareth“ springt hin", async ({ page }) => {
        const fehler = horche(page);
        await openMap(page);
        await page.keyboard.press("f");
        const eingabe = page.getByTestId("search-input");
        await expect(eingabe).toBeFocused();
        await eingabe.fill("Gareth");
        await expect(page.getByTestId("search-hit").first()).toContainText("Gareth", { timeout: 15_000 });
        await eingabe.press("Enter");
        await expect(page.getByTestId("search")).toBeHidden();
        await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 15_000 });
        // Die Kamera steht in der Adresse (`#x=…&y=…&z=…`, Kartenkoordinaten): nach dem Sprung bei Gareth.
        await expect
            .poll(() => {
                const anker = new URLSearchParams(new URL(page.url()).hash.slice(1));
                return Math.hypot(Number(anker.get("x")) - GARETH.x, Number(anker.get("y")) - GARETH.y);
            })
            .toBeLessThan(2);
        expect(fehler).toEqual([]);
    });

    test("3 ein Klick auf einen Ort öffnet die Infobox", async ({ page }) => {
        const fehler = horche(page);
        await openMap(page);
        await showPlace(page, GARETH, 5);
        const punkt = await aufDerSeite(page, GARETH);
        await page.mouse.click(punkt.x, punkt.y);
        await expect(page.getByTestId("info-panel")).toBeVisible();
        await expect(page.getByTestId("info-title")).toHaveText("Gareth");
        await expect(page.getByTestId("info-subtitle")).toContainText("Metropole", { timeout: 15_000 });
        expect(fehler).toEqual([]);
    });

    test("4 die Route Gareth → Punin wird berechnet", async ({ page }) => {
        const fehler = horche(page);
        const [antwort] = await Promise.all([
            page.waitForResponse((r) => r.url().includes("/api/route?") && r.request().method() === "GET", {
                timeout: 60_000,
            }),
            page.goto("/?route=Gareth~Punin"),
        ]);
        expect(antwort.status(), await antwort.text()).toBe(200);
        await expect(page.getByTestId("route-planning")).toContainText("Routendetails", { timeout: 30_000 });
        await expect(page.getByTestId("planning-costs")).toBeVisible();
        expect(fehler).toEqual([]);
    });

    // Kernablauf Reisebilder (WI-0272 S4; `FEAT-0010` ist CUTOVER_REQUIRED): Die Beispielbilder der Welt (`tor-welt.ts`, `legeBeispieleAn`) erscheinen am Ort, der Knopf nennt eine Zahl, die Leiste
    // öffnet, eine Kachel öffnet die große Fassung aus `/media/…` mit Status 200. Gezählt als Fall 6, weil 5 der Fall am Telefon ist.
    test("6 Reisebilder: Symbol, Leiste und Bildansicht", async ({ page }) => {
        const fehler = horche(page);
        await openMap(page);
        await showPlace(page, GARETH, 5);
        const punkt = await aufDerSeite(page, GARETH);
        await page.mouse.click(punkt.x, punkt.y);
        await expect(page.getByTestId("info-title")).toHaveText("Gareth");

        const knopf = page.getByTestId("reisebilder-knopf");
        await expect(knopf, "der Knopf steht, die Beispielbilder sind da").toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId("reisebilder-knopf-zahl")).toHaveText(/^\d+\+?$/u, { timeout: 30_000 });
        await knopf.click();
        await expect(page.getByTestId("reisebilder-leiste")).toBeVisible();
        const kachel = page.getByTestId("reisebild-kachel").first();
        await expect(kachel).toBeVisible({ timeout: 30_000 });
        await kachel.click();
        const bild = page.getByTestId("bildansicht-bild");
        await expect(bild).toBeVisible();
        const quelle = (await bild.getAttribute("src")) ?? "";
        expect(quelle.startsWith("/media/"), quelle).toBe(true);
        expect((await page.request.get(quelle)).status(), quelle).toBe(200);
        await expect
            .poll(() => bild.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 15_000 })
            .toBeGreaterThan(0);
        expect(fehler).toEqual([]);
    });
});

test.describe("Tor: Besucher am Telefon", () => {
    test.skip(WELT_TOKEN_DATEI === undefined, OHNE_WELT);

    // Das Profil eines Telefons (Pixel 7) ohne `defaultBrowserType`: Playwright erlaubt den Browser nicht je Gruppe, Chromium genügt.
    const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices["Pixel 7"];
    test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });

    test("5 der Planer öffnet, die Seite zoomt nicht", async ({ page }) => {
        const fehler = horche(page);
        expect(page.viewportSize()!.width, "das Fenster ist ein Telefon").toBeLessThan(500);
        const [antwort] = await Promise.all([
            page.waitForResponse((r) => r.url().includes("/api/route?") && r.request().method() === "GET", {
                timeout: 60_000,
            }),
            page.goto("/?route=Gareth~Punin"),
        ]);
        expect(antwort.status(), await antwort.text()).toBe(200);
        await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, {
            timeout: 60_000,
        });

        // Am Telefon startet der Planer zu; der Griff öffnet ihn.
        const griff = page.getByTestId("route-planner-tab");
        await expect(griff).toHaveAttribute("aria-expanded", "false");
        await griff.tap();
        await expect(griff).toHaveAttribute("aria-expanded", "true");
        await expect(page.getByTestId("route-planning")).toContainText("Routendetails", { timeout: 30_000 });
        await page.getByTestId("options-toggle").tap();

        // Die Seite zoomt nicht: kein Doppeltipp-Zoom, kein Feld unter 16 px (iOS zoomt sonst beim Fokus hinein), nichts zu rollen.
        const seite = await page.evaluate(() => ({
            touchAction: getComputedStyle(document.documentElement).touchAction,
            klein: [...document.querySelectorAll<HTMLInputElement>("#route-planner-panel input")]
                .filter((eingabe) => eingabe.type !== "checkbox" && eingabe.type !== "radio")
                .map((eingabe) => [
                    eingabe.dataset["testid"] ?? eingabe.type,
                    Number.parseFloat(getComputedStyle(eingabe).fontSize),
                ])
                .filter(([, groesse]) => (groesse as number) < 16),
            seiteRollt: document.scrollingElement!.scrollHeight > window.innerHeight,
        }));
        expect(seite.touchAction).toBe("manipulation");
        expect(seite.klein, "Felder unter 16 px zoomen iOS beim Fokus hinein").toEqual([]);
        expect(seite.seiteRollt, "die Seite hat nichts zu rollen").toBe(false);
        expect(fehler).toEqual([]);
    });
});
