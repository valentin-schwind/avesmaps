import {
    AVENTURIA_TRAVEL_MODEL,
    coinParts,
    DEFAULT_LODGING,
    departureDays,
    NAMELESS_MONTH,
    istLandmarkenArt,
    LANDMARKEN_KATALOG,
    landmarkWaypointId,
    LODGING_LEVELS,
    mapPointId,
    parseLandmarkWaypointId,
    ROUTE_DEFAULTS,
    type CalendarMonth,
    type DepartureMonth,
    type LodgingLevel,
    type RouteDate,
    type RouteStagePoint,
    type Season,
    type WaypointHit,
} from "@avesmaps3d/shared";
import { laufText, wert, type Wert } from "../controls/wert";
import { formatNumber, isMessageKey, t } from "../i18n/i18n";

/**
 * Das Modell des Routenplaners (WI-0017, Schritt 2): was man einstellt, wie es heißt, wie es sich
 * zusammenfasst. Keine Vue, kein DOM - was sich ohne Browser prüfen lässt, steht hier.
 *
 * Die Wörter sind Legacys (index.html, map-features-planner-groups.js, route-plan.js; avesmaps@770c80e),
 * die Bilder auch (`public/icons/route/`). Sie stehen in den Sprachtafeln (`i18n/`, WI-0032) und
 * werden beim Aufruf in der Sprache der Seite gelesen.
 */

export { formatNumber };

export type Domain = "land" | "river" | "sea";

/**
 * Wie gereist wird (WI-0050): über Land und Wasser - mit Land, Fluss und Meer wie bisher - oder durch die
 * Luft. Der Flug ist vorbereitet, gerechnet wird er noch nicht (`air-profiles.ts`).
 */
export type TravelMode = "surface" | "air";
export const DOMAINS: readonly Domain[] = ["land", "river", "sea"];

export interface PlannerOptions {
    optimize: "fastest" | "shortest";
    minimizeTransfers: boolean;
    /**
     * Eiltempo (WI-0078): keine dritte Routenoptimierung, sondern eine eigene Reiseweise. Sie wählt die Route nicht -
     * dieselben Wegpunkte ergeben dieselbe Kantenfolge -, sondern verkürzt die Zeit geeigneter Abschnitte.
     */
    hurry: boolean;
    /** Welche Medien die Reise nutzen darf - Legacys Haken Land, Fluss, Meer. */
    enabled: Record<Domain, boolean>;
    /** Je Medium ein Mittel. Es bleibt gewählt, auch wenn das Medium aus ist (Guide §17.11). */
    transports: Record<Domain, string>;
    /** „Reisestunden pro Tag", in halben Stunden zwischen 0,5 und 24. */
    hoursPerDay: number;
    /** Der Reisebeginn (WI-0038); `null` heißt „Unbekannt (keine Jahreszeiten)“ - dann sperrt nichts. */
    departure: { month: DepartureMonth; day: number } | null;
    /** Die Unterbringung (WI-0042): Sie ändert nur die Reisekosten, nie die Route. */
    lodging: LodgingLevel;
}

export const DEFAULT_OPTIONS: PlannerOptions = {
    optimize: ROUTE_DEFAULTS.optimize,
    minimizeTransfers: ROUTE_DEFAULTS.minimize_transfers,
    hurry: ROUTE_DEFAULTS.hurry,
    enabled: { land: true, river: true, sea: true },
    transports: { land: ROUTE_DEFAULTS.land, river: ROUTE_DEFAULTS.river, sea: ROUTE_DEFAULTS.sea },
    hoursPerDay: ROUTE_DEFAULTS.hours_per_day,
    departure: null,
    lodging: DEFAULT_LODGING,
};

export function copyOptions(options: PlannerOptions): PlannerOptions {
    return {
        ...options,
        enabled: { ...options.enabled },
        transports: { ...options.transports },
        departure: options.departure ? { ...options.departure } : null,
    };
}

/** Die Stufen der Unterbringung in Legacys Reihenfolge, vom Zelt bis zum Einzelzimmer. */
export const LODGING_OPTIONS: readonly LodgingLevel[] = LODGING_LEVELS;

export function lodgingLabel(level: LodgingLevel): string {
    return t(`planner.lodging.${level}`);
}

