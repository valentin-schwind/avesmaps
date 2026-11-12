import { expect, test, type Page } from "@playwright/test";
import {
    RELEASE_TEST_SCHRITTE,
    RELEASE_TEST_URL,
    type ReleaseTestLauf,
    type ReleaseTestSchritt,
    type ReleaseTestSicht,
    type ReleaseTestTeil,
} from "@avesmaps3d/shared";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Die Karte „Release-Test“ im Reiter „Umgebungen“ der LOKALEN Systemsteuerung (WI-0248 L; Betreiber 2026-10-23). Sitzung und Route sind gestubbt;
 * die Server- und Starter-Seite prüfen `release-test-routen.test.ts` und `release-abholer.test.ts`.
 *
 * Problemfall: Lokal stand an dieser Stelle nur „In dieser Umgebung gibt es keine Freigaben.“, und der vollständige Release-Test ließ sich nur mit
 * einem Befehl und einer SHA von Hand starten.
 */
const OPERATOR = [...ADMIN_CAPABILITIES, "manage_system_settings", "release_to_production", "switch_environment"];
const STAGE = "a7728a1".padEnd(40, "0");
const AUFTRAG = "b2ee1b3".padEnd(40, "0");

const schritte = (zustaende: Partial<Record<(typeof RELEASE_TEST_SCHRITTE)[number], string>>) =>
    RELEASE_TEST_SCHRITTE.map((id) => {
        const zustand = (zustaende[id] ?? "offen") as ReleaseTestSchritt["zustand"];
        return {
            id,
            zustand,
            ...(zustand === "offen"
                ? {}
                : { start: "2026-10-23T10:00:00.000Z", dauerMs: id === "installation" ? 95_000 : 40_000 }),
            erwartetMs: id === "tests" ? 2_700_000 : 120_000,
            schaetzung: id !== "installation",
        };
    });

const lauf = (patch: Partial<ReleaseTestLauf> = {}): ReleaseTestLauf => ({
    zustand: "keiner",
    fertigeTeile: [],
    sperre: false,
    jetzt: new Date().toISOString(),
    schritte: schritte({}),
    erwartetMs: 8_740_000,
    erwartetSchaetzung: true,
    fortschritt: 0,
    ...patch,
});

const sicht = (patch: Partial<ReleaseTestSicht> = {}): ReleaseTestSicht => ({
    now: new Date().toISOString(),
    verfuegbar: true,
    fehler: null,
    // WI-0248: Geprüft und freigegeben wird der aktuelle Stage-Stand (`AUFTRAG`, b2ee1b3, der Stand der Läufe in diesen Fällen); a7728a1 steht als
    // früherer Auftrag der Stage (`OPS-…`) daneben und ist der „andere Stand“.
    kandidat: {
        stage: { sha: AUFTRAG, zeit: "2026-10-23T08:00:00Z" },
        auftrag: { sha: STAGE, zeit: "2026-10-23T09:00:00Z", ops: "OPS-000123" },
    },
    lauf: lauf(),
    start: null,
    ...patch,
});

interface Lage {
    aktuell: ReleaseTestSicht | "nicht-da";
    gepostet: { weg: string; body: Record<string, unknown> }[];
}

async function oeffne(page: Page, lage: Lage, o: { environment?: string; auf?: ReleaseTestSicht } = {}): Promise<void> {
    await stubAdmin(page, {
        capabilities: OPERATOR,
        role: "operator",
        person: { passkeyCount: 1 },
        environment: o.environment ?? "development",
        answer: (call) => {
            if (!call.path.startsWith(RELEASE_TEST_URL)) return undefined;
            if (call.method === "POST") {
                lage.gepostet.push({ weg: call.path.slice(RELEASE_TEST_URL.length + 1), body: call.body ?? {} });
                // Nach dem Starten läuft der Test, nach dem Abbrechen ist er abgebrochen.
                if (call.path.endsWith("/starten") && o.auf !== undefined) lage.aktuell = o.auf;
                return { status: 200, body: { operationId: "x", status: "applied" } };
            }
            if (lage.aktuell === "nicht-da")
                return { status: 404, body: { error: { code: "not_found", message: "x" } } };
            return { status: 200, body: lage.aktuell };
        },
    });
    await page.goto("/?verwaltung=production");
}

