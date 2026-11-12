import { HOEHENMODELL_REGLER, type HoehenmodellReglerId } from "./hoehenmodell.ts";

/**
 * Alle stellbaren Werte von „19 (Test)“ (WI-0246 Nachtrag; Betreiber 2026-10-20 über die Hauptorchestrierung, wörtlich: „Weitere Werte von
 * Fassung 19 (Test) sollten auch editierbar sein (selbes tab-layout wie bei den gebirgspresets - wenn schon dann richtig)“). Gegliedert in
 * Bereiche mit Kacheln wie die Gebirgs-Presets; je Wert der Pfad im Rezept (`config/terrain/aventuria/<n>.json`) und die Grenzen zum
 * Tippen. Die Prüfung des ganzen Rezepts bleibt beim Schema der Dateien (`terrain/domain/recipes.ts`); die Grenzen hier spiegeln es.
 *
 * - Die zehn freigegebenen Regler (`HOEHENMODELL_REGLER`) stehen mit ihrer Kennung an ihrem Platz; sie gehen weiter über `werte.regler`.
 *   Die Entwürfe der Höhenmodell-Seite ändern weiter nur sie (§9c.12 Frage 2 „A plus“); dieser Katalog gilt allein für „19 (Test)“.
 * - **Landschaften:** je Art der Fassung (Topographie und Vegetation) dieselben Felder, soweit die Art sie führt.
 * - **Nur lesend** bleiben Rastergröße, Saat, die Technik des Feinrasters (Größe, Kacheln, Rand, Überblendung) und die Art der
 *   Rückverteilung (Hauptorchestrierung 2026-10-20): Sie ändern das Raster selbst, nicht die Form.
 */

export interface KatalogWert {
    /** Pfad im Rezept, mit Punkten („generator.detail.wavelength“). */
    pfad: string;
    min: number;
    max: number | null;
    ganz: boolean;
    /** Einer der freigegebenen Regler: dann geht er als `werte.regler[<regler>]`. */
    regler?: HoehenmodellReglerId;
}

export interface KatalogKachel {
    id: string;
    werte: readonly KatalogWert[];
}

export const HOEHENMODELL_BEREICHE = ["gelaende", "fein", "gebirgsform", "landschaften"] as const;
export type HoehenmodellBereich = (typeof HOEHENMODELL_BEREICHE)[number];

const v = (pfad: string, min: number, max: number | null = null, ganz = false): KatalogWert => {
    const regler = HOEHENMODELL_REGLER.find((r) => r.pfad.join(".") === pfad);
    return regler ? { pfad, min, max, ganz, regler: regler.id } : { pfad, min, max, ganz };
};
const spanne = (basis: string, min: number, max: number | null, ganz = false): KatalogWert[] => [
    v(`${basis}.minimum`, min, max, ganz),
    v(`${basis}.maximum`, min, max, ganz),
];
const bruchstuecke = (basis: string): KatalogWert[] => [
    v(`${basis}.spacing`, 0),
    v(`${basis}.attempts`, 1, 32, true),
    v(`${basis}.relativeHeight`, 0, 1),
    v(`${basis}.lengthMinimum`, 0),
    v(`${basis}.lengthMaximum`, 0),
    v(`${basis}.radiusMinimum`, 0),
    v(`${basis}.radiusMaximum`, 0),
    v(`${basis}.massifFraction`, 0, 1),
    v(`${basis}.interruption`, 0, 1),
    v(`${basis}.warp`, 0, 1),
    v(`${basis}.inward`, 0),
];
const ALPIN = "mountainMorphology.interior.alpine";

/** Die festen Bereiche mit ihren Kacheln; die Landschaften kommen aus der Fassung (`landschaftsKacheln`). */
export const HOEHENMODELL_KATALOG: Readonly<
    Record<Exclude<HoehenmodellBereich, "landschaften">, readonly KatalogKachel[]>
