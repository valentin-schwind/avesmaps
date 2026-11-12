import { expect, test, type Page } from "@playwright/test";
import { systemOverview, systemServer, type SystemServer } from "./betriebszustand-stub.ts";
import { passkeyBereit } from "./passkey-stub.ts";
import { ADMIN_CAPABILITIES, ME, stubAdmin, type AdminCall } from "./verwaltung-stub.ts";

/**
 * Der Eintrag „Betriebszustand“ im Fenster „Verwaltung …“ am Rechner (WI-0127 SYS-5; SYS-0001 §6.2, §6.8, §7.1 Zeile SYS-5; Blatt
 * WI-0119 Fassung 2, A1, Z1, Z2, Z6).
 *
 * Problemfälle: Umschalten mit Passkey (virtueller Authenticator in Chromium, der Server verlangt den frischen Nachweis), der Passkey
 * abgebrochen, der Server lehnt mit Fachcode ab (Selbstaussperrung, kein Inhaber mit Passkey, Zustand unbekannt, Konflikt), die
 * Instanz zieht nach und weicht ab, der Server weiß seinen Zustand nicht, ohne Recht zum Umschalten. Soll: ein Druck schaltet nie
 * sofort, die Bestätigung steht an der Stelle, der Grund ist Pflicht, die Kennung bleibt bei der Wiederholung, „unbekannt“ steht nie
 * als Normal da.
 *
 * 🪤 **Warum ein Nachbau statt einer echten Sitzung:** Agenten schreiben nie in `avesmaps3d_dev` (EDIT-0001 W15), und ein echtes
 * Einschränken auf dem gemeinsamen Stapel sperrte jede andere Sitzung aus `/ws` aus (SYS-4). Eine echte Sitzung mit Passkey gibt es
 * im Bestand der Browsertests nicht; die Route selbst prüft `apps/server/test/system-state.test.ts` mit echten Sitzungen gegen
 * PostgreSQL. Der Nachbau (`betriebszustand-stub.ts`) prüft jede Antwort gegen den Vertrag aus `packages/shared`. Gegen die echte
 * Route des lokalen Stapels läuft der Rechtefall „ohne Anmeldung“ (letzter Fall).
 */

const OPERATOR_CAPABILITIES = [...ADMIN_CAPABILITIES, "manage_system_settings", "access_restricted_mode"];

const envelope = (code: string, details?: Record<string, unknown>) => ({
    error: { code, message: "vom Nachbau", details },
});

async function oeffnen(page: Page, options: Parameters<typeof stubAdmin>[1] = {}) {
    const calls = await stubAdmin(page, { capabilities: OPERATOR_CAPABILITIES, role: "operator", ...options });
    await page.goto("/edit");
    await page.getByTestId("kopfleiste-menue").click();
    await page.getByTestId("menue-systemsteuerung").click();
    const fenster = page.getByRole("dialog", { name: "Systemsteuerung" });
    await expect(fenster).toBeVisible();
    // „Betrieb“ ist die erste Gruppe der Systemsteuerung und offen (Betreiber 2026-10-17).
    await page.getByTestId("verwaltung-eintrag-betrieb").click();
    await expect(page.getByTestId("verwaltung-eintrag-betrieb")).toHaveAttribute("aria-current", "page");
    return { calls, fenster };
}

const posts = (calls: AdminCall[], path: string) =>
    calls.filter((call) => call.method === "POST" && call.path === path).map((call) => call.body);

/** Stufe S wie der Server: ohne frischen Passkey verlangt jede Umschaltung ihn (403 `reauth_required`, `need: passkey`). */
function passkeyVerlangt(verifiziert: () => number) {
    return (call: AdminCall) =>
        call.method === "POST" && call.path.startsWith("/api/admin/system/") && verifiziert() === 0
            ? { status: 403, body: envelope("reauth_required", { need: "passkey" }) }
            : undefined;
}

/** Die Farbe eines Kanonwerts, so wie der Browser sie rechnet. */
async function farbe(page: Page, variable: string): Promise<string> {
    return page.evaluate((name) => {
        const probe = document.createElement("div");
        probe.style.background = `var(${name})`;
        document.body.append(probe);
        const value = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return value;
    }, variable);
}

