import type { MessageKey } from "./de";

/**
 * Die Sprachen und ihre Zählformen (WI-0173).
 *
 * 🔴 **Die Zählweise gehört in die Tafel, nicht in den Aufrufer.** Bis WI-0173 entschied jede Stelle selbst, meist mit
 * `n === 1`; `einzahl(n, lang)` hatte das an EINER Stelle gebündelt, konnte aber nur zwei Formen tragen - es gab einen
 * Boolean zurück. Polnisch (WI-0174) kennt drei: 1 Etappa, 2 bis 4 Etapy, 5 und mehr Etap, und 22 zählt wieder wie 2.
 * Mit einer Zahlenbedingung im Aufrufer ist das nicht zu treffen. Seither wählt `tPlural` (`i18n.ts`) die Form über
 * `Intl.PluralRules` der jeweiligen Sprache.
 *
 * 🔴 **Die Hausregel „jede Tafel trägt jeden Schlüssel“ bleibt - eine Ebene höher.** Jede Tafel trägt jeden FALL, und
 * zwar in genau den Formen, die ihre Sprache braucht: Eine fehlende polnische `few`-Zeile ist ein Typfehler, eine
 * überflüssige deutsche ebenso. Der Weg „jede Tafel trägt jede Form“ war die Alternative; er hätte 396 Zeilen erzeugt,
 * die nur Dubletten von `other` sind, und damit eine Drift, die kein Typ bemerkt (Begründung in WI-0173 §3).
 */

/** Die Sprachen der Oberfläche. 🪤 Eine Sprache darf erst hier stehen, wenn ihre Tafel vollständig ist (WI-0156). */
export type Locale = "de" | "en" | "fr" | "nl" | "it" | "es" | "pl" | "da" | "sv";
export const LOCALES: readonly Locale[] = ["de", "en", "fr", "nl", "it", "es", "pl", "da", "sv"];

/** Eine Zählform. `two` ist keine CLDR-Form, sondern die Stilform aus {@link DUAL_CASES}. */
export type PluralForm = "one" | "two" | "few" | "many" | "other";

/**
 * 🔴 **Welche Formen eine Sprache erklärt.** Daraus rechnet {@link Tafel} den Typ jeder Sprachtafel; was hier fehlt,
 * darf in der Tafel nicht stehen, und was hier steht, muss dort stehen.
 *
 * 🪤 **CLDR gibt `fr`, `it` und `es` ein viertes `many`** - für Millionen („un million d'étapes“). Unsere Zahlen sind
 * Etappen, Meilen, Treffer und Minuten; eine Million kommt nicht vor. Diese drei Sprachen erklären deshalb nur `one`
 * und `other`, und {@link pluralForm} fällt auf `other` zurück, sollte CLDR doch einmal eine nicht erklärte Form
 * wählen. Das ist gemessen, nicht geraten: `plural-formen.test.ts` hält jede Sprache gegen `Intl.PluralRules` über
 * alle Zahlen von 0 bis 1.000 und die Zehnerpotenzen darüber.
 */
export const PLURAL_FORMS = {
    de: ["one", "other"],
    en: ["one", "other"],
    fr: ["one", "other"],
    nl: ["one", "other"],
    it: ["one", "other"],
    es: ["one", "other"],
    // 🔴 Polnisch, die erste Sprache mit drei Zählformen (WI-0174): 1 etap, 2 bis 4 etapy, 5 und mehr etapów -
    // und 22 zählt wieder wie 2, 25 wieder wie 5.
    // 🪤 Dänisch und Schwedisch zählen wie Deutsch: eine Einzahl, sonst `other` (WI-0210, WI-0211).
    sv: ["one", "other"],
    da: ["one", "other"],
    pl: ["one", "few", "many", "other"],
} as const satisfies Record<Locale, readonly PluralForm[]>;

