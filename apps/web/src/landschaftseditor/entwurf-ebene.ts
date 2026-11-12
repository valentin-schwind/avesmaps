import { cartographyForType } from "@avesmaps3d/shared";
import type { EntwurfsFlaeche } from "../map/entwurfs-flaechen";
import type { LandschaftBearbeitung } from "./landschaftseditor-steuerung";

/**
 * Welche Flächen der Derographie die Karte als Entwurf zeichnet (WI-0178; Betreiber 2026-10-18: „A (Empfehlung)“ auf „Was zeigt die
 * Karte, während eine Fläche im Entwurf die Ebene wechselt?“): jede Fläche eines Landschaftsfensters, deren Entwurf eine andere Ebene
 * oder Art trägt als gespeichert, in der Ebene und Farbe des Entwurfs (`map/entwurfs-flaechen.ts`), bis „Fertig“ oder Verwerfen. Auch
 * abgelegte Fenster zählen: Ihr Entwurf ist nicht verworfen (Weg des Funds „Tal am Donnerkessel“, Claudio ca058e4db: Ein Klick auf
 * „Bragensrode“ legte das Tal samt Entwurf ab, und die Karte blieb in der Vegetation).
 *
 * Die Umrisse sind die gespeicherten; ändert der Entwurf auch die Form, zeichnet der Modus „Ecken bearbeiten“ sie ohnehin, und hier stehen
 * ihre Ringe je für sich (ohne Löcher).
 */
export function entwurfsFlaechen(bearbeitungen: readonly (LandschaftBearbeitung | undefined)[]): EntwurfsFlaeche[] {
    const raus: EntwurfsFlaeche[] = [];
    for (const bearbeitung of bearbeitungen) {
        const detail = bearbeitung?.detail.value;
        const stand = bearbeitung?.stand.value;
        if (detail === undefined || stand === undefined) continue;
        const { ebene, art } = stand.felder;
        if (ebene === detail.layer && art === detail.type) continue;
        const eigene = new Set(detail.areas.map((area) => area.id));
        const polygone =
            stand.form === undefined
                ? detail.areas.flatMap((area) => area.polygons)
                : stand.form.teile
                      .filter((teil) => eigene.has(teil.objekt))
                      .map((teil) => [teil.punkte.map((p) => [p.x, p.y] as const)]);
        raus.push({ id: detail.id, ebene, farbe: cartographyForType(art).fill, polygone });
    }
    return raus;
}
