import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    AVENTURIA_POLITICAL_CARTOGRAPHY,
    countBorderCrossings,
    shortNameOf,
    territoryAtPoint,
} from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import type { LegacyTerritoryPayload } from "../src/migration/territories.ts";
import { importTerritories } from "../src/migration/territory-import.ts";
import { readRoutingRevision } from "../src/routing/revision.ts";
import { loadTollTerritories, NO_TOLL_TERRITORIES } from "../src/routing/toll-territories.ts";
import { routeTerritories } from "../src/landscapes/route-territories.ts";
import { deriveTerritories } from "../src/territories/derive.ts";

/**
 * Die Zollgebiete des Routings (WI-0065 U3) gegen echtes PostGIS: die Wurzeln des Bandes 0 in Legacys Reihenfolge,
 * nur mit Ableitung, samt ihrem Teil in der Routing-Revision. Legacys Regel (L1): souverän ist, wer im Anzeigejahr keinen
 * Elternteil hat UND in Band 0 gezeigt wird; ein Wurzelgebiet, das erst in einem späteren Band erscheint (Wehrheim),
 * zählt nicht.
 *
 * Die Fixture: zwei Reiche nebeneinander (das linke steht in der Liste vorn), das rechte mit einer Provinz, dazu eine
 * Wurzel, die erst ab Band 3 gezeigt wird.
 */

