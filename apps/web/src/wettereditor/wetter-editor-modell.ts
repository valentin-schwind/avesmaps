import {
    AVENTURIA_TRAVEL_MODEL,
    CALENDAR_MONTHS,
    NAMELESS_MONTH,
    WETTER_JAHR_GRUPPEN,
    WETTER_JAHR_WERTE,
    WETTER_UNBESTIMMT,
    departureDayOfYear,
    istAngelegtePresetId,
    seasonOfDay,
    snowlineHeight,
    wetterGeltung,
    wetterSchneeTag,
    type DepartureMonth,
    type WetterJahrGruppe,
    type WetterJahrSpalte,
    type WetterJahrWert,
    type WetterPreset,
    type WetterSymbol,
    type WetterSymbolArt,
    type WetterSymbolDaten,
} from "@avesmaps3d/shared";
import type { EditorZeichenName } from "../controls/editor-zeichen.vue";
import { kreisZaehlung, type Kreis, type ListenOptionen, type ListenZeile } from "../editor-liste/liste-modell";
import { formatNumber, t } from "../i18n/i18n";
import { formatDate, monthName } from "../route-planner/planner-model";
import { WETTER_LEGENDE, symbolKreis } from "./wetter-zaehlung";

/**
 * Das Modell des Wetter-Editors (WI-0288 Stufe 3; Probierseite `review/wetter-editor/`, abgenommen mit Idee A und B): reine Funktionen für
 * Liste, Zeitpunkt, Werte und Icons, damit Vitest sie ohne Browser prüft. Das Fenster (`wettereditor-fenster.vue`) zeichnet nur, was hier
 * steht; die Tafeln selbst (Werte, Grenzen, Vorgaben) stehen im geteilten Paket (`packages/shared/src/wetter/`).
 *
 * - **Eine Liste, zwei Gruppen** (Idee A): „Presets“ zuerst, „Unbestimmt“ an ihrer Spitze, dann die datierten nach dem Kalender (die 13 festen und die angelegten); darunter
 *   „Icons“ in der Folge ihrer Anlage. Die Gruppen sind Abschnitte, keine Objekte (`gruppenAlsAbschnitte`); jede Sortierung hält sie in
 *   dieser Folge und ordnet nur innerhalb.
 * - **Der Kreis** bedeutet je Gruppe etwas anderes, darum zwei Legenden unter der Liste wie in der Probierseite: Presets ● datiert,
 *   ◐ Kartenstandard; Icons ● mit Namen auf der Karte, ◐ ohne Namen, ○ ausgeblendet.
 * - **„Unbestimmt“ setzen fragt erst nach** (Idee B): Jeder Tausch, also jedes Ziel, an dem schon ein Preset liegt, und das Ziel „unbestimmt“,
 *   zeigt die Frage; ein freier Tag nicht. Das unbestimmte Preset auf einen freien Tag geht nicht (der Server sagt 409 `unbestimmt_bleibt`).
 */

export type WetterBestand = {
    readonly presets: readonly WetterPreset[];
    readonly symbole: readonly WetterSymbol[];
};

/** Die Gruppen der Liste, in ihrer Folge. */
export const WETTER_GRUPPEN = ["presets", "icons"] as const;
export type WetterGruppe = (typeof WETTER_GRUPPEN)[number];

export const WETTER_FACETTEN = ["art", "sicht", "zeit"] as const;
export const WETTER_SORTIERUNGEN = ["kalender", "name", "art"] as const;
export type WetterSortierung = (typeof WETTER_SORTIERUNGEN)[number];

/** Die Werte der Facette „Jahreszeit“: die vier des Kalenders, die Namenlosen Tage und das unbestimmte Preset. */
export const WETTER_ZEITEN = ["sommer", "herbst", "winter", "fruehling", "namenlos", "unbestimmt"] as const;
export type WetterZeit = (typeof WETTER_ZEITEN)[number];

const ART_FOLGE = ["preset", "wind", "wirbel", "stroemung", "mahlstrom"] as const;

/** Ein angelegtes Preset (Betreiber 2026-11-08), nicht eines der 14 festen. */
export const istAngelegt = (preset: Pick<WetterPreset, "id">): boolean => istAngelegtePresetId(preset.id);

