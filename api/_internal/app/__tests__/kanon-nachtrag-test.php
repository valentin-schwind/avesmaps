<?php

declare(strict_types=1);

/**
 * DAS KANON-ETIKETT NACH EINER QUELLEN-SCHREIBAKTION.
 *
 * Ausfuehren (aus dem Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/kanon-nachtrag-test.php
 *
 * 🚩 DER BEFUND (Owner-Meldung 09.09.2026, mit Bild): die Landschaftsflaeche „Schwanenbruch" trug am
 * Kopf OFFIZIELL, waehrend darunter ihre einzige Quelle als „INOFFIZIELL │ Briefspiel" stand. Der
 * Server hatte richtig abgeleitet -- live in der Nutzlast nachgemessen. Die Auskunft erreichte den
 * Browser nur nie: syncFeatureSourcesToClientCache traegt nach einer Schreibaktion die VERWEISE in
 * den Kartenspeicher nach und laesst die Kanon-Tafel unberuehrt, und resolveFeatureKanon
 * (js/ui/popups.js) liest „Verweise da + keine Abweichung" als Vorgabe „offiziell".
 *
 * 💣 UND DIE FIXTURE, DIE HIER NAHELAG, HAETTE NICHTS GEPRUEFT. Der erste Entwurf dieses Tests baute
 * `sources` und `feature_sources` in SQLite auf und rief den PDO-Weg. Gemessen: sowohl
 * avesmapsLoadFeatureSourceRefs als auch avesmapsLoadFeatureSourceCatalog geben dort STILL `[]`
 * zurueck -- ihre gemeinsame Klausel avesmapsFeatureSourceLiveEntityClause traegt
 * `COLLATE utf8mb4_unicode_ci`, das SQLite nicht kennt, und beide fangen die Ausnahme ab. Jede
 * Zusicherung ueber ein abgeleitetes Etikett waere gegen eine leere Eingabe gelaufen.
 * ⭐ Deshalb ist der Rechner in KERN und TUER geschnitten (dasselbe Muster wie
 * avesmapsEcosystemReadChangeLog, AGENTS.md §11): der Kern nimmt Katalog, Verweise und Namensraeume
 * als Parameter und wird hier wirklich gefahren; die Tuer laedt sie und wird an der Naht geprueft.
 */

require_once __DIR__ . '/../feature-sources.php';

if (assert_options(ASSERT_ACTIVE) !== 1 || ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: mit -d zend.assertions=1 starten, sonst ist assert() wirkungslos.\n");
    exit(1);
}

// Die Katalogform ist die von avesmapsLoadFeatureSourceCatalog: id => {label, type, official}.
$katalog = [
    1 => ['label' => 'Schwanenbruch auf garetien.de', 'type' => 'briefspiel', 'official' => 0],
    2 => ['label' => 'Geographia Aventurica', 'type' => 'regionalspielhilfe', 'official' => 1],
];

// ---- 1. Der reine Kern: jede angefragte Kennung bekommt eine Antwort ---------------------------

// A: der gemeldete Fall -- eine Landschaftsflaeche mit EINER inoffiziellen Quelle, ohne Zuweisung.
$tafel = avesmapsFeatureSourcesKanonAusEingaben(
    'ecosystem',
    ['eco-A'],
    $katalog,
    ['ecosystem:eco-A' => [['source_id' => 1]]],
    []
);
assert(($tafel['eco-A']['kanon'] ?? null) === 'inoffiziell',
    'A: eine inoffizielle Quelle ohne Zuweisung ergibt „inoffiziell" -- der gemeldete Fall');
assert(($tafel['eco-A']['bezeichner_type'] ?? null) === 'briefspiel',
    'A: der Bezeichner ist die ART der Quelle, nie ihr Titel (Owner 03.09.2026)');

