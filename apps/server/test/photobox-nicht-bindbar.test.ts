import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
    MEDIA_COAT_BIND_URL,
    MEDIA_GALLERY_ADD_URL,
    MEDIA_GALLERY_CREATE_URL,
    MEDIA_HEADER_SET_URL,
    MEDIA_TYPE_IMAGE_SET_URL,
    MEDIA_UPLOAD_URL,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { MediaStore } from "../src/media/storage.ts";
import { einreichen } from "../src/photobox/einreichen.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type TestPerson } from "./support/auth-fixture.ts";
import { cleanMediaFixtures, insertPlace } from "./support/media-fixture.ts";
import { cleanEditorMedia, file, operation, pngBytes, uploadForm } from "./support/media-operations-fixture.ts";
import { einreichung, neueSpuren, raeumeAuf } from "./support/photobox-fixture.ts";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * Reisebilder bleiben in ihren Rollen (WI-0272 S3, Fixrunde Block F, Review I7; §13): Kein Editor bindet ein Reisebild (`source_system = 'photobox'`) als Wappen oder
 * Titelbild, legt es in eine Galerie oder macht es zum Typbild. Der Server antwortet 409 `media_photobox_not_bindable`, vor jeder anderen Prüfung des Typs; es
 * bleibt keine Bindung zurück. Ein gewöhnliches Bild geht an denselben Stellen weiter durch (Gegenprobe).
 *
 * Die Auswahl in der Oberfläche filtert noch nicht nach Herkunft (offen, S5 bekommt eine eigene Galerie je Ort).
 */

