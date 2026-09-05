<?php

declare(strict_types=1);

// Gespeicherte Staetten (`settlement_place`) -- Objekte ohne Weltkarten-Position, die zu einer
// Stadt gehoeren. Bis zum 02.09.2026 gab es sie nur als Ableitung aus der Wiki-Aventurica-Registry;
// „Innerorts einfuegen" des Garetien-Importers ist der erste Schreiber.
// Entwurf: docs/superpowers/specs/2026-09-02-innerorts-import-design.md §3
//
// Geprueft wird die Bibliothek gegen SQLite: Anlegen, Wiederbeleben, Zuruecknehmen, Lesen, der
// Stempel fuers ETag -- und die zwei Nahtstellen zum Quellensystem (Wiki-Adresse, Revision).
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
//           -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/settlement-places-test.php

require_once __DIR__ . '/../settlement-places.php';
require_once __DIR__ . '/../feature-sources.php';

$pruefungen = 0;

/**
 * 🪤 Das selbstheilende DDL des Hauses ist MySQL-eigen (AUTO_INCREMENT, ENGINE=InnoDB) und laeuft
 * unter SQLite nicht -- nicht einmal mit IF NOT EXISTS, denn der Parser liest die ganze Anweisung.
 * Es wird GESCHLUCKT, nicht uebersetzt: die Tabelle steht unten von Hand. Dieselbe Naht wie im
 * Uebernahme-Pruefstand des Garetien-Importers.
 */
final class AvesmapsSettlementPlaceTestPdo extends PDO
{
    public function exec(string $statement): int|false
    {
        if (str_contains($statement, 'AUTO_INCREMENT') || str_contains($statement, 'ENGINE=InnoDB')) {
            return 0;
        }

        return parent::exec($statement);
    }
}

function avesmapsStaettenTestPdo(bool $mitTabelle = true): PDO
{
    $pdo = new AvesmapsSettlementPlaceTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    // map_features steht IMMER da: die Wiki-Adresse des Quellensystems faellt fuer unbekannte Typen
    // dorthin durch, und ohne die Tabelle saehe ein Durchfallen wie ein Fehler aus statt wie ''.
    $pdo->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, properties_json TEXT,
        revision INTEGER DEFAULT 1, is_active INTEGER DEFAULT 1)');
    if ($mitTabelle) {
        $pdo->exec('CREATE TABLE settlement_place (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT NOT NULL,
            name TEXT NOT NULL, place_type TEXT, settlement_public_id TEXT NOT NULL, settlement_name TEXT NOT NULL,
            wiki_url TEXT, origin TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, created_by INTEGER,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (settlement_public_id, name))');
    }

    return $pdo;
}

$rondra = [
    'name' => 'Wandlether Rondratempel', 'place_type' => 'Tempel',
    'settlement_public_id' => 'stadt-wandleth', 'settlement_name' => 'Wandleth',
    'wiki_url' => 'https://www.garetien.de/index.php/Garetien:Wandlether_Rondratempel', 'origin' => 'garetien',
];

// --- 🔴 LAUT, nicht still, wenn die id-Funktion fehlt: settlement-places.php bindet features.php
// bewusst nicht ein (Kopf der Datei). Eine Staette ohne id faende danach niemand wieder.
if (!function_exists('avesmapsUuidV4')) {
    $laut = null;
    try {
        avesmapsSettlementPlaceAdd(avesmapsStaettenTestPdo(), $rondra, 7);
    } catch (RuntimeException $e) {
        $laut = $e->getMessage();
    }
    assert(is_string($laut) && str_contains($laut, 'avesmapsUuidV4'),
        'ohne avesmapsUuidV4 wirft das Anlegen und nennt die Ursache: ' . var_export($laut, true));
    $pruefungen++;

    // Ab hier ein Ersatz -- zaehlend, damit zwei Anlagen unterscheidbar sind.
    function avesmapsUuidV4(): string
    {
        static $n = 0;

        return sprintf('uuid-%04d', ++$n);
    }
}

