import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    MEDIA_KARTE_DATEI_URL,
    MEDIA_KARTEN_URL,
    mediaDeleteUrl,
    mediaEditorAssetUrl,
    mediaKarteBildUrl,
    mediaKarteStilllegenUrl,
    mediaKarteUrl,
    mediaKarteVorschauUrl,
    mediaKarteZurueckholenUrl,
    type MamKarteDetail,
    type MediaAssetDetail,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { detail as vorschlagDetail } from "../src/kartenvorschlag/redaktion.ts";
import { MEDIA_EDITOR_SOURCE_SYSTEM } from "../src/media-editor/upload.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";
import { cleanMediaFixtures } from "./support/media-fixture.ts";
import { cleanEditorMedia, pngBytes } from "./support/media-operations-fixture.ts";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/** Die Fassung der Bedingungen, an der dieser Test seine Vorschläge wiedererkennt (Aufräumen). */
const BEDINGUNGEN = "kv-loeschen-test";

/**
 * Ein Bild aus einem Kartenvorschlag endgültig löschen (WI-0287; Vali 2026-11-07 auf „Soll der Betreiber Bilder aus Vorschlägen an stillgelegten Einträgen endgültig
 * löschen dürfen?“: „Ja, erlauben“; `media-editor/vorschlag-loeschen.ts`, `asset-delete.ts`, Migration 0322).
 *
 * Fälle: Solange ein Eintrag gilt, ist es 409 `vorschlag_aktiv`; nach dem Entfernen fällt es samt Bindung, der Vorschlag bleibt ohne Werk mit Zeitpunkt, der Eintrag
 * lässt sich ohne Bild zurückholen; eine erzeugte Vorschau fällt mit; ein zweiter Eintrag, der gilt, oder ein offener Vorschlag hält es fest; ein Community-Upload
 * ohne Vorschlag bleibt gesperrt.
 */
