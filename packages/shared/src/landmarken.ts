/**
 * Die Landmarkenarten (WI-0271, Variante D; Vali 2026-10-31 „Ja, D“): EIN Katalog für alles, was als Landmarke in der Topographie steht.
 *
 * Alle Arten liegen in derselben Tabelle `terrain_peak`; nur Berggipfel und Vulkan formen Gelände (`GELAENDE_ARTEN`, die Sicht
 * `terrain_peak_gelaende`, Migration 0268). Die Liste ist dieselbe wie der CHECK der Art in Migration 0276; `landmarken-katalog.test.ts`
 * hält beide zusammen. Getrennt davon bleibt die Liste des Legacy-Zugs (`TERRAIN_PEAK_SUBTYPES` in `apps/server/src/migration/terrain.ts`):
 * Sie bestimmt, was der Import aus Legacy übernimmt, und darf nicht mitwachsen (sonst kämen Legacys freie Beschriftungen als Legacy-Zeilen).
 *
 * Pässe sind Wegtypen und keine Landmarken (Vali 2026-10-31). Merkmale wie heilig oder gefährlich sind keine Arten und ändern das
 * Kartenzeichen nicht (WI-0271 §4.1, §6). Ein Riff steht für Riff und Sandbank.
 */

/** Die Arten, die Gelände formen: Gipfelpunkt mit Höhe, Vulkan nur mit anderer Bergform. */
export const GELAENDE_ARTEN = ["berggipfel", "vulkan"] as const;
export type GelaendeArt = (typeof GELAENDE_ARTEN)[number];

/** Alle Landmarkenarten, in der Reihenfolge des Katalogs (Gruppe, dann Art). */
export const LANDMARKEN_ARTEN = [
    "berggipfel",
    "vulkan",
    "huegel",
    "hoehle",
    "grotte",
    "krater",
    "schlucht",
    "wasserfall",
    "quelle",
    "geysir",
    "furt",
    "strudel",
    "fels",
    "klippe",
    "riff",
] as const;
export type LandmarkenArt = (typeof LANDMARKEN_ARTEN)[number];

export const LANDMARKEN_GRUPPEN = ["erhebung", "hohlform", "wasser", "fels_und_kueste", "untiefe"] as const;
export type LandmarkenGruppe = (typeof LANDMARKEN_GRUPPEN)[number];

export interface LandmarkenArtEintrag {
    readonly gruppe: LandmarkenGruppe;
    /** Formt die Art Gelände (nur über `terrain_peak_gelaende`)? Dann trägt sie Höhe und Bergform. */
    readonly gelaende: boolean;
    /** Darf die Landmarke Start, Zwischen- oder Ziel einer Reise sein (an ihrer Lage, WI-0271 §4.3)? Im Wasser nicht. */
    readonly reiseziel: boolean;
}

export const LANDMARKEN_KATALOG: Readonly<Record<LandmarkenArt, LandmarkenArtEintrag>> = {
    berggipfel: { gruppe: "erhebung", gelaende: true, reiseziel: true },
    vulkan: { gruppe: "erhebung", gelaende: true, reiseziel: true },
    huegel: { gruppe: "erhebung", gelaende: false, reiseziel: true },
    hoehle: { gruppe: "hohlform", gelaende: false, reiseziel: true },
    grotte: { gruppe: "hohlform", gelaende: false, reiseziel: true },
    krater: { gruppe: "hohlform", gelaende: false, reiseziel: true },
    schlucht: { gruppe: "hohlform", gelaende: false, reiseziel: true },
    wasserfall: { gruppe: "wasser", gelaende: false, reiseziel: true },
    quelle: { gruppe: "wasser", gelaende: false, reiseziel: true },
    geysir: { gruppe: "wasser", gelaende: false, reiseziel: true },
    furt: { gruppe: "wasser", gelaende: false, reiseziel: true },
    strudel: { gruppe: "wasser", gelaende: false, reiseziel: false },
    fels: { gruppe: "fels_und_kueste", gelaende: false, reiseziel: true },
    klippe: { gruppe: "fels_und_kueste", gelaende: false, reiseziel: true },
    riff: { gruppe: "untiefe", gelaende: false, reiseziel: false },
};

