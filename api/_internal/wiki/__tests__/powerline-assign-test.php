<?php

declare(strict_types=1);

/**
 * Der MASSENLAUF der Kraftlinien-Wikizuweisung -- die reine Entscheidung.
 * Lauf (aus dem Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       api/_internal/wiki/__tests__/powerline-assign-test.php
 * Exit 0 = alle Zusicherungen gehalten.
 *
 * 🔴 DIESER TEST IST DIE ABNAHMELISTE, und ihr wichtigster Fall ist ein NICHT geschriebener:
 * „Hexenband(-schleife)" darf den Artikel nicht bekommen, den „Hexenband" bereits haelt. Ohne
 * diesen Riegel legte der Lauf zwei Kartenobjekte auf EINEN Artikel -- und genau das meldet das
 * Konfliktzentrum als Fall (avesmapsConflictFindSharedWikiUrls). Der Lauf erzeugte damit die
 * Arbeit, die er abnehmen soll.
 *
 * ⚠️ NUR DIE REINE ENTSCHEIDUNG. avesmapsWikiPowerlineAssignAll selbst ist an MySQL gebunden
 * (avesmapsNextMapRevision nutzt `ON DUPLICATE KEY UPDATE`, das SQLite nicht kennt) -- eine
 * Fixture dafuer muesste die Produktionsform verbiegen, und das ist die Falle aus AGENTS.md §9
 * („ein SQLite-Test kann eine MySQL-Regression ERZWINGEN"). Geprueft wird deshalb die Schicht, in
 * der die Regeln WIRKLICH stehen, plus die Verdrahtung im Endpunkt per Quelltextprobe.
 *
 * ⚠️ HERKUNFT DER FIXTURE: die 62 Namensgruppen mit ihren Segmentzahlen, die zwei Zuweisungen und
 * die zwei Merker sind am 18.08.2026 aus EINEM Abruf der oeffentlichen Kartennutzlast gezogen
 * (GET /api/app/map-features.php) -- oeffentliche Kartendaten, keine Betriebsdaten. Ebenso die 18
 * Katalogartikel: sie stehen als `wiki_powerline`-Nest auf den Segmenten und sind damit das, was
 * der letzte Abgleich gefunden hat.
 * 🪤 DER KATALOG DIESER FIXTURE IST UNVOLLSTAENDIG, UND DAS STEHT HIER, DAMIT NIEMAND DIE ZAHLEN
 * ALS PROJEKTZAHLEN ABSCHREIBT: der echte traegt 23 Artikel, ohne angemeldete Sitzung waren 18
 * messbar. Die 16 unten gehoeren der FIXTURE. Die 19. Zeile (siehe KATALOG_MIT_KOLLISION) ist
 * NICHT gemessen -- sie stellt die gemeldete Kollision her, gegen die der Riegel gebaut ist.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}
if (!function_exists('mb_strtolower')) {
    fwrite(STDERR, "FATAL: mbstring fehlt -- mit -d extension=php_mbstring.dll starten.\n");
    exit(2);
}

// Die Laufzeit-Abhaengigkeiten, die sonst der Endpunkt laedt (api/edit/map/powerlines.php).
require_once __DIR__ . '/../sync.php';              // avesmapsWikiSyncCreateMatchKey
require_once __DIR__ . '/../../conflicts/core.php'; // avesmapsConflictArticleKey
require_once __DIR__ . '/../../map/features.php';   // avesmapsAssertPowerlineWikiClaimNotContradictory
require_once __DIR__ . '/../powerline-assign.php';

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Die Wirklichkeit, gemessen 18.08.2026: [Name, Segmente, Zuweisung, Merker "kein Artikel"]
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const LINIEN = [
    ['Akrabaal - Kreuzung', 1, '', false],
    ['Aldyra - Kuslik', 1, '', false],
    ['Altoum-Linie', 2, '', false],
    ['Arteria Magica', 2, '', false],
    ['Astralrisslinie', 1, '', false],
    ['Atem der Äonen', 2, '', false],
    ['Bann der Tiefe', 2, '', false],
    ['Bann-Linie', 1, '', false],
    ['Basiliuslinie', 16, '', false],
    ['Brig-Lo - Oberfels', 1, '', false],
    ['Brücke nach Akrabaal', 2, '', false],
    ['Bymazars Spiegelpfad', 2, '', false],
    ['Chalwens Griff', 3, '', false],
    ['Drachenblick', 4, '', true],
    ['Elementares Hexagramm', 6, 'https://de.wiki-aventurica.de/wiki/Elementares_Hexagramm', false],
    ['Elementarlinie', 2, '', false],
    ['Fächer der Macht', 12, '', false],
    ['Feenflügel', 2, '', false],
    ['Gareth - Reichsabtei St. Praiodan', 1, '', false],
    ['Greifenfurt - Reichsabtei St. Praiodan', 1, '', false],
    ['Heilige Quellen zu Ilsur - Warunk', 1, '', false],
    ['Hexenband', 6, 'https://de.wiki-aventurica.de/wiki/Hexenband', false],
    ['Hexenband(-schleife)', 4, '', false],
    ['Hursachquelle', 1, '', true],
    ['Kette der Zyklopen', 1, '', false],
    ['Khezzara - Arras de Mott', 1, '', false],
    ['Klirrfrostsaite (Zwölfseitige Götterharfe)', 2, '', false],
    ['Knochenpfad', 1, '', false],
    ['Konzilslinie', 6, '', false],
    ['Kreuzung - Akrabaal', 1, '', false],
    ['Kreuzung - Despiona', 1, '', false],
    ['Kreuzung - Heilige Quellen zu Ilsur', 1, '', false],
    ['Kreuzung - Kreuzung', 3, '', false],
    ['Kreuzung - Olat', 1, '', false],
    ['Kreuzung - Warunk', 1, '', false],
    ['Leidensband', 4, '', false],
    ['Lichtfinderlinie', 1, '', false],
    ['Madas Kelch', 3, '', false],
    ['Maraskanstachel', 5, '', false],
    ['Mittellandlinie', 1, '', false],
    ['Nelkra-Linie', 1, '', false],
    ['Neunaugensee-Ader I', 1, '', false],
    ['Pfade des Lichts', 1, '', false],
    ['Punin - Then', 1, '', false],
    ['Runenpfad der Hjaldinger', 1, '', false],
    ['Satinavs Kette I', 6, '', false],
    ['Satinavs Kette II', 6, '', false],
    ['Schlüssellinie des Eises', 1, '', false],
    ['Septima', 3, '', false],
    ['Strick des Schwarzen Mannes', 7, '', false],
    ['Szepter der Macht', 3, '', false],
    ['Temporalline der Sündenpfühle', 4, '', false],
    ['Thalusische Liniea', 2, '', false],
    ['Tobrische Linie I', 2, '', false],
    ['Tobrische Linie II', 1, '', false],
    ['Torweg', 1, '', false],
    ['Unsichtbarer Turm - Punin', 1, '', false],
    ['Vayafendur - Zitadelle des Eises', 1, '', false],
    ['Wandelband', 2, '', false],
    ['Wasserscheide', 3, '', false],
    ['Weg des Diskus', 1, '', false],
    ['Yaquirlinie', 7, '', false],
];

/** Die 18 Artikel, die als Nest auf den Segmenten stehen: [Infobox-Name, Seitenadresse]. */
const KATALOG = [
    ['Arteria Magica', 'https://de.wiki-aventurica.de/wiki/Arteria_Magica'],
    ['Bann-Linie', 'https://de.wiki-aventurica.de/wiki/Bann-Linie'],
    ['Basiliuslinie', 'https://de.wiki-aventurica.de/wiki/Basiliuslinie'],
    ['Elementares Hexagramm', 'https://de.wiki-aventurica.de/wiki/Elementares_Hexagramm'],
    ['Fächer der Macht', 'https://de.wiki-aventurica.de/wiki/F%C3%A4cher_der_Macht'],
    ['Hexenband', 'https://de.wiki-aventurica.de/wiki/Hexenband'],
    ['Kette der Zyklopen', 'https://de.wiki-aventurica.de/wiki/Kette_der_Zyklopen'],
    ['Konzilslinie', 'https://de.wiki-aventurica.de/wiki/Konzilslinie'],
    ['Madas Kelch', 'https://de.wiki-aventurica.de/wiki/Madas_Kelch'],
    // 🪤 Name und Seitentitel sind hier VERSCHIEDEN -- der Artikel heisst „Elementare
    // Schlüssellinien", seine Infobox nennt die Linie „Schlüssellinie des Eises". Der Abgleich
    // laeuft ueber den NAMEN, die Zuweisung schreibt die ADRESSE. Wer beides gleichsetzt, faellt
    // genau hier um.
    ['Schlüssellinie des Eises', 'https://de.wiki-aventurica.de/wiki/Elementare_Schl%C3%BCssellinien'],
    ['Septima', 'https://de.wiki-aventurica.de/wiki/Septima'],
    ['Strick des Schwarzen Mannes', 'https://de.wiki-aventurica.de/wiki/Strick_des_Schwarzen_Mannes'],
    ['Szepter der Macht', 'https://de.wiki-aventurica.de/wiki/Szepter_der_Macht_%28Kraftlinie%29'],
    ['Torweg', 'https://de.wiki-aventurica.de/wiki/Torweg'],
    ['Wandelband', 'https://de.wiki-aventurica.de/wiki/Wandelband'],
    ['Wasserscheide', 'https://de.wiki-aventurica.de/wiki/Wasserscheide'],
    ['Weg des Diskus', 'https://de.wiki-aventurica.de/wiki/Weg_des_Diskus'],
    ['Yaquirlinie', 'https://de.wiki-aventurica.de/wiki/Yaquirlinie'],
];

