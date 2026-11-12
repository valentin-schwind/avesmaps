/**
 * Echte Umlaute in öffentlichen Berichtstexten (WI-0255; Vali 2026-11-02: „Flaechen“, „oeffnet“, „gewaehlte“, „Flusshoehen“ gehören nicht in den Bericht).
 *
 * Die Quelltexte (`Neu:`-Zeilen, Titel aus dem Kanal) sind oft mit `ae`, `oe` und `ue` geschrieben. Eine Ersetzung ohne Regeln zerstörte Wörter wie
 * „Israel“, „Michael“, „neue“, „Feuer“, „Bauer“, „Quelle“ oder „zuerst“, darum wandelt `echteUmlaute` nur, wo die Umschrift sicher gemeint ist, und lässt im
 * Zweifel alles stehen (ein stehengebliebenes „oe“ ist ein Schönheitsfehler, ein zerstörtes Wort ein Fehler):
 *
 * - Nur innerhalb eines Wortes (Buchstabenfolge); ein Wort ganz in Großbuchstaben (Abkürzung) bleibt.
 * - `ue` nach einem Vokal bleibt („neue“, „Feuer“, „Bauer“, „Treue“, „Abenteuer“), ebenso `ue` nach `q` („Quelle“, „Frequenz“), und jedes Paar nach `c`
 *   („Caesar“, aventurische Namen wie „Phexcaer“).
 * - Wörter auf `-ael` und `-uel` (Michael, Raphael, Israel, Manuel, Samuel), die Endungen `-tuell`/`-duell`/`-nuell`/`-suell`/`-xuell` („aktuell“, „individuell“, „Duell“)
 *   und eine kurze Liste bekannter Wörter, in denen das Paar echt ist („zuerst“, „Statue“, „Poesie“, „Individuen“, „Issue“, „Value“ …).
 * - Nur `ae`, `oe` und `ue` in Kleinschreibung nach dem ersten Buchstaben des Paares: „Ae“ am Wortanfang wird „Ä“, „AE“ mitten im Wort bleibt.
 *
 * Nicht Teil davon ist „ss“ → „ß“ im Allgemeinen: Ohne Wörterbuch ist „Fluss“ nicht von „Fuß“ zu trennen, und „Schlösser“ hat ein kurzes ö. Die eine sichere Familie
 * ist „gröss-“: Dort ist das ö immer lang (Größe, größer, Fenstergröße, vergrößern), also steht ß (Vali-Befund 2026-11-03: „Grösse“; es entsteht aus „Groesse“,
 * wenn die Umschrift sauber zum Umlaut wird, oder steht schon so im Quelltext).
 */

const UMLAUT: Readonly<Record<string, string>> = { a: "ä", o: "ö", u: "ü", A: "Ä", O: "Ö", U: "Ü" };
const VOKALE = "aeiouäöüy";

/** Ganze Wörter und Wortanfänge (klein geschrieben), in denen `ae`, `oe` oder `ue` kein Umlaut ist. */
const UNVERAENDERT = new RegExp(
    [
        // Die Umschrift selbst („statt ae, oe und ue“) ist kein Wort, das einen Umlaut meint.
        "^(?:ae|oe|ue)$",
        // Namen und Fremdwörter mit echtem Paar
        "^(?:israel|michael|raphael|rafael|nathanael|ismael|samael|gael|mael|manuel|samuel|emanuel|emmanuel|joel|noel|zoe|aloe|phoebe|goethe|boeing|doe)$",
        "^(?:blue|clue|glue|true|due|hue|cue|sue)$",
        "^(?:aero|poet|poes|poem|statue|koexist|koeffizient|koedukation|koerzitiv|soest|individuen|residuen|duett|muesli)",
        "^(?:issue|value|venue|avenue|revenue|rescue|continue|tissue|argue|virtue|ensue|pursue|subdue)",
        // zu + e…: „zuerst“, „zueinander“ (kein ü)
        "zuerst|zueinander|zuende|zuerkenn|zuerkannt|zuerteil",
        // -ael / -uel am Wortende (Michael, Manuel) und die Adjektive auf -uell (aktuell, individuell, Duell)
        "ael$|uel$",
        "[dnstx]uell",
    ].join("|"),
    "u",
);

/** Darf das Paar `<vokal>e` an dieser Stelle zum Umlaut werden? `vor` ist der Buchstabe davor (klein) oder leer. */
function darfWandeln(vokal: string, vor: string): boolean {
    if (vor === "c") return false;
    if (vokal === "u" && (vor === "q" || (vor !== "" && VOKALE.includes(vor)))) return false;
    return true;
}

/** „gröss-“ ist immer „größ-“: das lange ö der Größe. Ein Wort ganz in Großbuchstaben bleibt (ein großes ẞ gäbe es hier nur auf Verdacht). */
function groesse(wort: string): string {
    if (wort.length > 1 && wort === wort.toUpperCase()) return wort;
    return wort.replace(/([Gg]r)öss/gu, "$1öß");
}

function wandle(wort: string): string {
    return groesse(umschrift(wort));
}

function umschrift(wort: string): string {
    if (!/[aou]e/iu.test(wort)) return wort;
    if (wort.length > 1 && wort === wort.toUpperCase()) return wort;
    if (UNVERAENDERT.test(wort.toLowerCase())) return wort;
    let aus = "";
    let i = 0;
    while (i < wort.length) {
        const a = wort[i]!;
        if (wort[i + 1] === "e" && Object.hasOwn(UMLAUT, a)) {
            const vor = i > 0 ? wort[i - 1]!.toLowerCase() : "";
            if (darfWandeln(a.toLowerCase(), vor)) {
                aus += UMLAUT[a]!;
                i += 2;
                continue;
            }
        }
        aus += a;
        i += 1;
    }
    return aus;
}

/** Der Text mit echten Umlauten, wo `ae`, `oe` oder `ue` sicher die Umschrift eines Umlauts ist; sonst unverändert. */
export function echteUmlaute(text: string): string {
    if (!/[aou]e|gröss/iu.test(text)) return text;
    return text.replace(/\p{L}+/gu, wandle);
}
