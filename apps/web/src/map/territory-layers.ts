import type {
    DataDrivenPropertyValueSpecification,
    FilterSpecification,
    LayerSpecification,
    SourceSpecification,
} from "maplibre-gl";
import {
    AVENTURIA_POLITICAL_CARTOGRAPHY,
    borderNameValueForBand,
    canonColour,
    politicalMinZoom,
    rgbaColour,
    TERRITORY_BORDER_SOURCE_LAYER,
    TERRITORY_CLAIM_SOURCE_LAYER,
    TERRITORY_FILL_SOURCE_LAYER,
    TERRITORY_LABEL_SOURCE_LAYER,
    VECTOR_TILE_MAX_ZOOM,
} from "@avesmaps3d/shared";
import { startansicht } from "./start-view";
import { inViewBand, IS_VIEW_BAND, territoryBandLead, VIEW_BAND, viewBandAtLeast } from "./territory-band";
import { labelFontPx, stepOverBands, territoryCoatLayout, type TerritoryLabelLook } from "./territory-coat-label";

/**
 * Die Herrschaftsgebiete auf der Karte (WI-0062, ADR-0014): Fläche in der Farbe des Gebiets, Name in der Fläche,
 * Außen- und Innengrenzen.
 *
 * 🔴 Alles hier ist ANZEIGE. Welches Gebiet ein Band zeigt, entscheidet die Ableitung; welches Band die Karte zeigt, der
 * Kamerazoom (`territory-band.ts`): Die Kacheln tragen ALLE Bänder mit ihrer Bandnummer, jede Ebene filtert auf das eine
 * Band der Ansicht (globaler Zustand), nie auf den Zoom der Kachel und nie mit `minzoom`/`maxzoom` (beides rechnet MapLibre
 * mit dem Kachelzoom und zerschnitt die geneigte Ansicht, Betreiber 2026-09-30). Farbe einer Fläche ist ein Datum des
 * Gebiets (F4: Legacys Farbe je Gebiet), Deckkraft, Linien und Name stehen in `config/map-cartography/aventuria-political.json`.
 *
 * 🪤 Zwei Quellen, weil zwei Kachelfunktionen: `territories` (Füllung und Namen) gibt es nur in der politischen Ansicht
 * (und für die Auswahl), `territory-borders` (Linien) auch über Standard und Landschaften.
 */

export const TERRITORY_SOURCE_ID = "territories";
export const TERRITORY_BORDER_SOURCE_ID = "territory-borders";
export const TERRITORY_FILL_LAYER_ID = "territory-fill";
export const TERRITORY_LABEL_LAYER_ID = "territory-label";
export const TERRITORY_CLAIM_LAYER_ID = "territory-claim-hatch";
export const TERRITORY_OUTER_ROOT_LAYER_ID = "territory-border-outer-root";
export const TERRITORY_OUTER_LAYER_ID = "territory-border-outer";
export const TERRITORY_CASING_ROOT_LAYER_ID = "territory-border-casing-root";
export const TERRITORY_CASING_LAYER_ID = "territory-border-casing";
export const TERRITORY_INNER_LAYER_PREFIX = "territory-border-inner-";
export const TERRITORY_BORDER_NAME_LAYER_ID = "territory-border-name";
export const TERRITORY_SOURCE_LAYER = TERRITORY_FILL_SOURCE_LAYER;
export { TERRITORY_CLAIM_SOURCE_LAYER };

const POLITICAL = AVENTURIA_POLITICAL_CARTOGRAPHY;

/** Die Stärke der Grenzen: kräftig in der politischen Ansicht, schwach (Legacys schwacher Modus) darüber. */
export type TerritoryBorderStrength = "strong" | "weak";

export function buildTerritorySource(tileUrl: string): SourceSpecification {
    return {
        type: "vector",
        tiles: [tileUrl],
        minzoom: 0,
        maxzoom: VECTOR_TILE_MAX_ZOOM,
        promoteId: { [TERRITORY_SOURCE_LAYER]: "territory_public_id" },
    };
}