describeWithDatabase(
    "Bild aus einem Kartenvorschlag endgültig löschen (WI-0287, Vali 2026-11-07)",
    { timeout: 180_000 },
    () => {
        let database: Database;
        let app: FastifyInstance;
        let mediaRoot = "";
        let cookie = "";
        let personId = "";
        let fixture: ReturnType<typeof authFixture>;
        let seed = 1400;
        const config = (): ServerConfig => ({
            port: 0,
            host: "127.0.0.1",
            releaseId: "test",
            databaseUrl: undefined,
            tileRoot: undefined,
            mediaRoot,
            auth: TEST_AUTH,
        });
        const post = (url: string, payload: Record<string, unknown>) =>
            app.inject({ method: "POST", url, headers: { origin: TEST_ORIGIN, cookie }, payload });
        const hole = async <T>(url: string): Promise<T> =>
            (await app.inject({ method: "GET", url, headers: { origin: TEST_ORIGIN, cookie } })).json();
        const code = (antwort: { statusCode: number; json(): unknown }): string =>
            antwort.statusCode < 300
                ? String(antwort.statusCode)
                : `${String(antwort.statusCode)} ${(antwort.json() as { error: { code: string } }).error.code}`;
        const grund = (antwort: { json(): unknown }): unknown =>
            (antwort.json() as { error: { details?: { reason?: string } } }).error.details?.reason;
        const revisionVon = async (assetId: string): Promise<number> => {
            const [zeile] = await database<{ revision: number }[]>`
            SELECT revision::int AS revision FROM media_asset WHERE public_id = ${assetId}::uuid
        `;
            return zeile!.revision;
        };
        const loesche = async (assetId: string) =>
            post(mediaDeleteUrl(assetId), { operationId: randomUUID(), baseRevision: await revisionVon(assetId) });
        const eintragsStand = async (id: string): Promise<number> =>
            (await hole<MamKarteDetail>(mediaKarteUrl(id))).revision;
        const gibtEs = async (assetId: string): Promise<boolean> => {
            const [zeile] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM media_asset WHERE public_id = ${assetId}::uuid
        `;
            return zeile!.n === 1;
        };

        /** Eine Kartendatei über die Route (eigenes Werk, damit „Vorschau erzeugen“ geht), danach umgeschrieben zum Bild eines Vorschlags. */
        async function vorschlagsWerk(): Promise<string> {
            const kopf = Buffer.from(
                JSON.stringify({
                    operationId: randomUUID(),
                    name: "karte.png",
                    form: {
                        title: `Karte der Löschprobe ${String(seed)}`,
                        role: "map_full",
                        creationMethod: "drawing",
                        rights: {
                            basis: "own_work",
                            creator: "Elwe",
                            rightsHolder: "Elwe",
                            attribution: "Karte: Elwe",
                        },
                    },
                }),
                "utf8",
            );
            const laenge = Buffer.alloc(4);
            laenge.writeUInt32BE(kopf.byteLength);
            const antwort = await app.inject({
                method: "PUT",
                url: MEDIA_KARTE_DATEI_URL,
                headers: { origin: TEST_ORIGIN, cookie, "content-type": "application/octet-stream" },
                payload: Buffer.concat([laenge, kopf, await pngBytes(seed++, 320, 200)]),
            });
            expect(antwort.statusCode, antwort.body).toBe(200);
            const werk = (antwort.json() as OperationReceipt).affected.find(
                (eintrag) => eintrag.kind === "media_asset",
            )!.id;
            await database`
            UPDATE media_asset SET origin = 'community_upload', source_system = 'kartenvorschlag' WHERE public_id = ${werk}::uuid
        `;
            return werk;
        }
        /** Ein Eintrag mit diesem Werk als Karte. */
        async function eintragMit(titel: string, werk: string): Promise<string> {
            const angelegt = await post(MEDIA_KARTEN_URL, {
                operationId: randomUUID(),
                fields: { title: titel },
                types: [],
                places: [],
            });
            expect(angelegt.statusCode, angelegt.body).toBe(200);
            const id = (angelegt.json() as OperationReceipt).affected.find((eintrag) => eintrag.kind === "citymap")!.id;
            const gebunden = await post(mediaKarteBildUrl(id), {
                operationId: randomUUID(),
                baseRevision: await eintragsStand(id),
                role: "map_full",
                assetId: werk,
            });
            expect(gebunden.statusCode, gebunden.body).toBe(200);
            return id;
        }
        /** Der Vorschlag hinter dem Werk, wie ihn die Annahme hinterlässt (oder in einem anderen Zustand). */
        async function vorschlag(werk: string, eintrag: string | null, state = "approved"): Promise<string> {
            const entschieden = state === "approved" || state === "rejected" ? new Date() : null;
            const [zeile] = await database<{ public_id: string }[]>`
            INSERT INTO citymap_suggestion (operation_id, state, status_key_hash, way, title, file_mime, media_asset_id, usage_grant, terms_version,
                                            decided_at, accepted_citymap_id)
            VALUES (${randomUUID()}::uuid, ${state}, ${createHash("sha256").update(randomUUID()).digest()}, 'file', 'Lösch mich bitte', 'image/png',
                    (SELECT id FROM media_asset WHERE public_id = ${werk}::uuid), 'avesmaps_only', ${BEDINGUNGEN}, ${entschieden},
                    (SELECT id FROM citymap WHERE public_id = ${eintrag}::uuid))
            RETURNING public_id::text AS public_id
        `;
            return zeile!.public_id;
        }
        const entferne = async (id: string) =>
            expect(
                code(
                    await post(mediaKarteStilllegenUrl(id), {
                        operationId: randomUUID(),
                        baseRevision: await eintragsStand(id),
                    }),
                ),
            ).toBe("200");
        const ausVorschlag = async (werk: string) =>
            (await hole<MediaAssetDetail>(mediaEditorAssetUrl(werk))).ausVorschlag;

        const aufraeumen = async (): Promise<void> => {
            await database`DELETE FROM citymap_suggestion WHERE terms_version = ${BEDINGUNGEN}`;
            // Was stehen blieb, bekommt seine Herkunft zurück, damit `cleanEditorMedia` es mit wegräumt (sonst lehnte der nächste Lauf dieselben Bytes ab).
            await database`
            UPDATE media_asset SET origin = 'editor_upload', source_system = ${MEDIA_EDITOR_SOURCE_SYSTEM}
             WHERE title LIKE 'Karte der Löschprobe%' AND source_system = 'kartenvorschlag'
        `;
            const ids = (
                await database<{ id: string }[]>`
                SELECT id::text AS id FROM citymap WHERE title LIKE '%Löschprobe%' AND source_system = 'avesmaps3d'
            `
            ).map((zeile) => zeile.id);
            await database`DELETE FROM citymap_media WHERE citymap_id = ANY(${ids}::bigint[])`;
            await database`
            DELETE FROM media_audit_event WHERE citymap_public_id IN (SELECT public_id FROM citymap WHERE id = ANY(${ids}::bigint[]))
        `;
            await database`DELETE FROM citymap WHERE id = ANY(${ids}::bigint[])`;
        };

        beforeAll(async () => {
            database = createDatabase(testDatabaseUrl as string, { max: 4 });
            await migrate(database);
            await aufraeumen();
            await cleanMediaFixtures(database);
            fixture = authFixture(database);
            const betreiberin = await fixture.person("operator", { name: "Vorschlag Löscherin" });
            personId = betreiberin.id;
            cookie = (await fixture.session(betreiberin.id, { passkeyMinutesAgo: 1 })).cookie;
            await cleanEditorMedia(database, [personId]);
            mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-vorschlag-loeschen-"));
            app = buildApp({
                config: config(),
                database: createDatabase(testDatabaseUrl as string, { max: 4 }),
                logStream: { write: () => undefined },
            });
            await app.ready();
        }, 120_000);

        afterAll(async () => {
            await app?.close();
            await aufraeumen();
            await cleanEditorMedia(database, [personId]);
            await cleanMediaFixtures(database);
            await fixture?.cleanup();
            await database?.end({ timeout: 5 });
            if (mediaRoot !== "") await rm(mediaRoot, { recursive: true, force: true });
        });

        it("🔴 solange der Eintrag gilt 409 vorschlag_aktiv; entfernt fällt es samt Bindung, der Vorschlag bleibt ohne Werk, der Eintrag kommt ohne Bild zurück", async () => {
            const werk = await vorschlagsWerk();
            const eintrag = await eintragMit("Porto Paligan Löschprobe", werk);
            const vorschlagId = await vorschlag(werk, eintrag);

            // OPS-000093: Das Detail nennt den Vorschlag hinter dem Bild (Kennung, Nummer, Zustand), damit der Inspector in die Redaktion führen kann.
            const hinter = (await hole<MediaAssetDetail>(mediaEditorAssetUrl(werk))).kartenvorschlag;
            expect(hinter).toMatchObject({ id: vorschlagId, zustand: "approved" });
            expect(hinter?.nummer).toMatch(/^K-\d+$/u);

            expect(await ausVorschlag(werk)).toEqual({
                nurStillgelegt: false,
                eintraege: ["Porto Paligan Löschprobe"],
                vorschauen: 0,
            });
            const gilt = await loesche(werk);
            expect(code(gilt)).toBe("409 media_not_deletable");
            expect(grund(gilt)).toBe("vorschlag_aktiv");

            await entferne(eintrag);
            expect(await ausVorschlag(werk)).toEqual({
                nurStillgelegt: true,
                eintraege: ["Porto Paligan Löschprobe"],
                vorschauen: 0,
            });
            const antwort = await loesche(werk);
            expect(code(antwort)).toBe("200");
            expect((antwort.json() as OperationReceipt).affected).toEqual([{ kind: "media_asset", id: werk }]);

            expect(await gibtEs(werk)).toBe(false);
            const [stand] = await database<
                { bindungen: number; asset: string | null; geloescht: boolean; state: string }[]
            >`
            SELECT (SELECT count(*) FROM citymap_media m JOIN citymap c ON c.id = m.citymap_id WHERE c.public_id = ${eintrag}::uuid)::int AS bindungen,
                   s.media_asset_id::text AS asset, s.media_deleted_at IS NOT NULL AS geloescht, s.state
              FROM citymap_suggestion s WHERE s.public_id = ${vorschlagId}::uuid
        `;
            expect(stand).toEqual({ bindungen: 0, asset: null, geloescht: true, state: "approved" });
            const protokoll = await database<
                { action: string; citymap: string | null; details: Record<string, unknown> }[]
            >`
            SELECT action, citymap_public_id::text AS citymap, details FROM media_audit_event
             WHERE media_asset_public_id = ${werk}::uuid AND action IN ('asset.deleted', 'citymap.updated') ORDER BY id
        `;
            expect(protokoll.slice(-2)).toEqual([
                {
                    action: "asset.deleted",
                    citymap: null,
                    details: { files: expect.any(Number), evidence: 0, usages: 1, previews: 0 },
                },
                { action: "citymap.updated", citymap: eintrag, details: { fields: ["images"] } },
            ]);

            // Die Redaktion sieht den Vorschlag weiter, mit dem Zeitpunkt statt der Datei.
            const inDerRedaktion = await vorschlagDetail(database, vorschlagId);
            expect(inDerRedaktion).toMatchObject({
                asset: null,
                dateiGeloeschtAm: expect.any(String),
                zustand: "approved",
            });

            const zurueck = await post(mediaKarteZurueckholenUrl(eintrag), {
                operationId: randomUUID(),
                baseRevision: await eintragsStand(eintrag),
            });
            expect(code(zurueck)).toBe("200");
            expect((await hole<MamKarteDetail>(mediaKarteUrl(eintrag))).images).toEqual([]);
        });

        it("🔴 die daraus erzeugte Vorschau fällt mit, samt ihrer Bindung", async () => {
            const werk = await vorschlagsWerk();
            const eintrag = await eintragMit("Re'Cha Löschprobe", werk);
            await vorschlag(werk, eintrag);
            const erzeugt = await post(mediaKarteVorschauUrl(eintrag), {
                operationId: randomUUID(),
                baseRevision: await eintragsStand(eintrag),
                sourceAssetId: werk,
                title: "Vorschau von „Re'Cha Löschprobe“",
            });
            expect(erzeugt.statusCode, erzeugt.body).toBe(200);
            const vorschau = (erzeugt.json() as OperationReceipt).affected.find((e) => e.kind === "media_asset")!.id;

            await entferne(eintrag);
            expect(await ausVorschlag(werk)).toEqual({
                nurStillgelegt: true,
                eintraege: ["Re'Cha Löschprobe"],
                vorschauen: 1,
            });
            const antwort = await loesche(werk);
            expect(code(antwort)).toBe("200");
            expect((antwort.json() as OperationReceipt).affected).toEqual([
                { kind: "media_asset", id: werk },
                { kind: "media_asset", id: vorschau },
            ]);
            expect(await gibtEs(werk)).toBe(false);
            expect(await gibtEs(vorschau)).toBe(false);
            const [zeile] = await database<{ details: Record<string, unknown> }[]>`
            SELECT details FROM media_audit_event WHERE media_asset_public_id = ${vorschau}::uuid AND action = 'asset.deleted'
        `;
            expect(zeile!.details).toEqual({ files: expect.any(Number), evidence: 0, usages: 1, source: werk });
            const [werkZeile] = await database<{ details: Record<string, unknown> }[]>`
            SELECT details FROM media_audit_event WHERE media_asset_public_id = ${werk}::uuid AND action = 'asset.deleted'
        `;
            expect(werkZeile!.details).toMatchObject({ usages: 2, previews: 1 });
        });

        it("🔴 ein zweiter Eintrag, der gilt, oder ein offener Vorschlag hält es fest (409 vorschlag_aktiv)", async () => {
            const werk = await vorschlagsWerk();
            const erster = await eintragMit("Sylla Löschprobe", werk);
            const zweiter = await eintragMit("Sylla SL Löschprobe", werk);
            await vorschlag(werk, erster);
            await entferne(erster);
            const zweiGelten = await loesche(werk);
            expect(code(zweiGelten)).toBe("409 media_not_deletable");
            expect(grund(zweiGelten)).toBe("vorschlag_aktiv");

            await entferne(zweiter);
            await vorschlag(werk, null, "pending");
            expect((await ausVorschlag(werk))?.nurStillgelegt).toBe(false);
            const offen = await loesche(werk);
            expect(code(offen)).toBe("409 media_not_deletable");
            expect(grund(offen)).toBe("vorschlag_aktiv");
            expect(await gibtEs(werk)).toBe(true);
        });

        // WI-0272 (2026-11-08): Der Grund nennt, was das Werk ist; „importiert“ (`legacy`) steht nur noch an echten Importen.
        it("ein Community-Upload ohne Vorschlag bleibt gesperrt (409 eingesandt)", async () => {
            const werk = await vorschlagsWerk();
            const eintrag = await eintragMit("Ohne Vorschlag Löschprobe", werk);
            await entferne(eintrag);
            expect(await ausVorschlag(werk)).toBeUndefined();
            const antwort = await loesche(werk);
            expect(code(antwort)).toBe("409 media_not_deletable");
            expect(grund(antwort)).toBe("eingesandt");
        });
    },
);
