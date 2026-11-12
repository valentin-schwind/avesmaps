import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AVENTURIA } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { measure } from "../src/jobs/terrain-preview-job.ts";
import { readTerrainChoice, resolveTerrainRecipe } from "../src/terrain/auswahl.ts";
import { domainInputFingerprint } from "../src/terrain/domain/fingerprint.ts";
import { LocalTerrainRefusal, runLocalTerrain } from "../src/terrain/domain/local.ts";
import { hoehenmodellProfil } from "../src/terrain/hoehenmodell-profil.ts";
import { AVENTURIA_TERRAIN_RECIPES, AVENTURIA_TERRAIN_SELECTION } from "../src/terrain/domain/recipes.ts";
import { mitAenderungen, reglerWerte, unterschied, zahlWerte } from "../src/terrain/hoehenmodell.ts";

/**
 * Das Höhenmodell ohne Oberfläche (WI-0127 SYS-13, SYS-0001 §9c.12): Regler „A plus“, Unterschied zwischen Fassungen, Profil, die
 * Messung eines Entwurfs, der lokale Job unter Fassung 17, und mit Datenbank der Auflöser der gewählten Fassung.
 */

const F17 = AVENTURIA_TERRAIN_RECIPES.get(17)!;
const F18 = AVENTURIA_TERRAIN_RECIPES.get(18)!;