/**
 * Geld in Münzen: „3 D 4 S 8 H“ (Legacy `formatAventurianMoney`). 💣 Nie als Dezimalzahl - die Quelle
 * nennt die Preise „in der Münzart, in der üblicherweise bezahlt wird“ (Regelwerk S. 382). Null ist „—“.
 */
export function formatMoney(heller: number): string {
    const coins = moneyCoins(heller);
    if (coins.length === 0) return t("planner.cost.free");
    return coins.map(laufText).join(" ");
}

/**
 * Ein Betrag in Münzen, die Stellen einzeln als Werte („3“ „D“) - leer bei null Heller. Die Oberfläche setzt sie über den
 * gemeinsamen Baustein `AvmWert` (Design Guide §16.3 „Die Zahl wird hervorgehoben, das Wort nicht“, Betreiber 2026-10-04);
 * `formatMoney` ist dieselbe Rechnung als Text.
 */
export function moneyCoins(heller: number): Wert[] {
    const coins = coinParts(heller);
    const parts: Wert[] = [];
    if (coins.ducats > 0) parts.push(wert(formatNumber(coins.ducats, 0), t("planner.cost.unit.ducat")));
    if (coins.silver > 0) parts.push(wert(String(coins.silver), t("planner.cost.unit.silver")));
    if (coins.heller > 0) parts.push(wert(String(coins.heller), t("planner.cost.unit.heller")));
    return parts;
}

/** Die Wahlen des Reisebeginns: die zwölf Monate und die Namenlosen Tage (Betreiber 2026-11-07; in Legacy kein Aufbruch). */
export { DEPARTURE_MONTHS } from "@avesmaps3d/shared";

/** Das Datum eines Reisebeginns: „12. Firun“, an den Namenlosen Tagen „2. Namenloser Tag“. */
function departureDate({ month, day }: { month: DepartureMonth; day: number }): string {
    return month === NAMELESS_MONTH
        ? formatDate({ month: "", day, nameless: true })
        : formatDate({ month, day, nameless: false });
}

/**
 * Der Tag des Reisebeginns: ganze Tage von 1 bis 30, an den Namenlosen Tagen von 1 bis 5; Unlesbares wird der 1.
 * (Legacy klemmt). Ohne Monat gilt die Grenze der Monate.
 */
export function clampStartDay(value: number, month?: DepartureMonth): number {
    if (!Number.isFinite(value)) return 1;
    return Math.min(month ? departureDays(month) : 30, Math.max(1, Math.round(value)));
}

/** „Firun (Winter)“ in der Auswahl, „Firun“ im Datum; für die Namenlosen Tage „Namenlose Tage (Frühling)“. */
export function monthOption(month: DepartureMonth): string {
    return month === NAMELESS_MONTH ? t("planner.travelStart.month.namenlos") : t(`planner.travelStart.month.${month}`);
}

export function monthName(month: CalendarMonth): string {
    return t(`calendar.month.${month}`);
}

export function seasonLabel(season: Season): string {
    return t(`planner.season.${season}`);
}

/** „25. Firun“, an einem Namenlosen Tag „2. Namenloser Tag“ (Legacy `routePlanFormatDate`). */
export function formatDate(date: Pick<RouteDate, "month" | "day" | "nameless">): string {
    if (date.nameless || date.month === "") return `${String(date.day)}. ${t("planner.calendar.nameless")}`;
    return `${String(date.day)}. ${monthName(date.month)}`;
}

/**
 * Die Spanne einer Etappe (Legacy `routePlanFormatDateRange`): „25. Firun“ an einem Tag, „25.–27. Firun“
 * im selben Monat desselben Jahres, sonst ausgeschrieben („30. Firun – 2. Tsa“).
 */
export function formatDateRange(start: RouteDate, end: RouteDate): string {
    const sameDay =
        start.month === end.month &&
        start.day === end.day &&
        start.nameless === end.nameless &&
        start.years_passed === end.years_passed;
    if (sameDay) return formatDate(start);
    if (!start.nameless && !end.nameless && start.month === end.month && start.years_passed === end.years_passed) {
        return `${String(start.day)}.–${String(end.day)}. ${monthName(start.month as CalendarMonth)}`;
    }
    return `${formatDate(start)} – ${formatDate(end)}`;
}

