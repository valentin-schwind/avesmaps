import type { Map as MapLibreMap } from "maplibre-gl";
import type { EditorMenuSubject } from "../editor-menu/action";
import type { Screen } from "../map/interaction/types";
import { NODIX_HIT_LAYER_ID, POWERLINE_HIT_LAYER_ID } from "../map/powerline-layers";
import { distinctPowerlines, tileCandidates, type PowerlineCandidate } from "../map/powerline-selection-input";

/**
 * Die Kraftlinien unter einem Punkt der Karte, für Rechtsklick und Doppelklick der Editoren (WI-0205 K3; EDIT-0003 T25, R3): dieselbe
 * Antwort wie der Klick des Besitzers `powerline` (`map/powerline-selection-input.ts`). Wo die Bögen gezeichnet sind, die Linie, wie sie
 * im Bild steht (`gezeichnet`), sonst die Trefferfläche der Kacheln; je Linie einmal, die nächste zuerst. Ohne die Ansicht „Kraftlinien“
 * (`sichtbar`) keine, wie beim Klick.
 */
export function kraftlinienAm(
    map: MapLibreMap,
    punkt: Screen,
    eingabe: {
        readonly sichtbar: boolean;
        readonly reichweite: number;
        readonly gezeichnet?:
            ((punkt: Screen, reichweite: number) => readonly PowerlineCandidate[] | undefined) | undefined;
    },
): PowerlineCandidate[] {
    if (!eingabe.sichtbar) return [];
    const gezeichnet = eingabe.gezeichnet?.(punkt, eingabe.reichweite);
    if (gezeichnet !== undefined) return distinctPowerlines(gezeichnet);
    if (map.getLayer(POWERLINE_HIT_LAYER_ID) === undefined) return [];
    return tileCandidates(map.queryRenderedFeatures([punkt.x, punkt.y], { layers: [POWERLINE_HIT_LAYER_ID] }));
}

/**
 * Der Kraftlinienpunkt unter einem Punkt der Karte, für den Rechtsklick der Editoren (WI-0205 K10, EDIT-0003 T52): die Trefferfläche der
 * Knoten an genau dieser Stelle, nur ein Knoten der Art `nodix` (ein Nodix-Ort ist ein Ort, `map/interaction/owners.ts`). Wo die Knoten
 * nicht gezeichnet sind (eine andere Ansicht), keiner.
 */
export function kraftlinienpunktAm(map: MapLibreMap, punkt: Screen): string | undefined {
    if (map.getLayer(NODIX_HIT_LAYER_ID) === undefined) return undefined;
    const knoten = map
        .queryRenderedFeatures([punkt.x, punkt.y], { layers: [NODIX_HIT_LAYER_ID] })
        .find((f) => f.properties["node_kind"] === "nodix");
    const id = String(knoten?.properties["public_id"] ?? "");
    return id === "" ? undefined : id;
}

/** Ein Kraftlinienpunkt als Gegenstand der Handgriffe (nur des Editor-Menüs, `KraftlinienpunktRef`); `titel` in der Sprache der Seite. */
export function kraftlinienpunktSubjekt(id: string, titel: string): EditorMenuSubject {
    return { ref: { kind: "kraftlinienpunkt", id }, title: titel, art: undefined, answer: undefined };
}

/**
 * Eine Kraftlinie als Gegenstand der Handgriffe: Der Anker ist der getroffene Abschnitt (der Server nennt die Linie unter ihrem
 * kleinsten Abschnitt). `titel` und `art` stehen schon in der Sprache der Seite; eine namenlose heißt nach ihrer Art.
 */
export function kraftlinieSubjekt(linie: PowerlineCandidate, art: string): EditorMenuSubject {
    return {
        ref: { kind: "powerline", anchor: linie.id },
        title: linie.name === "" ? art : linie.name,
        art,
        answer: undefined,
    };
}
