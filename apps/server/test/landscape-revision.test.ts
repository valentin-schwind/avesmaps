import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { MAP_OPERATION_STORE } from "../src/editor/map-operation.ts";
import { importRegions } from "../src/migration/region-import.ts";
import type { LegacyAreaPayload, LegacyMapPayload, LegacyRegionPayload } from "../src/migration/regions.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Datenseite des Landschaftseditors (WI-0178 Paket B1; EDIT-0004 §3 M1, §4 Nr. 2 und 4, §7 B1; Migration 0137), so wie auf dem
 * VPS: Wegwerf-Cluster mit Migrationsrolle, App-Rolle und `map-grants.psql`. 🔴 Kein Test schreibt in `avesmaps3d_dev` oder in die
 * geteilte Testdatenbank.
 *
 * Problemfälle: Der Trigger zählt doppelt (`SET revision = revision` und eine Fachspalte), gar nicht, oder bei bloßen Importangaben;
 * `updated_at` bleibt stehen, und das Glätten übersieht die Fläche; der zweite Import zählt die Revision jeder Zeile hoch; der Import
 * nimmt einer eigenen Landschaft die Hauptbeschriftung; eine Kurvenregion steht nach dem Import `punkt`; ein abweichender Text aus
 * Legacy wird als „folgt dem Namen“ verbucht; das Fachprotokoll weist ein Ziel an der Landschaft ab; die App löscht eine Landschaft
 * oder schreibt die Ableitungen.
 */