/** Der Boden der Jahreszeit, benannt; ein unbekannter Zustand behält seinen Schlüssel. */
export function groundLabel(condition: string): string {
    const key = `planner.ground.${condition}`;
    return isMessageKey(key) ? t(key) : condition;
}

/** Eine Wegpunktzeile: der gewählte Ort, oder noch keiner. Der Schlüssel hält die Zeile beim Ziehen. */
export interface PlannerWaypoint {
    key: number;
    place: WaypointHit | null;
}

/** Die Mittel je Medium, in Legacys Reihenfolge - aus dem Reisemodell, nicht abgeschrieben. */
export const TRANSPORTS: Readonly<Record<Domain, readonly string[]>> = AVENTURIA_TRAVEL_MODEL.transportmittel.wert;

export const ICON_BASE = "/icons/route/";

/** Legacys Haken: „Land“, „Fluss“, „Meer“. */
export function domainLabel(domain: Domain): string {
    return t(`planner.transport.filter.${domain}`);
}

export function domainTitle(domain: Domain): string {
    return t(`planner.transport.filter.${domain}.title`);
}
/**
 * Die Bilder der drei Medien (Betreiber 2026-10-05, F6 = B: ein ganzer neuer Satz aus
 * `avesmaps-map-processing/icons/large/Reisen`, 80 × 80 verlustfrei über `scripts/dev/build-route-icons.py`).
 *
 * 🔴 Es sind **Inhaltsbilder** und werden nie umgefärbt (Design Guide §30.2); sie tragen auf hellem wie auf
 * dunklem Grund. Ein Medium zeigt die Fassung MIT Figuren („auf dem Landweg“, „mit dem Boot“, „mit dem Schiff“) -
 * eine Mediengruppe des Reiseplans ist eine Fahrt, keine Wegart. Die Wegarten selbst stehen in `PATH_ICONS`.
 */
export const DOMAIN_ICONS: Readonly<Record<Domain, string>> = {
    land: `${ICON_BASE}LandwegMitWanderern.webp`,
    river: `${ICON_BASE}FlussMitBoot.webp`,
    sea: `${ICON_BASE}MeerMitSchiff.webp`,
};

/**
 * Wie ein Transportmittel heißt; ein unbekanntes behält seine Kennung. Ohne Reisestunden im Namen (Betreiber
 * 2026-10-03: „die zahl steht nicht dran“): Wie lange ein Schiff am Tag fährt, erklären die Reisedetails.
 */
export function transportLabel(transport: string): string {
    const key = `planner.transport.opt.${transport}`;
    return isMessageKey(key) ? t(key) : transport;
}

/** Der kurze Name eines Transportmittels für Tafeln und Aufzählungen; ohne eigenen der Name aus dem Planer. */
export function transportShortLabel(transport: string): string {
    const key = `transportInfo.mode.${transport}`;
    return isMessageKey(key) ? t(key) : transportLabel(transport);
}

/**
 * Die Bilder der Transportmittel:`avesmaps-map-processing/icons/large/Transportmittel`, 80 × 80 verlustfrei
 * (`scripts/dev/build-route-icons.py`, WI-0069). Der Schnellsegler nimmt `Schnellsegler.png`
 * (`Schnellsegel.png` hat keinen durchsichtigen Grund).
 */
export const TRANSPORT_ICONS: Readonly<Record<string, string>> = {
    groupFoot: `${ICON_BASE}ReisegruppeZuFuss.webp`,
    lightWalker: `${ICON_BASE}ZuFuss.webp`,
    groupHorse: `${ICON_BASE}BeritteneReisegruppe.webp`,
    lightRider: `${ICON_BASE}LeichterReiter.webp`,
    caravan: `${ICON_BASE}karavane.webp`,
    cart: `${ICON_BASE}Karren.webp`,
    wagon: `${ICON_BASE}Fuhrwerk.webp`,
    horseCarriage: `${ICON_BASE}Kutsche.webp`,
    sleigh: `${ICON_BASE}Schlitten.webp`,
    riverSailer: `${ICON_BASE}Flusssegler.webp`,
    riverBarge: `${ICON_BASE}Flusskahn.webp`,
    riverGalley: `${ICON_BASE}Flussgaleere.webp`,
    cargoShip: `${ICON_BASE}Lastensegler.webp`,
    fastShip: `${ICON_BASE}Schnellsegler.webp`,
    galley: `${ICON_BASE}Galeere.webp`,
    courierDromone: `${ICON_BASE}Kurierdromone.webp`,
    rowboat: `${ICON_BASE}Ruderboot.webp`,
};

