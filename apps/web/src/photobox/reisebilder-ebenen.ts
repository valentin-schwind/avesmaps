import type {
    CircleLayerSpecification,
    ExpressionSpecification,
    FilterSpecification,
    GeoJSONSourceSpecification,
    LayerSpecification,
    StyleSpecification,
    SymbolLayerSpecification,
} from "maplibre-gl";
import {
    AVENTURIA,
    AVENTURIA_ZOOM_BANDS,
    BAND_COUNT,
    VECTOR_TILE_MAX_ZOOM,
    bandInterpolateExpression,
    canonColour,
    renderZoomForBand,
    toRenderLngLat,
    type BandSeriesValues,
} from "@avesmaps3d/shared";
import {
    CAPITAL_RING_LAYER_ID,
    HAIRLINE_LAYER_ID,
    PLACE_APPROXIMATE_LAYER_ID,
    PLACE_COLLISION_LAYER_IDS,
    PLACE_LABEL_LAYER_IDS,
    PLACE_MARKER_LAYER_ID,
    PLACE_SELECTION_LAYER_ID,
    STRUCTURE_MARKER_LAYER_ID,
    markerExtent,
} from "../map/place-layers";

/**
 * Die Quellen und Ebenen der Reisebilder auf der Karte (WI-0272 S4, Aufgabe 26). Sie stehen IM STIL (`composeStyle`, `mitReisebildern`), nicht per `addLayer`: `rebuildStyle` (`setStyle` mit `diff`)
 * entfernt alles, was `composeStyle` nicht nennt, und läuft bei jeder Auswahl eines Orts. Ein Wiederanlegen flackerte dann bei jedem Klick; im Stil bleiben Quellen und Ebenen stehen, und in jeder anderen
 * Ansicht (die den Aufruf auslässt) verschwinden sie von selbst.
 *
 * - **Zwei Quellen:** `photobox-bilder` (freie Bilder und Bündel, ein Punkt je Gruppe) und `photobox-fahnen` (je Ort, an dem Bilder hängen, ein Punkt mit den Eigenschaften der Ortskachel). Beide GeoJSON mit
 *   `promoteId: "schluessel"` (Zustand je Gruppe: Hover, Pulsring) und `maxzoom` der Ortskacheln, damit `["zoom"]` im Filter dem der Ortskacheln gleicht.
 * - **Die Fahne gilt genau, wenn der Marker gilt** (WI §12 Frage 4, Vali: „taucht mit seiner Markierung auf“): Ihr Filter ist der des Ortsmarkers, kopiert (`fahnenFilter`, Muster `noWikiPlaceLayer`). So gelten
 *   Klassen, Spannen und Auswahl des Markers, und es gibt keinen eigenen Schwellwert. Ein `setFilter` auf der Quelle `places` schiede aus: Er lädt alle Ortskacheln neu.
 * - **Marker und Namen werden nie verdeckt:** Das Zeichen liegt UNTER Auswahlkreis, Goldring und Haarlinie des Markers (alle Marker und Namen darüber); die Fahne belegt keinen Platz (`icon-ignore-placement`),
 *   verdrängt also keinen Namen, und sitzt links oberhalb des Punkts in einem Abstand, der am Marker seiner Klasse und seines Bandes hängt (`fahnenVersatz`).
 * - 🔴 **Kein Ebenenname beginnt mit `place-marker-`:** Dahinter hängen sich die Prüfhaken (`map-checks-layers.ts`, `insertNear`).
 * - 🪤 **Nichts in den Filtern außer dem kopierten Markerfilter:** `["zoom"]` steht nur dort (Kachelzoom, ganzzahlig), in den Ebenen selbst nirgends. Quelldaten sind frisch gebaut, nie ein Vue-Proxy.
 */

export const REISEBILD_QUELLE = "photobox-bilder";
export const REISEBILD_FAHNEN_QUELLE = "photobox-fahnen";
export const REISEBILD_ZEICHEN_EBENE = "photobox-zeichen";
export const REISEBILD_HERVOR_EBENE = "photobox-hervor";
export const REISEBILD_FAHNE_EBENE = "photobox-fahne";
export const REISEBILD_FAHNE_HERVOR_EBENE = "photobox-fahne-hervor";

