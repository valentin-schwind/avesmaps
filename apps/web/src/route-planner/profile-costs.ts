import type { RouteSegment, RouteSlope, RouteSnow } from "@avesmaps3d/shared";
import { formatNumber, t } from "../i18n/i18n";
import { groundLabel } from "./planner-model";

/**
 * Was Steigung und Schnee im Höhenprofil kosten (WI-0049 S5d, WI-0065 Nachtrag 2026-10-04): die Kurzangabe des Schnees im
 * Deckel und der Satz unter der Steigung. Betreiber 2026-10-04 zum Höhenprofil: „kann man hier auch listen, was der
 * tiefschnee kostet (wenn die schneegrenze überschritten wurde)“.
 *
 * - **Was zählt, rechnet der Server** (`route.snow`): die Stunden, um die der Boden der Jahreszeit die Reise verlängert hat,
 *   wo er Schnee oder Eis ist - leichter Schnee, Tiefschnee, Eis. Nässe zählt nicht. Über der Schneegrenze liegt im
 *   Gebirge zu jeder Jahreszeit Tiefschnee, auf dem Teil eines Weges darüber (Betreiber 2026-10-04, „B“); er zählt hier
 *   mit. Für den Schlitten steht seine Zeile in der Bodentafel (im Gebirge 6 Meilen in jedem Zustand): keine Mehrzeit.
 * - **Nur, wenn es etwas zu sagen gibt:** ab drei Minuten, wie die Steigung (gerundet auf Zehntelstunden nicht mehr 0).
 * - **Die Zustände** stehen im Satz in Klammern, mit den Namen der Bodentafel, in der Folge der Reise.
 * - **Keine Anrede**, Regeln unpersönlich (Betreiber).
 */

/** Ab 3 Minuten ist eine Mehrzeit eine Angabe wert. */
export const EXTRA_HOURS_SHOWN = 0.05;

/** Zehntelstunden, ohne Vorzeichen. */
export const tenths = (value: number): string => formatNumber(Math.abs(value), 1);

/** Trägt die Reise Schnee, der eine Angabe wert ist? */
export const snowShown = (snow: RouteSnow | undefined): snow is RouteSnow =>
    snow !== undefined && snow.extra_hours >= EXTRA_HOURS_SHOWN;

/** Das Gefälle oder die Steigung in Prozent, ohne Vorzeichen: „27 %“. */
export const grade = (value: number): string => `${formatNumber(Math.round(Math.abs(value) * 100), 0)} %`;

/** Das Wort dazu: „Steigung“, bei negativem Wert „Gefälle“. */
export const gradeWord = (value: number): string => t(value < 0 ? "planner.slope.word.down" : "planner.slope.word.up");

/**
 * Die Mehrzeit aus Steigung und Schnee ZUSAMMEN (Betreiber 2026-10-04: „+65,8 Std. (bis 27 % Steigung, Schnee)“): mit beidem
 * minus ohne beides, aus den Zahlen der Abschnitte, ohne zweite Routenrechnung.
 *
 * 🔴 Die einfache Summe zählt doppelt: Die Steigung kostet `s` auf dem Boden der Jahreszeit (mit Schnee), der Schnee `n`
 * auf der Steigung (mit Steigung); den gemeinsamen Anteil tragen beide Zahlen. Die Faktoren wirken multiplikativ: mit beidem
 * `T`, ohne Steigung `T − s`, ohne Schnee `T − n = T / Schneefaktor`, ohne beides `(T − s)(T − n) / T`. Also
 * `T − (T − s)(T − n) / T = s + n − s·n / T`. Abschnitte ohne eines von beidem zählen ihre eine Zahl.
 */
export function combinedExtraHours(segments: readonly RouteSegment[]): number {
    let total = 0;
    for (const segment of segments) {
        const slope = segment.slope?.extra_hours ?? 0;
        const snow = segment.snow?.extra_hours ?? 0;
        const time = segment.travel_hours;
        total += slope + snow - (time > 0 ? (slope * snow) / time : 0);
    }
    return total;
}

/**
 * Die Kurzangabe im Deckel „Höhenprofil“ (Betreiber 2026-10-04: „Höhenprofil: +65,8 Std. (bis 27 % Steigung, Schnee)“, eine
 * Zeile; am schmalen Handy ohne das Wort „Steigung“, Antwort „B“: „+72,8 Std. (bis 19 %, Schnee)“): die Mehrzeit aus
 * Steigung und Schnee zusammen, in Klammern, woher sie kommt - „bis 27 %“ nur, wo die Steigung eine Angabe wert ist, „Schnee“
 * nur, wo der Schnee eine ist.
 *
 * **Gefälle bleibt unterscheidbar, mit „↓“ statt des Worts:** Ist die steilste Stelle ein Gefälle, steht „bis 19 % ↓“, derselbe
 * Pfeil wie im Satz darunter („4.160 ↑ · 4.100 ↓ Schritt“, `richtung`). „Gefälle“ (7 Zeichen) machte „+72,8 Std. (bis 19 %
 * Gefälle, Schnee)“ gerade die Strecke zu breit, die der Betreiber als Beispiel nannte, bei 360 px; der Pfeil kostet 9 statt
 * 39 px. Ohne Mehrzeit (keins von beiden eine Angabe wert) steht allein die steilste Stelle mit Wort, wie bisher
 * („Max. 3 % Steigung“); ohne Steigung und Schnee nichts.
 */
export function profileHeadline(
    slope: RouteSlope | undefined,
    snow: RouteSnow | undefined,
    segments: readonly RouteSegment[],
): string {
    const slopeShown = slope !== undefined && slope.extra_hours >= EXTRA_HOURS_SHOWN;
    const snowOn = snowShown(snow);
    if (!slopeShown && !snowOn) {
        return slope
            ? t("planner.profile.summary.max", {
                  grade: grade(slope.steepest_grade),
                  word: gradeWord(slope.steepest_grade),
              })
            : "";
    }
    const causes: string[] = [];
    if (slopeShown) {
        causes.push(
            t(slope.steepest_grade < 0 ? "planner.profile.summary.upToDown" : "planner.profile.summary.upTo", {
                grade: grade(slope.steepest_grade),
            }),
        );
    }
    if (snowOn) causes.push(t("planner.profile.summary.snow"));
    return `${t("planner.profile.summary.hours", { hours: tenths(combinedExtraHours(segments)) })} (${causes.join(", ")})`;
}

/** Die Zustände des Schnees, benannt, in der Folge der Reise: „leichter Schnee, Tiefschnee“. */
const snowStates = (snow: RouteSnow): string => snow.conditions.map(groundLabel).join(", ");

/**
 * Der Satz, was die Reise kostet: „Die Steigung kostet 40,1 Stunden, der Schnee 12,3 Stunden (Tiefschnee).“ Jede Hälfte
 * nur, wenn sie eine Angabe wert ist; ohne beide leer. `slopeHours` fehlt ohne Steigung.
 */
export function profileCosts(slopeHours: number | undefined, snow: RouteSnow | undefined): string {
    const slope = slopeHours !== undefined && slopeHours >= EXTRA_HOURS_SHOWN;
    if (!snowShown(snow)) return slope ? t("planner.slope.summary.costs", { h: tenths(slopeHours) }) : "";
    const s = tenths(snow.extra_hours);
    const states = snowStates(snow);
    return slope
        ? t("planner.slope.summary.costsSnow", { h: tenths(slopeHours), s, states })
        : t("planner.slope.summary.snowCosts", { s, states });
}
