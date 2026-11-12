import type { StaettenGroup, SubjectRef, SubjectStaettenSection } from "@avesmaps3d/shared";
import { formatNumber, t, tPlural } from "../i18n/i18n";
import { LORE_GROUP_LID_MIN, loreLabelledRowsOf, loreNamesOf, type LoreGroupModel } from "./lore-model";
import { cachedSection, loadSection } from "./panel-section-load";
import type { StaettenRowValue } from "./panel-types";

/**
 * Die Stätten eines Ortes als reines Modell (WI-0109, Vertrag `staetten.yaml` -> `panelbezug`): der Zählsatz der Zeile und ihr
 * nach ART gegliederter Inhalt. Reine Funktionen ohne Vue.
 *
 * 🔴 **EINE Zeile, kein Abschnitt** - in der Datentabelle des Ortes, **über** den Vorkommen (Owner 2026-08-15: „tu die stätten
 * über Waren"). Reihenfolge der Zeilen am Ort: Stätten, Waren, Fauna, Flora, Spezies, Klimazone.
 *
 * 🔴 **DIE OPTIK IST DIE DER VORKOMMEN, UND DAS IST ABSICHT.** Legacys Dateikopf sagt es wörtlich: „Die Optik kommt von den
 * LORE-KLASSEN … Eine dritte Rezeptur für ‚Liste von Namen in einer Infobox-Klappzeile' wäre genau die Divergenz, vor der
 * AGENTS.md §11 warnt." Darum entsteht hier kein Bauteil: Dieses Modell liefert dieselben {@link LoreGroupModel}, die
 * `loreGroupsOf` liefert, und `info-lore-row.vue` zeichnet beide - samt Suchfeld (`lore-search.ts`, WI-0122).
 *
 * 🔴 **FÜNF Unterschiede zu den Vorkommen, und nur fünf** (die letzten beiden aus dem Nachtrag zu WI-0122: alle Gruppen
 * starten zu, und die Ordnung ist wählbar - beides in {@link staettenGroupsOf}):
 * 1. **Die Gliederungsachse** ist die ART, nicht die Nähe - und sie ist dynamisch (gemessen 2026-10-08: 394 Arten, Gareth
 *    allein 121). Sortiert wird deutsch (`localeCompare(…, "de")`), wie in Legacy.
 * 2. **Das Buchstabenregister beginnt bei ZWEI Namen** ({@link STAETTEN_LETTER_MIN}), bei den Vorkommen bei 0 (also immer).
 *    Beides läuft über denselben Parameter derselben Funktion (`loreNamesOf(entries, key, letterMin)`).
 * 3. **Eine lange Zeile sammelt die Einzelnen** (WI-0122, {@link staettenGroupsOf}): Eine Art mit einem einzigen Eintrag
 *    bekommt dort keine eigene Klappzeile, sondern steht als Zeile „Art · Stätte“ in der Gruppe „Weitere Gebäude und Stätten“.
 * 4. **Eine klappende Zeile startet ganz zu** - bei den Vorkommen steht die erste Gruppe („Von hier“) offen.
 * 5. **Die Ordnung ist wählbar**: alphabetisch oder nach Häufigkeit (`staetten-order.ts` hält die Wahl für die Sitzung).
 */

/**
 * Ab wie vielen Namen eine ART ihr Buchstabenregister bekommt (Legacys `AVESMAPS_STAETTEN_BUCHSTABEN_AB`).
 *
 * 🔴 **2, nicht 0 - und das ist der einzige Unterschied zur Vorkommenszeile.** Der Owner hat es am 2026-08-15 in zwei Schritten
 * entschieden: erst „das mit den buchstaben ist hier übertrieben", dann „kannst du ab >1 wieder buchstaben machen?". Der
 * Streitpunkt war die Marke über einem EINZIGEN Namen: „H · Herzog-Cusimo-Aquädukt" ist eine Gliederung von einem Element.
 *
 * ⭐ Der Grund, warum hier eine Schwelle richtig ist und bei den Vorkommen 0: **hier gliedert schon die ART vor.** Bei den
 * Vorkommen stehen 126 Handelswaren in EINER Gruppe, da trägt die Marke immer; hier hat Gareth 121 Arten mit im Schnitt 3,4
 * Einträgen, und 65 dieser Arten haben genau einen Namen (gemessen 2026-10-08). **Keine eigene Schwelle erfunden.**
 */
