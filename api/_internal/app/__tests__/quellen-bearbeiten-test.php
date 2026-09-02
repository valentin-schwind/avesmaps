<?php

declare(strict_types=1);

/**
 * Eine Quellenzeile bearbeiten -- und die ZWEI Reichweiten, die sie in sich traegt.
 * Ausfuehren (vom Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/quellen-bearbeiten-test.php
 * Exit 0 = alle Zusicherungen erfuellt.
 *
 * 💣 WARUM ES DAS GIBT (Owner-Meldung 01.09.2026): „Manuelle Quellen koennen nicht editiert
 * werden." Es gab bis dahin ueberhaupt keinen Weg dafuer -- die Zeile trug nur ein `✕`, der
 * Endpunkt kannte `list|add|add_existing|remove`. Wer einen falschen Titel korrigieren wollte,
 * konnte die Adresse erneut eintragen, aber `label`, `license` und `attribution` FUELLEN im
 * Upsert nur Luecken; der falsche Wert blieb stehen.
 *
 * 💣 UND DIE GEGENRICHTUNG IST DIE GEFAEHRLICHE. `sources` ist ein KATALOG. Live gemessen am
 * 01.09.2026 (map-features.php, eine Anfrage): 59.538 Verknuepfungen auf 1.240 zitierte
 * Katalogzeilen -- Median 14 Objekte je Zeile, p95 171, MAXIMUM 1.549. Ein Formular, das die
 * Katalog-Haelfte wie die Verknuepfungs-Haelfte behandelt, laesst einen Editor mit einem Klick
 * 1.549 Infoboxen umschreiben.
 *
 * Gefahren wird gegen eine echte SQLite-Datenbank: die Regeln sind gewoehnliches SQL (SELECT +
 * UPDATE), also ist hier NICHTS fuer den Test verbogen -- die Falle aus AGENTS.md §9, in der eine
 * SQLite-taugliche Umschrift eine MySQL-Regression erzwang, trifft hier nicht zu.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos. "
        . "Erneut fahren mit: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

/**
 * 🔴 Der Stempel-Zaehler. `avesmapsUpdateFeatureSource` ruft `avesmapsNextMapRevision` -- die
 * echte Fassung ist MySQL (`ON DUPLICATE KEY UPDATE`) und liegt in api/_internal/map/features.php,
 * die dieser Test nicht laedt. Hier steht ein Zaehler an ihrer Stelle, und dass er hochzaehlt IST
 * eine Zusicherung: die Quellen reisen in der ETag-zwischengespeicherten map-features-Nutzlast,
 * deren ETag allein an `map_revision` haengt. Ohne Bump bekaeme jeder warme Browser sein 304 und
 * zeigte die alte Angabe unbegrenzt weiter.
 */
$GLOBALS['avesmapsTestRevisionBumps'] = 0;
function avesmapsNextMapRevision(PDO $pdo): int
{
    $GLOBALS['avesmapsTestRevisionBumps']++;

    return $GLOBALS['avesmapsTestRevisionBumps'];
}

require_once __DIR__ . '/../../bootstrap.php';
require_once __DIR__ . '/../feature-sources.php';

$pruefungen = 0;
$zaehl = static function () use (&$pruefungen): void { $pruefungen++; };

/**
 * Eine frische Datenbank mit einer Quelle und den Verknuepfungen, die sie zitieren.
 * `$mitObjekten` sagt, an wie vielen Objekten die Katalogzeile haengt (das erste ist immer 'ort-1').
 */
function avesmapsQuellenTestPdo(int $mitObjekten = 1, string $wikiKey = ''): PDO
{
    $pdo = new PDO('sqlite::memory:');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    // 🔴 Die Tabellen kommen aus dem Pruefling selbst (`avesmapsEnsureFeatureSourceTablesSqlite`),
    // nicht aus einer Abschrift hier. Eine Abschrift liefe beim ersten neuen Feld auseinander --
    // und zwar so, dass der Test einen SQL-Fehler meldet, der wie ein Fehler im Pruefling aussieht.
    avesmapsEnsureFeatureSourceTables($pdo);
    // map_features gehoert einem anderen Modul; hier stehen die Spalten, die der Lesepfad anfasst
    // (die Uebernahme des alten `other_source` und der Revisionsstand der Liste).
    $pdo->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY, public_id TEXT, is_active INTEGER,
        properties_json TEXT, revision INTEGER)');

    $pdo->prepare('INSERT INTO sources (id, url, url_hash, wiki_key, label, source_type, is_official, license, attribution)
        VALUES (7, :u, :h, :wk, :l, :t, 1, :lic, :a)')->execute([
        'u' => 'https://beispiel.de/geographia', 'h' => str_repeat('a', 64),
        'wk' => $wikiKey !== '' ? $wikiKey : null,
        'l' => 'Geographia Aventurica', 't' => 'quellenband', 'lic' => '', 'a' => '',
    ]);
    for ($i = 1; $i <= $mitObjekten; $i++) {
        $pdo->prepare("INSERT INTO feature_sources (entity_type, entity_public_id, source_id, status, origin, reference_kind, pages)
            VALUES ('settlement', :id, 7, 'approved', 'manual', :rk, :p)")->execute([
            'id' => 'ort-' . $i,
            'rk' => $i === 1 ? 'ausfuehrlich' : null,
            'p' => $i === 1 ? '112' : null,
        ]);
        $pdo->prepare("INSERT INTO map_features (public_id, is_active, properties_json, revision)
            VALUES (:id, 1, '{}', 1)")->execute(['id' => 'ort-' . $i]);
    }

    return $pdo;
}

