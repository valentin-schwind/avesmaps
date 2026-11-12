import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AdminHoehenmodell, HoehenmodellProfil, Role } from "@avesmaps3d/shared";
import type { AuditAction } from "../src/auth/audit.ts";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { brauchtAbkuehlzeit, rechneNeu } from "../src/terrain/hoehenmodell.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * Die Routen des Höhenmodells gegen echtes PostgreSQL (WI-0127 SYS-13, SYS-0001 §9c, Entscheide §9c.11 und §9c.12).
 *
 * - Lesen darf der Admin (`view_operations`); wählen, zurück, abnehmen und Entwürfe nur `manage_terrain_recipe` (Frage 3 B), Stufe V;
 *   ohne zweiten Faktor 403.
 * - Wählen setzt die Auswahl, reiht die volle Kette ein (§9c.11) und schreibt genau ein `system.terrain_activated`; dieselbe Kennung
 *   bekommt dieselbe Quittung; eine veraltete Revision 409 `edit_conflict`, dieselbe Fassung 409 `terrain_already_active`, eine
 *   unbekannte 400.
 * - Zurück nur zu einer abgenommenen vorigen Fassung, sonst 409 `terrain_no_rollback`.
 * - Entwürfe: nur freigegebene Regler (400 `terrain_draft_invalid`), die Messung als Job `terrain_preview` (eine zur Zeit, 409), nicht
 *   auf einer Instanz mit Profil `abgenommen` (503); verwerfen einmal, danach 404.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const BASE = "/api/admin/system/hoehenmodell";

function config(hoehenmodell: HoehenmodellProfil): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "sys13-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        auth: TEST_AUTH,
        hoehenmodell,
    };
}

