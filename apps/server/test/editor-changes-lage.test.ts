import { randomUUID } from "node:crypto";
import { FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MapChangeLage, editorChangeLageUrl, type MapChangeLage as Lage, type Role } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { aenderungLage } from "../src/editor/aenderung-lage.ts";
import { TEST_AUTH, authFixture } from "./support/auth-fixture.ts";

/**
 * Wo die Gegenstände einer Änderung HEUTE liegen (`GET /api/editor/changes/:operationId/lage`, WI-0265 B9) gegen echtes PostgreSQL (`TEST_DATABASE_URL`).
 *
 * Problemfälle: Eine Art von Gegenstand fällt aus der Rechnung und die Änderung bekommt kein ⊕; eine Teilfläche zeigt die ganze Landschaft statt sich selbst; eine stillgelegte Stelle
 * zählt nicht mit (oder verzerrt den Kasten, obwohl der Gegenstand noch eine gültige Lage hat); ein Werk ohne Orte, ein von der Karte genommener Ort oder ein unbekannter Gegenstand
 * werfen einen Fehler statt „keine Lage“; ein Wiki-Lauf mit fünftausend Orten wird zur Schleife; Besucher und Tester lesen die Lage.
 */

FormatRegistry.Set("date-time", (wert) => !Number.isNaN(Date.parse(wert)));

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/** Das Präfix aller Zeilen dieses Tests: das Aufräumen trifft nur sie. */
const P = "b9b90265-0000-4000-";
const id = (gruppe: string, n: number): string => `${P}${gruppe}-${String(n).padStart(12, "0")}`;
const op = (n: number): string => id("9000", n);
const ort = (n: number): string => id("8000", n);
const SOURCE = "test-changes-lage";
const VIELE = 5069;

/** Ein Rechteck als WKT (Kartenkoordinaten). */
const rechteck = (x0: number, y0: number, x1: number, y1: number): string =>
    `POLYGON((${String(x0)} ${String(y0)}, ${String(x1)} ${String(y0)}, ${String(x1)} ${String(y1)}, ${String(x0)} ${String(y1)}, ${String(x0)} ${String(y0)}))`;

interface Ziele {
    place?: string;
    path?: string;
    powerline?: string;
    nodix?: string;
    region?: string;
    region_area?: string;
    map_label?: string;
    territory?: string;
    territory_area?: string;
    peak?: string;
    source?: string;
    work?: string;
    lore?: string;
    corpus?: string;
    sprache_artikel?: string;
    sprache?: string;
    sprache_flaeche?: string;
}