test("🔴 in Ruhe: Kurzstatus, Hauptschalter mit gesperrter Wartung und Satz, eingestellt gleich wirksam, zwei Sperren, Rückweg", async ({
    page,
}) => {
    const { fenster } = await oeffnen(page);
    const betrieb = page.getByTestId("betrieb");
    await expect(page.getByTestId("verwaltung-eintrag-betrieb")).toHaveText("BetriebszustandNormal");

    // Betrieb im Moment: vier Punkte, Release, Stand, Statusseite in neuem Tab.
    const kurz = page.getByTestId("betrieb-kurzstatus");
    await expect(kurz.getByRole("heading")).toHaveText("Betrieb im Moment");
    await expect(page.getByTestId("betrieb-status-karte")).toHaveText("Karte erreichbar");
    await expect(page.getByTestId("betrieb-status-anmeldung")).toHaveText("Anmeldung bereit");
    await expect(page.getByTestId("betrieb-status-routen")).toHaveText("Routenrechner bereit");
    await expect(page.getByTestId("betrieb-status-warteschlange")).toHaveText("Warteschlange: 1 läuft, 0 warten");
    await expect(page.getByTestId("betrieb-stand")).toContainText(/Release 028ec13, seit (heute|gestern), \d\d:\d\d/u);
    await expect(page.getByTestId("betrieb-stand")).toContainText(/Stand vor \d+ s/u);
    // Im Fenster ein Knopf: er schaltet auf die Warteschlange im selben Fenster (Betreiber 2026-10-11; Name seit `abcecce8`).
    await expect(page.getByTestId("betrieb-statusseite")).toHaveText("Warteschlange öffnen");
    expect(await page.getByTestId("betrieb-statusseite").evaluate((element) => element.tagName)).toBe("BUTTON");

    // Hauptschalter: Normal gewählt, Wartung gesperrt mit dem Satz daneben, nie wählbar.
    const schalter = page.getByTestId("betrieb-schalter");
    await expect(schalter.getByRole("button")).toHaveText(["Normal", "Eingeschränkt", "Wartung"]);
    await expect(page.getByTestId("betrieb-schalter-normal")).toHaveAttribute("aria-pressed", "true");
    const wartung = page.getByTestId("betrieb-schalter-maintenance");
    await expect(wartung).toBeDisabled();
    await expect(wartung).toHaveAttribute("aria-pressed", "false");
    const satzId = await wartung.getAttribute("aria-describedby");
    await expect(page.locator(`[id="${satzId}"]`)).toHaveText("„Wartung“ wird auf dem Server geschaltet.");
    await expect(page.getByTestId("betrieb-schalter-restricted")).toBeEnabled();

    // Eingestellt gegen wirksam: gleich.
    await expect(page.getByTestId("betrieb-wirkung")).toHaveAttribute("data-wirkung", "gleich");
    await expect(page.getByTestId("betrieb-eingestellt")).toContainText(
        /^Normalseit (heute|gestern), \d\d:\d\d · Rondrikan$/u,
    );
    await expect(page.getByTestId("betrieb-wirksam")).toContainText(/^Normalam Server gemessen vor \d+ s$/u);
    await expect(page.getByTestId("betrieb-bedeutung")).toContainText("„Eingeschränkter Betrieb“ kommen hinein");

    // Die Sperren mit „Sperrt“ und „Offen bleibt“, beide offen.
    for (const lock of ["map", "system"] as const) {
        const karte = page.getByTestId(`betrieb-sperre-${lock}`);
        await expect(karte).toContainText("Sperrt");
        await expect(karte).toContainText("Offen bleibt");
        await expect(page.getByTestId(`betrieb-sperre-${lock}-schalter-offen`)).toHaveAttribute("aria-pressed", "true");
    }
    await expect(page.getByTestId("betrieb-sperre-map")).toContainText("jede Änderung an Kartendaten und Inhalten");
    await expect(page.getByTestId("betrieb-sperre-system")).toContainText("die Sicherheitshandgriffe");

    // Rückweg mit dem Werkzeug der Umgebung (Stage: `avesmaps3d-auth staging`).
    await expect(page.getByTestId("betrieb-rueckweg")).toHaveText(
        "Rückweg ohne Verwaltung: auf dem Server avesmaps3d-auth staging betrieb-normal und avesmaps3d-auth staging sperre-loesen. Beides steht im Protokoll.",
    );
    await expect(page.getByTestId("betrieb-rueckweg").locator("code")).toHaveCount(2);
    await expect(fenster.locator(".avm-fenster__fuss-hinweis")).toHaveText(
        "Umschalten fragt einmal nach dem Passkey, danach nicht wieder. Gilt nur für diese Umgebung.",
    );
    await expect(betrieb).toBeVisible();
});

