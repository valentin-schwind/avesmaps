import { HTML_ENTITAETEN } from "./html-entitaeten.ts";

/**
 * Die Textbausteine unter den Infobox-Lesern des WikiSync (WI-0253 C): Schlüsselform, Bereinigung eines Infobox-Werts, Titel. Alles rein und
 * Zeichen für Zeichen nach Legacy (Mirror a7f2dac86), damit ein Wert aus dem Dump so lautet wie der, den der Legacy-Zug gespeichert hat:
 *
 * - `schluesselform` ← `avesmapsWikiSyncMonitorFieldKey` (`sync-monitor-parsing.php`)
 * - `bereinige` ← `avesmapsWikiSyncCleanPoliticalTerritoryWikiValue` (`territories-parsing.php`)
 * - `normalisiereTitel` ← `avesmapsWikiSyncMonitorNormalizeTitle` (`sync-monitor.php`)
 * - `einzeilig` ← `avesmapsNormalizeSingleLine` (`bootstrap.php`)
 *
 * 🪤 PHPs `\s` mit dem Modifikator `u` ist das Unicode-Leerzeichen (PCRE2_UCP): NBSP, geschütztes Leerzeichen und die Leerzeichen der
 * Typografie gehören dazu. JavaScripts `\s` kennt U+FEFF und nicht U+0085; ein Wert mit einem solchen Zeichen läse sich sonst verschieden. `LEER`
 * ist die PCRE-Klasse.
 */

/** Die Leerzeichen, die PCRE2 mit UCP für `\s` zählt. */
export const LEER = "[\\t-\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
export const LEER_FOLGE = new RegExp(`${LEER}+`, "gu");

/** Die Zeichen, die PHPs `trim` ohne zweiten Parameter entfernt: Leerzeichen, \t, \n, \r, NUL, \x0B. */
// eslint-disable-next-line no-control-regex -- genau darum geht es: PHPs trim() entfernt NUL und \x0B
const PHP_TRIM = new RegExp("^[ \\t\\n\\r\\0\\x0B]+|[ \\t\\n\\r\\0\\x0B]+$", "gu");
export const phpTrim = (text: string): string => text.replace(PHP_TRIM, "");

/** Am Rand eines bereinigten Werts fallen Leerraum, Komma und Semikolon ab (Legacy: `trim($value, " \t\n\r\0\x0B,;")`). */
// eslint-disable-next-line no-control-regex -- genau darum geht es: dieselben Zeichen wie PHPs trim() plus Komma und Semikolon
const RAND_ZEICHEN = new RegExp("^[ \\t\\n\\r\\0\\x0B,;]+|[ \\t\\n\\r\\0\\x0B,;]+$", "gu");

/** Zeilenende wie PCRE `\R`: \r\n und jedes einzelne Zeilenzeichen (auch \v, \f, NEL und die Unicode-Trenner). */
export const ZEILENENDE = new RegExp("\\r\\n|[\\n\\r\\v\\f\\u0085\\u2028\\u2029]", "u");

const SCHLUESSEL_ERSATZ: Readonly<Record<string, string>> = {
    ä: "a",
    ö: "o",
    ü: "u",
    ß: "ss",
    á: "a",
    à: "a",
    â: "a",
    é: "e",
    è: "e",
    ê: "e",
    î: "i",
    í: "i",
    ô: "o",
    ó: "o",
    û: "u",
    ú: "u",
};

/** Die Schlüsselform eines Infobox-Parameters: klein, Umlaute und Akzente gefaltet, nur a–z und 0–9 (`Länge` → `lange`, `Stärke` → `starke`). */
export function schluesselform(schluessel: string): string {
    const klein = phpTrim(schluessel).toLowerCase();
    let gefaltet = "";
    for (const zeichen of klein) gefaltet += SCHLUESSEL_ERSATZ[zeichen] ?? zeichen;
    return gefaltet.replace(/[^a-z0-9]+/gu, "");
}

/** Wie `mb_substr($text, 0, $laenge)`: Zeichen (Codepunkte), nicht UTF-16-Einheiten. */
export function kuerze(text: string, laenge: number): string {
    const zeichen = Array.from(text);
    return zeichen.length <= laenge ? text : zeichen.slice(0, laenge).join("");
}

/** `avesmapsNormalizeSingleLine`: getrimmt, jede Leerraumfolge ein Leerzeichen, auf `laenge` Zeichen gekürzt. */
export function einzeilig(text: string, laenge: number): string {
    return kuerze(phpTrim(text).replace(LEER_FOLGE, " "), laenge);
}

