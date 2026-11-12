import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    editorPlaceDeleteUrl,
    editorPlaceMoveUrl,
    editorPlaceRestoreUrl,
    editorPlaceTakeOffMapUrl,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";

/**
 * Qualitätsreview 2026-10-12, Befund Q-02 gegen echtes PostgreSQL: Revisionen, Idempotenz und parallele Editoren an
 * `place.delete`, `place.restore`, `place.take_off_map` und `place.move` (Platzieren), dazu die Trigger der Migration 0115.
 *
 * Problemfälle: Dieselbe Kennung schreibt zweimal; zwei Editoren löschen gleichzeitig; Löschen und Abnehmen treffen sich; ein ↺
 * kommt zu spät, weil der Ort seitdem verändert wurde; zwei ↺ gleichzeitig; die Revision fällt beim Wechsel zwischen `place` und
 * `place_unplaced` zurück (der Fehler, den 0115 behoben hat) und das Fachprotokoll weist die nächste Operation ab.
 *
 * Soll: Höchstens eine Wirkung je Kennung (ADR-0019), 409 beim veralteten Stand (ADR-0020), streng steigende Revision über BEIDE
 * Tafeln, je Operation genau eine Zeile im Fachprotokoll mit lückenloser Revisionskette.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const SOURCE = "test-qr-nebenlaeufig";
let zaehler = 0;
const operationId = (): string => `ab220129-0000-4000-9000-${String((zaehler += 1)).padStart(12, "0")}`;
let ortZaehler = 0;
const naechsterOrt = (): string => `ab220129-0000-4000-8000-${String((ortZaehler += 1)).padStart(12, "0")}`;

describeWithDatabase("Ort entfernen: Revisionen, Idempotenz, parallele Editoren (Q-02)", { timeout: 120_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let cookie = "";

    const config: ServerConfig = {
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        auth: TEST_AUTH,
        mapEditing: "testwelt",
    };

    async function aufraeumen(): Promise<void> {
        await database`DELETE FROM job_event WHERE kind = 'map.changed'`;
        await database`DELETE FROM map_audit_event WHERE operation_id::text LIKE 'ab220129-%'`;
        await database`DELETE FROM map_operation WHERE operation_id::text LIKE 'ab220129-%'`;
        await database`DELETE FROM place WHERE source_system = ${SOURCE}`;
        await database`DELETE FROM place_unplaced WHERE source_system = ${SOURCE}`;
    }

    /** Ein frischer Ort auf der Karte, Revision 1; jeder Fall bekommt seinen eigenen. */
    async function ort(name: string): Promise<string> {
        const publicId = naechsterOrt();
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${publicId}::uuid, 'aventuria', ${name}, 'dorf', ST_SetSRID(ST_MakePoint(461, 465), 0), ${SOURCE}, TRUE)
        `;
        return publicId;
    }

    const post = (url: string, payload: object): Promise<LightMyRequestResponse> =>
        app.inject({ method: "POST", url, headers: { cookie, origin: TEST_ORIGIN }, payload });

    const revisionVon = async (publicId: string): Promise<{ karte: number | null; ohneLage: number | null }> => {
        const [zeilen] = await database<{ karte: number | null; ohneLage: number | null }[]>`
            SELECT (SELECT revision::int FROM place WHERE public_id = ${publicId}::uuid) AS karte,
                   (SELECT revision::int FROM place_unplaced WHERE public_id = ${publicId}::uuid) AS "ohneLage"
        `;
        return zeilen ?? { karte: null, ohneLage: null };
    };

    const protokoll = (publicId: string) =>
        database<{ action: string; revision_before: number | null; revision_after: number | null }[]>`
            SELECT action, revision_before::int AS revision_before, revision_after::int AS revision_after
              FROM map_audit_event WHERE place_public_id = ${publicId}::uuid ORDER BY id
        `;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 8 });
        await migrate(database);
        await aufraeumen();
        const fixture = authFixture(database);
        const person = await fixture.person("editor", { name: "QR Nebenlaeufig" });
        cookie = (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie;
        app = buildApp({
            config,
            database: createDatabase(testDatabaseUrl as string, { max: 8 }),
            logStream: { write: () => undefined },
        });
        await app.ready();
    });

    afterAll(async () => {
        await app?.close();
        await aufraeumen();
        await database.end({ timeout: 5 });
    });

    it("🔴 Q-02 dieselbe Kennung wirkt genau einmal (replayed), anderer Inhalt mit derselben Kennung wird abgewiesen", async () => {
        const id = await ort("QR Idempotenz");
        const kennung = operationId();
        const erste = await post(editorPlaceDeleteUrl(id), { operationId: kennung, baseRevision: 1 });
        expect(erste.statusCode).toBe(200);
        expect(erste.json<OperationReceipt>().status).toBe("applied");
        const zweite = await post(editorPlaceDeleteUrl(id), { operationId: kennung, baseRevision: 1 });
        expect(zweite.statusCode).toBe(200);
        expect(zweite.json<OperationReceipt>().status).toBe("replayed");
        expect(zweite.json<OperationReceipt>().affected).toEqual(erste.json<OperationReceipt>().affected);
        // Dieselbe Kennung mit anderem Inhalt: 409, und sie wirkt nicht.
        const anders = await post(editorPlaceDeleteUrl(id), { operationId: kennung, baseRevision: 2 });
        expect(anders.statusCode).toBe(409);
        expect(anders.json()).toMatchObject({ error: { code: "idempotency_key_reused" } });
        expect((await protokoll(id)).map((zeile) => zeile.action)).toEqual(["place.deleted"]);
    });

    it("🔴 Q-02 zwei gleichzeitige Löschungen mit verschiedenen Kennungen: eine wirkt, die andere bekommt 409 oder 400", async () => {
        const id = await ort("QR Zwei Editoren");
        const [a, b] = await Promise.all([
            post(editorPlaceDeleteUrl(id), { operationId: operationId(), baseRevision: 1 }),
            post(editorPlaceDeleteUrl(id), { operationId: operationId(), baseRevision: 1 }),
        ]);
        const codes = [a!.statusCode, b!.statusCode].sort((x, y) => x - y);
        expect(codes[0]).toBe(200);
        expect([400, 409]).toContain(codes[1]);
        expect((await protokoll(id)).map((zeile) => zeile.action)).toEqual(["place.deleted"]);
        const [zeile] = await database<{ aktiv: boolean }[]>`
            SELECT is_active AS aktiv FROM place WHERE public_id = ${id}::uuid
        `;
        expect(zeile!.aktiv).toBe(false);
    });

    it("🔴 Q-02 Löschen und Abnehmen gleichzeitig: nur eines wirkt, der Ort steht danach in genau einer Tafel aktiv", async () => {
        const id = await ort("QR Loeschen und Abnehmen");
        const [a, b] = await Promise.all([
            post(editorPlaceDeleteUrl(id), { operationId: operationId(), baseRevision: 1 }),
            post(editorPlaceTakeOffMapUrl(id), { operationId: operationId(), baseRevision: 1, staetten: "bleiben" }),
        ]);
        const codes = [a!.statusCode, b!.statusCode].sort((x, y) => x - y);
        expect(codes[0]).toBe(200);
        expect([400, 409]).toContain(codes[1]);
        const [stand] = await database<{ n: number }[]>`
            SELECT ((SELECT count(*) FROM place WHERE public_id = ${id}::uuid AND is_active)
                    + (SELECT count(*) FROM place_unplaced WHERE public_id = ${id}::uuid AND is_active))::int AS n
        `;
        expect(stand!.n).toBeLessThanOrEqual(1);
        expect((await protokoll(id)).length).toBe(1);
    });

    it("🔴 Q-02 ein ↺ nach einer weiteren Änderung ist zu spät (409); zwei gleichzeitige ↺ holen den Ort genau einmal zurück", async () => {
        const id = await ort("QR Zurueckholen");
        const geloescht = operationId();
        expect((await post(editorPlaceDeleteUrl(id), { operationId: geloescht, baseRevision: 1 })).statusCode).toBe(
            200,
        );
        // Jemand verändert die gelöschte Zeile seitdem: die Revision passt nicht mehr zu der des Löschens.
        await database`UPDATE place SET name = 'QR Zurueckholen spaeter' WHERE public_id = ${id}::uuid`;
        const zuSpaet = await post(editorPlaceRestoreUrl(id), { operationId: operationId(), reverts: geloescht });
        expect(zuSpaet.statusCode).toBe(409);
        expect(zuSpaet.json()).toMatchObject({ error: { code: "edit_conflict" } });
        // Nach einem neuen Löschen passt die Revision wieder; zwei gleichzeitige ↺ führen zu genau einer Wirkung.
        const [jetzt] = await database<{ revision: number }[]>`
            SELECT revision::int AS revision FROM place WHERE public_id = ${id}::uuid
        `;
        await database`UPDATE place SET is_active = TRUE WHERE public_id = ${id}::uuid`;
        const nochmal = operationId();
        expect(
            (await post(editorPlaceDeleteUrl(id), { operationId: nochmal, baseRevision: jetzt!.revision + 1 }))
                .statusCode,
        ).toBe(200);
        const [a, b] = await Promise.all([
            post(editorPlaceRestoreUrl(id), { operationId: operationId(), reverts: nochmal }),
            post(editorPlaceRestoreUrl(id), { operationId: operationId(), reverts: nochmal }),
        ]);
        const codes = [a!.statusCode, b!.statusCode].sort((x, y) => x - y);
        expect(codes[0]).toBe(200);
        expect([400, 409]).toContain(codes[1]);
        expect((await protokoll(id)).filter((zeile) => zeile.action === "place.restored").length).toBe(1);
    });

    it("🔴 Q-02 die Revision steigt über place und place_unplaced streng (0115), das Protokoll bleibt lückenlos", async () => {
        const id = await ort("QR Revisionskette");
        const schritte: number[] = [];
        const nimm = async (antwort: LightMyRequestResponse): Promise<void> => {
            expect(antwort.statusCode).toBe(200);
            const revision = antwort.json<OperationReceipt>().affected[0]?.revision;
            expect(typeof revision).toBe("number");
            schritte.push(revision as number);
        };
        const stand = async (): Promise<number> => {
            const beide = await revisionVon(id);
            return Math.max(beide.karte ?? 0, beide.ohneLage ?? 0);
        };

        await nimm(
            await post(editorPlaceTakeOffMapUrl(id), {
                operationId: operationId(),
                baseRevision: 1,
                staetten: "bleiben",
            }),
        );
        // Ohne Lage bearbeiten, damit die beiden Tafeln auseinanderlaufen (genau der Fall aus 0115).
        await database`UPDATE place_unplaced SET name = 'QR Revisionskette ohne Lage' WHERE public_id = ${id}::uuid`;
        const nachBearbeitung = await stand();
        await nimm(
            await post(editorPlaceMoveUrl(id), {
                operationId: operationId(),
                baseRevision: nachBearbeitung,
                to: { x: 462, y: 466 },
                pathEnds: [],
            }),
        );
        const platziert = await stand();
        const geloescht = operationId();
        await nimm(await post(editorPlaceDeleteUrl(id), { operationId: geloescht, baseRevision: platziert }));
        await nimm(await post(editorPlaceRestoreUrl(id), { operationId: operationId(), reverts: geloescht }));

        // Jede Operation hob die Revision des Objekts; nichts fiel zurück.
        expect(schritte).toEqual([...schritte].sort((x, y) => x - y));
        expect(new Set(schritte).size).toBe(schritte.length);
        expect(schritte[0]).toBeGreaterThan(1);
        const zeilen = await protokoll(id);
        expect(zeilen.map((zeile) => zeile.action)).toEqual([
            "place.taken_off_map",
            "place.placed",
            "place.deleted",
            "place.restored",
        ]);
        for (const zeile of zeilen) {
            expect(zeile.revision_after).toBeGreaterThan(zeile.revision_before ?? 0);
        }
        // Die Kette im Protokoll: nachher der einen Zeile ist nie größer als vorher der nächsten.
        for (let index = 1; index < zeilen.length; index += 1) {
            expect(zeilen[index]!.revision_before).toBeGreaterThanOrEqual(zeilen[index - 1]!.revision_after ?? 0);
        }
    });
});