/** Die gespeicherte Katalogzeile. */
function avesmapsQuellenTestKatalog(PDO $pdo): array
{
    return $pdo->query('SELECT * FROM sources WHERE id = 7')->fetch(PDO::FETCH_ASSOC);
}

/** Die gespeicherte Verknuepfung an 'ort-1'. */
function avesmapsQuellenTestLink(PDO $pdo): array
{
    return $pdo->query("SELECT * FROM feature_sources WHERE entity_public_id = 'ort-1'")->fetch(PDO::FETCH_ASSOC);
}

// ══ 1. Die Zuordnung der Felder zu ihrer Reichweite ═════════════════════════════════════════════
// 🔴 Das ist die Regel, um die es hier geht. Wandert ein Feld von der einen Haelfte in die andere,
// aendert sich, wie weit ein Klick reicht -- und niemand saehe es.
assert(avesmapsFeatureSourceFieldScope('pages') === 'link', 'Seiten gelten nur an diesem Objekt');
$zaehl();
assert(avesmapsFeatureSourceFieldScope('reference_kind') === 'link', 'die Abdeckung auch');
$zaehl();
foreach (['url', 'label', 'source_type', 'license', 'attribution', 'is_official'] as $feld) {
    assert(avesmapsFeatureSourceFieldScope($feld) === 'catalog', $feld . ' gilt katalogweit');
    $zaehl();
}
// 🔴 Die ADRESSE war am Vormittag des 01.09.2026 noch ausgeschlossen -- mit der Begruendung,
// `url_hash` sei die Identitaet der Quelle. Die Begruendung stimmt, die Folgerung war zu streng:
// die Verknuepfungen zeigen auf `sources.id`, nicht auf den Hash. Owner-Entscheid am selben Tag.
assert(avesmapsFeatureSourceFieldScope('status') === '' && avesmapsFeatureSourceFieldScope('origin') === '',
    'Herkunft und Status gehoeren nicht dem Editor');
$zaehl();

// ══ 2. Nur an diesem Objekt: Seiten und Abdeckung ═══════════════════════════════════════════════
$pdo = avesmapsQuellenTestPdo(3);
$vorher = $GLOBALS['avesmapsTestRevisionBumps'];
$antwort = avesmapsUpdateFeatureSource($pdo, 'settlement', 'ort-1', 7, ['pages' => '113-115'], 9);
assert(($antwort['ok'] ?? false) === true, 'die Seitenangabe laesst sich aendern');
$zaehl();
assert(avesmapsQuellenTestLink($pdo)['pages'] === '113-115', 'und sie steht in der Verknuepfung');
$zaehl();
assert(avesmapsQuellenTestKatalog($pdo)['label'] === 'Geographia Aventurica',
    'die Katalogzeile bleibt dabei voellig unberuehrt');
$zaehl();
assert($antwort['updated']['catalog_fields'] === [], 'und die Antwort sagt, dass nichts katalogweit ging');
$zaehl();
assert($GLOBALS['avesmapsTestRevisionBumps'] === $vorher + 1,
    'DER STEMPEL: ohne map_revision-Bump haelt jeder warme Browser seine 304 und zeigt die alte Angabe weiter');
$zaehl();
// ⚠️ Die andere Verknuepfung DERSELBEN Quelle darf sich nicht mitbewegen -- das ist der ganze
// Sinn der Trennung.
$andere = $pdo->query("SELECT pages FROM feature_sources WHERE entity_public_id = 'ort-2'")->fetch(PDO::FETCH_ASSOC);
assert(($andere['pages'] ?? null) === null, 'ort-2 behaelt seine eigene (leere) Seitenangabe');
$zaehl();

// Leer heisst NULL, nicht ''. Der Lesepfad vergleicht gegen NULL; ein '' saehe wie eine gesetzte,
// leere Angabe aus.
avesmapsUpdateFeatureSource($pdo, 'settlement', 'ort-1', 7, ['reference_kind' => ''], 9);
assert(avesmapsQuellenTestLink($pdo)['reference_kind'] === null, 'eine geleerte Abdeckung wird NULL');
$zaehl();

// ══ 3. Unveraendert = nicht geschrieben ═════════════════════════════════════════════════════════
// 💣 DIE TRAGENDE REGEL. `avesmapsUpsertGameLiterature` stempelte einst jedes MITGESCHICKTE Feld,
// und das Formular schickt alle mit -- danach trug dort jedes Feld „von Hand". Hier waere der
// Schaden groesser: ein unveraendert mitgeschicktes Feld schriebe an bis zu 1.549 Objekten.
$pdo = avesmapsQuellenTestPdo(3);
$vorher = $GLOBALS['avesmapsTestRevisionBumps'];
$antwort = avesmapsUpdateFeatureSource($pdo, 'settlement', 'ort-1', 7, [
    'label' => 'Geographia Aventurica',   // unveraendert
    'source_type' => 'quellenband',       // unveraendert
    'pages' => '112',                     // unveraendert
], 9);
assert($antwort['updated']['fields'] === [], 'nichts hat sich geaendert, also wurde nichts geschrieben');
$zaehl();
assert($GLOBALS['avesmapsTestRevisionBumps'] === $vorher,
    'und ohne Aenderung KEIN Stempel -- sonst laedt die halbe Welt 3 MB fuer ein wirkungsloses Speichern neu');
