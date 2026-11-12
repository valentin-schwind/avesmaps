import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    EDITOR_PATHS_VERBINDEN_URL,
    editorPathSplitUrl,
    editorPlaceMoveUrl,
    editorPathRestoreSeriesUrl,
    editorPathUpdateUrl,
    flussMarken,
    type PathVerbindenBody,
    type Role,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { mitgliederHash } from "../src/editor/arbeitsserie.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { leseGebirgsZusatz } from "../src/terrain/gebirge-zusatz.ts";
import { gebirgSchreiben } from "../src/terrain/gebirge-editor.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";

/**
 * Die eigenen Höhen an Flüssen folgen dem Verlauf des Flusswegs (WI-0259, Vali 2026-10-30 „Höhe wandert mit“: verschoben geht sie mit,
 * gelöscht fällt sie weg und ↶ holt sie zurück, ein eingefügter Punkt hat keine) gegen echtes PostgreSQL (`avesmaps3d_test`).
 *
 * Problemfälle: Die Höhe bleibt an der alten Lage stehen, wenn der Wegeditor den Stützpunkt zieht, und ist dort unwirksam; ein gelöschter
 * Stützpunkt nimmt die Höhe mit ins Nichts, ein ↶ findet sie nicht mehr; ein eingefügter Punkt erbt die Höhe seines Nachbarn; zwei Flüsse
 * an einem Knoten ziehen die Höhe doppelt um oder ein Fluss stiehlt dem anderen die Höhe; ein offener Kammeditor schreibt die Höhe an der
 * alten Lage zurück; verwaiste Einträge bleiben für immer in der Tafel.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const SOURCE = "test-wi0259";
/** Ein leerer Winkel der Karte, weit weg von den Proben anderer Dateien. */
const X0 = 683;
const Y0 = 227;
const REGION = "a2590259-0000-4000-8000-0000000000e1";
const FLAECHE = "a2590259-0000-4000-8000-0000000000e2";
const FLUSS = "a2590259-0000-4000-8000-000000000001";
const NEBEN = "a2590259-0000-4000-8000-000000000002";
const LANDWEG = "a2590259-0000-4000-8000-000000000003";
const ORT = "a2590259-0000-4000-8000-0000000000a1";
const KETTE_A = "a2590259-0000-4000-8000-000000000004";
const KETTE_B = "a2590259-0000-4000-8000-000000000005";

let zaehler = 0;
const operationId = (): string => `a2590259-0000-4000-9000-${String((zaehler += 1)).padStart(12, "0")}`;
const p = (dx: number, dy: number) => ({ x: X0 + dx, y: Y0 + dy });

/** Der Fluss: fünf Stützpunkte; der letzte ist der Knoten mit dem Nebenfluss. */
const FLUSS_PUNKTE = [p(0, 0), p(5, 3), p(10, 0), p(15, 4), p(20, 0)];
const NEBEN_PUNKTE = [p(20, 0), p(25, 3), p(30, 0)];

