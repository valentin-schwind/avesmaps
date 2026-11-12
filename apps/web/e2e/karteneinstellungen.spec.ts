import { expect, test, type Page } from "@playwright/test";
import { MAP_SETTINGS_URL } from "@avesmaps3d/shared";
import { karteneinstellungenServer, type KarteneinstellungenServer } from "./karteneinstellungen-stub.ts";
import { passkeyBereit } from "./passkey-stub.ts";
import { ADMIN_CAPABILITIES, stubAdmin, type AdminCall } from "./verwaltung-stub.ts";

/**
 * Die Karteneinstellungen (WI-0166) im Browser: der Reiter der Systemsteuerung gegen den Nachbau
 * (`karteneinstellungen-stub.ts`) und der Start der Karte aus `GET /api/map-settings`. Die echten Routen prüft
 * `apps/server/test/karteneinstellungen.test.ts`.
 */

const OPERATOR = [...ADMIN_CAPABILITIES, "manage_system_settings"];

// 🔴 Nichts Schreibendes erreicht den geteilten Server (Besuchszählung beim Laden der Seite, Fehlerberichte …; Muster `wettereditor.spec.ts`):
// Die Nachbauten der Fälle stehen später und gewinnen darum für ihre Wege.
test.beforeEach(async ({ page }) => {
    await page.route("**/api/**", (route) =>
        route.request().method() === "GET" ? route.fallback() : route.fulfill({ status: 204, body: "" }),
    );
});

async function oeffnen(
    page: Page,
    server: KarteneinstellungenServer,
    options: {
        capabilities?: string[];
        adresse?: string;
        answer?: (call: AdminCall) => { status: number; body: unknown } | undefined;
    } = {},
) {
    const capabilities = options.capabilities ?? OPERATOR;
    const calls = await stubAdmin(page, {
        capabilities,
        role: capabilities.includes("manage_system_settings") ? "operator" : "admin",
        person: { passkeyCount: 1 },
        answer: (call) => options.answer?.(call) ?? server.handle(call),
    });
    await page.goto(`/edit${options.adresse ?? ""}`);
    await page.getByTestId("kopfleiste-menue").click();
    await page.getByTestId("menue-systemsteuerung").click();
    await expect(page.getByRole("dialog", { name: "Systemsteuerung" })).toBeVisible();
    await page.getByTestId("verwaltung-eintrag-karteneinstellungen").click();
    await expect(page.getByTestId("karteneinstellungen")).toBeVisible();
    return calls;
}

/** Die Ansicht, die die Karte gerade in die Adresse geschrieben hat. */
async function adresse(page: Page): Promise<{ x: number; y: number; z: number }> {
    const hash = await page.evaluate(() => globalThis.location.hash);
    const parameter = new URLSearchParams(hash.slice(1));
    return {
        x: Number(parameter.get("x")),
        y: Number(parameter.get("y")),
        z: Number(parameter.get("z")),
    };
}

