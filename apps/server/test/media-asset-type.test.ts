import { readFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    MEDIA_COAT_BIND_URL,
    MEDIA_EDITOR_NAVIGATION_URL,
    MEDIA_EDITOR_URL,
    MEDIA_HEADER_SET_URL,
    MEDIA_UPLOAD_URL,
    MamNavigation,
    MamSearchResult,
    OperationReceipt,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type TestPerson } from "./support/auth-fixture.ts";
import { cleanMediaFixtures, insertAsset, insertPlace } from "./support/media-fixture.ts";
import { cleanEditorMedia, file, operation, pngBytes, uploadForm } from "./support/media-operations-fixture.ts";

/**
 * Der Asset-Typ am Asset (WI-0068 P4b, Migration 0095; Betreiber 2026-10-10: „wappen sind ein eigener bild typ und haben nichts mit
 * normalen bildern zu tun“).
 *
 * Problemfälle: ein Bild wird als Wappen gebunden (oder umgekehrt); der Nachtrag rät einen Typ, überschreibt einen gesetzten oder hebt
 * Revisionen; ein hochgeladenes, ungebundenes Wappen weiß nicht, dass es eines ist; ein Asset des vorigen Release ohne Typ lässt sich
 * nicht mehr binden. Soll: Typ aus der Klasse, dem Upload oder der einzigen Verwendung; Binden prüft ihn; Suche und Navigation kennen ihn.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const MIGRATION = readFileSync(new URL("../migrations/0095_media_asset_type.sql", import.meta.url), "utf8");
/** Die jüngste Fassung der Prüfung auf den Asset-Typ (WI-0278): Wer 0095 noch einmal laufen lässt, setzt sie danach wieder auf den heutigen Stand. */
const HEUTIGE_PRUEFUNG = readFileSync(new URL("../migrations/0301_social_post_kategorie.sql", import.meta.url), "utf8");

