import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Kopfleiste, Hauptmenü und Anmeldefenster (WI-0120 A9; Betreiber 2026-10-09: L1 ohne Logo, „Avesmaps Editor“ plus Pille).
 *
 * Die Sitzung kommt aus einem Stub (`GET /api/auth/session`), damit jeder Zustand ohne Datenbank und ohne echtes Konto
 * prüfbar ist; Karte und Kacheln liefert der echte Entwicklungsserver. Die echte Anmeldung gegen PostgreSQL prüfen die
 * Servertests, die echte Discord-Anmeldung der Betreiber (AUTH-0001 §16, Stufe E).
 */

const PERSON = {
    id: "0f8e5a52-6d0b-4f43-9c1e-2b7d9a3c4e51",
    displayName: "Rondrikan",
    role: "admin",
    methods: ["discord"],
    assurance: "strong",
    sessionMethod: "discord",
    confirmedAt: "2026-10-09T10:00:00.000Z",
    passkeyConfirmedAt: null,
    expiresAt: "2026-11-08T10:00:00.000Z",
    passkeyCount: 0,
};

type Session = {
    environment: string | null;
    authEnabled: boolean;
    person: typeof PERSON | null;
    capabilities: string[];
};

const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** Die Leiste gibt es nur im Editor-Modus (Betreiber 2026-10-09); deshalb beginnen die Fälle unter `/edit`. */
async function open(page: Page, session: Session, path = "/edit"): Promise<void> {
    await page.route("**/api/auth/session", (route) => json(route, 200, session));
    await page.goto(path);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
}

const GUEST: Session = { environment: "development", authEnabled: true, person: null, capabilities: [] };
const ADMIN: Session = {
    environment: "staging",
    authEnabled: true,
    person: PERSON,
    capabilities: ["manage_people", "read_audit", "use_editor_menu", "view_editor_series"],
};

test("🔴 ohne Anmeldung: Leiste mit „Avesmaps Editor“ und Pille, das Fenster geht auf, „Anmelden“ öffnet es wieder, Escape bringt den Fokus zurück", async ({
    page,
}) => {
    await open(page, GUEST);
    // Auf /edit ohne Anmeldung geht das Fenster von selbst auf (WI-0203; der Betreiber wählte 2026-10-16 „Ja, wie rechts“).
    const fenster = page.getByRole("dialog", { name: "Anmelden" });
    await expect(fenster).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(fenster).toBeHidden();
    const leiste = page.getByTestId("kopfleiste");
    await expect(leiste).toContainText("Avesmaps Editor");
    await expect(page.getByTestId("kopfleiste-umgebung")).toHaveText("LOKAL · Entwicklung");
    const lage = await page.evaluate(() => ({
        leiste: document.querySelector('[data-testid="kopfleiste"]')!.getBoundingClientRect().height,
        app: document.querySelector(".app")!.getBoundingClientRect().top,
        karte: document.querySelector(".map")!.getBoundingClientRect().bottom,
        hoehe: innerHeight,
    }));
    expect(lage.app).toBe(lage.leiste);
    expect(lage.karte).toBe(lage.hoehe);
    const anmelden = page.getByTestId("kopfleiste-anmelden");
    await anmelden.click();
    await expect(fenster).toBeVisible();
    await expect(fenster).toHaveCSS("width", "360px");
    await page.keyboard.press("Escape");
    await expect(fenster).toBeHidden();
    await expect(anmelden).toBeFocused();
});

test("🔴 angemeldet auf Stage: Name, Rolle, STAGE und Kante; ☰ mit Tastatur, Escape und Klick daneben", async ({
    page,
}) => {
    await open(page, ADMIN);
    const leiste = page.getByTestId("kopfleiste");
    await expect(leiste).toContainText("Rondrikan");
    await expect(leiste).toContainText("Admin");
    await expect(page.getByTestId("kopfleiste-umgebung")).toHaveText("STAGE · Testwelt");
    await expect(leiste).toHaveCSS("border-bottom-width", "2px");
    const knopf = page.getByTestId("kopfleiste-menue");
    await knopf.click();
    const menue = page.getByTestId("hauptmenue");
    await expect(menue).toContainText("Angemeldet über Discord");
    await expect(page.getByTestId("menue-konto")).toBeFocused();
    // „Kontenverwaltung …“ und „Systemsteuerung …“ stehen da, weil die Sitzung je ein Recht dafür hat (A10, SYS-15: Personen und
    // das Protokoll); die Pfeiltasten wandern darüber.
    await expect(page.getByTestId("menue-kontenverwaltung")).toContainText("Kontenverwaltung …");
    await expect(page.getByTestId("menue-systemsteuerung")).toContainText("Systemsteuerung …");
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("menue-kontenverwaltung")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("menue-systemsteuerung")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("menue-abmelden")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menue).toBeHidden();
    await expect(knopf).toBeFocused();
    await knopf.click();
    await expect(menue).toBeVisible();
    await page.mouse.click(640, 500);
    await expect(menue).toBeHidden();
});

