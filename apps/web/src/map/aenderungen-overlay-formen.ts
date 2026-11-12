import type { FilterSpecification, LayerSpecification } from "maplibre-gl";
import { AVENTURIA, DESIGN_CANON, canonColour, labelFamily, toRenderLngLat } from "@avesmaps3d/shared";
import type { KartenBild, KartenPunkt, KartenTeil } from "../aenderungen/aenderung-karte-modell";
import { mitMindestkante } from "../aenderungen/aenderung-lage-modell";
import type { KartenAnzeige } from "../aenderungen/karte-ablage";

/**
 * Vorher und Nachher einer Änderung als Ebenen der Karte (WI-0265 B5b; Probierseite `review/wi-0265/aenderungen.html`, Szenen 2 und 4, vom
 * Betreiber am 2026-10-31 als Bauvorlage angenommen): **Vorher blassrot, gestrichelt, „−“; Nachher hellgelb, durchgezogen, „+“**, beide mit Saum, damit sie
 * über jeder Landschaft zu lesen sind. Die Töne stehen im Kanon (`colour.mapChange*`, keine Dunkelwerte: Die Karte bleibt in beiden Themen hell, Guide §23.1).
 *
 * - **Eine eigene Quelle, eigene Ebenen, nicht anklickbar.** Nichts hier nimmt einen Treffer an: Kein Ebenenname steht in einer Liste des
 *   Interaktions-Koordinators, und die Quelle trägt keine Kacheln. Klicks gehen durch.
 * - **Linien** (Wege, Kämme, Umrisse) mit Saum; **Punkte** (Ort, Gipfel, bewegte Stützpunkte, mitgezogene Ecken) als Scheibe mit Rand. Vorher ist eine
 *   Linie gestrichelt, ein Punkt kann es nicht sein: Dort tragen Zeichen und Beschriftung „− Vorher“ / „+ Nachher“ die Bedeutung mit, die Farbe nie allein.
 * - **Die Maße** leiten sich aus der Auswahl der Karte ab (`mapSelection.lineWidth`, `glowWidth`) und aus der Strichelung des Messwerkzeugs
 *   (`measure.lineDash`), nicht aus einer neuen Tafel.
 */

export const OVERLAY_QUELLE = "aenderungen-karte";

export const OVERLAY_EBENEN = {
    // Der heutige Ort einer Änderung ohne Lage im Protokoll (B9): unterste Ebenen, nie zusammen mit Vorher und Nachher.
    heuteSaum: "aenderungen-karte-heute-saum",
    heuteLinie: "aenderungen-karte-heute-linie",
    heutePunkt: "aenderungen-karte-heute-punkt",
    vorherSaum: "aenderungen-karte-vorher-saum",
    nachherSaum: "aenderungen-karte-nachher-saum",
    vorherLinie: "aenderungen-karte-vorher-linie",
    nachherLinie: "aenderungen-karte-nachher-linie",
    verschiebung: "aenderungen-karte-verschiebung",
    vorherPunkt: "aenderungen-karte-vorher-punkt",
    nachherPunkt: "aenderungen-karte-nachher-punkt",
    zeichenVorher: "aenderungen-karte-zeichen-vorher",
    zeichenNachher: "aenderungen-karte-zeichen-nachher",
} as const;

export const OVERLAY_EBENEN_LISTE: readonly string[] = Object.values(OVERLAY_EBENEN);

/** Was `t` am Merkmal sagt. */
const T = {
    heute: "heute",
    vorher: "vorher",
    nachher: "nachher",
    verschiebung: "weg",
    zeichenVorher: "zeichen-vorher",
    zeichenNachher: "zeichen-nachher",
} as const;

/**
 * Die Schrift der Zeichen ist die der Klimanamen (dunkel auf hellem Saum, eine Größe auf jeder Zoomstufe: `labelFamily("climate")`), etwas kleiner,
 * weil sie neben Linien und Scheiben stehen. 🪤 Kein Auffangwert: Fehlt dort die Größe, ist das ein Fehler im Kanon.
 */
const SCHRIFT = labelFamily("climate");
if (SCHRIFT.size === undefined) throw new Error("design canon: label family climate has no size");
const ZEICHEN_ANTEIL = 0.7;

