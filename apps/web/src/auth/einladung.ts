import { ref, type Ref } from "vue";
import { ApiFailure, postJson, type Fetcher } from "./api";
import { startDiscord } from "./anmelden";
import { formProblems, type Phrase } from "./formular";

/**
 * Eine Einladung annehmen (WI-0120 A9, AUTH-0001 §6.5): ansehen verbraucht nichts; annehmen mit Discord (eine gebundene
 * Einladung nur so) oder mit eigenem Benutzernamen und Passwort. Danach ist die neue Person angemeldet, die Seite lädt neu.
 */
export interface InvitationInfo {
    role: string;
    environment: string;
    expiresAt: string;
    invitedBy: string | null;
    requiresDiscord: boolean;
}

export type InvitationState = "laden" | "bereit" | "ungueltig" | "unvollstaendig";

export interface InvitationFlow {
    state: Ref<InvitationState>;
    info: Ref<InvitationInfo | null>;
    loginName: Ref<string>;
    displayName: Ref<string>;
    password: Ref<string>;
    busy: Ref<boolean>;
    problems: Ref<Phrase[]>;
    inspect(): Promise<void>;
    accept(): Promise<void>;
    discord(): Promise<void>;
}

export interface InvitationDeps {
    fetcher?: Fetcher;
    reload?: () => void;
    assign?: (url: string) => void;
    location?: { pathname: string; search: string; hash: string };
}

export function createInvitationFlow(token: string | null, deps: InvitationDeps = {}): InvitationFlow {
    const state = ref<InvitationState>(token === null ? "unvollstaendig" : "laden");
    const info = ref<InvitationInfo | null>(null);
    const loginName = ref("");
    const displayName = ref("");
    const password = ref("");
    const busy = ref(false);
    const problems = ref<Phrase[]>([]);

    async function inspect(): Promise<void> {
        if (token === null) return;
        state.value = "laden";
        try {
            info.value = await postJson<InvitationInfo>("/api/auth/invitations/inspect", { token }, deps.fetcher);
            state.value = "bereit";
        } catch (error) {
            if (error instanceof ApiFailure && error.code === "invitation_invalid") state.value = "ungueltig";
            else {
                state.value = "bereit";
                problems.value = formProblems(error);
            }
        }
    }

    async function accept(): Promise<void> {
        if (token === null || busy.value) return;
        busy.value = true;
        problems.value = [];
        try {
            await postJson(
                "/api/auth/invitations/accept",
                {
                    token,
                    loginName: loginName.value.trim(),
                    displayName: displayName.value.trim(),
                    password: password.value,
                },
                deps.fetcher,
            );
            (deps.reload ?? (() => globalThis.location.reload()))();
        } catch (error) {
            if (error instanceof ApiFailure && error.code === "invitation_invalid") state.value = "ungueltig";
            problems.value = formProblems(error);
            busy.value = false;
        }
    }

    async function discord(): Promise<void> {
        if (token === null || busy.value) return;
        busy.value = true;
        problems.value = [];
        try {
            await startDiscord({ purpose: "invitation", invitationToken: token }, deps);
        } catch (error) {
            if (error instanceof ApiFailure && error.code === "invitation_invalid") state.value = "ungueltig";
            problems.value = formProblems(error);
            busy.value = false;
        }
    }

    return { state, info, loginName, displayName, password, busy, problems, inspect, accept, discord };
}
