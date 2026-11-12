import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../src/database.ts";
import { createDatabase } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { UMZUG, mergeAssets } from "../src/media-editor/merge.ts";
import { gruppenOperation, runMergeAll } from "../src/media-editor/merge-all.ts";
import { mergePreview } from "../src/media-editor/merge-preview.ts";
import { MEDIA_USAGE_TABLES, activeUsagesSql, retiredUsagesSql } from "../src/media-editor/usage-sql.ts";
import { readPublicationRules } from "../src/media/rules.ts";
import { storageKey } from "../src/media/storage.ts";
import { assetPublishes, readUsages, type AssetFacts } from "../src/migration/media-publication.ts";
import {
    PUBLICATION_RULE_SEEDS,
    ruleKeyLabel,
    ruleSeedStates,
    seedPublicationRules,
} from "../src/migration/media-rules.ts";
import { cleanMediaFixtures, insertAsset, insertRule, sha } from "./support/media-fixture.ts";

/**
 * Die Verwendung der Rolle `photobox` gegen echtes PostgreSQL (WI-0272 S3, Migration 0293, Aufgabe 16): `photobox_media` macht aus einem
 * freigegebenen Reisebild eine Verwendung, wie `place_media` aus einem Wappen. Ohne sie veröffentlicht `media_settle` nichts (`assetPublishes`),
 * mit ihr entscheidet die Policy; die Regeln für die Rolle stehen im Skript (`migration/media-rules.ts`, Valis Zitat vom 2026-11-01).
 *
 * - `readUsages` kennt die Zeile (aktiv oder zurückgenommen), `activeUsagesSql` und `retiredUsagesSql` zählen sie.
 * - Das Zusammenführen bytegleicher Werke hängt sie um und hebt sich wieder auf.
 * - Die tägliche Aufbewahrung (`photobox_aufbewahren`) löscht kein Asset mit aktiver Verwendung und räumt eine zurückgenommene mit dem Werk ab.
 *
 * Alles trägt Marken: Einreichungen die Fassung `photobox-verwendung-test`, Medienfixtures ihre eigenen (Quellsystem `media-test`).
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const MARK = "photobox-verwendung-test";
const MAP_DOMAIN = "aventuria";
const TAG_MS = 24 * 60 * 60 * 1000;

describeWithDatabase("Verwendung der Rolle photobox (WI-0272 S3, Migration 0293)", { timeout: 120_000 }, () => {
    let database: Database;
    let sequence = 0;
    /** Operationen dieses Tests (Zusammenführen schreibt Quittung und Protokoll). */
    const operationen: string[] = [];

    const keyHash = (): Buffer =>
        createHash("sha256")
            .update(`photobox-verwendung/${String(++sequence)}`)
            .digest();
    const vor = (tage: number): string => new Date(Date.now() - tage * TAG_MS).toISOString();

    async function raeumeAuf(): Promise<void> {
        // Die Fälle der Zusammenführung machen einzelne Werke zu Reisebildern (Quellsystem photobox); die Medienfixtures räumen nur ihr eigenes Quellsystem ab.
        await database`
            UPDATE media_asset SET source_system = 'media-test'
             WHERE source_system = 'photobox'
               AND id IN (SELECT media_asset_id FROM media_ingest WHERE submission_id IN (SELECT id FROM media_submission WHERE terms_version = ${MARK}))`;
        const assets = `(SELECT id FROM media_asset WHERE source_system = 'media-test')`;
        const publicIds = `(SELECT public_id::text FROM media_asset WHERE source_system = 'media-test')`;
        await database.unsafe(
            `DELETE FROM media_merge_move WHERE merge_id IN (SELECT id FROM media_merge WHERE merged_asset_id IN ${assets})`,
        );
        await database.unsafe(
            `DELETE FROM media_merge WHERE merged_asset_id IN ${assets} OR kept_asset_id IN ${assets}`,
        );
        await database.unsafe(
            `DELETE FROM job_event WHERE job_id IN (SELECT id FROM job WHERE kind = 'media_settle' AND input_ref ->> 'asset' IN ${publicIds})`,
        );
        await database.unsafe(`DELETE FROM job WHERE kind = 'media_settle' AND input_ref ->> 'asset' IN ${publicIds}`);
        await database`DELETE FROM media_audit_event WHERE operation_id = ANY(${operationen}::uuid[])`;
        await database`DELETE FROM media_operation WHERE operation_id = ANY(${operationen}::uuid[])`;
        await database`DELETE FROM photobox_media WHERE media_submission_id IN (SELECT id FROM media_submission WHERE terms_version = ${MARK})`;
        await database`DELETE FROM media_ingest WHERE submission_id IN (SELECT id FROM media_submission WHERE terms_version = ${MARK})`;
        await database`DELETE FROM media_submission WHERE terms_version = ${MARK}`;
        await cleanMediaFixtures(database);
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
    }, 120_000);

    afterAll(async () => {
        await raeumeAuf();
        await database.end({ timeout: 5 });
    });

    beforeEach(raeumeAuf);
    afterEach(raeumeAuf);

    interface Fall {
        submissionId: string;
        assetId: string;
        assetPublicId: string;
    }

    /**
     * Eine freigegebene Einreichung (oder in `state`) mit ihrem Asset (Moderation `approved`, technisch in Ordnung, Rechte `permission`
     * ungeprüft wie ein Reisebild nach der Freigabe) und, wenn verlangt, der Verwendung. Das Original trägt `bytes` (gleiche Bytes: zwei Werke).
     */
    async function fall(spec: {
        ref: string;
        state?: string;
        tage?: number;
        verwendung?: "aktiv" | "zurueck" | "keine";
        bytes?: string;
    }): Promise<Fall> {
        const asset = await insertAsset(database, {
            ref: spec.ref,
            moderationState: "approved",
            rights: { basis: "permission", clearance: "unreviewed" },
            published: [],
        });
        const original = spec.bytes ?? sha(`${spec.ref}/original`);
        await database`
            INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256)
            VALUES (${asset.id}, 'source', 'private_source', ${storageKey("private_source", original, "jpg")}, 'image/jpeg', 160, 90, 99, ${original})`;
        const state = spec.state ?? "approved";
        const [submission] = await database<{ id: string }[]>`
            INSERT INTO media_submission (status_key_hash, map_domain_id, geom, creation_kind, usage_grant, description, terms_version, state,
                                          approved_media_asset_id, submitted_at, state_changed_at)
            VALUES (${keyHash()}, ${MAP_DOMAIN}, 'SRID=0;POINT(300 300)', 'photo', 'avesmaps_only', 'Der Blick vom Hafen', ${MARK}, ${state},
                    ${state === "approved" || state === "offline" ? asset.id : null}, ${vor(spec.tage ?? 0)}, ${vor(spec.tage ?? 0)})
            RETURNING id`;
        await database`
            INSERT INTO media_ingest (media_asset_id, ingest_kind, submission_id) VALUES (${asset.id}, 'community_upload', ${submission!.id})`;
        const verwendung = spec.verwendung ?? "aktiv";
        if (verwendung !== "keine") {
            await database`
                INSERT INTO photobox_media (media_submission_id, media_asset_id, retired_at)
                VALUES (${submission!.id}, ${asset.id}, ${verwendung === "zurueck" ? new Date().toISOString() : null})`;
        }
        return { submissionId: submission!.id, assetId: asset.id, assetPublicId: asset.publicId };
    }

    const fakten: AssetFacts = {
        technicalState: "ok",
        moderationState: "approved",
        creationMethod: "photo",
        basis: "permission",
        clearance: "unreviewed",
        licenseKey: null,
        requiresAttribution: null,
    };
    const regelPermission = {
        rightsBasis: "permission",
        licenseKey: null,
        creationMethod: null,
        role: "photobox",
        revoked: false,
    } as const;

    describe("Lesen: readUsages, Reverse Usage und die Regeln der Policy", () => {
        it("🔴 eine aktive Zeile in photobox_media macht readUsages zu EINER Verwendung der Rolle photobox, mit allem, was die Entscheidung wissen muss", async () => {
            const eins = await fall({ ref: "lesen:aktiv" });
            expect(await readUsages(database, eins.assetId)).toEqual([
                { assetId: eins.assetId, role: "photobox", retired: false, override: "none", suppressed: false },
            ]);
            // Ohne `assetId` alle: die Zeile steht auch in der Gesamtliste.
            const alle = await readUsages(database);
            expect(alle.filter((zeile) => zeile.assetId === eins.assetId)).toHaveLength(1);
        });

        it("🔴 zurückgezogen (retired_at) zählt sie nicht: readUsages nennt sie als zurückgezogen, die Entscheidung lautet retired, die aktive Liste ist leer", async () => {
            const eins = await fall({ ref: "lesen:zurueck", verwendung: "zurueck" });
            const nutzungen = await readUsages(database, eins.assetId);
            expect(nutzungen).toEqual([
                { assetId: eins.assetId, role: "photobox", retired: true, override: "none", suppressed: false },
            ]);
            expect(
                assetPublishes(fakten, "photobox", nutzungen, { mimeType: "image/webp" }, [regelPermission]),
            ).toEqual({ allowed: false, reasons: ["retired"] });
            const aktiv = await database.unsafe<{ asset_id: string }[]>(
                `SELECT asset_id::text AS asset_id FROM (${activeUsagesSql("= ANY($1::bigint[])")}) u`,
                [[eins.assetId]] as never[],
            );
            expect(aktiv).toEqual([]);
            const zurueckgezogen = await database.unsafe<{ asset_id: string }[]>(
                `SELECT asset_id::text AS asset_id FROM (${retiredUsagesSql("= ANY($1::bigint[])")}) r`,
                [[eins.assetId]] as never[],
            );
            expect(zurueckgezogen).toEqual([{ asset_id: eins.assetId }]);
        });

        it("ohne Verwendung gibt es nichts zu veröffentlichen: kein Asset einer Einreichung hängt von selbst irgendwo", async () => {
            const eins = await fall({ ref: "lesen:keine", verwendung: "keine" });
            const nutzungen = await readUsages(database, eins.assetId);
            expect(nutzungen).toEqual([]);
            expect(
                assetPublishes(fakten, "photobox", nutzungen, { mimeType: "image/webp" }, [regelPermission]),
            ).toEqual({
                allowed: false,
                reasons: ["retired"],
            });
        });

        it("🔴 assetPublishes mit der Regel (permission, photobox) ergibt öffentlich; ohne Regel, vor der Freigabe oder bei der falschen Rolle nicht", async () => {
            const eins = await fall({ ref: "lesen:regel" });
            const nutzungen = await readUsages(database, eins.assetId);
            const webp = { mimeType: "image/webp" };
            expect(assetPublishes(fakten, "photobox", nutzungen, webp, [regelPermission])).toEqual({
                allowed: true,
                reasons: [],
            });
            // Ohne Regel hält die Policy zurück: „nur für Avesmaps“ wird nie von selbst öffentlich.
            expect(assetPublishes(fakten, "photobox", nutzungen, webp, [])).toEqual({
                allowed: false,
                reasons: ["permission_needs_approval"],
            });
            // Auch mit Regel: vor der Freigabe der Redaktion nicht.
            expect(
                assetPublishes({ ...fakten, moderationState: "pending" }, "photobox", nutzungen, webp, [
                    regelPermission,
                ]).reasons,
            ).toEqual(["moderation_pending"]);
            // Die Regel einer anderen Rolle öffnet die Rolle photobox nicht.
            expect(
                assetPublishes(fakten, "photobox", nutzungen, webp, [{ ...regelPermission, role: "header" }]).allowed,
            ).toBe(false);
        });

        it("die Regel aus der Datenbank (publication_rule) trägt dieselbe Entscheidung wie die Tafel der Regeln im Code", async () => {
            const eins = await fall({ ref: "lesen:regel-db" });
            const regelId = await insertRule(database, { basis: "permission", role: "photobox" });
            const regeln = await readPublicationRules(database);
            expect(regeln.some((regel) => regel.role === "photobox" && regel.rightsBasis === "permission")).toBe(true);
            expect(
                assetPublishes(
                    fakten,
                    "photobox",
                    await readUsages(database, eins.assetId),
                    { mimeType: "image/webp" },
                    regeln,
                ).allowed,
            ).toBe(true);
            expect(regelId).toMatch(/^\d+$/u);
        });

        it("🔴 die Regeln des Skripts (Valis Zitat): Erlaubnis und CC BY 4.0 tragen die Rolle, eine andere Lizenz nicht; ein Widerruf bleibt, ein zweiter Lauf schreibt nichts", async () => {
            const seeds = PUBLICATION_RULE_SEEDS.filter((seed) => seed.role === "photobox");
            expect(seeds.map(ruleKeyLabel)).toEqual(["permission/photobox", "license/cc-by-4.0/photobox"]);
            for (const seed of seeds) {
                expect(seed.operatorQuote).toBe("freigaberegel passt. reisebildee dürfen öffentlich gezeigt werden");
                expect(seed.decidedOn).toBe("2026-11-01");
            }
            const texte = seeds.map((seed) => seed.scopeText);
            try {
                expect((await seedPublicationRules(database, seeds)).created).toBe(2);
                expect(await seedPublicationRules(database, seeds)).toMatchObject({ created: 0, present: 2 });
                expect((await ruleSeedStates(database, seeds)).map(({ state }) => state)).toEqual(["active", "active"]);

                const eins = await fall({ ref: "lesen:regeln-skript" });
                const nutzungen = await readUsages(database, eins.assetId);
                const webp = { mimeType: "image/webp" };
                const regeln = await readPublicationRules(database);
                const lizenz = (licenseKey: string): AssetFacts => ({
                    ...fakten,
                    basis: "license",
                    licenseKey,
                    requiresAttribution: true,
                });
                expect(assetPublishes(fakten, "photobox", nutzungen, webp, regeln).allowed).toBe(true);
                expect(assetPublishes(lizenz("cc-by-4.0"), "photobox", nutzungen, webp, regeln).allowed).toBe(true);
                expect(assetPublishes(lizenz("cc-by-sa-4.0"), "photobox", nutzungen, webp, regeln).allowed).toBe(false);
                expect(
                    assetPublishes({ ...fakten, moderationState: "pending" }, "photobox", nutzungen, webp, regeln)
                        .allowed,
                ).toBe(false);

                await database`UPDATE publication_rule SET revoked_on = current_date, revoked_reason = 'Test' WHERE scope_text = ANY(${texte})`;
                expect((await seedPublicationRules(database, seeds)).created).toBe(0);
                expect((await ruleSeedStates(database, seeds)).map(({ state }) => state)).toEqual([
                    "revoked",
                    "revoked",
                ]);
            } finally {
                await database`DELETE FROM publication_rule WHERE scope_text = ANY(${texte})`;
            }
        });

        it("die Reverse Usage der Medienverwaltung zeigt die Verwendung: Rolle photobox, ohne Fachobjekt, ohne Galerie, Fassung 1", async () => {
            const eins = await fall({ ref: "lesen:reverse" });
            const zeilen = await database.unsafe<
                {
                    via: string;
                    subject_kind: string | null;
                    subject_id: string | null;
                    role: string | null;
                    origin: string | null;
                    gallery_id: string | null;
                    revision: number;
                    override: string;
                    suppressed: boolean;
                }[]
            >(
                `SELECT via, subject_kind, subject_id, role, origin, gallery_id, revision, override, suppressed
                   FROM (${activeUsagesSql("= ANY($1::bigint[])")}) u`,
                [[eins.assetId]] as never[],
            );
            expect(zeilen).toEqual([
                {
                    via: "binding",
                    subject_kind: null,
                    subject_id: null,
                    role: "photobox",
                    origin: null,
                    gallery_id: null,
                    revision: 1,
                    override: "none",
                    suppressed: false,
                },
            ]);
        });
    });

    describe("🔴 Reisebilder nehmen an keiner Zusammenführung teil (WI-0272 S3, Fixrunde D, Review I4)", () => {
        const akteur = { personId: randomUUID(), environment: "test" } as const;

        async function revisionVon(assetId: string): Promise<number> {
            const [row] = await database<
                { revision: number }[]
            >`SELECT revision::int AS revision FROM media_asset WHERE id = ${assetId}`;
            return row!.revision;
        }

        /** Ein Reisebild: Quellsystem `photobox`, Einreichung und Verwendung wie nach der Freigabe. */
        async function reisebild(ref: string, bytes: string): Promise<Fall> {
            const einzelner = await fall({ ref, bytes });
            await database`UPDATE media_asset SET source_system = 'photobox' WHERE id = ${einzelner.assetId}`;
            return einzelner;
        }

        /** Ein gewöhnliches Werk mit Original (kein Reisebild, keine Einreichung). */
        async function werk(ref: string, bytes: string): Promise<{ assetId: string; assetPublicId: string }> {
            const asset = await insertAsset(database, {
                ref,
                moderationState: "approved",
                rights: { basis: "permission", clearance: "unreviewed" },
                published: [],
            });
            await database`
                INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256)
                VALUES (${asset.id}, 'source', 'private_source', ${storageKey("private_source", bytes, "jpg")}, 'image/jpeg', 160, 90, 99, ${bytes})`;
            return { assetId: asset.id, assetPublicId: asset.publicId };
        }

        const anzahlMerge = async (...assetIds: string[]): Promise<number> =>
            (
                await database<{ n: number }[]>`
                    SELECT count(*)::int AS n FROM media_merge WHERE merged_asset_id = ANY(${assetIds}::bigint[]) OR kept_asset_id = ANY(${assetIds}::bigint[])`
            )[0]!.n;

        it("🔴 die Vorschau lässt jede Gruppe aus, in der auch nur EIN Reisebild steht; eine gewöhnliche Gruppe bleibt", async () => {
            const gemischt = [
                await werk("vorschau:gemischt:werk", sha("vorschau/gemischt")),
                await reisebild("vorschau:gemischt:reise", sha("vorschau/gemischt")),
            ];
            const reisen = [
                await reisebild("vorschau:reisen:eins", sha("vorschau/reisen")),
                await reisebild("vorschau:reisen:zwei", sha("vorschau/reisen")),
            ];
            const gewoehnlich = [
                await werk("vorschau:gewoehnlich:eins", sha("vorschau/gewoehnlich")),
                await werk("vorschau:gewoehnlich:zwei", sha("vorschau/gewoehnlich")),
            ];
            const vorschau = await mergePreview(database);
            const bleibende = vorschau.groups.map((gruppe) => gruppe.keepAssetId);
            for (const werke of [gemischt, reisen]) {
                for (const eines of werke) expect(bleibende).not.toContain(eines.assetPublicId);
            }
            const gruppe = vorschau.groups.find((eine) =>
                gewoehnlich.some((eines) => eines.assetPublicId === eine.keepAssetId),
            );
            expect(gruppe).toMatchObject({ members: 2 });
            // Nichts von den Reisebildern steckt in den Zahlen: kein Umzug, kein Zurückziehen aus ihren Verwendungen.
            expect(vorschau.groups.filter((eine) => eine.fileGroup === gruppe?.fileGroup)).toHaveLength(1);
        });

        it("🔴 direkt aufgerufen ist Zusammenführen 409, ob das Reisebild bleibt oder aufgeht, und es ändert nichts", async () => {
            const bytes = sha("zusammenfuehren/direkt");
            const reise = await reisebild("direkt:reise", bytes);
            const normal = await werk("direkt:normal", bytes);
            const andere = await reisebild("direkt:andere", bytes);
            const fehlerCode = async (
                keep: { assetId: string; assetPublicId: string },
                geht: { assetId: string; assetPublicId: string },
            ): Promise<unknown> => {
                const op = randomUUID();
                operationen.push(op);
                return mergeAssets(database, akteur, {
                    operationId: op,
                    keep: { assetId: keep.assetPublicId, baseRevision: await revisionVon(keep.assetId) },
                    merge: [{ assetId: geht.assetPublicId, baseRevision: await revisionVon(geht.assetId) }],
                }).then(
                    () => "kein Fehler",
                    (fehler: { statusCode?: number; code?: string }) => `${String(fehler.statusCode)} ${fehler.code}`,
                );
            };
            expect(await fehlerCode(normal, reise)).toBe("409 media_photobox_not_mergeable");
            expect(await fehlerCode(reise, normal)).toBe("409 media_photobox_not_mergeable");
            expect(await fehlerCode(reise, andere)).toBe("409 media_photobox_not_mergeable");
            expect(await anzahlMerge(reise.assetId, normal.assetId, andere.assetId)).toBe(0);
            const verwendungen = await database<{ asset: string }[]>`
                SELECT media_asset_id::text AS asset FROM photobox_media
                 WHERE media_submission_id = ANY(${[reise.submissionId, andere.submissionId]}::bigint[]) ORDER BY media_submission_id`;
            expect(verwendungen.map((zeile) => zeile.asset)).toEqual([reise.assetId, andere.assetId]);
        });

        it("🔴 der Sammellauf lässt eine Gruppe mit Reisebild aus (auch eine, die erst nach der Vorschau eines wurde) und führt die übrigen zusammen", async () => {
            const gewoehnlich = [
                await werk("lauf:gewoehnlich:eins", sha("lauf/gewoehnlich")),
                await werk("lauf:gewoehnlich:zwei", sha("lauf/gewoehnlich")),
            ];
            // Zwei Werke, von denen eines ein Reisebild wird, nachdem die Vorschau die Gruppe sah.
            const spaeter = [
                await werk("lauf:spaeter:eins", sha("lauf/spaeter")),
                await reisebild("lauf:spaeter:reise", sha("lauf/spaeter")),
            ];
            const auftrag = randomUUID();
            const gruppen = [
                { fileGroup: gewoehnlich[0]!.assetPublicId, keepAssetId: gewoehnlich[0]!.assetPublicId },
                { fileGroup: spaeter[0]!.assetPublicId, keepAssetId: spaeter[0]!.assetPublicId },
            ];
            for (const gruppe of gruppen) operationen.push(gruppenOperation(auftrag, gruppe.keepAssetId));
            const ergebnis = await runMergeAll(
                database,
                { groups: gruppen, actor: akteur, reason: null },
                { auftrag, fortschritt: () => Promise.resolve() },
            );
            expect(ergebnis).toMatchObject({ groups: 2, merged: 1, assets: 1 });
            expect(ergebnis.skipped).toEqual([{ fileGroup: spaeter[0]!.assetPublicId, reason: "photobox" }]);
            expect(ergebnis.failed).toEqual([]);
            expect(await anzahlMerge(gewoehnlich[0]!.assetId)).toBe(1);
            expect(await anzahlMerge(spaeter[0]!.assetId, spaeter[1]!.assetId)).toBe(0);
        });

        it("photobox_media zieht nie um: nicht in UMZUG; Reverse Usage und Aufbewahrung kennen die Tafel weiter", () => {
            expect(UMZUG.map((spec) => spec.tafel)).not.toContain("photobox_media");
            expect(MEDIA_USAGE_TABLES).toContain("photobox_media");
        });
    });

    describe("Aufbewahrung (photobox_aufbewahren)", () => {
        async function aufbewahren(): Promise<string[]> {
            const rows = await database<{ storage_key: string }[]>`
                SELECT storage_key FROM photobox_aufbewahren(${new Date().toISOString()}::timestamptz)`;
            return rows.map((row) => row.storage_key).sort();
        }

        async function bestand(eins: Fall): Promise<{ einreichung: number; asset: number; verwendung: number }> {
            const [row] = await database<{ einreichung: number; asset: number; verwendung: number }[]>`
                SELECT (SELECT count(*) FROM media_submission WHERE id = ${eins.submissionId})::int AS einreichung,
                       (SELECT count(*) FROM media_asset WHERE id = ${eins.assetId})::int AS asset,
                       (SELECT count(*) FROM photobox_media WHERE media_submission_id = ${eins.submissionId})::int AS verwendung`;
            return row!;
        }

        it("🔴 ein Asset mit aktiver Verwendung bleibt, samt Einreichung und Verwendung, auch lange nach dem Zustandswechsel", async () => {
            // Ein Zustand, den die Aufbewahrung sonst löscht (offline), mit einer Verwendung, die (falsch) noch aktiv ist: das Netz hält.
            const eins = await fall({ ref: "aufbewahren:aktiv", state: "offline", tage: 45, verwendung: "aktiv" });
            expect(await aufbewahren()).toEqual([]);
            expect(await bestand(eins)).toEqual({ einreichung: 1, asset: 1, verwendung: 1 });
        });

        it("🔴 eine zurückgezogene Verwendung hält nichts mehr: Werk und Einreichung gehen, die Verwendung zuerst (Fremdschlüssel auf beide)", async () => {
            const eins = await fall({ ref: "aufbewahren:zurueck", state: "offline", tage: 45, verwendung: "zurueck" });
            const gelöscht = await aufbewahren();
            expect(gelöscht.length).toBeGreaterThan(0);
            expect(await bestand(eins)).toEqual({ einreichung: 0, asset: 0, verwendung: 0 });
        });

        it("offline und noch innerhalb der 30 Tage: die Dateien gehen, die zurückgezogene Verwendung bleibt als Verlauf bei der Einreichung", async () => {
            const eins = await fall({ ref: "aufbewahren:frist", state: "offline", tage: 1, verwendung: "zurueck" });
            expect((await aufbewahren()).length).toBeGreaterThan(0);
            expect(await bestand(eins)).toEqual({ einreichung: 1, asset: 1, verwendung: 1 });
        });

        it("eine Einreichung ohne Verwendung (abgelehnt) wird wie bisher nach 30 Tagen gelöscht", async () => {
            const eins = await fall({ ref: "aufbewahren:abgelehnt", state: "rejected", tage: 45, verwendung: "keine" });
            await aufbewahren();
            expect(await bestand(eins)).toEqual({ einreichung: 0, asset: 0, verwendung: 0 });
        });
    });
});
