import { expect, test, type Page, type Route } from "@playwright/test";
import { passkeyBereit, type PasskeyStub } from "./passkey-stub.ts";
import { ADMIN_CAPABILITIES, ME, stubAdmin, type AdminCall } from "./verwaltung-stub.ts";

/**
 * Hotfix 2026-10-10 (Handover `2026-10-10-verwaltung-bestaetigung-beim-laden.md`, Betreiber: „ich komm in "Verwaltung" nicht mehr
 * rein“) und der Betreiberentscheid desselben Tages, wörtlich „ich will keine frist des 2. faktors. das is bescheuert.“ und
 * „entweder ich bin angemeldet oder nicht (also 2 faktoren oder keiner)“.
 *
 * - Eine Sitzung mit zweitem Faktor von gestern öffnet die Verwaltung ohne Rückfrage.
 * - Lehnt der Server die Listen beim Öffnen ab (alle gleichzeitig), geht GENAU EIN Fenster „Kurz bestätigen“ auf; mit Passkey
 *   (virtueller Authenticator wie in `betriebszustand.spec.ts`) laden danach alle Listen. Abgebrochen sagt jeder Bereich, was fehlt,
 *   und „Bestätigen“ bietet es für alle erneut an.
 * - Ohne zweiten Faktor steht im Menü statt „Verwaltung …“ der Satz mit „Mit Passkey bestätigen …“; nach dem Passwort folgt der
 *   Schritt im Anmeldefenster.
 * - Betreiberentscheid vom 2026-10-10, wörtlich „4. B“ („Für die Verwaltung immer den Passkey verlangen; Discord-Nutzer mit
 *   Verwaltungsrechten bestätigen einmal je Sitzung“): Nach JEDER Rückkehr von Discord folgt bei Verwaltungsrechten derselbe Schritt,
 *   auch mit Discord-2FA (der Server meldet `basic`), und weder dort noch in „Kurz bestätigen“ gibt es für den zweiten Faktor einen
 *   Weg über Discord.
 *
 * Sitzung und Verwaltungs-API sind Nachbauten (`verwaltung-stub.ts`): Die Regel selbst (zweiter Faktor ohne Frist) prüft der
 * Server gegen PostgreSQL (`apps/server/test/auth-session.test.ts`); hier geht es um das, was die Oberfläche daraus macht.
 */

const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const SECOND_FACTOR = {
    status: 403,
    body: { error: { code: "assurance_required", message: "x", details: { need: "second_factor" } } },
};
const DAY = 86_400_000;
/** Was die Kontenverwaltung beim Öffnen liest (seit SYS-15 ohne den Betriebszustand: der steht in der Systemsteuerung). */
const LESEWEGE = ["/api/admin/people", "/api/admin/invitations"];

/** Zählt im Browser, wie oft „Kurz bestätigen“ aufgeht (das `<dialog>` bekommt `open`). */
async function zaehleFenster(page: Page): Promise<() => Promise<number>> {
    await page.addInitScript(() => {
        const zaehler = globalThis as unknown as { __bestaetigenOffen: number };
        zaehler.__bestaetigenOffen = 0;
        new MutationObserver((records) => {
            for (const record of records) {
                const ziel = record.target as Element;
                if (ziel.getAttribute("data-testid") === "bestaetigen-fenster" && ziel.hasAttribute("open"))
                    zaehler.__bestaetigenOffen += 1;
            }
        }).observe(document, { attributes: true, attributeFilter: ["open"], subtree: true });
    });
    return () => page.evaluate(() => (globalThis as unknown as { __bestaetigenOffen: number }).__bestaetigenOffen);
}

/** Der Server lehnt jede Liste ab, bis der Passkey bestätigt ist (wie `checkAssurance` ohne zweiten Faktor). */
const ohneZweitenFaktor = (passkey: PasskeyStub) => (call: AdminCall) =>
    call.method === "GET" && passkey.verifiziert() === 0 ? SECOND_FACTOR : undefined;

async function verwaltungOeffnen(page: Page): Promise<void> {
    await page.goto("/edit");
    await page.getByTestId("kopfleiste-menue").click();
    await page.getByTestId("menue-kontenverwaltung").click();
    await expect(page.getByRole("dialog", { name: "Kontenverwaltung" })).toBeVisible();
}

