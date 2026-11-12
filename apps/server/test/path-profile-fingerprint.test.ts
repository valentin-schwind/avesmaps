import { AVENTURIA_TRAVEL_MODEL } from "@avesmaps3d/shared";
import { describe, expect, it } from "vitest";
import type { DomainHeightSource } from "../src/terrain/domain/read.ts";
import {
    DOMAIN_BLOCK,
    pathHeightFingerprint,
    profileLine,
    rasterContentKey,
    type HeightRaster,
    type HeightSource,
} from "../src/terrain/path-profiles.ts";
import { DEFAULT_CONE } from "../src/terrain/peak-cone.ts";

/**
 * Der Höhenstand EINES Weges (WI-0059, 4.4): Er hängt nur an den Rastern und freien Gipfeln an seinem Rahmen, nicht an
 * der Reihenfolge der Raster und nicht an dem, was anderswo auf der Karte geschieht.
 */

function raster(minX: number, minY: number, fingerprint: string): HeightRaster {
    return {
        raster: { cell: 0.25, originX: minX, originY: minY, width: 3, height: 3, samples: new Uint16Array(9) },
        geometry: { type: "Polygon", coordinates: [[]] },
        bounds: { minX, minY, maxX: minX + 10, maxY: minY + 10 },
        fingerprint,
    };
}

const source = (rasters: HeightRaster[], peaks: HeightSource["peaks"] = []): HeightSource => ({
    rasters,
    peaks,
    rule: DEFAULT_CONE,
});

const box = { minX: 12, minY: 12, maxX: 18, maxY: 18 };
const model = AVENTURIA_TRAVEL_MODEL;

describe("Der Maßstab der Wegprofile (WI-0153 Schnitt 7d)", () => {
    it("🔴 geht nur in den Abdruck ein, wenn er von 3000 abweicht: gespeicherte Profile bleiben mit der Setzung gültig", () => {
        const stand = source([raster(10, 10, "a")]);
        expect(pathHeightFingerprint(box, stand, model, 3000)).toBe(pathHeightFingerprint(box, stand, model));
        expect(pathHeightFingerprint(box, stand, model, 4000)).not.toBe(pathHeightFingerprint(box, stand, model));
    });

    it("🔴 die Steigung eines Paars folgt dem Maßstab: doppelt so viele Schritt je Einheit, halb so steil", () => {
        const hang = (x: number): { height: number; mountain: boolean } => ({ height: x * 300, mountain: false });
        const steilste = (schritt: number): number =>
            profileLine(
                [
                    [0, 0],
                    [1, 0],
                ],
                hang,
                0.2,
                schritt,
            ).pairs[5] ?? 0;
        expect(steilste(3000)).toBeCloseTo(0.1, 5);
        expect(steilste(6000)).toBeCloseTo(0.05, 5);
    });
});

