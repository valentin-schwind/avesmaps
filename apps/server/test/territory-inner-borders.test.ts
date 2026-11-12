import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import type { LegacyTerritoryPayload } from "../src/migration/territories.ts";
import { importTerritories } from "../src/migration/territory-import.ts";
import { deriveTerritories } from "../src/territories/derive.ts";
import { verifyInnerBorders } from "../src/territories/verify-inner-borders.ts";
import { verifyTerritoryShapes } from "../src/territories/verify-derived.ts";

/**
 * Die Innengrenzen: genau EINE Linie zwischen zwei angrenzenden Flächen (WI-0062, Feinschliff 2026-09-30, Betreiber: „zwei
 * gestrichelte grenzen übereinander, das sieht doppelgemoppelt aus“), gegen echtes PostGIS.
 *
 * Die Fixture bildet nach, was Legacys Daten tun: Nachbarflächen, die sich in einem schmalen Streifen ÜBERLAPPEN statt
 * kantengleich zu liegen. Alle Maße sind Zweierbrüche (exakt darstellbar), damit die Kanten der Fixture nicht an Rundung
 * hängen:
 *  - Baronie A und Baronie B überlappen sich in einem Streifen von 1/16 Einheit Breite (A endet bei x = 140, B beginnt bei
 *    x = 139,9375);
 *  - Baronie B und Baronie C teilen ihre Kante bei x = 179,9375 Punkt für Punkt (der Normalfall);
 *  - Baronie D liegt ganz IN Baronie C (eine Enklave): ihr Umriss bleibt sichtbar.
 */

