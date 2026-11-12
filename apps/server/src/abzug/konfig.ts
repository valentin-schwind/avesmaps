import type { AbzugQuelle, AbzugRolle } from "@avesmaps3d/shared";
import type { AuthConfig } from "../auth/config.ts";
import type { EinspielenErgebnis, EinspielenOptionen } from "./einspielen.ts";
import type { SchluesselSpeicher } from "./holen.ts";

/**
 * Welche Rolle diese Instanz beim Abzug hat (WI-0251) und wo ihre Ablage liegt.
 *
 * - **Stage und Production erstellen** (`erstellen`): Sie reihen den Auftrag ein, listen die fertigen Abzüge der Ablage (`ABZUG_ROOT`, setzt
 *   Claudio je Umgebung) und liefern sie mit kurzlebigem Link aus. Ohne `ABZUG_ROOT` steht der Knopf gesperrt mit Satz da.
 * - **Der Entwicklungsrechner spielt ein** (`einspielen`): Eingang und Sicherungen liegen unter `ABZUG_ROOT`, ohne Wert unter
 *   `C:/avesmaps3d-data/abzug` (wie die übrigen lokalen Daten). 🔴 Nur lokal im Sinn von `releaseTestLokal`: Entwicklungsumgebung UND
 *   `RELEASE_ID` fehlt oder ist `dev`. Ein benanntes Stage oder Production spielt nie ein.
 * - Jede andere Umgebung (Tests ohne Namen) hat keine Rolle; die Routen werden nicht angemeldet.
 *
 * Im Betrieb hat jede Instanz GENAU eine Rolle; die Liste gibt es, weil die Wächter der Schreibwege in einem Test beide Gruppen von Routen
 * sehen müssen.
 */
export interface AbzugConfig {
    readonly rollen: readonly AbzugRolle[];
    /** Nur bei `erstellen`: aus welcher Umgebung die Abzüge stammen. */
    readonly quelle: AbzugQuelle | undefined;
    readonly wurzel: string | undefined;
    /**
     * Lokal ohne eigenen Wert für `ABGLEICHE`: Die Zeilen der Legacy-Abgleiche stehen im Datenabgleich nicht mehr da, dort steht allein der Abzug
     * (Vali 2026-10-24: „das jetzige macht keinen sinn“; die Daten kommen von Stage und Production). Wer `ABGLEICHE` ausdrücklich setzt, sieht seine
     * Zeilen wie bisher; Aufträge und Kommandozeile bleiben unberührt, es ist eine Aussage über die Liste.
     */
    readonly abgleicheVerbergen?: boolean | undefined;
    /**
     * Nur Tests: das Verzeichnis von `pg_dump`. `null` heißt „es gibt keins“ (der Knopf bleibt gesperrt), `undefined` „suchen“ (`pgDumpPfad`).
     */
    readonly pgDump?: string | null | undefined;
    /** Nur Tests: die Verbindungsadresse, in die „eingespielt“ würde, wo die Konfiguration des Tests selbst keine hat. */
    readonly databaseUrl?: string | undefined;
    /** Nur Tests: ersetzt das echte Einspielen (`spieleAbzugEin`), damit ein Wächter den Knopf drücken kann, ohne eine Datenbank zu ersetzen. */
    readonly einspielen?: ((optionen: EinspielenOptionen) => Promise<EinspielenErgebnis>) | undefined;
    /** Nur Tests: wo die Quellen liegen (Vorgabe HTTPS, `QUELLEN_ADRESSEN`), womit geholt wird, wie lange gewartet wird und wo die Schlüssel liegen. */
    readonly quellen?: Partial<Record<AbzugQuelle, string>> | undefined;
    readonly fetch?: typeof fetch | undefined;
    readonly pauseMs?: number | undefined;
    readonly stillstandMs?: number | undefined;
    readonly schluessel?: SchluesselSpeicher | undefined;
}

const LOKALE_WURZEL = "C:/avesmaps3d-data/abzug";

export function abzugKonfiguration(environment: NodeJS.ProcessEnv, auth: AuthConfig): AbzugConfig | undefined {
    const wurzel = (environment["ABZUG_ROOT"] ?? "").trim();
    if (auth.environment === "staging" || auth.environment === "production") {
        return { rollen: ["erstellen"], quelle: auth.environment, wurzel: wurzel === "" ? undefined : wurzel };
    }
    const lokal = auth.environment === "development" && (environment["RELEASE_ID"] ?? "dev") === "dev";
    if (!lokal) return undefined;
    return {
        rollen: ["einspielen"],
        quelle: undefined,
        wurzel: wurzel !== "" ? wurzel : process.platform === "win32" ? LOKALE_WURZEL : undefined,
        abgleicheVerbergen: (environment["ABGLEICHE"] ?? "").trim() === "",
    };
}
