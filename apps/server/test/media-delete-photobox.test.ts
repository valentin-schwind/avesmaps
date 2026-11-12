import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    MEDIA_UPLOAD_URL,
    mediaDeleteUrl,
    mediaPhotoboxUrl,
    mediaSuspendLiftUrl,
    mediaSuspendUrl,
    type OperationReceipt,
    type PhotoboxEinreichung,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { ApiError } from "../src/http/api-error.ts";
import { assetDetail } from "../src/media-editor/detail.ts";
import { settleAssetFiles } from "../src/media-editor/settle.ts";
import { usageOf } from "../src/media-editor/usage.ts";
import { gehalteneAssets, gehalteneQuellbytes } from "../src/media/notaus.ts";
import { MediaStore } from "../src/media/storage.ts";
import { technikNachziehen } from "../src/photobox/db.ts";
import { einreichen } from "../src/photobox/einreichen.ts";
import { beschreibungSetzen, bildErsetzen, statusLesen } from "../src/photobox/status.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type TestPerson } from "./support/auth-fixture.ts";
import { cleanMediaFixtures, insertGallery } from "./support/media-fixture.ts";
import {
    bytegleichesWerk,
    cleanEditorMedia,
    file,
    operation,
    pngBytes,
    uploadForm,
} from "./support/media-operations-fixture.ts";
import { einreichung, legeOrtAn, neueOperation, neueSpuren, pngUpload, raeumeAuf } from "./support/photobox-fixture.ts";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * PhotoBox-Bilder endgültig löschen, auch mit Notaus (WI-0272; Vali 2026-11-08 im Entwurf „Eingänge“ Fassung 2, Antworten „B, löschbar“ und „Ja, bauen“; Knopftexte der
 * Sitzung, keine Betreiberzitate; `media-editor/asset-delete.ts`, `photobox-loeschen.ts`, Migration 0328). Über die echte Route, mit echten Sitzungen, gegen echtes
 * PostgreSQL und einen echten Medienspeicher.
 *
 * - Ein freigegebenes Reisebild fällt samt seinen `photobox_media`-Zeilen; die Einreichung bleibt gestempelt ohne Datei im Verlauf, die Statusseite sagt es und nimmt
 *   nichts mehr an; ein bytegleiches fremdes Werk behält seine Datei; ersetzte Fassungen fallen mit.
 * - Eine offene Einreichung ist `einreichung_offen`, eine Galerie hält das Bild (`in_use`).
 * - Ein Notaus hindert kein löschbares Werk mehr: Seine Zeile bleibt ohne Verweis, die Bytes bleiben gesperrt, an einem bytegleichen Werk lässt er sich weiter erkennen
 *   und aufheben. Der Wächter verbietet jede andere Änderung weiter.
 */
