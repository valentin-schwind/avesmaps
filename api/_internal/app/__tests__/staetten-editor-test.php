<?php

declare(strict_types=1);

// Die Server-Bibliothek fuer „Staetten loeschen und umhaengen" plus die Regel „Kartenpunkt
// schlaegt Innerorts": ein Wiki-Artikel, der schon einem Kartenpunkt zugewiesen ist, taucht nicht
// zusaetzlich als Innerorts-Objekt seiner Stadt auf.
// Entwurf: docs/superpowers/specs/2026-09-26-staetten-loeschen-umhaengen-design.md §3-4
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
//           -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll \
//           api/_internal/app/__tests__/staetten-editor-test.php

require_once __DIR__ . '/../settlement-places.php';
require_once __DIR__ . '/../../wiki/place-scope.php';

$pruefungen = 0;

/**
 * 🪤 Das selbstheilende DDL des Hauses ist MySQL-eigen (AUTO_INCREMENT, ENGINE=InnoDB) und laeuft
 * unter SQLite nicht -- es wird GESCHLUCKT, nicht uebersetzt: die Tabelle steht unten von Hand,
 * wie in settlement-places-test.php.
 */
class AvesmapsStaettenEditorTestPdo extends PDO
{
    public function exec(string $statement): int|false
    {
        if (str_contains($statement, 'AUTO_INCREMENT') || str_contains($statement, 'ENGINE=InnoDB')) {
            return 0;
        }

        return parent::exec($statement);
    }
}

function avesmapsStaettenEditorTestPdo(): PDO
{
    $pdo = new AvesmapsStaettenEditorTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('CREATE TABLE map_features (
        id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, feature_type TEXT, feature_subtype TEXT,
        name TEXT, properties_json TEXT, min_x REAL, min_y REAL, is_active INTEGER DEFAULT 1)');
    $pdo->exec('CREATE TABLE settlement_place (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT NOT NULL,
        name TEXT NOT NULL, place_type TEXT, settlement_public_id TEXT NOT NULL, settlement_name TEXT NOT NULL,
        wiki_url TEXT, origin TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, created_by INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (settlement_public_id, name))');

    return $pdo;
}

if (!function_exists('avesmapsUuidV4')) {
    function avesmapsUuidV4(): string
    {
        static $n = 0;

        return sprintf('uuid-editor-%04d', ++$n);
    }
}

function avesmapsStaettenTestOrtEinfuegen(
    PDO $pdo,
    string $publicId,
    string $name,
    string $subtype,
    float $x,
    float $y,
    array $properties = [],
    bool $aktiv = true
): void {
    $pdo->prepare(
        'INSERT INTO map_features (public_id, feature_type, feature_subtype, name, properties_json, min_x, min_y, is_active)
         VALUES (:pid, :type, :subtype, :name, :props, :x, :y, :aktiv)'
    )->execute([
        'pid' => $publicId,
        'type' => 'location',
        'subtype' => $subtype,
        'name' => $name,
        'props' => json_encode($properties),
        'x' => $x,
        'y' => $y,
        'aktiv' => $aktiv ? 1 : 0,
    ]);
}

// === 1) Schluessel =========================================================================
assert(
    avesmapsInnerortsArtikelSchluessel('https://www.de.wiki-aventurica.de/wiki/Burg%20Aarkopf')
    === avesmapsInnerortsArtikelSchluessel('https://de.wiki-aventurica.de/wiki/Burg_Aarkopf'),
    'www. faellt weg, %20 und Leerzeichen werden beide zu Unterstrich -- derselbe Schluessel'
);
assert(avesmapsInnerortsArtikelSchluessel('') === '', 'leere Adresse -> leerer Schluessel');
assert(avesmapsInnerortsArtikelSchluessel('nur-ein-pfad-ohne-wirt') === '', 'kein Wirt -> leerer Schluessel');
$pruefungen += 3;

// === 2) …KartenArtikelAusZeilen =============================================================
$zeilenFuerAusZeilen = [
    // aktiv, location, mit Adresse -> zaehlt
    ['feature_type' => 'location', 'is_active' => 1,
        'properties_json' => json_encode(['wiki_settlement' => ['wiki_url' => 'https://de.wiki-aventurica.de/wiki/Burg_Aarkopf']])],
    // inaktiv -> faellt raus
    ['feature_type' => 'location', 'is_active' => 0,
        'properties_json' => json_encode(['wiki_settlement' => ['wiki_url' => 'https://de.wiki-aventurica.de/wiki/Andergast']])],
    // kein location (z.B. Weg) -> faellt raus
    ['feature_type' => 'path', 'is_active' => 1,
        'properties_json' => json_encode(['wiki_settlement' => ['wiki_url' => 'https://de.wiki-aventurica.de/wiki/Reichsstrasse']])],
    // location ohne wiki_settlement -> faellt raus (keine Adresse)
    ['feature_type' => 'location', 'is_active' => 1, 'properties_json' => json_encode(['name' => 'Nichts'])],
    // is_active FEHLT im Array (nicht MySQL-Zeile mit NULL, sondern der Schluessel selbst fehlt) -> gilt als aktiv
    ['feature_type' => 'location',
        'properties_json' => json_encode(['wiki_settlement' => ['wiki_url' => 'https://de.wiki-aventurica.de/wiki/Punin']])],
    // kaputtes JSON -> wird uebersprungen, kein Fehler
    ['feature_type' => 'location', 'is_active' => 1, 'properties_json' => '{nicht: valides json'],
];
$mengeAusZeilen = avesmapsInnerortsKartenArtikelAusZeilen($zeilenFuerAusZeilen);
assert(is_array($mengeAusZeilen), 'liefert eine Menge (Array)');
assert(count($mengeAusZeilen) === 2, 'genau zwei gueltige Adressen (Aarkopf, Punin) zaehlen: ' . json_encode($mengeAusZeilen));
assert(isset($mengeAusZeilen[avesmapsInnerortsArtikelSchluessel('https://de.wiki-aventurica.de/wiki/Burg_Aarkopf')]),
    'die aktive location mit Adresse ist drin');
