import { expect, test, type Page } from "@playwright/test";
import { RONDRIKAN, abgleicheServer, abgleicheStand, zeile, type AbgleicheServer } from "./abgleiche-stub.ts";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Der Eintrag „Abgleiche“ in der Verwaltung (WI-0127 SYS-14) am Rechner, gegen den Nachbau (`abgleiche-stub.ts`); die echten Routen
 * prüft `apps/server/test/abgleiche-routes.test.ts`, das Blatt erzeugt `abgleiche-review.spec.ts`.
 *
 * - Der Betreiber sieht beide Zeilen mit Kreis und Unterzeile; ein Druck auf „⇄ Jetzt abgleichen“ fragt erst, nichts geht hinaus;
 *   „Jetzt abgleichen“ schickt Kennung und Quelle, danach wartet der Auftrag und der Knopf steht gesperrt mit Satz.
 * - Ohne `run_legacy_sync` (Admin) und auf einer Umgebung ohne Ausführung steht der Knopf gesperrt mit Satz, es geht nichts hinaus.
 * - Läuft kein Planer, bleibt nach dem Start ein Hinweis an der Zeile.
 */

const OPERATOR = [...ADMIN_CAPABILITIES, "manage_system_settings", "access_restricted_mode", "run_legacy_sync"];

async function oeffnen(page: Page, server: AbgleicheServer, capabilities: string[] = OPERATOR) {
    const calls = await stubAdmin(page, {
        capabilities,
        role: capabilities.includes("run_legacy_sync") ? "operator" : "admin",
        answer: (call) => server.handle(call),
    });
    await page.goto("/edit");
    await page.getByTestId("kopfleiste-menue").click();
    await page.getByTestId("menue-systemsteuerung").click();
    await expect(page.getByRole("dialog", { name: "Systemsteuerung" })).toBeVisible();
    await page.getByTestId("verwaltung-eintrag-abgleiche").click();
    await expect(page.getByTestId("abgleich-legacy")).toBeVisible();
    return calls;
}

test("🔴 der Betreiber startet den Legacy-Zug: erst die Frage, dann Kennung und Quelle, danach wartet der Auftrag", async ({
    page,
}) => {
    const server = abgleicheServer();
    await oeffnen(page, server);
    await expect(page.getByTestId("abgleich-legacy-kreis")).toHaveAttribute("data-kreis", "voll");
    await expect(page.getByTestId("abgleich-medien-kreis")).toHaveAttribute("data-kreis", "halb");
    await expect(page.getByTestId("abgleich-legacy-unter")).toContainText("Letzter Datenabgleich:");
    await expect(page.getByTestId("abgleich-legacy-unter")).toContainText("ausgelöst von Rondrikan");
    await expect(page.getByTestId("abgleich-medien-unter")).toContainText("entfallen: Bilddateien");
    await expect(page.getByTestId("abgleiche-legende")).toContainText("zuletzt vollständig");

    await page.getByTestId("abgleich-legacy-knopf").click();
    await expect(page.getByTestId("abgleich-legacy-frage")).toContainText("Legacy-Zug jetzt starten?");
    expect(server.starts).toEqual([]);
    await page.getByTestId("abgleich-legacy-frage").getByRole("button", { name: "Jetzt abgleichen" }).click();
    await expect(page.getByTestId("abgleich-legacy-unter")).toContainText("Wartet");
    expect(server.starts).toHaveLength(1);
    expect(server.starts[0]?.["quelle"]).toBe("legacy");
    expect(String(server.starts[0]?.["operationId"])).toMatch(/^[0-9a-f-]{36}$/u);
    await expect(page.getByTestId("abgleich-legacy-knopf")).toBeDisabled();
    // Je Zeile wartet höchstens ein Auftrag (Betreiber 2026-10-17); hinter einem laufenden dürfte einer einreihen.
    await expect(page.getByTestId("abgleich-legacy")).toContainText("Dieser Datenabgleich wartet schon.");
    // Die andere Zeile bleibt frei.
    await expect(page.getByTestId("abgleich-medien-knopf")).toBeEnabled();
});

test("ein Admin ohne das Recht sieht die Abgleiche, startet aber nichts", async ({ page }) => {
    const server = abgleicheServer();
    await oeffnen(page, server, ADMIN_CAPABILITIES);
    await expect(page.getByTestId("abgleich-legacy-knopf")).toBeDisabled();
    await expect(page.getByTestId("abgleich-legacy")).toContainText(
        "Starten darf nur, wer das Recht „Legacy-Zug starten“ hat.",
    );
    await page.getByTestId("abgleich-legacy-knopf").click({ force: true });
    await expect(page.getByTestId("abgleich-legacy-frage")).toHaveCount(0);
    expect(server.starts).toEqual([]);
});

test("auf einer Umgebung ohne Ausführung steht der Knopf gesperrt mit Satz", async ({ page }) => {
    const server = abgleicheServer(abgleicheStand({ ausfuehrung: "aus" }));
    await oeffnen(page, server);
    await expect(page.getByTestId("abgleich-medien-knopf")).toBeDisabled();
    await expect(page.getByTestId("abgleich-medien")).toContainText(
        "Auf dieser Umgebung startet die Verwaltung keinen Datenabgleich.",
    );
});

test("ohne Planer bleibt nach dem Start ein Hinweis an der Zeile", async ({ page }) => {
    const server = abgleicheServer(abgleicheStand({ planerAktiv: false }));
    await oeffnen(page, server);
    await page.getByTestId("abgleich-medien-knopf").click();
    await page.getByTestId("abgleich-medien-frage").getByRole("button", { name: "Jetzt abgleichen" }).click();
    await expect(page.getByTestId("abgleich-medien-hinweis")).toContainText("Der Planer der Warteschlange läuft nicht");
    // Den Grund rechnet seit WI-0160 der Server; die Zeile übersetzt ihn.
    await expect(page.getByTestId("abgleich-medien-unter")).toContainText("Es läuft kein Worker der Warteschlange");
});

test("🔴 läuft ein Abgleich, zeigt ein grober Balken unter der Zeile, wie weit er ist; ein wartender hat keinen", async ({
    page,
}) => {
    const server = abgleicheServer(
        abgleicheStand({
            zeilen: [
                zeile("legacy", {
                    laufend: {
                        jobId: "7e570000-0000-4000-8000-0000000000d1",
                        state: "RUNNING",
                        queuedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
                        startedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
                        phase: "I11",
                        progress: 0.42,
                        waitReason: null,
                        ausgeloest: RONDRIKAN,
                    },
                }),
                zeile("medien", {
                    laufend: {
                        jobId: "7e570000-0000-4000-8000-0000000000d2",
                        state: "QUEUED",
                        queuedAt: new Date().toISOString(),
                        startedAt: null,
                        phase: null,
                        progress: null,
                        waitReason: "waits_slot",
                        ausgeloest: RONDRIKAN,
                    },
                }),
            ],
        }),
    );
    await oeffnen(page, server);
    const balken = page.getByTestId("abgleich-legacy-balken");
    await expect(balken).toHaveAttribute("role", "progressbar");
    await expect(balken).toHaveAttribute("aria-valuenow", "42");
    await expect(balken).toHaveAccessibleName("Fortschritt: Legacy-Zug");
    await expect(page.getByTestId("abgleich-legacy-unter")).toContainText("42 %");
    await expect(page.getByTestId("abgleich-medien-balken")).toHaveCount(0);
});
