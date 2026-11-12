import {
    routeDomain,
    type PathRef,
    type RouteResponse,
    type RouteStage,
    type RouteStagePoint,
    type SubjectRef,
    type TerritoryRef,
} from "@avesmaps3d/shared";
import { formatNumber, pluralKey, t } from "../i18n/i18n";
import { wert, type Wert } from "../controls/wert";
import { airDeviceIcon, airDeviceName } from "./air-profiles";
import { DOMAIN_ICONS, PATH_ICONS, pathLabel, pointLabel, type Domain } from "./planner-model";
import { stageKindLabel, stagePath, stagePointRef, stageTerritory } from "./stage-subjects";

/**
 * Das Listenmodell der Etappen (WI-0079 P1): reine Daten, kein Vue, kein DOM. Es ordnet die Etappen einer Antwort
 * so, wie der Reiseplan sie zeigt - und nur das; die Antwort selbst bleibt unberührt, Gruppierung ist Darstellung
 * und keine neue Routingsemantik (§7 P1).
 *
 * - **Oberflächenreise:** zusammenhängende Etappen werden nach MEDIUM gruppiert - Landweg, Flussweg, Seefahrt
 *   (§1.1). Land → Fluss → See → Land ergibt vier Blöcke; zwei Landblöcke werden nie zusammengezogen. Ein Wechsel
 *   der Wegart oder des Transportmittels INNERHALB eines Mediums teilt nicht.
 * - **Eine durchgehende Kette** (§1.2): Die Etappen laufen global von 1 bis n, über Gruppen und Stationen hinweg.
 * - **Wegpunkte sind Stationen** (§1.3), abgeleitet aus `leg_index`, und seit WI-0087 P5 **immer ein Eintrag der
 *   obersten Ebene**: Eine Station, die mitten in eine Mediengruppe fällt, TEILT sie in zwei Klappboxen desselben
 *   Mediums - nur so liegt sie „zwischen" den Boxen und kann nicht mit eingeklappt werden. Die Zähler der geteilten
 *   Gruppen zählen je Box, nicht die alte Summe. Es gibt keine zweite Nummerierung je Teilstrecke.
 * - **Flug ist eigenständig** (§1.4): keine Mediengruppen, kein Aufklappen, sondern EIN Listenkopf mit Flugmittel,
 *   Etappenzahl, Distanz und Reisezeit - darunter dieselbe Kette mit denselben Stationen.
 */

/** Die Wegart eines Flugs; sie steht nie in einer Mediengruppe. */
const FLIGHT = "Flug";

/** Ab so vielen Stunden wird eine Dauer in Tagen gesagt - ein ganzer Tag ist in Stunden nicht mehr vorstellbar. */
const DAYS_FROM_HOURS = 24;

/** Was das Eiltempo auf einer Etappe getan hat: auf ihrer ganzen Strecke, auf einem Teil, oder gar nicht. */
export type StageHurryState = "full" | "partial" | null;

