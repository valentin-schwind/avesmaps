import { devices, expect, test, type Page } from "@playwright/test";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * „Neue Version“ im Browser (WI-0136 N1; seit WI-0146 in der Glocke statt in einem eigenen Kasten, Betreiber 2026-10-15 „A, A, ja“).
 *
 * - Der Abruf der eigenen Seite trägt `x-avm-versionsprobe`; der Test leitet nur ihn um und liefert eine Seite mit anderem Einstieg.
 * - 🔴 Erst dann wird der Glockenknopf am Rechner zur Pille „✦ Neue Version“, am Telefon zu ↺. Geladen wird nie von selbst.
 * - 🔴 Neu geladen wird aus der Klappe heraus; mit ungespeicherter Arbeit fragt sie erst nach, „Abbrechen“ lässt alles stehen.
 * - 🔴 Es gibt nur noch EINE Fläche: keinen Kasten daneben, eine Klappe, eine Rückfrage.
 */

async function neueSeiteAnbieten(page: Page): Promise<void> {
    await page.route("**/*", async (route) => {
        const request = route.request();
        if (request.headers()["x-avm-versionsprobe"] !== "1") return route.fallback();
        const antwort = await route.fetch({ headers: { ...request.headers(), "x-avm-versionsprobe": "" } });
        const html = (await antwort.text()).replace(/src="\/src\/main\.ts"/u, 'src="/src/main.ts?v=neu"');
        await route.fulfill({ response: antwort, body: html });
    });
}

async function pruefen(page: Page): Promise<void> {
    await page.evaluate(async () => {
        await (globalThis as { __avesmapsNeueVersion?: { pruefe(): Promise<void> } }).__avesmapsNeueVersion?.pruefe();
    });
}

test("🔴 die Pille kommt erst mit einer neuen Seite, und geladen wird nur auf Klick", async ({ page }) => {
    await stubAdmin(page);
    await page.goto("/edit");
    await expect(page.getByTestId("kopfleiste")).toBeVisible();
    const knopf = page.getByTestId("glocke-knopf");
    const wort = knopf.getByText("Neue Version");
    await pruefen(page);
    await expect(wort).toHaveCount(0);
    // 🔴 Kein zweites Bauteil mehr daneben (WI-0146).
    await expect(page.getByTestId("neue-version")).toHaveCount(0);

    await neueSeiteAnbieten(page);
    await pruefen(page);
    await expect(wort).toBeVisible();
    await expect(page.getByTestId("neue-version")).toHaveCount(0);

    // Nichts lädt von selbst: die Seite bleibt dieselbe, bis jemand klickt.
    await page.evaluate(() => ((globalThis as { __vorNeuladen?: boolean }).__vorNeuladen = true));
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (globalThis as { __vorNeuladen?: boolean }).__vorNeuladen)).toBe(true);
    await knopf.click();
    await expect(page.getByTestId("benachrichtigung-version")).toContainText("Neue Version verfügbar.");
    await Promise.all([page.waitForEvent("load"), page.getByTestId("glocke-neu-laden").click()]);
    expect(await page.evaluate(() => (globalThis as { __vorNeuladen?: boolean }).__vorNeuladen ?? false)).toBe(false);
});

test("🔴 mit ungespeicherter Arbeit fragt „Neu laden“ erst nach — an der einen Stelle", async ({ page }) => {
    await stubAdmin(page);
    await page.goto("/edit");
    await expect(page.getByTestId("kopfleiste")).toBeVisible();
    await neueSeiteAnbieten(page);
    await page.evaluate(() => {
        (globalThis as { __avesmapsUngespeichert?: (q: () => boolean) => void }).__avesmapsUngespeichert?.(() => true);
        (globalThis as { __vorNeuladen?: boolean }).__vorNeuladen = true;
    });
    await pruefen(page);
    await page.getByTestId("glocke-knopf").click();
    await page.getByTestId("glocke-neu-laden").click();
    await expect(page.getByTestId("glocke-klappe")).toContainText("Eine Bearbeitung ist noch nicht gespeichert.");
    await page.getByTestId("glocke-abbrechen").click();
    await expect(page.getByTestId("glocke-trotzdem")).toHaveCount(0);
    expect(await page.evaluate(() => (globalThis as { __vorNeuladen?: boolean }).__vorNeuladen)).toBe(true);
    await page.getByTestId("glocke-neu-laden").click();
    await Promise.all([page.waitForEvent("load"), page.getByTestId("glocke-trotzdem").click()]);
});

test("am Telefon wird die Glocke zu ↺; ihr Eintrag „Neue Version verfügbar“ lädt neu", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ ...devices["Pixel 7"], baseURL: String(baseURL) });
    const page = await context.newPage();
    await stubAdmin(page);
    await page.goto("/edit");
    await expect(page.getByTestId("kopfleiste")).toBeVisible();
    await neueSeiteAnbieten(page);
    await pruefen(page);
    const glocke = page.getByTestId("glocke-knopf");
    await expect(glocke).toContainText("↺");
    // Am Telefon ist für Worte kein Platz: die Pille bleibt dem Rechner.
    await expect(glocke.getByText("Neue Version")).toBeHidden();
    await glocke.click();
    await expect(page.getByTestId("benachrichtigung-version")).toContainText("Neue Version verfügbar.");
    await Promise.all([page.waitForEvent("load"), page.getByTestId("glocke-neu-laden").click()]);
    await context.close();
});