export const STAETTEN_LETTER_MIN = 2;

/**
 * Ab wie vielen Einträgen eine ART in einer langen Zeile ihre eigene Klappzeile bekommt (WI-0122, Betreiber 2026-10-09: „ja, B
 * (A + Suchfeld) bauen“).
 *
 * 🔴 **Keine neue Zahl, sondern dieselbe Regel wie die Marke:** Eine Klappzeile über einem einzigen Namen ist, was der Owner
 * am 2026-08-15 über die Marke gesagt hat - „eine Gliederung von einem Element“. Gemessen an Elenvina (90 Stätten in 46 Arten,
 * 30 davon mit einem Eintrag): 46 Klappzeilen werden 18, Gareth 121 werden 57, Vinsalt 50 werden 12.
 */
export const STAETTEN_OWN_GROUP_MIN = STAETTEN_LETTER_MIN;

/**
 * Ab wie vielen Stätten **in der ganzen Zeile** die Art-Gruppen zugeklappt starten.
 *
 * 🪤 **Derselbe Wert und dieselbe Stelle wie bei den Vorkommen** ({@link LORE_GROUP_LID_MIN} = 25). Legacy führt dafür eine
 * zweite Konstante (`AVESMAPS_STAETTEN_GRUPPEN_KLAPP_AB = 25`) und sagt im Kommentar selbst „Derselbe Wert wie bei den
 * Lore-Gruppen" - es ist dieselbe Frage („ist die ZEILE zu lang?") mit derselben Antwort, und zwei Konstanten für eine Regel
 * driften. Gemessen tragen 38 der 495 Orte mit Stätten 25 oder mehr (Gareth 414, Punin 175, Al'Anfa 151).
 *
 * 🔴 Seit WI-0122 beantwortet dieselbe Zahl zwei weitere Fragen derselben Art: Ab ihr werden die Einzelnen gesammelt, und ab
 * ihr steht das Suchfeld (`lineSearchable`). Unter ihr bleibt alles, wie es ist.
 */
export const STAETTEN_GROUP_LID_MIN = LORE_GROUP_LID_MIN;

/**
 * Das Kennzeichen, das Legacy an die Art eines Organisationssitzes hängt („Bankhaus (Hauptsitz)“,
 * `api/_internal/wiki/organisation-sync.php`: `$art .= ' (Hauptsitz)'`).
 *
 * 🔴 **Eine feste Regel über den Wert, kein Name:** Die Anzeige trennt nur dieses eine Anhängsel ab und stellt es gedämpft
 * hinter die Zahl (WI-0122). Die Art bleibt samt Kennzeichen ihr eigener Schlüssel - „Kanzlei“ und „Kanzlei (Hauptsitz)“ sind
 * zwei Arten, wie bisher. Das Wort selbst kommt in der Anzeige aus der Sprachtafel (`infoPanel.staetten.seat`).
 */
export const STAETTEN_SEAT_SUFFIX = " (Hauptsitz)";

/** Die Beschriftung der Zeile in der Feldliste: „Innerorts“ (WI-0122; Legacys `popup.fieldPlaces` sagt „Stätten“). */
export const staettenLabel = (): string => t("infoPanel.staetten.label");

