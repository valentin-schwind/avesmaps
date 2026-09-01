<?php

declare(strict_types=1);

/**
 * DER ERLAUBTE WEG ZU EINER WIKI-BILDDATEI -- ueber `api.php`, nicht ueber `Spezial:Dateipfad`.
 *
 * 🔴 WORUM ES GEHT. Die robots.txt des Wiki Aventurica verbietet `/wiki/Spezial:` -- JEDEM
 * Agenten, seit jeher, auch dem eigenen Abschnitt `AvesmapsWikiSync`. Genau diese Seite haben
 * wir am 20. und 23.08.2026 massenhaft abgerufen, und genau dafuer hat ihre `bot-trap` unsere
 * Ausgangs-IP gesperrt. Die Drossel vom 25.08. hat das langsam gemacht, nicht erlaubt.
 *
 * ⭐ Der erlaubte Weg steht in derselben robots.txt: `/de/api.php` ist fuer uns FREIGEGEBEN
 * (fuer `User-agent: *` nicht -- deshalb muss die Abfrage unter unserem Namen laufen), und
 * `/de/images/` steht in KEINER Verbotsliste. Also: Titel -> `prop=imageinfo` -> echte
 * Bildadresse -> die holen.
 *
 * 💣 DIE TRAGENDE FALLE IST DIE TITEL-NORMALISIERUNG. MediaWiki schreibt Titel um, bevor es sie
 * nachschlaegt (erster Buchstabe gross, `_` zu Leerzeichen), und die Antwort traegt den
 * NORMALISIERTEN Titel -- nicht den, den wir geschickt haben. Live gemessen 25.08.2026:
 * `Datei:dere-globus icon 32px.png` kam als `Datei:Dere-globus icon 32px.png` zurueck. Wer die
 * Antwort ueber den eigenen Titel zuordnet, findet sie nicht und haelt die Datei fuer nicht
 * vorhanden -- ein stiller Verlust, der wie "das Bild gibt es nicht" aussieht. Die Zuordnung
 * MUSS ueber `query.normalized` laufen (Abschnitt 3).
 *
 * Kein Netz: die Abfrage wird als Rueckruf hereingereicht (dieselbe Bauform wie die
 * Testparameter der Drossel). Was hier gegen das echte Wiki gemessen wurde, steht als Fixture
 * in Abschnitt 2 -- Wort fuer Wort die Antwort von `formatversion=2`.
 *
 * Lauf (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/wiki-datei-adresse-test.php
 * Exit 0 = alle Zusicherungen erfuellt.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'.\n");
    exit(2);
}

$wurzel = dirname(__DIR__, 4);
require_once $wurzel . '/api/_internal/wiki/datei-adresse.php';

$spezial = static fn(string $datei): string =>
    'https://de.wiki-aventurica.de/wiki/Spezial:Dateipfad/' . rawurlencode($datei);

// ---------------------------------------------------------------------------
// ABSCHNITT 1 -- die Erkennung.
// ---------------------------------------------------------------------------

assert(avesmapsWikiDateiIstSpezialAdresse($spezial('Wappen Gareth.png')) === true, '1: Spezial nicht erkannt.');
assert(
    avesmapsWikiDateiIstSpezialAdresse('https://de.wiki-aventurica.de/de/images/2/24/Av-SI5.svg') === false,
    '1: eine ECHTE Bildadresse ist keine Spezialseite -- sonst loest sich der Aufloeser im Kreis.'
);
assert(avesmapsWikiDateiIstSpezialAdresse('/uploads/wappen/eigen.png') === false, '1: lokale Datei.');
assert(avesmapsWikiDateiIstSpezialAdresse('') === false, '1: leer.');
// 💣 Suffix-Grenze, dieselbe Regel wie im Riegel: ein fremder Wirt mit demselben Pfad ist NICHT
// unsere Spezialseite -- sonst schickten wir seinen Dateinamen an das echte Wiki.
assert(
    avesmapsWikiDateiIstSpezialAdresse('https://wiki-aventurica.de.angreifer.example/wiki/Spezial:Dateipfad/X.png') === false,
    '1: Suffix-Grenze verletzt.'
);

// ---------------------------------------------------------------------------
// ABSCHNITT 2 -- die Aufloesung, gegen die echte Antwortform.
// ---------------------------------------------------------------------------

$gestellteAbfragen = [];

/** Die Fixture: Wort fuer Wort die Form, die `formatversion=2` am 25.08.2026 geliefert hat. */
$abfrage = static function (array $params) use (&$gestellteAbfragen): array {
    $gestellteAbfragen[] = $params;
    $titel = explode('|', (string) ($params['titles'] ?? ''));

    $bekannt = [
        'Datei:Av-SI5.svg' => 'https://de.wiki-aventurica.de/de/images/2/24/Av-SI5.svg',
        // Der normalisierte Name -- unter dem und NUR unter dem antwortet das Wiki.
        'Datei:Dere-globus icon 32px.png' => 'https://de.wiki-aventurica.de/de/images/7/71/Dere-globus_icon_32px.png',
    ];

    $normalized = [];
    $pages = [];
    foreach ($titel as $t) {
        // MediaWiki normalisiert: erster Buchstabe gross, '_' zu Leerzeichen.
        $norm = str_replace('_', ' ', $t);
        $norm = preg_replace_callback(
            '/^(Datei:)(.)/u',
            static fn(array $m): string => $m[1] . mb_strtoupper($m[2]),
            $norm
        ) ?? $norm;
        if ($norm !== $t) {
            $normalized[] = ['fromencoded' => false, 'from' => $t, 'to' => $norm];
        }

        if (isset($bekannt[$norm])) {
            $pages[] = [
                'pageid' => 1,
                'ns' => 6,
                'title' => $norm,
                'imagerepository' => 'local',
                'imageinfo' => [['url' => $bekannt[$norm], 'mime' => 'image/png']],
            ];
            continue;
        }
        $pages[] = ['ns' => 6, 'title' => $norm, 'missing' => true, 'imagerepository' => ''];
    }

    $query = ['pages' => $pages];
    if ($normalized !== []) {
        $query['normalized'] = $normalized;
    }

    return ['batchcomplete' => true, 'query' => $query];
};

