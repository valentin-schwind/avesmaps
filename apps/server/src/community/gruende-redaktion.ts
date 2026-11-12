import type { DatenbankGrund } from "./gruende.ts";

/**
 * Die Fachcodes zu den Sätzen der Datenbankfunktionen, die Redaktionsfenster erreichen (Vorgang, Mails, Neue Mail, Verknüpfen, Bewertungen der Redaktion; WI-0291, `gruende.ts`).
 *
 * Stand der Sätze je Funktion (die LETZTE Migration, die sie definiert):
 * - Vorgänge (0265): `_pruefe`, `community_rueckfrage`, `_abschliessen`, `_wiedereroeffnen`, `_uebernehmen`, `_archivieren`, `_papierkorb`, `_wiederherstellen`, `_sichten`.
 * - Anfragen (0271): `_nur_anfrage`, `community_anfrage_antworten`, `_archivieren`, `_zurueckholen`, `community_als_meldung`.
 * - Mailweg (0279): `community_anfrage_antworten_mail`, `community_mail_neu`, `community_mail_erneut`.
 * - Verknüpfen (0273): `community_verknuepfen`.
 * - Bewertungen der Redaktion (0266): `_bewertung_pruefe`, `bewertung_sichten`, `_freigeben`, `_verbergen`, `_einblenden`, `_inhalt_loeschen`.
 *
 * Sätze, die in einer Funktion der Besucher genauso lauten, haben dort EINEN Code (`gruende-besucher.ts`) und stehen hier nicht noch einmal: „der Vorgang ist schon abgeschlossen“
 * (`vorgang_abgeschlossen`), „bitte einen Grund wählen“ (`grund_fehlt`), „diese Bewertung gibt es nicht“ (`bewertung_unbekannt`), „die Adresse stimmt nicht“ (`adresse_falsch`),
 * „unbekannte Kategorie“ (`kategorie_unbekannt`), „die Beschreibung braucht 10 bis 2000 Zeichen“ (`beschreibung_laenge`). Die Fenster der Redaktion bilden diese Codes mit ab.
 * Der Satz „COM-000123“ (KC404, der Vorgang oder die Dublette fehlt) hat keinen Code: Die Route sagt, welcher gemeint ist (`dubletteFehlt`). Die Sätze der Legacy-Übernahme (0277) erreicht kein Fenster.
 */
export const GRUENDE_REDAKTION: readonly DatenbankGrund[] = [
    // Wer gleichzeitig arbeitet: Der Stand ist inzwischen ein anderer (409 `community_conflict`)
    { muster: /^der Vorgang hat sich inzwischen geändert$/u, reason: "vorgang_geaendert" },
    { muster: /^die Bewertung hat sich inzwischen geändert$/u, reason: "bewertung_geaendert" },
    // Übernehmen, Rückfrage, Abschließen, Wiedereröffnen
    { muster: /^ein abgeschlossener Vorgang wird erst wieder geöffnet$/u, reason: "erst_wieder_oeffnen" },
    { muster: /^kein Rückweg zum Melder$/u, reason: "kein_rueckweg" },
    { muster: /^dieses Ergebnis setzt man hier nicht beim Abschließen$/u, reason: "ergebnis_unzulaessig" },
    { muster: /^die Begründung ist Pflicht$/u, reason: "begruendung_fehlt" },
    { muster: /^eine Dublette nennt den Vorgang, von dem sie eine ist$/u, reason: "dublette_angabe" },
    { muster: /^nur ein abgeschlossener Vorgang wird wieder geöffnet$/u, reason: "nicht_abgeschlossen" },
    { muster: /^der Grund ist Pflicht$/u, reason: "oeffnen_grund_fehlt" },
    // Archiv, Papierkorb, Sichten
    { muster: /^ins Archiv geht nur ein abgeschlossener Vorgang$/u, reason: "archiv_nur_abgeschlossen" },
    { muster: /^der Vorgang liegt schon im Papierkorb$/u, reason: "schon_im_papierkorb" },
    { muster: /^nur aus dem Papierkorb wird wiederhergestellt$/u, reason: "nicht_im_papierkorb" },
    { muster: /^nur ein neuer Vorgang wird gesichtet$/u, reason: "nur_neue_sichten" },
    // Anfragen: archivieren, zurückholen, antworten, als Meldung weiterführen
    { muster: /^das gilt nur für Anfragen$/u, reason: "nur_anfragen" },
    { muster: /^die Anfrage liegt schon im Archiv oder im Papierkorb$/u, reason: "schon_im_archiv" },
    { muster: /^nur eine abgeschlossene Anfrage wird in den Eingang zurückgeholt$/u, reason: "nicht_im_archiv" },
    { muster: /^zum Antworten erst zurück in den Eingang holen$/u, reason: "erst_in_den_eingang" },
    { muster: /^die Antwort braucht 1 bis 4000 Zeichen$/u, reason: "antwort_laenge" },
    { muster: /^keine Adresse zum Antworten per Mail$/u, reason: "keine_adresse" },
    { muster: /^eine Anfrage im Papierkorb wird nicht gesendet$/u, reason: "anfrage_im_papierkorb" },
    { muster: /^eine Anfrage im Papierkorb wird nicht weitergeführt$/u, reason: "anfrage_im_papierkorb" },
    { muster: /^die Antwort darf höchstens 4000 Zeichen lang sein$/u, reason: "weiter_antwort_zu_lang" },
    { muster: /^der Bezug ist Pflicht$/u, reason: "bezug_fehlt" },
    { muster: /^diese Mail gibt es nicht$/u, reason: "mail_unbekannt" },
    // Neue Mail
    { muster: /^die schreibende Person fehlt$/u, reason: "person_fehlt" },
    { muster: /^der Betreff braucht 1 bis 150 Zeichen in einer Zeile$/u, reason: "betreff_ungueltig" },
    { muster: /^die Nachricht braucht 1 bis 4000 Zeichen$/u, reason: "neue_mail_text_laenge" },
    { muster: /^die Tagesgrenze für neue Mails ist erreicht$/u, reason: "mail_tagesgrenze" },
    // Korrektur und Kanal verknüpfen
    { muster: /^eine Korrektur nennt die Kennung einer Operation$/u, reason: "korrektur_kennung" },
    { muster: /^diese Operation gibt es nicht$/u, reason: "operation_unbekannt" },
    { muster: /^ein Kanal-Vorgang heißt OPS- mit sechs Ziffern$/u, reason: "kanal_nummer" },
    { muster: /^von Hand verknüpft man nur Korrektur und Kanal$/u, reason: "verknuepfung_art" },
    // Bewertungen der Redaktion
    { muster: /^nur eine neue Bewertung wird gesichtet$/u, reason: "bewertung_nur_neue" },
    { muster: /^nur eine zurückgehaltene Bewertung wird freigegeben$/u, reason: "bewertung_nicht_zurueckgehalten" },
    { muster: /^die Bewertung ist schon verborgen$/u, reason: "bewertung_schon_verborgen" },
    { muster: /^nur eine verborgene Bewertung mit Inhalt wird eingeblendet$/u, reason: "bewertung_nicht_verborgen" },
    { muster: /^nur der Inhalt einer verborgenen Bewertung wird gelöscht$/u, reason: "bewertung_inhalt_nur_verborgen" },
];
