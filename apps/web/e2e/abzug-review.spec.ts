import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { devices, expect, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import type { AbzugSichtEinspielen, AbzugSichtErstellen } from "@avesmaps3d/shared";
import { abgleicheStand } from "./abgleiche-stub.ts";
import { EINGANG, abzugAntwort, abzugEinspielen, abzugErstellen, lauf, laufHolen } from "./abzug-stub.ts";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Bilder „Abzug für lokal“ im Datenabgleich (WI-0251; Vali 2026-10-24: „ja von stage und production, aber ohne die accounts, statistiken und alle
 * kartendaten auch“).
 *
 * 💣 Die Bilder prüfen NICHTS. Sie legen vor, damit ein Mensch entscheidet. Die Prüfungen stehen in `test/abzug.test.ts` und auf dem Server
 * in `abzug-routes.test.ts`, `abzug-einspielen.test.ts`, `abzug-holen.test.ts` und `abzug-regeln.test.ts`. Eine Ausnahme ist der Fall am Ende
 * („Abzug holen und einspielen“, Vali 2026-10-25): Er drückt den Knopf im Browser gegen Stubs und prüft, was der Browser schickt und zeigt.
 *
 * Gezeigt wird das Gebaute auf der ECHTEN Karte, in drei Größen (1920×1080, 1280×800, Telefon): lokal ohne Datei, mit passender Datei und Rückfrage,
 * mit Befund, mitten im Einspielen und danach; auf der Stage die Liste der Abzüge, die Rückfrage und der laufende Auftrag.
 *
 *   npm run review:abzug
 *
 * Ablage: `review/wi-0251/<szene>-<größe>.png` (`review/` ist nicht versioniert); `REVIEW_DIR` setzt einen anderen Ordner. `REVIEW_SZENEN` und
 * `REVIEW_GROESSEN` (Namen, mit Komma getrennt) beschränken die Bilder auf einen Teil.
 */

const OUTPUT = process.env["REVIEW_DIR"] ?? resolve(import.meta.dirname, "../../../review/wi-0251");
const NUR_SZENEN = process.env["REVIEW_SZENEN"]?.split(",");
const NUR_GROESSEN = process.env["REVIEW_GROESSEN"]?.split(",");
const BETREIBER = [...ADMIN_CAPABILITIES, "manage_system_settings", "run_legacy_sync", "run_abzug_einspielen"];

test.use({ actionTimeout: 30_000 });
test.describe.configure({ timeout: 600_000 });

type Stand = AbzugSichtErstellen | AbzugSichtEinspielen;
interface Szene {
    name: string;
    umgebung: "development" | "staging";
    stand: Stand;
    /** Was nach dem Öffnen gedrückt wird: eine Testkennung, oder ein Knopf mit Namen innerhalb einer Gruppe (die Handlung hinter einer Rückfrage). */
    druecke?: (string | { in: string; knopf: string })[];
}

const MINUTE = 60_000;
const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();

const SZENEN: Szene[] = [
    // Der Weg mit der Datei ist ein leiser Notweg (Vali 2026-10-25): zu steht nur der Link, erst sein Druck klappt ihn auf.
    { name: "lokal-leer", umgebung: "development", stand: abzugEinspielen() },
    { name: "lokal-datei", umgebung: "development", stand: abzugEinspielen(), druecke: ["abzug-notweg-knopf"] },
    {
        name: "lokal-frage",
        umgebung: "development",
        stand: abzugEinspielen({ eingang: EINGANG, lauf: lauf({ zustand: "fertig" }) }),
        druecke: ["abzug-notweg-knopf", "abzug-einspielen-knopf"],
    },
    // Selbst abholen (Vali 2026-10-25): ohne Schlüssel, mit Schlüssel und Rückfrage, mitten im Holen.
    { name: "holen-leer", umgebung: "development", stand: abzugEinspielen() },
    {
        name: "holen-frage",
        umgebung: "development",
        stand: abzugEinspielen({ schluessel: { staging: true, production: false } }),
        druecke: ["abzug-holen-knopf-staging"],
    },
    {
        name: "holen-laeuft",
        umgebung: "development",
        stand: abzugEinspielen({ schluessel: { staging: true, production: false }, lauf: laufHolen() }),
    },
    {
        name: "lokal-befund",
        umgebung: "development",
        stand: abzugEinspielen({
            eingang: {
                ...EINGANG,
                probleme: [
                    { code: "migrationen_lokal_alt", detail: "0218_abzug_lokal_auftrag" },
                    { code: "spalten", detail: "public.place.neue_spalte fehlt hier" },
                ],
            },
        }),
        druecke: ["abzug-notweg-knopf"],
    },
    {
        name: "lokal-laeuft",
        umgebung: "development",
        stand: abzugEinspielen({
            eingang: EINGANG,
            lauf: lauf({
                zustand: "laeuft",
                phase: "laden",
                tafel: "public.territory_area",
                fortschritt: 0.46,
                seit: ago(3 * MINUTE),
                ende: null,
                zeilen: null,
            }),
        }),
    },
    {
        name: "lokal-fehler",
        umgebung: "development",
        stand: abzugEinspielen({
            eingang: EINGANG,
            lauf: lauf({
                zustand: "fehler",
                phase: "laden",
                fortschritt: 0.46,
                zeilen: null,
                meldung:
                    "Das Laden von public.territory_area scheiterte (COPY abgelehnt: die Daten waren ungültig oder verletzen einen Fremdschlüssel). Nichts wurde verändert.",
            }),
        }),
    },
    { name: "lokal-fertig", umgebung: "development", stand: abzugEinspielen({ lauf: lauf() }) },
    {
        name: "lokal-medien-offen",
        umgebung: "development",
        stand: abzugEinspielen({
            eingang: EINGANG,
            lauf: lauf({ medien: { dateien: 3372, geschrieben: 3300, offen: 72, bytes: 199 * 1024 * 1024 } }),
        }),
    },
    {
        name: "lokal-medien-platz",
        umgebung: "development",
        stand: abzugEinspielen({
            eingang: { ...EINGANG, probleme: [{ code: "medien_platz", detail: "frei 0.4 GB, nötig etwa 1.2 GB" }] },
        }),
        druecke: ["abzug-notweg-knopf"],
    },
    {
        name: "lokal-medien-pruefen",
        umgebung: "development",
        stand: abzugEinspielen({
            eingang: EINGANG,
            lauf: lauf({
                zustand: "laeuft",
                phase: "medien",
                tafel: null,
                fortschritt: 0.62,
                seit: ago(3 * MINUTE),
                ende: null,
                zeilen: null,
            }),
        }),
    },
    { name: "stage-liste", umgebung: "staging", stand: abzugErstellen() },
    { name: "stage-frage", umgebung: "staging", stand: abzugErstellen(), druecke: ["abzug-erstellen-knopf"] },
    {
        name: "stage-schluessel-frage",
        umgebung: "staging",
        stand: abzugErstellen(),
        druecke: ["abzug-schluessel-anlegen"],
    },
    {
        name: "stage-schluessel-neu",
        umgebung: "staging",
        stand: abzugErstellen(),
        druecke: ["abzug-schluessel-anlegen", { in: "abzug-schluessel-frage", knopf: "Jetzt anlegen" }],
    },
    {
        name: "stage-laeuft",
        umgebung: "staging",
        stand: abzugErstellen({
            laufend: {
                jobId: "7e570000-0000-4000-8000-0000000000d1",
                state: "RUNNING",
                queuedAt: ago(4 * MINUTE),
                startedAt: ago(3 * MINUTE),
                phase: "packen",
                progress: 0.8,
                waitReason: null,
                ausgeloest: { art: "person", name: "Rondrikan" },
            },
            abzuege: [],
        }),
    },
];

const GROESSEN: { name: string; options: BrowserContextOptions }[] = [
    { name: "1920", options: { viewport: { width: 1920, height: 1080 } } },
    { name: "1280", options: { viewport: { width: 1280, height: 800 } } },
    { name: "telefon", options: { ...devices["Pixel 7"] } },
];

async function oeffne(
    browser: Browser,
    baseURL: string,
    szene: Szene,
    options: BrowserContextOptions,
): Promise<{ page: Page; close: () => Promise<void> }> {
    const context = await browser.newContext({
        baseURL,
        ...options,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.0.${String(120 + Math.floor(Math.random() * 100))}` },
    });
    const page = await context.newPage();
    await stubAdmin(page, {
        capabilities: BETREIBER,
        role: "operator",
        environment: szene.umgebung,
        person: { passkeyCount: 1 },
        answer: (call) => {
            // Wie der Server: Lokal steht im Datenabgleich allein der Abzug, die Zeilen der Legacy-Abgleiche kommen nicht mit.
            if (
                szene.umgebung === "development" &&
                call.method === "GET" &&
                call.path === "/api/admin/system/abgleiche"
            ) {
                return { status: 200, body: abgleicheStand({ zeilen: [] }) };
            }
            return abzugAntwort(szene.stand)(call);
        },
    });
    await page.goto("/?verwaltung=abgleiche");
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 60_000 });
    await page.getByTestId("abzug").waitFor({ timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready);
    for (const schritt of szene.druecke ?? []) {
        if (typeof schritt === "string") await page.getByTestId(schritt).click();
        else await page.getByTestId(schritt.in).getByRole("button", { name: schritt.knopf }).click();
    }
    await page.mouse.move(0, 0);
    await page.waitForTimeout(700);
    return { page, close: () => context.close() };
}

test("Bilder: Abzug für lokal in drei Größen", async ({ browser, baseURL }) => {
    mkdirSync(OUTPUT, { recursive: true });
    for (const groesse of GROESSEN.filter((g) => NUR_GROESSEN === undefined || NUR_GROESSEN.includes(g.name))) {
        for (const szene of SZENEN.filter((z) => NUR_SZENEN === undefined || NUR_SZENEN.includes(z.name))) {
            const { page, close } = await oeffne(browser, baseURL!, szene, groesse.options);
            await page.screenshot({ path: resolve(OUTPUT, `${szene.name}-${groesse.name}.png`) });
            await close();
        }
    }
});

test("Abzug holen und einspielen: Rückfrage, Aufruf mit der Quelle, Balken; der Schlüssel geht nur in die Datei des Servers", async ({
    browser,
    baseURL,
}) => {
    const context = await browser.newContext({
        baseURL: baseURL!,
        viewport: { width: 1280, height: 800 },
        extraHTTPHeaders: { "x-forwarded-for": `10.77.0.${String(120 + Math.floor(Math.random() * 100))}` },
    });
    const page = await context.newPage();
    const schluessel = `abz_${"Xq7".repeat(14)}A`;
    let stand: AbzugSichtEinspielen = abzugEinspielen({ schluessel: { staging: true, production: false } });
    const calls = await stubAdmin(page, {
        capabilities: BETREIBER,
        role: "operator",
        environment: "development",
        person: { passkeyCount: 1 },
        answer: (call) => {
            if (call.method === "GET" && call.path === "/api/admin/system/abgleiche") {
                return { status: 200, body: abgleicheStand({ zeilen: [] }) };
            }
            const antwort = abzugAntwort(() => stand)(call);
            // Wie der Server: Das Holen läuft danach, ein hinterlegter Schlüssel steht in der Sicht (als Wahrheitswert).
            if (call.method === "POST" && call.path === "/api/admin/system/abzug/holen") {
                stand = abzugEinspielen({ schluessel: { staging: true, production: true }, lauf: laufHolen() });
            }
            if (call.method === "POST" && call.path === "/api/admin/system/abzug/quelle") {
                stand = abzugEinspielen({ schluessel: { staging: true, production: true } });
            }
            return antwort;
        },
    });
    await page.goto("/?verwaltung=abgleiche");
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 60_000 });
    await page.getByTestId("abzug").waitFor({ timeout: 20_000 });

    // Der Weg mit der Datei ist ein leiser Notweg: zu steht nur der Link, von „Datei wählen“ ist nichts da; ein Druck klappt ihn auf und wieder zu.
    const notweg = page.getByTestId("abzug-notweg-knopf");
    await expect(notweg).toHaveText("Datei von Hand einspielen");
    await expect(notweg).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("abzug-lokal")).toHaveCount(0);
    await expect(page.getByTestId("abzug-datei-waehlen")).toHaveCount(0);
    await notweg.click();
    await expect(notweg).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("abzug-datei-waehlen")).toHaveCount(1);
    await notweg.click();
    await expect(page.getByTestId("abzug-datei-waehlen")).toHaveCount(0);

    // Production hat keinen Schlüssel: Der Knopf ist gesperrt, und der Satz sagt, was fehlt.
    await expect(page.getByTestId("abzug-holen-knopf-production")).toBeDisabled();
    await expect(page.getByTestId("abzug-holen-production")).toContainText(
        "Zuerst den Schlüssel von Production hinterlegen.",
    );
    await expect(page.getByTestId("abzug-holen-unter-staging")).toHaveText("Schlüssel hinterlegt");

    // Ein Wert ohne die Form eines Schlüssels geht nicht zum Server.
    await page.getByTestId("abzug-schluessel-feld-production").locator("input").fill("kein-schluessel");
    await page.getByTestId("abzug-schluessel-speichern-production").click();
    await expect(page.getByTestId("abzug-holen-meldung-production")).toContainText("Das ist kein Abzugs-Schlüssel");
    expect(calls.filter((call) => call.path === "/api/admin/system/abzug/quelle")).toEqual([]);

    // Ein guter Schlüssel geht an den Server und verschwindet aus dem Feld und aus der Seite.
    await page.getByTestId("abzug-schluessel-feld-production").locator("input").fill(schluessel);
    await page.getByTestId("abzug-schluessel-speichern-production").click();
    await expect(page.getByTestId("abzug-schluessel-entfernen-production")).toBeVisible();
    const gespeichert = calls.find((call) => call.path === "/api/admin/system/abzug/quelle");
    expect(gespeichert?.body).toMatchObject({ quelle: "production", schluessel });
    await expect(page.getByTestId("abzug-schluessel-feld-production").locator("input")).toHaveValue("");
    expect(await page.content()).not.toContain(schluessel);
    await expect(page.getByTestId("abzug-holen-knopf-production")).toBeEnabled();

    // Stage: Knopf, Rückfrage (noch kein Aufruf), bestätigen, dann der Aufruf mit der Quelle und der Balken der Datei.
    await page.getByTestId("abzug-holen-knopf-staging").click();
    await expect(page.getByTestId("abzug-holen-frage-staging")).toContainText(
        "Den neuesten Abzug von Stage holen und einspielen?",
    );
    expect(calls.filter((call) => call.path === "/api/admin/system/abzug/holen")).toEqual([]);
    await page
        .getByTestId("abzug-holen-frage-staging")
        .getByRole("button", { name: "Jetzt holen und einspielen" })
        .click();
    await expect(page.getByTestId("abzug-holen-balken-staging")).toBeVisible();
    const geholt = calls.find((call) => call.path === "/api/admin/system/abzug/holen");
    expect(geholt?.body).toMatchObject({ quelle: "staging" });
    await expect(page.getByTestId("abzug-holen-unter-staging")).toContainText("Datei holen");
    await expect(page.getByTestId("abzug-holen-unter-staging")).toContainText("900 MB von 2,1 GB");
    // Solange es läuft, geht kein zweites Holen, und der Weg der Datei bleibt zu: Die Lage steht in der Zeile der Quelle.
    await expect(page.getByTestId("abzug-holen-knopf-production")).toBeDisabled();
    await expect(page.getByTestId("abzug-datei-waehlen")).toHaveCount(0);
    await context.close();
});

test("Datei von Hand einspielen: läuft ein Einspielen der Datei, steht der Weg offen und der Link klappt nichts zu", async ({
    browser,
    baseURL,
}) => {
    const context = await browser.newContext({
        baseURL: baseURL!,
        viewport: { width: 1280, height: 800 },
        extraHTTPHeaders: { "x-forwarded-for": `10.77.0.${String(120 + Math.floor(Math.random() * 100))}` },
    });
    const page = await context.newPage();
    await stubAdmin(page, {
        capabilities: BETREIBER,
        role: "operator",
        environment: "development",
        person: { passkeyCount: 1 },
        answer: (call) => {
            if (call.method === "GET" && call.path === "/api/admin/system/abgleiche") {
                return { status: 200, body: abgleicheStand({ zeilen: [] }) };
            }
            const laeuft = lauf({
                zustand: "laeuft",
                phase: "laden",
                tafel: "public.territory_area",
                fortschritt: 0.46,
                seit: ago(3 * MINUTE),
                ende: null,
                zeilen: null,
            });
            return abzugAntwort(abzugEinspielen({ eingang: EINGANG, lauf: laeuft }))(call);
        },
    });
    await page.goto("/?verwaltung=abgleiche");
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 60_000 });
    await page.getByTestId("abzug").waitFor({ timeout: 20_000 });

    // Ohne einen Druck steht der Weg offen, weil gerade die Datei eingespielt wird: Lage, Balken, und der Link ist nur noch Anzeige.
    const notweg = page.getByTestId("abzug-notweg-knopf");
    await expect(notweg).toHaveAttribute("aria-expanded", "true");
    await expect(notweg).toBeDisabled();
    await expect(page.getByTestId("abzug-datei-waehlen")).toHaveCount(1);
    await expect(page.getByTestId("abzug-unter")).toContainText("Läuft seit");
    await expect(page.getByTestId("abzug-balken")).toBeVisible();
    await context.close();
});