> = {
    gelaende: [
        {
            id: "kontinent",
            werte: [
                v("generator.continentalHeight", 0),
                v("generator.continentalRadius", 0),
                v("generator.materialBlur", 0),
            ],
        },
        {
            id: "erosion",
            werte: [
                v("generator.iterations", 1, 100, true),
                v("generator.timeStep", 0),
                v("generator.streamPowerK", 0),
                v("generator.streamPowerM", 0),
                v("generator.diffusion", 0),
            ],
        },
        { id: "abfluss", werte: [v("generator.drainageBurn", 0), v("generator.drainageStep", 0)] },
        {
            id: "rauschen",
            werte: [
                v("generator.detail.amplitude", 0),
                v("generator.detail.wavelength", 0),
                v("generator.detail.octaves", 1, 8, true),
                v("generator.detail.persistence", 0, 1),
                v("generator.detail.coastFade", 0),
            ],
        },
        {
            id: "seen",
            werte: [
                v("generator.lakes.bedQuantile", 0, 1),
                v("generator.lakes.mouthReach", 0),
                v("generator.lakes.inletDepth", 0),
            ],
        },
        {
            id: "rueckverteilung",
            werte: [v("generator.uplift.radius", 0.25, 256), v("generator.uplift.saturation", 0)],
        },
    ],
    fein: [
        {
            id: "rauschen",
            werte: [
                v("generator.fine.detail.amplitude", 0),
                v("generator.fine.detail.wavelength", 0),
                v("generator.fine.detail.octaves", 1, 8, true),
                v("generator.fine.detail.persistence", 0, 1),
                v("generator.fine.detail.relief", 0),
            ],
        },
        {
            id: "erosion",
            werte: [
                v("generator.fine.erosion.iterations", 0, 20, true),
                v("generator.fine.erosion.streamPowerK", 0),
                v("generator.fine.erosion.exponent", 0),
                v("generator.fine.erosion.diffusion", 0, 1),
                v("generator.fine.erosion.fill", 0),
                v("generator.fine.erosion.maximumChange", 0),
            ],
        },
    ],
    gebirgsform: [
        {
            id: "vorland",
            werte: [
                v("mountainMorphology.foothills.reach", 0),
                v("mountainMorphology.foothills.smoothing", 0),
                v("mountainMorphology.foothills.hillTransition", 0),
                v("mountainMorphology.foothills.hillAsymmetry", 0, 0.75),
                v("mountainMorphology.foothills.capAtMountain", 0, 1),
                v("mountainMorphology.foothills.macroRetention", 0, 1),
                v("mountainMorphology.foothills.erosionFocus", 1, 8),
                v("mountainMorphology.foothills.material.upliftWeight", 0),
                v("mountainMorphology.foothills.material.erodibility", 0),
                v("mountainMorphology.foothills.material.diffusivity", 0),
                v("mountainMorphology.foothills.material.runoff", 0),
                v("mountainMorphology.foothills.material.channelBias", -20, 20),
            ],
        },
        { id: "aussen", werte: bruchstuecke("mountainMorphology.fragments") },
        { id: "innen", werte: bruchstuecke("mountainMorphology.interior.fragments") },
        {
            id: "inneres",
            werte: [
                v("mountainMorphology.seedSmoothing", 0, 4),
                v("mountainMorphology.interior.inward", 0),
                v("mountainMorphology.interior.iterations", 0, 40, true),
                v("mountainMorphology.interior.streamPowerK", 0),
                v("mountainMorphology.interior.diffusion", 0, 0.2),
                v("mountainMorphology.interior.maximumGrade", 0, 1),
                v("mountainMorphology.interior.relaxationSteps", 1, 100, true),
                v("mountainMorphology.interior.halo", 0),
            ],
        },
        {
            id: "hochgebirge",
            werte: [
                v(`${ALPIN}.from`, 0),
                v(`${ALPIN}.to`, 0),
                v(`${ALPIN}.crest`, 0, 1),
                v(`${ALPIN}.diffusion`, 0, 1),
                v(`${ALPIN}.maximumGrade`, 0, 2),
            ],
        },
        {
            id: "gipfel",
            werte: [
                ...spanne(`${ALPIN}.summit.grade`, 0, null),
                ...spanne(`${ALPIN}.summit.profile`, 0, null),
                ...spanne(`${ALPIN}.summit.outline`, 0, null),
                ...spanne(`${ALPIN}.summit.ridges`, 2, 24, true),
                ...spanne(`${ALPIN}.summit.relief`, 0, null),
                ...spanne(`${ALPIN}.summit.detail`, 0, null),
                ...spanne(`${ALPIN}.summit.restoreFull`, 0, null),
                ...spanne(`${ALPIN}.summit.restoreNone`, 0, null),
                // Vorrang des eigenen Gipfels (WI-0249 P2); nur Fassungen, die ihn führen.
                v(`${ALPIN}.summit.dominance`, 0, 2),
            ],
        },
        {
            id: "vulkan",
            werte: [...spanne(`${ALPIN}.volcano.grade`, 0, null), ...spanne(`${ALPIN}.volcano.plateau`, 0, null)],
        },
        // Steiler im Hochgebirge (WI-0249); nur Fassungen, die ihn führen.
        { id: "taeler", werte: [v("riverValley.flankGrade", 0, 1), v("riverValley.mountainShare", 0, 1)] },
        // Formerhalt der Rückennetz-Gebirge (WI-0249 P2); nur Fassungen mit `mountainMorphology.rueckennetz` führen ihn.
        {
            id: "formerhalt",
            werte: [
                v("mountainMorphology.rueckennetz.einbettung", 2, 8),
                v("mountainMorphology.rueckennetz.materialRand", 0.25, 8),
                v("mountainMorphology.rueckennetz.kernErosion", 0, 1),
                v("mountainMorphology.rueckennetz.kernDiffusion", 0, 1),
                v("mountainMorphology.rueckennetz.hebungFolgt", 0, 1),
                v("mountainMorphology.rueckennetz.sattelAbtrag", 0, 1),
            ],
        },
    ],
};

