import { erkenneKontinent } from "../kategorien/auswerten.ts";
import { publikationsSchluessel } from "../schluessel.ts";
import { feldRoh, leseParameter, normalisiereFelder } from "./block.ts";
import { kurzbeschreibungVon } from "./kurzbeschreibung.ts";
import { ohneAuszeichnung } from "./literatur.ts";
import type { Infoboxseite } from "./seite.ts";
import { LEER, entschluesseleHtml, kuerze, phpTrim, schluesselform } from "./text.ts";

/**
 * Ein Vorkommen (Ware, Fauna, Flora, Spezies) aus seinem Wiki-Artikel (WI-0253, Scheibe Vorkommen, §17/§23): die Felder, die Legacys Lore-Abgleich aus der Infobox liest und in
 * `lore_entry` schreibt, die Ortsverknüpfungen und die Rohtexte der Ortsfelder, in denselben Grenzen und mit derselben Bereinigung. Vorbild (Legacy-Mirror a7f2dac86):
 *
 * - `avesmapsLoreParsePage` (`api/_internal/wiki/lore-parsing.php`): die Art allein aus dem NAMEN der ersten Infobox (`Tierart` → Fauna, `Pflanzenart` → Flora, `Spezies` → Spezies,
 *   `Gegenstandsgruppe` → Ware; nie das Feld `Art`, nie Kategorien), die Parameter zeilenweise, die Zeichenverweise GENAU EINMAL aufgelöst, der Name ohne Auszeichnung (sonst der Seitentitel),
 *   die Ortslinks nur aus den Ortsfeldern (`Verbreitung` bei Fauna und Flora, `Regionen` bei der Spezies, `Herkunft` und `Verbreitung` bei der Ware; nie `Vorkommen`, das trägt den Lebensraum);
 * - `avesmapsLoreBuildCatalogStep` (`lore-sync.php`): die Längen der Spalten, die Ablage der Ortszeilen (Schlüssel `avesmapsPoliticalSlug(avesmapsWikiSyncMonitorNormalizeTitle(Titel))`, die
 *   Stelle läuft über alle Links des Artikels, ein gleicher Schlüssel in derselben Beziehung überschreibt Titel und Stelle) und der Kontinent (`avesmapsLoreDetectContinent`: Klammerzusätze des
 *   Titels und wörtliche `[[Kategorie:…]]`, ohne Signal leer).
 *
 * Gewollte Erweiterung: die Kurzbeschreibung (`kurzbeschreibung.ts`), die Legacy nicht liest; alle anderen Felder sind Legacys, Zeichen für Zeichen.
 *
 * 🔴 Ein Feld, das der Artikel nicht oder leer nennt, fehlt im Ergebnis: „das Wiki kennt nichts“, nie ein Leerstring (wie `lesen.ts`). Gewollte Abweichung von Legacy: Eine Infobox ohne
 * schließende Klammer ist ein Befund (wie in allen Bereichen), Legacy las sie bis zum Ende des Textes.
 */

export const VORKOMMEN_ARTEN = ["fauna", "flora", "spezies", "ware"] as const;
export type VorkommenArt = (typeof VORKOMMEN_ARTEN)[number];

export const VORKOMMEN_BEZIEHUNGEN = ["verbreitung", "vorkommen", "herkunft", "regionen"] as const;
export type VorkommenBeziehung = (typeof VORKOMMEN_BEZIEHUNGEN)[number];

/**
 * Die Felder eines Vorkommens im Abgleich, in der Reihenfolge, in der der Bericht sie zeigt. Die ersten sieben führt der Eintrag selbst (`lore_entry`, Vermerk in `lore_entry_field_origin`): die sechs,
 * die Legacy aus der Infobox liest, und die Kurzbeschreibung aus dem Text des Artikels (WI-0260, `kurzbeschreibung.ts`, Migration 0252). Die vier `roh_*` sind die Rohtexte der Infobox und stehen nur
 * im Wiki-Stand (`wiki_lore_snapshot`): Damit meldet der Bericht keine Dauerbefunde, wenn das Wiki sich nicht bewegt hat, und die Regelvorschläge lesen den Wortlaut. `liste` (WI-0299, Migration 0334) steht
 * ebenso nur im Wiki-Stand: der Titel der Unterseite `<Titel>/Liste`, wo der Dump eine führt. Ihn liest nicht die Infobox, sondern der Plan aus dem Dump (`abgleich/vorkommen-liste.ts`).
 */
export const VORKOMMEN_FELDER: readonly string[] = [
    "name",
    "gruppe",
    "typ",
    "lebensraum",
    "synonyme",
    "continent",
    "kurzbeschreibung",
    "roh_verbreitung",
    "roh_herkunft",
    "roh_regionen",
    "roh_vorkommen",
    "liste",
];

