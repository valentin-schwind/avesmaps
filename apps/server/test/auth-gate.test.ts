import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, FastifyReply } from "fastify";
import { buildApp } from "../src/app.ts";
import { AUTH_CHANGE_CHANNEL } from "../src/auth/change-watch.ts";
import {
    createGate,
    GateCache,
    GATE_CLOSED_MS,
    GATE_OPEN_MS,
    type GateState,
    type GateStatus,
} from "../src/auth/gate.ts";
import { hashPassword } from "../src/auth/password-hash.ts";
import { SESSION_COOKIE_MAX_AGE_S, setSessionCookie } from "../src/auth/plugin.ts";
import { SESSION_UNBOUNDED } from "../src/auth/session-store.ts";
import { randomToken } from "../src/auth/tokens.ts";
import { gateProfile, type GateProfile, type ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { SYSTEM_CHANNEL, SystemStateStore, type SystemStateSnapshot } from "../src/system/state-store.ts";
import { freeInRestrictedMode } from "../src/system/restricted-mode.ts";
import { SESSION_COOKIE, TEST_AUTH, TEST_ORIGIN, authFixture, type SessionOptions } from "./support/auth-fixture.ts";
import { relayTo } from "./support/db-relay.ts";

/**
 * Die Tür (WI-0120 R6, AUTH-0001 §4.5; WI-0127 SYS-3, SYS-0001 §4.3, §7.1 Zeile SYS-3, §7.2): Nginx fragt für jede Anfrage
 * `GET /api/auth/gate`. Die Antwort folgt aus Bereitschaft, Profil (`AUTH_GATE`), Betriebszustand und Sitzung; Claudio hat die
 * Matrix bestätigt (`handovers/2026-10-10-sys-0001-bau-antwort.md`): 204 durch, 401 → `/anmelden`, 403 → Wartung, 503 → Störung.
 *
 * Problemfälle: Production im Normalbetrieb (keine Datenbank, kein Cookie), eingeschränkt ohne zweiten Faktor, Notzugang,
 * Sonderrecht statt Rolle, unbekannter Zustand, Datenbank weg und zurück, Abmelden, Entzug während des Lesens, Speicher voll.
 * Soll: jede Zeile der Matrix; die Bereitschaft kommt aus dem Speicher, nie eine Datenbankfrage je Türfrage; die Tür schreibt nie.
 *
 * Dazu das Sitzungscookie mit `Max-Age` (Betreiber 2026-10-09: „basic-auth … speichert es aufm handy nicht“); seit 2026-10-10
 * ist die Sitzung unbefristet, das Cookie trägt das Maximum der Browser und wird beim Laden der Seite erneuert.
 */

const DAY_S = 24 * 60 * 60;

interface FakeDatabase {
    database: Database;
    /** Die Sitzungsabfragen (ohne Betriebszustand und ohne Proben des Wächters). */
    queries: string[];
    stateReads: number;
    rows: Record<string, unknown>[];
    state: () => Promise<Record<string, unknown>[]>;
    notify(personId: string): void;
    reconnect(): void;
    /** Läuft während der nächsten Sitzungsabfrage, vor ihrer Antwort. */
    during?: (() => void) | undefined;
}

function sessionRow(personId: string, now: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: "00000000-0000-4000-8000-000000000001",
        person_id: personId,
        display_name: "Praiodan",
        role: "editor",
        grants: [],
        environment: "test",
        method: "discord",
        assurance: "strong",
        created_at: new Date(now - 60_000),
        last_seen_at: new Date(now - 60_000),
        confirmed_at: new Date(now - 60_000),
        // `strong` gibt es seit dem 2026-10-10 nur mit Passkey-Nachweis in der Sitzung (Betreiber: „4. B“).
        passkey_confirmed_at: new Date(now - 86_400_000),
        expires_at: SESSION_UNBOUNDED,
        idle_expires_at: SESSION_UNBOUNDED,
        rotate_required: false,
        ...overrides,
    };
}

function stateRow(mode: "normal" | "restricted", revision = 1): Record<string, unknown> {
    const since = new Date("2026-10-10T08:00:00Z");
    return {
        mode,
        mode_since: since,
        mode_by: null,
        mode_by_label: mode === "restricted" ? "cli:test" : null,
        mode_reason: mode === "restricted" ? "Probe" : null,
        map_lock: false,
        map_lock_since: null,
        map_lock_by: null,
        map_lock_by_label: null,
        map_lock_reason: null,
        system_lock: false,
        system_lock_since: null,
        system_lock_by: null,
        system_lock_by_label: null,
        system_lock_reason: null,
        revision,
        content_revision: 1,
        updated_at: since,
    };
}

/** Eine Datenbank, die jede Abfrage zählt und ihre Zeilen vorgegeben liefert; `LISTEN` wie bei postgres.js. */
function fakeDatabase(): FakeDatabase {
    let onNotify: ((payload: string) => void) | undefined;
    let onListen: (() => void) | undefined;
    const fake: FakeDatabase = {
        database: undefined as unknown as Database,
        queries: [],
        stateReads: 0,
        rows: [],
        state: async () => [stateRow("normal")],
        notify: (personId) => onNotify?.(personId),
        reconnect: () => onListen?.(),
    };
    const sql = (strings: TemplateStringsArray): Promise<unknown[]> | object => {
        const text = strings.join("?");
        if (text.includes("FROM system_state")) {
            fake.stateReads += 1;
            return fake.state();
        }
        if (text.includes("pg_notify")) return Promise.resolve([]);
        // Ein leeres Fragment (`sql\`\``) innerhalb einer Abfrage.
        if (text.trim() === "" || text.trim() === "FOR UPDATE") return {};
        fake.queries.push(text);
        const during = fake.during;
        fake.during = undefined;
        during?.();
        return Promise.resolve([...fake.rows]);
    };
    fake.database = Object.assign(sql, {
        listen: async (channel: string, notify: (payload: string) => void, listening?: () => void) => {
            if (channel === AUTH_CHANGE_CHANNEL) {
                onNotify = notify;
                onListen = listening;
            } else {
                expect(channel).toBe(SYSTEM_CHANNEL);
            }
            listening?.();
            return { unlisten: async () => undefined };
        },
    }) as unknown as Database;
    return fake;
}