/**
 * Der Zählsatz der Zeile: „21 Gebäude und Stätten verzeichnet“, in der Einzahl „1 Gebäude oder Stätte verzeichnet“.
 *
 * 🔴 **Bewusst anders als Legacy** (WI-0122, Betreiber 2026-10-09: „ja, umbenennen in Innerorts und Editor-Abschnitt
 * schreiben“): Legacy sagt „N besondere Stätten verzeichnet“ (`AVESMAPS_STAETTEN_SINGULAR`/`_PLURAL`, Spec des
 * Innerorts-Imports vom 2026-09-02). Die Zeile heißt jetzt „Innerorts“, und ihr Satz nimmt die Kategorie der Wiki
 * Aventurica auf („Besondere Gebäude/Stätten“), weil darunter Gasthäuser, Kontore und Tempel ebenso stehen wie Plätze.
 *
 * 🔴 Der Satz sagt, was ERFASST ist, nicht was am Ort steht - und er sagt zugeklappt wie aufgeklappt dasselbe (Owner-Entscheid
 * 2026-08-12 am Deckel). 🪤 **Er zählt nur, was als Liste dasteht** (`countScope: "own"`, WI-0104): Hier ist das jede Stätte, denn
 * es gibt keinen Link „Überall …“ und damit keine Zahl, die daneben stünde.
 */
export const staettenSentence = (count: number): string =>
    tPlural("infoPanel.staetten", count, { n: formatNumber(count, 0) });

/** Die Fassung am Telefon ohne Verb („90 Gebäude und Stätten“), dieselbe Regel wie bei den Vorkommen (WI-0098). */
export const staettenShortSentence = (count: number): string =>
    tPlural("infoPanel.staetten.short", count, { n: formatNumber(count, 0) });

/** Die Antwort, soweit die Zeile sie braucht. */
export interface StaettenAnswer {
    count: number;
    groups: readonly StaettenGroup[];
}

/**
 * Die Zeile, die aus dem Zähler der Detailantwort entsteht - oder keine.
 *
 * 🔴 **Ohne Zähler keine Zeile, und bei 0 auch nicht.** Eine Zeile „0 Gebäude und Stätten verzeichnet“ wäre eine Aussage über
 * unseren Datenbestand, die niemanden interessiert, und sie stünde an 4.489 der 4.984 Orte (Legacy lässt sie aus demselben Grund
 * weg: „sie stünde bei den meisten der 4653 Orte da“). 🪤 **Das widerspricht WI-0104 nicht:** Dort bleibt die Zeile bei 0, weil
 * sie den Link „Überall in Aventurien“ trägt - hier gibt es keinen, die Zeile wäre wirklich leer.
 */
export function staettenRowOf(ref: SubjectRef, count: number | undefined): StaettenRowValue[] {
    if (count === undefined || count <= 0) return [];
    return [
        {
            kind: "staetten",
            ref,
            count,
            sentence: staettenSentence(count),
            shortSentence: staettenShortSentence(count),
        },
    ];
}

/** Die zwei Ordnungen der Art-Gruppen (WI-0122 Nachtrag): alphabetisch (Vorgabe) und nach Häufigkeit. */
export const STAETTEN_ORDERS = ["alpha", "count"] as const;
export type StaettenOrder = (typeof STAETTEN_ORDERS)[number];

/**
 * Bietet die Zeile die Wahl der Ordnung an? 🔴 **Nur, wo sie etwas ändert** - dieselbe Haltung wie bei den Filtern der
 * Katalogfenster (Guide §12.6: „Ein Filter erscheint nur, wenn er die Liste teilt“). Eine kurze Zeile hat kein Suchfeld und
 * darum auch keinen Platz für die Wahl; eine lange, deren Arten nach Häufigkeit genauso stehen wie nach dem Alphabet, bekäme
 * ein Bedienelement ohne Wirkung.
 */
export function staettenOrderMatters(answer: StaettenAnswer): boolean {
    const keys = (order: StaettenOrder): string =>
        staettenGroupsOf(answer, order)
            .map((group) => group.key)
            .join("\n");
    return keys("alpha") !== keys("count");
}

