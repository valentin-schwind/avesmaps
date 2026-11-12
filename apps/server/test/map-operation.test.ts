import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database, type Queryable } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { mapOperation, type MapActor } from "../src/editor/map-operation.ts";

/**
 * Kartenrevision und Schreibnaht des Ortseditors (WI-0128 E8, EDIT-0001 §6.1 Nr. 1 bis 4, §7.1 E8) gegen echtes PostgreSQL
 * (`avesmaps3d_test`, nie die geteilte Testwelt; W15).
 *
 * Problemfälle: Die Migration läuft ein zweites Mal und ändert etwas; das vorige Release schreibt nicht mehr; eine Operation zählt die
 * Revision zweimal, ein Beschriftungs-Override oder ein ungeänderter Import zählt mit; eine Zeile ohne Hash, mit fremder Quittung oder
 * ein Agent ohne Freigabe kommt in `map_operation`; das Protokoll nimmt Felder außerhalb der Positivliste. Soll: wie `media_operation`,
 * dazu `seq`, Domäne, Herkunft und `approval_ref` bei Agenten.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const SOURCE = "test-wi0128-e8";
const ORT = "e8e8e8e8-0000-4000-8000-000000000001";
const WEG = "e8e8e8e8-0000-4000-8000-000000000002";
/** Kennungen der Operationen dieses Tests: dasselbe Präfix, damit das Aufräumen nur sie trifft. */
const op = (n: number): string => `e8e8e8e8-0000-4000-9000-${String(n).padStart(12, "0")}`;
const PERSON: MapActor = { kind: "person", personId: "e8e8e8e8-0000-4000-a000-000000000001", environment: "test" };

const migrationFile = fileURLToPath(new URL("../migrations/0091_map_operation.sql", import.meta.url));

