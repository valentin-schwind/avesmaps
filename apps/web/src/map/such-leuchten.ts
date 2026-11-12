import type {
    FilterSpecification,
    GeoJSONSourceSpecification,
    LayerSpecification,
    StyleSpecification,
} from "maplibre-gl";
import {
    DESIGN_CANON,
    canonColour,
    TERRITORY_TILE_SOURCE,
    territoryTileTemplate,
    type InhalteVorkommenArt,
    type SearchLeuchten,
    type TerritoryPointer,
    type VorkommenRahmen,
} from "@avesmaps3d/shared";
import { LANDSCAPE_SOURCE_ID, LANDSCAPE_SOURCE_LAYER, type AreaLabelPoints } from "./landscape-layers";
import { kennungsFilter, renderKoordinaten, renderPunkt, SCHEIN_BIS_GEGENDEN, setzeLeuchten } from "./leuchten-formen";
import { inViewBand } from "./territory-band";
import { buildTerritorySource, TERRITORY_SOURCE_ID, TERRITORY_SOURCE_LAYER } from "./territory-layers";
import { withVorkommenLeuchten } from "./vorkommen-leuchten";

// Die Sprachen leuchten ebenso (`sprachen-leuchten.ts`, WI-0261) und lesen Filter und Stelle von hier.
export { kennungsFilter, renderKoordinaten, UNTER_DIESEN } from "./leuchten-formen";

/**
 * Das Leuchten eines Suchtreffers auf der Karte (WI-0257, S3b): ganze Gegenden golden über den Kachelfilter auf Kennungen, angeschnittene Stücke als eigene GeoJSON-Ebene im selben Stil, genannte
 * Orte als Ring, Herrschaftsgebiete als Umriss und, wo nur „Aventurien“ übrig bleibt, der Kontinent als Umriss ohne Füllung.
 *
 * 🔴 **Dasselbe Gold wie die Auswahl** (`area-selection.ts`, Kanon `mapSelection`): Füllung, weicher Schein, klare Kontur. Es ist eine Hervorhebung, kein neuer Stil.
 * 🔴 **Ein eigener Weg, nicht die Mehrfachauswahl der Editoren** (`mehrfach-markierung.ts`): Deren Kennungen speisen „Flächen vereinigen“ (eine Schreibhandlung im Editor-Menü); was die Suche leuchten
 * lässt, darf dort nie als Auswahl erscheinen.
 * 🪤 **Der Kennungsfilter ist ein `match`, kein `in`**: Eine Landschaftsart wie „Wald“ leuchtet in 2.900 Flächen; `["in", …, ["literal", liste]]` sucht in jeder Kachel für jede Fläche linear
 * durch die Liste, ein `match` schlägt in einer Tabelle nach.
 * 🪤 Der Stil entsteht aus der Karte neu, sooft sich etwas ändert (`setStyle` mit `diff` entfernt, was der neue Stil nicht nennt): Das Leuchten hängt darum an jedem Stil (`withSuchLeuchten`).
 *
 * 🔴 **Die gewählten Vorkommen leuchten bunt** (WI-0257 S5, Vali 2026-10-30): Trägt das Bild `teile` (die Auswahl in „Vorkommen unterwegs“), zeichnet
 * `vorkommen-leuchten.ts` jedes in seiner Farbe samt Namen; ohne `teile` (ein Treffer der Suche) bleibt es Gold wie hier.
 */

export const SUCH_LEUCHTEN_QUELLE = "such-leuchten";
export const SUCH_LEUCHTEN_FLAECHE = "such-leuchten-flaeche";
export const SUCH_LEUCHTEN_SCHEIN = "such-leuchten-schein";
export const SUCH_LEUCHTEN_LINIE = "such-leuchten-linie";
export const SUCH_LEUCHTEN_ORT_SCHEIN = "such-leuchten-ort-schein";
export const SUCH_LEUCHTEN_ORT = "such-leuchten-ort";
const GANZ = "such-leuchten-ganz";
const GEBIET_GANZ = "such-leuchten-gebiet-ganz";
const KONTINENT = "such-leuchten-kontinent";

/** Wie ein gewähltes Vorkommen auf der Karte steht (WI-0257 S5): seine Farbe (`#rrggbb`, Kanon `mapVorkommen<n>`), sein Name und seine Kategorie (das Zeichen vor dem Namen). */
export interface SuchLeuchtenFarbe {
    readonly farbe: string;
    readonly name: string;
    readonly kind: InhalteVorkommenArt;
}

/** Ein gewähltes Vorkommen mit seinem eigenen Leuchten; `id` ist sein Schlüssel (die Kennung des Eintrags). */
export interface SuchLeuchtenTeil extends SuchLeuchtenFarbe {
    readonly id: string;
    readonly leuchten: SearchLeuchten;
}