export function buildTerritoryBorderSource(tileUrl: string): SourceSpecification {
    return { type: "vector", tiles: [tileUrl], minzoom: 0, maxzoom: VECTOR_TILE_MAX_ZOOM };
}

function asNumber(expression: unknown): DataDrivenPropertyValueSpecification<number> {
    return expression as DataDrivenPropertyValueSpecification<number>;
}

/**
 * Ein Wert je Band als Stufenausdruck über dem Kamerazoom: Band b gilt ab `politicalMinZoom(b)` (Legacy z + 1, um den
 * Vorzug des Geräts früher, `territoryBandLead`: am Rechner und am Telefon verschieden; ein Wechsel über die Telefongrenze
 * baut den Stil neu, siehe `app.vue`). Das ist ein Paint-Ausdruck: MapLibre wertet ihn mit dem Zoom der Kamera aus, je Bild, nicht mit
 * dem der Kachel. Liegen alle Werte gleich, bleibt es eine Zahl - ein Stufenausdruck ohne Stufen wäre Rauschen im Stil.
 */
export function stepByBand(values: readonly number[]): DataDrivenPropertyValueSpecification<number> {
    const [first = 0, ...rest] = values;
    if (rest.every((value) => value === first)) return first;
    const stops: unknown[] = [];
    rest.forEach((value, index) => stops.push(politicalMinZoom(index + 1, territoryBandLead()), value));
    return asNumber(["step", ["zoom"], first, ...stops]);
}

/** Die Deckkraft der Gebietsflächen: die Transparenz aus den Standardwerten (Kanal OPS-000082), für alle Gebiete gleich. */
const gebieteDeckkraft = (): number => (100 - startansicht().gebieteTransparenz) / 100;

/**
 * Die Füllung: die Farbe des Gebiets mit der einheitlichen Deckkraft der Standardwerte, von unten nach oben nach `sort_order` (Legacy:
 * Reihenfolge des Gebiets).
 *
 * 🔴 Ein ganz umstrittenes Gebiet (`hatched`) bleibt als Fläche stehen, damit ein Klick es trifft und die Auswahl es
 * umreißt, wird aber nicht gefüllt: Legacy schneidet es aus der Füllung heraus, die Schraffur liegt über dem Kartenbild. Wo
 * es nur zum Teil umstritten ist, fehlt der Teil schon in der Geometrie der Kachel.
 */
export function buildTerritoryFillLayer(): LayerSpecification {
    return {
        id: TERRITORY_FILL_LAYER_ID,
        type: "fill",
        source: TERRITORY_SOURCE_ID,
        "source-layer": TERRITORY_FILL_SOURCE_LAYER,
        filter: inViewBand(),
        layout: { "fill-sort-key": asNumber(["get", "sort_order"]) },
        paint: {
            "fill-color": ["get", "color"] as unknown as DataDrivenPropertyValueSpecification<string>,
            "fill-opacity": asNumber(["case", ["==", ["get", "hatched"], true], 0, gebieteDeckkraft()]),
        },
    };
}

/**
 * Die Schraffur umstrittener Gebiete (Legacy `map-features-contested-hatch-overlay.js`): diagonale Streifen in den Farben der
 * Parteien über dem Kartenbild, mit der Deckkraft der Füllung. Das Muster heißt `claim-<Band>-<Farben>` und entsteht beim
 * ersten Bedarf (`claim-hatch-images.ts`); die Breite der Streifen folgt dem Band (Legacy: je Zoomstufe).
 *
 * Sie liegt über der Füllung und unter Wegen und Grenzen (Legacys Pane 300 zwischen Füllung 200 und Grenzen 350).
 */
export function buildTerritoryClaimLayer(): LayerSpecification {
    return {
        id: TERRITORY_CLAIM_LAYER_ID,
        type: "fill",
        source: TERRITORY_SOURCE_ID,
        "source-layer": TERRITORY_CLAIM_SOURCE_LAYER,
        filter: IS_VIEW_BAND as unknown as FilterSpecification,
        paint: {
            "fill-pattern": ["get", "pattern"] as unknown as never,
            "fill-opacity": gebieteDeckkraft(),
        },
    };
}

