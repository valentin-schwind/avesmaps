import { shallowRef } from "vue";
import type { AuthSessionResponse, SessionPerson } from "@avesmaps3d/shared";
import { getJson, postJson, type Fetcher } from "./api";

/**
 * Wer angemeldet ist (WI-0120 A9, AUTH-0001 §8). Die Seite fragt `GET /api/auth/session` einmal VOR dem Start: Daraus entsteht
 * der `ViewerContext` (`viewer/bootstrap-viewer.ts`), den viele Stellen beim Aufbau einmal lesen. Nach einer An- oder Abmeldung
 * lädt die Seite deshalb neu; Kartenausschnitt (`#…`) und Reise (`?…`) stehen in der Adresse und bleiben.
 *
 * 🔴 Die Wahrheit bleibt beim Server: Er prüft jede Anfrage selbst. Was hier steht, steuert nur die Ansicht.
 *
 * Antwortet der Server ohne eingerichtete Anmeldung (`authEnabled: false`, lokal), bleibt alles wie vor der Anmeldung: Die
 * Instanz gilt als passwortgeschützt, wer sie erreicht, sieht die Editor-Ansicht. Antwortet er nicht oder nicht schnell genug,
 * ist das KEINE Editor-Ansicht mehr (WI-0203): `/edit` zeigt dann die Besucheransicht und das Anmeldefenster.
 */
export interface AuthSnapshot {
    /** Ob die Antwort des Servers vorliegt (sonst: Rückfall wie vor der Anmeldung). */
    readonly known: boolean;
    readonly authEnabled: boolean;
    readonly environment: string | null;
    readonly person: SessionPerson | null;
    readonly capabilities: readonly string[];
    /**
     * Darf diese Sitzung `/ws` betreten (WI-0197, `liveChannel` der Antwort)? Fehlt es (älterer Server, keine Antwort), entscheidet
     * allein der Hinweis am Zeiger wie bisher (`map/terrain/terrain-live.ts`).
     */
    readonly liveChannel?: boolean | undefined;
}

const UNKNOWN: AuthSnapshot = { known: false, authEnabled: false, environment: null, person: null, capabilities: [] };

export const authState = shallowRef<AuthSnapshot>(UNKNOWN);

/**
 * Ob es hier eine Anmeldung geben kann: Sie ist eingerichtet, oder der Server hat nicht geantwortet (Stage und Production haben
 * sie immer). Nur eine Antwort `authEnabled: false` sagt sicher, dass es keine gibt.
 */
export function signInExpected(session: AuthSnapshot): boolean {
    return !session.known || session.authEnabled;
}

/** Wie lange der Start höchstens auf die Antwort wartet; danach geht es ohne weiter. */
export const SESSION_WAIT_MS = 2500;

export async function loadSession(fetcher: Fetcher = fetch, waitMs: number = SESSION_WAIT_MS): Promise<AuthSnapshot> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), waitMs);
    try {
        const body = await getJson<AuthSessionResponse>("/api/auth/session", (url, init) =>
            fetcher(url, { ...init, signal: controller.signal }),
        );
        authState.value = {
            known: true,
            authEnabled: body.authEnabled,
            environment: body.environment,
            person: body.person,
            capabilities: body.capabilities,
            liveChannel: body.liveChannel,
        };
    } catch {
        authState.value = UNKNOWN;
    } finally {
        clearTimeout(timer);
    }
    return authState.value;
}

/**
 * Liest die Sitzung neu, ohne die Seite neu zu laden (nach einer Bestätigung mit Passkey: die Sitzung hat jetzt den zweiten
 * Faktor). Anders als `loadSession` bleibt bei einer Störung der bisherige Stand stehen, statt auf „unbekannt“ zu fallen.
 */
export async function refreshSession(fetcher: Fetcher = fetch): Promise<AuthSnapshot> {
    try {
        const body = await getJson<AuthSessionResponse>("/api/auth/session", fetcher);
        authState.value = {
            known: true,
            authEnabled: body.authEnabled,
            environment: body.environment,
            person: body.person,
            capabilities: body.capabilities,
            liveChannel: body.liveChannel,
        };
    } catch {
        // Bleibt, wie es war: Die Wahrheit hat ohnehin der Server.
    }
    return authState.value;
}

/** Die erste Nachfrage im Hintergrund nach einem Start ohne Antwort; danach doppelt so lange, bis höchstens eine Minute. */
const LATE_SESSION_FIRST_MS = 5_000;
const LATE_SESSION_MAX_MS = 60_000;

/**
 * Die Nachfrage im Hintergrund (WI-0203; der Betreiber wählte am 2026-10-16 „Ja, wie rechts“ in der Simulation, mit Hinweis und
 * Nachfrage): Hat der Server beim Start nicht geantwortet, fragt die Seite weiter, bis eine Antwort kommt. Bringt sie eine Person
 * (etwa ein gültiges Cookie auf der Stage, nur war der Server langsam), lädt die Seite neu, und der Editormodus kommt. Ohne Person
 * steht die Antwort in `authState` (der Hinweis im Anmeldefenster verschwindet), und die Nachfrage endet.
 */
export async function followLateSession(
    options: { fetcher?: Fetcher; reload?: () => void; pause?: (ms: number) => Promise<void> } = {},
): Promise<void> {
    const fetcher = options.fetcher ?? fetch;
    const pause = options.pause ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    let wait = LATE_SESSION_FIRST_MS;
    while (!authState.value.known) {
        await pause(wait);
        wait = Math.min(wait * 2, LATE_SESSION_MAX_MS);
        await refreshSession((url, init) => fetcher(url, { ...init, signal: AbortSignal.timeout(SESSION_WAIT_MS) }));
    }
    if (authState.value.person !== null) (options.reload ?? (() => globalThis.location.reload()))();
}

/** Abmelden und neu laden; auch ohne Antwort des Servers lädt die Seite neu (das Cookie löscht der Server). */
export async function signOut(
    fetcher: Fetcher = fetch,
    reload: () => void = () => globalThis.location.reload(),
): Promise<void> {
    try {
        await postJson("/api/auth/logout", {}, fetcher);
    } finally {
        reload();
    }
}
