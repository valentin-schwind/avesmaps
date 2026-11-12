import {
    LANDSCAPE_SELECTIONS,
    TOPOGRAPHY_VARIANTS,
    type LandscapeSelection,
    type RouteError,
    type SubjectKind,
    type TopographyVariant,
} from "@avesmaps3d/shared";
import type { MessageKey } from "../i18n/de";
import { locale, t } from "../i18n/i18n";
import { ALL_PLACES_PARAM, SWITCH_PARAMS } from "../map/display-state";
import type { PlaceTier } from "../map/map-display";
import { transportShortLabel } from "../route-planner/planner-model";
import { WETTER_ANZEIGEN, type WetterAnzeige } from "../map/wetter/wetter-schalter";
import { SPRACH_WERT_NAMEN } from "./statistik-sprachen";

/**
 * Die Namen der Statistik (WI-0286; Betreiber 2026-11-07: „alle fehlende schlüssel auflösen (z.B. powerline, path,...) oder passende
 * bezeichner anlegen“). Technische Schlüssel bekommen ihren Namen; alles andere steht, wie es gezählt wurde (Ortsnamen, Hosts).
 *
 * 🔴 **Wo eine Liste aus dem Vertrag kommt, ist der fehlende Name ein Typfehler:** Objektarten, Fehler des Routers, Schalter,
 * Ortsklassen und Ebenen stehen als `Record` über ihrem Typ. Bis WI-0286 war das eine offene Tafel, und jede neue Art stand als
 * Rohwert im Panel (`powerline`, `routeStage`, `loreEntry`).
 *
 * 🪤 Die Tafel ist fest, nicht zusammengesetzt: `t()` gibt für einen unbekannten Schlüssel leeren Text zurück, und ein
 * `statistik.wert.${wert}` hätte jede Liste mit fremden Werten still geleert — im Bild vom 2026-10-13 standen Balken ohne Namen.
 */

/** Was im Infopanel geöffnet wurde (`place_open` meldet `ref.kind`). Die Mehrzahl, weil die Liste Anzahlen zeigt. */
const OBJEKT_ARTEN: Readonly<Record<SubjectKind, MessageKey>> = {
    place: "statistik.art.ort",
    path: "display.paths",
    area: "statistik.art.gebiet",
    territory: "statistik.art.territorium",
    peak: "statistik.art.gipfel",
    powerline: "view.powerlines",
    routeStage: "statistik.art.etappe",
    mapPoint: "statistik.art.kartenpunkt",
    climate: "layer.klima",
    loreEntry: "statistik.art.vorkommen",
    sprache: "layer.sprachen",
    wetterSymbol: "statistik.art.wetterSymbol",
};

/** Warum eine Route scheiterte, kurz; die langen Sätze stehen im Planer (WI-0138 V11). */
const ROUTEN_FEHLER: Readonly<Record<RouteError["error"], MessageKey>> = {
    unknown_waypoint: "statistik.fehl.ortWeg",
    routing_busy: "statistik.fehl.ausgelastet",
    routing_timeout: "statistik.fehl.zuLange",
    routing_failed: "statistik.fehl.fehlgeschlagen",
    database_unavailable: "statistik.fehl.keineDatenbank",
    point_not_on_land: "statistik.fehl.imWasser",
    offroad_transport_not_allowed: "statistik.fehl.mittelPasstNicht",
    no_exit_node: "statistik.fehl.keinAufbruch",
    no_offroad_route: "statistik.fehl.keinLandweg",
    route_too_large: "statistik.fehl.routeZuGross",
    too_many_map_points: "statistik.fehl.zuVieleKartenpunkte",
};

const ebenenSchluessel = (ebene: LandscapeSelection): MessageKey => `layer.${ebene}`;
const variantenSchluessel = (variante: TopographyVariant): MessageKey => `topography.${variante}`;

/** Die Ebenen der Derographie und die Unterwahl der Topographie heißen wie im Kartenfächer. */
const DEROGRAPHIE_NAMEN: Readonly<Record<string, MessageKey>> = Object.fromEntries([
    ...LANDSCAPE_SELECTIONS.map((ebene) => [ebene, ebenenSchluessel(ebene)]),
    ...TOPOGRAPHY_VARIANTS.map((variante) => [variante, variantenSchluessel(variante)]),
]);

