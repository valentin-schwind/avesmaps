import { expect, test, type Page } from "@playwright/test";
import { WEGFINDUNG_WERTE } from "@avesmaps3d/shared";
import { passkeyBereit } from "./passkey-stub.ts";
import { ADMIN_CAPABILITIES, stubAdmin, type AdminCall } from "./verwaltung-stub.ts";
import { wegfindungServer, wegfindungStand, type WegfindungServer } from "./wegfindung-stub.ts";

/**
 * Der Eintrag „Wegfindung“ der Systemsteuerung (WI-0153, Blatt `review/wi-0153/blatt.png`) am Rechner, gegen den Nachbau
 * (`wegfindung-stub.ts`); die echten Routen prüft `apps/server/test/wegfindung-einstellungen.test.ts`.
 *
 * Geprüft wird die Form, die der Betreiber abgenommen hat, und dass sie bedienbar ist: alle 51 Werte in drei Panelen, zwei
 * Säulen, das Feld im Goldenen Schnitt, der Satz unter dem Namen, an jeder Zeile die Folge einer Änderung, das Rücksetzzeichen
 * wach und still, der EINE Auslöser oben — und ein Verstellen mit Passkey, Revision und Rückweg auf die Vorgabe.
 *
 * 🔴 Dazu die Freigabe (Schnitt 6): Gespeichert ist nicht gerechnet. Die Zeile sagt, mit welcher Zahl weitergerechnet
 * wird, der Knopf wacht erst auf, wenn etwas ansteht, und nach dem Druck steht der Auftrag mit dem Wort der Warteschlange
 * und dem Kreis des Hauses in der Leiste.
 */

const OPERATOR = [...ADMIN_CAPABILITIES, "manage_system_settings"];

async function oeffnen(
    page: Page,
    server: WegfindungServer,
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
    await page.getByTestId("verwaltung-eintrag-wegfindung").click();
    await expect(page.getByTestId("wegfindung")).toBeVisible();
    return calls;
}

