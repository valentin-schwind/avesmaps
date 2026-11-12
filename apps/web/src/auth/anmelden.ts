import { ref, type Ref } from "vue";
import { pluralKey } from "../i18n/i18n";
import { ApiFailure, postJson, type Fetcher } from "./api";
import { rememberLink, rememberView, type LinkKind } from "./entry";
import type { Phrase } from "./formular";
import { confirmWithPasskey, passkeyPhrases } from "./passkeys";
import { refreshSession, type AuthSnapshot } from "./session-state";
import { secondFactorMissing } from "./zweiter-faktor";

/**
 * Das Anmeldefenster ohne Oberfläche (WI-0120 A9, AUTH-0001 §6.3, §6.4; Gestalt: Blatt A8): Anmelden mit Benutzername und
 * Avesmaps-Passwort oder mit Discord. Nach der Anmeldung lädt die Seite neu (`session-state.ts`); vor dem Umweg über Discord
 * merkt sie sich den Kartenausschnitt.
 *
 * 🔴 **Zwei Faktoren oder keiner** (Betreiber 2026-10-10): Hat die Person Verwaltungsrechte, folgt nach der Anmeldung im selben
 * Fenster gleich „Mit Passkey bestätigen“ (`secondFactor`). Eine Anmeldung bringt den zweiten Faktor nie mit, weder das Passwort
 * noch Discord, auch nicht mit Discord-2FA (Betreiber 2026-10-10: „4. B“); er ist allein der Passkey. Erst danach gilt die Sitzung
 * mit Verwaltungsrechten; wer weitergeht, ist ohne sie angemeldet, und das Menü sagt, was fehlt.
 */
export type LoginProblem =
    | { kind: "credentials" }
    | { kind: "throttled"; until: number }
    | { kind: "locked" }
    | { kind: "passwordDisabled" }
    | { kind: "noAccess" }
    | { kind: "unavailable" }
    | { kind: "discordUnavailable" }
    | { kind: "network" }
    | { kind: "failed" };

/** Was eine abgelehnte Anfrage für das Fenster bedeutet; nie der Text des Servers, immer ein eigener Satz. */
export function loginProblem(error: unknown, now: number): LoginProblem {
    if (!(error instanceof ApiFailure)) return { kind: "failed" };
    switch (error.code) {
        case "invalid_credentials":
            return { kind: "credentials" };
        case "rate_limited": {
            const seconds = Number(error.details?.["retryAfterSeconds"] ?? 60);
            return { kind: "throttled", until: now + Math.max(1, Number.isFinite(seconds) ? seconds : 60) * 1000 };
        }
        case "account_locked":
            return { kind: "locked" };
        case "password_disabled":
            return { kind: "passwordDisabled" };
        case "no_access":
            return { kind: "noAccess" };
        case "auth_unavailable":
            return { kind: "unavailable" };
        case "discord_unavailable":
            return { kind: "discordUnavailable" };
        case "network":
            return { kind: "network" };
        default:
            return { kind: "failed" };
    }
}

/** Restzeit einer Drossel als Satz: Sekunden unter einer Minute, sonst aufgerundete Minuten. */
export function throttlePhrase(until: number, now: number): Phrase {
    const seconds = Math.max(1, Math.ceil((until - now) / 1000));
    if (seconds < 60) return { key: "auth.login.error.throttledSeconds", params: { n: seconds } };
    const minutes = Math.ceil(seconds / 60);
    return { key: pluralKey("auth.login.error.throttled", minutes), params: { n: minutes } };
}

/** Die Zeile unter dem gesperrten Knopf („noch 2 Minuten“). */
export function waitPhrase(until: number, now: number): Phrase {
    const minutes = Math.max(1, Math.ceil((until - now) / 60_000));
    return { key: pluralKey("auth.login.wait", minutes), params: { n: minutes } };
}

export function problemPhrase(problem: LoginProblem, now: number): Phrase {
    switch (problem.kind) {
        case "credentials":
            return { key: "auth.login.error.credentials" };
        case "throttled":
            return throttlePhrase(problem.until, now);
        case "locked":
            return { key: "auth.login.error.locked" };
        case "passwordDisabled":
            return { key: "auth.login.error.passwordDisabled" };
        case "noAccess":
            return { key: "auth.login.error.noAccess" };
        case "unavailable":
            return { key: "auth.login.error.unavailable" };
        case "discordUnavailable":
            return { key: "auth.login.error.discordUnavailable" };
        case "network":
            return { key: "auth.login.error.network" };
        case "failed":
            return { key: "auth.login.error.failed" };
    }
}

export interface LoginDeps {
    fetcher?: Fetcher;
    reload?: () => void;
    assign?: (url: string) => void;
    now?: () => number;
    location?: { pathname: string; search: string; hash: string };
    /** Für Tests: die Sitzung nach der Anmeldung lesen (sonst `refreshSession`). */
    session?: () => Promise<Pick<AuthSnapshot, "person" | "capabilities">>;
    /** Für Tests: mit Passkey bestätigen (sonst `confirmWithPasskey`). */
    passkey?: () => Promise<void>;
}

