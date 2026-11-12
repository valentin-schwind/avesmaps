import { type InjectionKey } from "vue";
import { editorViewer, sessionViewer, visitorViewer, type ViewerContext } from "@avesmaps3d/shared";
import { isEditorAddress } from "../auth/entry";
import { authState, type AuthSnapshot } from "../auth/session-state";

/**
 * M9 (Hardening Review 2026-09-28): die EINZIGE Stelle, die `?besucher` liest. Vorher las `app.vue`
 * (:176-181) den Parameter direkt und reichte einen Boolean an mehrere Aufrufer durch; ein Auth-Einbau
 * hätte jede dieser Stellen erneut anfassen müssen. Jetzt entsteht hier einmal ein `ViewerContext`
 * (`@avesmaps3d/shared`), verteilt per `provide`/`inject` (`VIEWER_CONTEXT_KEY`).
 *
 * ⭐ `?besucher` in der Adresse zeigt die Karte so, wie ein BESUCHER sie sähe - ohne Strömungspfeile,
 * die Serie `old` und Seewegnamen in der Suche (Betreiberentscheidungen 2026-09-21/22/23). Damit lässt
 * sich die Besucheransicht auf einer Editor-Instanz prüfen. Der Schalter kann nur WEGNEHMEN, nie etwas
 * freischalten: er ist eine Vorschau, keine Zugriffskontrolle.
 *
 * Seit WI-0120 A9 liefert die Sitzung die Antwort: Ist die Anmeldung eingerichtet (`authEnabled`), gelten genau die
 * Capabilities aus `GET /api/auth/session` (angemeldet nach Rolle, ohne Anmeldung die Besucher- oder Übergangsansicht
 * des Servers). Ohne eingerichtete Anmeldung (`authEnabled: false`, lokal) bleibt es wie zuvor: Wer eine passwortgeschützte
 * Instanz erreicht hat, ist Editor (AGENTS.md).
 *
 * 🔴 **Ohne Antwort des Servers die Besucheransicht, nie die Werkzeuge** (WI-0203, Betreiber 2026-10-16 zu Review-Frage 6:
 * „es soll das anmeldefenster kommen. wenn man sich angemeldet hat, kommt der editormodus“). Bis dahin fiel `/edit` nach
 * 2,5 s ohne Antwort auf `editorViewer`: jeder sah alle Werkzeuge samt Serie `old`, aber keine Kopfleiste und kein „Anmelden“.
 * Jetzt steht dahinter die Besucheransicht, darüber das Anmeldefenster (`windowForEditorStart` in `auth/auth-windows.ts`);
 * nach der Anmeldung lädt die Seite neu, und die Sitzung bringt den Editormodus.
 *
 * 🔴 **Die Werkzeuge gibt es nur im Editor-Modus** (`/edit`, `?editor=true`, Legacys `?edit=1`; Betreiber 2026-10-09 auf die
 * Frage „Sollen auch die Editor-Werkzeuge nur unter /edit erscheinen?“: „ja“). Ohne ihn ist es die öffentliche Karte, für jeden,
 * auch für Angemeldete und auf einer Instanz ohne eingerichtete Anmeldung, wie in Legacy ohne `edit=1`. Ein Ansichtsschalter,
 * kein Riegel: Was jemand darf, prüft der Server.
 *
 * `planner-link.ts` kennt das Wort `besucher` ebenfalls (als einen der Parameter, die beim Schreiben
 * eines Reiselinks unangetastet bleiben) - das ist Durchreichen in der Adresse, kein zweiter Leser,
 * und deshalb von der Prüfung "nur viewer.ts kennt besucher" ausdrücklich ausgenommen.
 */
export function bootstrapViewer(
    search: string = globalThis.location?.search ?? "",
    session: AuthSnapshot = authState.value,
    pathname: string = globalThis.location?.pathname ?? "/",
): ViewerContext {
    if (new URLSearchParams(search).has("besucher")) return visitorViewer("url-flag:besucher");
    if (!isEditorAddress({ pathname, search })) return visitorViewer("oeffentliche-karte");
    if (session.known && session.authEnabled) {
        return sessionViewer(`session:${session.person?.role ?? "ohne-anmeldung"}`, session.capabilities);
    }
    if (session.known) return editorViewer("default:passwortgeschuetzte-instanz");
    return visitorViewer("ohne-antwort:anmeldung");
}

/** Verteilung per provide/inject, statt den ViewerContext durch jede Komponentenebene zu reichen. */
export const VIEWER_CONTEXT_KEY: InjectionKey<ViewerContext> = Symbol("viewer-context");
