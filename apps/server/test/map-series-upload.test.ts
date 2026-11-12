import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    KARTENSERIE_STUECK_PRUEFSUMME,
    KARTENSERIEN_UPLOADS_URL,
    KARTENSERIEN_URL,
    MAP_SERIES_URL,
    type AdminKartenserien,
    type MapSeriesCatalog,
    type OperationReceipt,
    type Role,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import type { JobContext } from "../src/jobs/handlers.ts";
import { nachXyz, runMapSeriesTile, trageKanteEin } from "../src/jobs/map-series-tile-job.ts";
import { fassungenVon, leseZeiger, schalteUmAuf, zeigerDerRevision } from "../src/map-series/fassungen.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Hochladen und Zerlegen einer Kartenserie (WI-0220 Schnitt 3): der Auftrag `map_series_tile` auf einem echten 8k-PNG (ohne Datenbank,
 * mit Ausrichtung, Manifest, Rückweg und Aufräumen) und die Routen samt Protokoll und Rechten auf dem Wegwerf-Cluster.
 */

const KANTE = 8192;

/** Ein 8k-PNG: blau, oben rechts ein rotes Quadrat in Kachelgröße (die Kachel z4/x15/y0), unten links ein grünes (z4/x0/y15). */
async function bild(pfad: string, grund = "#336699"): Promise<void> {
    const quadrat = (farbe: string) =>
        sharp({ create: { width: 512, height: 512, channels: 3, background: farbe } })
            .png()
            .toBuffer();
    await sharp({ create: { width: KANTE, height: KANTE, channels: 3, background: grund } })
        .composite([
            { input: await quadrat("#ff0000"), left: KANTE - 512, top: 0 },
            { input: await quadrat("#00ff00"), left: 0, top: KANTE - 512 },
        ])
        .png({ compressionLevel: 6 })
        .toFile(pfad);
}

async function farbeVon(pfad: string): Promise<[number, number, number]> {
    const { data } = await sharp(pfad).resize(1, 1).raw().toBuffer({ resolveWithObject: true });
    return [data[0]!, data[1]!, data[2]!];
}

function kontext(input: Record<string, unknown>, phasen: string[] = []): JobContext {
    return {
        input,
        attempt: 1,
        job: { id: 1, publicId: randomUUID(), leaseNo: null, mapDomainId: "aventuria" },
        beginPhase: async (name) => {
            if (phasen.at(-1) !== name) phasen.push(name);
        },
        checkpoint: () => undefined,
    };
}