/** Lässt sich das Preset entfernen? Nur ein angelegtes, das nicht gerade der Kartenstandard ist (der Server sagt sonst 409). */
export const istEntfernbar = (preset: Pick<WetterPreset, "id" | "tag">): boolean =>
    istAngelegt(preset) && preset.tag !== null;

/** Der Bestand mit einem neuen angelegten Preset: hinter den 14, unter den angelegten nach Tag (wie der Server liest). */
export function mitAngelegtem(presets: readonly WetterPreset[], neu: WetterPreset): WetterPreset[] {
    const feste = presets.filter((preset) => !istAngelegt(preset));
    const angelegt = [...presets.filter(istAngelegt), neu].sort((a, b) => (a.tag ?? 0) - (b.tag ?? 0));
    return [...feste, ...angelegt];
}

/** Ein Preset ist unbestimmt, wenn es keinen Tag hat. */
export const istUnbestimmt = (preset: Pick<WetterPreset, "tag">): boolean => preset.tag === null;

/** Die Jahreszeit eines Tages, an den Namenlosen Tagen (361 bis 365) „namenlos“. */
export function zeitVon(tag: number | null): WetterZeit {
    if (tag === null) return "unbestimmt";
    if (tag > 360) return "namenlos";
    return seasonOfDay(tag);
}

/** Monat und Tag eines Tags im Jahr; `null` heißt unbestimmt. */
export function monatUndTag(tag: number | null): { monat: DepartureMonth; tag: number } | null {
    if (tag === null) return null;
    if (tag > 360) return { monat: NAMELESS_MONTH, tag: tag - 360 };
    const monat = Math.floor((tag - 1) / 30);
    return { monat: CALENDAR_MONTHS[monat]!, tag: tag - monat * 30 };
}

/** Der Tag im Jahr aus Monat und Tag; der Tag wird auf den Monat geklemmt (1 bis 30, an den Namenlosen Tagen 1 bis 5). */
export function tagAus(monat: DepartureMonth, tag: number): number {
    const grenze = monat === NAMELESS_MONTH ? 5 : 30;
    const klemme = Math.min(grenze, Math.max(1, Math.round(Number.isFinite(tag) ? tag : 1)));
    return departureDayOfYear(monat, klemme);
}

/** „15. Praios“, „3. Namenloser Tag“ oder „Unbestimmt“: der Name eines Presets ist sein Zeitpunkt (wie der Reisebeginn des Planers). */
export function presetName(preset: Pick<WetterPreset, "tag">): string {
    const datum = monatUndTag(preset.tag);
    if (datum === null) return t("wettereditor.preset.unbestimmt");
    return datum.monat === NAMELESS_MONTH
        ? formatDate({ month: "", day: datum.tag, nameless: true })
        : formatDate({ month: datum.monat, day: datum.tag, nameless: false });
}

/** Der Name der Jahreszeit eines Presets. */
export function zeitName(zeit: WetterZeit): string {
    if (zeit === "unbestimmt") return t("wettereditor.preset.unbestimmt");
    if (zeit === "namenlos") return t("wettereditor.zeit.namenlos");
    // Die Jahreszeit des Planers steht klein im Satz („im winter“ auf Englisch); hier beginnt sie eine Zeile.
    const name = t(`planner.season.${zeit}`);
    return name.charAt(0).toLocaleUpperCase() + name.slice(1);
}

/** Wohin ein Wind oder eine Strömung schiebt, in acht Himmelsrichtungen; Grad nach der Windrose (0 Norden, 90 Osten). */
export const HIMMEL = ["n", "no", "o", "so", "s", "sw", "w", "nw"] as const;
export type Himmel = (typeof HIMMEL)[number];
export function himmelVon(grad: number): Himmel {
    return HIMMEL[((Math.round((((grad % 360) + 360) % 360) / 45) % 8) + 8) % 8]!;
}
export const himmelName = (grad: number): string => t(`wettereditor.himmel.${himmelVon(grad)}`);

/** Die Reichweite in Kilometern (1 Karteneinheit sind 3 km). */
export const kmVon = (reichweite: number): number => Math.round(reichweite * 3);