/** Die Schalter des Anzeigemenüs (`display_toggle` meldet `togglePaths:on`), nach ihrer Zählkennung. */
const SCHALTER: Readonly<Record<(typeof SWITCH_PARAMS)[keyof typeof SWITCH_PARAMS], MessageKey>> = {
    togglePaths: "display.paths",
    toggleMapLabels: "display.labels",
    toggleTerritoryBorders: "display.borders",
    toggleRivers: "display.rivers",
    areas: "display.layers",
    flow: "display.flow",
    grid: "display.tileGrid",
    gradnetz: "display.gradnetz",
};

/** Die Ortsklassen melden sich ohne eigenen Schalternamen (`metropole:on`, `ortsStufenKennung`). */
const ORTS_KLASSEN: Readonly<Record<PlaceTier, MessageKey>> = {
    metropole: "statistik.ort.metropole",
    grossstadt: "statistik.ort.grossstadt",
    stadt: "statistik.ort.stadt",
    kleinstadt: "statistik.ort.kleinstadt",
    dorf: "statistik.ort.dorf",
    gebaeude: "statistik.ort.gebaeude",
};

/** Die Namen der Wetterschalter, wie das Auge sie zeigt (`display-menu.vue`). */
const WETTER_NAMEN: Readonly<Record<WetterAnzeige, MessageKey>> = {
    schneedecke: "display.weather.schneedecke",
    wolken: "display.weather.wolken",
    regenUndSchnee: "display.weather.regenUndSchnee",
    wind: "display.weather.wind",
    stroemungen: "display.weather.stroemungen",
    niederschlag: "display.weather.niederschlag",
};

const SCHALTER_NAMEN: ReadonlyMap<string, MessageKey> = new Map<string, MessageKey>([
    ...Object.entries(SCHALTER),
    ...Object.entries(ORTS_KLASSEN),
    [ALL_PLACES_PARAM, "display.places"],
    // Nur Legacy kannte diese; nach dem Rohexport stehen sie trotzdem in der Liste.
    ["stadtviertel", "statistik.ort.stadtviertel"],
    ["toggleLabelsWithRegion", "statistik.schalter.labelsMitRegion"],
    ["toggleCrossings", "statistik.schalter.kreuzungen"],
    // Die Wetterschalter im Auge und die Schneefallgrenze (WI-0288, `wetterSchalterKennung`). Ihre Namen tragen weiche Trennstellen.
    ...WETTER_ANZEIGEN.map((id): [string, MessageKey] => [`wetter_${id}`, WETTER_NAMEN[id]]),
    ["wetter_schneefallgrenze", "display.check.snowline"],
]);

