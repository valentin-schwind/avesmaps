import { afterAll, describe, expect, it } from "vitest";
import { AVENTURIA, AVENTURIA_TRAVEL_MODEL } from "@avesmaps3d/shared";
import { createDatabase, type Queryable } from "../src/database.ts";
import { loadSeaRoutes, SEA_ROUTE_ALGORITHM } from "../src/routing/sea-derive.ts";
import { coastDistance, coastProfile } from "../src/routing/sea-coast.ts";
import {
    compactSeaGraph,
    decodeSeaGraph,
    encodeSeaGraph,
    waterMask,
    type SeaGraphPort,
} from "../src/routing/sea-graph-store.ts";
import { buildSeaGrid, prepareNavigableWater } from "../src/routing/sea-grid.ts";
import { VisibilityGraph } from "../src/routing/sea-visibility.ts";
import {
    readRows,
    readSlices,
    routingRasterRead,
    routingSliceBytes,
    sliceCount,
    SLICE_BYTES,
    type SliceRow,
} from "../src/routing/sliced-read.ts";

/**
 * WI-0071: Große `bytea`-Zeilen (Domain-Raster 32 MiB, Seegraph 16 MiB) kommen in Scheiben statt als eine Zeile, deren
 * Hexadezimaltext der Treiber mehrfach im Speicher hält (gemessen 218 bis 259 MiB ArrayBuffer-Spitze).
 */

describe("readSlices", () => {
    const source = Uint8Array.from({ length: 100 }, (_, index) => (index * 7 + 3) % 256);
    const serve =
        (calls: [number, number][] = []) =>
        async (offset: number, length: number) => {
            calls.push([offset, length]);
            return source.slice(offset, offset + length);
        };

    it("🔴 setzt jede Scheibengröße zu denselben Bytes zusammen (genau, mit Rest, größer, ein Byte)", async () => {
        for (const slice of [1, 7, 10, 99, 100, 101, 1000]) {
            const bytes = await readSlices(100, slice, serve());
            expect(
                Buffer.from(bytes ?? new Uint8Array(0)).equals(Buffer.from(source)),
                `Scheibe ${String(slice)}`,
            ).toBe(true);
        }
    });

    it("fragt nullbasiert, in Reihenfolge, und nie mehr als die Scheibe oder den Rest", async () => {
        const calls: [number, number][] = [];
        await readSlices(25, 10, serve(calls));
        expect(calls).toEqual([
            [0, 10],
            [10, 10],
            [20, 5],
        ]);
    });

    it("🔴 das Ergebnis füllt seinen ArrayBuffer ganz und beginnt bei Byte 0: Typ-Arrays darüber sind ausgerichtet", async () => {
        const bytes = await readSlices(96, 40, serve());
        expect(bytes?.byteOffset).toBe(0);
        expect(bytes?.buffer.byteLength).toBe(96);
        expect(new Uint32Array(bytes?.buffer as ArrayBuffer)).toHaveLength(24);
    });

    it("🔴 fehlt eine Scheibe oder ist sie zu kurz (die Zeile wurde ersetzt), gibt es keinen halben Puffer", async () => {
        expect(
            await readSlices(100, 30, async (offset, length) =>
                offset === 60 ? undefined : source.slice(offset, offset + length),
            ),
        ).toBeNull();
        expect(
            await readSlices(100, 30, async (offset, length) =>
                source.slice(offset, offset + length - (offset === 30 ? 1 : 0)),
            ),
        ).toBeNull();
    });

    it("liest nichts für nichts", async () => {
        const calls: [number, number][] = [];
        const bytes = await readSlices(0, 10, serve(calls));
        expect(bytes?.byteLength).toBe(0);
        expect(calls).toEqual([]);
    });

    it("die Scheibe ist klein genug, dass der Treiber nur wenige MiB hält (Vorgabe 1 MiB)", () => {
        expect(SLICE_BYTES).toBe(1024 * 1024);
    });
});