/**
 * Der Name in der Fläche (F5 A): dunkel, heller Saum, mehrzeilig und zentriert. Bei Kollision gewinnt die größere Fläche
 * (`symbol-sort-key`: Legacy sortiert große Gebiete zuerst).
 *
 * 🔴 Schrift und Saum folgen dem Band der Ansicht (WI-0121, Legacy `createRegionLabelMarkup`: in den dichten Bändern 0 bis 2
 * kleiner, 0,75 / 0,83 / 0,91); das gilt für jeden Namen, mit Wappen oder ohne. Wie groß der Name steht und wie breit sein
 * Saum ist, steht in der Tafel (`label.sizePx`, `label.haloWidthRatio`, `label.haloBlurRatio`).
 *
 * 🔴 `selected` ist die Kennung des gewählten Gebiets (WI-0121 Nachtrag, Betreiber 2026-10-09: „einfach nur text, der schon da
 * steht, gelb werden soll und nicht erst neu erzeugt, aus und wieder eingeblendet, und irgendwo platziert wird“; dasselbe Muster
 * wie WI-0093 bei den Landschaftsnamen). Der Name des gewählten Gebiets BLEIBT in dieser Ebene stehen - samt Wappen, mit
 * demselben Umbruch, an derselben Stelle - und wechselt allein die Farbe: Schrift in der Auswahlfarbe des Kanons, der Saum dunkel,
 * damit das helle Gelb auf jeder Fläche trägt (`label.selected`). Es gibt nur EIN Symbol; Lage, Zeilenzahl, Größe und Kollision
 * können beim Klick gar nicht abweichen, denn keine dieser Eigenschaften nennt die Auswahl.
 *
 * `withCoats`: Es gibt eine Liste der Wappen (`territory-coat-label.ts`). Dann trägt jedes Gebiet darin sein Wappen über dem
 * Namen, EIN Symbol aus Bild und Text, das gemeinsam gesetzt oder gemeinsam verworfen wird - und kollidiert, größere Fläche
 * zuerst. Ohne Liste (die Antwort fehlt oder ist leer) steht nur der Name, wie er stand.
 *
 * `look` ist die Tafel des Namens; nur das Abnahmeblatt und die Tests geben eine andere.
 */
export function buildTerritoryLabelLayer(
    font: string,
    selected?: string,
    withCoats: boolean = false,
    look: TerritoryLabelLook = POLITICAL.label,
): LayerSpecification {
    // Der Ausdruck für ein Gebiet der Auswahl; ohne Auswahl bleibt der ruhige Wert, ohne Umweg über `case`.
    const chosen = (whenSelected: unknown, calm: unknown): unknown =>
        selected === undefined ? calm : ["case", ["==", ["get", "territory_public_id"], selected], whenSelected, calm];
    // Breite und Unschärfe des Saums sind Anteile der Schrift, die im Band kleiner steht.
    const halo = (key: "haloWidthRatio" | "haloBlurRatio"): unknown =>
        chosen(
            stepOverBands((band) => labelFontPx(band, look) * look.selected[key]),
            stepOverBands((band) => labelFontPx(band, look) * look[key]),
        );
    return {
        id: TERRITORY_LABEL_LAYER_ID,
        type: "symbol",
        source: TERRITORY_SOURCE_ID,
        "source-layer": TERRITORY_LABEL_SOURCE_LAYER,
        filter: inViewBand(),
        layout: {
            "text-field": ["get", "name"],
            "text-font": [font],
            "text-size": stepOverBands((band) =>
                labelFontPx(band, look),
            ) as DataDrivenPropertyValueSpecification<number>,
            "text-max-width": look.maxWidthEm,
            "text-line-height": look.lineHeightEm,
            "text-justify": "center",
            "text-anchor": "center",
            "text-allow-overlap": false,
            "symbol-sort-key": asNumber(["*", -1, ["get", "area"]]),
            ...(withCoats ? territoryCoatLayout(look) : {}),
        } as never,
        paint: {
            "text-color": chosen(canonColour("mapSelection"), look.color),
            "text-halo-color": chosen(look.selected.haloColor, look.haloColor),
            "text-halo-width": halo("haloWidthRatio"),
            "text-halo-blur": halo("haloBlurRatio"),
            // Was gewählt ist, wird nie animiert (Design Guide §29.1): Die Farbe steht mit dem Klick, sie blendet nicht über.
            "text-color-transition": { duration: 0, delay: 0 },
            "text-halo-color-transition": { duration: 0, delay: 0 },
        } as never,
    };
}

