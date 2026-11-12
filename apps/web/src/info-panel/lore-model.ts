import {
    LORE_ROWS,
    type LoreCounts,
    type LoreGroup,
    type LoreKind,
    type LoreRowView,
    type SubjectLoreSection,
    type SubjectRef,
} from "@avesmaps3d/shared";
import { formatNumber, t, tPlural, type MessageKey, type PluralCase } from "../i18n/i18n";
import { cachedSection, loadSection } from "./panel-section-load";
import type { LoreRowValue, TextPart } from "./panel-types";

/**
 * Die Vorkommen als reines Modell (WI-0091, Vertrag `lore.yaml` -> `panelbezug`): der Zählsatz einer Zeile und der gegliederte
 * Inhalt dahinter. Reine Funktionen ohne Vue - sie lassen sich prüfen, ohne den Browser zu öffnen.
 *
 * 🔴 Vier Zeilen IN der Datentabelle, kein Abschnitt mit Kopf: Waren, Fauna, Flora, Spezies, in dieser Reihenfolge (Legacys
 * `AVESMAPS_LORE_ROWS`, WI-0063 27.7). Eine Art ohne Eintrag hat keine Zeile; es gibt kein „(0)“ (WI-0063 5.3).
 *
 * 🔴 Der Zählsatz steht zugeklappt wie aufgeklappt und sagt, was ERFASST ist - nicht, was am Ort lebt: „35 Handelswaren gelistet“,
 * „5 Tierarten beobachtet“, „2 Pflanzenarten gesehen“, „2 Spezies verzeichnet“. WELCHE Ränge die Zahl zählt, entscheidet
 * `LORE_READING.countScope` - die EINE Stelle, dieselbe, aus der der Server seine Zahl nimmt. Seit WI-0104 steht sie auf `own`:
 * der Satz zählt **nur, was als Liste dasteht**, der Link „Überall in Aventurien“ bringt seine Zahl selbst mit.
 *
 * 🪤 **Ob eine Zeile dasteht, entscheidet seither NICHT ihre Zahl** (`loreRowStands` beim Server) - eine Zeile, die nur den Link
 * trägt, sagt „0 … “ und steht trotzdem. Wie dieser Satz bei 0 lauten soll, liegt dem Betreiber vor (WI-0104).
 */

/**
 * Die Textbausteine je Art: der Zählsatz in Einzahl und Mehrzahl, die Beschriftung der Zeile und die Aufschrift ihres
 * Suchfelds (WI-0122, im Infinitiv: „Waren durchsuchen“).
 */
const KIND_TEXTS: Readonly<
    Record<LoreKind, { label: MessageKey; satz: PluralCase; kurz: PluralCase; search: MessageKey }>
> = {
    ware: {
        label: "infoPanel.lore.ware",
        satz: "infoPanel.lore.ware",
        kurz: "infoPanel.lore.ware.short",
        search: "infoPanel.lore.wareSearch",
    },
    fauna: {
        label: "infoPanel.lore.fauna",
        satz: "infoPanel.lore.fauna",
        kurz: "infoPanel.lore.fauna.short",
        search: "infoPanel.lore.faunaSearch",
    },
    flora: {
        label: "infoPanel.lore.flora",
        satz: "infoPanel.lore.flora",
        kurz: "infoPanel.lore.flora.short",
        search: "infoPanel.lore.floraSearch",
    },
    spezies: {
        label: "infoPanel.lore.spezies",
        satz: "infoPanel.lore.spezies",
        kurz: "infoPanel.lore.spezies.short",
        search: "infoPanel.lore.speziesSearch",
    },
};

const GROUP_HEADINGS: Readonly<Record<LoreGroup, MessageKey>> = {
    origin: "infoPanel.lore.groupOrigin",
    here: "infoPanel.lore.groupHere",
    region: "infoPanel.lore.groupRegion",
};

