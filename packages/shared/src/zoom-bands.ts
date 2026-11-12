import { Type, type Static } from "@sinclair/typebox";

/**
 * Logical Avesmaps zoom bands z0..z8 (chapter 4.17.5, finding MCS-004).
 *
 * Bands are product semantics and stay renderer independent: the database and this model speak
 * bands, never MapLibre zoom values. A render zoom is translated here, in exactly one place.
 */

export const BAND_COUNT = 9;
export const MAX_BAND = BAND_COUNT - 1;

/**
 * Der Versatz zwischen fachlicher Zoomstufe und MapLibre-Zoom (WI-0015, Finding MCS-016).
 *
 * 🔴 DIE BAENDER SIND LEGACYS ZAHLEN, und Legacy ist Leaflet auf 0..1024: dort traegt Zoom z genau
 * 2^z Bildpunkte je Karteneinheit. MapLibre spannt dieselben 1024 Einheiten ueber seine Weltbreite
 * (512 * 2^z Pixel) und kommt damit auf 2^(z-1). Derselbe Massstab steht bei uns also EINE STUFE
 * HOEHER.
 *
 * An beiden laufenden Karten gemessen (1280x900, Gareth, Bildbreite geteilt durch die Breite des
 * Ausschnitts in Karteneinheiten):
 *
 * | px je Karteneinheit | z3 | z4 | z5 | z6 | z7 | z8 |
 * |---|---|---|---|---|---|---|
 * | Legacy | 8 | 16 | 32 | 64 | 128 | - |
 * | Avesmaps3D | 4 | 8 | 16 | 32 | 64 | 128 |
 *
 * 💣 Ohne diesen Versatz wird ein Bandwert eine Stufe zu frueh wirksam: bei Gareth liess der Filter
 * 99 Gebietsnamen zu, wo Legacy an derselben Stelle 51 zulaesst. Kapitel 11 verlangt ausdruecklich,
 * dass derselbe fachliche Bandwert dieselbe Darstellungsentscheidung erzeugt.
 *
 * 🪤 Er gehoert genau EINMAL hierher. Wer ihn zusaetzlich in eine Kachelfunktion einbaut, wendet ihn
 * zweimal an - `run_min_zoom`/`run_max_zoom` entstehen bereits aus einer Renderzoom-Rechnung.
 */
export const RENDER_ZOOM_OFFSET = 1;

/** Die MapLibre-Zoomstufe, auf der ein fachliches Band wirksam wird. */
export function renderZoomForBand(band: number): number {
    return band + RENDER_ZOOM_OFFSET;
}

/**
 * Legacys höchste Zoomstufe: eine QUELLgrenze, keine Zielgrenze (WI-0129).
 *
 * Legacy endet bei 7; sein Server nimmt für Beschriftungen und die Darstellungstafel nur 0..7 an. Ein Legacy-Maximum 7
 * heißt deshalb „bis ganz nah“, nicht „bis genau 7“. Unser Ziel kennt die Stufen 0..`MAX_BAND`.
 */
export const LEGACY_MAX_BAND = 7;

/**
 * Eine Legacy-Obergrenze im Zielmodell (Betreiber 2026-10-10, WI-0129 E2 A): `7 → 8`, alles andere bleibt.
 *
 * 🔴 Nur an der MIGRATIONSGRENZE anwenden, also beim Schreiben eines Legacy-Werts (Regionsimport, Darstellungstafel) und
 * in deren Prüfern. Ein gespeicherter Wert von Avesmaps3D bedeutet genau, was er sagt: ein Ziel-Maximum 7 endet auf Stufe 7.
 * Die Orts-Overrides (ADR-0006) haben keine Legacy-Herkunft und laufen nie hier durch.
 *
 * 🪤 Nur OBERgrenzen. Eine Untergrenze 7 (`min_zoom`, `ab`) bleibt 7. `null` (kein Wert) und `-1` (Legacys „aus“ in der
 * Darstellungstafel) sind Aussagen, keine Bänder, und bleiben ebenfalls.
 */
