import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { GebirgsPresetGruppeSchema } from "@avesmaps3d/shared";
import { fragmentReach } from "./mountain-fragments.ts";

const Positive = Type.Number({ exclusiveMinimum: 0 });
/** A closed range; each summit draws its own value in between. */
const RangeSchema = Type.Object(
    { minimum: Type.Number({ minimum: 0 }), maximum: Type.Number({ minimum: 0 }) },
    { additionalProperties: false },
);
const FragmentSchema = Type.Object(
    {
        spacing: Positive,
        attempts: Type.Integer({ minimum: 1, maximum: 32 }),
        relativeHeight: Type.Number({ exclusiveMinimum: 0, maximum: 1 }),
        lengthMinimum: Positive,
        lengthMaximum: Positive,
        radiusMinimum: Positive,
        radiusMaximum: Positive,
        massifFraction: Type.Number({ minimum: 0, maximum: 1 }),
        interruption: Type.Number({ minimum: 0, maximum: 1 }),
        warp: Type.Number({ minimum: 0, maximum: 1 }),
        inward: Positive,
    },
    { additionalProperties: false },
);
const MountainMorphologySchema = Type.Object(
    {
        seedSmoothing: Type.Number({ minimum: 0, maximum: 4 }),
        foothills: Type.Object(
            {
                reach: Positive,
                smoothing: Positive,
                hillTransition: Positive,
                hillAsymmetry: Type.Number({ minimum: 0, maximum: 0.75 }),
                capAtMountain: Type.Number({ minimum: 0, maximum: 1 }),
                macroRetention: Type.Number({ minimum: 0, maximum: 1 }),
                erosionFocus: Type.Number({ minimum: 1, maximum: 8 }),
                material: Type.Object(
                    {
                        upliftWeight: Positive,
                        erodibility: Positive,
                        diffusivity: Positive,
                        runoff: Positive,
                        channelBias: Type.Number(),
                    },
                    { additionalProperties: false },
                ),
            },
            { additionalProperties: false },
        ),
        fragments: FragmentSchema,
        /**
         * Formerhalt der Rückennetz-Gebirge (WI-0249 P2): Fehlt der Eintrag (Fassung 17 und 18), rechnet alles wie zuvor. Steht er da,
         * liegen die Saaten dieser Gebirge Zelle für Zelle auf dem Gitter (`RueckennetzRegler.gitter`), und jedes Feld schaltet seinen
         * Schritt ein (fehlt es, bleibt der Schritt wie zuvor):
         * - `einbettung` (k ≥ 2): Die Saat steht auf dem Land, das bis zum k-fachen seiner Höhe mitträgt,
         *   `h = Saat + Land · (1 − Saat / (k · Land))²` statt `max(Land, Saat)` (`bette`, `rueckennetz-flaechen.ts`).
         * - `materialRand` (E): In der Fläche gilt die Erodierbarkeit und Diffusivität des Gebirges ungeglättet, vom Umriss nach innen über
         *   diese Breite eingeblendet (statt des Materialfelds mit 5 E Unschärfe).
         * - `kernErosion`, `kernDiffusion` (0 bis 1): Faktor des Einschneidens und der Hangdiffusion an Gipfelkernen und gezeichneten Kämmen,
         *   weich zur Flanke hin auf 1 (`formerhalt.ts`).
         * - `hebungFolgt` (0 bis 1): Das Hebungsgewicht der Rückverteilung sinkt je Gebirge um das Verhältnis seiner Erodierbarkeit im
         *   Fenster zum Materialfeld (mit dieser Potenz), damit weniger Abtrag nicht in mehr Hebung umschlägt; ein Faktor je Gebirge, die
         *   Verteilung der Hebung in ihm bleibt. Außerhalb der Fenster unverändert.
         * - `sattelAbtrag` (0 bis 1): An Kämmen, deren Typ durchhängt (Typwerte `form.durchhang`, `form.durchhangNeben`), schützt der
         *   Formfaktor die Kammpunkte wie Gipfelkerne und gibt die Segmentmitten um diesen Anteil frei (langes Segment voll, kurzes kaum):
         *   Sättel dürfen mehr abtragen als die Punkte.
         * Je Gebirgstyp wirkt dazu der Typwert `form.gelaendeErosion` (Erosion im Gelände, 0 bis 1) auf Erodierbarkeit und Diffusivität im
         * Fenster, vom Umriss über `materialRand` eingeblendet; über `hebungFolgt` folgt ihm die Rückverteilung.
         */
        /**
         * Gemeinsame Grenzen (OPS-000089): `streifen` (E) rechnet das Gebirge hinter der Kante weiter, damit es dort nicht ausläuft (`gebirge/raster.ts`); `naht` (E) ist die Breite, über
         * die sich zwei angedockte Flächen auf eine Höhe treffen (`naht.ts`). Ohne das Feld rechnet die Fassung Zeichen für Zeichen wie zuvor.
         */
        andock: Type.Optional(Type.Object({ streifen: Positive, naht: Positive }, { additionalProperties: false })),
        rueckennetz: Type.Optional(
            Type.Object(
                {
                    einbettung: Type.Optional(Type.Number({ minimum: 2, maximum: 8 })),
                    materialRand: Type.Optional(Type.Number({ minimum: 0.25, maximum: 8 })),
                    kernErosion: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
                    kernDiffusion: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
                    hebungFolgt: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
                    sattelAbtrag: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
                },
                { additionalProperties: false },
            ),
        ),
        interior: Type.Object(
            {
                fragments: FragmentSchema,
                inward: Positive,
                iterations: Type.Integer({ minimum: 0, maximum: 40 }),
                streamPowerK: Positive,
                diffusion: Type.Number({ minimum: 0, maximum: 0.2 }),
                maximumGrade: Type.Number({ exclusiveMinimum: 0, maximum: 1 }),
                relaxationSteps: Type.Integer({ minimum: 1, maximum: 100 }),
                /** Map units around each mountain group's box: its local computation window. */
                halo: Positive,
                /**
                 * Hochgebirge (Schritt): kantige Grate statt runder Kuppen, weniger Glättung, steilere Felsflanken.
                 * Wirkung wächst weich von `from` bis `to` über der Ausgangshöhe. Dazu die Gipfelregeln.
                 */
                alpine: Type.Object(
                    {
                        from: Type.Number({ minimum: 0 }),
                        to: Positive,
                        crest: Type.Number({ minimum: 0, maximum: 1 }),
                        diffusion: Type.Number({ minimum: 0, maximum: 1 }),
                        maximumGrade: Type.Number({ exclusiveMinimum: 0, maximum: 2 }),
                        /**
                         * Jeder Berggipfel (Betreiber 2026-10-03: dieselbe Regel für alle, pseudozufällig, nichts fest
                         * eingebaut): Jeder Gipfel zieht seine Werte aus Generator-Seed und Position in diesen Bereichen.
                         */
                        summit: Type.Object(
                            {
                                /** Mittlere Neigung vom Gipfel zum Fuß (Anstieg je Lauf). */
                                grade: RangeSchema,
                                /** Profilexponent: oben etwas steiler, zum Fuß weich auslaufend. */
                                profile: RangeSchema,
                                /** Schwankung des Umrisses um den mittleren Radius. */
                                outline: RangeSchema,
                                /** Hauptrücken rund um den Gipfel; doppelt so viele feine kommen zum Fuß hinzu. */
                                ridges: Type.Object(
                                    {
                                        minimum: Type.Integer({ minimum: 2, maximum: 24 }),
                                        maximum: Type.Integer({ minimum: 2, maximum: 24 }),
                                    },
                                    { additionalProperties: false },
                                ),
                                /** Relief der Rücken und Täler relativ zur Gipfelhöhe. */
                                relief: RangeSchema,
                                /** Anteil der Erosionsrinnen und -rücken auf den wiederhergestellten Flanken. */
                                detail: RangeSchema,
                                /** Ganz wiederhergestellt bis zu diesem Anteil der Höhe unter dem Gipfel ... */
                                restoreFull: RangeSchema,
                                /** ... und ab diesem gar nicht mehr. */
                                restoreNone: RangeSchema,
                                /**
                                 * Vorrang des eigenen Gipfels (WI-0249 P2): Die Wiederherstellung hebt keine Zelle über ihren Gipfel,
                                 * sondern hält sie um diese Neigung (Anstieg je Lauf) darunter. Fehlt er (Fassung 17, 18), deckeln nur
                                 * die Nachbargipfel wie zuvor.
                                 */
                                dominance: Type.Optional(Type.Number({ minimum: 0, maximum: 2 })),
                            },
                            { additionalProperties: false },
                        ),
                        /** Jeder Vulkan: runder Kegelstumpf, oben eben auf Gipfelhöhe. */
                        volcano: Type.Object(
                            { grade: RangeSchema, plateau: RangeSchema },
                            { additionalProperties: false },
                        ),
                    },
                    { additionalProperties: false },
                ),
            },
            { additionalProperties: false },
        ),
    },
    { additionalProperties: false },
);
export type MountainMorphology = Static<typeof MountainMorphologySchema>;
const LandformSchema = Type.Object(
    {
        kind: Type.Union([Type.Literal("hills"), Type.Literal("plateau")]),
        minimum: Positive,
        maximum: Positive,
        wavelength: Positive,
        hills: Type.Optional(
            Type.Object(
                {
                    attempts: Type.Integer({ minimum: 1, maximum: 32 }),
                    radiusAtMinimum: Positive,
                    heightExponent: Type.Number({ minimum: 1, maximum: 16 }),
                    overlapPower: Type.Number({ minimum: 2, maximum: 8 }),
                },
                { additionalProperties: false },
            ),
        ),
    },
    { additionalProperties: false },
);
export type LandformRecipe = Static<typeof LandformSchema>;
const DetailSchema = Type.Object(
    {
        amplitude: Positive,
        wavelength: Positive,
        octaves: Type.Integer({ minimum: 1, maximum: 8 }),
        persistence: Type.Number({ exclusiveMinimum: 0, maximum: 1 }),
        coastFade: Positive,
    },
    { additionalProperties: false },
);
export type DetailRecipe = Static<typeof DetailSchema>;
export const MaterialRecipeSchema = Type.Object(
    {
        upliftWeight: Positive,
        erodibility: Positive,
        diffusivity: Positive,
        runoff: Positive,
        channelBias: Type.Number(),
        landform: Type.Optional(LandformSchema),
        influence: Type.Optional(
            Type.Object(
                {
                    inward: Type.Number({ minimum: 0 }),
                    outward: Type.Number({ minimum: 0 }),
                },
                { additionalProperties: false },
            ),
        ),
    },
    { additionalProperties: false },
);
export type MaterialRecipe = Static<typeof MaterialRecipeSchema>;
const Recipes = Type.Record(Type.String(), MaterialRecipeSchema);
export const TerrainRecipeSchema = Type.Object(
    {
        version: Type.Integer({ minimum: 1 }),
        mountainMorphology: MountainMorphologySchema,
        /**
         * Flusstäler: `flankGrade` ist die größte Steigung der Talflanke. `mountainShare` (0 bis 1, WI-0249, nur Fassung 19): Im Hochgebirge
         * wird die Flanke um diesen Anteil von `flankGrade` zur größten Gebirgssteilheit (`mountainMorphology.interior.maximumGrade`) steiler,
         * weich über die Hochgebirgsgrenze (`interior.alpine.from` bis `to`), gemessen an der Höhe des Lands am Fluss vor dem Schnitt
         * (`flusstal` in `generate.ts`). So bleibt ein Massiv neben einem tief eingeschnittenen Tal stehen; 0 wirkt wie zuvor. Fehlt er
         * (Fassung 17, 18), gilt `flankGrade` überall.
         */
        riverValley: Type.Object(
            {
                flankGrade: Type.Number({ exclusiveMinimum: 0, maximum: 1 }),
                mountainShare: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
            },
            { additionalProperties: false },
        ),
        generator: Type.Object(
            {
                size: Type.Literal(4096),
                seed: Type.Integer(),
                continentalHeight: Positive,
                continentalRadius: Positive,
                materialBlur: Type.Number({ minimum: 0 }),
                iterations: Type.Integer({ minimum: 1, maximum: 100 }),
                timeStep: Positive,
                streamPowerK: Positive,
                streamPowerM: Positive,
                diffusion: Positive,
                drainageBurn: Positive,
                drainageStep: Positive,
                detail: DetailSchema,
                /**
                 * Der Spiegel der Seen (WI-0067, Betreiber 2026-10-04: „der tiefste zufluss bestimmt die seehöhe, ansonsten liegt
                 * der see auf der niedrigsten landstelle unter ihm“), je Gewässer: `bedQuantile` ist der Anteil der Seezellen, die
                 * unter dem Spiegel liegen dürfen (0,05: die niedrigste Landstelle, robust gegen einzelne Ausreißer); `mouthReach`
                 * die Karteneinheiten vor der Mündung, auf denen das Gelände eines Zuflusses den See mitbestimmt.
                 * `inletDepth` (WI-0249 P7, nur Fassung 19): Bis zu so vielen Schritt unter dem Spiegel wird die Rinne eines Zuflusses vor
                 * der Mündung auf den Spiegel gehoben (`hebeEinlaeufe`, river-lakes.ts); 0 hebt nichts. Fehlt er (Fassung 17, 18), bleibt
                 * eine solche Mulde wie zuvor stehen, und der Anstieg ist ein Befund.
                 * `randBreite` (OPS-000086, nur Fassung 19): So viele Karteneinheiten um jeden See bleibt mindestens sein Spiegel (`see-becken.ts`); dieselbe Zahl wie
                 * `TREFFEN.seeRandE` der Saat. Fehlt er (Fassung 17, 18), bekommt kein See ein Becken.
                 */
                lakes: Type.Object(
                    {
                        bedQuantile: Type.Number({ minimum: 0, maximum: 1 }),
                        mouthReach: Positive,
                        inletDepth: Type.Optional(Type.Number({ minimum: 0 })),
                        randBreite: Type.Optional(Positive),
                    },
                    { additionalProperties: false },
                ),
                /**
                 * Prototyp D (2026-10-09): Der Erosionsverlust geht regional statt domainweit zurück (`uplift.ts`),
                 * `radius` in Karteneinheiten. Fehlt der Eintrag, gilt G7 domainweit (Fassung 17 und älter).
                 * `saturation` (Nachstimmung 2026-10-10): Hebung je Runde in Schritt, ab der das Gewicht einer Zelle in
                 * der Rückverteilung nicht mehr wächst (`redistributeSaturated`). Seit Fassung 18 gesetzt: Radius 16,
                 * Sättigung 10 (Betreiber 2026-10-10).
                 */
                uplift: Type.Optional(
                    Type.Object(
                        {
                            kind: Type.Literal("regional"),
                            radius: Type.Number({ minimum: 0.25, maximum: 256 }),
                            saturation: Type.Optional(Positive),
                        },
                        { additionalProperties: false },
                    ),
                ),
                /**
                 * Feinstufe in Kacheln (WI-0070): `size` ist die feine Auflösung, die grobe ist `generator.size`.
                 * Eine Regel für die ganze Karte, keine Sonderregel je Kachel.
                 */
                fine: Type.Optional(
                    Type.Object(
                        {
                            size: Type.Literal(8192),
                            tiles: Type.Integer({ minimum: 1, maximum: 64 }),
                            halo: Type.Integer({ minimum: 0, maximum: 512 }),
                            blend: Type.Integer({ minimum: 1, maximum: 256 }),
                            detail: Type.Object(
                                {
                                    amplitude: Type.Number({ minimum: 0 }),
                                    wavelength: Positive,
                                    octaves: Type.Integer({ minimum: 1, maximum: 8 }),
                                    persistence: Type.Number({ minimum: 0, maximum: 1 }),
                                    relief: Positive,
                                },
                                { additionalProperties: false },
                            ),
                            erosion: Type.Object(
                                {
                                    iterations: Type.Integer({ minimum: 0, maximum: 20 }),
                                    streamPowerK: Type.Number({ minimum: 0 }),
                                    exponent: Positive,
                                    diffusion: Type.Number({ minimum: 0, maximum: 1 }),
                                    fill: Positive,
                                    maximumChange: Positive,
                                },
                                { additionalProperties: false },
                            ),
                        },
                        { additionalProperties: false },
                    ),
                ),
            },
            { additionalProperties: false },
        ),
        topographie: Recipes,
        vegetation: Recipes,
        // Die Presets der Gebirgstypen (WI-0226; Betreiber 2026-10-17, F3: „die presets sollen im höhenmodell editiert werden können“).
        // Erst ab Fassung 19 (Koordination); eine Fassung ohne die Gruppe lässt einen gesetzten Typ ohne Wirkung und rechnet wie bisher.
        gebirgsPresets: Type.Optional(GebirgsPresetGruppeSchema),
    },
    { additionalProperties: false },
);
export type TerrainRecipe = Static<typeof TerrainRecipeSchema>;
export type MaterialRecipes = Pick<TerrainRecipe, "topographie" | "vegetation"> &
    Partial<Pick<TerrainRecipe, "mountainMorphology">>;