/** Baut die Segmentzeilen, wie sie der Endpunkt aus map_features liest. */
function fixtureSegmente(array $linien): array
{
    $rows = [];
    $id = 0;
    foreach ($linien as [$name, $segmente, $wikiUrl, $merker]) {
        for ($i = 0; $i < $segmente; $i++) {
            $properties = ['name' => $name, 'feature_type' => 'powerline'];
            if ($wikiUrl !== '') {
                $properties['wiki_url'] = $wikiUrl;
            }
            if ($merker) {
                $properties['wiki_no_article'] = true;
            }
            $rows[] = ['id' => ++$id, 'name' => $name, 'properties' => $properties];
        }
    }

    return $rows;
}

/** Baut den Katalog in der Form, die avesmapsWikiPowerlineDesiredNestsByMatchKey liefert. */
function fixtureKatalog(array $artikel): array
{
    $staged = [];
    foreach ($artikel as [$name, $url]) {
        $staged[avesmapsWikiSyncCreateMatchKey($name)] = [
            'name' => $name,
            'nest' => ['wiki_url' => $url, 'name' => $name],
        ];
    }

    return $staged;
}

$segmente = fixtureSegmente(LINIEN);
$staged = fixtureKatalog(KATALOG);
assert(count($segmente) === 165, 'Die Fixture muss 165 Segmente tragen, gemessen sind es ' . count($segmente));
assert(count($staged) === 18, 'Die 18 Katalogartikel duerfen sich nicht ueber den Match-Key entdoppeln');

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 1. Der gemessene Bestand: 16 Linien / 69 Segmente wuerden geschrieben
// ═══════════════════════════════════════════════════════════════════════════════════════════════
$ergebnis = avesmapsWikiPowerlineDecideAssignAll($segmente, $staged);

