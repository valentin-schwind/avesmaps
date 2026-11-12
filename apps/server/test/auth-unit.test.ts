import { describe, expect, it } from "vitest";
import { checkAssurance } from "../src/auth/assurance.ts";
import { filterDetails } from "../src/auth/audit.ts";
import { clientLabel } from "../src/auth/client-label.ts";
import { DEFAULT_SESSION, loadAuthConfig, sessionCookieName, type AuthConfig } from "../src/auth/config.ts";
import { relyingPartyFor } from "../src/auth/passkeys.ts";
import { parseCookies, serializeCookie } from "../src/auth/cookies.ts";
import { effectiveAssurance, type SessionRecord } from "../src/auth/session-store.ts";
import { isWellFormedToken, randomToken, tokenHash } from "../src/auth/tokens.ts";
import { requestLogValue } from "../src/log-address.ts";

/** Bausteine der Anmeldung ohne Datenbank (WI-0120 A3). */

describe("Umgebung und Einstellungen", () => {
    it("🔴 ohne AVESMAPS_ENV in einem Release bleibt die Anmeldung aus; lokal ist es development", () => {
        expect(loadAuthConfig({ RELEASE_ID: "20261009T000000Z-abc" }).environment).toBeUndefined();
        expect(loadAuthConfig({}).environment).toBe("development");
        expect(loadAuthConfig({ RELEASE_ID: "dev" }).environment).toBe("development");
    });

    // 🔴 Berichtigt im Qualitätsreview 2026-10-12: Auch lokal ist die Vorgabe die Besucheransicht (Betreiber 2026-10-12: „da kommen
    // sachen für editoren obwohl ich nicht eingeloggt bin“). Die Übergangsansicht gibt es nur auf ausdrücklichen Wunsch; vorher stand
    // die Vorgabe nur im Startskript, und `npm run dev:server` sah sie nie.
    it("🔴 ohne Anmeldung überall die Besucheransicht; die Übergangsansicht nur auf Wunsch und nur lokal", () => {
        expect(loadAuthConfig({}).anonymousView).toBe("visitor");
        expect(loadAuthConfig({ AUTH_ANONYMOUS_VIEW: "editor" }).anonymousView).toBe("editor");
        expect(loadAuthConfig({ AUTH_ANONYMOUS_VIEW: "visitor" }).anonymousView).toBe("visitor");
        const stage = { AVESMAPS_ENV: "staging", PUBLIC_ORIGIN: "https://stage.avesmaps.de" };
        expect(loadAuthConfig(stage).anonymousView).toBe("visitor");
        // Startsperre (Betreiber 2026-10-17): auf der Stage nicht mehr.
        expect(() => loadAuthConfig({ ...stage, AUTH_ANONYMOUS_VIEW: "editor" })).toThrow(/nur lokal/u);
        expect(loadAuthConfig({ AVESMAPS_ENV: "production", PUBLIC_ORIGIN: "https://avesmaps.de" }).anonymousView).toBe(
            "visitor",
        );
    });

    it("🔴 Stage und Production brauchen eine https-Herkunft; unsichere Cookies nur lokal; Übergangsansicht nie in Production", () => {
        expect(() => loadAuthConfig({ AVESMAPS_ENV: "staging" })).toThrow(/PUBLIC_ORIGIN/u);
        expect(() => loadAuthConfig({ AVESMAPS_ENV: "staging", PUBLIC_ORIGIN: "http://stage.avesmaps.de" })).toThrow(
            /https/u,
        );
        expect(() =>
            loadAuthConfig({
                AVESMAPS_ENV: "staging",
                PUBLIC_ORIGIN: "https://stage.avesmaps.de",
                AUTH_INSECURE_COOKIE: "1",
            }),
        ).toThrow(/lokalen Entwicklung/u);
        expect(() =>
            loadAuthConfig({
                AVESMAPS_ENV: "production",
                PUBLIC_ORIGIN: "https://avesmaps.de",
                AUTH_ANONYMOUS_VIEW: "editor",
            }),
        ).toThrow(/nur lokal/u);
        // Startsperre (Betreiber 2026-10-17): `development` mit `NODE_ENV=production` startet nicht; ohne Angabe bleibt es lokal.
        expect(() => loadAuthConfig({ AVESMAPS_ENV: "development", NODE_ENV: "production" })).toThrow(/NODE_ENV/u);
        expect(loadAuthConfig({ AVESMAPS_ENV: "development", NODE_ENV: "development" }).environment).toBe(
            "development",
        );
        expect(() => loadAuthConfig({ AVESMAPS_ENV: "irgendwo" })).toThrow(/bekannte Umgebung/u);
        const stage = loadAuthConfig({ AVESMAPS_ENV: "staging", PUBLIC_ORIGIN: "https://stage.avesmaps.de/" });
        expect(stage.publicOrigin).toBe("https://stage.avesmaps.de");
        expect(sessionCookieName(stage)).toBe("__Host-avesmaps-session");
        expect(sessionCookieName(loadAuthConfig({ AUTH_INSECURE_COOKIE: "1" }))).toBe("avesmaps-session");
    });
});

