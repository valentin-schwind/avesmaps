import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AdminPerson, AuditEntry } from "@avesmaps3d/shared";
import { ApiFailure } from "../src/auth/api.ts";
import { formProblems } from "../src/auth/formular.ts";
import { createAccount } from "../src/auth/konto.ts";
import { mayEditResponsibility } from "../src/auth/verantwortung.ts";
import { createAdministration } from "../src/auth/verwaltung.ts";
import { describeEvent } from "../src/auth/verwaltung-text.ts";
import { t } from "../src/i18n/i18n.ts";

/**
 * „Verantwortlich für:“ ohne Oberfläche (WI-0133, Betreiber 2026-10-10): Konto und Personenansicht schicken den Text an den
 * richtigen Weg und mit der gesehenen Revision, eine zweite Zeile oder eine Überlänge wird ein eigener Satz, das Protokoll nennt
 * nie den Text, und „Ändern“ steht nur bei der eigenen Person und beim Betreiber.
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
const RECEIPT = { status: 200, body: { status: "applied" } };

const PERSON: AdminPerson = {
    id: "5b1d0c9e-3f4a-4e7b-9a2c-1d2e3f4a5b6c",
    displayName: "Traviabold",
    status: "active",
    revision: 4,
    role: "editor",
    access: "active",
    accessRevision: 7,
    methods: ["discord"],
    passwordDisabled: false,
    passkeyCount: 0,
    activeSessions: 1,
    grants: [],
    createdAt: "2026-09-01T10:00:00.000Z",
    lastLoginAt: null,
    lastSeenAt: null,
    invitedBy: null,
    lockReason: null,
    lockedAt: null,
    lockedBy: null,
    responsibleFor: "Redaktion Garetien",
    self: false,
    manageable: true,
};

describe("Konto", () => {
    const DETAIL = {
        person: { id: "p", revision: 3, responsibleFor: null },
        loginName: "rondrikan",
        passkeys: [],
        sessions: [],
        specialCapabilities: [],
        legacy: [],
    };

    it("🔴 schickt mit der gesehenen Revision an das eigene Konto; leer leert", async () => {
        const { calls, fetcher } = server({ status: 200, body: DETAIL }, RECEIPT, { status: 200, body: DETAIL });
        const konto = createAccount({ fetcher });
        await konto.load();
        expect(await konto.setResponsibility("  Entwicklung, Claudia, Claudio, Gemotze ")).toBe(true);
        expect(calls[1]).toEqual({
            url: "/api/account/responsibility",
            body: {
                operationId: expect.any(String),
                responsibleFor: "Entwicklung, Claudia, Claudio, Gemotze",
                baseRevision: 3,
            },
        });
        const leer = server({ status: 200, body: DETAIL }, RECEIPT, { status: 200, body: DETAIL });
        const zweites = createAccount({ fetcher: leer.fetcher });
        await zweites.load();
        expect(await zweites.setResponsibility("   ")).toBe(true);
        expect(leer.calls[1]?.body).toMatchObject({ responsibleFor: "" });
    });

    it("🔴 eine zweite Zeile oder 121 Zeichen gehen nicht hinaus; der Satz steht bei der Handlung", async () => {
        const { calls, fetcher } = server({ status: 200, body: DETAIL });
        const konto = createAccount({ fetcher });
        await konto.load();
        expect(await konto.setResponsibility("Zeile eins\nZeile zwei")).toBe(false);
        expect(konto.problems.value).toEqual([{ key: "auth.responsibility.line" }]);
        expect(konto.problemOf.value).toBe("responsibility");
        expect(await konto.setResponsibility("x".repeat(121))).toBe(false);
        expect(konto.problems.value).toEqual([{ key: "auth.responsibility.tooLong", params: { max: 120 } }]);
        expect(calls).toHaveLength(1);
    });

    it("die Ablehnung des Servers wird derselbe Satz", () => {
        expect(formProblems(new ApiFailure(400, "responsibility_invalid", "", { problem: "too_long" }))).toEqual([
            { key: "auth.responsibility.tooLong", params: { max: 120 } },
        ]);
        expect(formProblems(new ApiFailure(400, "responsibility_invalid", "", { problem: "line" }))).toEqual([
            { key: "auth.responsibility.line" },
        ]);
        expect(t("auth.responsibility.tooLong", { max: 120 })).toContain("120");
    });
});

describe("Personenansicht", () => {
    it("🔴 eine andere Person über das Recht des Betreibers, die eigene über das Konto; jeweils mit der Revision der Person", async () => {
        const { calls, fetcher } = server(RECEIPT, { status: 200, body: { people: [PERSON] } });
        const verwaltung = createAdministration({ fetcher });
        expect((await verwaltung.setResponsibility(PERSON, "Medienrechte")).ok).toBe(true);
        expect(calls[0]).toEqual({
            url: "/api/admin/people/responsibility",
            body: {
                operationId: expect.any(String),
                personId: PERSON.id,
                responsibleFor: "Medienrechte",
                baseRevision: 4,
            },
        });
        expect(calls[1]?.url).toBe("/api/admin/people");

        const eigen = server(RECEIPT, { status: 200, body: { people: [] } });
        const meine = createAdministration({ fetcher: eigen.fetcher });
        expect((await meine.setResponsibility({ ...PERSON, self: true }, "")).ok).toBe(true);
        expect(eigen.calls[0]).toEqual({
            url: "/api/account/responsibility",
            body: { operationId: expect.any(String), responsibleFor: "", baseRevision: 4 },
        });
    });

    it("🔴 eine Ablehnung (ohne Recht, Konflikt) steht als Ergebnis da", async () => {
        const { fetcher } = server(
            { status: 403, body: envelope("forbidden") },
            { status: 200, body: { people: [PERSON] } },
        );
        const result = await createAdministration({ fetcher, ask: async () => false }).setResponsibility(PERSON, "x");
        expect(result.ok).toBe(false);
        expect(result.problems).toEqual([{ key: "admin.error.forbidden" }]);
    });

    it("🔴 „Ändern“ nur bei der eigenen Person und mit `set_responsibility`; ein aufgelöstes Konto nie", () => {
        expect(mayEditResponsibility(PERSON, ["manage_people", "assign_roles"])).toBe(false);
        expect(mayEditResponsibility(PERSON, ["manage_people", "set_responsibility"])).toBe(true);
        expect(mayEditResponsibility({ ...PERSON, self: true }, ["manage_people"])).toBe(true);
        expect(mayEditResponsibility({ ...PERSON, status: "departed" }, ["set_responsibility"])).toBe(false);
        expect(mayEditResponsibility({ ...PERSON, status: "locked" }, ["set_responsibility"])).toBe(true);
    });

    it("das Fenster bindet Regel, Grenze und Platz: in „Zugang“ unter „Eingeladen von“, kurz im Kopf", () => {
        const vue = readFileSync(new URL("../src/auth/verwaltung-person.vue", import.meta.url), "utf8");
        expect(vue).toContain("mayEditResponsibility(p.value, session.capabilities)");
        expect(vue).toContain(':maxlength="RESPONSIBILITY_MAX"');
        const eingeladen = vue.indexOf('t("admin.people.invitedBy")');
        const verantwortlich = vue.indexOf('t("admin.person.responsibleFor")');
        expect(eingeladen).toBeGreaterThan(0);
        expect(verantwortlich).toBeGreaterThan(eingeladen);
        expect(vue).toContain('data-testid="person-detail-verantwortung-kopf"');
        const konto = readFileSync(new URL("../src/auth/konto-fenster.vue", import.meta.url), "utf8");
        expect(konto).toContain('testid="konto-verantwortung-feld"');
        expect(konto).toContain(':maxlength="RESPONSIBILITY_MAX"');
    });
});

describe("Protokoll", () => {
    const entry = (details: Record<string, unknown>): AuditEntry => ({
        id: "1",
        at: "2026-10-10T10:00:00.000Z",
        action: "person.responsibility_changed",
        actorKind: "person",
        actor: { id: "a", displayName: "Rondrikan" },
        actorLabel: null,
        target: { id: "b", displayName: "Traviabold" },
        targetRef: null,
        details,
        recovery: false,
        operationId: null,
        clientLabel: null,
        ipPrefix: null,
    });

    it("🔴 nennt für wen, ob selbst oder durch den Betreiber und ob geleert, nie einen Text", () => {
        expect(describeEvent(entry({ via: "operator", cleared: false }))).toEqual({
            title: t("admin.event.person.responsibility_changed"),
            details: ["Traviabold", t("admin.responsibility.via.operator")],
            danger: false,
        });
        expect(describeEvent(entry({ via: "self", cleared: true })).details).toEqual([
            "Traviabold",
            t("admin.responsibility.via.self"),
            t("admin.responsibility.cleared"),
        ]);
    });
});
