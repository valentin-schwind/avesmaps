import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import {
    assertSourceComplete,
    importPlaces,
    MigrationAborted,
    transformLocations,
    type ImportScope,
    type LegacyPayload,
} from "../src/migration/places.ts";

const scope: ImportScope = {
    bounds: { minX: 480, minY: 460, maxX: 560, maxY: 540 },
    subtypes: ["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude", "stadtviertel"],
};

const gareth = {
    public_id: "80558060-4299-54aa-b520-814b10819885",
    name: "Gareth",
    subtype: "metropole",
    is_crossing: false,
    coordinates: { x: 551.625, y: 532.969 },
};

const payload: LegacyPayload = {
    map_revision: 139969,
    location_count: 4,
    locations: [
        gareth,
        {
            ...gareth,
            public_id: "7b162e58-6ffc-5afe-909c-adfa4c053506",
            name: "Angbar",
            subtype: "grossstadt",
            coordinates: { x: 480.89062, y: 536.78125 },
        },
        // Outside the scope window: must be skipped, never written.
        {
            public_id: "aaaaaaaa-0000-4000-8000-000000000001",
            name: "Weit weg",
            subtype: "dorf",
            is_crossing: false,
            coordinates: { x: 100, y: 100 },
        },
        // A crossing is not a place (contract exclusion).
        {
            public_id: "aaaaaaaa-0000-4000-8000-000000000002",
            name: "Kreuzung",
            subtype: "crossing",
            is_crossing: true,
            coordinates: { x: 500, y: 500 },
        },
    ],
};

/** The same payload minus one place, used by the retirement and safety-limit tests. */
const withoutAngbar: LegacyPayload = {
    ...payload,
    location_count: 3,
    locations: payload.locations.filter((location) => location.name !== "Angbar"),
};

describe("the source has to agree with itself", () => {
    it("accepts a payload whose count matches", () => {
        expect(() => assertSourceComplete(payload)).not.toThrow();
    });

    it("refuses a payload that is shorter than it claims", () => {
        // This is the case that would otherwise read as "every place was deleted".
        expect(() => assertSourceComplete({ ...payload, location_count: 4000 })).toThrow(MigrationAborted);
    });

    it("refuses a payload that does not say how long it is", () => {
        expect(() => assertSourceComplete({ locations: payload.locations })).toThrow(MigrationAborted);
    });
});

describe("transformLocations", () => {
    it("keeps places, skips crossings and everything outside the scope", () => {
        const result = transformLocations(payload, scope);

        expect(result.places.map((place) => place.name)).toEqual(["Gareth", "Angbar"]);
        expect(result.skippedCrossings).toBe(1);
        expect(result.skippedOutOfScope).toBe(1);
        expect(result.rejected).toEqual([]);
    });

    it("passes coordinates through unchanged", () => {
        const [place] = transformLocations(payload, scope).places;
        expect(place).toMatchObject({ x: 551.625, y: 532.969 });
    });

    it("rejects instead of repairing broken records", () => {
        const broken: LegacyPayload = {
            locations: [
                { public_id: "not-a-uuid", name: "X", subtype: "dorf", coordinates: { x: 500, y: 500 } },
                {
                    public_id: "aaaaaaaa-0000-4000-8000-000000000003",
                    name: "Y",
                    subtype: "burg",
                    coordinates: { x: 500, y: 500 },
                },
                {
                    public_id: "aaaaaaaa-0000-4000-8000-000000000004",
                    name: "Z",
                    subtype: "dorf",
                    coordinates: { x: 5000, y: 500 },
                },
                {
                    public_id: "aaaaaaaa-0000-4000-8000-000000000005",
                    name: "  ",
                    subtype: "dorf",
                    coordinates: { x: 500, y: 500 },
                },
            ],
        };
        const reasons = transformLocations(broken, scope).rejected.map((entry) => entry.reason);

        expect(reasons).toHaveLength(4);
        expect(reasons[0]).toMatch(/uuid/);
        expect(reasons[1]).toMatch(/unknown subtype/);
        expect(reasons[2]).toMatch(/outside the coordinate space/);
        expect(reasons[3]).toMatch(/name is empty/);
    });
});

