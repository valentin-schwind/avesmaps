import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { mergeAssets } from "../src/media-editor/merge.ts";
import type { MediaActor } from "../src/media-editor/operation-store.ts";
import { importMedia, type ImportMediaReport } from "../src/migration/media-import.ts";
import { cleanLegacyMedia, insertSubjects, manifestOf, type ItemSpec } from "./support/media-import-fixture.ts";
import { cleanEditorMedia, operation } from "./support/media-operations-fixture.ts";
import { place } from "./support/media-world.ts";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const PERSON = "6d696d70-0000-4000-9000-0000000000ab";
const ACTOR: MediaActor = { personId: PERSON, environment: "test" };

/**
 * 🔴 **Der Legacy-Zug nach einer Zusammenführung** (WI-0068 D1, Betreiber 2026-10-11, Entscheid A: „solang es ein klick ist …
 * nur wir nur 1x ‚duplikate zusammenfassen‘ müssen, wär mir das egal“).
 *
 * Das ist der Fall, an dem D1 steht oder fällt. Ohne die Umleitung geschähe Folgendes: Die Zusammenführung hinterlässt am Ort
 * eine Bindung mit Herkunft `editor`; der nächste Lauf sieht sie, lässt sie nach der Schutzregel stehen und meldet
 * `held_by_editor`. Jede spätere Legacy-Änderung an diesem Ort käme dann nicht mehr an, und jeder Lauf meldete Hunderte Befunde.
 *
 * Mit der Umleitung sieht der Lauf am Ort genau das Asset, das er erwartet, und ändert nichts.
 *
 * 🪤 Zwei Legacy-Bilder mit DENSELBEN Bytes sind der Normalfall des Bestands, nicht die Ausnahme: 1.025 Assets teilen ihre
 * Quelldatei. Hier stehen sie als zwei Einträge an zwei Orten.
 */
const SPECS: ItemSpec[] = [
    { cls: "settlement_coat", subject: place(1), url: "/uploads/wappen/gleich.png", code: "public_domain" },
    { cls: "settlement_coat", subject: place(2), url: "/uploads/wappen/gleich-2.png", code: "public_domain" },
    { cls: "settlement_coat", subject: place(3), url: "/uploads/wappen/anders.png", code: "public_domain" },
];

const codes = (report: ImportMediaReport): string[] => report.findings.map((finding) => finding.code);

