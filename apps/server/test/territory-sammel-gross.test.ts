import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { TERRITORY_SAMMEL_MAX, TerritorySammelRetireBody, TerritorySammelStandBody } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { readTerritorySammelStand } from "../src/editor/territories.ts";
import { restoreTerritory, retireTerritories } from "../src/editor/territory-retire.ts";
import type { LegacyTerritoryPayload } from "../src/migration/territories.ts";
import { importTerritories } from "../src/migration/territory-import.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * „Entfernen für alle“ mit vielen Gebieten (Betreiber 2026-10-20: „wenn ich bei der mehrfach auswahl von herrschaftsgebieten alle entfernen
 * will, kommt Die gewählten Gebiete konnten nicht gelesen werden.“; die Stage hat 1685 Gebiete, 636 davon Platzhalter). Wegwerf-Cluster
 * mit Migrations-, App- und Jobs-Rolle, geschrieben als App-Rolle. 🔴 Kein Test schreibt in `avesmaps3d_dev` oder die geteilte Testdatenbank.
 *
 * Problemfälle: Lesen oder Entfernen scheitert über 512 Gebieten; Entfernen schreibt mehr als EINE Operation; ↺ holt nicht alle zurück; die
 * Grenze trägt nicht alle Gebiete der Stage; Zeit oder Speicher einer Operation über alle laufen aus dem Ruder.
 */

