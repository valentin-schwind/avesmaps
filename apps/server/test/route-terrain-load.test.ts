import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AVENTURIA_TRAVEL_MODEL } from "@avesmaps3d/shared";
import { createDatabase, type Database, type Queryable } from "../src/database.ts";
import { calibrateRelief, loadTerrainHeights, type TerrainHeights } from "../src/routing/relief.ts";
import { mountainMembershipRows } from "../src/routing/mountain-membership.ts";
import { loadDomainHeightSource, onHeightExchange, type HeightExchange } from "../src/routing/terrain-load.ts";
import { migrate } from "../src/db/migrate.ts";
import { DEFAULT_CONE } from "../src/terrain/peak-cone.ts";
import {
    domainMountainMask,
    loadPublishedDomainSource,
    type DomainHeightSource,
    type MountainMembership,
} from "../src/terrain/domain/read.ts";

/**
 * WI-0071: Das Höhenmodell des Routings kommt in Scheiben, ein unverändertes Raster wird nicht noch einmal gelesen, und
 * die Eichung liest die Zugehörigkeit zum Gebirge streifenweise. Alles gibt dieselben Bytes und dieselben Zahlen wie der
 * Weg davor (`loadPublishedDomainSource`, `domainMountainMask`, die Eichung über das ganze Zugehörigkeitsraster).
 */

const model = AVENTURIA_TRAVEL_MODEL;

/** Eine Gebirgsfläche als Rechteck in Karteneinheiten. */
function rectangle(minX: number, minY: number, maxX: number, maxY: number): MountainMembership {
    return {
        minX,
        minY,
        maxX,
        maxY,
        geometry: {
            type: "Polygon",
            coordinates: [
                [
                    [minX, minY],
                    [maxX, minY],
                    [maxX, maxY],
                    [minX, maxY],
                    [minX, minY],
                ],
            ],
        },
    };
}

/** Eine Datenbank, die nur die drei Anfragen des Laders beantwortet, und mitschreibt, was gefragt wurde. */
function fakeDatabase(state: {
    raster: { fingerprint: string; revision: string; size: number } | null;
    samples: Uint8Array;
    areas: MountainMembership[];
    /** Liegt die Zeile komprimiert? Dann ist `pg_column_size` kleiner als `octet_length`. */
    compressed?: boolean;
    /** Eine Zeilenanfrage, die falsche Scheiben liefert (die Zeile wurde zwischenzeitlich ersetzt). */
    brokenRows?: boolean;
}) {
    const slices: { from: number; length: number; fingerprint: unknown }[] = [];
    /** Die Anfragen, die alle Scheiben als Zeilen auf einmal holen: ihre Scheibengröße und ihr Fingerabdruck. */
    const rowQueries: { slice: number; fingerprint: unknown }[] = [];
    let identities = 0;
    const database = ((strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join("?");
        if (sql.includes("generate_series")) {
            // `i * ${slice} + 1 FOR ${slice}`, Zeile und Fingerabdruck, dann die letzte Nummer der Reihe.
            const [slice, , , fingerprint, last] = values as [number, number, string, string, number];
            rowQueries.push({ slice, fingerprint });
            const pending = Promise.resolve([]);
            return Object.assign(pending, {
                cursor: async (_count: number, onRows: (rows: { i: number; part: Buffer }[]) => void) => {
                    for (let i = last; i >= 0; i -= 1) {
                        // Rückwärts: Die Reihenfolge der Zeilen darf keine Rolle spielen.
                        const part = Buffer.from(state.samples.subarray(i * slice, i * slice + slice));
                        onRows([{ i, part: state.brokenRows ? part.subarray(1) : part }]);
                    }
                },
            });
        }
        if (sql.includes("pg_column_size")) {
            const raw = state.samples.length;
            return Promise.resolve([{ stored: state.compressed ? Math.floor(raw / 3) : raw, raw }]);
        }
        if (sql.includes("substring(samples")) {
            const [from, length, , fingerprint] = values as [number, number, string, string];
            slices.push({ from, length, fingerprint });
            return Promise.resolve([{ part: Buffer.from(state.samples.subarray(from - 1, from - 1 + length)) }]);
        }
        if (sql.includes("FROM terrain_domain_raster t")) {
            identities += 1;
            return Promise.resolve(state.raster ? [state.raster] : []);
        }
        // Das Manifest der Kacheln (WI-0125): ohne Manifest tauscht der Lader nie Kacheln, er liest wie bisher.
        if (sql.includes("FROM terrain_dem_tile")) return Promise.resolve([]);
        if (sql.includes("FROM region_area a")) {
            return Promise.resolve(
                state.areas.map((area) => ({
                    geometry: JSON.stringify(area.geometry),
                    min_x: area.minX,
                    min_y: area.minY,
                    max_x: area.maxX,
                    max_y: area.maxY,
                })),
            );
        }
        throw new Error(`unerwartete Anfrage: ${sql}`);
    }) as unknown as Queryable;
    return { database, slices, rowQueries, identities: () => identities };
}

