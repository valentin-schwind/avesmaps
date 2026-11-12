import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { settleAssetFiles } from "../src/media-editor/settle.ts";
import { gleicheQuarantaeneAb } from "../src/media/quarantine.ts";
import { MediaStore } from "../src/media/storage.ts";
import { PUBLICATION_RULE_SEEDS, seedPublicationRules } from "../src/migration/media-rules.ts";
import { einreichen } from "../src/photobox/einreichen.ts";
import { statusLesen, vorschauLesen } from "../src/photobox/status.ts";
import { einreichung, neueSpuren, raeumeAuf, type Spuren } from "./support/photobox-fixture.ts";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * Die Vorschau auf der Statusseite, solange das Bild öffentlich ist (WI-0272 S3, Fixrunde Block B, Review I1): Mit der Freigaberegel veröffentlicht der Abgleich
 * das Bild und löscht dabei absichtlich die interne Vorschau (`intern_photobox_2048`). Status und Vorschau fallen dann auf die veröffentlichte Datei
 * (`photobox_2048`) zurück, sonst verlöre jedes freigegebene Bild seine Vorschau und die Seite fragte vergeblich nach. Unter einer Quarantäne liegt die Datei
 * nicht mehr dort: `vorschauBereit` ist falsch und `vorschauGesperrt` wahr, die Seite hört auf zu fragen.
 */