export function upperBandFromLegacy(max: number): number;
export function upperBandFromLegacy(max: number | null): number | null;
export function upperBandFromLegacy(max: number | null): number | null {
    return max === LEGACY_MAX_BAND ? MAX_BAND : max;
}

/**
 * Legacys höchstes Band der HERRSCHAFTSGEBIETE: eine QUELLgrenze wie `LEGACY_MAX_BAND`, eine Stufe tiefer (WI-0188). Legacy
 * klemmt jede Gebietsanfrage auf 6 (`avesmapsPoliticalClampLayerRequestZoom`); ein Gebiet oder eine Gebietsfläche mit
 * Legacy-Maximum 6 heißt deshalb „bis ganz nah“.
 */
export const LEGACY_POLITICAL_MAX_BAND = 6;

/**
 * Die Legacy-Obergrenze eines Gebiets oder einer Gebietsfläche im Zielmodell (EDIT-0003 T23, WI-0188): `6 → 8`, alles andere
 * bleibt. Dieselben Regeln wie `upperBandFromLegacy`: nur an der Migrationsgrenze (Gebietsimport und Paritätsprüfer), nur
 * Obergrenzen, `null` bleibt `null`.
 */
export function upperPoliticalBandFromLegacy(max: number): number;
export function upperPoliticalBandFromLegacy(max: number | null): number | null;
export function upperPoliticalBandFromLegacy(max: number | null): number | null {
    return max === LEGACY_POLITICAL_MAX_BAND ? MAX_BAND : max;
}

/**
 * Die höchste MapLibre-Stufe, für die es Vektorkacheln gibt (WI-0129, E1 A: Überzoom statt neuer Kacheln). Darüber zeigt die
 * Karte die Kachel dieser Stufe vergrößert. Abgeleitete Läufe entstehen nie für eine höhere Stufe: niemand fragt sie ab.
 */
export const VECTOR_TILE_MAX_ZOOM = 8;

/**
 * Wie nah eine Fahrt höchstens fliegt, die keinen eigenen Deckel trägt: Grenzübertritt, Route einpassen, Kraftlinie (WI-0129 R2).
 * Das ist die bisherige Höchststufe; Stufe 8 zeigt nur vergrößert, was Stufe 7 schon zeigt (E2 A), und erreicht sie, wer selbst
 * heranzoomt. Suche, Ort und Kartenpunkt haben eigene, niedrigere Deckel (`SEARCH_FIT_MAX_ZOOM`, `placeNearZoom`).
 */
export const FLY_MAX_BAND = LEGACY_MAX_BAND;

/**
 * Wie nah die Karte zoomt: eine halbe Stufe über die höchste (WI-0129, Betreiber 2026-10-10 nach R2: „wenn ich nah ranzoome
 * springt die 8 ganz schnell wieder zurück auf 7. kannst du rein technisch 8,5 zulassen“).
 *
 * 💣 Mit Gelände rechnet MapLibre am Ende jeder Kamerabewegung den Zoom so nach, dass die Bildmitte auf dem Boden liegt
 * (`recalculateZoomAndCenter`). Endete die Karte genau bei Stufe 8, lag sie danach meist knapp darunter, also auf Stufe 7, und
 * blendete auch so. Die halbe Stufe ist der Spielraum dafür. Stufe 8 bleibt die höchste Darstellungsstufe (`bandForRenderZoom`
 * klemmt), darüber wird nur vergrößert.
 */
export const MAX_VIEW_BAND = MAX_BAND + 0.5;

/**
 * Punkt nach Pixel (WI-0015, B1).
 *
 * 🔴 Die Groessentafel der ORTSNAMEN fuehrt Punktwerte - Legacy rechnet sie in einer eigenen Zeile
 * um: `const fontSizePx = labelSize * 4 / 3; // pt -> px`. MapLibres `text-size` ist dagegen eine
 * Pixelangabe. Ohne die Umrechnung ist jede Beschriftung ein Viertel zu klein, gleichmaessig ueber
 * alle Stufen.
 *
 * 🪤 Sie gilt NICHT fuer alle Arten. Landschaftsnamen tragen ihre Groesse als Pixelwert am Feature,
 * Wegenamen setzt Legacy direkt in px. Legacy mischt die Einheiten; wer die Umrechnung ueberall
 * anwendet, macht aus einem Fehler drei.
 */
