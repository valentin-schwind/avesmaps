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
assert(str_contains($endpunkt, 'avesmapsLoadSourceCorporaForPayload($pdo)')
    && str_contains($endpunkt, "'source_corpora' => (object) \$sourceCorpora"),
    'liest das Woerterbuch und schickt es mit');
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

// ---- 4. DER ZWEITE ERZEUGER -- er ist der GROSSE Teil, nicht der Rest -------------------------
// 💣 WARUM ES DIESEN ABSCHNITT GIBT. Nach der Naht oben war die Anzeige immer noch zu zwei
// Dritteln wirkungslos: Katalogzeilen entstehen an ZWEI Stellen. Neben dem Bauer in
// `feature-sources.php` baut `avesmapsMapFeaturesMergeLegacyOtherSources` welche unter
// synthetischen `os:`-Kennungen -- die Altquellen aus `properties.other_source`, die nie in den
// Katalog uebernommen wurden. Live gemessen: 133 Zeilen mit Korpus, 290 ohne, obwohl ihr Wirt
// einen hat; und von 186 Zeilen mit dem Titel „Briefspiel" kamen 182 von dort.
// ⭐ Deshalb steht die Regel jetzt in EINER Funktion, die beide rufen -- und die wird hier
// wirklich GEFAHREN, nicht nur im Quelltext gesucht.
$korpora = avesmapsLoadSourceCorporaForPayload($pdo);
$mit = avesmapsFeatureSourceApplyCorpusKey(
    ['url' => 'x', 'label' => 'Briefspiel'],
    'https://www.herzogtum-weiden.net/politik/liste-bn/baronien/hzgl-weiden',
    ['herzogtum-weiden.net' => ['label' => 'Herzogtum Weiden', 'form' => 'belegstelle']]
);
assert(($mit['corpus'] ?? '') === 'herzogtum-weiden.net',
    'der geteilte Helfer setzt den Schluessel -- und `www.` gehoert nicht zum Korpus');
$zaehl();
assert(($mit['label'] ?? '') === 'Briefspiel',
    'und laesst die uebrigen Felder in Ruhe');
$zaehl();
// ⚠️ Ein Wirt OHNE Korpuszeile bekommt keinen Schluessel -- er waere im Browser ein
// Nachschlagen, das nie trifft.
assert(!array_key_exists('corpus',
    avesmapsFeatureSourceApplyCorpusKey(['url' => 'x'], 'https://f-shop.de/geographia', $korpora)),
    'ein Wirt ohne Korpuszeile bekommt keinen Schluessel');
$zaehl();
// ⚠️ Und ohne Korpora faellt alles offen aus -- Titel vorn, wie vor dem Umbau.
assert(!array_key_exists('corpus',
    avesmapsFeatureSourceApplyCorpusKey(['url' => 'x'], 'https://westlande.de/x', [])),
    'ohne Korpora bleibt die Zeile unberuehrt');
$zaehl();

// 💣 UND JETZT WIRD DER ZWEITE ERZEUGER WIRKLICH GEFAHREN, nicht im Quelltext gesucht.
// 🪤 Eine Mutationsprobe hat es erzwungen: die Fassung davor pruefte nur, DASS der Helfer
// gerufen wird -- und liess `avesmapsFeatureSourceApplyCorpusKey($eintrag, $url, [])` durch, also
// GENAU den Livezustand vom 02.09.2026 (Korpora da, aber nicht bis hierhin gereicht). Ein Test,
// der den Fehler nicht faengt, den es gerade gab, prueft die falsche Frage.
// ⚠️ Der Endpunkt laesst sich nicht einbinden (er antwortet beim Laden), also wird die Funktion
// aus seinem Quelltext GESCHNITTEN und unter eigenem Namen ausgefuehrt -- dieselbe Bauform wie
// beim Verdrahtungstest des Hintergrundklicks.
// Das `eval` fuehrt REPO-EIGENEN Quelltext in einem Testskript aus, nie fremde Eingabe und
// nie in Produktion -- es ist die Hausform fuer Endpunkte, die sich nicht einbinden lassen.
$roh = (string) file_get_contents(__DIR__ . '/../../../app/map-features.php');
$start = strpos($roh, 'function avesmapsMapFeaturesMergeLegacyOtherSources(');
assert($start !== false, 'die Funktion steht im Endpunkt');
$zaehl();
// Bis zur schliessenden Klammer am Zeilenanfang -- zeilenendenneutral, weil hier CRLF liegt und im
// Deploy-Tor LF (AGENTS.md §9).
$rumpf = str_replace("\r\n", "\n", substr($roh, $start));
$ende = strpos($rumpf, "\n}\n");
assert($ende !== false, 'und laesst sich sauber ausschneiden');
$zaehl();
$rumpf = substr($rumpf, 0, $ende + 2);
$rumpf = str_replace('function avesmapsMapFeaturesMergeLegacyOtherSources(',
    'function pruefeAltquellenErzeuger(', $rumpf);
if (!function_exists('avesmapsDecodeJsonColumn')) {
    eval('function avesmapsDecodeJsonColumn(mixed $v): array {'
        . ' $d = is_string($v) ? json_decode($v, true) : null; return is_array($d) ? $d : []; }');
}
eval($rumpf);

