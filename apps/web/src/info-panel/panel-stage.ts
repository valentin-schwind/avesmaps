import type { RouteResponse, RouteStage, RouteStagePoint, SubjectRef } from "@avesmaps3d/shared";
import { formatNumber, t, tPlural } from "../i18n/i18n";
import { airDeviceName } from "../route-planner/air-profiles";
import { formatDateRange, groundLabel, transportLabel } from "../route-planner/planner-model";
import { tenths } from "../route-planner/profile-costs";
import { landscapeTypeLabel, type LandscapeEntry, type TerritoryEntry } from "../route-planner/route-landscapes";
import { airExtraShown, flowWord, miles, slopeShown, slopeText } from "../route-planner/stage-figures";
import { stageLoreRows } from "../route-planner/stage-lore";
import { stageHead } from "../route-planner/stage-metrics";
import { stagePointRef } from "../route-planner/stage-subjects";
import { headerGraphicOfPath } from "./header-graphic";
import { typeLabel } from "./panel-text";
import { sprachenZeile } from "./sprache-model";
import type { PanelEnv, PanelModel, RowModel, RowValue, TextPart } from "./panel-types";

/**
 * Das Modell einer Etappe (WI-0063 4.7, E13, 27.13): Kopf und Feldliste aus der Route des Planers, ohne Abruf des Servers.
 *
 * - **Kopf:** „Etappe n von m“ als Titel, darunter „Von → Bis“; die Pfeile ‹ › der Navigation gehören zu dieser Zeile
 *   (`info-stage-head.vue`). Von und Bis sind Objektlinks, wo das Ende ein Ort (`place_id`) oder ein Kartenpunkt ist; ein Ende ohne Ort
 *   (Abgangs-, Anschlusspunkt, Anlegestelle) bleibt Text. Ohne Etappe in der Route (die Reise wechselt gerade) gibt es keine Pfeile.
 * - **Feldliste:** alles, was der Planer von der Etappe weiß, in seinen Worten und Formaten (`route-planner/stage-figures.ts`). 🔴 Keine
 *   leere Zeile (WI-0063 5.3): Was es nicht gibt (Rast, Reisebeginn, Boden, Steigung, Flugzuschlag, die Abfrage der Landschaften), hat
 *   keine Zeile und keinen Platzhalter. Messwerte sind `measure` (Zahl hell, Einheit gedämpft, Klappbox-Regel).
 * - **Objektlinks** (P8, „Was auf der Karte ist, ist anklickbar“): Landschaften und Gebiete öffnen ihr Subject über dieselbe Naht wie jede
 *   Nennung. Ein Name, der nur die Art einer Landschaft ist („Wald“ für alle namenlosen Wälder der Etappe), ist mehrdeutig und bleibt Text,
 *   ebenso einer ohne Ziel; Wege nennt der Planer nur mit Namen: Text.
 */

const FLIGHT = "Flug";

/** Ab so vielen Gebieten steht die Liste im Deckel (wie Legacys Verlauf: erst ab fünf lohnt das Eindampfen). */
const TERRITORY_LID_MIN = 5;

const upperFirst = (text: string): string => text.charAt(0).toLocaleUpperCase() + text.slice(1);

/** Eine Landschaft öffnet ihre Fläche - wenn der Eintrag ein Ziel hat und mehr als nur die Art nennt (sonst steht er für viele Flächen). */
function landscapeRef(entry: LandscapeEntry): SubjectRef | undefined {
    if (entry.target === null) return undefined;
    const onlyType = entry.art === "" && entry.name === landscapeTypeLabel(entry.type);
    return onlyType ? undefined : { kind: "area", id: entry.key };
}

const territoryRef = (entry: TerritoryEntry): SubjectRef | undefined =>
    entry.id === "" ? undefined : { kind: "territory", id: entry.id };

/**
 * Namen als Liste, jeder ein Link, wo sein Subject feststeht: mit „, “ dazwischen (kurze Namen, die Landschaften) oder Zeile für Zeile
 * (lange Namen, die Gebiete: „Heiliges Neues Kaiserreich vom Greifenthron zu Gareth“ bricht selbst um, und ein Link, der umbricht, füllt die
 * Breite - ein Komma dahinter stünde allein in der nächsten Zeile).
 */
