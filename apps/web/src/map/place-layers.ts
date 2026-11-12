import { usesServerAreaLookup, type Outline } from "./area-lookup";
import { kartenserie, kartenserienKatalog } from "./kartenserien-stand";
import { inSpanne, mitSpanne, ortsreihen, spannenBedingungen, zoomspanne } from "./zoombaender-stand";
import {
    AVENTURIA_POWERLINE_CARTOGRAPHY,
    AVENTURIA_ZOOM_BANDS,
    DESIGN_CANON,
    POINTS_TO_PIXELS,
    canonColour,
    composeView,
    labelFamily,
    TERRITORY_BORDER_TILE_SOURCE,
    TERRITORY_TILE_SOURCE,
    territoryTileTemplate,
    type DisplayHeightPointer,
    type LandscapeSelection,
    type MapView,
    type PeakLabels,
    type TopographyVariant,
    type ViewComposition,
    appearanceFilter,
    bandInterpolateExpression,
    collisionSortKey,
    labelFilter,
    labelSizeExpression,
    spannenObergrenze,
    BAND_COUNT,
    rasterTileTemplate,
    renderZoomForBand,
    type BandSeriesValues,
    type RasterPyramidPointer,
    type TerritoryPointer,
    VECTOR_TILE_MAX_ZOOM,
} from "@avesmaps3d/shared";
import type {
    DataDrivenPropertyValueSpecification,
    FilterSpecification,
    LayerSpecification,
    SourceSpecification,
    StyleSpecification,
} from "maplibre-gl";
import {
    buildAreaLabelSource,
    buildClimateLabelLayer,
    buildClimateLabelSource,
    buildClimateLayers,
    buildClimateSource,
    buildLandscapeHitLayers,
    buildLandscapeLayers,
    buildLandscapeRunSource,
    buildLandscapeSource,
    buildLandscapeNameLayers,
    landscapeFillOpacity,
    TYPE_LINE_LAYERS,
    buildEditorSeenLayer,
    buildSmoothWaterLayers,
    buildWaterSource,
    smoothWaterFor,
    type AreaLabelPoints,
    type ClimateLabelPoints,
    type SmoothWater,
    WATER_SOURCE_ID,
    buildMapLabelSource,
    CLIMATE_LABEL_SOURCE_ID,
    CLIMATE_SOURCE_ID,
    LANDSCAPE_RUN_SOURCE_ID,
    LANDSCAPE_SOURCE_ID,
    MAP_LABEL_SOURCE_ID,
} from "./landscape-layers";
import { buildTileGridLayer, buildTileGridSource, TILE_GRID_SOURCE_ID } from "./tile-grid";
import { buildGradnetzLayers, buildGradnetzSource, GRADNETZ_SOURCE_ID } from "./gradnetz";
import {
    buildHexrasterLayer,
    buildHexrasterSource,
    HEXRASTER_SOURCE_ID,
    type HexrasterDaten,
    type HexrasterTinte,
} from "./hexraster";
import {
    buildSprachLabelLayer,
    buildSprachLayers,
    buildSprachMischSource,
    buildSprachSource,
    SPRACHE_LABEL_SOURCE_ID,
    SPRACHE_MISCH_SOURCE_ID,
    SPRACHE_SOURCE_ID,
} from "./sprachen-layers";
import {
    buildFlowArrowLayer,
    buildPathLabelLayer,
    buildPathLabelSource,
    buildPathLayers,
    buildPathSource,
    PATH_LABEL_SOURCE_ID,
    PATH_SOURCE_ID,
} from "./path-layers";
import { displayOfComposition, effectiveDisplay, type EffectiveDisplay, type MapDisplay } from "./map-display";
import {
    buildContourLabelLayer,
    buildContourDetailSource,
    buildContourSource,
    buildHeightTintLayer,
    buildHeightTintSource,
    buildPeakApproximateLayer,
    buildPeakLayer,
    buildPeakSource,
    contourLineLayers,
    CONTOUR_DETAIL_SOURCE_ID,
    CONTOUR_SOURCE_ID,
    HEIGHT_TINT_SOURCE_ID,
    PEAK_SOURCE_ID,
} from "./topography-layers";
import {
    buildPowerlineHitLayer,
    buildPowerlineLabelLayer,
    buildPowerlineLayers,
    buildPowerlineSource,
    buildLeyNodeLayers,
    buildLeyNodeSource,
    LEY_NODE_SOURCE_ID,
    LEY_NODE_SOURCE_LAYER,
    magiersichtPaint,
    POWERLINE_SOURCE_ID,
} from "./powerline-layers";
import { VIEW_BAND, withTerritoryBand } from "./territory-band";
import { withTerritoryCoats } from "./territory-coat-label";
import {
    buildTerritoryBorderLayers,
    buildTerritoryBorderNameLayer,
    buildTerritoryBorderSource,
    buildTerritoryClaimLayer,
    buildTerritoryFillLayer,
    buildTerritoryLabelLayer,
    buildTerritorySource,
    TERRITORY_BORDER_SOURCE_ID,
    TERRITORY_SOURCE_ID,
} from "./territory-layers";
import {
    AREA_SELECTION_LABEL_SOURCE_ID,
    areaIds,
    buildAreaSelectionLabelLayer,
    buildAreaSelectionLabelSource,
    AREA_PREVIEW_OUTLINE_SOURCE_ID,
    AREA_SELECTION_OUTLINE_SOURCE_ID,
    buildPathPreviewLayer,
    buildPathPreviewSource,
    PATH_PREVIEW_SOURCE_ID,
    buildAreaPreviewOutlineLayer,
    buildAreaPreviewOutlineSource,
    buildAreaSelectionLayers,
    buildAreaSelectionOutlineSource,
    type AreaSelection,
    type DrawnArea,
} from "./area-selection";
import { buildMehrfachMarkierungLayers, markiert, type Mehrfachmarkierung } from "./mehrfach-markierung";
import { startansicht } from "./start-view";

/**
 * The band model stays renderer independent, so it produces plain expression arrays. This adapter
 * is the single boundary where they become MapLibre's own expression type.
 */
function asNumberExpression(expression: unknown): DataDrivenPropertyValueSpecification<number> {
    return expression as DataDrivenPropertyValueSpecification<number>;
}

function asFilter(expression: unknown): FilterSpecification {
    return expression as FilterSpecification;
}

/**
 * Bauwerk oder Siedlung (WI-0011) — ein MERKMAL aus der Tafel, nie `subtype === "gebaeude"`.
 *
 * 💣 Legacy hatte diese Abfrage an sieben Stellen als Klassenvergleich, und mit `stadtviertel`
 * kam die zweite Bauwerksklasse (MCS-012). Eine neue Bauwerksklasse ist hier eine Zeile in
 * `config/zoom-bands/aventuria.json`, keine Codeänderung.
 */
const STRUCTURE = AVENTURIA_ZOOM_BANDS.structure;
const IS_STRUCTURE = ["in", ["get", "subtype"], ["literal", STRUCTURE.classes]];

/**
 * Ein inoffizieller Ort (Kanal OPS-000083): gleiche Form, eigener Ton. Die Kachel trägt dieselbe Aussage wie das Etikett im Infopanel
 * (Migration 0307, samt Rang 4). Eine Kachel ohne die Eigenschaft zeichnet den offiziellen Ton.
 */
const IS_UNOFFICIAL = ["==", ["get", "is_unofficial"], true];

/**
 * Ein Ort, der in DIESEM Band die Hauptstadt eines gezeigten Gebiets ist (WI-0062, F6: in der politischen Ansicht bleiben
 * die Hauptstädte stehen, Legacy `shouldShowLocationMarker`). Die Kachel trägt die Bänder als Ziffernfolge
 * (`capital_bands`, Migration 0055, z. B. „0145“).
 *
 * 🔴 Das Band ist das der ANSICHT (globaler Zustand aus dem Kamerazoom, `territory-band.ts`), nicht `["zoom"]`: Ein Zoom
 * in einem Filter ist der Zoom der Kachel, und in der geneigten Ansicht verschwänden Hauptstädte in fernen Kacheln.
 */
const IS_CAPITAL_OF_SHOWN_TERRITORY = ["in", ["to-string", VIEW_BAND], ["coalesce", ["get", "capital_bands"], ""]];

export const STRUCTURE_MARKER_LAYER_ID = "place-marker-structure";
/** Der Kreis eines Orts. Kreis und Raute sind zwei Ebenen, aber EIN Marker für den Leser (`PLACE_MARKER_LAYERS`). */
export const PLACE_MARKER_LAYER_ID = "place-marker";
/** Die Ebenen, auf die man klickt, um einen Ort zu wählen, und auf denen eine Wegpunktmarke einrastet. */
export const PLACE_MARKER_LAYERS: readonly string[] = [PLACE_MARKER_LAYER_ID, STRUCTURE_MARKER_LAYER_ID];
/** Die Raute des GEWÄHLTEN Bauwerks: Kern gold statt der Farbe aus den Standardwerten (Legacy `--color-marker-active`). */
export const STRUCTURE_MARKER_ACTIVE_IMAGE_ID = "place-marker-structure-active";
export const STRUCTURE_MARKER_IMAGE_ID = "bauwerk-raute";
/** Die Raute eines inoffiziellen Bauwerks (OPS-000083). */
export const STRUCTURE_MARKER_UNOFFICIAL_IMAGE_ID = "bauwerk-raute-inoffiziell";
export const STRUCTURE_HAIRLINE_LAYER_ID = "place-marker-structure-hairline";
export const STRUCTURE_HAIRLINE_IMAGE_ID = "bauwerk-raute-haarlinie";
/** Außenmaß der Raute im Bild (halbe Quadratseite), in logischen Pixeln. */
export const STRUCTURE_IMAGE_OUTER = 32;
/**
 * Das Fragezeichen eines Orts mit ungefährer Lage (WI-0267, Kanal OPS-000067), oben rechts an der Marke. Vier Bilder in der Farbe der
 * Marke: Siedlung und Bauwerk, je offiziell und inoffiziell (OPS-000083). Die Ebene heißt bewusst nicht `place-marker-…` (dorthin hängt `map-checks-layers.ts` Ringe).
 */
export const PLACE_APPROXIMATE_LAYER_ID = "place-approximate";
export const APPROXIMATE_BADGE_IMAGE_ID = "ort-ungefaehr";
export const APPROXIMATE_BADGE_STRUCTURE_IMAGE_ID = "ort-ungefaehr-bauwerk";
export const APPROXIMATE_BADGE_UNOFFICIAL_IMAGE_ID = "ort-ungefaehr-inoffiziell";
export const APPROXIMATE_BADGE_STRUCTURE_UNOFFICIAL_IMAGE_ID = "ort-ungefaehr-bauwerk-inoffiziell";

/** Die dunkle 1-px-Linie um jeden Marker (Legacy: `disc(outer + 1, rgba(0,0,0,.55))`). */
const HAIRLINE = AVENTURIA_ZOOM_BANDS.spacing["haarlinie"] ?? 0;

/**
 * Der Goldring der Metropolen (Legacy `isCapital` / `accentRing`).
 *
 * 🪤 Legacy prüft zusätzlich `markerSize >= 14`. Bei einer Tafel, die nur wächst, ist das dasselbe
 * wie „ab dem ersten Band, auf dem der Marker 14 px erreicht" — hier je Klasse ausgerechnet, damit
 * der Filter eine Zoomschwelle bleibt und kein Größenvergleich zur Laufzeit.
 */
const CAPITAL = AVENTURIA_ZOOM_BANDS.capital;
export const CAPITAL_RING_LAYER_ID = "place-marker-capital";
/**
 * Der gelbe Kreis um den GEWÄHLTEN Ort (WI-0194, EDIT-0003 T33 (2); Betreiber 2026-10-16: „Ein gelber Kreis um selektierte Orte wäre
 * analog zur dicken Markierung bei Wegen angemessen (auch im Frontend). Manche Orte sind einfach sehr klein aus der Entfernung“).
 * Wie das Band unter einem gewählten Weg (`area-selection.ts`): eine Scheibe im Gold der Auswahl (`colour.mapSelection`, Deckkraft
 * `mapSelection.pathOpacity`) UNTER der Marke, die `mapSelection.lineWidth` über ihren äußersten Strich hinausreicht - dieselbe
 * Breite wie die Kontur einer gewählten Fläche -, und mindestens `mapSelection.pathWidth` Radius hat, die Breite des Bands am Weg:
 * Ein Dorf ist aus der Ferne 3 px groß, 4 px darum herum sähe man dort kaum. Keine neue Zahl, keine Bewegung (Guide §29.1).
 */
export const PLACE_SELECTION_LAYER_ID = "place-selection";
export const HAIRLINE_LAYER_ID = "place-marker-hairline";

export function capitalRingWidth(outerDiameter: number): number {
    return outerDiameter >= CAPITAL.minDiameter ? Math.round(outerDiameter * CAPITAL.ringRatio) : 0;
}

export function capitalStartBand(klasse: string): number | null {
    if (!CAPITAL.classes.includes(klasse)) {
        return null;
    }
    const serie = AVENTURIA_ZOOM_BANDS.marker[klasse] ?? [];
    // Ab wann der Ring erscheinen darf, sagt das Zoomband „Goldring“ (WI-0221); die Größe der Marke bleibt die der Tafel.
    for (let band = zoomspanne("orte.goldring.zeichen").von; band < BAND_COUNT; band += 1) {
        const d = serie[band];
        if (d !== null && d !== undefined && d >= CAPITAL.minDiameter) {
            return band;
        }
    }
    return null;
}

/**
 * Wie weit der gezeichnete Marker vom Mittelpunkt zum Namen hin reicht — sein äußerster Strich.
 *
 * Kreis: Außenradius + Haarlinie. Metropole mit Goldring: Außenradius + Ring + Kante. Raute: die
 * SPITZE, also √2 × (Außenmaß + Haarlinie).
 */
export function markerExtent(klasse: string, band: number, outerDiameter: number, contourRatio: number): number {
    const aussen = markerCoreRadius(outerDiameter, contourRatio) + markerContourWidth(outerDiameter, contourRatio);
    if (STRUCTURE.classes.includes(klasse) && band >= zoomspanne("orte.bauwerk.zeichen").von) {
        return (aussen + HAIRLINE) * Math.SQRT2;
    }
    const start = capitalStartBand(klasse);
    if (start !== null && band >= start) {
        return aussen + capitalRingWidth(outerDiameter) + 1;
    }
    return aussen + HAIRLINE;
}

/**
 * Die Raute als Laufzeitbild — Legacys `_square`: ein um 45° gedrehtes Quadrat, außen die weiße
 * Kontur (halbe Seite = Außenradius), innen der Kern in der Farbe aus den Standardwerten (halbe Seite = Kernradius).
 *
 * 🪤 MapLibre kennt keine Formen, nur Bilder (siehe `drawFlowArrowImage`). Ein Bild reicht für
 * jede Größe, weil Kern und Kontur in festem Verhältnis stehen; `icon-size` skaliert beides.
 * Nur die Konturuntergrenze von 0,5 px fällt dabei weg — sie greift erst unter 2 px Kern, und so
 * klein erscheint keine Raute.
 */
