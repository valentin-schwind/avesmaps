import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { SubjectDetail, editorPathUpdateUrl } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";

/**
 * Die Infobox eines Wegs mit geteilten Abschnitten (WI-0302; Vali 2026-11-10, Option „Ja, mitzählen“) gegen echtes PostgreSQL (`avesmaps3d_test`).
 *
 * Die kleine Welt: Der Sikramstieg (drei Abschnitte, West nach Ost) führt über Sibur und Radoleth; der Goldfelser Stieg (ein Abschnitt) zweigt in Radoleth nach Goldfels ab.
 * Der mittlere Abschnitt des Sikramstiegs (Sibur → Radoleth) bekommt im Wegeditor „Goldfelser Stieg“ als weiteren Straßennamen.
 *
 * Problemfälle: Der geteilte Abschnitt zählt nicht zum Goldfelser Stieg (Verlauf und Orte enden in Radoleth); die Infobox nennt die andere Straße nicht; „Anzeigen“ lässt den
 * geteilten Abschnitt dunkel; die zwischengespeicherte Antwort bleibt nach dem Speichern alt; mit zwei geteilten Abschnitten heißt der Goldfelser Stieg wie der Sikramstieg.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const SOURCE = "test-wi0302-infobox";
const P = "a3020302-0000-4000-8000-";
const G = {
    s1: `${P}000000000a01`,
    s2: `${P}000000000a02`,
    s3: `${P}000000000a03`,
    g1: `${P}000000000b01`,
    sibur: `${P}000000000c01`,
    radoleth: `${P}000000000c02`,
    goldfels: `${P}000000000c03`,
} as const;
const WEGE = [G.s1, G.s2, G.s3, G.g1];

let zaehler = 0;
const operationId = (): string => `a3020302-0000-4000-9000-${String((zaehler += 1)).padStart(12, "0")}`;

describeWithDatabase("Infobox: geteilte Abschnitte zählen mit (WI-0302)", { timeout: 120_000 }, () => {
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
        await database`DELETE FROM job_event WHERE kind = 'map.changed' AND payload::text LIKE ${`%${P}%`}`;
        await database`DELETE FROM map_audit_event WHERE operation_id::text LIKE 'a3020302-0000-4000-9000-%'`;
        await database`DELETE FROM map_operation WHERE operation_id::text LIKE 'a3020302-0000-4000-9000-%'`;
        await database`DELETE FROM editor_lock WHERE object_kind = 'path' AND object_id = ANY(${WEGE}::uuid[])`;
        await database`DELETE FROM field_origin WHERE object_kind = 'path' AND object_id = ANY(${WEGE}::uuid[])`;
        await database`DELETE FROM path_wiki_assignment WHERE path_id IN (SELECT id FROM path WHERE source_system = ${SOURCE})`;
        await database`DELETE FROM path WHERE source_system = ${SOURCE}`;
        await database`DELETE FROM place WHERE source_system = ${SOURCE}`;
        await database`DELETE FROM wiki_path_snapshot WHERE wiki_key LIKE 'w302i-%'`;
    }

    const hole = async (anker: string, wiki: string): Promise<SubjectDetail> => {
        const antwort = await app.inject({ url: `/api/subjects/path/${anker}?wiki=${wiki}` });
        expect(antwort.statusCode, antwort.body).toBe(200);
        const detail = antwort.json<SubjectDetail>();
        expect(Value.Check(SubjectDetail, detail)).toBe(true);
        return detail;
    };
    const revision = async (id: string): Promise<number> =>
        (await database<{ r: number }[]>`SELECT revision::int AS r FROM path WHERE public_id = ${id}::uuid`)[0]!.r;
    /** „Fertig“ am Sikramstieg: die weiteren Straßennamen je Abschnitt. */
    const speichere = async (weitere: Partial<Record<string, string[]>>) => {
        const antwort = await app.inject({
            method: "POST",
            url: editorPathUpdateUrl(G.s1),
            headers: { cookie, origin: TEST_ORIGIN },
            payload: {
                operationId: operationId(),
                sections: await Promise.all(
                    [G.s1, G.s2, G.s3].map(async (id) => ({
                        publicId: id,
                        baseRevision: await revision(id),
                        ...(weitere[id] === undefined ? {} : { weitere: weitere[id] }),
                    })),
                ),
            },
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await aufraeumen();
        const abschnitt = (id: string, name: string, linie: string) => database`
            INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system, is_active)
            VALUES (${id}, 'aventuria', ${name}, 'Strasse', TRUE, FALSE, ST_GeomFromText(${linie}, 0), ${SOURCE}, TRUE)
        `;
        await abschnitt(G.s1, "W302i Sikramstieg", "LINESTRING(940 760, 950 760)");
        await abschnitt(G.s2, "W302i Sikramstieg", "LINESTRING(950 760, 960 760)");
        await abschnitt(G.s3, "W302i Sikramstieg", "LINESTRING(960 760, 970 760)");
        await abschnitt(G.g1, "W302i Goldfelser Stieg", "LINESTRING(960 760, 965 750)");
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${G.sibur}, 'aventuria', 'W302i Sibur', 'dorf', ST_SetSRID(ST_MakePoint(950, 760), 0), ${SOURCE}, TRUE),
                   (${G.radoleth}, 'aventuria', 'W302i Radoleth', 'dorf', ST_SetSRID(ST_MakePoint(960, 760), 0), ${SOURCE}, TRUE),
                   (${G.goldfels}, 'aventuria', 'W302i Goldfels', 'dorf', ST_SetSRID(ST_MakePoint(965, 750), 0), ${SOURCE}, TRUE)
        `;
        for (const [key, name, ids] of [
            ["w302i-sikram", "W302i Sikramstieg", [G.s1, G.s2, G.s3]],
            ["w302i-gold", "W302i Goldfelser Stieg", [G.g1]],
        ] as const) {
            await database`
                INSERT INTO wiki_path_snapshot (wiki_key, wiki_url, name, kind)
                VALUES (${key}, ${`https://de.wiki-aventurica.de/wiki/${name.replaceAll(" ", "_")}`}, ${name}, 'strasse')
            `;
            await database`
                INSERT INTO path_wiki_assignment (path_id, role, wiki_url, snapshot_id, assignment_state)
                SELECT p.id, 'main', s.wiki_url, s.id, 'assigned'
                  FROM path p, wiki_path_snapshot s WHERE p.public_id = ANY(${[...ids]}::uuid[]) AND s.wiki_key = ${key}
            `;
        }
        const fixture = authFixture(database);
        const person = await fixture.person("editor", { name: "W302 Infobox" });
        cookie = (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie;
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
        await database?.end({ timeout: 5 });
    });

    it("🔴 der geteilte Abschnitt zählt zum Goldfelser Stieg: Verlauf und Orte, `abschnitte`, „Gemeinsam mit“; die Revision zählt nach dem Speichern, der Titel bleibt der eigene", async () => {
        const vorher = await hole(G.g1, "w302i-gold");
        expect(vorher).toMatchObject({
            title: "W302i Goldfelser Stieg",
            stretch: { from: "W302i Radoleth", to: "W302i Goldfels" },
        });
        expect(vorher.abschnitte).toEqual([G.g1]);
        expect(vorher).not.toHaveProperty("gemeinsam");

        await speichere({ [G.s2]: ["w302i-gold"] });
        const nachher = await hole(G.g1, "w302i-gold");
        // Das Detail ist neu gerechnet: Die Revision folgt der Operation an der Karte.
        expect(nachher.revision).not.toBe(vorher.revision);
        expect(nachher.title).toBe("W302i Goldfelser Stieg");
        expect(nachher.abschnitte).toEqual([G.s2, G.g1]);
        // Verlauf und Orte gehen über den geteilten Abschnitt bis Sibur.
        expect(nachher.stretch).toEqual({ from: "W302i Sibur", to: "W302i Goldfels" });
        expect(nachher.routePlaces?.map((ort) => ort.name)).toEqual([
            "W302i Sibur",
            "W302i Radoleth",
            "W302i Goldfels",
        ]);
        expect(nachher.gemeinsam).toEqual([
            {
                name: "W302i Sikramstieg",
                ref: { kind: "path", anchor: G.s1, wiki: "w302i-sikram" },
                abschnitte: 1,
                von: "W302i Sibur",
                bis: "W302i Radoleth",
            },
        ]);
        // Der Sikramstieg selbst bleibt, wie er war: Er teilt nichts mit sich.
        const sikram = await hole(G.s3, "w302i-sikram");
        expect(sikram).not.toHaveProperty("gemeinsam");
        expect(sikram.abschnitte).toEqual([G.s1, G.s2, G.s3]);

        // Zwei geteilte Abschnitte: zusammengefasst ohne „Von – Bis“; der Titel bleibt der eigene Name, auch gegen die Mehrheit der Abschnitte.
        await speichere({ [G.s1]: ["w302i-gold"] });
        const zwei = await hole(G.g1, "w302i-gold");
        expect(zwei.title).toBe("W302i Goldfelser Stieg");
        expect(zwei.gemeinsam).toEqual([
            { name: "W302i Sikramstieg", ref: { kind: "path", anchor: G.s1, wiki: "w302i-sikram" }, abschnitte: 2 },
        ]);
    });
});