describeWithDatabase("Reisebilder sind nicht bindbar (WI-0272 S3, Fixrunde F)", { timeout: 180_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let mediaRoot = "";
    let store: MediaStore;
    let fixture: ReturnType<typeof authFixture>;
    const people: TestPerson[] = [];
    let cookie = "";
    let ort = "";
    let ortDb = "";
    let normal = "";
    let reise = "";
    let galerie: { id: string; revision: number } = { id: "", revision: 0 };
    const spuren = neueSpuren();

    const config = (): ServerConfig => ({
        port: 0,
        host: "127.0.0.1",
        releaseId: "photobox-nicht-bindbar-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        mediaRoot,
        auth: TEST_AUTH,
    });

    const post = async (
        url: string,
        payload: object,
    ): Promise<{ status: number; code: string | undefined; body: unknown }> => {
        const antwort = await app.inject({
            method: "POST",
            url,
            payload: { operationId: operation(), ...payload },
            headers: { origin: TEST_ORIGIN, cookie },
        });
        const body = antwort.json() as unknown;
        return { status: antwort.statusCode, code: (body as { error?: { code?: string } }).error?.code, body };
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 6 });
        await migrate(database);
        await cleanMediaFixtures(database);
        mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-photobox-nicht-bindbar-"));
        store = new MediaStore(mediaRoot);
        fixture = authFixture(database);
        const person = await fixture.person("editor", { name: "Nicht bindbar Redakteur" });
        people.push(person);
        cookie = (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie;
        app = buildApp({
            config: config(),
            database: createDatabase(testDatabaseUrl as string, { max: 4 }),
            logStream: { write: () => undefined },
        });
        await app.ready();

        const hochgeladen = await app.inject({
            method: "POST",
            url: MEDIA_UPLOAD_URL,
            payload: {
                operationId: operation(),
                file: file(await pngBytes(81, 160, 90), "titel-81.png"),
                form: uploadForm({ title: "Gewöhnliches Titelbild", role: "header", creationMethod: "ai_generated" }),
            },
            headers: { origin: TEST_ORIGIN, cookie },
        });
        expect(hochgeladen.statusCode, hochgeladen.body).toBe(200);
        normal = (hochgeladen.json() as OperationReceipt).affected.find(
            (eintrag) => eintrag.kind === "media_asset",
        )!.id;

        const angelegt = await insertPlace(database, 96);
        ort = angelegt.publicId;
        ortDb = angelegt.id;

        // Ein Reisebild, so wie die Einreichung eines Besuchers es anlegt (Asset im Quellsystem photobox, Typ picture).
        const { publicId } = await einreichen(database, store, "test", await einreichung(spuren, 81));
        const [asset] = await database<{ public_id: string }[]>`
            SELECT a.public_id::text AS public_id
              FROM media_submission s JOIN media_ingest i ON i.submission_id = s.id JOIN media_asset a ON a.id = i.media_asset_id
             WHERE s.public_id = ${publicId}::uuid`;
        reise = asset!.public_id;

        const neu = await post(MEDIA_GALLERY_CREATE_URL, { title: "Hafen" });
        expect(neu.status, JSON.stringify(neu.body)).toBe(200);
        const eintrag = (neu.body as OperationReceipt).affected.find((e) => e.kind === "gallery")!;
        galerie = { id: eintrag.id, revision: eintrag.revision! };
    }, 150_000);

    afterEach(async () => {
        await database`DELETE FROM place_media WHERE place_id = ${ortDb}::bigint`;
    });

    afterAll(async () => {
        await app?.close();
        await raeumeAuf(database, spuren);
        await cleanEditorMedia(
            database,
            people.map((person) => person.id),
        );
        await cleanMediaFixtures(database);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
        if (mediaRoot !== "") await rm(mediaRoot, { recursive: true, force: true });
    });

    const bindungen = async (assetPublicId: string): Promise<number> =>
        (
            await database<{ n: number }[]>`
                SELECT (SELECT count(*) FROM place_media pm JOIN media_asset a ON a.id = pm.media_asset_id WHERE a.public_id = ${assetPublicId}::uuid)::int
                     + (SELECT count(*) FROM media_gallery_item gi JOIN media_asset a ON a.id = gi.media_asset_id WHERE a.public_id = ${assetPublicId}::uuid)::int
                     + (SELECT count(*) FROM media_type_image ti JOIN media_asset a ON a.id = ti.media_asset_id WHERE a.public_id = ${assetPublicId}::uuid)::int AS n`
        )[0]!.n;

    it("🔴 das Reisebild ist ein Reisebild des Quellsystems photobox", async () => {
        const [row] = await database<{ source_system: string; asset_type: string }[]>`
            SELECT source_system, asset_type FROM media_asset WHERE public_id = ${reise}::uuid`;
        expect(row).toEqual({ source_system: "photobox", asset_type: "picture" });
    });

    it("🔴 als Titelbild eines Ortes: 409 media_photobox_not_bindable, keine Bindung; ein gewöhnliches Bild geht", async () => {
        const abgewiesen = await post(MEDIA_HEADER_SET_URL, { placeId: ort, assetId: reise, baseState: "undecided" });
        expect([abgewiesen.status, abgewiesen.code]).toEqual([409, "media_photobox_not_bindable"]);
        expect(await bindungen(reise)).toBe(0);

        const gegenprobe = await post(MEDIA_HEADER_SET_URL, { placeId: ort, assetId: normal, baseState: "undecided" });
        expect(gegenprobe.status, JSON.stringify(gegenprobe.body)).toBe(200);
        expect(await bindungen(normal)).toBe(1);
    });

    it("🔴 als Wappen: 409 media_photobox_not_bindable noch vor der Prüfung des Typs", async () => {
        const abgewiesen = await post(MEDIA_COAT_BIND_URL, {
            subject: { kind: "place", id: ort },
            assetId: reise,
            baseState: "undecided",
        });
        expect([abgewiesen.status, abgewiesen.code]).toEqual([409, "media_photobox_not_bindable"]);
        expect(await bindungen(reise)).toBe(0);
    });

    it("🔴 in einer Galerie: 409 media_photobox_not_bindable, die Galerie bleibt leer; ein gewöhnliches Bild geht", async () => {
        const abgewiesen = await post(MEDIA_GALLERY_ADD_URL, {
            galleryId: galerie.id,
            baseRevision: galerie.revision,
            assetId: reise,
        });
        expect([abgewiesen.status, abgewiesen.code]).toEqual([409, "media_photobox_not_bindable"]);
        expect(await bindungen(reise)).toBe(0);

        const gegenprobe = await post(MEDIA_GALLERY_ADD_URL, {
            galleryId: galerie.id,
            baseRevision: galerie.revision,
            assetId: normal,
        });
        expect(gegenprobe.status, JSON.stringify(gegenprobe.body)).toBe(200);
    });

    it("🔴 als Typbild: 409 media_photobox_not_bindable, kein ★", async () => {
        const abgewiesen = await post(MEDIA_TYPE_IMAGE_SET_URL, { category: "dorf", assetId: reise });
        expect([abgewiesen.status, abgewiesen.code]).toEqual([409, "media_photobox_not_bindable"]);
        expect(await bindungen(reise)).toBe(0);
    });
});