// --- Anlegen, Lesen, Stempel.
$pdo = avesmapsStaettenTestPdo();
assert(avesmapsSettlementPlaceReadStamp($pdo) === '0|', 'leere Tabelle: Stempel „0|" (Zahl, kein Zeitpunkt)');
$id1 = avesmapsSettlementPlaceAdd($pdo, $rondra, 7);
assert($id1 !== '' && avesmapsSettlementPlaceExists($pdo, $id1), 'angelegt, und die public_id findet sie wieder');
$zeilen = avesmapsSettlementPlaceRows($pdo);
assert($zeilen === [[
    'name' => 'Wandlether Rondratempel', 'settlement' => 'Wandleth', 'type' => 'Tempel',
    'wiki_url' => 'https://www.garetien.de/index.php/Garetien:Wandlether_Rondratempel',
]], '🔴 die Form ist die der drei abgeleiteten Quellen (name/settlement/type/wiki_url) -- der Innerorts-Leser braucht keinen Sonderfall: ' . json_encode($zeilen));
$stempel1 = avesmapsSettlementPlaceReadStamp($pdo);
assert(str_starts_with($stempel1, '1|') && strlen($stempel1) > 2, 'der Stempel zaehlt die aktiven Zeilen und traegt einen Zeitpunkt: ' . $stempel1);
$pruefungen += 4;

$id2 = avesmapsSettlementPlaceAdd($pdo, ['name' => 'Wandlether Baumeisterzunft', 'settlement_public_id' => 'stadt-wandleth',
    'settlement_name' => 'Wandleth', 'origin' => 'garetien'], 7);
assert($id2 !== $id1, 'ein anderer Name in derselben Stadt ist eine andere Staette');
assert(count(avesmapsSettlementPlaceRows($pdo)) === 2, 'zwei aktive Zeilen');
// ⚠️ Sortiert nach Stadt und NAME -- die Baumeisterzunft steht deshalb VOR dem Rondratempel.
$zunft = array_values(array_filter(avesmapsSettlementPlaceRows($pdo), static fn(array $z): bool => $z['name'] === 'Wandlether Baumeisterzunft'))[0] ?? null;
assert($zunft !== null && $zunft['type'] === '' && $zunft['wiki_url'] === '',
    'fehlende Angaben werden leere Strings, nie null: ' . json_encode($zunft));
assert(str_starts_with(avesmapsSettlementPlaceReadStamp($pdo), '2|'), 'der Stempel folgt der Zahl');
$pruefungen += 4;

// --- Zuruecknehmen: weich.
assert(avesmapsSettlementPlaceDeactivate($pdo, $id1, 7) === true, 'zuruecknehmen meldet die betroffene Zeile');
assert(avesmapsSettlementPlaceDeactivate($pdo, $id1, 7) === false, 'ein zweites Mal trifft nichts mehr -- ohne Fehler');
assert(count(avesmapsSettlementPlaceRows($pdo)) === 1 && avesmapsSettlementPlaceRows($pdo)[0]['name'] === 'Wandlether Baumeisterzunft',
    'die zurueckgenommene faellt aus der Nutzlast');
assert(avesmapsSettlementPlaceExists($pdo, $id1) === true,
    '💣 AUCH DIE ZURUECKGENOMMENE ZAEHLT bei „in welcher Tabelle liegt das?" -- sonst fiele eine zweite Ruecknahme in den Kartenpfad');
assert((int) $pdo->query('SELECT COUNT(*) FROM settlement_place')->fetchColumn() === 2, 'kein DELETE');
assert(str_starts_with(avesmapsSettlementPlaceReadStamp($pdo), '1|'), 'der Stempel zaehlt nur aktive');
$pruefungen += 6;

