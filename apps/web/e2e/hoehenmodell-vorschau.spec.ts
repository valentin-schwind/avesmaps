import { expect, test, type Page } from "@playwright/test";
import { hoehenmodellServer, hoehenmodellTestStand, type HoehenmodellServer } from "./hoehenmodell-stub.ts";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Die Gebirgs-Presets von „19 (Test)“ in drei Bereichen mit dreizehn Reglern, jeder mit Schema (WI-0249 P8, Entwurf zum Ausprobieren; Betreiber
 * 2026-10-24: „ich glaub die editoren wollen doch nur ‚Schema‘. direkt den slider im schema wirken zu sehen ist außerordentlich hilfreich“): Der
 * Regler stellt das Feld und verformt das Schema, ein zusammenfassender Regler schreibt seine Einzelwerte, die zugeklappten „Alle Werte“ führen sie
 * unverändert, jeder mit eigenem Satz und, wo es eines gibt, Schema und Schieber. Die Formeln dahinter prüfen `apps/web/test/hoehenmodell-schema.test.ts`
 * (gegen die Rechnung des Rückennetzes) und `hoehenmodell-regler.test.ts`.
 *
 * Problemfälle: Der Regler ändert nur die Zeichnung, nicht das Feld (und damit nicht den Entwurf); ein Regler mit mehreren Werten schreibt nur
 * einen; das bloße Anfassen überschreibt Einzelwerte; die Vorschau sprengt die Zeile; es gibt noch einen Umschalter der Darstellung oder eine
 * Mini-Rechnung. `BILDER` (Ordner) legt die Bilder in 1920 × 1080, 1280 × 800 und 900 × 1000 dort ab.
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

const vorschau = (page: Page, key: string) => page.getByTestId(`hoehenmodell-vorschau-${key}`);
const feld = (page: Page, key: string) => page.getByTestId(`hoehenmodell-test-feld-${key}`).locator("input");
const regler = (page: Page, key: string) => page.getByTestId(`hoehenmodell-vorschau-regler-${key}`);

test("🔴 drei Bereiche mit dreizehn Reglern, jeder mit Schema; weder Umschalter noch Mini-Rechnung", async ({
    page,
}) => {
    await oeffnen(page, hoehenmodellServer(hoehenmodellTestStand()));
    for (const bereich of ["form", "rinnen", "gelaende"])
        await expect(page.getByTestId(`hoehenmodell-test-regler-bereich-${bereich}`)).toBeVisible();
    await expect(page.getByTestId("hoehenmodell-test-regler-bereich-form")).toHaveText("Gebirgsform");
    await expect(page.getByTestId("hoehenmodell-test-regler-bereich-rinnen")).toHaveText("Rinnen in der Vorschau");
    await expect(page.getByTestId("hoehenmodell-test-regler-bereich-gelaende")).toHaveText("Im fertigen Gelände");
    await expect(page.getByTestId("hoehenmodell-test-regler-kammhoehe")).toContainText("Kammhöhe");

    // Zwölf Zeilen mit Zahl; dazu das Grundmuster, dessen Zeile den Schlüssel des Typs trägt.
    const reglerZeilen = page
        .getByTestId("hoehenmodell-test-regler")
        .locator('[data-testid^="hoehenmodell-test-regler:"]');
    await expect(reglerZeilen).toHaveCount(12);
    await expect(page.getByTestId("hoehenmodell-test-m:kammgebirge")).toBeVisible();
    await expect(page.locator('[data-testid^="hoehenmodell-vorschau-regler:"]')).toHaveCount(13);
    await expect(page.locator('[data-testid^="hoehenmodell-vorschau-schema-bild-regler:"]')).toHaveCount(13);
    // Zwölf Schieber: Das Grundmuster ist eine Wahl.
    await expect(page.locator('[data-testid^="hoehenmodell-vorschau-regler-regler:"]')).toHaveCount(12);
    // Keine Darstellung zum Umschalten, keine Leinwand der Mini-Rechnung.
    await expect(page.locator('[data-testid^="hoehenmodell-vorschau-art-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="hoehenmodell-vorschau-leinwand-"]')).toHaveCount(0);
    await expect(page.getByTestId("hoehenmodell-test").locator("canvas")).toHaveCount(0);
});