/**
 * Die Grenzlinien (F3 B, „außen/innen wie Legacy“). Von unten nach oben: die Innengrenzen (weiß, gestrichelt, in drei
 * Bandgruppen, denn `line-dasharray` rechnet in Vielfachen der Breite und kennt keinen Stufenausdruck über dem Zoom),
 * darunter der feine dunkle Saum, darüber die Außengrenzen (hellgrau, durchgezogen; im kräftigen Modus die eines
 * eigenständigen Reiches dicker).
 *
 * `weak` ist Legacys schwacher Modus über Standard und Landschaften: dieselben Linien, nach Band eingeblendet, die
 * Außengrenze mit EIGENEN Breiten (`weak.outerWidthPx`) und ohne dickere Reiche - eine einzige Schicht für alle Hüllen.
 *
 * 🔴 Kein `minzoom`/`maxzoom`: Die Bandgruppe der Innengrenzen ist ein Filter auf das Band der Ansicht. Eine Ebene mit
 * `minzoom` baut in Kacheln unter diesem Zoom keine Geometrie - in der geneigten Ansicht endeten die Grenzen mitten im Bild.
 */
export function buildTerritoryBorderLayers(strength: TerritoryBorderStrength): LayerSpecification[] {
    const layers: LayerSpecification[] = [];
    const weak = strength === "weak";
    for (const group of POLITICAL.inner.groups) {
        const opacity = weak ? stepByBand(POLITICAL.weak.innerAlpha) : POLITICAL.inner.alpha;
        layers.push({
            id: `${TERRITORY_INNER_LAYER_PREFIX}${String(group.fromBand)}`,
            type: "line",
            source: TERRITORY_BORDER_SOURCE_ID,
            "source-layer": TERRITORY_BORDER_SOURCE_LAYER,
            filter: inViewBand(
                ["==", ["get", "kind"], "inner"],
                [">=", VIEW_BAND, group.fromBand],
                ["<=", VIEW_BAND, group.toBand],
            ),
            layout: { "line-join": "round" },
            paint: {
                "line-color": POLITICAL.inner.color,
                "line-width": group.widthPx,
                "line-opacity": opacity,
                // MapLibre rechnet die Strichlänge in Vielfachen der Linienbreite.
                "line-dasharray": [group.dashPx[0] / group.widthPx, group.dashPx[1] / group.widthPx],
            },
        });
    }
    // Die Außengrenzen: im kräftigen Modus zwei Gruppen (Reiche dicker), im schwachen eine für alle Hüllen.
    const outerKinds: { casing: string; line: string; filter: unknown[]; widths: readonly number[] }[] = weak
        ? [
              {
                  casing: TERRITORY_CASING_LAYER_ID,
                  line: TERRITORY_OUTER_LAYER_ID,
                  filter: [["==", ["get", "kind"], "outer"]],
                  widths: POLITICAL.weak.outerWidthPx,
              },
          ]
        : [
              {
                  casing: TERRITORY_CASING_LAYER_ID,
                  line: TERRITORY_OUTER_LAYER_ID,
                  filter: [
                      ["==", ["get", "kind"], "outer"],
                      [">", ["get", "level"], 0],
                  ],
                  widths: POLITICAL.outer.otherWidthPx,
              },
              {
                  casing: TERRITORY_CASING_ROOT_LAYER_ID,
                  line: TERRITORY_OUTER_ROOT_LAYER_ID,
                  filter: [
                      ["==", ["get", "kind"], "outer"],
                      ["==", ["get", "level"], 0],
                  ],
                  widths: POLITICAL.outer.rootWidthPx,
              },
          ];
    // Legacy clippt auf das Innere der Hülle und zeichnet doppelt breit: sichtbar ist die innere Hälfte. Der Ableiter
    // richtet jede Hülle rechtsläufig aus (innen liegt rechts), `line-offset` positiv heißt rechts: die halbe Breite nach
    // innen, und die Linie füllt genau den Streifen an der Innenseite der Grenze.
    const offsetOf = (widths: readonly number[]): Record<string, unknown> =>
        POLITICAL.outer.placement === "inside" ? { "line-offset": stepByBand(widths.map((width) => width / 2)) } : {};
    const casing = POLITICAL.outer.casing;
    if (casing.widthPx > 0) {
        // Der Saum liegt unter ALLEN hellen Linien (auch der Nachbarhülle): Er zeigt sich nur als Rand daneben.
        for (const kind of outerKinds) {
            layers.push({
                id: kind.casing,
                type: "line",
                source: TERRITORY_BORDER_SOURCE_ID,
                "source-layer": TERRITORY_BORDER_SOURCE_LAYER,
                filter: inViewBand(...kind.filter),
                layout: { "line-join": "round" },
                paint: {
                    "line-color": casing.color,
                    "line-width": stepByBand(kind.widths.map((width) => width + 2 * casing.widthPx)),
                    ...offsetOf(kind.widths),
                    "line-opacity": weak
                        ? stepByBand(POLITICAL.weak.outerAlpha.map((alpha) => alpha * casing.alpha))
                        : casing.alpha,
                } as never,
            });
        }
    }
    const outerOpacity = weak ? stepByBand(POLITICAL.weak.outerAlpha) : 1;
    for (const kind of outerKinds) {
        layers.push({
            id: kind.line,
            type: "line",
            source: TERRITORY_BORDER_SOURCE_ID,
            "source-layer": TERRITORY_BORDER_SOURCE_LAYER,
            filter: inViewBand(...kind.filter),
            layout: { "line-join": "round" },
            paint: {
                "line-color": POLITICAL.outer.color,
                "line-width": stepByBand(kind.widths),
                ...offsetOf(kind.widths),
                "line-opacity": outerOpacity,
            } as never,
        });
    }
    return layers;
}