test("🔴 der Reiter: Panel „Startansicht“ mit Startposition (x, y) und Startzoom, Vorgaben im Feld, ein Auslöser oben", async ({
    page,
}) => {
    await oeffnen(page, karteneinstellungenServer());
    const rumpf = page.getByTestId("karteneinstellungen");
    // Die Panele in der Reihenfolge der Tafel: Startansicht, Routenplaner (zweiter Schnitt), Editierverhalten (WI-0177), Sprachen
    // (WI-0261), Herrschaftsgebiete (OPS-000082), Orte (OPS-000083), OceanShader an/aus (WI-0288), Zoomkurve (2026-11-09),
    // PDF Exporter (WI-0306).
    await expect(rumpf.locator(".fenster-karte")).toHaveCount(9);
    await expect(rumpf.locator(".fenster-karte").first()).toContainText("Startansicht");
    await expect(rumpf.locator(".fenster-karte").nth(1)).toContainText("Routenplaner");
    await expect(rumpf.locator(".fenster-karte").nth(2)).toContainText("Editierverhalten");
    await expect(rumpf.locator(".fenster-karte").nth(6)).toContainText("OceanShader an/aus");
    await expect(page.getByTestId("karteneinstellungen-feld-startPosition.x").locator("input")).toHaveValue("518,75");
    await expect(page.getByTestId("karteneinstellungen-feld-startPosition.y").locator("input")).toHaveValue("504");
    await expect(page.getByTestId("karteneinstellungen-feld-startZoom").locator("input")).toHaveValue("2,5");
    // An jeder Zeile steht, was eine Änderung nach sich zieht.
    await expect(
        page.getByTestId("karteneinstellungen-panel-startansicht").locator(".karteneinstellungen__wirkt"),
    ).toHaveText(["Wirkt beim nächsten Öffnen der Karte.", "Wirkt beim nächsten Öffnen der Karte."]);
    // Ohne Abweichung ruhen die Rücksetzzeichen; die Leiste steht über dem Panel und trägt den EINEN Auslöser.
    await expect(rumpf.locator('[data-testid^="karteneinstellungen-zurueck-"]:not([disabled])')).toHaveCount(0);
    await expect(rumpf.locator('[data-testid="karteneinstellungen-uebernehmen"]')).toHaveCount(1);
    const oben = await rumpf.evaluate((element: HTMLElement) => {
        const leiste = element.querySelector('[data-testid="karteneinstellungen-leiste"]')!.getBoundingClientRect();
        const karte = element.querySelector(".fenster-karte")!.getBoundingClientRect();
        return leiste.bottom <= karte.top + 1;
    });
    expect(oben, "die Leiste steht über dem Panel").toBe(true);
    await expect(rumpf.locator(".avm-kreis")).toHaveCount(0);
    await expect(page.getByTestId("systemsteuerung-fenster").locator(".avm-fenster__fuss-hinweis")).toContainText(
        "Passkey",
    );
});

test("🔴 Startzoom verstellen: Passkey, Revision hinaus, „statt 2,5“, „1 verstellt“ an der Schiene, zurück auf die Vorgabe", async ({
    page,
}) => {
    const passkey = await passkeyBereit(page);
    const server = karteneinstellungenServer();
    await oeffnen(page, server, {
        answer: (call) =>
            call.method === "POST" && passkey.verifiziert() === 0
                ? {
                      status: 403,
                      body: { error: { code: "reauth_required", message: "x", details: { need: "passkey" } } },
                  }
                : undefined,
    });
    const feld = page.getByTestId("karteneinstellungen-feld-startZoom").locator("input");
    await feld.fill("3");
    await feld.press("Enter");
    const bestaetigen = page.getByRole("dialog", { name: "Kurz bestätigen" });
    await expect(bestaetigen).toBeVisible();
    await bestaetigen.getByTestId("bestaetigen-passkey").click();
    await expect(bestaetigen).toBeHidden();

    await expect(page.getByTestId("karteneinstellungen-startZoom")).toContainText("statt 2,5");
    expect(server.posts.at(-1)).toMatchObject({ baseRevision: 4, id: "startZoom", value: 3 });
    await expect(page.getByTestId("verwaltung-eintrag-karteneinstellungen")).toContainText("1 verstellt");
    await expect(page.getByTestId("karteneinstellungen-zurueck-startZoom")).toBeEnabled();

    await page.getByTestId("karteneinstellungen-zurueck-startZoom").click();
    await expect(page.getByTestId("karteneinstellungen-startZoom")).not.toContainText("statt 2,5");
    expect(server.posts.at(-1)).toMatchObject({ id: "startZoom", value: null });
    await expect(feld).toHaveValue("2,5");
});

test("🔴 eine Startposition ist EIN Wert: x und y getippt, der Wechsel zwischen beiden schickt nichts", async ({
    page,
}) => {
    const server = karteneinstellungenServer();
    await oeffnen(page, server);
    const x = page.getByTestId("karteneinstellungen-feld-startPosition.x").locator("input");
    const y = page.getByTestId("karteneinstellungen-feld-startPosition.y").locator("input");
    await x.fill("520");
    await y.focus();
    expect(server.posts).toEqual([]);
    await y.fill("500");
    await y.press("Enter");
    await expect(page.getByTestId("karteneinstellungen-startPosition")).toContainText("statt x 518,75 · y 504");
    expect(server.posts).toHaveLength(1);
    expect(server.posts[0]).toMatchObject({ id: "startPosition", value: { x: 520, y: 500 } });
});

