import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MEDIA_EDITOR_NAVIGATION_URL, MEDIA_EDITOR_URL, MEDIA_PHOTOBOX_STAPEL_URL } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database, type Queryable } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { assetDetail } from "../src/media-editor/detail.ts";
import { mediaNavigation, photoboxStapel, searchMedia } from "../src/media-editor/search.ts";
import { settleAssetFiles } from "../src/media-editor/settle.ts";
import { MediaStore } from "../src/media/storage.ts";
import { einreichen } from "../src/photobox/einreichen.ts";
import { TEST_AUTH, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { einreichung, neueSpuren, raeumeAuf } from "./support/photobox-fixture.ts";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * Die Lesefunktionen der Medienverwaltung schreiben nichts (WI-0272 S3, Fixrunde Block E, Review I6 und M9): `searchMedia`, `mediaNavigation`, `assetDetail` und
 * `photoboxStapel` ziehen den Übergang nach der technischen Prüfung (`incoming` → `pending`) nicht mehr selbst nach. Das geschieht einmal in der Route, vor dem
 * Lesen: bei der Liste nur, wenn der Korb „PhotoBox-Uploads“ (oder ein Teil davon) gefragt ist, bei Navigation, Detail und Stapel jedes Mal.
 *
 * - Die Funktionen laufen in `READ ONLY` durch (so liest `media:messung`, und der Korridor-Auftrag `messung`), auch mit einer nachzuziehenden Einreichung, und ändern
 *   deren Zustand nicht.
 * - Das Nachziehen wartet nicht an einer Zeilensperre (`FOR UPDATE OF s SKIP LOCKED`): Hält eine Statusaktion die Einreichung, liest ein Lesepfad trotzdem; der
 *   nächste Lesevorgang holt es nach.
 */

describeWithDatabase(
    "Lesepfade der Medienverwaltung sind rein lesend (WI-0272 S3, Fixrunde E)",
    { timeout: 180_000 },
    () => {
        let database: Database;
        let app: FastifyInstance;
        let fixture: AuthFixture;
        let mediaRoot = "";
        let store: MediaStore;
        let cookie = "";
        const spuren = neueSpuren();
        const config = (): ServerConfig => ({
            port: 0,
            host: "127.0.0.1",
            releaseId: "photobox-lesen-test",
            databaseUrl: undefined,
            tileRoot: undefined,
            mediaRoot,
            auth: TEST_AUTH,
        });

        beforeAll(async () => {
            database = createDatabase(testDatabaseUrl as string, { max: 4 });
            await migrate(database);
            mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-photobox-lesen-"));
            store = new MediaStore(mediaRoot);
            fixture = authFixture(database);
            const person = await fixture.person("reviewer", { name: "Lesen reviewer" });
            cookie = (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie;
            app = buildApp({
                config: config(),
                database: createDatabase(testDatabaseUrl as string, { max: 4 }),
                logStream: { write: () => undefined },
            });
            await app.ready();
        }, 120_000);

        afterEach(async () => {
            await raeumeAuf(database, spuren);
            spuren.schluessel.length = 0;
            spuren.operationen.length = 0;
        });

        afterAll(async () => {
            await app?.close();
            await raeumeAuf(database, spuren);
            await fixture?.cleanup();
            await database?.end({ timeout: 5 });
            if (mediaRoot !== "") await rm(mediaRoot, { recursive: true, force: true });
        });

        const get = (url: string) => app.inject({ method: "GET", url, headers: { cookie } });

        let seed = 9100;
        interface Fall {
            id: string;
            assetPublicId: string;
        }
        /** Eingereicht und vom Abgleich geprüft (technisch ok), der Übergang `incoming` → `pending` ist aber noch nicht nachgezogen. */
        async function nachzuziehen(): Promise<Fall> {
            seed += 1;
            const { publicId } = await einreichen(database, store, "test", await einreichung(spuren, seed));
            const [row] = await database<{ id: string; asset: string }[]>`
            SELECT s.id::text AS id, a.public_id::text AS asset
              FROM media_submission s
              JOIN media_ingest i ON i.submission_id = s.id
              JOIN media_asset a ON a.id = i.media_asset_id
             WHERE s.public_id = ${publicId}::uuid`;
            await settleAssetFiles(database, store, { assetPublicId: row!.asset, role: "photobox" });
            const fall = { id: row!.id, assetPublicId: row!.asset };
            expect(await zustand(fall)).toBe("incoming");
            return fall;
        }
        const zustand = async (fall: Fall): Promise<string> =>
            (await database<{ state: string }[]>`SELECT state FROM media_submission WHERE id = ${fall.id}::bigint`)[0]!
                .state;
        const nurLesen = <T>(arbeit: (tx: Queryable) => Promise<T>): Promise<T> =>
            database.begin("READ ONLY", (tx) => arbeit(tx as unknown as Queryable)) as Promise<T>;

        it("🔴 Liste, Navigation, Detail und Stapel laufen in READ ONLY durch und ziehen nichts nach", async () => {
            const fall = await nachzuziehen();
            const liste = await nurLesen((tx) =>
                searchMedia(tx, { sort: "name", limit: 100, offset: 0, basket: "photobox_uploads" }),
            );
            expect(liste.items.some((eintrag) => eintrag.id === fall.assetPublicId)).toBe(true);
            await nurLesen((tx) => mediaNavigation(tx));
            const detail = await nurLesen((tx) => assetDetail(tx, fall.assetPublicId));
            expect(detail?.asset.id).toBe(fall.assetPublicId);
            await nurLesen((tx) => photoboxStapel(tx));
            // Rein lesend: Die Einreichung steht noch auf `incoming`, auch die Zeile der Liste zeigt den alten Stand.
            expect(await zustand(fall)).toBe("incoming");
            expect(liste.items.find((eintrag) => eintrag.id === fall.assetPublicId)?.submission?.zustand).toBe(
                "incoming",
            );
        });

        it("🔴 die Routen ziehen einmal vor dem Lesen nach: Navigation, Detail und Stapel jedes Mal, die Liste nur beim Korb PhotoBox-Uploads", async () => {
            const navigation = await nachzuziehen();
            expect((await get(MEDIA_EDITOR_NAVIGATION_URL)).statusCode).toBe(200);
            expect(await zustand(navigation)).toBe("pending");

            const detail = await nachzuziehen();
            const antwort = await get(`${MEDIA_EDITOR_URL}/${detail.assetPublicId}`);
            expect(antwort.statusCode, antwort.body).toBe(200);
            expect(await zustand(detail)).toBe("pending");
            // Die Revision, die das Detail nennt, ist die nach dem Übergang.
            const [revision] = await database<{ revision: number }[]>`
            SELECT revision::int AS revision FROM media_submission WHERE id = ${detail.id}::bigint`;
            expect((antwort.json() as { submission?: { revision: number } }).submission?.revision).toBe(
                revision!.revision,
            );

            const stapel = await nachzuziehen();
            expect((await get(MEDIA_PHOTOBOX_STAPEL_URL)).statusCode).toBe(200);
            expect(await zustand(stapel)).toBe("pending");
        });

        it("die Liste zieht nur nach, wenn der Korb PhotoBox-Uploads (oder ein Teil davon) gefragt ist; eine andere Liste fasst die Einreichung nicht an", async () => {
            const fall = await nachzuziehen();
            expect((await get(`${MEDIA_EDITOR_URL}?sort=name&limit=5&offset=0`)).statusCode).toBe(200);
            expect((await get(`${MEDIA_EDITOR_URL}?sort=name&limit=5&offset=0&basket=rights_open`)).statusCode).toBe(
                200,
            );
            expect(await zustand(fall)).toBe("incoming");

            const antwort = await get(`${MEDIA_EDITOR_URL}?sort=name&limit=100&offset=0&basket=photobox_uploads`);
            expect(antwort.statusCode, antwort.body).toBe(200);
            expect(await zustand(fall)).toBe("pending");
            const zeile = (antwort.json() as { items: { id: string; submission?: { zustand: string } }[] }).items.find(
                (eintrag) => eintrag.id === fall.assetPublicId,
            );
            expect(zeile?.submission?.zustand).toBe("pending");

            const teil = await nachzuziehen();
            expect((await get(`${MEDIA_EDITOR_URL}?sort=name&limit=5&offset=0&einreichung=offen`)).statusCode).toBe(
                200,
            );
            expect(await zustand(teil)).toBe("pending");
        });

        it("🔴 das Nachziehen hängt nicht an einer Zeilensperre: eine Statusaktion hält die Einreichung, die Lesewege antworten trotzdem, der nächste Lesevorgang holt es nach", async () => {
            const fall = await nachzuziehen();
            // Eine zweite Verbindung hält die Zeile der Einreichung (wie eine laufende Statusaktion) länger als `lock_timeout`.
            const halter = createDatabase(testDatabaseUrl as string, { max: 1 });
            let freigeben: () => void = () => undefined;
            const gehalten = new Promise<void>((fertig) => {
                freigeben = fertig;
            });
            const sperre = halter.begin(async (tx) => {
                await tx`SELECT id FROM media_submission WHERE id = ${fall.id}::bigint FOR UPDATE`;
                await gehalten;
            });
            try {
                await new Promise((weiter) => setTimeout(weiter, 300));
                for (const url of [
                    MEDIA_EDITOR_NAVIGATION_URL,
                    MEDIA_PHOTOBOX_STAPEL_URL,
                    `${MEDIA_EDITOR_URL}/${fall.assetPublicId}`,
                ]) {
                    const antwort = await get(url);
                    expect(antwort.statusCode, `${url} ${antwort.body}`).toBe(200);
                }
                expect(await zustand(fall)).toBe("incoming");
            } finally {
                freigeben();
                await sperre;
                await halter.end({ timeout: 5 });
            }
            expect((await get(MEDIA_EDITOR_NAVIGATION_URL)).statusCode).toBe(200);
            expect(await zustand(fall)).toBe("pending");
        });
    },
);
