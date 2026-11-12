import type { LodgingLevel, RouteCosts, RouteResponse } from "@avesmaps3d/shared";
import type { MessageKey } from "../i18n/de";
import { t, tPlural } from "../i18n/i18n";
import type { Wert } from "../controls/wert";
import { formatMoney, formatNumber, moneyCoins, type PlannerOptions } from "./planner-model";

/**
 * Die Zeilen des Kastens „Reisekosten je Person“ (WI-0042; Legacy `route-plan.js`,
 * `renderRoutePlanTravelCosts`): Posten, Betrag in Münzen, Vermerk.
 *
 * 🔴 **Der Browser rechnet nichts** (WI-0065, Hardening Review M3 „B′“). Der Server liefert die Kosten aller vier
 * Unterbringungsstufen im Result (`travel_costs`); hier wird nur die gewählte Stufe ausgesucht und in Worte gefasst. Ein
 * Wechsel der Unterbringung braucht deshalb keine neue Anfrage - und die Zahlen im Kasten gehören immer zu der Route,
 * die gerade steht, auch während sie neu gerechnet wird: Ein Wechsel der Reisestunden oder des Landmittels ändert den
 * Kasten erst mit der Antwort.
 *
 * Fehlt `travel_costs` (Flug, ein älterer Server, eine Antwort ohne Route), gibt es keinen Kasten - keine Zahl ist
 * besser als eine geratene (Plan 6.20: nichts erfinden).
 *
 * **Hinweise sind Fußnoten** (Betreiber 2026-10-04): Was zu einem Wert gehört, hängt als hochgestellte Zahl an ihm und steht
 * unten im Kasten, statt als Satz zwischen den Zeilen. Die Nummern vergibt `footnoteNumbering` in der Reihenfolge des ersten
 * Auftretens von oben nach unten.
 */

/** Ein Übertritt in der Liste unter der Zollzeile: von wo nach wo, in Fahrtrichtung, und an welchem Punkt der Karte. */
export interface BorderStep {
    /** Kurznamen für die Zeile; die vollen Namen stehen als Hinweistext daneben (Namen werden nicht übersetzt). */
    from: string;
    to: string;
    fromTitle: string;
    toTitle: string;
    /** Wo der Übertritt liegt, in Kartenkoordinaten (`aventuria-v1`): der erste Punkt im neuen Reich. */
    x: number;
    y: number;
}

/** Die Landesgrenzen der Reise; nur da, wo es welche gibt - bei 0 Grenzen und „nicht ermittelbar“ keine Liste. */
export interface BorderList {
    count: number;
    steps: BorderStep[];
}

/**
 * Ein Betrag für die Oberfläche: die Münzstellen einzeln, damit sie die Zahl hervorhebt und die Einheit dämpft (eine Regel
 * für jeden Betrag im Kasten, Design Guide §16.3). Ohne Münzen - null Heller („—“) oder nicht ermittelbar („?“) - steht
 * nur `text`.
 */
export interface CostAmount {
    text: string;
    coins: Wert[];
}

/** Welche Fußnote an einem Wert hängt: die Quellen der Preise und die Gründe für Nächte ohne Gasthaus. */
export type FootnoteKey = "source" | "open" | "aboard" | "geographia";

export interface CostFootnote {
    number: number;
    key: FootnoteKey;
    text: string;
}

/** Eine Unterzeile der Übernachtung: je Dach eine, „8 × im Gemeinschaftszimmer: 4 S 8 H ¹“, „12 × im Freien ²“. */
export interface CostNightLine {
    kind: "inn" | "open" | "aboard" | "none";
    text: string;
    /** Nur bei den Nächten im Gasthaus: Die anderen kosten nichts. Der Betrag steht in der Zeile nur einmal. */
    amount: CostAmount | null;
    footnote: number | null;
}

export interface CostLine {
    key: RouteCosts["rows"][number]["key"];
    label: string;
    value: string;
    amount: CostAmount;
    /** Die Herleitung unter dem Betrag; bei der Übernachtung leer, dort stehen die Unterzeilen in `nights`. */
    note: string;
    /** Die Nummer der Fußnote, die an der Herleitung hängt; sonst `null`. */
    footnote: number | null;
    /** Ein Zusatz in eigener Zeile unter dem Vermerk (Zölle: „Hafenzoll nicht beziffert“); sonst `null`. */
    extra: string | null;
    /** Der Betrag fehlt (Zölle ohne abgeleitete Gebiete): leise gesetzt, nie als 0. */
    unknown: boolean;
    /** Nur bei der Übernachtung: die Nächte nach ihrem Dach (Betreiber 2026-10-04); sonst `null`. */
    nights: CostNightLine[] | null;
}

