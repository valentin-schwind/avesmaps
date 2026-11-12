import { expect, test, type Page } from "@playwright/test";
import { WETTERMODELL_URL, WETTERMODELL_WERTE } from "@avesmaps3d/shared";
import { passkeyBereit, type PasskeyStub } from "./passkey-stub.ts";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";
import { stubWetterLeseweg, wettermodellServer, type WettermodellServer } from "./wettermodell-stub.ts";

/**
 * Der Reiter „Wettermodell“ der Systemsteuerung (WI-0288 Stufe 4; Probierseite `review/wetter-editor/`, Abschnitt Systemsteuerung), nur in
 * PC-Größe (Betreiber 2026-11-07: „wir können ja mal nur PC groß machen“). 🔴 Kein Test schreibt in eine Datenbank: Jede schreibende Anfrage
 * an `/api` ist abgefangen, das Wettermodell kommt aus einem Nachbau (`wettermodell-stub.ts`); den echten Weg prüft
 * `apps/server/test/wetter.test.ts` auf einem Wegwerf-Cluster.
 *
 * Problemfälle: Der Eintrag fehlt unter „Höhenmodell“ oder trägt die rohe Kennung; ein Wert der Tafel fehlt; das Feld flattert; eine Zeile
 * sagt nicht, was eine Änderung nach sich zieht; Verstellen geht ohne Passkey oder ohne Revision; ↺ wacht nicht auf; Regen und Schnee stehen
 * als Abstand im Feld; eine abgewiesene Zahl bleibt still; „Alle zurücksetzen“ lässt etwas stehen.
 */

test.use({ viewport: { width: 1600, height: 900 } });

const BETREIBER = [...ADMIN_CAPABILITIES, "manage_system_settings", "manage_weather_model"];

async function oeffnen(
    page: Page,
    server: WettermodellServer,
    capabilities: string[] = BETREIBER,
): Promise<{ passkey: PasskeyStub }> {
    // 🔴 Nichts Schreibendes erreicht den geteilten Server (Besuchszählung, Fehlerberichte …): Die Nachbauten danach gewinnen für ihre Wege.
    await page.route("**/api/**", (route) =>
        route.request().method() === "GET" ? route.fallback() : route.fulfill({ status: 204, body: "" }),
    );
    const passkey = await passkeyBereit(page);
    await stubAdmin(page, {
        capabilities,
        role: capabilities.includes("manage_weather_model") ? "operator" : "admin",
        person: { passkeyCount: 1 },
        // Stufe S: Der erste Schreibweg läuft in die Nachfrage des Browsers, danach gilt der frische Passkey.
        answer: (call) =>
            call.method === "POST" && call.path === WETTERMODELL_URL && passkey.verifiziert() === 0
                ? {
                      status: 403,
                      body: { error: { code: "reauth_required", message: "x", details: { need: "passkey" } } },
                  }
                : server.handle(call),
    });
    await stubWetterLeseweg(page, server);
    await page.goto("/edit");
    await page.getByTestId("kopfleiste-menue").click();
    await page.getByTestId("menue-systemsteuerung").click();
    await expect(page.getByRole("dialog", { name: "Systemsteuerung" })).toBeVisible();
    await page.getByTestId("verwaltung-eintrag-wettermodell").click();
    await expect(page.getByTestId("wettermodell-leiste")).toBeVisible();
    return { passkey };
}

async function passkeyBestaetigen(page: Page): Promise<void> {
    const bestaetigen = page.getByRole("dialog", { name: "Kurz bestätigen" });
    await expect(bestaetigen).toBeVisible();
    await bestaetigen.getByTestId("bestaetigen-passkey").click();
    await expect(bestaetigen).toBeHidden();
}

const feld = (page: Page, id: string) => page.getByTestId(`wettermodell-feld-${id}`).locator("input");