export function parseTerrainRecipe(value: unknown): TerrainRecipe {
    if (!Value.Check(TerrainRecipeSchema, value)) {
        throw new Error(
            `Invalid terrain recipe: ${[...Value.Errors(TerrainRecipeSchema, value)].map((error) => `${error.path}: ${error.message}`).join("; ")}`,
        );
    }
    for (const fragments of [value.mountainMorphology.fragments, value.mountainMorphology.interior.fragments]) {
        if (fragments.lengthMaximum < fragments.lengthMinimum || fragments.radiusMaximum < fragments.radiusMinimum)
            throw new Error("Invalid terrain recipe: reversed mountain fragment range");
    }
    const interior = value.mountainMorphology.interior;
    const { summit, volcano } = interior.alpine;
    // Die Spannen der Gipfelregel; `dominance` ist eine Zahl, keine Spanne.
    const spannen = [...Object.values(summit), ...Object.values(volcano)].filter(
        (range): range is { minimum: number; maximum: number } => typeof range === "object",
    );
    if (interior.alpine.to <= interior.alpine.from || spannen.some((range) => range.maximum < range.minimum))
        throw new Error("Invalid terrain recipe: reversed alpine range");
    if (interior.halo < fragmentReach(interior.fragments))
        throw new Error("Invalid terrain recipe: mountain interior halo below fragment reach");
    for (const material of Object.values(value.topographie)) {
        if (material.landform?.kind === "hills" && !material.landform.hills)
            throw new Error("Invalid terrain recipe: hill distribution missing");
        if (material.landform && material.landform.maximum < material.landform.minimum)
            throw new Error("Invalid terrain recipe: reversed landform range");
    }
    for (const material of [...Object.values(value.topographie), ...Object.values(value.vegetation)]) {
        if (material.influence && material.influence.inward + material.influence.outward === 0)
            throw new Error("Invalid terrain recipe: empty influence transition");
    }
    if (Object.values(value.vegetation).some((material) => material.landform !== undefined))
        throw new Error("Invalid terrain recipe: vegetation cannot define landforms");
    return value;
}

