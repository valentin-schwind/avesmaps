import type {
    DataDrivenPropertyValueSpecification,
    FillLayerSpecification,
    FilterSpecification,
    LayerSpecification,
    SourceSpecification,
} from "maplibre-gl";
import {
    AVENTURIA_CARTOGRAPHY,
    AVENTURIA_PATH_CARTOGRAPHY,
    WATER_AREA_TYPES,
    WATER_CARTOGRAPHY_LAYER,
    canonColour,
    cartographyForType,
    cartographyLayersInOrder,
    cartographyTypesOfLayer,
    collisionSortKey,
    darkenColour,
    DESIGN_CANON,
    FACULTY_GLYPHIC_METRICS,
    haloExpression,
    labelFamily,
    measureTextWidth,
    oklchOf,
    oklchToHex,
    spannenFilter,
    withOklchLightness,
    type LabelFamilyName,
    type LandscapeLayer,
    VECTOR_TILE_MAX_ZOOM,
    zoomFromBand,
    zoomUntilBand,
} from "@avesmaps3d/shared";
import { abweichendeSpannen } from "./zoombaender-stand";
import { isPhoneViewport } from "../controls/phone-viewport";
import { isMessageKey, t } from "../i18n/i18n";

/**
 * Die Zonentafel bleibt eine Datentafel und wird hier zur MapLibre-Expression. Dieselbe Grenze wie
 * in `place-layers.ts`: das Modell produziert einfache Arrays, und genau eine Stelle macht daraus
 * den Renderer-Typ.
 */
function asColourExpression(expression: unknown): DataDrivenPropertyValueSpecification<string> {
    return expression as DataDrivenPropertyValueSpecification<string>;
}

/**
 * Landschaftsflaechen (WI-0003).
 *
 * Die Zeichenreihenfolge ist Migrationsgegenstand, keine Gestaltungsfrage: Legacy legt die Ebenen
 * als Leaflet-Panes mit festem z-Index uebereinander - Topographie unten, darueber Vegetation,
 * darueber Derographisch, und ueber allem die Wege, die Orte und zuletzt saemtliche Namen
 * (Finding MCS-007). Wer die Reihenfolge aendert, aendert die Karte.
 *
 * 🔴 KEINE FARBE STEHT IN DIESER DATEI. Sie kommen aus `config/map-cartography/aventuria.json`
 * (WI-0008). Vorher teilten sich 25 Landschaftsarten drei Farben, eine je Ebene - ein Wald sah aus
 * wie ein Gebirge, sobald beide in derselben Ebene lagen. Wer hier ein Farbliteral einfuegt, nimmt
 * der Tafel ihre Bedeutung.
 */

export const LANDSCAPE_SOURCE_ID = "landscapes";
export const LANDSCAPE_SOURCE_LAYER = "region_area_render";

/**
 * Von unten nach oben, genau wie Legacy stapelt. Klima fehlt: es ist nicht migriert.
 *
 * Die Deckkraft ist je Ebene gestaffelt, und zwar aus einem Grund, den man erst auf der Karte
 * sieht: eine derographische Flaeche ist ein halbes Herzogtum und deckt bei gleicher Deckkraft die
 * Grundkarte zu, waehrend ein Wald nur einen Flecken einfaerbt. Legacy haelt dafuer eine eigene
 * Deckkraft je Ebene; bis die Darstellungstafel uebernommen ist, stehen hier Naeherungen.
 */
const CARTOGRAPHY = AVENTURIA_CARTOGRAPHY;

/**
 * Die Fuellfarbe einer Ebene als `match` ueber die Landschaftsart.
 *
 * 🪤 Der letzte Eintrag ist der Auffangwert, und er ist sichtbar grau, nicht durchsichtig. Eine
 * Flaeche, die verschwindet, weil jemand eine neue Art angelegt hat, faellt auf der Karte niemandem
 * auf; eine graue schon. Der Test in `map-cartography.test.ts` faengt den Fall vorher ab.
 */
export function fillForLayer(
    layer: string,
    transform: (colour: string) => string,
): DataDrivenPropertyValueSpecification<string> {
    const entries = cartographyTypesOfLayer(layer);
    const fallback = transform(cartographyForType(undefined).fill);
    if (entries.length === 0) {
        return asColourExpression(fallback);
    }
    return asColourExpression([
        "match",
        ["get", "region_type"],
        ...entries.flatMap(({ type, fill }) => [type, transform(fill)]),
        fallback,
    ]);
}

/**
 * Die Landschaftsarten des Wassers (Kartografie-Tafel, Ebene Topographie): See und Meer. Die EINE Liste steht in
 * `WATER_AREA_TYPES` im geteilten Paket - dort hängt seit WI-0083 (Nachtrag) auch die Ebene des Wassers daran, und damit
 * die Zugehörigkeit der Flüsse.
 */
const [LAKE_TYPE, SEA_TYPE] = WATER_AREA_TYPES;

/** See oder Meer: Wo die geglättete Quelle sie zeichnet (`terrain_water_render`), leuchten und umreißen sie in deren Form. */
export function isWaterType(type: string): boolean {
    return type === LAKE_TYPE || type === SEA_TYPE;
}

/** Welches Wasser die geglättete Quelle (`terrain_water_render`) in einer Ansicht zeichnet. */
export interface SmoothWater {
    lakes: boolean;
    seas: boolean;
}

/**
 * Wo die Karte Seen und Meere aus der geglätteten Quelle zeichnet (WI-0055).
 *
 * 🔴 Ein See hat EINE Form, wo immer die Karte ihn als Fläche zeichnet (Betreiber 2026-10-04: „der see wird
 * angezeigt, aber ungeglättet“; vorher 2026-09-28: „geht das glätten auch bei meeren und seen?“): die der Sicht
 * `terrain_water_render`, seit WI-0077 aus dem gemeinsamen Netz aller Flächen (dasselbe Ufer wie die Fläche daneben, dieselbe
 * Form wie in den Landschaftskacheln). Wo keine Landschaftsfläche steht (Standard, Politisch, Nur Karte, Kraftlinien), ist der
 * See ins Kachelbild gemalt und hier kein Thema.
 *
 * 🔴 **Das Meer steht in JEDER Landschaftsansicht** (WI-0083, Betreiber 2026-10-05: „seen und meere sollen in allen ansichten
 * sichtbar sein, aber nur in topographie (und alle) anklickbar“) - und seit dem Nachtrag **überall von HIER**, also überall in
 * demselben Blau und in derselben weichen Form (Betreiber 2026-10-05: „in alle normal blau“). Vorher war „Alle“ die Ausnahme:
 * Dort malte die Füllung der Ebene Topographie das Meer als Lasur, also blasser und in der eckigen Form der
 * Landschaftskacheln, während es in jeder anderen Ansicht deckend aus der geglätteten Quelle kam.
 *
 * Der See hängt am Schalter „Flüsse und Seen“, das Meer nicht; beide hängen an den Flächen: ohne Flächen keine
 * Landschaftsansicht und kein Wasser von hier.
 *
 * 🪤 Wählbar ist dieses Wasser trotzdem nur in Topographie und „Alle“ - das entscheidet nicht der Stil, sondern die Tafel der
 * Teilnehmer (`areaLayersInView` in `interaction/priorities.ts`): See und Meer sind Landschaftsarten der Topographie.
 *
 * `undefined` heißt: keine geglättete Quelle im Stil (und keine Anfrage an ihre Kacheln).
 */
export function smoothWaterFor(
    composition: { contours: boolean; landscapeLayers: readonly string[] },
    display: { landscapeAreas: boolean; hideLakes: boolean },
): SmoothWater | undefined {
    if (composition.contours) {
        return { lakes: !display.hideLakes, seas: true };
    }
    if (!display.landscapeAreas || composition.landscapeLayers.length === 0) {
        return undefined;
    }
    // Das Meer kommt in JEDER Landschaftsansicht von hier, auch in „Alle“: ein Blau, eine Form (Nachtrag zu WI-0083).
    // Es hängt nicht am Schalter „Flüsse und Seen“ - der gilt dem See.
    return { lakes: !display.hideLakes, seas: true };
}

export function buildLandscapeSource(tileUrl: string): SourceSpecification {
    return {
        type: "vector",
        tiles: [tileUrl],
        minzoom: 0,
        maxzoom: VECTOR_TILE_MAX_ZOOM,
        promoteId: { [LANDSCAPE_SOURCE_LAYER]: "region_public_id" },
    };
}

/** Die Füllung einer Landschaftsebene - der Layer, auf den man eine Fläche anklickt (WI-0043). */
export function landscapeFillLayerId(layer: string): string {
    return `landscape-fill-${layer}`;
}

