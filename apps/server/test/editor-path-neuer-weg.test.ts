import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    EDITOR_PATHS_NEUER_WEG_URL,
    editorPathRestoreSeriesUrl,
    type PathNeuerWegBody,
    type Role,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { mitgliederHash } from "../src/editor/arbeitsserie.ts";
import { migrate } from "../src/db/migrate.ts";
import { buildRouteNetwork, loadRouteGraphRows } from "../src/routing/network.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";

/**
 * „Auswahl zu neuem Weg“ (WI-0252, `path.regroup`) gegen echtes PostgreSQL (Wegwerf-Postgres von `vor-dem-push`, sonst `avesmaps3d_test`).
 *
 * Problemfälle: Ein Abschnitt bekommt den Namen nicht (der neue Weg zerfällt), der Rest der alten Straße wird mit umbenannt; die
 * Wiki-Zuordnung bleibt aktiv (der Abschnitt hinge im Infopanel weiter an seiner alten Straße) oder wird gelöscht statt still gelegt, ohne
 * Herkunft `editor` (der nächste Import legte sie wieder an); es entstehen mehrere Operationen; ein Griff wird zum Namen; die Wegfindung
 * ändert ihr Netz; ↺ holt Namen oder Zuordnungen nicht zurück oder legt einen inzwischen fremd vergebenen Namen um; ein fremd gehaltener
 * oder inzwischen geänderter Abschnitt wird überschrieben.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const SOURCE = "test-wi0252-neuer-weg";
const P = "a2520252-0000-4000-8000-0000000000";
/** Die Alte Straße mit zwei Abschnitten (der erste mit Artikel, X2 und einer weiteren Zuweisung), die Brücke mit Artikel, ein Griff. */
const A = { alt1: `${P}a1`, alt2: `${P}a2`, bruecke: `${P}b1`, griff: `${P}c1`, schon: `${P}d1` } as const;

let zaehler = 0;
const operationId = (): string => `a2520252-0000-4000-9000-${String((zaehler += 1)).padStart(8, "0")}0252`;