$zaehl();

// ══ 4. Katalogweit: die Rueckfrage ist ein SERVER-Riegel ════════════════════════════════════════
// 🔴 Der Client fragt vorher (er kennt die Zahl aus der Liste), aber ein ausgegrauter Knopf ist
// kein Riegel -- dieselbe Regel wie beim Loeschriegel der Uebernahme-Vorschau, der serverseitig
// in `apply` steht und nicht nur am Knopf.
$pdo = avesmapsQuellenTestPdo(40);
$antwort = avesmapsUpdateFeatureSource($pdo, 'settlement', 'ort-1', 7, ['label' => 'Geographia Aventurica (2. Auflage)'], 9);
assert(($antwort['ok'] ?? true) === false, 'ohne Bestaetigung geht eine Katalogaenderung nicht durch');
$zaehl();
assert($antwort['error']['code'] === 'catalog_confirm_required', 'und der Code sagt genau, warum');
$zaehl();
assert(($antwort['usage_count'] ?? 0) === 40, 'die Absage NENNT die Zahl -- „gilt ueberall" ohne Groesse ist keine Warnung');
$zaehl();
assert(avesmapsQuellenTestKatalog($pdo)['label'] === 'Geographia Aventurica', 'und geschrieben wurde nichts');
$zaehl();

$antwort = avesmapsUpdateFeatureSource($pdo, 'settlement', 'ort-1', 7, ['label' => 'Geographia Aventurica (2. Auflage)'], 9, true);
assert(($antwort['ok'] ?? false) === true, 'mit Bestaetigung geht sie durch');
$zaehl();
assert(avesmapsQuellenTestKatalog($pdo)['label'] === 'Geographia Aventurica (2. Auflage)', 'und steht dann im Katalog');
$zaehl();
assert($antwort['updated']['usage_count'] === 40, 'die Antwort nennt die Reichweite auch im Erfolgsfall');
$zaehl();

// ⚠️ Unterhalb der Schwelle wird NICHT gefragt: 17 % der zitierten Zeilen haengen an genau einem
// Objekt, und dort waere eine Rueckfrage ein Klick fuer nichts.
$pdo = avesmapsQuellenTestPdo(AVESMAPS_FEATURE_SOURCE_CONFIRM_THRESHOLD);
$antwort = avesmapsUpdateFeatureSource($pdo, 'settlement', 'ort-1', 7, ['label' => 'Kurz'], 9);
assert(($antwort['ok'] ?? false) === true, 'genau auf der Schwelle wird noch nicht gefragt');
$zaehl();

// ══ 5. Was der Wiki-Abgleich besitzt, wird gar nicht erst angenommen ════════════════════════════
// 💣 `avesmapsPublicationReconcileEntity` ruft den Upsert mit `refreshLabel = true` und schreibt
// `is_official` unbedingt. Eine Handkorrektur daran waere beim naechsten Lauf still zurueckgenommen
// -- also lehnen wir sie ab, statt sie anzunehmen und verschwinden zu lassen.
$pdo = avesmapsQuellenTestPdo(3, 'wiki:geographia-aventurica');
foreach (['label' => 'Anderer Titel', 'is_official' => false] as $feld => $wert) {
    $antwort = avesmapsUpdateFeatureSource($pdo, 'settlement', 'ort-1', 7, [$feld => $wert], 9, true);
    assert(($antwort['ok'] ?? true) === false && $antwort['error']['code'] === 'wiki_owned_field',
        $feld . ' gehoert an einer Wiki-Publikation dem Abgleich');
    $zaehl();
}
assert(avesmapsQuellenTestKatalog($pdo)['label'] === 'Geographia Aventurica', 'und nichts davon wurde geschrieben');
$zaehl();
// 🔴 Die drei anderen Katalogfelder fasst der Abgleich NICHT an (retype-Vorgabe nein, Lizenz und
// Namensnennung fuellend) -- die bleiben auch an einer Wiki-Publikation aenderbar.
$antwort = avesmapsUpdateFeatureSource($pdo, 'settlement', 'ort-1', 7,
    ['license' => 'cc-by-sa-4.0', 'attribution' => 'Ulisses', 'source_type' => 'regelbuch'], 9, true);
assert(($antwort['ok'] ?? false) === true, 'Lizenz, Namensnennung und Art bleiben aenderbar');
$zaehl();
$katalog = avesmapsQuellenTestKatalog($pdo);
assert($katalog['license'] === 'cc-by-sa-4.0' && $katalog['attribution'] === 'Ulisses'
    && $katalog['source_type'] === 'regelbuch', 'und sie stehen danach da');
$zaehl();
// ⚠️ Auch die Verknuepfungsfelder bleiben an einer Wiki-Publikation frei -- sie gehoeren diesem
// Objekt, nicht dem Werk.
$antwort = avesmapsUpdateFeatureSource($pdo, 'settlement', 'ort-1', 7, ['pages' => '7'], 9);
assert(($antwort['ok'] ?? false) === true && avesmapsQuellenTestLink($pdo)['pages'] === '7',
    'die Seitenangabe gehoert diesem Objekt, auch bei einer Wiki-Publikation');
