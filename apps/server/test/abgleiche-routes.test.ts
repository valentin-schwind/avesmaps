import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdminAbgleiche, OperationReceipt, Role } from "@avesmaps3d/shared";
import { abgleicheModes } from "../src/abgleiche/ausfuehrung.ts";
import { buildApp } from "../src/app.ts";
import { runAuthCli } from "../src/auth/cli-commands.ts";
import type { ServerConfig } from "../src/config.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Routen der Abgleiche gegen echtes PostgreSQL mit den Rollen des VPS (WI-0127 SYS-14, SYS-0001 §9b): Fastify meldet sich als
 * App-Rolle an wie auf Stage, die Personen legt der Superuser an. Ein eigener Wegwerf-Cluster, weil Migration 0094 vor dem Push nicht in
 * die geteilte Testdatenbank gehört und die App-Rolle dort andere Rechte hätte.
 *
 * - Nur `run_legacy_sync` (Betreiber-Vorlage) startet; ein Admin liest nur. Stufe V: ohne zweiten Faktor 403.
 * - Der Start reiht in derselben Transaktion wie das Protokoll ein: genau ein Job und genau ein Eintrag `system.sync_requested`; ein zweiter
 *   Start derselben Quelle 409 `sync_running` ohne beides, dieselbe Kennung bekommt dieselbe Quittung.
 * - Weder Kartensperre noch Systemsperre halten den Start an (Schreibklasse `import`, Betreiber 2026-10-10 Frage 3).
 * - `ABGLEICHE=aus`: 503 `sync_unavailable`, nichts eingereiht.
 * - Das Lesemodell: wartend, dann der Kreis aus dem letzten Lauf; ein aufgezeichneter Zug auf Zuruf zählt mit.
 */

const ENV = "syncroutes";
const describeWithCluster = postgresBin ? describe : describe.skip;

function config(abgleiche: ServerConfig["abgleiche"]): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "sys14-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        auth: TEST_AUTH,
        abgleiche,
    };
}

