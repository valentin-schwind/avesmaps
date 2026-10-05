<?php

declare(strict_types=1);

// Wikilinks eines Feldwerts als GEORDNETE Liste {anzeige, ziel} -- rein, ohne Datenbank, ohne Schreibwirkung.
//
// Hier steht die EINE Regex, die „[[Ziel]]", „[[Ziel|Anzeige]]" und „[[Ziel#Abschnitt|Anzeige]]" zerlegt.
// Sie wohnte bis zum 05.10.2026 in `avesmapsWikiSettlementLinkTargets` (settlements.php); der Export der
// Linkziele (api/app/wiki-linkziele-export.php, Auftrag Avesmaps3D) braucht dieselbe Zerlegung, aber in einer
// Form, die nichts verliert -- und eine zweite Abschrift der Regex waere genau die zweite Wahrheit, die
// AGENTS.md §5 verbietet. `avesmapsWikiSettlementLinkTargets` ruft seither diese Funktion und baut daraus
// seine alte Tafel; ihr Verhalten ist unveraendert (Test: link-ziele-test.php haelt beide gegeneinander).
//
// 💣 WARUM EINE LISTE UND KEINE TAFEL „Anzeige => Ziel":
//   - Ein PHP-Schluessel „2" ist ein INTEGER (aus „[[Reichsstrasse 2|2]]" wird `[2 => 'Reichsstrasse 2']`);
//     wer ihn als Zeichenkette erwartet, fuehrt `strict_types` in die Irre.
//   - Zwei Links mit DERSELBEN Anzeige und verschiedenem Ziel („[[A|x]] … [[B|x]]") sind in der Tafel EIN
//     Eintrag -- der zweite Link verschwindet lautlos. Die Liste behaelt jeden.
//   - Die Reihenfolge des Quelltexts ist eine Aussage (Verlauf einer Strasse), die Tafel kennt sie nur
//     zufaellig.
//
// ⚠️ Dem Wikitext wird NICHTS hinzugedacht: eine Vorlage wie {{Pol|Baronie Raulsmark}} ist KEIN Link im Sinn
// dieser Funktion, auch wenn das Wiki sie als einen darstellt -- ob und wohin sie verweist, steht nicht im
// Quelltext, sondern in der Vorlage. Das Wiki wird hier nie gefragt.

/**
 * Alle Wikilinks eines Feldwerts, in der Reihenfolge des Quelltexts, jeden einzeln, MIT der Byte-Position des Links im
 * Feldwert (`pos`). Die Position braucht, wer Wikilinks mit anderen Fundstellen desselben Werts in Quelltext-Reihenfolge
 * mischt (api/_internal/app/wiki-linkziele-export.php: {{Pol|…}} neben [[…]]).
 *
 * @return list<array{anzeige:string, ziel:string, pos:int}>
 */
function avesmapsWikiLinkZielePaareMitPosition(string $rawValue): array
{
    if (trim($rawValue) === '' || !str_contains($rawValue, '[[')) {
        return [];
    }
    if (preg_match_all('/\[\[\s*([^\]\|#<>\[]+?)\s*(?:#[^\]\|]*)?(?:\|([^\]]*))?\]\]/u', $rawValue, $matches, PREG_SET_ORDER | PREG_OFFSET_CAPTURE) < 1) {
        return [];
    }

    $paare = [];
    foreach ($matches as $match) {
        $ziel = trim((string) ($match[1][0] ?? ''));
        $anzeige = trim((string) ($match[2][0] ?? '')); // leer bei [[Name]]
        if ($ziel === '') {
            continue;
        }
        $paare[] = ['anzeige' => $anzeige !== '' ? $anzeige : $ziel, 'ziel' => $ziel, 'pos' => (int) $match[0][1]];
    }

    return $paare;
}

/**
 * Alle Wikilinks eines Feldwerts, in der Reihenfolge des Quelltexts, jeden einzeln.
 *
 * `anzeige` ist der Text nach dem Pipe, bei „[[Ziel]]" das Ziel selbst. `ziel` ist der Seitentitel ohne
 * „#Abschnitt". Ein Link mit leerem Ziel wird ausgelassen.
 *
 * @return list<array{anzeige:string, ziel:string}>
 */
function avesmapsWikiLinkZielePaare(string $rawValue): array
{
    return array_map(
        static fn(array $paar): array => ['anzeige' => $paar['anzeige'], 'ziel' => $paar['ziel']],
        avesmapsWikiLinkZielePaareMitPosition($rawValue)
    );
}
