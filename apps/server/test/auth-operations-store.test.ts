import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { runOperation } from "../src/auth/operations.ts";
import { MEDIA_OPERATION_STORE, filterMediaDetails, mediaOperation } from "../src/media-editor/operation-store.ts";

/**
 * Die Naht in `runOperation` (WI-0068 P4a, geplant in P1 „IMPLEMENTATION DETAIL“): eine optionale Speicherstelle für Kennung, Hash und
 * Quittung. Ohne sie bleibt alles beim Protokoll der Verwaltung (`avesmaps_auth.security_event`), wie vor P4a: Die Verbraucher der
 * Anmeldung und Verwaltung sind unverändert (ihre eigenen Tests, `admin-api.test.ts` und Co., laufen ohne Änderung). Die Medien
 * schreiben nach `media_operation` und `media_audit_event`.
 *
 * Problemfälle: Eine Medien-Operation landet im Protokoll der Anmeldung oder umgekehrt; eine Wiederholung wirkt zweimal; ein
 * Doppelklick bekommt einen Bearbeitungskonflikt mit sich selbst; ein Freitext gelangt am Schwärzen vorbei ins Fachprotokoll.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const PREFIX = "6e617468-0000-4000-8000-";
const id = (n: number): string => `${PREFIX}${n.toString(16).padStart(12, "0")}`;
const PERSON = "6e617468-0000-4000-9000-000000000001";
const ASSET = "6e617468-0000-4000-a000-000000000001";

describeWithDatabase("runOperation: die Speicherstelle als Naht (WI-0068 P4a)", { timeout: 60_000 }, () => {
    let database: Database;

    const clean = async (): Promise<void> => {
        await database`DELETE FROM media_audit_event WHERE operation_id::text LIKE ${`${PREFIX}%`}`;
        await database`DELETE FROM media_operation WHERE operation_id::text LIKE ${`${PREFIX}%`}`;
        await database`DELETE FROM avesmaps_auth.security_event WHERE operation_id::text LIKE ${`${PREFIX}%`}`;
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await clean();
    }, 120_000);

    afterAll(async () => {
        await clean();
        await database?.end({ timeout: 5 });
    });

    const counts = async (operationId: string) => {
        const [row] = await database<{ security: number; media: number; audit: number }[]>`
            SELECT (SELECT count(*) FROM avesmaps_auth.security_event WHERE operation_id = ${operationId}::uuid)::int AS security,
                   (SELECT count(*) FROM media_operation WHERE operation_id = ${operationId}::uuid)::int AS media,
                   (SELECT count(*) FROM media_audit_event WHERE operation_id = ${operationId}::uuid)::int AS audit
        `;
        return row!;
    };

    const adminWork = async () => ({
        receipt: { environment: "test", affected: [], derivedWork: [], warnings: [] },
        event: { environment: "test" as const, action: "backup.requested" as const, actorKind: "cli" as const },
    });

    it("🔴 ohne Speicherstelle: das Protokoll der Verwaltung wie vorher, Wiederholung und andere Inhalte unverändert", async () => {
        const operationId = id(1);
        const first = await runOperation(database, { operationId, body: { a: 1 } }, adminWork);
        expect(first).toMatchObject({ operationId, status: "applied", environment: "test" });
        const again = await runOperation(database, { operationId, body: { a: 1 } }, adminWork);
        expect(again).toEqual({ ...first, status: "replayed" });
        await expect(runOperation(database, { operationId, body: { a: 2 } }, adminWork)).rejects.toMatchObject({
            statusCode: 409,
            code: "idempotency_key_reused",
        });
        expect(await counts(operationId)).toEqual({ security: 1, media: 0, audit: 0 });
        const [row] = await database<{ action: string; receipt: { status: string } }[]>`
            SELECT action, receipt FROM avesmaps_auth.security_event WHERE operation_id = ${operationId}::uuid
        `;
        expect(row).toMatchObject({ action: "backup.requested", receipt: { status: "applied" } });
    });

    it("mit der Speicherstelle der Medien: Operation und Fachprotokoll dort, nichts im Protokoll der Anmeldung", async () => {
        const operationId = id(2);
        const work = async () => ({
            receipt: { environment: "test", affected: [], derivedWork: [], warnings: [] },
            event: {
                operation: "asset.metadata",
                environment: "test" as const,
                actorPersonId: PERSON,
                entries: [
                    {
                        action: "asset.metadata_set" as const,
                        assetId: ASSET,
                        targetRevision: 2,
                        details: { fields: ["title"] },
                    },
                ],
            },
        });
        const first = await runOperation(database, { operationId, body: { t: 1 } }, work, {
            store: MEDIA_OPERATION_STORE,
        });
        expect(first.status).toBe("applied");
        expect(
            (await runOperation(database, { operationId, body: { t: 1 } }, work, { store: MEDIA_OPERATION_STORE }))
                .status,
        ).toBe("replayed");
        await expect(
            runOperation(database, { operationId, body: { t: 2 } }, work, { store: MEDIA_OPERATION_STORE }),
        ).rejects.toMatchObject({ statusCode: 409, code: "idempotency_key_reused" });
        expect(await counts(operationId)).toEqual({ security: 0, media: 1, audit: 1 });
        const [operation] = await database<{ action: string; actor_kind: string; actor_person_id: string }[]>`
            SELECT action, actor_kind, actor_person_id::text FROM media_operation WHERE operation_id = ${operationId}::uuid
        `;
        expect(operation).toEqual({ action: "asset.metadata", actor_kind: "person", actor_person_id: PERSON });
    });

    it("🔴 Doppelklick: zwei gleichzeitige Anfragen mit derselben Kennung wirken einmal und bekommen dieselbe Quittung", async () => {
        const operationId = id(3);
        let effects = 0;
        const call = () =>
            mediaOperation(
                database,
                { personId: PERSON, environment: "test" },
                { operationId, operation: "asset.metadata", body: { title: "Hafen" } },
                async (tx) => {
                    effects += 1;
                    await tx`SELECT pg_sleep(0.2)`;
                    return {
                        receipt: { affected: [], derivedWork: [], warnings: [] },
                        entries: [{ action: "asset.metadata_set", assetId: ASSET, details: { fields: ["title"] } }],
                    };
                },
            );
        const [a, b] = await Promise.all([call(), call()]);
        expect(effects).toBe(1);
        expect([a.status, b.status].sort()).toEqual(["applied", "replayed"]);
        expect({ ...a, status: "x" }).toEqual({ ...b, status: "x" });
        expect(await counts(operationId)).toEqual({ security: 0, media: 1, audit: 1 });
    });

    it("🔴 Positivliste des Fachprotokolls: ein unbekannter Schlüssel scheitert laut, Freitext nur unter reason und note", () => {
        expect(filterMediaDetails("rights.set", { basis: "own_work", reason: "Mail vom Inhaber", note: "x" })).toEqual({
            basis: "own_work",
            reason: "Mail vom Inhaber",
            note: "x",
        });
        expect(() => filterMediaDetails("rights.set", { prompt: "geheim" })).toThrow(/Positivliste/);
        expect(() => filterMediaDetails("asset.uploaded", { originalFilename: "datei.png" })).toThrow(/Positivliste/);
    });
});
