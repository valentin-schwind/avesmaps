import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OperationReceipt } from "@avesmaps3d/shared";
import {
    GELAENDE_LOKAL_HOECHSTENS_S,
    GELAENDE_LOKAL_RUHE_S,
    gelaendeNachOperation,
} from "../src/editor/gelaende-folgen.ts";
import { istRegional } from "../src/terrain/hoehenmodell.ts";
import { AVENTURIA_TERRAIN_RECIPE } from "../src/terrain/domain/recipes.ts";
import { areaIndex, INPUT_INDEX_VERSION, peakIndex, riverIndex } from "../src/terrain/domain/input-index.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Das Gelände im Umkreis als Folge der Schreibnaht (WI-0223 Schritt 1; Betreiber 2026-10-18 „Geländerechnung: A“; Migration 0169), so
 * wie auf dem VPS: Wegwerf-Cluster mit Migrations-, App- und Jobs-Rolle. 🔴 Map Mutation Guard: Gebirge, Gipfel und Flüsse ändert
 * hier nur dieser Wegwerf-Cluster, nie `avesmaps3d_dev` oder die geteilte Testdatenbank.
 *
 * Problemfälle: Eine Änderung, die ins Gelände eingeht, reiht nichts ein, oder außerhalb der Transaktion; eine Beschriftung reiht etwas
 * ein; jede Speicherung bekommt einen eigenen Lauf; der Bereich der zweiten Speicherung fehlt im wartenden Lauf; die Kette fehlt oder
 * hängt falsch; unter Fassung 17 wird lokal gerechnet; die App-Rolle darf die Funktion nicht rufen.
 */