assert(isset($mengeAusZeilen[avesmapsInnerortsArtikelSchluessel('https://de.wiki-aventurica.de/wiki/Punin')]),
    'is_active fehlend im Array zaehlt als aktiv');
assert(!isset($mengeAusZeilen[avesmapsInnerortsArtikelSchluessel('https://de.wiki-aventurica.de/wiki/Andergast')]),
    'die inaktive Zeile ist NICHT drin');
$pruefungen += 5;

// === 3) …KartenArtikel($pdo) liefert dieselbe Menge wie …AusZeilen ==========================
// Dieselbe Fixture, einmal als Zeilen fuer AusZeilen, einmal als echte map_features-Zeilen fuer
// den PDO-Pfad -- beide muessen zur selben Menge kommen. Kein kaputtes JSON hier, sonst waeren
// die zwei Pfade (PHP-Array-Filter vs. SQL WHERE is_active=1) nicht direkt vergleichbar.
$pdo3 = avesmapsStaettenEditorTestPdo();
$sauber = [
    ['feature_type' => 'location', 'is_active' => 1,
        'properties_json' => json_encode(['wiki_settlement' => ['wiki_url' => 'https://de.wiki-aventurica.de/wiki/Burg_Aarkopf']])],
    ['feature_type' => 'location', 'is_active' => 0,
        'properties_json' => json_encode(['wiki_settlement' => ['wiki_url' => 'https://de.wiki-aventurica.de/wiki/Andergast']])],
    ['feature_type' => 'location', 'is_active' => 1,
        'properties_json' => json_encode(['wiki_settlement' => ['wiki_url' => 'https://de.wiki-aventurica.de/wiki/Punin']])],
    ['feature_type' => 'location', 'is_active' => 1, 'properties_json' => json_encode(['name' => 'Ohne Adresse'])],
];
foreach ($sauber as $i => $zeile) {
    avesmapsStaettenTestOrtEinfuegen(
        $pdo3, 'ort-' . $i, 'Ort ' . $i, 'stadt', (float) $i, (float) $i,
        json_decode((string) $zeile['properties_json'], true) ?: [],
        (int) $zeile['is_active'] === 1
    );
}
$mengeAusZeilenSauber = avesmapsInnerortsKartenArtikelAusZeilen($sauber);
$mengeAusPdo = avesmapsInnerortsKartenArtikel($pdo3);
assert($mengeAusZeilenSauber == $mengeAusPdo,
    'beide Pfade liefern dieselbe Menge: ' . json_encode($mengeAusZeilenSauber) . ' vs ' . json_encode($mengeAusPdo));
assert(count($mengeAusPdo) === 2, 'zwei aktive Adressen ueber den PDO-Pfad: ' . json_encode($mengeAusPdo));
$pruefungen += 2;

// --- Der Escape-Fall: MariaDB liefert JSON_EXTRACT gequotet inkl. \/-Escapes, SQLite liefert
// die Zeichenkette schon entpackt. Der PDO-Pfad muss trotzdem den RICHTIGEN Schluessel liefern --
// getestet direkt gegen SQLite, wo der Rohwert schon entpackt ankommt (siehe Kopf-Notiz des
// Controllers: SQLite kennt json_extract und liefert unquotiert).
$pdoEscape = avesmapsStaettenEditorTestPdo();
avesmapsStaettenTestOrtEinfuegen($pdoEscape, 'ort-escape', 'Escape-Ort', 'stadt', 0.0, 0.0,
    ['wiki_settlement' => ['wiki_url' => 'https://de.wiki-aventurica.de/wiki/Bad_Escape']]);
$mengeEscape = avesmapsInnerortsKartenArtikel($pdoEscape);
assert(isset($mengeEscape[avesmapsInnerortsArtikelSchluessel('https://de.wiki-aventurica.de/wiki/Bad_Escape')]),
    'die Adresse kommt unversehrt durch den PDO-Pfad: ' . json_encode($mengeEscape));
$pruefungen += 1;

// --- Faellt offen aus: eine Tabelle, die beim Abfragen wirft, ergibt [], nie einen Fehler.
$pdoKaputt = new class('sqlite::memory:') extends PDO {
    public function query(string $query, ?int $fetchMode = null, mixed ...$fetchModeArgs): PDOStatement|false
    {
        throw new RuntimeException('kaputte Verbindung');
    }
};
assert(avesmapsInnerortsKartenArtikel($pdoKaputt) === [], 'ein werfender Zugriff faellt offen aus: []');
$pruefungen += 1;

// --- avesmapsInnerortsJsonExtractText DIREKT: der MariaDB-Pfad (gequotet inkl. \/-Escape) wird
// von Test 3 nie erreicht, weil SQLite json_extract() schon entpackt liefert (siehe Kopf-Notiz des
// Controllers). Der Helfer wird deshalb hier isoliert mit einer HANDGEBAUTEN gequoteten
// Zeichenkette geprueft, wie MariaDB's JSON_EXTRACT sie tatsaechlich zurueckgibt.
assert(
    avesmapsInnerortsJsonExtractText('"https:\/\/de.wiki-aventurica.de\/wiki\/Burg_Aarkopf"')
    === 'https://de.wiki-aventurica.de/wiki/Burg_Aarkopf',
    'MariaDB-Form (gequotet, \/-escaped): json_decode() packt sie sauber aus'
);
assert(
    avesmapsInnerortsJsonExtractText('https://de.wiki-aventurica.de/wiki/Burg_Aarkopf')
    === 'https://de.wiki-aventurica.de/wiki/Burg_Aarkopf',
    'SQLite-Form (schon entpackt, keine Anfuehrungszeichen): unveraendert durchgereicht'
);
assert(avesmapsInnerortsJsonExtractText('') === '', 'leer -> leer');
assert(avesmapsInnerortsJsonExtractText((string) null) === '', 'null (wie es der Aufrufer per ?? \'\' hereinreicht) -> leer');
$pruefungen += 4;

