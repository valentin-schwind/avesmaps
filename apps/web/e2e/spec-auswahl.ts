/**
 * Welche Spec-Dateien die Hauptconfig (`playwright.config.ts`) im Standardlauf fährt (WI-0248): EINE Quelle für die Config und für die
 * Browserteile des Release-Tests (`release-teile.json`, `scripts/dev/release-teile.ts`). Reine Muster, keine Importe: Die Config lädt diese
 * Datei beim Start.
 *
 * Warum die Muster hier stehen: Der Release-Test teilt die Specs nach Thema auf vier Teile auf, und ein Test hält fest, dass jede Spec der
 * Hauptconfig in genau einem Teil liegt. Stünden die Ausschlüsse nur in der Config, müsste der Test sie nachschreiben und würde mit ihr
 * auseinanderlaufen. Die Begründung zu jedem Muster steht an der Stelle, die es benutzt (`playwright.config.ts`).
 */

/** Die Abnahmeblätter `*-review.spec.ts`: laufen nur, wenn ihre Datei im Aufruf genannt ist. */
export const SHEET_SPECS = /-review\.spec\.ts$/;

/** Die Build-Probe gehört allein zu `playwright.build.config.ts`. */
export const BUILD_SPEC = /production-build\.spec\.ts$/;

/**
 * Proben, die nur auf einem vorbereiteten Rechner etwas aussagen und nur laufen, wenn ihre Datei im Aufruf genannt ist. `wegeditor-echt` und
 * `flaechen-echt` brauchen die Wegwerf-Welt (`welt.ts`): echter Fastify, echte Daten, die Sitzung einer Testperson (WI-0252).
 *
 * Die Specs des Release-Tors (`tor-*`, WI-0264) brauchen dieselbe Welt; der Teil `kern-echt` des Runners nennt sie (`release-tor.json`).
 */
export const NUR_GENANNT = [
    "status-page-live",
    "curve-label-martin",
    "wegeditor-echt",
    "flaechen-echt",
    // Zwei Personen am selben Gebirge (WI-0265 B5c, Zwei-Kontext): braucht die Tor-Welt mit „Tor-Zweiter“, ist aber keiner der Kernabläufe des Tors.
    "aenderungen-ruecknahme",
    "tor-besucher",
    "tor-anmeldung",
    "tor-orte",
    "tor-wege",
    "tor-flaechen",
    "tor-inhalte",
] as const;

/** Was Playwright ohne eigene Angabe als Testdatei erkennt (`testMatch`-Vorgabe). */
const TESTDATEI = /\.(spec|test)\.[cm]?[jt]sx?$/;

/**
 * Fährt der Standardlauf der Hauptconfig diese Datei (Pfad relativ zu `e2e/`, mit `/`)? Blätter, Build-Probe und nur auf Nennung laufende
 * Proben nicht; alles andere, auch die Touch-Specs (Telefonprofil), ja.
 */
export function istHauptconfigSpec(datei: string): boolean {
    const glatt = datei.replace(/\\/g, "/");
    if (!TESTDATEI.test(glatt)) return false;
    if (SHEET_SPECS.test(glatt) || BUILD_SPEC.test(glatt)) return false;
    return !NUR_GENANNT.some((name) => new RegExp(`${name}\\.spec\\.ts$`).test(glatt));
}
