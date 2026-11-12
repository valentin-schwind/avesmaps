import { expect, test, type Page } from "@playwright/test";
import { hoehenmodellServer, hoehenmodellTestStand, type HoehenmodellServer } from "./hoehenmodell-stub.ts";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Die Werte von „19 (Test)“ im Eintrag „Höhenmodell“ (WI-0240; Entwurf mit V1 „Typ wählen“ abgenommen 2026-10-19) am Rechner, gegen den
 * Nachbau (`hoehenmodell-stub.ts`). Die Rechnung prüft `apps/web/test/hoehenmodell-test.test.ts`, die Route
 * `apps/server/test/hoehenmodell-test.test.ts`.
 *
 * Problemfälle: Speichern schickt nur das Getippte (dann fielen frühere Testwerte weg); Abnehmen geht mit Ungespeichertem; der Name
 * verliert „(Test)“; die Kachel eines Typs zeigt fremde Werte; ↺ setzt auf den gespeicherten statt auf den Wert der Datei.
 * `BILDER` (Ordner) legt die Bilder in 1920 × 1080, 1280 × 800 und 900 × 1000 dort ab, für die Sichtprüfung.
 */

const OPERATOR = [...ADMIN_CAPABILITIES, "manage_system_settings", "access_restricted_mode", "manage_terrain_recipe"];

async function oeffnen(page: Page, server: HoehenmodellServer): Promise<void> {
    await stubAdmin(page, {
        capabilities: OPERATOR,
        role: "operator",
        person: { passkeyCount: 1 },
        answer: (call) => server.handle(call),
    });
    await page.goto("/edit");
    await page.getByTestId("kopfleiste-menue").click();
    await page.getByTestId("menue-systemsteuerung").click();
    await expect(page.getByRole("dialog", { name: "Systemsteuerung" })).toBeVisible();
    await page.getByTestId("verwaltung-eintrag-hoehenmodell").click();
    await expect(page.getByTestId("hoehenmodell-test")).toBeVisible();
}

test("🔴 tippen, Grund, Speichern schickt den ganzen Stand; Abnehmen ruht, bis gespeichert ist", async ({ page }) => {
    const server = hoehenmodellServer(hoehenmodellTestStand());
    await oeffnen(page, server);

    await expect(page.getByTestId("verwaltung-eintrag-hoehenmodell")).toContainText("19 (Test)");
    await expect(page.getByTestId("hoehenmodell-fassung-19")).toContainText("Fassung 19 (Test) · FastScape");
    await expect(page.getByTestId("hoehenmodell-wirksam")).toContainText("Fassung 19 (Test), Revision 2");
    const zustand = page.getByTestId("hoehenmodell-test-zustand");
    await expect(zustand).toHaveText("Revision 2 gespeichert · die Karte ist damit gerechnet");
    await expect(page.getByTestId("hoehenmodell-test-speichern")).toBeDisabled();

    // Die Regler stehen in ihrer Kachel (Betreiber 2026-10-20: Reiter-Layout wie die Gebirgs-Presets).
    await page.getByTestId("hoehenmodell-test-kachel-gelaende-erosion").click();
    await page.getByTestId("hoehenmodell-test-feld-r:streamPowerK").locator("input").fill("0,1");
    await expect(zustand).toHaveText("Ungespeichert: 1 Wert · Speichern rechnet die Karte neu");
    await expect(page.getByTestId("hoehenmodell-test-offen-r:streamPowerK")).toHaveText("noch nicht gespeichert");
    await expect(page.getByTestId("hoehenmodell-abnehmen-19")).toBeDisabled();
    await expect(page.getByTestId("hoehenmodell-test-speichern")).toBeDisabled();

    await page.getByTestId("hoehenmodell-test-grund").locator("input").fill("kräftiger");
    await page.getByTestId("hoehenmodell-test-speichern").click();
    await expect
        .poll(() => server.posts.find((post) => post.path === "/test")?.body)
        .toMatchObject({
            baseRevision: 2,
            reason: "kräftiger",
            werte: {
                regler: { diffusion: 0.02, streamPowerK: 0.1 },
                presets: { typen: { bergland: { werte: { koernung: 24 } } } },
            },
        });
    await expect(zustand).toContainText("Revision 3 gespeichert");
    await expect(page.getByTestId("hoehenmodell-test-verlauf-3")).toContainText("0,08 → 0,1");
    await expect(page.getByTestId("hoehenmodell-test-feld-r:streamPowerK").locator("input")).toHaveValue("0,1");
});

