<?php

declare(strict_types=1);

/**
 * Befund A29: sitzt ein Zwischenserver davor? Die Diagnose dazu.
 *
 * 🔴 ZWEI EIGENSCHAFTEN, UND DIE ZWEITE IST DIE WICHTIGERE:
 *   1. Sie beantwortet die Frage -- ohne Zwischenserver anders als mit.
 *   2. Sie gibt NIE eine Adresse heraus. Eine Diagnose, die zur Beantwortung einer
 *      Datenschutzfrage IP-Adressen ausgibt, hat die Frage nicht verstanden. Die ganze Antwort
 *      wird deshalb rekursiv nach etwas durchsucht, das eine IP sein koennte.
 *
 * ⚠️ `client_key_source` wird NICHT nachgerechnet, sondern aus dem echten avesmapsClientIpAddress()
 * abgeleitet -- also faellt hier auf, wenn die Diagnose und die Drosseln auseinanderlaufen.
 *
 * Ausfuehren:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       api/_internal/diagnostics/__tests__/proxy-signals-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op.\n");
    exit(2);
}

require __DIR__ . '/../../bootstrap.php';
require __DIR__ . '/../proxy-signals.php';

function avesmapsProbeSignals(array $server): array {
    $_SERVER = $server;
    return avesmapsProxySignals();
}

// 💣 Die Zusicherung, die alles andere traegt: nirgends in der Antwort steht etwas, das eine
// Adresse sein koennte -- weder als Wert, noch in einer Liste, noch in einem Text.
function avesmapsAssertNoAddressLeaked(array $answer, string $case): void {
    array_walk_recursive($answer, static function ($value, $key) use ($case): void {
        if (is_bool($value) || is_int($value)) {
            return;
        }
        $text = (string) $value;
        assert(
            filter_var($text, FILTER_VALIDATE_IP) === false,
            "{$case}: der Wert unter '{$key}' ist eine IP-Adresse -- diese Antwort darf keine enthalten"
        );
        // Auch nicht eingebettet in einen laengeren Text.
        assert(
            preg_match('/\b\d{1,3}(?:\.\d{1,3}){3}\b/', $text) !== 1,
            "{$case}: unter '{$key}' steckt eine IPv4-Adresse in einem Text"
        );
        assert(
            preg_match('/\b(?:[0-9a-f]{1,4}:){3,}[0-9a-f]{1,4}\b/i', $text) !== 1,
            "{$case}: unter '{$key}' steckt eine IPv6-Adresse in einem Text"
        );
    });
}

// ---- Fall 1: kein Zwischenserver -------------------------------------------------------------------

$ohne = avesmapsProbeSignals(['REMOTE_ADDR' => '203.0.113.7']);
avesmapsAssertNoAddressLeaked($ohne, 'ohne Proxy');

assert($ohne['forwarded_header_present'] === false, 'ohne Proxy kommt kein Weiterreich-Kopf an');
assert($ohne['forwarded_entry_count'] === 0, 'und keine Station');
assert($ohne['proxy_evidence_headers'] === [], 'und kein Beweis-Kopf');
assert($ohne['remote_addr_is_valid_ip'] === true, 'REMOTE_ADDR ist eine Adresse');
// 🔴 Das ist die Antwort, auf die es ankommt: die Drossel buendelt nach REMOTE_ADDR, also ist die
// Umstellung darauf richtig -- und die andere Reparatur waere die teure.
assert($ohne['client_key_source'] === 'remote_addr', 'die Drossel nimmt REMOTE_ADDR');

// ---- Fall 2: ein Zwischenserver reicht weiter ------------------------------------------------------

$mit = avesmapsProbeSignals([
    'REMOTE_ADDR' => '10.0.0.5',
    'HTTP_X_FORWARDED_FOR' => '198.51.100.23',
    'HTTP_VIA' => '1.1 proxy.example',
]);
avesmapsAssertNoAddressLeaked($mit, 'mit Proxy');

assert($mit['forwarded_header_present'] === true, 'mit Proxy kommt der Kopf an');
assert($mit['forwarded_entry_count'] === 1, 'eine Station');
assert($mit['remote_addr_differs_from_forwarded'] === true, 'und REMOTE_ADDR ist ein anderer -- er selbst');
assert($mit['proxy_evidence_headers'] === ['Via'], 'der Beweis-Kopf wird beim NAMEN genannt');
// 🔴 SEIT DEM 06.08.2026 NIMMT DIE DROSSEL AUCH HIER REMOTE_ADDR -- der Kopf wird nicht mehr
// gelesen (A29, zweite Haelfte). Diese Zusicherung sagte bis dahin `forwarded`, und sie hat sich
// mitgeaendert, OHNE dass jemand die Diagnose angefasst hat: `client_key_source` wird aus dem echten
// avesmapsClientIpAddress() abgeleitet. Genau dafuer ist die Ableitung da.
//
// ⚠️ Und das ist zugleich die WARNUNG, die die Diagnose weiter aussprechen muss: kaeme ein
// Zwischenserver, wuerden hier alle Besucher denselben Schluessel bekommen. Die Felder darueber --
// `forwarded_header_present` und `proxy_evidence_headers` -- sind das, was diesen Fall anzeigt,
// nicht mehr `client_key_source`.
assert($mit['client_key_source'] === 'remote_addr', 'der Kopf wird nicht mehr geglaubt, auch nicht mit Via');
assert($mit['forwarded_header_present'] === true, 'die Diagnose meldet ihn trotzdem -- sie misst, sie urteilt nicht');

// ---- Fall 3: eine Kette --------------------------------------------------------------------------

$kette = avesmapsProbeSignals([
    'REMOTE_ADDR' => '10.0.0.5',
    'HTTP_X_FORWARDED_FOR' => '198.51.100.23, 203.0.113.9, 10.0.0.4',
]);
avesmapsAssertNoAddressLeaked($kette, 'Kette');
assert($kette['forwarded_entry_count'] === 3, 'drei Stationen werden GEZAEHLT, nicht genannt');
assert($kette['forwarded_entries_all_valid_ips'] === true, 'und alle drei sind Adressen');

// ---- Fall 4: Muell im Kopf -------------------------------------------------------------------------
//
// 💣 Genau das war die andere Haelfte von A29 (behoben in 864fe864): ein Aufrufer schickte
// beliebigen Text und bekam damit seinen eigenen Drossel-Eimer. Die Diagnose muss zeigen, dass das
// nicht mehr wirkt -- der Schluessel faellt auf REMOTE_ADDR zurueck.
$muell = avesmapsProbeSignals([
    'REMOTE_ADDR' => '203.0.113.7',
    'HTTP_X_FORWARDED_FOR' => 'nicht-eine-ip',
]);
avesmapsAssertNoAddressLeaked($muell, 'Muell');
assert($muell['forwarded_header_present'] === true, 'der Kopf kam an');
assert($muell['forwarded_entries_all_valid_ips'] === false, 'aber sein Inhalt ist keine Adresse');
assert($muell['client_key_source'] === 'remote_addr', 'und die Drossel glaubt ihm nicht');
assert($muell['remote_addr_differs_from_forwarded'] === false, 'ohne gueltiges Element gibt es nichts zu vergleichen');

// ---- Fall 5: gar nichts ---------------------------------------------------------------------------

$nichts = avesmapsProbeSignals([]);
avesmapsAssertNoAddressLeaked($nichts, 'leer');
assert($nichts['remote_addr_present'] === false, 'ohne REMOTE_ADDR');
assert($nichts['client_key_source'] === 'none', 'hat die Drossel keinen Schluessel -- alle in einem Eimer');

// ---- Fall 6: 🔴 DER FALL, DER DIE NACHBILDUNG ENTLARVT ---------------------------------------------
//
// 💣 Diese Zusicherung gab es zuerst NICHT, und die Mutation „ersetze avesmapsClientIpAddress() durch
// eine eigene Verzweigung" ging deshalb GRUEN durch -- also genau die Drift, gegen die der Kommentar
// im Kopf der Bibliothek argumentiert. Ohne einen Fall, in dem sich beide UNTERSCHEIDEN, ist die
// Aussage „sie rechnet die Regel nicht nach" nur eine Behauptung.
//
// Hier laufen sie auseinander: ein REMOTE_ADDR, der keine Adresse IST. Der echte Schluesselbildner
// prueft ihn (`filter_var`) und antwortet mit einer LEEREN Zeichenkette -- bewusst, denn alle, deren
// Adresse sich nicht feststellen laesst, teilen sich EINEN Eimer, statt dass jeder seinen eigenen
// bekommt. Die naheliegende Nachbildung `$validEntries[0] ?? $remoteAddress` reicht den Muell durch
// und meldete 'remote_addr'.
$unbrauchbar = avesmapsProbeSignals(['REMOTE_ADDR' => 'kein-wert']);
avesmapsAssertNoAddressLeaked($unbrauchbar, 'unbrauchbarer REMOTE_ADDR');
assert($unbrauchbar['remote_addr_present'] === true, 'es steht etwas drin');
assert($unbrauchbar['remote_addr_is_valid_ip'] === false, 'aber es ist keine Adresse');
assert(
    $unbrauchbar['client_key_source'] === 'none',
    'und dann hat die Drossel keinen Schluessel -- wer hier "remote_addr" meldet, hat den echten '
        . 'Schluesselbildner nicht gefragt, sondern nachgebaut'
);

// ---- Die Einschraenkung reist mit ------------------------------------------------------------------
//
// 💣 Wer diesen Endpunkt mit einem SELBST gesetzten X-Forwarded-For aufruft, misst sich selbst. Das
// steht in der Antwort, nicht nur in einer Doku, die niemand daneben offen hat.
assert(str_contains((string) $ohne['caveat'], 'X-Forwarded-For'), 'die Antwort nennt ihre eigene Einschraenkung');

// ---- Und der Endpunkt muss sie wirklich verwenden --------------------------------------------------

$endpointSource = file_get_contents(__DIR__ . '/../../../edit/admin/proxy-check.php');
assert(is_string($endpointSource) && $endpointSource !== '', 'der Endpunkt ist lesbar');
assert(str_contains($endpointSource, 'avesmapsProxySignals()'), 'er ruft die Regel');
// 💣 `admin`, nicht `edit`: die Antwort beschreibt die Netz-Topologie des Servers.
assert(
    str_contains($endpointSource, "avesmapsRequireUserWithCapability('admin')"),
    'und liegt hinter der admin-Faehigkeit'
);
// 🔴 Der Riegel VOR der Auswertung. Andersherum stuende die Antwort schon, bevor gefragt wird, wer da
// klopft -- und ein spaeter Riegel ist genau die Bauart, die A31 als Befund hatte.
$riegelBei = strpos($endpointSource, "avesmapsRequireUserWithCapability('admin')");
$antwortBei = strpos($endpointSource, 'avesmapsProxySignals()');
assert(is_int($riegelBei) && is_int($antwortBei) && $riegelBei < $antwortBei, 'der Riegel steht vor der Auswertung');

// 💣 UND VOR DER METHODENPRUEFUNG. Stand zuerst andersherum, und die Live-Probe zeigte es: ein
// anonymer POST antwortete **405** statt 401 und verriet damit, dass es diesen Endpunkt gibt und
// dass er GET nimmt. Dasselbe Haus hat die Reihenfolge schon einmal entschieden -- bei der
// Import-Tuer steht die Token-Pruefung vor der Methodenpruefung, „fuer einen Unbefugten ist das die
// bessere Antwort" (A33). Diese Zusicherung haelt sie fest, damit sie nicht wieder zurueckrutscht.
$methodeBei = strpos($endpointSource, "\$requestMethod !== 'GET'");
assert(is_int($methodeBei), 'die Methodenpruefung steht in der Datei');
assert($riegelBei < $methodeBei, 'ein Unbefugter bekommt 401, nicht 405 -- die Methode verraet er ihm nicht');
// ⚠️ OPTIONS ist die EINZIGE Ausnahme und muss davor bleiben: eine CORS-Vorabfrage traegt keine
// Anmeldedaten und darf keine verlangen.
$optionsBei = strpos($endpointSource, "\$requestMethod === 'OPTIONS'");
assert(is_int($optionsBei) && $optionsBei < $riegelBei, 'OPTIONS bleibt vor dem Riegel');
// ⚠️ Rein lesend, und das soll so bleiben: keine Datenbank, kein Schreiben, kein Protokoll.
foreach (['avesmapsCreatePdo', 'INSERT', 'UPDATE', 'error_log'] as $verboten) {
    assert(!str_contains($endpointSource, $verboten), "der Endpunkt bleibt rein lesend -- kein {$verboten}");
}

echo "proxy-signals ok\n";
