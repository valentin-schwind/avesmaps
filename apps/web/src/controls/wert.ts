import { locale, t } from "../i18n/i18n";

/**
 * Wert und Einheit in Klappboxen (Design Guide §16.3 „Die Zahl wird hervorgehoben, das Wort nicht“, als allgemeine Regel für
 * strukturierte Werte, Betreiber 2026-10-04). Dieses Modul schneidet nur; Farbe und Ziffern setzen `AvmWert` und `AvmText` -
 * EINE Darstellung für jede Klappbox, die Kopfzeile des Deckels eingeschlossen.
 *
 * 🔴 **Die Zahlen formatieren die vorhandenen Formatierer** (`formatNumber`, die Formate der Sprachtafel: „27 %“, „40,1 Std.“,
 * „2.830 Schritt“, englisch „40.1 h“, „2,830 steps“). Hier wird nichts neu formatiert, nur erkannt: Eine Zahl, dahinter eine
 * Einheit aus der geschlossenen Liste, wird ein `Wert`.
 */

/** Ein Wert: die Zahl hervorgehoben, die Einheit gedämpft. Ohne Einheit eine bloße Zahl; ohne Zahl eine bloße Einheit. */
export interface Wert {
    zahl: string;
    einheit: string;
    /** Was zwischen Zahl und Einheit steht: ein Leerzeichen („27 %“), bei Zeichen wie „%“ im Englischen auch nichts. */
    abstand: string;
}

/** Ein Stück Text: gewöhnlicher Text oder ein Wert. */
export type Lauf = string | Wert;

export const wert = (zahl: string, einheit = "", abstand = " "): Wert => ({
    zahl,
    einheit,
    abstand: einheit && zahl ? abstand : "",
});

/** Eine Einheit ohne Zahl davor (die gemeinsame „Schritt“ hinter „2.830 ↑ · 1.600 ↓“). */
export const nurEinheit = (einheit: string): Wert => ({ zahl: "", einheit, abstand: "" });

/** Feste Abkürzungen und Zeichen, die in den Formaten der Sprachtafel eingebacken stehen („+{hours} Std.“, „{grade} %“). */
const FESTE_EINHEITEN = ["%", "Std.", "h"];

/**
 * Die Einheiten der Sprache: aus den Formaten der Sprachtafel gelesen (nie abgeschrieben, damit eine neue Sprache oder ein
 * geändertes Wort dasselbe Muster trägt), dazu die festen Abkürzungen. Länger zuerst: „h/Tag“ vor „h“.
 */
const EINHEIT_FORMATE = [
    "unit.miles",
    "unit.hours",
    "unit.days",
    "planner.options.summary.hoursPerDay",
    "planner.cost.unit.ducat",
    "planner.cost.unit.silver",
    "planner.cost.unit.heller",
    "planner.slope.unit",
] as const;

const gespeichert = new Map<string, RegExp>();

function einheitenMuster(): RegExp {
    const sprache = locale.value;
    const bekannt = gespeichert.get(sprache);
    if (bekannt) return bekannt;
    const einheiten = new Set<string>(FESTE_EINHEITEN);
    for (const schluessel of EINHEIT_FORMATE) {
        // „{n} Stunden“ → „Stunden“; „{n} h/Tag“ → „h/Tag“; eine Einheit ohne Platzhalter („Schritt“) bleibt, wie sie ist.
        const einheit = t(schluessel, { n: "" }).replace("{n}", "").trim();
        if (einheit) einheiten.add(einheit);
    }
    const alternativen = [...einheiten]
        .sort((a, b) => b.length - a.length)
        .map((einheit) => einheit.replace(/[.*+?^${}()|[\]\\/]/g, String.raw`\$&`))
        .join("|");
    // Zahl (mit Vorzeichen „+“, mit Tausender- oder Dezimaltrenner, ohne den Schlusspunkt eines Datums „15.“), dahinter -
    // durch Leerzeichen getrennt oder nicht - eine Einheit, die nicht mitten in einem Wort endet („S“ von „Sachen“ ist keine).
    const muster = new RegExp(String.raw`(\+?\d+(?:[.,]\d+)*)(?:([ \u00a0]?)(${alternativen})(?![\p{L}\d]))?`, "gu");
    gespeichert.set(sprache, muster);
    return muster;
}

/**
 * Schneidet einen fertig formatierten Text in Läufe: Jede Zahl wird ein `Wert`, mit ihrer Einheit, wo eine folgt. Eine Zahl
 * mitten in einem Wort („DSA5“, „S1“) bleibt Text. Setzt man die Läufe wieder zusammen, kommt der Text unverändert heraus.
 */
export function laeufe(text: string): Lauf[] {
    const ergebnis: Lauf[] = [];
    const muster = einheitenMuster();
    muster.lastIndex = 0;
    let ende = 0;
    for (const treffer of text.matchAll(muster)) {
        const anfang = treffer.index;
        const davor = text[anfang - 1];
        // Mitten in einem Wort: kein Wert.
        if (davor !== undefined && /[\p{L}\d]/u.test(davor)) continue;
        if (anfang > ende) ergebnis.push(text.slice(ende, anfang));
        ergebnis.push({
            zahl: treffer[1] ?? "",
            einheit: treffer[3] ?? "",
            abstand: treffer[3] ? (treffer[2] ?? "") : "",
        });
        ende = anfang + treffer[0].length;
    }
    if (ende < text.length) ergebnis.push(text.slice(ende));
    return ergebnis;
}

/** Der Text eines Laufs, wie er gesetzt wird: Zahl, Abstand, Einheit. */
export const laufText = (lauf: Lauf): string =>
    typeof lauf === "string" ? lauf : `${lauf.zahl}${lauf.abstand}${lauf.einheit}`;
