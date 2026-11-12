import { watch } from "vue";
import {
    MercatorCoordinate,
    Point,
    type FilterSpecification,
    type GeoJSONSource,
    type Map as MapLibreMap,
} from "maplibre-gl";

import type { Insets } from "./camera/visible-area";
import { locale } from "../i18n/i18n";
import { climateZoneName } from "./climate-zones";
import {
    composeLabelPoints,
    piece,
    placeBandLabels,
    thinRing,
    type BandShape,
    type GroundProjection,
    type LabelTarget,
    type Piece,
    type Point2,
} from "./area-label-placement";
import {
    CLIMATE_FILL_LAYER_ID,
    CLIMATE_LABEL_LAYER_ID,
    CLIMATE_LABEL_SOURCE_ID,
    CLIMATE_SOURCE_ID,
    CLIMATE_SOURCE_LAYER,
    NO_AREA_LABELS,
    WATER_LINE_LAYER_ID,
    WATER_SOURCE_ID,
    WATER_SOURCE_LAYER,
    type AreaLabelPoints,
    climateLabelRoom,
    climateLabelSize,
    climateLabelWidth,
} from "./landscape-layers";

/**
 * Flächennamen, die mit der Kamera wandern: die Klimazonen (WI-0012, Nachtrag 2026-10-05; Betreiber: „ob du die zonennamen statt
 * links mittig anzeigen könntest - immer da wo die zone ist“) und die Sprachen (WI-0261 S5a, E5: „die labels der flächen können
 * bei den sprachen auch so angezeigt werden wie bei den klimazonen“). EINE Mechanik; je Ebene sagt eine Beschreibung
 * (`AreaLabelSpec`), aus welcher Quelle die Flächen kommen, was Schlüssel, Name und Farbe sind und ob Namen ausweichen. Die Namen
 * der gewählten Vorkommen (WI-0257 S5, `vorkommen-namen.ts`) lesen ihre Flächen selbst aus mehreren Quellen (`flaechen`).
 *
 * Gewählt ist eine MapLibre-Ebene mit einer GeoJSON-Quelle, die diese Datei in jedem Bild der Kamera nachführt, statt
 * erst nach `moveend` (dann spränge der Name am Ende jeder Bewegung) oder als HTML über der Karte (dann wiche er keinem
 * anderen Kartennamen aus):
 *
 * - **Woher die Formen kommen:** aus den Kacheln, die die Karte ohnehin geladen hat, Flächen und Meere
 *   (`querySourceFeatures`, neu gelesen, wenn Kacheln kommen). Keine zweite Quelle, keine Anfrage an den Server.
 * - **Wo der Name steht:** mittig im sichtbaren Teil seiner Fläche, in der freien Fläche neben den Panels
 *   (`area-label-placement.ts`); Sprachen überlappen sich und weichen einander aus (Regeln 6 und 7 dort).
 * - **Warum er nicht flackert:** Ein gewanderter Name steht sofort wieder (`text-allow-overlap` an der Ebene, siehe
 *   `buildClimateLabelLayer`), und springt seine Stelle, gleitet er hin (`FOLLOW`). Die Quelle bekommt höchstens einen
 *   Zug je Bild, und nur, wenn sich etwas geändert hat; ruht die Kamera und sind alle Namen angekommen, ruht auch sie.
 * - **Kollision:** wie jeder Kartenname (`text-overlap: "never"`); zu schmal: kein Name.
 * - **Nur in der eigenen Ebene:** „Alle“ zeigt weder Klimazonen (Betreiber 2026-10-05) noch Sprachen. Ohne Füllung und Namensebene
 *   im Stil ruht die Rechnung.
 *
 * 🪤 Gerechnet wird auf der Ebene der Karte, ohne Gelände: MapLibres `unproject` liest geneigt mit Gelände die Tiefe von der
 * Grafikkarte zurück, und Höhen je Bild abzufragen kostet die Bildrate (WI-0049). Geneigt über hohem Gelände steht ein Name
 * deshalb etwas höher, als die Rechnung meint; die Flächen sind dafür breit genug.
 */