test("🔴 lokal steht an der Stelle von „keine Freigaben“ die Karte: Kandidat, erwartete Dauer als Schätzung, Starten, der Satz zum Weiterlaufen", async ({
    page,
}) => {
    const lage: Lage = { aktuell: sicht(), gepostet: [] };
    await oeffne(page, lage);
    const karte = page.getByTestId("release-test");
    await expect(karte).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("production-ohne")).toHaveCount(0);
    // Geprüft wird der Stage-Stand (7 Stellen); der frühere Auftrag steht daneben.
    await expect(page.getByTestId("release-test-kandidat-sha")).toHaveText("b2ee1b3");
    await expect(page.getByTestId("release-test-kandidat")).toContainText("der Start gibt ihn für Production frei");
    await expect(page.getByTestId("release-test-kandidat")).toContainText("OPS-000123");
    await expect(page.getByTestId("release-test-kandidat")).toContainText("a7728a1");
    // Die erwartete Dauer ist als Schätzung gekennzeichnet (ungemessene Schritte).
    await expect(page.getByTestId("release-test-erwartet")).toContainText("2 Std. 25 Min.");
    await expect(page.getByTestId("release-test-schaetzung")).toHaveText("Schätzung");
    await expect(page.getByTestId("release-test-zustand")).toHaveText("Noch kein Lauf auf diesem Rechner.");
    // Der Satz unter dem Knopf: unabhängig weiterlaufen, der Rechner muss an bleiben.
    await expect(page.getByTestId("release-test-hinweis")).toContainText("unabhängig von der Anwendung weiter");
    await expect(page.getByTestId("release-test-hinweis")).toContainText("Der Rechner muss dafür an bleiben");
    const starten = page.getByTestId("release-test-starten");
    await expect(starten).toHaveText("Schnelltest");
    await expect(starten).toBeEnabled();
    await expect(page.getByTestId("release-test-abbrechen")).toHaveCount(0);
    await expect(page.getByTestId("release-test-bericht")).toHaveCount(0);
});

test("🔴 Starten schickt die Freigabe als Stand mit; danach läuft der Test: Schritte, Balken, noch etwa …, Abbrechen sichtbar, Starten gesperrt", async ({
    page,
}) => {
    const lage: Lage = { aktuell: sicht(), gepostet: [] };
    const laeuft = sicht({
        lauf: lauf({
            zustand: "laeuft",
            sha: AUFTRAG,
            lebt: true,
            start: new Date(Date.now() - 250_000).toISOString(),
            schritte: schritte({ vorbereitung: "fertig", installation: "fertig", shared: "laeuft" }),
            fortschritt: 0.05,
            verbleibendMs: 7_500_000,
        }),
    });
    await oeffne(page, lage, { auf: laeuft });
    await page.getByTestId("release-test-starten").click();
    await expect.poll(() => lage.gepostet.length).toBe(1);
    expect(lage.gepostet[0]?.weg).toBe("starten");
    expect(lage.gepostet[0]?.body["commit"]).toBe(AUFTRAG);
    expect(typeof lage.gepostet[0]?.body["operationId"]).toBe("string");

    // Nach dem Start lädt die Karte neu und zeigt den Lauf.
    await expect(page.getByTestId("release-test-zustand")).toContainText("läuft seit");
    await expect(page.getByTestId("release-test-balken")).toHaveAttribute("aria-valuenow", "5");
    await expect(page.getByTestId("release-test-rest")).toContainText("noch etwa 2 Std. 5 Min. (Schätzung)");
    const reihe = page.getByTestId("release-test-schritte").locator("li");
    await expect(reihe).toHaveCount(RELEASE_TEST_SCHRITTE.length);
    await expect(reihe.nth(0)).toHaveAttribute("data-zustand", "fertig");
    await expect(reihe.nth(2)).toHaveAttribute("data-zustand", "laeuft");
    await expect(reihe.nth(3)).toHaveAttribute("data-zustand", "offen");
    await expect(reihe.nth(1)).toContainText("Installation");
    await expect(reihe.nth(1)).toContainText("1:35");
    // Nach Kennung, nicht nach Platz: Seit Prüfprofil B (dcd6313cf) steht „kern“ hinter den vier Browserteilen.
    await expect(reihe.and(page.locator('[data-schritt="browser-4"]'))).toContainText("Browser 4 von 4");
    await expect(page.getByTestId("release-test-starten")).toBeDisabled();
    await expect(page.getByText("Es läuft schon ein Release-Test.").first()).toBeVisible();

    // Abbrechen ist da und schickt den Stand des laufenden Tests, ohne Passkey-Frage.
    const abbrechen = page.getByTestId("release-test-abbrechen");
    await expect(abbrechen).toBeVisible();
    await abbrechen.click();
    await expect.poll(() => lage.gepostet.length).toBe(2);
    expect(lage.gepostet[1]?.weg).toBe("abbrechen");
    expect(lage.gepostet[1]?.body["commit"]).toBe(AUFTRAG);
});

test("ein Test, der sich gerade startet (Testpaket wird gebaut), sperrt den Knopf und sagt es; ein fehlgeschlagener Start nennt den Grund", async ({
    page,
}) => {
    const lage: Lage = {
        aktuell: sicht({ start: { commit: AUFTRAG, seit: new Date().toISOString(), zustand: "baut", grund: null } }),
        gepostet: [],
    };
    await oeffne(page, lage);
    await expect(page.getByTestId("release-test-startet")).toContainText("Das Testpaket wird gebaut");
    await expect(page.getByTestId("release-test-starten")).toBeDisabled();
    await expect(page.getByText("Der Start läuft: Das Testpaket wird gebaut.").first()).toBeVisible();
    await expect(page.getByTestId("release-test-abbrechen")).toHaveCount(0);

    const fehler: Lage = {
        aktuell: sicht({
            start: {
                commit: AUFTRAG,
                seit: new Date().toISOString(),
                zustand: "fehler",
                grund: "Testpaket nicht gebaut: kein Platz",
            },
        }),
        gepostet: [],
    };
    const zweite = await page.context().newPage();
    await oeffne(zweite, fehler);
    await expect(zweite.getByTestId("release-test-start-fehler")).toContainText(
        "Start gescheitert: Testpaket nicht gebaut: kein Platz",
    );
    await expect(zweite.getByTestId("release-test-starten")).toBeEnabled();
});