avesmapsWikiDateiAufloesungZuruecksetzen();
$eingang = [
    $spezial('Av-SI5.svg'),
    $spezial('GibtEsNicht.png'),
];
$karte = avesmapsWikiDateiAdressenAufloesen($eingang, $abfrage);

assert(
    ($karte[$eingang[0]] ?? null) === 'https://de.wiki-aventurica.de/de/images/2/24/Av-SI5.svg',
    '2: die vorhandene Datei wurde nicht aufgeloest.'
);
assert(
    ($karte[$eingang[1]] ?? null) === '',
    '2: eine fehlende Datei muss LEER zurueckkommen, nicht fehlen -- der Aufrufer soll den '
        . 'Unterschied zwischen "nicht da" und "nie gefragt" sehen.'
);
assert(count($gestellteAbfragen) === 1, '2: zwei Titel gehoeren in EINE Abfrage, nicht in zwei.');
assert(
    str_contains((string) $gestellteAbfragen[0]['titles'], '|'),
    '2: die Titel wurden nicht gestapelt.'
);
assert(
    ($gestellteAbfragen[0]['action'] ?? '') === 'query'
        && str_contains((string) ($gestellteAbfragen[0]['prop'] ?? ''), 'imageinfo'),
    '2: es wurde nicht prop=imageinfo gefragt.'
);
// ⚠️ `iiprop=url` ist der Grund der ganzen Abfrage. Ohne das Feld antwortet die API brav mit
// Titeln und ohne eine einzige Adresse -- und der Aufloeser meldete jede Datei als fehlend.
assert(
    str_contains((string) ($gestellteAbfragen[0]['iiprop'] ?? ''), 'url'),
    '2: iiprop=url fehlt -- die Antwort traegt dann gar keine Adresse.'
);

// ---------------------------------------------------------------------------
// ABSCHNITT 3 -- 💣 die Normalisierung. Die eine Zusicherung, die das Feature traegt.
// ---------------------------------------------------------------------------

avesmapsWikiDateiAufloesungZuruecksetzen();
$gestellteAbfragen = [];
$kleingeschrieben = $spezial('dere-globus icon 32px.png');
$karte = avesmapsWikiDateiAdressenAufloesen([$kleingeschrieben], $abfrage);

assert(
    ($karte[$kleingeschrieben] ?? null) === 'https://de.wiki-aventurica.de/de/images/7/71/Dere-globus_icon_32px.png',
    '3: 💣 der Titel wurde von MediaWiki umgeschrieben, und die Antwort kam unter dem NEUEN Namen '
        . 'zurueck. Wer nicht ueber query.normalized zuordnet, haelt die Datei fuer nicht '
        . 'vorhanden -- ein stiller Verlust, der wie "gibt es nicht" aussieht.'
);

// Und der Unterstrich, den derselbe Schritt ersetzt.
avesmapsWikiDateiAufloesungZuruecksetzen();
$mitUnterstrich = $spezial('Av-SI5.svg');
$karte = avesmapsWikiDateiAdressenAufloesen([$mitUnterstrich], $abfrage);
assert(($karte[$mitUnterstrich] ?? null) !== '', '3: Unterstrich-Normalisierung verloren.');

