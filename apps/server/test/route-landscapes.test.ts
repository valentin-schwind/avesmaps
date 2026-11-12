import type { FastifyInstance } from "fastify";
import type postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { renderZoomForBand } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { createDatabase, withStatementTimeout, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { routeLandscapes } from "../src/landscapes/route-landscapes.ts";

/**
 * Die Landschaften entlang einer Route (WI-0035) gegen echtes PostGIS: welche Flächen zählen, wie lang
 * die Etappe in ihnen liegt, und wie eine namenlose Fläche heißt. Die Griff-Regel selbst prüft
 * `packages/shared/test/landscape-names.test.ts`.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/** Eigene Kennungen für diesen Test (…0035…), damit er keinen fremden Bestand berührt. */
const ID = {
    wald: "00000000-0000-4000-8000-0000000035a1",
    griff: "00000000-0000-4000-8000-0000000035a2",
    meer: "00000000-0000-4000-8000-0000000035a3",
    still: "00000000-0000-4000-8000-0000000035a5",
    schleife: "00000000-0000-4000-8000-0000000035a6",
    // Wie „Weiden“: das Label hängt über `region_id`, ein primäres ist nicht benannt (WI-0043).
    weide: "00000000-0000-4000-8000-0000000035a7",
    // Zwei Labels, keins primär: das mit der kleineren Kennung trägt das Ziel.
    doppelt: "00000000-0000-4000-8000-0000000035a8",
    // Ohne jedes Label, aber mit echtem Namen, wie „Mittelaventurien“ (WI-0047, E1); daneben ein Griff ohne Label.
    ohneLabel: "00000000-0000-4000-8000-0000000035a9",
    griffOhneLabel: "00000000-0000-4000-8000-0000000035aa",
    label: "00000000-0000-4000-8000-0000000035b1",
    weideLabel: "00000000-0000-4000-8000-0000000035b2",
    doppeltVorn: "00000000-0000-4000-8000-0000000035b3",
    doppeltHinten: "00000000-0000-4000-8000-0000000035b4",
};
const square = (x0: number, y0: number, x1: number, y1: number): string =>
    `POLYGON((${String(x0)} ${String(y0)},${String(x1)} ${String(y0)},${String(x1)} ${String(y1)},${String(x0)} ${String(y1)},${String(x0)} ${String(y0)}))`;

describeWithDatabase("Landschaften je Etappe gegen PostGIS", () => {
    let database: Database;
    let app: FastifyInstance | undefined;

    async function region(publicId: string, name: string, layer: string, type: string, active = true): Promise<number> {
        const [row] = await database<{ id: string }[]>`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active)
            VALUES (${publicId}, 'aventuria', ${name}, ${layer}, ${type}, ${active})
            ON CONFLICT (public_id) DO UPDATE SET name = EXCLUDED.name, region_type = EXCLUDED.region_type,
                is_active = EXCLUDED.is_active, primary_label_id = NULL
            RETURNING id::text
        `;
        return Number(row?.id);
    }
    async function area(regionId: number, wkt: string, affectsPaths = true): Promise<void> {
        await database`
            INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active, affects_paths)
            VALUES (gen_random_uuid(), 'aventuria', ${regionId}, ST_GeomFromText(${wkt}), true, ${affectsPaths})
        `;
    }
    /** Ein aktives Label, das über `region_id` an seiner Region hängt - primär wird es erst ausdrücklich. */
    async function boundLabel(publicId: string, name: string, x: number, y: number, regionId: number): Promise<number> {
        const [row] = await database<{ id: string }[]>`
            INSERT INTO map_label (public_id, map_domain_id, name, geom, is_active, label_size, label_min_zoom,
                                   label_max_zoom, label_priority, region_id)
            VALUES (${publicId}, 'aventuria', ${name}, ST_SetSRID(ST_MakePoint(${x}, ${y}), 0), true, 14, 2, 7, 3, ${regionId})
            RETURNING id::text
        `;
        return Number(row?.id);
    }
    async function cleanup(): Promise<void> {
        const ids = Object.values(ID);
        await database`UPDATE region SET primary_label_id = NULL WHERE public_id = ANY(${ids}::uuid[])`;
        await database`DELETE FROM map_label WHERE public_id = ANY(${ids}::uuid[])`;
        await database`DELETE FROM region_area WHERE region_id IN (SELECT id FROM region WHERE public_id = ANY(${ids}::uuid[]))`;
        await database`DELETE FROM region WHERE public_id = ANY(${ids}::uuid[])`;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await cleanup();
        // Ein benannter Wald, zwei überlappende Flächen: gezählt wird ihre Vereinigung, nicht doppelt.
        const wald = await region(ID.wald, "Testwald", "vegetation", "wald");
        await area(wald, square(100, 100, 110, 110));
        await area(wald, square(105, 100, 110, 110));
        const [label] = await database<{ id: string }[]>`
            INSERT INTO map_label (public_id, map_domain_id, name, geom, is_active, label_size, label_min_zoom,
                                   label_max_zoom, label_priority, region_id)
            VALUES (${ID.label}, 'aventuria', 'Testwald', ST_SetSRID(ST_MakePoint(105, 105), 0), true, 14, 2, 7, 3, ${wald})
            RETURNING id::text
        `;
        await database`UPDATE region SET primary_label_id = ${Number(label?.id)} WHERE id = ${wald}`;
        // Ein namenloser Wald direkt daneben: Er heißt nach seiner Art, und er hat keine Beschriftung.
        await area(await region(ID.griff, "Wald-901", "vegetation", "wald"), square(110, 100, 120, 110));
        // Was NICHT zählt: das Meer (affects_paths aus), eine stillgelegte Region. Den Probestempel prüft
        // `region-area-stamp.test.ts`: Er zählt wie jede Fläche (WI-0048).
        await area(await region(ID.meer, "Testmeer", "topographie", "meer"), square(90, 90, 130, 120), false);
        await area(await region(ID.still, "Still", "vegetation", "steppe", false), square(90, 90, 130, 120));
        // Ungültig wie 20 Flächen aus Legacy (Satz 147359, etwa der Silker Hain bei Gareth): eine Schleife,
        // die sich in (305 | 305) selbst schneidet, und zwei Rechtecke in EINER Fläche, die sich überlappen.
        const schleife = await region(ID.schleife, "Schleifenhain", "vegetation", "wald");
        await area(schleife, "POLYGON((300 300,310 310,310 300,300 310,300 300))");
        await area(
            schleife,
            "MULTIPOLYGON(((303 300,306 300,306 302,303 302,303 300)),((304 300,307 300,307 302,304 302,304 300)))",
        );
        // Die Beschriftung ohne primären Zeiger (WI-0043): Weiden trägt sein Label nur über `region_id`.
        const weide = await region(ID.weide, "Testweide", "derographisch", "region");
        await area(weide, square(400, 400, 410, 410));
        await boundLabel(ID.weideLabel, "Testweide", 405, 405, weide);
        // Zwei gebundene Labels, keins primär; das HINTERE zuerst angelegt, damit die Reihenfolge im Bestand
        // nicht zufällig die Antwort gibt.
        const doppelt = await region(ID.doppelt, "Testdoppel", "vegetation", "wald");
        await area(doppelt, square(410, 400, 420, 410));
        await boundLabel(ID.doppeltHinten, "Testdoppel Nord", 415, 408, doppelt);
        await boundLabel(ID.doppeltVorn, "Testdoppel", 415, 402, doppelt);
        await area(await region(ID.ohneLabel, "Testmittelland", "derographisch", "region"), square(500, 500, 520, 510));
        await area(await region(ID.griffOhneLabel, "Wald-3599", "vegetation", "wald"), square(520, 500, 530, 510));
    });

    afterEach(async () => {
        await app?.close();
        app = undefined;
    });

    afterAll(async () => {
        await cleanup();
        await database.end({ timeout: 5 });
    });

    it("ordnet die Landschaften nach dem ersten Durchqueren, auch bei umgekehrter Fahrtrichtung", async () => {
        const forward = await routeLandscapes(database, [
            [
                [
                    [95, 105],
                    [125, 105],
                ],
            ],
        ]);
        const backward = await routeLandscapes(database, [
            [
                [
                    [125, 105],
                    [95, 105],
                ],
            ],
        ]);
        expect(forward.stages[0]?.in.map(([id]) => id)).toEqual([ID.wald, ID.griff]);
        expect(backward.stages[0]?.in.map(([id]) => id)).toEqual([ID.griff, ID.wald]);
        const repeated = await routeLandscapes(database, [
            [
                [
                    [125, 105],
                    [115, 105],
                ],
                [
                    [95, 105],
                    [125, 105],
                ],
            ],
        ]);
        expect(repeated.stages[0]?.in.map(([id]) => id)).toEqual([ID.griff, ID.wald]);
    });

    it("🔴 misst die befahrene Länge je Region und Etappe, nur in Flächen, die für Wege zählen", async () => {
        const result = await routeLandscapes(database, [
            [
                [
                    [95, 105],
                    [125, 105],
                ],
            ],
            [
                [
                    [200, 200],
                    [210, 200],
                ],
            ],
            [],
        ]);
        expect(result.stages.map((stage) => stage.length)).toEqual([30, 10, 0]);
        const erste = new Map(result.stages[0]?.in);
        expect(erste.get(ID.wald)).toBeCloseTo(10, 9);
        expect(erste.get(ID.griff)).toBeCloseTo(10, 9);
        expect([...erste.keys()].sort()).toEqual([ID.wald, ID.griff].sort());
        expect(result.stages[1]?.in).toEqual([]);
        expect(result.stages[2]?.in).toEqual([]);

        expect(result.regions[ID.wald]).toEqual({
            name: "Testwald",
            type: "wald",
            // Der Ausschnitt umfasst beide Flächen der Region (WI-0044): Ein Klick passt sie ganz ein.
            target: { label: ID.label, x: 105, y: 105, zoom: renderZoomForBand(3), bounds: [100, 100, 110, 110] },
        });
        expect(result.regions[ID.griff]).toEqual({ name: null, type: "wald", target: null });
        expect(Object.keys(result.regions).sort()).toEqual([ID.wald, ID.griff].sort());
    });

    /**
     * 🔴 Jede Region mit einer Beschriftung ist ein Ziel, auch ohne primären Zeiger (WI-0043).
     *
     * 💣 Befund 2026-09-26: „Weiden“ stand in der Reiseübersicht als bloßer Text. Sein Label hängt über
     * `region_id`, `primary_label_id` ist leer - und nur danach wurde gefragt. Legacy macht den Namen zum
     * Knopf, sobald IRGENDEIN Label an der Region hängt (`findLabelEntryByEcosystemRegion`).
     */
    it("🔴 nimmt jedes gebundene Label als Ziel: das primäre zuerst, sonst die kleinste Kennung", async () => {
        const result = await routeLandscapes(database, [
            [
                [
                    [395, 405],
                    [425, 405],
                ],
            ],
        ]);
        expect(result.regions[ID.weide]?.target).toEqual({
            label: ID.weideLabel,
            x: 405,
            y: 405,
            zoom: renderZoomForBand(3),
            bounds: [400, 400, 410, 410],
        });
        expect(result.regions[ID.doppelt]?.target).toEqual({
            label: ID.doppeltVorn,
            x: 415,
            y: 402,
            zoom: renderZoomForBand(3),
            bounds: [410, 400, 420, 410],
        });
    });

    /**
     * 🔴 E1 (WI-0047): Eine Landschaft ohne Label, aber mit echtem Namen, ist trotzdem ein Knopf. Ihr Ziel ist ein
     * Punkt auf ihrer Fläche, dazu die ganze Fläche als Ausschnitt. Ein Griff ohne Label bleibt Text: In der Zeile
     * heißen viele namenlose Wälder „Wald“, und ein Knopf wählte davon einen beliebigen.
     */
    it("🔴 E1: gibt einer benannten Landschaft ohne Label ein Ziel auf ihrer Fläche, einem Griff nicht", async () => {
        const result = await routeLandscapes(database, [
            [
                [
                    [495, 505],
                    [535, 505],
                ],
            ],
        ]);
        const mittelland = result.regions[ID.ohneLabel];
        expect(mittelland?.name).toBe("Testmittelland");
        expect(mittelland?.target).toMatchObject({ zoom: renderZoomForBand(3), bounds: [500, 500, 520, 510] });
        expect(mittelland?.target).not.toHaveProperty("label");
        expect(mittelland?.target?.x).toBeGreaterThanOrEqual(500);
        expect(mittelland?.target?.x).toBeLessThanOrEqual(520);
        expect(mittelland?.target?.y).toBeGreaterThanOrEqual(500);
        expect(mittelland?.target?.y).toBeLessThanOrEqual(510);
        expect(result.regions[ID.griffOhneLabel]).toEqual({ name: null, type: "wald", target: null });
    });

    it("🔴 rechnet auch durch ungültige Flächen aus Legacy, statt mit 500 abzubrechen", async () => {
        // GEOS brach hier mit „TopologyException: side location conflict“ ab, die Zeile fehlte still.
        const result = await routeLandscapes(database, [
            // Durch den Knoten der Schleife: beide Hälften, je 5.
            [
                [
                    [295, 305],
                    [315, 305],
                ],
            ],
            // Unten durch beide Hälften (je 1) und die Rechtecke (303 bis 307).
            [
                [
                    [295, 301],
                    [315, 301],
                ],
            ],
        ]);
        expect(new Map(result.stages[0]?.in).get(ID.schleife)).toBeCloseTo(10, 9);
        // Die Überlappung zählt einmal. Mit der Standardreparatur (`linework`) fiele sie als Loch heraus: 2 + 2.
        expect(new Map(result.stages[1]?.in).get(ID.schleife)).toBeCloseTo(6, 9);
    });

    it("antwortet über POST /api/route/landscapes, prüft die Linien und hält die Punktezahl klein", async () => {
        const own = createDatabase(testDatabaseUrl as string, { max: 2 });
        const config = { port: 0, host: "127.0.0.1", releaseId: "test", databaseUrl: undefined, tileRoot: undefined };
        app = buildApp({ config, database: own });
        const post = (payload: unknown) =>
            app!.inject({ method: "POST", url: "/api/route/landscapes", payload: payload as object });

        const ok = await post({
            stages: [
                [
                    [
                        [95, 105],
                        [125, 105],
                    ],
                ],
            ],
        });
        expect(ok.statusCode).toBe(200);
        expect(ok.headers["cache-control"]).toBe("no-store");
        expect(ok.json<{ stages: { length: number }[] }>().stages[0]?.length).toBe(30);

        // 🔴 Unterwegs fährt mit (WI-0292): dieselbe Frage bringt die Vorkommen der Route mit, die Landschaften bleiben dieselben; ohne das Feld bleibt die Antwort, wie sie war.
        const beide = await post({
            stages: [
                [
                    [
                        [95, 105],
                        [125, 105],
                    ],
                ],
            ],
            unterwegs: { stages: [{ paths: [] }] },
        });
        expect(beide.statusCode).toBe(200);
        const mit = beide.json<{ stages: unknown[]; unterwegs?: { revision: string; eintraege: unknown[] } }>();
        expect(mit.stages).toEqual(ok.json<{ stages: unknown[] }>().stages);
        expect(mit.unterwegs?.revision).toMatch(/^[0-9a-f]{12}$/);
        expect(Array.isArray(mit.unterwegs?.eintraege)).toBe(true);
        expect(ok.json()).not.toHaveProperty("unterwegs");
        expect(
            (
                await post({
                    stages: [
                        [
                            [
                                [95, 105],
                                [125, 105],
                            ],
                        ],
                    ],
                    unterwegs: { stages: [] },
                })
            ).statusCode,
        ).toBe(400);

        expect((await post({ stages: [[[[95, 105]]]] })).statusCode).toBe(400);
        expect((await post({ stages: [] })).statusCode).toBe(400);
        const riesig = Array.from({ length: 101 }, () => Array.from({ length: 1000 }, (_, i) => [i, i]));
        const zuViele = await post({ stages: [riesig] });
        expect(zuViele.statusCode).toBe(413);
        expect(zuViele.json()).toEqual({ error: "too_many_points" });
        // 🔴 Über der Körpergrenze (1,5 MiB seit WI-0292) weist Fastify den Körper ab, bevor er gelesen ist. Seine eigene Meldung passte nicht
        // zum Schema der 413-Antwort, und aus dem 413 wurde ein 500 (gefunden bei den Stage-Proben).
        const übergroß = await post({ stages: [[Array.from({ length: 80_000 }, () => [123.456789, 543.210987])]] });
        expect(übergroß.statusCode).toBe(413);
        expect(übergroß.headers["cache-control"]).toBe("no-store");
        // Der erste Aufruf von Unterwegs baut den Index des Subject-Dienstes (WI-0292): Das dauert gegen die Testdatenbank länger als die Vorgabe von 5 s.
    }, 30_000);

    it("🔴 S-01: nur Punkte auf der Karte, ein Längenbudget, höchstens zwei Abfragen zugleich", async () => {
        const own = createDatabase(testDatabaseUrl as string, { max: 4 });
        const config = { port: 0, host: "127.0.0.1", releaseId: "test", databaseUrl: undefined, tileRoot: undefined };
        app = buildApp({ config, database: own });
        const post = (payload: unknown) =>
            app!.inject({ method: "POST", url: "/api/route/landscapes", payload: payload as object });
        const linie = (x0: number, y0: number, x1: number, y1: number) => [
            [
                [x0, y0],
                [x1, y1],
            ],
        ];

        // Außerhalb von 0 bis 1024 ist kein Punkt der Karte.
        expect((await post({ stages: [linie(-5, 105, 125, 105)] })).statusCode).toBe(400);
        expect((await post({ stages: [linie(95, 105, 2000, 105)] })).statusCode).toBe(400);
        // 30 Diagonalen über die ganze Karte: gut 43 000 Einheiten, über dem Budget von 40 000.
        const diagonalen = await post({ stages: Array.from({ length: 30 }, () => linie(0, 0, 1024, 1024)) });
        expect(diagonalen.statusCode).toBe(413);
        expect(diagonalen.json()).toEqual({ error: "too_long" });

        // Drei zugleich: Die dritte wartet nicht, sie bekommt 503 busy mit Retry-After.
        const antworten = await Promise.all([1, 2, 3].map(() => post({ stages: [linie(95, 105, 125, 105)] })));
        expect(antworten.map((antwort) => antwort.statusCode).sort()).toEqual([200, 200, 503]);
        const besetzt = antworten.find((antwort) => antwort.statusCode === 503);
        expect(besetzt?.json()).toEqual({ error: "busy" });
        expect(besetzt?.headers["retry-after"]).toBe("2");
        // Danach ist wieder Platz.
        expect((await post({ stages: [linie(95, 105, 125, 105)] })).statusCode).toBe(200);
        await own.end({ timeout: 5 });
    });

    it("🔴 S-01: die Zeitgrenze bricht ab (57014), die Verbindung bleibt danach frei", async () => {
        // Deterministisch mit pg_sleep: Eine echte Landschaftsabfrage mit 1 ms Grenze endete je nach
        // Zeitgeber mal fertig, mal mit 57014, mal mitten in GEOS (Koordination 2026-09-26).
        const started = performance.now();
        await expect(
            withStatementTimeout(database, 50, (transaction) => transaction`SELECT pg_sleep(2)`),
        ).rejects.toMatchObject({ code: "57014" });
        expect(performance.now() - started).toBeLessThan(1_500);
        // SET LOCAL gilt nur in der Transaktion: Dieselbe Verbindung rechnet danach wieder ohne 1 ms.
        const [{ timeout } = { timeout: "" }] = await database<{ timeout: string }[]>`SHOW statement_timeout`;
        expect(timeout).not.toBe("1ms");
        expect(
            (
                await routeLandscapes(database, [
                    [
                        [
                            [95, 105],
                            [125, 105],
                        ],
                    ],
                ])
            ).stages[0]?.length,
        ).toBe(30);
    });

    /**
     * 🔴 WI-0065, Nachtrag: JIT ist nur in der Transaktion der Landschaften aus. Der Planer schätzt die
     * Abfragen dieser Route weit über `jit_above_cost`, und auf Stage ging die meiste Zeit in die Übersetzung.
     */
    describe("JIT nur in der Transaktion aus", () => {
        let single: Database;
        const currentJit = async (db: Database | postgres.TransactionSql): Promise<string> => {
            const [row] = await db<{ jit: string }[]>`SELECT current_setting('jit') AS jit`;
            return row?.jit ?? "?";
        };

        beforeAll(async () => {
            // EINE Verbindung: Was in der Transaktion durchsickerte, sähe die nächste Abfrage zwingend.
            single = createDatabase(testDatabaseUrl as string, { max: 1 });
            await single`SET jit = on`;
        });
        afterAll(async () => {
            await single.end({ timeout: 5 });
        });

        it("in der Transaktion gilt off, außerhalb unverändert, auch nach Fehlern in der Arbeit", async () => {
            expect(await currentJit(single)).toBe("on");
            expect(await withStatementTimeout(single, 5_000, (transaction) => currentJit(transaction))).toBe("on");
            expect(
                await withStatementTimeout(single, 5_000, (transaction) => currentJit(transaction), { jitOff: true }),
            ).toBe("off");
            expect(await currentJit(single)).toBe("on");

            // Ein Fehler der Arbeit und ein Abbruch durch die Zeitgrenze: danach gilt auf derselben Verbindung wieder on.
            await expect(
                withStatementTimeout(
                    single,
                    5_000,
                    async (transaction) => {
                        expect(await currentJit(transaction)).toBe("off");
                        throw new Error("Arbeit fehlgeschlagen");
                    },
                    { jitOff: true },
                ),
            ).rejects.toThrow("Arbeit fehlgeschlagen");
            expect(await currentJit(single)).toBe("on");
            await expect(
                withStatementTimeout(single, 50, (transaction) => transaction`SELECT pg_sleep(2)`, { jitOff: true }),
            ).rejects.toMatchObject({ code: "57014" });
            expect(await currentJit(single)).toBe("on");
        });

        it("jede Abfrage der Landschaften läuft mit JIT aus", async () => {
            const seen: string[] = [];
            const spied = new Proxy(single, {
                get(target, property) {
                    if (property !== "begin") return Reflect.get(target, property) as unknown;
                    return (callback: (transaction: postgres.TransactionSql) => Promise<unknown>) =>
                        target.begin((transaction) =>
                            callback(
                                new Proxy(transaction, {
                                    async apply(inner, thisArg, args) {
                                        seen.push(await currentJit(inner));
                                        return Reflect.apply(inner, thisArg, args) as unknown;
                                    },
                                }),
                            ),
                        );
                },
            });
            const result = await routeLandscapes(spied, [
                [
                    [
                        [95, 105],
                        [125, 105],
                    ],
                ],
            ]);
            expect(result.stages[0]?.length).toBe(30);
            // Die Landschaften und die Regionen; die Gebiete (`routeTerritories`) kommen hinzu, sobald eine Ableitung vorliegt.
            expect(seen.length).toBeGreaterThanOrEqual(2);
            expect(new Set(seen)).toEqual(new Set(["off"]));
            expect(await currentJit(single)).toBe("on");
        });
    });

    /**
     * 🔴 WI-0065, Nachtrag: Wer die Antwort nicht mehr abwartet, beschäftigt die Datenbank nicht weiter. Gemessen auf
     * Stage (Handover `2026-10-01-stage-rollout-5114892`): Der Browser brach drei Anfragen ab (499), der Server
     * rechnete weiter, und die vierte bekam sofort 503 `busy`.
     */
    describe("Abbruch durch den Client", () => {
        const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
        const sleeping = async (): Promise<number> => {
            const [row] = await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM pg_stat_activity
                WHERE pid <> pg_backend_pid() AND state = 'active' AND query LIKE '%pg_sleep(10)%'
            `;
            return row?.n ?? -1;
        };
        const until = async (condition: () => Promise<boolean>, limitMs: number): Promise<boolean> => {
            const end = performance.now() + limitMs;
            while (performance.now() < end) {
                if (await condition()) return true;
                await wait(20);
            }
            return condition();
        };

        it("bricht die laufende Abfrage ab (57014), sobald das Signal feuert, und die Verbindung bleibt brauchbar", async () => {
            const own = createDatabase(testDatabaseUrl as string, { max: 3 });
            try {
                const controller = new AbortController();
                const started = performance.now();
                const running = withStatementTimeout(own, 30_000, (transaction) => transaction`SELECT pg_sleep(10)`, {
                    signal: controller.signal,
                });
                const outcome = expect(running).rejects.toMatchObject({ code: "57014" });
                expect(await until(async () => (await sleeping()) === 1, 2_000)).toBe(true);
                controller.abort();
                await outcome;
                expect(performance.now() - started).toBeLessThan(3_000);
                // Die Datenbank ruht: Die Abfrage steht nicht mehr in pg_stat_activity.
                expect(await sleeping()).toBe(0);
                expect(await own`SELECT 1 AS eins`).toEqual([{ eins: 1 }]);
            } finally {
                await own.end({ timeout: 5 });
            }
        });

        it("beginnt nichts, wenn das Signal schon gefeuert hat", async () => {
            const controller = new AbortController();
            controller.abort();
            let ran = false;
            await expect(
                withStatementTimeout(
                    database,
                    5_000,
                    () => {
                        ran = true;
                        return Promise.resolve();
                    },
                    { signal: controller.signal },
                ),
            ).rejects.toMatchObject({ name: "AbortError" });
            expect(ran).toBe(false);
        });

        it("ein Abbruch zwischen zwei Abfragen trifft ins Leere und wird wiederholt, bis die nächste läuft", async () => {
            const own = createDatabase(testDatabaseUrl as string, { max: 3 });
            try {
                const controller = new AbortController();
                const started = performance.now();
                const running = withStatementTimeout(
                    own,
                    30_000,
                    async (transaction) => {
                        await transaction`SELECT 1`;
                        // Das Signal feuert hier, während die Transaktion untätig ist.
                        setTimeout(() => controller.abort(), 50);
                        await wait(300);
                        await transaction`SELECT pg_sleep(10)`;
                    },
                    { signal: controller.signal },
                );
                await expect(running).rejects.toMatchObject({ code: "57014" });
                expect(performance.now() - started).toBeLessThan(3_000);
                expect(await sleeping()).toBe(0);
            } finally {
                await own.end({ timeout: 5 });
            }
        });

        it("ein Signal nach dem Ende der Transaktion trifft die nächste Abfrage derselben Verbindung nicht", async () => {
            // EINE Verbindung: Die nächste Abfrage läuft auf demselben Backend wie die Transaktion.
            const own = createDatabase(testDatabaseUrl as string, { max: 1 });
            try {
                const controller = new AbortController();
                const seven = await withStatementTimeout(
                    own,
                    5_000,
                    async (transaction) => (await transaction<{ n: number }[]>`SELECT 7 AS n`)[0]?.n,
                    { signal: controller.signal },
                );
                expect(seven).toBe(7);
                controller.abort();
                await wait(150);
                const [row] = await own<{ n: number }[]>`SELECT 8 AS n FROM pg_sleep(0.3)`;
                expect(row?.n).toBe(8);
            } finally {
                await own.end({ timeout: 5 });
            }
        });

        it("🔴 über HTTP: ein geschlossenes Fenster gibt den Platz der Zweiergrenze frei, ohne busy", async () => {
            const own = createDatabase(testDatabaseUrl as string, { max: 6 });
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
            const body = JSON.stringify({
                stages: [
                    [
                        [
                            [95, 105],
                            [125, 105],
                        ],
                    ],
                ],
            });
            const post = (signal?: AbortSignal) =>
                fetch(`${base}/api/route/landscapes`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body,
                    ...(signal ? { signal } : {}),
                });
            // Landschaftsabfragen, die in der Datenbank auf eine Sperre warten.
            const waiting = async (): Promise<number> => {
                const [row] = await database<{ n: number }[]>`
                    SELECT count(*)::int AS n FROM pg_stat_activity
                    WHERE pid <> pg_backend_pid() AND state = 'active' AND wait_event_type = 'Lock'
                      AND query LIKE '%landscape AS MATERIALIZED%'
                `;
                return row?.n ?? -1;
            };

            // Kontrolle: Eine Anfrage, die zu Ende läuft, wird nicht für abgebrochen gehalten.
            const first = await post();
            expect(first.status).toBe(200);
            expect(((await first.json()) as { stages: { length: number }[] }).stages[0]?.length).toBe(30);

            // Die Flächen der Landschaften sind gesperrt: Beide Anfragen kommen bis in die Datenbank und warten dort.
            let release!: () => void;
            const released = new Promise<void>((resolve) => {
                release = resolve;
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
            try {
                const firstWindow = new AbortController();
                const secondWindow = new AbortController();
                const pending = [post(firstWindow.signal), post(secondWindow.signal)].map((request) =>
                    request.then(
                        (response) => response.status,
                        (error: unknown) => (error instanceof Error ? error.name : "unbekannt"),
                    ),
                );
                expect(await until(async () => (await waiting()) === 2, 3_000)).toBe(true);
                // Beide Plätze sind belegt: Die dritte Anfrage wird abgewiesen.
                const busy = await post();
                expect(busy.status).toBe(503);
                expect(await busy.json()).toEqual({ error: "busy" });

                // Die Fenster gehen zu. Die Zeitgrenze der Abfragen (2 s) ist NICHT der Grund fürs Ende.
                const closed = performance.now();
                firstWindow.abort();
                secondWindow.abort();
                expect(await Promise.all(pending)).toEqual(["AbortError", "AbortError"]);
                expect(await until(async () => (await waiting()) === 0, 1_000)).toBe(true);
                expect(performance.now() - closed).toBeLessThan(1_000);
            } finally {
                release();
                await holder;
            }

            // Danach ist Platz: eine neue Anfrage bekommt kein busy. Abgewartet wird nur das Aufräumen der beiden
            // Zweige (Rückrollen der Transaktion), sonst nichts.
            let status = 0;
            const free = await until(async () => {
                status = (await post()).status;
                return status !== 503;
            }, 1_000);
            expect(free).toBe(true);
            expect(status).toBe(200);
        });
    });
});
