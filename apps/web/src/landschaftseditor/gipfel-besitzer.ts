import type { MapGeoJSONFeature } from "maplibre-gl";
import { INTERACTION_PRIORITY } from "../map/interaction/priorities";
import type { Claim, InteractionOwner, Screen } from "../map/interaction/types";
import type { PointerHint } from "../map/pointer-hint";
import { NODIX_HIT_LAYER_ID } from "../map/powerline-layers";
import { PEAK_LAYER_ID } from "../map/topography-layers";
import { landmarkenartName } from "./landschaften-liste";

/**
 * Gipfel und Vulkane auf der Karte anklickbar (WI-0178 P2; Betreiber über Claudio 2026-10-18: „es gibt keine möglichkeit berge zu
 * verschieben, weil man kann nicht draufklicken :)“; Regel 2026-10-04 „Was auf der Karte ist, ist anklickbar“). Ein Besitzer beim
 * Koordinator mit eigenem Rang (`peak` in `map/interaction/priorities.ts`): Das ▲ geht der Fläche darunter vor, ein Ort darüber ihm.
 *
 * - **Klick** wählt den Gipfel (`select`): das Infopanel, im Editor-Modus das Derographie-Fenster an ihm (`landschaftseditor.geoeffnet`).
 * - **Rechtsklick** (am Finger der lange Druck) wählt ihn auch und öffnet danach das Kartenmenü (`menu`), wie am Ort.
 * - **Zeigen:** das Zeiger-Schild mit Name und Art.
 * Die Ebene `gipfel` steht nur, wo die Ansicht Gipfel zeigt (`composeView`); sonst nimmt der Besitzer nichts.
 */
export interface GipfelAufKarte {
    readonly id: string;
    readonly name: string;
    readonly subtype: string;
    /** Wo das Zeichen steht (Renderkoordinaten der Kachel), für „Ziel hinzufügen“ im Kartenmenü (WI-0271 L6); fehlt ohne Punktgeometrie. */
    readonly lngLat?: { readonly lng: number; readonly lat: number };
}

interface GipfelClaim extends Claim {
    readonly feature: MapGeoJSONFeature;
}

const gipfelVon = (feature: MapGeoJSONFeature): GipfelAufKarte => ({
    id: String(feature.properties["public_id"] ?? ""),
    name: String(feature.properties["name"] ?? ""),
    // Als Knoten der Kraftlinien trägt die Kachel nur die Größenklasse, nicht die Art.
    subtype: feature.properties["node_kind"] === "landmark" ? "" : String(feature.properties["subtype"] ?? ""),
    ...(feature.geometry.type === "Point"
        ? { lngLat: { lng: feature.geometry.coordinates[0] ?? 0, lat: feature.geometry.coordinates[1] ?? 0 } }
        : {}),
});

export function gipfelBesitzer(input: {
    select: (gipfel: GipfelAufKarte, at: Screen) => void;
    menu?: (gipfel: GipfelAufKarte, at: Screen, lngLat: { lng: number; lat: number }) => void;
    hover?: (hint: PointerHint | undefined) => void;
    /** Ein Umschalt-Klick: `true`, wenn ein offenes Editor-Fenster das Objekt zusätzlich aufnahm (WI-0209); sonst fällt er durch. */
    umschalt?: (id: string) => boolean;
}): InteractionOwner<GipfelClaim> {
    return {
        id: "peak",
        priority: INTERACTION_PRIORITY.peak,
        kinds: ["click", "hover", "contextmenu"],
        layers: () => [PEAK_LAYER_ID, NODIX_HIT_LAYER_ID],
        hit(context) {
            // In der Kraftlinien-Ansicht ist eine Landmarke ein Knoten (WI-0271 §17), anklickbar wie ein Nodix-Ort (`owners.ts`).
            const feature =
                context.features([PEAK_LAYER_ID])[0] ??
                context.features([NODIX_HIT_LAYER_ID]).find((knoten) => knoten.properties["node_kind"] === "landmark");
            return feature === undefined || gipfelVon(feature).id === "" ? undefined : { feature, cursor: "pointer" };
        },
        umschalt: ({ feature }) => input.umschalt?.(gipfelVon(feature).id) === true,
        apply(kind, { feature }, context) {
            const gipfel = gipfelVon(feature);
            if (kind === "hover") {
                input.hover?.(
                    gipfel.name === ""
                        ? undefined
                        : {
                              name: gipfel.name,
                              type: landmarkenartName(gipfel.subtype),
                              screen: context.screen,
                          },
                );
                return;
            }
            if (kind !== "click" && kind !== "contextmenu") return;
            input.select(gipfel, context.screen);
            if (kind === "contextmenu") {
                context.event.preventDefault();
                input.menu?.(gipfel, context.screen, context.lngLat);
            }
        },
        lost() {
            input.hover?.(undefined);
        },
    };
}