test("🔴 Einschränken: Bestätigung an der Stelle, Grund Pflicht, Passkey im Moment, dieselbe Kennung; danach wirksam", async ({
    page,
}) => {
    const passkey = await passkeyBereit(page);
    const { calls } = await oeffnen(page, {
        person: { passkeyCount: 1 },
        answer: passkeyVerlangt(passkey.verifiziert),
    });

    await page.getByTestId("betrieb-schalter-restricted").click();
    const frage = page.getByTestId("betrieb-frage-mode");
    await expect(frage).toBeVisible();
    // Ein Druck schaltet nicht: gewählt bleibt Normal, bis der Server es bestätigt.
    await expect(page.getByTestId("betrieb-schalter-normal")).toHaveAttribute("aria-pressed", "true");
    await expect(frage).toContainText("Betrieb einschränken?");
    await expect(frage).toContainText("Hinein kommen nur noch Hesindiane und Rondrikan (beide mit Passkey).");
    await expect(frage).toContainText("Gilt nur für diese Umgebung.");
    await expect(frage).toContainText("Grund, steht im Protokoll");
    const grund = page.getByTestId("betrieb-frage-mode-grund").getByRole("textbox");
    await expect(grund).toBeFocused();
    const einschraenken = frage.getByRole("button", { name: "Einschränken" });
    await expect(einschraenken).toBeDisabled();
    await expect(frage).toContainText("Der Grund fehlt.");
    expect(posts(calls, "/api/admin/system/mode")).toEqual([]);

    await grund.fill("Wiederherstellung prüfen");
    await expect(einschraenken).toBeEnabled();
    await einschraenken.click();

    // Der Server verlangt den frischen Passkey: „Kurz bestätigen“, dann fragt der Browser (virtueller Authenticator).
    const bestaetigen = page.getByRole("dialog", { name: "Kurz bestätigen" });
    await expect(bestaetigen).toBeVisible();
    await bestaetigen.getByTestId("bestaetigen-passkey").click();
    await expect(bestaetigen).toBeHidden();

    await expect(page.getByTestId("betrieb-wirksam")).toContainText("Eingeschränkt");
    await expect(page.getByTestId("betrieb-wirkung")).toHaveAttribute("data-wirkung", "gleich");
    await expect(page.getByTestId("betrieb-schalter-restricted")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("betrieb-eingestellt")).toContainText("Rondrikan · „Wiederherstellung prüfen“");
    await expect(page.getByTestId("verwaltung-eintrag-betrieb")).toHaveText("BetriebszustandEingeschränkt");
    await expect(frage).toBeHidden();
    expect(passkey.verifiziert()).toBe(1);
    expect(await passkey.zeichen()).toBeGreaterThan(0);

    const gesendet = posts(calls, "/api/admin/system/mode");
    expect(gesendet).toHaveLength(2);
    expect(gesendet[0]).toEqual({
        operationId: expect.any(String),
        baseRevision: 7,
        mode: "restricted",
        reason: "Wiederherstellung prüfen",
    });
    expect(gesendet[1]).toEqual(gesendet[0]);

    // Zurück auf Normal: dieselbe Bestätigung ohne Grundpflicht; der Passkey ist frisch, der Browser fragt nicht wieder.
    await page.getByTestId("betrieb-schalter-normal").click();
    const zurueck = page.getByTestId("betrieb-frage-mode");
    await expect(zurueck).toContainText("Zurück auf Normal schalten?");
    await expect(zurueck).toContainText("Grund, freiwillig, steht im Protokoll");
    await expect(zurueck.getByRole("button", { name: "Abbrechen" })).toBeFocused();
    await zurueck.getByRole("button", { name: "Zurückschalten" }).click();
    await expect(page.getByTestId("betrieb-schalter-normal")).toHaveAttribute("aria-pressed", "true");
    expect(posts(calls, "/api/admin/system/mode").at(-1)).toEqual({
        operationId: expect.any(String),
        baseRevision: 8,
        mode: "normal",
    });
    expect(passkey.verifiziert()).toBe(1);
});