// Seit dem Notfall-Cutover 2026-10-12 ist Production öffentlich. Wer dort arbeitet, muss am Kopf sehen, dass es die echte
// Karte ist und nicht die Testwelt: dieselbe Form wie Stage, das andere Signal (Betreiber 2026-10-12).
test("🔴 auf Production: Pille „PRODUCTION · Live“ in Grün, Kante wie auf Stage", async ({ page }) => {
    await open(page, { ...ADMIN, environment: "production" });
    await expect(page.getByTestId("kopfleiste-umgebung")).toHaveText("PRODUCTION · Live");
    const leiste = page.getByTestId("kopfleiste");
    await expect(leiste).toHaveCSS("border-bottom-width", "2px");
    const kante = await leiste.evaluate((element) => getComputedStyle(element).borderBottomColor);
    const pille = await page
        .getByTestId("kopfleiste-umgebung")
        .evaluate((element) => getComputedStyle(element).backgroundColor);
    const stage = await page.evaluate(() => {
        const wurzel = getComputedStyle(document.documentElement);
        return {
            erfolg: wurzel.getPropertyValue("--color-success").trim(),
            warnung: wurzel.getPropertyValue("--color-warning").trim(),
        };
    });
    // Die Kante trägt das Erfolgs-Token, nicht das der Warnung: Stage und Production sind nie zu verwechseln.
    expect(stage.erfolg).not.toBe(stage.warnung);
    expect(kante).not.toBe("rgba(0, 0, 0, 0)");
    expect(pille).not.toBe("rgba(0, 0, 0, 0)");
});

/**
 * Das Umgebungsmenü an der Pille (WI-0180): nur für Betreiber (`switch_environment`). Lokal ist der einzige Fall, den ein
 * Browsertest auf `localhost` zeigen kann; Stage ↔ Production (⇄), die gesperrte Stage und das Merkzeichen prüft
 * `test/umgebungswechsel.test.ts`, weil sie aus dem Hostnamen folgen.
 */
const OPERATOR: Session = {
    environment: "development",
    authEnabled: true,
    person: { ...PERSON, role: "operator" },
    capabilities: ["switch_environment", "use_editor_menu", "view_editor_series"],
};

