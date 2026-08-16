<?php

declare(strict_types=1);

/**
 * DER DRITTE SCHREIBER von `properties.wiki_url` -- „WikiSync-Fall lösen" -- und der Merker
 * „kein Wiki-Artikel". Lauf (aus dem Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll \
 *       api/_internal/wiki/__tests__/wikisync-fall-no-article-test.php
 *
 * 🔴 WARUM ES DIESEN TEST GIBT. `update_point` und `assign_to` kennen den Merker seit dem
 * 16.08.2026; `avesmapsWikiSyncUpdateLocationFeature` (gerufen aus `avesmapsWikiSyncResolveCase`,
 * verdrahtet in js/review/review-wiki-sync-resolve.js) kannte ihn NULL Mal und schrieb `wiki_url`
 * trotzdem. Ein Ort, den jemand ausdruecklich als „kein Wiki-Artikel" markiert hat, bekam ueber den
 * Fall eine echte Adresse, waehrend der Merker stehenblieb.
 *
 * 💣 DER SCHADEN IST NICHT KOSMETISCH: `update_point` lehnt danach JEDES Speichern dieses Ortes ab
 * („kann nicht gleichzeitig einen Wiki-Artikel haben und keinen", avesmapsApplyPointWikiFields), und
 * die Ursache steckt in einem versteckten Formularfeld -- der Ort waere blockiert, bis jemand das
 * Haekchen aus- und wieder einschaltet. Genau diesen Kreis faehrt die letzte Zusicherung unten ab.
 *
 * ⚠️ ABLAUF, NICHT BAUER: gefahren wird `avesmapsWikiSyncUpdateLocationFeature` selbst, an einer
 * echten (SQLite-)Karte -- eine Probe an `avesmapsWikiSyncBuildLocationProperties` allein saehe
 * nicht, ob der Schreibweg sie ueberhaupt erreicht (`…LocationFeatureNeedsUpdate` kann vorher
 * abbrechen, und genau das tat es im Heilungsfall). Hausform:
 * api/_internal/conflicts/__tests__/conflict-repair-reach-test.php.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

// ⚠️ `locations.php` bringt seine eigenen Helfer NICHT mit (avesmapsWikiSyncDecodeJson u. a. wohnen
// in sync.php) -- im Betrieb laedt der Endpunkt beide. Nachgeschlagen, nicht angenommen.
require __DIR__ . '/../sync.php';
require __DIR__ . '/../locations.php';
require __DIR__ . '/../../map/features.php';

/**
 * Die MySQL-eigenen Anweisungen im Schreibpfad, an der TREIBER-Naht uebersetzt statt die Funktionen
 * nachzubauen -- sonst prueft der Test eine Kopie und nicht den Code, der live laeuft.
 *   · `FOR UPDATE`            (avesmapsWikiSyncFetchEditablePointFeature) -- SQLite kennt es nicht.
 *   · `NOW(3)`                (avesmapsWikiSyncAssertFeatureCanBeEdited, Sperrenabfrage).
 *   · `ON DUPLICATE KEY …`    (avesmapsWikiSyncNextMapRevision).
 */
final class AvesmapsWikiSyncFallTestPdo extends PDO
{
    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        $query = str_replace('FOR UPDATE', '', $query);
        $query = str_replace('NOW(3)', "datetime('now')", $query);

        return parent::prepare($query, $options);
    }

    public function exec(string $statement): int|false
    {
        if (str_contains($statement, 'ON DUPLICATE KEY UPDATE revision = revision + 1')) {
            $statement = 'INSERT INTO map_revision (id, revision) VALUES (1, 2)
                          ON CONFLICT(id) DO UPDATE SET revision = map_revision.revision + 1';
        }

        return parent::exec($statement);
    }
}

$pdo = new AvesmapsWikiSyncFallTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE map_features (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT, name TEXT, feature_type TEXT, feature_subtype TEXT,
    geometry_type TEXT, geometry_json TEXT, properties_json TEXT, style_json TEXT,
    is_active INTEGER DEFAULT 1, revision INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 1,
    updated_by INTEGER NULL, min_x REAL, min_y REAL, max_x REAL, max_y REAL
)');
$pdo->exec('CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
$pdo->exec('CREATE TABLE map_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, feature_id INTEGER NULL, action TEXT,
    actor_user_id INTEGER, before_json TEXT, after_json TEXT
)');
$pdo->exec('CREATE TABLE map_feature_locks (public_id TEXT PRIMARY KEY, user_id INTEGER, username TEXT, locked_until TEXT)');

const AVESMAPS_TEST_HAVENA_URL = 'https://de.wiki-aventurica.de/wiki/Havena';

/** Setzt die Karte auf einen Ort mit gewaehlten Eigenschaften zurueck. */
$seed = static function (PDO $pdo, array $properties): void {
    $pdo->exec('DELETE FROM map_features');
    $pdo->exec('DELETE FROM map_audit_log');
    $pdo->exec('DELETE FROM map_revision');
    $insert = $pdo->prepare(
        'INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_type,
             geometry_json, properties_json, is_active, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 7)'
    );
    $insert->execute([
        'loc-1', 'Havena', 'location', 'dorf', 'Point',
        json_encode(['type' => 'Point', 'coordinates' => [12.5, 34.5]]),
        json_encode((object) $properties),
    ]);
};
/** Die gespeicherten Eigenschaften des Ortes, frisch aus der Tabelle. */
$props = static function (PDO $pdo): array {
    $stmt = $pdo->query("SELECT properties_json FROM map_features WHERE public_id = 'loc-1'");
    $decoded = json_decode((string) $stmt->fetchColumn(), true);

    return is_array($decoded) ? $decoded : [];
};
$user = ['id' => 3, 'username' => 'pruefer'];

// ── 1) DER FALL WEIST ZU -- UND DER MERKER FAELLT ─────────────────────────────────────────────
// Der Ausgangszustand ist genau der aus dem Befund: ein Editor hat „kein Wiki-Artikel" gesetzt,
// danach loest jemand einen WikiSync-Fall, der diesem Ort eine Adresse gibt.
$seed($pdo, ['name' => 'Havena', 'wiki_no_article' => true]);
avesmapsWikiSyncUpdateLocationFeature(
    $pdo, [], $user, 'loc-1', 'Havena', 'dorf', '', AVESMAPS_TEST_HAVENA_URL, false, false
);
$nachher = $props($pdo);
assert(($nachher['wiki_url'] ?? '') === AVESMAPS_TEST_HAVENA_URL, 'der Fall hat die Adresse gar nicht geschrieben');
assert(
    !array_key_exists('wiki_no_article', $nachher),
    'der WikiSync-Fall laesst den Merker stehen -- der Ort traegt danach Adresse UND „kein Artikel"'
);

// ── 2) UND DAS IST DER EIGENTLICHE SCHADEN: DER ORT WAERE UNSPEICHERBAR ────────────────────────
// 💣 Die Probe faehrt den Riegel des ANDEREN Schreibwegs mit dem Ergebnis dieses hier. Ohne die
// Reparatur wirft sie -- und live hiesse das: jedes „Speichern" im Ortsdialog wird abgelehnt, mit
// einer Begruendung, deren Ursache in einem versteckten Feld steckt.
avesmapsApplyPointWikiFields($nachher, ['name' => 'Havena'], (string) ($nachher['wiki_url'] ?? ''));

// Gegenprobe, dass dieser Riegel ueberhaupt scharf ist -- sonst waere Zusicherung 2 wertlos.
$riegelBeisst = false;
try {
    avesmapsApplyPointWikiFields(
        ['wiki_no_article' => true, 'wiki_url' => AVESMAPS_TEST_HAVENA_URL],
        ['name' => 'Havena'],
        AVESMAPS_TEST_HAVENA_URL
    );
} catch (InvalidArgumentException) {
    $riegelBeisst = true;
}
assert($riegelBeisst, 'der Widerspruchs-Riegel ist stumpf -- die Probe darueber beweist dann nichts');

// ── 3) EIN LEERER `wiki_url` FASST DEN MERKER NICHT AN ────────────────────────────────────────
// ⚠️ „Diese Verbindung war falsch" ist nicht „es gibt keinen Artikel" -- dieselbe Trennung wie bei
// `clear_assign`. Ein Fall, der die Adresse LEERT, darf die Aussage des Editors nicht mitnehmen.
$seed($pdo, ['name' => 'Havena', 'wiki_no_article' => true, 'wiki_url' => 'https://alt.example/wiki/X']);
avesmapsWikiSyncUpdateLocationFeature($pdo, [], $user, 'loc-1', 'Havena', 'dorf', '', '', false, false);
$geleert = $props($pdo);
assert(!array_key_exists('wiki_url', $geleert), 'die Adresse wurde nicht geleert');
assert(
    ($geleert['wiki_no_article'] ?? null) === true,
    'das Leeren der Adresse hat den Merker mitgenommen -- „Verbindung falsch" ist nicht „kein Artikel"'
);

