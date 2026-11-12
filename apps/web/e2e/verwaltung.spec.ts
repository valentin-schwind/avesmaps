import { expect, test, type Page } from "@playwright/test";
import { ADMIN_CAPABILITIES, MITTAG, stubAdmin, type AdminCall } from "./verwaltung-stub.ts";

/**
 * Die Fenster „Kontenverwaltung …“ und „Systemsteuerung …“ (WI-0120 A10; Mockup `review/admin-mockup/` 02–06, AUTH-0001 §12.4; seit
 * WI-0127 SYS-1 mit Schiene, Blatt WI-0119 Fassung 2; geteilt in SYS-15, SYS-0001 §9d). Sitzung und Verwaltungs-API kommen aus
 * `verwaltung-stub.ts`; geprüft wird, was die Fenster zeigen und schicken: Einträge nur mit Recht, Rückfrage mit Grund,
 * Konfliktmeldung, die verlangte Bestätigung, der Link nur beim Erzeugen, die Schiene samt Tastatur, ein Protokoll mit zwei Filtern,
 * der tiefe Link.
 */
const TITEL = { kontenverwaltung: "Kontenverwaltung", systemsteuerung: "Systemsteuerung" } as const;

async function oeffnen(
    page: Page,
    options: Parameters<typeof stubAdmin>[1] = {},
    welches: keyof typeof TITEL = "kontenverwaltung",
) {
    const calls = await stubAdmin(page, options);
    await page.goto("/edit");
    await page.getByTestId("kopfleiste-menue").click();
    await page.getByTestId(`menue-${welches}`).click();
    const fenster = page.getByRole("dialog", { name: TITEL[welches] });
    await expect(fenster).toBeVisible();
    return { calls, fenster };
}

const posts = (calls: AdminCall[], path: string) =>
    calls.filter((call) => call.method === "POST" && call.path === path).map((call) => call.body);

/** Die Einträge eines Bereichs der Schiene, wie sie dastehen. */
const eintraege = (page: Page, bereich: string) =>
    page.getByTestId(`verwaltung-bereich-${bereich}`).locator('[data-testid^="verwaltung-eintrag-"]');

test("🔴 jeder Eintrag nur mit seinem Recht; im Zusatz steht die Umgebung", async ({ page }) => {
    const { fenster } = await oeffnen(page, { capabilities: ["manage_people", "read_audit", "use_editor_menu"] });
    await expect(fenster.getByTestId(/^verwaltung-bereich-[a-z]+$/u)).toHaveCount(1);
    await expect(eintraege(page, "personen")).toHaveText(["Personen (7)", "Protokoll"]);
    await expect(fenster.locator(".avm-fenster__zusatz")).toHaveText("Stage (Testwelt)");
    await page.getByTestId("verwaltung-eintrag-protokoll").click();
    await expect(page.getByTestId("protokoll-tafel")).toBeVisible();
    await expect(page.getByTestId("protokoll-eintrag").first()).toContainText("Einladung erzeugt");
});

test("🔴 Kontenverwaltung: ein Bereich „Personen & Sicherheit“ mit fünf Einträgen, nichts vom System (SYS-15)", async ({
    page,
}) => {
    const { fenster } = await oeffnen(page);
    const schiene = fenster.getByRole("navigation", { name: "Bereiche der Verwaltung" });
    await expect(schiene).toBeVisible();
    await expect(fenster.getByTestId(/^verwaltung-bereich-[a-z]+$/u)).toHaveCount(1);
    await expect(eintraege(page, "personen")).toHaveText([
        "Personen (7)",
        "Einladungen (2)",
        "Rollen & Rechte",
        "Sonderrollen (1)",
        "Protokoll",
    ]);
    await expect(page.getByTestId("verwaltung-eintrag-personen")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("verwaltung-bereich-betrieb")).toHaveCount(0);
    // Die festen Köpfe gelten nur der Systemsteuerung (Betreiber 2026-10-17): Die Kontenverwaltung bleibt ohne Köpfe.
    await expect(fenster.getByTestId(/^verwaltung-bereich-kopf-/u)).toHaveCount(0);
    await expect(fenster.getByTestId("kontenverwaltung-fenster")).toHaveCount(0);
    await expect(page.getByTestId("kontenverwaltung-fenster")).toBeVisible();
});