// === 4) …OhneKartenpunkte ====================================================================
$kartenArtikel = avesmapsInnerortsKartenArtikelAusZeilen([
    ['feature_type' => 'location', 'is_active' => 1,
        'properties_json' => json_encode(['wiki_settlement' => ['wiki_url' => 'https://de.wiki-aventurica.de/wiki/Burg_Aarkopf']])],
]);
$staettenZeilen = [
    ['name' => 'Burg Aarkopf', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Burg_Aarkopf'], // zugewiesen -> faellt
    ['name' => 'Burg Aarkopf', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Ganz_Andere_Burg'], // namensgleich, andere Adresse -> bleibt
    ['name' => 'Turm ohne Wiki', 'wiki_url' => ''], // ohne Adresse -> bleibt
];
$gefiltert = avesmapsInnerortsOhneKartenpunkte($staettenZeilen, $kartenArtikel);
assert(count($gefiltert) === 2, 'die zugewiesene Zeile faellt, zwei bleiben: ' . json_encode($gefiltert));
assert($gefiltert[0]['wiki_url'] === 'https://de.wiki-aventurica.de/wiki/Ganz_Andere_Burg',
    'die namensgleiche Zeile mit ANDERER Adresse bleibt -- kein Namensvergleich');
assert($gefiltert[1]['name'] === 'Turm ohne Wiki', 'die Zeile ohne wiki_url bleibt');
assert(array_keys($gefiltert) === [0, 1], 'array_values -- keine Luecken in den Schluesseln');
$pruefungen += 4;

// === 5) ListForSettlement ===================================================================
$pdo5 = avesmapsStaettenEditorTestPdo();
avesmapsSettlementPlaceEnsureSchema($pdo5);
avesmapsSettlementPlaceAdd($pdo5, ['name' => 'Zwiebelturm', 'settlement_public_id' => 'stadt-a', 'settlement_name' => 'Stadt A',
    'place_type' => 'Turm', 'wiki_url' => 'https://x/y', 'origin' => 'manual'], 1);
avesmapsSettlementPlaceAdd($pdo5, ['name' => 'Alte Schmiede', 'settlement_public_id' => 'stadt-a', 'settlement_name' => 'Stadt A',
    'origin' => 'manual'], 1);
$idFremd = avesmapsSettlementPlaceAdd($pdo5, ['name' => 'Fremdes Haus', 'settlement_public_id' => 'stadt-b', 'settlement_name' => 'Stadt B',
    'origin' => 'manual'], 1);
avesmapsSettlementPlaceDeactivate($pdo5, $idFremd, 1); // Kontrolle: andere Stadt UND inaktiv duerfen nie auftauchen
$idInaktivA = avesmapsSettlementPlaceAdd($pdo5, ['name' => 'Verschwundenes', 'settlement_public_id' => 'stadt-a', 'settlement_name' => 'Stadt A',
    'origin' => 'manual'], 1);
avesmapsSettlementPlaceDeactivate($pdo5, $idInaktivA, 1);
$listeA = avesmapsSettlementPlaceListForSettlement($pdo5, 'stadt-a');
assert(count($listeA) === 2, 'nur die zwei aktiven Staetten von Stadt A: ' . json_encode($listeA));
assert($listeA[0]['name'] === 'Alte Schmiede' && $listeA[1]['name'] === 'Zwiebelturm', 'nach Name sortiert: ' . json_encode($listeA));
assert(array_keys($listeA[0]) === ['public_id', 'name', 'place_type', 'wiki_url', 'origin'], 'genau die fuenf Felder: ' . json_encode(array_keys($listeA[0])));
assert($listeA[1]['wiki_url'] === 'https://x/y' && $listeA[1]['place_type'] === 'Turm', 'Feldwerte kommen mit: ' . json_encode($listeA[1]));
$listeUnbekannt = avesmapsSettlementPlaceListForSettlement($pdo5, 'stadt-die-es-nicht-gibt');
assert($listeUnbekannt === [], 'unbekannte Stadt: leere Liste, kein Fehler');
$listeOhneTabelle = avesmapsSettlementPlaceListForSettlement(avesmapsStaettenTestPdoOhneStaetten(), 'stadt-a');
assert($listeOhneTabelle === [], 'fehlende Tabelle: leere Liste');
$pruefungen += 6;

function avesmapsStaettenTestPdoOhneStaetten(): PDO
{
    $pdo = new AvesmapsStaettenEditorTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, feature_type TEXT,
        feature_subtype TEXT, name TEXT, properties_json TEXT, min_x REAL, min_y REAL, is_active INTEGER DEFAULT 1)');

    return $pdo;
}

// === 6) Move =================================================================================
$pdo6 = avesmapsStaettenEditorTestPdo();
avesmapsStaettenTestOrtEinfuegen($pdo6, 'ort-start', 'Startstadt', 'stadt', 0.0, 0.0);
avesmapsStaettenTestOrtEinfuegen($pdo6, 'ort-ziel', 'Zielstadt', 'kleinstadt', 10.0, 10.0);
avesmapsStaettenTestOrtEinfuegen($pdo6, 'ort-ziel-inaktiv', 'Inaktive Zielstadt', 'dorf', 20.0, 20.0, [], false);
avesmapsStaettenTestOrtEinfuegen($pdo6, 'ort-kreuzung', 'Kreuzung-3', 'crossing', 30.0, 30.0);
avesmapsStaettenTestOrtEinfuegen($pdo6, 'ort-gebaeude', 'Irgendein Gebaeude', 'gebaeude', 40.0, 40.0);
$idMove = avesmapsSettlementPlaceAdd($pdo6, ['name' => 'Wanderburg', 'settlement_public_id' => 'ort-start',
    'settlement_name' => 'Startstadt', 'origin' => 'manual'], 1);
$vorStempel = avesmapsSettlementPlaceReadStamp($pdo6);
$vorUpdatedAt = $pdo6->query("SELECT updated_at FROM settlement_place WHERE public_id = '{$idMove}'")->fetchColumn();

// -- Erfolg.
usleep(2000); // damit ein neuer Zeitstempel messbar ist
$erg = avesmapsSettlementPlaceMove($pdo6, $idMove, 'ort-ziel', 3);
assert(($erg['ok'] ?? null) === true, 'Umhaengen gelingt: ' . json_encode($erg));
assert($erg['ziel_name'] === 'Zielstadt', 'ziel_name ist der Name des Zielpunkts: ' . json_encode($erg));
assert($erg['alter_ort'] === 'ort-start', 'alter_ort ist die vorherige Ort-Kennung: ' . json_encode($erg));
$zeileNach = $pdo6->prepare('SELECT settlement_public_id, settlement_name, updated_at FROM settlement_place WHERE public_id = :pid');
$zeileNach->execute(['pid' => $idMove]);
$nach = $zeileNach->fetch(PDO::FETCH_ASSOC);
assert($nach['settlement_public_id'] === 'ort-ziel' && $nach['settlement_name'] === 'Zielstadt', 'die Zeile traegt die neue Stadt: ' . json_encode($nach));
assert($nach['updated_at'] !== $vorUpdatedAt, 'updated_at hat sich geaendert');
$nachStempel = avesmapsSettlementPlaceReadStamp($pdo6);
assert($nachStempel !== $vorStempel, 'der ETag-Stempel aendert sich mit: ' . $vorStempel . ' -> ' . $nachStempel);
$pruefungen += 6;

// -- not_found: unbekannte / inaktive Staette.
$erg = avesmapsSettlementPlaceMove($pdo6, 'staette-die-es-nie-gab', 'ort-ziel', 1);
assert(($erg['ok'] ?? true) === false && $erg['code'] === 'not_found', 'unbekannte Staette: not_found: ' . json_encode($erg));
$idZumLoeschen = avesmapsSettlementPlaceAdd($pdo6, ['name' => 'Wird geloescht', 'settlement_public_id' => 'ort-start',
    'settlement_name' => 'Startstadt', 'origin' => 'manual'], 1);
avesmapsSettlementPlaceDeactivate($pdo6, $idZumLoeschen, 1);
$erg = avesmapsSettlementPlaceMove($pdo6, $idZumLoeschen, 'ort-ziel', 1);
assert(($erg['ok'] ?? true) === false && $erg['code'] === 'not_found', 'inaktive Staette: not_found: ' . json_encode($erg));
$pruefungen += 2;

// -- invalid_target: Kreuzung, gebaeude, inaktiv, unbekannt, gleich dem eigenen Ort.
$idInvalid = avesmapsSettlementPlaceAdd($pdo6, ['name' => 'Testet Ziele', 'settlement_public_id' => 'ort-start',
    'settlement_name' => 'Startstadt', 'origin' => 'manual'], 1);
foreach ([
    'ort-kreuzung' => 'Kreuzung',
    'ort-gebaeude' => 'gebaeude',
    'ort-ziel-inaktiv' => 'inaktives Ziel',
    'ort-die-es-nicht-gibt' => 'unbekanntes Ziel',
    'ort-start' => 'gleich dem eigenen Ort',
] as $zielId => $bezeichnung) {
    $erg = avesmapsSettlementPlaceMove($pdo6, $idInvalid, $zielId, 1);
    assert(($erg['ok'] ?? true) === false && $erg['code'] === 'invalid_target',
        $bezeichnung . ' -> invalid_target: ' . json_encode($erg));
    $unveraendert = $pdo6->prepare('SELECT settlement_public_id FROM settlement_place WHERE public_id = :pid');
    $unveraendert->execute(['pid' => $idInvalid]);
    assert($unveraendert->fetchColumn() === 'ort-start', 'die Zeile bleibt bei einem Fehler unveraendert (' . $bezeichnung . ')');
    $pruefungen += 2;
}

// -- name_taken / name_taken_deleted.
avesmapsSettlementPlaceAdd($pdo6, ['name' => 'Doppelname', 'settlement_public_id' => 'ort-ziel',
    'settlement_name' => 'Zielstadt', 'origin' => 'manual'], 1);
$idKollision = avesmapsSettlementPlaceAdd($pdo6, ['name' => 'Doppelname', 'settlement_public_id' => 'ort-start',
    'settlement_name' => 'Startstadt', 'origin' => 'manual'], 1);
$erg = avesmapsSettlementPlaceMove($pdo6, $idKollision, 'ort-ziel', 1);
assert(($erg['ok'] ?? true) === false && $erg['code'] === 'name_taken', 'aktive Gleichnamige am Ziel: name_taken: ' . json_encode($erg));
assert(str_contains($erg['message'], 'Doppelname') && str_contains($erg['message'], 'Zielstadt'), 'Meldung nennt Name und Ziel: ' . $erg['message']);
$unveraendert2 = $pdo6->prepare('SELECT settlement_public_id FROM settlement_place WHERE public_id = :pid');
$unveraendert2->execute(['pid' => $idKollision]);
assert($unveraendert2->fetchColumn() === 'ort-start', 'bei name_taken bleibt die Zeile unveraendert');
$pruefungen += 3;

$idKollisionGeloescht = avesmapsSettlementPlaceAdd($pdo6, ['name' => 'Doppelname Zwei', 'settlement_public_id' => 'ort-start',
    'settlement_name' => 'Startstadt', 'origin' => 'manual'], 1);
$idAmZielGeloescht = avesmapsSettlementPlaceAdd($pdo6, ['name' => 'Doppelname Zwei', 'settlement_public_id' => 'ort-ziel',
    'settlement_name' => 'Zielstadt', 'origin' => 'manual'], 1);
avesmapsSettlementPlaceDeactivate($pdo6, $idAmZielGeloescht, 1);
$erg = avesmapsSettlementPlaceMove($pdo6, $idKollisionGeloescht, 'ort-ziel', 1);
assert(($erg['ok'] ?? true) === false && $erg['code'] === 'name_taken_deleted', 'inaktive Gleichnamige am Ziel: name_taken_deleted: ' . json_encode($erg));
$unveraendert3 = $pdo6->prepare('SELECT settlement_public_id FROM settlement_place WHERE public_id = :pid');
$unveraendert3->execute(['pid' => $idKollisionGeloescht]);
assert($unveraendert3->fetchColumn() === 'ort-start', 'bei name_taken_deleted bleibt die Zeile unveraendert');
$pruefungen += 2;

// === 6b) M3: Wettlauf beim Umhaengen -- die UNIQUE-Verletzung faellt erst beim UPDATE an =======
// Zwischen der Kollisionspruefung (SELECT) und dem UPDATE in avesmapsSettlementPlaceMove liegt
// keine Sperre -- ein "echter" Wettlauf legt genau DORT eine gleichnamige Staette am Ziel an.
// Simuliert per PDO-Unterklasse, die genau am UPDATE-Statement (erkannt am Anfang seines Textes)
// die Kollisionszeile einschiebt, BEVOR execute() laeuft -- das ist keine nachgebaute
// Fehlermeldung, sondern eine echte SQLite-UNIQUE-Verletzung.
final class AvesmapsStaettenRennenTestPdo extends AvesmapsStaettenEditorTestPdo
{
    public bool $rennenSimulieren = false;

    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        if ($this->rennenSimulieren && str_starts_with(trim($query), 'UPDATE settlement_place SET settlement_public_id')) {
            $this->rennenSimulieren = false; // nur einmal ausloesen
            $this->exec(
                "INSERT INTO settlement_place
                    (public_id, name, place_type, settlement_public_id, settlement_name, wiki_url, origin, is_active)
                 VALUES ('sp-rennen', 'Rennstaette', NULL, 'ort-rennen-ziel', 'Rennziel', NULL, 'manual', 1)"
            );
        }

        return parent::prepare($query, $options);
    }
}

