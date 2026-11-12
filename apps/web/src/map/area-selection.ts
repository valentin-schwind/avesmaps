import type {
    DataDrivenPropertyValueSpecification,
    FilterSpecification,
    GeoJSONSourceSpecification,
    LayerSpecification,
    SourceSpecification,
} from "maplibre-gl";
import {
    AVENTURIA,
    DESIGN_CANON,
    canonColour,
    labelFamily,
    landscapeReaderName,
    toRenderLngLat,
    type MapPoint,
    type SearchHit,
} from "@avesmaps3d/shared";
import {
    isWaterType,
    landscapeNameLayout,
    landscapeNamePaint,
    LANDSCAPE_SOURCE_ID,
    LANDSCAPE_SOURCE_LAYER,
    WATER_SOURCE_ID,
    WATER_SOURCE_LAYER,
} from "./landscape-layers";
import { NO_OUTLINE, type Outline } from "./area-lookup";
import { PATH_SOURCE_ID, PATH_SOURCE_LAYER } from "./path-layers";
import { inViewBand } from "./territory-band";
import { TERRITORY_SOURCE_ID, TERRITORY_SOURCE_LAYER } from "./territory-layers";

/**
 * Die gewählte Fläche (WI-0043, Betreiber 2026-09-26: „Beim Klick auf Flächen … soll immer eine leuchtende
 * Fläche mit Kontur kommen … schön auf der Karte mit Label“).
 *
 * 🔴 EIN Zustand für drei Wege: Spotlight-Suche, Landschaftsname im Planer, Klick auf die Karte. Jeder baut
 * hier dieselbe `AreaSelection`; keiner zeichnet eine eigene Hervorhebung.
 *
 * 🔴 Auch ein Weg ist eine Auswahl (WI-0044, Betreiber 2026-09-26: „ihn auch markieren - (wie legacy, achte
 * auf die farbe)“): derselbe Zustand, dieselbe Farbe, derselbe Weg hinaus - ein Klick in die freie Karte
 * oder Escape. Er leuchtet als goldene Linie über dem ganzen Weg, ohne eigenen Namen: Seine Namen trägt
 * er schon.
 *
 * 🔴 Die Auswahl ist ein Overlay, keine Ansicht: Ihre Ebenen stehen in JEDER Ansicht und lesen die Umrisse
 * aus derselben Kachelquelle wie die Landschaftsflächen, gefiltert auf die eine Kennung. Wechselt die
 * Ansicht, bleibt die Fläche stehen.
 */

/**
 * Was gewählt ist: eine Landschaft, ein Weg (WI-0044) oder ein Herrschaftsgebiet (WI-0062, F7: Das Gebiet leuchtet in
 * der Markierungsfarbe, die es schon gibt; sein Name bleibt in der Beschriftung der Gebiete stehen und wird dort gelb, WI-0121).
 */
export type AreaKind = "landscape" | "path" | "territory";

export interface AreaSelection {
    kind: AreaKind;
    /**
     * Die stabile Kennung der Fläche. Bei Landschaften `region.public_id` - nie die eines Labels und nie ein
     * Name: Gleichnamige Regionen sind nicht dieselbe Fläche. Bei einem Weg der Kettenschlüssel der Suche
     * `name:<Name>` (bis der Wiki-Schlüssel kommt, MCS-014); bei einem Weg ohne echten Namen (ein Griff wie „Pfad-3443“ oder blank
     * „Weg“) die Kennung seines Abschnitts `#<public_id>`, wie die Wegeliste (`editorPathGroupKey`, `pathSegmentOfKey`).
     */
    id: string;
    /** Der Name, wie ein Leser ihn sieht; `null`, wo die Region nur einen Griff trägt („Wald-925“). */
    name: string | null;
    /** Die Art der Region: Aus ihr entsteht der Name, wo keiner steht („Wald“). Beim Weg seine Wegart. */
    type: string;
    /** Wo der Name der Auswahl steht, in Kartenkoordinaten (`aventuria-v1`, ADR-0003). */
    anchor: MapPoint;
    /**
     * Alle Regionen, die mit `id` EINE Landschaft sind: gleicher Name, gleiche Art, gleiche Ebene (WI-0047,
     * Betreiber zu G1: „wir wollen A“). Sie leuchten zusammen. Fehlt es, ist `id` allein gewählt.
     */
    group?: readonly string[];
    /**
     * Beim Weg im Editor der markierte Abschnitt (`path.public_id`; WI-0177 W2b, EDIT-0003 T24 (1): der erste Klick markiert die ganze
     * Straße, der zweite den Abschnitt). Fehlt er, leuchtet die ganze Kette.
     */
    segment?: string;
    /**
     * Beim Weg die Abschnitte seiner Gruppe, wie die Detailantwort sie nennt (`SubjectDetail.abschnitte`, WI-0302): auch die geteilten, die einer
     * anderen Straße gehören und seinen Artikel als weiteren Straßennamen tragen (Vali 2026-11-10, „Ja, mitzählen“). Dann leuchten genau sie,
     * nicht die Kette des Namens; fehlt die Liste, gilt der Name wie bisher.
     */
    abschnitte?: readonly string[];
}

