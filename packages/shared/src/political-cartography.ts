import { Type, type Static } from "@sinclair/typebox";
import { MAP_VIEWS } from "./map-views.ts";
import { PoliticalCoat } from "./political-coat.ts";
import { MAX_BAND, RENDER_ZOOM_OFFSET } from "./zoom-bands.ts";

/**
 * Wie die Herrschaftsgebiete aussehen und welches Jahr sie zeigen (WI-0062, ADR-0014).
 *
 * 🔴 Nur Darstellung und Zeitstand. Wer welches Gebiet ist, steht in der Datenbank (`territory`), die Farbe und
 * Deckkraft der Fläche ist ein Datum des Gebiets. Hier stehen die Linien, der Name und das EINE Anzeigejahr.
 *
 * 💣 Das Schema verbietet zusätzliche Felder. Ein Tippfehler in einem Schlüssel fiele sonst still auf einen
 * Vorgabewert zurück, und die Karte sähe fast richtig aus.
 */

const Hex = Type.String({ pattern: "^#[0-9a-f]{6}$" });
const Anteil = Type.Number({ minimum: 0, maximum: 1 });
/**
 * Legacys Werte für die Bänder 0 bis 6; der letzte gilt für jedes höhere Band (Stufenausdruck), also zeigen 7 und 8, was 6
 * zeigt (WI-0188).
 */
const JeBand = Type.Array(Type.Number({ minimum: 0 }), { minItems: 7, maxItems: 7 });
const JeBandAnteil = Type.Array(Anteil, { minItems: 7, maxItems: 7 });
/**
 * Wie breit ein Saum an einer Schrift höchstens sein darf, als Anteil der Schriftgröße. MapLibre zeichnet den Saum aus dem
 * Abstandsfeld der Glyphe, und das trägt nur so viel Rand, wie die Glyphen gebaut sind: 3 Bildpunkte bei 24 Schriftgröße
 * (`scripts/dev/build-glyphs.mjs`, `SDF.buffer`), also 3 / 24 = 0,125. Was darüber liegt, schneidet das Glyphenviereck als gerade Kante ab
 * (die Falle der Kraftlinien-Namen). Die Unschärfe läuft als schwacher Auslauf über die Breite hinaus; am Bild (WI-0121 Nachtrag)
 * zeigt eine Breite bis 0,125 mit einer Unschärfe bis 0,06 keine Kante.
 */
const HaloRatioMax = 0.125;

export const PoliticalInnerGroup = Type.Object(
    {
        fromBand: Type.Integer({ minimum: 0, maximum: MAX_BAND }),
        toBand: Type.Integer({ minimum: 0, maximum: MAX_BAND }),
        widthPx: Type.Number({ exclusiveMinimum: 0 }),
        /** Strich und Lücke in Pixeln (Legacys Canvas). */
        dashPx: Type.Tuple([Type.Number({ exclusiveMinimum: 0 }), Type.Number({ exclusiveMinimum: 0 })]),
    },
    { additionalProperties: false },
);
export type PoliticalInnerGroup = Static<typeof PoliticalInnerGroup>;

/**
 * Der Name entlang der Außengrenze (Legacy `drawTerritoryBorderLabels`). `sizePx` und `offsetPx` haben einen Wert je
 * Band ab `fromBand`, der letzte gilt für jedes höhere.
 */