function avesmapsStaettenRennenTestPdo(): AvesmapsStaettenRennenTestPdo
{
    $pdo = new AvesmapsStaettenRennenTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('CREATE TABLE map_features (
        id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, feature_type TEXT, feature_subtype TEXT,
        name TEXT, properties_json TEXT, min_x REAL, min_y REAL, is_active INTEGER DEFAULT 1)');
    $pdo->exec('CREATE TABLE settlement_place (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT NOT NULL,
        name TEXT NOT NULL, place_type TEXT, settlement_public_id TEXT NOT NULL, settlement_name TEXT NOT NULL,
        wiki_url TEXT, origin TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, created_by INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (settlement_public_id, name))');

    return $pdo;
}

$pdoRennen = avesmapsStaettenRennenTestPdo();
avesmapsStaettenTestOrtEinfuegen($pdoRennen, 'ort-rennen-start', 'Rennstart', 'stadt', 0.0, 0.0);
avesmapsStaettenTestOrtEinfuegen($pdoRennen, 'ort-rennen-ziel', 'Rennziel', 'kleinstadt', 10.0, 10.0);
$idRennen = avesmapsSettlementPlaceAdd($pdoRennen, ['name' => 'Rennstaette', 'settlement_public_id' => 'ort-rennen-start',
    'settlement_name' => 'Rennstart', 'origin' => 'manual'], 1);