/** Beide Listen des Öffnens stehen da: Personen und offene Einladungen in der Schiene, die Personentafel im Rumpf. */
async function allesGeladen(page: Page): Promise<void> {
    await expect(page.getByTestId("verwaltung-eintrag-personen")).toHaveText("Personen (7)");
    await expect(page.getByTestId("verwaltung-eintrag-einladungen")).toHaveText("Einladungen (2)");
    await expect(page.getByTestId("personen-tabelle")).toBeVisible();
}

const geholt = (calls: AdminCall[], path: string) =>
    calls.filter((call) => call.method === "GET" && call.path === path).length;

/** Das eigene Konto (`GET /api/account`), so knapp, wie das Fenster „Konto“ es zum Zeichnen braucht. */
async function kontoStub(page: Page): Promise<void> {
    await page.route("**/api/account", (route) =>
        json(route, 200, {
            person: {
                id: ME.id,
                displayName: ME.displayName,
                status: "active",
                revision: 1,
                role: "admin",
                access: "active",
                accessRevision: 1,
                methods: ["password", "passkey"],
                passwordDisabled: false,
                passkeyCount: 1,
                activeSessions: 1,
                grants: [],
                createdAt: new Date(Date.now() - 40 * DAY).toISOString(),
                lastLoginAt: new Date(Date.now() - 60_000).toISOString(),
                lastSeenAt: null,
                invitedBy: null,
                lockReason: null,
                lockedAt: null,
                lockedBy: null,
                self: true,
                manageable: false,
            },
            loginName: "rondrikan",
            discord: null,
            passkeys: [],
            sessions: [],
            specialCapabilities: [],
            legacy: [],
        }),
    );
}

test("🔴 zweiter Faktor von gestern: die Verwaltung öffnet ohne Rückfrage", async ({ page }) => {
    const fenster = await zaehleFenster(page);
    const calls = await stubAdmin(page, {
        person: { confirmedAt: new Date(Date.now() - 20 * 3_600_000).toISOString() },
    });
    await kontoStub(page);
    await verwaltungOeffnen(page);
    await allesGeladen(page);
    expect(await fenster()).toBe(0);
    for (const path of LESEWEGE) expect(geholt(calls, path), path).toBe(1);
    // Das Konto sagt dasselbe wie die Verwaltung: offen, solange die Sitzung besteht.
    await page.getByTestId("verwaltung-schliessen").click();
    await page.getByTestId("kopfleiste-menue").click();
    await page.getByTestId("menue-konto").click();
    await expect(page.getByTestId("konto-stufe")).toHaveText(
        "Mit zweitem Faktor; die Verwaltung ist offen, solange die Sitzung besteht",
    );
    await expect(page.getByTestId("konto-zweiter-faktor")).toHaveCount(0);
});

test("🔴 beide Listen gleichzeitig abgelehnt: genau ein „Kurz bestätigen“, Passkey, danach alle Listen geladen", async ({
    page,
}) => {
    const fenster = await zaehleFenster(page);
    const passkey = await passkeyBereit(page);
    const calls = await stubAdmin(page, {
        person: { passkeyCount: 1, methods: ["discord", "passkey"] },
        answer: ohneZweitenFaktor(passkey),
    });
    await verwaltungOeffnen(page);
    const bestaetigen = page.getByRole("dialog", { name: "Kurz bestätigen" });
    await expect(bestaetigen).toBeVisible();
    await expect(bestaetigen).toContainText("Dafür ist ein zweiter Faktor nötig: ein Passkey.");
    // Discord ist kein zweiter Faktor (Betreiber 2026-10-10: „4. B“), auch wenn das Konto mit Discord verknüpft ist.
    await expect(bestaetigen.getByTestId("bestaetigen-discord")).toHaveCount(0);
    // Beide Lesewege sind abgelehnt und warten auf DASSELBE Fenster.
    await expect.poll(() => LESEWEGE.map((path) => geholt(calls, path))).toEqual([1, 1]);
    expect(await fenster()).toBe(1);

    await bestaetigen.getByTestId("bestaetigen-passkey").click();
    await expect(bestaetigen).toBeHidden();
    await allesGeladen(page);
    expect(await fenster()).toBe(1);
    expect(passkey.optionen()).toBe(1);
    expect(passkey.verifiziert()).toBe(1);
    expect(await passkey.zeichen()).toBeGreaterThan(0);
    for (const path of LESEWEGE) expect(geholt(calls, path), path).toBe(2);
});

