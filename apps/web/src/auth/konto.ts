import { ref, type Ref } from "vue";
import { cleanResponsibility, type AdminPersonDetail, type Bezeichnung } from "@avesmaps3d/shared";
import { ApiFailure, getJson, newOperationId, postJson, type Fetcher } from "./api";
import { startDiscord } from "./anmelden";
import { withConfirmation, type Need } from "./bestaetigen";
import { formProblems, type Phrase } from "./formular";
import { confirmWithPasskey, passkeyPhrases, registerPasskey, type PasskeyDeps } from "./passkeys";

/**
 * Das eigene Konto (WI-0120 A9, AUTH-0001 §6.6, §6.7, §11.4, §12.2 `konto-fenster`): Anzeigename, „Verantwortlich für:“ (WI-0133),
 * Anmeldewege (Discord verknüpfen oder lösen, Passwort ändern oder einrichten), Passkeys, Sitzungen. Jede Handlung hat ihre
 * `operationId`; verlangt der Server eine frische Bestätigung, fragt `withConfirmation` nach und wiederholt mit derselben Kennung.
 */
export type AccountAction =
    | "rename"
    | "responsibility"
    | "bezeichnung"
    | "session"
    | "sessions"
    | "discord-link"
    | "discord-unlink"
    | "password"
    | "passkey-add"
    | "passkey-remove";

export interface AccountDeps {
    fetcher?: Fetcher;
    ask?: (need: Need) => Promise<boolean>;
    passkeys?: PasskeyDeps;
}

export interface Account {
    detail: Ref<AdminPersonDetail | null>;
    loading: Ref<boolean>;
    busy: Ref<AccountAction | null>;
    problems: Ref<Phrase[]>;
    /** Welche Handlung die Meldung betrifft, damit sie an ihrer Stelle steht. */
    problemOf: Ref<AccountAction | null>;
    load(): Promise<void>;
    rename(displayName: string): Promise<boolean>;
    /** „Verantwortlich für:“ setzen; leer leert es. Eine zweite Zeile oder Überlänge wird gar nicht erst geschickt. */
    setResponsibility(text: string): Promise<boolean>;
    /** Die eigene Wortform wählen (WI-0279 E10). */
    setBezeichnung(bezeichnung: Bezeichnung): Promise<boolean>;
    endSession(sessionId?: string): Promise<void>;
    linkDiscord(): Promise<void>;
    unlinkDiscord(): Promise<void>;
    changePassword(input: { current?: string; next: string; loginName?: string }): Promise<boolean>;
    addPasskey(label: string): Promise<boolean>;
    removePasskey(passkeyId: string): Promise<void>;
}

export function createAccount(deps: AccountDeps = {}): Account {
    const detail = ref<AdminPersonDetail | null>(null);
    const loading = ref(false);
    const busy = ref<AccountAction | null>(null);
    const problems = ref<Phrase[]>([]);
    const problemOf = ref<AccountAction | null>(null);
    const confirmed = <T>(action: () => Promise<T>): Promise<T> =>
        deps.ask === undefined ? withConfirmation(action) : withConfirmation(action, deps.ask);

    async function load(): Promise<void> {
        loading.value = true;
        try {
            detail.value = await getJson<AdminPersonDetail>("/api/account", deps.fetcher);
        } catch (error) {
            problems.value = formProblems(error);
            problemOf.value = null;
        } finally {
            loading.value = false;
        }
    }

    /** Eine Handlung: Meldung zurücksetzen, ausführen, danach neu laden; `false`, wenn sie abgelehnt wurde. */
    async function run(action: AccountAction, work: () => Promise<unknown>, phrases = formProblems): Promise<boolean> {
        if (busy.value !== null) return false;
        busy.value = action;
        problems.value = [];
        problemOf.value = null;
        try {
            await work();
            await load();
            return true;
        } catch (error) {
            problems.value = phrases(error);
            problemOf.value = action;
            return false;
        } finally {
            busy.value = null;
        }
    }

    return {
        detail,
        loading,
        busy,
        problems,
        problemOf,
        load,
        rename: (displayName) => {
            const operationId = newOperationId();
            const baseRevision = detail.value?.person.revision ?? 1;
            return run("rename", () =>
                postJson("/api/account/display-name", { operationId, displayName, baseRevision }, deps.fetcher),
            );
        },
        setResponsibility: (text) => {
            const operationId = newOperationId();
            const baseRevision = detail.value?.person.revision ?? 1;
            return run("responsibility", async () => {
                const clean = cleanResponsibility(text);
                // Dieselbe Regel wie im Server: Der Satz kommt ohne Umweg über die Leitung.
                if (!clean.ok) {
                    throw new ApiFailure(400, "responsibility_invalid", "", { problem: clean.problem });
                }
                await postJson(
                    "/api/account/responsibility",
                    { operationId, responsibleFor: clean.value ?? "", baseRevision },
                    deps.fetcher,
                );
            });
        },
        setBezeichnung: (bezeichnung) => {
            const operationId = newOperationId();
            return run("bezeichnung", () =>
                postJson("/api/account/bezeichnung", { operationId, bezeichnung }, deps.fetcher),
            );
        },
        endSession: async (sessionId) => {
            const operationId = newOperationId();
            await run(sessionId === undefined ? "sessions" : "session", () =>
                postJson(
                    "/api/account/sessions/revoke",
                    sessionId === undefined ? { operationId } : { operationId, sessionId },
                    deps.fetcher,
                ),
            );
        },
        linkDiscord: async () => {
            await run("discord-link", () => confirmed(() => startDiscord({ purpose: "link" }, deps)));
        },
        unlinkDiscord: async () => {
            const operationId = newOperationId();
            await run("discord-unlink", () =>
                confirmed(() => postJson("/api/account/discord/unlink", { operationId }, deps.fetcher)),
            );
        },
        changePassword: (input) => {
            const operationId = newOperationId();
            const body = {
                operationId,
                newPassword: input.next,
                ...(input.current === undefined || input.current === "" ? {} : { currentPassword: input.current }),
                ...(input.loginName === undefined ? {} : { loginName: input.loginName.trim() }),
            };
            return run("password", () => confirmed(() => postJson("/api/account/password", body, deps.fetcher)));
        },
        addPasskey: (label) =>
            run(
                "passkey-add",
                async () => {
                    // Ein weiterer Passkey braucht den Nachweis mit einem vorhandenen (§11.4); der erste kommt über einen Link.
                    if ((detail.value?.passkeys.length ?? 0) > 0) await confirmWithPasskey(deps.passkeys);
                    await registerPasskey({ label }, deps.passkeys);
                },
                passkeyPhrases,
            ),
        removePasskey: async (passkeyId) => {
            const operationId = newOperationId();
            await run("passkey-remove", () =>
                confirmed(() => postJson("/api/account/passkeys/revoke", { operationId, passkeyId }, deps.fetcher)),
            );
        },
    };
}