test("🔴 der Bestand steht da: 51 Werte in drei Panelen, zwei Säulen, Satz unter dem Namen, Folge an jeder Zeile", async ({
    page,
}) => {
    await oeffnen(page, wegfindungServer());
    const rumpf = page.getByTestId("wegfindung");
    // Je Wert ein Feld und ein Rücksetzzeichen; kein Wert fällt beim Umbauen heraus.
    await expect(rumpf.locator("input")).toHaveCount(WEGFINDUNG_WERTE.length);
    await expect(rumpf.locator('[data-testid^="wegfindung-zurueck-"]')).toHaveCount(WEGFINDUNG_WERTE.length);
    await expect(rumpf.locator(".fenster-karte")).toHaveCount(3);
    const inhalt = (await rumpf.innerText()).replace(/\s+/gu, " ");
    for (const wert of WEGFINDUNG_WERTE) expect(inhalt, wert.id).toContain(wert.name);
    for (const titel of ["Allgemeine Wegfindungseinstellungen", "Dijkstra-Einstellungen", "A* Einstellungen"])
        expect(inhalt).toContain(titel);
    // Die vier Zwischenüberschriften des A*-Panels stehen über beide Säulen.
    const abschnitte = rumpf.locator(".wegfindung__abschnitt");
    await expect(abschnitte).toHaveText(["Querfeldein", "Seefahrt", "Flug", "Wasser"]);
    // An JEDER Zeile steht, was eine Änderung nach sich zieht.
    await expect(rumpf.locator(".wegfindung__wirkt")).toHaveCount(WEGFINDUNG_WERTE.length);
    expect(inhalt).toContain("Braucht ein Neuberechnen des Wegenetzes: der Knopf oben.");
    expect(inhalt).toContain("Braucht eine neue Ableitung des Seegraphen, zwei bis fünf Minuten: der Knopf oben.");
    expect(inhalt).toContain("Gilt ohne Knopf, binnen fünf Sekunden.");

    // Zwei Säulen: der zweite Wert beginnt rechts neben dem ersten, auf gleicher Höhe.
    const zweiSaeulen = await rumpf
        .locator(".wegfindung__werte")
        .first()
        .evaluate((liste: HTMLElement) => {
            const [erste, zweite] = liste.querySelectorAll<HTMLElement>(".wegfindung__wert");
            if (erste === undefined || zweite === undefined) return false;
            const a = erste.getBoundingClientRect();
            const b = zweite.getBoundingClientRect();
            return b.left > a.right - 1 && Math.abs(b.top - a.top) < 4;
        });
    expect(zweiSaeulen, "zwei Säulen").toBe(true);
    /*
     * 🔴 Das Feld beginnt in JEDER Zeile einer Säule an derselben Stelle (Design Guide §8); gemessen wird je Säule, denn
     * die beiden Säulen stehen nebeneinander und haben naturgemäß verschiedene x.
     *
     * 🪤 Der Anteil ist nicht genau 0,618. Das Raster gibt der Namensspalte `minmax(0, 61.8%)` — das ist ihre OBERGRENZE;
     * weil Feld, Einheit und Zeichen feste Breiten haben (96 px, 92 px, var(--space-24)), drückt das Paket sie in einer
     * schmalen Säule zusammen. So steht es auch auf dem abgenommenen Blatt. Geprüft wird darum, was die Regel wirklich
     * will: dass die Felder fluchten und das Feld jenseits der Mitte beginnt.
     */
    const fluchten = await rumpf
        .locator(".wegfindung__werte")
        .first()
        .evaluate((liste: HTMLElement) => {
            const zeilen = [...liste.querySelectorAll<HTMLElement>(".wegfindung__wert")];
            const masse = zeilen.map((zeile) => {
                const name = zeile.querySelector(".wegfindung__name")!.getBoundingClientRect();
                const feld = zeile.querySelector(".wegfindung__feld")!.getBoundingClientRect();
                return { saeule: Math.round(name.left), feld: Math.round(feld.left), breite: zeile.clientWidth };
            });
            const saeulen = [...new Set(masse.map((mass) => mass.saeule))];
            const erste = zeilen[0]!;
            const satz = erste.querySelector(".wegfindung__satz")!.getBoundingClientRect();
            const feld = erste.querySelector(".wegfindung__feld")!.getBoundingClientRect();
            const einheit = erste.querySelector(".wegfindung__einheit")!.getBoundingClientRect();
            const zeichen = erste.querySelector('[data-testid^="wegfindung-zurueck-"]')!.getBoundingClientRect();
            return {
                saeulen: saeulen.length,
                // Je Säule: wie viele verschiedene x die Felder haben (soll 1 sein).
                flattern: saeulen.map(
                    (x) => new Set(masse.filter((mass) => mass.saeule === x).map((mass) => mass.feld)).size,
                ),
                anteil: (feld.left - masse[0]!.saeule) / masse[0]!.breite,
                satzDarunter: satz.top >= feld.bottom,
                zeichenAmEnde: zeichen.left >= einheit.right - 1,
            };
        });
    expect(fluchten.saeulen, "zwei Säulen").toBe(2);
    expect(fluchten.flattern, "das Feld flattert innerhalb einer Säule").toEqual([1, 1]);
    expect(fluchten.satzDarunter, "der Satz steht nicht unter dem Namen").toBe(true);
    expect(fluchten.zeichenAmEnde, "das Rücksetzen steht nicht am Zeilenende").toBe(true);
    expect(fluchten.anteil, "das Feld beginnt vor der Mitte der Säule").toBeGreaterThan(0.45);
    expect(fluchten.anteil).toBeLessThanOrEqual(0.62);

    // Der EINE Auslöser steht oben und ruht, mit seinem Grund; kein zweiter im Reiter.
    await expect(rumpf.locator('[data-testid="wegfindung-rechnen"]')).toHaveCount(1);
    const knopf = page.getByTestId("wegfindung-rechnen");
    await expect(knopf).toBeDisabled();
    const oben = await rumpf.evaluate((element: HTMLElement) => {
        const leiste = element.querySelector('[data-testid="wegfindung-netz"]')!.getBoundingClientRect();
        const karte = element.querySelector(".fenster-karte")!.getBoundingClientRect();
        return leiste.bottom <= karte.top + 1;
    });
    expect(oben, "die Leiste steht nicht über den Panelen").toBe(true);
    // Keine Kreise vor den Namen (Betreiber 2026-10-15), und nichts läuft, also auch keiner in der Leiste.
    await expect(rumpf.locator(".avm-kreis")).toHaveCount(0);
    // Ohne Abweichung ruhen alle Rücksetzzeichen, und die Leiste sagt es.
    await expect(rumpf.locator('[data-testid^="wegfindung-zurueck-"]:not([disabled])')).toHaveCount(0);
    await expect(page.getByTestId("wegfindung-netz")).toContainText("Jeder Wert steht auf seiner Vorgabe.");
    // Die Stufe steht im Fuß des Fensters.
    await expect(page.getByTestId("systemsteuerung-fenster").locator(".avm-fenster__fuss-hinweis")).toContainText(
        "Passkey",
    );
});

