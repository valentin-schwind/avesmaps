<?php

declare(strict_types=1);

// TEMPORAERE MESSUNG (24.08.2026) fuer den Entwurf der aufgeschobenen Discord-Antwort.
// Runde 1 hat ergeben: SAPI ist cgi-fcgi, `fastcgi_finish_request` fehlt, und frueh
// abschliessen traegt nicht (gemessen 3,07 s statt 0,2 s). Damit bleibt nur die Variante
// mit ZWEI Aufrufen. Runde 2 misst deren zwei tragende Zahlen:
//   ?mode=selfcall -> was kostet ein HTTPS-Selbstaufruf, und ueberlebt der Gerufene den
//                     Abbruch des Rufers? (ruft mode=worker mit kurzem Zeitlimit an)
//   ?mode=check    -> hat der Worker seine Spur trotz Abbruch geschrieben?
// Diese Datei wird nach der Messung wieder entfernt.

require __DIR__ . '/../_internal/bootstrap.php';
require __DIR__ . '/../_internal/discord/app-auth.php';

$spur = sys_get_temp_dir() . '/avesmaps-defer-probe.txt';
$mode = (string) ($_GET['mode'] ?? 'info');

// Der Worker laeuft ohne Token: er traegt ein Einmal-Geheimnis in der Adresse und
// schreibt nur eine Zeitmarke in den Temp-Ordner. Er darf NICHT am Token haengen,
// weil genau das der Punkt der Messung ist -- laeuft er weiter, wenn keiner zuhoert?
if ($mode === 'worker') {
    ignore_user_abort(true);
    $start = microtime(true);
    usleep(2_000_000);
    @file_put_contents($spur, json_encode([
        'geschrieben_um' => date('H:i:s'),
        'gelaufen_s' => round(microtime(true) - $start, 3),
    ]));
    exit;
}

header('Content-Type: application/json');

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
} catch (Throwable) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'configuration unavailable']);
    exit;
}
$discord = is_array($config['discord'] ?? null) ? $config['discord'] : [];

$provided = (string) ($_SERVER['HTTP_X_AVESMAPS_TOKEN'] ?? ($_GET['token'] ?? ''));
if (!avesmapsDiscordCheckAppToken((string) ($discord['app_token'] ?? ''), $provided)) {
    http_response_code(401);
    echo json_encode(['ok' => false, 'error' => 'unauthorized']);
    exit;
}

if ($mode === 'check') {
    echo json_encode([
        'ok' => true,
        'spur_vorhanden' => is_file($spur),
        'spur' => is_file($spur) ? json_decode((string) @file_get_contents($spur), true) : null,
        'jetzt' => date('H:i:s'),
    ]);
    exit;
}

if ($mode === 'selfcall') {
    @unlink($spur);

    // So wuerde der Bot den Worker anstossen: absichtlich abbrechen, sobald der Aufruf
    // draussen ist. CURLOPT_TIMEOUT_MS ist das Zeitlimit fuer den GANZEN Aufruf.
    $url = 'https://' . ($_SERVER['HTTP_HOST'] ?? 'avesmaps.de') . '/api/discord/sapi-probe.php?mode=worker';
    $start = microtime(true);
    $handle = curl_init($url);
    curl_setopt_array($handle, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT_MS => 300,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);
    curl_exec($handle);
    $fehler = curl_errno($handle);
    curl_close($handle);

    echo json_encode([
        'ok' => true,
        'anstoss_dauer_s' => round(microtime(true) - $start, 3),
        'curl_errno' => $fehler,
        'curl_bedeutung' => $fehler === CURLE_OPERATION_TIMEDOUT ? 'abgebrochen wie geplant' : 'anders',
    ]);
    exit;
}

echo json_encode([
    'ok' => true,
    'sapi' => PHP_SAPI,
    'has_fastcgi_finish_request' => function_exists('fastcgi_finish_request'),
    'mode' => $mode,
]);
