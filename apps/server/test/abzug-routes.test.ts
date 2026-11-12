import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    ABZUG_JOB_ART,
    ABZUG_PHASEN,
    ABZUG_URL,
    type AbzugEingang,
    type AbzugLink,
    type AbzugSicht,
    type AbzugSichtEinspielen,
    type AbzugSichtErstellen,
    type OperationReceipt,
    type Role,
} from "@avesmaps3d/shared";
import { erzeugeLinkspeicher } from "../src/abzug/links.ts";
import { leseKatalog } from "../src/abzug/katalog.ts";
import type { MedienErgebnis } from "../src/abzug/medien.ts";
import { baueAbzugPlan } from "../src/abzug/plan.ts";
import { ladeRegeln } from "../src/abzug/regeln.ts";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { schreibeAbzug } from "./support/abzug-export.ts";
import { testJobsConfig } from "./support/jobs-support.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Der Abzug für lokal, die Routen (WI-0251) auf dem Wegwerf-Cluster mit App- und Jobs-Rolle:
 *
 * - **Stage/Production** (`erstellen`): „Abzug erstellen“ reiht den Auftrag `abzug_lokal` ein (Admin mit frischem Passkey, ein Ereignis,
 *   nie zwei zugleich); die Liste zeigt nur gültige, nicht abgelaufene Abzüge der eigenen Umgebung; „Herunterladen“ stellt einen Link aus
 *   (Ereignis `backup.downloaded`), der genau einmal gilt und nur für diese Person; der Korridor übernimmt den Auftrag mit den Stufen des
 *   Fortschritts aus Migration 0218.
 * - **Lokal** (`einspielen`): Die Datei kommt als Strom in den Eingang und wird gegen die Datenbank geprüft; einspielen darf nur der Betreiber
 *   mit frischem Passkey und nur, wenn die Prüfung bestanden ist und es eine Sicherung geben kann; ein zweiter Lauf zugleich und eine neue
 *   Datei währenddessen werden abgewiesen. Das Ersetzen selbst ist hier ein Ersatz (`abzug-einspielen.test.ts` testet das echte).
 */

const ENV = "abzugroute";
const grants = [
    fileURLToPath(new URL("../src/db/system-grants.psql", import.meta.url)),
    fileURLToPath(new URL("../src/db/jobs-grants.psql", import.meta.url)),
];
const describeWithCluster = postgresBin ? describe : describe.skip;

const code = (response: { statusCode: number; json(): unknown }): string =>
    response.statusCode < 300
        ? String(response.statusCode)
        : `${String(response.statusCode)} ${(response.json() as { error: { code: string } }).error.code}`;

describe("Abzug: kurzlebige Links (ohne Datenbank)", () => {
    it("gilt einmal, nur für die Person und nur kurz", () => {
        let jetzt = 1_000_000;
        const speicher = erzeugeLinkspeicher(() => jetzt);
        const a = speicher.ausstellen("person-a", "staging", "abzug-1");
        expect(speicher.einloesen(a.token, "person-b")).toBeNull(); // falsche Person: der Link ist trotzdem verbraucht
        expect(speicher.einloesen(a.token, "person-a")).toBeNull();
        const b = speicher.ausstellen("person-a", "production", "abzug-2");
        expect(speicher.einloesen(b.token, "person-a")).toEqual({ quelle: "production", kennung: "abzug-2" });
        expect(speicher.einloesen(b.token, "person-a")).toBeNull();
        const c = speicher.ausstellen("person-a", "staging", "abzug-3");
        jetzt += 121_000;
        expect(speicher.einloesen(c.token, "person-a")).toBeNull();
        expect(speicher.einloesen("unbekannt", "person-a")).toBeNull();
        // Nicht der Wert wird gespeichert, und viele Links verdrängen die ältesten statt den Speicher zu füllen.
        for (let n = 0; n < 200; n += 1) speicher.ausstellen("person-a", "staging", `abzug-${String(n)}`);
        expect(speicher.einloesen(a.token, "person-a")).toBeNull();
    });
});

