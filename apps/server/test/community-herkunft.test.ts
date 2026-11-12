import { randomBytes, randomUUID } from "node:crypto";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    HERKUNFT_KOPF,
    anfrageHerkunft,
    leseHerkunft,
    mitHerkunft,
    registriereHerkunft,
} from "../src/community/herkunft.ts";
import { melden } from "../src/community/db.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { mapOperation, type MapActor, type MapWork } from "../src/editor/map-operation.ts";

/**
 * Herkunft einer Kartenoperation aus einem Community-Vorgang (WI-0268 C7, Migration 0272, `community/herkunft.ts`).
 *
 * Problemfälle: Die Kopfzeile kommt nach dem Lesen des Rumpfs nicht mehr im Handler an (asynchroner Kontext verloren); ein GET oder eine
 * Kopfzeile in falscher Form setzt trotzdem eine Herkunft; eine unbekannte Nummer, ein Agent oder das System hängen eine Herkunft an die
 * Operation; eine unbekannte Nummer lässt das Speichern scheitern, statt nur die Herkunft wegzulassen.
 */

describe("Herkunft: die Kopfzeile im Kontext der Anfrage", () => {
    it("liest nur genau COM- mit sechs bis zwölf Ziffern", () => {
        expect(leseHerkunft("COM-000123")).toBe(123);
        expect(leseHerkunft(" COM-000123 ")).toBe(123);
        for (const falsch of [
            "COM-123",
            "com-000123",
            "000123",
            "COM-000123x",
            "COM--000123",
            "",
            undefined,
            ["COM-000123"],
        ]) {
            expect(leseHerkunft(falsch)).toBeUndefined();
        }
    });

    it("🔴 kommt bei einem schreibenden Aufruf mit Rumpf im Handler an, auch hinter einem asynchronen preHandler; ein GET trägt keine", async () => {
        const app = Fastify({ logger: false });
        registriereHerkunft(app);
        app.post(
            "/probe",
            {
                preHandler: async () => {
                    await new Promise((fertig) => setTimeout(fertig, 5));
                },
            },
            async () => ({ herkunft: anfrageHerkunft() ?? null }),
        );
        app.get("/probe", async () => ({ herkunft: anfrageHerkunft() ?? null }));
        await app.ready();
        try {
            const mit = await app.inject({
                method: "POST",
                url: "/probe",
                headers: { [HERKUNFT_KOPF]: "COM-000042" },
                payload: { name: "Wehrheim" },
            });
            expect(mit.json()).toEqual({ herkunft: 42 });
            const ohne = await app.inject({ method: "POST", url: "/probe", payload: { name: "Wehrheim" } });
            expect(ohne.json()).toEqual({ herkunft: null });
            const falsch = await app.inject({
                method: "POST",
                url: "/probe",
                headers: { [HERKUNFT_KOPF]: "COM-42" },
                payload: {},
            });
            expect(falsch.json()).toEqual({ herkunft: null });
            const lesen = await app.inject({
                method: "GET",
                url: "/probe",
                headers: { [HERKUNFT_KOPF]: "COM-000042" },
            });
            expect(lesen.json()).toEqual({ herkunft: null });
            // Zwei Anfragen gleichzeitig vermischen ihre Herkunft nicht.
            const [a, b] = await Promise.all([
                app.inject({ method: "POST", url: "/probe", headers: { [HERKUNFT_KOPF]: "COM-000001" }, payload: {} }),
                app.inject({ method: "POST", url: "/probe", headers: { [HERKUNFT_KOPF]: "COM-000002" }, payload: {} }),
            ]);
            expect([a.json(), b.json()]).toEqual([{ herkunft: 1 }, { herkunft: 2 }]);
        } finally {
            await app.close();
        }
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const SOURCE = "test-wi0268-c7";
const ORT = "a2680c07-0000-4000-8000-000000000001";
const op = (n: number): string => `a2680c07-0000-4000-9000-${String(n).padStart(12, "0")}`;
const PERSON: MapActor = { kind: "person", personId: "a2680c07-0000-4000-a000-000000000001", environment: "test" };
const SYSTEM: MapActor = { kind: "system", label: "probe", environment: "test" };

describeWithDatabase("Herkunft an der Kartenoperation (Migration 0272)", { timeout: 120_000 }, () => {
    let database: Database;
    let vorgang: number;

    async function aufraeumen(): Promise<void> {
        await database`DELETE FROM map_audit_event WHERE operation_id::text LIKE 'a2680c07-%'`;
        await database`DELETE FROM map_operation WHERE operation_id::text LIKE 'a2680c07-%'`;
        await database`DELETE FROM place WHERE source_system = ${SOURCE}`;
    }

    const umbenennen =
        (name: string): MapWork =>
        async (tx) => {
            await tx`UPDATE place SET name = ${name} WHERE public_id = ${ORT}::uuid`;
            return {
                receipt: { affected: [], derivedWork: [], warnings: [] },
                summary: name,
                entries: [{ action: "place.updated", placeId: ORT, changes: { name: { before: null, after: name } } }],
            };
        };

    const speichern = (n: number, actor: MapActor = PERSON) =>
        mapOperation(
            database,
            actor,
            {
                operationId: op(n),
                operation: "place.update",
                mapDomainId: "aventuria",
                body: { name: `Probe ${String(n)}` },
            },
            umbenennen(`Probe ${String(n)}`),
        );

    const herkunftVon = async (n: number): Promise<string | null | undefined> => {
        const [zeile] = await database<{ community_vorgang: string | null }[]>`
            SELECT community_vorgang::text AS community_vorgang FROM map_operation WHERE operation_id = ${op(n)}::uuid
        `;
        return zeile?.community_vorgang;
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await seedMapDomains(database);
        await aufraeumen();
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${ORT}, 'aventuria', 'C7 Probeort', 'stadt', ST_SetSRID(ST_MakePoint(611, 612), 0), ${SOURCE}, TRUE)
        `;
        vorgang = await melden(database, {
            operationId: randomUUID(),
            schluessel: randomBytes(32).toString("base64url"),
            kategorie: "lage",
            text: "Der Probeort liegt laut Regionalband weiter im Osten.",
            bezug: { art: "stelle", lage: { x: 611, y: 612 } },
        });
    });

    afterAll(async () => {
        await aufraeumen();
        await database`DELETE FROM avesmaps_community.vorgang WHERE id = ${vorgang}`.catch(() => undefined);
        await database.end({ timeout: 5 });
    });

    it("🔴 eine Person, die aus einem Vorgang speichert, hinterlässt dessen Nummer an der Operation", async () => {
        const quittung = await mitHerkunft(vorgang, () => speichern(1));
        expect(quittung.status).toBe("applied");
        expect(await herkunftVon(1)).toBe(String(vorgang));
    });

    it("ohne Kopfzeile bleibt die Herkunft leer", async () => {
        await speichern(2);
        expect(await herkunftVon(2)).toBeNull();
    });

    it("🔴 eine unbekannte Nummer speichert trotzdem, nur ohne Herkunft", async () => {
        const quittung = await mitHerkunft(999_999_999, () => speichern(3));
        expect(quittung.status).toBe("applied");
        expect(await herkunftVon(3)).toBeNull();
    });

    it("🔴 das System (oder ein Agent) trägt nie eine Herkunft", async () => {
        await mitHerkunft(vorgang, () => speichern(4, SYSTEM));
        expect(await herkunftVon(4)).toBeNull();
    });

    it("ein Replay derselben Kennung ändert die gespeicherte Herkunft nicht", async () => {
        await mitHerkunft(vorgang, () => speichern(5));
        await speichern(5);
        expect(await herkunftVon(5)).toBe(String(vorgang));
    });
});
