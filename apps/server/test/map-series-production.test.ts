import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    AVENTURIA_SERIES,
    KARTENSERIE_PAPIERKORB_TAGE,
    KARTENSERIEN_PRODUCTION_URL,
    KARTENSERIEN_URL,
    MAP_SERIES_URL,
    type AdminKartenserien,
    type KartenserieUebernahme,
    type MapSeriesCatalog,
    type OperationReceipt,
    type Role,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { leseZeiger, schalteUmAuf } from "../src/map-series/fassungen.ts";
import { raeumePapierkorb } from "../src/map-series/papierkorb.ts";
import { uebernimm } from "../src/map-series/uebernahme.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Kartenserien Schnitt 4 (WI-0220; Vorlage Fassung 4, Betreiber 2026-10-18 abgenommen) auf dem Wegwerf-Cluster mit App- und Jobs-Rolle:
 *
 * - „Nach Production übernehmen“ auf der Stage: nur die Betreiber, reiht `map_series_production` mit Fassung, Quelle und Einstellungen
 *   ein; abgewiesen bei laufendem Auftrag, ausgeblendeter Serie, unbekannter Serie.
 * - Die Production-Hälfte (`uebernimm`, hinter `kartenserie-uebernehmen`): schreibt nur Abweichungen, schaltet um, behält die vorige
 *   Fassung; ohne kopierte Fassung nichts.
 * - Der Papierkorb nach seiner Frist (`raeumePapierkorb`, Jobs-Rolle): Kacheln und Quellen weg, die Zeile einer neuen Serie weg, die einer
 *   Serie der JSON bleibt; Wiederherstellen nach der Frist nicht mehr, im Reiter steht die Frist.
 */

const ENV = "kartenprod";
const grants = [
    fileURLToPath(new URL("../src/db/system-grants.psql", import.meta.url)),
    // Die sync-Funktionen des Korridors führt nur die Jobs-Rolle aus (Migration 0190).
    fileURLToPath(new URL("../src/db/jobs-grants.psql", import.meta.url)),
];
const describeWithCluster = postgresBin ? describe : describe.skip;

/** Eine Fassung, wie der Auftrag sie hinterlässt: Kachel, Zeiger daneben (`<revision>.json`). */
async function fassung(tiles: string, serie: string, revision: string, maxNativeZoom = 6): Promise<object> {
    await mkdir(join(tiles, serie, revision, "0", "0"), { recursive: true });
    await writeFile(join(tiles, serie, revision, "0", "0", "0.webp"), revision);
    const zeiger = {
        schemaVersion: 1,
        series: serie,
        revision,
        manifest: `${revision}${"0".repeat(52)}`,
        format: "webp",
        tileSize: 512,
        maxNativeZoom,
    };
    await writeFile(join(tiles, serie, `${revision}.json`), `${JSON.stringify(zeiger)}\n`);
    return zeiger;
}