test("🔴 ein gescheiterter Start ist der Zustand der Karte, nicht der Lauf davor: „Start gescheitert“ steht oben, der alte Lauf darunter mit dem Hinweis auf den anderen Stand", async ({
    page,
}) => {
    const alterLauf = lauf({
        zustand: "rot",
        sha: STAGE,
        start: "2026-10-23T10:00:00.000Z",
        ende: "2026-10-23T11:10:00.000Z",
        schritte: schritte({ vorbereitung: "fertig", installation: "fertig", tests: "fehler" }),
        fortschritt: 0.2,
        grund: "tests: Exit 1",
        fehler: { schritt: "tests", grund: "tests: Exit 1", faelle: [], faelleGesamt: 0, protokollEnde: [] },
    });
    const gescheitert = sicht({
        lauf: alterLauf,
        start: {
            commit: AUFTRAG,
            seit: new Date().toISOString(),
            zustand: "fehler",
            grund: "Der Starter wurde beendet, bevor der Runner lief (sein Prozess 1234 lebt nicht mehr).",
        },
    });
    await oeffne(page, { aktuell: gescheitert, gepostet: [] });
    const fehler = page.getByTestId("release-test-start-fehler");
    await expect(fehler).toBeVisible({ timeout: 20_000 });
    await expect(fehler).toContainText("Start gescheitert: Der Starter wurde beendet, bevor der Runner lief");
    // Der Stand des Starts steht dabei (7 Stellen), nicht der des alten Laufs.
    await expect(fehler).toContainText("b2ee1b3");
    // Der alte Lauf steht darunter und ist als solcher benannt, samt dem Hinweis, dass er zu einem anderen Stand gehört.
    await expect(page.getByTestId("release-test-vorheriger")).toHaveText("Vorheriger Lauf");
    await expect(page.getByTestId("release-test-zustand")).toContainText("rot · beendet um");
    await expect(page.getByTestId("release-test-anderer-stand")).toContainText(
        "gehört zu einem anderen Stand (a7728a1) als der Kandidat (b2ee1b3)",
    );
    const oben = await fehler.boundingBox();
    const unten = await page.getByTestId("release-test-zustand").boundingBox();
    expect(oben).not.toBeNull();
    expect(unten).not.toBeNull();
    expect(oben?.y ?? 0).toBeLessThan(unten?.y ?? 0);
    // Schritte und Balken gehören zu einem Lauf, der nicht zählt: Sie würden wie der Fortschritt des neuen Starts aussehen.
    await expect(page.getByTestId("release-test-schritte")).toHaveCount(0);
    await expect(page.getByTestId("release-test-balken")).toHaveCount(0);
    // Der nächste Versuch ist erlaubt.
    await expect(page.getByTestId("release-test-starten")).toBeEnabled();
});

test("ein Start, der das Testpaket baut, steht über dem Lauf davor; auch dann gehört dessen Lauf zu einem anderen Stand", async ({
    page,
}) => {
    const baut = sicht({
        lauf: lauf({
            zustand: "gruen",
            sha: STAGE,
            start: "2026-10-23T10:00:00.000Z",
            ende: "2026-10-23T12:30:00.000Z",
        }),
        start: { commit: AUFTRAG, seit: new Date().toISOString(), zustand: "baut", grund: null },
    });
    await oeffne(page, { aktuell: baut, gepostet: [] });
    const startet = page.getByTestId("release-test-startet");
    await expect(startet).toContainText("Das Testpaket wird gebaut", { timeout: 20_000 });
    await expect(startet).toContainText("b2ee1b3");
    await expect(page.getByTestId("release-test-vorheriger")).toHaveText("Vorheriger Lauf");
    await expect(page.getByTestId("release-test-anderer-stand")).toContainText("a7728a1");
    await expect(page.getByTestId("release-test-schritte")).toHaveCount(0);
    await expect(page.getByTestId("release-test-starten")).toBeDisabled();
});

