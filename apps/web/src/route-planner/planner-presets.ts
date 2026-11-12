import { isDepartureMonth, isLodgingLevel, type KartenEinstellungen } from "@avesmaps3d/shared";
import { startansicht } from "../map/start-view";
import { AIR_PROFILES, copyAirChoice, DEFAULT_AIR_CHOICE, type AirChoice } from "./air-profiles";
import {
    clampStartDay,
    copyOptions,
    DEFAULT_OPTIONS,
    TRANSPORTS,
    type PlannerOptions,
    type TravelMode,
} from "./planner-model";

/**
 * Womit der Routenplaner einen neuen Besuch beginnt (WI-0166, Panel „Routenplaner“ der Karteneinstellungen; Betreiber
 * 2026-10-15: „so dass alte Links gleich bleiben“).
 *
 * 🔴 **Zwei Vorgaben, und jede hat ihren Ort.**
 * - Die **Voreinstellung** hier gilt nur für einen Besuch, dessen Adresse KEINE Angabe des Planers trägt
 *   (`tragtPlanerangaben` in `planner-link.ts`). Sie kommt aus der Systemsteuerung (`map/start-view.ts`).
 * - Die **feste Vorgabe** im Code (`DEFAULT_OPTIONS`, `DEFAULT_AIR_CHOICE`, Reiseart „Land & Wasser“) bleibt die Grundlage
 *   jedes Links: Adresse und Kurzlink schreiben nur die Abweichung von ihr, und gelesen wird gegen sie. Ein alter Link ohne
 *   `landTransport` heißt also weiter „zu Fuß“, auch wenn die Voreinstellung heute „Pferd“ sagt.
 *
 * Ein Wert, den der Planer nicht (mehr) kennt, fällt auf die feste Vorgabe zurück; erfunden wird nichts.
 */

export interface PlanerStart {
    options: PlannerOptions;
    mode: TravelMode;
    air: AirChoice;
}

const FLUGMITTEL = new Set<string>(AIR_PROFILES.map((profile) => profile.id));

export function planerVoreinstellung(werte: KartenEinstellungen = startansicht()): PlanerStart {
    const options = copyOptions(DEFAULT_OPTIONS);
    if (werte.planerRoutenwahl === "fastest" || werte.planerRoutenwahl === "shortest") {
        options.optimize = werte.planerRoutenwahl;
    }
    options.minimizeTransfers = werte.planerUmstiegeMinimieren;
    options.hurry = werte.planerEiltempo;
    options.enabled = {
        land: werte.planerLandErlaubt,
        river: werte.planerFlussErlaubt,
        sea: werte.planerMeerErlaubt,
    };
    const mittel = (domain: keyof PlannerOptions["transports"], wert: string): string =>
        TRANSPORTS[domain].includes(wert) ? wert : DEFAULT_OPTIONS.transports[domain];
    options.transports = {
        land: mittel("land", werte.planerLandTransport),
        river: mittel("river", werte.planerFlussTransport),
        sea: mittel("sea", werte.planerMeerTransport),
    };
    options.hoursPerDay = werte.planerReisestunden;
    const beginn = werte.planerReisebeginn;
    options.departure =
        beginn !== "unbestimmt" && isDepartureMonth(beginn.monat)
            ? { month: beginn.monat, day: clampStartDay(beginn.tag, beginn.monat) }
            : null;
    options.lodging = isLodgingLevel(werte.planerUnterbringung) ? werte.planerUnterbringung : DEFAULT_OPTIONS.lodging;
    const air = copyAirChoice(DEFAULT_AIR_CHOICE);
    if (FLUGMITTEL.has(werte.planerFlugmittel)) air.profile = werte.planerFlugmittel as AirChoice["profile"];
    return { options, mode: werte.planerReiseart === "air" ? "air" : "surface", air };
}
