import { shallowRef } from "vue";
import { GOOD_OUTCOMES, isEditorAddress, type Entry, type LinkKind, type ReturnOutcome } from "./entry";
import { signInExpected, type AuthSnapshot } from "./session-state";
import type { AdminView } from "./verwaltung";

/**
 * Welches Fenster der Anmeldung offen ist (WI-0120 A9, AUTH-0001 §12.2). EINE Stelle statt eines Schalters je Fenster in
 * `app.vue`: Ein Link, die Rückkehr von Discord, der Knopf in der Ecke oder eine Antwort `reauth_required` öffnen über
 * `openAuthWindow`; `auth-fenster-host.vue` zeigt genau dieses eine Fenster.
 */
export type AuthWindow =
    | { name: "anmelden"; outcome?: ReturnOutcome; zweiterFaktor?: true }
    | { name: "einladung"; token: string | null; outcome?: ReturnOutcome }
    | { name: "passwort"; kind: Extract<LinkKind, "password_reset" | "recovery">; token: string | null }
    | { name: "passkey"; token: string | null }
    | { name: "konto"; outcome?: ReturnOutcome }
    | { name: "karten" }
    | { name: "kartenPaket"; token: string | null }
    | { name: AdminWindowName; eintrag?: AdminView; ops?: string };

/**
 * Die zwei Fenster der Verwaltung (WI-0127 SYS-15, SYS-0001 §9d): „Kontenverwaltung …“ und „Systemsteuerung …“, je eine Tafel im
 * Navigationsregister. `eintrag` öffnet eine bestimmte Ansicht (tiefer Link `?verwaltung=<eintrag>`, `adminWindowFor`); `ops` dazu einen
 * Vorgang im Kanal (`?verwaltung=claudio&ops=OPS-000127`, die OPS-Nummer in der Glocke, WI-0136).
 */
export type AdminWindowName = "kontenverwaltung" | "systemsteuerung";

export const authWindow = shallowRef<AuthWindow | null>(null);

export function openAuthWindow(window: AuthWindow): void {
    authWindow.value = window;
}

export function closeAuthWindow(): void {
    authWindow.value = null;
}

/**
 * Was beim Start aufgeht: ein Link öffnet sein Fenster; eine Rückkehr von Discord, die nicht gut ausging, öffnet das Fenster,
 * aus dem sie kam, mit der Erklärung darin. Eine gute Rückkehr meldet sich nur kurz (Toast) und öffnet nichts; nur ein über
 * den Umweg geretteter Link (erster Passkey) geht danach weiter auf.
 *
 * `/anmelden` öffnet das Fenster nur ohne Anmeldung; wer angemeldet ist, landet gleich im Editor-Modus. Dorthin kehrt auch
 * Discord ohne Sitzung zurück (`discordReturnPath`, WI-0120 R6): Dann zählt das Ergebnis, nicht der Pfad.
 *
 * Kam eine Anmeldung über Discord (`ok`, `willkommen`) ohne zweiten Faktor zurück, obwohl die Person Verwaltungsrechte hat, öffnet
 * das Anmeldefenster mit dem zweiten Schritt „Mit Passkey bestätigen“ (Betreiber 2026-10-10: „2 faktoren oder keiner“). Seit dem
 * 2026-10-10 („4. B“) ist das bei Verwaltungsrechten JEDE Rückkehr von Discord: Discord-2FA ist kein zweiter Faktor.
 */
export function windowForEntry(
    entry: Entry,
    remembered: { kind: LinkKind; token: string } | null,
    signedIn = false,
    secondFactorMissing = false,
): AuthWindow | null {
    const link = entry.link;
    if (link !== null && link.kind !== "login") {
        if (link.kind === "invitation") return { name: "einladung", token: link.token };
        if (link.kind === "passkey_enrollment") return { name: "passkey", token: link.token };
        return { name: "passwort", kind: link.kind, token: link.token };
    }
    const outcome = entry.outcome;
    if (outcome === null) {
        if (link !== null && !signedIn) return { name: "anmelden" };
        return remembered?.kind === "passkey_enrollment" ? { name: "passkey", token: remembered.token } : null;
    }
    if (GOOD_OUTCOMES.has(outcome)) {
        if (remembered?.kind === "passkey_enrollment") return { name: "passkey", token: remembered.token };
        if (outcome === "verknuepft") return { name: "konto", outcome };
        if ((outcome === "ok" || outcome === "willkommen") && secondFactorMissing)
            return { name: "anmelden", zweiterFaktor: true };
        return null;
    }
    if (outcome === "einladung_ungueltig" || outcome === "schon_konto")
        return { name: "einladung", token: null, outcome };
    if (outcome === "discord_vergeben" || outcome === "schon_verknuepft") return { name: "konto", outcome };
    return { name: "anmelden", outcome };
}

/**
 * Was beim Start im Editor-Modus aufgeht, wenn kein Link und keine Rückkehr etwas öffnet (WI-0203; Betreiber 2026-10-16 zu
 * Review-Frage 6: „es soll das anmeldefenster kommen. wenn man sich angemeldet hat, kommt der editormodus“): `/edit` ohne Person
 * öffnet das Anmeldefenster über der Besucheransicht (`bootstrapViewer`). Nach der Anmeldung lädt die Seite neu, dann bringt die
 * Sitzung den Editormodus.
 *
 * - Auch wenn der Server klar „nicht angemeldet“ antwortet: Der Betreiber wählte am 2026-10-16 „Ja, wie rechts“ auf die Frage
 *   „Soll das Anmeldefenster auch bei klarem „nicht angemeldet“ von selbst aufgehen?“ (Simulation mit beiden Fassungen).
 * - Ohne Antwort trägt das Fenster den Hinweis „gerade nicht erreichbar“ mit „Neu laden“ (`anmelden-fenster.vue`), und die Seite
 *   fragt im Hintergrund weiter nach (`followLateSession`).
 * - Nichts auf der öffentlichen Karte, mit Anmeldung und ohne eingerichtete Anmeldung (lokal, `authEnabled: false`).
 */
export function windowForEditorStart(
    session: AuthSnapshot,
    location: { pathname: string; search: string },
): AuthWindow | null {
    if (!isEditorAddress(location) || session.person !== null || !signInExpected(session)) return null;
    return { name: "anmelden" };
}