describeWithCluster("Abgleiche: Routen mit den Rollen des VPS (Wegwerf-Cluster)", { timeout: 180_000 }, () => {
    let cluster: VpsCluster | undefined;
    let fixture: AuthFixture;
    let worker: FastifyInstance;
    let off: FastifyInstance;
    let stage: FastifyInstance;
    let operator: { id: string; name: string; cookie: string };
    let admin: { id: string; cookie: string };
    let operatorBasic: { cookie: string };
    let kategorien: FastifyInstance;
    let produktion: FastifyInstance;
    let operatorFrisch: { cookie: string };

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, []);
        await seedMapDomains(cluster.migrator);
        fixture = authFixture(cluster.admin);
        const build = async (mode: ServerConfig["abgleiche"]): Promise<FastifyInstance> => {
            const app = buildApp({
                config: config(mode),
                database: cluster!.app,
                logStream: { write: () => undefined },
                jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            });
            await app.ready();
            return app;
        };
        worker = await build("worker");
        off = await build("aus");
        // Stage nach Option A (SYS-14b): der Legacy-Zug über Claudios Korridor, die Medien aus. Über `abgleicheModes`,
        // damit die drei Kategoriezeilen (WI-0141) ihren abgeleiteten Wert tragen und nicht eine Handabschrift.
        stage = await build(abgleicheModes({ RELEASE_ID: "r", ABGLEICHE: "legacy:korridor,medien:aus" }));
        // Production nach WI-0141: der ganze Zug aus, die drei Kategorien über den Korridor.
        kategorien = await build(abgleicheModes({ RELEASE_ID: "r", ABGLEICHE: "legacy:kategorien,medien:aus" }));
        // Stage nach WI-0144: nur der Production-Zug; Legacy und Medien sind dort verborgen.
        produktion = await build(abgleicheModes({ RELEASE_ID: "r", ABGLEICHE: "production:korridor" }));
        const person = async (
            role: Role,
            name: string,
            assurance: "strong" | "basic" = "strong",
            passkeyMinutesAgo: number | null = 60,
        ) => {
            const created = await fixture.person(role, { name });
            const { cookie } = await fixture.session(created.id, {
                assurance,
                passkeyMinutesAgo: assurance === "strong" ? passkeyMinutesAgo : null,
            });
            return { ...created, cookie };
        };
        operator = await person("operator", "Rondrikan");
        admin = await person("admin", "Admina");
        operatorBasic = await person("operator", "Ohne Faktor", "basic");
        // Stufe S für eine Kategorie (WI-0141): frischer Passkey unmittelbar vor der Handlung.
        operatorFrisch = await person("operator", "Rondrikan mit Passkey", "strong", 1);
    }, 180_000);

    afterAll(async () => {
        await worker?.close();
        await off?.close();
        await stage?.close();
        await kategorien?.close();
        await produktion?.close();
        await cluster?.stop();
    }, 60_000);

    const get = (app: FastifyInstance, cookie: string) =>
        app.inject({ method: "GET", url: "/api/admin/system/abgleiche", headers: { cookie } });
    const start = (app: FastifyInstance, cookie: string, quelle: string, operationId: string = randomUUID()) =>
        app.inject({
            method: "POST",
            url: "/api/admin/system/abgleiche/start",
            payload: { operationId, quelle },
            headers: { origin: TEST_ORIGIN, cookie },
        });
    const code = (response: { statusCode: number; json(): unknown }): string =>
        response.statusCode < 300
            ? String(response.statusCode)
            : `${String(response.statusCode)} ${(response.json() as { error: { code: string } }).error.code}`;

    async function jobs(
        kind: string,
    ): Promise<{ public_id: string; actor_ref: string; input_ref: unknown; state: string }[]> {
        return cluster!.admin`
            SELECT public_id::text AS public_id, actor_ref, input_ref, state FROM job WHERE kind = ${kind} ORDER BY id
        `;
    }
    async function events(): Promise<{ details: Record<string, unknown>; target_ref: string }[]> {
        return cluster!.admin`
            SELECT details, target_ref FROM avesmaps_auth.security_event WHERE action = 'system.sync_requested' ORDER BY id
        `;
    }

    it("lesen darf der Admin, ohne Aufträge stehen beide Zeilen leer", async () => {
        const response = await get(worker, admin.cookie);
        expect(response.statusCode).toBe(200);
        const body = response.json() as AdminAbgleiche;
        expect(body.ausfuehrung).toBe("worker");
        expect(body.planerAktiv).toBe(false);
        expect(body.zeilen.map((zeile) => [zeile.quelle, zeile.kreis, zeile.letzter, zeile.laufend])).toEqual([
            ["legacy", "leer", null, null],
            ["legacy_landschaften", "leer", null, null],
            ["legacy_wege", "leer", null, null],
            ["legacy_orte", "leer", null, null],
            ["medien", "leer", null, null],
        ]);
    });

    it("🔴 starten darf nur der Betreiber, und nur mit zweitem Faktor", async () => {
        expect(code(await start(worker, admin.cookie, "legacy"))).toBe("403 forbidden");
        expect(code(await start(worker, operatorBasic.cookie, "legacy"))).toBe("403 assurance_required");
        expect(await jobs("legacy_pull")).toEqual([]);
        expect(await events()).toEqual([]);
    });

    it("🔴 der Start reiht genau einen Job ein und schreibt genau einen Protokolleintrag; zweimal heißt 409, dieselbe Kennung dieselbe Quittung", async () => {
        const operationId = randomUUID();
        const first = await start(worker, operator.cookie, "legacy", operationId);
        expect(first.statusCode).toBe(200);
        const receipt = first.json() as OperationReceipt;
        expect(receipt.status).toBe("applied");
        expect(receipt.derivedWork).toHaveLength(1);
        expect(receipt.derivedWork[0]?.kind).toBe("legacy_pull");
        expect(receipt.warnings.map((warning) => warning.code)).toEqual(["planner_inactive"]);
        const jobId = receipt.derivedWork[0]?.jobId;
        expect(await jobs("legacy_pull")).toEqual([
            { public_id: jobId, actor_ref: operator.id, input_ref: { quelle: "legacy" }, state: "QUEUED" },
        ]);
        expect(await events()).toEqual([{ details: { source: "legacy", job: jobId }, target_ref: `job:${jobId}` }]);

        const replay = await start(worker, operator.cookie, "legacy", operationId);
        expect((replay.json() as OperationReceipt).status).toBe("replayed");
        expect((replay.json() as OperationReceipt).derivedWork[0]?.jobId).toBe(jobId);

        const again = await start(worker, operator.cookie, "legacy");
        expect(code(again)).toBe("409 sync_running");
        expect(await jobs("legacy_pull")).toHaveLength(1);
        expect(await events()).toHaveLength(1);

        const body = (await get(worker, operator.cookie)).json() as AdminAbgleiche;
        const legacy = body.zeilen.find((zeile) => zeile.quelle === "legacy");
        expect(legacy?.laufend).toMatchObject({
            jobId,
            state: "QUEUED",
            ausgeloest: { art: "person", name: "Rondrikan" },
        });
        expect(legacy?.kreis).toBe("leer");
    });

    it("der Kreis folgt dem letzten fertigen Lauf; ein aufgezeichneter Zug auf Zuruf zählt mit", async () => {
        const [job] = await jobs("legacy_pull");
        const finish = (result: object, state = "SUCCEEDED") => cluster!.admin`
            UPDATE job SET state = ${state}, finished_at = now(), result = ${cluster!.admin.json(result as never)},
                   error_summary = ${state === "FAILED" ? "Der Legacy-Zug hat angehalten: HTTP 503" : null}
             WHERE public_id = ${job!.public_id}::uuid
        `;
        const legacyRow = async () =>
            ((await get(worker, admin.cookie)).json() as AdminAbgleiche).zeilen.find(
                (zeile) => zeile.quelle === "legacy",
            );

        await finish({ luecken: [], befunde: 3, satz: "map1-eco2-live20261011t1405z" });
        let row = await legacyRow();
        expect(row?.laufend).toBeNull();
        expect(row?.kreis).toBe("voll");
        expect(row?.letzter).toMatchObject({
            state: "SUCCEEDED",
            luecken: [],
            befunde: 3,
            satz: "map1-eco2-live20261011t1405z",
        });
        expect(row?.letzter?.ausgeloest).toEqual({ art: "person", name: "Rondrikan" });

        await finish({ luecken: ["I24"], befunde: 3 });
        expect((await legacyRow())?.kreis).toBe("halb");

        await finish({}, "FAILED");
        row = await legacyRow();
        expect(row?.kreis).toBe("leer");
        expect(row?.letzter?.fehler).toContain("HTTP 503");

        // `legacy:update` auf Zuruf zeichnet sich als `import` auf; danach ist er der letzte Abgleich, ohne Person und ohne Lücken.
        await cluster!.admin`
            INSERT INTO job (kind, map_domain_id, origin, external_ref, label, state, queued_at, started_at, finished_at)
            VALUES ('import', 'aventuria', 'recorded', 'legacy-update-20261011t1500z', 'legacy:update (lokal)', 'SUCCEEDED',
                    now() + interval '1 minute', now() + interval '1 minute', now() + interval '2 minutes')
        `;
        row = await legacyRow();
        expect(row?.kreis).toBe("voll");
        expect(row?.letzter?.ausgeloest).toEqual({ art: "ablauf", name: "legacy:update (lokal)" });
        expect(row?.letzter?.luecken).toBeNull();
        // Für die Medien zählt er nicht.
        expect(
            ((await get(worker, admin.cookie)).json() as AdminAbgleiche).zeilen.find(
                (zeile) => zeile.quelle === "medien",
            )?.letzter,
        ).toBeNull();
    });

    it("🔴 Kartensperre und Systemsperre halten den Start nicht an (Betreiber 2026-10-10, Frage 3)", async () => {
        await cluster!.admin`
            UPDATE system_state
               SET map_lock = true, map_lock_since = now(), map_lock_by_label = 'cli:test', map_lock_reason = 'SYS-14',
                   system_lock = true, system_lock_since = now(), system_lock_by_label = 'cli:test', system_lock_reason = 'SYS-14'
             WHERE id = 1
        `;
        try {
            await worker.systemState?.refresh();
            expect(worker.systemState?.snapshot()).toMatchObject({ mapLock: true, systemLock: true });
            expect(code(await start(worker, operator.cookie, "medien"))).toBe("200");
            expect(await jobs("legacy_media")).toHaveLength(1);
        } finally {
            await cluster!.admin`
                UPDATE system_state
                   SET map_lock = false, map_lock_since = NULL, map_lock_by_label = NULL, map_lock_reason = NULL,
                       system_lock = false, system_lock_since = NULL, system_lock_by_label = NULL, system_lock_reason = NULL
                 WHERE id = 1
            `;
            await worker.systemState?.refresh();
        }
    });

    it("🔴 die Kommandozeile startet wie die Route: genau ein Job und genau ein Eintrag als cli:, zweimal Exit 1 ohne Eintrag (SYS-0001 §9d.2)", async () => {
        await cluster!
            .admin`UPDATE job SET state = 'CANCELLED', finished_at = now() WHERE state IN ('QUEUED', 'RUNNING')`;
        const run = async (argv: string[], abgleiche = "worker") => {
            const out: string[] = [];
            const err: string[] = [];
            const code = await runAuthCli(
                argv,
                { AVESMAPS_ENV: "test", ABGLEICHE: abgleiche },
                { out: (line) => void out.push(line), err: (line) => void err.push(line) },
                { database: cluster!.app, systemUser: "claudio" },
            );
            return { code, out, err };
        };
        const before = (await events()).length;
        const first = await run(["abgleich-starten", "--quelle", "legacy"]);
        expect(first.code).toBe(0);
        const queued = (await jobs("legacy_pull")).filter((row) => row.state === "QUEUED");
        expect(queued).toHaveLength(1);
        expect(queued[0]?.actor_ref).toBe("cli:claudio");
        const added = (await events()).slice(before);
        expect(added).toEqual([
            {
                details: { source: "legacy", job: queued[0]?.public_id },
                target_ref: `job:${String(queued[0]?.public_id)}`,
            },
        ]);
        const [actor] = await cluster!.admin<{ actor_kind: string; actor_label: string }[]>`
            SELECT actor_kind, actor_label FROM avesmaps_auth.security_event WHERE action = 'system.sync_requested' ORDER BY id DESC LIMIT 1
        `;
        expect(actor).toEqual({ actor_kind: "cli", actor_label: "cli:claudio" });
        // Die Zeile nennt den Auslöser ohne Person.
        const legacy = ((await get(worker, admin.cookie)).json() as AdminAbgleiche).zeilen.find(
            (zeile) => zeile.quelle === "legacy",
        );
        expect(legacy?.laufend?.ausgeloest).toEqual({ art: "ablauf", name: "cli:claudio" });

        const again = await run(["abgleich-starten", "--quelle", "legacy"]);
        expect(again.code).toBe(1);
        expect(again.err.join(" ")).toContain("wartet oder läuft schon");
        expect(await run(["abgleich-starten", "--quelle", "medien"], "aus")).toMatchObject({ code: 1 });
        expect(await run(["abgleich-starten", "--quelle", "wiki"])).toMatchObject({ code: 2 });
        expect((await events()).length).toBe(before + 1);

        // Die zweite Sperre nach dem Cutoff: der Abholer fragt vor dem Übernehmen, nur Exit 0 darf übernehmen, und es entsteht kein Eintrag.
        const vorCutoff = "legacy:kategorien,medien:aus";
        expect(await run(["abgleich-zeigen", "--quelle", "legacy_wege"], vorCutoff)).toMatchObject({ code: 0 });
        expect(await run(["abgleich-zeigen", "--quelle", "legacy_wege"], "legacy:aus,medien:aus")).toMatchObject({
            code: 3,
        });
        expect(await run(["abgleich-zeigen", "--quelle", "legacy"], vorCutoff)).toMatchObject({ code: 3 });
        expect(await run(["abgleich-zeigen"], vorCutoff)).toMatchObject({ code: 2 });
        expect((await events()).length).toBe(before + 1);
    });

    it("ohne Ausführung auf der Umgebung: 503 sync_unavailable, nichts eingereiht", async () => {
        await cluster!
            .admin`UPDATE job SET state = 'CANCELLED', finished_at = now() WHERE state IN ('QUEUED', 'RUNNING')`;
        expect(code(await start(off, operator.cookie, "legacy"))).toBe("503 sync_unavailable");
        expect(((await get(off, operator.cookie)).json() as AdminAbgleiche).ausfuehrung).toBe("aus");
        expect((await jobs("legacy_pull")).filter((row) => row.state === "QUEUED")).toEqual([]);
    });

    it("🔴 Stage (legacy:korridor, medien:aus): der Legacy-Zug reiht ein und wartet auf Abholung, ohne Planer-Hinweis; die Medien 503", async () => {
        await cluster!
            .admin`UPDATE job SET state = 'CANCELLED', finished_at = now() WHERE state IN ('QUEUED', 'RUNNING')`;
        const response = await start(stage, operator.cookie, "legacy");
        expect(code(response)).toBe("200");
        expect((response.json() as OperationReceipt).warnings).toEqual([]);
        expect(code(await start(stage, operator.cookie, "medien"))).toBe("503 sync_unavailable");
        const body = (await get(stage, operator.cookie)).json() as AdminAbgleiche;
        expect(body.ausfuehrung).toBe("korridor");
        expect(
            body.zeilen.map((zeile) => [zeile.quelle, zeile.ausfuehrung, zeile.laufend?.waitReason ?? null]),
        ).toEqual([
            ["legacy", "korridor", "waits_pickup"],
            // Stage zieht die ganze Karte; die drei Kategoriezeilen und die Medien stehen dort `aus` und fehlen in der Liste:
            // Seit dem Cutoff 02.11. zeigt die Oberfläche keine gesperrte Legacy-Zeile mehr.
        ]);
    });

    it("🔴 Production (legacy:kategorien): der ganze Zug ist gesperrt, und jede Kategorie mit einem WikiSync-Bereich fährt nicht", async () => {
        await cluster!
            .admin`UPDATE job SET state = 'CANCELLED', finished_at = now() WHERE state IN ('QUEUED', 'RUNNING')`;
        // Betreiber 2026-10-13: „jede kategorie einzeln (also unterkategorien ohne dass man alles ziehen darf)“.
        // Ohne frischen Passkey geht keine Kategorie: `run_legacy_zug` ist Stufe S.
        expect(code(await start(kategorien, operator.cookie, "legacy_orte"))).toBe("403 reauth_required");
        expect(code(await start(kategorien, operatorFrisch.cookie, "legacy"))).toBe("503 sync_unavailable");
        // Alle drei Kategorien haben Bereiche, die fest dem WikiSync gehören, und fahren nicht (Wegfall des Schalters, Cutoff 02.11.).
        for (const kategorie of ["legacy_orte", "legacy_wege", "legacy_landschaften"] as const) {
            expect(code(await start(kategorien, operatorFrisch.cookie, kategorie))).toBe(
                "409 bereich_gehoert_wikisync",
            );
        }
        const wartend = await cluster!.admin`SELECT kind FROM job WHERE state = 'QUEUED'`;
        expect(wartend).toEqual([]);
        const body = (await get(kategorien, operatorFrisch.cookie)).json() as AdminAbgleiche;
        expect(
            body.zeilen.map((zeile) => [zeile.quelle, zeile.ausfuehrung, zeile.laufend?.waitReason ?? null]),
        ).toEqual([
            // Die Gesamtzeile und die Medien stehen `aus` und fehlen in der Liste (kein Legacy-Zug mehr nach dem Cutoff 02.11.).
            ["legacy_landschaften", "korridor", null],
            ["legacy_wege", "korridor", null],
            ["legacy_orte", "korridor", null],
        ]);
        // 🔴 Production bleibt, wie es war: Die Zeile des Production-Zugs steht dort NICHT (WI-0144, Betreiber 2026-10-14:
        //    „Und in Production lassen wir das mal so wie jetzt.“). Niemand muss dafür einen Umgebungswert ändern.
        expect(body.zeilen.map((zeile) => zeile.quelle)).not.toContain("production");
    });

    it("🔴 Stage (production:korridor): nur die Zeile des Production-Zugs, und sie braucht ihr eigenes Recht (WI-0144)", async () => {
        await cluster!
            .admin`UPDATE job SET state = 'CANCELLED', finished_at = now() WHERE state IN ('QUEUED', 'RUNNING')`;
        // Betreiber 2026-10-14: „unter "Abgleiche" darf auf der Stage nur "Production-Zug" stehen“.
        const body = (await get(produktion, operator.cookie)).json() as AdminAbgleiche;
        expect(body.zeilen.map((zeile) => [zeile.quelle, zeile.ausfuehrung])).toEqual([["production", "korridor"]]);
        // Stufe S: ohne frischen Passkey geht der Zug nicht, auch nicht für einen Betreiber mit zweitem Faktor.
        expect(code(await start(produktion, operator.cookie, "production"))).toBe("403 reauth_required");
        // Eine verborgene Quelle reiht über die Route erst recht nichts ein.
        expect(code(await start(produktion, operatorFrisch.cookie, "legacy"))).toBe("503 sync_unavailable");
        expect(code(await start(produktion, operatorFrisch.cookie, "medien"))).toBe("503 sync_unavailable");
        expect(code(await start(produktion, operatorFrisch.cookie, "production"))).toBe("200");
        const [job] = await cluster!.admin`SELECT kind, input_ref FROM job WHERE state = 'QUEUED'`;
        expect(job).toEqual({ kind: "production_pull", input_ref: { quelle: "production" } });
        // Er wartet auf Claudios Abholer und sperrt sich selbst.
        expect(code(await start(produktion, operatorFrisch.cookie, "production"))).toBe("409 sync_running");
        const danach = (await get(produktion, operatorFrisch.cookie)).json() as AdminAbgleiche;
        expect(danach.zeilen[0]?.laufend?.waitReason).toBe("waits_pickup");
    });

    it("🔴 der Production-Zug und jeder Legacy-Zug sperren einander (WI-0144)", async () => {
        await cluster!
            .admin`UPDATE job SET state = 'CANCELLED', finished_at = now() WHERE state IN ('QUEUED', 'RUNNING')`;
        // Er ersetzt Kartendaten, Kacheln UND Medien in einem Lauf — also darf nichts anderes daneben laufen.
        expect(code(await start(worker, operator.cookie, "legacy"))).toBe("200");
        expect(code(await start(produktion, operatorFrisch.cookie, "production"))).toBe("409 sync_running");
        await cluster!
            .admin`UPDATE job SET state = 'CANCELLED', finished_at = now() WHERE state IN ('QUEUED', 'RUNNING')`;
        expect(code(await start(produktion, operatorFrisch.cookie, "production"))).toBe("200");
        expect(code(await start(worker, operator.cookie, "legacy"))).toBe("409 sync_running");
        expect(code(await start(worker, operator.cookie, "medien"))).toBe("409 sync_running");
        await cluster!
            .admin`UPDATE job SET state = 'CANCELLED', finished_at = now() WHERE state IN ('QUEUED', 'RUNNING')`;
    });
});