// --- Kurzinfo „Was ist neu?“ (WI-0137, VERSION-0001 §4; seit WI-0146 im Eintrag der Glocke, auch am Rechner) ----------------------

const KURZINFO = {
    stand: "2026-10-11T04:45:00+02:00",
    abschnitte: [
        {
            titel: "Anschauen",
            punkte: ["Zoomstufe 8: Die Karte zoomt eine Stufe näher heran.", "<b>Text bleibt Text</b>"],
        },
        { titel: "Prüfen", punkte: ["Routen ohne Kreuzungen."] },
        { titel: "Beachten", punkte: ["Bearbeiten bleibt auf Stage aus."] },
    ],
};

async function kurzinfoAnbieten(page: Page, kurzinfo: unknown = KURZINFO): Promise<void> {
    await page.route("**/api/version/kurzinfo", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(kurzinfo) }),
    );
}

test("🔴 die Klappe trägt die Kurzinfo: drei Abschnitte, Text bleibt Text, „Alle Änderungen“ führt zu Versionen; Escape schließt", async ({
    page,
}) => {
    await stubAdmin(page);
    await kurzinfoAnbieten(page);
    await page.goto("/edit");
    await expect(page.getByTestId("kopfleiste")).toBeVisible();
    await neueSeiteAnbieten(page);
    await pruefen(page);
    const knopf = page.getByTestId("glocke-knopf");
    await expect(knopf).toHaveAttribute("aria-expanded", "false");
    await knopf.click();
    await expect(knopf).toHaveAttribute("aria-expanded", "true");
    const eintrag = page.getByTestId("benachrichtigung-version");
    const kurz = eintrag.getByTestId("kurzinfo");
    await expect(kurz.locator("h3")).toHaveText(["Anschauen", "Prüfen", "Beachten"]);
    await expect(page.getByTestId("kurzinfo-anschauen").locator("li")).toHaveText([
        "Zoomstufe 8: Die Karte zoomt eine Stufe näher heran.",
        "<b>Text bleibt Text</b>",
    ]);
    await expect(kurz.locator("b")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(kurz).toHaveCount(0);
    await expect(knopf).toBeFocused();

    await knopf.click();
    await eintrag.getByTestId("kurzinfo-alle").click();
    await expect(page.getByRole("dialog", { name: "Systemsteuerung" })).toBeVisible();
    await expect(page.getByTestId("verwaltung-eintrag-versionen")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("glocke-klappe")).toHaveCount(0);
});

test("🔴 ohne geschriebene Kurzinfo und ohne `view_operations` steht nur „↺ Neu laden“; mit ungespeicherter Arbeit fragt es nach", async ({
    page,
}) => {
    await stubAdmin(page, { role: "editor", capabilities: ["use_editor_menu", "view_editor_series"] });
    await kurzinfoAnbieten(page, { stand: "2026-10-11T04:45:00+02:00", abschnitte: [] });
    await page.goto("/edit");
    await expect(page.getByTestId("kopfleiste")).toBeVisible();
    await neueSeiteAnbieten(page);
    await page.evaluate(() => {
        (globalThis as { __avesmapsUngespeichert?: (q: () => boolean) => void }).__avesmapsUngespeichert?.(() => true);
    });
    await pruefen(page);
    await page.getByTestId("glocke-knopf").click();
    const eintrag = page.getByTestId("benachrichtigung-version");
    await expect(eintrag.getByTestId("kurzinfo")).toHaveCount(0);
    await expect(page.getByTestId("kurzinfo-alle")).toHaveCount(0);
    await page.getByTestId("glocke-neu-laden").click();
    await expect(page.getByTestId("glocke-klappe")).toContainText("Eine Bearbeitung ist noch nicht gespeichert.");
});

test("🔴 am Telefon steht dieselbe Kurzinfo im Eintrag, mit „Alle Änderungen“ und „Neu laden“", async ({
    browser,
    baseURL,
}) => {
    const context = await browser.newContext({ ...devices["Pixel 7"], baseURL: String(baseURL) });
    const page = await context.newPage();
    await stubAdmin(page);
    await kurzinfoAnbieten(page);
    await page.goto("/edit");
    await expect(page.getByTestId("kopfleiste")).toBeVisible();
    await neueSeiteAnbieten(page);
    await pruefen(page);
    await page.getByTestId("glocke-knopf").click();
    const eintrag = page.getByTestId("benachrichtigung-version");
    await expect(eintrag.getByTestId("kurzinfo").locator("h3")).toHaveText(["Anschauen", "Prüfen", "Beachten"]);
    await expect(eintrag.getByTestId("glocke-neu-laden")).toBeVisible();
    await eintrag.getByTestId("kurzinfo-alle").click();
    await expect(page.getByRole("dialog", { name: "Systemsteuerung" })).toBeVisible();
    await expect(page.getByTestId("glocke-klappe")).toHaveCount(0);
    await context.close();
});