/** Die Felder, die der Eintrag selbst führt (`lore_entry`). */
export const VORKOMMEN_EIGENE_FELDER: readonly string[] = VORKOMMEN_FELDER.slice(0, 7);

/** Infobox-Name (Schlüsselform) → Art (Legacy `AVESMAPS_LORE_INFOBOX_KINDS`); EXAKTER Vergleich, kein `includes`. */
const ART_JE_INFOBOX: Readonly<Record<string, VorkommenArt>> = {
    tierart: "fauna",
    pflanzenart: "flora",
    spezies: "spezies",
    gegenstandsgruppe: "ware",
};

/** Je Art: Parameter (Schlüsselform) → Beziehung (Legacy `AVESMAPS_LORE_PLACE_FIELDS`). Nur aus diesen Feldern kommen Ortslinks. */
const ORTSFELDER: Readonly<Record<VorkommenArt, readonly (readonly [string, VorkommenBeziehung])[]>> = {
    fauna: [["verbreitung", "verbreitung"]],
    flora: [["verbreitung", "verbreitung"]],
    spezies: [["regionen", "regionen"]],
    ware: [
        ["herkunft", "herkunft"],
        ["verbreitung", "verbreitung"],
    ],
};

/** Die Art zu einem Infobox-Namen (Legacy `avesmapsLoreKindForInfoboxName`); `null`, wenn es keine der vier ist. */
export function artDerInfobox(infoboxName: string): VorkommenArt | null {
    return ART_JE_INFOBOX[schluesselform(infoboxName)] ?? null;
}

/** Linkziele mit diesen Vorsilben sind nie Orte (Legacy `AVESMAPS_LORE_LINK_SKIP_PREFIXES`). */
const SKIP_VORSILBEN = ["kategorie:", "datei:", "bild:", "vorlage:", "category:", "file:"];

const ORTSLINK = new RegExp(`\\[\\[${LEER}*([^\\]|#<>\\[]+?)${LEER}*(?:#[^\\]|]*)?(?:\\|[^\\]]*)?\\]\\]`, "gu");

/**
 * Alle Wikilink-Ziele eines Feldwerts, in der Reihenfolge des Texts und je Feld einmal (ohne Rücksicht auf Groß und Klein; Legacy `avesmapsLoreExtractPlaceLinks`). Anzeigetext und Anker fallen
 * weg. Ein Wort aus zwei Links (`[[Schaf]]s[[wolle]]`) ergibt zwei Ziele.
 */
export function ortsLinks(wert: string): string[] {
    if (phpTrim(wert) === "" || !wert.includes("[[")) return [];
    const aus: string[] = [];
    const gesehen = new Set<string>();
    for (const treffer of wert.matchAll(ORTSLINK)) {
        const titel = phpTrim((treffer[1] ?? "").replaceAll("_", " ").replace(new RegExp(`${LEER}+`, "gu"), " "));
        if (titel === "") continue;
        const klein = titel.toLowerCase();
        if (SKIP_VORSILBEN.some((vorsilbe) => klein.startsWith(vorsilbe))) continue;
        if (gesehen.has(klein)) continue;
        gesehen.add(klein);
        aus.push(titel);
    }
    return aus;
}

/** Eine Ortsverknüpfung des Artikels, so wie Legacys Staging sie ablegt: Titel, Schlüssel, Beziehung und Stelle. */
export interface VorkommenOrt {
    /** Der Linktitel, 300 Zeichen. */
    titel: string;
    /** Legacys Schlüssel: `avesmapsPoliticalSlug(avesmapsWikiSyncMonitorNormalizeTitle(Titel))`, ohne `wiki:`. */
    schluessel: string;
    beziehung: VorkommenBeziehung;
    /** Die Stelle im Artikel (0 an), gezählt über alle Links aller Ortsfelder. */
    stelle: number;
}

const KLAMMER = /\(([^)]+)\)/gu;
const KATEGORIE = new RegExp(`\\[\\[${LEER}*Kategorie${LEER}*:${LEER}*([^\\]|#]+)`, "giu");

/**
 * Der Kontinent eines Eintrags (Legacy `avesmapsLoreDetectContinent`): aus den Klammerzusätzen des Titels („Fischerspinne (Myranor)“) und den wörtlichen `[[Kategorie:…]]` des Texts. Ohne
 * Signal leer („nicht erkannt“, kein Kontinent); mit einem Signal, das keinen Kontinent nennt („(Gewürz)“), gilt die Vorgabe Aventurien.
 */