/**
 * 🔴 **ZWEI SCHWELLEN, WEIL ZWEI VERSCHIEDENE FRAGEN** (WI-0099, Legacys `AVESMAPS_LORE_GROUP_LID_MIN` und
 * `AVESMAPS_LORE_LETTER_MIN`, Owner 12.08.2026 an der Reichsstraße 2 mit 126 Handelswaren entschieden):
 *
 * - „Ist die **ZEILE** zu lang?“ entscheidet sich an der Gesamtzahl der Namen, die in dieser Zeile als Liste dastehen. Ab
 *   {@link LORE_GROUP_LID_MIN} starten die Gruppen zugeklappt, die erste davon offen.
 * - „Ist die **GRUPPE** zu lang zum Lesen?“ entscheidet sich an ihrer eigenen Zahl - und die Antwort ist
 *   {@link LORE_LETTER_MIN} = 0, also **immer Buchstabenmarken**.
 *
 * 🪤 **Damit löst sich die abgelehnte zweite Klappstufe von selbst auf.** Der Betreiber hat am 2026-10-07 am Blatt gesagt „nein
 * ‚Aus der Region‘ brauch keine eigene klappbox“ (Deckel im Deckel bei DREI Namen). Unter 25 Einträgen in der Zeile klappt hier
 * nichts, und die erste Gruppe steht ohnehin immer offen; der Fall, den er gesehen hat, entsteht gar nicht mehr.
 */

/**
 * Ab wie vielen Namen **in der ganzen Zeile** die Gruppen zugeklappt starten (Legacys `AVESMAPS_LORE_GROUP_LID_MIN`).
 *
 * 🔴 Es zählt die ZEILE, nicht die Gruppe: Sonst versteckte „3 Waren, davon 2 von hier“ zwei Namen hinter einem Klick. Und es
 * zählt, was als LISTE dasteht - der Link „Überall in Aventurien“ bringt keinen einzigen Namen mit, also auch keine Länge.
 */
export const LORE_GROUP_LID_MIN = 25;

/**
 * Ab wie vielen Namen eine Gruppe ihr Buchstabenregister bekommt - **0 heißt immer**, auch bei drei Namen (Legacys
 * `AVESMAPS_LORE_LETTER_MIN`).
 *
 * 🔴 Der Owner hat die Zahl am 12.08.2026 dreimal entschieden: 30 → 10 → 0. Bei 30 sah er die Marken an seinem Beispiel nie,
 * bei 10 mal so, mal so. Sein Befund zu 0: „es macht mein durchblättern keinen sinn dass in einem menü welche dranstehen und im
 * andern nicht.“ ⭐ Die Lehre dahinter: **eine Schwelle spart Platz im Einzelfall und kostet Verlässlichkeit über die Fläche.**
 * Die Marke bei drei Namen ist überflüssig - aber sie steht da, wo das Auge sie erwartet, und das ist mehr wert. **Keine eigene
 * Schwelle erfinden.**
 */
export const LORE_LETTER_MIN = 0;

/** Die Beschriftung der Zeile in der Feldliste („Waren“, „Fauna“, „Flora“, „Spezies“). */
export const loreLabel = (kind: LoreKind): string => t(KIND_TEXTS[kind].label);

/** Die Aufschrift des Suchfelds einer langen Zeile (WI-0122): „Waren durchsuchen“, „Tierarten durchsuchen“ … */
export const loreSearchLabel = (kind: LoreKind): string => t(KIND_TEXTS[kind].search);

/**
 * Der Zählsatz einer Zeile; die Zahl kommt formatiert hinein, damit Tausender und Sprache stimmen.
 *
 * 🔴 **Bei 0 kein Zählsatz, sondern eine Aussage** (WI-0104, Betreiber 2026-10-09: „Keine besonderen Vorkommen“): Die Zeile
 * steht, weil sie den Link „Überall in Aventurien“ trägt, und „0 Spezies verzeichnet“ darüber las sich wie ein Fehler.
 * 🔴 **`short` ist die Fassung am Telefon** (WI-0098, Betreiber 2026-10-09: „ok“ auf den kurzen Satz): Zahl und Art ohne Verb
 * („445 Pflanzenarten“), weil „445 Pflanzenarten gesehen“ bei 360 px gekürzt wurde. Die Aussage bei 0 hat keine kürzere.
 */