test("🔴 außerhalb der Karte geht nichts hinaus; der Satz steht am Feld", async ({ page }) => {
    const server = karteneinstellungenServer();
    await oeffnen(page, server);
    const y = page.getByTestId("karteneinstellungen-feld-startPosition.y").locator("input");
    await y.fill("2000");
    await y.press("Enter");
    await expect(page.getByTestId("karteneinstellungen-startPosition")).toContainText("Erlaubt ist x 0 bis 1.024");
    expect(server.posts).toEqual([]);
});

test("🔴 „Aktuelle Ansicht übernehmen“ nimmt Mitte und Zoom der Karte hinter dem Fenster", async ({ page }) => {
    const server = karteneinstellungenServer();
    await oeffnen(page, server, { adresse: "#x=400&y=600&z=4&series=modern&view=standard&layer=alle" });
    const karte = await adresse(page);
    const runde = (zahl: number) => Math.round(zahl * 100) / 100;
    await expect(page.getByTestId("karteneinstellungen-karte")).toContainText("Die Karte zeigt gerade");
    await page.getByTestId("karteneinstellungen-uebernehmen").click();
    await expect.poll(() => server.posts.length).toBe(2);
    expect(server.posts[0]).toMatchObject({ id: "startPosition", value: { x: runde(karte.x), y: runde(karte.y) } });
    expect(server.posts[1]).toMatchObject({ id: "startZoom", value: runde(karte.z) });
    // Danach stimmen Karte und Startansicht überein, und der Knopf ruht mit dem Satz.
    await expect(page.getByTestId("karteneinstellungen-uebernehmen")).toBeDisabled();
});

test("ohne das Recht „Systemschalter“ ruhen Felder und Knopf, der Satz steht oben", async ({ page }) => {
    await oeffnen(page, karteneinstellungenServer(), { capabilities: ADMIN_CAPABILITIES });
    await expect(page.getByTestId("karteneinstellungen-nur-lesen")).toContainText("Systemschalter");
    await expect(page.getByTestId("karteneinstellungen-feld-startZoom").locator("input")).toBeDisabled();
    await expect(page.getByTestId("karteneinstellungen-uebernehmen")).toBeDisabled();
});

test("🔴 die Karte startet, wo die Karteneinstellungen es sagen, und ohne Antwort über „Aventurien“ auf Zoom 2,5", async ({
    page,
}) => {
    await page.route(`**${MAP_SETTINGS_URL}`, (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ revision: 9, startPosition: { x: 300, y: 700 }, startZoom: 4 }),
        }),
    );
    await page.goto("/");
    await expect.poll(async () => (await adresse(page)).z).toBe(4);
    expect(await adresse(page)).toMatchObject({ x: 300, y: 700 });

    await page.unroute(`**${MAP_SETTINGS_URL}`);
    await page.route(`**${MAP_SETTINGS_URL}`, (route) => route.fulfill({ status: 404, body: "" }));
    await page.goto("about:blank");
    await page.goto("/");
    await expect.poll(async () => (await adresse(page)).z).toBe(2.5);
    expect(await adresse(page)).toMatchObject({ x: 518.75, y: 504 });
});

test("ein Link mit eigenem Ausschnitt geht der Startansicht vor", async ({ page }) => {
    await page.route(`**${MAP_SETTINGS_URL}`, (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ revision: 9, startPosition: { x: 300, y: 700 }, startZoom: 4 }),
        }),
    );
    await page.goto("/#x=520&y=500&z=5&series=modern&view=standard&layer=alle");
    await expect.poll(async () => (await adresse(page)).z).toBe(5);
    expect(await adresse(page)).toMatchObject({ x: 520, y: 500 });
});

// --- Panel „Routenplaner“ (WI-0166, zweiter Schnitt) --------------------------------------------------------------------------