const ENV = "landrev";
const grants = ["media-grants.psql", "system-grants.psql", "map-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const KURVE = "b1b1b1b1-0000-4000-8000-000000000001";
const PUNKT = "b1b1b1b1-0000-4000-8000-000000000002";
const KURVE_FLAECHE = "b1b1b1b1-0000-4000-8000-0000000000a1";
const PUNKT_FLAECHE = "b1b1b1b1-0000-4000-8000-0000000000a2";
// Die Kennungen sind so gewählt, dass die Hauptbeschriftung NICHT von selbst vorn läge.
const KURVE_HAUPT = "b1b1b1b1-0000-4000-8000-0000000000c9";
const KURVE_ANDERS = "b1b1b1b1-0000-4000-8000-0000000000c1";
const PUNKT_LABEL = "b1b1b1b1-0000-4000-8000-0000000000c2";
const EIGEN = "b1b1b1b1-0000-4000-8000-0000000000e1";
const EIGEN_LABEL = "b1b1b1b1-0000-4000-8000-0000000000e2";

const quadrat = (x: number, y: number): number[][][] => [
    [
        [x, y],
        [x + 10, y],
        [x + 10, y + 10],
        [x, y + 10],
        [x, y],
    ],
];
const label = (publicId: string, name: string, region: string, x: number): Record<string, unknown> => ({
    geometry: { type: "Point", coordinates: [x, x] },
    properties: { feature_type: "label", public_id: publicId, name, ecosystem_region_public_id: region },
});

function quelle(): { regions: LegacyRegionPayload; areas: LegacyAreaPayload; labels: LegacyMapPayload } {
    return {
        regions: {
            ok: true,
            regions: [
                {
                    public_id: KURVE,
                    name: "Kurvenwald",
                    kind: "vegetation",
                    region_type: "wald",
                    area_count: 1,
                    label_public_id: KURVE_HAUPT,
                    curve_label: true,
                    curve_label_max: 2,
                },
                { public_id: PUNKT, name: "Punktmoor", kind: "vegetation", region_type: "moor", area_count: 1 },
            ],
        } as never,
        areas: {
            ok: true,
            revision: 9101,
            truncated: false,
            areas: [
                {
                    public_id: KURVE_FLAECHE,
                    region_public_id: KURVE,
                    geometry: { type: "Polygon", coordinates: quadrat(100, 100) },
                },
                {
                    public_id: PUNKT_FLAECHE,
                    region_public_id: PUNKT,
                    geometry: { type: "Polygon", coordinates: quadrat(200, 200) },
                },
            ],
        } as never,
        labels: {
            ok: true,
            revision: 9102,
            features: [
                label(KURVE_HAUPT, "Kurvenwald", KURVE, 105),
                label(KURVE_ANDERS, "Alter Kurvenforst", KURVE, 106),
                label(PUNKT_LABEL, "Punktmoor", PUNKT, 205),
            ],
        } as never,
    };
}

interface LabelZeile {
    public_id: string;
    placement: string | null;
    curve_count: number | null;
    sort_order: number | null;
    text_follows_name: boolean | null;
    revision: string;
}

describeWithCluster(
    "Landschaften: Revision, Fachprotokoll, Beschriftung je Beschriftung (WI-0178 B1, Wegwerf-Cluster)",
    () => {
        let cluster: VpsCluster | undefined;
        // Der Import hält die Sperre des Zugs auf einer reservierten Verbindung und schreibt auf einer zweiten; die Migrationsrolle des
        // Clusters hat nur eine. Also eine eigene Verbindung als Migrationsrolle, wie der Zug auf dem VPS.
        let importer: Database | undefined;
        const migrator = (): Database => cluster!.migrator;
        const app = (): Database => cluster!.app;

        /** Der SQLSTATE einer Anweisung als App-Rolle, `ok` ohne Fehler. */
        async function code(database: Database, statement: string): Promise<string> {
            try {
                await database.unsafe(statement);
                return "ok";
            } catch (error) {
                return (error as { code?: string }).code ?? String(error);
            }
        }
        async function import_(): Promise<Awaited<ReturnType<typeof importRegions>>> {
            const satz = quelle();
            return importRegions(importer!, satz.regions, satz.areas, satz.labels);
        }
        const labels = async (): Promise<Map<string, LabelZeile>> => {
            const rows = await migrator()<LabelZeile[]>`
            SELECT public_id::text, placement, curve_count, sort_order, text_follows_name, revision::text
              FROM map_label WHERE region_id IS NOT NULL ORDER BY public_id
        `;
            return new Map(rows.map((row) => [row.public_id, row]));
        };
        const regionRevision = async (publicId: string): Promise<{ revision: string; updated_at: Date }> =>
            (
                await migrator()<{ revision: string; updated_at: Date }[]>`
                SELECT revision::text, updated_at FROM region WHERE public_id = ${publicId}
            `
            )[0]!;

        beforeAll(async () => {
            cluster = await startVpsCluster(ENV, grants);
            await seedMapDomains(cluster.migrator);
            const o = cluster.migrator.options as unknown as {
                host: string[];
                port: number[];
                user: string;
                database: string;
            };
            importer = createDatabase(`postgres://${o.user}@${o.host[0]!}:${String(o.port[0])}/${o.database}`, {
                max: 3,
            });
        }, 180_000);

        afterAll(async () => {
            await importer?.end({ timeout: 5 });
            await cluster?.stop();
        }, 60_000);

        it("🔴 der Import füllt je Beschriftung Lage, Anzahl, Reihenfolge und Text; der zweite Lauf schreibt nichts und zählt nichts", async () => {
            const erst = await import_();
            expect(erst.labels.created).toBe(3);
            const nach = await labels();
            // Kurvenregion: die Hauptbeschriftung entlang mit Legacys Anzahl und vorn, die andere an einem Punkt mit eigenem Text.
            expect(nach.get(KURVE_HAUPT)).toMatchObject({
                placement: "entlang",
                curve_count: 2,
                sort_order: 0,
                text_follows_name: true,
            });
            expect(nach.get(KURVE_ANDERS)).toMatchObject({
                placement: "punkt",
                curve_count: null,
                sort_order: 1,
                text_follows_name: false,
            });
            expect(nach.get(PUNKT_LABEL)).toMatchObject({
                placement: "punkt",
                curve_count: null,
                sort_order: 0,
                text_follows_name: true,
            });
            // Beide Regionen bekommen ihren Zeiger nach den Beschriftungen (P4; das Moor über den Rückwärtszeiger); das zählt einmal.
            const basis = await regionRevision(KURVE);
            expect(basis.revision).toBe("2");
            expect((await regionRevision(PUNKT)).revision).toBe("2");

            const zweit = await import_();
            expect(zweit.labels).toMatchObject({ created: 0, updated: 0, unchanged: 3 });
            expect(zweit.regions).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
            expect(zweit.labelChanges).toEqual([]);
            for (const zeile of (await labels()).values()) expect(zeile.revision, zeile.public_id).toBe("1");
            expect((await regionRevision(KURVE)).revision).toBe(basis.revision);
            expect((await regionRevision(PUNKT)).revision).toBe("2");
        });

        it("🔴 der Trigger zählt genau einmal und setzt updated_at; Importangaben zählen nicht; der nächste Zug stellt Legacy her", async () => {
            const vorher = await regionRevision(KURVE);
            const basis = Number(vorher.revision);
            // Wie eine Operation: Fachspalte UND `revision = revision` als Konfliktprüfung, als App-Rolle.
            const [geaendert] = await app()<{ revision: string }[]>`
            UPDATE region SET name = 'Umbenannt', revision = revision WHERE public_id = ${KURVE} AND revision = ${basis}
            RETURNING revision::text
        `;
            expect(geaendert?.revision).toBe(String(basis + 1));
            const nachher = await regionRevision(KURVE);
            expect(nachher.updated_at.getTime()).toBeGreaterThan(vorher.updated_at.getTime());
            // Eine veraltete Basis trifft keine Zeile: das ist der Konflikt (409 im Editor).
            const veraltet =
                await app()`UPDATE region SET name = 'Zu spät' WHERE public_id = ${KURVE} AND revision = ${basis}`;
            expect(veraltet.count).toBe(0);

            // Nur die Importangaben: keine Revision.
            await migrator()`UPDATE region SET imported_at = now(), migration_run_id = NULL WHERE public_id = ${KURVE}`;
            expect((await regionRevision(KURVE)).revision).toBe(String(basis + 1));

            // Fläche und Beschriftung zählen für sich, die Fläche setzt `updated_at` (das Glätten erkennt sie daran).
            const [flaeche] = await app()<{ revision: string; frisch: boolean }[]>`
            UPDATE region_area SET geom = ST_SetSRID(ST_GeomFromText('POLYGON((100 100, 111 100, 111 110, 100 110, 100 100))'), 0)
             WHERE public_id = ${KURVE_FLAECHE}
            RETURNING revision::text, updated_at > now() - interval '1 minute' AS frisch
        `;
            expect(flaeche).toEqual({ revision: "2", frisch: true });
            const [beschriftung] = await app()<{ revision: string }[]>`
            UPDATE map_label SET label_size = 14 WHERE public_id = ${KURVE_ANDERS} RETURNING revision::text
        `;
            expect(beschriftung?.revision).toBe("2");

            // „editieren nur testen“ (B1): Der nächste Zug setzt alles auf Legacy zurück und zählt dabei mit.
            const zug = await import_();
            expect(zug.regions.updated).toBe(1);
            expect(zug.areas.updated).toBe(1);
            expect(zug.labels.updated).toBe(1);
            const [zurueck] = await migrator()<{ name: string; revision: string }[]>`
            SELECT name, revision::text FROM region WHERE public_id = ${KURVE}
        `;
            expect(zurueck).toEqual({ name: "Kurvenwald", revision: String(basis + 2) });
        });

        it("🔴 eine eigene Landschaft behält beim Zug ihre Hauptbeschriftung (EDIT-0004 §4 Nr. 4) und trägt keine Legacy-Kennung", async () => {
            await migrator()`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, source_system)
            VALUES (${EIGEN}, 'aventuria', 'Eigener Hain', 'vegetation', 'wald', 'avesmaps3d')
        `;
            await migrator()`
            INSERT INTO map_label (public_id, map_domain_id, region_id, name, geom, source_system, placement, sort_order, text_follows_name)
            SELECT ${EIGEN_LABEL}, 'aventuria', id, 'Eigener Hain', ST_SetSRID(ST_MakePoint(300, 300), 0), 'avesmaps3d', 'punkt', 0, TRUE
              FROM region WHERE public_id = ${EIGEN}
        `;
            await migrator()`
            UPDATE region SET primary_label_id = (SELECT id FROM map_label WHERE public_id = ${EIGEN_LABEL}) WHERE public_id = ${EIGEN}
        `;
            const zug = await import_();
            expect(zug.primaryLabelsCleared).toBe(0);
            const [eigen] = await migrator()<{ primary: string | null; is_active: boolean }[]>`
            SELECT l.public_id::text AS primary, r.is_active
              FROM region r LEFT JOIN map_label l ON l.id = r.primary_label_id WHERE r.public_id = ${EIGEN}
        `;
            expect(eigen).toEqual({ primary: EIGEN_LABEL, is_active: true });

            expect(
                await code(
                    migrator(),
                    `UPDATE region SET legacy_public_id = gen_random_uuid() WHERE public_id = '${EIGEN}'`,
                ),
            ).toBe("23514");
        });

        it("🔴 Fachprotokoll: Ziele an Landschaft, Fläche und Beschriftung als App-Rolle; ohne Ziel abgewiesen", async () => {
            const operationId = randomUUID();
            await app().begin(async (tx) => {
                await MAP_OPERATION_STORE.record(tx, {
                    operationId,
                    requestHash: createHash("sha256").update("b1").digest(),
                    receipt: {
                        operationId,
                        status: "applied",
                        environment: "test",
                        affected: [],
                        derivedWork: [],
                        warnings: [],
                    } as never,
                    event: {
                        operation: "landscape.update",
                        mapDomainId: "aventuria",
                        source: "editor",
                        actor: { kind: "person", personId: randomUUID(), environment: "test" },
                        entries: [
                            {
                                action: "region.renamed",
                                regionId: KURVE,
                                revisionBefore: 3,
                                revisionAfter: 4,
                                changes: { name: { before: "Kurvenwald", after: "Kurvenhain" } },
                            },
                            {
                                action: "area.reshaped",
                                regionId: KURVE,
                                areaId: KURVE_FLAECHE,
                                revisionBefore: 3,
                                revisionAfter: 4,
                            },
                            {
                                action: "label.updated",
                                regionId: KURVE,
                                labelId: KURVE_HAUPT,
                                changes: { text: { before: "Kurvenwald", after: "Kurvenhain" } },
                            },
                        ],
                    },
                });
            });
            const zeilen = await migrator()<
                { action: string; region: string | null; area: string | null; label: string | null }[]
            >`
            SELECT action, region_public_id::text AS region, region_area_public_id::text AS area, map_label_public_id::text AS label
              FROM map_audit_event WHERE operation_id = ${operationId} ORDER BY id
        `;
            expect(zeilen).toEqual([
                { action: "region.renamed", region: KURVE, area: null, label: null },
                { action: "area.reshaped", region: KURVE, area: KURVE_FLAECHE, label: null },
                { action: "label.updated", region: KURVE, area: null, label: KURVE_HAUPT },
            ]);
            expect(
                await code(
                    app(),
                    `INSERT INTO map_audit_event (operation_id, action) VALUES ('${operationId}', 'region.renamed')`,
                ),
            ).toBe("23514");
        });

        it("🔴 als App-Rolle: Landschaften schreiben ja, löschen nie; die Ableitungen nur lesen", async () => {
            const codes = [
                await code(app(), `UPDATE map_label SET is_active = FALSE WHERE public_id = '${PUNKT_LABEL}'`),
                await code(app(), `DELETE FROM map_label WHERE public_id = '${PUNKT_LABEL}'`),
                await code(app(), `DELETE FROM region_area WHERE public_id = '${PUNKT_FLAECHE}'`),
                await code(app(), `DELETE FROM region WHERE public_id = '${PUNKT}'`),
                await code(app(), `TRUNCATE map_label`),
                await code(app(), `SELECT count(*) FROM region_area_smooth`),
                await code(app(), `DELETE FROM region_area_smooth`),
                await code(app(), `DELETE FROM landscape_label_run`),
            ];
            expect(codes).toEqual(["ok", "42501", "42501", "42501", "42501", "ok", "42501", "42501"]);
        });

        it("🔴 die Migration ein zweites Mal: kein Fehler, keine Wirkung", async () => {
            const stand = async (): Promise<string> => {
                const [zeile] = await migrator()<{ stand: string }[]>`
                SELECT concat_ws('|',
                    (SELECT string_agg(public_id || ':' || revision || ':' || updated_at, ',' ORDER BY public_id) FROM region),
                    (SELECT string_agg(public_id || ':' || revision || ':' || updated_at, ',' ORDER BY public_id) FROM region_area),
                    (SELECT string_agg(public_id || ':' || revision || ':' || coalesce(placement, '-'), ',' ORDER BY public_id) FROM map_label),
                    (SELECT count(*) FROM pg_trigger WHERE tgname IN ('region_revision', 'region_area_revision', 'map_label_revision')),
                    (SELECT count(*) FROM pg_constraint WHERE conname LIKE '%own_without_legacy_id' OR conname LIKE 'map_label_%placement%')
                ) AS stand
            `;
                return zeile!.stand;
            };
            const vorher = await stand();
            const sql = await readFile(new URL("../migrations/0137_landscape_revision.sql", import.meta.url), "utf8");
            await migrator().unsafe(sql);
            expect(await stand()).toBe(vorher);
        });
    },
);
