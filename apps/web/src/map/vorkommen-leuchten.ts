import type {
    DataDrivenPropertyValueSpecification,
    ExpressionSpecification,
    FilterSpecification,
    GeoJSONSourceSpecification,
    LayerSpecification,
    StyleSpecification,
} from "maplibre-gl";
import { DESIGN_CANON, TERRITORY_TILE_SOURCE, territoryTileTemplate } from "@avesmaps3d/shared";
import {
    buildAreaLabelSource,
    buildAreaNameLayer,
    climateHaloColour,
    climateLabelSize,
    climateNameColour,
    LANDSCAPE_SOURCE_ID,
    LANDSCAPE_SOURCE_LAYER,
} from "./landscape-layers";
import { kennungsFilter, renderKoordinaten, renderPunkt, SCHEIN_BIS_GEGENDEN, setzeLeuchten } from "./leuchten-formen";
import type { SuchLeuchtenTeil, SuchLeuchtenUmfeld } from "./such-leuchten";
import { inViewBand } from "./territory-band";
import { buildTerritorySource, TERRITORY_SOURCE_ID, TERRITORY_SOURCE_LAYER } from "./territory-layers";
import { zeichenBildName } from "./vorkommen-zeichen-bild";

/**
 * Das Leuchten der gewählten Vorkommen (WI-0257 S5, Vali 2026-10-30: „die jeweiligen regionen mit den icons für ausgewählte vorkommen sollten sich farblich
 * unterscheiden … UND auf der karten beschriftet werden mit den dynamsichen labels“). Wie das Gold der Suche (`such-leuchten.ts`) - Füllung, weicher
 * Schein, klare Kontur, Orte als Ring -, nur je Vorkommen in seiner Farbe (`SuchLeuchtenTeil.farbe`, Kanon `mapVorkommen<n>`). Darüber stehen die Namen
 * (`vorkommen-namen.ts`).
 *
 * - **Ganze Gegenden** über den Kachelfilter auf Kennungen, die Farbe als `match` je Kennung. **Angeschnittene Stücke, Reste und Orte** in einer eigenen
 *   GeoJSON-Quelle, Farbe und Breite stehen am Merkmal.
 * - 🔴 **Überlappende Gegenden zweier Vorkommen bleiben beide sichtbar:** Die Füllungen liegen übereinander (beide durchscheinend). Trägt mehr als ein
 *   Vorkommen dieselbe Gegend, liegt jede Kontur eine Stufe unter der nächsten und ist um eine Konturbreite breiter (`konturBreite`): Unter der Kontur des
 *   zuletzt gewählten bleibt die des früheren als Saum zu beiden Seiten stehen. Ein Versatz (`line-offset`) ginge auch, schöbe aber die Schnittkanten an den
 *   Kachelgrenzen ins Bild (Kanon `$mapSelectionComment`: der Kachelpuffer reicht 8 px). Ganze Gegenden zeichnen deshalb je STUFE eine Ebene (die erste,
 *   zweite … Trägerin derselben Kennung), nicht je Vorkommen: Es sind so viele Ebenen, wie Vorkommen sich höchstens eine Gegend teilen, meist eine.
 * - Ein genannter Ort, den mehrere nennen, trägt je Vorkommen einen Ring, einen um den anderen.
 * - Ein Vorkommen, das nur Orte nennt (keine Gegend), trägt seinen Namen unter dem Ring statt in einer Fläche.
 */

export const VORKOMMEN_QUELLE = "vorkommen-leuchten";
export const VORKOMMEN_NAMEN_QUELLE = "vorkommen-namen";
export const VORKOMMEN_NAMEN_EBENE = "vorkommen-namen";
const ORT_NAMEN_EBENE = "vorkommen-ort-namen";

const look = DESIGN_CANON.mapSelection;

/**
 * Die Deckkraft des Scheins in der Farbe des Vorkommens. Das Gold der Suche hat dafür eine eigene, hellere Farbe (`mapSelectionGlow`); eine zweite Tafel
 * mit sechzehn Scheinfarben wäre die Kopie. Der Schein ist deshalb die Farbe selbst, halb durchscheinend: Er hebt die Kontur vom Gelände ab, ohne die
 * Nachbarfarbe zu übertönen.
 */
