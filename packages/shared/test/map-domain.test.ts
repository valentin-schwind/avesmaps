import { describe, expect, it } from "vitest";
import { AVENTURIA, getMapDomain } from "../src/map-domain-registry.ts";
import { distanceInMiles, distanceInUnits, isWithinBounds } from "../src/map-domain.ts";

const space = AVENTURIA.coordinateSpace;

describe("aventuria-v1", () => {
    // These numbers come from VERIFIED findings MCS-001 and MCS-002, not from assumptions.
    // A change here changes the map, so the test states them literally.
    it("keeps the verified legacy bounds and axes", () => {
        expect(space.id).toBe("aventuria-v1");
        expect(space.bounds).toEqual({ minX: 0, minY: 0, maxX: 1024, maxY: 1024 });
        expect(space.axis).toEqual({ x: "east", y: "north" });
        expect(space.geographic).toBe(false);
        expect(space.storageOrder).toBe("xy");
    });

    it("keeps the verified scale of three Meilen per map unit", () => {
        expect(space.distance.milesPerUnit).toBe(3);
        expect(space.distance.schrittPerUnit).toBe(3000);
    });

    it("has no planetary registration", () => {
        expect(AVENTURIA.planetaryRegistration.status).toBe("none");
    });
});

describe("bounds", () => {
    it("accepts the corners and rejects points outside", () => {
        expect(isWithinBounds(space, { x: 0, y: 0 })).toBe(true);
        expect(isWithinBounds(space, { x: 1024, y: 1024 })).toBe(true);
        expect(isWithinBounds(space, { x: 1024.5, y: 10 })).toBe(false);
        expect(isWithinBounds(space, { x: 10, y: -0.5 })).toBe(false);
    });
});

describe("distance", () => {
    it("measures in map units on the planar space", () => {
        expect(distanceInUnits({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    });

    it("converts one map unit into three Meilen", () => {
        expect(distanceInMiles(space, { x: 0, y: 0 }, { x: 1, y: 0 })).toBe(3);
        // The whole map is 1024 units wide, so 3072 Meilen across.
        expect(distanceInMiles(space, { x: 0, y: 0 }, { x: 1024, y: 0 })).toBe(3072);
    });
});

describe("registry", () => {
    it("resolves aventuria and refuses unknown domains", () => {
        expect(getMapDomain("aventuria").coordinateSpace.id).toBe("aventuria-v1");
        expect(() => getMapDomain("myranor")).toThrow(/unknown map domain/);
    });
});
