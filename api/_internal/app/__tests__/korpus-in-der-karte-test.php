<?php

declare(strict_types=1);

/**
 * DIE NAHT: reist der Korpus wirklich in der Kartennutzlast mit?
 * Ausfuehren (vom Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/korpus-in-der-karte-test.php
 *
 * 💣 WARUM ES DAS GIBT, UND ZWAR NACHTRAEGLICH. Am 02.09.2026 ging das Frontend nach Variante A
 * live -- Korpusname vorn statt Titel -- und die Karte zeigte weiter „Briefspiel". Beide Haelften
 * waren gruen: der PHP-Leser lieferte die Korpora, der JS-Renderer setzte sie vorn. Nur die NAHT
 * war ungeprueft: `api/app/map-features.php` band `source-corpus.php` gar nicht ein, also war
 * `function_exists('avesmapsSourceCorpusReadAll')` dort FALSCH -- und die Nutzlast trug leere
 * Korpora. Ohne Fehler, ohne Meldung, live an 599 Objekten.
 *
 * 🔴 Der Endpunkt selbst laesst sich nicht einbinden (er antwortet beim Laden). Geprueft wird
 * deshalb ZWEIERLEI: das VERHALTEN der zwei Leser gegen eine echte Datenbank, und die EINBINDUNG
 * im Endpunkt gegen seinen Quelltext -- letzteres per Tokenizer, nicht per preg_replace.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

require_once __DIR__ . '/../feature-sources.php';
require_once __DIR__ . '/../source-corpus.php';

$pruefungen = 0;
$zaehl = static function () use (&$pruefungen): void { $pruefungen++; };

// ---- 1. Das Verhalten: der Schluessel steht an der Zeile, der Name im Woerterbuch ---------------
$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
avesmapsEnsureFeatureSourceTables($pdo);
avesmapsEnsureSourceCorpusTable($pdo);
$pdo->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY, public_id TEXT, is_active INTEGER,
    feature_type TEXT, properties_json TEXT, revision INTEGER)');

$lege = static function (PDO $pdo, int $id, string $url, string $label) : void {
    $pdo->prepare('INSERT INTO sources (id, url, url_hash, label, source_type, is_official)
        VALUES (?, ?, ?, ?, "briefspiel", 0)')
        ->execute([$id, $url, hash('sha256', $url), $label]);
    $pdo->prepare('INSERT INTO feature_sources (entity_type, entity_public_id, source_id, status)
        VALUES ("settlement", ?, ?, "approved")')->execute(['ort-' . $id, $id]);
    $pdo->prepare('INSERT INTO map_features (public_id, is_active, feature_type, properties_json, revision)
        VALUES (?, 1, "location", "{}", 1)')->execute(['ort-' . $id]);
};
$lege($pdo, 1, 'https://westlande.de/albernia/index.php?title=Apfeldorn', 'Apfeldorn');
$lege($pdo, 2, 'https://f-shop.de/geographia', 'Geographia Aventurica');

avesmapsSourceCorpusSave($pdo, 'westlande.de',
    ['label' => 'AlberniaWiki', 'form' => 'belegstelle'], 9, true);

// 🪤 `avesmapsLoadFeatureSourceCatalog` ist gegen SQLite NICHT fahrbar: ihre Lebendigkeitsklausel
// traegt ein `COLLATE utf8mb4_unicode_ci`, das SQLite nicht kennt -- die Abfrage wirft, der
// try/catch faengt, und die Funktion gibt schweigend `[]` zurueck. Eine Zusicherung auf ihr
// Ergebnis waere hier also IMMER gruen und pruefte nichts. Die Produktionsform wird deshalb NICHT
// verbogen (AGENTS.md §9); geprueft wird stattdessen die Schluesselableitung selbst -- und dass
// die vier Zeilen, die sie an den Eintrag haengen, wirklich dastehen.
assert(avesmapsSourceCorpusKey('https://westlande.de/albernia/index.php?title=Apfeldorn') === 'westlande.de',
    'der Schluessel entsteht aus der registrierbaren Domain');
$zaehl();
assert(avesmapsLoadFeatureSourceCatalog($pdo) === [],
    'und die Katalogabfrage ist hier NICHT fahrbar -- das steht hier, damit niemand ihr Ergebnis '
    . 'fuer eine Zusicherung haelt');
$zaehl();

$woerterbuch = avesmapsLoadSourceCorporaForPayload($pdo);
assert(($woerterbuch['westlande.de']['label'] ?? '') === 'AlberniaWiki'
    && ($woerterbuch['westlande.de']['form'] ?? '') === 'belegstelle',
    'das Woerterbuch traegt Name und Form');
$zaehl();
// 💣 UND SONST NICHTS. `updated_by` ist eine Editorenkennung; Art, Lizenz und Nennung stehen
// bereits an der Quelle. Beides hat in einer OEFFENTLICHEN Nutzlast nichts verloren.
assert(array_keys($woerterbuch['westlande.de']) === ['label', 'form'],
    'und keine Editorenkennung, keine doppelten Felder');
$zaehl();

// ---- 2. Die NAHT: bindet der Endpunkt das Korpus-Modul ueberhaupt ein? --------------------------
// 🪤 Per Tokenizer, nicht per preg_replace: ein Blockkommentar-Entferner sieht ein `/*` in einer
// ZEILENkommentarzeile und frisst alles bis zum naechsten `*/` -- in `sync-monitor.php` waren das
// 380 Zeilen echter Code.
$ohneKommentare = static function (string $php): string {
    $raus = '';
    foreach (token_get_all($php) as $stueck) {
        if (is_array($stueck) && in_array($stueck[0], [T_COMMENT, T_DOC_COMMENT], true)) {
            continue;
        }
        $raus .= is_array($stueck) ? $stueck[1] : $stueck;
    }
    return $raus;
};
$endpunkt = $ohneKommentare((string) file_get_contents(__DIR__ . '/../../../app/map-features.php'));
assert(str_contains($endpunkt, "app/source-corpus.php'"),
    'der Endpunkt bindet das Korpus-Modul ein -- ohne das sind die Korpora live LEER');
$zaehl();
// 🔴 UND ZWAR NACH `feature-sources.php`: `source-corpus.php` haengt AN ihr, nicht umgekehrt.
assert(strpos($endpunkt, "app/feature-sources.php'") < strpos($endpunkt, "app/source-corpus.php'"),
    'und zwar danach -- das Korpus-Modul haengt an den Quellen');
$zaehl();
// ⚠️ Und die Nutzlast gibt es wirklich aus. Ohne diese Zeile waere alles darueber ein Vakuum:
// geladen, gelesen, und dann nicht mitgeschickt.
assert(str_contains($endpunkt, "'source_corpora' => (object) avesmapsLoadSourceCorporaForPayload(\$pdo)"),
    'und schickt das Woerterbuch mit');
$zaehl();

// ---- 3. Der Schluessel an der Katalogzeile -- am Quelltext, weil die Abfrage MySQL ist ----------
// ⚠️ Ersatzweise, siehe oben: die Abfrage laesst sich hier nicht fahren. Geprueft wird deshalb,
// dass die Zeilen ueberhaupt dastehen -- und dass sie NUR bei bekanntem Korpus setzen.
$lib = $ohneKommentare((string) file_get_contents(__DIR__ . '/../feature-sources.php'));
assert(str_contains($lib, "\$eintrag['corpus'] = \$key;"),
    'die Katalogzeile bekommt ihren Korpusschluessel');
$zaehl();
// 💣 NUR wo es einen gibt: ein Schluessel ins Leere waere im Browser ein Nachschlagen, das nie
// trifft -- 1.251 mal je Nutzlast, und er blaehte die Antwort ohne jeden Nutzen.
assert(preg_match("/if \(\\\$key !== '' && isset\(\\\$korpora\[\\\$key\]\)\) \{\s*\\\$eintrag\['corpus'\] = \\\$key;/", $lib) === 1,
    'und nur dann -- ein Schluessel ohne Eintrag im Woerterbuch waere ein Nachschlagen ins Leere');
$zaehl();
// ⚠️ EINMAL gelesen, nicht je Zeile: sonst zahlte die Nutzlast 1.384 Volldurchgaenge ueber eine
// Tabelle mit acht Zeilen.
// 🪤 Geprueft wird die REIHENFOLGE innerhalb der Funktion, NICHT die Zahl der Aufrufe im File:
// eine Zaehlung bricht beim naechsten legitimen Aufrufer anderswo und sagt ueber diese Stelle
// nichts. Genau so stand sie hier zuerst und fiel sofort um (es gibt vier, alle berechtigt).
$funktion = substr($lib, strpos($lib, 'function avesmapsLoadFeatureSourceCatalog'));
$funktion = substr($funktion, 0, strpos($funktion, "\nfunction "));
assert(strpos($funktion, 'avesmapsSourceCorpusReadAll($pdo)') < strpos($funktion, 'foreach ($statement->fetchAll'),
    'die Korpora werden VOR der Zeilenschleife gelesen, nicht in ihr');
$zaehl();
assert(substr_count($funktion, 'avesmapsSourceCorpusReadAll($pdo)') === 1,
    'und genau einmal in dieser Funktion');
$zaehl();

fwrite(STDOUT, "OK -- {$pruefungen} Zusicherungen erfuellt (Korpus in der Kartennutzlast).\n");
exit(0);