describe("readRows: alle Scheiben als Zeilen einer Anfrage", () => {
    const source = Uint8Array.from({ length: 100 }, (_, index) => (index * 7 + 3) % 256);
    /** Die Zeilen, wie die Anfrage sie liefert: Scheibe `index` ab `index * slice`, in der Reihenfolge `order`. */
    const rowsOf =
        (slice: number, order?: number[]) =>
        async (onRow: (row: SliceRow) => void): Promise<void> => {
            const count = sliceCount(source.length, slice);
            for (const index of order ?? Array.from({ length: count }, (_, at) => at))
                onRow({ index, part: source.slice(index * slice, index * slice + slice) });
        };

    it("zählt die Scheiben wie die Anfrage (aufgerundet, mindestens eine Byte je Scheibe)", () => {
        expect(sliceCount(100, 30)).toBe(4);
        expect(sliceCount(100, 100)).toBe(1);
        expect(sliceCount(100, 1000)).toBe(1);
        expect(sliceCount(100, 0)).toBe(100);
        expect(sliceCount(0, 10)).toBe(0);
    });

    it("🔴 setzt Scheiben in beliebiger Reihenfolge an ihre Stelle, gleich `readSlices`", async () => {
        for (const slice of [1, 7, 30, 99, 100, 101, 1000]) {
            const count = sliceCount(source.length, slice);
            const reversed = Array.from({ length: count }, (_, at) => count - 1 - at);
            const bySlices = await readSlices(source.length, slice, async (offset, length) =>
                source.slice(offset, offset + length),
            );
            const byRows = await readRows(source.length, slice, rowsOf(slice, reversed));
            expect(
                Buffer.from(byRows ?? new Uint8Array(0)).equals(Buffer.from(source)),
                `Scheibe ${String(slice)}`,
            ).toBe(true);
            expect(Buffer.from(bySlices ?? new Uint8Array(0)).equals(Buffer.from(byRows ?? new Uint8Array(1)))).toBe(
                true,
            );
        }
    });

    it("das Ergebnis beginnt bei Byte 0 seines ArrayBuffers und füllt ihn ganz", async () => {
        const bytes = await readRows(source.length, 30, rowsOf(30));
        expect(bytes?.byteOffset).toBe(0);
        expect(bytes?.buffer.byteLength).toBe(source.length);
    });

    it("🔴 liefert null statt eines halben Puffers: fehlende, kurze, doppelte und fremde Zeilen", async () => {
        const part = (index: number, slice: number) => source.slice(index * slice, index * slice + slice);
        const cases: [string, (onRow: (row: SliceRow) => void) => void][] = [
            ["fehlt eine", (onRow) => [0, 1, 3].forEach((index) => onRow({ index, part: part(index, 30) }))],
            [
                "eine ist kürzer",
                (onRow) => [0, 1, 2, 3].forEach((index) => onRow({ index, part: part(index, 30).slice(1) })),
            ],
            [
                "eine kommt doppelt",
                (onRow) => [0, 1, 1, 2, 3].forEach((index) => onRow({ index, part: part(index, 30) })),
            ],
            ["eine Nummer zu groß", (onRow) => onRow({ index: 4, part: part(3, 30) })],
            ["eine Nummer unter 0", (onRow) => onRow({ index: -1, part: part(0, 30) })],
            ["keine Zeile", () => undefined],
        ];
        for (const [name, send] of cases) {
            const bytes = await readRows(source.length, 30, async (onRow) => send(onRow));
            expect(bytes, name).toBeNull();
        }
    });

    it("lässt einen Fehler der Anfrage durch, er wird nicht zu einem Puffer", async () => {
        await expect(
            readRows(source.length, 30, async () => {
                throw new Error("Anfrage gescheitert");
            }),
        ).rejects.toThrow("Anfrage gescheitert");
    });

    it("liest nichts für nichts", async () => {
        const bytes = await readRows(0, 10, async () => undefined);
        expect(bytes?.byteLength).toBe(0);
    });
});