test("🔴 Systemsteuerung: vier feste Gruppen in Versalien, Warteschlange im Fenster, kein Kanal für Admins, das Protokoll des Systems", async ({
    page,
}) => {
    const { fenster } = await oeffnen(page, {}, "systemsteuerung");
    await expect(page.getByTestId("systemsteuerung-fenster")).toBeVisible();
    // Vier Gruppen (Betreiber 2026-10-17, WI-0127 §23), keine Gruppe der Kontenverwaltung.
    await expect(fenster.getByTestId(/^verwaltung-bereich-[a-z]+$/u)).toHaveCount(4);
    await expect(page.getByTestId("verwaltung-bereich-personen")).toHaveCount(0);
    // Die Köpfe sind Zwischenüberschriften: nicht anklickbar, nicht einklappbar, ohne Winkel; die Tafel schreibt die Namen normal,
    // die Versalien macht der Rahmen.
    const koepfe = fenster.getByTestId(/^verwaltung-bereich-kopf-/u);
    await expect(koepfe).toHaveText([
        "Betrieb",
        "Auslieferung & Daten",
        "Karte & Einstellungen",
        "Redaktion & Zusammenarbeit",
    ]);
    for (const kopf of await koepfe.all()) {
        expect(await kopf.evaluate((element) => element.tagName)).toBe("P");
        expect(await kopf.evaluate((element) => getComputedStyle(element).textTransform)).toBe("uppercase");
        await expect(kopf).not.toHaveAttribute("aria-expanded");
        await expect(kopf.locator("svg")).toHaveCount(0);
    }
    await expect(page.getByTestId("verwaltung-eintrag-betrieb")).toHaveAttribute("aria-current", "page");
    // Der Betriebszustand (SYS-5) trägt seinen Stand rechts in der Schiene, wie im Blatt.
    await expect(eintraege(page, "betrieb")).toHaveText([
        "BetriebszustandNormal",
        "Systemzustand",
        "Warteschlange",
        "Backups",
        "Protokoll",
    ]);
    await expect(eintraege(page, "auslieferung")).toHaveText(["Umgebungen", "Versionen", "Datenabgleich"]);
    await expect(eintraege(page, "karte")).toHaveText([
        "Kartenserien",
        "Medieninhalte",
        "Höhenmodell",
        "Standardwerte",
        "Wegfindung",
        "Zoombänder",
    ]);
    await expect(eintraege(page, "redaktion")).toHaveText(["Neuigkeiten", "Mailpostfach"]);
    // Jeder Reiter bleibt auf einer Zeile (Betreiber: „Lange Reiternamen und Statusanzeigen dürfen keine zweite Zeile … erzeugen“).
    const hoehen = await fenster
        .locator('[data-testid^="verwaltung-eintrag-"]')
        .evaluateAll((elemente) => elemente.map((element) => Math.round(element.getBoundingClientRect().height)));
    expect(new Set(hoehen).size, hoehen.join(",")).toBe(1);

    // Die Warteschlange (bis `abcecce8` „Statusseite“, Kennung unverändert) ist seit 2026-10-11 eine Ansicht im Fenster, kein Verweis
    // in einen neuen Tab.
    const status = page.getByTestId("verwaltung-eintrag-statusseite");
    expect(await status.evaluate((element) => element.tagName)).toBe("BUTTON");
    await expect(status).not.toHaveAttribute("target", "_blank");
    // „Claudia & Claudio“ ist der Betreiber-Kanal (KANAL-0001 K3): Ein Admin sieht ihn nicht (`kanal.spec.ts` prüft ihn als Betreiber).
    await expect(page.getByTestId("verwaltung-eintrag-claudio")).toHaveCount(0);

    // Backups zeigt den Platzhalter bis zur Sicherungskette.
    await page.getByTestId("verwaltung-eintrag-backup").click();
    await expect(page.getByTestId("verwaltung-backup")).toContainText("Eine Sicherung ist ein Geheimnis.");
    await expect(page.getByTestId("verwaltung-eintrag-backup")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("verwaltung-eintrag-betrieb")).not.toHaveAttribute("aria-current", "page");

    // Die Schiene steht links, Leiste und Rumpf rechts daneben.
    const links = await page.getByTestId("fenster-schiene").boundingBox();
    const rumpf = await fenster.getByTestId("fenster-rumpf").boundingBox();
    expect(links !== null && rumpf !== null && links.x + links.width <= rumpf.x + 1).toBe(true);
});

test("🔴 Schiene mit der Tastatur: ↓ ↑ wandern, Enter wählt, Pos1 und Ende springen", async ({ page }) => {
    await oeffnen(page);
    await page.getByTestId("verwaltung-eintrag-personen").focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("verwaltung-eintrag-einladungen")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("verwaltung-eintrag-einladungen")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("verwaltung-einladungen")).toBeVisible();
    // Ohne Köpfe (`34593e61`) springt Pos1 auf den ersten Eintrag.
    await page.keyboard.press("Home");
    await expect(page.getByTestId("verwaltung-eintrag-personen")).toBeFocused();
    await page.keyboard.press("End");
    await expect(page.getByTestId("verwaltung-eintrag-protokoll")).toBeFocused();
});

test("🔴 Schiene der Systemsteuerung mit der Tastatur: ↓ ↑ über alle vier Gruppen, die Köpfe überspringen, Leertaste wählt, Ende springt", async ({
    page,
}) => {
    await oeffnen(page, {}, "systemsteuerung");
    await page.getByTestId("verwaltung-eintrag-betrieb").focus();
    // Betriebszustand › Systemzustand › Warteschlange › Backups › Protokoll | Umgebungen › Versionen › Datenabgleich | Kartenserien ›
    // Inhalte › Höhenmodell › Standardwerte › Wegfindung › Zoombänder | Neuigkeiten › Mailpostfach (der Kanal fehlt einem Admin). Die Köpfe sind keine Knöpfe:
    // ↓ geht vom letzten Reiter einer Gruppe direkt zum ersten der nächsten.
    for (let schritt = 0; schritt < 4; schritt += 1) await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("verwaltung-eintrag-protokoll-system")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("verwaltung-eintrag-production")).toBeFocused();
    for (let schritt = 0; schritt < 3; schritt += 1) await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("verwaltung-eintrag-kartenserien")).toBeFocused();
    for (let schritt = 0; schritt < 5; schritt += 1) await page.keyboard.press("ArrowUp");
    await expect(page.getByTestId("verwaltung-eintrag-backup")).toBeFocused();
    await page.keyboard.press(" ");
    await expect(page.getByTestId("verwaltung-backup")).toBeVisible();
    // Alle Gruppen offen: Ende ist der letzte Reiter, für einen Admin „Mailpostfach“.
    await page.keyboard.press("End");
    await expect(page.getByTestId("verwaltung-eintrag-mail")).toBeFocused();
});