test("🔴 lokal als Betreiber: Kante in Petrol, die Pille öffnet die Tafel mit Stage und Production; Tasten, Escape, Klick daneben", async ({
    page,
}) => {
    await page.route("**/api/admin/system/umgebungen", (route) =>
        json(route, 200, { eigene: { releaseId: "dev" }, gegenseite: null }),
    );
    await open(page, OPERATOR);
    const leiste = page.getByTestId("kopfleiste");
    await expect(leiste).toHaveCSS("border-bottom-width", "2px");
    const farben = await leiste.evaluate((element) => ({
        kante: getComputedStyle(element).borderBottomColor,
        petrol: getComputedStyle(document.documentElement).getPropertyValue("--color-local").trim(),
    }));
    expect(farben.petrol).not.toBe("");
    expect(farben.kante).not.toBe("rgba(0, 0, 0, 0)");
    const pille = page.getByTestId("kopfleiste-umgebung");
    await expect(pille).toHaveText("LOKAL · Entwicklung");
    await expect(pille).toHaveAttribute("aria-haspopup", "menu");
    await pille.click();
    const tafel = page.getByTestId("umgebungsmenue");
    await expect(tafel).toBeVisible();
    // Lokal ist die aktuelle Umgebung (Marke ● und gewählte Zeile); Stage und Production sind echte Links auf die öffentlichen
    // Adressen, mit dem Pfad dieser Seite.
    const lokal = page.getByTestId("umgebung-development");
    await expect(lokal).toHaveAttribute("aria-checked", "true");
    await expect(lokal).toContainText("Arbeitsstand, nicht veröffentlicht");
    await expect(page.getByTestId("umgebung-staging")).toHaveAttribute("href", /^https:\/\/stage\.avesmaps\.de\/edit/);
    await expect(page.getByTestId("umgebung-production")).toHaveAttribute("href", /^https:\/\/avesmaps\.de\/edit/);
    // Der Fokus steht auf dem ersten Ziel; die Pfeile wandern, Escape schließt und gibt ihn der Pille zurück.
    await expect(page.getByTestId("umgebung-staging")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("umgebung-production")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(tafel).toBeHidden();
    await expect(pille).toBeFocused();
    await pille.click();
    await expect(tafel).toBeVisible();
    await page.mouse.click(640, 500);
    await expect(tafel).toBeHidden();
});

test("🔴 ohne das Recht bleibt die Pille eine Angabe, auch für Admins", async ({ page }) => {
    await open(page, { ...ADMIN, environment: "development" });
    const pille = page.getByTestId("kopfleiste-umgebung");
    await expect(pille).toHaveText("LOKAL · Entwicklung");
    expect(await pille.evaluate((element) => element.tagName)).toBe("SPAN");
});

test("🔴 Abmelden schickt die Abmeldung und lädt neu", async ({ page }) => {
    await open(page, ADMIN);
    let abgemeldet = false;
    await page.route("**/api/auth/logout", (route) => {
        abgemeldet = true;
        return route.fulfill({ status: 204 });
    });
    await page.getByTestId("kopfleiste-menue").click();
    const neu = page.waitForEvent("load");
    await page.getByTestId("menue-abmelden").click();
    await neu;
    expect(abgemeldet).toBe(true);
});

test("🔴 /anmelden: Fenster offen, Adresse bereinigt; abgewiesen mit eigenem Satz und leerem Passwort; Drossel zählt", async ({
    page,
}) => {
    let antwort = { status: 401, body: { error: { code: "invalid_credentials", message: "vom Server" } } as unknown };
    await page.route("**/api/auth/login", (route) => json(route, antwort.status, antwort.body));
    await open(page, GUEST, "/anmelden");
    expect(new URL(page.url()).pathname).toBe("/edit");
    const fenster = page.getByRole("dialog", { name: "Anmelden" });
    await expect(fenster).toBeVisible();
    await fenster.getByLabel("Benutzername:").fill("Rondrikan");
    await fenster.getByLabel("Avesmaps-Passwort:").fill("falsch-falsch-falsch");
    await fenster.getByLabel("Avesmaps-Passwort:").press("Enter");
    await expect(page.getByTestId("anmelden-meldung")).toHaveText("Benutzername oder Passwort stimmen nicht.");
    await expect(fenster.getByLabel("Avesmaps-Passwort:")).toHaveValue("");
    await expect(fenster.getByLabel("Benutzername:")).toHaveValue("Rondrikan");

    antwort = {
        status: 429,
        body: { error: { code: "rate_limited", message: "x", details: { retryAfterSeconds: 120 } } },
    };
    await fenster.getByLabel("Avesmaps-Passwort:").fill("noch-ein-versuch-hier");
    await page.getByTestId("anmelden-absenden").click();
    await expect(page.getByTestId("anmelden-meldung")).toHaveText(
        "Zu viele Fehlversuche. Der nächste Versuch geht in 2 Minuten.",
    );
    await expect(page.getByTestId("anmelden-absenden")).toBeDisabled();
    await expect(fenster).toContainText("noch 2 Minuten");
});

test("🔴 Rückkehr von Discord ohne Zugang: Fenster mit Erklärung, der Parameter ist aus der Adresse", async ({
    page,
}) => {
    await open(page, GUEST, "/?anmeldung=kein_zugang");
    await expect(page.getByTestId("anmelden-rueckkehr")).toHaveText(
        "Für dieses Discord-Konto gibt es hier keinen Zugang. Zugang gibt es nur mit Einladung.",
    );
    expect(new URL(page.url()).searchParams.has("anmeldung")).toBe(false);
    // Ohne Ziel zurück: in den Editor-Modus, wo die Leiste die Anmeldung trägt.
    expect(new URL(page.url()).pathname).toBe("/edit");
    await expect(page.getByTestId("kopfleiste")).toBeVisible();
});

/**
 * Die Stage-Tür ohne Nginx (WI-0120 R6, AUTH-0001 §4.5; Claudios vhost, `handovers/2026-10-09-stage-tuer-abstimmung-antwort.md`):
 * ohne Sitzung 401 `text/plain` auf API außer `/api/auth/*`, Kacheln und Medien. Gibt die Tür wieder frei.
 */
async function door(page: Page, blocked: string[] = []): Promise<() => Promise<void>> {
    const shut = (url: URL): boolean =>
        (url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/auth/")) ||
        url.pathname.startsWith("/tiles/") ||
        url.pathname.startsWith("/media/");
    const closed = (route: Route) => {
        blocked.push(new URL(route.request().url()).pathname);
        return route.fulfill({ status: 401, contentType: "text/plain", body: "Anmeldung erforderlich\n" });
    };
    await page.route(shut, closed);
    return () => page.unroute(shut, closed);
}

const STAGE_GUEST: Session = { ...GUEST, environment: "staging" };

test("🔴 Stage-Tür (R6): /anmelden steht trotz lauter 401 und hängt nicht; nach der Anmeldung lädt die Seite neu, die Sitzung trägt", async ({
    page,
}) => {
    const blocked: string[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    const open = await door(page, blocked);
    let session = STAGE_GUEST;
    await page.route("**/api/auth/session", (route) => json(route, 200, session));
    await page.route("**/api/auth/login", async (route) => {
        // Mit dem Cookie lässt die Tür alles durch.
        session = ADMIN;
        await open();
        return json(route, 200, { ok: true });
    });
    await page.goto("/anmelden");
    const fenster = page.getByRole("dialog", { name: "Anmelden" });
    await expect(fenster).toBeVisible();
    // Die Karte dahinter fragt und bekommt 401; das Fenster bleibt bedienbar, nichts wirft, kein Toast.
    await expect.poll(() => blocked.length).toBeGreaterThan(10);
    await fenster.getByLabel("Benutzername:").fill("Rondrikan");
    await fenster.getByLabel("Avesmaps-Passwort:").fill("Rondra schützt die Tapferen");
    expect(errors).toEqual([]);
    await expect(page.getByTestId("toast")).toHaveCount(0);

    const neu = page.waitForEvent("load");
    await page.getByTestId("anmelden-absenden").click();
    await neu;
    await expect(page.getByTestId("kopfleiste")).toContainText("Rondrikan");
    await expect(page.getByRole("dialog", { name: "Anmelden" })).toBeHidden();
    expect(new URL(page.url()).pathname).toBe("/edit");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
});

test("🔴 Stage-Tür (R6): Discord kehrt ohne Sitzung über /anmelden zurück und erklärt es; angemeldet öffnet /anmelden kein Fenster", async ({
    page,
}) => {
    const open = await door(page);
    let session = STAGE_GUEST;
    await page.route("**/api/auth/session", (route) => json(route, 200, session));
    let start: unknown;
    await page.route("**/api/auth/discord/start", (route) => {
        start = route.request().postDataJSON();
        // Statt discord.com: gleich die Rückkehr, die der Server für ein Konto ohne Einladung schickt.
        return json(route, 200, { authorizeUrl: "/anmelden?anmeldung=kein_zugang" });
    });
    await page.goto("/anmelden");
    await page.getByTestId("anmelden-discord").click();
    await expect(page.getByTestId("anmelden-rueckkehr")).toHaveText(
        "Für dieses Discord-Konto gibt es hier keinen Zugang. Zugang gibt es nur mit Einladung.",
    );
    expect(start).toMatchObject({ purpose: "login", returnPath: "/anmelden" });
    expect(new URL(page.url()).pathname).toBe("/edit");
    expect(new URL(page.url()).searchParams.has("anmeldung")).toBe(false);

    session = ADMIN;
    await open();
    await page.goto("/anmelden?anmeldung=ok");
    await expect(page.getByTestId("toast")).toContainText("Angemeldet.");
    await expect(page.getByRole("dialog", { name: "Anmelden" })).toBeHidden();
    expect(new URL(page.url()).pathname).toBe("/edit");
});

test("🔴 ein Einladungslink verliert sein Geheimnis aus der Adresse, bevor die Karte ihren Ausschnitt schreibt", async ({
    page,
}) => {
    const token = "Q".repeat(43);
    await open(page, GUEST, `/einladung#${token}`);
    expect(page.url()).not.toContain(token);
    expect(new URL(page.url()).pathname).toBe("/edit");
});

test("🔴 Anmeldung nicht eingerichtet: keine Leiste, die Karte füllt die Seite wie zuvor", async ({ page }) => {
    await open(page, { environment: null, authEnabled: false, person: null, capabilities: [] });
    await expect(page.getByTestId("kopfleiste")).toHaveCount(0);
    expect(await page.evaluate(() => document.querySelector(".app")!.getBoundingClientRect().top)).toBe(0);
});

test("🔴 WI-0120 A12: eine abgelaufene Einladung und ein verbrauchter Rücksetzlink sagen es im Fenster", async ({
    page,
}) => {
    await page.route("**/api/auth/invitations/inspect", (route) =>
        json(route, 400, { error: { code: "invitation_invalid", message: "x" } }),
    );
    await open(page, GUEST, `/einladung#${"E".repeat(43)}`);
    await expect(page.getByTestId("einladung-ungueltig")).toHaveText(
        "Diese Einladung gilt nicht mehr. Eine neue kommt von der Verwaltung.",
    );

    await page.route("**/api/auth/links/inspect", (route) =>
        json(route, 400, { error: { code: "link_invalid", message: "x" } }),
    );
    await page.goto(`/passwort#${"P".repeat(43)}`);
    await expect(page.getByTestId("passwort-ungueltig")).toHaveText(
        "Dieser Link gilt nicht mehr. Ein neuer kommt von einer Person der Verwaltung.",
    );
});

test("🔴 WI-0120 A12: ein gesperrtes Konto bekommt seinen eigenen Satz", async ({ page }) => {
    await page.route("**/api/auth/login", (route) =>
        json(route, 403, { error: { code: "account_locked", message: "x" } }),
    );
    await open(page, GUEST, "/anmelden");
    const fenster = page.getByRole("dialog", { name: "Anmelden" });
    await fenster.getByLabel("Benutzername:").fill("Efferdan");
    await fenster.getByLabel("Avesmaps-Passwort:").fill("Ein Satz aus vielen Wörtern");
    await fenster.getByLabel("Avesmaps-Passwort:").press("Enter");
    await expect(page.getByTestId("anmelden-meldung")).toHaveText("Dieses Konto ist gesperrt.");
});

test("🔴 WI-0120 A12 (T19): die Einladung nennt die Umgebung, damit niemand Stage mit Avesmaps verwechselt", async ({
    page,
}) => {
    await page.route("**/api/auth/invitations/inspect", (route) =>
        json(route, 200, {
            role: "editor",
            environment: "staging",
            expiresAt: "2026-10-16T10:00:00.000Z",
            invitedBy: "Rondrikan",
            requiresDiscord: false,
        }),
    );
    await open(page, GUEST, `/einladung#${"S".repeat(43)}`);
    const angaben = page.getByTestId("einladung-angaben");
    await expect(angaben).toContainText("Stage (Testwelt)");
    await expect(angaben).toContainText("Editor");
    await expect(angaben).toContainText("Rondrikan");
});

test("🔴 der Editor-Balken nur im Editor-Modus: `/` ohne Leiste, auch angemeldet; `/edit`, `?editor=true` und `?edit=1` mit", async ({
    page,
}) => {
    await open(page, ADMIN, "/");
    await expect(page.getByTestId("kopfleiste")).toHaveCount(0);
    expect(await page.evaluate(() => document.querySelector(".app")!.getBoundingClientRect().top)).toBe(0);
    // Drei weitere Seiten in einem Fall: nur bis das Dokument steht, die Leiste kommt mit der Sitzung (unter Last sonst über 60 s).
    for (const path of ["/edit", "/?editor=true", "/?edit=1"]) {
        await page.goto(path, { waitUntil: "domcontentloaded" });
        await expect(page.getByTestId("kopfleiste"), path).toBeVisible({ timeout: 30_000 });
    }
});

test("🔴 das Discord-Symbol: hell in Blurple, dunkel in Weiß, beide als offizielle Datei geladen (Betreiber 2026-10-09)", async ({
    page,
}) => {
    await open(page, GUEST);
    // Auf /edit ohne Anmeldung geht das Fenster von selbst auf (WI-0203).
    await expect(page.getByRole("dialog", { name: "Anmelden" })).toBeVisible();
    const knopf = page.getByTestId("anmelden-discord");
    const hell = knopf.locator("img.discord-zeichen__hell");
    const dunkel = knopf.locator("img.discord-zeichen__dunkel");
    await expect(hell).toBeVisible();
    await expect(dunkel).toBeHidden();
    await page.evaluate(() => {
        document.documentElement.dataset.theme = "dark";
    });
    await expect(dunkel).toBeVisible();
    await expect(hell).toBeHidden();
    for (const bild of [hell, dunkel]) {
        await expect
            .poll(() => bild.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
            .toBe(true);
    }
    // Das Zeichen ist Schmuck: Der Knopf heißt weiter nur „Mit Discord anmelden“.
    await expect(knopf).toHaveAccessibleName("Mit Discord anmelden");
});
