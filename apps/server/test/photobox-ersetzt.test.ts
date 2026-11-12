import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { settleAssetFiles } from "../src/media-editor/settle.ts";
import { MediaStore } from "../src/media/storage.ts";
import { photoboxAufbewahrung } from "../src/photobox/aufbewahrung.ts";
import { einreichen } from "../src/photobox/einreichen.ts";
import { bildErsetzen } from "../src/photobox/status.ts";
import {
    einreichung,
    neueOperation,
    neueSpuren,
    pngUpload,
    raeumeAuf,
    type Spuren,
} from "./support/photobox-fixture.ts";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * Ein ersetztes Bild bleibt nicht liegen (WI-0272 S3, Fixrunde Block C, Review I3), der ganze Weg mit echten Dateien: einreichen, das Bild ersetzen, die Redaktion gibt
 * das neue frei (oder noch nicht), der tägliche Lauf (`photoboxAufbewahrung`: Funktion der Datenbank, danach die Dateien). Das alte Asset und seine Datei sind weg, das
 * neue bleibt samt Datei, die Einreichung bleibt. Die Fälle der Funktion allein (Zustände, Verwendung, Notaus, geteilte Dateien) stehen in
 * `photobox-aufbewahrung-db.test.ts`.
 */

describeWithDatabase("Ersetzte Bilder im täglichen Lauf (WI-0272 S3, Fixrunde C)", { timeout: 120_000 }, () => {
    let database: Database;
    let mediaRoot = "";
    let store: MediaStore;
    const spuren: Spuren = neueSpuren();

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-photobox-ersetzt-"));
        store = new MediaStore(mediaRoot);
    }, 120_000);

    afterEach(async () => {
        await raeumeAuf(database, spuren);
        spuren.schluessel.length = 0;
        spuren.operationen.length = 0;
    });

    afterAll(async () => {
        await raeumeAuf(database, spuren);
        await database?.end({ timeout: 5 });
        if (mediaRoot !== "") await rm(mediaRoot, { recursive: true, force: true });
    });

    interface Stand {
        schluessel: string;
        submissionId: string;
        alt: { id: string; publicId: string; quelle: string };
        neu: { id: string; publicId: string; quelle: string };
    }

    const quelle = async (assetId: string): Promise<string> => {
        const [row] = await database<{ storage_key: string }[]>`
            SELECT storage_key FROM media_file WHERE media_asset_id = ${assetId}::bigint AND storage_class = 'private_source'`;
        return row!.storage_key;
    };

    /** Eingereicht (Bild 1), vom Abgleich geprüft, die Einreichung auf `pending`, dann das Bild ersetzt (Bild 2, ebenfalls geprüft). */
    async function ersetztesBild(seed: number): Promise<Stand> {
        const body = await einreichung(spuren, seed);
        const eingang = await einreichen(database, store, "test", body);
        const [einreichungsZeile] = await database<
            { id: string }[]
        >`SELECT id::text FROM media_submission WHERE public_id = ${eingang.publicId}::uuid`;
        const submissionId = einreichungsZeile!.id;
        const assetsDer = () =>
            database<{ id: string; public_id: string }[]>`
                SELECT a.id::text AS id, a.public_id::text AS public_id
                  FROM media_ingest i JOIN media_asset a ON a.id = i.media_asset_id
                 WHERE i.submission_id = ${submissionId}::bigint ORDER BY i.id`;
        const [erstes] = await assetsDer();
        await settleAssetFiles(database, store, { assetPublicId: erstes!.public_id, role: "photobox" });
        await database`UPDATE media_submission SET state = 'pending' WHERE id = ${submissionId}::bigint`;

        await bildErsetzen(database, store, "test", {
            operationId: neueOperation(spuren),
            schluessel: body.schluessel,
            bild: await pngUpload(seed + 1000),
        });
        const [, zweites] = await assetsDer();
        await settleAssetFiles(database, store, { assetPublicId: zweites!.public_id, role: "photobox" });
        return {
            schluessel: body.schluessel,
            submissionId,
            alt: { id: erstes!.id, publicId: erstes!.public_id, quelle: await quelle(erstes!.id) },
            neu: { id: zweites!.id, publicId: zweites!.public_id, quelle: await quelle(zweites!.id) },
        };
    }

    /** Das Ersetzen liegt zwei Tage zurück (die Schonfrist des Laufs ist vorbei). */
    const altern = (stand: Stand) =>
        database`UPDATE media_ingest SET created_at = now() - interval '2 days' WHERE submission_id = ${stand.submissionId}::bigint`;

    const dateien = async (assetId: string) =>
        (
            await database<{ storage_class: string; storage_key: string }[]>`
                SELECT storage_class, storage_key FROM media_file WHERE media_asset_id = ${assetId}::bigint ORDER BY id`
        ).map((datei) => datei.storage_key);
    const assetDa = async (assetId: string): Promise<boolean> =>
        (await database<{ n: number }[]>`SELECT count(*)::int AS n FROM media_asset WHERE id = ${assetId}::bigint`)[0]!
            .n === 1;
    const einreichungsZustand = async (stand: Stand): Promise<string | undefined> =>
        (
            await database<
                { state: string }[]
            >`SELECT state FROM media_submission WHERE id = ${stand.submissionId}::bigint`
        )[0]?.state;

    it("🔴 vor der Freigabe: nach dem Ersetzen fällt das alte Asset im Lauf samt seiner Quelldatei und Vorschau; das neue bleibt mit Dateien", async () => {
        const stand = await ersetztesBild(1);
        expect(await store.exists(stand.alt.quelle)).toBe(true);
        const altDateien = await dateien(stand.alt.id);
        expect(altDateien.length).toBeGreaterThanOrEqual(2);
        const neuDateien = await dateien(stand.neu.id);
        await altern(stand);

        const lauf = await photoboxAufbewahrung(database, store);
        expect(lauf.fehlgeschlagen).toBe(0);
        expect(lauf.schluessel).toBeGreaterThanOrEqual(altDateien.length);

        expect(await assetDa(stand.alt.id)).toBe(false);
        for (const key of altDateien) expect(await store.exists(key), key).toBe(false);
        expect(await assetDa(stand.neu.id)).toBe(true);
        expect(await dateien(stand.neu.id)).toEqual(neuDateien);
        for (const key of neuDateien) expect(await store.exists(key), key).toBe(true);
        // Das Ersetzen schickt die Einreichung zurück auf "eingegangen"; der Lauf rührt ihren Zustand nicht an.
        expect(await einreichungsZustand(stand)).toBe("incoming");
    });

    it("🔴 ersetzen, freigeben, Lauf: das alte Asset und seine Datei sind weg, das freigegebene bleibt samt Verweis", async () => {
        const stand = await ersetztesBild(2);
        // Die Freigabe der Redaktion (`photobox/redaktion.ts`, `freigeben`) ohne Sitzung: Medium und Einreichung freigegeben, die Verwendung entsteht.
        await database`UPDATE media_asset SET moderation_state = 'approved' WHERE id = ${stand.neu.id}::bigint`;
        await database`
            UPDATE media_submission SET state = 'approved', state_changed_at = now(), decided_at = now(), approved_media_asset_id = ${stand.neu.id}::bigint
             WHERE id = ${stand.submissionId}::bigint`;
        await database`INSERT INTO photobox_media (media_submission_id, media_asset_id) VALUES (${stand.submissionId}::bigint, ${stand.neu.id}::bigint)`;
        const altDateien = await dateien(stand.alt.id);
        await altern(stand);

        const lauf = await photoboxAufbewahrung(database, store);
        expect(lauf.fehlgeschlagen).toBe(0);

        expect(await assetDa(stand.alt.id)).toBe(false);
        for (const key of altDateien) expect(await store.exists(key), key).toBe(false);
        expect(await store.exists(stand.alt.quelle)).toBe(false);
        expect(await assetDa(stand.neu.id)).toBe(true);
        expect(await store.exists(stand.neu.quelle)).toBe(true);
        expect(await einreichungsZustand(stand)).toBe("approved");
        const [verweis] = await database<{ approved: string; verwendung: number }[]>`
            SELECT s.approved_media_asset_id::text AS approved,
                   (SELECT count(*)::int FROM photobox_media p WHERE p.media_submission_id = s.id AND p.retired_at IS NULL) AS verwendung
              FROM media_submission s WHERE s.id = ${stand.submissionId}::bigint`;
        expect(verweis).toEqual({ approved: stand.neu.id, verwendung: 1 });
    });

    it("eben ersetzt (Schonfrist): ein Lauf lässt das alte Bild noch liegen, ein Lauf einen Tag später räumt es ab", async () => {
        const stand = await ersetztesBild(3);
        const lauf = await photoboxAufbewahrung(database, store);
        expect(lauf.fehlgeschlagen).toBe(0);
        expect(await assetDa(stand.alt.id)).toBe(true);
        expect(await store.exists(stand.alt.quelle)).toBe(true);

        await altern(stand);
        await photoboxAufbewahrung(database, store);
        expect(await assetDa(stand.alt.id)).toBe(false);
        expect(await store.exists(stand.alt.quelle)).toBe(false);
    });
});