test("🔴 abgebrochen: jeder Bereich sagt, was fehlt; „Bestätigen“ fragt einmal für alle, danach ist alles geladen", async ({
    page,
}) => {
    const fenster = await zaehleFenster(page);
    const passkey = await passkeyBereit(page);
    const calls = await stubAdmin(page, {
        person: { passkeyCount: 1, methods: ["discord", "passkey"] },
        answer: ohneZweitenFaktor(passkey),
    });
    await verwaltungOeffnen(page);
    const bestaetigen = page.getByRole("dialog", { name: "Kurz bestätigen" });
    await expect.poll(() => LESEWEGE.map((path) => geholt(calls, path))).toEqual([1, 1]);
    await bestaetigen.getByTestId("bestaetigen-abbrechen").click();
    await expect(bestaetigen).toBeHidden();

    // Keine rote Meldung, sondern der Satz, was fehlt, mit dem Knopf dazu.
    const zeile = page.getByTestId("personen-ladeproblem");
    await expect(zeile).toContainText("Für die Verwaltung fehlt der zweite Faktor");
    await expect(zeile).not.toHaveAttribute("role", "alert");
    // Ein weiterer Bereich danach öffnet kein zweites Fenster, er sagt dasselbe.
    await page.getByTestId("verwaltung-eintrag-einladungen").click();
    await expect(page.getByTestId("einladungen-ladeproblem")).toContainText("fehlt der zweite Faktor");
    await page.getByTestId("verwaltung-eintrag-rollen").click();
    await expect(page.getByTestId("rollen-ladeproblem")).toContainText("fehlt der zweite Faktor");
    expect(await fenster()).toBe(1);

    await page.getByTestId("rollen-ladeproblem-bestaetigen").click();
    await expect(bestaetigen).toBeVisible();
    await bestaetigen.getByTestId("bestaetigen-passkey").click();
    await expect(bestaetigen).toBeHidden();
    await expect(page.getByTestId("rollen-sonderrechte")).toBeVisible();
    await page.getByTestId("verwaltung-eintrag-personen").click();
    await allesGeladen(page);
    expect(await fenster()).toBe(2);
    expect(passkey.verifiziert()).toBe(1);
});

test("🔴 ohne zweiten Faktor: Menü und Konto sagen, was fehlt; genau ein Fenster mit Passkey, danach „Kontenverwaltung …“", async ({
    page,
}) => {
    const fenster = await zaehleFenster(page);
    const passkey = await passkeyBereit(page);
    const calls = await stubAdmin(page, { answer: ohneZweitenFaktor(passkey) });
    await kontoStub(page);
    // Die Sitzung wie der Server sie meldet: ohne zweiten Faktor, bis der Passkey bestätigt ist (die jüngere Route gewinnt).
    await page.route("**/api/auth/session", (route) =>
        json(route, 200, {
            environment: "staging",
            authEnabled: true,
            person: {
                ...ME,
                methods: ["password", "passkey"],
                sessionMethod: "password",
                passkeyCount: 1,
                assurance: passkey.verifiziert() > 0 ? "strong" : "basic",
            },
            capabilities: ADMIN_CAPABILITIES,
        }),
    );
    await page.goto("/edit");
    await page.getByTestId("kopfleiste-menue").click();
    await expect(page.getByTestId("menue-kontenverwaltung")).toHaveCount(0);
    await expect(page.getByTestId("menue-systemsteuerung")).toHaveCount(0);
    const eintrag = page.getByTestId("menue-zweiter-faktor");
    await expect(eintrag).toContainText("Mit Passkey bestätigen …");
    await expect(eintrag).toContainText("Für die Verwaltung fehlt der zweite Faktor.");

    // Das Konto sagt dasselbe, mit dem Knopf daneben; er öffnet dasselbe eine Fenster.
    await page.getByTestId("menue-konto").click();
    await expect(page.getByTestId("konto-stufe")).toHaveText("Für die Verwaltung fehlt der zweite Faktor.");
    await page.getByTestId("konto-zweiter-faktor").click();
    const bestaetigen = page.getByRole("dialog", { name: "Kurz bestätigen" });
    await expect(bestaetigen).toBeVisible();
    await bestaetigen.getByTestId("bestaetigen-passkey").click();
    await expect(bestaetigen).toBeHidden();
    expect(await fenster()).toBe(1);
    // Ohne Neuladen: Die Sitzung ist neu gelesen, die Stufe stimmt, der Knopf ist fort.
    await expect(page.getByTestId("konto-stufe")).toHaveText(
        "Mit zweitem Faktor; die Verwaltung ist offen, solange die Sitzung besteht",
    );
    await expect(page.getByTestId("konto-zweiter-faktor")).toHaveCount(0);
    await page.getByRole("dialog", { name: "Konto" }).getByTestId("fenster-schliessen").click();

    // Das Menü bietet jetzt die Kontenverwaltung an; sie öffnet ohne weitere Rückfrage.
    await page.getByTestId("kopfleiste-menue").click();
    await page.getByTestId("menue-kontenverwaltung").click();
    await allesGeladen(page);
    expect(await fenster()).toBe(1);
    for (const path of LESEWEGE) expect(geholt(calls, path), path).toBe(1);
});

