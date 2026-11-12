import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import {
    oeffentlicheVerwendungen,
    zahlenJeSchalter,
    zieheQuarantaeneNach,
    zielInhaltsschalter,
    type OeffentlicheVerwendung,
} from "../src/media/quarantine.ts";
import { resolveLiteratureCovers } from "../src/media/resolver.ts";
import { MediaStore, quarantineKey, storageKey } from "../src/media/storage.ts";
import { importMediaFiles } from "../src/migration/media-files.ts";
import { leseInhaltsstand, schalteUm } from "../src/system/inhaltsschalter.ts";
import { cleanLegacyMedia } from "./support/media-import-fixture.ts";
import type { Workspace } from "./support/media-files-fixture.ts";
import { adventure, buildWorld } from "./support/media-world.ts";

/**
 * Die Quarantäne der Inhaltsschalter (WI-0127 SYS-10 b3, Migration 0104; Vertrag WI-0127 §19.6): Ein Bilder-Schalter nimmt die Dateien
 * aus der Auslieferung (`published/` → `private/quarantine/`), der Binärimport legt sie nicht zurück (Schutzregel), „an“ bringt sie
 * zurück. Gegen echtes PostgreSQL und echte Dateien in einem Wegwerfordner (die Welt aus `support/media-world.ts`).
 */

const verwendung = (
    assetId: string,
    sha256: string,
    keys: string[],
    mitSchaltern: boolean,
): OeffentlicheVerwendung => ({
    assetId,
    sha256,
    keys,
    mitSchaltern,
});

describe("Quarantäne: Ziel und Zahlen (rein)", () => {
    it("🔴 eine Datei wandert nur, wenn KEINE Verwendung ihrer Bytes öffentlich bleibt", () => {
        const a = "a".repeat(64);
        const b = "b".repeat(64);
        const ziel = zielInhaltsschalter([
            verwendung("1", a, ["media.role.coat"], false),
            verwendung("2", a, ["media.role.header"], true),
            verwendung("3", b, ["media.role.coat"], false),
        ]);
        expect([...ziel]).toEqual([b]);
    });

    it("je Schalter: sichtbare und zurückgehaltene Bilder (Assets, nicht Verwendungen)", () => {
        const zahlen = zahlenJeSchalter([
            verwendung("1", "a".repeat(64), ["media.role.coat", "media.rights.own_work"], true),
            verwendung("1", "a".repeat(64), ["media.role.coat", "media.rights.own_work"], true),
            verwendung("2", "b".repeat(64), ["media.role.coat", "media.rights.permission"], false),
        ]);
        expect(zahlen.get("media.role.coat")).toEqual({ sichtbar: 1, ausgeblendet: 1 });
        expect(zahlen.get("media.rights.own_work")).toEqual({ sichtbar: 1, ausgeblendet: 0 });
        expect(zahlen.get("media.rights.permission")).toEqual({ sichtbar: 0, ausgeblendet: 1 });
    });
});

