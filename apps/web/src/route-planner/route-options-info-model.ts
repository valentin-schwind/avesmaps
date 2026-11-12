import {
    AVENTURIA_TRAVEL_MODEL,
    LODGING_LEVELS,
    groundMilesOf,
    type LodgingLevel,
    type TravelModel,
} from "@avesmaps3d/shared";
import { CLIMATE_ZONE_KEYS } from "../map/climate-zones";
import { LAND_PATH_TYPES, realSpeed } from "./transport-info-model";

/**
 * Die Zahlen des Erklärfensters „Reiseoptionen“ (WI-0045 Stufe B; Legacy `js/routing/route-options-info.js`,
 * Guide §17.12) - gerechnet aus UNSEREM Reisemodell, nie abgeschrieben.
 *
 * ⭐ Legacys Regel gilt weiter: KEINE ZAHL STEHT ALS TEXT. Tempo, Aufschlag, Reisestunden, Bodentafel
 * und Preise kommen aus dem Modell; ändert jemand eine Zahl, kann das Fenster nicht veralten.
 *
 * 🔴 Wo Legacy von unserem Modell abweicht, gilt das Modell (WI-0045 Regel 5):
 * - Tempo wie im Fenster „Transportmittel“: Tafelwert ÷ Zeitfaktor, das Tempo der Route (C7).
 * - Der Boden der Jahreszeit lenkt bei uns auch die Wegsuche (WI-0038 E2, E3); die trockenen
 *   Subtropen haben keinen Abzug (E4).
 * - Die Seepassage kostet bei uns je Unterbringung (WI-0042 K2); Legacy rechnete sie nicht.
 */

/**
 * Die Klimazonen der Karte von Nord nach Süd - dieselbe Liste, nach der die Bänder gefärbt werden.
 *
 * Seit WI-0171 steht sie bei den Zonen selbst (`map/climate-zones.ts`), zusammen mit ihren Namen; hier bleibt der
 * Name, unter dem das Erklärfenster sie kennt.
 */
export const CLIMATE_ZONES: readonly string[] = CLIMATE_ZONE_KEYS;

/** Die Jahreszeiten der Bodentafel in Legacys Lesereihenfolge, wenn die Tafel keine nennt. */
const SEASONS_FALLBACK = ["winter", "fruehling", "sommer", "herbst"] as const;

/** Die Spanne des Tempos auf einer Wegart über alle Mittel, die sie befahren - `null`, wenn keins es tut. */
export function speedRange(
    pathType: string,
    model: TravelModel = AVENTURIA_TRAVEL_MODEL,
): { min: number; max: number } | null {
    const speeds = Object.values(model.transportmittel.wert)
        .flat()
        .map((transport) => realSpeed(model, transport, pathType))
        .filter((speed): speed is number => speed !== null && speed > 0);
    return speeds.length > 0 ? { min: Math.min(...speeds), max: Math.max(...speeds) } : null;
}

/** „Kürzer heißt oft langsamer“: das Tempo auf dem Pass gegen das auf der Reichsstraße. */
export function optimizeExample(
    model: TravelModel = AVENTURIA_TRAVEL_MODEL,
): { passMin: number; passMax: number; roadMax: number } | null {
    const pass = speedRange("Gebirgspass", model);
    const road = speedRange("Reichsstrasse", model);
    return pass && road ? { passMin: pass.min, passMax: pass.max, roadMax: road.max } : null;
}

/** Das Suchgewicht je Umstieg (Legacy `TRANSFER_PENALTY`); es gilt nur mit „Umsteigen minimieren“. */
export function transferPenalty(model: TravelModel = AVENTURIA_TRAVEL_MODEL): number {
    return model.umstiegsaufschlag.wert;
}

/** Reisestunden je Tag an Land (die Vorgabe des Planers) und auf dem Wasser, mit der Rast dazu. */
export function restDay(model: TravelModel = AVENTURIA_TRAVEL_MODEL): {
    hours: number;
    restHours: number;
    landHours: number;
    waterHours: number;
} {
    const { land, water } = model.reisetagStunden.wert;
    return { hours: land, restHours: 24 - land, landHours: land, waterHours: water };
}

