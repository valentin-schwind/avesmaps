import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AREA_LOOKUP_LIMITS } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { areaOutlines, areasAt } from "../src/areas/area-lookup.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";

/**
 * Die Kartenauswahl per Serverabfrage (WI-0058) gegen echtes PostGIS: welche Flächen unter einem Punkt liegen,
 * welche Flüsse im Umkreis, und die Umrisse für Vorschau und Leuchten. Dieselben Filter wie die Kacheln.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/** Eigene Kennungen (…0058…) und eine eigene Ecke der Karte, damit der Test keinen fremden Bestand berührt. */
const ID = {
    gebirge: "00000000-0000-4000-8000-0000000058a1",
    tal: "00000000-0000-4000-8000-0000000058a2",
    see: "00000000-0000-4000-8000-0000000058a3",
    wald: "00000000-0000-4000-8000-0000000058a4",
    still: "00000000-0000-4000-8000-0000000058a5",
    fluss: "00000000-0000-4000-8000-0000000058b1",
    namenlos: "00000000-0000-4000-8000-0000000058b2",
    fern: "00000000-0000-4000-8000-0000000058b3",
};
const square = (x0: number, y0: number, x1: number, y1: number): string =>
    `POLYGON((${String(x0)} ${String(y0)},${String(x1)} ${String(y0)},${String(x1)} ${String(y1)},${String(x0)} ${String(y1)},${String(x0)} ${String(y0)}))`;
/** Eine Treppe wie Legacys abgezeichnete Seen: Ecken auf 0,125 E. */
const stairs = (x0: number, y0: number): string => {
    const points: string[] = [];
    for (let i = 0; i < 8; i += 1)
        points.push(
            `${String(x0 + i * 0.125)} ${String(y0 + i * 0.125)}`,
            `${String(x0 + (i + 1) * 0.125)} ${String(y0 + i * 0.125)}`,
        );
    points.push(
        `${String(x0 + 1)} ${String(y0 + 1)}`,
        `${String(x0)} ${String(y0 + 1)}`,
        `${String(x0)} ${String(y0)}`,
    );
    return `POLYGON((${points.join(",")}))`;
};