/** Proben, die sich von Byte zu Byte unterscheiden: Eine vertauschte oder fehlende Scheibe fiele auf. */
function pattern(size: number, seed = 1): Uint8Array {
    const bytes = new Uint8Array(size * size * 2);
    let x = seed;
    for (let index = 0; index < bytes.length; index += 1) {
        x = (Math.imul(x, 1103515245) + 12345) >>> 0;
        bytes[index] = x >>> 24;
    }
    return bytes;
}

const SIZE = 8;
const identity = { fingerprint: "raster-1", revision: "rev-1", size: SIZE };

describe("Das Raster kommt in Scheiben und ist danach dasselbe wie die ganze Zeile", () => {
    it("🔴 setzt krumme Scheiben, Rest und Reihenfolge Byte für Byte richtig zusammen", async () => {
        const samples = pattern(SIZE);
        const { database, slices } = fakeDatabase({ raster: identity, samples, areas: [] });
        const source = await loadDomainHeightSource(database, "aventuria", null, { sliceBytes: 30 });
        expect(Buffer.from(source?.raster.samples.buffer ?? new ArrayBuffer(0)).equals(Buffer.from(samples))).toBe(
            true,
        );
        // 128 Byte in Scheiben von 30: viermal 30 und ein Rest von 8, jede an ihrer Stelle (SQL zählt ab 1).
        expect(slices.map((slice) => [slice.from, slice.length])).toEqual([
            [1, 30],
            [31, 30],
            [61, 30],
            [91, 30],
            [121, 8],
        ]);
        // Jede Scheibe nennt das Raster bei seinem Fingerabdruck, nicht „das aktuelle“: Es kann sich nicht dazwischen ändern.
        expect(new Set(slices.map((slice) => slice.fingerprint))).toEqual(new Set(["raster-1"]));
    });

    it("liest eine Scheibe, die größer ist als das Raster, in einer Anfrage", async () => {
        const { database, slices } = fakeDatabase({ raster: identity, samples: pattern(SIZE), areas: [] });
        await loadDomainHeightSource(database, "aventuria", null, { sliceBytes: 1_000_000 });
        expect(slices).toHaveLength(1);
    });

    it("liefert dieselben Felder wie vorher: Zellgröße, Ursprung, Fingerabdruck der Zugehörigkeit", async () => {
        const areas = [rectangle(2, 2, 6, 6)];
        const { database } = fakeDatabase({ raster: identity, samples: pattern(SIZE), areas });
        const source = await loadDomainHeightSource(database, "aventuria");
        const cell = 1024 / SIZE;
        expect(source).toMatchObject({
            fingerprint: "raster-1",
            revision: "rev-1",
            raster: { cell, originX: cell / 2, originY: cell / 2, width: SIZE, height: SIZE },
            mountains: areas,
        });
        const rows = areas.map((area) => ({
            geometry: JSON.stringify(area.geometry),
            min_x: area.minX,
            min_y: area.minY,
            max_x: area.maxX,
            max_y: area.maxY,
        }));
        expect(source?.membershipFingerprint).toBe(createHash("sha256").update(JSON.stringify(rows)).digest("hex"));
    });

    it("ohne veröffentlichtes Raster gibt es nichts", async () => {
        const { database } = fakeDatabase({ raster: null, samples: new Uint8Array(0), areas: [] });
        expect(await loadDomainHeightSource(database, "aventuria")).toBeNull();
    });
});