function snapshot(overrides: Partial<SystemStateSnapshot> = {}): SystemStateSnapshot {
    return {
        source: "database",
        mode: "normal",
        mapLock: false,
        systemLock: false,
        revision: 1,
        contentRevision: 1,
        readAt: new Date(),
        ready: true,
        listen: { connected: true, generation: 1, lastResyncAt: null },
        ...overrides,
    };
}

/** Ein Betriebszustand, den der Test setzt; jeder Wechsel geht wie beim Speicher an die Hörer. */
function fakeState(initial: Partial<SystemStateSnapshot> = {}) {
    let current = snapshot(initial);
    const listeners = new Set<(previous: SystemStateSnapshot, next: SystemStateSnapshot) => void>();
    const state: GateState = {
        snapshot: () => current,
        onChange: (listener) => {
            listeners.add(listener);
            return () => void listeners.delete(listener);
        },
    };
    return {
        state,
        set(next: Partial<SystemStateSnapshot>) {
            const previous = current;
            current = snapshot(next);
            for (const listener of listeners) listener(previous, current);
        },
    };
}

const PERSON = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const cookie = (token: string): string => `${SESSION_COOKIE}=${token}`;

describe("Die Tür: Speicher im Prozess", () => {
    let clock = Date.parse("2026-10-09T12:00:00Z");
    const now = (): number => clock;

    function setup(cache = new GateCache({ now })) {
        const fake = fakeDatabase();
        const gate = createGate({ database: fake.database, config: TEST_AUTH, cache, state: fakeState().state });
        // Profil `members`, Normalbetrieb, bereit: offen heißt 204.
        const admits = async (header: string | undefined): Promise<boolean> => (await gate.decide(header)) === 204;
        return { fake, gate, cache, admits };
    }

    it("🔴 ohne Cookie und mit falsch geformtem Token: zu, ohne die Datenbank zu fragen", async () => {
        const { fake, admits } = setup();
        expect(await admits(undefined)).toBe(false);
        expect(await admits("andere=1")).toBe(false);
        expect(await admits(cookie("kurz"))).toBe(false);
        expect(await admits(cookie(`${randomToken()}'--`))).toBe(false);
        expect(fake.queries).toHaveLength(0);
    });

    it("🔴 Treffer ohne Datenbankfrage; nach 30 s fragt sie neu", async () => {
        const { fake, admits } = setup();
        fake.rows = [sessionRow(PERSON, clock)];
        const token = randomToken();
        expect(await admits(cookie(token))).toBe(true);
        for (let i = 0; i < 50; i += 1) expect(await admits(cookie(token))).toBe(true);
        expect(fake.queries).toHaveLength(1);
        clock += GATE_OPEN_MS - 1;
        expect(await admits(cookie(token))).toBe(true);
        expect(fake.queries).toHaveLength(1);
        clock += 1;
        fake.rows = [];
        expect(await admits(cookie(token))).toBe(false);
        expect(fake.queries).toHaveLength(2);
    });

    it("🔴 nie über das Ende einer befristeten Sitzung hinaus (seit 2026-10-10 nur noch der Notzugang)", async () => {
        const { fake, admits } = setup();
        const end = new Date(clock + 10_000);
        fake.rows = [
            sessionRow(PERSON, clock, {
                assurance: "recovery",
                method: "recovery",
                expires_at: end,
                idle_expires_at: end,
            }),
        ];
        const token = randomToken();
        expect(await admits(cookie(token))).toBe(true);
        clock += 10_000;
        expect(await admits(cookie(token))).toBe(true);
        expect(fake.queries).toHaveLength(2);
    });

    it("🔴 ein unbekanntes Token bleibt 5 s zu, dann fragt sie wieder", async () => {
        const { fake, admits } = setup();
        const token = randomToken();
        expect(await admits(cookie(token))).toBe(false);
        expect(await admits(cookie(token))).toBe(false);
        expect(fake.queries).toHaveLength(1);
        clock += GATE_CLOSED_MS;
        fake.rows = [sessionRow(PERSON, clock)];
        expect(await admits(cookie(token))).toBe(true);
        expect(fake.queries).toHaveLength(2);
    });

    it("🔴 Entzug per NOTIFY: die Einträge dieser Person fallen sofort heraus, andere bleiben", async () => {
        const { fake, admits } = setup();
        const mine = randomToken();
        const theirs = randomToken();
        fake.rows = [sessionRow(PERSON, clock)];
        await admits(cookie(mine));
        fake.rows = [sessionRow(OTHER, clock)];
        await admits(cookie(theirs));
        expect(fake.queries).toHaveLength(2);

        fake.notify(PERSON);
        fake.rows = [];
        expect(await admits(cookie(mine))).toBe(false);
        expect(await admits(cookie(theirs))).toBe(true);
        expect(fake.queries).toHaveLength(3);
    });

    it("🔴 Wiederverbinden von LISTEN: alles fällt heraus (das erste LISTEN nicht)", async () => {
        const { fake, cache, admits } = setup();
        fake.rows = [sessionRow(PERSON, clock)];
        await admits(cookie(randomToken()));
        await admits(cookie(randomToken()));
        expect(cache.size).toBe(2);
        fake.reconnect();
        expect(cache.size).toBe(0);
    });

    it("🔴 Abmelden über diese Instanz vergisst das Token sofort, ohne auf NOTIFY zu warten", async () => {
        const { fake, gate, admits } = setup();
        const token = randomToken();
        fake.rows = [sessionRow(PERSON, clock)];
        await admits(cookie(token));
        gate.forget(`a=1; ${cookie(token)}`);
        fake.rows = [];
        expect(await admits(cookie(token))).toBe(false);
        expect(fake.queries).toHaveLength(2);
    });

    it("🔴 ein Entzug während des Lesens: das gelesene Urteil wird nicht gemerkt", async () => {
        const { fake, admits } = setup();
        const token = randomToken();
        fake.rows = [sessionRow(PERSON, clock)];
        fake.during = () => fake.notify(PERSON);
        expect(await admits(cookie(token))).toBe(true);
        await admits(cookie(token));
        expect(fake.queries).toHaveLength(2);
    });

    it("🔴 die Tür prüft nur: auch eine zur Erneuerung markierte Sitzung kommt durch, und sie schreibt nie", async () => {
        const { fake, admits } = setup();
        fake.rows = [sessionRow(PERSON, clock, { rotate_required: true })];
        expect(await admits(cookie(randomToken()))).toBe(true);
        expect(fake.queries).toHaveLength(1);
        expect(fake.queries[0]).toMatch(/^\s*SELECT/u);
        expect(fake.queries.join(" ")).not.toMatch(/UPDATE|INSERT|DELETE/u);
    });

    it("höchstens so viele Einträge wie erlaubt; die ältesten fallen zuerst", async () => {
        const cache = new GateCache({ now, maxEntries: 3 });
        const { fake, admits } = setup(cache);
        fake.rows = [sessionRow(PERSON, clock)];
        const tokens = [randomToken(), randomToken(), randomToken(), randomToken()];
        for (const token of tokens) await admits(cookie(token));
        expect(cache.size).toBe(3);
        await admits(cookie(tokens[3]!));
        expect(fake.queries).toHaveLength(4);
        await admits(cookie(tokens[0]!));
        expect(fake.queries).toHaveLength(5);
    });

    it("ohne Anmeldung auf der Instanz: zu, ohne Datenbank", async () => {
        const gate = createGate({ database: undefined, config: TEST_AUTH, state: fakeState().state });
        expect(await gate.decide(cookie(randomToken()))).toBe(401);
    });

    it("🔴 jeder Wechsel von Stellung oder Revision leert den Speicher; das Alter des Stands allein nicht", async () => {
        const fake = fakeDatabase();
        const { state, set } = fakeState();
        const cache = new GateCache({ now });
        const gate = createGate({ database: fake.database, config: TEST_AUTH, cache, state });
        fake.rows = [sessionRow(PERSON, clock)];
        await gate.decide(cookie(randomToken()));
        expect(cache.size).toBe(1);
        set({ readAt: new Date(clock + 5_000) });
        expect(cache.size).toBe(1);
        set({ revision: 2 });
        expect(cache.size).toBe(0);
        await gate.decide(cookie(randomToken()));
        set({ revision: 2, mode: "restricted" });
        expect(cache.size).toBe(0);
        await gate.close();
        // Nach dem Schließen hört die Tür nicht mehr zu.
        await gate.decide(cookie(randomToken()));
        set({ revision: 3, mode: "normal" });
        expect(cache.size).toBe(1);
    });
});