export const PoliticalBorderName = Type.Object(
    {
        /** In welchen Ansichten (mit dem Schalter „Grenzen“) der Name entlang der Grenze steht. */
        views: Type.Array(Type.Union(MAP_VIEWS.map((view) => Type.Literal(view))), { minItems: 1 }),
        fromBand: Type.Integer({ minimum: 0, maximum: 8 }),
        /** Regulärer Ausdruck ohne Groß-/Kleinschreibung: wer passt, bekommt keinen Namen an der Grenze. */
        excludeNamePattern: Type.String({ minLength: 1 }),
        color: Hex,
        alpha: Anteil,
        uppercase: Type.Boolean(),
        sizePx: Type.Array(Type.Number({ exclusiveMinimum: 0 }), { minItems: 1 }),
        offsetPx: Type.Array(Type.Number({ minimum: 0 }), { minItems: 1 }),
        letterSpacingPx: Type.Number({ minimum: 0 }),
        repeatPx: Type.Number({ exclusiveMinimum: 0 }),
        /** Eine Hülle mit weniger Stützpunkten im Umriss bekommt keinen Namen (Legacy `ring.length < 8`). */
        minPoints: Type.Integer({ minimum: 2 }),
        /** Durchgänge des Eckenschneidens (Chaikin) über dem Umriss; Legacy legt einen B-Spline durch die Stützpunkte. */
        smoothing: Type.Integer({ minimum: 0, maximum: 6 }),
        /** Unter diesem Abstand (Karteneinheiten) fallen zwei Grenzen zusammen: dort trägt nur der Vorfahr den Namen. */
        coincidenceUnits: Type.Number({ exclusiveMinimum: 0 }),
    },
    { additionalProperties: false },
);
export type PoliticalBorderName = Static<typeof PoliticalBorderName>;

/**
 * Die Schraffur umstrittener Gebiete (Legacy `map-features-contested-hatch-overlay.js`): diagonale Streifen, die durch die
 * Farben der Parteien laufen (das Gebiet zuerst, dann die Anspruchsteller in ihrer Reihenfolge).
 */
export const PoliticalClaimHatch = Type.Object(
    {
        /** In welchen Ansichten geschraffiert wird (Legacy: nur `political`). */
        views: Type.Array(Type.Union(MAP_VIEWS.map((view) => Type.Literal(view))), { minItems: 1 }),
        /**
         * Winkel der Streifen im Uhrzeigersinn von der Senkrechten (Legacy `STRIPE_ANGLE`). Nur 45° wird gebaut: ein anderer
         * Winkel liefe nicht nahtlos in eine quadratische Musterkachel (`claim-hatch-images.ts`).
         */
        angleDeg: Type.Literal(45),
        /** Breite der Streifen in Bildpunkten bei `stripeWidthRefBand`; sie wächst je Band um `stripeWidthRatio`. */
        stripeWidthBasePx: Type.Number({ exclusiveMinimum: 0 }),
        stripeWidthRefBand: Type.Integer({ minimum: 0, maximum: 8 }),
        stripeWidthRatio: Type.Number({ minimum: 1 }),
        stripeWidthMinPx: Type.Number({ exclusiveMinimum: 0 }),
        stripeWidthMaxPx: Type.Number({ exclusiveMinimum: 0 }),
        /**
         * MapLibre zoomt ein Füllmuster innerhalb einer Zoomstufe stetig von 1× auf 2× (und springt an der ganzen Stufe
         * zurück); Legacy hält die Breite je Stufe fest. Das Muster wird darum um diesen Faktor schmaler gebaut, damit die
         * Breite im Mittel Legacys Wert trifft (der Mittelwert von 2^t über eine Stufe ist 1 / ln 2, gut 1,44).
         */
        patternScale: Type.Number({ exclusiveMinimum: 0, maximum: 1 }),
    },
    { additionalProperties: false },
);
export type PoliticalClaimHatch = Static<typeof PoliticalClaimHatch>;

/**
 * Wann zwei Innengrenzstücke DIESELBE Grenze sind (Ableitung `derive-inner-borders.ts`, Prüfer `inner_border_unique`;
 * Betreiber 2026-09-30: „nur 1 innengrenze zwischen 2 angrenzenden flächen“). Zwei Regeln, beide gegen das längere Stück:
 *  - Liegt ein Stück von mindestens `minLengthUnits` zu `share` seiner Länge näher als `toleranceUnits` an einem längeren,
 *    entfällt es (zwei parallele Kanten, die eine Fläche mit einem schmalen Rest von Überlappung teilt: eine Linie).
 *  - Liegt eine Strecke von mindestens `minLengthUnits` näher als `coincidenceUnits` an einem längeren Stück, entfällt sie
 *    (zwei Linien, die auf einer Strecke praktisch aufeinander liegen, etwa an der Spitze eines Keils). Das ist zugleich das,
 *    was der Prüfer verlangt: keine zwei Linien fallen zusammen.
 */
