import { afterEach, describe, expect, it, vi } from "vitest";
import { watch } from "vue";
import { ApiFailure } from "../src/auth/api.ts";
import {
    createReadConfirmation,
    pendingConfirmation,
    requestConfirmation,
    withConfirmation,
} from "../src/auth/bestaetigen.ts";
import { createOperations } from "../src/auth/betriebszustand.ts";
import { createAdministration } from "../src/auth/verwaltung.ts";

/**
 * Hotfix 2026-10-10 (Handover `2026-10-10-verwaltung-bestaetigung-beim-laden.md`): Beim Öffnen lädt die Verwaltung Personen,
 * Einladungen und Betriebszustand gleichzeitig. Fehlt der Sitzung der zweite Faktor, antwortet jede Liste 403. Es geht GENAU EIN
 * Fenster „Kurz bestätigen“ auf; bestätigt, laden alle neu; abgebrochen, enden alle mit dem Satz, was fehlt, und der Knopf bietet
 * es für alle erneut an. Das echte `requestConfirmation`, kein Ersatz: geprüft wird das geteilte Versprechen selbst.
 */

const SECOND_FACTOR = {
    status: 403,
    body: { error: { code: "assurance_required", message: "x", details: { need: "second_factor" } } },
};

/** Ein Server, der jede Liste ablehnt, solange `confirmed` falsch ist; danach liefert er sie. */
function server() {
    const state = { confirmed: false, calls: [] as string[] };
    const bodies: Record<string, unknown> = {
        "/api/admin/people": { people: [{ id: "p", displayName: "Rondrikan" }] },
        "/api/admin/invitations": { invitations: [] },
        "/api/admin/roles": { operators: [], grants: [] },
        "/api/admin/system": { configured: null },
    };
    const fetcher = (async (url: RequestInfo | URL) => {
        const path = String(url).split("?")[0]!;
        state.calls.push(path);
        await Promise.resolve();
        const answer = state.confirmed
            ? { status: 200, body: bodies[path] ?? { events: [], next: null } }
            : SECOND_FACTOR;
        return new Response(JSON.stringify(answer.body), { status: answer.status });
    }) as typeof fetch;
    return { state, fetcher };
}

/** Zählt, wie oft das Fenster aufgeht (von zu nach offen), und gibt die Zählung frei. */
function windows() {
    let opened = 0;
    const stop = watch(
        pendingConfirmation,
        (now, before) => {
            if (now !== null && before === null) opened += 1;
        },
        { flush: "sync" },
    );
    return { opened: () => opened, stop };
}

afterEach(() => {
    pendingConfirmation.value?.resolve(false);
});