describe("Fingerabdruck der Höhen eines Weges", () => {
    it("ein Raster an seinem Rahmen ändert ihn, ein Raster woanders nicht", () => {
        const near = raster(10, 10, "a");
        const far = raster(200, 200, "b");
        const before = pathHeightFingerprint(box, source([near, far]), model);
        expect(pathHeightFingerprint(box, source([raster(10, 10, "a2"), far]), model)).not.toBe(before);
        expect(pathHeightFingerprint(box, source([near, raster(200, 200, "b2")]), model)).toBe(before);
        // Ein Raster, das nur den Rahmen berührt, zählt (Ränder gehören dazu).
        expect(pathHeightFingerprint(box, source([raster(18, 18, "c")]), model)).not.toBe(
            pathHeightFingerprint(box, source([]), model),
        );
    });

    it("die Reihenfolge der Raster in der Liste ist keine Eingabe", () => {
        const a = raster(10, 10, "a");
        const b = raster(15, 15, "b");
        expect(pathHeightFingerprint(box, source([a, b]), model)).toBe(
            pathHeightFingerprint(box, source([b, a]), model),
        );
    });

    it("ein freier Gipfel zählt, wenn sein Kegel den Rahmen berührt, sonst nicht", () => {
        const base = pathHeightFingerprint(box, source([]), model);
        // 1.500 Schritt: Radius 1.500 / 900 = 1,67 E.
        expect(pathHeightFingerprint(box, source([], [{ x: 19, y: 15, h: 1500 }]), model)).not.toBe(base);
        expect(pathHeightFingerprint(box, source([], [{ x: 25, y: 15, h: 1500 }]), model)).toBe(base);
        // Seine Höhe zählt mit.
        expect(pathHeightFingerprint(box, source([], [{ x: 19, y: 15, h: 1600 }]), model)).not.toBe(
            pathHeightFingerprint(box, source([], [{ x: 19, y: 15, h: 1500 }]), model),
        );
    });

    it("der Inhalt eines Rasters ist sein Schlüssel: gleiche Samples, gleiches Gitter, gleicher Schlüssel", () => {
        const base = raster(10, 10, "x").raster;
        const same = { ...base, samples: Uint16Array.from(base.samples) };
        expect(rasterContentKey(same)).toBe(rasterContentKey(base));
        const other = { ...base, samples: Uint16Array.from(base.samples) };
        other.samples[4] = 1;
        expect(rasterContentKey(other)).not.toBe(rasterContentKey(base));
        expect(rasterContentKey({ ...base, originX: 10.25 })).not.toBe(rasterContentKey(base));
    });

    it("🔴 am Domain-Master zählen nur die Blöcke unter dem Rahmen und die Gebirge an ihm (WI-0125: Wegprofile des Bereichs)", () => {
        // 1.024² Zellen zu 1 E: 2 × 2 Blöcke von 512². Zeile 0 im Süden.
        const size = 2 * DOMAIN_BLOCK;
        const domain = (samples: Uint16Array, mountains: DomainHeightSource["mountains"] = []): HeightSource => ({
            domain: {
                raster: { cell: 1, originX: 0.5, originY: 0.5, width: size, height: size, samples },
                fingerprint: "ganzer-master",
                revision: "aaaaaaaaaaaa",
                mountains,
                membershipFingerprint: "x",
            },
            rasters: [],
            peaks: [],
            rule: DEFAULT_CONE,
        });
        const base = new Uint16Array(size * size);
        const southWest = { minX: 100, minY: 100, maxX: 200, maxY: 200 };
        const before = pathHeightFingerprint(southWest, domain(base), model);
        // Ein anderer Fingerabdruck des ganzen Masters ändert nichts, solange die Blöcke gleich sind.
        const sameContent = domain(Uint16Array.from(base));
        (sameContent.domain as { fingerprint: string }).fingerprint = "anderer-master";
        expect(pathHeightFingerprint(southWest, sameContent, model)).toBe(before);
        // Eine Änderung im Block im Nordosten ändert den Weg im Südwesten nicht ...
        const northEast = Uint16Array.from(base);
        northEast[(size - 10) * size + size - 10] = 500;
        expect(pathHeightFingerprint(southWest, domain(northEast), model)).toBe(before);
        // ... eine im eigenen Block schon.
        const own = Uint16Array.from(base);
        own[150 * size + 150] = 500;
        expect(pathHeightFingerprint(southWest, domain(own), model)).not.toBe(before);
        // Ein Gebirge an seinem Rahmen zählt (die Sternregel liest seine Zugehörigkeit), eines woanders nicht.
        const area = (minX: number): DomainHeightSource["mountains"][number] => ({
            geometry: {
                type: "Polygon",
                coordinates: [
                    [
                        [minX, 100],
                        [minX + 50, 100],
                        [minX + 50, 150],
                        [minX, 100],
                    ],
                ],
            },
            minX,
            minY: 100,
            maxX: minX + 50,
            maxY: 150,
        });
        expect(pathHeightFingerprint(southWest, domain(base, [area(800)]), model)).toBe(before);
        expect(pathHeightFingerprint(southWest, domain(base, [area(120)]), model)).not.toBe(before);
    });
});
