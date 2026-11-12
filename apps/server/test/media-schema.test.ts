import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { storageKey } from "../src/media/storage.ts";
import {
    FIXTURE_SOURCE,
    cleanMediaFixtures,
    insertAsset,
    insertGallery,
    insertPlace,
    insertPublishedFile,
    insertRule,
    insertTerritory,
    sha,
    violation,
} from "./support/media-fixture.ts";

/**
 * Das Kernschema des Media Core gegen echtes PostgreSQL (WI-0063 MEDIA-M4, Migration 0064, media.yaml).
 * Jede Zeile hier ist eine Regel, die das Schema selbst hält, nicht der Importer.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const CHECK = "23514";
const UNIQUE = "23505";
const FOREIGN_KEY = "23503";

describeWithDatabase("Media Core: Schema (Migration 0064)", () => {
    let database: Database;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await cleanMediaFixtures(database);
    }, 120_000);

    afterAll(async () => {
        await cleanMediaFixtures(database);
        await database.end({ timeout: 5 });
    });

    beforeEach(async () => {
        await cleanMediaFixtures(database);
    });

    afterEach(async () => {
        await cleanMediaFixtures(database);
    });

    describe("Lizenzkatalog", () => {
        it("trägt die sechs Einträge des Vertrags, Rechtsbasen sind keine", async () => {
            const rows = await database<
                {
                    key: string;
                    display_name: string;
                    requires_attribution: boolean;
                    share_alike: boolean;
                    non_commercial: boolean;
                    family: string;
                }[]
            >`SELECT key, display_name, requires_attribution, share_alike, non_commercial, family FROM license_catalog ORDER BY key`;
            expect(rows.map((row) => row.key)).toEqual([
                "cc-by-4.0",
                "cc-by-nc-sa-3.0",
                "cc-by-nc-sa-4.0",
                "cc-by-sa-3.0",
                "cc-by-sa-4.0",
                "cc0-1.0",
                "pixabay",
                "public-domain",
            ]);
            const byKey = new Map(rows.map((row) => [row.key, row]));
            // Die Pixabay-Lizenz (WI-0282): keine Nennung, eigene Familie, also ein eigener Inhaltsschalter.
            expect(byKey.get("pixabay")).toMatchObject({
                display_name: "Pixabay Content License",
                requires_attribution: false,
                share_alike: false,
                non_commercial: false,
                family: "pixabay",
            });
            expect(byKey.get("cc0-1.0")).toMatchObject({ requires_attribution: false, family: "cc0" });
            expect(byKey.get("public-domain")).toMatchObject({ requires_attribution: false, family: "public-domain" });
            expect(byKey.get("cc-by-4.0")).toMatchObject({
                requires_attribution: true,
                share_alike: false,
                non_commercial: false,
            });
            expect(byKey.get("cc-by-nc-sa-3.0")).toMatchObject({
                requires_attribution: true,
                share_alike: true,
                non_commercial: true,
            });
            for (const basis of [
                "permission",
                "fan_policy",
                "own_work",
                "unknown",
                "license",
                "public_domain",
                "cc_by",
                "cc-by",
            ]) {
                expect(byKey.has(basis), `${basis} ist kein Katalogeintrag`).toBe(false);
            }
        });

        it("hat keine Lücke zum Vertrag: jede Zeile hat Name und https-Adresse", async () => {
            const [bad] = await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM license_catalog WHERE btrim(display_name) = '' OR canonical_uri !~ '^https://'
            `;
            expect(bad?.n).toBe(0);
        });
    });

    describe("Asset und Idempotenz", () => {
        it("(source_system, source_ref) ist eindeutig, der zweite Lauf legt nichts Neues an", async () => {
            const first = await insertAsset(database, { ref: "settlement-coat:a", published: [] });
            expect(await violation(insertAsset(database, { ref: "settlement-coat:a", published: [] }))).toMatchObject({
                code: UNIQUE,
                constraint: "media_asset_source_unique",
            });
            // So läuft der Import beim zweiten Mal: derselbe Schlüssel ergibt dieselbe Zeile.
            const [again] = await database<{ id: string; public_id: string }[]>`
                INSERT INTO media_asset (media_kind, origin, source_system, source_ref)
                VALUES ('image', 'legacy_import', ${FIXTURE_SOURCE}, 'settlement-coat:a')
                ON CONFLICT (source_system, source_ref) DO UPDATE SET updated_at = now()
                RETURNING id, public_id
            `;
            expect(again?.id).toBe(first.id);
            expect(again?.public_id).toBe(first.publicId);
        });

        it("Assets ohne Quellschlüssel kollidieren nie (spätere Uploads)", async () => {
            for (let i = 0; i < 2; i += 1) {
                await database`INSERT INTO media_asset (media_kind, origin, source_system) VALUES ('image', 'editor_upload', ${FIXTURE_SOURCE})`;
            }
            const [count] = await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM media_asset WHERE source_system = ${FIXTURE_SOURCE} AND source_ref IS NULL
            `;
            expect(count?.n).toBe(2);
        });

        it("die public_id entsteht selbst und ist je Asset verschieden; Zustände haben vorsichtige Vorgaben", async () => {
            const a = await insertAsset(database, { ref: "a", published: [] });
            const b = await insertAsset(database, { ref: "b", published: [] });
            expect(a.publicId).not.toBe(b.publicId);
            const [row] = await database<Record<string, unknown>[]>`
                INSERT INTO media_asset (media_kind, origin, source_system, source_ref) VALUES ('image', 'legacy_import', ${FIXTURE_SOURCE}, 'c')
                RETURNING technical_state, moderation_state, creation_method, degraded_original
            `;
            expect(row).toEqual({
                technical_state: "pending",
                moderation_state: "not_applicable",
                creation_method: "unknown",
                degraded_original: false,
            });
        });

        it("kennt die Medienarten, Herkünfte und Zustände des Vertrags und nur diese", async () => {
            const rejected = (values: Record<string, string>): Promise<unknown> => {
                const merged: Record<string, string | undefined> = {
                    media_kind: "image",
                    origin: "legacy_import",
                    ...values,
                };
                return database`
                    INSERT INTO media_asset (media_kind, origin, creation_method, technical_state, moderation_state, source_system, stamp_semantics)
                    VALUES (${merged["media_kind"] ?? ""}, ${merged["origin"] ?? ""}, ${merged["creation_method"] ?? "unknown"},
                            ${merged["technical_state"] ?? "ok"}, ${merged["moderation_state"] ?? "not_applicable"}, ${FIXTURE_SOURCE},
                            ${merged["stamp_semantics"] ?? null})
                `;
            };
            for (const kind of ["image", "model_3d"]) {
                await rejected({ media_kind: kind });
            }
            for (const origin of [
                "legacy_import",
                "editor_upload",
                "community_upload",
                "wiki_import",
                "wiki_localized",
                "project_generated",
                "external_import",
            ]) {
                await rejected({ origin });
            }
            expect((await violation(rejected({ media_kind: "audio" }))).code).toBe(CHECK);
            expect((await violation(rejected({ origin: "scraped" }))).code).toBe(CHECK);
            expect((await violation(rejected({ creation_method: "stock" }))).code).toBe(CHECK);
            expect((await violation(rejected({ technical_state: "broken" }))).code).toBe(CHECK);
            expect((await violation(rejected({ moderation_state: "maybe" }))).code).toBe(CHECK);
            expect((await violation(rejected({ stamp_semantics: "guess" }))).code).toBe(CHECK);
        });
    });

    describe("Dateien und Repräsentationen", () => {
        it("zwei Assets dürfen dieselben Bytes tragen: zwei Zeilen, ein Schlüssel, kein fachliches Zusammenlegen", async () => {
            const bytesHash = sha("dieselben Bytes");
            const a = await insertAsset(database, { ref: "same-a", published: [] });
            const b = await insertAsset(database, { ref: "same-b", published: [] });
            await insertPublishedFile(database, a.id, "x", { variant: "coat", sha: bytesHash });
            await insertPublishedFile(database, b.id, "x", { variant: "coat", sha: bytesHash });
            const rows = await database<{ media_asset_id: string; storage_key: string }[]>`
                SELECT media_asset_id, storage_key FROM media_file WHERE sha256 = ${bytesHash} ORDER BY media_asset_id
            `;
            expect(rows).toHaveLength(2);
            expect(new Set(rows.map((row) => row.media_asset_id)).size).toBe(2);
            expect(new Set(rows.map((row) => row.storage_key)).size).toBe(1);
        });

        it("ein Asset trägt mehrere Repräsentationen: Quelle, Master und Ableitungen", async () => {
            const asset = await insertAsset(database, { ref: "reps", published: [] });
            const insert = (
                variant: string,
                storageClass: string,
                seed: string,
                recipe: string | null,
                version: string | null,
                mime = "image/png",
            ) => {
                const hash = sha(seed);
                const extension = storageClass === "published" ? "webp" : "png";
                return database`
                    INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256,
                                            derivative_recipe, recipe_version)
                    VALUES (${asset.id}, ${variant}, ${storageClass}, ${storageKey(storageClass as "published", hash, extension)},
                            ${storageClass === "published" ? "image/webp" : mime}, 800, 450, 100, ${hash}, ${recipe}, ${version})
                `;
            };
            await insert("source", "private_source", "reps-source", null, null);
            await insert("master", "master", "reps-master", null, null);
            await insert("header_crop", "derivative", "reps-derivative", "crop-16-9", "1");
            await insert("header_crop", "derivative", "reps-derivative-2", "crop-16-9", "2");
            await insert("header_16_9", "published", "reps-published", "webp-q80", "1");
            await insert("coat", "published", "reps-coat", "webp-lossless", "1");
            const [count] = await database<
                { n: number }[]
            >`SELECT count(*)::int AS n FROM media_file WHERE media_asset_id = ${asset.id}`;
            expect(count?.n).toBe(6);

            // Je Asset genau EIN source und EIN master (beide ohne Rezeptversion, NULLS NOT DISTINCT).
            expect((await violation(insert("source", "private_source", "reps-source-2", null, null))).constraint).toBe(
                "media_file_variant_unique",
            );
            expect((await violation(insert("master", "master", "reps-master-2", null, null))).constraint).toBe(
                "media_file_variant_unique",
            );
            // Dieselbe Variante und Rezeptversion nie zweimal.
            expect(
                (await violation(insert("header_crop", "derivative", "reps-derivative-3", "crop-16-9", "2"))).code,
            ).toBe(UNIQUE);
            // Der Variantenname ist über alle Klassen eindeutig: auch die veröffentlichte Fassung heißt anders.
            expect(
                (await violation(insert("header_16_9", "derivative", "reps-derivative-4", "webp-q80", "1"))).constraint,
            ).toBe("media_file_variant_unique");
            // 🔴 Je Variante höchstens EINE veröffentlichte Repräsentation: eine zweite Version ersetzt die erste.
            expect(
                (await violation(insert("header_16_9", "published", "reps-published-2", "webp-q80", "2"))).constraint,
            ).toBe("media_file_one_published_per_variant");
        });

        it("SHA-256 ist keine Assetidentität: dasselbe Werk ist nicht über den Hash zu finden, aber der Hash ist nachschlagbar", async () => {
            const [index] = await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM pg_indexes WHERE tablename = 'media_file' AND indexname = 'media_file_sha256'
            `;
            expect(index?.n).toBe(1);
            const [unique] = await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM pg_indexes
                WHERE tablename = 'media_file' AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%(sha256)%'
            `;
            expect(unique?.n).toBe(0);
        });

        it("🔴 der Pfadwächter: kein führendes /, kein Laufwerk, kein Rückwärtsstrich, kein ..-Segment", async () => {
            const check = async (key: string): Promise<boolean> => {
                const [row] = await database<{ ok: boolean }[]>`SELECT media_storage_key_is_relative(${key}) AS ok`;
                return row?.ok ?? false;
            };
            for (const bad of ["/abs/x.webp", "C:\\x", "c:/x", "a\\b", "a/../b", "../x", "a/..", "..", "", "   "]) {
                expect(await check(bad), JSON.stringify(bad)).toBe(false);
            }
            for (const good of ["published/sha256/ab/cd/x.webp", "master/a.b/c", "private/source/x", "a..b/c"]) {
                expect(await check(good), good).toBe(true);
            }
        });

        it("🔴 media_file lehnt absolute und rückwärtsführende Schlüssel ab", async () => {
            const asset = await insertAsset(database, { ref: "keys", published: [] });
            const insert = (key: string) =>
                database`
                    INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, byte_size, sha256)
                    VALUES (${asset.id}, 'master', 'master', ${key}, 'image/png', 10, ${sha("keys")})
                `;
            for (const key of ["/abs/x", "C:\\x", "a/../b", "master/../../x", "master/a\\b"]) {
                expect((await violation(insert(key))).code, key).toBe(CHECK);
            }
            // Isoliert: Klasse stimmt, nur das ..-Segment verletzt die Regel.
            expect((await violation(insert("master/../x"))).constraint).toBe("media_file_storage_key_relative");
            // Ein gewöhnlicher Schlüssel geht durch.
            await insert(storageKey("master", sha("keys"), "png"));
        });

        it("🔴 Klasse und Verzeichnis gehören zusammen; veröffentlicht ist nur eine WebP-Datei unter der Adresse ihres Hashes", async () => {
            const asset = await insertAsset(database, { ref: "classes", published: [] });
            const hash = sha("classes");
            const insert = (values: {
                storageClass: string;
                key: string;
                mime?: string;
                width?: number | null;
                recipe?: boolean;
            }) =>
                database`
                    INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256,
                                            derivative_recipe, recipe_version)
                    VALUES (${asset.id}, 'v', ${values.storageClass}, ${values.key}, ${values.mime ?? "image/webp"},
                            ${values.width === undefined ? 10 : values.width}, ${values.width === undefined ? 10 : values.width}, 10, ${hash},
                            ${values.recipe === false ? null : "r"}, ${values.recipe === false ? null : "1"})
                `;
            // Ein privater Schlüssel unter published/ und ein veröffentlichter außerhalb sind unmöglich.
            expect(
                (await violation(insert({ storageClass: "master", key: storageKey("published", hash, "webp") })))
                    .constraint,
            ).toBe("media_file_storage_key_class");
            expect(
                (await violation(insert({ storageClass: "published", key: storageKey("master", hash, "webp") })))
                    .constraint,
            ).toBe("media_file_storage_key_class");
            // Die Adresse ist eine Funktion des Hashes: ein fremder Hash oder ein fremder Name geht nicht.
            expect(
                (
                    await violation(
                        insert({
                            storageClass: "published",
                            key: storageKey("published", sha("anderer Hash"), "webp"),
                        }),
                    )
                ).constraint,
            ).toBe("media_file_storage_key_class");
            expect(
                (await violation(insert({ storageClass: "published", key: "published/wappen/gareth.webp" })))
                    .constraint,
            ).toBe("media_file_storage_key_class");
            // Kein SVG und kein anderes Format öffentlich, keine unbekannten Maße.
            const publishedKey = storageKey("published", hash, "webp");
            expect(
                (await violation(insert({ storageClass: "published", key: publishedKey, mime: "image/svg+xml" })))
                    .constraint,
            ).toBe("media_file_published_webp");
            expect(
                (await violation(insert({ storageClass: "published", key: publishedKey, mime: "image/png" })))
                    .constraint,
            ).toBe("media_file_published_webp");
            expect(
                (await violation(insert({ storageClass: "published", key: publishedKey, width: null }))).constraint,
            ).toBe("media_file_published_webp");
            // Eine Ableitung ohne Rezept und Version ist nicht reproduzierbar.
            expect(
                (await violation(insert({ storageClass: "published", key: publishedKey, recipe: false }))).constraint,
            ).toBe("media_file_recipe_when_derived");
            // Klasse und Schlüssel stimmen: geht durch.
            await insert({ storageClass: "published", key: publishedKey });
        });

        it("Hash, Typ, Maße und Größe sind geprüft", async () => {
            const asset = await insertAsset(database, { ref: "fields", published: [] });
            const insert = (hash: string, mime: string, width: number | null, height: number | null, size: number) =>
                database`
                    INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256)
                    VALUES (${asset.id}, 'master', 'master', 'master/x', ${mime}, ${width}, ${height}, ${size}, ${hash})
                `;
            expect((await violation(insert("ABCD", "image/png", 1, 1, 1))).constraint).toBe("media_file_sha256_format");
            expect((await violation(insert(sha("f").toUpperCase(), "image/png", 1, 1, 1))).constraint).toBe(
                "media_file_sha256_format",
            );
            expect((await violation(insert(sha("f"), "kein mime", 1, 1, 1))).constraint).toBe("media_file_mime_format");
            expect((await violation(insert(sha("f"), "image/png", 0, 1, 1))).constraint).toBe("media_file_dimensions");
            expect((await violation(insert(sha("f"), "image/png", 5, null, 1))).constraint).toBe(
                "media_file_dimensions",
            );
            expect((await violation(insert(sha("f"), "image/png", 1, 1, 0))).constraint).toBe(
                "media_file_byte_size_positive",
            );
        });

        it("keine Waisen: eine Datei ohne Asset, ein Asset mit Dateien lässt sich nicht löschen", async () => {
            expect(
                (
                    await violation(
                        database`INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, byte_size, sha256)
                                 VALUES (-1, 'master', 'master', 'master/x', 'image/png', 1, ${sha("x")})`,
                    )
                ).code,
            ).toBe(FOREIGN_KEY);
            const asset = await insertAsset(database, { ref: "orphan" });
            expect((await violation(database`DELETE FROM media_asset WHERE id = ${asset.id}`)).code).toBe(FOREIGN_KEY);
        });
    });

    describe("Rechte", () => {
        const insertRights = (
            assetId: string,
            values: { basis: string; clearance?: string; licenseKey?: string | null; family?: string | null },
        ) =>
            database`
                INSERT INTO media_rights (media_asset_id, rights_basis, license_key, license_family, clearance_state)
                VALUES (${assetId}, ${values.basis}, ${values.licenseKey ?? null}, ${values.family ?? null}, ${values.clearance ?? "unreviewed"})
            `;

        it("Rechtsbasis und Lizenz sind getrennt: ein Lizenzschlüssel nur bei `license`", async () => {
            const asset = await insertAsset(database, { ref: "rights-1", rights: null, published: [] });
            for (const basis of ["public_domain", "permission", "fan_policy", "own_work", "unknown"]) {
                expect(
                    (await violation(insertRights(asset.id, { basis, licenseKey: "cc0-1.0" }))).constraint,
                    basis,
                ).toBe("media_rights_license_key_needs_license");
            }
            expect((await violation(insertRights(asset.id, { basis: "own_work", family: "cc-by" }))).constraint).toBe(
                "media_rights_license_family_needs_license",
            );
            await insertRights(asset.id, { basis: "license", licenseKey: "cc0-1.0", clearance: "legacy_asserted" });
        });

        it("`license` ohne Schlüssel gibt es nur als offene Frage (needs_review); cc_by bekommt keine geratene Version", async () => {
            const asset = await insertAsset(database, { ref: "rights-2", rights: null, published: [] });
            for (const clearance of ["unreviewed", "legacy_assumed", "legacy_asserted", "cleared", "rejected"]) {
                expect(
                    (await violation(insertRights(asset.id, { basis: "license", clearance }))).constraint,
                    clearance,
                ).toBe("media_rights_license_needs_key_or_review");
            }
            await insertRights(asset.id, { basis: "license", family: "cc-by", clearance: "needs_review" });
            const [row] = await database<{ license_key: string | null; license_family: string | null }[]>`
                SELECT license_key, license_family FROM media_rights WHERE media_asset_id = ${asset.id}
            `;
            expect(row).toEqual({ license_key: null, license_family: "cc-by" });
        });

        it("ein unbekannter Lizenzschlüssel scheitert am Katalog; Basis und Clearance sind geschlossene Listen", async () => {
            const asset = await insertAsset(database, { ref: "rights-3", rights: null, published: [] });
            expect(
                (
                    await violation(
                        insertRights(asset.id, { basis: "license", licenseKey: "cc-by", clearance: "cleared" }),
                    )
                ).code,
            ).toBe(FOREIGN_KEY);
            expect((await violation(insertRights(asset.id, { basis: "ai_generated" }))).constraint).toBe(
                "media_rights_basis_known",
            );
            expect(
                (await violation(insertRights(asset.id, { basis: "own_work", clearance: "approved" }))).constraint,
            ).toBe("media_rights_clearance_known");
            await insertRights(asset.id, { basis: "own_work", clearance: "legacy_assumed" });
        });

        it("Rechte, Entstehung sind 1:1 zum Asset", async () => {
            const asset = await insertAsset(database, { ref: "rights-4", published: [] });
            expect((await violation(insertRights(asset.id, { basis: "own_work" }))).code).toBe(UNIQUE);
            await database`INSERT INTO media_creation (media_asset_id, tool, prompt, parameters) VALUES (${asset.id}, 'Generator', 'ein Prompt', '{"steps": 30}'::jsonb)`;
            expect(
                (
                    await violation(
                        database`INSERT INTO media_creation (media_asset_id, tool) VALUES (${asset.id}, 'noch einer')`,
                    )
                ).code,
            ).toBe(UNIQUE);
            expect(
                (
                    await violation(
                        database`UPDATE media_creation SET parameters = '[1,2]'::jsonb WHERE media_asset_id = ${asset.id}`,
                    )
                ).constraint,
            ).toBe("media_creation_parameters_object");
        });
    });

    describe("Belege", () => {
        it("hängen an GENAU EINEM von Asset oder Freigaberegel", async () => {
            const asset = await insertAsset(database, { ref: "evidence-1", published: [] });
            const ruleId = await insertRule(database, { basis: "fan_policy", role: "literature_cover" });
            const insert = (assetId: string | null, rule: string | null) =>
                database`
                    INSERT INTO media_rights_evidence (media_asset_id, publication_rule_id, evidence_kind, external_url)
                    VALUES (${assetId}, ${rule}, 'license_page', 'https://ulisses-spiele.de/fan-richtlinie/')
                `;
            await insert(asset.id, null);
            await insert(null, ruleId);
            expect((await violation(insert(asset.id, ruleId))).constraint).toBe("media_rights_evidence_one_subject");
            expect((await violation(insert(null, null))).constraint).toBe("media_rights_evidence_one_subject");
        });

        it("Datei ODER Adresse, eine Datei trägt ihre SHA-256, eine Betreibernotiz darf beides entbehren", async () => {
            const asset = await insertAsset(database, { ref: "evidence-2", published: [] });
            const hash = sha("beleg.pdf");
            const evidenceKey = `private/evidence/sha256/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}.pdf`;
            const insert = (values: { kind: string; key?: string | null; url?: string | null; hash?: string | null }) =>
                database`
                    INSERT INTO media_rights_evidence (media_asset_id, evidence_kind, storage_key, external_url, sha256)
                    VALUES (${asset.id}, ${values.kind}, ${values.key ?? null}, ${values.url ?? null}, ${values.hash ?? null})
                `;
            await insert({ kind: "pdf", key: evidenceKey, hash });
            await insert({ kind: "license_page", url: "https://creativecommons.org/licenses/by/4.0/" });
            await insert({ kind: "operator_note" });
            // Beides, weder noch (außer Notiz), Datei ohne Hash, Hash ohne Datei, Datei im öffentlichen Bereich.
            expect(
                (await violation(insert({ kind: "email", key: evidenceKey, hash, url: "https://x.example/" })))
                    .constraint,
            ).toBe("media_rights_evidence_one_source");
            expect((await violation(insert({ kind: "email" }))).constraint).toBe("media_rights_evidence_one_source");
            expect((await violation(insert({ kind: "pdf", key: evidenceKey }))).constraint).toBe(
                "media_rights_evidence_file_has_hash",
            );
            expect((await violation(insert({ kind: "pdf", url: "https://x.example/", hash }))).constraint).toBe(
                "media_rights_evidence_file_has_hash",
            );
            expect(
                (await violation(insert({ kind: "pdf", key: storageKey("published", hash, "webp"), hash }))).constraint,
            ).toBe("media_rights_evidence_key_relative");
            expect(
                (await violation(insert({ kind: "pdf", key: "private/evidence/../source/x", hash }))).constraint,
            ).toBe("media_rights_evidence_key_relative");
            expect((await violation(insert({ kind: "license_page", url: "javascript:alert(1)" }))).constraint).toBe(
                "media_rights_evidence_url_http",
            );
            expect((await violation(insert({ kind: "screenshot", url: "https://x.example/" }))).constraint).toBe(
                "media_rights_evidence_kind_known",
            );
        });
    });

    describe("Galerien", () => {
        const insertItem = (galleryId: string, assetId: string, order: number) =>
            database`INSERT INTO media_gallery_item (gallery_id, media_asset_id, sort_order) VALUES (${galleryId}, ${assetId}, ${order})`;

        it("die Reihenfolge ist stabil, ein Asset steht höchstens einmal je Galerie, aber in mehreren Galerien", async () => {
            const gallery = await insertGallery(database, "settlement-gallery:a");
            const other = await insertGallery(database, "settlement-gallery:b");
            // Nacheinander, nicht mit Promise.all: Jede Anlage ist eine eigene Transaktion, und drei gleichzeitige Verbindungen
            // scheitern am geteilten lokalen Cluster, sobald andere Sitzungen ihn auslasten.
            const assets = [];
            for (const n of [1, 2, 3])
                assets.push(await insertAsset(database, { ref: `gal-${String(n)}`, published: [] }));
            // Absichtlich nicht in Reihenfolge eingefügt.
            await insertItem(gallery.id, assets[2]?.id ?? "", 3);
            await insertItem(gallery.id, assets[0]?.id ?? "", 1);
            await insertItem(gallery.id, assets[1]?.id ?? "", 2);
            const ordered = await database<{ media_asset_id: string }[]>`
                SELECT media_asset_id FROM media_gallery_item WHERE gallery_id = ${gallery.id} ORDER BY sort_order
            `;
            expect(ordered.map((row) => row.media_asset_id)).toEqual(assets.map((asset) => asset.id));

            expect((await violation(insertItem(gallery.id, assets[0]?.id ?? "", 9))).constraint).toBe(
                "media_gallery_item_asset_unique",
            );
            await insertItem(other.id, assets[0]?.id ?? "", 1);
        });

        it("🔴 Umsortieren geht in EINER Transaktion über Zwischenzustände; nach dem Ende gilt die Eindeutigkeit", async () => {
            const gallery = await insertGallery(database, "settlement-gallery:reorder");
            const a = await insertAsset(database, { ref: "re-a", published: [] });
            const b = await insertAsset(database, { ref: "re-b", published: [] });
            const c = await insertAsset(database, { ref: "re-c", published: [] });
            await insertItem(gallery.id, a.id, 1);
            await insertItem(gallery.id, b.id, 2);
            await insertItem(gallery.id, c.id, 3);

            // a und c tauschen die Stelle: dazwischen stehen zwei Einträge auf derselben.
            await database.begin(async (transaction) => {
                await transaction`UPDATE media_gallery_item SET sort_order = 3 WHERE gallery_id = ${gallery.id} AND media_asset_id = ${a.id}`;
                await transaction`UPDATE media_gallery_item SET sort_order = 1 WHERE gallery_id = ${gallery.id} AND media_asset_id = ${c.id}`;
            });
            const swapped = await database<{ media_asset_id: string }[]>`
                SELECT media_asset_id FROM media_gallery_item WHERE gallery_id = ${gallery.id} ORDER BY sort_order
            `;
            expect(swapped.map((row) => row.media_asset_id)).toEqual([c.id, b.id, a.id]);

            // Eine doppelte Stelle am Ende der Transaktion ist ein Fehler.
            expect(
                (
                    await violation(
                        insertItem(gallery.id, (await insertAsset(database, { ref: "re-d", published: [] })).id, 2),
                    )
                ).constraint,
            ).toBe("media_gallery_item_order_unique");
            // Eine Anweisung, die alle Stellen verschiebt, geht ebenfalls durch.
            await database`UPDATE media_gallery_item SET sort_order = sort_order + 10 WHERE gallery_id = ${gallery.id}`;
        });

        it("Quellschlüssel der Galerie ist eindeutig; die Art ist object_gallery", async () => {
            await insertGallery(database, "settlement-gallery:unique");
            expect((await violation(insertGallery(database, "settlement-gallery:unique"))).constraint).toBe(
                "media_gallery_source_unique",
            );
            expect(
                (
                    await violation(
                        database`INSERT INTO media_gallery (gallery_kind, source_system, source_ref) VALUES ('social', ${FIXTURE_SOURCE}, 'x')`,
                    )
                ).constraint,
            ).toBe("media_gallery_kind_known");
        });

        it("keine Waisen: ein Eintrag braucht Galerie und Asset", async () => {
            const gallery = await insertGallery(database, "settlement-gallery:fk");
            const asset = await insertAsset(database, { ref: "fk", published: [] });
            expect((await violation(insertItem("-1", asset.id, 1))).code).toBe(FOREIGN_KEY);
            expect((await violation(insertItem(gallery.id, "-1", 1))).code).toBe(FOREIGN_KEY);
            await insertItem(gallery.id, asset.id, 1);
            expect((await violation(database`DELETE FROM media_gallery WHERE id = ${gallery.id}`)).code).toBe(
                FOREIGN_KEY,
            );
        });
    });

    describe("Einzelfreigabe am Binding und am Galerieeintrag", () => {
        it("🔴 `approved` braucht Datum und wörtliches Zitat, an allen drei Stellen", async () => {
            const place = await insertPlace(database, 1);
            const territory = await insertTerritory(database, 2);
            const gallery = await insertGallery(database, "settlement-gallery:override");
            const asset = await insertAsset(database, { ref: "override", published: [] });
            const approve = {
                item: (date: string | null, quote: string | null) =>
                    database`INSERT INTO media_gallery_item (gallery_id, media_asset_id, sort_order, publication_override, override_decided_on, override_operator_quote)
                             VALUES (${gallery.id}, ${asset.id}, 1, 'approved', ${date}, ${quote})`,
                place: (date: string | null, quote: string | null) =>
                    database`INSERT INTO place_media (place_id, media_asset_id, role, origin, publication_override, override_decided_on, override_operator_quote)
                             VALUES (${place.id}, ${asset.id}, 'coat', 'legacy', 'approved', ${date}, ${quote})`,
                territory: (date: string | null, quote: string | null) =>
                    database`INSERT INTO territory_media (territory_id, media_asset_id, role, origin, publication_override, override_decided_on, override_operator_quote)
                             VALUES (${territory.id}, ${asset.id}, 'coat', 'legacy', 'approved', ${date}, ${quote})`,
            };
            const constraints = {
                item: "media_gallery_item_approved_has_decision",
                place: "place_media_approved_has_decision",
                territory: "territory_media_approved_has_decision",
            } as const;
            for (const kind of ["item", "place", "territory"] as const) {
                expect((await violation(approve[kind](null, null))).constraint, kind).toBe(constraints[kind]);
                expect((await violation(approve[kind]("2026-10-04", null))).constraint, kind).toBe(constraints[kind]);
                expect((await violation(approve[kind]("2026-10-04", "   "))).constraint, kind).toBe(constraints[kind]);
                expect((await violation(approve[kind](null, "Betreiber: ja"))).constraint, kind).toBe(
                    constraints[kind],
                );
                await approve[kind]("2026-10-04", "Betreiber: ja");
            }
            // blocked und none brauchen kein Zitat; andere Werte gibt es nicht.
            expect(
                (
                    await violation(
                        database`UPDATE place_media SET publication_override = 'maybe' WHERE place_id = ${place.id}`,
                    )
                ).constraint,
            ).toBe("place_media_override_known");
            await database`UPDATE place_media SET publication_override = 'blocked', override_decided_on = NULL, override_operator_quote = NULL WHERE place_id = ${place.id}`;
        });
    });

    describe("Bindungen", () => {
        it("🔴 höchstens EINE aktive Bindung je Ort und Rolle; zurückgezogene bleiben als Verlauf", async () => {
            const place = await insertPlace(database, 10);
            const first = await insertAsset(database, { ref: "bind-1", published: [] });
            const second = await insertAsset(database, { ref: "bind-2", published: [] });
            const bind = (assetId: string, role: string, retired = false) =>
                database`INSERT INTO place_media (place_id, media_asset_id, role, origin, retired_at)
                         VALUES (${place.id}, ${assetId}, ${role}, 'legacy', ${retired ? new Date("2026-10-01T00:00:00Z") : null})`;
            await bind(first.id, "coat");
            expect((await violation(bind(second.id, "coat"))).constraint).toBe("place_media_one_active_per_role");
            // Eine andere Rolle desselben Ortes und dasselbe Asset in anderer Rolle sind frei.
            await bind(second.id, "header");
            await bind(first.id, "header", true);
            // Zurückziehen macht die Stelle frei; die alte Zeile bleibt.
            await database`UPDATE place_media SET retired_at = now() WHERE place_id = ${place.id} AND media_asset_id = ${first.id} AND role = 'coat'`;
            await bind(second.id, "coat");
            const [count] = await database<
                { n: number }[]
            >`SELECT count(*)::int AS n FROM place_media WHERE place_id = ${place.id}`;
            expect(count?.n).toBe(4);
            // (Objekt, Asset, Rolle) nie zweimal, auch nicht zurückgezogen.
            expect((await violation(bind(first.id, "coat", true))).constraint).toBe("place_media_unique");
        });

        it("Rollen: Ort coat und header, Gebiet nur coat, nie eine gallery-Rolle", async () => {
            const place = await insertPlace(database, 11);
            const territory = await insertTerritory(database, 12);
            const asset = await insertAsset(database, { ref: "roles", published: [] });
            expect(
                (
                    await violation(
                        database`INSERT INTO place_media (place_id, media_asset_id, role, origin) VALUES (${place.id}, ${asset.id}, 'gallery', 'legacy')`,
                    )
                ).constraint,
            ).toBe("place_media_role_known");
            expect(
                (
                    await violation(
                        database`INSERT INTO territory_media (territory_id, media_asset_id, role, origin) VALUES (${territory.id}, ${asset.id}, 'header', 'legacy')`,
                    )
                ).constraint,
            ).toBe("territory_media_role_known");
            expect(
                (
                    await violation(
                        database`INSERT INTO place_media (place_id, media_asset_id, role, origin) VALUES (${place.id}, ${asset.id}, 'coat', 'scraper')`,
                    )
                ).constraint,
            ).toBe("place_media_origin_known");
            await database`INSERT INTO territory_media (territory_id, media_asset_id, role, origin) VALUES (${territory.id}, ${asset.id}, 'coat', 'wiki_localized')`;
        });

        it("🔴 höchstens eine aktive Gebietsbindung je Rolle, höchstens eine aktive Kopfgalerie je Ort", async () => {
            const territory = await insertTerritory(database, 13);
            const place = await insertPlace(database, 14);
            const a = await insertAsset(database, { ref: "tb-a", published: [] });
            const b = await insertAsset(database, { ref: "tb-b", published: [] });
            await database`INSERT INTO territory_media (territory_id, media_asset_id, role, origin) VALUES (${territory.id}, ${a.id}, 'coat', 'legacy')`;
            expect(
                (
                    await violation(
                        database`INSERT INTO territory_media (territory_id, media_asset_id, role, origin) VALUES (${territory.id}, ${b.id}, 'coat', 'legacy')`,
                    )
                ).constraint,
            ).toBe("territory_media_one_active_per_role");

            const g1 = await insertGallery(database, "settlement-gallery:g1");
            const g2 = await insertGallery(database, "settlement-gallery:g2");
            const bindGallery = (galleryId: string) =>
                database`INSERT INTO place_media_gallery (place_id, media_gallery_id, role, origin) VALUES (${place.id}, ${galleryId}, 'header', 'legacy')`;
            await bindGallery(g1.id);
            expect((await violation(bindGallery(g2.id))).constraint).toBe("place_media_gallery_one_active_per_role");
            await database`UPDATE place_media_gallery SET retired_at = now() WHERE media_gallery_id = ${g1.id}`;
            await bindGallery(g2.id);
            expect(
                (
                    await violation(
                        database`INSERT INTO place_media_gallery (place_id, media_gallery_id, role, origin) VALUES (${place.id}, ${g1.id}, 'coat', 'legacy')`,
                    )
                ).constraint,
            ).toBe("place_media_gallery_role_known");
        });

        it("keine Waisen: Bindungen brauchen Ort, Gebiet, Asset und Galerie wirklich", async () => {
            const place = await insertPlace(database, 15);
            const asset = await insertAsset(database, { ref: "fk-bind", published: [] });
            const gallery = await insertGallery(database, "settlement-gallery:fk-bind");
            expect(
                (
                    await violation(
                        database`INSERT INTO place_media (place_id, media_asset_id, role, origin) VALUES (-1, ${asset.id}, 'coat', 'legacy')`,
                    )
                ).code,
            ).toBe(FOREIGN_KEY);
            expect(
                (
                    await violation(
                        database`INSERT INTO place_media (place_id, media_asset_id, role, origin) VALUES (${place.id}, -1, 'coat', 'legacy')`,
                    )
                ).code,
            ).toBe(FOREIGN_KEY);
            expect(
                (
                    await violation(
                        database`INSERT INTO territory_media (territory_id, media_asset_id, role, origin) VALUES (-1, ${asset.id}, 'coat', 'legacy')`,
                    )
                ).code,
            ).toBe(FOREIGN_KEY);
            expect(
                (
                    await violation(
                        database`INSERT INTO place_media_gallery (place_id, media_gallery_id, role, origin) VALUES (${place.id}, -1, 'header', 'legacy')`,
                    )
                ).code,
            ).toBe(FOREIGN_KEY);
            expect(
                (
                    await violation(
                        database`INSERT INTO place_media_suppression (place_id, role, origin) VALUES (-1, 'coat', 'legacy')`,
                    )
                ).code,
            ).toBe(FOREIGN_KEY);
            await database`INSERT INTO place_media (place_id, media_asset_id, role, origin) VALUES (${place.id}, ${asset.id}, 'coat', 'legacy')`;
            await database`INSERT INTO place_media_gallery (place_id, media_gallery_id, role, origin) VALUES (${place.id}, ${gallery.id}, 'header', 'legacy')`;
            // Weder das Asset noch die Galerie lassen sich unter einer Bindung löschen.
            expect((await violation(database`DELETE FROM media_asset WHERE id = ${asset.id}`)).code).toBe(FOREIGN_KEY);
            expect((await violation(database`DELETE FROM media_gallery WHERE id = ${gallery.id}`)).code).toBe(
                FOREIGN_KEY,
            );
        });
    });

    describe("Unterdrückung und Bindung schließen sich aus", () => {
        it("🔴 Ort: Unterdrückung und aktive Bindung derselben Rolle, in beiden Reihenfolgen", async () => {
            const place = await insertPlace(database, 20);
            const asset = await insertAsset(database, { ref: "sup-1", published: [] });
            const suppress = (role = "coat") =>
                database`INSERT INTO place_media_suppression (place_id, role, origin, legacy_reason) VALUES (${place.id}, ${role}, 'legacy', 'coat_none')`;
            const bind = (retired = false) =>
                database`INSERT INTO place_media (place_id, media_asset_id, role, origin, retired_at)
                         VALUES (${place.id}, ${asset.id}, 'coat', 'legacy', ${retired ? new Date("2026-10-01T00:00:00Z") : null})`;

            // Erst die Unterdrückung, dann die Bindung: die Bindung scheitert.
            await suppress();
            expect((await violation(bind())).constraint).toBe("place_media_not_suppressed");
            // Eine zurückgezogene Bindung stört nicht.
            await bind(true);
            await database`DELETE FROM place_media WHERE place_id = ${place.id}`;
            await database`DELETE FROM place_media_suppression WHERE place_id = ${place.id}`;

            // Erst die Bindung, dann die Unterdrückung: die Unterdrückung scheitert.
            await bind();
            expect((await violation(suppress())).constraint).toBe("place_media_suppression_no_binding");
            // Eine andere Rolle bleibt frei.
            await suppress("header");
        });

        it("🔴 Ort: der Wechsel in einer Transaktion geht in beliebiger Reihenfolge, nur der Endzustand zählt", async () => {
            const place = await insertPlace(database, 21);
            const asset = await insertAsset(database, { ref: "sup-2", published: [] });
            await database`INSERT INTO place_media_suppression (place_id, role, origin, legacy_reason) VALUES (${place.id}, 'coat', 'legacy', 'coat_none')`;
            // Bindung zuerst, Unterdrückung danach entfernen.
            await database.begin(async (transaction) => {
                await transaction`INSERT INTO place_media (place_id, media_asset_id, role, origin) VALUES (${place.id}, ${asset.id}, 'coat', 'legacy')`;
                await transaction`DELETE FROM place_media_suppression WHERE place_id = ${place.id} AND role = 'coat'`;
            });
            // Und zurück: Bindung zurückziehen, Unterdrückung setzen.
            await database.begin(async (transaction) => {
                await transaction`INSERT INTO place_media_suppression (place_id, role, origin, legacy_reason) VALUES (${place.id}, 'coat', 'legacy', 'coat_none')`;
                await transaction`UPDATE place_media SET retired_at = now() WHERE place_id = ${place.id}`;
            });
            // Bleiben beide aktiv, scheitert die Transaktion beim Abschluss.
            const failing = database.begin(async (transaction) => {
                await transaction`UPDATE place_media SET retired_at = NULL WHERE place_id = ${place.id}`;
            });
            expect((await violation(failing)).code).toBe(CHECK);
        });

        it("🔴 Ort: eine aktive Kopfgalerie schließt eine Unterdrückung des Kopfbilds aus", async () => {
            const place = await insertPlace(database, 22);
            const gallery = await insertGallery(database, "settlement-gallery:sup");
            await database`INSERT INTO place_media_gallery (place_id, media_gallery_id, role, origin) VALUES (${place.id}, ${gallery.id}, 'header', 'legacy')`;
            expect(
                (
                    await violation(
                        database`INSERT INTO place_media_suppression (place_id, role, origin) VALUES (${place.id}, 'header', 'editor')`,
                    )
                ).constraint,
            ).toBe("place_media_suppression_no_binding");
            await database`UPDATE place_media_gallery SET retired_at = now() WHERE place_id = ${place.id}`;
            await database`INSERT INTO place_media_suppression (place_id, role, origin) VALUES (${place.id}, 'header', 'editor')`;
            expect(
                (
                    await violation(
                        database`UPDATE place_media_gallery SET retired_at = NULL WHERE place_id = ${place.id}`,
                    )
                ).constraint,
            ).toBe("place_media_gallery_not_suppressed");
        });

        it("🔴 Gebiet: dieselbe Regel für das leere Override", async () => {
            const territory = await insertTerritory(database, 23);
            const asset = await insertAsset(database, { ref: "sup-3", published: [] });
            const suppress = () =>
                database`INSERT INTO territory_media_suppression (territory_id, role, origin, legacy_reason) VALUES (${territory.id}, 'coat', 'legacy', 'empty_override')`;
            const bind = () =>
                database`INSERT INTO territory_media (territory_id, media_asset_id, role, origin) VALUES (${territory.id}, ${asset.id}, 'coat', 'legacy')`;
            await suppress();
            expect((await violation(bind())).constraint).toBe("territory_media_not_suppressed");
            await database`DELETE FROM territory_media_suppression WHERE territory_id = ${territory.id}`;
            await bind();
            expect((await violation(suppress())).constraint).toBe("territory_media_suppression_no_binding");
            // Die Unterdrückung ist je (Gebiet, Rolle) einmalig, die Rolle und Herkunft geschlossene Listen.
            await database`UPDATE territory_media SET retired_at = now() WHERE territory_id = ${territory.id}`;
            await suppress();
            expect((await violation(suppress())).code).toBe(UNIQUE);
            expect(
                (
                    await violation(
                        database`INSERT INTO territory_media_suppression (territory_id, role, origin) VALUES (${territory.id}, 'header', 'legacy')`,
                    )
                ).constraint,
            ).toBe("territory_media_suppression_role_known");
        });
    });

    describe("Freigaberegel (Gate G1, Option A)", () => {
        const insert = (values: {
            basis: string;
            role: string;
            licenseKey?: string | null;
            creationMethod?: string | null;
            quote?: string;
            decided?: string;
            revokedOn?: string | null;
            reason?: string | null;
        }) =>
            database`
                INSERT INTO publication_rule (rights_basis, license_key, creation_method, role, scope_text, operator_quote, decided_on,
                                              revoked_on, revoked_reason)
                VALUES (${values.basis}, ${values.licenseKey ?? null}, ${values.creationMethod ?? null}, ${values.role},
                        ${`media-test Regel ${values.basis}/${values.role}`}, ${values.quote ?? "Testzitat"}, ${values.decided ?? "2026-10-04"},
                        ${values.revokedOn ?? null}, ${values.reason ?? null})
            `;

        it("kennt fünf Rechtsbasen, nie `unknown`, und die Rollen aus media.yaml", async () => {
            for (const basis of ["public_domain", "license", "permission", "fan_policy", "own_work"]) {
                await insert({ basis, role: "coat" });
            }
            expect((await violation(insert({ basis: "unknown", role: "coat" }))).constraint).toBe(
                "publication_rule_basis_known",
            );
            for (const role of ["header", "map_full", "map_preview", "literature_cover"]) {
                await insert({ basis: "fan_policy", role });
            }
            expect((await violation(insert({ basis: "fan_policy", role: "gallery" }))).constraint).toBe(
                "publication_rule_role_known",
            );
        });

        it("🔴 ohne wörtliches Zitat und Datum keine Regel; ein Lizenzschlüssel nur bei `license`", async () => {
            expect((await violation(insert({ basis: "fan_policy", role: "coat", quote: "  " }))).constraint).toBe(
                "publication_rule_quote_not_blank",
            );
            expect(
                (
                    await violation(
                        database`INSERT INTO publication_rule (rights_basis, role, scope_text, decided_on, operator_quote)
                                 VALUES ('fan_policy', 'coat', 'media-test Regel x', NULL, 'Zitat')`,
                    )
                ).code,
            ).toBe("23502");
            expect(
                (await violation(insert({ basis: "own_work", role: "coat", licenseKey: "cc0-1.0" }))).constraint,
            ).toBe("publication_rule_license_key_needs_license");
            expect(
                (await violation(insert({ basis: "license", role: "coat", licenseKey: "gibt-es-nicht" }))).code,
            ).toBe(FOREIGN_KEY);
            await insert({ basis: "license", role: "coat", licenseKey: "cc-by-4.0" });
        });

        it("🔴 eine nicht widerrufene Regel je (Basis, Lizenz, Entstehung, Rolle), auch bei leerem Lizenzschlüssel", async () => {
            await insert({ basis: "fan_policy", role: "literature_cover" });
            // NULL gilt als gleich (NULLS NOT DISTINCT): die zweite ohne Schlüssel kollidiert.
            expect((await violation(insert({ basis: "fan_policy", role: "literature_cover" }))).constraint).toBe(
                "publication_rule_one_active_per_scope",
            );
            // Die Entstehung gehört zum Schlüssel (Migration 0092): Vorgängerin und KI-Regel stehen kurz nebeneinander, zwei KI-Regeln nicht.
            await insert({ basis: "own_work", role: "header" });
            await insert({ basis: "own_work", role: "header", creationMethod: "ai_generated" });
            expect(
                (await violation(insert({ basis: "own_work", role: "header", creationMethod: "ai_generated" })))
                    .constraint,
            ).toBe("publication_rule_one_active_per_scope");
            expect(
                (await violation(insert({ basis: "own_work", role: "coat", creationMethod: "unknown" }))).constraint,
            ).toBe("publication_rule_creation_method_known");
            // Andere Rolle, andere Basis, anderer Lizenzschlüssel: frei.
            await insert({ basis: "fan_policy", role: "map_preview" });
            await insert({ basis: "permission", role: "literature_cover" });
            await insert({ basis: "license", role: "coat", licenseKey: "cc-by-4.0" });
            await insert({ basis: "license", role: "coat", licenseKey: "cc-by-sa-4.0" });
            await insert({ basis: "license", role: "coat" });
            expect(
                (await violation(insert({ basis: "license", role: "coat", licenseKey: "cc-by-4.0" }))).constraint,
            ).toBe("publication_rule_one_active_per_scope");
            // Nach dem Widerruf darf eine neue Regel an dieselbe Stelle.
            await database`UPDATE publication_rule SET revoked_on = '2026-10-05', revoked_reason = 'Test' WHERE scope_text = 'media-test Regel fan_policy/literature_cover'`;
            await insert({ basis: "fan_policy", role: "literature_cover" });
        });

        it("der Widerruf ist geordnet und trägt seinen Grund nur mit Datum", async () => {
            expect(
                (await violation(insert({ basis: "own_work", role: "coat", revokedOn: "2026-10-03" }))).constraint,
            ).toBe("publication_rule_revocation_ordered");
            expect(
                (await violation(insert({ basis: "own_work", role: "coat", reason: "ohne Datum" }))).constraint,
            ).toBe("publication_rule_reason_needs_revocation");
            await insert({ basis: "own_work", role: "coat", revokedOn: "2026-10-04", reason: "am selben Tag" });
        });
    });

    describe("Grenzen des Modells", () => {
        // adventure_media und citymap_media entstehen MIT ihren Fachtabellen (media.yaml bindings.spaeter_mit_der_fachtabelle): seit
        // Migration 0068 (Spielliteratur) und 0069 (Kartensammlung, WI-0063 P3) sind sie da, nach dem Muster von place_media.
        // media_legacy_source (Migration 0077, MEDIA-M8) trägt Legacys Angaben zu einem importierten Asset, nicht das Asset selbst.
        // WI-0068 P1 (Migration 0086) ergänzt Provenienz (media_ingest), Operation und Fachprotokoll (media_operation,
        // media_audit_event) und den Einzelbild-Notaus (media_publication_suspension); Einreichungen kommen erst mit P8.
        // Migration 0274 (WI-0272 S1) bringt die erste: media_submission, die Reisebild-Einreichung von Besuchern ohne Konto.
        // Migration 0293 (WI-0272 S3) die Verwendung der Rolle photobox: photobox_media, nach dem Muster von place_media.
        it("legt nur die Tabellen des Auftrags an: keine Fachtabellen vor ihrer Zeit, keine generische Relation, keine Sicht", async () => {
            const tables = await database<{ table_name: string }[]>`
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND (table_name LIKE '%media%' OR table_name LIKE 'license%' OR table_name = 'publication_rule')
                ORDER BY table_name
            `;
            // Sortiert wird hier, nicht in der Datenbank: ihre Sortierfolge für „_“ hängt von der Locale ab.
            expect(tables.map((row) => row.table_name).sort()).toEqual(
                [
                    "adventure_media",
                    "citymap_media",
                    "license_catalog",
                    "media_asset",
                    "media_audit_event",
                    "media_creation",
                    "media_file",
                    "media_gallery",
                    "media_gallery_item",
                    "media_ingest",
                    "media_legacy_source",
                    // Zusammenfuehren bytegleicher Werke und die Spur der umgezogenen Zeilen (WI-0068 D1, Migration 0121).
                    "media_merge",
                    "media_merge_move",
                    "media_operation",
                    "media_publication_suspension",
                    // Die Quarantäne veröffentlichter Dateien (WI-0127 SYS-10 b3, Migration 0104).
                    "media_quarantine",
                    "media_rights",
                    "media_rights_evidence",
                    // Die Reisebild-Einreichung von Besuchern ohne Konto (WI-0272 S1, Migration 0274).
                    "media_submission",
                    // Die Typbilder: je Kategorie ein ★ (WI-0068, Migration 0113).
                    "media_type_image",
                    // Die Verwendung eines freigegebenen Reisebildes in der Rolle photobox (WI-0272 S3, Migration 0293).
                    "photobox_media",
                    "place_media",
                    "place_media_gallery",
                    "place_media_suppression",
                    "publication_rule",
                    "territory_media",
                    "territory_media_suppression",
                ].sort(),
            );
            for (const forbidden of ["region_media", "entity_media", "media_binding"]) {
                expect(tables.map((row) => row.table_name)).not.toContain(forbidden);
            }
            const [views] = await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM information_schema.views WHERE table_schema = 'public' AND table_name LIKE '%media%'
            `;
            expect(views?.n).toBe(0);
            const [generic] = await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name LIKE '%media%' AND column_name IN ('entity_type', 'entity_id', 'entity_public_id', 'media_url')
            `;
            expect(generic?.n).toBe(0);
        });

        it("🔴 die Migration seedet keine Regelzeile (die Regeln entstehen mit den Importern und wörtlichem Zitat)", async () => {
            const sql = await readFile(
                fileURLToPath(new URL("../migrations/0064_media_core.sql", import.meta.url)),
                "utf8",
            );
            const code = sql.replace(/--[^\n]*/g, "");
            expect(code).not.toMatch(/INSERT\s+INTO\s+publication_rule/i);
            // Der Katalog dagegen kommt mit der Migration und ist wiederholbar.
            expect(code).toMatch(/INSERT\s+INTO\s+license_catalog[\s\S]*ON CONFLICT \(key\) DO NOTHING/i);
        });

        it("Beleg-, Prompt- und Notizspalten tragen die Kennzeichnung INTERN", async () => {
            const columns = [
                ["media_creation", "prompt"],
                ["media_creation", "negative_prompt"],
                ["media_creation", "legacy_note_raw"],
                ["media_rights", "rights_note"],
                ["media_asset", "ingest_actor_legacy"],
                ["media_rights_evidence", "storage_key"],
                ["media_rights_evidence", "external_url"],
                ["media_rights_evidence", "sha256"],
                ["media_rights_evidence", "issuer"],
                ["media_rights_evidence", "recipient"],
                ["media_rights_evidence", "description"],
                ["media_rights_evidence", "recorded_by"],
                ["media_file", "storage_key"],
                ["publication_rule", "operator_quote"],
            ] as const;
            for (const [table, column] of columns) {
                const [row] = await database<{ comment: string | null }[]>`
                    SELECT col_description((${table})::regclass, a.attnum) AS comment
                    FROM pg_attribute a WHERE a.attrelid = (${table})::regclass AND a.attname = ${column}
                `;
                expect(row?.comment ?? "", `${table}.${column}`).toContain("INTERN");
            }
            for (const table of ["media_creation", "media_rights_evidence", "media_legacy_source"]) {
                const [row] = await database<
                    { comment: string | null }[]
                >`SELECT obj_description((${table})::regclass, 'pg_class') AS comment`;
                expect(row?.comment ?? "", table).toContain("INTERN");
            }
        });
    });

    describe("Legacy-Herkunft (Migration 0077, MEDIA-M8)", () => {
        const source = async (
            ref: string,
            values: { mediaClass?: string; origin?: string | null; form?: string | null; localUrl?: string },
        ): Promise<unknown> => {
            const asset = await insertAsset(database, { ref, published: [] });
            return database`
                INSERT INTO media_legacy_source (media_asset_id, media_class, legacy_origin, legacy_form, local_url, legacy_public)
                VALUES (${asset.id}, ${values.mediaClass ?? "settlement_coat"}, ${values.origin ?? null}, ${values.form ?? null},
                        ${values.localUrl ?? "/uploads/wappen/a.png"}, TRUE)
            `;
        };

        it("eine Zeile je Asset, mit bekannter Klasse, Herkunft und Form", async () => {
            await source("src-1", {});
            expect(await violation(source("src-2", { mediaClass: "social_image" }))).toMatchObject({
                code: CHECK,
                constraint: "media_legacy_source_class_known",
            });
            expect(await violation(source("src-3", { origin: "hotlink" }))).toMatchObject({
                code: CHECK,
                constraint: "media_legacy_source_origin_known",
            });
            expect(await violation(source("src-4", { form: "array" }))).toMatchObject({
                code: CHECK,
                constraint: "media_legacy_source_form_known",
            });
            const [asset] = await database<
                { id: string }[]
            >`SELECT id FROM media_asset WHERE source_ref = 'src-1' AND source_system = ${FIXTURE_SOURCE}`;
            expect(
                await violation(
                    database`INSERT INTO media_legacy_source (media_asset_id, media_class, local_url, legacy_public) VALUES (${asset?.id ?? ""}, 'settlement_coat', '/uploads/wappen/b.png', TRUE)`,
                ),
            ).toMatchObject({ code: UNIQUE });
        });

        it("die Adresse der Datei ist Legacys eigener Speicher: keine fremde Adresse, kein Cache-Stempel, kein Rückwärtsstrich", async () => {
            const bad = [
                "https://de.wiki-aventurica.de/images/a.png",
                "/images/a.png",
                "/uploads/wappen/a.png?v=1786648684",
                "/uploads/wappen/a.png#x",
                "/uploads/",
            ];
            for (const [index, localUrl] of bad.entries()) {
                expect(await violation(source(`src-bad-${String(index)}`, { localUrl })), localUrl).toMatchObject({
                    code: CHECK,
                    constraint: "media_legacy_source_local_url_own",
                });
            }
            await source("src-gut", {
                localUrl: "/uploads/siedlungen/80558060-4299-54aa-b520-814b10819885/188bb065e91265cd.webp",
            });
        });

        it("ohne Asset keine Zeile (echter Fremdschlüssel)", async () => {
            expect(
                await violation(
                    database`INSERT INTO media_legacy_source (media_asset_id, media_class, local_url, legacy_public) VALUES (999999999, 'settlement_coat', '/uploads/a.png', TRUE)`,
                ),
            ).toMatchObject({ code: FOREIGN_KEY });
        });
    });
});
