import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { MAP_OPERATION_STORE } from "../src/editor/map-operation.ts";
import type { LegacyTerritoryPayload } from "../src/migration/territories.ts";
import { importTerritories } from "../src/migration/territory-import.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Datenseite des Herrschaftsgebiete-Editors (WI-0209 Paket B1; EDIT-0005 §4 M1, §7 B1; Migration 0145), so wie auf dem VPS:
 * Wegwerf-Cluster mit Migrationsrolle, App-Rolle und `map-grants.psql`. 🔴 Kein Test schreibt in `avesmaps3d_dev` oder in die geteilte
 * Testdatenbank.
 *
 * Problemfälle: Der Trigger zählt doppelt, gar nicht oder bei bloßen Importangaben und abgelegten Wappenspalten; `updated_at` bleibt
 * stehen; der zweite Import zählt jede Zeile hoch; das Fachprotokoll weist ein Ziel am Gebiet ab; die App löscht ein Gebiet; ein
 * Zyklus aus Legacy hält den Import an (er darf es nicht: Befund, keine Sperre); ein eigenes Gebiet trägt eine Legacy-Kennung.
 */

const ENV = "terrrev";
const grants = ["media-grants.psql", "system-grants.psql", "map-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const ID = (n: number): string => `77777782-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const REICH = ID(1);
const BARONIE = ID(2);
const NACHBAR = ID(3);
const FLAECHE = ID(0x101);
const A = ID(4);
const B = ID(5);

function gebiet(
    id: string,
    name: string,
    parent: string | null,
    extra: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        public_id: id,
        name,
        short_name: "",
        type: "Baronie",
        wiki_type: "Baronie",
        parent_public_id: parent,
        status: "",
        color: "#b2b065",
        opacity: 0.7,
        min_zoom: 0,
        max_zoom: 6,
        valid_from_bf: null,
        valid_to_bf: null,
        valid_label: "",
        wiki_key: `wiki:${name}`,
        wiki_url: null,
        capital_place_public_id: null,
        seat_place_public_id: null,
        sort_order: 0,
        updated_at: "2026-10-17 02:00:00",
        coat_of_arms_url: "",
        coat_license_status: "",
        coat_origin: "",
        ...extra,
    };
}

function quelle(extra: { territories?: Record<string, unknown>[] } = {}): LegacyTerritoryPayload {
    return {
        ok: true,
        map_revision: 1,
        territories_revision: "pt-fixture-b1",
        territories: [
            gebiet(REICH, "B1 Reich", null),
            gebiet(BARONIE, "B1 Baronie", REICH),
            gebiet(NACHBAR, "B1 Nachbar", null),
            ...(extra.territories ?? []),
        ],
        geometries: [
            {
                public_id: FLAECHE,
                territory_public_id: BARONIE,
                geometry: {
                    type: "Polygon",
                    coordinates: [
                        [
                            [100, 100],
                            [130, 100],
                            [130, 130],
                            [100, 130],
                            [100, 100],
                        ],
                    ],
                },
                valid_from_bf: null,
                valid_to_bf: null,
                min_zoom: null,
                max_zoom: null,
                updated_at: "2026-10-17 02:00:00",
            },
        ],
        claims: [{ territory_public_id: BARONIE, claimant_public_id: NACHBAR, sort_order: 0, source: "wiki" }],
    } as unknown as LegacyTerritoryPayload;
}