$zaehl();

// ══ 6. Abgelehnt statt geraten ══════════════════════════════════════════════════════════════════
$pdo = avesmapsQuellenTestPdo(2);
$faelle = [
    [['url' => 'javascript:alert(1)'], 'invalid_request', 'nur http(s): die Adresse wird in jeder Infobox als <a href> ausgegeben'],
    [['url' => 'beispiel.de/ohne-schema'], 'invalid_request', 'ohne Schema ebenso'],
    [['status' => 'suppressed'], 'unknown_field', 'ein unbekanntes Feld ist ein Fehler, kein stilles Ueberspringen'],
    [[], 'invalid_request', 'ohne Feld gibt es nichts zu tun'],
    [['label' => '   '], 'invalid_request', 'ein LEERER Titel ist keine Korrektur -- die Zeile fiele ueberall auf ihre nackte Adresse zurueck'],
    [['source_type' => ''], 'invalid_request', 'eine Katalogzeile TRAEGT immer eine Art; "keine Aussage" hiesse hier loeschen'],
    [['source_type' => 'garetien'], 'invalid_request', 'eine unbekannte Art wird abgelehnt, nicht auf sonstiges gerundet'],
    [['license' => 'cc-by-tippfehler'], 'invalid_request', 'ein Lizenz-Tippfehler wird abgelehnt, nicht auf "" normalisiert -- '
        . 'sonst loescht er die Angabe, und zwar katalogweit'],
    [['reference_kind' => 'quatsch'], 'invalid_request', 'eine unbekannte Abdeckung ebenso'],
];
foreach ($faelle as [$felder, $code, $warum]) {
    $antwort = avesmapsUpdateFeatureSource($pdo, 'settlement', 'ort-1', 7, $felder, 9, true);
    assert(($antwort['ok'] ?? true) === false && $antwort['error']['code'] === $code, $warum);
    $zaehl();
}
// ⚠️ '' bei der LIZENZ ist dagegen gueltig und heisst „nicht erfasst" -- wer eine falsch
// eingetragene Lizenz zuruecknehmen will, muss das koennen.
$pdo2 = avesmapsQuellenTestPdo(2);
$pdo2->exec("UPDATE sources SET license = 'unfree' WHERE id = 7");
$antwort = avesmapsUpdateFeatureSource($pdo2, 'settlement', 'ort-1', 7, ['license' => ''], 9, true);
assert(($antwort['ok'] ?? false) === true && avesmapsQuellenTestKatalog($pdo2)['license'] === '',
    'eine Lizenz laesst sich auf „nicht erfasst" zuruecknehmen');
$zaehl();

// ⚠️ Die LEERE Adresse bekommt ihre EIGENE Meldung. Der Schema-Riegel darunter wuerde sie
// ebenfalls abweisen -- eine Mutationsprobe am 01.09.2026 hat gezeigt, dass eine Pruefung nur auf
// den Fehlercode diesen Riegel gar nicht misst. Gemessen wird deshalb der TEXT: „muss mit http://
// beginnen" ist fuer ein leer gelassenes Feld die falsche Auskunft.
$antwort = avesmapsUpdateFeatureSource($pdo, 'settlement', 'ort-1', 7, ['url' => '   '], 9, true);
assert(($antwort['ok'] ?? true) === false && $antwort['error']['code'] === 'invalid_request',
    'eine leere Adresse wird abgelehnt');
$zaehl();
assert(str_contains((string) $antwort['error']['message'], 'leer'),
    'und die Meldung sagt LEER, nicht „muss mit http:// beginnen" -- das waere die falsche Auskunft');
$zaehl();

// ══ 6b. DIE ADRESSE: sie zieht ihren Hash mit, und eine belegte wird abgelehnt ═════════════════
// 💣 `url_hash` ist die Identitaet der Quelle. Bliebe er beim Aendern stehen, faende der naechste
// Upsert derselben Adresse die Zeile nicht und legte eine ZWEITE an -- der Katalog spaltet sich,
// und zwar lautlos.
$pdo = avesmapsQuellenTestPdo(3);
$alterHash = $pdo->query('SELECT url_hash FROM sources WHERE id = 7')->fetchColumn();
$antwort = avesmapsUpdateFeatureSource($pdo, 'settlement', 'ort-1', 7, ['url' => 'https://beispiel.de/neu'], 9, true);
assert(($antwort['ok'] ?? false) === true, 'die Adresse laesst sich korrigieren');
$zaehl();
$zeile = avesmapsQuellenTestKatalog($pdo);
assert($zeile['url'] === 'https://beispiel.de/neu', 'und sie steht danach da');
$zaehl();
assert($zeile['url_hash'] === hash('sha256', 'https://beispiel.de/neu'),
    'DER HASH ZIEHT MIT -- sonst legt der naechste Upsert derselben Adresse eine zweite Zeile an');
$zaehl();
assert($zeile['url_hash'] !== $alterHash, 'er ist also ein anderer als vorher');
$zaehl();
// ⭐ Und ALLE zitierenden Objekte folgen von selbst: die Verknuepfungen zeigen auf `sources.id`,
// nicht auf den Hash. Genau das macht die Adresse ueberhaupt aenderbar.
assert(avesmapsFeatureSourceUsageCount($pdo, 7) === 3, 'die drei Verknuepfungen haengen unveraendert dran');
$zaehl();