test("🔴 Passkey abgebrochen: nichts geschaltet, ein Satz sagt es, die Frage bleibt mit dem Grund offen", async ({
    page,
}) => {
    const { calls } = await oeffnen(page, {
        person: { passkeyCount: 1 },
        answer: passkeyVerlangt(() => 0),
    });
    await page.getByTestId("betrieb-schalter-restricted").click();
    const grund = page.getByTestId("betrieb-frage-mode-grund").getByRole("textbox");
    await grund.fill("Abnahme");
    await grund.press("Enter");
    const bestaetigen = page.getByRole("dialog", { name: "Kurz bestätigen" });
    await expect(bestaetigen).toBeVisible();
    await bestaetigen.getByTestId("bestaetigen-abbrechen").click();
    await expect(page.getByTestId("betrieb-meldung-mode")).toHaveText(
        "Ohne Bestätigung mit dem Passkey bleibt alles, wie es war.",
    );
    await expect(grund).toHaveValue("Abnahme");
    await expect(page.getByTestId("betrieb-schalter-normal")).toHaveAttribute("aria-pressed", "true");
    expect(posts(calls, "/api/admin/system/mode")).toHaveLength(1);
});

test("🔴 Fachcodes verständlich: Selbstaussperrung, kein Inhaber mit Passkey, Zustand unbekannt, Konflikt", async ({
    page,
}) => {
    const antworten: Record<string, unknown> = {
        would_lock_out_self: envelope("would_lock_out_self"),
        no_restricted_access_holder: envelope("no_restricted_access_holder"),
        system_state_unknown: envelope("system_state_unknown"),
        edit_conflict: envelope("edit_conflict", {
            changedBy: { id: "2c4e6a80-1b3d-4f5a-8c7e-9d0b1a2c3d4e", displayName: "Hesindiane" },
            changedAt: new Date(Date.now() - 60_000).toISOString(),
        }),
    };
    let naechste: string | null = null;
    await oeffnen(page, {
        answer: (call) => {
            if (call.method !== "POST" || naechste === null) return undefined;
            const code = naechste;
            naechste = null;
            const status = code === "system_state_unknown" ? 503 : 409;
            return { status, body: antworten[code] };
        },
    });
    const saetze: [string, string][] = [
        [
            "would_lock_out_self",
            "Wer den Betrieb einschränkt, muss selbst hineinkommen; dafür fehlt hier das Einzelrecht „Eingeschränkter Betrieb“.",
        ],
        [
            "no_restricted_access_holder",
            "Niemand mit dem Zugangsrecht hat in dieser Umgebung einen Passkey; im eingeschränkten Betrieb käme niemand hinein.",
        ],
        [
            "system_state_unknown",
            "Der Server kennt seinen Betriebszustand gerade nicht; geschaltet wird nichts. Meist geht es nach wenigen Sekunden wieder.",
        ],
    ];
    for (const [code, satz] of saetze) {
        naechste = code;
        await page.getByTestId("betrieb-schalter-restricted").click();
        await page.getByTestId("betrieb-frage-mode-grund").getByRole("textbox").fill("Abnahme");
        await page.getByTestId("betrieb-frage-mode").getByRole("button", { name: "Einschränken" }).click();
        await expect(page.getByTestId("betrieb-meldung-mode"), code).toHaveText(satz);
        // Die Frage bleibt offen: Abbrechen schließt sie, der Schalter steht weiter auf Normal.
        await page.getByTestId("betrieb-frage-mode").getByRole("button", { name: "Abbrechen" }).click();
        await expect(page.getByTestId("betrieb-schalter-normal")).toHaveAttribute("aria-pressed", "true");
    }

    // Konflikt an einer Sperre: Wer und Wann, die Frage schließt sich.
    naechste = "edit_conflict";
    await page.getByTestId("betrieb-sperre-map-schalter-gesperrt").click();
    await page.getByTestId("betrieb-frage-map-grund").getByRole("textbox").fill("Datenübernahme prüfen");
    await page.getByTestId("betrieb-frage-map").getByRole("button", { name: "Sperren" }).click();
    await expect(page.getByTestId("betrieb-meldung-map")).toContainText("Hesindiane hat das gerade geändert");
    await expect(page.getByTestId("betrieb-frage-map")).toBeHidden();
});

