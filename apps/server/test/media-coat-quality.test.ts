import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MEDIA_COAT_BIND_URL, MEDIA_UPLOAD_URL, mediaRightsReviewUrl, type OperationReceipt } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { inspectImage } from "../src/media/raster/inspect.ts";
import { COAT_SQUARE_PROFILE, profileForRole } from "../src/media/raster/profiles.ts";
import { renderRaster } from "../src/media/raster/render.ts";
import { MediaStore } from "../src/media/storage.ts";
import { missingDerivativeAssets } from "../src/media-editor/derivatives.ts";
import { searchMedia } from "../src/media-editor/search.ts";
import { settleAssetFiles } from "../src/media-editor/settle.ts";
import { coatRejection } from "../src/media-editor/upload.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type TestPerson } from "./support/auth-fixture.ts";
import { cleanMediaFixtures, insertPlace } from "./support/media-fixture.ts";
import { cleanEditorMedia, file, operation, pngBytes, uploadForm } from "./support/media-operations-fixture.ts";

/**
 * Die Qualitätsmerkmale eines neuen Wappens (WI-0068 P4b; Betreiber 2026-10-10: transparenter Hintergrund und quadratisches Format,
 * „nur mit durchsichtigem rand auffüllen“, Mindestgröße 128 an der langen Seite).
 *
 * Problemfälle: ein zu kleines oder undurchsichtiges Wappen wird angenommen und öffentlich; ein nicht quadratisches wird zugeschnitten
 * oder gestreckt; ein Wappen des Bestands wird still anders gerechnet; ein Titelbild bekommt Wappenregeln. Soll: Abweisung mit Grund,
 * Auffüllen mit durchsichtigem Rand nur für Wappen aus dem Editor, undurchsichtige Ecken bleiben privat.
 */

const opaque = (width: number, height: number, format: "png" | "jpeg" | "webp" = "png", channels: 3 | 4 = 4) => {
    const image = sharp({
        create: {
            width,
            height,
            channels,
            background: { r: 200, g: 40, b: 40, ...(channels === 4 ? { alpha: 1 } : {}) },
        },
    });
    return (format === "png" ? image.png() : format === "jpeg" ? image.jpeg() : image.webp()).toBuffer();
};

describe("der Dateikopf sagt, ob ein Bild durchsichtig sein kann (ohne zu dekodieren)", () => {
    it("PNG mit Alpha ja, PNG ohne Alpha nein, JPEG nie, WebP verlustfrei mit Alpha ja", async () => {
        expect(inspectImage(await pngBytes(1)).alpha).toBe(true);
        expect(inspectImage(await opaque(200, 200, "png", 3)).alpha).toBe(false);
        expect(inspectImage(await opaque(200, 200, "jpeg", 3)).alpha).toBe(false);
        const webpAlpha = await sharp(await pngBytes(2))
            .webp({ lossless: true })
            .toBuffer();
        expect(inspectImage(webpAlpha).alpha).toBe(true);
    });

    it("🔴 abgewiesen wird nach der LANGEN Seite: 90 × 128 geht (wie das kleinste Wappen des Bestands), 127 × 100 nicht", async () => {
        expect(coatRejection(inspectImage(await pngBytes(3, 90, 128)))).toBeNull();
        expect(coatRejection(inspectImage(await pngBytes(4, 127, 100)))).toBe("coat_too_small");
        expect(coatRejection(inspectImage(await opaque(300, 300, "jpeg", 3)))).toBe("coat_not_transparent");
    });
});