/** Die Grundlage der Stärke in der Anzeige: Eine Strömung (und der Mahlstrom, der im selben Feld wirkt) schiebt mit 5 so stark wie der Grundwind mit 8 (Probierseite). */
export const staerkeBasis = (art: WetterSymbolArt): number => (art === "stroemung" || art === "mahlstrom" ? 5 : 8);

export const artName = (art: WetterSymbolArt): string => t(`wettereditor.art.${art}`);
export const symbolName = (symbol: Pick<WetterSymbol, "name">): string =>
    symbol.name ?? t("wettereditor.icon.ohneName");

/** Der Kreis eines Icons und die Zählung der Kachel „Wetter“ stehen im Startpaket (`wetter-zaehlung.ts`). */
export { symbolKreis, zaehlungAusWetter } from "./wetter-zaehlung";

export const ZEICHEN_DER_ART: Readonly<Record<WetterSymbolArt, EditorZeichenName>> = {
    wind: "wetter-wind",
    wirbel: "wetter-wirbel",
    stroemung: "wetter-stroemung",
    mahlstrom: "wetter-mahlstrom",
};

// ---------- Die Liste ----------

/** Welche Presets an diesem Tag gelten (`null`: kein Reisebeginn), mit ihrem Anteil. */
export function geltungAm(bestand: WetterBestand, tag: number | null): ReadonlyMap<string, number> {
    return new Map(wetterGeltung(bestand.presets, tag).map(({ id, anteil }) => [id, anteil]));
}

/** „gilt auf der Karte“ oder „gilt zu 40 %“; leer, wo das Preset gerade nicht gilt. */
export function geltungText(anteil: number | undefined): string | undefined {
    if (anteil === undefined) return undefined;
    return anteil >= 0.995
        ? t("wettereditor.gilt")
        : t("wettereditor.giltZu", { n: formatNumber(Math.round(anteil * 100), 0) });
}

export function presetZeile(preset: WetterPreset, geltung: ReadonlyMap<string, number>, reise: boolean): ListenZeile {
    const zeit = zeitVon(preset.tag);
    const anteil = geltung.get(preset.id);
    const grund =
        preset.tag === null
            ? reise
                ? t("wettereditor.preset.kartenstandard")
                : t("wettereditor.preset.ohneReise")
            : zeitName(zeit);
    const gilt = geltungText(anteil);
    return {
        key: preset.id,
        name: presetName(preset),
        kreis: preset.tag === null ? "halb" : "voll",
        facetten: { art: "preset", zeit },
        rechts: t("wettereditor.zeile.preset"),
        unter: { text: gilt === undefined ? grund : `${grund} · ${gilt}`, ton: anteil === undefined ? "leise" : "gut" },
        vorzeichen: "zeitpunkt",
        gruppe: "presets",
        gruppenName: t("wettereditor.gruppe.presets"),
        rang: { gruppe: 0, kalender: preset.tag ?? 0, art: 0 },
    };
}

/** Die Unterzeile eines Icons: wohin es schiebt (oder wie es dreht) und wie weit; ausgeblendet die Warnung, dass es weiter wirkt. */
export function symbolUnter(symbol: WetterSymbol): { text: string; ton: "leise" | "warnung" } {
    if (!symbol.sichtbar) return { text: t("wettereditor.icon.ausgeblendetUnter"), ton: "warnung" };
    const weg =
        symbol.art === "wirbel" || symbol.art === "mahlstrom"
            ? t(symbol.drehsinn === 1 ? "wettereditor.drehsinn.mit" : "wettereditor.drehsinn.gegen")
            : t("wettereditor.nach", { richtung: himmelName(symbol.richtung ?? 0) });
    return {
        text: t("wettereditor.icon.unter", { weg, km: formatNumber(kmVon(symbol.reichweite), 0) }),
        ton: "leise",
    };
}

