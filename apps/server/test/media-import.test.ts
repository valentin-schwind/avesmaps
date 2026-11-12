import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { MEDIA_TABLES, importMedia } from "../src/migration/media-import.ts";
import { PUBLICATION_RULE_SEEDS } from "../src/migration/media-rules.ts";
import {
    MINE,
    SCOPE_BY_TABLE,
    cleanLegacyMedia,
    fingerprint,
    insertSubjects,
    manifestOf,
    mediaKey,
    scopedCounts as counts,
    subjectId,
    type ItemSpec,
} from "./support/media-import-fixture.ts";

/**
 * Der Metadatenimport der Medien gegen echtes PostgreSQL (WI-0063 MEDIA-M8, Migration 0077, Vertrag `media.yaml`): Assets, Rechte,
 * Galerien, Bindungen, Unterdrückungen, Freigaberegeln; Idempotenz, Rückzug, Schutz der Entscheidungen eines Editors.
 * Keine Datei, kein Byte: der Binärimport hat eigene Tests (`media-files.test.ts`).
 *
 * 🪤 Die Testdatenbank teilen sich mehrere Sitzungen und die anderen Medientests: jede Abfrage hier ist auf die eigenen Zeilen
 * beschränkt (Quellsystem `avesmaps-legacy`, Fachobjekte mit der Marke `6d696d70-`), nie auf eine Tabelle als Ganzes.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const place = (n: number) => subjectId("place", n);
const territory = (n: number) => subjectId("territory", n);
const adventure = (n: number) => subjectId("adventure", n);
const citymap = (n: number) => subjectId("citymap", n);

/** Ein Manifest mit allen Klassen, wie es Export B liefern kann (14 Einträge: 12 Assets, 2 Unterdrückungen). */
function richSpecs(): ItemSpec[] {
    return [
        // Ort 1: drei Ortsbilder (Objekt mit Einstufung, Altform ohne Einstufung, Objekt mit cc_by), dazu ein eigenes Wappen.
        {
            cls: "settlement_image",
            subject: place(1),
            url: "/uploads/siedlungen/p1/a.webp",
            sort: 0,
            code: "ai_generated",
            priv: {
                note: "Prompt: Hafen bei Nacht",
                uploaded_by: "thomas",
                uploaded_at: "2026-09-02T10:00:00Z",
                legacy_form: "object",
            },
        },
        {
            cls: "settlement_image",
            subject: place(1),
            url: "/uploads/siedlungen/p1/b.webp",
            sort: 1,
            code: null,
            priv: { legacy_form: "string" },
        },
        {
            cls: "settlement_image",
            subject: place(1),
            url: "/uploads/siedlungen/p1/c.webp",
            sort: 2,
            code: "cc_by",
            public: false,
            priv: { author: "Fremd" },
        },
        {
            cls: "settlement_coat",
            subject: place(1),
            url: "/uploads/wappen/own/p1.png",
            code: "ai_generated",
            origin: "custom",
            priv: {
                legacy_source: "own",
                uploaded_by: "thomas",
                uploaded_at: "2026-07-10T09:15:20Z",
                note: "eigenes Wappen",
            },
        },
        // Ort 2: nur ein Bild; Ort 3: coat_none; Ort 4: Wiki-Wappen aus dem Zwischenspeicher.
        { cls: "settlement_image", subject: place(2), url: "/uploads/siedlungen/p2/a.webp", sort: 0, code: null },
        { cls: "settlement_coat", subject: place(3), url: null, suppressed: true, public: false },
        {
            cls: "settlement_coat",
            subject: place(4),
            url: "/uploads/wappen/cache/aaaa.png",
            code: "public_domain",
            origin: "wiki_localized",
            priv: {
                legacy_source: "wiki",
                author: "Xeledons Spottdrossel",
                source_url: "https://de.wiki-aventurica.de/wiki/Datei:Wappen.png",
            },
        },
        // Gebiete: ein eigenes Wappen, ein leerer Override, ein cc_by mit Klartext.
        {
            cls: "territory_coat",
            subject: territory(1),
            url: "/uploads/wappen/t1-custom.png",
            code: "public_domain",
            origin: "custom",
        },
        {
            cls: "territory_coat",
            subject: territory(2),
            url: null,
            suppressed: true,
            public: false,
            source: "override",
        },
        {
            cls: "territory_coat",
            subject: territory(3),
            url: "/uploads/wappen/t3.png",
            code: "cc_by",
            origin: "wiki_localized",
            public: false,
            priv: { license_text: "CC BY-SA 3.0 DE", legacy_source: "staging" },
        },
        // Kartensammlung und Literatur.
        {
            cls: "citymap_full",
            subject: citymap(1),
            url: "/uploads/kartensammlungen/m1/full.png",
            code: "own_work",
            priv: { note: "Rechtenotiz", uploaded_at: "2026-09-04 10:00:00" },
        },
        {
            cls: "citymap_preview",
            subject: citymap(1),
            url: "/uploads/kartensammlungen/m1/thumb.webp",
            code: "permission_granted",
            origin: "autoget",
        },
        {
            cls: "literature_cover",
            subject: adventure(1),
            url: "/uploads/questcovers/w1.webp",
            code: "permission_granted",
            origin: "wiki_sync",
            priv: { author: "Ulisses" },
        },
        {
            cls: "literature_cover",
            subject: adventure(2),
            url: "/uploads/questcovers/w2.webp",
            code: null,
            public: false,
        },
    ];
}

