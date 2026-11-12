import type { InfoboxBlock } from "./block.ts";
import { LEER, LEER_FOLGE, ZEILENENDE, bereinige, kuerze, phpTrim } from "./text.ts";

/**
 * Die Kurzbeschreibung und die Verlaufsstationen eines Artikels (WI-0253 C; Legacy `avesmapsWikiPathExtractDescription` /
 * `avesmapsWikiSettlementExtractDescription` / `avesmapsWikiRegionExtractDescription` – eine Regel – und `avesmapsWikiPathExtractVerlaufStations`
 * in `paths.php`). Zeichen für Zeichen nach Legacy.
 */

const BLOCK_ANFAENGE = ["{{", "|", "}", "==", "*", "#", ":", "<", "!"] as const;
const DATEI_ZEILE = new RegExp(`^\\[\\[${LEER}*(Datei|File|Bild|Kategorie|Category)${LEER}*:`, "iu");
const ALLES = "[\\s\\S]";

/** Der erste Prosa-Absatz nach dem Infobox-Kasten, ohne Auszeichnung, höchstens 1.200 Zeichen. */
export function ersterAbsatz(wikitext: string, infobox: InfoboxBlock): string {
    const rest = infobox.anfang >= 0 ? wikitext.slice(infobox.anfang + infobox.block.length) : wikitext;
    const absatz: string[] = [];
    for (const zeile of rest.split(ZEILENENDE)) {
        const getrimmt = phpTrim(zeile);
        if (getrimmt === "") {
            if (absatz.length > 0) break;
            continue;
        }
        if (
            absatz.length === 0 &&
            (BLOCK_ANFAENGE.some((anfang) => getrimmt.startsWith(anfang)) || DATEI_ZEILE.test(getrimmt))
        ) {
            continue;
        }
        absatz.push(getrimmt);
        if (Array.from(absatz.join(" ")).length > 700) break;
    }
    let text = phpTrim(absatz.join(" "));
    text = text.replace(new RegExp(`<ref[^>]*>${ALLES}*?<\\/ref>`, "gu"), "");
    text = text.replace(/<ref[^>]*\/>/gu, "");
    text = text.replace(/<\/?[a-zA-Z][^>]*>/gu, "");
    text = bereinige(text);
    text = text.replaceAll("'''", "").replaceAll("''", "");
    text = phpTrim(text.replace(LEER_FOLGE, " "));
    return kuerze(text, 1200);
}

function verknuepfungsziel(parameter: string): string | null {
    const link = /\[\[([^\]]+)\]\]/u.exec(parameter);
    if (link === null) return null;
    const teile = (link[1] ?? "").split("|");
    const station = phpTrim(teile[teile.length - 1] ?? "");
    return station !== "" && !station.includes(":") ? station : null;
}

function eindeutig(stationen: readonly string[]): string[] {
    return [...new Set(stationen)];
}

/**
 * Die Stationen auf dem Weg, in der Reihenfolge der Vorlagenzeilen im Verlauf. Das erste Positionsparameter einer Zeile ist die Station dieses
 * Weges; spätere sind Abzweigungen fremder Wege. Zufluss, Zusammenfluss, Flussquerung, Flussquelle und Anschluss tragen keine Station,
 * Straßenquerung und Flussmündung ihre zweite. Ohne Vorlagen im Verlauf zählt jeder Link der Reihe nach.
 */
export function verlaufsstationen(verlauf: string): string[] {
    const stationen: string[] = [];
    const schiebe = (parameter: string): void => {
        const ziel = verknuepfungsziel(parameter);
        if (ziel !== null) stationen.push(ziel);
    };

    if (!verlauf.includes("{{")) {
        for (const link of verlauf.matchAll(/\[\[([^\]]+)\]\]/gu)) schiebe(`[[${link[1] ?? ""}]]`);
        return eindeutig(stationen);
    }

    const zeilen = verlauf.matchAll(
        new RegExp(`\\{\\{${LEER}*([^{}|]+?)${LEER}*(\\|(?:[^{}]|\\{\\{[^{}]*\\}\\})*)?\\}\\}`, "gu"),
    );
    for (const zeile of zeilen) {
        const name = phpTrim(zeile[1] ?? "")
            .toLowerCase()
            .replaceAll("ß", "ss")
            .replaceAll("ä", "ae")
            .replaceAll("ö", "oe")
            .replaceAll("ü", "ue")
            .replaceAll(" ", "");
        if (
            name.startsWith("zufluss") ||
            name === "zusammenfluss" ||
            name === "flussquerung" ||
            name === "flussquelle" ||
            name === "anschluss"
        ) {
            continue;
        }
        const gesucht = name === "strassenquerung" || name === "flussmuendung" ? 2 : 1;
        // An Kopfebene teilen: Striche in [[Links]] und verschachtelten {{Vorlagen}} werden vorher verdeckt.
        const verdeckt = (zeile[2] ?? "").replace(
            new RegExp(`\\[\\[[^\\]]*\\]\\]|\\{\\{[^{}]*\\}\\}`, "gu"),
            (treffer) => treffer.replaceAll("|", "\u0001"),
        );
        let position = 0;
        for (const roh of verdeckt.split("|").slice(1)) {
            const parameter = roh.replaceAll("\u0001", "|");
            if (new RegExp(`^${LEER}*[\\w\\u00c0-\\u017f]+${LEER}*=`, "u").test(parameter)) continue;
            position += 1;
            if (position === gesucht) {
                schiebe(parameter);
                break;
            }
        }
    }
    return eindeutig(stationen);
}
