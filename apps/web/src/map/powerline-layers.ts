import {
    AVENTURIA_POWERLINE_CARTOGRAPHY,
    renderZoomForBand,
    rgbaColour,
    VECTOR_TILE_MAX_ZOOM,
} from "@avesmaps3d/shared";
import type { LayerSpecification, SourceSpecification } from "maplibre-gl";
import { ebenenGrenzen } from "./zoombaender-stand";

/**
 * Die Kraftlinien auf der Karte (WI-0025).
 *
 * ⭐ Drei Leuchtlagen übereinander — Aura, Mitte, Kern —, genau Legacys Stapel
 * (`getPowerlineRenderStyles`, css/features/powerlines.css). Die Breiten sind BILDSCHIRMbreiten und
 * bleiben beim Zoomen gleich, wie Leaflets `weight`.
 *
 * 🪤 Diese Lagen sind statisch und der RÜCKFALL. Die wabernden Stränge und die Bögen am Himmel zeichnet
 * `powerline-arcs.ts` (Stufe 2) in denselben Farben. Solange dessen Netz nicht geladen ist oder wenn
 * es scheitert, stehen hier die drei Lagen auf der gezeichneten Bahn, und die Ansicht bleibt lesbar.
 *
 * 🔴 Farbe, Breite und Deckkraft kommen AUSSCHLIESSLICH aus der Tafel
 * (`config/map-cartography/aventuria-powerlines.json`). Kein Farbliteral in dieser Datei.
 */

export const POWERLINE_SOURCE_ID = "powerlines";
export const POWERLINE_SOURCE_LAYER = "powerline_render";
export const POWERLINE_LABEL_LAYER_ID = "powerline-label";
/** Die unsichtbare, breite Trefferfläche der Linien: Sie hört nur zu, wo die Bögen nicht gezeichnet sind (Rückfall). */
export const POWERLINE_HIT_LAYER_ID = "powerline-hit";
/**
 * Wie breit die Trefferfläche einer Kraftlinie ist (Bildschirmpixel): Legacy legt eine unsichtbare Linie von 22 px unter die
 * 1,5 px breiten Stränge, weil die „kaum treffbar“ sind (`map-features-powerlines.js` L504-520, Forum-Feedback). Am Finger
 * eine Fingerkuppe, wie bei der Route (`ROUTE_HIT_WIDTH`). Die Hälfte davon ist der Spielraum des Zeigers (`reach`).
 */
export const POWERLINE_HIT_WIDTH = { touch: 28, pointer: 22 } as const;
/**
 * Die Knoten der Kraftlinien-Ansicht (Migration 0040): jeder Ort und jedes Label mit
 * Nodix-Kennzeichen und jedes Linienende. Spalten wie die Ortskachel, damit Knoten und Namen nach den
 * Regeln der Orte zeichnen.
 */
export const LEY_NODE_SOURCE_ID = "ley-nodes";
export const LEY_NODE_SOURCE_LAYER = "ley_node_render";

const TAFEL = AVENTURIA_POWERLINE_CARTOGRAPHY;

export function buildPowerlineSource(tileUrl: string): SourceSpecification {
    return { type: "vector", tiles: [tileUrl], minzoom: 0, maxzoom: VECTOR_TILE_MAX_ZOOM };
}

export function buildLeyNodeSource(tileUrl: string): SourceSpecification {
    return { type: "vector", tiles: [tileUrl], minzoom: 0, maxzoom: VECTOR_TILE_MAX_ZOOM };
}

/**
 * Die unsichtbare Trefferfläche der Kraftlinien: auf der gezeichneten Bahn, ohne Farbe. MapLibre prüft Treffer gegen die
 * Breite, nicht gegen die Deckkraft (wie `route-hit`). Wo die Bögen gezeichnet sind, rechnet `powerline-arcs.ts` den Treffer
 * selbst, denn ein Bogen im Raum liegt nicht mehr auf der Bahn am Boden; diese Fläche gilt dann nur im Rückfall.
 */
export function buildPowerlineHitLayer(): LayerSpecification {
    return {
        id: POWERLINE_HIT_LAYER_ID,
        type: "line",
        source: POWERLINE_SOURCE_ID,
        "source-layer": POWERLINE_SOURCE_LAYER,
        // Wie die Linie (Zoomband „Kraftlinien · Linie“, WI-0221): Was nicht gezeichnet wird, ist auch nicht anklickbar.
        ...ebenenGrenzen("kraftlinien.kraftlinien.linie"),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
            "line-width": POWERLINE_HIT_WIDTH.pointer,
            "line-opacity": 0,
        },
    };
}

