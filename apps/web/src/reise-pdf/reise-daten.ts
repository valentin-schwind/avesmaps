import {
    calendarDate,
    dayOfYear,
    routeDomain,
    type RouteDate,
    type RouteResponse,
    type RouteStage,
    type RouteStagePoint,
    type RouteUnterwegsEintrag,
} from "@avesmaps3d/shared";
import { formatNumber, t, tPlural } from "../i18n/i18n";
import { elevationChartData, hasElevationProfile, profileLines } from "../route-planner/elevation-profile-model";
import { surfaceTone, type SurfaceTone } from "../route-planner/elevation-profile-surfaces";
import {
    formatDate,
    formatDateRange,
    groundLabel,
    monthName,
    optionsSummary,
    pointLabel,
    seasonLabel,
    transportLabel,
    transportSummary,
    type Domain,
    type PlannerOptions,
} from "../route-planner/planner-model";
import { grade, gradeWord, profileCosts, tenths, EXTRA_HOURS_SHOWN } from "../route-planner/profile-costs";
import type { LandscapeLines, TerritoryEntry } from "../route-planner/route-landscapes";
import { settingsParts } from "../route-planner/route-settings-line";
import { shipNotes } from "../route-planner/ship-notes";
import { airExtraShown, days, hours, miles, schritt, slopeShown, flowWord } from "../route-planner/stage-figures";
import {
    isStation,
    stageListModel,
    type StageRowModel,
    type StageStationModel,
} from "../route-planner/stage-list-model";
import { territoryHierarchy } from "../route-planner/territory-hierarchy";
import { costView } from "../route-planner/travel-cost-view";
import { unterwegsGruppen } from "../route-planner/unterwegs";
import type { Wert } from "../controls/wert";
import type { PdfWorte } from "./dokument";
import { dateiAusVorlage, type Inhalt, type Zusatz } from "./einstellungen";
import { rastNachEtappe, reisetage, type Reisetag } from "./reise-tage";

/**
 * Was das PDF über eine Reise sagt (WI-0306), als fertige Texte in der Sprache, in der es gerufen wird (`inSprache`). 🔴 Nur aus dem, was der
 * Planer schon hat (keine neue Frage an den Server): die Route, die Landschaften und Gebiete je Etappe, die Vorkommen unterwegs. Die Wörter
 * und Formate sind die des Planers (`stage-figures.ts`, `planner-model.ts`, `travel-cost-view.ts`, `ship-notes.ts`, `stage-list-model.ts`);
 * neu sind nur die Sätze, die es im Planer nicht gibt (Präfix `reisePdf.`). Keine Vue, kein DOM: `dokument.ts` setzt daraus das PDF.
 */

export interface ReiseEingabe {
    route: RouteResponse;
    options: PlannerOptions;
    pointNames: ReadonlyMap<string, string>;
    customAirName?: string | undefined;
    landscapes: LandscapeLines | null;
    unterwegs: readonly RouteUnterwegsEintrag[] | null;
    /** Die Vorlage des Dateinamens aus den Standardwerten (`{von}`, `{bis}`); leer heißt der Satz der Sprachtafel. */
    dateiVorlage?: string | undefined;
}

export interface Kennzeile {
    label: string;
    wert: string;
    notiz: string;
    gesamt?: boolean;
}

export interface Station {
    name: string;
    rolle: string;
    /** Ortsklasse und Gebiet: „Metropole · in Alt-Gareth“; leer, wo nichts bekannt ist. */
    wo: string;
    /** Wann man dort ist; leer ohne Reisebeginn. */
    datum: string;
    /** Die Mittel der Strecke NACH dieser Station (Land, Fluss, See), ohne Wiederholung; leer am Ziel. */
    strecke: Domain[];
}

/** Ein „Dazu“ einer Etappe oder eines Abschnitts: Bezeichnung, Wert und ein leiser Zusatz in Klammern. */
export interface DazuTeil {
    art: Zusatz;
    label: string;
    wert: string;
    leise?: string;
}

export interface EtappenZeile {
    nr: number;
    von: string;
    nach: string;
    weg: string;
    datum: string;
    meilen: string;
    zeit: string;
    rast: string;
    dazu: DazuTeil[];
}

export interface Abschnitt {
    domain: Domain;
    titel: string;
    meta: string;
    namen: string;
    datum: string;
    etappen: EtappenZeile[];
    dazu: DazuTeil[];
}

export type VerlaufEintrag = { art: "station"; station: Station } | { art: "abschnitt"; abschnitt: Abschnitt };

export type ProfilTon = SurfaceTone | "air";

export interface ProfilDaten {
    satz: string;
    laeufe: { ton: ProfilTon; punkte: [number, number][] }[];
    /** Meilen der ganzen Reise. */
    distanz: number;
    hoechste: number;
    stationen: { meile: number; name: string }[];
    bereich: string;
}