describeWithDatabase("Medienverwaltung: Asset-Typ (WI-0068 P4b, Migration 0095)", { timeout: 180_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let mediaRoot = "";
    let fixture: ReturnType<typeof authFixture>;
    let editor: TestPerson;
    let cookie = "";

    const config = (): ServerConfig => ({
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        mediaRoot,
        auth: TEST_AUTH,
    });
    const send = (method: "GET" | "POST", url: string, payload?: unknown) =>
        app.inject({
            method,
            url,
            ...(payload === undefined ? {} : { payload: payload as object }),
            headers: { origin: TEST_ORIGIN, cookie },
        });
    const typeOf = async (assetId: string): Promise<{ type: string | null; revision: number }> => {
        const [row] = await database<{ asset_type: string | null; revision: number }[]>`
            SELECT asset_type, revision::int AS revision FROM media_asset WHERE id = ${assetId}`;
        return { type: row!.asset_type, revision: row!.revision };
    };
    const typeOfPublic = async (publicId: string): Promise<string | null> => {
        const [row] = await database<{ asset_type: string | null }[]>`
            SELECT asset_type FROM media_asset WHERE public_id = ${publicId}::uuid`;
        return row!.asset_type;
    };
    const legacyClass = (assetId: string, mediaClass: string) => database`
        INSERT INTO media_legacy_source (media_asset_id, media_class, local_url, legacy_public)
        VALUES (${assetId}, ${mediaClass}, ${`/uploads/test/${assetId}.png`}, TRUE)`;
    // Je Upload ein eigenes Bild: Dieselben Bytes lehnt der Server ab (`media_already_exists`), die Farbe hängt am Seed modulo 256.
    let naechsterSeed = 100;
    const uploaded = async (role: "coat" | "header"): Promise<string> => {
        const response = await send("POST", MEDIA_UPLOAD_URL, {
            operationId: operation(),
            file: file(await pngBytes(naechsterSeed++)),
            form: uploadForm({ role, title: role === "coat" ? "Typprobe Wappen" : "Typprobe Bild" }),
        });
        expect(response.statusCode, response.body).toBe(200);
        return (response.json() as OperationReceipt).affected.find((entry) => entry.kind === "media_asset")!.id;
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 6 });
        await migrate(database);
        await cleanMediaFixtures(database);
        mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-mam-typ-"));
        fixture = authFixture(database);
        editor = await fixture.person("editor", { name: "Typ Redakteurin" });
        cookie = (await fixture.session(editor.id, { passkeyMinutesAgo: 1 })).cookie;
        app = buildApp({
            config: config(),
            database: createDatabase(testDatabaseUrl as string, { max: 4 }),
            logStream: { write: () => undefined },
        });
        await app.ready();
    }, 120_000);

    afterAll(async () => {
        await app?.close();
        await cleanEditorMedia(database, editor === undefined ? [] : [editor.id]);
        await cleanMediaFixtures(database);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
        if (mediaRoot !== "") await rm(mediaRoot, { recursive: true, force: true });
    });

    it("🔴 der Nachtrag: Typ aus Klasse und einziger Verwendung, ein gesetzter Typ bleibt, keine Revision steigt, ein zweiter Lauf ändert nichts", async () => {
        const place = await insertPlace(database, 95);
        const wappen = await insertAsset(database, { ref: "typ-klasse-wappen" });
        await legacyClass(wappen.id, "territory_coat");
        const ortsbild = await insertAsset(database, { ref: "typ-klasse-bild" });
        await legacyClass(ortsbild.id, "settlement_image");
        const nurVerwendet = await insertAsset(database, { ref: "typ-verwendung" });
        await database`INSERT INTO place_media (place_id, media_asset_id, role, origin) VALUES (${place.id}, ${nurVerwendet.id}, 'header', 'legacy')`;
        const modell = await insertAsset(database, { ref: "typ-modell", mediaKind: "model_3d", published: [] });
        const gesetzt = await insertAsset(database, { ref: "typ-gesetzt" });
        await legacyClass(gesetzt.id, "settlement_coat");
        await database`UPDATE media_asset SET asset_type = 'cover' WHERE id = ${gesetzt.id}`;
        const ohneAlles = await insertAsset(database, { ref: "typ-ohne" });
        const vorher = await typeOf(wappen.id);

        await database.unsafe(MIGRATION);
        expect((await typeOf(wappen.id)).type).toBe("coat");
        expect((await typeOf(ortsbild.id)).type).toBe("picture");
        expect((await typeOf(nurVerwendet.id)).type).toBe("picture");
        expect((await typeOf(modell.id)).type).toBe("model_3d");
        expect((await typeOf(gesetzt.id)).type).toBe("cover");
        expect((await typeOf(ohneAlles.id)).type).toBeNull();
        expect((await typeOf(wappen.id)).revision).toBe(vorher.revision);

        await database.unsafe(MIGRATION);
        expect((await typeOf(gesetzt.id)).type).toBe("cover");
        expect((await typeOf(wappen.id)).revision).toBe(vorher.revision);
        await database.unsafe(HEUTIGE_PRUEFUNG);
    });

    it("ein Upload kennt seinen Typ, auch ungebunden", async () => {
        expect(await typeOfPublic(await uploaded("coat"))).toBe("coat");
        expect(await typeOfPublic(await uploaded("header"))).toBe("picture");
    });

    it("🔴 die Rolle photobox lässt sich nicht hochladen: 400 an der Schemaprüfung, kein Asset, keine Bytes im Speicher (WI-0272)", async () => {
        const countAssets = async (): Promise<number> => {
            const [row] = await database<{ n: number }[]>`SELECT count(*)::int AS n FROM media_asset`;
            return row!.n;
        };
        const filesBefore = (await readdir(mediaRoot, { recursive: true })).sort();
        const assetsBefore = await countAssets();
        const response = await send("POST", MEDIA_UPLOAD_URL, {
            operationId: operation(),
            file: file(await pngBytes(naechsterSeed++)),
            form: { ...uploadForm({ title: "Reisebild per Hochladen" }), role: "photobox" },
        });
        expect(response.statusCode, response.body).toBe(400);
        expect(await countAssets()).toBe(assetsBefore);
        expect((await readdir(mediaRoot, { recursive: true })).sort()).toEqual(filesBefore);
        // Die Rollen mit Asset-Typ gehen weiter durch.
        expect(await typeOfPublic(await uploaded("coat"))).toBe("coat");
    });

    it("🔴 ein Bild wird nie Wappen, ein Wappen nie Titelbild (409 media_type_mismatch, keine Bindung)", async () => {
        const place = await insertPlace(database, 96);
        const bild = await uploaded("header");
        const wappen = await uploaded("coat");
        const alsWappen = await send("POST", MEDIA_COAT_BIND_URL, {
            operationId: operation(),
            subject: { kind: "place", id: place.publicId },
            assetId: bild,
            baseState: "undecided",
        });
        expect(alsWappen.statusCode, alsWappen.body).toBe(409);
        expect((alsWappen.json() as { error: { code: string; details: unknown } }).error).toMatchObject({
            code: "media_type_mismatch",
            details: { assetType: "picture" },
        });
        const alsTitelbild = await send("POST", MEDIA_HEADER_SET_URL, {
            operationId: operation(),
            placeId: place.publicId,
            assetId: wappen,
            baseState: "undecided",
        });
        expect(alsTitelbild.statusCode, alsTitelbild.body).toBe(409);
        expect((alsTitelbild.json() as { error: { code: string } }).error.code).toBe("media_type_mismatch");
        const [bindungen] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM place_media WHERE place_id = ${place.id}`;
        expect(bindungen!.n).toBe(0);
    });

    it("ein Asset ohne Typ (voriges Release) lässt sich binden und bekommt dabei den Typ der Rolle", async () => {
        const place = await insertPlace(database, 97);
        const alt = await insertAsset(database, { ref: "typ-alt" });
        const vorher = await typeOf(alt.id);
        expect(vorher.type).toBeNull();
        const response = await send("POST", MEDIA_COAT_BIND_URL, {
            operationId: operation(),
            subject: { kind: "place", id: place.publicId },
            assetId: alt.publicId,
            baseState: "undecided",
        });
        expect(response.statusCode, response.body).toBe(200);
        expect((await typeOf(alt.id)).type).toBe("coat");
    });

    it("Suche und Navigation kennen den Typ", async () => {
        const wappen = await uploaded("coat");
        const bild = await uploaded("header");
        const suche = await send("GET", `${MEDIA_EDITOR_URL}?type=coat&limit=200&offset=0&sort=changed`);
        expect(suche.statusCode, suche.body).toBe(200);
        const ergebnis = suche.json() as MamSearchResult;
        expect(Value.Check(MamSearchResult, ergebnis)).toBe(true);
        const ids = ergebnis.items.map((item) => item.id);
        expect(ids).toContain(wappen);
        expect(ids).not.toContain(bild);
        expect(ergebnis.items.every((item) => item.assetType === "coat")).toBe(true);

        const navigation = await send("GET", MEDIA_EDITOR_NAVIGATION_URL);
        expect(navigation.statusCode, navigation.body).toBe(200);
        const nav = navigation.json() as MamNavigation;
        expect(Value.Check(MamNavigation, nav)).toBe(true);
        expect(nav.types.coat).toBeGreaterThanOrEqual(1);
        expect(nav.types.picture).toBeGreaterThanOrEqual(1);
    });
});