describe("Cookies und Tokens", () => {
    it("liest den ersten Wert eines Namens und schreibt nur HttpOnly, Path=/, ohne Domain", () => {
        const cookies = parseCookies('a=1; __Host-avesmaps-session=abc; a=2; leer=; "x"; b="q"');
        expect(cookies.get("a")).toBe("1");
        expect(cookies.get("__Host-avesmaps-session")).toBe("abc");
        expect(cookies.get("b")).toBe("q");
        expect(serializeCookie("__Host-avesmaps-session", "abc", { secure: true })).toBe(
            "__Host-avesmaps-session=abc; Path=/; HttpOnly; SameSite=Lax; Secure",
        );
        expect(serializeCookie("x", "", { secure: false, maxAge: 0 })).toBe(
            "x=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
        );
        expect(() => serializeCookie("x", "a;b", { secure: true })).toThrow();
    });

    it("Tokens: 256 Bit, base64url, Hash 32 Byte; Fremdes wird gar nicht erst nachgeschlagen", () => {
        const token = randomToken();
        expect(isWellFormedToken(token)).toBe(true);
        expect(randomToken()).not.toBe(token);
        expect(tokenHash(token)).toHaveLength(32);
        expect(isWellFormedToken("kurz")).toBe(false);
        expect(isWellFormedToken(`${token}'; DROP TABLE x;--`)).toBe(false);
    });
});