// --- Die Matrix: Profil × Stellung × Sitzung × Bereitschaft ------------------------------------------------------------------

type Kind =
    | "ohne"
    | "unbekannt"
    | "editor"
    | "admin"
    | "admin mit Sonderrecht"
    | "operator ohne 2. Faktor"
    | "operator"
    | "Notzugang";

const KINDS: Record<Exclude<Kind, "ohne" | "unbekannt">, Record<string, unknown>> = {
    editor: { role: "editor" },
    admin: { role: "admin" },
    "admin mit Sonderrecht": { role: "admin", grants: ["access_restricted_mode"] },
    "operator ohne 2. Faktor": { role: "operator", assurance: "basic", method: "password" },
    operator: { role: "operator" },
    Notzugang: { role: "operator", assurance: "recovery", method: "recovery" },
};

const STATES: Record<string, Partial<SystemStateSnapshot>> = {
    Normal: {},
    "Normal vor migrate": { source: "unprovisioned", revision: null },
    Eingeschränkt: { mode: "restricted" },
    // Kann der Speicher heute nicht liefern (unbekannt ist immer auch nicht bereit); die Tür hält ihn trotzdem für eingeschränkt.
    "unbekannt, aber bereit": { source: "unknown", mode: null, mapLock: null, systemLock: null, revision: null },
    "nicht bereit": { ready: false },
    unbekannt: { source: "unknown", mode: null, mapLock: null, systemLock: null, revision: null, ready: false },
};

/** SYS-0001 §4.3, wie mit Claudio bestätigt; je Zeile die Spalten in der Reihenfolge von `Kind`. */
const ALL_503 = [503, 503, 503, 503, 503, 503, 503, 503] as const;
const MATRIX: Record<GateProfile, Record<string, readonly GateStatus[]>> = {
    members: {
        Normal: [401, 401, 204, 204, 204, 204, 204, 204],
        "Normal vor migrate": [401, 401, 204, 204, 204, 204, 204, 204],
        Eingeschränkt: [401, 401, 403, 403, 204, 403, 204, 204],
        "unbekannt, aber bereit": [401, 401, 403, 403, 204, 403, 204, 204],
        "nicht bereit": ALL_503,
        unbekannt: ALL_503,
    },
    public: {
        Normal: [204, 204, 204, 204, 204, 204, 204, 204],
        "Normal vor migrate": [204, 204, 204, 204, 204, 204, 204, 204],
        Eingeschränkt: [403, 403, 403, 403, 204, 403, 204, 204],
        "unbekannt, aber bereit": [403, 403, 403, 403, 204, 403, 204, 204],
        "nicht bereit": ALL_503,
        unbekannt: ALL_503,
    },
};
const KIND_ORDER: readonly Kind[] = [
    "ohne",
    "unbekannt",
    "editor",
    "admin",
    "admin mit Sonderrecht",
    "operator ohne 2. Faktor",
    "operator",
    "Notzugang",
];

