import type { Page, Route } from "@playwright/test";
import { FREIGABE_URL } from "@avesmaps3d/shared";
import { systemOverview, systemServer, type SystemServer } from "./betriebszustand-stub.ts";
import { abgleicheServer } from "./abgleiche-stub.ts";
import { hoehenmodellServer } from "./hoehenmodell-stub.ts";
import { inhalteServer } from "./inhalte-stub.ts";
import { wegfindungServer } from "./wegfindung-stub.ts";
import { karteneinstellungenServer } from "./karteneinstellungen-stub.ts";
import { sicherungServer, type SicherungServer } from "./sicherung-stub.ts";
import { systemzustandAntwort, systemzustandStand } from "./systemzustand-stub.ts";
import { kurzinfoAntwort, versionenAntwort } from "./versionen-stub.ts";

/**
 * Eine Verwaltung zum Anfassen ohne Datenbank (WI-0120 A10): Sitzung und `/api/admin/*` aus einem Stub, die Szene des Mockups
 * (`review/admin-mockup/quelle/mockup.js`: Stage, angemeldet ist Rondrikan als Admin; alle Namen erfunden). Karte und Kacheln
 * liefert der echte Entwicklungsserver. Die echte Verwaltung gegen PostgreSQL prüfen die Servertests (`admin-api.test.ts`).
 */
const DAY = 86_400_000;
/**
 * Die Uhr der Szene: ohne Angabe die echte. `stubAdmin(page, { uhr })` stellt Stub und Browser auf denselben Zeitpunkt, damit eine
 * Angabe nach dem Kalender nicht von der Tageszeit des Laufs abhängt. 🪤 Ab 24 Stunden zählt `relative-time.ts` Kalendertage: Die
 * Sperre „vor 25 Stunden“ hieß zwischen 0 und 1 Uhr „vor 2 Tagen“, nicht „gestern“ (2026-10-12). Jeder `stubAdmin` setzt sie neu.
 */
let uhr: number | null = null;
const now = (): number => uhr ?? Date.now();
const ago = (ms: number): string => new Date(now() - ms).toISOString();
const ahead = (ms: number): string => new Date(now() + ms).toISOString();

/** Mittag eines festen Tages in der Zeitzone des Laufs: Die Sperre von vor 25 Stunden ist dann immer „gestern“. */
export const MITTAG = new Date(2026, 9, 11, 12, 0, 0);

export const ME = {
    id: "0f8e5a52-6d0b-4f43-9c1e-2b7d9a3c4e51",
    displayName: "Rondrikan",
    role: "admin",
    methods: ["discord"],
    assurance: "strong",
    sessionMethod: "discord",
    confirmedAt: ago(60_000),
    passkeyConfirmedAt: null,
    expiresAt: ahead(30 * DAY),
    passkeyCount: 0,
};

/**
 * Was ein Admin aus seiner Vorlage hat, soweit es das Fenster betrifft (AUTH-0001 §7.2); `view_operations` trägt seit WI-0127
 * „System & Betrieb“. `manage_system_settings` hat ein Admin nicht (Betreiber oder Sonderrecht): Er sieht den Betriebszustand nur.
 */
export const ADMIN_CAPABILITIES = [
    "manage_people",
    "manage_invitations",
    "assign_roles",
    "create_backup",
    "read_audit",
    "view_operations",
    "view_own_jobs",
    "use_editor_menu",
    "view_editor_series",
];

const ref = (id: string, displayName: string) => ({ id, displayName });
const RONDRIKAN = ref(ME.id, "Rondrikan");
const HESINDIANE = ref("2c4e6a80-1b3d-4f5a-8c7e-9d0b1a2c3d4e", "Hesindiane");
const WEIDEN = regionRef("7d000000-0000-4000-8000-000000000001", "Weiden");
const GARETIEN = regionRef("7d000000-0000-4000-8000-000000000002", "Garetien");

function regionRef(id: string, name: string) {
    return { id, name };
}