describeWithDatabase("„Änderungen“: Lage der Gegenstände (WI-0265 B9)", { timeout: 180_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let fixture: ReturnType<typeof authFixture>;
    const cookies = new Map<Role, string>();
    const config: ServerConfig = {
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        auth: TEST_AUTH,
    };

    async function aufraeumen(): Promise<void> {
        const muster = `${P}%`;
        await database`DELETE FROM map_audit_event WHERE operation_id::text LIKE ${muster}`;
        await database`DELETE FROM map_operation WHERE operation_id::text LIKE ${muster}`;
        await database`DELETE FROM adventure_place WHERE adventure_id IN (SELECT id FROM adventure WHERE public_id::text LIKE ${muster})`;
        await database`DELETE FROM adventure WHERE public_id::text LIKE ${muster}`;
        await database`DELETE FROM lore_place_target WHERE lore_place_id IN (SELECT lp.id FROM lore_place lp JOIN lore_entry le ON le.id = lp.lore_entry_id WHERE le.public_id::text LIKE ${muster})`;
        await database`DELETE FROM lore_place WHERE lore_entry_id IN (SELECT id FROM lore_entry WHERE public_id::text LIKE ${muster})`;
        await database`DELETE FROM lore_entry WHERE public_id::text LIKE ${muster}`;
        await database`DELETE FROM place_source WHERE source_id IN (SELECT id FROM feature_source WHERE title LIKE 'B9 %')`;
        await database`DELETE FROM path_source WHERE source_id IN (SELECT id FROM feature_source WHERE title LIKE 'B9 %')`;
        await database`DELETE FROM feature_source WHERE title LIKE 'B9 %'`;
        await database`DELETE FROM source_corpus WHERE corpus_key LIKE 'b9-lage-%'`;
        await database`DELETE FROM sprache_wiki WHERE sprache_id IN (SELECT id FROM sprache WHERE schluessel LIKE 'b9-lage-%')`;
        await database`DELETE FROM wiki_sprache_artikel WHERE schluessel LIKE 'b9-lage-%'`;
        await database`DELETE FROM sprache_flaeche WHERE sprache_id IN (SELECT id FROM sprache WHERE schluessel LIKE 'b9-lage-%')`;
        await database`DELETE FROM sprache WHERE schluessel LIKE 'b9-lage-%'`;
        await database`DELETE FROM terrain_peak WHERE public_id::text LIKE ${muster}`;
        await database`DELETE FROM territory_area WHERE public_id::text LIKE ${muster}`;
        await database`DELETE FROM territory WHERE public_id::text LIKE ${muster}`;
        await database`DELETE FROM map_label WHERE public_id::text LIKE ${muster}`;
        await database`DELETE FROM region_area WHERE public_id::text LIKE ${muster}`;
        await database`DELETE FROM region WHERE public_id::text LIKE ${muster}`;
        await database`DELETE FROM nodix WHERE public_id::text LIKE ${muster}`;
        await database`DELETE FROM powerline WHERE public_id::text LIKE ${muster}`;
        await database`DELETE FROM path WHERE public_id::text LIKE ${muster}`;
        await database`DELETE FROM place WHERE public_id::text LIKE ${muster}`;
        await database`DELETE FROM place_unplaced WHERE public_id::text LIKE ${muster}`;
    }

    /** Eine Operation (als Import: ohne Quittung des Schreibwegs) mit einem Protokolleintrag je Gegenstand. */
    async function operation(n: number, ...ziele: Ziele[]): Promise<void> {
        await database`
            INSERT INTO map_operation (operation_id, map_domain_id, action, source, environment, actor_kind, actor_label, summary)
            VALUES (${op(n)}::uuid, 'aventuria', 'test.changes_lage', 'import', 'test', 'system', 'test', NULL)
        `;
        for (const z of ziele)
            await database`
                INSERT INTO map_audit_event (operation_id, action, place_public_id, path_public_id, powerline_public_id, nodix_public_id,
                                             region_public_id, region_area_public_id, map_label_public_id, territory_public_id,
                                             territory_area_public_id, peak_public_id, source_public_id, work_public_id, lore_public_id,
                                             corpus_public_id, sprache_artikel_public_id, sprache_public_id, sprache_flaeche_public_id, changes)
                VALUES (${op(n)}::uuid, 'test.geaendert', ${z.place ?? null}::uuid, ${z.path ?? null}::uuid, ${z.powerline ?? null}::uuid,
                        ${z.nodix ?? null}::uuid, ${z.region ?? null}::uuid, ${z.region_area ?? null}::uuid, ${z.map_label ?? null}::uuid,
                        ${z.territory ?? null}::uuid, ${z.territory_area ?? null}::uuid, ${z.peak ?? null}::uuid, ${z.source ?? null}::uuid,
                        ${z.work ?? null}::uuid, ${z.lore ?? null}::uuid, ${z.corpus ?? null}::uuid, ${z.sprache_artikel ?? null}::uuid,
                        ${z.sprache ?? null}::uuid, ${z.sprache_flaeche ?? null}::uuid, '{}'::jsonb)
            `;
    }

    const punkt = (x: number, y: number): string => `ST_SetSRID(ST_MakePoint(${String(x)}, ${String(y)}), 0)`;
    async function legeOrt(n: number, x: number, y: number, aktiv = true): Promise<string> {
        await database.unsafe(
            `INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
             VALUES ('${ort(n)}', 'aventuria', 'B9 Ort ${String(n)}', 'dorf', ${punkt(x, y)}, '${SOURCE}', ${String(aktiv)})`,
        );
        return ort(n);
    }
    async function legeWeg(n: number, wkt: string): Promise<string> {
        const weg = id("8100", n);
        await database`
            INSERT INTO path (public_id, map_domain_id, name, subtype, is_bach, geom, source_system, is_active)
            VALUES (${weg}::uuid, 'aventuria', ${`B9 Weg ${String(n)}`}, 'Flussweg', false, ST_GeomFromText(${wkt}, 0), ${SOURCE}, true)
        `;
        return weg;
    }
    async function legeRegion(n: number, aktiv = true): Promise<string> {
        const region = id("8200", n);
        await database`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, source_system, is_active)
            VALUES (${region}::uuid, 'aventuria', ${`B9 Land ${String(n)}`}, 'topographie', 'gebirge', ${SOURCE}, ${aktiv})
        `;
        return region;
    }
    async function legeTeilflaeche(n: number, region: string, wkt: string, aktiv = true): Promise<string> {
        const teil = id("8210", n);
        await database`
            INSERT INTO region_area (public_id, region_id, map_domain_id, geom, source_system, is_active)
            SELECT ${teil}::uuid, r.id, 'aventuria', ST_GeomFromText(${wkt}, 0), ${SOURCE}, ${aktiv} FROM region r WHERE r.public_id = ${region}::uuid
        `;
        return teil;
    }
    async function legeQuelle(n: number, korpus?: string): Promise<string> {
        const [zeile] = await database<{ public_id: string }[]>`
            INSERT INTO feature_source (source_key, identity_state, legacy_source_id, title, source_type, is_official, corpus_key)
            VALUES (${`legacy-id:${String(990000 + n)}`}, 'provisional', ${990000 + n}, ${`B9 Quelle ${String(n)}`}, 'regelbuch', true, ${korpus ?? null})
            RETURNING public_id::text
        `;
        return zeile!.public_id;
    }
    async function quelleAmOrt(quelle: string, ortId: string, position = 0): Promise<void> {
        await database`
            INSERT INTO place_source (place_id, source_id, position, source_system)
            SELECT p.id, f.id, ${position}, 'legacy' FROM place p, feature_source f WHERE p.public_id = ${ortId}::uuid AND f.public_id = ${quelle}::uuid
        `;
    }

    const get = (url: string, role?: Role) =>
        app.inject({ method: "GET", url, headers: role === undefined ? {} : { cookie: cookies.get(role) ?? "" } });
    const lage = async (n: number, ...mit: number[]): Promise<Lage> => {
        const antwort = await get(editorChangeLageUrl(op(n), mit.map(op)), "reviewer");
        expect(antwort.statusCode).toBe(200);
        const koerper = antwort.json() as Lage;
        expect(Value.Check(MapChangeLage, koerper)).toBe(true);
        return koerper;
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await aufraeumen();
        fixture = authFixture(database);
        for (const role of ["tester", "reviewer", "editor"] as const) {
            const person = await fixture.person(role, { name: `Lage ${role}` });
            cookies.set(role, (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie);
        }
        app = buildApp({
            config,
            database: createDatabase(testDatabaseUrl as string, { max: 4 }),
            logStream: { write: () => undefined },
        });
        await app.ready();
    }, 180_000);

    // Nach den Läufen mit fünftausend Orten räumt der Haken länger auf (Auslöser je Zeile).
    beforeEach(aufraeumen, 120_000);

    afterAll(async () => {
        await app?.close();
        await aufraeumen();
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    describe("Rechte und Vertrag", () => {
        it("🔴 Besucher 401, Tester 403, Reviewer liest; privat; eine unbekannte Änderung ist 404; eine zerbrochene Kennung 400", async () => {
            await legeOrt(1, 80, 90);
            await operation(1, { place: ort(1) });
            const url = editorChangeLageUrl(op(1));
            expect((await get(url)).statusCode).toBe(401);
            expect((await get(url, "tester")).statusCode).toBe(403);
            const antwort = await get(url, "reviewer");
            expect(antwort.statusCode).toBe(200);
            expect(antwort.headers["cache-control"]).toBe("private, no-cache");
            expect(Value.Check(MapChangeLage, antwort.json())).toBe(true);
            expect((await get(editorChangeLageUrl(op(999)), "reviewer")).statusCode).toBe(404);
            expect((await get(`/api/editor/changes/keine-kennung/lage`, "reviewer")).statusCode).toBe(400);
            for (const mit of ["x", `${op(1)},nicht`, `${op(1)},`])
                expect([mit, (await get(`${url}?mit=${mit}`, "reviewer")).statusCode]).toEqual([mit, 400]);
        });
    });

    describe("Lage je Art", () => {
        it("🔴 ein Ort: sein Punkt; ein Feld ohne Geometrie im Protokoll braucht genau diese Antwort", async () => {
            await legeOrt(1, 80, 90);
            await operation(1, { place: ort(1) });
            expect(await lage(1)).toEqual({ grenzen: [80, 90, 80, 90], gegenstaende: 1, stillgelegt: 0 });
        });

        it("mehrere Orte und ein Weg in einer Operation: EIN Kasten um alle, gezählt als Gegenstände", async () => {
            await legeOrt(1, 80, 90);
            await legeOrt(2, 200, 300);
            const weg = await legeWeg(1, "LINESTRING(100 100, 150 130)");
            await operation(1, { place: ort(1) }, { place: ort(2) }, { path: weg }, { place: ort(1) });
            expect(await lage(1)).toEqual({ grenzen: [80, 90, 200, 300], gegenstaende: 3, stillgelegt: 0 });
        });

        it("🔴 ein stillgelegter Ort zählt mit seiner letzten Lage und wird gemeldet; ein gültiger daneben bestimmt den Kasten nicht allein", async () => {
            await legeOrt(1, 400, 400, false);
            await operation(1, { place: ort(1) });
            expect(await lage(1)).toEqual({ grenzen: [400, 400, 400, 400], gegenstaende: 1, stillgelegt: 1 });
            await legeOrt(2, 100, 100);
            await operation(2, { place: ort(1) }, { place: ort(2) });
            expect(await lage(2)).toEqual({ grenzen: [100, 100, 400, 400], gegenstaende: 2, stillgelegt: 1 });
        });

        it("🔴 ein Ort ohne Lage (von der Karte genommen) und ein Gegenstand, den es nicht mehr gibt, sind keine Lage und kein Fehler", async () => {
            await database`INSERT INTO place_unplaced (public_id, map_domain_id, name, subtype, source_system) VALUES (${ort(1)}::uuid, 'aventuria', 'B9 ohne Lage', 'dorf', ${SOURCE})`;
            await operation(1, { place: ort(1) }, { place: randomUUID() }, { path: randomUUID() });
            expect(await lage(1)).toEqual({ grenzen: null, gegenstaende: 0, stillgelegt: 0 });
        });

        it("🔴 eine Teilfläche zeigt sich selbst, nicht die ganze Landschaft; die Landschaft die gültigen Teilflächen, nicht die alte weit weg", async () => {
            const land = await legeRegion(1);
            const nah = await legeTeilflaeche(1, land, rechteck(100, 400, 120, 420));
            await legeTeilflaeche(2, land, rechteck(160, 400, 180, 420));
            await legeTeilflaeche(3, land, rechteck(10, 10, 20, 20), false);
            // Wie der Schreibweg: Die Teilfläche trägt ihre Landschaft mit.
            await operation(1, { region: land, region_area: nah });
            expect(await lage(1)).toEqual({ grenzen: [100, 400, 120, 420], gegenstaende: 1, stillgelegt: 0 });
            await operation(2, { region: land });
            expect(await lage(2)).toEqual({ grenzen: [100, 400, 180, 420], gegenstaende: 1, stillgelegt: 0 });
        });

        it("eine stillgelegte Landschaft zählt mit allen ihren Flächen und wird gemeldet", async () => {
            const land = await legeRegion(1, false);
            await legeTeilflaeche(1, land, rechteck(100, 400, 120, 420), false);
            await legeTeilflaeche(2, land, rechteck(160, 410, 180, 430), false);
            await operation(1, { region: land });
            expect(await lage(1)).toEqual({ grenzen: [100, 400, 180, 430], gegenstaende: 1, stillgelegt: 1 });
        });

        it("Beschriftung, Gipfel, Kraftlinie, Kraftlinienpunkt, Gebiet und Gebietsfläche", async () => {
            const land = await legeRegion(1);
            await database`
                INSERT INTO map_label (public_id, map_domain_id, region_id, name, geom, source_system)
                SELECT ${id("8300", 1)}::uuid, 'aventuria', r.id, 'B9 Name', ST_SetSRID(ST_MakePoint(110, 410), 0), ${SOURCE} FROM region r WHERE r.public_id = ${land}::uuid
            `;
            await database`
                INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, geom, height_schritt, source_system, is_active)
                VALUES (${id("8400", 1)}::uuid, 'aventuria', 'B9 Gipfel', 'berggipfel', ST_SetSRID(ST_MakePoint(250, 250), 0), 2500, ${SOURCE}, true)
            `;
            await database`
                INSERT INTO powerline (public_id, map_domain_id, name, label_visible, from_public_id, to_public_id, geom, drawn_geom, source_system)
                VALUES (${id("8500", 1)}::uuid, 'aventuria', 'B9 Linie', true, ${randomUUID()}::uuid, ${randomUUID()}::uuid,
                        ST_GeomFromText('LINESTRING(300 100, 340 140)', 0), ST_GeomFromText('LINESTRING(300 100, 330 150)', 0), ${SOURCE})
            `;
            await database`
                INSERT INTO nodix (public_id, map_domain_id, legacy_kind, geom, source_system)
                VALUES (${id("8600", 1)}::uuid, 'aventuria', 'junction', ST_SetSRID(ST_MakePoint(350, 160), 0), ${SOURCE})
            `;
            await database`
                INSERT INTO territory (public_id, map_domain_id, name, color, opacity, source_system)
                VALUES (${id("8700", 1)}::uuid, 'aventuria', 'B9 Gebiet', '#336699', 0.5, ${SOURCE})
            `;
            for (const [n, wkt] of [
                [1, rechteck(50, 50, 70, 70)],
                [2, rechteck(60, 60, 90, 80)],
            ] as const)
                await database`
                    INSERT INTO territory_area (public_id, territory_id, map_domain_id, geom, source_system)
                    SELECT ${id("8710", n)}::uuid, t.id, 'aventuria', ST_Multi(ST_GeomFromText(${wkt}, 0)), ${SOURCE}
                      FROM territory t WHERE t.public_id = ${id("8700", 1)}::uuid
                `;
            await operation(1, { region: land, map_label: id("8300", 1) });
            expect(await lage(1)).toEqual({ grenzen: [110, 410, 110, 410], gegenstaende: 1, stillgelegt: 0 });
            await operation(2, { peak: id("8400", 1) });
            expect(await lage(2)).toEqual({ grenzen: [250, 250, 250, 250], gegenstaende: 1, stillgelegt: 0 });
            await operation(3, { powerline: id("8500", 1) });
            // Die gezeichnete Bahn (drawn_geom), nicht Legacys gespeicherte Linie.
            expect(await lage(3)).toEqual({ grenzen: [300, 100, 330, 150], gegenstaende: 1, stillgelegt: 0 });
            await operation(4, { nodix: id("8600", 1) });
            expect(await lage(4)).toEqual({ grenzen: [350, 160, 350, 160], gegenstaende: 1, stillgelegt: 0 });
            await operation(5, { territory: id("8700", 1) });
            expect(await lage(5)).toEqual({ grenzen: [50, 50, 90, 80], gegenstaende: 1, stillgelegt: 0 });
            await operation(6, { territory: id("8700", 1), territory_area: id("8710", 2) });
            expect(await lage(6)).toEqual({ grenzen: [60, 60, 90, 80], gegenstaende: 1, stillgelegt: 0 });
        });

        it("Sprache, Sprachfläche und Sprachartikel (die Flächen ihrer Sprache)", async () => {
            const sprachen: string[] = [];
            for (const [n, wkt] of [
                [1, rechteck(100, 100, 140, 140)],
                [2, rechteck(300, 300, 340, 320)],
            ] as const) {
                const [s] = await database<{ public_id: string }[]>`
                    INSERT INTO sprache (schluessel, name, farbe, reihenfolge, herkunft)
                    VALUES (${`b9-lage-${String(n)}`}, ${`B9 Sprache ${String(n)}`}, '#8f6fb3', ${900 + n}, 'redaktion') RETURNING public_id::text
                `;
                sprachen.push(s!.public_id);
                await database`
                    INSERT INTO sprache_flaeche (public_id, sprache_id, map_domain_id, geom, herkunft)
                    SELECT ${id("8800", n)}::uuid, s.id, 'aventuria', ST_GeomFromText(${wkt}, 0), 'redaktion' FROM sprache s WHERE s.public_id = ${s!.public_id}::uuid
                `;
            }
            const artikel: string[] = [];
            for (let n = 1; n <= 3; n += 1) {
                const [a] = await database<{ public_id: string }[]>`
                    INSERT INTO wiki_sprache_artikel (schluessel, titel, kurzbeschreibung, sprachfamilie)
                    VALUES (${`b9-lage-${String(n)}`}, ${`B9 Artikel ${String(n)}`}, 'Kurz', 'Testfamilie') RETURNING public_id::text
                `;
                artikel.push(a!.public_id);
                // Artikel 1 und 2 gehören zur ersten Sprache, Artikel 3 zur zweiten.
                await database`
                    INSERT INTO sprache_wiki (sprache_id, wiki_sprache_artikel_id, position, herkunft)
                    SELECT s.id, w.id, ${n}, 'import' FROM sprache s, wiki_sprache_artikel w
                     WHERE s.public_id = ${sprachen[n === 3 ? 1 : 0]!}::uuid AND w.public_id = ${a!.public_id}::uuid
                `;
            }
            await operation(1, { sprache: sprachen[0]! });
            expect(await lage(1)).toEqual({ grenzen: [100, 100, 140, 140], gegenstaende: 1, stillgelegt: 0 });
            await operation(2, { sprache: sprachen[0]!, sprache_flaeche: id("8800", 1) });
            expect(await lage(2)).toEqual({ grenzen: [100, 100, 140, 140], gegenstaende: 1, stillgelegt: 0 });
            await operation(3, ...artikel.map((a) => ({ sprache_artikel: a })));
            expect(await lage(3)).toEqual({ grenzen: [100, 100, 340, 320], gegenstaende: 3, stillgelegt: 0 });
        });
    });

    describe("Inhalte: die Orte ihrer Träger", () => {
        it("🔴 eine Quelle liegt bei den Trägern, die sie nennen; eine Quelle ohne Träger hat keine Lage", async () => {
            await legeOrt(1, 80, 90);
            await legeOrt(2, 200, 300);
            const weg = await legeWeg(1, "LINESTRING(400 100, 420 130)");
            const quelle = await legeQuelle(1);
            await quelleAmOrt(quelle, ort(1));
            await quelleAmOrt(quelle, ort(2), 1);
            await database`
                INSERT INTO path_source (path_id, source_id, position, source_system)
                SELECT w.id, f.id, 0, 'legacy' FROM path w, feature_source f WHERE w.public_id = ${weg}::uuid AND f.public_id = ${quelle}::uuid
            `;
            await operation(1, { source: quelle });
            expect(await lage(1)).toEqual({ grenzen: [80, 90, 420, 300], gegenstaende: 1, stillgelegt: 0 });
            const leer = await legeQuelle(2);
            await operation(2, { source: leer });
            expect(await lage(2)).toEqual({ grenzen: null, gegenstaende: 0, stillgelegt: 0 });
        });

        it("ein Korpus liegt bei den Trägern aller seiner Quellen", async () => {
            await legeOrt(1, 80, 90);
            await legeOrt(2, 200, 300);
            const [korpus] = await database<{ public_id: string }[]>`
                INSERT INTO source_corpus (corpus_key, label, form, source_system) VALUES ('b9-lage-korpus.example', 'B9', '', 'legacy') RETURNING public_id::text
            `;
            await quelleAmOrt(await legeQuelle(1, "b9-lage-korpus.example"), ort(1));
            await quelleAmOrt(await legeQuelle(2, "b9-lage-korpus.example"), ort(2));
            await quelleAmOrt(await legeQuelle(3), await legeOrt(3, 450, 450));
            await operation(1, { corpus: korpus!.public_id });
            expect(await lage(1)).toEqual({ grenzen: [80, 90, 200, 300], gegenstaende: 1, stillgelegt: 0 });
        });

        it("🔴 ein Werk liegt bei den aufgelösten Orten seiner Ortsbezüge; ohne Orte (auch nur ungelöste) hat es keine Lage", async () => {
            await legeOrt(1, 80, 90);
            const [werk] = await database<{ id: string }[]>`
                INSERT INTO adventure (public_id, title, product_type, is_official, source_system)
                VALUES (${id("8900", 1)}::uuid, 'B9 Werk', 'gruppenabenteuer', true, 'legacy') RETURNING id::text
            `;
            await database`
                INSERT INTO adventure_place (adventure_id, sort_order, export_ordinal, name_key, raw_name, role, target_state, source_system)
                VALUES (${werk!.id}::bigint, 0, 0, 'ungeloest', 'Ungelöst', 'play', 'unresolved', 'legacy')
            `;
            await operation(1, { work: id("8900", 1) });
            expect(await lage(1)).toEqual({ grenzen: null, gegenstaende: 0, stillgelegt: 0 });
            await database`
                INSERT INTO adventure_place (adventure_id, sort_order, export_ordinal, name_key, raw_name, role, target_state, resolved_by, place_id, source_system)
                SELECT ${werk!.id}::bigint, 1, 1, 'ort', 'Ort', 'start', 'resolved', 'public_id', p.id, 'legacy' FROM place p WHERE p.public_id = ${ort(1)}::uuid
            `;
            expect(await lage(1)).toEqual({ grenzen: [80, 90, 80, 90], gegenstaende: 1, stillgelegt: 0 });
        });

        it("ein Vorkommen liegt bei den Zielen seiner Ortszeilen (Ort, Landschaft)", async () => {
            await legeOrt(1, 80, 90);
            const land = await legeRegion(1);
            await legeTeilflaeche(1, land, rechteck(300, 300, 320, 330));
            const [eintrag] = await database<{ id: string }[]>`
                INSERT INTO lore_entry (public_id, wiki_key, kind, name, wiki_title, legacy_origin, state, source_system, is_active)
                VALUES (${id("8a00", 1)}::uuid, 'b9-lage-vorkommen', 'fauna', 'B9 Vorkommen', 'B9', 'wiki', 'active', 'legacy', true) RETURNING id::text
            `;
            const [zeile] = await database<{ id: string }[]>`
                INSERT INTO lore_place (lore_entry_id, place_wiki_key, relation, place_title, sort_order, key_class, target_state, target_count, legacy_origin, source_system)
                VALUES (${eintrag!.id}::bigint, 'b9-ort', 'vorkommen', 'B9', 1, 'other', 'ambiguous', 2, 'manual', 'test') RETURNING id::text
            `;
            await database`INSERT INTO lore_place_target (lore_place_id, place_id) SELECT ${zeile!.id}::bigint, id FROM place WHERE public_id = ${ort(1)}::uuid`;
            await database`INSERT INTO lore_place_target (lore_place_id, region_id) SELECT ${zeile!.id}::bigint, id FROM region WHERE public_id = ${land}::uuid`;
            await operation(1, { lore: id("8a00", 1) });
            expect(await lage(1)).toEqual({ grenzen: [80, 90, 320, 330], gegenstaende: 1, stillgelegt: 0 });
        });
    });

    describe("Mehrere Operationen (eine Arbeitsserie)", () => {
        it("`mit` rechnet die Operationen zusammen; eine fremde Kennung trägt nichts bei", async () => {
            await legeOrt(1, 80, 90);
            await legeOrt(2, 200, 300);
            await operation(1, { place: ort(1) });
            await operation(2, { place: ort(2) });
            expect(await lage(1)).toEqual({ grenzen: [80, 90, 80, 90], gegenstaende: 1, stillgelegt: 0 });
            expect(await lage(1, 2)).toEqual({ grenzen: [80, 90, 200, 300], gegenstaende: 2, stillgelegt: 0 });
            const antwort = await get(editorChangeLageUrl(op(1), [randomUUID()]), "reviewer");
            expect((antwort.json() as Lage).grenzen).toEqual([80, 90, 80, 90]);
        });
    });

    describe("Viele Gegenstände", () => {
        it(`🔴 ${String(VIELE)} Orte in einer Operation (ein Wiki-Lauf): ein Kasten, ein Zugriff je Art, in Millisekunden statt einer Schleife`, async () => {
            await database`
                INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system)
                SELECT (${`${P}8001-`}::text || lpad(i::text, 12, '0'))::uuid, 'aventuria', 'B9 Wiki ' || i, 'dorf',
                       ST_SetSRID(ST_MakePoint(60 + (i % 71) * 5, 60 + (i / 71) * 5), 0), ${SOURCE}
                  FROM generate_series(1, ${VIELE}) i
            `;
            await database`
                INSERT INTO map_operation (operation_id, map_domain_id, action, source, environment, actor_kind, actor_label)
                VALUES (${op(1)}::uuid, 'aventuria', 'test.changes_lage', 'import', 'test', 'system', 'test')
            `;
            await database`
                INSERT INTO map_audit_event (operation_id, action, place_public_id, changes)
                SELECT ${op(1)}::uuid, 'test.geaendert', public_id, '{}'::jsonb FROM place WHERE public_id::text LIKE ${`${P}8001-%`}
            `;
            const start = performance.now();
            const antwort = await aenderungLage(database, op(1), { mapDomainId: "aventuria" });
            const dauer = performance.now() - start;
            expect(antwort).toEqual({
                grenzen: [60, 60, 410, 60 + Math.floor(VIELE / 71) * 5],
                gegenstaende: VIELE,
                stillgelegt: 0,
            });
            // Gemessen (lokal, 2026-11-01, kalte Verbindung): rund 150 ms für 5.069 Orte, rund 80 ms für 5.069 Träger einer Quelle. Die Grenze fängt eine Schleife je Gegenstand, nicht die Tagesform des Rechners.
            expect(dauer).toBeLessThan(2500);
        });

        it("viele Träger einer Quelle (fünftausend Orte, EINE Quelle) bleiben EINE Abfrage", async () => {
            await database`
                INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system)
                SELECT (${`${P}8001-`}::text || lpad(i::text, 12, '0'))::uuid, 'aventuria', 'B9 Träger ' || i, 'dorf',
                       ST_SetSRID(ST_MakePoint(60 + (i % 71) * 5, 60 + (i / 71) * 5), 0), ${SOURCE}
                  FROM generate_series(1, ${VIELE}) i
            `;
            const quelle = await legeQuelle(1);
            await database`
                INSERT INTO place_source (place_id, source_id, position, source_system)
                SELECT p.id, f.id, 0, 'legacy' FROM place p, feature_source f
                 WHERE p.public_id::text LIKE ${`${P}8001-%`} AND f.public_id = ${quelle}::uuid
            `;
            await operation(1, { source: quelle });
            const start = performance.now();
            const antwort = await aenderungLage(database, op(1), { mapDomainId: "aventuria" });
            const dauer = performance.now() - start;
            expect(antwort?.gegenstaende).toBe(1);
            expect(antwort?.grenzen).toEqual([60, 60, 410, 60 + Math.floor(VIELE / 71) * 5]);
            expect(dauer).toBeLessThan(2500);
        });
    });
});
