import { rasterTileTemplate } from "@avesmaps3d/shared";
import { loadRasterPointer } from "../map/basemap";

/**
 * Kacheln einer Serie für den Reiter „Kartenserien“ (WI-0220): Übersicht (Stufe 0), Bild im Fächer (Stufe 5) und die Karte der
 * Ausschnittwahl (Stufe 2). Die Adresse kommt aus dem Zeiger der Pyramide (`current.json`, ADR-0008), einmal je Serie gelesen.
 */

const vorlagen = new Map<string, Promise<string | null>>();

/** Die Vorlage `…/{z}/{x}/{y}.webp` einer Serie; ohne Pyramide `null`. */
export function kachelVorlage(seriesId: string): Promise<string | null> {
    let vorlage = vorlagen.get(seriesId);
    if (vorlage === undefined) {
        vorlage = loadRasterPointer(seriesId).then(
            (zeiger) => rasterTileTemplate(zeiger),
            () => null,
        );
        vorlagen.set(seriesId, vorlage);
    }
    return vorlage;
}

export function kachelUrl(vorlage: string, z: number, x: number, y: number): string {
    return vorlage.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}

/** Nach einem Ersetzen neu lesen (Schnitt 3). */
export function vergissVorlage(seriesId: string): void {
    vorlagen.delete(seriesId);
}
