<?php

declare(strict_types=1);

/**
 * 💣 EIN EDITOR IST KEIN TECHNIKER -- eine Absage muss ihm sagen, WAS los ist. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       api/_internal/wiki/__tests__/wiki-unreachable-meldung-test.php
 *
 * Anlass (Discord #84, 20.08.2026): der Wiki-Wirt wies unsere Ausgangs-IP ab, und im Editor stand
 * „Zuweisen fehlgeschlagen: Wiki Aventurica konnte nicht gelesen werden. HTTP-Status: 0 URL:
 * https://de.wiki-aventurica.de/de/api.php?format=json&formatversion=2&action=query&titles=Ila…".
 * 164 der 212 Zeichen waren die URL -- fuer den Leser Rauschen; und der eigentliche Grund
 * („Verbindung abgewiesen") stand nirgends, weil `@file_get_contents` ihn wegwirft.
 *
 * 🔴 DER SATZ IST OWNER-WORTLAUT (20.08.2026), nicht meiner:
 *   „Wiki Aventurica ist nicht erreichbar. Bitte später noch einmal versuchen.
 *    (Verbindung abgewiesen · <genaue Technik-Meldung>)"
 * Beides gehoert dazu -- die Kurzfassung fuer den Editor, die Technikmeldung fuer den Fehlerbericht.
 * Wer den Satz aendert, aendert Produktsprache; das ist eine Owner-Entscheidung.
 *
 * 💣 DIE URL DARF NICHT ZURUECKKOMMEN. Sie ist der Grund, aus dem die alte Meldung unlesbar war.
 * Sie steht weiter im Fehlerprotokoll (avesmapsWikiSyncLogServerError) -- nur nicht mehr im Toast.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require_once dirname(__DIR__) . '/sync.php';

$satz = 'Wiki Aventurica ist nicht erreichbar. Bitte später noch einmal versuchen.';
$url = 'https://de.wiki-aventurica.de/de/api.php?format=json&formatversion=2&action=query&titles=Ila';

// ---------------------------------------------------------------------------
// 1. Der gemessene Fall vom 20.08.2026: der Wirt weist die Verbindung ab.
// ---------------------------------------------------------------------------
$meldung = avesmapsWikiSyncUnreachableMessage(
    0,
    'file_get_contents(' . $url . '): Failed to open stream: Connection refused'
);

assert(
    $meldung === $satz . ' (Verbindung abgewiesen · Failed to open stream: Connection refused)',
    'Owner-Wortlaut, Kurzfassung und Technikmeldung -- gelesen: ' . $meldung
);
assert(
    !str_contains($meldung, 'http'),
    'die URL ist RAUS -- sie war 164 der 212 Zeichen der alten Meldung: ' . $meldung
);
assert(
    !str_contains($meldung, 'HTTP-Status: 0'),
    'kein blanker Statuscode mehr, der nichts erklaert: ' . $meldung
);

// ---------------------------------------------------------------------------
// 2. Die uebrigen Verbindungsfehler bekommen ihre eigene Kurzfassung -- ein Editor
//    soll „gesperrt" von „ueberlastet" von „Adresse kaputt" unterscheiden koennen.
// ---------------------------------------------------------------------------
$faelle = [
    ['Failed to open stream: Connection timed out', 'Zeitüberschreitung'],
    ['php_network_getaddresses: getaddrinfo failed: Name or service not known', 'Name nicht auflösbar'],
    ['Failed to enable crypto: SSL operation failed', 'Verschlüsselung gescheitert'],
    ['irgendetwas voellig anderes', 'Verbindung gescheitert'],
];
foreach ($faelle as [$roh, $erwartet]) {
    $m = avesmapsWikiSyncUnreachableMessage(0, 'file_get_contents(' . $url . '): ' . $roh);
    assert(
        str_starts_with($m, $satz . ' (' . $erwartet . ' · '),
        "Kurzfassung fuer [{$roh}] erwartet [{$erwartet}] -- gelesen: {$m}"
    );
    assert(str_contains($m, $roh), "die Technikmeldung reist wortgetreu mit: {$m}");
}

// ---------------------------------------------------------------------------
// 3. Ohne Warnung, aber mit Status: dann IST der Status die Technikmeldung.
//    ⚠️ Diesen Zweig nimmt eine Sperrseite -- eine Antwort ist da, aber unbrauchbar.
// ---------------------------------------------------------------------------
$m = avesmapsWikiSyncUnreachableMessage(503, '');
assert(
    $m === $satz . ' (Wiki vorübergehend nicht verfügbar · HTTP-Status 503)',
    'Status ohne Warnung -- gelesen: ' . $m
);
assert(
    avesmapsWikiSyncUnreachableMessage(429, '') === $satz . ' (Zu viele Anfragen · HTTP-Status 429)',
    '429 heisst: WIR waren zu schnell, und genau das soll dastehen'
);
assert(
    avesmapsWikiSyncUnreachableMessage(403, '') === $satz . ' (Unerwartete Antwort · HTTP-Status 403)',
    '403 -- gelesen: ' . avesmapsWikiSyncUnreachableMessage(403, '')
);

// ---------------------------------------------------------------------------
// 4. Gar nichts gemessen: trotzdem ein ganzer Satz, nie eine leere Klammer.
// ---------------------------------------------------------------------------
$m = avesmapsWikiSyncUnreachableMessage(0, '');
assert(
    $m === $satz . ' (Verbindung gescheitert · Grund unbekannt)',
    'ohne jede Messung bleibt der Satz vollstaendig -- gelesen: ' . $m
);

// ---------------------------------------------------------------------------
// 5. Ein sehr langer Rohtext sprengt den Toast nicht.
// ---------------------------------------------------------------------------
$lang = avesmapsWikiSyncUnreachableMessage(0, 'file_get_contents(x): ' . str_repeat('A', 900));
assert(strlen($lang) < 340, 'die Meldung bleibt lesbar kurz -- gemessen: ' . strlen($lang));

// ---------------------------------------------------------------------------
// 6. Der eigene Fehlertyp -- er ist der Griff, an dem die Endpunkte ihn fangen.
// ---------------------------------------------------------------------------
assert(
    class_exists('AvesmapsWikiUnreachableException'),
    'der eigene Fehlertyp existiert -- ohne ihn kann kein Endpunkt ihn gezielt fangen'
);
assert(
    is_subclass_of('AvesmapsWikiUnreachableException', 'RuntimeException'),
    'er ERBT von RuntimeException -- deshalb muss er VOR dem RuntimeException-Zweig gefangen '
    . 'werden, sonst schluckt jener ihn und die Kurzfassung geht als 400/invalid_request raus'
);

// ---------------------------------------------------------------------------
// 7. Jeder Endpunkt, der das Wiki anrufen kann, faengt ihn -- und zwar VOR RuntimeException.
//    💣 Ohne diesen Zweig antwortet der Endpunkt weiter mit „Internal server error." (Fall #84).
// ---------------------------------------------------------------------------
$apiRoot = dirname(__DIR__, 3);
// ⚠️ `publication-art-survey.php` steht bewusst NICHT hier: seine require-Kette erreicht
// wiki/sync.php nicht, es kann die Ausnahme also gar nicht werfen. Ein Fangzweig dort waere tot --
// und ein `require` nur einzubauen, damit ein Fang etwas zu fangen haette, ist die falsche Richtung.
$endpunkte = [
    'settlements.php', 'paths.php', 'citymaps.php', 'game-literature.php',
    'regions.php', 'sync-monitor.php', 'sync-plan.php', 'dump.php',
];
foreach ($endpunkte as $dateiname) {
    $datei = $apiRoot . '/edit/wiki/' . $dateiname;
    $quelltext = (string) file_get_contents($datei);
    assert($quelltext !== '', "der Endpunkt ist lesbar: {$dateiname}");

    // Nur die AEUSSERE Kette zaehlt (dump.php & Co. haben innen best-effort-Faenger).
    preg_match_all('/^\} catch \(([^)]+)\)/m', $quelltext, $treffer);
    $typen = $treffer[1] ?? [];

    $eigener = -1;
    $laufzeit = -1;
    $alles = -1;
    foreach ($typen as $index => $typ) {
        if (str_contains($typ, 'AvesmapsWikiUnreachableException')) {
            $eigener = $index;
        }
        if (str_starts_with(trim($typ), 'RuntimeException')) {
            $laufzeit = $index;
        }
        if (str_starts_with(trim($typ), 'Throwable')) {
            $alles = $index;
        }
    }

    assert(
        $eigener >= 0,
        "{$dateiname}: faengt AvesmapsWikiUnreachableException -- sonst liest der Editor dort "
        . 'weiter den Satz [Internal server error.] (Fall #84)'
    );
    assert($alles > $eigener, "{$dateiname}: der eigene Zweig steht VOR dem Throwable-Zweig");
    if ($laufzeit >= 0) {
        assert(
            $eigener < $laufzeit,
            "{$dateiname}: AvesmapsWikiUnreachableException ERBT von RuntimeException und muss "
            . 'deshalb ZUERST stehen -- sonst ist der Zweig tot und niemand merkt es'
        );
    }

    echo "OK  {$dateiname}: nennt [nicht erreichbar] beim Namen\n";
}

// ---------------------------------------------------------------------------
// 8. 💣 EIN FANG IST NUR ETWAS WERT, WENN DIE KLASSE DORT AUCH GELADEN IST.
//    Es gibt keinen Autoloader; wer wiki/sync.php nicht (auch mittelbar) einbindet, hat einen
//    Zweig, der nie zuschlaegt -- und PHP sagt dazu nichts, ein `catch` auf eine unbekannte Klasse
//    ist kein Fehler, es passt nur nie. Beim Bau am 20.08.2026 traf das auf einen der neun
//    Kandidaten zu; gefunden hat es diese Pruefung, nicht der Fangketten-Test darueber.
// ---------------------------------------------------------------------------
$requireKette = static function (string $datei, array $gesehen = []) use (&$requireKette): array {
    $datei = str_replace('\\', '/', $datei);
    if (isset($gesehen[$datei]) || !is_file($datei)) {
        return $gesehen;
    }
    $gesehen[$datei] = true;
    $quelltext = (string) file_get_contents($datei);
    preg_match_all('/require(?:_once)?\s+__DIR__\s*\.\s*.([^\';"]+)/', $quelltext, $treffer);
    foreach (($treffer[1] ?? []) as $rel) {
        $pfad = realpath(dirname($datei) . '/' . ltrim($rel, '/'));
        if ($pfad !== false) {
            $gesehen = $requireKette(str_replace('\\', '/', $pfad), $gesehen);
        }
    }
    return $gesehen;
};

foreach ($endpunkte as $dateiname) {
    $kette = $requireKette($apiRoot . '/edit/wiki/' . $dateiname);
    $traegtSync = false;
    foreach (array_keys($kette) as $pfad) {
        if (str_ends_with($pfad, '/_internal/wiki/sync.php')) {
            $traegtSync = true;
        }
    }
    assert(
        $traegtSync,
        "{$dateiname}: bindet wiki/sync.php ein -- ohne die Klassendefinition faengt der Zweig "
        . 'NIE etwas, und niemand merkt es (kein Autoloader im Haus)'
    );
}

echo "OK  alle acht laden wiki/sync.php -- kein toter Fangzweig.\n";
echo "OK  Fall #84: die Absage ist ein Satz, den ein Editor lesen kann.\n";