describeWithDatabase("Medienimport: Metadaten (Migration 0077)", () => {
    let database: Database;

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
        await cleanLegacyMedia(database);
        await insertSubjects(database, {
            places: [1, 2, 3, 4, 5],
            territories: [1, 2, 3],
            adventures: [1, 2],
            citymaps: [1],
        });
    });

    const run = (specs: readonly ItemSpec[], kind: "public" | "private" = "private", revision = "media-test-1") =>
        importMedia(database, manifestOf(specs, kind, revision));

    /** Eine Abfrage über die eigenen Zeilen: `{assets}` und die Fachobjekte stehen als Teilabfragen bereit. */
    const q = <T extends object>(sql: string): Promise<T[]> => database.unsafe<T[]>(sql);
    const SYS = "a.source_system = 'avesmaps-legacy'";
    const assetKeyOf = (suffix: string) =>
        `(SELECT id FROM media_asset WHERE source_system = 'avesmaps-legacy' AND source_ref LIKE '%${suffix}')`;

    it("legt Assets, Rechte, Herkunft, Galerie, Bindungen, Unterdrückungen und Regeln an: ein Asset je Schlüssel, nichts Rohes im Ziel", async () => {
        const report = await run(richSpecs());
        expect(report.skipped).toBe(false);
        expect(report.kind).toBe("private");
        expect(report.tables.media_asset.created).toBe(12);
        expect(report.tables.media_rights.created).toBe(12);
        expect(report.tables.media_legacy_source.created).toBe(12);
        // Notizen: die von Ortsbild und Ortswappen unklassifiziert in media_creation, die der Karte als Rechtenotiz (nicht hier).
        expect(report.tables.media_creation.created).toBe(2);
        // Ort 1 hat drei Bilder (eine Galerie), Ort 2 eines (sein Titelbild; Betreiber 2026-10-17, „A, über den Zug“).
        expect(report.tables.media_gallery.created).toBe(1);
        expect(report.tables.media_gallery_item.created).toBe(3);
        expect(report.tables.place_media_gallery.created).toBe(1);
        expect(report.tables.place_media.created).toBe(3);
        expect(report.tables.territory_media.created).toBe(2);
        expect(report.tables.citymap_media.created).toBe(2);
        expect(report.tables.adventure_media.created).toBe(2);
        expect(report.tables.place_media_suppression.created).toBe(1);
        expect(report.tables.territory_media_suppression.created).toBe(1);
        expect(report.rules).toEqual({ created: 8, present: 0, evidence: 2, superseded: 0, held: [] });
        expect(report.changed).toBe(true);

        // Jedes Asset steht auf pending (es gibt noch kein Byte), ist ein Bild und gehört dem Legacy-Quellsystem.
        const assets = await q<{
            technical_state: string;
            media_kind: string;
            source_system: string;
            moderation_state: string;
        }>(
            `SELECT a.technical_state, a.media_kind, a.source_system, a.moderation_state FROM media_asset a WHERE ${SYS}`,
        );
        expect(assets).toHaveLength(12);
        expect(new Set(assets.map((asset) => asset.technical_state))).toEqual(new Set(["pending"]));
        expect(new Set(assets.map((asset) => asset.media_kind))).toEqual(new Set(["image"]));
        expect(new Set(assets.map((asset) => asset.moderation_state))).toEqual(new Set(["not_applicable"]));
        expect((await q(`SELECT 1 FROM media_file WHERE media_asset_id IN ${MINE.assets}`)).length).toBe(0);
    });

    it("Rechte: jeder Code wird, was der Vertrag sagt; ai_generated, permission und cc_by sind nie eine Lizenz, cc_by hat keine Version", async () => {
        await run(richSpecs());
        const rows = await q<{
            key: string;
            basis: string;
            license_key: string | null;
            license_family: string | null;
            clearance: string;
            creation: string;
            code: string | null;
        }>(
            `SELECT a.source_ref AS key, r.rights_basis AS basis, r.license_key, r.license_family, r.clearance_state AS clearance,
                    a.creation_method AS creation, r.legacy_rights_code AS code
             FROM media_asset a JOIN media_rights r ON r.media_asset_id = a.id WHERE ${SYS}`,
        );
        const byKey = (suffix: string) => rows.find((row) => row.key.endsWith(suffix));
        expect(byKey("/uploads/siedlungen/p1/a.webp")).toMatchObject({
            basis: "own_work",
            clearance: "legacy_asserted",
            creation: "ai_generated",
            license_key: null,
        });
        // Die Altform ohne Einstufung ist die Klassenannahme: Vorgabe, nie ein Nachweis.
        expect(byKey("/uploads/siedlungen/p1/b.webp")).toMatchObject({
            basis: "own_work",
            clearance: "legacy_assumed",
            creation: "ai_generated",
            code: null,
        });
        expect(byKey("/uploads/siedlungen/p1/c.webp")).toMatchObject({
            basis: "license",
            license_key: null,
            license_family: "cc-by",
            clearance: "needs_review",
        });
        expect(byKey("/uploads/wappen/own/p1.png")).toMatchObject({
            basis: "own_work",
            clearance: "legacy_asserted",
            creation: "ai_generated",
        });
        expect(byKey("/uploads/wappen/cache/aaaa.png")).toMatchObject({
            basis: "public_domain",
            clearance: "legacy_asserted",
        });
        expect(byKey("/uploads/wappen/t3.png")).toMatchObject({
            basis: "license",
            license_key: null,
            license_family: null,
            clearance: "needs_review",
        });
        expect(byKey("/uploads/kartensammlungen/m1/thumb.webp")).toMatchObject({
            basis: "fan_policy",
            license_key: null,
        });
        expect(byKey("/uploads/questcovers/w1.webp")).toMatchObject({
            basis: "fan_policy",
            license_key: null,
            clearance: "legacy_asserted",
        });
        // Ein Cover ohne Einstufung sperrt Legacy selbst: unknown, nie öffentlich.
        expect(byKey("/uploads/questcovers/w2.webp")).toMatchObject({ basis: "unknown", clearance: "unreviewed" });
        expect(rows.every((row) => row.clearance !== "cleared" && row.clearance !== "rejected")).toBe(true);
        expect(rows.every((row) => row.license_key === null || row.license_key === "cc0-1.0")).toBe(true);
    });

    it("🔴 Ortsbilder ab zwei sind Galerieeinträge in Legacys Reihenfolge (settlement-gallery:<Ort>); ein einziges wird das Titelbild", async () => {
        await run(richSpecs());
        const rows = await q<{ ref: string; sort_order: number; key: string; role: string }>(
            `SELECT g.source_ref AS ref, i.sort_order, a.source_ref AS key, b.role
             FROM media_gallery g
             JOIN place_media_gallery b ON b.media_gallery_id = g.id
             JOIN media_gallery_item i ON i.gallery_id = g.id
             JOIN media_asset a ON a.id = i.media_asset_id
             WHERE g.source_system = 'avesmaps-legacy'
             ORDER BY g.source_ref, i.sort_order`,
        );
        expect(
            rows.map(
                (row) => `${row.ref.slice(-1)}:${String(row.sort_order)}:${row.key.split(":").pop()?.split("/").pop()}`,
            ),
        ).toEqual(["1:0:a.webp", "1:1:b.webp", "1:2:c.webp"]);
        expect(rows.every((row) => row.ref.startsWith("settlement-gallery:") && row.role === "header")).toBe(true);
        // „legacy galerien mit einem bild sind titelbilder, keine galerien.“ (Betreiber 2026-10-12): Ort 2 trägt sein Bild als Titelbild.
        const titelbilder = await q<{ key: string; origin: string }>(
            `SELECT a.source_ref AS key, m.origin FROM place_media m JOIN media_asset a ON a.id = m.media_asset_id
              WHERE m.role = 'header' AND m.retired_at IS NULL AND m.place_id IN ${MINE.places}`,
        );
        expect(titelbilder.map((row) => [row.key.split(":").pop(), row.origin])).toEqual([
            ["/uploads/siedlungen/p2/a.webp", "legacy"],
        ]);
    });

    it("Wappenzustände: kein Entscheid (keine Zeile), Unterdrückung (eigene Zeile ohne Asset), Bindung", async () => {
        await run(richSpecs());
        const placeStates = await q<{ name: string; bound: boolean; suppressed: boolean }>(
            `SELECT p.name,
                    EXISTS (SELECT 1 FROM place_media m WHERE m.place_id = p.id AND m.role = 'coat' AND m.retired_at IS NULL) AS bound,
                    EXISTS (SELECT 1 FROM place_media_suppression s WHERE s.place_id = p.id AND s.role = 'coat') AS suppressed
             FROM place p WHERE p.public_id::text LIKE '6d696d70-%' ORDER BY p.name`,
        );
        expect(
            placeStates.map(
                (state) =>
                    `${state.name.slice(-1)}:${state.bound ? "gesetzt" : state.suppressed ? "unterdrückt" : "kein Entscheid"}`,
            ),
        ).toEqual(["1:gesetzt", "2:kein Entscheid", "3:unterdrückt", "4:gesetzt", "5:kein Entscheid"]);
        const [territorySuppression] = await q<{ legacy_reason: string }>(
            `SELECT legacy_reason FROM territory_media_suppression WHERE territory_id IN ${MINE.territories}`,
        );
        expect(territorySuppression?.legacy_reason).toBe(`territory-coat:${territory(2)}:override:none`);
    });

    it("Herkunft, Stempel, Login und Notizen: roh und intern, der Stempel mit seiner Bedeutung", async () => {
        await run(richSpecs());
        const [image] = await q<{
            actor: string | null;
            stamp: string | null;
            semantics: string | null;
            note: string | null;
            degraded: boolean;
        }>(
            `SELECT a.ingest_actor_legacy AS actor, a.legacy_uploaded_at::text AS stamp, a.stamp_semantics AS semantics,
                    c.legacy_note_raw AS note, a.degraded_original AS degraded
             FROM media_asset a LEFT JOIN media_creation c ON c.media_asset_id = a.id
             WHERE ${SYS} AND a.source_ref LIKE '%/p1/a.webp'`,
        );
        expect(image).toMatchObject({
            actor: "thomas",
            semantics: "last_classification",
            note: "Prompt: Hafen bei Nacht",
            degraded: true,
        });
        expect(new Date(image?.stamp ?? "").toISOString()).toBe("2026-09-02T10:00:00.000Z");
        const [map] = await q<{ semantics: string | null; note: string | null; creator: string | null }>(
            `SELECT a.stamp_semantics AS semantics, r.rights_note AS note, r.creator
             FROM media_asset a JOIN media_rights r ON r.media_asset_id = a.id WHERE ${SYS} AND a.source_ref LIKE 'citymap:%:full:%'`,
        );
        expect(map).toMatchObject({ semantics: "upload", note: "Rechtenotiz" });
        // Das lokalisierte Wiki-Wappen ist „Kein Original“ nicht; das eigene Upload schon.
        const degraded = await q<{ key: string; degraded: boolean; origin: string }>(
            `SELECT a.source_ref AS key, a.degraded_original AS degraded, a.origin FROM media_asset a WHERE ${SYS} AND a.source_ref LIKE 'settlement-coat:%'`,
        );
        expect(degraded.find((row) => row.key.endsWith("p1.png"))).toMatchObject({
            degraded: true,
            origin: "legacy_import",
        });
        expect(degraded.find((row) => row.key.endsWith("aaaa.png"))).toMatchObject({
            degraded: false,
            origin: "wiki_localized",
        });
        // Die Legacy-Herkunft (Klasse, Adresse, Tor) steht an der eigenen Tabelle, nicht im Schlüssel.
        const [source] = await q<{
            media_class: string;
            local_url: string;
            legacy_public: boolean;
            legacy_shown: boolean | null;
            legacy_source: string | null;
        }>(
            `SELECT s.media_class, s.local_url, s.legacy_public, s.legacy_shown, s.legacy_source
             FROM media_legacy_source s JOIN media_asset a ON a.id = s.media_asset_id WHERE ${SYS} AND a.source_ref LIKE '%/wappen/cache/aaaa.png'`,
        );
        expect(source).toEqual({
            media_class: "settlement_coat",
            local_url: "/uploads/wappen/cache/aaaa.png",
            legacy_public: true,
            legacy_shown: true,
            legacy_source: "wiki",
        });
    });

    it("Provenienz (WI-0068 P1): je Asset genau ein Ingest legacy_import mit dem anlegenden Lauf, Login und Stempel wie am Asset, nie eine Person", async () => {
        const first = await run(richSpecs());
        const ingests = () =>
            q<{
                key: string;
                kind: string;
                run: string;
                person: string | null;
                label: string | null;
                semantics: string | null;
                same: boolean;
            }>(
                `SELECT a.source_ref AS key, i.ingest_kind AS kind, i.migration_run_id::text AS run, i.actor_person_id::text AS person,
                        i.legacy_actor_label AS label, i.legacy_stamp_semantics AS semantics,
                        (i.legacy_actor_label IS NOT DISTINCT FROM a.ingest_actor_legacy
                         AND i.legacy_uploaded_at IS NOT DISTINCT FROM a.legacy_uploaded_at
                         AND i.legacy_stamp_semantics IS NOT DISTINCT FROM a.stamp_semantics) AS same
                 FROM media_asset a JOIN media_ingest i ON i.media_asset_id = a.id WHERE ${SYS} ORDER BY a.source_ref`,
            );
        const rows = await ingests();
        const [assets] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM media_asset a WHERE ${SYS}`);
        expect(rows).toHaveLength(assets?.n ?? -1);
        expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
        for (const row of rows) {
            expect(row, row.key).toMatchObject({ kind: "legacy_import", run: first.runId, person: null, same: true });
        }
        expect(rows.find((row) => row.key.endsWith("/p1/a.webp"))).toMatchObject({
            label: "thomas",
            semantics: "last_classification",
        });
        // Der zweite Lauf legt keinen zweiten Ingest an und schreibt den ersten nicht um.
        const second = await run(richSpecs());
        expect(second.runId).not.toBe(first.runId);
        expect(await ingests()).toEqual(rows);
    });

    it("die Freigaberegeln entstehen mit Betreiberzitat und Datum, der Nachweis der Fan-Richtlinie hängt EINMAL an der Regel", async () => {
        await run(richSpecs());
        const rules = await q<{
            key: string;
            role: string;
            operator_quote: string;
            decided_on: string;
            revoked_on: string | null;
        }>(
            `SELECT concat_ws('/', rights_basis, creation_method, role) AS key, role, operator_quote, decided_on::text, revoked_on::text
               FROM publication_rule WHERE id IN ${MINE.rules} ORDER BY role, rights_basis`,
        );
        // Auf einer leeren Tafel entstehen die KI-Regeln gleich als solche (Betreiber 2026-10-10); es gibt nichts abzulösen.
        expect(rules.map((rule) => rule.key)).toEqual([
            "own_work/ai_generated/coat",
            "own_work/ai_generated/header",
            "fan_policy/literature_cover",
            "permission/map_full",
            "fan_policy/map_preview",
            "permission/map_preview",
            "license/photobox",
            "permission/photobox",
        ]);
        const entschiedenAm: Record<string, string> = {
            // „eigene bilder sind nicht automatisch öffentlich, aber … alle KI-generierten sind öffentlich“ (Betreiber 2026-10-10).
            "own_work/ai_generated/coat": "2026-10-10",
            "own_work/ai_generated/header": "2026-10-10",
            "fan_policy/literature_cover": "2026-10-04",
            "fan_policy/map_preview": "2026-10-04",
            // Die vier selbst hochgeladenen Kartenbilder (Betreiber 2026-10-09: „die vier kartenbilder auch freigeben“).
            "permission/map_preview": "2026-10-09",
            // Die Vollkarte Rhôndur (Betreiber 2026-10-09: „die Vollkarte Rhôndur auch freigeben“).
            "permission/map_full": "2026-10-09",
            // Reisebilder (Vali 2026-11-01: „freigaberegel passt. reisebildee dürfen öffentlich gezeigt werden“).
            "license/photobox": "2026-11-01",
            "permission/photobox": "2026-11-01",
        };
        for (const rule of rules) {
            expect(rule.decided_on).toBe(entschiedenAm[rule.key]);
            expect(rule.revoked_on).toBeNull();
            expect(rule.operator_quote.length).toBeGreaterThan(20);
        }
        expect(rules.find((rule) => rule.role === "header")?.operator_quote).toContain(
            "alle KI-generierten sind öffentlich",
        );
        expect(rules.find((rule) => rule.role === "literature_cover")?.operator_quote).toContain("G1 = A");
        const evidence = await q<{ kind: string; url: string; rule: string }>(
            `SELECT e.evidence_kind AS kind, e.external_url AS url, r.role AS rule
             FROM media_rights_evidence e JOIN publication_rule r ON r.id = e.publication_rule_id WHERE r.id IN ${MINE.rules}`,
        );
        expect(evidence.map((row) => `${row.rule}:${row.kind}:${row.url}`).sort()).toEqual([
            "literature_cover:license_page:https://ulisses-spiele.de/fan-richtlinie/",
            "map_preview:license_page:https://ulisses-spiele.de/fan-richtlinie/",
        ]);
        // Kein Nachweis an einem der Assets: er hängt an der Regel.
        const [assetEvidence] = await q<{ n: number }>(
            `SELECT count(*)::int AS n FROM media_rights_evidence WHERE media_asset_id IN ${MINE.assets}`,
        );
        expect(assetEvidence?.n).toBe(0);
    });

    it("eine widerrufene Regel wird nie neu angelegt und der Beleg nie doppelt", async () => {
        await run(richSpecs());
        await database.unsafe(
            `UPDATE publication_rule SET revoked_on = '2026-10-05', revoked_reason = 'Test' WHERE role = 'literature_cover' AND id IN ${MINE.rules}`,
        );
        const second = await run(richSpecs());
        expect(second.rules).toEqual({ created: 0, present: 8, evidence: 0, superseded: 0, held: [] });
        const [rule] = await q<{ n: number; open: number }>(
            `SELECT count(*)::int AS n, count(*) FILTER (WHERE revoked_on IS NULL)::int AS open FROM publication_rule
             WHERE role = 'literature_cover' AND id IN ${MINE.rules}`,
        );
        expect(rule).toEqual({ n: 1, open: 0 });
    });

    it("der zweite Lauf schreibt nichts und rechnet nichts neu: kein Zeitstempel ändert sich", async () => {
        await run(richSpecs());
        const before = await fingerprint(database);
        const rowCounts = await counts(database);
        const second = await run(richSpecs());
        expect(second.changed).toBe(false);
        for (const table of MEDIA_TABLES) {
            const report = second.tables[table];
            expect(report.created + report.updated + report.retired + report.reappeared, table).toBe(0);
        }
        expect(await fingerprint(database)).toBe(before);
        expect(await counts(database)).toEqual(rowCounts);
        // Auch eine neue Revision des Manifests ohne fachliche Änderung schreibt nichts.
        const third = await run(richSpecs(), "private", "media-test-2");
        expect(third.changed).toBe(false);
        expect(await fingerprint(database)).toBe(before);
    });

    it("ein Probelauf rollt alles zurück, auch das Journal und die Regeln", async () => {
        const report = await importMedia(database, manifestOf(richSpecs(), "private"), { dryRun: true });
        expect(report.dryRun).toBe(true);
        expect(report.tables.media_asset.created).toBe(12);
        expect(await counts(database)).toEqual(
            Object.fromEntries(Object.keys(SCOPE_BY_TABLE).map((table) => [table, 0])),
        );
        const [runs] = await q<{ n: number }>(
            `SELECT count(*)::int AS n FROM migration_run WHERE data_domain = 'media' AND source_system = 'avesmaps-legacy'`,
        );
        expect(runs?.n).toBe(0);
    });

    it("eine unbrauchbare oder leere Antwort schreibt nichts und zieht nichts zurück", async () => {
        await run(richSpecs());
        const before = await fingerprint(database);
        for (const payload of [
            null,
            { ok: false },
            { ok: true, items: [], counts: { items: 0 } },
            { ...manifestOf(richSpecs(), "private"), counts: { items: 1 } },
        ]) {
            const report = await importMedia(database, payload);
            expect(report.skipped).toBe(true);
            expect(report.changed).toBe(false);
            expect(report.findings.length).toBeGreaterThan(0);
        }
        expect(await fingerprint(database)).toBe(before);
    });

    it("ein Fachobjekt ohne Gegenstück im Ziel (orphan_binding) legt weder Asset noch Bindung an", async () => {
        const report = await run([
            { cls: "settlement_coat", subject: place(1), url: "/uploads/wappen/a.png", code: "public_domain" },
            { cls: "settlement_coat", subject: place(99), url: "/uploads/wappen/b.png", code: "public_domain" },
        ]);
        expect(report.tables.media_asset.created).toBe(1);
        expect(report.findings.find((finding) => finding.code === "orphan_binding")?.objectCount).toBe(1);
    });

    describe("Rückzug und Rückkehr (nur mit dem vollständigen Manifest B)", () => {
        const bindingOf = async (suffix: string) => {
            const [row] = await q<{ retired: boolean }>(
                `SELECT m.retired_at IS NOT NULL AS retired FROM place_media m JOIN media_asset a ON a.id = m.media_asset_id
                 WHERE ${SYS} AND a.source_ref LIKE '%${suffix}'`,
            );
            return row?.retired;
        };

        it("ein Medium, das das nächste Manifest nicht mehr nennt, wird zurückgezogen: Asset und Daten bleiben", async () => {
            await run(richSpecs());
            const specs = richSpecs().filter((spec) => !(spec.cls === "settlement_coat" && spec.subject === place(4)));
            const second = await run(specs);
            expect(second.tables.place_media.retired).toBe(1);
            expect(await bindingOf("/cache/aaaa.png")).toBe(true);
            // Das Asset und sein Verlauf bleiben (authoritative Klasse): nichts wird gelöscht.
            const [asset] = await q<{ n: number }>(
                `SELECT count(*)::int AS n FROM media_asset a WHERE ${SYS} AND a.source_ref LIKE '%/cache/aaaa.png'`,
            );
            expect(asset?.n).toBe(1);
            // Kehrt es zurück, wird dieselbe Zeile wieder aktiv (nichts Neues).
            const third = await run(richSpecs());
            expect(third.tables.place_media.reappeared).toBe(1);
            expect(third.tables.place_media.created).toBe(0);
            expect(third.tables.media_asset.created).toBe(0);
            expect(await bindingOf("/cache/aaaa.png")).toBe(false);
        });

        it("ein Galerieeintrag, den Legacy nicht mehr nennt, wird zurückgezogen, die übrigen behalten ihre Reihenfolge", async () => {
            await run(richSpecs());
            const specs = richSpecs().filter(
                (spec) => !(spec.cls === "settlement_image" && spec.sort === 1 && spec.subject === place(1)),
            );
            const second = await run(specs);
            expect(second.tables.media_gallery_item.retired).toBe(1);
            const items = await q<{ sort_order: number; key: string; retired: boolean }>(
                `SELECT i.sort_order, a.source_ref AS key, i.retired_at IS NOT NULL AS retired
                 FROM media_gallery_item i JOIN media_asset a ON a.id = i.media_asset_id JOIN media_gallery g ON g.id = i.gallery_id
                 WHERE g.source_system = 'avesmaps-legacy' AND g.source_ref = 'settlement-gallery:${place(1)}' ORDER BY i.sort_order`,
            );
            expect(items.map((item) => `${String(item.sort_order)}:${item.retired ? "zurück" : "aktiv"}`)).toEqual([
                "0:aktiv",
                "1:zurück",
                "2:aktiv",
            ]);
        });

        it("fällt ein ganzer Ort aus dem Manifest, zieht der Lauf seine Galerie zurück", async () => {
            await run(richSpecs());
            const specs = richSpecs().filter((spec) => !(spec.cls === "settlement_image" && spec.subject === place(1)));
            const second = await run(specs);
            expect(second.tables.media_gallery_item.retired).toBe(3);
            expect(second.tables.place_media_gallery.retired).toBe(1);
            const [binding] = await q<{ retired: boolean }>(
                `SELECT b.retired_at IS NOT NULL AS retired FROM place_media_gallery b JOIN media_gallery g ON g.id = b.media_gallery_id
                 WHERE g.source_system = 'avesmaps-legacy' AND g.source_ref = 'settlement-gallery:${place(1)}'`,
            );
            expect(binding?.retired).toBe(true);
        });

        /** Die Titelbilder und Galerien von Ort 2: aktive Einzelbindung, aktive Galeriebindung, aktive Einträge (Dateiname). */
        const ort2 = async () => {
            const [stand] = await q<{ bild: string | null; galerie: boolean; eintraege: string[] | null }>(
                `SELECT (SELECT a.source_ref FROM place_media m JOIN media_asset a ON a.id = m.media_asset_id JOIN place p ON p.id = m.place_id
                          WHERE p.public_id = '${place(2)}' AND m.role = 'header' AND m.retired_at IS NULL) AS bild,
                        EXISTS (SELECT 1 FROM place_media_gallery b JOIN place p ON p.id = b.place_id
                                 WHERE p.public_id = '${place(2)}' AND b.retired_at IS NULL) AS galerie,
                        (SELECT array_agg(a.source_ref ORDER BY i.sort_order) FROM media_gallery g
                           JOIN media_gallery_item i ON i.gallery_id = g.id AND i.retired_at IS NULL
                           JOIN media_asset a ON a.id = i.media_asset_id
                          WHERE g.source_ref = 'settlement-gallery:${place(2)}') AS eintraege`,
            );
            return {
                bild: stand?.bild?.split("/").pop() ?? null,
                galerie: stand?.galerie ?? false,
                eintraege: (stand?.eintraege ?? []).map((key) => key.split("/").pop()),
            };
        };
        const zweitesBild: ItemSpec = {
            cls: "settlement_image",
            subject: place(2),
            url: "/uploads/siedlungen/p2/b.webp",
            sort: 1,
            code: null,
        };

        it("🔴 die 78 über den Zug: eine Galerie, die nur noch ein Bild hat, wird das Titelbild; die Umstellung zählt nicht als Stilllegung", async () => {
            await run([...richSpecs(), zweitesBild]);
            expect(await ort2()).toEqual({ bild: null, galerie: true, eintraege: ["a.webp", "b.webp"] });
            const second = await run(richSpecs());
            // EIN Titelbild ODER EINE Galerie: das verbliebene Bild ist das Titelbild, die Galerie ist gelöst.
            expect(await ort2()).toEqual({ bild: "a.webp", galerie: false, eintraege: [] });
            const umgestellt = second.findings.find((finding) => finding.code === "einbild_galerie_umgestellt");
            expect(umgestellt?.objects?.length).toBe(1);
            // Zurückgezogen zählt nur b.webp, das Legacy nicht mehr nennt; a.webp ist umgestellt, nicht stillgelegt.
            const quote = second.findings.find((finding) => finding.code === "stilllegequote");
            if (quote !== undefined) expect(quote.numbers["retiring"]).toBe(1);
            // Ein zweiter Lauf ändert nichts mehr.
            const third = await run(richSpecs());
            expect(third.tables.place_media.created + third.tables.place_media.retired).toBe(0);
            expect(await ort2()).toEqual({ bild: "a.webp", galerie: false, eintraege: [] });
        });

        it("🔴 nennt Legacy ein zweites Bild, weicht das Titelbild der Galerie (EIN Titelbild ODER EINE Galerie)", async () => {
            await run(richSpecs());
            expect(await ort2()).toEqual({ bild: "a.webp", galerie: false, eintraege: [] });
            await run([...richSpecs(), zweitesBild]);
            expect(await ort2()).toEqual({ bild: null, galerie: true, eintraege: ["a.webp", "b.webp"] });
        });

        it("🔴 hat ein Editor am Ort eine Galerie gewählt, setzt der Zug kein Titelbild daneben (held_by_editor)", async () => {
            await run([...richSpecs(), zweitesBild]);
            await database`
                UPDATE place_media_gallery SET origin = 'editor'
                 WHERE place_id = (SELECT id FROM place WHERE public_id = ${place(2)}::uuid) AND retired_at IS NULL
            `;
            await database`
                UPDATE media_gallery SET origin = 'editor' WHERE source_ref = ${`settlement-gallery:${place(2)}`}
            `;
            const second = await run(richSpecs());
            expect(second.findings.map((finding) => finding.code)).toContain("held_by_editor");
            const stand = await ort2();
            expect(stand.bild).toBeNull();
            expect(stand.galerie).toBe(true);
        });

        it("ändert Legacy das Wappen eines Ortes (andere Datei), wird die alte Bindung zurückgezogen und die neue gesetzt", async () => {
            await run(richSpecs());
            const specs = richSpecs().map((spec) =>
                spec.cls === "settlement_coat" && spec.subject === place(1)
                    ? { ...spec, url: "/uploads/wappen/own/p1-neu.png" }
                    : spec,
            );
            const second = await run(specs);
            expect(second.tables.place_media.created).toBe(1);
            expect(second.tables.place_media.retired).toBe(1);
            const active = await q<{ key: string }>(
                `SELECT a.source_ref AS key FROM place_media m JOIN media_asset a ON a.id = m.media_asset_id
                 JOIN place p ON p.id = m.place_id WHERE p.public_id = '${place(1)}' AND m.role = 'coat' AND m.retired_at IS NULL`,
            );
            expect(active).toHaveLength(1);
            expect(active[0]?.key.endsWith("p1-neu.png")).toBe(true);
        });

        it("wird aus einer Unterdrückung ein Wappen und umgekehrt, folgt die Datenbank (nie beides zugleich)", async () => {
            await run(richSpecs());
            // Ort 3: coat_none wird ein Wappen. Ort 1: das Wappen wird coat_none.
            const specs = richSpecs()
                .filter(
                    (spec) =>
                        !(spec.cls === "settlement_coat" && (spec.subject === place(3) || spec.subject === place(1))),
                )
                .concat([
                    { cls: "settlement_coat", subject: place(3), url: "/uploads/wappen/p3.png", code: "public_domain" },
                    { cls: "settlement_coat", subject: place(1), url: null, suppressed: true, public: false },
                ]);
            const second = await run(specs);
            expect(second.tables.place_media_suppression.retired).toBe(1);
            expect(second.tables.place_media_suppression.created).toBe(1);
            const states = await q<{ name: string; bound: boolean; suppressed: boolean }>(
                `SELECT p.name,
                        EXISTS (SELECT 1 FROM place_media m WHERE m.place_id = p.id AND m.role = 'coat' AND m.retired_at IS NULL) AS bound,
                        EXISTS (SELECT 1 FROM place_media_suppression s WHERE s.place_id = p.id AND s.role = 'coat') AS suppressed
                 FROM place p WHERE p.public_id IN ('${place(1)}', '${place(3)}') ORDER BY p.name`,
            );
            expect(
                states.map(
                    (state) =>
                        `${state.name.slice(-1)}:${state.bound ? "gesetzt" : ""}${state.suppressed ? "unterdrückt" : ""}`,
                ),
            ).toEqual(["1:unterdrückt", "3:gesetzt"]);
        });

        it("die Stilllegequote über 5 % ist ein Befund mit Zahlen, kein Abbruch", async () => {
            await run(richSpecs());
            const second = await run(richSpecs().filter((spec) => spec.cls !== "settlement_image"));
            const finding = second.findings.find((entry) => entry.code === "stilllegequote");
            expect(finding).toBeDefined();
            expect(second.skipped).toBe(false);
        });

        it("das öffentliche Manifest A zieht NICHTS zurück und löscht keine Unterdrückung: es kennt nur das Öffentliche", async () => {
            await run(richSpecs());
            const before = await counts(database);
            // A nennt nur, was Legacy zeigt: ein Teil der Medien, keine Unterdrückung.
            const publicSpecs = richSpecs().filter((spec) => spec.public !== false && spec.suppressed !== true);
            const report = await importMedia(database, manifestOf(publicSpecs, "public"));
            expect(report.kind).toBe("public");
            for (const table of MEDIA_TABLES) {
                expect(report.tables[table].retired, table).toBe(0);
            }
            expect(await counts(database)).toEqual(before);
            const [suppressions] = await q<{ n: number }>(
                `SELECT count(*)::int AS n FROM place_media_suppression WHERE place_id IN ${MINE.places}`,
            );
            expect(suppressions?.n).toBe(1);
        });
    });

    describe("Was ein Editor in Avesmaps3D gesetzt hat, überschreibt der Import nie", () => {
        it("eine Bindung mit origin editor bleibt, Legacy bekommt einen Befund statt eines Überschreibens", async () => {
            await run([
                { cls: "settlement_coat", subject: place(1), url: "/uploads/wappen/a.png", code: "public_domain" },
            ]);
            await database.unsafe(`UPDATE place_media SET origin = 'editor' WHERE place_id IN ${MINE.places}`);
            const second = await run([
                { cls: "settlement_coat", subject: place(1), url: "/uploads/wappen/b.png", code: "public_domain" },
            ]);
            expect(second.tables.place_media.protectedRows).toBe(1);
            expect(second.findings.map((finding) => finding.code)).toContain("held_by_editor");
            const active = await q<{ key: string; origin: string }>(
                `SELECT a.source_ref AS key, m.origin FROM place_media m JOIN media_asset a ON a.id = m.media_asset_id
                 WHERE m.retired_at IS NULL AND m.place_id IN ${MINE.places}`,
            );
            expect(active).toHaveLength(1);
            expect(active[0]).toMatchObject({ origin: "editor" });
            expect(active[0]?.key.endsWith("a.png")).toBe(true);
        });

        it("eine Unterdrückung mit origin editor bleibt, auch gegen ein Wappen aus Legacy", async () => {
            await run([{ cls: "settlement_coat", subject: place(1), url: null, suppressed: true, public: false }]);
            await database.unsafe(
                `UPDATE place_media_suppression SET origin = 'editor' WHERE place_id IN ${MINE.places}`,
            );
            const second = await run([
                { cls: "settlement_coat", subject: place(1), url: "/uploads/wappen/a.png", code: "public_domain" },
            ]);
            expect(second.tables.place_media.protectedRows).toBe(1);
            expect(second.findings.map((finding) => finding.code)).toContain("held_by_editor");
            const [state] = await q<{ suppressed: number; bound: number }>(
                `SELECT (SELECT count(*) FROM place_media_suppression WHERE place_id IN ${MINE.places})::int AS suppressed,
                        (SELECT count(*) FROM place_media WHERE retired_at IS NULL AND place_id IN ${MINE.places})::int AS bound`,
            );
            expect(state).toEqual({ suppressed: 1, bound: 0 });
        });

        it("schon geprüfte Rechte (cleared, reviewed_at) schreibt der Import nie über", async () => {
            await run(richSpecs());
            await database.unsafe(
                `UPDATE media_rights SET clearance_state = 'cleared', reviewed_by = 'Redaktion', reviewed_at = now(), rights_basis = 'own_work',
                                        license_family = NULL
                 WHERE media_asset_id = ${assetKeyOf("/p1/c.webp")}`,
            );
            const second = await run(richSpecs());
            expect(second.tables.media_rights.protectedRows).toBeGreaterThanOrEqual(1);
            const [rights] = await q<{ clearance: string; basis: string; license_family: string | null }>(
                `SELECT clearance_state AS clearance, rights_basis AS basis, license_family FROM media_rights WHERE media_asset_id = ${assetKeyOf("/p1/c.webp")}`,
            );
            expect(rights).toEqual({ clearance: "cleared", basis: "own_work", license_family: null });
        });

        it("Hochladestempel und Login werden einmal übernommen und nie neu geschrieben; Prompt und Werkzeug einer Entstehung bleiben", async () => {
            await run(richSpecs());
            await database.unsafe(
                `UPDATE media_creation SET prompt = 'Prompt des Editors', tool = 'Werkzeug' WHERE media_asset_id = ${assetKeyOf("/p1/a.webp")}`,
            );
            const changed = richSpecs().map((spec) =>
                spec.cls === "settlement_image" && spec.sort === 0 && spec.subject === place(1)
                    ? {
                          ...spec,
                          priv: {
                              ...spec.priv,
                              uploaded_at: "2026-10-01T12:00:00Z",
                              uploaded_by: "anna",
                              note: "neue Notiz",
                          },
                      }
                    : spec,
            );
            await run(changed);
            const [row] = await q<{
                stamp: string;
                actor: string;
                note: string | null;
                prompt: string | null;
                tool: string | null;
            }>(
                `SELECT a.legacy_uploaded_at::text AS stamp, a.ingest_actor_legacy AS actor, c.legacy_note_raw AS note, c.prompt, c.tool
                 FROM media_asset a JOIN media_creation c ON c.media_asset_id = a.id WHERE ${SYS} AND a.source_ref LIKE '%/p1/a.webp'`,
            );
            expect(new Date(row?.stamp ?? "").toISOString()).toBe("2026-09-02T10:00:00.000Z");
            expect(row?.actor).toBe("thomas");
            const [ingest] = await q<{ label: string; stamp: string }>(
                `SELECT i.legacy_actor_label AS label, i.legacy_uploaded_at::text AS stamp
                 FROM media_asset a JOIN media_ingest i ON i.media_asset_id = a.id WHERE ${SYS} AND a.source_ref LIKE '%/p1/a.webp'`,
            );
            expect(ingest?.label, "auch am Ingest nie neu geschrieben").toBe("thomas");
            expect(new Date(ingest?.stamp ?? "").toISOString()).toBe("2026-09-02T10:00:00.000Z");
            // Die Notiz aus Legacy folgt Legacy (sie gehört dem Import), der Prompt eines Editors nicht.
            expect(row).toMatchObject({ note: "neue Notiz", prompt: "Prompt des Editors", tool: "Werkzeug" });
        });
    });

    describe("Export A zuerst, dann B", () => {
        it("B ergänzt, was A nicht kennt (Unterdrückung, Stempel, nichtöffentliche Medien) und stellt die Vorgabe richtig ein", async () => {
            const publicSpecs = richSpecs().filter((spec) => spec.public !== false && spec.suppressed !== true);
            const first = await importMedia(database, manifestOf(publicSpecs, "public"));
            expect(first.kind).toBe("public");
            expect(first.findings.map((finding) => finding.code)).toContain("wappen_state_unknown");
            const [coatBefore] = await q<{ clearance: string }>(
                `SELECT r.clearance_state AS clearance FROM media_asset a JOIN media_rights r ON r.media_asset_id = a.id
                 WHERE ${SYS} AND a.source_ref LIKE '%/wappen/own/p1.png'`,
            );
            // Ohne Hochladestempel (A kennt ihn nicht) bleibt ai_generated am Ortswappen eine Vorgabe.
            expect(coatBefore?.clearance).toBe("legacy_assumed");
            const second = await run(richSpecs());
            expect(second.kind).toBe("private");
            expect(second.tables.place_media_suppression.created).toBe(1);
            expect(second.tables.territory_media_suppression.created).toBe(1);
            // Neun Assets kannte A schon; B bringt das nicht öffentliche Ortsbild, das cc_by-Gebietswappen und das Cover ohne Einstufung dazu.
            expect(second.tables.media_asset.created).toBe(3);
            const [coatAfter] = await q<{ clearance: string; actor: string | null }>(
                `SELECT r.clearance_state AS clearance, a.ingest_actor_legacy AS actor
                 FROM media_asset a JOIN media_rights r ON r.media_asset_id = a.id WHERE ${SYS} AND a.source_ref LIKE '%/wappen/own/p1.png'`,
            );
            expect(coatAfter).toEqual({ clearance: "legacy_asserted", actor: "thomas" });
            // Die Provenienz zieht mit (WI-0068 P1): B ergänzt Login und Stempel auch am Ingest; der Ingest nennt weiter den Lauf
            // von A, der das Asset anlegte.
            const [ingest] = await q<{ label: string | null; stamp: string | null; run: string }>(
                `SELECT i.legacy_actor_label AS label, i.legacy_uploaded_at::text AS stamp, i.migration_run_id::text AS run
                 FROM media_asset a JOIN media_ingest i ON i.media_asset_id = a.id WHERE ${SYS} AND a.source_ref LIKE '%/wappen/own/p1.png'`,
            );
            expect(ingest).toMatchObject({ label: "thomas", run: first.runId });
            expect(new Date(ingest?.stamp ?? "").toISOString()).toBe("2026-07-10T09:15:20.000Z");
        });
    });

    it("jeder Schlüssel einer Klasse hat die Form des Vertrags (Fixtures und Prüfung stimmen überein)", () => {
        expect(mediaKey({ cls: "settlement_image", subject: place(1), url: "/uploads/siedlungen/a.webp" })).toBe(
            `settlement-image:${place(1)}:/uploads/siedlungen/a.webp`,
        );
        expect(
            mediaKey({ cls: "territory_coat", subject: territory(1), url: "/uploads/wappen/a.png", source: "staging" }),
        ).toBe(`territory-coat:${territory(1)}:staging:/uploads/wappen/a.png`);
        expect(PUBLICATION_RULE_SEEDS).toHaveLength(8);
    });
});
