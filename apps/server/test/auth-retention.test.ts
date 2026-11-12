import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccessLink } from "../src/auth/access-links.ts";
import { AUTH_RETENTION_KIND, authRetentionReady, purgeExpiredAuth } from "../src/auth/retention.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { JobWorker } from "../src/jobs/worker.ts";
import { authFixture } from "./support/auth-fixture.ts";
import { fakeMemory, fakeSpawner, testJobsConfig, uniqueScope } from "./support/jobs-support.ts";

/** Die Pflege eines Ausführers (`auftrag-cli --pflege`), mit oder ohne Abstand der Aufbewahrung. */
function pflegeWorker(database: Database, release: string, authRetentionEveryMs?: number): JobWorker {
    return new JobWorker({
        database,
        config: testJobsConfig(),
        mapDomainId: "aventuria",
        release,
        deriveScope: uniqueScope("derive"),
        spawnChild: fakeSpawner().spawn,
        memory: fakeMemory().probe,
        ...(authRetentionEveryMs === undefined ? {} : { authRetentionEveryMs }),
    });
}

/**
 * Die Aufbewahrung der Anmeldedaten (WI-0120 A12, AUTH-0001 §5): Anmeldungen 90 Tage, Verwaltungshandlungen dauerhaft, die
 * gekürzte IP 14 Tage, Abgelaufenes 30 Tage nach seinem Ende. Alte Zeilen werden zurückdatiert angelegt und müssen gehen;
 * frische und Verwaltungshandlungen bleiben. Gelöscht wird nur in `avesmaps_auth.purge_expired()` (Migration 0082); welche Rolle sie
 * rufen darf, prüft `auth-schema.test.ts`.
 */