/** Was nur lesend bleibt (Kopf der Datei): Pfade im Rezept. */
export const HOEHENMODELL_TECHNIK = [
    "generator.size",
    "generator.seed",
    "generator.fine.size",
    "generator.fine.tiles",
    "generator.fine.halo",
    "generator.fine.blend",
    "generator.uplift.kind",
] as const;

/** Die Werte der Technik einer Fassung, soweit sie sie führt. */
export function technikWerte(rezept: unknown): Record<string, number | string> {
    const werte: Record<string, number | string> = {};
    for (const pfad of HOEHENMODELL_TECHNIK) {
        const wert = pfad
            .split(".")
            .reduce<unknown>((knoten, key) => (knoten as Record<string, unknown> | undefined)?.[key], rezept);
        if (typeof wert === "number" || typeof wert === "string") werte[pfad] = wert;
    }
    return werte;
}

/** Die Felder einer Landschaftsart, soweit die Art sie führt (`MaterialRecipeSchema`). */
export const LANDSCHAFT_FELDER: readonly { feld: string; min: number; max: number | null; ganz: boolean }[] = [
    { feld: "upliftWeight", min: 0, max: null, ganz: false },
    { feld: "erodibility", min: 0, max: null, ganz: false },
    { feld: "diffusivity", min: 0, max: null, ganz: false },
    { feld: "runoff", min: 0, max: null, ganz: false },
    { feld: "channelBias", min: -20, max: 20, ganz: false },
    { feld: "influence.outward", min: 0, max: null, ganz: false },
    { feld: "influence.inward", min: 0, max: null, ganz: false },
    { feld: "landform.minimum", min: 0, max: null, ganz: false },
    { feld: "landform.maximum", min: 0, max: null, ganz: false },
    { feld: "landform.wavelength", min: 0, max: null, ganz: false },
    { feld: "landform.hills.attempts", min: 1, max: 32, ganz: true },
    { feld: "landform.hills.radiusAtMinimum", min: 0, max: null, ganz: false },
    { feld: "landform.hills.heightExponent", min: 1, max: 16, ganz: false },
    { feld: "landform.hills.overlapPower", min: 2, max: 8, ganz: false },
];

