import { expect, test, type Page } from "@playwright/test";
import { nichtEingerichtet, sicherungServer, sicherungStand, type SicherungServer } from "./sicherung-stub.ts";
import { stubKanal } from "./kanal-stub.ts";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Der Eintrag „Backups“ der Systemsteuerung (WI-0127 SYS-9, SYS-0001 §6.5, §9e) am Rechner, gegen den Nachbau (`sicherung-stub.ts`); die
 * echten Routen prüft `apps/server/test/sicherung-routes.test.ts`, das Blatt erzeugt `sicherung-review.spec.ts`.
 *
 * - Der Betreiber sieht Zustand, Felder und Teile; „⊕ Sicherung jetzt“ schickt eine Kennung, danach sagt die Zeile „angefordert“ und der
 *   Knopf steht gesperrt mit Satz.
 * - Ohne `run_backup` (Admin) und auf einer Umgebung ohne Sicherung steht der Knopf gesperrt mit Satz; es geht nichts hinaus.
 * - Ohne Statusdatei eine gestrichelte Fläche „nicht eingerichtet“, kein Fehler; ein gescheiterter Lauf nennt seinen Grund.
 * - „↶ Wiederherstellung beantragen“ (WI-0124 K5) nur mit `request_restore`: Grund Pflicht, danach der offene Antrag mit OPS-Nummer, die
 *   für Betreiber mit dem Kanal den Vorgang öffnet.
 */

const OPERATOR = [
    ...ADMIN_CAPABILITIES,
    "manage_system_settings",
    "access_restricted_mode",
    "run_legacy_sync",
    "run_backup",
];

async function oeffnen(page: Page, server: SicherungServer, capabilities: string[] = OPERATOR) {
    const calls = await stubAdmin(page, {
        capabilities,
        role: capabilities.includes("run_backup") ? "operator" : "admin",
        sicherung: server,
    });
    await page.goto("/edit");
    await page.getByTestId("kopfleiste-menue").click();
    await page.getByTestId("menue-systemsteuerung").click();
    await expect(page.getByRole("dialog", { name: "Systemsteuerung" })).toBeVisible();
    await page.getByTestId("verwaltung-eintrag-backup").click();
    await expect(page.getByTestId("verwaltung-backup")).toBeVisible();
    return calls;
}

const posts = (calls: { method: string; path: string }[]) =>
    calls.filter((call) => call.method === "POST" && call.path === "/api/admin/system/backup/start");

test("🔴 der Betreiber sieht die Sicherung und stößt sie an: Kennung hinaus, „angefordert“, Knopf gesperrt mit Satz", async ({
    page,
}) => {
    const server = sicherungServer(sicherungStand());
    const calls = await oeffnen(page, server);
    await expect(page.getByTestId("sicherung-geheim")).toContainText("Eine Sicherung ist ein Geheimnis.");
    await expect(page.getByTestId("sicherung-zustand")).toHaveText("aktuell");
    await expect(page.getByTestId("sicherung-letzte")).toContainText("täglich");
    await expect(page.getByTestId("sicherung-ausser-haus")).toContainText("Dropbox, geprüft");
    await expect(page.getByTestId("sicherung-aufbewahrung")).toHaveText(
        "3 hier · 7 täglich · 4 wöchentlich · 6 monatlich",
    );
    await expect(page.getByTestId("sicherung-teile").locator("li")).toHaveCount(3);
    await expect(page.getByTestId("sicherung-teil-db")).toContainText("Datenbanken");
    await expect(page.getByTestId("sicherung-teil-db")).toContainText("9f2c4be01d77");
    await expect(page.getByTestId("sicherung-teil-config")).toContainText("nur hier");

    const knopf = page.getByTestId("sicherung-jetzt");
    await expect(knopf).toContainText("⊕ Sicherung jetzt");
    await knopf.click();
    await expect.poll(() => posts(calls).length).toBe(1);
    expect(posts(calls)[0] as unknown as { body: { operationId: string } }).toMatchObject({
        body: { operationId: expect.stringMatching(/^[0-9a-f-]{36}$/u) },
    });
    // Die Zeile neben dem gesperrten Knopf sagt, warum er ruht; kein zweiter Satz.
    await expect(page.getByTestId("sicherung-satz")).toHaveText("Angefordert, wartet auf die Abholung.");
    await expect(knopf).toBeDisabled();
    await expect(page.getByTestId("verwaltung-backup")).not.toContainText("Ein Auftrag wartet auf die Abholung.");
    await knopf.click({ force: true });
    expect(posts(calls)).toHaveLength(1);
});

test("ein Admin ohne das Recht sieht die Sicherung, stößt aber nichts an", async ({ page }) => {
    const calls = await oeffnen(page, sicherungServer(sicherungStand()), ADMIN_CAPABILITIES);
    await expect(page.getByTestId("sicherung-zustand")).toHaveText("aktuell");
    await expect(page.getByTestId("verwaltung-backup")).toContainText(
        "Anstoßen darf nur, wer das Recht „Sicherung anstoßen“ hat.",
    );
    await page.getByTestId("sicherung-jetzt").click({ force: true });
    expect(posts(calls)).toEqual([]);
});

