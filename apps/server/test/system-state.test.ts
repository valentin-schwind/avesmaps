import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { restrictedAccessHolders } from "../src/system/state-changes.ts";
import { SYSTEM_CHANNEL, SystemStateStore } from "../src/system/state-store.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type SessionOptions } from "./support/auth-fixture.ts";
import { relayTo } from "./support/db-relay.ts";

/**
 * Der Betriebszustand gegen echtes PostgreSQL (WI-0127 SYS-2, SYS-0001 §7.1 Zeile SYS-2, §7.2): Migration 0087, Weckruf, Speicher
 * zweier Instanzen, die Routen `mode` und `lock` über `runOperation`, die Schutzregeln, `/health/mode`, Datenbank weg.
 *
 * Problemfälle: zwei Instanzen (Blue/Green) und eine dritte, die erst danach startet; dieselbe Kennung zweimal und mit anderem Inhalt;
 * zwei Betreiber auf demselben Stand; Einschränken ohne eigenes Zugangsrecht, ohne Passkey bei irgendwem, ohne frischen Passkey; die
 * Datenbank verschwindet und kommt wieder; die `LISTEN`-Verbindung bricht ab; `/health/mode` von außen. Soll: wirksam auf beiden
 * Instanzen binnen 1 s, genau ein Protokolleintrag je Handlung, 409 mit Code, nie ein geratener Zustand (503 `system_state_unknown`).
 *
 * Der Test hinterlässt den Zustand Normal und offen (`resetState`).
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const PASSKEY_FRESH: SessionOptions = { passkeyMinutesAgo: 1 };
const SILENT = { write: () => undefined };

const config: ServerConfig = {
    port: 0,
    host: "127.0.0.1",
    releaseId: "test",
    databaseUrl: undefined,
    tileRoot: undefined,
    auth: TEST_AUTH,
};

/** Wartet, bis `done()` gilt; gibt die Wartezeit in Millisekunden zurück oder wirft nach `limitMs`. */
async function until(done: () => boolean, limitMs: number): Promise<number> {
    const started = performance.now();
    while (!done()) {
        if (performance.now() - started > limitMs) throw new Error(`nach ${String(limitMs)} ms nicht eingetreten`);
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return performance.now() - started;
}

describeWithDatabase("Betriebszustand (Migration 0087, Speicher, Routen)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: ReturnType<typeof authFixture>;
    const apps: FastifyInstance[] = [];
    const extraStores: SystemStateStore[] = [];
    const extraDatabases: Database[] = [];

    /** Normal, beide Sperren offen: so beginnt und endet jeder Fall. */
    async function resetState(): Promise<void> {
        await database`
            UPDATE system_state
               SET mode = 'normal', mode_by = NULL, mode_by_label = NULL, mode_reason = NULL,
                   map_lock = false, map_lock_since = NULL, map_lock_by = NULL, map_lock_by_label = NULL, map_lock_reason = NULL,
                   system_lock = false, system_lock_since = NULL, system_lock_by = NULL, system_lock_by_label = NULL,
                   system_lock_reason = NULL,
                   queue_paused = false, queue_paused_since = NULL, queue_paused_by = NULL, queue_paused_by_label = NULL,
                   queue_paused_reason = NULL
             WHERE id = 1
        `;
    }

    async function revision(): Promise<number> {
        const [row] = await database<
            { revision: number }[]
        >`SELECT revision::int AS revision FROM system_state WHERE id = 1`;
        return row!.revision;
    }

    /** Die Inhaltsrevision; seit SYS-10 heben die Inhaltsschalter sie (Migration 0102), sie ist nicht mehr fest 1. */
    async function contentRevision(): Promise<number> {
        const [row] = await database<
            { revision: number }[]
        >`SELECT content_revision::int AS revision FROM system_state WHERE id = 1`;
        return row!.revision;
    }

    async function build(options: { store?: SystemStateStore; database?: Database } = {}): Promise<FastifyInstance> {
        const own = options.database ?? createDatabase(testDatabaseUrl as string, { max: 4 });
        const app = buildApp({
            config,
            database: own,
            logStream: SILENT,
            ...(options.store === undefined ? {} : { systemState: options.store }),
        });
        apps.push(app);
        await app.ready();
        return app;
    }

    const post = (app: FastifyInstance, url: string, cookie: string, payload: object) =>
        app.inject({ method: "POST", url, payload, headers: { origin: TEST_ORIGIN, cookie } });

    /** Eine Person mit Sitzung, frischem Passkey-Nachweis (Stufe S) und, wenn gewünscht, einem Passkey in dieser Umgebung. */
    async function person(role: Role, name: string, options: { passkey?: boolean; session?: SessionOptions } = {}) {
        const created = await fixture.person(role, { name });
        if (options.passkey !== false) {
            await database`
                INSERT INTO avesmaps_auth.passkey_credential (person_id, environment, rp_id, credential_id, public_key, created_via)
                VALUES (${created.id}, 'test', 'avesmaps.test', ${randomBytes(16).toString("hex")}, ${randomBytes(8)}, 'passkey')
            `;
        }
        const { cookie } = await fixture.session(created.id, options.session ?? PASSKEY_FRESH);
        return { ...created, cookie };
    }

    async function grant(personId: string, capability: string): Promise<void> {
        await database`
            INSERT INTO avesmaps_auth.capability_grant (person_id, environment, capability, reason)
            VALUES (${personId}, 'test', ${capability}, 'Test SYS-2')
        `;
    }

    const events = (operationId: string) =>
        database<
            {
                action: string;
                actor_person_id: string | null;
                target_ref: string | null;
                details: Record<string, unknown>;
            }[]
        >`
            SELECT action, actor_person_id, target_ref, details FROM avesmaps_auth.security_event WHERE operation_id = ${operationId}
        `;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        fixture = authFixture(database);
        await resetState();
    });

    afterEach(async () => {
        for (const app of apps.splice(0)) await app.close();
        for (const store of extraStores.splice(0)) await store.close();
        for (const db of extraDatabases.splice(0)) await db.end({ timeout: 5 });
        await fixture.cleanup();
        await resetState();
    });

    afterAll(async () => {
        await database.end({ timeout: 5 });
    });

    describe("Migration 0087", () => {
        it("🔴 genau eine Zeile, Normal und offen; Einschränken und Sperren nur mit Grund; eine Person ODER die Kommandozeile", async () => {
            const states = await database
                .begin(async (tx) => {
                    const probe = async (sql: string): Promise<string> => {
                        await tx.unsafe("SAVEPOINT probe");
                        try {
                            await tx.unsafe(sql);
                            await tx.unsafe("RELEASE SAVEPOINT probe");
                            return "ok";
                        } catch (error) {
                            await tx.unsafe("ROLLBACK TO SAVEPOINT probe");
                            return (error as { code?: string }).code ?? "fehler";
                        }
                    };
                    const result = {
                        second: await probe("INSERT INTO system_state (id) VALUES (2)"),
                        again: await probe("INSERT INTO system_state (id) VALUES (1)"),
                        restricted: await probe("UPDATE system_state SET mode = 'restricted' WHERE id = 1"),
                        maintenance: await probe(
                            "UPDATE system_state SET mode = 'maintenance', mode_reason = 'x' WHERE id = 1",
                        ),
                        mapLock: await probe(
                            "UPDATE system_state SET map_lock = true, map_lock_since = now() WHERE id = 1",
                        ),
                        systemLock: await probe(
                            "UPDATE system_state SET system_lock = true, system_lock_reason = 'x' WHERE id = 1",
                        ),
                        both: await probe(
                            `UPDATE system_state SET mode_by = '${randomUUID()}', mode_by_label = 'cli:root' WHERE id = 1`,
                        ),
                        withReason: await probe(
                            "UPDATE system_state SET mode = 'restricted', mode_reason = 'Probe' WHERE id = 1",
                        ),
                    };
                    throw Object.assign(new Error("__zurueck__"), { result });
                })
                .catch((error: unknown) => (error as Error & { result: Record<string, string> }).result);
            expect(states).toEqual({
                second: "23514",
                again: "23505",
                restricted: "23514",
                maintenance: "23514",
                mapLock: "23514",
                systemLock: "23514",
                both: "23514",
                withReason: "ok",
            });
            const rows = await database<{ count: number; mode: string; map_lock: boolean; system_lock: boolean }[]>`
                SELECT count(*) OVER ()::int AS count, mode, map_lock, system_lock FROM system_state
            `;
            expect(rows).toEqual([{ count: 1, mode: "normal", map_lock: false, system_lock: false }]);
        });

        it("🔴 die Revision zählt der Trigger; NOTIFY trägt sie und geht erst mit dem COMMIT hinaus", async () => {
            const heard: string[] = [];
            const listener = createDatabase(testDatabaseUrl as string, { max: 1 });
            extraDatabases.push(listener);
            await listener.listen(SYSTEM_CHANNEL, (payload) => void heard.push(payload));
            const before = await revision();
            await database
                .begin(async (tx) => {
                    await tx`UPDATE system_state SET map_lock = true, map_lock_since = now(), map_lock_reason = 'nie' WHERE id = 1`;
                    throw new Error("__zurueck__");
                })
                .catch(() => undefined);
            await database`UPDATE system_state SET mode = 'restricted', mode_reason = 'Probe', revision = 999 WHERE id = 1`;
            await until(() => heard.length > 0, 1_000);
            await new Promise((resolve) => setTimeout(resolve, 50));
            expect(await revision()).toBe(before + 1);
            expect(heard).toEqual([String(before + 1)]);
        });
    });

    describe("Umschalten über die Verwaltung", () => {
        it("🔴 wirkt auf zwei Instanzen binnen 1 s (ohne Takt, nur über NOTIFY), und eine dritte liest beim Start", async () => {
            const operator = await person("operator", "Rondrikan");
            const blue = await build();
            // Green mit einem Takt von einer Minute: Was sie binnen einer Sekunde sieht, kam über den Weckruf.
            const greenDatabase = createDatabase(testDatabaseUrl as string, { max: 4 });
            const green = await build({
                database: greenDatabase,
                store: new SystemStateStore({ database: greenDatabase, tickMs: 60_000 }),
            });
            const base = await revision();
            expect(green.systemState!.snapshot()).toMatchObject({ source: "database", mode: "normal", revision: base });

            const started = performance.now();
            const response = await post(blue, "/api/admin/system/mode", operator.cookie, {
                operationId: randomUUID(),
                baseRevision: base,
                mode: "restricted",
                reason: "Stage für die Abnahme schließen",
            });
            expect(response.statusCode).toBe(200);
            const next = response.json().affected[0].revision as number;
            expect(next).toBe(base + 1);
            // Die eigene Instanz hat sofort nachgelesen.
            expect(blue.systemState!.snapshot()).toMatchObject({ mode: "restricted", revision: next });
            await until(() => green.systemState!.snapshot().revision === next, 1_000);
            expect(performance.now() - started).toBeLessThan(1_000);
            expect(green.systemState!.snapshot()).toMatchObject({ source: "database", mode: "restricted" });

            const lockStarted = performance.now();
            const lock = await post(blue, "/api/admin/system/lock", operator.cookie, {
                operationId: randomUUID(),
                baseRevision: next,
                lock: "map",
                locked: true,
                reason: "Umzug der Karte",
            });
            expect(lock.statusCode).toBe(200);
            await until(() => green.systemState!.snapshot().mapLock === true, 1_000);
            expect(performance.now() - lockStarted).toBeLessThan(1_000);
            expect(green.systemState!.snapshot()).toMatchObject({ revision: next + 1, systemLock: false });

            const third = new SystemStateStore({ database, tickMs: 60_000 });
            extraStores.push(third);
            await third.start();
            expect(third.snapshot()).toMatchObject({ mode: "restricted", mapLock: true, revision: next + 1 });
        });

        it("🔴 höchstens einmal je Kennung: Quittung, genau ein Protokolleintrag; dieselbe Kennung mit anderem Inhalt 409", async () => {
            const operator = await person("operator", "Rondrikan");
            const app = await build();
            const operationId = randomUUID();
            const body = { operationId, baseRevision: await revision(), mode: "restricted", reason: "Probe" };
            const first = await post(app, "/api/admin/system/mode", operator.cookie, body);
            expect(first.statusCode).toBe(200);
            expect(first.json()).toMatchObject({
                operationId,
                status: "applied",
                environment: "test",
                affected: [{ kind: "system_state", id: "1" }],
                warnings: [],
            });
            expect(first.headers["cache-control"]).toBe("no-store");
            const again = await post(app, "/api/admin/system/mode", operator.cookie, body);
            expect(again.statusCode).toBe(200);
            expect(again.json()).toEqual({ ...first.json(), status: "replayed" });
            const other = await post(app, "/api/admin/system/mode", operator.cookie, {
                ...body,
                reason: "Andere Probe",
            });
            expect([other.statusCode, other.json().error.code]).toEqual([409, "idempotency_key_reused"]);
            expect(await events(operationId)).toEqual([
                {
                    action: "system.mode_changed",
                    actor_person_id: operator.id,
                    target_ref: "system_state",
                    details: { from: "normal", to: "restricted", reason: "Probe" },
                },
            ]);
            const back = randomUUID();
            const normal = await post(app, "/api/admin/system/mode", operator.cookie, {
                operationId: back,
                baseRevision: await revision(),
                mode: "normal",
            });
            expect(normal.statusCode).toBe(200);
            expect((await events(back))[0]!.details).toEqual({ from: "restricted", to: "normal", reason: null });
        });

        it("🔴 Revisionskonflikt: 409 `edit_conflict` mit Revision und wer zuletzt schaltete; nichts geschaltet, kein Eintrag", async () => {
            const first = await person("operator", "Rondrikan");
            const second = await person("operator", "Hesindiane");
            const app = await build();
            const base = await revision();
            const lock = await post(app, "/api/admin/system/lock", first.cookie, {
                operationId: randomUUID(),
                baseRevision: base,
                lock: "system",
                locked: true,
                reason: "Rechte einfrieren",
            });
            expect(lock.statusCode).toBe(200);
            const operationId = randomUUID();
            const stale = await post(app, "/api/admin/system/lock", second.cookie, {
                operationId,
                baseRevision: base,
                lock: "map",
                locked: true,
                reason: "zu spät",
            });
            expect(stale.statusCode).toBe(409);
            expect(stale.json().error).toMatchObject({
                code: "edit_conflict",
                details: { currentRevision: base + 1, changedBy: { id: first.id, displayName: "Rondrikan" } },
            });
            expect(await events(operationId)).toEqual([]);
            expect(app.systemState!.snapshot()).toMatchObject({ mapLock: false, systemLock: true });
            const same = await post(app, "/api/admin/system/lock", second.cookie, {
                operationId: randomUUID(),
                baseRevision: base + 1,
                lock: "system",
                locked: true,
                reason: "doppelt",
            });
            expect([same.statusCode, same.json().error.code]).toEqual([409, "no_change"]);
        });

        it("🔴 Schutzregeln: wer einschränkt, kommt selbst hinein; jemand mit Zugangsrecht hat einen Passkey; sonst 409 und nichts geschaltet", async () => {
            const app = await build();
            // Ein Admin mit dem Sonderrecht zum Umschalten, aber ohne das Recht hineinzukommen: er sperrte sich selbst aus.
            const admin = await person("admin", "Alrik");
            await grant(admin.id, "manage_system_settings");
            const self = randomUUID();
            const refused = await post(app, "/api/admin/system/mode", admin.cookie, {
                operationId: self,
                baseRevision: await revision(),
                mode: "restricted",
                reason: "Probe",
            });
            expect([refused.statusCode, refused.json().error.code]).toEqual([409, "would_lock_out_self"]);
            expect(await events(self)).toEqual([]);
            // Mit dem Zugangsrecht geht es.
            await grant(admin.id, "access_restricted_mode");
            const granted = await fixture.session(admin.id, PASSKEY_FRESH);
            const ok = await post(app, "/api/admin/system/mode", granted.cookie, {
                operationId: randomUUID(),
                baseRevision: await revision(),
                mode: "restricted",
                reason: "Probe",
            });
            expect(ok.statusCode).toBe(200);
            expect(app.systemState!.snapshot().mode).toBe("restricted");
        });

        it("🔴 ohne Passkey bei irgendeinem Inhaber des Zugangsrechts: 409 `no_restricted_access_holder`", async (context) => {
            // Die Regel gilt für die ganze Umgebung: Ein Rest eines abgebrochenen Laufs mit Passkey machte sie unprüfbar. Dann sichtbar
            // übersprungen, nie still grün.
            if ((await restrictedAccessHolders(database, "test")).some((holder) => holder.hasPasskey)) {
                context.skip();
                return;
            }
            const app = await build();
            const operator = await person("operator", "Rondrikan", { passkey: false });
            const operationId = randomUUID();
            const response = await post(app, "/api/admin/system/mode", operator.cookie, {
                operationId,
                baseRevision: await revision(),
                mode: "restricted",
                reason: "Probe",
            });
            expect([response.statusCode, response.json().error.code]).toEqual([409, "no_restricted_access_holder"]);
            expect(await events(operationId)).toEqual([]);
            expect(app.systemState!.snapshot().mode).toBe("normal");
        });

        it("🔴 Stufe S: ohne frischen Passkey 403 `reauth_required`; ohne das Recht 403 `forbidden`; Grund Pflicht beim Einschränken und Sperren", async () => {
            const app = await build();
            const stale = await person("operator", "Rondrikan", { session: { passkeyMinutesAgo: 10 } });
            const body = {
                operationId: randomUUID(),
                baseRevision: await revision(),
                mode: "restricted",
                reason: "Probe",
            };
            const late = await post(app, "/api/admin/system/mode", stale.cookie, body);
            expect([late.statusCode, late.json().error.code, late.json().error.details]).toEqual([
                403,
                "reauth_required",
                { need: "passkey" },
            ]);
            const admin = await person("admin", "Alrik");
            const plain = await post(app, "/api/admin/system/lock", admin.cookie, {
                operationId: randomUUID(),
                baseRevision: await revision(),
                lock: "map",
                locked: true,
                reason: "Probe",
            });
            expect([plain.statusCode, plain.json().error.code]).toEqual([403, "forbidden"]);
            const operator = await person("operator", "Hesindiane");
            for (const [url, payload] of [
                ["/api/admin/system/mode", { mode: "restricted", reason: "   " }],
                ["/api/admin/system/lock", { lock: "map", locked: true }],
            ] as const) {
                const response = await post(app, url, operator.cookie, {
                    operationId: randomUUID(),
                    baseRevision: await revision(),
                    ...payload,
                });
                expect([url, response.statusCode, response.json().error.code]).toEqual([url, 400, "reason_required"]);
            }
            expect(app.systemState!.snapshot()).toMatchObject({ mode: "normal", mapLock: false });
        });

        it("GET /api/admin/system: eingestellt mit Person und Grund, wirksam auf dieser Instanz, die Inhaber des Zugangsrechts", async () => {
            const app = await build();
            const operator = await person("operator", "Rondrikan");
            const withoutKey = await person("operator", "Hesindiane", { passkey: false });
            const admin = await person("admin", "Alrik");
            await grant(admin.id, "access_restricted_mode");
            const without = await person("admin", "Ohne Sonderrecht");
            const switched = await post(app, "/api/admin/system/mode", operator.cookie, {
                operationId: randomUUID(),
                baseRevision: await revision(),
                mode: "restricted",
                reason: "Abnahme",
            });
            expect(switched.statusCode).toBe(200);
            const response = await app.inject({
                method: "GET",
                url: "/api/admin/system",
                headers: { cookie: operator.cookie },
            });
            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.configured).toMatchObject({
                mode: {
                    mode: "restricted",
                    by: { id: operator.id, displayName: "Rondrikan" },
                    byLabel: null,
                    reason: "Abnahme",
                },
                mapLock: { locked: false },
                systemLock: { locked: false },
                revision: await revision(),
            });
            expect(body.effective).toMatchObject({
                source: "database",
                mode: "restricted",
                revision: await revision(),
                ready: true,
            });
            // Der Kurzstatus (SYS-5): die eigene Bereitschaft, ohne Routenrechner im Test „ausgefallen“, die Warteschlange wie die
            // Datenbank sie zählt, Uhrzeiten des Servers.
            const [jobs] = await database<{ running: number; queued: number }[]>`
                SELECT count(*) FILTER (WHERE state = 'RUNNING')::int AS running,
                       count(*) FILTER (WHERE state = 'QUEUED')::int AS queued
                  FROM job
            `;
            expect(body.brief).toMatchObject({
                releaseId: "test",
                map: "ready",
                login: "ready",
                routing: "failed",
                queue: { running: jobs!.running, queued: jobs!.queued },
            });
            expect(Date.parse(body.brief.startedAt)).toBeLessThanOrEqual(Date.parse(body.brief.now));
            expect(Math.abs(Date.parse(body.brief.now) - Date.now())).toBeLessThan(5_000);
            const mine = new Set([operator.id, withoutKey.id, admin.id, without.id]);
            const holders = (body.restrictedAccessHolders as { person: { id: string }; hasPasskey: boolean }[]).filter(
                (holder) => mine.has(holder.person.id),
            );
            expect(holders).toEqual([
                { person: { id: admin.id, displayName: "Alrik" }, hasPasskey: true },
                { person: { id: withoutKey.id, displayName: "Hesindiane" }, hasPasskey: false },
                { person: { id: operator.id, displayName: "Rondrikan" }, hasPasskey: true },
            ]);
        });
    });

    describe("Fehlerrichtung und Wiederverbinden", () => {
        it("🔴 Datenbank weg: der Zustand gilt als unbekannt (nie Normal), Schreibwege 503 mit Retry-After; zurück: neu gelesen und neu gehört", async () => {
            const relay = await relayTo(testDatabaseUrl as string);
            const viaRelay = createDatabase(relay.url, { max: 2, connectTimeoutS: 2 });
            extraDatabases.push(viaRelay);
            const store = new SystemStateStore({ database: viaRelay, tickMs: 50 });
            const app = await build({ store });
            const operator = await person("operator", "Rondrikan");
            try {
                expect(store.snapshot()).toMatchObject({
                    source: "database",
                    mode: "normal",
                    listen: { generation: 1 },
                });
                await relay.cut();
                await until(() => store.snapshot().source === "unknown", 3_000);
                expect(store.snapshot()).toMatchObject({ mode: null, mapLock: null, systemLock: null, ready: false });
                const operationId = randomUUID();
                const refused = await post(app, "/api/admin/system/lock", operator.cookie, {
                    operationId,
                    baseRevision: await revision(),
                    lock: "map",
                    locked: true,
                    reason: "Probe",
                });
                expect([refused.statusCode, refused.json().error.code, refused.headers["retry-after"]]).toEqual([
                    503,
                    "system_state_unknown",
                    "5",
                ]);
                expect(await events(operationId)).toEqual([]);
                // Während die Instanz blind ist, schaltet eine andere (hier direkt): Nach der Rückkehr muss sie es wissen.
                await database`UPDATE system_state SET system_lock = true, system_lock_since = now(), system_lock_reason = 'woanders' WHERE id = 1`;
                const changed = await revision();
                await relay.restore();
                await until(
                    () => store.snapshot().revision === changed && store.snapshot().listen.generation >= 2,
                    5_000,
                );
                expect(store.snapshot()).toMatchObject({
                    source: "database",
                    systemLock: true,
                    listen: { connected: true },
                });
                // Das neue Abonnement trägt: Eine Änderung kommt wieder über den Weckruf an.
                await database`UPDATE system_state SET system_lock = false WHERE id = 1`;
                await until(() => store.snapshot().systemLock === false, 1_000);
            } finally {
                await relay.close();
            }
        });

        it("🔴 bricht nur die LISTEN-Verbindung ab, liest die Instanz nach dem Wiederverbinden neu (ohne Takt)", async () => {
            const own = createDatabase(testDatabaseUrl as string, { max: 2 });
            const store = new SystemStateStore({ database: own, tickMs: 60_000 });
            await build({ database: own, store });
            const startedAt = new Date(Date.now() - 1_000);
            // Die LISTEN-Verbindung erkennt man an einem LISTEN als letzter Abfrage. Alle Abonnements einer Datenbank teilen sich diese eine
            // Verbindung; seit Fastify dort auch das Lebenszeichen des Jobs-Workers abonniert (dd05ee3e), kann ihr letztes LISTEN einem
            // anderen Kanal gelten. Gesucht wird deshalb jedes LISTEN der eben gebauten Instanz.
            const terminated = await database<{ ok: boolean }[]>`
                SELECT pg_terminate_backend(pid) AS ok FROM pg_stat_activity
                 WHERE datname = current_database() AND query ILIKE 'listen%' AND backend_start >= ${startedAt}
                   AND pid <> pg_backend_pid()
            `;
            expect(terminated.length).toBeGreaterThan(0);
            await database`UPDATE system_state SET map_lock = true, map_lock_since = now(), map_lock_reason = 'während' WHERE id = 1`;
            const changed = await revision();
            await until(() => store.snapshot().listen.generation >= 2, 5_000);
            await until(() => store.snapshot().revision === changed, 1_000);
            expect(store.snapshot()).toMatchObject({ mapLock: true, listen: { connected: true } });
            expect(store.snapshot().listen.lastResyncAt).not.toBeNull();
        });
    });

    describe("/health/mode", () => {
        it("🔴 über die Schleife: wirksam und eingestellt, Stand von LISTEN; von außen oder über einen Proxy 404", async () => {
            const app = await build();
            const response = await app.inject({ method: "GET", url: "/health/mode" });
            expect(response.statusCode).toBe(200);
            expect(response.headers["cache-control"]).toBe("no-store");
            const current = await revision();
            const inhalt = await contentRevision();
            expect(response.json()).toMatchObject({
                releaseId: "test",
                source: "database",
                mode: "normal",
                mapLock: false,
                systemLock: false,
                revision: current,
                contentRevision: inhalt,
                ready: true,
                listen: { connected: true, generation: 1 },
                configured: {
                    mode: "normal",
                    mapLock: false,
                    systemLock: false,
                    revision: current,
                    contentRevision: inhalt,
                },
            });
            const outside = await app.inject({ method: "GET", url: "/health/mode", remoteAddress: "203.0.113.7" });
            expect(outside.statusCode).toBe(404);
            const proxied = await app.inject({
                method: "GET",
                url: "/health/mode",
                headers: { "x-forwarded-for": "203.0.113.7" },
            });
            expect(proxied.statusCode).toBe(404);
            const ipv6 = await app.inject({ method: "GET", url: "/health/mode", remoteAddress: "::1" });
            expect(ipv6.statusCode).toBe(200);
        });

        it("🔴 ohne Datenbank: unbekannt, nichts geraten, eingestellt null, nicht bereit", async () => {
            const dead = createDatabase("postgres://nobody@127.0.0.1:1/none", { max: 1 });
            const app = buildApp({ config, database: dead, logStream: SILENT });
            apps.push(app);
            await app.ready();
            const response = await app.inject({ method: "GET", url: "/health/mode" });
            expect(response.statusCode).toBe(200);
            expect(response.json()).toMatchObject({
                source: "unknown",
                mode: null,
                mapLock: null,
                systemLock: null,
                revision: null,
                ready: false,
                listen: { connected: false },
                configured: null,
            });
        });
    });
});