/** Eine Art, wie sie dasteht: ihr Schlüssel (das Wort samt Anhängsel), das Wort davor und ob sie ein Hauptsitz ist. */
interface StaettenType {
    key: string;
    art: string;
    seat: boolean;
    entries: StaettenGroup["entries"];
}

function typeOf(key: string, entries: StaettenGroup["entries"]): StaettenType {
    const seat = key.endsWith(STAETTEN_SEAT_SUFFIX) && key.length > STAETTEN_SEAT_SUFFIX.length;
    return { key, art: seat ? key.slice(0, -STAETTEN_SEAT_SUFFIX.length) : key, seat, entries };
}

/**
 * Der aufgeklappte Inhalt: eine Gruppe je ART, deutsch sortiert, die Namen darunter mit Register ab zwei.
 *
 * 🔴 **DIE GRUPPENÜBERSCHRIFT STEHT IMMER - auch bei einer einzigen Art** (Betreiberentscheidung vom 2026-10-07, WI-0103). Das
 * ist eine **bewusste Abweichung von Legacy** und darf nicht als Fehler zurückgebaut werden: Legacys
 * `avesmapsStaettenGruppenMarkup` lässt bei `arten.length <= 1` Kopf und Zahl weg („Bei ‚1 besondere Stätte‘ ist der Kopf
 * ‚Tempel 1‘ über einem einzigen Namen nur Lärm“). Der Betreiber hat am Hexenwald das Gegenteil entschieden: eine Gruppe
 * gliedert vielleicht nichts, aber sie SAGT etwas - hier die Art, die sonst nirgends im Panel steht. **Es trifft 255 der 495
 * Orte mit Stätten** (gemessen 2026-10-08), die meisten davon mit einem einzigen Namen.
 *
 * 💣 **Sortiert wird mit dem Wort, das DASTEHT**, nicht mit dem Wert der Antwort: Eine Art ohne Namen trägt in der Anzeige
 * „Bauwerk“, und Legacy sortiert genau so (dort steht der Rückfall schon in `art`, wenn `localeCompare` ihn vergleicht). Der
 * Server schickt `type: ""` und mischt sich nicht ein. Gleiche sichtbare Überschriften bilden eine Anzeigegruppe; die
 * Roharten und alle Einträge bleiben in der Antwort unverändert (WI-0112). Seit WI-0122 steht „ (Hauptsitz)“ nicht mehr im
 * Wort, sondern als Kennzeichen dahinter - sortiert wird also „Bankhaus“, und bei gleichem Wort kommt die Art ohne Kennzeichen
 * zuerst.
 *
 * 🔴 **EINE LANGE ZEILE SAMMELT DIE EINZELNEN** (WI-0122, Betreiber 2026-10-09): Ab {@link STAETTEN_GROUP_LID_MIN} Stätten in der
 * Zeile bekommt nur eine Art mit mindestens {@link STAETTEN_OWN_GROUP_MIN} Einträgen eine eigene Gruppe; alle Arten mit genau
 * einem Eintrag stehen am Ende in der Gruppe „Weitere Gebäude und Stätten“ (Form `rows`, je Zeile „Art · Stätte“, nach der Art sortiert).
 * 🪤 **Unter der Schwelle ändert sich nichts** - dort klappt nichts, jede Art steht mit ihrem Kopf offen da, und die
 * Entscheidung WI-0103 („die Überschrift steht immer“) gilt unverändert: Eine Sammelgruppe über drei Stätten wäre eine
 * Gliederung, die niemand braucht.
 *
 * Geklappt wird nach Legacys Regel, denn Klappen IST Gliederung: mehrere Gruppen UND {@link STAETTEN_GROUP_LID_MIN} Stätten in
 * der Zeile. 🔴 **Dann startet ALLES zu, auch die erste Gruppe** - eine bewusste Abweichung von Legacy
 * (`map-features-settlement-places.js`: „Die erste Art steht offen“, geerbt von den Vorkommen). Betreiber 2026-10-09 auf die
 * Frage „warum ist das 1. element (archiv) immer aufgeklappt?“: „nö kannst zumachen“. Bei den Stätten ist die erste Art nur
 * die alphabetisch erste, keine Aussage über den Ort; bei den Vorkommen ist die erste Gruppe „Von hier“, und dort bleibt sie
 * offen (`loreGroupsOf`).
 *
 * 🔴 **Die Ordnung ist wählbar** (WI-0122 Nachtrag, Betreiber 2026-10-09: „kannst du neben dem suchfeld ein kleines dropdown
 * bauen, wo man alphabetisch (wie jetzt) und nach häufigkeit sortieren kann?“): `alpha` wie bisher, `count` nach der Zahl der
 * Einträge absteigend, bei Gleichstand alphabetisch. „Weitere Gebäude und Stätten“ steht in beiden Ordnungen am Ende, und ihre Zeilen
 * bleiben nach der Art geordnet (sie haben alle die Zahl 1).
 */
