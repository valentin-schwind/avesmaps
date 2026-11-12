import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    EDITOR_POWERLINES_SAMMEL_STAND_URL,
    EDITOR_POWERLINES_SAMMEL_WIKI_URL,
    EDITOR_POWERLINES_URL,
    type EditorPowerlineDetail,
    type OperationReceipt,
    type PowerlineSammelLinie,
    type Role,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";

/**
 * Mehrere Kraftlinien auf einmal (WI-0238; EDIT-0003 T57). Problemfälle: Jede Linie wird eine eigene Operation (der Verlauf nimmt sie nicht
 * zusammen zurück); ein Konflikt an EINER Linie lässt die übrigen geschrieben zurück; eine Linie im falschen Stand geht still mit; ↺ auf
 * Wiki-Werte setzt die Herkunft nicht oder schreibt ohne Artikel einen leeren Namen; ein Reviewer darf es.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const SOURCE = "test-wi0238-sammel";
const P = "b8b8b8b8-0000-4000-8000-";
const L = {
    eins: `${P}0000000000a1`,
    einsB: `${P}0000000000a2`,
    zwei: `${P}0000000000b1`,
    drei: `${P}0000000000c1`,
    wiki: `${P}0000000000d1`,
    ohneWiki: `${P}0000000000e1`,
};
/** Zwei Nodices, an denen jede Linie hängt: Ohne sie käme keine zurück auf die Karte. */
const N = { a: `${P}0000000000f1`, b: `${P}0000000000f2` };
const SCHLUESSEL = "k-test-wi0238-sammelader";