/** Die Seen: eine eigene Füllung über allen Ebenen, damit man sie weiter anklicken kann (WI-0043). */
export const LAKE_FILL_LAYER_ID = landscapeFillLayerId(LAKE_TYPE);

/**
 * Die Füllebenen im Stil, aus denen die Werkzeuge der Form ihre Teilfläche unter dem Zeiger lesen (`teilflaecheAn`, Ziele von „Mit anderer Fläche ›“).
 *
 * 🪤 Seen und Meere stehen nicht in `landscape-fill-*`, sondern in der geglätteten Quelle (`buildSmoothWaterLayers`). Ohne diese beiden Ebenen fand das
 * Ausschneiden Hügel und Tiefland, Wasser aber nie, und jedes Werkzeug am Wasser begann still gar nicht (OPS-000087). Wasser zählt nur, wo es auch wählbar
 * ist: `waehlbar` sind die Ebenen der Ansicht (`areaLayersInView`), `undefined` heißt alle; in der Vegetation ist es zu sehen, aber kein Ziel.
 */
export function flaechenEbenenImStil(schichten: readonly string[], waehlbar: readonly string[] | undefined): string[] {
    const wasser = waehlbar === undefined || waehlbar.includes(WATER_CARTOGRAPHY_LAYER);
    return schichten.filter(
        (id) =>
            id.startsWith("landscape-fill-") ||
            (wasser && (id === WATER_FILL_LAYER_ID || id === WATER_SEA_FILL_LAYER_ID)),
    );
}

/**
 * Die Wasserfarbe: EINE für Flusslinie, Bach und Seefläche (Legacy, Owner 09.09.2026; die Tafel der Wege
 * sagt es an `Flussweg`). Vorher trug der See die hellere Farbe seiner Landschaftsart, als Lasur.
 */
const WATER_COLOUR = AVENTURIA_PATH_CARTOGRAPHY.types["Flussweg"]?.center ?? cartographyForType(LAKE_TYPE).fill;

/**
 * Die Wasserfarbe einer Füllung, die in der Zeichenreihenfolge bleibt, nicht im Tiefenpuffer.
 *
 * 💣 MapLibre malt eine Füllung mit KONSTANTER, deckender Farbe und Deckkraft 1 im „Opaque-Pass“: zuerst, von oben nach
 * unten, mit Tiefenpuffer. Alle übrigen Flächen (Lasuren, Farbe je Art) folgen danach im „Translucent-Pass“ und
 * verlieren gegen diese Tiefe dort, wo sie UNTER der Füllung liegen. Das gilt nur, solange der Tiefentest greift. Greift
 * er nicht (der Verdacht: iPhone-Safari; belegt: ein WebGL ohne Tiefentest), liegen alle Flächen der Landschaften
 * ÜBER dem See, und er bleibt als dünne Kante übrig, während Flüsse und alles andere stehen. Die Probe ist
 * `lakes-without-depth.spec.ts`.
 *
 * Eine Farbe je Landschaftsart ist keine Konstante: Die Füllung wird dann wie jede andere Landschaftsfläche in der
 * Reihenfolge des Stils gemalt, mit denselben Pixeln. Ein Wächter (`fill-painter-order.test.ts`) hält jede Füllung
 * des Stils aus dem Opaque-Pass heraus, nicht nur diese.
 */
export function waterColourInPaintOrder(colour: string): DataDrivenPropertyValueSpecification<string> {
    return asColourExpression(["match", ["get", "region_type"], LAKE_TYPE, colour, colour]);
}

/** Alle Füllungen, die es geben kann; welche gerade gezeichnet werden, entscheidet die Ansicht. Klima fehlt: eigene Quelle. */
export const LANDSCAPE_FILL_LAYER_IDS: readonly string[] = [
    ...cartographyLayersInOrder()
        .filter(({ layer }) => layer !== "klima")
        .map(({ layer }) => landscapeFillLayerId(layer)),
    LAKE_FILL_LAYER_ID,
];

/** Die Flächen einer Ebene; Seen und Meere zeichnet `buildSmoothWaterLayers`, geglättet (WI-0055, seit dem Nachtrag zu WI-0083 überall). */
function landscapeFilter(layer: string, withoutWater: boolean): FilterSpecification {
    return [
        "all",
        ["==", ["get", "region_layer"], layer],
        withoutWater
            ? ["!", ["in", ["get", "region_type"], ["literal", [LAKE_TYPE, SEA_TYPE]]]]
            : ["!=", ["get", "region_type"], LAKE_TYPE],
    ] as FilterSpecification;
}

/** Die Füllung einer Ebene ohne Farbe: Kennung, Quelle, Filter und Rang (`stack_order`), gleich für gezeichnete und nur getroffene Flächen. */
function landscapeFill(layer: string, filter: FilterSpecification): Omit<FillLayerSpecification, "paint"> {
    return {
        id: landscapeFillLayerId(layer),
        type: "fill",
        source: LANDSCAPE_SOURCE_ID,
        "source-layer": LANDSCAPE_SOURCE_LAYER,
        filter,
        layout: { "fill-sort-key": ["to-number", ["get", "stack_order"], 0] },
    };
}

/** Die Deckkraft, mit der eine Ebene ihre Flächen zeichnet; `alone`: Sie ist die einzige gewählte. */
export function landscapeFillOpacity(layer: string, alone: boolean): number {
    const style = CARTOGRAPHY.layers[layer];
    if (style === undefined) return 1;
    return alone ? (style.fillOpacityAlone ?? style.fillOpacity) : style.fillOpacity;
}

/**
 * Die Flächen der Ebenen nur zum Treffen, unsichtbar und ohne Kante (Fund 2026-11-10, Vali: „Wenn die bunte Höhenkarte an ist, sind
 * manche Flächen der Topographie beim Ausschneiden nicht anklickbar.“). In den Höhenstufen färbt die Höhe das Land, die Flächen stehen
 * dort nicht im Stil (WI-0055). Die Werkzeuge der Editoren lesen ihre Fläche aber aus `landscape-fill-*` (Kartenmenü, „Mit anderer
 * Fläche ›“, Zerschneiden, Verschieben), und so blieben nur Seen und Meer treffbar. Dieselbe Kennung, dieselbe Quelle, derselbe Filter:
 * Wer die Fläche sucht, findet sie wie in den Höhenlinien. Die Kacheln laden die Editoren dort ohnehin (die Sperre liest dieselbe Quelle).
 */
export function buildLandscapeHitLayers(
    activeLayers: readonly string[],
    options: { withoutWater?: boolean | undefined } = {},
): LayerSpecification[] {
    return cartographyLayersInOrder()
        .filter(({ layer }) => layer !== "klima" && activeLayers.includes(layer))
        .map(
            ({ layer }) =>
                ({
                    ...landscapeFill(layer, landscapeFilter(layer, options.withoutWater === true)),
                    paint: { "fill-opacity": 0 },
                }) satisfies LayerSpecification,
        );
}

/**
 * Die Flächenlayer der gewählten Ebenen (WI-0009).
 *
 * 🪤 Eine nicht gewählte Ebene wird WEGGELASSEN, nicht auf `visibility: none` gesetzt. Ein Layer,
 * der im Style steht, lädt weiter Kacheln - und in einer Messung „welche Ebene wird angefragt" wäre
 * er nicht von einer sichtbaren zu unterscheiden.
 *
 * `hideLakes`: der Schalter „Flüsse und Seen" ist aus (WI-0028). Ein See ist nur hier eine Fläche -
 * sonst ist er ins Kachelbild gemalt (Legacy `applyEcosystemGewaesserKlasse`).
 *
 * 🔴 Seen sind Wasser wie die Flüsse (Betreiber 2026-09-28: „seen keine transparenz mehr geben (generell wie
 * flüsse behandeln)“): deckend in der Wasserfarbe, über allen Ebenen und in JEDER Auswahl, solange der
 * Flussschalter an ist. Die Topographie zeichnet sie nicht mehr mit.
 *
 * Ist nur eine Ebene gewählt, steht sie mit `fillOpacityAlone`, wenn die Kartografietafel einen trägt; heute trägt keine.
 * Die Vegetation steht allein und in „Alle“ bei 0,6, damit ihre Arten unterscheidbar bleiben (OPS-000072, Betreiber
 * 2026-10-30: „0,6 passt“, „du kannst auch in "alle" 0,6 für die vegetation machen“). In „Alle“ bleibt sonst die Lasur.
 *
 * 🔴 Wasser ist hier nie zweimal gezeichnet: Wo `buildSmoothWaterLayers` See und Meer zeichnet (`withoutWater`, seit dem
 * Nachtrag zu WI-0083 in jeder Landschaftsansicht), stehen ihre eckigen Flächen aus den Landschaftskacheln nicht im Stil
 * - sie schienen sonst unter der weichen Form hervor. Ohne geglättete Quelle (kein Kachelpfad im Stil) bleibt die eckige
 * Fläche der Rückfall.
 *
 * Innerhalb einer Ebene liegt vorn, wer den höchsten Rang hat (`stack_order`, WI-0178 D1: „In den Vordergrund“, „In den
 * Hintergrund“; Legacy zeichnet die vorderste zuletzt). Füllung und Kante folgen demselben Rang.
 */
