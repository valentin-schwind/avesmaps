import { describe, expect, it } from "vitest";
import type { AdminInvitation, AdminPerson, AuditEntry } from "@avesmaps3d/shared";
import { t } from "../src/i18n/i18n.ts";
import {
    ADMIN_ENTRIES,
    adminAreasFor,
    adminViewsFor,
    adminWindowFor,
    createAdministration,
    readAdminLink,
    type VerwaltungsTafel,
} from "../src/auth/verwaltung.ts";
import { usePersonActions } from "../src/auth/verwaltung-handlungen.ts";
import {
    aktionenMitTitel,
    describeEvent,
    groupFilter,
    methodsText,
    rangeStart,
    remainingText,
} from "../src/auth/verwaltung-text.ts";

/**
 * Die Fenster „Kontenverwaltung …“ und „Systemsteuerung …“ ohne Oberfläche (WI-0120 A10, WI-0127 SYS-15): welche Reiter eine Sitzung sieht, was die Handlungen schicken, wie ein
 * Konflikt, eine verlangte Bestätigung und ein Link zurückkommen, und wie das Protokoll spricht.
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

const PERSON: AdminPerson = {
    id: "5b1d0c9e-3f4a-4e7b-9a2c-1d2e3f4a5b6c",
    displayName: "Traviabold",
    status: "active",
    revision: 4,
    role: "reviewer",
    access: "active",
    accessRevision: 7,
    methods: ["discord", "password"],
    passwordDisabled: false,
    passkeyCount: 2,
    activeSessions: 1,
    grants: [],
    createdAt: "2026-09-01T10:00:00.000Z",
    lastLoginAt: "2026-10-08T10:00:00.000Z",
    lastSeenAt: null,
    invitedBy: { id: "x", displayName: "Hesindiane" },
    lockReason: null,
    lockedAt: null,
    lockedBy: null,
    self: false,
    manageable: true,
};
const PEOPLE = { status: 200, body: { people: [PERSON] } };
const RECEIPT = { status: 200, body: { status: "applied" } };

describe("Einträge der Schiene (WI-0127 SYS-1)", () => {
    const ADMIN = [
        "manage_people",
        "manage_invitations",
        "assign_roles",
        "read_audit",
        "create_backup",
        "view_operations",
        "view_own_jobs",
    ];
    const ids = (capabilities: string[], tafel: VerwaltungsTafel) =>
        adminAreasFor(capabilities, tafel).map(({ area, entries }) => [area, entries.map((entry) => entry.id)]);

    it("🔴 jeder Eintrag nur mit seinem eigenen Recht, nie an „ist Admin“", () => {
        expect(adminViewsFor(["manage_people", "read_audit", "use_editor_menu"])).toEqual([
            "personen",
            "protokoll",
            "protokoll-system",
        ]);
        expect(adminViewsFor(["manage_invitations"])).toEqual(["einladungen"]);
        expect(adminViewsFor(["assign_roles", "view_operations"])).toEqual([
            "rollen",
            "sonderrollen",
            // Die vier Gruppen der Systemsteuerung (Betreiber 2026-10-17, WI-0127 §23): Betrieb, Auslieferung & Daten, Karte &
            // Einstellungen, Redaktion & Zusammenarbeit.
            "betrieb",
            "systemzustand",
            "statusseite",
            "backup",
            "production",
            "versionen",
            "abgleiche",
            "kartenserien",
            "inhalte",
            "hoehenmodell",
            "wettermodell",
            "karteneinstellungen",
            "wegfindung",
            "zoombaender",
            "neuigkeiten",
            "mail",
        ]);
        expect(adminViewsFor(["use_editor_menu", "edit_map_objects", "edit_territories", "edit_landscapes"])).toEqual(
            [],
        );
        // Umschalten (`manage_system_settings`) allein öffnet keinen Eintrag: Sehen braucht `view_operations` (SYS-5).
        expect(adminViewsFor(["manage_system_settings"])).toEqual([]);
    });

    it("🔴 zwei Fenster (SYS-15, §9d.1): die Kontenverwaltung trägt „Personen & Sicherheit“, die Systemsteuerung ihre vier Gruppen (Betreiber 2026-10-17)", () => {
        expect(ids(ADMIN, "konten")).toEqual([
            ["personen", ["personen", "einladungen", "rollen", "sonderrollen", "protokoll"]],
        ]);
        expect(ids(ADMIN, "system")).toEqual([
            // Das Protokoll ist der letzte Eintrag unter „Betrieb“, wie in der Kontenverwaltung unter „Personen“.
            ["betrieb", ["betrieb", "systemzustand", "statusseite", "backup", "protokoll-system"]],
            ["auslieferung", ["production", "versionen", "abgleiche"]],
            [
                "karte",
                [
                    "kartenserien",
                    "inhalte",
                    "hoehenmodell",
                    "wettermodell",
                    "karteneinstellungen",
                    "wegfindung",
                    "zoombaender",
                ],
            ],
            // „Claudia & Claudio“ fehlt einem Admin (KANAL-0001 K3).
            ["redaktion", ["neuigkeiten", "mail"]],
        ]);
        // Alle Ansichten von vorher bleiben erreichbar, Kennungen und Rechte unverändert; neu sind das Protokoll des Systems und das
        // Höhenmodell (SYS-13, Lesen mit `view_operations`, Umschalten mit `manage_terrain_recipe`) und der Systemzustand (SYS-8, nur lesen).
        expect(adminViewsFor(ADMIN, "konten")).toEqual([
            "personen",
            "einladungen",
            "rollen",
            "sonderrollen",
            "protokoll",
        ]);
        expect(adminViewsFor(ADMIN, "system")).toEqual([
            "betrieb",
            "systemzustand",
            "statusseite",
            "backup",
            "protokoll-system",
            "production",
            "versionen",
            "abgleiche",
            "kartenserien",
            "inhalte",
            "hoehenmodell",
            "wettermodell",
            "karteneinstellungen",
            "wegfindung",
            "zoombaender",
            "neuigkeiten",
            "mail",
        ]);
        expect(adminViewsFor(ADMIN)).toEqual([...adminViewsFor(ADMIN, "konten"), ...adminViewsFor(ADMIN, "system")]);
        // Die Kennungen sind über beide Tafeln eindeutig (tiefe Links finden ihr Fenster).
        const kennungen = ADMIN_ENTRIES.map((entry) => entry.id);
        expect(new Set(kennungen).size).toBe(kennungen.length);
        // Seit 2026-10-11 eine Ansicht im Fenster (die Statusseite eingebettet), kein Verweis mehr.
        expect(ADMIN_ENTRIES.find((entry) => entry.id === "statusseite")).toMatchObject({ kind: "ansicht" });
        // „Claudia & Claudio“ ist seit KANAL-0001 K3 der Betreiber-Kanal, eine Ansicht nur mit `use_operator_channel` (Admins sehen ihn nicht).
        expect(ADMIN_ENTRIES.find((entry) => entry.id === "claudio")).toMatchObject({ kind: "ansicht" });
        expect(adminViewsFor([...ADMIN, "use_operator_channel"], "system")).toContain("claudio");
    });

    it("🔴 eine Gruppe ohne Ansicht fällt weg (E6); „Redaktion & Zusammenarbeit“ trägt Neuigkeiten, das Mailpostfach und den Kanal", () => {
        expect(ADMIN_ENTRIES.filter((entry) => entry.area === "redaktion").map((entry) => entry.id)).toEqual([
            "neuigkeiten",
            "mail",
            "social",
            "claudio",
        ]);
        // Ohne Recht auf den Betrieb fehlen drei Gruppen; „Betrieb“ trägt dann nur das Protokoll (§14.4 „B“).
        expect(ids(["manage_people", "manage_invitations", "read_audit"], "system")).toEqual([
            ["betrieb", ["protokoll-system"]],
        ]);
        // Nur Personenrechte: Die Systemsteuerung fehlt ganz, auch der Verweis und Claudio (§9d.1: „Ein Admin, der nur Konten
        // pflegt, sieht die Systemsteuerung nicht.“).
        expect(ids(["manage_people"], "konten")).toEqual([["personen", ["personen"]]]);
        expect(adminViewsFor(["manage_people"], "system")).toEqual([]);
        // Ein Verweis allein macht kein Fenster: Ein Editor mit eigenen Aufträgen sieht keine Verwaltung.
        expect(adminViewsFor(["view_own_jobs", "use_editor_menu"])).toEqual([]);
        expect(adminAreasFor(["view_own_jobs", "use_editor_menu"], "system")).toEqual([]);
    });

    it("🔴 der tiefe Link `?verwaltung=<eintrag>` öffnet das Fenster, das den Eintrag trägt, nur mit dem Recht (§9d.1)", () => {
        expect(readAdminLink("?verwaltung=personen&lang=en")).toEqual({ eintrag: "personen", search: "?lang=en" });
        expect(readAdminLink("?verwaltung=abgleiche")).toEqual({ eintrag: "abgleiche", search: "" });
        expect(readAdminLink("?verwaltung=protokoll-system")).toEqual({ eintrag: "protokoll-system", search: "" });
        expect(readAdminLink("?lang=en")).toEqual({ eintrag: null, search: "?lang=en" });
        // Alte Links aus Runbooks und Handovers finden das richtige Fenster.
        expect(adminWindowFor("personen", ADMIN)).toEqual({ name: "kontenverwaltung", eintrag: "personen" });
        expect(adminWindowFor("abgleiche", ADMIN)).toEqual({ name: "systemsteuerung", eintrag: "abgleiche" });
        expect(adminWindowFor("protokoll-system", ADMIN)).toEqual({
            name: "systemsteuerung",
            eintrag: "protokoll-system",
        });
        // Ohne Recht, für einen Bereich oder Unbekanntes geht nichts auf; den Kanal öffnet nur, wer `use_operator_channel` hat.
        expect(adminWindowFor("abgleiche", ["manage_people"])).toBeNull();
        expect(adminWindowFor("statusseite", ADMIN)).toEqual({ name: "systemsteuerung", eintrag: "statusseite" });
        expect(adminWindowFor("claudio", ADMIN)).toBeNull();
        expect(adminWindowFor("claudio", [...ADMIN, "use_operator_channel"])).toEqual({
            name: "systemsteuerung",
            eintrag: "claudio",
        });
        expect(adminWindowFor("bereich-personen", ADMIN)).toBeNull();
        expect(adminWindowFor(null, ADMIN)).toBeNull();
    });

    it("🔴 ein Protokoll, zwei Filter: jedes Fenster fragt seinen Bereich, nur „Alles“ ohne ihn (§9d.2)", () => {
        expect(groupFilter("konten", "alle")).toEqual({ bereich: "konten" });
        expect(groupFilter("konten", "passkeys")).toEqual({ bereich: "konten", action: "passkey." });
        expect(groupFilter("system", "alle")).toEqual({ bereich: "system" });
        expect(groupFilter("system", "betrieb")).toEqual({ bereich: "system", action: "system." });
        expect(groupFilter("system", "notzugang")).toEqual({ bereich: "system", action: "recovery." });
        expect(groupFilter("system", "gesamt")).toEqual({});
    });
});

describe("Laden", () => {
    it("🔴 eine ältere Antwort, die später ankommt, überschreibt die neuere nicht", async () => {
        const release: (() => void)[] = [];
        const bodies = [
            { people: [{ ...PERSON, displayName: "alt" }] },
            { people: [{ ...PERSON, displayName: "neu" }] },
        ];
        const fetcher = (async () => {
            const body = bodies.shift();
            await new Promise<void>((resolve) => release.push(resolve));
            return new Response(JSON.stringify(body), { status: 200 });
        }) as unknown as typeof fetch;
        const verwaltung = createAdministration({ fetcher });
        const first = verwaltung.loadPeople();
        const second = verwaltung.loadPeople();
        release[1]?.();
        await second;
        release[0]?.();
        await first;
        expect(verwaltung.people.value.map((person) => person.displayName)).toEqual(["neu"]);
        expect(verwaltung.loading.has("people")).toBe(false);
    });

    it("eine Ablehnung beim Laden bleibt bei ihrem Bereich", async () => {
        const { fetcher } = server({ status: 403, body: envelope("forbidden") }, PEOPLE);
        const verwaltung = createAdministration({ fetcher });
        await verwaltung.loadAudit({ action: "person." });
        await verwaltung.loadPeople();
        expect(verwaltung.loadProblems.get("audit")).toEqual([{ key: "admin.error.forbidden" }]);
        expect(verwaltung.loadProblems.has("people")).toBe(false);
    });
});

describe("Handlungen", () => {
    it("🔴 Rolle ändern schickt die Revision des Zugangs; ein Konflikt nennt Wer und Wann und lädt neu", async () => {
        const { calls, fetcher } = server(
            {
                status: 409,
                body: envelope("edit_conflict", {
                    changedBy: { id: "y", displayName: "Hesindiane" },
                    changedAt: "2026-10-09T10:00:00.000Z",
                }),
            },
            PEOPLE,
        );
        const verwaltung = createAdministration({ fetcher });
        const result = await verwaltung.changeRole(PERSON, "editor");
        expect(calls[0]?.url).toBe("/api/admin/people/role");
        expect(calls[0]?.body).toMatchObject({ personId: PERSON.id, role: "editor", baseRevision: 7 });
        expect(typeof calls[0]?.body?.["operationId"]).toBe("string");
        expect(result).toMatchObject({
            ok: false,
            conflict: { by: "Hesindiane", at: "2026-10-09T10:00:00.000Z" },
            problems: [{ key: "auth.form.conflict" }],
        });
        expect(calls[1]?.url).toBe("/api/admin/people");
        expect(verwaltung.people.value).toHaveLength(1);
    });

    it("🔴 verlangt der Server einen frischen Passkey, wird gefragt und mit DERSELBEN Kennung wiederholt", async () => {
        const { calls, fetcher } = server(
            { status: 403, body: envelope("reauth_required", { need: "passkey" }) },
            RECEIPT,
            PEOPLE,
        );
        const asked: string[] = [];
        const verwaltung = createAdministration({
            fetcher,
            ask: async (need) => {
                asked.push(need);
                return true;
            },
        });
        const result = await verwaltung.lock(PERSON, "Spam im Kartenforum");
        expect(asked).toEqual(["passkey"]);
        expect(result.ok).toBe(true);
        expect(calls[0]?.body).toMatchObject({ reason: "Spam im Kartenforum", baseRevision: 4 });
        expect(calls[1]?.body?.["operationId"]).toBe(calls[0]?.body?.["operationId"]);
    });

    it("🔴 ein Link kommt nur in der ersten Antwort; eine Wiederholung bekommt keinen", async () => {
        const { fetcher } = server(
            {
                status: 200,
                body: {
                    receipt: { status: "applied" },
                    link: "https://stage.avesmaps.de/passwort#abc",
                    expiresAt: "2026-10-10T10:00:00.000Z",
                },
            },
            PEOPLE,
            { status: 200, body: { receipt: { status: "replayed" }, link: null, expiresAt: null } },
            PEOPLE,
        );
        const verwaltung = createAdministration({ fetcher });
        expect(await verwaltung.resetLink(PERSON)).toEqual({
            ok: true,
            problems: [],
            link: "https://stage.avesmaps.de/passwort#abc",
            expiresAt: "2026-10-10T10:00:00.000Z",
        });
        expect((await verwaltung.passkeyLink(PERSON)).link).toBeNull();
    });

    it("eine Einladung schickt nur, was gesetzt ist; Neu ausstellen trägt die Revision", async () => {
        const invitation = { id: "i", revision: 3 } as AdminInvitation;
        const { calls, fetcher } = server(
            { status: 200, body: { receipt: {}, link: "l", expiresAt: "e" } },
            { status: 200, body: { invitations: [] } },
            { status: 200, body: { receipt: {}, link: "m", expiresAt: "e" } },
            { status: 200, body: { invitations: [] } },
        );
        const verwaltung = createAdministration({ fetcher });
        await verwaltung.createInvitation({ role: "editor", validDays: 7, note: "" });
        expect(calls[0]?.body).toEqual({ operationId: calls[0]?.body?.["operationId"], role: "editor", validDays: 7 });
        await verwaltung.reissueInvitation(invitation);
        expect(calls[2]).toMatchObject({
            url: "/api/admin/invitations/reissue",
            body: { invitationId: "i", baseRevision: 3 },
        });
    });

    it("🔴 Sonderrollen (WI-0279): Vergabe und Entzug senden, was der Server erwartet, und laden danach neu", async () => {
        const LISTE = { status: 200, body: { zuteilungen: [], regionen: [] } };
        const { calls, fetcher } = server(RECEIPT, LISTE, RECEIPT, LISTE, RECEIPT, LISTE);
        const verwaltung = createAdministration({ fetcher });
        await verwaltung.vergebeSonderrolle({ personId: "p", sonderrolle: "kurator", regionen: [], grund: "Probe" });
        expect(calls[0]).toMatchObject({
            url: "/api/admin/sonderrollen/vergeben",
            body: { personId: "p", sonderrolle: "kurator", grund: "Probe" },
        });
        expect(calls[0]?.body).not.toHaveProperty("regionen");
        expect(calls[1]?.url).toBe("/api/admin/sonderrollen");
        await verwaltung.vergebeSonderrolle({
            personId: "p",
            sonderrolle: "ortskundiger",
            regionen: ["r1", "r2"],
            grund: "Probe",
        });
        expect(calls[2]?.body).toMatchObject({ regionen: ["r1", "r2"] });
        const antwort = await verwaltung.entzieheSonderrolle("7", "Ende");
        expect(antwort.ok).toBe(true);
        expect(calls[4]).toMatchObject({
            url: "/api/admin/sonderrollen/entziehen",
            body: { zuteilungId: "7", grund: "Ende" },
        });
    });

    it("🔴 eine Einladung trägt Sonderrollen und Grund nur, wenn welche gewählt sind (WI-0279)", async () => {
        const LINK = {
            status: 200,
            body: { receipt: { status: "applied" }, link: "https://x/einladung#t", expiresAt: "z" },
        };
        const LISTE = { status: 200, body: { invitations: [] } };
        const { calls, fetcher } = server(LINK, LISTE, LINK, LISTE);
        const verwaltung = createAdministration({ fetcher });
        await verwaltung.createInvitation({ role: "editor", validDays: 7, sonderrollen: [], sonderrollenGrund: "" });
        expect(calls[0]?.body).not.toHaveProperty("sonderrollen");
        expect(calls[0]?.body).not.toHaveProperty("sonderrollenGrund");
        await verwaltung.createInvitation({
            role: "editor",
            validDays: 7,
            discordUserId: "123456789012345678",
            sonderrollen: [{ sonderrolle: "kurator" }, { sonderrolle: "ortskundiger", regionen: ["r1"] }],
            sonderrollenGrund: "Probe",
        });
        expect(calls[2]?.body).toMatchObject({
            sonderrollen: [{ sonderrolle: "kurator" }, { sonderrolle: "ortskundiger", regionen: ["r1"] }],
            sonderrollenGrund: "Probe",
        });
    });

    it("das Protokoll blättert mit `before` weiter und hängt an", async () => {
        const entry = (id: string) => ({ id, action: "login.success" }) as unknown as AuditEntry;
        const { calls, fetcher } = server(
            { status: 200, body: { events: [entry("3"), entry("2")], next: "2" } },
            { status: 200, body: { events: [entry("1")], next: null } },
        );
        const verwaltung = createAdministration({ fetcher });
        await verwaltung.loadAudit({ bereich: "konten", action: "login.", from: "2026-09-09T00:00:00.000Z" });
        await verwaltung.loadAudit({ bereich: "konten", action: "login.", from: "2026-09-09T00:00:00.000Z" }, true);
        expect(calls[1]?.url).toContain("before=2");
        expect(calls[1]?.url).toContain("action=login.");
        expect(calls[1]?.url).toContain("bereich=konten");
        expect(verwaltung.audit.value.map((event) => event.id)).toEqual(["3", "2", "1"]);
        expect(verwaltung.auditNext.value).toBeNull();
    });
});

describe("Handlungen an Personen", () => {
    it("🔴 je Person eine Handlung; eine Ablehnung bleibt bei der Person und baut die Auswahl neu auf", async () => {
        const { fetcher } = server({ status: 403, body: envelope("forbidden_target") }, PEOPLE);
        const aktionen = usePersonActions(createAdministration({ fetcher }));
        const first = aktionen.changeRole(PERSON, "admin");
        expect(await aktionen.changeRole(PERSON, "editor")).toEqual({ ok: false, problems: [] });
        await first;
        expect(aktionen.outcomes.get(PERSON.id)?.problems).toEqual([{ key: "admin.error.forbiddenTarget" }]);
        expect(aktionen.generation.value).toBe(1);
        expect(aktionen.busy.has(PERSON.id)).toBe(false);
    });

    it("Sperren fragt nach dem Grund und schickt ihn ohne Ränder; gelungen schließt die Frage", async () => {
        const { calls, fetcher } = server(RECEIPT, PEOPLE);
        const aktionen = usePersonActions(createAdministration({ fetcher }));
        aktionen.ask("lock", PERSON);
        aktionen.setReason("  Spam  ");
        expect((await aktionen.confirm(PERSON)).ok).toBe(true);
        expect(calls[0]?.body).toMatchObject({ reason: "Spam" });
        expect(aktionen.question.value).toBeNull();
    });
});

describe("Sätze", () => {
    const entry = (action: string, details: Record<string, unknown>, target = "Traviabold"): AuditEntry => ({
        id: "1",
        at: "2026-10-09T10:00:00.000Z",
        action,
        actorKind: "person",
        actor: { id: "a", displayName: "Rondrikan" },
        actorLabel: null,
        target: { id: "b", displayName: target },
        targetRef: null,
        details,
        recovery: false,
        operationId: null,
        clientLabel: null,
        ipPrefix: null,
    });

    it("🔴 Protokoll: Rolle mit Pfeil, Sperre im Gefahrton, Unbekanntes mit seinem Schlüssel", () => {
        expect(describeEvent(entry("person.role_changed", { from: "reviewer", to: "editor" }))).toEqual({
            title: t("admin.event.person.role_changed"),
            details: [t("admin.detail.roleChange", { name: "Traviabold", from: "Reviewer", to: "Editor" })],
            danger: false,
        });
        const locked = describeEvent(entry("person.locked", { reason: "Spam", sessions: 2 }));
        expect(locked.danger).toBe(true);
        expect(locked.details).toEqual(["Traviabold", "Spam", t("admin.detail.sessionsEnded", { n: 2 })]);
        expect(describeEvent(entry("invitation.created", { role: "editor", validDays: 1 })).details).toEqual([
            "Editor",
            t("admin.detail.day"),
        ]);
        expect(describeEvent(entry("neu.unbekannt", {})).title).toBe("neu.unbekannt");
    });

    it("Restlaufzeit, Anmeldewege und Zeitraum", () => {
        const now = new Date("2026-10-09T10:00:00.000Z");
        expect(remainingText("2026-10-16T10:00:00.000Z", now)).toBe(t("admin.remaining.days", { n: 7 }));
        expect(remainingText("2026-10-10T11:00:00.000Z", now)).toBe(t("admin.remaining.day"));
        expect(remainingText("2026-10-10T05:00:00.000Z", now)).toBe(t("admin.remaining.hours", { n: 19 }));
        expect(remainingText("2026-10-09T10:12:30.000Z", now)).toBe(t("admin.remaining.minutes", { n: 12 }));
        expect(remainingText("2026-10-09T09:00:00.000Z", now)).toBe(t("admin.remaining.over"));
        expect(methodsText(["discord", "password", "passkey"], 2)).toBe(
            ["Discord", t("admin.methodName.password"), t("admin.methodName.passkeys", { n: 2 })].join(" · "),
        );
        expect(rangeStart("7", now)).toBe("2026-10-02T10:00:00.000Z");
        expect(rangeStart("alles", now)).toBeUndefined();
    });
});

describe("Protokoll-Suche: Handlungen nach ihrem Titel (Betreiber 2026-10-11)", () => {
    it("🔴 „gesperrt“ findet person.locked, obwohl in der Datenbank kein deutsches Wort steht; leer findet nichts", () => {
        expect(aktionenMitTitel("gesperrt")).toContain("person.locked");
        expect(aktionenMitTitel("ROLLE")).toContain("person.role_changed");
        expect(aktionenMitTitel("  ")).toEqual([]);
        expect(aktionenMitTitel("gibt es nicht als Titel")).toEqual([]);
    });
});