const SCHEIN_DECKKRAFT = 0.5;

/**
 * Der Abstand, den MapLibre um jeden Namen freihält (`text-padding`, seine Vorgabe ausdrücklich gesetzt): `vorkommen-namen.ts` rechnet ihn beim Ausweichen in
 * der Breite mit.
 */
export const NAMEN_ABSTAND = 2;

/**
 * Wie hoch MapLibres Kollisionsrahmen eines Namens mit Zeichen steht, in Schriftgrößen: gemessen 35 px bei 22 px Schrift (`showCollisionBoxes`, 2026-10-30),
 * samt `NAMEN_ABSTAND`. Die Rechnung der Klimanamen (`climateLabelRoom`, 29 px) setzte zwei Namen so dicht übereinander, dass MapLibre den zweiten verwarf.
 */
export const NAMEN_HOEHE_EM = 1.6;

/** Die Breite der Kontur auf Stufe `stufe` von `traeger` Trägerinnen derselben Kennung: oben die Breite des Kanons, jede darunter eine Konturbreite mehr, höchstens die des Scheins. */
export function konturBreite(stufe: number, traeger: number): number {
    return Math.min(look.glowWidth, look.lineWidth * (traeger - stufe));
}

/** Der Radius des Rings an einem Ort auf Stufe `stufe` von `traeger`: der innerste wie im Gold (11 px), jeder darunter liegt außen herum. */
export function ringRadius(stufe: number, traeger: number): number {
    return 11 + 5 * (traeger - 1 - stufe);
}

/** Je Kennung (Gegend `r:`, Gebiet `g:`, Ort `o:`) die Vorkommen, die sie tragen, als Index in `teile` in der Reihenfolge der Wahl. */
export function traegerVon(teile: readonly SuchLeuchtenTeil[]): Map<string, number[]> {
    const traeger = new Map<string, number[]>();
    const trage = (schluessel: string, index: number): void => {
        const liste = traeger.get(schluessel) ?? [];
        if (!liste.includes(index)) liste.push(index);
        traeger.set(schluessel, liste);
    };
    teile.forEach((teil, index) => {
        const l = teil.leuchten;
        for (const id of l.ganz) trage(`r:${id}`, index);
        for (const stueck of l.angeschnitten) trage(`r:${stueck.publicId}`, index);
        if (l.nurKontinent && l.kontinent !== undefined) trage(`r:${l.kontinent.publicId}`, index);
        for (const id of l.gebiete.ganz) trage(`g:${id}`, index);
        for (const stueck of l.gebiete.angeschnitten) trage(`g:${stueck.publicId}`, index);
        for (const ort of l.orte) trage(`o:${ort.id}`, index);
    });
    return traeger;
}

/** Stufe und Zahl der Trägerinnen eines Vorkommens an einer Kennung. */
function stufeVon(
    traeger: ReadonlyMap<string, readonly number[]>,
    schluessel: string,
    index: number,
): [number, number] {
    const liste = traeger.get(schluessel) ?? [index];
    return [Math.max(0, liste.indexOf(index)), liste.length];
}

/** Hat das Vorkommen eine Fläche, die einen Namen tragen kann (eine Gegend, ein Gebiet, ein Rest oder den Kontinent)? */
export function hatFlaeche(teil: SuchLeuchtenTeil): boolean {
    const l = teil.leuchten;
    return (
        l.ganz.length > 0 ||
        l.angeschnitten.length > 0 ||
        l.rest !== undefined ||
        l.gebiete.ganz.length > 0 ||
        l.gebiete.angeschnitten.length > 0 ||
        (l.nurKontinent && l.kontinent !== undefined)
    );
}

/** Die Farben eines Namens: Schrift und Saum nach der Regel der Klima- und Sprachnamen, dazu das Bild des Zeichens. */
export function namensFarben(
    teil: SuchLeuchtenTeil,
    schrift: number,
): { schrift: string; saum: string; zeichen: string } {
    return {
        schrift: climateNameColour(teil.farbe),
        saum: climateHaloColour(teil.farbe),
        zeichen: zeichenBildName(teil.kind, teil.farbe, schrift),
    };
}

