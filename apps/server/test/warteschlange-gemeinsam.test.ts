import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AdminSystemOverview, Role, WarteschlangePause } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { runAuthCli } from "../src/auth/cli-commands.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { buildJobsOverview } from "../src/jobs/overview.ts";
import { createWarteschlangeStandLeser, standJetzt } from "../src/jobs/stand-datei.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type SessionOptions } from "./support/auth-fixture.ts";
import { testJobsConfig, uniqueScope } from "./support/jobs-support.ts";
import { auftrag, stand, standOrdner } from "./support/warteschlange-stand.ts";

/**
 * Ein Play/Pause für Stage und Production (WI-0163 §1.6, §1.7, Migration 0133) gegen echtes PostgreSQL.
 *
 * **Problemfall.** Jede Umgebung hat ihre eigene Zeile `system_state`; der Betreiber will trotzdem EINEN Schalter: „die queuere dann
 * auf "play" und "pausieren", falls irngedwas is“. Ohne gemeinsame Semantik sagte die Route „steht schon so“, obwohl die Stage
 * pausiert hat und hier nur die eigene Zeile läuft — und der Knopf täte nichts.
 *
 * **Soll**, je Fall mit Namen:
 *
 * 1. Die Route vergleicht den Wunsch mit der WIRKSAMEN Pause aus dem frischen Stand: 409 `no_change` nur, wenn er schon wirkt.
 * 2. Sie schreibt die eigene Zeile (neue Revision, `queue_changed_at`), auch wenn diese den Wunschwert schon trug.
 * 3. Ohne frischen Stand vergleicht sie mit der eigenen Zeile wie bis WI-0163.
 * 4. Die Kommandozeile tut dasselbe, mit genau einem Protokolleintrag.
 * 5. Verwaltung und Übersicht zeigen die gemeinsame Reihe: eigene Aufträge mit Platz und Grund aus dem Stand, die der anderen
 *    Umgebung ohne Person und ohne Kennung, die Pause der Stage mit ihrem Ort statt einer Person.
 *
 * Der Test hinterlässt die Warteschlange laufend und ohne Anweisung (`zuruecksetzen`).
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const PASSKEY_FRESH: SessionOptions = { passkeyMinutesAgo: 1 };
const SILENT = { write: () => undefined };
const DOMAIN = "aventuria";
const PERSON = "7e570000-0000-4000-8000-00000000163a";
const STAGE_PERSON = "7e570000-0000-4000-8000-00000000163b";

/** Die Pause, wie der Dirigent sie aus einer Anweisung der Stage vor `minuten` Minuten wirksam gemacht hätte. */
function stagePause(minuten: number, paused = true): WarteschlangePause {
    const at = new Date(Date.now() - minuten * 60_000).toISOString();
    return {
        paused,
        umgebung: "staging",
        changedAt: at,
        since: paused ? at : null,
        by: STAGE_PERSON,
        byLabel: null,
        reason: paused ? "Sicherung der Stage" : null,
    };
}