export function staettenGroupsOf(answer: StaettenAnswer, order: StaettenOrder = "alpha"): LoreGroupModel[] {
    const inLine = answer.groups.reduce((sum, group) => sum + group.entries.length, 0);
    const fallback = t("infoPanel.staetten.fallbackType");
    const byKey = new Map<string, StaettenGroup["entries"]>();
    for (const group of answer.groups) {
        const key = group.type === "" ? fallback : group.type;
        byKey.set(key, [...(byKey.get(key) ?? []), ...group.entries]);
    }
    const types = [...byKey]
        .map(([key, entries]) => typeOf(key, entries))
        .sort((left, right) => left.art.localeCompare(right.art, "de") || Number(left.seat) - Number(right.seat));
    const long = inLine >= STAETTEN_GROUP_LID_MIN;
    const own = long ? types.filter((type) => type.entries.length >= STAETTEN_OWN_GROUP_MIN) : types;
    const single = long ? types.filter((type) => type.entries.length < STAETTEN_OWN_GROUP_MIN) : [];
    const collapsible = own.length + (single.length > 0 ? 1 : 0) > 1 && long;
    const seat = t("infoPanel.staetten.seat");
    // Nach der Zahl: absteigend, der Gleichstand bleibt in der alphabetischen Ordnung von `types` (die Sortierung ist stabil).
    const ordered =
        order === "count" ? [...own].sort((left, right) => right.entries.length - left.entries.length) : own;

    const models: LoreGroupModel[] = ordered.map((type) => {
        const key = `staetten:${type.key}`;
        return {
            key,
            heading: type.art,
            count: type.entries.length,
            collapsible,
            open: !collapsible,
            names: loreNamesOf(type.entries, key, STAETTEN_LETTER_MIN),
            art: true,
            ...(type.seat ? { mark: seat } : {}),
        };
    });
    if (single.length > 0) {
        const key = "staetten:weitere";
        models.push({
            key,
            heading: t("infoPanel.staetten.collected"),
            count: single.length,
            collapsible,
            open: !collapsible,
            names: loreLabelledRowsOf(
                single.flatMap((type) =>
                    type.entries.map((entry) => ({
                        label: { text: type.art, ...(type.seat ? { mark: seat } : {}) },
                        entry,
                    })),
                ),
                key,
            ),
            collected: true,
        });
    }
    return models;
}

/** Die Stätten des Gegenstands aus dem Cache - oder `undefined`; damit zeichnet ein zweiter Aufruf ohne Wartezeile. */
export const cachedStaetten = (ref: SubjectRef): SubjectStaettenSection | undefined =>
    cachedSection<SubjectStaettenSection>("staetten", ref);

/** Holt die Stätten, zuerst aus dem Cache (dieselbe Rezeptur wie jede andere Sektion). */
export const loadStaetten = (
    ref: SubjectRef,
    signal?: AbortSignal,
    fetcher?: typeof fetch,
): Promise<SubjectStaettenSection | null> => loadSection<SubjectStaettenSection>("staetten", ref, signal, fetcher);
