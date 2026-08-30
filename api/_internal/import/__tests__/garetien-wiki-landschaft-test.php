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
        'CREATE TABLE wiki_region_staging (id INTEGER PRIMARY KEY AUTOINCREMENT, wiki_key TEXT, name TEXT, '
        . 'match_key TEXT, art TEXT, wiki_url TEXT)'
    );

    return $pdo;
}

// ⚠️ $wikiKey ist PFLICHT (nicht optional) -- Aufgabe 29 braucht ihn fuer die Zuweisung, und ein
// stillschweigend leerer Schluessel liesse genau die Faelle unbemerkt durchrutschen, die
// avesmapsGaretienWikiLandschaftZuweisung() unten prueft.
function avesmapsGaretienWikiLandschaftTestZeile(PDO $pdo, string $name, string $art, string $wikiKey): void
{
    $pdo->prepare('INSERT INTO wiki_region_staging (wiki_key, name, match_key, art, wiki_url) VALUES (?, ?, ?, ?, ?)')
        ->execute([$wikiKey, $name, avesmapsWikiSyncCreateMatchKey($name), $art, 'https://wiki.example/' . $wikiKey]);
}

// --- 1. Name UND Art passen -- "passt". Huegel/Huegelland ist der Fall aus der Bestellung.
$pdo = avesmapsGaretienWikiLandschaftTestPdo();
avesmapsGaretienWikiLandschaftTestZeile($pdo, 'Huegel', 'Hügelland', 'wiki:huegel');
$v = avesmapsGaretienWikiLandschaftVorschlag($pdo, 'Huegel', 'huegelland');
assert($v['status'] === 'passt', 'Name und Art passen -- muss "passt" sein: ' . $v['status']);
assert($v['name'] === 'Huegel');
assert($v['art'] === 'Hügelland');
// 🔴 AUFGABE 29 (Owner-Entscheid 30.08.2026): der Schluessel des Treffers reist mit -- genau das
// braucht avesmapsGaretienWikiLandschaftZuweisung(), um ihn ohne zweite Suche zuzuweisen.
assert($v['wiki_key'] === 'wiki:huegel', 'der Schluessel des Treffers muss mitreisen: ' . $v['wiki_key']);
$pruefungen += 4;

// --- 2. Name passt, Art nicht -- "warnung" (das "Ausrufezeichen" der Bestellung). Dieselbe
// Wiki-Zeile, aber unser Ziel-Subtyp waere eine ANDERE Flaechenart (die Zeile beschreibt laut
// Wiki eine Kueste, unser Import will sie als Huegelland anlegen).
$v = avesmapsGaretienWikiLandschaftVorschlag($pdo, 'Huegel', 'kueste');
assert($v['status'] === 'warnung', 'Name passt, Art nicht -- muss "warnung" sein: ' . $v['status']);
// 🔴 UND DER SCHLUESSEL REIST AUCH BEI "warnung" MIT -- Owner: "wenn nicht sieht der editor ja,
// dass der typ anders is ... des geht nur um die zuweisung". Eine abweichende Art ist sichtbar,
// kein Grund, den Schluessel zurueckzuhalten.
assert($v['wiki_key'] === 'wiki:huegel', 'der Schluessel reist auch bei "warnung" mit: ' . $v['wiki_key']);
$pruefungen += 2;

// --- 3. Kein Namensgleichstand -- "kein_treffer", und OHNE eine erfundene Art/Name/Schluessel-Angabe.
$v = avesmapsGaretienWikiLandschaftVorschlag($pdo, 'Ein Name, den niemand traegt', 'huegelland');
assert($v['status'] === 'kein_treffer', $v['status']);
assert($v['name'] === '' && $v['art'] === '' && $v['wiki_key'] === '', 'ohne Treffer darf nichts behauptet werden');
$pruefungen += 2;