// ── 4) DIE HEILUNG EINES BEREITS VERGIFTETEN ORTES ────────────────────────────────────────────
// 💣 Hier sass die zweite Haelfte des Fehlers, und sie ist ohne ABLAUF unsichtbar: traegt der Ort die
// zuzuweisende Adresse BEREITS und daneben den Merker, meldete `…LocationFeatureNeedsUpdate`
// „nichts zu tun" und der Schreibweg kehrte um, BEVOR der Bauer je lief. Der Widerspruch waere also
// entstanden und haette sich nicht mehr aufloesen lassen -- der Ort blieb gesperrt.
$seed($pdo, ['name' => 'Havena', 'wiki_no_article' => true, 'wiki_url' => AVESMAPS_TEST_HAVENA_URL]);
avesmapsWikiSyncUpdateLocationFeature(
    $pdo, [], $user, 'loc-1', 'Havena', 'dorf', '', AVESMAPS_TEST_HAVENA_URL, false, false
);
$geheilt = $props($pdo);
assert(
    !array_key_exists('wiki_no_article', $geheilt),
    'ein bereits widerspruechlicher Ort wird vom Auflösen nicht geheilt -- er bliebe unspeicherbar'
);
assert(($geheilt['wiki_url'] ?? '') === AVESMAPS_TEST_HAVENA_URL, 'die Heilung hat die Adresse verloren');

// ── 5) DIE FALL-LISTE WIRD NICHT GEFILTERT ────────────────────────────────────────────────────
// 🔴 Ausdruecklicher Entscheid: ein Ort mit Merker soll WEITER in den Faellen auftauchen. Im Wiki
// kann inzwischen ein Artikel entstanden sein, und das ist Information, keine Stoerung -- nur das
// AUFLOESEN raeumt den Widerspruch weg. Waere die Liste gefiltert, verschwaende der Fall lautlos und
// niemand erfuehre je von dem neuen Artikel.
// ⚠️ Textprobe, und sie ist als solche benannt: die Listenabfrage braucht die WikiSync-Staging-
// Tabellen. Sie beantwortet genau eine Frage -- taucht der Merker in der Fall-Auswahl auf? --, und
// die Antwort muss NEIN lauten.
$listenQuelle = file_get_contents(__DIR__ . '/../locations.php');
assert(is_string($listenQuelle));
assert(
    preg_match('/function avesmapsWikiSyncBuildLocationProperties\(.*?\n\}/s', $listenQuelle, $bauer) === 1
    && str_contains($bauer[0], "unset(\$properties['wiki_no_article'])"),
    'der Bauer loescht den Merker nicht mehr'
);
// 🔴 Gezaehlt wird nicht „wie oft", sondern „WO": der Merker darf in dieser Datei NUR in den zwei
// Funktionen des Schreibwegs vorkommen. Steht er irgendwo sonst -- in einer Listenabfrage, einem
// `WHERE`, einem Fall-Filter --, verschwaenden markierte Orte lautlos aus den Faellen.
// ⚠️ Eine reine Zahl waere hier die falsche Probe gewesen: sie muesste bei jeder neuen (richtigen)
// Fundstelle nachgezogen werden und saehe trotzdem nicht, ob die neue Stelle eine Abfrage ist.
$ohneSchreibweg = $listenQuelle;
foreach (['avesmapsWikiSyncBuildLocationProperties', 'avesmapsWikiSyncLocationFeatureNeedsUpdate'] as $erlaubt) {
    assert(
        preg_match('/function ' . $erlaubt . '\(.*?\n\}/s', $ohneSchreibweg, $treffer) === 1,
        // ⚠️ Geschweifte Klammern: PHP zieht das typografische Anfuehrungszeichen sonst in den
        // Variablennamen und meldet „Undefined variable $erlaubt“".
        "„{$erlaubt}“ laesst sich nicht isolieren -- der Rest-Vergleich waere blind"
    );
    $ohneSchreibweg = str_replace($treffer[0], '', $ohneSchreibweg);
}
assert(
    !str_contains($ohneSchreibweg, 'wiki_no_article'),
    'wiki_no_article steht in locations.php ausserhalb des Schreibwegs -- steht es in einer Listen- '
    . 'oder Filterabfrage, verschwinden markierte Orte aus den Faellen'
);

fwrite(STDOUT, "wikisync-fall-no-article-test: alle Zusicherungen erfuellt\n");