test("🔴 verstellen: Passkey im Moment, Revision hinaus, danach „statt 0,02“, das Zeichen wach und „1 abweichend“ an der Schiene", async ({
    page,
}) => {
    const passkey = await passkeyBereit(page);
    const server = wegfindungServer();
    await oeffnen(page, server, {
        answer: (call) =>
            call.method === "POST" && passkey.verifiziert() === 0
                ? {
                      status: 403,
                      body: { error: { code: "reauth_required", message: "x", details: { need: "passkey" } } },
                  }
                : undefined,
    });
    const feld = page.getByTestId("wegfindung-feld-endSnap").locator("input");
    await expect(feld).toHaveValue("0,02");
    await feld.fill("0,03");
    await feld.press("Enter");
    // Kein Dialog mit Grund, aber die Stufe S: der Browser fragt den Passkey (wie am Kästchen der Inhalte).
    const bestaetigen = page.getByRole("dialog", { name: "Kurz bestätigen" });
    await expect(bestaetigen).toBeVisible();
    await bestaetigen.getByTestId("bestaetigen-passkey").click();
    await expect(bestaetigen).toBeHidden();

    await expect(page.getByTestId("wegfindung-endSnap")).toContainText("statt 0,02");
    expect(server.posts.at(-1)).toMatchObject({ baseRevision: 4, id: "endSnap", value: 0.03 });
    expect(passkey.verifiziert()).toBe(1);
    await expect(page.getByTestId("wegfindung-zurueck-endSnap")).toBeEnabled();
    // Die Meilen rechnen mit dem neuen Wert, und die Schiene zählt die Abweichung.
    await expect(page.getByTestId("wegfindung-endSnap")).toContainText("0,09 Meilen");
    await expect(page.getByTestId("verwaltung-eintrag-wegfindung")).toContainText("1 abweichend");
    await expect(page.getByTestId("wegfindung-netz")).toContainText("1 Wert ist geändert und noch nicht gerechnet.");
    // 🔴 Gespeichert ist nicht gerechnet: Die Zeile nennt die Zahl, mit der die Wegfindung weiterrechnet.
    await expect(page.getByTestId("wegfindung-offen-endSnap")).toHaveText("noch nicht gerechnet, es gilt 0,02");
    await expect(page.getByTestId("wegfindung-netz")).toContainText(
        "rechnet die Wegfindung für diese Werte unverändert weiter",
    );

    // Zurück auf die Vorgabe: die Abweichung ist weg, das Zeichen ruht wieder.
    await page.getByTestId("wegfindung-zurueck-endSnap").click();
    await expect(page.getByTestId("wegfindung-endSnap")).not.toContainText("statt 0,02");
    expect(server.posts.at(-1)).toMatchObject({ id: "endSnap", value: null });
    await expect(page.getByTestId("wegfindung-zurueck-endSnap")).toBeDisabled();
    await expect(feld).toHaveValue("0,02");
});

