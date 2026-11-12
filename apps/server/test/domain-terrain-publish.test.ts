import { describe, expect, it } from "vitest";
import { DEM_MAX_ZOOM, DEM_TILE_SIZE } from "../src/terrain/dem-tiles.ts";
import { composeDomainDem } from "../src/terrain/domain/publish.ts";

/** The published master size: one cell per pixel of the finest DEM level. */
const N = DEM_TILE_SIZE << DEM_MAX_ZOOM;
const CELL = 1024 / N;

describe("Domain DEM publication projection", () => {
    it("projects absolute master samples with correct north/south orientation and no added height", () => {
        const samples = new Uint16Array(N * N);
        samples[0] = 60;
        samples[N * (N - 1) + N - 1] = 630;
        samples[(N / 2) * N + N / 2] = 5000;
        const field = composeDomainDem({
            cell: CELL,
            originX: CELL / 2,
            originY: CELL / 2,
            width: N,
            height: N,
            samples,
        });
        expect(field[(N - 1) * N]).toBe(60);
        expect(field[N - 1]).toBe(630);
        expect(field[(N / 2 - 1) * N + N / 2]).toBe(5000);
        expect(field[0]).toBe(0);
    });
    it("rejects an incorrectly positioned master instead of publishing shifted tiles", () => {
        expect(() =>
            composeDomainDem({
                cell: CELL,
                originX: 0,
                originY: CELL / 2,
                width: N,
                height: N,
                samples: new Uint16Array(N * N),
            }),
        ).toThrow(/domain/i);
    });
});