test("🔴 der Eintrag steht unter „Höhenmodell“, vier Reiter tragen alle 44 Werte in der Hausform, jede Zeile mit ihrer Folge", async ({
    page,
}) => {
    await oeffnen(page, wettermodellServer());
    // Direkt unter dem Höhenmodell, mit seinem Namen (nicht der rohen Kennung) und dem Fuß des Reiters.
    const schiene = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-testid^="verwaltung-eintrag-"]')].map((e) =>
            e.dataset["testid"]!.replace("verwaltung-eintrag-", ""),
        ),
    );
    expect(schiene.indexOf("wettermodell")).toBe(schiene.indexOf("hoehenmodell") + 1);
    await expect(page.getByTestId("verwaltung-eintrag-wettermodell")).toContainText("Wettermodell");
    const fenster = page.getByTestId("systemsteuerung-fenster");
    await expect(fenster.locator(".avm-fenster__fuss-hinweis")).toContainText("Passkey");
    await expect(fenster.locator(".avm-fenster__fuss-hinweis")).not.toContainText("wettermodell");

    const rumpf = page.getByTestId("wettermodell");
    await expect(rumpf.getByRole("tab")).toHaveText(["Wind und Wolken", "Partikel", "Licht und Schnee", "Leistung"]);
    // Der EINE Auslöser steht oben in der Leiste und ruht, solange nichts abweicht; ↺ ruht überall.
    await expect(page.getByTestId("wettermodell-leiste")).toContainText("Alle Werte stehen auf der Vorgabe.");
    await expect(page.getByTestId("wettermodell-alle")).toBeDisabled();
    await expect(rumpf.locator('[data-testid="wettermodell-alle"]')).toHaveCount(1);
    await expect(rumpf.locator('[data-testid^="wettermodell-zurueck-"]:not([disabled])')).toHaveCount(0);

    // Alle Werte über die vier Reiter; an jeder Zeile die Folge einer Änderung.
    let gesehen = 0;
    for (const reiter of ["Wind und Wolken", "Partikel", "Licht und Schnee", "Leistung"]) {
        await rumpf.getByRole("tab", { name: reiter }).click();
        const zeilen = rumpf.locator(".wettermodell__wert");
        const n = await zeilen.count();
        await expect(rumpf.locator('[data-testid^="wettermodell-folge-"]')).toHaveCount(n);
        gesehen += n;
    }
    expect(gesehen).toBe(WETTERMODELL_WERTE.length);
    // Takt, gröbste Auflösung, Ausdehnung und Raster greifen erst nach dem Neuladen, in der Akzentfarbe.
    await expect(page.getByTestId("wettermodell-folge-takt")).toHaveText("Greift nach dem Neuladen der Karte.");
    await expect(page.getByTestId("wettermodell-folge-fpsGrob")).toHaveText("Wirkt sofort.");
    await expect(page.getByTestId("wettermodell-panel-detailstufen")).toContainText("1 Einheit sind 3 km");

    // Die Hausform (Design Guide §8): zwei Säulen, das Feld fluchtet je Säule und beginnt jenseits der Mitte, ↺ am Zeilenende.
    await rumpf.getByRole("tab", { name: "Wind und Wolken" }).click();
    const form = await page
        .getByTestId("wettermodell-panel-wind")
        .locator(".wettermodell__werte")
        .evaluate((liste: HTMLElement) => {
            const zeilen = [...liste.querySelectorAll<HTMLElement>(".wettermodell__wert")];
            const masse = zeilen.map((zeile) => ({
                saeule: Math.round(zeile.querySelector(".wettermodell__name")!.getBoundingClientRect().left),
                feld: Math.round(zeile.querySelector(".wettermodell__feld")!.getBoundingClientRect().left),
                breite: zeile.clientWidth,
            }));
            const saeulen = [...new Set(masse.map((mass) => mass.saeule))];
            const erste = zeilen[0]!;
            const feld = erste.querySelector(".wettermodell__feld")!.getBoundingClientRect();
            const satz = erste.querySelector(".wettermodell__satz")!.getBoundingClientRect();
            const einheit = erste.querySelector(".wettermodell__einheit")!.getBoundingClientRect();
            const zeichen = erste.querySelector('[data-testid^="wettermodell-zurueck-"]')!.getBoundingClientRect();
            return {
                saeulen: saeulen.length,
                flattern: saeulen.map((x) => new Set(masse.filter((m) => m.saeule === x).map((m) => m.feld)).size),
                anteil: (feld.left - masse[0]!.saeule) / masse[0]!.breite,
                satzDarunter: satz.top >= feld.bottom,
                zeichenAmEnde: zeichen.left >= einheit.right - 1,
            };
        });
    expect(form.saeulen, "zwei Säulen").toBe(2);
    expect(form.flattern, "das Feld flattert innerhalb einer Säule").toEqual([1, 1]);
    expect(form.satzDarunter, "der Satz steht nicht unter dem Namen").toBe(true);
    expect(form.zeichenAmEnde, "↺ steht nicht am Zeilenende").toBe(true);
    expect(form.anteil).toBeGreaterThan(0.45);
    expect(form.anteil).toBeLessThanOrEqual(0.62);
});