/** Eine Voreinstellung, die im Planer sichtbar abweicht: Eiltempo an, kürzeste Route, ein anderes Mittel an Land. */
const PLANER_VOREINSTELLUNG = {
    revision: 9,
    startPosition: { x: 518.75, y: 504 },
    startZoom: 2.5,
    planerReiseart: "surface",
    planerFlugmittel: "witchFlight",
    planerLandErlaubt: true,
    planerLandTransport: "groupHorse",
    planerFlussErlaubt: true,
    planerFlussTransport: "riverSailer",
    planerMeerErlaubt: true,
    planerMeerTransport: "cargoShip",
    planerRoutenwahl: "shortest",
    planerUmstiegeMinimieren: false,
    planerEiltempo: true,
    planerReisestunden: 8,
    planerReisebeginn: "unbestimmt",
    planerUnterbringung: "bett",
};

async function mitVoreinstellung(page: Page): Promise<void> {
    await page.route(`**${MAP_SETTINGS_URL}`, (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PLANER_VOREINSTELLUNG) }),
    );
}

test("🔴 Panel Routenplaner: Auswahl, Kästchen und Monat gehen sofort hinaus, ohne Tippen", async ({ page }) => {
    const server = karteneinstellungenServer();
    await oeffnen(page, server);
    const panel = page.getByTestId("karteneinstellungen-panel-routenplaner");
    await expect(panel).toContainText("Transportmittel");
    await expect(panel).toContainText("Reiseoptionen");
    await page.getByTestId("karteneinstellungen-feld-planerLandTransport").locator("select").selectOption("groupHorse");
    await expect.poll(() => server.posts.length).toBe(1);
    expect(server.posts[0]).toMatchObject({ id: "planerLandTransport", value: "groupHorse" });
    // Erst wenn der Schreibweg durch ist (das Rücksetzzeichen wacht), sind die Felder wieder frei.
    await expect(page.getByTestId("karteneinstellungen-zurueck-planerLandTransport")).toBeEnabled();
    // Ein Klick, kein `check()`: Das Kästchen ruht, solange der Schreibweg läuft, und `check()` prüft genau dann nach.
    await page.getByTestId("karteneinstellungen-feld-planerEiltempo").click();
    await expect.poll(() => server.posts.length).toBe(2);
    expect(server.posts[1]).toMatchObject({ id: "planerEiltempo", value: true });
    await expect(page.getByTestId("karteneinstellungen-zurueck-planerEiltempo")).toBeEnabled();
    await expect(page.getByTestId("karteneinstellungen-feld-planerEiltempo")).toBeChecked();
    await page.getByTestId("karteneinstellungen-feld-planerReisebeginn.monat").locator("select").selectOption("praios");
    await expect.poll(() => server.posts.length).toBe(3);
    expect(server.posts[2]).toMatchObject({ id: "planerReisebeginn", value: { monat: "praios", tag: 1 } });
    await expect(page.getByTestId("karteneinstellungen-planerEiltempo")).toContainText("statt aus");
    await expect(page.getByTestId("verwaltung-eintrag-karteneinstellungen")).toContainText("3 verstellt");
});