export function symbolZeile(symbol: WetterSymbol, folge: number): ListenZeile {
    return {
        key: symbol.id,
        name: symbolName(symbol),
        kreis: symbolKreis(symbol),
        facetten: { art: symbol.art, sicht: symbol.sichtbar ? "an" : "aus" },
        rechts: artName(symbol.art),
        unter: symbolUnter(symbol),
        vorzeichen: ZEICHEN_DER_ART[symbol.art],
        gruppe: "icons",
        gruppenName: t("wettereditor.gruppe.icons"),
        rang: { gruppe: 1, kalender: folge, art: ART_FOLGE.indexOf(symbol.art) },
    };
}

/** Die Zeilen der Liste: alle Presets, dann alle Icons. `reiseTag` ist der Reisebeginn des Planers als Tag im Jahr, oder `null`. */
export function wetterZeilen(bestand: WetterBestand, reiseTag: number | null): ListenZeile[] {
    const geltung = geltungAm(bestand, reiseTag);
    return [
        ...bestand.presets.map((preset) => presetZeile(preset, geltung, reiseTag !== null)),
        ...bestand.symbole.map((symbol, i) => symbolZeile(symbol, i)),
    ];
}

const COLLATOR = new Intl.Collator("de", { sensitivity: "base", numeric: true });
const rang = (zeile: ListenZeile, name: string): number => zeile.rang?.[name] ?? 0;
/** Jede Ordnung hält die Gruppen in ihrer Folge (Presets vor Icons) und ordnet nur in ihnen. */
const inGruppen =
    (innen: (a: ListenZeile, b: ListenZeile) => number) =>
    (a: ListenZeile, b: ListenZeile): number =>
        rang(a, "gruppe") - rang(b, "gruppe") || innen(a, b) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

export const WETTER_LISTE: ListenOptionen = {
    form: "gruppiert",
    facetten: WETTER_FACETTEN,
    gruppenAlsAbschnitte: true,
    sortierungen: {
        kalender: inGruppen((a, b) => rang(a, "kalender") - rang(b, "kalender")),
        name: inGruppen((a, b) => COLLATOR.compare(a.name, b.name)),
        art: inGruppen((a, b) => rang(a, "art") - rang(b, "art") || rang(a, "kalender") - rang(b, "kalender")),
    },
};

export const sortierungsName = (wert: string): string => t(`wettereditor.sortierung.${wert as WetterSortierung}`);
export const facettenName = (id: string): string => t(`wettereditor.facette.${id as (typeof WETTER_FACETTEN)[number]}`);
export function wertName(facette: string, wert: string): string {
    if (facette === "art")
        return wert === "preset" ? t("wettereditor.gruppe.presets") : artName(wert as WetterSymbolArt);
    if (facette === "sicht") return t(wert === "an" ? "wettereditor.sicht.an" : "wettereditor.sicht.aus");
    if (facette === "zeit") return zeitName(wert as WetterZeit);
    return wert;
}

/** Die zwei Legenden unter der Liste, je mit den Zahlen ihrer Gruppe. */
export function wetterLegenden(bestand: WetterBestand): {
    presets: { namen: Partial<Record<Kreis, string>>; zahlen: Record<Kreis, number> };
    icons: { namen: Partial<Record<Kreis, string>>; zahlen: Record<Kreis, number> };
} {
    return {
        presets: {
            namen: { voll: t("wettereditor.legende.datiert"), halb: t("wettereditor.legende.kartenstandard") },
            zahlen: kreisZaehlung(bestand.presets.map((preset) => (preset.tag === null ? "halb" : "voll"))),
        },
        icons: { namen: WETTER_LEGENDE(), zahlen: kreisZaehlung(bestand.symbole.map(symbolKreis)) },
    };
}

// ---------- Der Zeitpunkt (Idee B) ----------

export type ZeitpunktFolge =
    /** Das Preset liegt schon dort. */
    | { readonly art: "gleich" }
    /** Ein freier Tag: Es wandert, ohne zu fragen. */
    | { readonly art: "frei" }
    /** Das unbestimmte Preset auf einen freien Tag: geht nicht, eines bleibt unbestimmt. */
    | { readonly art: "unbestimmtBleibt" }
    /** Dort liegt schon eines (beim Ziel „unbestimmt“: das bisher unbestimmte): Beide tauschen, erst nach der Frage. */
    | { readonly art: "tausch"; readonly mit: string };

