import { describe, expect, it } from "vitest";
import { AVENTURIA } from "../src/map-domain-registry.ts";
import {
    WEB_MERCATOR_HALF_WORLD,
    createRenderProjection,
    renderBounds,
    toRenderLngLat,
} from "../src/render-projection.ts";

const space = AVENTURIA.coordinateSpace;
const projection = createRenderProjection(space);

describe("derived render projection", () => {
    it("maps the domain square onto the full web mercator square", () => {
        expect(projection.toRender({ x: 0, y: 0 })).toEqual({
            x: -WEB_MERCATOR_HALF_WORLD,
            y: -WEB_MERCATOR_HALF_WORLD,
        });
        const topRight = projection.toRender({ x: 1024, y: 1024 });
        expect(topRight.x).toBeCloseTo(WEB_MERCATOR_HALF_WORLD, 6);
        expect(topRight.y).toBeCloseTo(WEB_MERCATOR_HALF_WORLD, 6);
    });

    it("keeps north up: a larger y stays a larger render y", () => {
        const south = projection.toRender({ x: 500, y: 100 });
        const north = projection.toRender({ x: 500, y: 900 });
        expect(north.y).toBeGreaterThan(south.y);
    });

    it("is reversible for every sampled point", () => {
        for (const point of [
            { x: 0, y: 0 },
            { x: 1024, y: 1024 },
            { x: 551.625, y: 532.969 },
            { x: 0.001, y: 1023.999 },
        ]) {
            const roundTrip = projection.fromRender(projection.toRender(point));
            expect(roundTrip.x).toBeCloseTo(point.x, 9);
            expect(roundTrip.y).toBeCloseTo(point.y, 9);
        }
    });

    it("does not distort: the same distance in x and y scales identically", () => {
        const origin = projection.toRender({ x: 100, y: 100 });
        const alongX = projection.toRender({ x: 200, y: 100 });
        const alongY = projection.toRender({ x: 100, y: 200 });
        expect(alongX.x - origin.x).toBeCloseTo(alongY.y - origin.y, 6);
    });

    it("produces a camera lng/lat inside the world", () => {
        const { lng, lat } = toRenderLngLat(space, { x: 512, y: 512 });
        expect(lng).toBeCloseTo(0, 9);
        expect(lat).toBeCloseTo(0, 9);
        const corner = toRenderLngLat(space, { x: 1024, y: 1024 });
        expect(corner.lng).toBeCloseTo(180, 6);
        expect(corner.lat).toBeLessThan(86);
    });
});

describe("camera bounds of the domain", () => {
    it("covers the whole render square but stays off the antimeridian", () => {
        const { southWest, northEast } = renderBounds(AVENTURIA.coordinateSpace);

        // The domain is square and fills the render square, so its box is the whole projection -
        // except that the eastern edge must stay just inside 180 degrees. Exactly 180 is wrapped
        // back to 0 by MapLibre, the allowed width collapses to zero and the map dies while
        // resizing, before it has drawn anything.
        expect(northEast.lng).toBeLessThan(180);
        expect(northEast.lng).toBeCloseTo(180, 8);
        expect(southWest.lng).toBeGreaterThan(-180);
        expect(southWest.lng).toBeCloseTo(-180, 8);

        // Top and bottom are the Mercator limit, which is where the domain square ends.
        expect(northEast.lat).toBeCloseTo(85.0511287798066, 9);
        expect(southWest.lat).toBeCloseTo(-85.0511287798066, 9);
    });

    it("gives a narrower box to a domain that does not fill the square", () => {
        const narrow = {
            ...AVENTURIA.coordinateSpace,
            bounds: { minX: 0, minY: 0, maxX: 512, maxY: 1024 },
        };
        const { southWest, northEast } = renderBounds(narrow);
        // Half the width of the square: the unused render space is not claimed by the camera.
        expect(northEast.lng).toBeCloseTo(0, 9);
        expect(southWest.lng).toBeCloseTo(-180, 8);
    });
});
