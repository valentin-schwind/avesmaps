import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { mapOperation, ruecknahmeZiele, type MapActor, type MapWork } from "../src/editor/map-operation.ts";

/**
 * Rücknahmen merken sich, welche Operationen sie zurücknehmen (WI-0265 B1, Migration 0262 `map_operation_revert_link`; Fachvertrag C.4,
 * Testvertrag U8 und U15, jeweils der Teil des Schreibers) gegen echtes PostgreSQL (`TEST_DATABASE_URL`, nie die geteilte Testwelt).
 *
 * Problemfälle: Eine Rücknahme schreibt keine oder eine falsche Verknüpfung (Position, Reihenfolge der Anfrage); ein Replay derselben
 * Kennung oder zwei gleichzeitige Anfragen legen die Verknüpfungen doppelt an; eine unbekannte Kennung in `reverts` schreibt trotzdem
 * etwas, statt vor jeder Änderung mit 400 abzuweisen; eine Operation ohne `reverts` bekommt eine Verknüpfung. Die Rechte der App-Rolle
 * (nur SELECT und INSERT) prüft `map-grants.test.ts`.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const SOURCE = "test-wi0265-b1";
const ORT = "a2650265-0000-4000-8000-000000000001";
/** Kennungen der Operationen dieses Tests: dasselbe Präfix, damit das Aufräumen nur sie trifft. */
const op = (n: number): string => `a2650265-0000-4000-9000-${String(n).padStart(12, "0")}`;
const PERSON: MapActor = { kind: "person", personId: "a2650265-0000-4000-a000-000000000001", environment: "test" };