export function buildLandscapeLayers(
    activeLayers: readonly string[],
    options: {
        hideLakes?: boolean | undefined;
        /** Seen UND Meere zeichnet die geglättete Quelle: in jeder Landschaftsansicht mit Kachelpfad (`smoothWaterFor`). */
        withoutWater?: boolean | undefined;
    } = {},
): LayerSpecification[] {
    const { lineWidth, lineDarken } = CARTOGRAPHY.global;
    const alone = activeLayers.length === 1;
    const filterFor = (layer: string): FilterSpecification => landscapeFilter(layer, options.withoutWater === true);
    // Klima hat eine eigene Quelle und eigene Layer; hier zaehlen nur die Landschaftsebenen.
    const layers: LayerSpecification[] = cartographyLayersInOrder()
        .filter(({ layer }) => layer !== "klima" && activeLayers.includes(layer))
        .flatMap(({ layer, style }) => [
            {
                ...landscapeFill(layer, filterFor(layer)),
                paint: {
                    "fill-color": fillForLayer(layer, (colour) => colour),
                    "fill-opacity": alone ? (style.fillOpacityAlone ?? style.fillOpacity) : style.fillOpacity,
                },
            } satisfies LayerSpecification,
            // 🪤 Kein heller Saum mehr unter der Kante (WI-0266, Betreiber 2026-10-31: „ganz weg“): Er zeichnete dieselbe Form ein zweites
            // Mal, breiter, und kostete in der Vegetation so viel wie die Kante selbst.
            {
                // Die Kante traegt die Form. Ohne sie verschwimmen zwei gleichfarbige Nachbarflaechen
                // zu einer, und genau daran haengt die Sichtpruefung an einer Kueste. Ihre Farbe ist
                // die abgedunkelte Fuellfarbe - keine zweite Liste, die auseinanderlaufen kann.
                id: `landscape-line-${layer}`,
                type: "line",
                source: LANDSCAPE_SOURCE_ID,
                "source-layer": LANDSCAPE_SOURCE_LAYER,
                filter: filterFor(layer),
                layout: { "line-sort-key": ["to-number", ["get", "stack_order"], 0] },
                paint: {
                    "line-color": fillForLayer(layer, (colour) => darkenColour(colour, lineDarken)),
                    "line-width": style.lineWidth ?? lineWidth,
                    "line-opacity": style.lineOpacity,
                    // Derographische Flächen gestrichelt (Betreiber 2026-09-28).
                    ...(style.lineDash ? { "line-dasharray": [...style.lineDash] } : {}),
                },
            } satisfies LayerSpecification,
        ]);
    // Nur in den Landschaften ist ein See eine Fläche; sonst malt ihn das Kachelbild (keine Ebene gewählt).
    if (options.hideLakes !== true && options.withoutWater !== true && activeLayers.length > 0) {
        layers.push({
            id: LAKE_FILL_LAYER_ID,
            type: "fill",
            source: LANDSCAPE_SOURCE_ID,
            "source-layer": LANDSCAPE_SOURCE_LAYER,
            filter: ["==", ["get", "region_type"], LAKE_TYPE],
            paint: { "fill-color": waterColourInPaintOrder(WATER_COLOUR), "fill-opacity": 1 },
        } satisfies LayerSpecification);
    }
    return layers;
}

export const WATER_SOURCE_ID = "gewaesser";
export const WATER_SOURCE_LAYER = "terrain_water_render";
/**
 * Das Meer als GRUND: seine Fläche liegt unter den Landschaftsfüllungen (Nachtrag zu WI-0083).
 * Siehe `buildSmoothWaterLayers`.
 */
export const WATER_SEA_FILL_LAYER_ID = "gewaesser-grund";
/** Die Fläche des SEES, über den Landschaftsfüllungen - ein See liegt im Land, kein Land liegt in ihm. */
export const WATER_FILL_LAYER_ID = "gewaesser-flaeche";
/** Die Küstenlinie des Meeres, über den Landschaftsfüllungen: Keine Fläche deckt sie zu. */
export const WATER_LINE_LAYER_ID = "gewaesser-kante";

export function buildWaterSource(tileUrl: string): SourceSpecification {
    return {
        type: "vector",
        tiles: [tileUrl],
        minzoom: 0,
        maxzoom: VECTOR_TILE_MAX_ZOOM,
        promoteId: { [WATER_SOURCE_LAYER]: "region_public_id" },
    };
}

/**
 * Seen und Meere der Topographie, geglättet (WI-0055, Betreiber 2026-09-28: „geht das glätten auch bei meeren
 * und seen?“). Legacys Gewässer sind von einem Raster abgezeichnet und zeigen im nahen Bild Treppen; die Sicht
 * `terrain_water_render` glättet sie wie die Höhenlinien, und die Linien enden genau an dieser Form.
 *
 * Deckend, auch das Meer: Unter einer Lasur schienen die Treppen des Kachelbilds und die Flächen darunter
 * durch. Seen in der Wasserfarbe wie überall (Betreiber: „generell wie flüsse behandeln“), das Meer in seiner
 * Kartenfarbe mit der Kante der Topographie. `lakes: false` ist der Schalter „Flüsse und Seen“.
 *
 * Seit 2026-10-04 steht dieselbe Quelle auch in den übrigen Landschaftsansichten, seit dem Nachtrag zu WI-0083
 * überall mit den Meeren (Betreiber 2026-10-05: „in alle normal blau“) - ein Blau und eine Form in allen fünf Ansichten.
 *
 * 🔴 **Das Meer ist der GRUND, der See liegt oben** (Nachtrag zu WI-0083, Betreiber 2026-10-05: „ja wenns geht,
 * ansonsten schneiden wir die aus“). Deckend und über allem deckte das Meer zu, was INNERHALB seines Polygons liegt:
 * die gestrichelten Kanten der drei Inselgruppen über offenem Wasser und 75 Flächen der Topographie, die ganz darin
 * liegen (1.584 E², darunter benannte Inseln) - sie waren in jeder der fünf Ansichten unsichtbar, nur ihre Namen
 * standen noch da. Deshalb zwei Gruppen statt einer Liste:
 *
 *   - `ground` - die Fläche des Meeres, UNTER den Landschaftsfüllungen (und über Klimaband und Höhenstufen).
 *     Was im Meerpolygon liegt, wird darüber gezeichnet und ist wieder zu sehen.
 *   - `above` - die Fläche des SEES und die KÜSTENLINIE, über den Landschaftsfüllungen wie bisher. Der See muss
 *     oben bleiben: Er liegt im Land, kein Land liegt in ihm. Und die Küstenlinie bleibt oben, damit die allein
 *     deckende Vegetationsfüllung sie nicht zudeckt - der Saum, der über die Küste ins Wasser reicht, bleibt
 *     sichtbar, die Küste selbst bleibt scharf.
 *
 * 🪤 Die Farbe ist ein `match` über die Art, auch wo nur eine Art im Layer steht: eine konstante, deckende Farbe
 * malte MapLibre im Opaque-Pass mit Tiefenpuffer, vor allen Flächen (`waterColourInPaintOrder`,
 * `fill-painter-order.test.ts`). Beim Grund wiegt das doppelt - er läge sonst mit seiner Tiefe VOR allem, was
 * über ihm steht, und deckte wieder zu, was er freigeben soll.
 */
export interface SmoothWaterLayers {
    /** Das Meer: unter die Landschaftsfüllungen. */
    ground: LayerSpecification[];
    /** See und Küstenlinie: über die Landschaftsfüllungen. */
    above: LayerSpecification[];
}

/** Die Deckkraft der Küstenlinie der Meere (die frühere Kante der Topographie). */
const KUESTE_DECKKRAFT = 0.5;