/** Was auf der Karte leuchtet: die Antwort des Servers; bei gewählten Vorkommen dazu jedes einzeln mit seiner Farbe (`teile`, in der Reihenfolge der Wahl). */
export interface SuchLeuchtenBild {
    readonly leuchten: SearchLeuchten;
    readonly teile?: readonly SuchLeuchtenTeil[];
}

export interface SuchLeuchtenUmfeld {
    /** Der Zeiger auf die Gebietskacheln; `undefined`, wo es noch keine Gebietsdaten gibt: Dann leuchten ganze Gebiete nicht (angeschnittene tragen ihre Form selbst). */
    readonly gebiete?: TerritoryPointer | undefined;
    /** Die Punkte der Namen der gewählten Vorkommen, wie `vorkommen-namen.ts` sie gerade hält: Ein Stilwechsel leerte sie sonst. */
    readonly namen?: AreaLabelPoints | undefined;
}

type Merkmal = { type: "Feature"; properties: { t: string }; geometry: { type: string; coordinates: unknown } };

/**
 * Die GeoJSON-Merkmale der angeschnittenen Stücke, des Rests und der Orte; `t` sagt, wie jedes gezeichnet wird. Die Umrechnung der Formen läuft einmal je Antwort (der Stil entsteht oft neu, die Antwort
 * bleibt): Dieselbe Liste bleibt dieselbe, und `setStyle` findet nichts Neues.
 */
const MERKMALE = new WeakMap<SearchLeuchten, Merkmal[]>();
export function leuchtenMerkmale(leuchten: SearchLeuchten): Merkmal[] {
    const gemerkt = MERKMALE.get(leuchten);
    if (gemerkt !== undefined) return gemerkt;
    const merkmale = rechneMerkmale(leuchten);
    MERKMALE.set(leuchten, merkmale);
    return merkmale;
}

function rechneMerkmale(leuchten: SearchLeuchten): Merkmal[] {
    const merkmale: Merkmal[] = [];
    const flaeche = (t: string, form: { type: string; coordinates: unknown[] }): void => {
        merkmale.push({
            type: "Feature",
            properties: { t },
            geometry: { type: form.type, coordinates: renderKoordinaten(form.coordinates) },
        });
    };
    for (const teil of leuchten.angeschnitten) flaeche("flaeche", teil.form);
    if (leuchten.rest !== undefined) flaeche("flaeche", leuchten.rest.form);
    for (const teil of leuchten.gebiete.angeschnitten) flaeche("gebiet", teil.form);
    for (const ort of leuchten.orte) {
        merkmale.push({
            type: "Feature",
            properties: { t: "ort" },
            geometry: { type: "Point", coordinates: renderPunkt([ort.x, ort.y]) },
        });
    }
    return merkmale;
}

const nurT = (...arten: string[]): FilterSpecification =>
    (arten.length === 1
        ? ["==", ["get", "t"], arten[0]]
        : ["in", ["get", "t"], ["literal", arten]]) as unknown as FilterSpecification;

/** Ob überhaupt etwas zu zeichnen ist. */
export function leuchtetEtwas(leuchten: SearchLeuchten): boolean {
    return (
        leuchten.ganz.length > 0 ||
        leuchten.angeschnitten.length > 0 ||
        leuchten.gebiete.ganz.length > 0 ||
        leuchten.gebiete.angeschnitten.length > 0 ||
        leuchten.rest !== undefined ||
        leuchten.orte.length > 0 ||
        (leuchten.nurKontinent && leuchten.kontinent !== undefined)
    );
}

/**
 * Die drei Ebenen eines Umrisses wie die der Auswahl: weicher Schein unter der klaren Kontur; mit `fuellung` auch die Füllung darunter. Auch das Leuchten der
 * Sprachen malt so (`sprachen-leuchten.ts`). Ohne `schein` (sehr viele Gegenden, `SCHEIN_BIS_GEGENDEN`) nur Füllung und Kontur.
 */
export function ebenenWieAuswahl(
    kennung: string,
    herkunft: { source: string; "source-layer"?: string; filter?: FilterSpecification },
    fuellung: boolean,
    schein: boolean = true,
): LayerSpecification[] {
    const look = DESIGN_CANON.mapSelection;
    return [
        ...(fuellung
            ? [
                  {
                      id: `${kennung}-fuellung`,
                      type: "fill",
                      ...herkunft,
                      paint: { "fill-color": canonColour("mapSelection"), "fill-opacity": look.fillOpacity },
                  } satisfies LayerSpecification,
              ]
            : []),
        ...(schein
            ? [
                  {
                      id: `${kennung}-schein`,
                      type: "line",
                      ...herkunft,
                      layout: { "line-join": "round", "line-cap": "round" },
                      paint: {
                          "line-color": canonColour("mapSelectionGlow"),
                          "line-width": look.glowWidth,
                          "line-blur": look.glowBlur,
                      },
                  } satisfies LayerSpecification,
              ]
            : []),
        {
            id: `${kennung}-linie`,
            type: "line",
            ...herkunft,
            layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-color": canonColour("mapSelection"), "line-width": look.lineWidth },
        },
    ];
}