describeWithDatabase("Kartenrevision und Schreibnaht (WI-0128 E8)", { timeout: 120_000 }, () => {
    let database: Database;

    async function aufraeumen(): Promise<void> {
        await database`DELETE FROM map_audit_event WHERE operation_id::text LIKE 'e8e8e8e8-%'`;
        await database`DELETE FROM map_operation WHERE operation_id::text LIKE 'e8e8e8e8-%'`;
        await database`DELETE FROM path WHERE source_system = ${SOURCE}`;
        await database`DELETE FROM place WHERE source_system IN (${SOURCE}, 'avesmaps3d') AND name LIKE 'E8 %'`;
    }

    const revision = async (table: "place" | "path", publicId: string, sql: Queryable = database): Promise<number> => {
        const [row] = await sql.unsafe<{ revision: string }[]>(
            `SELECT revision::text FROM ${table} WHERE public_id = $1`,
            [publicId],
        );
        return Number(row?.revision);
    };

    /** SQLSTATE je Anweisung; jede in ihrem eigenen Sicherungspunkt, alles am Ende zurückgerollt. */
    async function codes(statements: string[]): Promise<string[]> {
        const result: string[] = [];
        try {
            await database.begin(async (tx) => {
                for (const sql of statements) {
                    await tx.unsafe("SAVEPOINT probe");
                    try {
                        await tx.unsafe(sql);
                        await tx.unsafe("RELEASE SAVEPOINT probe");
                        result.push("ok");
                    } catch (error) {
                        await tx.unsafe("ROLLBACK TO SAVEPOINT probe");
                        result.push((error as { code?: string }).code ?? "fehler");
                    }
                }
                throw new Error("__zurueck__");
            });
        } catch (error) {
            if (!(error instanceof Error) || error.message !== "__zurueck__") throw error;
        }
        return result;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await aufraeumen();
        // Wie das vorige Release: ohne `revision`, die Vorgabe trägt.
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${ORT}, 'aventuria', 'E8 Probeort', 'stadt', ST_SetSRID(ST_MakePoint(411, 412), 0), ${SOURCE}, TRUE)
        `;
        await database`
            INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system, is_active)
            VALUES (${WEG}, 'aventuria', 'E8 Probeweg', 'Weg', TRUE, FALSE,
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(411, 412), ST_MakePoint(420, 418)), 0), ${SOURCE}, TRUE)
        `;
    });

    afterAll(async () => {
        await aufraeumen();
        await database.end({ timeout: 5 });
    });

    it("🔴 die Migration ein zweites Mal ändert nichts; das vorige Release legt Orte und Wege ohne Revision an", async () => {
        expect(await revision("place", ORT)).toBe(1);
        expect(await revision("path", WEG)).toBe(1);
        // In einer Transaktion, die zurückrollt: Bliebe 0091 stehen, schriebe sein `CREATE OR REPLACE TRIGGER place_revision` die
        // Trigger von 0108 und 0115 auf seinen Stand zurück, und jeder spätere Test dieser Datenbank zählte mit der alten Fassung
        // (Fehler 2026-10-12: die Tests von „⊖ Von der Karte nehmen“ wurden nach dieser Datei rot).
        let nachher: number[] = [];
        try {
            await database.begin(async (tx) => {
                await tx.unsafe(readFileSync(migrationFile, "utf8"));
                nachher = [await revision("place", ORT, tx), await revision("path", WEG, tx)];
                throw new Error("__zurueck__");
            });
        } catch (error) {
            if (!(error instanceof Error) || error.message !== "__zurueck__") throw error;
        }
        expect(nachher).toEqual([1, 1]);
    });

    it("🔴 die Revision zählt genau einmal je Änderung einer fachlichen Spalte, nie für Overrides und Importvermerke", async () => {
        const vorher = await revision("place", ORT);
        await database`UPDATE place SET name = 'E8 Probeort Neu', is_hidden = TRUE WHERE public_id = ${ORT}`;
        expect(await revision("place", ORT)).toBe(vorher + 1);
        // Beschriftung (ADR-0006) und Importvermerk zählen nicht: Sie bescheren keinem Entwurf einen Konflikt.
        await database`UPDATE place SET label_size_override = 12, label_priority = 2 WHERE public_id = ${ORT}`;
        await database`UPDATE place SET imported_at = now() WHERE public_id = ${ORT}`;
        expect(await revision("place", ORT)).toBe(vorher + 1);
        // Eine Operation, die nur Einzelheiten ändert, berührt den Ort und prüft dabei die Revision (EDIT-0001 §6.1 Nr. 1).
        const [beruehrt] = await database<{ revision: string }[]>`
            UPDATE place SET revision = revision WHERE public_id = ${ORT} AND revision = ${vorher + 1} RETURNING revision::text
        `;
        expect(Number(beruehrt?.revision)).toBe(vorher + 2);
        const veraltet =
            await database`UPDATE place SET revision = revision WHERE public_id = ${ORT} AND revision = ${vorher}`;
        expect(veraltet.count).toBe(0);
        // Wege: die Linie zählt.
        await database`
            UPDATE path SET geom = ST_SetSRID(ST_MakeLine(ST_MakePoint(412, 412), ST_MakePoint(420, 418)), 0) WHERE public_id = ${WEG}
        `;
        expect(await revision("path", WEG)).toBe(2);
    });

    it("🔴 ein eigener Ort trägt keine Legacy-Kennung", async () => {
        expect(
            await codes([
                `INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, legacy_public_id, is_active)
                 VALUES (gen_random_uuid(), 'aventuria', 'E8 Eigen', 'dorf', ST_SetSRID(ST_MakePoint(413, 414), 0), 'avesmaps3d', gen_random_uuid(), TRUE)`,
                `INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
                 VALUES (gen_random_uuid(), 'aventuria', 'E8 Eigen', 'dorf', ST_SetSRID(ST_MakePoint(413, 414), 0), 'avesmaps3d', TRUE)`,
            ]),
        ).toEqual(["23514", "ok"]);
    });

    it("🔴 map_operation hält die Bedingungen wie media_operation; ein Agent braucht die Freigabe des Betreibers", async () => {
        const receipt = (id: string, status = "applied") =>
            `'{"operationId":"${id}","status":"${status}","environment":"test","affected":[],"derivedWork":[],"warnings":[]}'`;
        const person = "'e8e8e8e8-0000-4000-a000-000000000001'";
        const insert = (n: number, values: string) =>
            `INSERT INTO map_operation (operation_id, map_domain_id, request_hash, receipt, action, source, environment, actor_kind,
                                        actor_person_id, actor_label, approval_ref) VALUES ('${op(n)}', ${values})`;
        expect(
            await codes([
                insert(
                    1,
                    `'aventuria', sha256('x'), ${receipt(op(1))}, 'place.move', 'editor', 'test', 'person', ${person}, NULL, NULL`,
                ),
                // Hash zu kurz, fremde Quittung, Quittung „replayed“, falsches Format, unbekannte Herkunft.
                insert(
                    2,
                    `'aventuria', 'kurz', ${receipt(op(2))}, 'place.move', 'editor', 'test', 'person', ${person}, NULL, NULL`,
                ),
                insert(
                    3,
                    `'aventuria', sha256('x'), ${receipt(op(99))}, 'place.move', 'editor', 'test', 'person', ${person}, NULL, NULL`,
                ),
                insert(
                    4,
                    `'aventuria', sha256('x'), ${receipt(op(4), "replayed")}, 'place.move', 'editor', 'test', 'person', ${person}, NULL, NULL`,
                ),
                insert(
                    5,
                    `'aventuria', sha256('x'), ${receipt(op(5))}, 'Place-Move', 'editor', 'test', 'person', ${person}, NULL, NULL`,
                ),
                insert(
                    6,
                    `'aventuria', sha256('x'), ${receipt(op(6))}, 'place.move', 'handarbeit', 'test', 'person', ${person}, NULL, NULL`,
                ),
                // Ein Editorschritt ohne Hash und Quittung; der Zug ohne beides geht.
                insert(7, `'aventuria', NULL, NULL, 'place.move', 'editor', 'test', 'person', ${person}, NULL, NULL`),
                insert(
                    8,
                    `'aventuria', NULL, NULL, 'legacy.update', 'import', 'test', 'cli', NULL, 'legacy:update', NULL`,
                ),
                // Person ohne Kennung; Agent ohne Freigabe; Agent mit fremdem Namen; Agent mit Freigabe.
                insert(
                    9,
                    `'aventuria', sha256('x'), ${receipt(op(9))}, 'place.move', 'editor', 'test', 'person', NULL, NULL, NULL`,
                ),
                insert(
                    10,
                    `'aventuria', sha256('x'), ${receipt(op(10))}, 'place.move', 'editor', 'test', 'agent', NULL, 'claudia', NULL`,
                ),
                insert(
                    11,
                    `'aventuria', sha256('x'), ${receipt(op(11))}, 'place.move', 'editor', 'test', 'agent', NULL, 'codex', 'Freigabe 2026-10-10'`,
                ),
                insert(
                    12,
                    `'aventuria', sha256('x'), ${receipt(op(12))}, 'place.move', 'editor', 'test', 'agent', NULL, 'claudia', 'Betreiber 2026-10-10 14:02: Gratenfels verschieben'`,
                ),
                // Unbekannte Domäne.
                insert(
                    13,
                    `'nirgendwo', sha256('x'), ${receipt(op(13))}, 'place.move', 'editor', 'test', 'person', ${person}, NULL, NULL`,
                ),
            ]),
        ).toEqual([
            "ok",
            "23514",
            "23514",
            "23514",
            "23514",
            "23514",
            "23514",
            "ok",
            "23514",
            "23514",
            "23514",
            "ok",
            "23503",
        ]);
    });

    it("map_audit_event: ein Ziel, Revision vorwärts, Änderungen als Objekt", async () => {
        const vorab = `INSERT INTO map_operation (operation_id, map_domain_id, action, source, environment, actor_kind, actor_label)
                       VALUES ('${op(20)}', 'aventuria', 'legacy.update', 'import', 'test', 'cli', 'legacy:update')`;
        const event = (values: string) =>
            `INSERT INTO map_audit_event (operation_id, action, place_public_id, path_public_id, revision_before, revision_after, changes)
             VALUES ('${op(20)}', ${values})`;
        expect(
            await codes([
                vorab,
                event(`'place.moved', '${ORT}', NULL, 3, 4, '{"position": {"before": [1, 2], "after": [3, 4]}}'`),
                event(`'place.moved', NULL, NULL, 3, 4, '{}'`),
                event(`'place.moved', '${ORT}', NULL, 4, 4, '{}'`),
                event(`'place.moved', '${ORT}', NULL, NULL, 1, '[]'`),
                event(`'path.endpoint_moved', NULL, '${WEG}', 1, 2, '{}'`),
            ]),
        ).toEqual(["ok", "ok", "23514", "23514", "23514", "ok"]);
    });

    it("🔴 mapOperation: Änderung, Operation und Protokoll in einer Transaktion; dieselbe Kennung gibt die Quittung wieder", async () => {
        const vorher = await revision("place", ORT);
        const run = (body: unknown, actor: MapActor = PERSON) =>
            mapOperation(
                database,
                actor,
                { operationId: op(30), operation: "place.update", mapDomainId: "aventuria", body },
                async (tx) => {
                    const [row] = await tx<{ revision: string }[]>`
                        UPDATE place SET name = 'E8 Probeort Operation' WHERE public_id = ${ORT} RETURNING revision::text
                    `;
                    return {
                        receipt: { affected: [], derivedWork: [], warnings: [] },
                        summary: "E8 Probeort umbenannt",
                        entries: [
                            {
                                action: "place.updated",
                                placeId: ORT,
                                revisionBefore: vorher,
                                revisionAfter: Number(row?.revision),
                                changes: { name: { before: "E8 Probeort Neu", after: "E8 Probeort Operation" } },
                            },
                        ],
                    };
                },
            );
        const erste = await run({ name: "E8 Probeort Operation" });
        expect(erste).toMatchObject({ operationId: op(30), status: "applied", environment: "test" });
        expect(await revision("place", ORT)).toBe(vorher + 1);
        const zweite = await run({ name: "E8 Probeort Operation" });
        expect(zweite.status).toBe("replayed");
        // Nichts doppelt: eine Operation, eine Protokollzeile, eine Revision.
        expect(await revision("place", ORT)).toBe(vorher + 1);
        const [gespeichert] = await database<
            { source: string; actor_kind: string; summary: string; seq: string; zeilen: number; changes: unknown }[]
        >`
            SELECT o.source, o.actor_kind, o.summary, o.seq::text, count(e.id)::int AS zeilen, min(e.changes::text)::jsonb AS changes
              FROM map_operation o JOIN map_audit_event e ON e.operation_id = o.operation_id
             WHERE o.operation_id = ${op(30)}::uuid
             GROUP BY o.operation_id
        `;
        expect(gespeichert).toMatchObject({
            source: "editor",
            actor_kind: "person",
            summary: "E8 Probeort umbenannt",
            zeilen: 1,
        });
        expect(gespeichert?.changes).toEqual({ name: { before: "E8 Probeort Neu", after: "E8 Probeort Operation" } });
        await expect(run({ name: "anders" })).rejects.toMatchObject({ code: "idempotency_key_reused" });
    });

    it("🔴 ein Agent schreibt nur mit Freigabe; ein Feld außerhalb der Positivliste bricht die ganze Operation ab", async () => {
        const vorher = await revision("place", ORT);
        const agent = (approvalRef: string): MapActor => ({
            kind: "agent",
            label: "claudia",
            approvalRef,
            environment: "test",
        });
        const umbenennen = (n: number, actor: MapActor, feld: string) =>
            mapOperation(
                database,
                actor,
                { operationId: op(n), operation: "place.update", mapDomainId: "aventuria", body: { n } },
                async (tx) => {
                    await tx`UPDATE place SET name = ${`E8 Probeort ${String(n)}`} WHERE public_id = ${ORT}`;
                    return {
                        receipt: { affected: [], derivedWork: [], warnings: [] },
                        entries: [{ action: "place.updated", placeId: ORT, changes: { [feld]: { after: n } } }],
                    };
                },
            );
        await expect(umbenennen(40, agent(" "), "name")).rejects.toThrow(/Map Mutation Guard/);
        await expect(umbenennen(41, PERSON, "geheimeNotiz")).rejects.toThrow(/Positivliste/);
        expect(await revision("place", ORT)).toBe(vorher);
        await umbenennen(42, agent("Betreiber 2026-10-10: Probe im Test"), "name");
        const [row] = await database<{ actor_kind: string; actor_label: string; approval_ref: string }[]>`
            SELECT actor_kind, actor_label, approval_ref FROM map_operation WHERE operation_id = ${op(42)}::uuid
        `;
        expect(row).toEqual({
            actor_kind: "agent",
            actor_label: "claudia",
            approval_ref: "Betreiber 2026-10-10: Probe im Test",
        });
        const [keine] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM map_operation WHERE operation_id IN (${op(40)}::uuid, ${op(41)}::uuid)
        `;
        expect(keine?.n).toBe(0);
    });

    it("seq wächst mit jeder Operation, über alle Domänen", async () => {
        const rows = await database<{ seq: string }[]>`
            SELECT seq::text FROM map_operation WHERE operation_id::text LIKE 'e8e8e8e8-%' ORDER BY at, seq
        `;
        const seqs = rows.map((row) => Number(row.seq));
        expect(seqs.length).toBeGreaterThanOrEqual(2);
        expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    });
});