export interface AreaLabels {
    /** Die Punkte, die die Quelle gerade trägt: `composeStyle` reicht sie weiter, sonst leerte jeder Stilwechsel sie. */
    points(): AreaLabelPoints;
    /** Wo die Namen stehen sollen (Bildpunkte), für Browsertests. */
    placed(): readonly LabelTarget[];
    remove(): void;
}

export type ClimateLabels = AreaLabels;

/** Was ein Kachelobjekt einer Fläche zum Namen beiträgt; `undefined`, wenn es keinen trägt. */
export interface AreaBand {
    key: string;
    name: string;
    properties?: Readonly<Record<string, string>>;
}

/** Eine Ebene mit wandernden Flächennamen. */
export interface AreaLabelSpec {
    /** Die Kachelquelle der Flächen und ihre Ebene darin. */
    sourceId: string;
    sourceLayer: string;
    /** Die Füllung der Flächen: Ohne sie lädt keine Kachel, und es gibt keinen Namen. */
    fillLayerId: string;
    /** Die GeoJSON-Quelle der Namen und ihre Ebene. */
    labelSourceId: string;
    labelLayerId: string;
    /** Schlüssel, Name und Eigenschaften eines Kachelobjekts. */
    bandOf(properties: Readonly<Record<string, unknown>>): AreaBand | undefined;
    /** Flächen, die sich überlappen: Namen weichen einander aus und brauchen Platz in der Breite (`area-label-placement.ts`). */
    ausweichen: boolean;
    /**
     * Flächen, die nicht aus EINER Kachelquelle kommen (die gewählten Vorkommen, WI-0257 S5: ganze Gegenden aus den Landschaftskacheln, Gebiete aus den
     * Gebietskacheln, angeschnittene Stücke aus einer GeoJSON-Quelle). Ohne Angabe liest die Mechanik `sourceId` mit `bandOf`.
     */
    flaechen?: AreaLabelFlaechen;
}

/** Wer die Flächen einer Ebene selbst liest (`AreaLabelSpec.flaechen`). */
export interface AreaLabelFlaechen {
    /** Die Quellen, deren neue Kacheln ein Neulesen auslösen. */
    readonly quellen: readonly string[];
    /** Die Bänder aus den geladenen Kacheln; `stuecke` macht aus einer Kachelform Ringe am Boden, ausgedünnt auf etwa einen Bildpunkt. */
    lies(map: MapLibreMap, stuecke: (geometry: { type: string; coordinates: unknown }) => Piece[]): BandShape[];
    /** Wie breit ein Name samt allem, was vor ihm steht (ein Zeichen), bei dieser Schriftgröße im Bild steht; ohne Angabe `climateLabelWidth`. */
    breite?(name: string, size: number): number;
    /** Wie hoch ein Name samt Saum und Abstand zum nächsten im Bild steht; ohne Angabe `climateLabelRoom`. */
    raum?(size: number): number;
    /** Die Flächen liegen über dem Meer (das Leuchten liegt über allem): Das Meer deckt sie nicht, ein Name darf darauf stehen. */
    readonly ueberDemMeer?: boolean;
}

/**
 * Die Klimazonen. 🔴 Der NAME kommt aus der Sprachtafel, nicht aus der Kachel (WI-0171, Betreiber 2026-10-15): Die Kachel trägt
 * den Schlüssel der Zone und daneben den deutschen Stamm (`label`); welches Wort auf der Karte steht, entscheidet
 * `climateZoneName`. Bis dahin stand hier in jeder Sprache der deutsche Name - und zwar in Versalien quer über die ganze Zone,
 * die sichtbarste der sechs Stellen.
 */