describe("transformLocations reads is_seaport like its siblings", () => {
    it("treats a missing key as false and an explicit key as its value", () => {
        const withAndWithout: LegacyPayload = {
            locations: [
                { ...gareth, is_seaport: true },
                { ...gareth, public_id: "7b162e58-6ffc-5afe-909c-adfa4c053506", name: "Angbar" },
            ],
        };
        const [portPlace, plainPlace] = transformLocations(withAndWithout, scope).places;

        expect(portPlace?.isSeaport).toBe(true);
        expect(plainPlace?.isSeaport).toBe(false);
    });
});

// Chapter 11.10: migration semantics are verified against real PostgreSQL/PostGIS.
// Without TEST_DATABASE_URL this skips visibly instead of passing silently (chapter 11.155).
const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("importPlaces against PostGIS", () => {
    let database: Database;

    beforeEach(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await seedMapDomains(database);
        // 🔴 Nur die Zeilen DIESES Tests, nie „alles aus Tabelle X" (WI-0101): `importPlaces` fasst
        // ausschließlich `source_system = 'legacy'` an (`places.ts`, drei Stellen), und jede Fixture in
        // `test/support` schreibt `source_system = 'test'`. Ein `DELETE FROM place` ohne Einschränkung
        // riss deshalb jeder anderen Testdatei die Träger weg und scheiterte selbst an deren Kindzeilen
        // (gemessen am 2026-10-07: `place_wiki_assignment_place_id_fkey`, 9 von 16 Fällen rot, sobald ein
        // zweiter Lauf gleichzeitig gegen dieselbe Testdatenbank arbeitet).
        //
        // 🪤 Deshalb lesen die Zusicherungen dieser Datei jetzt ebenfalls nur `source_system = 'legacy'`
        // beziehungsweise `data_domain = 'places'`. **Das lockert keine Erwartung:** Importer und Prüfer
        // können gar nichts anderes schreiben, „alle Zeilen der Tabelle" war nur eine Folge davon, dass
        // die Tabelle vorher leergeräumt wurde. Belegt an genau dieser Datei: drei liegengebliebene
        // `migration_run`-Zeilen der Domäne `paths` aus einer FREMDEN Testdatei ließen „not even a run
        // journal entry" fallen, obwohl der Importer korrekt nichts geschrieben hatte.
        await database`DELETE FROM place WHERE source_system = 'legacy'`;
        await database`DELETE FROM migration_run WHERE data_domain = 'places'`;
    });

    afterEach(async () => {
        // Und wieder wegräumen: wer nur vorher aufräumt, lässt seine Zeilen für die nächste Datei liegen.
        await database`DELETE FROM place WHERE source_system = 'legacy'`;
        await database`DELETE FROM migration_run WHERE data_domain = 'places'`;
        await database.end({ timeout: 5 });
    });

    it("writes the slice and stores geometry in the coordinate space", async () => {
        const report = await importPlaces(database, payload, scope);
        expect(report).toMatchObject({ created: 2, updated: 0, unchanged: 0, retired: 0, skippedCrossings: 1 });

        const rows = await database<{ name: string; x: number; y: number; srid: number }[]>`
            SELECT name, ST_X(geom) AS x, ST_Y(geom) AS y, ST_SRID(geom) AS srid
            FROM place WHERE name = 'Gareth'
        `;
        expect(rows[0]).toEqual({ name: "Gareth", x: 551.625, y: 532.969, srid: 0 });
    });

    it("is idempotent, and a repeat run writes nothing", async () => {
        await importPlaces(database, payload, scope);
        const before = await database<
            { updated_at: string }[]
        >`SELECT updated_at::text FROM place WHERE source_system = 'legacy' ORDER BY name`;
        const second = await importPlaces(database, payload, scope);
        const after = await database<
            { updated_at: string }[]
        >`SELECT updated_at::text FROM place WHERE source_system = 'legacy' ORDER BY name`;
        expect(after, "no row may even be touched").toEqual(before);

        // Not "ends up the same" but "does nothing": an unchanged row is not written at all.
        expect(second).toMatchObject({ created: 0, updated: 0, unchanged: 2, retired: 0 });
        const [count] = await database<
            { total: number }[]
        >`SELECT count(*)::int AS total FROM place WHERE source_system = 'legacy'`;
        expect(count?.total).toBe(2);
    });

    it("retires a place the source dropped, inside the scope only", async () => {
        await importPlaces(database, payload, scope);
        // Half the rows in this tiny fixture, which is far over the 5 % line: it is reported, not refused.
        const report = await importPlaces(database, withoutAngbar, scope);
        expect(report.retired).toBe(1);

        const rows = await database<{ name: string; is_active: boolean }[]>`
            SELECT name, is_active FROM place WHERE source_system = 'legacy' ORDER BY name
        `;
        expect(rows).toEqual([
            { name: "Angbar", is_active: false },
            { name: "Gareth", is_active: true },
        ]);
    });

    it("reports retiring more than 5 % as a finding with numbers and names, and the run goes through (operator 2026-10-03)", async () => {
        await importPlaces(database, payload, scope);

        // Used to stop the run (a truncated source looks like a mass deletion). The operator wants only checks he
        // defined to stop an import: the run retires, and the report names the numbers and the places.
        const report = await importPlaces(database, withoutAngbar, scope);
        expect(report.retired).toBe(1);

        expect(report.findings).toHaveLength(1);
        const [finding] = report.findings;
        expect(finding?.code).toBe("stilllegequote");
        expect(finding?.numbers).toEqual({ table: "place", active: 2, retiring: 1, share: 0.5, limit: 0.05 });
        expect(finding?.objects).toEqual([
            { table: "place", publicId: "7b162e58-6ffc-5afe-909c-adfa4c053506", name: "Angbar" },
        ]);

        const rows = await database<{ name: string; is_active: boolean }[]>`
            SELECT name, is_active FROM place WHERE source_system = 'legacy' ORDER BY name
        `;
        expect(rows).toEqual([
            { name: "Angbar", is_active: false },
            { name: "Gareth", is_active: true },
        ]);
    });

    it("reports nothing while a run retires at most 5 %", async () => {
        await importPlaces(database, payload, scope);
        const report = await importPlaces(database, payload, scope);
        expect(report.findings).toEqual([]);
    });

    it("writes nothing at all when the source is incomplete", async () => {
        const truncated: LegacyPayload = { ...payload, location_count: 99 };
        await expect(importPlaces(database, truncated, scope)).rejects.toThrow(MigrationAborted);

        const [count] = await database<
            { total: number }[]
        >`SELECT count(*)::int AS total FROM place WHERE source_system = 'legacy'`;
        expect(count?.total).toBe(0);
        const [runs] = await database<
            { total: number }[]
        >`SELECT count(*)::int AS total FROM migration_run WHERE data_domain = 'places'`;
        expect(runs?.total, "not even a run journal entry").toBe(0);
    });

    it("carries is_seaport across, false where the source omits the key", async () => {
        const withSeaport: LegacyPayload = {
            ...payload,
            locations: payload.locations.map((location) =>
                location.name === "Gareth" ? { ...location, is_seaport: true } : location,
            ),
        };
        await importPlaces(database, withSeaport, scope);
        const rows = await database<{ name: string; is_seaport: boolean }[]>`
            SELECT name, is_seaport FROM place WHERE source_system = 'legacy' ORDER BY name
        `;
        expect(rows).toEqual([
            { name: "Angbar", is_seaport: false },
            { name: "Gareth", is_seaport: true },
        ]);

        // A repeat of the same source is a no-op, is_seaport included: "idempotent" means "does
        // nothing", not "ends up the same" (chapter 9.32).
        const second = await importPlaces(database, withSeaport, scope);
        expect(second).toMatchObject({ created: 0, updated: 0, unchanged: 2, retired: 0 });
    });

    it("treats a flipped is_seaport as a change, not a no-op", async () => {
        await importPlaces(database, payload, scope);
        const withSeaport: LegacyPayload = {
            ...payload,
            locations: payload.locations.map((location) =>
                location.name === "Gareth" ? { ...location, is_seaport: true } : location,
            ),
        };
        const report = await importPlaces(database, withSeaport, scope);
        expect(report).toMatchObject({ created: 0, updated: 1, unchanged: 1, retired: 0 });
    });

    it("preserves the legacy identity", async () => {
        await importPlaces(database, payload, scope);
        const rows = await database<{ public_id: string; legacy_public_id: string }[]>`
            SELECT public_id::text, legacy_public_id::text FROM place WHERE name = 'Gareth'
        `;
        expect(rows[0]?.public_id).toBe(gareth.public_id);
        expect(rows[0]?.legacy_public_id).toBe(gareth.public_id);
    });
});