/** Der übrige Bestand, ohne Typ dahinter: Was Geräte, Fenster und Einstieg zählen, kommt aus dem Zähler selbst (`zaehler.ts`). */
const WERT_NAMEN: ReadonlyMap<string, MessageKey> = new Map<string, MessageKey>([
    ["rechner", "statistik.wert.rechner"],
    ["telefon", "statistik.wert.telefon"],
    ["tablet", "statistik.wert.tablet"],
    ["3d", "statistik.wert.3d"],
    ["kein3d", "statistik.wert.kein3d"],
    ["finger", "statistik.wert.finger"],
    ["dunkel", "statistik.wert.dunkel"],
    ["wenigerBewegung", "statistik.wert.wenigerBewegung"],
    ["bis480", "statistik.wert.bis480"],
    ["bis1024", "statistik.wert.bis1024"],
    ["bis1600", "statistik.wert.bis1600"],
    ["groesser", "statistik.wert.groesser"],
    ["nah", "statistik.wert.nah"],
    ["mittel", "statistik.wert.mittel"],
    ["weit", "statistik.wert.weit"],
    ["direkt", "statistik.wert.direkt"],
    ["intern", "statistik.wert.intern"],
    ["ohne", "statistik.wert.ohne"],
    ["übrige", "statistik.wert.uebrige"],
    ["schnellste", "statistik.wert.schnellste"],
    ["kuerzeste", "statistik.wert.kuerzeste"],
    // Das Design der Seite (`Theme` aus `theme.ts`); „dunkel“ oben ist das Farbschema des Systems.
    ["dark", "statistik.wert.dark"],
    ["light", "statistik.wert.light"],
    // Die Sprachen der Oberfläche, aus `LOCALES` (WI-0168).
    ...Object.entries(SPRACH_WERT_NAMEN),
    // Kartenansicht und Serie tragen schon im Haus ihre Namen; die Statistik borgt sie, statt zweite zu erfinden.
    ["standard", "view.standard"],
    ["political", "view.political"],
    ["none", "view.none"],
    ["powerlines", "view.powerlines"],
    ["landscapes", "view.landscapes"],
    ["original", "admin.content.seriesName.original"],
    ["modern", "admin.content.seriesName.modern"],
    ...Object.entries(DEROGRAPHIE_NAMEN),
    ...Object.entries(ROUTEN_FEHLER),
    // Dieselben Gründe aus dem Browser und aus der Prüfung vor dem Router; im Vertrag `RouteError` stehen sie nicht.
    ["no_route", "statistik.fehl.keineRoute"],
    ["ueberlastet", "statistik.fehl.ausgelastet"],
    ["unbekannt", "statistik.fehl.unbekannt"],
    // Die Drossel vor der Anwendung (429, WI-0292): vorher stand sie unter „unbekannt“.
    ["gedrosselt", "statistik.fehl.gedrosselt"],
    ["Bad Request", "statistik.fehl.ungueltig"],
    ...Object.entries(OBJEKT_ARTEN),
    ["region", "statistik.art.region"],
    // Der Block „Die dritte Dimension“ (`lesen.ts`).
    ["nur2d", "statistik.dreid.nur2d"],
    ["in3d", "statistik.dreid.in3d"],
    ["flight", "statistik.dreid.flug"],
    ["profile", "statistik.dreid.profil"],
    ["play", "statistik.dreid.play"],
    ["share_create", "statistik.dreid.link"],
    // Die dritte Kartenserie: Legacy meldete sie, unsere App seit 2026-11-10 wieder (Besucher wählen sie unter „Nur Karte“).
    ["old", "statistik.wert.old"],
    // Nur Legacy kannte „Hierher reisen“. Unsere App meldet es nicht mehr; nach dem Rohexport steht es trotzdem in den Listen
    // (LEGACY_DIMENSIONEN im shared-Vertrag).
    ["hierherReisen", "statistik.wert.hierherReisen"],
    // Das Wetter (WI-0288): Familien der Grafikkarte und Fehlerarten, die ein Wort brauchen. Marken stehen als Marken (`wetterWertName`).
    ["software", "statistik.wetter.software"],
    ["andere", "statistik.wert.uebrige"],
]);

/** Länder und Sprachen heißen, wie der Browser sie nennt: Der Zähler kennt nur das Kürzel, und eine eigene Tafel wäre veraltet. */
function browserName(wert: string, art: "region" | "language"): string {
    try {
        return new Intl.DisplayNames([locale.value], { type: art }).of(wert) ?? wert;
    } catch {
        return wert;
    }
}

const WEICHE_TRENNSTELLE = String.fromCharCode(0xad);

/** Der Name einer Ausprägung in der Sprache der Oberfläche; was keinen hat, steht, wie es gezählt wurde. */
export function statistikWertName(wert: string): string {
    const schluessel = WERT_NAMEN.get(wert);
    if (schluessel !== undefined) return t(schluessel);
    const schalter = /^(.+):(on|off)$/.exec(wert);
    const schalterName = schalter === null ? undefined : SCHALTER_NAMEN.get(schalter[1] ?? "");
    if (schalterName !== undefined) {
        return t(schalter?.[2] === "on" ? "statistik.schalter.an" : "statistik.schalter.aus", {
            name: t(schalterName).replaceAll(WEICHE_TRENNSTELLE, ""),
        });
    }
    // Reisemittel heißen im Planer schon so, wie der Besucher sie gewählt hat; die Statistik borgt den Namen.
    const mittel = transportShortLabel(wert);
    if (mittel !== wert) return mittel;
    if (/^[A-Z]{2}$/.test(wert)) return browserName(wert, "region");
    if (/^[a-z]{2}$/.test(wert)) return browserName(wert, "language");
    return wert;
}

/** Eine Zeile eines Balkenblocks; `stufe` rückt sie unter ihre Ansicht ein. */
export interface StatistikZeile {
    readonly name: string;
    readonly wert: number;
    readonly stufe?: 1 | 2;
}

const VARIANTEN: readonly string[] = TOPOGRAPHY_VARIANTS;

/**
 * Die Kartenansichten, unter der Derographie ihre Ebenen und unter der Topographie deren Unterwahl (WI-0286; Betreiber 2026-11-07: „bei
 * Kartenansicht Derographie fehlen die einzelnen unterscheidungen der views“).
 *
 * Die Zahlen summieren nicht auf: Die Ansicht zählt, wie oft jemand in die Derographie wechselte, die Ebene zählt dazu jeden Wechsel
 * innerhalb. Fehlt die übergeordnete Zeile im Zeitraum, steht sie mit 0 da, damit eine Ebene nie unter der falschen Ansicht hängt.
 */
