import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { defineConfig, devices, webkit, type PlaywrightTestConfig } from "@playwright/test";
import { hinweisGesehen } from "./e2e/erster-besuch.ts";
import { BUILD_SPEC, NUR_GENANNT, SHEET_SPECS } from "./e2e/spec-auswahl.ts";
import { zeit } from "./e2e/zeitfaktor.ts";

/** Ein Eintrag von `webServer`; Playwright exportiert den Typ nicht selbst. */
type WebServer = Exclude<NonNullable<PlaywrightTestConfig["webServer"]>, readonly unknown[]>;

/**
 * WebKit ist ein eigener Download (`npx playwright install webkit`). Fehlt er, fehlt das iPhone-Profil, und die
 * Specs darin laufen weiter in Chromium; ein Test, der wegen eines fehlenden Browsers rot wird, wäre keine Aussage.
 */
const webkitInstalled = ((): boolean => {
    try {
        return existsSync(webkit.executablePath());
    } catch {
        return false;
    }
})();

/**
 * Der Port der Test-Vite. 🪤 `reuseExistingServer` nimmt JEDE Vite, die dort schon lauscht - auch die eines anderen Worktrees mit anderem
 * Code. Parallele Sitzungen und Agenten wählen deshalb je einen eigenen Port: `E2E_PORT=4191 npx playwright test …` (2026-10-04: drei
 * Worktrees maßen gegeneinander, ein Wächter sah die alte Pille). 🪤 Kein von Browsern gesperrter Port: 4190 (sieve) lädt WebKit nie,
 * der Test läuft dann bis zum Timeout im ersten `goto`.
 */
const E2E_PORT = Number(process.env["E2E_PORT"] ?? "4178");

/**
 * `E2E_SERVER=1` (WI-0189, Review O2-05): Playwright startet zusätzlich den Fastify DIESES Checkouts auf `E2E_SERVER_PORT` (Vorgabe
 * `E2E_PORT` + 1000), ohne `--watch`, und die Test-Vite reicht `/api` dorthin statt an den geteilten Server auf 3000. Sonst prüft eine
 * Arbeitskopie ihren Web-Code gegen fremden Servercode, der neu startet, sobald irgendeine Sitzung eine Serverdatei speichert.
 * Die Umgebung kommt aus der `.env` des Hauptcheckouts; `TILE_ROOT` und `MEDIA_ROOT` aus dem Aufruf (wie `start-local-stack.ps1`
 * sie setzt), sonst meldet `e2e/umgebung.ts` sie als fehlend. Jeder zusätzliche Fastify belegt Verbindungen im lokalen Cluster.
 * Er liest `@avesmaps3d/shared` über `scripts/dev/shared-aus-quellen.mjs` aus den Quellen dieses Checkouts, auch in einer Arbeitskopie.
 */
const E2E_SERVER_PORT = Number(process.env["E2E_SERVER_PORT"] ?? String(E2E_PORT + 1000));
const eigenerServer = ((): WebServer | undefined => {
    if (process.env["E2E_SERVER"] !== "1") return undefined;
    const haupt = dirname(
        resolve(
            execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
                encoding: "utf8",
            }).trim(),
        ),
    );
    return {
        command: `node --import ../../scripts/dev/shared-aus-quellen.mjs --env-file-if-exists=${join(haupt, ".env")} ../server/src/server.ts`,
        url: `http://127.0.0.1:${String(E2E_SERVER_PORT)}/health`,
        reuseExistingServer: false,
        timeout: 120_000,
        env: { PORT: String(E2E_SERVER_PORT) },
    };
})();
/** Der Fastify, an den die Test-Vite `/api` reicht; `e2e/umgebung.ts` meldet ihn zu Beginn des Laufs. */
process.env["E2E_API_PORT"] = eigenerServer === undefined ? (process.env["PORT"] ?? "3000") : String(E2E_SERVER_PORT);

/** Specs, die auch in WebKit mit dem iPhone-Profil laufen: Render-Eigenheiten, die Chromium nicht zeigt. */
const IPHONE_SPECS = /(lakes-without-depth|lake-smooth|info-panel-canon-pill\.touch)\.spec\.ts$/;

/** Die Touch-Specs: nur das Telefonprofil fährt sie (WI-0016). */
const TOUCH_SPECS = /\.touch\.spec\.ts$/;