export const POINTS_TO_PIXELS = 4 / 3;

const BandSeries = Type.Array(Type.Union([Type.Number(), Type.Null()]), {
    minItems: BAND_COUNT,
    maxItems: BAND_COUNT,
});

export const ZoomBandModel = Type.Object(
    {
        schemaVersion: Type.Literal(1),
        mapDomain: Type.String(),
        bandCount: Type.Literal(BAND_COUNT),
        marker: Type.Record(Type.String(), BandSeries),
        label: Type.Record(Type.String(), BandSeries),
        spacing: Type.Record(Type.String(), Type.Number()),
        /**
         * Bauwerksklassen (WI-0011): welche Ortsklassen ein Bauwerk sind, und ab welchem Band ihr
         * Marker eine Raute ist.
         *
         * 🔴 Ein MERKMAL mit eigenem Namen. Wer „ist ein Bauwerk" als `subtype === "gebaeude"`
         * schreibt, wiederholt Legacys Fehler aus MCS-012 — eine zweite Bauwerksklasse kippt dann
         * still in die falsche Richtung. Eine neue Bauwerksklasse ist hier eine Zeile Konfiguration.
         */
        structure: Type.Object(
            {
                classes: Type.Array(Type.String(), { minItems: 1 }),
                diamondFromBand: Type.Integer({ minimum: 0, maximum: BAND_COUNT - 1 }),
            },
            { additionalProperties: false },
        ),
        /**
         * Der Goldring der Metropolen: ab `fromBand`, sobald der Marker `minDiameter` px erreicht,
         * Ringbreite `round(Durchmesser × ringRatio)` (Legacy `isCapital`/`accentRing`).
         */
        capital: Type.Object(
            {
                classes: Type.Array(Type.String(), { minItems: 1 }),
                fromBand: Type.Integer({ minimum: 0, maximum: BAND_COUNT - 1 }),
                minDiameter: Type.Number({ minimum: 0 }),
                ringRatio: Type.Number({ exclusiveMinimum: 0 }),
            },
            { additionalProperties: false },
        ),
        /**
         * Nachkalibrierung der Legacy-Tafeln für MapLibre.
         *
         * ⭐ Die Zahlen in `label` und `landscapeLabel` sind Legacys Werte, Ziffer für Ziffer, mit
         * Herkunftsnachweis. Sie mit einem Faktor zu überschreiben würde genau diese Aussage
         * zerstören — man wüsste danach nicht mehr, welche Zahl gemessen und welche gewählt ist.
         * Der Faktor steht deshalb DANEBEN: die Tafel bleibt Legacy, der Faktor ist unsere
         * Entscheidung, und beide sind einzeln lesbar.
         *
         * 🪤 HEUTE IST SIE LEER, und das ist der Punkt. Hier stand `label: 1.5`, am Auge gefunden —
         * und der Wert glich in Wahrheit zwei Uebertragungsfehler aus: die fehlende Umrechnung von
         * Punkt nach Pixel (4/3) und den Zoomversatz. Beide sind seit WI-0015 an ihrer Ursache
         * behoben. Eine optische Restkalibrierung darf wieder hier stehen — aber erst, wenn sie
         * nichts mehr vertritt als den Geschmack des Betreibers.
         */
        calibration: Type.Optional(
            Type.Object(
                {
                    $comment: Type.Optional(Type.String()),
                    label: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
                    landscapeLabel: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
                },
                { additionalProperties: false },
            ),
        ),
    },
    { $id: "ZoomBandModel", additionalProperties: true },
);

export type ZoomBandModel = Static<typeof ZoomBandModel>;

export type BandSeriesValues = (number | null)[];

/**
 * Render zoom to logical band. MapLibre reports a continuous zoom, the bands are discrete, so the
 * mapping floors and clamps - the same step semantics legacy had, not a new rounding rule.
 */