test("🔴 Massigkeit: das Schema steht da, der Regler stellt Hypsometrie, Talboden und Ziel zugleich", async ({
    page,
}) => {
    await oeffnen(page, hoehenmodellServer(hoehenmodellTestStand()));
    const key = "regler:massigkeit";
    await vorschau(page, key).scrollIntoViewIfNeeded();
    await expect(page.getByTestId(`hoehenmodell-vorschau-schema-bild-${key}`)).toBeVisible();
    await expect(page.getByTestId(`hoehenmodell-vorschau-unterschrift-${key}`)).toContainText("Querschnitt");
    // Schema links, Schieber und Satz rechts daneben (am Rechner).
    const bild = await page.getByTestId(`hoehenmodell-vorschau-schema-${key}`).boundingBox();
    const schieber = await regler(page, key).boundingBox();
    expect(bild !== null && schieber !== null && bild.x < schieber.x).toBe(true);

    // Das Preset der Fassung 19 (Kammgebirge): Hypsometrie 0,45 steht über dem Bereich des Reglers, er steht auf 1.
    await expect(feld(page, key)).toHaveValue("1");
    await expect(page.getByTestId(`hoehenmodell-test-hinweis-vorschlag-${key}`)).toContainText("Vorschlag");
    await expect(page.getByTestId(`hoehenmodell-test-hinweis-abweichung-${key}`)).toContainText(
        "Talboden 0,3 (Regler: 0,85)",
    );

    // Bloßes Anfassen ohne anderen Wert ändert nichts.
    await feld(page, key).fill("1");
    await expect(page.getByTestId("hoehenmodell-test-zustand")).toHaveText(
        "Revision 2 gespeichert · die Karte ist damit gerechnet",
    );

    // Ziehen: Feld, Satz und Zustand der Leiste folgen; drei Werte sind geändert.
    const schemaVorher = await page.getByTestId(`hoehenmodell-vorschau-schema-bild-${key}`).innerHTML();
    await regler(page, key).fill("0.5");
    await expect(feld(page, key)).toHaveValue("0,5");
    await expect(page.getByTestId(`hoehenmodell-vorschau-satz-${key}`)).toContainText("43 % der Kammhöhe");
    expect(await page.getByTestId(`hoehenmodell-vorschau-schema-bild-${key}`).innerHTML()).not.toBe(schemaVorher);
    await expect(page.getByTestId("hoehenmodell-test-zustand")).toHaveText(
        "Ungespeichert: 3 Werte · Speichern rechnet die Karte neu",
    );
    // Die Hinweise zur Abweichung sind weg: Der Regler hat alles gesetzt.
    await expect(page.getByTestId(`hoehenmodell-test-hinweis-abweichung-${key}`)).toHaveCount(0);

    // „Alle Werte“ führt die drei Felder einzeln, unverändert benannt.
    await page.getByTestId("hoehenmodell-test-alle-werte").click();
    await expect(feld(page, "p:kammgebirge:hypsometrie")).toHaveValue("0,275");
    await expect(feld(page, "n:kammgebirge:form.talboden")).toHaveValue("0,425");
    await expect(feld(page, "n:kammgebirge:band.ziel")).toHaveValue("0,275");

    // ↺ trägt die Datei in alle drei Felder ein.
    await page.getByTestId(`hoehenmodell-test-zurueck-${key}`).click();
    await expect(feld(page, key)).toHaveValue("1");
    await expect(feld(page, "p:kammgebirge:hypsometrie")).toHaveValue("0,45");
    await expect(feld(page, "n:kammgebirge:form.talboden")).toHaveValue("0,3");
    await expect(page.getByTestId("hoehenmodell-test-zustand")).toHaveText(
        "Revision 2 gespeichert · die Karte ist damit gerechnet",
    );
});