export interface CostView {
    lines: CostLine[];
    total: string;
    totalAmount: CostAmount;
    totalNote: string;
    /** Die Kopfzeile des Kastens: nur der Betrag (Betreiber 2026-10-03), „15 D 2 S 6 H“; die Nächte stehen bei der Übernachtung. */
    summary: string;
    borders: BorderList | null;
    /** Die Fußnoten unten im Kasten, nur die zu gezeigten Zeilen, in der Reihenfolge ihrer Nummern. */
    footnotes: CostFootnote[];
}

/** Die Kosten der gewählten Unterbringung aus der Antwort des Servers; `null`, wenn sie keine trägt. */
export function travelCosts(route: RouteResponse, options: Pick<PlannerOptions, "lodging">): RouteCosts | null {
    return route.travel_costs?.by_lodging[options.lodging] ?? null;
}

const FOOTNOTE_TEXT: Record<FootnoteKey, MessageKey> = {
    source: "planner.cost.fn.source",
    open: "planner.cost.fn.open",
    aboard: "planner.cost.fn.aboard",
    geographia: "planner.cost.fn.geographia",
};

/**
 * Die Nummern der Fußnoten. 🔴 Nummeriert wird in der Reihenfolge des ersten Auftretens, von oben nach unten: Wer `cite`
 * zuerst ruft, bekommt die 1. Derselbe Hinweis behält überall seine Nummer (die Quelle der Preise hängt an Gasthaus,
 * Verpflegung und Reittier und bleibt die ¹), und es gibt nur Nummern für Hinweise, die jemand zitiert hat - eine Reise
 * ohne Schiff zeigt keine Fußnote zur Koje.
 */
export function footnoteNumbering(): { cite: (key: FootnoteKey) => number; notes: () => CostFootnote[] } {
    const order: FootnoteKey[] = [];
    return {
        cite(key) {
            const known = order.indexOf(key);
            if (known >= 0) return known + 1;
            order.push(key);
            return order.length;
        },
        notes: () => order.map((key, index) => ({ number: index + 1, key, text: t(FOOTNOTE_TEXT[key]) })),
    };
}

/** Der Betrag einer Zeile als Münzstellen oder, ohne Münze, als Text. */
const amountOf = (heller: number): CostAmount => ({ text: formatMoney(heller), coins: moneyCoins(heller) });
const unknownAmount = (): CostAmount => ({ text: t("planner.cost.tolls.unknown"), coins: [] });

/** Welcher Posten welche Quelle nennt: Preise im Gasthaus, Essen und Futter das Regelwerk, Zölle und Passagen die Geographia. */
const ROW_SOURCE: Partial<Record<RouteCosts["rows"][number]["key"], FootnoteKey>> = {
    food: "source",
    mount: "source",
    coach: "geographia",
    river: "geographia",
    sea: "geographia",
    tolls: "geographia",
};

/** „8 × im Gemeinschaftszimmer“: Wo das Gasthaus liegt, steht in der Stufe; bei „im Freien/Zelt“ gibt es keine Gasthausnacht. */
const INN_NIGHTS: Record<LodgingLevel, MessageKey> = {
    frei: "planner.cost.night.open",
    strohsack: "planner.cost.night.inn.strohsack",
    bett: "planner.cost.night.inn.bett",
    zimmer: "planner.cost.night.inn.zimmer",
};

/**
 * Die Unterzeilen der Übernachtung, je Dach eine (Betreiber 2026-10-04: „8 × im Gemeinschaftszimmer: 4 S 8 H ¹“, „12 × im
 * Freien ²“). 🔴 Bezahlt werden nur die Nächte im Gasthaus; die im Freien kosten nichts, die an Bord stecken in der
 * Passage. Der Betrag steht deshalb nur an der Zeile der Gasthausnächte. Der Grund für Nächte im Freien hängt als Fußnote
 * an ihnen - außer bei „im Freien/Zelt“, dort ist es die Wahl und nichts zu erklären.
 */
function nightLines(
    costs: RouteCosts,
    lodging: LodgingLevel,
    heller: number | null,
    cite: (key: FootnoteKey) => number,
): CostNightLine[] {
    const { inn, open, aboard } = costs.nights;
    if (inn + open + aboard === 0) {
        return [{ kind: "none", text: t("planner.cost.lodging.noNight"), amount: null, footnote: null }];
    }
    const lines: CostNightLine[] = [];
    if (inn > 0) {
        lines.push({
            kind: "inn",
            text: t(INN_NIGHTS[lodging], { n: formatNumber(inn, 0) }),
            amount: heller === null ? unknownAmount() : amountOf(heller),
            footnote: cite("source"),
        });
    }
    if (open > 0) {
        lines.push({
            kind: "open",
            text: t("planner.cost.night.open", { n: formatNumber(open, 0) }),
            amount: null,
            footnote: lodging === "frei" ? null : cite("open"),
        });
    }
    if (aboard > 0) {
        lines.push({
            kind: "aboard",
            text: t("planner.cost.night.aboard", { n: formatNumber(aboard, 0) }),
            amount: null,
            footnote: cite("aboard"),
        });
    }
    return lines;
}

const miles = (value: number): string => t("planner.cost.miles", { n: formatNumber(value, 1) });