export function bandForRenderZoom(renderZoom: number): number {
    if (!Number.isFinite(renderZoom)) {
        return 0;
    }
    return Math.min(MAX_BAND, Math.max(0, Math.floor(renderZoom - RENDER_ZOOM_OFFSET)));
}

/** First band with a value: the appearance level. Returns null when the class never appears. */
export function appearanceBand(series: BandSeriesValues): number | null {
    const index = series.findIndex((value) => value !== null);
    return index === -1 ? null : index;
}

/**
 * A class must not disappear again once it has appeared (chapter 4.17.5). Returns the bands that
 * violate that, so a test can name them instead of a style silently showing holes.
 */
export function visibilityHoles(series: BandSeriesValues): number[] {
    const appearance = appearanceBand(series);
    if (appearance === null) {
        return [];
    }
    return series.map((value, band) => (band > appearance && value === null ? band : -1)).filter((band) => band !== -1);
}

export type StepExpression = (string | number | unknown[])[];

/**
 * Builds a MapLibre step expression over the logical bands: the value holds across a band and
 * changes at its boundary.
 *
 * This is the band semantics in their plainest form, and the right shape wherever a property is
 * not re-evaluated continuously anyway. For visual sizes that MapLibre does re-evaluate, use
 * `bandInterpolateExpression` - a step makes every band boundary pop (operator decision
 * 2026-09-20).
 */
export function bandStepExpression(series: BandSeriesValues, renderZoomOffset = RENDER_ZOOM_OFFSET): StepExpression {
    const valueAt = (band: number): number => series[band] ?? 0;
    const expression: StepExpression = ["step", ["zoom"], valueAt(0)];
    for (let band = 1; band < BAND_COUNT; band += 1) {
        expression.push(band + renderZoomOffset, valueAt(band));
    }
    return expression;
}

/** Eine Bandgrenze: eine feste Stufe (Override) oder ein Ausdruck, der sie aus der Kachel liest. */
export type BandBound = number | readonly unknown[];

/**
 * Die Ränder eines Bandes als Filter über `["zoom"]`. Ein Name steht genau dann, wenn die Stufe der Zoomanzeige
 * (`bandForRenderZoom`) in seinem Band liegt (WI-0129 §17d, Betreiber 2026-10-11).
 *
 * - **Unten** beginnt Stufe n bei `renderZoomForBand(n)`. Die unterste Stufe 0 hat keinen Rand: Die Karte zoomt am Telefon bis
 *   MapLibre 0,71 hinaus, die Anzeige zeigt dort 0, und `zoom >= 1` ließ „Aventurien“ verschwinden (Betreiber: „ich schätze
 *   0+1 > 0,5“).
 * - **Oben** endet Stufe n erst am Ende der Stufe: `zoom < renderZoomForBand(n) + 1` (Legacys Obergrenze ist inklusiv).
 *
 * 🪤 MapLibre wertet `["zoom"]` in einem Filter mit dem ganzzahligen Kachelzoom aus (Vektorkacheln runden ab, in der geneigten
 * Ansicht tragen ferne Kacheln weniger). Beide Ränder stimmen dort und ebenso bei jedem Zwischenwert.
 */
export function zoomFromBand(min: BandBound): unknown[] | null {
    if (typeof min === "number") return min <= 0 ? null : [">=", ["zoom"], renderZoomForBand(min)];
    return ["any", ["<=", min, 0], [">=", ["zoom"], ["+", min, RENDER_ZOOM_OFFSET]]];
}

/** Der obere Rand dazu (`zoomFromBand`). Ein Band, das nie zeichnet („aus“, `-1`), bleibt auch auf Stufe 0 aus. */
export function zoomUntilBand(max: BandBound): unknown[] {
    if (typeof max === "number") return max < 0 ? ["boolean", false] : ["<", ["zoom"], renderZoomForBand(max) + 1];
    return ["all", [">=", max, 0], ["<", ["zoom"], ["+", max, RENDER_ZOOM_OFFSET + 1]]];
}

/**
 * Filter for a per-object override. Legacy treats max_zoom as INCLUSIVE, MapLibre treats maxzoom
 * as exclusive (chapter 4.17.5), so the upper bound is written as < next band and never handed to
 * MapLibre's own maxzoom. Both edges follow `zoomFromBand`/`zoomUntilBand`.
 */
