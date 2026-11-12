import { describe, expect, it } from "vitest";
import { ApiFailure } from "../src/auth/api.ts";
import {
    createLogin,
    discordReturnPath,
    loginProblem,
    problemPhrase,
    startDiscord,
    waitPhrase,
} from "../src/auth/anmelden.ts";

/**
 * Das Anmeldefenster ohne Oberfläche (WI-0120 A9; Blatt A8): Jede Ablehnung des Servers wird ein eigener Satz, nie der Text
 * des Servers; eine Drossel zählt herunter; abgewiesen bleibt der Name stehen, das Passwort nicht; nach der Anmeldung lädt
 * die Seite neu; vor Discord wird der Kartenausschnitt gemerkt.
 */
type Call = { url: string; init: RequestInit | undefined };

function server(...answers: { status: number; body?: unknown }[]) {
    const calls: Call[] = [];
    const fetcher = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        calls.push({ url: String(url), init });
        const answer = answers.shift() ?? { status: 500 };
        return new Response(answer.body === undefined ? "" : JSON.stringify(answer.body), { status: answer.status });
    };
    return { calls, fetcher: fetcher as typeof fetch };
}

describe("Anmelden", () => {
    it("🔴 Ablehnungen werden eigene Sätze; die Drossel nennt Sekunden, dann aufgerundete Minuten", () => {
        const now = 1_000_000;
        const failure = (code: string, details?: Record<string, unknown>) => new ApiFailure(400, code, "x", details);
        expect(loginProblem(failure("invalid_credentials"), now)).toEqual({ kind: "credentials" });
        expect(loginProblem(failure("account_locked"), now)).toEqual({ kind: "locked" });
        expect(loginProblem(failure("password_disabled"), now)).toEqual({ kind: "passwordDisabled" });
        expect(loginProblem(new Error("x"), now)).toEqual({ kind: "failed" });
        const throttled = loginProblem(failure("rate_limited", { retryAfterSeconds: 90 }), now);
        expect(throttled).toEqual({ kind: "throttled", until: now + 90_000 });
        expect(problemPhrase(throttled, now)).toEqual({ key: "auth.login.error.throttled.other", params: { n: 2 } });
        expect(problemPhrase(throttled, now + 30_000)).toEqual({
            key: "auth.login.error.throttled.one",
            params: { n: 1 },
        });
        expect(problemPhrase(throttled, now + 85_000)).toEqual({
            key: "auth.login.error.throttledSeconds",
            params: { n: 5 },
        });
        expect(waitPhrase(now + 90_000, now)).toEqual({ key: "auth.login.wait.other", params: { n: 2 } });
    });

    it("🔴 abgewiesen: Name bleibt, Passwort leer; angenommen: neu laden; Name ohne Leerzeichen am Rand", async () => {
        let reloaded = 0;
        const { calls, fetcher } = server(
            { status: 401, body: { error: { code: "invalid_credentials", message: "x" } } },
            { status: 200, body: { ok: true } },
        );
        const login = createLogin({ fetcher, reload: () => (reloaded += 1) });
        login.name.value = " Rondrikan ";
        login.password.value = "falsch-falsch-falsch";
        await login.submit();
        expect(login.problem.value).toEqual({ kind: "credentials" });
        expect(login.name.value).toBe(" Rondrikan ");
        expect(login.password.value).toBe("");
        login.password.value = "Sternenstaub ueber Gareth";
        await login.submit();
        expect(reloaded).toBe(1);
        expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
            loginName: "Rondrikan",
            password: "Sternenstaub ueber Gareth",
        });
        expect(calls[1]?.init?.headers).toMatchObject({ "content-type": "application/json" });
    });

    it("🔴 zwei Faktoren oder keiner (2026-10-10): Admin mit Passwort allein bekommt gleich „Mit Passkey bestätigen“", async () => {
        const ADMIN = ["manage_people", "manage_invitations", "view_operations"];
        const basic = { assurance: "basic" as const };
        let reloaded = 0;
        let passkeys = 0;
        let refuse = true;
        const { fetcher } = server({ status: 200, body: { ok: true } });
        const login = createLogin({
            fetcher,
            reload: () => (reloaded += 1),
            session: async () => ({ person: basic as never, capabilities: ADMIN }),
            passkey: async () => {
                passkeys += 1;
                if (refuse) throw new ApiFailure(400, "passkey_rejected", "x");
            },
        });
        login.name.value = "Rondrikan";
        login.password.value = "Sternenstaub ueber Gareth";
        await login.submit();
        // Angemeldet, aber noch nicht neu geladen: der zweite Schritt im selben Fenster.
        expect(login.secondFactor.value).toBe(true);
        expect(reloaded).toBe(0);
        expect(login.password.value).toBe("");
        await login.confirmPasskey();
        expect(login.secondFactorProblems.value).toEqual([{ key: "auth.passkey.rejected" }]);
        expect(reloaded).toBe(0);
        refuse = false;
        await login.confirmPasskey();
        expect(passkeys).toBe(2);
        expect(reloaded).toBe(1);

        // Ein Editor ohne Verwaltungsrechte, oder ein Admin mit zweitem Faktor: kein zweiter Schritt, gleich neu laden.
        for (const session of [
            {
                person: basic as never,
                capabilities: ["edit_map_objects", "suspend_media_publication", "edit_territories", "edit_landscapes"],
            },
            { person: { assurance: "strong" } as never, capabilities: ADMIN },
        ]) {
            let again = 0;
            const other = createLogin({
                fetcher: server({ status: 200, body: { ok: true } }).fetcher,
                reload: () => (again += 1),
                session: async () => session,
            });
            await other.submit();
            expect(other.secondFactor.value).toBe(false);
            expect(again).toBe(1);
        }
    });

    it("🔴 gedrosselt: kein weiterer Versuch, bis die Zeit um ist", async () => {
        let now = 0;
        const { calls, fetcher } = server({
            status: 429,
            body: { error: { code: "rate_limited", message: "x", details: { retryAfterSeconds: 120 } } },
        });
        const login = createLogin({ fetcher, now: () => now, reload: () => undefined });
        await login.submit();
        await login.submit();
        expect(calls).toHaveLength(1);
        now = 121_000;
        await login.submit();
        expect(calls).toHaveLength(2);
    });

    it("🔴 Discord: Umweg anlegen mit Rückkehrpfad, Ausschnitt merken, hinüber", async () => {
        const { calls, fetcher } = server({
            status: 200,
            body: { authorizeUrl: "https://discord.test/oauth2/authorize?x=1" },
        });
        let target = "";
        await startDiscord(
            { purpose: "invitation", invitationToken: "T".repeat(43) },
            {
                fetcher,
                assign: (url) => (target = url),
                location: { pathname: "/", search: "?von=Gareth", hash: "#x=1&z=5" },
            },
        );
        expect(target).toBe("https://discord.test/oauth2/authorize?x=1");
        expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
            purpose: "invitation",
            // Ohne Sitzung über `/anmelden`: hinter der Stage-Tür der einzige Einstieg ohne Anmeldung (WI-0120 R6).
            returnPath: "/anmelden?von=Gareth",
            invitationToken: "T".repeat(43),
        });
    });

    it("🔴 Stage-Tür (WI-0120 R6): ohne Sitzung kehrt Discord über `/anmelden` zurück, mit Sitzung, wo der Umweg begann", () => {
        const here = { pathname: "/edit", search: "?route=Gareth~Fasar" };
        expect(discordReturnPath("login", here)).toBe("/anmelden?route=Gareth~Fasar");
        expect(discordReturnPath("invitation", here)).toBe("/anmelden?route=Gareth~Fasar");
        expect(discordReturnPath("link", here)).toBe("/edit?route=Gareth~Fasar");
        expect(discordReturnPath("confirm", here)).toBe("/edit?route=Gareth~Fasar");
        // Länger als der Server annimmt (300): ohne Abfrage, statt dass der Umweg mit 400 scheitert.
        expect(discordReturnPath("login", { pathname: "/edit", search: `?route=${"A".repeat(300)}` })).toBe(
            "/anmelden",
        );
    });
});
