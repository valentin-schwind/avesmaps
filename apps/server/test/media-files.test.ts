import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { MediaStorageError, MediaStore, sha256Of } from "../src/media/storage.ts";
import { resolvePlaceMedia, resolveTerritoryMedia } from "../src/media/resolver.ts";
import { DownloadStore } from "../src/migration/media-download.ts";
import { importMediaFiles, type MediaFilesReport } from "../src/migration/media-files.ts";
import { MINE, cleanLegacyMedia, fingerprint } from "./support/media-import-fixture.ts";
import { coatPng, type Workspace } from "./support/media-files-fixture.ts";
import { CASES, adventure, buildWorld, citymap, place, territory } from "./support/media-world.ts";

/**
 * Der Binärimport der Medien gegen echtes PostgreSQL und echte Dateien in einem Wegwerfordner (WI-0063 MEDIA-M9 und M10, `media.yaml`
 * → `umsetzung_m8_m10`): Prüfung, Rasterpipeline, privates Original, öffentliches Derivat nur nach der Entscheidung der Policy,
 * Zeilen `media_file`, Idempotenz, Widerruf. Alle Bilder sind selbst erzeugt (`support/media-world.ts`).
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Medienimport: Binärdateien (M9 und M10)", () => {
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

    const run = (options: { dryRun?: boolean; limit?: number } = {}): Promise<MediaFilesReport> =>
        importMediaFiles(database, { store: workspace.store, downloads: workspace.downloads, ...options });

    const stateOf = async (suffix: string) => {
        const [row] = await database<
            { state: string }[]
        >`SELECT technical_state AS state FROM media_asset WHERE source_system = 'avesmaps-legacy' AND source_ref LIKE ${`%${suffix}`}`;
        return row?.state;
    };

    it("prüft, rendert und legt ab: jedes Asset bekommt seinen Zustand, das Original privat, das Derivat nur nach der Policy", async () => {
        const report = await run();
        expect(report.assets).toBe(CASES.length);
        expect(report.ingested).toBe(CASES.filter((entry) => entry.state === "ok").length);
        expect(report.missing).toBe(1);
        expect(report.rejected).toEqual({ animated_or_multiframe: 1, svg_has_text: 1 });
        for (const entry of CASES) {
            expect(await stateOf(entry.spec.url as string), entry.name).toBe(entry.state);
        }
        const published = CASES.filter((entry) => entry.published).length;
        expect(report.published).toBe(published);
        expect(report.privateOnly).toBe(CASES.filter((entry) => entry.state === "ok" && !entry.published).length);

        const files = await database<
            {
                key: string;
                storage_class: string;
                variant: string;
                mime_type: string;
                width: number | null;
                sha256: string;
                recipe_version: string | null;
                storage_key: string;
            }[]
        >`
            SELECT a.source_ref AS key, f.storage_class, f.variant, f.mime_type, f.width, f.sha256, f.recipe_version, f.storage_key
            FROM media_file f JOIN media_asset a ON a.id = f.media_asset_id
            WHERE a.source_system = 'avesmaps-legacy'
        `;
        // Das private Original je Asset mit Datei, byte-gleich zur Datei aus dem Fach (SHA-256 aus den Bytes).
        const sources = files.filter((file) => file.storage_class === "private_source");
        expect(sources).toHaveLength(CASES.filter((entry) => entry.state === "ok").length);
        for (const source of sources) {
            expect(source.variant).toBe("source");
            expect(source.storage_key).toMatch(
                /^private\/source\/sha256\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.(webp|png|svg|jpg)$/,
            );
            expect(sha256Of(await workspace.store.read(source.storage_key, 10_000_000))).toBe(source.sha256);
        }
        // Das Derivat: WebP, relativ, mit Rezeptversion, nur für die Freigegebenen.
        const derivatives = files.filter((file) => file.storage_class === "published");
        expect(derivatives).toHaveLength(published);
        for (const derivative of derivatives) {
            expect(derivative.mime_type).toBe("image/webp");
            expect(derivative.storage_key).toMatch(/^published\/sha256\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.webp$/);
            expect(derivative.recipe_version).toMatch(/^1 \/ sharp /);
        }
        const published0 = await readdir(join(workspace.root, "published"), { recursive: true, withFileTypes: true });
        expect(published0.filter((entry) => entry.isFile())).toHaveLength(published);
        const byVariant = new Map(derivatives.map((derivative) => [derivative.key, derivative.variant]));
        expect(byVariant.get(`settlement-image:${place(1)}:/uploads/siedlungen/p1/a.webp`)).toBe("header_16_9");
        expect(byVariant.get(`citymap:${citymap(1)}:full:/uploads/kartensammlungen/m1/full.png`)).toBe("citymap_full");
        expect(byVariant.get(`adventure:${adventure(1)}:cover:/uploads/questcovers/w1.jpg`)).toBe("literature_cover");
        expect(byVariant.get(`citymap:${citymap(1)}:preview:/uploads/kartensammlungen/m1/thumb.webp`)).toBe(
            "citymap_preview",
        );
        // Ein SVG bleibt privates Quellartefakt; veröffentlicht ist nur das gerasterte WebP.
        expect(sources.some((source) => source.storage_key.endsWith(".svg"))).toBe(true);
        expect(files.some((file) => file.storage_class === "published" && file.storage_key.endsWith(".svg"))).toBe(
            false,
        );
        expect(report.findings.map((finding) => finding.code)).toEqual(
            expect.arrayContaining([
                "missing_file",
                "animated_or_multiframe",
                "svg_has_text",
                "svg_source",
                "unsupported_format",
            ]),
        );
    });

    it("die Maße der Derivate folgen dem Profil: Kopf 800 x 450, Wappen höchstens 512, Cover höchstens 600", async () => {
        await run();
        const rows = await database<{ variant: string; width: number; height: number }[]>`
            SELECT f.variant, f.width, f.height FROM media_file f
            WHERE f.storage_class = 'published' AND f.media_asset_id IN (SELECT id FROM media_asset WHERE source_system = 'avesmaps-legacy')
            ORDER BY f.variant, f.width
        `;
        for (const row of rows) {
            if (row.variant === "header_16_9") expect([row.width, row.height]).toEqual([800, 450]);
            if (row.variant === "coat") expect(Math.max(row.width, row.height)).toBeLessThanOrEqual(512);
            if (row.variant === "literature_cover") expect(Math.max(row.width, row.height)).toBeLessThanOrEqual(600);
            if (row.variant === "citymap_preview") expect(Math.max(row.width, row.height)).toBeLessThanOrEqual(400);
        }
    });

    it("der Resolver liefert Ortsbilder und Wappen, die die Policy erlaubt, in Legacys Reihenfolge, und nichts anderes", async () => {
        await run();
        const gallery = await resolvePlaceMedia(database, place(1));
        // a (ausdrücklich eingestuft, automatisch) und b (Vorgabe, durch die Klassenfreigabe), nicht c (cc_by, needs_review).
        expect(gallery.map((view) => view.role)).toEqual(["header", "header"]);
        expect(
            gallery.every((view) => /^\/media\/sha256\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.webp$/.test(view.url)),
        ).toBe(true);
        expect(gallery.every((view) => view.width === 800 && view.height === 450)).toBe(true);
        // Die Freigabe durch die Klassenregel trägt keine Nennung nach außen: ein eigenes Werk braucht keine.
        expect(gallery.every((view) => view.credit === undefined || Object.keys(view.credit).length === 0)).toBe(true);
        expect(JSON.stringify(gallery)).not.toMatch(/private|source|storage|prompt|thomas/i);
        expect((await resolvePlaceMedia(database, place(2))).map((view) => view.role)).toEqual(["coat"]);
        expect((await resolveTerritoryMedia(database, territory(1))).map((view) => view.role)).toEqual(["coat"]);
        // Abgewiesen oder nicht freigegeben: nichts.
        expect(await resolveTerritoryMedia(database, territory(2))).toEqual([]);
        expect(await resolveTerritoryMedia(database, territory(3))).toEqual([]);
    });

    /** Anzahl der eigenen Dateizeilen (nie die der anderen Medientests in derselben Testdatenbank). */
    const fileCount = async (where: string): Promise<number> => {
        const [row] = await database.unsafe<{ n: number }[]>(
            `SELECT count(*)::int AS n FROM media_file WHERE media_asset_id IN ${MINE.assets} AND ${where}`,
        );
        return row?.n ?? 0;
    };
    /** Technisch gute Bilder, die nicht GENAU eine Fassung haben: öffentlich oder die private Vorschau (WI-0068 P4b). */
    const ohneEineFassung = async (): Promise<number> => {
        const [row] = await database.unsafe<{ n: number }[]>(
            `SELECT count(*)::int AS n FROM media_asset a
              WHERE a.id IN ${MINE.assets} AND a.technical_state = 'ok'
                AND (SELECT count(*) FROM media_file f
                      WHERE f.media_asset_id = a.id AND f.storage_class IN ('published', 'derivative')) <> 1`,
        );
        return row?.n ?? 0;
    };

    /** Eine der drei eigenen Regeln widerrufen oder wieder gelten lassen. */
    const setRule = (basis: string, role: string, revoked: boolean) =>
        database.unsafe(
            `UPDATE publication_rule SET revoked_on = ${revoked ? "decided_on" : "NULL"}, revoked_reason = ${revoked ? "'Test'" : "NULL"}
             WHERE rights_basis = '${basis}' AND role = '${role}' AND id IN ${MINE.rules}`,
        );

    it("der zweite Lauf liest nichts, rechnet nichts und schreibt nichts", async () => {
        await run();
        // T2b: Jedes Wappen des Bestands trägt nach dem Lauf die Messung seiner Ecken; andere Originale nicht.
        expect(
            await fileCount(
                `storage_class = 'private_source' AND corners_transparent IS NULL
                 AND media_asset_id IN (SELECT id FROM media_asset WHERE asset_type = 'coat' AND technical_state = 'ok')`,
            ),
        ).toBe(0);
        expect(
            await fileCount(
                `storage_class = 'private_source' AND corners_transparent IS NOT NULL
                 AND media_asset_id IN (SELECT id FROM media_asset WHERE asset_type <> 'coat')`,
            ),
        ).toBe(0);
        const before = await fingerprint(database, ["media_file", "media_asset", "media_legacy_source"]);
        const second = await run();
        expect(second.ingested).toBe(0);
        expect(second.filesWritten).toBe(0);
        expect(second.filesDeduplicated).toBe(0);
        expect(second.unchanged).toBe(CASES.filter((entry) => entry.state === "ok").length);
        expect(second.changed).toBe(false);
        expect(await fingerprint(database, ["media_file", "media_asset", "media_legacy_source"])).toBe(before);
        // Abgewiesene und fehlende werden erneut geprüft (billig), aber nichts wird geschrieben.
        expect(second.missing).toBe(1);
        expect(second.rejected).toEqual({ animated_or_multiframe: 1, svg_has_text: 1 });
    });

    it("ein Probelauf schreibt weder Zeilen noch Dateien in die Medienwurzel", async () => {
        const dry = new MediaStore(join(workspace.root, "..", "dry-run"));
        const report = await importMediaFiles(database, { store: dry, downloads: workspace.downloads, dryRun: true });
        expect(report.dryRun).toBe(true);
        expect(report.ingested).toBeGreaterThan(0);
        expect(await fileCount("TRUE")).toBe(0);
        expect(await stateOf("/uploads/siedlungen/p1/a.webp")).toBe("pending");
        await expect(readdir(workspace.root)).resolves.toEqual([]);
    });

    it("nur freigegebene Dateien liegen unter published/: ein Widerruf der Regel nimmt sie beim nächsten Lauf wieder weg, das Original bleibt", async () => {
        const first = await run();
        expect(first.published).toBeGreaterThan(0);
        expect(await ohneEineFassung()).toBe(0);
        expect(await resolvePlaceMedia(database, place(1))).toHaveLength(2);
        expect(await fileCount("storage_class = 'published' AND variant = 'literature_cover'")).toBe(1);

        await setRule("fan_policy", "literature_cover", true);
        await setRule("own_work", "header", true);
        const second = await run();
        expect(second.unpublished).toBe(3);
        expect(second.changed).toBe(true);
        // Das Cover und beide Ortsbilder sind weg: Seit dem Betreiber 2026-10-11 („13: B!“) trägt auch das ausdrücklich als KI eingestufte
        // Ortsbild nur die (KI-)Regel, Legacys Angabe „eigenes Werk“ allein reicht nicht mehr.
        expect(await fileCount("storage_class = 'published' AND variant = 'literature_cover'")).toBe(0);
        expect(await fileCount("storage_class = 'published' AND variant = 'header_16_9'")).toBe(0);
        // An ihrer Stelle die private Vorschau (WI-0068 P4b): Jedes technisch gute Bild hat genau eine Fassung, öffentlich ODER privat.
        expect(await ohneEineFassung()).toBe(0);
        expect(await fileCount("storage_class = 'derivative' AND variant = 'intern_literature_cover'")).toBeGreaterThan(
            0,
        );
        expect(await fileCount("storage_class = 'derivative' AND variant NOT LIKE 'intern\\_%'")).toBe(0);
        const stored = await readdir(join(workspace.root, "published"), { recursive: true, withFileTypes: true });
        expect(stored.filter((entry) => entry.isFile())).toHaveLength(first.published - 3);
        expect((await resolvePlaceMedia(database, place(1))).length).toBe(0);
        // Die privaten Originale bleiben (authoritative Klasse).
        expect(await fileCount("storage_class = 'private_source'")).toBe(
            CASES.filter((entry) => entry.state === "ok").length,
        );
        // Wieder freigegeben: ein neuer Lauf legt das Derivat aus dem Original neu an (kein Abruf nötig, das Fach bleibt leer).
        await setRule("fan_policy", "literature_cover", false);
        const third = await importMediaFiles(database, {
            store: workspace.store,
            downloads: await DownloadStore.open(join(workspace.root, "..", "leer")),
        });
        expect(third.ingested).toBe(1);
        // Früher abgewiesene Dateien ohne Quelle werden nicht als „fehlt“ neu beurteilt.
        expect(third.notRechecked).toBe(2);
        expect(third.stateChanged).toBe(0);
        expect(await fileCount("storage_class = 'published' AND variant = 'literature_cover'")).toBe(1);
        expect(await ohneEineFassung()).toBe(0);
    });

    it("eine Einzelfreigabe (approved mit Zitat) veröffentlicht, eine Einzelsperre (blocked) schlägt jede Regel", async () => {
        await run();
        expect((await resolveTerritoryMedia(database, territory(3))).length).toBe(0);
        // Die Einzelsperre am ausdrücklich eingestuften Ortsbild, dann die Einzelfreigabe am cc_by-Bild.
        await database`
            UPDATE media_gallery_item SET publication_override = 'blocked'
            WHERE media_asset_id = (SELECT id FROM media_asset WHERE source_ref LIKE '%/p1/a.webp')
        `;
        const blocked = await run();
        expect(blocked.unpublished).toBe(1);
        expect((await resolvePlaceMedia(database, place(1))).length).toBe(1);
        await database`
            UPDATE media_gallery_item SET publication_override = 'approved', override_decided_on = '2026-10-05', override_operator_quote = 'Test'
            WHERE media_asset_id = (SELECT id FROM media_asset WHERE source_ref LIKE '%/p1/c.webp')
        `;
        const approved = await run();
        expect(approved.published).toBeGreaterThanOrEqual(1);
        const gallery = await resolvePlaceMedia(database, place(1));
        // b (Vorgabe, Klassenregel) und c (cc_by, Einzelfreigabe), a ist gesperrt; c trägt die Nennung, weil sie bewusst freigegeben ist.
        expect(gallery.length).toBe(2);
    });

    it("ändert Legacy die Datei unter derselben Adresse, ersetzt der Import Original und Derivat; das alte Derivat verschwindet", async () => {
        await run();
        const [old] = await database<{ sha: string; key: string }[]>`
            SELECT f.sha256 AS sha, f.storage_key AS key FROM media_file f JOIN media_asset a ON a.id = f.media_asset_id
            WHERE a.source_ref LIKE '%/uploads/wappen/wiki/p2.png' AND f.storage_class = 'published'
        `;
        await workspace.put("/uploads/wappen/wiki/p2.png", await coatPng(44), "png", { etag: '"neu"' });
        await workspace.reopen("zweiter-zug");
        const second = await run();
        expect(second.ingested).toBe(1);
        const [fresh] = await database<{ sha: string; key: string }[]>`
            SELECT f.sha256 AS sha, f.storage_key AS key FROM media_file f JOIN media_asset a ON a.id = f.media_asset_id
            WHERE a.source_ref LIKE '%/uploads/wappen/wiki/p2.png' AND f.storage_class = 'published'
        `;
        expect(fresh?.sha).not.toBe(old?.sha);
        await expect(workspace.store.exists(old?.key as string)).resolves.toBe(false);
        await expect(workspace.store.exists(fresh?.key as string)).resolves.toBe(true);
        const [source] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM media_file f JOIN media_asset a ON a.id = f.media_asset_id
            WHERE a.source_ref LIKE '%/uploads/wappen/wiki/p2.png' AND f.storage_class = 'private_source'
        `;
        expect(source?.n).toBe(1);
        const [etag] = await database<{ etag: string | null }[]>`
            SELECT s.file_etag AS etag FROM media_legacy_source s JOIN media_asset a ON a.id = s.media_asset_id WHERE a.source_ref LIKE '%/uploads/wappen/wiki/p2.png'
        `;
        expect(etag?.etag).toBe('"neu"');
    });

    it("gleiche Bytes unter zwei Assets: zwei Assets, eine physische Datei (Information, kein Fehler)", async () => {
        const bytes = await coatPng(77);
        await workspace.put("/uploads/wappen/wiki/p2.png", bytes, "png");
        await workspace.put("/uploads/wappen/t1-custom.png", bytes, "png");
        await workspace.reopen("gleich");
        const report = await run();
        expect(report.filesDeduplicated).toBeGreaterThan(0);
        const duplicate = report.findings.find((finding) => finding.code === "duplicate_bytes_distinct_assets");
        expect(duplicate?.numbers).toMatchObject({ dateien: 1, assets: 2 });
        const [sameFile] = await database<{ n: number; files: number }[]>`
            SELECT count(*)::int AS n, count(DISTINCT storage_key)::int AS files FROM media_file WHERE sha256 = ${sha256Of(bytes)} AND storage_class = 'private_source' AND media_asset_id IN (SELECT id FROM media_asset WHERE source_system = 'avesmaps-legacy')
        `;
        expect(sameFile).toEqual({ n: 2, files: 1 });
    });

    it("eine Datei, die nicht zur SHA-256 der Liste passt, wird nicht verwendet (beschädigt) und gemeldet", async () => {
        const entry = workspace.downloads.entryFor("/uploads/wappen/wiki/p2.png");
        await writeFile(join(workspace.downloadDir, entry?.stored as string), Buffer.from("beschädigt"));
        const report = await run();
        expect(report.hashMismatch).toBe(1);
        expect(report.findings.map((finding) => finding.code)).toContain("source_hash_mismatch");
        // Ohne brauchbare Datei und ohne früheres Original ist es eine fehlende Datei, nie ein geratenes Bild.
        expect(await stateOf("/uploads/wappen/wiki/p2.png")).toBe("missing_file");
    });

    it("eine Datei über der Bytegrenze des Betreibers (D2) wird abgewiesen, ohne gelesen zu werden", async () => {
        const big = Buffer.alloc(6 * 1024 * 1024 + 1, 7);
        await workspace.put("/uploads/wappen/t1-custom.png", big, "png");
        await workspace.reopen("gross");
        const report = await run();
        expect(report.rejected["too_large_bytes"]).toBe(1);
        expect(await stateOf("/uploads/wappen/t1-custom.png")).toBe("unsupported_format");
        expect(report.findings.map((finding) => finding.code)).toContain("too_large_bytes");
    });

    it("liegt das Original schon im Speicher, rechnet ein neuer Lauf daraus (Rezept oder Freigabe geändert), ohne das Download-Fach", async () => {
        await run();
        // Der Stand eines Servers ohne Download-Fach: nur die Medienwurzel und die Datenbank.
        await database.unsafe(
            `UPDATE media_file SET recipe_version = '0 / alt' WHERE storage_class = 'published' AND variant = 'coat' AND media_asset_id IN ${MINE.assets}`,
        );
        const empty = await DownloadStore.open(join(workspace.root, "..", "kein-fach"));
        const second = await importMediaFiles(database, { store: workspace.store, downloads: empty });
        // Die drei Wappen (Ortswappen als PNG und SVG, Gebietswappen) werden aus ihrem privaten Original neu gerendert.
        expect(second.ingested).toBe(3);
        expect(await fileCount("recipe_version = '0 / alt'")).toBe(0);
        // Das Original ist byte-gleich geblieben.
        const [source] = await database<{ key: string; sha: string }[]>`
            SELECT f.storage_key AS key, f.sha256 AS sha FROM media_file f JOIN media_asset a ON a.id = f.media_asset_id
            WHERE a.source_ref LIKE '%/uploads/wappen/wiki/p2.png' AND f.storage_class = 'private_source'
        `;
        expect(sha256Of(await readFile(workspace.store.pathFor(source?.key as string)))).toBe(source?.sha);
    });

    it("MediaStore.remove entfernt nur reproduzierbare Klassen und bleibt unter der Wurzel", async () => {
        await run();
        await expect(workspace.store.remove("private/source/sha256/aa/bb/x.png")).rejects.toBeInstanceOf(
            MediaStorageError,
        );
        await expect(workspace.store.remove("master/x.png")).rejects.toBeInstanceOf(MediaStorageError);
        await expect(workspace.store.remove("published/../private/source/x.png")).rejects.toBeInstanceOf(
            MediaStorageError,
        );
        await expect(workspace.store.remove("published/sha256/00/00/" + "0".repeat(64) + ".webp")).resolves.toBe(false);
    });
});