export function overrideFilter(minBand: number | null, maxBand: number | null): unknown[] | null {
    const conditions: unknown[][] = [];
    const from = minBand === null ? null : zoomFromBand(minBand);
    if (from !== null) {
        conditions.push(from);
    }
    if (maxBand !== null) {
        conditions.push(zoomUntilBand(maxBand));
    }
    if (conditions.length === 0) {
        return null;
    }
    return conditions.length === 1 ? (conditions[0] as unknown[]) : ["all", ...conditions];
}

export type ZoomExpression = (string | number | unknown[])[];

/**
 * Builds a MapLibre interpolate expression over the logical bands for a property that differs per
 * feature class.
 *
 * The bands stay the cartographic definition: every integer Avesmaps zoom is a stop, so the value
 * there is exactly the band value, unrounded and untouched. Between two bands the renderer
 * interpolates linearly, because MapLibre zooms continuously and a step would make every crossing
 * pop (operator decision 2026-09-20). Interpolation is a rendering concern only - nothing in the
 * data model learns about fractional zoom.
 *
 * Classes without a value on a band contribute 0 here. That alone would let a class grow into
 * existence over the band below its appearance level, which moves the visible start earlier, so
 * appearance is not expressed through size at all: `appearanceFilter` keeps the feature out of the
 * layer until its band is reached.
 *
 * Only usable for properties MapLibre re-evaluates continuously, which means paint properties.
 * Layout properties such as `text-size` and `icon-size` are not re-evaluated on every fractional
 * zoom change, so this must not be applied to them without looking at the result first.
 */
export interface BandExpressionOptions {
    transform?: (value: number) => number;
    /**
     * Feature property that replaces the band value where it is set. It is folded into every stop
     * rather than wrapped around the expression, because MapLibre allows `["zoom"]` only as the
     * input of the outermost interpolate - a `case` around it is rejected.
     */
    overrideField?: string;
    /**
     * Ein Faktor auf das Ergebnis - fuer abgeleitete Groessen wie den Saum, der ein Anteil der
     * Schriftgroesse ist.
     *
     * 💣 Er wird IN die Stops gefaltet und um den Override herumgelegt, niemals um den ganzen
     * Ausdruck. `["*", <interpolate ueber zoom>, faktor]` waere das Naheliegende und ist falsch:
     * MapLibre erlaubt `["zoom"]` nur als Eingang des AEUSSERSTEN Ausdrucks und lehnt das still ab -
     * die Eigenschaft bleibt dann auf ihrem Vorgabewert, ohne Fehlermeldung.
     *
     * 🪤 Der Unterschied zu `transform`: `transform` rechnet auf dem BANDWERT und erreicht den
     * Override nicht, weil der erst zur Laufzeit am Feature steht. `scale` erreicht beide.
     */
    scale?: number;
}

export function bandInterpolateExpression(
    seriesByClass: Record<string, BandSeriesValues>,
    classProperty: string,
    options: BandExpressionOptions = {},
): ZoomExpression {
    const transform = options.transform ?? ((value: number) => value);
    const scale = options.scale ?? 1;
    const matchAtBand = (band: number): number | unknown[] => {
        const cases: unknown[] = [];
        for (const [className, series] of Object.entries(seriesByClass)) {
            const value = series[band];
            if (value !== null && value !== undefined) {
                cases.push(className, transform(value) * scale);
            }
        }
        // Ein Band ohne jeden Wert (etwa Band 0 der Ortsnamen nach den Zoombändern, WI-0221) ist 0: Ein `match` ohne Fall lehnt
        // MapLibre als ungültig ab, und mit ihm den ganzen Ausdruck.
        const fromClass: number | unknown[] = cases.length === 0 ? 0 : ["match", ["get", classProperty], ...cases, 0];
        if (!options.overrideField) {
            return fromClass;
        }
        const overrideValue: unknown =
            scale === 1 ? ["get", options.overrideField] : ["*", ["get", options.overrideField], scale];
        return ["case", ["has", options.overrideField], overrideValue, fromClass];
    };

    const expression: ZoomExpression = ["interpolate", ["linear"], ["zoom"]];
    for (let band = 0; band < BAND_COUNT; band += 1) {
        // Der Stop liegt auf der RENDER-Stufe, auf der dieses Band gilt (WI-0015).
        expression.push(renderZoomForBand(band), matchAtBand(band));
    }
    return expression;
}