describe("Die Tür: Matrix aus Profil, Stellung, Sitzung und Bereitschaft (SYS-0001 §4.3)", () => {
    const clock = Date.parse("2026-10-10T12:00:00Z");

    async function verdicts(profile: GateProfile, state: Partial<SystemStateSnapshot>) {
        const fake = fakeDatabase();
        const gate = createGate({
            database: fake.database,
            config: TEST_AUTH,
            profile,
            state: fakeState(state).state,
            cache: new GateCache({ now: () => clock }),
        });
        const seen: GateStatus[] = [];
        for (const kind of KIND_ORDER) {
            if (kind === "ohne") {
                seen.push(await gate.decide(undefined));
                continue;
            }
            fake.rows = kind === "unbekannt" ? [] : [sessionRow(PERSON, clock, KINDS[kind])];
            seen.push(await gate.decide(cookie(randomToken())));
        }
        await gate.close();
        return { seen, queries: fake.queries.length, readiness: gate.readiness() };
    }

    for (const profile of ["members", "public"] as const) {
        for (const [name, state] of Object.entries(STATES)) {
            it(`🔴 ${profile} · ${name}`, async () => {
                const { seen, queries, readiness } = await verdicts(profile, state);
                expect(Object.fromEntries(KIND_ORDER.map((kind, i) => [kind, seen[i]]))).toEqual(
                    Object.fromEntries(KIND_ORDER.map((kind, i) => [kind, MATRIX[profile][name]![i]])),
                );
                const ready = state.ready !== false;
                expect(readiness).toBe(ready ? 204 : 503);
                // Nicht bereit: keine Sitzung gelesen. Production im Normalbetrieb: kein Cookie, keine Datenbank.
                const normal = name.startsWith("Normal");
                if (!ready || (profile === "public" && normal)) expect(queries).toBe(0);
            });
        }
    }

    it("🔴 eine Discord-2FA-Sitzung von vor dem 2026-10-10 hat kein Zugangsrecht mehr: eingeschränkt 403, normal 204 (Betreiber: „4. B“)", async () => {
        const legacy = { role: "operator", assurance: "strong", passkey_confirmed_at: null };
        for (const profile of ["members", "public"] as const) {
            for (const [name, expected] of [
                ["Normal", 204],
                ["Eingeschränkt", 403],
            ] as const) {
                const fake = fakeDatabase();
                const gate = createGate({
                    database: fake.database,
                    config: TEST_AUTH,
                    profile,
                    state: fakeState(STATES[name]!).state,
                    cache: new GateCache({ now: () => clock }),
                });
                fake.rows = [sessionRow(PERSON, clock, legacy)];
                expect(await gate.decide(cookie(randomToken())), `${profile} · ${name}`).toBe(expected);
                // Derselbe Mensch, nachdem er in dieser Sitzung mit Passkey bestätigt hat: wieder drin.
                fake.rows = [sessionRow(PERSON, clock, { ...legacy, passkey_confirmed_at: new Date(clock - 60_000) })];
                expect(await gate.decide(cookie(randomToken())), `${profile} · ${name} · Passkey`).toBe(204);
                await gate.close();
            }
        }
    });

    it("🔴 ohne Betriebszustand (keine Datenbank) ist die Tür nie bereit: 503, auch im Profil public", async () => {
        for (const profile of ["members", "public"] as const) {
            const gate = createGate({ database: undefined, config: TEST_AUTH, profile });
            expect(await gate.decide(undefined)).toBe(503);
            expect(gate.readiness()).toBe(503);
        }
    });

    it("AUTH_GATE: ohne Wert members, sonst genau members oder public; ein Tippfehler hält den Start an", () => {
        expect(gateProfile({})).toBe("members");
        expect(gateProfile({ AUTH_GATE: "" })).toBe("members");
        expect(gateProfile({ AUTH_GATE: "members" })).toBe("members");
        expect(gateProfile({ AUTH_GATE: "public" })).toBe("public");
        expect(() => gateProfile({ AUTH_GATE: "publik" })).toThrow(/AUTH_GATE/u);
        expect(() => gateProfile({ AUTH_GATE: "Public" })).toThrow(/AUTH_GATE/u);
    });

    it("im eingeschränkten Betrieb offen ohne Zugangsrecht: nur Anmeldung samt Tür, Gesundheit und der Inhaltsstand", () => {
        expect(freeInRestrictedMode("GET", "/api/auth/gate")).toBe(true);
        expect(freeInRestrictedMode("POST", "/api/auth/login")).toBe(true);
        expect(freeInRestrictedMode("GET", "/health")).toBe(true);
        expect(freeInRestrictedMode("GET", "/health/mode")).toBe(true);
        expect(freeInRestrictedMode("GET", "/api/content-state")).toBe(true);
        expect(freeInRestrictedMode("POST", "/api/content-state")).toBe(false);
        expect(freeInRestrictedMode("GET", "/healthz")).toBe(false);
        expect(freeInRestrictedMode("POST", "/api/account/password")).toBe(false);
        expect(freeInRestrictedMode("GET", "/api/search")).toBe(false);
        expect(freeInRestrictedMode("GET", "/tiles/vector/:layer/:z/:x/:y")).toBe(false);
        expect(freeInRestrictedMode("GET", undefined)).toBe(false);
    });
});