describe("Einstellung über die Umgebung", () => {
    it("🔴 die Scheibengröße: Vorgabe 1 MiB, Zahl in MiB, zwischen 64 KiB und 64 MiB, Unsinn gilt als nicht gesetzt", () => {
        const mib = 1024 * 1024;
        expect(routingSliceBytes({})).toBe(SLICE_BYTES);
        expect(routingSliceBytes({ ROUTING_SLICE_MIB: "" })).toBe(SLICE_BYTES);
        expect(routingSliceBytes({ ROUTING_SLICE_MIB: "4" })).toBe(4 * mib);
        expect(routingSliceBytes({ ROUTING_SLICE_MIB: " 16 " })).toBe(16 * mib);
        expect(routingSliceBytes({ ROUTING_SLICE_MIB: "0.5" })).toBe(mib / 2);
        expect(routingSliceBytes({ ROUTING_SLICE_MIB: "0.0001" })).toBe(64 * 1024);
        expect(routingSliceBytes({ ROUTING_SLICE_MIB: "1000" })).toBe(64 * mib);
        for (const unsinn of ["viel", "-4", "0", "NaN", "Infinity", "4MiB"]) {
            expect(routingSliceBytes({ ROUTING_SLICE_MIB: unsinn }), unsinn).toBe(SLICE_BYTES);
        }
    });

    it("🔴 die Art zu lesen: auto ist die Vorgabe, slices und rows erzwingen eine Art, alles andere ist auto", () => {
        expect(routingRasterRead({})).toBe("auto");
        expect(routingRasterRead({ ROUTING_RASTER_READ: "slices" })).toBe("slices");
        expect(routingRasterRead({ ROUTING_RASTER_READ: " ROWS " })).toBe("rows");
        for (const unsinn of ["", "auto", "ganz", "1"]) {
            expect(routingRasterRead({ ROUTING_RASTER_READ: unsinn }), unsinn).toBe("auto");
        }
    });
});

/** Ein kleiner echter Seegraph, hin und zurück durch das Speicherformat. */
function smallSeaGraph(): Buffer {
    const ring: [number, number][] = [
        [0, 0],
        [40, 0],
        [40, 20],
        [0, 20],
        [0, 0],
    ];
    const points = ring;
    const water = prepareNavigableWater([
        {
            geometry: { type: "Polygon", coordinates: [ring] },
            minX: Math.min(...points.map(([x]) => x)),
            minY: Math.min(...points.map(([, y]) => y)),
            maxX: Math.max(...points.map(([x]) => x)),
            maxY: Math.max(...points.map(([, y]) => y)),
            regionName: "Meer",
            regionType: "meer",
            areaPublicId: "0",
        },
    ]);
    const grid = buildSeaGrid(water, 0.5);
    const graph = new VisibilityGraph(grid, [ring]);
    graph.weigh([coastProfile(AVENTURIA_TRAVEL_MODEL, "galley")], coastDistance(grid));
    const ports: SeaGraphPort[] = [
        { placeId: "west", node: graph.attach(1.25, 10.25) },
        { placeId: "ost", node: graph.attach(38.75, 10.25) },
    ];
    return encodeSeaGraph(compactSeaGraph(graph.snapshot(), ["galley"], ports, waterMask(grid)));
}

