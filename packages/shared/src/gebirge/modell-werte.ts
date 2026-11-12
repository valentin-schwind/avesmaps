/**
 * Die Werte des Rückennetz-Modells am Gebirge und die Grenzen des gezeichneten Netzes (WI-0245, Bauplan „Gebirge aus gezeichneten
 * Kämmen“ §1, Datenmodell C: Betreiber 2026-10-20, wörtlich „C eigene tafeln.“). Ohne TypeBox, damit Reiter und Worker sie lesen; die
 * Schemas der Leitung stehen in `vertrag.ts`.
 *
 * - **Gratlinie, Gratbreite, Talboden** hängen am Gebirge (`terrain_control.grat`, `grat_breite`, `talboden`), nicht am Kamm. Leer heißt
 *   „Preset des Typs“ (Gratlinie, Gratbreite) bzw. „abgeleitet“ (Talboden). Namen wie `FormRegler` des Modells; Grenzen und Schritte wie
 *   die Regler des abgenommenen Entwurfs (V16, `modell-regler.ts`). Sie stehen bewusst NICHT in `GEBIRGS_WERTE`: Die zehn Werte der V12
 *   tragen ein Preset je Typ in der Fassung und gehen in den Fingerabdruck der V12; diese drei rechnet nur das Rückennetz.
 * - **Das Netz** (Kämme mit Rang, Nebengipfel als Formpunkte, N1: Der Betreiber wählte „N1 Formpunkte (Empfehlung)“) wird als Ganzes je
 *   Gebirgsfläche geschrieben. Die Grenzen hier sind Schutz gegen Unfug, keine Redaktion: Das Eherne Schwert hat im Entwurf 31 Kanten und
 *   16 Nebengipfel.
 */

export const GEBIRGS_MODELL_WERTE = ["grat", "gratBreite", "talboden", "erosionsfestigkeit"] as const;
export type GebirgsModellWert = (typeof GEBIRGS_MODELL_WERTE)[number];

export interface GebirgsModellGrenze {
    min: number;
    max: number;
    schritt: number;
}

export const GEBIRGS_MODELL_GRENZEN: Readonly<Record<GebirgsModellWert, GebirgsModellGrenze>> = {
    grat: { min: 0, max: 0.3, schritt: 0.01 },
    gratBreite: { min: 0.15, max: 1.5, schritt: 0.05 },
    talboden: { min: 0, max: 1, schritt: 0.05 },
    /** Prozent, um die die hydraulische Erosion der Landfläche das Gebirge verschont (0 = wie seine Landschaftsart, 100 = unberührt). */
    erosionsfestigkeit: { min: 0, max: 100, schritt: 5 },
};

/** Die Spalte in `terrain_control` je Wert; das Protokoll (`area.gebirge`) führt die Spalte. */
export const GEBIRGS_MODELL_SPALTE: Readonly<
    Record<GebirgsModellWert, "grat" | "grat_breite" | "talboden" | "erosionsfestigkeit">
> = {
    grat: "grat",
    gratBreite: "grat_breite",
    talboden: "talboden",
    erosionsfestigkeit: "erosionsfestigkeit",
};

/** Höchstens so viele Kämme und Nebengipfel je Gebirgsfläche, höchstens so viele Punkte je Kamm. */
export const GEBIRGS_NETZ_GRENZEN = { kaemme: 256, punkte: 256, nebengipfel: 256, wasser: 2048 } as const;