/**
 * Alle Fassungen eines Rezepts (Betreiber 2026-10-10: „als neue Version“): je Fassung eine vollständige Datei
 * `<fassung>.json`, deren Name die Fassung im Inhalt ist. Eine ABGENOMMENE Fassung (`accepted` der Auswahldatei) wird nie geändert; so
 * rechnet der Rückweg auf eine vorige Fassung dasselbe Gelände wie vorher (gleicher Eingabe-Fingerabdruck, `fingerprint.ts`).
 *
 * 🔴 Die jüngste Fassung darf offen sein (WI-0239; Betreiber 2026-10-19: „wir testen noch 19. kannst du alle änderungen in die 19 tun
 * ohne neue versionen zu generieren bis wir sie abnehmen?“): Bis zu ihrer Abnahme ändert sie sich in sich, und es entsteht keine neue.
 * Darum trägt ein Master neben der Fassung den Stand ihres Inhalts (`recipeFingerprint`, Migration 0209).
 */
export function loadTerrainRecipes(directory: URL): ReadonlyMap<number, TerrainRecipe> {
    const recipes = new Map<number, TerrainRecipe>();
    for (const name of readdirSync(directory).filter((file) => file.endsWith(".json"))) {
        const recipe = parseTerrainRecipe(JSON.parse(readFileSync(new URL(name, directory), "utf8")));
        if (name !== `${String(recipe.version)}.json`)
            throw new Error(`Invalid terrain recipe: ${name} carries version ${String(recipe.version)}`);
        recipes.set(recipe.version, recipe);
    }
    return new Map([...recipes].sort(([a], [b]) => a - b));
}