// 💣 Eine Adresse, die schon einer ANDEREN Katalogzeile gehoert, waere ein ZUSAMMENLEGEN.
// Ohne diese Frage schluege der UNIQUE zu, und der Editor bekaeme einen nackten Serverfehler
// statt der Auskunft, WELCHE Quelle die Adresse schon traegt.
$pdo->prepare('INSERT INTO sources (id, url, url_hash, label, source_type, is_official, license, attribution)
    VALUES (8, :u, :h, :l, :t, 0, "", "")')->execute([
    'u' => 'https://beispiel.de/besetzt', 'h' => hash('sha256', 'https://beispiel.de/besetzt'),
    'l' => 'Enzyklopaedia Aventurica', 't' => 'quellenband',
]);
$antwort = avesmapsUpdateFeatureSource($pdo, 'settlement', 'ort-1', 7, ['url' => 'https://beispiel.de/besetzt'], 9, true);
assert(($antwort['ok'] ?? true) === false && $antwort['error']['code'] === 'url_taken',
    'eine belegte Adresse wird abgelehnt, nicht in einen UNIQUE-Fehler gefahren');
$zaehl();
assert(str_contains((string) $antwort['error']['message'], 'Enzyklopaedia Aventurica'),
    'und die Absage NENNT die andere Quelle -- sonst sucht der Editor blind');
$zaehl();
assert(avesmapsQuellenTestKatalog($pdo)['url'] === 'https://beispiel.de/neu', 'geschrieben wurde nichts');
$zaehl();
// ⚠️ Die eigene Adresse noch einmal zu setzen ist KEINE Kollision -- sonst koennte man ein
// anderes Feld nicht mehr speichern, solange die Adresse im Formular steht.
$antwort = avesmapsUpdateFeatureSource($pdo, 'settlement', 'ort-1', 7,
    ['url' => 'https://beispiel.de/neu', 'label' => 'Anderer Titel'], 9, true);
assert(($antwort['ok'] ?? false) === true && $antwort['updated']['fields'] === ['label'],
    'die unveraenderte eigene Adresse loest keine Kollision aus und reist gar nicht erst mit');
$zaehl();

// 🔴 Bei einer Wiki-Publikation gehoert die IDENTITAET dem Abgleich: er rechnet den Hash aus
// SEINER chosen_url, eine Handaenderung ergaebe beim naechsten Lauf eine ZWEITE Zeile.
$pdo = avesmapsQuellenTestPdo(2, 'wiki:x');
$antwort = avesmapsUpdateFeatureSource($pdo, 'settlement', 'ort-1', 7, ['url' => 'https://beispiel.de/x'], 9, true);
assert(($antwort['ok'] ?? true) === false && $antwort['error']['code'] === 'wiki_owned_field',
    'die Adresse einer Wiki-Publikation ist fest');
$zaehl();

// ══ 7. Fremdes Objekt, fremde Quelle ════════════════════════════════════════════════════════════
$antwort = avesmapsUpdateFeatureSource($pdo, 'settlement', 'gibt-es-nicht', 7, ['pages' => '1'], 9);
assert(($antwort['ok'] ?? true) === false && $antwort['error']['code'] === 'not_found',
    'eine Quelle, die nicht an DIESEM Objekt haengt, laesst sich von hier nicht aendern');
$zaehl();
$antwort = avesmapsUpdateFeatureSource($pdo, 'region', 'ort-1', 7, ['pages' => '1'], 9);
assert(($antwort['ok'] ?? true) === false && $antwort['error']['code'] === 'not_found',
    'und der entity_type gehoert zum Schluessel -- eine Region mit derselben id ist ein anderes Objekt');
$zaehl();

// ══ 8. Die Liste liefert, was der Kasten braucht ════════════════════════════════════════════════
// ⭐ Ohne zweiten Abruf: Reichweite und Wiki-Besitz reisen mit der ohnehin geholten Liste.
$pdo = avesmapsQuellenTestPdo(23, 'wiki:x');
$liste = avesmapsListFeatureSourcesForEdit($pdo, 'settlement', 'ort-1', 9);
assert(count($liste['sources']) === 1, 'eine Quelle an diesem Objekt');
$zaehl();
assert($liste['sources'][0]['usage_count'] === 23, 'und die Liste sagt, wie viele Objekte sie zitieren');
$zaehl();
assert($liste['sources'][0]['wiki_owned'] === true, 'und dass der Wiki-Abgleich sie pflegt');
$zaehl();
$pdo = avesmapsQuellenTestPdo(1);
$liste = avesmapsListFeatureSourcesForEdit($pdo, 'settlement', 'ort-1', 9);
assert($liste['sources'][0]['usage_count'] === 1 && $liste['sources'][0]['wiki_owned'] === false,
    'ohne wiki_key gehoert die Zeile uns, und sie haengt an genau einem Objekt');