const ENV = "gellok";
const DOMAIN = "aventuria";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const ID = (n: number): string => `77777791-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const GEBIRGE = ID(1);
const FLAECHE = ID(0x101);
const WALD = ID(2);
const WALDFLAECHE = ID(0x102);
const GIPFEL = ID(0x201);
const FLUSS = ID(0x301);

interface Auftrag {
    id: string;
    public_id: string;
    kind: string;
    state: string;
    scope_kind: string;
    scope_tiles: number[];
    coalesced_count: number;
    wartet_s: number;
    vorher: string[];
}

describeWithCluster(
    "Gelände im Umkreis als Folge der Schreibnaht (WI-0223, Wegwerf-Cluster)",
    { timeout: 300_000 },
    () => {
        let cluster: VpsCluster | undefined;

        const auftraege = async (): Promise<Auftrag[]> =>
            cluster!.admin<Auftrag[]>`
            SELECT j.id::text, j.public_id::text, j.kind, j.state, j.scope_kind, j.scope_tiles::int[] AS scope_tiles,
                   j.coalesced_count, round(extract(epoch FROM (j.not_before - j.queued_at)))::int AS wartet_s,
                   coalesce(array_agg(p.kind ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL), '{}') AS vorher
              FROM job j
              LEFT JOIN job_dependency d ON d.job_id = j.id
              LEFT JOIN job p ON p.id = d.depends_on_id
             WHERE j.kind IN ('terrain_local', 'dem_publish', 'routing_reload', 'display_heights')
             GROUP BY j.id ORDER BY j.id
        `;
        /** Eine Operation als App-Rolle: erst die Änderung (`aendern`), dann der Haken, in EINER Transaktion. */
        const speichere = (
            affected: OperationReceipt["affected"],
            aendern: (tx: VpsCluster["app"]) => Promise<unknown> = async () => undefined,
        ) =>
            cluster!.app.begin(async (tx) => {
                await aendern(tx as unknown as VpsCluster["app"]);
                return gelaendeNachOperation(tx, "test:wi0223", DOMAIN, affected);
            });

        beforeAll(async () => {
            cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
            const m = cluster.migrator;
            const region = async (id: string, name: string, layer: string, type: string) =>
                (
                    await m<{ id: string }[]>`
                    INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active)
                    VALUES (${id}, ${DOMAIN}, ${name}, ${layer}, ${type}, true) RETURNING id::text
                `
                )[0]!.id;
            const flaeche = async (id: string, regionId: string, wkt: string) =>
                m`
                INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active)
                VALUES (${id}, ${DOMAIN}, ${Number(regionId)}, ST_GeomFromText(${wkt}), true)
            `;
            await flaeche(
                FLAECHE,
                await region(GEBIRGE, "0223 Testgebirge", "topographie", "gebirge"),
                "POLYGON((200 200,260 200,260 260,200 260,200 200))",
            );
            await flaeche(
                WALDFLAECHE,
                await region(WALD, "0223 Testwald", "vegetation", "wald"),
                "POLYGON((600 600,640 600,640 640,600 640,600 600))",
            );
            await m`
            INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, geom, height_schritt, is_active)
            VALUES (${GIPFEL}, ${DOMAIN}, '0223 Testgipfel', 'berggipfel', ST_SetSRID(ST_MakePoint(230, 230), 0), 2500, true)
        `;
            await m`
            INSERT INTO path (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${FLUSS}, ${DOMAIN}, '0223 Testfluss', 'Flussweg',
                    ST_SetSRID(ST_GeomFromText('LINESTRING(300 300,400 380)'), 0), 'test', true)
        `;
            // Der geltende Master: ein Platzhalter mit dem Index der heutigen Eingaben (wie ihn `loadDomainInputIndex` schriebe).
            const objects = {
                ...(await areaIndex(m, DOMAIN)),
                ...(await peakIndex(m, DOMAIN)),
                ...(await riverIndex(m, DOMAIN)),
                [`mountain:${FLAECHE}`]: ["saat0223aaaa", 200, 200, 260, 260],
            };
            await m`
            INSERT INTO terrain_domain_raster (map_domain_id, fingerprint, input_fingerprint, generator_version, size, samples, report, input_index)
            VALUES (${DOMAIN}, 'master-0223', 'eingaben-0223', '19', 4096, decode(repeat('0000', 4096 * 4096), 'hex'), '{}',
                    ${m.json({ v: INPUT_INDEX_VERSION, objects })})
        `;
            await m`
            INSERT INTO terrain_dem (revision, map_domain_id, fingerprint, tile_size, max_zoom, encoding, tiles, bytes, is_current, domain_fingerprint)
            VALUES ('a0223a000001', ${DOMAIN}, 'test', 512, 3, 'mapbox', 1, 1, true, 'master-0223')
        `;
        }, 300_000);

        beforeEach(async () => {
            await cluster!.admin`DELETE FROM job_event`;
            await cluster!.admin`DELETE FROM job`;
            await cluster!.admin`DELETE FROM terrain_recipe_choice`;
        });

        afterAll(async () => {
            await cluster?.stop();
        }, 60_000);

        it("die Vorgabe der Datei ist eine Fassung mit regionaler Rückverteilung (sonst prüfte dieser Test nichts)", () => {
            expect(istRegional(AVENTURIA_TERRAIN_RECIPE)).toBe(true);
        });

        it("🔴 ohne geänderten Eintrag reiht nichts ein: dieselbe Fläche, ein umbenanntes Gebirge, ein fremdes Objekt", async () => {
            expect(await speichere([{ kind: "area", id: FLAECHE }])).toEqual([]);
            expect(
                await speichere(
                    [{ kind: "landscape", id: GEBIRGE }],
                    (tx) => tx`UPDATE region SET name = '0223 Umbenannt' WHERE public_id = ${GEBIRGE}`,
                ),
            ).toEqual([]);
            expect(await speichere([{ kind: "place", id: randomUUID() }])).toEqual([]);
            expect(await auftraege()).toEqual([]);
        });

        it("🔴 eine verschobene Gebirgsfläche reiht in ihrer Transaktion die Kette ein: lokal, veröffentlichen, Routing und Höhenlinien", async () => {
            const arbeit = await speichere(
                [{ kind: "area", id: FLAECHE }],
                (tx) => tx`UPDATE region_area SET geom = ST_Translate(geom, 5, 0) WHERE public_id = ${FLAECHE}`,
            );
            expect(arbeit).toEqual([
                { kind: "terrain_local", jobId: expect.any(String), state: "queued" },
                { kind: "dem_publish", jobId: expect.any(String), state: "queued" },
            ]);
            const kette = await auftraege();
            expect(kette.map((a) => [a.kind, a.state, a.vorher])).toEqual([
                ["terrain_local", "QUEUED", []],
                ["dem_publish", "QUEUED", ["terrain_local"]],
                ["routing_reload", "QUEUED", ["dem_publish"]],
                ["display_heights", "QUEUED", ["dem_publish"]],
            ]);
            expect(kette[0]).toMatchObject({
                public_id: arbeit[0]!.jobId,
                scope_kind: "tiles",
                wartet_s: GELAENDE_LOKAL_RUHE_S,
            });
            expect(kette[0]!.scope_tiles.length).toBeGreaterThan(0);
            expect(kette[1]!.scope_tiles).toEqual(kette[0]!.scope_tiles);
            // Die Quittung nennt den Lauf und seine Veröffentlichung: Endet die, ist das Gelände im Umkreis fertig.
            expect(kette[1]!.public_id).toBe(arbeit[1]!.jobId);
            // Ein Fehlschlag der Operation nimmt den Auftrag mit (dieselbe Transaktion).
            await cluster!.admin`DELETE FROM job`;
            await expect(
                cluster!.app.begin(async (tx) => {
                    await tx`UPDATE region_area SET geom = ST_Translate(geom, 5, 0) WHERE public_id = ${FLAECHE}`;
                    await gelaendeNachOperation(tx, "test:wi0223", DOMAIN, [{ kind: "area", id: FLAECHE }]);
                    throw new Error("Fachoperation scheitert");
                }),
            ).rejects.toThrow("Fachoperation scheitert");
            expect(await auftraege()).toEqual([]);
        });

        it("🔴 weitere Speicherungen fahren mit dem wartenden Lauf, sein Bereich wächst um den neuen", async () => {
            const erste = await speichere(
                [{ kind: GIPFEL_KIND, id: GIPFEL }],
                (tx) => tx`UPDATE terrain_peak SET height_schritt = 2600 WHERE public_id = ${GIPFEL}`,
            );
            const vorher = (await auftraege())[0]!;
            const zweite = await speichere(
                [{ kind: "area", id: WALDFLAECHE }],
                (tx) => tx`UPDATE region_area SET geom = ST_Translate(geom, 0, 5) WHERE public_id = ${WALDFLAECHE}`,
            );
            const dritte = await speichere(
                [{ kind: "path", id: FLUSS }],
                (tx) => tx`UPDATE path SET geom = ST_Translate(geom, 3, 3) WHERE public_id = ${FLUSS}`,
            );
            expect(zweite).toEqual(erste);
            expect(dritte).toEqual(erste);
            const nachher = await auftraege();
            expect(nachher.filter((a) => a.kind === "terrain_local")).toHaveLength(1);
            expect(nachher[0]!.coalesced_count).toBe(2);
            expect(nachher[0]!.scope_tiles.length).toBeGreaterThan(vorher.scope_tiles.length);
            for (const kachel of vorher.scope_tiles) expect(nachher[0]!.scope_tiles).toContain(kachel);
            expect(nachher[1]!.scope_tiles).toEqual(nachher[0]!.scope_tiles);
        });

        it("🔴 warten, bis Ruhe ist: jede Speicherung schiebt den Start auf Ruhe ab jetzt, höchstens bis zur Obergrenze ab der ersten", async () => {
            await speichere(
                [{ kind: GIPFEL_KIND, id: GIPFEL }],
                (tx) => tx`UPDATE terrain_peak SET height_schritt = 2610 WHERE public_id = ${GIPFEL}`,
            );
            // Die erste Speicherung liegt zehn Minuten zurück: Die nächste schiebt den Start auf jetzt + Ruhe.
            await cluster!
                .admin`UPDATE job SET queued_at = now() - interval '10 minutes', not_before = now() - interval '7 minutes'
                                  WHERE kind = 'terrain_local'`;
            await speichere(
                [{ kind: "area", id: WALDFLAECHE }],
                (tx) => tx`UPDATE region_area SET geom = ST_Translate(geom, 0, 4) WHERE public_id = ${WALDFLAECHE}`,
            );
            const [geschoben] = await cluster!.admin<{ ab_jetzt: number }[]>`
                SELECT round(extract(epoch FROM (not_before - now())))::int AS ab_jetzt FROM job WHERE kind = 'terrain_local'
            `;
            expect(geschoben!.ab_jetzt).toBeGreaterThan(GELAENDE_LOKAL_RUHE_S - 5);
            expect(geschoben!.ab_jetzt).toBeLessThanOrEqual(GELAENDE_LOKAL_RUHE_S);
            // Liegt die erste Speicherung schon fast an der Obergrenze, gilt die Obergrenze, nicht die Ruhe.
            await cluster!
                .admin`UPDATE job SET queued_at = now() - make_interval(secs => ${GELAENDE_LOKAL_HOECHSTENS_S - 60})
                                  WHERE kind = 'terrain_local'`;
            await speichere(
                [{ kind: "path", id: FLUSS }],
                (tx) => tx`UPDATE path SET geom = ST_Translate(geom, 2, 2) WHERE public_id = ${FLUSS}`,
            );
            const [gedeckelt] = await cluster!.admin<{ ab_jetzt: number }[]>`
                SELECT round(extract(epoch FROM (not_before - now())))::int AS ab_jetzt FROM job WHERE kind = 'terrain_local'
            `;
            expect(gedeckelt!.ab_jetzt).toBeGreaterThan(50);
            expect(gedeckelt!.ab_jetzt).toBeLessThanOrEqual(60);
        });

        it("🔴 Gebirgswerte zählen immer; unter Fassung 17 rechnet nichts lokal", async () => {
            expect(await speichere([{ kind: "terrain_control", id: FLAECHE }])).toHaveLength(2);
            await cluster!.admin`DELETE FROM job`;
            await cluster!.migrator`INSERT INTO terrain_recipe_choice (map_domain_id, version) VALUES (${DOMAIN}, 17)`;
            expect(await speichere([{ kind: "terrain_control", id: FLAECHE }])).toEqual([]);
            expect(await auftraege()).toEqual([]);
        });
    },
);

const GIPFEL_KIND = "peak";
