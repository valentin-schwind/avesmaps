import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    MEDIA_GALLERY_ADD_URL,
    MEDIA_GALLERY_BIND_URL,
    MEDIA_GALLERY_CREATE_URL,
    MEDIA_UPLOAD_URL,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { resolvePlaceMedia } from "../src/media/resolver.ts";
import { MediaStore } from "../src/media/storage.ts";
import { settleAssetFiles } from "../src/media-editor/settle.ts";
import { usageOf } from "../src/media-editor/usage.ts";
import { readUsages } from "../src/migration/media-publication.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type TestPerson } from "./support/auth-fixture.ts";
import { cleanMediaFixtures, insertPlace } from "./support/media-fixture.ts";
import { cleanEditorMedia, file, operation, pngBytes, uploadForm } from "./support/media-operations-fixture.ts";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * 🔴 **Die Entwurfsgalerie** (Betreiber 2026-10-13, „ja zu allen drei“ auf die Frage des Blatts `review/wi-0068-p6/blatt.png`:
 * „Eine Galerie, die noch keinem Ort zugeordnet ist, ist ein Entwurf. Sollen ihre Bilder für Besucher unsichtbar sein, ja oder
 * nein?“ — **Variante A, unsichtbar**).
 *
 * Diese Datei ändert nichts am Verhalten; sie HÄLT FEST, was heute gilt, bevor der Galerieeditor (P6) das Binden und Lösen in die
 * Hand eines Menschen legt. Ohne diese Fälle könnte ein späterer Schreibpfad die Entscheidung still umdrehen — und niemand sähe es,
 * weil beides ohne Fehler durchliefe.
 *
 * Die drei Aussagen, die zusammen die Entscheidung sind:
 *   1. Mit Ortsbindung ist das Bild öffentlich.
 *   2. Ohne Ortsbindung NICHT — weder im Resolver noch in der Publikationsentscheidung, und der nächste Abgleich nimmt die
 *      öffentliche Datei wieder weg.
 *   3. Es bleibt trotzdem eine VERWENDUNG: Reverse Usage zeigt sie, das Asset gilt nie als unbenutzt, und eine Löschvorprüfung
 *      bleibt gesperrt. Genau dieses Paar — unsichtbar, aber benutzt — ist der Punkt, und es ist der Grund, warum die beiden
 *      Verwendungsabfragen des Hauses verschieden antworten dürfen, ohne sich zu widersprechen.
 */