describeWithDatabase(
    "Höhenmodell: Lesen, Wählen, Zurück, Abnehmen, Entwürfe (PostgreSQL)",
    { timeout: 120_000 },
    () => {
        let database: Database;
        let fixture: AuthFixture;
        const apps: FastifyInstance[] = [];
        let voll: FastifyInstance;
        let abgenommen: FastifyInstance;
        let operator: { cookie: string };
        let admin: { cookie: string };
        let operatorBasic: { cookie: string };

        async function build(profil: HoehenmodellProfil): Promise<FastifyInstance> {
            const app = buildApp({
                config: config(profil),
                database: createDatabase(testDatabaseUrl as string, { max: 2 }),
                logStream: { write: () => undefined },
                jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            });
            await app.ready();
            apps.push(app);
            return app;
        }

        async function reset(): Promise<void> {
            await database`
            UPDATE job SET state = 'CANCELLED', finished_at = now()
             WHERE kind IN ('terrain_full', 'routing_reload', 'display_heights', 'terrain_preview') AND state IN ('QUEUED', 'RUNNING')
        `;
            await database`DELETE FROM terrain_recipe_choice`;
            await database`UPDATE terrain_recipe_draft SET state = 'verworfen', discarded_at = now() WHERE state = 'entwurf'`;
        }

        beforeAll(async () => {
            database = createDatabase(testDatabaseUrl as string, { max: 4 });
            await migrate(database);
            await seedMapDomains(database);
            fixture = authFixture(database);
            voll = await build("voll");
            abgenommen = await build("abgenommen");
            const person = async (role: Role, name: string, assurance: "strong" | "basic" = "strong") => {
                const created = await fixture.person(role, { name });
                const { cookie } = await fixture.session(created.id, {
                    assurance,
                    passkeyMinutesAgo: assurance === "strong" ? 1 : null,
                });
                return { ...created, cookie };
            };
            operator = await person("operator", "Geländemeisterin");
            admin = await person("admin", "Admina");
            operatorBasic = await person("operator", "Ohne Faktor", "basic");
        });

        beforeEach(reset);

        afterAll(async () => {
            await reset();
            for (const app of apps) await app.close();
            await fixture?.cleanup();
            await database?.end({ timeout: 5 });
        });

        describe("Abkühlzeit in Production (WI-0279, Claudio)", () => {
            const actor = { personId: null, label: "Probe", actorRef: "probe" };

            it("🔴 gilt nur in Production und nur ohne Betreiberrolle", () => {
                expect(brauchtAbkuehlzeit({ environment: "production", role: "editor" })).toBe(true);
                expect(brauchtAbkuehlzeit({ environment: "production", role: "admin" })).toBe(true);
                expect(brauchtAbkuehlzeit({ environment: "production", role: "operator" })).toBe(false);
                expect(brauchtAbkuehlzeit({ environment: "staging", role: "editor" })).toBe(false);
            });

            it("🔴 ohne Betreiber kein zweiter voller Lauf binnen 30 Minuten; danach geht es wieder", async () => {
                const lauf = await database.begin((tx) => rechneNeu(tx, { domain: "aventuria", actor }));
                await database`
                    UPDATE job SET state = 'RUNNING', lease_owner = 'worker-1', lease_no = lease_no + 1,
                           lease_expires_at = now() + interval '10 minutes', heartbeat_at = now(), started_at = now()
                     WHERE public_id = ${lauf.job}::uuid
                `;
                const fehler = await database
                    .begin((tx) => rechneNeu(tx, { domain: "aventuria", actor, abkuehlen: true }))
                    .catch((error: unknown) => error as { code?: string; details?: { ab?: string } });
                expect(fehler).toMatchObject({ code: "terrain_cooldown" });
                expect(Date.parse(String((fehler as { details?: { ab?: string } }).details?.ab))).toBeGreaterThan(
                    Date.now(),
                );

                // Ohne die Abkühlzeit (Betreiber) geht es, wie bisher.
                const betreiber = await database.begin((tx) => rechneNeu(tx, { domain: "aventuria", actor }));
                await database`UPDATE job SET state = 'CANCELLED', finished_at = now() WHERE public_id = ${betreiber.job}::uuid`;

                await database`UPDATE job SET queued_at = now() - interval '31 minutes' WHERE public_id = ${lauf.job}::uuid`;
                const spaeter = await database.begin((tx) =>
                    rechneNeu(tx, { domain: "aventuria", actor, abkuehlen: true }),
                );
                expect(spaeter.job).toBeTruthy();
            });
        });

        const get = async (app: FastifyInstance = voll, cookie: string = admin.cookie): Promise<AdminHoehenmodell> => {
            const response = await app.inject({ method: "GET", url: BASE, headers: { cookie } });
            expect(response.statusCode).toBe(200);
            return response.json() as AdminHoehenmodell;
        };
        const post = (
            path: string,
            payload: Record<string, unknown>,
            cookie: string = operator.cookie,
            app: FastifyInstance = voll,
        ) =>
            app.inject({
                method: "POST",
                url: `${BASE}${path}`,
                payload: { operationId: randomUUID(), ...payload },
                headers: { origin: TEST_ORIGIN, cookie },
            });
        const code = (response: { statusCode: number; json(): unknown }): string =>
            response.statusCode < 300
                ? String(response.statusCode)
                : `${String(response.statusCode)} ${(response.json() as { error: { code: string } }).error.code}`;
        const events = async (action: AuditAction): Promise<number> => {
            const [row] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM avesmaps_auth.security_event WHERE environment = 'test' AND action = ${action}
        `;
            return row!.n;
        };
        const revision = async (): Promise<number> => (await get()).eingestellt.revision;

        it("Lesen: ohne Auswahl die Datei (18), alle Fassungen bekannt und abgenommen, kein Rückweg", async () => {
            const body = await get();
            expect(body.profil).toBe("voll");
            expect(body.eingestellt).toMatchObject({ version: 18, quelle: "datei", revision: 0, unbekannt: null });
            expect(body.rueckweg).toBeNull();
            expect(body.fassungen.map((fassung) => [fassung.version, fassung.regional, fassung.inDatei])).toEqual([
                [17, false, true],
                [18, true, true],
                // Fassung 19: 18 mit den Gebirgs-Presets je Typ (WI-0127 F3) und mehr; auf Stage abgenommen 2026-11-07.
                [19, true, true],
            ]);
            expect(body.fassungen[1]?.unterschied.map((entry) => entry.pfad)).toEqual(["generator.uplift"]);
            expect((await get(abgenommen)).profil).toBe("abgenommen");
        });

        it("🔴 nur manage_terrain_recipe schreibt; ohne zweiten Faktor 403; nichts geändert, nichts protokolliert", async () => {
            const vorher = await events("system.terrain_activated");
            expect(code(await post("/waehlen", { baseRevision: 0, version: 17, reason: "Probe" }, admin.cookie))).toBe(
                "403 forbidden",
            );
            expect(
                (await post("/waehlen", { baseRevision: 0, version: 17, reason: "Probe" }, operatorBasic.cookie))
                    .statusCode,
            ).toBe(403);
            expect(
                code(
                    await post(
                        "/entwurf",
                        { basis: 18, aenderungen: { saturation: 12 }, reason: "Probe" },
                        admin.cookie,
                    ),
                ),
            ).toBe("403 forbidden");
            expect((await get()).eingestellt.quelle).toBe("datei");
            expect(await events("system.terrain_activated")).toBe(vorher);
        });

        it("🔴 wählen: Auswahl, volle Kette, genau ein Ereignis; dieselbe Kennung: dieselbe Quittung; veraltet, gleich, unbekannt: abgewiesen", async () => {
            const vorher = await events("system.terrain_activated");
            const operationId = randomUUID();
            const first = await post("/waehlen", { operationId, baseRevision: 0, version: 17, reason: "Vergleich" });
            expect(code(first)).toBe("200");
            const receipt = first.json() as { derivedWork: { kind: string; jobId: string; state: string }[] };
            expect(receipt.derivedWork).toEqual([{ kind: "terrain_full", jobId: expect.any(String), state: "queued" }]);
            expect(await events("system.terrain_activated")).toBe(vorher + 1);

            const replay = await post("/waehlen", { operationId, baseRevision: 0, version: 17, reason: "Vergleich" });
            expect((replay.json() as { status: string }).status).toBe("replayed");
            expect(await events("system.terrain_activated")).toBe(vorher + 1);

            const body = await get();
            expect(body.eingestellt).toMatchObject({ version: 17, quelle: "auswahl", revision: 1, grund: "Vergleich" });
            expect(body.kette).toMatchObject({
                jobId: receipt.derivedWork[0]!.jobId,
                art: "terrain_full",
                state: "QUEUED",
            });
            expect(body.rueckweg).toBe(18);
            const [chain] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM job
             WHERE kind IN ('terrain_full', 'routing_reload', 'display_heights') AND state = 'QUEUED' AND map_domain_id = 'aventuria'
        `;
            expect(chain!.n).toBe(3);

            expect(code(await post("/waehlen", { baseRevision: 0, version: 18, reason: "veraltet" }))).toBe(
                "409 edit_conflict",
            );
            expect(code(await post("/waehlen", { baseRevision: 1, version: 17, reason: "gleich" }))).toBe(
                "409 terrain_already_active",
            );
            expect(code(await post("/waehlen", { baseRevision: 1, version: 99, reason: "unbekannt" }))).toBe(
                "400 terrain_version_unknown",
            );
            expect(await events("system.terrain_activated")).toBe(vorher + 1);
        });

        it("🔴 zurück: nur zu einer abgenommenen vorigen Fassung; die Kette nimmt den wartenden vollen Lauf mit", async () => {
            expect(code(await post("/zurueck", { baseRevision: 0, reason: "nichts davor" }))).toBe(
                "409 terrain_no_rollback",
            );
            const chosen = await post("/waehlen", { baseRevision: 0, version: 17, reason: "Vergleich" });
            const job = (chosen.json() as { derivedWork: { jobId: string }[] }).derivedWork[0]!.jobId;
            // Production darf zurück (Frage 4 A und 5 B): auf der Instanz mit Profil „abgenommen“.
            const back = await post(
                "/zurueck",
                { baseRevision: await revision(), reason: "zurück" },
                operator.cookie,
                abgenommen,
            );
            expect(code(back)).toBe("200");
            expect((back.json() as { derivedWork: { jobId: string }[] }).derivedWork[0]!.jobId).toBe(job);
            // 🔴 WI-0154: Der mitgenommene Lauf trägt das Etikett der GELTENDEN Wahl, nicht der ersten Anforderung. Genau
            // diese Unwahrheit stand am 2026-10-13 in Production („Fassung 17“, während 18 galt); der Job rechnet beim
            // Start ohnehin die geltende Wahl.
            const [mitgenommen] = await database<{ label: string | null; coalesced_count: number }[]>`
            SELECT label, coalesced_count FROM job WHERE public_id = ${job}::uuid
        `;
            expect(mitgenommen).toMatchObject({
                label: "Gelände voll rechnen (Fassung 18, zurück)",
                coalesced_count: 1,
            });
            const body = await get();
            expect(body.eingestellt).toMatchObject({ version: 18, revision: 2 });
            expect(body.rueckweg).toBe(17);
            const [details] = await database<{ details: Record<string, unknown> }[]>`
            SELECT details FROM avesmaps_auth.security_event
             WHERE environment = 'test' AND action = 'system.terrain_activated' ORDER BY id DESC LIMIT 1
        `;
            expect(details!.details).toMatchObject({ from: 17, to: 18, rueckweg: true, job });
        });

        it("🔴 neu rechnen (Betreiber 2026-10-17, Topographie F8): dieselbe Fassung, die volle Kette, ein Ereignis; wartet eine schon, 409; läuft eine, reiht sich die neue dahinter", async () => {
            const vorher = await events("system.terrain_recomputed");
            expect(code(await post("/neu-rechnen", {}, admin.cookie))).toBe("403 forbidden");
            expect((await post("/neu-rechnen", {}, operatorBasic.cookie)).statusCode).toBe(403);
            expect(await events("system.terrain_recomputed")).toBe(vorher);

            const erste = await post("/neu-rechnen", {});
            expect(code(erste)).toBe("200");
            const lauf = (erste.json() as { derivedWork: { kind: string; jobId: string; state: string }[] })
                .derivedWork;
            expect(lauf).toEqual([{ kind: "terrain_full", jobId: expect.any(String), state: "queued" }]);
            const [zeile] = await database<{ label: string | null }[]>`
            SELECT label FROM job WHERE public_id = ${lauf[0]!.jobId}::uuid
        `;
            expect(zeile!.label).toBe("Gelände voll rechnen (Fassung 18, neu gerechnet)");
            // Die Auswahl bleibt: Neu rechnen wechselt keine Fassung.
            expect((await get()).eingestellt).toMatchObject({ version: 18, quelle: "datei" });
            expect(await events("system.terrain_recomputed")).toBe(vorher + 1);

            // Höchstens eine wartende Kette: Sie rechnet ohnehin mit dem neuesten Stand.
            expect(code(await post("/neu-rechnen", {}))).toBe("409 terrain_chain_waiting");
            expect(await events("system.terrain_recomputed")).toBe(vorher + 1);

            // Läuft sie, wartet die nächste dahinter und sieht den neueren Stand.
            await database`
            UPDATE job SET state = 'RUNNING', lease_owner = 'worker-1', lease_no = lease_no + 1,
                   lease_expires_at = now() + interval '10 minutes', heartbeat_at = now(), started_at = now()
             WHERE public_id = ${lauf[0]!.jobId}::uuid
        `;
            const zweite = await post("/neu-rechnen", {});
            expect(code(zweite)).toBe("200");
            const naechste = (zweite.json() as { derivedWork: { jobId: string }[] }).derivedWork[0]!.jobId;
            expect(naechste).not.toBe(lauf[0]!.jobId);
            const [details] = await database<{ details: Record<string, unknown> }[]>`
            SELECT details FROM avesmaps_auth.security_event
             WHERE environment = 'test' AND action = 'system.terrain_recomputed' ORDER BY id DESC LIMIT 1
        `;
            expect(details!.details).toEqual({ version: 18, job: naechste });
        });

        it("abnehmen: hängt eine Abnahme an, die an der Fassung steht; eine unbekannte Fassung 400", async () => {
            const vorher = await events("system.terrain_accepted");
            expect(code(await post("/abnehmen", { version: 18, reason: "Stage passt" }))).toBe("200");
            expect(code(await post("/abnehmen", { version: 99, reason: "unbekannt" }))).toBe(
                "400 terrain_version_unknown",
            );
            expect(await events("system.terrain_accepted")).toBe(vorher + 1);
            const fassung = (await get()).fassungen.find((entry) => entry.version === 18);
            expect(fassung?.abnahme).toMatchObject({ wer: "Geländemeisterin", grund: "Stage passt" });
            expect(fassung?.kreis).toBe("voll");
        });

        it("🔴 Entwürfe: nur freigegebene Regler, eine Messung zur Zeit als Job, nicht unter Profil „abgenommen“; verwerfen einmal", async () => {
            expect(code(await post("/entwurf", { basis: 18, aenderungen: { seed: 7 }, reason: "nicht frei" }))).toBe(
                "400 terrain_draft_invalid",
            );
            expect(
                code(await post("/entwurf", { basis: 17, aenderungen: { radius: 12 }, reason: "nicht regional" })),
            ).toBe("400 terrain_draft_invalid");
            expect(
                code(await post("/entwurf", { basis: 18, aenderungen: { saturation: 12 }, reason: "weicher" })),
            ).toBe("200");
            const [entwurf] = (await get()).entwuerfe;
            expect(entwurf).toMatchObject({
                basis: 18,
                aenderungen: { saturation: 12 },
                grund: "weicher",
                kreis: "leer",
                messung: null,
            });

            expect(code(await post("/entwurf/messen", { draft: entwurf!.id }, operator.cookie, abgenommen))).toBe(
                "503 terrain_measure_unavailable",
            );
            const measured = await post("/entwurf/messen", { draft: entwurf!.id });
            expect(code(measured)).toBe("200");
            expect((measured.json() as { derivedWork: { kind: string }[] }).derivedWork[0]?.kind).toBe(
                "terrain_preview",
            );
            expect(code(await post("/entwurf/messen", { draft: entwurf!.id }))).toBe("409 terrain_measure_running");
            expect((await get()).entwuerfe[0]?.messung).toMatchObject({ state: "QUEUED", ergebnis: null });
            // Die Messung rechnet nie auf der gültigen Fassung: Der Job trägt nur den Entwurf.
            const [job] = await database<{ input_ref: unknown }[]>`
            SELECT input_ref FROM job WHERE kind = 'terrain_preview' AND state = 'QUEUED' ORDER BY id DESC LIMIT 1
        `;
            expect(job!.input_ref).toEqual({ draft: entwurf!.id });

            expect(code(await post("/entwurf/verwerfen", { draft: entwurf!.id }))).toBe("200");
            expect(code(await post("/entwurf/verwerfen", { draft: entwurf!.id }))).toBe("404 terrain_draft_not_found");
            expect((await get()).entwuerfe).toEqual([]);
        });
    },
);