/** Legacy `avesmapsWikiStripWikiInlineMarkup` ohne den Leerraum: Fett und Kursiv weg, `[[Ziel|Text]]` wird „Text“, `[[Ziel]]` „Ziel“. */
export const ohneWikiAuszeichnung = (text: string): string =>
    text
        .replaceAll("'''", "")
        .replaceAll("''", "")
        .replace(/\[\[(?:[^\]|]*\|)?([^\]|]+)\]\]/gu, "$1");

/** PHPs `\s` ohne `u` (nur ASCII-Leerraum), wie Legacys `avesmapsNormalizeSourceLabel` im Tag fragt; der Leerraum um das `<br>` geht mit, sonst stünden zwei Leerzeichen da. */
const BR_IM_TITEL = /[ \t-\r]*<br(?:[ \t-\r][^<>]*)?\/?>[ \t-\r]*/giu;
/** Ein Tag beginnt mit einem Buchstaben: „Band <1>“ und „A < B“ sind keine. Darum nicht `entferneTags`, das auch diese nähme. */
const TAG_IM_TITEL = /<\/?[a-z][a-z0-9]*(?:[ \t-\r][^<>]*)?\/?>/giu;

/**
 * Der Titel einer Quelle oder eines Werks ohne Auszeichnung: EINE Regel für jeden Schreiber (WikiSync, Import, Editor), wie Legacys „EIN Putzer für ALLE Schreiber“
 * (`avesmapsNormalizeSourceLabel`, Mirror 96dda99b4). Die Oberfläche zeigt Titel als Text; Besucher lasen sonst wörtlich „Landkartenset <br />Das Dornenreich“.
 *
 * `<br>` wird ein Leerzeichen, jedes andere Tag fällt weg und sein Text bleibt, Wiki-Links und Fett fallen wie in `ohneWikiAuszeichnung`. Zeichenverweise bleiben: Sie
 * löst der Leser genau einmal auf. 🔴 Ein Titel ohne Auszeichnung kommt Zeichen für Zeichen zurück, auch mit doppeltem Leerraum: Der Import übernimmt ihn wörtlich.
 */
export function titelOhneAuszeichnung(titel: string): string {
    const sauber = ohneWikiAuszeichnung(titel.replace(BR_IM_TITEL, " ").replace(TAG_IM_TITEL, ""));
    return sauber === titel ? titel : phpTrim(sauber);
}