test("🔴 ein Wert ohne Knopf gilt schon: keine Aufforderung, kein zweiter Satz, der Knopf bleibt still", async ({
    page,
}) => {
    const server = wegfindungServer();
    await oeffnen(page, server);
    // Zellbreite querfeldein (Folge `sofort`): Der Dienst liest sie, ohne etwas zu bauen.
    const feld = page.getByTestId("wegfindung-feld-cellUnits").locator("input");
    await feld.fill("0,3");
    await feld.press("Enter");
    await expect(page.getByTestId("wegfindung-cellUnits")).toContainText("statt 0,25");
    // 🔴 Kein „noch nicht gerechnet“, und der Knopf oben ruht weiter mit seinem Grund.
    await expect(page.getByTestId("wegfindung-offen-cellUnits")).toHaveCount(0);
    await expect(page.getByTestId("wegfindung-rechnen")).toBeDisabled();
    await expect(page.getByTestId("wegfindung-netz")).toContainText("Nichts freizugeben.");
});

test("🔴 eine Zahl außerhalb der Grenzen geht nicht hinaus, sondern steht am Feld", async ({ page }) => {
    const server = wegfindungServer();
    await oeffnen(page, server);
    const feld = page.getByTestId("wegfindung-feld-endSnap").locator("input");
    await feld.fill("2");
    await feld.press("Enter");
    // Die Grenzen sind die des Registers, Wert für Wert (Schnitt 5), nicht mehr ein Zehntel bis das Zehnfache.
    await expect(page.getByTestId("wegfindung-endSnap")).toContainText("Erlaubt ist 0,001 bis 0,05.");
    expect(server.posts).toEqual([]);
});

test("🔴 freigeben: der Knopf wacht erst mit einer offenen Änderung auf, schickt nur die Revision und reiht den Auftrag ein", async ({
    page,
}) => {
    const passkey = await passkeyBereit(page);
    const server = wegfindungServer();
    // Stufe S: Der erste Druck auf den Knopf läuft in die Nachfrage des Browsers, wie beim Verstellen.
    await oeffnen(page, server, {
        answer: (call) =>
            call.path.endsWith("/freigeben") && passkey.verifiziert() === 0
                ? {
                      status: 403,
                      body: { error: { code: "reauth_required", message: "x", details: { need: "passkey" } } },
                  }
                : undefined,
    });
    const knopf = page.getByTestId("wegfindung-rechnen");
    // Nichts offen: Der Knopf ruht mit seinem Grund, und der Grund steht sichtbar daneben (Guide §7).
    await expect(knopf).toBeDisabled();
    await expect(page.getByTestId("wegfindung-netz")).toContainText("Nichts freizugeben.");

    const feld = page.getByTestId("wegfindung-feld-endSnap").locator("input");
    await feld.fill("0,03");
    await feld.press("Enter");
    await expect(page.getByTestId("wegfindung-endSnap")).toContainText("statt 0,02");
    await expect(knopf).toBeEnabled();

    await knopf.click();
    const bestaetigen = page.getByRole("dialog", { name: "Kurz bestätigen" });
    await expect(bestaetigen).toBeVisible();
    await bestaetigen.getByTestId("bestaetigen-passkey").click();
    await expect(bestaetigen).toBeHidden();

    // Der Knopf schickt nur Vorgang und Revision — keine Werte.
    expect(Object.keys(server.freigaben.at(-1) ?? {}).sort()).toEqual(["baseRevision", "operationId"]);
    // Danach ist nichts mehr offen, die Zeile schweigt, und der Auftrag steht mit Wort und Kreis in der Leiste.
    await expect(page.getByTestId("wegfindung-netz")).toContainText("Gespeichert und gerechnet sind gleich.");
    await expect(page.getByTestId("wegfindung-offen-endSnap")).toHaveCount(0);
    await expect(page.getByTestId("wegfindung-auftrag")).toContainText("Auftrag wartet");
    await expect(page.getByTestId("wegfindung-auftrag").locator(".avm-kreis")).toHaveCount(1);
    await expect(page.getByTestId("wegfindung-zuletzt")).toContainText("zuletzt gerechnet");
    expect(passkey.verifiziert()).toBe(1);
    // Der verstellte Wert steht weiter im Feld, jetzt aber als gerechneter Stand.
    await expect(feld).toHaveValue("0,03");
    await expect(knopf).toBeDisabled();
});

