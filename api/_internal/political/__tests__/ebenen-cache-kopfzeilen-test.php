<?php

declare(strict_types=1);

// Die Cache-Kopfzeilen der politischen Ebene.
//
// 💣 DIE ANTWORT VERLAESST territories-endpoint.php AN DREI STELLEN: dem Schnellpfad vor dem PDO,
// dem zweiten Cache-Treffer dahinter und dem frischen Aufbau. Eine Regel, die einen von drei
// Erzeugern bindet, ist keine Regel -- dieselbe Lehre wie bei der Verkehrsmittel-Sperre
// (vier Erzeuger, Sperre in zweien) und beim Aufraeumen der Geometrien (drei Loeschwege, zwei
// gebunden). Deshalb prueft dieser Test nicht "die Kopfzeile kommt vor", sondern dass JEDE der drei
// Ausgabestellen sie setzt.
//
// 🪤 Und er liest den Quelltext OHNE Kommentare. Sonst schlaegt er an dem Kommentar an, der vor der
// Falle warnt -- und der naechste Leser loescht den Kommentar, um den Test gruen zu bekommen.
//
// Aus der Wurzel des Repos:
//   php -d extension=php_mbstring.dll api/_internal/political/__tests__/ebenen-cache-kopfzeilen-test.php

require_once __DIR__ . '/../territories-derived-layer.php';

$fehler = 0;
function pruefe(bool $ok, string $was): void {
    global $fehler;
    if (!$ok) { $fehler++; fwrite(STDERR, "ROT: {$was}\n"); }
}

// --- Der Tag haengt an den ausgelieferten Bytes -------------------------------------------------
$tagA = avesmapsPoliticalLayerETag('{"ok":true,"features":[]}');
$tagB = avesmapsPoliticalLayerETag('{"ok":true,"features":[1]}');
pruefe($tagA !== $tagB, 'anderer Rumpf -> anderer Tag');
pruefe($tagA === avesmapsPoliticalLayerETag('{"ok":true,"features":[]}'), 'gleicher Rumpf -> gleicher Tag');
pruefe(str_starts_with($tagA, 'W/"ptl-'), 'der Tag ist als schwacher Tag dieser Ebene erkennbar');
// Die Laenge steckt mit drin: zwei Ruempfe gleicher Laenge duerfen sich nur im Hash unterscheiden.
pruefe(str_contains($tagA, '-' . strlen('{"ok":true,"features":[]}') . '-'), 'die Rumpflaenge steht im Tag');

// --- Die Restlaufzeit, nicht die volle Frist ----------------------------------------------------
// 💣 Ohne diese Rechnung ADDIEREN sich Server- und Browserfrist: eine 299 s alte Cachedatei mit
// max-age=300 auszuliefern hiesse 599 s Gesamtveraltung, wo der Server 300 zusichert.
pruefe(avesmapsPoliticalLayerBrowserMaxAge([], null) === 300, 'frisch gebaut (Ansicht) -> volle 300 s');
pruefe(avesmapsPoliticalLayerBrowserMaxAge(['edit_mode' => '1'], null) === 15, 'frisch gebaut (Editor) -> 15 s');
pruefe(avesmapsPoliticalLayerBrowserMaxAge([], time() - 100) === 200, '100 s alte Datei -> 200 s Rest');
pruefe(avesmapsPoliticalLayerBrowserMaxAge([], time() - 299) === 1, '299 s alte Datei -> 1 s Rest');
// Nie negativ, und eine Datei aus der Zukunft (Uhr verstellt) darf die Frist nicht verlaengern.
pruefe(avesmapsPoliticalLayerBrowserMaxAge([], time() - 5000) === 0, 'abgelaufene Datei -> 0, nie negativ');
pruefe(avesmapsPoliticalLayerBrowserMaxAge([], time() + 5000) === 300, 'Datei aus der Zukunft -> hoechstens die volle Frist');

// --- ALLE DREI Ausgabestellen setzen die Kopfzeilen ---------------------------------------------
$quelle = (string) file_get_contents(__DIR__ . '/../territories-endpoint.php');
// 🪤 Kommentare raus, bevor gezaehlt wird (mehrzeilig und einzeilig).
$ohneKommentare = preg_replace('#/\*.*?\*/#s', '', $quelle);
$ohneKommentare = preg_replace('#^\s*//.*$#m', '', (string) $ohneKommentare);
$ohneKommentare = (string) $ohneKommentare;

// Jede Ausgabestelle traegt genau diesen Marker -- er ist die Stelle, an der Bytes hinausgehen.
$marker = "X-Avesmaps-Layer-Cache";
$stellen = [];
$pos = 0;
while (($pos = strpos($ohneKommentare, $marker, $pos)) !== false) { $stellen[] = $pos; $pos += 1; }
pruefe(count($stellen) === 3, 'es sind genau drei Ausgabestellen (gefunden: ' . count($stellen) . ')');

foreach ($stellen as $i => $stelle) {
    // Der Helfer muss VOR dem Marker stehen und naeher als die vorige Ausgabestelle.
    $fensterAnfang = $i === 0 ? 0 : $stellen[$i - 1];
    $fenster = substr($ohneKommentare, $fensterAnfang, $stelle - $fensterAnfang);
    pruefe(
        str_contains($fenster, 'avesmapsPoliticalSendLayerCacheHeaders('),
        'Ausgabestelle ' . ($i + 1) . ' setzt die Cache-Kopfzeilen'
    );
}

// --- Der Tag wird auch WIEDERGELESEN, sonst gibt es nie eine 304 --------------------------------
pruefe(
    substr_count($ohneKommentare, 'avesmapsETagMatches(') === 2,
    'die zwei Cache-Treffer beantworten If-None-Match mit 304 (der frische Aufbau kann keine haben)'
);
pruefe(
    substr_count($ohneKommentare, 'http_response_code(304)') === 2,
    'und beide senden wirklich eine 304'
);

// --- Der Fehlerpfad darf NICHT zwischenspeicherbar sein ------------------------------------------
// Ohne Cache-Control duerfte ein Browser eine Antwort heuristisch behalten -- hier eine, deren
// Kodierung gerade fehlgeschlagen ist.
pruefe(
    preg_match('#catch \(Throwable \$layerCacheError\) \{\s*header\(\'Cache-Control: no-store\'\);#', $ohneKommentare) === 1,
    'der Kodierungs-Fehlerpfad sendet no-store'
);

if ($fehler > 0) { fwrite(STDERR, "{$fehler} Zusicherung(en) verletzt\n"); exit(1); }
echo "OK: Cache-Kopfzeilen der politischen Ebene -- Tag, Restlaufzeit und alle drei Ausgabestellen.\n";
