import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rezeptGrund } from "../src/terrain/domain/local.ts";
import {
    AVENTURIA_TERRAIN_RECIPES,
    fassungsName,
    recipeFingerprint,
    wirksamesRezept,
} from "../src/terrain/domain/recipes.ts";
import { inheritRecipeVersion, storeDomainRaster } from "../src/terrain/domain/store.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Der Stand einer offenen Fassung im lokalen Lauf (WI-0239; Betreiber 2026-10-19: „wir testen noch 19. kannst du alle änderungen in die 19
 * tun ohne neue versionen zu generieren bis wir sie abnehmen?“). Der lokale Lauf rechnet nur den Fußabdruck neu; ein Master aus einem
 * älteren Stand derselben Fassung darf darum nicht lokal fortgeschrieben werden.
 *
 * Problemfälle: Die Nummer allein sagt „gleich“, obwohl 19 sich geändert hat; ein Master ohne Stand (vor Migration 0209) gilt unter der
 * offenen Fassung als passend; ein Master einer abgenommenen Fassung ohne Stand wird abgewiesen (Production rechnete dann nie mehr lokal).
 */

const F18 = AVENTURIA_TERRAIN_RECIPES.get(18)!;
const F19 = AVENTURIA_TERRAIN_RECIPES.get(19)!;
/** Die Auswahl vor der Abnahme von 19 (2026-11-07): So bleibt 19 hier die offene Fassung, an der sich der Stand prüfen lässt. */
const ABGENOMMEN = [17, 18];

describe("Stand des Rezepts im lokalen Lauf (WI-0239)", () => {
    it("🔴 eine offene Fassung heißt „(Test)“, eine abgenommene nicht; mit der Abnahme fällt es weg", () => {
        expect(fassungsName(19, ABGENOMMEN)).toBe("Fassung 19 (Test)");
        expect(fassungsName(19)).toBe("Fassung 19");
        expect(fassungsName(18)).toBe("Fassung 18");
        expect(fassungsName(19, [...ABGENOMMEN, 19])).toBe("Fassung 19");
    });

    it("der Stand ist der Inhalt, wie ihn der Eingabe-Fingerabdruck liest", () => {
        // Ohne die Typwerte des Rückennetzes (WI-0246): Sie wirken nur über die Eingabe der Gebirge mit Kamm.
        expect(recipeFingerprint(F19)).toBe(
            createHash("sha256")
                .update(JSON.stringify(wirksamesRezept(F19)))
                .digest("hex"),
        );
        expect(wirksamesRezept(F19).gebirgsPresets!.typen.schild).not.toHaveProperty("rueckennetz");
        const geaendert = structuredClone(F19);
        geaendert.generator.continentalHeight += 1;
        expect(recipeFingerprint(geaendert)).not.toBe(recipeFingerprint(F19));
    });

    it("🔴 derselbe Stand derselben Fassung geht lokal; ein anderer Stand derselben Fassung nicht", () => {
        expect(
            rezeptGrund({ recipe_version: 19, recipe_fingerprint: recipeFingerprint(F19) }, F19, ABGENOMMEN),
        ).toBeUndefined();
        const geaendert = structuredClone(F19);
        geaendert.generator.continentalHeight += 1;
        expect(
            rezeptGrund({ recipe_version: 19, recipe_fingerprint: recipeFingerprint(F19) }, geaendert, ABGENOMMEN),
        ).toMatch(/älteren Stand von Fassung 19: erst der volle Lauf/);
    });

    it("eine andere Fassung geht nie lokal, wie bisher", () => {
        expect(
            rezeptGrund({ recipe_version: 18, recipe_fingerprint: recipeFingerprint(F18) }, F19, ABGENOMMEN),
        ).toMatch(/aus Fassung 18, gewählt ist 19/);
    });

    it("🔴 ohne Stand am Master: unter der offenen Fassung abgewiesen, unter einer abgenommenen wie bisher erlaubt", () => {
        expect(rezeptGrund({ recipe_version: 19, recipe_fingerprint: null }, F19, ABGENOMMEN)).toMatch(
            /Fassung 19 ist noch offen/,
        );
        expect(rezeptGrund({ recipe_version: 18, recipe_fingerprint: null }, F18, ABGENOMMEN)).toBeUndefined();
        // Ein Master vor Migration 0100 trägt auch keine Fassung: unter einer abgenommenen wie bisher.
        expect(rezeptGrund({ recipe_version: null, recipe_fingerprint: null }, F18, ABGENOMMEN)).toBeUndefined();
        // Ist 19 abgenommen, reicht die Nummer auch für sie.
        expect(rezeptGrund({ recipe_version: 19, recipe_fingerprint: null }, F19, [...ABGENOMMEN, 19])).toBeUndefined();
    });
});

const describeWithCluster = postgresBin ? describe : describe.skip;
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);

describeWithCluster(
    "Der Master trägt den Stand (Migration 0209, Wegwerf-Cluster, Jobs-Rolle)",
    { timeout: 240_000 },
    () => {
        let cluster: VpsCluster | undefined;
        beforeAll(async () => {
            cluster = await startVpsCluster("rezeptstand", vorlagen, { mapDomains: true });
        }, 240_000);
        afterAll(async () => {
            await cluster?.stop();
        });

        it("🔴 gespeichert mit Fassung und Stand; ein vorläufiger Master erbt beides von seiner Basis", async () => {
            // Die Tafel nimmt nur echte Größen (4096² oder 8192²).
            const samples = new Uint16Array(4096 * 4096);
            const master = (fingerprint: string) =>
                ({
                    raster: { width: 4096, height: 4096, cell: 0.25, originX: 0.125, originY: 0.125, samples },
                    fingerprint,
                    report: {},
                }) as unknown as Parameters<typeof storeDomainRaster>[3];
            const stand = recipeFingerprint(F19);
            await cluster!.jobs.begin(async (tx) => {
                await storeDomainRaster(tx, "aventuria", "fixture-input", master("stand-basis"), null, null, {
                    version: 19,
                    fingerprint: stand,
                });
                await storeDomainRaster(tx, "aventuria", "fixture-input", master("stand-vorlaeufig"));
                await inheritRecipeVersion(tx, "aventuria", "stand-vorlaeufig", "stand-basis");
            });
            const zeilen = await cluster!.admin<
                { fingerprint: string; recipe_version: number; recipe_fingerprint: string }[]
            >`
            SELECT fingerprint, recipe_version, recipe_fingerprint FROM terrain_domain_raster
             WHERE map_domain_id = 'aventuria' AND fingerprint LIKE 'stand-%' ORDER BY fingerprint
        `;
            expect(zeilen).toEqual([
                { fingerprint: "stand-basis", recipe_version: 19, recipe_fingerprint: stand },
                { fingerprint: "stand-vorlaeufig", recipe_version: 19, recipe_fingerprint: stand },
            ]);
        });
    },
);