/**
 * 🪤 Die Schreibweise des Bestands ist der Schlüssel (`Strasse`), die Anzeige die Sprache der Seite.
 * Querfeldein heißt „Unwegsames Gelände“ (Legacy) - es ist kein Weg, den man auf der Karte findet.
 */
export function pathLabel(type: string): string {
    const key = `path.${type}`;
    return isMessageKey(key) ? t(key) : type;
}

/**
 * Die Bilder der Wegarten (Betreiber 2026-10-05, F6 = B): derselbe neue Satz wie `DOMAIN_ICONS`, je Wegart ihr
 * eigenes Bild. Inhaltsbilder, nie umgefärbt (Guide §30.2).
 *
 * 🪤 Die Dateinamen `Flusswege` und `Meerwege` bleiben, obwohl die Bilder neu sind: Windows unterscheidet
 * `flussweg.webp` und `Flussweg.webp` nicht, Git schon - ein solches Paar legte zwei Namen für einen Inhalt an.
 * `Querfeldein` trägt seit dem 2026-10-05 ebenfalls das neue Bild (der Betreiber hat es nachgeliefert); der
 * Dateiname blieb derselbe, deshalb steht hier keine Umbenennung.
 */
export const PATH_ICONS: Readonly<Record<string, string>> = {
    Reichsstrasse: `${ICON_BASE}Reichsstrasse.webp`,
    Strasse: `${ICON_BASE}Strasse.webp`,
    Weg: `${ICON_BASE}Weg.webp`,
    Pfad: `${ICON_BASE}Pfad.webp`,
    Gebirgspass: `${ICON_BASE}Gebirgspfad.webp`,
    Wuestenpfad: `${ICON_BASE}Wuestenpfad.webp`,
    Flussweg: `${ICON_BASE}Flusswege.webp`,
    Seeweg: `${ICON_BASE}Meerwege.webp`,
    Querfeldein: `${ICON_BASE}Querfeldein.webp`,
};

/**
 * Die drei Kennzahlen einer Etappe im Infopanel (WI-0079 §7a, Bildvorgabe des Betreibers vom 2026-10-05;
 * F6 = B: die Bilder kommen vom Betreiber, die Strichzeichnungen des Mockups entfallen).
 *
 * Die Rastzeit zeigt `Zelt`, nicht `Nachtlager`: Das Nachtlager ist ein ganzes Bild mit Feuer, Zelt und Landschaft
 * und wird bei 24 px (`--icon-lg`) zu einem Fleck, dessen heller Himmel auf dunklem Grund als Kasten steht. Das Zelt
 * ist ein freigestellter Gegenstand und liest sich in beiden Themen.
 */
export const STAGE_FIGURE_ICONS = {
    distance: `${ICON_BASE}Wegweiser.webp`,
    travel: `${ICON_BASE}Stoppuhr.webp`,
    rest: `${ICON_BASE}Zelt.webp`,
} as const;

export const WORDMARK = `${ICON_BASE}avesmaps-logo.webp`;

/** Legacys Bild zur Rastregel im Erklärfenster „Transportmittel“ (`icons/Rast.webp`). */
export const REST_ICON = `${ICON_BASE}Rast.webp`;

/** Legacys Bilder der fünf Karten im Erklärfenster „Reiseoptionen“ (`route-options-info.js`). */
export const OPTIONS_INFO_ICONS = {
    optimize: `${ICON_BASE}compass.webp`,
    transfers: `${ICON_BASE}waypoint.webp`,
    lodging: `${ICON_BASE}dorf.webp`,
    rest: REST_ICON,
    start: `${ICON_BASE}federundpapier.webp`,
} as const;