export interface StageRowModel {
    /** Die Kennung der Etappe in der Antwort - damit wählen Liste, Karte, Playmode und Panel dieselbe. */
    index: number;
    /** Die durchgehende Nummer in der Perle, 1 bis n. */
    number: number;
    /** Das Bild der Wegart, beim Flug das des Flugmittels; fehlt, wo es keines gibt (eigenes Flugmittel). */
    icon?: string;
    from: RouteStagePoint;
    to: RouteStagePoint;
    fromName: string;
    toName: string;
    /**
     * Die Gegenstände der beiden Enden (WI-0087 P2): Nur mit ihnen ist der Name ein Knopf, der das Infopanel öffnet.
     * 🪤 Ein Ende ohne Ort (`marker`, `exit`, `join`, `landing`) hat keinen - dort bleibt der Name Text (A6).
     */
    fromRef?: SubjectRef;
    toRef?: SubjectRef;
    /** Die Wegart in der Sprache der Seite („Straße“, „Unwegsames Gelände“). */
    typeLabel: string;
    /**
     * Der Name des Weges, über den die Etappe läuft (WI-0087 P1): Er steht in Zeile 2 ANSTELLE der Gattung, sobald es
     * einen echten gibt. Fehlt er, bleibt es bei `typeLabel` - nichts wird erfunden.
     */
    pathName?: string;
    /**
     * Die Wegart hinter dem Namen, in Klammern - aber **nur, wenn der Name sie nicht schon enthält** (WI-0087 P10,
     * Betreiber 2026-10-06: „kannst du bei der nennung des wegnamens auch die typ einblenden, wenn der string vom
     * typ nicht im namen enthalten ist?"):
     *
     * | Fall | Zeile |
     * |---|---|
     * | Art steht nicht im Namen | `Dragenfels-Perainsgarten (Weg) · 8,22 Meilen` |
     * | kein Name | `Straße · 4,29 Meilen` |
     * | Art steht im Namen | `Reichsstraße 3 · 10,89 Meilen` |
     *
     * 🪤 **Ohne Rücksicht auf Groß- und Kleinschreibung verglichen:** „Reichsstraße 3" enthält „Straße" nur klein.
     * Ein Vergleich, der die Schreibung achtet, hängte an jede Reichsstraße ein „(Straße)" - genau der Fall, den der
     * Betreiber ausschließt.
     */
    pathType?: string;
    /** Der Weg als Gegenstand; fehlt er, ist der Name Anzeige und kein Knopf (Befund statt raten). */
    pathRef?: PathRef;
    distance: Wert;
    duration: Wert;
    /** Die Route weicht hier einer Sperre aus (`closures`): die Perle steht im Warnton. */
    closure: boolean;
    hurry: StageHurryState;
    /**
     * Fällt in diese Etappe eine Rast (WI-0087 P8, Betreiber 2026-10-06: „kannst du außerdem eine rast markieren
     * (wie eiltempo als pille?)")? Die Zeile sagt damit nur, DASS gerastet wird - wie lange, steht im Infopanel.
     *
     * 🪤 **Gemessen, nicht angenommen:** `rest_hours` trägt die Stunden der Rast, die vor dieser Etappe fällig wird
     * (Legacys Portionsregel über die ganze Reise). An einer Fußreise Ferdok → Perricum sind es 14 von 36 Etappen;
     * mit Eiltempo tragen **12 von 36 beides**, Rast und Eiltempo - die beiden Pillen stehen also wirklich
     * nebeneinander.
     */
    rest: boolean;
}

export interface StageStationModel {
    point: RouteStagePoint;
    name: string;
    /** „Start“, „Zwischenziel“, „Ziel“. */
    role: string;
    /**
     * Welche Marke die Station trägt (Betreiber 2026-10-05): der Ring für Start und Zwischenziel, die Nadel
     * (Tropfen) für das Ziel - dieselben Zeichen wie in der Wegpunkteingabe (`waypoint-mark.vue`).
     */
    kind: "wegpunkt" | "ziel";
    /** Der Gegenstand des Wegpunkts; ohne ihn ist der Name Text (ein Kartenpunkt hat einen, eine Markierung nicht). */
    ref?: SubjectRef;
    /**
     * Die zweite Zeile (WI-0087 P3): die Ortsklasse und das unterste Gebiet mit Namen, gedämpft, in der Gestalt der
     * Untertitel des Infopanels (Guide §16). Fehlt beides, gibt es keine zweite Zeile - und nie ein leeres „in —“.
     */
    kindLabel?: string;
    territory?: { name: string; ref: TerritoryRef };
}