describe("Quarantäne: Umzug in der Medienablage", () => {
    let root: string;
    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "avm-quarantaene-"));
    });
    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it("published/ → private/quarantine/ und zurück, wiederholbar; ohne Datei „missing“", async () => {
        const store = new MediaStore(root);
        const stored = await store.store("published", Buffer.from("RIFF0000WEBPVP8 quarantaene"), "webp");
        expect(await store.moveToQuarantine(stored.sha256)).toBe("moved");
        expect(await store.exists(stored.key)).toBe(false);
        expect(await store.exists(quarantineKey(stored.sha256))).toBe(true);
        expect(quarantineKey(stored.sha256)).toMatch(
            /^private\/quarantine\/sha256\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.webp$/u,
        );
        expect(await store.moveToQuarantine(stored.sha256)).toBe("already");
        expect(await store.restoreFromQuarantine(stored.sha256)).toBe("moved");
        expect(await store.exists(stored.key)).toBe(true);
        expect(await store.restoreFromQuarantine(stored.sha256)).toBe("already");
        expect(await store.moveToQuarantine("c".repeat(64))).toBe("missing");
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Quarantäne der Inhaltsschalter gegen die Datenbank", () => {
    let database: Database;
    let workspace: Workspace;

    const reset = async (): Promise<void> => {
        await database`DELETE FROM content_switch`;
        await database`DELETE FROM media_quarantine`;
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await cleanLegacyMedia(database);
        await reset();
    }, 120_000);

    afterAll(async () => {
        await cleanLegacyMedia(database);
        await reset();
        await database.end({ timeout: 5 });
    });

    beforeEach(async () => {
        await reset();
        workspace = await buildWorld(database);
    });

    afterEach(async () => {
        await workspace.dispose();
        await reset();
    });

    const coverSha = async (): Promise<string> => {
        const [row] = await database<{ sha256: string }[]>`
            SELECT f.sha256 FROM media_file f JOIN media_asset a ON a.id = f.media_asset_id
             WHERE a.source_system = 'avesmaps-legacy' AND f.storage_class = 'published' AND f.variant = 'literature_cover'
        `;
        return row!.sha256;
    };

    it("🔴 „Buchumschläge“ aus: die Datei geht in Quarantäne, der Binärimport lässt sie dort, „an“ bringt sie zurück", async () => {
        const store = workspace.store;
        const first = await importMediaFiles(database, { store, downloads: workspace.downloads });
        expect(first.quarantine).toBeUndefined();
        const sha = await coverSha();
        const published = storageKey("published", sha, "webp");
        expect(await store.exists(published)).toBe(true);
        expect((await resolveLiteratureCovers(database, [adventure(1)])).size).toBe(1);

        await database`INSERT INTO content_switch (key, enabled) VALUES ('media.role.literature_cover', FALSE)`;
        expect(await zieheQuarantaeneNach(database, store)).toMatchObject({
            added: 1,
            moved: 1,
            active: 1,
            missing: 0,
        });
        expect(await store.exists(published)).toBe(false);
        expect(await store.exists(quarantineKey(sha))).toBe(true);
        expect((await resolveLiteratureCovers(database, [adventure(1)])).size).toBe(0);
        const [zeile] = await database<{ reason_kind: string; detail: string | null }[]>`
            SELECT reason_kind, detail FROM media_quarantine WHERE sha256 = ${sha} AND restored_at IS NULL
        `;
        expect(zeile).toEqual({ reason_kind: "content_switch", detail: "media.role.literature_cover" });
        // Die Zahl im Eintrag: ein Umschlag zurückgehalten, keiner sichtbar.
        const zahlen = zahlenJeSchalter(await oeffentlicheVerwendungen(database, await leseInhaltsstand(database)));
        expect(zahlen.get("media.role.literature_cover")).toEqual({ sichtbar: 0, ausgeblendet: 1 });

        // Schutzregel: Der nächste Binärimport legt die Datei weder zurück noch neu an.
        const again = await importMediaFiles(database, { store, downloads: workspace.downloads });
        expect(again.findings.map((finding) => finding.code)).toContain("quarantine_held");
        expect(again.quarantine).toMatchObject({ added: 0, moved: 0, restored: 0, active: 1 });
        expect(await store.exists(published)).toBe(false);

        await database`UPDATE content_switch SET enabled = TRUE WHERE key = 'media.role.literature_cover'`;
        expect(await zieheQuarantaeneNach(database, store)).toMatchObject({ lifted: 1, restored: 1, active: 0 });
        expect(await store.exists(published)).toBe(true);
        expect(await store.exists(quarantineKey(sha))).toBe(false);
        expect((await resolveLiteratureCovers(database, [adventure(1)])).size).toBe(1);
        // Nichts aus und nichts in Quarantäne: nichts zu tun.
        expect(await zieheQuarantaeneNach(database, store)).toBeNull();
    });

    it("eine Umschaltung reiht den Abgleich ein, aber nur für Bilder-Schalter, und ohne Person als Auslöser", async () => {
        const vorher = await database<{ max: number | null }[]>`SELECT max(id)::int AS max FROM job`;
        const seit = vorher[0]?.max ?? 0;
        const revision = async (): Promise<number> =>
            (await database<{ r: number }[]>`SELECT content_revision::int AS r FROM system_state WHERE id = 1`)[0]!.r;
        const schalte = async (key: string): Promise<void> => {
            const baseRevision = await revision();
            await database.begin((tx) =>
                schalteUm(tx, { key, enabled: false, baseRevision, actor: { personId: null, label: "test" } }),
            );
        };
        await schalte("panel.reviews");
        await schalte("media.role.coat");
        const jobs = await database<{ kind: string; actor_ref: string | null; state: string }[]>`
            SELECT kind, actor_ref, state FROM job WHERE id > ${seit} AND kind = 'media_quarantine'
        `;
        expect(jobs).toEqual([{ kind: "media_quarantine", actor_ref: "inhaltsschalter", state: "QUEUED" }]);
        await database`DELETE FROM job WHERE id > ${seit} AND kind = 'media_quarantine'`;
    });
});