export function buildSmoothWaterLayers(options: SmoothWater): SmoothWaterLayers {
    const { lakes, seas } = options;
    const sea = cartographyForType(SEA_TYPE).fill;
    const { lineWidth, lineDarken } = CARTOGRAPHY.global;
    const onlySea: FilterSpecification = ["==", ["get", "region_type"], SEA_TYPE];
    const onlyLake: FilterSpecification = ["==", ["get", "region_type"], LAKE_TYPE];
    // EINE Farbtafel für beide Füllungen; jede ist ohnehin auf ihre Art gefiltert.
    const fillColour = asColourExpression(["match", ["get", "region_type"], LAKE_TYPE, WATER_COLOUR, sea]);
    const waterFill = (id: string, filter: FilterSpecification): LayerSpecification => ({
        id,
        type: "fill",
        source: WATER_SOURCE_ID,
        "source-layer": WATER_SOURCE_LAYER,
        filter,
        paint: { "fill-color": fillColour, "fill-opacity": 1 },
    });
    return {
        ground: seas ? [waterFill(WATER_SEA_FILL_LAYER_ID, onlySea)] : [],
        above: [
            ...(lakes ? [waterFill(WATER_FILL_LAYER_ID, onlyLake)] : []),
            ...(seas
                ? [
                      {
                          id: WATER_LINE_LAYER_ID,
                          type: "line",
                          source: WATER_SOURCE_ID,
                          "source-layer": WATER_SOURCE_LAYER,
                          filter: onlySea,
                          // Die feine Küste: Bis 2026-10-19 las sie die Kante der Topographie; deren kräftige Kante (OPS-000039)
                          // gilt den Flächen, nicht der Küste.
                          paint: {
                              "line-color": darkenColour(sea, lineDarken),
                              "line-width": lineWidth,
                              "line-opacity": KUESTE_DECKKRAFT,
                          },
                      } satisfies LayerSpecification,
                  ]
                : []),
        ],
    };
}

/**
 * Die Seen beim Bearbeiten eines Flusses (OPS-000116): dieselbe geglättete Fläche wie `WATER_FILL_LAYER_ID`, unter eigenem Namen. So hält
 * keine Auswahl und kein Werkzeug am Wasser sie für einen wählbaren See; sie ist nur eine Hilfe zum Zeichnen.
 */
export const EDITOR_SEEN_EBENE = "editor-seen-flaeche";

export function buildEditorSeenLayer(): LayerSpecification {
    const [see] = buildSmoothWaterLayers({ lakes: true, seas: false }).above;
    return { ...see!, id: EDITOR_SEEN_EBENE } as LayerSpecification;
}

/**
 * Die Beschriftung einer Landschaft, in einem Stück: Farbe, Versalien, Sperrung und Saum.
 *
 * 🔴 HELLER NAME AUF SCHWARZEM SAUM. Auf der ganzen Legacy-Karte steht kein dunkler Name auf hellem
 * Grund (MCS-015, an der laufenden Karte nachgemessen). Hier stand vorher ein Braun auf Creme, aus
 * der Flächentafel abgeschrieben — dieselbe Verwechslung, die die Wegnamen schon einmal hatten: die
 * Farbe der FLÄCHE ist nicht die Farbe ihres NAMENS, denn der Name steht auf dem Geländeraster.
 *
 * 🪤 Der Ton kommt je Art aus `config/map-cartography/`, die Vorgabe aus dem Designkanon. Eine Art
 * ohne eigenen Ton (`urwald`, `sonstiges` — Legacy kennt für sie keinen) fällt auf die Vorgabe
 * zurück, statt zu verschwinden.
 */
function labelColour(
    family: LabelFamilyName,
    selectedRegions?: readonly string[],
): DataDrivenPropertyValueSpecification<string> {
    const entries = Object.entries(CARTOGRAPHY.types)
        .filter(([, style]) => style.labelColor)
        .flatMap(([type, style]) => [type, style.labelColor as string]);
    // 🔴 Der LABELTYP, nicht der Regionstyp (Katalog V1, Migration 0031): Legacy setzt die Klasse
    // aus `label.labelType`. Der Regionstyp fehlt gerade bei den großen politischen Namen —
    // „Nordmarken", „Liebliches Feld" standen deshalb gemischt und in der Vorgabefarbe.
    const ruhig: unknown =
        entries.length === 0
            ? labelFamily(family).color
            : ["match", ["get", "label_type"], ...entries, labelFamily(family).color];
    if (selectedRegions === undefined || selectedRegions.length === 0) {
        return asColourExpression(ruhig);
    }
    // 🔴 DIE AUSWAHL IST EINE FARBE, KEIN ZWEITER NAME (WI-0093, Betreiber 2026-10-06 aus dem Nutzertest:
    // „was die leute stört ist, dass der text beim anklicken von regionen plötzlich eine andere schriftform
    // animmt"). Der gewählte Name ist DERSELBE Name in DERSELBEN Ebene — nur im Gold der Auswahl. Damit
    // können Schreibung, Schrift, Größe, Sperrung, Saum und der Lauf auf der Kurve gar nicht mehr
    // abweichen; es gibt nur ein Symbol. Bei einer Gruppe gleichnamiger Regionen leuchten alle (WI-0047).
    return asColourExpression([
        "case",
        ["in", ["get", "region_public_id"], ["literal", [...selectedRegions]]],
        canonColour("mapSelection"),
        ruhig,
    ]);
}

/**
 * Versalien — für genau die fünf Arten, die Legacy sie gibt: Gebirge, Insel, Inselgruppe, Region,
 * Kontinent.
 *
 * 🪤 Die feineren Regionsuntertypen (Steppe, Hügelland, Tundra, …) bekommen ausdrücklich KEINE.
 * Das steht bei Legacy als Kommentar im CSS, also als Absicht, nicht als Lücke.
 */
function labelTransform(): DataDrivenPropertyValueSpecification<"none" | "uppercase"> {
    const caps = Object.entries(CARTOGRAPHY.types)
        .filter(([, style]) => style.labelUppercase)
        .flatMap(([type]) => [type, "uppercase"]);
    if (caps.length === 0) {
        return "none";
    }
    return ["match", ["get", "label_type"], ...caps, "none"] as unknown as DataDrivenPropertyValueSpecification<
        "none" | "uppercase"
    >;
}

/** Die Schriftgröße, die eine Landschaftsbeschriftung aus ihrer Kachel mitbringt. */
const LABEL_SIZE_FROM_TILE = ["to-number", ["get", "label_size"]];

/**
 * Die FORM eines Landschaftsnamens: Größe, Versalien und Sperrung.
 *
 * 🔴 EINE Stelle für den gewöhnlichen Namen UND den Namen der Auswahl (WI-0093). Die Werte stehen nicht
 * hier, sondern an der Beschriftung selbst: `label_size` und `label_type` bringt jede aus
 * `map_label_effective` mit (Migration 0057), und beide Kachelquellen führen sie — die Punktlabels
 * (`map_label_render`) wie die Schriftläufe (`landscape_label_run_tile`, Migration 0031).
 *
 * 🪤 Die Versalien hängen an `label_type`, der Art der BESCHRIFTUNG, nicht an der Art der Region. Beide
 * stimmen meist überein, aber gerade den großen derographischen Namen fehlt die Regionsart — dieselbe
 * Verwechslung, die die FARBE schon einmal hatte („Nordmarken", „Liebliches Feld"). Wer hier den
 * Regionstyp einsetzt, bekommt „Herz des Kontinents" statt „HERZ DES KONTINENTS".
 */
export function landscapeNameLayout(): {
    "text-size": DataDrivenPropertyValueSpecification<number>;
    "text-letter-spacing": number;
    "text-transform": DataDrivenPropertyValueSpecification<"none" | "uppercase">;
} {
    return {
        "text-size": LABEL_SIZE_FROM_TILE as DataDrivenPropertyValueSpecification<number>,
        // Legacy sperrt Landschaftsnamen um 0.02 em, Ortsnamen gar nicht (MCS-015, an der laufenden
        // Karte gemessen: 2 px bei 100 px Schriftgröße).
        "text-letter-spacing": labelFamily("landscape").letterSpacing,
        "text-transform": labelTransform(),
    };
}

/**
 * Schrift und Saum einer Beschriftungsfamilie als fertige Paint- und Layout-Werte.
 *
 * ⭐ Eine Stelle für vier Layer. Der Saum ist ein ANTEIL der Schriftgröße (Legacy rechnet ihn aus
 * ihr), also wächst er mit — ein fester Pixelwert wäre bei z2 ein Kasten und bei z8 ein Haarstrich.
 */
