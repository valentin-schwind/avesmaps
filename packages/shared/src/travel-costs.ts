import type { RouteStage, RouteTravelCosts } from "./route.ts";
import { isRestExempt, stageDayHours } from "./route-stages.ts";
import type { BorderCount } from "./travel-borders.ts";
import { CLOCK_START, clockEnter, clockTravel } from "./travel-clock.ts";
import { LODGING_LEVELS, routeDomain, type CostStatus, type LodgingLevel, type TravelModel } from "./travel-model.ts";

/**
 * Die Reisekosten einer Route, je Person (WI-0042; Legacy `route-costs.js`, avesmaps@770c80e). Die
 * Preise stehen im Reisemodell, jeder Posten mit Status und Herkunft (Kap. 6.20).
 *
 * - 💣 **Die Nächte kommen aus derselben Uhr wie Reisebeginn und Etappendaten** (WI-0038, E1): Jede
 *   gebuchte Rast ist eine Nacht, und ihr Dach bestimmt die Wegart, auf der der Reisetag endet. Legacy
 *   zählte „Gesamtstunden durch 24“ und schnitt die Nächte mit dem Reisetag an Land ab, auch auf dem
 *   Wasser mit seinem eigenen Reisetag.
 * - 💣 **Ein Posten ohne Zahl ist `null`, nie 0** (Legacys Drei-Zustände-Regel, Betreiber 2026-09-26
 *   K1): Eine Reise durch drei Reiche sähe sonst zollfrei aus.
 * - Es gibt keine Gruppengröße und kein Reittier-Feld (Legacy-Owner 2026-08-03). Das Tier folgt aus
 *   dem Landtransportmittel.
 * - Gerundet wird je Posten auf ganze Heller; die Summe ist die Summe der gezeigten Posten.
 * - **Zölle** (WI-0065): `zoll[Stufe] × Landesgrenzen`. Die Grenzen zählt `countBorderCrossings` auf den
 *   Herrschaftsgebieten (`travel-borders.ts`) und reicht sie als `borders` herein; ohne sie bleibt der Posten
 *   `null` mit Status `UNKNOWN`, wie bisher. `buildRouteTravelCosts` rechnet alle vier Stufen für das Result des
 *   Servers, der Browser wählt nur eine aus.
 */

/** Die Posten in der Reihenfolge des Kastens; `tolls` steht zuletzt. */
export const TRAVEL_COST_KEYS = ["lodging", "food", "mount", "coach", "river", "sea", "tolls"] as const;
export type TravelCostKey = (typeof TRAVEL_COST_KEYS)[number];

export interface TravelCostRow {
    key: TravelCostKey;
    /** In ganzen Hellern; `null` heißt: nicht ermittelbar (Zölle ohne abgeleitete Gebiete). */
    heller: number | null;
    /** Woher der Preis stammt; `UNKNOWN`, wenn der Betrag fehlt. */
    status: CostStatus;
    /** Was der Posten zählt: Gasthausnächte, Reisetage, Meilen oder Landesgrenzen; bei unbekannten Zöllen 0. */
    count: number;
}

export interface TravelCosts {
    rows: TravelCostRow[];
    /** Die Nächte der Reise nach ihrem Dach. */
    nights: { inn: number; open: number; aboard: number };
    /** Reisetage für die Verpflegung: die Gesamte Reisezeit in Tagen, aufgerundet, mindestens einer. */
    days: number;
    /** Reittiere je Person, aus dem Landtransportmittel (0 oder 1). */
    mounts: number;
    /** Die Summe der bekannten Posten. */
    total: number;
    /** Ob jeder Posten eine Zahl hat; sonst sagt die Summe, was fehlt. */
    complete: boolean;
}

export interface TravelCostOptions {
    lodging: LodgingLevel;
    /** Das Landtransportmittel des Planers: Es bestimmt das Reittier und die Kutschfahrt. */
    landTransport: string;
    /** „Reisestunden pro Tag“ - dieselbe Uhr wie der Reiseplan. */
    hoursPerDay: number;
}

