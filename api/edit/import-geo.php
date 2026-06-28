<?php

declare(strict_types=1);

// Resumable, edit-gated importer for the DB-IP IP-to-City Lite CSV into visitor_geo_range.
// phpMyAdmin can't convert raw IP strings to our VARBINARY(16) keys, so the conversion +
// run-length merge happens here. State (file offset + currently-open merged range) is held by
// the browser driver and threaded through each request, so the server stays stateless.
//
// Setup: download dbip-city-lite-YYYY-MM.csv.gz from db-ip.com, decompress it, and upload the
// plain CSV to uploads/dbip-city-lite.csv via FTP. Then open this page in the editor and click
// "Import starten". Delete the CSV afterwards. License: DB-IP, CC BY 4.0 (attribution required).

require __DIR__ . '/../_internal/bootstrap.php';
require __DIR__ . '/../_internal/auth.php';
require __DIR__ . '/../_internal/analytics/visitor-analytics.php';

$config = avesmapsLoadApiConfig(avesmapsApiRoot());
avesmapsApplyCorsPolicy($config);
avesmapsRequireUserWithCapability('edit');

$csvPath = __DIR__ . '/../../uploads/dbip-city-lite.csv';
$batchLines = 40000;
$v4Prefix = '00000000000000000000FFFF';

$deRegions = [
    'bavaria' => 'Bayern', 'bayern' => 'Bayern',
    'baden-wurttemberg' => 'Baden-Württemberg', 'baden-württemberg' => 'Baden-Württemberg',
    'berlin' => 'Berlin', 'state of berlin' => 'Berlin',
    'brandenburg' => 'Brandenburg',
    'bremen' => 'Bremen', 'city state bremen' => 'Bremen', 'free hanseatic city of bremen' => 'Bremen', 'free and hanseatic city of bremen' => 'Bremen',
    'hamburg' => 'Hamburg', 'free and hanseatic city of hamburg' => 'Hamburg',
    'hesse' => 'Hessen', 'hessen' => 'Hessen',
    'mecklenburg-vorpommern' => 'Mecklenburg-Vorpommern', 'mecklenburg-western pomerania' => 'Mecklenburg-Vorpommern',
    'lower saxony' => 'Niedersachsen', 'niedersachsen' => 'Niedersachsen',
    'north rhine-westphalia' => 'Nordrhein-Westfalen', 'nordrhein-westfalen' => 'Nordrhein-Westfalen',
    'rhineland-palatinate' => 'Rheinland-Pfalz', 'rheinland-pfalz' => 'Rheinland-Pfalz',
    'saarland' => 'Saarland',
    'saxony' => 'Sachsen', 'sachsen' => 'Sachsen',
    'saxony-anhalt' => 'Sachsen-Anhalt', 'sachsen-anhalt' => 'Sachsen-Anhalt',
    'schleswig-holstein' => 'Schleswig-Holstein',
    'thuringia' => 'Thüringen', 'thuringen' => 'Thüringen', 'thüringen' => 'Thüringen',
];

$action = (string) ($_GET['action'] ?? '');

if ($action === 'reset') {
    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsVisitorEnsureGeoTable($pdo);
    $pdo->exec('TRUNCATE TABLE visitor_geo_range');
    avesmapsJsonResponse(200, ['ok' => true, 'reset' => true]);
}

if ($action === 'batch') {
    if (!is_readable($csvPath)) {
        avesmapsErrorResponse(400, 'no_file', 'CSV not found at uploads/dbip-city-lite.csv');
    }
    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsVisitorEnsureGeoTable($pdo);

    $offset = (int) ($_GET['offset'] ?? 0);
    $open = null;
    if ((string) ($_GET['os'] ?? '') !== '') {
        $open = ['s' => (string) $_GET['os'], 'e' => (string) $_GET['oe'], 'c' => (string) $_GET['oc'], 'r' => (string) $_GET['or']];
    }

    $handle = fopen($csvPath, 'rb');
    $fileSize = filesize($csvPath);
    fseek($handle, $offset);

    $isV4 = static function (string $hex) use ($v4Prefix): bool {
        return substr($hex, 0, 24) === $v4Prefix;
    };

    $batch = [];
    $lines = 0;
    while (($line = fgets($handle)) !== false) {
        $cols = str_getcsv($line);
        if (count($cols) >= 5) {
            $startKey = avesmapsVisitorIpKey(trim((string) $cols[0]));
            $endKey = avesmapsVisitorIpKey(trim((string) $cols[1]));
            $country = strtoupper(substr(trim((string) $cols[3]), 0, 2));
            if ($startKey !== null && $endKey !== null && $country !== '' && $country !== 'ZZ' && preg_match('/^[A-Z]{2}$/', $country)) {
                $region = '';
                if ($country === 'DE') {
                    $stateProv = strtolower(trim((string) $cols[4], " \t\"'"));
                    $region = $deRegions[$stateProv] ?? '';
                }
                $startHex = strtoupper(bin2hex($startKey));
                $endHex = strtoupper(bin2hex($endKey));
                if ($open !== null && $open['c'] === $country && $open['r'] === $region && $isV4($open['s']) === $isV4($startHex)) {
                    $open['e'] = $endHex;
                } else {
                    if ($open !== null) {
                        $batch[] = $open;
                    }
                    $open = ['s' => $startHex, 'e' => $endHex, 'c' => $country, 'r' => $region];
                }
            }
        }
        $lines++;
        if ($lines >= $batchLines) {
            break;
        }
    }
    $newOffset = ftell($handle);
    $done = feof($handle);
    if ($done && $open !== null) {
        $batch[] = $open;
        $open = null;
    }
    fclose($handle);

    foreach (array_chunk($batch, 500) as $chunk) {
        $placeholders = implode(',', array_fill(0, count($chunk), '(UNHEX(?),UNHEX(?),?,?)'));
        $statement = $pdo->prepare('INSERT IGNORE INTO visitor_geo_range (ip_start, ip_end, country, region) VALUES ' . $placeholders);
        $values = [];
        foreach ($chunk as $range) {
            $values[] = $range['s'];
            $values[] = $range['e'];
            $values[] = $range['c'];
            $values[] = $range['r'];
        }
        $statement->execute($values);
    }

    avesmapsJsonResponse(200, [
        'ok' => true,
        'offset' => $newOffset,
        'fileSize' => $fileSize,
        'done' => $done,
        'inserted' => count($batch),
        'os' => $open['s'] ?? '',
        'oe' => $open['e'] ?? '',
        'oc' => $open['c'] ?? '',
        'or' => $open['r'] ?? '',
    ]);
}