test("🔴 Schutzregel schon an der Frage: wer selbst nicht hineinkäme, kann nicht einschränken", async ({ page }) => {
    const system = systemServer(
        ME,
        systemOverview(ME, (overview) => {
            overview.restrictedAccessHolders = overview.restrictedAccessHolders.filter(
                (holder) => holder.person.id !== ME.id,
            );
        }),
    );
    const { calls } = await oeffnen(page, { system });
    await page.getByTestId("betrieb-schalter-restricted").click();
    const frage = page.getByTestId("betrieb-frage-mode");
    await page.getByTestId("betrieb-frage-mode-grund").getByRole("textbox").fill("Abnahme");
    await expect(frage.getByRole("button", { name: "Einschränken" })).toBeDisabled();
    await expect(frage).toContainText("Wer den Betrieb einschränkt, muss selbst hineinkommen");
    await expect(frage).toContainText("Hinein kommen nur noch Hesindiane (mit Passkey).");
    expect(posts(calls, "/api/admin/system/mode")).toEqual([]);
});

test("🔴 Kartensperre: setzen mit Grund, „seit … · wer · Grund“, lösen ohne Pflicht", async ({ page }) => {
    const { calls } = await oeffnen(page);
    await page.getByTestId("betrieb-sperre-map-schalter-gesperrt").click();
    const frage = page.getByTestId("betrieb-frage-map");
    await expect(frage).toContainText("Kartensperre setzen?");
    await expect(frage).toContainText("Importe laufen weiter");
    await expect(frage.getByRole("button", { name: "Sperren" })).toBeDisabled();
    await page.getByTestId("betrieb-frage-map-grund").getByRole("textbox").fill("Datenübernahme prüfen");
    await frage.getByRole("button", { name: "Sperren" }).click();
    const karte = page.getByTestId("betrieb-sperre-map");
    await expect(page.getByTestId("betrieb-sperre-map-schalter-gesperrt")).toHaveAttribute("aria-pressed", "true");
    await expect(karte.getByTestId("betrieb-sperre-seit")).toHaveText(
        /^Gesperrt seit heute, \d\d:\d\d · Rondrikan · „Datenübernahme prüfen“$/u,
    );
    // Die Systemsperre bleibt unberührt.
    await expect(page.getByTestId("betrieb-sperre-system-schalter-offen")).toHaveAttribute("aria-pressed", "true");

    await page.getByTestId("betrieb-sperre-map-schalter-offen").click();
    await expect(page.getByTestId("betrieb-frage-map")).toContainText("Kartensperre lösen?");
    await page.getByTestId("betrieb-frage-map").getByRole("button", { name: "Lösen" }).click();
    await expect(page.getByTestId("betrieb-sperre-map-schalter-offen")).toHaveAttribute("aria-pressed", "true");
    expect(posts(calls, "/api/admin/system/lock")).toEqual([
        {
            operationId: expect.any(String),
            baseRevision: 7,
            lock: "map",
            locked: true,
            reason: "Datenübernahme prüfen",
        },
        { operationId: expect.any(String), baseRevision: 8, lock: "map", locked: false },
    ]);
});

