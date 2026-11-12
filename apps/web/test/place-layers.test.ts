import { afterEach, describe, expect, it, vi } from "vitest";
import { ladeStartansicht } from "../src/map/start-view.ts";
import { createPropertyExpression, featureFilter, type LayerSpecification } from "@maplibre/maplibre-gl-style-spec";
import {
    AVENTURIA_ZOOM_BANDS,
    BAND_COUNT,
    canonColour,
    DESIGN_CANON,
    POINTS_TO_PIXELS,
    renderZoomForBand,
} from "@avesmaps3d/shared";
import { composeView, DEFAULT_LANDSCAPE_SELECTION } from "@avesmaps3d/shared";
import { readFileSync } from "node:fs";
import {
    buildPlaceLayers,
    drawStructureMarkerImage,
    MARKER_COLLISION_IMAGE_HALF,
    markerExtent,
    PLACE_APPROXIMATE_LAYER_ID,
    PLACE_SELECTION_LAYER_ID,
    PLACE_ACTIVE_LABEL_LAYER_IDS,
    PLACE_CLASSES_BY_RANK,
    PLACE_COLLISION_LAYER_IDS,
    PLACE_LABEL_LAYER_IDS,
    placeActiveLabelLayerId,
    placeCollisionLayerId,
    placeLabelLayerId,
    STRUCTURE_IMAGE_OUTER,
    STRUCTURE_MARKER_LAYER_ID,
    volleMarkeAb,
} from "../src/map/place-layers.ts";
import { NODIX_HIT_LAYER_ID } from "../src/map/powerline-layers.ts";
import { ortsreihen, zoombaenderSetzen, zoomspanne } from "../src/map/zoombaender-stand.ts";
import { findLayer, propertySpec } from "./style-spec.ts";

/**
 * Die wirksamen Reihen (WI-0221): die Größen der Tafel, gekürzt auf die Spannen der Zoombänder. Ohne Abweichung gilt Legacys
 * gespeicherter Stand (F3 vom 2026-10-10, MCS-032): Marker und Namen meist ein bis zwei Bänder später als die Tafel.
 */
const REIHEN = ortsreihen();
const zeichenAb = (klasse: string): number => zoomspanne(`orte.${klasse}.zeichen`).von;
const nameAb = (klasse: string): number => zoomspanne(`orte.${klasse}.name`).von;

/**
 * Diese Tests messen Orte und ihre Namen - das ist die Standardansicht (WI-0009). Seit dem
 * Kartenfaecher muss der Stil wissen, welche Ansicht er baut; ein Vorgabewert waere hier eine
 * stille Annahme darueber, was „normal" ist.
 */
const STANDARD = { labels: true, composition: composeView("standard", DEFAULT_LANDSCAPE_SELECTION) };

/**
 * The zoom bands are the cartographic definition; how they reach the screen is a rendering
 * question. These tests answer it with MapLibre's own expression evaluator instead of a
 * reimplementation of it, because the point is what the renderer does, not what we think it does.
 */

const markerLayer = buildPlaceLayers(STANDARD).find((layer) => layer.id === "place-marker");
if (!markerLayer || markerLayer.type !== "circle") {
    throw new Error("the marker layer is missing from the style");
}

/** Alle Namensebenen teilen Schrift und Größe (WI-0135); diese steht für sie, wo es nur um die Schrift geht. */
const labelLayer = buildPlaceLayers(STANDARD).find((layer) => layer.id === placeLabelLayerId("dorf", "right"));
if (!labelLayer || labelLayer.type !== "symbol") {
    throw new Error("the label layer is missing from the style");
}

const evaluator = (property: "circle-radius" | "circle-stroke-width") => {
    const expression = markerLayer.paint?.[property];
    const compiled = createPropertyExpression(expression, property, propertySpec("paint_circle", property));
    if (compiled.result !== "success") {
        throw new Error(`${property} is not a valid MapLibre expression: ${JSON.stringify(compiled.value)}`);
    }
    return (zoom: number, subtype: string): number =>
        compiled.value.evaluate({ zoom }, { type: "Point", properties: { subtype } } as never) as number;
};

const radiusAt = evaluator("circle-radius");
const admits = (() => {
    const compiled = featureFilter(markerLayer.filter, "filter");
    return (zoom: number, subtype: string, extra: Record<string, unknown> = {}): boolean =>
        compiled.filter({ zoom }, { type: 1, properties: { subtype, ...extra } } as never, undefined as never);
})();

/** Kern je Außendurchmesser: Legacy teilt den Durchmesser in Kern und Kontur (die Kontur liegt INNEN). */
const KONTUR = (AVENTURIA_ZOOM_BANDS.spacing["kontur"] ?? 0) / 100;
const kern = (diameter: number): number => diameter / 2 / (1 + KONTUR);

describe("marker size across the zoom bands", () => {
    it("💣 der Bandwert ist der AUSSENdurchmesser: Kern + Kontur, nicht Kern + Kontur obendrauf", () => {
        // Hier stand der halbe Außendurchmesser als Kern, und MapLibre legte die Kontur außen
        // herum: jeder Marker ein Drittel zu groß. Legacy: `avesmapsLocationMarkerContourSplit`.
        const strokeAt = evaluator("circle-stroke-width");
        for (const [subtype, series] of Object.entries(REIHEN.marker)) {
            for (let band = 0; band < BAND_COUNT; band += 1) {
                const diameter = series[band];
                if (diameter === null || diameter === undefined) {
                    continue;
                }
                const zoom = renderZoomForBand(band);
                const aussen = radiusAt(zoom, subtype) + strokeAt(zoom, subtype);
                // Die Kontur hat eine Untergrenze von 0,5 px; nur bei sehr kleinen Markern greift sie.
                expect(aussen, `${subtype} auf Band ${band}`).toBeCloseTo(
                    Math.max(diameter / 2, kern(diameter) + 0.5),
                    10,
                );
            }
        }
    });

    it("hits the exact band value on every integer Avesmaps zoom", () => {
        // This is the part that must not drift: the band table is the cartographic definition, and
        // interpolation is only allowed to fill the space between its values.
        for (const [subtype, series] of Object.entries(REIHEN.marker)) {
            for (let band = 0; band < BAND_COUNT; band += 1) {
                const diameter = series[band];
                if (diameter === null || diameter === undefined) {
                    continue;
                }
                expect(radiusAt(renderZoomForBand(band), subtype), `${subtype} auf Band ${band}`).toBeCloseTo(
                    kern(diameter),
                    10,
                );
            }
        }
    });

    it("moves continuously between two bands instead of stepping", () => {
        // Between z5 and z6 a Metropole grows from one band value to the next; halfway has to be
        // halfway, and nothing may jump at the band boundary.
        const series = AVENTURIA_ZOOM_BANDS.marker["metropole"] ?? [];
        const from = kern(series[5] ?? 0);
        const to = kern(series[6] ?? 0);
        expect(from).not.toBe(to);

        expect(radiusAt(renderZoomForBand(5.5), "metropole")).toBeCloseTo((from + to) / 2, 10);
        expect(radiusAt(renderZoomForBand(5.25), "metropole")).toBeCloseTo(from + (to - from) * 0.25, 10);
        // Just short of the next band the value is already almost there - that is what "no pop"
        // means, and a step expression would fail exactly here.
        expect(radiusAt(renderZoomForBand(5.99), "metropole")).toBeCloseTo(from + (to - from) * 0.99, 10);
    });

    it("never runs backwards while zooming in", () => {
        for (const subtype of Object.keys(AVENTURIA_ZOOM_BANDS.marker)) {
            let previous = -1;
            for (let zoom = 0; zoom <= 8.0001; zoom += 0.1) {
                if (!admits(zoom, subtype)) {
                    continue;
                }
                const radius = radiusAt(zoom, subtype);
                expect(radius, `${subtype} shrinks at z${zoom.toFixed(1)}`).toBeGreaterThanOrEqual(previous - 1e-9);
                previous = radius;
            }
        }
    });

    it("clamps outside the band range instead of extrapolating", () => {
        const series = AVENTURIA_ZOOM_BANDS.marker["metropole"] ?? [];
        expect(radiusAt(-1, "metropole")).toBeCloseTo(kern(series[0] ?? 0), 10);
        expect(radiusAt(12, "metropole")).toBeCloseTo(kern(series[BAND_COUNT - 1] ?? 0), 10);
    });
});