export interface StageGroupModel {
    /** Ein stabiler Schlüssel über die Lebenszeit einer Antwort: das Medium und die erste Etappe darin. */
    key: string;
    domain: Domain;
    title: string;
    icon: string;
    /** Die Kennzahlen der Gruppe: Zahl der Etappen, Distanz, Reisezeit OHNE Rast (§1.1). */
    meta: Wert[];
    /**
     * Nur Etappenzeilen. 🔴 Seit WI-0087 P5 trägt eine Gruppe KEINE Station mehr: Eine Station teilt die Gruppe,
     * statt in ihr zu liegen - und was nicht in der Gruppe liegt, kann mit ihr nicht verschwinden.
     */
    rows: StageRowModel[];
    /** Die Etappen der Gruppe - damit die Liste weiß, welche Gruppe eine gewählte Etappe trägt (§7 P4). */
    stageIndexes: number[];
}

/** Der Kopf einer Flugliste (§1.4): Flugmittel, Etappenzahl, Distanz, Reisezeit - kein Gruppenkasten. */
export interface StageFlightModel {
    title: string;
    /** Das Bild des Flugmittels; fehlt beim eigenen Flugmittel - dann bleibt die Spalte leer (es gibt kein Bild). */
    icon?: string;
    meta: Wert[];
    rows: (StageRowModel | StageStationModel)[];
}

export type StageListItem =
    | { kind: "station"; station: StageStationModel }
    | { kind: "group"; group: StageGroupModel }
    | { kind: "flight"; flight: StageFlightModel };

export interface StageListModel {
    items: StageListItem[];
    /** Alle Etappen in der Reihenfolge der Liste; die Kette misst an ihnen und das Blättern läuft über sie. */
    rows: StageRowModel[];
}

const isStation = (row: StageRowModel | StageStationModel): row is StageStationModel => "role" in row;
export { isStation };

/** „30,4 Meilen“ als Wert: die Zahl hell, die Einheit gedämpft (Klappbox-Regel, Guide §16.3). */
export function milesValue(units: number, milesPerUnit: number, digits = 2): Wert {
    return wert(formatNumber(units * milesPerUnit, digits), t("unit.miles", { n: "" }).replace("{n}", "").trim());
}

/**
 * Eine Dauer als Wert: unter einem Tag in Stunden („2,3 Std.“), darüber in Tagen („2,4 Tage“). Die kurze Einheit
 * hält Zeile 2 knapp; sie steht im Haus schon in jedem Deckel.
 */
export function durationValue(hours: number): Wert {
    if (hours >= DAYS_FROM_HOURS) {
        return wert(formatNumber(hours / 24, 1), t("unit.days", { n: "" }).replace("{n}", "").trim());
    }
    return wert(formatNumber(hours, 1), t("unit.hoursShort", { n: "" }).replace("{n}", "").trim());
}

/** Die Zahl der Etappen als Wert („3 Etappen“, „1 Etappe“). */
function stageCountValue(count: number): Wert {
    const key = pluralKey("planner.summary.legCount", count);
    return wert(formatNumber(count, 0), t(key, { n: "" }).replace("{n}", "").trim());
}

/** Was das Eiltempo auf dieser Etappe getan hat; `null`, wo es nicht gegriffen hat. */
export function stageHurryState(stage: RouteStage): StageHurryState {
    const hurry = stage.hurry;
    if (!hurry || !(hurry.distance_units > 0)) return null;
    // Auf Hundertstelmeilen genau - die Anzeige rundet dort, und ein Rest darunter wäre kein Unterschied.
    return hurry.distance_units >= stage.distance_units - 1e-9 ? "full" : "partial";
}

/** Das Bild einer Etappe: die Wegart, im Flug das Flugmittel - ein eigenes das neutrale Bild. */
export function stageIcon(stage: RouteStage): string | undefined {
    if (stage.type !== FLIGHT) return PATH_ICONS[stage.type] ?? PATH_ICONS["Weg"];
    // 🔴 Kein Rückfall auf das erste Profil: Ein eigenes Flugmittel als Hexenflug zu zeichnen wäre eine Behauptung
    // (Befund WI-0079 §8a). Seit dem 2026-10-05 gibt es das neutrale Bild „Eigenes Fluggerät“.
    return airDeviceIcon(stage.transport);
}