describeWithDatabase("Eine Pause für alle Umgebungen (WI-0163, Migration 0133)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: ReturnType<typeof authFixture>;
    let ordner: Awaited<ReturnType<typeof standOrdner>>;
    const apps: FastifyInstance[] = [];
    const appDatabases: Database[] = [];

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 6 });
        await migrate(database);
        await seedMapDomains(database);
        fixture = authFixture(database);
        ordner = await standOrdner();
    });

    afterAll(async () => {
        await ordner.weg();
        await database.end({ timeout: 5 });
    });

    beforeEach(async () => {
        await database`DELETE FROM job_event`;
        await database`DELETE FROM job`;
        await zuruecksetzen();
    });

    afterEach(async () => {
        for (const app of apps.splice(0)) await app.close();
        for (const own of appDatabases.splice(0)) await own.end({ timeout: 5 }).catch(() => undefined);
        await fixture.cleanup();
        await zuruecksetzen();
    });

    /** Läuft, ohne Spur und ohne Anweisung: so beginnt und endet jeder Fall. */
    async function zuruecksetzen(): Promise<void> {
        await database`
            UPDATE system_state
               SET queue_paused = false, queue_paused_since = NULL, queue_paused_by = NULL,
                   queue_paused_by_label = NULL, queue_paused_reason = NULL, queue_changed_at = NULL
             WHERE id = 1
        `;
    }

    const zeile = async () =>
        (
            await database<{ paused: boolean; revision: number; changed_at: Date | null }[]>`
                SELECT queue_paused AS paused, revision::int AS revision, queue_changed_at AS changed_at
                  FROM system_state WHERE id = 1
            `
        )[0]!;

    async function build(): Promise<FastifyInstance> {
        const own = createDatabase(testDatabaseUrl as string, { max: 4 });
        appDatabases.push(own);
        const config: ServerConfig = {
            port: 0,
            host: "127.0.0.1",
            releaseId: "test",
            databaseUrl: undefined,
            tileRoot: undefined,
            auth: TEST_AUTH,
            warteschlange: { standFile: ordner.datei, umgebung: "test" },
        };
        // Ohne Zwischenspeicher: Jeder Fall schreibt seinen eigenen Stand.
        const app = buildApp({
            config,
            database: own,
            logStream: SILENT,
            warteschlangeStand: createWarteschlangeStandLeser(ordner.datei, "test", { ttlMs: 0 }),
        });
        apps.push(app);
        await app.ready();
        return app;
    }

    async function person(role: Role, name: string) {
        const created = await fixture.person(role, { name });
        await database`
            INSERT INTO avesmaps_auth.passkey_credential (person_id, environment, rp_id, credential_id, public_key, created_via)
            VALUES (${created.id}, 'test', 'avesmaps.test', ${randomBytes(16).toString("hex")}, ${randomBytes(8)}, 'passkey')
        `;
        const { cookie } = await fixture.session(created.id, PASSKEY_FRESH);
        return { ...created, cookie };
    }

    const post = (app: FastifyInstance, cookie: string, payload: object) =>
        app.inject({
            method: "POST",
            url: "/api/admin/system/queue",
            payload,
            headers: { origin: TEST_ORIGIN, cookie },
        });
    const ereignisse = (operationId: string) =>
        database<{ action: string; details: Record<string, unknown> }[]>`
            SELECT action, details FROM avesmaps_auth.security_event WHERE operation_id = ${operationId}
        `;

    // --- 1 bis 3: die Route ----------------------------------------------------------------------------------------

    it("🔴 `no_change` gegen die WIRKSAME Pause: die Stage hat pausiert, hier läuft die eigene Zeile", async () => {
        await ordner.schreibe(stand({ pause: stagePause(1) }));
        const app = await build();
        const betreiber = await person("operator", "Rondrikan");
        const vorher = await zeile();
        const operationId = randomUUID();
        const antwort = await post(app, betreiber.cookie, {
            operationId,
            baseRevision: vorher.revision,
            paused: true,
            reason: "auch hier",
        });
        expect([antwort.statusCode, antwort.json().error.code]).toEqual([409, "no_change"]);
        expect(await zeile()).toMatchObject({ paused: false, revision: vorher.revision, changed_at: null });
        expect(await ereignisse(operationId)).toEqual([]);
    });

    it("🔴 Fortsetzen schreibt die eigene Zeile, auch wenn sie schon „läuft“ trug: Erst dann ist sie die jüngste", async () => {
        await ordner.schreibe(stand({ pause: stagePause(1) }));
        const app = await build();
        const betreiber = await person("operator", "Rondrikan");
        const vorher = await zeile();
        const operationId = randomUUID();
        const antwort = await post(app, betreiber.cookie, {
            operationId,
            baseRevision: vorher.revision,
            paused: false,
        });
        expect(antwort.statusCode).toBe(200);
        const nachher = await zeile();
        expect(nachher.paused).toBe(false);
        expect(nachher.revision).toBeGreaterThan(vorher.revision);
        expect(nachher.changed_at).toBeInstanceOf(Date);
        // Genau ein Protokolleintrag, „von“ ist die wirksame Pause, nicht die eigene Zeile.
        const eintraege = await ereignisse(operationId);
        expect(eintraege).toHaveLength(1);
        expect(eintraege[0]).toMatchObject({
            action: "system.queue_changed",
            details: { from: true, to: false, reason: null },
        });

        // Und gleich danach sieht die Verwaltung die eigene, jüngere Anweisung, auch wenn der Dirigent noch die alte zeigt.
        const stand2 = await app.inject({
            method: "GET",
            url: "/api/admin/system",
            headers: { origin: TEST_ORIGIN, cookie: betreiber.cookie },
        });
        expect((stand2.json() as AdminSystemOverview).warteschlange?.pause).toMatchObject({ paused: false });
    });

    it("🔴 jede Anweisung trägt ihren Zeitpunkt: Pausieren hier, dann ist die Pause hier die wirksame", async () => {
        await ordner.schreibe(stand({ pause: stagePause(5, false) }));
        const app = await build();
        const betreiber = await person("operator", "Rondrikan");
        const antwort = await post(app, betreiber.cookie, {
            operationId: randomUUID(),
            baseRevision: (await zeile()).revision,
            paused: true,
            reason: "Datenbank wird gesichert",
        });
        expect(antwort.statusCode).toBe(200);
        const nachher = await zeile();
        expect(nachher).toMatchObject({ paused: true });
        expect(Date.now() - (nachher.changed_at?.getTime() ?? 0)).toBeLessThan(60_000);
        const verwaltung = (
            await app.inject({
                method: "GET",
                url: "/api/admin/system",
                headers: { origin: TEST_ORIGIN, cookie: betreiber.cookie },
            })
        ).json() as AdminSystemOverview;
        // Hier geschaltet: die Person mit Namen, kein fremder Ort.
        expect(verwaltung.warteschlange?.pause).toMatchObject({
            paused: true,
            by: "Rondrikan",
            reason: "Datenbank wird gesichert",
            anderswo: null,
        });
    });

    it("🔴 ohne frischen Stand vergleicht die Route mit der eigenen Zeile, wie bis WI-0163", async () => {
        const alt = new Date(Date.now() - 10 * 60_000);
        await ordner.schreibe(stand({ pause: stagePause(11) }, alt));
        const app = await build();
        const betreiber = await person("operator", "Rondrikan");
        const antwort = await post(app, betreiber.cookie, {
            operationId: randomUUID(),
            baseRevision: (await zeile()).revision,
            paused: false,
        });
        expect([antwort.statusCode, antwort.json().error.code]).toEqual([409, "no_change"]);
        const verwaltung = (
            await app.inject({
                method: "GET",
                url: "/api/admin/system",
                headers: { origin: TEST_ORIGIN, cookie: betreiber.cookie },
            })
        ).json() as AdminSystemOverview;
        // „Zustand unbekannt“, nie „läuft“: kein Stand, keine Reihe, und der Kurzstatus zählt nicht die eigene Tafel.
        expect(verwaltung.warteschlange).toMatchObject({ zustand: "veraltet", pause: null, reihe: [] });
        expect(verwaltung.brief.queue).toBeNull();
    });

    // --- 4: die Kommandozeile ----------------------------------------------------------------------------------------

    it("🔴 `warteschlange-fort` vergleicht wie die Route und schreibt genau einen Eintrag", async () => {
        await ordner.schreibe(stand({ pause: stagePause(1) }));
        const out: string[] = [];
        const cli = (...argv: string[]) =>
            runAuthCli(
                argv,
                { AVESMAPS_ENV: "test", QUEUE_STAND_FILE: ordner.datei },
                { out: (line) => void out.push(line), err: (line) => void out.push(line) },
                { database, systemUser: "wi0163-test" },
            );
        const vorher = await zeile();
        expect(await cli("warteschlange-fort")).toBe(0);
        const nachher = await zeile();
        expect(nachher.revision).toBeGreaterThan(vorher.revision);
        expect(nachher.changed_at).toBeInstanceOf(Date);
        expect(out.some((line) => line.includes("läuft wieder"))).toBe(true);
        const [eintrag] = await database<{ details: Record<string, unknown> }[]>`
            SELECT details FROM avesmaps_auth.security_event
             WHERE action = 'system.queue_changed' ORDER BY id DESC LIMIT 1
        `;
        expect(eintrag?.details).toMatchObject({ from: true, to: false });
        // Ein zweites Mal ändert nichts: Die eigene, jüngere Anweisung wirkt schon.
        out.length = 0;
        expect(await cli("warteschlange-fort")).toBe(0);
        expect(out.some((line) => line.includes("läuft schon"))).toBe(true);
        expect((await zeile()).revision).toBe(nachher.revision);
        // `betrieb-zeigen` nennt die wirksame Pause eigens, neben der Zeile dieser Umgebung.
        out.length = 0;
        expect(await cli("betrieb-zeigen")).toBe(0);
        expect(out).toContain("Warteschlange wirksam: läuft");
    });

    // --- 5: was Verwaltung und Übersicht zeigen ---------------------------------------------------------------------

    const enqueue = async (kind: string): Promise<string> => {
        const [row] = await database<{ public_id: string }[]>`
            SELECT public_id::text AS public_id FROM job_enqueue(${kind}, 1::smallint, ${DOMAIN}, ${PERSON}, '{}'::jsonb)
        `;
        return row!.public_id;
    };

    it("🔴 die Verwaltung: gemeinsame Reihe, fremde Aufträge ohne Person, die Pause der Stage mit Ort, der Kurzstatus zählt alle", async () => {
        const eigen = await enqueue("legacy_pull");
        await ordner.schreibe(
            stand({
                pause: stagePause(1),
                auftraege: [
                    auftrag("staging", {
                        publicId: randomUUID(),
                        label: "Gelände voll: Fassung 18",
                        kind: "terrain_full",
                        state: "RUNNING",
                        platz: null,
                        startedAt: new Date().toISOString(),
                        progress: 0.5,
                    }),
                    auftrag("test", { publicId: eigen, platz: 1, wartegrund: "waits_slot" }),
                ],
            }),
        );
        const app = await build();
        const betreiber = await person("operator", "Rondrikan");
        const antwort = await app.inject({
            method: "GET",
            url: "/api/admin/system",
            headers: { origin: TEST_ORIGIN, cookie: betreiber.cookie },
        });
        expect(antwort.statusCode).toBe(200);
        const body = antwort.json() as AdminSystemOverview;
        expect(body.warteschlange).toMatchObject({ zustand: "ok", umgebung: "test" });
        expect(body.warteschlange?.pause).toEqual({
            paused: true,
            since: expect.any(String),
            by: null,
            reason: "Sicherung der Stage",
            anderswo: "staging",
        });
        expect(body.warteschlange?.reihe).toEqual([
            expect.objectContaining({
                umgebung: "staging",
                eigen: false,
                jobId: null,
                state: "RUNNING",
                progress: 0.5,
            }),
            expect.objectContaining({
                umgebung: "test",
                eigen: true,
                jobId: eigen,
                platz: 1,
                waitReason: "waits_queue_paused",
            }),
        ]);
        expect(JSON.stringify(body.warteschlange)).not.toContain(STAGE_PERSON);
        expect(body.brief.queue).toEqual({ running: 1, queued: 1 });
        // Die eigene Zeile bleibt, was sie ist: die letzte Anweisung DIESER Umgebung.
        expect(body.configured?.queuePause.paused).toBe(false);
    });

    it("🔴 die Übersicht der Statusseite: Platz und Grund aus dem Stand, fremde ohne Person, Dirigent als Planer", async () => {
        const eigen = await enqueue("legacy_pull");
        const fremd = randomUUID();
        await ordner.schreibe(
            stand({
                auftraege: [
                    auftrag("staging", {
                        publicId: fremd,
                        platz: 1,
                        wartegrund: "waits_slot",
                        label: "Legacy-Zug: Wege",
                    }),
                    auftrag("test", { publicId: eigen, platz: 2, wartegrund: "waits_slot" }),
                ],
            }),
        );
        const leser = createWarteschlangeStandLeser(ordner.datei, "test", { ttlMs: 0 });
        const optionen = {
            database,
            config: testJobsConfig(),
            releaseId: "test",
            mapDomainId: DOMAIN,
            plannerScope: uniqueScope("wi0163-overview"),
            stand: await standJetzt(leser),
        };
        const alle = await buildJobsOverview(optionen);
        expect(alle.plannerActive).toBe(true);
        expect(alle.queued.find((job) => job.id === eigen)).toMatchObject({ position: 2, waitReason: "waits_slot" });
        expect(alle.gemeinsam?.reihe.map((eintrag) => [eintrag.umgebung, eintrag.jobId, eintrag.platz])).toEqual([
            ["staging", null, 1],
            ["test", eigen, 2],
        ]);
        expect(JSON.stringify(alle.gemeinsam)).not.toContain(fremd);
        expect(alle.queuePause).toMatchObject({ paused: false });

        // Die eigene Sicht eines Editors: nur seine Aufträge, auch in der gemeinsamen Reihe.
        const eigene = await buildJobsOverview({ ...optionen, owner: PERSON });
        expect(eigene.view).toBe("own");
        expect(eigene.gemeinsam?.reihe.map((eintrag) => eintrag.jobId)).toEqual([eigen]);

        // Ein Dirigent, der diese Umgebung nicht plant, ist für sie kein Planer.
        await ordner.schreibe(stand({ umgebungen: [{ name: "staging", erreichbar: true, planer: true }] }));
        expect((await buildJobsOverview({ ...optionen, stand: await standJetzt(leser) })).plannerActive).toBe(false);
    });
});