function zuteilung(
    id: string,
    sonderrolle: string,
    wer: { id: string; displayName: string },
    region: { id: string; name: string } | null,
    grund = "Probe",
) {
    return {
        id,
        sonderrolle,
        person: wer,
        personRolle: "editor",
        hatPasskey: true,
        region,
        vergebenAm: ago(2 * DAY),
        vergebenVon: ref("c1", "Alrike vom Turm"),
        grund,
        entzogenAm: null,
        entzogenVon: null,
        entzugGrund: null,
    };
}

function person(id: string, displayName: string, extra: Record<string, unknown>) {
    return {
        id,
        displayName,
        status: "active",
        revision: 1,
        role: "editor",
        access: "active",
        accessRevision: 1,
        methods: ["discord"],
        passwordDisabled: false,
        passkeyCount: 0,
        activeSessions: 0,
        grants: [],
        createdAt: ago(40 * DAY),
        lastLoginAt: ago(3 * 3_600_000),
        lastSeenAt: null,
        invitedBy: RONDRIKAN,
        lockReason: null,
        lockedAt: null,
        lockedBy: null,
        self: false,
        manageable: true,
        ...extra,
    };
}

/** Die Personen, wie der Server sie dieser Rolle zeigt: Ein Betreiber verwaltet jeden außer sich selbst (§7.3). */
function people(viewer = "admin") {
    const all = [
        person("a1b2c3d4-0000-4000-8000-000000000001", "Efferdan_vom_Kap", {
            status: "locked",
            revision: 2,
            lockReason: "Verdacht auf Fremdzugriff",
            lockedAt: ago(DAY + 3_600_000),
            lockedBy: RONDRIKAN,
            lastLoginAt: ago(6 * DAY),
        }),
        person(HESINDIANE.id, "Hesindiane", {
            role: "admin",
            activeSessions: 2,
            manageable: false,
            lastLoginAt: ago(4 * 3_600_000),
        }),
        person("a1b2c3d4-0000-4000-8000-000000000003", "Ingrimosch", { role: "reviewer", lastLoginAt: ago(12 * DAY) }),
        person("a1b2c3d4-0000-4000-8000-000000000004", "Phexine.Sternwind", {
            role: "reviewer",
            methods: ["password"],
            lastLoginAt: ago(5 * DAY),
            invitedBy: HESINDIANE,
        }),
        person("a1b2c3d4-0000-4000-8000-000000000005", "Praiodan_42", {
            methods: ["discord", "password", "passkey"],
            passkeyCount: 2,
            activeSessions: 1,
        }),
        person(ME.id, "Rondrikan", {
            role: "admin",
            self: true,
            manageable: false,
            invitedBy: null,
            activeSessions: 1,
            lastLoginAt: ago(30 * 60_000),
        }),
        person("a1b2c3d4-0000-4000-8000-000000000007", "Traviabold", {
            activeSessions: 1,
            invitedBy: HESINDIANE,
            lastLoginAt: ago(2 * DAY),
            lastSeenAt: ago(5 * 60_000),
        }),
    ];
    return viewer === "operator" ? all.map((entry) => ({ ...entry, manageable: !entry.self })) : all;
}

function invitations() {
    const invitation = (id: string, extra: Record<string, unknown>) => ({
        id,
        role: "editor",
        note: null,
        tokenHint: "C3sd",
        boundDiscordUserId: null,
        status: "open",
        createdAt: ago(3_600_000),
        expiresAt: ahead(7 * DAY),
        createdBy: RONDRIKAN,
        acceptedAt: null,
        acceptedPerson: null,
        revokedAt: null,
        revision: 1,
        manageable: true,
        ...extra,
    });
    return [
        invitation("b1b2c3d4-0000-4000-8000-000000000001", {
            note: "Hesindian vom Kartenforum",
            expiresAt: ahead(6.5 * DAY),
        }),
        invitation("b1b2c3d4-0000-4000-8000-000000000002", {
            role: "reviewer",
            note: "Alrike, testet den Routenplaner",
            tokenHint: "R1fm",
            expiresAt: ahead(19 * 3_600_000),
            createdBy: HESINDIANE,
        }),
        invitation("b1b2c3d4-0000-4000-8000-000000000003", {
            role: "reviewer",
            status: "accepted",
            acceptedAt: ago(16 * DAY),
            acceptedPerson: ref("a1b2c3d4-0000-4000-8000-000000000007", "Traviabold"),
        }),
        invitation("b1b2c3d4-0000-4000-8000-000000000004", {
            note: "Probeleser Gerion",
            status: "revoked",
            revokedAt: ago(DAY),
        }),
    ];
}