type Merkmal = {
    type: "Feature";
    properties: Record<string, string | number>;
    geometry: { type: string; coordinates: unknown };
};

/**
 * Die GeoJSON-Merkmale aller Vorkommen: Stücke und Reste als `flaeche`, angeschnittene Gebiete als `gebiet`, Orte als `ort`. Jedes trägt `v` (der Schlüssel
 * seines Vorkommens, für die Namen), `farbe`, `breite` und `stufe` (die Kontur), ein Ort seinen `radius`. Einmal je Auswahl und Schriftgröße gerechnet: Der
 * Stil entsteht oft neu, die Auswahl bleibt.
 */
const MERKMALE = new WeakMap<readonly SuchLeuchtenTeil[], { schrift: number; merkmale: Merkmal[] }>();
export function vorkommenMerkmale(teile: readonly SuchLeuchtenTeil[], schrift: number = climateLabelSize()): Merkmal[] {
    const gemerkt = MERKMALE.get(teile);
    if (gemerkt !== undefined && gemerkt.schrift === schrift) return gemerkt.merkmale;
    const merkmale = rechneMerkmale(teile, schrift);
    MERKMALE.set(teile, { schrift, merkmale });
    return merkmale;
}

function rechneMerkmale(teile: readonly SuchLeuchtenTeil[], schrift: number): Merkmal[] {
    const traeger = traegerVon(teile);
    const merkmale: Merkmal[] = [];
    teile.forEach((teil, index) => {
        const l = teil.leuchten;
        const form = (
            t: string,
            schluessel: string | undefined,
            gestalt: { type: string; coordinates: unknown[] },
        ): void => {
            const [stufe, zahl] = schluessel === undefined ? [0, 1] : stufeVon(traeger, schluessel, index);
            merkmale.push({
                type: "Feature",
                properties: { t, v: teil.id, farbe: teil.farbe, breite: konturBreite(stufe, zahl), stufe },
                geometry: { type: gestalt.type, coordinates: renderKoordinaten(gestalt.coordinates) },
            });
        };
        for (const stueck of l.angeschnitten) form("flaeche", `r:${stueck.publicId}`, stueck.form);
        if (l.rest !== undefined) form("flaeche", undefined, l.rest.form);
        for (const stueck of l.gebiete.angeschnitten) form("gebiet", `g:${stueck.publicId}`, stueck.form);
        // Nennt das Vorkommen nur Orte, steht sein Name unter dem ersten (`ORT_NAMEN_EBENE`); sonst steht er in der Fläche.
        const nameAmOrt = !hatFlaeche(teil);
        l.orte.forEach((ort, stelle) => {
            const [stufe, zahl] = stufeVon(traeger, `o:${ort.id}`, index);
            merkmale.push({
                type: "Feature",
                properties: {
                    t: "ort",
                    v: teil.id,
                    farbe: teil.farbe,
                    radius: ringRadius(stufe, zahl),
                    stufe,
                    ...(nameAmOrt && stelle === 0 ? { name: teil.name, ...namensFarben(teil, schrift) } : {}),
                },
                geometry: { type: "Point", coordinates: renderPunkt([ort.x, ort.y]) },
            });
        });
    });
    return merkmale;
}

/** Ein Wert je Kennung als `match`, die Kennungen nach Wert gebündelt; bei nur einem Wert der Wert selbst. */
function jeKennung<T extends string | number>(
    eigenschaft: string,
    eintraege: ReadonlyMap<string, T>,
): DataDrivenPropertyValueSpecification<T> {
    const buendel = new Map<T, string[]>();
    for (const [id, wert] of eintraege) buendel.set(wert, [...(buendel.get(wert) ?? []), id]);
    const werte = [...buendel.keys()];
    if (werte.length === 1) return werte[0] as T;
    return [
        "match",
        ["get", eigenschaft],
        ...[...buendel].flatMap(([wert, ids]) => [ids, wert]),
        werte[0] as T,
    ] as unknown as DataDrivenPropertyValueSpecification<T>;
}

