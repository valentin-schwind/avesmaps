import { DESIGN_CANON } from "@avesmaps3d/shared";

import { coveredInsets, measureOverlays, type Box } from "./camera/visible-area";
import {
    arrangeLabels,
    type LabelSide,
    type LabelSpot,
    type PlacementOptions,
    type Rect,
} from "./route-border-label-placement";

/**
 * Was jeder Kartentooltip für seine Platzierung braucht (Guide §15.3): der Platz, den die Karte frei lässt, die Maße aus
 * dem Kanon und die Wahl der Seite für ein einzelnes Schild. Die Hülle (`map-tooltip.vue`) kennt nur das Aussehen.
 */

/** Der sichtbare Teil der Karte: das Fenster oder die Karte, ohne die Fläche, die ein Panel deckt (der offene Planer). */
export function mapTooltipViewport(
    box: Box = { left: 0, top: 0, width: globalThis.innerWidth, height: globalThis.innerHeight },
): Rect {
    const insets = coveredInsets(box, measureOverlays(document));
    return {
        left: box.left + insets.left,
        top: box.top + insets.top,
        right: box.left + box.width - insets.right,
        bottom: box.top + box.height - insets.bottom,
    };
}

/** Die Maße der Platzierung: Spitze und Pfeil aus dem Kanon, die halbe Breite der Marke, der freie Platz. */
export function mapTooltipOptions(viewport: Rect, markerRadius: number): PlacementOptions {
    const tip = DESIGN_CANON.tooltip;
    return { lift: tip.offset, arrow: tip.arrow, markerRadius, viewport };
}

/**
 * Die Seite für EIN Schild an einem Punkt (der Zeiger, eine Marke): darüber, wenn dort Platz ist, sonst die Seite mit der
 * kleinsten Überdeckung des Randes. Mehrere Schilder rechnet `arrangeLabels` gemeinsam.
 */
export function pickTooltipSide(spot: LabelSpot, viewport: Rect, markerRadius = 0): LabelSide {
    return arrangeLabels([spot], mapTooltipOptions(viewport, markerRadius)).sides[0] ?? "top";
}
