import { saetzeVon } from "@avesmaps3d/shared";
import { LEER_FOLGE, ZEILENENDE, entschluesseleHtml, phpTrim } from "./text.ts";

/**
 * Die Kurzbeschreibung eines Vorkommens aus seinem Wiki-Artikel (WI-0260; Vali 2026-10-30: „ja das wär nett“). REIN: Wikitext hinein, reiner Text oder `null` hinaus.
 *
 * - **Quelle:** der Abschnitt „Kurzbeschreibung“ (im Wiki Aventurica steht die Überschrift VOR der Infobox, der Text folgt ihr); fehlt die Überschrift, der erste Absatz nach der Infobox bis zur
 *   ersten Überschrift (steht die Überschrift doppelt, gelten beide in ihrer Reihenfolge). Gewählt wird der ERSTE Absatz mit Fließtext: Bilder, Vorlagen, Listen, Tabellen und Einrückungen zählen nicht,
 *   und eine Liste, die ohne leere Zeile unter dem Satz steht, gehört nicht zu ihm.
 * - **Reiner Text:** Vorlagen (mit allem, was in ihnen steht), Einzelnachweise, Kommentare, Bilder und Kategorien fallen weg; ein Link wird zu seinem Anzeigetext, Fett und Kursiv fallen weg,
 *   Zeichenverweise werden aufgelöst, Leerraum wird ein Leerzeichen. Eine Datumsvorlage (`{{Datum|…}}`) bleibt als Datum stehen: Sie ist Teil des Satzes.
 * - 🔴 **Weggelassen werden Zitate und Inhalte der Ulisses Medien & Spiel Distribution GmbH.** Der Fuß des Wikis sagt: Text steht unter CC BY-SA 3.0 „bis auf Zitate“, und Inhalte von Ulisses sind
 *   „entsprechend markiert“. Das Wiki markiert Text so, und das erkennt der Leser: eine Vorlage der Zitatfamilie (`Zitat`, `Ingame-Zitat`, `Zitatvorlage`, `Zitathinweis`, `Lizenzzitat`, `Klappentext`,
 *   `Errata`, `Hinweis Inhaltsverzeichnis`; Name enthält „Zitat“ oder steht in `ZITAT_VORLAGEN`), ein `<blockquote>`, ein Link auf den Ulisses-Disclaimer (jeder Absatz, der ihn nennt, ist
 *   Ulisses-Inhalt) und, vorsichtshalber, ein Absatz, der als Ganzes in Anführungszeichen steht. Besteht der erste Absatz nur daraus, gibt es KEINE Kurzbeschreibung (`null`); ein Satz, der daneben
 *   steht, bleibt, das Zitat fällt weg. Gewollt hart: lieber keine Kurzbeschreibung als ein Zitat unter falscher Lizenz.
 * - **Länge:** höchstens drei Sätze und `KURZBESCHREIBUNG_MAX_ZEICHEN` Zeichen, immer an einer Satzgrenze; ist schon der erste Satz länger, wird er am letzten Satzzeichen (sonst Wort) vor der Grenze
 *   gekürzt und trägt „…“.
 */

export const KURZBESCHREIBUNG_MAX_SAETZE = 3;
export const KURZBESCHREIBUNG_MAX_ZEICHEN = 400;

/** Vorlagen, deren Inhalt zitiert oder von Ulisses ist, ohne dass „Zitat“ im Namen steht (Namen in Kleinschreibung, Leerzeichen statt Unterstrich). */
const ZITAT_VORLAGEN: ReadonlySet<string> = new Set([
    "klappentext",
    "errata",
    "erratum",
    "hinweis inhaltsverzeichnis",
    "offizielles inhaltsverzeichnis",
]);

/** Marken im Text, die nach der Vorlagenbereinigung stehen bleiben: ein Zitat, die Stelle der Infobox und der Platzhalter „Kurzbeschreibung fehlt“. */
const ZITAT = "\u0001";
const INFOBOX = "\u0002";
const FEHLT = "\u0003";

const istZitatVorlage = (name: string): boolean => name.includes("zitat") || ZITAT_VORLAGEN.has(name);

/** Der Name einer Vorlage: bis zum ersten `|` oder Zeilenende, klein, Unterstrich und Leerraum zu einem Leerzeichen. */
function vorlagenName(inhalt: string): string {
    const ende = inhalt.search(/[|\n]/u);
    const roh = ende < 0 ? inhalt : inhalt.slice(0, ende);
    return phpTrim(roh.replaceAll("_", " ").replace(LEER_FOLGE, " ")).toLowerCase();
}

