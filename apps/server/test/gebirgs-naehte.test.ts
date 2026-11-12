import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kantenJeGebirge, ladeGebirgsNaehte, ladeNahtLinien } from "../src/terrain/gebirgs-naehte.ts";
import { loadMountainJobs } from "../src/terrain/inputs.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Wer ist angedockt (OPS-000089)? Im Wegwerf-Cluster mit PostGIS.
 *
 * Problemfälle: Eine Fläche in einer größeren gilt als angedockt, weil sie Stücke des Umrisses teilt (der Bestand hat rund 175 überlappende Paare); eine Hochebene bekommt eine eigene Saat
 * oder wird nicht fest; ein bloßer Berührpunkt zählt; die Kanten stehen in wechselnder Ordnung und schütteln den Fingerabdruck; die offene Fassung ändert eine abgenommene.
 */

const ENV = "gebirgsnaht";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;
const DOM = "aventuria";
const id = (n: number): string => `0a900000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const A = id(1);
const B = id(2);
const INNEN = id(3);
const EBENE = id(4);
const ECKE = id(5);
const FERN = id(6);

describeWithCluster("Gemeinsame Grenzen", { timeout: 300_000 }, () => {
    let cluster: VpsCluster;

    const flaeche = async (publicId: string, typ: string, wkt: string): Promise<void> => {
        const [region] = await cluster.admin<{ id: string }[]>`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active)
            VALUES (${randomUUID()}, ${DOM}, ${`Probe ${publicId.slice(-2)}`}, 'topographie', ${typ}, TRUE) RETURNING id::text
        `;
        const [zeile] = await cluster.admin<{ id: string }[]>`
            INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active)
            VALUES (${publicId}, ${DOM}, ${region!.id}::bigint, ST_GeomFromText(${wkt}, 0), TRUE) RETURNING id::text
        `;
        if (typ === "gebirge")
            await cluster.admin`
                INSERT INTO terrain_control (area_id, map_domain_id, source_system, maximalhoehe, erosion)
                VALUES (${zeile!.id}::bigint, ${DOM}, 'test-ops89', 2000, 1.5)
            `;
    };

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
        await flaeche(A, "gebirge", "POLYGON((100 100, 200 100, 200 200, 100 200, 100 100))");
        await flaeche(B, "gebirge", "POLYGON((200 100, 300 100, 300 200, 200 200, 200 100))");
        // In A, teilt mit A zwei Stücke des Umrisses, auf derselben Seite.
        await flaeche(INNEN, "gebirge", "POLYGON((100 100, 150 100, 150 150, 100 150, 100 100))");
        await flaeche(EBENE, "hochebene", "POLYGON((100 50, 200 50, 200 100, 100 100, 100 50))");
        // Berührt B nur an einem Punkt.
        await flaeche(ECKE, "gebirge", "POLYGON((300 200, 350 200, 350 250, 300 250, 300 200))");
        await flaeche(FERN, "gebirge", "POLYGON((600 600, 650 600, 650 650, 600 650, 600 600))");
    }, 300_000);

    afterAll(async () => {
        await cluster?.stop();
    }, 60_000);

    it("🔴 Nur Flächen auf verschiedenen Seiten einer gemeinsamen Kante sind angedockt; die Hochebene ist fest", async () => {
        const paare = await ladeGebirgsNaehte(cluster.app, DOM);
        const kurz = paare.map((p) => [p.a, p.b, p.bFest, p.kanten]);
        expect(kurz).toContainEqual([
            A,
            B,
            false,
            [
                [
                    [200, 100],
                    [200, 200],
                ],
            ],
        ]);
        // Die Hochebene steht auf `b`, auch wo ihre Kennung kleiner wäre.
        expect(paare.find((p) => p.b === EBENE && p.a === A)?.bFest).toBe(true);
        expect(paare.find((p) => p.b === EBENE && p.a === INNEN)?.kanten).toEqual([
            [
                [100, 100],
                [150, 100],
            ],
        ]);
        // Die Fläche in der größeren dockt nicht; ein Berührpunkt auch nicht; die ferne schon gar nicht.
        const beteiligt = (x: string, y: string): boolean =>
            paare.some((p) => (p.a === x && p.b === y) || (p.a === y && p.b === x));
        expect(beteiligt(A, INNEN)).toBe(false);
        expect(beteiligt(B, ECKE)).toBe(false);
        expect(paare.some((p) => p.a === FERN || p.b === FERN)).toBe(false);
    });

    it("🔴 `nur` liest die Paare einer Fläche, und die Hochebene bekommt keine Kanten für eine Saat", async () => {
        const paare = await ladeGebirgsNaehte(cluster.app, DOM, [B]);
        expect(paare.map((p) => [p.a, p.b])).toEqual([[A, B]]);
        const je = kantenJeGebirge(await ladeGebirgsNaehte(cluster.app, DOM));
        expect(je.has(EBENE)).toBe(false);
        expect(je.get(A)?.length).toBe(2);
        expect(je.has(FERN)).toBe(false);
    });

    it("🔴 Die Linie der Editoren liegt auf der geglätteten Kante; ohne geglättete Form auf der eckigen, und was nur auf derselben Seite geteilt wird, fehlt", async () => {
        const eckig = await ladeNahtLinien(cluster.app, DOM);
        expect(eckig).toContainEqual([
            [200, 100],
            [200, 200],
        ]);
        // Die geglättete Form von A und B: Die Kante springt um 0,3 E, in beiden dieselbe Linie.
        const glatt = async (publicId: string, wkt: string): Promise<void> => {
            await cluster.admin`
                INSERT INTO region_area_smooth (region_area_id, geom, render_geom, source_updated_at, recipe, status)
                SELECT id, ST_GeomFromText(${wkt}, 0), ST_SetSRID(ST_GeomFromText(${wkt}), 3857), now(), 'test', 'smoothed'
                  FROM region_area WHERE public_id = ${publicId}
            `;
        };
        await glatt(A, "POLYGON((100 100, 200 100, 200.3 150, 200 200, 100 200, 100 100))");
        await glatt(B, "POLYGON((200 100, 300 100, 300 200, 200 200, 200.3 150, 200 100))");
        const linien = await ladeNahtLinien(cluster.app, DOM);
        expect(linien).toContainEqual([
            [200, 100],
            [200.3, 150],
            [200, 200],
        ]);
        expect(linien).not.toContainEqual([
            [200, 100],
            [200, 200],
        ]);
    });

    it("🔴 Die abgenommene Fassung bleibt; mit der Fassung 19 tragen nur angedockte Gebirge die Kanten, in fester Ordnung", async () => {
        const vorher = await loadMountainJobs(cluster.app, DOM);
        expect(vorher.every((job) => job.input.andock === undefined)).toBe(true);

        await cluster.admin`INSERT INTO terrain_recipe_choice (map_domain_id, version, previous_version) VALUES (${DOM}, 19, 18)`;
        const eins = await loadMountainJobs(cluster.app, DOM);
        const zwei = await loadMountainJobs(cluster.app, DOM);
        const von = (id2: string) => eins.find((job) => job.areaPublicId === id2)!;
        expect(von(A).input.andock).toEqual({
            kanten: [
                [
                    [100, 100],
                    [200, 100],
                ],
                [
                    [200, 100],
                    [200, 200],
                ],
            ],
            streifen: 6,
        });
        expect(von(FERN).input.andock).toBeUndefined();
        expect(eins.map((job) => job.fingerprint)).toEqual(zwei.map((job) => job.fingerprint));
        // Einzeln geladen dieselbe Eingabe wie zusammen: Die Vorschau und das Gelände dürfen nicht auseinanderlaufen.
        const [einzeln] = await loadMountainJobs(cluster.app, DOM, [B]);
        expect(einzeln!.fingerprint).toBe(von(B).fingerprint);
    });
});