describe("Auftrag map_series_tile ohne Datenbank (echtes 8k-PNG)", () => {
    let wurzel: string;
    let tiles: string;
    let quellen: string;
    const eingetragen: [string, number, number][] = [];
    const eintragen = async (serie: string, kante: number, stufen: number) =>
        void eingetragen.push([serie, kante, stufen]);

    beforeAll(async () => {
        wurzel = await mkdtemp(join(tmpdir(), "kartenserie-"));
        tiles = join(wurzel, "tiles");
        quellen = join(wurzel, "map-sources");
        process.env["TILE_ROOT"] = tiles;
        process.env["MAP_SOURCES_ROOT"] = quellen;
    });
    afterAll(async () => {
        delete process.env["TILE_ROOT"];
        delete process.env["MAP_SOURCES_ROOT"];
        delete process.env["MAP_SERIES_MIN_FREE_GB"];
        await rm(wurzel, { recursive: true, force: true });
    });

    async function eingang(grund?: string): Promise<{ name: string; bytes: number }> {
        const name = `eingang-${randomUUID()}.png`;
        await mkdir(join(quellen, "nacht"), { recursive: true });
        await bild(join(quellen, "nacht", name), grund);
        return { name, bytes: (await stat(join(quellen, "nacht", name))).size };
    }

    it("🔴 zerlegt in z/x/y (nicht libvips' z/y/x), zählt die Kacheln, schaltet um und behält die vorige Fassung", async () => {
        const erste = await eingang();
        const phasen: string[] = [];
        const ergebnis1 = await runMapSeriesTile(
            kontext({ serie: "nacht", eingang: erste.name, bytes: erste.bytes, kante: KANTE, art: "neu" }, phasen),
            eintragen,
        );
        expect(phasen).toEqual(["pruefen", "zerlegen", "manifest", "umschalten"]);
        expect(ergebnis1).toMatchObject({ kacheln: 341, stufen: 4, kante: KANTE, vorher: null });
        const rev1 = String(ergebnis1["revision"]);
        // Rot liegt oben rechts: Stufe 4, x = 15, y = 0. Grün unten links: x = 0, y = 15.
        // WebP q80 ist verlustbehaftet: „rot“ heißt hier R hoch, G und B niedrig.
        const rot = await farbeVon(join(tiles, "nacht", rev1, "4", "15", "0.webp"));
        expect(rot[0]).toBeGreaterThan(240);
        expect(Math.max(rot[1], rot[2])).toBeLessThan(16);
        const gruen = await farbeVon(join(tiles, "nacht", rev1, "4", "0", "15.webp"));
        expect(gruen[1]).toBeGreaterThan(240);
        expect(Math.max(gruen[0], gruen[2])).toBeLessThan(16);
        // Lesbar für Nginx (www-data): Ordner 0755, Kacheln 0644, auch unter einer strengen umask (Claudio 2026-10-18, Ergänzung A).
        // Windows kennt diese Rechte nicht; der Lauf nach dem Push auf Linux prüft es.
        if (process.platform !== "win32") {
            expect((await stat(join(tiles, "nacht"))).mode & 0o777).toBe(0o755);
            expect((await stat(join(tiles, "nacht", rev1, "4", "15"))).mode & 0o777).toBe(0o755);
            expect((await stat(join(tiles, "nacht", rev1, "4", "15", "0.webp"))).mode & 0o777).toBe(0o644);
        }
        const zeiger1 = await leseZeiger(tiles, "nacht");
        expect(zeiger1).toMatchObject({ revision: rev1, maxNativeZoom: 4, tileSize: 512, format: "webp" });
        expect(eingetragen).toEqual([["nacht", KANTE, 4]]);
        // Die Quelle heißt nach ihrer Prüfsumme; der Eingang ist weg.
        expect((await readdir(join(quellen, "nacht"))).filter((n) => n.endsWith(".png"))).toEqual([
            String(ergebnis1["quelle"]),
        ]);

        // Eine liegengebliebene ältere Fassung dieses Auftrags (mit Zeiger daneben) räumt der nächste Lauf weg.
        const alt = join(tiles, "nacht", "aaaaaaaaaaaa");
        await mkdir(join(alt, "0", "0"), { recursive: true });
        await writeFile(join(alt, "0", "0", "0.webp"), "x");
        await writeFile(`${alt}.json`, "{}");
        const fremd = join(tiles, "nacht", "bbbbbbbbbbbb");
        await mkdir(fremd, { recursive: true });

        const zweite = await eingang("#663399");
        const ergebnis2 = await runMapSeriesTile(
            kontext({ serie: "nacht", eingang: zweite.name, bytes: zweite.bytes, kante: KANTE, art: "ersetzen" }),
            eintragen,
        );
        const rev2 = String(ergebnis2["revision"]);
        expect(rev2).not.toBe(rev1);
        expect(ergebnis2).toMatchObject({ vorher: rev1, weggeraeumt: ["aaaaaaaaaaaa"] });
        const fassungen = await fassungenVon(tiles, "nacht");
        expect(fassungen.map((f) => [f.revision, f.aktuell]).sort()).toEqual(
            [
                [rev1, false],
                [rev2, true],
                // Ohne Zeiger daneben (raster-publish.sh): bleibt stehen.
                ["bbbbbbbbbbbb", false],
            ].sort(),
        );
        // Höchstens zwei Quellen je Serie.
        expect((await readdir(join(quellen, "nacht"))).filter((n) => n.endsWith(".png"))).toHaveLength(2);

        // Rückweg: der Zeiger der vorigen Fassung liegt daneben, umschalten schreibt nur current.json.
        const zurueck = await zeigerDerRevision(tiles, "nacht", rev1);
        expect(zurueck?.revision).toBe(rev1);
        await schalteUmAuf(tiles, zurueck!);
        expect((await leseZeiger(tiles, "nacht"))?.revision).toBe(rev1);
    }, 120_000);

    it("🔴 eine Quelle mit falscher Größe oder Kante wird abgewiesen, nichts wird umgeschaltet", async () => {
        const falsch = await eingang();
        await expect(
            runMapSeriesTile(
                kontext({
                    serie: "nacht",
                    eingang: falsch.name,
                    bytes: falsch.bytes + 1,
                    kante: KANTE,
                    art: "ersetzen",
                }),
                eintragen,
            ),
        ).rejects.toMatchObject({ code: "source_size" });
        const kante = await eingang();
        await expect(
            runMapSeriesTile(
                kontext({ serie: "nacht", eingang: kante.name, bytes: kante.bytes, kante: 16384, art: "ersetzen" }),
                eintragen,
            ),
        ).rejects.toMatchObject({ code: "source_edge" });
    }, 60_000);

    it("baut libvips' Google-Layout z/y/x zu z/x/y um und lässt nur Kacheln stehen", async () => {
        const ort = join(wurzel, "layout");
        await mkdir(join(ort, "1", "0"), { recursive: true });
        await writeFile(join(ort, "1", "0", "1.webp"), "y0x1");
        await writeFile(join(ort, "vips-properties.xml"), "<x/>");
        await nachXyz(ort);
        expect(await readFile(join(ort, "1", "1", "0.webp"), "utf8")).toBe("y0x1");
        expect(await readdir(ort)).toEqual(["1"]);
    });
});

