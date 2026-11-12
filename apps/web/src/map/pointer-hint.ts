import { pathReaderName } from "@avesmaps3d/shared";
import { isMessageKey, t, type MessageKey } from "../i18n/i18n";
import { artNebenName, unnamedCandidateLabel, unnamedPathLabel } from "../i18n/unnamed";
import { candidateTypeLabel } from "../route-planner/route-landscapes";
import type { AreaHint } from "./area-selection-input";

/**
 * Das EINE Zeiger-Schild für jede Art des Zeigens (WI-0063 4.5, Guide §15.3): Es ist passiv - Name und Art, optional ein
 * kurzer Hinweis -, ohne Aktionen und ohne Nachladen. Ein Ort, ein Weg - Straße, Pfad, Pass, Fluss oder Bach (WI-0090) -, eine
 * Fläche oder ein Gebiet unter der Maus zeigen dasselbe Schild (`controls/area-hover-chip.vue`, die Hülle `MapTooltip`); ein
 * zweites Zeiger-Schild neben ihm gibt es nicht. Auf Touch gibt es kein Zeigen und deshalb kein Schild.
 *
 * Alles hier ist schon in der Sprache der Seite: Das Schild zeichnet nur.
 */
export interface PointerHint {
    /** Der Name der Stelle; amtliche Namen werden nicht gekürzt und nicht übersetzt. */
    name: string;
    /** Die Art, in der Sprache der Seite; leer, wo es keine gibt. */
    type: string;
    /** Eine zweite, leise Zeile (höchstens ein Halbsatz). */
    note?: string;
    /** Wo der Zeiger steht, in Fensterkoordinaten. */
    screen: { x: number; y: number };
}

/** Die Art eines Orts aus dem Kachel-`subtype` (`dorf`), übersetzt; eine unbekannte heißt „Ort“, nie der rohe Schlüssel. */
export function placeTypeLabel(subtype: string): string {
    const key = `place.${subtype}`;
    return subtype !== "" && isMessageKey(key) ? t(key as MessageKey) : t("search.kind.place");
}

/** Das Schild eines Orts; ohne Namen gibt es keins (ein namenloses Bauwerk hat nichts zu zeigen). */
export function placePointerHint(
    place: { name: string; subtype: string },
    screen: PointerHint["screen"],
): PointerHint | undefined {
    return place.name === "" ? undefined : { name: place.name, type: placeTypeLabel(place.subtype), screen };
}

/**
 * Die Art eines Wegs, in der Sprache der Seite (WI-0090): die Wegart aus derselben Tafel, aus der sie Suche, Planer und
 * Infopanel lesen (`path.<Wegart>`); eine unbekannte heißt „Weg“, nie der rohe Schlüssel. Fluss und Bach behalten ihre
 * gewohnten Wörter - `path.Flussweg` hieße „Flussweg“, und am Zeiger stand dort seit WI-0043 „Fluss“ beziehungsweise „Bach“.
 *
 * 🪤 Das ist DIESELBE Entscheidung, die `candidateTypeLabel` (`route-planner/route-landscapes.ts`) für die Flächenliste
 * trifft - dort aber nur für Flüsse, weil es damals keine anderen anklickbaren Wege gab. Der Weg kommt seit WI-0090 nicht
 * mehr dort vorbei; der Wegzweig jener Funktion ist ein Nebenfund für ihren Eigentümer (WI-0089).
 */
export function pathTypeLabel(subtype: string, bach = false): string {
    if (bach) return t("areaChoice.brook");
    if (subtype === "Flussweg") return t("areaChoice.river");
    const key = `path.${subtype}`;
    return subtype !== "" && isMessageKey(key) ? t(key as MessageKey) : t("search.kind.path");
}