test("Kammschärfe und Unruhe schreiben den V12-Wert und den Typwert des Rückennetzes gleich", async ({ page }) => {
    await oeffnen(page, hoehenmodellServer(hoehenmodellTestStand()));
    await page.getByTestId("hoehenmodell-test-typ-kuppengebirge").click();
    const schaerfe = "regler:kammschaerfe";
    // Kuppengebirge: Typwert 0,05 (rund), das Preset der V12 sagt 1 – heute gewinnt die V12; der Regler sagt es.
    await expect(feld(page, schaerfe)).toHaveValue("1");
    await expect(page.getByTestId(`hoehenmodell-test-hinweis-abweichung-${schaerfe}`)).toContainText(
        "0,05 (Regler: 1)",
    );
    await regler(page, schaerfe).fill("0.4");
    await expect(feld(page, schaerfe)).toHaveValue("0,4");
    await page.getByTestId("hoehenmodell-test-alle-werte").click();
    await expect(feld(page, "p:kuppengebirge:plateau")).toHaveValue("0,4");
    await expect(feld(page, "n:kuppengebirge:form.schaerfe")).toHaveValue("0,4");
    await expect(page.getByTestId(`hoehenmodell-test-hinweis-abweichung-${schaerfe}`)).toHaveCount(0);
    // Die beiden Werte mit zwei Bedeutungen tragen in der Liste der Feinarbeit beide Namen.
    await expect(page.getByTestId("hoehenmodell-test-p:kuppengebirge:plateau")).toContainText(
        "Kammschärfe · Hochfläche",
    );
    await expect(page.getByTestId("hoehenmodell-test-p:kuppengebirge:bergform")).toContainText(
        "Gipfelform · Gipfelkegel",
    );
});

test("Durchhang, Rinnen und Taleinschnitt: ein Regler, mehrere Felder", async ({ page }) => {
    await oeffnen(page, hoehenmodellServer(hoehenmodellTestStand()));
    await page.getByTestId("hoehenmodell-test-alle-werte").click();
    await regler(page, "regler:durchhang").fill("0.15");
    await expect(feld(page, "regler:durchhang")).toHaveValue("0,15");
    await expect(feld(page, "n:kammgebirge:form.durchhang")).toHaveValue("0,15");
    await expect(feld(page, "n:kammgebirge:form.durchhangNeben")).toHaveValue("0,2");
    await expect(page.getByTestId("hoehenmodell-test-zustand")).toHaveText(
        "Ungespeichert: 2 Werte · Speichern rechnet nur Gebirge mit gezeichneten Kämmen neu",
    );

    await regler(page, "regler:rinnen").fill("2");
    await expect(feld(page, "p:kammgebirge:erosion")).toHaveValue("2");
    await expect(feld(page, "n:kammgebirge:form.erosion")).toHaveValue("2");
    await expect(page.getByTestId("hoehenmodell-vorschau-satz-regler:rinnen")).toContainText("90 Durchgänge");

    // Der Taleinschnitt: Tiefe und halbe Breite zusammen.
    const tal = "regler:taleinschnitt";
    await vorschau(page, tal).scrollIntoViewIfNeeded();
    await expect(page.getByTestId(`hoehenmodell-test-hinweis-wirkt-${tal}`)).toContainText("Fluss oder See");
    await regler(page, tal).fill("1000");
    await expect(feld(page, "p:kammgebirge:einschnitt")).toHaveValue("1.000");
    await expect(feld(page, "p:kammgebirge:talbreite")).toHaveValue("2,3");
    await expect(page.getByTestId(`hoehenmodell-vorschau-satz-${tal}`)).toContainText("1.000 Schritt");
});