describe("marker visibility across the zoom bands", () => {
    it("admits a class exactly from its appearance band on", () => {
        // Visibility stays a band decision, and the band is the zoom band (WI-0221): a Dorf appears at band 4 (Legacy's saved
        // state, F3), not somewhere inside band 3 and not at the table's band 2.
        expect(zeichenAb("dorf")).toBe(4);
        expect(admits(renderZoomForBand(3), "dorf")).toBe(false);
        expect(admits(renderZoomForBand(4), "dorf")).toBe(true);
        expect(admits(renderZoomForBand(0), "metropole")).toBe(true);
        expect(admits(renderZoomForBand(zeichenAb("stadtviertel") - 1), "stadtviertel")).toBe(false);
        expect(admits(renderZoomForBand(zeichenAb("stadtviertel")), "stadtviertel")).toBe(true);
    });

    it("keeps a class out below its band even at fractional zoom", () => {
        // The filter is the reason the size may interpolate at all: without it the class would
        // grow into existence during z1.x and appear a whole band too early.
        for (const zoom of [3, 3.25, 3.5, 3.75, 3.99]) {
            expect(admits(renderZoomForBand(zoom), "dorf"), `Dorf bleibt auf Band ${zoom} verborgen`).toBe(false);
        }
        expect(admits(renderZoomForBand(4), "dorf")).toBe(true);
    });

    it("never admits a class the band model does not know", () => {
        expect(admits(8, "raumstation")).toBe(false);
    });

    it("🔴 ein verborgener Ort bekommt seine Marke erst ab Band 8 (OPS-068), niemals seinen Namen", () => {
        // WI-0080, Betreiber 2026-10-05: „verborgene orte sind spielerisch nur über die karte zu erkunden“ -
        // „Seh ihn und klick ihn an. Ähnlich wie bei ‚Wo ist Waldo?‘“. Waldo ist gezeichnet, aber nicht
        // beschriftet. 💣 Bewusste Abweichung von Legacy (MCS-006: dort weder Marke noch Name, dafür
        // SUCHBAR); hier umgekehrt, der Riegel steht nur noch an den Namensebenen.
        // OPS-068: „Verborgene Orte sollen nur ab Zoom 8 sichtbar werden, andernfalls findet man sie bereits auf große Entfernung
        // (gibt auch große Städte, die verborgen sind)“ - Zoom 8 ist die fachliche Stufe (Zoomanzeige des Editors), MapLibre-Zoom 9.
        expect(zoomspanne("orte.verborgen.zeichen")).toEqual({ von: 8, bis: 8 });
        for (const zoom of [0, 2, 4, 6, 8, 8.99]) {
            // Eine Metropole steht sonst schon auf Band 0; verborgen steht sie bis Band 7 nicht.
            expect(admits(zoom, "metropole"), `Vergleich: eine sichtbare Metropole bei z${String(zoom)}`).toBe(true);
            expect(admits(zoom, "metropole", { is_hidden: true }), `Marke bei z${String(zoom)}`).toBe(false);
        }
        for (const zoom of [renderZoomForBand(8), 9.5]) {
            expect(admits(zoom, "metropole", { is_hidden: true }), `Marke bei z${String(zoom)}`).toBe(true);
        }
        for (const zoom of [0, 2, 4, 6, 8, renderZoomForBand(8)]) {
            expect(
                labelled(zoom, { subtype: "metropole", name: "Asboran", is_hidden: true }),
                `Name bei z${String(zoom)}`,
            ).toBe(false);
        }
        // Kein eigenes Zeichen: Burg, Ruine und Bauwerk tragen die Marke ihrer Art, nicht eine eigene - ab Band 8 wie jeder andere Ort.
        for (const art of ["dorf", "stadt", "gebaeude"]) {
            expect(admits(renderZoomForBand(8), art, { is_hidden: true }), art).toBe(admits(renderZoomForBand(8), art));
            expect(admits(renderZoomForBand(7), art, { is_hidden: true }), `${art} auf Band 7`).toBe(false);
        }
        // Und eine Freigabe am Label holt den Namen nicht zurück - das Verbergen gilt dem Ort, nicht dem Label.
        expect(
            labelled(renderZoomForBand(8), {
                subtype: "metropole",
                name: "Asboran",
                is_hidden: true,
                label_visible_override: true,
            }),
        ).toBe(false);
    });
});

/** Die Ebenen eines Stils mit den Eigenschaften, die der Ort trägt: Steht dort ein Treffer dieser Ebene bei diesem Zoom? */
function ebeneLaesst(
    layers: readonly LayerSpecification[],
    id: string,
    zoom: number,
    properties: Record<string, unknown>,
): boolean {
    const ebene = layers.find((layer) => layer.id === id);
    if (!ebene || !("filter" in ebene)) {
        throw new Error(`${id} fehlt im Stil oder trägt keinen Filter`);
    }
    return featureFilter(ebene.filter, "filter").filter({ zoom }, { type: 1, properties } as never, undefined as never);
}

