import type { DatenbankGrund } from "./gruende.ts";

/**
 * Die Fachcodes zu den Sätzen der Datenbankfunktionen, die Besucherfenster (Kontakt, Meldung, Statusseite, Bewertungen) erreichen (WI-0291, `gruende.ts`).
 *
 * Stand der Sätze je Funktion (die LETZTE Migration, die sie definiert):
 * - `community_anfragen` 0309, `community_melden` 0311, `community_status_antworten` und `community_status_zurueckziehen` 0265,
 * - `bewertung_schreiben`, `bewertung_gefaellt` und `bewertung_melden` 0266.
 * Ein Satz, der in zwei Funktionen gleich lautet (etwa „der Schlüssel ist Pflicht“, „bitte einen Grund wählen“), hat EINEN Code; die Redaktion bekommt ihn mit, wenn sie denselben Satz erreicht.
 * Die Sätze der Discord-Funktionen (0283) erreicht kein Besucherfenster, sondern nur der Rücksprung von Discord; sie bleiben ohne Code.
 */
export const GRUENDE_BESUCHER: readonly DatenbankGrund[] = [
    // community_melden (0311) und community_anfragen (0309)
    { muster: /^die Beschreibung braucht 10 bis 2000 Zeichen$/u, reason: "beschreibung_laenge" },
    { muster: /^die Nachricht braucht 10 bis 2000 Zeichen$/u, reason: "nachricht_laenge" },
    { muster: /^Schlüssel und Bezug sind Pflicht$/u, reason: "schluessel_bezug_fehlt" },
    { muster: /^der Schlüssel ist Pflicht$/u, reason: "schluessel_fehlt" },
    { muster: /^unbekannte Kategorie$/u, reason: "kategorie_unbekannt" },
    { muster: /^der Name darf höchstens 80 Zeichen lang sein$/u, reason: "name_zu_lang" },
    { muster: /^die Adresse stimmt nicht$/u, reason: "adresse_falsch" },
    // Statusseite: Antworten und Zurückziehen (0265)
    { muster: /^die Meldung ist zurückgezogen$/u, reason: "meldung_zurueckgezogen" },
    { muster: /^der Vorgang ist schon abgeschlossen$/u, reason: "vorgang_abgeschlossen" },
    { muster: /^kein Vorgang zu diesem Schlüssel$/u, reason: "vorgang_unbekannt" },
    // Bewertungen: schreiben, „Gefällt mir“, melden (0266)
    { muster: /^die Wertung braucht 1 bis 5 Sterne$/u, reason: "sterne" },
    { muster: /^der Text darf höchstens 200 Zeichen haben$/u, reason: "text_zu_lang" },
    { muster: /^der Name darf höchstens 80 Zeichen haben$/u, reason: "name_zu_lang" },
    { muster: /^das Datum darf höchstens 60 Zeichen haben$/u, reason: "datum_zu_lang" },
    { muster: /^diesen Ort gibt es nicht$/u, reason: "ort_unbekannt" },
    { muster: /^diese Bewertung gibt es nicht$/u, reason: "bewertung_unbekannt" },
    { muster: /^Gefällt mir zählt um eins hoch oder runter$/u, reason: "gefaellt_schritt" },
    { muster: /^bitte einen Grund wählen$/u, reason: "grund_fehlt" },
    { muster: /^die Beschreibung darf höchstens 2000 Zeichen haben$/u, reason: "beschreibung_zu_lang" },
];
