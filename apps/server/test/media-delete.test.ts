import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    MEDIA_COAT_BIND_URL,
    MEDIA_COAT_NONE_URL,
    MEDIA_GALLERY_ADD_URL,
    MEDIA_GALLERY_CREATE_URL,
    MEDIA_UPLOAD_URL,
    mediaDeleteUrl,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { MediaStore } from "../src/media/storage.ts";
import { settleAssetFiles } from "../src/media-editor/settle.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type TestPerson } from "./support/auth-fixture.ts";
import { cleanMediaFixtures, insertAsset, insertPlace } from "./support/media-fixture.ts";
import {
    bytegleichesWerk,
    cleanEditorMedia,
    file,
    operation,
    pngBytes,
    uploadForm,
} from "./support/media-operations-fixture.ts";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * Endgültig löschen (WI-0068 R4, `media-editor/asset-delete.ts`). Auf „Was darf „Endgültig löschen“ in der Medienverwaltung löschen?“
 * wählte der Betreiber am 2026-10-17 „A, nur eigene Uploads“ (entscheidungen.md).
 *
 * Fälle: ein eigener Upload ohne Verwendung fällt samt Dateien, das Fachprotokoll bleibt; ein Bild aus Legacy, ein verwendetes, ein
 * nur noch zurückgezogen verwendetes und eines in einer Galerie ohne Ort bleiben (409 `media_not_deletable` mit Grund); ein veralteter
 * Stand ist 409; ohne Recht oder ohne frischen Passkey geht nichts; teilt ein anderes Werk dieselben Bytes, bleibt dessen Original
 * liegen.
 */
