import { ref, shallowReactive } from "vue";
import { de, type MessageKey } from "./de";
import { LOCALES, type Locale, pluralForm, type PluralCase, type Tafel } from "./plural";
import { istSpaeterText } from "./spaete-texte";

/**
 * Deutsch, Englisch, Französisch, Niederländisch, Italienisch, Spanisch und Polnisch (WI-0032 Stufe 2,
 * WI-0158, WI-0165, WI-0167, WI-0170, WI-0174; Legacy
 * `js/app/i18n.js`, `js/app/lang-toggle.js`, avesmaps@770c80e).
 *
 * - **Deutsch ist die Quelle** (`de.ts`), Englisch, Französisch, Niederländisch, Italienisch, Spanisch und
 *   Polnisch sind vollständige Tafeln darüber (`en.ts`, `fr.ts`, `nl.ts`, `it.ts`, `es.ts`, `pl.ts`). Der
 *   Typ erzwingt die Vollständigkeit: Ein Schlüssel ohne englischen Text ist ein Typfehler, kein
 *   deutsches Wort mitten im Englischen (Legacy hatte am 01.09.2026 20 von 353 solcher Lücken).
 * - **Die Wahl:** `?lang=` in der Adresse vor der gespeicherten Wahl (`avesmaps-lang`, Legacys
 *   Schlüssel) vor der Sprache des Browsers vor Deutsch. `lang` wird gelesen, nie in die Adresse
 *   geschrieben: Legacys `?lang=en`-Links bleiben gültig (WI-0029).
 * - 🔴 **Die Sprache des Browsers zählt seit WI-0156** (Betreiber 2026-10-15: „mach dass die sprache
 *   sich standardmäßig dem browser anpasst, default ist sonst DE“). Bis dahin zählte sie nicht, weil
 *   Legacys Englisch unvollständig war und ein Gemisch ergab (Owner Legacy 14.07.2026). Dieser Grund
 *   ist hier weg: Der Typ erzwingt jede Tafel vollständig, es gibt kein halbes Englisch.
 *   🪤 Deshalb darf eine Sprache erst in `LOCALES`, wenn ihre Tafel steht - sonst schickt der Browser
 *   Besucher in eine Sprache, die es nicht gibt.
 * - **Umschalten ohne Neuladen:** Jeder Text liest die Sprache reaktiv. Legacy lud neu und verlor
 *   dabei die Reise.
 * - **Nur Deutsch steht im Startpaket** (WI-0235): Jede andere Tafel kommt per `import()` erst, wenn ihre
 *   Sprache gebraucht wird (`ladeTafel`). Alle neun lagen am 19.10. mit 3,3 MB im Start-JS, 47 % davon; ein
 *   Besucher braucht eine. Der Start wartet auf die Starttafel, bevor er einhängt (`main.ts`), und
 *   `setLocale` schaltet erst um, wenn die neue Tafel da ist: Es erscheint nie ein deutsches Bild dazwischen.
 *   🪤 Eine neue Sprache braucht deshalb neben `LOCALES` auch ihren Eintrag in `TAFEL_LADER`; fehlt er, ist
 *   das ein Typfehler.
 * - 🔴 **Zählformen wählt `tPlural`, nie der Aufrufer** (WI-0173): Welche Formen eine Sprache hat und
 *   welche zu einer Zahl gehört, steht in `plural.ts` und kommt aus `Intl.PluralRules`.
 * - **Nie übersetzt:** Ortsnamen, Kartennamen, Wegnamen - sie sind Namen, keine Wörter.
 */

export { LOCALES, type Locale, PLURAL_CASES, type PluralCase } from "./plural";
export const LOCALE_STORAGE_KEY = "avesmaps-lang";

/** 🔴 Auch die Quelle wird geprüft: `de` trägt jeden Fall in den Formen, die Deutsch braucht (WI-0173). */
const deTafel: Tafel<"de"> = de;
/**
 * 🪤 Die Tafeln stehen hier bewusst als `Record<string, string>`: Jede Tafel prüft ihre Vollständigkeit in ihrer
 * eigenen Datei gegen `Tafel<L>`, und nur so lässt sich ein Zählschlüssel nachschlagen, den DIESE Sprache hat und
 * Deutsch nicht (`…few` im Polnischen).
 */