export function drawStructureMarkerImage(
    pixelRatio = 2,
    variante: "raute" | "inoffiziell" | "haarlinie" | "aktiv" = "raute",
): ImageData {
    const contourRatio = (AVENTURIA_ZOOM_BANDS.spacing["kontur"] ?? 0) / 100;
    const aussen = STRUCTURE_IMAGE_OUTER * pixelRatio;
    const kern = aussen / (1 + contourRatio);
    // Die Diagonale der gedrehten Raute ist √2 × Seite; das Bild muss sie ganz fassen.
    const groesse = Math.ceil(aussen * Math.SQRT2 * 2) + 2;
    const canvas = document.createElement("canvas");
    canvas.width = groesse;
    canvas.height = groesse;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        throw new Error("Bauwerk-Raute: kein 2D-Kontext");
    }
    ctx.translate(groesse / 2, groesse / 2);
    ctx.rotate(Math.PI / 4);
    if (variante === "haarlinie") {
        // Eine flache dunkle Raute, von der Ebene eine Haarlinie größer skaliert als die Marke: so hat
        // die Linie in jeder Größe genau `haarlinie` px, statt mit dem Bild zu schrumpfen.
        ctx.fillStyle = canonColour("markerHairline");
        ctx.fillRect(-aussen, -aussen, aussen * 2, aussen * 2);
        return ctx.getImageData(0, 0, groesse, groesse);
    }
    ctx.fillStyle = canonColour("markerSettlementContour");
    ctx.fillRect(-aussen, -aussen, aussen * 2, aussen * 2);
    // Gewählt füllt sich der Kern gold, die Kontur bleibt (Legacy: `fill` wird zu `activeGold`).
    ctx.fillStyle =
        variante === "aktiv"
            ? canonColour("markerActive")
            : variante === "inoffiziell"
              ? startansicht().bauwerkFarbeInoffiziell
              : startansicht().bauwerkFarbeOffiziell;
    ctx.fillRect(-kern, -kern, kern * 2, kern * 2);
    return ctx.getImageData(0, 0, groesse, groesse);
}

/**
 * Das Plättchen der ungefähren Lage (WI-0267): weiß wie die Kontur der Marke, Rand und „?“ in der Farbe der Marke, 16 logische Pixel.
 */