export function kontinentDesEintrags(titel: string, wikitext: string): string {
    const teile: string[] = [];
    for (const treffer of titel.matchAll(KLAMMER)) teile.push(phpTrim(treffer[1] ?? ""));
    for (const treffer of wikitext.matchAll(KATEGORIE)) teile.push(phpTrim(treffer[1] ?? ""));
    const kontext = teile.filter((teil) => teil !== "").join(" ");
    return kontext === "" ? "" : kuerze(erkenneKontinent(kontext), 120);
}

export type VorkommenGrund = "keine_infobox" | "nicht_geschlossen" | "fremde_infobox";

export type VorkommenErgebnis =
    | {
          ok: true;
          infobox: string;
          art: VorkommenArt;
          /** Legacys `lore_entry.wiki_key` zu diesem Titel (Slug, Umlaute fallen weg). */
          wikiKey: string;
          felder: Readonly<Record<string, string>>;
          /** Die Ortsverknüpfungen wie im Staging von Legacy: je Schlüssel und Beziehung einmal, nach der Stelle sortiert. */
          orte: readonly VorkommenOrt[];
      }
    | { ok: false; grund: VorkommenGrund; infobox: string };

function setze(felder: Record<string, string>, name: string, wert: string): void {
    if (wert !== "") felder[name] = wert;
}

/**
 * Liest einen Vorkommen-Artikel. Ohne Infobox, mit offener Klammer oder mit einer Infobox, die keine der vier Arten ist, ist die Seite kein Vorkommen; das ist ein Befund, nie ein Raten.
 */
export function leseVorkommen(seite: Infoboxseite): VorkommenErgebnis {
    const infobox = seite.infobox;
    if (infobox === "") return { ok: false, grund: "keine_infobox", infobox };
    const art = artDerInfobox(infobox);
    if (art === null) return { ok: false, grund: "fremde_infobox", infobox };
    if (!seite.block.geschlossen) return { ok: false, grund: "nicht_geschlossen", infobox };

    // EIN Durchgang für alle Werte (Legacy: `array_map('avesmapsLoreDecodeEntities', $params)`), nie ein zweiter.
    const parameter = new Map<string, string>();
    for (const [name, wert] of leseParameter(seite.block.block)) parameter.set(name, entschluesseleHtml(wert));
    const norm = normalisiereFelder(parameter);
    const roh = (schluessel: readonly string[]): string => feldRoh(norm, schluessel);

    const name = ohneAuszeichnung(phpTrim(roh(["name"])));
    const felder: Record<string, string> = {};
    setze(felder, "name", kuerze(name === "" ? seite.titel : name, 300));
    setze(felder, "gruppe", kuerze(phpTrim(roh(["art"])), 300));
    setze(felder, "typ", kuerze(phpTrim(roh(["gegenstandstyp"])), 300));
    setze(felder, "lebensraum", kuerze(phpTrim(roh(["vorkommen"])), 500));
    setze(felder, "synonyme", kuerze(phpTrim(roh(["weiterenamen", "beinamen"])), 500));
    setze(felder, "continent", kontinentDesEintrags(seite.titel, seite.wikitext));
    // Nicht aus der Infobox, sondern aus dem Text des Artikels (WI-0260): fehlt sie oder besteht sie nur aus Zitat oder Ulisses-Inhalt, fehlt das Feld („das Wiki kennt nichts“).
    setze(felder, "kurzbeschreibung", kurzbeschreibungVon(seite.wikitext) ?? "");
    // Die Rohtexte: so, wie das Wiki sie führt (Zeichenverweise einmal aufgelöst, Leerraum an den Rändern weg), mit allen Links; sie gehören in den Wiki-Stand, nie in ein Fachfeld.
    setze(felder, "roh_verbreitung", phpTrim(roh(["verbreitung"])));
    setze(felder, "roh_herkunft", phpTrim(roh(["herkunft"])));
    setze(felder, "roh_regionen", phpTrim(roh(["regionen"])));
    setze(felder, "roh_vorkommen", phpTrim(roh(["vorkommen"])));

    // Die Ortsverknüpfungen wie Legacys Staging: Stelle über alle Links, ein gleicher Schlüssel in derselben Beziehung überschreibt Titel und Stelle.
    const jeSchluessel = new Map<string, VorkommenOrt>();
    let stelle = 0;
    for (const [feldName, beziehung] of ORTSFELDER[art]) {
        for (const titel of ortsLinks(roh([feldName]))) {
            const schluessel = publikationsSchluessel(titel);
            if (schluessel === "") continue;
            jeSchluessel.set(`${schluessel}|${beziehung}`, {
                titel: kuerze(titel, 300),
                schluessel,
                beziehung,
                stelle,
            });
            stelle += 1;
        }
    }
    const orte = [...jeSchluessel.values()].sort((a, b) => a.stelle - b.stelle);
    return { ok: true, infobox, art, wikiKey: publikationsSchluessel(seite.titel), felder, orte };
}