function labelPaint(family: LabelFamilyName, colour: DataDrivenPropertyValueSpecification<string>) {
    return {
        "text-color": colour,
        "text-halo-color": labelFamily(family).haloColor,
        "text-halo-width": haloExpression(
            family,
            LABEL_SIZE_FROM_TILE,
            "width",
        ) as DataDrivenPropertyValueSpecification<number>,
        "text-halo-blur": haloExpression(
            family,
            LABEL_SIZE_FROM_TILE,
            "blur",
        ) as DataDrivenPropertyValueSpecification<number>,
    };
}

/**
 * Schrift und Saum eines Landschaftsnamens, in beliebiger Farbe (WI-0093). Dieselbe Stelle wie oben: Der
 * Saum ist ein ANTEIL der Schriftgröße aus der Kachel, also trägt ein gewählter Name genau den Saum, den
 * er ungewählt auch trägt.
 */
export function landscapeNamePaint(colour: DataDrivenPropertyValueSpecification<string>): {
    "text-color": DataDrivenPropertyValueSpecification<string>;
    "text-halo-color": string;
    "text-halo-width": DataDrivenPropertyValueSpecification<number>;
    "text-halo-blur": DataDrivenPropertyValueSpecification<number>;
} {
    return labelPaint("landscape", colour);
}

export const LANDSCAPE_RUN_SOURCE_ID = "landscape-runs";
export const LANDSCAPE_RUN_SOURCE_LAYER = "landscape_label_run";

/**
 * Darunter passt kein Landschaftsname auf die Karte (WI-0283 H4, `min(run_min_zoom)` der Daten): Die Karte fragt die leeren Kacheln gar nicht erst
 * an. 🪤 Bekäme ein Name einmal einen Lauf auf Stufe 1, fehlte er nur dort; `landscape_label_run_render` sagt, ob die Zahl noch stimmt.
 */
export const LANDSCAPE_RUN_MIN_ZOOM = 2;

export function buildLandscapeRunSource(tileUrl: string): SourceSpecification {
    return { type: "vector", tiles: [tileUrl], minzoom: LANDSCAPE_RUN_MIN_ZOOM, maxzoom: VECTOR_TILE_MAX_ZOOM };
}

/**
 * Der Landschaftsname auf seinem Schriftlauf (WI-0004, ADR-0007).
 *
 * ⭐ `line-center` und nicht `line`: `line` tastet die Linie ab und verwirft jeden Anker ausserhalb
 * der Kachelgrenzen, `line-center` nimmt die Mitte ohne diese Pruefung. Auf dem echten Stack
 * gemessen - mit `line` verschwanden Namen an jeder Kachelgrenze.
 *
 * Die Zahl der Namensinstanzen steht nicht hier, sondern in den Daten: die Kachelfunktion liefert
 * je Zoomstufe genau den Satz, dessen Band sie enthaelt (`run_min_zoom`/`run_max_zoom`). Ein Filter
 * auf `["zoom"]` waere hier nicht nur ueberfluessig, sondern falsch - die Baender sind je Region
 * verschieden, und ein Layer hat nur ein Zoomfenster.
 *
 * 🔧 Farbe und Halo sind vorlaeufig, wie bei den Flaechen: Legacys Darstellungstafel ist noch nicht
 * uebernommen.
 */
/**
 * Der Ebenenfilter, den FLÄCHE und NAME gemeinsam benutzen müssen.
 *
 * 💣 Genau hier liefen sie auseinander: der Kartenfächer schaltete die Flächen um, die
 * Landschaftsnamen blieben alle stehen. „Herz des Kontinents" ist eine derographische Region und
 * stand trotzdem über der Vegetationsansicht (Betreiberbefund an der Stage-Abnahme, 2026-09-22).
 *
 * 🪤 Eine LEERE Liste heißt „keine Namen", nicht „alle Namen". Das ist der Klimafall: dort gibt es
 * keine Labels, und ein Filter, der bei leerer Liste durchlässt, ließe ersatzweise fremde Namen
 * stehen.
 */
/**
 * Die Zoombänder der Landschaftsnamen je Art (WI-0221, Reiter „Zoombänder“): nur die verstellten Arten, als Grenze ZUSÄTZLICH zum
 * Band der Kachel. Enger wirkt sofort; weiter als die Vorgabe zeigt erst etwas, wenn die Namensläufe neu gerechnet sind (das sagt
 * der Reiter). Trägt eine Beschriftung ihre eigene Spanne aus dem Editor (`own_span`, Migration 0206), ersetzt diese die der Art (F2;
 * Befund WI-0221 §8.1); eine Kachel ohne die Spalte (vor 0192) begrenzt wie bisher mit der Art.
 */
function artSpannen(): unknown[] {
    const filter = spannenFilter(abweichendeSpannen("landschaften", "name"), "region_type");
    return filter === true ? [] : [["any", ["==", ["get", "own_span"], true], filter]];
}

function layerFilter(layers: readonly string[]): unknown[] {
    if (layers.length === 0) {
        return ["==", ["literal", true], ["literal", false]];
    }
    return ["in", ["get", "region_layer"], ["literal", [...layers]]];
}

export const LANDSCAPE_RUN_LAYER_ID = "landscape-label-run";

export function buildLandscapeRunLayer(
    font: string,
    layers: readonly string[],
    selectedRegions?: readonly string[],
): LayerSpecification {
    return {
        id: LANDSCAPE_RUN_LAYER_ID,
        type: "symbol",
        source: LANDSCAPE_RUN_SOURCE_ID,
        "source-layer": LANDSCAPE_RUN_SOURCE_LAYER,
        // Dieselbe Ebenenauswahl wie die Flächen (WI-0009).
        //
        // 🔴 Die gewählte Region wird hier NICHT mehr herausgefiltert (WI-0093). Bis dahin wich ihr Name
        // dem Namen der Auswahl - und ein Gebirgsname verlor damit seine Kurve und stand als gerade Zeile
        // woanders (Raschtulswall, Betreiber 2026-10-06: „das betrifft insbesondere auch
        // kurvenbeschriftungen"). Er bleibt stehen und wechselt nur die Farbe (`labelColour`).
        filter: (artSpannen().length === 0
            ? layerFilter(layers)
            : ["all", layerFilter(layers), ...artSpannen()]) as FilterSpecification,
        layout: {
            "symbol-placement": "line-center",
            "text-field": ["get", "name"],
            "text-font": [font],
            // 🪤 Kein `text-max-angle` unter dem Vorgabewert. Die Beruhigung ist Eigenschaft der
            // abgeleiteten Kurve (I4) und wird dort geprueft; sie hier ein zweites Mal zu
            // erzwingen, kostete bei einer Verletzung den NAMEN statt der Kurve - genau das, was
            // I7 verbietet.
            "text-allow-overlap": false,
            // 💣 Nicht optional: ein Landschaftsname weicht keinem Ortsnamen. Die Rangfolge
            // entsteht aus der Layerreihenfolge - dieser Layer steht vor `place-label`, also
            // weicht der Ortsname (MCS-008, Betreiberbestaetigung).
            "text-optional": false,
            ...landscapeNameLayout(),
            // 💣 Hier stand der ROHE `label_priority` - und damit genau verkehrt herum. Legacy
            // sortiert absteigend (`right.priority - left.priority`), MapLibre platziert den
            // niedrigeren Wert zuerst: Prioritaet 1 gewann alles, Prioritaet 4 verlor. Die
            // Kachel liefert den Rang jetzt fertig und gespiegelt (Migration 0017); bei gleicher
            // Prioritaet entscheidet die Erscheinungsstufe, was den Fall Albernia loest (MCS-010).
            //
            // ⭐ AUSWEICHEN (Migration 0110, Betreiber 2026-10-11): die Kachel liefert je Einzellauf bis zu fünf sich
            // überdeckende Kandidaten, `candidate` 0 ist die Mitte. Innerhalb desselben Rangs wird die Mitte zuerst versucht,
            // dann ⅛ und ¼ vor und zurück; der Aufschlag bleibt unter einem ganzen Rang (0,01 je Kandidat), wie bei den
            // Wegnamen (`path-layers.ts`).
            "symbol-sort-key": [
                "+",
                collisionSortKey(),
                ["*", ["to-number", ["coalesce", ["get", "candidate"], 0]], 0.01],
            ] as unknown as DataDrivenPropertyValueSpecification<number>,
        },
        paint: labelPaint("landscape", labelColour("landscape", selectedRegions)),
    } satisfies LayerSpecification;
}

export const MAP_LABEL_SOURCE_ID = "map-labels";
export const MAP_LABEL_SOURCE_LAYER = "map_label_render";

export function buildMapLabelSource(tileUrl: string): SourceSpecification {
    return { type: "vector", tiles: [tileUrl], minzoom: 0, maxzoom: VECTOR_TILE_MAX_ZOOM };
}

