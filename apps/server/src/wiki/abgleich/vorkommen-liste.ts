import type { GelesenerDumpArtikel } from "../dump/seiten-sammler.ts";
import { normTitel } from "./ortsrolle.ts";

/**
 * Die Unterseite „Liste“ eines Vorkommens (WI-0299, OPS-000104; Vorschlag eines Editors, Option „Jetzt bauen“ von Vali gewählt am 2026-11-09). Viele Artikel der Wiki Aventurica haben eine Unterseite
 * `<Titel>/Liste` mit ihren Varianten und Einzelexemplaren (Langschwert/Liste, Wolf/Liste), viele nicht (Sikrami). Die Infobox des Vorkommens verlinkt sie nur, wo es sie gibt; ohne diese Prüfung gäbe
 * es tote Links. REIN: keine Datenbank.
 *
 * Woher das Wissen kommt: Der Dump-Durchgang der Vorschau sucht zu jedem Vorkommen auch den Titel seiner Unterseite (`gesuchteListen`); was er findet, steht in `gefunden` wie jeder gesuchte Titel.
 * Daraus werden die vorhandenen Unterseiten (`listenImDump`), und der Plan setzt das Feld `liste` des Artikels (`listeDes`). Es steht nur im Wiki-Stand (`wiki_lore_snapshot.liste`, Migration 0334), wie die
 * Rohtexte der Infobox: Die Unterseite ist eine Auskunft des Wikis, keine Angabe, über die die Redaktion entscheidet.
 *
 * 🔴 Ohne die Auskunft des Dumps (der Vergleich eines einzelnen Artikels über die API, `wiki/artikel/vergleich.ts`) weiß der Plan nichts über die Unterseite und vergleicht das Feld nicht: Ein
 * „fehlt“ dort hieße sonst, der Link verschwände bis zum nächsten Lauf.
 */

/** Das Feld des Plans und die Spalte des Wiki-Stands. */
export const LISTE_FELD = "liste";

/** Der Name der Unterseite, wie das Wiki sie führt. */
const UNTERSEITE = "/Liste";

/** Der Titel der Unterseite eines Artikels, in der Schreibweise des Artikels (`Langschwert` → `Langschwert/Liste`). */
export const listenTitel = (artikel: string): string => `${artikel}${UNTERSEITE}`;

/** Die Titel, die der Dump-Durchgang zu den Artikeln der Vorkommen zusätzlich sucht. */
export function gesuchteListen(artikel: Iterable<string>): Set<string> {
    const gesucht = new Set<string>();
    for (const titel of artikel) gesucht.add(listenTitel(titel));
    return gesucht;
}

/**
 * Die Unterseiten „Liste“, die der Dump führt, aus allem, was er zu den gesuchten Titeln gefunden hat. Eine Seite zählt, wenn sie ein Artikel ist oder eine Weiterleitung auf eine andere Seite als den
 * Artikel selbst (das Wiki folgt ihr); eine Weiterleitung zurück auf den Artikel wäre ein Link, der nur wieder dorthin führt, woher er kam.
 */
export function listenImDump(gefunden: ReadonlyMap<string, readonly GelesenerDumpArtikel[]>): Set<string> {
    const listen = new Set<string>();
    for (const [titel, seiten] of gefunden) {
        if (!titel.endsWith(UNTERSEITE) || titel.length === UNTERSEITE.length) continue;
        const artikel = normTitel(titel.slice(0, -UNTERSEITE.length));
        const zaehlt = seiten.some(
            (seite) => seite.weiterleitung === null || normTitel(seite.weiterleitung.split("#")[0] ?? "") !== artikel,
        );
        if (zaehlt) listen.add(titel);
    }
    return listen;
}

/** Der Wert des Felds `liste` für einen Artikel (sein Titel, wie der Dump ihn führt): der Titel der Unterseite, `undefined` ohne eine. */
export function listeDes(artikel: string, listen: ReadonlySet<string>): string | undefined {
    const titel = listenTitel(artikel);
    return listen.has(titel) ? titel : undefined;
}