describe("Eine gemeinsame Bestätigung für parallele Lesewege", () => {
    it("🔴 drei gleichzeitige Ablehnungen: genau ein Fenster, bestätigt laden alle drei neu", async () => {
        const { state, fetcher } = server();
        const count = windows();
        const lesen = createReadConfirmation();
        const verwaltung = createAdministration({ fetcher, reads: lesen });
        const betrieb = createOperations({ fetcher, reads: lesen });
        const loads = Promise.all([verwaltung.loadPeople(), verwaltung.loadInvitations(), betrieb.load()]);
        await vi.waitFor(() => expect(state.calls).toHaveLength(3));
        await vi.waitFor(() => expect(pendingConfirmation.value).not.toBeNull());
        expect(pendingConfirmation.value?.need).toBe("second_factor");

        state.confirmed = true;
        pendingConfirmation.value?.resolve(true);
        await loads;
        expect(count.opened()).toBe(1);
        expect(state.calls).toHaveLength(6);
        expect(verwaltung.people.value.map((person) => person.displayName)).toEqual(["Rondrikan"]);
        expect(verwaltung.loadProblems.size).toBe(0);
        expect(verwaltung.unconfirmed.size).toBe(0);
        expect(betrieb.unconfirmed.value).toBeNull();
        expect(betrieb.loadProblems.value).toEqual([]);
        count.stop();
    });

    it("🔴 abgebrochen: alle enden mit dem Satz, was fehlt; kein Leseweg fragt von selbst wieder; „Bestätigen“ fragt einmal für alle", async () => {
        const { state, fetcher } = server();
        const count = windows();
        const lesen = createReadConfirmation();
        const verwaltung = createAdministration({ fetcher, reads: lesen });
        const betrieb = createOperations({ fetcher, reads: lesen });
        const loads = Promise.all([verwaltung.loadPeople(), verwaltung.loadInvitations(), betrieb.load()]);
        await vi.waitFor(() => expect(pendingConfirmation.value).not.toBeNull());
        await vi.waitFor(() => expect(state.calls).toHaveLength(3));
        pendingConfirmation.value?.resolve(false);
        await loads;
        expect(count.opened()).toBe(1);
        expect(verwaltung.unconfirmed.get("people")).toBe("second_factor");
        expect(verwaltung.unconfirmed.get("invitations")).toBe("second_factor");
        expect(verwaltung.loadProblems.get("people")).toEqual([{ key: "auth.form.assurance" }]);
        expect(betrieb.unconfirmed.value).toBe("second_factor");

        // Ein weiterer Leseweg danach (die Person wählt „Rollen“): kein neues Fenster, nur die Zeile.
        await verwaltung.loadRoles();
        expect(count.opened()).toBe(1);
        expect(pendingConfirmation.value).toBeNull();
        expect(verwaltung.unconfirmed.get("roles")).toBe("second_factor");

        // Der Knopf in der Zeile: ein Fenster für alle vier, bestätigt, laden alle.
        verwaltung.confirmAgain();
        await vi.waitFor(() => expect(pendingConfirmation.value).not.toBeNull());
        await vi.waitFor(() => expect(state.calls).toHaveLength(8));
        state.confirmed = true;
        pendingConfirmation.value?.resolve(true);
        await vi.waitFor(() => expect(verwaltung.unconfirmed.size).toBe(0));
        await vi.waitFor(() => expect(betrieb.unconfirmed.value).toBeNull());
        expect(count.opened()).toBe(2);
        expect(verwaltung.roles.value).toEqual({ operators: [], grants: [] });
        expect(verwaltung.invitations.value).toEqual([]);
        expect(verwaltung.loadProblems.size).toBe(0);
        count.stop();
    });

    it("eine strengere Frage hebt das offene Fenster auf ihren Bedarf, statt ein zweites zu öffnen", async () => {
        const count = windows();
        const first = requestConfirmation("confirmation");
        const second = requestConfirmation("passkey");
        const third = requestConfirmation("second_factor");
        expect(second).toBe(first);
        expect(third).toBe(first);
        expect(pendingConfirmation.value?.need).toBe("passkey");
        pendingConfirmation.value?.resolve(true);
        expect(await Promise.all([first, second, third])).toEqual([true, true, true]);
        expect(count.opened()).toBe(1);
        expect(pendingConfirmation.value).toBeNull();
        count.stop();
    });

    it("🔴 eine Antwort, die vor der Bestätigung abging und danach ankommt, wiederholt ohne neues Fenster", async () => {
        const count = windows();
        const refusal = () => new ApiFailure(403, "assurance_required", "x", { need: "second_factor" });
        let firstRuns = 0;
        const first = withConfirmation(async () => {
            firstRuns += 1;
            if (firstRuns === 1) throw refusal();
            return "erste";
        });
        // Die zweite Anfrage ist unterwegs, während die Person bestätigt; ihre Ablehnung kommt erst danach an.
        let release: () => void = () => undefined;
        const held = new Promise<void>((resolve) => (release = resolve));
        let secondRuns = 0;
        const second = withConfirmation(async () => {
            secondRuns += 1;
            if (secondRuns === 1) {
                await held;
                throw refusal();
            }
            return "zweite";
        });
        await vi.waitFor(() => expect(pendingConfirmation.value).not.toBeNull());
        pendingConfirmation.value?.resolve(true);
        expect(await first).toBe("erste");
        release();
        expect(await second).toBe("zweite");
        expect(count.opened()).toBe(1);
        expect(pendingConfirmation.value).toBeNull();
        count.stop();
    });

    it("eine abgebrochene Handlung lässt das Neuladen danach nicht wieder fragen", async () => {
        const { state, fetcher } = server();
        const count = windows();
        const asked: string[] = [];
        const verwaltung = createAdministration({
            fetcher,
            ask: async (need) => {
                asked.push(need);
                return false;
            },
        });
        const person = { id: "p", revision: 1, accessRevision: 1 } as never;
        const result = await verwaltung.lock(person, "Spam");
        expect(result.ok).toBe(false);
        // Gefragt hat nur die Handlung; das Neuladen der Liste endet ohne Fenster mit der Zeile.
        expect(asked).toEqual(["second_factor"]);
        expect(state.calls).toEqual(["/api/admin/people/lock", "/api/admin/people"]);
        expect(verwaltung.unconfirmed.get("people")).toBe("second_factor");
        expect(count.opened()).toBe(0);
        count.stop();
    });
});
