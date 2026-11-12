import { rechteVon } from "@avesmaps3d/shared";
import { checkAssurance } from "./assurance.ts";
import type { AuthConfig } from "./config.ts";
import type { SessionRecord } from "./session-store.ts";

/**
 * Wer die Statusseite und den Kanal `/ws` sieht (WI-0120 A11; JOBS-0001 D1 A, Betreiber 2026-10-04; AUTH-0001 §7.2):
 *
 * - **`view_operations`** mit erfüllter Stufe V: alles, auch Betrieb, Speicher, Befunde und die Jobs anderer.
 * - **`view_own_jobs`**: nur die eigenen Jobs, mit Position und Wartezeit (die gelten für die ganze Warteschlange), ohne Speicher
 *   und Befunde. Ein Admin ohne zweiten Faktor sieht so viel, bis er ihn bestätigt (`needs`); eine Frist des zweiten Faktors gibt
 *   es seit 2026-10-10 nicht mehr (`assurance.ts`).
 * - **ohne Anmeldung:** nichts (401). Ausnahme ist eine Instanz, die ohne Anmeldung als geschützt gilt, weil sie keine Anmeldung
 *   eingerichtet hat oder ausdrücklich die Übergangsansicht zeigt (`anonymousView: editor`, lokal; auf Production verboten): Dort
 *   sieht man alles wie vor der Anmeldung (Basic Auth auf der Stage, der eigene Rechner).
 * - angemeldet ohne eines der beiden Rechte (Tester, Reviewer): 403.
 */
export type StatusView =
    { view: "all"; personId: string | null } | { view: "own"; personId: string; needs: "second_factor" | null };

export function statusViewOf(
    session: SessionRecord | undefined,
    config: AuthConfig,
    now: Date = new Date(),
): StatusView | 401 | 403 {
    if (session === undefined) {
        return config.environment === undefined || config.anonymousView === "editor"
            ? { view: "all", personId: null }
            : 401;
    }
    const capabilities = rechteVon(session);
    if (capabilities.has("view_operations")) {
        const verdict = checkAssurance(session, "view_operations", config, undefined, now);
        if (verdict.ok) return { view: "all", personId: session.personId };
        if (capabilities.has("view_own_jobs"))
            return { view: "own", personId: session.personId, needs: "second_factor" };
    }
    if (capabilities.has("view_own_jobs")) return { view: "own", personId: session.personId, needs: null };
    return 403;
}