describeWithCluster("Herrschaftsgebiete: Revision, Fachprotokoll, Rechte (WI-0209 B1, Wegwerf-Cluster)", () => {
    let cluster: VpsCluster | undefined;
    // Der Import hält die Sperre des Zugs auf einer reservierten Verbindung und schreibt auf einer zweiten (wie die Landschaften).
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
    const revision = async (
        tafel: "territory" | "territory_area",
        publicId: string,
    ): Promise<{ revision: string; updated_at: Date }> =>
        (
            await migrator().unsafe<{ revision: string; updated_at: Date }[]>(
                `SELECT revision::text, updated_at FROM ${tafel} WHERE public_id = '${publicId}'`,
            )
        )[0]!;
    const anspruch = async (): Promise<string> =>
        (await migrator()<{ revision: string }[]>`SELECT revision::text FROM territory_claim LIMIT 1`)[0]!.revision;

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
    }, 180_000);

    afterAll(async () => {
        await importer?.end({ timeout: 5 });
        await cluster?.stop();
    }, 60_000);

    it("🔴 der Import unter der Sperre des Zugs; der zweite Lauf schreibt nichts und zählt nichts", async () => {
        const erst = await importTerritories(importer!, quelle());
        expect(erst.territories.created).toBe(3);
        // Den Elter setzt der Import nach dem Anlegen (wie bei den Landschaften den Zeiger): das zählt bei der Baronie einmal.
        const baronie = (await revision("territory", BARONIE)).revision;
        expect(baronie).toBe("2");
        expect((await revision("territory", REICH)).revision).toBe("1");
        const zweit = await importTerritories(importer!, quelle());
        expect(zweit.territories).toMatchObject({ created: 0, updated: 0, unchanged: 3 });
        expect(zweit.parentsChanged).toBe(0);
        for (const id of [REICH, NACHBAR]) expect((await revision("territory", id)).revision, id).toBe("1");
        expect((await revision("territory", BARONIE)).revision).toBe(baronie);
        expect((await revision("territory_area", FLAECHE)).revision).toBe("1");
        expect(await anspruch()).toBe("1");
    });

    it("🔴 der Trigger zählt genau einmal und setzt updated_at; Importangaben und Wappenspalten zählen nicht; der Zug stellt Legacy her", async () => {
        const vorher = await revision("territory", BARONIE);
        const basis = Number(vorher.revision);
        // Wie eine Operation: Fachspalte UND `revision = revision` als Konfliktprüfung, als App-Rolle.
        const [geaendert] = await app()<{ revision: string }[]>`
            UPDATE territory SET name = 'B1 Umbenannt', revision = revision WHERE public_id = ${BARONIE} AND revision = ${basis}
            RETURNING revision::text
        `;
        expect(geaendert?.revision).toBe(String(basis + 1));
        expect((await revision("territory", BARONIE)).updated_at.getTime()).toBeGreaterThan(
            vorher.updated_at.getTime(),
        );
        // Eine veraltete Basis trifft keine Zeile: das ist der Konflikt (409 im Editor).
        expect(
            (await app()`UPDATE territory SET name = 'Zu spät' WHERE public_id = ${BARONIE} AND revision = ${basis}`)
                .count,
        ).toBe(0);
        // Nur Importangaben oder die abgelegten Wappenspalten: keine Revision.
        await migrator()`UPDATE territory SET imported_at = now(), migration_run_id = NULL, legacy_updated_at = now() WHERE public_id = ${BARONIE}`;
        await migrator()`UPDATE territory SET coat_ref = 'abgelegt' WHERE public_id = ${BARONIE}`;
        expect((await revision("territory", BARONIE)).revision).toBe(String(basis + 1));
        // Fläche und Anspruch zählen für sich.
        const [flaeche] = await app()<{ revision: string }[]>`
            UPDATE territory_area SET max_zoom = 5 WHERE public_id = ${FLAECHE} RETURNING revision::text
        `;
        expect(flaeche?.revision).toBe("2");
        await app()`UPDATE territory_claim SET sort_order = 1`;
        expect(await anspruch()).toBe("2");
        // „bearbeiten nur testen“: Der nächste Zug setzt alles auf Legacy zurück und zählt dabei mit.
        const zug = await importTerritories(importer!, quelle());
        expect(zug.territories.updated).toBe(1);
        expect(zug.areas.updated).toBe(1);
        const [zurueck] = await migrator()<{ name: string; revision: string }[]>`
            SELECT name, revision::text FROM territory WHERE public_id = ${BARONIE}
        `;
        expect(zurueck?.name).toBe("B1 Baronie");
        expect(Number(zurueck?.revision)).toBeGreaterThan(basis + 1);
    });

    it("🔴 Fachprotokoll: Ziele an Gebiet und Fläche als App-Rolle; ohne Ziel abgewiesen", async () => {
        const operationId = randomUUID();
        await app().begin(async (tx) => {
            await MAP_OPERATION_STORE.record(tx, {
                operationId,
                requestHash: createHash("sha256").update("wi0209-b1").digest(),
                receipt: {
                    operationId,
                    status: "applied",
                    environment: "test",
                    affected: [],
                    derivedWork: [],
                    warnings: [],
                } as never,
                event: {
                    operation: "territory.update",
                    mapDomainId: "aventuria",
                    source: "editor",
                    actor: { kind: "person", personId: randomUUID(), environment: "test" },
                    entries: [],
                },
            });
        });
        expect(
            await code(
                app(),
                `INSERT INTO map_audit_event (operation_id, action, territory_public_id, revision_before, revision_after, changes)
                 VALUES ('${operationId}', 'territory.renamed', '${BARONIE}', 3, 4, '{}')`,
            ),
        ).toBe("ok");
        expect(
            await code(
                app(),
                `INSERT INTO map_audit_event (operation_id, action, territory_public_id, territory_area_public_id, changes)
                 VALUES ('${operationId}', 'territory_area.reshaped', '${BARONIE}', '${FLAECHE}', '{}')`,
            ),
        ).toBe("ok");
        expect(
            await code(
                app(),
                `INSERT INTO map_audit_event (operation_id, action, changes) VALUES ('${operationId}', 'territory.renamed', '{}')`,
            ),
        ).toBe("23514");
    });

    it("🔴 als App-Rolle: Gebiete, Flächen und Ansprüche schreiben ja, löschen nie", async () => {
        const codes = [
            await code(app(), `UPDATE territory_claim SET is_active = FALSE`),
            await code(app(), `DELETE FROM territory_claim`),
            await code(app(), `DELETE FROM territory_area WHERE public_id = '${FLAECHE}'`),
            await code(app(), `DELETE FROM territory WHERE public_id = '${NACHBAR}'`),
            await code(app(), `TRUNCATE territory_claim`),
            await code(app(), `UPDATE territory SET is_active = FALSE WHERE public_id = '${NACHBAR}'`),
        ];
        expect(codes).toEqual(["ok", "42501", "42501", "42501", "42501", "ok"]);
        await migrator()`UPDATE territory SET is_active = TRUE WHERE public_id = ${NACHBAR}`;
        await migrator()`UPDATE territory_claim SET is_active = TRUE`;
    });

    it("🔴 ein eigenes Gebiet trägt keine Legacy-Kennung", async () => {
        expect(
            await code(
                migrator(),
                `INSERT INTO territory (public_id, map_domain_id, name, color, opacity, source_system, legacy_public_id)
                 VALUES ('${ID(0x301)}', 'aventuria', 'B1 Eigen', '#112233', 0.7, 'avesmaps3d', '${ID(0x302)}')`,
            ),
        ).toBe("23514");
        expect(
            await code(
                migrator(),
                `INSERT INTO territory (public_id, map_domain_id, name, color, opacity, source_system)
                 VALUES ('${ID(0x301)}', 'aventuria', 'B1 Eigen', '#112233', 0.7, 'avesmaps3d')`,
            ),
        ).toBe("ok");
    });

    it("🔴 kein Zyklus im Baum: der Import lehnt ihn vor dem Schreiben ab, die Datenbank am Ende der Transaktion; ein Tausch in einer Transaktion geht", async () => {
        const zyklus = quelle({ territories: [gebiet(A, "B1 Zyklus A", B), gebiet(B, "B1 Zyklus B", A)] });
        await expect(importTerritories(importer!, zyklus)).rejects.toThrow(/Zyklus/);
        // Wie ein Umhängen im Editor, als App-Rolle: das Reich unter seine eigene Baronie, ein Gebiet unter sich selbst.
        expect(
            await code(
                app(),
                `UPDATE territory SET parent_id = (SELECT id FROM territory WHERE public_id = '${BARONIE}') WHERE public_id = '${REICH}'`,
            ),
        ).toBe("23514");
        expect(await code(app(), `UPDATE territory SET parent_id = id WHERE public_id = '${NACHBAR}'`)).toBe("23514");
        // Ein Tausch in EINER Transaktion: erst löst sich die Baronie, dann hängt das Reich unter sie. Kein Zwischenstand zählt.
        await app().begin(async (tx) => {
            await tx`UPDATE territory SET parent_id = NULL WHERE public_id = ${BARONIE}`;
            await tx`UPDATE territory SET parent_id = (SELECT id FROM territory WHERE public_id = ${BARONIE}) WHERE public_id = ${REICH}`;
        });
        const eltern = async (): Promise<{ reich: string | null; baronie: string | null } | undefined> =>
            (
                await migrator()<{ reich: string | null; baronie: string | null }[]>`
                    SELECT (SELECT p.public_id::text FROM territory t JOIN territory p ON p.id = t.parent_id WHERE t.public_id = ${REICH}) AS reich,
                           (SELECT p.public_id::text FROM territory t JOIN territory p ON p.id = t.parent_id WHERE t.public_id = ${BARONIE}) AS baronie
                `
            )[0];
        expect(await eltern()).toEqual({ reich: BARONIE, baronie: null });
        // Der nächste Zug stellt Legacy her (Baronie unter Reich): ein Tausch zurück in einer Transaktion, der Trigger lässt ihn durch.
        await importTerritories(importer!, quelle());
        expect(await eltern()).toEqual({ reich: null, baronie: REICH });
    });

    it("🔴 die Migration ein zweites Mal: kein Fehler, keine Wirkung", async () => {
        const stand = async (): Promise<string> => {
            const [zeile] = await migrator()<{ stand: string }[]>`
                SELECT concat_ws('|',
                    (SELECT string_agg(public_id || ':' || revision || ':' || updated_at, ',' ORDER BY public_id) FROM territory),
                    (SELECT string_agg(public_id || ':' || revision || ':' || updated_at, ',' ORDER BY public_id) FROM territory_area),
                    (SELECT string_agg(id || ':' || revision, ',' ORDER BY id) FROM territory_claim),
                    (SELECT count(*) FROM pg_trigger WHERE tgname IN ('territory_revision', 'territory_area_revision', 'territory_claim_revision', 'territory_no_cycle')),
                    (SELECT count(*) FROM pg_constraint WHERE conname IN ('territory_own_without_legacy_id', 'territory_area_own_without_legacy_id'))
                ) AS stand
            `;
            return zeile!.stand;
        };
        const vorher = await stand();
        const sql = await readFile(new URL("../migrations/0145_territory_revision.sql", import.meta.url), "utf8");
        await migrator().unsafe(sql);
        expect(await stand()).toBe(vorher);
    });
});