type Tabelle = Readonly<Record<string, string>>;
const TAFEL_LADER: Readonly<Record<Exclude<Locale, "de">, () => Promise<Tabelle>>> = {
    en: () => import("./en").then((modul) => modul.en),
    fr: () => import("./fr").then((modul) => modul.fr),
    nl: () => import("./nl").then((modul) => modul.nl),
    it: () => import("./it").then((modul) => modul.it),
    es: () => import("./es").then((modul) => modul.es),
    pl: () => import("./pl").then((modul) => modul.pl),
    da: () => import("./da").then((modul) => modul.da),
    sv: () => import("./sv").then((modul) => modul.sv),
};
/** Die geladenen Tafeln; reaktiv, damit ein Text neu gezeichnet wird, sobald seine Tafel ankommt. */
const tables = shallowReactive<Partial<Record<Locale, Tabelle>>>({ de: deTafel });
const laeuft = new Map<Locale, Promise<void>>();

/** Lädt die Tafel einer Sprache, einmal; Deutsch ist immer da. Scheitert das Laden, bleibt Deutsch der Rückfall. */
export function ladeTafel(sprache: Locale): Promise<void> {
    if (sprache === "de" || tables[sprache] !== undefined) return Promise.resolve();
    const offen = laeuft.get(sprache);
    if (offen !== undefined) return offen;
    const laden = TAFEL_LADER[sprache]().then(
        (tafel) => {
            tables[sprache] = tafel;
        },
        (fehler: unknown) => {
            laeuft.delete(sprache);
            throw fehler;
        },
    );
    laeuft.set(sprache, laden);
    return laden;
}

/** Alle Tafeln, etwa für Tests, die zwischen den Sprachen wechseln. */
export async function ladeAlleTafeln(): Promise<void> {
    await Promise.all(LOCALES.map(ladeTafel));
}

/** Die Tafel einer Sprache, Deutsch, solange sie nicht geladen ist. */
export function tafelVon(sprache: Locale): Tabelle {
    return tables[sprache] ?? (tables.de as Tabelle);
}

let spaeteTexte: Promise<void> | undefined;

/**
 * Lädt den zweiten Teil der deutschen Tafel, einmal (`spaete-texte.ts`). Wer Texte der Verwaltung zeigt, wartet vorher darauf (`nachladen.ts`). `tables` ist reaktiv: Was schon steht, wird
 * neu gezeichnet. Im Entwicklungsserver ist der Teil leer.
 */
export function ladeSpaeteTexte(): Promise<void> {
    spaeteTexte ??= import("./de-spaet").then(
        ({ deSpaet }) => {
            tables.de = { ...(tables.de as Tabelle), ...deSpaet };
        },
        (fehler: unknown) => {
            spaeteTexte = undefined;
            throw fehler;
        },
    );
    return spaeteTexte;
}

/** Das Netz unter `ladeSpaeteTexte`: Wird ein später Text gebraucht, bevor er da ist, kommt er nach. */
function holeSpaetenText(schluessel: string): void {
    if (spaeteTexte === undefined && istSpaeterText(schluessel)) void ladeSpaeteTexte().catch(() => undefined);
}
/**
 * Zahlen: Deutsch mit Komma („549,4“), Englisch mit Punkt („549.4“), wie Legacy (`utils.js:193-207`);
 * Polnisch wie Französisch: Komma und schmaler Zwischenraum („1 234,5“);
 * Französisch mit Komma und schmalem Zwischenraum als Tausendertrenner („1 234,5“);
 * Niederländisch wie Deutsch, mit Punkt als Tausendertrenner („1.234,5“);
 * Italienisch mit Komma, aber 🪤 erst ab fünf Stellen gruppiert („2808,7“, dann „12.345,6“) - so steht es
 * in CLDR (`it`: `minimumGroupingDigits` 2); Spanisch zählt genauso (`es`: „2808,7“, „12.345,6“).
 *
 * Dasselbe Gebietsschema formatiert das Datum in „Versionen“ (`auth/versionen.ts`, WI-0168): Eine Sprache ohne Eintrag
 * ist hier ein Typfehler, nicht ein stilles englisches Datum.
 */
export const NUMBER_LOCALE: Readonly<Record<Locale, string>> = {
    de: "de-DE",
    en: "en-GB",
    fr: "fr-FR",
    nl: "nl-NL",
    it: "it-IT",
    es: "es-ES",
    // Polnisch wie Deutsch: Komma als Dezimaltrenner, schmaler Zwischenraum als Tausendertrenner („1 234,5“).
    pl: "pl-PL",
    da: "da-DK",
    sv: "sv-SE",
};

function parseLocale(value: string | null | undefined): Locale | null {
    return LOCALES.find((marke) => marke === value) ?? null;
}

function storedLocale(): Locale | null {
    try {
        return parseLocale(globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY));
    } catch {
        return null;
    }
}

