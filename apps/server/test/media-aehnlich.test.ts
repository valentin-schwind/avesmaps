import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MEDIA_UPLOAD_URL, type OperationReceipt } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { aehnlichkeitsBericht, holeWahrnehmungNach } from "../src/media-editor/aehnlich.ts";
import { settleAssetFiles } from "../src/media-editor/settle.ts";
import { MediaStore } from "../src/media/storage.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type TestPerson } from "./support/auth-fixture.ts";
import { cleanMediaFixtures, violation } from "./support/media-fixture.ts";
import { cleanEditorMedia, file, operation, uploadForm } from "./support/media-operations-fixture.ts";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * Ähnliche Bilder (WI-0068 D2, `media-editor/aehnlich.ts`, Migration 0196): Der Hash des Originals entsteht im Abgleich und wird für den
 * Bestand nachgeholt; der Bericht zur Kalibrierung liest nur. Die Fälle: Nachholen rechnet ohne `schreiben` nur, schreibt mit ihm genau die
 * Spalte und findet beim zweiten Lauf nichts mehr; der Abgleich schreibt den Hash mit; dasselbe Motiv in zwei Größen steht im Bericht als
 * nächstes Paar, ein anderes weit weg; die Spalte gibt es nur am Original und nur in der Form von 16 Hexziffern.
 */