export interface ClimateRow {
    /** Die Zonen dieser Zeile, von Nord nach Süd. */
    zones: string[];
    /** Je Jahreszeit der Bodenzustand, `null` ohne Abzug. */
    conditions: (string | null)[];
}

/** Die Jahreszeiten, wie die Bodentafel sie führt, in der Reihenfolge ihres ersten Auftretens. */
export function groundSeasons(model: TravelModel = AVENTURIA_TRAVEL_MODEL): string[] {
    const seasons: string[] = [];
    for (const row of Object.values(model.jahreszeitBoden.wert.tafel)) {
        for (const season of Object.keys(row)) if (!seasons.includes(season)) seasons.push(season);
    }
    return seasons.length > 0 ? seasons : [...SEASONS_FALLBACK];
}

/**
 * Die Bodentafel Zone × Jahreszeit (Legacy `avesmapsRouteOptionsClimateRows`).
 *
 * 💣 DIE ZEILEN KOMMEN AUS DER KARTE, DIE WERTE AUS DER BODENTAFEL. Die Karte führt acht Zonen, die
 * Tafel fünf; eine Zone ohne Eintrag ist eine Zeile aus Strichen, und das ist die Wahrheit: dort wirkt
 * kein Abzug. Nebeneinanderliegende Zonen mit demselben Jahreslauf stehen in EINER Zeile („Subpolare
 * Zone, Boreale Zone“) - zusammengefasst wird nur, was aneinandergrenzt, die Reihenfolge ist Erdkunde.
 */
export function climateRows(
    zoneOrder: readonly string[] = CLIMATE_ZONES,
    model: TravelModel = AVENTURIA_TRAVEL_MODEL,
): ClimateRow[] {
    const table = model.jahreszeitBoden.wert.tafel;
    const seasons = groundSeasons(model);
    const rows: (ClimateRow & { signature: string })[] = [];
    for (const zone of zoneOrder) {
        const conditions = seasons.map((season) => table[zone]?.[season] ?? null);
        // Verglichen wird, was in der Zeile STEHT: eine Zone ohne Eintrag und eine mit leeren Jahreszeiten sind gleich.
        const signature = conditions.map((condition) => condition ?? "").join("|");
        const previous = rows.at(-1);
        if (previous?.signature === signature) previous.zones.push(zone);
        else rows.push({ zones: [zone], conditions, signature });
    }
    return rows.map(({ zones, conditions }) => ({ zones, conditions }));
}

/**
 * Der Boden über der Schneegrenze (`schneegrenze.bodenDarueber`, Betreiber 2026-10-04, „B“): Er liegt im Gebirge zu jeder
 * Jahreszeit. Null, wenn das Reisemodell keinen nennt.
 */
export function snowlineCondition(model: TravelModel = AVENTURIA_TRAVEL_MODEL): string | null {
    return model.schneegrenze.wert.bodenDarueber ?? null;
}

/**
 * Was der Boden der Jahreszeit an Tempo kostet, in ganzen Prozent (WI-0258, E4): aus der Bodentafel
 * (`jahreszeitBoden.meilen`) der Gruppe zu Fuß und der Kutsche gerechnet, nie abgeschrieben. Verlust = 1 − Wert des
 * Zustands / trocken. `road`: Straße (Weg und Pfad ebenso) bei Nässe oder Schnee; `pass`: Gebirgspass; `soft`, `snow`,
 * `deep`: querfeldein aufgeweicht, verschneit, tief verschneit (und Eis); `coachRoad`, `coachDeep`: die Kutsche auf der
 * Straße und querfeldein im Tiefschnee. Null, wenn die Tafel eines der beiden Mittel nicht kennt.
 */
