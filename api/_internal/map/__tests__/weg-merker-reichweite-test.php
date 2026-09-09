<?php

declare(strict_types=1);

/**
 * Die REICHWEITE eines Weg-Schreibvorgangs, an einer echten Datenbank -- wie viele Segmente EIN
 * Speichern anfasst, und welche es nicht anfassen darf. Lauf (aus dem Repo-Wurzelverzeichnis):
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
 * 🔴 UND AM 09.09.2026 IST DER GEGENSTAND WEGGEFALLEN: `properties.wiki_no_article` ist global
 * ausgebaut (Owner-Entscheid nach Durchsicht aller 10 Traeger), sein Aequivalent ist die
 * WIKI-ZUWEISUNG. Damit hat `avesmapsUpdatePathFeatureDetails` keinen Verbund-Schreiber mehr: ein
 * Speichern fasst GENAU EIN Wegstueck an. Die Zusicherungen unten messen seither das -- und sie
 * sind damit die Gegenprobe zum Ausbau, nicht sein Rest: ein wiederkehrender Verbund-Schreiber
 * faellt hier sofort auf.
 * ⚠️ Die Reichweite des KONFLIKTZENTRUMS ist unberuehrt. `avesmapsConflictRepairSpansNameGroup`
 * traegt sie weiter, und 》Trennen《 fasst weiter die ganze Linie (conflict-repair-reach-test.php).
 * Was gefallen ist, ist der zweite Knopf daneben -- also genau der Widerspruch, gegen den dieser
 * Test einmal gebaut wurde. Er ist nicht behoben worden, sondern hat sich aufgeloest.
 *
 * 🔴 WARUM DIE DATEI TROTZDEM STEHT, waehrend drei ihrer Geschwister mit dem Merker gefallen sind:
 * sie ist die einzige Abdeckung, die `avesmapsUpdatePathFeatureDetails` GEZIELT faehrt und seine
 * Wirkung an der Karte misst. Wer sie mit ihrem Gegenstand weggeworfen haette, haette den
 * Weg-Schreibweg ohne eigene Probe zurueckgelassen.
 * 🪤 HIER STAND „die EINZIGE ausfuehrende Abdeckung … die zwei anderen Nenner im api/-Baum lesen
 * nur Quelltext". Das ist FALSCH und wurde am 09.09.2026 von einem Pruefagenten widerlegt:
 * `api/_internal/import/__tests__/garetien-uebernahme-test.php` faehrt `avesmapsGaretienApplyStep`,
 * und das ruft den Schreibweg wirklich auf (garetien-uebernahme.php). Nur `weg-feld-herkunft-test.php`
 * liest bloss Quelltext. Die Entscheidung, diese Datei zu behalten, bleibt richtig -- die
 * Begruendung war es nicht, und eine falsche Begruendung im Kopf einer Datei ueberlebt jeden
 * Testlauf.
 *
 * ⚠️ ABLAUF, NICHT BAUER: gefahren wird `avesmapsUpdatePathFeatureDetails` selbst, an einer echten
 * (SQLite-)Karte. Eine Probe an einem reinen Rechner allein saehe nicht, ob der Schreibweg ihn
 * ueberhaupt erreicht -- und schon gar nicht, mit WELCHEM Namen. Hausform:
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
// 🔴 SEIT DEM 09.09.2026 AUSDRUECKLICH: `features.php` band `conflicts/repair.php` frueher selbst
// ein -- fuer den Verbund-Schreiber des Merkers. Der ist mit ihm gefallen, die Einbindung damit
// auch, und Abschnitt 8 stand ohne sie vor einer undefinierten Funktion. Hier gehoert sie hin:
// dieser Test misst die geteilte Reichweiten-Weiche, also holt er sie sich.
require __DIR__ . '/../../conflicts/repair.php';

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
     * ⭐ Wie oft die VERBUND-Abfrage gestellt wurde -- die Abfrage ueber ALLE gleichnamigen
     * Wegstuecke. Sie war der einzige Weg, den Kosten-Riegel des Merkers („nur wenn der Rumpf ihn
     * mitbringt") ueberhaupt zu messen: ohne ihn lief sie bei jedem Speichern und schrieb trotzdem
     * nichts -- an den gespeicherten Werten war das nicht zu sehen, und die Mutation lief zuerst
     * gruen durch. Hausform: der Spion-Test des Kreuzungs-Pruefhakens (AGENTS.md §11).
     * 🔴 SEIT DEM AUSBAU DES MERKERS (09.09.2026) MUSS SIE NULL SEIN. Der Zaehler bleibt genau
     * deshalb stehen: er ist die einzige Stelle, an der ein zurueckkehrender Verbund-Schreiber
     * auffiele, BEVOR er Daten anfasst -- an den gespeicherten Werten saehe man ihn erst, wenn er
     * schon geschrieben hat.
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

// ── 1) EIN SPEICHERN FASST GENAU EIN WEGSTUECK AN ─────────────────────────────────────────────
// 🔴 UMGEDREHT AM 09.09.2026, und diese Umkehrung IST der Ausbau. Hier stand „das Haekchen gilt fuer
// den ganzen Namensverbund -- vorher 1 Zeile, jetzt alle drei aktiven 》Aguera《". Mit dem Merker ist
// der einzige Verbund-Schreiber dieses Schreibwegs gefallen; ein Speichern schreibt wieder EINE
// Zeile.
// 💣 DAS IST KEIN RUECKSCHRITT ZUM ZUSTAND VON VOR DEM 15.08.2026, und der Unterschied ist genau
// der Punkt: damals reichte das HAEKCHEN eng, waehrend 》Zuweisen《 im selben Kasten alle
// gleichnamigen fasste -- zwei Knoepfe an einem Fall mit verschiedener Reichweite. Heute gibt es
// den zweiten Knopf nicht mehr. Die Reichweite des Konfliktzentrums ist unveraendert weit
// (conflict-repair-reach-test.php); der Widerspruch ist verschwunden, nicht die Regel.
// ⚠️ WAS DIESER ABSCHNITT ALLEIN NICHT FAENGT: einen Verbund-Schreiber, der -- wie der alte -- nur
// bei VORHANDENEM Schluessel feuert. Er faehrt mit `$rumpf(null)` und war deshalb auch gegen HEAD
// gruen (nachgemessen 09.09.2026). Diese Luecke schliesst Abschnitt 3, der beide alten Rumpfformen
// durchprobiert und die Revisionen der Geschwister mitmisst. Ein „also" zwischen Abschnitt 1 und
// „ein Rueckbau faellt hier auf" waere ein Fehlschluss.
$seed($pdo);
$vorher = $karte($pdo);
avesmapsUpdatePathFeatureDetails($pdo, $rumpf(null), $user);
$nachher = $karte($pdo);
// ⚠️ Das bearbeitete Wegstueck wurde wirklich geschrieben -- ohne diese Zeile beweist der Rest der
// Datei nur, dass ein Aufruf ohne Wirkung nichts kaputtmacht.
// 🪤 GEPRUEFT WIRD 》ANDERS《, NICHT 》GROESSER《: `revision` ist der GLOBALE Kartenstempel aus
// `map_revision`, keine Erhoehung je Zeile. Der Seed setzt 7 von Hand, `map_revision` ist danach
// leer, und der erste Schreibvorgang vergibt darum die 2 -- eine `>`-Probe waere hier rot, ohne
// dass irgendetwas falsch ist. Gemessen, nicht angenommen.
assert(
    $nachher[AVESMAPS_WEG_TEST_IDS['path-1']]['revision'] !== $vorher[AVESMAPS_WEG_TEST_IDS['path-1']]['revision'],
    'das bearbeitete Wegstueck wurde gar nicht geschrieben -- die Probe misst nichts'
);
foreach ([AVESMAPS_WEG_TEST_IDS['path-2'], AVESMAPS_WEG_TEST_IDS['path-3']] as $id) {
    assert(
        $nachher[$id]['revision'] === $vorher[$id]['revision'],
        "\"$id\" wurde mitgeschrieben -- der Schreibweg hat wieder einen Verbund-Schreiber, und jeder "
        . 'warme Client laedt die gleichnamigen Segmente dann bei jedem fremden Speichern neu'
    );
}
// 💣 Und die flache Adresse des Geschwisters steht unberuehrt. Sie fiel frueher MIT dem Haekchen,
// weil das Geschwister sonst im verbotenen Zustand („Adresse UND kein Artikel") gestanden haette.
// Den Zustand gibt es nicht mehr -- also darf ein fremdes Speichern die Adresse auch nicht anfassen.
assert(
    $nachher[AVESMAPS_WEG_TEST_IDS['path-2']]['wiki_url'] === 'https://de.wiki-aventurica.de/wiki/Aguera',
    'das Speichern eines Geschwisters leert die gespeicherte Adresse -- das war die Folge des Merkers '
    . 'und ist mit ihm gefallen'
);

// ── 2) UND NICHT WEITER ───────────────────────────────────────────────────────────────────────
// Ein fremder Name und ein GESTRICHENES Segment bleiben unberuehrt -- beide waeren ein stiller
// Uebergriff, und beim gestrichenen saehe ihn niemand.
foreach ([AVESMAPS_WEG_TEST_IDS['path-fremd'], AVESMAPS_WEG_TEST_IDS['path-alt']] as $id) {
    assert(
        $nachher[$id]['revision'] === $vorher[$id]['revision'],
        "\"$id\" bekommt eine neue Revision -- jeder warme Client laedt ihn dann neu"
    );
}

// ── 3) RUECKBAU-WAECHTER: EIN RUMPF MIT DEM GEFALLENEN SCHLUESSEL AENDERT NICHTS ──────────────
// 🔴 Hier stand „das Abwaehlen reicht genauso weit" -- sonst liesse sich der Merker setzen, aber nur
// zu einem Drittel wieder loswerden. Beide Richtungen sind gefallen; was bleibt, ist die Frage, was
// eine ALTE, gecachte Editorseite anrichtet, die den Schluessel noch mitschickt (AGENTS.md §7 --
// eine gecachte index.html ueberlebt einen Deploy). Antwort: nichts, in beide Richtungen.
foreach ([true, false] as $alterWert) {
    $seed($pdo);
    $davor = $karte($pdo);
    avesmapsUpdatePathFeatureDetails($pdo, $rumpf($alterWert), $user);
    $danach = $karte($pdo);
    foreach (array_keys($danach) as $id) {
        assert(
            $danach[$id]['merker'] === false,
            "ein alter Rumpf mit wiki_no_article=" . var_export($alterWert, true) . " legt den Merker "
            . "auf \"$id\" wieder an -- er ist am 09.09.2026 global ausgebaut"
        );
    }
    foreach ([AVESMAPS_WEG_TEST_IDS['path-2'], AVESMAPS_WEG_TEST_IDS['path-3']] as $id) {
        assert($danach[$id]['revision'] === $davor[$id]['revision'],
            "ein alter Rumpf schreibt \"$id\" mit");
    }
}

// ── 4) EIN ALTBESTAND-MERKER UEBERLEBT DEN SCHREIBVORGANG ─────────────────────────────────────
// 🔴 Der Schreibweg raeumt ihn NICHT weg. Das Aufraeumen gehoert der einmaligen Bestandsreparatur
// (Schritt 4 des Ausbaus, Admin-Aktion mit Trockenlauf-Vorgabe): ein Schreibpfad, der nebenbei ein
// fremdes Feld wegraeumt, veraendert die Bestandszahl bei jedem Klick, waehrend die Reparatur sie
// messen soll -- und er waere eine zweite, verstreute Reparatur neben der einen.
// ⚠️ Und er darf dabei auch keine REVISION heben. Ein Speichern, das jedem Segment eine neue gibt,
// schickt jedem warmen Client die halbe Karte neu (dieselbe Regel wie in
// avesmapsApplyTransportSeasonsToWikiSiblings).
$seed($pdo);
$pdo->prepare('UPDATE map_features SET properties_json = :pj WHERE public_id = :p')->execute([
    'pj' => '{"name":"Aguera","wiki_no_article":true}',
    'p' => AVESMAPS_WEG_TEST_IDS['path-1'],
]);
$standA = $karte($pdo);
assert($standA[AVESMAPS_WEG_TEST_IDS['path-1']]['merker'] === true, 'Vorbedingung: der Altbestand-Merker liegt da');
avesmapsUpdatePathFeatureDetails($pdo, $rumpf(null), $user);
$standB = $karte($pdo);
assert(
    $standB[AVESMAPS_WEG_TEST_IDS['path-1']]['merker'] === true,
    'der Schreibweg raeumt den Altbestand-Merker weg -- das gehoert der Bestandsreparatur'
);
foreach ([AVESMAPS_WEG_TEST_IDS['path-2'], AVESMAPS_WEG_TEST_IDS['path-3']] as $id) {
    assert(
        $standB[$id]['revision'] === $standA[$id]['revision'],
        "\"$id\" bekommt eine neue Revision, obwohl sich an ihm nichts geaendert hat"
    );
}

// ── 4b) UND DIE VERBUND-ABFRAGE WIRD GAR NICHT MEHR GESTELLT ─────────────────────────────────
// 🪤 DIESE ZUSICHERUNG FEHLTE EINMAL, und die Mutation hat es gezeigt: nahm man den
// `array_key_exists`-Riegel des Merkers heraus, lief die Abfrage bei JEDEM Speichern eines Weges --
// und schrieb trotzdem nichts, weil der Rechner einen abwesenden Schluessel in Ruhe liess. An den
// gespeicherten Werten war das NICHT zu sehen; Abschnitt 4 blieb gruen. Es war ein KOSTEN-Riegel,
// und Kosten misst man, indem man zaehlt (STRATO, AGENTS.md §10).
// 🔴 SEIT DEM AUSBAU MUSS DIE ZAHL BEI JEDEM RUMPF NULL SEIN -- mit Schluessel wie ohne. Das ist die
// frueheste Stelle, an der ein zurueckkehrender Verbund-Schreiber auffiele: an den gespeicherten
// Werten saehe man ihn erst, wenn er schon geschrieben hat.
foreach ([null, true, false] as $variante) {
    $pdo->verbundAbfragen = 0;
    avesmapsUpdatePathFeatureDetails($pdo, $rumpf($variante), $user);
    assert(
        $pdo->verbundAbfragen === 0,
        'ein Speichern (Rumpf: ' . var_export($variante, true) . ') stellt die Verbund-Abfrage ('
        . $pdo->verbundAbfragen . ' Mal) -- eine Abfrage ueber alle gleichnamigen Segmente bei JEDEM '
        . 'Speichern eines Weges, und ein Schreiber dahinter'
    );
}
// 💣 UND HIER STEHT, WAS DIESER ZAEHLER SEIT DEM AUSBAU NOCH WERT IST -- weniger, als er aussieht.
// Frueher lieferte der Merker selbst die Gegenprobe („mit Entscheidung genau einmal"); seit er weg
// ist, stellt KEIN produktiver Erzeuger die Abfrage mehr, und das Muster des Spions passt auf nichts
// im ganzen api/-Baum (nachgemessen 09.09.2026: HEAD 1 Treffer, jetzt 0).
// 🪤 EINE GEGENPROBE, DIE DEM SPION SEINEN EIGENEN SUCHSTRING SCHICKT, BELEGT NUR, DASS
// `str_contains` FUNKTIONIERT. Genau so stand sie hier einen Tag lang; ein Pruefagent hat es
// gemessen. Sie ist deshalb weg, und stattdessen steht die Reichweite ausgeschrieben:
// ⚠️ Die drei Nullen darueber fangen einen BYTE-GENAUEN Revert der alten Abfrage. Einen
// Verbund-Schreiber mit anderer SQL-Formatierung fangen sie NICHT. Der scharfe Waechter dagegen ist
// Abschnitt 8 (`NameGroup(` im Rumpf des Schreibwegs, am Quelltext) und Abschnitt 3 (die Revisionen
// der Geschwister, an den Daten) -- dieser Zaehler ist die billige dritte Reihe, kein Ersatz.

// ── 5) UND EIN ZWEITES MAL DASSELBE HEBT KEINE REVISION ───────────────────────────────────────
// ⚠️ Nah an Abschnitt 1, aber nicht dasselbe: dort wird EINMAL geschrieben und gemessen, wen es
// nicht trifft; hier wird ZWEIMAL hintereinander derselbe Rumpf geschickt und gemessen, dass der
// zweite Lauf gar nichts mehr tut. Das ist die Revisions-Sparsamkeit des Schreibwegs, und an der
// haengt die ~21 MB grosse Kartennutzlast jedes warmen Besuchers.
$standC = $karte($pdo);
avesmapsUpdatePathFeatureDetails($pdo, $rumpf(null), $user);
$standD = $karte($pdo);
foreach ([AVESMAPS_WEG_TEST_IDS['path-2'], AVESMAPS_WEG_TEST_IDS['path-3']] as $id) {
    assert(
        $standD[$id]['revision'] === $standC[$id]['revision'],
        "\"$id\" wird neu geschrieben, obwohl sich nichts geaendert hat"
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

avesmapsUpdatePathFeatureDetails($pdo, $rumpf(null), $user);
$nachZentrum = $konfliktZeilen($pdo);
$agueraDanach = array_values(array_filter($nachZentrum, static fn (array $f): bool => $f['title'] === 'Aguera'));
// 🔴 UMGEDREHT AM 09.09.2026. Hier stand: „der Fall steht nach dem Haekchen weiter im Zentrum --
// der Hinweistext 》nimmt ihn aus der Konfliktliste《 waere eine Luege." Genau dieser Hinweistext ist
// mit dem Haekchen gefallen: der Merker `properties.wiki_no_article` ist global ausgebaut
// (Owner-Entscheid), sein Aequivalent ist die WIKI-ZUWEISUNG -- und die hat dieser Weg nicht.
// ⚠️ DAS IST DER GEMESSENE PREIS DES AUSBAUS: die Traeger kommen zurueck auf die Beobachtungsliste.
// Der Owner hat alle 10 durchgesehen und es so entschieden -- kein Fehler, nicht zu reparieren.
// 💣 WAS DIESER ABSCHNITT NOCH BELEGT -- und was NICHT. Er belegt genau eines: der Schreibvorgang
// laesst die Liste UNVERAENDERT. Das ist der Riegel gegen ein Wiederauftauchen der Ausnahme in
// `avesmapsConflictRuleMissingKey` -- wer sie zurueckbaut, bekommt hier 0 Zeilen statt 1.
// 🪤 ER BELEGT NICHTS UEBER DIE REICHWEITE. `avesmapsConflictCollapseSegmentsByName` gruppiert nach
// `rule_id|label` und hat den Merker nie gelesen; die drei Segmente stehen als EINE Zeile da, egal
// ob der Schreibvorgang eines oder alle drei angefasst hat. Ein „also" zwischen beidem waere ein
// Fehlschluss. Die Reichweite selbst misst dieser Test weiter oben (Abschnitte davor) und in
// Abschnitt 7 am Protokoll -- dort wird sie an den GESCHRIEBENEN Zeilen gemessen, nicht an der Liste.
assert(
    $nachZentrum == $vorZentrum,
    'der Schreibvorgang hat die Beobachtungsliste veraendert -- die Ausnahme fuer den Merker ist zurueck'
);
assert(
    count($agueraDanach) === 1 && ($agueraDanach[0]['segments'] ?? 0) === 3,
    'die drei Segmente stehen nach dem Schreibvorgang nicht mehr als EINE Zeile mit drei Segmenten da: '
    . var_export(array_map(static fn (array $f): mixed => $f['segments'] ?? null, $agueraDanach), true)
);
// Gegenprobe, dass das Zentrum ueberhaupt noch etwas meldet: der fremde Weg steht weiter da.
assert(
    array_filter($nachZentrum, static fn (array $f): bool => $f['title'] === 'Rakula') !== [],
    'auch der fremde Weg ist verschwunden -- die Probe misst nichts mehr'
);

// ── 7) JEDE GESCHRIEBENE ZEILE HAT IHREN PROTOKOLLEINTRAG -- UND NUR SIE ──────────────────────
// ⚠️ Die Zahl war DREI, solange der Merker den Verbund schrieb: ohne einen Eintrag je Zeile waere
// ein Verbund-Schreiben im Aenderungsverlauf unsichtbar gewesen -- der Editor saehe eine Zeile
// („Weg geändert") und wuesste nicht, dass drei Segmente betroffen sind. Sie ist jetzt EINS, und
// das ist dieselbe Zusicherung von der anderen Seite: geschrieben wird eine Zeile, protokolliert
// wird eine Zeile. Ein Protokolleintrag mehr hiesse ein geschriebenes Segment mehr.
$seed($pdo);
$pdo->exec('DELETE FROM map_audit_log');
avesmapsUpdatePathFeatureDetails($pdo, $rumpf(null), $user);
$protokoll = $pdo->query("SELECT feature_id FROM map_audit_log WHERE action = 'update_path_details'")->fetchAll(PDO::FETCH_COLUMN);
assert(
    count($protokoll) === 1,
    'der Schreibvorgang hat nicht genau eine Zeile protokolliert: ' . count($protokoll) . ' statt 1'
);

// ── 8) DIE GETEILTE REICHWEITEN-WEICHE STEHT UNVERAENDERT ─────────────────────────────────────
// 🔴 `avesmapsConflictRepairSpansNameGroup` ist die EINE Weiche, die alle Reparatur-Verben des
// Konfliktzentrums fragen -- ein Fall ist bei einer segmentierten Art eine LINIE, kein Segment. Sie
// ist vom Ausbau des Merkers UNBERUEHRT; was gefallen ist, ist ihr zweiter Frager, der Weg-
// Schreibweg. Die drei Zeilen bleiben hier stehen, weil sie die Bedingung nennen, unter der ein
// kuenftiger zweiter Frager ueberhaupt richtig waere.
assert(avesmapsConflictRepairSpansNameGroup('path', 'Aguera') === true);
assert(avesmapsConflictRepairSpansNameGroup('path', '') === false, 'ein namenloser Weg bekaeme einen Verbund');
assert(avesmapsConflictRepairSpansNameGroup('location', 'Havena') === false, 'ein ORT ist nicht segmentiert');
// 🔴 UND DER SCHREIBWEG FRAGT SIE NICHT MEHR -- die Gegenprobe zu Abschnitt 1 am Quelltext, damit
// ein Verbund-Schreiber schon beim Lesen des Diffs auffaellt und nicht erst an einer Revision.
// ⚠️ Kommentarfrei ueber den Tokenizer: die Begruendung hier oben nennt den Namen, der im Rumpf
// nicht vorkommen darf (AGENTS.md §11).
$schreibwegCode = '';
foreach (token_get_all((string) file_get_contents(__DIR__ . '/../features.php')) as $stueck) {
    if (is_array($stueck)) {
        if ($stueck[0] === T_COMMENT || $stueck[0] === T_DOC_COMMENT) {
            continue;
        }
        $schreibwegCode .= $stueck[1];
        continue;
    }
    $schreibwegCode .= $stueck;
}
assert(
    preg_match('/function avesmapsUpdatePathFeatureDetails\(.*?\n\}/s', $schreibwegCode, $rumpfSchreibweg) === 1,
    'avesmapsUpdatePathFeatureDetails laesst sich nicht isolieren -- die Zusicherung waere blind'
);
// 💣 GESUCHT WIRD `NameGroup(`, NICHT DER VOLLE NAME DER WEICHE -- und das ist der Unterschied
// zwischen einer Zusicherung und einem Vakuum. Der Schreibweg fragte
// `avesmapsConflictRepairSpansNameGroup` naemlich NIE selbst: er rief
// `avesmapsApplyPathWikiNoArticleToNameGroup(…)`, und ERST DIE fragte die Weiche. Eine Probe auf
// den vollen Namen war deshalb auch gegen HEAD gruen -- gemessen am 09.09.2026, gefunden von einem
// Pruefagenten, nachdem sie hier einen Tag lang als Waechter dastand.
// ⭐ `NameGroup(` faengt beide Formen: den direkten Frager wie den Helfer davor.
assert(
    preg_match('/NameGroup\(/', $rumpfSchreibweg[0]) !== 1,
    'der Weg-Schreibweg reicht wieder ueber den Namensverbund -- dann schreibt ein Speichern erneut '
    . 'alle gleichnamigen Segmente, und Abschnitt 1 misst den Schaden erst hinterher'
);

// ── 9) DIE ANTWORT DES SCHREIBWEGS -- der Bauer, dessen Abdeckung beim Ausbau fast verlorenging ─
// 🔴 `avesmapsBuildLineStringFeatureResponse` hatte seine einzigen direkten Laeufe in
// `weg-wiki-no-article-test.php`. Der ist am 09.09.2026 gefallen (er mass ausschliesslich den
// ausgebauten Merker), und damit stand der Bauer ohne jede Zusicherung da -- nachgemessen: NULL
// Aufrufer in Tests. Gefunden hat das ein Pruefagent, nicht der Autor: gezaehlt worden war nach dem
// MERKER, nicht nach dem BAUER. Das ist die Fehlerklasse „ein geloeschter Block nimmt fremde
// Abdeckung mit", und sie ist hier ein zweites Mal aufgetreten.
// ⚠️ Er wird zwar weiter AUSGEFUEHRT (der Schreibweg oben gibt ihn zurueck), aber sein Ergebnis
// wurde verworfen -- kein Test prueft einen einzigen Schluessel. Deshalb steht er jetzt hier, in
// der Datei, die den Weg-Schreibweg ohnehin faehrt.
$antwortGeometrie = ['type' => 'LineString', 'coordinates' => [[1.0, 2.0], [3.0, 4.0]]];
$antwort = avesmapsBuildLineStringFeatureResponse('pfad-1', 'Aguera', 'Flussweg', $antwortGeometrie, [
    'show_label' => true,
    'wiki_path' => ['wiki_key' => 'aguera', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Aguera'],
], 12);
assert($antwort['type'] === 'Feature' && $antwort['id'] === 'pfad-1', 'die Huelle stimmt nicht');
assert($antwort['geometry'] === $antwortGeometrie, 'die Geometrie reist nicht unveraendert mit');
$eigenschaften = $antwort['properties'];
assert($eigenschaften['public_id'] === 'pfad-1');
assert($eigenschaften['feature_type'] === 'path', 'die Objektart fehlt -- der Kartendialog sortiert danach');
assert($eigenschaften['feature_subtype'] === 'Flussweg');
assert($eigenschaften['revision'] === 12, 'die Revision fehlt -- der Live-Abgleich braucht sie');
// 💣 DER MITGEGEBENE ZUSTAND UEBERLEBT. `applyPathFeatureResponse` MISCHT diese Antwort in die
// vorhandenen Eigenschaften (`{...alt, ...neu}`) -- ein Bauer, der ein uebergebenes Feld
// verschluckt, laesst dort still den alten Wert stehen.
assert($eigenschaften['show_label'] === true, 'ein uebergebenes Feld wird verschluckt');
assert(($eigenschaften['wiki_path']['wiki_key'] ?? '') === 'aguera', 'das Zuweisungsnest reist nicht mit');
// 🔴 UND DER AUSGEBAUTE MERKER REIST NICHT MIT -- auch nicht als `false`. Genau das tat er bis zum
// 09.09.2026 ausdruecklich, weil ein weggelassener Schluessel beim Mischen nichts loescht.
assert(!array_key_exists('wiki_no_article', $eigenschaften), 'die Weg-Antwort traegt den Merker wieder');

fwrite(STDOUT, "weg-merker-reichweite-test: alle Zusicherungen erfuellt\n");