/** `{{Datum|1|Praios|1000}}` → „1. Praios 1000“; bei weniger als vier Teilen die Teile mit Leerzeichen. */
function datum(inhalt: string): string {
    const teile = inhalt
        .split("|")
        .slice(1)
        .map((teil) => phpTrim(teil))
        .filter((teil) => teil !== "");
    if (teile.length >= 4) return `${teile[0] ?? ""}. ${teile[1] ?? ""} ${teile[2] ?? ""} ${teile[3] ?? ""}`;
    return teile.join(" ");
}

/**
 * Entfernt alle Vorlagen (`{{…}}`, beliebig verschachtelt): eine Zitatvorlage wird die Marke `ZITAT`, die erste Infobox die Marke `INFOBOX`, eine Datumsvorlage ihr Datum, jede andere nichts. Eine
 * Vorlage, die nie schließt, nimmt den Rest des Textes mit (lieber zu wenig als eine halbe Vorlage im Text).
 */
function ohneVorlagen(text: string): string {
    let aus = "";
    let i = 0;
    let infoboxGesehen = false;
    while (i < text.length) {
        const start = text.indexOf("{{", i);
        if (start < 0) {
            aus += text.slice(i);
            break;
        }
        aus += text.slice(i, start);
        let tiefe = 0;
        let j = start;
        let ende = -1;
        while (j < text.length - 1) {
            const paar = text.slice(j, j + 2);
            if (paar === "{{") {
                tiefe += 1;
                j += 2;
            } else if (paar === "}}") {
                tiefe -= 1;
                j += 2;
                if (tiefe === 0) {
                    ende = j;
                    break;
                }
            } else {
                j += 1;
            }
        }
        if (ende < 0) break;
        const inhalt = text.slice(start + 2, ende - 2);
        const name = vorlagenName(inhalt);
        if (name === "kurzbeschreibung fehlt") aus += FEHLT;
        else if (istZitatVorlage(name)) aus += ZITAT;
        else if (name.startsWith("infobox") && !infoboxGesehen) {
            infoboxGesehen = true;
            aus += INFOBOX;
        } else if (name === "datum") aus += datum(inhalt);
        i = ende;
    }
    return aus;
}

const UEBERSCHRIFT = /^[ \t]*(={1,6})[ \t]*(.*?)[ \t]*\1[ \t]*$/u;

/** Der Text einer Überschrift ohne Links und Auszeichnung, klein. */
function ueberschriftText(text: string): string {
    return phpTrim(text.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/gu, "$1").replaceAll("'", "")).toLowerCase();
}

/** Die erste Zeichenfolge, mit der ein Absatz kein Fließtext ist: Liste, Einrückung, Definition, Tabelle, Überschrift. */
const KEIN_FLIESSTEXT = /^(?:[*#:;|!=]|\{\|)/u;

const BILD_ODER_KATEGORIE = /^(?:datei|file|bild|image|kategorie|category)$/iu;

/** Löst `[[…]]` auf (verschachtelt): Bilder und Kategorien fallen weg, ein Link wird sein Anzeigetext. */
function ohneLinks(text: string): string {
    let aus = "";
    let i = 0;
    while (i < text.length) {
        const start = text.indexOf("[[", i);
        if (start < 0) {
            aus += text.slice(i);
            break;
        }
        aus += text.slice(i, start);
        let tiefe = 0;
        let j = start;
        let ende = -1;
        while (j < text.length - 1) {
            const paar = text.slice(j, j + 2);
            if (paar === "[[") {
                tiefe += 1;
                j += 2;
            } else if (paar === "]]") {
                tiefe -= 1;
                j += 2;
                if (tiefe === 0) {
                    ende = j;
                    break;
                }
            } else {
                j += 1;
            }
        }
        if (ende < 0) {
            aus += text.slice(start + 2);
            break;
        }
        const inhalt = text.slice(start + 2, ende - 2);
        const strich = inhalt.indexOf("|");
        const ziel = phpTrim(strich < 0 ? inhalt : inhalt.slice(0, strich));
        const raum = /^([^:]+):/u.exec(ziel);
        if (!ziel.startsWith(":") && raum !== null && BILD_ODER_KATEGORIE.test(phpTrim(raum[1] ?? ""))) {
            i = ende;
            continue;
        }
        let anzeige = strich < 0 ? ziel : phpTrim(inhalt.slice(strich + 1));
        if (anzeige === "") {
            // Die Strich-Abkürzung (`[[Ziel (Zusatz)|]]`): das Ziel ohne Raum und ohne Klammerzusatz.
            anzeige = phpTrim(ziel.replace(/^:?[^:]*:/u, "").replace(/\s*\([^)]*\)\s*$/u, ""));
        } else if (strich < 0) {
            // Ein Link auf eine andere Wiki (`[[wpde:Salami]]`) zeigt das Ziel ohne Vorsilbe.
            anzeige = anzeige.replace(/^:?[a-z]{2,8}:(?=\S)/u, "");
        }
        aus += anzeige.replace(/^:/u, "");
        i = ende;
    }
    return aus;
}

/** Ein Absatz als reiner Text: Links, externe Links, Auszeichnung, Tags und Zeichenverweise, Leerraum zu einem Leerzeichen. */
function reinerText(absatz: string): string {
    let text = ohneLinks(absatz);
    text = text.replace(
        /\[(?:https?:)?\/\/[^\s\]]+(?:[ \t]+([^\]]*))?\]/gu,
        (_t: string, anzeige: string | undefined) => anzeige ?? "",
    );
    text = text.replace(/https?:\/\/\S+/gu, "");
    text = text.replace(/<\/?br\b[^>]*>/giu, " ");
    text = text.replace(/<\/?[a-zA-Z][^<>]*>/gu, "");
    text = text.replaceAll("'''", "").replaceAll("''", "");
    text = text.replace(/__[A-Z]+__/gu, "");
    text = entschluesseleHtml(text);
    text = text.replace(/\{\{|\}\}|\[\[|\]\]/gu, "");
    return phpTrim(text.replace(LEER_FOLGE, " "));
}