/** Je Stufe die Kennungen einer Kachelquelle mit Farbe und Konturbreite. */
type Stufen = Map<string, { farbe: string; breite: number }>[];

function stufenVon(
    teile: readonly SuchLeuchtenTeil[],
    traeger: ReadonlyMap<string, readonly number[]>,
    vorsilbe: "r:" | "g:",
    ids: (teil: SuchLeuchtenTeil) => readonly string[],
): Stufen {
    const stufen: Stufen = [];
    teile.forEach((teil, index) => {
        for (const id of ids(teil)) {
            const [stufe, zahl] = stufeVon(traeger, `${vorsilbe}${id}`, index);
            const ebene = (stufen[stufe] ??= new Map());
            if (!ebene.has(id)) ebene.set(id, { farbe: teil.farbe, breite: konturBreite(stufe, zahl) });
        }
    });
    return stufen;
}

/**
 * Füllung (wo verlangt), Schein und Kontur einer Kachelquelle, je Stufe; Scheine und Konturen getrennt, damit keine Kontur unter einem fremden Schein liegt.
 * Leuchten sehr viele Kennungen (`SCHEIN_BIS_GEGENDEN`, über alle Stufen gezählt), entfällt der Schein (WI-0266).
 */
function kachelEbenen(
    kennung: string,
    herkunft: { source: string; "source-layer": string },
    eigenschaft: string,
    stufen: Stufen,
    filter: (ids: readonly string[]) => FilterSpecification,
    fuellung: boolean,
): { fuellungen: LayerSpecification[]; scheine: LayerSpecification[]; konturen: LayerSpecification[] } {
    const fuellungen: LayerSpecification[] = [];
    const scheine: LayerSpecification[] = [];
    const konturen: LayerSpecification[] = [];
    const schein = stufen.reduce((zahl, ebene) => zahl + (ebene?.size ?? 0), 0) < SCHEIN_BIS_GEGENDEN;
    stufen.forEach((ebene, stufe) => {
        if (ebene === undefined || ebene.size === 0) return;
        const ids = [...ebene.keys()];
        const farbe = jeKennung(eigenschaft, new Map([...ebene].map(([id, e]) => [id, e.farbe])));
        const breite = jeKennung(eigenschaft, new Map([...ebene].map(([id, e]) => [id, e.breite])));
        const quelle = { ...herkunft, filter: filter(ids) };
        if (fuellung) {
            fuellungen.push({
                id: `${kennung}-${String(stufe)}-fuellung`,
                type: "fill",
                ...quelle,
                paint: { "fill-color": farbe, "fill-opacity": look.fillOpacity },
            });
        }
        if (schein)
            scheine.push({
                id: `${kennung}-${String(stufe)}-schein`,
                type: "line",
                ...quelle,
                layout: { "line-join": "round", "line-cap": "round" },
                paint: {
                    "line-color": farbe,
                    "line-width": look.glowWidth,
                    "line-blur": look.glowBlur,
                    "line-opacity": SCHEIN_DECKKRAFT,
                },
            });
        konturen.push({
            id: `${kennung}-${String(stufe)}-linie`,
            type: "line",
            ...quelle,
            layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-color": farbe, "line-width": breite },
        });
    });
    return { fuellungen, scheine, konturen };
}

const nurT = (...arten: string[]): FilterSpecification =>
    (arten.length === 1
        ? ["==", ["get", "t"], arten[0]]
        : ["in", ["get", "t"], ["literal", arten]]) as unknown as FilterSpecification;

const FARBE: ExpressionSpecification = ["get", "farbe"];

/** Die Namensebene der Vorkommen: wie die Klima- und Sprachnamen (`buildAreaNameLayer`), vorn das Zeichen als Bild im Text. */
function namenEbene(id: string, source: string, font: string, filter?: FilterSpecification): LayerSpecification {
    const ebene = buildAreaNameLayer({
        id,
        source,
        font,
        textColour: ["get", "schrift"],
        haloColour: ["get", "saum"],
    });
    if (ebene.type !== "symbol") return ebene;
    return {
        ...ebene,
        ...(filter === undefined ? {} : { filter }),
        layout: {
            ...ebene.layout,
            "text-field": [
                "format",
                ["image", ["get", "zeichen"]],
                { "vertical-align": "center" },
                " ",
                {},
                ["get", "name"],
                {},
            ] as unknown as ExpressionSpecification,
            "text-padding": NAMEN_ABSTAND,
        },
    };
}

