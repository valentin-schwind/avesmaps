import { reactive, ref, type Ref } from "vue";
import type { AdminPerson } from "@avesmaps3d/shared";
import type { ActionResult, Administration } from "./verwaltung";

/**
 * Handlungen an Personen, gemeinsam für Liste und Detail (WI-0120 A10). Je Person läuft höchstens eine Handlung; was sie ablehnt
 * (Konflikt, fehlendes Recht), steht danach bei der Person. Ein Auswahlfeld zeigt nach einer Ablehnung wieder den Stand des
 * Servers: `generation` zählt mit und baut die Felder neu auf (ein Feld, dessen Wert sich nicht ändert, hielte sonst die
 * verworfene Wahl fest).
 */
export interface PersonActions {
    busy: ReadonlySet<string>;
    outcomes: ReadonlyMap<string, ActionResult>;
    generation: Ref<number>;
    /** Die offene Rückfrage im Fenster: Sperren verlangt einen Grund, Zugang entziehen und Passkeys widerrufen ein Ja. */
    question: Ref<{ kind: "lock" | "revoke" | "passkeys"; personId: string } | null>;
    reason: Ref<string>;
    setReason(text: string): void;
    run(person: AdminPerson, action: () => Promise<ActionResult>): Promise<ActionResult>;
    ask(kind: "lock" | "revoke" | "passkeys", person: AdminPerson): void;
    cancel(): void;
    /** Rückfrage und Antworten vergessen, etwa beim Wechsel zwischen Liste und Detail: Eine Antwort gehört zu ihrem Ort. */
    reset(): void;
    changeRole(person: AdminPerson, role: string): Promise<ActionResult>;
    confirm(person: AdminPerson): Promise<ActionResult>;
    unlock(person: AdminPerson): Promise<ActionResult>;
    endSessions(person: AdminPerson, sessionId?: string): Promise<ActionResult>;
}

export function usePersonActions(verwaltung: Administration): PersonActions {
    const busy = reactive(new Set<string>());
    const outcomes = reactive(new Map<string, ActionResult>());
    const generation = ref(0);
    const question = ref<{ kind: "lock" | "revoke" | "passkeys"; personId: string } | null>(null);
    const reason = ref("");

    async function run(person: AdminPerson, action: () => Promise<ActionResult>): Promise<ActionResult> {
        if (busy.has(person.id)) return { ok: false, problems: [] };
        busy.add(person.id);
        outcomes.delete(person.id);
        try {
            const result = await action();
            if (!result.ok || result.link !== undefined) outcomes.set(person.id, result);
            if (!result.ok) generation.value += 1;
            return result;
        } finally {
            busy.delete(person.id);
        }
    }

    return {
        busy,
        outcomes,
        generation,
        question,
        reason,
        setReason(text): void {
            reason.value = text;
        },
        run,
        ask(kind, person): void {
            question.value = { kind, personId: person.id };
            reason.value = "";
            outcomes.delete(person.id);
        },
        cancel(): void {
            question.value = null;
        },
        reset(): void {
            question.value = null;
            outcomes.clear();
        },
        changeRole: (person, role) => run(person, () => verwaltung.changeRole(person, role)),
        async confirm(person): Promise<ActionResult> {
            const kind = question.value?.kind;
            const result = await run(person, () =>
                kind === "lock"
                    ? verwaltung.lock(person, reason.value.trim())
                    : kind === "revoke"
                      ? verwaltung.revokeAccess(person)
                      : verwaltung.revokePasskeys(person),
            );
            if (result.ok) question.value = null;
            return result;
        },
        unlock: (person) => run(person, () => verwaltung.unlock(person)),
        endSessions: (person, sessionId) => run(person, () => verwaltung.endSessions(person, sessionId)),
    };
}
