import { SEA, type Grid, type Plane } from "../hydrology/grid.ts";
import { fillArea } from "../hydrology/water.ts";
import { composeDem } from "../dem-tiles.ts";
import { DEFAULT_CONE } from "../peak-cone.ts";
import { composeMaterials, type MaterialFields } from "./materials.ts";
import { initialHeight } from "./shape.ts";
import type { DomainInputs } from "./inputs.ts";
import type { TerrainRecipe } from "./recipes.ts";
import { domainIslands, domainWaterClasses, summitCores } from "./constraints.ts";
import { addInitialDetails } from "./detail.ts";
import { mountainSeedField, extendMountainFoothills, relaxMountainSeed } from "./mountain-seed.ts";
import { addMountainFragments } from "./mountain-fragments.ts";
import { sampleSmoothField } from "./field.ts";
import { releaseIntermediates } from "./memory.ts";
import { gleicheNaehteAn } from "./naht.ts";
import { bette, rueckennetzMaske } from "./rueckennetz-flaechen.ts";
import { gitterSicht, type HoehenBeobachter } from "./beobachter.ts";

/**
 * Domain-Initialform (WI-0067): Kontinentwölbung, Wasserklassen, Materialien, Landformen und V12-Gebirgsseeds
 * samt Vorlandfortsetzung und Fragmenten. Jedes ganzflächige Zwischenfeld endet mit dem Rahmen, der es als
 * letzter liest (P8); die Erosion danach sieht nur Höhe, Land, Wasser und Materialien.
 */

type Inputs = DomainInputs;

export interface InitialTerrain {
    land: Uint8Array;
    height: Float32Array;
    classes: Uint8Array;
    landCells: number;
    materials: MaterialFields;
}

/** Continental shape, water classes, materials and landforms; the coast distance ends with this frame. */
function initialLandforms(
    g: Grid,
    input: Inputs,
    recipe: TerrainRecipe,
    phase?: (name: string) => void,
    only?: Plane,
): InitialTerrain & { hillDetails: Float32Array | undefined } {
    const params = recipe.generator;
    const {
        land,
        height,
        coastDistance: landDistance,
    } = initialHeight(g, input.land, params.continentalHeight, params.continentalRadius);
    const classes = domainWaterClasses(g, input.water, domainIslands(input), summitCores(input));
    for (let k = 0; k < land.length; k += 1) if (!land[k]) classes[k] = SEA;
    let landCells = 0;
    for (let k = 0; k < height.length; k += 1) {
        if (classes[k]! & SEA) {
            height[k] = 0;
            land[k] = 0;
        } else landCells += 1;
    }
    phase?.("mask");
    const materials = composeMaterials(g, land, input.landscapes, recipe, params.materialBlur);
    const hillDetails = addInitialDetails(g, land, height, landDistance, materials, params.detail, params.seed, only);
    phase?.("initial-details");
    return { land, height, classes, landCells, materials, hillDetails };
}

function topographyMask(g: Grid, input: Inputs, type: string): Uint8Array {
    const mask = new Uint8Array(g.n * g.n);
    for (const area of input.landscapes)
        if (area.layer === "topographie" && area.type === type)
            fillArea(g, area.geometry, (k) => {
                mask[k] = 1;
            });
    return mask;
}

/** The V12 seeds on the domain grid; the existing compositor is used only to project them reproducibly. */
function projectedSeed(g: Grid, input: Inputs): Float32Array {
    // Composed directly on the domain grid, whatever the published DEM resolution is.
    return composeDem(input.seeds, [], DEFAULT_CONE, undefined, g.n);
}

/** Mountain macro seed continued into adjacent hills; the intermediate seed field ends here. */
function foothillSeed(
    g: Grid,
    input: Inputs,
    recipe: TerrainRecipe,
    macroSeed: Float32Array,
    membership: Uint8Array,
): Float32Array {
    const influence = recipe.topographie["gebirge"]?.influence;
    const field =
        influence && influence.inward > 0 && influence.outward > 0
            ? mountainSeedField(g, macroSeed, membership, influence)
            : macroSeed;
    releaseIntermediates();
    const hills = topographyMask(g, input, "huegelland");
    return extendMountainFoothills(g, field, macroSeed, membership, hills, recipe.mountainMorphology.foothills);
}

