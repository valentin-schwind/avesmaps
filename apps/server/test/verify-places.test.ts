import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkFindings } from "../src/blocking-checks.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { importPlaces, type ImportScope, type LegacyPayload } from "../src/migration/places.ts";
import { verifyPlaces } from "../src/migration/verify-places.ts";

/**
 * The parity check has to fail when something is wrong - a check that only ever passes proves
 * nothing. Each case below breaks exactly one thing and expects exactly that check to complain.
 */

const scope: ImportScope = {
    bounds: { minX: 0, minY: 0, maxX: 1024, maxY: 1024 },
    subtypes: ["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude", "stadtviertel"],
};

const payload: LegacyPayload = {
    map_revision: 140067,
    location_count: 3,
    locations: [
        {
            public_id: "80558060-4299-54aa-b520-814b10819885",
            name: "Gareth",
            subtype: "metropole",
            is_crossing: false,
            coordinates: { x: 551.625, y: 532.969 },
        },
        {
            public_id: "7b162e58-6ffc-5afe-909c-adfa4c053506",
            name: "Angbar",
            subtype: "grossstadt",
            is_crossing: false,
            coordinates: { x: 480.89062, y: 536.78125 },
        },
        {
            public_id: "aaaaaaaa-0000-4000-8000-000000000002",
            name: "Kreuzung",
            subtype: "crossing",
            is_crossing: true,
            coordinates: { x: 500, y: 500 },
        },
    ],
};

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("places parity", () => {
    let database: Database;

    beforeEach(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await seedMapDomains(database);
        // 🔴 Nur die Zeilen DIESES Tests (WI-0101, wie in `migration-places.test.ts`): Prüfer und Importer
        // sehen ausschließlich `source_system = 'legacy'`, die Fixtures schreiben `'test'`.
        await database`DELETE FROM place WHERE source_system = 'legacy'`;
        await database`DELETE FROM migration_run WHERE data_domain = 'places'`;
        await importPlaces(database, payload, scope);
    });

    afterEach(async () => {
        // Und wieder wegräumen: wer nur vorher aufräumt, lässt seine Zeilen für die nächste Datei liegen.
        await database`DELETE FROM place WHERE source_system = 'legacy'`;
        await database`DELETE FROM migration_run WHERE data_domain = 'places'`;
        await database.end({ timeout: 5 });
    });

    const verdict = async (name: string): Promise<boolean> => {
        const report = await verifyPlaces(database, payload, scope);
        const check = report.checks.find((candidate) => candidate.name === name);
        if (!check) {
            throw new Error(`no check named ${name}`);
        }
        return check.passed;
    };

    it("passes on a faithful migration and counts only the places", async () => {
        const report = await verifyPlaces(database, payload, scope);
        expect(report.passed, JSON.stringify(report.checks, null, 2)).toBe(true);
        // The crossing is not a place and must not appear in the count.
        expect(report.checks.find((check) => check.name === "count")?.detail).toBe("Quelle 2, Ziel 2");
    });

    it("notices a coordinate that moved", async () => {
        await database`UPDATE place SET geom = ST_SetSRID(ST_MakePoint(551.626, 532.969), 0) WHERE name = 'Gareth'`;
        expect(await verdict("coordinates-exact")).toBe(false);
        // A millimetre is still a difference: parity is exact, not approximate.
        expect(await verdict("count")).toBe(true);
    });

    it("notices a missing place", async () => {
        await database`UPDATE place SET is_active = FALSE WHERE name = 'Angbar'`;
        expect(await verdict("identity-complete")).toBe(false);
        expect(await verdict("count")).toBe(false);
    });

    it("notices a place the source does not know", async () => {
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, legacy_public_id, is_active)
            VALUES ('bbbbbbbb-0000-4000-8000-000000000001', 'aventuria', 'Erfunden', 'dorf',
                    ST_SetSRID(ST_MakePoint(500, 500), 0), 'legacy', 'bbbbbbbb-0000-4000-8000-000000000001', TRUE)
        `;
        expect(await verdict("no-strays")).toBe(false);
    });

    it("notices a changed is_seaport flag", async () => {
        // The fixture payload carries no is_seaport key, so the source means false for every place;
        // setting it in the target directly is the deviation the "flags" check exists to catch.
        await database`UPDATE place SET is_seaport = TRUE WHERE name = 'Gareth'`;
        expect(await verdict("flags")).toBe(false);
    });

    it("🔴 a failed parity check is a finding and does not stop the run (operator 2026-10-03)", async () => {
        // Parity of the places is not a check the operator defined as a blocker (blocking-checks.ts): the check still
        // fails and says why, but the verdict stays green and the finding carries the numbers and the offender.
        await database`UPDATE place SET geom = ST_SetSRID(ST_MakePoint(551.626, 532.969), 0) WHERE name = 'Gareth'`;
        const report = await verifyPlaces(database, payload, scope);
        const check = report.checks.find((candidate) => candidate.name === "coordinates-exact");
        expect(check).toMatchObject({ passed: false, blocking: false });
        expect(report.passed, "a non-blocking check does not fail the verdict").toBe(true);

        const findings = checkFindings("verify:places", report.checks, (entry) => entry.passed);
        expect(findings.map((finding) => finding.code)).toEqual(["verify:places/coordinates-exact"]);
        expect(findings[0]?.message).toContain("1 Orte mit abweichender Koordinate");
        expect(findings[0]?.notes.join("\n")).toContain("Gareth");
    });

    it("notices a changed name or class", async () => {
        await database`UPDATE place SET name = 'Garreth' WHERE name = 'Gareth'`;
        expect(await verdict("names")).toBe(false);

        await database`UPDATE place SET subtype = 'dorf' WHERE name = 'Angbar'`;
        expect(await verdict("subtypes")).toBe(false);
        expect(await verdict("distribution")).toBe(false);
    });
});
