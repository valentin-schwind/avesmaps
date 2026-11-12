import { expect, test, type Page } from "@playwright/test";

/**
 * Tiefe Links öffnen ihre Ansicht (Betreiber 2026-10-19 zu `https://stage.avesmaps.de/edit#view=political`: „ich glaub du willst damit
 * die politische ansicht öffnen, aber das klappt nicht, insgesamt hats noch nie geklappt, wenn du ein link gepostet hat“).
 *
 * - Ein Hash nur mit Wahl (`#view=…`, `layer`, `topo`) öffnet sie an der Startlage (`readViewChoices`, `openingView`).
 * - Fehlen die Gebiete (abgemeldet hinter der Stage-Tür), zeigt die Karte die Standardansicht, aber die Adresse behält „Politisch“,
 *   damit Anmeldung und Discord-Umweg (`rememberView(location.hash)`) den Link zurückbringen.
 * - Hinter der Tür in der Form `/anmelden?ziel=…`: Das Fragment des Links geht mit nach `/edit`.
 *
 * Gelesen wird die Adresse, die die Karte selbst schreibt, sobald sie ruht: Sie trägt dann Ausschnitt UND Wahl.
 */

/** Der Hash, sobald die Karte ihn mit Ausschnitt geschrieben hat. */
async function geschrieben(page: Page): Promise<URLSearchParams> {
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await page.waitForFunction(() => globalThis.location.hash.includes("x="), undefined, { timeout: 15_000 });
    return new URLSearchParams((await page.evaluate(() => globalThis.location.hash)).slice(1));
}

test("🔴 `#view=powerlines` öffnet die Kraftlinien an der Startlage", async ({ page }) => {
    await page.goto("/#view=powerlines");
    const hash = await geschrieben(page);
    expect(hash.get("view")).toBe("powerlines");
    expect(Number(hash.get("z"))).toBeGreaterThan(0);
});

test("🔴 `#view=landscapes&layer=topographie&topo=hoehenstufen` öffnet Landschaft, Ebene und Unterwahl", async ({
    page,
}) => {
    await page.goto("/#view=landscapes&layer=topographie&topo=hoehenstufen");
    const hash = await geschrieben(page);
    expect(hash.get("view")).toBe("landscapes");
    expect(hash.get("layer")).toBe("topographie");
    expect(hash.get("topo")).toBe("hoehenstufen");
});

test("🔴 ein voller Link mit Ausschnitt öffnet weiter genau ihn", async ({ page }) => {
    await page.goto("/#x=551.625&y=532.969&z=6.00&series=modern&view=powerlines");
    const hash = await geschrieben(page);
    expect(hash.get("view")).toBe("powerlines");
    expect(Number(hash.get("z"))).toBeCloseTo(6, 1);
});

test("🔴 ohne Gebiete (abgemeldet hinter der Stage-Tür) behält die Adresse `view=political` für den Weg durch die Anmeldung", async ({
    page,
}) => {
    // Hinter der Tür beantwortet Nginx auch den Gebietszeiger mit der Anmeldeseite: für die Karte „keine Gebiete“.
    await page.route("**/api/territories/current", (route) =>
        route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Anmelden</title>" }),
    );
    await page.goto("/#view=political");
    const hash = await geschrieben(page);
    expect(hash.get("view"), "die Adresse behält den Link").toBe("political");
});

test("🔴 hinter der Tür als `/anmelden?ziel=/edit`: das Fragment des Links geht mit nach /edit", async ({ page }) => {
    await page.goto("/anmelden?ziel=/edit#view=powerlines");
    await expect.poll(() => page.evaluate(() => globalThis.location.pathname)).toBe("/edit");
    const hash = await geschrieben(page);
    expect(hash.get("view")).toBe("powerlines");
});
