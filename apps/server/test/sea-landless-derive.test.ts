import { AVENTURIA, AVENTURIA_TRAVEL_MODEL, wegfindungVorgaben } from "@avesmaps3d/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import {
    deriveSeaRoutes,
    SEA_ROUTE_ALGORITHM,
    seaRouteFingerprint,
    seegraphwerte,
    type Seegraphwerte,
    type SeaRouteReport,
} from "../src/routing/sea-derive.ts";

/**
 * Ein Seegraph von vor WI-0060 trägt die Häfen ohne Wasser-Zugang nur mit Name und Kennung. Ohne geänderte Quellen rechnet
 * `deriveSeaRoutes` nichts neu; den Grund muss es trotzdem nennen, sonst steht er erst nach der nächsten Kartenänderung im
 * Bericht. Alles in einer Transaktion, die zurückgerollt wird: die Testdatenbank bleibt, wie sie war.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/** Eigene Kennungen (…0060…) und eine eigene Ecke der Karte. */
const ID = {
    meer: "00000000-0000-4000-8000-0000000060a1",
    hafen: "00000000-0000-4000-8000-0000000060b1",
};

describeWithDatabase("Seegraph unverändert: Gründe der Häfen ohne Wasser-Zugang (WI-0060)", () => {
    let database: Database;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
    });

    afterAll(async () => {
        await database.end({ timeout: 5 });
    });

    /**
     * Ein Meer, ein Hafen fünf Einheiten davor und ein älterer Graph mit passendem Fingerabdruck (gerechnet mit `werte`), dann
     * `deriveSeaRoutes` mit denselben Werten. Alles zurückgerollt.
     */
    async function laufMitAltemGraphen(
        werte?: Seegraphwerte,
    ): Promise<{ report?: SeaRouteReport; stored?: SeaRouteReport | undefined }> {
        const seen: { report?: SeaRouteReport; stored?: SeaRouteReport | undefined } = {};
        await database
            .begin(async (transaction) => {
                const [region] = await transaction<{ id: string }[]>`
                    INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active)
                    VALUES (${ID.meer}, ${AVENTURIA.mapDomain}, 'WI-0060 Testmeer', 'topographie', 'meer', true)
                    RETURNING id::text
                `;
                await transaction`
                    INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active)
                    VALUES (gen_random_uuid(), ${AVENTURIA.mapDomain}, ${Number(region?.id)},
                            ST_GeomFromText('POLYGON((1000 1000,1010 1000,1010 1010,1000 1010,1000 1000))'), true)
                `;
                // Fünf Einheiten vor dem Meer: weiter als die drei der Regel H1.
                await transaction`
                    INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active, is_seaport)
                    VALUES (${ID.hafen}, ${AVENTURIA.mapDomain}, 'WI-0060 Hafen', 'dorf',
                            ST_SetSRID(ST_MakePoint(1015, 1005), 0), 'test', true, true)
                `;
                const fingerprint = await seaRouteFingerprint(
                    transaction,
                    AVENTURIA.mapDomain,
                    AVENTURIA_TRAVEL_MODEL,
                    werte,
                );
                const older = {
                    written: true,
                    fingerprint,
                    ports: 0,
                    withoutLanding: [{ id: ID.hafen, name: "WI-0060 Hafen" }],
                    closures: [],
                    nodes: 0,
                    edges: 0,
                    bridges: 0,
                    bytes: 0,
                    ms: { graph: 0, weights: 0, pairs: 0, total: 0 },
                };
                await transaction`
                    INSERT INTO sea_route_graph (map_domain_id, algorithm_version, source_fingerprint, graph, stats)
                    VALUES (${AVENTURIA.mapDomain}, ${SEA_ROUTE_ALGORITHM}, ${fingerprint}, ${Buffer.from([1])}, ${transaction.json(older)})
                    ON CONFLICT (map_domain_id) DO UPDATE SET
                        algorithm_version = EXCLUDED.algorithm_version,
                        source_fingerprint = EXCLUDED.source_fingerprint,
                        graph = EXCLUDED.graph,
                        stats = EXCLUDED.stats
                `;
                seen.report = await deriveSeaRoutes(transaction, AVENTURIA.mapDomain, AVENTURIA_TRAVEL_MODEL, {
                    ...(werte === undefined ? {} : { werte }),
                });
                const [row] = await transaction<{ stats: SeaRouteReport }[]>`
                    SELECT stats FROM sea_route_graph WHERE map_domain_id = ${AVENTURIA.mapDomain}
                `;
                seen.stored = row?.stats;
                throw new Error("zurückrollen");
            })
            .catch((error: unknown) => {
                if (!(error instanceof Error) || error.message !== "zurückrollen") throw error;
            });
        return seen;
    }

    it("rechnet einem älteren Graphen den Grund nach, ohne etwas zu schreiben", async () => {
        const seen = await laufMitAltemGraphen();
        expect(seen.report?.written).toBe(false);
        const port = seen.report?.withoutLanding.find((entry) => entry.id === ID.hafen);
        expect(port).toMatchObject({ name: "WI-0060 Hafen", reason: "wasser_fern" });
        expect(port?.distance).toBeCloseTo(5);
        // Geschrieben wird nichts: die gespeicherte Zeile trägt weiter keinen Grund.
        expect(seen.stored?.withoutLanding).toEqual([{ id: ID.hafen, name: "WI-0060 Hafen" }]);
    });

    it("🔴 rechnet mit den Werten der Systemsteuerung, nicht mit Konstanten (WI-0153 Schnitt 7a)", async () => {
        // Mit sechs Einheiten Reichweite erreicht der Hafen das Meer fünf Einheiten vor ihm: Er hat eine Anlegestelle.
        const weit = { ...seegraphwerte(wegfindungVorgaben()), landingReach: 6 };
        const seen = await laufMitAltemGraphen(weit);
        expect(seen.report?.written).toBe(false);
        expect(seen.report?.withoutLanding.find((entry) => entry.id === ID.hafen)).toBeUndefined();
    });

    it("🔴 nur abweichende Werte ändern den Fingerabdruck: ein vorhandener Graph bleibt mit den Vorgaben gültig", async () => {
        const vorgaben = seegraphwerte(wegfindungVorgaben());
        const abdruck = (werte?: Seegraphwerte): Promise<string> =>
            seaRouteFingerprint(database, AVENTURIA.mapDomain, AVENTURIA_TRAVEL_MODEL, werte);
        expect(await abdruck(vorgaben)).toBe(await abdruck());
        expect(await abdruck({ ...vorgaben, landingReach: 4 })).not.toBe(await abdruck(vorgaben));
        expect(await abdruck({ ...vorgaben, seaCellUnits: 0.4 })).not.toBe(
            await abdruck({ ...vorgaben, landingReach: 4 }),
        );
    });
});