describeWithDatabase("Endgültig löschen (WI-0068 R4, Betreiber 2026-10-17)", { timeout: 180_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let mediaRoot = "";
    let store: MediaStore;
    let fixture: ReturnType<typeof authFixture>;
    const people: TestPerson[] = [];
    /** 0: Betreiberin, Passkey frisch · 1: Redakteurin (kein delete_media), Passkey frisch · 2: Betreiberin, Passkey alt. */
    const cookies: string[] = [];

    const config = (): ServerConfig => ({
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        mediaRoot,
        auth: TEST_AUTH,
    });
    const send = (url: string, payload: unknown, wer = 0) =>
        app.inject({
            method: "POST",
            url,
            payload: payload as object,
            headers: { origin: TEST_ORIGIN, cookie: cookies[wer] ?? "" },
        });
    const code = (response: { statusCode: number; json(): unknown }): string =>
        response.statusCode < 300
            ? String(response.statusCode)
            : `${String(response.statusCode)} ${(response.json() as { error: { code: string } }).error.code}`;
    const grund = (response: { json(): unknown }): unknown =>
        (response.json() as { error: { details?: { reason?: string } } }).error.details?.reason;

    async function hochladen(seed: number, rolle: "coat" | "header" = "header"): Promise<string> {
        const antwort = await send(MEDIA_UPLOAD_URL, {
            operationId: operation(),
            file: file(await pngBytes(seed, 160, 90)),
            form: uploadForm({ title: `Löschbild ${String(seed)}`, role: rolle }),
        });
        expect(code(antwort)).toBe("200");
        return (antwort.json() as OperationReceipt).affected.find((entry) => entry.kind === "media_asset")!.id;
    }
    const revision = async (assetId: string): Promise<number> => {
        const [row] = await database<{ revision: number }[]>`
            SELECT revision::int AS revision FROM media_asset WHERE public_id = ${assetId}::uuid
        `;
        return row!.revision;
    };
    const dateien = async (assetId: string) =>
        database<{ storage_key: string; storage_class: string }[]>`
            SELECT f.storage_key, f.storage_class FROM media_file f JOIN media_asset a ON a.id = f.media_asset_id
             WHERE a.public_id = ${assetId}::uuid
        `;
    const loesche = async (assetId: string, wer = 0) =>
        send(mediaDeleteUrl(assetId), { operationId: operation(), baseRevision: await revision(assetId) }, wer);

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 6 });
        await migrate(database);
        await cleanMediaFixtures(database);
        mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-loeschen-"));
        store = new MediaStore(mediaRoot);
        fixture = authFixture(database);
        const betreiberin = await fixture.person("operator", { name: "Löschen Betreiberin" });
        const redakteurin = await fixture.person("editor", { name: "Löschen Redakteurin" });
        people.push(betreiberin, redakteurin);
        cookies.push((await fixture.session(betreiberin.id, { passkeyMinutesAgo: 1 })).cookie);
        cookies.push((await fixture.session(redakteurin.id, { passkeyMinutesAgo: 1 })).cookie);
        cookies.push((await fixture.session(betreiberin.id, { passkeyMinutesAgo: 24 * 60 })).cookie);
        app = buildApp({
            config: config(),
            database: createDatabase(testDatabaseUrl as string, { max: 4 }),
            logStream: { write: () => undefined },
        });
        await app.ready();
    }, 120_000);

    afterAll(async () => {
        await app?.close();
        await cleanEditorMedia(
            database,
            people.map((person) => person.id),
        );
        await cleanMediaFixtures(database);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
        if (mediaRoot !== "") await rm(mediaRoot, { recursive: true, force: true });
    });

    it("🔴 ein eigener Upload ohne Verwendung fällt samt Zeilen und Dateien; das Fachprotokoll bleibt", async () => {
        const assetId = await hochladen(81);
        await settleAssetFiles(database, store, { assetPublicId: assetId, role: "header" });
        const vorher = await dateien(assetId);
        expect(vorher.map((row) => row.storage_class).sort()).toEqual(["derivative", "private_source"]);
        for (const row of vorher) expect(await store.exists(row.storage_key)).toBe(true);

        const antwort = await loesche(assetId);
        expect(code(antwort)).toBe("200");

        const [rest] = await database<
            { asset: number; files: number; rights: number; ingest: number; audit: number }[]
        >`
            SELECT (SELECT count(*) FROM media_asset WHERE public_id = ${assetId}::uuid)::int AS asset,
                   (SELECT count(*) FROM media_file f WHERE f.storage_key = ANY(${vorher.map((row) => row.storage_key)}::text[]))::int AS files,
                   (SELECT count(*) FROM media_rights r JOIN media_asset a ON a.id = r.media_asset_id
                     WHERE a.public_id = ${assetId}::uuid)::int AS rights,
                   (SELECT count(*) FROM media_ingest i JOIN media_asset a ON a.id = i.media_asset_id
                     WHERE a.public_id = ${assetId}::uuid)::int AS ingest,
                   (SELECT count(*) FROM media_audit_event WHERE media_asset_public_id = ${assetId}::uuid
                     AND action = 'asset.deleted')::int AS audit
        `;
        expect(rest).toEqual({ asset: 0, files: 0, rights: 0, ingest: 0, audit: 1 });
        for (const row of vorher) expect(await store.exists(row.storage_key)).toBe(false);
    });

    it("🔴 ein Bild aus Legacy bleibt bis zum Cutoff stehen (409, Grund legacy)", async () => {
        const legacy = await insertAsset(database, { ref: "loeschen-legacy" });
        const antwort = await loesche(legacy.publicId);
        expect(code(antwort)).toBe("409 media_not_deletable");
        expect(grund(antwort)).toBe("legacy");
    });

    it("🔴 verwendet, und auch nur noch zurückgezogen verwendet: 409, Grund in_use", async () => {
        const assetId = await hochladen(82, "coat");
        const ort = await insertPlace(database, 82);
        const subject = { kind: "place", id: ort.publicId };
        const gebunden = await send(MEDIA_COAT_BIND_URL, {
            operationId: operation(),
            subject,
            assetId,
            baseState: "undecided",
        });
        expect(code(gebunden)).toBe("200");
        const aktiv = await loesche(assetId);
        expect(code(aktiv)).toBe("409 media_not_deletable");
        expect(grund(aktiv)).toBe("in_use");

        const bindung = (gebunden.json() as OperationReceipt).affected.find((entry) => entry.kind === "coat")!;
        expect(
            code(
                await send(MEDIA_COAT_NONE_URL, { operationId: operation(), subject, baseRevision: bindung.revision }),
            ),
        ).toBe("200");
        const zurueckgezogen = await loesche(assetId);
        expect(code(zurueckgezogen)).toBe("409 media_not_deletable");
        expect(grund(zurueckgezogen)).toBe("in_use");
    });

    it("🔴 ein Eintrag in einer Galerie ohne Ort ist eine Verwendung: 409, Grund in_use (WI-0068 R4)", async () => {
        const assetId = await hochladen(86);
        const angelegt = await send(MEDIA_GALLERY_CREATE_URL, {
            operationId: operation(),
            title: "Entwurf zum Löschen",
        });
        expect(code(angelegt)).toBe("200");
        const galerie = (angelegt.json() as OperationReceipt).affected.find((entry) => entry.kind === "gallery")!;
        const eingelegt = await send(MEDIA_GALLERY_ADD_URL, {
            operationId: operation(),
            galleryId: galerie.id,
            baseRevision: galerie.revision,
            assetId,
        });
        expect(code(eingelegt)).toBe("200");
        const versuch = await loesche(assetId);
        expect(code(versuch)).toBe("409 media_not_deletable");
        expect(grund(versuch)).toBe("in_use");
    });

    it("ein veralteter Stand ist 409 edit_conflict", async () => {
        const assetId = await hochladen(83);
        const antwort = await send(mediaDeleteUrl(assetId), {
            operationId: operation(),
            baseRevision: (await revision(assetId)) + 5,
        });
        expect(code(antwort)).toBe("409 edit_conflict");
    });

    it("🔴 nur mit delete_media und frischem Passkey", async () => {
        const assetId = await hochladen(84);
        expect(code(await loesche(assetId, 1))).toBe("403 forbidden");
        const alt = await loesche(assetId, 2);
        expect(alt.statusCode).toBe(403);
        expect((alt.json() as { error: { code: string } }).error.code).toMatch(/assurance_required|reauth_required/);
        const [noch] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM media_asset WHERE public_id = ${assetId}::uuid
        `;
        expect(noch!.n).toBe(1);
    });

    it("🔴 teilt ein anderes Werk dieselben Bytes, bleibt das Original liegen", async () => {
        const erstes = await hochladen(85);
        // Wie Legacy: ein zweites Werk mit denselben Bytes (das Hochladen lehnt sie seit 2026-10-17 ab).
        const zweites = await bytegleichesWerk(database, erstes, "Zweites mit denselben Bytes");
        expect(zweites).not.toBe(erstes);
        const [original] = (await dateien(zweites)).filter((row) => row.storage_class === "private_source");
        expect(code(await loesche(erstes))).toBe("200");
        expect(await store.exists(original!.storage_key)).toBe(true);
        expect(code(await loesche(zweites))).toBe("200");
        expect(await store.exists(original!.storage_key)).toBe(false);
    });
});