describe("Sicherheitsstufen (AUTH-0001 §11.2)", () => {
    const config: AuthConfig = {
        environment: "test",
        publicOrigin: undefined,
        insecureCookie: false,
        anonymousView: "visitor",
        session: DEFAULT_SESSION,
    };
    const now = new Date("2026-10-09T12:00:00Z");
    const ago = (minutes: number): Date => new Date(now.getTime() - minutes * 60_000);
    const session = (overrides: Partial<SessionRecord>): SessionRecord => ({
        id: "s",
        personId: "p",
        displayName: "P",
        role: "operator",
        grants: [],
        sonderrollen: [],
        environment: "test",
        method: "discord",
        assurance: "strong",
        createdAt: ago(10),
        lastSeenAt: ago(1),
        confirmedAt: ago(1),
        passkeyConfirmedAt: null,
        expiresAt: ago(-1000),
        idleExpiresAt: ago(-1000),
        rotateRequired: false,
        ...overrides,
    });

    it("R immer, V mit zweitem Faktor ohne Frist (Betreiber 2026-10-10), S nur mit Passkey ≤ 5 min", () => {
        expect(checkAssurance(session({ assurance: "basic" }), "edit_map_objects", config, undefined, now)).toEqual({
            ok: true,
        });
        expect(checkAssurance(session({ assurance: "basic" }), "manage_people", config, undefined, now)).toMatchObject({
            code: "assurance_required",
            need: "second_factor",
        });
        expect(checkAssurance(session({}), "manage_people", config, undefined, now)).toEqual({ ok: true });
        // Zweiter Faktor von gestern, seit Stunden keine Anfrage: Die Verwaltung bleibt offen, solange die Sitzung lebt.
        const yesterday = session({ confirmedAt: ago(20 * 60), lastSeenAt: ago(9 * 60) });
        expect(checkAssurance(yesterday, "manage_people", config, undefined, now)).toEqual({ ok: true });
        expect(checkAssurance(yesterday, "view_operations", config, undefined, now)).toEqual({ ok: true });
        expect(checkAssurance(session({}), "assign_admin", config, undefined, now)).toMatchObject({ need: "passkey" });
        expect(checkAssurance(session({ passkeyConfirmedAt: ago(4) }), "assign_admin", config, undefined, now)).toEqual(
            { ok: true },
        );
        expect(
            checkAssurance(session({ passkeyConfirmedAt: ago(6) }), "assign_admin", config, undefined, now),
        ).toMatchObject({
            need: "passkey",
        });
    });

    it("🔴 der zweite Faktor ist allein der Passkey: `strong` ohne Passkey-Nachweis (Discord-2FA, vor 2026-10-10) gilt als `basic`", () => {
        // Betreiber 2026-10-10, „4. B“: „Für die Verwaltung immer den Passkey verlangen; Discord-Nutzer mit Verwaltungsrechten
        // bestätigen einmal je Sitzung.“
        expect(effectiveAssurance("strong", null)).toBe("basic");
        expect(effectiveAssurance("strong", ago(24 * 60))).toBe("strong");
        expect(effectiveAssurance("basic", null)).toBe("basic");
        expect(effectiveAssurance("recovery", null)).toBe("recovery");
        const legacy = session({ assurance: effectiveAssurance("strong", null) });
        expect(checkAssurance(legacy, "manage_people", config, undefined, now)).toMatchObject({
            code: "assurance_required",
            need: "second_factor",
        });
    });

    it("eine Bestätigung `recent` ist höchstens 15 Minuten alt, `passkey` höchstens 5", () => {
        expect(checkAssurance(session({ confirmedAt: ago(16) }), "assign_roles", config, "recent", now)).toMatchObject({
            code: "reauth_required",
        });
        expect(checkAssurance(session({ confirmedAt: ago(14) }), "assign_roles", config, "recent", now)).toEqual({
            ok: true,
        });
        expect(checkAssurance(session({}), "edit_map_objects", config, "passkey", now)).toMatchObject({
            need: "passkey",
        });
    });

    describe("Tagesfenster (Vali 2026-11-07)", () => {
        const stage = loadAuthConfig({ AVESMAPS_ENV: "staging", PUBLIC_ORIGIN: "https://stage.avesmaps.de" });
        const lokal = loadAuthConfig({});
        const production = loadAuthConfig({ AVESMAPS_ENV: "production", PUBLIC_ORIGIN: "https://avesmaps.de" });
        const tests = loadAuthConfig({ AVESMAPS_ENV: "test" });
        const unbenannt = loadAuthConfig({ RELEASE_ID: "r1" });
        const STUNDEN = 60;

        it.each([
            ["Stage", stage],
            ["lokal", lokal],
        ])("%s: ein Passkey hält 24 Stunden, für Stufe S und für beide Bestätigungen", (_name, hier) => {
            const heute = session({ passkeyConfirmedAt: ago(23 * STUNDEN), confirmedAt: ago(23 * STUNDEN) });
            const gestern = session({ passkeyConfirmedAt: ago(25 * STUNDEN), confirmedAt: ago(25 * STUNDEN) });
            expect(checkAssurance(heute, "assign_admin", hier, undefined, now)).toEqual({ ok: true });
            expect(checkAssurance(heute, "edit_map_objects", hier, "passkey", now)).toEqual({ ok: true });
            expect(checkAssurance(heute, "assign_roles", hier, "recent", now)).toEqual({ ok: true });
            expect(checkAssurance(gestern, "assign_admin", hier, undefined, now)).toMatchObject({ need: "passkey" });
            expect(checkAssurance(gestern, "assign_roles", hier, "recent", now)).toMatchObject({
                need: "confirmation",
            });
        });

        it.each([
            ["Stage", stage],
            ["lokal", lokal],
        ])("%s: Auch die Release-Rechte fragen einmal am Tag (Antwortknopf „Ja, auch Release“)", (_name, hier) => {
            for (const recht of ["release_to_production", "release_map_series"] as const) {
                expect(
                    checkAssurance(session({ passkeyConfirmedAt: ago(23 * STUNDEN) }), recht, hier, "passkey", now),
                ).toEqual({ ok: true });
                expect(
                    checkAssurance(session({ passkeyConfirmedAt: ago(25 * STUNDEN) }), recht, hier, "passkey", now),
                ).toMatchObject({ need: "passkey" });
            }
        });

        it("🔴 Production: Die Release-Rechte fragen weiter im Moment", () => {
            for (const recht of ["release_to_production", "release_map_series"] as const) {
                expect(
                    checkAssurance(session({ passkeyConfirmedAt: ago(6) }), recht, production, "passkey", now),
                ).toMatchObject({ need: "passkey" });
            }
        });

        it.each([
            ["Production", production],
            ["die Tests", tests],
            ["ein Release ohne benannte Umgebung", unbenannt],
        ])("🔴 %s: bleibt bei 5 und 15 Minuten", (_name, hier) => {
            expect(hier.session).toEqual(DEFAULT_SESSION);
            expect(
                checkAssurance(session({ passkeyConfirmedAt: ago(6) }), "assign_admin", hier, undefined, now),
            ).toMatchObject({ need: "passkey" });
            expect(
                checkAssurance(session({ confirmedAt: ago(16) }), "assign_roles", hier, "recent", now),
            ).toMatchObject({
                need: "confirmation",
            });
        });
    });
});