// Zur Zeit der Kollisionspruefung gibt es noch KEINE gleichnamige Staette am Ziel -- die legt
// erst prepare() des UPDATE-Statements an, als stuende gerade ein zweiter Editor mittendrin.
$pdoRennen->rennenSimulieren = true;
$ergRennen = avesmapsSettlementPlaceMove($pdoRennen, $idRennen, 'ort-rennen-ziel', 1);
assert(
    ($ergRennen['ok'] ?? true) === false && $ergRennen['code'] === 'name_taken',
    'M3: ein echter Wettlauf (UNIQUE-Verletzung erst beim UPDATE) wird als name_taken gemeldet, nicht als Ausnahme: ' . json_encode($ergRennen)
);
$unveraendertRennen = $pdoRennen->prepare('SELECT settlement_public_id FROM settlement_place WHERE public_id = :pid');
$unveraendertRennen->execute(['pid' => $idRennen]);
assert($unveraendertRennen->fetchColumn() === 'ort-rennen-start', 'M3: die eigene Zeile bleibt bei einem Wettlauf unveraendert');
assert($pdoRennen->inTransaction() === false, 'M3: die Transaktion wurde bei der UNIQUE-Verletzung zurueckgerollt');
$pruefungen += 3;

// === 7) Deactivate setzt jetzt auch updated_at ===============================================
$idDeact = avesmapsSettlementPlaceAdd($pdo6, ['name' => 'Wird gleich weich geloescht', 'settlement_public_id' => 'ort-start',
    'settlement_name' => 'Startstadt', 'origin' => 'manual'], 1);