describe("Auffüllen zum Quadrat, nur mit durchsichtigem Rand", () => {
    it("ein Wappen aus dem Editor wird quadratisch, die Ecken des Bildes selbst entscheiden über „durchsichtig“", async () => {
        const bytes = await pngBytes(5, 160, 120);
        const rendered = await renderRaster(bytes, inspectImage(bytes), COAT_SQUARE_PROFILE);
        expect(rendered.width).toBe(160);
        expect(rendered.height).toBe(160);
        expect(rendered.transparentCorners).toBe(true);
        // Der Rand ist durchsichtig, die Mitte bleibt das Bild (nicht gestreckt: oben und unten je 20 Pixel Rand).
        const { data, info } = await sharp(rendered.bytes).raw().toBuffer({ resolveWithObject: true });
        const alpha = (x: number, y: number): number => data[(y * info.width + x) * info.channels + 3] ?? 255;
        expect(alpha(80, 5)).toBe(0);
        expect(alpha(80, 80)).toBe(255);

        const deckend = await opaque(200, 160);
        expect((await renderRaster(deckend, inspectImage(deckend), COAT_SQUARE_PROFILE)).transparentCorners).toBe(
            false,
        );
    });

    it("🔴 der Bestand behält sein Profil: ein Legacy-Wappen wird nicht aufgefüllt", async () => {
        const bytes = await pngBytes(6, 160, 120);
        const rendered = await renderRaster(bytes, inspectImage(bytes), profileForRole("coat"));
        expect([rendered.width, rendered.height]).toEqual([160, 120]);
        expect(rendered.transparentCorners).toBeUndefined();
    });

    it("🔴 T2b: gemessen wird jedes Wappen, entschieden nur beim aufgefüllten (der Bestand bleibt veröffentlicht)", async () => {
        const deckend = await opaque(200, 160);
        const bestand = await renderRaster(deckend, inspectImage(deckend), profileForRole("coat"), { corners: true });
        expect(bestand.corners).toBe(false);
        expect(bestand.transparentCorners).toBeUndefined();
        const gut = await pngBytes(7, 160, 120);
        expect((await renderRaster(gut, inspectImage(gut), profileForRole("coat"), { corners: true })).corners).toBe(
            true,
        );
        // Ohne Wunsch keine Messung (Titelbilder, Karten).
        expect((await renderRaster(gut, inspectImage(gut), profileForRole("header"))).corners).toBeUndefined();
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Wappen über die echten Routen (WI-0068 P4b)", { timeout: 180_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let mediaRoot = "";
    let fixture: ReturnType<typeof authFixture>;
    const people: TestPerson[] = [];
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
    const post = (url: string, payload: unknown, wer = 0) =>
        app.inject({
            method: "POST",
            url,
            payload: payload as object,
            headers: { origin: TEST_ORIGIN, cookie: cookies[wer] ?? "" },
        });
    const hochladen = (bytes: Buffer, role: "coat" | "header" = "coat") =>
        post(MEDIA_UPLOAD_URL, {
            operationId: operation(),
            file: file(bytes),
            form: uploadForm({ role, rights: { basis: "public_domain" } }),
        });
    const reason = (response: { json(): unknown }): unknown =>
        (response.json() as { error: { code: string; details?: { reason?: string } } }).error;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 6 });
        await migrate(database);
        await cleanMediaFixtures(database);
        mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-mam-wappen-"));
        fixture = authFixture(database);
        for (const name of ["Wappen Redakteurin", "Wappen Prüfer"]) {
            const person = await fixture.person("editor", { name });
            people.push(person);
            cookies.push((await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie);
        }
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

    it("🔴 zu klein und ohne Durchsichtigkeit: 422 mit Grund, kein Asset; ein Titelbild darf ein JPEG sein", async () => {
        const [vorher] = await database<
            { n: number }[]
        >`SELECT count(*)::int AS n FROM media_asset WHERE source_system = 'avesmaps3d'`;
        const klein = await hochladen(await pngBytes(7, 100, 80));
        expect(klein.statusCode).toBe(422);
        expect(reason(klein)).toMatchObject({ code: "media_file_rejected", details: { reason: "coat_too_small" } });
        const jpeg = await hochladen(await opaque(300, 300, "jpeg", 3));
        expect(jpeg.statusCode).toBe(422);
        expect(reason(jpeg)).toMatchObject({ details: { reason: "coat_not_transparent" } });
        const [nachher] = await database<
            { n: number }[]
        >`SELECT count(*)::int AS n FROM media_asset WHERE source_system = 'avesmaps3d'`;
        expect(nachher!.n).toBe(vorher!.n);
        expect((await hochladen(await opaque(300, 200, "jpeg", 3), "header")).statusCode).toBe(200);
    });

    it("öffentlich wird ein Wappen aus dem Editor quadratisch; mit undurchsichtigen Ecken bleibt es privat (Befund)", async () => {
        const store = new MediaStore(mediaRoot);
        const pruefe = async (bytes: Buffer, n: number) => {
            const response = await hochladen(bytes);
            expect(response.statusCode, response.body).toBe(200);
            const assetId = (response.json() as OperationReceipt).affected.find(
                (entry) => entry.kind === "media_asset",
            )!.id;
            const place = await insertPlace(database, n);
            const bound = await post(MEDIA_COAT_BIND_URL, {
                operationId: operation(),
                subject: { kind: "place", id: place.publicId },
                assetId,
                baseState: "undecided",
            });
            expect(bound.statusCode, bound.body).toBe(200);
            const [rev] = await database<{ revision: number }[]>`
                SELECT r.revision::int AS revision FROM media_rights r JOIN media_asset a ON a.id = r.media_asset_id
                 WHERE a.public_id = ${assetId}::uuid`;
            const geprueft = await post(
                mediaRightsReviewUrl(assetId),
                { operationId: operation(), baseRevision: rev!.revision, decision: "cleared" },
                1,
            );
            expect(geprueft.statusCode, geprueft.body).toBe(200);
            const ergebnis = await settleAssetFiles(database, store, { assetPublicId: assetId, role: "coat" });
            const [datei] = await database<{ width: number; height: number }[]>`
                SELECT f.width, f.height FROM media_file f JOIN media_asset a ON a.id = f.media_asset_id
                 WHERE a.public_id = ${assetId}::uuid AND f.storage_class = 'published'`;
            const [quelle] = await database<{ corners: boolean | null; id: string }[]>`
                SELECT f.corners_transparent AS corners, a.id::text AS id FROM media_file f JOIN media_asset a ON a.id = f.media_asset_id
                 WHERE a.public_id = ${assetId}::uuid AND f.storage_class = 'private_source'`;
            return { ergebnis, datei, assetId, quelle: quelle! };
        };
        const imKorb = async (basket: "coat_defects" | "missing_derivative", assetId: string): Promise<boolean> =>
            (await searchMedia(database, { basket, limit: 200 })).items.some((item) => item.id === assetId);

        const gut = await pruefe(await pngBytes(8, 160, 120), 98);
        expect(gut.ergebnis.published).toBe(true);
        expect(gut.datei).toEqual({ width: 160, height: 160 });

        const deckend = await pruefe(await opaque(200, 160), 99);
        expect(deckend.ergebnis.published).toBe(false);
        expect(deckend.ergebnis.findings).toContain("coat_not_transparent");
        expect(deckend.datei).toBeUndefined();

        // T2b: Die Messung steht am Original; das undurchsichtige Wappen steht in „Wappen mit Mängeln“, nicht in „Fehlende Derivate“.
        expect(gut.quelle.corners).toBe(true);
        expect(deckend.quelle.corners).toBe(false);
        expect(await imKorb("coat_defects", deckend.assetId)).toBe(true);
        expect(await imKorb("coat_defects", gut.assetId)).toBe(false);
        expect(await imKorb("missing_derivative", deckend.assetId)).toBe(false);
        expect(await missingDerivativeAssets(database)).not.toContain(deckend.quelle.id);
        // Ein zweiter Abgleich findet alles auf dem Stand (die Messung ist da).
        expect(
            (await settleAssetFiles(database, store, { assetPublicId: deckend.assetId, role: "coat" })).unchanged,
        ).toBe(true);
    });
});