/**
 * 🔴 **Jeder Fall, der eine Anzahl in einen Satz setzt.** Diese Liste ist die Wahrheit: `i18n.test.ts` prüft, dass es
 * zu jedem Eintrag genau die Schlüssel `<fall>.<form>` gibt und dass kein `…one`-Schlüssel ohne Eintrag herumsteht.
 *
 * Vor WI-0173 standen dieselben 33 Fälle in vier Schreibweisen nebeneinander (`X.one`/`X.many`, `X.one`/`X`,
 * `XOne`/`XMany`, `XOne`/`XTwo`/`XMany`) und wurden an 22 Stellen von Hand gewählt, sechzehn davon mit `n === 1` -
 * also genau so, wie WI-0158 es verhindern wollte.
 */
export const PLURAL_CASES = [
    "wikiBox.ergebnis.uebernommen",
    "wikiBox.aender.kopf",
    "wikiBox.eigene",
    "planner.cost.food.note",
    "planner.cost.tolls.note",
    "planner.summary.landscapes",
    "planner.summary.territories",
    "planner.summary.sprachen",
    "planner.summary.gebiete",
    "planner.summary.legCount",
    "planner.summary.airStations",
    "planner.ships.heading",
    "planner.closure.head",
    "planner.closure.anyway",
    "share.placeMissing",
    "display.hexraster.wert",
    "infoPanel.staetten",
    "infoPanel.staetten.short",
    "landschaftseditor.unter.beschriftungen",
    "landschaftseditor.ebenenleiste.gesperrt",
    "landschaftseditor.ebenenleiste.verborgen",
    "landschaftseditor.beschriftung.letzteFrage",
    "ortseditor.sammel.gewaehlt",
    "ortseditor.sammel.ohneOrt",
    "ortseditor.sammel.geloescht",
    "ortseditor.sammel.status",
    "ortseditor.sammel.entfernen.frage",
    "ortseditor.sammel.entfernen.knopf",
    "ortseditor.sammel.entfernen.staetten",
    "ortseditor.sammel.entfernen.wegenden",
    // Die Kopfzeile einer Arbeitsserie: „Blutzinnen — 8 Änderungen“ (WI-0265 B5a).
    "aenderungen.serie.kopf",
    // Die Neugestaltung von „Änderungen“ (WI-0265 B10): Objekte in der Zeile, Läufe und Felder im Bündel eines Tages.
    "aenderungen.zeile.objekte",
    // Die Editorenliste (WI-0276): zusammengefasste Änderungen, der Sprung nach „Änderungen“, die laufenden Sitzungen.
    "editoren.aenderungenZahl",
    "editoren.alleAenderungen",
    "editoren.sitzungenZahl",
    "aenderungen.buendel.laeufe",
    "aenderungen.buendel.felder",
    "kraftlinieneditor.unter.fehlt",
    "kraftlinieneditor.unter.nodices",
    "kraftlinieneditor.unter.abschnitte",
    "kraftlinieneditor.sammel.gewaehlt",
    "kraftlinieneditor.sammel.entfernen.frage",
    "kraftlinieneditor.sammel.entfernen.abnehmenKnopf",
    "kraftlinieneditor.sammel.entfernen.loeschenKnopf",
    "kraftlinieneditor.sammel.abgenommen",
    "kraftlinieneditor.sammel.geloescht",
    "wegeditor.zurueckholen.abschnitte",
    "wegeditor.entfernen.auswahl.loeschen",
    "wegeditor.entfernen.auswahl.abnehmen",
    "wegeditor.entfernen.auswahl.fertig",
    "wegeditor.entfernen.auswahl.abgenommen",
    "wegeditor.reisemittel.fensterZahl",
    // Die weiteren Straßennamen (WI-0302): die Zahl der Vorschläge für Vorleser, die geteilten Abschnitte in der Tafel.
    "wegeditor.weitere.ansage.zahl",
    "wegeditor.tafel.geteilt",
    "wegeditor.mehrfach.gewaehlt",
    "gebietseditor.sammel.untergebieteHoch",
    "wegeditor.neuerWeg.frage",
    "wegeditor.neuerWeg.fertig",
    "wegeditor.verbinden.fertig",
    "ortseditor.vereinigen.fertig",
    "infoPanel.staetten.hitsIn",
    "infoPanel.source",
    "infoPanel.canon.sources",
    "infoPanel.search.hit",
    "infoPanel.reviews.count",
    "bewertungen.durchschnitt",
    "infoPanel.lore.ware",
    "infoPanel.lore.ware.short",
    "infoPanel.lore.fauna",
    "infoPanel.lore.fauna.short",
    "infoPanel.lore.flora",
    "infoPanel.lore.flora.short",
    "infoPanel.lore.spezies",
    "infoPanel.lore.spezies.short",
    "infoPanel.lid.station",
    // „Gemeinsam mit“ (WI-0302): wie viele Abschnitte ein Weg mit einer anderen Straße teilt.
    "infoPanel.gemeinsam.abschnitte",
    "infoPanel.stage.territory",
    "auth.login.error.throttled",
    "auth.login.wait",
    "admin.wegfindung.bar.open",
    "admin.people.count",
    "admin.health.mem.child",
    "admin.system.brief.running",
    "admin.system.brief.queued",
    "admin.wikisync.n.aenderungen",
    "admin.wikisync.n.befunde",
    "admin.wikisync.n.objekte",
    "admin.wikisync.n.felder",
    "admin.wikisync.n.seiten",
    "admin.wikisync.n.zeilen",
    "admin.wikisync.n.flaechen",
    "admin.wikisync.n.vorschlaege",
    "admin.wikisync.bericht.mehr",
    "admin.wikisync.bericht.letzte",
    "admin.terrain.test.bar.unsaved",
    "admin.terrain.test.bar.deviating",
    "admin.terrain.test.under",
    "editorPanel.kachel.eintraege",
    "editorPanel.bearbeitungen.trotzdemAlle",
    "planner.unterwegs.gewaehlt",
    "planner.unterwegs.anzahl",
    "vorkommen.sammel.gegenden",
    "search.vorkommen.leuchtet",
    "search.vorkommen.leuchtetOrte",
    "search.ziel.gegenden",
    "search.ziel.orteZahl",
    "eintrag.rest.regel",
    "eintrag.rest.gegenden",
    // Die Treffer einer Sprache (WI-0261 S5b): das Wort hinter der Zahl am Deckel („1.243 Gebiete“).
    "sprache.treffer.einheit.territory",
    "sprache.treffer.einheit.region",
    "sprache.treffer.einheit.place",
    "sprache.treffer.einheit.path",
    // Die Zeilen des Spracheditors (WI-0261 S5d2): „12 Teilflächen“.
    "spracheditor.unter.teilflaechen",
    // „Regeln als Text“ (WI-0254 §13): die Zahlen in den Pillen, am Knopf und in der Meldung.
    "inhalte.vorkommen.text.n.eintraege",
    "inhalte.vorkommen.text.n.eintraegeAn",
    "inhalte.vorkommen.text.n.regeln",
    "inhalte.vorkommen.text.n.rueckfragen",
    "inhalte.vorkommen.text.n.fehler",
    // Die Bündelung der Glocke (WI-0268 C5): „3 neue Meldungen“.
    "notify.text.community_neuViele",
    "notify.text.community_rolleViele",
    // Glocke und Stapel neuer Reisebilder (WI-0272 S3, Aufgabe 19): „3 neue Reisebilder zur Prüfung“ und „3 Reisebilder warten auf Prüfung“.
    "notify.text.photobox_eingangViele",
    "notify.text.bewertung_neuViele",
    "notify.text.kartenvorschlag_neuViele",
    "photobox.stapel.zahl",
    // Der Reiter „Sonderrollen“ (WI-0279): „1 Recht · Stufe R“, „10 Rollen · 1 Zuteilung“.
    "admin.sonderrollen.rechteStufe",
    "admin.sonderrollen.summe",
    // Der Reiter „Wettermodell“ (WI-0288 Stufe 4): „2 Werte weichen von der Vorgabe ab.“
    "admin.wettermodell.leiste.abweichend",
    // „Reise als PDF“ (WI-0306): „5 Seiten“ im Fuß und „24 Etappen in 2 Abschnitten“ im PDF.
    "reisePdf.seiten",
    "reisePdf.abschnitte",
    // Der Straßen-Assistent (WI-0310): „1 Abschnitt“, „3 Abschnitte“ in Vorschau, Fuß und Befund.
    "wegeditor.assistent.zahl.abschnitte",
    "wegeditor.assistent.zahl.geaendert",
    "wegeditor.assistent.meilen",
    "wegeditor.assistent.befund.fremd",
    "wegeditor.assistent.befund.fertig",
    "wegeditor.assistent.befund.fertigArtikel",
    "wegeditor.assistent.abseits.satz",
    "wegeditor.assistent.quellen.geben",
    "wegeditor.assistent.schreibt.name",
    "wegeditor.assistent.schreibt.artikel",
    "wegeditor.assistent.schreibt.quellen",
    "wegeditor.assistent.schreibt.abseits",
    "wegeditor.assistent.fuss.geaendert",
] as const;
export type PluralCase = (typeof PLURAL_CASES)[number];