/**
 * Das Schild eines Wegs: sein Name und seine Wegart (WI-0090 § 3.3: „Tooltip wie der Ort“).
 *
 * 🔴 Ein Weg ohne Namen heißt „Unbezeichneter Pfad“ (WI-0105); hier stand der rohe Griff „Pfad-3443“. Der
 * Weg IST anklickbar - die Trefferebenen kennen `label_visible` nicht -, also braucht er auch ein Schild.
 * 🪤 Der Name der Kachel ist roh; die Regel sitzt deshalb hier und nicht beim Kandidaten, dessen Name die
 * Identität der Kette trägt.
 */
export function pathPointerHint(
    path: { name: string | null; type: string; bach?: boolean },
    screen: PointerHint["screen"],
): PointerHint | undefined {
    const raw = path.name?.trim() ?? "";
    if (raw === "") return undefined;
    const bach = path.bach === true;
    return {
        name: pathReaderName(raw, path.type) ?? unnamedPathLabel(path.type, bach),
        type: pathTypeLabel(path.type, bach),
        screen,
    };
}

/** Das Schild einer Kraftlinie: ihr Name und „Kraftlinie“ (WI-0063 P8, Guide P8: Jedes Kartenobjekt ist anklickbar und zeigt sich beim Zeigen). */
export function powerlinePointerHint(line: { name: string }, screen: PointerHint["screen"]): PointerHint | undefined {
    return line.name === "" ? undefined : { name: line.name, type: t("infoPanel.powerline"), screen };
}

/**
 * Das Schild eines Klimabands in der Klimaansicht: sein Name und „Klimazone“ (Legacy: `bindTooltip` der Fläche, L1031).
 *
 * 🪤 Seit WI-0171 steht hier KEINE Bedingung mehr: Der Name kommt aus der Sprachtafel (`climateZoneName`) und
 * ist nie leer - eine Zone, die die Tafel nicht kennt, trägt den Namen des Servers oder ihren lesbaren Schlüssel.
 * Vorher unterdrückte eine Kachel ohne `label` das Schild; dieser Fall wäre jetzt ein Schild mit richtigem Namen.
 */
export function climatePointerHint(zone: { name: string }, screen: PointerHint["screen"]): PointerHint {
    return { name: zone.name, type: t("infoPanel.climate"), screen };
}

/**
 * Das Schild einer Sprache (WI-0261 S5b): ihr Name und „Sprache“; liegt an der Stelle eine zweite, nennt die leise Zeile das Mischgebiet („Mischgebiet mit
 * Orkisch“), denn ein Klick öffnet dann erst die Auswahl.
 */
export function sprachePointerHint(
    sprachen: readonly { name: string }[],
    screen: PointerHint["screen"],
): PointerHint | undefined {
    const [erste, ...andere] = sprachen;
    if (erste === undefined) return undefined;
    return {
        name: erste.name,
        type: t("sprache.art.sprache"),
        ...(andere.length === 0
            ? {}
            : { note: t("sprache.zeiger.misch", { namen: andere.map((sprache) => sprache.name).join(", ") }) }),
        screen,
    };
}

/**
 * Das Schild einer Fläche oder eines Gebiets samt dem Hinweis auf weitere darunter (WI-0043 Stufe 2). Der Weg hat seit
 * WI-0090 sein eigenes (`pathPointerHint`) - und dort keinen Hinweis auf weitere, weil er auch keine Liste hat.
 */
export function areaPointerHint(hint: AreaHint): PointerHint {
    const { candidate } = hint;
    const note = hint.afterCurrent
        ? t("areaHint.next")
        : hint.others === 1
          ? t("areaHint.oneMore")
          : hint.others > 1
            ? t("areaHint.more", { n: hint.others })
            : "";
    // 🔴 Eine Fläche ohne Namen heißt nach ihrer Art (WI-0105; seit OPS-073 „Wald“ statt „Unbezeichneter Wald“) - und dann steht die
    // Art nicht noch einmal dahinter („Wald · Wald“).
    const name = candidate.name ?? unnamedCandidateLabel(candidate);
    return {
        name,
        type: artNebenName(name, candidateTypeLabel(candidate)),
        ...(note === "" ? {} : { note }),
        screen: hint.screen,
    };
}
