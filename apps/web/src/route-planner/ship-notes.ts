import { AVENTURIA_TRAVEL_MODEL, stageDayHours, type RouteResponse, type TravelModel } from "@avesmaps3d/shared";
import { formatDecimal, formatNumber, isMessageKey, t, tPlural, type MessageKey } from "../i18n/i18n";
import { transportLabel } from "./planner-model";

/**
 * Die Schifffahrtshinweise der Routendetails (WI-0069). Betreiber 2026-10-03: „ich will den klapptext zu
 * "Schifffahrtshinweise" nur haben, wenn auch ein schiff genommen wird. es sollen also nur infos zu schiffen
 * dranstehen. während die reisenden auf einem schiff sind zählt nicht die rastzeit der reisenden, sondern der
 * schiffsbesatzung.“
 *
 * - Nur mit mindestens einer Etappe zu Schiff (Fluss, See, Binnensee); sonst kein Deckel.
 * - Je benutztem Schiff, in der Reihenfolge der ersten Nutzung, jedes einmal: wie lange die Besatzung am Tag fährt
 *   und wie lange sie danach rastet, oder dass sie Tag und Nacht fährt, dann die erklärenden Hinweise zu diesem Schiff
 *   (`SHIP_HINTS`). Davor ein Satz, dass an Bord der Rhythmus der Besatzung gilt. Nichts zu Land und zum Umsteigen.
 * - Die Zahlen kommen aus dem Reisemodell (`stageDayHours`, `nachtfahrt`), nie aus der Sprachtafel. Ein Schiff mit
 *   eigenem Satz (`planner.ships.own.<Kennung>`, etwa die Galeere: gerudert, der Lastensegler: vor Anker oder im
 *   Hafen) nimmt ihn, jedes andere den allgemeinen.
 * - Die Hinweise (Betreiber 2026-10-03, Quelle: Geographia Aventurica, Schifffahrt und Flussfahrt) erklären das Schiff,
 *   ohne Zahl, Preis und Ort. Sie hängen am benutzten Schiff und nur daran, kein Hinweis zu einem Schiff, das die Reise
 *   nicht fährt. Jeder Satz steht höchstens einmal: Teilen mehrere Schiffe denselben Sachverhalt, haben sie einen
 *   gemeinsamen Schlüssel (`oaredCargo`: Flussgaleere und Galeere).
 * - Mit 24 Reisestunden rechnet die Route ohne jede Rast, auch an Bord (`buildRouteStages`): Dann ersetzt dieser Satz
 *   den Satz zur Besatzung und die Zeitzeilen; die Hinweise zu den Schiffen gelten unverändert.
 * - Der Deckel zählt die Zeilen, den Satz zur Besatzung mit, die Zahl vorn wie bei Gebieten und Landschaften
 *   (Betreiber 2026-10-03: „die anzahl der schifffahrtshinweisen ... hier z.b. 3“). Keine zweite Zeile.
 *
 * Keine Vue, kein DOM: Die Sätze entstehen hier, die Übersicht setzt sie als Text. Weder Routing noch Reisezeit noch
 * Reisekosten sind hier berührt; die Funktion liest nur Route und Reisemodell.
 */
export interface ShipNotes {
    /** „3 Schifffahrtshinweise“, „1 Schifffahrtshinweis“. */
    heading: string;
    lines: string[];
}

type ShipRoute = Pick<RouteResponse, "stages" | "hours_per_day">;

const DAY = 24;
const hoursText = (value: number): string => formatDecimal(value, 1);

/**
 * Die erklärenden Hinweise je Schiff, in der Reihenfolge der Anzeige. Ein Satz mit `{name}` nennt sein Schiff, weil
 * er sonst nicht sagt, von wem er spricht; die übrigen nennen es im Satz selbst.
 */
const SHIP_HINTS: Readonly<Record<string, readonly MessageKey[]>> = {
    riverSailer: ["planner.ships.note.sailerWaters"],
    riverBarge: ["planner.ships.note.bargeHelp", "planner.ships.note.bargeSleep"],
    riverGalley: ["planner.ships.note.riverGalley", "planner.ships.note.oaredCargo"],
    cargoShip: ["planner.ships.note.cargoPort"],
    fastShip: ["planner.ships.note.fastComfort"],
    galley: ["planner.ships.note.oaredCargo"],
    courierDromone: ["planner.ships.note.dromone"],
    rowboat: ["planner.ships.note.rowboat"],
};

/** Die benutzten Schiffe in der Reihenfolge ihrer ersten Etappe, jedes einmal. */
function shipsOf(route: ShipRoute, model: TravelModel): string[] {
    const { river, sea } = model.transportmittel.wert;
    const ships = new Set([...river, ...sea]);
    return [...new Set(route.stages.map((stage) => stage.transport).filter((transport) => ships.has(transport)))];
}

function shipLine(model: TravelModel, ship: string, hoursPerDay: number): string {
    const name = transportLabel(ship);
    if (model.nachtfahrt.wert.includes(ship)) return t("planner.ships.nonStop", { name });
    const hours = stageDayHours(model, ship, hoursPerDay);
    const values = { name, hours: hoursText(hours), rest: hoursText(DAY - hours) };
    const own = `planner.ships.own.${ship}`;
    return isMessageKey(own) ? t(own, values) : t("planner.ships.anchor", values);
}

function hintLines(ship: string): string[] {
    const name = transportLabel(ship);
    return (SHIP_HINTS[ship] ?? []).map((key) => t(key, { name }));
}

export function shipNotes(route: ShipRoute, model: TravelModel = AVENTURIA_TRAVEL_MODEL): ShipNotes | null {
    const ships = shipsOf(route, model);
    if (ships.length === 0) return null;
    const noRest = route.hours_per_day >= DAY;
    const lines = noRest
        ? [t("planner.ships.noRest", { hours: hoursText(route.hours_per_day) }), ...ships.flatMap(hintLines)]
        : [
              t("planner.ships.crew"),
              ...ships.flatMap((ship) => [shipLine(model, ship, route.hours_per_day), ...hintLines(ship)]),
          ];
    // Jeder Satz höchstens einmal, auch wenn mehrere Schiffe ihn teilen.
    const unique = [...new Set(lines)];
    const heading = tPlural("planner.ships.heading", unique.length, { n: formatNumber(unique.length, 0) });
    return { heading, lines: unique };
}
