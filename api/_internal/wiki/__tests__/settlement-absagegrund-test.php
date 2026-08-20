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

foreach (['settlements.php', 'paths.php'] as $dateiname) {
    $kette = $fangkette($apiRoot . '/edit/wiki/' . $dateiname);

    // 💣 Nur die ÄUSSERE Kette zählt: `dump.php` & Co. haben innen best-effort-Fänger. Die drei
    // gesuchten stehen am Dateiende, also wird von hinten gelesen.
    $typen = array_map(static fn(array $satz): string => $satz['typ'], $kette);
    $letzteDrei = array_slice($typen, -3);

    assert(
        $letzteDrei === ['PDOException $error', 'RuntimeException $error', 'Throwable $error'],
        "{$dateiname}: PDOException vor RuntimeException vor Throwable -- gelesen: "
        . implode(' | ', $letzteDrei)
    );

    $rümpfe = array_slice($kette, -3);
    [$pdo, $laufzeit, $rest] = $rümpfe;

    assert(
        !str_contains($pdo['rumpf'], 'getMessage()'),
        "{$dateiname}: der PDO-Zweig gibt NICHTS heraus -- SQLSTATE-Texte nennen Tabellen und Spalten"
    );
    assert(
        str_contains($pdo['rumpf'], "avesmapsErrorResponse(500, 'server_error'"),
        "{$dateiname}: der PDO-Zweig antwortet mit 500 und dem stummen Satz"
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

    echo "OK  {$dateiname}: PDOException -> RuntimeException (mit Grund) -> Throwable\n";
}

echo "OK  Fall #84: die Absage des Siedlungs-Endpunkts nennt ihren Grund.\n";