describe("Die Tür: Bereitschaft aus dem Speicher, nie eine Datenbankfrage je Türfrage", () => {
    it("🔴 tausend Türfragen, null Abfragen; ohne gelungenes Lesen binnen zwei Takten 503, nach dem nächsten Lesen wieder 204", async () => {
        let clock = Date.parse("2026-10-10T12:00:00Z");
        const fake = fakeDatabase();
        const store = new SystemStateStore({ database: fake.database, now: () => clock, tickMs: 60_000 });
        await store.start();
        const gate = createGate({ database: fake.database, config: TEST_AUTH, profile: "public", state: store });
        try {
            const reads = fake.stateReads;
            expect(reads).toBe(1);
            for (let i = 0; i < 1000; i += 1) expect(await gate.decide(undefined)).toBe(204);
            for (let i = 0; i < 100; i += 1) expect(gate.readiness()).toBe(204);
            expect([fake.stateReads, fake.queries.length]).toEqual([reads, 0]);

            // Der Takt kommt nicht zum Lesen (Datenbank hängt): nach zwei Takten (10 s) nicht mehr bereit.
            clock += 10_001;
            expect(await gate.decide(undefined)).toBe(503);
            expect(gate.readiness()).toBe(503);
            await store.refresh();
            expect(await gate.decide(undefined)).toBe(204);

            // Das Lesen scheitert (Datenbank weg): sofort 503, ohne die Uhr abzuwarten.
            fake.state = () => Promise.reject(Object.assign(new Error("weg"), { code: "ECONNREFUSED" }));
            await store.refresh();
            expect(await gate.decide(undefined)).toBe(503);
            expect(gate.readiness()).toBe(503);
            fake.state = async () => [stateRow("normal")];
            await store.refresh();
            expect(gate.readiness()).toBe(204);
            expect(fake.queries).toHaveLength(0);
        } finally {
            await gate.close();
            await store.close();
        }
    });

    it("🔴 im Profil members: eine Sitzungsabfrage je Token und 30 s, die Bereitschaft fragt nie zusätzlich", async () => {
        const fake = fakeDatabase();
        const store = new SystemStateStore({ database: fake.database, tickMs: 60_000 });
        await store.start();
        const gate = createGate({ database: fake.database, config: TEST_AUTH, profile: "members", state: store });
        try {
            fake.rows = [sessionRow(PERSON, Date.now())];
            const token = randomToken();
            for (let i = 0; i < 500; i += 1) expect(await gate.decide(cookie(token))).toBe(204);
            expect([fake.stateReads, fake.queries.length]).toEqual([1, 1]);
        } finally {
            await gate.close();
            await store.close();
        }
    });
});