assert($ergebnis['total_lines'] === 62,
    'Die Namensgruppen sind 62 (gemessen 18.08.2026), gezaehlt wurden ' . $ergebnis['total_lines']);
assert($ergebnis['lines_affected'] === 16,
    'Am gemessenen Bestand sind 16 Kraftlinien wortgleich und noch unzugewiesen, gerechnet wurden '
    . $ergebnis['lines_affected']);
assert($ergebnis['segments_affected'] === 69,
    '💣 Die Zuweisung gehoert ALLEN Segmenten der Namensgruppe -- die 16 Linien tragen 69 Segmente, '
    . 'geschrieben wuerden ' . $ergebnis['segments_affected'] . '. Eine Zahl nahe 16 heisst: es wird '
    . 'nur EIN Segment je Linie geschrieben, und die Karte zeigte die Zuweisung dann nur stellenweise.');
assert($ergebnis['articles_linked'] === 16,
    '16 Linien auf 16 verschiedene Artikel, gerechnet ' . $ergebnis['articles_linked']);
assert($ergebnis['skipped']['already_assigned'] === 2,
    '„Elementares Hexagramm" und „Hexenband" tragen bereits eine Zuweisung und bleiben unberuehrt; '
    . 'uebersprungen wurden ' . $ergebnis['skipped']['already_assigned']);
