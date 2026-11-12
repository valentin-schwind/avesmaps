import { HOEHENMODELL_PROFILE, type HoehenmodellProfil } from "@avesmaps3d/shared";

/**
 * Das Profil der Instanz für das Höhenmodell (`HOEHENMODELL`, WI-0127 SYS-13, §9c.12 Frage 5 B): ohne Wert `abgenommen` auf Production
 * (`AVESMAPS_ENV=production`, nur abgenommene Fassungen wählen, nie messen), sonst `voll`. Ein eigenes, leichtes Modul, weil `config.ts`
 * es liest und Werkzeugskripte `config.ts` importieren; die Handlungen am Höhenmodell (`hoehenmodell.ts`) gehören nicht dorthin.
 */
export function hoehenmodellProfil(environment: NodeJS.ProcessEnv): HoehenmodellProfil {
    const value = (environment["HOEHENMODELL"] ?? "").trim();
    if (value === "") return environment["AVESMAPS_ENV"] === "production" ? "abgenommen" : "voll";
    if ((HOEHENMODELL_PROFILE as readonly string[]).includes(value)) return value as HoehenmodellProfil;
    throw new Error(`HOEHENMODELL must be ${HOEHENMODELL_PROFILE.map((mode) => `"${mode}"`).join(" or ")}: ${value}`);
}
