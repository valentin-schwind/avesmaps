<?php

declare(strict_types=1);

/**
 * Der Lokalisierer fuer Wiki-Bilder. Kein Netz, keine echte DB (SQLite-Fixture). Lauf:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *       api/_internal/wiki/__tests__/bilder-lokalisieren-test.php
 *
 * 🔴 Geprueft wird vor allem die REIHENFOLGE der Riegel-Freigabe und die Auswahl der Kandidaten.
 * Der Abruf selbst laeuft hier nicht -- er ginge gegen das echte Wiki, und genau das soll dieser
 * Bestand ja beenden.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'. Neu starten mit: "
        . "php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../bilder-lokalisieren.php';

$root = sys_get_temp_dir() . '/avesmaps-bilder-lok-' . bin2hex(random_bytes(4));
@mkdir($root . '/uploads/wappen/cache', 0775, true);

$WIKI = 'https://de.wiki-aventurica.de/wiki/Spezial:Dateipfad/';

// ================= 1. Welche Adressen findet der Sammler in einem properties_json? =============

$props = [
    'coat' => ['url' => $WIKI . 'Wappen%20Gareth.png', 'source' => 'wiki'],
    'wiki_settlement' => ['wappen_url' => $WIKI . 'Wappen%20Fasar.png'],
    'wiki_region' => ['image_url' => $WIKI . 'Farindel.jpg'],
    'wiki_path' => ['image_url' => $WIKI . 'Reichsstrasse.jpg'],
];
$gefunden = avesmapsWikiBilderAdressenAusProperties($props);
assert(count($gefunden) === 4,
    'ALLE VIER Felder werden eingesammelt -- coat.url, wappen_url und zweimal image_url. '
    . 'Diese Liste ist die Umkehrung dessen, was map-features.php an der Ausgabe bindet; '
    . 'laufen die beiden auseinander, holt der Lauf etwas, das nie gezeigt wird -- oder umgekehrt.');

// 🔴 Nur das Wiki. Eine eigene Datei ist nichts zu holen, ein fremder Host geht uns nichts an.
$fremd = avesmapsWikiBilderAdressenAusProperties([
    'coat' => ['url' => '/uploads/wappen/eigen-custom.png'],
    'wiki_region' => ['image_url' => 'https://ulisses-spiele.de/x.png'],
]);
assert($fremd === [], 'eigene und fremde Adressen sind keine Kandidaten');

// Kaputte Formen duerfen nicht werfen -- properties_json ist gewachsen und nicht schematisiert.
assert(avesmapsWikiBilderAdressenAusProperties([]) === [], 'leer wirft nicht');
assert(avesmapsWikiBilderAdressenAusProperties(['coat' => 'kein array']) === [], 'coat als String wirft nicht');
assert(avesmapsWikiBilderAdressenAusProperties(['wiki_region' => ['image_url' => null]]) === [], 'null wirft nicht');

// ================= 2. Was gilt als erledigt? ==================================================

$url = $WIKI . 'Wappen%20Gareth.png';
assert(avesmapsWikiBilderErledigt($root, $url) === false, 'ohne Datei ist nichts erledigt');

file_put_contents($root . '/uploads/wappen/cache/' . sha1($url) . '.png', 'PNG');
assert(avesmapsWikiBilderErledigt($root, $url) === true, 'ein vorhandenes Bild ist erledigt');

// 💣 DER GRABSTEIN. Ohne ihn versucht jeder Lauf dieselben hunderte toten Adressen erneut --
// der Lauf kaeme nie ans Ende, und das Wiki bekaeme bei jedem Anlauf dieselbe Flut.
$totUrl = $WIKI . 'Gibt%20Es%20Nicht.png';
assert(avesmapsWikiBilderErledigt($root, $totUrl) === false, 'vorher offen');
file_put_contents($root . '/uploads/wappen/cache/' . sha1($totUrl) . '.tot', 'x');
assert(avesmapsWikiBilderErledigt($root, $totUrl) === true,
    'DER KERN: eine als tot vermerkte Adresse wird nicht wieder versucht');

// ================= 3. Der Riegel: zu, ausser waehrend eines Laufs =============================

assert(avesmapsWikiLokalisierungLaeuft() === false, 'im Ruhezustand laeuft kein Lauf');
assert(avesmapsWikiDateiAbrufErlaubt($url) === false,
    'und der Riegel ist zu -- die Anzeige holt nichts');

avesmapsWikiLokalisierungLaeuft(true);
assert(avesmapsWikiDateiAbrufErlaubt($url) === true,
    'waehrend eines Laufs darf geholt werden -- sonst koennte der Lokalisierer nie arbeiten');
avesmapsWikiLokalisierungLaeuft(false);
assert(avesmapsWikiDateiAbrufErlaubt($url) === false,
    '💣 und danach ist SOFORT wieder zu. Ein Lauf, der die Freigabe stehen laesst, oeffnet den '
    . 'Riegel fuer alles Uebrige in derselben Anfrage.');

// 🔴 Die Freigabe steht im Code hinter try/finally -- sonst laesst ein Wurf mittendrin sie offen.
$quelle = (string) file_get_contents(__DIR__ . '/../bilder-lokalisieren.php');
$abLauf = substr($quelle, strpos($quelle, 'function avesmapsWikiBilderLokalisierenLauf'));
$posAn = strpos($abLauf, 'avesmapsWikiLokalisierungLaeuft(true)');
$posFinally = strpos($abLauf, '} finally {');
$posAus = strpos($abLauf, 'avesmapsWikiLokalisierungLaeuft(false)');
assert($posAn !== false && $posFinally !== false && $posAus !== false && $posFinally < $posAus,
    'die Ruecknahme steht im finally -- nicht am Ende des try, wo ein Wurf sie ueberspringt');

// ================= 4. Der Sammler gegen eine echte (SQLite-)Tabelle ===========================

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "HINWEIS: pdo_sqlite fehlt -- Abschnitt 4 uebersprungen.\n");
} else {
    $pdo = new PDO('sqlite::memory:');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->exec('CREATE TABLE map_features (public_id TEXT, name TEXT, feature_type TEXT, properties_json TEXT)');
    $ein = $pdo->prepare('INSERT INTO map_features VALUES (?,?,?,?)');

    // Zwei Orte teilen sich DASSELBE Regionsbild -- es darf nur EINMAL geholt werden.
    $geteilt = $WIKI . 'Farindel.jpg';
    $ein->execute(['a', 'Ort A', 'location', json_encode(['wiki_region' => ['image_url' => $geteilt]])]);
    $ein->execute(['b', 'Ort B', 'location', json_encode(['wiki_region' => ['image_url' => $geteilt]])]);
    // Einer mit eigenem Wappen (schon lokal -> kein Kandidat).
    $ein->execute(['c', 'Ort C', 'location', json_encode(['coat' => ['url' => '/uploads/wappen/c.png']])]);
    // Einer, dessen Bild schon im Cache liegt (siehe oben) -> kein Kandidat.
    $ein->execute(['d', 'Gareth', 'location', json_encode(['coat' => ['url' => $url]])]);
    // Und einer, der als tot vermerkt ist -> kein Kandidat.
    $ein->execute(['e', 'Phantom', 'location', json_encode(['wiki_path' => ['image_url' => $totUrl]])]);

    $offen = avesmapsWikiBilderOffeneAdressen($pdo, $root);
    $adressen = array_column($offen, 'url');
    assert($adressen === [$geteilt],
        'ENTDOPPELT: dasselbe Bild an zwei Objekten ist EIN Kandidat, nicht zwei -- ein Regionsbild '
        . 'haengt an jedem Label seiner Region. Und weder das lokale, noch das gecachte, noch das '
        . 'tote taucht auf. Gefunden: ' . implode(' | ', $adressen));

    $status = avesmapsWikiBilderStatus($pdo, $root);
    assert($status['remaining'] === 1, 'die Statuszeile zaehlt dasselbe wie der Lauf');

    // Das Limit begrenzt, ohne die Zaehlung zu verfaelschen.
    assert(count(avesmapsWikiBilderOffeneAdressen($pdo, $root, 1)) === 1, 'das Batch-Limit greift');
}

// ================= 5. Grabsteine wegraeumen -- und NUR die ====================================

$vorherBild = is_file($root . '/uploads/wappen/cache/' . sha1($url) . '.png');
$weg = avesmapsWikiBilderGrabsteineLoeschen($root);
assert($weg === 1, 'genau der eine Grabstein ist weg');
assert(is_file($root . '/uploads/wappen/cache/' . sha1($url) . '.png') === $vorherBild,
    '⚠️ und KEIN Bild -- Zuruecksetzen darf nie einen Bestand loeschen, den wir schon haben');
assert(avesmapsWikiBilderErledigt($root, $totUrl) === false, 'die tote Adresse ist wieder offen');

foreach ((array) @scandir($root . '/uploads/wappen/cache') as $f) {
    if ($f !== '.' && $f !== '..') { @unlink($root . '/uploads/wappen/cache/' . $f); }
}
echo "OK: bilder-lokalisieren-test -- alle Zusicherungen gehalten\n";