$vorDeact = $pdo6->query("SELECT updated_at FROM settlement_place WHERE public_id = '{$idDeact}'")->fetchColumn();
usleep(2000);
avesmapsSettlementPlaceDeactivate($pdo6, $idDeact, 1);
$nachDeact = $pdo6->query("SELECT updated_at FROM settlement_place WHERE public_id = '{$idDeact}'")->fetchColumn();
assert($nachDeact !== $vorDeact, 'Deactivate aktualisiert updated_at: ' . $vorDeact . ' -> ' . $nachDeact);
$pruefungen += 1;

// === 7b) M1: der Zeitstempel ist GARANTIERT groesser, auch bei Uhrenversatz PHP <-> DB ========
// avesmapsSettlementPlaceReadStamp haengt am MAX(updated_at) -- laeuft die DB-Uhr auch nur eine
// Millisekunde VOR der PHP-Uhr, muesste ein naiver `(new DateTimeImmutable())->format(...)` einen
// KLEINEREN oder gleichen Wert schreiben, und der Stempel bliebe stumm. Simuliert, indem eine
// bestehende Zeile eine Minute in die ZUKUNFT gesetzt wird, als stuende die DB-Uhr eine Minute vor.
$pdo7m = avesmapsStaettenEditorTestPdo();
avesmapsSettlementPlaceEnsureSchema($pdo7m);
avesmapsStaettenTestOrtEinfuegen($pdo7m, 'ort-m1-start', 'M1-Start', 'stadt', 0.0, 0.0);
avesmapsStaettenTestOrtEinfuegen($pdo7m, 'ort-m1-ziel', 'M1-Ziel', 'kleinstadt', 10.0, 10.0);
$idM1 = avesmapsSettlementPlaceAdd($pdo7m, ['name' => 'Zukunftszeile', 'settlement_public_id' => 'ort-m1-start',
    'settlement_name' => 'M1-Start', 'origin' => 'manual'], 1);
$zukunft = (new DateTimeImmutable('+1 minute'))->format('Y-m-d H:i:s.v');
$pdo7m->prepare('UPDATE settlement_place SET updated_at = :t WHERE public_id = :pid')
    ->execute(['t' => $zukunft, 'pid' => $idM1]);

$naechsterStempel = avesmapsSettlementPlaceNaechsterZeitstempel($pdo7m);
assert(
    $naechsterStempel > $zukunft,
    'M1: avesmapsSettlementPlaceNaechsterZeitstempel liegt SELBST bei Uhrenversatz nach dem bisherigen Hoechststand: '
    . $zukunft . ' -> ' . $naechsterStempel
);
$pruefungen += 1;

// Am echten Schreibweg (Umhaengen): der ETag-Stempel aendert sich, obwohl PHP-"jetzt" HINTER dem
// gespeicherten updated_at liegt -- eine Zeile bleibt aktiv (die Zaehlung von readStamp aendert
// sich also NICHT von selbst), nur der Zeitwert entscheidet.
$vorStempelM1 = avesmapsSettlementPlaceReadStamp($pdo7m);
$ergM1 = avesmapsSettlementPlaceMove($pdo7m, $idM1, 'ort-m1-ziel', 1);
assert(($ergM1['ok'] ?? false) === true, 'M1: das Umhaengen selbst gelingt trotz Uhrenversatz: ' . json_encode($ergM1));
$zeileNachM1 = $pdo7m->query("SELECT updated_at FROM settlement_place WHERE public_id = '{$idM1}'")->fetchColumn();
assert($zeileNachM1 > $zukunft, 'M1 (Move): der neue updated_at-Wert liegt trotz Uhrenversatz NACH dem bisherigen Hoechststand: ' . $zukunft . ' -> ' . $zeileNachM1);
$nachStempelM1 = avesmapsSettlementPlaceReadStamp($pdo7m);
assert($nachStempelM1 !== $vorStempelM1, 'M1 (Move): der ETag-Stempel aendert sich trotz Uhrenversatz: ' . $vorStempelM1 . ' -> ' . $nachStempelM1);
$pruefungen += 2;

// Und am Deaktivieren: derselbe Helfer, derselbe Beleg -- die gespeicherte Zeile bekommt trotz
// Uhrenversatz einen updated_at-Wert NACH dem bisherigen Hoechststand.
$idM1Deact = avesmapsSettlementPlaceAdd($pdo7m, ['name' => 'Noch eine Zukunftszeile', 'settlement_public_id' => 'ort-m1-start',
    'settlement_name' => 'M1-Start', 'origin' => 'manual'], 1);
$zukunft2 = (new DateTimeImmutable('+2 minutes'))->format('Y-m-d H:i:s.v');
$pdo7m->prepare('UPDATE settlement_place SET updated_at = :t WHERE public_id = :pid')
    ->execute(['t' => $zukunft2, 'pid' => $idM1Deact]);
avesmapsSettlementPlaceDeactivate($pdo7m, $idM1Deact, 1);
$zeileNachDeactM1 = $pdo7m->query("SELECT updated_at FROM settlement_place WHERE public_id = '{$idM1Deact}'")->fetchColumn();
assert($zeileNachDeactM1 > $zukunft2, 'M1 (Deactivate): der neue updated_at-Wert liegt trotz Uhrenversatz NACH dem bisherigen Hoechststand: ' . $zukunft2 . ' -> ' . $zeileNachDeactM1);
$pruefungen += 1;