test("ist dieser Stand schon grün geprüft und freigegeben, bleibt der Knopf zu und nennt den Grund; ein grüner Lauf für einen anderen Stand sperrt nichts", async ({
    page,
}) => {
    const gruen = (sha: string): ReleaseTestSicht =>
        sicht({
            // WI-0248: Gesperrt ist ein grüner Stand nur mit seiner Freigabe (er geht dann ohnehin raus).
            kandidat: {
                stage: { sha: AUFTRAG, zeit: "2026-10-23T08:00:00Z" },
                auftrag: null,
                freigabe: {
                    sha,
                    zeit: "2026-10-23T09:00:00Z",
                    kennung: "RT-00000000-0000-4000-8000-000000000001",
                    von: "Vali",
                    zustand: "gruen",
                    ausliefern: true,
                    grund: "Release-Test grün",
                },
            },
            lauf: lauf({
                zustand: "gruen",
                sha,
                start: "2026-10-23T10:00:00.000Z",
                ende: "2026-10-23T12:30:00.000Z",
                schritte: schritte(Object.fromEntries(RELEASE_TEST_SCHRITTE.map((id) => [id, "fertig"]))),
                fortschritt: 1,
            }),
        });
    const lage: Lage = { aktuell: gruen(AUFTRAG), gepostet: [] };
    await oeffne(page, lage);
    await expect(page.getByTestId("release-test-zustand")).toContainText("grün · fertig um");
    await expect(page.getByTestId("release-test-balken")).toHaveAttribute("aria-valuenow", "100");
    await expect(page.getByTestId("release-test-starten")).toBeDisabled();
    await expect(page.getByText("Dieser Stand ist schon grün geprüft.").first()).toBeVisible();
    await expect(page.getByTestId("release-test-abbrechen")).toHaveCount(0);
    await expect(page.getByTestId("release-test-bericht")).toHaveCount(0);

    // Derselbe Stand: kein Hinweis auf einen anderen.
    await expect(page.getByTestId("release-test-anderer-stand")).toHaveCount(0);

    lage.aktuell = gruen(STAGE);
    await page.goto("/?verwaltung=production");
    await expect(page.getByTestId("release-test-starten")).toBeEnabled({ timeout: 20_000 });
    await expect(page.getByTestId("release-test-anderer-stand")).toContainText(
        "gehört zu einem anderen Stand (a7728a1) als der Kandidat (b2ee1b3)",
    );
});

test("🔴 rot: Fehlerbericht mit Schritt, Grund, roten Fällen und Protokollende; „Bericht kopieren“ legt genau das in die Zwischenablage", async ({
    page,
    context,
}) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const rot = sicht({
        lauf: lauf({
            zustand: "rot",
            sha: AUFTRAG,
            start: "2026-10-23T10:00:00.000Z",
            ende: "2026-10-23T11:10:00.000Z",
            ordner: "C:/avesmaps3d-data/release-werkzeug/.release-runs/b2ee1b3",
            schritte: schritte({ vorbereitung: "fertig", installation: "fertig", tests: "fehler" }),
            fortschritt: 0.2,
            grund: "tests: Exit 1",
            fehler: {
                schritt: "tests",
                grund: "tests: Exit 1",
                faelle: [
                    { datei: "apps/server/test/a.test.ts", name: "A rechnet", meldung: ["erwartet 2", "bekam 3"] },
                    { datei: "apps/web/test/b.test.ts", name: "", meldung: ["Cannot find module"] },
                ],
                faelleGesamt: 25,
                protokollEnde: ["Zeile 1", "FAIL apps/server/test/a.test.ts"],
            },
        }),
    });
    await oeffne(page, { aktuell: rot, gepostet: [] });
    const bericht = page.getByTestId("release-test-bericht");
    await expect(bericht).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("release-test-zustand")).toContainText("rot · beendet um");
    await expect(page.getByTestId("release-test-bericht-schritt")).toHaveText("Fehlgeschlagen in: Alle Tests");
    await expect(page.getByTestId("release-test-bericht-grund")).toHaveText("tests: Exit 1");
    await expect(bericht).toContainText("Rote Fälle: 25");
    await expect(bericht).toContainText("Gezeigt werden die ersten 2.");
    await expect(page.getByTestId("release-test-faelle").locator("li")).toHaveCount(2);
    await expect(page.getByTestId("release-test-faelle")).toContainText("apps/server/test/a.test.ts");
    await expect(page.getByTestId("release-test-faelle")).toContainText("A rechnet");
    await expect(page.getByTestId("release-test-faelle")).toContainText("bekam 3");
    await expect(page.getByTestId("release-test-protokoll")).toContainText("FAIL apps/server/test/a.test.ts");
    await expect(page.getByTestId("release-test-ordner")).toContainText(".release-runs/b2ee1b3");
    // Nach Rot geht ein neuer Start.
    await expect(page.getByTestId("release-test-starten")).toBeEnabled();

    await page.getByTestId("release-test-bericht-kopieren").click();
    await expect(page.getByTestId("release-test-kopiert")).toHaveText("Der Bericht liegt in der Zwischenablage.");
    // Unter Windows kommt der Text mit CRLF aus der Zwischenablage zurück.
    const text = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/gu, "\n");
    expect(text).toContain("Release-Test: rot");
    expect(text).toContain(`Stand: ${AUFTRAG}`);
    expect(text).toContain("Start: 2026-10-23T10:00:00.000Z · Ende: 2026-10-23T11:10:00.000Z");
    expect(text).toContain("Fehlgeschlagen in: Alle Tests");
    expect(text).toContain("Rote Fälle (2 von 25):");
    expect(text).toContain("- apps/server/test/a.test.ts › A rechnet\n    erwartet 2\n    bekam 3");
    expect(text).toContain("Ende des Protokolls (Alle Tests):\nZeile 1\nFAIL apps/server/test/a.test.ts");
    expect(text).toContain("Vollständige Berichte: C:/avesmaps3d-data/release-werkzeug/.release-runs/b2ee1b3");
});