describeWithDatabase("Kartenauswahl per Serverabfrage gegen PostGIS", () => {
    let database: Database;
    let app: FastifyInstance | undefined;

    async function region(publicId: string, name: string, layer: string, type: string, active = true): Promise<number> {
        const [row] = await database<{ id: string }[]>`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active)
            VALUES (${publicId}, 'aventuria', ${name}, ${layer}, ${type}, ${active})
            ON CONFLICT (public_id) DO UPDATE SET name = EXCLUDED.name, region_type = EXCLUDED.region_type,
                region_layer = EXCLUDED.region_layer, is_active = EXCLUDED.is_active
            RETURNING id::text
        `;
        return Number(row?.id);
    }
    async function area(regionId: number, wkt: string): Promise<void> {
        await database`
            INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active)
            VALUES (gen_random_uuid(), 'aventuria', ${regionId}, ST_GeomFromText(${wkt}), true)
        `;
    }
    async function river(
        publicId: string,
        name: string,
        x0: number,
        y0: number,
        x1: number,
        y1: number,
    ): Promise<void> {
        await database`
            INSERT INTO path (public_id, map_domain_id, name, subtype, is_bach, geom, source_system, is_active)
            VALUES (${publicId}, 'aventuria', ${name}, 'Flussweg', false,
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(${x0}, ${y0}), ST_MakePoint(${x1}, ${y1})), 0), 'test', true)
            ON CONFLICT (public_id) DO NOTHING
        `;
    }
    async function cleanup(): Promise<void> {
        const ids = Object.values(ID);
        await database`DELETE FROM path WHERE public_id = ANY(${ids}::uuid[])`;
        await database`DELETE FROM region_area WHERE region_id IN (SELECT id FROM region WHERE public_id = ANY(${ids}::uuid[]))`;
        await database`DELETE FROM region WHERE public_id = ANY(${ids}::uuid[])`;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await cleanup();
        // Ein Gebirge mit einem Tal darin, ein See, ein Wald (andere Ebene) und eine stillgelegte Fläche.
        await area(await region(ID.gebirge, "Testgebirge", "topographie", "gebirge"), square(950, 20, 990, 60));
        await area(await region(ID.tal, "Testtal", "topographie", "tal"), square(960, 30, 970, 40));
        await area(await region(ID.see, "Testsee", "topographie", "see"), stairs(975, 45));
        await area(await region(ID.wald, "Testwald", "vegetation", "wald"), square(955, 25, 975, 45));
        await area(await region(ID.still, "Still", "topographie", "steppe", false), square(950, 20, 990, 60));
        // Ein Fluss durchs Tal, ein Lauf ohne Namen daneben, ein Fluss weit weg.
        await river(ID.fluss, "Testfluss", 960, 35, 970, 35);
        await river(ID.namenlos, " ", 960, 35.5, 970, 35.5);
        await river(ID.fern, "Fernfluss", 960, 55, 970, 55);
    });

    afterEach(async () => {
        await app?.close();
        app = undefined;
    });

    afterAll(async () => {
        await cleanup();
        await database.end({ timeout: 5 });
    });

    const at = (x: number, y: number, extra: Partial<Parameters<typeof areasAt>[1]> = {}) =>
        areasAt(database, { x, y, layers: ["topographie"], lakes: true, reach: 0, ...extra });

    it("🔴 findet die Flächen der gewählten Ebenen unter dem Punkt, nicht die stillgelegten", async () => {
        const found = await at(965, 35);
        expect(found.areas.map((row) => row.region_public_id).sort()).toEqual([ID.gebirge, ID.tal].sort());
        expect(found.areas.find((row) => row.region_public_id === ID.tal)).toMatchObject({
            name: "Testtal",
            region_type: "tal",
            region_layer: "topographie",
            area: 100,
            is_locked: false,
        });
        // Mit der Vegetation dazu auch der Wald.
        const beide = await at(965, 35, { layers: ["topographie", "vegetation"] });
        expect(beide.areas.map((row) => row.region_public_id)).toContain(ID.wald);
        expect(found.rivers).toEqual([]);
    });

    it("lässt Seen weg, wenn der Schalter „Flüsse und Seen“ sie ausblendet", async () => {
        expect((await at(975.1, 45.9)).areas.map((row) => row.region_public_id)).toContain(ID.see);
        expect((await at(975.1, 45.9, { lakes: false })).areas.map((row) => row.region_public_id)).not.toContain(
            ID.see,
        );
    });

    it("🔴 findet benannte Flüsse im Umkreis, keine Läufe ohne Namen und keine fernen", async () => {
        const found = await at(965, 35.3, { reach: 0.5 });
        expect(found.rivers).toEqual([{ name: "Testfluss", subtype: "Flussweg", is_bach: false }]);
        expect((await at(965, 38, { reach: 0.5 })).rivers).toEqual([]);
    });

    it("🔴 liefert Umrisse je Fläche; geglättet wird nur Wasser, vereinfacht je Zoom", async () => {
        const nah = await areaOutlines(database, [ID.see, ID.tal], 12, false);
        expect(nah.features.map((f) => f.properties.region_public_id).sort()).toEqual([ID.see, ID.tal].sort());
        const ring = (collection: typeof nah, id: string): unknown[] =>
            ((collection.features.find((f) => f.properties.region_public_id === id)?.geometry.coordinates ?? [[]])[0] ??
                []) as unknown[];
        const glatt = await areaOutlines(database, [ID.see, ID.tal], 12, true);
        // Die Treppe hat 19 Ecken; geglättet (Chaikin, drei Durchgänge) sind es viel mehr, das Tal bleibt ein Quadrat.
        expect(ring(glatt, ID.see).length).toBeGreaterThan(ring(nah, ID.see).length * 2);
        expect(ring(glatt, ID.tal).length).toBe(5);
        // Aus der Ferne (Zoom 2: 0,25 E) fallen die Stufen der Treppe weg.
        const fern = await areaOutlines(database, [ID.see], 2, false);
        expect(ring(fern, ID.see).length).toBeLessThan(ring(nah, ID.see).length);
    });

    it("antwortet über GET, prüft die Eingaben und darf kurz im Cache liegen", async () => {
        const own = createDatabase(testDatabaseUrl as string, { max: 2 });
        const config = { port: 0, host: "127.0.0.1", releaseId: "test", databaseUrl: undefined, tileRoot: undefined };
        app = buildApp({ config, database: own });
        const ok = await app.inject({ url: "/api/areas/at?x=965&y=35.3&layers=topographie&reach=0.5" });
        expect(ok.statusCode).toBe(200);
        expect(ok.headers["cache-control"]).toBe("public, max-age=60");
        expect(ok.json<{ rivers: unknown[] }>().rivers).toHaveLength(1);
        const umriss = await app.inject({ url: `/api/areas/outline?ids=${ID.tal}&z=6` });
        expect(umriss.statusCode).toBe(200);
        expect(umriss.json<{ features: unknown[] }>().features).toHaveLength(1);
        // Die Kachelrevision (WI-0178 B3) macht nur die Adresse neu; der Server nimmt sie an und antwortet gleich.
        const mitRevision = await app.inject({ url: `/api/areas/outline?ids=${ID.tal}&z=6&r=812` });
        expect(mitRevision.statusCode).toBe(200);
        expect(mitRevision.json()).toEqual(umriss.json());
        expect((await app.inject({ url: "/api/areas/at?x=965&y=35.3&layers=topographie&r=812" })).statusCode).toBe(200);
        for (const bad of [
            "/api/areas/at?x=2000&y=1&layers=topographie",
            "/api/areas/at?x=1&y=1&layers=klima",
            "/api/areas/at?x=1&y=1&layers=topographie&reach=99",
            "/api/areas/outline?ids=nope&z=3",
            `/api/areas/outline?ids=${ID.tal}&z=99`,
            `/api/areas/outline?ids=${ID.tal}&z=6&r=-1`,
        ]) {
            expect((await app.inject({ url: bad })).statusCode, bad).toBe(400);
        }
        await own.end({ timeout: 5 });
    });

    /**
     * 🔴 WI-0123: Wer die Antwort nicht mehr abwartet, beschäftigt die Datenbank nicht weiter - dieselbe Behandlung wie bei
     * den Landschaften der Route (`bebb4630`, WI-0065). Die Karte bricht die alte Frage ab, sobald der Zeiger weiterzieht;
     * vorher rechnete der Server jede davon bis zum Ende oder bis zur Zeitgrenze (1 s) weiter, und vier solche Leichen
     * belegten die Plätze, die die nächste Frage mit 503 `busy` abwiesen.
     */
    describe("Abbruch durch den Client", () => {
        /** Großzügig: Gemessen wird die Zeit vom Schließen bis zur Ruhe in der Datenbank, nicht die Dauer des Falls. */
        const TIMEOUT_MS = 30_000;
        const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
        const until = async (condition: () => Promise<boolean>, limitMs: number): Promise<boolean> => {
            const end = performance.now() + limitMs;
            while (performance.now() < end) {
                if (await condition()) return true;
                await wait(20);
            }
            return condition();
        };
        /** Abfragen der Kartenauswahl, die in der Datenbank auf die Sperre der Flächen warten. */
        const waiting = async (): Promise<number> => {
            const [row] = await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM pg_stat_activity
                WHERE pid <> pg_backend_pid() AND state = 'active' AND wait_event_type = 'Lock'
                  AND query LIKE '%FROM region_area a%'
            `;
            return row?.n ?? -1;
        };
        /** Sperrt die Flächen, bis `release` gerufen wird: Jede Abfrage kommt bis in die Datenbank und wartet dort. */
        const lockAreas = async (): Promise<{ release: () => Promise<void> }> => {
            let free!: () => void;
            const released = new Promise<void>((resolve) => {
                free = resolve;
            });
            let locked!: () => void;
            const lockTaken = new Promise<void>((resolve) => {
                locked = resolve;
            });
            const holder = database.begin(async (transaction) => {
                await transaction`LOCK TABLE region_area IN ACCESS EXCLUSIVE MODE`;
                locked();
                await released;
            });
            await lockTaken;
            return {
                release: async () => {
                    free();
                    await holder;
                },
            };
        };

        it(
            "bricht beide Abfragen in der Datenbank ab (57014), sobald das Signal feuert",
            async () => {
                const own = createDatabase(testDatabaseUrl as string, { max: 4 });
                const lock = await lockAreas();
                try {
                    const atWindow = new AbortController();
                    const outlineWindow = new AbortController();
                    const started = performance.now();
                    // Eine Zeitgrenze weit über der Wartezeit des Tests: Nicht sie beendet die Abfragen.
                    const pending = [
                        areasAt(
                            own,
                            { x: 965, y: 35, layers: ["topographie"], lakes: true, reach: 0 },
                            "aventuria",
                            30_000,
                            atWindow.signal,
                        ),
                        areaOutlines(own, [ID.tal], 6, true, "aventuria", 30_000, outlineWindow.signal),
                    ].map((query) => expect(query).rejects.toMatchObject({ code: "57014" }));
                    expect(await until(async () => (await waiting()) === 2, 3_000)).toBe(true);
                    atWindow.abort();
                    outlineWindow.abort();
                    await Promise.all(pending);
                    expect(performance.now() - started).toBeLessThan(5_000);
                    expect(await waiting()).toBe(0);
                } finally {
                    await lock.release();
                    await own.end({ timeout: 5 });
                }
                // Ein Signal, das schon gefeuert hat, beginnt nichts.
                const gone = new AbortController();
                gone.abort();
                await expect(
                    areasAt(
                        database,
                        { x: 965, y: 35, layers: ["topographie"], lakes: true, reach: 0 },
                        "aventuria",
                        1_000,
                        gone.signal,
                    ),
                ).rejects.toMatchObject({ name: "AbortError" });
            },
            TIMEOUT_MS,
        );

        it(
            "🔴 über HTTP: geschlossene Fenster geben die Plätze frei, lange vor der Zeitgrenze, ohne busy",
            async () => {
                const own = createDatabase(testDatabaseUrl as string, { max: 10 });
                const config = {
                    port: 0,
                    host: "127.0.0.1",
                    releaseId: "test",
                    databaseUrl: undefined,
                    tileRoot: undefined,
                };
                app = buildApp({ config, database: own });
                await app.listen({ port: 0, host: "127.0.0.1" });
                const address = app.server.address();
                const base = `http://127.0.0.1:${String(typeof address === "object" && address ? address.port : 0)}`;
                const at = `${base}/api/areas/at?x=965&y=35&layers=topographie`;
                const outline = `${base}/api/areas/outline?ids=${ID.tal}&z=6&smooth=true`;
                const get = (url: string, signal?: AbortSignal) => fetch(url, signal ? { signal } : {});

                // Kontrolle: Eine Anfrage, die zu Ende läuft, wird nicht für abgebrochen gehalten.
                const control = await get(at);
                expect(control.status).toBe(200);
                expect((await control.json()) as { areas: unknown[] }).toMatchObject({ areas: [{}, {}] });

                const lock = await lockAreas();
                // Wann die Fenster zugingen; ein Halter, weil es im try gesetzt und danach gelesen wird.
                const closed = { at: 0 };
                try {
                    // Alle vier Plätze belegt, beide Routen: Die fünfte Frage wird abgewiesen.
                    const windows = Array.from({ length: AREA_LOOKUP_LIMITS.concurrent }, () => new AbortController());
                    const pending = windows.map((window, index) =>
                        get(index % 2 === 0 ? at : outline, window.signal).then(
                            (response) => String(response.status),
                            (error: unknown) => (error instanceof Error ? error.name : "unbekannt"),
                        ),
                    );
                    expect(await until(async () => (await waiting()) === windows.length, 3_000)).toBe(true);
                    const busy = await get(at);
                    expect(busy.status).toBe(503);
                    expect(await busy.json()).toEqual({ error: "busy" });

                    // Die Fenster gehen zu. Die Zeitgrenze der Abfragen (1 s) ist NICHT der Grund fürs Ende.
                    closed.at = performance.now();
                    for (const window of windows) window.abort();
                    expect(await Promise.all(pending)).toEqual(windows.map(() => "AbortError"));
                    expect(await until(async () => (await waiting()) === 0, 2_000)).toBe(true);
                    expect(performance.now() - closed.at).toBeLessThan(AREA_LOOKUP_LIMITS.statementMs * 0.6);
                } finally {
                    await lock.release();
                }

                // Danach ist Platz, ebenfalls vor der Zeitgrenze: Abgewartet wird nur das Rückrollen der Transaktionen.
                let status = 0;
                const free = await until(async () => {
                    status = (await get(at)).status;
                    return status !== 503;
                }, 1_000);
                expect(free).toBe(true);
                expect(status).toBe(200);
                expect(performance.now() - closed.at).toBeLessThan(AREA_LOOKUP_LIMITS.statementMs);
                await app.close();
                app = undefined;
                await own.end({ timeout: 5 });
            },
            TIMEOUT_MS,
        );
    });
});
