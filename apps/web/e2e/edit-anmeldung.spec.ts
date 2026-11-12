import { expect, test, type Page, type Route } from "@playwright/test";
import { EDITOR_MODE } from "./map-handle.ts";
import { ME, stubAdmin } from "./verwaltung-stub.ts";

/**
 * `/edit` ohne bestätigte Sitzung (WI-0203; Betreiber 2026-10-16 zu Review-Frage 6: „es soll das anmeldefenster kommen. wenn man
 * sich angemeldet hat, kommt der editormodus“). Bis dahin fiel die Seite nach 2,5 s ohne Antwort auf die Editor-Ansicht zurück:
 * alle Werkzeuge samt Serie `old`, aber keine Kopfleiste und kein „Anmelden“.
 *
 * Der Betreiber wählte am 2026-10-16 „Ja, wie rechts“ in der Simulation: Das Fenster geht auch bei klarem „nicht angemeldet“ auf;
 * ohne Antwort trägt es den Hinweis „gerade nicht erreichbar“ mit „Neu laden“, und die Seite fragt im Hintergrund weiter nach.
 *
 * Die Sitzung kommt aus einem Stub: Er antwortet gar nicht, zu spät, ohne oder mit einer Person. Karte und Kacheln liefert der echte
 * Entwicklungsserver.
 */

const EDITOR = ["view_flow_directions", "use_editor_menu", "view_editor_series"];
const EDITOR_SITZUNG = { environment: "staging", authEnabled: true, person: ME, capabilities: EDITOR };
const GAST = { environment: "staging", authEnabled: true, person: null, capabilities: [] };

const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function oeffne(page: Page): Promise<void> {
    await page.goto(EDITOR_MODE);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
}

const anmeldefenster = (page: Page) => page.getByRole("dialog", { name: "Anmelden" });

/** Die Werkzeuge der Editoren: Strömungsrichtungen im Auge, die Serie `old` im Fächer, das Editorpanel. */
async function werkzeuge(page: Page): Promise<{ stroemung: number; old: number; panel: number }> {
    await page.getByTestId("display-open").click();
    await expect(page.getByTestId("display-menu")).toBeVisible();
    const stroemung = await page.getByTestId("display-flow").count();
    await page.getByTestId("display-open").click();
    await page.getByTestId("fan-toggle").click();
    await page.getByTestId("fan-view-standard").hover();
    await page.getByTestId("fan-ohr-standard").click();
    await expect(page.locator("[data-testid^='fan-series-']").first()).toBeVisible();
    const old = await page.getByTestId("fan-series-old").count();
    await page.keyboard.press("Escape");
    return { stroemung, old, panel: await page.getByTestId("editor-panel").count() };
}

test("🔴 der Server antwortet nicht: das Anmeldefenster über der Besucherkarte, oben „Anmelden“, keine Werkzeuge", async ({
    page,
}) => {
    await page.route("**/api/auth/session", (route) => route.abort("connectionrefused"));
    await oeffne(page);
    await expect(anmeldefenster(page)).toBeVisible();
    await expect(page.getByTestId("anmelden-unerreichbar")).toContainText("Die Anmeldung ist gerade nicht erreichbar.");
    await page.keyboard.press("Escape");
    await expect(anmeldefenster(page)).toBeHidden();
    // Die Leiste steht, ohne Pille: Die Umgebung ist ohne Antwort unbekannt.
    await expect(page.getByTestId("kopfleiste")).toBeVisible();
    await expect(page.getByTestId("kopfleiste-umgebung")).toHaveCount(0);
    expect(await werkzeuge(page)).toEqual({ stroemung: 0, old: 0, panel: 0 });
    await page.getByTestId("kopfleiste-anmelden").click();
    await expect(anmeldefenster(page)).toBeVisible();
    await expect(page.getByTestId("anmelden-unerreichbar")).toBeVisible();
    const neu = page.waitForEvent("load");
    await page.getByTestId("anmelden-neu-laden").click();
    await neu;
    await expect(anmeldefenster(page)).toBeVisible();
});