test("🔴 ein Protokoll, zwei Filter: die Kontenverwaltung fragt `bereich=konten`, die Systemsteuerung `bereich=system`, „Alles“ nur für Betreiber (§9d.2)", async ({
    page,
}) => {
    const { calls } = await oeffnen(page);
    await page.getByTestId("verwaltung-eintrag-protokoll").click();
    await expect(page.getByTestId("protokoll-tafel")).toBeVisible();
    const audit = () => calls.filter((call) => call.method === "GET" && call.path === "/api/admin/audit");
    await expect.poll(() => audit().at(-1)?.query.get("bereich")).toBe("konten");
    // Art, Wer und Zeitraum im Trichter (Hausregel §13.45); die Kontenverwaltung zeigt ihre eigenen Arten.
    await page.getByTestId("protokoll-filter").click();
    await expect(page.getByTestId("protokoll-filter-art").locator("label")).toHaveText([
        "alle",
        "Anmeldungen",
        "Personen",
        "Einladungen",
        "Einzelrechte",
        "Links",
        "Passkeys",
    ]);
    await expect(page.getByTestId("protokoll-filter-blatt").locator("legend")).toHaveText([
        "Art der Einträge",
        "Wer",
        "Zeitraum",
    ]);
    await page.keyboard.press("Escape");

    await page.getByTestId("verwaltung-schliessen").click();
    await page.getByTestId("kopfleiste-menue").click();
    await page.getByTestId("menue-systemsteuerung").click();
    await page.getByTestId("verwaltung-eintrag-protokoll-system").click();
    await expect(page.getByTestId("protokoll-tafel")).toBeVisible();
    await expect.poll(() => audit().at(-1)?.query.get("bereich")).toBe("system");
    // Ein Admin wählt nur unter den System-Gruppen; „Alles, auch Konten“ fehlt.
    await page.getByTestId("protokoll-filter").click();
    await expect(page.getByTestId("protokoll-filter-art").locator("label")).toHaveText([
        "alle",
        "Betrieb & Datenabgleich",
        "Notzugang",
    ]);
});

test("🔴 als Betreiber zeigt das Protokoll der Systemsteuerung auf Wunsch alles, ohne Bereich", async ({ page }) => {
    const { calls } = await oeffnen(page, { role: "operator" }, "systemsteuerung");
    await page.getByTestId("verwaltung-eintrag-protokoll-system").click();
    await page.getByTestId("protokoll-filter").click();
    await expect(page.getByTestId("protokoll-filter-art").locator("label")).toHaveText([
        "alle",
        "Betrieb & Datenabgleich",
        "Notzugang",
        "Alles, auch Konten",
    ]);
    await page.getByTestId("protokoll-filter-art-gesamt").check();
    const audit = () => calls.filter((call) => call.method === "GET" && call.path === "/api/admin/audit");
    await expect.poll(() => audit().at(-1)?.query.get("bereich") ?? "ohne").toBe("ohne");
});

test("🔴 tiefer Link `?verwaltung=<eintrag>` öffnet das Fenster, das den Eintrag trägt, und verlässt die Adresse (§9d.1)", async ({
    page,
}) => {
    await stubAdmin(page);
    await page.goto("/edit?verwaltung=abgleiche");
    await expect(page.getByRole("dialog", { name: "Systemsteuerung" })).toBeVisible();
    await expect(page.getByTestId("verwaltung-eintrag-abgleiche")).toHaveAttribute("aria-current", "page");
    await expect.poll(() => new URL(page.url()).searchParams.has("verwaltung")).toBe(false);

    // Das Protokoll des Systems steht unter „Betrieb“ (Betreiber 2026-10-17); sein tiefer Link bleibt.
    await page.goto("/edit?verwaltung=protokoll-system");
    await expect(page.getByRole("dialog", { name: "Systemsteuerung" })).toBeVisible();
    await expect(page.getByTestId("verwaltung-eintrag-protokoll-system")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("verwaltung-bereich-betrieb")).toContainText("Protokoll");
    await expect(page.getByTestId("protokoll-tafel")).toBeVisible();

    await page.goto("/edit?verwaltung=einladungen");
    await expect(page.getByRole("dialog", { name: "Kontenverwaltung" })).toBeVisible();
    await expect(page.getByTestId("verwaltung-eintrag-einladungen")).toHaveAttribute("aria-current", "page");

    // Ohne Recht geht nichts auf.
    await stubAdmin(page, { capabilities: ["manage_people"] });
    await page.goto("/edit?verwaltung=abgleiche");
    await expect(page.getByTestId("kopfleiste")).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Systemsteuerung" })).toHaveCount(0);
});