// B: dieselbe inoffizielle Quelle, ABER mit Hauptraum-Zuweisung -- die Zuweisung schlaegt sie.
// 💣 Ohne diesen Fall waere der Umbau eine neue Regression: der Quellen-Endpunkt kennt die
// Wiki-Adresse nicht (anders als der Zuweisungsweg, der sie gerade geschrieben hat). Ohne
// Namensraum verloere jedes zugewiesene Objekt sein „offiziell", sobald ihm jemand eine
// inoffizielle Quelle eintraegt -- schlimmer als der Fehler, der hier repariert wird.
$tafel = avesmapsFeatureSourcesKanonAusEingaben(
    'settlement',
    ['ort-B'],
    $katalog,
    ['settlement:ort-B' => [['source_id' => 1]]],
    ['settlement:ort-B' => 0]
);
assert(($tafel['ort-B']['kanon'] ?? null) === 'offiziell',
    'B: die Hauptraum-ZUWEISUNG schlaegt die inoffizielle Quelle (Rangfolge seit 08.09.2026)');
assert(!isset($tafel['ort-B']['bezeichner_type']) && !isset($tafel['ort-B']['bezeichner_label']),
    'B: „offiziell" ist immer die volle Pille, ohne Bezeichner (Owner 03.09.2026)');

// C: eine PUBLIKATION macht keinen Kanon -- und „kein Etikett" wird AUSDRUECKLICH gemeldet.
$tafel = avesmapsFeatureSourcesKanonAusEingaben(
    'settlement',
    ['ort-C'],
    $katalog,
    ['settlement:ort-C' => [['source_id' => 2, 'reference_kind' => 'publikation']]],
    []
);
assert(array_key_exists('ort-C', $tafel) && $tafel['ort-C'] === ['kanon' => ''],
    'C: eine Publikation macht keinen Kanon -- und weil das Objekt VERWEISE hat, wird „kein Etikett" '
    . 'als `[kanon => ""]` ausdruecklich gemeldet. Genau diese Unterscheidung traf schon der '
    . 'Einzelweg seit dem 02.09.2026; sie hier zu `null` zu vereinfachen haette die Wiki-Zuweisung '
    . 'mitgebrochen.');

// D: eine Kennung ohne jede Quelle steht trotzdem in der Tafel -- als `null`.
// 🔴 Die zwei Antworten sind NICHT dasselbe: `[kanon => ""]` heisst „ich habe nachgesehen, es gibt
// kein Etikett" und wird vom Client GESETZT; `null` heisst „unbelegt" und LOESCHT den Eintrag. Ein
// FEHLENDER Schluessel hiesse „nicht gefragt" und liesse den alten stehen -- genau der Unterschied,
// an dem der gemeldete Fehler haengt.
$tafel = avesmapsFeatureSourcesKanonAusEingaben('settlement', ['ort-D'], $katalog, [], []);
assert(array_key_exists('ort-D', $tafel) && $tafel['ort-D'] === null,
    'D: jede ANGEFRAGTE Kennung steht in der Tafel, auch die ohne Quelle');

// E: mehrere Kennungen in EINEM Aufruf -- der Wege-Verteiler schickt bis zu 250.
$tafel = avesmapsFeatureSourcesKanonAusEingaben(
    'path',
    ['weg-1', 'weg-2', 'weg-3'],
    $katalog,
    ['path:weg-1' => [['source_id' => 1]], 'path:weg-2' => [['source_id' => 2]]],
    []
);
assert(count($tafel) === 3, 'E: drei gefragt, drei beantwortet');
assert(($tafel['weg-1']['kanon'] ?? null) === 'inoffiziell', 'E: weg-1 inoffiziell');
assert(($tafel['weg-2']['kanon'] ?? null) === 'offiziell', 'E: weg-2 offiziell');
assert($tafel['weg-3'] === null, 'E: weg-3 hat keine Quelle und bekommt kein Etikett');

// F: FREMDE Kennungen im Verweis-Vorrat aendern nichts -- gefragt ist, was gefragt wurde.
$tafel = avesmapsFeatureSourcesKanonAusEingaben(
    'path',
    ['weg-1'],
    $katalog,
    ['path:weg-1' => [['source_id' => 1]], 'path:weg-999' => [['source_id' => 2]]],
    []
);
assert(array_keys($tafel) === ['weg-1'], 'F: nur die gefragte Kennung wird beantwortet');

