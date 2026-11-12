import { describe, expect, it } from "vitest";
import { createPropertyExpression, type SymbolLayerSpecification } from "@maplibre/maplibre-gl-style-spec";
import { COLLISION_RANK_PROPERTY, MISSING_RANK, composeView, DEFAULT_LANDSCAPE_SELECTION } from "@avesmaps3d/shared";
import { buildPlaceLayers } from "../src/map/place-layers.ts";
import { propertySpec } from "./style-spec.ts";

/**
 * Eine Kette, drei Layer (WI-0007).
 *
 * 💣 Vorher stand an den drei Beschriftungslayern DREIERLEI: die Ortsnamen sortierten ueber ein
 * Klassenliteral im Frontend, Kurven- und Punktlabels ueber den rohen `label_priority` - und
 * letzteres verkehrt herum, weil Legacy absteigend sortiert und MapLibre den niedrigeren Wert
 * zuerst platziert. Diese Tests halten fest, dass alle drei jetzt dieselbe Zahl aus der Kachel
 * lesen und keiner wieder eine eigene Skala mitbringt.
 *
 * 🪤 Gemessen wird mit MapLibres eigenem Auswerter, nicht durch einen Vergleich der
 * Ausdrucks-Arrays. Ein Array-Vergleich waere gruen, solange die Form stimmt, und wuerde nicht
 * merken, wenn der Ausdruck etwas anderes RECHNET.
 */

const STANDARD = { labels: true, composition: composeView("standard", DEFAULT_LANDSCAPE_SELECTION) };
const LANDSCAPES = { labels: true, composition: composeView("landscapes", "alle") };

/** Alle Layer, die Text setzen und deshalb um Platz konkurrieren. */
function symbolLayers() {
    const layers = [...buildPlaceLayers(STANDARD), ...buildPlaceLayers(LANDSCAPES)];
    // 🪤 Nach TEXT gefiltert, nicht nach Layertyp: die Bauwerksraute (WI-0011) ist ein Symbol ohne
    // Text und nimmt ausdruecklich an keiner Kollision teil (icon-ignore-placement).
    return layers.filter(
        (layer): layer is SymbolLayerSpecification =>
            layer.type === "symbol" && layer.layout?.["text-field"] !== undefined,
    );
}

function evaluateSortKey(layer: { layout?: Record<string, unknown> }, properties: Record<string, unknown>): number {
    // Die Spezifikation kommt aus MapLibre selbst, nicht aus einer eigenen Beschreibung: so
    // gelten dieselben Regeln, die der Renderer anwendet.
    const compiled = createPropertyExpression(
        layer.layout?.["symbol-sort-key"],
        "symbol-sort-key",
        propertySpec("layout_symbol", "symbol-sort-key"),
    );
    if (compiled.result !== "success") {
        throw new Error(`kein gueltiger symbol-sort-key: ${JSON.stringify(compiled.value)}`);
    }
    return compiled.value.evaluate({ zoom: 4 }, { type: "Point", properties } as never) as number;
}

describe("Kollisionsrang im Style", () => {
    it("🔴 laesst JEDEN Beschriftungslayer ueber dieselbe Eigenschaft sortieren", () => {
        const layers = symbolLayers();
        // Weniger als drei hiesse: ein Layer ist aus dem Stil gefallen und der Test misst Luft.
        expect(layers.length, "Ortsnamen, Punktlabels und Schriftlauf").toBeGreaterThanOrEqual(3);

        for (const layer of layers) {
            const raw = JSON.stringify(layer.layout?.["symbol-sort-key"] ?? null);
            expect(raw, `${layer.id} sortiert nicht ueber ${COLLISION_RANK_PROPERTY}`).toContain(
                COLLISION_RANK_PROPERTY,
            );
            // 💣 Die alte Skala darf nirgends mehr auftauchen - sonst liefe eine zweite Rangfolge
            // neben der Kette her, und bei einer Aenderung waeren zwei Orte zu pflegen.
            expect(raw, `${layer.id} liest noch label_priority`).not.toContain("label_priority");
            expect(raw, `${layer.id} liest noch die Klasse`).not.toContain("subtype");
        }
    });

    it("🔴 gibt den Rang unveraendert durch: klein gewinnt", () => {
        for (const layer of symbolLayers()) {
            expect(evaluateSortKey(layer, { [COLLISION_RANK_PROPERTY]: 201 })).toBe(201);
            expect(evaluateSortKey(layer, { [COLLISION_RANK_PROPERTY]: 202 })).toBe(202);
        }
    });

    it("🪤 stellt ein Feature OHNE Rang hinten an, statt es vorzulassen", () => {
        // Ein Rang, der fehlt, ist ein Fehler in der Kachel. Mit 0 als Rueckfall wuerde ausgerechnet
        // das kaputte Feature alle anderen verdraengen - der Fehler waere maximal sichtbar und
        // maximal falsch.
        for (const layer of symbolLayers()) {
            expect(evaluateSortKey(layer, {})).toBe(MISSING_RANK);
            expect(evaluateSortKey(layer, {})).toBeGreaterThan(evaluateSortKey(layer, { collision_rank: 70_200 }));
        }
    });
});

describe("Ausweichstellen der Kurvennamen (Migration 0110)", () => {
    it("🔴 versucht innerhalb eines Rangs die Mitte zuerst und springt nie über einen fremden Rang", () => {
        // Betreiber 2026-10-11: „kannst du nicht versuchen etwas auszuweichen, wenn du schon längere läufe baust?“ Die Kachel liefert
        // je Einzellauf bis zu fünf sich überdeckende Kandidaten, `candidate` 0 ist die Mitte (wie die Wegnamen, 0030).
        const laeufe = symbolLayers().filter((layer) => layer.id.startsWith("landscape-label-run"));
        expect(laeufe.length, "die Schriftlauf-Layer sind im Stil").toBeGreaterThan(0);
        for (const layer of laeufe) {
            const mitte = evaluateSortKey(layer, { [COLLISION_RANK_PROPERTY]: 201, candidate: 0 });
            const weitester = evaluateSortKey(layer, { [COLLISION_RANK_PROPERTY]: 201, candidate: 4 });
            const naechsterRang = evaluateSortKey(layer, { [COLLISION_RANK_PROPERTY]: 202, candidate: 0 });
            expect(mitte, `${layer.id}: die Mitte zuerst`).toBeLessThan(weitester);
            expect(weitester, `${layer.id}: kein Kandidat springt über den nächsten Rang`).toBeLessThan(naechsterRang);
        }
    });
});