assert($ergebnis['skipped']['no_match'] === 44,
    '62 - 16 - 2 = 44 Linien haben keinen wortgleichen Artikel, gezaehlt ' . $ergebnis['skipped']['no_match']);
assert($ergebnis['taken'] === [],
    'Ohne die Kollisionszeile im Katalog darf kein Artikel als vergeben gemeldet werden');

$geschrieben = [];
foreach ($ergebnis['writes'] as $write) {
    $geschrieben[$write['line']] = $write['wiki_url'];
}
assert(!isset($geschrieben['Elementares Hexagramm']) && !isset($geschrieben['Hexenband']),
    '🔴 Der Lauf ERGAENZT nur -- eine vorhandene Zuweisung wird nie ueberschrieben');
assert(($geschrieben['Schlüssellinie des Eises'] ?? '') === 'https://de.wiki-aventurica.de/wiki/Elementare_Schl%C3%BCssellinien',
    '💣 Geschrieben wird die ADRESSE des Artikels, nicht eine aus dem Linien-Namen gebaute: die '
    . 'Linie heisst „Schlüssellinie des Eises", ihr Artikel „Elementare Schlüssellinien". '
    . 'Geschrieben wurde: ' . ($geschrieben['Schlüssellinie des Eises'] ?? '(nichts)'));
assert(!isset($geschrieben['Hursachquelle']) && !isset($geschrieben['Drachenblick']),
    'Die zwei Linien mit dem Merker „kein Wiki-Artikel" duerfen nie eine Zuweisung bekommen');
assert(!isset($geschrieben['Brücke nach Akrabaal']) && !isset($geschrieben['Satinavs Kette I']),
    '🔴 NUR WORTGLEICH. „Brücke nach Akrabaal" (Artikel: „Brücke von Akrabaal") und „Satinavs Kette I" '
    . '(Artikel: „Satinavs Ketten") sind AEHNLICHE Treffer -- ein Massenlauf, der raet, schreibt echte '
    . 'Daten nach einer Vermutung.');

echo "1. gemessener Bestand: 16 Linien / 69 Segmente ok\n";

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 2. DER RIEGEL: ein Artikel, den schon eine Linie haelt, wird uebersprungen -- Fall „Hexenband"
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// 💣 Die 19. Zeile stellt die gemeldete Kollision her: ein Katalogeintrag, dessen NAME wortgleich
// zur Linie „Hexenband(-schleife)" passt, dessen ADRESSE aber die ist, die „Hexenband" bereits
// haelt. Genau so entsteht „zwei Kartenobjekte auf einem Artikel" -- der Fall, den das
// Konfliktzentrum meldet und den dieser Lauf nicht selbst erzeugen darf.
$katalogMitKollision = array_merge(KATALOG, [
    ['Hexenband(-schleife)', 'https://de.wiki-aventurica.de/wiki/Hexenband'],
]);
$mitKollision = avesmapsWikiPowerlineDecideAssignAll($segmente, fixtureKatalog($katalogMitKollision));

assert($mitKollision['lines_affected'] === 16,
    '💣 DER ABNAHMEFALL: es bleiben 16 Zuweisungen, nicht 17. Gerechnet wurden '
    . $mitKollision['lines_affected'] . ' -- steht hier 17, fehlt der Riegel, und der Lauf legt '
    . '„Hexenband(-schleife)" auf denselben Artikel wie „Hexenband".');