// G: leere Eingaben ergeben eine leere Tafel, keinen Fehler.
assert(avesmapsFeatureSourcesKanonAusEingaben('', ['x'], $katalog, [], []) === [], 'G: ohne Objektart nichts');
assert(avesmapsFeatureSourcesKanonAusEingaben('path', [], $katalog, [], []) === [], 'G: ohne Kennungen nichts');
assert(avesmapsFeatureSourcesKanonAusEingaben('path', ['', '  '], $katalog, [], []) === [],
    'G: leere Kennungen fallen heraus, statt einen Schluessel „path:" zu erzeugen');

// H: dieselbe Kennung zweimal wird einmal beantwortet.
$tafel = avesmapsFeatureSourcesKanonAusEingaben('path', ['weg-1', 'weg-1'], $katalog,
    ['path:weg-1' => [['source_id' => 1]]], []);
assert(count($tafel) === 1, 'H: Dubletten in der Anfrage werden zusammengefasst');

// ---- 2. Der Namensraum-Leser gegen die Datenbank ------------------------------------------------
// ⚠️ Dieser Teil IST auf SQLite pruefbar: seine Abfrage traegt kein COLLATE (siehe Kopf).

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec("CREATE TABLE map_features (
    id INTEGER PRIMARY KEY, public_id TEXT, feature_type TEXT, name TEXT DEFAULT '',
    properties_json TEXT, is_active INTEGER DEFAULT 1
)");
$pdo->exec("CREATE TABLE political_territory (
    id INTEGER PRIMARY KEY, public_id TEXT, wiki_key TEXT, wiki_url TEXT, is_active INTEGER DEFAULT 1
)");
$pdo->exec("CREATE TABLE political_territory_wiki (id INTEGER PRIMARY KEY, wiki_key TEXT, wiki_url TEXT)");