describe("Die Art, das Raster zu lesen: Scheiben, oder bei komprimierter Zeile Zeilen einer Anfrage", () => {
    it("🔴 eine unkomprimierte Zeile wird in Scheiben gelesen, eine komprimierte in EINER Anfrage (auto)", async () => {
        const samples = pattern(SIZE);
        const plain = fakeDatabase({ raster: identity, samples, areas: [] });
        await loadDomainHeightSource(plain.database, "aventuria", null, { sliceBytes: 30 });
        expect(plain.slices.length).toBe(5);
        expect(plain.rowQueries).toHaveLength(0);

        const packed = fakeDatabase({ raster: identity, samples, areas: [], compressed: true });
        const source = await loadDomainHeightSource(packed.database, "aventuria", null, { sliceBytes: 30 });
        expect(packed.slices).toHaveLength(0);
        // Eine Anfrage für alle fünf Scheiben, beim Fingerabdruck des Rasters wie die Scheiben.
        expect(packed.rowQueries).toEqual([{ slice: 30, fingerprint: "raster-1" }]);
        // Byte für Byte dasselbe wie die Scheiben, auch bei krummer Größe und Rest.
        expect(Buffer.from(source?.raster.samples.buffer ?? new ArrayBuffer(0)).equals(Buffer.from(samples))).toBe(
            true,
        );
    });

    it("🔴 die Zeilen geben für jede Scheibengröße dieselben Bytes wie die Scheiben, auch eine größer als das Raster", async () => {
        const samples = pattern(SIZE, 5);
        for (const sliceBytes of [1, 2, 7, 30, 64, 127, 128, 129, 1_000_000]) {
            const rows = fakeDatabase({ raster: identity, samples, areas: [] });
            const bySlice = fakeDatabase({ raster: identity, samples, areas: [] });
            const a = await loadDomainHeightSource(rows.database, "aventuria", null, { sliceBytes, read: "rows" });
            const b = await loadDomainHeightSource(bySlice.database, "aventuria", null, { sliceBytes, read: "slices" });
            expect(rows.rowQueries, `Scheibe ${String(sliceBytes)}`).toHaveLength(1);
            expect(Buffer.from(a?.raster.samples.buffer ?? new ArrayBuffer(0)).equals(Buffer.from(samples))).toBe(true);
            expect(Buffer.from(b?.raster.samples.buffer ?? new ArrayBuffer(0)).equals(Buffer.from(samples))).toBe(true);
        }
    });

    it("`slices` und `rows` erzwingen eine Art, auch gegen den Befund der Zeile", async () => {
        const samples = pattern(SIZE);
        const forcedSlices = fakeDatabase({ raster: identity, samples, areas: [], compressed: true });
        await loadDomainHeightSource(forcedSlices.database, "aventuria", null, { sliceBytes: 40, read: "slices" });
        expect(forcedSlices.rowQueries).toHaveLength(0);
        expect(forcedSlices.slices.length).toBeGreaterThan(0);
        const forcedRows = fakeDatabase({ raster: identity, samples, areas: [] });
        await loadDomainHeightSource(forcedRows.database, "aventuria", null, { sliceBytes: 40, read: "rows" });
        expect(forcedRows.slices).toHaveLength(0);
        expect(forcedRows.rowQueries).toHaveLength(1);
    });

    it("🔴 falsche Scheiben aus der Zeilenanfrage geben keinen halben Puffer, sondern einen Fehler", async () => {
        const broken = fakeDatabase({
            raster: identity,
            samples: pattern(SIZE),
            areas: [],
            compressed: true,
            brokenRows: true,
        });
        await expect(loadDomainHeightSource(broken.database, "aventuria", null, { sliceBytes: 30 })).rejects.toThrow(
            /nicht lesbar/,
        );
    });

    it("die Einstellung der Umgebung gilt, wenn der Aufruf nichts nennt, und eine falsche hält nichts an", async () => {
        const samples = pattern(SIZE);
        const previous = { slice: process.env["ROUTING_SLICE_MIB"], read: process.env["ROUTING_RASTER_READ"] };
        try {
            process.env["ROUTING_SLICE_MIB"] = "0.0001";
            process.env["ROUTING_RASTER_READ"] = "rows";
            const tiny = fakeDatabase({ raster: identity, samples, areas: [] });
            await loadDomainHeightSource(tiny.database, "aventuria");
            // 0,0001 MiB liegt unter der Grenze von 64 KiB: Die Scheibe ist 64 KiB, das Raster (128 Byte) eine einzige.
            expect(tiny.rowQueries).toEqual([{ slice: 64 * 1024, fingerprint: "raster-1" }]);
            process.env["ROUTING_SLICE_MIB"] = "viel";
            process.env["ROUTING_RASTER_READ"] = "irgendwie";
            const fallback = fakeDatabase({ raster: identity, samples, areas: [] });
            await loadDomainHeightSource(fallback.database, "aventuria");
            expect(fallback.slices).toHaveLength(1);
            expect(fallback.rowQueries).toHaveLength(0);
        } finally {
            for (const [key, value] of [
                ["ROUTING_SLICE_MIB", previous.slice],
                ["ROUTING_RASTER_READ", previous.read],
            ] as const) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
        }
    });
});