test("🔴 Panel „OceanShader an/aus“ (WI-0288): ein Kästchen, Vorgabe an, ein Klick schaltet aus", async ({ page }) => {
    const server = karteneinstellungenServer();
    await oeffnen(page, server);
    const panel = page.getByTestId("karteneinstellungen-panel-ozeanShader");
    await panel.scrollIntoViewIfNeeded();
    await expect(panel).toContainText("OceanShader an/aus");
    await expect(panel).toContainText("Bewegtes Wasser in 3D");
    await expect(panel.locator(".karteneinstellungen__wirkt")).toHaveText([
        "Wirkt beim nächsten Öffnen der Karte.",
        "Wirkt beim nächsten Öffnen der Karte.",
        "Wirkt beim nächsten Öffnen der Karte.",
    ]);
    // Größe des Glanzpunkts und Stärke des Glanzes stehen untereinander in der zweiten Spalte (Betreiber 2026-11-08).
    await expect(page.getByTestId("karteneinstellungen-feld-ozeanGlanzpunkt").locator("input")).toHaveValue("1");
    await expect(page.getByTestId("karteneinstellungen-feld-ozeanGlanz").locator("input")).toHaveValue("1");
    const lage = async (id: string) => (await page.getByTestId(`karteneinstellungen-${id}`).boundingBox())!;
    const [schalter, punkt, glanz] = [
        await lage("ozeanShaderAn"),
        await lage("ozeanGlanzpunkt"),
        await lage("ozeanGlanz"),
    ];
    expect(punkt.x).toBeGreaterThan(schalter.x + schalter.width - 1);
    expect(Math.abs(glanz.x - punkt.x)).toBeLessThan(1);
    expect(glanz.y).toBeGreaterThan(punkt.y + punkt.height - 1);
    const feld = page.getByTestId("karteneinstellungen-feld-ozeanShaderAn");
    await expect(feld).toBeChecked();
    await page.screenshot({ path: test.info().outputPath("ozeanshader-an.png") });
    await feld.click();
    await expect.poll(() => server.posts.length).toBe(1);
    expect(server.posts[0]).toMatchObject({ id: "ozeanShaderAn", value: false });
    await expect(page.getByTestId("karteneinstellungen-zurueck-ozeanShaderAn")).toBeEnabled();
    await expect(feld).not.toBeChecked();
    await expect(page.getByTestId("karteneinstellungen-ozeanShaderAn")).toContainText("statt an");
    await page.screenshot({ path: test.info().outputPath("ozeanshader-aus.png") });
});

test("🔴 Panel „PDF Exporter“ (WI-0306): Jede Etappe und Reisetagebuch aus ab Werk, der Dateiname geht als Vorlage hinaus", async ({
    page,
}) => {
    const server = karteneinstellungenServer();
    await oeffnen(page, server);
    const panel = page.getByTestId("karteneinstellungen-panel-pdfExporter");
    await panel.scrollIntoViewIfNeeded();
    await expect(panel).toContainText("PDF Exporter");
    for (const abschnitt of ["Kartenbild auf dem Deckblatt", "Was soll hinein?", "Etappen und Reisetagebuch", "Papier"])
        await expect(panel).toContainText(abschnitt);
    const auswahl = (id: string) => page.getByTestId(`karteneinstellungen-feld-${id}`).locator("select");
    await expect(auswahl("pdfEtappenArt")).toHaveValue("lang");
    await expect(auswahl("pdfKarte")).toHaveValue("aktuell");
    await expect(page.getByTestId("karteneinstellungen-feld-pdfTagebuch")).not.toBeChecked();
    await expect(page.getByTestId("karteneinstellungen-feld-pdfQr")).toBeChecked();
    const datei = page.getByTestId("karteneinstellungen-feld-pdfDateiname").locator("input");
    await expect(datei).toHaveValue("");
    await expect(datei).toHaveAttribute("placeholder", "Reise von {von} nach {bis}");
    await panel.screenshot({ path: test.info().outputPath("pdf-exporter-vorgabe.png") });
    await datei.fill("Avesmaps {von} bis {bis}");
    await datei.press("Enter");
    await expect.poll(() => server.posts.length).toBe(1);
    expect(server.posts[0]).toMatchObject({ id: "pdfDateiname", value: "Avesmaps {von} bis {bis}" });
    await expect(page.getByTestId("karteneinstellungen-zurueck-pdfDateiname")).toBeEnabled();
    await expect(page.getByTestId("karteneinstellungen-pdfDateiname")).toContainText("statt leer");
    // Was ein Dateiname nicht nimmt, geht nicht hinaus; der Satz steht am Feld.
    await datei.fill("a/b");
    await datei.press("Enter");
    await expect(page.getByTestId("karteneinstellungen-pdfDateiname")).toContainText("Höchstens 120 Zeichen");
    expect(server.posts).toHaveLength(1);
    await page.setViewportSize({ width: 900, height: 900 });
    await panel.scrollIntoViewIfNeeded();
    await panel.screenshot({ path: test.info().outputPath("pdf-exporter-900.png") });
});