describeWithDatabase("„Auswahl zu neuem Weg“ (WI-0252, path.regroup)", { timeout: 120_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    const cookies = new Map<Role, string>();
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
        const ids = Object.values(A);
        await database`DELETE FROM job_event WHERE kind = 'map.changed' OR job_id IN (SELECT id FROM job WHERE kind IN ('path_profile', 'path_label_runs'))`;
        await database`DELETE FROM job WHERE kind IN ('path_profile', 'path_label_runs')`;
        await database`DELETE FROM map_audit_event WHERE operation_id::text LIKE 'a2520252-0000-4000-9000-%0252'`;
        await database`DELETE FROM map_operation WHERE operation_id::text LIKE 'a2520252-0000-4000-9000-%0252'`;
        await database`DELETE FROM editor_lock WHERE object_kind = 'path' AND object_id = ANY(${ids}::uuid[])`;
        await database`DELETE FROM field_origin WHERE object_kind = 'path' AND object_id = ANY(${ids}::uuid[])`;
        await database`DELETE FROM wiki_key_assignment WHERE object_public_id = ANY(${ids}::uuid[])`;
        await database`DELETE FROM path_wiki_assignment WHERE path_id IN (SELECT id FROM path WHERE source_system = ${SOURCE})`;
        await database`DELETE FROM wiki_path_snapshot WHERE wiki_key LIKE 'wi0252-%'`;
        await database`DELETE FROM path_visual WHERE path_id IN (SELECT id FROM path WHERE source_system = ${SOURCE})`;
        await database`DELETE FROM path WHERE source_system = ${SOURCE}`;
    }

    async function lege(): Promise<void> {
        await aufraeumen();
        const weg = (id: string, name: string, linie: string) => database`
            INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system)
            VALUES (${id}, 'aventuria', ${name}, 'Strasse', TRUE, FALSE, ST_GeomFromText(${linie}, 0), ${SOURCE})
        `;
        // Eine Kette: Alte Straße (zwei Abschnitte) bis zur Brücke, daran der Griff; ein schon benannter Weg weit weg.
        await weg(A.alt1, "NW Alte Straße", "LINESTRING(800 300, 803 300)");
        await weg(A.alt2, "NW Alte Straße", "LINESTRING(803 300, 806 300)");
        await weg(A.bruecke, "NW Brücke", "LINESTRING(806 300, 809 300)");
        await weg(A.griff, "Strasse-9252", "LINESTRING(809 300, 812 300)");
        await weg(A.schon, "NW Schon da", "LINESTRING(830 300, 833 300)");
        const artikel = async (key: string, titel: string) =>
            (
                await database<{ id: string }[]>`
                    INSERT INTO wiki_path_snapshot (wiki_key, wiki_url, name, kind, art)
                    VALUES (${key}, ${`https://de.wiki-aventurica.de/wiki/${key}`}, ${titel}, 'strasse', 'Straße')
                    RETURNING id::text AS id
                `
            )[0]!.id;
        const alt = await artikel("wi0252-alt", "NW Alte Straße");
        const weiter = await artikel("wi0252-weiter", "NW Fernweg");
        const bruecke = await artikel("wi0252-bruecke", "NW Brücke");
        const zuweise = (id: string, snapshot: string, role: "main" | "further", key: string) => database`
            INSERT INTO path_wiki_assignment (path_id, role, wiki_url, snapshot_id, assignment_state, assignment_origin)
            SELECT id, ${role}, ${`https://de.wiki-aventurica.de/wiki/${key}`}, ${snapshot}::bigint, 'assigned', 'legacy_editor'
              FROM path WHERE public_id = ${id}::uuid
        `;
        await zuweise(A.alt1, alt, "main", "wi0252-alt");
        await zuweise(A.alt1, weiter, "further", "wi0252-weiter");
        await zuweise(A.alt2, alt, "main", "wi0252-alt");
        await zuweise(A.bruecke, bruecke, "main", "wi0252-bruecke");
        for (const [id, key] of [
            [A.alt1, "wiki:wi0252-alt"],
            [A.alt2, "wiki:wi0252-alt"],
            [A.bruecke, "wiki:wi0252-bruecke"],
        ] as const)
            await database`
                INSERT INTO wiki_key_assignment (legacy_art, object_public_id, wiki_key, wiki_url)
                VALUES ('weg', ${id}::uuid, ${key}, 'https://de.wiki-aventurica.de/wiki/x')
            `;
    }

    const post = (body: Partial<PathNeuerWegBody>, role: Role = "editor") =>
        app.inject({
            method: "POST",
            url: EDITOR_PATHS_NEUER_WEG_URL,
            headers: { cookie: cookies.get(role) ?? "", origin: TEST_ORIGIN },
            payload: { operationId: operationId(), ...body },
        });
    /** ↺ aus dem Verlauf: die Rücknahme der Wege (`restore-series`) unter dem Abschnitt `abschnitt` für die Operation `op`. */
    const zuruecknehmen = (abschnitt: string, op: string, operation: string = operationId()) =>
        app.inject({
            method: "POST",
            url: editorPathRestoreSeriesUrl(abschnitt),
            headers: { cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN },
            payload: { operationId: operation, members: [op], membersHash: mitgliederHash([op]) },
        });
    const namen = async () =>
        Object.fromEntries(
            (
                await database<{ id: string; name: string; revision: number }[]>`
                    SELECT public_id::text AS id, name, revision::int AS revision FROM path WHERE source_system = ${SOURCE}
                `
            ).map((z) => [z.id, `${z.name}@${String(z.revision)}`]),
        );
    const aktiveZuordnungen = async () =>
        database<{ id: string; role: string }[]>`
            SELECT p.public_id::text AS id, w.role FROM path_wiki_assignment w JOIN path p ON p.id = w.path_id
             WHERE p.source_system = ${SOURCE} AND w.is_active ORDER BY p.public_id, w.role
        `;
    /** Das Wegenetz der Testwege ohne Namen: Knoten, Linie, Länge und Mittel je Kante (wie die Wegfindung es aufbaut). */
    async function netz(): Promise<unknown[]> {
        const { places, paths } = await loadRouteGraphRows(database, "aventuria");
        const eigene = new Set<string>(Object.values(A));
        return buildRouteNetwork(places, paths)
            .links.filter((l) => eigene.has(l.pathPublicId))
            .map((l) => ({ id: l.id, from: l.from, to: l.to, coordinates: l.coordinates, distance: l.distance }))
            .sort((a, b) => a.id.localeCompare(b.id));
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        const fixture = authFixture(database);
        for (const role of ["reviewer", "editor"] as const) {
            const person = await fixture.person(role, { name: `WI-0252 ${role}` });
            cookies.set(role, (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie);
        }
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

    it("🔴 EIN Name für alle gewählten Abschnitte, der Rest der alten Straße bleibt; Zuordnungen still gelegt mit Herkunft editor; EINE Operation; das Netz bleibt", async () => {
        await lege();
        const netzVorher = await netz();
        const id = operationId();
        const antwort = await app.inject({
            method: "POST",
            url: EDITOR_PATHS_NEUER_WEG_URL,
            headers: { cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN },
            payload: {
                operationId: id,
                name: "  NW Neuer Weg ",
                sections: [
                    { publicId: A.bruecke, baseRevision: 1 },
                    { publicId: A.alt2, baseRevision: 1 },
                    { publicId: A.griff, baseRevision: 1 },
                ],
            },
        });
        expect(antwort.statusCode).toBe(200);
        const quittung = antwort.json<{ anker: string; derivedWork: { kind: string }[]; warnings: unknown[] }>();
        // Der Anker ist die kleinste Kennung des neuen Wegs; keine Wegfindung, aber die Wegnamen auf der Karte folgen.
        expect(quittung.anker).toBe(A.alt2);
        expect(quittung.derivedWork.map((w) => w.kind)).not.toContain("routing");
        expect(quittung.derivedWork.map((w) => w.kind)).toContain("path_label_runs");
        expect(quittung.warnings).toEqual([]);
        expect(await namen()).toEqual({
            [A.alt1]: "NW Alte Straße@1",
            [A.alt2]: "NW Neuer Weg@2",
            [A.bruecke]: "NW Neuer Weg@2",
            [A.griff]: "NW Neuer Weg@2",
            [A.schon]: "NW Schon da@1",
        });
        // Nur der nicht gewählte Abschnitt der alten Straße trägt noch seine Artikel.
        expect(await aktiveZuordnungen()).toEqual([
            { id: A.alt1, role: "further" },
            { id: A.alt1, role: "main" },
        ]);
        const still = await database<{ origin: string; retired: string | null; aktiv: boolean }[]>`
            SELECT w.assignment_origin AS origin, w.retired_origin AS retired, w.is_active AS aktiv
              FROM path_wiki_assignment w JOIN path p ON p.id = w.path_id
             WHERE p.public_id = ANY(${[A.alt2, A.bruecke]}::uuid[])
        `;
        expect(still).toEqual([
            { origin: "editor", retired: "editor", aktiv: false },
            { origin: "editor", retired: "editor", aktiv: false },
        ]);
        const x2 = await database<{ id: string; aktiv: boolean; retired: string | null }[]>`
            SELECT object_public_id::text AS id, is_active AS aktiv, retired_origin AS retired FROM wiki_key_assignment
             WHERE object_public_id = ANY(${Object.values(A)}::uuid[]) ORDER BY object_public_id
        `;
        expect(x2).toEqual([
            { id: A.alt1, aktiv: true, retired: null },
            { id: A.alt2, aktiv: false, retired: "editor" },
            { id: A.bruecke, aktiv: false, retired: "editor" },
        ]);
        const herkunft = await database<{ id: string; origin: string }[]>`
            SELECT object_id::text AS id, origin FROM field_origin
             WHERE object_kind = 'path' AND field = 'name' AND object_id = ANY(${Object.values(A)}::uuid[]) ORDER BY object_id
        `;
        expect(herkunft).toEqual([
            { id: A.alt2, origin: "manual" },
            { id: A.bruecke, origin: "manual" },
            { id: A.griff, origin: "manual" },
        ]);
        // EINE Operation, je Abschnitt eine Zeile mit Name, Herkunft und den stillgelegten Zuordnungen.
        const [{ n } = { n: 0 }] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM map_operation WHERE operation_id = ${id}::uuid AND action = 'path.regroup'
        `;
        expect(n).toBe(1);
        const protokoll = await database<{ path: string; action: string; changes: Record<string, unknown> }[]>`
            SELECT path_public_id::text AS path, action, changes FROM map_audit_event WHERE operation_id = ${id}::uuid
             ORDER BY path_public_id
        `;
        expect(protokoll.map((z) => [z.path, z.action])).toEqual([
            [A.alt2, "path.regrouped"],
            [A.bruecke, "path.regrouped"],
            [A.griff, "path.regrouped"],
        ]);
        expect(protokoll[1]!.changes).toEqual({
            name: { before: "NW Brücke", after: "NW Neuer Weg" },
            nameOrigin: { before: null, after: "manual" },
            wiki: {
                before: {
                    titel: "NW Brücke",
                    url: "https://de.wiki-aventurica.de/wiki/wi0252-bruecke",
                    zeilen: [{ id: expect.any(String), origin: "legacy_editor" }],
                    x2: expect.any(String),
                },
                after: null,
            },
        });
        expect(protokoll[2]!.changes).toEqual({
            name: { before: "Strasse-9252", after: "NW Neuer Weg" },
            nameOrigin: { before: null, after: "manual" },
        });
        // 🔴 Die Wegfindung liest keinen Namen: dasselbe Netz, Kante für Kante.
        expect(await netz()).toEqual(netzVorher);
    });

    it("🔴 ↺ aus dem Verlauf: Namen, Herkunft und genau die stillgelegten Zuordnungen zurück, EINE Operation mit Quelle restore", async () => {
        await lege();
        const neu = operationId();
        await app.inject({
            method: "POST",
            url: EDITOR_PATHS_NEUER_WEG_URL,
            headers: { cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN },
            payload: {
                operationId: neu,
                name: "NW Neuer Weg",
                sections: [
                    { publicId: A.alt1, baseRevision: 1 },
                    { publicId: A.bruecke, baseRevision: 1 },
                ],
            },
        });
        // Der weitere Artikel des gewählten Abschnitts bleibt stehen (WI-0300, OPS-000108): Nur die Hauptzuordnungen gehen.
        expect(await aktiveZuordnungen()).toEqual([
            { id: A.alt1, role: "further" },
            { id: A.alt2, role: "main" },
        ]);
        // Ein Abschnitt, den die Operation nie berührte, ist nicht von hier (400): Die Rücknahme hängt an einem Abschnitt der Operation.
        expect((await zuruecknehmen(A.schon, neu)).statusCode).toBe(400);
        const id = operationId();
        const zurueck = await zuruecknehmen(A.alt1, neu, id);
        expect(zurueck.statusCode, zurueck.body).toBe(200);
        expect(await namen()).toMatchObject({
            [A.alt1]: "NW Alte Straße@3",
            [A.alt2]: "NW Alte Straße@1",
            [A.bruecke]: "NW Brücke@3",
        });
        expect(await aktiveZuordnungen()).toEqual([
            { id: A.alt1, role: "further" },
            { id: A.alt1, role: "main" },
            { id: A.alt2, role: "main" },
            { id: A.bruecke, role: "main" },
        ]);
        const herkunft = await database<{ origin: string }[]>`
            SELECT DISTINCT w.assignment_origin AS origin FROM path_wiki_assignment w JOIN path p ON p.id = w.path_id
             WHERE p.source_system = ${SOURCE}
        `;
        expect(herkunft).toEqual([{ origin: "legacy_editor" }]);
        const [{ aktiv } = { aktiv: 0 }] = await database<{ aktiv: number }[]>`
            SELECT count(*)::int AS aktiv FROM wiki_key_assignment WHERE object_public_id = ANY(${Object.values(A)}::uuid[]) AND is_active
        `;
        expect(aktiv).toBe(3);
        const [quelle] = await database<{ source: string }[]>`
            SELECT source FROM map_operation WHERE operation_id = ${id}::uuid
        `;
        expect(quelle?.source).toBe("restore");
        // Heißt ein Abschnitt inzwischen anders, legt ↺ den fremden Namen nicht um.
        const wieder = operationId();
        await app.inject({
            method: "POST",
            url: EDITOR_PATHS_NEUER_WEG_URL,
            headers: { cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN },
            payload: { operationId: wieder, name: "NW Zweiter", sections: [{ publicId: A.alt2, baseRevision: 1 }] },
        });
        await database`UPDATE path SET name = 'NW Fremd' WHERE public_id = ${A.alt2}::uuid`;
        expect((await zuruecknehmen(A.alt2, wieder)).statusCode).toBe(409);
    });

    it("🔴 ein Griff ist kein Name (400); Name schon vergeben heißt zusammengelegt; fremde Revision 409; fremde Sperre 409; Reviewer 403", async () => {
        await lege();
        const griff = await post({ name: "Pfad-1234", sections: [{ publicId: A.bruecke, baseRevision: 1 }] });
        expect(griff.statusCode).toBe(400);
        expect(await namen()).toMatchObject({ [A.bruecke]: "NW Brücke@1" });
        const leer = await post({ name: "   ", sections: [{ publicId: A.bruecke, baseRevision: 1 }] });
        expect(leer.statusCode).toBe(400);
        // Revision bewegt: 409, nichts geschrieben.
        const alt = await post({ name: "NW X", sections: [{ publicId: A.bruecke, baseRevision: 7 }] });
        expect(alt.statusCode).toBe(409);
        expect(alt.json<{ error: { code: string } }>().error.code).toBe("edit_conflict");
        // Reviewer: 403.
        expect(
            (await post({ name: "NW X", sections: [{ publicId: A.bruecke, baseRevision: 1 }] }, "reviewer")).statusCode,
        ).toBe(403);
        // Ein anderer hält den Abschnitt: 409 object_locked.
        const anderer = await authFixture(database).person("editor", { name: "WI-0252 anderer" });
        await database`
            INSERT INTO editor_lock (object_kind, object_id, part, person_id, person_name, run_id)
            VALUES ('path', ${A.bruecke}::uuid, 'felder', ${anderer.id}::uuid, 'WI-0252 anderer', gen_random_uuid())
        `;
        const gesperrt = await post({ name: "NW X", sections: [{ publicId: A.bruecke, baseRevision: 1 }] });
        expect(gesperrt.statusCode).toBe(409);
        expect(gesperrt.json<{ error: { code: string } }>().error.code).toBe("object_locked");
        await database`DELETE FROM editor_lock WHERE object_id = ${A.bruecke}::uuid`;
        // Der Name eines anderen Wegs: beide sind danach einer (Hinweis merged).
        const zusammen = await post({ name: "NW Schon da", sections: [{ publicId: A.bruecke, baseRevision: 1 }] });
        expect(zusammen.statusCode).toBe(200);
        expect(zusammen.json<{ warnings: { code: string }[]; anker: string }>()).toMatchObject({
            warnings: [{ code: "merged" }],
            anker: A.bruecke,
        });
    });
});