// ----------------------------------------------------------------------------------------------------------------------------
// Sätze
// ----------------------------------------------------------------------------------------------------------------------------

/**
 * Die Sätze zerlegt die geteilte Regel (`@avesmaps3d/shared`, `saetze.ts`, seit WI-0257 S5): Die Infobox und der Sammelscreen zeigen daraus den ersten Satz,
 * und der Browser darf einen Satz nie anders schneiden als der Server.
 */
export { saetzeVon };

const laenge = (text: string): number => Array.from(text).length;

/** Kürzt einen zu langen Satz am letzten Satzzeichen (ab der Hälfte der Grenze), sonst am letzten Wort, und hängt „…“ an. */
function kuerzeSatz(satz: string, grenze: number): string {
    const zeichen = Array.from(satz);
    const stueck = zeichen.slice(0, grenze - 1).join("");
    const zeichensetzung = Math.max(stueck.lastIndexOf(", "), stueck.lastIndexOf("; "), stueck.lastIndexOf(": "));
    const wort = stueck.lastIndexOf(" ");
    const schnitt = zeichensetzung > grenze / 2 ? zeichensetzung : wort > 0 ? wort : stueck.length;
    return `${phpTrim(stueck.slice(0, schnitt)).replace(/[,;:]$/u, "")}…`;
}

/** Höchstens `KURZBESCHREIBUNG_MAX_SAETZE` Sätze und `KURZBESCHREIBUNG_MAX_ZEICHEN` Zeichen, an einer Satzgrenze. */
export function kuerzeAufSaetze(text: string): string {
    // Ein Satz, der mit einem Doppelpunkt endet, leitet eine Liste ein; er und alles danach gehören nicht zur Beschreibung.
    const alle = saetzeVon(text);
    const eingeleitet = alle.findIndex((satz) => satz.endsWith(":"));
    const saetze = (eingeleitet < 0 ? alle : alle.slice(0, eingeleitet)).slice(0, KURZBESCHREIBUNG_MAX_SAETZE);
    let aus = "";
    for (const satz of saetze) {
        const kandidat = aus === "" ? satz : `${aus} ${satz}`;
        if (laenge(kandidat) > KURZBESCHREIBUNG_MAX_ZEICHEN) break;
        aus = kandidat;
    }
    if (aus === "" && saetze[0] !== undefined) return kuerzeSatz(saetze[0], KURZBESCHREIBUNG_MAX_ZEICHEN);
    return aus;
}

// ----------------------------------------------------------------------------------------------------------------------------
// Der Leser
// ----------------------------------------------------------------------------------------------------------------------------

const ULISSES_DISCLAIMER = /ulisses-disclaimer/iu;

/** Ein Absatz, der als Ganzes in Anführungszeichen steht, gilt als Zitat. */
const istGanzesZitat = (text: string): boolean => /^[„»‚“"]/u.test(text) && /["“”«’]$/u.test(text);

/** Ein Absatz in der Reihenfolge des Textes; eine Liste, Einrückung, Definition oder Tabelle ist kein Fließtext. */
interface Block {
    zeilen: string[];
    liste: boolean;
}

/**
 * Die Abschnitte „Kurzbeschreibung“ (steht die Überschrift doppelt, beide in ihrer Reihenfolge); ohne sie ein Abschnitt aus den Zeilen nach der Infobox bis zur ersten Überschrift (ohne Infobox:
 * vom Anfang).
 */