export function loreSentence(kind: LoreKind, count: number, short = false): string {
    if (count === 0) return t("infoPanel.lore.zero");
    const texts = KIND_TEXTS[kind];
    return tPlural(short ? texts.kurz : texts.satz, count, { n: formatNumber(count, 0) });
}

/**
 * Die vier Zeilen, die aus den Zählern entstehen - in Legacys Reihenfolge. Eine Art ohne Zähler hat keine Zeile, und ohne
 * Zählerobjekt gibt es keine einzige: Die Zeile wartet nicht auf eine Antwort, die sie nicht bekommt.
 *
 * 🔴 **Eine Art MIT Zähler bekommt ihre Zeile, auch wenn der Zähler 0 ist** (WI-0104). Der Server trägt eine Art genau dann in
 * `counts`, wenn ihre Zeile steht (`loreRowStands`) - unter `LORE_READING.countScope = "own"` steht sie auch an einem
 * Gegenstand, dessen ganzer Inhalt der Link „Überall in Aventurien“ ist, und dann ist ihre Zahl 0. 💣 **Ein `count <= 0` hier
 * wäre die zweite Stelle, die über das Dasein der Zeile entscheidet** - und sie würde die Betreiberentscheidung vom
 * 2026-10-07 („muss natürlich auch überall stehen“) hinter dem Rücken des Servers zurücknehmen. Das Dasein entscheidet der
 * Server, einmal.
 */
export function loreRowsOf(ref: SubjectRef, counts: LoreCounts | undefined): LoreRowValue[] {
    if (counts === undefined) return [];
    return LORE_ROWS.flatMap((kind): LoreRowValue[] => {
        const count = counts[kind];
        if (count === undefined) return [];
        return [
            {
                kind: "lore",
                ref,
                loreKind: kind,
                count,
                sentence: loreSentence(kind, count),
                shortSentence: loreSentence(kind, count, true),
            },
        ];
    });
}

/**
 * Die Zeilen aus einer MITGEBRACHTEN Antwort - in der Reihenfolge, in der der Server sie nennt (`LORE_ROWS`).
 *
 * 🔴 **Die EINE Stelle für Gegenstände ohne Sektionsadresse:** die Routenetappe (WI-0106) und der Kartenpunkt (WI-0110).
 * Beide haben keine Adresse, unter der eine Sektion nachzuholen wäre (`subjectSectionUrl` gibt für sie `null`), also bringt
 * jede Zeile die ganze Antwort mit (`section`) und fragt beim Aufklappen nichts nach. Und keine `ref`: Es gibt kein
 * Kartenobjekt, das zu fragen wäre.
 *
 * 🪤 Jede Zeile hält DASSELBE `section`-Objekt - die vier Zeilen eines Gegenstands teilen EINEN Lauf (WI-0091 A10).
 */
export function loreRowsOfSection(section: { rows: readonly LoreRowView[] }): LoreRowValue[] {
    return section.rows.map((row) => ({
        kind: "lore" as const,
        loreKind: row.kind,
        count: row.count,
        sentence: loreSentence(row.kind, row.count),
        shortSentence: loreSentence(row.kind, row.count, true),
        section,
    }));
}