function audit() {
    const entry = (id: string, at: number, action: string, details: Record<string, unknown>, target?: unknown) => ({
        id,
        at: ago(at),
        action,
        actorKind: "person",
        actor: RONDRIKAN,
        actorLabel: null,
        target: target ?? null,
        targetRef: null,
        details,
        recovery: false,
        operationId: null,
        clientLabel: null,
        ipPrefix: null,
    });
    return [
        entry("9", 20 * 60_000, "invitation.created", {
            role: "editor",
            validDays: 7,
            note: "Hesindian vom Kartenforum",
            bound: false,
            tokenHint: "C3sd",
        }),
        entry(
            "8",
            25 * 60_000,
            "person.role_changed",
            { from: "reviewer", to: "editor" },
            ref("a1b2c3d4-0000-4000-8000-000000000007", "Traviabold"),
        ),
        entry("7", 30 * 60_000, "login.success", { method: "discord", assurance: "strong" }),
        entry(
            "6",
            DAY + 3_600_000,
            "person.locked",
            { reason: "Verdacht auf Fremdzugriff", sessions: 2 },
            ref("a1b2c3d4-0000-4000-8000-000000000001", "Efferdan_vom_Kap"),
        ),
        // System-Ereignisse (SYS-0001 §9d.2): Sie stehen im Protokoll der Systemsteuerung, nicht in dem der Konten.
        entry("5", 15 * 60_000, "system.sync_requested", { source: "legacy", job: "j-0001" }),
        entry("4", 2 * 3_600_000, "system.lock_changed", {
            lock: "map",
            from: false,
            to: true,
            reason: "Geländerezept prüfen",
        }),
        entry("3", 2 * DAY, "system.mode_changed", {
            from: "normal",
            to: "restricted",
            reason: "Wiederherstellung prüfen",
        }),
    ];
}

/** Ein Protokoll, zwei Filter (SYS-15): `bereich` wie der Server (`AUDIT_BEREICH`), ohne ihn alles. */
const SYSTEM_EVENT = /^(system|backup|recovery)\./u;
function auditFor(query: URLSearchParams) {
    const bereich = query.get("bereich");
    // Die Suche wie der Server (`routes/admin-audit.ts`): Handlung, Namen, Werte der Details; oder eine Handlung aus `qAktionen`.
    const q = query.get("q")?.toLocaleLowerCase();
    const titel = (query.get("qAktionen") ?? "").split(",").filter((aktion) => aktion !== "");
    const passt = (event: ReturnType<typeof audit>[number]): boolean =>
        q === undefined ||
        titel.includes(event.action) ||
        [
            event.action,
            event.actor?.displayName,
            (event.target as { displayName?: string } | null)?.displayName,
            ...Object.values(event.details).map(String),
        ].some((feld) => (feld ?? "").toLocaleLowerCase().includes(q));
    return audit().filter(
        (event) =>
            (bereich === null || (SYSTEM_EVENT.test(event.action) ? "system" : "konten") === bereich) && passt(event),
    );
}

const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

export interface AdminCall {
    method: string;
    path: string;
    query: URLSearchParams;
    body: Record<string, unknown> | null;
}

/**
 * Hängt die Stubs an. `answer` darf eine Handlung selbst beantworten (Konflikt, verlangte Bestätigung); sonst gilt sie als
 * angewandt. Jeder Aufruf landet in `calls`.
 *
 * Der Betriebszustand (`/api/admin/system…`, WI-0127 SYS-5) kommt aus `system`, einem kleinen Server im Speicher
 * (`betriebszustand-stub.ts`); ohne Angabe einer im Stand der Szene. `system: "echt"` reicht diese Anfragen an den echten Server
 * des lokalen Stapels durch.
 */
