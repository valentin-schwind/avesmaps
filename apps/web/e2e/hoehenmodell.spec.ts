import { expect, test, type Page } from "@playwright/test";
import { ENTWURF, hoehenmodellServer, hoehenmodellStand, type HoehenmodellServer } from "./hoehenmodell-stub.ts";
import { passkeyBereit } from "./passkey-stub.ts";
import { ADMIN_CAPABILITIES, stubAdmin, type AdminCall } from "./verwaltung-stub.ts";

/**
 * Der Eintrag „Höhenmodell“ der Systemsteuerung (WI-0127 SYS-13, SYS-0001 §9c) am Rechner, gegen den Nachbau (`hoehenmodell-stub.ts`);
 * die echten Routen prüft `apps/server/test/hoehenmodell-routes.test.ts`, das Blatt erzeugt `hoehenmodell-review.spec.ts`.
 *
 * - Der Betreiber sieht „Gültig“, die Fassungen mit Kreis und die Werte; Aktivieren fragt an der Zeile nach dem Grund und danach nach dem
 *   Passkey (Frage 3 B), schickt Revision und Fassung, danach rechnet die Kette und die Schiene zeigt die neue Fassung.
 * - Ein Entwurf entsteht aus der gewählten Fassung mit nur den geänderten Reglern; Messen schickt nur den Entwurf.
 * - Ein Admin ohne `manage_terrain_recipe` sieht alles und schaltet nichts; auf Production wird nicht gemessen.
 */

const OPERATOR = [...ADMIN_CAPABILITIES, "manage_system_settings", "access_restricted_mode", "manage_terrain_recipe"];
const envelope = (code: string, details?: Record<string, unknown>) => ({
    error: { code, message: "vom Nachbau", ...(details === undefined ? {} : { details }) },
});

async function oeffnen(
    page: Page,
    server: HoehenmodellServer,
    options: {
        capabilities?: string[];
        answer?: (call: AdminCall) => { status: number; body: unknown } | undefined;
    } = {},
) {
    const capabilities = options.capabilities ?? OPERATOR;
    const calls = await stubAdmin(page, {
        capabilities,
        role: capabilities.includes("manage_terrain_recipe") ? "operator" : "admin",
        person: { passkeyCount: 1 },
        answer: (call) => options.answer?.(call) ?? server.handle(call),
    });
    await page.goto("/edit");
    await page.getByTestId("kopfleiste-menue").click();
    await page.getByTestId("menue-systemsteuerung").click();
    await expect(page.getByRole("dialog", { name: "Systemsteuerung" })).toBeVisible();
    await page.getByTestId("verwaltung-eintrag-hoehenmodell").click();
    await expect(page.getByTestId("hoehenmodell-zustand")).toBeVisible();
    return calls;
}

/** Stufe S wie der Server: ohne frischen Passkey verlangen Wählen, Zurück und Abnehmen ihn. */
function passkeyVerlangt(verifiziert: () => number) {
    return (call: AdminCall) =>
        call.method === "POST" && /\/hoehenmodell\/(waehlen|zurueck|abnehmen)$/u.test(call.path) && verifiziert() === 0
            ? { status: 403, body: envelope("reauth_required", { need: "passkey" }) }
            : undefined;
}

test("🔴 Aktivieren: Grund an der Zeile, Passkey im Moment, Revision und Fassung hinaus; danach rechnet die Kette", async ({
    page,
}) => {
    const passkey = await passkeyBereit(page);
    const server = hoehenmodellServer();
    const calls = await oeffnen(page, server, { answer: passkeyVerlangt(passkey.verifiziert) });

    await expect(page.getByTestId("hoehenmodell-zustand")).toHaveText("aktuell");
    await expect(page.getByTestId("hoehenmodell-eingestellt")).toContainText("Fassung 18 · seit");
    await expect(page.getByTestId("hoehenmodell-eingestellt")).toContainText("„sieht gut aus, das wollen wir“");
    await expect(page.getByTestId("hoehenmodell-hoehenlinien")).toContainText("passen zur Fassung 18");
    await expect(page.getByTestId("verwaltung-eintrag-hoehenmodell")).toHaveText("Höhenmodell18");
    await expect(page.getByTestId("hoehenmodell-fassung-18")).toContainText(
        "Fassung 18 · FastScape mit regionaler Isostasie",
    );
    await expect(page.getByTestId("hoehenmodell-fassung-17")).toContainText(
        "Fassung 17 · FastScape mit globaler Massenbilanz",
    );
    await expect(page.getByTestId("hoehenmodell-fassung-18")).toContainText("gilt");
    await expect(page.getByTestId("hoehenmodell-fassung-18")).toContainText("Radius 16 E · Sättigung 10");
    await expect(page.getByTestId("hoehenmodell-aktivieren-18")).toBeDisabled();
    await expect(page.getByTestId("hoehenmodell-werte")).toContainText("Werte von Fassung 18");
    await expect(page.getByTestId("hoehenmodell-tafel").locator("tbody tr")).toHaveCount(10);
    await expect(page.getByTestId("hoehenmodell-rest")).toContainText("Übrige 179 Werte");

    await page.getByTestId("hoehenmodell-aktivieren-17").click();
    const frage = page.getByTestId("hoehenmodell-frage-17");
    await expect(frage).toContainText("Fassung 17 aktivieren?");
    await expect(frage).toContainText("rund 20 Minuten");
    const knopf = frage.getByRole("button", { name: "Aktivieren" });
    await expect(knopf).toBeDisabled();
    await page.getByTestId("hoehenmodell-frage-17-grund").getByRole("textbox").fill("Vergleich mit dem alten Modell");
    await knopf.click();
    const bestaetigen = page.getByRole("dialog", { name: "Kurz bestätigen" });
    await expect(bestaetigen).toBeVisible();
    await bestaetigen.getByTestId("bestaetigen-passkey").click();
    await expect(bestaetigen).toBeHidden();

    await expect(page.getByTestId("hoehenmodell-zustand")).toHaveText("wartet");
    await expect(page.getByTestId("hoehenmodell-kette")).toContainText("Wartet: Gelände voll rechnen.");
    await expect(page.getByTestId("hoehenmodell-wirksam")).toContainText("Fassung 18");
    await expect(page.getByTestId("verwaltung-eintrag-hoehenmodell")).toHaveText("Höhenmodell17");
    await expect(page.getByTestId("hoehenmodell-zurueck")).toContainText("↺ Zurück auf Fassung 18");
    await expect(frage).toBeHidden();
    // Erst 403 (Passkey verlangt), dann mit derselben Kennung angenommen.
    const gewaehlt = calls
        .filter((call) => call.method === "POST" && call.path === "/api/admin/system/hoehenmodell/waehlen")
        .map((call) => ({ body: call.body ?? {} }));
    expect(gewaehlt).toHaveLength(2);
    expect(server.posts.filter((post) => post.path === "/waehlen")).toHaveLength(1);
    expect(gewaehlt[1]?.body).toMatchObject({ baseRevision: 2, version: 17, reason: "Vergleich mit dem alten Modell" });
    expect(gewaehlt[1]?.body["operationId"]).toBe(gewaehlt[0]?.body["operationId"]);
    expect(passkey.verifiziert()).toBe(1);
});