/** Die Maße in Pixeln, bei jedem Zoom gleich (wie der gewählte Weg, `mapSelection.pathWidth`). */
const BREITE = DESIGN_CANON.mapSelection.lineWidth;
const SIZE = {
    linie: BREITE,
    saum: DESIGN_CANON.mapSelection.glowWidth,
    verschiebung: BREITE * 0.75,
    punkt: BREITE * 2,
    punktRand: BREITE * 0.75,
    // Der heutige Ort ist leiser als Vorher und Nachher: eine dünnere Linie mit Saum, eine kleinere Scheibe.
    heuteLinie: BREITE * 0.5,
    heutePunkt: BREITE * 1.5,
    zeichen: SCHRIFT.size * ZEICHEN_ANTEIL,
} as const;

/** Die Strichelung in Vielfachen der Linienbreite (Legacys Messlinie: 10 px Strich, 8 px Lücke bei 4 px). */
const STRICH = [...DESIGN_CANON.measure.lineDash];
/** Die Verbindung zwischen früherer und neuer Lage: dünner und in kurzen Strichen, damit sie nicht für eine Linie des Vorher gehalten wird. */
const VERBINDUNG_STRICH = [1.5, 1.5] as const;
const RUND = { "line-cap": "round", "line-join": "round" } as const;

export interface MerkmalEigenschaften {
    readonly t: string;
    /** Der Text eines Zeichens („− Vorher“). */
    readonly z?: string;
}

export interface OverlayMerkmal {
    readonly type: "Feature";
    readonly properties: MerkmalEigenschaften;
    readonly geometry:
        | { readonly type: "LineString"; readonly coordinates: readonly (readonly [number, number])[] }
        | { readonly type: "Point"; readonly coordinates: readonly [number, number] };
}

export interface OverlayDaten {
    readonly type: "FeatureCollection";
    readonly features: readonly OverlayMerkmal[];
}

/** Die Texte der zwei Zeichen auf der Karte. */
export interface OverlayTexte {
    readonly vorher: string;
    readonly nachher: string;
}

/** Ein Punkt der Karte (`aventuria-v1`) in der Renderprojektion der Kamera; die eine Umrechnung des Hauses (`toRenderLngLat`, ADR-0003). */
export function renderPunkt([x, y]: KartenPunkt): [number, number] {
    const lage = toRenderLngLat(AVENTURIA.coordinateSpace, { x, y });
    return [lage.lng, lage.lat];
}

/** Wo das Zeichen eines Teils steht: auf einer Linie ihr mittlerer Stützpunkt, an einem Punkt er selbst. */
function anker(teil: KartenTeil | undefined): KartenPunkt | undefined {
    if (teil === undefined) return undefined;
    return teil.art === "punkt" ? teil.punkt : teil.punkte[Math.floor(teil.punkte.length / 2)];
}

function teilMerkmal(teil: KartenTeil, t: string): OverlayMerkmal {
    return teil.art === "punkt"
        ? { type: "Feature", properties: { t }, geometry: { type: "Point", coordinates: renderPunkt(teil.punkt) } }
        : {
              type: "Feature",
              properties: { t },
              geometry: { type: "LineString", coordinates: teil.punkte.map(renderPunkt) },
          };
}

function zeichenMerkmal(teil: KartenTeil | undefined, t: string, text: string): OverlayMerkmal[] {
    const lage = anker(teil);
    return lage === undefined
        ? []
        : [
              {
                  type: "Feature",
                  properties: { t, z: text },
                  geometry: { type: "Point", coordinates: renderPunkt(lage) },
              },
          ];
}

/** Die GeoJSON-Merkmale eines Bildes in Renderkoordinaten. */
export function overlayDaten(bild: KartenBild, texte: OverlayTexte): OverlayDaten {
    return {
        type: "FeatureCollection",
        features: [
            ...(bild.heute?.teile ?? []).map((teil) => teilMerkmal(teil, T.heute)),
            ...bild.vorher.map((teil) => teilMerkmal(teil, T.vorher)),
            ...bild.nachher.map((teil) => teilMerkmal(teil, T.nachher)),
            ...bild.verschiebungen.map((v): OverlayMerkmal => ({
                type: "Feature",
                properties: { t: T.verschiebung },
                geometry: { type: "LineString", coordinates: [renderPunkt(v.von), renderPunkt(v.nach)] },
            })),
            ...zeichenMerkmal(bild.vorher[0], T.zeichenVorher, texte.vorher),
            ...zeichenMerkmal(bild.nachher[0], T.zeichenNachher, texte.nachher),
        ],
    };
}