/** „2 Landesgrenzen, als Söldner veranlagt“ (Legacy), in der Einzahl „1 Landesgrenze“. */
function tollNote(count: number, lodging: LodgingLevel): string {
    const how = t(`planner.cost.toll.${lodging}`);
    return tPlural("planner.cost.tolls.note", count, { n: formatNumber(count, 0), how });
}

/** Die Herleitung unter dem Betrag und ihr Zusatz; die Übernachtung hat statt dessen Unterzeilen (`nightLines`). */
function note(
    row: RouteCosts["rows"][number],
    route: RouteResponse,
    lodging: LodgingLevel,
): { note: string; extra: string | null } {
    switch (row.key) {
        case "lodging":
            return { note: "", extra: null };
        case "food":
            return {
                note: tPlural("planner.cost.food.note", row.count, { n: formatNumber(row.count, 0) }),
                extra: null,
            };
        case "mount":
            // Je Person genau EIN Tier - deshalb ohne Zahl (Legacy: „1 Tiere“ wäre die Folge).
            return {
                note:
                    lodging === "frei"
                        ? t("planner.cost.mounts.own")
                        : t("planner.cost.mounts.stable", { n: formatNumber(row.count, 0) }),
                extra: null,
            };
        case "tolls": {
            const borders = route.travel_costs?.borders ?? null;
            // Drei Zustände, nie zwei (Legacy, K1): Eine Zahl, oder „hier nicht ermittelbar“ - nie 0 an ihrer Stelle.
            if (borders === null || row.heller === null) {
                return { note: t("planner.cost.tolls.undetermined"), extra: null };
            }
            return {
                note: tollNote(row.count, lodging),
                // Z1 A+: Wer zu Schiff von einem Reich ins andere fährt, zahlt nach der Quelle Hafenzoll, aber keine
                // Zahl steht da: Der Hinweis hält die Lücke sichtbar.
                extra: borders.harbour_toll_unknown ? t("planner.cost.tolls.harbour") : null,
            };
        }
        default:
            return { note: miles(row.count), extra: null };
    }
}

const LABELS: Record<RouteCosts["rows"][number]["key"], MessageKey> = {
    lodging: "planner.cost.lodging",
    food: "planner.cost.food",
    mount: "planner.cost.mounts",
    coach: "planner.cost.coach",
    river: "planner.cost.river",
    sea: "planner.cost.sea",
    tolls: "planner.cost.tolls",
};

/** Die Übertritte in Fahrtrichtung, mit Kurznamen; ohne Grenzen keine Liste. */
function borderList(route: RouteResponse): BorderList | null {
    const borders = route.travel_costs?.borders ?? null;
    if (borders === null || borders.count === 0) return null;
    return {
        count: borders.count,
        steps: borders.crossings.map((crossing) => ({
            from: crossing.from.short_name,
            to: crossing.to.short_name,
            fromTitle: crossing.from.name,
            toTitle: crossing.to.name,
            x: crossing.x,
            y: crossing.y,
        })),
    };
}

/** Der Kasten zur Route und zur gewählten Unterbringung; `null`, wenn die Antwort keine Kosten trägt. */
export function costView(route: RouteResponse, options: Pick<PlannerOptions, "lodging">): CostView | null {
    const costs = travelCosts(route, options);
    if (!costs) return null;
    const { lodging } = options;
    const nights = costs.nights.inn + costs.nights.open + costs.nights.aboard;
    // Die Zeilen entstehen von oben nach unten, so wie sie stehen: Die Reihenfolge der `cite`-Aufrufe ist die der Nummern.
    const numbering = footnoteNumbering();
    const lines = costs.rows.map((row): CostLine => {
        const { note: text, extra } = note(row, route, lodging);
        const source = ROW_SOURCE[row.key];
        const isLodging = row.key === "lodging";
        const amount = row.heller === null ? unknownAmount() : amountOf(row.heller);
        return {
            key: row.key,
            label: t(LABELS[row.key]),
            value: amount.text,
            amount,
            note: text,
            nights: isLodging ? nightLines(costs, lodging, row.heller, numbering.cite) : null,
            footnote: source ? numbering.cite(source) : null,
            extra,
            unknown: row.heller === null,
        };
    });
    const count = { n: formatNumber(nights, 0), d: formatNumber(costs.days, 0) };
    const mounted = costs.mounts > 0;
    // Fehlt ein Posten, sagt die Summe es - eine Teilsumme darf nicht wie die ganze aussehen.
    const withTolls = (party: string): string =>
        costs.complete ? party : t("planner.cost.total.withoutTolls", { party });
    const total = formatMoney(costs.total);
    return {
        lines,
        total,
        totalAmount: amountOf(costs.total),
        totalNote: withTolls(t(mounted ? "planner.cost.party.mounted" : "planner.cost.party", count)),
        summary: withTolls(total),
        borders: borderList(route),
        footnotes: numbering.notes(),
    };
}