/**
 * Ein Name, fertig für die Anzeige: `ref` macht einen Objektlink, `href` einen Link auf den Wiki-Artikel, keines von beiden lässt
 * Text stehen.
 *
 * 🪤 `jump` trägt NUR die Stättenzeile (WI-0109): der Sprung ⊕ hinter dem Namen auf das Kartenobjekt. Er steht hier und nicht in
 * einem eigenen Modell, weil derselbe Namensblock ihn zeichnet - genau wie in Legacy, wo die Stätten dafür `item.suffixMarkup`
 * an `avesmapsLoreNamesBlockMarkup` übergeben, statt den Block ein zweites Mal zu bauen.
 */
export type LoreEntryModel = TextPart & { key: string; href?: string; jump?: SubjectRef; loreKind?: LoreKind };

/**
 * Ein Name, wie eine Antwort ihn liefert. 🔴 **Hier treffen die zwei Aufrufer zusammen**: `LoreEntryView` (Vorkommen: Name,
 * Objektlink oder Infobox des Vorkommens) und `StaetteView` (Stätten: Name, Wiki-Artikel, Sprung). Der Namensblock kennt nur diese Form, und
 * darum gibt es ihn genau einmal.
 *
 * `loreKind` ist die Art des Vorkommens, die die Zeile ohnehin kennt (`LoreRowView.kind`): Der Name öffnet dessen Infobox mit Zeichen und Titel sofort
 * (`info-lore-entry.vue`), und dazu braucht er sie. Stätten tragen sie nicht.
 */
export type NamedEntry = { name: string; ref?: SubjectRef; url?: string; jump?: SubjectRef; loreKind?: LoreKind };

/**
 * Die Art vor einem Namen in der Form `rows` („Archiv · Hauptsitz Archiv der Praios-Kirche“): der Text der Art und, wo es
 * eines gibt, ihr Kennzeichen.
 */
export interface LoreRowLabel {
    text: string;
    mark?: string;
}

/** Ein Buchstabenblock: die Marke und die Namen darunter, als Reihe. Ohne Marke (`letter: ""`) ist es die alte Komma-Reihe. */
export interface LoreLetterBlock {
    key: string;
    /** Die Marke („A“, „#“); leer heißt: keine Buchstabenspalte. */
    letter: string;
    /** Nur in der Form `rows`: die Art, die vor den Namen steht. */
    label?: LoreRowLabel;
    entries: LoreEntryModel[];
}

/**
 * Die Namen EINER Gruppe (WI-0099, Legacys `avesmapsLoreNamesBlockMarkup`).
 *
 * - `register`: nach Buchstaben gegliedert, die Blöcke laufen in zwei Spalten. Das ist der Normalfall, weil
 *   {@link LORE_LETTER_MIN} 0 ist.
 * - `run`: EIN Block ohne Marke, die Namen als kommagetrennte Reihe - die Gestalt vor WI-0099.
 *
 * 🪤 **Der `run`-Zweig bleibt stehen, obwohl er bei Schwelle 0 nie greift.** Er ist Legacys Ein-Namen-Fall und der Zweig, den
 * ein anderer Aufrufer mit eigener Schwelle braucht: In Legacy übergeben die „Stätten“ `AVESMAPS_STAETTEN_BUCHSTABEN_AB = 2`,
 * weil sie schon nach ART gliedern und eine Marke „H“ über einem einzigen „Herzog-Cusimo-Aquädukt“ eine zweite
 * Gliederungsebene ohne Inhalt wäre (Owner 2026-08-15: „das mit den buchstaben ist hier übertrieben“).
 * - `rows`: je Block EINE Zeile „Art · Name“, die Art gedämpft davor (`label`). Das ist die Sammelgruppe „Weitere Gebäude und Stätten“
 *   einer langen Stättenzeile (WI-0122): Arten mit genau einem Eintrag, die keine eigene Klappzeile bekommen.
 */
export interface LoreNamesModel {
    form: "register" | "run" | "rows";
    blocks: LoreLetterBlock[];
}

