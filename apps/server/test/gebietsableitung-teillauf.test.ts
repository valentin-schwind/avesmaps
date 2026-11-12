import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { deriveTerritories } from "../src/territories/derive.ts";
import { VOLLER_LAUF_SPAETESTENS_MS } from "../src/territories/derive-plan.ts";

/**
 * Der Teillauf der Gebietsableitung (WI-0283 §4, Migration 0317) gegen echtes PostGIS. 🔴 Der Maßstab ist der volle Lauf: Nach jeder Änderung rechnet erst der
 * Teillauf, dann dieselbe Datenbank noch einmal voll; alle Tafeln müssen gleich sein, Zeile für Zeile und Byte für Byte.
 *
 * Die benannten Fälle sind die, an denen eine Rechnung nur im Teilbaum scheitern würde: eine Form, die in die Nachbarin hineinragt (Zellen über Baumgrenzen);
 * Umhängen (alter und neuer Baum); eine Spanne an einem Vorfahren; ein Name; eine Schraffur; eine Hauptstadt; eine stillgelegte Fläche; ein neues Gebiet.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const DOMAENE = "teillauf-test";
const id = (art: number, n: number): string =>
    `28300000-${art.toString(16).padStart(4, "0")}-4000-8000-${n.toString(16).padStart(12, "0")}`;
const REICHE = 2;
const HERZOGTUEMER = 3;
const BARONIEN = 6;
const KANTE = 20;

const quadrat = (x: number, y: number, breite = KANTE, hoehe = KANTE): string =>
    `MULTIPOLYGON(((${String(x)} ${String(y)}, ${String(x + breite)} ${String(y)}, ${String(x + breite)} ${String(y + hoehe)}, ${String(x)} ${String(y + hoehe)}, ${String(x)} ${String(y)})))`;

describeWithDatabase("Gebietsableitung: Teillauf gegen vollen Lauf", () => {
    let database: Database;
    const gebiete = new Map<string, string>();
    const flaechen = new Map<string, string>();

    const gebiet = async (schluessel: string, name: string, eltern: string | null, spanne: [number, number]) => {
        const [zeile] = await database<{ id: string }[]>`
            INSERT INTO territory (public_id, map_domain_id, parent_id, name, color, opacity, wiki_key, is_active, source_system, min_zoom, max_zoom)
            VALUES (
                ${id(1, gebiete.size + 1)}, ${DOMAENE}, ${eltern === null ? null : gebiete.get(eltern)!}::bigint, ${name}, '#B2B065', 0.7,
                ${`wiki:wi0283-${schluessel}`}, TRUE, 'test', ${spanne[0]}, ${spanne[1]}
            )
            RETURNING id::text
        `;
        gebiete.set(schluessel, zeile!.id);
    };
    const flaeche = async (schluessel: string, gebietSchluessel: string, wkt: string) => {
        const [zeile] = await database<{ id: string }[]>`
            INSERT INTO territory_area (public_id, territory_id, map_domain_id, geom, is_active, source_system)
            VALUES (${id(2, flaechen.size + 1)}, ${gebiete.get(gebietSchluessel)!}::bigint, ${DOMAENE}, ST_GeomFromText(${wkt}), TRUE, 'test')
            RETURNING id::text
        `;
        flaechen.set(schluessel, zeile!.id);
    };
    const aufraeumen = async (): Promise<void> => {
        const inDomaene = database`(SELECT id FROM territory WHERE map_domain_id = ${DOMAENE})`;
        await database`DELETE FROM territory_state WHERE map_domain_id = ${DOMAENE}`;
        await database`DELETE FROM territory_inner_edge WHERE owner_id IN ${inDomaene}`;
        await database`DELETE FROM territory_claim_shape WHERE territory_id IN ${inDomaene}`;
        await database`DELETE FROM territory_border WHERE territory_id IN ${inDomaene}`;
        await database`DELETE FROM territory_shape WHERE territory_id IN ${inDomaene}`;
        await database`DELETE FROM territory_display_area WHERE territory_id IN ${inDomaene}`;
        await database`DELETE FROM territory_claim WHERE territory_id IN ${inDomaene}`;
        await database`DELETE FROM territory_area WHERE map_domain_id = ${DOMAENE}`;
        await database`UPDATE territory SET parent_id = NULL WHERE map_domain_id = ${DOMAENE}`;
        await database`DELETE FROM territory WHERE map_domain_id = ${DOMAENE}`;
        await database`DELETE FROM map_domain WHERE id = ${DOMAENE}`;
    };

    /** Alle abgeleiteten Zeilen der Domäne, je Stelle ein Abdruck: Geometrie als Bytes, Attribute als Text, Durchläufe eingeschlossen. */
    const stand = async (): Promise<Map<string, string>> => {
        const inDomaene = database`(SELECT id FROM territory WHERE map_domain_id = ${DOMAENE})`;
        const zeilen = await database<{ k: string; v: string }[]>`
            SELECT 'form/' || band || '/' || territory_id AS k,
                   concat_ws('|', md5(ST_AsEWKB(geom)), md5(ST_AsEWKB(render_geom)), md5(ST_AsEWKB(label_geom)), md5(COALESCE(ST_AsEWKB(fill_render_geom), ''::bytea)),
                             parent_id, depth, source_count, area, hatched, run_from, run_to) AS v
            FROM territory_shape WHERE territory_id IN ${inDomaene}
            UNION ALL
            SELECT 'grenze/' || band || '/' || kind || '/' || territory_id,
                   concat_ws('|', md5(ST_AsEWKB(geom)), md5(ST_AsEWKB(render_geom)), level, label_name, run_from, run_to)
            FROM territory_border WHERE territory_id IN ${inDomaene}
            UNION ALL
            SELECT 'schraffur/' || band || '/' || territory_id,
                   concat_ws('|', md5(ST_AsEWKB(geom)), md5(ST_AsEWKB(render_geom)), display_territory_id)
            FROM territory_claim_shape WHERE territory_id IN ${inDomaene}
            UNION ALL
            SELECT 'anzeige/' || band || '/' || area_id, territory_id::text
            FROM territory_display_area WHERE territory_id IN ${inDomaene}
            UNION ALL
            SELECT 'kante/' || band || '/' || a_id || '/' || b_id || '/' || part,
                   concat_ws('|', owner_id, depth, md5(ST_AsEWKB(raw_geom)), lebt, md5(ST_AsEWKB(geom)), len)
            FROM territory_inner_edge WHERE owner_id IN ${inDomaene}
        `;
        return new Map(zeilen.map((zeile) => [zeile.k, zeile.v]));
    };

    /** Die Probe jedes Falls: Teillauf, Stand merken, voll rechnen, vergleichen. */
    const pruefe = async (erwartet: "teil" | "voll" = "teil"): Promise<{ formen: number; alleFormen: number }> => {
        const bericht = await deriveTerritories(database, { mapDomainId: DOMAENE, teilweise: true });
        expect(bericht.computed).toBe(true);
        expect(bericht.modus, bericht.vollGrund ?? "").toBe(erwartet);
        const teil = await stand();
        await deriveTerritories(database, { mapDomainId: DOMAENE, force: true });
        const voll = await stand();
        const abweichend = [...new Set([...teil.keys(), ...voll.keys()])].filter(
            (key) => teil.get(key) !== voll.get(key),
        );
        expect(abweichend.sort()).toEqual([]);
        return {
            formen: bericht.geaenderteFormen,
            alleFormen: [...voll.keys()].filter((key) => key.startsWith("form/")).length,
        };
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await aufraeumen();
        await database`
            INSERT INTO map_domain (id, coordinate_space_id, min_x, min_y, max_x, max_y, axis_x, axis_y, miles_per_unit, schritt_per_unit, config_checksum)
            SELECT ${DOMAENE}, coordinate_space_id, min_x, min_y, max_x, max_y, axis_x, axis_y, miles_per_unit, schritt_per_unit, config_checksum
            FROM (VALUES ('test', 0::float8, 0::float8, 1024::float8, 1024::float8, 'east', 'north', 3.0::float8, 1000.0::float8, 'test'))
                 AS v(coordinate_space_id, min_x, min_y, max_x, max_y, axis_x, axis_y, miles_per_unit, schritt_per_unit, config_checksum)
        `;
        // Zwei Reiche, je drei Herzogtümer, je sechs Baronien: Die Baronien liegen Kante an Kante, auch über die Grenzen von Herzogtum und Reich.
        for (let r = 0; r < REICHE; r += 1) {
            await gebiet(`r${String(r)}`, `Reich ${String(r)}`, null, [0, 3]);
            for (let h = 0; h < HERZOGTUEMER; h += 1) {
                await gebiet(
                    `h${String(r)}${String(h)}`,
                    `Herzogtum ${String(r)}${String(h)}`,
                    `r${String(r)}`,
                    [4, 5],
                );
                for (let b = 0; b < BARONIEN; b += 1) {
                    const schluessel = `b${String(r)}${String(h)}${String(b)}`;
                    await gebiet(schluessel, `Baronie ${schluessel}`, `h${String(r)}${String(h)}`, [6, 8]);
                    await flaeche(
                        schluessel,
                        schluessel,
                        quadrat(300 + (r * HERZOGTUEMER + h) * KANTE, 300 + b * KANTE),
                    );
                }
            }
        }
        await deriveTerritories(database, { mapDomainId: DOMAENE, force: true });
    });

    afterAll(async () => {
        await aufraeumen();
        await database.end({ timeout: 5 });
    });

    it("🔴 ohne Änderung rechnet er nichts; der erste Lauf ohne Abdruck rechnet voll", async () => {
        const nichts = await deriveTerritories(database, { mapDomainId: DOMAENE, teilweise: true });
        expect(nichts.computed).toBe(false);
        await database`UPDATE territory_state SET derive_inputs = NULL WHERE map_domain_id = ${DOMAENE}`;
        await database`UPDATE territory SET name = 'Baronie b000 neu' WHERE id = ${gebiete.get("b000")!}::bigint`;
        const ohneAbdruck = await deriveTerritories(database, { mapDomainId: DOMAENE, teilweise: true });
        expect(ohneAbdruck.modus).toBe("voll");
        expect(ohneAbdruck.vollGrund).toBe("kein_abdruck");
    });

    it("🔴 Fläche ändern, Form ragt in die Nachbarin: nur ein kleiner Teil rechnet, das Ergebnis ist das des vollen Laufs", async () => {
        await database`
            UPDATE territory_area SET geom = ST_GeomFromText(${quadrat(300, 300, KANTE + 4, KANTE)}), updated_at = now()
            WHERE id = ${flaechen.get("b000")!}::bigint
        `;
        const { formen, alleFormen } = await pruefe();
        expect(formen).toBeGreaterThan(0);
        // Band für Band nur das Gebiet und seine Vorfahren: 3 von 9 Bändern zeigen die Baronie, die übrigen ihre Vorfahren.
        expect(formen).toBeLessThan(alleFormen / 4);
    });

    it("🔴 Umhängen: alter und neuer Baum", async () => {
        await database`UPDATE territory SET parent_id = ${gebiete.get("h01")!}::bigint WHERE id = ${gebiete.get("b001")!}::bigint`;
        await pruefe();
    });

    it("🔴 Spanne eines Vorfahren: alle Nachfahren zeigen sich anders", async () => {
        await database`UPDATE territory SET min_zoom = 5, max_zoom = 6 WHERE id = ${gebiete.get("h02")!}::bigint`;
        await pruefe();
    });

    it("Name: Namenslinie neu, keine Form", async () => {
        await database`UPDATE territory SET name = 'Herzogtum Neuland' WHERE id = ${gebiete.get("h10")!}::bigint`;
        const { formen } = await pruefe();
        expect(formen).toBe(0);
    });

    it("🔴 Schraffur: ein Anspruch dazu, über Reichsgrenzen", async () => {
        await database`
            INSERT INTO territory_claim (territory_id, claimant_id, sort_order, is_active, source)
            VALUES (${gebiete.get("b105")!}::bigint, ${gebiete.get("r0")!}::bigint, 0, TRUE, 'manual')
        `;
        await pruefe();
    });

    it("Hauptstadt setzen ändert nur den Zeiger", async () => {
        const ort = id(3, 1);
        await database`UPDATE territory SET capital_place_public_id = ${ort}::uuid WHERE id = ${gebiete.get("r1")!}::bigint`;
        const { formen } = await pruefe();
        expect(formen).toBe(0);
        await database`UPDATE territory SET capital_place_public_id = NULL WHERE id = ${gebiete.get("r1")!}::bigint`;
        await pruefe();
    });

    it("🔴 Fläche stilllegen und neues Gebiet anlegen", async () => {
        await database`UPDATE territory_area SET is_active = FALSE WHERE id = ${flaechen.get("b114")!}::bigint`;
        await pruefe();
        await gebiet("b999", "Baronie Neu", "h12", [6, 8]);
        await flaeche("b999", "b999", quadrat(300 + 5 * KANTE, 300 + BARONIEN * KANTE));
        await pruefe();
    });

    it("🔴 einmal am Tag rechnet er voll, auch wenn der Abdruck passt", async () => {
        await database`UPDATE territory SET name = 'Baronie b121 neu' WHERE id = ${gebiete.get("b121")!}::bigint`;
        const spaeter = await deriveTerritories(database, {
            mapDomainId: DOMAENE,
            teilweise: true,
            nowMs: Date.now() + VOLLER_LAUF_SPAETESTENS_MS + 1,
        });
        expect(spaeter.modus).toBe("voll");
        expect(spaeter.vollGrund).toBe("tageslauf");
    });

    it("🔴 ein älterer Stand hat dazwischen gerechnet (Revision passt nicht): voll", async () => {
        await database`UPDATE territory SET name = 'Baronie b122 neu' WHERE id = ${gebiete.get("b122")!}::bigint`;
        await database`UPDATE territory_state SET derived_revision = 'aaaaaaaaaaaa' WHERE map_domain_id = ${DOMAENE}`;
        const bericht = await deriveTerritories(database, { mapDomainId: DOMAENE, teilweise: true });
        expect(bericht.modus).toBe("voll");
        expect(bericht.vollGrund).toBe("abdruck_alt");
    });
});