/** Der Ausschnitt des Bildes in Renderkoordinaten, Südwest und Nordost, für die Kamera; `undefined`, wenn nichts zu zeigen ist. */
export function overlayGrenzen(bild: KartenBild): [[number, number], [number, number]] | undefined {
    if (bild.grenzen === undefined) return undefined;
    // Ein Kasten ohne Fläche (ein Ort, ein Gipfel) bekommt eine Mindestkante: MapLibre rechnet aus ihm sonst keinen Zoom.
    const [minX, minY, maxX, maxY] = mitMindestkante(bild.grenzen);
    const a = renderPunkt([minX, minY]);
    const b = renderPunkt([maxX, maxY]);
    return [
        [Math.min(a[0], b[0]), Math.min(a[1], b[1])],
        [Math.max(a[0], b[0]), Math.max(a[1], b[1])],
    ];
}

const nur = (t: string): FilterSpecification => ["==", ["get", "t"], t] as unknown as FilterSpecification;
/**
 * 🪤 Eine Scheibe nur an Punkten: MapLibre zeichnet eine Kreisebene auch an jedem Stützpunkt einer LINIE derselben Quelle (gesehen auf der Karte: eine Kette
 * gelber Scheiben längs des Nachher). Die Linienebenen dagegen ignorieren Punkte, das Zeichen ist selbst ein Punkt.
 */
const nurPunkte = (t: string): FilterSpecification =>
    ["all", ["==", ["get", "t"], t], ["==", ["geometry-type"], "Point"]] as unknown as FilterSpecification;