describeWithCluster("Kartenserien Schnitt 4: Übernahme nach Production und Papierkorb (Wegwerf-Cluster)", () => {
    let cluster: VpsCluster | undefined;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    let operator: { cookie: string };
    let admin: { cookie: string };
    let wurzel: string;
    let tiles: string;

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, grants);
        await seedMapDomains(cluster.migrator);
        fixture = authFixture(cluster.admin);
        wurzel = await mkdtemp(join(tmpdir(), "kartenprod-"));
        tiles = join(wurzel, "tiles");
        delete process.env["MAP_SOURCES_ROOT"];
        const config: ServerConfig = {
            port: 0,
            host: "127.0.0.1",
            releaseId: "wi0220-s4-test",
            databaseUrl: undefined,
            tileRoot: tiles,
            statusPage: true,
            auth: TEST_AUTH,
        };
        app = buildApp({
            config,
            database: cluster.app,
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
        });
        await app.ready();
        const person = async (role: Role, name: string) => {
            const created = await fixture.person(role, { name });
            const { cookie } = await fixture.session(created.id, { assurance: "strong", passkeyMinutesAgo: 1 });
            return { cookie };
        };
        operator = await person("operator", "Rondrikan");
        admin = await person("admin", "Alrike");
    }, 180_000);
    beforeEach(async () => {
        await cluster!.migrator`DELETE FROM map_series`;
        await cluster!.migrator`DELETE FROM job WHERE kind IN ('map_series_tile', 'map_series_production')`;
        await cluster!.migrator`UPDATE content_switch SET enabled = TRUE WHERE NOT enabled`;
        await rm(wurzel, { recursive: true, force: true });
        await mkdir(tiles, { recursive: true });
    });
    afterAll(async () => {
        await app?.close();
        await cluster?.stop();
        await rm(wurzel, { recursive: true, force: true });
    }, 60_000);

    const code = (response: { statusCode: number; json(): unknown }): string =>
        response.statusCode < 300
            ? String(response.statusCode)
            : `${String(response.statusCode)} ${(response.json() as { error: { code: string } }).error.code}`;
    const uebernehmen = (id: string, cookie = operator.cookie) =>
        app.inject({
            method: "POST",
            url: KARTENSERIEN_PRODUCTION_URL,
            payload: { operationId: randomUUID(), id },
            headers: { origin: TEST_ORIGIN, cookie },
        });
    const modell = async () =>
        (
            await app.inject({ method: "GET", url: KARTENSERIEN_URL, headers: { cookie: operator.cookie } })
        ).json<AdminKartenserien>();

    it("🔴 Übernehmen reiht den Auftrag mit Fassung, Quelle und Einstellungen ein; ein Ereignis; danach steht der Stand im Reiter", async () => {
        await schalteUmAuf(tiles, (await fassung(tiles, "original", "aaaaaaaaaaaa")) as never);
        // Die Quelle kennt die Übernahme aus dem Ergebnis des Auftrags, der genau diese Fassung zerlegt hat.
        await cluster!.migrator`
            INSERT INTO job (kind, kind_version, map_domain_id, origin, state, input_ref, result, finished_at)
            VALUES ('map_series_tile', 1, 'aventuria', 'queued', 'SUCCEEDED', ${cluster!.migrator.json({ serie: "original" })},
                    ${cluster!.migrator.json({ revision: "aaaaaaaaaaaa", quelle: "0123456789ab.png" })}, now())
        `;
        const antwort = await uebernehmen("original");
        expect(code(antwort)).toBe("200");
        const jobId = antwort.json<OperationReceipt>().derivedWork[0]!.jobId!;
        const [job] = await cluster!.admin<{ kind: string; scope_kind: string; input_ref: KartenserieUebernahme }[]>`
            SELECT kind, scope_kind, input_ref FROM job WHERE public_id = ${jobId}::uuid
        `;
        const vorgabe = AVENTURIA_SERIES.series.find((s) => s.id === "original")!;
        expect(job).toMatchObject({ kind: "map_series_production", scope_kind: "tiles" });
        expect(job!.input_ref).toMatchObject({
            serie: "original",
            revision: "aaaaaaaaaaaa",
            quelle: "0123456789ab.png",
            einstellungen: {
                label: vorgabe.label,
                visibility: vorgabe.visibility,
                sourcePixels: vorgabe.sourcePixels,
                maxNativeZoom: vorgabe.maxNativeZoom,
                istVorgabe: false,
            },
        });
        const [ereignis] = await cluster!.admin<{ details: Record<string, unknown> }[]>`
            SELECT details FROM avesmaps_auth.security_event WHERE action = 'system.map_series_changed' ORDER BY id DESC LIMIT 1
        `;
        expect(ereignis!.details).toMatchObject({ series: "original", aktion: "production", to: "aaaaaaaaaaaa" });
        const stand = (await modell()).serien.find((e) => e.serie.id === "original")!;
        expect(stand.uebernahme).toMatchObject({ state: "QUEUED", revision: "aaaaaaaaaaaa" });
        // Solange er wartet: kein zweiter.
        expect(code(await uebernehmen("original"))).toBe("409 kartenserien_auftrag_laeuft");
    });

    it("🔴 der Korridor übernimmt den Auftrag, meldet Phasen mit eigenem Fortschritt und beendet ihn (Migration 0190)", async () => {
        await schalteUmAuf(tiles, (await fassung(tiles, "original", "aaaaaaaaaaaa")) as never);
        const antwort = await uebernehmen("original");
        expect(code(antwort)).toBe("200");
        const publicId = antwort.json<OperationReceipt>().derivedWork[0]!.jobId!;
        const [zeile] = await cluster!.admin<{ id: string }[]>`
            SELECT id::text AS id FROM job WHERE public_id = ${publicId}::uuid
        `;
        const id = zeile!.id;
        // Wie Claudios Korridor: als Jobs-Rolle, festgeschrieben.
        const alsJobs = <T>(work: (sql: VpsCluster["admin"]) => Promise<T>) =>
            cluster!.admin.begin(async (tx) => {
                await tx.unsafe(`SET LOCAL ROLE ${cluster!.roles.jobs}`);
                return work(tx as unknown as VpsCluster["admin"]);
            }) as Promise<T>;
        const geholt = await alsJobs(
            async (sql) =>
                (await sql<{ uuid: string | null }[]>`SELECT job_sync_claim_id(${id}::bigint, 600)::text AS uuid`)[0]!
                    .uuid,
        );
        expect(geholt).toBe(publicId);
        const fortschritt = async (phase: string) => {
            await alsJobs((sql) => sql`SELECT job_sync_phase(${publicId}::uuid, ${phase}, '')`);
            const [zeile] = await cluster!.admin<{ progress: number }[]>`
                SELECT progress::float8 AS progress FROM job WHERE public_id = ${publicId}::uuid
            `;
            return zeile!.progress;
        };
        // Die Übernahme kopiert ZUERST: kopieren 0,1 · einspielen 0,7 · proben 0,9 (die anderen Arten kopieren zuletzt, 0,95).
        expect(await fortschritt("kopieren")).toBeCloseTo(0.1, 5);
        expect(await fortschritt("einspielen")).toBeCloseTo(0.7, 5);
        expect(await fortschritt("proben")).toBeCloseTo(0.9, 5);
        const fertig = await alsJobs(
            async (sql) =>
                (
                    await sql<
                        { ok: boolean }[]
                    >`SELECT job_sync_finish(${publicId}::uuid, 'ok', 'Fassung aaaaaaaaaaaa auf Production') AS ok`
                )[0]!.ok,
        );
        expect(fertig).toBe(true);
        expect((await modell()).serien.find((e) => e.serie.id === "original")?.uebernahme).toMatchObject({
            state: "SUCCEEDED",
            revision: "aaaaaaaaaaaa",
        });
    });

    it("🔴 abgewiesen: ohne das Recht der Betreiber, ausgeblendet, unbekannt, ohne Fassung auf der Platte", async () => {
        await schalteUmAuf(tiles, (await fassung(tiles, "original", "aaaaaaaaaaaa")) as never);
        expect(code(await uebernehmen("original", admin.cookie))).toMatch(/^403 /u);
        await cluster!.migrator`
            INSERT INTO content_switch (key, enabled) VALUES ('map.series.original', false)
            ON CONFLICT (key) DO UPDATE SET enabled = false
        `;
        expect(code(await uebernehmen("original"))).toBe("409 kartenserien_ausgeblendet");
        expect(code(await uebernehmen("drache"))).toBe("404 unknown_series");
        expect(code(await uebernehmen("modern"))).toBe("409 kartenserien_fassung_fehlt");
        const [n] = await cluster!.admin<{ n: number }[]>`
            SELECT count(*)::int AS n FROM job WHERE kind = 'map_series_production'
        `;
        expect(n!.n).toBe(0);
    });

    it("🔴 Production-Hälfte: Einstellungen als Abweichung, umschalten, die vorige Fassung bleibt; ohne Fassung nichts", async () => {
        await schalteUmAuf(tiles, (await fassung(tiles, "old", "111111111111")) as never);
        await fassung(tiles, "old", "222222222222");
        await fassung(tiles, "old", "333333333333");
        const vorgabe = AVENTURIA_SERIES.series.find((s) => s.id === "old")!;
        const eingabe = (revision: string): KartenserieUebernahme => ({
            serie: "old",
            revision,
            quelle: null,
            einstellungen: {
                label: "Alte Karte",
                description: vorgabe.description,
                visibility: "PUBLIC",
                labelsInImage: true,
                sortOrder: 20,
                thumb: { x: 3, y: 4 },
                author: vorgabe.author,
                origin: vorgabe.origin,
                derivation: vorgabe.derivation,
                permissionStatement: vorgabe.permission.statement,
                attribution: vorgabe.attribution,
                en: { ...vorgabe.en },
                sourcePixels: 32768,
                maxNativeZoom: 6,
                istVorgabe: false,
            },
        });
        const protokoll: unknown[] = [];
        const ergebnis = await uebernimm(cluster!.app, eingabe("222222222222"), {
            tileRoot: tiles,
            protokoll: async (_tx, aus) => void protokoll.push(aus),
        });
        expect(ergebnis).toMatchObject({ vorher: "111111111111", revision: "222222222222" });
        expect(ergebnis.weggeraeumt).toEqual(["333333333333"]);
        expect(protokoll).toEqual([{ vorher: "111111111111", revision: "222222222222" }]);
        expect((await leseZeiger(tiles, "old"))?.revision).toBe("222222222222");
        expect((await readdir(join(tiles, "old"))).sort()).toEqual([
            "111111111111",
            "111111111111.json",
            "222222222222",
            "222222222222.json",
            "current.json",
        ]);
        const [zeile] = await cluster!.admin<Record<string, unknown>[]>`
            SELECT label, description, visibility, labels_in_image, thumb_x, author, sort_order, status, changed_by_label
              FROM map_series WHERE series_id = 'old'
        `;
        // Nur, was von der JSON abweicht: der Name, das Bild, die Reihe.
        expect(zeile).toEqual({
            label: "Alte Karte",
            description: null,
            visibility: null,
            labels_in_image: null,
            thumb_x: 3,
            author: null,
            sort_order: 20,
            status: "aktiv",
            changed_by_label: "Übernahme von Stage",
        });
        const katalog = (await app.inject({ method: "GET", url: MAP_SERIES_URL })).json<MapSeriesCatalog>();
        expect(katalog.series.find((s) => s.id === "old")).toMatchObject({
            label: "Alte Karte",
            visibility: "PUBLIC",
        });
        await expect(
            uebernimm(cluster!.app, eingabe("444444444444"), { tileRoot: tiles, protokoll: async () => undefined }),
        ).rejects.toMatchObject({ code: "kartenserien_fassung_fehlt" });
        expect((await leseZeiger(tiles, "old"))?.revision).toBe("222222222222");
    });

    it("🔴 Papierkorb nach der Frist: Dateien weg, neue Serie ganz weg, Serie der JSON bleibt als Zeile; Wiederherstellen dann nicht mehr", async () => {
        const quellen = join(wurzel, "map-sources");
        const alt = `${String(KARTENSERIE_PAPIERKORB_TAGE + 1)} days`;
        await cluster!.migrator`
            INSERT INTO map_series (series_id, label, source_pixels, max_native_zoom, status, papierkorb_at)
            VALUES ('nacht', 'Nacht', 8192, 4, 'papierkorb', now() - ${alt}::interval),
                   ('tag', 'Tag', 8192, 4, 'papierkorb', now() - interval '2 days')
        `;
        await cluster!.migrator`
            INSERT INTO map_series (series_id, status, papierkorb_at) VALUES ('old', 'papierkorb', now() - ${alt}::interval)
        `;
        for (const serie of ["nacht", "tag", "old"]) {
            await fassung(tiles, serie, "aaaaaaaaaaaa", 4);
            await mkdir(join(quellen, serie), { recursive: true });
            await writeFile(join(quellen, serie, "0123456789ab.png"), "png");
        }
        const ergebnis = await raeumePapierkorb(cluster!.jobs, {
            tileRoot: tiles,
            ablage: { wurzel: quellen, uploads: join(quellen, "uploads") },
        });
        expect(ergebnis).toEqual({ serien: ["nacht", "old"], ordner: 4, zeilen: 1 });
        expect((await readdir(tiles)).sort()).toEqual(["tag"]);
        expect((await readdir(quellen)).sort()).toEqual(["tag"]);
        const zeilen = await cluster!.admin<{ series_id: string; status: string }[]>`
            SELECT series_id, status FROM map_series ORDER BY series_id
        `;
        expect(zeilen).toEqual([
            { series_id: "old", status: "papierkorb" },
            { series_id: "tag", status: "papierkorb" },
        ]);
        // Wiederholbar: Ein zweiter Lauf findet nichts mehr zu löschen.
        expect(
            await raeumePapierkorb(cluster!.jobs, { tileRoot: tiles, ablage: { wurzel: quellen, uploads: quellen } }),
        ).toEqual({ serien: ["old"], ordner: 0, zeilen: 0 });

        // Im Reiter steht nur noch, was innerhalb der Frist liegt, mit dem Tag, an dem es weggeräumt wird.
        const stand = await modell();
        expect(stand.papierkorb.map((p) => p.id)).toEqual(["tag"]);
        const tag = stand.papierkorb[0]!;
        expect(new Date(tag.endgueltig).getTime() - new Date(tag.seit).getTime()).toBe(
            KARTENSERIE_PAPIERKORB_TAGE * 24 * 3_600_000,
        );
        const wieder = (id: string, baseRevision: number) =>
            app.inject({
                method: "POST",
                url: KARTENSERIEN_URL,
                payload: { operationId: randomUUID(), baseRevision, id, aktion: { art: "wiederherstellen" } },
                headers: { origin: TEST_ORIGIN, cookie: operator.cookie },
            });
        expect(code(await wieder("old", stand.revision!))).toBe("409 papierkorb_abgelaufen");
        expect(code(await wieder("tag", (await modell()).revision!))).toBe("200");
    });
});