describe("Protokoll und Logs ohne Geheimnisse (T14)", () => {
    it("🔴 `details` nur aus der Positivliste; ein fremder Schlüssel lässt den Test scheitern", () => {
        expect(filterDetails("login.success", { method: "discord", assurance: "strong" })).toEqual({
            method: "discord",
            assurance: "strong",
        });
        expect(() => filterDetails("login.success", { method: "password", password: "geheim" })).toThrow(
            /Positivliste/u,
        );
    });

    it("🔴 die Anfragezeile unter /api/auth/ trägt keine Query (Discords `code` und `state`)", () => {
        const request = { method: "GET", headers: {}, host: "x", ip: "127.0.0.1", socket: undefined } as never;
        expect(
            requestLogValue({ ...(request as object), url: "/api/auth/discord/callback?code=geheim&state=s" } as never)
                .url,
        ).toBe("/api/auth/discord/callback");
        expect(requestLogValue({ ...(request as object), url: "/api/search?q=Gareth" } as never).url).toBe(
            "/api/search?q=Gareth",
        );
    });

    it("das Gerät nur grob", () => {
        expect(
            clientLabel(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
            ),
        ).toBe("Chrome · Windows");
        expect(
            clientLabel(
                "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1",
            ),
        ).toBe("Safari · iOS");
        expect(clientLabel(undefined)).toBeUndefined();
    });
});

/** Passkeys lokal auf der HTTPS-Adresse im Tailnet (WI-0180 §13). */
describe("Relying Party lokal", () => {
    const NAME = "rechner.tailnet-test.ts.net";
    const lokal = loadAuthConfig({ RELEASE_ID: "dev", AUTH_LOCAL_HTTPS_HOST: NAME.toUpperCase() });
    const anfrage = (host: string | undefined) => ({ headers: host === undefined ? {} : { host } });

    it("🔴 nimmt den eingestellten Namen als RP-ID, nur über https; localhost bleibt", () => {
        expect(lokal.localHttpsHost).toBe(NAME);
        expect(relyingPartyFor(lokal, anfrage(NAME))).toEqual({ rpId: NAME, origins: [`https://${NAME}`] });
        expect(relyingPartyFor(lokal, anfrage(`${NAME}:8443`))).toEqual({
            rpId: NAME,
            origins: [`https://${NAME}:8443`],
        });
        expect(relyingPartyFor(lokal, anfrage("localhost:5173"))?.rpId).toBe("localhost");
    });

    it("🔴 jeder andere Host, auch ein anderer ts.net-Name, bekommt keine Passkeys", () => {
        for (const host of ["anderer.tailnet-test.ts.net", "100.102.26.41:5174", "evil.example", undefined])
            expect(relyingPartyFor(lokal, anfrage(host)), String(host)).toBeUndefined();
        const ohne = loadAuthConfig({ RELEASE_ID: "dev" });
        expect(ohne.localHttpsHost).toBeUndefined();
        expect(relyingPartyFor(ohne, anfrage(NAME))).toBeUndefined();
    });

    it("🔴 nur in der lokalen Entwicklung und nur mit einem Hostnamen", () => {
        expect(() =>
            loadAuthConfig({
                RELEASE_ID: "r1",
                AVESMAPS_ENV: "staging",
                PUBLIC_ORIGIN: "https://stage.avesmaps.de",
                AUTH_LOCAL_HTTPS_HOST: NAME,
            }),
        ).toThrow(/nur in der lokalen Entwicklung/u);
        expect(() => loadAuthConfig({ RELEASE_ID: "dev", AUTH_LOCAL_HTTPS_HOST: "https://x.ts.net" })).toThrow(
            /kein Hostname/u,
        );
    });
});