test("🔴 der Server sagt klar „nicht angemeldet“: das Fenster geht von selbst auf, ohne Hinweis, mit Pille", async ({
    page,
}) => {
    await page.route("**/api/auth/session", (route) => json(route, 200, GAST));
    await oeffne(page);
    await expect(anmeldefenster(page)).toBeVisible();
    await expect(page.getByTestId("anmelden-unerreichbar")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(anmeldefenster(page)).toBeHidden();
    await expect(page.getByTestId("kopfleiste-umgebung")).toBeVisible();
    expect(await werkzeuge(page)).toEqual({ stroemung: 0, old: 0, panel: 0 });
});

test("die öffentliche Karte öffnet ohne Anmeldung kein Fenster", async ({ page }) => {
    await page.route("**/api/auth/session", (route) => json(route, 200, GAST));
    await page.goto("/");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(page.getByTestId("kopfleiste")).toHaveCount(0);
    await expect(anmeldefenster(page)).toBeHidden();
});

test("🔴 der Server antwortet zu spät: erst das Anmeldefenster ohne Werkzeuge, dann bringt die Nachfrage den Editormodus", async ({
    page,
}) => {
    // Die erste Anfrage beim Start hängt länger als 2,5 s; die Seite bricht sie ab. Die Nachfrage im Hintergrund kommt erst durch,
    // wenn der Test sie freigibt: sonst lädt die Seite unter Last neu, bevor der Test das Fenster gesehen hat.
    let anfragen = 0;
    let frei = false;
    await page.route("**/api/auth/session", async (route) => {
        anfragen += 1;
        if (anfragen === 1) {
            await new Promise((resolve) => setTimeout(resolve, 4_000));
            return json(route, 200, EDITOR_SITZUNG).catch(() => undefined);
        }
        return frei ? json(route, 200, EDITOR_SITZUNG) : route.abort("connectionrefused");
    });
    await oeffne(page);
    await expect(anmeldefenster(page)).toBeVisible();
    await expect(page.getByTestId("anmelden-unerreichbar")).toBeVisible();
    await expect(page.getByTestId("editor-panel")).toHaveCount(0);
    const neu = page.waitForEvent("load", { timeout: 45_000 });
    frei = true;
    await neu;
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(page.getByTestId("kopfleiste")).toContainText("Rondrikan");
    await expect(anmeldefenster(page)).toBeHidden();
    expect(await werkzeuge(page)).toEqual({ stroemung: 1, old: 1, panel: 1 });
});

test("🔴 nach der Anmeldung lädt die Seite neu, und der Editormodus kommt", async ({ page }) => {
    let angemeldet = false;
    await page.route("**/api/auth/session", (route) =>
        angemeldet ? json(route, 200, EDITOR_SITZUNG) : route.abort("connectionrefused"),
    );
    await page.route("**/api/auth/login", (route) => {
        angemeldet = true;
        return json(route, 200, { ok: true });
    });
    await oeffne(page);
    const fenster = anmeldefenster(page);
    await fenster.getByLabel("Benutzername:").fill("Rondrikan");
    await fenster.getByLabel("Avesmaps-Passwort:").fill("Rondra schützt die Tapferen");
    const neu = page.waitForEvent("load");
    await page.getByTestId("anmelden-absenden").click();
    await neu;
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(page.getByTestId("kopfleiste")).toContainText("Rondrikan");
    await expect(anmeldefenster(page)).toBeHidden();
    expect(await werkzeuge(page)).toEqual({ stroemung: 1, old: 1, panel: 1 });
});

test("die Gegenprobe: mit Sitzung der Editormodus wie bisher, kein Fenster", async ({ page }) => {
    await stubAdmin(page, { capabilities: EDITOR, role: "editor" });
    await oeffne(page);
    await expect(page.getByTestId("kopfleiste-menue")).toBeVisible();
    await expect(anmeldefenster(page)).toBeHidden();
    expect(await werkzeuge(page)).toEqual({ stroemung: 1, old: 1, panel: 1 });
});
