<?php

declare(strict_types=1);

/**
 * DIE BESCHRIFTUNG ERBT DIE WIKI-LANDSCHAFT IHRER FLÄCHE — ausgeführt, nicht gelesen.
 *
 * 🔴 DER BEFUND, DER DAZU GEFÜHRT HAT (Owner 01.09.2026, am Bild): der Prüfhaken „Keine
 * Wiki-Zuweisung" markierte die Beschriftung „Nordwalser Höhen" rot, während der Dialog daneben
 * eine zugewiesene Wiki-Landschaft zeigte. Beide hatten recht — der Kasten im Dialog gehört der
 * FLÄCHE (`effectiveWikiRegion`, map-features-ecosystem-properties.js), rot markiert wird die
 * BESCHRIFTUNG, und die trägt ihre Zuweisung in `properties.wiki_region` selbst. Live gemessen:
 * 745 Flächen-Beschriftungs-Paare, davon 12 mit zugewiesener Fläche und leerer Beschriftung — und
 * bei 7 davon lag die Zuweisung auf einem zweiten, gleichnamigen Label ohne Fläche.
 * Owner-Entscheid: die Beschriftung ERBT die Fläche.
 *
 * 💣 DIE REGEL WANDERT NUR ABWÄRTS, UND SIE LÖSCHT NIE. Hat die Region keinen Schlüssel, bleibt die
 * Beschriftung unangetastet — andersherum löschte jedes Speichern einer wiki-losen Region genau die
 * Zuweisung, die „Label zuweisen" (V6c) von Hand gesetzt hat. Dieselbe Regel wie im clientseitigen
 * Durchtrag, den `renameLinkedEcosystemLabel` seit jeher fährt; hier ist sie serverseitig, damit
 * ALLE Erzeuger sie erben (Panel-Knopf, Dialog, Importer) und nicht nur der eine, der sie kannte.
 *
 * 💣 GESCHRIEBEN WIRD NUR, WAS SICH WIRKLICH ÄNDERT — und daran hängt mehr als Sauberkeit: ein
 * Label-Save bumpt `map_revision` und macht damit die ~21 MB Kartennutzlast für JEDEN Besucher
 * ungültig (api/_internal/app/ecosystem.php, Kopf). Ein Durchtrag, der bei jedem Speichern schreibt,
 * ob sich etwas ändert oder nicht, wäre genau die Last, vor der die Datei warnt.
 *
 * ⚠️ ZWEI TESTDOPPEL, wie in ecosystem-label-kaskade-test.php und aus demselben Grund: die
 * Originale von `avesmapsNextMapRevision`/`avesmapsWriteMapAuditLog` tragen MySQL-Syntax
 * (`ON DUPLICATE KEY UPDATE`) und werden von ecosystem.php gar nicht geladen. Die Produktionsform
 * wird dafür NICHT verbogen (AGENTS.md §9, Error 1093). Alles, worüber dieser Test urteilt, ist
 * Originalcode.
 *
 * Lauf (Windows), aus dem Repo-Root:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/ecosystem-label-wiki-durchtrag-test.php
 * Exit 0 = alle Zusicherungen erfüllt.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1' -- "
        . "assert() waere wirkungslos. Neu starten mit: php -d zend.assertions=1 -d assert.exception=1 "
        . __FILE__ . "\n");
    exit(2);
}
if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: pdo_sqlite ist nicht geladen -- neu starten mit -d extension=php_pdo_sqlite.dll\n");
    exit(2);
}

// ---- die Doppel, VOR dem require (sonst gewinnt niemand) ------------------------------------------
function avesmapsNextMapRevision(PDO $pdo): int
{
    $GLOBALS['test_map_revision'] = ($GLOBALS['test_map_revision'] ?? 100) + 1;

    return (int) $GLOBALS['test_map_revision'];
}

function avesmapsWriteMapAuditLog(PDO $pdo, ?int $featureId, string $action, int $actorUserId, string $beforeJson, string $afterJson): int
{
    $statement = $pdo->prepare(
        'INSERT INTO map_audit_log (feature_id, action, actor_user_id, before_json, after_json)
         VALUES (:feature_id, :action, :actor_user_id, :before_json, :after_json)'
    );
    $statement->execute([
        'feature_id' => $featureId,
        'action' => $action,
        'actor_user_id' => $actorUserId,
        'before_json' => $beforeJson,
        'after_json' => $afterJson,
    ]);

    return (int) $pdo->lastInsertId();
}

function avesmapsEncodeAuditJson(array $value): string
{
    return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}';
}

require __DIR__ . '/../ecosystem.php';

/**
 * Die Fixture: eine Region mit Zeiger auf ihre primäre Beschriftung, beliebig viele Beschriftungen,
 * und wahlweise eine Staging-Zeile für den vollen Wiki-Datensatz.
 *
 * @param list<array{0:string,1:?string,2:?array}> $labels je Label: [public_id, Regionszeiger, properties.wiki_region]
 */