export interface StageListOptions {
    /** Wie die Kartenpunkte im Planer heißen („Kartenpunkt bei Gareth“), nach Kennung. */
    pointNames: ReadonlyMap<string, string>;
    /** Wie das eigene Flugmittel heißt; leer heißt „Eigenes Flugmittel“. */
    customAirName?: string;
    /** Die Etappen, an denen die Route einer Sperre ausweicht (`closureNotes`). */
    closures: ReadonlySet<number>;
}

/**
 * Nennt der Name die Wegart schon selbst (WI-0087 P10)? Verglichen wird **ohne Rücksicht auf die Schreibung**:
 * „Reichsstraße 3" enthält „Straße", nur klein geschrieben. Gilt in beiden Sprachen, denn beide Seiten kommen aus
 * derselben Sprachtafel.
 */
function namesType(name: string, type: string): boolean {
    if (type === "") return true;
    return name.toLocaleLowerCase().includes(type.toLocaleLowerCase());
}

function rowOf(stage: RouteStage, number: number, route: RouteResponse, options: StageListOptions): StageRowModel {
    const icon = stageIcon(stage);
    const fromRef = stagePointRef(stage.from);
    const toRef = stagePointRef(stage.to);
    const path = stagePath(stage, route);
    return {
        index: stage.index,
        number,
        ...(icon === undefined ? {} : { icon }),
        from: stage.from,
        to: stage.to,
        fromName: pointLabel(stage.from, options.pointNames),
        toName: pointLabel(stage.to, options.pointNames),
        ...(fromRef === undefined ? {} : { fromRef }),
        ...(toRef === undefined ? {} : { toRef }),
        ...(path === undefined
            ? {}
            : {
                  pathName: path.name,
                  ...(path.ref === undefined ? {} : { pathRef: path.ref }),
                  ...(namesType(path.name, pathLabel(stage.type)) ? {} : { pathType: pathLabel(stage.type) }),
              }),
        typeLabel:
            stage.type === FLIGHT
                ? `${pathLabel(FLIGHT)} ${t("planner.leg.flightWith", { name: airDeviceName(stage.transport, options.customAirName ?? "") })}`
                : pathLabel(stage.type),
        distance: milesValue(stage.distance_units, route.miles_per_unit),
        duration: durationValue(stage.travel_hours),
        closure: options.closures.has(stage.index),
        hurry: stageHurryState(stage),
        // Auf Hundertstelstunden genau: Ein Rest darunter wäre keine Rast, sondern ein Rundungsrest.
        rest: stage.rest_hours > 0.01,
    };
}

/**
 * Die Stationen der Reise aus `leg_index`: vor der ersten Etappe jeder Teilstrecke steht ihr Wegpunkt, nach der
 * letzten Etappe das Ziel. Die Namen kommen aus den Etappenenden - also aus den Objekten, die der Server benannt
 * hat; nie aus einem Namensvergleich.
 */
function stationOf(
    point: RouteStagePoint,
    role: string,
    kind: StageStationModel["kind"],
    options: StageListOptions,
): StageStationModel {
    const ref = stagePointRef(point);
    const kindLabel = stageKindLabel(point);
    const territory = stageTerritory(point);
    return {
        point,
        name: pointLabel(point, options.pointNames),
        role,
        kind,
        ...(ref === undefined ? {} : { ref }),
        ...(kindLabel === undefined ? {} : { kindLabel }),
        ...(territory === undefined ? {} : { territory }),
    };
}

function stationsByStage(stages: readonly RouteStage[], options: StageListOptions): Map<number, StageStationModel> {
    const stations = new Map<number, StageStationModel>();
    let leg = -1;
    stages.forEach((stage, position) => {
        if (stage.leg_index === leg) return;
        leg = stage.leg_index;
        const role = t(position === 0 ? "planner.stages.station.start" : "planner.stages.station.via");
        stations.set(position, stationOf(stage.from, role, "wegpunkt", options));
    });
    return stations;
}

function endStation(stages: readonly RouteStage[], options: StageListOptions): StageStationModel | null {
    const last = stages[stages.length - 1];
    if (!last) return null;
    return stationOf(last.to, t("planner.stages.station.end"), "ziel", options);
}