describeWithCluster("Abzug für lokal: Routen (Wegwerf-Cluster)", () => {
    let cluster: VpsCluster | undefined;
    let fixture: AuthFixture;
    let wurzel: string;
    let stage: FastifyInstance;
    let lokal: FastifyInstance;
    let lokalOhneDump: FastifyInstance;
    let ohneAblage: FastifyInstance;
    let operator: { cookie: string; id: string };
    let andererOperator: { cookie: string };
    let admin: { cookie: string };
    let adminAlt: { cookie: string };
    let editor: { cookie: string };
    let tarBytes: Buffer;
    let aufrufe: { tarPfad: string }[];
    let blockiert: Promise<void> | undefined;
    /** Was der Ersatz für das Einspielen über die Mediendateien meldet; `offen > 0` lässt die Datei im Eingang liegen. */
    let medienErgebnis: MedienErgebnis;
    const KEINE_MEDIEN: MedienErgebnis = {
        dateien: 0,
        geschrieben: 0,
        vorhanden: 0,
        offen: 0,
        bytes: 0,
        ersterFehler: null,
    };

    const basis = (): Omit<ServerConfig, "abzug"> => ({
        port: 0,
        host: "127.0.0.1",
        releaseId: "wi0251-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        auth: TEST_AUTH,
    });

    async function abzugDatei(
        wo: string,
        quelle: "staging" | "production",
        kennung: string,
        erstellt: Date,
    ): Promise<Buffer> {
        const katalog = await leseKatalog(cluster!.migrator);
        const plan = baueAbzugPlan(katalog, ladeRegeln(), quelle);
        const ordner = join(wo, quelle, kennung);
        await mkdir(ordner, { recursive: true });
        const ziel = join(ordner, "abzug.tar");
        await schreibeAbzug(cluster!.migrator, plan, {
            ziel,
            kennung,
            quelle,
            veraendereManifest: (manifest) => ({ ...manifest, erstellt: erstellt.toISOString() }),
        });
        return await readFile(ziel);
    }

    const post = (app: FastifyInstance, url: string, cookie: string, payload: object = {}) =>
        app.inject({
            method: "POST",
            url,
            payload: { operationId: randomUUID(), ...payload },
            headers: { origin: TEST_ORIGIN, cookie },
        });
    const get = (app: FastifyInstance, url: string, cookie: string) =>
        app.inject({ method: "GET", url, headers: { cookie } });
    const hochladen = (app: FastifyInstance, cookie: string, inhalt: Buffer, name = "abzug.tar") =>
        app.inject({
            method: "PUT",
            url: `${ABZUG_URL}/eingang?name=${encodeURIComponent(name)}&operationId=${randomUUID()}`,
            payload: inhalt,
            headers: { origin: TEST_ORIGIN, cookie, "content-type": "application/x-tar" },
        });
    const ereignisse = async (
        aktion: string,
    ): Promise<{ target_ref: string | null; details: Record<string, unknown> }[]> =>
        await cluster!
            .admin`SELECT target_ref, details FROM avesmaps_auth.security_event WHERE action = ${aktion} ORDER BY id`;

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, grants);
        await seedMapDomains(cluster.migrator);
        fixture = authFixture(cluster.admin);
        wurzel = await mkdtemp(join(tmpdir(), "abzugroute-"));
        const stageWurzel = join(wurzel, "stage");
        const lokalWurzel = join(wurzel, "lokal");
        tarBytes = await abzugDatei(
            stageWurzel,
            "staging",
            "20261024T100000Z-aktuell",
            new Date(Date.now() - 3_600_000),
        );
        aufrufe = [];
        medienErgebnis = KEINE_MEDIEN;
        const attrappe = async (optionen: { tarPfad: string }) => {
            aufrufe.push({ tarPfad: optionen.tarPfad });
            await blockiert;
            return {
                kennung: "20261024T100000Z-aktuell",
                tafeln: 143,
                zeilen: 7,
                sicherung: "vorher-test.dump",
                medien: medienErgebnis,
            };
        };
        const bauen = (abzug: ServerConfig["abzug"], database: VpsCluster["app"]) =>
            buildApp({
                config: { ...basis(), databaseUrl: "postgres://ungenutzt@127.0.0.1/ungenutzt", abzug },
                database,
                logStream: { write: () => undefined },
                jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            });
        stage = bauen({ rollen: ["erstellen"], quelle: "staging", wurzel: stageWurzel }, cluster.app);
        ohneAblage = bauen({ rollen: ["erstellen"], quelle: "staging", wurzel: undefined }, cluster.app);
        // Lokal läuft der Server als Besitzerin der Tafeln (Entwicklungsrechner), darum hier die Migrationsrolle.
        lokal = bauen(
            {
                rollen: ["einspielen"],
                quelle: undefined,
                wurzel: lokalWurzel,
                abgleicheVerbergen: true,
                pgDump: postgresBin,
                einspielen: attrappe,
            },
            cluster.migrator,
        );
        lokalOhneDump = bauen(
            {
                rollen: ["einspielen"],
                quelle: undefined,
                wurzel: join(wurzel, "lokal2"),
                pgDump: null,
                einspielen: attrappe,
            },
            cluster.migrator,
        );
        await Promise.all([stage.ready(), ohneAblage.ready(), lokal.ready(), lokalOhneDump.ready()]);
        const person = async (role: Role, name: string, passkeyMinutesAgo: number | null = 1) => {
            const created = await fixture.person(role, { name });
            const { cookie } = await fixture.session(created.id, { assurance: "strong", passkeyMinutesAgo });
            return { cookie, id: created.id };
        };
        operator = await person("operator", "Rondrikan");
        andererOperator = await person("operator", "Praiosmin");
        admin = await person("admin", "Alrike");
        adminAlt = await person("admin", "Alt", 120);
        editor = await person("editor", "Efferdan");
    }, 240_000);

    beforeEach(async () => {
        await cluster!.migrator`DELETE FROM job WHERE kind = ${ABZUG_JOB_ART}`;
        blockiert = undefined;
        medienErgebnis = KEINE_MEDIEN;
        aufrufe.length = 0;
        await rm(join(wurzel, "lokal"), { recursive: true, force: true });
    });

    afterAll(async () => {
        await Promise.all([stage?.close(), ohneAblage?.close(), lokal?.close(), lokalOhneDump?.close()]);
        await cluster?.stop();
        await rm(wurzel, { recursive: true, force: true });
    }, 60_000);

    it("🔴 die Liste zeigt nur gültige, nicht abgelaufene Abzüge dieser Umgebung, und nur mit dem Recht", async () => {
        const stageWurzel = join(wurzel, "stage");
        // Abgelaufen, kaputt, fremde Umgebung im falschen Ordner, halb geschrieben: keiner davon zählt.
        await abzugDatei(stageWurzel, "staging", "20261023T080000Z-alt", new Date(Date.now() - 30 * 3_600_000));
        await mkdir(join(stageWurzel, "staging", "20261024T090000Z-kaputt"), { recursive: true });
        await writeFile(join(stageWurzel, "staging", "20261024T090000Z-kaputt", "abzug.tar"), "kein Tar".repeat(100));
        await mkdir(join(stageWurzel, "staging", "20261024T090500Z-halb"), { recursive: true });
        await writeFile(join(stageWurzel, "staging", "20261024T090500Z-halb", "abzug.tar.part"), "halb");
        await abzugDatei(stageWurzel, "production", "20261024T095000Z-fremd", new Date());
        await abzugDatei(join(wurzel, "falsch"), "production", "20261024T100000Z-aktuell", new Date());
        await mkdir(join(stageWurzel, "staging", "20261024T100000Z-falschordner"), { recursive: true });
        await writeFile(join(stageWurzel, "staging", "20261024T100000Z-falschordner", "abzug.tar"), tarBytes);

        const antwort = await get(stage, ABZUG_URL, admin.cookie);
        expect(code(antwort)).toBe("200");
        const sicht = antwort.json<AbzugSicht>() as AbzugSichtErstellen;
        expect(sicht).toMatchObject({
            rolle: "erstellen",
            umgebung: "staging",
            ablage: true,
            laufend: null,
            letzter: null,
        });
        expect(sicht.abzuege.map((datei) => datei.kennung)).toEqual(["20261024T100000Z-aktuell"]);
        const datei = sicht.abzuege[0]!;
        expect(datei.bytes).toBe(tarBytes.length);
        expect(datei.tafeln).toBeGreaterThan(100);
        expect(datei).toMatchObject({ medien: 0, medienBytes: 0 });
        expect(new Date(datei.laeuftAb).getTime() - new Date(datei.erstellt).getTime()).toBe(24 * 3_600_000);
        // Ohne das Recht gibt es nichts zu sehen.
        expect(code(await get(stage, ABZUG_URL, editor.cookie))).toBe("403 forbidden");
        expect(code(await get(stage, ABZUG_URL, ""))).toBe("401 unauthenticated");
        // Ohne Ablage: kein Fehler, die Oberfläche sperrt den Knopf.
        expect((await get(ohneAblage, ABZUG_URL, admin.cookie)).json<AbzugSichtErstellen>()).toMatchObject({
            ablage: false,
            abzuege: [],
        });
    });

    it("🔴 „Abzug erstellen“ reiht genau einen Auftrag ein: Admin mit frischem Passkey, ein Ereignis, kein zweiter, ohne Ablage nicht", async () => {
        const vorher = (await ereignisse("backup.requested")).length;
        expect(code(await post(stage, `${ABZUG_URL}/erstellen`, editor.cookie))).toBe("403 forbidden");
        expect(code(await post(stage, `${ABZUG_URL}/erstellen`, adminAlt.cookie))).toBe("403 reauth_required");
        expect(code(await post(ohneAblage, `${ABZUG_URL}/erstellen`, admin.cookie))).toBe("503 abzug_ablage_fehlt");

        const antwort = await post(stage, `${ABZUG_URL}/erstellen`, admin.cookie);
        expect(code(antwort)).toBe("200");
        const jobId = antwort.json<OperationReceipt>().derivedWork[0]!.jobId!;
        const [job] = await cluster!.admin<
            { kind: string; scope_kind: string; input_ref: Record<string, unknown>; state: string }[]
        >`
            SELECT kind, scope_kind, input_ref, state FROM job WHERE public_id = ${jobId}::uuid
        `;
        expect(job).toMatchObject({
            kind: ABZUG_JOB_ART,
            scope_kind: "tiles",
            state: "QUEUED",
            input_ref: { quelle: "staging" },
        });
        const protokoll = await ereignisse("backup.requested");
        expect(protokoll).toHaveLength(vorher + 1);
        expect(protokoll.at(-1)?.target_ref).toBe(`job:${jobId}`);

        // Solange er wartet, kein zweiter, und die Liste zeigt den Auftrag samt Grund.
        expect(code(await post(stage, `${ABZUG_URL}/erstellen`, admin.cookie))).toBe("409 abzug_laeuft");
        const sicht = (await get(stage, ABZUG_URL, admin.cookie)).json<AbzugSichtErstellen>();
        expect(sicht.laufend).toMatchObject({ jobId, state: "QUEUED" });
        expect(sicht.laufend?.ausgeloest.art).toBe("person");
    });

    it("🔴 der Korridor übernimmt den Auftrag, meldet die Stufen mit Anteilen aus Migration 0218 und beendet ihn", async () => {
        const antwort = await post(stage, `${ABZUG_URL}/erstellen`, admin.cookie);
        const publicId = antwort.json<OperationReceipt>().derivedWork[0]!.jobId!;
        const [zeile] = await cluster!.admin<
            { id: string }[]
        >`SELECT id::text AS id FROM job WHERE public_id = ${publicId}::uuid`;
        const alsJobs = <T>(work: (sql: VpsCluster["admin"]) => Promise<T>) =>
            cluster!.admin.begin(async (tx) => {
                await tx.unsafe(`SET LOCAL ROLE ${cluster!.roles.jobs}`);
                return work(tx as unknown as VpsCluster["admin"]);
            }) as Promise<T>;
        const geholt = await alsJobs(
            async (sql) =>
                (
                    await sql<
                        { uuid: string | null }[]
                    >`SELECT job_sync_claim_id(${zeile!.id}::bigint, 600)::text AS uuid`
                )[0]!.uuid,
        );
        expect(geholt).toBe(publicId);
        const fortschritt = async (phase: string): Promise<number> => {
            await alsJobs((sql) => sql`SELECT job_sync_phase(${publicId}::uuid, ${phase}, '')`);
            const [job] = await cluster!.admin<
                { progress: number }[]
            >`SELECT progress::float8 AS progress FROM job WHERE public_id = ${publicId}::uuid`;
            return job!.progress;
        };
        // Die Anteile in der Datenbankfunktion sind die der Tafel in shared.
        for (const phase of ABZUG_PHASEN) expect(await fortschritt(phase.name)).toBeCloseTo(phase.progress, 5);
        const laufend = (await get(stage, ABZUG_URL, admin.cookie)).json<AbzugSichtErstellen>().laufend;
        expect(laufend).toMatchObject({ state: "RUNNING", phase: "ablegen" });
        expect(laufend?.progress).toBeCloseTo(0.95, 5);
        const beendet = await alsJobs(
            async (sql) =>
                (
                    await sql<
                        { ok: boolean }[]
                    >`SELECT job_sync_finish(${publicId}::uuid, 'ok', 'Abzug 20261024T100000Z-aktuell') AS ok`
                )[0]!.ok,
        );
        expect(beendet).toBe(true);
        const nachher = (await get(stage, ABZUG_URL, admin.cookie)).json<AbzugSichtErstellen>();
        expect(nachher.laufend).toBeNull();
        expect(nachher.letzter).toMatchObject({ jobId: publicId, state: "SUCCEEDED" });
        // Jetzt darf der nächste kommen.
        expect(code(await post(stage, `${ABZUG_URL}/erstellen`, admin.cookie))).toBe("200");
    });

    it("🔴 „Herunterladen“ stellt einen Link aus (ein Ereignis), der genau einmal gilt und nur für diese Person", async () => {
        const kennung = "20261024T100000Z-aktuell";
        const vorher = (await ereignisse("backup.downloaded")).length;
        expect(code(await post(stage, `${ABZUG_URL}/link`, adminAlt.cookie, { kennung }))).toBe("403 reauth_required");
        expect(
            code(await post(stage, `${ABZUG_URL}/link`, admin.cookie, { kennung: "20261024T000000Z-gibtesnicht" })),
        ).toBe("404 abzug_unbekannt");
        expect(code(await post(stage, `${ABZUG_URL}/link`, admin.cookie, { kennung: "../../etc" }))).toBe(
            "400 validation_failed",
        );

        const antwort = await post(stage, `${ABZUG_URL}/link`, admin.cookie, { kennung });
        expect(code(antwort)).toBe("200");
        const link = antwort.json<AbzugLink>();
        expect(link.url).toMatch(new RegExp(`^${ABZUG_URL}/datei/[A-Za-z0-9_-]{43}$`, "u"));
        expect(link.dateiname).toBe(`avesmaps-abzug-staging-${kennung}.tar`);
        expect(new Date(link.gueltigBis).getTime() - Date.now()).toBeLessThanOrEqual(120_000);
        const protokoll = await ereignisse("backup.downloaded");
        expect(protokoll).toHaveLength(vorher + 1);
        expect(protokoll.at(-1)?.details).toEqual({ name: link.dateiname });

        // Eine andere Person kann den Link nicht lösen, und er ist damit auch für die Eigentümerin verbraucht (kein Raten, kein Teilen).
        expect(code(await get(stage, link.url, andererOperator.cookie))).toBe("410 abzug_link_ungueltig");
        expect(code(await get(stage, link.url, admin.cookie))).toBe("410 abzug_link_ungueltig");

        const zweiter = (await post(stage, `${ABZUG_URL}/link`, admin.cookie, { kennung })).json<AbzugLink>();
        const datei = await get(stage, zweiter.url, admin.cookie);
        expect(code(datei)).toBe("200");
        expect(datei.headers["content-type"]).toBe("application/x-tar");
        expect(datei.headers["content-disposition"]).toBe(`attachment; filename="${link.dateiname}"`);
        expect(datei.headers["cache-control"]).toBe("no-store");
        expect(createHash("sha256").update(datei.rawPayload).digest("hex")).toBe(
            createHash("sha256").update(tarBytes).digest("hex"),
        );
        // Ein zweites Mal: derselbe Link ist weg.
        expect(code(await get(stage, zweiter.url, admin.cookie))).toBe("410 abzug_link_ungueltig");
        // Ohne Anmeldung geht auch ein gültiger Link nicht, und der Versuch verbraucht ihn nicht.
        const dritter = (await post(stage, `${ABZUG_URL}/link`, admin.cookie, { kennung })).json<AbzugLink>();
        expect(code(await get(stage, dritter.url, ""))).toBe("401 unauthenticated");
        // Verschwindet die Datei (Claudio löscht nach 24 Stunden), sagt der Link es.
        const pfad = join(wurzel, "stage", "staging", kennung, "abzug.tar");
        const alt = await readFile(pfad);
        await rm(pfad);
        expect(code(await get(stage, dritter.url, admin.cookie))).toBe("404 abzug_unbekannt");
        await writeFile(pfad, alt);
    });

    it("🔴 lokal: Datei als Strom in den Eingang, gegen die Datenbank geprüft; Unsinn und fremde Dateinamen werden abgewiesen", async () => {
        const leer = (await get(lokal, ABZUG_URL, admin.cookie)).json<AbzugSichtEinspielen>();
        expect(leer).toMatchObject({ rolle: "einspielen", ablage: true, sicherung: true, eingang: null, lauf: null });
        // Lokal steht im Datenabgleich allein der Abzug (Vali 2026-10-24: das jetzige „macht keinen sinn“): die Zeilen der Legacy-Abgleiche kommen nicht
        // mit, solange `ABGLEICHE` nichts anderes will. Auf Stage bleibt die Liste, wie sie war (hier ohne Ausführung: gesperrt, aber da).
        expect(
            (await get(lokal, "/api/admin/system/abgleiche", admin.cookie)).json<{ zeilen: unknown[] }>().zeilen,
        ).toEqual([]);
        expect(
            (await get(stage, "/api/admin/system/abgleiche", admin.cookie)).json<{ zeilen: unknown[] }>().zeilen.length,
        ).toBeGreaterThan(0);
        // Auf dem Entwicklungsrechner gibt es keine Routen der anderen Rolle.
        expect((await post(lokal, `${ABZUG_URL}/erstellen`, admin.cookie)).statusCode).toBe(404);
        expect((await post(lokal, `${ABZUG_URL}/link`, admin.cookie)).statusCode).toBe(404);
        expect((await post(stage, `${ABZUG_URL}/einspielen`, operator.cookie)).statusCode).toBe(404);
        expect((await hochladen(stage, admin.cookie, tarBytes)).statusCode).toBe(404);

        expect(code(await hochladen(lokal, editor.cookie, tarBytes))).toBe("403 forbidden");
        expect(code(await hochladen(lokal, admin.cookie, tarBytes, "../../geheim.tar"))).toBe(
            "400 abzug_datei_ungueltig",
        );
        expect(code(await hochladen(lokal, admin.cookie, Buffer.from("das ist kein Tar".repeat(100))))).toBe(
            "422 abzug_datei_ungueltig",
        );
        expect((await get(lokal, ABZUG_URL, admin.cookie)).json<AbzugSichtEinspielen>().eingang).toBeNull();
        expect(await readdir(join(wurzel, "lokal", "eingang"))).toEqual([]); // nichts Halbes bleibt liegen

        const vorher = (await ereignisse("system.abzug_einspielen")).length;
        const antwort = await hochladen(lokal, admin.cookie, tarBytes, "Mein Abzug (Stage).tar");
        expect(code(antwort)).toBe("200");
        const eingang = antwort.json<AbzugEingang>();
        expect(eingang).toMatchObject({
            name: "Mein Abzug (Stage).tar",
            kennung: "20261024T100000Z-aktuell",
            quelle: "staging",
            bytes: tarBytes.length,
            probleme: [],
        });
        expect(eingang.tafeln).toBeGreaterThan(100);
        expect(eingang).toMatchObject({ medien: 0, medienBytes: 0, medienFehlend: 0 });
        const protokoll = await ereignisse("system.abzug_einspielen");
        expect(protokoll).toHaveLength(vorher + 1);
        expect(protokoll.at(-1)?.details).toEqual({ kennung: "20261024T100000Z-aktuell", schritt: "eingang" });
        expect((await get(lokal, ABZUG_URL, admin.cookie)).json<AbzugSichtEinspielen>().eingang).toMatchObject({
            probleme: [],
        });
        expect(aufrufe).toEqual([]); // Hochladen ersetzt nichts.
    });

    it("🔴 einspielen: nur der Betreiber mit frischem Passkey, nur nach bestandener Prüfung und mit Sicherung; ein Lauf, eine Datei zur Zeit", async () => {
        const kennung = "20261024T100000Z-aktuell";
        const einspielen = (cookie: string, k = kennung) =>
            post(lokal, `${ABZUG_URL}/einspielen`, cookie, { kennung: k });
        // Ohne Datei im Eingang.
        expect(code(await einspielen(operator.cookie))).toBe("404 abzug_unbekannt");
        expect(code(await hochladen(lokal, admin.cookie, tarBytes))).toBe("200");

        expect(code(await einspielen(admin.cookie))).toBe("403 forbidden"); // Admin darf hochladen, nicht ersetzen
        expect(
            code(
                await einspielen(
                    (
                        await fixture.session((await fixture.person("operator", { name: "Alt" })).id, {
                            assurance: "strong",
                            passkeyMinutesAgo: 120,
                        })
                    ).cookie,
                ),
            ),
        ).toBe("403 reauth_required");
        expect(code(await einspielen(operator.cookie, "20261024T000000Z-andere"))).toBe("404 abzug_unbekannt");
        expect(aufrufe).toEqual([]);

        // Ein Abzug, der nicht passt, wird nicht eingespielt: hier fehlt lokal eine Migration der Quelle.
        const katalog = await leseKatalog(cluster!.migrator);
        const plan = baueAbzugPlan(katalog, ladeRegeln(), "production");
        const neuer = join(wurzel, "neuer.tar");
        await schreibeAbzug(cluster!.migrator, plan, {
            ziel: neuer,
            kennung: "20261024T110000Z-neuer",
            veraendereManifest: (m) => ({
                ...m,
                migrationen: [...m.migrationen, { version: "9999_zukunft", checksum: "x" }],
            }),
        });
        const abgelehnt = await hochladen(lokal, admin.cookie, await readFile(neuer));
        expect(code(abgelehnt)).toBe("200");
        expect(abgelehnt.json<AbzugEingang>().probleme.map((p) => p.code)).toEqual(["migrationen_lokal_alt"]);
        expect(code(await einspielen(operator.cookie, "20261024T110000Z-neuer"))).toBe("409 abzug_einspielen_gesperrt");
        expect(aufrufe).toEqual([]);
        expect(code(await hochladen(lokal, admin.cookie, tarBytes))).toBe("200"); // die passende Datei wieder in den Eingang

        // Ohne pg_dump nie ersetzen.
        expect(code(await hochladen(lokalOhneDump, admin.cookie, tarBytes))).toBe("200");
        expect(code(await post(lokalOhneDump, `${ABZUG_URL}/einspielen`, operator.cookie, { kennung }))).toBe(
            "503 abzug_sicherung_fehlt",
        );
        expect((await get(lokalOhneDump, ABZUG_URL, admin.cookie)).json<AbzugSichtEinspielen>().sicherung).toBe(false);

        // Der Betreiber mit frischem Passkey startet; währenddessen sperrt sich der Dienst selbst.
        let freigeben!: () => void;
        blockiert = new Promise<void>((fertig) => (freigeben = fertig));
        const vorher = (await ereignisse("system.abzug_einspielen")).length;
        const antwort = await einspielen(operator.cookie);
        expect(code(antwort)).toBe("200");
        const protokoll = await ereignisse("system.abzug_einspielen");
        expect(protokoll).toHaveLength(vorher + 1);
        expect(protokoll.at(-1)?.details).toEqual({ kennung, schritt: "start" });
        await vorbei(() => aufrufe.length === 1);
        expect((await get(lokal, ABZUG_URL, admin.cookie)).json<AbzugSichtEinspielen>().lauf).toMatchObject({
            kennung,
            zustand: "laeuft",
        });
        expect(code(await einspielen(andererOperator.cookie))).toBe("409 abzug_laeuft");
        expect(code(await hochladen(lokal, admin.cookie, tarBytes))).toBe("409 abzug_laeuft");
        freigeben();
        await vorbei(
            async () =>
                (await get(lokal, ABZUG_URL, admin.cookie)).json<AbzugSichtEinspielen>().lauf?.zustand === "fertig",
        );
        const fertig = (await get(lokal, ABZUG_URL, admin.cookie)).json<AbzugSichtEinspielen>();
        expect(fertig.lauf).toMatchObject({
            kennung,
            zustand: "fertig",
            zeilen: 7,
            sicherung: "vorher-test.dump",
            meldung: null,
        });
        // Eingespielt heißt: Die Datei ist aus dem Eingang, das Ergebnis steht in der Ablage und überlebt einen Neustart.
        expect(fertig.eingang).toBeNull();
        expect(JSON.parse(await readFile(join(wurzel, "lokal", "letzter-lauf.json"), "utf8"))).toMatchObject({
            zustand: "fertig",
            kennung,
        });
        await expect(stat(join(wurzel, "lokal", "eingang", "aktuell.tar"))).rejects.toThrow();
        expect(aufrufe[0]?.tarPfad).toBe(join(wurzel, "lokal", "eingang", "aktuell.tar"));
    });

    it("🔴 bleiben Mediendateien offen, bleibt die Datei im Eingang, das Ergebnis nennt die Zahl, und dasselbe Einspielen darf noch einmal", async () => {
        const kennung = "20261024T100000Z-aktuell";
        expect(code(await hochladen(lokal, admin.cookie, tarBytes))).toBe("200");
        medienErgebnis = {
            dateien: 5,
            geschrieben: 3,
            vorhanden: 0,
            offen: 2,
            bytes: 1234,
            ersterFehler: "published/sha256/aa/bb/x.webp: EPERM",
        };
        expect(code(await post(lokal, `${ABZUG_URL}/einspielen`, operator.cookie, { kennung }))).toBe("200");
        await vorbei(
            async () =>
                (await get(lokal, ABZUG_URL, admin.cookie)).json<AbzugSichtEinspielen>().lauf?.zustand === "fertig",
        );
        const sicht = (await get(lokal, ABZUG_URL, admin.cookie)).json<AbzugSichtEinspielen>();
        // Die Zahl steht im Ergebnis, der Pfad der Datei nicht (der Fehler gehört ins Protokoll des Servers, nicht in die Oberfläche).
        expect(sicht.lauf?.medien).toEqual({ dateien: 5, geschrieben: 3, offen: 2, bytes: 1234 });
        expect(JSON.stringify(sicht)).not.toContain("EPERM");
        expect(sicht.eingang).toMatchObject({ kennung });
        await expect(stat(join(wurzel, "lokal", "eingang", "aktuell.tar"))).resolves.toBeTruthy();
        // Behoben: das erneute Einspielen derselben Datei läuft und räumt den Eingang diesmal auf.
        medienErgebnis = KEINE_MEDIEN;
        expect(code(await post(lokal, `${ABZUG_URL}/einspielen`, operator.cookie, { kennung }))).toBe("200");
        await vorbei(
            async () =>
                (await get(lokal, ABZUG_URL, admin.cookie)).json<AbzugSichtEinspielen>().lauf?.medien?.offen === 0,
        );
        await vorbei(
            async () => (await get(lokal, ABZUG_URL, admin.cookie)).json<AbzugSichtEinspielen>().eingang === null,
        );
    });

    async function vorbei(bedingung: () => boolean | Promise<boolean>): Promise<void> {
        for (let versuch = 0; versuch < 100; versuch += 1) {
            if (await bedingung()) return;
            await new Promise((fertig) => setTimeout(fertig, 50));
        }
        throw new Error("Zeitüberschreitung beim Warten");
    }
});