/**
 * V12 seeds, their foothill continuation and the extra mountain fragments, merged into the initial height.
 * Each whole-grid intermediate ends as soon as no later step reads it (WI-0067 P8). The fragments read only
 * the macro seed and the membership, so they are formed after the foothill fields have ended.
 */
function addMountainSeeds(
    g: Grid,
    input: Inputs,
    recipe: TerrainRecipe,
    terrain: InitialTerrain,
    hillDetails: Float32Array | undefined,
): void {
    const { height, classes, materials } = terrain;
    const membership = topographyMask(g, input, "gebirge");
    // Rückennetz-Gebirge übernehmen ihre Saat unverändert (`rueckennetz-flaechen.ts`). Nur mit ihnen bleibt die ungeglättete Saat
    // stehen; ohne endet sie wie zuvor mit der Glättung.
    const eigen = rueckennetzMaske(g, input);
    const raw = eigen ? projectedSeed(g, input) : undefined;
    const macroSeed = relaxMountainSeed(g, raw ?? projectedSeed(g, input), recipe.mountainMorphology.seedSmoothing);
    releaseIntermediates();
    const seed = foothillSeed(g, input, recipe, macroSeed, membership);
    releaseIntermediates();
    const fragmented = addMountainFragments(
        g,
        macroSeed,
        membership,
        recipe.mountainMorphology.fragments,
        recipe.generator.seed,
    );
    releaseIntermediates();
    // Formerhalt (WI-0249 P2 Schritt 3): Mit `einbettung` steht die Saat höhenbewusst auf dem Land (`bette`), sonst das Maximum wie zuvor.
    const einbettung = recipe.mountainMorphology.rueckennetz?.einbettung;
    for (let y = 0; y < g.n; y += 1)
        for (let x = 0; x < g.n; x += 1) {
            const k = y * g.n + x;
            if (classes[k]! & SEA) continue;
            if (eigen?.[k]) {
                if (einbettung === undefined) height[k] = Math.max(height[k]!, raw![k]!);
                continue;
            }
            const fragment = membership[k] ? fragmented[k]! - macroSeed[k]! : 0;
            const flank =
                hillDetails && materials.foothills
                    ? hillDetails[k]! *
                      sampleSmoothField({ m: materials.m, values: materials.foothills.capInfluence }, g.n, x, y)
                    : 0;
            height[k] = Math.max(height[k]!, seed[k]! + fragment + flank);
        }
    // Je Zelle eines Rückennetz-Gebirges einmal, auch wo sich zwei überlappen.
    if (einbettung !== undefined && eigen)
        for (const gebirge of input.rueckennetz ?? [])
            fillArea(g, gebirge.geometry, (k) => {
                if (eigen[k] !== 1 || classes[k]! & SEA) return;
                eigen[k] = 2;
                height[k] = bette(height[k]!, raw![k]!, einbettung);
            });
    // Angedockte Flächen treffen sich auf einer Höhe (OPS-000089). Hier, am fertigen Ausgangsfeld: So gilt es für beide Saatarten und an einer Hochebene.
    const andock = recipe.mountainMorphology.andock;
    if (andock && input.naehte?.length) gleicheNaehteAn(g, height, classes, input.naehte, andock.naht);
}

/**
 * Initial terrain including the mountain seeds; the hill contribution ends with this frame. With `only` the detail forms (the expensive
 * part) are computed in that window only; outside it the height is incomplete and the caller replaces it (WI-0223).
 */
export function formInitialTerrain(
    g: Grid,
    input: Inputs,
    recipe: TerrainRecipe,
    phase?: (name: string) => void,
    only?: Plane,
    /** Sieht die Landformen vor den Gebirgssaaten (WI-0249, `beobachter.ts`); nur lesen. */
    beobachter?: HoehenBeobachter,
): InitialTerrain {
    const { hillDetails, ...terrain } = initialLandforms(g, input, recipe, phase, only);
    beobachter?.("landforms", gitterSicht(g, terrain.height));
    if (input.seeds.length > 0) addMountainSeeds(g, input, recipe, terrain, hillDetails);
    return terrain;
}