describeWithDatabase("Rücknahmen und ihre Verknüpfung (WI-0265 B1)", { timeout: 120_000 }, () => {
    let database: Database;

    async function aufraeumen(): Promise<void> {
        await database`DELETE FROM map_audit_event WHERE operation_id::text LIKE 'a2650265-%'`;
        // Die Verknüpfungen gehen mit ihren Operationen (ON DELETE CASCADE, Migration 0262).
        await database`DELETE FROM map_operation WHERE operation_id::text LIKE 'a2650265-%'`;
        await database`DELETE FROM place WHERE source_system = ${SOURCE}`;
    }

    const name = async (): Promise<string> => {
        const [zeile] = await database<{ name: string }[]>`SELECT name FROM place WHERE public_id = ${ORT}::uuid`;
        return zeile?.name ?? "";
    };

    /** Eine Operation, die den Namen des Orts setzt; zählt, wie oft die Fachoperation lief. */
    function umbenennen(neuerName: string, lauf: { n: number } = { n: 0 }): MapWork {
        return async (tx) => {
            lauf.n += 1;
            const [vorher] = await tx<{ name: string }[]>`SELECT name FROM place WHERE public_id = ${ORT}::uuid`;
            await tx`UPDATE place SET name = ${neuerName} WHERE public_id = ${ORT}::uuid`;
            return {
                receipt: { affected: [], derivedWork: [], warnings: [] },
                summary: neuerName,
                entries: [
                    {
                        action: "place.updated",
                        placeId: ORT,
                        changes: { name: { before: vorher?.name, after: neuerName } },
                    },
                ],
            };
        };
    }

    /** Eine gewöhnliche Operation (Quelle `editor`): ein Ursprung, den eine Rücknahme zurücknehmen kann. */
    const original = (n: number) =>
        mapOperation(
            database,
            PERSON,
            {
                operationId: op(n),
                operation: "place.update",
                mapDomainId: "aventuria",
                body: { name: `Original ${String(n)}` },
            },
            umbenennen(`Original ${String(n)}`),
        );

    /** Eine Rücknahme: `source: restore`; `reverts` nur im Körper (wie alle Editoren) oder ausdrücklich (Arbeitsserie). */
    const ruecknahme = (
        n: number,
        optionen: { koerper?: object; reverts?: readonly string[]; lauf?: { n: number } } = {},
    ) =>
        mapOperation(
            database,
            PERSON,
            {
                operationId: op(n),
                operation: "place.update",
                mapDomainId: "aventuria",
                body: { name: `Zurück ${String(n)}`, ...optionen.koerper },
                source: "restore",
                ...(optionen.reverts === undefined ? {} : { reverts: optionen.reverts }),
            },
            umbenennen(`Zurück ${String(n)}`, optionen.lauf),
        );

    const links = (restore: string) =>
        database<{ reverted: string; position: number }[]>`
            SELECT reverted_operation_id::text AS reverted, position FROM map_operation_revert_link
             WHERE restore_operation_id = ${restore}::uuid ORDER BY position
        `;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await aufraeumen();
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${ORT}, 'aventuria', 'B1 Probeort', 'stadt', ST_SetSRID(ST_MakePoint(511, 512), 0), ${SOURCE}, TRUE)
        `;
    });

    afterAll(async () => {
        await aufraeumen();
        await database.end({ timeout: 5 });
    });

    it("🔴 U15 (Teil): die Einzelrücknahme aller Editoren (`reverts` im Körper) legt genau eine Verknüpfung an, Position 0", async () => {
        await original(1);
        const quittung = await ruecknahme(2, { koerper: { reverts: op(1) } });
        expect(quittung.status).toBe("applied");
        expect(await links(op(2))).toEqual([{ reverted: op(1), position: 0 }]);
        // Rückwärts: „wer nahm das zurück“ - der Index auf `reverted_operation_id`.
        const nahmZurueck = await database<{ restore: string }[]>`
            SELECT restore_operation_id::text AS restore FROM map_operation_revert_link WHERE reverted_operation_id = ${op(1)}::uuid
        `;
        expect(nahmZurueck).toEqual([{ restore: op(2) }]);
        // Das Original selbst bleibt unberührt: keine Verknüpfung als Rücknahme.
        expect(await links(op(1))).toEqual([]);
    });

    it("🔴 U15 (Teil): eine Rücknahme mehrerer Operationen legt genau diese an, in der Reihenfolge der Anfrage (nicht der Kennung); Doppelte zählen einmal", async () => {
        await original(10);
        await original(11);
        await original(12);
        await ruecknahme(13, { reverts: [op(12), op(10), op(11), op(12)] });
        expect(await links(op(13))).toEqual([
            { reverted: op(12), position: 0 },
            { reverted: op(10), position: 1 },
            { reverted: op(11), position: 2 },
        ]);
        // Rücknahme einer Rücknahme: die Verknüpfung zeigt auf die Rücknahme, die Originale behalten ihre erste.
        await ruecknahme(14, { reverts: [op(13)] });
        expect(await links(op(14))).toEqual([{ reverted: op(13), position: 0 }]);
        const nahmZurueck = await database<{ restore: string }[]>`
            SELECT restore_operation_id::text AS restore FROM map_operation_revert_link
             WHERE reverted_operation_id = ${op(12)}::uuid ORDER BY restore_operation_id
        `;
        expect(nahmZurueck).toEqual([{ restore: op(13) }]);
    });

    it("🔴 ein ausdrückliches `reverts` geht dem Feld im Körper vor; ohne `reverts` entsteht keine Verknüpfung", async () => {
        await original(20);
        await original(21);
        await ruecknahme(22, { koerper: { reverts: op(20) }, reverts: [op(21)] });
        expect(await links(op(22))).toEqual([{ reverted: op(21), position: 0 }]);
        // Eine gewöhnliche Operation (und jede Rücknahme, die den Körper nicht nutzt, etwa WikiSync) schreibt nichts in die Tafel.
        expect(await links(op(20))).toEqual([]);
        expect(await links(op(21))).toEqual([]);
    });

    it("🔴 U8 (Teil): dieselbe Kennung noch einmal gibt `replayed` und legt nichts doppelt an; auch zwei gleichzeitige Anfragen", async () => {
        await original(30);
        await original(31);
        const lauf = { n: 0 };
        const erste = await ruecknahme(32, { reverts: [op(30), op(31)], lauf });
        expect(erste.status).toBe("applied");
        const zweite = await ruecknahme(32, { reverts: [op(30), op(31)], lauf });
        expect(zweite.status).toBe("replayed");
        // Die Fachoperation lief nur einmal, die Verknüpfungen stehen einmal da.
        expect(lauf.n).toBe(1);
        expect(await links(op(32))).toEqual([
            { reverted: op(30), position: 0 },
            { reverted: op(31), position: 1 },
        ]);
        // Gleichzeitig: Doppelklick und Netzretry.
        const gleichzeitig = { n: 0 };
        const beide = await Promise.all([
            ruecknahme(33, { reverts: [op(30)], lauf: gleichzeitig }),
            ruecknahme(33, { reverts: [op(30)], lauf: gleichzeitig }),
        ]);
        expect(beide.map((quittung) => quittung.status).sort()).toEqual(["applied", "replayed"]);
        expect(gleichzeitig.n).toBe(1);
        expect(await links(op(33))).toEqual([{ reverted: op(30), position: 0 }]);
        // Dieselbe Kennung mit anderem Inhalt bleibt 409 (Hash), und auch dann entsteht keine Verknüpfung.
        await expect(
            ruecknahme(33, { reverts: [op(30)], koerper: { name: "anders" }, lauf: gleichzeitig }),
        ).rejects.toMatchObject({ code: "idempotency_key_reused" });
        expect(await links(op(33))).toEqual([{ reverted: op(30), position: 0 }]);
    });

    it("🔴 eine unbekannte Operation in `reverts` weist die Anfrage mit 400 ab, vor jeder Änderung: keine Operation, kein Protokoll, keine Verknüpfung", async () => {
        await original(40);
        const vorher = await name();
        const lauf = { n: 0 };
        const [operationenVorher] = await database<{ n: number }[]>`SELECT count(*)::int AS n FROM map_operation`;
        for (const reverts of [
            [op(999)],
            [op(40), op(999)],
            // Die eigene Kennung ist (noch) keine Operation.
            [op(41)],
        ]) {
            await expect(ruecknahme(41, { reverts, lauf })).rejects.toMatchObject({
                statusCode: 400,
                code: "validation_failed",
                details: { field: "reverts" },
            });
        }
        // Dasselbe, wenn die Kennung nur im Körper steht (der Weg aller Editoren).
        await expect(ruecknahme(41, { koerper: { reverts: op(999) }, lauf })).rejects.toMatchObject({
            statusCode: 400,
            details: { field: "reverts", operationIds: [op(999)] },
        });
        // Keine UUID: ebenfalls 400, nicht 500.
        await expect(ruecknahme(41, { reverts: ["keine-uuid"], lauf })).rejects.toMatchObject({
            statusCode: 400,
            code: "validation_failed",
        });
        expect(lauf.n).toBe(0);
        expect(await name()).toBe(vorher);
        const [operationenNachher] = await database<{ n: number }[]>`SELECT count(*)::int AS n FROM map_operation`;
        expect(operationenNachher?.n).toBe(operationenVorher?.n);
        expect(await links(op(41))).toEqual([]);
        const [protokoll] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM map_audit_event WHERE operation_id = ${op(41)}::uuid
        `;
        expect(protokoll?.n).toBe(0);
    });

    it("🔴 die Quelle restore verlangt eine zurückgenommene Operation (nur im Test streng, wie die Positivliste des Protokolls)", async () => {
        await expect(
            mapOperation(
                database,
                PERSON,
                {
                    operationId: op(50),
                    operation: "place.update",
                    mapDomainId: "aventuria",
                    body: {},
                    source: "restore",
                },
                umbenennen("B1 ohne Bezug"),
            ),
        ).rejects.toThrow(/Quelle restore ohne zurückgenommene Operation/);
    });

    it("🔴 ruecknahmeZiele: Körper oder ausdrücklich, klein geschrieben, ohne Doppelte, in der Reihenfolge der Anfrage", () => {
        const a = op(1);
        const b = op(2);
        expect(ruecknahmeZiele({ body: {} })).toEqual([]);
        expect(ruecknahmeZiele({ body: undefined })).toEqual([]);
        expect(ruecknahmeZiele({ body: { reverts: a.toUpperCase() } })).toEqual([a]);
        expect(ruecknahmeZiele({ body: { reverts: a }, reverts: [b, a, b] })).toEqual([b, a]);
        expect(() => ruecknahmeZiele({ body: { reverts: "x" } })).toThrow(/ungültig/);
    });

    it("🔴 die Verknüpfungen gehen mit ihren Operationen (Zurücksetzen der Testwelt, Aufräumen): kein Fremdschlüssel hält eine Löschung auf", async () => {
        await original(60);
        await ruecknahme(61, { reverts: [op(60)] });
        expect(await links(op(61))).toHaveLength(1);
        await database`DELETE FROM map_audit_event WHERE operation_id = ${op(61)}::uuid`;
        await database`DELETE FROM map_operation WHERE operation_id = ${op(61)}::uuid`;
        expect(await links(op(61))).toEqual([]);
    });
});