/**
 * Die Sprache aus der Liste des Browsers (WI-0156): die erste Marke, die wir haben, auf ihren Sprachteil gekürzt
 * (`fr-BE` ist Französisch). 🪤 Gewichte (`;q=`) stehen hier nicht - `navigator.languages` ist bereits sortiert.
 */
export function browserLocale(sprachen: readonly string[]): Locale | null {
    for (const marke of sprachen) {
        const treffer = parseLocale(marke.toLowerCase().split("-")[0]);
        if (treffer !== null) return treffer;
    }
    return null;
}

/** Was der Browser an Sprachen nennt; ein Browser ohne Liste nennt wenigstens seine eine. */
function browserSprachen(): readonly string[] {
    const navigator = globalThis.navigator as { languages?: readonly string[]; language?: string } | undefined;
    if (navigator === undefined) return [];
    if (navigator.languages !== undefined && navigator.languages.length > 0) return navigator.languages;
    return navigator.language === undefined ? [] : [navigator.language];
}

/**
 * Die Sprache beim Start: `?lang=` in der Adresse, sonst die gespeicherte Wahl, sonst die Sprache des Browsers, sonst
 * Deutsch.
 */
export function initialLocale(
    search: string = globalThis.location?.search ?? "",
    sprachen: readonly string[] = browserSprachen(),
): Locale {
    return parseLocale(new URLSearchParams(search).get("lang")) ?? storedLocale() ?? browserLocale(sprachen) ?? "de";
}

export const locale = ref<Locale>(initialLocale());

/** Setzt das Attribut `lang` an `<html>` - Vorleser und Silbentrennung richten sich danach. */
export function applyLocale(next: Locale): void {
    const root = globalThis.document?.documentElement;
    if (root) root.lang = next;
}

let letzterWunsch = 0;

/**
 * Schaltet die Sprache um, sobald ihre Tafel da ist; ist sie schon geladen, sofort. Wer schnell zweimal wählt, bekommt die
 * zweite Wahl, auch wenn die erste Tafel später ankommt. 🔴 Lädt die Tafel nicht (etwa ein offener Tab nach einem Release,
 * dessen alter Chunk fehlt), bleibt die bisherige Sprache stehen, nie eine halb deutsche Oberfläche; die Antwort ist dann
 * `false`, und die Konsole sagt warum.
 */
export function setLocale(next: Locale): Promise<boolean> {
    const wunsch = ++letzterWunsch;
    const umschalten = (): boolean => {
        if (wunsch !== letzterWunsch) return false;
        locale.value = next;
        applyLocale(next);
        try {
            globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, next);
        } catch {
            // Ohne Speicher gilt die Wahl bis zum Neuladen.
        }
        return true;
    };
    if (next === "de" || tables[next] !== undefined) return Promise.resolve(umschalten());
    return ladeTafel(next).then(umschalten, (fehler: unknown) => {
        console.warn(`Sprachtafel „${next}“ nicht geladen, die Sprache bleibt „${locale.value}“.`, fehler);
        return false;
    });
}

/**
 * Die Tafel der Startsprache, bevor die Seite einhängt (`main.ts`, Statusseite). Lädt sie nicht, startet die Seite ganz auf
 * Deutsch, ohne die gespeicherte Wahl zu überschreiben: Beim nächsten Besuch versucht sie es wieder.
 */
export async function ladeStarttafel(): Promise<void> {
    const sprache = locale.value;
    try {
        await ladeTafel(sprache);
    } catch (fehler) {
        console.warn(`Sprachtafel „${sprache}“ nicht geladen, die Seite startet auf Deutsch.`, fehler);
        if (locale.value === sprache) {
            locale.value = "de";
            applyLocale("de");
        }
    }
}

/** Die Sprache, in der gerade gerechnet wird: `inSprache` setzt sie für einen synchronen Abschnitt; sonst gilt die Sprache der Seite. */
let rechenSprache: Locale | undefined;

/** Die Sprache der Texte und Zahlen: die von `inSprache`, sonst die der Seite (reaktiv gelesen). */
const aktiveSprache = (): Locale => rechenSprache ?? locale.value;

/**
 * Rechnet `tue` in einer anderen Sprache als der Seite (WI-0306, Reise als PDF: das PDF erscheint in der gewählten Sprache). `t`, `tPlural`,
 * `formatNumber`, `formatDecimal` und `formatList` lesen dann `sprache`; die Sprache der Seite bleibt unberührt, nichts wird neu gezeichnet.
 * 🔴 Nur synchron: Was nach einem `await` läuft, steht wieder in der Sprache der Seite. Die Tafel lädt vorher `ladeTafel`; fehlt sie, gilt Deutsch.
 */