export function groundLosses(model: TravelModel = AVENTURIA_TRAVEL_MODEL): {
    road: number;
    pass: number;
    soft: number;
    snow: number;
    deep: number;
    coachRoad: number;
    coachDeep: number;
} | null {
    const foot = groundMilesOf(model, "groupFoot");
    const coach = groundMilesOf(model, "horseCarriage");
    if (
        !foot?.["strasse"] ||
        !foot["gebirge"] ||
        !foot["querfeldein"] ||
        !coach?.["strasse"] ||
        !coach["querfeldein"]
    ) {
        return null;
    }
    const loss = (dry: number, wet: number) => Math.round((1 - wet / dry) * 100);
    return {
        road: loss(foot["strasse"].trocken, foot["strasse"].nass),
        pass: loss(foot["gebirge"].trocken, foot["gebirge"].nass),
        soft: loss(foot["querfeldein"].trocken, foot["querfeldein"].nass),
        snow: loss(foot["querfeldein"].trocken, foot["querfeldein"].schnee),
        deep: loss(foot["querfeldein"].trocken, foot["querfeldein"].tief),
        coachRoad: loss(coach["strasse"].trocken, coach["strasse"].nass),
        coachDeep: loss(coach["querfeldein"].trocken, coach["querfeldein"].tief),
    };
}

/** Der Preis der Kutschfahrt je 100 Meilen und Person, in Heller (Geographia S. 119). */
export function coachFare(model: TravelModel = AVENTURIA_TRAVEL_MODEL): number {
    return model.reisekosten.kutsche.wert.je100Meilen;
}

export interface LodgingRow {
    level: LodgingLevel;
    /** Heller je Nacht unter Dach. */
    bed: number;
    /** Heller je Reisetag. */
    food: number;
    /** Das Reittier: Stall je Nacht unter Dach, im Freien Futter je Woche - eine Spalte, zwei Rechnungen. */
    stable: { perNight: number } | { perWeek: number };
    /** Die Veranlagung an EINER Landesgrenze. */
    toll: number;
    /** Die Flusspassage je 100 Meilen stromab. */
    river: number;
    /** Die Seepassage je 100 Meilen (WI-0042 K2). */
    sea: number;
}

/** Die Preise je Person und Unterbringung (Legacy `lodgingCard`, dazu die Seepassage unseres Modells). */
export function lodgingRows(model: TravelModel = AVENTURIA_TRAVEL_MODEL): LodgingRow[] {
    const costs = model.reisekosten;
    return LODGING_LEVELS.map((level) => {
        // Wer im Freien schläft, zahlt keinen Stall, sondern Futter (Kodex S. 475).
        const outdoors = costs.uebernachtung.wert[level] === 0;
        return {
            level,
            bed: costs.uebernachtung.wert[level],
            food: costs.verpflegung.wert[level],
            stable: outdoors
                ? { perWeek: costs.reittier.wert.futterJeWoche }
                : { perNight: costs.reittier.wert.stallJeNacht },
            toll: costs.zoll.wert[level],
            river: costs.flusspassage.wert.je100Meilen[level],
            sea: costs.seepassage.wert.je100Meilen[level],
        };
    });
}

/** Wie viel teurer die Flusspassage stromauf ist (Geographia S. 129). */
export function upstreamFactor(model: TravelModel = AVENTURIA_TRAVEL_MODEL): number {
    return model.reisekosten.flusspassage.wert.stromaufFaktor;
}

/** Ab wie vielen Meilen im Nachbarreich ein Übertritt zählt (Reisemodell `reisekosten.grenzuebertritt`, WI-0065). */
export function minBorderMiles(model: TravelModel = AVENTURIA_TRAVEL_MODEL): number {
    return model.reisekosten.grenzuebertritt.wert.mindestLaufMeilen;
}

/** Die Landwegarten, an denen ein Gasthaus steht - der Rest schläft im Freien. */
export function roofedLandPaths(model: TravelModel = AVENTURIA_TRAVEL_MODEL): string[] {
    const roof = model.reisekosten.dach.wert;
    return LAND_PATH_TYPES.filter((pathType) => roof[pathType] === "gasthaus");
}