/** Die Kennungen, die leuchten: die ganze Gruppe oder die eine Fläche. */
export function areaIds(area: AreaSelection): readonly string[] {
    return area.group ?? [area.id];
}

/** Die Auswahl, wie die Karte sie zeichnet: samt dem Namen in der Sprache der Seite. */
export type DrawnArea = AreaSelection & { label: string };

/** Woher eine Flächenart ihre Umrisse nimmt, und welche Eigenschaft der Kachel die Kennung trägt. */
interface AreaSource {
    source: string;
    sourceLayer: string;
    idProperty: string;
}

const AREA_SOURCES: Record<AreaKind, AreaSource> = {
    landscape: { source: LANDSCAPE_SOURCE_ID, sourceLayer: LANDSCAPE_SOURCE_LAYER, idProperty: "region_public_id" },
    // Ein Weg ist die Kette aus Name und Art (`areaFilter`), keine einzelne Kennung.
    path: { source: PATH_SOURCE_ID, sourceLayer: PATH_SOURCE_LAYER, idProperty: "name" },
    // Ein Herrschaftsgebiet in der Kachel der politischen Ansicht (`territory_fill_render`), gewählt über seine Kennung.
    territory: { source: TERRITORY_SOURCE_ID, sourceLayer: TERRITORY_SOURCE_LAYER, idProperty: "territory_public_id" },
};

export const AREA_SELECTION_FILL_LAYER_ID = "area-selection-fill";
export const AREA_SELECTION_GLOW_LAYER_ID = "area-selection-glow";
export const AREA_SELECTION_LINE_LAYER_ID = "area-selection-line";
export const AREA_SELECTION_LABEL_LAYER_ID = "area-selection-label";
export const AREA_SELECTION_LABEL_SOURCE_ID = "area-selection-label";
export const AREA_SELECTION_PATH_LAYER_ID = "area-selection-path";

/** Der Name, den die Auswahl trägt: der eigene, sonst die Art in der Sprache der Seite. */
export function areaLabel(area: AreaSelection, typeLabel: (type: string) => string): string {
    return area.name ?? typeLabel(area.type);
}

/**
 * Die Auswahl aus einem Suchtreffer (AC1). Nur ein Landschaftstreffer mit Region wählt eine Fläche.
 *
 * 🪤 Ein freies Label ist ein gültiges Sprungziel, aber keine Fläche (AC4): Es gibt `undefined`, und die
 * Karte fliegt hin, ohne etwas leuchten zu lassen. Aus dem Namen wird keine Region geraten.
 */
export function selectionFromSearchHit(hit: SearchHit): AreaSelection | undefined {
    // Ein Weg markiert sich ganz (WI-0044): alle Abschnitte mit seinem Namen (WI-0177 Schritt 2b).
    if (hit.kind === "weg" && hit.subtype !== undefined) {
        return { kind: "path", id: hit.id, name: hit.name, type: hit.subtype, anchor: { x: hit.x, y: hit.y } };
    }
    if (hit.kind !== "landschaft" || hit.region === undefined) {
        return undefined;
    }
    return {
        kind: "landscape",
        id: hit.region,
        name: hit.name,
        type: hit.subtype ?? "",
        anchor: { x: hit.x, y: hit.y },
        // Gleichnamige Regionen gleicher Art und Ebene sind EIN Treffer, und sie leuchten zusammen (WI-0047).
        ...(hit.regions === undefined ? {} : { group: hit.regions }),
    };
}

