import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import type { MediaPublicView } from "@avesmaps3d/shared";
import { resolvePlaceMedia, resolveTerritoryMedia } from "../src/media/resolver.ts";
import { publishedWebpHash } from "../src/media/storage.ts";
import { importMediaFiles } from "../src/migration/media-files.ts";
import { mediaTotals, verifyMedia, type MediaParityReport, type Resolvers } from "../src/migration/verify-media.ts";
import { MINE, cleanLegacyMedia, manifestOf } from "./support/media-import-fixture.ts";
import type { Workspace } from "./support/media-files-fixture.ts";
import { buildWorld, place, territory, worldSpecs } from "./support/media-world.ts";

/**
 * Der Prüfer `verify:media` (WI-0063 MEDIA-M8 bis M10, `media.yaml` → `verifier`): Parität Manifest <-> Tafeln <-> Dateien. Positiv an
 * einem sauberen Import, negativ an je einer gezielten Beschädigung, die genau die zuständige Prüfung treffen muss.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("verify:media", () => {
    let database: Database;
    let workspace: Workspace;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await cleanLegacyMedia(database);
    }, 120_000);

    afterAll(async () => {
        await cleanLegacyMedia(database);
        await database.end({ timeout: 5 });
    });

    beforeEach(async () => {
        workspace = await buildWorld(database);
    });

    afterEach(async () => {
        await workspace.dispose();
    });

    const manifest = () => manifestOf(worldSpecs(), "private");
    const verify = (options: { hash?: boolean } = {}): Promise<MediaParityReport> =>
        verifyMedia(database, manifest(), { store: workspace.store, ...options });
    const failed = (report: MediaParityReport): string[] =>
        report.checks.filter((entry) => !entry.passed).map((entry) => entry.name);
    const imported = async (): Promise<void> => {
        await importMediaFiles(database, { store: workspace.store, downloads: workspace.downloads });
    };
    const keyOf = async (suffix: string, storageClass: string): Promise<string> => {
        const [row] = await database.unsafe<{ key: string }[]>(
            `SELECT f.storage_key AS key FROM media_file f JOIN media_asset a ON a.id = f.media_asset_id
             WHERE a.source_system = 'avesmaps-legacy' AND a.source_ref LIKE '%${suffix}' AND f.storage_class = '${storageClass}'`,
        );
        if (row === undefined) throw new Error(`keine ${storageClass}-Datei für ${suffix}`);
        return row.key;
    };

    it("ein sauberer Import besteht jede Prüfung: Manifest, Tafeln, Dateien, Policy und Resolver stimmen überein", async () => {
        await imported();
        const report = await verify();
        expect(failed(report), JSON.stringify(report.checks.filter((entry) => !entry.passed))).toEqual([]);
        expect(report.passed).toBe(true);
        expect(report.manifestSkipped).toBe(false);
        const names = report.checks.map((entry) => entry.name);
        expect(names).toEqual(
            expect.arrayContaining([
                "counts",
                "assets_present",
                "rights",
                "degraded_original",
                "stamps",
                "bindings",
                "galleries",
                "suppressions",
                "structure",
                "orphans",
                "header_or_gallery",
                "rights_consistent",
                "rules",
                "published_decision",
                "public_surface",
                "files",
                "disk_parity",
                "published_unreferenced",
                "resolver_parity",
                "no_leak",
            ]),
        );
        // Nichts davon hält an: die Liste der blockierenden Prüfungen ist leer, jede Prüfung meldet nur.
        expect(report.checks.every((entry) => entry.blocking === false)).toBe(true);
    });

    it("die Bilanz nennt je Klasse, was öffentlich, privat und abgewiesen ist, mit dem Grund", async () => {
        await imported();
        const { summary } = await verify();
        expect(summary.settlement_image).toMatchObject({ assets: 4, public: 2, private: 1, rejected: 1, pending: 0 });
        expect(summary.settlement_image.reasons).toEqual({ clearance_pending: 1, missing_file: 1 });
        expect(summary.settlement_coat).toMatchObject({ assets: 2, public: 2, rejected: 0 });
        expect(summary.territory_coat).toMatchObject({ assets: 3, public: 1, rejected: 2 });
        expect(summary.territory_coat.reasons).toEqual({ unsupported_format: 2 });
        expect(summary.citymap_full).toMatchObject({ assets: 1, public: 1 });
        expect(summary.citymap_preview).toMatchObject({ assets: 1, public: 1 });
        expect(summary.literature_cover).toMatchObject({ assets: 2, public: 1, private: 1 });
        expect(summary.literature_cover.reasons).toEqual({ rights_unknown: 1 });
        const totals = mediaTotals(summary);
        expect(totals).toMatchObject({ assets: 13, public: 8, private: 2, rejected: 3, pending: 0 });
    });

    it("vor dem Binärimport stehen die Assets auf pending: die Prüfung nennt es und scheitert nicht daran", async () => {
        const report = await verify();
        expect(failed(report)).toEqual([]);
        expect(report.checks.find((entry) => entry.name === "files")?.detail).toContain("13 noch pending");
        expect(mediaTotals(report.summary).pending).toBe(13);
    });

    it("ohne Manifest läuft nur, was kein Manifest braucht; ein unbrauchbares Manifest ist ein Befund", async () => {
        await imported();
        const without = await verifyMedia(database, undefined, { store: workspace.store });
        expect(without.checks.map((entry) => entry.name)).not.toContain("counts");
        expect(without.checks.map((entry) => entry.name)).toContain("rights_consistent");
        const broken = await verifyMedia(database, { ok: false }, { store: workspace.store });
        expect(broken.manifestSkipped).toBe(true);
        expect(broken.findings.map((finding) => finding.code)).toContain("source_block_missing");
        expect(failed(broken)).toEqual([]);
    });

    describe("die Prüfung der öffentlichen Antworten ist nicht leer (ein Doppelgänger des Resolvers liefert absichtlich zu viel)", () => {
        beforeEach(imported);

        const withResolvers = (
            tamper: (views: MediaPublicView[], kind: "place" | "territory", id: string) => MediaPublicView[],
        ): Resolvers => ({
            place: async (db, id) => tamper(await resolvePlaceMedia(db, id), "place", id),
            territory: async (db, id) => tamper(await resolveTerritoryMedia(db, id), "territory", id),
        });
        const run = (resolvers: Resolvers) => verifyMedia(database, manifest(), { store: workspace.store, resolvers });

        it("ein Feld mit dem Login oder dem Speicherpfad in der Antwort: no_leak", async () => {
            const report = await run(
                withResolvers((views) =>
                    views.map(
                        (view) =>
                            ({
                                ...view,
                                uploaded_by: "thomas",
                                storage_key: "private/source/x.png",
                            }) as MediaPublicView,
                    ),
                ),
            );
            expect(failed(report)).toContain("no_leak");
        });

        it("der geheime Prompt in der Nennung: no_leak", async () => {
            const report = await run(
                withResolvers((views) =>
                    views.map((view) => ({ ...view, credit: { creator: "Prompt: Hafen bei Nacht, geheim" } })),
                ),
            );
            expect(failed(report)).toContain("no_leak");
        });

        it("ein Bild, das die Policy nicht erlaubt (cc_by), in der Antwort: resolver_parity", async () => {
            const [asset] = await database.unsafe<{ id: string }[]>(
                `SELECT public_id::text AS id FROM media_asset WHERE source_system = 'avesmaps-legacy' AND source_ref LIKE '%/p1/c.webp'`,
            );
            const report = await run(
                withResolvers((views, kind, id) =>
                    kind === "place" && id === place(1)
                        ? [
                              ...views,
                              {
                                  id: asset?.id ?? "",
                                  role: "header",
                                  url: `/media/sha256/aa/bb/${"c".repeat(64)}.webp`,
                                  width: 800,
                                  height: 450,
                                  mimeType: "image/webp",
                              },
                          ]
                        : views,
                ),
            );
            expect(failed(report)).toContain("resolver_parity");
        });

        it("ein erlaubtes Bild, das der Resolver verschweigt: resolver_parity", async () => {
            const report = await run(withResolvers((views, kind) => (kind === "territory" ? [] : views)));
            expect(failed(report)).toContain("resolver_parity");
        });

        it("der echte Resolver besteht beides", async () => {
            expect(failed(await verify())).toEqual([]);
        });
    });

    describe("trifft die zuständige Prüfung", () => {
        beforeEach(imported);

        it("eine fehlende veröffentlichte Datei: disk_parity", async () => {
            await rm(workspace.store.pathFor(await keyOf("/p1/a.webp", "published")));
            expect(failed(await verify())).toEqual(["disk_parity"]);
        });

        it("ein beschädigtes privates Original: disk_parity (SHA-256), ohne Hash nur die Größe", async () => {
            const path = workspace.store.pathFor(await keyOf("/uploads/wappen/t1-custom.png", "private_source"));
            await writeFile(
                path,
                Buffer.from("beschädigt, aber ganz anders groß als vorher, damit auch die Größe abweicht".repeat(50)),
            );
            expect(failed(await verify())).toEqual(["disk_parity"]);
            await writeFile(path, Buffer.from("x"));
            expect(failed(await verify({ hash: false }))).toEqual(["disk_parity"]);
        });

        it("🔴 private/kanal/ gehört dem Betreiber-Kanal: keine Prüfung meldet dort etwas, nichts wird dort gelöscht (KANAL-0001 M3)", async () => {
            await imported();
            const stored = await workspace.store.storeChannel(
                "6b616e61-6c00-4000-9000-0000000000aa",
                "original",
                Buffer.from("foto"),
                "png",
            );
            const report = await verify();
            expect(failed(report)).toEqual([]);
            expect(JSON.stringify(report)).not.toContain("kanal");
            expect(await workspace.store.exists(stored.key)).toBe(true);
        });

        it("eine Datei unter published/ ohne Zeile: published_unreferenced", async () => {
            const stray = join(workspace.root, "published", "sha256", "ab", "cd", `${"a".repeat(64)}.webp`);
            await mkdir(dirname(stray), { recursive: true });
            await writeFile(stray, Buffer.from("fremd"));
            expect(failed(await verify())).toEqual(["published_unreferenced"]);
        });

        it("eine Instagram-Fassung neben ihrer WebP ist erlaubt; ohne WebP (Quarantäne, Löschen) ist sie eine Waise: published_unreferenced", async () => {
            const webp = await keyOf("/p1/a.webp", "published");
            const sha256 = publishedWebpHash(webp) ?? "";
            expect(await workspace.store.exists(webp)).toBe(true);
            await workspace.store.storeInstagram(sha256, Buffer.from("ÿØÿ Fassung"));
            // Neben ihrer WebP, die eine Zeile hält: kein Befund (die Fassung hat bewusst keine Zeile).
            expect(failed(await verify())).toEqual([]);
            // Die WebP geht aus der Auslieferung, die Fassung bleibt liegen (hier von Hand ersetzt, denn der Speicher nimmt sie sonst mit): Waise.
            await rm(workspace.store.pathFor(webp));
            const report = await verify();
            expect(failed(report)).toContain("published_unreferenced");
            const befund = report.checks.find((c) => c.name === "published_unreferenced");
            expect(JSON.stringify(befund)).toContain(".ig.jpg");
        });

        it("eine veröffentlichte Datei, die die Policy nicht mehr trägt (Rechte ungeklärt): published_decision", async () => {
            await database.unsafe(
                `UPDATE media_rights SET rights_basis = 'unknown', clearance_state = 'unreviewed', license_key = NULL
                 WHERE media_asset_id = (SELECT id FROM media_asset WHERE source_system = 'avesmaps-legacy' AND source_ref LIKE '%/uploads/wappen/t1-custom.png')`,
            );
            const names = failed(await verify());
            expect(names).toContain("published_decision");
            // Auch das Manifest sagt anderes als die Tafel.
            expect(names).toContain("rights");
        });

        it("ein geratener Lizenzschlüssel an cc_by: rights und rights_consistent", async () => {
            await database.unsafe(
                `UPDATE media_rights SET license_key = 'cc-by-4.0'
                 WHERE media_asset_id = (SELECT id FROM media_asset WHERE source_system = 'avesmaps-legacy' AND source_ref LIKE '%/p1/c.webp')`,
            );
            const names = failed(await verify());
            expect(names).toEqual(expect.arrayContaining(["rights", "rights_consistent"]));
        });

        it("eine fehlende Bindung und eine vertauschte Galerie: bindings und galleries", async () => {
            await database.unsafe(`DELETE FROM place_media WHERE place_id IN ${MINE.places}`);
            await database.unsafe(
                `UPDATE media_gallery_item SET sort_order = 7 WHERE sort_order = 0 AND gallery_id IN ${MINE.galleries}`,
            );
            const names = failed(await verify());
            expect(names).toEqual(expect.arrayContaining(["bindings", "galleries"]));
        });

        it("eine fehlende Unterdrückung: suppressions", async () => {
            const specs = [
                ...worldSpecs(),
                { cls: "settlement_coat" as const, subject: place(1), url: null, suppressed: true, public: false },
            ];
            const report = await verifyMedia(database, manifestOf(specs, "private"), { store: workspace.store });
            expect(failed(report)).toContain("suppressions");
        });

        it("ein Asset ohne Nutzung: orphans", async () => {
            await database.unsafe(`DELETE FROM media_gallery_item WHERE gallery_id IN ${MINE.galleries}`);
            const names = failed(await verify());
            expect(names).toContain("orphans");
        });

        it("ein ok-Asset ohne Original und ein abgewiesenes mit öffentlicher Datei: files", async () => {
            await database.unsafe(
                `DELETE FROM media_file WHERE storage_class = 'private_source'
                 AND media_asset_id = (SELECT id FROM media_asset WHERE source_system = 'avesmaps-legacy' AND source_ref LIKE '%/p1/b.webp')`,
            );
            expect(failed(await verify())).toEqual(expect.arrayContaining(["files"]));
        });

        it("das Manifest nennt ein Medium mehr, als die Tafel führt: counts und assets_present", async () => {
            const specs = [
                ...worldSpecs(),
                {
                    cls: "settlement_coat" as const,
                    subject: place(1),
                    url: "/uploads/wappen/neu.png",
                    code: "public_domain",
                },
            ];
            const report = await verifyMedia(database, manifestOf(specs, "private"), { store: workspace.store });
            expect(failed(report)).toEqual(expect.arrayContaining(["counts", "assets_present"]));
        });

        it("das öffentliche Manifest A verlangt nur, dass seine Einträge da sind; B dagegen die genaue Zahl", async () => {
            const publicSpecs = worldSpecs().filter((spec) => spec.public !== false);
            const report = await verifyMedia(database, manifestOf(publicSpecs, "public"), { store: workspace.store });
            expect(failed(report), JSON.stringify(report.checks.filter((entry) => !entry.passed))).toEqual([]);
            const stripped = worldSpecs().filter((spec) => spec.subject !== territory(1));
            const exact = await verifyMedia(database, manifestOf(stripped, "private"), { store: workspace.store });
            expect(failed(exact)).toContain("counts");
        });
    });
});
