import type { RouteResponse } from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import { pathLabel, type PlannerOptions } from "./planner-model";

/**
 * Die Einstellungszeile unter dem Reisetitel der Übersicht (Betreiber 2026-10-04, nachdem eine Route auf „Kürzeste Route“
 * quer über die Ogerzähne lief: „könnte man einen one line unter den reisetitel in der reiseübersicht mit den wichtigsten
 * einstellungen?“). Sie sagt auf einen Blick, womit gerechnet wurde, soweit es die Route wählt.
 *
 * Keine Vue, kein DOM, kein neuer Server-Parameter: Sie leitet sich aus den Optionen des Planers ab und aus der Antwort,
 * soweit nur sie weiß, ob die Reise ein Flug ist. Alle Wörter stehen schon in den Sprachtafeln, kein neuer Schlüssel.
 *
 * Die Regel, getrennt mit „ · “ wie in den zugeklappten Leisten des Planers: **die Art der Route**, „Schnellste Route“ oder
 * „Kürzeste Route“, dazu „Umsteigen minimieren“, wenn an.
 *
 * **Der Flug** (Antwort mit `air`) kennt weder Routenart noch Umsteigen (die Routen-API ignoriert sie): Dort steht „Flug“ an
 * der Stelle der Routenart.
 *
 * 🔴 **Nicht in der Zeile**, alles auf Wunsch des Betreibers (2026-10-04) oder weil es die Route nicht wählt:
 * - **Transportmittel** („Die Einstellungszeile unter dem Reisetitel ist zu lang - die transportmittel kannst du weglassen“):
 *   weder das Mittel je Domäne noch „ohne Meer“ noch das Flugmittel. Sie stehen in der zugeklappten Leiste „Transportmittel“
 *   und im Etappenplan („Flug mit Greif“).
 * - **Reisebeginn** („einstellungszelle: A aber datum braucht es nicht, da steht schon drunter“): Die Kennzahlen darunter
 *   nennen „Abreise“ und „Ankunft“.
 * - **Reisestunden pro Tag** („lasst das 8.0/Tag auch weg, steht ja ein paar zeilen drüber“): Die zugeklappte Leiste
 *   „Reiseoptionen“ nennt sie.
 * - **Unterbringung:** Sie ändert nie die Route, nur die Kosten, und die nennt der Kasten „Reisekosten je Person“.
 */
export const SETTINGS_SEPARATOR = " · ";

type SettingsRoute = Pick<RouteResponse, "air" | "hurry">;

/** Die Teile der Zeile, in der Sprache der Seite: im Flug „Flug“, sonst die Routenart und, wenn an, „Umsteigen minimieren“. */
export function settingsParts(route: SettingsRoute, options: PlannerOptions): string[] {
    if (route.air) return [pathLabel("Flug")];
    const parts = [t(options.optimize === "shortest" ? "planner.route.shortest" : "planner.route.fastest")];
    if (options.minimizeTransfers) parts.push(t("planner.minimizeTransfers"));
    // Eiltempo (WI-0078, Betreiber 2026-10-05): Es wählt die Route nicht, aber es ändert ihre Zeit - und was die
    // Zahlen darunter erklärt, gehört in diese Zeile. Im Flug gibt es kein Eiltempo, also nennt sie es dort nie
    // (der Zweig oben hat schon verlassen); hinten angehängt wie im Kasten „Transportmittel“ (F7 = B).
    // 🔴 Der Schalter sagt, was gewollt ist; die Antwort sagt, ob es ging. Trägt keine Etappe das Eiltempo, nennt
    // die Zeile das (Betreiber 2026-10-06: „Eiltempo nicht möglich (in der einstellungsleiste)"), sonst stünde
    // dort eine Einstellung, die nichts bewirkt hat. Dieselbe Bedingung wie der Deckel in
    // `route-overview.vue`, damit Zeile und Deckel nie Verschiedenes behaupten.
    if (options.hurry) {
        const wirkt = route.hurry !== undefined && route.hurry.saved_hours > 0;
        parts.push(t(wirkt ? "planner.hurry" : "planner.hurry.impossible"));
    }
    return parts;
}

/** Die ganze Zeile als ein Text: auch der `title` und, was ein Vorleser liest, wenn die Anzeige am Ende kürzt. */
export function settingsLine(route: SettingsRoute, options: PlannerOptions): string {
    return settingsParts(route, options).join(SETTINGS_SEPARATOR);
}