export interface KostenZeile {
    label: string;
    betrag: string;
    notiz: string;
    fussnote: number | null;
    extra: string | null;
    naechte: { text: string; betrag: string | null; fussnote: number | null }[] | null;
    grenzen: string[] | null;
    unbekannt: boolean;
}

export interface KostenDaten {
    zeilen: KostenZeile[];
    summe: { label: string; betrag: string; notiz: string };
    fussnoten: { nummer: number; text: string }[];
}

export interface UnterwegsSpalte {
    titel: string;
    zahl: string;
    eintraege: { name: string; wo: string }[];
    weitere: string | null;
}

export interface TagebuchTag {
    gross: string;
    klein: string;
    was: string;
    wege: string;
    nacht: string;
}

export interface ReiseDaten {
    von: string;
    bis: string;
    titel: string;
    datei: string;
    zeitraum: string;
    kopfRechts: string;
    stationen: Station[];
    kennzahlen: { links: Kennzeile[]; rechts: Kennzeile[] };
    kostenSumme: string | null;
    gerechnet: string;
    verlaufUnter: string;
    /** Die Überschrift der Datumsspalte: der Monat, wenn alle Etappen in ihm liegen, sonst „Datum“; `null` ohne Reisebeginn. */
    datumSpalte: string | null;
    verlauf: VerlaufEintrag[];
    profil: ProfilDaten | null;
    kosten: KostenDaten | null;
    schiffe: { titel: string; zeilen: string[] } | null;
    gebiete: { gegenden: string[]; sprachen: string[]; gebiete: string[] } | null;
    unterwegs: UnterwegsSpalte[] | null;
    tage: TagebuchTag[];
}

/** So viele Einträge je Art nennt „Vorkommen unterwegs“, der Rest steht als „und 109 weitere“ da (Entwurf). */
export const UNTERWEGS_JE_ART = 8;
/** Höchstens so viele Punkte je Lauf trägt das Höhenprofil ins PDF; es bleibt ein Vektor und das PDF klein. */
const PROFIL_PUNKTE = 320;

const wertText = (w: Wert): string => `${w.zahl}${w.abstand}${w.einheit}`;
const einmal = <T>(liste: readonly T[]): T[] => [...new Set(liste)];
/** Höchstens `max` Namen, der Rest als „und 12 weitere“: Eine Flussfahrt kreuzt Dutzende Baronien, die Zeile soll lesbar bleiben. */
function kappe(namen: readonly string[], max: number): string {
    const rest = namen.length - max;
    return rest > 0
        ? `${namen.slice(0, max).join(", ")} ${t("reisePdf.pdf.weitere", { n: formatNumber(rest, 0) })}`
        : namen.join(", ");
}
/** So viele Namen nennt eine Zeile „Dazu“: je Etappe weniger als je Abschnitt. */
const DAZU_NAMEN = { etappe: { gegend: 6, gebiet: 3 }, abschnitt: { gegend: 8, gebiet: 4 } } as const;
const prozent = (anteil: number): string => `${formatNumber(Math.round(anteil * 100), 0)} %`;

/** „Die Reise von Gareth über Elenvina nach Havena“, in den Wörtern des Planers. */
export function reiseTitel(namen: readonly string[]): string {
    const erster = namen[0] ?? "";
    const letzter = namen[namen.length - 1] ?? "";
    const ueber = namen
        .slice(1, -1)
        .map((name) => ` ${t("planner.journey.via")} ${name}`)
        .join("");
    return `${t("planner.journey.from")} ${erster}${ueber} ${t("planner.journey.to")} ${letzter}`;
}

/** Der Planer-Link der Reise: die Adresse ohne Hash, mit nur den Angaben des Planers (ohne den Kurzlink `s`). */
export function planerLink(
    adresse: { origin: string; pathname: string; search: string },
    planer: readonly string[],
): string {
    const alle = new URLSearchParams(adresse.search);
    const eigen = new URLSearchParams();
    for (const [schluessel, wert] of alle)
        if (schluessel !== "s" && planer.includes(schluessel)) eigen.append(schluessel, wert);
    const query = eigen.toString().replaceAll("%7E", "~");
    return `${adresse.origin}${adresse.pathname}${query === "" ? "" : `?${query}`}`;
}

function startTag(datum: RouteDate): number {
    return datum.nameless || datum.month === "" ? 360 + datum.day : dayOfYear(datum.month, datum.day);
}