export async function stubAdmin(
    page: Page,
    options: {
        capabilities?: string[];
        /** Die Rolle der angemeldeten Person; ohne Angabe Admin wie im Mockup. */
        role?: string;
        /** Abweichungen an der angemeldeten Person, etwa ein Passkey (`passkeyCount`) für Handlungen der Stufe S. */
        person?: Partial<typeof ME>;
        /** Die Umgebung der Sitzung; ohne Angabe Stage wie im Mockup. */
        environment?: string;
        system?: SystemServer | "echt";
        /** Die Sicherung (SYS-9); ohne Angabe „nicht eingerichtet“ wie lokal (`sicherung-stub.ts`). */
        sicherung?: SicherungServer;
        answer?: (call: AdminCall) => { status: number; body: unknown } | undefined;
        /** Eine feste Uhr für Stub und Browser (`page.clock`), etwa `MITTAG`; ohne Angabe die echte. Vor `page.goto` aufrufen. */
        uhr?: Date;
    } = {},
): Promise<AdminCall[]> {
    uhr = options.uhr?.getTime() ?? null;
    if (options.uhr) await page.clock.setSystemTime(options.uhr);
    const calls: AdminCall[] = [];
    // Sonderrollen (WI-0279): eine Zuteilung zum Start, zwei Regionen zur Wahl; Vergabe und Entzug ändern den Stand.
    const zuteilungen: Record<string, unknown>[] = [zuteilung("1", "regionalkanzler", HESINDIANE, WEIDEN)];
    const system = options.system ?? systemServer(ME, systemOverview(ME));
    const sicherung = options.sicherung ?? sicherungServer();
    // Die Einträge der Systemsteuerung mit eigenem Lesepfad antworten ohne eigene Angabe wie in ihrem Nachbau; sonst fiele ihr GET auf die
    // allgemeine Quittung, und die Ansicht stürzte an der fehlenden Liste ab (Befund aus dem Blatt WI-0137).
    const eintraege = [
        systemzustandAntwort(() => systemzustandStand()),
        versionenAntwort(),
        inhalteServer().handle,
        wegfindungServer().handle,
        karteneinstellungenServer().handle,
        hoehenmodellServer().handle,
        abgleicheServer().handle,
        // Der Abzug für lokal (WI-0251) steht über den Abgleichen; ohne eigene Antwort hat diese Umgebung keine Rolle dabei (404), und der Eintrag zeigt nichts.
        (call: AdminCall) =>
            call.path.startsWith("/api/admin/system/abzug")
                ? { status: 404, body: { error: { code: "not_found", message: "Keine Rolle beim Abzug." } } }
                : undefined,
        // Seit WI-0204 (`b7b518ef`) liest die Schiene den Stand der Freigabe; ohne Antwort stürzte das Fenster an `frueher` ab (WI-0192).
        // Ohne eigene Angabe: keine laufende, keine frühere, und diese Umgebung führt keine Freigaben (`datei: null`).
        (call: AdminCall) =>
            call.method === "GET" && call.path === FREIGABE_URL
                ? {
                      status: 200,
                      body: { now: new Date().toISOString(), datei: null, sperre: null, laeuft: null, frueher: [] },
                  }
                : undefined,
    ];
    await page.route("**/api/auth/session", (route) =>
        json(route, 200, {
            environment: options.environment ?? "staging",
            authEnabled: true,
            person: { ...ME, role: options.role ?? ME.role, ...options.person },
            capabilities: options.capabilities ?? ADMIN_CAPABILITIES,
        }),
    );
    // Die Kurzinfo „Was ist neu?“ (WI-0137) liegt neben der Verwaltung; ein Test setzt eine eigene mit einer späteren Route.
    await page.route("**/api/version/kurzinfo", (route) => json(route, 200, kurzinfoAntwort()));
    await page.route("**/api/admin/**", (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const call: AdminCall = {
            method: request.method(),
            path: url.pathname,
            query: url.searchParams,
            body: request.method() === "POST" ? (request.postDataJSON() as Record<string, unknown>) : null,
        };
        calls.push(call);
        const own = options.answer?.(call);
        if (own !== undefined) return json(route, own.status, own.body);
        if (call.path.startsWith("/api/admin/system/backup")) {
            const answered = sicherung.handle(call);
            if (answered !== undefined) return json(route, answered.status, answered.body);
        }
        if (call.path === "/api/admin/system" || call.path.startsWith("/api/admin/system/")) {
            if (system === "echt") return route.fallback();
            for (const eintrag of eintraege) {
                const antwort = eintrag(call);
                if (antwort !== undefined) return json(route, antwort.status, antwort.body);
            }
            const answered = system.handle(call);
            if (answered !== undefined) return json(route, answered.status, answered.body);
        }
        if (call.path === "/api/admin/sonderrollen/vergeben") {
            const body = call.body as { personId: string; sonderrolle: string; regionen?: string[]; grund: string };
            const wer = people(options.role).find((entry) => entry.id === body.personId);
            for (const id of body.regionen ?? [null])
                zuteilungen.push(
                    zuteilung(
                        String(zuteilungen.length + 1),
                        body.sonderrolle,
                        ref(body.personId, String(wer?.displayName)),
                        [WEIDEN, GARETIEN].find((region) => region.id === id) ?? null,
                        body.grund,
                    ),
                );
        }
        if (call.path === "/api/admin/sonderrollen/entziehen") {
            const eintrag = zuteilungen.find((zeile) => zeile["id"] === call.body?.["zuteilungId"]);
            if (eintrag) Object.assign(eintrag, { entzogenAm: ago(0), entzogenVon: ref("c1", "Alrike vom Turm") });
        }
        if (call.method === "GET") {
            if (call.path === "/api/admin/sonderrollen")
                return json(route, 200, { zuteilungen, regionen: [GARETIEN, WEIDEN] });
            if (call.path === "/api/admin/people") return json(route, 200, { people: people(options.role) });
            if (call.path === "/api/admin/invitations") return json(route, 200, { invitations: invitations() });
            if (call.path === "/api/admin/roles")
                return json(route, 200, {
                    operators: [ref("c1", "Alrike vom Turm")],
                    grants: [
                        {
                            person: HESINDIANE,
                            capability: "access_restricted_mode",
                            grantedAt: ago(3 * DAY),
                            grantedBy: ref("c1", "Alrike vom Turm"),
                            reason: "Vertretung im Wartungsfenster",
                        },
                    ],
                });
            if (call.path === "/api/admin/audit") return json(route, 200, { events: auditFor(call.query), next: null });
            if (call.path.startsWith("/api/admin/people/")) {
                const id = call.path.split("/").pop();
                const found = people(options.role).find((entry) => entry.id === id);
                return json(route, 200, {
                    person: found,
                    loginName: found?.methods.includes("password") ? "praiodan" : null,
                    discord: {
                        userId: "123456789012345678",
                        username: "praiodan",
                        globalName: null,
                        linkedAt: ago(DAY),
                        lastLoginAt: ago(DAY),
                    },
                    passkeys: [],
                    sessions: [],
                    specialCapabilities: [],
                    legacy: [],
                });
            }
        }
        if (
            call.path === "/api/admin/invitations" ||
            call.path.endsWith("/reset-link") ||
            call.path.endsWith("/passkey-link")
        )
            return json(route, 200, {
                receipt: { status: "applied" },
                link: "https://stage.avesmaps.de/einladung#q7Xk2mRv9ZtL4wNpC3sdq7Xk2mRv9ZtL4wNpC3sdXyZ",
                expiresAt: ahead(7 * DAY),
            });
        return json(route, 200, { status: "applied", operationId: call.body?.["operationId"] });
    });
    return calls;
}