const ENV = "kartenupload";
const grants = [fileURLToPath(new URL("../src/db/system-grants.psql", import.meta.url))];
const describeWithCluster = postgresBin ? describe : describe.skip;

describeWithCluster(
    "Hochladen: Routen, Protokoll und Rechte, App- und Jobs-Rolle wie auf dem VPS (Wegwerf-Cluster)",
    () => {
        let cluster: VpsCluster | undefined;
        let fixture: AuthFixture;
        let app: FastifyInstance;
        let operator: { cookie: string };
        let wurzel: string;

        beforeAll(async () => {
            cluster = await startVpsCluster(ENV, grants);
            await seedMapDomains(cluster.migrator);
            fixture = authFixture(cluster.admin);
            wurzel = await mkdtemp(join(tmpdir(), "kartenupload-"));
            await mkdir(join(wurzel, "tiles"), { recursive: true });
            delete process.env["MAP_SOURCES_ROOT"];
            const config: ServerConfig = {
                port: 0,
                host: "127.0.0.1",
                releaseId: "wi0220-s3-test",
                databaseUrl: undefined,
                tileRoot: join(wurzel, "tiles"),
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
        }, 180_000);
        beforeEach(async () => {
            // Grenze 0: Die Vorgabe (20 GB) misst die echte Platte; der Release-Test 1428d7a wurde so rot, als C: unter 20 GB frei hatte.
            process.env["MAP_SERIES_MIN_FREE_GB"] = "0";
            await cluster!.migrator`DELETE FROM map_series`;
            await cluster!.migrator`DELETE FROM job WHERE kind = 'map_series_tile'`;
            await rm(join(wurzel, "map-sources"), { recursive: true, force: true });
        });
        afterAll(async () => {
            await app?.close();
            await cluster?.stop();
            await rm(wurzel, { recursive: true, force: true });
        }, 60_000);

        /** Ein „PNG“ für den Server: richtiger Kopf mit 8192 px, danach beliebige Bytes (zerlegt wird hier nicht). */
        const datei = (laenge = 1000): Buffer => {
            const kopf = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
            const masse = Buffer.alloc(8);
            masse.writeUInt32BE(KANTE, 0);
            masse.writeUInt32BE(KANTE, 4);
            return Buffer.concat([kopf, masse, Buffer.alloc(laenge - 24, 7)]);
        };
        const code = (response: { statusCode: number; json(): unknown }): string =>
            response.statusCode < 300
                ? String(response.statusCode)
                : `${String(response.statusCode)} ${(response.json() as { error: { code: string } }).error.code}`;
        const anlegen = (ziel: unknown, bytes: number) =>
            app.inject({
                method: "POST",
                url: KARTENSERIEN_UPLOADS_URL,
                payload: { operationId: randomUUID(), ziel, bytes, kante: KANTE },
                headers: { origin: TEST_ORIGIN, cookie: operator.cookie },
            });
        const stueck = (id: string, versatz: number, bytes: Buffer, pruefsumme?: string) =>
            app.inject({
                method: "PUT",
                url: `${KARTENSERIEN_UPLOADS_URL}/${id}?versatz=${versatz}`,
                payload: bytes,
                headers: {
                    origin: TEST_ORIGIN,
                    cookie: operator.cookie,
                    "content-type": "application/octet-stream",
                    [KARTENSERIE_STUECK_PRUEFSUMME]: pruefsumme ?? createHash("sha256").update(bytes).digest("hex"),
                },
            });
        const abschluss = (id: string) =>
            app.inject({
                method: "POST",
                url: `${KARTENSERIEN_UPLOADS_URL}/${id}/abschluss`,
                payload: { operationId: randomUUID() },
                headers: { origin: TEST_ORIGIN, cookie: operator.cookie },
            });
        const neu = { art: "neu", id: "nacht", anlage: { label: "Nacht", labelsInImage: false, nurEditoren: true } };

        it("🔴 anlegen, Stücke mit Prüfsumme, fortsetzen, abschließen: ein Auftrag, zwei Ereignisse, die Serie noch nicht im Fächer", async () => {
            const bytes = datei(1000);
            const angelegt = await anlegen(neu, bytes.length);
            expect(code(angelegt)).toBe("200");
            const id = angelegt.json<OperationReceipt>().affected[0]!.id;
            // Erstes Stück, dann ein verfälschtes, dann ein falscher Versatz: Die Datei nimmt nur das Richtige an.
            expect(code(await stueck(id, 0, bytes.subarray(0, 600)))).toBe("200");
            expect(code(await stueck(id, 600, bytes.subarray(600), "0".repeat(64)))).toBe(
                "422 kartenserien_pruefsumme",
            );
            const versatz = await stueck(id, 0, bytes.subarray(600));
            expect(code(versatz)).toBe("409 kartenserien_versatz");
            expect(code(await abschluss(id))).toBe("409 kartenserien_unvollstaendig");
            const stand = await app.inject({
                method: "GET",
                url: `${KARTENSERIEN_UPLOADS_URL}/${id}`,
                headers: { cookie: operator.cookie },
            });
            expect(stand.json()).toMatchObject({ empfangen: 600, bytes: 1000, kante: KANTE });
            expect(code(await stueck(id, 600, bytes.subarray(600)))).toBe("200");

            const fertig = await abschluss(id);
            expect(code(fertig)).toBe("200");
            const jobId = fertig.json<OperationReceipt>().derivedWork[0]!.jobId!;
            const [job] = await cluster!.admin<
                { kind: string; input_ref: Record<string, unknown>; scope_kind: string }[]
            >`
            SELECT kind, input_ref, scope_kind FROM job WHERE public_id = ${jobId}::uuid
        `;
            expect(job).toMatchObject({ kind: "map_series_tile", scope_kind: "tiles" });
            expect(job!.input_ref).toMatchObject({ serie: "nacht", bytes: 1000, kante: KANTE, art: "neu" });
            expect(String(job!.input_ref["eingang"])).toMatch(/^eingang-.*\.png$/u);
            // Die Datei liegt bei der Serie, der Upload ist weg.
            expect(await readdir(join(wurzel, "map-sources", "nacht"))).toEqual([job!.input_ref["eingang"]]);

            const ereignisse = await cluster!.admin<{ details: { aktion: string } }[]>`
            SELECT details FROM avesmaps_auth.security_event WHERE action = 'system.map_series_changed' ORDER BY id
        `;
            expect(ereignisse.slice(-2).map((e) => e.details.aktion)).toEqual(["hochladen", "zerlegen"]);
            // Die Zeile steht, ohne Kante: im Fächer noch nicht, im Reiter unter „in Arbeit“ mit dem Auftrag.
            const katalog = (await app.inject({ method: "GET", url: MAP_SERIES_URL })).json<MapSeriesCatalog>();
            expect(katalog.series.map((s) => s.id)).not.toContain("nacht");
            const modell = (
                await app.inject({ method: "GET", url: KARTENSERIEN_URL, headers: { cookie: operator.cookie } })
            ).json<AdminKartenserien>();
            expect(modell.inArbeit).toEqual([
                expect.objectContaining({
                    id: "nacht",
                    label: "Nacht",
                    auftrag: expect.objectContaining({ state: "QUEUED" }),
                }),
            ]);
            // Ein zweiter Auftrag für dieselbe Serie, solange einer wartet: nein.
            const zweiter = await anlegen({ art: "ersetzen", id: "nacht" }, 1000);
            const zweitId = zweiter.json<OperationReceipt>().affected[0]!.id;
            expect(code(await stueck(zweitId, 0, datei(1000)))).toBe("200");
            expect(code(await abschluss(zweitId))).toBe("409 kartenserien_auftrag_laeuft");

            // Der Auftrag trägt als Jobs-Rolle Kante und Stufe ein: Dann steht die Serie im Fächer.
            await trageKanteEin(cluster!.jobs, "nacht", KANTE, 4);
            const danach = (await app.inject({ method: "GET", url: MAP_SERIES_URL })).json<MapSeriesCatalog>();
            expect(danach.series.find((s) => s.id === "nacht")).toMatchObject({
                sourcePixels: KANTE,
                maxNativeZoom: 4,
                visibility: "EDITOR_ONLY",
            });
        });

        it("🔴 abgewiesen: vergebene Kennung, unbekannte Serie, falsche Kante, zu wenig Platz", async () => {
            expect(code(await anlegen({ ...neu, id: "modern" }, 1000))).toBe("409 kartenserien_kennung_vergeben");
            expect(code(await anlegen({ art: "ersetzen", id: "drache" }, 1000))).toBe("404 unknown_series");
            const kante = await app.inject({
                method: "POST",
                url: KARTENSERIEN_UPLOADS_URL,
                payload: { operationId: randomUUID(), ziel: neu, bytes: 1000, kante: 10_000 },
                headers: { origin: TEST_ORIGIN, cookie: operator.cookie },
            });
            expect(code(kante)).toBe("400 kartenserien_kante");
            process.env["MAP_SERIES_MIN_FREE_GB"] = "1000000000";
            expect(code(await anlegen(neu, 1000))).toBe("507 kartenserien_platz");
        });

        it("🔴 Rechte der Jobs-Rolle: Kante und Stufe ja, löschen ja (Papierkorb nach Frist, Schnitt 4), sonst nichts an der Tafel", async () => {
            expect(
                await cluster!.codesAs(cluster!.jobs, [
                    "INSERT INTO map_series (series_id, source_pixels, max_native_zoom) VALUES ('nacht', 8192, 4)",
                    "UPDATE map_series SET max_native_zoom = 5 WHERE series_id = 'modern'",
                    "UPDATE map_series SET label = 'x' WHERE series_id = 'modern'",
                    "INSERT INTO map_series (series_id, label) VALUES ('tag', 'Tag')",
                    "DELETE FROM map_series",
                ]),
            ).toEqual(["ok", "ok", "42501", "42501", "ok"]);
        });

        it("🔴 Rückweg: auf die vorige Fassung umschalten schreibt current.json und ein Ereignis", async () => {
            const tiles = join(wurzel, "tiles");
            const fassung = async (revision: string) => {
                await mkdir(join(tiles, "modern", revision, "0", "0"), { recursive: true });
                await writeFile(join(tiles, "modern", revision, "0", "0", "0.webp"), revision);
                const zeiger = {
                    schemaVersion: 1,
                    series: "modern",
                    revision,
                    manifest: `${revision}${"0".repeat(52)}`,
                    format: "webp",
                    tileSize: 512,
                    maxNativeZoom: 6,
                };
                await writeFile(join(tiles, "modern", `${revision}.json`), `${JSON.stringify(zeiger)}\n`);
                return zeiger;
            };
            await fassung("111111111111");
            await schalteUmAuf(tiles, (await fassung("222222222222")) as never);
            const lies = async () =>
                (
                    await app.inject({ method: "GET", url: KARTENSERIEN_URL, headers: { cookie: operator.cookie } })
                ).json<AdminKartenserien>();
            const vorher = await lies();
            expect(
                vorher.serien
                    .find((s) => s.serie.id === "modern")
                    ?.fassungen.map((f) => f.revision)
                    .sort(),
            ).toEqual(["111111111111", "222222222222"]);
            const zurueck = await app.inject({
                method: "POST",
                url: KARTENSERIEN_URL,
                payload: {
                    operationId: randomUUID(),
                    baseRevision: vorher.revision,
                    id: "modern",
                    aktion: { art: "fassung", revision: "111111111111" },
                },
                headers: { origin: TEST_ORIGIN, cookie: operator.cookie },
            });
            expect(code(zurueck)).toBe("200");
            expect((await leseZeiger(tiles, "modern"))?.revision).toBe("111111111111");
            const nochmal = await app.inject({
                method: "POST",
                url: KARTENSERIEN_URL,
                payload: {
                    operationId: randomUUID(),
                    baseRevision: (await lies()).revision,
                    id: "modern",
                    aktion: { art: "fassung", revision: "111111111111" },
                },
                headers: { origin: TEST_ORIGIN, cookie: operator.cookie },
            });
            expect(code(nochmal)).toBe("409 no_change");
        });
    },
);