test("Nebengipfel: Höhe und Steilheit sind zwei Regler, beide Schemata zeigen denselben Kopf", async ({ page }) => {
    await oeffnen(page, hoehenmodellServer(hoehenmodellTestStand()));
    const hoehe = "regler:prominenz";
    const steil = "regler:neigung";
    await vorschau(page, hoehe).scrollIntoViewIfNeeded();
    // Ohne Höhe gibt es keinen Kopf; die Steilheit sagt es.
    await expect(page.getByTestId(`hoehenmodell-vorschau-satz-${steil}`)).toContainText(
        "Bei Höhe 0 gibt es keinen Kopf",
    );
    await regler(page, hoehe).fill("0.1");
    await expect(feld(page, hoehe)).toHaveValue("0,1");
    await expect(page.getByTestId(`hoehenmodell-vorschau-satz-${steil}`)).toContainText(
        "Ohne Neigung bleibt der Kopf eine Spitze",
    );
    const schemaVorher = await page.getByTestId(`hoehenmodell-vorschau-schema-bild-${steil}`).innerHTML();
    await regler(page, steil).fill("0.08");
    await expect(feld(page, steil)).toHaveValue("0,08");
    await expect(page.getByTestId(`hoehenmodell-vorschau-satz-${steil}`)).toContainText("1,25 Karteneinheiten");
    expect(await page.getByTestId(`hoehenmodell-vorschau-schema-bild-${steil}`).innerHTML()).not.toBe(schemaVorher);
    // Die Zeichnung der Höhe zeigt jetzt denselben Kopf mit Kegel (dieselbe Linie; gestrichelt steht je Regler etwas anderes).
    const linie = (key: string) =>
        page.getByTestId(`hoehenmodell-vorschau-schema-bild-${key}`).locator(".zeichnung__linie").getAttribute("d");
    expect(await linie(hoehe)).toBe(await linie(steil));
    await expect(page.getByTestId(`hoehenmodell-vorschau-satz-${hoehe}`)).toContainText("10 % der Kammhöhe");
    await expect(page.getByTestId("hoehenmodell-test-zustand")).toHaveText(
        "Ungespeichert: 2 Werte · Speichern rechnet nur Gebirge mit gezeichneten Kämmen neu",
    );
});

test("das Grundmuster ist eine Wahl: ein Schema ohne Schieber, die Wahl schreibt das Muster", async ({ page }) => {
    await oeffnen(page, hoehenmodellServer(hoehenmodellTestStand()));
    const key = "regler:muster";
    await vorschau(page, key).scrollIntoViewIfNeeded();
    await expect(regler(page, key)).toHaveCount(0);
    await expect(page.getByTestId(`hoehenmodell-vorschau-schema-bild-${key}`)).toBeVisible();
    await expect(page.getByTestId(`hoehenmodell-vorschau-satz-${key}`)).toContainText("Wellen");
    await page.getByTestId("hoehenmodell-test-feld-m:kammgebirge").getByRole("button", { name: "Zellen" }).click();
    await expect(page.getByTestId(`hoehenmodell-vorschau-satz-${key}`)).toContainText("Kuppen");
});

test("die Auswahl: Ausgleich der Hänge und Hügelland tragen ihr Schema, andere globale Werte keines", async ({
    page,
}) => {
    await oeffnen(page, hoehenmodellServer(hoehenmodellTestStand()));
    await page.getByTestId("hoehenmodell-test-kachel-gelaende-erosion").click();
    const diffusion = vorschau(page, "r:diffusion");
    await diffusion.scrollIntoViewIfNeeded();
    await expect(diffusion).toBeVisible();
    await expect(page.getByTestId("hoehenmodell-vorschau-schema-bild-r:diffusion")).toBeVisible();
    await expect(page.getByTestId("hoehenmodell-vorschau-satz-r:diffusion")).toContainText("Nach 20 Runden");
    await expect(vorschau(page, "r:streamPowerK")).toHaveCount(0);

    await page.getByTestId("hoehenmodell-test-kachel-landschaften-topographie.huegelland").click();
    const breite = "w:topographie.huegelland.landform.hills.radiusAtMinimum";
    await vorschau(page, breite).scrollIntoViewIfNeeded();
    await expect(page.getByTestId(`hoehenmodell-vorschau-schema-bild-${breite}`)).toBeVisible();
    // Fassung 19: Radius 0,5 E bei Höhe 80, bis 4 E breit bei 320.
    await expect(page.getByTestId(`hoehenmodell-vorschau-satz-${breite}`)).toContainText(
        "bis zu 4 Karteneinheiten breit",
    );
    await regler(page, breite).fill("2.5");
    await expect(feld(page, breite)).toHaveValue("2,5");
    await expect(page.getByTestId(`hoehenmodell-vorschau-satz-${breite}`)).toContainText(
        "bis zu 20 Karteneinheiten breit",
    );
    await expect(vorschau(page, "w:topographie.huegelland.landform.hills.attempts")).toHaveCount(0);
});