header('Content-Type: text/html; charset=utf-8');
?><!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Geo-Daten-Import</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;max-width:640px;margin:2rem auto;padding:0 1rem;color:#2f251c;line-height:1.5}
code{background:#f1e4d7;padding:1px 5px;border-radius:4px}
button{font:inherit;padding:8px 16px;border:1px solid #b79d7d;border-radius:8px;background:#f7efe4;cursor:pointer;margin-right:8px}
button:hover{background:#ecdcc9}
.bar{height:18px;background:#efe6d9;border-radius:9px;overflow:hidden;margin:14px 0}
.fill{height:100%;background:#2a78d6;width:0%;transition:width .2s}
#log{font-family:ui-monospace,monospace;font-size:12px;white-space:pre-wrap;background:#faf3ec;border:1px solid #e7d8c6;padding:10px;border-radius:8px;max-height:220px;overflow:auto;margin-top:12px}
</style></head><body>
<h1>Geo-Daten-Import</h1>
<p>Liest <code>uploads/dbip-city-lite.csv</code>, wandelt die IP-Bereiche um und füllt <code>visitor_geo_range</code>. Lass den Tab offen, bis „fertig" steht.</p>
<p><button id="start">Import starten</button><button id="reset">Tabelle leeren</button></p>
<div class="bar"><div class="fill" id="fill"></div></div>
<p id="status">bereit</p>
<div id="log"></div>
<script>
var byId=function(i){return document.getElementById(i)};
function log(m){var l=byId('log');l.textContent+=m+'\n';l.scrollTop=1e9}
var running=false;
function batch(s){
  var q='?action=batch&offset='+s.offset+'&os='+s.os+'&oe='+s.oe+'&oc='+encodeURIComponent(s.oc)+'&or='+encodeURIComponent(s.or);
  return fetch(q,{credentials:'same-origin'}).then(function(r){return r.json()});
}
function run(){
  if(running)return;running=true;byId('start').disabled=true;
  var s={offset:0,os:'',oe:'',oc:'',or:''},total=0;
  log('Start ...');
  (function step(){
    if(!running)return;
    batch(s).then(function(d){
      if(!d||!d.ok){log('Fehler: '+(d&&d.error&&d.error.message||JSON.stringify(d)));running=false;byId('start').disabled=false;return}
      s={offset:d.offset,os:d.os,oe:d.oe,oc:d.oc,or:d.or};total+=d.inserted;
      var pct=d.fileSize?Math.round(d.offset/d.fileSize*100):0;
      byId('fill').style.width=pct+'%';byId('status').textContent=pct+'% · '+total.toLocaleString('de-DE')+' Bereiche';
      if(d.done){log('Fertig: '+total.toLocaleString('de-DE')+' Bereiche importiert. Du kannst die CSV jetzt löschen.');byId('status').textContent='fertig ('+total.toLocaleString('de-DE')+' Bereiche)';running=false;byId('start').disabled=false;return}
      setTimeout(step,0);
    });
  })();
}
byId('start').onclick=run;
byId('reset').onclick=function(){
  if(!confirm('visitor_geo_range komplett leeren?'))return;
  fetch('?action=reset',{credentials:'same-origin'}).then(function(){log('Tabelle geleert.');byId('fill').style.width='0%';byId('status').textContent='geleert'});
};
</script>
</body></html>