/**
 * Der Landschaftsname als gewoehnliches Punktlabel (WI-0004, I7).
 *
 * 💣 Das ist die Haelfte, ohne die Invariante I7 nur auf dem Papier steht: "ein Fehler der
 * Kurvenableitung kostet die Kurve, niemals den Namen". Ohne diesen Layer haette ein Name ohne
 * Kurve gar keinen Layer - und waere damit auch ohne Fehler unsichtbar. Gemessen: 954 der 1047
 * aktiven Labels stehen hier, nur 93 auf einer Kurve.
 *
 * 🪤 Keine Drehung. Legacy zwingt die Drehung eines Labels mit Regionsbezug auf 0 und zeichnet sie
 * nicht mehr; der gespeicherte Wert ist nur noch der Rueckweg eines Feature-Rueckbaus (MCS-008).
 */
export const MAP_LABEL_LAYER_ID = "map-label";

/** Die Art einer Landschaft in der Sprache der Seite; eine unbekannte Art hat keinen Namen. */
export function landscapeTypeName(type: string): string {
    const key = `landscape.type.${type}`;
    return type !== "" && isMessageKey(key) ? t(key) : "";
}

/** Die Ebenen, deren Namen eine Art-Zeile bekommen können (WI-0135, Betreiber: „nur bei vegetation und topographie“). */
export const TYPE_LINE_LAYERS = ["vegetation", "topographie"] as const satisfies readonly LandscapeLayer[];

/** Kann ein Name dieser Ebene eine Art-Zeile tragen? */
export function isTypeLineLayer(layer: string): boolean {
    return (TYPE_LINE_LAYERS as readonly string[]).includes(layer);
}

/**
 * Der Name samt Art als zweiter, kleiner Zeile (WI-0135). Betreiber 2026-10-11: „bei 2 flächen, die gleich heißen, in einer 2.
 * zeile "steppe" oder "tiefebene" (klein, zentriert) unter dem name“. Ob es eine zweite gleichnamige Fläche gibt, sagt die
 * Kachel (`name_twin`, Migration 0109); die Art kommt aus den Sprachtafeln, Größe als Anteil aus dem Kanon
 * (`typeLineScale`), Farbe und Saum wie der Name. Ohne Zwilling oder ohne bekannte Art steht der Name allein.
 *
 * 🪤 Ein `match`, das je Art den GANZEN formatierten Text liefert, nicht eine leere zweite Zeile: Ein `"\n"` mit leerem Rest
 * hebt den Namen um eine halbe Zeile an.
 */
export function nameWithTypeLine(nameExpression: unknown = ["get", "name"]): unknown {
    const scale = labelFamily("landscape").typeLineScale ?? 1;
    const arten = Object.keys(CARTOGRAPHY.types).flatMap((type) => {
        const name = landscapeTypeName(type);
        return name === "" ? [] : [type, ["format", nameExpression, {}, "\n", {}, name, { "font-scale": scale }]];
    });
    return [
        "case",
        ["!=", ["get", "name_twin"], true],
        nameExpression,
        ["match", ["get", "region_type"], ...arten, nameExpression],
    ];
}

export function buildMapLabelLayer(
    font: string,
    layers: readonly string[],
    selectedRegions?: readonly string[],
    { typeLine = false }: { typeLine?: boolean } = {},
): LayerSpecification {
    return {
        id: MAP_LABEL_LAYER_ID,
        type: "symbol",
        source: MAP_LABEL_SOURCE_ID,
        "source-layer": MAP_LABEL_SOURCE_LAYER,
        // Wer eine Kurve hat, steht auf ihr - sonst stuende sein Name zweimal auf der Karte.
        //
        // 🪤 Das Erscheinungsband MUSS hier gefiltert werden. Bei den Schriftlaeufen erledigt das
        // die Kachelfunktion ueber `run_min_zoom`/`run_max_zoom`; ein Punktlabel hat keine solche
        // Funktion. Ohne den Filter standen alle 954 Namen auf JEDER Stufe gleichzeitig, und die
        // Kollision loeschte fast alle - darunter Albernia, die Referenz fuer genau diesen Fall.
        //
        // 🔴 Die gewählte Region steht hier weiter (WI-0093): Sie wechselt die Farbe, nicht den Platz.
        filter: [
            "all",
            ["!=", ["get", "has_curve_run"], true],
            // 🔴 Das Band ist eine FACHLICHE Zoomstufe (Legacys), der Filter prüft den
            // MapLibre-Zoom. Ohne den Versatz wird jedes Band eine Stufe zu früh wirksam — bei
            // Gareth liess das 99 Gebietsnamen zu, wo Legacy 51 zulaesst (WI-0015, MCS-016).
            // Ränder wie die Zoomanzeige (WI-0129 §17d): Stufe 0 hält bis zum kleinsten Zoom, oben endet die Stufe an ihrem Ende.
            zoomFromBand(["to-number", ["get", "label_min_zoom"]]),
            zoomUntilBand(["to-number", ["get", "label_max_zoom"]]),
            // Dieselbe Ebenenauswahl wie die Flächen (WI-0009).
            layerFilter(layers),
            ...artSpannen(),
        ] as unknown as FilterSpecification,
        layout: {
            "text-field": (typeLine
                ? nameWithTypeLine()
                : ["get", "name"]) as DataDrivenPropertyValueSpecification<string>,
            "text-font": [font],
            // 🔴 Dieselbe Regel wie bei den Ortsnamen: Legacy zeichnet jeden Kartennamen in EINER
            // Zeile (`white-space: nowrap`, und sein Canvas kennt keinen Umbruch).
            "text-max-width": NO_WRAP,
            "text-allow-overlap": false,
            "text-optional": false,
            ...landscapeNameLayout(),
            // Dieselbe Kette wie beim Schriftlauf, aus derselben Quelle (Migration 0017).
            "symbol-sort-key": collisionSortKey() as DataDrivenPropertyValueSpecification<number>,
        },
        paint: labelPaint("landscape", labelColour("landscape", selectedRegions)),
    } satisfies LayerSpecification;
}

/**
 * Die Ebenen der Landschaftsnamen nach Rang, die gewinnende zuerst (WI-0135). Betreiber 2026-10-11, zu „Aventurien“, das auf
 * Stufe 1 dem Kurvennamen „Raschtulswall“ wich: „in standard und bei "alle" in den landschaften immer derographie >
 * topographie > vegetation gewinnen“.
 */
export const LANDSCAPE_NAME_LAYER_RANK = ["derographisch", "topographie", "vegetation"] as const;

/** Die Punktnamen einer Ebene. */
export function mapLabelLayerId(ebene: string): string {
    return `${MAP_LABEL_LAYER_ID}-${ebene}`;
}

/** Die Kurvennamen einer Ebene. */
export function landscapeRunLayerId(ebene: string): string {
    return `${LANDSCAPE_RUN_LAYER_ID}-${ebene}`;
}

/** Alle Ebenen der Landschaftsnamen, die ein Stil tragen kann, in der Reihenfolge, in der MapLibre sie setzt. */
export const LANDSCAPE_NAME_LAYER_IDS: readonly string[] = LANDSCAPE_NAME_LAYER_RANK.flatMap((ebene) => [
    landscapeRunLayerId(ebene),
    mapLabelLayerId(ebene),
]);

/**
 * Die Landschaftsnamen der gezeigten Ebenen, je Ebene Kurven- und Punktnamen in einer eigenen Symbolebene.
 *
 * 🔴 MapLibre setzt von OBEN nach unten, und über zwei Ebenen hinweg entscheidet nur ihre Lage im Stapel. Vorher standen
 * alle Kurvennamen in einer Ebene über allen Punktnamen; damit gewann jeder Kurvenname, auch ein topographischer gegen den
 * Kontinent. Jetzt: Derographie vor Topographie vor Vegetation, und INNERHALB einer Ebene weiter die Kurve vor dem Punkt
 * (MCS-008). Das Feld ist von unten nach oben geschrieben.
 */
export function buildLandscapeNameLayers(
    font: string,
    layers: readonly string[],
    selectedRegions?: readonly string[],
    { typeLine = false }: { typeLine?: boolean } = {},
): LayerSpecification[] {
    const rang = (ebene: string): number => {
        const index = (LANDSCAPE_NAME_LAYER_RANK as readonly string[]).indexOf(ebene);
        return index < 0 ? LANDSCAPE_NAME_LAYER_RANK.length : index;
    };
    // Die schwächste Ebene zuerst (unten); eine Ebene ohne Rang ganz unten.
    const reihenfolge = [...layers].sort((a, b) => rang(b) - rang(a));
    return reihenfolge.flatMap((ebene) => [
        // Die Art-Zeile nur an den Punktnamen der Vegetation und Topographie (WI-0135); die Kurvennamen bleiben einzeilig.
        {
            ...buildMapLabelLayer(font, [ebene], selectedRegions, {
                typeLine: typeLine && isTypeLineLayer(ebene),
            }),
            id: mapLabelLayerId(ebene),
        },
        { ...buildLandscapeRunLayer(font, [ebene], selectedRegions), id: landscapeRunLayerId(ebene) },
    ]);
}