test("„Alle Werte (für Feinarbeit)“ ist zugeklappt, führt jeden einzelnen Wert mit Satz und, wo es eines gibt, mit Schema", async ({
    page,
}) => {
    await oeffnen(page, hoehenmodellServer(hoehenmodellTestStand()));
    const kopf = page.getByTestId("hoehenmodell-test-alle-werte");
    await expect(kopf).toContainText("Alle Werte (für Feinarbeit)");
    await expect(page.getByTestId("hoehenmodell-test-p:kammgebirge:sattel")).toBeHidden();
    await kopf.click();
    await expect(page.getByTestId("hoehenmodell-test-p:kammgebirge:sattel")).toBeVisible();
    // 10 Werte der V12 und die 21 Typwerte des Rückennetzes; das Grundmuster steht nur oben als Regler.
    const zeilen = page
        .getByTestId("hoehenmodell-test-alle")
        .locator(
            '[data-testid^="hoehenmodell-test-p:kammgebirge:"], [data-testid^="hoehenmodell-test-n:kammgebirge:"]',
        );
    await expect(zeilen).toHaveCount(31);
    await expect(page.getByTestId("hoehenmodell-test-n:kammgebirge:struktur.welle")).toBeVisible();
    // Jeder Wert hat seinen eigenen Satz.
    await expect(page.getByTestId("hoehenmodell-test-p:kammgebirge:sattel")).toContainText(
        "zwischen zwei Gipfeln durchsackt",
    );
    await expect(page.getByTestId("hoehenmodell-test-n:kammgebirge:struktur.astAbstand")).toContainText("Seitenäste");
    await expect(page.getByTestId("hoehenmodell-test-n:kammgebirge:gratMin")).toContainText("Talboden");
    // Bis auf die Mindestschärfe des Grats (sie gehört zur Suche des Talbodens) trägt jeder ein Schema mit Schieber.
    await expect(
        page
            .getByTestId("hoehenmodell-test-alle")
            .locator(
                '[data-testid^="hoehenmodell-vorschau-p:kammgebirge:"], [data-testid^="hoehenmodell-vorschau-n:kammgebirge:"]',
            ),
    ).toHaveCount(30);
    await expect(vorschau(page, "n:kammgebirge:gratMin")).toHaveCount(0);

    // Ein Schieber in der Liste stellt genau sein Feld: Sattel 0,95 → 0,5; das Schema verformt sich.
    const sattel = "p:kammgebirge:sattel";
    const schemaVorher = await page.getByTestId(`hoehenmodell-vorschau-schema-bild-${sattel}`).innerHTML();
    await regler(page, sattel).fill("0.5");
    await expect(feld(page, sattel)).toHaveValue("0,5");
    expect(await page.getByTestId(`hoehenmodell-vorschau-schema-bild-${sattel}`).innerHTML()).not.toBe(schemaVorher);
    await expect(page.getByTestId("hoehenmodell-test-zustand")).toHaveText(
        "Ungespeichert: 1 Wert · Speichern rechnet die Karte neu",
    );

    // Das Schema der Äste steht von oben: kein Boden, Linien des Kamms und seiner Äste.
    const aeste = "n:kammgebirge:struktur.astAbstand";
    await expect(
        page.getByTestId(`hoehenmodell-vorschau-schema-bild-${aeste}`).locator(".zeichnung__grund"),
    ).toHaveCount(0);
});

test("nach der Abnahme (gesperrt) stehen alle Schieber still, die Zeichnung zeigt den Wert", async ({ page }) => {
    const stand = hoehenmodellTestStand();
    await oeffnen(page, hoehenmodellServer({ ...stand, test: { ...stand.test!, gesperrt: true } }));
    const key = "regler:durchhang";
    await vorschau(page, key).scrollIntoViewIfNeeded();
    await expect(regler(page, key)).toBeDisabled();
    await expect(page.getByTestId(`hoehenmodell-vorschau-schema-bild-${key}`)).toBeVisible();
    await expect(feld(page, key)).toBeDisabled();
});