/** Was geschieht, wenn das Preset `id` an den Tag `ziel` (oder `null`, unbestimmt) soll. */
export function zeitpunktFolge(presets: readonly WetterPreset[], id: string, ziel: number | null): ZeitpunktFolge {
    const preset = presets.find((p) => p.id === id);
    if (preset === undefined || preset.tag === ziel) return { art: "gleich" };
    const dort = presets.find((p) => p.id !== id && p.tag === ziel);
    if (dort !== undefined) return { art: "tausch", mit: dort.id };
    return preset.tag === null ? { art: "unbestimmtBleibt" } : { art: "frei" };
}

/** Der Stand nach dem Zug: das Preset an seinem Ziel, beim Tausch das andere an seinem alten Platz. */
export function mitZeitpunkt(presets: readonly WetterPreset[], id: string, ziel: number | null): WetterPreset[] {
    const preset = presets.find((p) => p.id === id);
    if (preset === undefined) return [...presets];
    const alt = preset.tag;
    return presets.map((p) => {
        if (p.id === id) return { ...p, tag: ziel };
        if (p.tag === ziel) return { ...p, tag: alt };
        return p;
    });
}

/** Die Frage vor dem Tausch (Idee B) und was danach gilt. */
export function tauschFrage(
    presets: readonly WetterPreset[],
    id: string,
    mit: string,
    ziel: number | null,
): { frage: string; folge: string } {
    const preset = presets.find((p) => p.id === id)!;
    const andere = presets.find((p) => p.id === mit)!;
    const name = presetName(preset);
    if (ziel === null)
        return {
            frage: t("wettereditor.tausch.frageUnbestimmt", { name }),
            folge: t("wettereditor.tausch.folgeUnbestimmt", { datum: name }),
        };
    return {
        frage: t("wettereditor.tausch.frage", { name, datum: presetName({ tag: ziel }) }),
        folge:
            preset.tag === null
                ? t("wettereditor.tausch.folgeWirdStandard", { andere: presetName(andere) })
                : t("wettereditor.tausch.folge", { andere: presetName(andere), datum: name }),
    };
}

/** Der Satz nach dem Tausch, mit „↺ Zurücknehmen“ daneben. */
export function tauschHinweis(presets: readonly WetterPreset[], id: string, mit: string): string {
    const preset = presets.find((p) => p.id === id);
    const andere = presets.find((p) => p.id === mit);
    if (preset === undefined || andere === undefined) return t("wettereditor.tausch.getauscht");
    if (preset.tag === null) return t("wettereditor.tausch.istStandard", { datum: presetName(andere) });
    if (andere.tag === null) return t("wettereditor.tausch.andereStandard");
    return t("wettereditor.tausch.andereAm", { datum: presetName(andere) });
}

/** Die Wahl „Zeitpunkt“: „Unbestimmt (Kartenstandard)“, die zwölf Monate und die Namenlosen Tage. */
export function zeitpunktOptionen(): { wert: string; text: string }[] {
    return [
        { wert: "", text: t("wettereditor.zeitpunkt.unbestimmt") },
        ...CALENDAR_MONTHS.map((monat) => ({ wert: monat, text: monthName(monat) })),
        { wert: NAMELESS_MONTH, text: t("wettereditor.zeit.namenlos") },
    ];
}

// ---------- Die Werte eines Presets ----------

/** Der Wert, auf den ↺ zurücksetzt: am unbestimmten Preset die Vorgabe im Code, an einem datierten der Kartenstandard (Probierseite). */
export function referenzWert(presets: readonly WetterPreset[], preset: WetterPreset, k: WetterJahrSpalte): number {
    if (preset.tag === null) return WETTER_UNBESTIMMT[k];
    const unbestimmt = presets.find((p) => p.tag === null);
    return unbestimmt?.werte[k] ?? WETTER_UNBESTIMMT[k];
}

export const weicht = (wert: number, referenz: number): boolean => Math.abs(wert - referenz) > 1e-6;

