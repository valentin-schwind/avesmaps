import { capabilitiesFor } from "@avesmaps3d/shared";
import type { SessionRecord } from "../auth/session-store.ts";
import type { SystemStateSnapshot } from "./state-store.ts";

/**
 * Wer im eingeschränkten Betrieb hineinkommt (WI-0127 SYS-4, SYS-0001 §4.3, §4.4; Betreiber E5 A): eine Sitzung mit
 * `access_restricted_mode` aus Rolle oder Sonderrecht UND zweitem Faktor (`assurance` nicht `basic`; eine Notzugangs-Sitzung zählt).
 *
 * 🪤 Die 60-Minuten-Frische von Stufe V gilt hier bewusst nicht: Sonst landete ein Admin nach einer Stunde Pause draußen und käme ohne
 * Kommandozeile nicht zurück. Jede Verwaltungsroute prüft die Frische weiter selbst (`protect`). Dieselbe Regel gilt an der Tür und im
 * eingeschränkten Betrieb der Anwendung (SYS-3, `auth/gate.ts`, `system/restricted-mode.ts`).
 */
export function holdsRestrictedAccess(
    session: Pick<SessionRecord, "role" | "grants" | "assurance"> | undefined,
): boolean {
    if (session === undefined || session.assurance === "basic") return false;
    return capabilitiesFor(session.role, session.grants).has("access_restricted_mode");
}

/**
 * Lässt die Stellung diese Sitzung herein? Normal: jede, die sonst hereinkäme. Eingeschränkt: nur mit Zugangsrecht. Unbekannt: wie
 * eingeschränkt (fail-closed); wer nur eine offene Verbindung neu prüft, fragt vorher `modeKnown` und lässt sie bei unbekanntem
 * Zustand stehen, statt bei jedem Aussetzer der Datenbank alle hinauszuwerfen.
 */
export function admitsInMode(snapshot: SystemStateSnapshot | undefined, session: SessionRecord | undefined): boolean {
    if (modeKnown(snapshot) && snapshot.mode === "normal") return true;
    return holdsRestrictedAccess(session);
}

export function modeKnown(snapshot: SystemStateSnapshot | undefined): snapshot is SystemStateSnapshot {
    return snapshot !== undefined && snapshot.source !== "unknown" && snapshot.mode !== null;
}