// 💣 Bild-Erzeuger, keine Zusicherung (WI-0248 S1): Der Fall ist nur MIT `BILDER` registriert.
const bilderOrdner = process.env["BILDER"];
if (bilderOrdner !== undefined)
    test("Bilder der Gebirgs-Presets in 1920 × 1080, 1280 × 800 und 900 × 1000", async ({ page }) => {
        test.setTimeout(600_000);
        const ordner = bilderOrdner;
        for (const [breite, hoehe] of [
            [1920, 1080],
            [1280, 800],
            [900, 1000],
        ] as const) {
            await page.setViewportSize({ width: breite, height: hoehe });
            await oeffnen(page, hoehenmodellServer(hoehenmodellTestStand()));
            const zeigen = async (key: string, name: string, wert?: string, zeile = false): Promise<void> => {
                const karte = zeile ? page.getByTestId(`hoehenmodell-test-${key}`) : vorschau(page, key);
                await karte.evaluate((el) => el.scrollIntoView({ block: "center" }));
                if (wert !== undefined) await regler(page, key).fill(wert);
                await expect(page.getByTestId(`hoehenmodell-vorschau-schema-bild-${key}`)).toBeVisible();
                await page.waitForTimeout(300);
                await page.screenshot({ path: `${ordner}/${String(breite)}-${name}.png` });
            };
            await page.getByTestId("hoehenmodell-test-regler").evaluate((el) => el.scrollIntoView({ block: "start" }));
            await page.waitForTimeout(300);
            await page.screenshot({ path: `${ordner}/${String(breite)}-00-bereiche.png` });
            await zeigen("regler:massigkeit", "01-massigkeit", "0.5", true);
            await zeigen("regler:kammschaerfe", "02-kammschaerfe", "0.2", true);
            await zeigen("regler:rueckenbreite", "03-rueckenbreite", "2.5", true);
            await zeigen("regler:gipfelform", "04-gipfelform", "6", true);
            await zeigen("regler:unruhe", "05-unruhe", "0.6", true);
            await zeigen("regler:koernung", "06-koernung", "30", true);
            await zeigen("regler:muster", "07-muster");
            await zeigen("regler:durchhang", "08-durchhang", "0.25", true);
            await zeigen("regler:prominenz", "09-prominenz", "0.1", true);
            await zeigen("regler:neigung", "09b-neigung", "0.08", true);
            await zeigen("regler:rinnen", "10-rinnen", "5", true);
            await zeigen("regler:taleinschnitt", "11-taleinschnitt", "1500", true);
            await zeigen("regler:gelaendeErosion", "12-gelaendeErosion", "1", true);
            await page
                .getByTestId("hoehenmodell-test-alle-werte")
                .evaluate((el) => el.scrollIntoView({ block: "center" }));
            await page.getByTestId("hoehenmodell-test-alle-werte").click();
            await page.waitForTimeout(500);
            await page.screenshot({ path: `${ordner}/${String(breite)}-13-alle-werte.png` });
            await zeigen("n:kammgebirge:struktur.astAbstand", "14-aeste", "1.8", true);
            await zeigen("p:kammgebirge:sattel", "15-sattel", "0.5", true);
            await zeigen("n:kammgebirge:form.randBreite", "16-rand", "5", true);
            await zeigen("n:kammgebirge:form.erhalt", "17-erhalt", "0.8", true);
            await zeigen("n:kammgebirge:form.kammMuster", "18-kammmuster", "1", true);
            await page.getByTestId("hoehenmodell-test-kachel-gelaende-erosion").click();
            await zeigen("r:diffusion", "19-diffusion", "0.08");
            await page.getByTestId("hoehenmodell-test-kachel-landschaften-topographie.huegelland").click();
            await zeigen("w:topographie.huegelland.landform.hills.radiusAtMinimum", "20-huegel");
        }
    });
