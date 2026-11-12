import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    MEDIA_GALLERY_ADD_URL,
    MEDIA_GALLERY_BIND_URL,
    MEDIA_GALLERY_CREATE_URL,
    MEDIA_GALLERY_UNBIND_URL,
    MEDIA_HEADER_NONE_URL,
    MEDIA_HEADER_SET_URL,
    MEDIA_UPLOAD_URL,
    mediaSubjectSlotsUrl,
    type MediaSubjectSlots,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { resolvePlaceMedia } from "../src/media/resolver.ts";
import { MediaStore } from "../src/media/storage.ts";
import { settleAssetFiles } from "../src/media-editor/settle.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type TestPerson } from "./support/auth-fixture.ts";
import { cleanMediaFixtures, insertPlace } from "./support/media-fixture.ts";
import { cleanEditorMedia, file, operation, pngBytes, uploadForm } from "./support/media-operations-fixture.ts";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * EIN Titelbild ODER EINE Galerie (WI-0219; Betreiber 2026-10-17: „er kann nicht mehr wie ein bild haben, EIN titelbild oder EINE
 * Galerie“). Das Titelbild ist eine Einzelbindung (`header.set`), die Galerie eine Galerie der Medienverwaltung (`gallery.bind`). Jede
 * Wahl ersetzt, was bisher hängt; das Alte wird nur gelöst und bleibt in der Medienverwaltung.
 */
