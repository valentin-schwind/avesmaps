import type { Map as MapLibreMap } from "maplibre-gl";
import { AVENTURIA, fromRenderLngLat } from "@avesmaps3d/shared";
import { INTERACTION_PRIORITY } from "./interaction/priorities";
import type { InteractionOwner, MapInteractionCoordinator } from "./interaction/types";

/**
 * Einen Ort, der noch nicht auf der Karte steht, auf die Karte setzen (WI-0128 E16; Betreiber 2026-10-11: „was ein cooles feature wär.
 * wenn man einen ort aus der liste per drag and drop auf die karte ziehen könnte.“). Zwei Wege, beide liefern einen Kartenpunkt (MCS):
 *
 * - **Ziehen aus der Liste** (`installPlaceDrop`): Die Zeile trägt ihren Schlüssel unter `ORT_ZIEHEN_TYP`; die Karte nimmt ihn an,
 *   wo der Mauszeiger losgelassen wird. Nur Zeilen, die noch nicht auf der Karte stehen, sind ziehbar (Betreiber: „natürlich darf man
 *   nur orte auf die karte ziehen, die noch nicht auf der karte sind“); das entscheidet die Liste, hier wird nur der Typ geprüft.
 * - **„● Auf der Karte setzen“** (`installPlaceSet`): ein Modus, solange er läuft, gehört der nächste Klick auf die Karte ihm (Besitzer
 *   `place-set`, über dem Verschieben), mit Fadenkreuz. Esc beendet ihn (die Steuerung, `ort-setzen.ts`).
 */

/** Der Datentyp beim Ziehen einer Zeile der Ortsliste: ihr Schlüssel. */
export const ORT_ZIEHEN_TYP = "application/x-avesmaps-ort";

const space = AVENTURIA.coordinateSpace;

export interface KartenPunkt {
    readonly x: number;
    readonly y: number;
}

/** Die Karte nimmt gezogene Zeilen an. `annehmen` sagt, ob gerade gesetzt werden darf. Gibt das Abmelden zurück. */
export function installPlaceDrop(
    map: MapLibreMap,
    optionen: { annehmen: () => boolean; abgelegt: (key: string, punkt: KartenPunkt) => void },
): () => void {
    const container = map.getCanvasContainer();
    const traegtOrt = (event: DragEvent): boolean => event.dataTransfer?.types.includes(ORT_ZIEHEN_TYP) === true;
    const ueber = (event: DragEvent): void => {
        if (!traegtOrt(event) || !optionen.annehmen()) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const ab = (event: DragEvent): void => {
        if (!traegtOrt(event) || !optionen.annehmen()) return;
        const key = event.dataTransfer?.getData(ORT_ZIEHEN_TYP) ?? "";
        if (key === "") return;
        event.preventDefault();
        const rahmen = container.getBoundingClientRect();
        const punkt = fromRenderLngLat(space, map.unproject([event.clientX - rahmen.left, event.clientY - rahmen.top]));
        optionen.abgelegt(key, { x: punkt.x, y: punkt.y });
    };
    container.addEventListener("dragover", ueber);
    container.addEventListener("drop", ab);
    return () => {
        container.removeEventListener("dragover", ueber);
        container.removeEventListener("drop", ab);
    };
}

interface SetClaim {
    readonly cursor?: string;
}

/** Der Modus „● Auf der Karte setzen“: Der nächste Klick auf die Karte setzt den Ort. */
export function installPlaceSet(
    interaction: MapInteractionCoordinator,
    gesetzt: (punkt: KartenPunkt) => void,
): { aus(): void } {
    const owner: InteractionOwner<SetClaim> = {
        id: "place-set",
        priority: INTERACTION_PRIORITY["place-set"],
        kinds: ["click", "hover"],
        layers: () => [],
        hit(context) {
            return context.kind === "hover" ? { cursor: "crosshair" } : {};
        },
        apply(kind, _claim, context) {
            if (kind !== "click") return;
            const punkt = fromRenderLngLat(space, context.lngLat);
            gesetzt({ x: punkt.x, y: punkt.y });
        },
    };
    const abmelden = interaction.register(owner);
    let aktiv = true;
    return {
        aus() {
            if (!aktiv) return;
            aktiv = false;
            abmelden();
        },
    };
}
