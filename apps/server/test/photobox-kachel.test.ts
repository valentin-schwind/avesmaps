import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { settleAssetFiles } from "../src/media-editor/settle.ts";
import { publishedVariantsArray } from "../src/media-editor/usage-sql.ts";
import { ziehNotausQuarantaeneNach } from "../src/media/notaus.ts";
import { ingestImage } from "../src/media/raster/ingest.ts";
import { inspectImage } from "../src/media/raster/inspect.ts";
import {
    PHOTOBOX_KACHEL_PROFILE,
    beifassungen,
    profileForRole,
    RASTER_PROFILES,
} from "../src/media/raster/profiles.ts";
import { renderRaster } from "../src/media/raster/render.ts";
import { PHOTOBOX_KACHEL_VARIANT, PUBLISHED_VARIANT, oeffentlicheVarianten } from "../src/media/roles.ts";
import { zieheQuarantaeneNach } from "../src/media/quarantine.ts";
import { MediaStore, quarantineKey } from "../src/media/storage.ts";
import { PUBLICATION_RULE_SEEDS, seedPublicationRules } from "../src/migration/media-rules.ts";
import { einreichen } from "../src/photobox/einreichen.ts";
import { nehmeOffline } from "../src/photobox/redaktion.ts";
import { offlineNehmen } from "../src/photobox/status.ts";
import { authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { cleanMediaFixtures, insertAsset, insertPlace } from "./support/media-fixture.ts";
import { file, pngBytes } from "./support/media-operations-fixture.ts";
import { einreichung, neueOperation, neueSpuren, raeumeAuf, type Spuren } from "./support/photobox-fixture.ts";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * Die zweite öffentliche Fassung eines Reisebildes, `photobox_kachel` (WI-0272 S4, Aufgabe 22): Leiste und Kartensymbole laden die kleine Fassung (lange Kante 480,
 * q72), nicht die 2048 px der Bildansicht. Sie hängt als Zeile an `media_file`; Offline, Aufbewahrung, Notaus und Schalter greifen darum von selbst, und der Abgleich
 * (`media_settle`) hält beide Fassungen auf dem Stand. Eine Rolle ohne Beifassung (alle anderen) behält genau eine öffentliche Zeile.
 */

describe("Die Fassungen einer Rolle (rein)", () => {
    it("die Hauptvariante steht vorn, nur das Reisebild hat eine Kachel dazu", () => {
        expect(oeffentlicheVarianten("photobox")).toEqual(["photobox_2048", PHOTOBOX_KACHEL_VARIANT]);
        expect(PHOTOBOX_KACHEL_VARIANT).toBe("photobox_kachel");
        for (const role of ["coat", "header", "map_full", "map_preview", "literature_cover"] as const) {
            expect(oeffentlicheVarianten(role)).toEqual([PUBLISHED_VARIANT[role]]);
            expect(beifassungen(role)).toEqual([]);
        }
        expect(PUBLISHED_VARIANT.photobox).toBe("photobox_2048");
    });

    it("das Profil der Kachel: einpassen auf 480, nie vergrößern, verlustbehaftet q72; die Profile der Rollen bleiben, wie sie waren", () => {
        expect(PHOTOBOX_KACHEL_PROFILE).toMatchObject({
            role: "photobox",
            variant: "photobox_kachel",
            geometry: { kind: "fit_inside", longEdge: 480 },
            svgLongEdge: 480,
            encoding: { mode: "lossy", quality: 72 },
        });
        expect(beifassungen("photobox")).toEqual([PHOTOBOX_KACHEL_PROFILE]);
        expect(profileForRole("photobox").variant).toBe("photobox_2048");
        expect(RASTER_PROFILES.map((profile) => profile.variant)).not.toContain("photobox_kachel");
    });

    it("die Abfrage nennt je Rolle ihre Varianten als Feld; ohne Rolle gibt es keine", () => {
        const text = publishedVariantsArray("u.role");
        expect(text).toContain("WHEN 'photobox' THEN ARRAY['photobox_2048','photobox_kachel']");
        expect(text).toContain("WHEN 'header' THEN ARRAY['header_16_9']");
        expect(text).toMatch(/^CASE u\.role .* END$/u);
    });
});

describeWithDatabase("Die Kachel eines Reisebildes (WI-0272 S4, Aufgabe 22)", { timeout: 180_000 }, () => {
    let database: Database;
    let mediaRoot = "";
    let store: MediaStore;
    let fixture: AuthFixture;
    let redaktion: { id: string };
    const spuren: Spuren = neueSpuren();
    const regeln = PUBLICATION_RULE_SEEDS.filter((seed) => seed.role === "photobox");
    const hashes: string[] = [];

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-photobox-kachel-"));
        store = new MediaStore(mediaRoot);
        fixture = authFixture(database);
        redaktion = await fixture.person("editor", { name: "Kachel Redaktion" });
        await database`DELETE FROM content_switch WHERE key = 'media.role.photobox'`;
    }, 120_000);

    beforeEach(async () => {
        await seedPublicationRules(database, regeln);
    });

    afterEach(async () => {
        await database`DELETE FROM content_switch WHERE key = 'media.role.photobox'`;
        await database`DELETE FROM media_publication_suspension WHERE media_asset_id IN (SELECT media_asset_id FROM media_ingest WHERE source_system = 'photobox')`;
        await database`DELETE FROM media_quarantine WHERE sha256 = ANY(${hashes}::text[])`;
        hashes.length = 0;
        await raeumeAuf(database, spuren);
        await cleanMediaFixtures(database);
        spuren.schluessel.length = 0;
        spuren.operationen.length = 0;
    });

    afterAll(async () => {
        await database`DELETE FROM publication_rule WHERE scope_text = ANY(${regeln.map((regel) => regel.scopeText)})`;
        await raeumeAuf(database, spuren);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
        if (mediaRoot !== "") await rm(mediaRoot, { recursive: true, force: true });
    });

    interface Fall {
        schluessel: string;
        assetId: string;
        assetPublicId: string;
        submissionId: string;
        submissionPublicId: string;
    }

    /** Ein eingereichtes und geprüftes (erster Abgleich gelaufen) Reisebild; `breite`/`hoehe` bestimmen die Maße des Originals. */
    async function eingereicht(seed: number, breite = 160, hoehe = 90): Promise<Fall> {
        const body = await einreichung(spuren, seed, {
            bild: file(await pngBytes(seed, breite, hoehe), "reisebild.png"),
        });
        const eingang = await einreichen(database, store, "test", body);
        const [asset] = await database<{ id: string; public_id: string; submission: string }[]>`
            SELECT a.id::text AS id, a.public_id::text AS public_id, s.id::text AS submission
              FROM media_submission s
              JOIN media_ingest i ON i.submission_id = s.id
              JOIN media_asset a ON a.id = i.media_asset_id
             WHERE s.public_id = ${eingang.publicId}::uuid`;
        if (asset === undefined) throw new Error("Asset nicht angelegt");
        await settleAssetFiles(database, store, { assetPublicId: asset.public_id, role: "photobox" });
        return {
            schluessel: body.schluessel,
            assetId: asset.id,
            assetPublicId: asset.public_id,
            submissionId: asset.submission,
            submissionPublicId: eingang.publicId,
        };
    }

    /** Freigegeben wie von der Redaktion: Medium und Einreichung freigegeben, die Verwendung entsteht; der Abgleich der Freigabe läuft hier. */
    async function freigegeben(
        seed: number,
        breite = 160,
        hoehe = 90,
    ): Promise<Fall & { ergebnis: Awaited<ReturnType<typeof abgleich>> }> {
        const fall = await eingereicht(seed, breite, hoehe);
        await database`UPDATE media_asset SET moderation_state = 'approved' WHERE id = ${fall.assetId}::bigint`;
        await database`
            UPDATE media_submission SET state = 'approved', state_changed_at = now(), decided_at = now(), approved_media_asset_id = ${fall.assetId}::bigint
             WHERE id = ${fall.submissionId}::bigint`;
        await database`INSERT INTO photobox_media (media_submission_id, media_asset_id) VALUES (${fall.submissionId}::bigint, ${fall.assetId}::bigint)`;
        return { ...fall, ergebnis: await abgleich(fall.assetPublicId) };
    }

    /** Wie viele dieser Dateien gerade in Quarantäne stehen (aktive Zeilen). */
    const quarantaeneZeilen = async (shas: readonly string[]): Promise<number> =>
        (
            await database<{ n: number }[]>`
                SELECT count(DISTINCT sha256)::int AS n FROM media_quarantine WHERE sha256 = ANY(${[...shas]}::text[]) AND restored_at IS NULL`
        )[0]!.n;

    const abgleich = (assetPublicId: string) => settleAssetFiles(database, store, { assetPublicId, role: "photobox" });

    const dateien = (assetId: string) =>
        database<
            {
                id: string;
                storage_class: string;
                variant: string;
                storage_key: string;
                sha256: string;
                width: number | null;
                height: number | null;
            }[]
        >`
            SELECT id::text AS id, storage_class, variant, storage_key, sha256, width, height FROM media_file
             WHERE media_asset_id = ${assetId}::bigint ORDER BY id`;
    const oeffentlich = async (assetId: string) =>
        (await dateien(assetId)).filter((datei) => datei.storage_class === "published");
    const varianten = async (assetId: string): Promise<string[]> =>
        (await oeffentlich(assetId)).map((datei) => datei.variant).sort();

    it("🔴 Freigabe mit Regel: zwei öffentliche Zeilen, die Kachel ist höchstens 480 px lang und eine WebP ohne Metadaten", async () => {
        const fall = await freigegeben(1, 1200, 800);
        expect(fall.ergebnis).toMatchObject({ published: true, reasons: [], unchanged: false });
        expect(await varianten(fall.assetId)).toEqual(["photobox_2048", "photobox_kachel"]);

        const liste = await oeffentlich(fall.assetId);
        const haupt = liste.find((datei) => datei.variant === "photobox_2048")!;
        const kachel = liste.find((datei) => datei.variant === "photobox_kachel")!;
        expect([haupt.width, haupt.height]).toEqual([1200, 800]);
        expect([kachel.width, kachel.height]).toEqual([480, 320]);
        expect(kachel.sha256).not.toBe(haupt.sha256);

        const bytes = await store.read(kachel.storage_key, 8 * 1024 * 1024);
        expect(bytes.subarray(0, 4).toString("latin1")).toBe("RIFF");
        const meta = await sharp(bytes).metadata();
        expect(meta.format).toBe("webp");
        expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(480);
        expect([meta.exif, meta.icc, meta.xmp, meta.iptc]).toEqual([undefined, undefined, undefined, undefined]);
        // Die interne Vorschau fiel mit der Veröffentlichung weg, wie bisher.
        expect((await dateien(fall.assetId)).map((datei) => `${datei.storage_class}/${datei.variant}`).sort()).toEqual([
            "private_source/source",
            "published/photobox_2048",
            "published/photobox_kachel",
        ]);
    });

    it("ein Bild von 160 × 90 wird nicht vergrößert, auch die Kachel nicht", async () => {
        const fall = await freigegeben(2, 160, 90);
        const liste = await oeffentlich(fall.assetId);
        expect(liste.map((datei) => [datei.width, datei.height])).toEqual([
            [160, 90],
            [160, 90],
        ]);
    });

    it("🔴 der zweite Abgleich ist unverändert: keine neue Zeile, keine neue Datei", async () => {
        const fall = await freigegeben(3, 900, 600);
        const vorher = await dateien(fall.assetId);
        const zweiter = await abgleich(fall.assetPublicId);
        expect(zweiter).toMatchObject({ unchanged: true, published: true });
        expect(await dateien(fall.assetId)).toEqual(vorher);
        for (const datei of vorher.filter((eintrag) => eintrag.storage_class === "published")) {
            expect(await store.exists(datei.storage_key)).toBe(true);
        }
    });

    it("🔴 Freigabe ohne Regel: keine öffentliche Zeile, die interne Vorschau bleibt", async () => {
        await database`DELETE FROM publication_rule WHERE scope_text = ANY(${regeln.map((regel) => regel.scopeText)})`;
        const fall = await freigegeben(4, 700, 500);
        expect(fall.ergebnis).toMatchObject({ published: false });
        expect(fall.ergebnis.reasons.length).toBeGreaterThan(0);
        expect(await oeffentlich(fall.assetId)).toEqual([]);
        expect((await dateien(fall.assetId)).map((datei) => datei.variant).sort()).toEqual([
            "intern_photobox_2048",
            "source",
        ]);
    });

    it("🔴 Offline durch den Einreicher: beide Dateien und beide Zeilen sind weg", async () => {
        const fall = await freigegeben(5, 800, 600);
        const vorher = await oeffentlich(fall.assetId);
        expect(vorher).toHaveLength(2);
        await offlineNehmen(database, store, "test", {
            operationId: neueOperation(spuren),
            schluessel: fall.schluessel,
        });
        expect(await oeffentlich(fall.assetId)).toEqual([]);
        for (const datei of vorher) expect(await store.exists(datei.storage_key)).toBe(false);
    });

    it("🔴 Offline durch die Redaktion: beide Dateien und beide Zeilen sind weg", async () => {
        const fall = await freigegeben(6, 800, 600);
        const vorher = await oeffentlich(fall.assetId);
        expect(vorher).toHaveLength(2);
        const [revision] = await database<{ revision: number }[]>`
            SELECT revision::int AS revision FROM media_submission WHERE id = ${fall.submissionId}::bigint`;
        await nehmeOffline(database, store, { personId: redaktion.id, environment: "test" }, fall.submissionPublicId, {
            operationId: neueOperation(spuren),
            baseRevision: revision!.revision,
        });
        expect(await oeffentlich(fall.assetId)).toEqual([]);
        for (const datei of vorher) expect(await store.exists(datei.storage_key)).toBe(false);
    });

    it("🔴 der Schalter media.role.photobox aus: beide Dateien in Quarantäne, an: beide zurück", async () => {
        const fall = await freigegeben(7, 800, 600);
        const liste = await oeffentlich(fall.assetId);
        hashes.push(...liste.map((datei) => datei.sha256));

        await database`INSERT INTO content_switch (key, enabled) VALUES ('media.role.photobox', FALSE)
                       ON CONFLICT (key) DO UPDATE SET enabled = FALSE`;
        // Andere Testdateien teilen sich die Datenbank: gezählt wird nur, was diese beiden Dateien betrifft.
        expect((await zieheQuarantaeneNach(database, store))?.moved).toBeGreaterThanOrEqual(2);
        expect(await quarantaeneZeilen(hashes)).toBe(2);
        for (const datei of liste) {
            expect(await store.exists(datei.storage_key)).toBe(false);
            expect(await store.exists(quarantineKey(datei.sha256))).toBe(true);
        }

        await database`UPDATE content_switch SET enabled = TRUE WHERE key = 'media.role.photobox'`;
        expect((await zieheQuarantaeneNach(database, store))?.restored).toBeGreaterThanOrEqual(2);
        expect(await quarantaeneZeilen(hashes)).toBe(0);
        for (const datei of liste) {
            expect(await store.exists(datei.storage_key)).toBe(true);
            expect(await store.exists(quarantineKey(datei.sha256))).toBe(false);
        }
    });

    it("🔴 ein Notaus hält beide Dateien; der Abgleich rührt die Zeilen und Dateien unter ihm nicht an", async () => {
        const fall = await freigegeben(8, 800, 600);
        const liste = await oeffentlich(fall.assetId);
        hashes.push(...liste.map((datei) => datei.sha256));
        const [quelle] = await database<{ sha256: string }[]>`
            SELECT sha256 FROM media_file WHERE media_asset_id = ${fall.assetId}::bigint AND storage_class = 'private_source'`;
        await database`
            INSERT INTO media_publication_suspension (source_sha256, media_asset_id, reason, suspended_by_person)
            VALUES (${quelle!.sha256}, ${fall.assetId}::bigint, 'Test', ${randomUUID()}::uuid)`;
        expect((await ziehNotausQuarantaeneNach(database, store)).moved).toBeGreaterThanOrEqual(2);
        expect(await quarantaeneZeilen(hashes)).toBe(2);
        for (const datei of liste) expect(await store.exists(quarantineKey(datei.sha256))).toBe(true);

        // Der Abgleich unter dem Notaus lässt beide Zeilen stehen (aus ihnen rechnet die Quarantäne) und legt nichts neu ab.
        const gehalten = await abgleich(fall.assetPublicId);
        expect(gehalten).toMatchObject({ published: false, reasons: ["suspended"] });
        expect(await varianten(fall.assetId)).toEqual(["photobox_2048", "photobox_kachel"]);
        for (const datei of liste) expect(await store.exists(datei.storage_key)).toBe(false);
    });

    it("🔴 eine Rolle header hat weiter genau eine öffentliche Zeile", async () => {
        const quelle = await store.store("private_source", await pngBytes(9, 900, 506), "png");
        const asset = await insertAsset(database, {
            ref: "kachel-header",
            technicalState: "pending",
            published: [],
        });
        await database`
            INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256)
            VALUES (${asset.id}::bigint, 'source', 'private_source', ${quelle.key}, 'image/png', 900, 506, ${quelle.byteSize}, ${quelle.sha256})`;
        const ort = await insertPlace(database, 91);
        await database`
            INSERT INTO place_media (place_id, media_asset_id, role, origin) VALUES (${ort.id}::bigint, ${asset.id}::bigint, 'header', 'editor')`;
        const ergebnis = await settleAssetFiles(database, store, { assetPublicId: asset.publicId, role: "header" });
        expect(ergebnis).toMatchObject({ published: true });
        expect((await oeffentlich(asset.id)).map((datei) => datei.variant)).toEqual(["header_16_9"]);
    });

    it("🔴 ein Asset, das nur die Hauptfassung hat, bekommt die Kachel beim nächsten Abgleich ergänzt", async () => {
        const fall = await freigegeben(10, 1000, 700);
        const kachel = (await oeffentlich(fall.assetId)).find((datei) => datei.variant === "photobox_kachel")!;
        // So steht ein Reisebild, das vor dieser Änderung freigegeben wurde: nur die Hauptfassung.
        await database`DELETE FROM media_file WHERE id = ${kachel.id}::bigint`;
        await store.remove(kachel.storage_key);
        expect(await varianten(fall.assetId)).toEqual(["photobox_2048"]);
        const haupt = (await oeffentlich(fall.assetId))[0]!;

        const nachgezogen = await abgleich(fall.assetPublicId);
        expect(nachgezogen).toMatchObject({ published: true, unchanged: false });
        const liste = await oeffentlich(fall.assetId);
        expect(liste.map((datei) => datei.variant).sort()).toEqual(["photobox_2048", "photobox_kachel"]);
        // Die Hauptfassung blieb dieselbe Zeile mit denselben Bytes.
        expect(liste.find((datei) => datei.variant === "photobox_2048")).toEqual(haupt);
        expect(await store.exists(liste.find((datei) => datei.variant === "photobox_kachel")!.storage_key)).toBe(true);
    });

    it("die Aufnahme legt bei publish nach der Hauptfassung die Kachel an; ohne publish nichts Öffentliches; andere Rollen eine", async () => {
        const bytes = await pngBytes(11, 1500, 1000);
        const mit = await ingestImage(store, { bytes, role: "photobox", publish: true });
        expect(mit.derivatives.map((datei) => datei.variant)).toEqual(["photobox_2048", "photobox_kachel"]);
        expect(mit.derivatives.map((datei) => datei.storageClass)).toEqual(["published", "published"]);
        expect(mit.derivatives[0]).toMatchObject({ width: 1500, height: 1000 });
        expect(mit.derivatives[1]).toMatchObject({ width: 480, height: 320, derivativeRecipe: "photobox_kachel" });

        const ohne = await ingestImage(store, { bytes, role: "photobox", publish: false });
        expect(ohne.derivatives).toEqual([]);

        const kopf = await ingestImage(store, { bytes: await pngBytes(12, 900, 506), role: "header", publish: true });
        expect(kopf.derivatives.map((datei) => datei.variant)).toEqual(["header_16_9"]);
    });

    it("das Profil der Kachel rechnet reproduzierbar und nie über 480 hinaus", async () => {
        const bytes = await pngBytes(13, 300, 1200);
        const kachel = await renderRaster(bytes, inspectImage(bytes), PHOTOBOX_KACHEL_PROFILE);
        expect([kachel.width, kachel.height]).toEqual([120, 480]);
        const nochmal = await renderRaster(bytes, inspectImage(bytes), PHOTOBOX_KACHEL_PROFILE);
        expect(nochmal.bytes.equals(kachel.bytes)).toBe(true);
    });
});