/**
 * Die Abnahmeblätter: `*-review.spec.ts`.
 *
 * 💣 Sie ERZEUGEN ein Blatt oder Bilder für den Betreiber und prüfen nichts über die Anwendung. Ein
 * `expect` darin bewacht höchstens das Bild (zeigt es, was es zeigen soll?); jede Aussage über die
 * Anwendung steht in einer regulären Spec. Was sonst nach einer Prüfung aussieht, sind `throw`-Wächter
 * der Blattmechanik („map handle missing"). Die Inventur je Datei, mit dem `review:*`-Befehl und der
 * regulären Spec, die eine Zusicherung trägt, steht in
 * `project-control/work-items/WI-0123-testhygiene.md`.
 *
 * 🔴 Sie laufen NICHT im Standardlauf, sondern nur, wenn jemand sie NENNT — `npm run review:*` tut
 * genau das. Eingeführt am 2026-10-06 von der Koordination (Claudia), vom Betreiber am 2026-10-09
 * bestätigt („wie du denkst“ auf die Empfehlung der Gesamtdurchsicht, §13 Frage 3): Zeitgrenzen bis
 * 900 s machten den Volllauf langsam und laut, und ein rotes Blatt sagt über die Anwendung nichts.
 * 🔴 Regel für neue Specs: Ein Generator heißt `*-review.spec.ts` und bekommt einen `review:*`-Befehl;
 * seine Zusicherungen gehören in eine reguläre Spec.
 *
 * 🪤 Der Schalter hängt am AUFRUF, nicht an einem Projekt oder an einem npm-Skript. Das ist Absicht:
 * Ein eigenes Projekt hätte der Standardlauf mit auswählen müssen, und `--project` kennt in
 * Playwright 1.63 keine Verneinung („Project(s) '!abnahme' not found"); dann wäre `npx playwright test`
 * — ohne npm — weiter durch alle Blätter gelaufen. So gilt die Regel für JEDEN Aufruf.
 *
 * 🪤 Folge, die man kennen muss: `--last-failed` und `--grep` holen ein Blatt nicht zurück. Wer eines
 * will, nennt seine Datei.
 *
 * Das Muster (`SHEET_SPECS`), die Build-Probe (`BUILD_SPEC`) und die nur genannten Proben (`NUR_GENANNT`) stehen in `e2e/spec-auswahl.ts`:
 * Die Browserteile des Release-Tests (`e2e/release-teile.json`) lesen dieselbe Auswahl.
 */
const sheetNamed = process.argv.slice(2).some((argument) => SHEET_SPECS.test(argument.replace(/\\/g, "/")));

/*
 * Die Build-Probe (`BUILD_SPEC`): `production-build.spec.ts` prüft das AUSGELIEFERTE Artefakt gegen eine Vorschau auf 4181 und überspringt sich in jedem
 * anderen Lauf (WI-0248 S1). Sie gehört allein zu `playwright.build.config.ts` (`npm run test:e2e:build`, dort per `testMatch`); in der
 * Hauptconfig wäre sie ein Fall, der immer „übersprungen“ meldet und den Release-Lauf (`stats.skipped === 0`) nie grün werden ließe.
 * Anders als Blätter und Live-Proben holt sie auch ein genannter Dateiname hier nicht zurück: ohne Bau und Vorschau gibt es nichts zu prüfen.
 */

/**
 * Proben, die nur auf einem vorbereiteten Rechner etwas aussagen und im Standardlauf NICHT mitlaufen (WI-0248 S1). Wie die Blätter laufen
 * sie nur, wenn ihre Datei im Aufruf GENANNT ist (`npx playwright test e2e/status-page-live.spec.ts`); der Schalter hängt am Aufruf.
 *
 * - `status-page-live`: der echte Weg der Statusseite (Seite, Vite, Fastify, PostgreSQL, `/ws`) OHNE Ersatz. `/api/jobs/overview` und
 *   `/api/status/operations` verlangen `view_own_jobs` beziehungsweise `view_operations` mit zweitem Faktor; ohne Anmeldung antwortet nur
 *   ein Server mit `AUTH_ANONYMOUS_VIEW=editor`, den es seit 2026-10-12 nirgends mehr als Vorgabe gibt (`auth/config.ts`). Der Test
 *   übersprang deshalb in jedem Standardlauf. Die Seite mit festen Daten prüft `status-page.spec.ts`, die Routen die Servertests.
 * - `curve-label-martin`: Messung zu ADR-0007 (Spike), kein Regressionsfall der Anwendung. Sie braucht Tilefunktionen, die nur
 *   `scripts/dev/spike-label-runs.mjs` in die Entwicklungsdatenbank legt (bewusst keine Migration), und einen danach neu gestarteten
 *   Martin; in einer ausgelieferten Datenbank gibt es diese Quellen nicht.
 */