describeWithDatabase(
    "Galerie ohne Ortsbindung ist ein Entwurf (WI-0068 P6, Betreiber 2026-10-13)",
    { timeout: 180_000 },
    () => {
        let database: Database;
        let app: FastifyInstance;
        let store: MediaStore;
        let mediaRoot = "";
        let fixture: ReturnType<typeof authFixture>;
        const people: TestPerson[] = [];
        let cookie = "";
        let ruleId = "";
        let assetDbId = "";
        let assetId = "";
        let placePublicId = "";
        let bindingId = "";

        const config = (): ServerConfig => ({
            port: 0,
            host: "127.0.0.1",
            releaseId: "test",
            databaseUrl: undefined,
            tileRoot: undefined,
            mediaRoot,
            auth: TEST_AUTH,
        });

        beforeAll(async () => {
            database = createDatabase(testDatabaseUrl as string, { max: 6 });
            await migrate(database);
            await cleanMediaFixtures(database);
            mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-entwurf-"));
            store = new MediaStore(mediaRoot);
            fixture = authFixture(database);
            const person = await fixture.person("editor", { name: "Entwurf Redakteurin" });
            people.push(person);
            cookie = (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie;
            const [rule] = await database<{ id: string }[]>`
                INSERT INTO publication_rule (rights_basis, creation_method, role, scope_text, operator_quote, decided_on)
                VALUES ('own_work', 'ai_generated', 'header', 'media-test Entwurfsregel', 'Testzitat', '2026-10-13')
                RETURNING id::text AS id
            `;
            ruleId = rule!.id;
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
                    file: file(await pngBytes(91, 160, 90)),
                    form: uploadForm({ title: "Entwurfsbild", role: "header", creationMethod: "ai_generated" }),
                },
                headers: { origin: TEST_ORIGIN, cookie },
            });
            assetId = (hochgeladen.json() as OperationReceipt).affected.find(
                (entry) => entry.kind === "media_asset",
            )!.id;
            const place = await insertPlace(database, 91);
            placePublicId = place.publicId;
            // Eine Galerie mit dem Bild als Titelbild an den Ort binden (WI-0219: EIN Titelbild ODER EINE Galerie).
            const galerie = async (url: string, payload: Record<string, unknown>) => {
                const antwort = await app.inject({
                    method: "POST",
                    url,
                    payload: { operationId: operation(), ...payload },
                    headers: { origin: TEST_ORIGIN, cookie },
                });
                expect(antwort.statusCode, antwort.body).toBe(200);
                return (antwort.json() as OperationReceipt).affected.find((entry) => entry.kind === "gallery")!;
            };
            const angelegt = await galerie(MEDIA_GALLERY_CREATE_URL, { title: "Entwurf" });
            const gefuellt = await galerie(MEDIA_GALLERY_ADD_URL, {
                galleryId: angelegt.id,
                baseRevision: angelegt.revision,
                assetId,
            });
            await galerie(MEDIA_GALLERY_BIND_URL, {
                galleryId: angelegt.id,
                baseRevision: gefuellt.revision,
                placeId: place.publicId,
            });
            const [binding] = await database<{ id: string }[]>`
                SELECT b.id::text AS id FROM place_media_gallery b WHERE b.place_id = ${place.id} AND b.retired_at IS NULL
            `;
            bindingId = binding!.id;
            const [asset] = await database<{ id: string }[]>`
                SELECT id::text AS id FROM media_asset WHERE public_id = ${assetId}::uuid
            `;
            assetDbId = asset!.id;
        }, 120_000);

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

        const oeffentlicheDateien = async (): Promise<number> => {
            const [row] = await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM media_file
                 WHERE media_asset_id = ${assetDbId}::bigint AND storage_class = 'published'
            `;
            return row?.n ?? 0;
        };
        const aktiveVerwendungen = async (): Promise<number> =>
            (await readUsages(database, assetDbId)).filter((usage) => !usage.retired).length;

        it("mit Ortsbindung ist das Bild öffentlich", async () => {
            const ergebnis = await settleAssetFiles(database, store, { assetPublicId: assetId, role: "header" });
            expect(ergebnis.published).toBe(true);
            expect(await oeffentlicheDateien()).toBeGreaterThan(0);
            expect((await resolvePlaceMedia(database, placePublicId)).map((view) => view.role)).toContain("header");
            expect(await aktiveVerwendungen()).toBe(1);
        });

        it("🔴 ohne Ortsbindung sieht ein Besucher nichts, und der Abgleich nimmt die öffentliche Datei weg", async () => {
            await database`UPDATE place_media_gallery SET retired_at = now() WHERE id = ${bindingId}::bigint`;

            // Weder die Publikationsentscheidung …
            expect(await aktiveVerwendungen()).toBe(0);
            // … noch der öffentliche Lesepfad des Ortes.
            expect(await resolvePlaceMedia(database, placePublicId)).toEqual([]);

            // Und der nächste Abgleich räumt die öffentliche Datei ab: ein Entwurf hat keine.
            const ergebnis = await settleAssetFiles(database, store, { assetPublicId: assetId, role: "header" });
            expect(ergebnis.published).toBe(false);
            expect(await oeffentlicheDateien()).toBe(0);
        });

        it("🔴 der Eintrag bleibt trotzdem eine Verwendung - das Asset gilt nie als unbenutzt", async () => {
            const ergebnis = await usageOf(database, assetId);
            expect(ergebnis?.usages, "die Galerie verwendet das Bild, auch ohne Ort").toHaveLength(1);
            // Ohne Ortsbindung hat die Verwendung kein Fachobjekt und keine Rolle: „in einer Galerie, ohne Ort“.
            expect(ergebnis?.usages[0]).toMatchObject({ via: "gallery", subject: null, role: null });
            expect(ergebnis?.usages[0]?.gallery?.id).toBeDefined();
        });

        it("eine erneute Bindung macht es wieder öffentlich - der Entwurf ist kein Einbahnweg", async () => {
            await database`UPDATE place_media_gallery SET retired_at = NULL WHERE id = ${bindingId}::bigint`;
            const ergebnis = await settleAssetFiles(database, store, { assetPublicId: assetId, role: "header" });
            expect(ergebnis.published).toBe(true);
            expect(await oeffentlicheDateien()).toBeGreaterThan(0);
            expect((await resolvePlaceMedia(database, placePublicId)).map((view) => view.role)).toContain("header");
        });
    },
);