describeWithDatabase("Mehrere Kraftlinien auf einmal (WI-0238)", { timeout: 120_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let fixture: ReturnType<typeof authFixture>;
    const cookies = new Map<Role, string>();

    const OPERATIONEN = ["powerline.update_line", "powerline.retire", "powerline.restore", "powerline.take_off_map"];
    async function aufraeumen(): Promise<void> {
        const ids = Object.values(L);
        await database`
            DELETE FROM map_audit_event WHERE operation_id IN (
                SELECT DISTINCT e.operation_id FROM map_audit_event e WHERE e.powerline_public_id = ANY(${ids}::uuid[]))
        `;
        await database`
            DELETE FROM map_operation o WHERE o.action = ANY(${OPERATIONEN}) AND NOT EXISTS (
                SELECT 1 FROM map_audit_event e WHERE e.operation_id = o.operation_id)
        `;
        await database`
            DELETE FROM powerline_wiki_assignment WHERE powerline_id IN (SELECT id FROM powerline WHERE source_system = ${SOURCE})
        `;
        await database`DELETE FROM wiki_powerline_snapshot WHERE wiki_key = ${SCHLUESSEL}`;
        await database`DELETE FROM field_origin WHERE object_kind = 'powerline' AND object_id = ANY(${ids}::uuid[])`;
        await database`DELETE FROM powerline WHERE source_system = ${SOURCE}`;
        await database`DELETE FROM place WHERE source_system = ${SOURCE}`;
    }
    const linie = (id: string, name: string) => database`
        INSERT INTO powerline (public_id, map_domain_id, name, label_visible, from_public_id, to_public_id, geom, drawn_geom, source_system)
        VALUES (${id}, 'aventuria', ${name}, TRUE, ${N.a}, ${N.b},
                ST_GeomFromText('LINESTRING(100 500, 300 500)', 0), ST_GeomFromText('LINESTRING(100 500, 300 500)', 0), ${SOURCE})
    `;
    const detail = async (id: string): Promise<EditorPowerlineDetail> =>
        (
            await app.inject({
                method: "GET",
                url: `${EDITOR_POWERLINES_URL}/${id}`,
                headers: { cookie: cookies.get("editor") ?? "" },
            })
        ).json<EditorPowerlineDetail>();
    /** Eine Linie, wie die Auswahl sie zuletzt sah. */
    const gesehen = async (anker: string): Promise<PowerlineSammelLinie> => ({
        anker,
        segments: (await detail(anker)).segments.map((s) => ({ id: s.id, baseRevision: s.revision })),
    });
    const sende = (url: string, payload: Record<string, unknown>, role: Role = "editor") =>
        app.inject({
            method: "POST",
            url,
            headers: { cookie: cookies.get(role) ?? "", origin: TEST_ORIGIN },
            payload: { operationId: randomUUID(), ...payload },
        });
    const operationen = (operationId: string) => database<{ action: string; source: string; n: number }[]>`
        SELECT o.action, o.source, (SELECT count(*)::int FROM map_audit_event e WHERE e.operation_id = o.operation_id) AS n
          FROM map_operation o WHERE o.operation_id = ${operationId}
    `;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await aufraeumen();
        fixture = authFixture(database);
        for (const role of ["reviewer", "editor"] as const) {
            const person = await fixture.person(role, { name: `Sammel ${role}` });
            cookies.set(role, (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie);
        }
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, is_nodix, source_system)
            VALUES (${N.a}, 'aventuria', 'WI0238 Nodix A', 'dorf', ST_SetSRID(ST_MakePoint(100, 500), 0), TRUE, ${SOURCE}),
                   (${N.b}, 'aventuria', 'WI0238 Nodix B', 'dorf', ST_SetSRID(ST_MakePoint(300, 500), 0), TRUE, ${SOURCE})
        `;
        await linie(L.eins, "WI0238 Eins");
        await linie(L.einsB, "WI0238 Eins");
        await linie(L.zwei, "WI0238 Zwei");
        await linie(L.drei, "WI0238 Drei");
        await linie(L.wiki, "WI0238 Alter Name");
        await linie(L.ohneWiki, "WI0238 Ohne Artikel");
        const [abzug] = await database<{ id: string }[]>`
            INSERT INTO wiki_powerline_snapshot (wiki_key, wiki_url, name, description, staerke, affinitaet, laenge, regionen)
            VALUES (${SCHLUESSEL}, 'https://de.wiki-aventurica.de/wiki/WI0238', 'WI0238 Sammelader', 'Aus dem Wiki.', NULL, NULL, NULL, NULL)
            RETURNING id::text
        `;
        await database`
            INSERT INTO powerline_wiki_assignment (powerline_id, wiki_url, snapshot_id, assignment_state, assignment_origin)
            SELECT id, 'https://de.wiki-aventurica.de/wiki/WI0238', ${abzug!.id}::bigint, 'assigned', 'unknown'
              FROM powerline WHERE public_id = ${L.wiki}::uuid
        `;
        await database`UPDATE powerline SET description = 'Eigene Zeile.' WHERE public_id = ANY(${[L.wiki, L.ohneWiki]}::uuid[])`;
        app = buildApp({
            config: {
                port: 0,
                host: "127.0.0.1",
                releaseId: "test",
                databaseUrl: undefined,
                tileRoot: undefined,
                auth: TEST_AUTH,
                mapEditing: "testwelt",
            } satisfies ServerConfig,
            database: createDatabase(testDatabaseUrl as string, { max: 4 }),
            logStream: { write: () => undefined },
        });
        await app.ready();
    }, 120_000);

    afterAll(async () => {
        await app?.close();
        await aufraeumen();
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    it("🔴 als Reviewer 403, ohne Anmeldung 401; nichts geschrieben", async () => {
        const lines = [await gesehen(L.eins)];
        expect(
            (await sende(EDITOR_POWERLINES_SAMMEL_STAND_URL, { wechsel: "powerline.retire", lines }, "reviewer"))
                .statusCode,
        ).toBe(403);
        expect(
            (
                await app.inject({
                    method: "POST",
                    url: EDITOR_POWERLINES_SAMMEL_STAND_URL,
                    headers: { origin: TEST_ORIGIN },
                    payload: { operationId: randomUUID(), wechsel: "powerline.retire", lines },
                })
            ).statusCode,
        ).toBe(401);
        expect((await detail(L.eins)).state).toBeUndefined();
    });

    it("🔴 💣 ein Konflikt an EINER Linie lässt auch die andere stehen (eine Transaktion), 409", async () => {
        const eins = await gesehen(L.eins);
        const zwei = await gesehen(L.zwei);
        const veraltet = { ...zwei, segments: zwei.segments.map((s) => ({ ...s, baseRevision: s.baseRevision + 7 })) };
        const res = await sende(EDITOR_POWERLINES_SAMMEL_STAND_URL, {
            wechsel: "powerline.retire",
            lines: [eins, veraltet],
        });
        expect(res.statusCode).toBe(409);
        expect((await detail(L.eins)).state).toBeUndefined();
        expect((await detail(L.zwei)).state).toBeUndefined();
    });

    it("🔴 „Entfernen“ für zwei Linien ist EINE Operation `powerline.retire` mit einem Eintrag je Abschnitt; ↺ holt beide zusammen zurück", async () => {
        const lines = [await gesehen(L.eins), await gesehen(L.zwei)];
        const res = await sende(EDITOR_POWERLINES_SAMMEL_STAND_URL, { wechsel: "powerline.retire", lines });
        expect(res.statusCode).toBe(200);
        const quittung = res.json<OperationReceipt>();
        expect(quittung.affected.map((a) => a.id).sort()).toEqual([L.eins, L.einsB, L.zwei].sort());
        expect(await operationen(quittung.operationId)).toEqual([
            { action: "powerline.retire", source: "editor", n: 3 },
        ]);
        expect((await detail(L.eins)).state).toBe("geloescht");
        expect((await detail(L.zwei)).state).toBe("geloescht");

        const zurueck = [await gesehen(L.eins), await gesehen(L.zwei)];
        const wieder = await sende(EDITOR_POWERLINES_SAMMEL_STAND_URL, {
            wechsel: "powerline.restore",
            lines: zurueck,
            reverts: quittung.operationId,
        });
        expect(wieder.statusCode).toBe(200);
        expect(await operationen(wieder.json<OperationReceipt>().operationId)).toEqual([
            { action: "powerline.restore", source: "restore", n: 3 },
        ]);
        expect((await detail(L.eins)).state).toBeUndefined();
        expect((await detail(L.zwei)).state).toBeUndefined();
    });

    it("🔴 eine Linie im falschen Stand nennt sich, und nichts wird geschrieben (400)", async () => {
        const drei = await gesehen(L.drei);
        expect(
            (await sende(EDITOR_POWERLINES_SAMMEL_STAND_URL, { wechsel: "powerline.retire", lines: [drei] }))
                .statusCode,
        ).toBe(200);
        const res = await sende(EDITOR_POWERLINES_SAMMEL_STAND_URL, {
            wechsel: "powerline.retire",
            lines: [await gesehen(L.eins), await gesehen(L.drei)],
        });
        expect(res.statusCode).toBe(400);
        expect(res.json<{ error: { message: string } }>().error.message).toContain("„WI0238 Drei“");
        expect((await detail(L.eins)).state).toBeUndefined();
    });

    it("🔴 ↺ auf Wiki-Werte: Name des Artikels, Beschreibung leer und folgt dem Wiki, Herkunft wiki; EINE Operation", async () => {
        const res = await sende(EDITOR_POWERLINES_SAMMEL_WIKI_URL, {
            felder: ["name", "description"],
            lines: [await gesehen(L.wiki)],
        });
        expect(res.statusCode).toBe(200);
        const quittung = res.json<OperationReceipt>();
        expect(await operationen(quittung.operationId)).toEqual([
            { action: "powerline.update_line", source: "editor", n: 1 },
        ]);
        const nach = await detail(L.wiki);
        expect(nach.name).toBe("WI0238 Sammelader");
        expect(nach.segments[0]?.description ?? null).toBeNull();
        expect(nach.segments[0]?.herkunft).toEqual({ name: "wiki", description: "wiki" });
        const [eintrag] = await database<{ changes: Record<string, unknown> }[]>`
            SELECT changes FROM map_audit_event WHERE operation_id = ${quittung.operationId}
        `;
        expect(eintrag!.changes).toEqual({
            name: { before: "WI0238 Alter Name", after: "WI0238 Sammelader" },
            nameOrigin: { before: null, after: "wiki" },
            description: { before: "Eigene Zeile.", after: null },
            descriptionOrigin: { before: null, after: "wiki" },
        });
    });

    it("🔴 💣 ohne Artikel kein Wiki-Wert: Diese Linie behält Name und Beschreibung; hat keine einen, 400", async () => {
        const res = await sende(EDITOR_POWERLINES_SAMMEL_WIKI_URL, {
            felder: ["name", "description"],
            lines: [await gesehen(L.zwei), await gesehen(L.ohneWiki)],
        });
        expect(res.statusCode).toBe(400);
        expect(res.json<{ error: { message: string } }>().error.message).toContain("Wiki-Wert");
        expect((await detail(L.ohneWiki)).segments[0]?.description).toBe("Eigene Zeile.");
        // Gemischt: Die Linie mit Artikel folgt dem Wiki, die ohne behält beides, und die Operation nennt nur die eine.
        await database`
            UPDATE powerline SET name = 'WI0238 Alter Name', description = 'Wieder eigen.' WHERE public_id = ${L.wiki}::uuid
        `;
        const gemischt = await sende(EDITOR_POWERLINES_SAMMEL_WIKI_URL, {
            felder: ["name", "description"],
            lines: [await gesehen(L.wiki), await gesehen(L.ohneWiki)],
        });
        expect(gemischt.statusCode).toBe(200);
        const mit = await detail(L.wiki);
        expect(mit.name).toBe("WI0238 Sammelader");
        expect(mit.segments[0]?.description ?? null).toBeNull();
        const ohne = await detail(L.ohneWiki);
        expect(ohne.name).toBe("WI0238 Ohne Artikel");
        expect(ohne.segments[0]?.description).toBe("Eigene Zeile.");
        expect(await operationen(gemischt.json<OperationReceipt>().operationId)).toEqual([
            { action: "powerline.update_line", source: "editor", n: 1 },
        ]);
    });
});