describe("Seegraph aus Scheiben (WI-0071)", () => {
    const encoded = smallSeaGraph();

    it("🔴 `adopt` übernimmt einen frisch gelesenen Puffer, statt ihn zu kopieren, und liest dieselben Felder", () => {
        const own = Uint8Array.from(encoded);
        const adopted = decodeSeaGraph(own, { adopt: true });
        expect(adopted).toEqual(decodeSeaGraph(encoded));
        // Die Felder liegen im übernommenen Puffer selbst: kein zweiter Speicher von 16 MiB neben dem Original.
        expect(adopted.nodeX.buffer).toBe(own.buffer);
    });

    it("🪤 `adopt` kopiert trotzdem, wenn der Puffer nicht ab Byte 0 ganz ihm gehört (ein Ausschnitt, ein Node-Buffer-Pool)", () => {
        const pooled = new Uint8Array(encoded.length + 16);
        pooled.set(encoded, 8);
        const view = pooled.subarray(8, 8 + encoded.length);
        const decoded = decodeSeaGraph(view, { adopt: true });
        expect(decoded).toEqual(decodeSeaGraph(encoded));
        expect(decoded.nodeX.buffer).not.toBe(pooled.buffer);
    });

    it("ohne `adopt` bleibt es bei der Kopie", () => {
        const own = Uint8Array.from(encoded);
        expect(decodeSeaGraph(own).nodeX.buffer).not.toBe(own.buffer);
    });

    /** Eine Datenbank, die nur den Seegraphen kennt; `replaced` ersetzt ihn nach der ersten Scheibe. */
    function fakeDatabase(graph: Buffer, replaceAfter: number | null = null) {
        const queries: string[] = [];
        let slices = 0;
        const fragment = () => ({});
        const database = Object.assign(
            async (strings: TemplateStringsArray, ...values: unknown[]) => {
                const sql = strings.join("?");
                queries.push(sql);
                if (sql.includes("substring(graph")) {
                    slices += 1;
                    // Nach `replaceAfter` Scheiben gibt es die abgeleitete Fassung nicht mehr (neu abgeleitet).
                    if (replaceAfter !== null && slices > replaceAfter) return [];
                    const [from, length] = values as [number, number];
                    return [{ part: Buffer.from(graph.subarray(from - 1, from - 1 + length)) }];
                }
                if (sql.includes("octet_length(graph)")) {
                    return [
                        {
                            bytes: graph.length,
                            algorithm_version: SEA_ROUTE_ALGORITHM,
                            source_fingerprint: "quelle",
                            derived_at: new Date("2026-10-03T10:00:00Z"),
                            stats: { written: true },
                        },
                    ];
                }
                return [];
            },
            // `database\`AND …\`` baut ein Teilstück; der Test braucht es nicht auszuwerten.
            { json: fragment },
        ) as unknown as Queryable;
        return { database, queries };
    }

    it("🔴 liest in Scheiben und liefert denselben Graphen mit denselben Kennungen wie die ganze Zeile", async () => {
        const { database, queries } = fakeDatabase(encoded);
        const stored = await loadSeaRoutes(database, "aventuria", { sliceBytes: 100 });
        expect(stored?.graph).toEqual(decodeSeaGraph(encoded));
        expect(stored).toMatchObject({
            algorithm: SEA_ROUTE_ALGORITHM,
            fingerprint: "quelle",
            derivedAt: "2026-10-03T10:00:00.000Z",
        });
        expect(queries.filter((sql) => sql.includes("substring(graph"))).toHaveLength(Math.ceil(encoded.length / 100));
        // Nur die kleinen Spalten kommen als Ganzes; die große Spalte nie als eine Zeile.
        expect(queries.some((sql) => sql.includes("SELECT graph,"))).toBe(false);
    });

    it("🔴 wurde der Graph zwischen zwei Scheiben neu abgeleitet, ist das Ergebnis null wie bei „keiner passt“", async () => {
        const { database } = fakeDatabase(encoded, 1);
        expect(await loadSeaRoutes(database, "aventuria", { sliceBytes: 100 })).toBeNull();
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
describe.skipIf(!testDatabaseUrl)("Seegraph gegen die Datenbank: Scheiben und ganze Zeile sind dasselbe", () => {
    const database = createDatabase(testDatabaseUrl ?? "", { max: 2 });
    afterAll(() => database.end({ timeout: 5 }));

    it("🔴 liest einen geschriebenen Graphen in krummen Scheiben genau wie in einer Zeile", async () => {
        const rollback = new Error("Fixture zurückrollen");
        const encoded = smallSeaGraph();
        try {
            await database.begin(async (tx) => {
                await tx`
                    INSERT INTO sea_route_graph (map_domain_id, algorithm_version, source_fingerprint, graph, stats)
                    VALUES (${AVENTURIA.mapDomain}, ${SEA_ROUTE_ALGORITHM}, 'wi0071', ${encoded}, '{}'::jsonb)
                    ON CONFLICT (map_domain_id) DO UPDATE SET
                        algorithm_version = EXCLUDED.algorithm_version, source_fingerprint = EXCLUDED.source_fingerprint,
                        graph = EXCLUDED.graph, stats = EXCLUDED.stats
                `;
                const whole = await loadSeaRoutes(tx, AVENTURIA.mapDomain, { current: true });
                const sliced = await loadSeaRoutes(tx, AVENTURIA.mapDomain, { current: true, sliceBytes: 333 });
                expect(whole?.fingerprint).toBe("wi0071");
                expect(sliced).toEqual(whole);
                throw rollback;
            });
        } catch (error) {
            if (error !== rollback) throw error;
        }
    });
});