$einfuegen = $pdo->prepare(
    "INSERT INTO map_features (public_id, feature_type, properties_json, is_active) VALUES (?, ?, ?, ?)"
);
// Ein zugewiesener Ort im Hauptraum.
$einfuegen->execute(['ort-haupt', 'location', json_encode([
    'public_id' => 'ort-haupt', 'feature_type' => 'location',
    'wiki_settlement' => ['wiki_key' => 'wiki:gareth', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Gareth'],
]), 1]);
// Ein zugewiesener Ort im inoffiziellen Raum 222.
$einfuegen->execute(['ort-ns222', 'location', json_encode([
    'public_id' => 'ort-ns222', 'feature_type' => 'location',
    'wiki_settlement' => ['wiki_key' => 'wiki:x', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Inoffiziell:Apfeldorn'],
]), 1]);
// 💣 EIN PHANTOMLINK: `wiki_url` ohne Zuweisungsnest. Der Lesepfad raet ihn per Namensabgleich dazu
// (99 Orte, 12 Wege im Bestand). Er darf NIE ein „offiziell" ausloesen, das niemand gesetzt hat.
$einfuegen->execute(['ort-phantom', 'location', json_encode([
    'public_id' => 'ort-phantom', 'feature_type' => 'location',
    'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Irgendwas',
]), 1]);
// Eine geloeschte Zeile zaehlt nicht.
$einfuegen->execute(['ort-tot', 'location', json_encode([
    'public_id' => 'ort-tot', 'feature_type' => 'location',
    'wiki_settlement' => ['wiki_key' => 'wiki:tot', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Tot'],
]), 0]);

$raeume = avesmapsFeatureSourcesWikiNamespacesFuerKennungen(
    $pdo, 'settlement', ['ort-haupt', 'ort-ns222', 'ort-phantom', 'ort-tot', 'ort-gibtsnicht']
);
assert(($raeume['settlement:ort-haupt'] ?? null) === 0,
    'der Hauptraum meldet sich als 0 -- nicht als null, sonst waere er von „keine Aussage" nicht zu unterscheiden');
assert(($raeume['settlement:ort-ns222'] ?? null) === 222, 'ns 222 wird erkannt');
assert(!isset($raeume['settlement:ort-phantom']),
    'ein geratener wiki_url OHNE Zuweisungsnest ergibt KEINEN Namensraum (99 Phantome im Bestand)');
assert(!isset($raeume['settlement:ort-tot']), 'eine inaktive Zeile zaehlt nicht');
assert(!isset($raeume['settlement:ort-gibtsnicht']), 'eine unbekannte Kennung ergibt nichts');

// 💣 EIN WEG BRAUCHT SEINE GESCHWISTER -- die Regression, die ein Pruefagent am 09.09.2026 fand.
// avesmapsMapFeaturesWikiNamespaces ruft am Ende avesmapsMapFeaturesWegGruppeErbtZuweisung, und die
// gibt eine Zuweisung nur weiter, wenn sie ALLE Segmente der Namensgruppe sieht. Wurde nur die
// gefragte Zeile geladen, gab es nie ein Geschwister: das blosse OEFFNEN des Quellenkastens eines
// Abschnitts kippte dessen Etikett von „offiziell" auf „inoffiziell │ Briefspiel" -- und der
// Client-Nachtrag schrieb den falschen Wert in die Kanon-Tafel, wo er bis zum Neuladen stehenblieb.
// Es ist der Pergelbach-Fehler („ein Weg, zwei Aussagen") in neuer Verkleidung.
$pdo->exec("INSERT INTO map_features (public_id, feature_type, name, properties_json) VALUES
    ('seg-A', 'path', 'Reichsstrasse 2', '" . json_encode([
        'public_id' => 'seg-A', 'feature_type' => 'path', 'feature_subtype' => 'Reichsstrasse',
        'name' => 'Reichsstrasse 2',
        'wiki_path' => ['wiki_key' => 'wiki:rs2', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Reichsstrasse'],
    ]) . "')");
$pdo->exec("INSERT INTO map_features (public_id, feature_type, name, properties_json) VALUES
    ('seg-B', 'path', 'Reichsstrasse 2', '" . json_encode([
        'public_id' => 'seg-B', 'feature_type' => 'path', 'feature_subtype' => 'Reichsstrasse',
        'name' => 'Reichsstrasse 2',
    ]) . "')");

$nurB = avesmapsFeatureSourcesWikiNamespacesFuerKennungen($pdo, 'path', ['seg-B']);
assert(($nurB['path:seg-B'] ?? null) === 0,
    'seg-B erbt den Hauptraum seines Wegs, OBWOHL nur seg-B gefragt wurde -- ohne das Nachladen der '
    . 'Geschwister faellt die Erbschaft aus, und ein blosses Ansehen kippt das Etikett');

// Und das Etikett folgt: eine inoffizielle Quelle darf die geerbte Zuweisung NICHT schlagen.
$tafelB = avesmapsFeatureSourcesKanonAusEingaben(
    'path', ['seg-B'], $katalog, ['path:seg-B' => [['source_id' => 1]]], $nurB
);
assert(($tafelB['seg-B']['kanon'] ?? null) === 'offiziell',
    'die geerbte Hauptraum-Zuweisung schlaegt die inoffizielle Quelle -- sonst stuende derselbe Weg '
    . 'einmal offiziell und einmal inoffiziell da');

// ⚠️ Ein Segment OHNE Namen kann weder erben noch vererben -- und darf nicht zum Nachladen fuehren.
$pdo->exec("INSERT INTO map_features (public_id, feature_type, name, properties_json) VALUES
    ('seg-namenlos', 'path', '', '" . json_encode([
        'public_id' => 'seg-namenlos', 'feature_type' => 'path', 'feature_subtype' => 'Pfad',
    ]) . "')");
$namenlos = avesmapsFeatureSourcesWikiNamespacesFuerKennungen($pdo, 'path', ['seg-namenlos']);
assert(!isset($namenlos['path:seg-namenlos']), 'ein namenloses Segment erbt nichts');

// Territorien lesen aus ihrer eigenen Tabelle.
$pdo->exec("INSERT INTO political_territory (public_id, wiki_key, wiki_url) VALUES
    ('terr-A', 'wiki:a', 'https://de.wiki-aventurica.de/wiki/Inoffiziell:Tayarret')");
$raeume = avesmapsFeatureSourcesWikiNamespacesFuerKennungen($pdo, 'territory', ['terr-A', 'terr-B']);
assert(($raeume['territory:terr-A'] ?? null) === 222, 'ein Territorium liest aus political_territory');
assert(!isset($raeume['territory:terr-B']), 'ein unbekanntes Territorium ergibt nichts');

// ⚠️ Objektarten ohne Zuweisungsnest (ecosystem, citymap, lore) ergeben nichts -- keine Aussage,
// dort entscheiden die Quellen allein. Das ist der gemeldete Fall.
assert(avesmapsFeatureSourcesWikiNamespacesFuerKennungen($pdo, 'ecosystem', ['eco-A']) === [],
    'ecosystem hat kein Zuweisungsnest -- der Leser sagt nichts, statt etwas zu raten');

// ---- 3. Die Naht: eine Rechnung, nicht drei ----------------------------------------------------

$quelltext = static function (string $name): string {
    $r = new ReflectionFunction($name);

    return implode('', array_slice(
        file($r->getFileName()),
        $r->getStartLine() - 1,
        $r->getEndLine() - $r->getStartLine() + 1
    ));
};

$einsRumpf = $quelltext('avesmapsFeatureSourcesKanonFuerEines');
assert(strpos($einsRumpf, 'avesmapsFeatureSourcesKanonFuerMehrere') !== false,
    'der Einzelweg geht durch den Mehrfach-Rechner');
assert(strpos($einsRumpf, 'avesmapsFeatureSourcesDeriveKanon') === false,
    'der Einzelweg leitet NICHTS mehr selbst ab -- eine zweite Ableitung waere genau die Divergenz, '
    . 'an der die Rangfolge zwischen ns 222 und Quellzeile schon einmal auseinandergelaufen ist');

$mehrRumpf = $quelltext('avesmapsFeatureSourcesKanonFuerMehrere');
assert(strpos($mehrRumpf, 'avesmapsFeatureSourcesKanonAusEingaben') !== false,
    'die Tuer ruft den reinen Kern');
assert(strpos($mehrRumpf, 'avesmapsFeatureSourcesDeriveKanon') === false,
    'die Tuer leitet nichts selbst ab -- sie laedt nur');

$kernRumpf = $quelltext('avesmapsFeatureSourcesKanonAusEingaben');
assert(strpos($kernRumpf, 'PDO') === false && strpos($kernRumpf, '$pdo') === false,
    'der Kern ist rein -- ohne ihn waere dieser Test gegen eine leere SQLite-Eingabe gelaufen');

// Die uebergebene Adresse schlaegt die gespeicherte: der Zuweisungsweg hat sie gerade geschrieben.
$tafel = avesmapsFeatureSourcesKanonFuerMehrere(
    $pdo, 'settlement', ['ort-haupt'], ['ort-haupt' => 'https://de.wiki-aventurica.de/wiki/Inoffiziell:Gareth']
);
assert(($tafel['ort-haupt']['kanon'] ?? null) === 'inoffiziell',
    'die UEBERGEBENE Adresse gewinnt gegen die gespeicherte');
// Und eine ausdruecklich LEERE Adresse nimmt den gespeicherten Raum zurueck -- sonst saehe der
// Editor sein eigenes Entfernen einer Zuweisung nicht.
$tafel = avesmapsFeatureSourcesKanonFuerMehrere($pdo, 'settlement', ['ort-haupt'], ['ort-haupt' => '']);
assert($tafel['ort-haupt'] === null,
    'eine ausdruecklich leere Adresse nimmt den gespeicherten Namensraum zurueck');
// Ohne Angabe gilt der gespeicherte.
$tafel = avesmapsFeatureSourcesKanonFuerMehrere($pdo, 'settlement', ['ort-haupt']);
assert(($tafel['ort-haupt']['kanon'] ?? null) === 'offiziell', 'ohne Angabe gilt der gespeicherte Raum');

// ---- 4. Die zwei Antwortwege liefern das Etikett mit -------------------------------------------
// 💣 Am Quelltext geprueft, nicht am HTTP-Ablauf: der Endpunkt verlangt eine Sitzung mit Faehigkeit,
// und die Uebernahme braucht die volle Import-Fixture. Gefragt ist hier die VERDRAHTUNG -- reist das
// Feld ueberhaupt mit? Die Ableitung selbst steht in den Abschnitten darueber.
// 🪤 Kommentare heraus, sonst schlaegt die Pruefung an der Warnung an, die vor dem Muster warnt.
$nurCode = static function (string $pfad): string {
    $roh = file_get_contents($pfad);
    assert(is_string($roh), 'Datei lesbar: ' . $pfad);
    $code = '';
    foreach (token_get_all($roh) as $token) {
        if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
            continue;
        }
        $code .= is_array($token) ? $token[1] : $token;
    }

    return $code;
};

$endpunkt = $nurCode(__DIR__ . '/../../../edit/map/feature-sources.php');
assert(preg_match_all('/avesmapsJsonResponse\(\s*200\s*,/', $endpunkt) === 1,
    'der Endpunkt hat GENAU EINE Erfolgs-Antwortstelle -- an einer zweiten waere der Anbau beim '
    . 'naechsten Aktions-Zweig vergessen (die Trichter-Regel, AGENTS.md §11)');
assert(strpos($endpunkt, 'avesmapsFeatureSourcesKanonFuerMehrere') !== false,
    'der Endpunkt fragt den Mehrfach-Rechner');
assert(preg_match_all('/kanon_je_kennung/', $endpunkt) === 1,
    'er haengt genau EIN Feld an, unter genau EINEM Namen');
assert(strpos($endpunkt, 'kanon_je_kennung') < strrpos($endpunkt, 'avesmapsJsonResponse(200'),
    'der Anbau steht VOR der Antwort -- danach waere er wirkungslos');
// 💣 UND NUR NACH EINEM SCHREIBVORGANG. `list` laeuft bei jedem Neuzeichnen des Editors -- an rund
// zehn Montagestellen, im Wege-Editor bei jedem Klick auf einen Abschnitt. Der Mehrfach-Rechner
// laedt Katalog UND Verweise vollstaendig; unbedingt angehaengt waeren das zwei Abfragen ueber den
// ganzen Bestand je Klick, auf STRATO-Workern. Gefunden von einem Pruefagenten am 09.09.2026.
// 🪤 EINFACHE Anfuehrungszeichen: in einem PHP-Doppelquote-String wird `\$` zum literalen `$`, und
// das ist im Regex der ZEILENENDE-Anker -- das Muster traf dann nie und die Zusicherung war ein
// Vakuum. Beim Bau am 09.09.2026 einmal zugeschlagen.
assert(preg_match('/in_array\(\$action, \[\x27list\x27/', $endpunkt) === 1,
    'list (und inspect_url) loesen den Kanon-Rechner NICHT aus');
assert(strpos($endpunkt, 'avesmapsFeatureSourcesKanonFuerEines') === false,
    'der Einzelweg steht hier nicht: er laedt Katalog und Verweise je Aufruf vollstaendig und '
    . 'gehoert nicht in einen Weg, der bis zu 250 Kennungen bedient');

$uebernahme = $nurCode(__DIR__ . '/../../import/garetien-uebernahme.php');
assert(strpos($uebernahme, "'quellen_neu'") !== false, 'der Bauer heisst weiterhin quellen_neu');
assert(strpos($uebernahme, 'avesmapsFeatureSourcesKanonFuerMehrere') !== false,
    'die Uebernahme fragt den Mehrfach-Rechner -- der Garetien-Import ist der Weg, ueber den der '
    . 'gemeldete Fall lief');
assert(preg_match_all('/\[\'kanon\'\]\s*=/', $uebernahme) === 1,
    'jeder quellen_neu-Eintrag bekommt sein Kanon-Feld an GENAU EINER Stelle -- eine zweite waere '
    . 'ein zweiter Erzeuger fuer denselben Wert');
assert(strpos($uebernahme, "?? null;") !== false,
    'und er wird AUSDRUECKLICH gesetzt, auch als null: ein fehlender Schluessel hiesse im Client '
    . '„nicht gefragt" und liesse den alten Tafeleintrag stehen');
assert(strpos($uebernahme, 'avesmapsFeatureSourcesKanonFuerEines') === false,
    'der Einzelweg gehoert nicht in einen Massenlauf');

echo "kanon-nachtrag-test: OK\n";