export const CLIMATE_SOURCE_ID = "climate";
export const CLIMATE_SOURCE_LAYER = "climate_band_render";
/** Die Fläche der Klimabänder: Ein Klick in der Klimaansicht wählt das Band darunter (`interaction/owners.ts`). */
export const CLIMATE_FILL_LAYER_ID = "climate-fill";

export function buildClimateSource(tileUrl: string): SourceSpecification {
    return { type: "vector", tiles: [tileUrl], minzoom: 0, maxzoom: VECTOR_TILE_MAX_ZOOM };
}

/**
 * Die Klimabaender (WI-0005).
 *
 * 🔴 Was hier gezeichnet wird, ist ABGELEITET: das Band ist der Raum zwischen zwei Trennlinien, und
 * die Linien sind die Wahrheit. Die Kachelquelle liefert deshalb `climate_band_render`, nie eine
 * redaktionelle Relation.
 *
 * Legacy legt die Klimabaender in ein eigenes Pane mit z-Index 253 - also UNTER die uebrigen
 * Landschaftsebenen (Topographie 254 aufwaerts). Die Reihenfolge ist Migrationsgegenstand, keine
 * Gestaltungsfrage (MCS-007).
 *
 * Die Farben stehen in `config/map-cartography/aventuria.json`: ein Verlauf von kalt nach warm,
 * damit die Nord-Sued-Folge ohne Legende lesbar ist.
 */
const CLIMATE_COLOURS: Record<string, string> = CARTOGRAPHY.climateZones;

/**
 * Die Farbe eines Klimabands, wahlweise abgedunkelt fuer die Kante.
 *
 * Ein Band traegt seinen `type_key`, also kann dieselbe `match`-Liste beide Layer bedienen - die
 * Kante ist die abgedunkelte Fuellfarbe, genau wie bei den Landschaften. Keine zweite Farbliste.
 */
function climateColour(transform: (colour: string) => string): DataDrivenPropertyValueSpecification<string> {
    return asColourExpression([
        "match",
        ["get", "type_key"],
        ...Object.entries(CLIMATE_COLOURS).flatMap(([key, colour]) => [key, transform(colour)]),
        transform(cartographyForType(undefined).fill),
    ]);
}

/**
 * Die Deckkraft der Bänder: `fillOpacity` der Kartografietafel (0,5), die gewählte Zone deckend (Betreiber 2026-10-05,
 * wörtlich: „kannst du klimazonen weniger transparent und deutlich gefüllt machen? also 50% normal, 100% bei einem klick“).
 * Gewählt ist sie über die eine Auswahl (`highlightedClimateZone` aus `selectedSubject`: Klick auf das Band, Suche,
 * Objektlink), bis eine andere Auswahl kommt. Bänder gibt es nur in ihrer eigenen Ebene, in „Alle“ nicht (Betreiber
 * 2026-10-05: „Wenn ich auf "Alle" klick, sollen keine klimazonen mehr angezeigt werden“); eine zweite, blassere Deckkraft
 * für „Alle“ gibt es deshalb nicht mehr.
 *
 * 🪤 Die Deckkraft der Auswahl ist kein Ton einer Domäne, sondern ein Auswahlzustand: Sie steht im Designkanon
 * (`mapSelection.bandOpacity`), die der übrigen Bänder in der Kartografietafel.
 */
function climateFillOpacity(highlighted: string | undefined): DataDrivenPropertyValueSpecification<number> {
    const normal = CARTOGRAPHY.layers["klima"]?.fillOpacity ?? 0.18;
    if (highlighted === undefined) {
        return normal;
    }
    return ["case", ["==", ["get", "type_key"], highlighted], DESIGN_CANON.mapSelection.bandOpacity, normal];
}

/** @param highlighted die gewählte Zone, die deckend steht */
export function buildClimateLayers(highlighted?: string): LayerSpecification[] {
    return [
        {
            id: CLIMATE_FILL_LAYER_ID,
            type: "fill",
            source: CLIMATE_SOURCE_ID,
            "source-layer": CLIMATE_SOURCE_LAYER,
            paint: {
                "fill-color": climateColour((colour) => colour),
                "fill-opacity": climateFillOpacity(highlighted),
            },
        } satisfies LayerSpecification,
        {
            id: "climate-line",
            type: "line",
            source: CLIMATE_SOURCE_ID,
            "source-layer": CLIMATE_SOURCE_LAYER,
            paint: {
                // Die Trennlinie ist die abgedunkelte Bandfarbe ihres Sued-Nachbarn - dieselbe Regel
                // wie bei den Landschaftskanten, damit es keine zweite Farbliste gibt.
                "line-color": climateColour((colour) => darkenColour(colour, CARTOGRAPHY.global.lineDarken)),
                "line-width": 0.8,
                "line-opacity": CARTOGRAPHY.layers["klima"]?.lineOpacity ?? 0.45,
            },
        } satisfies LayerSpecification,
    ];
}

export const CLIMATE_LABEL_SOURCE_ID = "climate-labels";
export const CLIMATE_LABEL_LAYER_ID = "climate-label";

/**
 * Ein Flächenname auf der Karte (Klimazone, Sprache): wo er steht, sein Schlüssel und sein Name; eine Sprache trägt dazu die Farben
 * ihres Namens. Die Punkte rechnet `area-labels.ts` aus dem, was im Bild ist.
 */
export interface AreaLabelPoint {
    type: "Feature";
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: { type_key: string; name: string } & Readonly<Record<string, string>>;
}

export interface AreaLabelPoints {
    type: "FeatureCollection";
    features: AreaLabelPoint[];
}

export type ClimateLabelPoint = AreaLabelPoint;
export type ClimateLabelPoints = AreaLabelPoints;

export const NO_AREA_LABELS: AreaLabelPoints = { type: "FeatureCollection", features: [] };
export const NO_CLIMATE_LABELS: ClimateLabelPoints = NO_AREA_LABELS;

/**
 * Die Quelle der Flächennamen: GeoJSON, das die Seite nachführt, keine Kachelquelle (für die Klimazonen lieferten Migration
 * 0021/0034 die Punkte an den Kartenrändern; die Sicht `climate_label_render` liest seit 2026-10-05 niemand mehr).
 */
export function buildAreaLabelSource(points: AreaLabelPoints = NO_AREA_LABELS): SourceSpecification {
    return { type: "geojson", data: points };
}

export function buildClimateLabelSource(points: ClimateLabelPoints = NO_CLIMATE_LABELS): SourceSpecification {
    return buildAreaLabelSource(points);
}

/**
 * Die Schriftgröße der Zonennamen — eine feste Zahl, weil die Größentafel für Klimanamen keine
 * Zeile führt. Sie steht im Designkanon (`mapLabel.families.climate.size`, am Telefon `sizePhone`; seit 2026-10-05
 * 22 und 16 px in Versalien, vorher 14 px), und Saum, Schmal-Regel und Breite beziehen sich auf denselben Wert statt auf
 * eine zweite Abschrift. Das Gerät fragt EINE Stelle (`isPhoneViewport`), wie beim Band der Herrschaftsgebiete.
 */
export function climateLabelSize(phone: boolean = isPhoneViewport()): number {
    const family = labelFamily("climate");
    const size = phone ? (family.sizePhone ?? family.size) : family.size;
    if (size === undefined) {
        throw new Error("Designkanon: mapLabel.families.climate.size fehlt (die Schriftgröße der Zonennamen)");
    }
    return size;
}

/** MapLibres Zeilenhöhe (`text-line-height`, Vorgabe 1,2 em): so hoch ist ein einzeiliger Name ohne Saum. */
const LINE_HEIGHT_EM = 1.2;

/**
 * So viel Höhe braucht ein Zonenname im Bild, in Bildpunkten: eine Zeile samt Saum oben und unten. Wo sein Band an der
 * Stelle des Namens niedriger ist, steht keiner (Legacys Regel an den Rändern, WI-0012: „dann lieber kein Name als einer,
 * der in die Nachbarzone ragt und sie mitbeschriftet“). Sie wächst mit der Schrift.
 */
export function climateLabelRoom(size: number = climateLabelSize()): number {
    return size * (LINE_HEIGHT_EM + 2 * labelFamily("climate").haloWidthRatio);
}