export const PoliticalInnerUnique = Type.Object(
    {
        /** Abstand in Karteneinheiten, unter dem zwei parallele Grenzstücke als eine Linie gelten (0,03 sind bei Zoom 5,6 rund 0,7 px). */
        toleranceUnits: Type.Number({ exclusiveMinimum: 0 }),
        /** Anteil der Länge des kürzeren Stücks, der in dieser Nähe liegen muss. */
        share: Type.Number({ exclusiveMinimum: 0, maximum: 1 }),
        /** Abstand, unter dem zwei Linien auf einer Strecke als aufeinanderliegend gelten (0,01 sind bei Zoom 5,6 rund 0,24 px). */
        coincidenceUnits: Type.Number({ exclusiveMinimum: 0 }),
        /** Kürzere Stücke und Strecken werden nie entfernt: dort verwechselte man einen spitzen Winkel am Knoten mit einer Doppellinie. */
        minLengthUnits: Type.Number({ minimum: 0 }),
    },
    { additionalProperties: false },
);
export type PoliticalInnerUnique = Static<typeof PoliticalInnerUnique>;

export const PoliticalCartography = Type.Object(
    {
        $comment: Type.Optional(Type.String()),
        schemaVersion: Type.Literal(1),
        mapDomain: Type.String(),
        $zeitComment: Type.Optional(Type.String()),
        /** Das Anzeigejahr in BF - die EINE Stelle (F9). */
        displayYearBf: Type.Integer(),
        /** Legacys Sentinel für „offen“ in `valid_to_bf`; `null` heißt dasselbe. */
        openEndBf: Type.Integer(),
        $bandComment: Type.Optional(Type.String()),
        /**
         * Das höchste Band der Karte (WI-0188: 8; Legacys oberstes Gebietsband 6 wird beim Import 8). Höhere Zoomstufen zeigen
         * es weiter. 🔴 Die Karte zeigt nie mehr, als abgeleitet ist: Der Gebietszeiger nennt das höchste abgeleitete Band, und
         * die Bandwahl klemmt darauf (`territory-band.ts`).
         */
        maxBand: Type.Integer({ minimum: 0, maximum: MAX_BAND }),
        /**
         * Um wie viele Zoomstufen die Bänder VORGEZOGEN kommen, STUFENLOS, am RECHNER: Band b erscheint beim Kamerazoom
         * `b + 1 − bandLeadZoom` statt `b + 1` (Legacy z + 1). 0 heißt Legacys Abbildung (die Baronien ab Zoom 5, Betreiber
         * 2026-09-30: „für desktop 5“), 1 eine ganze Stufe früher. Die EINE Stelle: Stil, Auswahl, Hauptstädte, Grenzen, Namen
         * und Schraffur lesen sie über `territoryBandLead` und `politicalBandForCameraZoom`.
         */
        bandLeadZoom: Type.Number({ minimum: 0, maximum: 3 }),
        /**
         * Derselbe Vorzug am TELEFON (Betreiber 2026-09-30: „fürs handy 4 und für desktop 5“, also Baronien am Telefon ab Zoom 4,
         * am Rechner ab Zoom 5). Welches Gerät ein Telefon ist, entscheidet allein `isPhoneViewport` in der Oberfläche.
         */
        bandLeadZoomPhone: Type.Number({ minimum: 0, maximum: 3 }),
        $fillComment: Type.Optional(Type.String()),
        /** Deckkraft der Gebietsfläche für Besucher, einheitlich (Legacy-Frontend; `territory.opacity` gilt nur im Editor). */
        fillOpacity: Type.Number({ minimum: 0, maximum: 1 }),
        $outerComment: Type.Optional(Type.String()),
        outer: Type.Object(
            {
                color: Hex,
                /** `inside`: die Breite liegt innen an der Grenze (Legacys Clip); `center`: mittig auf ihr. */
                placement: Type.Union([Type.Literal("inside"), Type.Literal("center")]),
                rootWidthPx: JeBand,
                otherWidthPx: JeBand,
                /**
                 * Ein feiner dunkler Saum unter der hellen Linie (kein Legacy-Wert, Betreiberwunsch 2026-09-30: „Grenzen
                 * könnten besser sichtbar sein“): `widthPx` Bildpunkte auf jeder Seite der hellen Linie, mit `alpha` (im
                 * schwachen Modus zusätzlich nach Band eingeblendet wie die Linie selbst).
                 */
                casing: Type.Object(
                    { color: Hex, alpha: Anteil, widthPx: Type.Number({ minimum: 0 }) },
                    { additionalProperties: false },
                ),
            },
            { additionalProperties: false },
        ),
        $innerComment: Type.Optional(Type.String()),
        inner: Type.Object(
            {
                color: Hex,
                alpha: Anteil,
                groups: Type.Array(PoliticalInnerGroup, { minItems: 1 }),
            },
            { additionalProperties: false },
        ),
        $innerUniqueComment: Type.Optional(Type.String()),
        innerUnique: PoliticalInnerUnique,
        $weakComment: Type.Optional(Type.String()),
        weak: Type.Object(
            {
                outerAlpha: JeBandAnteil,
                innerAlpha: JeBandAnteil,
                /** Die Breite der Außengrenze im schwachen Modus - für alle Hüllen gleich, keine dickeren Reiche. */
                outerWidthPx: JeBand,
            },
            { additionalProperties: false },
        ),
        $hatchComment: Type.Optional(Type.String()),
        claimHatch: PoliticalClaimHatch,
        $labelComment: Type.Optional(Type.String()),
        $coatComment: Type.Optional(Type.String()),
        label: Type.Object(
            {
                color: Hex,
                sizePx: Type.Number({ exclusiveMinimum: 0 }),
                haloColor: Hex,
                haloWidthRatio: Type.Number({ minimum: 0, maximum: HaloRatioMax }),
                haloBlurRatio: Type.Number({ minimum: 0, maximum: HaloRatioMax }),
                maxWidthEm: Type.Number({ exclusiveMinimum: 0 }),
                lineHeightEm: Type.Number({ exclusiveMinimum: 0 }),
                /**
                 * Der Faktor für Schrift UND Wappen je Band 0, 1, 2, … ; das letzte gilt für jedes höhere Band (WI-0121,
                 * Legacy `createRegionLabelMarkup`: `labelScale = [0.75, 0.83, 0.91, 1][Math.round(zoom)]`).
                 */
                scaleByBand: Type.Array(Type.Number({ exclusiveMinimum: 0, maximum: 1 }), { minItems: 1, maxItems: 7 }),
                /** Das Wappen am Namen (WI-0121): Maße und Lage, aus Legacys CSS und Code. */
                coat: PoliticalCoat,
                /**
                 * Der Name des GEWÄHLTEN Gebiets (WI-0121 Nachtrag, Betreiber 2026-10-09: „einfach nur text, der schon da steht,
                 * gelb werden“): derselbe Name am selben Platz in derselben Schrift, nur die Farbe wechselt. Die Schriftfarbe ist die
                 * Auswahlfarbe des Kanons (`colour.mapSelection`), hier steht nur, was dazu gehört: der Saum, der das helle Gelb
                 * trägt. Breite und Unschärfe wie `haloWidthRatio` und `haloBlurRatio` als Anteil der Schrift.
                 */
                selected: Type.Object(
                    {
                        haloColor: Hex,
                        haloWidthRatio: Type.Number({ minimum: 0, maximum: HaloRatioMax }),
                        haloBlurRatio: Type.Number({ minimum: 0, maximum: HaloRatioMax }),
                    },
                    { additionalProperties: false },
                ),
            },
            { additionalProperties: false },
        ),
        $borderNameComment: Type.Optional(Type.String()),
        borderName: PoliticalBorderName,
    },
    { additionalProperties: false },
);
export type PoliticalCartography = Static<typeof PoliticalCartography>;