describeWithDatabase(
    "PhotoBox-Bilder endgültig löschen, auch mit Notaus (WI-0272, Migration 0328)",
    { timeout: 180_000 },
    () => {
        let database: Database;
        let app: FastifyInstance;
        let mediaRoot = "";
        let store: MediaStore;
        let fixture: ReturnType<typeof authFixture>;
        const people: TestPerson[] = [];
        const cookies: string[] = [];
        const spuren = neueSpuren();
        const orte: { id: string; publicId: string }[] = [];
        /** Die Bytes, an denen diese Datei einen Notaus setzte: Ihre Zeilen räumt das Ende ab (die Fixtures finden sie ohne Werk nicht mehr). */
        const notausBytes: string[] = [];

        const config = (): ServerConfig => ({
            port: 0,
            host: "127.0.0.1",
            releaseId: "test",
            databaseUrl: undefined,
            tileRoot: undefined,
            mediaRoot,
            auth: TEST_AUTH,
        });
        const send = (url: string, payload: unknown) =>
            app.inject({
                method: "POST",
                url,
                payload: payload as object,
                headers: { origin: TEST_ORIGIN, cookie: cookies[0] ?? "" },
            });
        const code = (response: { statusCode: number; json(): unknown }): string =>
            response.statusCode < 300
                ? String(response.statusCode)
                : `${String(response.statusCode)} ${(response.json() as { error: { code: string } }).error.code}`;
        const grund = (response: { json(): unknown }): unknown =>
            (response.json() as { error: { details?: { reason?: string } } }).error.details?.reason;

        const revision = async (assetPublicId: string): Promise<number> => {
            const [row] = await database<{ revision: number }[]>`
            SELECT revision::int AS revision FROM media_asset WHERE public_id = ${assetPublicId}::uuid
        `;
            return row!.revision;
        };
        const loesche = async (assetPublicId: string) => {
            const operationId = neueOperation(spuren);
            const antwort = await send(mediaDeleteUrl(assetPublicId), {
                operationId,
                baseRevision: await revision(assetPublicId),
            });
            return { antwort, operationId };
        };
        const gibt = async (assetPublicId: string): Promise<boolean> => {
            const [row] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM media_asset WHERE public_id = ${assetPublicId}::uuid
        `;
            return row!.n === 1;
        };
        const dateien = async (assetPublicId: string) =>
            database<{ storage_key: string; storage_class: string; sha256: string }[]>`
            SELECT f.storage_key, f.storage_class, f.sha256 FROM media_file f JOIN media_asset a ON a.id = f.media_asset_id
             WHERE a.public_id = ${assetPublicId}::uuid
        `;

        interface Fall {
            body: PhotoboxEinreichung;
            publicId: string;
            id: string;
            assetPublicId: string;
        }

        /** Das aktuelle Bild (jüngster Eingang) einer Einreichung. */
        async function aktuelles(publicId: string): Promise<{ id: string; assetPublicId: string }> {
            const [row] = await database<{ id: string; asset_public_id: string }[]>`
            SELECT s.id::text AS id, a.public_id::text AS asset_public_id
              FROM media_submission s
              JOIN media_ingest i ON i.submission_id = s.id
              JOIN media_asset a ON a.id = i.media_asset_id
             WHERE s.public_id = ${publicId}::uuid
             ORDER BY i.id DESC LIMIT 1`;
            return { id: row!.id, assetPublicId: row!.asset_public_id };
        }

        /** Reicht ein Bild ein (Zustand `incoming`). */
        async function eingereicht(seed: number, patch: Partial<PhotoboxEinreichung> = {}): Promise<Fall> {
            const body = await einreichung(spuren, seed, patch);
            const { publicId } = await einreichen(database, store, "test", body);
            return { body, publicId, ...(await aktuelles(publicId)) };
        }

        /** Technisch geprüft und von der Redaktion freigegeben (`approved`, mit aktiver Verwendung in `photobox_media`). */
        async function freigegeben(fall: Fall): Promise<void> {
            await database`UPDATE media_asset SET technical_state = 'ok' WHERE public_id = ${fall.assetPublicId}::uuid`;
            await technikNachziehen(database, fall.id);
            const [stand] = await database<{ revision: number }[]>`
            SELECT revision::int AS revision FROM media_submission WHERE id = ${fall.id}::bigint`;
            const antwort = await send(mediaPhotoboxUrl(fall.publicId, "approve"), {
                operationId: neueOperation(spuren),
                baseRevision: stand!.revision,
            });
            expect(code(antwort), antwort.body).toBe("200");
        }

        async function hochladen(seed: number): Promise<string> {
            const antwort = await send(MEDIA_UPLOAD_URL, {
                operationId: operation(),
                file: file(await pngBytes(seed, 160, 90)),
                form: uploadForm({ title: `Notausbild ${String(seed)}`, role: "header" }),
            });
            expect(code(antwort), antwort.body).toBe("200");
            return (antwort.json() as OperationReceipt).affected.find((entry) => entry.kind === "media_asset")!.id;
        }

        async function notausAn(assetPublicId: string): Promise<string> {
            const antwort = await send(mediaSuspendUrl(assetPublicId), {
                operationId: operation(),
                reason: "Prüfung WI-0272",
            });
            expect(code(antwort), antwort.body).toBe("200");
            const [quelle] = (await dateien(assetPublicId)).filter((row) => row.storage_class === "private_source");
            notausBytes.push(quelle!.sha256);
            return quelle!.sha256;
        }

        const notausZeilen = async (sha256: string) =>
            database<
                { id: string; media_asset_id: string | null; reason: string; person: string | null; lifted: boolean }[]
            >`
            SELECT id::text AS id, media_asset_id::text AS media_asset_id, reason, suspended_by_person::text AS person,
                   lifted_at IS NOT NULL AS lifted
              FROM media_publication_suspension WHERE source_sha256 = ${sha256} ORDER BY id
        `;

        beforeAll(async () => {
            database = createDatabase(testDatabaseUrl as string, { max: 6 });
            await migrate(database);
            await cleanMediaFixtures(database);
            mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-loeschen-photobox-"));
            store = new MediaStore(mediaRoot);
            fixture = authFixture(database);
            const betreiberin = await fixture.person("operator", { name: "Reisebild-Löschen Betreiberin" });
            people.push(betreiberin);
            cookies.push((await fixture.session(betreiberin.id, { passkeyMinutesAgo: 1 })).cookie);
            app = buildApp({
                config: config(),
                database: createDatabase(testDatabaseUrl as string, { max: 4 }),
                logStream: { write: () => undefined },
            });
            await app.ready();
        }, 120_000);

        afterAll(async () => {
            await app?.close();
            if (notausBytes.length > 0) {
                await database`DELETE FROM media_publication_suspension WHERE source_sha256 = ANY(${notausBytes}::text[])`;
            }
            await raeumeAuf(database, spuren);
            await cleanEditorMedia(
                database,
                people.map((person) => person.id),
            );
            for (const ort of orte) await database`DELETE FROM place WHERE id = ${ort.id}::bigint`;
            await cleanMediaFixtures(database);
            await fixture?.cleanup();
            await database?.end({ timeout: 5 });
            if (mediaRoot !== "") await rm(mediaRoot, { recursive: true, force: true });
        });

        it("🔴 ein freigegebenes Reisebild fällt samt seinen Reisebild-Zeilen; die Einreichung bleibt gestempelt; ein bytegleiches fremdes Werk behält seine Datei", async () => {
            const ort = await legeOrtAn(database, "Reisebild-Löschort");
            orte.push(ort);
            const fall = await eingereicht(301, { placeId: ort.publicId });
            await freigegeben(fall);
            await settleAssetFiles(database, store, { assetPublicId: fall.assetPublicId, role: "photobox" });
            // Ein fremdes Werk mit denselben Bytes (wie Legacy): ein eigener Upload, kein Reisebild.
            const fremd = await bytegleichesWerk(database, fall.assetPublicId, "Fremdes Werk mit denselben Bytes");
            await database`UPDATE media_asset SET origin = 'editor_upload', source_system = 'avesmaps3d' WHERE public_id = ${fremd}::uuid`;

            // „Gleiche Datei“ am fremden Werk nennt das Reisebild wie die Liste: ohne Titel nach der Beschreibung des Einreichers (sonst „Bild ohne Titel“ im Blatt).
            const [reisebild] = await database<{ title: string | null; description: string | null }[]>`
                SELECT a.title, s.description FROM media_asset a
                  JOIN media_ingest i ON i.media_asset_id = a.id JOIN media_submission s ON s.id = i.submission_id
                 WHERE a.public_id = ${fall.assetPublicId}::uuid ORDER BY i.id DESC LIMIT 1
            `;
            const gleich = (await usageOf(database, fremd))?.sameFile.find((w) => w.asset.id === fall.assetPublicId);
            expect(gleich?.asset.title).toBe(reisebild!.title ?? reisebild!.description);
            expect(gleich?.asset.title).not.toBeNull();

            // Vorher: Das Inspector-Detail nennt dieselben Fakten, mit denen das Löschen entscheidet.
            const vorher = await assetDetail(database, fall.assetPublicId);
            expect(vorher?.ausPhotobox).toEqual({
                zustand: "approved",
                aktiv: true,
                anderswo: 0,
                ort: "Reisebild-Löschort",
            });
            const eigene = await dateien(fall.assetPublicId);
            expect(eigene.length).toBeGreaterThan(1);
            const original = eigene.find((row) => row.storage_class === "private_source")!;
            const sonst = eigene.filter((row) => row.storage_class !== "private_source");
            for (const row of eigene) expect(await store.exists(row.storage_key), row.storage_class).toBe(true);

            const { antwort, operationId } = await loesche(fall.assetPublicId);
            expect(code(antwort), antwort.body).toBe("200");

            expect(await gibt(fall.assetPublicId)).toBe(false);
            const [rest] = await database<
                {
                    reisebild: number;
                    approved: string | null;
                    geloescht: boolean;
                    state: string;
                    ingest: number;
                    revision: number;
                }[]
            >`
            SELECT (SELECT count(*) FROM photobox_media WHERE media_submission_id = s.id)::int AS reisebild,
                   s.approved_media_asset_id::text AS approved, s.media_deleted_at IS NOT NULL AS geloescht, s.state,
                   (SELECT count(*) FROM media_ingest WHERE submission_id = s.id)::int AS ingest, s.revision::int AS revision
              FROM media_submission s WHERE s.public_id = ${fall.publicId}::uuid
        `;
            expect(rest).toMatchObject({ reisebild: 0, approved: null, geloescht: true, state: "approved", ingest: 0 });
            // Das fremde Werk behält das Original, die eigenen gerechneten Dateien sind weg.
            expect(await gibt(fremd)).toBe(true);
            expect(await store.exists(original.storage_key)).toBe(true);
            for (const row of sonst) expect(await store.exists(row.storage_key), row.storage_class).toBe(false);

            // Das Fachprotokoll: das Werk und die Einreichung (mit IHRER Revision).
            const protokoll = await database<
                { action: string; asset: string | null; revision: number | null; details: Record<string, unknown> }[]
            >`
            SELECT action, media_asset_public_id::text AS asset, target_revision::int AS revision, details
              FROM media_audit_event WHERE operation_id = ${operationId}::uuid ORDER BY id`;
            expect(protokoll.map((zeile) => zeile.action)).toEqual(["asset.deleted", "photobox.media_deleted"]);
            expect(protokoll[0]).toMatchObject({ asset: fall.assetPublicId, details: { usages: 1 } });
            expect(protokoll[1]).toMatchObject({
                asset: fall.assetPublicId,
                revision: rest!.revision,
                details: { previous: "approved", versions: 0 },
            });

            // Die Statusseite sagt es und nimmt nichts mehr an.
            const status = await statusLesen(database, fall.body.schluessel);
            expect(status).toMatchObject({ zustand: "approved", bildEntfernt: true, vorschauBereit: false });
            expect(status?.karte).toBeUndefined();
            const aenderung = beschreibungSetzen(database, "test", {
                operationId: neueOperation(spuren),
                schluessel: fall.body.schluessel,
                beschreibung: "Noch eine Beschreibung",
            });
            await expect(aenderung).rejects.toBeInstanceOf(ApiError);
            await expect(aenderung).rejects.toMatchObject({
                code: "photobox_transition",
                details: { reason: "bild_entfernt" },
            });

            // Fremdes Werk am Ende: Sein Original fällt erst mit ihm.
            const fremdLoeschen = await send(mediaDeleteUrl(fremd), {
                operationId: operation(),
                baseRevision: await revision(fremd),
            });
            expect(code(fremdLoeschen), fremdLoeschen.body).toBe("200");
            expect(await store.exists(original.storage_key)).toBe(false);
        });

        it("🔴 ersetzte Fassungen fallen mit dem aktuellen Bild; sonst rückte die ersetzte zum Bild der freigegebenen Einreichung auf", async () => {
            const fall = await eingereicht(302);
            await bildErsetzen(database, store, "test", {
                operationId: neueOperation(spuren),
                schluessel: fall.body.schluessel,
                bild: await pngUpload(303),
            });
            const neu = { ...fall, ...(await aktuelles(fall.publicId)) };
            expect(neu.assetPublicId).not.toBe(fall.assetPublicId);
            await freigegeben(neu);

            const { antwort, operationId } = await loesche(neu.assetPublicId);
            expect(code(antwort), antwort.body).toBe("200");
            expect(await gibt(neu.assetPublicId)).toBe(false);
            expect(await gibt(fall.assetPublicId)).toBe(false);
            const quittung = antwort.json() as OperationReceipt;
            expect(quittung.affected).toEqual([
                { kind: "media_asset", id: neu.assetPublicId },
                { kind: "media_asset", id: fall.assetPublicId },
            ]);
            const protokoll = await database<{ action: string; asset: string; details: Record<string, unknown> }[]>`
            SELECT action, media_asset_public_id::text AS asset, details FROM media_audit_event WHERE operation_id = ${operationId}::uuid ORDER BY id`;
            expect(protokoll).toEqual([
                expect.objectContaining({ action: "asset.deleted", asset: neu.assetPublicId }),
                expect.objectContaining({
                    action: "asset.deleted",
                    asset: fall.assetPublicId,
                    details: expect.objectContaining({ source: neu.assetPublicId }) as unknown,
                }),
                expect.objectContaining({
                    action: "photobox.media_deleted",
                    details: { previous: "approved", versions: 1 },
                }),
            ]);
            expect(await statusLesen(database, fall.body.schluessel)).toMatchObject({
                bildEntfernt: true,
                vorschauBereit: false,
            });
        });

        it("🔴 eine offene Einreichung ist nicht löschbar: 409 einreichung_offen", async () => {
            const fall = await eingereicht(304);
            const eingegangen = await loesche(fall.assetPublicId);
            expect(code(eingegangen.antwort)).toBe("409 media_not_deletable");
            expect(grund(eingegangen.antwort)).toBe("einreichung_offen");

            await database`UPDATE media_asset SET technical_state = 'ok' WHERE public_id = ${fall.assetPublicId}::uuid`;
            await technikNachziehen(database, fall.id);
            const geprueft = await loesche(fall.assetPublicId);
            expect(grund(geprueft.antwort)).toBe("einreichung_offen");
            expect(await gibt(fall.assetPublicId)).toBe(true);
            expect((await assetDetail(database, fall.assetPublicId))?.ausPhotobox?.zustand).toBe("pending");
        });

        it("🔴 ein Reisebild, das zusätzlich in einer Galerie steht, bleibt: 409 in_use", async () => {
            const fall = await eingereicht(305);
            await freigegeben(fall);
            const galerie = await insertGallery(database, "reisebild-loeschen-galerie");
            await database`
            INSERT INTO media_gallery_item (gallery_id, media_asset_id, sort_order)
            SELECT ${galerie.id}::bigint, a.id, 0 FROM media_asset a WHERE a.public_id = ${fall.assetPublicId}::uuid`;
            expect((await assetDetail(database, fall.assetPublicId))?.ausPhotobox?.anderswo).toBe(1);
            const versuch = await loesche(fall.assetPublicId);
            expect(code(versuch.antwort)).toBe("409 media_not_deletable");
            expect(grund(versuch.antwort)).toBe("in_use");
            const [verwendung] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM photobox_media m JOIN media_asset a ON a.id = m.media_asset_id
             WHERE a.public_id = ${fall.assetPublicId}::uuid`;
            expect(verwendung!.n).toBe(1);
            await database`DELETE FROM media_gallery_item WHERE gallery_id = ${galerie.id}::bigint`;
        });

        it("🔴 ein Werk mit Notaus fällt; die Zeile bleibt ohne Verweis, und dieselben Bytes bleiben am bytegleichen Werk gesperrt und dort aufhebbar", async () => {
            const erstes = await hochladen(306);
            const zweites = await bytegleichesWerk(database, erstes, "Zwilling unter Notaus");
            const sha256 = await notausAn(erstes);
            const [vorher] = await notausZeilen(sha256);

            const { antwort, operationId } = await loesche(erstes);
            expect(code(antwort), antwort.body).toBe("200");
            expect(await gibt(erstes)).toBe(false);

            const [nachher] = await notausZeilen(sha256);
            expect(nachher).toEqual({ ...vorher, media_asset_id: null });
            const [protokoll] = await database<{ details: Record<string, unknown> }[]>`
            SELECT details FROM media_audit_event WHERE operation_id = ${operationId}::uuid AND action = 'asset.deleted'`;
            expect(protokoll?.details).toMatchObject({ suspensions: 1 });

            // Die Veröffentlichung fragt über die Prüfsumme: Das bytegleiche Werk bleibt gehalten.
            const [zwilling] = await database<
                { id: string }[]
            >`SELECT id::text AS id FROM media_asset WHERE public_id = ${zweites}::uuid`;
            expect((await gehalteneQuellbytes(database)).has(sha256)).toBe(true);
            const gehalten = await gehalteneAssets(database);
            expect(gehalten.publicIds.has(zweites)).toBe(true);
            expect(gehalten.ids.has(zwilling!.id)).toBe(true);
            // Das Detail des Zwillings nennt den Notaus weiter, nur ohne auslösendes Werk.
            const detail = await assetDetail(database, zweites);
            expect(detail?.suspensions).toEqual([
                expect.objectContaining({ sha256, triggeredOn: null, liftedAt: null }),
            ]);
            // Ein zweiter Notaus derselben Bytes ist 409 (nicht 500 am Teilindex), und aufheben geht am Zwilling.
            const doppelt = await send(mediaSuspendUrl(zweites), { operationId: operation(), reason: "Noch einmal" });
            expect(code(doppelt)).toBe("409 media_already_suspended");
            const frei = await send(mediaSuspendLiftUrl(zweites), {
                operationId: operation(),
                baseRevision: detail!.suspensions[0]!.revision,
                reason: "Geprüft, wieder frei",
            });
            expect(code(frei), frei.body).toBe("200");
            expect((await gehalteneQuellbytes(database)).has(sha256)).toBe(false);
        });

        it("🔴 der Wächter lässt nur „Werk gelöscht → NULL“ zu: kein NULL bei lebendem Werk, kein Zurück, kein anderes Werk, kein anderer Grund", async () => {
            const [fk] = await database<{ loeschregel: string; anzahl: number }[]>`
            SELECT string_agg(confdeltype::text, ',') AS loeschregel, count(*)::int AS anzahl FROM pg_constraint
             WHERE conrelid = 'media_publication_suspension'::regclass AND contype = 'f'
               AND confrelid = 'media_asset'::regclass`;
            expect(fk).toEqual({ loeschregel: "n", anzahl: 1 });

            const lebend = await hochladen(307);
            const anderes = await hochladen(308);
            const sha256 = await notausAn(lebend);
            const [zeile] = await notausZeilen(sha256);
            const [anderesWerk] = await database<
                { id: string }[]
            >`SELECT id::text AS id FROM media_asset WHERE public_id = ${anderes}::uuid`;
            const verboten = /ändern sich nie/u;
            await expect(
                database`UPDATE media_publication_suspension SET media_asset_id = NULL WHERE id = ${zeile!.id}::bigint`,
            ).rejects.toThrow(verboten);
            await expect(
                database`UPDATE media_publication_suspension SET media_asset_id = ${anderesWerk!.id}::bigint WHERE id = ${zeile!.id}::bigint`,
            ).rejects.toThrow(verboten);
            await expect(
                database`UPDATE media_publication_suspension SET reason = 'anders' WHERE id = ${zeile!.id}::bigint`,
            ).rejects.toThrow(verboten);

            // Gelöscht: Die Zeile verliert ihren Verweis; zurück auf ein Werk geht er nie wieder.
            const { antwort } = await loesche(lebend);
            expect(code(antwort), antwort.body).toBe("200");
            expect((await notausZeilen(sha256))[0]!.media_asset_id).toBeNull();
            await expect(
                database`UPDATE media_publication_suspension SET media_asset_id = ${anderesWerk!.id}::bigint WHERE id = ${zeile!.id}::bigint`,
            ).rejects.toThrow(verboten);
            // Der Dateizustand folgt den Dateien weiter (der Job schreibt ihn).
            await database`UPDATE media_publication_suspension SET file_state = 'quarantined' WHERE id = ${zeile!.id}::bigint`;
        });

        it("eine Einreichung ohne Werk ist nur mit Zeitpunkt des Löschens erlaubt (gelockerte Prüfung aus 0274)", async () => {
            const fall = await eingereicht(309);
            await freigegeben(fall);
            await expect(
                database`UPDATE media_submission SET approved_media_asset_id = NULL WHERE id = ${fall.id}::bigint`,
            ).rejects.toThrow(/media_submission_approved_has_asset/u);
        });
    },
);