/** Die Ebenen des Leuchtens, von unten nach oben; leer, wo nichts leuchtet. */
export function buildSuchLeuchtenLayers(
    leuchten: SearchLeuchten,
    mitGebietsKacheln: boolean,
    mitMerkmalen: boolean,
): LayerSpecification[] {
    const layers: LayerSpecification[] = [];
    const look = DESIGN_CANON.mapSelection;
    if (leuchten.ganz.length > 0) {
        layers.push(
            ...ebenenWieAuswahl(
                GANZ,
                {
                    source: LANDSCAPE_SOURCE_ID,
                    "source-layer": LANDSCAPE_SOURCE_LAYER,
                    filter: kennungsFilter("region_public_id", leuchten.ganz),
                },
                true,
                leuchten.ganz.length < SCHEIN_BIS_GEGENDEN,
            ),
        );
    }
    // Ein ganzes Herrschaftsgebiet leuchtet als Umriss (die politische Füllung bleibt, wie sie ist); die Kachel trägt alle Bänder, es gilt das der Ansicht.
    if (mitGebietsKacheln && leuchten.gebiete.ganz.length > 0) {
        layers.push(
            ...ebenenWieAuswahl(
                GEBIET_GANZ,
                {
                    source: TERRITORY_SOURCE_ID,
                    "source-layer": TERRITORY_SOURCE_LAYER,
                    filter: inViewBand(kennungsFilter("territory_public_id", leuchten.gebiete.ganz)),
                },
                false,
                leuchten.gebiete.ganz.length < SCHEIN_BIS_GEGENDEN,
            ),
        );
    }
    // Wo nur „Aventurien“ übrig bleibt: der Kontinent als Umriss ohne Füllung (WI-0257 F1).
    if (leuchten.nurKontinent && leuchten.kontinent !== undefined) {
        layers.push(
            ...ebenenWieAuswahl(
                KONTINENT,
                {
                    source: LANDSCAPE_SOURCE_ID,
                    "source-layer": LANDSCAPE_SOURCE_LAYER,
                    filter: [
                        "==",
                        ["get", "region_public_id"],
                        leuchten.kontinent.publicId,
                    ] as unknown as FilterSpecification,
                },
                false,
            ),
        );
    }
    if (mitMerkmalen) {
        layers.push(
            {
                id: SUCH_LEUCHTEN_FLAECHE,
                type: "fill",
                source: SUCH_LEUCHTEN_QUELLE,
                filter: nurT("flaeche"),
                paint: { "fill-color": canonColour("mapSelection"), "fill-opacity": look.fillOpacity },
            },
            {
                id: SUCH_LEUCHTEN_SCHEIN,
                type: "line",
                source: SUCH_LEUCHTEN_QUELLE,
                filter: nurT("flaeche", "gebiet"),
                layout: { "line-join": "round", "line-cap": "round" },
                paint: {
                    "line-color": canonColour("mapSelectionGlow"),
                    "line-width": look.glowWidth,
                    "line-blur": look.glowBlur,
                },
            },
            {
                id: SUCH_LEUCHTEN_LINIE,
                type: "line",
                source: SUCH_LEUCHTEN_QUELLE,
                filter: nurT("flaeche", "gebiet"),
                layout: { "line-join": "round", "line-cap": "round" },
                paint: { "line-color": canonColour("mapSelection"), "line-width": look.lineWidth },
            },
            // Ein genannter Ort: ein goldener Ring mit weichem Schein, über den Flächen (die Marke des Ortes bleibt darunter sichtbar).
            {
                id: SUCH_LEUCHTEN_ORT_SCHEIN,
                type: "circle",
                source: SUCH_LEUCHTEN_QUELLE,
                filter: nurT("ort"),
                paint: {
                    "circle-radius": 13,
                    "circle-color": "rgba(0, 0, 0, 0)",
                    "circle-stroke-color": canonColour("mapSelectionGlow"),
                    "circle-stroke-width": 6,
                    "circle-stroke-opacity": 0.55,
                    "circle-blur": 0.6,
                },
            },
            {
                id: SUCH_LEUCHTEN_ORT,
                type: "circle",
                source: SUCH_LEUCHTEN_QUELLE,
                filter: nurT("ort"),
                paint: {
                    "circle-radius": 11,
                    "circle-color": "rgba(0, 0, 0, 0)",
                    "circle-stroke-color": canonColour("mapSelection"),
                    "circle-stroke-width": 3,
                },
            },
        );
    }
    return layers;
}

