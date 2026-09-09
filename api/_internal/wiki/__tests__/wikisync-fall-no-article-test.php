<?php

declare(strict_types=1);

/**
 * DER DRITTE SCHREIBER von `properties.wiki_url` -- „WikiSync-Fall lösen" -- und der Merker
 * „kein Wiki-Artikel". Lauf (aus dem Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll \
 *       api/_internal/wiki/__tests__/wikisync-fall-no-article-test.php
 *
 * 🔴 WARUM ES DIESEN TEST GIBT -- und warum er den Ausbau des Merkers UEBERLEBT HAT, waehrend drei
 * seiner Geschwister gefallen sind: er ist die EINZIGE ausfuehrende Abdeckung von
 * `avesmapsWikiSyncUpdateLocationFeature` (nachgezaehlt am 09.09.2026: zwei Fundstellen im
 * api/-Baum, eine davon diese Datei). Wer ihn mit dem Merker weggeworfen haette, haette den dritten
 * Schreiber von `properties.wiki_url` ungeprueft zurueckgelassen.
 *
 * 🔴 SEIN URSPRUNGSBEFUND, damit ihn niemand wieder herstellt: `update_point` und `assign_to`
 * kannten den Merker seit dem 16.08.2026; dieser Schreibweg (gerufen aus
 * `avesmapsWikiSyncResolveCase`, verdrahtet in js/review/review-wiki-sync-resolve.js) kannte ihn
 * NULL Mal und schrieb `wiki_url` trotzdem. Ein Ort, den jemand ausdruecklich als „kein
 * Wiki-Artikel" markiert hatte, bekam ueber den Fall eine echte Adresse, waehrend der Merker
 * stehenblieb -- und `update_point` lehnte danach JEDES Speichern dieses Ortes ab („kann nicht
 * gleichzeitig einen Wiki-Artikel haben und keinen"), mit einer Ursache in einem versteckten
 * Formularfeld.
 * ⭐ `properties.wiki_no_article` ist am 09.09.2026 global ausgebaut (Owner-Entscheid nach
 * Durchsicht aller 10 Traeger); sein Aequivalent ist die WIKI-ZUWEISUNG. Damit gibt es den
 * verbotenen Zustand nicht mehr -- eine der beiden Aussagen existiert nicht. Die Zusicherungen
 * unten messen seither den SCHREIBWEG (schreiben, leeren, nichts zu tun) und halten daneben fest,
 * dass der Merker nicht zurueckkommt.
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

// ── 1) DER FALL WEIST ZU ──────────────────────────────────────────────────────────────────────
// Der Ausgangszustand ist der aus dem Befund: ein Editor hatte „kein Wiki-Artikel" gesetzt, danach
// loest jemand einen WikiSync-Fall, der diesem Ort eine Adresse gibt.
$seed($pdo, ['name' => 'Havena', 'wiki_no_article' => true]);
avesmapsWikiSyncUpdateLocationFeature(
    $pdo, [], $user, 'loc-1', 'Havena', 'dorf', '', AVESMAPS_TEST_HAVENA_URL, false, false
);
$nachher = $props($pdo);
assert(($nachher['wiki_url'] ?? '') === AVESMAPS_TEST_HAVENA_URL, 'der Fall hat die Adresse gar nicht geschrieben');
// 🔴 UMGEDREHT AM 09.09.2026: hier stand „der Merker FAELLT". Der Schreibweg raeumt ihn seither
// nicht mehr weg -- das gehoert der einmaligen Bestandsreparatur (Schritt 4 des Ausbaus), nicht
// jedem geloesten Fall: ein Schreibpfad, der nebenbei aufraeumt, veraendert die Bestandszahl,
// waehrend die Reparatur sie messen soll.
assert(
    ($nachher['wiki_no_article'] ?? null) === true,
    'der WikiSync-Fall raeumt den Altbestand-Merker weg -- das gehoert der Bestandsreparatur'
);

// ── 2) UND DER ORT BLEIBT SPEICHERBAR -- DAS IST DER GEWINN DES AUSBAUS ───────────────────────
// 💣 Die Probe faehrt den ANDEREN Schreibweg mit dem Ergebnis dieses hier. Bis zum 09.09.2026 warf
// sie an genau dieser Stelle: der Ort trug Adresse UND „kein Artikel", `avesmapsApplyPointWikiFields`
// lehnte JEDES weitere Speichern ab, und die Ursache steckte in einem versteckten Formularfeld --
// der Ort war blockiert, bis jemand das Haekchen aus- und wieder einschaltete.
// 🔴 MIT DEM MERKER IST DER VERBOTENE ZUSTAND WEG, nicht nur der Riegel: es gibt keine zweite,
// negative Aussage mehr, der eine Adresse widersprechen koennte. Genau dieser Kreis war einer der
// Gruende fuer den Owner-Entscheid, und deshalb steht er hier weiter -- jetzt als Zusicherung, dass
// er sich NICHT schliesst.
$weiterSpeicherbar = avesmapsApplyPointWikiFields(
    $nachher,
    ['name' => 'Havena'],
    (string) ($nachher['wiki_url'] ?? '')
);
assert(is_array($weiterSpeicherbar), 'ein geloester Fall macht den Ort wieder unspeicherbar');
// ⚠️ Und die Gegenprobe, dass die Probe darueber ueberhaupt etwas beruehrt: der Rechner laeuft mit
// genau dem Zustand, der frueher geworfen hat -- Altbestand-Merker UND frische Adresse.
assert(($nachher['wiki_no_article'] ?? null) === true && ($nachher['wiki_url'] ?? '') !== '',
    'die Probe faehrt gar nicht den frueher verbotenen Zustand -- sie beweist dann nichts');

// ── 3) EIN LEERER `wiki_url` LEERT DIE ADRESSE UND SONST NICHTS ───────────────────────────────
// ⚠️ Hier stand die feinste Unterscheidung des ganzen Merkers: „diese Verbindung war falsch" ist
// nicht „es gibt keinen Artikel" -- ein Fall, der die Adresse LEERT, durfte die Aussage des Editors
// nicht mitnehmen (dieselbe Trennung wie bei `clear_assign`). Sie ist mit dem Merker gefallen; was
// bleibt, ist die Zusicherung ueber die ADRESSE, und daneben der Waechter, dass der Schreibweg auch
// beim Leeren keinen fremden Schluessel anfasst.
$seed($pdo, ['name' => 'Havena', 'wiki_no_article' => true, 'wiki_url' => 'https://alt.example/wiki/X']);
avesmapsWikiSyncUpdateLocationFeature($pdo, [], $user, 'loc-1', 'Havena', 'dorf', '', '', false, false);
$geleert = $props($pdo);
assert(!array_key_exists('wiki_url', $geleert), 'die Adresse wurde nicht geleert');
assert(
    ($geleert['wiki_no_article'] ?? null) === true,
    'das Leeren der Adresse hat den Merker mitgenommen -- „Verbindung falsch" ist nicht „kein Artikel"'
);

// ── 4) „NICHTS ZU TUN" LAESST DIE ADRESSE STEHEN ──────────────────────────────────────────────
// 💣 Hier sass die zweite Haelfte des Ursprungsfehlers, und sie war ohne ABLAUF unsichtbar: trug der
// Ort die zuzuweisende Adresse BEREITS und daneben den Merker, meldete
// `avesmapsWikiSyncLocationFeatureNeedsUpdate` „nichts zu tun", und der Schreibweg kehrte um, BEVOR
// der Bauer je lief -- der Widerspruch war entstanden und liess sich nicht mehr aufloesen. Eine
// Probe am Bauer allein haette das nie gesehen; deshalb faehrt diese Datei den ABLAUF.
// ⚠️ Der Kurzschluss ist unveraendert richtig und wird hier weiter gemessen: dieselbe Adresse
// zweimal geschrieben darf keine Revision heben und die gespeicherte Adresse nicht verlieren.
$seed($pdo, ['name' => 'Havena', 'wiki_no_article' => true, 'wiki_url' => AVESMAPS_TEST_HAVENA_URL]);
avesmapsWikiSyncUpdateLocationFeature(
    $pdo, [], $user, 'loc-1', 'Havena', 'dorf', '', AVESMAPS_TEST_HAVENA_URL, false, false
);
$unveraendert = $props($pdo);
assert(($unveraendert['wiki_url'] ?? '') === AVESMAPS_TEST_HAVENA_URL, 'der Kurzschluss hat die Adresse verloren');
assert((int) $pdo->query("SELECT revision FROM map_features WHERE public_id = 'loc-1'")->fetchColumn() === 7,
    'ein Lauf ohne Unterschied hebt die Revision -- das machte die ~21 MB Kartennutzlast umsonst ungueltig');

// ── 5) RUECKBAU-WAECHTER: `locations.php` KENNT DEN MERKER GAR NICHT MEHR ─────────────────────
// 🔴 Hier stand eine feinere Probe: der Merker durfte in dieser Datei NUR in den zwei Funktionen des
// Schreibwegs vorkommen -- stuende er in einer Listenabfrage, einem `WHERE` oder einem Fall-Filter,
// verschwaenden markierte Orte lautlos aus den Faellen (ausdruecklicher Entscheid: ein Ort mit
// Merker sollte WEITER auftauchen, denn im Wiki kann inzwischen ein Artikel entstanden sein, und
// das ist Information, keine Stoerung).
// ⚠️ Mit dem Ausbau ist aus „nur an zwei Stellen" ein „an keiner" geworden, und das ist die
// einfachere und schaerfere Zusicherung. Gemessen wird der KOMMENTARFREIE Quelltext ueber den
// Tokenizer -- die Begruendung hier oben nennt das Wort, das unten nicht vorkommen darf, und ein
// Test, der Fliesstext misst, schlaegt an seiner eigenen Warnung an (AGENTS.md §11).
$listenCode = '';
foreach (token_get_all((string) file_get_contents(__DIR__ . '/../locations.php')) as $stueck) {
    if (is_array($stueck)) {
        if ($stueck[0] === T_COMMENT || $stueck[0] === T_DOC_COMMENT) {
            continue;
        }
        $listenCode .= $stueck[1];
        continue;
    }
    $listenCode .= $stueck;
}
// ⚠️ Die Gegenprobe gegen einen leeren Leser: eine leere Zeichenkette erfuellt jedes „kommt nicht
// vor". Der Name der gemessenen Funktion MUSS darin stehen.
assert(str_contains($listenCode, 'avesmapsWikiSyncBuildLocationProperties'),
    'der Tokenizer liefert keinen Quelltext -- die Zusicherung darunter waere ein Vakuum');
assert(
    !str_contains($listenCode, 'wiki_no_article'),
    'locations.php fasst den ausgebauten Merker wieder an -- er ist am 09.09.2026 global gefallen '
    . '(Owner-Entscheid); sein Aequivalent ist die WIKI-ZUWEISUNG.'
);

fwrite(STDOUT, "wikisync-fall-no-article-test: alle Zusicherungen erfuellt\n");