/** Der Titel einer Seite, wie Legacy ihn führt: Unterstriche zu Leerzeichen, ohne Sprungmarke. */
export function normalisiereTitel(titel: string): string {
    const ohneUnterstrich = phpTrim(titel).replaceAll("_", " ");
    return phpTrim(ohneUnterstrich.replace(/#.*$/u, ""));
}

function zeichenAus(codepunkt: number, rest: string): string {
    return Number.isInteger(codepunkt) && codepunkt >= 0 && codepunkt <= 0x10ffff && codepunkt !== 0
        ? String.fromCodePoint(codepunkt)
        : rest;
}

/** `html_entity_decode(…, ENT_QUOTES | ENT_HTML5, "UTF-8")` für die Verweise des Wiki-Texts (`html-entitaeten.ts`). */
export function entschluesseleHtml(text: string): string {
    if (!text.includes("&")) return text;
    return text.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/gu, (treffer: string, name: string) => {
        if (name.startsWith("#x") || name.startsWith("#X"))
            return zeichenAus(Number.parseInt(name.slice(2), 16), treffer);
        if (name.startsWith("#")) return zeichenAus(Number.parseInt(name.slice(1), 10), treffer);
        const codepunkt = HTML_ENTITAETEN[name];
        return codepunkt === undefined ? treffer : String.fromCodePoint(codepunkt);
    });
}

/** `isspace` der C-Locale, wie PHPs `strip_tags` es fragt: nur ASCII-Leerraum. */
const istAsciiLeer = (zeichen: string): boolean =>
    zeichen === " " || zeichen === "\t" || zeichen === "\n" || zeichen === "\v" || zeichen === "\f" || zeichen === "\r";

/**
 * `strip_tags` (PHP, ohne erlaubte Tags): derselbe Zustandsautomat wie `php_strip_tags_ex`. Alles von `<` bis zum passenden `>` fällt weg; ein `<` vor
 * ASCII-Leerraum bleibt Text. Verschachtelte `<` im Tag zählen mit (`<<b>x` bleibt offen), ein Tag, das nie schließt, schluckt den Rest, und ein
 * einzelnes `<` am Ende ist ein offenes Tag und fällt weg. Anführungszeichen im Tag verbergen ein `>`; `<!…>`, `<!--…-->` und `<?…?>` haben eigene Zustände.
 */
export function entferneTags(text: string): string {
    if (!text.includes("<")) return text;
    let aus = "";
    // 0 Text, 1 im Tag, 2 in <?…?>, 3 in <!…>, 4 in <!--…-->
    let zustand = 0;
    let tiefe = 0;
    let zitat = "";
    for (let i = 0; i < text.length; i += 1) {
        const c = text.charAt(i);
        if (c === "\0") continue;
        const davor = i > 0 ? text.charAt(i - 1) : "";
        if (zustand === 0) {
            if (c === "<") {
                if (zitat !== "") continue;
                if (istAsciiLeer(text.charAt(i + 1))) {
                    aus += c;
                    continue;
                }
                zustand = 1;
            } else if (c === ">") {
                if (tiefe > 0) tiefe -= 1;
                else if (zitat === "") aus += c;
            } else {
                aus += c;
            }
        } else if (zustand === 1) {
            if (c === "<") {
                if (zitat === "" && !istAsciiLeer(text.charAt(i + 1))) tiefe += 1;
            } else if (c === ">") {
                if (tiefe > 0) tiefe -= 1;
                else if (zitat === "") {
                    zustand = 0;
                    zitat = "";
                }
            } else if (c === '"' || c === "'") {
                if (i !== 0 && (zitat === "" || c === zitat)) zitat = zitat === "" ? c : "";
            } else if (c === "!" && davor === "<") {
                zustand = 3;
            } else if (c === "?" && davor === "<") {
                zustand = 2;
            }
        } else if (zustand === 2) {
            if (c === ">") {
                if (zitat === "" && davor === "?") {
                    zustand = 0;
                    zitat = "";
                }
            } else if (c === '"' || c === "'") {
                if (davor !== "\\") zitat = zitat === c ? "" : zitat === "" ? c : zitat;
            }
        } else if (zustand === 3) {
            if (c === ">") {
                if (tiefe > 0) tiefe -= 1;
                else if (zitat === "") {
                    zustand = 0;
                    zitat = "";
                }
            } else if (c === '"' || c === "'") {
                if (i !== 0 && davor !== "\\" && (zitat === "" || c === zitat)) zitat = zitat === "" ? c : "";
            } else if (c === "-" && davor === "-" && text.charAt(i - 2) === "!") {
                zustand = 4;
            }
        } else if (c === ">" && davor === "-" && text.charAt(i - 2) === "-") {
            zustand = 0;
            zitat = "";
        }
    }
    return aus;
}

/** `{{Datum|1|Praios|1000}}` → „1. Praios 1000”; bei weniger als vier Teilen die Teile mit Leerzeichen. */
function datumsvorlage(rumpf: string): string {
    const teile = rumpf
        .split("|")
        .map((teil) => phpTrim(teil))
        .filter((teil) => teil !== "");
    if (teile.length >= 4) return `${teile[0] ?? ""}. ${teile[1] ?? ""} ${teile[2] ?? ""} ${teile[3] ?? ""}`;
    return teile.join(" ");
}

const ALLES = "[\\s\\S]";

/**
 * Die Bereinigung eines Infobox-Werts (Legacy `avesmapsWikiSyncCleanPoliticalTerritoryWikiValue`): Kommentare, Einzelnachweise und Dateien
 * fallen weg, `[[Ziel|Text]]` wird „Text”, `{{Vorlage|Wert}}` wird „Wert”, jede andere Vorlage ein Leerzeichen, Auszeichnung und Tags fallen weg,
 * Zeichenverweise werden aufgelöst, Leerraum wird ein Leerzeichen, am Rand fallen Leerraum, Komma und Semikolon ab.
 */
export function bereinige(wert: string): string {
    let text = wert;
    text = text.replace(new RegExp(`<!--${ALLES}*?-->`, "gu"), " ");
    text = text.replace(new RegExp(`<ref\\b[^>]*>${ALLES}*?<\\/ref>`, "giu"), " ");
    text = text.replace(/<ref\b[^/>]*\/>/giu, " ");
    text = text.replace(new RegExp(`&\\d{10,}${LEER}*`, "gu"), "");
    text = text.replace(/\[\[Datei:[^\]]+\]\]/giu, " ");
    text = text.replace(/\[\[File:[^\]]+\]\]/giu, " ");
    text = text.replace(/\{\{Datum\|([^{}]+)\}\}/giu, (_treffer: string, rumpf: string) => datumsvorlage(rumpf));
    text = text.replace(/\[\[[^|\]]+\|([^\]]+)\]\]/gu, "$1");
    text = text.replace(/\[\[([^\]]+)\]\]/gu, "$1");
    text = text.replace(/\{\{[^{}|]+\|([^{}]+)\}\}/gu, "$1");
    text = text.replace(/\{\{[^{}]*\}\}/gu, " ");
    for (const auszeichnung of ["'''", "''", "<br>", "<br/>", "<br />"]) text = text.replaceAll(auszeichnung, " ");
    text = entschluesseleHtml(entferneTags(text));
    text = text.replace(LEER_FOLGE, " ");
    return text.replace(RAND_ZEICHEN, "");
}