test("🔴 nur lokal: Auf der Stage gibt es die Karte nicht und niemand fragt nach der Route; antwortet sie lokal nicht, bleibt der Satz „keine Freigaben“", async ({
    page,
}) => {
    const aufrufe: string[] = [];
    page.on("request", (anfrage) => {
        if (new URL(anfrage.url()).pathname.startsWith(RELEASE_TEST_URL)) aufrufe.push(anfrage.url());
    });
    await oeffne(page, { aktuell: sicht(), gepostet: [] }, { environment: "staging" });
    await expect(page.getByTestId("production-ohne")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("release-test")).toHaveCount(0);
    expect(aufrufe).toEqual([]);

    const lokalOhneRoute = await page.context().newPage();
    await oeffne(lokalOhneRoute, { aktuell: "nicht-da", gepostet: [] });
    await expect(lokalOhneRoute.getByTestId("production-ohne")).toBeVisible({ timeout: 20_000 });
    await expect(lokalOhneRoute.getByTestId("release-test")).toHaveCount(0);
});

test("ein Starter, der sich nicht lesen ließ, sagt es in der Karte, statt sie zu verstecken; einen Knopf zum Starten gibt es dann nicht", async ({
    page,
}) => {
    const lage: Lage = {
        aktuell: sicht({
            verfuegbar: false,
            fehler: "Der Starter lieferte keine lesbare Antwort.",
            kandidat: null,
            lauf: null,
        }),
        gepostet: [],
    };
    await oeffne(page, lage);
    await expect(page.getByTestId("release-test-nicht-verfuegbar")).toContainText(
        "Der Starter lieferte keine lesbare Antwort.",
    );
    await expect(page.getByTestId("release-test-starten")).toHaveCount(0);
});

// ───────────────────────── Browserteile nach Thema, Rote Teile wiederholen (WI-0248) ─────────────────────────

const BEREICHE: Record<string, string[]> = {
    "browser-1": ["orte", "wege", "kraftlinien", "beschriftungen", "editorbedienung"],
    "browser-2": ["gebiete", "landschaften", "gebirge", "gelaende", "darstellung"],
    "browser-3": ["kamera", "kartenbedienung", "systemsteuerung", "medien", "betrieb"],
    "browser-4": ["infopanel", "fenster", "sprachen", "reisen", "planer", "spielmodus"],
};
const teil = (id: ReleaseTestTeil["id"], patch: Partial<ReleaseTestTeil> = {}): ReleaseTestTeil => ({
    id,
    name: `Name ${id}`,
    bereiche: BEREICHE[id] ?? [],
    zustand: "gruen",
    uebernommen: false,
    erwartetMs: 1_800_000,
    ...patch,
});

/** Ein roter Lauf des Kandidaten, der nach einer Wiederholung zwei Teile übernahm: Browser 2 rot, Browser 3 entfallen. */
const rotMitTeilen = (patch: Partial<ReleaseTestLauf> = {}): ReleaseTestSicht =>
    sicht({
        lauf: lauf({
            zustand: "rot",
            sha: AUFTRAG,
            start: "2026-10-24T10:00:00.000Z",
            ende: "2026-10-24T11:50:00.000Z",
            ordner: "C:/avesmaps3d-data/release-werkzeug/.release-runs/b2ee1b3",
            wiederholbar: true,
            schritte: RELEASE_TEST_SCHRITTE.map((id) => {
                const uebernommen = ["lint", "format", "typen", "tests", "bau", "besucherpaket", "browser-1"].includes(
                    id,
                );
                const zustand: ReleaseTestSchritt["zustand"] = uebernommen
                    ? "uebernommen"
                    : id === "browser-2"
                      ? "fehler"
                      : id === "browser-3"
                        ? "uebersprungen"
                        : "fertig";
                return {
                    id,
                    zustand,
                    ...(zustand === "uebernommen" || zustand === "uebersprungen"
                        ? {}
                        : { start: "2026-10-24T10:00:00.000Z", dauerMs: 120_000 }),
                    erwartetMs: zustand === "uebernommen" || zustand === "uebersprungen" ? 0 : 120_000,
                    schaetzung: false,
                };
            }),
            fortschritt: 0.9,
            teile: [
                teil("browser-1", { uebernommen: true, faelle: 373, rot: 0, erwartetMs: 0 }),
                teil("browser-2", { zustand: "rot", faelle: 437, rot: 2, dauerMs: 1_980_000 }),
                teil("browser-3", {
                    zustand: "uebersprungen",
                    faelle: 427,
                    faelleSchaetzung: true,
                    grund: "Martin ließ sich nicht starten",
                }),
                teil("browser-4", { faelle: 497, rot: 0, dauerMs: 1_740_000 }),
            ],
            wiederholung: {
                von: `${AUFTRAG}-20261024T090000Z`,
                uebernommen: ["voll", "browser-1"],
                neu: ["browser-2", "browser-3", "browser-4"],
                grund: null,
            },
            grund: "Browserteil 2 (Name browser-2): 2 rot",
            fehler: {
                schritt: "browser-2",
                grund: "Browserteil 2 (Name browser-2): 2 rot\nBrowserteil 3 (Name browser-3) nicht gelaufen: Martin ließ sich nicht starten",
                faelle: [
                    {
                        datei: "gebietseditor.spec.ts",
                        name: "[rot] D2 Zoombänder",
                        meldung: ["leer"],
                        teil: "browser-2",
                        teilName: "Name browser-2",
                    },
                    {
                        datei: "landschaftseditor-gebirge.spec.ts",
                        name: "[rot] Vorschau",
                        meldung: [],
                        teil: "browser-2",
                        teilName: "Name browser-2",
                    },
                ],
                faelleGesamt: 2,
                protokollEnde: ["Zeile 1"],
            },
            ...patch,
        }),
    });