/**
 * Filter that admits a feature only from its own appearance band on.
 *
 * Visibility stays band semantics (chapter 4.17.5): a class appears at its band, not gradually
 * before it. MapLibre evaluates `["zoom"]` inside a filter at the integer zoom of the tile, which
 * is exactly the step behaviour the bands describe - and the reason size and visibility are
 * expressed by two different mechanisms here rather than one.
 *
 * A class the model never gives a value to is not admitted at all; that is the same result as the
 * former size 0, only stated instead of implied.
 */
export function appearanceFilter(seriesByClass: Record<string, BandSeriesValues>, classProperty: string): unknown[] {
    const cases: unknown[][] = [];
    for (const [className, series] of Object.entries(seriesByClass)) {
        const appearance = appearanceBand(series);
        if (appearance === null) {
            continue;
        }
        const isClass: unknown[] = ["==", ["get", classProperty], className];
        cases.push(appearance === 0 ? isClass : ["all", isClass, [">=", ["zoom"], renderZoomForBand(appearance)]]);
    }
    if (cases.length === 0) {
        // 💣 DAS SENTINEL STEHT ALS ESCAPE, NICHT ALS ROHES BYTE. Hier lag ein echtes NUL-Byte in
        // der Quelldatei - git hielt die ganze Datei daraufhin fuer BINAER: keine Diffs, keine
        // Zusammenfuehrung, und bei zwei Bearbeitern ist das kein Schoenheitsfehler. Der Wert ist
        // unveraendert (U+0000 gefolgt von "none"), nur seine Schreibweise ist lesbar.
        //
        // 🪤 Der Zweck des Zeichens: ein Klassenname, den kein Datensatz tragen KANN. Ein
        // gewoehnlicher Platzhalter wie "none" waere ein Name, den jemand eines Tages vergibt.
        return ["==", ["get", classProperty], "\u0000none"];
    }
    return cases.length === 1 ? (cases[0] as unknown[]) : ["any", ...cases];
}

/**
 * Filter for the label of a single place: the global class band decides, an admin override may
 * replace it (ADR-0006).
 *
 * The global table of class and zoom band is the cartography. An override is the rare exception an
 * administrator sets for one place, never a second set of rules - so an unset field inherits the
 * global rule completely, and a set one replaces exactly the property it names.
 *
 * `max` is inclusive in the band model and exclusive in MapLibre, which is why the upper bound is
 * written against the next band instead of being handed to MapLibre's own maxzoom.
 */
export function labelFilter(
    seriesByClass: Record<string, BandSeriesValues>,
    classProperty: string,
    fields: { visible: string; min: string; max: string },
): unknown[] {
    return [
        "all",
        // An admin who switched this name off means it, at every zoom.
        ["!=", ["get", fields.visible], false],
        [
            "case",
            ["has", fields.min],
            zoomFromBand(["to-number", ["get", fields.min]]),
            // No override: the class decides when this name appears - unless an admin forced it
            // visible, which is what the override is for.
            ["==", ["get", fields.visible], true],
            true,
            appearanceFilter(seriesByClass, classProperty),
        ],
        ["case", ["has", fields.max], zoomUntilBand(["to-number", ["get", fields.max]]), true],
    ];
}

/**
 * Label size: the global band table, replaced by an admin override where one is set (ADR-0006).
 *
 * The override holds at every zoom, because it is a statement about this place and not about a
 * band. Without one the place inherits its class curve, interpolation included.
 */
export function labelSizeExpression(
    seriesByClass: Record<string, BandSeriesValues>,
    classProperty: string,
    overrideField: string,
    scale = 1,
): ZoomExpression {
    return bandInterpolateExpression(seriesByClass, classProperty, { overrideField, scale });
}