test("🔴 Anmeldung mit Passwort als Admin: im Anmeldefenster gleich „Mit Passkey bestätigen“, danach neu geladen mit Verwaltung", async ({
    page,
}) => {
    const passkey = await passkeyBereit(page);
    await stubAdmin(page, { answer: ohneZweitenFaktor(passkey) });
    let angemeldet = false;
    await page.route("**/api/auth/login", (route) => {
        angemeldet = true;
        return json(route, 200, { ok: true });
    });
    await page.route("**/api/auth/session", (route) =>
        json(route, 200, {
            environment: "staging",
            authEnabled: true,
            person: angemeldet
                ? {
                      ...ME,
                      methods: ["password", "passkey"],
                      sessionMethod: "password",
                      passkeyCount: 1,
                      assurance: passkey.verifiziert() > 0 ? "strong" : "basic",
                      expiresAt: new Date(Date.now() + 400 * DAY).toISOString(),
                  }
                : null,
            capabilities: angemeldet ? ADMIN_CAPABILITIES : [],
        }),
    );
    await page.goto("/edit");
    // Auf /edit ohne Anmeldung geht das Fenster von selbst auf (WI-0203; der Betreiber wählte 2026-10-16 „Ja, wie rechts“).
    const fenster = page.getByRole("dialog", { name: "Anmelden" });
    await expect(fenster).toBeVisible();
    await fenster.getByLabel("Benutzername:").fill("rondrikan");
    await fenster.getByLabel("Avesmaps-Passwort:").fill("Sternenstaub über Gareth");
    await fenster.getByTestId("anmelden-absenden").click();

    const schritt = page.getByTestId("anmelden-zweiter-faktor");
    await expect(schritt).toContainText("Angemeldet als Rondrikan.");
    await expect(schritt).toContainText("Für die Verwaltung fehlt noch der zweite Faktor.");
    const neu = page.waitForEvent("load");
    await schritt.getByTestId("anmelden-passkey").click();
    await neu;
    expect(passkey.verifiziert()).toBe(1);
    await page.getByTestId("kopfleiste-menue").click();
    await expect(page.getByTestId("menue-kontenverwaltung")).toBeVisible();
    await expect(page.getByTestId("menue-systemsteuerung")).toBeVisible();
    await expect(page.getByTestId("menue-zweiter-faktor")).toHaveCount(0);
});

/** Die Sitzung nach einer Rückkehr von Discord, wie der Server sie seit dem 2026-10-10 meldet: `basic`, bis der Passkey bestätigt. */
async function discordSitzung(page: Page, person: Partial<typeof ME>, stufe: () => "basic" | "strong"): Promise<void> {
    await page.route("**/api/auth/session", (route) =>
        json(route, 200, {
            environment: "staging",
            authEnabled: true,
            person: { ...ME, sessionMethod: "discord", ...person, assurance: stufe() },
            capabilities: ADMIN_CAPABILITIES,
        }),
    );
}