/**
 * Die Auswahl aus einer gezeichneten Landschaftsfläche (AC6): Kennung, Name und Art stehen an jedem
 * Polygon (`region_area_render`); der Name steht dort, wo geklickt wurde - auf der Fläche selbst.
 */
export function selectionFromRenderedArea(
    properties: Readonly<Record<string, unknown>>,
    anchor: MapPoint,
): AreaSelection | undefined {
    const id = properties[AREA_SOURCES.landscape.idProperty];
    if (typeof id !== "string" || id === "") {
        return undefined;
    }
    const type = typeof properties["region_type"] === "string" ? properties["region_type"] : "";
    const name = typeof properties["name"] === "string" ? landscapeReaderName(properties["name"], type) : null;
    return { kind: "landscape", id, name, type, anchor };
}

/** Dieselbe Fläche? Verglichen wird die Kennung, nie der Name. */
export function sameArea(left: AreaSelection | undefined, right: AreaSelection | undefined): boolean {
    return left !== undefined && right !== undefined && left.kind === right.kind && left.id === right.id;
}

/**
 * Nur die Polygone der gewählten Fläche - alle Teilflächen derselben Region zusammen (AC3). Beim Weg alle
 * Abschnitte mit seinem Namen, über Wegtypen hinweg, auch die ohne Beschriftung: dieselben, die die Suche einpasst.
 */
export function areaFilter(area: AreaSelection): FilterSpecification {
    if (area.kind === "path") return pathFilter(area);
    const property = ["get", AREA_SOURCES[area.kind].idProperty];
    const filter = (
        area.group === undefined ? ["==", property, area.id] : ["in", property, ["literal", [...area.group]]]
    ) as FilterSpecification;
    // Die Kachel trägt ALLE Bänder eines Gebiets: es leuchtet, was das Band der Ansicht zeigt - dasselbe wie die Füllung.
    return area.kind === "territory" ? inViewBand(filter) : filter;
}

/** Wie breit die goldene Linie eines gewählten Wegs ist (Legacy `getSpotlightPathHighlightWeight`). */
export function pathSelectionWidth(type: string): number {
    const look = DESIGN_CANON.mapSelection;
    return look.pathWidthByType[type] ?? look.pathWidth;
}

/**
 * Die Ebenen der Fläche, von unten nach oben: leuchtende Füllung, weicher Schein, klare Kontur.
 *
 * 🔴 Keine Bewegung: Was gewählt ist, wird nie animiert (Guide §29.1).
 */
export function buildAreaSelectionLayers(
    area: AreaSelection | undefined,
    options: { water?: boolean | undefined; outline?: boolean | undefined } = {},
): LayerSpecification[] {
    if (!area) {
        return [];
    }
    // In der Topographie leuchtet ein See oder ein Meer in der geglätteten Form, die die Karte dort zeigt (WI-0055).
    const { source, sourceLayer } =
        area.kind === "landscape" && options.water === true && isWaterType(area.type)
            ? { source: WATER_SOURCE_ID, sourceLayer: WATER_SOURCE_LAYER }
            : AREA_SOURCES[area.kind];
    // Wo die Karte keine Landschaftsflächen zeichnet, kommt der Umriss vom Server (WI-0058): eine GeoJSON-Quelle
    // mit genau dieser Auswahl, ohne Kachelschicht und ohne Filter.
    const origin =
        area.kind === "landscape" && options.outline === true
            ? { source: AREA_SELECTION_OUTLINE_SOURCE_ID }
            : { source, "source-layer": sourceLayer, filter: areaFilter(area) };
    const look = DESIGN_CANON.mapSelection;
    if (area.kind === "path") {
        // Legacys Spotlight-Markierung: Gold, fast deckend, runde Enden und Ecken, fest in Pixeln.
        return [
            {
                id: AREA_SELECTION_PATH_LAYER_ID,
                type: "line",
                ...origin,
                layout: { "line-join": "round", "line-cap": "round" },
                paint: {
                    "line-color": canonColour("mapSelection"),
                    "line-opacity": look.pathOpacity,
                    "line-width": pathSelectionWidth(area.type),
                },
            },
        ];
    }
    return [
        {
            id: AREA_SELECTION_FILL_LAYER_ID,
            type: "fill",
            ...origin,
            paint: { "fill-color": canonColour("mapSelection"), "fill-opacity": look.fillOpacity },
        },
        {
            // MapLibre kennt keinen drop-shadow wie Legacy: Den Schein zeichnet eine breite, weiche Linie
            // unter der Kontur, zur Hälfte in die Fläche, zur Hälfte hinaus.
            id: AREA_SELECTION_GLOW_LAYER_ID,
            type: "line",
            ...origin,
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
                "line-color": canonColour("mapSelectionGlow"),
                "line-width": look.glowWidth,
                "line-blur": look.glowBlur,
            },
        },
        {
            id: AREA_SELECTION_LINE_LAYER_ID,
            type: "line",
            ...origin,
            layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-color": canonColour("mapSelection"), "line-width": look.lineWidth },
        },
    ];
}