/**
 * 🔴 **Die beiden Fälle mit einer Stilform für genau zwei.** „Wegen **zweier** Sperrungen anders geführt“ ist kein
 * grammatischer Dual - Deutsch hat keinen -, sondern der Wortlaut, den der Betreiber gewählt hat.
 * `Intl.PluralRules("de").select(2)` liefert `other` und verschlucke ihn. Darum gewinnt bei genau `n === 2` die Form
 * `<fall>.two`, und erst danach entscheidet CLDR.
 *
 * 🪤 Für Polnisch ist das nicht nur harmlos, sondern richtig: Die 2 liegt dort in `few`, und eine eigene Zeile für
 * genau 2 ist innerhalb von `few` immer korrekt.
 */
export const DUAL_CASES = ["planner.closure.head", "planner.closure.anyway"] as const;
export type DualCase = (typeof DUAL_CASES)[number];

/** Die Formen, die diese Sprache erklärt. */
export type FormOf<L extends Locale> = (typeof PLURAL_FORMS)[L][number];

/** Die Zählschlüssel einer Sprache: jeder Fall in jeder ihrer Formen, dazu `two` für die beiden Stilfälle. */
export type PluralKey<L extends Locale> = `${PluralCase}.${FormOf<L>}` | `${DualCase}.two`;