test("🔴 verstellen: Passkey im Moment, Revision hinaus, ↺ wach, Reiter und Schiene zählen; ↺ setzt zurück", async ({
    page,
}) => {
    const server = wettermodellServer();
    const { passkey } = await oeffnen(page, server);
    const conf = feld(page, "conf");
    await expect(conf).toHaveValue("1,35");
    await conf.fill("2");
    await conf.press("Enter");
    await passkeyBestaetigen(page);

    await expect(page.getByTestId("wettermodell-vorgabe-conf")).toHaveText("Vorgabe 1,35 ×");
    expect(server.posts.at(-1)).toMatchObject({ id: "conf", value: 2, baseRevision: 3 });
    expect(passkey.verifiziert()).toBe(1);
    await expect(conf).toHaveValue("2,00");
    await expect(page.getByTestId("wettermodell-zurueck-conf")).toBeEnabled();
    await expect(page.getByTestId("wettermodell-conf")).toHaveClass(/is-geaendert/);
    await expect(page.getByTestId("wettermodell-leiste")).toContainText("1 Wert weicht von der Vorgabe ab.");
    await expect(page.getByTestId("wettermodell-alle")).toBeEnabled();
    await expect(page.getByRole("tab", { name: "Wind und Wolken (1)" })).toBeVisible();
    await expect(page.getByTestId("verwaltung-eintrag-wettermodell")).toContainText("1 abweichend");

    await page.getByTestId("wettermodell-zurueck-conf").click();
    await expect(page.getByTestId("wettermodell-zurueck-conf")).toBeDisabled();
    expect(server.posts.at(-1)).toMatchObject({ id: "conf", value: null, baseRevision: 4 });
    await expect(conf).toHaveValue("1,35");
    await expect(page.getByTestId("wettermodell-vorgabe-conf")).toHaveCount(0);
    await expect(page.getByTestId("wettermodell-leiste")).toContainText("Alle Werte stehen auf der Vorgabe.");
});

test("🔴 Regen und Schnee „nah“ stehen als Zoomstufe im Feld, gespeichert wird der Abstand der Kamera", async ({
    page,
}) => {
    const server = wettermodellServer();
    await oeffnen(page, server);
    await page.getByTestId("wettermodell").getByRole("tab", { name: "Partikel" }).click();
    const nah = feld(page, "nahAb");
    await expect(nah).toHaveValue("4,0");
    await expect(feld(page, "nahVoll")).toHaveValue("4,9");
    await expect(page.getByTestId("wettermodell-nahAb")).toContainText(
        "Abstand der Kamera 85 Einh., gerechnet für 900 px Kartenhöhe",
    );
    await nah.fill("4,5");
    await nah.press("Enter");
    await passkeyBestaetigen(page);
    await expect(page.getByTestId("wettermodell-nahAb")).toContainText("Abstand der Kamera 59,66 Einh.");
    expect(server.posts.at(-1)).toMatchObject({ id: "nahAb", value: 59.66 });
    await expect(nah).toHaveValue("4,5");
});

