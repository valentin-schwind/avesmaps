import type { WetterSymbolArt } from "@avesmaps3d/shared";

/**
 * Welches Wetter-Icon unter einem Bildpunkt der Karte liegt, für das Kartenmenü der Editoren (WI-0288; Handgriffe in
 * `editor-menu/handgriffe-wetter.ts`). Die Symbolebene liegt im nachgeladenen Teil des Wetters (`wetter-symbole.ts`); sie meldet hier ihre Suche an,
 * sobald sie steht. So fragt das Kartenmenü, ohne den Teil zu laden: Ohne Ebene liegt dort kein Icon.
 *
 * Getroffen wird nur, was gerade gezeichnet ist (im Wetter-Editor alle Icons, sonst die gezeigten, solange ihr Schalter im Auge an ist), an der
 * Scheibe und im Editor auch an den Griffen des gewählten, das oberste zuerst.
 */

export interface WetterIconUnter {
    readonly id: string;
    /** Der Name, leer ohne Namen. */
    readonly name: string;
    readonly art: WetterSymbolArt;
}

type Suche = (px: number, py: number) => WetterIconUnter | undefined;

let suche: Suche | undefined;

/** Die Symbolebene meldet ihre Suche an; zurück kommt das Abmelden. */
export function meldeWetterIconSuche(neu: Suche): () => void {
    suche = neu;
    return () => {
        if (suche === neu) suche = undefined;
    };
}

/** Das Icon unter dem Bildpunkt (Koordinaten der Karte), oder `undefined`. */
export const wetterIconAm = (px: number, py: number): WetterIconUnter | undefined => suche?.(px, py);