test("🔴 Personen: eigenes Konto und Admins nur mit Grund; Sperren fragt nach dem Grund und schickt ihn", async ({
    page,
}) => {
    // Feste Uhr: „gestern“ ist ein Kalendertag, die Sperre von vor 25 Stunden hieße kurz nach Mitternacht „vor 2 Tagen“.
    const { calls } = await oeffnen(page, { uhr: MITTAG });
    const ich = page.getByTestId("person-0f8e5a52-6d0b-4f43-9c1e-2b7d9a3c4e51");
    await expect(ich).toContainText("eigenes Konto: hier nicht änderbar");
    await expect(ich.getByRole("combobox")).toBeDisabled();
    await expect(page.getByTestId("person-2c4e6a80-1b3d-4f5a-8c7e-9d0b1a2c3d4e")).toContainText(
        "verwaltet nur der Betreiber",
    );
    const gesperrt = page.getByTestId("person-a1b2c3d4-0000-4000-8000-000000000001");
    await expect(gesperrt).toContainText("gesperrt");
    await expect(gesperrt).toContainText("gestern · Rondrikan");
    await expect(page.getByTestId("personen-summe")).toHaveText(
        "7 Personen · 6 aktiv · 1 gesperrt · nach Name sortiert",
    );

    await page.getByTestId("person-sperren-a1b2c3d4-0000-4000-8000-000000000003").click();
    const frage = page.getByTestId("person-sperren-frage");
    await expect(frage).toContainText("Ingrimosch sperren?");
    await expect(frage.getByRole("button", { name: "Sperren" })).toBeDisabled();
    const grund = page.getByTestId("person-sperren-grund").getByRole("textbox");
    await expect(grund).toBeFocused();
    await grund.fill("  Spam im Forum ");
    await grund.press("Enter");
    await expect(frage).toBeHidden();
    expect(posts(calls, "/api/admin/people/lock")).toEqual([
        expect.objectContaining({
            personId: "a1b2c3d4-0000-4000-8000-000000000003",
            reason: "Spam im Forum",
            baseRevision: 1,
        }),
    ]);

    await page.getByTestId("verwaltung-suche").getByRole("searchbox").fill("prai");
    await expect(page.getByTestId("personen-tabelle").locator("tbody tr[data-testid]")).toHaveCount(1);
});

test("🔴 Personen: „Zuletzt da“ misst die letzte Anfrage, nicht die Anmeldung; eine Sitzung endet nie von selbst", async ({
    page,
}) => {
    await oeffnen(page, { uhr: MITTAG });
    await expect(page.getByRole("columnheader", { name: "Zuletzt da" })).toBeVisible();
    const traviabold = "a1b2c3d4-0000-4000-8000-000000000007";
    await expect(page.getByTestId(`person-${traviabold}`)).toContainText("vor 5 Min.");
    await expect(page.getByTestId(`person-${traviabold}`)).not.toContainText("vor 2 Tagen");
    // Ohne Sitzung bleibt nur die Anmeldung.
    await expect(page.getByTestId("person-a1b2c3d4-0000-4000-8000-000000000003")).toContainText("vor 12 Tagen");
    // Im Detail stehen beide.
    await page.getByTestId(`person-oeffnen-${traviabold}`).click();
    await expect(page.getByTestId("person-detail-zuletzt")).toHaveText("vor 5 Min.");
    await expect(page.getByTestId("person-detail-anmeldung")).toHaveText("vor 2 Tagen");
});

test("🔴 Rolle: ein Konflikt nennt Wer und Wann, die Auswahl zeigt wieder den Stand des Servers", async ({ page }) => {
    const { calls } = await oeffnen(page, {
        answer: (call) =>
            call.path === "/api/admin/people/role"
                ? {
                      status: 409,
                      body: {
                          error: {
                              code: "edit_conflict",
                              message: "x",
                              details: {
                                  changedBy: { id: "h", displayName: "Hesindiane" },
                                  changedAt: new Date(Date.now() - 120_000).toISOString(),
                              },
                          },
                      },
                  }
                : undefined,
    });
    const rolle = page.getByTestId("person-rolle-a1b2c3d4-0000-4000-8000-000000000007").getByRole("combobox");
    await expect(rolle).toHaveValue("editor");
    await expect(rolle.locator("option[value='admin']")).toBeDisabled();
    await rolle.selectOption("reviewer");
    await expect(page.getByTestId("person-meldung-a1b2c3d4-0000-4000-8000-000000000007")).toHaveText(
        "Hesindiane hat das gerade geändert (vor 2 Min.). Jetzt steht hier der aktuelle Stand.",
    );
    await expect(
        page.getByTestId("person-rolle-a1b2c3d4-0000-4000-8000-000000000007").getByRole("combobox"),
    ).toHaveValue("editor");
    expect(posts(calls, "/api/admin/people/role")[0]).toMatchObject({ role: "reviewer", baseRevision: 1 });
});