assert($mitKollision['skipped']['article_taken'] === 1,
    'Genau EINE Linie wird wegen eines vergebenen Artikels uebersprungen, gezaehlt '
    . $mitKollision['skipped']['article_taken']);
assert(count($mitKollision['taken']) === 1
    && $mitKollision['taken'][0]['line'] === 'Hexenband(-schleife)'
    && $mitKollision['taken'][0]['held_by'] === 'Hexenband',
    '🔴 Der Grund wird BENANNT, nicht verschwiegen: die uebersprungene Linie heisst '
    . '„Hexenband(-schleife)", gehalten wird der Artikel von „Hexenband". Gemeldet wurde: '
    . json_encode($mitKollision['taken'], JSON_UNESCAPED_UNICODE));

$geschriebenMitKollision = array_column($mitKollision['writes'], 'line');
assert(!in_array('Hexenband(-schleife)', $geschriebenMitKollision, true),
    'Die kollidierende Linie darf in keiner einzigen Schreibzeile auftauchen');

echo "2. Riegel gegen den vergebenen Artikel (Hexenband) ok\n";

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 3. Der Riegel greift auch, wenn ZWEI unzugewiesene Linien um denselben Artikel streiten
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 Dieselbe Regel, nicht eine zweite: ein Artikel traegt am Ende des Laufs genau EINEN Anspruch.
// Hier haelt ihn noch niemand -- also bekommt ihn KEINE der beiden. „Lieber eine Luecke als eine
// falsche Identitaet". Waere es „die erste gewinnt", entschiede die Lesereihenfolge der Datenbank,
// welches Kartenobjekt einen Artikel bekommt.
$streit = avesmapsWikiPowerlineDecideAssignAll(
    fixtureSegmente([
        ['Bann-Linie', 1, '', false],
        ['Bann Linie', 2, '', false],   // dieselbe Schreibung ohne Bindestrich -> derselbe Match-Key
        ['Torweg', 1, '', false],
    ]),
    fixtureKatalog([
        ['Bann-Linie', 'https://de.wiki-aventurica.de/wiki/Bann-Linie'],
        ['Torweg', 'https://de.wiki-aventurica.de/wiki/Torweg'],
    ])
);
assert($streit['lines_affected'] === 1 && $streit['writes'][0]['line'] === 'Torweg',
    '💣 Streiten zwei unzugewiesene Linien um einen Artikel, bekommt ihn KEINE -- geschrieben werden '
    . 'darf nur „Torweg". Gerechnet: ' . json_encode(array_column($streit['writes'], 'line'), JSON_UNESCAPED_UNICODE));
assert($streit['skipped']['article_taken'] === 2,
    'BEIDE Bewerber werden gemeldet, nicht einer, gezaehlt ' . $streit['skipped']['article_taken']);
assert($streit['taken'][0]['held_by'] === 'Bann-Linie' || $streit['taken'][0]['held_by'] === 'Bann Linie',
    'Im Streitfall nennt „held_by" den Mitbewerber, gemeldet: ' . $streit['taken'][0]['held_by']);

echo "3. Streit zweier unzugewiesener Linien ok\n";

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 3b. Eine Linie ist NIE ihr eigener Mitbewerber -- auch nicht mit einem Namen wie „7"
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// 💣 GEFUNDEN BEIM BAU, 18.08.2026, und der Fehler war STILL. PHP macht aus einem Array-Schluessel,
// der wie eine ganze Zahl aussieht, eine INT: die Gruppe „7" lag unter dem Schluessel 7, der
// Selbstvergleich in Durchgang zwei lief zwischen int und string und war damit immer wahr -- die
// Linie wurde ihr eigener Mitbewerber und blieb als „Artikel schon vergeben" liegen, mit sich
// selbst als Halter. Live gibt es heute keinen solchen Namen; der Fehler haette auf seinen ersten
// gewartet. Behoben durch das Praefix `n:` am Gruppenschluessel.
$numerisch = avesmapsWikiPowerlineDecideAssignAll(
    fixtureSegmente([['7', 2, '', false]]),
    fixtureKatalog([['7', 'https://de.wiki-aventurica.de/wiki/Sieben']])
);
assert($numerisch['lines_affected'] === 1 && $numerisch['segments_affected'] === 2,
    '💣 Eine Kraftlinie mit einem Namen wie „7" muss ganz normal zugewiesen werden. Gerechnet: '
    . $numerisch['lines_affected'] . ' Linien / ' . $numerisch['segments_affected'] . ' Segmente.');
