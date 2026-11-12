import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    MEDIA_MERGE_URL,
    MEDIA_UPLOAD_URL,
    mediaMergeLiftUrl,
    mediaSameBytesUrl,
    type MediaSameBytes,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { mediaNavigation, searchMedia } from "../src/media-editor/search.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type TestPerson } from "./support/auth-fixture.ts";
import { cleanMediaFixtures } from "./support/media-fixture.ts";
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
 * Bytegleiche Dateien beim Hochladen (Betreiber 2026-10-17, WI-0068): „Jede bytegleiche Originaldatei soll möglichst nur noch ein
 * aktives Asset besitzen“, und „Der Server muss dieselbe Prüfung verbindlich wiederholen, einschließlich gleichzeitiger Uploads“.
 *
 * - **Soll**: Wer dieselben Bytes noch einmal hochlädt, bekommt 409 `media_already_exists` mit dem vorhandenen Werk; es entsteht weder
 *   ein Asset noch eine Rechte- oder Entstehungszeile.
 * - **Gleichzeitig**: Mehrere Uploads derselben neuen Datei zur selben Zeit legen genau EIN Werk an.
 * - **Wiederholung**: Dieselbe Operation noch einmal ist die Quittung von vorhin, keine Ablehnung (Idempotenz).
 * - **Frage vorher**: `same-bytes` nennt die lebenden Werke, das älteste als Vorschlag; ein aufgegangenes (D1) nie.
 * - **Zusammengeführt**: Das aufgegangene Werk fällt aus Liste und Zahlen und kommt mit dem Aufheben zurück.
 */
