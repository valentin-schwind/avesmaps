import type { MaterialArea } from "./materials.ts";
import type { MaterialRecipes } from "./recipes.ts";

interface CoverageEntry {
    layer: MaterialArea["layer"];
    type: string | null;
    count: number;
    handling: "recipe" | "water-constraint" | "neutral-unmapped";
}

export function terrainRecipeCoverage(
    areas: readonly Pick<MaterialArea, "layer" | "type">[],
    recipes: MaterialRecipes,
): { active: CoverageEntry[]; missing: CoverageEntry[]; unused: string[] } {
    const groups = new Map<string, CoverageEntry>();
    for (const area of areas) {
        const key = JSON.stringify([area.layer, area.type]);
        const water = area.layer === "topographie" && (area.type === "meer" || area.type === "see");
        const hasRecipe = area.type !== null && Object.hasOwn(recipes[area.layer], area.type);
        const entry = groups.get(key) ?? {
            layer: area.layer,
            type: area.type,
            count: 0,
            handling: water ? "water-constraint" : hasRecipe ? "recipe" : "neutral-unmapped",
        };
        entry.count += 1;
        groups.set(key, entry);
    }
    const active = [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, entry]) => entry);
    const used = new Set(areas.filter((area) => area.type !== null).map((area) => `${area.layer}/${area.type}`));
    const unused = (["topographie", "vegetation"] as const)
        .flatMap((layer) => Object.keys(recipes[layer]).map((type) => `${layer}/${type}`))
        .filter((key) => !used.has(key))
        .sort();
    return { active, missing: active.filter((entry) => entry.handling === "neutral-unmapped"), unused };
}