// --- 4. Zwei gleichnamige Wiki-Artikel -- "mehrdeutig", NIE eine geratene Wahl zwischen ihnen --
// und deshalb auch KEIN wiki_key: ein geratener Schluessel waere schlimmer als keiner.
avesmapsGaretienWikiLandschaftTestZeile($pdo, 'Huegel', 'Wald', 'wiki:huegel-wald');
$v = avesmapsGaretienWikiLandschaftVorschlag($pdo, 'Huegel', 'huegelland');
assert($v['status'] === 'mehrdeutig', 'zwei Treffer duerfen sich nicht heimlich einigen: ' . $v['status']);
assert($v['name'] === '' && $v['art'] === '' && $v['wiki_key'] === '', 'mehrdeutig darf keinen Schluessel liefern');
$pruefungen += 2;

// --- 5. Eine Wiki-Art, die die Synonymtabelle nicht kennt ('' zurueck) -- ebenfalls "warnung",
// nie "passt": ein unbekanntes Ergebnis darf niemals als Treffer durchgehen.
$pdo2 = avesmapsGaretienWikiLandschaftTestPdo();
avesmapsGaretienWikiLandschaftTestZeile($pdo2, 'Alderman', 'Herrschaftsgebiet', 'wiki:alderman');
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

// =================================================================================================
// AUFGABE 29 (Owner-Entscheid 30.08.2026): avesmapsGaretienWikiLandschaftZuweisung() -- der
// Treffer als ZUWEISUNGSOBJEKT fuer properties.wiki_region. "das wiki braucht nicht gewinnen du
// brauchst du den key zuweisen ... des geht nur um die zuweisung."

// ⚠️ EIGENE, FRISCHE TABELLE fuer 8/9 -- $pdo traegt seit Pruefung 4 ZWEI "Huegel"-Zeilen
// (mehrdeutig); auf ihr weiterzupruefen wuerde "passt"/"warnung" gar nicht mehr erreichen.
$pdo4 = avesmapsGaretienWikiLandschaftTestPdo();
avesmapsGaretienWikiLandschaftTestZeile($pdo4, 'Huegel', 'Hügelland', 'wiki:huegel');

// --- 8. "passt" -- das volle Zuweisungsobjekt kommt zurueck, MIT dem Schluessel.
$z = avesmapsGaretienWikiLandschaftZuweisung($pdo4, 'Huegel', 'huegelland');
assert($z !== null, 'bei "passt" muss zugewiesen werden');
assert(($z['wiki_key'] ?? '') === 'wiki:huegel', 'derselbe Schluessel wie der Treffer: ' . json_encode($z));
$pruefungen += 2;

// --- 9. "warnung" (Name passt, Art nicht) -- WIRD TROTZDEM ZUGEWIESEN (die tragende Zusicherung
// der Aufgabe: Owner-Entscheid gegen einen Wettstreit um Werte, siehe oben).
$z = avesmapsGaretienWikiLandschaftZuweisung($pdo4, 'Huegel', 'kueste');
assert($z !== null, 'bei "warnung" (abweichende Art) wird trotzdem zugewiesen');
assert(($z['wiki_key'] ?? '') === 'wiki:huegel');
$pruefungen += 2;

// --- 10. "mehrdeutig" -- KEINE Zuweisung. Ein geratener Schluessel waere schlimmer als keiner.
// $pdo traegt seit Pruefung 4 ZWEI "Huegel"-Zeilen -- genau der Fall.
$z = avesmapsGaretienWikiLandschaftZuweisung($pdo, 'Huegel', 'huegelland');
assert($z === null, 'mehrdeutig darf nichts zuweisen: ' . json_encode($z));
$pruefungen++;

// --- 11. "kein_treffer" -- KEINE Zuweisung.
$z = avesmapsGaretienWikiLandschaftZuweisung($pdo3, 'Nirgendwo', 'huegelland');
assert($z === null, 'ohne Treffer darf nichts zugewiesen werden: ' . json_encode($z));
$pruefungen++;

echo "OK: {$pruefungen} Pruefungen\n";