/**
 * Die Merkmale, die eine Landmarke mit dem Ort teilt (Vali 2026-11-02: „landmarken [können] verborgen, nodix, unterirdisch, unauffindbar/entrückt und ungefähr sein - sie können keine ruine und keinen
 * seehafen sein“). Sie wirken wie am Ort: verborgen erst ab dem Band „Verborgene Orte“ und in keiner Suche (den Namen zeigt sie dort nach „Auf der Karte anzeigen“, Vali 2026-11-04), Nodix ein Knoten der Kraftlinien, unterirdisch und ungefähr im Kopf der Infobox, ungefähr dazu mit einem Zeichen auf der Karte.
 * Entrückt hat an der Landmarke keine weitere Wirkung: Die Wegfindung nennt eine Landmarke ohnehin nur, wenn die Anfrage sie nennt. Die Umwandlung übernimmt sie vom Ort (`apps/server/src/editor/ort-in-landmarke.ts`).
 */
export const LANDMARKEN_ORTSMERKMALE = ["verborgen", "nodix", "unterirdisch", "entrueckt", "ungefaehr"] as const;
/**
 * Die Merkmale einer Landmarke (Spalte `terrain_peak.merkmale`, Migrationen 0276, 0297 und 0310): erst die Bedeutung (nie Art, nie eigenes Zeichen), dann die des Orts, zuletzt `nur_gelaende`:
 * Der Punkt formt das Gelände und steht weder auf der Karte noch in einer Suche, nur an Berggipfel und Vulkan (`merkmaleDerArt`). Dort bleiben die Hilfspunkte des Geländes aus Legacy,
 * seit „Auf der Karte anzeigen“ nur noch den Text meint (Vali 2026-11-04).
 */
export const LANDMARKEN_MERKMALE = [
    "heilig",
    "magisch",
    "gefaehrlich",
    "unzugaenglich",
    ...LANDMARKEN_ORTSMERKMALE,
    "nur_gelaende",
] as const;
export type LandmarkenMerkmal = (typeof LANDMARKEN_MERKMALE)[number];

/** Die Merkmale, die eine Art tragen kann: `nur_gelaende` nur, wo die Art Gelände formt. */
export function merkmaleDerArt(art: string): readonly LandmarkenMerkmal[] {
    return formtGelaende(art)
        ? LANDMARKEN_MERKMALE
        : LANDMARKEN_MERKMALE.filter((merkmal) => merkmal !== "nur_gelaende");
}

export function istLandmarkenArt(wert: string): wert is LandmarkenArt {
    return (LANDMARKEN_ARTEN as readonly string[]).includes(wert);
}

/** Formt diese Art Gelände? Eine unbekannte Art formt nie Gelände. */
export function formtGelaende(art: string): art is GelaendeArt {
    return (GELAENDE_ARTEN as readonly string[]).includes(art);
}

/** Welche Ortsart (`place.place_kind`) welche Landmarkenart meint; die Ortsart nennt das Wiki oder Legacy. */
const ART_DER_ORTSART: Readonly<Record<string, LandmarkenArt>> = {
    höhle: "hoehle",
    grotte: "grotte",
    wasserfall: "wasserfall",
    quelle: "quelle",
    furt: "furt",
    schlucht: "schlucht",
    klamm: "schlucht",
    krater: "krater",
    fels: "fels",
};
/** Was im Namen auf eine Art schließen lässt, in dieser Reihenfolge („Grotte Keranvor“ ist eine Grotte, auch wenn das Wiki „Höhle“ sagt). */
const ART_IM_NAMEN: readonly (readonly [RegExp, LandmarkenArt])[] = [
    [/grotte/iu, "grotte"],
    [/höhle|loch\b/iu, "hoehle"],
    [/fall\b|fälle\b/iu, "wasserfall"],
    [/quelle/iu, "quelle"],
    [/furt\b/iu, "furt"],
    [/schlucht|klamm/iu, "schlucht"],
    [/krater/iu, "krater"],
];

/**
 * Die Art, mit der ein umgewandelter Ort beginnt (WI-0271 L8, §7.3a): nach Name und Ortsart, sonst Höhle (die meisten natürlichen Bauwerke ohne Hinweis sind es, §7.3a). Nur ein Vorschlag: Der Editor legt die Art im
 * Fenster der Landmarke fest, das sich nach dem Umwandeln öffnet.
 */
export function landmarkenArtVorschlag(name: string, ortsart: string | null | undefined): LandmarkenArt {
    for (const [muster, art] of ART_IM_NAMEN) if (muster.test(name)) return art;
    const nachArt = ART_DER_ORTSART[(ortsart ?? "").trim().toLowerCase()];
    return nachArt ?? "hoehle";
}