const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Aufbewahrung der Anmeldedaten", { timeout: 60_000 }, () => {
    let database: Database;
    let fixture: ReturnType<typeof authFixture>;
    const release = `a12-aufbewahrung-${randomUUID()}`;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await seedMapDomains(database);
        fixture = authFixture(database);
    });

    afterAll(async () => {
        await database`DELETE FROM job WHERE release = ${release}`;
        await fixture.cleanup();
        await database.end({ timeout: 5 });
    });

    const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

    async function event(personId: string, action: string, at: Date, operationId: string | null = null) {
        const [row] = await database<{ id: string }[]>`
            INSERT INTO avesmaps_auth.security_event (at, environment, actor_kind, actor_person_id, action, target_person_id, operation_id, ip_prefix)
            VALUES (${at}, 'test', 'person', ${personId}, ${action}, ${personId}, ${operationId}, '192.0.2.0')
            RETURNING id::text AS id
        `;
        return row!.id;
    }

    it("🔴 alte Anmeldungen, IP-Präfixe und Abgelaufenes gehen; Verwaltungshandlungen und Frisches bleiben", async () => {
        const person = await fixture.person("editor", { name: "A12-Aufbewahrung" });
        const oldLogin = await event(person.id, "login.success", daysAgo(91));
        const oldFailure = await event(person.id, "login.failure", daysAgo(120));
        const recentLogin = await event(person.id, "login.success", daysAgo(20));
        const oldAdmin = await event(person.id, "person.locked", daysAgo(400), randomUUID());

        const expired = await fixture.session(person.id);
        const live = await fixture.session(person.id);
        await database`
            UPDATE avesmaps_auth.session SET expires_at = ${daysAgo(31)}, idle_expires_at = ${daysAgo(31)}, ip_prefix = '192.0.2.0'
             WHERE id = ${expired.id}
        `;
        await database`UPDATE avesmaps_auth.session SET ip_prefix = '192.0.2.0', created_at = ${daysAgo(15)} WHERE id = ${live.id}`;
        const link = await createAccessLink(database, {
            kind: "password_reset",
            personId: person.id,
            createdByCli: "a12",
        });
        await database`UPDATE avesmaps_auth.access_link SET expires_at = ${daysAgo(31)} WHERE id = ${link.id}`;
        const throttle = Buffer.alloc(32, 7);
        await database`
            INSERT INTO avesmaps_auth.login_throttle (key_hash, kind, failures, updated_at) VALUES (${throttle}, 'name', 3, ${daysAgo(40)})
        `;

        const result = await purgeExpiredAuth(database);
        expect(result.events).toBeGreaterThanOrEqual(2);

        const events = await database<{ id: string; ip: string | null }[]>`
            SELECT id::text AS id, ip_prefix AS ip FROM avesmaps_auth.security_event
             WHERE id = ANY(${[oldLogin, oldFailure, recentLogin, oldAdmin]}::bigint[])
        `;
        const left = new Map(events.map((row) => [row.id, row.ip]));
        expect(left.has(oldLogin)).toBe(false);
        expect(left.has(oldFailure)).toBe(false);
        expect(left.get(recentLogin)).toBeNull();
        expect(left.has(oldAdmin)).toBe(true);
        expect(left.get(oldAdmin)).toBeNull();

        const sessions = await database<{ id: string; ip: string | null }[]>`
            SELECT id, ip_prefix AS ip FROM avesmaps_auth.session WHERE id = ANY(${[expired.id, live.id]}::uuid[])
        `;
        expect(sessions.map((row) => row.id)).toEqual([live.id]);
        expect(sessions[0]?.ip).toBeNull();
        expect(await database`SELECT 1 FROM avesmaps_auth.access_link WHERE id = ${link.id}`).toHaveLength(0);
        expect(await database`SELECT 1 FROM avesmaps_auth.login_throttle WHERE key_hash = ${throttle}`).toHaveLength(0);
    });

    const retentionJobs = (forRelease: string) =>
        database<
            { state: string; origin: string; result: Record<string, number> | null; error_code: string | null }[]
        >`SELECT state, origin, result, error_code FROM job WHERE kind = ${AUTH_RETENTION_KIND} AND release = ${forRelease} ORDER BY id`;

    it("🔴 die Pflege ruft sie als aufgezeichneten Job `auth_retention`: einmal je Abstand, mit Ergebnis auf der Statusseite", async () => {
        expect(await authRetentionReady(database)).toBe(true);
        // Fällig ist sie nach der Tafel: Ein Lauf aus einem früheren Test zählt mit, also beginnt der Fall ohne.
        await database`DELETE FROM job WHERE kind = ${AUTH_RETENTION_KIND}`;
        expect(await pflegeWorker(database, release, 3_600_000).pflege()).toMatchObject({ authRetention: true });
        // 🔴 Ein zweiter Ausführer (ein neuer Prozess, nichts im Speicher) liest den letzten Lauf aus der Tafel: noch nicht fällig.
        expect(await pflegeWorker(database, release, 3_600_000).pflege()).toMatchObject({ authRetention: false });
        const jobs = await retentionJobs(release);
        expect(jobs).toHaveLength(1);
        expect(jobs[0]).toMatchObject({ state: "SUCCEEDED", origin: "recorded", error_code: null });
        expect(Object.keys(jobs[0]!.result ?? {}).sort()).toEqual([
            "challenges",
            "events",
            "flows",
            "ipPrefixes",
            "links",
            "sessions",
            "throttles",
        ]);

        // Liegt der letzte Lauf länger zurück als der Abstand, läuft sie wieder.
        await database`
            UPDATE job SET started_at = now() - interval '2 hours', queued_at = now() - interval '2 hours'
             WHERE kind = ${AUTH_RETENTION_KIND} AND release = ${release}
        `;
        expect(await pflegeWorker(database, release, 3_600_000).pflege()).toMatchObject({ authRetention: true });
        expect(await retentionJobs(release)).toHaveLength(2);
    });

    it("ohne Abstand läuft sie gar nicht: Eine Pflege ohne `authRetentionEveryMs` legt keinen Job an", async () => {
        const quiet = `${release}-ohne`;
        await database`DELETE FROM job WHERE kind = ${AUTH_RETENTION_KIND}`;
        expect(await pflegeWorker(database, quiet).pflege()).toMatchObject({ authRetention: false });
        expect(await database`SELECT 1 FROM job WHERE release = ${quiet}`).toHaveLength(0);
    });
});
