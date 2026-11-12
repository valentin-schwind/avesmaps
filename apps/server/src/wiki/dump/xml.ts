/**
 * Das Lesen eines MediaWiki-Exports (WI-0253 B-1) auf der Ebene einer Seite: reine Zeichenfolgen-Funktionen, ohne Datei und ohne Prozess.
 * Der Export ist streng regelmäßig (`<page>` mit `<title>`, `<ns>`, `<id>`, `<redirect title="…"/>`, `<revision>` mit `<id>`, `<timestamp>`,
 * `<text>`); in Text und Attributen stehen nur die fünf Entitäten und Zeichenverweise, ein `<` oder `&` kommt nie roh vor. Deshalb genügt
 * das Suchen nach Marken, und es braucht keine XML-Bibliothek (keine neue Abhängigkeit für ein festes Format).
 */

export class DumpFehler extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
        super(message);
        this.name = "DumpFehler";
        this.code = code;
    }
}

export interface DumpRevision {
    id: number | null;
    /** ISO-Zeit der Revision, wie im Export. */
    zeit: string | null;
}

export interface DumpSeite {
    titel: string;
    ns: number;
    /** Die MediaWiki-Seitenkennung; `null`, wenn der Export keine trägt. */
    id: number | null;
    /** Das Ziel einer Weiterleitung (Titel samt Namensraum-Präfix), sonst `null`. */
    weiterleitung: string | null;
    /** Bei mehreren Revisionen (Verlaufsexport) die letzte; `null`, wenn die Seite keine trägt. */
    revision: DumpRevision | null;
    /** Der Wikitext der Revision; leer, wenn das Lesen ohne Text verlangt war oder die Revision keinen trägt (`deleted`). */
    text: string;
}

export interface DumpKopf {
    sitename: string | null;
    dbname: string | null;
    base: string | null;
    generator: string | null;
    /** Nummer → Name (`""` im Hauptraum), wie `<siteinfo>` sie nennt. */
    namensraeume: Readonly<Record<number, string>>;
}

const ENTITAETEN: Readonly<Record<string, string>> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/** Die fünf benannten Entitäten und Zeichenverweise. Ein unbekannter Verweis bleibt stehen, wie er ist. */
export function entschluessele(text: string): string {
    if (!text.includes("&")) return text;
    return text.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/gu, (treffer, name: string) => {
        if (name.startsWith("#x")) return codepunkt(Number.parseInt(name.slice(2), 16), treffer);
        if (name.startsWith("#")) return codepunkt(Number.parseInt(name.slice(1), 10), treffer);
        return ENTITAETEN[name] ?? treffer;
    });
}

/**
 * Eine eigene Kopie einer Zeichenfolge. Ein Ausschnitt (`slice`, ein Treffer eines Musters) hält in V8 die ganze Zeichenfolge fest, aus der er stammt: Ein behaltener Titel hielte so
 * den Lesepuffer des Stroms mit vielen Seiten am Leben (Stage 2026-10-27: Die Vorschau der Vorkommen behielt so rund 550 MB und brach an der Speichergrenze des Job-Prozesses mit
 * SIGABRT ab). Was über die Seite hinaus lebt, geht deshalb durch diese Funktion. Das Voranstellen erzwingt eine flache neue Zeichenfolge, der Ausschnitt danach zeigt nur in sie;
 * unter 13 Zeichen kopiert V8 einen Ausschnitt ohnehin.
 */
export const eigeneKopie = (wert: string): string => (wert.length < 13 ? wert : ` ${wert}`.slice(1));

function codepunkt(wert: number, rest: string): string {
    return Number.isInteger(wert) && wert >= 0 && wert <= 0x10ffff ? String.fromCodePoint(wert) : rest;
}

/** Der Inhalt von `<name …>…</name>` ab `von`; `null`, wenn es das Element nicht gibt. Selbstschließend (`<name />`) ist leer. */
function element(block: string, name: string, von = 0, bis = block.length): string | null {
    const anfang = block.indexOf(`<${name}`, von);
    if (anfang === -1 || anfang >= bis) return null;
    const nach = block.charAt(anfang + name.length + 1);
    // Nicht `<title2>` für `<title>` halten.
    if (nach !== ">" && nach !== " " && nach !== "/" && nach !== "\n") return element(block, name, anfang + 1, bis);
    const tagEnde = block.indexOf(">", anfang);
    if (tagEnde === -1 || tagEnde >= bis) return null;
    if (block.charAt(tagEnde - 1) === "/") return "";
    const ende = block.indexOf(`</${name}>`, tagEnde);
    if (ende === -1 || ende > bis) return null;
    return block.slice(tagEnde + 1, ende);
}

function ganzzahl(text: string | null): number | null {
    if (text === null) return null;
    const wert = Number(text.trim());
    return Number.isInteger(wert) ? wert : null;
}

/** Die Daten einer Seite aus dem Inhalt zwischen `<page>` und `</page>`. Ohne Titel oder Namensraum ist der Export nicht vertrauenswürdig. */
export function leseSeite(block: string, mitText: boolean): DumpSeite {
    const revisionStart = block.lastIndexOf("<revision>");
    const kopfEnde = block.indexOf("<revision>");
    const kopfBis = kopfEnde === -1 ? block.length : kopfEnde;
    const titelRoh = element(block, "title", 0, kopfBis);
    const ns = ganzzahl(element(block, "ns", 0, kopfBis));
    if (titelRoh === null || titelRoh === "" || ns === null) {
        throw new DumpFehler("seite_unvollstaendig", "Eine Seite des Dumps hat keinen Titel oder keinen Namensraum");
    }
    const weiterleitungsMarke = /<redirect\b[^>]*?\btitle="([^"]*)"/u.exec(block.slice(0, kopfBis));
    let revision: DumpRevision | null = null;
    let text = "";
    if (revisionStart !== -1) {
        const revisionEnde = block.indexOf("</revision>", revisionStart);
        const bis = revisionEnde === -1 ? block.length : revisionEnde;
        revision = {
            id: ganzzahl(element(block, "id", revisionStart, bis)),
            zeit: element(block, "timestamp", revisionStart, bis),
        };
        if (mitText) text = entschluessele(element(block, "text", revisionStart, bis) ?? "");
    }
    return {
        // Titel und Weiterleitung behalten die Sammler zu Zehntausenden: eigene Kopien, nie Ausschnitte des Lesepuffers.
        titel: eigeneKopie(entschluessele(titelRoh)),
        ns,
        id: ganzzahl(element(block, "id", 0, kopfBis)),
        weiterleitung: weiterleitungsMarke === null ? null : eigeneKopie(entschluessele(weiterleitungsMarke[1] ?? "")),
        revision,
        text,
    };
}

/** Der Kopf (`<siteinfo>`) des Exports; fehlt etwas, bleibt es `null`. */
export function leseKopf(siteinfo: string): DumpKopf {
    const namensraeume: Record<number, string> = {};
    const muster = /<namespace\b[^>]*?\bkey="(-?\d+)"[^>]*?(?:\/>|>([^<]*)<\/namespace>)/gu;
    for (const treffer of siteinfo.matchAll(muster)) {
        namensraeume[Number(treffer[1])] = entschluessele(treffer[2] ?? "");
    }
    const feld = (name: string): string | null => {
        const wert = element(siteinfo, name);
        return wert === null ? null : entschluessele(wert);
    };
    return {
        sitename: feld("sitename"),
        dbname: feld("dbname"),
        base: feld("base"),
        generator: feld("generator"),
        namensraeume,
    };
}