/** Die Ebenen, auf die der Koordinator klickt und zeigt: das Zeichen und die Fahne. */
export const REISEBILD_TREFFER_EBENEN: readonly string[] = [REISEBILD_ZEICHEN_EBENE, REISEBILD_FAHNE_EBENE];

/** Der kleinste Versatz der Fahne von ihrem Ortspunkt, nach links und nach oben, in Bildpunkten (Regler melden, WI §9: Nähe an der Marke). */
export const FAHNE_VERSATZ = 7;
/** Am Telefon ist die Fahne größer (Zeigefinger). */
export const FAHNE_TELEFON_GROESSE = 1.25;
/** Wie lange das Zeichen ein- und ausblendet. */
export const ZEICHEN_BLENDE_MS = 280;
/** Wie weit der Ring der Hervorhebung vom Rand der Marke steht. */
const RING_ABSTAND = 2;
const RING_BREITE = 3;
/** Der Ring um ein Zeichen (Scheibe 30 px) und um einen Abzug (40 px), in Bildpunkten Radius. */
const RING_ZEICHEN = 19;
const RING_VORSCHAU = 25;

const WELT = AVENTURIA.coordinateSpace;

// --- Die Daten ------------------------------------------------------------------------------------------------------

type Eigenschaft = string | number | boolean;

export interface PunktDaten {
    readonly type: "FeatureCollection";
    readonly features: readonly {
        readonly type: "Feature";
        readonly properties: Readonly<Record<string, Eigenschaft>>;
        readonly geometry: { readonly type: "Point"; readonly coordinates: [number, number] };
    }[];
}

/** Ein Symbol auf der Karte: seine Gruppe (`schluessel`), das Bild (Kennung im Stil) und der Punkt in Renderkoordinaten. */
export interface ZeichenEintrag {
    readonly schluessel: string;
    readonly bild: string;
    readonly lng: number;
    readonly lat: number;
}

/** Eine Fahne: dazu der Ort mit den Eigenschaften seiner Kachel (`public_id`, `subtype`, `capital_bands`), die der Markerfilter liest. */
export interface FahnenEintrag extends ZeichenEintrag {
    readonly ortId: string;
    readonly subtype: string;
    readonly capitalBands?: string;
}

/** Frisch gebaut, nie geteilt: Was in die Karte geht, darf kein Vue-Proxy sein und nicht zwischen Aufrufen verändert werden. */
export function zeichenDaten(gruppen: readonly ZeichenEintrag[]): PunktDaten {
    return {
        type: "FeatureCollection",
        features: gruppen.map((g) => ({
            type: "Feature",
            properties: { schluessel: g.schluessel, bild: g.bild },
            geometry: { type: "Point", coordinates: [g.lng, g.lat] },
        })),
    };
}

/** Je Ort ein Punkt mit genau den Eigenschaften der Kachel: `public_id`, `subtype`, `is_hidden` (nie wahr: Verborgene Orte nennt der Lesepfad nicht) und `capital_bands`. */
export function fahnenDaten(orte: readonly FahnenEintrag[]): PunktDaten {
    return {
        type: "FeatureCollection",
        features: orte.map((o) => ({
            type: "Feature",
            properties: {
                schluessel: o.schluessel,
                bild: o.bild,
                public_id: o.ortId,
                subtype: o.subtype,
                is_hidden: false,
                ...(o.capitalBands === undefined ? {} : { capital_bands: o.capitalBands }),
            },
            geometry: { type: "Point", coordinates: [o.lng, o.lat] },
        })),
    };
}

/** Der Punkt einer Lage der Karte in Renderkoordinaten. */
export function renderPunkt(lage: { readonly x: number; readonly y: number }): { lng: number; lat: number } {
    return toRenderLngLat(WELT, lage);
}

// --- Der Filter der Fahne -------------------------------------------------------------------------------------------

