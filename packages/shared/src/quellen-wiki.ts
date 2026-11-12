/**
 * Der Vergleich einer Quellenangabe mit dem Wiki (WI-0254 §12; Vali: „ist egal, wo er sie her hat, vergleich mit dem wiki, alles andere ist manuell“).
 *
 * Eine Verknüpfung eines Kartenobjekts mit einer Quelle trägt Art des Belegs, Seiten und Notiz. Das Wiki zitiert dieselbe Quelle am selben Objekt mit denselben drei Angaben.
 * Gleich heißt: alle drei stimmen überein, nach dem Kürzen an den Rändern, und „leer“ ist „nichts“ (ein Wert aus Leerraum gilt wie keiner). Die Reihenfolge der Buchstaben, die
 * Schreibweise und Zeichen innerhalb des Werts zählen mit: Der Vergleich rät nicht.
 *
 * EINE Regel für den Server (Kreis in der Klappbox der Editoren, `inhalte/traeger-quellen-lesen.ts`) und die Oberfläche (Knopf „↺ Wiki-Wert“, Satz „Im Wiki: …“).
 */

/** Die drei Angaben einer Verknüpfung oder eines Zitats; `null` und fehlend sind „nichts“. */
export interface QuellenWikiWert {
    art?: string | null | undefined;
    seiten?: string | null | undefined;
    notiz?: string | null | undefined;
}

/** Die Zeichen, die PHPs `trim` entfernt (Legacy und der Abgleich des WikiSync kürzen genauso): Leerzeichen, \t, \n, \r, NUL, \x0B. */
// eslint-disable-next-line no-control-regex -- genau darum geht es: dieselben Zeichen wie PHPs trim()
const RAND = new RegExp("^[ \\t\\n\\r\\0\\x0B]+|[ \\t\\n\\r\\0\\x0B]+$", "gu");

/** Ein Wert gekürzt; leer wird `null`. */
export const quellenWikiNormal = (wert: string | null | undefined): string | null => {
    if (wert === null || wert === undefined) return null;
    const gekuerzt = wert.replace(RAND, "");
    return gekuerzt === "" ? null : gekuerzt;
};

/** Stimmen Art, Seiten und Notiz überein (nach dem Kürzen, leer = nichts)? */
export const gleichDemWiki = (a: QuellenWikiWert, b: QuellenWikiWert): boolean =>
    quellenWikiNormal(a.art) === quellenWikiNormal(b.art) &&
    quellenWikiNormal(a.seiten) === quellenWikiNormal(b.seiten) &&
    quellenWikiNormal(a.notiz) === quellenWikiNormal(b.notiz);
