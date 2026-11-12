import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    WIKISYNC_AUFTRAGSARTEN,
    WIKISYNC_DUMP_URL,
    WIKISYNC_STAND_URL,
    WIKI_DUMP_HOLEN_ART,
    WIKI_DUMP_HOLEN_PHASEN,
    type WikisyncStand,
} from "@avesmaps3d/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { createSession } from "../src/auth/session-store.ts";
import type { ServerConfig } from "../src/config.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { LEICHTE_ARTEN, istSchwer } from "../src/jobs/dirigent/plan.ts";
import { JOB_HANDLERS } from "../src/jobs/handlers.ts";
import { JOB_KIND_CATALOG, knowsKind } from "../src/jobs/kinds.ts";
import { dumpHolenErlaubt } from "../src/wiki/config.ts";
import { SESSION_COOKIE, TEST_AUTH, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";
import { welt as baueWelt, type Welt } from "./support/schreibwege/welt.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * „Dump holen“ in der Systemsteuerung (WI-0253 §22; Vali 2026-10-27: „das stimmt ja nicht, wir haben ihn heute mittag zusammen geholt“). Wegwerf-Cluster mit den Rollen und Rechten des VPS,
 * Fastify als App-Rolle, die Funktionen des Korridors (`job_sync_claim_id`, `job_sync_phase`, `job_sync_finish`) als Jobs-Rolle. 🔴 Kein Test fragt das Wiki, holt einen Dump oder berührt
 * eine Datei: Die Route reiht nur einen Auftrag ein, den in der App niemand ausführt.
 *
 * - **Soll:** Der Betreiber reiht auf Stage und Production den Auftrag ein; der Stand nennt ihn („wartet auf die Abholung“), seine Stufe und am Ende das Ergebnis des Betriebs.
 * - **Problemfälle:** kein Recht, lokal, kein echtes Release, kein Dump-Ordner, ein zweiter Klick neben dem ersten (auch zwei zugleich), der frische Passkey nur in Production, ein Holen, das
 *   scheitert oder abgebrochen wird.
 */

const ENV = "wikisyncdumpholen";
const DB_ORDNER = fileURLToPath(new URL("../src/db/", import.meta.url));
const VORLAGEN = readdirSync(DB_ORDNER)
    .filter((name) => name.endsWith(".psql"))
    .sort()
    .map((name) => join(DB_ORDNER, name));
const describeWithCluster = postgresBin ? describe : describe.skip;

const config: ServerConfig = {
    port: 0,
    host: "127.0.0.1",
    releaseId: "wi0253-dump-holen-test",
    databaseUrl: undefined,
    tileRoot: undefined,
    statusPage: true,
    auth: TEST_AUTH,
};
const PRODUKTION_AUTH = { ...TEST_AUTH, environment: "production" } as const;

describe("Dump holen: die Jobart und der Schlüssel der Umgebung", () => {
    it("🔴 die Art ist im Katalog, gehört der Warteschlange, hat in der App KEINEN Handler und ist schwer (den Abholer stellt der Korridor)", () => {
        expect(JOB_KIND_CATALOG[WIKI_DUMP_HOLEN_ART]).toMatchObject({
            kind: "wiki_dump_holen",
            version: 1,
            origin: "queued",
            holdsSharedDomainLock: false,
            phases: WIKI_DUMP_HOLEN_PHASEN,
        });
        expect(knowsKind(WIKI_DUMP_HOLEN_ART, 1)).toBe(true);
        // Wie production_pull und abzug_lokal: Die Anwendung holt nichts selbst; ein verirrter Auftrag endete mit no_handler.
        expect(JOB_HANDLERS[WIKI_DUMP_HOLEN_ART]).toBeUndefined();
        // Schwer, weil der Wrapper seine Liste der leichten Arten gleich hält (Korridor-Test C6p).
        expect(LEICHTE_ARTEN.has(WIKI_DUMP_HOLEN_ART)).toBe(false);
        expect(istSchwer(WIKI_DUMP_HOLEN_ART)).toBe(true);
        // Der Reiter zeigt ihn als wartenden oder laufenden Auftrag.
        expect(WIKISYNC_AUFTRAGSARTEN).toContain(WIKI_DUMP_HOLEN_ART);
    });

    it("die Erlaubnis ist reine Rechnung auf der Umgebung: nur Stage und Production, nur mit echtem Release, nur mit Dump-Ordner (der Takt gehört nicht dazu)", () => {
        const stage = {
            AVESMAPS_ENV: "staging",
            RELEASE_ID: "abc1234",
            WIKI_DUMP_ROOT: "/var/lib/avesmaps3d/wiki/dump",
        };
        expect(dumpHolenErlaubt(stage, "linux")).toEqual({ erlaubt: true });
        expect(dumpHolenErlaubt({ ...stage, AVESMAPS_ENV: "production" }, "linux")).toEqual({ erlaubt: true });
        // Lokal und im Test nie, auch nicht mit Release.
        for (const umgebung of ["development", "test", undefined]) {
            const urteil = dumpHolenErlaubt(
                {
                    ...stage,
                    ...(umgebung === undefined ? {} : { AVESMAPS_ENV: umgebung }),
                    ...(umgebung === undefined ? { AVESMAPS_ENV: "" } : {}),
                },
                "linux",
            );
            expect(urteil, String(umgebung)).toMatchObject({ erlaubt: false, grund: "umgebung" });
        }
        // Ein Release `dev` (oder keins) zählt nicht, auch nicht mit AVESMAPS_ENV=production.
        expect(dumpHolenErlaubt({ ...stage, AVESMAPS_ENV: "production", RELEASE_ID: "dev" }, "linux")).toMatchObject({
            erlaubt: false,
            grund: "release",
        });
        expect(dumpHolenErlaubt({ AVESMAPS_ENV: "staging", WIKI_DUMP_ROOT: "/x" }, "linux")).toMatchObject({
            erlaubt: false,
            grund: "release",
        });
        // Ohne Dump-Ordner gäbe es keinen Ort für die Datei (auf Windows gilt der lokale Ordner, aber dort gibt es die Umgebung ohnehin nicht).
        expect(dumpHolenErlaubt({ AVESMAPS_ENV: "staging", RELEASE_ID: "abc1234" }, "linux")).toMatchObject({
            erlaubt: false,
            grund: "ordner",
        });
        // Der Takt ist kein Grund: Den Dump holt der Korridor, nicht der Client der App.
        expect(dumpHolenErlaubt(stage, "linux").erlaubt).toBe(true);
    });
});

describeWithCluster("Dump holen: Route, Stand und Korridor (Wegwerf-Cluster, Rollen wie auf dem VPS)", () => {
    let cluster: VpsCluster | undefined;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    let produktion: FastifyInstance;
    let welt: Welt;
    let weltProduktion: Welt;
    let ordner = "";

    const admin = () => cluster!.admin;

    /** Die Umgebung eines Stage-Prozesses für die Dauer EINES Aufrufs; danach wie vorher. */
    async function mitUmgebung<T>(werte: Record<string, string | undefined>, arbeit: () => Promise<T>): Promise<T> {
        const alt = Object.keys(werte).map((name) => [name, process.env[name]] as const);
        for (const [name, wert] of Object.entries(werte)) {
            if (wert === undefined) delete process.env[name];
            else process.env[name] = wert;
        }
        try {
            return await arbeit();
        } finally {
            for (const [name, wert] of alt) {
                if (wert === undefined) delete process.env[name];
                else process.env[name] = wert;
            }
        }
    }
    const alsStage = <T>(arbeit: () => Promise<T>): Promise<T> =>
        mitUmgebung({ AVESMAPS_ENV: "staging", RELEASE_ID: "dump-holen-test", WIKI_DUMP_ROOT: ordner }, arbeit);

    const holen = (cookie: string | undefined, operationId: string = randomUUID(), seite: Welt = welt) =>
        seite.post(WIKISYNC_DUMP_URL, cookie, { operationId });
    const auftraege = () =>
        admin()<
            {
                public_id: string;
                state: string;
                actor_ref: string | null;
                input_ref: Record<string, unknown>;
                scope_kind: string;
            }[]
        >`SELECT public_id::text AS public_id, state, actor_ref, input_ref, scope_kind FROM job WHERE kind = ${WIKI_DUMP_HOLEN_ART} ORDER BY id`;
    const ereignisse = () =>
        admin()<{ target_ref: string; details: Record<string, unknown> }[]>`
            SELECT target_ref, details FROM avesmaps_auth.security_event WHERE action = 'system.wikisync_dump_holen_angestossen' ORDER BY id
        `;
    async function stand(cookie: string): Promise<WikisyncStand> {
        const antwort = await alsStage(() =>
            app.inject({ method: "GET", url: WIKISYNC_STAND_URL, headers: { host: "avesmaps.test", cookie } }),
        );
        expect(antwort.statusCode, antwort.body).toBe(200);
        return antwort.json() as WikisyncStand;
    }
    /** Was Claudios Korridor tut: den Auftrag übernehmen, Stufen melden, beenden (als Jobs-Rolle, wie der Wrapper über `corridor-jobs`). */
    const nummer = async (publicId: string): Promise<number> =>
        Number((await admin()<{ id: string }[]>`SELECT id::text FROM job WHERE public_id = ${publicId}::uuid`)[0]!.id);
    const uebernehmen = async (publicId: string): Promise<string | null> =>
        (
            await cluster!.jobs<
                { uuid: string | null }[]
            >`SELECT job_sync_claim_id(${await nummer(publicId)}::bigint, 120) AS uuid`
        )[0]!.uuid;
    const stufe = async (publicId: string, phase: string): Promise<boolean> =>
        (await cluster!.jobs<{ ok: boolean }[]>`SELECT job_sync_phase(${publicId}::uuid, ${phase}, '') AS ok`)[0]!.ok;
    const beenden = async (publicId: string, ergebnis: "ok" | "failed" | "skipped", satz: string): Promise<boolean> =>
        (
            await cluster!.jobs<
                { ok: boolean }[]
            >`SELECT job_sync_finish(${publicId}::uuid, ${ergebnis}, ${satz}) AS ok`
        )[0]!.ok;

    /** Ein Betreiber in Production, dessen Passkey vor so vielen Minuten bestätigt wurde. */
    async function produktionsBetreiber(passkeyVorMinuten: number): Promise<string> {
        const person = await fixture.person("operator");
        await admin()`INSERT INTO avesmaps_auth.person_access (person_id, environment, role) VALUES (${person.id}, 'production', 'operator')`;
        const { id, token } = await createSession(admin(), PRODUKTION_AUTH, {
            personId: person.id,
            environment: "production",
            method: "discord",
            assurance: "strong",
        });
        await admin()`
            UPDATE avesmaps_auth.session SET passkey_confirmed_at = now() - make_interval(mins => ${passkeyVorMinuten}) WHERE id = ${id}
        `;
        return `${SESSION_COOKIE}=${token}`;
    }

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, VORLAGEN);
        await seedMapDomains(cluster.migrator);
        ordner = await mkdtemp(join(tmpdir(), "wikisync-dump-holen-"));
        fixture = authFixture(cluster.admin);
        const bau = (auth: ServerConfig["auth"]): FastifyInstance =>
            buildApp({
                config: { ...config, auth },
                database: cluster!.app,
                logStream: { write: () => undefined },
                jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            });
        app = bau(TEST_AUTH);
        produktion = bau(PRODUKTION_AUTH);
        await Promise.all([app.ready(), produktion.ready()]);
        welt = baueWelt(cluster, app, fixture, ordner);
        weltProduktion = baueWelt(cluster, produktion, fixture, ordner);
    }, 240_000);
    afterAll(async () => {
        await app?.close();
        await produktion?.close();
        await fixture?.cleanup();
        await cluster?.stop();
        if (ordner !== "") await rm(ordner, { recursive: true, force: true });
    }, 60_000);
    beforeEach(async () => {
        await admin()`DELETE FROM job WHERE kind = ${WIKI_DUMP_HOLEN_ART}`;
    });

    it("🔴 Recht: nur der Betreiber, mit zweitem Faktor; ohne Anmeldung 401, Tester, Editor und Admin 403, kein Auftrag", async () => {
        const tester = await welt.jemand("tester");
        const editor = await welt.jemand("editor", { frisch: true, passkey: true });
        const adminPerson = await welt.jemand("admin", { frisch: true, passkey: true });
        const ohneFaktor = await welt.jemand("operator", { sitzung: { assurance: "basic", passkeyMinutesAgo: null } });
        await alsStage(async () => {
            expect((await holen(undefined)).statusCode).toBe(401);
            expect((await holen(tester.cookie)).statusCode).toBe(403);
            expect((await holen(editor.cookie)).statusCode).toBe(403);
            expect((await holen(adminPerson.cookie)).statusCode).toBe(403);
            expect((await holen(ohneFaktor.cookie)).statusCode).toBe(403);
        });
        expect(await auftraege()).toEqual([]);
    });

    it("🔴 gesperrt, wo es keinen Abholer gibt: lokal, ohne echtes Release; 409 mit Grund und kein Auftrag; der Stand sagt es", async () => {
        const betreiber = await welt.jemand("operator");
        // Lokal: kein AVESMAPS_ENV, nichts eingereiht.
        const lokal = await mitUmgebung({ AVESMAPS_ENV: undefined, RELEASE_ID: undefined }, () =>
            holen(betreiber.cookie),
        );
        expect(lokal.statusCode).toBe(409);
        expect(lokal.json()).toMatchObject({ error: { code: "abruf_gesperrt", details: { grund: "umgebung" } } });
        // Stage ohne echtes Release (RELEASE_ID dev).
        const ohneRelease = await mitUmgebung(
            { AVESMAPS_ENV: "staging", RELEASE_ID: "dev", WIKI_DUMP_ROOT: ordner },
            () => holen(betreiber.cookie),
        );
        expect(ohneRelease.statusCode).toBe(409);
        expect(ohneRelease.json()).toMatchObject({ error: { code: "abruf_gesperrt", details: { grund: "release" } } });
        expect(await auftraege()).toEqual([]);
        expect(await ereignisse()).toEqual([]);

        const tester = await welt.jemand("tester");
        const lokalStand = await mitUmgebung({ AVESMAPS_ENV: undefined, RELEASE_ID: undefined }, async () => {
            const antwort = await app.inject({
                method: "GET",
                url: WIKISYNC_STAND_URL,
                headers: { host: "avesmaps.test", cookie: tester.cookie },
            });
            return antwort.json() as WikisyncStand;
        });
        expect(lokalStand.dumpHolen).toEqual({ erlaubt: false, grund: "umgebung", letzter: null });
        expect((await stand(tester.cookie)).dumpHolen).toEqual({ erlaubt: true, grund: null, letzter: null });
    });

    it("🔴 Stage: der Betreiber reiht EINEN Auftrag als diese Person ein (Bereich ohne Kacheln), ein Ereignis, der Stand nennt ihn als „wartet auf die Abholung“", async () => {
        const betreiber = await welt.jemand("operator");
        const tester = await welt.jemand("tester");
        const operationId = randomUUID();
        const antwort = await alsStage(() => holen(betreiber.cookie, operationId));
        expect(antwort.statusCode, antwort.body).toBe(200);
        const quittung = antwort.json() as { derivedWork: { kind: string; jobId: string; state: string }[] };
        const eingereiht = await auftraege();
        expect(eingereiht).toHaveLength(1);
        expect(eingereiht[0]).toMatchObject({
            state: "QUEUED",
            actor_ref: betreiber.id,
            input_ref: { ausgeloestVon: betreiber.name },
            scope_kind: "tiles",
        });
        expect(quittung.derivedWork).toEqual([
            { kind: WIKI_DUMP_HOLEN_ART, jobId: eingereiht[0]!.public_id, state: "queued" },
        ]);
        expect(await ereignisse()).toEqual([
            { target_ref: `job:${eingereiht[0]!.public_id}`, details: { job: eingereiht[0]!.public_id } },
        ]);

        const gelesen = await stand(tester.cookie);
        expect(gelesen.auftraege).toEqual([
            expect.objectContaining({
                art: WIKI_DUMP_HOLEN_ART,
                zustand: "QUEUED",
                phase: null,
                fortschritt: null,
                ausgeloestVon: betreiber.name,
                wartetAuf: "abholung",
            }),
        ]);
        expect(gelesen.dumpHolen.letzter).toBeNull();

        // Dieselbe Operation noch einmal: dieselbe Quittung (als Wiederholung gekennzeichnet), kein zweiter Auftrag, kein zweites Ereignis.
        const wieder = await alsStage(() => holen(betreiber.cookie, operationId));
        expect(wieder.statusCode).toBe(200);
        expect(wieder.json()).toEqual({ ...quittung, status: "replayed" });
        expect(await auftraege()).toHaveLength(1);
        expect(await ereignisse()).toHaveLength(1);
    });

    it("🔴 ein zweiter Klick, während ein Holen wartet oder läuft, legt keinen zweiten Auftrag an; auch zwei zugleich nicht", async () => {
        const betreiber = await welt.jemand("operator");
        const zweiter = await welt.jemand("operator");
        await alsStage(async () => {
            const erster = await holen(betreiber.cookie);
            expect(erster.statusCode, erster.body).toBe(200);
            const doppelt = await holen(zweiter.cookie);
            expect(doppelt.statusCode).toBe(409);
            expect(doppelt.json()).toMatchObject({ error: { code: "dump_holen_laeuft" } });
            expect(await auftraege()).toHaveLength(1);

            // Läuft es (der Korridor hat übernommen), bleibt es dabei.
            const [laufend] = await auftraege();
            expect(await uebernehmen(laufend!.public_id)).toBe(laufend!.public_id);
            expect((await holen(zweiter.cookie)).json()).toMatchObject({ error: { code: "dump_holen_laeuft" } });
            expect(await auftraege()).toHaveLength(1);
            await beenden(laufend!.public_id, "ok", "Dump unverändert");
            await admin()`DELETE FROM job WHERE kind = ${WIKI_DUMP_HOLEN_ART}`;

            // Zwei Klicks im selben Augenblick (zwei Sitzungen, zwei Operationen): genau einer kommt durch.
            const beide = await Promise.all([holen(betreiber.cookie), holen(zweiter.cookie)]);
            expect(beide.map((a) => a.statusCode).sort()).toEqual([200, 409]);
            expect(await auftraege()).toHaveLength(1);
        });
    });

    it("🔴 der frische Passkey nur in Production: Stage genügt das Recht, in Production verlangt die Route ihn", async () => {
        // Stage (Umgebung test): eine Sitzung mit altem Passkey genügt.
        const stage = await welt.jemand("operator");
        expect((await alsStage(() => holen(stage.cookie))).statusCode).toBe(200);
        await admin()`DELETE FROM job WHERE kind = ${WIKI_DUMP_HOLEN_ART}`;

        const alt = await produktionsBetreiber(60);
        const frisch = await produktionsBetreiber(1);
        await alsStage(async () => {
            const abgelehnt = await holen(alt, randomUUID(), weltProduktion);
            expect(abgelehnt.statusCode).toBe(403);
            expect(abgelehnt.json()).toMatchObject({ error: { code: "reauth_required" } });
            expect(await auftraege()).toEqual([]);
            const ok = await holen(frisch, randomUUID(), weltProduktion);
            expect(ok.statusCode, ok.body).toBe(200);
            expect(await auftraege()).toHaveLength(1);
        });
    });

    it("🔴 der Weg des Korridors: wartet, übernommen, Stufen mit dem Fortschritt der Tafel, am Ende das Ergebnis des Betriebs im Stand; danach geht der nächste Klick wieder", async () => {
        const betreiber = await welt.jemand("operator");
        const tester = await welt.jemand("tester");
        await alsStage(async () => {
            expect((await holen(betreiber.cookie)).statusCode).toBe(200);
            const [auftrag] = await auftraege();
            const id = auftrag!.public_id;

            // Übernommen: Der Stand zeigt ihn als laufend, noch ohne Stufe.
            expect(await uebernehmen(id)).toBe(id);
            expect((await stand(tester.cookie)).auftraege).toEqual([
                expect.objectContaining({
                    art: WIKI_DUMP_HOLEN_ART,
                    zustand: "RUNNING",
                    phase: null,
                    fortschritt: null,
                }),
            ]);
            // Jede Stufe der Tafel in `shared` ist auch die der Datenbankfunktion (zwei Orte, ein Wert).
            for (const { name, progress } of WIKI_DUMP_HOLEN_PHASEN) {
                expect(await stufe(id, name), name).toBe(true);
                const [laufend] = (await stand(tester.cookie)).auftraege;
                expect(laufend).toMatchObject({ zustand: "RUNNING", phase: name });
                expect(laufend!.fortschritt).toBeCloseTo(progress, 5);
            }
            // Ende gut: der Satz des Betriebs steht im Stand, der Auftrag nicht mehr unter den laufenden.
            expect(
                await beenden(id, "ok", "Dump geholt (dewa_dump_small-20261027T112915.xml.bz2, 47703643 Bytes, 11 s)"),
            ).toBe(true);
            const fertig = await stand(tester.cookie);
            expect(fertig.auftraege).toEqual([]);
            expect(fertig.dumpHolen.letzter).toEqual({
                status: "fertig",
                beendetAm: expect.any(String),
                ausgeloestVon: betreiber.name,
                meldung: "Dump geholt (dewa_dump_small-20261027T112915.xml.bz2, 47703643 Bytes, 11 s)",
            });

            // Der nächste Klick geht wieder; es scheitert, mit Grund.
            expect((await holen(betreiber.cookie)).statusCode).toBe(200);
            const zweiter = (await auftraege()).find((a) => a.state === "QUEUED")!;
            expect(await uebernehmen(zweiter.public_id)).toBe(zweiter.public_id);
            expect(await beenden(zweiter.public_id, "failed", "Dump nicht geholt: HTTP 401 (Zugang falsch)")).toBe(
                true,
            );
            expect((await stand(tester.cookie)).dumpHolen.letzter).toMatchObject({
                status: "fehlgeschlagen",
                ausgeloestVon: betreiber.name,
                meldung: "Dump nicht geholt: HTTP 401 (Zugang falsch)",
            });

            // Und ein abgebrochenes: ohne Satz bleibt `meldung` leer (die Oberfläche sagt dann „ohne genannten Grund“).
            expect((await holen(betreiber.cookie)).statusCode).toBe(200);
            const dritter = (await auftraege()).find((a) => a.state === "QUEUED")!;
            expect(await uebernehmen(dritter.public_id)).toBe(dritter.public_id);
            expect(await beenden(dritter.public_id, "skipped", "")).toBe(true);
            expect((await stand(tester.cookie)).dumpHolen.letzter).toMatchObject({
                status: "abgebrochen",
                meldung: null,
            });
        });
    });

    it("die Tür der App-Rolle kennt die Art, die Funktionen des Korridors nur für die Jobs-Rolle; eine andere Art bleibt draußen", async () => {
        // Die App-Rolle reiht ein (SECURITY DEFINER), übernehmen darf sie nicht.
        const [eingereiht] = await cluster!.app<{ public_id: string }[]>`
            SELECT public_id::text AS public_id
              FROM job_enqueue(${WIKI_DUMP_HOLEN_ART}, 1::smallint, 'aventuria', NULL, '{}'::jsonb, 50::smallint, NULL, 'tiles', '{}'::smallint[])
        `;
        expect(eingereiht!.public_id).toMatch(/^[0-9a-f]{8}-/u);
        await expect(
            cluster!.app`SELECT job_sync_claim_id(${await nummer(eingereiht!.public_id)}::bigint, 120)`,
        ).rejects.toThrow(/permission denied|keine Berechtigung/iu);
        await expect(
            cluster!
                .app`SELECT * FROM job_enqueue('wiki_dump_holen_gibt_es_nicht', 1::smallint, 'aventuria', NULL, '{}'::jsonb)`,
        ).rejects.toThrow(/darf die Anwendung nicht einreihen/u);
    });
});