describeWithDatabase("Bytegleiche Dateien beim Hochladen (WI-0068, Betreiber 2026-10-17)", { timeout: 180_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let mediaRoot = "";
    let fixture: ReturnType<typeof authFixture>;
    const people: TestPerson[] = [];
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
    const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
    const hochladen = (bytes: Uint8Array, titel: string, operationId = operation()) =>
        app.inject({
            method: "POST",
            url: MEDIA_UPLOAD_URL,
            payload: { operationId, file: file(bytes, `${titel}.png`), form: uploadForm({ title: titel }) },
            headers: { origin: TEST_ORIGIN, cookie },
        });
    const assetDer = (body: string): string =>
        (JSON.parse(body) as OperationReceipt).affected.find((eintrag) => eintrag.kind === "media_asset")!.id;
    const gleicheBytes = async (hash: string): Promise<MediaSameBytes> => {
        const antwort = await app.inject({ url: mediaSameBytesUrl(hash), headers: { cookie } });
        expect(antwort.statusCode, antwort.body).toBe(200);
        return antwort.json();
    };
    const zahlen = async (hash: string) => {
        const [row] = await database<{ assets: number; rechte: number; entstehung: number }[]>`
            SELECT count(DISTINCT a.id)::int AS assets,
                   count(DISTINCT r.media_asset_id)::int AS rechte,
                   count(DISTINCT c.media_asset_id)::int AS entstehung
              FROM media_file f
              JOIN media_asset a ON a.id = f.media_asset_id
              LEFT JOIN media_rights r ON r.media_asset_id = a.id
              LEFT JOIN media_creation c ON c.media_asset_id = a.id
             WHERE f.storage_class = 'private_source' AND f.sha256 = ${hash}
        `;
        return row!;
    };
    const revision = async (publicId: string): Promise<number> => {
        const [row] = await database<{ revision: number }[]>`
            SELECT revision::int AS revision FROM media_asset WHERE public_id = ${publicId}::uuid
        `;
        return row!.revision;
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 6 });
        await migrate(database);
        await cleanMediaFixtures(database);
        mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-duplikate-"));
        fixture = authFixture(database);
        const person = await fixture.person("editor", { name: "Duplikat Redakteurin" });
        people.push(person);
        cookie = (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie;
        app = buildApp({
            config: config(),
            database: createDatabase(testDatabaseUrl as string, { max: 6 }),
            logStream: { write: () => undefined },
        });
        await app.ready();
    }, 150_000);

    afterAll(async () => {
        await app?.close();
        await database`
            DELETE FROM media_merge_move WHERE merge_id IN (
                SELECT m.id FROM media_merge m JOIN media_asset x ON x.id = m.merged_asset_id
                 WHERE x.source_system = 'avesmaps3d'
            )
        `;
        await database`
            DELETE FROM media_merge WHERE merged_asset_id IN (SELECT id FROM media_asset WHERE source_system = 'avesmaps3d')
        `;
        await cleanEditorMedia(
            database,
            people.map((person) => person.id),
        );
        await cleanMediaFixtures(database);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
        if (mediaRoot !== "") await rm(mediaRoot, { recursive: true, force: true });
    });

    it("🔴 dieselben Bytes noch einmal: 409 mit dem vorhandenen Werk, kein zweites Asset, keine neuen Rechte", async () => {
        const bytes = await pngBytes(140);
        const erstes = await hochladen(bytes, "Duplikat Erstes");
        expect(erstes.statusCode, erstes.body).toBe(200);
        const vorhanden = assetDer(erstes.body);

        const zweites = await hochladen(bytes, "Duplikat Zweites, anderer Name");
        expect(zweites.statusCode, zweites.body).toBe(409);
        expect(zweites.json()).toMatchObject({
            error: { code: "media_already_exists", details: { assetId: vorhanden } },
        });
        expect(await zahlen(sha(bytes))).toEqual({ assets: 1, rechte: 1, entstehung: 0 });
    });

    it("🔴 die Frage vorher nennt das Werk, ohne Treffer nichts; ein ungültiger Hash ist 400", async () => {
        const bytes = await pngBytes(141);
        const vorhanden = assetDer((await hochladen(bytes, "Duplikat Frage")).body);
        const treffer = await gleicheBytes(sha(bytes));
        expect(treffer.suggested).toBe(vorhanden);
        expect(treffer.hits.map((hit) => hit.id)).toEqual([vorhanden]);
        expect(treffer.hits[0]!.title).toBe("Duplikat Frage");

        expect(await gleicheBytes(sha(await pngBytes(142)))).toEqual({ hits: [], suggested: null });
        const falsch = await app.inject({ url: mediaSameBytesUrl("nicht-hex"), headers: { cookie } });
        expect(falsch.statusCode).toBe(400);
        const ohneAnmeldung = await app.inject({ url: mediaSameBytesUrl(sha(bytes)) });
        expect(ohneAnmeldung.statusCode).toBe(401);
    });

    it("🔴 gleichzeitige Uploads derselben neuen Datei legen genau EIN Werk an", async () => {
        const bytes = await pngBytes(143);
        const antworten = await Promise.all(
            [1, 2, 3, 4].map((nummer) => hochladen(bytes, `Duplikat gleichzeitig ${String(nummer)}`)),
        );
        const status = antworten.map((antwort) => antwort.statusCode).sort();
        expect(status, antworten.map((antwort) => antwort.body).join("\n")).toEqual([200, 409, 409, 409]);
        const gewinner = assetDer(antworten.find((antwort) => antwort.statusCode === 200)!.body);
        for (const antwort of antworten.filter((eintrag) => eintrag.statusCode === 409)) {
            expect(antwort.json()).toMatchObject({ error: { details: { assetId: gewinner } } });
        }
        expect((await zahlen(sha(bytes))).assets).toBe(1);
    });

    it("dieselbe Operation noch einmal ist die Quittung von vorhin, keine Ablehnung", async () => {
        const bytes = await pngBytes(144);
        const operationId = operation();
        const erstes = await hochladen(bytes, "Duplikat Wiederholung", operationId);
        expect(erstes.statusCode, erstes.body).toBe(200);
        const nochmal = await hochladen(bytes, "Duplikat Wiederholung", operationId);
        expect(nochmal.statusCode, nochmal.body).toBe(200);
        expect(assetDer(nochmal.body)).toBe(assetDer(erstes.body));
        expect((await zahlen(sha(bytes))).assets).toBe(1);
    });

    it("🔴 zwei lebende Werke (wie aus Legacy): beide Treffer, das älteste als Vorschlag, der Upload nennt es", async () => {
        const bytes = await pngBytes(145);
        const alt = assetDer((await hochladen(bytes, "Duplikat Alt")).body);
        const jung = await bytegleichesWerk(database, alt, "Duplikat Jung");
        const treffer = await gleicheBytes(sha(bytes));
        expect(treffer.hits.map((hit) => hit.id)).toEqual([alt, jung]);
        expect(treffer.suggested).toBe(alt);
        const nochmal = await hochladen(bytes, "Duplikat Dritter");
        expect(nochmal.json()).toMatchObject({ error: { code: "media_already_exists", details: { assetId: alt } } });
    });

    it("🔴 ein aufgegangenes Werk fällt aus Liste, Zahlen und Treffern und kommt mit dem Aufheben zurück", async () => {
        const bytes = await pngBytes(146);
        const bleibt = assetDer((await hochladen(bytes, "Duplikat Bleibt")).body);
        const geht = await bytegleichesWerk(database, bleibt, "Duplikat Geht Auf");
        const liste = async () =>
            (await searchMedia(database, { q: "Duplikat Geht Auf" })).items.map((item) => item.id);
        expect(await liste()).toEqual([geht]);
        const vorher = (await mediaNavigation(database)).total;

        const zusammen = await app.inject({
            method: "POST",
            url: MEDIA_MERGE_URL,
            payload: {
                operationId: operation(),
                keep: { assetId: bleibt, baseRevision: await revision(bleibt) },
                merge: [{ assetId: geht, baseRevision: await revision(geht) }],
            },
            headers: { origin: TEST_ORIGIN, cookie },
        });
        expect(zusammen.statusCode, zusammen.body).toBe(200);

        expect(await liste(), "aus der Liste").toEqual([]);
        expect((await mediaNavigation(database)).total, "aus den Zahlen").toBe(vorher - 1);
        const treffer = await gleicheBytes(sha(bytes));
        expect(treffer.hits.map((hit) => hit.id)).toEqual([bleibt]);
        // Das bleibende Werk trägt seine Datei jetzt allein: keine Gruppe mehr (`fileGroup`).
        expect(treffer.hits[0]!.fileGroup).toBeNull();
        expect(treffer.hits[0]!.sharedFileCount).toBe(0);

        const aufheben = await app.inject({
            method: "POST",
            url: mediaMergeLiftUrl(geht),
            payload: { operationId: operation() },
            headers: { origin: TEST_ORIGIN, cookie },
        });
        expect(aufheben.statusCode, aufheben.body).toBe(200);
        expect(await liste(), "wieder in der Liste").toEqual([geht]);
        expect((await gleicheBytes(sha(bytes))).hits.map((hit) => hit.id)).toEqual([bleibt, geht]);
    });
});