/** Hängt das Leuchten an den Stil; ohne Leuchten bleibt er, wie er ist. Gewählte Vorkommen (`teile`) leuchten je in ihrer Farbe (`vorkommen-leuchten.ts`). */
export function withSuchLeuchten(
    style: StyleSpecification,
    bild: SuchLeuchtenBild | undefined,
    umfeld: SuchLeuchtenUmfeld = {},
): StyleSpecification {
    if (bild?.teile !== undefined && bild.teile.length > 0) return withVorkommenLeuchten(style, bild.teile, umfeld);
    if (bild === undefined || !leuchtetEtwas(bild.leuchten)) return style;
    const leuchten = bild.leuchten;
    const sources: StyleSpecification["sources"] = { ...style.sources };
    // Die Gebietsquelle steht nur im Stil, wo die politische Ansicht oder eine Auswahl sie braucht: Das Leuchten bringt sie mit, sonst fehlte sie.
    if (
        leuchten.gebiete.ganz.length > 0 &&
        umfeld.gebiete !== undefined &&
        sources[TERRITORY_SOURCE_ID] === undefined
    ) {
        sources[TERRITORY_SOURCE_ID] = buildTerritorySource(
            territoryTileTemplate(TERRITORY_TILE_SOURCE, umfeld.gebiete),
        );
    }
    const merkmale = leuchtenMerkmale(leuchten);
    if (merkmale.length > 0) {
        sources[SUCH_LEUCHTEN_QUELLE] = {
            type: "geojson",
            data: { type: "FeatureCollection", features: merkmale },
        } as GeoJSONSourceSpecification;
    }
    const gebietsQuelleDa = sources[TERRITORY_SOURCE_ID] !== undefined;
    const neu = buildSuchLeuchtenLayers(leuchten, gebietsQuelleDa, merkmale.length > 0);
    // Über den Flächen und der Auswahl, unter den Marken und Namen: vor der ersten Ebene, die zu diesen gehört.
    return { ...style, sources, layers: setzeLeuchten(style.layers, neu) };
}

/**
 * Der Ausschnitt eines gewählten Vorkommens für den Flug aus dem Sammelscreen (WI-0257 S5): wie `leuchtenAusschnitt`, aber ohne Ziel, wo nur der Kontinent
 * bleibt („Überall in Aventurien“) oder nichts leuchtet - dann fliegt die Kamera nicht.
 */
export function vorkommenAusschnitt(leuchten: SearchLeuchten): [[number, number], [number, number]] | undefined {
    if (leuchten.nurKontinent || leuchten.pausiert || !leuchtetEtwas(leuchten)) return undefined;
    return leuchtenAusschnitt(leuchten);
}

/** Der Ausschnitt für den Flug in Renderkoordinaten (Südwest, Nordost): der Rahmen des Leuchtens samt den genannten Orten, sonst der Kontinent; `undefined`, wo nichts zu zeigen ist. */
export function leuchtenAusschnitt(leuchten: SearchLeuchten): [[number, number], [number, number]] | undefined {
    let rahmen: VorkommenRahmen | null = leuchten.nurKontinent ? (leuchten.kontinent?.rahmen ?? null) : leuchten.rahmen;
    for (const ort of leuchten.orte) {
        rahmen =
            rahmen === null
                ? { x0: ort.x, y0: ort.y, x1: ort.x, y1: ort.y }
                : {
                      x0: Math.min(rahmen.x0, ort.x),
                      y0: Math.min(rahmen.y0, ort.y),
                      x1: Math.max(rahmen.x1, ort.x),
                      y1: Math.max(rahmen.y1, ort.y),
                  };
    }
    if (rahmen === null) return undefined;
    // Ein einzelner Ort (oder ein Strich) hat keine Ausdehnung: ein kleiner Hof, damit die Kamera ein Bild einpassen kann.
    const hof = 2;
    const x0 = rahmen.x1 - rahmen.x0 < hof ? rahmen.x0 - hof : rahmen.x0;
    const x1 = rahmen.x1 - rahmen.x0 < hof ? rahmen.x1 + hof : rahmen.x1;
    const y0 = rahmen.y1 - rahmen.y0 < hof ? rahmen.y0 - hof : rahmen.y0;
    const y1 = rahmen.y1 - rahmen.y0 < hof ? rahmen.y1 + hof : rahmen.y1;
    const a = renderPunkt([x0, y0]);
    const b = renderPunkt([x1, y1]);
    return [
        [Math.min(a[0], b[0]), Math.min(a[1], b[1])],
        [Math.max(a[0], b[0]), Math.max(a[1], b[1])],
    ];
}
