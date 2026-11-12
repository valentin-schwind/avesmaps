import type { SubjectDetailKind, SubjectFact, SubjectFactField, SubjectTextFact } from "./subject.ts";

/**
 * Die gemeinsame ANZEIGEREGEL des Infopanels (WI-0063 27.8, Betreiber 2026-10-04: „aussehn wie legacy“; zu den Feldern, die
 * Avesmaps3D hat und Legacy nicht zeigt: „B aber ich muss später sehen wieviel das ist“; zum Abnahmeblatt: „sonst passt das
 * mockup!“, WI-0063 27.10).
 *
 * Der Server liefert den VOLLEN Bestand und markiert, was Legacys Infobox nicht zeigt (`legacyHidden`). Was das Panel davon
 * zeigt, entscheidet allein diese Datei: `visibleFacts` für die Zeilen, `displayDescription` für den Umfang der Beschreibung.
 * Die Freigabe der Zusatzfelder ist EINE Liste (`PANEL_APPROVED_EXTRAS`), kein Umbau.
 */

/**
 * Die Freigabe für eine Subject-Art: welche verborgenen Felder erscheinen, ob die Wiki-Beschreibung hinter der „…“-Pille ganz zu
 * lesen ist und ob der Kontext über Legacys Anzeige hinausgeht.
 */
export interface PanelApprovedKind {
    /** Felder, deren `legacyHidden`-Fakten das Panel für diese Art zeigt (z. B. `neighbors` bei der Landschaft). */
    readonly fields: readonly SubjectFactField[];
    /**
     * Die Wiki-Beschreibung über den ersten Satz hinaus (nur Ort, Weg, Landschaft und Gipfel werden auf einen Satz gekürzt). Sie steht
     * NIE offen da: Nach dem ersten Satz verbirgt eine „…“-Pille den Rest (Betreiber 2026-10-04: „dann musste du aber mit der (...)
     * Pille nach dem ersten satz den text verbergen, sonst wirds zu viel“).
     */
    readonly fullDescription: boolean;
    /**
     * Der Kontext über Legacy hinaus: jedes Gebiet, dessen Hauptstadt oder Sitz ein Ort ist (Legacy nennt nur eines), die Ebene im
     * Untertitel einer Landschaft, „Liegt in“ bei jeder Art und die übrigen Kontextzeilen (Landschaften, Klima, Flüsse).
     */
    readonly context: boolean;
}

export type PanelApprovedExtras = Readonly<Record<SubjectDetailKind, PanelApprovedKind>>;

const LEGACY_KIND: PanelApprovedKind = { fields: [], fullDescription: false, context: false };

/** Genau Legacys Anzeige, ohne jedes Zusatzfeld: die Grundlage, von der die Freigabe ausgeht. */
export const PANEL_LEGACY_ONLY: PanelApprovedExtras = {
    place: LEGACY_KIND,
    path: LEGACY_KIND,
    area: LEGACY_KIND,
    territory: LEGACY_KIND,
    peak: LEGACY_KIND,
    powerline: LEGACY_KIND,
};

/**
 * Was der Betreiber auf dem Abnahmeblatt „wie Legacy“ gegen „mit allen Zusatzfeldern“ gesehen und freigegeben hat (WI-0063 27.10).
 * Die Felder stehen AUSDRÜCKLICH da, nicht als `SUBJECT_FACT_FIELDS`: Ein später hinzukommendes Feld ist nicht freigegeben, bis es
 * hier steht.
 */
const APPROVED_2026_10_04: PanelApprovedKind = {
    fields: [
        "description",
        "einwohner",
        "oberhaupt",
        "lage",
        "handelszone",
        "verkehrswege",
        "bevoelkerung",
        "tempel",
        "buildingType",
        "art",
        "laenge",
        "verlauf",
        "continent",
        "regionParent",
        "affiliationStaat",
        "sprache",
        "vegetation",
        "synonyms",
        "neighbors",
        "staerke",
        "affinitaet",
        "regionen",
        "status",
        "validity",
        "capital",
        "seat",
    ],
    fullDescription: true,
    context: true,
};

/**
 * Das Gebiet (WI-0063 27.18): Die Freigabe vom 2026-10-04 nennt `continent`, weil Orte und Landschaften es als Zusatzfeld tragen. Am Gebiet
 * ist der Kontinent des Gebietsexports (E4) ein Feld, das Legacys Staatsinfobox nicht zeigt und das auf dem Abnahmeblatt nie stand: Er
 * bleibt verborgen, bis ein Eintrag ihn freigibt. Eine Ausnahme von der Freigabe, keine neue. Die übrigen drei Zusatzfelder des Gebiets
 * (`politisch`, `wappenbeschreibung`, `zugehoerigkeitRoh`) stehen ohnehin in keiner Liste.
 */
const APPROVED_TERRITORY: PanelApprovedKind = {
    ...APPROVED_2026_10_04,
    fields: APPROVED_2026_10_04.fields.filter((field) => field !== "continent"),
};

