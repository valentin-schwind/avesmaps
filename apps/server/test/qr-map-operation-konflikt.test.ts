import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { mapOperation, type MapActor } from "../src/editor/map-operation.ts";
import { ApiError } from "../src/http/api-error.ts";

/**
 * Qualitätsreview 2026-10-12, Befund Q-03 gegen echtes PostgreSQL: `mapOperation` meldete JEDE Verletzung eines eindeutigen
 * Schlüssels (SQLSTATE 23505) als 409 `edit_conflict` mit „Jemand hat das gerade geändert. Neu laden zeigt den aktuellen Stand.“
 *
 * Problemfall: Eine doppelte Zeile, die kein Wettlauf ist — also ein Programmierfehler —, kam als Bearbeitungskonflikt beim Editor
 * an. Der Satz riet zum Neuladen, was nichts half, und in den Logs blieb der Fehler unauffällig.
 *
 * Soll: 409 nur für die Schlüssel, an denen wirklich eine gleichzeitige Operation gewinnen kann (`KONKURRENZ_SCHLUESSEL`); jede
 * andere Verletzung fliegt weiter und wird ein 500 mit Eintrag. Die doppelte `operationId` selbst fängt `runOperation` ab und gibt
 * die erste Quittung zurück; sie gehört nicht hierher (`auth/operations.ts`).
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const SOURCE = "test-qr-konflikt";
const ORT = "ab22012a-0000-4000-8000-000000000001";
let zaehler = 0;
const operationId = (): string => `ab22012a-0000-4000-9000-${String((zaehler += 1)).padStart(12, "0")}`;

describeWithDatabase("mapOperation: 23505 nur beim echten Wettlauf als 409 (Q-03)", { timeout: 120_000 }, () => {
    let database: Database;
    let actor: MapActor;

    async function aufraeumen(): Promise<void> {
        await database`DELETE FROM job_event WHERE kind = 'map.changed'`;
        await database`DELETE FROM map_audit_event WHERE operation_id::text LIKE 'ab22012a-%'`;
        await database`DELETE FROM map_operation WHERE operation_id::text LIKE 'ab22012a-%'`;
        await database`DELETE FROM settlement_place WHERE source_system = ${SOURCE}`;
        await database`DELETE FROM place WHERE source_system = ${SOURCE}`;
    }

    const lauf = (work: Parameters<typeof mapOperation>[3]) =>
        mapOperation(
            database,
            actor,
            { operationId: operationId(), operation: "place.update", mapDomainId: "aventuria", body: {} },
            work,
        );

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await aufraeumen();
        const [person] = await database<{ id: string }[]>`
            SELECT id::text FROM avesmaps_auth.person ORDER BY id LIMIT 1
        `;
        actor = {
            kind: "person",
            personId: person?.id ?? "00000000-0000-4000-8000-000000000000",
            environment: "development",
        };
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${ORT}::uuid, 'aventuria', 'QR Konfliktort', 'dorf', ST_SetSRID(ST_MakePoint(471, 475), 0), ${SOURCE}, TRUE)
        `;
        await database`
            INSERT INTO settlement_place (settlement_key, settlement_name, name, place_type, on_map, source_system)
            VALUES ('qr konfliktort', 'QR Konfliktort', 'QR Konflikttempel', 'Tempel', FALSE, ${SOURCE})
        `;
    });

    afterAll(async () => {
        await aufraeumen();
        await database.end({ timeout: 5 });
    });

    it("🔴 Q-03 ein doppelter Ort mit derselben public_id ist ein Wettlauf: 409 edit_conflict", async () => {
        const fehler = await lauf(async (tx) => {
            await tx`
                INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
                VALUES (${ORT}::uuid, 'aventuria', 'QR Konfliktort zwei', 'dorf',
                        ST_SetSRID(ST_MakePoint(472, 476), 0), ${SOURCE}, TRUE)
            `;
            return { receipt: { affected: [], derivedWork: [], warnings: [] }, entries: [] };
        }).catch((error: unknown) => error);
        expect(fehler).toBeInstanceOf(ApiError);
        expect(fehler).toMatchObject({ statusCode: 409, code: "edit_conflict", details: { currentRevision: 0 } });
    });

    it("🔴 Q-03 jede andere Verletzung eines eindeutigen Schlüssels fliegt weiter (kein 409, kein irreführender Satz)", async () => {
        const fehler = await lauf(async (tx) => {
            // Dieselbe Stätte ein zweites Mal: `settlement_place_key_unique`. Das ist kein Wettlauf zweier Editoren.
            await tx`
                INSERT INTO settlement_place (settlement_key, settlement_name, name, place_type, on_map, source_system)
                VALUES ('qr konfliktort', 'QR Konfliktort', 'QR Konflikttempel', 'Tempel', FALSE, ${SOURCE})
            `;
            return { receipt: { affected: [], derivedWork: [], warnings: [] }, entries: [] };
        }).catch((error: unknown) => error);
        expect(fehler).not.toBeInstanceOf(ApiError);
        expect(fehler).toMatchObject({ code: "23505", constraint_name: "settlement_place_key_unique" });
    });
});