/** Die Gruppen der Landschaften im Rezept. */
export const LANDSCHAFT_GRUPPEN = ["topographie", "vegetation"] as const;

/**
 * Die Kacheln der Landschaften aus den flachen Werten einer Fassung (`HoehenmodellTest.rezeptDatei`): je Art eine Kachel mit den Feldern,
 * die die Art führt; Kennung „topographie.gebirge“.
 */
export function landschaftsKacheln(flach: Readonly<Record<string, number>>): KatalogKachel[] {
    const kacheln: KatalogKachel[] = [];
    for (const gruppe of LANDSCHAFT_GRUPPEN) {
        const arten = [
            ...new Set(
                Object.keys(flach)
                    .filter((pfad) => pfad.startsWith(`${gruppe}.`))
                    .map((pfad) => pfad.split(".")[1]!),
            ),
        ];
        for (const art of arten) {
            const werte = LANDSCHAFT_FELDER.filter(({ feld }) => `${gruppe}.${art}.${feld}` in flach).map(
                ({ feld, min, max, ganz }) => ({ pfad: `${gruppe}.${art}.${feld}`, min, max, ganz }),
            );
            kacheln.push({ id: `${gruppe}.${art}`, werte });
        }
    }
    return kacheln;
}

/** Der Katalogeintrag zu einem Pfad, auch für Landschaften; `undefined`, wenn der Pfad nicht stellbar ist. */
export function katalogWert(pfad: string): KatalogWert | undefined {
    for (const kacheln of Object.values(HOEHENMODELL_KATALOG))
        for (const kachel of kacheln) {
            const treffer = kachel.werte.find((w) => w.pfad === pfad);
            if (treffer) return treffer;
        }
    const [gruppe, art, ...rest] = pfad.split(".");
    if (!(LANDSCHAFT_GRUPPEN as readonly string[]).includes(gruppe ?? "") || art === undefined) return undefined;
    const feld = LANDSCHAFT_FELDER.find((f) => f.feld === rest.join("."));
    return feld ? { pfad, min: feld.min, max: feld.max, ganz: feld.ganz } : undefined;
}

/** Alle stellbaren Pfade einer Fassung (ohne Regler), mit ihren Zahlen: der feste Katalog und die Felder jeder Landschaftsart. */
export function flacheRezeptWerte(rezept: unknown): Record<string, number> {
    const flach: Record<string, number> = {};
    const lies = (pfad: string): unknown =>
        pfad
            .split(".")
            .reduce<unknown>((knoten, key) => (knoten as Record<string, unknown> | undefined)?.[key], rezept);
    for (const kacheln of Object.values(HOEHENMODELL_KATALOG))
        for (const kachel of kacheln)
            for (const wert of kachel.werte) {
                if (wert.regler !== undefined) continue;
                const zahl = lies(wert.pfad);
                if (typeof zahl === "number") flach[wert.pfad] = zahl;
            }
    for (const gruppe of LANDSCHAFT_GRUPPEN) {
        const arten = lies(gruppe);
        if (typeof arten !== "object" || arten === null) continue;
        for (const art of Object.keys(arten))
            for (const { feld } of LANDSCHAFT_FELDER) {
                const zahl = lies(`${gruppe}.${art}.${feld}`);
                if (typeof zahl === "number") flach[`${gruppe}.${art}.${feld}`] = zahl;
            }
    }
    return flach;
}