describeWithDatabase("Ähnliche Bilder: Wahrnehmungs-Hash und Bericht (WI-0068 D2)", { timeout: 180_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let mediaRoot = "";
    let store: MediaStore;
    let fixture: ReturnType<typeof authFixture>;
    const people: TestPerson[] = [];
    let cookie = "";
    const werke: Record<"burgGross" | "burgKlein" | "kueste", string> = { burgGross: "", burgKlein: "", kueste: "" };

    const config = (): ServerConfig => ({
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        mediaRoot,
        auth: TEST_AUTH,
    });

    const motiv = (variante: "burg" | "kueste"): Buffer =>
        Buffer.from(
            variante === "burg"
                ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><rect width="100" height="60" fill="#8fb3d9"/>
                   <rect y="40" width="100" height="20" fill="#5d7f3a"/><rect x="30" y="18" width="40" height="24" fill="#7a6a58"/>
                   <rect x="26" y="10" width="10" height="32" fill="#6b5b49"/><circle cx="85" cy="12" r="6" fill="#f2d16b"/></svg>`
                : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><rect width="100" height="60" fill="#f0e6c8"/>
                   <path d="M0 35 Q 25 20 50 32 T 100 28 V60 H0Z" fill="#2f5f8a"/><circle cx="20" cy="15" r="9" fill="#d9822b"/></svg>`,
        );
    async function hochladen(variante: "burg" | "kueste", breite: number, titel: string): Promise<string> {
        const bytes = await sharp(motiv(variante), { density: 300 }).resize({ width: breite }).png().toBuffer();
        const antwort = await app.inject({
            method: "POST",
            url: MEDIA_UPLOAD_URL,
            payload: {
                operationId: operation(),
                file: file(bytes),
                form: uploadForm({ title: titel, role: "header" }),
            },
            headers: { origin: TEST_ORIGIN, cookie },
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        return (antwort.json() as OperationReceipt).affected.find((entry) => entry.kind === "media_asset")!.id;
    }
    const hashVon = async (assetId: string): Promise<string | null> => {
        const [row] = await database<{ hash: string | null }[]>`
            SELECT f.perceptual_hash AS hash FROM media_file f JOIN media_asset a ON a.id = f.media_asset_id
             WHERE a.public_id = ${assetId}::uuid AND f.storage_class = 'private_source'
        `;
        return row?.hash ?? null;
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await cleanMediaFixtures(database);
        mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-aehnlich-"));
        store = new MediaStore(mediaRoot);
        fixture = authFixture(database);
        const person = await fixture.person("editor", { name: "Ähnlich Redakteurin" });
        people.push(person);
        cookie = (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie;
        app = buildApp({
            config: config(),
            database: createDatabase(testDatabaseUrl as string, { max: 4 }),
            logStream: { write: () => undefined },
        });
        await app.ready();
        werke.burgGross = await hochladen("burg", 1600, "Burg groß");
        werke.burgKlein = await hochladen("burg", 320, "Burg klein");
        werke.kueste = await hochladen("kueste", 800, "Küste");
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

    it("🔴 der Abgleich schreibt den Hash an das Original mit", async () => {
        expect(
            await hashVon(werke.kueste),
            "nach dem Hochladen noch keiner (der Abgleich läuft als Auftrag)",
        ).toBeNull();
        await settleAssetFiles(database, store, { assetPublicId: werke.kueste, role: "header" });
        expect(await hashVon(werke.kueste)).toMatch(/^[0-9a-f]{16}$/u);
    });

    it("🔴 Nachholen: ohne schreiben nur gerechnet, mit schreiben genau die Spalte; der zweite Lauf findet nichts", async () => {
        // 🪤 Das Nachholen gilt der GANZEN Datenbank: Originale anderer Testdateien ohne Hash und ohne Datei in diesem Speicher stehen als Fehler „Datei fehlt“ daneben.
        // Geprüft wird darum, was diese Datei hochlud, und dass jede offene Zeile gerechnet, gehalten oder als Fehler gemeldet ist.
        const probe = await holeWahrnehmungNach(database, store, { schreiben: false });
        expect(probe.gerechnet + probe.notaus + probe.fehler.length).toBe(probe.offen);
        expect(probe.gerechnet).toBeGreaterThanOrEqual(2);
        expect(probe.fehler.map((fehler) => fehler.asset)).not.toContain(werke.burgGross);
        expect(probe.geschrieben).toBe(0);
        expect(await hashVon(werke.burgGross)).toBeNull();
        const echt = await holeWahrnehmungNach(database, store, { schreiben: true });
        expect(echt.geschrieben).toBe(echt.gerechnet);
        expect(echt.geschrieben).toBe(probe.gerechnet);
        expect(echt.fehler.map((fehler) => fehler.asset)).not.toContain(werke.burgGross);
        expect(await hashVon(werke.burgGross)).toMatch(/^[0-9a-f]{16}$/u);
        // Der zweite Lauf findet nichts mehr zu schreiben; offen bleibt nur, was ohnehin nicht zu rechnen war (fremde Zeilen ohne Datei, gehaltene).
        const zweiter = await holeWahrnehmungNach(database, store, { schreiben: true });
        expect(zweiter.geschrieben).toBe(0);
        expect(zweiter.offen).toBe(echt.fehler.length + echt.notaus);
    });

    it("🔴 der Bericht: dasselbe Motiv in zwei Größen ist das nächste Paar, ein anderes liegt weit weg", async () => {
        const bericht = await aehnlichkeitsBericht(database, {
            paare: [
                [werke.burgGross, werke.burgKlein],
                [werke.burgGross, werke.kueste],
            ],
        });
        // `ohneHash` zählt die ganze Datenbank (fremde Zeilen ohne Datei bleiben ohne); hier zählen die drei Werke dieser Datei.
        for (const werk of [werke.burgGross, werke.burgKlein, werke.kueste]) expect(await hashVon(werk)).not.toBeNull();
        const bilder = bericht.typen.find((typ) => typ.typ === "picture")!;
        expect(bilder.werke).toBeGreaterThanOrEqual(3);
        expect(bilder.verteilung).toHaveLength(65);
        const [nah, fern] = bericht.paare;
        expect(nah!.abstand).toBeLessThanOrEqual(4);
        expect(fern!.abstand).toBeGreaterThanOrEqual(16);
        expect(new Set([bilder.naechste[0]!.a.id, bilder.naechste[0]!.b.id])).toEqual(
            new Set([werke.burgGross, werke.burgKlein]),
        );
    });

    it("die Spalte gibt es nur am Original und nur als 16 Hexziffern (Migration 0196)", async () => {
        const [quelle] = await database<{ id: string }[]>`
            SELECT f.id::text AS id FROM media_file f JOIN media_asset a ON a.id = f.media_asset_id
             WHERE a.public_id = ${werke.kueste}::uuid AND f.storage_class = 'private_source'
        `;
        const [andere] = await database<{ id: string }[]>`
            SELECT f.id::text AS id FROM media_file f JOIN media_asset a ON a.id = f.media_asset_id
             WHERE a.public_id = ${werke.kueste}::uuid AND f.storage_class <> 'private_source' LIMIT 1
        `;
        expect(
            (await violation(database`UPDATE media_file SET perceptual_hash = 'xyz' WHERE id = ${quelle!.id}::bigint`))
                .constraint,
        ).toBe("media_file_perceptual_hash_form");
        expect(andere, "der Abgleich legte eine gerechnete Fassung an").toBeDefined();
        expect(
            (
                await violation(
                    database`UPDATE media_file SET perceptual_hash = '0123456789abcdef' WHERE id = ${andere!.id}::bigint`,
                )
            ).constraint,
        ).toBe("media_file_perceptual_hash_form");
    });
});