/**
 * Das Band, das die KARTE bei diesem Kamerazoom zeigt: `floor(zoom − RENDER_ZOOM_OFFSET + bandLeadZoom)`, auf
 * 0…`maxBand` begrenzt. Der Vorzug ist eine Kommazahl und hängt am Gerät (Rechner `bandLeadZoom` 0, Telefon `bandLeadZoomPhone` 1): mit 0 beginnt Band 4 bei Zoom 5 (4,99 zeigt noch Band 3), mit 1 bei Zoom 4.
 *
 * 🔴 Es hängt NUR am Kamerazoom (dem Abstand der Kamera zur Oberfläche), nie am Zoom einer Kachel: Mit Gelände lädt
 * MapLibre in der geneigten Ansicht die fernen Kacheln in niedrigerem Zoom, und ein Band je Kachelzoom zerschnitt das Bild
 * (Betreiber 2026-09-30). Die Kacheln tragen alle Bänder mit ihrer Bandnummer; der Stil wählt das Band der Kamera.
 */
export function politicalBandForCameraZoom(cameraZoom: number, maxBand: number, leadZoom: number): number {
    if (!Number.isFinite(cameraZoom)) return 0;
    // Der Zuschlag von 1e-9 fängt Rundung ab: `politicalMinZoom(b)` und zurück landet sonst bei 0,3 knapp unter der ganzen Zahl.
    const band = Math.floor(cameraZoom - RENDER_ZOOM_OFFSET + leadZoom + 1e-9);
    return Math.min(maxBand, Math.max(0, band));
}