export const AREA_SELECTION_OUTLINE_SOURCE_ID = "area-selection-outline";

/** Der Umriss der Auswahl vom Server (WI-0058); leer, solange er unterwegs ist. */
export function buildAreaSelectionOutlineSource(outline: Outline | undefined): GeoJSONSourceSpecification {
    return { type: "geojson", data: outline ?? NO_OUTLINE };
}

export const AREA_PREVIEW_OUTLINE_SOURCE_ID = "area-preview-outline";
export const AREA_PREVIEW_OUTLINE_LAYER_ID = "area-preview-outline";

/**
 * Die Quelle der Vorschau beim Zeigen (WI-0043 Stufe 2, „A“): nur die Form unter dem Zeiger, als Linien. Sie füllt sich aus den
 * geladenen Kacheln (`vorschau-umriss.ts`, WI-0266) oder, wo die Ansicht keine Landschaftsflächen zeichnet, vom Server (WI-0058).
 */
export function buildAreaPreviewOutlineSource(): GeoJSONSourceSpecification {
    return { type: "geojson", data: NO_OUTLINE };
}

/**
 * Die Vorschau beim Zeigen (WI-0043 Stufe 2, „A“): eine gestrichelte Kontur der Fläche, die ein Klick wählen würde, so breit wie
 * die der Auswahl und in ihrer Farbe (Betreiber 2026-09-28: „diesselbe dicke wie bei selektiert“). EINE Ebene für Gegend, See und
 * Gebiet; welche Form sie trägt, entscheidet die Eingabe (`outlineArea`).
 *
 * 💣 **Keine Ebene mehr an der Kachelquelle** (WI-0266): Bis 2026-10-31 stand je Quelle eine unsichtbare Ebene mit Feature-State, und
 * MapLibre zeichnete sie in jedem Bild ganz (Messung in `vorschau-umriss.ts`).
 */
export function buildAreaPreviewOutlineLayer(): LayerSpecification {
    return {
        id: AREA_PREVIEW_OUTLINE_LAYER_ID,
        type: "line",
        source: AREA_PREVIEW_OUTLINE_SOURCE_ID,
        layout: { "line-join": "round" },
        paint: {
            "line-color": canonColour("mapSelection"),
            "line-width": DESIGN_CANON.mapSelection.lineWidth,
            "line-dasharray": [2, 1.5],
        },
    };
}

/**
 * Die Vorschau eines WEGS (WI-0090). Hieß `area-preview-path`, solange nur Flüsse umrandet wurden; seit der Weg sein
 * eigener Besitzer ist, heißt sie nach ihm - ein „area“ im Namen führte zur falschen Datei. Quelle und Ebene tragen denselben Namen.
 */
export const PATH_PREVIEW_LAYER_ID = "path-preview";
export const PATH_PREVIEW_SOURCE_ID = PATH_PREVIEW_LAYER_ID;