test("🔴 eingestellt gegen wirksam: der Server zieht nach und übernimmt; weicht er ab, steht es rot da", async ({
    page,
}) => {
    const umgeschaltet = (vorMs: number) =>
        systemOverview(ME, (overview) => {
            const since = new Date(Date.now() - vorMs).toISOString();
            const by = { id: ME.id, displayName: ME.displayName };
            overview.configured!.mode = { mode: "restricted", since, by, byLabel: null, reason: "Abnahme" };
            overview.configured!.revision = 8;
            overview.configured!.updatedAt = since;
        });
    const system: SystemServer = systemServer(ME, umgeschaltet(1_000));
    await oeffnen(page, { system });
    await expect(page.getByTestId("betrieb-wirkung")).toHaveAttribute("data-wirkung", "zieht_nach");
    await expect(page.getByTestId("betrieb-wirksam")).toContainText(/^noch Normalwartet auf den Server, seit \d+ s$/u);
    // Gewählt ist, was eingestellt ist.
    await expect(page.getByTestId("betrieb-schalter-restricted")).toHaveAttribute("aria-pressed", "true");

    // Die Instanz übernimmt; der Eintrag sieht von selbst nach (kein Kanal zum Browser).
    const uebernommen = structuredClone(system.state);
    uebernommen.effective = { ...uebernommen.effective, mode: "restricted", revision: 8 };
    system.state = uebernommen;
    await expect(page.getByTestId("betrieb-wirkung")).toHaveAttribute("data-wirkung", "gleich", { timeout: 6_000 });
    await expect(page.getByTestId("betrieb-wirksam")).toContainText("Eingeschränktam Server gemessen vor");

    // Eine Instanz, die nach zwei Minuten noch die alte Revision hält, weicht ab.
    system.state = umgeschaltet(120_000);
    await page.getByTestId("verwaltung-eintrag-backup").click();
    await page.getByTestId("verwaltung-eintrag-betrieb").click();
    await expect(page.getByTestId("betrieb-wirkung")).toHaveAttribute("data-wirkung", "weicht_ab");
    await expect(page.getByTestId("betrieb-wirksam")).toContainText(
        /^Normalweicht seit 2 Min\. ab; Rückweg und Prüfung über Claudio$/u,
    );
    const punkt = page.getByTestId("betrieb-wirksam").locator(".status__punkt");
    expect(await punkt.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
        await farbe(page, "--color-danger"),
    );
});

test("🔴 unbekannt ist nie Normal: kein Segment gewählt, alles gesperrt mit Satz, die Schiene sagt „unbekannt“", async ({
    page,
}) => {
    const system = systemServer(
        ME,
        systemOverview(ME, (overview) => {
            overview.effective = {
                source: "unknown",
                mode: null,
                mapLock: null,
                systemLock: null,
                revision: null,
                contentRevision: null,
                readAt: new Date(Date.now() - 45_000).toISOString(),
                ready: false,
            };
            overview.brief.map = "failed";
            overview.brief.login = "failed";
            overview.brief.queue = null;
        }),
    );
    await oeffnen(page, { system });
    await expect(page.getByTestId("verwaltung-eintrag-betrieb")).toHaveText("Betriebszustandunbekannt");
    await expect(page.getByTestId("betrieb-wirkung")).toHaveAttribute("data-wirkung", "unbekannt");
    await expect(page.getByTestId("betrieb-wirksam")).toHaveText(
        "unbekanntder Server weiß seinen Zustand gerade nicht; geschaltet wird nichts",
    );
    await expect(page.getByTestId("betrieb-wirksam")).not.toContainText("Normal");
    for (const value of ["normal", "restricted", "maintenance"]) {
        await expect(page.getByTestId(`betrieb-schalter-${value}`)).toHaveAttribute("aria-pressed", "false");
        await expect(page.getByTestId(`betrieb-schalter-${value}`)).toBeDisabled();
    }
    for (const lock of ["map", "system"]) {
        await expect(page.getByTestId(`betrieb-sperre-${lock}-schalter-offen`)).toHaveAttribute(
            "aria-pressed",
            "false",
        );
        await expect(page.getByTestId(`betrieb-sperre-${lock}-schalter-offen`)).toBeDisabled();
    }
    await expect(page.getByTestId("betrieb-sperrsatz")).toHaveText(
        "Solange der Server seinen Zustand nicht kennt, schaltet hier nichts.",
    );
    await expect(page.getByTestId("betrieb-status-karte")).toHaveText("Karte gestört");
    await expect(page.getByTestId("betrieb-status-warteschlange")).toHaveText("Warteschlange unbekannt");
});

