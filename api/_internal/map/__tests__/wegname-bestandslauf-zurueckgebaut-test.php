<?php

declare(strict_types=1);

/**
 * WAECHTER: den Bestandslauf „Wegname anzeigen" gibt es nicht mehr -- und er kommt nicht zurueck.
 *
 * 🔴 DIE GESCHICHTE (15.09.2026): Seit dem Kanal-A-Tor fragt die Karte „Wegname anzeigen" auch an Wiki-Wegen (isWayLabelEligible,
 * js/map-features/map-features-way-labels.js). Damit rund 1.400 Wiki-Abschnitte ohne Haekchen ihren Namen nicht verloren (Owner-Entscheid
 * „Bestand bleibt"), hakte die Admin-Aktion `wegname_anzeigen_bestand` (POST /api/edit/map/features.php) sie einmal an -- gefahren am
 * 15.09.2026, bevor das Tor live ging. Danach ist sie zurueckgebaut.
 *
 * 💣 WARUM ZURUECKGEBAUT (Review I2): der Lauf haekt JEDEN Wiki-Abschnitt ohne Haekchen an. Vor dem Tor hiess „ohne Haekchen" noch
 * „nie jemand gefragt"; nach dem Tor heisst es „bewusst abgehakt" -- Owner-Regel „aus geht nur, wer abhakt". Eine Wiederholung haette
 * jedes bewusste „aus" wieder angehakt, lautlos, fuer jeden Besucher. Eine einmalige Migration, die nach ihrem Stichtag Schaden stiftet,
 * bleibt nicht als Knopf liegen.
 * ⭐ Wer je wieder einen Bestandslauf ueber `properties_json` baut: lesen IN der Transaktion mit `FOR UPDATE` plus Revisionsriegel im
 * UPDATE (sonst ueberschreibt er ein gleichzeitiges Speichern), und KEINE Protokollzeile je Zeile (die Kappung je Person auf 200 loeschte
 * die echte Aenderungsgeschichte). Stand zum Nachlesen: Commit 81f25352d, Datei api/_internal/map/features.php.
 *
 * Gelesen wird KOMMENTARFREI (Tokenizer): die Kommentare an beiden Stellen nennen die Aktion ausdruecklich, damit sie niemand
 * zurueckholt -- ein Test, der sie mitliest, schluege genau an dieser Warnung an.
 *
 * Lauf (aus dem Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/map/__tests__/wegname-bestandslauf-zurueckgebaut-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

$wurzel = dirname(__DIR__, 4);
$checks = 0;
$pruefe = static function (bool $bedingung, string $meldung) use (&$checks): void {
    $checks++;
    assert($bedingung, $meldung);
};
$ohneKommentare = static function (string $quelle): string {
    $ohne = '';
    foreach (token_get_all($quelle) as $token) {
        if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
            continue;
        }
        $ohne .= is_array($token) ? $token[1] : $token;
    }
    return $ohne;
};

// 1. Keine PHP-Datei unter api/ (ausser Tests) nennt die Aktion, die Funktionen oder den Deckel -- im CODE.
$verboten = ["'wegname_anzeigen_bestand'", '"wegname_anzeigen_bestand"', 'avesmapsWegnameAnzeigenBestand', 'AVESMAPS_WEGNAME_ANZEIGEN_BESTAND_DECKEL'];
$gelesen = 0;
$iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($wurzel . '/api', FilesystemIterator::SKIP_DOTS));
foreach ($iterator as $datei) {
    $pfad = str_replace('\\', '/', (string) $datei);
    if (!str_ends_with($pfad, '.php') || str_contains($pfad, '/__tests__/')) {
        continue;
    }
    $gelesen++;
    $code = $ohneKommentare((string) file_get_contents($pfad));
    foreach ($verboten as $name) {
        $pruefe(!str_contains($code, $name), "der zurueckgebaute Bestandslauf ist zurueck: {$name} in " . substr($pfad, strlen($wurzel) + 1)
            . ' -- nach dem Kanal-A-Tor haekte jede Wiederholung jedes bewusste „aus" wieder an (Review I2)');
    }
}
$pruefe($gelesen > 50, 'Voraussetzung: der Waechter hat die API ueberhaupt gelesen (' . $gelesen . ' Dateien) -- sonst misst er nichts');

// 2. Der Endpunkt, den er trug, laeuft ohne ihn: die Aktion faellt in den `default`-Zweig.
$endpunkt = $ohneKommentare((string) file_get_contents($wurzel . '/api/edit/map/features.php'));
$pruefe(str_contains($endpunkt, "'repair_crossing_type' =>"), 'Voraussetzung: der Endpunkt ist der erwartete (repair_crossing_type steht da)');
$pruefe(str_contains($endpunkt, "default => throw new InvalidArgumentException('Die Edit-Aktion ist unbekannt.')"),
    'der Endpunkt lehnt unbekannte Aktionen nicht mehr ab -- eine alte Seite, die den Lauf ruft, bekaeme keine klare Absage');

// 3. Wirklich geladen: die Bibliothek definiert die Funktion nicht mehr.
require_once $wurzel . '/api/_internal/bootstrap.php';
require_once $wurzel . '/api/_internal/map/features.php';
$pruefe(!function_exists('avesmapsWegnameAnzeigenBestand') && !function_exists('avesmapsWegnameAnzeigenBestandLesen')
    && !function_exists('avesmapsWegnameAnzeigenBestandBetrifft'), 'die Bibliothek definiert den Bestandslauf wieder');
$pruefe(!defined('AVESMAPS_WEGNAME_ANZEIGEN_BESTAND_DECKEL'), 'die Bibliothek definiert den Deckel des Bestandslaufs wieder');

// 4. Und sein Test ist mitgegangen -- ein Test ohne Code waere nur rot, einer mit zurueckgeholtem Code eine Einladung.
$pruefe(!file_exists($wurzel . '/api/_internal/map/__tests__/wegname-anzeigen-bestand-test.php'),
    'der Test des zurueckgebauten Bestandslaufs liegt noch da');

echo "wegname-bestandslauf-zurueckgebaut: {$checks} Zusicherungen erfuellt\n";