/**
 * Das Rezept, wie es in Fingerabdrücke eingeht: ohne die Typwerte des Rückennetzes (`gebirgsPresets.typen.<typ>.rueckennetz`,
 * WI-0246). Sie wirken nur auf Gebirge mit gezeichneten Kämmen und stehen dort aufgelöst in deren Eingabe (`terrain/inputs.ts`); ein
 * Gebirge mit Kamm rechnet also neu, wenn sich seine Typwerte ändern, und ohne Kamm rechnet nichts neu (Hauptorchestrierung 2026-10-20:
 * kein Geländelauf ohne Wirkung). Ein Rezept ohne diese Werte bleibt Zeichen für Zeichen, wie es war.
 */
export function wirksamesRezept(recipe: TerrainRecipe): TerrainRecipe {
    const gruppe = recipe.gebirgsPresets;
    if (!gruppe || !Object.values(gruppe.typen).some((preset) => preset.rueckennetz !== undefined)) return recipe;
    const typen = Object.fromEntries(
        Object.entries(gruppe.typen).map(([typ, preset]) => {
            const ohne = { ...preset };
            delete ohne.rueckennetz;
            return [typ, ohne];
        }),
    ) as typeof gruppe.typen;
    return { ...recipe, gebirgsPresets: { ...gruppe, typen } };
}