describe("Ein unverändertes Raster wird nicht noch einmal gelesen (WI-0071)", () => {
    async function ersterStand() {
        const state = { raster: { ...identity }, samples: pattern(SIZE), areas: [rectangle(2, 2, 6, 6)] };
        const db = fakeDatabase(state);
        const first = (await loadDomainHeightSource(db.database, "aventuria", null, {
            sliceBytes: 40,
        })) as DomainHeightSource;
        db.slices.length = 0;
        return { state, db, first };
    }

    it("🔴 gleiches Raster und gleiche Gebirgsflächen: derselbe Stand, keine einzige Scheibe", async () => {
        const { db, first } = await ersterStand();
        const again = await loadDomainHeightSource(db.database, "aventuria", first);
        expect(again).toBe(first);
        expect(db.slices).toHaveLength(0);
    });

    it("🔴 geänderte Gebirgsflächen: ein neuer Stand, aber dasselbe Raster als Objekt und keine Scheibe", async () => {
        const { state, db, first } = await ersterStand();
        state.areas = [rectangle(2, 2, 6, 6), rectangle(0, 0, 3, 3)];
        const changed = (await loadDomainHeightSource(db.database, "aventuria", first)) as DomainHeightSource;
        expect(changed).not.toBe(first);
        expect(changed.raster).toBe(first.raster);
        expect(changed.mountains).toHaveLength(2);
        expect(changed.membershipFingerprint).not.toBe(first.membershipFingerprint);
        expect(db.slices).toHaveLength(0);
    });

    it("eine andere Revision bei gleichem Raster: neuer Stand mit demselben Raster", async () => {
        const { state, db, first } = await ersterStand();
        state.raster = { ...identity, revision: "rev-2" };
        const changed = (await loadDomainHeightSource(db.database, "aventuria", first)) as DomainHeightSource;
        expect(changed).not.toBe(first);
        expect(changed.revision).toBe("rev-2");
        expect(changed.raster).toBe(first.raster);
        expect(db.slices).toHaveLength(0);
    });

    it("🔴 ein anderes Raster wird neu gelesen, das alte bleibt unberührt", async () => {
        const { state, db, first } = await ersterStand();
        const before = Buffer.from(first.raster.samples.buffer.slice(0)).toString("hex");
        state.raster = { ...identity, fingerprint: "raster-2" };
        state.samples = pattern(SIZE, 7);
        const changed = (await loadDomainHeightSource(db.database, "aventuria", first, {
            sliceBytes: 40,
        })) as DomainHeightSource;
        expect(changed.raster).not.toBe(first.raster);
        expect(Buffer.from(changed.raster.samples.buffer).equals(Buffer.from(state.samples))).toBe(true);
        expect(Buffer.from(first.raster.samples.buffer).toString("hex")).toBe(before);
        expect(db.slices.length).toBeGreaterThan(0);
        expect(new Set(db.slices.map((slice) => slice.fingerprint))).toEqual(new Set(["raster-2"]));
    });

    it("🔴 das Gelände des Routings ist bei gleichem Raster und gleichen Flächen dasselbe Objekt samt Eichung", async () => {
        // Zellen sind 128 E breit (1024 / 8): Das Gebirge muss Zellmitten (64, 192, …) überdecken, sonst eicht es auf 1.
        const state = { raster: { ...identity }, samples: pattern(SIZE), areas: [rectangle(0, 0, 400, 400)] };
        const { database, slices } = fakeDatabase(state);
        const first = (await loadTerrainHeights(database, "aventuria", model)) as TerrainHeights;
        slices.length = 0;
        expect(await loadTerrainHeights(database, "aventuria", model, DEFAULT_CONE, first)).toBe(first);
        expect(slices).toHaveLength(0);
        // Andere Gebirgsflächen: neu geeicht, aber auf demselben Raster.
        state.areas = [rectangle(0, 0, 1024, 1024)];
        const changed = (await loadTerrainHeights(database, "aventuria", model, DEFAULT_CONE, first)) as TerrainHeights;
        expect(changed).not.toBe(first);
        expect(changed.domain?.raster).toBe(first.domain?.raster);
        expect(changed.mu).not.toEqual(first.mu);
        // …und genau so geeicht wie ein Stand, der ohne Vorgänger frisch geladen wird.
        const fresh = (await loadTerrainHeights(database, "aventuria", model)) as TerrainHeights;
        expect(changed.mu).toEqual(fresh.mu);
    });
});