test("🔴 eine abgewiesene Zahl steht am Feld: Grenzen und Paare vor dem Senden, ein 400 des Servers danach", async ({
    page,
}) => {
    const server = wettermodellServer();
    await oeffnen(page, server);
    const conf = feld(page, "conf");
    await conf.fill("99");
    await conf.press("Enter");
    await expect(page.getByTestId("wettermodell-problem-conf")).toHaveText("Erlaubt ist 0,00 bis 8,00.");
    await expect(conf).toHaveAttribute("aria-invalid", "true");
    await expect(conf).toHaveValue("99");
    expect(server.posts).toEqual([]);

    // Der Server weist ab (eine andere Sitzung, ein älterer Stand): Der Satz steht am Feld, die getippte Zahl bleibt.
    server.antwortBei("schicht", {
        status: 400,
        body: {
            error: {
                code: "value_out_of_range",
                message: "x",
                details: { min: 500, max: 20000, vorgabe: 1800 },
            },
        },
    });
    const schicht = feld(page, "schicht");
    await schicht.fill("3000");
    await schicht.press("Enter");
    await passkeyBestaetigen(page);
    await expect(page.getByTestId("wettermodell-problem-schicht")).toHaveText("Erlaubt ist 500 bis 20.000.");
    await expect(schicht).toHaveValue("3000");
    await expect(page.getByTestId("wettermodell-zurueck-schicht")).toBeDisabled();

    // Ein Paar: Die Mittelstufe muss weiter draußen einblenden, als sie voll ist.
    await page.getByTestId("wettermodell").getByRole("tab", { name: "Leistung" }).click();
    const mittelVoll = feld(page, "mittelVoll");
    await mittelVoll.fill("950");
    await mittelVoll.press("Enter");
    await expect(page.getByTestId("wettermodell-problem-mittelVoll")).toHaveText(
        "Muss kleiner bleiben als „Mittelstufe blendet ein ab“ (900 Einh.).",
    );
    expect(server.posts).toHaveLength(1);
});

test("🔴 „Alle zurücksetzen“: der eine Auslöser oben schickt je Abweichung null, danach steht alles auf der Vorgabe", async ({
    page,
}) => {
    const server = wettermodellServer({ conf: 2, takt: 20 });
    await oeffnen(page, server);
    await expect(page.getByTestId("wettermodell-leiste")).toContainText("2 Werte weichen von der Vorgabe ab.");
    await expect(page.getByTestId("wettermodell").getByRole("tab", { name: "Leistung (1)" })).toBeVisible();
    await page.getByTestId("wettermodell-alle").click();
    await passkeyBestaetigen(page);
    await expect(page.getByTestId("wettermodell-leiste")).toContainText("Alle Werte stehen auf der Vorgabe.");
    expect(server.posts.map((p) => [p["id"], p["value"], p["baseRevision"]])).toEqual([
        ["conf", null, 3],
        ["takt", null, 4],
    ]);
    await expect(page.getByTestId("wettermodell-alle")).toBeDisabled();
    await expect(page.getByTestId("verwaltung-eintrag-wettermodell")).not.toContainText("abweichend");
});

test("ohne das Recht: sehen mit dem Betrieb, verstellen nicht", async ({ page }) => {
    const server = wettermodellServer({ conf: 2 });
    await oeffnen(page, server, [...ADMIN_CAPABILITIES]);
    await expect(page.getByTestId("wettermodell-nur-lesen")).toHaveText(
        "Verstellen braucht das Recht „Wettermodell verstellen“.",
    );
    await expect(feld(page, "conf")).toBeDisabled();
    await expect(page.getByTestId("wettermodell-zurueck-conf")).toBeDisabled();
    await expect(page.getByTestId("wettermodell-alle")).toBeDisabled();
});
