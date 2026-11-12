import { expect, test, type Page } from "@playwright/test";
import { inhalteServer, type InhalteServer } from "./inhalte-stub.ts";
import { passkeyBereit } from "./passkey-stub.ts";
import { ADMIN_CAPABILITIES, stubAdmin, type AdminCall } from "./verwaltung-stub.ts";

/**
 * Der Eintrag „Inhalte“ der Systemsteuerung (WI-0127 SYS-10, SYS-0001 §6.4; Blatt WI-0119 A2, A5) am Rechner, gegen den Nachbau
 * (`inhalte-stub.ts`); die echten Routen prüft `apps/server/test/inhaltsschalter.test.ts`, das Blatt `inhalte-review.spec.ts`.
 *
 * - Tafeln je Gruppe wie im Blatt; umlegen am Kästchen, ohne Dialog, der Browser fragt den Passkey, danach „aus seit … · Person“.
 * - Ohne `manage_system_settings` ruhen die Kästchen; der Satz steht einmal oben.
 */

const OPERATOR = [...ADMIN_CAPABILITIES, "manage_system_settings", "access_restricted_mode"];

async function oeffnen(
    page: Page,
    server: InhalteServer,
    options: {
        capabilities?: string[];
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
    await page.goto("/edit");
    await page.getByTestId("kopfleiste-menue").click();
    await page.getByTestId("menue-systemsteuerung").click();
    await expect(page.getByRole("dialog", { name: "Systemsteuerung" })).toBeVisible();
    await page.getByTestId("verwaltung-eintrag-inhalte").click();
    await expect(page.getByTestId("inhalte-art")).toBeVisible();
    return calls;
}

test("🔴 Kartenvorschauen ausschalten: Passkey im Moment, Revision hinaus, danach „aus seit … · Rondrikan“ und „1 aus“", async ({
    page,
}) => {
    const passkey = await passkeyBereit(page);
    const server = inhalteServer();
    const calls = await oeffnen(page, server, {
        answer: (call) =>
            call.method === "POST" && passkey.verifiziert() === 0
                ? {
                      status: 403,
                      body: { error: { code: "reauth_required", message: "x", details: { need: "passkey" } } },
                  }
                : undefined,
    });
    await expect(page.getByTestId("inhalte-unterwegs")).toHaveCount(0);
    await expect(page.getByTestId("inhalte-media.role.coat")).toContainText("Wappen");
    await expect(page.getByTestId("inhalte-liste-lizenzen").locator("li")).toHaveCount(5);
    await expect(page.getByTestId("inhalte-vorkommen")).toContainText("Fauna");
    await expect(page.getByTestId("inhalte-map.series.original")).toContainText("Kartenserie „Original“");

    await page.getByTestId("inhalte-kaestchen-media.role.map_preview").click();
    const bestaetigen = page.getByRole("dialog", { name: "Kurz bestätigen" });
    await expect(bestaetigen).toBeVisible();
    await bestaetigen.getByTestId("bestaetigen-passkey").click();
    await expect(bestaetigen).toBeHidden();
    await expect(page.getByTestId("inhalte-media.role.map_preview")).toContainText("aus seit");
    await expect(page.getByTestId("inhalte-media.role.map_preview")).toContainText("Rondrikan");
    await expect(page.getByTestId("inhalte-kaestchen-media.role.map_preview")).not.toBeChecked();
    await expect(page.getByTestId("verwaltung-eintrag-inhalte")).toHaveText("Medieninhalte1 aus");
    const gesendet = calls.filter((call) => call.method === "POST").map((call) => call.body);
    expect(gesendet).toHaveLength(2);
    expect(gesendet[1]).toMatchObject({ baseRevision: 4, key: "media.role.map_preview", enabled: false });
    expect(gesendet[1]?.["operationId"]).toBe(gesendet[0]?.["operationId"]);
});

test("ein Admin ohne das Recht sieht die Schalter, legt aber keinen um", async ({ page }) => {
    const server = inhalteServer();
    await oeffnen(page, server, { capabilities: ADMIN_CAPABILITIES });
    await expect(page.getByTestId("inhalte-nur-lesen")).toContainText("Umschalten braucht das Recht „Systemschalter“.");
    await expect(page.getByTestId("inhalte-kaestchen-panel.reviews")).toBeDisabled();
    await page.getByTestId("inhalte-kaestchen-panel.reviews").click({ force: true });
    expect(server.posts).toEqual([]);
});

// WI-0138 V7: Die Besucherzählung ist der erste Schalter der Gruppe „Betrieb“. Sie blendet nichts aus — die Seite tut
// dasselbe, sie wird nur nicht gezählt —, und deshalb steht sie in einer eigenen Tafel mit dem Verweis auf die Zahlen.
test("die Besucherzählung steht unter „Betrieb“ und lässt sich anhalten", async ({ page }) => {
    const server = inhalteServer();
    await oeffnen(page, server);
    await passkeyBereit(page);

    const tafel = page.getByTestId("inhalte-betrieb");
    await expect(tafel.getByText("Besucherzählung")).toBeVisible();
    await expect(tafel.getByText("Nichts — die Seite tut dasselbe, sie wird nur nicht gezählt.")).toBeVisible();
    await expect(page.getByText("Die Zahlen selbst stehen im Editorpanel unter „Status“.")).toBeVisible();

    await page.getByTestId("inhalte-kaestchen-visits.count").click();
    await expect.poll(() => server.posts.at(-1)?.["key"]).toBe("visits.count");
    expect(server.posts.at(-1)?.["enabled"]).toBe(false);
    await expect(page.getByTestId("inhalte-visits.count").getByText(/aus seit/)).toBeVisible();
});