/** Jeder Schlüssel, der keine Zählform ist - in jeder Tafel gleich. */
export type BaseKey = Exclude<MessageKey, PluralKey<"de">>;

/**
 * 🔴 **Der Typ einer Sprachtafel.** Jeder Schlüssel ohne Zählform, dazu jeder Zählfall in den Formen dieser Sprache.
 * Fehlt einer, bricht der Typecheck - statt dass mitten im Polnischen ein deutsches Wort steht.
 */
export type Tafel<L extends Locale> = Record<BaseKey | PluralKey<L>, string>;

const regeln = new Map<Locale, Intl.PluralRules>();

/**
 * Die Zählform einer Zahl in einer Sprache. 🪤 `n === 2` schlägt bei den Stilfällen die CLDR-Regel; ohne `fall` zählt
 * nur CLDR. Eine Form, die die Sprache nicht erklärt hat, fällt auf `other` zurück (siehe {@link PLURAL_FORMS}).
 */
export function pluralForm(n: number, lang: Locale, fall?: PluralCase): PluralForm {
    if (n === 2 && fall !== undefined && (DUAL_CASES as readonly string[]).includes(fall)) return "two";
    let regel = regeln.get(lang);
    if (regel === undefined) {
        // 🪤 Die Sprachmarke allein, ohne Land: Mehrzahlregeln hängen in CLDR an der Sprache, nicht an der Region.
        regel = new Intl.PluralRules(lang);
        regeln.set(lang, regel);
    }
    const form: string = regel.select(n);
    return (PLURAL_FORMS[lang] as readonly string[]).includes(form) ? (form as PluralForm) : "other";
}