describe("Regler, Unterschied, Profil (ohne Datenbank)", () => {
    it("🔴 Fassung 17 und 18 unterscheiden sich nur in generator.uplift (236 von 239 Werten gleich)", () => {
        expect(unterschied(F17, F18).map((entry) => entry.pfad)).toEqual(["generator.uplift"]);
        expect(zahlWerte(F18) - zahlWerte(F17)).toBe(2);
        expect(reglerWerte(F17)).toMatchObject({
            radius: null,
            saturation: null,
            iterations: F17.generator.iterations,
        });
        expect(reglerWerte(F18)).toMatchObject({ radius: 16, saturation: 10, flankGrade: 0.1, maximumGrade: 0.7 });
    });

    it("🔴 ein Entwurf ändert nur freigegebene Regler in ihren Grenzen; die Rückverteilung nur in einer regionalen Fassung", () => {
        const recipe = mitAenderungen(F18, { saturation: 12, continentalHeight: 320, detailAmplitude: 200 });
        expect(recipe.generator.uplift).toEqual({ kind: "regional", radius: 16, saturation: 12 });
        expect(recipe.generator.continentalHeight).toBe(320);
        expect(recipe.generator.detail.amplitude).toBe(200);
        // Die Fassung selbst bleibt unverändert.
        expect(F18.generator.uplift?.saturation).toBe(10);
        const code = (fn: () => unknown): string | undefined => {
            try {
                fn();
                return undefined;
            } catch (error) {
                return (error as { code?: string }).code;
            }
        };
        expect(code(() => mitAenderungen(F18, {}))).toBe("terrain_draft_invalid");
        expect(code(() => mitAenderungen(F18, { seed: 1 }))).toBe("terrain_draft_invalid");
        expect(code(() => mitAenderungen(F17, { radius: 12 }))).toBe("terrain_draft_invalid");
        expect(code(() => mitAenderungen(F18, { iterations: 2.5 }))).toBe("terrain_draft_invalid");
        expect(code(() => mitAenderungen(F18, { radius: 300 }))).toBe("terrain_draft_invalid");
        expect(code(() => mitAenderungen(F18, { flankGrade: 0 }))).toBe("terrain_draft_invalid");
        expect(code(() => mitAenderungen(F18, { streamPowerK: Number.NaN }))).toBe("terrain_draft_invalid");
    });

    it("der Fingerabdruck trägt das Rezept: dieselbe Fassung, derselbe Abdruck; eine andere, ein anderer", () => {
        expect(domainInputFingerprint("x", undefined, F18)).toBe(domainInputFingerprint("x", undefined, F18));
        expect(domainInputFingerprint("x", undefined, F17)).not.toBe(domainInputFingerprint("x", undefined, F18));
        // Ohne Angabe die Vorgabe der Datei (Skripte ohne Datenbank).
        expect(domainInputFingerprint("x")).toBe(
            domainInputFingerprint("x", undefined, AVENTURIA_TERRAIN_SELECTION.recipe),
        );
    });

    it("Profil: ohne Wert voll, auf Production abgenommen; ein Tippfehler hält den Start an", () => {
        expect(hoehenmodellProfil({})).toBe("voll");
        expect(hoehenmodellProfil({ AVESMAPS_ENV: "production" })).toBe("abgenommen");
        expect(hoehenmodellProfil({ AVESMAPS_ENV: "production", HOEHENMODELL: "voll" })).toBe("voll");
        expect(() => hoehenmodellProfil({ HOEHENMODELL: "alles" })).toThrow(/HOEHENMODELL/);
    });

    it("🔴 unter Fassung 17 weigert sich der lokale Job: die ganze Karte rechnet der volle Lauf (§9c.11)", async () => {
        await expect(
            runLocalTerrain({} as Database, { mapDomainId: AVENTURIA.mapDomain, job: "x", recipe: F17 }),
        ).rejects.toMatchObject({ code: "recipe_not_local" } satisfies Partial<LocalTerrainRefusal>);
    });

    it("die Messung: Änderung über Land, Tiefland, Gebirge, Streifen, höchster Punkt, andere Höhenstufe", () => {
        // 3 × 3, gespeichert von Süden: Zeile 0 ist der Süden.
        const before = new Uint16Array([0, 100, 100, 150, 1600, 150, 100, 2000, 100]);
        // Zwei Pixel wechseln die Höhenstufe: 100 → 220 (über 200) und 100 → 50 (unter 100); Meer bleibt außen vor.
        const after = new Uint16Array([0, 100, 220, 150, 1700, 150, 100, 2100, 50]);
        const result = measure(after, 3, before, 3);
        expect(result.land).toEqual({ typisch: 0, mittel: 33.8, anstieg: 120, fall: -50 });
        expect(result.gebirge.typisch).toBe(100);
        expect(result.tiefland.typisch).toBe(0);
        expect(result.hoechster).toEqual({ vorher: 2000, nachher: 2100 });
        expect(result.streifen).toEqual({ nord: 16.7, mitte: 33.3, sued: 60 });
        expect(result.stufenWechsel).toBe(0.25);
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Auswahl je Umgebung (PostgreSQL)", { timeout: 60_000 }, () => {
    let database: Database;
    const domain = AVENTURIA.mapDomain;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 2 });
        await migrate(database);
        await seedMapDomains(database);
        await database`DELETE FROM terrain_recipe_choice`;
    });

    afterAll(async () => {
        await database`DELETE FROM terrain_recipe_choice`;
        await database.end({ timeout: 5 });
    });

    it("🔴 ohne Zeile die Datei; mit Zeile die gewählte Fassung; eine unbekannte Fassung fällt auf die Datei zurück", async () => {
        expect(await readTerrainChoice(database, domain)).toMatchObject({
            version: AVENTURIA_TERRAIN_SELECTION.recipe.version,
            quelle: "datei",
            unbekannt: null,
        });
        await database`INSERT INTO terrain_recipe_choice (map_domain_id, version, previous_version) VALUES (${domain}, 17, 18)`;
        expect((await resolveTerrainRecipe(database, domain)).version).toBe(17);
        expect(await readTerrainChoice(database, domain)).toMatchObject({
            version: 17,
            previousVersion: 18,
            quelle: "auswahl",
        });
        await database`UPDATE terrain_recipe_choice SET version = 99 WHERE map_domain_id = ${domain}`;
        expect(await readTerrainChoice(database, domain)).toMatchObject({
            version: AVENTURIA_TERRAIN_SELECTION.recipe.version,
            quelle: "datei",
            unbekannt: 99,
        });
    });
});
