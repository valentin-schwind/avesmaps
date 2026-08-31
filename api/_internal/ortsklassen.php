<?php

declare(strict_types=1);

/**
 * Die Ortsklassen -- und die eine Frage, die `gebaeude` bis zum 31.08.2026 nebenbei mitbeantwortet
 * hat.
 *
 * 💣 `gebaeude` WAR KLASSE UND MERKMAL IN EINEM. Solange es genau eine Bauwerksklasse gab, konnte
 * `settlement_class = 'gebaeude'` zweierlei heissen, ohne dass es auffiel: „diese Ortsklasse" und
 * „ein Bauwerk, kein Behaelter". An SIEBEN Stellen stand der Vergleich fuer das Zweite --
 * in-settlement-search.php, offmap-search.php (zweimal), place-scope.php, die zwei Marker-Zeichner
 * und die zwei Editorlisten. Mit `stadtviertel` (Owner 30.08.2026, Garetien-Import: 22 Objekte,
 * „wie Gebaeude, aber innerorts") gibt es zwei Bauwerksklassen -- und jede dieser Stellen haette
 * das Viertel STILL als Siedlung und Behaelter gefuehrt, also in die genau umgekehrte Richtung.
 *
 * 🔴 Deshalb hat das Merkmal jetzt einen eigenen Namen. Ein Vergleich auf EINEN Wert ist kein
 * Merkmal; das hat dieses Projekt bei der Verkehrsmittel-Sperre und bei der Ausstiegsregel schon
 * zweimal bezahlt (AGENTS.md §11).
 *
 * 🔴 EIN STADTVIERTEL IST KEIN BEHAELTER (Owner 31.08.2026). Es liegt innerorts wie ein Gebaeude,
 * aber es enthaelt nichts: `avesmapsIstBauwerksklasse` beantwortet damit weiterhin GENAU EINE
 * Frage, und die Behaelterliste in place-scope.php bleibt die Gegenmenge. Wuerde ein Viertel je
 * beides sein, waeren es ZWEI Merkmale („liegt innerorts" / „kann etwas enthalten") -- dann ist
 * diese Datei die Stelle, an der das zweite entsteht, nicht ein `|| 'stadtviertel'` an sieben.
 *
 * ⚠️ Diese Datei ist REIN: Konstanten und Funktionen, nichts laeuft beim Einbinden. Sie kennt
 * weder PDO noch DOM und darf von jeder Schicht eingebunden werden.
 */

/**
 * Alle Ortsklassen, in der Reihenfolge gross -> klein. Der stabile Slug, nie die Beschriftung
 * (AGENTS.md §2/§8).
 *
 * ⚠️ Sie ist hier die BENENNUNG, nicht die einzige Kopie: dieselbe Liste steht als
 * `AVESMAPS_LOCATION_SUBTYPES` in api/_internal/map/features.php und api/edit/map/features.php,
 * zweimal in api/_internal/wiki/settlements.php und einmal in api/app/report-location.php --
 * fuenf Kopien, die es vor dieser Datei schon gab. Sie zusammenzulegen ist ein eigener Umbau
 * (jede haengt an einem anderen Einbindungspfad); gegen das Auseinanderlaufen steht seit dem
 * 31.08.2026 ortsklassen-test.php, das alle sechs gegeneinander haelt.
 */
const AVESMAPS_ORTSKLASSEN = ['metropole', 'grossstadt', 'stadt', 'kleinstadt', 'dorf', 'gebaeude', 'stadtviertel'];

/**
 * Die Ortsklassen, die ein BAUWERK bezeichnen und keine Siedlung: sie liegen innerorts, sie sind
 * kein Behaelter, und sie werden als Raute statt als Kreis gezeichnet.
 */
const AVESMAPS_BAUWERKSKLASSEN = ['gebaeude', 'stadtviertel'];

/**
 * Ist diese Ortsklasse ein Bauwerk (und damit keine Siedlung)?
 *
 * @param string|null $klasse der gespeicherte Slug (map_features.feature_subtype bzw.
 *                            wiki_sync_pages.settlement_class); null/leer ist NEIN.
 */
function avesmapsIstBauwerksklasse(?string $klasse): bool
{
    return in_array(trim((string) $klasse), AVESMAPS_BAUWERKSKLASSEN, true);
}

/**
 * Die SQL-Bedingung „diese Spalte nennt eine Bauwerksklasse" -- bzw. mit $negiert ihr Gegenteil.
 *
 * 💣 Sie ersetzt ein `= 'gebaeude'` bzw. `<> 'gebaeude'`, und genau deshalb gibt es sie: eine
 * zweite Bauwerksklasse macht aus dem Gleichheitszeichen ein `IN`, und wer das an einer der drei
 * Stellen vergisst, bekommt keinen Fehler, sondern eine Zeile weniger in einer Suche.
 *
 * ⚠️ Die Werte sind KONSTANTEN dieser Datei, nie Eingaben -- deshalb ist das Einsetzen in den
 * Abfragetext hier zulaessig (dasselbe Muster wie avesmapsFeatureSourceLiveEntityClause).
 * ⚠️ NULL: `NOT IN` liefert fuer NULL kein TRUE. Die einzige Aufrufstelle mit $negiert prueft
 * `IS NOT NULL` davor; wer eine zweite baut, muss dasselbe tun.
 *
 * @param string $spalte Spaltenname (ggf. mit Alias), aus dem Code, nie aus einer Anfrage
 */
function avesmapsBauwerksklassenSql(string $spalte, bool $negiert = false): string
{
    $liste = "'" . implode("', '", AVESMAPS_BAUWERKSKLASSEN) . "'";

    return $spalte . ($negiert ? ' NOT IN (' : ' IN (') . $liste . ')';
}