/** So breit steht ein Zonenname im Bild (Bildpunkte), wie MapLibre ihn setzt: in Versalien, gesperrt, samt Saum links und rechts. */
export function climateLabelWidth(name: string, size: number = climateLabelSize()): number {
    const family = labelFamily("climate");
    const text = measureTextWidth(FACULTY_GLYPHIC_METRICS, family.uppercase ? name.toUpperCase() : name, {
        size,
        letterSpacing: family.letterSpacing,
    });
    return text + 2 * size * family.haloWidthRatio;
}

/**
 * Die Schrift eines Zonennamens: Farbton und Buntheit der Zone in der Helligkeit des Kanons (`toneLightness`, dunkel).
 * Eine Regel für jede Zone, auch für eine neunte (Betreiber 2026-10-05: „einem dunkleren ton der klimazone“). Dieselbe Regel
 * gilt für die Namen der Sprachen (WI-0261 E5): `zone` ist die Farbe der Fläche.
 */
export function climateNameColour(zone: string): string {
    const family = labelFamily("climate");
    return family.toneLightness === undefined ? family.color : withOklchLightness(zone, family.toneLightness);
}

/**
 * Sein Saum: derselbe Farbton, hell (`haloToneLightness`) und blass (Buntheit höchstens `haloToneChroma`), damit er nur
 * trennt und nicht als Kontur auffällt (Betreiber 2026-10-05: „die kontur weniger krass stark machen“).
 */
export function climateHaloColour(zone: string): string {
    const family = labelFamily("climate");
    if (family.haloToneLightness === undefined) return family.haloColor;
    const { c, h } = oklchOf(zone);
    return oklchToHex({ l: family.haloToneLightness, c: Math.min(c, family.haloToneChroma ?? c), h });
}

/** Legacys `white-space: nowrap`, in MapLibres Sprache: eine Hoechstbreite, die kein Name erreicht. */
const NO_WRAP = 1000;

/**
 * Die Namen der Klimazonen (WI-0012).
 *
 * 🔴 Jeder Name steht mittig in dem Teil seiner Zone, der gerade im Bild ist, und wandert beim Verschieben und Zoomen mit
 * (Betreiber 2026-10-05, wörtlich: „ob du die zonennamen statt links mittig anzeigen könntest - immer da wo die zone ist“).
 * Vorher standen sie wie in Legacy an beiden Kartenrändern (Migration 0021, 0034); die Abweichung von Legacy ist gewollt
 * und in WI-0012 vermerkt. Die Punkte rechnet `area-labels.ts`, je Bild der Kamera.
 *
 * 🪤 Dieser Layer existiert, weil eine Klimazone ihren Namen NICHT über `map_label` trägt: er ist
 * der Regionsname der Fläche. Wer ihn über den Landschafts-Labellayer suchen wollte, fände nichts
 * — genau der Fehlschluss, der mich am 2026-09-22 „Klimazonen haben keine Labels" schreiben liess.
 *
 * 💣 Die Kollision entscheidet `text-overlap: "never"` wie bei jedem Kartennamen: Kollidiert der Name mit einem, der zuerst
 * steht, fällt er aus; ist sein Band an der Stelle zu schmal, setzt `area-labels.ts` gar keinen. `text-optional` ist
 * NICHT gesetzt: ein Bandname, der wegfällt, lässt ein farbiges Band ohne Aussage zurück.
 *
 * 💣 Weil der Name mit der Kamera wandert, steht `text-allow-overlap: true` daneben: Ein Punkt, der nach `setData` weiter
 * springt, als MapLibre ihn wiedererkennt (`CrossTileSymbolIndex`, je nach Zoom 2 bis 32 Bildpunkte, oder über eine
 * Kachelgrenze), ist für MapLibre ein neuer Name. Mit `text-allow-overlap: false` bliebe er bis zur nächsten Platzierung
 * unsichtbar (bis 300 ms) - der Name flackerte bei jedem Zug. Mit `true` steht ein neuer Name sofort
 * (`updateBucketOpacities` liest dafür `text-allow-overlap`), über die Kollision entscheidet weiter `text-overlap`, das
 * Vorrang hat (`getOverlapMode`). Die Ebene liegt oben im Stapel und weicht fast nie. Klimazonen gibt es nur in ihrer
 * eigenen Ebene (Betreiber 2026-10-05); den Fall „weichen müssen und wandern“ aus „Alle“ gibt es nicht mehr.
 *
 * Gebaut wird die Ebene von `buildAreaNameLayer` (dieselbe für die Namen der Sprachen, WI-0261 E5).
 *
 * Der Sortierschlüssel ist derselbe wie an jedem Beschriftungslayer (`label-collision.test.ts`). Die Punkte tragen keinen
 * Rang und stehen damit alle hinten an, untereinander gleich: Alle Zonennamen hatten denselben
 * (`label_collision_rank(NULL, NULL, NULL)` in der alten Sicht), und zwei Zonen teilen sich nie eine Stelle.
 */
export function buildClimateLabelLayer(font: string): LayerSpecification {
    return buildAreaNameLayer({
        id: CLIMATE_LABEL_LAYER_ID,
        source: CLIMATE_LABEL_SOURCE_ID,
        font,
        // ⭐ DER NAME TRÄGT DEN TON SEINES BANDES, keinen eigenen. Legacy hatte dafür bis zum
        // 2026-08-05 ein eigenes Farbtoken und hat es abgeschafft: „je Zone steht der Ton schon
        // oben, ein zweiter wäre die Kopie, die beim Einschieben einer neunten Zone zurückfiele."
        //
        // 🔴 Der Ton kommt aus der Zone, die Helligkeit nicht. Seit 2026-10-05 die eine Ausnahme der Kartenschrift: DUNKEL
        // im Ton der Zone auf einem schmalen, hellen Saum im blassen Ton der Zone (Betreiber: „die kontur weniger krass stark
        // machen und die font-color einem dunkleren ton der klimazone geben“; Kanon `mapLabel.families.climate`, Guide §20).
        textColour: climateColour((colour) => climateNameColour(colour)),
        haloColour: climateColour((colour) => climateHaloColour(colour)),
    });
}

/**
 * Die Ebene eines Flächennamens, der mittig im sichtbaren Teil seiner Fläche steht und mit der Kamera wandert: Klimazonen und
 * Sprachen (WI-0261 E5). Größe, Versalien, Laufweite und Saum aus dem Kanon (`mapLabel.families.climate`); die Farben sagt der
 * Aufrufer (die Klimazonen aus ihrer Tafel, die Sprachen aus dem Punkt, `area-labels.ts`). Begründung der Regeln an
 * `buildClimateLabelLayer` oben.
 */
export function buildAreaNameLayer(spec: {
    id: string;
    source: string;
    font: string;
    textColour: DataDrivenPropertyValueSpecification<string>;
    haloColour: DataDrivenPropertyValueSpecification<string>;
}): LayerSpecification {
    const size = climateLabelSize();
    return {
        id: spec.id,
        type: "symbol",
        source: spec.source,
        layout: {
            "text-field": ["get", "name"],
            "text-font": [spec.font],
            // Im Designkanon (`climateLabelSize`): 22 px, am Telefon 16 px.
            "text-size": size,
            "text-max-width": NO_WRAP,
            // Siehe oben: `text-overlap` entscheidet die Kollision, `text-allow-overlap` lässt einen gewanderten Namen stehen.
            "text-overlap": "never",
            "text-allow-overlap": true,
            "text-optional": false,
            // 🪤 Kein Polster um den Namen (Vorgabe 2 px): In der Übersicht stehen „Subtropische Wüstenzone“ und „Tropische Zone“ 26,7 px übereinander, ihre Zeilen messen 26,4 px, und nur das Polster
            // nahm einer Zone ihren Namen (Volltest 2026-11-01, `climate-labels.spec.ts`). Die Schrift berührt sich dort nicht.
            "text-padding": 0,
            // In Versalien mit der Laufweite des Kanons für Versalien (Betreiber 2026-10-05: „mach alles in großbuchstaben“).
            "text-transform": labelFamily("climate").uppercase ? "uppercase" : "none",
            "text-letter-spacing": labelFamily("climate").letterSpacing,
            "symbol-sort-key": collisionSortKey() as DataDrivenPropertyValueSpecification<number>,
        },
        paint: {
            "text-color": spec.textColour,
            "text-halo-color": spec.haloColour,
            "text-halo-width": size * labelFamily("climate").haloWidthRatio,
            "text-halo-blur": size * labelFamily("climate").haloBlurRatio,
        },
    };
}