/** Das tiefste Gebiet einer Etappe und das Reich darüber: die Blätter der Kette, in Klammern das Gebiet unter der obersten Krone. */
export function gebietDerEtappe(eintraege: readonly TerritoryEntry[]): { gebiet: string; reich: string } | null {
    if (eintraege.length === 0) return null;
    const ids = new Set(eintraege.map((e) => e.id));
    const eltern = new Set(eintraege.map((e) => e.parentId).filter((id): id is string => typeof id === "string"));
    const blaetter = eintraege.filter((e) => !eltern.has(e.id));
    const tiefe = (eintrag: TerritoryEntry): TerritoryEntry[] => {
        const kette: TerritoryEntry[] = [eintrag];
        let jetzt = eintrag;
        while (jetzt.parentId && ids.has(jetzt.parentId) && kette.length < 16) {
            const vater = eintraege.find((e) => e.id === jetzt.parentId);
            if (vater === undefined || kette.includes(vater)) break;
            kette.unshift(vater);
            jetzt = vater;
        }
        return kette;
    };
    const reiche = einmal(
        blaetter
            .map((blatt) => {
                const kette = tiefe(blatt);
                return kette.length >= 3 ? kette[1]?.name : kette.length === 2 ? kette[0]?.name : undefined;
            })
            .filter((name): name is string => name !== undefined && name !== ""),
    );
    return { gebiet: einmal(blaetter.map((b) => b.name)).join(", "), reich: reiche.join(", ") };
}

/** Die Steigung einer Etappe oder eines Abschnitts als Satz ohne Pfeile (die Hausschrift hat keine). */
function hoeheSatz(steilste: number, auf: number, ab: number, mehr: number): string {
    const satz = t("reisePdf.pdf.hoehe", {
        grad: grade(steilste),
        wort: gradeWord(steilste),
        auf: schritt(auf),
        ab: schritt(ab),
    });
    return mehr >= EXTRA_HOURS_SHOWN ? `${satz}, ${t("planner.slope.costs", { h: tenths(mehr) })}` : satz;
}

interface EtappenWissen {
    gegenden: string[];
    gebiet: { gebiet: string; reich: string } | null;
    sprachen: { name: string; anteil: number }[];
    neu: RouteUnterwegsEintrag[];
}

function neuSatz(neu: readonly RouteUnterwegsEintrag[]): string {
    const gruppen = unterwegsGruppen(neu);
    const zahlen = gruppen
        .map((g) => tPlural(`infoPanel.lore.${g.kind}.short`, g.zeilen.length, { n: formatNumber(g.zeilen.length, 0) }))
        .join(", ");
    const namen = gruppen.map((g) => g.zeilen[0]?.name).filter((name): name is string => name !== undefined);
    return namen.length === 0 ? zahlen : `${zahlen} (${namen.join(", ")} …)`;
}

/** Die „Dazu“-Teile über eine oder mehrere Etappen (je Etappe eine, je Abschnitt alle zusammengefasst). */
function dazuTeile(stages: readonly RouteStage[], wissen: readonly EtappenWissen[]): DazuTeil[] {
    const teile: DazuTeil[] = [];
    const grenze = wissen.length === 1 ? DAZU_NAMEN.etappe : DAZU_NAMEN.abschnitt;
    const gegenden = einmal(wissen.flatMap((w) => w.gegenden));
    if (gegenden.length > 0)
        teile.push({ art: "gegend", label: t("reisePdf.dazu.gegend"), wert: kappe(gegenden, grenze.gegend) });
    const gebiete = wissen.map((w) => w.gebiet).filter((g): g is NonNullable<typeof g> => g !== null);
    if (gebiete.length > 0) {
        const reich = einmal(gebiete.flatMap((g) => (g.reich === "" ? [] : g.reich.split(", ")))).join(", ");
        teile.push({
            art: "gebiet",
            label: t("reisePdf.dazu.gebiet"),
            wert: kappe(einmal(gebiete.flatMap((g) => g.gebiet.split(", "))), grenze.gebiet),
            ...(reich === "" ? {} : { leise: reich }),
        });
    }
    const sprachen = wissen.flatMap((w) => w.sprachen);
    if (sprachen.length > 0) {
        const wert =
            wissen.length === 1
                ? sprachen.map((s) => `${s.name} ${prozent(s.anteil)}`).join(", ")
                : einmal(sprachen.map((s) => s.name)).join(", ");
        teile.push({ art: "sprache", label: t("reisePdf.dazu.sprache"), wert });
    }
    const boeden = stages.map((s) => s.ground).filter((g): g is NonNullable<typeof g> => g !== undefined);
    if (boeden.length > 0) {
        const staerkster = boeden.reduce((a, b) => (b.percent > a.percent ? b : a));
        // „Aufgeweichter Boden +20 %“: Der Name des Bodens ist schon die Bezeichnung (`groundLabel`).
        const boden = groundLabel(staerkster.condition);
        teile.push({
            art: "gelaende",
            label: boden.charAt(0).toLocaleUpperCase() + boden.slice(1),
            wert: `+${formatNumber(staerkster.percent, 0)}\u00a0%`,
        });
    }
    const steigungen = stages.map((s) => s.slope).filter(slopeShown);
    if (steigungen.length > 0) {
        const steilste = steigungen.reduce((a, b) => (Math.abs(b.steepest_grade) > Math.abs(a.steepest_grade) ? b : a));
        const auf = steigungen.reduce((sum, s) => sum + s.ascent_schritt, 0);
        const ab = steigungen.reduce((sum, s) => sum + s.descent_schritt, 0);
        const mehr = steigungen.reduce((sum, s) => sum + s.extra_hours, 0);
        if (Math.abs(steilste.steepest_grade) >= 0.01 || mehr >= EXTRA_HOURS_SHOWN) {
            teile.push({
                art: "gelaende",
                label: t("reisePdf.pdf.hoeheLabel"),
                wert: hoeheSatz(steilste.steepest_grade, auf, ab, mehr),
            });
        }
    }
    const fahrten = einmal(
        stages
            .filter((s) => routeDomain(s.type) !== "land" && s.transport !== "")
            .map((s) => {
                const fluss = flowWord(s);
                return fluss === undefined ? transportLabel(s.transport) : `${transportLabel(s.transport)}, ${fluss}`;
            }),
    );
    if (fahrten.length > 0) teile.push({ art: "gelaende", label: t("reisePdf.pdf.fahrt"), wert: fahrten.join(" · ") });
    const neu = wissen.flatMap((w) => w.neu);
    if (neu.length > 0) teile.push({ art: "neu", label: t("reisePdf.dazu.neu"), wert: neuSatz(neu) });
    return teile;
}