test("🔴 die Browserteile nach Thema stehen mit Name, Bereichen, Zahl der Fälle, Zustand und Zeit da; rote Fälle nennen ihren Teil", async ({
    page,
}) => {
    await oeffne(page, { aktuell: rotMitTeilen(), gepostet: [] });
    const liste = page.getByTestId("release-test-teile");
    await expect(liste).toBeVisible({ timeout: 20_000 });
    const zeilen = liste.locator("li");
    await expect(zeilen).toHaveCount(4);

    // Teil 1: übernommen aus dem früheren Lauf, grün, mit seinen Bereichen in der Sprache der Seite.
    await expect(zeilen.nth(0)).toHaveAttribute("data-zustand", "gruen");
    await expect(zeilen.nth(0)).toHaveAttribute("data-uebernommen", "ja");
    await expect(zeilen.nth(0).getByTestId("release-test-teil-name")).toHaveText(
        "Browser 1 von 4 · Orte, Wege, Kraftlinien",
    );
    await expect(zeilen.nth(0).getByTestId("release-test-teil-bereiche")).toHaveText(
        "Orte, Wege, Kraftlinien, Beschriftungen, Editorbedienung",
    );
    await expect(zeilen.nth(0).getByTestId("release-test-teil-faelle")).toHaveText("Fälle: 373");
    await expect(zeilen.nth(0).getByTestId("release-test-teil-zustand")).toHaveText("grün");
    await expect(zeilen.nth(0).getByTestId("release-test-teil-zeit")).toHaveText("übernommen");

    // Teil 2: rot, mit der Zahl der roten Fälle und der Zeit.
    await expect(zeilen.nth(1)).toHaveAttribute("data-zustand", "rot");
    await expect(zeilen.nth(1).getByTestId("release-test-teil-name")).toHaveText(
        "Browser 2 von 4 · Gebiete, Landschaften, Darstellung",
    );
    await expect(zeilen.nth(1).getByTestId("release-test-teil-faelle")).toHaveText("Fälle: 437");
    await expect(zeilen.nth(1).getByTestId("release-test-teil-rot")).toHaveText("rot: 2");
    await expect(zeilen.nth(1).getByTestId("release-test-teil-zeit")).toHaveText("33:00");

    // Teil 3: nicht gelaufen, mit dem Grund; die Zahl der Fälle ist die aus dem früheren Lauf und als Schätzung gekennzeichnet.
    await expect(zeilen.nth(2)).toHaveAttribute("data-zustand", "uebersprungen");
    await expect(zeilen.nth(2).getByTestId("release-test-teil-zustand")).toHaveText("nicht gelaufen");
    await expect(zeilen.nth(2)).toContainText("Martin ließ sich nicht starten");
    await expect(zeilen.nth(2).getByTestId("release-test-teil-faelle")).toHaveText("Fälle: ≈ 427");

    // Teil 4: grün, neu gelaufen.
    await expect(zeilen.nth(3)).toHaveAttribute("data-uebernommen", "nein");
    await expect(zeilen.nth(3).getByTestId("release-test-teil-zeit")).toHaveText("29:00");

    // Die Liste der Schritte nennt die vier Browserteile nicht noch einmal; übernommene und entfallene Schritte tragen ihren Zustand.
    const schritte = page.getByTestId("release-test-schritte").locator("li");
    await expect(schritte).toHaveCount(RELEASE_TEST_SCHRITTE.length - 4);
    await expect(page.getByTestId("release-test-schritte").locator('[data-schritt^="browser-"]')).toHaveCount(0);
    await expect(page.locator('[data-schritt="lint"]')).toHaveAttribute("data-zustand", "uebernommen");
    await expect(page.locator('[data-schritt="besucherpaket"]')).toContainText("übernommen");

    // Was die Wiederholung übernahm, steht in einem Satz.
    await expect(page.getByTestId("release-test-wiederholung")).toContainText(
        "Wiederholung: übernommen Alle Tests, Browser 1 von 4 · Orte, Wege, Kraftlinien; neu gelaufen: Browser 2 von 4",
    );

    // Jeder rote Fall nennt seinen Teil.
    const faelle = page.getByTestId("release-test-faelle");
    await expect(faelle.locator("li")).toHaveCount(2);
    await expect(faelle.getByTestId("release-test-fall-teil")).toHaveCount(2);
    await expect(faelle.getByTestId("release-test-fall-teil").first()).toContainText(
        "Browser 2 von 4 · Gebiete, Landschaften, Darstellung",
    );
    await expect(page.getByTestId("release-test-bericht-grund")).toContainText(
        "nicht gelaufen: Martin ließ sich nicht starten",
    );
});

