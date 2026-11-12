import { describe, expect, it } from "vitest";
import { ApiFailure } from "../src/auth/api.ts";
import { neededConfirmation, withConfirmation } from "../src/auth/bestaetigen.ts";
import { createInvitationFlow } from "../src/auth/einladung.ts";
import { formProblems } from "../src/auth/formular.ts";
import { createAccount } from "../src/auth/konto.ts";
import { createAccessLinkFlow } from "../src/auth/zugangslink.ts";

/**
 * Die Fenster der Anmeldung ohne Oberfläche (WI-0120 A9): Einladung, Rücksetzlink und Notzugang, Kurz bestätigen, Konto.
 * Jede Ablehnung wird ein eigener Satz; eine verlangte Bestätigung wiederholt die Handlung genau einmal mit derselben Kennung.
 */
type Answer = { status: number; body?: unknown };

function server(...answers: Answer[]) {
    const calls: { url: string; body: Record<string, unknown> | undefined }[] = [];
    const fetcher = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        calls.push({ url: String(url), body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
        const answer = answers.shift() ?? { status: 500 };
        return new Response(answer.body === undefined ? "" : JSON.stringify(answer.body), { status: answer.status });
    };
    return { calls, fetcher: fetcher as typeof fetch };
}

const envelope = (code: string, details?: Record<string, unknown>) => ({
    error: { code, message: "vom Server", details },
});
const TOKEN = "T".repeat(43);

describe("Sätze zu Ablehnungen", () => {
    it("🔴 ein abgelehntes Passwort nennt jede Regel; das fehlende alte Passwort ist kein Bestätigungsfall", () => {
        const rejected = new ApiFailure(400, "password_rejected", "x", { problems: ["too_short", "contextual"] });
        expect(formProblems(rejected)).toEqual([
            { key: "auth.password.problem.tooShort" },
            { key: "auth.password.problem.contextual" },
        ]);
        const missing = new ApiFailure(403, "reauth_required", "x", { need: "current_password" });
        expect(formProblems(missing)).toEqual([{ key: "auth.account.password.currentMissing" }]);
        expect(neededConfirmation(missing)).toBeNull();
        expect(formProblems(new ApiFailure(418, "unbekannt", "x"))).toEqual([{ key: "auth.form.failed" }]);
    });
});

describe("Kurz bestätigen", () => {
    it("🔴 verlangt der Server einen Passkey, wird gefragt und genau einmal wiederholt; abgebrochen bleibt der Fehler", async () => {
        const asked: string[] = [];
        let runs = 0;
        const action = async () => {
            runs += 1;
            if (runs === 1) throw new ApiFailure(403, "reauth_required", "x", { need: "passkey" });
            return "ok";
        };
        expect(
            await withConfirmation(action, async (need) => {
                asked.push(need);
                return true;
            }),
        ).toBe("ok");
        expect(asked).toEqual(["passkey"]);
        runs = 0;
        await expect(withConfirmation(action, async () => false)).rejects.toMatchObject({ code: "reauth_required" });
        expect(runs).toBe(1);
    });
});

describe("Einladung", () => {
    it("🔴 ansehen, dann mit Passwort annehmen; abgelaufen heißt ungültig; abgelehntes Passwort nennt die Regel", async () => {
        let reloaded = 0;
        const { calls, fetcher } = server(
            {
                status: 200,
                body: {
                    role: "editor",
                    environment: "staging",
                    expiresAt: "2026-10-16T10:00:00.000Z",
                    invitedBy: "Rondrikan",
                    requiresDiscord: false,
                },
            },
            { status: 400, body: envelope("password_rejected", { problems: ["common"] }) },
            { status: 200, body: { ok: true } },
        );
        const flow = createInvitationFlow(TOKEN, { fetcher, reload: () => (reloaded += 1) });
        await flow.inspect();
        expect(flow.state.value).toBe("bereit");
        expect(flow.info.value?.invitedBy).toBe("Rondrikan");
        flow.loginName.value = " hesindian ";
        flow.displayName.value = "Hesindian";
        flow.password.value = "passwort";
        await flow.accept();
        expect(flow.problems.value).toEqual([{ key: "auth.password.problem.common" }]);
        flow.password.value = "Ein Satz zur Begrüßung in Gareth";
        await flow.accept();
        expect(reloaded).toBe(1);
        expect(calls[2]?.body).toEqual({
            token: TOKEN,
            loginName: "hesindian",
            displayName: "Hesindian",
            password: "Ein Satz zur Begrüßung in Gareth",
        });
        const gone = createInvitationFlow(TOKEN, {
            fetcher: server({ status: 400, body: envelope("invitation_invalid") }).fetcher,
        });
        await gone.inspect();
        expect(gone.state.value).toBe("ungueltig");
        expect(createInvitationFlow(null).state.value).toBe("unvollstaendig");
    });
});

describe("Rücksetzlink und Notzugang", () => {
    it("🔴 erstes Konto: der Benutzername geht mit; Notzugang mit falschem Passwort leert das Feld", async () => {
        const reset = server(
            {
                status: 200,
                body: { kind: "password_reset", displayName: "Rondrikan", loginName: null, expiresAt: "x" },
            },
            { status: 200, body: { ok: true } },
        );
        const flow = createAccessLinkFlow("password_reset", TOKEN, { fetcher: reset.fetcher, reload: () => undefined });
        await flow.inspect();
        flow.loginName.value = " rondrikan ";
        flow.password.value = "Sternenstaub ueber Gareth";
        await flow.submit();
        expect(reset.calls[1]).toEqual({
            url: "/api/auth/password-reset",
            body: { token: TOKEN, password: "Sternenstaub ueber Gareth", loginName: "rondrikan" },
        });
        const recovery = server(
            {
                status: 200,
                body: { kind: "recovery", displayName: "Rondrikan", loginName: "rondrikan", expiresAt: "x" },
            },
            { status: 401, body: envelope("invalid_credentials") },
        );
        const notzugang = createAccessLinkFlow("recovery", TOKEN, { fetcher: recovery.fetcher });
        await notzugang.inspect();
        notzugang.password.value = "falsch";
        await notzugang.submit();
        expect(notzugang.password.value).toBe("");
        expect(notzugang.problems.value).toEqual([{ key: "auth.login.error.credentials" }]);
        expect(recovery.calls[1]?.url).toBe("/api/auth/recovery");
    });
});

describe("Eigenes Konto", () => {
    const DETAIL = {
        person: { id: "p", revision: 3 },
        loginName: "rondrikan",
        passkeys: [],
        sessions: [],
        specialCapabilities: [],
        legacy: [],
    };

    it("🔴 Anzeigename mit der gesehenen Revision; Passwort nach verlangter Bestätigung mit DERSELBEN Kennung erneut", async () => {
        const { calls, fetcher } = server(
            { status: 200, body: DETAIL },
            { status: 200, body: { status: "applied" } },
            { status: 200, body: DETAIL },
            { status: 403, body: envelope("reauth_required", { need: "confirmation" }) },
            { status: 200, body: { status: "applied" } },
            { status: 200, body: DETAIL },
        );
        const asked: string[] = [];
        const konto = createAccount({
            fetcher,
            ask: async (need) => {
                asked.push(need);
                return true;
            },
        });
        await konto.load();
        expect(await konto.rename("Neuer Name")).toBe(true);
        expect(calls[1]?.body).toMatchObject({ displayName: "Neuer Name", baseRevision: 3 });
        expect(await konto.changePassword({ current: "", next: "Ein neuer langer Satz für Gareth" })).toBe(true);
        expect(asked).toEqual(["confirmation"]);
        expect(calls[3]?.body?.["operationId"]).toBe(calls[4]?.body?.["operationId"]);
        expect(calls[4]?.body).not.toHaveProperty("currentPassword");
    });
});
