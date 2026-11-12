import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { editorPlaceUrl, type EditorPlaceDetail } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";

/**
 * Der Name des Orts als Wiki-Feld (WI-0225; Orchestrierung 2026-10-18: am Ort gilt Legacy, und Legacy hatte den Namen mit Wiki-Wert)
 * gegen echtes PostgreSQL (`avesmaps3d_test`).
 *
 * Problemfälle: ↺ setzt den Namen, aber nicht die Herkunft wiki; ein getippter Name, der wie der Wiki-Name lautet, gilt als wiki; ↺ ohne
 * Wiki-Namen schreibt etwas; das Detail nennt einen Wiki-Namen, obwohl der Ort keinen Artikel hat.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const SOURCE = "test-wi0225-name";
const ORT = "e225e225-0000-4000-8000-000000000001";
const OHNE = "e225e225-0000-4000-8000-000000000002";
const WIKI_KEY = "wi0225-name-probe";
let zaehler = 0;
const operationId = (): string => `e225e225-0000-4000-9000-${String((zaehler += 1)).padStart(12, "0")}`;

describeWithDatabase("Der Name des Orts als Wiki-Feld (WI-0225)", { timeout: 120_000 }, () => {
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
        await database`DELETE FROM map_audit_event WHERE operation_id::text LIKE 'e225e225-%'`;
        await database`DELETE FROM map_operation WHERE operation_id::text LIKE 'e225e225-%'`;
        await database`DELETE FROM field_origin WHERE object_kind = 'place' AND object_id IN (${ORT}::uuid, ${OHNE}::uuid)`;
        await database`DELETE FROM place_wiki_assignment WHERE place_id IN (SELECT id FROM place WHERE source_system = ${SOURCE})`;
        await database`DELETE FROM wiki_settlement_snapshot WHERE wiki_key = ${WIKI_KEY}`;
        await database`DELETE FROM place WHERE source_system = ${SOURCE}`;
    }

    const detail = async (id: string): Promise<EditorPlaceDetail> =>
        (await app.inject({ method: "GET", url: editorPlaceUrl(id), headers: { cookie } })).json<EditorPlaceDetail>();
    const patch = (id: string, body: object) =>
        app.inject({
            method: "PATCH",
            url: editorPlaceUrl(id),
            headers: { cookie, origin: TEST_ORIGIN },
            payload: body,
        });

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await aufraeumen();
        const fixture = authFixture(database);
        const person = await fixture.person("editor", { name: "Name editor" });
        cookie = (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie;
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${ORT}, 'aventuria', 'E225 Rhondur', 'kleinstadt', ST_SetSRID(ST_MakePoint(441, 442), 0), ${SOURCE}, TRUE),
                   (${OHNE}, 'aventuria', 'E225 Ohne Artikel', 'dorf', ST_SetSRID(ST_MakePoint(445, 446), 0), ${SOURCE}, TRUE)
        `;
        const [snapshot] = await database<{ id: string }[]>`
            INSERT INTO wiki_settlement_snapshot (wiki_key, wiki_url, wiki_title, wiki_name, settlement_class, settlement_class_guessed,
                                                  synced_at)
            VALUES (${WIKI_KEY}, 'https://de.wiki-aventurica.de/wiki/E225', 'E225', 'E225 Rhôndur', 'stadt', FALSE, now())
            RETURNING id::text
        `;
        await database`
            INSERT INTO place_wiki_assignment (place_id, wiki_url, snapshot_id, assignment_state, assignment_origin)
            SELECT id, 'https://de.wiki-aventurica.de/wiki/E225', ${snapshot!.id}, 'assigned', 'unknown' FROM place WHERE public_id = ${ORT}
        `;
        app = buildApp({
            config,
            database: createDatabase(testDatabaseUrl as string, { max: 4 }),
            logStream: { write: () => undefined },
        });
        await app.ready();
    });

    afterAll(async () => {
        await app?.close();
        await aufraeumen();
        await database.end({ timeout: 5 });
    });

    it("das Detail nennt den Wiki-Namen nur mit Artikel", async () => {
        expect((await detail(ORT)).nameWiki).toBe("E225 Rhôndur");
        expect((await detail(OHNE)).nameWiki).toBeUndefined();
    });

    it("🔴 ↺ setzt Name UND Herkunft wiki; getippt ist manual, auch beim Wortlaut des Wiki; das Protokoll nennt beides", async () => {
        const zurueck = await patch(ORT, {
            operationId: operationId(),
            baseRevision: 1,
            changes: { name: { revert: "wiki" } },
        });
        expect(zurueck.statusCode).toBe(200);
        let ort = await detail(ORT);
        expect(ort).toMatchObject({ name: "E225 Rhôndur", revision: 2, herkunft: { name: "wiki" } });
        const getippt = await patch(ORT, {
            operationId: operationId(),
            baseRevision: 2,
            changes: { name: "E225 Rhondur" },
        });
        expect(getippt.statusCode).toBe(200);
        const wortlaut = await patch(ORT, {
            operationId: operationId(),
            baseRevision: 3,
            changes: { name: "E225 Rhôndur" },
        });
        expect(wortlaut.statusCode).toBe(200);
        ort = await detail(ORT);
        expect(ort).toMatchObject({ name: "E225 Rhôndur", revision: 4, herkunft: { name: "manual" } });
        const protokoll = await database<{ changes: Record<string, unknown> }[]>`
            SELECT e.changes FROM map_audit_event e WHERE e.place_public_id = ${ORT} ORDER BY e.revision_after
        `;
        expect(protokoll.map((zeile) => zeile.changes)).toEqual([
            { name: { before: "E225 Rhondur", after: "E225 Rhôndur" }, nameOrigin: { before: null, after: "wiki" } },
            {
                name: { before: "E225 Rhôndur", after: "E225 Rhondur" },
                nameOrigin: { before: "wiki", after: "manual" },
            },
            { name: { before: "E225 Rhondur", after: "E225 Rhôndur" } },
        ]);
    });

    it("🔴 Ortsgröße: ↺ setzt die des Wiki samt Herkunft; geraten oder ein „dorf“ ohne Kennzeichen ist unbekannt (Legacys Regel)", async () => {
        let ort = await detail(ORT);
        expect(ort.subtypeWiki).toBe("stadt");
        const zurueck = await patch(ORT, {
            operationId: operationId(),
            baseRevision: ort.revision,
            changes: { subtype: { revert: "wiki" } },
        });
        expect(zurueck.statusCode).toBe(200);
        ort = await detail(ORT);
        expect(ort).toMatchObject({ subtype: "stadt", herkunft: { name: "manual", subtype: "wiki" } });
        await database`UPDATE wiki_settlement_snapshot SET settlement_class_guessed = TRUE WHERE wiki_key = ${WIKI_KEY}`;
        expect((await detail(ORT)).subtypeWiki).toBeUndefined();
        await database`
            UPDATE wiki_settlement_snapshot SET settlement_class = 'dorf', settlement_class_guessed = NULL WHERE wiki_key = ${WIKI_KEY}
        `;
        expect((await detail(ORT)).subtypeWiki).toBeUndefined();
        await database`UPDATE wiki_settlement_snapshot SET settlement_class_guessed = FALSE WHERE wiki_key = ${WIKI_KEY}`;
        expect((await detail(ORT)).subtypeWiki).toBe("dorf");
        // Ohne Wiki-Wert nimmt der Server ↺ nicht an.
        await database`UPDATE wiki_settlement_snapshot SET settlement_class = NULL WHERE wiki_key = ${WIKI_KEY}`;
        const ohne = await patch(ORT, {
            operationId: operationId(),
            baseRevision: ort.revision,
            changes: { subtype: { revert: "wiki" } },
        });
        expect(ohne.statusCode).toBe(400);
    });

    it("🔴 ↺ ohne Wiki-Namen schreibt nichts (400)", async () => {
        const ohne = await patch(OHNE, {
            operationId: operationId(),
            baseRevision: 1,
            changes: { name: { revert: "wiki" } },
        });
        expect(ohne.statusCode).toBe(400);
        expect((await detail(OHNE)).revision).toBe(1);
    });
});