test("🔴 Entwurf aus der gewählten Fassung: nur geänderte Regler hinaus; Messen schickt nur den Entwurf; Verwerfen fragt", async ({
    page,
}) => {
    const server = hoehenmodellServer();
    await oeffnen(page, server);
    await page.getByTestId("hoehenmodell-neu").click();
    const formular = page.getByTestId("hoehenmodell-formular");
    await expect(formular).toContainText("Neuer Entwurf aus Fassung 18");
    const anlegen = page.getByTestId("hoehenmodell-anlegen");
    await expect(anlegen).toBeDisabled();
    await page.getByTestId("hoehenmodell-regler-saturation").getByRole("textbox").fill("12");
    await page.getByTestId("hoehenmodell-regler-radius").getByRole("textbox").fill("16");
    await page.getByTestId("hoehenmodell-regler-flankGrade").getByRole("textbox").fill("2");
    await expect(formular).toContainText("zwischen 0 und 1");
    await page.getByTestId("hoehenmodell-regler-flankGrade").getByRole("textbox").fill("");
    await page.getByTestId("hoehenmodell-formular-grund").getByRole("textbox").fill("weichere Gebirgsränder");
    await anlegen.click();
    await expect(formular).toBeHidden();

    const entwurf = page.getByTestId("hoehenmodell-entwurf");
    await expect(entwurf).toContainText("Entwurf aus Fassung 18");
    await expect(entwurf).toContainText("Sättigung 12 statt 10");
    await expect(page.getByTestId("hoehenmodell-werte")).toContainText("Werte des Entwurfs aus Fassung 18");
    await expect(page.getByTestId("hoehenmodell-wert-saturation")).toHaveText("12 statt 10");
    expect(server.posts.find((post) => post.path === "/entwurf")?.body).toMatchObject({
        basis: 18,
        aenderungen: { saturation: 12 },
        reason: "weichere Gebirgsränder",
    });

    await page.getByTestId("hoehenmodell-messen").click();
    await expect(page.getByTestId("hoehenmodell-messung")).toHaveText("Die Messung wartet auf einen freien Platz.");
    await expect(page.getByTestId("hoehenmodell-messen")).toBeDisabled();
    const messen = server.posts.find((post) => post.path === "/entwurf/messen");
    expect(Object.keys(messen?.body ?? {}).sort()).toEqual(["draft", "operationId"]);

    await page.getByTestId("hoehenmodell-verwerfen").click();
    await page.getByTestId("hoehenmodell-frage-verwerfen").getByRole("button", { name: "Verwerfen" }).click();
    await expect(entwurf).toHaveCount(0);
});

test("ein Admin ohne das Recht sieht das Höhenmodell, schaltet aber nichts; auf Production wird nicht gemessen", async ({
    page,
}) => {
    const server = hoehenmodellServer(hoehenmodellStand({ profil: "abgenommen", entwuerfe: [ENTWURF] }));
    await oeffnen(page, server, { capabilities: ADMIN_CAPABILITIES });
    await expect(page.getByTestId("hoehenmodell-zustand")).toHaveText("aktuell");
    await expect(page.getByTestId("hoehenmodell-neu")).toHaveCount(0);
    await expect(page.getByTestId("hoehenmodell-aktivieren-17")).toBeDisabled();
    await expect(page.getByTestId("hoehenmodell-zurueck")).toBeDisabled();
    await expect(page.getByTestId("verwaltung-hoehenmodell")).toContainText(
        "Umschalten braucht das Recht „Höhenmodell umschalten“.",
    );
    await page.getByTestId("hoehenmodell-aktivieren-17").click({ force: true });
    await page.getByTestId("hoehenmodell-messen").click({ force: true });
    expect(server.posts).toEqual([]);
});
