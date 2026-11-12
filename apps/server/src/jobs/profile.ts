/**
 * Welches Profil der Variablen (`config/jobs/<name>.json`) gilt?
 *
 * 🔴 Ein Rechnerwert gilt nur in SEINEM Profil. Deshalb wählt hier nie die Vermutung „es wird schon staging sein“: `JOBS_PROFILE`
 * (die Unit oder der Korridor setzt es) gewinnt; ohne die Variable gilt `local` nur, wo es erkennbar der Entwicklungsrechner ist
 * (`RELEASE_ID=dev` oder, ohne Release, unter Windows), sonst `unknown`. Ein Profil ohne Datei hat keinen Rechnerwert: dort läuft
 * jede Jobart allein und die Statusseite sagt „unbekannt“, statt die Zahlen eines anderen Rechners zu zeigen.
 */
export function jobsProfileName(environment: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string {
    const explicit = environment["JOBS_PROFILE"];
    if (explicit !== undefined && explicit !== "") return explicit;
    const release = environment["RELEASE_ID"];
    if (release === "dev" || (release === undefined && platform === "win32")) return "local";
    return "unknown";
}
