import { describe, expect, it } from "vitest";
import { assertMapFeaturesUsable, locationsFromMapFeatures } from "../src/migration/map-features.ts";
import { MigrationAborted, transformLocations, type ImportScope } from "../src/migration/places.ts";

/**
 * Reading the legacy map payload (Finding MCS-006). It is the source the legacy map itself draws
 * from, and unlike the route network endpoint it carries every place.
 */

const scope: ImportScope = {
    bounds: { minX: 0, minY: 0, maxX: 1024, maxY: 1024 },
    subtypes: ["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude", "stadtviertel"],
};

const payload = {
    ok: true,
    revision: 140073,
    features: [
        {
            geometry: { type: "Point", coordinates: [551.625, 532.969] },
            properties: {
                feature_type: "location",
                public_id: "80558060-4299-54aa-b520-814b10819885",
                name: "Gareth",
                settlement_class: "metropole",
                is_nodix: true,
                is_ruined: false,
                is_seaport: true,
            },
        },
        {
            geometry: { type: "Point", coordinates: [570.5, 449.82] },
            properties: {
                feature_type: "location",
                public_id: "7b162e58-6ffc-5afe-909c-adfa4c053506",
                name: "Asboran",
                settlement_class: "dorf",
                is_hidden: true,
                place_kind: "Festung",
            },
        },
        // Another data domain entirely; picking it up here would be scope creep.
        {
            geometry: { type: "LineString", coordinates: [] },
            properties: { feature_type: "path", public_id: "aaaaaaaa-0000-4000-8000-000000000009", name: "Weg" },
        },
    ],
};

describe("reading locations from the map payload", () => {
    it("takes the locations and leaves the other feature classes alone", () => {
        const normalised = locationsFromMapFeatures(payload);
        expect(normalised.locations).toHaveLength(2);
        expect(normalised.map_revision).toBe(140073);
        expect(normalised.location_count).toBe(2);
    });

    it("reads a missing flag as false, the way legacy means it", () => {
        const [gareth, asboran] = locationsFromMapFeatures(payload).locations;
        // Gareth carries no is_hidden key at all; that is an answer, not a gap.
        expect(gareth?.is_hidden).toBe(false);
        expect(gareth?.is_nodix).toBe(true);
        expect(gareth?.is_ruined).toBe(false);
        expect(gareth?.is_seaport).toBe(true);
        expect(asboran?.is_hidden).toBe(true);
        expect(asboran?.is_seaport).toBe(false);
    });

    it("keeps an absent place kind absent instead of inventing an empty one", () => {
        const [gareth, asboran] = locationsFromMapFeatures(payload).locations;
        expect(gareth?.place_kind).toBeUndefined();
        expect(asboran?.place_kind).toBe("Festung");
    });

    it("carries the flags through the transformation", () => {
        const places = transformLocations(locationsFromMapFeatures(payload), scope).places;
        expect(places.map((place) => place.name)).toEqual(["Gareth", "Asboran"]);
        expect(places[1]).toMatchObject({ isHidden: true, placeKind: "Festung", isNodix: false, isSeaport: false });
        expect(places[0]).toMatchObject({ isHidden: false, placeKind: null, isNodix: true, isSeaport: true });
    });

    it("refuses a payload that is not the answer we asked for", () => {
        // An error page, a different endpoint or an empty result all parse as JSON. None of them
        // may be read as "the map has no places any more".
        expect(() => assertMapFeaturesUsable({ ...payload, ok: false })).toThrow(MigrationAborted);
        expect(() => assertMapFeaturesUsable({ ok: true, features: payload.features })).toThrow(MigrationAborted);
        expect(() => assertMapFeaturesUsable({ ok: true, revision: 1, features: [] })).toThrow(MigrationAborted);
    });
});