/** Auf den Schritt des Reglers gerundet und in die Grenzen geklemmt. */
export function aufSchritt(def: Pick<WetterJahrWert, "min" | "max" | "schritt">, wert: number): number {
    const geklemmt = Math.min(def.max, Math.max(def.min, wert));
    const n = Math.round((geklemmt - def.min) / def.schritt);
    return Math.round((def.min + n * def.schritt) * 10000) / 10000;
}

/** Die Wörter der Einheiten stehen seit Stufe 4 für alle Wetterwerte in `wetter-einheit.ts` (auch das Wettermodell liest sie). */
export { einheitText } from "./wetter-einheit";

/** Die 15 Werte in ihren vier Abschnitten, in der Folge der Probierseite. */
export function wertGruppen(): { id: WetterJahrGruppe; werte: readonly WetterJahrWert[] }[] {
    return WETTER_JAHR_GRUPPEN.map((id) => ({ id, werte: WETTER_JAHR_WERTE.filter((wert) => wert.gruppe === id) }));
}

/**
 * Die Temperatur auf Meereshöhe in der Mitte der Karte und die Schneefallgrenze dort; `mitte` in Karteneinheiten (z von 0 im Norden bis
 * 1024 im Süden), `tag` der Tag des Presets (`null`: unbestimmt).
 *
 * Seit Stufe 5 ist die Schneefallgrenze die der Wegfindung (`snowlineHeight` nach der Klimazone, `zone`), am Tag des Presets; „unbestimmt“
 * rechnet mit dem Tag des Kartenstandards. Nur ohne Zone gilt noch die eigene Grenze des Wetters aus der Temperatur (Probierseite: 6,5 °C je
 * 1.000 m, 250 m unter der Nullgradgrenze), wie in der Engine.
 */
export function mitteSatz(
    werte: Readonly<Record<WetterJahrSpalte, number>>,
    mitte: { x: number; z: number },
    tag: number | null,
    zone: string | null,
): string {
    const anteil = Math.min(1, Math.max(0, mitte.z / 1024));
    const meer = werte.tn + (werte.ts - werte.tn) * anteil;
    const fall =
        (zone === null ? null : snowlineHeight(AVENTURIA_TRAVEL_MODEL, zone, wetterSchneeTag(tag))) ??
        (meer / 6.5) * 1000 - 250;
    return t("wettereditor.mitte", {
        temperatur: formatNumber(meer, 1),
        grenze: fall <= 0 ? t("wettereditor.mitte.meer") : `${formatNumber(Math.round(fall / 10) * 10, 0)} m`,
    });
}

// ---------- Neue Icons ----------

/** Der Papierkorb der Leiste: der Grund, warum er für diese Wahl nicht geht, oder `undefined`. */
export function papierkorbGrund(wahl: { preset?: WetterPreset; symbol?: WetterSymbol }): string | undefined {
    if (wahl.symbol !== undefined) return undefined;
    if (wahl.preset === undefined || !istAngelegt(wahl.preset)) return t("wettereditor.papierkorb.gesperrt");
    return wahl.preset.tag === null ? t("wettereditor.preset.entfernen.bleibt") : undefined;
}

/**
 * Ein neues Icon an einer Stelle: Werte der Probierseite, die Richtung nach Osten, ohne Namen auf der Karte. Der Mahlstrom (Betreiber 2026-11-08) ist kleiner und
 * schwächer als ein Wirbel, dreht wie er (Drehsinn 1) und hat keine Richtung.
 */
export function neuesSymbol(art: WetterSymbolArt, lage: { x: number; z: number }): Omit<WetterSymbolDaten, "id"> {
    const klemme = (wert: number): number => Math.round(Math.min(1024, Math.max(0, wert)) * 10) / 10;
    const drehend = art === "wirbel" || art === "mahlstrom";
    return {
        art,
        name: artName(art),
        nameZeigen: false,
        sichtbar: true,
        x: klemme(lage.x),
        z: klemme(lage.z),
        reichweite: art === "mahlstrom" ? 60 : art === "wirbel" ? 110 : 130,
        staerke: art === "wind" ? 10 : art === "stroemung" ? 6 : art === "mahlstrom" ? 4 : 14,
        richtung: drehend ? null : 90,
        drehsinn: art === "mahlstrom" ? (1 as const) : art === "wirbel" ? (-1 as const) : null,
    };
}
