<?php

declare(strict_types=1);

/**
 * 💣 EINE ABSAGE MUSS IHREN GRUND NENNEN -- sonst ist sie von einem Serverfehler nicht zu
 * unterscheiden. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       api/_internal/wiki/__tests__/settlement-absagegrund-test.php
 *
 * Anlass (Discord #84, 20.08.2026): „Der Versuch, Orten einen Wiki-Artikel zuzuweisen, führte
 * gestern Abend und heute Mittag zu 'Zuweisen gescheitert, Internal Server Error'." Der Endpunkt
 * fing JEDE Ausnahme in einem einzigen `catch (Throwable)` und antwortete mit 500 und dem Satz
 * „Internal server error." -- auch auf seine EIGENEN, handgeschriebenen Absagen
 * („Ziel-Ort nicht gefunden.", „Wiki-Seite nicht gefunden oder leer: X", „title/public_id fehlt.").
 * Der Editor las über die Oberfläche „Zuweisen fehlgeschlagen: Internal server error."
 * (settlementWikiAssignZuweisen, html/wiki-sync-settlement-editor.html) und konnte daraus nichts
 * ableiten -- und niemand sonst auch nicht: die Maskierung macht den Grund von AUSSEN unauffindbar.
 *
 * 🔴 DIE REIHENFOLGE IST DER GANZE TEST. `PDOException` ERBT von `RuntimeException`; stünde der
 * RuntimeException-Zweig zuerst, gingen SQLSTATE-Texte, Tabellen- und Spaltennamen an den Client
 * (AGENTS.md §10: mehrere Endpunkte tun das noch, M1). Vorbild ist der Schwesterendpunkt
 * api/edit/wiki/paths.php -- dort steht dieselbe Kette samt Begründung.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

// Der Grund, aus dem die Reihenfolge zählt -- gemessen, nicht behauptet.
assert(
    is_subclass_of('PDOException', 'RuntimeException'),
    'PDOException erbt von RuntimeException -- deshalb muss sie ZUERST gefangen werden'
);

$apiRoot = dirname(__DIR__, 3); // …/api/_internal/wiki/__tests__ -> …/api

/**
 * Liest die Fangkette am Dateiende ab -- ABGELESEN, nicht abgeschrieben.
 *
 * @return list<array{typ:string,rumpf:string}>
 */
$fangkette = static function (string $datei): array {
    $quelltext = (string) file_get_contents($datei);
    assert($quelltext !== '', "der Endpunkt ist lesbar: {$datei}");
    preg_match_all(
        // 💣 Die schliessende Klammer wird per Lookahead GESEHEN, nicht verbraucht: verbraucht
        // frisst sie das '}' der NAECHSTEN catch-Zeile, und die Kette faellt auf jeden zweiten
        // Zweig zusammen (erster Lauf: PDOException | Throwable -- der mittlere fehlte lautlos).
        '/^\} catch \(([^)]+)\)[^\n]*\r?\n(.*?)(?=^\})/ms',
        $quelltext . "\n",
        $treffer,
        PREG_SET_ORDER
    );
    $kette = [];
    foreach ($treffer as $satz) {
        $kette[] = ['typ' => trim($satz[1]), 'rumpf' => $satz[2]];
    }
    return $kette;
};

// 🔴 DIE KETTE STEHT JE DATEI IM REGISTER, statt als eine Zahl im Code. Sie sind NICHT gleich
// lang: nur der Siedlungs-Endpunkt kennt den belegten Drosselplatz, weil nur sein Dialog live
// abruft (gemessen in wiki-interaktiv-drossel-test.php, Abschnitt G). Eine feste Laenge hier
// hiesse, dass jeder Endpunkt jeden Sonderfall fangen muss -- und ein toter Zweig sieht wie
// Sorgfalt aus.
$erwarteteKetten = [
    // 🔴 SEIT DEM 07.09.2026 SIND ES FUENF. Vorn dazu kam AvesmapsWikiBelegtException: „unser
    // eigener Crawl-delay laeuft noch" ist etwas anderes als „das Wiki antwortet nicht", und die
    // Handlungsanweisung ist eine andere (zwanzig Sekunden warten statt jemanden rufen).
    // 💣 Sie ERBT von AvesmapsWikiUnreachableException und steht deshalb DAVOR.
    'settlements.php' => [
        'PDOException $error',
        'AvesmapsWikiBelegtException $error',
        'AvesmapsWikiUnreachableException $error',
        'RuntimeException $error',
        'Throwable $error',
    ],
    // 🔴 SEIT DEM 20.08.2026 SIND ES VIER. Dazwischen kam AvesmapsWikiUnreachableException:
    // „das Wiki antwortet nicht" ist weder ein Serverfehler noch eine abgelehnte Eingabe, und der
    // Editor bekam dafuer bis dahin eine Meldung, deren 164 von 212 Zeichen die API-URL waren.
    // 💣 Sie ERBT von RuntimeException und steht deshalb DAVOR -- darunter waere der Zweig tot.
    // ⚠️ Der Wege-Dialog liest ausschliesslich unsere eigenen Tabellen und kann den belegten
    // Platz gar nicht ausloesen; faengt er je live ab, faellt das in Abschnitt G des
    // Nachbartests auf, und DANN gehoert der Zweig auch hierher.
    'paths.php' => [
        'PDOException $error',
        'AvesmapsWikiUnreachableException $error',
        'RuntimeException $error',
        'Throwable $error',
    ],
];

