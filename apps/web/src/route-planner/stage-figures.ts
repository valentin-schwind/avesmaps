import type { RouteAirExtra, RouteSlope, RouteStage, RouteStageSlope } from "@avesmaps3d/shared";
import { formatNumber, t } from "../i18n/i18n";
import { EXTRA_HOURS_SHOWN, grade, gradeWord, tenths } from "./profile-costs";

/**
 * Die Zahlen einer Etappe in den Worten des Planers (Reiseübersicht, Design Guide §17.8): EINE Stelle für die Formate, die der Planer in
 * seiner Etappenzeile schreibt und die das Infopanel in der Feldliste einer Etappe wiederholt (WI-0063 27.13). Zwei Fassungen liefen beim
 * nächsten Wechsel eines Worts auseinander. Alles liest die Sprachtafeln beim Aufruf, in der Sprache der Seite.
 */

/** „12,34 Meilen“. */
export const miles = (value: number, digits = 1): string => t("unit.miles", { n: formatNumber(value, digits) });

/** „8,2 Stunden“. */
export const hours = (value: number): string => t("unit.hours", { n: formatNumber(value, 1) });

/** Tage heißen hier Stunden durch 24 - wie Legacy, nicht Reisetage. */
export const days = (value: number, digits = 1): string => t("unit.days", { n: formatNumber(value / 24, digits) });

/** Schritt, gerundet auf 10 („1.540“). */
export const schritt = (value: number): string => formatNumber(Math.round(value / 10) * 10, 0);

/** Was die Steigung einer Etappe oder der Reise kostet: „kostet 1,2 h“. */
export const stageCost = (value: number): string => t("planner.slope.costs", { h: tenths(value) });

/** Ohne Höhen oder ganz eben keine Zeile (Legacy: „nur wenn es etwas zu sagen gibt“). */
export const slopeShown = <T extends RouteStageSlope | RouteSlope>(slope: T | undefined): slope is T =>
    slope !== undefined && (slope.ascent_schritt > 0 || slope.descent_schritt > 0);

/**
 * Der Zuschlag eines Flugs über der Reisehöhe (WI-0051 F4, Betreiber 2026-10-04): „+x Std. über Reisehöhe“, wie an Land die Steigung. Fehlt
 * ohne Höhenmodell, und unter drei Minuten schweigt die Zeile.
 */
export const airExtraShown = (extra: RouteAirExtra | undefined): extra is RouteAirExtra =>
    extra !== undefined && extra.extra_hours >= EXTRA_HOURS_SHOWN;

/** „flussaufwärts“ oder „flussabwärts“; ohne Strömung `undefined`. */
export function flowWord(stage: Pick<RouteStage, "flow_state">): string | undefined {
    if (stage.flow_state === "upstream") return t("planner.flow.upstream");
    if (stage.flow_state === "downstream") return t("planner.flow.downstream");
    return undefined;
}

/**
 * Die Steigung einer Etappe als Satz (Legacys Wortlaut vom Owner 30.07.2026): „max. 21 % Steigung, 1.540 ↑, 810 ↓ Schritt, kostet 1,2 h“.
 * Die Pfeile sind Schrift, nie farbiges Emoji (`U+FE0E`); die Kosten stehen nur ab drei Minuten da.
 */
export function slopeText(slope: RouteStageSlope): string {
    const costs = slope.extra_hours >= EXTRA_HOURS_SHOWN ? `, ${stageCost(slope.extra_hours)}` : "";
    return (
        `${t("planner.slope.max")} ${grade(slope.steepest_grade)} ${gradeWord(slope.steepest_grade)}, ` +
        `${schritt(slope.ascent_schritt)} ↑\uFE0E, ${schritt(slope.descent_schritt)} ↓\uFE0E ${t("planner.slope.unit")}${costs}`
    );
}