assert($numerisch['taken'] === [],
    '💣 Sie darf sich NICHT selbst als Halter melden. Gemeldet: '
    . json_encode($numerisch['taken'], JSON_UNESCAPED_UNICODE));

echo "3b. numerischer Linienname ok\n";

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 4. Der Merker „kein Wiki-Artikel" schlaegt den Katalogfund -- und er wird GEFRAGT, nicht kopiert
// ═══════════════════════════════════════════════════════════════════════════════════════════════
$mitMerker = avesmapsWikiPowerlineDecideAssignAll(
    fixtureSegmente([
        ['Torweg', 2, '', true],        // Merker gesetzt, obwohl der Katalog den Artikel kennt
        ['Wandelband', 1, '', false],
    ]),
    fixtureKatalog([
        ['Torweg', 'https://de.wiki-aventurica.de/wiki/Torweg'],
        ['Wandelband', 'https://de.wiki-aventurica.de/wiki/Wandelband'],
    ])
);
assert($mitMerker['lines_affected'] === 1 && $mitMerker['writes'][0]['line'] === 'Wandelband',
    '🔴 Eine Linie mit dem Merker „Kein Wiki-Artikel vorhanden" traegt die ENTSCHEIDUNG eines '
    . 'Menschen; eine Zuweisung widerspraeche ihr. Geschrieben wurde: '
    . json_encode(array_column($mitMerker['writes'], 'line'), JSON_UNESCAPED_UNICODE));
assert($mitMerker['skipped']['no_article_flag'] === 1,
    'Der Grund heisst „no_article_flag" und wird eigens gezaehlt, gemeldet '
    . $mitMerker['skipped']['no_article_flag']);

// 💣 UND ER MUSS DER HAUSRIEGEL SEIN, nicht seine Abschrift. Die Quelltextprobe ist der einzige
// Weg, das festzunageln: eine eigene `if (!empty(...wiki_no_article))`-Bedingung bestuende Fall 4
// oben genauso -- und liefe beim naechsten Mal auseinander (AGENTS.md §5, die zweite Wahrheit).
$lib = (string) file_get_contents(__DIR__ . '/../powerline-assign.php');
assert(str_contains($lib, 'avesmapsAssertPowerlineWikiClaimNotContradictory('),
    '🔴 Der Widerspruch „Zuweisung UND kein Artikel" wird im Haus an EINER Stelle entschieden. '
    . 'Diese Datei muss sie RUFEN, statt die Bedingung ein zweites Mal hinzuschreiben.');

echo '4. Merker „kein Wiki-Artikel“ ok' . "\n";

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 5. Bestimmt und reihenfolgeunabhaengig
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠️ Die Vorschau nennt eine Zahl, und der Editor drueckt danach. Haengt das Ergebnis an der
// Lesereihenfolge der Datenbank, ist die gezeigte Zahl nicht die, die geschrieben wird.
$gedreht = array_reverse($segmente);
$ergebnisGedreht = avesmapsWikiPowerlineDecideAssignAll($gedreht, $staged);
assert($ergebnisGedreht['lines_affected'] === $ergebnis['lines_affected']
    && $ergebnisGedreht['segments_affected'] === $ergebnis['segments_affected']
    && $ergebnisGedreht['skipped'] === $ergebnis['skipped'],
    'Dieselben Segmente in umgekehrter Reihenfolge muessen dieselbe Entscheidung ergeben');

$sortiert = static function (array $e): array {
    $paare = array_map(static fn(array $w): string => $w['line'] . ' -> ' . $w['wiki_url'], $e['writes']);
    sort($paare);

    return $paare;
};
assert($sortiert($ergebnisGedreht) === $sortiert($ergebnis),
    'Auch die geschriebenen Paare (Linie -> Adresse) muessen identisch sein');