/**
 * Wie ein Etappenende heißt, das kein Ort ist (Legacy route-plan.js). Ein Kartenpunkt heißt wie in
 * seiner Planerzeile („Kartenpunkt bei Gareth“), sonst wie ihn der Server nennt.
 */
export function pointLabel(point: RouteStagePoint, pointNames?: ReadonlyMap<string, string>): string {
    switch (point.point) {
        case "place":
            return point.name;
        case "point":
            return pointNames?.get(point.place_id ?? "") ?? point.name;
        case "exit":
            return t("planner.leg.exitPoint");
        case "join":
            return t("planner.leg.joinPoint");
        case "landing":
            return t("planner.leg.landingPoint");
        case "marker":
            return t("planner.leg.marker");
    }
}

/** Die Reisestunden auf halbe Stunden zwischen 0,5 und 24; Unlesbares wird zur Vorgabe (Legacy). */
export function clampHoursPerDay(value: number): number {
    if (!Number.isFinite(value)) return DEFAULT_OPTIONS.hoursPerDay;
    return Math.min(24, Math.max(0.5, Math.round(value * 2) / 2));
}

export interface SummaryPart {
    icon?: string;
    text: string;
}

/**
 * Was die zugeklappte Leiste „Transportmittel" zu Land und Wasser zeigt: Bild und Name je erlaubtem
 * Medium, dahinter die Routenwahl - sie steht seit WI-0050 in diesem Kasten.
 */
export function transportSummary(options: PlannerOptions): SummaryPart[] {
    const parts: SummaryPart[] = DOMAINS.filter((domain) => options.enabled[domain]).map((domain) => {
        const transport = options.transports[domain];
        return {
            icon: TRANSPORT_ICONS[transport] ?? DOMAIN_ICONS[domain],
            text: transportLabel(transport),
        };
    });
    if (parts.length === 0) parts.push({ text: t("planner.transport.summary.none") });
    parts.push({ text: t(options.optimize === "shortest" ? "planner.route.shortest" : "planner.route.fastest") });
    if (options.minimizeTransfers) parts.push({ text: t("planner.minimizeTransfers") });
    // Eiltempo steht hinten (Betreiber 2026-10-05, F7 = B): Es wird angehängt, nichts wechselt seinen Platz.
    if (options.hurry) parts.push({ text: t("planner.hurry") });
    return parts;
}

/**
 * Was die zugeklappte Leiste „Reiseoptionen" zeigt - das Zeitmodell, nicht die Wahl der Route.
 *
 * 🔴 **Alle drei Einstellungen des Kastens, in SEINER Reihenfolge** (Betreiber 2026-10-06: „wenn das reisedatum
 * unbekannt ist … sollte das auch im header stehen. Gemeinschaftszimmer kann auch dranstehen"): Reisestunden,
 * Reisebeginn, Unterbringung - „8,0 h/Tag · ab 12. Firun · Gemeinschaftszimmer". Zugeklappt und aufgeklappt stehen die
 * drei damit in derselben Ordnung.
 *
 * 🪤 **Die Leiste zeigt den WERT, nicht den Vorgabetext.** Ist ein Datum gesetzt, steht das Datum da; ist keins
 * gesetzt, steht dort dasselbe Wort, das auch in der Auswahl steht (`planner.travelStart.noneShort`) - kein zweites
 * dafür. Die Zeile bleibt einzeilig und kürzt am Ende (`summaryOneLine` der Klappbox, Betreiber 2026-10-06: „halt
 * mit ‚…'"); der volle Text steht im DOM und im `title`.
 */
export function optionsSummary(options: PlannerOptions): SummaryPart[] {
    return [
        { text: t("planner.options.summary.hoursPerDay", { n: formatNumber(options.hoursPerDay, 1) }) },
        // Legacys eingeklappte Leiste: „ab 12. Firun“ (map-features-planner-groups.js). Ohne Datum sagt sie, dass keins
        // gesetzt ist - mit demselben Wort wie die Auswahl selbst, nicht einem zweiten dafür.
        {
            text: options.departure
                ? t("planner.options.summary.departure", { date: departureDate(options.departure) })
                : t("planner.travelStart.noneShort"),
        },
        { text: lodgingLabel(options.lodging) },
    ];
}