describeWithDatabase("Titelbild ODER Galerie am Ort (WI-0219)", { timeout: 180_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let mediaRoot = "";
    let store: MediaStore;
    let ruleId = "";
    let fixture: ReturnType<typeof authFixture>;
    const people: TestPerson[] = [];
    let cookie = "";
    const bilder: string[] = [];
    let ort = "";
    let ortDb = "";
    const galerien: { id: string; revision: number }[] = [];

    const config = (): ServerConfig => ({
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        mediaRoot,
        auth: TEST_AUTH,
    });

    const post = async (url: string, payload: object): Promise<{ status: number; body: unknown }> => {
        const antwort = await app.inject({
            method: "POST",
            url,
            payload: { operationId: operation(), ...payload },
            headers: { origin: TEST_ORIGIN, cookie },
        });
        return { status: antwort.statusCode, body: antwort.json() as unknown };
    };
    const fehler = (body: unknown): string | undefined => (body as { error?: { code?: string } }).error?.code;
    const ok = async (url: string, payload: object): Promise<OperationReceipt> => {
        const { status, body } = await post(url, payload);
        expect(status, `${url}: ${JSON.stringify(body)}`).toBe(200);
        const quittung = body as OperationReceipt;
        for (const eintrag of quittung.affected) {
            const galerie = galerien.find((g) => g.id === eintrag.id);
            if (eintrag.kind === "gallery" && galerie !== undefined && eintrag.revision !== undefined)
                galerie.revision = eintrag.revision;
        }
        return quittung;
    };
    const plaetze = async (): Promise<MediaSubjectSlots> => {
        const antwort = await app.inject({
            method: "GET",
            url: mediaSubjectSlotsUrl("place", ort),
            headers: { origin: TEST_ORIGIN, cookie },
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        return antwort.json() as MediaSubjectSlots;
    };
    /** Was am Ort hängt: das Einzelbild, die Galerie und ob er „bewusst ohne“ ist. */
    const stand = async () => {
        const kopf = (await plaetze()).header!;
        return { bild: kopf.image?.asset.id ?? null, galerie: kopf.gallery?.id ?? null, ohne: kopf.suppressed };
    };
    const aktiveBindungen = async (): Promise<{ bilder: number; galerien: number }> => {
        const [zahl] = await database<{ bilder: number; galerien: number }[]>`
            SELECT (SELECT count(*)::int FROM place_media WHERE place_id = ${ortDb} AND role = 'header' AND retired_at IS NULL) AS bilder,
                   (SELECT count(*)::int FROM place_media_gallery WHERE place_id = ${ortDb} AND role = 'header' AND retired_at IS NULL) AS galerien
        `;
        return zahl!;
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 6 });
        await migrate(database);
        await cleanMediaFixtures(database);
        mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-titelbild-galerie-"));
        store = new MediaStore(mediaRoot);
        fixture = authFixture(database);
        const person = await fixture.person("editor", { name: "Titelbild Redakteur" });
        people.push(person);
        cookie = (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie;
        // Eine Regel, nach der die Testbilder öffentlich werden dürfen: Erst dann zeigt der Resolver überhaupt etwas.
        const [rule] = await database<{ id: string }[]>`
            INSERT INTO publication_rule (rights_basis, creation_method, role, scope_text, operator_quote, decided_on)
            VALUES ('own_work', 'ai_generated', 'header', 'media-test Titelbild oder Galerie', 'Testzitat', '2026-10-17')
            RETURNING id::text AS id
        `;
        ruleId = rule!.id;
        app = buildApp({
            config: config(),
            database: createDatabase(testDatabaseUrl as string, { max: 4 }),
            logStream: { write: () => undefined },
        });
        await app.ready();
        for (const seed of [71, 72, 73]) {
            const hochgeladen = await app.inject({
                method: "POST",
                url: MEDIA_UPLOAD_URL,
                payload: {
                    operationId: operation(),
                    file: file(await pngBytes(seed, 160, 90), `titel-${String(seed)}.png`),
                    form: uploadForm({
                        title: `Titelbild ${String(seed)}`,
                        role: "header",
                        creationMethod: "ai_generated",
                    }),
                },
                headers: { origin: TEST_ORIGIN, cookie },
            });
            expect(hochgeladen.statusCode, hochgeladen.body).toBe(200);
            bilder.push(
                (hochgeladen.json() as OperationReceipt).affected.find((eintrag) => eintrag.kind === "media_asset")!.id,
            );
        }
        const angelegt = await insertPlace(database, 95);
        ort = angelegt.publicId;
        ortDb = angelegt.id;
        for (const titel of ["Hafen", "Markt"]) {
            const quittung = await ok(MEDIA_GALLERY_CREATE_URL, { title: titel });
            const neu = quittung.affected.find((eintrag) => eintrag.kind === "gallery")!;
            galerien.push({ id: neu.id, revision: neu.revision! });
        }
        await ok(MEDIA_GALLERY_ADD_URL, {
            galleryId: galerien[0]!.id,
            baseRevision: galerien[0]!.revision,
            assetId: bilder[2],
        });
    }, 150_000);

    afterAll(async () => {
        await app?.close();
        if (ruleId !== "") await database`DELETE FROM publication_rule WHERE id = ${ruleId}::bigint`;
        await cleanEditorMedia(
            database,
            people.map((person) => person.id),
        );
        await cleanMediaFixtures(database);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
        if (mediaRoot !== "") await rm(mediaRoot, { recursive: true, force: true });
    });

    it("🔴 ein Titelbild an einem leeren Ort: eine Einzelbindung, keine Galerie; ohne den gesehenen Zustand 409", async () => {
        const ohneStand = await post(MEDIA_HEADER_SET_URL, { placeId: ort, assetId: bilder[0] });
        expect(ohneStand.status).toBe(409);
        expect(fehler(ohneStand.body)).toBe("edit_conflict");
        await ok(MEDIA_HEADER_SET_URL, { placeId: ort, assetId: bilder[0], baseState: "undecided" });
        expect(await stand()).toEqual({ bild: bilder[0], galerie: null, ohne: false });
        expect((await plaetze()).header!.items).toEqual([]);
    });

    it("🔴 ein anderes Bild ersetzt das Titelbild; das alte bleibt (zurückgezogen, das Asset steht weiter da)", async () => {
        const revision = (await plaetze()).header!.image!.revision;
        const quittung = await ok(MEDIA_HEADER_SET_URL, { placeId: ort, assetId: bilder[1], baseRevision: revision });
        expect(await stand()).toEqual({ bild: bilder[1], galerie: null, ohne: false });
        expect(await aktiveBindungen()).toEqual({ bilder: 1, galerien: 0 });
        expect(quittung.affected[0]).toMatchObject({ kind: "header", id: `place:${ort}` });
        const [alt] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM media_asset WHERE public_id = ${bilder[0]!}::uuid
        `;
        expect(alt!.n).toBe(1);
    });

    it("dasselbe Bild noch einmal ist 409, ein veralteter Stand ebenso, zwei Stände sind 400", async () => {
        const revision = (await plaetze()).header!.image!.revision;
        const gleich = await post(MEDIA_HEADER_SET_URL, { placeId: ort, assetId: bilder[1], baseRevision: revision });
        expect([gleich.status, fehler(gleich.body)]).toEqual([409, "media_already_bound"]);
        const alt = await post(MEDIA_HEADER_SET_URL, { placeId: ort, assetId: bilder[0], baseRevision: revision + 5 });
        expect([alt.status, fehler(alt.body)]).toEqual([409, "edit_conflict"]);
        const zwei = await post(MEDIA_HEADER_SET_URL, {
            placeId: ort,
            assetId: bilder[0],
            baseRevision: revision,
            baseState: "undecided",
        });
        expect([zwei.status, fehler(zwei.body)]).toEqual([400, "validation_failed"]);
    });

    it("🔴 eine Galerie ersetzt das Einzelbild: gallery.bind löst es, das Bild bleibt unter „Bilder“", async () => {
        const quittung = await ok(MEDIA_GALLERY_BIND_URL, {
            galleryId: galerien[0]!.id,
            baseRevision: galerien[0]!.revision,
            placeId: ort,
        });
        expect(await stand()).toEqual({ bild: null, galerie: galerien[0]!.id, ohne: false });
        expect(await aktiveBindungen()).toEqual({ bilder: 0, galerien: 1 });
        expect((await plaetze()).header!.items.map((item) => item.asset.id)).toEqual([bilder[2]]);
        expect((await plaetze()).header!.gallery!.title).toBe("Hafen");
        expect(quittung.warnings).toEqual([]);
    });

    it("🔴 eine zweite Galerie: ohne ausdrückliches Ersetzen 409, mit der gesehenen Revision ersetzt sie die erste", async () => {
        const abgewiesen = await post(MEDIA_GALLERY_BIND_URL, {
            galleryId: galerien[1]!.id,
            baseRevision: galerien[1]!.revision,
            placeId: ort,
        });
        expect([abgewiesen.status, fehler(abgewiesen.body)]).toEqual([409, "place_has_gallery"]);
        const bisher = (await plaetze()).header!.gallery!.revision;
        const quittung = await ok(MEDIA_GALLERY_BIND_URL, {
            galleryId: galerien[1]!.id,
            baseRevision: galerien[1]!.revision,
            placeId: ort,
            replaceRevision: bisher,
        });
        expect(await stand()).toEqual({ bild: null, galerie: galerien[1]!.id, ohne: false });
        // „Hafen“ hängt an keinem Ort mehr: ein Entwurf unter „Galerien“, und die Quittung sagt es.
        expect(quittung.warnings.map((warnung) => warnung.code)).toEqual(["gallery_is_draft"]);
        const [hafen] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM media_gallery WHERE public_id = ${galerien[0]!.id}::uuid
        `;
        expect(hafen!.n).toBe(1);
    });

    it("Ersetzen gibt es nur beim Binden", async () => {
        const { status, body } = await post(MEDIA_GALLERY_UNBIND_URL, {
            galleryId: galerien[1]!.id,
            baseRevision: galerien[1]!.revision,
            placeId: ort,
            replaceRevision: 1,
        });
        expect([status, fehler(body)]).toEqual([400, "validation_failed"]);
    });

    it("🔴 ein Bild ersetzt die Galerie (mit ihrer Revision); Besucher sehen das Einzelbild", async () => {
        const galerie = (await plaetze()).header!.gallery!.revision;
        await ok(MEDIA_HEADER_SET_URL, { placeId: ort, assetId: bilder[0], galleryRevision: galerie });
        expect(await stand()).toEqual({ bild: bilder[0], galerie: null, ohne: false });
        expect(await aktiveBindungen()).toEqual({ bilder: 1, galerien: 0 });
        await settleAssetFiles(database, store, { assetPublicId: bilder[0]!, role: "header" });
        const besucher = (await resolvePlaceMedia(database, ort)).filter((view) => view.role === "header");
        expect(besucher.map((view) => view.id)).toEqual([bilder[0]]);
    });

    it("🔴 kein Titelbild: löst, was hängt, und der Platz ist „bewusst ohne“; danach setzt nur, wer das gesehen hat", async () => {
        const revision = (await plaetze()).header!.image!.revision;
        await ok(MEDIA_HEADER_NONE_URL, { placeId: ort, baseRevision: revision });
        expect(await stand()).toEqual({ bild: null, galerie: null, ohne: true });
        const leer = await post(MEDIA_HEADER_NONE_URL, { placeId: ort });
        expect([leer.status, fehler(leer.body)]).toEqual([409, "edit_conflict"]);
        const blind = await post(MEDIA_HEADER_SET_URL, { placeId: ort, assetId: bilder[1], baseState: "undecided" });
        expect([blind.status, fehler(blind.body)]).toEqual([409, "edit_conflict"]);
        await ok(MEDIA_HEADER_SET_URL, { placeId: ort, assetId: bilder[1], baseState: "none" });
        expect(await stand()).toEqual({ bild: bilder[1], galerie: null, ohne: false });
    });

    it("🔴 kein Titelbild an einer GALERIE (Fund des Betreibers 2026-10-18, A'Sarar: „galerie lösen geht noch nicht“): löst sie, die Galerie bleibt", async () => {
        const [markt] = await database<{ revision: number }[]>`
            SELECT revision::int AS revision FROM media_gallery WHERE public_id = ${galerien[1]!.id}::uuid
        `;
        await ok(MEDIA_GALLERY_BIND_URL, { galleryId: galerien[1]!.id, baseRevision: markt!.revision, placeId: ort });
        expect(await stand()).toEqual({ bild: null, galerie: galerien[1]!.id, ohne: false });

        // Vorher 500: Die Zeile `binding.header_none` hatte ohne Einzelbild kein Ziel (`media_audit_event_has_target`).
        const galerie = (await plaetze()).header!.gallery!.revision;
        const quittung = await ok(MEDIA_HEADER_NONE_URL, { placeId: ort, galleryRevision: galerie });
        expect(await stand()).toEqual({ bild: null, galerie: null, ohne: true });
        expect(await aktiveBindungen()).toEqual({ bilder: 0, galerien: 0 });
        expect(quittung.warnings.map((warnung) => warnung.code)).toEqual(["gallery_is_draft"]);
        const [noch] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM media_gallery WHERE public_id = ${galerien[1]!.id}::uuid
        `;
        expect(noch!.n, "die Galerie bleibt in der Medienverwaltung").toBe(1);
        const protokoll = await database<{ action: string; galerie: string | null }[]>`
            SELECT action, media_gallery_public_id::text AS galerie FROM media_audit_event
             WHERE operation_id = ${quittung.operationId}::uuid ORDER BY id
        `;
        expect(protokoll).toEqual([
            { action: "gallery.unbound", galerie: galerien[1]!.id },
            { action: "binding.header_none", galerie: galerien[1]!.id },
        ]);
    });
});
