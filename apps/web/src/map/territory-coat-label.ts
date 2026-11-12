import type { StyleSpecification } from "maplibre-gl";
import {
    AVENTURIA_POLITICAL_CARTOGRAPHY,
    coatLabelGeometry,
    labelScaleForBand,
    type PoliticalCartography,
} from "@avesmaps3d/shared";
import { VIEW_BAND } from "./territory-band";

/**
 * Das Wappen am Namen des Gebiets, soweit es der STIL betrifft (WI-0121, Betreiber 2026-10-09: „prima und zentriert wie in
 * legacy“): Welche Gebiete eines tragen, wie groß es steht, und wo Wappen und Name vom Ankerpunkt aus liegen.
 *
 * Eine Symbolebene, ein Symbol je Gebiet: Das Bild ist das Wappen (`icon-image`), der Name der Text; MapLibre setzt beide
 * gemeinsam oder keinen von beiden (`icon-optional` und `text-optional` bleiben aus) und lässt sie gemeinsam kollidieren.
 * Wappen und Name stehen in einer Spalte, beide an derselben senkrechten Achse: das Wappen mit seiner Unterkante, der Name
 * mit seiner Oberkante (`text-anchor: top`) auf festem Abstand vom Anker. Die Maße sind Legacys (`political-coat.ts`), bis auf
 * die Schrift: Der Name steht größer (Betreiber 2026-10-09), und die Lücke vom Wappen zur Schrift bleibt dabei.
 *
 * 🔴 Welche Gebiete ein Wappen haben, steht im globalen Zustand `territoryCoats` (Kennung des Gebiets → Bildname), nicht als
 * Literal in drei Ausdrücken der Ebene: Die Liste hat gut 400 Einträge, und jeder Ausdruck trüge sie sonst für sich. Das ist
 * dasselbe Muster wie das Band der Ansicht (`territory-band.ts`); `withTerritoryCoats` setzt den Anfangswert.
 *
 * 🔴 Jeder Wert hängt am BAND der Ansicht (globaler Zustand), nie am Zoom: Das sind Layout-Eigenschaften, die MapLibre beim
 * Aufbau der Kachel auswertet, und ein Ausdruck über `["zoom"]` bekäme dort den Zoom der KACHEL (siehe `territory-layers.ts`).
 */

/** Die Tafel des Namens (`label` in `aventuria-political.json`); die Bausteine nehmen sie als Vorgabe und lassen sich mit einer anderen füttern (Abnahmeblatt, Test). */
export type TerritoryLabelLook = PoliticalCartography["label"];

const LABEL: TerritoryLabelLook = AVENTURIA_POLITICAL_CARTOGRAPHY.label;

/** Der Name des globalen Zustands im Stil. */
export const TERRITORY_COATS_STATE = "territoryCoats";

/** Der Anfangswert des Zustands: Kennung des Gebiets → Bildname (`coat:<sha256>`). */
export function withTerritoryCoats(
    style: StyleSpecification,
    images: Readonly<Record<string, string>>,
): StyleSpecification {
    return { ...style, state: { ...style.state, [TERRITORY_COATS_STATE]: { default: images } } };
}

/** Die Kennung des Gebiets aus der Kachel als Text. */
const TERRITORY_ID = ["to-string", ["get", "territory_public_id"]];
const COATS = ["object", ["global-state", TERRITORY_COATS_STATE]];

/** Trägt das Gebiet dieses Merkmals ein Wappen? */
export const HAS_COAT = ["has", TERRITORY_ID, COATS];

/** Der Bildname des Wappens dieses Gebiets; leer, wo es keins gibt (dann zeichnet MapLibre kein Bild). */
const COAT_IMAGE = ["case", HAS_COAT, ["get", TERRITORY_ID, COATS], ""];

/** Wie viele Bänder die Tafel einzeln kennt; das letzte gilt für jedes höhere. */
const BAND_COUNT = LABEL.scaleByBand.length;

/**
 * Ein Wert je Band als Stufenausdruck über dem Band der Ansicht: Legacy springt von Stufe zu Stufe (Leaflet kennt nur ganze
 * Zoomstufen). Liegen alle Werte gleich, bleibt es ein Wert - ein Stufenausdruck ohne Stufen wäre Rauschen im Stil.
 */
export function stepOverBands(valueOf: (band: number) => unknown): unknown {
    const values = Array.from({ length: BAND_COUNT }, (_, band) => valueOf(band));
    const [first, ...rest] = values;
    if (rest.every((value) => JSON.stringify(value) === JSON.stringify(first))) return first;
    const stops: unknown[] = [];
    rest.forEach((value, index) => stops.push(index + 1, value));
    return ["step", VIEW_BAND, first, ...stops];
}

/** Die Schriftgröße des Namens in diesem Band: Legacys Faktor mal die Größe der Tafel. */
export function labelFontPx(band: number, look: TerritoryLabelLook = LABEL): number {
    return look.sizePx * labelScaleForBand(look.scaleByBand, band);
}

/** Wo Wappen und Name im Block liegen, für die Zeilenzahl, auf die die Tafel kalibriert ist. */
function geometry(band: number, look: TerritoryLabelLook): ReturnType<typeof coatLabelGeometry> {
    return coatLabelGeometry(look.coat, look, band, look.coat.calibratedLines);
}

/** Das Wappen als Vielfaches seines Bildes: Das Bild hat die Kantenlänge `edgePx` (`territory-coat-images.ts`). */
function iconScale(band: number, look: TerritoryLabelLook): number {
    return geometry(band, look).coatPx / look.coat.edgePx;
}

/**
 * Die Layout-Eigenschaften, die ein Symbol mit Wappen von einem ohne unterscheiden. Aus der Schriftgröße des Namens je Band
 * (`labelFontPx`) und der Zeilenhöhe folgt, wie weit die Oberkante des Textkastens vom Anker liegt, damit zwischen Wappen und
 * Schrift die Lücke der Tafel bleibt. Erkannt wird ein Gebiet mit Wappen am Zustand (`HAS_COAT`), benannt nach der Kennung.
 */
export function territoryCoatLayout(look: TerritoryLabelLook = LABEL): Record<string, unknown> {
    // Der Textkasten beginnt eine halbe Zeilenhöhe über der Oberkante der Schrift (die Schrift steht mittig in ihrer Zeile).
    const boxTopPx = (band: number): number =>
        geometry(band, look).coatBottomPx +
        geometry(band, look).gapToEmTopPx -
        ((look.lineHeightEm - 1) / 2) * labelFontPx(band, look);
    return {
        "icon-image": COAT_IMAGE,
        "icon-anchor": "bottom",
        // `icon-offset` rechnet in Bildpunkten des unskalierten Bildes und wird mit `icon-size` multipliziert.
        "icon-offset": stepOverBands((band) => [
            "literal",
            [0, geometry(band, look).coatBottomPx / iconScale(band, look)],
        ]),
        "icon-size": stepOverBands((band) => iconScale(band, look)),
        "text-anchor": ["case", HAS_COAT, "top", "center"],
        "text-offset": [
            "case",
            HAS_COAT,
            stepOverBands((band) => ["literal", [0, boxTopPx(band) / labelFontPx(band, look)]]),
            ["literal", [0, 0]],
        ],
    };
}
