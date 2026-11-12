import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { setMetadata, setRights } from "../src/media-editor/asset-operations.ts";
import { removeCoat } from "../src/media-editor/binding-operations.ts";
import { orderGallery, removeFromGallery } from "../src/media-editor/gallery-operations.ts";
import type { MediaActor } from "../src/media-editor/operation-store.ts";
import { importMediaFiles } from "../src/migration/media-files.ts";
import { importMedia, type ImportMediaReport } from "../src/migration/media-import.ts";
import { coatPng, createWorkspace, type Workspace } from "./support/media-files-fixture.ts";
import { cleanLegacyMedia, insertSubjects, manifestOf, type ItemSpec } from "./support/media-import-fixture.ts";
import { cleanEditorMedia, operation } from "./support/media-operations-fixture.ts";
import { place, territory } from "./support/media-world.ts";

/**
 * 🔴 Schutzregel (Betreiber 2026-10-10: „nein auf keinen fall nur die entscheidung darf nicht nachträglich kompromittiert werden“;
 * AGENTS.md „Blockierende Prüfungen im Betrieb“, WI-0068 P4a): `migrate:media` und `migrate:media-files` heben keine Entscheidung eines
 * Menschen auf. Ein erneuter Lauf lässt sie stehen und meldet einen Befund, statt anzuhalten.
 *
 * Die Entscheidungen entstehen, wo P4a sie baut, über die echten Operationen der Medienverwaltung („bewusst ohne“, Galerie umsortieren
 * und ein Bild aus ihr entfernen, Rechte und Entstehungsart setzen); die Einzelfreigabe oder -sperre einer Verwendung, der Widerruf einer Regel
 * und der Notaus haben noch keine Operation und stehen hier als Zeile, so wie ihre späteren Pakete sie schreiben.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const PERSON = "6d696d70-0000-4000-9000-0000000000aa";
const ACTOR: MediaActor = { personId: PERSON, environment: "test" };

const SPECS: ItemSpec[] = [
    { cls: "settlement_coat", subject: place(1), url: "/uploads/wappen/p1.png", code: "public_domain" },
    { cls: "settlement_image", subject: place(2), url: "/uploads/siedlungen/p2/a.webp", sort: 0, code: "ai_generated" },
    { cls: "settlement_image", subject: place(2), url: "/uploads/siedlungen/p2/b.webp", sort: 1, code: "ai_generated" },
    { cls: "settlement_coat", subject: place(3), url: "/uploads/wappen/p3.png", code: "public_domain" },
    { cls: "territory_coat", subject: territory(1), url: "/uploads/wappen/t1.png", code: "public_domain" },
];

const codes = (report: ImportMediaReport): string[] => report.findings.map((finding) => finding.code);
const objectsOf = (report: ImportMediaReport, code: string): string[] =>
    report.findings
        .filter((finding) => finding.code === code)
        .flatMap((finding) => finding.objects.map((o) => o.publicId));

describeWithDatabase(
    "Schutzregel: kein Lauf hebt eine Entscheidung eines Menschen auf (WI-0068 P4a)",
    { timeout: 120_000 },
    () => {
        let database: Database;

        const clean = async (): Promise<void> => {
            await database`
            DELETE FROM media_publication_suspension
             WHERE media_asset_id IN (SELECT id FROM media_asset WHERE source_system = 'avesmaps-legacy')
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
            await insertSubjects(database, { places: [1, 2, 3], territories: [1] });
            await importMedia(database, manifestOf(SPECS, "private"));
        });

        afterEach(clean);

        const assetOf = async (url: string) => {
            const [row] = await database<{ id: string; public_id: string }[]>`
            SELECT id::text, public_id::text FROM media_asset WHERE source_system = 'avesmaps-legacy' AND source_ref LIKE ${`%${url}`}
        `;
            return row!;
        };

        it("🔴 „bewusst ohne“ eines Editors bleibt, auch wenn Legacy das Wappen weiter nennt (held_by_editor)", async () => {
            const [binding] = await database<{ revision: number }[]>`
            SELECT m.revision::int AS revision FROM place_media m JOIN place p ON p.id = m.place_id
             WHERE p.public_id = ${place(1)}::uuid AND m.role = 'coat' AND m.retired_at IS NULL
        `;
            await removeCoat(database, ACTOR, {
                operationId: operation(),
                subject: { kind: "place", id: place(1) },
                baseRevision: binding!.revision,
            });
            const again = await importMedia(database, manifestOf(SPECS, "private"));
            expect(codes(again)).toContain("held_by_editor");
            expect(objectsOf(again, "held_by_editor")).toContain(place(1));
            const [state] = await database<{ suppression: string | null; active: number }[]>`
            SELECT (SELECT s.origin FROM place_media_suppression s JOIN place p ON p.id = s.place_id
                     WHERE p.public_id = ${place(1)}::uuid AND s.role = 'coat') AS suppression,
                   (SELECT count(*) FROM place_media m JOIN place p ON p.id = m.place_id
                     WHERE p.public_id = ${place(1)}::uuid AND m.retired_at IS NULL)::int AS active
        `;
            expect(state).toEqual({ suppression: "editor", active: 0 });
        });

        it("🔴 eine Galerie, die ein Editor umsortiert und gekürzt hat, bleibt so, wie er sie hinterließ", async () => {
            const a = await assetOf("/p2/a.webp");
            const b = await assetOf("/p2/b.webp");
            const gallery = async () =>
                database<
                    {
                        asset: string;
                        sort_order: number;
                        retired: boolean;
                        origin: string;
                        revision: number;
                        gallery: string;
                    }[]
                >`
                SELECT a.public_id::text AS asset, i.sort_order, i.retired_at IS NOT NULL AS retired, g.origin, g.revision::int AS revision,
                       g.public_id::text AS gallery
                  FROM place_media_gallery b JOIN place p ON p.id = b.place_id JOIN media_gallery g ON g.id = b.media_gallery_id
                  JOIN media_gallery_item i ON i.gallery_id = g.id JOIN media_asset a ON a.id = i.media_asset_id
                 WHERE p.public_id = ${place(2)}::uuid AND b.retired_at IS NULL
                 ORDER BY i.sort_order
            `;
            const { revision: before, gallery: galleryId } = (await gallery())[0]!;
            let revision = before;
            const reordered = await orderGallery(database, ACTOR, {
                operationId: operation(),
                galleryId,
                order: [b.public_id, a.public_id],
                baseRevision: revision,
            });
            revision = reordered.affected[0]!.revision!;
            const first = await importMedia(database, manifestOf(SPECS, "private"));
            expect(objectsOf(first, "held_by_editor")).toContain(place(2));
            expect((await gallery()).map((row) => row.asset)).toEqual([b.public_id, a.public_id]);

            await removeFromGallery(database, ACTOR, {
                operationId: operation(),
                galleryId,
                assetId: b.public_id,
                baseRevision: revision,
            });
            await importMedia(database, manifestOf(SPECS, "private"));
            // Legacy nennt b weiter; es bleibt zurückgezogen, a bleibt Kopfbild.
            expect((await gallery()).map((row) => [row.asset, row.retired, row.origin])).toEqual([
                [a.public_id, false, "editor"],
                [b.public_id, true, "editor"],
            ]);
            // Auch ein Manifest ohne den Ort zieht die Galerie des Editors nicht zurück.
            const without = await importMedia(
                database,
                manifestOf(
                    SPECS.filter((spec) => spec.subject !== place(2)),
                    "private",
                ),
            );
            expect(codes(without)).toContain("held_by_editor");
            expect((await gallery()).map((row) => row.retired)).toEqual([false, true]);
        });

        it("🔴 eine Einzelsperre an einer Verwendung bleibt, wenn Legacy das Wappen tauscht oder nicht mehr nennt (held_by_decision)", async () => {
            const t1 = await assetOf("/wappen/t1.png");
            await database`
            UPDATE territory_media SET publication_override = 'blocked', override_decided_on = '2026-10-10',
                   override_decided_by = ${PERSON}::uuid
             WHERE media_asset_id = ${t1.id} AND retired_at IS NULL
        `;
            const swapped = SPECS.map((spec) =>
                spec.subject === territory(1) ? { ...spec, url: "/uploads/wappen/t1-neu.png" } : spec,
            );
            const changed = await importMedia(database, manifestOf(swapped, "private"));
            expect(codes(changed)).toContain("held_by_decision");
            expect(objectsOf(changed, "held_by_decision")).toContain(territory(1));
            const active = async () =>
                database<{ asset: string; override: string }[]>`
                SELECT a.public_id::text AS asset, m.publication_override AS override
                  FROM territory_media m JOIN territory t ON t.id = m.territory_id JOIN media_asset a ON a.id = m.media_asset_id
                 WHERE t.public_id = ${territory(1)}::uuid AND m.retired_at IS NULL
            `;
            expect(await active()).toEqual([{ asset: t1.public_id, override: "blocked" }]);
            const gone = await importMedia(
                database,
                manifestOf(
                    SPECS.filter((spec) => spec.subject !== territory(1)),
                    "private",
                ),
            );
            expect(codes(gone)).toContain("held_by_decision");
            expect(await active()).toEqual([{ asset: t1.public_id, override: "blocked" }]);
        });

        it("🔴 Rechte und Entstehungsart aus dem MAM bleiben, wenn Legacy anderes sagt (held_by_decision)", async () => {
            const p3 = await assetOf("/wappen/p3.png");
            const [rights] = await database<{ revision: number }[]>`
            SELECT revision::int AS revision FROM media_rights WHERE media_asset_id = ${p3.id}
        `;
            await setRights(
                database,
                ACTOR,
                p3.public_id,
                {
                    operationId: operation(),
                    baseRevision: rights!.revision,
                    rights: { basis: "own_work", creator: "Redaktion Avesmaps" },
                },
                { pruefeCommunityLizenz: () => undefined },
            );
            const [asset] = await database<
                { revision: number }[]
            >`SELECT revision::int AS revision FROM media_asset WHERE id = ${p3.id}`;
            await setMetadata(database, ACTOR, p3.public_id, {
                operationId: operation(),
                baseRevision: asset!.revision,
                creationMethod: "drawing",
            });
            const changed = SPECS.map((spec) => (spec.subject === place(3) ? { ...spec, code: "ai_generated" } : spec));
            const report = await importMedia(database, manifestOf(changed, "private"));
            expect(objectsOf(report, "held_by_decision")).toContain(p3.public_id);
            const [after] = await database<{ basis: string; creator: string; method: string }[]>`
            SELECT r.rights_basis AS basis, r.creator, a.creation_method AS method
              FROM media_rights r JOIN media_asset a ON a.id = r.media_asset_id WHERE a.id = ${p3.id}
        `;
            expect(after).toEqual({ basis: "own_work", creator: "Redaktion Avesmaps", method: "drawing" });
        });

        it("eine widerrufene Freigaberegel bleibt widerrufen und steht als Befund im Bericht", async () => {
            await database`
            UPDATE publication_rule SET revoked_on = current_date, revoked_reason = 'Test'
             WHERE rights_basis = 'own_work' AND role = 'coat' AND license_key IS NULL AND revoked_on IS NULL
        `;
            const report = await importMedia(database, manifestOf(SPECS, "private"));
            expect(codes(report)).toContain("held_by_decision");
            const [rules] = await database<{ active: number; revoked: number }[]>`
            SELECT count(*) FILTER (WHERE revoked_on IS NULL)::int AS active, count(*) FILTER (WHERE revoked_on IS NOT NULL)::int AS revoked
              FROM publication_rule WHERE rights_basis = 'own_work' AND role = 'coat' AND license_key IS NULL
        `;
            expect(rules).toEqual({ active: 0, revoked: 1 });
        });

        describe("migrate:media-files", () => {
            let workspace: Workspace;

            beforeEach(async () => {
                workspace = await createWorkspace();
                await workspace.put("/uploads/wappen/p1.png", await coatPng(1), "png");
                await workspace.put("/uploads/wappen/p3.png", await coatPng(3), "png");
                await workspace.reopen();
            });

            afterEach(async () => {
                await workspace.dispose();
            });

            it("🔴 ein Notaus hält die Bytes: neue Bytes aus Legacy ersetzen nichts, nichts wird veröffentlicht (suspended_held)", async () => {
                const run = () =>
                    importMediaFiles(database, { store: workspace.store, downloads: workspace.downloads });
                await run();
                const p3 = await assetOf("/wappen/p3.png");
                const files = async () =>
                    database<{ storage_class: string; sha256: string }[]>`
                    SELECT storage_class, sha256 FROM media_file WHERE media_asset_id = ${p3.id} ORDER BY storage_class
                `;
                const before = await files();
                const source = before.find((row) => row.storage_class === "private_source")!;
                await database`
                INSERT INTO media_publication_suspension (source_sha256, media_asset_id, reason, suspended_by_person, file_state)
                VALUES (${source.sha256}, ${p3.id}, 'Abmahnung', ${PERSON}::uuid, 'quarantined')
            `;
                // Legacy legt unter derselben Adresse neue Bytes ab.
                await workspace.put("/uploads/wappen/p3.png", await coatPng(33), "png");
                await workspace.reopen();
                const report = await run();
                expect(report.held).toBe(1);
                expect(report.findings.map((finding) => finding.code)).toContain("suspended_held");
                expect(
                    report.findings
                        .find((finding) => finding.code === "suspended_held")
                        ?.objects.map((o) => o.publicId),
                ).toEqual([p3.public_id]);
                expect(await files()).toEqual(before);
                const [suspension] = await database<{ lifted: boolean; file_state: string }[]>`
                SELECT lifted_at IS NOT NULL AS lifted, file_state FROM media_publication_suspension WHERE media_asset_id = ${p3.id}
            `;
                expect(suspension).toEqual({ lifted: false, file_state: "quarantined" });
            });
        });
    },
);
