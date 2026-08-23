<?php

declare(strict_types=1);

/**
 * Wer einer Flaeche ein Label gibt, schreibt BEIDE Seiten der Beziehung. Reine Funktionen, keine DB.
 * Lauf (aus der Repo-Wurzel):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       api/_internal/app/__tests__/ecosystem-label-zeiger-adoption-test.php
 * Exit 0 = alle Zusicherungen halten.
 *
 * 💣 DER FEHLER, DEN DAS BEHEBT (Owner 24.08.2026, am Livebestand gemessen). Die Beziehung
 * Flaeche <-> Label steht auf ZWEI Seiten (`ecosystem_region.label_public_id` und
 * `map_features.properties.ecosystem_region_public_id`), und beim Aufloesen schlaegt der Zeiger am
 * LABEL den an der Region -- ausdruecklich, siehe avesmapsEcosystemLabelRegionMap. Gesetzt wurde beim
 * Zuweisen aber nur die REGIONSSEITE. Eine Flaeche konnte damit ein Label benennen, das selbst
 * woanders hinzeigt: die Zuweisung wurde angenommen, gespeichert, angezeigt -- und blieb wirkungslos.
 *
 * Gemessen an „Schwarzkuppen": die neue Flaeche nannte ihr Label und zaehlte trotzdem NULL Labels,
 * waehrend die alte beide trug. Sichtbare Folgen: „Diese Flaeche traegt keine geladene Beschriftung"
 * im Flaechenmenue (der Ersatzweg fuer den Kurvenriegel lief ins Leere), und der Geschwister-Abgleich
 * benannte den Finsterkamm mit um, weil beide Labels an derselben Flaeche hingen.
 *
 * ⚠️ Die Wache daneben (avesmapsEcosystemLabelPointerToCheck) fragt „hat DIESE Region schon ein
 * Label?" -- nie „gehoert dieses Label schon woanders hin?". Sie greift deshalb genau dann nicht, wenn
 * eine frisch gezeichnete Flaeche sich ein fremdes Label nimmt. Das ist der Fall, der live eintrat.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos. "
        . "Neu starten mit: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../../bootstrap.php';
require __DIR__ . '/../ecosystem.php';

$L1 = '11111111-1111-4111-8111-111111111111';
$R_NEU = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
$R_ALT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// ---- WELCHES Label muss seinen Zeiger nachgezogen bekommen? ----------------------------------------

assert(avesmapsEcosystemLabelPointerToAdopt(['name' => 'Schwarzkuppen']) === '',
    'ein Speichern, das den Zeiger nicht anfasst, zieht nichts nach');

assert(avesmapsEcosystemLabelPointerToAdopt(['label_public_id' => null]) === '',
    '🔴 den Zeiger zu LOESEN ist kein Zuweisen -- das Label bleibt unangetastet');

assert(avesmapsEcosystemLabelPointerToAdopt(['label_public_id' => '']) === '',
    'und der leere Wert ebenso: er ist der Weg, ein Label bewusst freizugeben');

assert(avesmapsEcosystemLabelPointerToAdopt(['label_public_id' => $L1]) === $L1,
    'ein gesetzter Zeiger nennt das Label, dessen eigene Seite nachzuziehen ist');

assert(avesmapsEcosystemLabelPointerToAdopt(['label_public_id' => '  ' . $L1 . '  ']) === $L1,
    'gepolstert kommt derselbe Schluessel heraus -- er wird als Join-Key benutzt');

// ---- WAS wird an das Label geschrieben? ------------------------------------------------------------
//
// null heisst ausnahmslos „nichts zu tun". Das ist die Bremse, an der der Aufrufer entscheidet, ob er
// ueberhaupt eine Kartenrevision zieht: ein Region-Save, der nichts an der Karte aendert, darf sie
// nicht heben (der Kopf dieser Datei nennt die Regel).

$mitFremdemZeiger = json_encode(['ecosystem_region_public_id' => $R_ALT, 'size' => 20]);
$neu = avesmapsEcosystemLabelPropertiesWithRegion($mitFremdemZeiger, $R_NEU);
assert($neu !== null, '💣 DER KERNFALL: ein Label, das woanders hinzeigt, wird umgehaengt');
$entschluesselt = json_decode((string) $neu, true);
assert($entschluesselt['ecosystem_region_public_id'] === $R_NEU,
    'und zwar auf die Region, die es gerade zu ihrem Label erklaert hat');
assert($entschluesselt['size'] === 20,
    '⚠️ die uebrigen Eigenschaften bleiben stehen -- Groesse, Drehung und Zoom-Baender gehoeren dem Label');

assert(avesmapsEcosystemLabelPropertiesWithRegion(
    json_encode(['ecosystem_region_public_id' => $R_NEU]),
    $R_NEU
) === null, 'zeigt es schon richtig, ist nichts zu tun -- und keine Revision zu ziehen');

$ohneZeiger = avesmapsEcosystemLabelPropertiesWithRegion(json_encode(['size' => 15]), $R_NEU);
assert($ohneZeiger !== null, 'ein Bestandslabel ohne eigenen Zeiger bekommt einen');
assert(json_decode((string) $ohneZeiger, true)['ecosystem_region_public_id'] === $R_NEU,
    'so haengt es nicht laenger allein an der Regionsrichtung');

// 🪤 Eine leere oder kaputte Eigenschaftsspalte ist kein Grund aufzugeben: das Label existiert, und
// seine Zugehoerigkeit ist genau das, was hier geschrieben werden soll. Sie zu ueberspringen liesse
// denselben stillen Widerspruch zurueck, gegen den diese Funktion gebaut ist.
foreach ([null, '', 'kein json', '[]'] as $kaputt) {
    $geheilt = avesmapsEcosystemLabelPropertiesWithRegion($kaputt, $R_NEU);
    assert($geheilt !== null, 'auch aus ' . var_export($kaputt, true) . ' entsteht eine Zuordnung');
    assert(json_decode((string) $geheilt, true)['ecosystem_region_public_id'] === $R_NEU,
        'und sie nennt die richtige Region');
}

// 🔴 Ohne Zielregion wird NICHTS geschrieben. Ein leerer Wert hier hiesse „gehoert nirgends hin", und
// das ist eine Aussage, die dieser Weg nie treffen darf -- er ist der ZUWEISENDE.
assert(avesmapsEcosystemLabelPropertiesWithRegion($mitFremdemZeiger, '') === null,
    'ohne Region wird kein Zeiger geschrieben');

// ---- und die Regel wird auch GERUFEN ---------------------------------------------------------------
//
// 💣 Eine gruene reine Funktion beweist nichts, solange kein Schreibweg sie ruft -- und es sind ZWEI:
// eine Region kann ihr Label beim Anlegen nennen und beim Aendern. Genau diese Zahl war am 14.08.2026
// der Fehler an anderer Stelle („eine Regel, die einen von vier Erzeugern bindet, ist keine Regel").
//
// 🪤 Geprueft wird der Quelltext OHNE Kommentare. Beide Aufrufer tragen die Begruendung als Kommentar
// ueber dem Aufruf -- eine rohe Textsuche faende die und waere gruen, auch wenn der Aufruf fehlte.
$quelle = (string) file_get_contents(__DIR__ . '/../ecosystem.php');
$ohneKommentare = (string) preg_replace(['~/\*.*?\*/~s', '~//[^\n]*~'], '', $quelle);