describe("Sitzungscookie mit Laufzeit", () => {
    function capture(): { reply: FastifyReply; cookies: () => string[] } {
        let value: unknown;
        const reply = {
            getHeader: () => value,
            header: (_name: string, next: unknown) => {
                value = next;
                return reply;
            },
        } as unknown as FastifyReply;
        return { reply, cookies: () => [value].flat().map(String) };
    }

    it("🔴 Max-Age: eine unbefristete Sitzung bekommt das Maximum der Browser (400 Tage), ein Notzugang seinen Rest", () => {
        const now = Date.parse("2026-10-09T12:00:00Z");
        expect(SESSION_COOKIE_MAX_AGE_S).toBe(400 * DAY_S);
        const unbounded = capture();
        setSessionCookie(unbounded.reply, TEST_AUTH, { token: "abc", expiresAt: SESSION_UNBOUNDED }, now);
        expect(unbounded.cookies()).toEqual([
            `__Host-avesmaps-session=abc; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${String(400 * DAY_S)}`,
        ]);
        const recovery = capture();
        setSessionCookie(recovery.reply, TEST_AUTH, { token: "abc", expiresAt: new Date(now + 3_599_400) }, now);
        expect(recovery.cookies()[0]).toMatch(/; Max-Age=3600$/u);
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const SILENT = { write: (): void => undefined };

describeWithDatabase("Die Tür gegen PostgreSQL", { timeout: 60_000 }, () => {
    let database: Database;
    let fixture: ReturnType<typeof authFixture>;
    const apps: FastifyInstance[] = [];
    let app: FastifyInstance | undefined;

    const config = (authGate?: GateProfile): ServerConfig => ({
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        auth: TEST_AUTH,
        ...(authGate === undefined ? {} : { authGate }),
    });

    async function build(
        options: { authGate?: GateProfile; database?: Database; store?: SystemStateStore; watchTickMs?: number } = {},
    ): Promise<FastifyInstance> {
        const instance = buildApp({
            config: config(options.authGate),
            database: options.database ?? createDatabase(testDatabaseUrl as string, { max: 2 }),
            logStream: SILENT,
            ...(options.store === undefined ? {} : { systemState: options.store }),
            ...(options.watchTickMs === undefined ? {} : { gateWatch: { tickMs: options.watchTickMs } }),
        });
        apps.push(instance);
        await instance.ready();
        return instance;
    }

    /** Normal, beide Sperren offen: so beginnt und endet jeder Fall. */
    async function resetState(): Promise<void> {
        await database`
            UPDATE system_state SET mode = 'normal', mode_by = NULL, mode_by_label = NULL, mode_reason = NULL
             WHERE id = 1 AND mode <> 'normal'
        `;
    }

    async function restrict(): Promise<void> {
        await database`
            UPDATE system_state SET mode = 'restricted', mode_since = now(), mode_by = NULL, mode_by_label = 'cli:test',
                   mode_reason = 'Test SYS-3'
             WHERE id = 1
        `;
    }

    /** Bis jede Instanz die Stellung kennt (Weckruf, ≤ 1 s). */
    async function settled(mode: "normal" | "restricted", ...instances: FastifyInstance[]): Promise<void> {
        const end = Date.now() + 5_000;
        while (instances.some((instance) => instance.systemState?.snapshot().mode !== mode)) {
            if (Date.now() > end) throw new Error(`Stellung ${mode} nicht angekommen`);
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 3 });
        await migrate(database);
        await seedMapDomains(database);
        fixture = authFixture(database);
        await resetState();
    });

    afterEach(async () => {
        await resetState();
        for (const instance of apps.splice(0)) await instance.close();
        app = undefined;
        await fixture.cleanup();
    });

    afterAll(async () => {
        await database.end({ timeout: 5 });
    });

    const gate = async (cookieHeader: string, on: FastifyInstance = app!) =>
        (await on.inject({ method: "GET", url: "/api/auth/gate", headers: { cookie: cookieHeader } })).statusCode;

    /** Bis die Meldung der Datenbank angekommen ist: höchstens 5 s. */
    async function until(expected: number, cookieHeader: string): Promise<number> {
        const end = Date.now() + 5000;
        let status = await gate(cookieHeader);
        while (status !== expected && Date.now() < end) {
            await new Promise((resolve) => setTimeout(resolve, 25));
            status = await gate(cookieHeader);
        }
        return status;
    }

    async function personWith(
        role: "editor" | "admin" | "operator",
        session: SessionOptions = {},
        grants: string[] = [],
    ): Promise<string> {
        const person = await fixture.person(role);
        for (const capability of grants) {
            await database`
                INSERT INTO avesmaps_auth.capability_grant (person_id, environment, capability, reason)
                VALUES (${person.id}, 'test', ${capability}, 'Test SYS-3')
            `;
        }
        return (await fixture.session(person.id, session)).cookie;
    }

    it("🔴 Treffer ohne Datenbank, Herabstufen räumt über NOTIFY aus", async () => {
        app = await build();
        const person = await fixture.person("editor");
        const { id, cookie: sessionCookie } = await fixture.session(person.id);
        expect(await gate(sessionCookie)).toBe(204);
        // Die Zeile verschwindet ohne Meldung (DELETE löst keinen Trigger aus): die Tür antwortet aus dem Speicher.
        await database`DELETE FROM avesmaps_auth.session WHERE id = ${id}`;
        expect(await gate(sessionCookie)).toBe(204);
        // Herabstufen meldet sich (Migration 0081): die Tür vergisst die Person und fragt neu.
        await database`UPDATE avesmaps_auth.person_access SET role = 'tester' WHERE person_id = ${person.id}`;
        expect(await until(401, sessionCookie)).toBe(401);
    });

    it("🔴 Sperren und Zugang entziehen wirken an der Tür sofort", async () => {
        app = await build();
        const locked = await fixture.person("editor");
        const first = await fixture.session(locked.id);
        expect(await gate(first.cookie)).toBe(204);
        await database`UPDATE avesmaps_auth.person SET status = 'locked' WHERE id = ${locked.id}`;
        expect(await until(401, first.cookie)).toBe(401);

        const revoked = await fixture.person("tester");
        const second = await fixture.session(revoked.id);
        expect(await gate(second.cookie)).toBe(204);
        await database`UPDATE avesmaps_auth.person_access SET status = 'revoked' WHERE person_id = ${revoked.id}`;
        expect(await until(401, second.cookie)).toBe(401);
    });

    it("🔴 Abmelden schließt die Tür im selben Augenblick", async () => {
        app = await build();
        const person = await fixture.person("editor");
        const { cookie: sessionCookie } = await fixture.session(person.id);
        expect(await gate(sessionCookie)).toBe(204);
        const logout = await app.inject({
            method: "POST",
            url: "/api/auth/logout",
            headers: { cookie: sessionCookie, origin: TEST_ORIGIN },
        });
        expect(logout.statusCode).toBe(204);
        expect(await gate(sessionCookie)).toBe(401);
    });

    it("🔴 die Tür erneuert nicht und schreibt nicht: kein Set-Cookie, kein last_seen_at, die Sitzung bleibt", async () => {
        app = await build();
        const person = await fixture.person("editor");
        const { id, cookie: sessionCookie } = await fixture.session(person.id, { lastSeenMinutesAgo: 30 });
        await database`UPDATE avesmaps_auth.session SET rotate_required = true WHERE id = ${id}`;
        const [before] = await database<{ last_seen_at: Date }[]>`
            SELECT last_seen_at FROM avesmaps_auth.session WHERE id = ${id}
        `;
        const response = await app.inject({
            method: "GET",
            url: "/api/auth/gate",
            headers: { cookie: sessionCookie },
        });
        expect(response.statusCode).toBe(204);
        expect(response.headers["set-cookie"]).toBeUndefined();
        const [after] = await database<{ last_seen_at: Date; revoked_at: Date | null; rotate_required: boolean }[]>`
            SELECT last_seen_at, revoked_at, rotate_required FROM avesmaps_auth.session WHERE id = ${id}
        `;
        expect(after).toEqual({ last_seen_at: before!.last_seen_at, revoked_at: null, rotate_required: true });
        // Erneuert wird beim nächsten gewöhnlichen Aufruf, dort kommt das Cookie an.
        const session = await app.inject({
            method: "GET",
            url: "/api/auth/session",
            headers: { cookie: sessionCookie },
        });
        expect(String(session.headers["set-cookie"])).toMatch(
            /__Host-avesmaps-session=[A-Za-z0-9_-]{43};.*Max-Age=\d+/u,
        );
    });

    it("nur GET (und HEAD): eine andere Methode trifft die Tür nicht", async () => {
        app = await build();
        const response = await app.inject({
            method: "POST",
            url: "/api/auth/gate",
            headers: { origin: TEST_ORIGIN },
            payload: {},
        });
        expect(response.statusCode).toBe(404);
        expect((await app.inject({ method: "HEAD", url: "/api/auth/gate" })).statusCode).toBe(401);
    });

    const maxAgeOf = (header: unknown): number => Number(/Max-Age=(\d+)/u.exec(String([header].flat().at(-1)))?.[1]);

    it("🔴 unbefristete Sitzung (Betreiber 2026-10-10): Anmelden, Laden und Rotation setzen Max-Age = 400 Tage", async () => {
        app = await build();
        const person = await fixture.person("editor");
        const loginName = `r6-${String(Date.now())}`.slice(0, 40);
        await database`
            INSERT INTO avesmaps_auth.password_login (person_id, login_name, password_hash)
            VALUES (${person.id}, ${loginName}, ${await hashPassword("Rondra schützt die Tapferen am Tor")})
        `;
        const login = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            headers: { origin: TEST_ORIGIN },
            payload: { loginName, password: "Rondra schützt die Tapferen am Tor" },
        });
        expect(login.statusCode).toBe(200);
        const set = String([login.headers["set-cookie"]].flat().at(-1));
        expect(maxAgeOf(set)).toBe(400 * DAY_S);
        const [created] = await database<{ expires_at: Date; idle_expires_at: Date }[]>`
            SELECT expires_at, idle_expires_at FROM avesmaps_auth.session WHERE person_id = ${person.id} AND revoked_at IS NULL
        `;
        expect(created).toEqual({ expires_at: SESSION_UNBOUNDED, idle_expires_at: SESSION_UNBOUNDED });

        // Jedes Laden der Seite erneuert das Cookie mit demselben Token und voller Laufzeit.
        const cookie = set.split(";")[0]!;
        const renewed = await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie } });
        expect(String(renewed.headers["set-cookie"])).toContain(`${cookie}; Path=/`);
        expect(maxAgeOf(renewed.headers["set-cookie"])).toBe(400 * DAY_S);

        // Eine Sitzung aus der Zeit vor dem Entscheid (Ende in 20 Tagen) wird bei der Rotation unbefristet.
        await database`
            UPDATE avesmaps_auth.session
               SET expires_at = now() + interval '480 hours', idle_expires_at = now() + interval '48 hours', rotate_required = true
             WHERE person_id = ${person.id} AND revoked_at IS NULL
        `;
        const rotated = await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie } });
        expect(maxAgeOf(rotated.headers["set-cookie"])).toBe(400 * DAY_S);
        expect([rotated.headers["set-cookie"]].flat()).toHaveLength(1);
        const [live] = await database<{ expires_at: Date; idle_expires_at: Date }[]>`
            SELECT expires_at, idle_expires_at FROM avesmaps_auth.session WHERE person_id = ${person.id} AND revoked_at IS NULL
        `;
        expect(live).toEqual({ expires_at: SESSION_UNBOUNDED, idle_expires_at: SESSION_UNBOUNDED });
    });

    it("🔴 eine alte Sitzung verliert ihr Ende beim nächsten Aufruf; der Notzugang behält seine 60 Minuten", async () => {
        app = await build();
        const person = await fixture.person("editor");
        const old = await fixture.session(person.id, { lastSeenMinutesAgo: 30 });
        await database`
            UPDATE avesmaps_auth.session SET expires_at = now() + interval '120 hours', idle_expires_at = now() + interval '24 hours'
             WHERE id = ${old.id}
        `;
        expect(
            (await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: old.cookie } })).statusCode,
        ).toBe(200);
        const [upgraded] = await database<{ expires_at: Date; idle_expires_at: Date }[]>`
            SELECT expires_at, idle_expires_at FROM avesmaps_auth.session WHERE id = ${old.id}
        `;
        expect(upgraded).toEqual({ expires_at: SESSION_UNBOUNDED, idle_expires_at: SESSION_UNBOUNDED });

        const recovery = await fixture.session(person.id, {
            assurance: "recovery",
            method: "recovery",
            lastSeenMinutesAgo: 5,
        });
        const [before] = await database<{ expires_at: Date }[]>`
            SELECT expires_at FROM avesmaps_auth.session WHERE id = ${recovery.id}
        `;
        expect(before!.expires_at.getTime() - Date.now()).toBeLessThanOrEqual(60 * 60_000);
        const response = await app.inject({
            method: "GET",
            url: "/api/auth/session",
            headers: { cookie: recovery.cookie },
        });
        expect(maxAgeOf(response.headers["set-cookie"])).toBeLessThanOrEqual(3600);
        const [after] = await database<{ expires_at: Date }[]>`
            SELECT expires_at FROM avesmaps_auth.session WHERE id = ${recovery.id}
        `;
        expect(after!.expires_at).toEqual(before!.expires_at);
    });

    it("🔴 Matrix mit echten Sitzungen: members und public, Normal und Eingeschränkt, Notzugang und Sonderrecht", async () => {
        const stage = await build({ authGate: "members" });
        const production = await build({ authGate: "public" });
        const people = {
            ohne: "",
            editor: await personWith("editor"),
            admin: await personWith("admin"),
            "admin mit Sonderrecht": await personWith("admin", {}, ["access_restricted_mode"]),
            "operator ohne 2. Faktor": await personWith("operator", { assurance: "basic", method: "password" }),
            operator: await personWith("operator"),
            Notzugang: await personWith("operator", { assurance: "recovery", method: "recovery" }),
        };
        const row = async (on: FastifyInstance) =>
            Object.fromEntries(
                await Promise.all(Object.entries(people).map(async ([kind, value]) => [kind, await gate(value, on)])),
            );
        expect(await row(stage)).toEqual({
            ohne: 401,
            editor: 204,
            admin: 204,
            "admin mit Sonderrecht": 204,
            "operator ohne 2. Faktor": 204,
            operator: 204,
            Notzugang: 204,
        });
        expect(Object.values(await row(production))).toEqual([204, 204, 204, 204, 204, 204, 204]);

        await restrict();
        await settled("restricted", stage, production);
        expect(await row(stage)).toEqual({
            ohne: 401,
            editor: 403,
            admin: 403,
            "admin mit Sonderrecht": 204,
            "operator ohne 2. Faktor": 403,
            operator: 204,
            Notzugang: 204,
        });
        expect(await row(production)).toEqual({
            ohne: 403,
            editor: 403,
            admin: 403,
            "admin mit Sonderrecht": 204,
            "operator ohne 2. Faktor": 403,
            operator: 204,
            Notzugang: 204,
        });
        // Die Einstiegsseiten fragen nur die Bereitschaft: Auch eingeschränkt lädt `/anmelden`.
        for (const on of [stage, production]) {
            const ready = await on.inject({ method: "GET", url: "/api/auth/gate?nur=bereitschaft" });
            expect([ready.statusCode, ready.body, ready.headers["cache-control"]]).toEqual([204, "", "no-store"]);
        }

        await resetState();
        await settled("normal", stage, production);
        expect((await row(stage))["editor"]).toBe(204);
        expect((await row(production))["ohne"]).toBe(204);
    });

    it("🔴 der eingeschränkte Betrieb in der Anwendung: ohne Zugangsrecht 503 restricted_mode, Anmeldung und Gesundheit offen", async () => {
        app = await build();
        const operator = await personWith("operator");
        const editor = await personWith("editor");
        const search = (cookieHeader?: string) =>
            app!.inject({
                method: "GET",
                url: "/api/search?q=Gar",
                headers: cookieHeader === undefined ? {} : { cookie: cookieHeader },
            });
        expect((await search()).statusCode).toBe(200);

        await restrict();
        await settled("restricted", app);
        for (const refused of [await search(), await search(editor)]) {
            expect(refused.statusCode).toBe(503);
            expect(refused.headers["retry-after"]).toBe("60");
            expect(refused.headers["cache-control"]).toBe("no-store");
            // Der Umschlag, nicht das 503-Schema der Suche (`{ error: string }`).
            expect(refused.json()).toEqual({
                error: {
                    code: "restricted_mode",
                    message: "Avesmaps ist gerade eingeschränkt: Nur berechtigte Personen kommen hinein.",
                },
            });
        }
        expect((await search(operator)).statusCode).toBe(200);
        expect((await app.inject({ method: "GET", url: "/api/auth/session" })).statusCode).toBe(200);
        expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
        expect((await app.inject({ method: "GET", url: "/health/mode" })).statusCode).toBe(200);
        // Auch eine Kachel (ohne `TILE_ROOT` antwortete sie selbst 503, deshalb der Code).
        const tile = await app.inject({ method: "GET", url: "/tiles/raster/original/current.json" });
        expect([tile.statusCode, tile.json().error.code]).toEqual([503, "restricted_mode"]);

        await resetState();
        await settled("normal", app);
        expect((await search()).statusCode).toBe(200);
    });

    it("🔴 Datenbank weg: Tür 503 ab dem nächsten Takt, Einstiegsseiten ebenso; zurück: 204, und ein Entzug wirkt wieder", async () => {
        const relay = await relayTo(testDatabaseUrl as string);
        const viaRelay = createDatabase(relay.url, { max: 2, connectTimeoutS: 1 });
        const store = new SystemStateStore({ database: viaRelay, tickMs: 200 });
        try {
            app = await build({ database: viaRelay, store, watchTickMs: 500 });
            const person = await fixture.person("editor");
            const { cookie: sessionCookie } = await fixture.session(person.id);
            expect(await gate(sessionCookie)).toBe(204);

            await relay.cut();
            const started = Date.now();
            expect(await until(503, sessionCookie)).toBe(503);
            expect(Date.now() - started).toBeLessThan(5_000);
            expect((await app.inject({ method: "GET", url: "/api/auth/gate?nur=bereitschaft" })).statusCode).toBe(503);

            await relay.restore();
            // postgres.js verbindet nach seiner Pause neu (höchstens 1 s, `reconnectBackoff`); dazu das nächste Lesen im Takt.
            const end = Date.now() + 15_000;
            let status = await gate(sessionCookie);
            while (status !== 204 && Date.now() < end) {
                await new Promise((resolve) => setTimeout(resolve, 50));
                status = await gate(sessionCookie);
            }
            expect(status).toBe(204);
            // Der Entzug wirkt wieder, lange vor den 30 s, die sich die Tür die Sitzung sonst merkte: über `NOTIFY`, oder, ging die
            // Meldung im Neuaufbau verloren, über das Leeren beim Wiederhören.
            await database`UPDATE avesmaps_auth.person SET status = 'locked' WHERE id = ${person.id}`;
            const lockedAt = Date.now();
            while (status !== 401 && Date.now() < lockedAt + 15_000) {
                await new Promise((resolve) => setTimeout(resolve, 20));
                status = await gate(sessionCookie);
            }
            expect(status).toBe(401);
            expect(Date.now() - lockedAt).toBeLessThan(GATE_OPEN_MS / 2);
        } finally {
            await relay.close();
        }
    });
});