// ---------------------------------------------------------------------------
// ABSCHNITT 4 -- der Laengendeckel, nicht array_chunk.
// ---------------------------------------------------------------------------

// 🪤 500 Titel passen NICHT in eine URL: das Wiki antwortet mit HTTP 414 und der ganze Lauf
// steht (25.08.2026, zweimal an einem Tag gefunden). Der Bestand hat dafuer laengst
// `avesmapsWikiSyncNextTitleBatch` -- laengenbewusst statt stueckzahlbewusst. Wer hier
// array_chunk schreibt, baut den 414 zum dritten Mal.
avesmapsWikiDateiAufloesungZuruecksetzen();
$gestellteAbfragen = [];
$viele = [];
for ($i = 0; $i < 400; $i++) {
    // Lange Titel, damit die LAENGE trennt und nicht die Anzahl.
    $viele[] = $spezial(str_repeat('Wappen-Sehr-Langer-Name-', 4) . $i . '.png');
}
avesmapsWikiDateiAdressenAufloesen($viele, $abfrage, 500);

assert(count($gestellteAbfragen) > 1, '4: 400 lange Titel gingen in EINE Abfrage -- das ist der HTTP 414.');
foreach ($gestellteAbfragen as $index => $abgefragt) {
    $laenge = strlen(rawurlencode((string) $abgefragt['titles']));
    assert(
        $laenge <= AVESMAPS_WIKI_TITLE_QUERY_MAX_ENCODED,
        "4: Abfrage {$index} ist {$laenge} kodierte Zeichen lang und sprengt den Deckel."
    );
}

// ---------------------------------------------------------------------------
// ABSCHNITT 5 -- einmal gefragt ist einmal gefragt.
// ---------------------------------------------------------------------------

// ⚠️ Jede Abfrage kostet einen vollen Crawl-delay (20 s). Ein Aufloeser ohne Gedaechtnis
// verdoppelt die Laufzeit jedes Sammellaufs, weil der Bildholer je Bild erneut fragt.
avesmapsWikiDateiAufloesungZuruecksetzen();
$gestellteAbfragen = [];
$eine = $spezial('Av-SI5.svg');
avesmapsWikiDateiAdressenAufloesen([$eine], $abfrage);
$nachErster = count($gestellteAbfragen);
$zweite = avesmapsWikiDateiAdresseAufloesen($eine, $abfrage);

assert($nachErster === 1, '5: die erste Aufloesung hat nicht gefragt.');
assert(count($gestellteAbfragen) === 1, '5: dieselbe Adresse wurde ein zweites Mal gefragt.');
assert($zweite !== '', '5: der Zwischenspeicher liefert nichts.');

// Auch ein NEGATIVES Ergebnis wird behalten -- sonst fragt jeder Seitenaufbau die immer
// gleichen toten Dateinamen erneut. Genau diese Endlosschleife hielt die Sperre am Leben.
avesmapsWikiDateiAufloesungZuruecksetzen();
$gestellteAbfragen = [];
$tot = $spezial('GibtEsNicht.png');
avesmapsWikiDateiAdresseAufloesen($tot, $abfrage);
avesmapsWikiDateiAdresseAufloesen($tot, $abfrage);
assert(count($gestellteAbfragen) === 1, '5: eine tote Adresse wurde zweimal gefragt.');

// ---------------------------------------------------------------------------
// ABSCHNITT 6 -- die Verdrahtung: niemand holt mehr eine Spezialseite.
// ---------------------------------------------------------------------------

$rumpfVon = static function (string $quelle, string $name): string {
    $start = strpos($quelle, 'function ' . $name);
    if ($start === false) {
        return '';
    }
    $auf = strpos($quelle, '{', $start);
    if ($auf === false) {
        return '';
    }
    $tiefe = 0;
    for ($i = $auf, $n = strlen($quelle); $i < $n; $i++) {
        if ($quelle[$i] === '{') {
            $tiefe++;
        } elseif ($quelle[$i] === '}') {
            $tiefe--;
            if ($tiefe === 0) {
                return substr($quelle, $auf, $i - $auf + 1);
            }
        }
    }
    return '';
};