export const CLIMATE_LABELS: AreaLabelSpec = {
    sourceId: CLIMATE_SOURCE_ID,
    sourceLayer: CLIMATE_SOURCE_LAYER,
    fillLayerId: CLIMATE_FILL_LAYER_ID,
    labelSourceId: CLIMATE_LABEL_SOURCE_ID,
    labelLayerId: CLIMATE_LABEL_LAYER_ID,
    bandOf(properties) {
        const key = properties["type_key"];
        if (typeof key !== "string" || key === "") return undefined;
        const stamm = properties["label"];
        return { key, name: climateZoneName(key, typeof stamm === "string" ? stamm : undefined) };
    },
    ausweichen: false,
};

const mercatorX = (lng: number): number => (lng + 180) / 360;
const mercatorY = (lat: number): number => (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;

type Position = readonly number[];
type Polygonal = { type: string; coordinates: unknown };

/** Die Polygone einer Kachelform als Ringe am Boden, ausgedünnt auf etwa einen Bildpunkt (`tolerance`, Mercator). */
function piecesOf(geometry: Polygonal, tolerance: number): Piece[] {
    const polygons =
        geometry.type === "Polygon"
            ? [geometry.coordinates as Position[][]]
            : geometry.type === "MultiPolygon"
              ? (geometry.coordinates as Position[][][])
              : [];
    const pieces: Piece[] = [];
    for (const polygon of polygons) {
        const rings = polygon
            .map((ring) => {
                const flat: number[] = [];
                // GeoJSON schließt den Ring mit dem ersten Punkt; die Rechnung schließt ihn selbst.
                for (let i = 0; i < ring.length - 1; i++) flat.push(mercatorX(ring[i]![0]!), mercatorY(ring[i]![1]!));
                return thinRing(flat, tolerance);
            })
            .filter((ring) => ring.length >= 6);
        if (rings.length > 0) pieces.push(piece(rings));
    }
    return pieces;
}

/** Ein Bildpunkt am Boden bei diesem Zoom (die Welt misst `512 · 2^zoom` Bildpunkte). */
const pixelAt = (zoom: number): number => 1 / (512 * 2 ** zoom);

/** Die Flächen aus den geladenen Kacheln der Füllung, je Schlüssel gesammelt. */
function readBands(map: MapLibreMap, spec: AreaLabelSpec): BandShape[] {
    const tolerance = pixelAt(map.getZoom());
    const bands = new Map<string, AreaBand & { pieces: Piece[] }>();
    for (const feature of map.querySourceFeatures(spec.sourceId, { sourceLayer: spec.sourceLayer })) {
        const read = spec.bandOf(feature.properties);
        if (!read) continue;
        let band = bands.get(read.key);
        if (!band) {
            band = { ...read, pieces: [] };
            bands.set(read.key, band);
        }
        band.pieces.push(...piecesOf(feature.geometry, tolerance));
    }
    return [...bands.values()].map(({ key, name, pieces, properties }) => ({
        key,
        name,
        pieces,
        ...(properties ? { properties } : {}),
    }));
}

const ONLY_SEA: FilterSpecification = ["==", ["get", "region_type"], "meer"];

/**
 * Die Meere, die deckend über den Flächen liegen: In den Landschaften zeichnet die geglättete Quelle sie samt Küstenlinie
 * (`buildSmoothWaterLayers`). Fehlt die Küstenlinie im Stil, gibt es dort keine Quelle für Meere, und nichts deckt die Flächen.
 */
function readSeas(map: MapLibreMap): Piece[] {
    if (!map.getLayer(WATER_LINE_LAYER_ID)) return [];
    const tolerance = pixelAt(map.getZoom());
    return map
        .querySourceFeatures(WATER_SOURCE_ID, { sourceLayer: WATER_SOURCE_LAYER, filter: ONLY_SEA })
        .flatMap((feature) => piecesOf(feature.geometry, tolerance));
}

const samePoints = (a: AreaLabelPoints, b: AreaLabelPoints): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Wie oft neue Kacheln die Formen neu lesen lassen (WI-0266). Gemessen 2026-10-31 auf der Stage (Sprachen): ein Zug, der die Formen neu
 * liest, kostete 11 bis 45 ms, einer ohne 2 bis 5 ms; beim Zoomen kamen Kacheln in fast jedem Bild, und jedes las alles neu. Jetzt liest
 * höchstens ein Zug je `NEULESEN_ABSTAND_MS` nach neuen Kacheln; dazwischen stehen die Namen an den Formen, die schon da sind (die Kamera
 * rechnet trotzdem in jedem Bild). Ein neuer Stil und ein Sprachwechsel lesen sofort, eine reine Verschiebung gar nicht.
 */
export const NEULESEN_ABSTAND_MS = 250;

const reducedMotion = (): boolean => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/**
 * Die Kamera ohne Gelände: Boden in Mercator, Bild in CSS-Pixeln der Karte.
 *
 * 🪤 Seit MapLibre 6 erbt die Karte nicht mehr von der Kamera; deren Umrechnung ohne Gelände liegt an `map._camera.transform`
 * (dieselbe, die `project` und `unproject` mit Gelände rufen). Fehlt sie nach einem Update, rechnen `project` und
 * `unproject`: richtig, geneigt mit Gelände nur teurer.
 *
 * 💣 Bei JEDEM Aufruf neu holen, nie einmal binden: MapLibre ersetzt das Objekt (Projektion aus dem Stil), und die alte
 * Kamera kannte den Innenabstand der Panels nicht. Gebunden standen die Namen um den halben Planer daneben (175 px).
 */
function groundProjection(map: MapLibreMap): GroundProjection {
    type Transform = Partial<MapLibreMap["_camera"]["transform"]>;
    const current = (): Transform | undefined => (map as { _camera?: { transform?: Transform } })._camera?.transform;
    return {
        toGround([x, y]) {
            const ground =
                current()?.screenPointToMercatorCoordinate?.(new Point(x, y)) ??
                MercatorCoordinate.fromLngLat(map.unproject([x, y]));
            return [ground.x, ground.y];
        },
        toScreen([x, y]) {
            const at = new MercatorCoordinate(x, y).toLngLat();
            const screen = current()?.locationToScreenPoint?.(at) ?? map.project(at);
            return [screen.x, screen.y];
        },
    };
}

export function installAreaLabels(
    map: MapLibreMap,
    spec: AreaLabelSpec,
    options: {
        /** Was Panels von der Karte decken (`visibleArea.keepFree`): Dort stünde ein Name unsichtbar. */
        insets: () => Partial<Insets>;
    },
): AreaLabels {
    let shown = new Map<string, Point2>();
    let points: AreaLabelPoints = NO_AREA_LABELS;
    let targets: LabelTarget[] = [];
    let bands: BandShape[] = [];
    let seas: Piece[] = [];
    let shapesStale = true;
    /** Ein Neulesen, das nicht warten darf (neuer Stil, Sprache, noch keine Formen). */
    let dringend = true;
    let gelesenUm = -Infinity;
    let gelesenBeiZoom = Number.NaN;
    let nachzug: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    const projection = groundProjection(map);

    const schedule = (): void => {
        if (frame === 0) frame = requestAnimationFrame(update);
    };

    const show = (next: AreaLabelPoints): void => {
        if (samePoints(points, next)) return;
        points = next;
        (map.getSource(spec.labelSourceId) as GeoJSONSource | undefined)?.setData(next);
    };

    function update(): void {
        frame = 0;
        // Nur wo Flächen UND Namen gezeichnet werden: Ohne Füllung gibt es keine Kacheln zu lesen.
        if (!map.getLayer(spec.labelLayerId) || !map.getLayer(spec.fillLayerId)) {
            shown = new Map();
            targets = [];
            bands = [];
            shapesStale = true;
            dringend = true;
            show(NO_AREA_LABELS);
            return;
        }
        if (shapesStale) {
            const jetzt = performance.now();
            const warten = dringend ? 0 : gelesenUm + NEULESEN_ABSTAND_MS - jetzt;
            if (warten <= 0) {
                const eigene = spec.flaechen;
                bands = eigene
                    ? eigene.lies(map, (geometry) => piecesOf(geometry, pixelAt(map.getZoom())))
                    : readBands(map, spec);
                seas = eigene?.ueberDemMeer === true ? [] : readSeas(map);
                shapesStale = false;
                dringend = false;
                gelesenUm = jetzt;
                gelesenBeiZoom = map.getZoom();
            } else if (nachzug === undefined) {
                // Ruht die Kamera danach, liest der nachgeholte Zug die neuen Kacheln.
                nachzug = setTimeout(() => {
                    nachzug = undefined;
                    schedule();
                }, warten);
            }
        }
        const canvas = map.getCanvas();
        const { top = 0, right = 0, bottom = 0, left = 0 } = options.insets();
        // Größe, Platz und Breite aus derselben Stelle wie die Ebene (am Telefon kleiner, `climateLabelSize`).
        const size = climateLabelSize();
        targets = placeBandLabels(
            bands,
            seas,
            { left, top, right: canvas.clientWidth - right, bottom: canvas.clientHeight - bottom },
            projection,
            spec.flaechen?.raum?.(size) ?? climateLabelRoom(size),
            (name) => spec.flaechen?.breite?.(name, size) ?? climateLabelWidth(name, size),
            { ausweichen: spec.ausweichen },
        );
        const next = composeLabelPoints(shown, targets, projection, reducedMotion());
        shown = next.shown;
        show(next.points);
        // Ein Name, der zu seiner Stelle gleitet, braucht noch Züge; danach ruht die Karte.
        if (!next.settled) schedule();
    }

    const veraltet = (sofort: boolean): void => {
        shapesStale = true;
        if (sofort) dringend = true;
        schedule();
    };
    const tilesArrived = (event: { sourceId?: string }): void => {
        if (
            event.sourceId === spec.sourceId ||
            event.sourceId === WATER_SOURCE_ID ||
            (event.sourceId !== undefined && spec.flaechen?.quellen.includes(event.sourceId) === true)
        ) {
            veraltet(false);
        }
    };
    // Die Ansicht kann gewechselt haben (mit oder ohne Meere).
    const restyled = (): void => veraltet(true);
    // Die Ringe sind auf einen Bildpunkt ihres Zooms ausgedünnt: Nach einem Zoom lesen, nach einer reinen Verschiebung nicht.
    const moved = (): void => {
        if (Math.abs(map.getZoom() - gelesenBeiZoom) > 0.01) veraltet(false);
    };

    /**
     * 💣 **Der Sprachwechsel ist eine Änderung der FORMEN, nicht der Kamera** (WI-0171): Die Namen stehen in der
     * Quelle, nicht als Ausdruck an der Ebene, und ohne diesen Beobachter blätterte die Oberfläche auf Niederländisch
     * um, während quer über der Karte weiter „GEMÄSSIGTE ZONE“ stand - bis zur nächsten Kachel. Am Stapel gesehen,
     * bevor es jemand anders sah.
     */
    const stopLocale = watch(locale, () => veraltet(true));

    map.on("move", schedule);
    map.on("resize", schedule);
    map.on("moveend", moved);
    map.on("styledata", restyled);
    map.on("sourcedata", tilesArrived);
    schedule();

    return {
        points: () => points,
        placed: () => targets,
        remove() {
            stopLocale();
            map.off("move", schedule);
            map.off("resize", schedule);
            map.off("moveend", moved);
            map.off("styledata", restyled);
            map.off("sourcedata", tilesArrived);
            if (frame !== 0) cancelAnimationFrame(frame);
            if (nachzug !== undefined) clearTimeout(nachzug);
            nachzug = undefined;
            frame = 0;
        },
    };
}

/** Die Namen der Klimazonen (WI-0012). */
export function installClimateLabels(map: MapLibreMap, options: { insets: () => Partial<Insets> }): ClimateLabels {
    return installAreaLabels(map, CLIMATE_LABELS, options);
}