describeWithDatabase("Höhen an Flüssen folgen dem Flussweg (WI-0259)", { timeout: 120_000 }, () => {
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
        await database`DELETE FROM job_event WHERE kind = 'map.changed' OR job_id IN (SELECT id FROM job WHERE kind IN ('path_profile', 'path_label_runs'))`;
        await database`DELETE FROM job WHERE kind IN ('path_profile', 'path_label_runs')`;
        await database`DELETE FROM map_audit_event WHERE operation_id::text LIKE 'a2590259-%'`;
        await database`DELETE FROM map_operation WHERE operation_id::text LIKE 'a2590259-%'`;
        // Die Proben und die Teile, die „Teilen“ daraus macht (neue Zeilen mit Herkunft avesmaps3d, Namen der Proben).
        const wege = `SELECT id FROM path WHERE source_system = '${SOURCE}' OR (source_system = 'avesmaps3d' AND name LIKE 'WH %')`;
        for (const tafel of ["path_visual", "path_wiki_assignment", "path_source", "path_canon"])
            await database.unsafe(`DELETE FROM ${tafel} WHERE path_id IN (${wege})`);
        await database.unsafe(`DELETE FROM path WHERE id IN (${wege})`);
        await database`DELETE FROM place WHERE source_system = ${SOURCE}`;
        await database`DELETE FROM terrain_water_height WHERE area_id IN (SELECT id FROM region_area WHERE source_system = ${SOURCE})`;
        await database`DELETE FROM terrain_control WHERE area_id IN (SELECT id FROM region_area WHERE source_system = ${SOURCE})`;
        await database`DELETE FROM region_area WHERE source_system = ${SOURCE}`;
        await database`DELETE FROM region WHERE source_system = ${SOURCE}`;
    }

    const linie = (punkte: readonly { x: number; y: number }[]) =>
        `LINESTRING(${punkte.map((q) => `${String(q.x)} ${String(q.y)}`).join(", ")})`;

    async function lege(): Promise<void> {
        await aufraeumen();
        await database`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, stack_order, is_active, source_system)
            VALUES (${REGION}, 'aventuria', 'WH Probegebirge', 'topographie', 'gebirge', 10, TRUE, ${SOURCE})
        `;
        await database`
            INSERT INTO region_area (public_id, region_id, map_domain_id, geom, source_system)
            SELECT ${FLAECHE}::uuid, id, 'aventuria',
                   ST_GeomFromText(${`POLYGON((${String(X0 - 5)} ${String(Y0 - 5)}, ${String(X0 + 70)} ${String(Y0 - 5)}, ${String(X0 + 70)} ${String(Y0 + 25)}, ${String(X0 - 5)} ${String(Y0 + 25)}, ${String(X0 - 5)} ${String(Y0 - 5)}))`}, 0),
                   ${SOURCE}
              FROM region WHERE public_id = ${REGION}
        `;
        // Die Zeile der Gebirgswerte (die Revision, die ein offener Kammeditor als Basis führt).
        await database.begin((tx) => gebirgSchreiben(tx, FLAECHE, { kammhoehe: 3000 }));
        const weg = (id: string, name: string, subtype: string, punkte: readonly { x: number; y: number }[]) =>
            database`
                INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system, is_active)
                VALUES (${id}, 'aventuria', ${name}, ${subtype}, FALSE, FALSE, ST_GeomFromText(${linie(punkte)}, 0), ${SOURCE}, TRUE)
            `;
        await weg(FLUSS, "WH Fluss", "Flussweg", FLUSS_PUNKTE);
        await weg(NEBEN, "WH Nebenfluss", "Flussweg", NEBEN_PUNKTE);
        await weg(LANDWEG, "WH Landweg", "Weg", [p(20, 0), p(22, 10), p(30, 15)]);
        // Eigene Höhen: zwei Stützpunkte des Flusses, der Knoten, dazu der Spiegel eines Sees (bleibt, wie er ist).
        const hoehe = (art: string, ordinal: number, q: { x: number; y: number }, h: number) => database`
            INSERT INTO terrain_water_height (area_id, map_domain_id, art, ordinal, geom, height_schritt)
            SELECT a.id, 'aventuria', ${art}, ${ordinal}, ST_SetSRID(ST_MakePoint(${q.x}, ${q.y}), 0), ${h}
              FROM region_area a WHERE a.public_id = ${FLAECHE}::uuid
        `;
        await hoehe("fluss", 0, p(5, 3), 1500);
        await hoehe("fluss", 1, p(15, 4), 1700);
        await hoehe("fluss", 2, p(20, 0), 1200);
        await hoehe("see", 0, p(12, 9), 900);
    }

    /** Die Kurve eines Abschnitts über `path.update` (`shape`): der Satz seiner Straße mit seinen heutigen Revisionen. */
    const reshape = async (id: string, points: readonly { x: number; y: number }[], carried: unknown[] = []) => {
        const strasse = await database<{ id: string; revision: number }[]>`
            SELECT q.public_id::text AS id, q.revision::int AS revision
              FROM path p JOIN path q
                ON q.map_domain_id = p.map_domain_id AND q.name = p.name AND q.subtype = p.subtype AND q.is_active
             WHERE p.public_id = ${id}::uuid
        `;
        const antwort = await app.inject({
            method: "POST",
            url: editorPathUpdateUrl(id),
            headers: { cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN },
            payload: {
                operationId: operationId(),
                sections: strasse.map((a) => ({ publicId: a.id, baseRevision: a.revision })),
                shape: { publicId: id, points, carried },
            },
        });
        return {
            status: antwort.statusCode,
            body: antwort.json<{
                operationId: string;
                affected: { kind: string; id: string; revision?: number }[];
            }>(),
        };
    };
    const revisionWeg = async (id: string): Promise<number> =>
        (await database<{ r: number }[]>`SELECT revision::int AS r FROM path WHERE public_id = ${id}::uuid`)[0]!.r;
    const gebirgsRevision = async (): Promise<number> =>
        (
            await database<{ r: number }[]>`
                SELECT c.revision::int AS r FROM terrain_control c JOIN region_area a ON a.id = c.area_id
                 WHERE a.public_id = ${FLAECHE}::uuid
            `
        )[0]!.r;
    /** Die Höhen der Tafel, gerundet auf die Probe: Art, Lage relativ zum Winkel, Höhe. */
    const hoehen = async (art = "fluss") =>
        (
            await database<{ x: number; y: number; h: number }[]>`
                SELECT ST_X(w.geom) AS x, ST_Y(w.geom) AS y, w.height_schritt AS h
                  FROM terrain_water_height w JOIN region_area a ON a.id = w.area_id
                 WHERE a.public_id = ${FLAECHE}::uuid AND w.art = ${art} ORDER BY w.ordinal
            `
        ).map((z) => ({ x: Math.round((z.x - X0) * 1e5) / 1e5, y: Math.round((z.y - Y0) * 1e5) / 1e5, h: z.h }));
    const punkteVon = async (id: string): Promise<[number, number][]> => {
        const [row] = await database<
            { g: string }[]
        >`SELECT ST_AsGeoJSON(geom, 15) AS g FROM path WHERE public_id = ${id}::uuid`;
        return (JSON.parse(row!.g) as { coordinates: [number, number][] }).coordinates;
    };
    /** Die Marken, die der Fluss im Gelände wirklich trägt: die gespeicherten Höhen gegen die Stützpunkte des Flusswegs. */
    const marken = async (id: string): Promise<number[]> => {
        const [flaeche] = await database<
            { id: string }[]
        >`SELECT id::text FROM region_area WHERE public_id = ${FLAECHE}::uuid`;
        const zusatz = (await leseGebirgsZusatz(database, [flaeche!.id])).get(flaeche!.id)!;
        return flussMarken(await punkteVon(id), zusatz.netz.flussHoehen, []).map((m) => m.h);
    };
    const wasserEintraege = async (operation: string) =>
        (
            await database<{ action: string; path_id: string; changes: Record<string, unknown> }[]>`
                SELECT action, path_public_id::text AS path_id, changes FROM map_audit_event
                 WHERE operation_id = ${operation}::uuid AND changes ? 'wasserHoehen' ORDER BY id
            `
        ).map((e) => ({ action: e.action, pathId: e.path_id, wasserHoehen: e.changes["wasserHoehen"] }));
    const ohneGebirge = (affected: { kind: string }[]) => affected.filter((e) => e.kind === "terrain_control");

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        const fixture = authFixture(database);
        for (const role of ["reviewer", "editor"] as const) {
            const person = await fixture.person(role, { name: `WH ${role}` });
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

    it("🔴 Punkt verschieben: die Höhe zieht mit, die Quittung nennt die Gebirgswerte, das Protokoll die umgezogene Höhe; ↶ bringt sie zurück", async () => {
        await lege();
        const vorher = await gebirgsRevision();
        const antwort = await reshape(FLUSS, [p(0, 0), p(6, 5), p(10, 0), p(15, 4), p(20, 0)]);
        expect(antwort.status).toBe(200);
        expect(await hoehen()).toEqual([
            { x: 6, y: 5, h: 1500 },
            { x: 15, y: 4, h: 1700 },
            { x: 20, y: 0, h: 1200 },
        ]);
        // Der Spiegel eines Sees bleibt, wie er ist.
        expect(await hoehen("see")).toEqual([{ x: 12, y: 9, h: 900 }]);
        expect(await gebirgsRevision()).toBe(vorher + 1);
        expect(ohneGebirge(antwort.body.affected)).toEqual([
            { kind: "terrain_control", id: FLAECHE, revision: vorher + 1 },
        ]);
        expect(await wasserEintraege(antwort.body.operationId)).toEqual([
            {
                action: "path.reshaped",
                pathId: FLUSS,
                wasserHoehen: {
                    before: [{ area: FLAECHE, h: 1500, x: X0 + 5, y: Y0 + 3 }],
                    after: [{ area: FLAECHE, h: 1500, x: X0 + 6, y: Y0 + 5 }],
                },
            },
        ]);
        // Im Gelände wirkt die Höhe am neuen Stützpunkt.
        expect(await marken(FLUSS)).toEqual([1500, 1700, 1200]);
        // ↶: der Punkt zurück an seine Lage, die Höhe mit.
        expect((await reshape(FLUSS, FLUSS_PUNKTE)).status).toBe(200);
        expect(await hoehen()).toEqual([
            { x: 5, y: 3, h: 1500 },
            { x: 15, y: 4, h: 1700 },
            { x: 20, y: 0, h: 1200 },
        ]);
        expect(await marken(FLUSS)).toEqual([1500, 1700, 1200]);
    });

    it("🔴 Punkt löschen: die Zeile bleibt, das Netz wirkt ohne sie; setzt ↶ den Punkt an dieselbe Lage zurück, wirkt sie wieder", async () => {
        await lege();
        const vorher = await gebirgsRevision();
        const antwort = await reshape(FLUSS, [p(0, 0), p(10, 0), p(15, 4), p(20, 0)]);
        expect(antwort.status).toBe(200);
        expect(await hoehen()).toEqual([
            { x: 5, y: 3, h: 1500 },
            { x: 15, y: 4, h: 1700 },
            { x: 20, y: 0, h: 1200 },
        ]);
        // Nichts ist umgezogen: weder Protokoll noch Gebirgswerte.
        expect(await wasserEintraege(antwort.body.operationId)).toEqual([]);
        expect(ohneGebirge(antwort.body.affected)).toEqual([]);
        expect(await gebirgsRevision()).toBe(vorher);
        // Ohne den Stützpunkt trägt der Fluss die Höhe nicht.
        expect(await marken(FLUSS)).toEqual([1700, 1200]);
        // ↶: derselbe Punkt an derselben Lage.
        expect((await reshape(FLUSS, FLUSS_PUNKTE)).status).toBe(200);
        expect(await marken(FLUSS)).toEqual([1500, 1700, 1200]);
        expect(await hoehen()).toHaveLength(3);
    });

    it("🔴 Punkt einfügen: nichts ändert sich, der neue Punkt hat keine eigene Höhe", async () => {
        await lege();
        const vorher = await gebirgsRevision();
        const antwort = await reshape(FLUSS, [p(0, 0), p(2, 1), p(5, 3), p(10, 0), p(15, 4), p(20, 0)]);
        expect(antwort.status).toBe(200);
        expect(await hoehen()).toEqual([
            { x: 5, y: 3, h: 1500 },
            { x: 15, y: 4, h: 1700 },
            { x: 20, y: 0, h: 1200 },
        ]);
        expect(await wasserEintraege(antwort.body.operationId)).toEqual([]);
        expect(await gebirgsRevision()).toBe(vorher);
        expect(await marken(FLUSS)).toEqual([1500, 1700, 1200]);
    });

    it("🔴 Vereinfachen: die übrigen Stützpunkte behalten ihre Höhen, die weggefallenen lassen sie stehen", async () => {
        await lege();
        const antwort = await reshape(FLUSS, [p(0, 0), p(15, 4), p(20, 0)]);
        expect(antwort.status).toBe(200);
        expect(await hoehen()).toEqual([
            { x: 5, y: 3, h: 1500 },
            { x: 15, y: 4, h: 1700 },
            { x: 20, y: 0, h: 1200 },
        ]);
        expect(await marken(FLUSS)).toEqual([1700, 1200]);
    });

    it("🔴 Punkt verschoben und ein anderer gelöscht im selben Schritt: nur der verschobene nimmt seine Höhe mit", async () => {
        await lege();
        // Alt: 5 Punkte, neu: 4 (Index 1 gelöscht, Index 3 verschoben): Die Lücken sind je 1 gegen 0 bzw. 1 gegen 1.
        const antwort = await reshape(FLUSS, [p(0, 0), p(10, 0), p(16, 6), p(20, 0)]);
        expect(antwort.status).toBe(200);
        expect(await hoehen()).toEqual([
            { x: 5, y: 3, h: 1500 },
            { x: 16, y: 6, h: 1700 },
            { x: 20, y: 0, h: 1200 },
        ]);
    });

    it("🔴 zwei Flüsse an einem Knoten ziehen gemeinsam: die Höhe am Knoten wandert genau einmal", async () => {
        await lege();
        const antwort = await reshape(
            FLUSS,
            [p(0, 0), p(5, 3), p(10, 0), p(15, 4), p(21, 1)],
            [
                {
                    pathId: NEBEN,
                    index: 0,
                    baseRevision: await revisionWeg(NEBEN),
                    from: p(20, 0),
                    to: p(21, 1),
                },
            ],
        );
        expect(antwort.status).toBe(200);
        expect(await hoehen()).toEqual([
            { x: 5, y: 3, h: 1500 },
            { x: 15, y: 4, h: 1700 },
            { x: 21, y: 1, h: 1200 },
        ]);
        expect(await wasserEintraege(antwort.body.operationId)).toEqual([
            {
                action: "path.reshaped",
                pathId: FLUSS,
                wasserHoehen: {
                    before: [{ area: FLAECHE, h: 1200, x: X0 + 20, y: Y0 }],
                    after: [{ area: FLAECHE, h: 1200, x: X0 + 21, y: Y0 + 1 }],
                },
            },
        ]);
        expect(await marken(FLUSS)).toEqual([1500, 1700, 1200]);
        expect(await marken(NEBEN)).toEqual([1200]);
    });

    it("🔴 ein Fluss verlässt den gemeinsamen Knoten allein: die Höhe bleibt dort, wo der andere Fluss noch einen Stützpunkt hat", async () => {
        await lege();
        const antwort = await reshape(FLUSS, [p(0, 0), p(5, 3), p(10, 0), p(15, 4), p(21, 1)]);
        expect(antwort.status).toBe(200);
        expect(await hoehen()).toEqual([
            { x: 5, y: 3, h: 1500 },
            { x: 15, y: 4, h: 1700 },
            { x: 20, y: 0, h: 1200 },
        ]);
        expect(await marken(NEBEN)).toEqual([1200]);
        expect(await marken(FLUSS)).toEqual([1500, 1700]);
    });

    it("🔴 ein Landweg zieht die Enden zweier Flüsse am Knoten mit: die Höhe wandert einmal, obwohl der bearbeitete Weg kein Fluss ist", async () => {
        await lege();
        const antwort = await reshape(
            LANDWEG,
            [p(21, 1), p(22, 10), p(30, 15)],
            [
                { pathId: FLUSS, index: 4, baseRevision: await revisionWeg(FLUSS), from: p(20, 0), to: p(21, 1) },
                { pathId: NEBEN, index: 0, baseRevision: await revisionWeg(NEBEN), from: p(20, 0), to: p(21, 1) },
            ],
        );
        expect(antwort.status).toBe(200);
        expect(await hoehen()).toEqual([
            { x: 5, y: 3, h: 1500 },
            { x: 15, y: 4, h: 1700 },
            { x: 21, y: 1, h: 1200 },
        ]);
        const eintraege = await wasserEintraege(antwort.body.operationId);
        expect(eintraege).toHaveLength(1);
        expect(await marken(NEBEN)).toEqual([1200]);
    });

    it("🔴 ein Punkt auf die Lage eines Punkts mit eigener Höhe gezogen: die vorhandene Höhe gewinnt, die andere bleibt unwirksam stehen", async () => {
        await lege();
        // Der Punkt mit 1500 geht auf den Punkt mit 1700.
        const antwort = await reshape(FLUSS, [p(0, 0), p(15, 4), p(10, 0), p(15, 4), p(20, 0)]);
        expect(antwort.status).toBe(200);
        expect(await hoehen()).toEqual([
            { x: 5, y: 3, h: 1500 },
            { x: 15, y: 4, h: 1700 },
            { x: 20, y: 0, h: 1200 },
        ]);
    });

    it("🔴 Teilen verschiebt keinen Stützpunkt: alle Höhen bleiben, jeder Teil trägt die seiner Stützpunkte (der Teilungspunkt in beiden)", async () => {
        await lege();
        const antwort = await app.inject({
            method: "POST",
            url: editorPathSplitUrl(FLUSS),
            headers: { cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN },
            payload: { operationId: operationId(), baseRevision: await revisionWeg(FLUSS), index: 2, at: p(10, 0) },
        });
        expect(antwort.statusCode).toBe(200);
        const hinten = (antwort.json() as { publicId: string }).publicId;
        expect(await hoehen()).toHaveLength(3);
        expect(await marken(FLUSS)).toEqual([1500]);
        expect(await marken(hinten)).toEqual([1700, 1200]);
        expect(await gebirgsRevision()).toBe(1);
    });

    describe("Ort verschieben (place.move zieht Wegenden mit)", () => {
        /** Ein Ort auf dem Knoten, an dem beide Flüsse und der Landweg enden. */
        async function legeOrt(): Promise<void> {
            await lege();
            await database`
                INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
                VALUES (${ORT}, 'aventuria', 'WH Ort', 'dorf', ST_SetSRID(ST_MakePoint(${X0 + 20}, ${Y0}), 0), ${SOURCE}, TRUE)
            `;
        }
        const verschiebeOrt = async (enden: { pathId: string; end: "start" | "end" }[]) => {
            const [ort] = await database<
                { r: number }[]
            >`SELECT revision::int AS r FROM place WHERE public_id = ${ORT}::uuid`;
            const antwort = await app.inject({
                method: "POST",
                url: editorPlaceMoveUrl(ORT),
                headers: { cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN },
                payload: {
                    operationId: operationId(),
                    baseRevision: ort!.r,
                    to: p(21, 1),
                    pathEnds: await Promise.all(
                        enden.map(async (e) => ({ ...e, baseRevision: await revisionWeg(e.pathId), to: p(21, 1) })),
                    ),
                },
            });
            return {
                status: antwort.statusCode,
                body: antwort.json<{
                    operationId: string;
                    affected: { kind: string; id: string; revision?: number }[];
                }>(),
            };
        };

        it("🔴 die Flussenden ziehen mit dem Ort, die Höhe am Knoten wandert genau einmal; Protokoll und Quittung wie beim Wegeditor", async () => {
            await legeOrt();
            const vorher = await gebirgsRevision();
            const antwort = await verschiebeOrt([
                { pathId: FLUSS, end: "end" },
                { pathId: NEBEN, end: "start" },
            ]);
            expect(antwort.status).toBe(200);
            expect(await hoehen()).toEqual([
                { x: 5, y: 3, h: 1500 },
                { x: 15, y: 4, h: 1700 },
                { x: 21, y: 1, h: 1200 },
            ]);
            expect(await gebirgsRevision()).toBe(vorher + 1);
            expect(ohneGebirge(antwort.body.affected)).toEqual([
                { kind: "terrain_control", id: FLAECHE, revision: vorher + 1 },
            ]);
            const eintraege = await wasserEintraege(antwort.body.operationId);
            expect(eintraege).toHaveLength(1);
            expect(eintraege[0]).toMatchObject({
                action: "path.endpoint_moved",
                wasserHoehen: {
                    before: [{ area: FLAECHE, h: 1200, x: X0 + 20, y: Y0 }],
                    after: [{ area: FLAECHE, h: 1200, x: X0 + 21, y: Y0 + 1 }],
                },
            });
            expect(await marken(FLUSS)).toEqual([1500, 1700, 1200]);
            expect(await marken(NEBEN)).toEqual([1200]);
        });

        it("🔴 zieht nur ein Fluss mit, bleibt die Höhe dort, wo der andere noch endet; ein Landweg am Ort hält sie nicht fest", async () => {
            await legeOrt();
            const antwort = await verschiebeOrt([{ pathId: FLUSS, end: "end" }]);
            expect(antwort.status).toBe(200);
            expect(await hoehen()).toEqual([
                { x: 5, y: 3, h: 1500 },
                { x: 15, y: 4, h: 1700 },
                { x: 20, y: 0, h: 1200 },
            ]);
            expect(await wasserEintraege(antwort.body.operationId)).toEqual([]);
            expect(await marken(NEBEN)).toEqual([1200]);
        });

        it("🔴 zieht allein der Landweg mit, ändert sich an den Flusshöhen nichts", async () => {
            await legeOrt();
            const vorher = await gebirgsRevision();
            const antwort = await verschiebeOrt([{ pathId: LANDWEG, end: "start" }]);
            expect(antwort.status).toBe(200);
            expect(await hoehen()).toHaveLength(3);
            expect((await hoehen())[2]).toEqual({ x: 20, y: 0, h: 1200 });
            expect(ohneGebirge(antwort.body.affected)).toEqual([]);
            expect(await gebirgsRevision()).toBe(vorher);
        });
    });

    it("🔴 Gebirge schreiben: Höhen ohne Stützpunkt fallen weg, Höhen auf Stützpunkten und Seehöhen bleiben; ein Netz ohne Verwaistes ändert nichts", async () => {
        await lege();
        // Der Punkt mit 1500 wird gelöscht: Die Zeile bleibt stehen (unwirksam), bis ein Editor das Netz schreibt.
        expect((await reshape(FLUSS, [p(0, 0), p(10, 0), p(15, 4), p(20, 0)])).status).toBe(200);
        expect(await hoehen()).toHaveLength(3);
        const [flaeche] = await database<
            { id: string }[]
        >`SELECT id::text FROM region_area WHERE public_id = ${FLAECHE}::uuid`;
        const netz = async () => (await leseGebirgsZusatz(database, [flaeche!.id])).get(flaeche!.id)!.netz;
        const kamm = {
            punkte: [p(0, 20), p(10, 22)].map(({ x, y }) => [x, y] as [number, number]),
            rang: "haupt" as const,
        };
        const aktuell = await netz();
        // Der Client schickt zurück, was er gelesen hat (auch die verwaiste Höhe), dazu eine neue auf einem Stützpunkt und eine im Leeren.
        const schreibe = (flussHoehen: { x: number; y: number; h: number }[]) =>
            database.begin((tx) =>
                gebirgSchreiben(tx, FLAECHE, {
                    netz: { kaemme: [kamm], nebengipfel: [], flussHoehen, seeHoehen: aktuell.seeHoehen ?? [] },
                }),
            );
        const vorher = await gebirgsRevision();
        await schreibe([...(aktuell.flussHoehen ?? []), { ...p(10, 0), h: 1400 }, { ...p(2, 9), h: 800 }]);
        // In der Folge der Liste ohne die verwaiste und die im Leeren: die gelesenen, dann die neue auf dem Stützpunkt.
        expect(await hoehen()).toEqual([
            { x: 15, y: 4, h: 1700 },
            { x: 20, y: 0, h: 1200 },
            { x: 10, y: 0, h: 1400 },
        ]);
        expect(await hoehen("see")).toEqual([{ x: 12, y: 9, h: 900 }]);
        expect(await gebirgsRevision()).toBe(vorher + 1);
        // Dasselbe Netz noch einmal: nichts mehr zu räumen, keine Änderung, die Revision bleibt.
        const jetzt = await netz();
        await schreibe(jetzt.flussHoehen ?? []);
        expect(await gebirgsRevision()).toBe(vorher + 1);
        // Ein alter Client nennt die Höhen nicht: Die gespeicherten bleiben, soweit sie an einem Stützpunkt liegen.
        await database.begin((tx) =>
            gebirgSchreiben(tx, FLAECHE, { netz: { kaemme: [{ ...kamm, rang: "neben" }], nebengipfel: [] } }),
        );
        expect(await hoehen()).toHaveLength(3);
        // Ein gelöschter Fluss lässt alle seine Höhen verwaisen; Seehöhen räumt das Schreiben nie ab.
        await database`UPDATE path SET is_active = FALSE WHERE public_id = ANY(${[FLUSS, NEBEN]}::uuid[])`;
        await schreibe((await netz()).flussHoehen ?? []);
        expect(await hoehen()).toEqual([]);
        expect(await hoehen("see")).toEqual([{ x: 12, y: 9, h: 900 }]);
    });

    it("🔴 ein offener Entwurf des Kammeditors kann die umgezogene Höhe nicht an der alten Lage zurückschreiben: seine Basis ist veraltet (409)", async () => {
        await lege();
        const [flaeche] = await database<
            { id: string }[]
        >`SELECT id::text FROM region_area WHERE public_id = ${FLAECHE}::uuid`;
        const stand = async () => {
            const zusatz = (await leseGebirgsZusatz(database, [flaeche!.id])).get(flaeche!.id)!;
            return { flussHoehen: zusatz.netz.flussHoehen ?? [], revision: zusatz.revision };
        };
        const entwurf = await stand();
        expect((await reshape(FLUSS, [p(0, 0), p(6, 5), p(10, 0), p(15, 4), p(20, 0)])).status).toBe(200);
        const kamm = {
            punkte: [p(0, 20), p(10, 22)].map(({ x, y }) => [x, y] as [number, number]),
            rang: "haupt" as const,
        };
        await expect(
            database.begin((tx) =>
                gebirgSchreiben(tx, FLAECHE, {
                    baseRevision: entwurf.revision,
                    netz: { kaemme: [kamm], nebengipfel: [], flussHoehen: entwurf.flussHoehen },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 409 });
        expect(await hoehen()).toEqual([
            { x: 6, y: 5, h: 1500 },
            { x: 15, y: 4, h: 1700 },
            { x: 20, y: 0, h: 1200 },
        ]);
    });

    describe("Wege verbinden", () => {
        const post = (body: Partial<PathVerbindenBody>) =>
            app.inject({
                method: "POST",
                url: EDITOR_PATHS_VERBINDEN_URL,
                headers: { cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN },
                payload: { operationId: operationId(), ...body },
            });

        /** `stoss`: an welchem Ende der Stoßstelle eine eigene Höhe liegt: nur am zweiten Ende (B: 2500) oder an beiden (A: 2600). */
        async function legeKette(stoss: "b" | "beide"): Promise<void> {
            await lege();
            // A läuft nach rechts, B beginnt 0,01 daneben (knapp innerhalb des Fangradius): Beide Enden werden EIN Stützpunkt auf dem Knoten.
            const a = [p(40, 0), p(45, 3), p(50, 0)];
            const b = [{ x: X0 + 50.01, y: Y0 + 0.005 }, p(55, 3), p(60, 0)];
            for (const [id, name, punkte] of [
                [KETTE_A, "WH Kette A", a],
                [KETTE_B, "WH Kette B", b],
            ] as const)
                await database`
                    INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system, is_active)
                    VALUES (${id}, 'aventuria', ${name}, 'Flussweg', FALSE, FALSE, ST_GeomFromText(${linie(punkte)}, 0), ${SOURCE}, TRUE)
                `;
            const zeilen = [
                [0, X0 + 45, Y0 + 3, 2810],
                ...(stoss === "b" ? [] : [[1, X0 + 50, Y0, 2600]]),
                [2, X0 + 50.01, Y0 + 0.005, 2500],
                [3, X0 + 55, Y0 + 3, 2400],
            ] as const;
            for (const [o, x, y, h] of zeilen)
                await database`
                    INSERT INTO terrain_water_height (area_id, map_domain_id, art, ordinal, geom, height_schritt)
                    SELECT a.id, 'aventuria', 'fluss', ${10 + o}, ST_SetSRID(ST_MakePoint(${x}, ${y}), 0), ${h}
                      FROM region_area a WHERE a.public_id = ${FLAECHE}::uuid
                `;
        }
        const verbinden = async () =>
            post({
                vorlage: KETTE_A,
                sections: [
                    { publicId: KETTE_A, baseRevision: await revisionWeg(KETTE_A) },
                    { publicId: KETTE_B, baseRevision: await revisionWeg(KETTE_B) },
                ],
            });

        it("🔴 das zweite Ende der Stoßstelle nimmt seine Höhe auf den Knoten mit, alle übrigen Stützpunkte bleiben wirksam; ↺ führt sie zurück", async () => {
            await legeKette("b");
            const antwort = await verbinden();
            expect(antwort.statusCode).toBe(200);
            const verbunden = await punkteVon(KETTE_A);
            expect(verbunden).toHaveLength(5);
            const knoten = verbunden[2]!;
            // Die Höhen der inneren Stützpunkte stehen unverändert, die des zweiten Endes liegt jetzt auf dem Knoten.
            const nachher = await hoehen();
            expect(nachher.filter((z) => z.h === 2810)).toEqual([{ x: 45, y: 3, h: 2810 }]);
            expect(nachher.filter((z) => z.h === 2400)).toEqual([{ x: 55, y: 3, h: 2400 }]);
            const stoss = nachher.filter((z) => z.h === 2500);
            expect(stoss).toHaveLength(1);
            expect(Math.abs(stoss[0]!.x + X0 - knoten[0])).toBeLessThanOrEqual(1e-4);
            expect(Math.abs(stoss[0]!.y + Y0 - knoten[1])).toBeLessThanOrEqual(1e-4);
            expect(await marken(KETTE_A)).toEqual([2810, 2500, 2400]);
            // ↺: Die Linie von A kehrt zurück, B kommt wieder auf die Karte, und die Höhe liegt wieder an B.
            // Seit WI-0265 B6a2 ist ↺ die Rücknahme der Wege (`restore-series`), die die Höhen aus dem Protokoll (`wasserHoehen`) an ihre Stützpunkte zurückführt.
            const verbunden0 = (antwort.json() as { operationId: string }).operationId;
            const zurueck = await app.inject({
                method: "POST",
                url: editorPathRestoreSeriesUrl(KETTE_A),
                headers: { cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN },
                payload: {
                    operationId: operationId(),
                    members: [verbunden0],
                    membersHash: mitgliederHash([verbunden0]),
                },
            });
            expect(zurueck.statusCode, zurueck.body).toBe(200);
            expect((await hoehen()).filter((z) => z.h === 2500)).toEqual([{ x: 50.01, y: 0.005, h: 2500 }]);
            expect(await marken(KETTE_A)).toEqual([2810]);
            expect(await marken(KETTE_B)).toEqual([2500, 2400]);

            // WI-0265 B8a2: Die Rücknahme selbst lässt sich zurücknehmen (die Abschnitte wieder EIN Weg), und die Höhe wandert in jedem Schritt mit: wieder auf den Knoten, wieder zurück, wieder auf den Knoten.
            const zuruecknehmen = async (id: string, kennung: string) =>
                app.inject({
                    method: "POST",
                    url: editorPathRestoreSeriesUrl(KETTE_A),
                    headers: { cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN },
                    payload: { operationId: kennung, members: [id], membersHash: mitgliederHash([id]) },
                });
            const rueckId = (zurueck.json() as { operationId: string }).operationId;
            const wieder = await zuruecknehmen(rueckId, operationId());
            expect(wieder.statusCode, wieder.body).toBe(200);
            const wiederId = (wieder.json() as { operationId: string }).operationId;
            const knoten2 = (await punkteVon(KETTE_A))[2]!;
            const stoss2 = (await hoehen()).filter((z) => z.h === 2500);
            expect(stoss2).toHaveLength(1);
            expect(Math.abs(stoss2[0]!.x + X0 - knoten2[0])).toBeLessThanOrEqual(1e-4);
            expect(Math.abs(stoss2[0]!.y + Y0 - knoten2[1])).toBeLessThanOrEqual(1e-4);
            expect(await marken(KETTE_A)).toEqual([2810, 2500, 2400]);
            const getrennt = await zuruecknehmen(wiederId, operationId());
            expect(getrennt.statusCode, getrennt.body).toBe(200);
            expect((await hoehen()).filter((z) => z.h === 2500)).toEqual([{ x: 50.01, y: 0.005, h: 2500 }]);
            expect(await marken(KETTE_A)).toEqual([2810]);
            expect(await marken(KETTE_B)).toEqual([2500, 2400]);
            const nochmal = await zuruecknehmen(
                (getrennt.json() as { operationId: string }).operationId,
                operationId(),
            );
            expect(nochmal.statusCode, nochmal.body).toBe(200);
            expect(await marken(KETTE_A)).toEqual([2810, 2500, 2400]);
            expect((await hoehen()).filter((z) => z.h === 2500)).toHaveLength(1);
        });

        it("🔴 tragen beide Enden der Stoßstelle eine Höhe, gilt die am Knoten; die andere bleibt unwirksam stehen (nie zwei Höhen an einer Lage)", async () => {
            await legeKette("beide");
            expect((await verbinden()).statusCode).toBe(200);
            const knoten = (await punkteVon(KETTE_A))[2]!;
            const amKnoten = (await hoehen()).filter(
                (z) => Math.abs(z.x + X0 - knoten[0]) <= 1e-4 && Math.abs(z.y + Y0 - knoten[1]) <= 1e-4,
            );
            expect(amKnoten).toHaveLength(1);
            // Drei Höhen des Flusses aus der Grundlage und vier an der Kette: keine ging verloren, keine kam dazu.
            expect(await hoehen()).toHaveLength(7);
        });
    });
});