/** Die Freigabeliste je Subject-Art: das, was jeder Besucher sieht. */
export const PANEL_APPROVED_EXTRAS: PanelApprovedExtras = {
    place: APPROVED_2026_10_04,
    path: APPROVED_2026_10_04,
    area: APPROVED_2026_10_04,
    territory: APPROVED_TERRITORY,
    peak: APPROVED_2026_10_04,
    powerline: APPROVED_2026_10_04,
};

/** Längster erster Satz der Wiki-Beschreibung (Legacy `settlementFirstSentence`); darüber wird gekappt und mit „ …“ geschlossen. */
const FIRST_SENTENCE_MAX_LENGTH = 220;

/** Leerraum zusammengefasst, „ ,“ zu „,“: Die Wiki-Extraktion schleppt Leerzeichen vor Kommas ein („Al'Anfa , die“). */
export function normalizeWikiText(text: string | null | undefined): string {
    return (text ?? "").replace(/\s+/g, " ").trim().replace(/ +,/g, ",");
}

/**
 * Nur der erste Satz einer Wiki-Beschreibung: EXAKTER Port von Legacys `settlementFirstSentence`
 * (`js/map-features/map-features-location-marker-entry.js`, Mirror `b9657635a`).
 * - Leerraum zusammenfassen, „ ,“ zu „,“ (`normalizeWikiText`).
 * - Der erste Satz reicht bis zum ersten `.`, `!` oder `?`, dem Leerraum oder das Ende folgt („3.5 Meilen“ und „...“ zerschneiden nicht).
 * - Sicherheitsnetz gegen Vorlagenreste der Infobox: ab dem ersten `|` oder `}` und ab einem „Feld=“ mit Großbuchstaben wird gekappt.
 * - Mehr als 220 Zeichen werden bei 220 gekappt und mit „ …“ geschlossen.
 * Kein Satzende ist kein Fehler: dann gilt der ganze Text.
 */
export function wikiFirstSentence(text: string | null | undefined): string {
    const value = normalizeWikiText(text);
    if (value === "") return "";
    const match = value.match(/^.*?[.!?](?=\s|$)/u);
    let sentence = (match ? match[0] : value).trim();
    sentence = sentence
        .replace(/\s*[|}].*$/u, "")
        .replace(/\s+[A-ZÄÖÜ][\wäöüß]*\s*=.*$/u, "")
        .trim();
    if (sentence.length > FIRST_SENTENCE_MAX_LENGTH) {
        sentence = `${sentence.slice(0, FIRST_SENTENCE_MAX_LENGTH).trim()} …`;
    }
    return sentence;
}

/**
 * Die Fakten, die das Panel zeigt: alle ohne `legacyHidden` und dazu die verborgenen, deren Feld für diese Art freigegeben ist.
 * Die Reihenfolge bleibt die des Servers. Ein Subject ohne Fakten gibt eine leere Liste.
 */
export function visibleFacts(
    kind: SubjectDetailKind,
    facts: readonly SubjectFact[] | undefined,
    approved: PanelApprovedExtras = PANEL_APPROVED_EXTRAS,
): SubjectFact[] {
    const fields = approved[kind].fields;
    return (facts ?? []).filter((fact) => fact.legacyHidden !== true || fields.includes(fact.field));
}

/** Die Arten, deren WIKI-Beschreibung Legacy auf den ersten Satz kürzt (Ort, Weg, Landschaft; der Gipfel ist dort eine Landschaft). */
const FIRST_SENTENCE_KINDS: ReadonlySet<SubjectDetailKind> = new Set(["place", "path", "area", "peak"]);

/** Die Beschreibung, wie das Panel sie zeigt: der sichtbare Text und, wo freigegeben, der ganze Text hinter der „…“-Pille. */
export interface DisplayedDescription {
    readonly text: string;
    /** Der ganze Text; nur, wenn er über `text` hinausgeht und `fullDescription` für die Art freigegeben ist. */
    readonly full?: string;
}

/**
 * Die Beschreibung, die das Panel zeigt. Bei Ort, Weg, Landschaft und Gipfel mit Wiki-Herkunft ist der sichtbare Text der erste Satz
 * (`wikiFirstSentence`, Legacy); ist `fullDescription` freigegeben, steht der ganze Text hinter der „…“-Pille (`full`). Sonst der
 * volle Text: Kraftlinie (Legacy) und die eigene redaktionelle Beschreibung eines Orts (ohne Nest zeigt Legacy sie ganz). Der sichtbare
 * Text ist leer, wenn vom ersten Satz nichts übrig bleibt (nur Vorlagenreste): dann gibt es keine Zeile.
 */
export function displayDescription(
    kind: SubjectDetailKind,
    fact: SubjectTextFact,
    approved: PanelApprovedExtras = PANEL_APPROVED_EXTRAS,
): DisplayedDescription {
    if (fact.field !== "description" || fact.provenance.kind !== "wiki" || !FIRST_SENTENCE_KINDS.has(kind)) {
        return { text: fact.value };
    }
    const text = wikiFirstSentence(fact.value);
    const full = normalizeWikiText(fact.value);
    return text === "" || !approved[kind].fullDescription || full === text ? { text } : { text, full };
}
