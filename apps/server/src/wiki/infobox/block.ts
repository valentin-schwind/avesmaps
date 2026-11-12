import { LEER, LEER_FOLGE, ZEILENENDE, phpTrim, schluesselform } from "./text.ts";

/**
 * Der Infobox-Kasten im Wikitext einer Seite (WI-0253 C): sein Name, sein Block, seine Parameter. Legacy `sync-monitor-parsing.php`
 * (`avesmapsWikiSyncMonitorInfoboxName`, `…ExtractInfoboxBlock`, `…ParseTemplateParams`, `…NormFields`, `…Field`), Zeichen für Zeichen.
 *
 * - Der Block ist GENAU der Infobox-Kasten, per Klammerzählung; große Artikel tragen davor Wartungsvorlagen, die nicht gemeint sind.
 * - Ein Parameter beginnt in einer Zeile mit `|Name=`, solange kein `{{` offen ist; alles danach bis zum nächsten Parameter gehört zu seinem Wert.
 * - 🪤 Ein Parameter in der ERSTEN Zeile des Kastens (`{{Infobox Siedlung|Name=X`) fehlt: Legacy liest zeilenweise und kennt die Zeile mit der
 *   Vorlage nicht als Parameterzeile. Gleiches Verhalten, damit ein Wert so lautet wie im Legacy-Zug.
 */

/** Der Name der ersten Infobox der Seite („Siedlung”, „Straße”), wie Legacy ihn liest; `""`, wenn die Seite keine trägt. */
export function infoboxName(wikitext: string): string {
    const treffer = /\{\{\s*Infobox\s+([^\n|}]+)/u.exec(wikitext);
    if (treffer === null) return "";
    return phpTrim((treffer[1] ?? "").replace(LEER_FOLGE, " "));
}

export interface InfoboxBlock {
    /** Der Block ab `{{Infobox`; `""`, wenn die Seite keinen trägt. */
    block: string;
    /** Ist die Klammer des Kastens geschlossen? Sonst reicht der Block bis zum Ende des Textes (kaputte Infobox). */
    geschlossen: boolean;
    /** Wo der Block im Text beginnt; `-1` ohne Block. */
    anfang: number;
}

/** Der Block der ersten Infobox, per Zählung von `{{` und `}}`. */
export function extrahiereInfoboxBlock(wikitext: string): InfoboxBlock {
    const start = /\{\{\s*Infobox\s+/u.exec(wikitext);
    if (start === null) return { block: "", geschlossen: false, anfang: -1 };
    const anfang = start.index;
    let tiefe = 0;
    for (let i = anfang; i < wikitext.length - 1; i += 1) {
        const paar = wikitext.slice(i, i + 2);
        if (paar === "{{") {
            tiefe += 1;
            i += 1;
            continue;
        }
        if (paar === "}}") {
            tiefe -= 1;
            i += 1;
            if (tiefe === 0) return { block: wikitext.slice(anfang, i + 1), geschlossen: true, anfang };
        }
    }
    return { block: wikitext.slice(anfang), geschlossen: false, anfang };
}

function zaehle(text: string, marke: string): number {
    let anzahl = 0;
    for (let index = text.indexOf(marke); index !== -1; index = text.indexOf(marke, index + marke.length)) anzahl += 1;
    return anzahl;
}

const PARAMETERZEILE = new RegExp(`^${LEER}*\\|${LEER}*([^=\\n]+?)${LEER}*=${LEER}*(.*)$`, "u");

/** Die Parameter eines Blocks, in der Reihenfolge der Seite; ein Wert mit verschachtelten Vorlagen behält seine Zeilen. */
export function leseParameter(block: string): Map<string, string> {
    const parameter = new Map<string, string>();
    let schluessel: string | null = null;
    let wert = "";
    let tiefe = 0;
    for (const zeile of block.split(ZEILENENDE)) {
        const treffer = tiefe === 0 ? PARAMETERZEILE.exec(zeile) : null;
        if (treffer !== null) {
            if (schluessel !== null) parameter.set(schluessel, wert);
            schluessel = phpTrim(treffer[1] ?? "");
            wert = treffer[2] ?? "";
        } else if (schluessel !== null) {
            wert += `\n${zeile}`;
        }
        tiefe = Math.max(0, zaehle(wert, "{{") - zaehle(wert, "}}"));
    }
    if (schluessel !== null) parameter.set(schluessel, wert.replace(new RegExp(`\\}\\}${LEER}*$`, "u"), ""));
    return parameter;
}

/** Die Parameter unter ihrer Schlüsselform; bei zwei gleichen Formen (`Länge`, `Lange`) gewinnt der erste. */
export function normalisiereFelder(parameter: ReadonlyMap<string, string>): Map<string, string> {
    const norm = new Map<string, string>();
    for (const [schluessel, wert] of parameter) {
        const form = schluesselform(schluessel);
        if (form !== "" && !norm.has(form)) norm.set(form, wert);
    }
    return norm;
}

/** Der erste der Schlüssel (Schlüsselform), dessen Wert nicht leer ist; roh, wie die Seite ihn führt. `""`, wenn keiner. */
export function feldRoh(norm: ReadonlyMap<string, string>, schluessel: readonly string[]): string {
    for (const eintrag of schluessel) {
        const wert = norm.get(eintrag);
        if (wert !== undefined && phpTrim(wert) !== "") return wert;
    }
    return "";
}
