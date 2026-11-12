import type { RouteResponse, RouteStage } from "@avesmaps3d/shared";
import { wert, type Wert } from "../controls/wert";
import { formatNumber, t } from "../i18n/i18n";
import { closureLead, closureNotes, closureReason, closureWayName } from "./closure-notes";
import { STAGE_FIGURE_ICONS } from "./planner-model";
import { miles } from "./stage-figures";

/**
 * Der Kopf einer Etappe im Infopanel (WI-0079 §3, §7a): die leise Teilstrecke, die drei Kennzahlen und die
 * Hinweise, die früher in der Etappenzeile des Planers standen.
 *
 * **Die drei Kacheln** folgen der Bildvorgabe des Betreibers vom 2026-10-05: ein abgerundeter Kasten, darin drei
 * gleich breite Spalten mit feinen senkrechten Strichen; je Spalte Bild, Zahl und Beschriftung. Beschriftet wird
 * wie im Bild (F5 = A): „Meilen“ als Einheit, „Reisezeit“ und „Rastzeit“ als Name der Größe. Die Messung
 * entschied das - die parallele Fassung („Distanz“ · „1.284,36 Meilen“) braucht 160 px und hat 121, und ein Wert
 * bricht in diesem Haus nie um.
 *
 * 🔴 **Die Zahl ist hell, die Einheit gedämpft** (Klappbox-Regel, Guide §16.3), auch wo das Bild beide gleich hell
 * zeigt. Die Bilder sind **Inhaltsbilder** und werden nie umgefärbt (Guide §30.2).
 *
 * **Keine leere Spalte** (WI-0063 §27.13): Eine Etappe ohne Rast hat zwei Spalten, keine dritte mit „0“.
 */

export interface StageFigure {
    key: "distance" | "travel" | "rest";
    icon: string;
    value: Wert;
    label: string;
}

export interface StageHead {
    /** „Teilstrecke 2 von 3 · Hartsteen → Perricum“; fehlt bei einer Reise mit nur zwei Wegpunkten. */
    leg?: string;
    figures: StageFigure[];
    /**
     * Die Hinweise, die der Reiseplan früher in der Etappenzeile trug (WI-0079 §4): der lange
     * Querfeldein-Hinweis und die Sperrhinweise dieser Etappe. Sie stehen hier, weil sie sonst verloren gingen.
     */
    notes: string[];
}

/** Ab so vielen Meilen querfeldein steht der lange Hinweis (Legacy, 20 Einheiten × 3). */
export const LONG_OFFROAD_MILES = 60;

/** Die Wegart der Notverbindungen. */
const OFFROAD = "Querfeldein";

/** Die Einheit eines Formats der Sprachtafel („{n} Meilen“ → „Meilen“); nie abgeschrieben, immer gelesen. */
const unitOf = (key: "unit.miles" | "unit.hours" | "unit.hoursSymbol"): string =>
    t(key, { n: "" }).replace("{n}", "").trim();

/**
 * Die Teilstrecke einer Etappe (§3): nur bei mehr als zwei Wegpunkten, und dann leise.
 *
 * 🔴 **`RouteLeg.from`/`to` sind KEINE Namen** (WI-0087 P9, Befund des Betreibers 2026-10-06: „ein
 * auflösungsproblem der infos unter teilstrecke"). Im Vertrag sind sie schlichte Zeichenketten, und der Server füllt
 * sie mit den **Wegpunktschlüsseln der Anfrage** - `p:<x>:<y>` oder einer UUID. Ungefiltert stand deshalb
 * „Teilstrecke 1 von 3 · p:533.43:547.65 → bf35ed1d-…“ im Kopf. Der frühere Kommentar behauptete das Gegenteil.
 *
 * Aufgelöst wird über dieselbe Quelle wie die Wegpunkteingabe, keine zweite: zuerst die Namen der Kartenpunkte des
 * Planers (`mapPointNames`, „Kartenpunkt bei Rabenfelde“), sonst der Name, den der Server dem Wegpunkt gegeben hat
 * (`route.waypoints`).
 *
 * 🪤 **Lieber keine Zeile als eine Kennung.** Lässt sich ein Schlüssel nicht auflösen, entfällt die Zeile - eine
 * UUID ist für niemanden eine Auskunft.
 */
