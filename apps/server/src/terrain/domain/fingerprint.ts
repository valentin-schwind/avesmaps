import { createHash } from "node:crypto";
import { DOMAIN_GENERATOR_VERSION } from "./generate.ts";
import { AVENTURIA_TERRAIN_RECIPE, wirksamesRezept, type TerrainRecipe } from "./recipes.ts";

/**
 * Der Eingabe-Fingerabdruck eines Masters: Eingaben, Rezept, Generator, Größe. Dieselbe Fassung ergibt denselben Fingerabdruck und damit
 * dasselbe Gelände; ein Rückweg findet einen noch gespeicherten Master wieder. Das Rezept ist das der Umgebung (`resolveTerrainRecipe`,
 * WI-0127 SYS-13); ohne Angabe die Vorgabe der Datei (Skripte ohne Datenbank). Die Typwerte des Rückennetzes zählen hier nicht
 * (`wirksamesRezept`): Sie stecken in der Eingabe der Gebirge mit Kamm.
 */
export function domainInputFingerprint(
    input: string,
    size?: number,
    recipe: TerrainRecipe = AVENTURIA_TERRAIN_RECIPE,
): string {
    return createHash("sha256")
        .update(
            JSON.stringify({
                input,
                recipe: wirksamesRezept(recipe),
                generator: DOMAIN_GENERATOR_VERSION,
                size: size ?? recipe.generator.size,
            }),
        )
        .digest("hex");
}