test("🔴 „Rote Teile wiederholen“ steht bei einem roten Lauf des Kandidaten und schickt denselben Stand mit wiederholen", async ({
    page,
}) => {
    const lage: Lage = { aktuell: rotMitTeilen(), gepostet: [] };
    await oeffne(page, lage, {
        auf: sicht({ lauf: lauf({ zustand: "laeuft", sha: AUFTRAG, lebt: true, start: new Date().toISOString() }) }),
    });
    const knopf = page.getByTestId("release-test-wiederholen");
    await expect(knopf).toBeVisible({ timeout: 20_000 });
    await expect(knopf).toHaveText("Rote Teile wiederholen");
    await expect(knopf).toBeEnabled();
    await expect(knopf).toHaveAttribute("title", /Grüne Teile werden aus dem früheren Lauf übernommen/);
    // Der gewöhnliche Neustart bleibt daneben möglich.
    await expect(page.getByTestId("release-test-starten")).toBeEnabled();

    await knopf.click();
    await expect.poll(() => lage.gepostet.length).toBe(1);
    expect(lage.gepostet[0]?.weg).toBe("starten");
    expect(lage.gepostet[0]?.body["commit"]).toBe(AUFTRAG);
    expect(lage.gepostet[0]?.body["wiederholen"]).toBe(true);
    // Danach läuft der Test: kein Wiederholen-Knopf mehr.
    await expect(page.getByTestId("release-test-wiederholen")).toHaveCount(0);
    await expect(page.getByTestId("release-test-zustand")).toContainText("läuft seit");
});

test("„Rote Teile wiederholen“ gibt es nur, wenn es für den Kandidaten einen roten Lauf gibt: nicht bei Grün, Lauf, anderem Stand, ohne Kennzeichen oder ohne Lauf", async ({
    page,
}) => {
    const lage: Lage = { aktuell: sicht(), gepostet: [] };
    await oeffne(page, lage);
    await expect(page.getByTestId("release-test-starten")).toBeEnabled({ timeout: 20_000 });
    await expect(page.getByTestId("release-test-wiederholen")).toHaveCount(0);
    const faelle: [string, ReleaseTestSicht][] = [
        ["grün", sicht({ lauf: lauf({ zustand: "gruen", sha: AUFTRAG, wiederholbar: false }) })],
        ["läuft", sicht({ lauf: lauf({ zustand: "laeuft", sha: AUFTRAG, lebt: true, wiederholbar: false }) })],
        ["roter Lauf eines anderen Standes", rotMitTeilen({ sha: STAGE })],
        ["rot, aber der Starter meldet es nicht als wiederholbar", rotMitTeilen({ wiederholbar: false })],
    ];
    for (const [name, aktuell] of faelle) {
        lage.aktuell = aktuell;
        await page.goto("/?verwaltung=production");
        await expect(page.getByTestId("release-test"), name).toBeVisible({ timeout: 20_000 });
        await expect(page.getByTestId("release-test-zustand"), name).not.toBeEmpty();
        await expect(page.getByTestId("release-test-wiederholen"), name).toHaveCount(0);
    }
    // Rot und wiederholbar, aber ein Start baut gerade das Testpaket: der Knopf steht, ist aber zu.
    lage.aktuell = {
        ...rotMitTeilen(),
        start: { commit: AUFTRAG, seit: new Date().toISOString(), zustand: "baut", grund: null },
    };
    await page.goto("/?verwaltung=production");
    await expect(page.getByTestId("release-test-wiederholen")).toBeDisabled({ timeout: 20_000 });
});

test("In einem schmalen Fenster (900 px) bleibt die Karte mit den Browserteilen innerhalb der Breite: kein Seitwärtsscrollen", async ({
    page,
}) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await oeffne(page, { aktuell: rotMitTeilen(), gepostet: [] });
    const karte = page.getByTestId("release-test");
    await expect(page.getByTestId("release-test-teile")).toBeVisible({ timeout: 20_000 });
    const ueberlauf = await karte.evaluate((el) => ({
        karte: el.scrollWidth - el.clientWidth,
        seite: document.documentElement.scrollWidth - window.innerWidth,
    }));
    expect(ueberlauf.karte).toBeLessThanOrEqual(1);
    expect(ueberlauf.seite).toBeLessThanOrEqual(1);
    await expect(page.getByTestId("release-test-wiederholen")).toBeVisible();
});