/** Die Ebenen des Leuchtens aller gewählten Vorkommen, von unten nach oben (ohne die Namen in den Flächen). */
export function buildVorkommenLeuchtenLayers(
    teile: readonly SuchLeuchtenTeil[],
    mitGebietsKacheln: boolean,
    mitMerkmalen: boolean,
    font: string,
): LayerSpecification[] {
    const traeger = traegerVon(teile);
    const landschaft = { source: LANDSCAPE_SOURCE_ID, "source-layer": LANDSCAPE_SOURCE_LAYER };
    const ganz = kachelEbenen(
        "vorkommen-ganz",
        landschaft,
        "region_public_id",
        stufenVon(teile, traeger, "r:", (teil) => teil.leuchten.ganz),
        (ids) => kennungsFilter("region_public_id", ids),
        true,
    );
    // Wo nur „Aventurien“ übrig bleibt: der Kontinent als Umriss ohne Füllung (wie im Gold, WI-0257 F1).
    const kontinent = kachelEbenen(
        "vorkommen-kontinent",
        landschaft,
        "region_public_id",
        stufenVon(teile, traeger, "r:", (teil) =>
            teil.leuchten.nurKontinent && teil.leuchten.kontinent !== undefined
                ? [teil.leuchten.kontinent.publicId]
                : [],
        ),
        (ids) => kennungsFilter("region_public_id", ids),
        false,
    );
    // Ein ganzes Herrschaftsgebiet leuchtet als Umriss (die politische Füllung bleibt); die Kachel trägt alle Bänder, es gilt das der Ansicht.
    const gebiete = mitGebietsKacheln
        ? kachelEbenen(
              "vorkommen-gebiet",
              { source: TERRITORY_SOURCE_ID, "source-layer": TERRITORY_SOURCE_LAYER },
              "territory_public_id",
              stufenVon(teile, traeger, "g:", (teil) => teil.leuchten.gebiete.ganz),
              (ids) => inViewBand(kennungsFilter("territory_public_id", ids)),
              false,
          )
        : { fuellungen: [], scheine: [], konturen: [] };
    const merkmal = { source: VORKOMMEN_QUELLE };
    return [
        ...ganz.fuellungen,
        ...(mitMerkmalen
            ? [
                  {
                      id: "vorkommen-flaeche",
                      type: "fill",
                      ...merkmal,
                      filter: nurT("flaeche"),
                      paint: { "fill-color": FARBE, "fill-opacity": look.fillOpacity },
                  } satisfies LayerSpecification,
              ]
            : []),
        ...ganz.scheine,
        ...kontinent.scheine,
        ...gebiete.scheine,
        ...(mitMerkmalen
            ? [
                  {
                      id: "vorkommen-schein",
                      type: "line",
                      ...merkmal,
                      filter: nurT("flaeche", "gebiet"),
                      layout: { "line-join": "round", "line-cap": "round" },
                      paint: {
                          "line-color": FARBE,
                          "line-width": look.glowWidth,
                          "line-blur": look.glowBlur,
                          "line-opacity": SCHEIN_DECKKRAFT,
                      },
                  } satisfies LayerSpecification,
              ]
            : []),
        ...ganz.konturen,
        ...kontinent.konturen,
        ...gebiete.konturen,
        ...(mitMerkmalen
            ? ([
                  {
                      id: "vorkommen-linie",
                      type: "line",
                      ...merkmal,
                      filter: nurT("flaeche", "gebiet"),
                      // Die spätere Stufe liegt oben (schmaler), die frühere bleibt als Saum darunter sichtbar.
                      layout: { "line-join": "round", "line-cap": "round", "line-sort-key": ["get", "stufe"] },
                      paint: { "line-color": FARBE, "line-width": ["get", "breite"] },
                  },
                  // Ein genannter Ort: ein Ring mit weichem Schein in der Farbe des Vorkommens; nennen ihn mehrere, liegt Ring um Ring.
                  {
                      id: "vorkommen-ort-schein",
                      type: "circle",
                      ...merkmal,
                      filter: nurT("ort"),
                      paint: {
                          "circle-radius": ["+", ["get", "radius"], 2],
                          "circle-color": "rgba(0, 0, 0, 0)",
                          "circle-stroke-color": FARBE,
                          "circle-stroke-width": 6,
                          "circle-stroke-opacity": SCHEIN_DECKKRAFT,
                          "circle-blur": 0.6,
                      },
                  },
                  {
                      id: "vorkommen-ort",
                      type: "circle",
                      ...merkmal,
                      filter: nurT("ort"),
                      paint: {
                          "circle-radius": ["get", "radius"],
                          "circle-color": "rgba(0, 0, 0, 0)",
                          "circle-stroke-color": FARBE,
                          "circle-stroke-width": 3,
                      },
                  },
              ] satisfies LayerSpecification[])
            : []),
        ...(mitMerkmalen ? [ortNamenEbene(font)] : []),
    ];
}