/**
 * Der Filter der Fahne: der des Ortsmarkers. Der Kreis (`place-marker`) trägt seinen Filter, die Raute (`place-marker-structure`) trägt ihr Band als `minzoom` der Ebene, das hier in den Filter wandert
 * (ein Filter kennt den Kachelzoom, nicht den der Ebene). Ohne Marker in diesem Stil gibt es keine Fahne: `undefined`.
 */
export function fahnenFilter(layers: readonly LayerSpecification[]): FilterSpecification | undefined {
    const kreis = layers.find((layer) => layer.id === PLACE_MARKER_LAYER_ID);
    if (kreis?.type !== "circle" || kreis.filter === undefined) return undefined;
    const raute = layers.find((layer) => layer.id === STRUCTURE_MARKER_LAYER_ID);
    if (raute?.type !== "symbol" || raute.filter === undefined) return kreis.filter;
    return ["any", kreis.filter, ["all", raute.filter, [">=", ["zoom"], raute.minzoom ?? 0]]] as FilterSpecification;
}

// --- Der Versatz der Fahne ------------------------------------------------------------------------------------------

const KONTUR = (AVENTURIA_ZOOM_BANDS.spacing["kontur"] ?? 0) / 100;

/**
 * Die Reihe der Klasse ohne Lücken: Zellen vor dem ersten Wert tragen ihn (wie die Karte es für die Auswahl tut, `ersteZelleNachUnten` in `place-layers.ts`), spätere Lücken den letzten davor. Ein gewählter Ort
 * steht auch unterhalb seines Bandes, und der Versatz der Fahne muss ihn mit abdecken.
 */
function aufgefuellt(reihe: BandSeriesValues): (number | null)[] {
    let letzter: number | null = reihe.find((wert): wert is number => typeof wert === "number") ?? null;
    return Array.from({ length: BAND_COUNT }, (_, band) => {
        const wert = reihe[band];
        if (typeof wert === "number") letzter = wert;
        return letzter;
    });
}

/** Wie weit der Marker einer Klasse in einem Band vom Ortspunkt reicht (sein äußerster Strich, `markerExtent`); `0`, wo die Klasse kein Zeichen trägt. */
function markerReichweite(klasse: string, band: number): number {
    const reihe = aufgefuellt(AVENTURIA_ZOOM_BANDS.marker[klasse] ?? []);
    const durchmesser = reihe[Math.min(Math.max(band, 0), BAND_COUNT - 1)];
    return typeof durchmesser === "number" ? markerExtent(klasse, band, durchmesser, KONTUR) : 0;
}

/**
 * Wie weit die Fahne in Bildpunkten nach links und nach oben vom Ortspunkt sitzt: mindestens `FAHNE_VERSATZ`, bei großen Marken so weit, dass ihre Ecke (Abstand mal √2 zur Mitte) außerhalb der Marke
 * liegt. 🔴 Der Marker der Metropole misst auf hoher Stufe über 33 px; ein fester Versatz von 7 liegt dort mitten darin. Der Marker wächst zwischen zwei Bändern stetig, der Versatz einer Kachel
 * gilt für den ganzen Zoombereich dieser Kachelstufe (Layout wird je Kachel gerechnet): Er trägt darum das Maß des NÄCHSTEN Bandes mit, das der Marker bis zur nächsten Kachelstufe erreicht.
 */
export function fahnenVersatz(klasse: string, band: number): number {
    const reichweite = Math.max(markerReichweite(klasse, band), markerReichweite(klasse, band + 1));
    return Math.max(FAHNE_VERSATZ, Math.ceil(reichweite / Math.SQRT2));
}

/** Der Versatz nach Klasse und Zoom als Ausdruck: `[-v, -v]`, ein Wert je Klasse und Band, dazwischen stufenlos; unbekannte Klassen bekommen den kleinsten. */
export function fahnenVersatzAusdruck(): ExpressionSpecification {
    const klassen = Object.keys(AVENTURIA_ZOOM_BANDS.marker);
    const ausdruck: unknown[] = ["interpolate", ["linear"], ["zoom"]];
    for (let band = 0; band < BAND_COUNT; band += 1) {
        const faelle = klassen.flatMap((klasse) => [
            klasse,
            ["literal", [-fahnenVersatz(klasse, band), -fahnenVersatz(klasse, band)]],
        ]);
        ausdruck.push(renderZoomForBand(band), [
            "match",
            ["get", "subtype"],
            ...faelle,
            ["literal", [-FAHNE_VERSATZ, -FAHNE_VERSATZ]],
        ]);
    }
    return ausdruck as ExpressionSpecification;
}