/**
 * Von welchem Kamerazoom an zeigt die Karte dieses Band? (Die Umkehrung von `politicalBandForCameraZoom`.) Band 0 gilt von
 * ganz unten an, denn das Band ist nach unten auf 0 geklemmt.
 */
export function politicalMinZoom(band: number, leadZoom: number): number {
    return band <= 0 ? 0 : Math.max(0, band + RENDER_ZOOM_OFFSET - leadZoom);
}

/**
 * Die niedrigste Bandnummer, die eine Kachel dieses Zooms tragen muss (Migration 0059: `GREATEST(0, z - 3)` in beiden
 * Kachelfunktionen; ein Test hält beides gleich). Eine Kachel im Zoom z erscheint bei einem Kamerazoom von mindestens
 * z − 2 (die nahen Kacheln liegen höher als die Kamera, gemessen mit Gelände und 60° Neigung: eine bis zwei Stufen). Das
 * Band der Kamera ist floor(Zoom − 1 + Vorzug) und damit für JEDEN Vorzug ab 0 mindestens floor(Zoom) − 1 (mit einem
 * Vorzug unter 1 gilt das Gleichheitszeichen, mit dem des Rechners, 0, also bei z − 2 genau z − 3), also braucht die Kachel nie ein Band
 * unter z − 3. Nach oben trägt jede Kachel alle Bänder (die fernen liegen tiefer als die Kamera, bis zu drei Stufen).
 */
export function politicalTileMinBand(tileZoom: number): number {
    return Math.max(0, Math.floor(tileZoom) - 3);
}

/**
 * Die Streifenbreite einer Schraffur in Bildpunkten für ein Band (Legacy `stripeWidthForZoom`: 20 px bei Legacy-Zoom 6,
 * je Stufe ×1,25, zwischen 3 und 22 px), mit dem Ausgleich für MapLibres stetig zoomende Füllmuster.
 */
export function claimStripeWidthPx(hatch: PoliticalClaimHatch, band: number): number {
    const legacy = hatch.stripeWidthBasePx * Math.pow(hatch.stripeWidthRatio, band - hatch.stripeWidthRefBand);
    return Math.max(hatch.stripeWidthMinPx, Math.min(hatch.stripeWidthMaxPx, legacy)) * hatch.patternScale;
}

/**
 * Der Wert eines `borderName`-Feldes (`sizePx`, `offsetPx`) für ein Band: Band `fromBand` liest den ersten, das nächste
 * den zweiten, ab dem letzten gilt der letzte weiter (Legacy klemmt auf 4 bis 6).
 */
export function borderNameValueForBand(values: readonly number[], fromBand: number, band: number): number {
    const index = Math.min(values.length - 1, Math.max(0, band - fromBand));
    return values[index] as number;
}

/**
 * Ob der Name einer Hülle an ihrer Außengrenze stehen darf: nicht, wenn er zu den ausgenommenen gehört (Legacy
 * `TERRITORY_LABEL_EXCLUDE`, am Namensanfang, ohne Groß-/Kleinschreibung).
 */
export function borderNameAllowed(name: string, excludeNamePattern: string): boolean {
    const trimmed = name.trim();
    return trimmed.length > 0 && !new RegExp(excludeNamePattern, "i").test(trimmed);
}