/**
 * Ein Wert je Band ab `borderName.fromBand` als Stufenausdruck über dem BAND der Ansicht (globaler Zustand): Legacy springt
 * von Stufe zu Stufe (Leaflet kennt nur ganze Zoomstufen), konstant darunter und darüber.
 *
 * 🔴 Für Layout-Eigenschaften, die MapLibre beim Aufbau der Kachel auswertet (`text-offset`, `text-letter-spacing`): Ein
 * Ausdruck über `["zoom"]` bekäme dort den Zoom der KACHEL, in der geneigten Ansicht je Kachel ein anderer Wert.
 */
function borderNameByBand(bands: number, valueOf: (band: number) => unknown): unknown {
    const { fromBand } = POLITICAL.borderName;
    if (bands === 1) return valueOf(fromBand);
    const stops: unknown[] = [];
    for (let index = 1; index < bands; index += 1) stops.push(fromBand + index, valueOf(fromBand + index));
    return ["step", VIEW_BAND, valueOf(fromBand), ...stops];
}

/**
 * Die Schriftgröße entlang der Grenze: gleitend zwischen den Stufen über dem KAMERAZOOM (je Bild ausgewertet), konstant
 * darüber und darunter. Legacy springt.
 */
function borderNameSize(bands: number, valueOf: (band: number) => number): unknown {
    const { fromBand } = POLITICAL.borderName;
    if (bands === 1) return valueOf(fromBand);
    const stops: unknown[] = [];
    for (let index = 0; index < bands; index += 1) {
        stops.push(politicalMinZoom(fromBand + index, territoryBandLead()), valueOf(fromBand + index));
    }
    return ["interpolate", ["linear"], ["zoom"], ...stops];
}