function legLine(
    stage: RouteStage,
    route: RouteResponse,
    pointNames?: ReadonlyMap<string, string>,
): string | undefined {
    const legs = route.legs.length;
    if (legs < 2) return undefined;
    const leg = route.legs[stage.leg_index];
    if (!leg) return undefined;
    const nameOf = (key: string): string | undefined => {
        const own = pointNames?.get(key);
        if (own !== undefined && own !== "") return own;
        // 🪤 Die Liste kann fehlen (ältere oder unvollständige Antwort); dann bleibt es beim Weglassen der Zeile.
        const waypoint = (route.waypoints ?? []).find((entry) => entry.id === key);
        return waypoint === undefined || waypoint.name === "" ? undefined : waypoint.name;
    };
    const from = nameOf(leg.from);
    const to = nameOf(leg.to);
    if (from === undefined || to === undefined) return undefined;
    return t("infoPanel.stage.leg", {
        n: formatNumber(stage.leg_index + 1, 0),
        m: formatNumber(legs, 0),
        from,
        to,
    });
}

/**
 * Die drei Kennzahlen; die Rastzeit fehlt, wo keine anfällt.
 *
 * 🔴 **Die Beschriftung ist uneinheitlich, und zwar mit Absicht** (F5 = A, die Fassung des Bildes): Die Distanz
 * trägt ihre Einheit in der BESCHRIFTUNG („30,4“ · „Meilen“), die beiden Zeiten in der ZAHL („8,8 h“ ·
 * „Reisezeit“). Gemessen hat das entschieden: Die parallele Fassung („Distanz“ · „1.284,36 Meilen“) braucht
 * 160 px und hat 121 - und ein Wert bricht in diesem Haus nie um.
 */
function figures(stage: RouteStage, route: RouteResponse): StageFigure[] {
    const stunde = unitOf("unit.hoursSymbol");
    const list: StageFigure[] = [
        {
            key: "distance",
            icon: STAGE_FIGURE_ICONS.distance,
            value: wert(formatNumber(stage.distance_units * route.miles_per_unit, 2)),
            label: t("infoPanel.stage.figure.distance"),
        },
        {
            key: "travel",
            icon: STAGE_FIGURE_ICONS.travel,
            value: wert(formatNumber(stage.travel_hours, 1), stunde),
            label: t("infoPanel.stage.figure.travel"),
        },
    ];
    if (stage.rest_hours > 0) {
        list.push({
            key: "rest",
            icon: STAGE_FIGURE_ICONS.rest,
            value: wert(formatNumber(stage.rest_hours, 1), stunde),
            label: t("infoPanel.stage.figure.rest"),
        });
    }
    return list;
}

/**
 * Die Hinweise der Etappe (§4): zuerst die Sperrhinweise - ein Umweg von Tagen ist ohne sie von einem Rechenfehler
 * nicht zu unterscheiden -, dann der lange Querfeldein-Hinweis.
 */
function notesOf(stage: RouteStage, route: RouteResponse): string[] {
    const notes: string[] = [];
    for (const avoided of closureNotes(route).get(stage.index) ?? []) {
        notes.push(`${closureLead(avoided)} ${closureWayName(avoided)} — ${closureReason(avoided)}.`);
    }
    const offroadMiles = stage.distance_units * route.miles_per_unit;
    if (stage.type === OFFROAD && offroadMiles > LONG_OFFROAD_MILES) {
        notes.push(t("infoPanel.stage.offroadLong", { miles: miles(offroadMiles, 2) }));
    }
    return notes;
}

/** Der ganze Kopf einer Etappe; `undefined`, wo es nichts zu zeigen gibt. */
export function stageHead(
    stage: RouteStage,
    route: RouteResponse,
    pointNames?: ReadonlyMap<string, string>,
): StageHead {
    const leg = legLine(stage, route, pointNames);
    return {
        ...(leg === undefined ? {} : { leg }),
        figures: figures(stage, route),
        notes: notesOf(stage, route),
    };
}