function abschnitte(text: string): string[][] {
    const zeilen = text.split(ZEILENENDE);
    const aus: string[][] = [];
    zeilen.forEach((zeile, i) => {
        const treffer = UEBERSCHRIFT.exec(zeile);
        if (treffer === null || ueberschriftText(treffer[2] ?? "") !== "kurzbeschreibung") return;
        const rest = zeilen.slice(i + 1);
        const naechste = rest.findIndex((z) => UEBERSCHRIFT.test(z));
        aus.push(naechste < 0 ? rest : rest.slice(0, naechste));
    });
    if (aus.length > 0) return aus;
    const kasten = text.indexOf(INFOBOX);
    const nach = (kasten < 0 ? text : text.slice(kasten + 1)).split(ZEILENENDE);
    const erste = nach.findIndex((zeile) => UEBERSCHRIFT.test(zeile));
    return [erste < 0 ? nach : nach.slice(0, erste)];
}

/** Zerlegt Zeilen in Blöcke: Eine leere Zeile trennt, eine Listenzeile beginnt einen Listenblock, auch ohne leere Zeile davor (`Text⏎;Sorten⏎*Eins`). */
function bloecke(zeilen: readonly string[]): Block[] {
    const aus: Block[] = [];
    let aktuell: Block | null = null;
    for (const zeile of zeilen) {
        const getrimmt = phpTrim(zeile);
        if (getrimmt === "") {
            aktuell = null;
            continue;
        }
        const liste = KEIN_FLIESSTEXT.test(getrimmt.replaceAll(INFOBOX, "").replaceAll(ZITAT, ""));
        if (aktuell === null || aktuell.liste !== liste) {
            aktuell = { zeilen: [], liste };
            aus.push(aktuell);
        }
        aktuell.zeilen.push(getrimmt);
    }
    return aus;
}

/** Der Wikitext vor der Auswertung: Kommentare, Einzelnachweise, Galerien und Zitat-Blöcke weg, Vorlagen aufgelöst, Tabellen weg. */
function vorbereitet(wikitext: string): string {
    // eslint-disable-next-line no-control-regex -- die Marken sind Steuerzeichen; kämen sie im Text vor, würden sie sonst als Zitat gelesen
    let text = wikitext.replace(/[\u0001-\u0003]/gu, "");
    text = text.replace(/<!--[\s\S]*?-->/gu, "");
    text = text.replace(/<ref\b[^>]*\/>/giu, "");
    text = text.replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/giu, "");
    text = text.replace(/<gallery\b[^>]*>[\s\S]*?<\/gallery>/giu, "");
    text = text.replace(/<blockquote\b[^>]*>[\s\S]*?<\/blockquote>/giu, ZITAT);
    text = ohneVorlagen(text);
    return text.replace(/^\{\|[\s\S]*?^\|\}[^\n]*$/gmu, "");
}

/** Ein Rest wie „…, ...“ am Ende: Der Satz wurde nie geschrieben. */
const PLATZHALTER = /(?:\.\.\.|…)$/u;

/**
 * Die Kurzbeschreibung eines Artikels, oder `null`: kein Absatz mit Fließtext, nur Zitat oder Ulisses-Inhalt, ein Platzhalter („Kurzbeschreibung fehlt“, ein Satz, der mit „...“ abbricht), weniger als
 * drei Wörter oder nur der Anfang einer Liste („… sind folgende Arten zusammengefasst:“).
 */
export function kurzbeschreibungVon(wikitext: string): string | null {
    for (const abschnitt of abschnitte(vorbereitet(wikitext))) {
        for (const block of bloecke(abschnitt)) {
            // Liste, Einrückung, Definition, Tabelle: kein Fließtext, weiter zum nächsten Absatz.
            if (block.liste) continue;
            const roh = block.zeilen.join(" ");
            // Das Wiki selbst sagt, dass die Kurzbeschreibung fehlt: Der Satz davor ist ein Anfang, den niemand zu Ende schrieb.
            if (roh.includes(FEHLT)) return null;
            const markiert = roh.includes(ZITAT) || ULISSES_DISCLAIMER.test(roh);
            const text = reinerText(roh.replaceAll(ZITAT, " ").replaceAll(INFOBOX, " "));
            if (!/\p{L}/u.test(text)) {
                // Nichts als Bilder, Kategorien oder Marken: kein Fließtext, weiter. Besteht der Absatz nur aus einem Zitat, gibt es keine Kurzbeschreibung.
                if (markiert) return null;
                continue;
            }
            if (ULISSES_DISCLAIMER.test(roh) || istGanzesZitat(text) || PLATZHALTER.test(text)) return null;
            const kurz = kuerzeAufSaetze(text);
            return kurz.split(" ").filter((wort) => /\p{L}/u.test(wort)).length >= 3 ? kurz : null;
        }
    }
    return null;
}