function listParts<T extends { name: string }>(
    entries: readonly T[],
    refOf: (entry: T) => SubjectRef | undefined,
    layout: "inline" | "lines",
): TextPart[] {
    return entries.flatMap((entry, position) => {
        const ref = refOf(entry);
        const part: TextPart = ref === undefined ? { text: entry.name } : { text: entry.name, ref };
        if (position === 0) return [part];
        return layout === "lines" ? [{ ...part, breakBefore: true }] : [{ text: ", " }, part];
    });
}

/** Die Fortbewegung: das Transportmittel, auf dem Fluss mit der Strömung („Flusskahn, flussaufwärts“); im Flug das Flugmittel. */
function movement(stage: RouteStage, env: PanelEnv): string | undefined {
    if (stage.transport === "") return undefined;
    const means =
        stage.type === FLIGHT ? airDeviceName(stage.transport, env.customAirName()) : transportLabel(stage.transport);
    const flow = flowWord(stage);
    return flow === undefined ? means : `${means}, ${flow}`;
}

/** Die Zeilen der Etappe `index`: was der Planer von ihr weiß, in der Reihenfolge seiner Etappenzeile. */
function stageRows(stage: RouteStage, index: number, route: RouteResponse, env: PanelEnv): RowModel[] {
    const rows: RowModel[] = [];
    const text = (key: string, label: string, value: string): void => {
        rows.push({ key, label, value: { kind: "text", text: value } });
    };
    const measure = (key: string, label: string, value: string): void => {
        rows.push({ key, label, value: { kind: "measure", text: value } });
    };
    const lines = env.landscapes();

    text("type", t("infoPanel.stage.type"), typeLabel("path", stage.type));
    if (stage.path_names.length > 0) text("paths", t("infoPanel.stage.paths"), stage.path_names.join(", "));
    const means = movement(stage, env);
    if (means !== undefined) text("transport", t("planner.transport.heading"), means);
    // 🔴 Distanz, Reisezeit und Rastzeit stehen seit WI-0079 als die drei Kacheln über der Feldliste (`stageHead`);
    // hier wiederholt sie keine Zeile mehr (§3: „Die Summary darf diese Zeilen nicht sinnlos doppeln“).
    // Eiltempo (WI-0078 §6a): die Zahlen zur Etappe, nur wo es gegriffen hat - sonst keine Zeile.
    if (stage.hurry) {
        measure(
            "hurry",
            t("planner.hurry"),
            t("infoPanel.stage.hurry.value", {
                miles: formatNumber(stage.hurry.distance_units * route.miles_per_unit, 2),
                total: miles(stage.distance_units * route.miles_per_unit, 2),
                hours: `${formatNumber(stage.hurry.saved_hours, 1)} ${t("unit.hours", { n: "" }).replace("{n}", "").trim()}`,
            }),
        );
    }
    if (stage.start_date !== undefined && stage.end_date !== undefined) {
        text("period", t("infoPanel.stage.period"), formatDateRange(stage.start_date, stage.end_date));
    }
    if (stage.ground !== undefined) {
        measure(
            "ground",
            t("infoPanel.stage.ground"),
            upperFirst(`${groundLabel(stage.ground.condition)} +${formatNumber(stage.ground.percent, 0)}\u00a0%`),
        );
    }
    if (slopeShown(stage.slope)) measure("slope", t("infoPanel.stage.slope"), slopeText(stage.slope));
    if (airExtraShown(stage.air_extra)) {
        measure(
            "airExtra",
            t("infoPanel.stage.airExtra"),
            t("planner.air.extra", { hours: tenths(stage.air_extra.extra_hours) }),
        );
    }
    const landscapes = lines?.stages[index] ?? [];
    if (landscapes.length > 0) {
        rows.push({
            key: "landscapes",
            label: t("infoPanel.stage.landscapes"),
            value: { kind: "parts", parts: listParts(landscapes, landscapeRef, "inline") },
        });
    }
    // Die Sprachen der Etappe stehen zwischen „Derographie“ und „Gebiete“ (WI-0261; Betreiber 2026-10-31: „sprachen soll immer zwischen "Regionen" und
    // "Derographie" bzw. über "Waren, Fauna, ..." in der tabelle gelistet werden“), verlinkt wie in den übrigen Infoboxen, mit Anteil wie an einem Weg.
    const sprachZeile = sprachenZeile(lines?.sprachen?.[index], false);
    if (sprachZeile !== undefined) rows.push(sprachZeile);
    // `null` oder fehlend: keine gültige Ableitung (oder die Abfrage läuft noch) - keine Zeile; leer heißt Niemandsland.
    const territories = lines?.territories?.[index];
    if (territories !== undefined) {
        const label = t("infoPanel.stage.territories");
        if (territories.length === 0) text("territories", label, t("infoPanel.stage.noTerritory"));
        else {
            const parts = listParts(territories, territoryRef, "lines");
            // Eine lange Kette (Reich, Königreich, Dutzende Baronien) steht im Deckel, mit der Zahl auf der Leiste („20 politische Gebiete“).
            const value: RowValue =
                territories.length < TERRITORY_LID_MIN
                    ? { kind: "parts", parts }
                    : {
                          kind: "lid",
                          full: territories.map((entry) => entry.name).join(", "),
                          fullParts: parts,
                          count: territories.length,
                          unit: tPlural("infoPanel.stage.territory", territories.length),
                      };
            rows.push({ key: "territories", label, value });
        }
    }
    /**
     * 🔴 **Die Vorkommen der Etappe, am Ende der Liste** (WI-0106, Betreiber 2026-10-07: „kannst du die lore auch in etappen
     * anzeigen“). Die Etappe selbst ist der Träger: Sie erbt aus allen Flächen, die ihre Wegkette berühren - dieselbe Rechnung
     * wie bei einem Weg (`route-planner/stage-lore.ts`).
     *
     * 🔴 **Der Platz ist Legacys eigener.** Dort steht in der Etappen-Infobox „Führt durch“ und DARUNTER Waren, Fauna, Flora
     * (Owner 2026-08-12, `route-leg-lore-klima.test.js`: „💣 die Klimazone steht UNTER Flora“). Bei uns heißt „Führt durch“
     * Landschaften und politische Gebiete, also stehen die vier Zeilen dahinter - wie am Weg, wo sie seit WI-0103 am Ende
     * stehen. 🪤 Eine Klimazeile hat eine Etappe bei uns nicht; das Klimaband ist ein eigener Gegenstand.
     *
     * 🪤 **`null` heißt „noch nicht“ oder „nicht gelungen“, nie „keine“:** Dann fehlen die Zeilen, ohne Platzhalter - dieselbe
     * Haltung wie bei den Landschaften zwei Zeilen höher. Eine Etappe OHNE Vorkommen gibt es seit dem 2026-10-07 nicht mehr,
     * „Überall in Aventurien“ steht überall; eine leere Antwort wäre also ein Befund, keine leere Liste.
     */
    const lore = env.stageLore(index);
    if (lore !== null) rows.push(...stageLoreRows(lore));
    return rows;
}

