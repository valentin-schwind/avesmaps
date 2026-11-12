import { ref, type Ref } from "vue";
import { ApiFailure, postJson, type Fetcher } from "./api";
import { formProblems, type Phrase } from "./formular";

/**
 * Ein einmaliger Link an eine Person (WI-0120 A9, AUTH-0001 §6.7, §11.2): Rücksetzlink (neues Passwort; beim ersten Konto von
 * der Kommandozeile auch der Benutzername) oder Notzugang (das eigene Passwort, danach 60 Minuten Notzugang). Ansehen verbraucht
 * nichts, erst das Absenden löst den Link ein.
 */
export type AccessKind = "password_reset" | "recovery";

export interface AccessLinkInfo {
    kind: AccessKind;
    displayName: string;
    loginName: string | null;
    expiresAt: string;
}

export interface AccessLinkFlow {
    state: Ref<"laden" | "bereit" | "ungueltig" | "unvollstaendig">;
    info: Ref<AccessLinkInfo | null>;
    loginName: Ref<string>;
    password: Ref<string>;
    busy: Ref<boolean>;
    problems: Ref<Phrase[]>;
    inspect(): Promise<void>;
    submit(): Promise<void>;
}

export function createAccessLinkFlow(
    kind: AccessKind,
    token: string | null,
    deps: { fetcher?: Fetcher; reload?: () => void } = {},
): AccessLinkFlow {
    const state = ref<AccessLinkFlow["state"]["value"]>(token === null ? "unvollstaendig" : "laden");
    const info = ref<AccessLinkInfo | null>(null);
    const loginName = ref("");
    const password = ref("");
    const busy = ref(false);
    const problems = ref<Phrase[]>([]);

    async function inspect(): Promise<void> {
        if (token === null) return;
        state.value = "laden";
        try {
            info.value = await postJson<AccessLinkInfo>("/api/auth/links/inspect", { token, kind }, deps.fetcher);
            state.value = "bereit";
        } catch (error) {
            if (error instanceof ApiFailure && error.code === "link_invalid") state.value = "ungueltig";
            else {
                state.value = "bereit";
                problems.value = formProblems(error);
            }
        }
    }

    async function submit(): Promise<void> {
        if (token === null || busy.value) return;
        busy.value = true;
        problems.value = [];
        try {
            if (kind === "recovery") {
                await postJson("/api/auth/recovery", { token, password: password.value }, deps.fetcher);
            } else {
                const name = info.value?.loginName === null ? { loginName: loginName.value.trim() } : {};
                await postJson("/api/auth/password-reset", { token, password: password.value, ...name }, deps.fetcher);
            }
            (deps.reload ?? (() => globalThis.location.reload()))();
        } catch (error) {
            if (error instanceof ApiFailure && error.code === "link_invalid") state.value = "ungueltig";
            problems.value = formProblems(error);
            if (kind === "recovery") password.value = "";
            busy.value = false;
        }
    }

    return { state, info, loginName, password, busy, problems, inspect, submit };
}