test("🔴 „4. B“: Rückkehr von Discord als Admin mit Discord-2FA: „Mit Passkey bestätigen“ / „Ohne Verwaltung weiter“, kein Discord-Knopf; danach mit Verwaltung", async ({
    page,
}) => {
    const passkey = await passkeyBereit(page);
    await stubAdmin(page, { answer: ohneZweitenFaktor(passkey) });
    await discordSitzung(page, { methods: ["discord", "passkey"], passkeyCount: 1 }, () =>
        passkey.verifiziert() > 0 ? "strong" : "basic",
    );
    // Discord kehrt ohne Sitzung über `/anmelden` zurück (WI-0120 R6); die Sitzung steht jetzt.
    await page.goto("/anmelden?anmeldung=ok");
    const schritt = page.getByRole("dialog", { name: "Anmelden" }).getByTestId("anmelden-zweiter-faktor");
    await expect(schritt).toContainText("Angemeldet als Rondrikan.");
    await expect(schritt).toContainText("Für die Verwaltung fehlt noch der zweite Faktor.");
    await expect(schritt.getByTestId("anmelden-ohne-verwaltung")).toHaveText("Ohne Verwaltung weiter");
    await expect(schritt.getByTestId("anmelden-discord-bestaetigen")).toHaveCount(0);
    await expect(schritt.getByTestId("anmelden-ohne-weg")).toHaveCount(0);

    const neu = page.waitForEvent("load");
    await schritt.getByTestId("anmelden-passkey").click();
    await neu;
    expect(passkey.verifiziert()).toBe(1);
    await page.getByTestId("kopfleiste-menue").click();
    await expect(page.getByTestId("menue-kontenverwaltung")).toBeVisible();
    await expect(page.getByTestId("menue-systemsteuerung")).toBeVisible();
    await expect(page.getByTestId("menue-zweiter-faktor")).toHaveCount(0);
});

test("🔴 „4. B“: Rückkehr von Discord als Admin ohne Passkey: der Schritt sagt den Weg zum ersten; ohne Verwaltung weiter, das Menü sagt, was fehlt", async ({
    page,
}) => {
    await stubAdmin(page, { answer: () => SECOND_FACTOR });
    await discordSitzung(page, { methods: ["discord"], passkeyCount: 0 }, () => "basic");
    await page.goto("/anmelden?anmeldung=ok");
    const schritt = page.getByRole("dialog", { name: "Anmelden" }).getByTestId("anmelden-zweiter-faktor");
    await expect(schritt.getByTestId("anmelden-ohne-weg")).toContainText(
        "Für dieses Konto gibt es hier keinen Passkey. Den ersten richtet ein Einrichtungslink ein",
    );
    await expect(schritt.getByTestId("anmelden-passkey")).toHaveCount(0);
    await expect(schritt.getByTestId("anmelden-discord-bestaetigen")).toHaveCount(0);
    await schritt.getByTestId("anmelden-ohne-verwaltung").click();
    await expect(page.getByRole("dialog", { name: "Anmelden" })).toBeHidden();

    // Angemeldet ohne Verwaltung: Das Menü sagt ruhig, was fehlt; „Kurz bestätigen“ bietet Discord nicht als Faktor an.
    await page.getByTestId("kopfleiste-menue").click();
    await expect(page.getByTestId("menue-kontenverwaltung")).toHaveCount(0);
    await expect(page.getByTestId("menue-systemsteuerung")).toHaveCount(0);
    const eintrag = page.getByTestId("menue-zweiter-faktor");
    await expect(eintrag).toContainText("Mit Passkey bestätigen …");
    await expect(eintrag).toContainText("Für die Verwaltung fehlt der zweite Faktor.");
    await eintrag.click();
    const bestaetigen = page.getByRole("dialog", { name: "Kurz bestätigen" });
    await expect(bestaetigen).toContainText("Dafür ist ein zweiter Faktor nötig: ein Passkey.");
    await expect(bestaetigen.getByTestId("bestaetigen-ohne-weg")).toBeVisible();
    await expect(bestaetigen.getByTestId("bestaetigen-discord")).toHaveCount(0);
    await expect(bestaetigen.getByTestId("bestaetigen-passkey")).toHaveCount(0);
});