/**
 * Der Stand eines Rezeptinhalts (WI-0239): SHA-256 von `JSON.stringify` des geprüften Rezepts, derselbe Inhalt, den der
 * Eingabe-Fingerabdruck liest (`fingerprint.ts`). Er unterscheidet zwei Stände derselben offenen Fassung. Ohne die Typwerte des
 * Rückennetzes (`wirksamesRezept`).
 */
export function recipeFingerprint(recipe: TerrainRecipe): string {
    return createHash("sha256")
        .update(JSON.stringify(wirksamesRezept(recipe)))
        .digest("hex");
}

const RecipeSelectionSchema = Type.Object(
    {
        $comment: Type.Optional(Type.String()),
        active: Type.Integer({ minimum: 1 }),
        // Die auf Stage abgenommenen Fassungen (WI-0127 SYS-13, SYS-0001 §9c.8 und §9c.12 Frage 5 B): Nur sie darf Production aktivieren.
        accepted: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }), { uniqueItems: true })),
    },
    { additionalProperties: false },
);

/**
 * Die Vorgabe der Datei: die gültige Fassung, wenn eine Umgebung keine eigene Auswahl trägt (WI-0127 SYS-13: die Auswahl je Umgebung
 * steht in `terrain_recipe_choice`, `terrain/auswahl.ts`), dazu die abgenommenen Fassungen. Keine Umgebungsweiche in der Datei.
 */