function stationText(station: StageStationModel): string {
    const teile: string[] = [];
    if (station.kindLabel) teile.push(station.kindLabel);
    if (station.territory) teile.push(t("infoPanel.inTerritory", { name: station.territory.name }));
    return teile.join(" · ");
}

function zeileWeg(row: StageRowModel): string {
    if (row.pathName === undefined) return row.typeLabel;
    return row.pathType === undefined ? row.pathName : `${row.pathName} (${row.pathType})`;
}

/** Die Tage einer Etappe für die Datumsspalte: „7.–9.“, wenn alle im selben Monat liegen; sonst ausgeschrieben. */
function etappenDatum(stage: RouteStage, kurz: boolean): string {
    if (stage.start_date === undefined || stage.end_date === undefined) return "";
    if (!kurz) return formatDateRange(stage.start_date, stage.end_date);
    const a = stage.start_date.day;
    const b = stage.end_date.day;
    return a === b ? `${String(a)}.` : `${String(a)}.–${String(b)}.`;
}

function einMonat(stages: readonly RouteStage[]): RouteDate | null {
    const erstes = stages[0]?.start_date;
    if (erstes === undefined || erstes.nameless || erstes.month === "") return null;
    const gleich = (d: RouteDate | undefined): boolean =>
        d !== undefined && !d.nameless && d.month === erstes.month && d.years_passed === erstes.years_passed;
    return stages.every((s) => gleich(s.start_date) && gleich(s.end_date)) ? erstes : null;
}

/** Höchstens `n` Punkte, gleichmäßig verteilt, erster und letzter bleiben. */
function duenne(punkte: readonly [number, number][], n: number): [number, number][] {
    if (punkte.length <= n) return [...punkte];
    const aus: [number, number][] = [];
    const schritt = (punkte.length - 1) / (n - 1);
    for (let i = 0; i < n; i += 1) aus.push(punkte[Math.round(i * schritt)]!);
    return aus;
}

function profilDaten(route: RouteResponse, stationen: readonly { meile: number; name: string }[]): ProfilDaten | null {
    const zeichnet = hasElevationProfile(route);
    const slope = route.slope;
    if (!zeichnet && slope === undefined && !airExtraShown(route.air_extra)) return null;
    const saetze: string[] = [];
    if (slope !== undefined) {
        const kopf = t("planner.slope.summary.head", {
            word: gradeWord(slope.steepest_grade),
            grade: grade(slope.steepest_grade),
        });
        const steigung = t("reisePdf.pdf.profilSteigung", {
            auf: schritt(slope.ascent_schritt),
            ab: schritt(slope.descent_schritt),
        });
        const hoechster = t("planner.slope.summary.highest", { n: schritt(slope.highest_schritt) });
        saetze.push(`${kopf} (${steigung}), ${hoechster}.`);
    }
    const kosten = profileCosts(slope?.extra_hours, route.snow);
    if (kosten !== "") saetze.push(kosten);
    if (airExtraShown(route.air_extra)) {
        saetze.push(
            t("planner.air.extra.summary", {
                hours: tenths(route.air_extra.extra_hours),
                peak: schritt(route.air_extra.peak_schritt),
            }),
        );
    }
    const daten = elevationChartData(route);
    const laeufe: ProfilDaten["laeufe"] = zeichnet
        ? daten.runs.map((lauf) => ({ ton: surfaceTone(lauf.kind), punkte: duenne(lauf.points, PROFIL_PUNKTE) }))
        : [];
    for (const linie of profileLines(daten.air)) {
        laeufe.push({ ton: "air", punkte: duenne(linie as [number, number][], PROFIL_PUNKTE) });
    }
    const hoechste = laeufe.reduce((max, lauf) => lauf.punkte.reduce((m, [, h]) => Math.max(m, h), max), 0);
    return {
        satz: saetze.join(" "),
        laeufe,
        distanz: daten.distance,
        hoechste,
        stationen: [...stationen],
        bereich: t("reisePdf.pdf.profilBereich", { meilen: miles(daten.distance) }),
    };
}