$zeilen = [[
    'is_active' => 1,
    'feature_type' => 'location',
    'public_id' => 'ort-99',
    'properties_json' => json_encode(['other_source' => [
        'url' => 'https://www.herzogtum-weiden.net/politik/liste-bn/baronien/hzgl-weiden',
        'label' => 'Briefspiel',
    ]]),
]];
$katalog = [];
$verweise = [];
pruefeAltquellenErzeuger($zeilen, $katalog, $verweise,
    ['herzogtum-weiden.net' => ['label' => 'Herzogtum Weiden', 'form' => 'belegstelle']]);
assert(isset($katalog['os:ort-99']), 'die Altquelle wird zu einer Katalogzeile');
$zaehl();
// 🔴 DIE ZUSICHERUNG, UM DIE ES GEHT: sie traegt ihren Korpus. Ohne sie war die Anzeige
// live zu zwei Dritteln wirkungslos, und alle Tests waren gruen.
assert(($katalog['os:ort-99']['corpus'] ?? '') === 'herzogtum-weiden.net',
    'und traegt ihren Korpusschluessel -- die Korpora kommen wirklich bis hierhin');
$zaehl();
assert(($katalog['os:ort-99']['label'] ?? '') === 'Briefspiel',
    'ihr Titel bleibt, was er war -- vorn setzt ihn erst der Browser');
$zaehl();
// ⚠️ Und ohne Korpora bleibt es beim alten Verhalten.
$katalog2 = [];
$verweise2 = [];
pruefeAltquellenErzeuger($zeilen, $katalog2, $verweise2, []);
assert(isset($katalog2['os:ort-99']) && !array_key_exists('corpus', $katalog2['os:ort-99']),
    'ohne Korpora entsteht die Zeile weiter, nur ohne Schluessel');
$zaehl();

// Und der zweite Erzeuger ruft ihn wirklich -- am Quelltext, weil der Endpunkt sich nicht
// einbinden laesst (er antwortet beim Laden).
assert(str_contains($endpunkt, 'avesmapsFeatureSourceApplyCorpusKey(['),
    'der os:-Erzeuger setzt den Schluessel durch DIESELBE Funktion');
$zaehl();
// 🔴 Und er bekommt sie HEREINGEREICHT. Eine eigene Ableitung im Endpunkt waere die zweite
// Wahrheit ueber `avesmapsSourceCorpusKey`, die AGENTS.md §5 verbietet -- und sie liefe beim
// ersten Sonderfall auseinander (`wiki.punin.de` gegen `punin.de`).
assert(preg_match('/function avesmapsMapFeaturesMergeLegacyOtherSources\([^)]*array \$korpora/', $endpunkt) === 1,
    'und bekommt die Korpora hereingereicht, statt sie selbst abzuleiten');
$zaehl();
assert(!str_contains($endpunkt, 'function avesmapsSourceCorpusKey'),
    'der Endpunkt rechnet die registrierbare Domain NICHT selbst nach');
$zaehl();

// ---- 5. DER RIEGEL, DER ZWEIMAL VERGESSEN WURDE ------------------------------------------------
// 💣 EIN CODEFIX AN DIESER ANTWORT IST ERST LIVE, WENN DIE FASSUNGSNUMMER STEIGT. Der
// Servervorrat (`avesmapsMapFeaturesCacheFile`) haengt am ETag, und der traegt
// AVESMAPS_MAP_FEATURES_PAYLOAD_VERSION -- `map_revision` bewegt sich von einer Codeaenderung
// nicht. Am 02.09.2026 ging genau das ZWEIMAL daneben: nach zwei gruenen Deploys lieferte die
// Seite Zeichen fuer Zeichen dieselbe alte Nutzlast (133 Zeilen mit Korpus, 290 ohne), und beide
// Male fiel es erst an der Live-Messung auf, nicht im Testfeld.
// ⚠️ Gemessen wird, dass die Nummer die Korpus-Aenderung UEBERHOLT hat -- nicht ihr genauer
// Wert: sie steigt auch aus fremden Gruenden, und ein fester Wert waere beim naechsten Bump einer
// anderen Sitzung rot, ohne dass hier etwas falsch waere.
preg_match('/AVESMAPS_MAP_FEATURES_PAYLOAD_VERSION = (\\d+);/', $endpunkt, $treffer);
assert(isset($treffer[1]) && (int) $treffer[1] >= 21,
    'die Fassungsnummer der Nutzlast ist seit dem Korpus-Umbau gestiegen -- sonst sieht sie niemand');
$zaehl();
// 🔴 Und die Begruendung steht daneben. Eine blosse Zahl sagt dem naechsten Leser nicht,
// warum sie sich bewegt hat; die Liste darueber ist der einzige Ort, an dem das steht.
// Gegen den ROHtext, nicht gegen $endpunkt: dort sind die Kommentare ja gerade entfernt.
assert(str_contains($roh, '// 21 (02.09.2026)'),
    'und traegt ihren Grund in der Liste ueber der Konstante');
$zaehl();

fwrite(STDOUT, "OK -- {$pruefungen} Zusicherungen erfuellt (Korpus in der Kartennutzlast).\n");
exit(0);
