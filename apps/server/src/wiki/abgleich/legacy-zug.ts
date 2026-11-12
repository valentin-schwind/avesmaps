import type { Queryable } from "../../database.ts";
import type { StandLage } from "../../jobs/stand-datei.ts";

/**
 * Läuft gerade ein Legacy-Zug (WI-0253, Hinweis aus dem Betrieb 2026-10-26)? Neben ihm startet kein Auftrag des WikiSync, der die Karte schreibt: `wiki_uebernehmen` und
 * `wiki_zuruecknehmen` stehen mit `legacy_zug` und `import` in `exclusivePairs` (`config/jobs/*.json`), und der Zug hält beim Schreiben die exklusive Sperre der Kartendomäne. Das ist
 * gewollt; die Oberfläche soll es als Warten sagen („wartet, bis der Legacy-Zug fertig ist“), nicht als Fehler.
 *
 * Als Legacy-Zug gelten der Zug einer Kategorie (`legacy_zug`), der ganze Zug (`legacy_pull`) und `legacy:update` auf Zuruf, der sich als `import` aufzeichnet.
 */
export const LEGACY_ZUG_ARTEN: readonly string[] = ["legacy_zug", "legacy_pull", "import"];

/** Läuft in DIESER Umgebung ein Legacy-Zug (eine laufende Zeile in `job`)? */
export async function legacyZugLaeuft(db: Queryable): Promise<boolean> {
    const [zeile] = await db<{ laeuft: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM job WHERE state = 'RUNNING' AND kind = ANY (${[...LEGACY_ZUG_ARTEN]}::text[])) AS laeuft
    `;
    return zeile?.laeuft === true;
}

/**
 * Läuft auf dem Host ein Legacy-Zug, in irgendeiner Umgebung (der Stand des Dirigenten)? Ein schwerer Auftrag der Stage wartet auch hinter dem Zug von Production: Auf dem Host läuft immer nur
 * ein schwerer. Ohne frischen Stand: nein (dann bleibt nur, was die eigene Tafel weiß).
 */
export function legacyZugImStand(lage: StandLage): boolean {
    if (lage.zustand !== "ok") return false;
    return lage.stand.auftraege.some(
        (auftrag) => auftrag.state === "RUNNING" && LEGACY_ZUG_ARTEN.includes(auftrag.kind),
    );
}
