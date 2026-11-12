import kategorien from "../../../../config/legacy-zug-kategorien.json" with { type: "json" };

/**
 * Der Legacy-Zug je Kategorie (WI-0141; Handover `2026-10-13-legacy-zug-nach-production-je-kategorie.md`).
 *
 * Betreiber 2026-10-13, wörtlich: „knopf legacy zug, aber jede kategorie einzeln (also unterkategorien ohne dass man alles ziehen
 * darf): Landschaften, Wege, Orte“, und zum Ausschluss: „herrschaftsgebiete auf keinen fall -> die sind kaputt durch die
 * limitierung von strato“.
 *
 * 🔴 **Eine Stelle für vier Leser:** die Kommandozeile (`legacy:update --kategorie`), der Server (Jobart, Abgleiche), die
 * Oberfläche (drei Zeilen) und Claudios Kopie Stage → Production (`ops/production/production-kartenzug.sh` nimmt `tafeln`).
 * Die Tafeln stehen maschinenlesbar in `config/legacy-zug-kategorien.json`; `legacy-zug-tafeln.test.ts` prüft sie gegen das
 * Schema und hält fest, dass keine Gebietstafel darin steht.
 *
 * - **Was eine Kategorie ist:** die Schritte, deren Zieltafeln ihr gehören, und jede Ableitung, die auf diesen Tafeln steht.
 *   Darum trägt `landschaften` die Geländekette mit (`terrain_control` hängt an `region_area`), und `orte` den Seegraphen.
 * - **Keine Datei:** `shared/tiles` hält die Rasterserien (ADR-0008), die kein Zug berührt; die DEM-Kacheln stehen in der
 *   Datenbank (`terrain_dem_tile`). Die Kopie nach Production ist deshalb reine Datenbankarbeit.
 * - **Die Wege rechnen ihre Steigungsprofile selbst** (Betreiber 2026-10-14, wörtlich: „ja, danke der nachfrage“). I5 schreibt
 *   die Geometrie neu, damit passt `terrain_path_profile` nicht mehr; die ganze Kette rechnet es in I11, ein Zug nur der Wege
 *   rührt die Geländekette aber nicht an. Darum steht `derive:path-profiles` nach I7 in `schritte` — ohne I-Nummer, weil es
 *   kein Schritt der ganzen Kette ist — und `terrain_path_profile` in `tafeln`, damit die Kopie es mitnimmt. Die Tafel gehört
 *   damit wie `sea_route_graph` zu zwei Kategorien.
 * - **Gipfel und Vulkane fahren mit „Landschaften“** (Betreiber 2026-10-13, wörtlich: „gipfel kommen mit, kraftlinien
 *   nicht“). Sie stehen in derselben `map-features.php` wie Orte und Wege, hängen aber an ihrer Gebirgsfläche: I10 schreibt
 *   `terrain_peak` in derselben Transaktion wie die Regler, und das Höhenmodell darüber liest beide. An „Orte“ wären sie nur
 *   um den Preis zu haben, I10 aufzuspalten und die ganze Geländekette an „Orte“ zu hängen.
 * - **Ohne Kategorie:** Kraftlinien und Kraftlinienpunkte (Betreiberentscheid ebenda), dazu die alte Kreuzungstafel und Orte
 *   ohne Lage. Ein Zug fasst sie nie an. Verschiebt ein Zug einen Ort, an dem eine Kraftlinie endet, löst der Bezugsbericht
 *   (`apps/server/src/abgleiche/bezuege.ts`) das als Befund — nicht als Abbruch, und es ist die gewollte Folge des
 *   Entscheids.
 */

/** Die drei Kategorien in der Reihenfolge, in der die Oberfläche sie zeigt (Betreiber: „Landschaften, Wege, Orte“). */
export const LEGACY_ZUG_KATEGORIEN = ["landschaften", "wege", "orte"] as const;
export type LegacyZugKategorie = (typeof LEGACY_ZUG_KATEGORIEN)[number];

export function istLegacyZugKategorie(value: string): value is LegacyZugKategorie {
    return (LEGACY_ZUG_KATEGORIEN as readonly string[]).includes(value);
}

export interface LegacyZugKategorieSpec {
    /** Der Name, den die Oberfläche und die Protokolle führen. */
    readonly name: string;
    /** Legacys Endpunkte, die der Zug dieser Kategorie holt (`pull-legacy.sh --kategorie`). */
    readonly quellen: readonly string[];
    /**
     * Die Schritte in Laufreihenfolge. Eine Kennung `I1`…`I28` ist ein Schritt der ganzen Kette, genau wie `pipeline-steps.ts`
     * ihn nennt. Ein npm-Name (`derive:path-profiles`) ist eine Ableitung, die NUR ein Zug dieser Kategorie braucht, weil die
     * ganze Kette sie in einem ihrer Schritte mitrechnet; sie trägt deshalb keine Nummer (siehe `umfasst_auch` der Kategorie).
     */
    readonly schritte: readonly string[];
    /** Die Prüfungen, die nach dem Lauf grün sein müssen (npm-Namen). */
    readonly pruefungen: readonly string[];
    /** Die Schritte, deren zweiter Durchlauf „unverändert“ melden muss. */
    readonly idempotenz: readonly string[];
    /** Die Tafeln, die die Kopie Stage → Production ersetzt — genau diese und keine andere. */
    readonly tafeln: readonly string[];
    /** Dateien unter `shared/…`, die mitwandern. Heute für jede Kategorie leer. */
    readonly dateien: readonly string[];
}

const SPEC = kategorien as {
    version: number;
    kategorien: Record<string, LegacyZugKategorieSpec>;
    nie: { grund: string; quellen: readonly string[]; schritte: readonly string[]; tafeln: readonly string[] };
    ohne_kategorie: { grund: string; tafeln: readonly string[] };
    gemeinsam: { grund: string; tafeln: readonly string[] };
};

export function legacyZugKategorie(kategorie: LegacyZugKategorie): LegacyZugKategorieSpec {
    const spec = SPEC.kategorien[kategorie];
    if (spec === undefined) throw new Error(`legacy-zug-kategorien.json nennt die Kategorie ${kategorie} nicht`);
    return spec;
}

/** Was ein Zug niemals holt, läuft oder kopiert: die Herrschaftsgebiete (Betreiber 2026-10-13). */
export const LEGACY_ZUG_NIE = SPEC.nie;
/** Tafeln, die keine Kategorie nennt: ein Zug fasst sie nie an (Befund, kein Abbruch). */
export const LEGACY_ZUG_OHNE_KATEGORIE = SPEC.ohne_kategorie;
/** Von Migrationen gefüllte Kataloge: auf Stage und Production gleich, nie Teil einer Kopie. */
export const LEGACY_ZUG_GEMEINSAM = SPEC.gemeinsam;

/**
 * Gehört diese Tafel zu genau dieser Kategorie? `sea_route_graph` gehört zu zweien (Orte und Landschaften speisen ihn), das ist
 * gewollt: Beide Züge leiten ihn neu ab, und die Kopie ersetzt ihn in beiden Fällen ganz.
 */
export function legacyZugTafelGehoert(kategorie: LegacyZugKategorie, tafel: string): boolean {
    return legacyZugKategorie(kategorie).tafeln.includes(tafel);
}
