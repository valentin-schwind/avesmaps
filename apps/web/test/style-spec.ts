import { latest, type LayerSpecification, type StylePropertySpecification } from "@maplibre/maplibre-gl-style-spec";
import { PLACE_LABEL_LAYER_IDS } from "../src/map/place-layers.ts";

/**
 * Typisierter Zugriff auf MapLibres Stilspezifikation in den Tests (WI-0022).
 *
 * Die Layerbauer liefern `LayerSpecification`, also die Vereinigung aller Bauarten. Welche
 * Eigenschaften ein Layer trägt, weiß TypeScript erst, wenn seine Bauart feststeht.
 */

type LayerType = LayerSpecification["type"];
type LayerOf<T extends LayerType> = Extract<LayerSpecification, { type: T }>;

/**
 * Wo die Ortsnamen im Stapel stehen: seit WI-0135 je Klasse und Seite eine Ebene. `erste` liegt am weitesten unten,
 * `letzte` am weitesten oben; -1, wenn der Stil keine trägt.
 */
export function ortsnamenImStapel(ids: readonly string[]): { erste: number; letzte: number } {
    const lagen = PLACE_LABEL_LAYER_IDS.map((id) => ids.indexOf(id)).filter((index) => index >= 0);
    return lagen.length === 0 ? { erste: -1, letzte: -1 } : { erste: Math.min(...lagen), letzte: Math.max(...lagen) };
}

/** Den Layer mit dieser Id und dieser Bauart; `undefined`, wenn es ihn so nicht gibt. */
export function findLayer<T extends LayerType>(
    layers: readonly LayerSpecification[],
    id: string,
    type: T,
): LayerOf<T> | undefined {
    return layers.find((layer): layer is LayerOf<T> => layer.id === id && layer.type === type);
}

/** Einen Layer auf seine Bauart festlegen. Eine andere ist ein Fehler im Stil und bricht den Test ab. */
export function asLayer<T extends LayerType>(layer: LayerSpecification, type: T): LayerOf<T> {
    if (layer.type !== type) {
        throw new Error(`${layer.id} ist ein ${layer.type}-Layer, erwartet war ${type}`);
    }
    return layer as LayerOf<T>;
}

/**
 * MapLibres Spezifikation einer Eigenschaft, etwa `propertySpec("layout_symbol", "text-size")`.
 *
 * 🪤 `latest` ist aus `v8.json` abgeleitet und kennt deshalb nur `type: string`; die Auswerter
 * verlangen die Unionsform `StylePropertySpecification`. Die Umwandlung steht einmal hier statt an
 * jeder Aufrufstelle, und eine unbekannte Eigenschaft scheitert laut statt mit `undefined`.
 */
export function propertySpec(group: string, property: string): StylePropertySpecification {
    const groups = latest as unknown as Record<string, Record<string, StylePropertySpecification> | undefined>;
    const spec = groups[group]?.[property];
    if (!spec) {
        throw new Error(`${group}.${property} steht nicht in MapLibres Stilspezifikation`);
    }
    return spec;
}