// === 8) OrteSuchen ===========================================================================
$pdo8 = avesmapsStaettenEditorTestPdo();
avesmapsStaettenTestOrtEinfuegen($pdo8, 'orte-gareth', 'Gareth', 'metropole', 0.0, 0.0,
    ['wiki_settlement' => ['region' => 'Mittelreich']]);
avesmapsStaettenTestOrtEinfuegen($pdo8, 'orte-gar-anders', 'Gar Anders', 'dorf', 1.0, 1.0);
avesmapsStaettenTestOrtEinfuegen($pdo8, 'orte-etwas-gar', 'Etwas Gar', 'kleinstadt', 2.0, 2.0);
avesmapsStaettenTestOrtEinfuegen($pdo8, 'orte-inaktiv', 'Garquelle', 'dorf', 3.0, 3.0, [], false);
avesmapsStaettenTestOrtEinfuegen($pdo8, 'orte-kreuzung', 'Gar-Kreuzung', 'crossing', 4.0, 4.0);
avesmapsStaettenTestOrtEinfuegen($pdo8, 'orte-prozent', 'Gar%Prozent', 'dorf', 5.0, 5.0);
avesmapsStaettenTestOrtEinfuegen($pdo8, 'orte-unterstrich', 'Gar_Strich', 'dorf', 6.0, 6.0);

assert(avesmapsSettlementPlaceOrteSuchen($pdo8, 'G') === [], 'unter 2 Zeichen -> []');
$treffer = avesmapsSettlementPlaceOrteSuchen($pdo8, 'gar');
$namen = array_column($treffer, 'name');
assert(in_array('Gareth', $namen, true) && in_array('Gar Anders', $namen, true) && in_array('Etwas Gar', $namen, true),
    'nur aktive Siedlungsklassen kommen: ' . json_encode($namen));
assert(!in_array('Garquelle', $namen, true), 'inaktive faellt raus');
assert(!in_array('Gar-Kreuzung', $namen, true), 'Kreuzung ist keine Siedlungsklasse und faellt raus');
$praefixIndex = array_search('Gareth', $namen, true);
$innenIndex = array_search('Etwas Gar', $namen, true);
assert($praefixIndex !== false && $innenIndex !== false && $praefixIndex < $innenIndex,
    'Praefixtreffer stehen vor Innentreffern: ' . json_encode($namen));
$gareth = array_values(array_filter($treffer, static fn(array $z): bool => $z['name'] === 'Gareth'))[0] ?? null;
assert($gareth !== null && $gareth['lage'] === 'Mittelreich', 'lage kommt aus wiki_settlement.region: ' . json_encode($gareth));
assert($gareth['subtype'] === 'metropole', 'subtype = feature_subtype');
$garAnders = array_values(array_filter($treffer, static fn(array $z): bool => $z['name'] === 'Gar Anders'))[0] ?? null;
assert($garAnders !== null && $garAnders['lage'] === '', 'ohne wiki_settlement.region -> lage = leerer String');
$pruefungen += 7;

$trefferGedeckelt = avesmapsSettlementPlaceOrteSuchen($pdo8, 'gar', 1);
assert(count($trefferGedeckelt) === 1, 'der Deckel greift: ' . count($trefferGedeckelt));
$pruefungen += 1;

$trefferProzent = avesmapsSettlementPlaceOrteSuchen($pdo8, 'gar%pro');
assert(in_array('Gar%Prozent', array_column($trefferProzent, 'name'), true)
    && !in_array('Gar Anders', array_column($trefferProzent, 'name'), true),
    '%% im Suchwort wird woertlich gesucht, kein Wildcard: ' . json_encode(array_column($trefferProzent, 'name')));
$trefferUnterstrich = avesmapsSettlementPlaceOrteSuchen($pdo8, 'gar_str');
assert(in_array('Gar_Strich', array_column($trefferUnterstrich, 'name'), true)
    && !in_array('Gareth', array_column($trefferUnterstrich, 'name'), true),
    '_ im Suchwort wird woertlich gesucht, kein Platzhalter: ' . json_encode(array_column($trefferUnterstrich, 'name')));
$pruefungen += 2;

// === 8b) M2: ein Praefixtreffer geht bei > 60 Innentreffern nicht verloren ====================
// 65 reine "enthaelt"-Treffer (keine Praefixtreffer), DANACH -- also mit der jeweils hoechsten
// rowid -- GENAU EIN Praefixtreffer. Eine Abfrage ohne die `ORDER BY (name LIKE :p) DESC`
// aus M2 liefert ohne eigene Sortierung in Einfuegereihenfolge (SQLite-Tabellenscan) und liesse
// den Praefixtreffer bei einem blossen `LIMIT 60` aussen vor -- er waere die 66. Zeile.
$pdo8b = avesmapsStaettenEditorTestPdo();
for ($i = 1; $i <= 65; $i++) {
    avesmapsStaettenTestOrtEinfuegen($pdo8b, 'kern-innen-' . $i, 'Vorkernstadt ' . $i, 'dorf', (float) $i, (float) $i);
}
avesmapsStaettenTestOrtEinfuegen($pdo8b, 'kern-praefix', 'Kernburg', 'stadt', 0.0, 0.0);
$trefferKern = avesmapsSettlementPlaceOrteSuchen($pdo8b, 'kern');
assert(
    in_array('Kernburg', array_column($trefferKern, 'name'), true),
    'M2: der Praefixtreffer "Kernburg" kommt trotz 65 vorangehender Innentreffer durch: '
    . json_encode(array_column($trefferKern, 'name'))
);
assert(
    $trefferKern[0]['name'] === 'Kernburg',
    'M2: er steht an ERSTER Stelle -- die ORDER BY greift VOR dem LIMIT 60: '
    . json_encode(array_column($trefferKern, 'name'))
);
$pruefungen += 2;

