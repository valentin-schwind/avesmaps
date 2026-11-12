import type {
    DataDrivenPropertyValueSpecification,
    ExpressionSpecification,
    LayerSpecification,
    SourceSpecification,
} from "maplibre-gl";
import { labelFamily, VECTOR_TILE_MAX_ZOOM } from "@avesmaps3d/shared";
import { buildAreaNameLayer, climateHaloColour, climateNameColour } from "./landscape-layers";
import type { ImageSink, StyleImageResolver } from "./style-image-resolver";
import { patternPixelRatio, stripePatternImage, type StripePatternImage } from "./stripe-pattern";

/**
 * Die Ebene Derographie › Sprachen (WI-0261 S5a; E1, E2, E5; Bauvorlage: die Probierseite vom 2026-10-30, `karte.js`
 * `zeichneKarte` und `baueLagen`).
 *
 * - **Flächen:** je Sprache in ihrer Farbe (`farbe` der Kachel `sprache_flaeche_render`), Kontur in derselben Farbe. Kleine
 *   Teilflächen liegen oben (`fill-sort-key`), damit eine Enklave nicht unter der großen Fläche verschwindet.
 * - **Mischgebiete** (E2: wo sich zwei Sprachen überlappen): MapLibre verschneidet keine Flächen, deshalb kommen sie abgeleitet
 *   aus der Datenbank (`sprache_misch_render`, Migration 0257) und liegen als 45°-Schraffur aus beiden Farben über den
 *   Füllungen. Das Muster je Farbpaar baut `stripe-pattern.ts`, wenn MapLibre es anfragt (`sprachMischImageResolver`).
 * - **Namen** wie die Klimazonen (E5): `buildSprachLabelLayer`, gesetzt von `sprachen-labels.ts`.
 * - Nur in ihrer eigenen Ebene, nie in „Alle“ (`layersOfSelection`), und in 3D wie die Klimazonen (`withTerrain`).
 *
 * Wie die Klimazonen liegen die Sprachen unter dem Meer und den Seen: Die Zeichnung legt das Wasser darüber (T-4).
 */

export const SPRACHE_SOURCE_ID = "sprachen";
export const SPRACHE_SOURCE_LAYER = "sprache_flaeche_render";
export const SPRACHE_MISCH_SOURCE_ID = "sprachen-misch";
export const SPRACHE_MISCH_SOURCE_LAYER = "sprache_misch_render";
export const SPRACHE_LABEL_SOURCE_ID = "sprachen-labels";

/**
 * Was eine Operation an Sprachen neu lädt (`QUELLEN_NACH_ART` in `app.vue`, `quellenFuer`): nur die Kacheln der Sprachen und ihrer
 * Mischgebiete. `sprache` meldet der Auftrag `sprache_treffer` nach neuen Mischgebieten (S5a) und der Spracheditor nach Feldern, Farbe und
 * Stand (S5d), `sprache_flaeche` jede Teilfläche (S5d: zeichnen, umformen, stilllegen, zurückholen). Keine andere Kachelsicht liest eine
 * Sprache; ohne Eintrag lüde die Karte nach jedem „Fertig“ alle Quellen.
 */
export const SPRACHEN_QUELLEN_NACH_ART = {
    sprache: [SPRACHE_SOURCE_ID, SPRACHE_MISCH_SOURCE_ID],
    sprache_flaeche: [SPRACHE_SOURCE_ID, SPRACHE_MISCH_SOURCE_ID],
} as const satisfies Readonly<Record<string, readonly string[]>>;

/** Die Füllung der Sprachflächen: an ihr hängen Namen und Gelände (`withTerrain`). */
export const SPRACHE_FILL_LAYER_ID = "sprachen-fill";
export const SPRACHE_MISCH_LAYER_ID = "sprachen-misch-fill";
export const SPRACHE_LINE_LAYER_ID = "sprachen-line";
export const SPRACHE_LABEL_LAYER_ID = "sprachen-label";
/** Die helle Lasur der gezeigten Sprache (WI-0261 S5b, `sprachen-auswahl.ts`). */
export const SPRACHE_HOVER_FILL_LAYER_ID = "sprachen-hover-fill";

/** Der Feature-State der Teilflächen der gezeigten Sprache (`sprachen-auswahl.ts` setzt ihn). */
export const SPRACHE_HOVER_STATE = "sprachHover";

/** Liegt dieser Teil unter dem Zeiger? Ein Ausdruck über den Feature-State, ohne Filterarbeit. */
const GEZEIGT: ExpressionSpecification = ["boolean", ["feature-state", SPRACHE_HOVER_STATE], false];