/** Der Name eines Vorkommens, das nur Orte nennt: unter dem Ring, wie ein Ortsname unter seiner Marke; er wandert nicht (ein Punkt hat keinen sichtbaren Teil). */
function ortNamenEbene(font: string): LayerSpecification {
    const ebene = namenEbene(ORT_NAMEN_EBENE, VORKOMMEN_QUELLE, font, [
        "all",
        ["==", ["get", "t"], "ort"],
        ["has", "name"],
    ] as unknown as FilterSpecification);
    if (ebene.type !== "symbol") return ebene;
    return {
        ...ebene,
        layout: {
            ...ebene.layout,
            "text-anchor": "top",
            // Unter dem äußersten Ring: Radius plus Strich, in em der Schrift.
            "text-offset": [0, 1],
            "text-allow-overlap": false,
        },
    };
}

/** Die Namen in den Flächen: die Punkte rechnet `vorkommen-namen.ts` je Bild der Kamera. */
export function buildVorkommenNamenLayer(font: string): LayerSpecification {
    return namenEbene(VORKOMMEN_NAMEN_EBENE, VORKOMMEN_NAMEN_QUELLE, font);
}

/** Hängt das Leuchten der gewählten Vorkommen an den Stil: die Flächen an die Stelle des Leuchtens, die Namen zuoberst. */
export function withVorkommenLeuchten(
    style: StyleSpecification,
    teile: readonly SuchLeuchtenTeil[],
    umfeld: SuchLeuchtenUmfeld,
    font: string = DESIGN_CANON.typography.mapFontStack,
): StyleSpecification {
    const sources: StyleSpecification["sources"] = { ...style.sources };
    if (
        teile.some((teil) => teil.leuchten.gebiete.ganz.length > 0) &&
        umfeld.gebiete !== undefined &&
        sources[TERRITORY_SOURCE_ID] === undefined
    ) {
        sources[TERRITORY_SOURCE_ID] = buildTerritorySource(
            territoryTileTemplate(TERRITORY_TILE_SOURCE, umfeld.gebiete),
        );
    }
    const merkmale = vorkommenMerkmale(teile);
    if (merkmale.length > 0) {
        sources[VORKOMMEN_QUELLE] = {
            type: "geojson",
            data: { type: "FeatureCollection", features: merkmale },
        } as GeoJSONSourceSpecification;
    }
    sources[VORKOMMEN_NAMEN_QUELLE] = buildAreaLabelSource(umfeld.namen);
    const neu = buildVorkommenLeuchtenLayers(
        teile,
        sources[TERRITORY_SOURCE_ID] !== undefined,
        merkmale.length > 0,
        font,
    );
    // Die Namen zuoberst: Sie setzen sich zuerst und weichen keinem anderen Kartennamen (MapLibre platziert von oben nach unten).
    return { ...style, sources, layers: [...setzeLeuchten(style.layers, neu), buildVorkommenNamenLayer(font)] };
}