describe("🔴 verborgene Orte erst im Zoomband „Verborgene Orte“ (OPS-068)", () => {
    const VERBORGEN = { subtype: "metropole", public_id: "verborgen-1", is_hidden: true };
    const SICHTBAR = { subtype: "metropole", public_id: "sichtbar-1" };
    const ZOOM_FERN = renderZoomForBand(3);
    const ZOOM_NAH = renderZoomForBand(8);

    afterEach(() => zoombaenderSetzen({}));

    it("Kreis, Haarlinie, Goldring und Sperrfläche folgen derselben Regel: fern nichts, ab Band 8 alles", () => {
        const layers = buildPlaceLayers(STANDARD);
        const ebenen = [
            "place-marker",
            "place-marker-hairline",
            "place-marker-capital",
            placeCollisionLayerId("metropole"),
        ];
        for (const id of ebenen) {
            expect(ebeneLaesst(layers, id, ZOOM_FERN, SICHTBAR), `${id}: sichtbarer Ort fern`).toBe(true);
            expect(ebeneLaesst(layers, id, ZOOM_FERN, VERBORGEN), `${id}: verborgener Ort fern`).toBe(false);
            expect(ebeneLaesst(layers, id, ZOOM_NAH, VERBORGEN), `${id}: verborgener Ort nah`).toBe(true);
        }
    });

    it("die Raute eines verborgenen Bauwerks erscheint ebenfalls erst ab Band 8", () => {
        const layers = buildPlaceLayers(STANDARD);
        const bauwerk = { subtype: "gebaeude", public_id: "verborgen-2", is_hidden: true };
        for (const id of [STRUCTURE_MARKER_LAYER_ID, "place-marker-structure-hairline"]) {
            expect(ebeneLaesst(layers, id, renderZoomForBand(7), bauwerk), `${id} auf Band 7`).toBe(false);
            expect(ebeneLaesst(layers, id, ZOOM_NAH, bauwerk), `${id} auf Band 8`).toBe(true);
        }
    });

    it("🔴 auch der gewählte verborgene Ort verschwindet unter Band 8, mit Kreis und Marke (OPS-000068 Runde 2, Vali 2026-11-02)", () => {
        const layers = buildPlaceLayers({ ...STANDARD, activePlaceId: "verborgen-1" });
        for (const id of ["place-marker", "place-marker-hairline", "place-marker-capital", PLACE_SELECTION_LAYER_ID]) {
            expect(ebeneLaesst(layers, id, ZOOM_FERN, VERBORGEN), `${id} fern`).toBe(false);
            expect(ebeneLaesst(layers, id, ZOOM_NAH, VERBORGEN), `${id} nah`).toBe(true);
        }
        // Ein gewählter gewöhnlicher Ort steht weiter auch außerhalb seines Bandes.
        const gewoehnlich = { subtype: "dorf", public_id: "offen-1", is_hidden: false };
        const mitOffenem = buildPlaceLayers({ ...STANDARD, activePlaceId: "offen-1" });
        expect(ebeneLaesst(mitOffenem, "place-marker", ZOOM_FERN, gewoehnlich)).toBe(true);
        expect(ebeneLaesst(mitOffenem, PLACE_SELECTION_LAYER_ID, ZOOM_FERN, gewoehnlich)).toBe(true);
    });

    it("im Editor-Modus (`hiddenPlacesAlways`) steht er auf jeder Stufe seiner Klasse, wie jeder andere Ort", () => {
        const layers = buildPlaceLayers({ ...STANDARD, hiddenPlacesAlways: true });
        for (const id of ["place-marker", "place-marker-hairline", "place-marker-capital"]) {
            expect(ebeneLaesst(layers, id, ZOOM_FERN, VERBORGEN), id).toBe(true);
        }
        // Und der Name bleibt auch dort weg: Das Verbergen gilt dem Namen unabhängig von der Rolle.
        const namen = PLACE_LABEL_LAYER_IDS.filter((id) => id.includes("metropole"));
        for (const id of namen) {
            expect(ebeneLaesst(layers, id, ZOOM_NAH, { ...VERBORGEN, name: "Simyala" }), id).toBe(false);
        }
    });

    it("die Zeile im Reiter „Zoombänder“ verstellt die Grenze, ohne Code: Band 5 holt den Ort ab Band 5 zurück", () => {
        zoombaenderSetzen({ "orte.verborgen.zeichen": { von: 5, bis: 8 } });
        const layers = buildPlaceLayers(STANDARD);
        expect(ebeneLaesst(layers, "place-marker", renderZoomForBand(4), VERBORGEN)).toBe(false);
        expect(ebeneLaesst(layers, "place-marker", renderZoomForBand(5), VERBORGEN)).toBe(true);
        // Von Band 0 an gibt es keine Bedingung mehr: ein verborgener Ort ist wie jeder andere.
        zoombaenderSetzen({ "orte.verborgen.zeichen": { von: 0, bis: 8 } });
        expect(ebeneLaesst(buildPlaceLayers(STANDARD), "place-marker", ZOOM_FERN, VERBORGEN)).toBe(true);
    });

    it("🪤 die Grenze der Klasse gilt weiter: ein verborgenes Dorf steht erst, wenn BEIDE Bänder es erlauben", () => {
        const layers = buildPlaceLayers(STANDARD);
        const dorf = { subtype: "dorf", public_id: "verborgen-3", is_hidden: true };
        // Dorf-Zeichen ab Band 4, verborgen ab Band 8: Auf Band 5 steht ein sichtbares Dorf, ein verborgenes nicht.
        expect(ebeneLaesst(layers, "place-marker", renderZoomForBand(5), { ...dorf, is_hidden: false })).toBe(true);
        expect(ebeneLaesst(layers, "place-marker", renderZoomForBand(5), dorf)).toBe(false);
        // Stellt jemand das Band der Verborgenen früher als das der Klasse, entscheidet weiter die Klasse.
        zoombaenderSetzen({ "orte.verborgen.zeichen": { von: 1, bis: 8 } });
        expect(ebeneLaesst(buildPlaceLayers(STANDARD), "place-marker", renderZoomForBand(2), dorf)).toBe(false);
    });

    it("der verborgene Nodix der Kraftlinien-Ansicht folgt derselben Regel; ein gewöhnlicher bleibt auf jeder Stufe", () => {
        const layers = buildPlaceLayers({
            labels: true,
            composition: composeView("powerlines", DEFAULT_LANDSCAPE_SELECTION),
        });
        expect(
            layers.some((layer) => layer.id === NODIX_HIT_LAYER_ID),
            "die Trefferfläche der Knoten steht im Stil",
        ).toBe(true);
        expect(ebeneLaesst(layers, NODIX_HIT_LAYER_ID, ZOOM_FERN, { subtype: "stadt", public_id: "n-1" })).toBe(true);
        expect(
            ebeneLaesst(layers, NODIX_HIT_LAYER_ID, ZOOM_FERN, { subtype: "stadt", public_id: "n-2", is_hidden: true }),
        ).toBe(false);
        expect(
            ebeneLaesst(layers, NODIX_HIT_LAYER_ID, ZOOM_NAH, { subtype: "stadt", public_id: "n-2", is_hidden: true }),
        ).toBe(true);
    });
});

const textSizeAt = (() => {
    const compiled = createPropertyExpression(
        labelLayer.layout?.["text-size"],
        "text-size",
        propertySpec("layout_symbol", "text-size"),
    );
    if (compiled.result !== "success") {
        throw new Error(`text-size is not a valid expression: ${JSON.stringify(compiled.value)}`);
    }
    return (zoom: number, subtype: string): number =>
        compiled.value.evaluate({ zoom }, { type: "Point", properties: { subtype } } as never) as number;
})();

const sizeExpression = (() => {
    const compiled = createPropertyExpression(
        labelLayer.layout?.["text-size"],
        "text-size",
        propertySpec("layout_symbol", "text-size"),
    );
    if (compiled.result !== "success") {
        throw new Error(`text-size is not a valid expression: ${JSON.stringify(compiled.value)}`);
    }
    return compiled.value;
})();

/** Bekommt ein Ort hier einen Namen? Gefragt wird die Namensebene SEINER Klasse (WI-0135). */
const labelled = (() => {
    const alleEbenen = buildPlaceLayers(STANDARD);
    return (zoom: number, properties: Record<string, unknown>): boolean => {
        const ebene = alleEbenen.find(
            (layer) => layer.id === placeLabelLayerId(String(properties["subtype"]), "right"),
        );
        if (!ebene || !("filter" in ebene)) {
            return false;
        }
        return featureFilter(ebene.filter, "filter").filter(
            { zoom },
            { type: 1, properties } as never,
            undefined as never,
        );
    };
})();

/**
 * Der Kalibrierungsfaktor auf die Legacy-Tafel (Betreiberwert 1.5 vom 2026-09-22).
 *
 * 🪤 Die Tests unten pruefen weiterhin, dass die TAFEL die Kurve bestimmt - nur eben mal diesem
 * Faktor. Ihn hier auszurechnen statt die erwarteten Zahlen von Hand einzutragen ist der
 * Unterschied zwischen "die Tafel gilt" und "diese sieben Zahlen gelten": das erste faellt auf,
 * wenn jemand die Tafel anfasst, das zweite nicht.
 *
 * 🔴 Der Faktor besteht aus ZWEI Teilen, und sie zu trennen ist der ganze Punkt. `POINTS_TO_PIXELS`
 * ist eine EINHEIT: die Tafel fuehrt Punktwerte, `text-size` ist eine Pixelangabe, Legacy rechnet
 * mit derselben 4/3 um. `calibration.label` ist eine MEINUNG: der Betreiber hat 1.4 auf Stage
 * beurteilt, nachdem Einheit und Zoomversatz an der Wurzel stimmten.
 *
 * 🪤 Vor WI-0015 stand hier ein einziges, am Auge gefundenes 1.5 — es vertrat beide Fehler
 * zugleich und verdeckte sie. Ein Wert, der zwei Dinge bedeutet, sieht auf einer Stufe richtig aus
 * und ist auf allen anderen falsch.
 */
