import type { SessionPerson } from "@avesmaps3d/shared";
import { adminViewsFor } from "./verwaltung";

/**
 * Zwei Faktoren oder keiner (Betreiber 2026-10-10, wörtlich: „entweder ich bin angemeldet oder nicht (also 2 faktoren oder
 * keiner)“ und „ich will keine frist des 2. faktors. das is bescheuert.“). Wer Verwaltungsrechte hat, bekommt sie mit dem zweiten
 * Faktor für die ganze Sitzung; fehlt er, sagt die Oberfläche das überall gleich (Anmeldefenster, Menü, Konto, Verwaltung) und
 * bietet „Mit Passkey bestätigen“ an. Der Server prüft unabhängig davon jede Anfrage (`checkAssurance`).
 */

/**
 * Hat die Sitzung Verwaltungsrechte, also mindestens eine Ansicht der Fenster „Kontenverwaltung …“ oder „Systemsteuerung …“
 * (WI-0127 SYS-15)?
 */
export function hasAdminRights(capabilities: readonly string[]): boolean {
    return adminViewsFor(capabilities).length > 0;
}

/** Fehlt der Sitzung der zweite Faktor für ihre Verwaltungsrechte? Ohne Verwaltungsrechte fehlt nichts. */
export function secondFactorMissing(snapshot: {
    person: Pick<SessionPerson, "assurance"> | null;
    capabilities: readonly string[];
}): boolean {
    return snapshot.person?.assurance === "basic" && hasAdminRights(snapshot.capabilities);
}