function durchtragFixture(array $labels, ?string $primaerZeiger, bool $staging = true): PDO
{
    $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('CREATE TABLE map_features (
        id INTEGER PRIMARY KEY, public_id TEXT, feature_type TEXT, name TEXT, properties_json TEXT,
        is_active INTEGER DEFAULT 1, revision INTEGER DEFAULT 1, updated_by INTEGER)');
    $pdo->exec('CREATE TABLE map_audit_log (
        id INTEGER PRIMARY KEY, feature_id INTEGER, action TEXT, actor_user_id INTEGER,
        before_json TEXT, after_json TEXT)');
    $pdo->exec('CREATE TABLE wiki_region_staging (
        id INTEGER PRIMARY KEY, wiki_key TEXT, name TEXT, art TEXT, continent TEXT, region_parent TEXT,
        affiliation_staat TEXT, einwohner TEXT, sprache TEXT, vegetation TEXT, verkehrswege TEXT,
        description TEXT, image_url TEXT, image_license TEXT, image_author TEXT, image_attribution TEXT,
        image_license_status TEXT, image_license_url TEXT, wiki_url TEXT, neighbors_json TEXT,
        synonyms_json TEXT, match_key TEXT, synced_at TEXT)');

    if ($staging) {
        $pdo->prepare(
            'INSERT INTO wiki_region_staging (wiki_key, name, art, continent, verkehrswege, wiki_url, synced_at)
             VALUES (:k, :n, :a, :c, :v, :u, :s)'
        )->execute([
            'k' => 'nordwalser-h-hen',
            'n' => 'Nordwalser Höhen',
            'a' => 'Gebirge',
            'c' => 'Aventurien',
            'v' => 'Lettastieg, Letta',
            'u' => 'https://de.wiki-aventurica.de/wiki/Nordwalser_H%C3%B6hen',
            's' => '2026-06-06 02:57:12.591',
        ]);
    }

    $einfuegen = $pdo->prepare(
        'INSERT INTO map_features (public_id, feature_type, name, properties_json) VALUES (:p, "label", :n, :j)'
    );
    foreach ($labels as [$publicId, $zeiger, $wikiRegion]) {
        $properties = ['text' => 'Nordwalser Höhen'];
        if ($zeiger !== null) {
            $properties['ecosystem_region_public_id'] = $zeiger;
        }
        if ($wikiRegion !== null) {
            $properties['wiki_region'] = $wikiRegion;
        }
        $einfuegen->execute([
            'p' => $publicId,
            'n' => 'Nordwalser Höhen',
            'j' => json_encode($properties, JSON_UNESCAPED_UNICODE),
        ]);
    }

    return $pdo;
}

function labelProperties(PDO $pdo, string $publicId): array
{
    $statement = $pdo->prepare('SELECT properties_json FROM map_features WHERE public_id = :p');
    $statement->execute(['p' => $publicId]);
    $decoded = json_decode((string) $statement->fetchColumn(), true);

    return is_array($decoded) ? $decoded : [];
}

$url = 'https://de.wiki-aventurica.de/wiki/Nordwalser_H%C3%B6hen';

// ---- 1. Der Kern: die primäre Beschriftung erbt --------------------------------------------------
// Genau der Livezustand vom 01.09.2026: die Fläche trägt den Schlüssel, ihre gezeichnete
// Beschriftung nicht — und deshalb stand der Name rot auf der Karte.
$pdo = durchtragFixture([['l-kurve', 'r-nordwalser', null]], 'l-kurve');
$ergebnis = avesmapsEcosystemPushWikiRegionToLabels($pdo, 'r-nordwalser', 'l-kurve', 'nordwalser-h-hen', $url, 7);
$props = labelProperties($pdo, 'l-kurve');
assert(($props['wiki_region']['wiki_key'] ?? '') === 'nordwalser-h-hen', 'die Beschriftung muss die Zuweisung geerbt haben');
assert($ergebnis['applied'] === 1, 'genau eine Beschriftung geschrieben, gemeldet: ' . var_export($ergebnis['applied'], true));
assert($ergebnis['revision'] !== null, 'ein Label-Save bumpt map_revision -- sonst sieht kein warmer Client die Änderung');

