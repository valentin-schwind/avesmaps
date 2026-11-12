import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { oeffneStatistik } from "./besucherstatistik-stub.ts";
import { inhalteServer } from "./inhalte-stub.ts";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Das Bild der gebauten Statistik für den Betreiber (WI-0138): `review/wi-0138-besucherstatistik/panel-echt.png`.
 * Kein Prüftest - er nimmt nur auf, was die Anwendung zeichnet, mit Legacys echten Zahlen.
 */

const ZIEL = resolve(import.meta.dirname, "..", "..", "..", "review", "wi-0138-besucherstatistik");

test("Bild: die Statistik im Editorpanel", async ({ page }) => {
    // Hoch genug, damit das ganze Panel in ein Bild passt; die Anwendung selbst kennt diese Höhe nicht.
    await page.setViewportSize({ width: 1440, height: 2400 });
    await oeffneStatistik(page);
    await page.getByRole("tab", { name: "Status" }).click();
    await page.waitForTimeout(900);
    mkdirSync(ZIEL, { recursive: true });
    writeFileSync(resolve(ZIEL, "panel-echt.png"), await page.screenshot());
    writeFileSync(resolve(ZIEL, "panel-echt-nah.png"), await page.getByTestId("editor-panel").screenshot());
    // Die Herkunftskarte allein, für den Blick auf die Umrisse (Natural Earth, WI-0138 V8).
    writeFileSync(resolve(ZIEL, "herkunftskarte.png"), await page.locator(".statistik__karte").screenshot());

    // Die Editorenliste, eine Box offen (WI-0141b).
    await page.getByTestId("statistik-sorte-editoren").click();
    await page.getByTestId("editoren-liste").getByText("Rondrikan").click();
    await page.waitForTimeout(500);
    writeFileSync(resolve(ZIEL, "panel-editoren.png"), await page.getByTestId("editor-panel").screenshot());

    // Der vierte Unterreiter: die Last dieser Instanz (WI-0141).
    await page.getByTestId("statistik-sorte-server").click();
    await page.waitForTimeout(900);
    writeFileSync(resolve(ZIEL, "panel-server.png"), await page.getByTestId("editor-panel").screenshot());

    // Der dritte Unterreiter, eigenes Bild (WI-0138 V12).
    await page.getByTestId("statistik-sorte-api").click();
    await page.waitForTimeout(500);
    writeFileSync(resolve(ZIEL, "panel-api.png"), await page.getByTestId("editor-panel").screenshot());

    // Das Messfenster zuletzt: Es liegt frei über der Karte und würde die Panelbilder überlagern (WI-0138 V15). Es
    // hängt seit 2026-10-14 im Reiter „Server“, nicht mehr bei den Besuchern.
    await page.getByTestId("statistik-sorte-server").click();
    await page.waitForTimeout(1200);
    writeFileSync(resolve(ZIEL, "messwerte-angedockt.png"), await page.getByTestId("editor-panel").screenshot());
    await page.getByTestId("statistik-messfenster").click();
    await page.waitForTimeout(1400);
    writeFileSync(resolve(ZIEL, "messfenster.png"), await page.getByTestId("mess-fenster").screenshot());

    // Angedockt am rechten Rand, wie jedes Werkzeugfenster (Betreiber 2026-10-13).
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByTestId("mess-fenster").getByTestId("fenster-andocken").click();
    await page.waitForTimeout(600);
    writeFileSync(resolve(ZIEL, "messfenster-angedockt.png"), await page.screenshot());
});

/**
 * Das Ausklappen der Listen (WI-0191, Kanal OPS-000016): einmal zu, einmal offen. Beide Bilder zeigen denselben Block, damit
 * der Unterschied der Knopf ist und nicht der Ausschnitt.
 */
test("Bild: eine Liste zu und aufgeklappt", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1400 });
    await oeffneStatistik(page);
    await page.getByRole("tab", { name: "Status" }).click();
    const laender = page.getByTestId("editor-panel").locator('section:has(h3:text-is("Länder"))');
    await expect(laender).toBeVisible();
    mkdirSync(ZIEL, { recursive: true });
    writeFileSync(resolve(ZIEL, "liste-zu.png"), await laender.screenshot());

    await page.getByTestId("statistik-mehr-land").click();
    await page.waitForTimeout(200);
    writeFileSync(resolve(ZIEL, "liste-offen.png"), await laender.screenshot());

    // Der gekürzte Fall: zehn von 318 - der offene Block sagt es, statt „alle" zu behaupten.
    const suche = page.getByTestId("editor-panel").locator('section:has(h3:text-is("Gesuchte Ziele"))');
    await page.getByTestId("statistik-mehr-suche").click();
    await page.waitForTimeout(200);
    writeFileSync(resolve(ZIEL, "liste-gekuerzt.png"), await suche.screenshot());
});

test("Bild: der Schalter „Besucherzählung“ in der Systemsteuerung", async ({ page }) => {
    const server = inhalteServer();
    await stubAdmin(page, {
        capabilities: [...ADMIN_CAPABILITIES, "manage_system_settings", "access_restricted_mode"],
        role: "operator",
        person: { passkeyCount: 1 },
        answer: (call) => server.handle(call),
    });
    await page.goto("/edit");
    await page.getByTestId("kopfleiste-menue").click();
    await page.getByTestId("menue-systemsteuerung").click();
    await page.getByTestId("verwaltung-eintrag-inhalte").click();
    await expect(page.getByTestId("inhalte-betrieb")).toBeVisible();
    mkdirSync(ZIEL, { recursive: true });
    writeFileSync(
        resolve(ZIEL, "schalter-betrieb.png"),
        await page.getByTestId("inhalte-betrieb").locator("xpath=..").screenshot(),
    );
});