type CostStage = Pick<RouteStage, "type" | "transport" | "flow_state" | "distance_units" | "travel_hours">;

/** Die Nächte einer Reise, jede mit der Wegart, auf der ihr Reisetag endet. */
export function travelNights(model: TravelModel, stages: readonly CostStage[], hoursPerDay: number): string[] {
    const includeRests = hoursPerDay < 24;
    const nights: string[] = [];
    let clock = CLOCK_START;
    let previous: string | null = null;
    for (const stage of stages) {
        const exempt = isRestExempt(model, stage);
        // Wie im Reiseplan: Die Rast eines vollen Tages wird vor dem nächsten Stück gebucht, das reist.
        const entered = exempt || !(stage.travel_hours > 1e-9) ? clock : clockEnter(clock);
        if (entered !== clock) nights.push(previous ?? stage.type);
        const step = clockTravel(
            entered,
            stage.travel_hours,
            stageDayHours(model, stage.transport, hoursPerDay),
            exempt,
            includeRests,
        );
        for (let night = 0; night < step.nights; night += 1) nights.push(stage.type);
        clock = step.clock;
        previous = stage.type;
    }
    return nights;
}

/** Die Zahl der Landesgrenzen, mit der der Zoll rechnet; `null`: nicht ermittelbar. */
type TollBorders = Pick<BorderCount, "count"> | null;

/**
 * Die Reisekosten einer Route für EINE Unterbringungsstufe. `borders`: die Landesgrenzen der Reise
 * (`countBorderCrossings`); fehlt es oder ist es `null`, ist der Zoll nicht ermittelbar (`null`, `UNKNOWN`).
 */
export function buildTravelCosts(
    model: TravelModel,
    route: { stages: readonly CostStage[]; total_hours: number },
    options: TravelCostOptions,
    borders: TollBorders = null,
): TravelCosts {
    return costsFromNights(model, route, options, borders, travelNights(model, route.stages, options.hoursPerDay));
}

function costsFromNights(
    model: TravelModel,
    route: { stages: readonly CostStage[]; total_hours: number },
    options: TravelCostOptions,
    borders: TollBorders,
    nightRoofs: readonly string[],
): TravelCosts {
    const costs = model.reisekosten;
    const { lodging } = options;
    const milesPerUnit = model.meilenJeKarteneinheit.wert;
    const mounts = costs.reittier.wert.jeReisendem[options.landTransport] ?? 0;

    const nights = { inn: 0, open: 0, aboard: 0 };
    for (const type of nightRoofs) {
        const roof = costs.dach.wert[type];
        if (roof === "anBord") nights.aboard += 1;
        else if (roof === "gasthaus" && lodging !== "frei") nights.inn += 1;
        else nights.open += 1;
    }
    const days = Math.max(1, Math.ceil(route.total_hours / 24 - 1e-9));

    let coachMiles = 0;
    let riverDown = 0;
    let riverUp = 0;
    let seaMiles = 0;
    for (const stage of route.stages) {
        const miles = stage.distance_units * milesPerUnit;
        const domain = routeDomain(stage.type);
        if (domain === "river") {
            // Eine unbekannte Strömung zählt als stromab (Legacy).
            if (stage.flow_state === "upstream") riverUp += miles;
            else riverDown += miles;
        } else if (domain === "sea") {
            seaMiles += miles;
        } else if (costs.kutsche.wert.reisemittel.includes(stage.transport)) {
            coachMiles += miles;
        }
    }

    const rows: TravelCostRow[] = [];
    const add = (key: TravelCostKey, heller: number, status: CostStatus, count: number): void => {
        rows.push({ key, heller: Math.round(heller), status, count });
    };

    add("lodging", costs.uebernachtung.wert[lodging] * nights.inn, costs.uebernachtung.status, nights.inn);
    add("food", costs.verpflegung.wert[lodging] * days, costs.verpflegung.status, days);
    if (mounts > 0) {
        const mount = costs.reittier.wert;
        // Wer im Freien schläft, füttert selbst; sonst zahlt er den Stall in jeder Gasthausnacht.
        const keep =
            lodging === "frei" ? mount.futterJeWoche * (days / 7) * mounts : mount.stallJeNacht * nights.inn * mounts;
        add("mount", keep + mount.hufbeschlag * mounts, costs.reittier.status, nights.inn);
    }
    if (coachMiles > 0) {
        add("coach", (coachMiles / 100) * costs.kutsche.wert.je100Meilen, costs.kutsche.status, coachMiles);
    }
    if (riverDown + riverUp > 0) {
        const river = costs.flusspassage.wert;
        const weighted = (riverDown + riverUp * river.stromaufFaktor) / 100;
        // Das Tier fährt zum Kahnpreis mit, auch wenn der Mensch die Kabine nimmt (GA S. 129/131).
        const heller = weighted * river.je100Meilen[lodging] + weighted * river.reittierJe100Meilen * mounts;
        add("river", heller, costs.flusspassage.status, riverDown + riverUp);
    }
    if (seaMiles > 0) {
        const sea = costs.seepassage.wert;
        const heller = (seaMiles / 100) * (sea.je100Meilen[lodging] + sea.reittierJe100Meilen * mounts);
        add("sea", heller, costs.seepassage.status, seaMiles);
    }
    // Die Landesgrenzen zählt der Server auf den Herrschaftsgebieten (WI-0065); ohne sie ist der Posten nicht
    // ermittelbar - `null`, nie 0.
    if (borders === null) {
        rows.push({ key: "tolls", heller: null, status: "UNKNOWN", count: 0 });
    } else {
        add("tolls", costs.zoll.wert[lodging] * borders.count, costs.zoll.status, borders.count);
    }

    const total = rows.reduce((sum, row) => sum + (row.heller ?? 0), 0);
    return { rows, nights, days, mounts, total, complete: rows.every((row) => row.heller !== null) };
}