test("🔴 ohne Statusdatei: gestrichelt „nicht eingerichtet“, kein Fehler; ohne Verzeichnis ist der Knopf aus", async ({
    page,
}) => {
    const calls = await oeffnen(page, sicherungServer(nichtEingerichtet()));
    await expect(page.getByTestId("sicherung-zustand")).toHaveText("nicht eingerichtet");
    await expect(page.getByTestId("fenster-platzhalter")).toContainText("Das ist kein Fehler.");
    await expect(page.getByTestId("sicherung-teile")).toHaveCount(0);
    await expect(page.getByTestId("verwaltung-backup")).toContainText("Auf dieser Umgebung gibt es keine Sicherung.");
    await page.getByTestId("sicherung-jetzt").click({ force: true });
    expect(posts(calls)).toEqual([]);
});

test("ein gescheiterter Lauf nennt seinen Grund; überfällig heißt überfällig", async ({ page }) => {
    const server = sicherungServer(
        sicherungStand({
            zustand: "fehlgeschlagen",
            letzterLauf: {
                startedAt: new Date(Date.now() - 3_600_000).toISOString(),
                finishedAt: new Date(Date.now() - 3_500_000).toISOString(),
                result: "failed",
                errorCode: "offsite_failed",
                trigger: "timer",
                operationId: null,
            },
        }),
    );
    await oeffnen(page, server);
    await expect(page.getByTestId("sicherung-zustand")).toHaveText("fehlgeschlagen");
    await expect(page.getByTestId("sicherung-fehler")).toContainText("Kopie außer Haus gescheitert");
    server.state = sicherungStand({ zustand: "ueberfaellig" });
    await page.getByTestId("verwaltung-eintrag-betrieb").click();
    await page.getByTestId("verwaltung-eintrag-backup").click();
    await expect(page.getByTestId("sicherung-zustand")).toHaveText("überfällig");
});

const antraege = (calls: { method: string; path: string; body: Record<string, unknown> | null }[]) =>
    calls
        .filter((call) => call.method === "POST" && call.path === "/api/admin/system/backup/wiederherstellung")
        .map((call) => call.body);

test("🔴 Wiederherstellung beantragen: Grund Pflicht, Sicherung und Umfang gehen mit, danach der offene Antrag", async ({
    page,
}) => {
    const calls = await oeffnen(page, sicherungServer(sicherungStand()), [...OPERATOR, "request_restore"]);
    await page.getByTestId("wiederherstellung-beantragen").click();
    const frage = page.getByTestId("wiederherstellung-frage");
    await expect(frage).toContainText("Aus der App wird nie zurückgespielt.");
    const bestaetigen = frage.getByRole("button", { name: "Mit Passkey beantragen" });
    await expect(bestaetigen).toBeDisabled();
    await expect(page.getByTestId("wiederherstellung-sicherung").locator("option")).toHaveText([
        /^die letzte erfolgreiche · /u,
        "eine ältere (im Grund nennen)",
    ]);
    await page.getByTestId("wiederherstellung-umfang").getByText("Datenbank und Medien").click();
    await page.getByTestId("wiederherstellung-grund").fill("Nach dem Import fehlen 200 Orte im Süden.");
    await bestaetigen.click();

    await expect(frage).toHaveCount(0);
    expect(antraege(calls)).toEqual([
        expect.objectContaining({
            sicherung: "letzte",
            umfang: "datenbank_medien",
            grund: "Nach dem Import fehlen 200 Orte im Süden.",
        }),
    ]);
    const stand = page.getByTestId("wiederherstellung-stand");
    await expect(stand).toContainText("beantragt");
    await expect(stand).toContainText("OPS-000141");
    await expect(stand).toContainText("wartet auf Claudio");
    // Ohne den Kanal steht die Nummer als Text da.
    await expect(page.getByTestId("wiederherstellung-ops")).toHaveCount(0);
});

test("🔴 mit dem Kanal öffnet die OPS-Nummer des Antrags den Eintrag „Claudia & Claudio“", async ({ page }) => {
    await stubKanal(page);
    const server = sicherungServer(
        sicherungStand({
            wiederherstellung: {
                ops: "OPS-000141",
                status: "in_arbeit",
                beantragtAt: new Date(Date.now() - 20 * 60_000).toISOString(),
                umfang: "datenbank",
                sicherung: "aelter",
            },
        }),
    );
    await oeffnen(page, server, [...OPERATOR, "request_restore", "use_operator_channel"]);
    await expect(page.getByTestId("wiederherstellung-stand")).toContainText("im Kanal: in Arbeit");
    await page.getByTestId("wiederherstellung-ops").click();
    await expect(page.getByTestId("verwaltung-eintrag-claudio")).toHaveAttribute("aria-current", "page");
});

test("ohne request_restore gibt es keinen Antrag und keine Zeile dazu", async ({ page }) => {
    await oeffnen(page, sicherungServer(sicherungStand()));
    await expect(page.getByTestId("sicherung-jetzt")).toBeVisible();
    await expect(page.getByTestId("wiederherstellung-beantragen")).toHaveCount(0);
    await expect(page.getByTestId("wiederherstellung-stand")).toHaveCount(0);
});