/**
 * Eine Etappe liest ihre Zeilen aus der Route des Planers (P5, „Inhalt wie heute“) und ergänzt sie um das, was der Planer sonst nur im Fließtext
 * seiner Etappenzeile nennt. Dazu die Navigation „‹ Von → Bis ›“ (P7, E13): Die Pfeile wählen die vorige und die nächste Etappe, an Anfang
 * und Ende ist der Pfeil gesperrt.
 */
export function stageModel(index: number, route: RouteResponse | null, env: PanelEnv): PanelModel {
    const stage = route?.stages[index];
    const count = route?.stages.length ?? 0;
    const title = t("infoPanel.stage.title", { n: index + 1, m: Math.max(count, index + 1) });
    if (route === null || stage === undefined)
        return { header: { title, subtitle: [], images: [] }, actions: [], rows: [] };
    const named = (point: RouteStagePoint): TextPart => {
        const text = point.name === "" ? t("infoPanel.stage.unnamed") : point.name;
        const ref = stagePointRef(point);
        return ref === undefined ? { text } : { text, ref };
    };
    return {
        header: {
            title,
            // Der Pfeil bleibt am Ende der ersten Zeile hängen (geschütztes Leerzeichen davor): Ein langer Name bricht dahinter oder in sich.
            subtitle: [{ parts: [named(stage.from), { text: "\u00a0→ " }, named(stage.to)] }],
            stageNav: {
                prev: t("infoPanel.stage.prev"),
                next: t("infoPanel.stage.next"),
                hasPrev: index > 0,
                hasNext: index < count - 1,
            },
            graphic: headerGraphicOfPath(stage.type),
            images: [],
            // Die drei Kennzahlen, die Teilstrecke und die geretteten Hinweise der Etappenzeile (WI-0079 §3, §4).
            stageHead: stageHead(stage, route, env.pointNames()),
        },
        actions: [],
        rows: stageRows(stage, index, route, env),
    };
}