/** Die Werte der Bauvorlage für das Zeigen (WI-0261 S5b; `karte.js`, `hoverP` und `zeichneKarte`). */
export const SPRACHE_HOVER = {
    /** Die helle Lasur: Weiß mit 0,2 Deckkraft. */
    lasur: "#ffffff",
    lasurOpacity: 0.2,
    /** Die Kontur der gezeigten Sprache (sonst `SPRACHE_DARSTELLUNG.lineWidth`, 1,1 px). */
    lineWidth: 2.4,
} as const;

/**
 * Die Darstellung, Werte der Bauvorlage (`karte.js`, `zeichneKarte`; abgenommen 2026-10-30). Die Kartografietafel
 * (`config/map-cartography/aventuria.json`, `layers`) führt nur Ebenen der Landschaftskacheln; trüge sie eine Zeile „sprachen“,
 * zeichnete `buildLandscapeLayers` die Ebene ein zweites Mal aus `region_area_render`. Im Designkanon passt kein Wert: Die
 * Klimazonen stehen bei 0,5 Füllung und 0,25 Kante, die Derographie bei 0,12 und 0,8; die Auswahl (`mapSelection`) ist ein
 * Zustand, keine Ebene. Deshalb stehen die Zahlen hier, mit Herkunft.
 */
export const SPRACHE_DARSTELLUNG = {
    /** Deckkraft der Füllung (Vorlage: `fill-opacity` 0,56). */
    fillOpacity: 0.56,
    /** Deckkraft und Breite der Kontur in der Farbe der Sprache (Vorlage: 0,95 und 1,1 px). */
    lineOpacity: 0.95,
    lineWidth: 1.1,
    /** Deckkraft der Schraffur über den Füllungen (Vorlage: 0,92). */
    mischOpacity: 0.92,
    /**
     * Breite eines Streifens der Schraffur, senkrecht gemessen, bildschirmfest (Vorlage: Muster 10 × 10 mit zwei Streifen zu 5,
     * um 45° gedreht und gegen den Zoom gehalten). Die Musterkachel muss eine Zweierpotenz sein; `stripePatternLayout` trifft
     * 5 px mit 5,03 px (Kante 128, neun Wiederholungen).
     */
    streifenPx: 5,
} as const;

/**
 * Die Teilflächen tragen ihre Kennung als Feature-Id (`promoteId`): Das Zeigen einer Sprache setzt ihren Feature-State (WI-0261 S5b), statt den Filter einer
 * Ebene zu tauschen, der jede Kachel der Quelle neu lüde.
 */
export function buildSprachSource(tileUrl: string): SourceSpecification {
    return {
        type: "vector",
        tiles: [tileUrl],
        minzoom: 0,
        maxzoom: VECTOR_TILE_MAX_ZOOM,
        promoteId: { [SPRACHE_SOURCE_LAYER]: "public_id" },
    };
}

export function buildSprachMischSource(tileUrl: string): SourceSpecification {
    return { type: "vector", tiles: [tileUrl], minzoom: 0, maxzoom: VECTOR_TILE_MAX_ZOOM };
}

/** Der Anfang der Bildnamen der Schraffur; dahinter die beiden Farben ohne `#`: `sprache-misch-ffb901-604c34`. */
export const SPRACHE_MISCH_PREFIX = "sprache-misch-";

/** Der Bildname eines Farbpaars, wie die Ebene ihn aus der Kachel bildet. */
export function sprachMischBildName(farbeA: string, farbeB: string): string {
    return `${SPRACHE_MISCH_PREFIX}${farbeA.replace("#", "")}-${farbeB.replace("#", "")}`;
}

/** Die beiden Farben (ohne `#`) aus einem Bildnamen; `undefined`, wenn er nicht von der Schraffur stammt oder unlesbar ist. */
export function parseSprachMischBildName(name: string): [string, string] | undefined {
    const treffer = /^sprache-misch-([0-9a-f]{6})-([0-9a-f]{6})$/u.exec(name);
    return treffer ? [treffer[1]!, treffer[2]!] : undefined;
}

/** Derselbe Bildname als Ausdruck an der Ebene: aus `farbe_a` und `farbe_b` der Kachel (`#rrggbb`, Kleinbuchstaben, 0254). */
const MISCH_BILD: ExpressionSpecification = [
    "concat",
    SPRACHE_MISCH_PREFIX,
    ["slice", ["get", "farbe_a"], 1],
    "-",
    ["slice", ["get", "farbe_b"], 1],
];

/** Die Schraffur eines Farbpaars als Bild (`stripePatternImage`): die Sprache mit der kleineren Kennung zuerst. */
export function sprachMischBild(farben: readonly [string, string], pixelRatio: number = 1): StripePatternImage {
    return stripePatternImage(farben, SPRACHE_DARSTELLUNG.streifenPx, pixelRatio);
}

/**
 * Legt die Schraffur eines Farbpaars an, sobald MapLibre sie braucht. Angemeldet wird der Auflöser an der EINEN Stelle für alle
 * Laufzeitbilder (`style-image-resolver.ts`); ein neuer Stil fragt das Bild wieder an, eine neue Farbe ein neues.
 */