function kostenDaten(route: RouteResponse, options: PlannerOptions): KostenDaten | null {
    const sicht = costView(route, options);
    if (sicht === null) return null;
    return {
        zeilen: sicht.lines.map((zeile) => ({
            label: zeile.label,
            betrag: zeile.amount.text,
            notiz: zeile.note,
            fussnote: zeile.footnote,
            extra: zeile.extra,
            unbekannt: zeile.unknown,
            naechte:
                zeile.nights?.map((n) => ({ text: n.text, betrag: n.amount?.text ?? null, fussnote: n.footnote })) ??
                null,
            grenzen:
                zeile.key === "tolls" && sicht.borders !== null
                    ? sicht.borders.steps.map((s) => `${s.from} – ${s.to}`)
                    : null,
        })),
        summe: { label: t("planner.cost.total"), betrag: sicht.total, notiz: sicht.totalNote },
        fussnoten: sicht.footnotes.map((f) => ({ nummer: f.number, text: f.text })),
    };
}

function tagebuch(
    route: RouteResponse,
    options: PlannerOptions,
    pointNames: ReadonlyMap<string, string>,
): TagebuchTag[] {
    const tage = reisetage(route, options.lodging);
    const abreise = route.departure;
    const name = (punkt: RouteStagePoint | undefined): string => (punkt ? pointLabel(punkt, pointNames) : "");
    const wegName = (stage: RouteStage): string => stage.path_names[0] ?? transportLabel(stage.transport);
    let vorher: RouteStage | undefined;
    return tage.map((tag: Reisetag) => {
        const datum = abreise ? calendarDate(startTag(abreise), tag.tag * 24) : undefined;
        const gross = datum ? `${String(datum.day)}.` : t("reisePdf.pdf.tag", { n: tag.tag + 1 });
        const klein = datum
            ? datum.nameless || datum.month === ""
                ? t("planner.calendar.nameless")
                : monthName(datum.month)
            : "";
        // Die Etappen des Tages von ihrem Anfang bis zu ihrem Ziel; eine lange Fahrt, die heute beginnt, „weiter: …“; ein Tag auf ihr „Unterwegs: …“,
        // ihr letzter „… bis Havena“. Ohne Etappe ein Rasttag am Ort des Vortags.
        const erste = tag.etappen[0] ?? tag.weiter;
        const letzte = tag.etappen[tag.etappen.length - 1];
        let was: string;
        if (erste !== undefined) {
            const teile = letzte === undefined ? [name(erste.from)] : [`${name(erste.from)} – ${name(letzte.to)}`];
            if (tag.weiter !== undefined) teile.push(t("reisePdf.pdf.weiterAuf", { weg: wegName(tag.weiter) }));
            was = teile.join(", ");
        } else if (tag.ueber !== undefined) {
            was = tag.ankunftUeber
                ? t("reisePdf.pdf.aufBis", { weg: wegName(tag.ueber), ort: name(tag.ueber.to) })
                : t("reisePdf.pdf.unterwegsAuf", { weg: wegName(tag.ueber) });
        } else {
            was = t("reisePdf.pdf.rastIn", { ort: name(vorher?.to) });
        }
        const eigene = [...tag.etappen, ...(tag.weiter ? [tag.weiter] : []), ...(tag.ueber ? [tag.ueber] : [])];
        const wege = einmal(eigene.flatMap((stage) => stage.path_names))
            .slice(0, 3)
            .join(", ");
        vorher = tag.weiter ?? letzte ?? tag.ueber ?? vorher;
        const nacht = tag.nacht === undefined ? t("reisePdf.pdf.ankunft") : t(`reisePdf.pdf.nacht.${tag.nacht}`);
        return { gross, klein, was, wege, nacht };
    });
}