/**
 * Welche Abschnitte zu einer Kette gehören: derselbe Name, über Wegtypen und Kennzeichen hinweg (WI-0177 Schritt 2b, Legacys Regel (c);
 * wie die Zeilen der Wegeliste, `editorPathGroupKey`). Damit sucht die Vorschau die Abschnitte in den geladenen Kacheln
 * (`querySourceFeatures`).
 *
 * 🔴 Ohne die Abschnitte, die blank nach ihrer Art heißen (`isInPathChain`, dieselbe Grenze wie die Kette des Servers): „Weg“ an einem
 * `Weg` ist ein Griff. Ein `Pfad`, der „Weg“ heißt, zog sonst alle namenlosen Wege der Karte mit in sein Gold.
 */
export function pathChainFilter(name: string): FilterSpecification {
    return ["all", ["==", ["get", "name"], name], ["!=", ["get", "subtype"], name]];
}

/** Die Vorsilbe des Schlüssels eines Wegs ohne echten Namen: Er ist sein Abschnitt (`editorPathGroupKey` in `@avesmaps3d/shared`). */
const ABSCHNITT_SCHLUESSEL = "#";

/** Der Abschnitt (`path.public_id`) hinter dem Schlüssel eines Wegs ohne echten Namen; `undefined` bei einer Kette `name:<Name>`. */
export function pathSegmentOfKey(key: string): string | undefined {
    return key.startsWith(ABSCHNITT_SCHLUESSEL) && key.length > ABSCHNITT_SCHLUESSEL.length
        ? key.slice(ABSCHNITT_SCHLUESSEL.length)
        : undefined;
}

/**
 * Welche Abschnitte eines Wegs leuchten: der markierte Abschnitt (Editor, W2b), sonst ein Weg ohne echten Namen als sein einer Abschnitt,
 * sonst die Abschnitte der Gruppe, die der Server nennt (WI-0302, auch die geteilten; die Kacheln tragen `public_id`), sonst die ganze Kette
 * seines Namens. 🪤 Nicht `["id"]`: Die Kennung, die `promoteId` hebt, sieht der Filter einer Ebene nicht
 * (gemessen: kein Strich), nur Zustand und Abfrage.
 *
 * 🔴 Ein Griff ist keine Kette (Betreiber 2026-11-09, Bild „Unbezeichneter Weg“ mit Gold von Angbar bis Caldaia): Viele Abschnitte heißen
 * blank „Weg“, und ein Filter auf den Namen nahm sie alle.
 */
export function pathFilter(path: {
    readonly id: string;
    readonly name: string | null;
    readonly segment?: string;
    readonly abschnitte?: readonly string[];
}): FilterSpecification {
    const segment = path.segment ?? pathSegmentOfKey(path.id);
    if (segment !== undefined) return ["==", ["get", "public_id"], segment];
    if (path.abschnitte !== undefined && path.abschnitte.length > 0)
        return ["in", ["get", "public_id"], ["literal", [...path.abschnitte]]];
    return pathChainFilter(path.name ?? "");
}

/**
 * Der Abstand der zwei Striche je Wegart: so weit auseinander, dass sie genau das Band umfassen, das beim Anklicken
 * leuchtet. Aus demselben Kanonwert wie die Auswahl (`pathSelectionWidth`), damit Vorschau und Auswahl dieselbe Linie
 * meinen - keine zweite Breitentafel.
 *
 * 🪤 `["match", …]` statt einer Zahl: Eine Reichsstraße leuchtet breiter als ein Pfad (12 gegen 10 Kanonpixel), und bis
 * WI-0090 stand hier die Zahl des FLUSSES für alle. Der Vorgabefall deckt jede Art, die der Kanon nicht eigens nennt.
 */
function pathPreviewGapExpression(): DataDrivenPropertyValueSpecification<number> {
    const look = DESIGN_CANON.mapSelection;
    const gap = (type: string): number => Math.max(0, pathSelectionWidth(type) - 2 * look.lineWidth);
    const named = Object.keys(look.pathWidthByType);
    if (named.length === 0) return gap("");
    return [
        "match",
        ["get", "subtype"],
        ...named.flatMap((type) => [type, gap(type)]),
        gap(""),
    ] as unknown as DataDrivenPropertyValueSpecification<number>;
}

/** Die Quelle der Wege-Vorschau: die Abschnitte der gezeigten Kette als Linien, mit ihrer Art (`subtype`) für den Abstand. */
export function buildPathPreviewSource(): GeoJSONSourceSpecification {
    return { type: "geojson", data: NO_OUTLINE };
}

