import type { MamAssetSummary, MediaUsage } from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";

/**
 * Was der Kreis ○ ◐ ● in den Listen der Medienverwaltung heißt (AGENTS.md „Editor: abstrakte Zeichen, der Kreis und Legacys
 * Listen“, Betreiber 2026-10-10: „die sind wichtig für jegliche art von listen“).
 *
 * Legacy hat keine Medienverwaltung und damit keine Regel für diese Liste. Übernommen ist deshalb Legacys ALLGEMEINE Bedeutung des
 * Kreises („voll = fertig · halb = da, aber nicht verbunden · leer = nicht auf der Karte“, `css/components/map-status-circle.css:19-21`
 * an cfbbe69c8), übertragen auf ein Medium - was für einen Ort „auf der Karte“ ist, ist für ein Bild „öffentlich zu sehen“:
 *
 * - ○ **leer:** unbenutzt, kein Fachobjekt verwendet das Medium.
 * - ◐ **halb:** verwendet, aber nicht öffentlich (keine Datei unter `published/`, ein Notaus, oder die Policy gibt die Verwendung nicht
 *   frei).
 * - ● **voll:** verwendet und öffentlich.
 *
 * 🚩 Die Übertragung ist ein Vorschlag (WI-0068 §18 „P3 Stand“, Abweichung A3), keine Betreiberentscheidung; die Legende im Fuß nennt sie.
 */
export type Fuellung = "leer" | "halb" | "voll";

/** Der Kreis eines Assets in Liste und Raster. */
export function kreisDesAssets(asset: Pick<MamAssetSummary, "usageCount" | "published" | "suspended">): Fuellung {
    if (asset.usageCount === 0) return "leer";
    return asset.published && !asset.suspended ? "voll" : "halb";
}

/**
 * Der Kreis einer Verwendung im Inspector: die Entscheidung der Policy für genau diese Stelle (`publication`). Ein Galerieeintrag ohne
 * Bindung hat keine Stelle, an der er erschiene, und bleibt leer.
 */
export function kreisDerVerwendung(usage: Pick<MediaUsage, "publication">): Fuellung {
    if (usage.publication === null) return "leer";
    return usage.publication.public ? "voll" : "halb";
}

/** Der Name des Kreises für Vorleser und die Legende. */
export function kreisName(fuellung: Fuellung): string {
    return t(`medien.kreis.${fuellung}`);
}

/** Die Legende in der Reihenfolge von „nichts“ nach „alles“ (Guide §13.17: eine Legende, kein Tooltip). */
export const KREIS_LEGENDE: readonly Fuellung[] = ["leer", "halb", "voll"];
