import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
    EditorLandscapePeak,
    EditorLandscapePeakRow,
    EditorPeakDetail,
    GELAENDE_ARTEN,
    LANDMARKEN_ARTEN,
    LANDMARKEN_GRUPPEN,
    LANDMARKEN_KATALOG,
    LANDMARKEN_MERKMALE,
    PeakChanges,
    PeakCreateBody,
    formtGelaende,
} from "@avesmaps3d/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { TERRAIN_PEAK_SUBTYPES } from "../src/migration/terrain.ts";

/**
 * Der Katalog der Landmarkenarten und das Schema halten zusammen (WI-0271 L2, Migration 0276; Variante D, Vali 2026-10-31 „Ja, D“).
 *
 * Eine Liste an fünf Stellen: der Katalog in `packages/shared/src/landmarken.ts`, der CHECK der Art und der Merkmale in 0276, die Höhe nur
 * bei Geländearten (0276), die Gelände-Sicht (0268) und `formt_gelaende` der Kartensicht (0276). Läuft eine davon auseinander, formt eine
 * Höhle Gelände oder ein Berg verliert es. Die Liste des Legacy-Zugs bleibt bei Berggipfel und Vulkan: Wüchse sie mit, kämen Legacys freie
 * Beschriftungen (huegel, schlucht, felsformation) als Legacy-Zeilen in die Tabelle (WI-0271 §7.5).
 *
 * Ohne Zeile einer neuen Art (R5 der Orchestrierung): geprüft werden der Quelltext der Migrationen und, mit Datenbank, die Definitionen im
 * Katalog von PostgreSQL.
 */

const MIGRATIONEN = fileURLToPath(new URL("../migrations/", import.meta.url));
const sql0268 = readFileSync(`${MIGRATIONEN}0268_terrain_peak_gelaende.sql`, "utf8");
const sql0276 = readFileSync(`${MIGRATIONEN}0276_terrain_peak_landmarken.sql`, "utf8");
const sql0310 = readFileSync(`${MIGRATIONEN}0310_landmarke_nur_gelaende.sql`, "utf8");

/** Die Werte einer `IN (…)`-Liste nach dem Muster vor ihr, in der Reihenfolge der Quelle. */
function liste(sql: string, vor: RegExp): string[] {
    const treffer = new RegExp(`${vor.source}\\s*\\(([^)]*)\\)`, "u").exec(sql);
    if (!treffer?.[1]) throw new Error(`keine Liste nach ${vor.source}`);
    return [...treffer[1].matchAll(/'([^']+)'/gu)].map((m) => m[1] ?? "");
}

const sortiert = (werte: readonly string[]): string[] => [...werte].sort();

/** Die Werte der Art in einem Vertrag (eine Vereinigung von Literalen unter `subtype`). */
const artenIm = (schema: { properties: { subtype: unknown } }): string[] =>
    ((schema.properties.subtype as { anyOf?: { const: string }[] }).anyOf ?? []).map((wert) => wert.const);