$rumpf = static function (string $name) use ($ohneKommentare): string {
    $start = strpos($ohneKommentare, 'function ' . $name . '(');
    assert($start !== false, "die Funktion {$name} gibt es noch");
    $ende = strpos($ohneKommentare, "\nfunction ", $start + 1);

    return substr($ohneKommentare, $start, ($ende === false ? strlen($ohneKommentare) : $ende) - $start);
};

foreach (['avesmapsUpdateEcosystemRegion', 'avesmapsCreateEcosystemRegion'] as $schreibweg) {
    assert(strpos($rumpf($schreibweg), 'avesmapsEcosystemAdoptLabelPointer(') !== false,
        "💣 {$schreibweg} zieht die Gegenseite der Zuweisung nach");
    assert(strpos($rumpf($schreibweg), 'avesmapsEcosystemLabelPointerToAdopt(') !== false,
        "und entscheidet mit der geteilten Regel, nicht mit einem eigenen Vergleich");
}

// Gegenprobe: das Suchmuster ist scharf genug, um sein Fehlen zu bemerken.
assert(strpos($rumpf('avesmapsEcosystemLabelPointerToCheck'), 'avesmapsEcosystemAdoptLabelPointer(') === false,
    'die Gegenprobe -- eine unbeteiligte Funktion faellt nicht zufaellig durch dieselbe Suche');

echo "ecosystem-label-zeiger-adoption-test: OK\n";