const NICHT_GENANNT = NUR_GENANNT.filter(
    (name) => !process.argv.slice(2).some((argument) => argument.replace(/\\/g, "/").includes(name)),
).map((name) => new RegExp(`${name}\\.spec\\.ts$`));

/**
 * Browser tests for the web app. Vite is started by Playwright itself, so the test needs no
 * running dev server; the tile server is checked explicitly inside the test instead of being
 * started silently (chapter 11.155).
 */
export default defineConfig({
    testDir: "./e2e",
    // Großzügig unter Last (`e2e/zeitfaktor.ts`): im Release-Lauf das Dreifache, am Arbeitsplatz wie bisher.
    timeout: zeit(60_000),
    expect: { timeout: zeit(5_000) },
    use: {
        baseURL: `http://localhost:${String(E2E_PORT)}`,
        // A hidden browser tab never fires requestAnimationFrame, and MapLibre then never finishes
        // loading its style - that cost an evening of debugging, so this stays explicit.
        headless: true,
        // 🔴 Jeder Worker ist ein eigener Client (WI-0037, S-04): Die Route drosselt je Client-IP auf zwei
        // offene Rechnungen, und alle Worker kämen sonst von 127.0.0.1 - mit 12 Workern wurden rund 18
        // Planer-, Such- und Kurzlinktests rot (WI-0045-Sitzung). Fastify traut dem Vite-Proxy auf loopback und liest
        // `X-Forwarded-For`; der Server bleibt unverändert, einen Test-Schalter gibt es bewusst nicht.
        extraHTTPHeaders: {
            "x-forwarded-for": `10.77.0.${String(Number(process.env["TEST_PARALLEL_INDEX"] ?? 0) + 1)}`,
        },
        // 🔴 Seit WI-0156 folgt die Seite der Browsersprache. Playwright spricht sonst `en-US`, und die ganze Suite
        // liefe auf Englisch, obwohl sie die deutsche Oberfläche prüft. Wer Englisch prüft, setzt es im Test selbst
        // (`test.use({ locale: "en-GB" })`, `e2e/i18n.spec.ts`).
        locale: "de-DE",
        // Der Kamera-Hinweis beim ersten Besuch gilt als gesehen; wer ihn prüft, schaltet ihn mit `ERSTER_BESUCH` ein (`e2e/erster-besuch.ts`).
        storageState: hinweisGesehen(`http://localhost:${String(E2E_PORT)}`),
    },
    projects: [
        // 🪤 Nur Chromium nimmt die Blätter überhaupt auf: `telefon` und `iphone` wählen über
        // `testMatch` und treffen keines. Die Ausnahme steht deshalb genau hier.
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
            testIgnore: [TOUCH_SPECS, BUILD_SPEC, ...NICHT_GENANNT, ...(sheetNamed ? [] : [SHEET_SPECS])],
        },
        // 🪤 Das Telefon fährt NUR die Touch-Tests (WI-0016). Mehrfinger-Gesten gibt es in Chromium
        // über CDP; iOS Safari prüft erst die Abnahme am echten Gerät.
        { name: "telefon", use: { ...devices["Pixel 7"] }, testMatch: TOUCH_SPECS },
        // Safari am iPhone (Betreiber 2026-10-04: Seen fehlten dort). Playwrights WebKit ist keine echte iOS-Maschine,
        // aber die einzige Safari-Engine, die ein Test hier fahren kann; das echte Gerät prüft die Abnahme.
        ...(webkitInstalled ? [{ name: "iphone", use: { ...devices["iPhone 15"] }, testMatch: IPHONE_SPECS }] : []),
    ],
    // Hält zu Beginn fest, gegen welche Vite und welchen Fastify der Lauf geht (WI-0189); meldet nur.
    globalSetup: "./e2e/umgebung.ts",
    // 🪤 Ohne Angabe nähme Playwright die Hälfte der Kerne (hier zwölf). Unter Last wurden am 2026-10-13 17 Fälle rot, die mit zwei
    // Arbeitern grün waren (`project-control/discovery/browsertests-rot-2026-10-13.md`). `--workers` und `E2E_WORKERS` gewinnen.
    workers: Number(process.env["E2E_WORKERS"] ?? "2"),
    webServer: [
        ...(eigenerServer === undefined ? [] : [eigenerServer]),
        {
            command: `npm run dev -- --port ${String(E2E_PORT)} --strictPort`,
            url: `http://localhost:${String(E2E_PORT)}`,
            reuseExistingServer: true,
            timeout: 60_000,
            ...(eigenerServer === undefined ? {} : { env: { PORT: String(E2E_SERVER_PORT) } }),
        },
    ],
});