/** Alles, was das PDF über die Reise sagt, in der Sprache, in der es gerufen wird. */
export function reiseDaten(eingabe: ReiseEingabe): ReiseDaten {
    const { route, options, pointNames, landscapes } = eingabe;
    const stages = route.stages;
    const modell = stageListModel(route, {
        pointNames,
        ...(eingabe.customAirName === undefined ? {} : { customAirName: eingabe.customAirName }),
        closures: new Set<number>(),
    });
    const namen = route.waypoints.map((w) => pointNames.get(w.id) ?? w.name);
    const von = namen[0] ?? "";
    const bis = namen[namen.length - 1] ?? "";
    const distanz = stages.reduce((sum, s) => sum + s.distance_units, 0) * route.miles_per_unit;
    const flug = route.air_legs_units.reduce((sum, u) => sum + u, 0) * route.miles_per_unit;

    // Was je Etappe bekannt ist: Gegenden ohne die, die JEDE Etappe trägt (sie sagen nichts über die Etappe), Gebiet, Sprachen, Neues.
    const gegendenJe = landscapes?.stages.map((liste) => liste.map((e) => e.name)) ?? [];
    const ueberall =
        stages.length > 1 && gegendenJe.length === stages.length
            ? new Set((gegendenJe[0] ?? []).filter((n) => gegendenJe.every((liste) => liste.includes(n))))
            : new Set<string>();
    const neuJe = new Map<number, RouteUnterwegsEintrag[]>();
    for (const eintrag of eingabe.unterwegs ?? []) {
        const erste = Math.min(...eintrag.etappen);
        neuJe.set(erste, [...(neuJe.get(erste) ?? []), eintrag]);
    }
    const wissen: EtappenWissen[] = stages.map((_, i) => ({
        gegenden: (gegendenJe[i] ?? []).filter((n) => !ueberall.has(n)),
        gebiet: gebietDerEtappe(landscapes?.territories?.[i] ?? []),
        sprachen: (landscapes?.sprachen?.[i] ?? []).map((s) => ({ name: s.name, anteil: s.anteil })),
        neu: neuJe.get(i) ?? [],
    }));

    const rast = rastNachEtappe(route);
    const monat = einMonat(stages);
    const zeileVon = (row: StageRowModel): EtappenZeile => {
        const stage = stages[row.index]!;
        const r = rast[row.index] ?? 0;
        return {
            nr: row.number,
            von: row.fromName,
            nach: row.toName,
            weg: zeileWeg(row),
            datum: etappenDatum(stage, monat !== null),
            meilen: row.distance.zahl,
            zeit: wertText(row.duration),
            rast: r > 0.01 ? t("unit.hoursShort", { n: formatNumber(r, 1) }) : "",
            dazu: dazuTeile([stage], [wissen[row.index]!]),
        };
    };

    // Die Stationen und Abschnitte in der Folge der Etappenliste; ein Flug ist EIN Abschnitt.
    const verlauf: VerlaufEintrag[] = [];
    const stationen: Station[] = [];
    const strecken: Domain[][] = [];
    let offen: Domain[] = [];
    const stationAus = (
        s: StageStationModel,
        letzteVor: RouteStage | undefined,
        ersteNach: RouteStage | undefined,
    ): Station => {
        let datum = "";
        if (letzteVor === undefined && route.departure)
            datum = t("reisePdf.pdf.ab", { datum: formatDate(route.departure) });
        else if (ersteNach === undefined && route.arrival)
            datum = t("reisePdf.pdf.an", { datum: formatDate(route.arrival) });
        else if (letzteVor?.end_date && ersteNach?.start_date)
            datum = formatDateRange(letzteVor.end_date, ersteNach.start_date);
        return { name: s.name, rolle: s.role, wo: stationText(s), datum, strecke: [] };
    };
    // Eine Station steht vor der ersten Etappe ihrer Teilstrecke (ihr Punkt IST deren `from`, `stage-list-model.ts`), das Ziel nach der letzten.
    const legDerStation = (s: StageStationModel): { vor?: RouteStage; nach?: RouteStage } => {
        const stelle = stages.findIndex((stage) => stage.from === s.point);
        const vor = stelle < 0 ? stages[stages.length - 1] : stages[stelle - 1];
        const nach = stelle < 0 ? undefined : stages[stelle];
        return { ...(vor ? { vor } : {}), ...(nach ? { nach } : {}) };
    };
    const abschnittAus = (
        domain: Domain,
        titel: string,
        meta: readonly Wert[],
        rows: readonly StageRowModel[],
    ): Abschnitt => {
        const eigene = rows.map((row) => stages[row.index]!);
        const erste = eigene[0];
        const letzte = eigene[eigene.length - 1];
        return {
            domain,
            titel,
            meta: meta.map(wertText).join(" · "),
            namen: einmal(rows.map(zeileWeg)).join(", "),
            datum: erste?.start_date && letzte?.end_date ? formatDateRange(erste.start_date, letzte.end_date) : "",
            etappen: rows.map(zeileVon),
            dazu: dazuTeile(
                eigene,
                rows.map((row) => wissen[row.index]!),
            ),
        };
    };
    for (const item of modell.items) {
        if (item.kind === "station") {
            const { vor, nach } = legDerStation(item.station);
            if (stationen.length > 0) strecken.push(offen);
            offen = [];
            const station = stationAus(item.station, vor, nach);
            stationen.push(station);
            verlauf.push({ art: "station", station });
        } else if (item.kind === "group") {
            const g = item.group;
            if (offen[offen.length - 1] !== g.domain) offen.push(g.domain);
            verlauf.push({ art: "abschnitt", abschnitt: abschnittAus(g.domain, g.title, g.meta, g.rows) });
        } else {
            const f = item.flight;
            const rows = f.rows.filter((r): r is StageRowModel => !isStation(r));
            verlauf.push({ art: "abschnitt", abschnitt: abschnittAus("land", f.title, f.meta, rows) });
            for (const r of f.rows)
                if (isStation(r)) stationen.push(stationAus(r, legDerStation(r).vor, legDerStation(r).nach));
        }
    }
    stationen.forEach((station, i) => {
        station.strecke = strecken[i] ?? [];
    });

    // Wo die Stationen im Höhenprofil stehen: am Anfang ihrer ersten Etappe, das Ziel am Ende.
    const profilStationen: { meile: number; name: string }[] = [];
    let meilen = 0;
    let leg = -1;
    for (const stage of stages) {
        if (stage.leg_index !== leg) {
            leg = stage.leg_index;
            profilStationen.push({ meile: meilen, name: pointLabel(stage.from, pointNames) });
        }
        meilen += stage.distance_units * route.miles_per_unit;
    }
    const letzteEtappe = stages[stages.length - 1];
    if (letzteEtappe) profilStationen.push({ meile: meilen, name: pointLabel(letzteEtappe.to, pointNames) });

    const kosten = kostenDaten(route, options);
    const sicht = costView(route, options);
    const schiffe = shipNotes(route);
    const territorien = landscapes?.territories ? territoryHierarchy(landscapes.territories) : [];
    const gegenden = landscapes?.route.map((e) => e.name) ?? [];
    const sprachen = (landscapes?.routeSprachen ?? []).map((s) => `${s.name} ${prozent(s.anteil)}`);
    const gruppen = eingabe.unterwegs && eingabe.unterwegs.length > 0 ? unterwegsGruppen(eingabe.unterwegs) : [];
    const abschnitte = Math.max(1, route.waypoints.length - 1);
    const zeitraum = [
        route.departure && route.arrival ? formatDateRange(route.departure, route.arrival) : "",
        days(route.total_hours),
        miles(distanz),
    ].filter((teil) => teil !== "");
    const gerechnet = [
        ...(route.air ? settingsParts(route, options) : transportSummary(options).map((p) => p.text)),
        optionsSummary(options)[0]?.text ?? "",
        optionsSummary(options)[2]?.text ?? "",
    ].filter((teil) => teil !== "");

    return {
        von,
        bis,
        titel: reiseTitel(namen),
        datei:
            eingabe.dateiVorlage === undefined || eingabe.dateiVorlage === ""
                ? t("reisePdf.datei.vorgabe", { von, bis })
                : dateiAusVorlage(eingabe.dateiVorlage, von, bis),
        zeitraum: zeitraum.join(" · "),
        kopfRechts: [
            `${von} – ${bis}`,
            route.departure && route.arrival ? formatDateRange(route.departure, route.arrival) : "",
        ]
            .filter((teil) => teil !== "")
            .join(" · "),
        stationen,
        kennzahlen: {
            links: [
                ...(route.departure && route.arrival
                    ? [
                          { label: t("planner.summary.departure"), wert: formatDate(route.departure), notiz: "" },
                          {
                              label: t("planner.summary.arrival"),
                              wert: formatDate(route.arrival),
                              notiz: seasonLabel(route.arrival.season),
                          },
                      ]
                    : []),
                {
                    label: t("planner.summary.distance"),
                    wert: miles(distanz),
                    notiz: tPlural("planner.summary.legCount", stages.length, { n: stages.length }),
                },
                {
                    label: t("planner.summary.airDistance"),
                    wert: miles(flug),
                    notiz: tPlural("planner.summary.airStations", route.waypoints.length, {
                        n: route.waypoints.length,
                    }),
                },
            ],
            rechts: [
                {
                    label: t("planner.summary.travelTime"),
                    wert: hours(route.travel_hours),
                    notiz: days(route.travel_hours),
                },
                { label: t("planner.summary.restTime"), wert: hours(route.rest_hours), notiz: days(route.rest_hours) },
                {
                    label: t("planner.summary.totalTime"),
                    wert: hours(route.total_hours),
                    notiz: days(route.total_hours),
                    gesamt: true,
                },
            ],
        },
        kostenSumme: sicht === null ? null : sicht.summary,
        gerechnet: t("reisePdf.pdf.gerechnet", { teile: gerechnet.join(" · ") }),
        verlaufUnter: t("reisePdf.pdf.verlaufUnter", {
            etappen: tPlural("planner.summary.legCount", stages.length, { n: formatNumber(stages.length, 0) }),
            abschnitte: tPlural("reisePdf.abschnitte", abschnitte, { n: formatNumber(abschnitte, 0) }),
        }),
        datumSpalte:
            stages[0]?.start_date === undefined
                ? null
                : monat
                  ? monthName(monat.month as Exclude<RouteDate["month"], "">)
                  : t("reisePdf.pdf.spalte.datum"),
        verlauf,
        profil: profilDaten(route, profilStationen),
        kosten,
        schiffe: schiffe === null ? null : { titel: t("reisePdf.pdf.schiffe"), zeilen: schiffe.lines },
        gebiete:
            gegenden.length + sprachen.length + territorien.length === 0
                ? null
                : { gegenden, sprachen, gebiete: territorien.map((zeile) => zeile.entry.name) },
        unterwegs:
            gruppen.length === 0
                ? null
                : gruppen.map((g) => ({
                      titel: t(`infoPanel.lore.${g.kind}`),
                      zahl: formatNumber(g.zeilen.length, 0),
                      eintraege: g.zeilen.slice(0, UNTERWEGS_JE_ART).map((z) => ({
                          name: z.name,
                          wo: [t("planner.unterwegs.ab", { n: z.ab }), z.gegend].filter((s) => s !== "").join(" · "),
                      })),
                      weitere:
                          g.zeilen.length > UNTERWEGS_JE_ART
                              ? t("reisePdf.pdf.weitere", {
                                    n: formatNumber(g.zeilen.length - UNTERWEGS_JE_ART, 0),
                                })
                              : null,
                  })),
        tage: tagebuch(route, options, pointNames),
    };
}