describeWithDatabase("Vorschau nach dem Öffentlichwerden (WI-0272 S3, Fixrunde B)", { timeout: 120_000 }, () => {
    let database: Database;
    let mediaRoot = "";
    let store: MediaStore;
    const spuren: Spuren = neueSpuren();
    const regeln = PUBLICATION_RULE_SEEDS.filter((seed) => seed.role === "photobox");
    const hashes: string[] = [];

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-photobox-vorschau-"));
        store = new MediaStore(mediaRoot);
        await seedPublicationRules(database, regeln);
    }, 120_000);

    afterEach(async () => {
        await database`DELETE FROM media_quarantine WHERE sha256 = ANY(${hashes}::text[])`;
        hashes.length = 0;
        await raeumeAuf(database, spuren);
        spuren.schluessel.length = 0;
        spuren.operationen.length = 0;
    });

    afterAll(async () => {
        await database`DELETE FROM publication_rule WHERE scope_text = ANY(${regeln.map((regel) => regel.scopeText)})`;
        await raeumeAuf(database, spuren);
        await database?.end({ timeout: 5 });
        if (mediaRoot !== "") await rm(mediaRoot, { recursive: true, force: true });
    });

    /** Ein eingereichtes, geprüftes (Abgleich gelaufen) und freigegebenes Reisebild, so wie `freigeben` es hinterlässt; der Abgleich der Freigabe ist gelaufen. */
    async function freigegeben(seed: number): Promise<{ schluessel: string; assetId: string; assetPublicId: string }> {
        const body = await einreichung(spuren, seed);
        const eingang = await einreichen(database, store, "test", body);
        const [asset] = await database<{ id: string; public_id: string; submission: string }[]>`
            SELECT a.id::text AS id, a.public_id::text AS public_id, s.id::text AS submission
              FROM media_submission s
              JOIN media_ingest i ON i.submission_id = s.id
              JOIN media_asset a ON a.id = i.media_asset_id
             WHERE s.public_id = ${eingang.publicId}::uuid`;
        if (asset === undefined) throw new Error("Asset nicht angelegt");
        // Der erste Abgleich (der der Einreichung) rechnet die interne Vorschau.
        await settleAssetFiles(database, store, { assetPublicId: asset.public_id, role: "photobox" });
        // Die Freigabe der Redaktion (`photobox/redaktion.ts`, `freigeben`), ohne Sitzung: Medium und Einreichung freigegeben, die Verwendung entsteht.
        await database`UPDATE media_asset SET moderation_state = 'approved' WHERE id = ${asset.id}::bigint`;
        await database`
            UPDATE media_submission SET state = 'approved', state_changed_at = now(), decided_at = now(), approved_media_asset_id = ${asset.id}::bigint
             WHERE id = ${asset.submission}::bigint`;
        await database`INSERT INTO photobox_media (media_submission_id, media_asset_id) VALUES (${asset.submission}::bigint, ${asset.id}::bigint)`;
        const ergebnis = await settleAssetFiles(database, store, { assetPublicId: asset.public_id, role: "photobox" });
        expect(ergebnis).toMatchObject({ published: true, reasons: [] });
        return { schluessel: body.schluessel, assetId: asset.id, assetPublicId: asset.public_id };
    }

    const dateien = (assetId: string) =>
        database<{ storage_class: string; variant: string; storage_key: string; sha256: string }[]>`
            SELECT storage_class, variant, storage_key, sha256 FROM media_file WHERE media_asset_id = ${assetId}::bigint ORDER BY id`;

    it("🔴 Gegenprobe vor der Freigabe: die interne Vorschau ist bereit und liefert Bytes", async () => {
        const body = await einreichung(spuren, 1);
        const eingang = await einreichen(database, store, "test", body);
        const [asset] = await database<{ public_id: string }[]>`
            SELECT a.public_id::text AS public_id FROM media_submission s JOIN media_ingest i ON i.submission_id = s.id
              JOIN media_asset a ON a.id = i.media_asset_id WHERE s.public_id = ${eingang.publicId}::uuid`;
        await settleAssetFiles(database, store, { assetPublicId: asset!.public_id, role: "photobox" });
        const status = await statusLesen(database, body.schluessel);
        expect(status).toMatchObject({ zustand: "pending", vorschauBereit: true });
        expect(status).not.toHaveProperty("vorschauGesperrt");
        const bytes = await vorschauLesen(database, store, body.schluessel);
        expect(bytes.subarray(0, 4).toString("latin1")).toBe("RIFF");
    });

    it("🔴 freigegeben mit Regel und Abgleich: die interne Vorschau ist weg, Status und Vorschau liefern trotzdem die veröffentlichte Datei", async () => {
        const fall = await freigegeben(2);
        const liste = await dateien(fall.assetId);
        // So steht das Asset nach dem Abgleich: Original und veröffentlichte Fassung, keine interne Vorschau mehr.
        // Dazu die Kachel (WI-0272 S4, Aufgabe 22); die Vorschau liest die Hauptfassung.
        expect(liste.map((datei) => `${datei.storage_class}/${datei.variant}`).sort()).toEqual([
            "private_source/source",
            "published/photobox_2048",
            "published/photobox_kachel",
        ]);

        const status = await statusLesen(database, fall.schluessel);
        expect(status).toMatchObject({ zustand: "approved", vorschauBereit: true });
        expect(status).not.toHaveProperty("vorschauGesperrt");
        const bytes = await vorschauLesen(database, store, fall.schluessel);
        const veroeffentlicht = liste.find((datei) => datei.variant === "photobox_2048")!;
        expect(bytes.equals(await store.read(veroeffentlicht.storage_key, 8 * 1024 * 1024))).toBe(true);
        expect(bytes.subarray(0, 4).toString("latin1")).toBe("RIFF");
    });

    it("🔴 unter einer Quarantäne: nicht bereit und gesperrt (die Seite hört auf zu fragen), die Vorschau ist 404; nach dem Aufheben wieder bereit", async () => {
        const fall = await freigegeben(3);
        const veroeffentlicht = (await dateien(fall.assetId)).find((datei) => datei.variant === "photobox_2048")!;
        hashes.push(veroeffentlicht.sha256);

        await gleicheQuarantaeneAb(database, store, "asset_suspension", new Set([veroeffentlicht.sha256]), "Test");
        const gesperrt = await statusLesen(database, fall.schluessel);
        expect(gesperrt).toMatchObject({ zustand: "approved", vorschauBereit: false, vorschauGesperrt: true });
        await expect(vorschauLesen(database, store, fall.schluessel)).rejects.toMatchObject({
            statusCode: 404,
            code: "photobox_preview_missing",
        });

        await gleicheQuarantaeneAb(database, store, "asset_suspension", new Set(), null);
        const frei = await statusLesen(database, fall.schluessel);
        expect(frei).toMatchObject({ vorschauBereit: true });
        expect(frei).not.toHaveProperty("vorschauGesperrt");
        expect((await vorschauLesen(database, store, fall.schluessel)).subarray(0, 4).toString("latin1")).toBe("RIFF");
    });
});