const GROESSENFAKTOR = POINTS_TO_PIXELS * (AVENTURIA_ZOOM_BANDS.calibration?.label ?? 1);

describe("label size across the zoom bands", () => {
    it("hits the exact band value on every integer Avesmaps zoom", () => {
        for (const [subtype, series] of Object.entries(REIHEN.label)) {
            for (let band = 0; band < BAND_COUNT; band += 1) {
                const size = series[band];
                if (size === null || size === undefined) {
                    continue;
                }
                expect(textSizeAt(renderZoomForBand(band), subtype), `${subtype} auf Band ${band}`).toBeCloseTo(
                    size * GROESSENFAKTOR,
                    10,
                );
            }
        }
    });

    it("moves between the bands like the markers do", () => {
        // Measured in the browser before this was fixed in place: with a step expression MapLibre
        // holds the text size for a whole band and jumps at the boundary (41 px wide from z3 to
        // z3.75, then 53 px at z4); with this interpolation it grows 41, 43, 47, 50, 53. The
        // layout-property caveat turned out not to prevent interpolation - it was measured, and
        // MapLibre renders whichever of the two the style asks for.
        const series = AVENTURIA_ZOOM_BANDS.label["metropole"] ?? [];
        const from = series[3] ?? 0;
        const to = series[4] ?? 0;
        expect(from).not.toBe(to);
        expect(textSizeAt(renderZoomForBand(3.5), "metropole")).toBeCloseTo(((from + to) / 2) * GROESSENFAKTOR, 10);
    });
});

describe("label visibility: global bands, admin overrides as the exception", () => {
    const place = (extra: Record<string, unknown> = {}) => ({ subtype: "dorf", name: "Wieha", ...extra });

    it("follows the class band when no override is set", () => {
        // The normal case, and the one the cartography is made of: a Dorf gets its name from band 5 (Legacy's saved state, F3),
        // one band after its marker appears.
        expect(nameAb("dorf")).toBe(5);
        expect(labelled(renderZoomForBand(4), place())).toBe(false);
        expect(labelled(renderZoomForBand(5), place())).toBe(true);
    });

    it("🔴 an admin minimum 0 holds down to the smallest map zoom (WI-0129 §17d: the lowest band has no lower edge)", () => {
        // Phone ends at MapLibre 0.71, where the zoom display shows band 0; tile zoom 0 never reached `0 + 1`.
        for (const zoom of [0, 0.71, 1]) {
            expect(
                labelled(zoom, place({ label_min_zoom_override: 0, label_max_zoom_override: 3 })),
                String(zoom),
            ).toBe(true);
        }
    });

    it("lets an admin minimum replace the class band", () => {
        expect(labelled(renderZoomForBand(2), place({ label_min_zoom_override: 2 }))).toBe(true);
        expect(labelled(renderZoomForBand(1), place({ label_min_zoom_override: 2 }))).toBe(false);
    });

    it("treats an admin maximum as inclusive, like the band model", () => {
        const pinned = place({ label_min_zoom_override: 2, label_max_zoom_override: 5 });
        expect(labelled(renderZoomForBand(5), pinned), "band 5 still shows").toBe(true);
        expect(labelled(renderZoomForBand(5.99), pinned), "and stays until the next band").toBe(true);
        expect(labelled(renderZoomForBand(6), pinned), "band 6 does not").toBe(false);
    });

    it("🔴 a native admin maximum 7 ends at band 7, also once band 8 is reachable (ADR-0006, WI-0129: never read as 7+)", () => {
        const capped = place({ label_min_zoom_override: 2, label_max_zoom_override: 7 });
        expect(labelled(renderZoomForBand(7.99), capped), "band 7 still shows").toBe(true);
        expect(labelled(renderZoomForBand(8), capped), "band 8 does not").toBe(false);
    });

    it("keeps a name switched off at every zoom when an admin says so", () => {
        for (const zoom of [0, 2, 4, 6, 8]) {
            expect(labelled(zoom, place({ label_visible_override: false })), `z${zoom}`).toBe(false);
        }
    });

    it("shows a name below its class band when an admin forces it visible", () => {
        // Visible on its own is the hard switch: the class would hide this Dorf until band 4.
        expect(labelled(renderZoomForBand(1), place({ label_visible_override: true }))).toBe(true);
        expect(labelled(renderZoomForBand(0), place({ label_visible_override: true }))).toBe(true);
    });

    it("replaces only the property the override names", () => {
        // A size override says nothing about visibility, so the class band still decides when the
        // name appears. Anything else would turn one exception into a second set of rules.
        const sized = place({ label_size_override: 24 });
        expect(labelled(renderZoomForBand(4), sized)).toBe(false);
        expect(labelled(renderZoomForBand(5), sized)).toBe(true);
    });
});

describe("label size: global bands, admin override as the exception", () => {
    it("uses the class curve when no override is set", () => {
        const series = AVENTURIA_ZOOM_BANDS.label["metropole"] ?? [];
        expect(textSizeAt(renderZoomForBand(4), "metropole")).toBeCloseTo((series[4] ?? 0) * GROESSENFAKTOR, 10);
    });

    it("holds an admin size at every zoom", () => {
        const withOverride = (zoom: number): number =>
            sizeExpression.evaluate({ zoom }, {
                type: "Point",
                properties: { subtype: "metropole", label_size_override: 24 },
            } as never) as number;
        // 🪤 Der Faktor erreicht den Override MIT. Das ist die Entscheidung, nicht ein Versehen:
        // der Override ist eine Aussage ueber die Groesse dieses Ortes in derselben Einheit wie die
        // Tafel - kaeme er ungeskaliert durch, waere ein Ort mit Admin-Groesse ploetzlich kleiner
        // als seine Klasse.
        for (const zoom of [0, 2.5, 4, 6.75, 8]) {
            expect(withOverride(zoom), `z${zoom}`).toBe(24 * GROESSENFAKTOR);
        }
    });
});

describe("series without vector labels", () => {
    it("drops the label layer for a series whose names are in the raster", () => {
        const ids = buildPlaceLayers({ ...STANDARD, labels: false }).map((layer) => layer.id);
        expect(ids).toContain("place-marker");
        expect(ids.some((id) => PLACE_LABEL_LAYER_IDS.includes(id))).toBe(false);
    });
});