const ID = (n: number): string => `77777779-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const REICH = ID(1);
const PROVINZ = ID(2);
const BARONIE_A = ID(3);
const BARONIE_B = ID(4);
const BARONIE_C = ID(5);
const BARONIE_D = ID(6);
const FLAECHE = (n: number): string => ID(0x100 + n);
const MAP_DOMAIN = "aventuria";

/** Ein Rechteck mit einem Stützpunkt in der Mitte jeder Kante (Legacys Flächen haben Zwischenpunkte). */
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
    type = "Baronie",
): Record<string, unknown> {
    return {
        public_id: publicId,
        name,
        short_name: "",
        type,
        wiki_type: type,
        parent_public_id: parent,
        status: "abhängige Provinz",
        color: "#B2B065",
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
        sort_order: 1,
        updated_at: "2026-09-18 19:38:14.964",
        coat_of_arms_url: "",
        coat_license_status: "",
        coat_origin: "",
    };
}

function flaeche(n: number, territory: string, ring: number[][]): Record<string, unknown> {
    return {
        public_id: FLAECHE(n),
        territory_public_id: territory,
        geometry: { type: "Polygon", coordinates: [ring] },
        valid_from_bf: null,
        valid_to_bf: null,
        min_zoom: 4,
        max_zoom: 6,
        updated_at: "2026-09-14 02:21:11.083",
    };
}

function quelle(): LegacyTerritoryPayload {
    return {
        ok: true,
        map_revision: 157006,
        territories_revision: "pt-fixture-innen",
        territories: [
            gebiet(REICH, "Innenreich", null, [0, 1], "Kaiserreich"),
            gebiet(PROVINZ, "Innenprovinz", REICH, [2, 3], "Herzogtum"),
            gebiet(BARONIE_A, "Baronie Alpha", PROVINZ, [4, 6]),
            gebiet(BARONIE_B, "Baronie Beta", PROVINZ, [4, 6]),
            gebiet(BARONIE_C, "Baronie Gamma", PROVINZ, [4, 6]),
            gebiet(BARONIE_D, "Baronie Delta", PROVINZ, [4, 6]),
        ],
        geometries: [
            flaeche(1, BARONIE_A, quadrat(100, 100)),
            // Überlappt A um 1/16 E: beide Umrisse liegen im Innern der jeweils anderen Fläche.
            flaeche(2, BARONIE_B, quadrat(139.9375, 100)),
            // Teilt die Kante bei x = 179,9375 mit B.
            flaeche(3, BARONIE_C, quadrat(179.9375, 100)),
            // Eine Enklave in C.
            flaeche(4, BARONIE_D, quadrat(190, 110, 10, 10)),
        ],
        claims: [],
    } as LegacyTerritoryPayload;
}

class AbortWithResult extends Error {
    readonly eintraege: Awaited<ReturnType<typeof verifyInnerBorders>>;
    constructor(eintraege: Awaited<ReturnType<typeof verifyInnerBorders>>) {
        super("Rückgängig machen");
        this.eintraege = eintraege;
    }
}

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Innengrenzen: genau eine Linie zwischen zwei angrenzenden Flächen, gegen PostGIS", () => {
    let database: Database;

    async function aufraeumen(): Promise<void> {
        const eigene = `(SELECT id FROM territory WHERE public_id::text LIKE '77777779-%')`;
        await database.unsafe(`DELETE FROM territory_border WHERE territory_id IN ${eigene}`);
        await database.unsafe(`DELETE FROM territory_shape WHERE territory_id IN ${eigene}`);
        await database.unsafe(`DELETE FROM territory_display_area WHERE territory_id IN ${eigene}`);
        await database.unsafe(`DELETE FROM territory_claim WHERE territory_id IN ${eigene}`);
        await database.unsafe(`DELETE FROM territory_area WHERE public_id::text LIKE '77777779-%'`);
        await database.unsafe(`UPDATE territory SET parent_id = NULL WHERE public_id::text LIKE '77777779-%'`);
        await database.unsafe(`DELETE FROM territory WHERE public_id::text LIKE '77777779-%'`);
        await database.unsafe(
            `DELETE FROM territory_state WHERE map_domain_id = '${MAP_DOMAIN}' AND source_stamp = 'pt-fixture-innen'`,
        );
        await database.unsafe(
            `DELETE FROM migration_run WHERE data_domain = 'territories' AND source_ref LIKE 'territories_revision=pt-fixture-innen%' AND NOT EXISTS (SELECT 1 FROM territory WHERE migration_run_id = migration_run.id) AND NOT EXISTS (SELECT 1 FROM territory_area WHERE migration_run_id = migration_run.id) AND NOT EXISTS (SELECT 1 FROM territory_claim WHERE migration_run_id = migration_run.id)`,
        );
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await aufraeumen();
        await importTerritories(database, quelle());
        await deriveTerritories(database, { force: true });
    }, 120_000);

    afterAll(async () => {
        await aufraeumen();
        await database.end({ timeout: 5 });
    });

    /** Die Innengrenzen der Provinz in einem Band, im Fenster `x0 … x1` geschnitten: Stücke mit Länge und x der Mitte. */
    async function innenlinien(band: number, x0: number, x1: number): Promise<{ length: number; x: number }[]> {
        return database<{ length: number; x: number }[]>`
            SELECT ST_Length(d.geom) AS length, ST_X(ST_LineInterpolatePoint(d.geom, 0.5)) AS x
            FROM territory_border b
            JOIN territory t ON t.id = b.territory_id AND t.public_id = ${PROVINZ}
            CROSS JOIN LATERAL ST_Dump(ST_Intersection(b.geom, ST_MakeEnvelope(${x0}, 90, ${x1}, 150, 0))) d
            WHERE b.band = ${band} AND b.kind = 'inner' AND ST_Dimension(d.geom) = 1
            ORDER BY x
        `;
    }

    it("🔴 wo sich zwei Flächen überlappen, steht EINE Innengrenze, nicht zwei nebeneinander (Betreiber: doppelgemoppelt)", async () => {
        // Bis Band 8: Legacys 6 steht nach dem Import als 8 (WI-0188), Band 7 und 8 zeigen, was Band 6 zeigt.
        for (const band of [4, 5, 6, 7, 8]) {
            const linien = await innenlinien(band, 139.5, 140.5);
            // Genau ein Stück (die Kante der einen oder der anderen Fläche), 40 lang, nicht zwei parallele im Abstand 1/16.
            expect(linien, `Band ${String(band)}`).toHaveLength(1);
            expect(linien[0]?.length).toBeCloseTo(40, 6);
            expect([139.9375, 140]).toContain(linien[0]?.x);
        }
    });

    it("🔴 die gemeinsame Kante zweier Flächen bleibt eine Linie, die Enklave behält ihren Umriss", async () => {
        const gemeinsam = await innenlinien(5, 179.5, 180.5);
        expect(gemeinsam).toHaveLength(1);
        expect(gemeinsam[0]?.length).toBeCloseTo(40, 6);
        expect(gemeinsam[0]?.x).toBe(179.9375);
        // Baronie D (10 × 10) liegt in C: ihr Umriss ist eine Innengrenze der Provinz (Eigenfläche gegen Kind), 40 lang.
        const enklave = await innenlinien(5, 189, 201);
        expect(enklave.reduce((summe, linie) => summe + linie.length, 0)).toBeCloseTo(40, 6);
        // Zusammen: die Überlappung (40), die gemeinsame Kante (40) und der Umriss der Enklave (40) - nicht 160 wie mit Doppellinie.
        const [summe] = await database<{ length: number; rows: number }[]>`
            SELECT sum(ST_Length(b.geom)) AS length, count(*)::int AS rows
            FROM territory_border b JOIN territory t ON t.id = b.territory_id AND t.public_id = ${PROVINZ}
            WHERE b.band = 5 AND b.kind = 'inner'
        `;
        expect(summe?.rows).toBe(1);
        expect(summe?.length).toBeCloseTo(120, 6);
    });

    it("die Innengrenzen der Provinz tragen ihre Tiefe als Ebene, und die Reiche darüber haben keine (nur ein Kind)", async () => {
        const zeilen = await database<{ band: number; level: number; name: string }[]>`
            SELECT b.band::int AS band, b.level::int AS level, t.name
            FROM territory_border b JOIN territory t ON t.id = b.territory_id
            WHERE t.public_id::text LIKE '77777779-%' AND b.kind = 'inner' ORDER BY b.band
        `;
        expect(zeilen).toEqual([4, 5, 6, 7, 8].map((band) => ({ band, level: 1, name: "Innenprovinz" })));
    });

    it("🔴 der Prüfer der Ableitung besteht, auch `inner_border_unique` und `inner_border_owners`", async () => {
        const ergebnis = await verifyTerritoryShapes(database);
        const innen = ergebnis.checks.filter((eintrag) => eintrag.name.startsWith("inner_border_"));
        expect(innen.map((eintrag) => eintrag.name)).toEqual(["inner_border_unique", "inner_border_owners"]);
        expect(ergebnis.checks.filter((eintrag) => !eintrag.passed)).toEqual([]);
    });

    it("🔴 der Prüfer findet eine doppelte Innengrenze: dieselbe Kante zweimal und eine parallele im Abstand 1/16", async () => {
        const ergebnis = await database
            .begin(async (tx) => {
                // Die Kante zwischen B und C ein zweites Mal (als Zeile eines anderen Vorfahren) und die von A und B versetzt.
                await tx`
                    INSERT INTO territory_border (band, kind, level, territory_id, geom, render_geom)
                    SELECT b.band, 'inner', 0, r.id,
                           ST_Translate(b.geom, 0.0625, 0),
                           map_domain_to_render(${MAP_DOMAIN}, ST_Translate(b.geom, 0.0625, 0))::geometry(MultiLineString, 3857)
                    FROM territory_border b
                    JOIN territory t ON t.id = b.territory_id AND t.public_id = ${PROVINZ}
                    JOIN territory r ON r.public_id = ${REICH}
                    WHERE b.band = 5 AND b.kind = 'inner'
                `;
                const eintraege = await verifyInnerBorders(tx, MAP_DOMAIN, []);
                throw new AbortWithResult(eintraege);
            })
            .catch((fehler: unknown) => {
                if (fehler instanceof AbortWithResult) return fehler.eintraege;
                throw fehler;
            });
        const eindeutig = ergebnis.find((eintrag) => eintrag.name === "inner_border_unique");
        expect(eindeutig?.passed).toBe(false);
        expect(eindeutig?.offenders?.join("\n")).toContain("liegen aufeinander");
        // Nichts davon blieb stehen: die Ableitung ist wieder in Ordnung.
        const danach = await verifyTerritoryShapes(database);
        expect(danach.passed).toBe(true);
    });
});
