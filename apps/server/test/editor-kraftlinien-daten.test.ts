import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { legacyImportOffen } from "./support/legacy-import-offen.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { MAP_OPERATION_STORE, filterMapChanges } from "../src/editor/map-operation.ts";
import type { LegacyPayload } from "../src/migration/paths.ts";
import { importPowerlines } from "../src/migration/powerlines.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Datenseite des Kraftlinien-Editors (WI-0205 Paket K4; §3 Nr. 1 bis 4; Migration 0143), so wie auf dem VPS: Wegwerf-Cluster mit
 * Migrationsrolle, App-Rolle und den Rechtevorlagen. 🔴 Kein Test schreibt in `avesmaps3d_dev` oder in die geteilte Testdatenbank.
 *
 * Problemfälle: Der Trigger zählt doppelt, gar nicht, bei der abgeleiteten Bahn (`drawn_geom`) oder bei bloßen Importangaben; der
 * zweite Import zählt die Revision jeder Zeile hoch; eine eigene Linie trägt eine Legacy-Kennung; das Fachprotokoll weist ein Ziel an
 * Abschnitt oder Kraftlinienpunkt ab oder nimmt ein Feld außerhalb der Positivliste.
 */

const ENV = "kraftrev";
const grants = ["media-grants.psql", "system-grants.psql", "map-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const ORT_A = "c4c4c4c4-0000-4000-8000-00000000000a";
const ORT_B = "c4c4c4c4-0000-4000-8000-00000000000b";
const KREUZUNG = "c4c4c4c4-0000-4000-8000-00000000000c";
const ERSTE = "c4c4c4c4-0000-4000-8000-000000000001";
const ZWEITE = "c4c4c4c4-0000-4000-8000-000000000002";
const EIGENE = "c4c4c4c4-0000-4000-8000-0000000000e1";

const punkt = (id: string, featureType: string, name: string, x: number, y: number): Record<string, unknown> => ({
    type: "Feature",
    id,
    geometry: { type: "Point", coordinates: [x, y] },
    properties: { feature_type: featureType, public_id: id, name },
});
const linie = (publicId: string, from: string, to: string, coordinates: number[][]): Record<string, unknown> => ({
    type: "Feature",
    geometry: { type: "LineString", coordinates },
    properties: {
        feature_type: "powerline",
        feature_subtype: "powerline",
        public_id: publicId,
        name: "Prüflinie",
        from_public_id: from,
        to_public_id: to,
        show_label: true,
    },
});
/** Ein Strang über einen Kraftlinienpunkt: Ort A → Kreuzung → Ort B. */
const quelle = (): LegacyPayload => ({
    ok: true,
    revision: 140205,
    features: [
        punkt(ORT_A, "location", "Prüfort A", 400, 400),
        punkt(ORT_B, "location", "Prüfort B", 460, 420),
        punkt(KREUZUNG, "junction", "Kreuzung", 430, 450),
        linie(ERSTE, ORT_A, KREUZUNG, [
            [400, 400],
            [430, 450],
        ]),
        linie(ZWEITE, KREUZUNG, ORT_B, [
            [430, 450],
            [460, 420],
        ]),
    ] as never,
});

describeWithCluster("Kraftlinien: Revision, Fachprotokoll, Zug (WI-0205 K4, Wegwerf-Cluster)", () => {
    let cluster: VpsCluster | undefined;
    // Der Import hält die Sperre des Zugs auf einer reservierten Verbindung und schreibt auf einer zweiten (wie landscape-revision).
    let importer: Database | undefined;
    const migrator = (): Database => cluster!.migrator;
    const app = (): Database => cluster!.app;

    async function code(database: Database, statement: string): Promise<string> {
        try {
            await database.unsafe(statement);
            return "ok";
        } catch (error) {
            return (error as { code?: string }).code ?? String(error);
        }
    }
    const revision = async (tafel: "powerline" | "nodix", publicId: string): Promise<string> =>
        (
            await migrator().unsafe<{ revision: string }[]>(
                `SELECT revision::text FROM ${tafel} WHERE public_id = '${publicId}'`,
            )
        )[0]!.revision;

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, grants);
        await seedMapDomains(cluster.migrator);
        const o = cluster.migrator.options as unknown as {
            host: string[];
            port: number[];
            user: string;
            database: string;
        };
        importer = createDatabase(`postgres://${o.user}@${o.host[0]!}:${String(o.port[0])}/${o.database}`, { max: 3 });
        // Der Bestand entsteht mit dem Schreibweg des Imports; der Besitz des Bereichs ist hier nicht Gegenstand (siehe den Fall zum Auslassen).
        legacyImportOffen();
        await importPowerlines(importer, quelle());
    }, 180_000);

    afterAll(async () => {
        vi.restoreAllMocks();
        await importer?.end({ timeout: 5 });
        await cluster?.stop();
    }, 60_000);

    it("🔴 der Import legt an und zählt nichts: Linien und Kraftlinienpunkt stehen auf Stand 1", async () => {
        expect(await revision("powerline", ERSTE)).toBe("1");
        expect(await revision("nodix", KREUZUNG)).toBe("1");
    });

    it("🔴 der Legacy-Import lässt die Kraftlinien aus, solange sie dem WikiSync gehören: Befund bereich_wikisync, Stand unverändert", async () => {
        vi.restoreAllMocks();
        try {
            const zug = await importPowerlines(importer!, quelle());
            expect(zug).toMatchObject({ created: 0, updated: 0, retired: 0 });
            expect(zug.findings.map((finding) => finding.code)).toContain("bereich_wikisync");
            expect(await revision("powerline", ERSTE)).toBe("1");
        } finally {
            legacyImportOffen();
        }
    });

    it("🔴 der Trigger zählt genau einmal; die abgeleitete Bahn und Importangaben zählen nicht", async () => {
        // Wie eine Operation: Fachspalte UND `revision = revision` als Konfliktprüfung, als App-Rolle.
        const [geaendert] = await app()<{ revision: string }[]>`
            UPDATE powerline SET curve = 20, revision = revision WHERE public_id = ${ERSTE} AND revision = 1
            RETURNING revision::text
        `;
        expect(geaendert?.revision).toBe("2");
        // Eine veraltete Basis trifft keine Zeile: das ist der Konflikt (409 im Editor).
        expect((await app()`UPDATE powerline SET curve = 30 WHERE public_id = ${ERSTE} AND revision = 1`).count).toBe(
            0,
        );
        // Die gezeichnete Bahn folgt einem verschobenen Ort, ohne einem offenen Entwurf einen Konflikt zu bescheren.
        await app()`
            UPDATE powerline SET drawn_geom = ST_SetSRID(ST_MakeLine(ST_MakePoint(401, 401), ST_MakePoint(430, 450)), 0)
             WHERE public_id = ${ERSTE}
        `;
        await migrator()`UPDATE powerline SET imported_at = now(), migration_run_id = NULL WHERE public_id = ${ERSTE}`;
        expect(await revision("powerline", ERSTE)).toBe("2");
        // Der Kraftlinienpunkt zählt für sich.
        const [punktNeu] = await app()<{ revision: string }[]>`
            UPDATE nodix SET geom = ST_SetSRID(ST_MakePoint(431, 451), 0) WHERE public_id = ${KREUZUNG} RETURNING revision::text
        `;
        expect(punktNeu?.revision).toBe("2");
    });

    it("🔴 als App-Rolle: schreiben ja, löschen und leeren nie (map-grants.psql, Claudio 2026-10-16)", async () => {
        expect(
            await code(app(), `UPDATE powerline SET label_visible = label_visible WHERE public_id = '${ZWEITE}'`),
        ).toBe("ok");
        for (const tafel of ["powerline", "nodix", "powerline_wiki_assignment"]) {
            expect(await code(app(), `DELETE FROM ${tafel} WHERE false`), tafel).toBe("42501");
            expect(await code(app(), `TRUNCATE ${tafel}`), tafel).toBe("42501");
        }
    });

    it("🔴 eine eigene Kraftlinie trägt keine Legacy-Kennung und bleibt aktiv", async () => {
        await migrator()`
            INSERT INTO powerline (public_id, map_domain_id, name, from_public_id, to_public_id, geom, drawn_geom, source_system)
            VALUES (${EIGENE}, 'aventuria', 'Eigene Linie', ${ORT_A}, ${ORT_B},
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(400, 400), ST_MakePoint(460, 420)), 0),
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(400, 400), ST_MakePoint(460, 420)), 0), 'avesmaps3d')
        `;
        expect(
            await code(
                migrator(),
                `UPDATE powerline SET legacy_public_id = gen_random_uuid() WHERE public_id = '${EIGENE}'`,
            ),
        ).toBe("23514");
        const [eigene] = await migrator()<{ aktiv: boolean }[]>`
            SELECT is_active AS aktiv FROM powerline WHERE public_id = ${EIGENE}
        `;
        expect(eigene?.aktiv).toBe(true);
    });

    it("🔴 Fachprotokoll: Ziele an Abschnitt und Kraftlinienpunkt als App-Rolle; ohne Ziel abgewiesen; fremdes Feld laut", async () => {
        const operationId = randomUUID();
        const receipt = (id: string) =>
            ({
                operationId: id,
                status: "applied",
                environment: "test",
                affected: [],
                derivedWork: [],
                warnings: [],
            }) as never;
        await app().begin(async (tx) => {
            await MAP_OPERATION_STORE.record(tx, {
                operationId,
                requestHash: createHash("sha256").update("k4").digest(),
                receipt: receipt(operationId),
                event: {
                    operation: "powerline.reshape",
                    mapDomainId: "aventuria",
                    source: "editor",
                    actor: { kind: "person", personId: randomUUID(), environment: "test" },
                    entries: [
                        {
                            action: "powerline.reshaped",
                            powerlineId: ERSTE,
                            revisionBefore: 3,
                            revisionAfter: 4,
                            changes: { curve: { before: null, after: 12 } },
                        },
                        {
                            action: "nodix.moved",
                            nodixId: KREUZUNG,
                            revisionBefore: 3,
                            revisionAfter: 4,
                            changes: { position: { before: [430, 450], after: [432, 452] } },
                        },
                    ],
                },
            });
        });
        const zeilen = await migrator()<
            { action: string; linie: string | null; punkt: string | null; changes: unknown }[]
        >`
            SELECT action, powerline_public_id::text AS linie, nodix_public_id::text AS punkt, changes
              FROM map_audit_event WHERE operation_id = ${operationId} ORDER BY id
        `;
        expect(zeilen).toEqual([
            {
                action: "powerline.reshaped",
                linie: ERSTE,
                punkt: null,
                changes: { curve: { before: null, after: 12 } },
            },
            {
                action: "nodix.moved",
                linie: null,
                punkt: KREUZUNG,
                changes: { position: { before: [430, 450], after: [432, 452] } },
            },
        ]);
        // Ohne Ziel weist die Datenbank die Zeile ab (map_audit_event_has_target).
        expect(
            await code(
                app(),
                `INSERT INTO map_audit_event (operation_id, action, changes) VALUES ('${operationId}', 'powerline.reshaped', '{}')`,
            ),
        ).toBe("23514");
        // Die abgeleitete Bahn steht nicht in der Positivliste: In Tests scheitert sie laut.
        expect(() => filterMapChanges("powerline.reshaped", { drawnGeom: { after: "…" } })).toThrow(/Positivliste/);
    });
});