test("🔴 ein Druck räumt die Karte: bis zur Antwort steht nur „Starte Lauf …“; eine Abweisung trägt ihre Uhrzeit, der alte Lauf steht als „Vorheriger Lauf“ darunter", async ({
    page,
}) => {
    const rot = sicht({
        lauf: lauf({
            zustand: "rot",
            sha: AUFTRAG,
            start: "2026-10-23T10:00:00.000Z",
            ende: "2026-10-23T11:10:00.000Z",
            schritte: schritte({ vorbereitung: "fertig", installation: "fertig", tests: "fehler" }),
            fortschritt: 0.2,
            grund: "tests: Exit 1",
            fehler: { schritt: "tests", grund: "tests: Exit 1", faelle: [], faelleGesamt: 0, protokollEnde: [] },
        }),
    });
    await oeffne(page, { aktuell: rot, gepostet: [] });
    // Der Start hängt, bis der Test ihn freigibt: So bleibt der Moment zwischen Druck und Antwort sichtbar.
    let antworten: () => void = () => undefined;
    const halt = new Promise<void>((weiter) => (antworten = weiter));
    await page.route(`**${RELEASE_TEST_URL}/starten`, async (route) => {
        await halt;
        await route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({ error: { code: "release_test_laeuft", message: "x" } }),
        });
    });
    await expect(page.getByTestId("release-test-bericht")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("release-test-letzter")).toBeVisible();

    await page.getByTestId("release-test-starten").click();
    await expect(page.getByTestId("release-test-versuch")).toHaveText("Starte Lauf …");
    await expect(page.getByTestId("release-test-bericht")).toHaveCount(0);
    await expect(page.getByTestId("release-test-zustand")).toHaveCount(0);
    await expect(page.getByTestId("release-test-letzter")).toHaveCount(0);
    await expect(page.getByTestId("release-test-starten")).toBeDisabled();

    antworten();
    await expect(page.getByTestId("release-test-abweisung")).toContainText(/Nicht ausgeführt \(\d\d:\d\d:\d\d\):/);
    await expect(page.getByTestId("release-test-versuch")).toHaveCount(0);
    await expect(page.getByTestId("release-test-vorheriger")).toHaveText("Vorheriger Lauf");
    await expect(page.getByTestId("release-test-letzter")).toHaveCount(0);
    await expect(page.getByTestId("release-test-bericht")).toBeVisible();
});

test("🔴 Starten reiht ein (WI-0248): bis zur Quittung „Starte Lauf …“, danach der Auftrag mit Platz und dem, worauf er wartet; der alte Lauf steht als „Vorheriger Lauf“ ohne Bericht", async ({
    page,
}) => {
    const rot = lauf({
        zustand: "rot",
        sha: AUFTRAG,
        start: "2026-10-23T10:00:00.000Z",
        ende: "2026-10-23T11:10:00.000Z",
        schritte: schritte({ vorbereitung: "fertig", installation: "fertig", tests: "fehler" }),
        fortschritt: 0.2,
        grund: "tests: Exit 1",
        fehler: { schritt: "tests", grund: "tests: Exit 1", faelle: [], faelleGesamt: 0, protokollEnde: [] },
    });
    const auftrag = {
        id: "00000000-0000-4000-8000-000000000001",
        commit: AUFTRAG,
        wiederholen: false,
        seit: new Date().toISOString(),
        abbruch: false,
    };
    const eingereiht = sicht({
        lauf: rot,
        auftrag: { ...auftrag, zustand: "wartet", platz: 2, wartetAuf: "terrain_full", grund: "waits_slot" },
    });
    const lage: Lage = { aktuell: sicht({ lauf: rot }), gepostet: [] };
    await oeffne(page, lage, { auf: eingereiht });
    await expect(page.getByTestId("release-test-bericht")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("release-test-starten").click();
    await expect.poll(() => lage.gepostet.length).toBe(1);
    expect(lage.gepostet[0]?.weg).toBe("starten");

    // Nach der Quittung: der Auftrag, nicht mehr der Versuch, und nicht der Bericht des alten Laufs.
    const zeile = page.getByTestId("release-test-eingereiht");
    await expect(zeile).toContainText("Eingereiht in die Warteschlange · Platz 2 · wartet auf „Gelände voll rechnen“");
    await expect(zeile).toContainText("b2ee1b3");
    await expect(page.getByTestId("release-test-versuch")).toHaveCount(0);
    await expect(page.getByTestId("release-test-vorheriger")).toHaveText("Vorheriger Lauf");
    await expect(page.getByTestId("release-test-bericht")).toHaveCount(0);
    await expect(page.getByTestId("release-test-schritte")).toHaveCount(0);
    await expect(page.getByTestId("release-test-starten")).toBeDisabled();
    await expect(page.getByTestId("release-test-start-grund")).toHaveText("Ein Release-Test ist schon eingereiht.");

    // Abbrechen gilt dem Auftrag.
    await page.getByTestId("release-test-abbrechen").click();
    await expect.poll(() => lage.gepostet.length).toBe(2);
    expect(lage.gepostet[1]).toMatchObject({ weg: "abbrechen", body: { commit: AUFTRAG } });

    // Der Ausführer hat ihn übernommen, ein Lauf steht noch nicht da: der Satz dazu; mit angefordertem Abbruch auch der.
    lage.aktuell = sicht({
        lauf: rot,
        auftrag: { ...auftrag, zustand: "laeuft", platz: null, wartetAuf: null, grund: null, abbruch: true },
    });
    await expect(page.getByTestId("release-test-auftrag-startet")).toContainText(
        "Der Auftrag läuft, der Starter wird gerufen.",
        { timeout: 20_000 },
    );
    await expect(page.getByTestId("release-test-abbruch-angefordert")).toBeVisible();
    await expect(page.getByTestId("release-test-eingereiht")).toHaveCount(0);
});
