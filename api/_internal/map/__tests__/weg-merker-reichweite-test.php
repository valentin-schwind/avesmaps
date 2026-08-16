<?php

declare(strict_types=1);

/**
 * Die REICHWEITE des Merkers „kein Wiki-Artikel" beim WEG, an einer echten Datenbank. Lauf (aus dem
 * Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll \
 *       api/_internal/map/__tests__/weg-merker-reichweite-test.php
 *
 * 🔴 WARUM ES DIESEN TEST GIBT. Die erste Fassung von Aufgabe 5c schrieb den Merker auf das EINE
 * bearbeitete Wegstueck und meldete die Frage nach der Reichweite als offen. Sie war nicht offen:
 * fuer GENAU DIESEN Merker hat der Owner am 15.08.2026 die weite Reichweite entschieden
 * (avesmapsConflictRepairSpansNameGroup, api/_internal/conflicts/repair.php) -- ein Fall im
 * Konfliktzentrum ist bei einer segmentierten Art eine LINIE, kein Segment. Gemessen wurde der
 * Widerspruch am selben Kasten:
 *
 *     update_path_details mit wiki_no_article=true  -> 1 UPDATE  (nur das eine Wegstueck)
 *     assign_to (Knopf „Zuweisen" daneben)          -> 3 UPDATEs (alle gleichnamigen)
 *
 * „Zwei Knoepfe am selben Fall, die verschieden weit reichen, sind schlimmer als zwei getrennte
 * Fehler" (Owner-Entscheid 15.08.2026, wortgleich im Kopf von repair.php).
 *
 * ⚠️ ABLAUF, NICHT BAUER: gefahren wird `avesmapsUpdatePathFeatureDetails` selbst, an einer echten
 * (SQLite-)Karte. Eine Probe an `avesmapsApplyPathWikiNoArticleToNameGroup` allein saehe nicht, ob
 * der Schreibweg sie ueberhaupt erreicht -- und schon gar nicht, mit WELCHEM Namen. Hausform:
 * api/_internal/conflicts/__tests__/conflict-repair-reach-test.php.
 *
 * ⚠️ GRENZE WIE BEIM NACHBARTEST: SQLite vergleicht `name` BINAER, MySQL live in utf8mb4_unicode_ci.
 * Der Verbund faellt hier also HOECHSTENS kleiner aus als live -- die sichere Richtung fuer einen
 * Test, der „mindestens diese Zeilen werden gefasst" beweisen soll.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

// ⚠️ `bootstrap.php` zuerst, und das ist nachgeschlagen, nicht angenommen: `features.php` bringt
// seine Grundhelfer NICHT mit -- avesmapsNormalizeSingleLine (die Kennungs- und Namenspruefungen
// haengen daran) wohnt dort. Im Betrieb laedt jeder Endpunkt beides. Die Datei hat ausser einem
// `define`-Waechter keine Anweisung auf oberster Ebene, holt also keine Konfiguration und keine PDO.
require __DIR__ . '/../../bootstrap.php';
require __DIR__ . '/../features.php';
require __DIR__ . '/../../conflicts/rules.php';

/**
 * Die MySQL-eigenen Anweisungen im Schreibpfad, an der TREIBER-Naht uebersetzt statt die Funktionen
 * nachzubauen -- sonst prueft der Test eine Kopie und nicht den Code, der live laeuft.
 *   · `FOR UPDATE`         (avesmapsFetchEditableFeature)
 *   · `NOW(3)`             (avesmapsAssertFeatureCanBeEdited, Sperrenabfrage)
 *   · `ON DUPLICATE KEY …` (avesmapsNextMapRevision)
 */
