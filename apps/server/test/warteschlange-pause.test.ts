import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Role } from "@avesmaps3d/shared";
import { readAbgleiche } from "../src/abgleiche/lesen.ts";
import { buildApp } from "../src/app.ts";
import { runAuthCli } from "../src/auth/cli-commands.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { buildJobsOverview } from "../src/jobs/overview.ts";
import { leseWarteumstand } from "../src/jobs/wartegrund.ts";
import { readQueuePause } from "../src/jobs/warteschlange-pause.ts";
import { readStateRow, stateView } from "../src/system/state-row.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type SessionOptions } from "./support/auth-fixture.ts";
import { testJobsConfig, uniqueScope } from "./support/jobs-support.ts";

/**
 * Die Warteschlange pausieren und fortsetzen (WI-0160, Migration 0130) gegen echtes PostgreSQL. Auftrag: Claudios Entwurf §5 im
 * Handover `2026-10-15-antwort-stage-landschaften-gelaendekette-an-claudia.md`, Betreiberwunsch 2026-10-15.
 *
 * **Problemfall.** In Production arbeitet kein Worker; Claudios Abholer übernimmt jede Minute über `job_sync_claim`. Es gab keinen
 * Weg, das anzuhalten, und keine wartende Zeile sagte, worauf sie wartet — „ganz besonders ärgerlich ist, dass in der warteschlange
 * bei production nicht abgearbeitet wird, obwohl da neue aufträge drin stehen“ (Betreiber, wörtlich).
 *
 * **Soll**, je Fall mit Namen:
 *
 * 1. Pausiert gibt `job_sync_claim` nichts heraus — und schreibt dabei nichts: kein `started_at`, kein `attempt`, kein Ereignis.
 * 2. Ein laufender Job läuft zu Ende: `job_sync_phase` und `job_sync_finish` wirken weiter, `job_sync_discard` auch.
 * 3. Fortsetzen holt wieder ab.
 * 4. (Der Worker holte in der Pause keinen neuen Job: Das hält seit WI-0163 der Dirigent und wird dort geprüft.)
 * 5. Ohne Recht, ohne frischen Passkey, mit veralteter Revision, ohne Grund oder ohne Änderung wird die Route abgewiesen.
 * 6. Die Warteschlange zeigt Zustand und Grund: Übersicht, Abgleiche-Zeile, der eingestellte Stand der Verwaltung.
 *
 * 🪤 Die Rechte an `job_sync_claim` (nur die Jobs-Rolle) prüft `abgleiche-korridor.test.ts` auf einem Wegwerf-Cluster wie der VPS;
 * hier läuft alles unter dem Besitzer, geprüft wird die WIRKUNG der Pause.
 *
 * Der Test hinterlässt die Warteschlange laufend (`resetPause`).
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const PASSKEY_FRESH: SessionOptions = { passkeyMinutesAgo: 1 };
const SILENT = { write: () => undefined };
const DOMAIN = "aventuria";
const PERSON = "7e570000-0000-4000-8000-00000000016a";

const config: ServerConfig = {
    port: 0,
    host: "127.0.0.1",
    releaseId: "test",
    databaseUrl: undefined,
    tileRoot: undefined,
    auth: TEST_AUTH,
};

describeWithDatabase("Warteschlange pausieren und fortsetzen (Migration 0130)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: ReturnType<typeof authFixture>;
    const apps: FastifyInstance[] = [];
    const appDatabases: Database[] = [];

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 6 });
        await migrate(database);
        await seedMapDomains(database);
        fixture = authFixture(database);
    });

    afterAll(async () => {
        await database.end({ timeout: 5 });
    });

    beforeEach(async () => {
        await database`DELETE FROM job_event`;
        await database`DELETE FROM job`;
        await resetPause();
    });

    afterEach(async () => {
        for (const app of apps.splice(0)) await app.close();
        for (const own of appDatabases.splice(0)) await own.end({ timeout: 5 }).catch(() => undefined);
        await fixture.cleanup();
        await resetPause();
    });

    /** Läuft, ohne Spur: so beginnt und endet jeder Fall. */
    async function resetPause(): Promise<void> {
        await database`
            UPDATE system_state
               SET queue_paused = false, queue_paused_since = NULL, queue_paused_by = NULL,
                   queue_paused_by_label = NULL, queue_paused_reason = NULL
             WHERE id = 1
        `;
    }

    /** Pausiert direkt in der Zeile (die Route prüft Fall 5 eigens). */
    async function pause(reason = "Datenbank wird gesichert", label = "cli:test"): Promise<void> {
        await database`
            UPDATE system_state
               SET queue_paused = true, queue_paused_since = now(), queue_paused_by_label = ${label},
                   queue_paused_reason = ${reason}
             WHERE id = 1
        `;
    }

    const enqueue = async (kind: string): Promise<string> => {
        const [row] = await database<{ public_id: string }[]>`
            SELECT public_id::text AS public_id FROM job_enqueue(${kind}, 1::smallint, ${DOMAIN}, ${PERSON}, '{}'::jsonb)
        `;
        return row!.public_id;
    };
    const claim = async (kind: string): Promise<string | null> => {
        const [row] = await database<{ id: string | null }[]>`SELECT job_sync_claim(${kind}, 600)::text AS id`;
        return row!.id;
    };
    const phase = async (id: string, name: string): Promise<boolean> => {
        const [row] = await database<{ ok: boolean }[]>`SELECT job_sync_phase(${id}::uuid, ${name}, 'Satz') AS ok`;
        return row!.ok;
    };
    const finish = async (id: string, result: string, summary: string): Promise<boolean> => {
        const [row] = await database<
            { ok: boolean }[]
        >`SELECT job_sync_finish(${id}::uuid, ${result}, ${summary}) AS ok`;
        return row!.ok;
    };
    const discard = async (kind: string, reason: string): Promise<number> => {
        const [row] = await database<{ n: number }[]>`SELECT job_sync_discard(${kind}, ${reason})::int AS n`;
        return row!.n;
    };
    const jobRow = async (id: string) =>
        (
            await database<
                { state: string; started_at: Date | null; attempt: number; wait_reason: string | null }[]
            >`SELECT state, started_at, attempt::int AS attempt, wait_reason FROM job WHERE public_id = ${id}::uuid`
        )[0]!;
    const startEvents = async (id: string): Promise<number> => {
        const [row] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM job_event e JOIN job j ON j.id = e.job_id
             WHERE j.public_id = ${id}::uuid AND e.kind = 'job.started'
        `;
        return row!.n;
    };

    // --- 1 bis 3: der Claim, der laufende Job, das Fortsetzen -------------------------------------------------------

    it("🔴 pausiert gibt der Claim nichts heraus — und schreibt nichts", async () => {
        const id = await enqueue("legacy_pull");
        await pause();
        expect(await claim("legacy_pull")).toBeNull();
        expect(await jobRow(id)).toMatchObject({ state: "QUEUED", started_at: null, attempt: 0 });
        expect(await startEvents(id)).toBe(0);
        // 🪤 Auch eine falsche Art bekommt in der Pause ihren Fehler, statt still NULL zu lesen: Ein Aufruffehler bleibt sichtbar.
        await expect(database`SELECT job_sync_claim('import', 600)`).rejects.toMatchObject({ code: "22023" });
        await expect(database`SELECT job_sync_claim('legacy_pull', 5)`).rejects.toMatchObject({ code: "22023" });
    });

    it("🔴 ein laufender Job läuft zu Ende; verwerfen geht in der Pause auch", async () => {
        const laufend = await enqueue("legacy_pull");
        expect(await claim("legacy_pull")).toBe(laufend);
        const wartend = await enqueue("production_pull");
        await pause();
        // Der übernommene Auftrag kommt zum Abschluss: nichts bricht ab, nichts geht in die Queue zurück.
        expect(await phase(laufend, "einspielen")).toBe(true);
        expect(await finish(laufend, "ok", "Zug fertig")).toBe(true);
        expect(await jobRow(laufend)).toMatchObject({ state: "SUCCEEDED" });
        // Verwerfen ist kein Abarbeiten: In der Pause will man gerade aufräumen können.
        expect(await discard("production_pull", "durch Wahl 18 überholt")).toBe(1);
        expect(await jobRow(wartend)).toMatchObject({ state: "CANCELLED" });
    });

    it("🔴 Fortsetzen holt wieder ab", async () => {
        const id = await enqueue("legacy_pull");
        await pause();
        expect(await claim("legacy_pull")).toBeNull();
        await resetPause();
        expect(await claim("legacy_pull")).toBe(id);
        expect(await jobRow(id)).toMatchObject({ state: "RUNNING", attempt: 1 });
    });

    it("die Pause steht mit Zeitpunkt, Person und Grund in der Zeile; `readQueuePause` liest sie", async () => {
        expect(await readQueuePause(database)).toMatchObject({ paused: false, reason: null });
        await pause("Datenbank wird gesichert", "cli:claudio");
        const gelesen = await readQueuePause(database);
        expect(gelesen).toMatchObject({ paused: true, byLabel: "cli:claudio", reason: "Datenbank wird gesichert" });
        expect(gelesen.since).toBeInstanceOf(Date);
    });

    // --- 5: die Route -----------------------------------------------------------------------------------------------

    async function build(): Promise<FastifyInstance> {
        // 🪤 Eine eigene Verbindung je App: `app.close()` beendet sie, und die geteilte Verbindung dieses Tests darf nicht mitgehen.
        const own = createDatabase(testDatabaseUrl as string, { max: 4 });
        appDatabases.push(own);
        const app = buildApp({ config, database: own, logStream: SILENT });
        apps.push(app);
        await app.ready();
        return app;
    }

    async function person(role: Role, name: string, session: SessionOptions = PASSKEY_FRESH) {
        const created = await fixture.person(role, { name });
        await database`
            INSERT INTO avesmaps_auth.passkey_credential (person_id, environment, rp_id, credential_id, public_key, created_via)
            VALUES (${created.id}, 'test', 'avesmaps.test', ${randomBytes(16).toString("hex")}, ${randomBytes(8)}, 'passkey')
        `;
        const { cookie } = await fixture.session(created.id, session);
        return { ...created, cookie };
    }

    const revision = async (): Promise<number> => {
        const [row] = await database<
            { revision: number }[]
        >`SELECT revision::int AS revision FROM system_state WHERE id = 1`;
        return row!.revision;
    };
    const post = (app: FastifyInstance, cookie: string, payload: object) =>
        app.inject({
            method: "POST",
            url: "/api/admin/system/queue",
            payload,
            headers: { origin: TEST_ORIGIN, cookie },
        });

    it("🔴 ohne Recht oder ohne frischen Passkey wird abgewiesen; nichts geschaltet", async () => {
        const app = await build();
        const editor = await person("editor", "Travia");
        const ohneFrisch = await person("operator", "Rondrikan", { passkeyMinutesAgo: 90 });
        const base = await revision();
        const ohneRecht = await post(app, editor.cookie, {
            operationId: randomUUID(),
            baseRevision: base,
            paused: true,
            reason: "Test",
        });
        expect(ohneRecht.statusCode).toBe(403);
        const alt = await post(app, ohneFrisch.cookie, {
            operationId: randomUUID(),
            baseRevision: base,
            paused: true,
            reason: "Test",
        });
        expect([alt.statusCode, alt.json().error.code]).toEqual([403, "reauth_required"]);
        expect(await readQueuePause(database)).toMatchObject({ paused: false });
    });

    it("🔴 pausieren braucht einen Grund; dieselbe Stellung und eine veraltete Revision werden abgewiesen", async () => {
        const app = await build();
        const betreiber = await person("operator", "Rondrikan");
        const base = await revision();
        const ohneGrund = await post(app, betreiber.cookie, {
            operationId: randomUUID(),
            baseRevision: base,
            paused: true,
        });
        expect([ohneGrund.statusCode, ohneGrund.json().error.code]).toEqual([400, "reason_required"]);
        // Fortsetzen braucht keinen, und die Warteschlange läuft schon: 409 `no_change`.
        const schonSo = await post(app, betreiber.cookie, {
            operationId: randomUUID(),
            baseRevision: base,
            paused: false,
        });
        expect([schonSo.statusCode, schonSo.json().error.code]).toEqual([409, "no_change"]);

        const ok = await post(app, betreiber.cookie, {
            operationId: randomUUID(),
            baseRevision: base,
            paused: true,
            reason: "Datenbank wird gesichert",
        });
        expect(ok.statusCode).toBe(200);
        const veraltet = await post(app, betreiber.cookie, {
            operationId: randomUUID(),
            baseRevision: base,
            paused: false,
        });
        expect([veraltet.statusCode, veraltet.json().error.code]).toEqual([409, "edit_conflict"]);
    });

    it("🔴 die Route pausiert mit Person und Grund und schreibt genau ein Protokollereignis", async () => {
        const app = await build();
        const betreiber = await person("operator", "Rondrikan");
        const operationId = randomUUID();
        const antwort = await post(app, betreiber.cookie, {
            operationId,
            baseRevision: await revision(),
            paused: true,
            reason: "Datenbank wird gesichert",
        });
        expect(antwort.statusCode).toBe(200);
        const gelesen = await readQueuePause(database);
        expect(gelesen).toMatchObject({
            paused: true,
            by: betreiber.id,
            byLabel: null,
            reason: "Datenbank wird gesichert",
        });

        const eintraege = await database<{ action: string; details: Record<string, unknown> }[]>`
            SELECT action, details FROM avesmaps_auth.security_event WHERE operation_id = ${operationId}
        `;
        expect(eintraege).toHaveLength(1);
        expect(eintraege[0]).toMatchObject({
            action: "system.queue_changed",
            details: { from: false, to: true, reason: "Datenbank wird gesichert" },
        });
        // Und der Claim schweigt sofort danach.
        await enqueue("legacy_pull");
        expect(await claim("legacy_pull")).toBeNull();
    });

    // --- 5b: der Rückweg ohne Verwaltung ----------------------------------------------------------------------------

    it("🔴 der Rückweg ohne Verwaltung: `warteschlange-fort` wirft sie wieder an, ohne Sitzung", async () => {
        const out: string[] = [];
        const err: string[] = [];
        const cli = (...argv: string[]) =>
            runAuthCli(
                argv,
                { AVESMAPS_ENV: "test" },
                { out: (line) => void out.push(line), err: (line) => void err.push(line) },
                { database, systemUser: "wi0160-test" },
            );
        const id = await enqueue("legacy_pull");
        expect(await cli("warteschlange-pausieren", "--grund", "Datenbank wird gesichert")).toBe(0);
        expect(await readQueuePause(database)).toMatchObject({
            paused: true,
            byLabel: "cli:wi0160-test",
            reason: "Datenbank wird gesichert",
        });
        expect(await claim("legacy_pull")).toBeNull();
        // Ohne Grund wird nicht pausiert (Aufruffehler, Exit 2), und ein zweites Pausieren ändert nichts.
        expect(await cli("warteschlange-pausieren")).toBe(2);
        expect(await cli("warteschlange-pausieren", "--grund", "noch mal")).toBe(0);
        expect(out.some((zeile) => zeile.includes("ist schon pausiert"))).toBe(true);

        expect(await cli("warteschlange-fort")).toBe(0);
        expect(await readQueuePause(database)).toMatchObject({ paused: false });
        expect(await claim("legacy_pull")).toBe(id);
        // `betrieb-zeigen` nennt die Warteschlange mit: Claudio sieht beim Nachsehen, ob sie pausiert ist. Wer zuletzt geschaltet
        // hat, steht dahinter — wie bei einer gelösten Sperre.
        out.length = 0;
        expect(await cli("betrieb-zeigen")).toBe(0);
        expect(out.some((zeile) => /^Warteschlange: läuft( · .+)?$/u.test(zeile))).toBe(true);
        await pause("Noch einmal", "cli:claudio");
        out.length = 0;
        expect(await cli("betrieb-zeigen")).toBe(0);
        expect(
            out.some((zeile) => /^Warteschlange: pausiert · seit .+ · cli:claudio · Grund: Noch einmal$/u.test(zeile)),
        ).toBe(true);
    });

    // --- 6: die Anzeige ---------------------------------------------------------------------------------------------

    it("🔴 die Warteschlange zeigt Zustand und Grund: Übersicht, Abgleiche-Zeile, eingestellter Stand", async () => {
        const id = await enqueue("legacy_pull");
        await pause("Datenbank wird gesichert", "cli:claudio");

        const uebersicht = await buildJobsOverview({
            database,
            config: testJobsConfig(),
            releaseId: "test",
            mapDomainId: DOMAIN,
            plannerScope: uniqueScope("pause-overview"),
            pickupKinds: new Set(["legacy_pull"]),
        });
        expect(uebersicht.queuePause).toMatchObject({
            paused: true,
            by: "cli:claudio",
            reason: "Datenbank wird gesichert",
        });
        expect(uebersicht.queued.find((zeile) => zeile.id === id)?.waitReason).toBe("waits_queue_paused");

        // Die Zeile unter „Abgleiche“ (das, was der Betreiber in Production sieht) nennt denselben Grund.
        const umstand = await leseWarteumstand(database, {
            plannerActive: false,
            pickupKinds: new Set(["legacy_pull"]),
        });
        const zeilen = await readAbgleiche(database, { legacy: "korridor" }, umstand);
        expect(zeilen.find((zeile) => zeile.quelle === "legacy")?.laufend).toMatchObject({
            state: "QUEUED",
            waitReason: "waits_queue_paused",
        });

        // Der eingestellte Stand der Verwaltung trägt die Pause wie eine Sperre.
        const row = await readStateRow(database);
        const view = await stateView(database, row!);
        expect(view.queuePause).toMatchObject({
            paused: true,
            byLabel: "cli:claudio",
            reason: "Datenbank wird gesichert",
        });
        expect(view.queuePause.since).not.toBeNull();
    });

    it("ohne Pause steht in der Abgleiche-Zeile der Grund der Umgebung, nicht mehr nichts", async () => {
        await enqueue("legacy_pull");
        // Production: kein Planer, aber Claudios Abholer holt die Art ab.
        const production = await leseWarteumstand(database, {
            plannerActive: false,
            pickupKinds: new Set(["legacy_pull"]),
        });
        expect(
            (await readAbgleiche(database, { legacy: "korridor" }, production)).find(
                (zeile) => zeile.quelle === "legacy",
            )?.laufend?.waitReason,
        ).toBe("waits_pickup");
        // Eine Umgebung ohne Worker und ohne Abholer sagt genau das, statt stumm zu warten.
        const niemand = await leseWarteumstand(database, { plannerActive: false, pickupKinds: new Set() });
        expect(
            (await readAbgleiche(database, { legacy: "aus" }, niemand)).find((zeile) => zeile.quelle === "legacy")
                ?.laufend?.waitReason,
        ).toBe("waits_no_worker");
    });
});