/**
 * Die Vorschau eines WEGS (Betreiber 2026-09-28 für den Fluss: „kannst du bei flüssen die kontur - nicht den pfad - gelb
 * stricheln“; mit WI-0090 für jede Wegart): zwei gestrichelte Linien links und rechts des Laufs, der Weg selbst bleibt
 * dazwischen sichtbar. Außen so breit wie das Band, das beim Anklicken leuchtet; die Strichstärke ist die der
 * Flächenvorschau.
 *
 * 🔴 Keine zweite Gestalt (WI-0090 § 3.3): Es ist die Strichelung, die der Fluss schon hatte - dieselbe Farbe, dasselbe
 * `line-dasharray`, dieselbe `line-gap-width`-Bauform -, nur ohne den Riegel auf eine einzige Wegart. WO sie erscheint,
 * entscheidet nicht diese Datei, sondern `pathPreviewOutlined` (`interaction/priorities.ts`).
 *
 * 💣 **Weder Filter noch Feature-State an der Kachelquelle.** Ein Filterwechsel lädt jede Kachel der Quelle `paths` neu (Betreiber
 * 2026-10-09: die Strichelung „läuft hinter allen Objekten her“, gemessen: vier Wegwechsel, 43 Kachel-Neuladungen); eine unsichtbare
 * Ebene mit Feature-State zeichnete MapLibre in jedem Bild über alle Wege (WI-0266). Die Kette steht deshalb in einer eigenen Quelle.
 */
export function buildPathPreviewLayer(): LayerSpecification {
    const look = DESIGN_CANON.mapSelection;
    return {
        id: PATH_PREVIEW_LAYER_ID,
        type: "line",
        source: PATH_PREVIEW_SOURCE_ID,
        layout: { "line-join": "round" },
        paint: {
            "line-color": canonColour("mapSelection"),
            "line-width": look.lineWidth,
            "line-gap-width": pathPreviewGapExpression(),
            "line-dasharray": [2, 1.5],
        },
    };
}

/**
 * Die Form, in der die Beschriftung dieser Region auf der Karte steht: ihre redaktionelle Größe und die Art
 * der BESCHRIFTUNG, aus der die Versalien kommen (`map_label_effective`, Migration 0057). Beide Kachelquellen
 * führen sie - die Punktlabels wie die Schriftläufe.
 */
export interface AreaNameForm {
    labelSize: number;
    labelType: string;
}

/**
 * Die Form, mit der ein Ersatzname auftritt, solange die Karte die echte noch nicht gezeigt hat: die Größe aus
 * dem Kanon und die Art der REGION als Schlüssel. 🪤 Das ist der zweitbeste Schlüssel - 64 derographischen
 * Regionen fehlt die Art (Legacy-Bestand, etwa Darpatien), und sie stünden damit gemischt. Sobald die Karte
 * die Beschriftung einmal gezeigt hat, gilt deren eigene Form (`area-selection-name.ts`).
 */
export function fallbackNameForm(area: AreaSelection): AreaNameForm {
    return { labelSize: DESIGN_CANON.mapSelection.labelSize, labelType: area.type };
}

/**
 * Der Ersatzname als GeoJSON. Eigener Typ statt des GeoJSON-Namensraums, wie bei den Zonennamen
 * (`ClimateLabelPoints`): Der Stil nimmt die Eigenschaften genau so, wie die Ebene sie liest.
 */
export interface AreaNamePoints {
    type: "FeatureCollection";
    features: {
        type: "Feature";
        geometry: { type: "Point"; coordinates: [number, number] };
        properties: { name: string; label_size: number; label_type: string };
    }[];
}

/** Eine leere Sammlung: Die Quelle bleibt im Stil, damit ein Wechsel nur die Daten tauscht. */
export const NO_AREA_NAME: AreaNamePoints = { type: "FeatureCollection", features: [] };

/**
 * Der Punkt, an dem der ERSATZNAME der Auswahl steht, samt der Form, in der er auftritt.
 *
 * 🔴 Er ist ein Ersatz, kein zweiter Name (WI-0093). Was die Quelle trägt, entscheidet die laufende Karte in
 * `area-selection-name.ts`: Steht der gewöhnliche Name im Bild, bleibt sie leer, und die Auswahl zeigt sich
 * allein daran, dass dieser Name golden ist.
 */