test("ohne das Recht „Systemschalter“ ruhen die Felder, der Satz steht einmal oben", async ({ page }) => {
    await oeffnen(page, wegfindungServer(), { capabilities: ADMIN_CAPABILITIES });
    await expect(page.getByTestId("wegfindung-nur-lesen")).toContainText("Systemschalter");
    await expect(page.getByTestId("wegfindung-feld-endSnap").locator("input")).toBeDisabled();
    await expect(page.getByTestId("wegfindung-zurueck-endSnap")).toBeDisabled();
    await expect(page.getByTestId("wegfindung-rechnen")).toBeDisabled();
    await expect(page.getByTestId("wegfindung-netz")).toContainText("Dafür fehlt das Recht.");
    await expect(page.getByTestId("wegfindung-nur-lesen")).toContainText("Systemschalter");
});

test("🔴 veralteter Seegraph: die Leiste sagt es, der EINE Knopf wacht auf und reiht die Ableitung vor dem Neuladen ein", async ({
    page,
}) => {
    // Betreiber 2026-10-18: „Seewege“ über „Wegenetz neu berechnen“, kein zweiter Knopf (WI-0153 7b).
    const passkey = await passkeyBereit(page);
    const server = wegfindungServer({
        ...wegfindungStand(),
        seaGraph: { derivedAt: "2026-10-10T20:31:00.000Z", stale: true, job: null, jobState: null },
    });
    await oeffnen(page, server, {
        answer: (call) =>
            call.path.endsWith("/freigeben") && passkey.verifiziert() === 0
                ? {
                      status: 403,
                      body: { error: { code: "reauth_required", message: "x", details: { need: "passkey" } } },
                  }
                : undefined,
    });
    const rumpf = page.getByTestId("wegfindung");
    await expect(rumpf.locator('[data-testid="wegfindung-rechnen"]')).toHaveCount(1);
    await expect(page.getByTestId("wegfindung-seegraph")).toHaveText(
        "Meere, Seen oder Häfen haben sich geändert: Der Seegraph braucht eine neue Ableitung.",
    );
    await expect(page.getByTestId("wegfindung-seegraph-kosten")).toContainText("zwei bis fünf Minuten");
    const knopf = page.getByTestId("wegfindung-rechnen");
    await expect(knopf).toBeEnabled();
    await expect(knopf).toContainText("Wegenetz neu berechnen");

    await knopf.click();
    const bestaetigen = page.getByRole("dialog", { name: "Kurz bestätigen" });
    await bestaetigen.getByTestId("bestaetigen-passkey").click();
    await expect(bestaetigen).toBeHidden();

    expect(Object.keys(server.freigaben.at(-1) ?? {}).sort()).toEqual(["baseRevision", "operationId"]);
    // Danach wartet die Ableitung mit Wort und Kreis, der Satz zum veralteten Graphen ist weg, und der Knopf ruht.
    await expect(page.getByTestId("wegfindung-seegraph")).toHaveCount(0);
    await expect(page.getByTestId("wegfindung-seegraph-auftrag")).toContainText("Seegraph wartet");
    await expect(page.getByTestId("wegfindung-seegraph-auftrag").locator(".avm-kreis")).toHaveCount(1);
    await expect(knopf).toBeDisabled();
});