// --- Wiederbeleben: dieselbe (Ort, Name) ist dieselbe Staette, mit den neuen Angaben.
$id1b = avesmapsSettlementPlaceAdd($pdo, array_merge($rondra, ['place_type' => 'Rondra-Tempel']), 7);
assert($id1b === $id1, '⚠️ derselbe Name in derselben Stadt lebt wieder auf -- dieselbe public_id, keine Dublette');
assert((int) $pdo->query('SELECT COUNT(*) FROM settlement_place')->fetchColumn() === 2, 'weiterhin zwei Zeilen');
$wiederStmt = $pdo->prepare('SELECT is_active, place_type FROM settlement_place WHERE public_id = :pid');
$wiederStmt->execute(['pid' => $id1]);
$wieder = $wiederStmt->fetch(PDO::FETCH_ASSOC);
assert((int) $wieder['is_active'] === 1 && $wieder['place_type'] === 'Rondra-Tempel', 'aktiv, mit dem neuen Typ: ' . json_encode($wieder));
$pruefungen += 3;

// --- Riegel.
$leerName = null;
try {
    avesmapsSettlementPlaceAdd($pdo, ['name' => ' ', 'settlement_public_id' => 'x'], 7);
} catch (RuntimeException $e) {
    $leerName = $e->getMessage();
}
assert(is_string($leerName), 'ohne Namen wird nicht angelegt');
$leerOrt = null;
try {
    avesmapsSettlementPlaceAdd($pdo, ['name' => 'Etwas', 'settlement_public_id' => ''], 7);
} catch (RuntimeException $e) {
    $leerOrt = $e->getMessage();
}
assert(is_string($leerOrt), 'ohne Ort wird nicht angelegt -- die Bindung ist die public_id des Ortes');
$pruefungen += 2;

// --- Die Menge der aktiven Kennungen je Herkunft -- der Leser der Arbeitsliste („uebernommen · innerorts").
$garetienIds = avesmapsSettlementPlacePublicIds($pdo, 'garetien');
assert($garetienIds === [$id1 => true, $id2 => true] || $garetienIds === [$id2 => true, $id1 => true],
    'alle aktiven Staetten dieser Herkunft, als Menge (public_id => true): ' . json_encode($garetienIds));
avesmapsSettlementPlaceAdd($pdo, ['name' => 'Von Hand', 'settlement_public_id' => 'stadt-wandleth',
    'settlement_name' => 'Wandleth', 'origin' => 'manual'], 7);
assert(count(avesmapsSettlementPlacePublicIds($pdo, 'garetien')) === 2, 'eine andere Herkunft zaehlt nicht mit');
avesmapsSettlementPlaceDeactivate($pdo, $id2, 7);
assert(avesmapsSettlementPlacePublicIds($pdo, 'garetien') === [$id1 => true], 'und eine zurueckgenommene faellt heraus');
$pruefungen += 3;

// --- Ohne Tabelle (frische Installation) faellt ALLES still aus -- die Karte darf nicht ausfallen.
$ohne = avesmapsStaettenTestPdo(false);
assert(avesmapsSettlementPlaceRows($ohne) === [], 'ohne Tabelle: keine Zeilen');
assert(avesmapsSettlementPlaceExists($ohne, $id1) === false, 'ohne Tabelle: nichts liegt dort');
assert(avesmapsSettlementPlaceDeactivate($ohne, $id1, 7) === false, 'ohne Tabelle: nichts zurueckzunehmen');
assert(avesmapsSettlementPlaceReadStamp($ohne) === '', 'ohne Tabelle: LEERER Stempel, damit der ETag-Keim zeichengleich bleibt');
assert(avesmapsSettlementPlacePublicIds($ohne, 'garetien') === [], 'ohne Tabelle: leere Menge');
$pruefungen += 5;

// --- Die zwei Nahtstellen zum Quellensystem. Eine Staette traegt ihre Quelle (die Rechtsfolge des
// Imports) als entity_type 'settlement_place'; der Quellen-Editor fragt beim Lesen nach Wiki-Adresse
// und Revision des Objekts.
assert(avesmapsFeatureSourcesReadWikiUrl($pdo, 'settlement_place', $id1)
    === 'https://www.garetien.de/index.php/Garetien:Wandlether_Rondratempel',
    '🔴 die Wiki-Adresse einer Staette kommt aus IHRER Tabelle -- nicht aus map_features, wo dieselbe public_id ein fremdes Objekt treffen koennte');