export function areaNameFeatures(
    area: DrawnArea | undefined,
    form: AreaNameForm | undefined,
    /** Die Art als zweite Zeile, wenn eine gleichnamige zweite Fläche daneben liegt (WI-0135); sonst nichts. */
    typeLine?: string,
): AreaNamePoints {
    const anchor = area ? toRenderLngLat(AVENTURIA.coordinateSpace, area.anchor) : undefined;
    if (!area || !anchor) {
        return NO_AREA_NAME;
    }
    const look = form ?? fallbackNameForm(area);
    return {
        type: "FeatureCollection",
        features: [
            {
                type: "Feature",
                properties: {
                    name: area.label,
                    // Dieselben Eigenschaften, aus denen der gewöhnliche Name seine Form zieht.
                    label_size: look.labelSize,
                    label_type: look.labelType,
                    ...(typeLine === undefined || typeLine === "" ? {} : { type_line: typeLine }),
                },
                geometry: { type: "Point", coordinates: [anchor.lng, anchor.lat] },
            },
        ],
    };
}

/** Die Quelle des Ersatznamens im Stil: immer leer, gefüllt wird sie zur Laufzeit. */
export function buildAreaSelectionLabelSource(): SourceSpecification {
    return { type: "geojson", data: NO_AREA_NAME } satisfies GeoJSONSourceSpecification;
}

/** Legacys `white-space: nowrap` in MapLibres Sprache: eine Höchstbreite, die kein Name erreicht. */
const NO_WRAP = 1000;

/**
 * Der ERSATZNAME der Auswahl (AC5, neu gefasst mit WI-0093).
 *
 * 🔴 Er tritt nur an, wo der gewöhnliche Name gerade NICHT gezeichnet ist (Betreiber 2026-10-06: „wenn der
 * der text schon voll sichtbar/lesbar ist, braucht er keine verschiebung erfahren (das ist nur praktisch für
 * flächen, wo man nur zu nah dran ist)"). Wer das entscheidet, steht in `area-selection-name.ts`; diese
 * Ebene zeichnet nur, was die Quelle trägt.
 *
 * 🔴 Seine Form ist die des gewöhnlichen Namens, aus EINER Stelle (`landscapeNameLayout`,
 * `landscapeNamePaint`): Größe und Versalien aus `label_size` und `label_type`, der Saum als Anteil
 * derselben Größe. Vorher stand hier eine feste Größe von 22 px und die Art der REGION statt der der
 * Beschriftung - daher der Formsprung beim Klick, den der Nutzertest gemeldet hat.
 *
 * 🔴 Er steht immer, wo er steht (`text-allow-overlap`), und verdrängt keinen anderen Namen
 * (`text-ignore-placement`): Die übrigen Beschriftungen werden gesetzt, als gäbe es ihn nicht - sonst
 * könnte sein Erscheinen den Namen verdrängen, dessen Fehlen ihn gerufen hat.
 */
export function buildAreaSelectionLabelLayer(
    font: string,
    { typeLine = false }: { typeLine?: boolean } = {},
): LayerSpecification {
    // Die Art als zweite Zeile wie am gewöhnlichen Namen (WI-0135), nur in der Ebene „Alle“; ob ein Zwilling daneben liegt,
    // entscheidet `area-selection-name.ts` und legt die Art dann an den Punkt (`type_line`).
    const scale = labelFamily("landscape").typeLineScale ?? 1;
    const text = typeLine
        ? [
              "case",
              ["has", "type_line"],
              ["format", ["get", "name"], {}, "\n", {}, ["get", "type_line"], { "font-scale": scale }],
              ["get", "name"],
          ]
        : ["get", "name"];
    return {
        id: AREA_SELECTION_LABEL_LAYER_ID,
        type: "symbol",
        source: AREA_SELECTION_LABEL_SOURCE_ID,
        layout: {
            "text-field": text as DataDrivenPropertyValueSpecification<string>,
            "text-font": [font],
            "text-max-width": NO_WRAP,
            ...landscapeNameLayout(),
            "text-allow-overlap": true,
            "text-ignore-placement": true,
        },
        paint: landscapeNamePaint(canonColour("mapSelection")),
    };
}