/** Wie ein Vorschlag im Wegpunktfeld heißt: versteckte Orte mit Vermerk (Legacy, Betreiber 2026-09-23). */
export function waypointLabel(place: WaypointHit): string {
    return place.hidden ? t("planner.waypoint.hidden", { name: place.name }) : place.name;
}

/**
 * Ein angeklickter Kartenpunkt als Wegpunkt („Hierher reisen“, Legacy B11). Er reist durch den Planer
 * wie ein Ort, erkennbar an seiner Unterart; seine Kennung trägt die Lage (`p:<x>:<y>`), so versteht
 * sie die Route-API.
 *
 * ⭐ Anders als Legacy steckt die Lage NICHT im Text des Feldes: Legacy hielt den Punkt als
 * Zeichenkette „Kartenpunkt (y, x)“ und las die Zahlen wieder heraus (MCS-020, B11). Hier heißt er
 * „Kartenpunkt bei Gareth“, und die Zahlen stehen, wo sie hingehören.
 */
export const MAP_POINT_SUBTYPE = "kartenpunkt";

export function isMapPoint(place: WaypointHit | null | undefined): boolean {
    return place?.subtype === MAP_POINT_SUBTYPE;
}

/**
 * Eine Landmarke als Wegpunkt (WI-0271 L6): Sie reist durch den Planer wie ein Ort, mit ihrer Kennung `l:<uuid>` und ihrem Namen
 * (Wegpunktsuche, Kurzlink, „Reiseziel hinzufügen“ im Infopanel). In der Adresse steht sie als Kennung, nicht als Name
 * (`planner-link.ts`): Ein Name könnte auch ein Ort sein.
 */
export function isLandmark(place: WaypointHit | null | undefined): boolean {
    return place !== null && place !== undefined && parseLandmarkWaypointId(place.id) !== null;
}

/**
 * Die Landmarke unter dem Rechtsklick als Ziel (WI-0271 L6, „Hierhin reisen“): Darf ihre Art Reiseziel sein (`LANDMARKEN_KATALOG`, Riff und Strudel
 * nicht), bietet das Kartenmenü „Ziel hinzufügen“ wie an einem Ort, mit dem Wegpunkt `l:<uuid>` an ihrer Lage. Sonst bleibt es das Menü der freien
 * Fläche (`undefined`), und „Hierher reisen“ setzt dort einen Kartenpunkt.
 */
export function landmarkeAlsZiel(
    gipfel: { readonly id: string; readonly name: string; readonly subtype: string },
    lage: { readonly x: number; readonly y: number },
): WaypointHit | undefined {
    const art = gipfel.subtype;
    if (!istLandmarkenArt(art) || !LANDMARKEN_KATALOG[art].reiseziel) return undefined;
    return {
        id: landmarkWaypointId(gipfel.id),
        name: gipfel.name,
        subtype: art,
        hidden: false,
        x: lage.x,
        y: lage.y,
        landmark: art,
    };
}

/** Die Lage auf drei Stellen, wie die Kennung (`mapPointId`): genauer zielt kein Finger. */
const round = (value: number): number => Math.round(value * 1000) / 1000;

export function mapPointHit(point: { x: number; y: number }, name = t("planner.mapPoint")): WaypointHit {
    const x = round(point.x);
    const y = round(point.y);
    return { id: mapPointId({ x, y }), name, subtype: MAP_POINT_SUBTYPE, hidden: false, x, y };
}

/** Die Namen der Kartenpunkte im Planer, nach Kennung - für die Etappenliste. */
export function mapPointNames(rows: readonly PlannerWaypoint[]): ReadonlyMap<string, string> {
    return new Map(
        rows.flatMap((row): [string, string][] =>
            row.place && isMapPoint(row.place) ? [[row.place.id, row.place.name]] : [],
        ),
    );
}

/** „Kartenpunkt bei Gareth“ - bis 10 Einheiten (30 Meilen) nennt ein Ort die Gegend, weiter weg nicht. */
export const MAP_POINT_NEAR_UNITS = 10;
export function mapPointName(near: { name: string } | null, distance: number | null): string {
    return near && distance !== null && distance <= MAP_POINT_NEAR_UNITS
        ? t("planner.mapPoint.near", { name: near.name })
        : t("planner.mapPoint");
}