test("🔴 Rechte: ohne `manage_system_settings` nur lesen, ohne `view_operations` kein Eintrag", async ({ page }) => {
    const { calls } = await oeffnen(page, { capabilities: ADMIN_CAPABILITIES, role: "admin" });
    for (const value of ["normal", "restricted"]) {
        await expect(page.getByTestId(`betrieb-schalter-${value}`)).toBeDisabled();
    }
    await expect(page.getByTestId("betrieb-schalter-normal")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("betrieb-sperrsatz")).toHaveText("Umschalten braucht das Recht „Systemschalter“.");
    const satzId = await page.getByTestId("betrieb-schalter-restricted").getAttribute("aria-describedby");
    await expect(page.locator(`[id="${satzId}"]`)).toHaveText("Umschalten braucht das Recht „Systemschalter“.");
    await expect(page.getByTestId("betrieb-sperre-map-schalter-gesperrt")).toBeDisabled();
    // Lesen geht: eingestellt, wirksam, Kurzstatus.
    await expect(page.getByTestId("betrieb-wirkung")).toHaveAttribute("data-wirkung", "gleich");
    expect(calls.filter((call) => call.method === "POST")).toEqual([]);

    // Umschalten ohne Sehen öffnet nichts: keine Systemsteuerung, nur die Kontenverwaltung (die jüngere Route der Sitzung gewinnt).
    await stubAdmin(page, { capabilities: ["manage_people", "manage_system_settings"] });
    await page.goto("/edit");
    await page.getByTestId("kopfleiste-menue").click();
    await expect(page.getByTestId("menue-systemsteuerung")).toHaveCount(0);
    await page.getByTestId("menue-kontenverwaltung").click();
    await expect(page.getByRole("dialog", { name: "Kontenverwaltung" })).toBeVisible();
    await expect(page.getByTestId("verwaltung-bereich-betrieb")).toHaveCount(0);
    await expect(page.getByTestId("verwaltung-eintrag-betrieb")).toHaveCount(0);
});

test("🔴 Zustände des Schalters (§30.5): Zeigen färbt die Fläche, gedrückt die Aktiv-Lasur, Fokusring, gesperrt eigene Fassung; Tastatur", async ({
    page,
}) => {
    await oeffnen(page);
    const eingeschraenkt = page.getByTestId("betrieb-schalter-restricted");
    const ruhe = await eingeschraenkt.evaluate((element) => getComputedStyle(element).backgroundColor);
    await eingeschraenkt.hover();
    await expect
        .poll(() => eingeschraenkt.evaluate((element) => getComputedStyle(element).backgroundColor))
        .toBe(await farbe(page, "--color-hover-wash"));
    expect(ruhe).not.toBe(await farbe(page, "--color-hover-wash"));
    expect(await eingeschraenkt.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");

    const wartung = page.getByTestId("betrieb-schalter-maintenance");
    expect(await wartung.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
        await farbe(page, "--color-disabled-bg"),
    );
    expect(await wartung.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
    await wartung.hover({ force: true });
    expect(await wartung.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
        await farbe(page, "--color-disabled-bg"),
    );

    // Gedrückt: die Aktiv-Lasur, solange die Taste unten ist.
    await eingeschraenkt.hover();
    await page.mouse.down();
    await expect
        .poll(() => eingeschraenkt.evaluate((element) => getComputedStyle(element).backgroundColor))
        .toBe(await farbe(page, "--color-active-wash"));
    await page.mouse.move(0, 0);
    await page.mouse.up();

    // Tastatur: Tab erreicht das Segment, der Fokusring steht, Enter öffnet die Frage, Escape schließt nur sie.
    await page.getByTestId("betrieb-schalter-normal").focus();
    await page.keyboard.press("Tab");
    await expect(eingeschraenkt).toBeFocused();
    expect(await eingeschraenkt.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe("none");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("betrieb-frage-mode")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("betrieb-frage-mode")).toBeHidden();
    await expect(page.getByRole("dialog", { name: "Systemsteuerung" })).toBeVisible();
});

test("🔴 echte Route des lokalen Stapels: ohne Anmeldung lehnt der Server ab, und der Eintrag sagt es, statt etwas zu zeigen", async ({
    page,
}) => {
    await oeffnen(page, { system: "echt" });
    await expect(page.getByTestId("betrieb-ladefehler")).toContainText("Der Betriebszustand ließ sich nicht laden.");
    await expect(page.getByTestId("betrieb-ladefehler")).toContainText("Die Anmeldung ist abgelaufen.");
    await expect(page.getByTestId("betrieb-schalter")).toHaveCount(0);
    await expect(page.getByTestId("verwaltung-eintrag-betrieb")).toHaveText("Betriebszustand");
});