/**
 * Die Reisekosten für das Result des Servers (`travel_costs`, WI-0065): alle vier Unterbringungsstufen, die Nächte
 * der Reise einmal gerechnet, dazu die Landesgrenzen samt Ort. Der Browser wählt die Stufe und rechnet nichts.
 * `territoryYearBf` ist das Anzeigejahr, für das die Gebiete gelten; ohne Grenzen steht dort `null`.
 */
export function buildRouteTravelCosts(
    model: TravelModel,
    route: { stages: readonly CostStage[]; total_hours: number },
    options: Pick<TravelCostOptions, "landTransport" | "hoursPerDay">,
    borders: BorderCount | null = null,
    territoryYearBf: number | null = null,
): RouteTravelCosts {
    const nightRoofs = travelNights(model, route.stages, options.hoursPerDay);
    const byLodging = {} as Record<LodgingLevel, TravelCosts>;
    for (const lodging of LODGING_LEVELS) {
        byLodging[lodging] = costsFromNights(model, route, { ...options, lodging }, borders, nightRoofs);
    }
    return {
        borders:
            borders === null
                ? null
                : {
                      count: borders.count,
                      harbour_toll_unknown: borders.harbourTollUnknown,
                      crossings: borders.crossings.map((crossing) => ({
                          from: {
                              id: crossing.from.id,
                              name: crossing.from.name,
                              short_name: crossing.from.shortName,
                          },
                          to: { id: crossing.to.id, name: crossing.to.name, short_name: crossing.to.shortName },
                          x: crossing.x,
                          y: crossing.y,
                      })),
                  },
        territory_year_bf: borders === null ? null : territoryYearBf,
        by_lodging: byLodging,
    };
}

/** Heller in Münzen: 1 Dukat = 10 Silbertaler = 100 Heller (Legacy `formatAventurianMoney`). */
export function coinParts(heller: number): { ducats: number; silver: number; heller: number } {
    const total = Math.max(0, Math.round(heller));
    return { ducats: Math.floor(total / 100), silver: Math.floor((total % 100) / 10), heller: total % 10 };
}