/** Der Halbmesser des Rings um den Ortspunkt (Hervorhebung der Fahne) je Klasse und Zoom: ein wenig außerhalb der Marke. */
function ringRadiusAusdruck(): ExpressionSpecification {
    const serien: Record<string, BandSeriesValues> = Object.fromEntries(
        Object.keys(AVENTURIA_ZOOM_BANDS.marker).map((klasse) => [
            klasse,
            Array.from({ length: BAND_COUNT }, (_, band) => markerReichweite(klasse, band) + RING_ABSTAND),
        ]),
    );
    return bandInterpolateExpression(serien, "subtype") as unknown as ExpressionSpecification;
}

// --- Die Ebenen -----------------------------------------------------------------------------------------------------

const ringDeckkraft: ExpressionSpecification = [
    "case",
    ["any", ["boolean", ["feature-state", "hervor"], false], ["boolean", ["feature-state", "puls"], false]],
    1,
    0,
];

/** Die Ebenen des Zeichens: erst der Ring der Hervorhebung, dann das Symbol. */
function zeichenEbenen(): LayerSpecification[] {
    const ring: CircleLayerSpecification = {
        id: REISEBILD_HERVOR_EBENE,
        type: "circle",
        source: REISEBILD_QUELLE,
        paint: {
            // Der Abzug (Bild-Kennung beginnt mit `photobox-vorschau`) ist größer als die Scheibe.
            "circle-radius": ["case", ["in", "photobox-vorschau", ["get", "bild"]], RING_VORSCHAU, RING_ZEICHEN],
            "circle-opacity": 0,
            "circle-stroke-color": canonColour("mapSelection"),
            "circle-stroke-width": RING_BREITE,
            "circle-stroke-opacity": ringDeckkraft,
            "circle-pitch-alignment": "viewport",
        },
    };
    const zeichen: SymbolLayerSpecification = {
        id: REISEBILD_ZEICHEN_EBENE,
        type: "symbol",
        source: REISEBILD_QUELLE,
        layout: {
            "icon-image": ["get", "bild"],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "icon-pitch-alignment": "viewport",
            "icon-rotation-alignment": "viewport",
        },
        // Das Symbol blendet ein und aus, wenn die Leiste auf- oder zugeht (die Karte stellt die Deckkraft, `icon-size` ist Layout und nicht animierbar).
        paint: { "icon-opacity": 1, "icon-opacity-transition": { duration: ZEICHEN_BLENDE_MS } },
    };
    return [ring, zeichen];
}

/** Die Ebenen der Fahne: erst der Ring um den Ortspunkt, dann die Fahne. Beide mit dem Filter des Markers. */
function fahnenEbenen(filter: FilterSpecification, telefon: boolean): LayerSpecification[] {
    const ring: CircleLayerSpecification = {
        id: REISEBILD_FAHNE_HERVOR_EBENE,
        type: "circle",
        source: REISEBILD_FAHNEN_QUELLE,
        filter,
        paint: {
            "circle-radius": ringRadiusAusdruck(),
            "circle-opacity": 0,
            "circle-stroke-color": canonColour("mapSelection"),
            "circle-stroke-width": RING_BREITE,
            "circle-stroke-opacity": ringDeckkraft,
            "circle-pitch-alignment": "viewport",
        },
    };
    const fahne: SymbolLayerSpecification = {
        id: REISEBILD_FAHNE_EBENE,
        type: "symbol",
        source: REISEBILD_FAHNEN_QUELLE,
        filter,
        layout: {
            "icon-image": ["get", "bild"],
            "icon-anchor": "bottom-right",
            "icon-offset": fahnenVersatzAusdruck(),
            ...(telefon ? { "icon-size": FAHNE_TELEFON_GROESSE } : {}),
            // Die Fahne belegt keinen Platz: Kein Ortsname weicht ihr aus oder verschwindet ihretwegen.
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "icon-pitch-alignment": "viewport",
            "icon-rotation-alignment": "viewport",
        },
        // Wie das Zeichen: Beim Wechsel zwischen Fahne und Vorschau blendet das Symbol über (die Karte stellt die Deckkraft).
        paint: { "icon-opacity": 1, "icon-opacity-transition": { duration: ZEICHEN_BLENDE_MS } },
    };
    return [ring, fahne];
}

