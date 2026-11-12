import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";

/**
 * Die Kachelfunktionen über den Index (WI-0283 K2/K3, Migration 0315): Sie filtern in Kartenkoordinaten und rechnen nur die Treffer um. Der Vertrag ist
 * eng: Es kommen dieselben Bytes heraus wie aus den alten Sichten, die weiter bestehen.
 *
 * Problemfälle: Eine Fläche ohne frische Glättung (Rückfallzweig) fehlt, weil ihr Filter in anderen Koordinaten läuft; ein Weg ohne gezeichnete Kurve fehlt;
 * eine Kachel am Rand eines Objekts verliert es, weil der Rahmen in Kartenkoordinaten zu eng ist; ein stillgelegtes Objekt rutscht durch; die Filter
 * greifen den Index nicht, und alles bleibt langsam.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const QUELLE = "kachel-index-test";
const KACHELN: readonly (readonly [number, number, number])[] = [
    [0, 0, 0],
    [2, 1, 1],
    [2, 2, 2],
    [3, 3, 3],
    [3, 4, 4],
    [5, 16, 16],
    [5, 15, 15],
    [6, 32, 32],
    [8, 128, 128],
];
const LEER = "d41d8cd98f00b204e9800998ecf8427e";

describeWithDatabase("Kacheln über den Index (Migration 0315)", () => {
    let database: Database;

    const aufraeumen = async (): Promise<void> => {
        await database`DELETE FROM path_label_run WHERE source_fingerprint = ${QUELLE}`;
        await database`DELETE FROM path WHERE source_system = ${QUELLE}`;
        await database`DELETE FROM place WHERE source_system = ${QUELLE}`;
        await database`
            DELETE FROM region_area WHERE region_id IN (SELECT id FROM region WHERE name LIKE 'Kachelindex %')
        `;
        await database`DELETE FROM region WHERE name LIKE 'Kachelindex %'`;
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await seedMapDomains(database);
        await aufraeumen();
        // Rund um die Mitte der Karte, auch über die Kachelgrenzen hinweg, und eines stillgelegt.
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            SELECT gen_random_uuid(), 'aventuria', 'Kachelindex ' || i, 'dorf', ST_SetSRID(ST_MakePoint(480 + i, 480 + i), 0), ${QUELLE}, i <> 7
            FROM generate_series(1, 60) AS i
        `;
        const wege = await database<{ id: string; n: number }[]>`
            INSERT INTO path (public_id, map_domain_id, name, subtype, is_bach, geom, source_system, is_active)
            SELECT gen_random_uuid(), 'aventuria', 'Kachelindex ' || i, 'Pfad', false,
                   ST_SetSRID(ST_MakeLine(ST_MakePoint(470 + i, 500), ST_MakePoint(530 + i, 530)), 0), ${QUELLE}, true
            FROM generate_series(1, 6) AS i
            RETURNING id::text, 0 AS n
        `;
        // Ein Teil mit gezeichneter Kurve, abseits der rohen Linie; der Rest fällt auf die rohe Linie zurück.
        for (const weg of wege.slice(0, 3)) {
            await database`
                INSERT INTO path_visual (path_id, geom, source_fingerprint, algorithm_version)
                SELECT id, ST_SetSRID(ST_MakeLine(ST_MakePoint(ST_X(ST_StartPoint(geom)), 460), ST_EndPoint(geom)), 0), 'test', 'test'
                FROM path WHERE id = ${weg.id}::bigint
            `;
        }
        // Wegnamen (0318): Läufe über die Kachelgrenzen, einer außerhalb seines Zoombands, einer mit Kennzeichen seiner Kette. Der Zickzack ist lang bei kleinem
        // Kasten: Seine Mitte zählt, sein Kasten berührt die Kachel 8/128/128 nicht. Ein Filter auf den Kasten verlöre ihn.
        await database`
            INSERT INTO path_label_run (name, subtype, map_domain_id, part, instance, instance_count, run_min_zoom, run_max_zoom, name_width_px, geom, source_fingerprint, algorithm_version, is_bach)
            SELECT 'Kachelindex ' || i, 'Pfad', 'aventuria', 0, 0, 1, 0, CASE WHEN i = 5 THEN 1 ELSE 8 END, 40 + i,
                   ST_SetSRID(ST_MakeLine(ST_MakePoint(470 + 8 * i, 500 + i), ST_MakePoint(490 + 9 * i, 505 + i)), 0), ${QUELLE}, 'test', i % 2 = 0
            FROM generate_series(1, 12) AS i
        `;
        await database`
            INSERT INTO path_label_run (name, subtype, map_domain_id, part, instance, instance_count, run_min_zoom, run_max_zoom, name_width_px, geom, source_fingerprint, algorithm_version)
            VALUES ('Kachelindex Zickzack', 'Pfad', 'aventuria', 0, 0, 1, 0, 8, 60,
                    ST_GeomFromText('LINESTRING(519 505, 523 515, 519 505, 523 515)', 0), ${QUELLE}, 'test')
        `;
        await database`UPDATE path SET mark = 'karawanenroute' WHERE source_system = ${QUELLE} AND name = 'Kachelindex 2'`;
        const [wald] = await database<{ id: string }[]>`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active)
            VALUES (gen_random_uuid(), 'aventuria', 'Kachelindex Wald', 'vegetation', 'wald', true) RETURNING id::text
        `;
        const [see] = await database<{ id: string }[]>`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active)
            VALUES (gen_random_uuid(), 'aventuria', 'Kachelindex See', 'topographie', 'see', true) RETURNING id::text
        `;
        // Eine Fläche gerundet, zwei im Rückfallzweig: Wald und See ohne frische Glättung.
        const flaeche = async (region: string, wkt: string): Promise<string> => {
            const [zeile] = await database<{ id: string }[]>`
                INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active)
                VALUES (gen_random_uuid(), 'aventuria', ${region}::bigint, ST_GeomFromText(${wkt}), true) RETURNING id::text
            `;
            return zeile!.id;
        };
        const gerundet = await flaeche(wald!.id, "POLYGON((490 490, 540 490, 540 540, 490 540, 490 490))");
        await flaeche(wald!.id, "POLYGON((400 400, 470 400, 470 470, 400 470, 400 400))");
        await flaeche(see!.id, "POLYGON((520 440, 560 440, 560 480, 520 480, 520 440))");
        await database`
            INSERT INTO region_area_smooth (region_area_id, geom, render_geom, source_updated_at, recipe, status)
            SELECT a.id, a.geom, map_domain_to_render(a.map_domain_id, a.geom)::geometry(Geometry, 3857), a.updated_at, 'test', 'smoothed'
            FROM region_area a WHERE a.id = ${gerundet}::bigint
        `;
    });

    afterAll(async () => {
        await aufraeumen();
        await database.end({ timeout: 5 });
    });

    /** Die Kachel wie bisher: aus der alten Sicht, wie Martin oder die Kachelfunktion vor 0315 sie las. */
    const ausSicht = async (
        sicht: string,
        schicht: string,
        spalten: string,
        vereinfacht: boolean,
        [z, x, y]: readonly [number, number, number],
    ): Promise<string> => {
        const toleranz = vereinfacht && z < 8 ? `(40075016.685578488 / 2 ^ ${String(z)} / 2048.0)` : "0";
        const form = vereinfacht ? `ST_Simplify(v.geom, ${toleranz})` : "v.geom";
        const [zeile] = await database.unsafe<{ h: string | null }[]>(
            `SELECT md5(ST_AsMVT(q, '${schicht}', 4096, 'geom')) AS h FROM (
                 SELECT ${spalten}, ST_AsMVTGeom(${form}, ST_TileEnvelope($1, $2, $3), 4096, 64, true) AS geom
                 FROM ${sicht} v
                 WHERE v.geom && ST_TileEnvelope($1, $2, $3, margin => (64.0 / 4096))
                 ORDER BY v.public_id
             ) q WHERE q.geom IS NOT NULL`,
            [z, x, y],
        );
        return zeile?.h ?? LEER;
    };
    const ausFunktion = async (name: string, [z, x, y]: readonly [number, number, number]): Promise<string> => {
        const [zeile] = await database.unsafe<{ h: string }[]>(`SELECT md5(${name}($1, $2, $3, '{}'::json)) AS h`, [
            z,
            x,
            y,
        ]);
        return zeile!.h;
    };

    it.each([
        {
            name: "place_tile",
            sicht: "place_render",
            schicht: "place_render",
            spalten:
                "v.public_id, v.name, v.subtype, v.is_hidden, v.label_min_zoom_override, v.label_max_zoom_override, v.label_visible_override, v.label_size_override, v.collision_rank, v.is_ruined, v.is_nodix, v.capital_bands, v.is_approximate, v.is_unofficial",
            vereinfacht: false,
        },
        {
            name: "path_tile",
            sicht: "path_render",
            schicht: "path_render",
            spalten:
                "v.public_id, v.name, v.subtype, v.label_visible, v.is_bach, v.collision_rank, v.flow_direction, v.is_tunnel, v.mark",
            vereinfacht: true,
        },
        {
            name: "region_area_tile",
            sicht: "region_area_render",
            schicht: "region_area_render",
            spalten:
                "v.public_id, v.region_public_id, v.name, v.region_layer, v.region_type, v.stack_order, v.is_locked, v.area",
            vereinfacht: true,
        },
        {
            name: "terrain_water_tile",
            sicht: "terrain_water_render",
            schicht: "terrain_water_render",
            spalten: "v.public_id, v.region_type, v.region_public_id, v.name, v.area",
            vereinfacht: true,
        },
    ])(
        "🔴 $name liefert dieselben Bytes wie die alte Sicht",
        async ({ name, sicht, schicht, spalten, vereinfacht }) => {
            let getroffen = 0;
            for (const kachel of KACHELN) {
                const erwartet = await ausSicht(sicht, schicht, spalten, vereinfacht, kachel);
                if (erwartet !== LEER) getroffen += 1;
                expect(await ausFunktion(name, kachel), `${name} ${kachel.join("/")}`).toBe(erwartet);
            }
            // Die Gegenprobe: Ohne Treffer wäre der Vergleich grün und wertlos.
            expect(getroffen, `${name}: keine Kachel mit Inhalt`).toBeGreaterThan(2);
        },
    );

    it("ley_node_tile liefert dieselben Bytes wie die alte Sicht", async () => {
        const spalten =
            "v.public_id, v.name, v.subtype, v.is_hidden, v.label_min_zoom_override, v.label_max_zoom_override, v.label_visible_override, v.label_size_override, v.collision_rank, v.is_ruined, v.node_kind";
        for (const kachel of KACHELN)
            expect(await ausFunktion("ley_node_tile", kachel)).toBe(
                await ausSicht("ley_node_render", "ley_node_render", spalten, false, kachel),
            );
    });

    /** Die Wegnamen-Kachel, wie sie vor 0318 aus der alten Sicht las. */
    const wegnamenAusSicht = async ([z, x, y]: readonly [number, number, number]): Promise<string> => {
        const [zeile] = await database.unsafe<{ h: string | null }[]>(
            `SELECT md5(ST_AsMVT(source, 'path_label_run' ORDER BY source.name, source.subtype, source.part, source.instance, source.candidate)) AS h
             FROM (
                 SELECT run.name, run.subtype, run.part, run.instance, run.instance_count, run.collision_rank, kandidat.ordnung AS candidate,
                        ST_AsMVTGeom(ST_LineSubstring(run.geom, cut.lo, cut.hi), m.envelope, 4096, 4096, false) AS geom,
                        run.mark, run.is_bach
                 FROM (SELECT ST_TileEnvelope($1::int, $2::int, $3::int) AS envelope, (2 * 20037508.342789244) / (512.0 * power(2, $1::int)) AS einheit, $1::int AS z) m
                 CROSS JOIN path_label_run_render run
                 CROSS JOIN LATERAL (SELECT run.name_width_px * m.einheit AS target, NULLIF(ST_Length(run.geom), 0) AS laenge) need
                 CROSS JOIN LATERAL (VALUES (0, 0.0), (1, 0.125), (2, -0.125), (3, 0.25), (4, -0.25)) AS kandidat(ordnung, versatz)
                 CROSS JOIN LATERAL (SELECT 0.5 + kandidat.versatz * need.target / need.laenge AS mitte, (need.target / 2.0) / need.laenge AS halb) lage
                 CROSS JOIN LATERAL (SELECT GREATEST(0.0, lage.mitte - lage.halb) AS lo, LEAST(1.0, lage.mitte + lage.halb) AS hi) cut
                 WHERE m.z BETWEEN run.run_min_zoom AND run.run_max_zoom
                   AND (kandidat.ordnung = 0 OR (lage.mitte - lage.halb >= 0.0 AND lage.mitte + lage.halb <= 1.0))
                   AND ST_Intersects(ST_LineInterpolatePoint(run.geom, 0.5), ST_Expand(m.envelope, GREATEST(need.target, ST_Length(run.geom)) / 2.0))
             ) source`,
            [z, x, y],
        );
        return zeile?.h ?? LEER;
    };

    it("🔴 path_label_run_tile liefert dieselben Bytes wie der Weg über die alte Sicht (0318)", async () => {
        let getroffen = 0;
        for (const kachel of KACHELN) {
            const erwartet = await wegnamenAusSicht(kachel);
            if (erwartet !== LEER) getroffen += 1;
            const [zeile] = await database.unsafe<{ h: string }[]>("SELECT md5(path_label_run_tile($1, $2, $3)) AS h", [
                ...kachel,
            ]);
            expect(zeile!.h, `Wegnamen ${kachel.join("/")}`).toBe(erwartet);
        }
        expect(getroffen, "keine Kachel mit Inhalt").toBeGreaterThan(2);

        // Die Gegenprobe zum Zickzack: Der Fall steht wirklich in den Daten, die Kachel führt ihn, und sein Kasten berührt sie nicht.
        const [fall] = await database<{ kasten: boolean; drin: boolean }[]>`
            SELECT v.geom && ST_TileEnvelope(8, 128, 128) AS kasten,
                   ST_Intersects(ST_LineInterpolatePoint(v.geom, 0.5), ST_Expand(ST_TileEnvelope(8, 128, 128), ST_Length(v.geom) / 2.0)) AS drin
            FROM path_label_run_render v WHERE v.name = 'Kachelindex Zickzack'
        `;
        expect(fall).toEqual({ kasten: false, drin: true });
    });

    it("🔴 der Filter greift den Index: Ort, Weg und beide Zweige der Flächen", async () => {
        // 🪤 Ob der Planer einen Index wählt, hängt von der Größe der Tafeln ab: Auf den sechs Wegen der Fixtures (und nach einem Autovacuum auf leeren Tafeln) ist der
        // Zugriff über den Primärschlüssel genauso billig, und der Filter hängt nur als Bedingung am Scan. Darum wächst der Bestand hier auf eine Größe, bei der ein
        // Rahmen von 10 mal 10 nur über den räumlichen Index billig ist, wie auf der Stage, und wird angelegt, ausgewertet und zurückgenommen.
        const zurueck = new Error("zurueck");
        await database
            .begin(async (tx) => {
                await tx`
                    INSERT INTO path (public_id, map_domain_id, name, subtype, is_bach, geom, source_system, is_active)
                    SELECT gen_random_uuid(), 'aventuria', 'Kachelindex Masse ' || i, 'Pfad', false,
                           ST_SetSRID(ST_MakeLine(ST_MakePoint(10 + (i % 100), 10 + (i / 100)), ST_MakePoint(12 + (i % 100), 12 + (i / 100))), 0), ${QUELLE}, true
                    FROM generate_series(1, 4000) AS i
                `;
                await tx`
                    INSERT INTO path_visual (path_id, geom, source_fingerprint, algorithm_version)
                    SELECT id, geom, 'test', 'test' FROM path WHERE source_system = ${QUELLE} AND name LIKE 'Kachelindex Masse %'
                `;
                await tx`
                    INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
                    SELECT gen_random_uuid(), 'aventuria', 'Kachelindex Masse ' || i, 'dorf', ST_SetSRID(ST_MakePoint(10 + (i % 100), 10 + (i / 100)), 0), ${QUELLE}, true
                    FROM generate_series(1, 4000) AS i
                `;
                const [masse] = await tx<{ id: string }[]>`
                    INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active)
                    VALUES (gen_random_uuid(), 'aventuria', 'Kachelindex Masse', 'vegetation', 'wald', true) RETURNING id::text
                `;
                await tx`
                    INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active)
                    SELECT gen_random_uuid(), 'aventuria', ${masse!.id}::bigint,
                           ST_GeomFromText('POLYGON((' || (10 + i % 100) || ' ' || (10 + i / 100) || ', ' || (12 + i % 100) || ' ' || (10 + i / 100) || ', ' || (12 + i % 100) || ' ' || (12 + i / 100) || ', ' || (10 + i % 100) || ' ' || (12 + i / 100) || ', ' || (10 + i % 100) || ' ' || (10 + i / 100) || '))'), true
                    FROM generate_series(1, 4000) AS i
                `;
                await tx`ANALYZE place`;
                await tx`ANALYZE region_area`;
                await tx`ANALYZE path`;
                await tx`ANALYZE path_visual`;
                await tx`SET LOCAL enable_seqscan = off`;
                const rahmen = "ST_MakeEnvelope(500, 500, 510, 510, 0)";
                for (const [sicht, index] of [
                    ["place_basis_render", "place_geom_gist"],
                    ["path_basis_render", "path_visual_geom_idx"],
                    ["path_basis_render", "path_geom_idx"],
                    ["region_area_eckig_render", "region_area_geom_gist"],
                    ["terrain_water_eckig_render", "region_area_geom_gist"],
                ] as const) {
                    const plan = await tx.unsafe<{ "QUERY PLAN": string }[]>(
                        `EXPLAIN SELECT 1 FROM ${sicht} WHERE domain_geom && ${rahmen}`,
                    );
                    expect(plan.map((zeile) => zeile["QUERY PLAN"]).join("\n"), sicht).toContain(index);
                }
                throw zurueck;
            })
            .catch((fehler: unknown) => {
                if (fehler !== zurueck) throw fehler;
            });
    });
});