export function selectTerrainRecipe(recipes: ReadonlyMap<number, TerrainRecipe>, selection: unknown): TerrainRecipe {
    return readTerrainSelection(recipes, selection).recipe;
}

export function readTerrainSelection(
    recipes: ReadonlyMap<number, TerrainRecipe>,
    selection: unknown,
): { recipe: TerrainRecipe; accepted: readonly number[] } {
    if (!Value.Check(RecipeSelectionSchema, selection))
        throw new Error("Invalid terrain recipe selection: expected { active: <version>, accepted?: [<version>, …] }");
    const recipe = recipes.get(selection.active);
    if (!recipe) throw new Error(`Invalid terrain recipe selection: version ${String(selection.active)} is missing`);
    const accepted = selection.accepted ?? [];
    for (const version of accepted)
        if (!recipes.has(version))
            throw new Error(`Invalid terrain recipe selection: accepted version ${String(version)} is missing`);
    return { recipe, accepted };
}

const CONFIG = new URL("../../../../../config/terrain/", import.meta.url);

/** Jede eingetragene Fassung Aventuriens, nach Fassung geordnet (`config/terrain/aventuria/`). */
export const AVENTURIA_TERRAIN_RECIPES = loadTerrainRecipes(new URL("aventuria/", CONFIG));

/** Die Auswahldatei (`config/terrain/aventuria.json`): Vorgabe `active` und die abgenommenen Fassungen `accepted`. */
export const AVENTURIA_TERRAIN_SELECTION = readTerrainSelection(
    AVENTURIA_TERRAIN_RECIPES,
    JSON.parse(readFileSync(new URL("aventuria.json", CONFIG), "utf8")),
);

/**
 * Die Vorgabe der Datei (Feld `active`). 🔴 Seit WI-0127 SYS-13 gilt in einer Umgebung, was `resolveTerrainRecipe` (`terrain/auswahl.ts`)
 * aus der Datenbank liest; diese Konstante ist nur noch der Rückfall ohne eigene Auswahl und die Vorgabe für Skripte ohne Datenbank.
 */
export const AVENTURIA_TERRAIN_RECIPE = AVENTURIA_TERRAIN_SELECTION.recipe;

/**
 * Der Name einer Fassung, wie Oberfläche und Aufträge ihn zeigen (WI-0239; Betreiber 2026-10-19: „ergänz denen namen der 19 mit (Test)“):
 * Eine offene Fassung (nicht unter `accepted`) heißt „Fassung 19 (Test)“, eine abgenommene „Fassung 18“. Abgeleitet statt als Feld in der
 * Rezeptdatei: Ein Feld ginge in den Fingerabdruck des Inhalts ein, und mit der Abnahme fällt „(Test)“ so von selbst weg.
 */
export function fassungsName(
    version: number,
    accepted: readonly number[] = AVENTURIA_TERRAIN_SELECTION.accepted,
): string {
    return accepted.includes(version) ? `Fassung ${String(version)}` : `Fassung ${String(version)} (Test)`;
}