/**
 * Der Buchstabe, unter dem ein Name einsortiert wird (Legacys `avesmapsLoreLetterOf`).
 *
 * Erstes Zeichen, `normalize("NFD")`, diakritische Zeichen weg, Großbuchstabe: Umlaute fallen damit auf ihren
 * Grundbuchstaben (Ä → A), sonst hätte „Älbler“ eine eigene Marke hinter Z. Ist das Ergebnis kein `[A-Z]`, ist die Marke `#` -
 * **Ziffern und alles Übrige landen dort**, es gibt kein „Unbekannt“.
 *
 * 🪤 **Eine benannte Abweichung von Legacy, ein Zeichen groß:** Hier steht `.charAt(0)` hinter dem Großschreiben. Legacy prüft
 * die ganze gefaltete Zeichenkette mit `/[A-Z]/` und gibt sie zurück - und weil `"ß".toUpperCase()` zwei Zeichen liefert
 * („SS“), wäre Legacys Marke für einen ß-Namen die zweibuchstabige „SS“. Mit `.charAt(0)` ist sie „S“. Für jedes andere
 * Zeichen ist das Ergebnis identisch; im gemessenen Bestand beginnt kein Name mit ß, die Abweichung ändert also heute keine
 * einzige Marke und schließt nur den Fall, in dem eine Marke aus der schmalen Spalte ragen würde.
 */
export function loreLetterOf(name: string): string {
    const first = name.trim().charAt(0);
    if (first === "") return "#";
    const folded = first.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().charAt(0);
    return /[A-Z]/.test(folded) ? folded : "#";
}

const entryModel = (entry: NamedEntry, key: string): LoreEntryModel => ({
    key,
    text: entry.name,
    ...(entry.ref === undefined ? {} : { ref: entry.ref }),
    ...(entry.url === undefined ? {} : { href: entry.url }),
    ...(entry.jump === undefined ? {} : { jump: entry.jump }),
    ...(entry.loreKind === undefined ? {} : { loreKind: entry.loreKind }),
});

/**
 * Die Namen einer Gruppe, sortiert und nach Buchstaben gegliedert.
 *
 * 💣 **Sortiert wird mit `localeCompare(…, "de")`, nicht mit `<`:** sonst stünde „Älbler“ hinter „Zwerg“ und bekäme eine eigene
 * Marke am Ende, während seine Marke „A“ heißt.
 */
export function loreNamesOf(
    entries: readonly NamedEntry[],
    keyPrefix: string,
    letterMin: number = LORE_LETTER_MIN,
): LoreNamesModel {
    // ⚠️ Leere Liste zuerst: bei Schwelle 0 greift der Komma-Zweig nie mehr, und ohne diesen Riegel entstünde ein leerer
    // Spaltenkasten. Erreichbar ist der Fall heute nicht (eine leere Gruppe steht nicht in der Antwort).
    if (entries.length === 0) return { form: "run", blocks: [] };
    const named = entries.map((entry, at) => entryModel(entry, `${keyPrefix}:${String(at)}`));
    if (named.length < letterMin)
        return { form: "run", blocks: [{ key: `${keyPrefix}:run`, letter: "", entries: named }] };

    const sorted = [...named].sort((left, right) => left.text.localeCompare(right.text, "de"));
    const blocks: LoreLetterBlock[] = [];
    for (const entry of sorted) {
        const letter = loreLetterOf(entry.text);
        const last = blocks.at(-1);
        // 🪤 Die Nummer steckt im Schlüssel, nicht nur die Marke: Eine Marke kann zweimal in einer Gruppe stehen, wenn die
        // deutsche Sortierung ein Zeichen ohne Grundbuchstaben zwischen zwei Buchstaben einsortiert (Œ zwischen O und P → „#“).
        if (last === undefined || last.letter !== letter) {
            blocks.push({ key: `${keyPrefix}:${String(blocks.length)}:${letter}`, letter, entries: [entry] });
        } else last.entries.push(entry);
    }
    return { form: "register", blocks };
}