foreach ($erwarteteKetten as $dateiname => $erwartet) {
    $kette = $fangkette($apiRoot . '/edit/wiki/' . $dateiname);

    // 💣 Nur die ÄUSSERE Kette zählt: `dump.php` & Co. haben innen best-effort-Fänger. Die
    // gesuchten stehen am Dateiende, also wird von hinten gelesen.
    $typen = array_map(static fn(array $satz): string => $satz['typ'], $kette);
    $gelesen = array_slice($typen, -count($erwartet));

    assert(
        $gelesen === $erwartet,
        "{$dateiname}: erwartete Fangkette " . implode(' | ', $erwartet)
        . ' -- gelesen: ' . implode(' | ', $gelesen)
    );

    // 🪤 PER TYP GEGRIFFEN, NICHT PER POSITION: die Ketten sind verschieden lang, und eine
    // Position, die bei einer Datei stimmt, zeigt bei der anderen auf den falschen Zweig.
    $zweig = static function (string $typ) use ($kette, $dateiname): array {
        foreach ($kette as $satz) {
            if ($satz['typ'] === $typ) {
                return $satz;
            }
        }
        assert(false, "{$dateiname}: Zweig {$typ} nicht in der Kette");
        return ['typ' => $typ, 'rumpf' => ''];
    };

    $pdo = $zweig('PDOException $error');
    $unerreichbar = $zweig('AvesmapsWikiUnreachableException $error');
    $laufzeit = $zweig('RuntimeException $error');
    $rest = $zweig('Throwable $error');

    // Der belegte Platz: eigener Code, damit die Oberflaeche „gleich noch einmal" von „das Wiki
    // ist weg" unterscheiden kann -- und sein fertiger Satz reist durch.
    if (in_array('AvesmapsWikiBelegtException $error', $erwartet, true)) {
        $belegt = $zweig('AvesmapsWikiBelegtException $error');
        assert(
            str_contains($belegt['rumpf'], '$error->getMessage()'),
            "{$dateiname}: der Belegt-Zweig reicht seinen fertigen Satz durch"
        );
        assert(
            str_contains($belegt['rumpf'], "avesmapsErrorResponse(503, 'wiki_busy'"),
            "{$dateiname}: 503/wiki_busy -- eigener Code, weil ein zweiter Versuch binnen Sekunden "
            . 'gelingt; wiki_unreachable wuerde zum Aufgeben raten'
        );
    }

    assert(
        !str_contains($pdo['rumpf'], 'getMessage()'),
        "{$dateiname}: der PDO-Zweig gibt NICHTS heraus -- SQLSTATE-Texte nennen Tabellen und Spalten"
    );
    // 💣 ZWEI Hausformen, und beide sind richtig: avesmapsServerErrorResponse (bootstrap.php:409)
    // schreibt zusaetzlich eine Protokollzeile und antwortet dann mit demselben Umschlag wie
    // avesmapsErrorResponse(500, 'server_error', …). Der Test darf deshalb nicht auf eine der
    // beiden festnageln -- er prueft, dass der Zweig NACH AUSSEN 500 und stumm ist.
    assert(
        str_contains($pdo['rumpf'], 'avesmapsServerErrorResponse($error')
        || str_contains($pdo['rumpf'], "avesmapsErrorResponse(500, 'server_error'"),
        "{$dateiname}: der PDO-Zweig antwortet mit 500 und dem stummen Satz"
    );

    assert(
        str_contains($unerreichbar['rumpf'], '$error->getMessage()'),
        "{$dateiname}: der Unerreichbar-Zweig reicht seinen fertigen Satz durch"
    );
    assert(
        str_contains($unerreichbar['rumpf'], "avesmapsErrorResponse(503, 'wiki_unreachable'"),
        "{$dateiname}: 503/wiki_unreachable -- die Ursache liegt DRAUSSEN, ein spaeterer Versuch "
        . 'kann gelingen; 400 wuerde dem Editor die Schuld geben'
    );

    assert(
        str_contains($laufzeit['rumpf'], '$error->getMessage()'),
        "{$dateiname}: der RuntimeException-Zweig REICHT SEINEN GRUND DURCH -- sonst liest der "
        . 'Editor wieder „Internal server error." (Discord #84)'
    );
    assert(
        str_contains($laufzeit['rumpf'], "avesmapsErrorResponse(400, 'invalid_request'"),
        "{$dateiname}: eine abgelehnte Eingabe ist 400/invalid_request, kein Serverfehler"
    );

    assert(
        !str_contains($rest['rumpf'], 'getMessage()'),
        "{$dateiname}: der Throwable-Zweig bleibt stumm -- dort landet, was NICHT abgesprochen ist"
    );

    assert(
        str_contains($rest['rumpf'], 'avesmapsServerErrorResponse($error')
        || str_contains($rest['rumpf'], "avesmapsErrorResponse(500, 'server_error'"),
        "{$dateiname}: der Throwable-Zweig antwortet mit 500"
    );

    echo "OK  {$dateiname}: " . implode(' -> ', array_map(
        static fn(string $typ): string => trim(str_replace('$error', '', $typ)),
        $erwartet
    )) . "\n";
}

echo "OK  Fall #84: die Absage des Siedlungs-Endpunkts nennt ihren Grund.\n";
