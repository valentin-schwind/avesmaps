import { ZAEHLENDE_INFOBOXEN, ZAEHLENDE_KATEGORIEN, type ZielInfo } from "../abgleich/ortsrolle.ts";
import { extrahiereInfoboxBlock, infoboxName, leseParameter, normalisiereFelder } from "../infobox/block.ts";
import { LEER, entschluesseleHtml, phpTrim, schluesselform } from "../infobox/text.ts";
import { eigeneKopie } from "./xml.ts";

/**
 * Was der Dump über ein mögliches LINKZIEL einer Ortszeile weiß (WI-0253, Scheibe Vorkommen): ob die Seite eine Weiterleitung ist, welche Infobox sie trägt, welche zählenden Kategorien und wohin
 * `Region=` / `Kontinent=` zeigen. Daraus entscheidet die Rolle eines Links (`abgleich/ortsrolle.ts`: Landschaftsart, Volk, andere Welt …). Nachbau von `extract.py` der Regelbuch-Analyse.
 *
 * Gehalten wird nur, was etwas sagt: eine Weiterleitung, eine Seite mit einer Infobox, die die Art des Ziels bestimmt, mit einer zählenden Kategorie oder mit einer Elternkette. Von den rund
 * 250.000 Seiten des Dumps sind das ein paar zehntausend kurze Einträge; der Dump selbst steht nie im Speicher.
 */

const REGISTER_REGION = new RegExp(`\\{\\{${LEER}*Register${LEER}+Region${LEER}*\\}\\}`, "u");
const KATEGORIE = new RegExp(`\\[\\[${LEER}*Kategorie${LEER}*:${LEER}*([^\\]|]+)`, "gu");
const ELTERN_LINK = new RegExp(`\\[\\[${LEER}*([^\\]|#]+)`, "gu");
const ELTERN_VORLAGE = new RegExp(`\\{\\{${LEER}*Reg${LEER}*\\|${LEER}*([^}|]+)`, "gu");

/** Infoboxen, deren `Region=` / `Kontinent=` gelesen wird (Python: die Schlüsselform nennt eine Region, Siedlung, einen Staat oder eines der Wörter). */
const ELTERN_WOERTER: ReadonlySet<string> = new Set([
    "region",
    "landschaft",
    "fluss",
    "gewasser",
    "gewaesser",
    "meer",
    "see",
    "berg",
    "gebirge",
    "insel",
    "stadt",
    "ort",
    "dorf",
    "bauwerk",
]);

function hatElternkette(name: string): boolean {
    const schluessel = schluesselform(name);
    return (
        ELTERN_WOERTER.has(schluessel) ||
        schluessel.includes("region") ||
        schluessel.includes("siedlung") ||
        schluessel.includes("staat")
    );
}

/** Die ersten 15 wörtlichen Kategorien einer Seite (wie die Analyse), davon die, die zählen. */
function zaehlendeKategorien(text: string): string[] {
    if (!text.includes("Kategorie")) return [];
    const aus: string[] = [];
    let gelesen = 0;
    for (const treffer of text.matchAll(KATEGORIE)) {
        gelesen += 1;
        if (gelesen > 15) break;
        const name = phpTrim(treffer[1] ?? "");
        if (ZAEHLENDE_KATEGORIEN.has(name) && !aus.includes(name)) aus.push(name);
    }
    return aus;
}

/** Die Seiten, auf die `Region=` oder `Kontinent=` der ersten Infobox zeigen (höchstens vier). */
function eltern(text: string): string[] {
    const parameter = new Map<string, string>();
    for (const [name, wert] of leseParameter(extrahiereInfoboxBlock(text).block))
        parameter.set(name, entschluesseleHtml(wert));
    const norm = normalisiereFelder(parameter);
    const region = phpTrim(norm.get("region") ?? "");
    const wert = region !== "" ? region : phpTrim(norm.get("kontinent") ?? "");
    if (wert === "") return [];
    const ziele = [
        ...[...wert.matchAll(ELTERN_LINK)].map((treffer) => phpTrim(treffer[1] ?? "")),
        ...[...wert.matchAll(ELTERN_VORLAGE)].map((treffer) => phpTrim(treffer[1] ?? "")),
    ];
    return ziele.slice(0, 4);
}

/**
 * Die Auskunft zu einer Seite des Dumps; `undefined`, wo die Seite für die Rolle eines Links nichts sagt. Eine Weiterleitung nennt nur ihr Ziel; ein Artikel seine zählende Infobox, seine
 * zählenden Kategorien und seine Elternkette.
 */
export function zielInfoVonSeite(seite: { weiterleitung: string | null; text: string }): ZielInfo | undefined {
    if (seite.weiterleitung !== null) return { weiterleitung: seite.weiterleitung };
    const text = seite.text;
    const name = text.includes("{{") ? infoboxName(text) : "";
    const kategorien = zaehlendeKategorien(text);
    const zaehlt = ZAEHLENDE_INFOBOXEN.has(name);
    const elternListe = name !== "" && hatElternkette(name) ? eltern(text) : [];
    // Eine Region ohne Infobox trägt nur `{{Register Region}}` (Nordaventurien, Südaventurien …).
    const register = name === "" && REGISTER_REGION.test(text);
    if (!zaehlt && kategorien.length === 0 && elternListe.length === 0 && !register) return undefined;
    return {
        ...(register ? { register: "Region" as const } : {}),
        // Der Name steht auch dann, wenn er selbst nicht zählt, sobald eine Kategorie ihn zu etwas Eigenem macht („Landschaftsart ohne eigene Infobox“ gilt nur ohne Infobox).
        // Eigene Kopien: Ausschnitte hielten den Seitentext fest, und die Auskunft lebt für den ganzen Durchgang (`dump/xml.ts`, `eigeneKopie`).
        ...(name === "" ? {} : { infobox: eigeneKopie(name) }),
        ...(kategorien.length === 0 ? {} : { kategorien: kategorien.map(eigeneKopie) }),
        ...(elternListe.length === 0 ? {} : { eltern: elternListe.map(eigeneKopie) }),
    };
}
