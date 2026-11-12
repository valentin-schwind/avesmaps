import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RouteStage, RouteStagePoint } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { createSubjectService, type SubjectService } from "../src/subjects/service.ts";
import { addStageTerritories, leafTerritoriesAt, stationPointsOf } from "../src/subjects/stage-territories.ts";
import { P4, cleanSubjectFixtures, insertSubjectFixtures } from "./support/subject-fixture.ts";

/**
 * Das Gebiet an den Wegpunkten einer Reise (WI-0087 P3) gegen echtes PostgreSQL und PostGIS, auf derselben Fixture wie
 * der Subject-Vertrag: dieselbe Welt, dieselben Ketten - so steht die Zusicherung „die Etappenliste nennt dieselbe
 * Ebene wie der Untertitel des Infopanels" an EINEM Satz Daten.
 *
 * Die Ketten der Fixture (siehe `subjects.test.ts`): P4 Gareth liegt in Reich → Provinz West → Grafschaft, P4 Dorf Eins
 * in Reich → Provinz Ost, P4 Dorf Osten allein im Nachbarreich.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const GARETH = { x: 110, y: 110 };
const DORF = { x: 140, y: 120 };
const OSTEN = { x: 180, y: 150 };
/** Weit außerhalb jeder Gebietsform der Fixture: ein Punkt ohne Gebiet. */
const NIEMANDSLAND = { x: -4000, y: -4000 };

const place = (id: string, name: string, at: { x: number; y: number }): RouteStagePoint => ({
    point: "place",
    place_id: id,
    name,
    subtype: "dorf",
    x: at.x,
    y: at.y,
});

const marker = (at: { x: number; y: number }): RouteStagePoint => ({
    point: "marker",
    place_id: null,
    name: "",
    x: at.x,
    y: at.y,
});

const stage = (index: number, leg: number, from: RouteStagePoint, to: RouteStagePoint): RouteStage =>
    ({
        index,
        leg_index: leg,
        segment_start: index,
        segment_count: 1,
        type: "Strasse",
        transport: "groupFoot",
        flow_state: null,
        path_names: [],
        from,
        to,
        distance_units: 1,
        travel_hours: 1,
        rest_hours: 0,
    }) as RouteStage;

describe("Welche Punkte eine Station tragen (rein rechnerisch)", () => {
    it("🔴 vor der ersten Etappe jeder Teilstrecke ihr Wegpunkt, nach der letzten das Ziel", () => {
        const a = place("a", "A", GARETH);
        const b = place("b", "B", DORF);
        const c = place("c", "C", OSTEN);
        const stations = stationPointsOf([stage(0, 0, a, b), stage(1, 1, b, c), stage(2, 1, c, a)]);
        expect(stations).toEqual([
            { stage: 0, end: "from" },
            { stage: 1, end: "from" },
            { stage: 2, end: "to" },
        ]);
    });

    it("eine Reise ohne Etappen hat keine Station", () => {
        expect(stationPointsOf([])).toEqual([]);
    });
});

describeWithDatabase("Das Gebiet an einem Wegpunkt (echtes PostGIS)", () => {
    let database: Database;
    let subjects: SubjectService;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await insertSubjectFixtures(database);
        subjects = createSubjectService(database);
    }, 180_000);

    afterAll(async () => {
        await cleanSubjectFixtures(database);
        await database.end({ timeout: 5 });
    });

    it("🔴 genannt wird die UNTERSTE Ebene der Kette - dieselbe wie im Untertitel des Infopanels", async () => {
        const index = await subjects.index();
        const found = await leafTerritoriesAt(database, index, [GARETH, DORF, OSTEN, NIEMANDSLAND]);
        expect(found.map((entry) => entry?.name)).toEqual([
            "P4 Grafschaft",
            "P4 Provinz Ost",
            "P4 Nachbarreich",
            undefined,
        ]);
        expect(found[0]?.id).toBe(P4.grafschaft);
    });

    it("🔴 EIN Statement für alle Punkte: die Reihenfolge der Antwort ist die der Punkte", async () => {
        const index = await subjects.index();
        const found = await leafTerritoriesAt(database, index, [OSTEN, GARETH, NIEMANDSLAND, DORF]);
        expect(found.map((entry) => entry?.name)).toEqual([
            "P4 Nachbarreich",
            "P4 Grafschaft",
            undefined,
            "P4 Provinz Ost",
        ]);
    });

    it("🔴 nur die WEGPUNKTE bekommen ein Gebiet, nicht jedes Etappenende", async () => {
        const index = await subjects.index();
        const start = place(P4.gareth, "P4 Gareth", GARETH);
        const mitte = place(P4.dorf, "P4 Dorf Eins", DORF);
        const ziel = place(P4.dorfOsten, "P4 Dorf Osten", OSTEN);
        const stages = await addStageTerritories(database, index, [
            stage(0, 0, start, mitte),
            stage(1, 1, mitte, ziel),
        ]);
        // Station: `from` der ersten Etappe, `from` der zweiten (Zwischenziel), `to` der letzten.
        expect(stages[0]?.from.territory?.name).toBe("P4 Grafschaft");
        expect(stages[1]?.from.territory?.name).toBe("P4 Provinz Ost");
        expect(stages[1]?.to.territory?.name).toBe("P4 Nachbarreich");
        // Kein Wegpunkt: das Ende der ersten Etappe mitten in der Teilstrecke.
        expect(stages[0]?.to.territory).toBeUndefined();
    });

    it("🔴 ein Wegpunkt ohne Ort (Markierung) bekommt keines, und die Antwort bleibt vollständig", async () => {
        const index = await subjects.index();
        const stages = await addStageTerritories(database, index, [
            stage(0, 0, marker(GARETH), place(P4.dorf, "P4 Dorf Eins", DORF)),
        ]);
        expect(stages[0]?.from.territory).toBeUndefined();
        expect(stages[0]?.to.territory?.name).toBe("P4 Provinz Ost");
        expect(stages).toHaveLength(1);
    });

    it("ein Wegpunkt ohne Gebiet bleibt ohne - und nicht mit einem leeren Feld", async () => {
        const index = await subjects.index();
        const stages = await addStageTerritories(database, index, [
            stage(0, 0, place("nirgendwo", "Nirgendwo", NIEMANDSLAND), place(P4.dorf, "P4 Dorf Eins", DORF)),
        ]);
        expect(stages[0]?.from.territory).toBeUndefined();
        expect(Object.keys(stages[0]?.from ?? {})).not.toContain("territory");
    });
});