describe("Katalog der Landmarkenarten und Schema (WI-0271 L2)", () => {
    it("🔴 der CHECK der Art in 0276 nennt genau die Arten des Katalogs", () => {
        expect(liste(sql0276, /terrain_peak_subtype_check CHECK \(subtype IN/u)).toEqual([...LANDMARKEN_ARTEN]);
    });

    it("🔴 Gelände formen genau Berggipfel und Vulkan: Katalog, Höhen-CHECK, Gelände-Sicht, Kartensicht und Gipfelliste des Gebirges", () => {
        const gelaende = sortiert(GELAENDE_ARTEN);
        expect(sortiert(LANDMARKEN_ARTEN.filter((art) => LANDMARKEN_KATALOG[art].gelaende))).toEqual(gelaende);
        expect(sortiert(LANDMARKEN_ARTEN.filter((art) => formtGelaende(art)))).toEqual(gelaende);
        expect(sortiert(liste(sql0276, /height_schritt IS NULL OR subtype IN/u))).toEqual(gelaende);
        expect(sortiert(liste(sql0276, /p\.subtype IN/u))).toEqual(gelaende);
        expect(sortiert(liste(sql0268, /WHERE p\.subtype IN/u))).toEqual(gelaende);
        expect(sortiert(artenIm(EditorLandscapePeak))).toEqual(gelaende);
    });

    it("🔴 die Gipfelverträge tragen jede Landmarkenart (WI-0271 L3): sonst gäbe eine Landmarke HTTP 500", () => {
        for (const vertrag of [EditorPeakDetail, EditorLandscapePeakRow, PeakChanges, PeakCreateBody])
            expect(artenIm(vertrag)).toEqual([...LANDMARKEN_ARTEN]);
    });

    it("🔴 die Liste des Legacy-Zugs wächst nicht mit (nur Berggipfel und Vulkan)", () => {
        expect(sortiert(TERRAIN_PEAK_SUBTYPES)).toEqual(sortiert(GELAENDE_ARTEN));
    });

    it("die Merkmale in 0310 sind die des Katalogs; jede Art hat einen Eintrag in einer bekannten Gruppe", () => {
        const merkmale = /merkmale <@ ARRAY\[([^\]]*)\]/u.exec(sql0310)?.[1] ?? "";
        expect([...merkmale.matchAll(/'([^']+)'/gu)].map((m) => m[1])).toEqual([...LANDMARKEN_MERKMALE]);
        expect(Object.keys(LANDMARKEN_KATALOG).sort()).toEqual(sortiert(LANDMARKEN_ARTEN));
        for (const art of LANDMARKEN_ARTEN) expect(LANDMARKEN_GRUPPEN).toContain(LANDMARKEN_KATALOG[art].gruppe);
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Schema der Landmarken in PostgreSQL (WI-0271 L2)", () => {
    let database: Database;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl ?? "", { max: 1 });
        await migrate(database);
    });

    afterAll(async () => {
        await database.end({ timeout: 5 });
    });

    it("🔴 die Bedingungen an terrain_peak stehen im Katalog von PostgreSQL wie im Katalog der Arten", async () => {
        const zeilen = await database<{ name: string; def: string }[]>`
            SELECT conname AS name, pg_get_constraintdef(oid) AS def
              FROM pg_constraint
             WHERE conrelid = 'terrain_peak'::regclass AND contype = 'c'
               AND conname IN ('terrain_peak_subtype_check', 'terrain_peak_merkmale_known', 'terrain_peak_hoehe_nur_gelaende')
             ORDER BY conname
        `;
        const def = Object.fromEntries(zeilen.map((z) => [z.name, z.def]));
        const werte = (text: string | undefined): string[] =>
            [...(text ?? "").matchAll(/'([^']+)'/gu)].map((m) => m[1] ?? "");
        expect(sortiert(werte(def["terrain_peak_subtype_check"]))).toEqual(sortiert(LANDMARKEN_ARTEN));
        expect(sortiert(werte(def["terrain_peak_merkmale_known"]))).toEqual(sortiert(LANDMARKEN_MERKMALE));
        expect(sortiert(werte(def["terrain_peak_hoehe_nur_gelaende"]))).toEqual(sortiert(GELAENDE_ARTEN));
    });

    it("die Gelände-Sicht und die Kartensicht nennen nur die Geländearten", async () => {
        const [gelaende] = await database<
            { def: string }[]
        >`SELECT pg_get_viewdef('terrain_peak_gelaende'::regclass, true) AS def`;
        const [karte] = await database<
            { def: string }[]
        >`SELECT pg_get_viewdef('terrain_peak_render'::regclass, true) AS def`;
        for (const def of [gelaende?.def ?? "", karte?.def ?? ""]) {
            // Die Kartensicht liest seit 0297 auch die Merkmale „verborgen“ und „ungefähr“; das sind keine Arten.
            const werte = [...def.matchAll(/'([^']+)'::text/gu)]
                .map((m) => m[1] ?? "")
                .filter((wert) => !(LANDMARKEN_MERKMALE as readonly string[]).includes(wert));
            expect(sortiert([...new Set(werte)])).toEqual(sortiert(GELAENDE_ARTEN));
        }
        expect(karte?.def).toContain("formt_gelaende");
    });

    it("terrain_peak_bezug hängt an terrain_peak und kennt nur seine Rollen", async () => {
        const spalten = await database<{ column_name: string }[]>`
            SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'terrain_peak_bezug'
             ORDER BY ordinal_position
        `;
        expect(spalten.map((s) => s.column_name)).toEqual(
            expect.arrayContaining(["terrain_peak_id", "ziel_art", "ziel_public_id", "rolle", "is_active"]),
        );
        const [rollen] = await database<{ def: string }[]>`
            SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'terrain_peak_bezug_rolle_known'
        `;
        expect(rollen?.def).toContain("am_fluss");
        expect(rollen?.def).toContain("kultstaette");
    });
});