/** Die drei Leuchtlagen, von unten nach oben. */
export function buildPowerlineLayers(): LayerSpecification[] {
    return TAFEL.glow.map((lage): LayerSpecification => ({
        id: `powerline-${lage.id}`,
        type: "line",
        source: POWERLINE_SOURCE_ID,
        "source-layer": POWERLINE_SOURCE_LAYER,
        ...ebenenGrenzen("kraftlinien.kraftlinien.linie"),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
            // 🪤 Zweimal Durchsichtigkeit, wie in Legacy: im Strich und in der Lage. Sie
            // multiplizieren sich; zusammengerechnet sähe man nicht mehr, woher sie kommen.
            "line-color": rgbaColour(lage.color, lage.alpha),
            "line-opacity": lage.opacity,
            "line-width": lage.widthPx,
        },
    }));
}

/**
 * Der Name einer Kraftlinie, auf ihrer Bahn und etwas darüber, wiederholt entlang der Linie.
 *
 * 🔴 BEWUSSTE ABWEICHUNG VON LEGACY (Betreiberbefund 2026-09-23: „Das Zoomverhalten der
 * Kraftlinienbeschriftungen ist noch ein bisschen komisch“). Legacy setzt den Namen EINMAL in die Mitte
 * jedes Abschnitts und prüft keine Kollision (`drawGlyphsAlong`). Zoomt man hinein, wandert die Mitte
 * aus dem Bild, und die sichtbaren Linien stehen namenlos da - bei Legacy genauso, an denselben
 * Stellen nachgemessen. Hier wiederholt sich der Name im Abstand der Tafel (Legacys 600 px für
 * Wegnamen), und die Namen weichen einander und den Nodices aus, statt übereinander zu stehen.
 *
 * 🪤 Aus der beschnittenen Sicht, nicht aus einer Kachelfunktion: MapLibre setzt die Wiederholungen je
 * Kachelstück selbst. Die erste Fassung (`powerline_label_tile`, `line-center`) stand einmal je
 * Abschnitt und brauchte dafür die ungeschnittene Linie.
 *
 * 🪤 Legacy zeigt sie ab SEINER Zoomstufe 2, bei uns eine Stufe höher (WI-0015).
 */
export function buildPowerlineLabelLayer(font: string): LayerSpecification {
    const label = TAFEL.label;
    return {
        id: POWERLINE_LABEL_LAYER_ID,
        type: "symbol",
        source: POWERLINE_SOURCE_ID,
        "source-layer": POWERLINE_SOURCE_LAYER,
        // Das Zoomband „Kraftlinien · Name“ (WI-0221); Vorgabe ist Legacys Stufe aus der Tafel.
        ...ebenenGrenzen("kraftlinien.kraftlinien.name", renderZoomForBand(label.fromLegacyZoom)),
        filter: ["==", ["get", "label_visible"], true],
        layout: {
            "symbol-placement": "line",
            "symbol-spacing": label.repeatPx,
            "text-field": ["get", "name"],
            "text-font": [font],
            "text-size": label.sizePx,
            // Über der Linie, nicht auf ihr: Legacys `dy -10` beziehungsweise `perpOffset 10`. In em,
            // weil MapLibre den Versatz in Schriftgrößen rechnet; negativ heißt nach oben.
            "text-offset": [0, -label.offsetPx / label.sizePx],
            // Kollision an: kein Name über einem anderen. Die Nodices liegen im Stapel darüber und
            // werden zuerst gesetzt - ihre Namen gewinnen.
            "text-allow-overlap": false,
        },
        paint: {
            "text-color": rgbaColour(label.color, label.alpha),
            // Legacys weicher Schein, so weit MapLibre ihn trägt.
            //
            // 💣 Hier stand Legacys 0,14 × Schriftgröße für Saum UND Weichzeichnung. Der Saum lebt im
            // Rand der Glyphenbilder (3 px bei 24 px, bei 18 px also gut 2), und was darüber hinausgeht,
            // füllt die ganze Glyphenkachel: hinter jedem Buchstaben stand ein grauer Kasten, auf hellem
            // Grund deutlich zu sehen (2026-09-23). Die Tafel begrenzt beide jetzt.
            "text-halo-color": rgbaColour(label.haloColor, label.haloAlpha),
            "text-halo-width": label.sizePx * label.haloWidthRatio,
            "text-halo-blur": label.sizePx * label.haloBlurRatio,
        },
    };
}