/** Die Ebenen, unten nach oben: erst alle Säume, dann die Linien, die Verbindung, die Punkte, zuletzt die Zeichen. */
export function overlayEbenen(): LayerSpecification[] {
    const schein = (id: string, t: string, farbe: string): LayerSpecification => ({
        id,
        type: "line",
        source: OVERLAY_QUELLE,
        filter: nur(t),
        layout: RUND,
        paint: { "line-color": farbe, "line-width": SIZE.saum },
    });
    const zeichen = (id: string, t: string, ink: string, anchor: "bottom-right" | "top-left"): LayerSpecification => ({
        id,
        type: "symbol",
        source: OVERLAY_QUELLE,
        filter: nur(t),
        layout: {
            "text-field": ["get", "z"],
            "text-font": [DESIGN_CANON.typography.mapFontStack],
            "text-size": SIZE.zeichen,
            "text-anchor": anchor,
            "text-offset": anchor === "bottom-right" ? [-0.6, -0.5] : [0.6, 0.5],
            "text-allow-overlap": true,
            "text-ignore-placement": true,
        },
        paint: {
            "text-color": ink,
            "text-halo-color": canonColour("mapCheckHalo"),
            "text-halo-width": SIZE.zeichen * SCHRIFT.haloWidthRatio,
        },
    });
    const scheibe = (id: string, t: string, fuellung: string, rand: string): LayerSpecification => ({
        id,
        type: "circle",
        source: OVERLAY_QUELLE,
        filter: nurPunkte(t),
        paint: {
            "circle-radius": SIZE.punkt,
            "circle-color": fuellung,
            "circle-stroke-color": rand,
            "circle-stroke-width": SIZE.punktRand,
        },
    });
    return [
        // Der heutige Ort (B9): weißer Saum, dünne Linie im Braun der Verbindung, kleine Scheibe mit braunem Rand; nie mit Vorher und Nachher zugleich.
        {
            id: OVERLAY_EBENEN.heuteSaum,
            type: "line",
            source: OVERLAY_QUELLE,
            filter: nur(T.heute),
            layout: RUND,
            paint: { "line-color": canonColour("mapCheckHalo"), "line-width": SIZE.heuteLinie + 2 * SIZE.punktRand },
        },
        {
            id: OVERLAY_EBENEN.heuteLinie,
            type: "line",
            source: OVERLAY_QUELLE,
            filter: nur(T.heute),
            layout: RUND,
            paint: { "line-color": canonColour("mapChangeLink"), "line-width": SIZE.heuteLinie },
        },
        {
            id: OVERLAY_EBENEN.heutePunkt,
            type: "circle",
            source: OVERLAY_QUELLE,
            filter: nurPunkte(T.heute),
            paint: {
                "circle-radius": SIZE.heutePunkt,
                "circle-color": canonColour("mapCheckHalo"),
                "circle-stroke-color": canonColour("mapChangeLink"),
                "circle-stroke-width": SIZE.punktRand,
            },
        },
        schein(OVERLAY_EBENEN.vorherSaum, T.vorher, canonColour("mapChangeBeforeHalo")),
        schein(OVERLAY_EBENEN.nachherSaum, T.nachher, canonColour("mapChangeAfterHalo")),
        {
            id: OVERLAY_EBENEN.vorherLinie,
            type: "line",
            source: OVERLAY_QUELLE,
            filter: nur(T.vorher),
            layout: { "line-join": "round" },
            paint: {
                "line-color": canonColour("mapChangeBeforeLine"),
                "line-width": SIZE.linie,
                "line-dasharray": STRICH,
            },
        },
        {
            id: OVERLAY_EBENEN.nachherLinie,
            type: "line",
            source: OVERLAY_QUELLE,
            filter: nur(T.nachher),
            layout: RUND,
            paint: { "line-color": canonColour("mapChangeAfterLine"), "line-width": SIZE.linie },
        },
        {
            id: OVERLAY_EBENEN.verschiebung,
            type: "line",
            source: OVERLAY_QUELLE,
            filter: nur(T.verschiebung),
            layout: { "line-join": "round" },
            paint: {
                "line-color": canonColour("mapChangeLink"),
                "line-width": SIZE.verschiebung,
                "line-dasharray": [...VERBINDUNG_STRICH],
            },
        },
        scheibe(
            OVERLAY_EBENEN.vorherPunkt,
            T.vorher,
            canonColour("mapChangeBeforeFill"),
            canonColour("mapChangeBeforeLine"),
        ),
        scheibe(
            OVERLAY_EBENEN.nachherPunkt,
            T.nachher,
            canonColour("mapChangeAfterFill"),
            canonColour("mapChangeAfterLine"),
        ),
        zeichen(OVERLAY_EBENEN.zeichenVorher, T.zeichenVorher, canonColour("mapChangeBeforeInk"), "bottom-right"),
        zeichen(OVERLAY_EBENEN.zeichenNachher, T.zeichenNachher, canonColour("mapChangeAfterInk"), "top-left"),
    ];
}

/** Welche Ebenen die Anzeige zeigt: Vorher oder Nachher allein, oder beide samt der Verbindung zwischen ihnen. */
export function ebenenSichtbar(anzeige: KartenAnzeige): ReadonlyMap<string, boolean> {
    const vorher = anzeige !== "nachher";
    const nachher = anzeige !== "vorher";
    return new Map<string, boolean>([
        // Der heutige Ort hat keinen Schalter: Er ist allein auf der Karte, oder die Ebenen tragen nichts.
        [OVERLAY_EBENEN.heuteSaum, true],
        [OVERLAY_EBENEN.heuteLinie, true],
        [OVERLAY_EBENEN.heutePunkt, true],
        [OVERLAY_EBENEN.vorherSaum, vorher],
        [OVERLAY_EBENEN.vorherLinie, vorher],
        [OVERLAY_EBENEN.vorherPunkt, vorher],
        [OVERLAY_EBENEN.zeichenVorher, vorher],
        [OVERLAY_EBENEN.nachherSaum, nachher],
        [OVERLAY_EBENEN.nachherLinie, nachher],
        [OVERLAY_EBENEN.nachherPunkt, nachher],
        [OVERLAY_EBENEN.zeichenNachher, nachher],
        [OVERLAY_EBENEN.verschiebung, vorher && nachher],
    ]);
}
