import type { EntwurfsBeschriftung } from "../map/entwurfs-beschriftungen";
import type { LandschaftBearbeitung } from "./landschaftseditor-steuerung";

/**
 * Welche Beschriftungen der Derographie die Karte an ihrer Lage im Entwurf zeigt (WI-0178 C4; Betreiber 2026-10-18: „kannst du nach
 * "Verschieben beenden" auch das label korrekt positionieren? unabhängig von "fertig" machen“), über den Baustein
 * `map/entwurfs-beschriftungen.ts`: jede Beschriftung eines Landschaftsfensters, deren Entwurf sie verschoben hat, mit dem Text des
 * Entwurfs. Auch abgelegte Fenster zählen, wie bei den Flächen (`entwurf-ebene.ts`): Ihr Entwurf ist nicht verworfen.
 */
export interface GezogeneBeschriftung extends EntwurfsBeschriftung {
    /** Die Landschaft, zu der sie gehört. */
    readonly landschaft: string;
}

export function gezogeneBeschriftungen(
    bearbeitungen: readonly (LandschaftBearbeitung | undefined)[],
): GezogeneBeschriftung[] {
    const raus: GezogeneBeschriftung[] = [];
    for (const bearbeitung of bearbeitungen) {
        const detail = bearbeitung?.detail.value;
        const stand = bearbeitung?.stand.value;
        if (detail === undefined || stand === undefined) continue;
        for (const label of detail.labels) {
            const felder = stand.felder.labels[label.id];
            const x = felder?.x ?? label.x;
            const y = felder?.y ?? label.y;
            if (felder === undefined || (x === label.x && y === label.y)) continue;
            const text = felder.followName ? stand.felder.name : label.text;
            raus.push({ id: label.id, landschaft: detail.id, x, y, text });
        }
    }
    return raus;
}

/**
 * Die Beschriftungen, die mit einer Speicherung aus dem Entwurf fielen: Sie stehen weiter an der neuen Lage, bis die Kachel nachkommt
 * (`halte`). Was mit Verwerfen fiel, springt zurück: Dessen Landschaft ist nicht gespeichert.
 */
export function gespeicherteBeschriftungen(
    vorher: readonly GezogeneBeschriftung[],
    jetzt: readonly GezogeneBeschriftung[],
    gespeichert: (landschaft: string) => boolean,
): GezogeneBeschriftung[] {
    const bleiben = new Set(jetzt.map((b) => b.id));
    return vorher.filter((b) => !bleiben.has(b.id) && gespeichert(b.landschaft));
}