test("Presets V1: die Kachel wählt den Typ und zählt Abweichungen; ↺ trägt den Wert der Datei ein", async ({
    page,
}) => {
    const server = hoehenmodellServer(hoehenmodellTestStand());
    await oeffnen(page, server);

    await expect(page.getByTestId("hoehenmodell-test-typ-bergland")).toContainText("1 abweichend");
    await expect(page.getByTestId("hoehenmodell-test-typ-kammgebirge")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("hoehenmodell-test-typ-bergland").click();
    // Die Körnung steht als Regler oben (Gebirgsform) und einzeln unter „Alle Werte“; beide führen dasselbe Feld.
    const feld = page.getByTestId("hoehenmodell-test-feld-regler:koernung").locator("input");
    await expect(feld).toHaveValue("24");
    await page.getByTestId("hoehenmodell-test-zurueck-regler:koernung").click();
    await expect(feld).toHaveValue("18");
    await page.getByTestId("hoehenmodell-test-alle-werte").click();
    await expect(page.getByTestId("hoehenmodell-test-feld-p:bergland:koernung").locator("input")).toHaveValue("18");
    await expect(page.getByTestId("hoehenmodell-test-typ-bergland")).toContainText("1 geändert");
    await expect(page.getByTestId("hoehenmodell-test-zustand")).toHaveText(
        "Ungespeichert: 1 Wert · Speichern rechnet die Karte neu",
    );
});

// 💣 Bild-Erzeuger, keine Zusicherung (WI-0248 S1): Der Fall ist nur MIT `BILDER` registriert. Ein `test.skip(...)` dagegen zählte im
// Release-Lauf als übersprungen (`stats.skipped`) und machte jeden Browserteil unvollständig; ohne Schalter gibt es den Fall gar nicht.
const bilderOrdner = process.env["BILDER"];
if (bilderOrdner !== undefined)
    test("Bilder in 1920 × 1080, 1280 × 800 und 900 × 1000", async ({ page }) => {
        const ordner = bilderOrdner;
        for (const [breite, hoehe] of [
            [1920, 1080],
            [1280, 800],
            [900, 1000],
        ] as const) {
            await page.setViewportSize({ width: breite, height: hoehe });
            await oeffnen(page, hoehenmodellServer(hoehenmodellTestStand()));
            await page.screenshot({ path: `${ordner}/${String(breite)}-1-oben.png` });
            await page.getByTestId("hoehenmodell-test-panel-gelaende").scrollIntoViewIfNeeded();
            await page.getByTestId("hoehenmodell-test-kachel-gelaende-erosion").click();
            await page.getByTestId("hoehenmodell-test-feld-r:streamPowerK").locator("input").fill("0,1");
            await page.getByTestId("hoehenmodell-test-leiste").scrollIntoViewIfNeeded();
            await page.screenshot({ path: `${ordner}/${String(breite)}-2-werte.png` });
            await page.getByTestId("hoehenmodell-test-kachel-gebirgsform-gipfel").click();
            await page.getByTestId("hoehenmodell-test-panel-gebirgsform").scrollIntoViewIfNeeded();
            await page.screenshot({ path: `${ordner}/${String(breite)}-2b-gebirgsform.png` });
            await page.getByTestId("hoehenmodell-test-kachel-landschaften-vegetation.wald").click();
            await page.getByTestId("hoehenmodell-test-panel-landschaften").scrollIntoViewIfNeeded();
            await page.screenshot({ path: `${ordner}/${String(breite)}-2c-landschaften.png` });
            await page.getByTestId("hoehenmodell-test-typ-bergland").click();
            await page.getByTestId("hoehenmodell-test-panel-presets").scrollIntoViewIfNeeded();
            await page.screenshot({ path: `${ordner}/${String(breite)}-3-presets.png` });
            // Die Typwerte des Rückennetzes unter „Alle Werte“ (WI-0246).
            await page.getByTestId("hoehenmodell-test-alle-werte").click();
            await page.getByTestId("hoehenmodell-test-feld-n:bergland:form.grat").scrollIntoViewIfNeeded();
            await page.screenshot({ path: `${ordner}/${String(breite)}-3b-rueckennetz.png` });
            await page.getByTestId("hoehenmodell-test-panel-stufen").scrollIntoViewIfNeeded();
            await page.screenshot({ path: `${ordner}/${String(breite)}-4-stufen.png` });
            await page.getByTestId("hoehenmodell-test-verlauf").scrollIntoViewIfNeeded();
            await page.screenshot({ path: `${ordner}/${String(breite)}-5-verlauf.png` });
        }
    });