export function drawApproximateBadgeImage(
    pixelRatio = 2,
    art: "siedlung" | "bauwerk" = "siedlung",
    inoffiziell = false,
): ImageData {
    const groesse = 16 * pixelRatio;
    const canvas = document.createElement("canvas");
    canvas.width = groesse;
    canvas.height = groesse;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        throw new Error("Fragezeichen der ungefähren Lage: kein 2D-Kontext");
    }
    const farbe =
        art === "bauwerk"
            ? inoffiziell
                ? startansicht().bauwerkFarbeInoffiziell
                : startansicht().bauwerkFarbeOffiziell
            : inoffiziell
              ? startansicht().ortFarbeInoffiziell
              : startansicht().ortFarbeOffiziell;
    const mitte = groesse / 2;
    ctx.beginPath();
    ctx.arc(mitte, mitte, 6.5 * pixelRatio, 0, Math.PI * 2);
    ctx.fillStyle = canonColour("markerSettlementContour");
    ctx.fill();
    ctx.lineWidth = 1.5 * pixelRatio;
    ctx.strokeStyle = farbe;
    ctx.stroke();
    ctx.fillStyle = farbe;
    ctx.font = `700 ${String(10 * pixelRatio)}px Georgia, "Times New Roman", serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", mitte, mitte + 0.5 * pixelRatio);
    return ctx.getImageData(0, 0, groesse, groesse);
}

/**
 * Das erste Band, in dem jede Ortsklasse ihre volle Markengröße erreicht hat (Tafel `marker`, heute Band 6, Kartenzoom 7). Ab dort steht das
 * Fragezeichen der ungefähren Lage (Vali 2026-10-31: „lass es erst in höheren zoomstufen erscheinen wenn man es wirklich sieht“): Davor wäre
 * das 16-px-Plättchen größer als die Marke, an der es hängt.
 */
export function volleMarkeAb(marker: Readonly<Record<string, BandSeriesValues>>): number {
    let ab = 0;
    for (const reihe of Object.values(marker)) {
        const werte = reihe.filter((wert): wert is number => typeof wert === "number");
        if (werte.length === 0) continue;
        ab = Math.max(ab, reihe.indexOf(Math.max(...werte)));
    }
    return ab;
}

/**
 * Die Ortsklassen nach ihrem Rang, der wichtigste zuerst (WI-0135). Betreiber 2026-10-11: „metropole > großstadt > stadt >
 * kleinstadt > dorf > gebäude“ und „es sollte auf keinen fall passieren, dass ein dorflabel ein metropolenmarker verdeckt. es
 * darf ausweichen aber wenn es nichts findet muss es weg bis der zoom es erlaubt.“
 *
 * 🔴 Das ist die Reihenfolge von `label_class_rank` (Migration 0017); das Stadtviertel steht dort zwischen Dorf und Gebäude.
 * Die Namen einer Klasse stehen jetzt in eigenen Ebenen, und MapLibre setzt Ebenen von oben nach unten. Deshalb entscheidet
 * über Klassengrenzen hinweg diese Liste, innerhalb einer Klasse weiter `collision_rank` aus der Kachel.
 * `apps/web/test/place-layers.test.ts` hält die Liste gleich mit der Tafel der Migration.
 */
export const PLACE_CLASSES_BY_RANK = [
    "metropole",
    "grossstadt",
    "stadt",
    "kleinstadt",
    "dorf",
    "stadtviertel",
    "gebaeude",
] as const;

/** Auf welcher Seite des Markers ein Name steht. */
export type PlaceLabelSide = "right" | "left";

/** Die Namensebene einer Klasse und Seite: rechts zuerst, links nur, wo rechts nichts frei war. */
export function placeLabelLayerId(klasse: string, seite: PlaceLabelSide): string {
    return `place-label-${klasse}-${seite}`;
}

/** Alle Ebenen der Ortsnamen, in der Reihenfolge, in der MapLibre sie setzt. */
export const PLACE_LABEL_LAYER_IDS: readonly string[] = PLACE_CLASSES_BY_RANK.flatMap((klasse) => [
    placeLabelLayerId(klasse, "right"),
    placeLabelLayerId(klasse, "left"),
]);

/** Die Namen der Nodices in der Kraftlinien-Ansicht, wie die Ortsnamen je Klasse und Seite (WI-0135). */
export function nodixLabelLayerId(klasse: string, seite: PlaceLabelSide): string {
    return `nodix-label-${klasse}-${seite}`;
}

export const NODIX_LABEL_LAYER_IDS: readonly string[] = PLACE_CLASSES_BY_RANK.flatMap((klasse) => [
    nodixLabelLayerId(klasse, "right"),
    nodixLabelLayerId(klasse, "left"),
]);

/** Der Name des gewählten Orts, je Klasse eine Ebene (sein Abstand hängt am Marker seiner Klasse). */
export function placeActiveLabelLayerId(klasse: string): string {
    return `place-active-label-${klasse}`;
}

export const PLACE_ACTIVE_LABEL_LAYER_IDS: readonly string[] = PLACE_CLASSES_BY_RANK.map(placeActiveLabelLayerId);

/**
 * Die Sperrfläche der Markierungen einer Klasse (WI-0135): eine unsichtbare Symbolebene, die jede gezeichnete Markierung als
 * Fläche in die Kollision einträgt. Sie liegt unter den Namen ihrer Klasse und über denen aller kleineren Klassen; so weicht
 * jeder Name den Markierungen größerer Orte aus, und kein Dorfname liegt je auf einer Metropole.
 *
 * 🪤 Kreis und Ring sind `circle`-Ebenen, und die nehmen in MapLibre NIE an der Kollision teil; die Raute steht bewusst mit
 * `icon-ignore-placement`. Deshalb zeichnen die Ebenen weiter wie bisher, und nur diese Ebenen belegen den Platz.
 */
export function placeCollisionLayerId(klasse: string): string {
    return `place-collision-${klasse}`;
}

export const PLACE_COLLISION_LAYER_IDS: readonly string[] = PLACE_CLASSES_BY_RANK.map(placeCollisionLayerId);
export const PLACE_COLLISION_IMAGE_ID = "place-collision";
/** Halbe Kantenlänge des durchsichtigen Quadrats in logischen Pixeln; `icon-size` ist damit die halbe Kante in px. */
export const MARKER_COLLISION_IMAGE_HALF = 1;
/** Die kleinste halbe Kante der Sperrfläche: Auch ein winziger Marker belegt so wenigstens einen Punkt. */
const MARKER_COLLISION_MIN_HALF = 0.25;
/**
 * Abstand, um den die Sperrfläche den Namen ihres Orts verfehlt. MapLibres Gitter zählt eine Berührung als Kollision (`<=`).
 */
const MARKER_COLLISION_SLACK = 0.25;

/** Das durchsichtige Quadrat der Sperrfläche (alle Pixel 0). MapLibre setzt es wie jedes Bild; zu sehen ist nichts. */
export function drawMarkerCollisionImage(pixelRatio = 2): ImageData {
    const kante = MARKER_COLLISION_IMAGE_HALF * 2 * pixelRatio;
    return new ImageData(kante, kante);
}

/**
 * Wie weit eine Markierung einer Klasse auf einem Band vom Mittelpunkt reicht, aus ihrem Außendurchmesser in der Bandtafel:
 * beim Ort `markerExtent` (Haarlinie, Goldring, Rautenspitze), beim Nodix der Radius seines Knotens (`leyKnotenRadius`).
 */
export type MarkerAusdehnung = (klasse: string, band: number, durchmesser: number) => number;

/**
 * Eine Kurve über den Zoom aus der Ausdehnung der Markierung EINER Klasse, mit einem Stop je Band.
 * Unterhalb des ersten Bandes gilt die erste gefüllte Zelle: Dort steht nur der gewählte Ort, und der trägt diese Größe.
 */
function markerKurve(
    klasse: string,
    serie: BandSeriesValues,
    ausdehnung: MarkerAusdehnung,
    wert: (aussen: number) => number | [number, number],
): unknown[] {
    const erste = serie.find((d) => d !== null && d !== undefined) ?? 0;
    const kurve: unknown[] = ["interpolate", ["linear"], ["zoom"]];
    for (let band = 0; band < BAND_COUNT; band += 1) {
        const v = wert(ausdehnung(klasse, band, serie[band] ?? erste));
        kurve.push(renderZoomForBand(band), Array.isArray(v) ? ["literal", v] : v);
    }
    return kurve;
}

/**
 * Halbe Kante der Sperrfläche einer Klasse, stufenlos über den Zoom (`icon-size` wird wie `text-size` je Bild
 * ausgewertet).
 *
 * 🔴 Um `spalt − namensspalt` KLEINER als die gezeichnete Markierung. Ein Ortsname trägt `text-padding = spalt`; so bleibt
 * zwischen jedem fremden Ortsnamen und der Markierung derselbe Namensspalt wie beim eigenen Namen.
 */
function markerSperrGroesse(
    klasse: string,
    serie: BandSeriesValues,
    ausdehnung: MarkerAusdehnung,
    zusatz = -MARKER_COLLISION_SLACK,
): unknown[] {
    const spalt = AVENTURIA_ZOOM_BANDS.spacing["spalt"] ?? 0;
    const namensspalt = AVENTURIA_ZOOM_BANDS.spacing["namensspalt"] ?? 0;
    return markerKurve(
        klasse,
        serie,
        ausdehnung,
        (aussen) =>
            Math.max(MARKER_COLLISION_MIN_HALF, aussen + namensspalt - spalt + zusatz) / MARKER_COLLISION_IMAGE_HALF,
    );
}

/**
 * Der Abstand des Namens vom Mittelpunkt: äußerster Strich plus Namensspalt, STUFENLOS (WI-0135, Betreiber 2026-10-11:
 * „nah am marker ist perfekt“).
 *
 * 💣 Hier stand ein em-Wert in `text-radial-offset`. Der ist eine LAYOUT-Eigenschaft, die MapLibre nur auf ganzen Stufen
 * auswertet; zwischen zwei Stufen wächst er nur mit der Schrift, der Marker aber viel schneller (Metropole Band 0 bis 6:
 * Marker × 8, Schrift × 2,4). Fest gewählt stand der Name bei kleinem Zoom weit weg, je Stufe gewählt sprang er.
 * `text-translate` dagegen ist eine Zeichen-Eigenschaft und folgt dem Zoom in jedem Bild, genau wie der Kreis. Sie gilt für
 * die ganze Ebene und kennt keine Seite, deshalb hat jede Klasse und Seite ihre eigene Ebene.
 */
function namensVersatz(
    klasse: string,
    serie: BandSeriesValues,
    ausdehnung: MarkerAusdehnung,
    seite: PlaceLabelSide,
): unknown[] {
    const namensspalt = AVENTURIA_ZOOM_BANDS.spacing["namensspalt"] ?? 0;
    const richtung = seite === "right" ? 1 : -1;
    return markerKurve(klasse, serie, ausdehnung, (aussen) => [richtung * (aussen + namensspalt), 0]);
}

/** Legacys Untergrenze der Kontur (`AVESMAPS_MARKER_CONTOUR_MIN_PX`): nie dünner als ein halbes Pixel. */
const MARKER_CONTOUR_MIN_PX = 0.5;

/** Kernradius aus dem Außendurchmesser — Legacys Aufteilung, die Kontur liegt INNERHALB. */
export function markerCoreRadius(outerDiameter: number, contourRatio: number): number {
    return outerDiameter / 2 / (1 + contourRatio);
}

export function markerContourWidth(outerDiameter: number, contourRatio: number): number {
    return Math.max(MARKER_CONTOUR_MIN_PX, markerCoreRadius(outerDiameter, contourRatio) * contourRatio);
}

/**
 * Der Radius eines Ley-Knotens, also eines Nodix in der Kraftlinien-Ansicht (WI-0025, Legacy `_redraw`): Außenradius des
 * Ortsmarkers mal Faktor, mindestens die Untergrenze. EINE Rechnung für die helle Scheibe und den Abstand ihres Namens.
 */
export function leyKnotenRadius(outerDiameter: number, contourRatio: number): number {
    const ley = AVENTURIA_POWERLINE_CARTOGRAPHY.leyKnoten;
    return Math.max(
        ley.minRadiusPx,
        (markerCoreRadius(outerDiameter, contourRatio) + markerContourWidth(outerDiameter, contourRatio)) *
            ley.radiusFactor,
    );
}

/**
 * Der Radius eines Ley-Knotens der Klasse `klasse` auf dem Render-Zoom `zoom`: dieselbe Rechnung wie die Knotenebenen
 * (`bandInterpolateExpression` über die Bandtafel, unterhalb des Bandes die erste gefüllte Zelle), für die glühenden Knoten der
 * Bögen, die MapLibre nicht zeichnet. Linear zwischen den Bändern, außerhalb das nächste Band; eine Klasse ohne Wert ist 0.
 */
export function leyKnotenRadiusBei(klasse: string, zoom: number): number {
    // Außerhalb des Zoombands „Nodix · Zeichen“ (WI-0221) steht kein Knoten, wie in den Knotenebenen.
    if (!inSpanne("orte.nodix.zeichen", zoom)) return 0;
    const serie = ersteZelleNachUnten(AVENTURIA_ZOOM_BANDS.marker)[klasse] ?? [];
    const kontur = (AVENTURIA_ZOOM_BANDS.spacing["kontur"] ?? 0) / 100;
    const stopps = Array.from({ length: BAND_COUNT }, (_, band) => {
        const d = serie[band];
        return [renderZoomForBand(band), d === null || d === undefined ? 0 : leyKnotenRadius(d, kontur)] as const;
    });
    const erster = stopps[0];
    const letzter = stopps[stopps.length - 1];
    if (!erster || !letzter) {
        return 0;
    }
    if (zoom <= erster[0]) {
        return erster[1];
    }
    for (let i = 1; i < stopps.length; i += 1) {
        const [z1, r1] = stopps[i] as readonly [number, number];
        const [z0, r0] = stopps[i - 1] as readonly [number, number];
        if (zoom <= z1) {
            return r0 + ((r1 - r0) * (zoom - z0)) / (z1 - z0);
        }
    }
    return letzter[1];
}

/**
 * Style for the map slice.
 *
 * The logical Avesmaps bands stay the product semantics; this is the one place that turns them
 * into MapLibre expressions (chapter 4.17.5). Geometry arrives already in the derived render
 * projection (ADR-0003) - the tile stack never sees a map coordinate, and raster and vector tiles
 * share one grid because both are derived by the same transform.
 */

export const PLACE_SOURCE_ID = "places";
/** The font stack the glyph files are generated under (scripts/dev/build-glyphs.mjs). */
export const LABEL_FONT = DESIGN_CANON.typography.mapFontStack;
/**
 * Derselbe Schnitt, synthetisch geneigt — für Ruinen (MCS-015).
 *
 * 🪤 Keine zweite Schrift: `build-glyphs.mjs` zeichnet beide Stapel aus DERSELBEN Datei im selben
 * Browser, nur einmal mit `fontStyle: "italic"`. Genau das tut Legacy auch, es heißt dort nur
 * `font-style: italic` statt Stackname.
 */
export const ITALIC_LABEL_FONT = DESIGN_CANON.typography.mapFontStackItalic;
/** Where our own glyphs are served from; no external font service is involved (chapter 2.1). */
export const GLYPH_URL = "/glyphs/{fontstack}/{range}.pbf";
/**
 * „Nicht umbrechen" in MapLibres Sprache.
 *
 * Es gibt keine Eigenschaft dafuer - nur `text-max-width` in em. Ein Wert, den kein Kartenname
 * erreicht, ist die Entsprechung von Legacys `white-space: nowrap`.
 */
const NO_WRAP = 1000;
/**
 * Ein verborgener Ort bekommt **keinen Namen** auf der Karte — seine Markierung schon (WI-0080).
 *
 * 🔴 Bewusste Abweichung von Legacy, und zwar in der Spielregel, nicht im Aussehen: Legacy zeichnet von einem
 * verborgenen Ort weder Marke noch Namen und lässt ihn dafür über seinen Namen SUCHEN (`MCS-006`, 30 von 3.424
 * Orten). Hier ist es umgekehrt — sichtbar und unsuchbar. Betreiber 2026-10-05, wörtlich: „verborgene orte sind
 * spielerisch nur über die karte zu erkunden, tauchen nicht in der wegpunkt-suche und nicht in der
 * spotlight-suche auf, können aber ganz normal angeklickt und bereist werden, wenn sie entdeckt werden“ und
 * dazu: „‚Erkunden‘ heißt ich scroll auf der Karte herum. Seh ihn und klick ihn an. Ähnlich wie bei ‚Wo ist
 * Waldo?‘“ Der Riegel steht deshalb nur noch an den NAMENSebenen.
 *
 * 💣 Wer ihn versehentlich wieder an eine Markierungsebene hängt, nimmt dem Fund seine einzige Spur: Der Ort ist
 * dann weder zu sehen noch zu finden, und zwar lautlos. Festgehalten in `apps/web/test/place-layers.test.ts`
 * (Marke wie bei jedem Ort, Name nie), `apps/web/e2e/hidden-places.spec.ts` (an der echten Karte) und
 * `apps/server/test/hidden-places.test.ts` (die ganze Regel an einer Stelle).
 *
 * 🔴 Die Marke eines verborgenen Orts steht aber erst ab dem Zoomband „Verborgene Orte“ (OPS-068, `orte.verborgen.zeichen`, Vorgabe
 * Band 8): Sonst fände man auch eine verborgene Großstadt schon aus großer Entfernung. Das ist KEIN Riegel nach dem Muster dieser
 * Konstante, sondern eine zusätzliche Bedingung an der Marke (`verborgenImBand`); der Name bleibt auch dort weg.
 */
const NAMED_PLACE = ["!=", ["get", "is_hidden"], true];
/**
 * Markierungen zeichnen jeden Ort. Ein eigenes Zeichen bekommt ein verborgener Ort NICHT: Er trägt die Marke
 * seiner Art wie jeder andere (Burg, Ruine, Bauwerk), denn eine eigene Form wäre ein zweites Zeichen im Kanon
 * — und eine, die ihn gerade dadurch verriete (`IMPLEMENTATION DETAIL`, WI-0080 §3).
 */
const ANY_PLACE = true;

/**
 * Unterhalb seines Bandes gilt für einen Nodix die ERSTE GEFÜLLTE Zelle seiner Klasse, nicht 0
 * (Legacy `getLocationMarkerSize`) - sonst hätte ein Dorf-Nodix im Überblick keinen Knoten.
 */
function ersteZelleNachUnten(serien: Record<string, BandSeriesValues>): Record<string, BandSeriesValues> {
    return Object.fromEntries(
        Object.entries(serien).map(([klasse, werte]) => {
            const erste = werte.find((wert) => wert !== null && wert !== undefined) ?? null;
            return [klasse, werte.map((wert) => wert ?? erste)];
        }),
    );
}

/** Unterhalb ihres Bandes stehen die Namen der Nodices in einer festen Größe (Legacy: 8 pt). */
function mitUntergrenze(serien: Record<string, BandSeriesValues>, wert: number): Record<string, BandSeriesValues> {
    return Object.fromEntries(
        Object.entries(serien).map(([klasse, werte]) => {
            const ab = werte.findIndex((w) => w !== null && w !== undefined);
            return [klasse, werte.map((w, band) => (ab < 0 || band < ab ? wert : w))];
        }),
    );
}
export const PLACE_SOURCE_LAYER = "place_render";
export const BASEMAP_SOURCE_ID = "basemap";

export interface StyleOptions {
    /** Vector tile template for the places source. */
    tileUrl: string;
    /** Vector tile template for the landscape areas (WI-0003). */
    landscapeUrl: string;
    /** Vector tile template for the derived landscape name runs (WI-0004). */
    landscapeRunUrl: string;
    /** Vector tile template for the map labels that carry no curve (WI-0004, I7). */
    mapLabelUrl: string;
    /** Vector tile template for the derived climate bands (WI-0005). */
    climateUrl: string;
    /**
     * Die Punkte der Zonennamen (WI-0012), wie `area-labels.ts` sie gerade hält. Ohne Angabe keine: Der Stil muss sie
     * mitbringen, sonst leerte `setStyle` mit `diff` die Quelle bei jedem Wechsel.
     */
    climateLabelPoints?: ClimateLabelPoints | undefined;
    /**
     * Die Kachelquellen der Sprachen (WI-0261 S5a): Flächen (`sprache_flaeche_render`) und Mischgebiete (`sprache_misch_render`).
     * Ohne beide gibt es die Ebene „Sprachen“ nicht; ihre Quellen stehen nur im Stil, wenn sie gezeichnet wird.
     */
    sprachenUrl?: string | undefined;
    sprachenMischUrl?: string | undefined;
    /** Die Punkte der Sprachnamen, wie `sprachen-labels.ts` sie gerade hält (wie `climateLabelPoints`). */
    sprachenLabelPoints?: AreaLabelPoints | undefined;
    /** Vector tile template for the paths (WI-0010). */
    pathUrl: string;
    /** Vector tile template for the path name chains (WI-0010 P5). */
    pathLabelUrl: string;
    /** Vector tile template for the powerlines (WI-0025). */
    powerlineUrl: string;
    /** Die Knoten der Kraftlinien-Ansicht (WI-0025, Migration 0040). */
    leyNodeUrl: string;
    /**
     * Zeichnet der Bogen-Layer (`powerline-arcs.ts`) die Kraftlinien? Dann entfallen die statischen
     * Leuchtlagen, sonst stünde jede Linie doppelt. Ohne Angabe: die statischen Lagen (Rückfall).
     */
    powerlineArcs?: boolean | undefined;
    /**
     * Die Revision der Grundkarte, die gilt (ADR-0008). Fehlt sie, zeichnet die Karte ohne
     * Gelände - Orte und Wege bleiben benutzbar, und die Lücke ist sichtbar statt versteckt.
     */
    basemap: RasterPyramidPointer | undefined;
    seriesId: string;
    /** Welche Ansicht die Karte zeigt (WI-0009, Kartenfächer). */
    view: MapView;
    /** Die Auswahl der zweiten Stufe; wirkt nur in der Landschaftsansicht. */
    landscapeSelection: LandscapeSelection;
    /** Darf dieser Viewer die Stroemungspfeile sehen (V11, Capability `view_flow_directions`)? */
    flowDirectionsVisible?: boolean | undefined;
    /** Stehen verborgene Orte auf jeder Stufe (Editor-Modus)? Siehe `LayerOptions.hiddenPlacesAlways`. */
    hiddenPlacesAlways?: boolean | undefined;
    /** Wie breit die unsichtbare Trefferfläche der Wege ist (WI-0090); siehe `LayerOptions.pathHitWidth`. */
    pathHitWidth?: number | undefined;
    /** Das Rechenraster des Höhenmodells einblenden (WI-0070, Editor-Schalter „Kachelraster“). */
    tileGrid?: boolean | undefined;
    /** Das Gradnetz einblenden (WI-0273, Auge › Ebenen › Gradnetz). */
    gradnetz?: boolean | undefined;
    /** Das Hexraster mit den Linien, wie sie gerade stehen (WI-0273, `map/hexraster.ts`); fehlt es, ist es aus. */
    hexraster?: HexrasterDaten | undefined;
    /**
     * Die Klimazone aus der Suche. Sie steht kräftiger als die übrigen, bis man in die Karte klickt
     * (Betreiberwunsch 2026-09-23). Sie wirkt nur, wo Klimabänder gezeichnet werden: welche Ansicht
     * das ist, entscheidet `composeView`, nicht die Hervorhebung.
     */
    highlightedClimateZone?: string | undefined;
    /**
     * Die Schalter des Anzeige-Menüs (WI-0028). Ohne sie zeigt der Stil, was die Ansicht allein
     * zeigte. Was die Ansicht sperrt, entscheidet weiter sie (`effectiveDisplay`).
     */
    display?: MapDisplay | undefined;
    /**
     * Der angeklickte Ort (`public_id`): Sein Kern füllt sich gold, bis man woanders hinklickt
     * (Legacy `setActiveLocationMarker`, Betreiber 2026-09-24: „Ortsmarkierungen sollten gelb sein,
     * wenn man sie anklickt“).
     */
    activePlaceId?: string | undefined;
    /**
     * Die gewählte Fläche (WI-0043): Sie leuchtet in jeder Ansicht und trägt ihren Namen, bis eine andere
     * gewählt oder in die freie Karte geklickt wird.
     */
    areaSelection?: DrawnArea | undefined;
    /** Was in den Listen der Editoren angehakt ist, gelb wie die Einzelauswahl (`mehrfach-markierung.ts`). */
    mehrfachMarkierung?: readonly Mehrfachmarkierung[] | undefined;
    /** Die Höhenlinien (WI-0055, Martin `terrain_contour_tile`: je Zoom nur die sichtbaren Stufen, vereinfacht). */
    contourUrl?: string | undefined;
    /** Die Hunderter im Gebirge, erst aus der Nähe (WI-0055, Martin `terrain_contour_detail_tile`). */
    contourDetailUrl?: string | undefined;
    /** Gipfel und Vulkane (WI-0055, Martin `terrain_peak_render`). */
    peakUrl?: string | undefined;
    /** Die Flächen der Höhenstufen (WI-0055, Martin `terrain_height_band_tile`). */
    heightBandUrl?: string | undefined;
    /** Seen und Meere der Topographie, geglättet (WI-0055, Martin `terrain_water_render`). */
    waterUrl?: string | undefined;
    /**
     * Steht ein Wege-Fenster an einem Fluss (OPS-000116)? Dann zeigt die Karte die Seen aus `waterUrl` auch dort, wo sie selbst keine
     * zeichnet (Standardansicht, „Flüsse und Seen“ aus): Zu- und Abflüsse lassen sich an den See legen, ohne die Ansicht zu wechseln.
     */
    seenBeimFluss?: boolean | undefined;
    /**
     * Der Umriss der Auswahl vom Server (WI-0058), wo die Karte keine Landschaftsflächen zeichnet; `undefined`,
     * solange er unterwegs ist.
     */
    areaOutline?: Outline | undefined;
    /** Der Zeiger der Anzeigehöhen (WI-0055): Ohne ihn gibt es keine Höhenstufen, die Topographie zeigt nur Linien. */
    displayHeight?: DisplayHeightPointer | undefined;
    /**
     * Der Zeiger der Herrschaftsgebiete (WI-0062, ADR-0014): Ohne ihn gibt es keine Gebiete, keine Grenzen und keine
     * Auswahl eines Gebiets - keine alten, sondern keine. Seine Revision steht in der Kachel-Adresse.
     */
    territories?: TerritoryPointer | undefined;
    /**
     * Welche Gebiete ein öffentliches Wappen tragen (WI-0121): Kennung des Gebiets → Bildname (`coat:<sha256>`), gelesen VOR dem
     * Aufbau des Stils, damit die Namen nicht springen, wenn das Wappen nachkäme. Leer oder ohne Angabe: Die Namen stehen
     * allein, wie sie standen.
     */
    territoryCoats?: Readonly<Record<string, string>> | undefined;
    /**
     * Der Kamerazoom, mit dem der Stil gebaut wird: Aus ihm folgt der Anfangswert des Bandes der Herrschaftsgebiete
     * (`territory-band.ts`). Ohne Angabe gilt Zoom 0; die Karte führt den Zustand danach mit der Kamera nach.
     */
    cameraZoom?: number | undefined;
    /** Die Unterwahl der Topographie (WI-0055); wirkt nur bei `topographie`. */
    topography?: TopographyVariant | undefined;
    /** Die Sprache der Oberfläche, für Zahlen auf der Karte (Höhen: „1.000“ oder „1,000“). */
    locale?: string | undefined;
    /** Der Regler „Untergrund“ der Editoren in Prozent (WI-0178 T47); wirkt nur in der Landschaftsansicht (`composeView`). */
    untergrund?: number | undefined;
    /**
     * Der Schalter „Höhenlinien“ der Editoren (WI-0236): `false` lässt Höhenlinien und Höhenzahlen weg, in Höhenlinien wie Höhenstufen,
     * samt ihren Kachelquellen. Höhenstufen und Gipfel bleiben. Ohne Angabe wie bisher (Besucher).
     */
    hoehenlinien?: boolean | undefined;
    /**
     * Treffen die Editoren die Landschaftsflächen auch dort, wo die Karte sie nicht zeichnet (die Höhenstufen)? Siehe
     * `LayerOptions.flaechenTreffer`. Ohne Angabe nicht (Besucher).
     */
    flaechenTreffer?: boolean | undefined;
}

/** Die Kennung der Rasterebene des Untergrunds: Der Regler stellt ihre Deckkraft, ohne den Stil neu zu bauen. */
export const BASEMAP_LAYER_ID = "basemap";

/**
 * Die Deckkraft der Karte bei ◐ = `anteil` (0 bis 1, Regler „Untergrund“ der Editoren, WI-0178 T47). Beim Bau des Stils und beim Ziehen
 * dieselbe Zahl (`untergrund-karte.ts`).
 *
 * 🔴 Über den Höhenstufen mischt ◐ wie in den Höhenlinien (WI-0236, Betreiber 2026-10-19: „Höhenstufen unterstützen übrigens keine
 * transparenz - im gegensatz zum normalen höhenlinienmodus“). Dort liegt die Topographie als Lasur über der Karte, und ◐ tauscht nur das
 * Papier darunter gegen die Karte. Hier sind die Stufen beides, Papier und Lasur: Die Karte bekommt höchstens den Anteil, den die Lasur
 * frei lässt. Bis 2026-11-10 bekam sie ◐ selbst, „100 % nur die Karte“, und bei Valis 75 % sah es aus, als lüden die Stufen nicht
 * (Fund: „Die Buntehöhenkarte ("Höhenstufen") lädt nicht.“).
 */
export function untergrundDeckkraft(anteil: number, ueberHoehenstufen: boolean): number {
    const karte = ueberHoehenstufen ? anteil * (1 - landscapeFillOpacity("topographie", true)) : anteil;
    return Math.round(karte * 1000) / 1000;
}

export function buildPlaceStyle(options: StyleOptions): StyleSpecification {
    return withTerritoryCoats(
        withTerritoryBand(buildPlaceStyleBase(options), options.cameraZoom ?? 0),
        options.territoryCoats ?? {},
    );
}

function buildPlaceStyleBase(options: StyleOptions): StyleSpecification {
    // Aus dem Katalog zur Laufzeit (WI-0220); eine unbekannte Kennung fällt auf die Vorgabe-Serie zurück.
    const series = kartenserie(options.seriesId);
    const license = kartenserienKatalog().license;
    // 🪤 Ein Zeiger einer anderen Serie gilt nicht: während eines Wechsels zeigte er sonst das
    // alte Gelände unter den Einstellungen der neuen Serie.
    const basemap = options.basemap?.series === series.id ? options.basemap : undefined;
    const composition = composeView(options.view, options.landscapeSelection, options.topography, options.untergrund);
    const heightTint =
        composition.heightTints && options.displayHeight !== undefined && options.heightBandUrl !== undefined;
    // Linien wie Stufen nur mit gültigem Zeiger (Kapitel 5.32a, Regel 2): Er fehlt, wenn nichts abgeleitet ist oder
    // die Revision zu einem älteren Gelände gehört. Dann gibt es keine alten Linien, sondern keine.
    const contours =
        composition.contours &&
        options.hoehenlinien !== false &&
        options.contourUrl !== undefined &&
        options.displayHeight !== undefined;
    // Was gezeichnet wird, nach Ansicht UND Anzeige-Menü - hier EINMAL gerechnet, der Stil bekommt es gereicht.
    const zeige = options.display
        ? effectiveDisplay(options.view, composition, options.display)
        : displayOfComposition(composition);
    // Das geglättete Wasser (WI-0055): Topographie und die Seen der übrigen Landschaftsansichten. Ohne Kachelpfad gibt es
    // keine Quelle, und der See bleibt die Fläche der Landschaftskacheln.
    const smoothWater = options.waterUrl === undefined ? undefined : smoothWaterFor(composition, zeige);
    // Die Seen beim Bearbeiten eines Flusses (OPS-000116): nur, wo die Karte sie nicht schon zeichnet.
    const seenBeimFluss =
        options.seenBeimFluss === true && options.waterUrl !== undefined && smoothWater?.lakes !== true;
    const serverLookup =
        options.display?.layers !== false && usesServerAreaLookup(composition, smoothWater !== undefined);
    // Gebiete: nur mit Zeiger. Die Füllquelle für die politische Ansicht und für die Auswahl eines Gebiets (sie leuchtet
    // in jeder Ansicht), die Linienquelle, wo Grenzen gezeichnet werden.
    const territoryData = options.territories !== undefined;
    const territoryFill = territoryData && zeige.territories;
    const territoryBorders = territoryData && zeige.borders !== undefined;
    // Auch ein angehaktes Gebiet der Mehrfachauswahl braucht die Kachelquelle (`mehrfach-markierung.ts`).
    const territorySelected =
        territoryData &&
        (options.areaSelection?.kind === "territory" ||
            (options.mehrfachMarkierung ?? []).some((m) => m.art === "territory" && m.ids.length > 0));
    // Die Sprachen (WI-0261 S5a): nur in ihrer Ebene und mit Flächen (Schalter „Flächen“), wie die Klimazonen; sonst keine Quelle.
    const sprachen =
        options.sprachenUrl !== undefined &&
        options.sprachenMischUrl !== undefined &&
        zeige.landscapeAreas &&
        composition.landscapeLayers.includes("sprachen");

    return {
        version: 8,
        sources: {
            ...(basemap
                ? {
                      [BASEMAP_SOURCE_ID]: {
                          type: "raster",
                          tiles: [rasterTileTemplate(basemap)],
                          // Kachelgröße und Stufen beschreibt die Pyramide selbst: ein Neubau in
                          // anderem Raster braucht dann keinen Frontend-Deploy.
                          tileSize: basemap.tileSize,
                          minzoom: 0,
                          // Above the native level the renderer upscales, exactly like the legacy map did.
                          maxzoom: basemap.maxNativeZoom,
                          // The licence of the map package requires its URI with every distribution, so the
                          // link is part of the attribution itself, not of the notes dialog alone.
                          attribution: `${series.attribution} · <a href="${license.uri}" target="_blank" rel="noopener noreferrer">${license.name}</a>`,
                      } satisfies SourceSpecification,
                  }
                : {}),
            [PLACE_SOURCE_ID]: {
                type: "vector",
                tiles: [options.tileUrl],
                minzoom: 0,
                maxzoom: VECTOR_TILE_MAX_ZOOM,
            },
            [LANDSCAPE_SOURCE_ID]: buildLandscapeSource(options.landscapeUrl),
            [LANDSCAPE_RUN_SOURCE_ID]: buildLandscapeRunSource(options.landscapeRunUrl),
            [MAP_LABEL_SOURCE_ID]: buildMapLabelSource(options.mapLabelUrl),
            [CLIMATE_SOURCE_ID]: buildClimateSource(options.climateUrl),
            [CLIMATE_LABEL_SOURCE_ID]: buildClimateLabelSource(options.climateLabelPoints),
            ...(sprachen && options.sprachenUrl && options.sprachenMischUrl
                ? {
                      [SPRACHE_SOURCE_ID]: buildSprachSource(options.sprachenUrl),
                      [SPRACHE_MISCH_SOURCE_ID]: buildSprachMischSource(options.sprachenMischUrl),
                      [SPRACHE_LABEL_SOURCE_ID]: buildAreaLabelSource(options.sprachenLabelPoints),
                  }
                : {}),
            [PATH_SOURCE_ID]: buildPathSource(options.pathUrl),
            [PATH_LABEL_SOURCE_ID]: buildPathLabelSource(options.pathLabelUrl),
            [POWERLINE_SOURCE_ID]: buildPowerlineSource(options.powerlineUrl),
            [LEY_NODE_SOURCE_ID]: buildLeyNodeSource(options.leyNodeUrl),
            // 🔴 Leer, und zwar absichtlich: Ob die Auswahl überhaupt einen eigenen Namen braucht, weiß nur
            // die laufende Karte (`area-selection-name.ts`, WI-0093). Ein hier gefüllter Name stünde nach
            // jedem Stilumbau für einen Frame neben dem gewöhnlichen - doppelt statt gar nicht.
            [AREA_SELECTION_LABEL_SOURCE_ID]: buildAreaSelectionLabelSource(),
            ...(options.tileGrid === true ? { [TILE_GRID_SOURCE_ID]: buildTileGridSource() } : {}),
            ...(options.gradnetz === true ? { [GRADNETZ_SOURCE_ID]: buildGradnetzSource() } : {}),
            ...(options.hexraster ? { [HEXRASTER_SOURCE_ID]: buildHexrasterSource(options.hexraster) } : {}),
            ...(contours && options.contourUrl ? { [CONTOUR_SOURCE_ID]: buildContourSource(options.contourUrl) } : {}),
            ...(contours && options.contourDetailUrl
                ? { [CONTOUR_DETAIL_SOURCE_ID]: buildContourDetailSource(options.contourDetailUrl) }
                : {}),
            ...(composition.peaks !== "none" && options.peakUrl
                ? { [PEAK_SOURCE_ID]: buildPeakSource(options.peakUrl) }
                : {}),
            ...(heightTint && options.heightBandUrl
                ? { [HEIGHT_TINT_SOURCE_ID]: buildHeightTintSource(options.heightBandUrl) }
                : {}),
            ...((smoothWater || seenBeimFluss) && options.waterUrl
                ? { [WATER_SOURCE_ID]: buildWaterSource(options.waterUrl) }
                : {}),
            ...(options.territories && (territoryFill || territorySelected)
                ? {
                      [TERRITORY_SOURCE_ID]: buildTerritorySource(
                          territoryTileTemplate(TERRITORY_TILE_SOURCE, options.territories),
                      ),
                  }
                : {}),
            ...(options.territories && territoryBorders
                ? {
                      [TERRITORY_BORDER_SOURCE_ID]: buildTerritoryBorderSource(
                          territoryTileTemplate(TERRITORY_BORDER_TILE_SOURCE, options.territories),
                      ),
                  }
                : {}),
            // Die Vorschau beim Zeigen trägt nur die gezeigte Form (WI-0266): aus den Kacheln oder, wo keine Landschaftsflächen
            // gezeichnet werden, vom Server (WI-0058). Leere GeoJSON-Quellen kosten nichts; ob gezeigt wird, sagen die Ebenen.
            [AREA_PREVIEW_OUTLINE_SOURCE_ID]: buildAreaPreviewOutlineSource(),
            [PATH_PREVIEW_SOURCE_ID]: buildPathPreviewSource(),
            // WI-0058: Wo keine Landschaftsflächen gezeichnet werden, kommt die Auswahl vom Server.
            ...(serverLookup && options.areaSelection?.kind === "landscape"
                ? { [AREA_SELECTION_OUTLINE_SOURCE_ID]: buildAreaSelectionOutlineSource(options.areaOutline) }
                : {}),
        },
        glyphs: GLYPH_URL,
        // A series whose names are part of the raster must not get them a second time as vectors.
        layers: buildPlaceLayers({
            labels: !series.labelsInImage,
            flowDirectionsVisible: options.flowDirectionsVisible,
            hiddenPlacesAlways: options.hiddenPlacesAlways,
            flaechenTreffer: options.flaechenTreffer,
            pathHitWidth: options.pathHitWidth,
            tileGrid: options.tileGrid,
            gradnetz: options.gradnetz,
            // In der Derographie dunkel, sonst weiß (WI-0273).
            hexraster: options.hexraster === undefined ? undefined : options.view === "landscapes" ? "dunkel" : "hell",
            composition: { ...composition, basemap: composition.basemap && basemap !== undefined },
            highlightedClimateZone: options.highlightedClimateZone,
            sprachen,
            powerlineArcs: options.powerlineArcs,
            activePlaceId: options.activePlaceId,
            areaSelection: options.areaSelection,
            mehrfachMarkierung: options.mehrfachMarkierung,
            display: zeige,
            territoryData,
            territoryCoats: territoryData && Object.keys(options.territoryCoats ?? {}).length > 0,
            smoothWater,
            seenBeimFluss,
            topography: {
                contours,
                contourDetail: contours && options.contourDetailUrl !== undefined,
                heightTint,
                peaks: options.peakUrl === undefined ? "none" : composition.peaks,
                locale: options.locale ?? "de",
            },
        }),
    };
}

/**
 * Labels are deliberately absent: MapLibre needs glyph ranges, and Avesmaps serves everything from
 * its own infrastructure (chapter 2.1). A self-hosted glyph pipeline with a properly licensed font
 * is its own work item; the label band sizes already live in the zoom band model. A series that
 * carries its names inside the raster must keep the vector labels off in any case.
 */
export interface LayerOptions {
    /** False for a series that carries its names inside the raster. */
    labels: boolean;
    /**
     * Darf dieser Viewer die Stroemungspfeile sehen (Betreiberentscheidung 2026-09-22: „flusspfeile
     * nur für editoren")? Capability `view_flow_directions` (`@avesmaps3d/shared`, M9).
     *
     * 🪤 Es gibt noch keine Rollen — die Anwendung leitet das heute daraus ab, dass eine
     * passwortgeschützte Instanz erreicht wurde. Der Name steht hier trotzdem als Capability, weil
     * die FRAGE dieselbe bleibt, wenn es Rollen gibt; dann liefert die Laufzeit die Antwort.
     */
    flowDirectionsVisible?: boolean | undefined;
    /**
     * Stehen verborgene Orte auf jeder Stufe ihrer Klasse (OPS-068)? Nur im Editor-Modus (`/edit`, dieselbe Frage wie die
     * Strömungspfeile: Capability `view_flow_directions`): Wer Orte pflegt, muss auch verborgene von weitem finden und wieder
     * zeigen können. Ohne Angabe (Besucher, auch in der Besucheransicht des Editors) steht die Marke eines verborgenen Orts erst ab dem Zoomband
     * „Verborgene Orte“ (`orte.verborgen.zeichen`, Vorgabe: ganz nah, Band 8).
     */
    hiddenPlacesAlways?: boolean | undefined;
    /**
     * Die Editoren treffen die Landschaftsflächen auch in den Höhenstufen (Fund 2026-11-10): Dort stehen sie unsichtbar im Stil
     * (`buildLandscapeHitLayers`), damit Kartenmenü und Werkzeuge der Form sie finden. Ohne Angabe nicht: Besucher wählen dort über den
     * Server (WI-0058).
     */
    flaechenTreffer?: boolean | undefined;
    /**
     * Wie breit die unsichtbare Trefferfläche der Wege ist (WI-0090): am Finger eine Fingerkuppe, am Zeiger knapp das
     * Doppelte der Linie. Ohne Angabe die des Zeigers. 🔴 Es ist DIESELBE Zahl wie bei der Route (`ROUTE_HIT_WIDTH`),
     * nicht eine eigene - Begründung in `path-layers.ts`.
     */
    pathHitWidth?: number | undefined;
    /** Das Rechenraster des Höhenmodells über allem (WI-0070). */
    tileGrid?: boolean | undefined;
    /** Das Gradnetz über den Flächen und unter den Wegen (WI-0273). */
    gradnetz?: boolean | undefined;
    /** Das Hexraster an derselben Stelle wie das Gradnetz, in seiner Tinte (WI-0273); fehlt es, ist es aus. */
    hexraster?: HexrasterTinte | undefined;
    /**
     * Was diese Ansicht zeigt (WI-0009).
     *
     * 💣 Der Style entscheidet das NICHT selbst. Wer hier eine Bedingung einbaut, beantwortet die
     * Frage „gehört das zu dieser Ansicht" ein zweites Mal - `composeView` in `@avesmaps3d/shared`
     * ist die eine Stelle dafür.
     */
    composition: ViewComposition;
    /** Die Klimazone aus der Suche, siehe `StyleOptions.highlightedClimateZone`. */
    highlightedClimateZone?: string | undefined;
    /**
     * Stehen die Quellen der Sprachen im Stil (`StyleOptions.sprachenUrl`)? Nur dann zeichnet die Ebene „Sprachen“ Flächen,
     * Mischgebiete und Namen (WI-0261 S5a); welche Ebene gezeigt wird, entscheidet weiter `composeView`.
     */
    sprachen?: boolean | undefined;
    /** Zeichnet der Bogen-Layer die Kraftlinien? Siehe `StyleOptions.powerlineArcs`. */
    powerlineArcs?: boolean | undefined;
    /**
     * Was nach Ansicht UND Anzeige-Menü gezeichnet wird (WI-0028). Ohne Angabe: was die Ansicht
     * allein zeigt.
     */
    display?: EffectiveDisplay | undefined;
    /** Der angeklickte Ort, siehe `StyleOptions.activePlaceId`. */
    activePlaceId?: string | undefined;
    /** Die gewählte Fläche, siehe `StyleOptions.areaSelection`. */
    areaSelection?: AreaSelection | undefined;
    /** Die Mehrfachauswahl der Editoren, siehe `StyleOptions.mehrfachMarkierung`. */
    mehrfachMarkierung?: readonly Mehrfachmarkierung[] | undefined;
    /** Liegen Gebietskacheln vor (Zeiger da)? Nur dann zeichnet der Stil Gebiete, Grenzen und ihre Auswahl (WI-0062). */
    territoryData?: boolean | undefined;
    /** Gibt es Wappen der Gebiete (`StyleOptions.territoryCoats`)? Dann tragen die Namen der Gebiete sie mit, auch der des gewählten. */
    territoryCoats?: boolean | undefined;
    /**
     * Welches Wasser die geglättete Quelle zeichnet (`smoothWaterFor`); ohne Angabe keines, und der See bleibt die
     * Fläche der Landschaftskacheln. Mit der Quelle leuchten und umreißen See und Meer in ihrer weichen Form.
     */
    smoothWater?: SmoothWater | undefined;
    /** Die Seen beim Bearbeiten eines Flusses, siehe `StyleOptions.seenBeimFluss`; die Quelle steht dann im Stil. */
    seenBeimFluss?: boolean | undefined;
    /**
     * Was von der Topographie gezeichnet wird (WI-0055), schon mit den Quellen abgeglichen, die der Stil
     * trägt. Ohne Angabe: nichts davon.
     */
    topography?:
        | {
              contours: boolean;
              contourDetail?: boolean;
              heightTint: boolean;
              peaks: PeakLabels;
              locale: string;
          }
        | undefined;
}

export function buildPlaceLayers(options: LayerOptions): LayerSpecification[] {
    const zeige = options.display ?? displayOfComposition(options.composition);
    const topo = options.topography ?? { contours: false, heightTint: false, peaks: "none", locale: "de" };
    const water = options.smoothWater;
    // Zwei Gruppen, eine Stelle: Das Meer geht nach unten, See und Küste bleiben oben (`buildSmoothWaterLayers`).
    const smoothWater = water ? buildSmoothWaterLayers(water) : { ground: [], above: [] };
    // Flächen, Gewässer und Klima folgen EINEM Zoomband (WI-0221, „Landschaften · Flächen“); ohne Abweichung bleibt jede Ebene, wie sie ist.
    const flaechenSpanne = mitSpanne("landschaften.flaechen.flaeche");
    const serverLookup = zeige.landscapeAreas && usesServerAreaLookup(options.composition, water !== undefined);
    // Wo die Höhenstufen die Flächen ersetzen (unten), stehen sie für die Editoren trotzdem zum Treffen im Stil.
    const trefferFlaechen =
        options.flaechenTreffer === true &&
        zeige.landscapeAreas &&
        water !== undefined &&
        options.composition.heightTints;
    // Strömungspfeile und weiße Flusskontur (WI-0056): nur wer sie sehen darf (Capability `view_flow_directions`),
    // und nur mit dem Schalter im Anzeige-Menü (Betreiber 2026-09-28).
    const stroemung = options.flowDirectionsVisible === true && zeige.flow;
    const wegeAuswahl = {
        land: zeige.landPaths,
        rivers: zeige.rivers,
        riverOutline: stroemung,
        ...(options.pathHitWidth === undefined ? {} : { hitWidth: options.pathHitWidth }),
    };
    const mitWegen = zeige.landPaths || zeige.rivers;
    // Die Ortsklassen filtern Marke und Namen. Nur der gerade gewählte Ort ist vorübergehend ausgenommen.
    // WI-0062, F6: In der politischen Ansicht bleiben die Hauptstädte der gezeigten Gebiete stehen, auch wo die Orte aus sind.
    const territoryData = options.territoryData === true;
    const hauptstaedte = territoryData && zeige.territoryCapitals;
    const klassen =
        zeige.placeClasses === undefined ? undefined : ["in", ["get", "subtype"], ["literal", zeige.placeClasses]];
    // 🔴 ZWEI Filter, und der Unterschied ist die ganze Regel aus WI-0080: `markierterOrt` steht an Marke,
    // Haarlinie, Goldring und Raute, `benannterOrt` zusätzlich mit dem Riegel an jeder Namensebene.
    const angezeigterOrt =
        klassen === undefined ? ANY_PLACE : hauptstaedte ? ["any", klassen, IS_CAPITAL_OF_SHOWN_TERRITORY] : klassen;
    const aktiverOrt = ["==", ["get", "public_id"], options.activePlaceId ?? ""];
    // Was leuchtet: der gewählte Ort und die angehakten der Mehrfachauswahl (`mehrfach-markierung.ts`, Art `place`). Sie stehen wie er
    // auch außerhalb ihrer Klasse und ihres Bandes, mit demselben gelben Kreis; ihre Namen bleiben in den gewöhnlichen Ebenen.
    const leuchtendeOrte = [
        ...(options.activePlaceId ? [options.activePlaceId] : []),
        ...markiert(options.mehrfachMarkierung ?? [], "place"),
    ];
    const ortLeuchtet = leuchtendeOrte.length > 0;
    const leuchtenderOrt = ["in", ["get", "public_id"], ["literal", leuchtendeOrte]];
    const markierterOrt = ortLeuchtet ? ["any", angezeigterOrt, leuchtenderOrt] : angezeigterOrt;
    const benannterOrt = ["all", NAMED_PLACE, angezeigterOrt, ["!", aktiverOrt]];
    // 🔴 Verborgene Orte erst im Zoomband „Verborgene Orte“ (OPS-068): ein gewöhnlicher Ort ist davon nicht berührt; ein verborgener
    // braucht zusätzlich dessen Spanne. `true`, wo nichts einschränkt (Editor-Modus, oder das Band reicht über alle Stufen). Das gilt auch für den gewählten
    // Ort (OPS-000068 Runde 2, Vali 2026-11-02: „ja, markierung und label eines verborgenen orts verschwinden bis zoom >= 8“): `leuchtenderImBand`.
    const verbergungsGrenzen = spannenBedingungen("orte.verborgen.zeichen");
    const verborgenImBand: unknown =
        options.hiddenPlacesAlways === true || verbergungsGrenzen.length === 0
            ? true
            : ["any", NAMED_PLACE, ["all", ...verbergungsGrenzen]];
    const leuchtenderImBand: unknown =
        verborgenImBand === true ? leuchtenderOrt : ["all", leuchtenderOrt, verborgenImBand];
    const zeigtOrte = zeige.placeClasses === undefined || zeige.placeClasses.length > 0 || hauptstaedte || ortLeuchtet;
    // Die Spannen der Zoombänder (WI-0221, Reiter „Zoombänder“): Erscheinen ab `von`, Obergrenze bis `bis`, je Klasse.
    const reihen = ortsreihen();
    const rauteAb = reihen.rauteAb;
    const markerBand = [
        "all",
        appearanceFilter(reihen.marker, "subtype"),
        spannenObergrenze(reihen.markerBis, "subtype"),
        // Ein verborgener Ort zusätzlich erst ab seinem eigenen Band (OPS-068).
        verborgenImBand,
    ];
    const sichtbaresMarkerBand = ortLeuchtet ? ["any", leuchtenderImBand, markerBand] : markerBand;
    // Ungewählte Orte bleiben am ursprünglichen Erscheinungsband gefiltert. Die Auswahl braucht
    // darunter die erste tatsächliche Größe ihrer Klasse, sonst wäre sie zugelassen, aber 0 px groß.
    // Die Größen kommen aus der Tafel, die Spanne entscheidet nur, ab wann eine Klasse steht. Was immer steht (der gewählte Ort, die
    // Nodices), trägt deshalb die Tafel selbst, unterhalb ihres Bandes mit der ersten Zelle.
    const markerDiameter = ortLeuchtet ? ersteZelleNachUnten(AVENTURIA_ZOOM_BANDS.marker) : reihen.marker;
    const labelSize = reihen.label;
    /**
     * Von Punkt auf Pixel, mal dem optischen Faktor des Betreibers — in dieser Reihenfolge, und
     * genau einmal ausgerechnet.
     *
     * 💣 Der Faktor muss ALLE DREI Größen erreichen: Schrift, Saumbreite, Saumweichzeichnung. Sie
     * stehen unten an drei Stellen, und die naheliegende Änderung fasst nur die erste an. Dann
     * wüchse die Schrift und der Saum bliebe stehen — bei 1.4 wird aus dem Saum ein Haarstrich,
     * und der helle Name verschwindet genau dort, wo er getragen werden sollte.
     *
     * 🪤 `POINTS_TO_PIXELS` ist eine Einheitenumrechnung und keine Meinung; `calibration.label` ist
     * eine Meinung und keine Umrechnung. Sie hier zu multiplizieren ist richtig — sie zu
     * verschmelzen wäre es nicht, und deshalb stehen sie in zwei Quellen.
     */
    const ortsSchriftFaktor = POINTS_TO_PIXELS * (AVENTURIA_ZOOM_BANDS.calibration?.label ?? 1);
    const contourRatio = (AVENTURIA_ZOOM_BANDS.spacing["kontur"] ?? 0) / 100;
    // Die Nodices (WI-0025): Marker- und Namensgrößen auch unterhalb des Bandes ihrer Klasse.
    const leyKnoten = AVENTURIA_POWERLINE_CARTOGRAPHY.leyKnoten;
    const nodixMarker = ersteZelleNachUnten(AVENTURIA_ZOOM_BANDS.marker);
    const nodixNamen = mitUntergrenze(AVENTURIA_ZOOM_BANDS.label, leyKnoten.nameBelowBandPt);

    // 🪤 Das Geländeraster wird in der Landschaftsansicht nicht abgeblendet, sondern WEGGELASSEN.
    // Legacy schreibt dort allen Ebenen 0 % vor und nimmt die Kachelebene ganz von der Karte -
    // und genau deshalb sind dort kräftige Farben lesbar, die über dem Gelände verschwinden.
    // Ein Layer mit `raster-opacity: 0` bliebe im Style, lüde weiter Kacheln und wäre in der
    // Messung nicht von einem sichtbaren zu unterscheiden.
    const untergrund: LayerSpecification[] = options.composition.basemap
        ? [
              {
                  id: BASEMAP_LAYER_ID,
                  type: "raster",
                  source: BASEMAP_SOURCE_ID,
                  // Die Kraftlinien-Ansicht entsättigt das Gelände (Legacys „Magiersicht“); in den Landschaften stellt der Regler
                  // „Untergrund“ der Editoren die Deckkraft (T47).
                  paint: {
                      "raster-fade-duration": 150,
                      ...magiersichtPaint(options.composition.basemapDesaturated),
                      ...(options.composition.basemapOpacity === undefined
                          ? {}
                          : {
                                "raster-opacity": untergrundDeckkraft(
                                    options.composition.basemapOpacity,
                                    topo.heightTint,
                                ),
                            }),
                  },
              },
          ]
        : [];

    const layers: LayerSpecification[] = [
        {
            id: "background",
            type: "background",
            paint: { "background-color": canonColour("mapPaper") },
        },
        // Über dem Papier; bei Höhenstufen über den Stufen (unten).
        ...(topo.heightTint ? [] : untergrund),
        // Klima liegt UNTER den uebrigen Landschaftsebenen: Legacy gibt ihm ein eigenes Pane mit
        // z-Index 253, die Topographie 254 aufwaerts (MCS-007). Reihenfolge ist Migrationsgegenstand.
        ...(zeige.landscapeAreas && options.composition.landscapeLayers.includes("klima")
            ? buildClimateLayers(options.highlightedClimateZone).map(flaechenSpanne)
            : []),
        // Die Sprachen (WI-0261 S5a) an derselben Stelle wie das Klima, mit demselben Zoomband der Flächen: auch sie gibt es nur
        // in ihrer eigenen Ebene, und Meer und Seen liegen darüber (T-4: die Zeichnung legt das Wasser über die Sprachflächen).
        ...(options.sprachen === true &&
        zeige.landscapeAreas &&
        options.composition.landscapeLayers.includes("sprachen")
            ? buildSprachLayers().map(flaechenSpanne)
            : []),
        // Landschaften liegen unter allem ausser der Grundkarte - Legacys Reihenfolge, uebernommen
        // als Daten, nicht als Geschmack (Finding MCS-007).
        // Die Höhenstufen liegen unter den Flächen, von denen dort nur das Meer bleibt (WI-0055); die
        // Schattierung setzt `withTerrain` darüber.
        // 🔴 Der Untergrund liegt hier ÜBER den Stufen (WI-0236, Betreiber 2026-10-19: „Höhenstufen unterstützen übrigens keine
        // transparenz - im gegensatz zum normalen höhenlinienmodus“). Die Stufen sind der Grund anstelle des Papiers, und ◐ mischt
        // wie bei den Höhenlinien (`untergrundDeckkraft`): 0 % nur Stufen, 100 % Karte unter der Lasur der Topographie. Eine Deckkraft
        // an den Stufen selbst ginge nicht: Jede Stufe ist die Fläche ÜBER ihrer Schwelle, sie liegen gestapelt, und durchsichtig
        // addierten sie sich.
        // Die Flächen, die die Editoren hier treffen (Fund 2026-11-10), liegen unsichtbar UNTER den Stufen: `withTerrain` setzt die
        // Schattierung hinter die erste Füllung und den Untergrund, und so bleibt sie, wo sie war.
        ...(trefferFlaechen
            ? buildLandscapeHitLayers(options.composition.landscapeLayers, { withoutWater: true }).map(flaechenSpanne)
            : []),
        ...(topo.heightTint ? [buildHeightTintLayer(), ...untergrund] : []),
        // 🔴 Das Meer ist der GRUND: seine geglättete, deckende Fläche liegt UNTER den Landschaftsfüllungen und über
        // Klimaband und Höhenstufen (Nachtrag zu WI-0083). Darüber deckte es zu, was innerhalb seines Polygons liegt -
        // die gestrichelten Kanten der Inselgruppen und 75 ganz darin liegende Flächen der Topographie.
        ...smoothWater.ground.map(flaechenSpanne),
        // In jeder Landschaftsansicht trägt eine eigene Quelle das Wasser, geglättet und deckend (WI-0055, Nachtrag zu
        // WI-0083); in den Höhenstufen färbt die Höhe das Land, von den Flächen bleibt nur dieses Wasser.
        ...(!zeige.landscapeAreas || (water !== undefined && options.composition.heightTints)
            ? []
            : buildLandscapeLayers(options.composition.landscapeLayers, {
                  hideLakes: zeige.hideLakes,
                  withoutWater: water !== undefined,
              }).map(flaechenSpanne)),
        // Der See und die Küstenlinie bleiben ÜBER den Füllungen: Ein See liegt im Land, kein Land liegt in ihm, und die
        // Küste bleibt scharf, auch wo die Vegetationsfüllung allein deckend ist.
        ...smoothWater.above.map(flaechenSpanne),
        // Die Seen beim Bearbeiten eines Flusses (OPS-000116) wie der See oben: über den Flächen, unter den Wegen.
        ...(options.seenBeimFluss === true ? [buildEditorSeenLayer()].map(flaechenSpanne) : []),
        // Die Höhenlinien über den Flächen und unter den Wegen, wie in einer topographischen Karte.
        ...contourLineLayers(topo.contours, topo.contourDetail === true),
        // Die Herrschaftsgebiete (WI-0062): Fläche in der Farbe des Gebiets, unter den Wegen (Legacys Polygone liegen
        // unter den Straßen), auf dem Gelände.
        ...(territoryData && zeige.territories ? [buildTerritoryFillLayer()] : []),
        // Die Schraffur umstrittener Gebiete darüber (Legacys Pane 300 über der Füllung 200), wo die Tafel sie zeigt.
        ...(territoryData && zeige.territories && zeige.claimHatch ? [buildTerritoryClaimLayer()] : []),
        // Das Gradnetz wie die Höhenlinien: über den Flächen, unter Wegen und Namen (WI-0273).
        ...(options.gradnetz === true ? buildGradnetzLayers() : []),
        ...(options.hexraster ? [buildHexrasterLayer(options.hexraster)] : []),
        // Wege liegen ueber den Flaechen und unter den Orten (WI-0010). Innerhalb der Wege
        // entscheidet die Tafel: Wasser unten, Reichsstrassen oben.
        ...(mitWegen ? buildPathLayers(wegeAuswahl) : []),
        // Die Grenzen darüber (Legacy: Canvas-Overlay über den Flächen), innen unter außen; kräftig in der politischen
        // Ansicht, schwach über Standard und Landschaften.
        ...(territoryData && zeige.borders !== undefined ? buildTerritoryBorderLayers(zeige.borders) : []),
        // Die gewählte Fläche (WI-0043) über Flächen und Wegen, wie Legacys Hervorhebung in der Ebene der
        // Route (routePane). Die Route setzt `withRoute` darüber, Orte und Namen folgen ohnehin später.
        // Ein gewähltes Gebiet leuchtet nur, wo seine Kachelquelle im Stil steht (Zeiger da).
        ...buildAreaSelectionLayers(
            options.areaSelection?.kind === "territory" && !territoryData ? undefined : options.areaSelection,
            { water: water !== undefined, outline: serverLookup },
        ),
        // Die Mehrfachauswahl der Editoren darüber, gelb wie die Einzelauswahl (Betreiber 2026-10-20).
        ...buildMehrfachMarkierungLayers(options.mehrfachMarkierung ?? [], {
            territoryData,
            peakData: topo.peaks !== "none",
        }),
        // Die Vorschau beim Zeigen (WI-0043 Stufe 2): EINE gestrichelte Ebene an einer eigenen Quelle, die nur die gezeigte Form trägt
        // (WI-0266). Sie steht, wo es etwas zu zeigen gibt: Landschaftsflächen (aus den Kacheln oder, in den Höhenstufen, vom Server,
        // WI-0058) und Gebiete der politischen Ansicht. Seen und Meere zeigt sie an der geglätteten Form, wo die Karte sie so zeichnet.
        ...(serverLookup ||
        (zeige.landscapeAreas && options.composition.landscapeLayers.length > 0) ||
        (territoryData && zeige.territories)
            ? [buildAreaPreviewOutlineLayer()]
            : []),
        // Die Strichelung der WEGE (WI-0090), wo überhaupt Wege gezeichnet werden - vorher nur für Flüsse. Ob sie beim
        // Zeigen auch erscheint, entscheidet nicht der Stil, sondern `pathPreviewOutlined` (`interaction/priorities.ts`).
        ...(mitWegen ? [buildPathPreviewLayer()] : []),
        // 🔴 Die Strömungspfeile liegen ÜBER den Linien und UNTER jeder Beschriftung — genau
        // Legacys Einsortierung (Pane 469 zwischen roadsPane 400 und dem Wegenamen-Canvas 470).
        ...(zeige.rivers && stroemung ? [buildFlowArrowLayer()] : []),
        // Die Kraftlinien über den Wegen und unter den Orten - Legacys Panes 400 < 430 < 500.
        // Mit den Bögen zeichnet `powerline-arcs.ts` die Linien; die statischen Lagen sind der Rückfall.
        ...(options.composition.powerlines && options.powerlineArcs !== true ? buildPowerlineLayers() : []),
        // Die unsichtbare Trefferfläche der Linien (WI-0063 P8, anklickbar): sie gilt, wo die Bögen nicht zeichnen (Rückfall).
        ...(options.composition.powerlines ? [buildPowerlineHitLayer()] : []),
        // Die Nodices darüber, wie Legacys Orts-Pane (500) über den Kraftlinien (430).
        ...(options.composition.nodices
            ? buildLeyNodeLayers({
                  source: LEY_NODE_SOURCE_ID,
                  sourceLayer: LEY_NODE_SOURCE_LAYER,
                  // Mit den Bögen zeichnen sie die Knoten als glühende Punkte; hier bleibt dann nur die Trefferfläche.
                  gluehen: options.powerlineArcs === true,
                  // Jede Zeile der Knotenquelle ist ein Knoten. Der Knoten ist eine Markierung und wird
                  // deshalb auch für einen verborgenen Ort gezeichnet (WI-0080); sein Name bleibt weg, der
                  // Riegel steht unten an `nodix-label`. In Legacy stand er ausdrücklich VOR dem
                  // Kraftlinien-Zweig und nahm dort beides.
                  // Das Zoomband „Nodix · Zeichen“ (WI-0221); ohne Abweichung auf jeder Stufe. Ein verborgener Nodix zusätzlich erst im
                  // Band „Verborgene Orte“ (OPS-068): Die Kraftlinien-Ansicht verriete ihn sonst aus der Ferne.
                  filter:
                      spannenBedingungen("orte.nodix.zeichen").length === 0 && verborgenImBand === true
                          ? ANY_PLACE
                          : [
                                "all",
                                ANY_PLACE,
                                ...spannenBedingungen("orte.nodix.zeichen"),
                                ...(verborgenImBand === true ? [] : [verborgenImBand]),
                            ],
                  // Knotenradius = Außenradius des Ortsmarkers × Faktor, mindestens die Untergrenze.
                  radius: (lage) =>
                      bandInterpolateExpression(nodixMarker, "subtype", {
                          transform: (d) => lage(leyKnotenRadius(d, contourRatio)),
                      }),
              })
            : []),
        // Das Rechenraster des Höhenmodells liegt zuoberst: Es zeigt nur, wo Kachelgrenzen verlaufen (WI-0070).
        ...(options.tileGrid === true ? [buildTileGridLayer()] : []),
    ];

    // Die Gebietsnamen entlang der Außengrenzen (Nachtrag WI-0062, Legacy `drawTerritoryBorderLabels`) ganz unten im
    // Symbolstapel: Legacy zeichnet sie auf eine eigene Fläche unter allen Beschriftungen, und hier weichen sie jedem
    // anderen Namen, statt ihn zu verdrängen. Nur in den Ansichten der Tafel (Standard) und mit dem Schalter „Grenzen“.
    if (options.labels && territoryData && zeige.borderNames) {
        layers.push(buildTerritoryBorderNameLayer(LABEL_FONT));
    }
    // Höhenzahlen stehen nie in der Rasterkarte, auch nicht bei Serien mit eingebetteten Ortsnamen.
    // Sie weichen jedem Namen, auch den Wegnamen.
    if (topo.contours) {
        layers.push(buildContourLabelLayer(LABEL_FONT, topo.locale));
    }
    // 🔴 Der Wegname steht GANZ UNTEN im Symbolstapel, und das ist kein Rangurteil. MapLibre
    // platziert von oben nach unten - wer unten liegt, kommt zuletzt dran und weicht allen. Genau
    // so macht es Legacy, mit einer gemessenen Begruendung: ein Wegname kann nur entlang seiner
    // Linie ausweichen, ein Ortsname hat zwoelf Plaetze. Wegnamen zuerst kostete dort 503
    // Ortsnamen ganz.
    if (options.labels && (zeige.landPaths || zeige.riverNames)) {
        layers.push(buildPathLabelLayer(LABEL_FONT, { ...wegeAuswahl, rivers: zeige.riverNames }));
    }
    // Die Namen der Kraftlinien liegen unter den Namen der Nodices: die werden zuerst gesetzt.
    if (options.labels && options.composition.powerlines) {
        layers.push(buildPowerlineLabelLayer(LABEL_FONT));
    }

    if (zeigtOrte) {
        const kreisFilter = [
            "all",
            markierterOrt,
            sichtbaresMarkerBand,
            ["!", ["all", IS_STRUCTURE, [">=", ["zoom"], renderZoomForBand(rauteAb)]]],
        ];
        const aussenRadius = (d: number): number =>
            markerCoreRadius(d, contourRatio) + markerContourWidth(d, contourRatio);
        const ringKlassen = CAPITAL.classes
            .map((klasse) => [klasse, capitalStartBand(klasse)] as const)
            .filter((eintrag): eintrag is readonly [string, number] => eintrag[1] !== null);
        if (ortLeuchtet) {
            // Der Kreis der Auswahl liegt unter allem, was die Marke zeichnet; je Klasse und Band aus ihrem äußersten Strich
            // (`markerExtent`: Haarlinie, Goldring, Rautenspitze), damit er auch um eine Metropole und eine Raute frei bleibt.
            const auswahl = DESIGN_CANON.mapSelection;
            const umDieMarke = Object.fromEntries(
                Object.entries(markerDiameter).map(([klasse, werte]) => [
                    klasse,
                    werte.map((d, band) =>
                        d === null || d === undefined
                            ? d
                            : Math.max(
                                  markerExtent(klasse, band, d, contourRatio) + auswahl.lineWidth,
                                  auswahl.pathWidth,
                              ),
                    ),
                ]),
            );
            layers.push({
                id: PLACE_SELECTION_LAYER_ID,
                type: "circle",
                source: PLACE_SOURCE_ID,
                "source-layer": PLACE_SOURCE_LAYER,
                filter: asFilter(leuchtenderImBand),
                paint: {
                    "circle-radius": asNumberExpression(bandInterpolateExpression(umDieMarke, "subtype")),
                    "circle-color": canonColour("mapSelection"),
                    "circle-opacity": auswahl.pathOpacity,
                },
            });
        }
        if (ringKlassen.length > 0) {
            // ⭐ Der Goldring liegt UNTER Haarlinie und Marke, in Legacys Zeichenfolge:
            // Kante → Gold → Haarlinie → weiße Kontur → Kern.
            layers.push({
                id: CAPITAL_RING_LAYER_ID,
                type: "circle",
                source: PLACE_SOURCE_ID,
                "source-layer": PLACE_SOURCE_LAYER,
                filter: asFilter([
                    "all",
                    markierterOrt,
                    // Der Ring gehört zur Marke: Ein verborgener Ort trägt ihn erst mit ihr (OPS-068).
                    verborgenImBand,
                    [
                        "any",
                        ...ringKlassen.map(([klasse, band]) => [
                            "all",
                            ["==", ["get", "subtype"], klasse],
                            [">=", ["zoom"], renderZoomForBand(band)],
                        ]),
                    ],
                ]),
                paint: {
                    "circle-radius": asNumberExpression(
                        bandInterpolateExpression(markerDiameter, "subtype", {
                            transform: (d) => aussenRadius(d) + capitalRingWidth(d),
                        }),
                    ),
                    "circle-color": canonColour("markerCapitalRing"),
                    "circle-stroke-color": canonColour("markerCapitalRingEdge"),
                    "circle-stroke-width": 1,
                },
            });
        }
        layers.push({
            id: HAIRLINE_LAYER_ID,
            type: "circle",
            source: PLACE_SOURCE_ID,
            "source-layer": PLACE_SOURCE_LAYER,
            filter: asFilter(kreisFilter),
            paint: {
                "circle-radius": asNumberExpression(
                    bandInterpolateExpression(markerDiameter, "subtype", {
                        transform: (d) => aussenRadius(d) + HAIRLINE,
                    }),
                ),
                "circle-color": canonColour("markerHairline"),
            },
        });
        layers.push({
            id: PLACE_MARKER_LAYER_ID,
            type: "circle",
            source: PLACE_SOURCE_ID,
            "source-layer": PLACE_SOURCE_LAYER,
            // Appearance is a band decision and belongs in the filter, not in the size: a class
            // that is not admitted yet cannot be interpolated into existence half a band early.
            // Redaktionell verborgene Orte tragen eine Marke, aber keinen Namen (WI-0080).
            // 🔴 Ein Bauwerk ab seinem Rautenband steht NICHT hier, sondern in `place-marker-structure`.
            filter: asFilter(kreisFilter),
            paint: {
                // Band values are outer diameters in px, MapLibre wants a radius. Circle paint is
                // re-evaluated on every fractional zoom, so the size ramps between the bands while
                // hitting each band value exactly on its integer zoom.
                //
                // 💣 DER AUSSENDURCHMESSER SCHLIESST DIE KONTUR EIN. Legacy teilt ihn auf
                // (`avesmapsLocationMarkerContourSplit`): Kern = r / (1 + Anteil), Kontur = Kern ×
                // Anteil, zusammen genau r. MapLibre legt `circle-stroke-width` aber AUSSEN um den
                // Radius — hier stand der halbe Außendurchmesser als Kern, und jeder Marker war um
                // den Konturanteil zu groß, ein Drittel (2026-09-23 im Mirror nachgelesen). Ein
                // Browsertest hatte genau das als Sollwert festgeschrieben.
                "circle-radius": asNumberExpression(
                    bandInterpolateExpression(markerDiameter, "subtype", {
                        transform: (value) => markerCoreRadius(value, contourRatio),
                    }),
                ),
                // 🔴 Die Vorgabe ist Legacys Markerrot, nicht ein zweites; verstellen lässt es sich in den Standardwerten (OPS-000083). Der Ton steht dort als Token
                // (`--color-marker-settlement`) und ist in BEIDEN Themen derselbe, weil er auf der
                // immer hellen Karte sitzt. Hier stand `#f52b25` - eine Spur greller, aus keiner
                // Quelle.
                //
                // ⭐ Ein Bauwerk trägt seinen Ton auch, solange es noch ein Kreis ist (Legacy: `fill: isSite ? … : …`,
                // unabhängig von der Form). Inoffizielle Orte stehen in Siena und Flieder (OPS-000083).
                "circle-color": [
                    "case",
                    // Gewählt füllt sich der Kern gold, die Kontur bleibt weiß (Legacy `activeGold`).
                    ["==", ["get", "public_id"], options.activePlaceId ?? ""],
                    canonColour("markerActive"),
                    ["all", IS_STRUCTURE, IS_UNOFFICIAL],
                    startansicht().bauwerkFarbeInoffiziell,
                    IS_STRUCTURE,
                    startansicht().bauwerkFarbeOffiziell,
                    IS_UNOFFICIAL,
                    startansicht().ortFarbeInoffiziell,
                    startansicht().ortFarbeOffiziell,
                ] as unknown as DataDrivenPropertyValueSpecification<string>,
                "circle-stroke-color": canonColour("markerSettlementContour"),
                "circle-stroke-width": asNumberExpression(
                    bandInterpolateExpression(markerDiameter, "subtype", {
                        transform: (value) => markerContourWidth(value, contourRatio),
                    }),
                ),
            },
        });
        layers.push({
            id: STRUCTURE_HAIRLINE_LAYER_ID,
            type: "symbol",
            source: PLACE_SOURCE_ID,
            "source-layer": PLACE_SOURCE_LAYER,
            minzoom: renderZoomForBand(rauteAb),
            filter: asFilter(["all", markierterOrt, IS_STRUCTURE, sichtbaresMarkerBand]),
            layout: {
                "icon-image": STRUCTURE_HAIRLINE_IMAGE_ID,
                "icon-size": asNumberExpression(
                    bandInterpolateExpression(markerDiameter, "subtype", {
                        transform: (d) => (d / 2 + HAIRLINE) / STRUCTURE_IMAGE_OUTER,
                    }),
                ),
                "icon-allow-overlap": true,
                "icon-ignore-placement": true,
            },
        });
        layers.push({
            id: STRUCTURE_MARKER_LAYER_ID,
            type: "symbol",
            source: PLACE_SOURCE_ID,
            "source-layer": PLACE_SOURCE_LAYER,
            minzoom: renderZoomForBand(rauteAb),
            filter: asFilter(["all", markierterOrt, IS_STRUCTURE, sichtbaresMarkerBand]),
            layout: {
                "icon-image": [
                    "case",
                    ["==", ["get", "public_id"], options.activePlaceId ?? ""],
                    STRUCTURE_MARKER_ACTIVE_IMAGE_ID,
                    IS_UNOFFICIAL,
                    STRUCTURE_MARKER_UNOFFICIAL_IMAGE_ID,
                    STRUCTURE_MARKER_IMAGE_ID,
                ] as unknown as DataDrivenPropertyValueSpecification<string>,
                // Das Bild trägt die Raute mit `STRUCTURE_IMAGE_OUTER` px Außenmaß; der Faktor bringt
                // sie auf den Außenradius der Tafel. Kontur und Kern skalieren mit, ihr Verhältnis ist
                // im Bild schon Legacys.
                "icon-size": asNumberExpression(
                    bandInterpolateExpression(markerDiameter, "subtype", {
                        transform: (value) => value / 2 / STRUCTURE_IMAGE_OUTER,
                    }),
                ),
                // 🔴 Ein Marker nimmt an keiner Kollision teil — der Kreis tut es auch nicht. Sonst
                // verdrängte eine Raute Ortsnamen, die neben einem Kreis stehen bleiben.
                "icon-allow-overlap": true,
                "icon-ignore-placement": true,
            },
        });
        // Ungefähre Lage (WI-0267): das Fragezeichen oben rechts an der Marke, erst ab dem Band, in dem jede Marke voll groß ist
        // (`volleMarkeAb`). Versetzt um drei Viertel des vollen Außenradius je Klasse; wie die Marke ohne Kollision.
        const versatz = Object.entries(markerDiameter).flatMap(([klasse, reihe]) => {
            const werte = reihe.filter((wert): wert is number => typeof wert === "number");
            const radius = werte.length === 0 ? 0 : Math.max(...werte) / 2;
            return [klasse, ["literal", [Math.round(radius * 0.75), -Math.round(radius * 0.75)]]];
        });
        layers.push({
            id: PLACE_APPROXIMATE_LAYER_ID,
            type: "symbol",
            source: PLACE_SOURCE_ID,
            "source-layer": PLACE_SOURCE_LAYER,
            minzoom: renderZoomForBand(volleMarkeAb(reihen.marker)),
            filter: asFilter(["all", markierterOrt, sichtbaresMarkerBand, ["==", ["get", "is_approximate"], true]]),
            layout: {
                "icon-image": [
                    "case",
                    ["all", IS_STRUCTURE, IS_UNOFFICIAL],
                    APPROXIMATE_BADGE_STRUCTURE_UNOFFICIAL_IMAGE_ID,
                    IS_STRUCTURE,
                    APPROXIMATE_BADGE_STRUCTURE_IMAGE_ID,
                    IS_UNOFFICIAL,
                    APPROXIMATE_BADGE_UNOFFICIAL_IMAGE_ID,
                    APPROXIMATE_BADGE_IMAGE_ID,
                ] as unknown as DataDrivenPropertyValueSpecification<string>,
                "icon-offset": [
                    "match",
                    ["get", "subtype"],
                    ...versatz,
                    ["literal", [0, 0]],
                ] as unknown as DataDrivenPropertyValueSpecification<[number, number]>,
                "icon-allow-overlap": true,
                "icon-ignore-placement": true,
            },
        });
    }

    // Ortsnamen: nur wo Orte gezeigt werden, und nur wenn die Serie sie nicht im Bild trägt.
    /**
     * Ein Ortsnamen-Layer mit ALLEN Regeln der Ortsnamen (WI-0025 zieht ihn hierher): die Standardkarte
     * benutzt ihn für die Orte, die Kraftlinien-Ansicht für die Nodices. Zwei Kopien desselben Objekts
     * liefen auseinander - genau an den Stellen, deren Begründung unten steht.
     */
    const ortsnamenLayer = (
        id: string,
        filter: unknown,
        groessen: Record<string, BandSeriesValues>,
        quelle: { source: string; sourceLayer: string } = { source: PLACE_SOURCE_ID, sourceLayer: PLACE_SOURCE_LAYER },
    ): LayerSpecification => ({
        id,
        type: "symbol",
        source: quelle.source,
        "source-layer": quelle.sourceLayer,
        // The global class table is the cartography; an admin override for one place replaces
        // exactly the property it sets (ADR-0006).
        filter: asFilter(filter),
        layout: {
            "text-field": ["get", "name"],
            // 🔴 RUINEN STEHEN KURSIV — Legacys Regel, und in Avesmaps3D auf demselben Weg
            // hergestellt. Legacy registriert KEINEN zweiten Schnitt (`css/base/fonts.css`
            // kennt nur die Regular-woff2); die Neigung erzeugt der Browser synthetisch, sein
            // Canvas setzt buchstäblich `font = "italic 400 14px Faculty Glyphic"`.
            //
            // MapLibre kennt kein `font-style`, nur Stacknamen. Die Entsprechung ist deshalb
            // ein zweiter Glyphenstapel aus DERSELBEN Schriftdatei, im selben Browser gezeichnet,
            // nur mit `fontStyle: "italic"` (`scripts/dev/build-glyphs.mjs`). Keine zweite
            // Schrift, keine zweite Lizenz, keine Laufzeitabhängigkeit.
            //
            // 🪤 Ein datengetriebenes `text-font`, KEIN zweiter Layer. Zwei Symbollayer wären
            // zwei Kollisionsdurchgänge: der obere griffe zuerst zu, und damit gewönnen Ruinen
            // gegen gewöhnliche Orte. Welche Namen stehenbleiben, darf sich hier nicht ändern.
            "text-font": [
                "case",
                ["==", ["get", "is_ruined"], true],
                ["literal", [ITALIC_LABEL_FONT]],
                ["literal", [LABEL_FONT]],
            ] as unknown as DataDrivenPropertyValueSpecification<string[]>,
            // Same band table as the markers, same interpolation. Whether MapLibre honours it
            // between integer zooms the way paint does is measured, not assumed - text-size is
            // a layout property and goes through the symbol size binder.
            // 🔴 PUNKT NACH PIXEL, und das ist keine Kalibrierung, sondern eine Einheit.
            // Legacys Tafel führt Punktwerte und wird in einer eigenen Zeile umgerechnet
            // (`labelSize * 4 / 3; // pt -> px`); MapLibres `text-size` ist eine Pixelangabe.
            // Ohne die Umrechnung war jede Beschriftung ein Viertel zu klein (WI-0015, B1).
            //
            // 🪤 Hier stand ein am Auge gefundener Faktor 1.5. Er hat denselben Fehler
            // ausgeglichen — der Betreiber hatte unabhängig 1.4 als angenehm bezeichnet, und
            // 4/3 ist 1,333. Ein optischer Wert, der eine Einheitenumrechnung vertritt, sieht
            // auf einer Stufe richtig aus und verdeckt die Ursache auf allen.
            "text-size": asNumberExpression(
                labelSizeExpression(groessen, "subtype", "label_size_override", ortsSchriftFaktor),
            ),
            // Seite und Abstand setzt `ortsnameAufSeite` (WI-0135): fester Anker je Ebene, Abstand stufenlos am Marker.
            // 🔴 OHNE DIES IST EIN ZWEIZEILIGER NAME ZENTRIERT, egal auf welcher Seite er steht
            // (MapLibres Vorgabe ist `center`). „Turm Orkenwacht" links vom Marker stand damit
            // mittig ausgerichtet statt zum Marker hin — die kurze Zeile rückte vom Punkt weg
            // und der Name zerfiel optisch in zwei Teile.
            //
            // `auto` richtet nach dem Anker aus: steht der Text rechts, wird er linksbündig,
            // steht er links, rechtsbündig. Die bündige Kante zeigt immer zum Marker.
            "text-justify": "auto",
            "text-padding": AVENTURIA_ZOOM_BANDS.spacing["spalt"] ?? 2,
            // 🔴 EINE ZEILE, IMMER. Legacy bricht einen Ortsnamen nie um: die Basisregel seiner
            // Beschriftungen traegt `white-space: nowrap`, und sein Canvas-Renderer zeichnet die
            // Glyphen in genau einer Reihe. „Wuestung Loskarn" stand bei uns zweizeilig und bei
            // ihm einzeilig — derselbe Name, zwei Bilder.
            //
            // 🪤 MapLibre kennt kein „nicht umbrechen", nur eine Hoechstbreite in em. Ein sehr
            // grosser Wert ist die Entsprechung; 0 waere es NICHT (das bricht nach jedem Wort).
            "text-max-width": NO_WRAP,
            // Collision on: a name that does not fit is dropped, not overprinted.
            "text-allow-overlap": false,
            // ⭐ Die Klassenordnung stand hier als Literal und wanderte nach Migration 0017 in die
            // Tabelle `label_class_rank` - zur Laufzeit pflegbar statt nur durch ein Release.
            // Die Kachel liefert den fertigen Rang; der Style liest eine Zahl.
            "symbol-sort-key": asNumberExpression(collisionSortKey()),
        },
        // 🔴 WEISSER NAME AUF SCHWARZEM SAUM, und eine Farbe für ALLE Ortsklassen. Auf der
        // Legacy-Karte steht kein dunkler Name auf hellem Grund (MCS-015, an der laufenden
        // Karte nachgemessen); Metropole und Dorf unterscheiden sich über Größe und
        // Erscheinungsstufe, nie über den Ton. Hier stand dunkelbraun auf Creme.
        //
        // 🪤 Der Saum ist ein ANTEIL der Schriftgröße, kein fester Pixelwert — und weil die
        // Größe hier ein `interpolate` über `["zoom"]` ist, muss der Faktor IN die Stops. Ein
        // `["*", <diese Kurve>, faktor]` würde von MapLibre STILL abgelehnt; die Eigenschaft
        // bliebe auf ihrem Vorgabewert, ohne Fehlermeldung.
        paint: {
            "text-color": labelFamily("place").color,
            "text-halo-color": labelFamily("place").haloColor,
            "text-halo-width": asNumberExpression(
                labelSizeExpression(
                    groessen,
                    "subtype",
                    "label_size_override",
                    ortsSchriftFaktor * labelFamily("place").haloWidthRatio,
                ),
            ),
            "text-halo-blur": asNumberExpression(
                labelSizeExpression(
                    groessen,
                    "subtype",
                    "label_size_override",
                    ortsSchriftFaktor * labelFamily("place").haloBlurRatio,
                ),
            ),
        },
    });

    const ortsAusdehnung: MarkerAusdehnung = (klasse, band, d) => markerExtent(klasse, band, d, contourRatio);
    const knotenAusdehnung: MarkerAusdehnung = (_klasse, _band, d) => leyKnotenRadius(d, contourRatio);

    /**
     * Ein Ortsname auf EINER Seite seines Markers, stufenlos am Marker (WI-0135): fester Anker statt variablem, der Abstand
     * als `text-translate` je Bild (`namensVersatz`). Beide Seiten tragen die Sperrfläche ihres Markers, mittig auf dem
     * Ort. Rechts belegt sie nur Platz; links muss sie selbst frei sein. Steht der Name rechts, liegt dort schon seine
     * Fläche, und das linke Gegenstück tritt nicht an. Das ist Legacys „rechts, bei Kollision links“ (Betreiber
     * 2026-09-22), auf zwei Ebenen verteilt.
     *
     * 💣 Der Ausschluss hängt an zwei Flächen am SELBEN Punkt, nicht daran, dass die rechte Fläche bis in den linken Namen
     * reicht. So stand es zuerst, und in der geneigten Ansicht stand der Name nah an der Kamera doppelt (Betreiber
     * 2026-10-11, Neetha und Castel da Rosa): `text-translate` wächst dort mit der Karte, eine Sperrfläche nur halb so stark
     * (MapLibres `perspectiveRatio`), und die rechte Fläche erreichte den linken Namen nicht mehr.
     *
     * 🪤 Name und Sperrfläche stehen in EINEM Symbol: MapLibre prüft ein Symbol nie gegen sich selbst, also hält die eigene
     * Markierung den eigenen Namen nicht auf. Beide gehören zusammen (`text-optional` und `icon-optional` aus): Steht der
     * Name nicht, belegt auch seine Fläche nichts, und die Sperrebene der Klasse trägt die Markierung.
     *
     * 🪤 Innerhalb einer Klasse setzt MapLibre jetzt erst alle rechten, dann alle linken Namen. Ein Ort, der nach links
     * ausweichen muss, kommt deshalb nach den rechten Namen seiner Klasse dran, nicht direkt nach seinem Vorgänger im Rang.
     */
    const ortsnameAufSeite = (
        layer: LayerSpecification,
        klasse: string,
        seite: PlaceLabelSide,
        {
            mitSperre = true,
            ausdehnung = ortsAusdehnung,
            serien = markerDiameter,
        }: { mitSperre?: boolean; ausdehnung?: MarkerAusdehnung; serien?: Record<string, BandSeriesValues> } = {},
    ): LayerSpecification => {
        if (layer.type !== "symbol") {
            return layer;
        }
        const serie = serien[klasse] ?? [];
        const layout: Record<string, unknown> = { ...layer.layout };
        // 💣 DIE ANKERBENENNUNG IST VERKEHRT ZUR WIRKUNG: `left` verankert den TEXT an seiner linken Kante, er steht
        // damit RECHTS vom Punkt. Nur diese zwei Seiten: Legacy kennt zwölf Kandidaten, übernommen ist die Hauptachse
        // (ein Name über oder unter dem Marker ist schwerer zuzuordnen als einer, der fehlt).
        layout["text-anchor"] = seite === "right" ? "left" : "right";
        layout["text-optional"] = false;
        if (mitSperre) {
            Object.assign(layout, {
                "icon-image": PLACE_COLLISION_IMAGE_ID,
                "icon-size": markerSperrGroesse(klasse, serie, ausdehnung),
                // Links nur, wo die eigene Fläche frei ist: Die rechte Fläche desselben Orts liegt genau darauf.
                "icon-allow-overlap": seite === "right",
                "icon-ignore-placement": false,
                "icon-optional": false,
                "icon-padding": 0,
            });
        }
        return {
            ...layer,
            layout: layout as NonNullable<typeof layer.layout>,
            paint: {
                ...layer.paint,
                "text-translate": namensVersatz(klasse, serie, ausdehnung, seite) as unknown as [number, number],
                // Am Bildschirm, nicht an der Karte: Auch gedreht steht der Name rechts vom Marker.
                "text-translate-anchor": "viewport",
            },
        };
    };

    if (options.labels && zeigtOrte) {
        const namensFilter = [
            "all",
            benannterOrt,
            labelFilter(labelSize, "subtype", {
                visible: "label_visible_override",
                min: "label_min_zoom_override",
                max: "label_max_zoom_override",
            }),
            // Die Obergrenze der Klasse (WI-0221); ein Ort mit eigener Obergrenze geht vor (F2, ADR-0006).
            ["case", ["has", "label_max_zoom_override"], true, spannenObergrenze(reihen.labelBis, "subtype")],
        ];
        // 🔴 Je Klasse, von der wichtigsten abwärts gesetzt: erst alle Namen rechts, dann links, dann die Sperrfläche aller
        // ihrer Markierungen (WI-0135). Ein Name weicht damit jeder Markierung einer größeren Klasse aus und den Namen samt
        // Markierung der Orte seiner Klasse, die vor ihm gesetzt wurden. Findet er keinen Platz, steht er nicht.
        //
        // 💣 Das Feld ist von UNTEN nach OBEN geschrieben, MapLibre setzt von OBEN nach unten. Deshalb läuft die Schleife von
        // der kleinsten Klasse aufwärts und legt je Klasse Sperrfläche, links, rechts ab: Gesetzt wird dann rechts, links,
        // Sperrfläche, und die Metropole zuerst.
        for (const klasse of [...PLACE_CLASSES_BY_RANK].reverse()) {
            const ihreKlasse = ["==", ["get", "subtype"], klasse];
            const namen: LayerSpecification[] = [];
            for (const seite of ["right", "left"] as const) {
                namen.push(
                    ortsnameAufSeite(
                        ortsnamenLayer(placeLabelLayerId(klasse, seite), [...namensFilter, ihreKlasse], labelSize),
                        klasse,
                        seite,
                    ),
                );
            }
            layers.push({
                id: placeCollisionLayerId(klasse),
                type: "symbol",
                source: PLACE_SOURCE_ID,
                "source-layer": PLACE_SOURCE_LAYER,
                // Dieselben Orte wie Kreis und Raute zusammen, der gewählte auch unterhalb seines Bandes.
                filter: asFilter(["all", markierterOrt, sichtbaresMarkerBand, ihreKlasse]),
                layout: {
                    "icon-image": PLACE_COLLISION_IMAGE_ID,
                    "icon-size": asNumberExpression(
                        markerSperrGroesse(klasse, markerDiameter[klasse] ?? [], ortsAusdehnung),
                    ),
                    // Die Markierung steht immer und belegt dabei Platz.
                    "icon-allow-overlap": true,
                    "icon-ignore-placement": false,
                    "icon-padding": 0,
                },
            });
            layers.push(...namen.reverse());
        }
        // 💣 ÜBER den Ortsnamen, und das ist keine Geschmacksfrage. Die Kollisionsrangfolge ist
        // eine Produktregel: bei Konflikt weicht der ORTSname (MCS-008, Betreiberbestätigung).
        //
        // 🪤 MapLibre platziert Symbole von OBEN nach UNTEN durch den Layerstapel - der obere Layer
        // greift zuerst zu, nicht der untere. Gemessen: mit dem Schriftlauf VOR `place-label`
        // verschwanden über den Koschbergen ALLE vier Landschaftsnamen, weil die Ortsnamen zuerst
        // platziert wurden. Die naheliegende Lesart "früher im Style heißt vorrangig" ist falsch.
        // Von unten nach oben: Ortsnamen, freie und Punktlabels, Kurvenbeschriftung. Das ist
        // Legacys Kollisionskaskade rueckwaerts gelesen ("Gebietsnamen -> Kurvenlabels -> Orts-
        // und Freilabels", MCS-008) - denn in MapLibre greift der OBERE Layer zuerst zu.
    }

    // Die Namen der Knoten (WI-0025): dieselben Regeln wie jeder Ortsname, nur ohne Zoomband - Legacy
    // beschriftet in der Kraftlinien-Ansicht jeden Nodix und lässt die Kollision ausdünnen. Aus der
    // Knotenquelle (0040): Nodix-Orte und -Labels und jedes Linienende.
    // 🔴 Seit WI-0135 wie die Ortsnamen je Klasse und Seite, stufenlos am Rand des KNOTENS (Betreiber 2026-10-11: „zieh die
    // nodices abstände nach“). Der Knoten ist 1,7-mal so groß wie ein Ortsmarker; am Ortsmarker gemessen ragte der Name
    // auf hoher Stufe in ihn hinein. Gleiche Schleife wie bei den Ortsnamen: von unten nach oben geschrieben, rechts zuoberst.
    if (options.labels && options.composition.nodices) {
        for (const klasse of [...PLACE_CLASSES_BY_RANK].reverse()) {
            // Kraftlinienpunkte ohne Namen tragen nichts bei; ohne den Riegel stünden sie als leere Sperrfläche da.
            const filter = [
                "all",
                NAMED_PLACE,
                ["!", aktiverOrt],
                ["has", "name"],
                ["==", ["get", "subtype"], klasse],
                // Das Zoomband „Nodix · Name“ (WI-0221); ohne Abweichung auf jeder Stufe.
                ...spannenBedingungen("orte.nodix.name"),
            ];
            for (const seite of ["left", "right"] as const) {
                layers.push(
                    ortsnameAufSeite(
                        ortsnamenLayer(nodixLabelLayerId(klasse, seite), filter, nodixNamen, {
                            source: LEY_NODE_SOURCE_ID,
                            sourceLayer: LEY_NODE_SOURCE_LAYER,
                        }),
                        klasse,
                        seite,
                        { ausdehnung: knotenAusdehnung, serien: nodixMarker },
                    ),
                );
            }
        }
    }

    // 🪤 Die Landschaftsnamen haengen an der ANSICHT, nicht an den Orten. Legacy blendet sie in der
    // Landschaftsansicht mit aus - dort ist sie ein Zeichenwerkzeug, und der Editor kennt seine
    // Flaechen. Fuer einen Besucher waeren bunte Flaechen ohne ein einziges Wort wertlos; die
    // bewusste Abweichung steht in WI-0009.
    //
    // „Labels" im Anzeige-Menü (WI-0028) schaltet diese freien Beschriftungen und die Flussnamen (`riverNames`, Betreiber
    // 2026-11-09), nicht die Orts- oder Wegnamen (Legacy `toggleMapLabels`).
    // 🔴 Die Namen einer gewählten Landschaft BLEIBEN STEHEN und wechseln nur die Farbe (WI-0093, Betreiber
    // 2026-10-06 aus dem Nutzertest). Bei einer Gruppe gleichnamiger Regionen leuchten die Namen aller
    // (WI-0047). Bis dahin wurden sie hier herausgefiltert und von einer eigenen Ebene ersetzt - daher der
    // Formsprung beim Klick und die verlorene Kurve eines Gebirgsnamens.
    // 🔴 Die Art-Zeile nur in der Ebene „Alle“ der Landschaften (WI-0135, Betreiber 2026-10-11: „nur bei landschaften, alle“):
    // Dort liegen Flächen der Vegetation und der Topographie übereinander, und es ist nicht klar, welche ein Name meint.
    // In der Standardkarte stehen keine Flächen, in einer einzelnen Ebene gibt es nur eine Art von Fläche.
    const artZeile =
        zeige.landscapeAreas && TYPE_LINE_LAYERS.every((ebene) => options.composition.landscapeLayers.includes(ebene));
    const gewaehlteRegionen =
        options.labels && options.areaSelection?.kind === "landscape" ? areaIds(options.areaSelection) : undefined;
    if (options.labels && zeige.mapLabels) {
        // 💣 Beide bekommen DIESELBE Ebenenauswahl wie die Flächen. Vorher standen die Namen
        // aller Ebenen in jeder Ansicht — „Herz des Kontinents" (derographisch) lag über der
        // Vegetationsansicht.
        // Je Ebene Kurven- und Punktnamen, Derographie vor Topographie vor Vegetation (WI-0135, Betreiber 2026-10-11).
        layers.push(
            ...buildLandscapeNameLayers(LABEL_FONT, zeige.labelLayers, gewaehlteRegionen, { typeLine: artZeile }),
        );
        // Gipfel und Vulkane sind in Legacy freie Beschriftungen und hängen deshalb am selben Schalter.
        // Festgenagelt (Legacy „fest“): über allen übrigen Namen, sie werden zuerst gesetzt (WI-0055).
        if (topo.peaks !== "none") {
            layers.push(buildPeakLayer(LABEL_FONT, topo.peaks, topo.locale, options.hiddenPlacesAlways === true));
            layers.push(
                buildPeakApproximateLayer(APPROXIMATE_BADGE_STRUCTURE_IMAGE_ID, options.hiddenPlacesAlways === true),
            );
        }
    }
    // ⭐ Die Klimazonen tragen ihren Namen auf einem eigenen Weg - er ist der Regionsname der
    // Flaeche, kein map_label-Eintrag (WI-0012). Er erscheint da, wo auch das Band liegt, und hängt
    // deshalb nicht am Schalter „Labels" (Legacy: der schaltet nur die freien Beschriftungen).
    // Er steht mittig im sichtbaren Teil des Bandes (`area-labels.ts`), braucht dafür die gezeichneten Bänder (ohne
    // Flächen kein Band und kein Name) und liegt oben im Stapel: In den Klimazonen sind die Zonennamen DIE Namen der Ansicht.
    // „Alle“ zeigt keine Klimazonen (Betreiber 2026-10-05).
    if (
        options.labels &&
        options.composition.landscapeNames &&
        zeige.landscapeAreas &&
        options.composition.landscapeLayers.includes("klima")
    ) {
        layers.push(buildClimateLabelLayer(LABEL_FONT));
    }
    // ⭐ Die Sprachen tragen ihre Namen wie die Klimazonen (WI-0261 E5): mittig im sichtbaren Teil, wandernd, aus der Kachel der
    // Sprachfläche (`sprachen-labels.ts`); ohne Flächen keine Namen.
    if (
        options.labels &&
        options.sprachen === true &&
        options.composition.landscapeNames &&
        zeige.landscapeAreas &&
        options.composition.landscapeLayers.includes("sprachen")
    ) {
        layers.push(buildSprachLabelLayer(LABEL_FONT));
    }
    // Die Gebietsnamen (WI-0062, F5 A): in der politischen Ansicht, ÜBER den Orts- und Wegnamen im Stapel. MapLibre setzt
    // von oben nach unten - wer oben liegt, greift zuerst zu; Legacys Kaskade „Gebietsnamen → Kurvenlabels → Orts- und
    // Freilabels“ stellt die Gebietsnamen an die Spitze.
    // 🔴 Das gewählte Gebiet BLEIBT in dieser Ebene und wird gelb (WI-0121 Nachtrag, Betreiber 2026-10-09; dasselbe Muster wie die
    // Landschaften, WI-0093): Es gibt keine zweite Beschriftung für das Gebiet, sein Name wird nicht herausgefiltert, nicht neu
    // gesetzt und nicht versetzt.
    if (options.labels && territoryData && zeige.territories) {
        layers.push(
            buildTerritoryLabelLayer(
                LABEL_FONT,
                options.areaSelection?.kind === "territory" ? options.areaSelection.id : undefined,
                options.territoryCoats === true,
            ),
        );
    }
    // 🔴 Der ERSATZNAME einer gewählten Landschaft steht über allen Namen und in jeder Ansicht: Er ist Teil der Auswahl,
    // nicht der Beschriftung, und hängt deshalb weder an der Ansicht noch am Schalter „Labels“ (WI-0043). Er tritt nur an, wo
    // der gewöhnliche Name nicht im Bild steht (WI-0093). Nur eine Serie, die ihre Namen im Bild trägt, bekommt keinen - dort
    // stünde er doppelt. Ein gewählter Weg bekommt keinen: Seine Namen stehen schon an ihm (WI-0044), ein gewähltes Gebiet
    // ebenso: sein Name steht in der Ebene der Gebietsnamen.
    if (options.labels && options.areaSelection?.kind === "landscape") {
        layers.push(buildAreaSelectionLabelLayer(LABEL_FONT, { typeLine: artZeile }));
    }

    if (options.labels && options.activePlaceId) {
        // Der gewöhnliche Name ist für diese Kennung ausgeschlossen. Die Auswahl bekommt genau
        // einen Namen, auch bei Kollision; Editorwerte und die Kartografie aller anderen bleiben bestehen.
        // Je Klasse eine Ebene, weil der Abstand am Marker der Klasse hängt (WI-0135); nur eine davon trifft den Ort.
        // 🪤 Er steht immer RECHTS: Ein Name, der nie weicht, braucht keine Ausweichseite.
        for (const klasse of PLACE_CLASSES_BY_RANK) {
            const selectedName = ortsnameAufSeite(
                ortsnamenLayer(
                    placeActiveLabelLayerId(klasse),
                    ["all", NAMED_PLACE, aktiverOrt, ["==", ["get", "subtype"], klasse]],
                    ersteZelleNachUnten(AVENTURIA_ZOOM_BANDS.label),
                ),
                klasse,
                "right",
                { mitSperre: false },
            );
            if (selectedName.type === "symbol") {
                selectedName.layout = {
                    ...selectedName.layout,
                    "text-allow-overlap": true,
                    "text-ignore-placement": true,
                };
            }
            layers.push(selectedName);
        }
    }

    return layers;
}