test("🔴 verlangt der Server einen Passkey, steht „Kurz bestätigen“ über der Verwaltung; abgebrochen bleibt der Satz", async ({
    page,
}) => {
    await oeffnen(page, {
        answer: (call) =>
            call.path === "/api/admin/people/sessions/revoke"
                ? {
                      status: 403,
                      body: { error: { code: "reauth_required", message: "x", details: { need: "passkey" } } },
                  }
                : undefined,
    });
    await page.getByTestId("person-sitzungen-a1b2c3d4-0000-4000-8000-000000000005").click();
    const bestaetigen = page.getByTestId("bestaetigen-fenster");
    await expect(bestaetigen).toBeVisible();
    await page.getByTestId("bestaetigen-abbrechen").click();
    await expect(bestaetigen).toBeHidden();
    await expect(page.getByRole("dialog", { name: "Kontenverwaltung" })).toBeVisible();
    await expect(page.getByTestId("person-meldung-a1b2c3d4-0000-4000-8000-000000000005")).toHaveText(
        "Die Anmeldung muss kurz bestätigt werden.",
    );
});

test("🔴 Einladungen: der Link nur beim Erzeugen, danach nur sein Ende", async ({ page }) => {
    const { calls, fenster } = await oeffnen(page);
    await page.getByTestId("verwaltung-eintrag-einladungen").click();
    await expect(page.getByTestId("einladung-rolle").getByRole("combobox")).toHaveValue("editor");
    await expect(page.getByTestId("einladung-rolle").locator("option")).toHaveText(["Tester", "Reviewer", "Editor"]);
    await page.getByTestId("einladung-fuer").getByRole("textbox").fill("Hesindian vom Kartenforum");
    await page.getByTestId("einladung-erzeugen").click();
    await expect(page.getByTestId("einladung-link-link").getByRole("textbox")).toHaveValue(/\/einladung#/u);
    expect(posts(calls, "/api/admin/invitations")[0]).toMatchObject({
        role: "editor",
        validDays: 7,
        note: "Hesindian vom Kartenforum",
    });
    const eintrag = page.getByTestId("einladung-b1b2c3d4-0000-4000-8000-000000000001");
    await expect(eintrag).toContainText("…C3sd");
    await expect(eintrag).not.toContainText("einladung#");
    await expect(eintrag).toContainText("Editor · noch 6 Tage");

    await page.getByTestId("einladung-zurueckziehen-b1b2c3d4-0000-4000-8000-000000000001").click();
    await expect(page.getByTestId("einladung-zurueckziehen-frage")).toContainText(
        "Einladung „Hesindian vom Kartenforum“ zurückziehen?",
    );
    await page.getByTestId("einladung-zurueckziehen-frage").getByRole("button", { name: "Zurückziehen" }).click();
    expect(posts(calls, "/api/admin/invitations/revoke")[0]).toMatchObject({
        invitationId: "b1b2c3d4-0000-4000-8000-000000000001",
        baseRevision: 1,
    });
    await page.getByTestId("einladungen-erledigt").click();
    await expect(fenster).toContainText("angenommen von Traviabold");
});

test("🔴 eine Einladung für Admin verlangt die Discord-ID der Person (D3)", async ({ page }) => {
    const { calls } = await oeffnen(page, { role: "operator" });
    await page.getByTestId("verwaltung-eintrag-einladungen").click();
    await page.getByTestId("einladung-rolle").getByRole("combobox").selectOption("admin");
    const id = page.getByTestId("einladung-discord-id").getByRole("textbox");
    await expect(id).toBeVisible();
    await expect(page.getByTestId("einladung-erzeugen")).toBeDisabled();
    await id.fill("123456789012345678");
    await page.getByTestId("einladung-erzeugen").click();
    await expect(page.getByTestId("einladung-link-link")).toBeVisible();
    expect(posts(calls, "/api/admin/invitations")[0]).toMatchObject({
        role: "admin",
        discordUserId: "123456789012345678",
    });
});

test("Rollen & Rechte: Grundrollen, Sonderrollen, die Matrix aus dem Katalog, Einzelrechte mit Inhabern", async ({
    page,
}) => {
    const { fenster } = await oeffnen(page);
    await page.getByTestId("verwaltung-eintrag-rollen").click();
    const zeile = page.getByTestId("rollen-manage_people");
    await expect(zeile.locator("td")).toHaveText(["V", "–", "–", "–", "✓", "✓", "–"]);
    await expect(page.getByTestId("rollen-assign_admin").locator("td")).toHaveText(["S", "–", "–", "–", "–", "✓", "–"]);
    // Was eine Sonderrolle auch denen gibt, deren Grundrolle es nicht hat.
    await expect(page.getByTestId("rollen-delete_media").locator("td").last()).toHaveText("Kurator");
    await expect(page.getByTestId("rollen-grundrollen")).toContainText("Editor");
    await expect(page.getByTestId("rollen-sonderrolle-regionalkanzler")).toContainText(
        "höchstens eine Person je Region",
    );
    await expect(page.getByTestId("rollen-sonderrolle-regionalkanzler").getByRole("button")).toHaveText("1 ›");
    await expect(page.getByTestId("sonderrecht-access_restricted_mode")).toContainText("Betreiber: Alrike vom Turm");
    await expect(page.getByTestId("sonderrecht-access_restricted_mode")).toContainText("Hesindiane");
    await expect(fenster).toContainText("Rollen und Einzelrechte gelten nur hier (Stage (Testwelt)).");
    // Die Zahl führt in den Reiter.
    await page.getByTestId("rollen-sonderrolle-regionalkanzler").getByRole("button").click();
    await expect(page.getByTestId("sonderrollen")).toBeVisible();
});

test("🔴 Fachrecht ohne Betrieb: Der Odologe sieht in der Systemsteuerung nur die Wegfindung (WI-0279)", async ({
    page,
}) => {
    const { calls, fenster } = await oeffnen(
        page,
        { capabilities: ["manage_routing", "view_own_jobs"] },
        "systemsteuerung",
    );
    await expect(fenster.getByTestId(/^verwaltung-eintrag-/u)).toHaveCount(1);
    await expect(page.getByTestId("verwaltung-eintrag-wegfindung")).toBeVisible();
    // Das Fenster fragt nichts, was der Betrieb lesen müsste.
    expect(calls.filter((call) => call.path === "/api/admin/system" || call.path === "/api/admin/people")).toEqual([]);
});

const BETREIBER = {
    role: "operator",
    capabilities: [...ADMIN_CAPABILITIES, "assign_admin", "grant_special_capabilities"],
};
const SONDER = "a1b2c3d4-0000-4000-8000-000000000005";

test("🔴 Sonderrollen: ist der Abgleich von Production eingerichtet, liest der Reiter nur und die Einladung bietet sie nicht an (WI-0279 E9)", async ({
    page,
}) => {
    await oeffnen(page, {
        ...BETREIBER,
        answer: (call) =>
            call.method === "GET" && call.path === "/api/admin/sonderrollen"
                ? {
                      status: 200,
                      body: {
                          zuteilungen: [],
                          regionen: [],
                          abgleich: {
                              stand: "gestoert",
                              zuletzt: new Date(Date.now() - 900_000).toISOString(),
                              gestoertSeit: new Date(Date.now() - 600_000).toISOString(),
                              ruht: false,
                              ohneKontoZahl: 1,
                              ohneKonto: [{ discordId: "111111111111111111", sonderrolle: "kurator", region: null }],
                          },
                      },
                  }
                : undefined,
    });
    await page.getByTestId("verwaltung-eintrag-sonderrollen").click();
    await expect(page.getByTestId("sonderrollen-abgleich")).toContainText("gestört");
    await expect(page.getByTestId("sonderrollen-ohne-konto")).toContainText("111111111111111111");
    await expect(page.getByTestId("sonderrolle-vergeben-oeffnen")).toHaveCount(0);
    await page.getByTestId("verwaltung-eintrag-einladungen").click();
    await expect(page.getByTestId("einladung-erzeugen")).toBeVisible();
    await expect(page.getByTestId("einladung-sonderrolle-keine")).toHaveCount(0);
});

test("🔴 Sonderrollen: der Betreiber vergibt mit Grund und entzieht; der Konflikt der Region ist benannt (WI-0279)", async ({
    page,
}) => {
    const { calls } = await oeffnen(page, BETREIBER);
    await page.getByTestId("verwaltung-eintrag-sonderrollen").click();
    await expect(page.getByTestId("sonderrolle-kurator")).toContainText("Stufe S");
    await expect(page.getByTestId("sonderrolle-ortskundiger")).toContainText("keine Zusatzrechte");

    await page.getByTestId("sonderrolle-kurator").click();
    await expect(page.getByTestId("sonderrolle-rechte")).toContainText("Medien hochladen");
    await expect(page.getByTestId("sonderrolle-stufen")).toContainText("Stufe R: jede Anmeldung");
    await expect(page.getByTestId("sonderrolle-wirkung")).toContainText("Endgültiges Löschen");
    await page.getByTestId("sonderrolle-vergeben-oeffnen").click();
    await expect(page.getByTestId("sonderrolle-vergeben")).toBeDisabled();
    await page.getByTestId(`sonderrolle-person-${SONDER}`).click();
    await page.getByTestId("sonderrolle-grund").getByRole("textbox").fill("Medienverwaltung vollständig");
    await page.getByTestId("sonderrolle-vergeben").click();
    expect(posts(calls, "/api/admin/sonderrollen/vergeben")[0]).toMatchObject({
        personId: SONDER,
        sonderrolle: "kurator",
        grund: "Medienverwaltung vollständig",
    });
    await expect(page.getByTestId("sonderrolle-kurator")).toContainText("1");
    await expect(page.getByTestId("sonderrolle-verlauf")).toContainText("Grund: Medienverwaltung vollständig");

    await page.getByTestId("sonderrolle-entziehen-2").click();
    const frage = page.getByTestId("sonderrolle-entziehen-frage");
    await expect(frage.getByRole("button", { name: "Entziehen" })).toBeDisabled();
    await page.getByTestId("sonderrolle-entzug-grund").getByRole("textbox").fill("Ende der Vertretung");
    await frage.getByRole("button", { name: "Entziehen" }).click();
    expect(posts(calls, "/api/admin/sonderrollen/entziehen")[0]).toMatchObject({
        zuteilungId: "2",
        grund: "Ende der Vertretung",
    });
    await expect(page.getByTestId("sonderrolle-zuteilung-2")).toHaveCount(0);

    await page.getByTestId("sonderrolle-regionalkanzler").click();
    await page.getByTestId("sonderrolle-vergeben-oeffnen").click();
    await page.getByTestId(`sonderrolle-person-${SONDER}`).click();
    await page.getByTestId("sonderrolle-regionen").getByText("Weiden").click();
    await page.getByTestId("sonderrolle-grund").getByRole("textbox").fill("Probe");
    await expect(page.getByTestId("sonderrolle-vergabe")).toContainText("Weiden hat schon jemanden in dieser Rolle");
    await expect(page.getByTestId("sonderrolle-vergeben")).toBeDisabled();
});

test("🔴 Sonderrollen: ein Admin liest nur und sieht keinen Grund im Knopf (WI-0279)", async ({ page }) => {
    await oeffnen(page);
    await page.getByTestId("verwaltung-eintrag-sonderrollen").click();
    await expect(page.getByTestId("sonderrolle-detail")).toContainText("Nur lesend.");
    await expect(page.getByTestId("sonderrolle-vergeben-oeffnen")).toHaveCount(0);
    await page.getByTestId("sonderrolle-regionalkanzler").click();
    await expect(page.getByTestId("sonderrolle-entziehen-1")).toHaveCount(0);
    await expect(page.getByTestId("sonderrolle-zuteilung-1")).toContainText("Weiden");
});

test("🔴 Einladung mit Sonderrolle: Vorgabe keine; mit Auswahl brauchen Discord-ID, Region und Grund (WI-0279)", async ({
    page,
}) => {
    const { calls } = await oeffnen(page, BETREIBER);
    await page.getByTestId("verwaltung-eintrag-einladungen").click();
    await expect(page.getByTestId("einladung-sonderrolle-keine")).toBeChecked();
    await expect(page.getByTestId("einladung-discord-id")).toHaveCount(0);

    await page.getByTestId("einladung-sonderrolle-kurator").check();
    await page.getByTestId("einladung-sonderrolle-ortskundiger").check();
    await expect(page.getByTestId("einladung-sonderrolle-keine")).not.toBeChecked();
    await expect(page.getByTestId("einladung-erzeugen")).toBeDisabled();
    await page.getByTestId("einladung-discord-id").getByRole("textbox").fill("123456789012345678");
    await expect(page.getByTestId("einladung-erzeugen")).toBeDisabled();
    await page.getByTestId("einladung-regionen-ortskundiger").getByText("Garetien").click();
    await expect(page.getByTestId("einladung-erzeugen")).toBeDisabled();
    await page.getByTestId("einladung-sonderrolle-grund").getByRole("textbox").fill("Neu im Team");
    await page.getByTestId("einladung-erzeugen").click();
    expect(posts(calls, "/api/admin/invitations")[0]).toMatchObject({
        discordUserId: "123456789012345678",
        sonderrollen: [
            { sonderrolle: "kurator" },
            { sonderrolle: "ortskundiger", regionen: ["7d000000-0000-4000-8000-000000000002"] },
        ],
        sonderrollenGrund: "Neu im Team",
    });
    await expect(page.getByTestId("einladung-sonderrolle-keine")).toBeChecked();
});

test("🔴 Einladung: ein Admin sieht das Feld der Sonderrollen nicht (WI-0279)", async ({ page }) => {
    await oeffnen(page);
    await page.getByTestId("verwaltung-eintrag-einladungen").click();
    await expect(page.getByTestId("einladung-neu")).toBeVisible();
    await expect(page.getByTestId("einladung-sonderrolle-keine")).toHaveCount(0);
});

test("Protokoll: die Art filtert über die API, Wer und Zeitraum gehen mit", async ({ page }) => {
    const { calls } = await oeffnen(page, { capabilities: [...ADMIN_CAPABILITIES] });
    await page.getByTestId("verwaltung-eintrag-protokoll").click();
    await expect(page.getByTestId("protokoll-eintrag")).toHaveCount(4);
    await expect(page.getByTestId("protokoll-eintrag").nth(1)).toContainText(
        "Rolle geändert · Traviabold: Reviewer → Editor",
    );
    await page.getByTestId("protokoll-filter").click();
    await page.getByTestId("protokoll-filter-art-personen").check();
    await page.getByTestId("protokoll-filter-wer-a1b2c3d4-0000-4000-8000-000000000007").check();
    await expect(page.getByTestId("protokoll-filter-zahl")).toHaveText("3");
    await expect
        .poll(() => {
            const last = calls.filter((call) => call.path === "/api/admin/audit").at(-1);
            return [last?.query.get("action"), last?.query.get("personId"), last?.query.has("from")];
        })
        .toEqual(["person.", "a1b2c3d4-0000-4000-8000-000000000007", true]);
});

test("🔴 Protokoll-Suche links in der Leiste: Freitext geht als q an den Server, mit den Handlungen, deren Titel passt; Esc leert sie", async ({
    page,
}) => {
    // Betreiber 2026-10-11 (Entscheidungsprotokoll 3f7acfc8): Suche links, Trichter rechtsbündig (AvmListenleiste).
    const { calls } = await oeffnen(page, { capabilities: [...ADMIN_CAPABILITIES] });
    await page.getByTestId("verwaltung-eintrag-protokoll").click();
    await expect(page.getByTestId("protokoll-eintrag")).toHaveCount(4);
    const leiste = page.getByTestId("protokoll-leiste");
    await expect(leiste.getByTestId("protokoll-filter")).toBeVisible();
    const suche = page.getByTestId("protokoll-leiste-suche").locator("input");
    await suche.fill("gesperrt");
    await expect(page.getByTestId("protokoll-eintrag")).toHaveCount(1);
    await expect(page.getByTestId("protokoll-eintrag")).toContainText("Efferdan_vom_Kap");
    const letzte = () => calls.filter((call) => call.path === "/api/admin/audit").at(-1)!.query;
    expect(letzte().get("q")).toBe("gesperrt");
    expect(letzte().get("qAktionen")?.split(",")).toContain("person.locked");
    // Ein Wert der Details.
    await suche.fill("Fremdzugriff");
    await expect(page.getByTestId("protokoll-eintrag")).toHaveCount(1);
    // Esc leert zuerst die Suche; das Fenster bleibt offen.
    await suche.press("Escape");
    await expect(suche).toHaveValue("");
    await expect(page.getByTestId("protokoll-eintrag")).toHaveCount(4);
    await expect(page.getByTestId("kontenverwaltung-fenster")).toBeVisible();
});

test("🔴 Detail: der Rücksetzlink steht in der Karte der Anmeldewege; der Betreiber teilt ein Sonderrecht mit Grund zu", async ({
    page,
}) => {
    const { calls } = await oeffnen(page, {
        role: "operator",
        capabilities: [...ADMIN_CAPABILITIES, "assign_admin", "grant_special_capabilities", "manage_passkeys"],
    });
    await page.getByTestId("person-oeffnen-a1b2c3d4-0000-4000-8000-000000000005").click();
    await expect(page.getByTestId("person-detail-name")).toHaveText("Praiodan_42");
    // Nur der Name von Discord, keine Zwei-Faktor-Angabe mehr (Betreiber 2026-10-10: „B: nicht mehr speichern“).
    await expect(page.getByTestId("person-detail-discord")).toHaveText("praiodan");
    await page.getByTestId("person-detail-ruecksetzlink").click();
    await expect(page.getByTestId("person-link-link").getByRole("textbox")).toHaveValue(/^https:\/\//u);
    expect(posts(calls, "/api/admin/people/reset-link")).toHaveLength(1);
    await page.getByTestId("person-zurueck").click();
    await expect(page.getByTestId("personen-tabelle")).toBeVisible();
    await expect(page.getByTestId("person-meldung-a1b2c3d4-0000-4000-8000-000000000005")).toBeHidden();

    await page.getByTestId("person-oeffnen-2c4e6a80-1b3d-4f5a-8c7e-9d0b1a2c3d4e").click();
    await expect(page.getByTestId("person-sonderrecht-zuteilen")).toBeDisabled();
    await page.getByTestId("person-sonderrecht-grund").getByRole("textbox").fill("Vertretung im Wartungsfenster");
    await page.getByTestId("person-sonderrecht-zuteilen").click();
    expect(posts(calls, "/api/admin/people/capabilities/grant")[0]).toMatchObject({
        personId: "2c4e6a80-1b3d-4f5a-8c7e-9d0b1a2c3d4e",
        capability: "access_restricted_mode",
        reason: "Vertretung im Wartungsfenster",
    });
});

test("🔴 die Statusseite im Fenster: eingebettet, ohne Seitenkopf, die Adresse bleibt; der Betriebszustand schaltet dorthin", async ({
    page,
}) => {
    await oeffnen(page, {}, "systemsteuerung");
    const adresse = await page.evaluate(() => globalThis.location.href);
    const titel = await page.title();
    await page.getByTestId("betrieb-statusseite").click();
    const ansicht = page.getByTestId("verwaltung-statusseite");
    // Die Statusseite ist ein eigener Teil (`defineAsyncComponent`): Kalt übersetzt ihn Vite erst beim ersten Abruf, das dauert über 5 s.
    await expect(ansicht.getByTestId("status-page")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("verwaltung-eintrag-statusseite")).toHaveAttribute("aria-current", "page");
    // Kein Seitenkopf und kein Thema-Knopf der eigenen Seite; der Weg dorthin bleibt als Verweis.
    await expect(ansicht.locator(".status-page__title")).toHaveCount(0);
    await expect(ansicht.getByTestId("status-eigene-seite")).toHaveAttribute("href", "/status.html");
    await expect(ansicht.getByTestId("status-eigene-seite")).toHaveAttribute("target", "_blank");
    // Die Reiter schreiben eingebettet nichts in die Adresse: dort steht der Ausschnitt der Karte.
    await expect(ansicht.getByTestId("status-tabs")).toBeVisible();
    await ansicht.getByTestId("status-reiter-queue").click();
    expect(await page.evaluate(() => globalThis.location.href)).toBe(adresse);
    // 🔴 Den Titel des Tabs führt die Karte nach der Sitzung (`auth/seitentitel.ts`); eingebettet setzt ihn die Statusseite nicht.
    await expect(page).toHaveTitle(titel);
});