/** Ein Raster mit Gebirgsflächen, das über mehrere Streifen der Eichung reicht (Höhe 300 > 128 Zeilen). */
function tallSource(): DomainHeightSource {
    const width = 40;
    const height = 300;
    const samples = new Uint16Array(width * height);
    let x = 12345;
    for (let index = 0; index < samples.length; index += 1) {
        x = (Math.imul(x, 1103515245) + 12345) >>> 0;
        samples[index] = (x >>> 16) % 900;
    }
    const cell = 1;
    return {
        fingerprint: "hoch",
        revision: "hoch",
        membershipFingerprint: "hoch",
        raster: { cell, originX: 0.5, originY: 0.5, width, height, samples },
        mountains: [
            // Überlappende Flächen: Eine Zelle zählt einmal.
            rectangle(3, 10, 30, 140),
            rectangle(10, 120, 38, 290),
            // Ein Dreieck quer über die Streifengrenzen bei 128 und 256.
            {
                minX: 0,
                minY: 100,
                maxX: 20,
                maxY: 280,
                geometry: {
                    type: "Polygon",
                    coordinates: [
                        [
                            [0, 100],
                            [20, 190],
                            [0, 280],
                            [0, 100],
                        ],
                    ],
                },
            },
        ],
    };
}

describe("Die Zugehörigkeit zum Gebirge streifenweise (WI-0071)", () => {
    it("🔴 die Streifen setzen sich zu demselben Raster zusammen wie `domainMountainMask`, für jede Streifenhöhe", () => {
        const source = tallSource();
        const whole = domainMountainMask(source);
        expect(whole.some((value) => value === 1)).toBe(true);
        expect(whole.some((value) => value === 0)).toBe(true);
        const { width, height } = source.raster;
        for (const stripe of [1, 2, 7, 128, 129, 299, 300, 1000]) {
            const parts: Uint8Array[] = [];
            for (let from = 0; from < height; from += stripe)
                parts.push(mountainMembershipRows(source, from, Math.min(height, from + stripe)));
            const joined = Buffer.concat(parts);
            expect(joined.length, `Streifenhöhe ${String(stripe)}`).toBe(width * height);
            expect(joined.equals(Buffer.from(whole)), `Streifenhöhe ${String(stripe)}`).toBe(true);
        }
    });

    it("eine leere oder umgekehrte Spanne ist leer", () => {
        const source = tallSource();
        expect(mountainMembershipRows(source, 5, 5)).toHaveLength(0);
        expect(mountainMembershipRows(source, 9, 5)).toHaveLength(0);
    });

    it("🔴 die Eichung rechnet mit Streifen genau dieselben Zahlen wie mit dem ganzen Raster", () => {
        const source = tallSource();
        const base = { ...source.raster, maxX: 40, maxY: 300 };
        const whole = calibrateRelief([{ ...base, membership: domainMountainMask(source) }], [], DEFAULT_CONE, model);
        const striped = calibrateRelief(
            [{ ...base, membershipRows: (from, to) => mountainMembershipRows(source, from, to) }],
            [],
            DEFAULT_CONE,
            model,
        );
        expect(striped).toEqual(whole);
        // Die Zahlen sind nicht trivial (ein leeres Gebirge eichte auf 1).
        expect(whole.FOOT.mountain).not.toBe(1);
    });

    it("🔴 liest nie mehr als einen Streifen samt Rändern auf einmal", () => {
        const source = tallSource();
        const base = { ...source.raster, maxX: 40, maxY: 300 };
        const asked: [number, number][] = [];
        calibrateRelief(
            [
                {
                    ...base,
                    membershipRows: (from, to) => {
                        asked.push([from, to]);
                        return mountainMembershipRows(source, from, to);
                    },
                },
            ],
            [],
            DEFAULT_CONE,
            model,
        );
        expect(asked.length).toBeGreaterThan(1);
        for (const [from, to] of asked) expect(to - from).toBeLessThanOrEqual(128 + 2);
        // Alle Zeilen kommen vor, keine fehlt.
        const rows = new Set(
            asked.flatMap(([from, to]) => Array.from({ length: to - from }, (_, index) => from + index)),
        );
        expect(rows.size).toBe(300);
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
describe.skipIf(!testDatabaseUrl)("Gegen die Datenbank: dieselben Daten wie `loadPublishedDomainSource`", () => {
    let database: Database;
    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl ?? "", { max: 2 });
        await migrate(database);
    });
    afterAll(() => database.end({ timeout: 5 }));

    it("🔴 liest Raster (in krummen Scheiben), Gebirgsflächen und Kennungen wie die Ableitung - und übernimmt, was gleich bleibt", async () => {
        const rollback = new Error("Fixture zurückrollen");
        const samples = Buffer.from(pattern(4096, 99));
        try {
            await database.begin(async (tx) => {
                await tx`UPDATE terrain_dem SET is_current = false WHERE map_domain_id = 'aventuria' AND is_current`;
                await tx`INSERT INTO terrain_domain_raster (map_domain_id, fingerprint, input_fingerprint, generator_version, size, samples, report)
                    VALUES ('aventuria', 'wi0071-raster', 'wi0071-input', '1', 4096, ${samples}, '{}')`;
                await tx`INSERT INTO terrain_dem (revision, map_domain_id, fingerprint, tile_size, max_zoom, encoding, tiles, bytes, is_current, domain_fingerprint)
                    VALUES ('a0071a000001', 'aventuria', 'wi0071', 512, 3, 'mapbox', 1, 1, true, 'wi0071-raster')`;
                const [region] = await tx<{ id: number }[]>`
                    INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type)
                    VALUES ('00000000-0000-4000-8000-0000000071a1', 'aventuria', 'Testgebirge', 'topographie', 'gebirge')
                    RETURNING id`;
                await tx`INSERT INTO region_area (public_id, map_domain_id, region_id, geom)
                    VALUES ('00000000-0000-4000-8000-0000000071a2', 'aventuria', ${region?.id ?? 0}, ST_MakeEnvelope(100,100,300,300,0)),
                           ('00000000-0000-4000-8000-0000000071a3', 'aventuria', ${region?.id ?? 0}, ST_MakeEnvelope(200,200,400,500,0))`;

                const old = await loadPublishedDomainSource(tx, "aventuria");
                const fresh = await loadDomainHeightSource(tx, "aventuria", null, { sliceBytes: 1_000_003 });
                expect(old?.fingerprint).toBe("wi0071-raster");
                expect(fresh).toMatchObject({
                    fingerprint: old?.fingerprint,
                    revision: old?.revision,
                    membershipFingerprint: old?.membershipFingerprint,
                    mountains: old?.mountains,
                    raster: { cell: old?.raster.cell, width: 4096, height: 4096 },
                });
                expect(old?.mountains.length).toBeGreaterThanOrEqual(2);
                expect(Buffer.from(fresh?.raster.samples.buffer ?? new ArrayBuffer(0)).equals(samples)).toBe(true);
                expect(Buffer.from(old?.raster.samples.buffer ?? new ArrayBuffer(0)).equals(samples)).toBe(true);

                // Nichts geändert: derselbe Stand. Eine Fläche mehr: neuer Stand auf demselben Raster.
                expect(await loadDomainHeightSource(tx, "aventuria", fresh)).toBe(fresh);
                await tx`INSERT INTO region_area (public_id, map_domain_id, region_id, geom)
                    VALUES ('00000000-0000-4000-8000-0000000071a4', 'aventuria', ${region?.id ?? 0}, ST_MakeEnvelope(500,500,600,600,0))`;
                const changed = await loadDomainHeightSource(tx, "aventuria", fresh);
                expect(changed).not.toBe(fresh);
                expect(changed?.raster).toBe(fresh?.raster);
                expect(changed?.mountains).toEqual((await loadPublishedDomainSource(tx, "aventuria"))?.mountains);
                throw rollback;
            });
        } catch (error) {
            if (error !== rollback) throw error;
        }
    }, 60_000);

    it("🔴 tauscht bei einem neuen Raster nur die Kacheln mit neuer Revision, im SELBEN Raster, Byte für Byte (WI-0125)", async () => {
        const rollback = new Error("Fixture zurückrollen");
        const size = 4096;
        const before = Buffer.from(pattern(size, 7));
        const after = Buffer.from(before);
        // Kachel 4/2/1 (Zeile 1 von Norden): gespeicherte Zeilen 4096 - 1024 bis 4096 - 512, Spalten 1024 bis 1535.
        for (let row = size - 1024; row < size - 512; row += 1)
            for (let column = 1024; column < 1536; column += 1)
                after.writeUInt16LE((row * 31 + column) & 0xffff, (row * size + column) * 2);
        const exchanges: HeightExchange[] = [];
        onHeightExchange((exchange) => exchanges.push(exchange));
        try {
            await database.begin(async (tx) => {
                await tx`UPDATE terrain_dem SET is_current = false WHERE map_domain_id = 'aventuria' AND is_current`;
                for (const [fingerprint, samples, revision] of [
                    ["wi0125-vorher", before, "a0124b000001"],
                    ["wi0125-nachher", after, "a0124b000002"],
                ] as const) {
                    await tx`INSERT INTO terrain_domain_raster (map_domain_id, fingerprint, input_fingerprint, generator_version, size, samples, report)
                        VALUES ('aventuria', ${fingerprint}, 'wi0125-input', '1', ${size}, ${samples}, '{}')`;
                    await tx`INSERT INTO terrain_dem (revision, map_domain_id, fingerprint, tile_size, max_zoom, encoding, tiles, bytes, is_current, domain_fingerprint)
                        VALUES (${revision}, 'aventuria', 'wi0125', 512, 4, 'mapbox', 64, 64, false, ${fingerprint})`;
                    // Das Manifest der feinsten Stufe: nur Kachel 4/2/1 hat nachher andere Bytes.
                    for (let y = 0; y < 8; y += 1)
                        for (let x = 0; x < 8; x += 1) {
                            const changed = x === 2 && y === 1 && revision === "a0124b000002";
                            await tx`INSERT INTO terrain_dem_tile (revision, z, x, y, png)
                                VALUES (${revision}, 4, ${x}, ${y}, ${Buffer.from([x, y, changed ? 1 : 0])})`;
                        }
                }
                await tx`UPDATE terrain_dem SET is_current = true WHERE revision = 'a0124b000001'`;
                const first = await loadDomainHeightSource(tx, "aventuria", null);
                expect(first?.fingerprint).toBe("wi0125-vorher");
                expect(exchanges).toEqual([]);
                const samples = first?.raster.samples;

                await tx`UPDATE terrain_dem SET is_current = false WHERE revision = 'a0124b000001'`;
                await tx`UPDATE terrain_dem SET is_current = true WHERE revision = 'a0124b000002'`;
                const second = await loadDomainHeightSource(tx, "aventuria", first);
                expect(second?.fingerprint).toBe("wi0125-nachher");
                // Kein zweites Raster: dasselbe Objekt, dieselben Proben, jetzt mit dem Inhalt von nachher.
                expect(second?.raster).toBe(first?.raster);
                expect(second?.raster.samples).toBe(samples);
                expect(Buffer.from(second?.raster.samples.buffer ?? new ArrayBuffer(0)).equals(after)).toBe(true);
                expect(exchanges.map(({ tiles, bytes }) => ({ tiles, bytes }))).toEqual([
                    { tiles: 1, bytes: 512 * 512 * 2 },
                ]);

                // Zurück auf vorher: Das Raster hält nachher (nicht mehr den Fingerabdruck seines alten Stands) und tauscht zurück.
                await tx`UPDATE terrain_dem SET is_current = false WHERE revision = 'a0124b000002'`;
                await tx`UPDATE terrain_dem SET is_current = true WHERE revision = 'a0124b000001'`;
                const back = await loadDomainHeightSource(tx, "aventuria", first);
                expect(back?.raster).toBe(first?.raster);
                expect(Buffer.from(back?.raster.samples.buffer ?? new ArrayBuffer(0)).equals(before)).toBe(true);
                expect(exchanges).toHaveLength(2);
                throw rollback;
            });
        } catch (error) {
            if (error !== rollback) throw error;
        } finally {
            onHeightExchange(undefined);
        }
    }, 120_000);

    it("🔴 eine komprimiert abgelegte Zeile in der EXTERNAL-Spalte (so legt sie die Ableitung ab) kommt Byte für Byte gleich an", async () => {
        const rollback = new Error("Fixture zurückrollen");
        // Eine glatte Fläche, wie ein Höhenmodell: komprimierbar. Die Hilfstabelle (wie in `terrain/domain/store.ts`) hat
        // `EXTENDED` und komprimiert den Wert; `INSERT … SELECT` in die `EXTERNAL`-Spalte lässt ihn komprimiert.
        const size = 4096;
        const smooth = new Uint16Array(size * size);
        for (let index = 0; index < smooth.length; index += 1) smooth[index] = ((index % size) >> 4) + (index >> 17);
        const samples = Buffer.from(smooth.buffer);
        try {
            await database.begin(async (tx) => {
                await tx`UPDATE terrain_dem SET is_current = false WHERE map_domain_id = 'aventuria' AND is_current`;
                await tx`CREATE TEMP TABLE wi0071_upload (samples BYTEA NOT NULL) ON COMMIT DROP`;
                await tx`INSERT INTO wi0071_upload (samples) VALUES (${samples})`;
                await tx`INSERT INTO terrain_domain_raster (map_domain_id, fingerprint, input_fingerprint, generator_version, size, samples, report)
                    SELECT 'aventuria', 'wi0071-packed', 'wi0071-input', '1', ${size}, u.samples, '{}' FROM wi0071_upload u`;
                await tx`INSERT INTO terrain_dem (revision, map_domain_id, fingerprint, tile_size, max_zoom, encoding, tiles, bytes, is_current, domain_fingerprint)
                    VALUES ('a0071a000002', 'aventuria', 'wi0071b', 512, 3, 'mapbox', 1, 1, true, 'wi0071-packed')`;
                const [facts] = await tx<{ stored: number; raw: number }[]>`
                    SELECT pg_column_size(samples) AS stored, octet_length(samples) AS raw
                    FROM terrain_domain_raster WHERE fingerprint = 'wi0071-packed'`;
                // Die Voraussetzung des Tests: Die Zeile liegt wirklich komprimiert da.
                expect(facts?.stored ?? 0).toBeLessThan(facts?.raw ?? 0);

                const bySlices = await loadDomainHeightSource(tx, "aventuria", null, { read: "slices" });
                const byRows = await loadDomainHeightSource(tx, "aventuria", null, {
                    read: "rows",
                    sliceBytes: 1_000_003,
                });
                // `auto` erkennt die komprimierte Zeile und nimmt die Zeilen: dieselben Bytes.
                const byAuto = await loadDomainHeightSource(tx, "aventuria", null, { sliceBytes: 3_000_001 });
                for (const [name, loaded] of [
                    ["Scheiben", bySlices],
                    ["Zeilen", byRows],
                    ["auto", byAuto],
                ] as const) {
                    expect(Buffer.from(loaded?.raster.samples.buffer ?? new ArrayBuffer(0)).equals(samples), name).toBe(
                        true,
                    );
                }
                throw rollback;
            });
        } catch (error) {
            if (error !== rollback) throw error;
        }
    }, 120_000);
});