export interface DiscordStart {
    purpose: "login" | "invitation" | "link" | "confirm";
    invitationToken?: string;
    /** Ein Link, der nach der Rückkehr weiter aufgehen soll (erster Passkey). */
    keepLink?: { kind: LinkKind; token: string };
}

/** Der Server nimmt höchstens so lange Rückkehrpfade (`safeReturnPath`). */
const RETURN_PATH_MAX = 300;

/**
 * Wohin Discord zurückkehrt. Ohne Sitzung (Anmelden, Einladung annehmen) über `/anmelden`: Hinter der Stage-Tür (AUTH-0001
 * §4.5, WI-0120 R6) ist nur dieser Einstieg ohne Anmeldung erreichbar. Eine Rückkehr ohne Sitzung nach `/edit` leitete Nginx
 * auf `/anmelden` um und verlöre die Erklärung (`?anmeldung=kein_zugang`); die Seite schreibt die Adresse danach wie jeder
 * Einstieg auf `/edit`. Mit Sitzung (Verknüpfen, Bestätigen) bleibt die Rückkehr, wo der Umweg begann. Zu lang: ohne Abfrage.
 */
export function discordReturnPath(
    purpose: DiscordStart["purpose"],
    location: { pathname: string; search: string },
): string {
    const path = purpose === "login" || purpose === "invitation" ? "/anmelden" : location.pathname;
    const full = `${path}${location.search}`;
    return full.length <= RETURN_PATH_MAX ? full : path;
}

/** Der Umweg über Discord: Ausschnitt merken, Umweg anlegen lassen, hinüber. */
export async function startDiscord(start: DiscordStart, deps: LoginDeps = {}): Promise<void> {
    const location = deps.location ?? globalThis.location;
    const { authorizeUrl } = await postJson<{ authorizeUrl: string }>(
        "/api/auth/discord/start",
        {
            purpose: start.purpose,
            returnPath: discordReturnPath(start.purpose, location),
            ...(start.invitationToken === undefined ? {} : { invitationToken: start.invitationToken }),
        },
        deps.fetcher,
    );
    rememberView(location.hash);
    if (start.keepLink !== undefined) rememberLink(start.keepLink);
    (deps.assign ?? ((url: string) => globalThis.location.assign(url)))(authorizeUrl);
}

export interface Login {
    name: Ref<string>;
    password: Ref<string>;
    busy: Ref<boolean>;
    problem: Ref<LoginProblem | null>;
    /** Angemeldet, aber den Verwaltungsrechten fehlt der zweite Faktor: der zweite Schritt im selben Fenster. */
    secondFactor: Ref<boolean>;
    /** Was beim Bestätigen mit Passkey nicht ging (abgebrochen, abgelehnt). */
    secondFactorProblems: Ref<Phrase[]>;
    submit(): Promise<void>;
    discord(): Promise<void>;
    /** Mit Passkey bestätigen; gelungen, lädt die Seite neu, jetzt mit Verwaltungsrechten. */
    confirmPasskey(): Promise<void>;
    /** Ohne zweiten Faktor weiter: Die Seite lädt neu, angemeldet ohne Verwaltungsrechte. */
    finish(): void;
}

export function createLogin(deps: LoginDeps = {}): Login {
    const now = deps.now ?? Date.now;
    const reload = deps.reload ?? (() => globalThis.location.reload());
    const name = ref("");
    const password = ref("");
    const busy = ref(false);
    const problem = ref<LoginProblem | null>(null);
    const secondFactor = ref(false);
    const secondFactorProblems = ref<Phrase[]>([]);

    async function submit(): Promise<void> {
        const current = problem.value;
        if (busy.value || (current?.kind === "throttled" && current.until > now())) return;
        busy.value = true;
        try {
            await postJson("/api/auth/login", { loginName: name.value.trim(), password: password.value }, deps.fetcher);
            password.value = "";
            const session = await (deps.session ?? (() => refreshSession(deps.fetcher)))();
            if (secondFactorMissing(session)) secondFactor.value = true;
            else reload();
        } catch (error) {
            problem.value = loginProblem(error, now());
            // Abgewiesen: der Name bleibt stehen, das Passwort wird neu getippt (Blatt A8).
            if (problem.value.kind === "credentials") password.value = "";
        } finally {
            busy.value = false;
        }
    }

    async function confirmPasskey(): Promise<void> {
        if (busy.value) return;
        busy.value = true;
        secondFactorProblems.value = [];
        try {
            await (
                deps.passkey ?? (() => confirmWithPasskey(deps.fetcher === undefined ? {} : { fetcher: deps.fetcher }))
            )();
            reload();
        } catch (error) {
            secondFactorProblems.value = passkeyPhrases(error);
        } finally {
            busy.value = false;
        }
    }

    async function discord(): Promise<void> {
        if (busy.value) return;
        busy.value = true;
        try {
            await startDiscord({ purpose: "login" }, deps);
        } catch (error) {
            problem.value = loginProblem(error, now());
            busy.value = false;
        }
    }

    return {
        name,
        password,
        busy,
        problem,
        secondFactor,
        secondFactorProblems,
        submit,
        discord,
        confirmPasskey,
        finish: reload,
    };
}