$zaehl();
// 🔴 Gemessen am gespeicherten `wiki_key`, NICHT am `origin` der Verknuepfung: dieselbe
// Katalogzeile kann an einem Objekt von Hand und an einem anderen vom Abgleich haengen --
// besitzen tut sie der Abgleich in beiden Faellen.
$pdo = avesmapsQuellenTestPdo(2, 'wiki:x');
$pdo->exec("UPDATE feature_sources SET origin = 'manual' WHERE entity_public_id = 'ort-1'");
$liste = avesmapsListFeatureSourcesForEdit($pdo, 'settlement', 'ort-1', 9);
assert($liste['sources'][0]['wiki_owned'] === true,
    'eine von Hand gesetzte VERKNUEPFUNG macht die Katalogzeile nicht zu unserer');
$zaehl();
// ⚠️ Eine unterdrueckte Verknuepfung zaehlt NICHT mit -- sie wird nirgends angezeigt.
$pdo = avesmapsQuellenTestPdo(5);
$pdo->exec("UPDATE feature_sources SET status = 'suppressed' WHERE entity_public_id IN ('ort-4','ort-5')");
assert(avesmapsFeatureSourceUsageCount($pdo, 7) === 3, 'unterdrueckte Verknuepfungen zaehlen nicht mit');
$zaehl();