// ⚠️ Und die REIHENFOLGE der Linien ist ebenfalls fest -- nicht aus Ordnungsliebe: die Rueckfrage
// zaehlt die uebersprungenen Faelle namentlich auf, und eine Liste, die bei jedem Klick anders
// sortiert ist, laesst sich zwischen Vorschau und Bestaetigung nicht vergleichen. Das leistet das
// ksort in avesmapsWikiPowerlineDecideAssignAll; ohne es entschiede die Lesereihenfolge.
$linienfolge = static fn(array $e): array => array_values(array_unique(array_column($e['writes'], 'line')));
assert($linienfolge($ergebnisGedreht) === $linienfolge($ergebnis),
    'Die Reihenfolge der geschriebenen Linien haengt an der Lesereihenfolge der Datenbank: '
    . json_encode($linienfolge($ergebnisGedreht), JSON_UNESCAPED_UNICODE) . ' gegen '
    . json_encode($linienfolge($ergebnis), JSON_UNESCAPED_UNICODE));

echo "5. Bestimmtheit ok\n";

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 6. Die Antwortform IST der Vertrag mit js/ui/wiki-massenzuweisung.js
// ═══════════════════════════════════════════════════════════════════════════════════════════════
$antwort = avesmapsWikiPowerlineAssignResult($ergebnis, count($staged), true, 0, 0);
foreach (['dry_run', 'staged', 'total_lines', 'lines_affected', 'segments_affected',
          'articles_linked', 'applied', 'applied_segments', 'skipped', 'taken'] as $schluessel) {
    assert(array_key_exists($schluessel, $antwort),
        'Der Antwortschluessel „' . $schluessel . '" fehlt -- die Zahlen im Knopf und der Rueckleser '
        . 'des scharfen Laufs lesen genau diese Namen.');
}
assert($antwort['dry_run'] === true && $antwort['applied'] === 0,
    'Ein Trockenlauf meldet dry_run:true und applied:0');
$scharf = avesmapsWikiPowerlineAssignResult($ergebnis, count($staged), false, 16, 69);
assert($scharf['dry_run'] === false && $scharf['applied'] === 16 && $scharf['applied_segments'] === 69,
    '💣 `applied` zaehlt LINIEN (die Einheit der Vorschau), `applied_segments` die geschriebenen '
    . 'Segmente. Vertauscht meldete die Statuszeile „69 Kraftlinien verknuepft".');

// Der Endpunkt fordert BEIDE Haelften -- eine allein bleibt stillschweigend eine Vorschau.
$endpunkt = (string) file_get_contents(__DIR__ . '/../../../edit/map/powerlines.php');
assert(str_contains($endpunkt, "(\$payload['dry_run'] ?? true) === false")
    && str_contains($endpunkt, "(string) (\$payload['confirm'] ?? '') === 'apply'"),
    '🔴 Der scharfe Lauf braucht `dry_run:false` UND `confirm:"apply"` -- dieselbe Form wie bei Weg, '
    . 'Landschaft und Karte, damit das gemeinsame Bedienteil sie unveraendert faehrt.');
assert(str_contains($endpunkt, 'avesmapsWikiPowerlineAssignAll($pdo, $dryRun'),
    '🪤 Eine geprueft richtige Funktion, die niemand aufruft, ist ein gruener Test ohne Wirkung: '
    . 'der Endpunkt muss den Lauf tatsaechlich rufen.');
assert(str_contains($endpunkt, "avesmapsJsonResponse(200, ['ok' => true] + \$ergebnis)"),
    '🔴 Die Antwort ist FLACH. In `feature: {…}` verpackt fande der Rueckleser des scharfen Laufs '
    . '(`dry_run === false`) nichts und meldete Erfolg, ohne dass etwas geschrieben waere.');

echo "6. Antwortform und Verdrahtung ok\n";

echo "ALLE ZUSICHERUNGEN GEHALTEN\n";