describe("Ortsnamen nach Rang, rechts vor links (WI-0135)", () => {
    /**
     * 🔴 Betreiber 2026-10-11: „metropole > großstadt > stadt > kleinstadt > dorf > gebäude“ und „es sollte auf keinen fall
     * passieren, dass ein dorflabel ein metropolenmarker verdeckt. es darf ausweichen aber wenn es nichts findet muss es weg
     * bis der zoom es erlaubt.“ Dazu die ältere Regel vom 2026-09-22: rechts vom Marker, bei Kollision links, sonst nirgends.
     *
     * MapLibre setzt Ebenen von OBEN nach unten, also vom Ende des Felds zum Anfang. „Zuerst gesetzt“ heißt hier „größerer
     * Index“.
     */
    const alle = buildPlaceLayers(STANDARD);
    const ids = alle.map((layer) => layer.id);
    const lage = (id: string): number => {
        const index = ids.indexOf(id);
        expect(index, id).toBeGreaterThanOrEqual(0);
        return index;
    };

    it("🔴 setzt die Klassen in der Rangfolge der Tafel `label_class_rank`", () => {
        // Die Ebenenfolge entscheidet über Klassengrenzen hinweg; sie muss der Tafel der Migration folgen, die innerhalb
        // einer Klasse weiter über `collision_rank` entscheidet. Gelesen wird der Seed, nicht eine Abschrift.
        const sql = readFileSync(
            new URL("../../server/migrations/0017_label_collision_rank.sql", import.meta.url),
            "utf8",
        );
        const tafel = [...sql.matchAll(/\('place', '([a-z]+)',\s*(\d+),/g)]
            .map((treffer) => ({ klasse: treffer[1] ?? "", rang: Number(treffer[2]) }))
            .sort((x, y) => x.rang - y.rang)
            .map((zeile) => zeile.klasse);
        expect(tafel).toEqual([...PLACE_CLASSES_BY_RANK]);
    });

    it("🪤 kennt jede Ortsklasse der Zoomtafel", () => {
        for (const klasse of [
            ...Object.keys(AVENTURIA_ZOOM_BANDS.marker),
            ...Object.keys(AVENTURIA_ZOOM_BANDS.label),
        ]) {
            expect(PLACE_CLASSES_BY_RANK as readonly string[], klasse).toContain(klasse);
        }
    });

    it("🔴 je Klasse: erst rechts, dann links, dann die Sperrfläche; danach erst die nächste Klasse", () => {
        let vorige = Number.POSITIVE_INFINITY;
        for (const klasse of PLACE_CLASSES_BY_RANK) {
            const rechts = lage(placeLabelLayerId(klasse, "right"));
            const links = lage(placeLabelLayerId(klasse, "left"));
            const sperre = lage(placeCollisionLayerId(klasse));
            expect(rechts, klasse).toBeLessThan(vorige);
            expect(links, klasse).toBeLessThan(rechts);
            expect(sperre, klasse).toBeLessThan(links);
            vorige = sperre;
        }
        // Die Liste nennt die Ebenen in der Folge, in der MapLibre sie setzt.
        const gesetzt = [...PLACE_LABEL_LAYER_IDS].map(lage);
        expect(gesetzt).toEqual([...gesetzt].sort((x, y) => y - x));
    });

    it("🔴 rechts heißt Anker links, links heißt Anker rechts; kein variabler Anker mehr", () => {
        // 💣 Die Ankerbenennung ist verkehrt zur Wirkung: `text-anchor: left` verankert die LINKE Kante des Texts, er steht
        // damit RECHTS vom Punkt.
        for (const klasse of PLACE_CLASSES_BY_RANK) {
            const rechts = findLayer(alle, placeLabelLayerId(klasse, "right"), "symbol");
            const links = findLayer(alle, placeLabelLayerId(klasse, "left"), "symbol");
            expect(rechts?.layout?.["text-anchor"], klasse).toBe("left");
            expect(links?.layout?.["text-anchor"], klasse).toBe("right");
            for (const ebene of [rechts, links]) {
                expect(ebene?.layout?.["text-variable-anchor"]).toBeUndefined();
                // Ein Name, der zum Marker hin bündig steht.
                expect(ebene?.layout?.["text-justify"]).toBe("auto");
            }
        }
    });

    it("🔴 ein Name, der keinen Platz findet, steht nicht; seine Sperrfläche auch nicht", () => {
        for (const id of PLACE_LABEL_LAYER_IDS) {
            const ebene = findLayer(alle, id, "symbol");
            expect(ebene?.layout?.["text-allow-overlap"], id).toBe(false);
            expect(ebene?.layout?.["text-optional"], id).toBe(false);
            expect(ebene?.layout?.["icon-optional"], id).toBe(false);
            expect(ebene?.layout?.["icon-ignore-placement"], id).toBe(false);
        }
    });

    it("🪤 jede Namensebene nimmt nur ihre Klasse", () => {
        for (const klasse of PLACE_CLASSES_BY_RANK) {
            for (const andere of PLACE_CLASSES_BY_RANK) {
                const ebene = alle.find((layer) => layer.id === placeLabelLayerId(klasse, "right"));
                const nimmt =
                    ebene && "filter" in ebene
                        ? featureFilter(ebene.filter, "filter").filter(
                              { zoom: 9 },
                              { type: 1, properties: { subtype: andere, name: "X" } } as never,
                              undefined as never,
                          )
                        : false;
                expect(nimmt, `${klasse} nimmt ${andere}`).toBe(klasse === andere);
            }
        }
    });

    it("🪤 ändert nichts am Marker und nichts an der Rangfolge innerhalb einer Klasse", () => {
        const marker = alle.find((layer) => layer.id === "place-marker");
        expect((marker?.layout as Record<string, unknown> | undefined)?.["icon-offset"]).toBeUndefined();
        for (const id of PLACE_LABEL_LAYER_IDS) {
            expect(JSON.stringify(findLayer(alle, id, "symbol")?.layout?.["symbol-sort-key"]), id).toContain(
                "collision_rank",
            );
        }
    });
});

describe("Ortsnamen stufenlos am Marker (WI-0135)", () => {
    /**
     * Betreiber 2026-10-11: „nah am marker ist perfekt“, und davor: „er soll aber nicht "springen" wenn der marker sich
     * beim zoomen in der größe verändert“.
     *
     * 💣 Vorher stand der Abstand als em-Wert in `text-radial-offset`. Das ist eine Layout-Eigenschaft, die MapLibre nur auf
     * ganzen Stufen auswertet; ein Wert je Stufe sprang, ein fester Wert stand bei kleinem Zoom weit weg. Jetzt trägt ihn
     * `text-translate`, eine Zeichen-Eigenschaft, die MapLibre in jedem Bild neu rechnet, so wie den Kreis.
     */
    const alle = buildPlaceLayers(STANDARD);
    const namensspalt = AVENTURIA_ZOOM_BANDS.spacing["namensspalt"] ?? 0;
    const paintAt = (id: string, property: "circle-radius" | "circle-stroke-width") => {
        const layer = alle.find((l) => l.id === id);
        if (!layer || layer.type !== "circle") {
            return undefined;
        }
        const compiled = createPropertyExpression(
            layer.paint?.[property] ?? 0,
            property,
            propertySpec("paint_circle", property),
        );
        if (compiled.result !== "success") {
            throw new Error(`${id}/${property} ungültig`);
        }
        return { layer, value: compiled.value };
    };
    const haarlinie = paintAt("place-marker-hairline", "circle-radius");
    const ring = paintAt("place-marker-capital", "circle-radius");
    const groesse = (id: string) => {
        const layer = alle.find((l) => l.id === id);
        const compiled = createPropertyExpression(
            layer?.layout?.["icon-size" as never],
            "icon-size",
            propertySpec("layout_symbol", "icon-size"),
        );
        if (!layer || compiled.result !== "success") {
            throw new Error(`${id}: icon-size fehlt`);
        }
        return (zoom: number, subtype: string): number =>
            compiled.value.evaluate({ zoom }, { type: "Point", properties: { subtype } } as never) as number;
    };
    const rautenLinie = groesse("place-marker-structure-hairline");
    const zulassen = (id: string, zoom: number, subtype: string): boolean => {
        const layer = alle.find((l) => l.id === id);
        if (!layer || !("filter" in layer) || !layer.filter) {
            return false;
        }
        const minzoom = "minzoom" in layer ? (layer.minzoom ?? 0) : 0;
        return (
            zoom >= minzoom &&
            featureFilter(layer.filter, "filter").filter(
                { zoom },
                { type: 1, properties: { subtype } } as never,
                undefined as never,
            )
        );
    };
    /**
     * Wie weit der GEZEICHNETE Marker reicht, aus den Ebenen selbst gelesen: Haarlinie, Goldring samt Kante, Rautenspitze.
     * Keine nachgerechnete Formel, sonst prüfte der Test die Rechnung gegen sich selbst.
     */
    const aussenMass = (zoom: number, subtype: string): number => {
        const feature = { type: "Point", properties: { subtype } } as never;
        if (zulassen("place-marker-structure-hairline", Math.floor(zoom), subtype)) {
            return rautenLinie(zoom, subtype) * STRUCTURE_IMAGE_OUTER * Math.SQRT2;
        }
        if (ring && zulassen("place-marker-capital", Math.floor(zoom), subtype)) {
            return (ring.value.evaluate({ zoom }, feature) as number) + 1;
        }
        return haarlinie?.value.evaluate({ zoom }, feature) as number;
    };
    const versatz = (id: string) => {
        const layer = findLayer(alle, id, "symbol");
        const compiled = createPropertyExpression(
            layer?.paint?.["text-translate"],
            "text-translate",
            propertySpec("paint_symbol", "text-translate"),
        );
        if (compiled.result !== "success") {
            throw new Error(`${id}: text-translate ungültig: ${JSON.stringify(compiled.value)}`);
        }
        return (zoom: number): [number, number] => compiled.value.evaluate({ zoom }) as [number, number];
    };
    const zooms: number[] = [];
    for (let zoom = 1; zoom <= 9.5; zoom += 0.125) {
        zooms.push(zoom);
    }

    it("💣 der Abstand ist keine Layout-Eigenschaft mehr, sondern ein Zeichenversatz am Bildschirm", () => {
        for (const id of PLACE_LABEL_LAYER_IDS) {
            const layer = findLayer(alle, id, "symbol");
            expect(layer?.layout?.["text-radial-offset"], id).toBeUndefined();
            expect(layer?.layout?.["text-offset"], id).toBeUndefined();
            expect(JSON.stringify(layer?.paint?.["text-translate"]), id).toContain('"zoom"');
            // Am Bildschirm, nicht an der Karte: auch gedreht steht der Name rechts.
            expect(layer?.paint?.["text-translate-anchor"], id).toBe("viewport");
        }
    });

    it("🔴 steht stufenlos äußerster Strich plus Namensspalt vom Mittelpunkt, rechts wie links", () => {
        let geprueft = 0;
        for (const klasse of PLACE_CLASSES_BY_RANK) {
            const rechts = versatz(placeLabelLayerId(klasse, "right"));
            const links = versatz(placeLabelLayerId(klasse, "left"));
            for (const zoom of zooms) {
                if (!labelled(Math.floor(zoom), { subtype: klasse, name: "X" })) {
                    continue;
                }
                const soll = aussenMass(zoom, klasse) + namensspalt;
                const [x, y] = rechts(zoom);
                expect(y).toBe(0);
                expect(links(zoom)[0], `${klasse} z${zoom}`).toBeCloseTo(-x, 9);
                // Nie näher als der Spalt; auf jeder ganzen Stufe genau der Spalt.
                expect(x, `${klasse} z${zoom}`).toBeGreaterThanOrEqual(soll - 1e-6);
                if (Number.isInteger(zoom)) {
                    // Bis auf die Konturuntergrenze kleiner Rauten, die ihr Bild nicht zeigt.
                    expect(x - soll, `${klasse} z${zoom}`).toBeLessThanOrEqual(0.5);
                }
                geprueft += 1;
            }
        }
        expect(geprueft).toBeGreaterThan(200);
    });

    it("🔴 springt an keiner ganzen Stufe", () => {
        // Kurz vor und kurz nach jeder ganzen Stufe fast derselbe Wert: Die Kurve hat keine Treppe.
        for (const klasse of PLACE_CLASSES_BY_RANK) {
            const rechts = versatz(placeLabelLayerId(klasse, "right"));
            for (let stufe = 2; stufe <= 9; stufe += 1) {
                expect(
                    Math.abs(rechts(stufe + 0.001)[0] - rechts(stufe - 0.001)[0]),
                    `${klasse} z${stufe}`,
                ).toBeLessThan(0.1);
            }
        }
    });

    it("🪤 hängt nicht an der Schriftgröße: ein Admin-Override verschiebt den Namen nicht", () => {
        for (const id of PLACE_LABEL_LAYER_IDS) {
            expect(JSON.stringify(findLayer(alle, id, "symbol")?.paint?.["text-translate"]), id).not.toContain(
                "label_size_override",
            );
        }
    });

    const textPadding = labelLayer.layout?.["text-padding"] as number;

    it("🔴 derselbe Name steht nie zweimal: links tritt nur an, wo die eigene Fläche frei ist", () => {
        // 💣 Beide Flächen liegen MITTIG auf demselben Ort, ohne Versatz; rechts belegt sie nur, links muss sie frei sein.
        // Dass die rechte Fläche bis in den linken Namen REICHT, trug nicht: geneigt wächst der Versatz mit der Karte, die
        // Fläche nur halb so stark, und nah an der Kamera stand der Name doppelt (Betreiber 2026-10-11, Neetha).
        for (const klasse of PLACE_CLASSES_BY_RANK) {
            const rechts = findLayer(alle, placeLabelLayerId(klasse, "right"), "symbol");
            const links = findLayer(alle, placeLabelLayerId(klasse, "left"), "symbol");
            expect(rechts?.layout?.["icon-allow-overlap"], klasse).toBe(true);
            expect(links?.layout?.["icon-allow-overlap"], klasse).toBe(false);
            for (const ebene of [rechts, links]) {
                expect(ebene?.layout?.["icon-offset"], klasse).toBeUndefined();
                expect(ebene?.paint?.["icon-translate"], klasse).toBeUndefined();
            }
            const flaecheRechts = groesse(placeLabelLayerId(klasse, "right"));
            const flaecheLinks = groesse(placeLabelLayerId(klasse, "left"));
            for (const zoom of zooms) {
                expect(flaecheRechts(zoom, klasse), `${klasse} z${zoom}`).toBeGreaterThan(0);
                expect(flaecheLinks(zoom, klasse), `${klasse} z${zoom}`).toBeGreaterThan(0);
            }
        }
    });

    it("🔴 ein fremder Ortsname bleibt so weit weg wie der eigene", () => {
        // Sperrfläche plus `text-padding` des fremden Namens: mindestens äußerster Strich plus Namensspalt, bis auf den
        // kleinen Puffer gegen Berührung.
        for (const klasse of PLACE_CLASSES_BY_RANK) {
            const sperre = groesse(placeCollisionLayerId(klasse));
            for (const zoom of zooms) {
                if (!zulassen(placeCollisionLayerId(klasse), Math.floor(zoom), klasse)) {
                    continue;
                }
                const aussen = aussenMass(zoom, klasse);
                const fremd = sperre(zoom, klasse) * MARKER_COLLISION_IMAGE_HALF + textPadding;
                expect(fremd, `${klasse} z${zoom}`).toBeGreaterThanOrEqual(aussen + namensspalt - 0.25 - 1e-6);
            }
        }
    });

    it("🔴 die Sperrfläche einer Klasse sperrt genau die Orte, die eine Markierung zeigen", () => {
        for (const klasse of PLACE_CLASSES_BY_RANK) {
            for (const andere of PLACE_CLASSES_BY_RANK) {
                for (let zoom = 0; zoom <= 9; zoom += 1) {
                    const gezeichnet =
                        zulassen("place-marker", zoom, andere) || zulassen("place-marker-structure", zoom, andere);
                    expect(zulassen(placeCollisionLayerId(klasse), zoom, andere), `${klasse}/${andere} z${zoom}`).toBe(
                        klasse === andere && gezeichnet,
                    );
                }
            }
        }
    });
});

describe("Bauwerke als Raute (WI-0011)", () => {
    const struktur = AVENTURIA_ZOOM_BANDS.structure;
    const rautenLayer = findLayer(buildPlaceLayers(STANDARD), "place-marker-structure", "symbol");
    const rautenZoom = renderZoomForBand(struktur.diamondFromBand);

    it("🔴 fragt ein MERKMAL ab, keinen Klassenwert", () => {
        // Legacy: sieben Stellen mit `=== "gebaeude"`, und die zweite Bauwerksklasse kippte still.
        expect(struktur.classes).toEqual(["gebaeude", "stadtviertel"]);
        const merkmal = JSON.stringify(["in", ["get", "subtype"], ["literal", struktur.classes]]);
        expect(JSON.stringify(markerLayer.filter)).toContain(merkmal);
        expect(JSON.stringify(markerLayer.paint?.["circle-color"])).toContain(merkmal);
    });

    it("zeichnet ein Bauwerk ab seinem Rautenband nicht mehr als Kreis, eine Siedlung immer", () => {
        for (const klasse of struktur.classes) {
            // Wer erst ab dem Rautenband erscheint (Gebäude nach Legacys gespeichertem Stand, F3), ist nie ein Kreis.
            if (zeichenAb(klasse) < struktur.diamondFromBand) {
                expect(admits(rautenZoom - 1, klasse), `${klasse} vor dem Rautenband`).toBe(true);
            }
            expect(admits(rautenZoom, klasse), `${klasse} ab dem Rautenband`).toBe(false);
        }
        expect(admits(rautenZoom, "stadt")).toBe(true);
        expect(admits(renderZoomForBand(7), "dorf")).toBe(true);
    });

    it("hat eine eigene Rautenebene ab genau diesem Band, ohne Kollision", () => {
        expect(rautenLayer?.type).toBe("symbol");
        expect(rautenLayer?.minzoom).toBe(rautenZoom);
        expect(rautenLayer?.layout?.["icon-allow-overlap"]).toBe(true);
        expect(rautenLayer?.layout?.["icon-ignore-placement"]).toBe(true);
    });

    it("⭐ trägt seinen Ton auch als Kreis, und ein inoffizieller Ort seinen eigenen (OPS-000083)", () => {
        const farbe = createPropertyExpression(
            markerLayer.paint?.["circle-color"],
            "circle-color",
            propertySpec("paint_circle", "circle-color"),
        );
        if (farbe.result !== "success") {
            throw new Error("circle-color ist kein gültiger Ausdruck");
        }
        const at = (subtype: string, is_unofficial?: boolean) =>
            farbe.value.evaluate({ zoom: 4 }, { type: "Point", properties: { subtype, is_unofficial } } as never) as {
                r: number;
                g: number;
                b: number;
            };
        const hex = (c: { r: number; g: number; b: number }) =>
            "#" +
            [c.r, c.g, c.b]
                .map((v) =>
                    Math.round(v * 255)
                        .toString(16)
                        .padStart(2, "0"),
                )
                .join("");
        expect(hex(at("gebaeude"))).toBe("#635497");
        expect(hex(at("stadt"))).toBe("#cc2f2a");
        expect(hex(at("gebaeude", true))).toBe("#c49ac7");
        expect(hex(at("stadt", true))).toBe("#a66a3f");
        // Eine Kachel ohne die Eigenschaft (vor der Migration) zeichnet den offiziellen Ton.
        expect(hex(at("stadt", false))).toBe("#cc2f2a");
    });
});

describe("Ortsfarben aus den Standardwerten (Kanal OPS-000083)", () => {
    afterEach(async () => {
        await ladeStartansicht(() => Promise.resolve(Response.json({})));
    });

    it("🔴 Kreis und Bauwerk, je offiziell und inoffiziell, folgen dem Wert", async () => {
        await ladeStartansicht(() =>
            Promise.resolve(
                Response.json({
                    ortFarbeOffiziell: "#102030",
                    ortFarbeInoffiziell: "#405060",
                    bauwerkFarbeOffiziell: "#708090",
                    bauwerkFarbeInoffiziell: "#a0b0c0",
                }),
            ),
        );
        const marke = buildPlaceLayers(STANDARD).find((layer) => layer.id === "place-marker");
        const farbe = JSON.stringify(
            (marke as { paint?: Record<string, unknown> } | undefined)?.paint?.["circle-color"],
        );
        expect(farbe).toContain("#102030");
        expect(farbe).toContain("#405060");
        expect(farbe).toContain("#708090");
        expect(farbe).toContain("#a0b0c0");
        expect(farbe).not.toContain(canonColour("markerSettlementSite"));
        expect(farbe).not.toContain(canonColour("markerSettlementSiteUnofficial"));
    });

    it("🔴 das Bild der Raute füllt den Kern mit dem Wert; die gewählte bleibt gold", async () => {
        await ladeStartansicht(() =>
            Promise.resolve(Response.json({ bauwerkFarbeOffiziell: "#708090", bauwerkFarbeInoffiziell: "#a0b0c0" })),
        );
        // Die letzte Füllung ist der Kern, davor steht die weiße Kontur.
        const kernVon = (variante: "raute" | "inoffiziell" | "aktiv"): string => {
            let kern = "";
            const ctx = {
                fillStyle: "",
                translate: () => undefined,
                rotate: () => undefined,
                fillRect() {
                    kern = this.fillStyle;
                },
                getImageData: () => ({}),
            };
            vi.stubGlobal("document", { createElement: () => ({ getContext: () => ctx }) });
            drawStructureMarkerImage(2, variante);
            vi.unstubAllGlobals();
            return kern;
        };
        expect(kernVon("raute")).toBe("#708090");
        expect(kernVon("inoffiziell")).toBe("#a0b0c0");
        expect(kernVon("aktiv")).toBe(canonColour("markerActive"));
    });
});

describe("Sperrflächen der Markierungen im Stapel (WI-0135)", () => {
    const ansichten = [
        STANDARD,
        { labels: true, composition: composeView("landscapes", "alle") },
        { ...STANDARD, activePlaceId: "ort-1" },
        { labels: true, composition: composeView("political", "alle"), territoryData: true },
        { labels: true, composition: composeView("powerlines", "alle") },
    ];

    it("🔴 alle Namen außer den Ortsnamen liegen unter jeder Sperrfläche oder über allen Ortsnamen", () => {
        // Darunter (Wegnamen, Höhenzahlen, Grenznamen) weichen sie jeder Markierung aus; darüber (Landschaften, Gebiete,
        // Klima) werden sie vor den Ortsnamen gesetzt, wie bisher.
        for (const ansicht of ansichten) {
            const layers = buildPlaceLayers(ansicht);
            const ids = layers.map((layer) => layer.id);
            const sperren = PLACE_COLLISION_LAYER_IDS.map((id) => ids.indexOf(id)).filter((index) => index >= 0);
            if (!ids.includes("place-marker")) {
                // Ohne Orte keine Markierung und keine Sperrfläche.
                expect(sperren).toEqual([]);
                continue;
            }
            const namen = PLACE_LABEL_LAYER_IDS.map((id) => ids.indexOf(id)).filter((index) => index >= 0);
            const unten = Math.min(...sperren);
            const oben = Math.max(...namen);
            for (const layer of layers) {
                if (layer.type !== "symbol" || layer.layout?.["text-field"] === undefined) {
                    continue;
                }
                if (PLACE_LABEL_LAYER_IDS.includes(layer.id) || PLACE_ACTIVE_LABEL_LAYER_IDS.includes(layer.id)) {
                    continue;
                }
                const lage = ids.indexOf(layer.id);
                expect(lage < unten || lage > oben, layer.id).toBe(true);
            }
        }
    });

    it("steht immer, belegt Platz und zeigt nichts", () => {
        for (const id of PLACE_COLLISION_LAYER_IDS) {
            const sperre = findLayer(buildPlaceLayers(STANDARD), id, "symbol");
            expect(sperre?.layout?.["text-field"], id).toBeUndefined();
            expect(sperre?.layout?.["icon-allow-overlap"], id).toBe(true);
            expect(sperre?.layout?.["icon-ignore-placement"], id).toBe(false);
            expect(sperre?.layout?.["icon-padding"], id).toBe(0);
        }
    });

    it("🔴 der Name des gewählten Orts steht über allem, immer rechts und ohne jemanden zu verdrängen", () => {
        const layers = buildPlaceLayers({ ...STANDARD, activePlaceId: "ort-1" });
        const ids = layers.map((layer) => layer.id);
        const oben = Math.max(...PLACE_LABEL_LAYER_IDS.map((id) => ids.indexOf(id)));
        for (const klasse of PLACE_CLASSES_BY_RANK) {
            const name = findLayer(layers, placeActiveLabelLayerId(klasse), "symbol");
            expect(ids.indexOf(placeActiveLabelLayerId(klasse)), klasse).toBeGreaterThan(oben);
            expect(name?.layout?.["text-anchor"], klasse).toBe("left");
            expect(name?.layout?.["text-allow-overlap"], klasse).toBe(true);
            expect(name?.layout?.["text-ignore-placement"], klasse).toBe(true);
            expect(JSON.stringify(name?.paint?.["text-translate"]), klasse).toEqual(
                JSON.stringify(
                    findLayer(layers, placeLabelLayerId(klasse, "right"), "symbol")?.paint?.["text-translate"],
                ),
            );
        }
    });
});

describe("Goldring und Haarlinie (Legacy-Markerbild)", () => {
    const alle = buildPlaceLayers(STANDARD);
    const ids = alle.map((layer) => layer.id);

    it("🔴 zeichnet in Legacys Reihenfolge: Ring → Haarlinie → Marke", () => {
        const ring = ids.indexOf("place-marker-capital");
        const haar = ids.indexOf("place-marker-hairline");
        const marke = ids.indexOf("place-marker");
        expect(ring).toBeGreaterThanOrEqual(0);
        expect(ring).toBeLessThan(haar);
        expect(haar).toBeLessThan(marke);
        expect(ids.indexOf("place-marker-structure-hairline")).toBeLessThan(ids.indexOf("place-marker-structure"));
    });

    it("⭐ der Goldring ist round(Durchmesser × 0,12) breit, ab dem Band, auf dem die Metropole 14 px erreicht", () => {
        const ring = alle.find((l) => l.id === "place-marker-capital");
        if (!ring || ring.type !== "circle") {
            throw new Error("Goldring fehlt");
        }
        const radius = createPropertyExpression(
            ring.paint?.["circle-radius"],
            "circle-radius",
            propertySpec("paint_circle", "circle-radius"),
        );
        if (radius.result !== "success") {
            throw new Error("Ringradius ungültig");
        }
        const serie = AVENTURIA_ZOOM_BANDS.marker["metropole"] ?? [];
        for (const band of [3, 4, 5, 6]) {
            const d = serie[band] ?? 0;
            const zoom = renderZoomForBand(band);
            const gezeichnet = radius.value.evaluate({ zoom }, {
                type: "Point",
                properties: { subtype: "metropole" },
            } as never) as number;
            expect(
                gezeichnet - radiusAt(zoom, "metropole") - evaluator("circle-stroke-width")(zoom, "metropole"),
            ).toBeCloseTo(Math.round(d * 0.12), 9);
        }
        const filter = featureFilter(ring.filter, "filter");
        const zeigt = (zoom: number, subtype: string) =>
            filter.filter({ zoom }, { type: 1, properties: { subtype } } as never, undefined as never);
        expect(zeigt(renderZoomForBand(2), "metropole")).toBe(false);
        expect(zeigt(renderZoomForBand(3), "metropole")).toBe(true);
        expect(zeigt(renderZoomForBand(6), "grossstadt")).toBe(false);
    });
});

describe("Der gelbe Kreis um den gewählten Ort (WI-0194, EDIT-0003 T33 (2))", () => {
    // Betreiber 2026-10-16: „Ein gelber Kreis um selektierte Orte wäre analog zur dicken Markierung bei Wegen angemessen (auch im
    // Frontend). Manche Orte sind einfach sehr klein aus der Entfernung“.
    const mitAuswahl = buildPlaceLayers({ ...STANDARD, activePlaceId: "ort-1" });
    const kreis = findLayer(mitAuswahl, PLACE_SELECTION_LAYER_ID, "circle");
    const radius = (() => {
        const compiled = createPropertyExpression(
            kreis?.paint?.["circle-radius"],
            "circle-radius",
            propertySpec("paint_circle", "circle-radius"),
        );
        if (compiled.result !== "success") throw new Error("circle-radius ist kein gültiger Ausdruck");
        return (zoom: number, subtype: string): number =>
            compiled.value.evaluate({ zoom }, { type: "Point", properties: { subtype } } as never) as number;
    })();

    it("🔴 nur mit einer Auswahl, nur am gewählten Ort, im Gold und der Deckkraft der Wegauswahl, unter der Marke", () => {
        expect(buildPlaceLayers(STANDARD).some((layer) => layer.id === PLACE_SELECTION_LAYER_ID)).toBe(false);
        expect(kreis).toBeDefined();
        const filter = featureFilter(kreis?.filter, "filter");
        const trifft = (id: string) =>
            filter.filter({ zoom: 5 }, { type: 1, properties: { public_id: id } } as never, undefined as never);
        expect(trifft("ort-1")).toBe(true);
        expect(trifft("ort-2")).toBe(false);
        expect(kreis?.paint?.["circle-color"]).toBe(canonColour("mapSelection"));
        expect(kreis?.paint?.["circle-opacity"]).toBe(DESIGN_CANON.mapSelection.pathOpacity);
        const ids = mitAuswahl.map((layer) => layer.id);
        for (const marke of ["place-marker-hairline", "place-marker", "place-marker-capital"]) {
            if (ids.includes(marke))
                expect(ids.indexOf(PLACE_SELECTION_LAYER_ID), marke).toBeLessThan(ids.indexOf(marke));
        }
    });

    it("🔴 reicht auf jedem Band mapSelection.lineWidth über den äußersten Strich der Marke hinaus, mindestens pathWidth Radius", () => {
        const kontur = (AVENTURIA_ZOOM_BANDS.spacing["kontur"] ?? 0) / 100;
        for (const [klasse, werte] of Object.entries(AVENTURIA_ZOOM_BANDS.marker)) {
            // Unterhalb seines Bandes gilt für den gewählten Ort die erste gefüllte Zelle seiner Klasse (wie an der Marke).
            const erste = werte.find((wert) => wert !== null && wert !== undefined);
            if (erste === undefined || erste === null) continue;
            for (let band = 0; band < BAND_COUNT; band += 1) {
                const d = werte[band] ?? erste;
                const auswahl = DESIGN_CANON.mapSelection;
                const soll = Math.max(markerExtent(klasse, band, d, kontur) + auswahl.lineWidth, auswahl.pathWidth);
                expect(radius(renderZoomForBand(band), klasse), `${klasse} Band ${String(band)}`).toBeCloseTo(soll, 5);
            }
        }
    });
});

describe("🔴 ungefähre Lage: das Fragezeichen erst, wenn die Marke voll groß ist (WI-0267, Vali 2026-10-31)", () => {
    it("ab dem Band der vollen Marke, nur an Orten mit ungefährer Lage, für Siedlung und Bauwerk", () => {
        const layers = buildPlaceLayers(STANDARD);
        const ebene = layers.find((layer) => layer.id === PLACE_APPROXIMATE_LAYER_ID);
        expect(ebene, "Ebene fehlt").toBeDefined();
        const ab = volleMarkeAb(ortsreihen().marker);
        expect(ab).toBe(6);
        expect((ebene as { minzoom?: number }).minzoom).toBe(renderZoomForBand(ab));
        const nah = renderZoomForBand(8);
        for (const subtype of ["dorf", "metropole", "gebaeude"]) {
            const ort = { subtype, public_id: `ungefaehr-${subtype}`, is_approximate: true };
            expect(ebeneLaesst(layers, PLACE_APPROXIMATE_LAYER_ID, nah, ort), subtype).toBe(true);
            expect(
                ebeneLaesst(layers, PLACE_APPROXIMATE_LAYER_ID, nah, { ...ort, is_approximate: false }),
                `${subtype} genau`,
            ).toBe(false);
        }
    });
});