/**
 * Zeilen „Art · Name“ (Form `rows`, WI-0122): je Eintrag ein Block mit seiner Art als `label`, in der Reihenfolge, in der sie
 * kommen - der Aufrufer sortiert, denn nur er weiß, wonach (bei den Stätten nach der Art, wie die Gruppen darüber).
 */
export function loreLabelledRowsOf(
    rows: readonly { label: LoreRowLabel; entry: NamedEntry }[],
    keyPrefix: string,
): LoreNamesModel {
    return {
        form: "rows",
        blocks: rows.map((row, at) => ({
            key: `${keyPrefix}:${String(at)}`,
            letter: "",
            label: row.label,
            entries: [entryModel(row.entry, `${keyPrefix}:${String(at)}:0`)],
        })),
    };
}

/** Eine Gruppe des aufgeklappten Inhalts, fertig für die Anzeige. */
export interface LoreGroupModel {
    key: string;
    /**
     * Die Überschrift. 🔴 **Sie steht IMMER** - auch bei einer einzigen Gruppe (Betreiberentscheidung 2026-10-07, WI-0103).
     * Nie leer; das Bauteil prüft nur noch, ob ein Modell überhaupt da ist.
     */
    heading: string;
    /** Die Zahl neben der Überschrift („Direkt hier 98“) - sie sagt vorher, was einen erwartet. */
    count: number;
    /** Klappbar: mehrere Gruppen UND mindestens {@link LORE_GROUP_LID_MIN} Namen in der ganzen Zeile. */
    collapsible: boolean;
    /** Steht der Inhalt beim Zeichnen offen? Immer, außer bei einer klappbaren Gruppe, die nicht die erste ist. */
    open: boolean;
    names: LoreNamesModel;
    /** Das Kennzeichen hinter der Zahl („Hauptsitz“, WI-0122) - nur an einer Art der Stätten. */
    mark?: string;
    /**
     * Die Überschrift IST der Gegenstand (die Art einer Stätte) und wird mitgesucht. Fehlt an den Vorkommen: „Von hier“ sagt,
     * woher etwas kommt, nicht, was es ist.
     */
    art?: boolean;
    /** Die Sammelgruppe „Weitere Gebäude und Stätten“ (WI-0122): Form `rows`, abgesetzt von den Art-Gruppen darüber. */
    collected?: boolean;
    /** Nur während einer Suche: die ungefilterte Zahl, damit der Kopf „1 von 3“ sagen kann (`lore-search.ts`). */
    total?: number;
}

/**
 * Der aufgeklappte Inhalt einer Zeile, nach Nähe gegliedert (`lore.yaml` -> `panelbezug.zeilen.inhalt`).
 *
 * 🔴 **DIE ÜBERSCHRIFT STEHT IMMER - auch bei einer einzigen Gruppe** (Betreiberentscheidung vom 2026-10-07, WI-0103). Das ist
 * eine **bewusste Abweichung von Legacy** und darf nicht als Fehler zurückgebaut werden.
 *
 * Legacys `avesmapsLoreGroupedMarkup` lässt den Kopf bei einer einzigen Gruppe weg - „eine einzige Gruppe gliedert nichts“. Der
 * Betreiber hat am Hexenwald gesehen, wohin das führt: Die Fläche trägt nur geerbte Vorkommen, also nur die Gruppe `region`, also
 * keinen Kopf - und damit stand nicht da, DASS sie geerbt sind. Wörtlich: „Flächen haben abgeleitete Vorkommen <- z.B.
 * ‚Hexenwald‘, prima. aber abgeleitet bedeutet für mich (‚Aus der Region‘). das steht da nicht.“
 *
 * ⭐ **Die Lehre:** „Aus der Region“ ist keine Gliederung, sondern eine **Aussage** - abgeleitet gegen direkt. Eine Gruppe
 * gliedert vielleicht nichts, aber sie SAGT etwas, und was sie sagt, steht auch dann da, wenn sie allein steht.
 *
 * Geklappt wird dagegen weiter nach Legacys Regel, denn Klappen IST Gliederung - über sie entscheidet die ZEILE, nie die einzelne
 * Gruppe und nie ihre eigene Zahl, sondern ihre **Position**:
 *
 * 1. **Eine einzige Gruppe** - Kopf und Zahl, kein Pfeil: zum Klappen gibt es keinen zweiten Block.
 * 2. **Mehrere Gruppen, unter {@link LORE_GROUP_LID_MIN} Namen in der Zeile** - Kopf und Zahl, ohne Pfeil: alles steht offen da.
 * 3. **Mehrere Gruppen, ab {@link LORE_GROUP_LID_MIN}** - jede Gruppe klappbar, und **nur die erste** startet offen. Bei den
 *    Waren ist das „Von hier“, die stärkste Aussage über den Ort.
 *
 * Eine leere Gruppe entfällt samt Überschrift - eine Überschrift ohne Inhalt ist kein Aufbau, sondern Lärm.
 */