export function ansichtMitEbenen(
    ansichten: readonly StatistikZeile[],
    ebenen: readonly StatistikZeile[],
): StatistikZeile[] {
    const varianten = ebenen.filter((zeile) => VARIANTEN.includes(zeile.name));
    const eigene = ebenen.filter((zeile) => !VARIANTEN.includes(zeile.name));
    if (varianten.length > 0 && !eigene.some((zeile) => zeile.name === "topographie")) {
        eigene.push({ name: "topographie", wert: 0 });
    }
    const unter = eigene.flatMap((zeile): StatistikZeile[] =>
        zeile.name === "topographie"
            ? [{ ...zeile, stufe: 1 }, ...varianten.map((variante): StatistikZeile => ({ ...variante, stufe: 2 }))]
            : [{ ...zeile, stufe: 1 }],
    );
    if (unter.length === 0) return [...ansichten];
    const zeilen = ansichten.some((zeile) => zeile.name === "landscapes")
        ? ansichten
        : [...ansichten, { name: "landscapes", wert: 0 }];
    return zeilen.flatMap((zeile) => (zeile.name === "landscapes" ? [zeile, ...unter] : [zeile]));
}

/** Die Verteilungen des Wetters, die das Panel zeigt (`BesuchZahlen.wetter`); jede kennt ihre Einheit. */
export type WetterVerteilung = "lauf" | "start" | "bildrate" | "spitze" | "aufloesung" | "gpu" | "fehler";

const EINHEIT: Readonly<Record<"start" | "bildrate" | "spitze", string>> = {
    start: "s",
    bildrate: "fps",
    spitze: "ms",
};

/** Marken stehen, wie sie heißen; die Familien ohne Marke und die Fehlerarten gehen durch `statistikWertName`. */
const GPU_MARKEN: Readonly<Record<string, string>> = {
    nvidia: "NVIDIA",
    amd: "AMD",
    intel: "Intel",
    apple: "Apple",
    adreno: "Adreno",
    mali: "Mali",
    powervr: "PowerVR",
};

/**
 * Eine Klasse des Wetters, wie sie reist, als Text: `u15` wird „<15“, `ab60` „60+“, `30-45` „30–45“, `2-5s` „2–5“, dazu die Einheit.
 * Kein Text aus der Sprachtafel: Zahl, Einheit und Zeichen sind in jeder Sprache dieselben.
 */
function klasseName(klasse: string, einheit: string): string {
    const treffer = /^(u|ab)?(\d+)(?:-(\d+))?s?$/.exec(klasse);
    if (treffer === null) return klasse;
    const [, richtung, von, bis] = treffer;
    const zahl =
        richtung === "u" ? `<${von}` : richtung === "ab" ? `${von}+` : bis === undefined ? von : `${von}–${bis}`;
    return `${zahl} ${einheit}`;
}

/** Die Klasse allein, ohne Einheit, für die Achse eines Histogramms (Betreiber 2026-11-08): `ab60` wird „60+“, `2-5s` „2–5“. */
export const wetterKlasseText = (klasse: string): string => klasseName(klasse, "").trim();

/** Die Einheit einer Verteilung des Wetters für die Überschrift ihres Histogramms; leer, wo es keine gibt. */
export const wetterEinheit = (verteilung: WetterVerteilung): string =>
    verteilung === "aufloesung"
        ? "%"
        : verteilung === "start" || verteilung === "bildrate" || verteilung === "spitze"
          ? EINHEIT[verteilung]
          : "";

/** Der Name einer Ausprägung `gerät:klasse` in einer Verteilung des Wetters, etwa „Telefon · 30–45 fps“. */
export function wetterWertName(verteilung: WetterVerteilung, wert: string): string {
    const [geraet = "", klasse] = wert.split(":");
    const geraetName = statistikWertName(geraet);
    if (klasse === undefined) return geraetName;
    let name: string;
    if (verteilung === "start" || verteilung === "bildrate" || verteilung === "spitze")
        name = klasseName(klasse, EINHEIT[verteilung]);
    else if (verteilung === "aufloesung") name = `${klasse} %`;
    else if (verteilung === "gpu")
        name =
            klasse === "unbekannt"
                ? t("statistik.wetter.unbekannt")
                : (GPU_MARKEN[klasse] ?? statistikWertName(klasse));
    else name = statistikWertName(klasse);
    return `${geraetName} · ${name}`;
}