describeWithDatabase("Legacy-Zug nach dem Zusammenführen (WI-0068 D1)", { timeout: 120_000 }, () => {
    let database: Database;

    const clean = async (): Promise<void> => {
        await database`
            DELETE FROM media_merge_move WHERE merge_id IN (
                SELECT m.id FROM media_merge m JOIN media_asset x ON x.id = m.merged_asset_id
                 WHERE x.source_system = 'avesmaps-legacy'
            )
        `;
        await database`
            DELETE FROM media_merge WHERE merged_asset_id IN (
                SELECT id FROM media_asset WHERE source_system = 'avesmaps-legacy'
            )
        `;
        await cleanEditorMedia(database, [PERSON]);
        await cleanLegacyMedia(database);
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await clean();
    }, 120_000);

    afterAll(async () => {
        await clean();
        await database?.end({ timeout: 5 });
    });

    beforeEach(async () => {
        await clean();
        await insertSubjects(database, { places: [1, 2, 3], territories: [] });
        await importMedia(database, manifestOf(SPECS, "private"));
        // Beide Wappen tragen DIESELBEN Bytes. Der Manifest-Import schreibt keine Dateien; die Originale stehen hier als Zeile,
        // so wie `migrate:media-files` sie später anlegt - das Zusammenführen braucht nur die SHA-256.
        const sha = "a".repeat(64);
        await database`
            INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256)
            SELECT a.id, 'original', 'private_source', 'private/source/' || a.public_id::text || '.png', 'image/png',
                   128, 128, 1024, ${sha}
              FROM media_asset a
             WHERE a.source_system = 'avesmaps-legacy' AND (a.source_ref LIKE '%gleich.png' OR a.source_ref LIKE '%gleich-2.png')
        `;
    });

    afterEach(clean);

    const assetOf = async (endung: string): Promise<{ id: string; publicId: string; revision: number }> => {
        const [row] = await database<{ id: string; publicId: string; revision: number }[]>`
            SELECT id::text AS id, public_id::text AS "publicId", revision::int AS revision FROM media_asset
             WHERE source_system = 'avesmaps-legacy' AND source_ref LIKE ${`%${endung}`}
        `;
        return row!;
    };

    /** Welches Asset trägt das aktive Wappen dieses Orts? */
    const wappenAm = async (publicId: string): Promise<{ asset: string; origin: string } | undefined> => {
        const [row] = await database<{ asset: string; origin: string }[]>`
            SELECT a.public_id::text AS asset, m.origin FROM place_media m
              JOIN place p ON p.id = m.place_id JOIN media_asset a ON a.id = m.media_asset_id
             WHERE p.public_id = ${publicId}::uuid AND m.role = 'coat' AND m.retired_at IS NULL
        `;
        return row;
    };

    it("🔴 nach dem Zusammenführen lässt ein zweiter Lauf alles stehen - keine neuen Assets, kein held_by_editor", async () => {
        const bleibt = await assetOf("gleich.png");
        const geht = await assetOf("gleich-2.png");
        await mergeAssets(database, ACTOR, {
            operationId: operation(),
            keep: { assetId: bleibt.publicId, baseRevision: bleibt.revision },
            merge: [{ assetId: geht.publicId, baseRevision: geht.revision }],
        });
        // Ort 2 trägt jetzt das bleibende Werk - und die Bindung gehört dem Editor.
        expect(await wappenAm(place(2))).toMatchObject({ asset: bleibt.publicId, origin: "editor" });

        const [vorher] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM media_asset WHERE source_system = 'avesmaps-legacy'
        `;
        const again = await importMedia(database, manifestOf(SPECS, "private"));

        expect(codes(again), "🔴 ohne die Umleitung stünde hier held_by_editor").not.toContain("held_by_editor");
        const [nachher] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM media_asset WHERE source_system = 'avesmaps-legacy'
        `;
        expect(nachher!.n, "kein neues Asset - der Schlüssel zeigt weiter auf sein Werk").toBe(vorher!.n);
        expect(await wappenAm(place(2)), "die Bindung bleibt, wie die Zusammenführung sie hinterließ").toMatchObject({
            asset: bleibt.publicId,
        });
    });

    it("🔴 eine Legacy-Änderung an einem ANDEREN Ort kommt weiter an", async () => {
        const bleibt = await assetOf("gleich.png");
        const geht = await assetOf("gleich-2.png");
        await mergeAssets(database, ACTOR, {
            operationId: operation(),
            keep: { assetId: bleibt.publicId, baseRevision: bleibt.revision },
            merge: [{ assetId: geht.publicId, baseRevision: geht.revision }],
        });

        // Legacy gibt Ort 3 ein anderes Wappen: Das hat mit der Zusammenführung nichts zu tun und muss ankommen.
        const geaendert: ItemSpec[] = [
            SPECS[0]!,
            SPECS[1]!,
            { cls: "settlement_coat", subject: place(3), url: "/uploads/wappen/neu.png", code: "public_domain" },
        ];
        await importMedia(database, manifestOf(geaendert, "private"));
        const neu = await assetOf("neu.png");
        expect(await wappenAm(place(3)), "der dritte Ort bekommt sein neues Wappen").toMatchObject({
            asset: neu.publicId,
            origin: "legacy",
        });
    });

    it("🪤 ändert Legacy die Bytes eines zusammengeführten Werks, meldet der Lauf einen Befund", async () => {
        const bleibt = await assetOf("gleich.png");
        const geht = await assetOf("gleich-2.png");
        await mergeAssets(database, ACTOR, {
            operationId: operation(),
            keep: { assetId: bleibt.publicId, baseRevision: bleibt.revision },
            merge: [{ assetId: geht.publicId, baseRevision: geht.revision }],
        });
        // Die Bytes des aufgegangenen Werks sind andere geworden: Was einmal gleich war, ist es nicht mehr.
        await database`
            UPDATE media_file SET sha256 = ${"b".repeat(64)}
             WHERE media_asset_id = ${geht.id}::bigint AND storage_class = 'private_source'
        `;
        const again = await importMedia(database, manifestOf(SPECS, "private"));
        expect(codes(again)).toContain("merged_source_changed");
        // 🔴 Der Lauf ändert deshalb NICHTS am bleibenden Werk: Das aufzulösen ist eine Entscheidung, keine Rechnung.
        expect(await wappenAm(place(2))).toMatchObject({ asset: bleibt.publicId });
    });

    it("eine AUFGEHOBENE Zusammenführung leitet nicht mehr um", async () => {
        const bleibt = await assetOf("gleich.png");
        const geht = await assetOf("gleich-2.png");
        await mergeAssets(database, ACTOR, {
            operationId: operation(),
            keep: { assetId: bleibt.publicId, baseRevision: bleibt.revision },
            merge: [{ assetId: geht.publicId, baseRevision: geht.revision }],
        });
        await database`UPDATE media_merge SET lifted_at = now(), lifted_by_person = ${PERSON}::uuid`;
        const [row] = await database<{ merged: string }[]>`
            SELECT merged_asset_id::text AS merged FROM media_merge WHERE lifted_at IS NULL
        `;
        expect(row, "keine aktive Zusammenführung mehr").toBeUndefined();
        const again = await importMedia(database, manifestOf(SPECS, "private"));
        expect(codes(again)).not.toContain("merged_source_changed");
    });
});