export function loreGroupsOf(row: LoreRowView): LoreGroupModel[] {
    // „Ist die ZEILE zu lang?“ - alles, was in dieser Zeile als Liste dasteht, über die Gruppen hinweg.
    const inLine = row.groups.reduce((sum, group) => sum + group.entries.length, 0);
    const collapsible = row.groups.length > 1 && inLine >= LORE_GROUP_LID_MIN;
    return row.groups.map((group, at) => {
        const key = `${row.kind}:${group.group}`;
        return {
            key,
            heading: t(GROUP_HEADINGS[group.group]),
            count: group.entries.length,
            collapsible,
            open: !collapsible || at === 0,
            // Die Art der Zeile reist an jedem Namen mit: Der Name eines Vorkommens öffnet dessen Infobox (`info-lore-entry.vue`).
            names: loreNamesOf(
                group.entries.map((entry) => ({ ...entry, loreKind: row.kind })),
                key,
            ),
        };
    });
}

/** Die Linkzeile „Überall in Aventurien (445)“ einer Zeile - oder `undefined`, wo es kein Ziel gibt. */
export interface LoreEverywhereModel {
    label: string;
    ref: SubjectRef;
}

/**
 * 🔴 **„Überall in Aventurien“ ist ein LINK, keine Liste** (Betreiber 2026-10-06: „am besten wär eigentlich ein Link von
 * ‚Überall in Aventurien‘-> klick -> ganze aventurien wird gezeigt und alle vorkommen in aventurien gelistet“). Er führt auf die
 * Landschaft „Aventurien“, wo dieselben Einträge ihr eigenes „Direkt hier“ sind - darum reist hier kein einziger Name mit, nur
 * die Zahl und das Ziel. Die Zahl steht dabei, weil man vor einem Klick wissen soll, ob er sich lohnt (Design Guide §16.3).
 */
export function loreEverywhereOf(row: LoreRowView): LoreEverywhereModel | undefined {
    const link = row.everywhere;
    if (link === undefined) return undefined;
    return {
        label: t("infoPanel.lore.groupCount", {
            name: t("infoPanel.lore.groupEverywhere"),
            n: formatNumber(link.count, 0),
        }),
        ref: link.ref,
    };
}

/** Die Zeilen des Gegenstands aus dem Cache - oder `undefined`; damit zeichnet ein zweiter Aufruf ohne Wartezeile. */
export const cachedLore = (ref: SubjectRef): SubjectLoreSection | undefined =>
    cachedSection<SubjectLoreSection>("lore", ref);

/** Holt die Zeilen, zuerst aus dem Cache (WI-0091 A10: kein zweiter Serverlauf für denselben Gegenstand). */
export const loadLore = (
    ref: SubjectRef,
    signal?: AbortSignal,
    fetcher?: typeof fetch,
): Promise<SubjectLoreSection | null> => loadSection<SubjectLoreSection>("lore", ref, signal, fetcher);