/**
 * Der Untergrund der Kraftlinien-Ansicht: entsättigt und abgedunkelt — Legacys „Magiersicht“.
 *
 * ⭐ Umrechnung, keine Schätzung: CSS `saturate(s)` mischt zu `s` Farbe und `1 − s` Grau, MapLibres
 * `raster-saturation` −f mischt zu `f` Grau — also −(1 − s). CSS `brightness(b)` multipliziert jeden
 * Kanal mit b, und genau das tut `raster-brightness-max` bei `raster-brightness-min` 0.
 *
 * 🔴 In JEDER Ansicht gesetzt, außerhalb der Kraftlinien auf die neutralen Werte. So läuft auch der
 * Rückweg über Legacys 0,6 s, statt beim Verlassen der Ansicht ohne Übergang zurückzuspringen.
 */
export function magiersichtPaint(entsaettigt: boolean): {
    "raster-saturation": number;
    "raster-brightness-max": number;
    "raster-saturation-transition": { duration: number; delay: number };
    "raster-brightness-max-transition": { duration: number; delay: number };
} {
    const sicht = TAFEL.magiersicht;
    const uebergang = { duration: sicht.transitionMs, delay: 0 };
    return {
        "raster-saturation": entsaettigt ? -(1 - sicht.saturation) : 0,
        "raster-brightness-max": entsaettigt ? sicht.brightness : 1,
        "raster-saturation-transition": uebergang,
        "raster-brightness-max-transition": uebergang,
    };
}

export const LEY_NODE_LAYER_IDS = ["nodix-schein", "nodix-hof", "nodix-ring", "nodix-kern"] as const;

/**
 * Die unsichtbare Trefferfläche der Knoten: so groß wie der Knoten, in jeder Kraftlinien-Ansicht. Über sie trifft ein Klick einen
 * Nodix (Betreiber 2026-10-11: „im kraftlinien editor nicht auf die nodices klicken kann“), auch wenn die Bögen ihn als glühenden
 * Punkt zeichnen (`powerline-arcs.ts`) und keine MapLibre-Ebene ihn sichtbar macht.
 */
export const NODIX_HIT_LAYER_ID = "nodix-treffer";

/**
 * Die Nodices als leuchtende „Ley-Knoten“ (Legacy `_redraw`, map-features-location-canvas-layer.js):
 * ein weicher Schein, die helle Scheibe, eine rosa Scheibe und ein pinker Punkt.
 *
 * 🪤 Der Radius hängt an der Ortsklasse und am Zoom (Außenradius des Ortsmarkers × 1,7). Diese Rechnung
 * kennt die Ortskarte, nicht diese Datei - deshalb kommt sie als Baustein herein: `radius` liefert je
 * Lage den Zoomausdruck, mit einer Umrechnung vom Knotenradius auf den Radius der Lage. Ein
 * `["*", <interpolate>, faktor]` wäre die naheliegende Abkürzung und wird von MapLibre STILL abgelehnt.
 *
 * ⭐ Zeichnen die Bögen (`gluehen`), zeichnen sie auch die Knoten, als glühende, wabernde Punkte (Betreiber 2026-10-11: „kannst du
 * daraus auch - wie die kraftlinien - glühende punkte machen“). Dann steht hier nur die Trefferfläche; die vier Scheiben sind der
 * Rückfall, wenn die Bögen nicht zeichnen.
 */
export function buildLeyNodeLayers(options: {
    source: string;
    sourceLayer: string;
    /** Die Bögen zeichnen die Knoten: nur die Trefferfläche. */
    gluehen?: boolean;
    filter: unknown;
    radius: (lage: (knotenRadius: number) => number) => unknown;
}): LayerSpecification[] {
    const ley = TAFEL.leyKnoten;
    const kreis = (id: string, paint: Record<string, unknown>): LayerSpecification =>
        ({
            id,
            type: "circle",
            source: options.source,
            "source-layer": options.sourceLayer,
            filter: options.filter,
            paint,
        }) as LayerSpecification;
    const treffer = kreis(NODIX_HIT_LAYER_ID, { "circle-radius": options.radius((r) => r), "circle-opacity": 0 });
    if (options.gluehen === true) {
        return [treffer];
    }
    return [
        treffer,
        // Der Schein reicht `glowPx` über die Scheibe hinaus und läuft dort aus (Legacy `shadowBlur`).
        kreis("nodix-schein", {
            "circle-radius": options.radius((r) => r + ley.glowPx),
            "circle-blur": options.radius((r) => ley.glowPx / (r + ley.glowPx)),
            "circle-color": ley.glowColor,
            "circle-opacity": ley.glowOpacity,
        }),
        kreis("nodix-hof", { "circle-radius": options.radius((r) => r), "circle-color": ley.hofColor }),
        kreis("nodix-ring", {
            "circle-radius": options.radius((r) => r * ley.ringShare),
            "circle-color": ley.ringColor,
        }),
        kreis("nodix-kern", {
            "circle-radius": options.radius((r) => Math.max(ley.kernMinPx, r * ley.kernShare)),
            "circle-color": ley.kernColor,
        }),
    ];
}