// Der Bildholer traegt VIER Aufrufer (Territoriumswappen, Upload, "Hole Wiki-Wappen",
// Literatur-Cover). Er loest auf -- damit sind alle vier auf einmal auf dem erlaubten Weg.
$holerQuelle = (string) file_get_contents($wurzel . '/api/_internal/wiki/sync-monitor-identity.php');
$holer = $rumpfVon($holerQuelle, 'avesmapsWikiSyncMonitorHttpGetBinary');
assert($holer !== '', '6: der Bildholer wurde nicht gefunden.');
assert(
    str_contains($holer, 'avesmapsWikiDateiAdresseAufloesen('),
    '6: der Bildholer holt eine Spezialseite, statt sie ueber api.php aufzuloesen.'
);

// coat.php loest NICHT auf: es beantwortet einen Seitenaufbau und darf dafuer keine zweite,
// wartende Anfrage stellen. Es weist die verbotene Seite ab -- der ausdrueckliche Lauf ist
// der Weg, der sie holt.
$coatQuelle = (string) file_get_contents($wurzel . '/api/app/coat.php');
$coat = $rumpfVon($coatQuelle, 'avesmapsCoatFetch');
assert($coat !== '', '6: avesmapsCoatFetch wurde nicht gefunden.');
assert(
    str_contains($coat, 'avesmapsWikiDateiIstSpezialAdresse('),
    '6: coat.php fragt nicht, ob es eine Spezialseite vor sich hat.'
);
assert(
    !str_contains($coat, 'avesmapsWikiDateiAdresseAufloesen('),
    '6: coat.php loest selbst auf -- das ist eine zweite gedrosselte Anfrage in einem '
        . 'Seitenaufbau, also genau die Arbeiter-Saettigung aus AGENTS.md §10.'
);

// Die zwei Sammellaeufe loesen ihren Stapel VOR der Schleife auf. ⚠️ Das ist eine Abkuerzung,
// keine Regel -- ohne sie wird der Lauf doppelt so lang (zwei gedrosselte Anfragen je Bild statt
// einer Abfrage plus je einem Abruf), aber nicht falsch. Sie steht trotzdem hier: eine
// Abkuerzung, die still wegfaellt, merkt man erst an der Laufzeit, und die misst niemand.
foreach (
    [
        'api/_internal/wiki/settlements-coat-localize.php' => 'avesmapsWikiSettlementLocalizeCoats',
        'api/_internal/wiki/sync-monitor-identity.php' => 'avesmapsWikiSyncMonitorLocalizeCoats',
    ] as $datei => $funktion
) {
    // 🪤 SEIT 01.09.2026 IST DER LAUF EINE HUELLE. `$funktion` oeffnet nur noch den Riegel
    // (avesmapsWikiAusdruecklicherAbruf) und ruft `…Ausfuehren`; der eigentliche Rumpf -- und damit
    // die Vorab-Aufloesung, die hier geprueft wird -- steckt dort. Ohne dieses `Ausfuehren` misst
    // dieser Test die Huelle und ist trivial gruen, waehrend die Abkuerzung wegfallen koennte.
    // Genau so ist er beim Umbau umgefallen, und das war richtig.
    $rumpf = $rumpfVon((string) file_get_contents($wurzel . '/' . $datei), $funktion . 'Ausfuehren');
    assert($rumpf !== '', "6: {$funktion}Ausfuehren nicht gefunden.");
    assert(
        str_contains($rumpf, 'avesmapsWikiDateiAdressenAufloesen('),
        "6: {$funktion} loest seinen Stapel nicht im Voraus auf -- der Lauf kostet dann die "
            . "doppelte Zeit."
    );
}

// ---------------------------------------------------------------------------
// ABSCHNITT 7 -- Gegenprobe: die Zusicherungen leben.
// ---------------------------------------------------------------------------

// 🪤 Ohne diesen Abschnitt koennte Abschnitt 6 an einem leeren Rumpf haengen und trivial
// erfuellt sein. Hier wird mutiert und der Fehlschlag VERLANGT.
$mutiert = str_replace('avesmapsWikiDateiAdresseAufloesen(', 'avesmapsNichtDerAufloeser(', $holerQuelle);
assert($mutiert !== $holerQuelle, '7: die Mutation ist gar nicht angekommen.');
$holerMutiert = $rumpfVon($mutiert, 'avesmapsWikiSyncMonitorHttpGetBinary');
assert($holerMutiert !== '', '7: mutierter Rumpf nicht gefunden.');
assert(
    !str_contains($holerMutiert, 'avesmapsWikiDateiAdresseAufloesen('),
    '7: die Zusicherung aus Abschnitt 6 ueberlebt die Mutation.'
);

echo "OK -- der erlaubte Weg: Spezial erkannt, ueber api.php aufgeloest, Normalisierung "
    . "zugeordnet, Laengendeckel gehalten, Verdrahtung gebunden.\n";