export function sprachMischImageResolver(map: ImageSink): StyleImageResolver {
    return {
        prefix: SPRACHE_MISCH_PREFIX,
        resolve(id) {
            const farben = parseSprachMischBildName(id);
            if (!farben || map.hasImage(id)) return;
            const bild = sprachMischBild(farben, patternPixelRatio());
            map.addImage(
                id,
                { width: bild.width, height: bild.height, data: new Uint8Array(bild.data.buffer) },
                { pixelRatio: bild.pixelRatio },
            );
        },
    };
}

const FARBE: DataDrivenPropertyValueSpecification<string> = ["get", "farbe"];

/**
 * Füllung, Schraffur, Lasur der gezeigten Sprache und Kontur, von unten nach oben. Die Kontur liegt zuoberst, damit die Grenze einer Sprache auch durch ein
 * Mischgebiet zu sehen ist (Vorlage: Konturen über Mischpfaden); die gezeigte Sprache trägt sie breiter (WI-0261 S5b, Vorlage: 2,4 px).
 */
export function buildSprachLayers(): LayerSpecification[] {
    return [
        {
            id: SPRACHE_FILL_LAYER_ID,
            type: "fill",
            source: SPRACHE_SOURCE_ID,
            "source-layer": SPRACHE_SOURCE_LAYER,
            // Kleine Teilflächen oben: Die Vorlage legt die größten Sprachen zuerst; je Teilfläche gilt dasselbe für Enklaven.
            layout: { "fill-sort-key": ["-", 0, ["to-number", ["get", "area"], 0]] },
            paint: {
                "fill-color": FARBE,
                "fill-opacity": SPRACHE_DARSTELLUNG.fillOpacity,
            },
        },
        {
            id: SPRACHE_MISCH_LAYER_ID,
            type: "fill",
            source: SPRACHE_MISCH_SOURCE_ID,
            "source-layer": SPRACHE_MISCH_SOURCE_LAYER,
            paint: {
                "fill-pattern": MISCH_BILD,
                "fill-opacity": SPRACHE_DARSTELLUNG.mischOpacity,
            },
        },
        {
            id: SPRACHE_HOVER_FILL_LAYER_ID,
            type: "fill",
            source: SPRACHE_SOURCE_ID,
            "source-layer": SPRACHE_SOURCE_LAYER,
            paint: {
                "fill-color": SPRACHE_HOVER.lasur,
                "fill-opacity": ["case", GEZEIGT, SPRACHE_HOVER.lasurOpacity, 0] as ExpressionSpecification,
                "fill-opacity-transition": { duration: 0, delay: 0 },
            },
        },
        {
            id: SPRACHE_LINE_LAYER_ID,
            type: "line",
            source: SPRACHE_SOURCE_ID,
            "source-layer": SPRACHE_SOURCE_LAYER,
            layout: { "line-join": "round" },
            paint: {
                "line-color": FARBE,
                "line-width": [
                    "case",
                    GEZEIGT,
                    SPRACHE_HOVER.lineWidth,
                    SPRACHE_DARSTELLUNG.lineWidth,
                ] as ExpressionSpecification,
                "line-width-transition": { duration: 0, delay: 0 },
                "line-opacity": SPRACHE_DARSTELLUNG.lineOpacity,
            },
        },
    ];
}

/**
 * Die Farben eines Sprachnamens nach der Regel der Klimazonen (Kanon `mapLabel.families.climate`, E5): die Schrift im dunklen
 * Ton der Sprachfarbe (`toneLightness`), der Saum blass im selben Ton. Je Farbe einmal gerechnet.
 */
const namensFarben = new Map<string, { schrift: string; saum: string }>();
export function sprachNamensFarben(farbe: string): { schrift: string; saum: string } {
    let farben = namensFarben.get(farbe);
    if (!farben) {
        farben = { schrift: climateNameColour(farbe), saum: climateHaloColour(farbe) };
        namensFarben.set(farbe, farben);
    }
    return farben;
}

/**
 * Die Namen der Sprachen (E5): Größe, Versalien, Laufweite und Saum wie die Klimazonen (`buildAreaNameLayer`). Die Farben trägt
 * der Punkt (`schrift`, `saum`, aus `sprachNamensFarben`), weil MapLibre keine OKLCH-Rechnung kennt; fehlen sie, gilt die Vorgabe
 * des Kanons für einen Namen ohne Ton.
 */
export function buildSprachLabelLayer(font: string): LayerSpecification {
    const family = labelFamily("climate");
    return buildAreaNameLayer({
        id: SPRACHE_LABEL_LAYER_ID,
        source: SPRACHE_LABEL_SOURCE_ID,
        font,
        textColour: ["coalesce", ["get", "schrift"], family.color],
        haloColour: ["coalesce", ["get", "saum"], family.haloColor],
    });
}