export interface ReisebilderDaten {
    readonly zeichen: PunktDaten;
    readonly fahnen: PunktDaten;
}

export interface ReisebilderOptionen {
    /** Am Telefon (grober Zeiger, kurze Seite): die Fahne ist größer. */
    readonly telefon: boolean;
}

const quelle = (daten: PunktDaten): GeoJSONSourceSpecification => ({
    type: "geojson",
    data: daten as unknown as GeoJSONSourceSpecification["data"],
    promoteId: "schluessel",
    maxzoom: VECTOR_TILE_MAX_ZOOM,
});

/** Der kleinste Platz im Stapel unter den genannten Ebenen; `-1`, wenn keine da ist. */
const ersterPlatz = (ids: readonly string[], genannte: readonly string[]): number => {
    const plaetze = genannte.map((id) => ids.indexOf(id)).filter((platz) => platz >= 0);
    return plaetze.length === 0 ? -1 : Math.min(...plaetze);
};

/**
 * Hängt Quellen und Ebenen an den Stil (ein neuer Stil, der alte bleibt, wie er ist).
 *
 * - Das Zeichen liegt VOR dem ersten von Auswahlkreis, Goldring und Haarlinie (damit alle Marker darüber liegen); fehlen sie (Orte aus), vor dem ersten Ortsnamen, sonst ganz oben.
 * - Die Fahne liegt VOR der ersten Sperrfläche der Ortsklassen, also über allen Markern und unter allen Namen. Ohne Ortsmarker in diesem Stil (`fahnenFilter`) gibt es weder Fahne noch Quelle der Fahnen.
 */
export function mitReisebildern(
    stil: StyleSpecification,
    daten: ReisebilderDaten,
    optionen: ReisebilderOptionen,
): StyleSpecification {
    const layers = [...stil.layers];
    const filter = fahnenFilter(layers);
    const ids = layers.map((layer) => layer.id);

    const setzeVor = (platz: number, ebenen: readonly LayerSpecification[]): void => {
        layers.splice(platz < 0 ? layers.length : platz, 0, ...ebenen);
    };

    // Zuerst die Fahne (hinten im Stapel), damit der Platz des Zeichens davor nicht verrutscht.
    if (filter !== undefined) {
        const platz = ersterPlatz(ids, PLACE_COLLISION_LAYER_IDS);
        // Ohne Sperrflächen (keine Namen): hinter dem letzten Marker.
        const hinterMarker = ids.reduce(
            (nach, id, index) =>
                id === PLACE_APPROXIMATE_LAYER_ID || id.startsWith("place-marker") ? index + 1 : nach,
            -1,
        );
        setzeVor(platz >= 0 ? platz : hinterMarker, fahnenEbenen(filter, optionen.telefon));
    }
    const markerPlatz = ersterPlatz(
        layers.map((layer) => layer.id),
        [PLACE_SELECTION_LAYER_ID, CAPITAL_RING_LAYER_ID, HAIRLINE_LAYER_ID],
    );
    const namenPlatz = ersterPlatz(
        layers.map((layer) => layer.id),
        PLACE_LABEL_LAYER_IDS,
    );
    setzeVor(markerPlatz >= 0 ? markerPlatz : namenPlatz, zeichenEbenen());

    return {
        ...stil,
        sources: {
            ...stil.sources,
            [REISEBILD_QUELLE]: quelle(daten.zeichen),
            ...(filter === undefined ? {} : { [REISEBILD_FAHNEN_QUELLE]: quelle(daten.fahnen) }),
        },
        layers,
    };
}