/** Die festen Wörter des PDFs in der Sprache, in der es gerufen wird (`dokument.ts` kennt kein `t()`). */
export function pdfWorte(): PdfWorte {
    return {
        marke: t("page.title"),
        auge: t("reisePdf.pdf.auge"),
        seite: t("reisePdf.vorschau.seite", { n: "{n}", m: "{m}" }),
        qr: t("reisePdf.pdf.qr"),
        verlauf: t("reisePdf.pdf.verlauf"),
        spalten: {
            nr: t("reisePdf.pdf.spalte.nr"),
            strecke: t("reisePdf.pdf.spalte.strecke"),
            weg: t("reisePdf.pdf.spalte.weg"),
            meilen: t("reisePdf.pdf.spalte.meilen"),
            zeit: t("reisePdf.pdf.spalte.zeit"),
            rast: t("reisePdf.pdf.spalte.rast"),
        },
        profil: t("planner.profile.heading"),
        schritt: t("planner.slope.unit"),
        toene: {
            land: t("reisePdf.pdf.ton.land"),
            river: t("reisePdf.pdf.ton.fluss"),
            sea: t("reisePdf.pdf.ton.meer"),
            air: t("reisePdf.pdf.ton.luft"),
        },
        kosten: t("planner.cost.heading"),
        gebiete: t("reisePdf.pdf.gebiete"),
        derographie: t("planner.summary.areas.heading.landscapes"),
        sprachen: t("planner.summary.areas.heading.sprachen"),
        politisch: t("planner.summary.areas.heading.territories"),
        unterwegs: t("planner.unterwegs.heading"),
        tagebuch: t("reisePdf.pdf.tagebuch"),
        tagebuchUnter: t("reisePdf.pdf.tagebuchUnter"),
        wetter: [
            t("reisePdf.pdf.wetter.sonnig"),
            t("reisePdf.pdf.wetter.bewoelkt"),
            t("reisePdf.pdf.wetter.regen"),
            t("reisePdf.pdf.wetter.sturm"),
        ],
    };
}

/** Welche Inhalte diese Reise trägt: Ohne Kosten, Schiff, Profil, Gegenden, Vorkommen oder Reisetage ist die Kachel gesperrt. */
export function verfuegbar(daten: ReiseDaten): Record<Inhalt, boolean> {
    return {
        etappen: daten.verlauf.length > 0,
        profil: daten.profil !== null,
        kosten: daten.kosten !== null,
        schiffe: daten.schiffe !== null,
        gebiete: daten.gebiete !== null,
        unterwegs: daten.unterwegs !== null,
        tagebuch: daten.tage.length > 0,
        qr: true,
    };
}