/**
 * Der Name ENTLANG der Außengrenze (Nachtrag WI-0062, Legacy `drawTerritoryBorderLabels`): weiß, leicht durchsichtig,
 * ohne Saum, Versalien mit Sperrung, auf der Innenseite der Grenze, lesbar von links nach rechts.
 *
 * 🔴 Wo er steht, entscheidet die Tafel (`borderName.views`) und der Schalter „Grenzen“: Legacy setzt ihn nur in der
 * Standardansicht (in „Politisch“ stehen die Namen schon in der Fläche). Ab Band `fromBand` (Legacy z4) - als Filter auf das
 * Band der Ansicht, nicht als `minzoom`: Mit `minzoom` gäbe es in fernen Kacheln der geneigten Ansicht keine Namen.
 *
 * 🪤 Die Linie ist der Pfad `name` aus der Ableitung (der Umriss des größten Teils der Hülle, rechtsläufig), nicht die
 * gezeichnete Außengrenze: Hüllen mit ausgenommenem Namen (`Baronie …`) und Löcher haben keinen. Die Rechtsläufigkeit
 * trägt den Abstand: `text-offset` positiv heißt rechts der Laufrichtung, also nach innen. Der Abstand ist in
 * Schriftgrößen gerechnet (em) und folgt dem Band.
 *
 * Kollision: Legacy zeichnet die Grenznamen auf eine eigene Fläche UNTER allen Beschriftungen und ohne Kollision mit
 * ihnen (Ortsnamen liegen darüber, die Fläche liegt in Legacys Pane 350, Beschriftungen in 475). Das ist hier der
 * Stapelplatz: die Ebene liegt am UNTEREN Ende des Symbolstapels und wird von jedem anderen Namen überdeckt, ohne einen
 * zu verdrängen (`text-allow-overlap`). Mit Kollision blieben in der dicht beschrifteten Standardkarte null bis zwei
 * Namen je Bild übrig, gemessen an acht Stellen und vier Zoomstufen; Legacy setzt einen je Gebiet.
 * Untereinander verwirft Legacy überlappende Namen (große Gebiete zuerst): Das leistet die Ableitung, indem sie dem Kind
 * die Stücke seiner Grenze nimmt, die mit der des Vorfahren zusammenfallen (dort steht dessen Name auf derselben Seite).
 */
export function buildTerritoryBorderNameLayer(font: string): LayerSpecification {
    const names = POLITICAL.borderName;
    const size = (band: number): number => borderNameValueForBand(names.sizePx, names.fromBand, band);
    const offset = (band: number): number => borderNameValueForBand(names.offsetPx, names.fromBand, band);
    const bands = Math.max(names.sizePx.length, names.offsetPx.length);
    return {
        id: TERRITORY_BORDER_NAME_LAYER_ID,
        type: "symbol",
        source: TERRITORY_BORDER_SOURCE_ID,
        "source-layer": TERRITORY_BORDER_SOURCE_LAYER,
        filter: inViewBand(["==", ["get", "kind"], "name"], viewBandAtLeast(names.fromBand)),
        layout: {
            "symbol-placement": "line",
            "symbol-spacing": names.repeatPx,
            "text-field": ["get", "label_name"],
            ...(names.uppercase ? { "text-transform": "uppercase" as const } : {}),
            "text-font": [font],
            "text-size": borderNameSize(bands, size) as DataDrivenPropertyValueSpecification<number>,
            // Legacys 3 px Sperrung sind ein fester Pixelwert; MapLibre rechnet in Schriftgrößen.
            "text-letter-spacing": borderNameByBand(
                bands,
                (band) => names.letterSpacingPx / size(band),
            ) as DataDrivenPropertyValueSpecification<number>,
            "text-offset": borderNameByBand(bands, (band) => ["literal", [0, offset(band) / size(band)]]) as never,
            "text-allow-overlap": true,
        },
        paint: {
            "text-color": rgbaColour(names.color, names.alpha),
        },
    };
}