// === 9) Namensnachbarn =======================================================================
$pdo9 = avesmapsStaettenEditorTestPdo();
avesmapsStaettenTestOrtEinfuegen($pdo9, 'nn-mitte', 'Mittelburg', 'stadt', 100.0, 100.0);
avesmapsStaettenTestOrtEinfuegen($pdo9, 'nn-nah', 'Mittelburg', 'gebaeude', 103.0, 100.0); // 3 Einheiten entfernt, gleicher Name
avesmapsStaettenTestOrtEinfuegen($pdo9, 'nn-fern', 'Mittelburg', 'dorf', 108.0, 100.0); // 8 Einheiten entfernt
avesmapsStaettenTestOrtEinfuegen($pdo9, 'nn-anderer-name', 'Andere Burg', 'dorf', 101.0, 100.0); // nah, aber anderer Name
avesmapsStaettenTestOrtEinfuegen($pdo9, 'nn-inaktiv', 'Mittelburg', 'dorf', 100.5, 100.0, [], false); // nah, aber inaktiv

$nachbarn = avesmapsSettlementPlaceNamensnachbarn($pdo9, 'nn-mitte');
assert(isset($nachbarn['mittelburg']), '3 Einheiten entfernt: der gleichnamige Punkt zaehlt: ' . json_encode($nachbarn));
assert(isset($nachbarn['andere burg']), 'ein anderer Name in Reichweite zaehlt ebenfalls');
$pruefungen += 2;

// --- Eckfall: die bbox-Vorfilterung prueft JEDE Achse fuer sich (BETWEEN x-5..x+5 UND
// y-5..y+5), das ergibt ein QUADRAT; der Radius ist aber ein KREIS. Ein Punkt in der Ecke des
// Quadrats (dx=4, dy=4) liegt innerhalb der bbox, aber sein echter Abstand ist sqrt(4^2+4^2)
// = 5,657 -- ausserhalb des Radius 5. Ohne die echte Distanzpruefung (statt nur der bbox) faende
// sich dieser Punkt faelschlich als Nachbar.
$pdo9d = avesmapsStaettenEditorTestPdo();
avesmapsStaettenTestOrtEinfuegen($pdo9d, 'nn-mitte', 'Mittelburg', 'stadt', 100.0, 100.0);
avesmapsStaettenTestOrtEinfuegen($pdo9d, 'nn-ecke', 'Mittelburg', 'dorf', 104.0, 104.0);
$nachbarnEcke = avesmapsSettlementPlaceNamensnachbarn($pdo9d, 'nn-mitte');
assert(
    $nachbarnEcke === [],
    'Eckfall der Suchbox (dx=4, dy=4 -> Abstand 5,657 > Radius 5) faellt bei der ECHTEN Distanz durch: ' . json_encode($nachbarnEcke)
);
$pruefungen += 1;

// Eigene Fixture ohne den 8-Einheiten-Punkt in derselben Menge zu verwaschen: gezielt pruefen,
// dass NUR der 3-Einheiten-Punkt den Namen beisteuert, indem wir den Namensnachbarn-Aufruf
// gegen eine Fixture ohne 'nn-nah' wiederholen und den Unterschied sehen.
$pdo9b = avesmapsStaettenEditorTestPdo();
avesmapsStaettenTestOrtEinfuegen($pdo9b, 'nn-mitte', 'Mittelburg', 'stadt', 100.0, 100.0);
avesmapsStaettenTestOrtEinfuegen($pdo9b, 'nn-fern', 'Weitburg', 'dorf', 108.0, 100.0); // 8 Einheiten entfernt
$nachbarnOhneNah = avesmapsSettlementPlaceNamensnachbarn($pdo9b, 'nn-mitte');
assert($nachbarnOhneNah === [], '8 Einheiten entfernt liegt AUSSERHALB des Radius: ' . json_encode($nachbarnOhneNah));
$pruefungen += 1;

assert(!isset($nachbarn['mittelburg']) || true, 'Platzhalter'); // no-op, Struktur bleibt lesbar
$selbstNichtEnthalten = avesmapsSettlementPlaceNamensnachbarn($pdo9, 'nn-mitte');
// Der Ort selbst (nn-mitte) darf sich nicht selbst als Nachbar melden -- das ist durch
// "public_id <> :ort" in der SQL sichergestellt; hier wird zusaetzlich geprueft, dass eine
// Stadt OHNE jeden anderen Punkt in Reichweite leer bleibt (der Ort zaehlt nicht sich selbst).
$pdo9c = avesmapsStaettenEditorTestPdo();
avesmapsStaettenTestOrtEinfuegen($pdo9c, 'nn-allein', 'Alleinburg', 'stadt', 500.0, 500.0);
assert(avesmapsSettlementPlaceNamensnachbarn($pdo9c, 'nn-allein') === [], 'der Ort selbst zaehlt nicht -- ohne Nachbarn: leer');
$pruefungen += 1;

assert(avesmapsSettlementPlaceNamensnachbarn($pdo9, 'gibt-es-nicht') === [], 'unbekannter Ort: leere Liste');
$pruefungen += 1;

// === Schritt 1: place-scope.php wird geladen, die Siedlungsklassen sind identisch =============
assert(
    AVESMAPS_PLACE_SCOPE_SETTLEMENT_SUBTYPES === ['metropole', 'grossstadt', 'stadt', 'kleinstadt', 'dorf'],
    'die geteilte Konstante traegt Dorf...Metropole: ' . json_encode(AVESMAPS_PLACE_SCOPE_SETTLEMENT_SUBTYPES)
);
$pruefungen += 1;

echo "OK: {$pruefungen} Pruefungen\n";