final class AvesmapsWegReichweiteTestPdo extends PDO
{
    /**
     * ⭐ Wie oft die VERBUND-Abfrage gestellt wurde. Sie ist der einzige Weg, den Kosten-Riegel
     * („nur wenn der Rumpf den Merker mitbringt") ueberhaupt zu messen: ohne ihn laeuft die Abfrage
     * bei jedem Speichern und schreibt trotzdem nichts -- an den gespeicherten Werten ist das nicht
     * zu sehen, und die Mutation lief zuerst gruen durch. Hausform: der Spion-Test des
     * Kreuzungs-Pruefhakens (AGENTS.md §11).
     */
    public int $verbundAbfragen = 0;

    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        if (str_contains($query, "feature_type = 'path' AND name = :n")) {
            $this->verbundAbfragen++;
        }
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

$pdo = new AvesmapsWegReichweiteTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
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

// ⚠️ ECHTE KENNUNGEN, keine sprechenden Kuerzel: `avesmapsReadMapFeaturePublicId` verlangt 36
// Zeichen im UUID-Format und wirft sonst schon in der ersten Zeile des Schreibwegs. Die Namen
// darueber sagen, welches Wegstueck gemeint ist.
const AVESMAPS_WEG_TEST_IDS = [
    'path-1' => '11111111-1111-4111-8111-111111111111',      // das bearbeitete Wegstueck
    'path-2' => '22222222-2222-4222-8222-222222222222',      // Geschwister MIT flacher Adresse
    'path-3' => '33333333-3333-4333-8333-333333333333',      // Geschwister
    'path-fremd' => '44444444-4444-4444-8444-444444444444',  // anderer Name
    'path-alt' => '55555555-5555-4555-8555-555555555555',    // gestrichenes Segment desselben Namens
];

$LINIE = [
    'type' => 'LineString',
    'coordinates' => [[10.0, 20.0], [11.0, 21.0]],
];
$user = ['id' => 5, 'username' => 'pruefer'];

/**
 * Die Karte: DREI aktive Wegstuecke desselben Namens „Aguera" (das ist der Livebestandsfall -- ein
 * Weg-NAME steht fuer viele Segmente), dazu ein fremder Weg und ein INAKTIVES Segment desselben
 * Namens. Die letzten zwei sind die Gegenprobe: der Verbund darf weder ueber den Namen hinaus noch
 * auf gestrichene Zeilen greifen.
 */
$seed = static function (PDO $pdo) use ($LINIE): void {
    $pdo->exec('DELETE FROM map_features');
    $pdo->exec('DELETE FROM map_audit_log');
    $pdo->exec('DELETE FROM map_revision');
    $insert = $pdo->prepare(
        'INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_type,
             geometry_json, properties_json, is_active, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 7)'
    );
    $zeilen = [
        // public_id, name, aktiv, eigene Eigenschaften
        [AVESMAPS_WEG_TEST_IDS['path-1'], 'Aguera', 1, ['name' => 'Aguera']],
        // 💣 Dieses Geschwister traegt eine flache Adresse: sie MUSS mit fallen, sonst stuende es
        // nach dem Haekchen im verbotenen Zustand („Adresse UND kein Artikel") und waere
        // unspeicherbar.
        [AVESMAPS_WEG_TEST_IDS['path-2'], 'Aguera', 1, ['name' => 'Aguera', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Aguera']],
        [AVESMAPS_WEG_TEST_IDS['path-3'], 'Aguera', 1, ['name' => 'Aguera']],
        [AVESMAPS_WEG_TEST_IDS['path-fremd'], 'Rakula', 1, ['name' => 'Rakula']],
        [AVESMAPS_WEG_TEST_IDS['path-alt'], 'Aguera', 0, ['name' => 'Aguera']],
    ];
    foreach ($zeilen as [$publicId, $name, $aktiv, $properties]) {
        $insert->execute([
            $publicId, $name, 'path', 'Flussweg', 'LineString',
            json_encode($LINIE), json_encode((object) $properties), $aktiv,
        ]);
    }
};

/** Alle Zeilen als public_id => [merker, wiki_url, revision]. */
$karte = static function (PDO $pdo): array {
    $rows = $pdo->query('SELECT public_id, properties_json, revision FROM map_features')->fetchAll(PDO::FETCH_ASSOC);
    $out = [];
    foreach ($rows as $row) {
        $props = json_decode((string) $row['properties_json'], true);
        $props = is_array($props) ? $props : [];
        $out[(string) $row['public_id']] = [
            'merker' => !empty($props['wiki_no_article']),
            'wiki_url' => (string) ($props['wiki_url'] ?? ''),
            'revision' => (int) $row['revision'],
        ];
    }

    return $out;
};

/** Der Rumpf, den beide Weg-Oberflaechen absenden -- ohne den Merker, wenn $merker === null. */
$rumpf = static function (?bool $merker): array {
    $payload = [
        'public_id' => AVESMAPS_WEG_TEST_IDS['path-1'],
        'name' => 'Aguera',
        'feature_subtype' => 'Flussweg',
        'show_label' => true,
        'allowed_transports' => null,
        'transport_seasons' => null,
        'other_source' => null,
    ];
    if ($merker !== null) {
        $payload['wiki_no_article'] = $merker;
    }

    return $payload;
};

// ── 1) DAS HAEKCHEN GILT FUER DEN GANZEN NAMENSVERBUND ────────────────────────────────────────
// 🔴 DIE Zusicherung dieser Nachbesserung. Vorher: 1 Zeile. Jetzt: alle drei aktiven „Aguera".
$seed($pdo);
$vorher = $karte($pdo);
foreach ([AVESMAPS_WEG_TEST_IDS['path-1'], AVESMAPS_WEG_TEST_IDS['path-2'], AVESMAPS_WEG_TEST_IDS['path-3']] as $id) {
    assert($vorher[$id]['merker'] === false, "die Fixture startet mit gesetztem Merker auf $id");
}
avesmapsUpdatePathFeatureDetails($pdo, $rumpf(true), $user);
$nachher = $karte($pdo);
foreach ([AVESMAPS_WEG_TEST_IDS['path-1'], AVESMAPS_WEG_TEST_IDS['path-2'], AVESMAPS_WEG_TEST_IDS['path-3']] as $id) {
    assert(
        $nachher[$id]['merker'] === true,
        "\"$id\" traegt den Merker nicht -- das Haekchen reicht nur ueber das bearbeitete Wegstueck, "
        . 'waehrend „Zuweisen" im selben Kasten alle gleichnamigen fasst'
    );
}
// 💣 Und die flache Adresse des Geschwisters ist mitgefallen -- sonst stuende es im verbotenen
// Zustand und jedes weitere Speichern dieses Wegstuecks liefe in den Widerspruchs-Riegel.
assert(
    $nachher[AVESMAPS_WEG_TEST_IDS['path-2']]['wiki_url'] === '',
    'die gespeicherte Adresse des Geschwisters steht noch -- es traegt jetzt Adresse UND Merker'
);

// ── 2) UND NICHT WEITER ───────────────────────────────────────────────────────────────────────
// Ein fremder Name und ein GESTRICHENES Segment bleiben unberuehrt -- beide waeren ein stiller
// Uebergriff, und beim gestrichenen saehe ihn niemand.
assert($nachher[AVESMAPS_WEG_TEST_IDS['path-fremd']]['merker'] === false, 'der Verbund greift ueber den Namen hinaus');
assert($nachher[AVESMAPS_WEG_TEST_IDS['path-alt']]['merker'] === false, 'der Verbund greift auf gestrichene Segmente');
assert(
    $nachher[AVESMAPS_WEG_TEST_IDS['path-fremd']]['revision'] === $vorher[AVESMAPS_WEG_TEST_IDS['path-fremd']]['revision'],
    'ein fremder Weg bekommt eine neue Revision -- jeder warme Client laedt ihn dann neu'
);

// ── 3) DAS ABWAEHLEN REICHT GENAUSO WEIT ──────────────────────────────────────────────────────
// 💣 Sonst liesse sich der Merker setzen, aber nur zu einem Drittel wieder loswerden -- genau die
// Halbheit, gegen die die Reichweite ueberhaupt gebaut wurde.
avesmapsUpdatePathFeatureDetails($pdo, $rumpf(false), $user);
$geloescht = $karte($pdo);
foreach ([AVESMAPS_WEG_TEST_IDS['path-1'], AVESMAPS_WEG_TEST_IDS['path-2'], AVESMAPS_WEG_TEST_IDS['path-3']] as $id) {
    assert($geloescht[$id]['merker'] === false, "\"$id\" behaelt den Merker nach dem Abwaehlen");
}

// ── 4) OHNE DEN SCHLUESSEL WIRD NICHTS ANGEFASST ──────────────────────────────────────────────
// ⚠️ Und zwar auch keine REVISION. Ein Speichern ohne Entscheidung, das jedem Segment eine neue
// Revision gibt, schickt jedem warmen Client die halbe Karte neu -- dieselbe Regel wie in
// avesmapsApplyTransportSeasonsToWikiSiblings.
$seed($pdo);
avesmapsUpdatePathFeatureDetails($pdo, $rumpf(true), $user);
$standA = $karte($pdo);
avesmapsUpdatePathFeatureDetails($pdo, $rumpf(null), $user);
$standB = $karte($pdo);
foreach ([AVESMAPS_WEG_TEST_IDS['path-2'], AVESMAPS_WEG_TEST_IDS['path-3']] as $id) {
    assert($standB[$id]['merker'] === true, "\"$id\" verliert den Merker bei einem Speichern ohne Entscheidung");
    assert(
        $standB[$id]['revision'] === $standA[$id]['revision'],
        "\"$id\" bekommt eine neue Revision, obwohl sich an ihm nichts geaendert hat"
    );
}

// ── 4b) UND DIE VERBUND-ABFRAGE WIRD GAR NICHT ERST GESTELLT ──────────────────────────────────
// 🪤 DIESE ZUSICHERUNG FEHLTE, und die Mutation hat es gezeigt: nimmt man den `array_key_exists`-
// Riegel heraus, laeuft die Abfrage bei JEDEM Speichern eines Weges -- und schreibt trotzdem nichts,
// weil der Rechner einen abwesenden Schluessel in Ruhe laesst. An den gespeicherten Werten ist das
// NICHT zu sehen; Abschnitt 4 blieb gruen. Es ist ein KOSTEN-Riegel, und Kosten misst man, indem man
// zaehlt (STRATO, AGENTS.md §10).
$pdo->verbundAbfragen = 0;
avesmapsUpdatePathFeatureDetails($pdo, $rumpf(null), $user);
assert(
    $pdo->verbundAbfragen === 0,
    'ein Speichern OHNE Entscheidung stellt die Verbund-Abfrage trotzdem (' . $pdo->verbundAbfragen
    . ' Mal) -- das waere eine Abfrage ueber alle gleichnamigen Segmente bei JEDEM Speichern eines Weges'
);
// Gegenprobe, dass der Zaehler ueberhaupt zaehlt: MIT Entscheidung wird sie genau einmal gestellt.
// ⚠️ Mit DEMSELBEN Wert, der schon steht -- sonst veraendert die Gegenprobe den Stand, auf dem die
// naechsten Abschnitte messen.
$pdo->verbundAbfragen = 0;
avesmapsUpdatePathFeatureDetails($pdo, $rumpf(true), $user);
assert(
    $pdo->verbundAbfragen === 1,
    'die Verbund-Abfrage wird bei einer Entscheidung nicht genau einmal gestellt: ' . $pdo->verbundAbfragen
);

// ── 5) UND EIN ZWEITES MAL DASSELBE HAEKCHEN HEBT KEINE REVISION ──────────────────────────────
$standC = $karte($pdo);
avesmapsUpdatePathFeatureDetails($pdo, $rumpf(true), $user);
$standD = $karte($pdo);
foreach ([AVESMAPS_WEG_TEST_IDS['path-2'], AVESMAPS_WEG_TEST_IDS['path-3']] as $id) {
    assert(
        $standD[$id]['revision'] === $standC[$id]['revision'],
        "\"$id\" wird neu geschrieben, obwohl der Merker schon so stand"
    );
}

// ── 6) DER FALL VERSCHWINDET AUS DEM KONFLIKTZENTRUM -- GANZ, NICHT ZUR HAELFTE ───────────────
// 🔴 Das ist die Probe zu HOCH 2: der Hinweistext verspricht „nimmt ihn aus der Konfliktliste".
// Vor der Reichweite blieb der Fall als „2 von 3 Segmenten" stehen -- der Satz war eine Luege, und
// zwar eine, die der Editor erst im Zentrum bemerkt haette.
$konfliktZeilen = static function (PDO $pdo): array {
    $rows = $pdo->query(
        "SELECT public_id, name, feature_type, feature_subtype, properties_json, geometry_json
           FROM map_features WHERE is_active = 1"
    )->fetchAll(PDO::FETCH_ASSOC);
    $gebaut = [];
    foreach ($rows as $row) {
        $zeile = avesmapsConflictBuildMapRow($row);
        if ($zeile !== null) {
            $gebaut[] = $zeile;
        }
    }

    return avesmapsConflictCollapseSegmentsByName(avesmapsConflictRuleMissingKey($gebaut));
};

$seed($pdo);
// ⚠️ Die flache Adresse von path-2 muss fuer diese Probe weg: eine Zeile MIT Anspruch faellt gar
// nicht unter „kein Wiki-Schluessel", und der Fall haette dann von vornherein nur zwei Segmente.
$pdo->prepare('UPDATE map_features SET properties_json = :pj WHERE public_id = :p')
    ->execute(['pj' => '{"name":"Aguera"}', 'p' => AVESMAPS_WEG_TEST_IDS['path-2']]);
$vorZentrum = $konfliktZeilen($pdo);
$aguera = array_values(array_filter($vorZentrum, static fn (array $f): bool => $f['title'] === 'Aguera'));
assert(count($aguera) === 1, 'die drei Segmente stehen im Zentrum nicht als EINE Zeile: ' . count($aguera));
assert(
    ($aguera[0]['segments'] ?? 0) === 3,
    'die zusammengefasste Zeile zaehlt nicht drei Segmente: ' . var_export($aguera[0]['segments'] ?? null, true)
);

avesmapsUpdatePathFeatureDetails($pdo, $rumpf(true), $user);
$nachZentrum = $konfliktZeilen($pdo);
$agueraDanach = array_values(array_filter($nachZentrum, static fn (array $f): bool => $f['title'] === 'Aguera'));
assert(
    $agueraDanach === [],
    'der Fall steht nach dem Haekchen weiter im Zentrum (' . (($agueraDanach[0]['segments'] ?? 0)) . ' Segmente) -- '
    . 'der Hinweistext „nimmt ihn aus der Konfliktliste" waere eine Luege'
);
// Gegenprobe, dass das Zentrum ueberhaupt noch etwas meldet: der fremde Weg steht weiter da.
assert(
    array_filter($nachZentrum, static fn (array $f): bool => $f['title'] === 'Rakula') !== [],
    'auch der fremde Weg ist verschwunden -- die Probe misst nichts mehr'
);

// ── 7) JEDE GESCHRIEBENE ZEILE HAT IHREN PROTOKOLLEINTRAG ─────────────────────────────────────
// ⚠️ Ohne ihn waere ein Verbund-Schreiben im Aenderungsverlauf unsichtbar: der Editor saehe eine
// Zeile („Weg geändert") und wuesste nicht, dass drei Segmente betroffen sind.
$seed($pdo);
$pdo->exec('DELETE FROM map_audit_log');
avesmapsUpdatePathFeatureDetails($pdo, $rumpf(true), $user);
$protokoll = $pdo->query("SELECT feature_id FROM map_audit_log WHERE action = 'update_path_details'")->fetchAll(PDO::FETCH_COLUMN);
assert(
    count($protokoll) === 3,
    'nicht jede geschriebene Zeile hat einen Protokolleintrag: ' . count($protokoll) . ' statt 3'
);

// ── 8) DIE REICHWEITE IST DIE GETEILTE, KEINE ZWEITE ──────────────────────────────────────────
// 🔴 Der Schreibweg fragt avesmapsConflictRepairSpansNameGroup -- dieselbe Weiche, die alle
// Reparatur-Verben des Konfliktzentrums fragen. Ein `false` dort muss AUCH hier eng ziehen, sonst
// gibt es zwei Stellen, an denen die Reichweite haengt.
assert(avesmapsConflictRepairSpansNameGroup('path', 'Aguera') === true);
assert(avesmapsConflictRepairSpansNameGroup('path', '') === false, 'ein namenloser Weg bekaeme einen Verbund');
assert(avesmapsConflictRepairSpansNameGroup('location', 'Havena') === false, 'ein ORT ist nicht segmentiert');
$quelleSchreibweg = file_get_contents(__DIR__ . '/../features.php');
assert(is_string($quelleSchreibweg));
assert(
    preg_match('/function avesmapsApplyPathWikiNoArticleToNameGroup\(.*?\n\}/s', $quelleSchreibweg, $rumpfGruppe) === 1,
    'avesmapsApplyPathWikiNoArticleToNameGroup laesst sich isolieren'
);
assert(
    str_contains($rumpfGruppe[0], 'avesmapsConflictRepairSpansNameGroup('),
    'die Reichweite wird hier zum zweiten Mal formuliert, statt die geteilte Weiche zu fragen'
);
assert(
    str_contains($rumpfGruppe[0], 'avesmapsApplyPathWikiNoArticle('),
    'ein Geschwister wird an dem gemeinsamen Rechner vorbei geschrieben -- das Leeren der flachen '
    . 'Adresse fiele dort weg'
);

fwrite(STDOUT, "weg-merker-reichweite-test: alle Zusicherungen erfuellt\n");