const ID = (n: number): string => `88888888-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const WESTREICH = ID(1);
const OSTREICH = ID(2);
const PROVINZ = ID(3);
const SPAET = ID(4);
const FLAECHE = (n: number): string => ID(0x100 + n);
const MAP_DOMAIN = "aventuria";

/** Ein Rechteck mit einem Stützpunkt in der Mitte jeder Kante (wie die Fixture der Ableitungstests). */
function quadrat(x: number, y: number, breite = 40, hoehe = 40): number[][] {
    return [
        [x, y],
        [x + breite / 2, y],
        [x + breite, y],
        [x + breite, y + hoehe / 2],
        [x + breite, y + hoehe],
        [x + breite / 2, y + hoehe],
        [x, y + hoehe],
        [x, y + hoehe / 2],
        [x, y],
    ];
}

function gebiet(
    publicId: string,
    name: string,
    parent: string | null,
    band: [number | null, number | null],
    sortOrder: number,
    shortName = "",
): Record<string, unknown> {
    return {
        public_id: publicId,
        name,
        short_name: shortName,
        type: "Kaiserreich",
        wiki_type: "Kaiserreich",
        parent_public_id: parent,
        status: "eigenständiger Staat",
        color: "#35b145",
        opacity: 0.7,
        min_zoom: band[0],
        max_zoom: band[1],
        valid_from_bf: 100,
        valid_to_bf: 9999,
        valid_label: "",
        wiki_key: `wiki:${name.toLowerCase().replaceAll(" ", "-")}`,
        wiki_url: null,
        capital_place_public_id: null,
        seat_place_public_id: null,
        sort_order: sortOrder,
        updated_at: "2026-09-18 19:38:14.964",
        coat_of_arms_url: "",
        coat_license_status: "",
        coat_origin: "",
    };
}

function flaeche(n: number, territory: string, coordinates: number[][][]): Record<string, unknown> {
    return {
        public_id: FLAECHE(n),
        territory_public_id: territory,
        geometry: { type: "Polygon", coordinates },
        valid_from_bf: null,
        valid_to_bf: null,
        min_zoom: 0,
        max_zoom: 6,
        updated_at: "2026-09-14 02:21:11.083",
    };
}

function quelle(): LegacyTerritoryPayload {
    return {
        ok: true,
        map_revision: 157006,
        territories_revision: "pt-toll-1",
        territories: [
            gebiet(OSTREICH, "Ostreich", null, [0, 1], 10),
            gebiet(WESTREICH, "Westreich vom Greifenthron", null, [0, 1], 5, "Westreich"),
            gebiet(PROVINZ, "Provinz Ost", OSTREICH, [2, 3], 1),
            // Eine Wurzel, die erst ab Band 3 erscheint: kein souveränes Gebiet nach Legacys Regel (Wehrheim).
            gebiet(SPAET, "Spätes Reich", null, [3, 6], 1),
        ],
        geometries: [
            flaeche(1, WESTREICH, [quadrat(560, 600)]),
            flaeche(2, PROVINZ, [quadrat(600, 600)]),
            flaeche(3, SPAET, [quadrat(700, 600)]),
        ],
        claims: [],
    };
}

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Zollgebiete aus den abgeleiteten Herrschaftsgebieten, gegen PostGIS (WI-0065 U3)", () => {
    let database: Database;

    async function aufraeumen(): Promise<void> {
        const mine = `SELECT id FROM territory WHERE public_id::text LIKE '88888888-%'`;
        await database.unsafe(`DELETE FROM territory_border WHERE territory_id IN (${mine})`);
        await database.unsafe(`DELETE FROM territory_shape WHERE territory_id IN (${mine})`);
        await database.unsafe(`DELETE FROM territory_display_area WHERE territory_id IN (${mine})`);
        await database.unsafe(`DELETE FROM territory_claim WHERE territory_id IN (${mine})`);
        await database.unsafe(`DELETE FROM territory_area WHERE public_id::text LIKE '88888888-%'`);
        await database.unsafe(`UPDATE territory SET parent_id = NULL WHERE public_id::text LIKE '88888888-%'`);
        await database.unsafe(`DELETE FROM territory WHERE public_id::text LIKE '88888888-%'`);
        await database.unsafe(
            `DELETE FROM territory_state WHERE map_domain_id = '${MAP_DOMAIN}' AND source_stamp LIKE 'pt-toll-%'`,
        );
        await database.unsafe(
            `DELETE FROM migration_run WHERE data_domain = 'territories' AND source_ref LIKE 'territories_revision=pt-toll-%' AND NOT EXISTS (SELECT 1 FROM territory WHERE migration_run_id = migration_run.id) AND NOT EXISTS (SELECT 1 FROM territory_area WHERE migration_run_id = migration_run.id) AND NOT EXISTS (SELECT 1 FROM territory_claim WHERE migration_run_id = migration_run.id)`,
        );
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await aufraeumen();
        await importTerritories(database, quelle(), { sourceEtag: 'W/"pol-toll-test"' });
    }, 120_000);

    afterAll(async () => {
        await aufraeumen();
        await database.end({ timeout: 5 });
    });

    it("🔴 ohne Ableitung keine Gebiete, statt alter: leer, ohne Jahr, und der Teil der Revision fehlt", async () => {
        const [state] = await database<{ derived_revision: string | null }[]>`
            SELECT derived_revision FROM territory_state WHERE map_domain_id = ${MAP_DOMAIN}
        `;
        expect(state?.derived_revision).toBeNull();
        expect(await routeTerritories(database, ["MULTILINESTRING((565 620,635 620))"], MAP_DOMAIN)).toBeNull();
        expect(await loadTollTerritories(database, MAP_DOMAIN)).toEqual(NO_TOLL_TERRITORIES);
        expect((await readRoutingRevision(database, MAP_DOMAIN, "modell")).territories).toBeNull();
    });

    describe("nach der Ableitung", () => {
        beforeAll(async () => {
            await deriveTerritories(database, { force: true });
        }, 120_000);

        it("Etappengebiete zählen alle Ebenen einmal, in Fahrtrichtung, ohne bloße Punktkontakte", async () => {
            const result = await routeTerritories(
                database,
                [
                    "MULTILINESTRING((565 620,635 620))",
                    "MULTILINESTRING((635 620,565 620))",
                    "MULTILINESTRING((550 590,560 600))",
                    "MULTILINESTRING((705 620,735 620))",
                    "MULTILINESTRING EMPTY",
                ],
                MAP_DOMAIN,
            );
            expect(result?.[0]?.map((entry) => entry.target?.band)).toEqual([0, 0, 2]);
            expect(result?.[0]?.map((entry) => entry.parentId)).toEqual([null, null, OSTREICH]);
            expect(result?.[0]?.[2]?.target?.parentName).toBe("Ostreich");
            expect(result?.[0]?.[2]?.target?.x).toBeGreaterThanOrEqual(600);
            expect(result?.[0]?.[2]?.target?.x).toBeLessThanOrEqual(640);
            expect(result?.map((stage) => stage.map((entry) => entry.id))).toEqual([
                [WESTREICH, OSTREICH, PROVINZ],
                [OSTREICH, PROVINZ, WESTREICH],
                [],
                [SPAET],
                [],
            ]);
        });

        it("resolves targets once per encountered territory, even across many stages", async () => {
            interface PlanNode {
                "Node Type": string;
                "Subplan Name"?: string;
                "Actual Rows": number;
                "Actual Loops": number;
                Plans?: PlanNode[];
            }
            const plans: PlanNode[] = [];
            const explained = new Proxy(database, {
                async apply(target, thisArg, args) {
                    const strings = args[0] as TemplateStringsArray;
                    if (strings.join("").includes("first_encounter")) {
                        const parts = [...strings];
                        parts[0] = `EXPLAIN (ANALYZE, FORMAT JSON) ${parts[0]}`;
                        const rows = (await Reflect.apply(target, thisArg, [
                            Object.assign(parts, { raw: parts }),
                            ...args.slice(1),
                        ])) as { "QUERY PLAN": { Plan: PlanNode }[] }[];
                        plans.push(rows[0]!["QUERY PLAN"][0]!.Plan);
                    }
                    return Reflect.apply(target, thisArg, args);
                },
            });
            const stages = Array.from({ length: 20 }, () => "MULTILINESTRING((565 620,635 620))");
            const result = await routeTerritories(explained, stages, MAP_DOMAIN);
            expect(result).toHaveLength(20);
            for (const stage of result!) expect(stage).toEqual(result![0]);
            const uniqueIds = new Set(result!.flat().map((entry) => entry.id));
            expect(uniqueIds.size).toBe(3);
            const stagePlan = plans[0]?.Plans?.find((node) => node["Subplan Name"] === "CTE stage");
            expect(stagePlan, "parse each stage once, not once per territory shape").toBeDefined();
            expect(stagePlan!["Actual Loops"]).toBe(1);
            expect(stagePlan!["Actual Rows"]).toBe(stages.length);
            const metadata = plans[0]?.Plans?.find((node) => node["Subplan Name"] === "CTE metadata");
            expect(metadata, "metadata is evaluated before joining it to repeated encounters").toBeDefined();
            expect(metadata!["Actual Loops"]).toBe(1);
            expect(metadata!["Actual Rows"]).toBe(uniqueIds.size);
            const pending = [metadata!];
            const targetLookups: PlanNode[] = [];
            for (let index = 0; index < pending.length; index++) {
                const node = pending[index]!;
                if (node["Node Type"] === "Limit") targetLookups.push(node);
                pending.push(...(node.Plans ?? []));
            }
            expect(targetLookups).toHaveLength(1);
            expect(targetLookups[0]!["Actual Loops"]).toBe(uniqueIds.size);
        });

        it("🔴 die Wurzeln des Bandes 0 in Legacys Reihenfolge (sort_order, name), samt Anzeigejahr", async () => {
            const { territories, yearBf } = await loadTollTerritories(database, MAP_DOMAIN);
            // Nicht dabei: die Provinz (hat einen Elter) und das späte Reich (erscheint in Band 0 nicht, Wehrheim).
            expect(territories.map((territory) => [territory.id, territory.name])).toEqual([
                [WESTREICH, "Westreich vom Greifenthron"],
                [OSTREICH, "Ostreich"],
            ]);
            expect(yearBf).toBe(AVENTURIA_POLITICAL_CARTOGRAPHY.displayYearBf);
        });

        it("der Kurzname (Legacy short_name) kommt mit, für die Liste der Übertritte; ist er leer, gilt der Name", async () => {
            const { territories } = await loadTollTerritories(database, MAP_DOMAIN);
            expect(territories.map((territory) => shortNameOf(territory))).toEqual(["Westreich", "Ostreich"]);
            const count = countBorderCrossings(
                [
                    {
                        geometry: {
                            coordinates: [
                                [562, 620],
                                [638, 620],
                            ],
                        },
                    },
                ],
                territories,
                3,
                { mindestLaufMeilen: 5, abtastschritt: 0.4 },
            );
            expect(count?.crossings[0]?.from).toEqual({
                id: WESTREICH,
                name: "Westreich vom Greifenthron",
                shortName: "Westreich",
            });
            expect(count?.crossings[0]?.to).toEqual({ id: OSTREICH, name: "Ostreich", shortName: "Ostreich" });
        });

        it("die Formen sind für die Zählung bereit: eine Hüllbox je Teilpolygon, im Raum der Karte, Punkt-im-Polygon stimmt", async () => {
            const { territories } = await loadTollTerritories(database, MAP_DOMAIN);
            for (const territory of territories) {
                expect(territory.parts.length).toBeGreaterThan(0);
                for (const part of territory.parts) {
                    expect(part.bbox.every(Number.isFinite)).toBe(true);
                    expect(part.rings[0]?.length).toBeGreaterThanOrEqual(4);
                }
            }
            // Das Westreich liegt bei x 560..600, das Ostreich (die Provinz als seine Fläche) bei 600..640.
            expect(territoryAtPoint(territories, 580, 620)?.id).toBe(WESTREICH);
            expect(territoryAtPoint(territories, 620, 620)?.id).toBe(OSTREICH);
            expect(territoryAtPoint(territories, 720, 620)).toBeNull();
            // Eine Linie quer durch beide zählt eine Landesgrenze zwischen den beiden Reichen.
            const count = countBorderCrossings(
                [
                    {
                        geometry: {
                            coordinates: [
                                [562, 620],
                                [638, 620],
                            ],
                        },
                    },
                ],
                territories,
                3,
                { mindestLaufMeilen: 5, abtastschritt: 0.4 },
            );
            expect(count?.count).toBe(1);
            expect(count?.crossings[0]).toMatchObject({ from: { id: WESTREICH }, to: { id: OSTREICH } });
        });

        it("der Teil der Revision nennt die Ableitung samt Jahr und die Zahl der Wurzeln; ein anderes Jahr ändert ihn", async () => {
            const first = (await readRoutingRevision(database, MAP_DOMAIN, "modell")).territories;
            expect(first).toMatch(/^[0-9a-f]{12}@\d+\|\d+\/.+\|2$/);
            // Wer die Revision zweimal fragt, bekommt dasselbe.
            expect((await readRoutingRevision(database, MAP_DOMAIN, "modell")).territories).toBe(first);
            // Eine Ableitung für ein anderes Anzeigejahr ist eine andere Ableitung.
            await deriveTerritories(database, { displayYearBf: 1060, force: true });
            const other = (await readRoutingRevision(database, MAP_DOMAIN, "modell")).territories;
            expect(other).not.toBe(first);
            expect(other).toContain("@1060");
            expect((await loadTollTerritories(database, MAP_DOMAIN)).yearBf).toBe(1060);
            await deriveTerritories(database, { force: true });
            expect((await readRoutingRevision(database, MAP_DOMAIN, "modell")).territories).toBe(first);
        }, 120_000);

        it("🔴 ein Import entwertet die Ableitung: leer und der Teil fehlt, bis sie neu gelaufen ist", async () => {
            await database`UPDATE territory_state SET derived_revision = NULL WHERE map_domain_id = ${MAP_DOMAIN}`;
            expect(await loadTollTerritories(database, MAP_DOMAIN)).toEqual(NO_TOLL_TERRITORIES);
            expect((await readRoutingRevision(database, MAP_DOMAIN, "modell")).territories).toBeNull();
            await deriveTerritories(database, { force: true });
            expect((await loadTollTerritories(database, MAP_DOMAIN)).territories).toHaveLength(2);
        }, 120_000);
    });
});