export function inSprache<T>(sprache: Locale, tue: () => T): T {
    const vorher = rechenSprache;
    rechenSprache = sprache;
    try {
        return tue();
    } finally {
        rechenSprache = vorher;
    }
}

/** Die Sprache, deren Tafel gerade gilt: die gewählte, solange ihre Tafel noch lädt Deutsch. */
function geltendeSprache(): Locale {
    const sprache = aktiveSprache();
    return tables[sprache] === undefined ? "de" : sprache;
}

/**
 * Der Text zu einem Schlüssel in der aktuellen Sprache, `{name}`-Platzhalter ersetzt. Liest die
 * Sprache reaktiv: In einer Vorlage aufgerufen, wird er beim Umschalten neu gezeichnet.
 */
export function t(key: MessageKey, params?: Readonly<Record<string, string | number>>): string {
    const text = tafelVon(aktiveSprache())[key];
    if (text === undefined) holeSpaetenText(key);
    return fuellen(text ?? key, params);
}

function fuellen(text: string, params?: Readonly<Record<string, string | number>>): string {
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, (match, name: string) => {
        const value = params[name];
        return value === undefined ? match : String(value);
    });
}

/**
 * 🔴 **Der Text eines Zählfalls zu einer Anzahl** (WI-0173). Die Form wählt `Intl.PluralRules` der aktuellen Sprache,
 * nicht der Aufrufer: Deutsch und Englisch kennen zwei Formen, Französisch zählt die 0 zur Einzahl, Polnisch
 * unterscheidet 1, 2 bis 4 und 5 und mehr - und 22 zählt dort wieder wie 2. Keine Zahlenbedingung im Aufrufer bildet
 * das ab, und jede, die es versucht, vererbt die Zählweise ihrer eigenen Sprache an alle anderen.
 *
 * Die Anzahl wird NICHT selbst eingesetzt: Wer `{n}` im Text hat, gibt sie als Platzhalter mit - meist formatiert
 * (`formatNumber`), damit Tausendertrenner und Sprache stimmen.
 */
export function tPlural(fall: PluralCase, n: number, params?: Readonly<Record<string, string | number>>): string {
    const sprache = geltendeSprache();
    return fuellen(tafelVon(sprache)[pluralKey(fall, n, sprache)] ?? fall, params);
}

/**
 * Der Schlüssel, den {@link tPlural} nachschlüge - für die Stellen, die einen Schlüssel weiterreichen, statt ihn
 * sofort zu setzen (`Phrase` in `auth/formular.ts`).
 *
 * 🪤 Der Rückgabetyp ist `MessageKey`, obwohl eine Sprache Formen haben kann, die Deutsch nicht hat (`…few`). Das ist
 * sicher: {@link pluralForm} liefert nur Formen, die DIESE Sprache erklärt hat, und ihre Tafel trägt sie alle.
 */
export function pluralKey(fall: PluralCase, n: number, lang: Locale = aktiveSprache()): MessageKey {
    return `${fall}.${pluralForm(n, lang, fall)}` as MessageKey;
}

/** Gibt es diesen Schlüssel? Für Schlüssel aus Daten (`path.${wegart}`), die der Typ nicht kennt. */
export function isMessageKey(key: string): key is MessageKey {
    const da = Object.hasOwn(tables.de as Tabelle, key);
    if (!da) holeSpaetenText(key);
    return da;
}

/** Zahlen in der Sprache der Seite, mit fester Nachkommazahl: „1.234,5“ oder „1,234.5“. */
export function formatNumber(value: number, digits: number): string {
    return value.toLocaleString(NUMBER_LOCALE[aktiveSprache()], {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });
}

/**
 * Zahlen mit höchstens `maxDigits` Nachkommastellen, ohne Nullen am Ende: „4,26“, „5“ - wie Legacys
 * Tempotafel (`toLocaleString`). Für Tafeln, in denen eine Zahl allein in ihrer Zelle steht.
 */
export function formatDecimal(value: number, maxDigits: number): string {
    return value.toLocaleString(NUMBER_LOCALE[aktiveSprache()], {
        minimumFractionDigits: 0,
        maximumFractionDigits: maxDigits,
    });
}

/** Eine Aufzählung in der Sprache der Seite: „A, B und C“ oder „A, B and C“ (WI-0069). */
export function formatList(items: readonly string[]): string {
    return new Intl.ListFormat(NUMBER_LOCALE[aktiveSprache()], { style: "long", type: "conjunction" }).format(items);
}

export type { MessageKey };