assert(avesmapsFeatureSourcesReadWikiUrl($pdo, 'settlement_place', 'gibt-es-nicht') === '', 'unbekannte Staette: leer');
assert(avesmapsFeatureSourcesReadWikiUrl($ohne, 'settlement_place', $id1) === '', 'ohne Tabelle: leer, kein Fehler');
assert(avesmapsFeatureSourcesReadRevision($pdo, 'settlement_place', $id1) === null,
    'eine Staette hat keine Kartenrevision -- und darf NIE in map_features nachgeschlagen werden (id-Kollision)');
$pruefungen += 4;

// --- 💣 DER STEMPEL IST TRAGEND: eine neue Staette bewegt kein Kartenobjekt und hebt `map_revision`
// nicht -- ohne den Keim bekaeme jeder warme Browser sein 304, und die frisch eingefuegte Staette
// erschiene weder in der Infobox-Zeile „Staetten" noch in der Suche (dritte Auflage derselben Falle
// nach Klimastempel und Tempowerten).
// ⚠️ `api/app/map-features.php` ist ein ENDPUNKT und laesst sich nicht einbinden; die eine Funktion
// wird ausgeschnitten und AUSGEFUEHRT -- dasselbe Muster wie tempowerte-nutzlast-test.php.
$mf = (string) file_get_contents(__DIR__ . '/../../../app/map-features.php');
$schnitt = static function (string $quelle, string $anfang, string $schluss): string {
    $start = strpos($quelle, $anfang);
    assert($start !== false, $anfang . ' nicht gefunden');
    // Zeilenendenneutral: die Arbeitskopie traegt CRLF, das Deploy-Tor LF.
    $ende = strpos($quelle, "\n" . $schluss, $start);
    assert($ende !== false, 'Ende von ' . $anfang . ' nicht gefunden');

    return substr($quelle, $start, $ende - $start + 1 + strlen($schluss));
};
eval($schnitt($mf, 'const AVESMAPS_MAP_FEATURES_PAYLOAD_VERSION', ''));
eval($schnitt($mf, 'function avesmapsMapFeaturesETag(', '}'));
assert(avesmapsMapFeaturesETag(4711, [], 'klima-1', 'tempo-1', '1|2026-09-02 21:00:00')
    !== avesmapsMapFeaturesETag(4711, [], 'klima-1', 'tempo-1', '2|2026-09-05 10:00:00'),
    'eine andere Staetten-Zahl, ein anderes ETag -- sonst 304 samt alter Nutzlast');
assert(avesmapsMapFeaturesETag(4711, [], 'klima-1', 'tempo-1', '') === avesmapsMapFeaturesETag(4711, [], 'klima-1', 'tempo-1'),
    'ein LEERER Stempel (Tabelle fehlt oder nicht lesbar) haelt den Keim Zeichen fuer Zeichen -- nicht die halbe Welt laedt 21 MB neu');
// Und der Endpunkt reicht ihn wirklich hinein -- hier geht nur der Quelltext (Kommentare vorher weg,
// sonst schlaegt die Zusicherung an dem Satz an, der sie beschreibt).
$ohneKommentare = (string) preg_replace('~^\s*(//|\*|/\*).*$~m', '', $mf);
$aufruf = $schnitt($ohneKommentare, '$etag = avesmapsMapFeaturesETag(', '');
assert(str_contains($aufruf, 'avesmapsSettlementPlaceReadStamp($pdo)'),
    'der Endpunkt reicht den Staetten-Stempel ins ETag -- ohne das ist die Zusicherung darueber eine ueber eine Funktion, die niemand so ruft: ' . $aufruf);
$pruefungen += 3;

echo "OK: {$pruefungen} Pruefungen\n";