const ENV = "sammelgross";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const ID = (n: number): string => `e3e3e3e3-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const REICH = ID(1);
/** Wie auf der Stage: Platzhalter unter einem Reich, je mit einer kleinen eigenen Fläche (aus „Neue Fläche“). */
const ANZAHL = 1700;
const PLATZHALTER = Array.from({ length: ANZAHL }, (_, i) => ID(0x1000 + i));

function gebiet(id: string, name: string, eltern: string | null): Record<string, unknown> {
    return {
        public_id: id,
        name,
        short_name: "",
        type: "Baronie",
        wiki_type: "Baronie",
        parent_public_id: eltern,
        status: "",
        color: "#b2b065",
        opacity: 0.7,
        min_zoom: 4,
        max_zoom: 5,
        valid_from_bf: 100,
        valid_to_bf: 9999,
        valid_label: "",
        wiki_key: `wiki:${name}`,
        wiki_url: null,
        capital_place_public_id: null,
        seat_place_public_id: null,
        sort_order: 0,
        updated_at: "2026-10-20 01:00:00",
        coat_of_arms_url: "",
        coat_license_status: "",
        coat_origin: "",
    };
}

/** Ein kleines Quadrat je Platzhalter in einem Raster, ohne Überlappung. */
function flaeche(i: number): Record<string, unknown> {
    const x = 100 + (i % 50) * 6;
    const y = 100 + Math.floor(i / 50) * 6;
    return {
        public_id: ID(0x400000 + i),
        territory_public_id: PLATZHALTER[i]!,
        geometry: {
            type: "Polygon",
            coordinates: [
                [
                    [x, y],
                    [x + 5, y],
                    [x + 5, y + 5],
                    [x, y + 5],
                    [x, y],
                ],
            ],
        },
        valid_from_bf: null,
        valid_to_bf: null,
        min_zoom: 4,
        max_zoom: 5,
        updated_at: "2026-10-20 01:00:00",
    };
}

function quelle(): LegacyTerritoryPayload {
    return {
        ok: true,
        map_revision: 1,
        territories_revision: "pt-fixture-sammel-gross",
        territories: [
            gebiet(REICH, "Reich", null),
            ...PLATZHALTER.map((id, i) => gebiet(id, `Neues Herrschaftsgebiet (${String(i + 2)})`, REICH)),
        ],
        geometries: PLATZHALTER.map((_, i) => flaeche(i)),
        claims: [],
    } as unknown as LegacyTerritoryPayload;
}

describeWithCluster("„Entfernen für alle“ mit vielen Gebieten (Wegwerf-Cluster)", { timeout: 600_000 }, () => {
    let cluster: VpsCluster | undefined;
    let importer: Database | undefined;
    const thomas: MapActor = { kind: "person", personId: randomUUID(), environment: "test" };

    const aktive = async (ids: readonly string[]): Promise<number> =>
        Number(
            (
                await cluster!.admin<{ n: string }[]>`
                    SELECT count(*)::text AS n FROM territory WHERE is_active AND public_id = ANY(${[...ids]}::uuid[])
                `
            )[0]!.n,
        );
    const operationen = async (): Promise<number> =>
        Number((await cluster!.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation`)[0]!.n);
    /** Lesen und Entfernen wie die Oberfläche: erst der Stand, dann EINE Operation gegen seine Revisionen. */
    const entfernen = async (
        ids: readonly string[],
    ): Promise<{ op: string; ms: number; mb: number; ableitungen: number }> => {
        const stand = await readTerritorySammelStand(cluster!.app, ids);
        expect(stand.territories).toHaveLength(ids.length);
        const body = {
            operationId: randomUUID(),
            territories: stand.territories.map((g) => ({ id: g.id, baseRevision: g.revision })),
            stage: "retire" as const,
        };
        expect(Value.Check(TerritorySammelRetireBody, body)).toBe(true);
        const vorher = process.memoryUsage().heapUsed;
        const anfang = performance.now();
        const quittung = await retireTerritories(cluster!.app, thomas, body);
        const ms = Math.round(performance.now() - anfang);
        const mb = Math.round((process.memoryUsage().heapUsed - vorher) / 1e6);
        const ableitungen = quittung.derivedWork.filter((arbeit) => arbeit.kind === "territory_derive").length;
        return { op: body.operationId, ms, mb, ableitungen };
    };

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
        const o = cluster.migrator.options as unknown as {
            host: string[];
            port: number[];
            user: string;
            database: string;
        };
        importer = createDatabase(`postgres://${o.user}@${o.host[0]!}:${String(o.port[0])}/${o.database}`, { max: 3 });
        await importTerritories(importer, quelle());
    }, 600_000);

    afterAll(async () => {
        await importer?.end({ timeout: 5 });
        await cluster?.stop();
    }, 60_000);

    it("🔴 die Grenze trägt alle Gebiete der Stage (1685) mit Luft; darüber weist das Schema ab", () => {
        expect(TERRITORY_SAMMEL_MAX).toBeGreaterThanOrEqual(2 * 1685);
        const ids = (n: number) => Array.from({ length: n }, (_, i) => ID(0x100000 + i));
        expect(Value.Check(TerritorySammelStandBody, { ids: ids(TERRITORY_SAMMEL_MAX) })).toBe(true);
        expect(Value.Check(TerritorySammelStandBody, { ids: ids(TERRITORY_SAMMEL_MAX + 1) })).toBe(false);
    });

    it("🔴 513 Gebiete: lesen und entfernen als EINE Operation mit EINEM Ableitungsauftrag; ↺ holt alle zurück", async () => {
        const ids = PLATZHALTER.slice(0, 513);
        const ops = await operationen();
        const { op, ableitungen } = await entfernen(ids);
        expect(await aktive(ids)).toBe(0);
        expect(await operationen()).toBe(ops + 1);
        expect(ableitungen).toBeLessThanOrEqual(1);
        await restoreTerritory(cluster!.app, thomas, ids[0]!, { operationId: randomUUID(), reverts: op });
        expect(await aktive(ids)).toBe(513);
    });

    it("🔴 700 Gebiete: lesen und entfernen, ↺ holt alle zurück; Zeit und Speicher bleiben im Rahmen", async () => {
        const ids = PLATZHALTER.slice(0, 700);
        const { op, ms, mb } = await entfernen(ids);
        console.warn(`Entfernen für alle, 700 Gebiete: ${String(ms)} ms, Halde ${String(mb)} MB`);
        expect(await aktive(ids)).toBe(0);
        expect(ms).toBeLessThan(60_000);
        await restoreTerritory(cluster!.app, thomas, ids[0]!, { operationId: randomUUID(), reverts: op });
        expect(await aktive(ids)).toBe(700);
    });

    it("🔴 alle 1700 auf einmal, wie die Stage: eine Operation, die Zeit gemessen", async () => {
        const { op, ms, mb } = await entfernen(PLATZHALTER);
        console.warn(`Entfernen für alle, ${String(ANZAHL)} Gebiete: ${String(ms)} ms, Halde ${String(mb)} MB`);
        expect(await aktive(PLATZHALTER)).toBe(0);
        expect(ms).toBeLessThan(120_000);
        await restoreTerritory(cluster!.app, thomas, PLATZHALTER[0]!, { operationId: randomUUID(), reverts: op });
        expect(await aktive(PLATZHALTER)).toBe(ANZAHL);
    });
});