test("🔴 Panel „Zoomkurve“: Klick auf die Kurve setzt einen Punkt, Ziehen verschiebt ihn, Doppelklick entfernt ihn", async ({
    page,
}) => {
    const server = karteneinstellungenServer();
    await oeffnen(page, server);
    const panel = page.getByTestId("karteneinstellungen-panel-zoomkurve");
    await panel.scrollIntoViewIfNeeded();
    await expect(panel).toContainText("Zoomkurve");
    await expect(page.getByTestId("zoomkurve-punkt-2")).toBeVisible();
    await panel.screenshot({ path: test.info().outputPath("zoomkurve-vorgabe.png") });
    const mitte = async (i: number) => {
        const box = (await page.getByTestId(`zoomkurve-punkt-${i}`).locator("circle").last().boundingBox())!;
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    // Zwischen dem ersten und dem zweiten Punkt liegt die Kurve gerade: Ein Klick in die Mitte trifft sie.
    const [a, b] = [await mitte(0), await mitte(1)];
    await page.mouse.click((a.x + b.x) / 2, (a.y + b.y) / 2);
    await expect.poll(() => server.posts.length).toBe(1);
    const gesetzt = server.posts[0]?.["value"] as { zoom: number; neigung: number }[];
    expect(gesetzt).toHaveLength(4);
    expect(gesetzt[1]?.zoom).toBeGreaterThan(3.8);
    expect(gesetzt[1]?.zoom).toBeLessThan(4.2);
    await expect(page.getByTestId("karteneinstellungen-zurueck-zoomKurve")).toBeEnabled();
    // Den neuen Punkt nach oben ziehen: steiler.
    const neu = await mitte(1);
    await page.mouse.move(neu.x, neu.y);
    await page.mouse.down();
    await page.mouse.move(neu.x, neu.y - 40, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => server.posts.length).toBe(2);
    const gezogen = server.posts[1]?.["value"] as { zoom: number; neigung: number }[];
    expect(gezogen[1]?.neigung).toBeGreaterThan((gesetzt[1]?.neigung ?? 0) + 5);
    await panel.screenshot({ path: test.info().outputPath("zoomkurve-gezogen.png") });
    // Doppelklick nimmt ihn wieder weg: Die Kurve ist wieder die Vorgabe, also wird die Abweichung gelöscht (null).
    await page.getByTestId("zoomkurve-punkt-1").locator("circle").last().dblclick();
    await expect.poll(() => server.posts.length).toBe(3);
    expect(server.posts[2]?.["value"]).toBeNull();
    await expect(page.getByTestId("karteneinstellungen-zurueck-zoomKurve")).toBeDisabled();
    await expect(page.getByTestId("zoomkurve-punkt-3")).toHaveCount(0);
});

test("🔴 der Planer beginnt einen neuen Besuch mit der Voreinstellung", async ({ page }) => {
    await mitVoreinstellung(page);
    await page.goto("/");
    await expect(page.getByTestId("hurry")).toBeChecked();
    await expect(page.getByTestId("optimize-shortest")).toBeChecked();
    // Die Transportwahl des Planers ist ein eigenes Auswahlfeld; sein Knopf nennt die Wahl.
    await expect(page.getByTestId("transport-land").locator("button").first()).toHaveAttribute(
        "aria-label",
        /: Reisegruppe zu Pferd$/u,
    );
});

test("🔴 alte Links bleiben gleich: eine Adresse mit Reise öffnet die feste Vorgabe, nicht die Voreinstellung", async ({
    page,
}) => {
    await mitVoreinstellung(page);
    await page.goto("/?route=Gareth~Punin");
    await expect(page.getByTestId("hurry")).not.toBeChecked();
    await expect(page.getByTestId("optimize-fastest")).toBeChecked();
    await expect(page.getByTestId("transport-land").locator("button").first()).toHaveAttribute(
        "aria-label",
        /: Reisegruppe zu Fuß$/u,
    );
    // Die Adresse trägt danach keine Abweichung: Der Link öffnet überall dasselbe, mit und ohne Voreinstellung.
    const suche = await page.evaluate(() => globalThis.location.search);
    expect(suche).not.toContain("hurry");
    expect(suche).not.toContain("landTransport");
    expect(suche).not.toContain("pathType");
});