// ══ 8a. EIN FELD, DAS DIE ZEILE SELBST BESITZT, GEHT NICHT AN DEN KORPUS ════════════════════════
// 🔴 Sonst hiesse „weicht ab" nur, dass die Abweichung im selben Zug zur neuen Regel des ganzen
// Wirts wird -- das genaue Gegenteil. Owner-Entscheid 02.09.2026.
// ⚠️ Gefahren wird der ECHTE Schreibweg (`avesmapsUpdateFeatureSource`), nicht der Quelltext: die
// Weiche sitzt zwischen zwei Zweigen, und ein `str_contains` saehe nie, welcher genommen wird.
// 🪤 UND DER `require` GEHOERT DAZU. Ohne ihn ist `function_exists` falsch, der ganze Block laeuft
// NIE, und der Test bleibt gruen -- beim ersten Bau genau so passiert und nur daran aufgefallen,
// dass die Zahl der Zusicherungen sich nicht bewegte. Ein Riegel, der die eigene Pruefung
// ueberspringt, ist die teuerste Sorte Vakuum.
require_once __DIR__ . '/../source-corpus.php';
assert(function_exists('avesmapsSourceCorpusSave'), 'das Korpus-Modul ist geladen');
$zaehl();
if (function_exists('avesmapsSourceCorpusSave')) {
    $pdo = avesmapsQuellenTestPdo(1);
    $pdo->exec("UPDATE sources SET url = 'https://horaswiki.de/wiki/Der_Preis_der_Macht',
        url_hash = '" . hash('sha256', 'https://horaswiki.de/wiki/Der_Preis_der_Macht') . "',
        wiki_key = NULL, source_type = 'briefspiel', is_official = 0 WHERE id = 7");
    avesmapsSourceCorpusSave($pdo, 'horaswiki.de',
        ['label' => 'LieblichesFeld-Wiki', 'source_type' => 'briefspiel'], 9, true);

    // (a) OHNE Besitz wandert die Art in den Korpus -- die Gegenprobe, ohne die (b) auch dann
    //     gruen waere, wenn die Weiche gar nichts mehr durchliesse.
    $antwort = avesmapsUpdateFeatureSource($pdo, 'settlement', 'ort-1', 7, ['source_type' => 'abenteuer'], 9, true);
    assert(isset($antwort['corpus_applied']), 'ohne Besitz trifft eine Artaenderung den ganzen Korpus');
    $zaehl();
    assert($pdo->query("SELECT source_type FROM source_corpus WHERE corpus_key = 'horaswiki.de'")->fetchColumn() === 'abenteuer',
        'und der Korpus traegt sie danach');
    $zaehl();

    // (b) MIT Besitz bleibt der Korpus, wie er ist.
    $pdo->exec("UPDATE source_corpus SET source_type = 'briefspiel' WHERE corpus_key = 'horaswiki.de'");
    $pdo->exec("UPDATE sources SET source_type = 'briefspiel',
        own_fields = '" . avesmapsSourceOwnFieldsFormat(['source_type']) . "' WHERE id = 7");
    $antwort = avesmapsUpdateFeatureSource($pdo, 'settlement', 'ort-1', 7, ['source_type' => 'abenteuer'], 9, true);
    assert(($antwort['ok'] ?? false) === true, 'die Aenderung selbst geht durch');
    $zaehl();
    assert(!isset($antwort['corpus_applied']),
        'aber sie wird NICHT als Korpusaenderung gemeldet -- die Zeile besitzt das Feld');
    $zaehl();
    assert($pdo->query("SELECT source_type FROM source_corpus WHERE corpus_key = 'horaswiki.de'")->fetchColumn() === 'briefspiel',
        'und der Korpus steht unveraendert da');
    $zaehl();
    assert($pdo->query('SELECT source_type FROM sources WHERE id = 7')->fetchColumn() === 'abenteuer',
        'die Zeile selbst hat ihre Art trotzdem bekommen');
    $zaehl();

    // (c) Besitz und Wert in EINEM Zug: gemessen wird der NEUE Besitzstand, nicht der gespeicherte.
    $pdo->exec("UPDATE sources SET source_type = 'briefspiel', own_fields = '' WHERE id = 7");
    $antwort = avesmapsUpdateFeatureSource($pdo, 'settlement', 'ort-1', 7,
        ['source_type' => 'abenteuer', 'own_fields' => ['source_type']], 9, true);
    assert(!isset($antwort['corpus_applied']),
        'wer in einem Zug aendert UND als eigen erklaert, meint beides zusammen');
    $zaehl();
    assert($pdo->query("SELECT own_fields FROM sources WHERE id = 7")->fetchColumn() === ',source_type,',
        'und der Besitzstand steht danach in der Zeile');
    $zaehl();
}

// ══ 8b. WER HAT DAS EINGETRAGEN -- und zwar ZWEIMAL ═════════════════════════════════════════════
// 🔴 Owner 02.09.2026: „der editor, der die quelle eingefuegt hat und das datum ... die felder
// koennen nur eingesehen, nicht veraendert werden."
// 💣 ZWEI HERKUENFTE, nicht eine, und sie fallen auf die zwei Reichweiten des Kastens: `link` sagt,
// wer die Quelle HIER angehaengt hat, `source` sagt, wer sie ueberhaupt in den Katalog gelegt hat.
// Bei einer Zeile mit 1.549 Objekten sind das fast nie dieselben Menschen.
$pdo = avesmapsQuellenTestPdo(1);
$liste = avesmapsListFeatureSourcesForEdit($pdo, 'settlement', 'ort-1', 9);
$herkunft = $liste['sources'][0]['created'] ?? null;
assert(is_array($herkunft) && array_key_exists('link', $herkunft) && array_key_exists('source', $herkunft),
    'die Liste traegt beide Herkuenfte');
$zaehl();
// ⚠️ OHNE `users`-Tabelle faellt die Namensaufloesung OFFEN aus -- das Datum bleibt, der Name ist
// leer. Eine Auskunft darf das Oeffnen einer Quellenliste niemals verhindern.
assert(($herkunft['source']['at'] ?? '') !== '' && ($herkunft['source']['by'] ?? null) === '',
    'ohne Nutzertabelle steht das Datum da und der Name ist leer -- kein Fatal, kein „unbekannt“');
$zaehl();

// Jetzt mit Namen: der Katalogeintrag von einem, die Verknuepfung von einem anderen.
$pdo = avesmapsQuellenTestPdo(1);
$pdo->exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL)');
$pdo->exec("INSERT INTO users (id, username) VALUES (4, 'Vali'), (5, 'Nottel')");
$pdo->exec('UPDATE sources SET created_by = 4, created_at = "2026-06-14 21:15:00" WHERE id = 7');
$pdo->exec('UPDATE feature_sources SET created_by = 5, created_at = "2026-09-01 08:30:00"');
$liste = avesmapsListFeatureSourcesForEdit($pdo, 'settlement', 'ort-1', 9);
$herkunft = $liste['sources'][0]['created'];
assert($herkunft['source'] === ['at' => '2026-06-14 21:15:00', 'by' => 'Vali'],
    'der Katalogeintrag nennt seinen Editor');
$zaehl();
assert($herkunft['link'] === ['at' => '2026-09-01 08:30:00', 'by' => 'Nottel'],
    'die Verknuepfung ihren -- und es ist nicht derselbe');
$zaehl();
// 💣 EINE Abfrage fuer beide Spalten, kein `LEFT JOIN users`. `sources` und `users` teilen sich
// `id` UND `created_at`; ein Join machte jede unqualifizierte Spalte mehrdeutig, und genau das hat
// `api/edit/reports/locations.php` schon einmal mit einer 500 bezahlt.
//
// 🪤 UND DIESE ZUSICHERUNG IST BEIM BAU SCHON EINMAL AM KOMMENTAR ANGESCHLAGEN, der vor genau
// diesem Join warnt. Deshalb per TOKENIZER geschnitten, nicht mit zwei `preg_replace`: ein
// Blockkommentar-Entferner sieht ein `/*` in einer Zeilenkommentarzeile und frisst alles bis zum
// naechsten `*/` -- in `sync-monitor.php` waren das 380 Zeilen echter Code.
$ohneKommentareTok = static function (string $php): string {
    $raus = '';
    foreach (token_get_all($php) as $stueck) {
        if (is_array($stueck) && in_array($stueck[0], [T_COMMENT, T_DOC_COMMENT], true)) {
            continue;
        }
        $raus .= is_array($stueck) ? $stueck[1] : $stueck;
    }
    return $raus;
};
$quelltextListe = $ohneKommentareTok((string) file_get_contents(__DIR__ . '/../feature-sources.php'));
assert(!preg_match('/JOIN\s+users/i', $quelltextListe),
    'kein JOIN auf users -- die Namen kommen aus einer eigenen Abfrage');
$zaehl();
// 🔴 UND SIE DUERFEN NIE OEFFENTLICH WERDEN. Es gibt genau EINEN Aufrufer, und der haengt hinter
// dem Editor-Riegel. Ein zweiter in `api/app/…` oder in der Kartennutzlast liesse Editorennamen
// fuer jeden Besucher lesbar werden.
assert(substr_count($quelltextListe, 'avesmapsFeatureSourceEditorNames($pdo') === 1,
    'genau ein Aufrufer der Namensaufloesung');
$zaehl();

// ══ 9. ANGELEGT oder VERKNUEPFT? Die Auskunft, die das Adressfeld verschwieg ════════════════════
// 🔴 Der Katalog dedupliziert ueber `url_hash` (UNIQUE): eine bekannte Adresse VERKNUEPFT mit der
// bestehenden Zeile, statt eine neue anzulegen. Richtig und gewollt -- aber bis zum 01.09.2026
// stumm, waehrend der NAMENS-Weg daneben eine Kachel „bestehende Quelle" zeigt. Owner-Frage:
// „erkennt er die Quelle beim Einfuegen automatisch, und wenn nicht, legt er eine neue an?"
// ⚠️ `null` heisst „neu angelegt" und ist die SCHWEIGENDE Antwort: die frische Zeile zeigt genau
// das Eingetippte, da gibt es nichts zu erklaeren. Dieselbe Regel wie bei `retyped`.
assert(avesmapsFeatureSourceLinkedReport(null, 'Briefspiel (Weiden)', false) === null,
    'eine neue Adresse legt an und meldet NICHTS -- sonst Laerm auf dem haeufigen Weg');
$zaehl();

$bestehend = ['id' => 1316309, 'label' => 'Briefspiel (Weiden)', 'is_official' => 0];
$bericht = avesmapsFeatureSourceLinkedReport($bestehend, 'Briefspiel (Weiden)', false);
assert(is_array($bericht) && $bericht['source_id'] === 1316309,
    'eine bekannte Adresse meldet die getroffene Katalogzeile');
$zaehl();
assert($bericht['typed_label'] === '', 'gleicher Titel = nichts verworfen = nichts zu erklaeren');
$zaehl();
assert($bericht['official_changed'] === false, 'und der Haken stand schon so');
$zaehl();

// 🔴 DER FALL, DER OHNE ERKLAERUNG WIE EIN FEHLER AUSSIEHT: man tippt „X" und in der Liste steht
// „Y". Grund ist, dass `label` beim Verknuepfen nur eine LUECKE fuellt -- der eingetippte Titel
// wird verworfen (avesmapsSourceUpsertOnDuplicateSql).
$bericht = avesmapsFeatureSourceLinkedReport($bestehend, 'Baronie Altentrallop', false);
assert($bericht['label'] === 'Briefspiel (Weiden)', 'der GESPEICHERTE Titel gewinnt');
$zaehl();
assert($bericht['typed_label'] === 'Baronie Altentrallop',
    'und der verworfene wird genannt -- sonst haelt der Editor die Zeile fuer falsch');
$zaehl();

// ⚠️ Hatte die Katalogzeile gar keinen Titel, gewinnt der eingetippte -- dann wurde nichts
// verworfen, und es gibt nichts zu melden.
$bericht = avesmapsFeatureSourceLinkedReport(['id' => 5, 'label' => '', 'is_official' => 0], 'Neuer Titel', false);
assert($bericht['label'] === 'Neuer Titel' && $bericht['typed_label'] === '',
    'ohne gespeicherten Titel gewinnt der eingetippte, und nichts wurde verworfen');
$zaehl();

// 💣 DER HAKEN „offiziell" UEBERSCHREIBT DEN KATALOGWERT UNBEDINGT
// (`is_official = VALUES(is_official)`). Wer eine bekannte Adresse ohne Haken eintraegt, stellt die
// Quelle damit UEBERALL auf nicht-offiziell. Das ist hier NICHT geheilt -- aber es wird gesagt.
$bericht = avesmapsFeatureSourceLinkedReport(
    ['id' => 7, 'label' => 'Geographia Aventurica', 'is_official' => 1], 'Geographia Aventurica', false);
assert($bericht['official_changed'] === true && $bericht['official_now'] === false,
    'ein umgelegter Haken wird gemeldet -- er gilt katalogweit');
$zaehl();
$bericht = avesmapsFeatureSourceLinkedReport(['id' => 7, 'label' => 'X', 'is_official' => 0], 'X', true);
assert($bericht['official_changed'] === true && $bericht['official_now'] === true,
    'auch in die andere Richtung');
$zaehl();

// 🪤 Der Aufrufer muss den Bericht wirklich anhaengen -- sonst ist die Regel darueber ein Vakuum.
$quelltext = (string) file_get_contents(__DIR__ . '/../feature-sources.php');
$ohneKommentare = preg_replace('#/\*[\s\S]*?\*/|^\s*//.*$#m', '', $quelltext) ?? '';
assert(str_contains($ohneKommentare, 'avesmapsFeatureSourceLinkedReport($bestehendeZeile, $label, $official)'),
    'avesmapsAddFeatureSource ruft den Bericht wirklich');
$zaehl();
assert(preg_match('/\$antwort\[.linked.\] = \$verknuepft;/', $ohneKommentare) === 1,
    'und haengt ihn an die Antwort');
$zaehl();
// 💣 Die Vorab-Lesung muss UNBEDINGT laufen, nicht nur bei $retype -- sonst weiss niemand, ob
// verknuepft wurde. Genau so stand sie bis zum 01.09.2026 da.
assert(preg_match('/\$vorher = \$pdo->prepare\(.SELECT id, label, source_type, is_official FROM sources/', $ohneKommentare) === 1,
    'die Katalogzeile VOR dem Upsert wird unbedingt gelesen, nicht nur beim Umtypen');
$zaehl();

fwrite(STDOUT, "OK -- {$pruefungen} Zusicherungen erfuellt (Quellen bearbeiten).\n");
exit(0);
