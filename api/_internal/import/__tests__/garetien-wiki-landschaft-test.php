<?php

declare(strict_types=1);

// Der Vorschlag "Wiki-Landschaft" der Einzelansicht (avesmapsGaretienWikiLandschaftVorschlag).
// Owner 30.08.2026: "wenn name und typ passen, passts, wenn name passt aber typ nicht gefunden
// -> ausrufezeichen".
//
// 🔴 SQLITE, VON HAND, OHNE avesmapsWikiRegionEnsureTables() -- dessen DDL ist MySQL-Syntax
// (AUTO_INCREMENT/ENGINE=InnoDB) und bricht unter sqlite::memory:. Dasselbe Muster wie
// avesmapsGaretienPlanTestPdo() (garetien-plan.php): eine schlanke, sqlite-taugliche Tabelle mit
// genau den Spalten, die die gepruefte Funktion wirklich liest.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
//           api/_internal/import/__tests__/garetien-wiki-landschaft-test.php

require_once __DIR__ . '/../garetien-wiki-landschaft.php';

$pruefungen = 0;

function avesmapsGaretienWikiLandschaftTestPdo(): PDO
{
    $pdo = new PDO('sqlite::memory:');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->exec(
        'CREATE TABLE wiki_region_staging (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, '
        . 'match_key TEXT, art TEXT)'
    );

    return $pdo;
}

function avesmapsGaretienWikiLandschaftTestZeile(PDO $pdo, string $name, string $art): void
{
    $pdo->prepare('INSERT INTO wiki_region_staging (name, match_key, art) VALUES (?, ?, ?)')
        ->execute([$name, avesmapsWikiSyncCreateMatchKey($name), $art]);
}

// --- 1. Name UND Art passen -- "passt". Huegel/Huegelland ist der Fall aus der Bestellung.
$pdo = avesmapsGaretienWikiLandschaftTestPdo();
avesmapsGaretienWikiLandschaftTestZeile($pdo, 'Huegel', 'Hügelland');
$v = avesmapsGaretienWikiLandschaftVorschlag($pdo, 'Huegel', 'huegelland');
assert($v['status'] === 'passt', 'Name und Art passen -- muss "passt" sein: ' . $v['status']);
assert($v['name'] === 'Huegel');
assert($v['art'] === 'Hügelland');
$pruefungen += 3;

// --- 2. Name passt, Art nicht -- "warnung" (das "Ausrufezeichen" der Bestellung). Dieselbe
// Wiki-Zeile, aber unser Ziel-Subtyp waere eine ANDERE Flaechenart (die Zeile beschreibt laut
// Wiki eine Kueste, unser Import will sie als Huegelland anlegen).
$v = avesmapsGaretienWikiLandschaftVorschlag($pdo, 'Huegel', 'kueste');
assert($v['status'] === 'warnung', 'Name passt, Art nicht -- muss "warnung" sein: ' . $v['status']);
$pruefungen++;

// --- 3. Kein Namensgleichstand -- "kein_treffer", und OHNE eine erfundene Art/Name-Angabe.
$v = avesmapsGaretienWikiLandschaftVorschlag($pdo, 'Ein Name, den niemand traegt', 'huegelland');
assert($v['status'] === 'kein_treffer', $v['status']);
assert($v['name'] === '' && $v['art'] === '', 'ohne Treffer darf nichts behauptet werden');
$pruefungen += 2;

// --- 4. Zwei gleichnamige Wiki-Artikel -- "mehrdeutig", NIE eine geratene Wahl zwischen ihnen.
avesmapsGaretienWikiLandschaftTestZeile($pdo, 'Huegel', 'Wald');
$v = avesmapsGaretienWikiLandschaftVorschlag($pdo, 'Huegel', 'huegelland');
assert($v['status'] === 'mehrdeutig', 'zwei Treffer duerfen sich nicht heimlich einigen: ' . $v['status']);
assert($v['name'] === '' && $v['art'] === '');
$pruefungen += 2;

// --- 5. Eine Wiki-Art, die die Synonymtabelle nicht kennt ('' zurueck) -- ebenfalls "warnung",
// nie "passt": ein unbekanntes Ergebnis darf niemals als Treffer durchgehen.
$pdo2 = avesmapsGaretienWikiLandschaftTestPdo();
avesmapsGaretienWikiLandschaftTestZeile($pdo2, 'Alderman', 'Herrschaftsgebiet');
$v = avesmapsGaretienWikiLandschaftVorschlag($pdo2, 'Alderman', 'huegelland');
assert($v['status'] === 'warnung', 'eine unbekannte Art darf kein "passt" erzeugen: ' . $v['status']);
$pruefungen++;

// --- 6. Leerer Name -- "kein_treffer", KEINE Abfrage noetig (die Gegenprobe: eine leere Tabelle
// wuerfe sonst nicht auf, aber ein leerer Name soll erst gar nicht suchen).
$pdo3 = avesmapsGaretienWikiLandschaftTestPdo();
$v = avesmapsGaretienWikiLandschaftVorschlag($pdo3, '   ', 'huegelland');
assert($v['status'] === 'kein_treffer');
$pruefungen++;

// --- 7. Fehlt die Tabelle (frische Installation, noch nie ein Regionen-Sync gelaufen) --
// "kein_treffer", NIE eine geworfene Ausnahme. Dieselbe zurueckhaltende Richtung wie
// avesmapsGaretienQuellenBestand.
$pdoOhneTabelle = new PDO('sqlite::memory:');
$pdoOhneTabelle->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$v = avesmapsGaretienWikiLandschaftVorschlag($pdoOhneTabelle, 'Huegel', 'huegelland');
assert($v['status'] === 'kein_treffer', 'eine fehlende Tabelle darf nicht werfen: ' . $v['status']);
$pruefungen++;

echo "OK: {$pruefungen} Pruefungen\n";