const metaOf = (count: number, units: number, hours: number, milesPerUnit: number): Wert[] => [
    stageCountValue(count),
    milesValue(units, milesPerUnit),
    durationValue(hours),
];

/** Die Liste einer Reise: Oberfläche mit Mediengruppen, Flug als eigene Liste. */
export function stageListModel(route: RouteResponse, options: StageListOptions): StageListModel {
    const stages = route.stages;
    const rows: StageRowModel[] = [];
    const items: StageListItem[] = [];
    if (stages.length === 0) return { items, rows };

    const stations = stationsByStage(stages, options);
    const flight = stages.every((stage) => stage.type === FLIGHT);

    if (flight) {
        const first = stages[0] as RouteStage;
        const icon = stageIcon(first);
        const body: (StageRowModel | StageStationModel)[] = [];
        stages.forEach((stage, position) => {
            const station = stations.get(position);
            // Die Station vor der ersten Etappe ist der Start; sie steht VOR dem Kopf, wie bei der Oberfläche.
            if (station && position > 0) body.push(station);
            const row = rowOf(stage, rows.length + 1, route, options);
            rows.push(row);
            body.push(row);
        });
        const start = stations.get(0);
        if (start) items.push({ kind: "station", station: start });
        items.push({
            kind: "flight",
            flight: {
                title: t("planner.stages.flight", {
                    name: airDeviceName(first.transport, options.customAirName ?? ""),
                }),
                ...(icon === undefined ? {} : { icon }),
                meta: metaOf(
                    stages.length,
                    stages.reduce((sum, stage) => sum + stage.distance_units, 0),
                    stages.reduce((sum, stage) => sum + stage.travel_hours, 0),
                    route.miles_per_unit,
                ),
                rows: body,
            },
        });
        const end = endStation(stages, options);
        if (end) items.push({ kind: "station", station: end });
        return { items, rows };
    }

    let open: { domain: Domain; group: StageGroupModel; units: number; hours: number } | null = null;
    const close = (): void => {
        if (!open) return;
        open.group.meta = metaOf(open.group.stageIndexes.length, open.units, open.hours, route.miles_per_unit);
        items.push({ kind: "group", group: open.group });
        open = null;
    };

    stages.forEach((stage, position) => {
        const domain = routeDomain(stage.type);
        const station = stations.get(position);
        // 🔴 Eine Station ist IMMER ein Eintrag der obersten Ebene (WI-0087 P5, Betreiber 2026-10-05: „die sollen ganz
        // normal zwischen den klappboxen liegen und können nicht eingeklappt werden"). Ein Medienwechsel schließt die
        // Gruppe - und eine Station tut es ebenso: Trifft sie mitten in eine Mediengruppe, TEILT sie sie in zwei
        // Klappboxen desselben Mediums. Das ist die einzige Form, in der sie „zwischen" den Boxen liegen kann.
        // 🪤 Vorher stand sie im Rumpf der Gruppe und verschwand mit ihr; genau das war der gemeldete Fehler.
        if (open && (open.domain !== domain || station !== undefined)) close();
        if (station) items.push({ kind: "station", station });
        if (!open) {
            open = {
                domain,
                units: 0,
                hours: 0,
                group: {
                    key: `${domain}-${String(stage.index)}`,
                    domain,
                    title: t(`planner.stages.group.${domain}`),
                    icon: DOMAIN_ICONS[domain],
                    meta: [],
                    rows: [],
                    stageIndexes: [],
                },
            };
        }
        const current = open as NonNullable<typeof open>;
        const row = rowOf(stage, rows.length + 1, route, options);
        rows.push(row);
        current.group.rows.push(row);
        current.group.stageIndexes.push(stage.index);
        current.units += stage.distance_units;
        current.hours += stage.travel_hours;
    });
    close();
    const end = endStation(stages, options);
    if (end) items.push({ kind: "station", station: end });
    return { items, rows };
}