// Und der VOLLE Datensatz, nicht nur der Schlüssel: dieselbe Form, die auch der Label-Editor-Picker
// speichert (avesmapsWikiRegionBuildAssignObject). Eine abgespeckte zweite Form wäre die zweite
// Wahrheit, gegen die AGENTS.md §5 steht.
assert(($props['wiki_region']['name'] ?? '') === 'Nordwalser Höhen', 'der Name reist mit');
assert(($props['wiki_region']['art'] ?? '') === 'Gebirge', 'die Art reist mit');
assert(($props['wiki_region']['verkehrswege'] ?? '') === 'Lettastieg, Letta', 'auch die Felder, die nur die Infobox liest');
assert(array_key_exists('neighbors', $props['wiki_region']), 'die Nachbarn sind Teil der Form, auch leer');

// Der Zeiger überlebt: der Durchtrag schreibt NUR wiki_region und rührt sonst nichts an.
assert(($props['ecosystem_region_public_id'] ?? '') === 'r-nordwalser', 'der Regionszeiger bleibt stehen');
assert(($props['text'] ?? '') === 'Nordwalser Höhen', 'der Text bleibt stehen');

// ---- 2. Kein Schlüssel: die Beschriftung bleibt unangetastet -------------------------------------
// 💣 Die teuerste Richtung. Eine Region ohne Zuweisung darf die von Hand gesetzte Zuweisung ihrer
// Beschriftung NICHT löschen -- sonst nähme jedes beiläufige Speichern sie still zurück.
$pdo = durchtragFixture([['l-kurve', 'r-nordwalser', ['wiki_key' => 'von-hand', 'name' => 'Von Hand']]], 'l-kurve');
$ergebnis = avesmapsEcosystemPushWikiRegionToLabels($pdo, 'r-nordwalser', 'l-kurve', '', '', 7);
$props = labelProperties($pdo, 'l-kurve');
assert(($props['wiki_region']['wiki_key'] ?? '') === 'von-hand', 'ohne Schlüssel an der Region wird nichts gelöscht');
assert($ergebnis['applied'] === 0);
assert($ergebnis['revision'] === null, 'kein Schreibvorgang, kein Revisionssprung');

// Und ein Schlüssel aus lauter Leerzeichen ist dasselbe Nichts wie gar keiner.
$pdo = durchtragFixture([['l-kurve', 'r-nordwalser', null]], 'l-kurve');
assert(avesmapsEcosystemPushWikiRegionToLabels($pdo, 'r-nordwalser', 'l-kurve', '   ', '', 7)['applied'] === 0);
assert(labelProperties($pdo, 'l-kurve') === ['text' => 'Nordwalser Höhen', 'ecosystem_region_public_id' => 'r-nordwalser'],
    'ein blanker Schlüssel schreibt nichts');

// ---- 3. Gleicher Schlüssel: kein Schreibvorgang, kein Revisionssprung ----------------------------
// 🔴 Der Riegel, an dem die Kartennutzlast hängt: der Durchtrag läuft bei JEDEM Speichern der
// Region mit. Schriebe er dabei jedes Mal, machte er die ~21 MB für jeden Besucher ungültig.
$pdo = durchtragFixture([['l-kurve', 'r-nordwalser', ['wiki_key' => 'nordwalser-h-hen', 'name' => 'Nordwalser Höhen']]], 'l-kurve');
$ergebnis = avesmapsEcosystemPushWikiRegionToLabels($pdo, 'r-nordwalser', 'l-kurve', 'nordwalser-h-hen', $url, 7);
assert($ergebnis['applied'] === 0, 'derselbe Schlüssel wird nicht neu geschrieben');
assert($ergebnis['revision'] === null, 'und bumpt damit auch keine Revision');
assert((int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 0, 'und schreibt keine Protokollzeile');

// ---- 4. Der Merker „Kein Wiki-Artikel vorhanden" fällt --------------------------------------------
// 🔴 „Es gibt keinen Artikel" und „hier ist er" schliessen einander aus. Jeder Schreiber von
// properties.wiki_region löscht den Merker; label-wiki-no-article-test.php zählt sie über den
// GANZEN api/-Baum nach -- dieser hier ist einer davon, ohne dass ihn jemand eintragen muss.
$pdo = durchtragFixture([['l-kurve', 'r-nordwalser', null]], 'l-kurve');
$pdo->prepare('UPDATE map_features SET properties_json = :j WHERE public_id = ' . "'l-kurve'")->execute([
    'j' => json_encode(['text' => 'Nordwalser Höhen', 'ecosystem_region_public_id' => 'r-nordwalser', 'wiki_no_article' => true], JSON_UNESCAPED_UNICODE),
]);
avesmapsEcosystemPushWikiRegionToLabels($pdo, 'r-nordwalser', 'l-kurve', 'nordwalser-h-hen', $url, 7);
$props = labelProperties($pdo, 'l-kurve');
assert(($props['wiki_region']['wiki_key'] ?? '') === 'nordwalser-h-hen');
assert(!array_key_exists('wiki_no_article', $props), 'eine Zuweisung beantwortet den dritten Zustand');

// ---- 5. ALLE Beschriftungen der Region, nicht nur die primäre -------------------------------------
// Fläche↔Beschriftung ist 1:N (13 von 1026 Flächen tragen zwei oder drei, AGENTS.md §11). Ein
// Durchtrag, der nur den Zeiger bedient, liesse die übrigen rot stehen.
$pdo = durchtragFixture([
    ['l-kurve', 'r-nordwalser', null],
    ['l-zweit', 'r-nordwalser', null],
    ['l-fremd', 'r-andere', null],
], 'l-kurve');
$ergebnis = avesmapsEcosystemPushWikiRegionToLabels($pdo, 'r-nordwalser', 'l-kurve', 'nordwalser-h-hen', $url, 7);
assert($ergebnis['applied'] === 2, 'beide Beschriftungen der Region, gemeldet: ' . var_export($ergebnis['applied'], true));
assert((labelProperties($pdo, 'l-zweit')['wiki_region']['wiki_key'] ?? '') === 'nordwalser-h-hen');
assert(labelProperties($pdo, 'l-fremd') === ['text' => 'Nordwalser Höhen', 'ecosystem_region_public_id' => 'r-andere'],
    'eine fremde Beschriftung wird nicht angefasst');
// EINE Revision für den ganzen Lauf, nicht eine je Zeile -- wie in avesmapsEcosystemDeleteLabels.
$revisionen = $pdo->query('SELECT DISTINCT revision FROM map_features WHERE public_id IN (' . "'l-kurve','l-zweit'" . ')')
    ->fetchAll(PDO::FETCH_COLUMN);
assert(count($revisionen) === 1, 'ein Lauf, eine Revision');

// ---- 6. Ein ABWEICHENDER Schlüssel wird überschrieben ---------------------------------------------
// 🔴 Dieselbe Regel wie im clientseitigen Durchtrag: „zwei Zuweisungen für dasselbe Ding driften
// auseinander". Die Fläche gewinnt, weil sie das Ding IST -- die Beschriftung beschreibt es nur.
$pdo = durchtragFixture([['l-kurve', 'r-nordwalser', ['wiki_key' => 'gelbe-sichel', 'name' => 'Gelbe Sichel']]], 'l-kurve');
$ergebnis = avesmapsEcosystemPushWikiRegionToLabels($pdo, 'r-nordwalser', 'l-kurve', 'nordwalser-h-hen', $url, 7);
assert($ergebnis['applied'] === 1);
assert((labelProperties($pdo, 'l-kurve')['wiki_region']['wiki_key'] ?? '') === 'nordwalser-h-hen', 'die Fläche schlägt die abweichende Zuweisung');

// ---- 7. Ohne Staging-Zeile: der Minimaldatensatz, nie ein Fehlschlag ------------------------------
// ⚠️ Die Region kann auf einen Schlüssel zeigen, den das Staging (noch) nicht kennt -- ein Crawl ist
// nicht dasselbe wie eine Zuweisung. Dann reist, was sicher bekannt ist. Genau das tut auch der
// Client-Schnappschuss (ecosystemWikiRegionSnapshot fällt auf {wiki_key, wiki_url} zurück); zu
// werfen hiesse, ein Speichern an einer Wiki-Tabelle scheitern zu lassen, die damit nichts zu tun hat.
$pdo = durchtragFixture([['l-kurve', 'r-nordwalser', null]], 'l-kurve', false);
$ergebnis = avesmapsEcosystemPushWikiRegionToLabels($pdo, 'r-nordwalser', 'l-kurve', 'nordwalser-h-hen', $url, 7);
assert($ergebnis['applied'] === 1, 'ohne Staging-Zeile wird trotzdem zugewiesen');
$props = labelProperties($pdo, 'l-kurve');
assert(($props['wiki_region']['wiki_key'] ?? '') === 'nordwalser-h-hen');
assert(($props['wiki_region']['wiki_url'] ?? '') === $url, 'und die URL der Region reist mit');

// ---- 8. Keine Beschriftung: kein Fehler, kein Schreibvorgang --------------------------------------
$pdo = durchtragFixture([], null);
$ergebnis = avesmapsEcosystemPushWikiRegionToLabels($pdo, 'r-nordwalser', null, 'nordwalser-h-hen', $url, 7);
assert($ergebnis['applied'] === 0 && $ergebnis['revision'] === null, 'eine Region ohne Beschriftung ist kein Fehlerfall');

// ---- 9. DIE NAHT: beide Schreibwege rufen den Durchtrag wirklich ----------------------------------
// 💣 Beide Hälften grün, die Naht ungeprüft -- der Fehler, der in diesem Haus schon einen Regler
// monatelang wirkungslos gelassen hat. Gelesen wird der RUMPF der beiden Schreibfunktionen über
// Reflection, mit gestrippten Kommentaren: ein Kommentar, der den Aufruf nur ERWÄHNT, ist kein Aufruf.
function durchtragRumpf(string $funktion): string
{
    $spiegel = new ReflectionFunction($funktion);
    $zeilen = file($spiegel->getFileName());
    $rumpf = implode('', array_slice($zeilen, $spiegel->getStartLine() - 1, $spiegel->getEndLine() - $spiegel->getStartLine() + 1));
    // Zeilenendenneutral (hier CRLF, im Tor LF -- AGENTS.md §9) und ohne Kommentare.
    $rumpf = str_replace("\r\n", "\n", $rumpf);
    $rumpf = preg_replace('~/\*.*?\*/~s', '', $rumpf);

    return (string) preg_replace('~//[^\n]*~', '', (string) $rumpf);
}

foreach (['avesmapsAssignEcosystemWikiRegion', 'avesmapsUpdateEcosystemRegion'] as $schreiber) {
    assert(
        str_contains(durchtragRumpf($schreiber), 'avesmapsEcosystemPushWikiRegionToLabels('),
        $schreiber . ' muss den Durchtrag rufen -- sonst erbt die Beschriftung nur auf einem der Wege'
    );
}

// Und der Durchtrag selbst rührt die FLÄCHE nicht an: er schreibt ausschliesslich map_features.
$eigen = durchtragRumpf('avesmapsEcosystemPushWikiRegionToLabels');
assert(!str_contains($eigen, 'UPDATE ecosystem_region'), 'der Durchtrag schreibt nur Beschriftungen');

// ---- 10. DER BESTANDSLAUF: was schon offen liegt, wird nachgezogen --------------------------------
// 🔴 Die zweite Hälfte des Owner-Entscheids: der Durchtrag oben verhindert NEUE Lücken, er schliesst
// keine alte -- 12 Landschaften trugen die Zuweisung an der Fläche und nicht an ihrer Beschriftung.
// Der Lauf sammelt genau die und reicht jede durch DENSELBEN Durchtrag; er entscheidet nicht selbst,
// was geschrieben wird (sonst gäbe es zwei Regeln für eine Frage).
function bestandFixture(): PDO
{
    // 💣 SIEBEN LAGEN, und fuenf davon sind Ausnahmen -- die erste Fassung dieser Fixture hatte nur
    // drei und liess DREI Mutationen durch: sie prueften genau die Ausnahmen, die nicht dastanden.
    $pdo = durchtragFixture([
        ['l-offen', 'r-nordwalser', null],                                                 // (1) Fläche zugewiesen, Beschriftung leer
        ['l-fertig', 'r-gelbe', ['wiki_key' => 'gelbe-sichel', 'name' => 'Gelbe Sichel']],  // (2) beide zugewiesen
        ['l-ohne', 'r-namenlos', null],                                                    // (3) Fläche ohne Zuweisung
        ['l-primaer', null, null],                                                         // (4) NUR über den Zeiger der Region erreichbar
        ['l-tot', 'r-tot', null],                                                          // (5) an einer stillgelegten Region
        ['l-fremdkey', 'r-fremdkey', ['wiki_key' => 'nur-am-label', 'name' => 'Nur am Label']], // (6) Label zugewiesen, Fläche nicht
        ['l-inaktiv', 'r-inaktivlabel', null],                                             // (7) stillgelegte Beschriftung
    ], null);
    $pdo->prepare('UPDATE map_features SET is_active = 0 WHERE public_id = :p')->execute(['p' => 'l-inaktiv']);
    $pdo->exec('CREATE TABLE ecosystem_region (
        id INTEGER PRIMARY KEY, public_id TEXT, name TEXT, kind TEXT, wiki_region_key TEXT, wiki_url TEXT,
        label_public_id TEXT, is_active INTEGER DEFAULT 1)');
    $einfuegen = $pdo->prepare(
        'INSERT INTO ecosystem_region (public_id, name, kind, wiki_region_key, wiki_url, label_public_id, is_active)
         VALUES (:p, :n, :k, :w, :u, :l, :a)'
    );
    $wiki = 'https://de.wiki-aventurica.de/wiki/';
    // (1) Der Livezustand vom 01.09.2026: die Fläche trägt die Zuweisung, ihre Beschriftung nicht.
    $einfuegen->execute(['p' => 'r-nordwalser', 'n' => 'Nordwalser Höhen', 'k' => 'topographie',
        'w' => 'nordwalser-h-hen', 'u' => $wiki . 'Nordwalser_H%C3%B6hen', 'l' => 'l-offen', 'a' => 1]);
    // (2) Beide zugewiesen: nichts zu tun.
    $einfuegen->execute(['p' => 'r-gelbe', 'n' => 'Gelbe Sichel', 'k' => 'topographie',
        'w' => 'gelbe-sichel', 'u' => $wiki . 'Gelbe_Sichel', 'l' => 'l-fertig', 'a' => 1]);
    // (3) Fläche ohne Zuweisung -- der Lauf reicht nach unten nichts durch, was oben fehlt.
    $einfuegen->execute(['p' => 'r-namenlos', 'n' => 'Namenlos', 'k' => 'vegetation',
        'w' => null, 'u' => null, 'l' => 'l-ohne', 'a' => 1]);
    // 💣 (4) NUR über `label_public_id` erreichbar -- die Beschriftung zeigt selbst auf nichts zurück.
    // Genau diese Richtung trug den gemeldeten Fall (das Kurvenlabel hängt am Zeiger der Region), und
    // ohne sie ist der halbe Sammelweg ungeprüft.
    $einfuegen->execute(['p' => 'r-kurve', 'n' => 'Kurvenland', 'k' => 'topographie',
        'w' => 'kurvenland', 'u' => $wiki . 'Kurvenland', 'l' => 'l-primaer', 'a' => 1]);
    // ⚠️ (5) Eine STILLGELEGTE Region mit Lücke: sie steht auf keiner Karte und gehört in keinen Lauf.
    $einfuegen->execute(['p' => 'r-tot', 'n' => 'Versenkt', 'k' => 'topographie',
        'w' => 'versenkt', 'u' => $wiki . 'Versenkt', 'l' => 'l-tot', 'a' => 0]);
    // ⚠️ (6) Die Beschriftung trägt eine Zuweisung, die Fläche nicht. Der Lauf lässt sie in Ruhe --
    // ohne den Schlüsselfilter zählte er sie als „offen" und der scharfe Lauf schriebe dann nichts:
    // eine Meldung, die grösser ist als das, was passiert, ist schlimmer als keine.
    $einfuegen->execute(['p' => 'r-fremdkey', 'n' => 'Nur am Label', 'k' => 'vegetation',
        'w' => null, 'u' => null, 'l' => 'l-fremdkey', 'a' => 1]);
    // ⚠️ (7) Eine STILLGELEGTE Beschriftung an einer zugewiesenen Fläche: gelöscht ist gelöscht.
    $einfuegen->execute(['p' => 'r-inaktivlabel', 'n' => 'Ohne Beschriftung', 'k' => 'topographie',
        'w' => 'inaktiv-key', 'u' => $wiki . 'Inaktiv', 'l' => 'l-inaktiv', 'a' => 1]);

    return $pdo;
}

// 🔴 Der Trockenlauf ZÄHLT und schreibt nichts, und er ist die Vorgabe: ein Lauf über den ganzen
// Bestand bumpt map_revision und macht damit die ~21 MB Kartennutzlast für jeden Besucher ungültig.
// Dieselbe Zwei-Signal-Haltung wie bei avesmapsEcosystemAssignIsDryRun.
$pdo = bestandFixture();
$probe = avesmapsEcosystemPushWikiRegionsToLabelsAll($pdo, 7, true);
assert($probe['dry_run'] === true);
assert($probe['regions'] === 2, 'die zwei offenen Regionen, gemeldet: ' . var_export($probe['regions'], true));
assert($probe['names'] === ['Nordwalser Höhen', 'Kurvenland'], 'und keine der fünf Ausnahmen: '
    . implode(' | ', $probe['names']));
assert($probe['names_truncated'] === false);
assert($probe['labels'] === 0, 'ein Trockenlauf schreibt nichts');

assert(labelProperties($pdo, 'l-offen') === ['text' => 'Nordwalser Höhen', 'ecosystem_region_public_id' => 'r-nordwalser'],
    'nach dem Trockenlauf steht die Beschriftung unverändert da');
assert((int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 0);

// Scharf: nur die offene wird geschrieben.
$pdo = bestandFixture();
$lauf = avesmapsEcosystemPushWikiRegionsToLabelsAll($pdo, 7, false);
assert($lauf['dry_run'] === false);
assert($lauf['labels'] === 2, 'genau zwei Beschriftungen nachgezogen, gemeldet: ' . var_export($lauf['labels'], true));
assert((labelProperties($pdo, 'l-primaer')['wiki_region']['wiki_key'] ?? '') === 'kurvenland',
    'auch die, die nur über den Zeiger der Region erreichbar ist');
assert((labelProperties($pdo, 'l-fremdkey')['wiki_region']['wiki_key'] ?? '') === 'nur-am-label',
    'eine Zuweisung ohne Gegenstück an der Fläche bleibt stehen');
assert(labelProperties($pdo, 'l-tot') === ['text' => 'Nordwalser Höhen', 'ecosystem_region_public_id' => 'r-tot'],
    'eine stillgelegte Fläche reicht nichts durch');
assert(labelProperties($pdo, 'l-inaktiv') === ['text' => 'Nordwalser Höhen', 'ecosystem_region_public_id' => 'r-inaktivlabel'],
    'und eine stillgelegte Beschriftung bekommt nichts');
assert((labelProperties($pdo, 'l-offen')['wiki_region']['wiki_key'] ?? '') === 'nordwalser-h-hen');
assert((labelProperties($pdo, 'l-fertig')['wiki_region']['wiki_key'] ?? '') === 'gelbe-sichel', 'die fertige bleibt, wie sie ist');
assert(labelProperties($pdo, 'l-ohne') === ['text' => 'Nordwalser Höhen', 'ecosystem_region_public_id' => 'r-namenlos'],
    'eine Fläche ohne Zuweisung reicht nichts durch');

// Und ein zweiter Lauf findet nichts mehr -- der Beleg, dass er am ZUSTAND hängt und nicht an einem
// Merker, den jemand zu setzen vergessen kann.
$zweiter = avesmapsEcosystemPushWikiRegionsToLabelsAll($pdo, 7, false);
assert($zweiter['regions'] === 0 && $zweiter['labels'] === 0, 'der Lauf ist wiederholbar und beim zweiten Mal leer');

// ---- 11. DER NAMENSDECKEL SAGT, DASS ER GEKAPPT HAT ----------------------------------------------
// 🔴 „Keine stille Kappung" (AGENTS.md §9): eine gekürzte Liste, die sich für vollständig ausgibt,
// liest sich wie „das sind alle" -- und wer danach handelt, hält den Rest für erledigt. Gemessen
// wird deshalb BEIDES: dass die Zählung vollständig bleibt und dass die Kürzung gemeldet wird.
$viele = durchtragFixture([], null);
$viele->exec('CREATE TABLE ecosystem_region (
    id INTEGER PRIMARY KEY, public_id TEXT, name TEXT, kind TEXT, wiki_region_key TEXT, wiki_url TEXT,
    label_public_id TEXT, is_active INTEGER DEFAULT 1)');
$regionEinfuegen = $viele->prepare(
    'INSERT INTO ecosystem_region (public_id, name, kind, wiki_region_key, wiki_url, label_public_id, is_active)
     VALUES (:p, :n, "topographie", :w, :u, :l, 1)'
);
$labelEinfuegen = $viele->prepare(
    'INSERT INTO map_features (public_id, feature_type, name, properties_json) VALUES (:p, "label", :n, :j)'
);
$anzahl = AVESMAPS_ECOSYSTEM_PUSH_NAMES_LIMIT + 5;
for ($i = 1; $i <= $anzahl; $i++) {
    $labelEinfuegen->execute(['p' => 'l-' . $i, 'n' => 'Fläche ' . $i,
        'j' => json_encode(['text' => 'Fläche ' . $i, 'ecosystem_region_public_id' => 'r-' . $i], JSON_UNESCAPED_UNICODE)]);
    $regionEinfuegen->execute(['p' => 'r-' . $i, 'n' => 'Fläche ' . $i, 'w' => 'flaeche-' . $i,
        'u' => 'https://de.wiki-aventurica.de/wiki/Flaeche_' . $i, 'l' => 'l-' . $i]);
}
$gross = avesmapsEcosystemPushWikiRegionsToLabelsAll($viele, 7, true);
assert($gross['regions'] === $anzahl, 'gezählt wird vollständig: ' . var_export($gross['regions'], true));
assert(count($gross['names']) === AVESMAPS_ECOSYSTEM_PUSH_NAMES_LIMIT, 'die Namensliste ist gedeckelt');
assert($gross['names_truncated'] === true, 'und die Kappung wird GEMELDET, nicht verschwiegen');

// 🔴 Er trifft KEINE eigene Entscheidung: geschrieben wird ausschliesslich über den geteilten
// Durchtrag. Zwei Regeln für dieselbe Frage sind die Divergenz, die dieses Haus mehrfach bezahlt hat.
$sammel = durchtragRumpf('avesmapsEcosystemPushWikiRegionsToLabelsAll');
assert(str_contains($sammel, 'avesmapsEcosystemPushWikiRegionToLabels('), 'der Lauf ruft den geteilten Durchtrag');
assert(!str_contains($sammel, 'UPDATE map_features'), 'und schreibt nicht selbst');

// ---- 12. DIE ZWEITE NAHT: der Endpunkt kennt den Lauf, und der Trockenlauf ist die Vorgabe -------
// 💣 Der Endpunkt lässt sich nicht laden -- er LÄUFT beim Include (Auth, CORS, PDO). Gelesen wird
// deshalb sein Quelltext, mit gestrippten Kommentaren: ein Kommentar, der die Aktion erwähnt, ist
// keine Verdrahtung. Ohne diese Zusicherung wäre der Lauf serverseitig vorhanden und von aussen
// unerreichbar -- die Lage, in der beide Hälften grün sind und die Naht fehlt.
$endpunkt = file_get_contents(__DIR__ . '/../../../edit/map/ecosystem.php');
assert($endpunkt !== false, 'der Endpunkt ist lesbar');
$endpunkt = str_replace("\r\n", "\n", $endpunkt);
$endpunkt = (string) preg_replace('~//[^\n]*~', '', (string) preg_replace('~/\*.*?\*/~s', '', $endpunkt));
assert(str_contains($endpunkt, "'push_wiki_regions_to_labels' => avesmapsEcosystemPushWikiRegionsToLabelsAll("),
    'der Endpunkt muss den Bestandslauf anbieten');
// 🔴 Und er reicht die ZWEI-SIGNAL-Weiche durch, statt sich eine eigene zu bauen: dieselbe Funktion,
// die auch assign_wiki_region schützt. Eine zweite Lesart von `dry_run` wäre die Stelle, an der ein
// Lauf über den ganzen Bestand versehentlich scharf geht.
$ausschnitt = substr($endpunkt, (int) strpos($endpunkt, "'push_wiki_regions_to_labels'"), 400);
assert(str_contains($ausschnitt, 'avesmapsEcosystemAssignIsDryRun($payload)'),
    'der Trockenlauf-Riegel ist der geteilte, nicht ein zweiter');

echo "OK - Durchtrag der Wiki-Landschaft an die Beschriftungen: alle Zusicherungen erfüllt.\n";
