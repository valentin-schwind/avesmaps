<?php

declare(strict_types=1);

/**
 * STRÖMUNGSRICHTUNG JE ABSCHNITT, AUSGEFÜHRT — Meldung #7996 (Thomas, Großer Fluss – Delta:
 * „Richtung vervollständigen … Main Chain is already fully directed … die einzelnen Abschnitte
 * lassen sich nicht umkehren, nur der gesamte Fluss").
 *
 * Entwurf: docs/superpowers/specs/2026-10-05-flussrichtung-je-abschnitt-design.md
 *
 * 🔴 DIE REGEL, die hier festgenagelt wird: `scope: "segment"` begrenzt `flip` auf den
 * angeklickten Abschnitt, `dir` setzt die Richtung EINES Abschnitts — und beides lässt die
 * übrigen Abschnitte des Wegs BYTE-UNVERÄNDERT. Das ist der ganze Zweck: ein Deltaarm ist
 * geometrisch nicht entscheidbar (Entwurf §2), also muss ein Mensch ihn einzeln richten können,
 * ohne den Fluss umzudrehen.
 *
 * 💣 WARUM DAS AUSGEFÜHRT WERDEN MUSS. Die Zielmenge von `set_flow` ist die WAY-GRUPPE, und sie
 * entsteht aus einer SQL-Abfrage plus `avesmapsWikiPathRowMatchesWay`. Ein Quelltext-Test könnte
 * lesen, dass ein `if ($scope === 'segment')` dasteht — ob die Filterung die Gruppe wirklich
 * verschont, sieht nur, wer hinterher alle Zeilen nachzählt. Genau diese Lücke hat am 19.08.2026
 * den Wege-Editor beim ersten Klick abstürzen lassen (Schreibweg getestet, Leser nie).
 *
 * ⚠️ DREI TESTDOPPEL, und nur, weil ihre Originale MySQL-Syntax bzw. die Karten-DDL tragen:
 * `avesmapsWikiSyncNextMapRevision`, `avesmapsWikiSyncFetchAuditRow`,
 * `avesmapsWikiSyncAuditFeaturePropsChange`. Sie sind in `api/_internal/wiki/sync.php` NICHT
 * enthalten (nachgemessen: `function_exists` sagt nein), also nimmt ihnen hier niemand etwas weg.
 * Die Produktionsform wird dafür NICHT verbogen (AGENTS.md §9, Error 1093). Alles, worüber dieser
 * Test urteilt — `avesmapsWikiPathSetFlow` samt der ganzen Plan-Engine und der echten
 * Gruppenbildung — ist Originalcode.
 *
 * Lauf (Windows), aus dem Repo-Root:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll api/_internal/wiki/__tests__/flussrichtung-je-abschnitt-test.php
 * Exit 0 = alle Zusicherungen erfüllt.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n");
    exit(2);
}
if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: pdo_sqlite is not loaded -- re-run with -d extension=php_pdo_sqlite.dll\n");
    exit(2);
}

// ---- die drei Doppel, VOR dem require (sonst gewinnt niemand) ------------------------------------
function avesmapsWikiSyncNextMapRevision(PDO $pdo): int
{
    $GLOBALS['test_revision'] = ($GLOBALS['test_revision'] ?? 100) + 1;
    return (int) $GLOBALS['test_revision'];
}
function avesmapsWikiSyncFetchAuditRow(PDO $pdo, int $id): array
{
    $s = $pdo->prepare('SELECT id, name, properties_json FROM map_features WHERE id = :id');
    $s->execute(['id' => $id]);
    $row = $s->fetch(PDO::FETCH_ASSOC);
    return is_array($row) ? $row : [];
}
function avesmapsWikiSyncAuditFeaturePropsChange(PDO $pdo, array $before, array $props, int $rev, int $userId, string $name): void
{
    $GLOBALS['test_audit'][] = ['id' => (int) ($before['id'] ?? 0), 'name' => $name, 'rev' => $rev];
}

require_once __DIR__ . '/../sync.php';
require_once __DIR__ . '/../paths.php';
require_once __DIR__ . '/../path-flow.php';

$fehler = 0;
$pruefe = static function (string $was, bool $ok) use (&$fehler): void {
    if ($ok) { echo "ok  $was\n"; return; }
    echo "FEHLER  $was\n";
    $fehler++;
};

/**
 * T-Form, die Thomas' Lage nachbaut: eine Kette A–B–C (gerichtet) und ein Abzweig D
 * (ungerichtet) an der Verzweigung. Die Kette ist LÄNGER als jeder Pfad über D, damit der
 * Diameter-Walk eindeutig A–B–C wählt (sonst wäre die Fixture ambig und der Test launisch).
 */
function baueFluss(): PDO
{
    $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('CREATE TABLE map_features (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        public_id TEXT NOT NULL,
        feature_type TEXT NOT NULL,
        feature_subtype TEXT NOT NULL,
        name TEXT,
        geometry_json TEXT NOT NULL,
        properties_json TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        revision INTEGER NOT NULL DEFAULT 1
    )');
    $ein = $pdo->prepare('INSERT INTO map_features
        (public_id, feature_type, feature_subtype, name, geometry_json, properties_json)
        VALUES (:p, "path", "Flussweg", :n, :g, :pr)');
    $linie = static fn(array $von, array $bis) => json_encode(['type' => 'LineString', 'coordinates' => [$von, $bis]]);
    $flow = static fn(?string $dir) => $dir === null
        ? json_encode(['name' => 'Testfluss'])
        : json_encode(['name' => 'Testfluss', 'flow' => ['dir' => $dir, 'source' => 'verlauf-sync']]);

    // Kette: (0,0) -> (10,0) -> (20,0) -> (30,0)  = Länge 30
    $ein->execute(['p' => 'seg-a', 'n' => 'Testfluss', 'g' => $linie([0, 0], [10, 0]), 'pr' => $flow('forward')]);
    $ein->execute(['p' => 'seg-b', 'n' => 'Testfluss', 'g' => $linie([10, 0], [20, 0]), 'pr' => $flow('forward')]);
    $ein->execute(['p' => 'seg-c', 'n' => 'Testfluss', 'g' => $linie([20, 0], [30, 0]), 'pr' => $flow('forward')]);
    // Abzweig an (20,0), nur 5 lang -> Pfad A-B-D = 25 < 30, die Kette gewinnt eindeutig
    $ein->execute(['p' => 'seg-d', 'n' => 'Testfluss', 'g' => $linie([20, 0], [20, 5]), 'pr' => $flow(null)]);
    // 💣 EIN STUMMEL, und er ist in der Fixture Pflicht: 0,5 lang, also kuerzer als
    // AVESMAPS_PATH_FLOW_ENDPOINT_EPS (1,0). Der Endpunkt-Clusterer zieht seine beiden Enden zu
    // EINEM Knoten (`$keyA === $keyB` -> `continue`), er ist damit aus dem Kantengraph geworfen
    // und von `set_dir` grundsaetzlich nicht erreichbar. Am Grossen Fluss sind 2 von 24 offenen
    // Abschnitten solche Stummel, am Bestand 29 von 58 -- die HAELFTE.
    // ⚠️ Ohne ihn war die Einordnung ungedeckt: zwei Mutationen (Stummel als Abzweigung zaehlen,
    // Reihenfolge der Pruefung umdrehen) liefen gruen durch, weil die Fixture den Unterschied
    // nicht zeigen konnte. Gefunden von der Mutationsprobe, nicht beim Schreiben.
    $ein->execute(['p' => 'seg-e', 'n' => 'Testfluss', 'g' => $linie([30, 0], [30, 0.5]), 'pr' => $flow(null)]);
    return $pdo;
}

/** Liest den Richtungsstand aller vier Abschnitte: public_id => dir|null. */
function richtungen(PDO $pdo): array
{
    $out = [];
    foreach ($pdo->query('SELECT public_id, properties_json FROM map_features ORDER BY public_id') as $r) {
        $p = json_decode((string) $r['properties_json'], true);
        $out[(string) $r['public_id']] = $p['flow']['dir'] ?? null;
    }
    return $out;
}

echo "=== A · Der Befund: Hauptkette fertig, Abzweig offen ===\n";
$pdo = baueFluss();
$vorher = richtungen($pdo);
$pruefe('Fixture: drei gerichtet, ein Abzweig und ein Stummel offen',
    $vorher === ['seg-a' => 'forward', 'seg-b' => 'forward', 'seg-c' => 'forward',
                 'seg-d' => null, 'seg-e' => null]);

// 🔴 Heute wirft das. Nach dem Umbau ist "es gibt nichts zu tun" KEIN Fehler mehr.
$geworfen = null;
$antwort = null;
try {
    $antwort = avesmapsWikiPathSetFlow($pdo, 'seg-a', ['set_dir' => true], true, 7);
} catch (Throwable $e) {
    $geworfen = $e->getMessage();
}
$pruefe('set_dir bei fertiger Kette wirft NICHT mehr (war: "Main chain is already fully directed")',
    $geworfen === null);
$pruefe('… und antwortet ok:true', is_array($antwort) && ($antwort['ok'] ?? false) === true);
$pruefe('… directed = 0', is_array($antwort) && (int) ($antwort['directed'] ?? -1) === 0);
$pruefe('… nennt die Zahl der offenen Abzweigungen (1)',
    is_array($antwort) && (int) ($antwort['undirected_spurs'] ?? -1) === 1);
$pruefe('… nennt die Zahl der zu kurzen Stummel (1)',
    is_array($antwort) && (int) ($antwort['undirected_stubs'] ?? -1) === 1);
// 💣 Abzweig und Stummel werden GETRENNT gezaehlt und nicht verrechnet: der Abzweig braucht eine
// Entscheidung, der Stummel ist strukturell unerreichbar -- zwei verschiedene Auskuenfte.
$pruefe('… und zaehlt ihn NICHT als Abzweigung',
    is_array($antwort) && (int) ($antwort['undirected_spurs'] ?? -1) === 1);
$pruefe('… auf der Hauptkette ist keiner offen',
    is_array($antwort) && (int) ($antwort['undirected_on_chain'] ?? -1) === 0);

echo "\n=== B · dir: EIN Abschnitt bekommt eine Richtung ===\n";
$pdo = baueFluss();
$antwort = avesmapsWikiPathSetFlow($pdo, 'seg-d', ['dir' => 'forward'], false, 7);
$nachher = richtungen($pdo);
$pruefe('der Abzweig ist jetzt gerichtet', $nachher['seg-d'] === 'forward');
$pruefe('💣 die drei anderen sind UNVERÄNDERT',
    $nachher['seg-a'] === 'forward' && $nachher['seg-b'] === 'forward' && $nachher['seg-c'] === 'forward');
$pruefe('genau EIN Write', is_array($antwort) && (int) ($antwort['writes'] ?? -1) === 1);
$pruefe('Zusammenfassung: directed = 1', is_array($antwort) && (int) ($antwort['directed'] ?? -1) === 1);
// 💣 DIE ZAHLEN BESCHREIBEN DEN STAND DANACH. Aus dem alten Stand gerechnet stuende neben dem
// Erfolg weiterhin „1 Abzweigung braucht eine Entscheidung" -- ein Widerspruch in derselben Zeile.
$pruefe('💣 die Abzweigung ist aus der Auskunft VERSCHWUNDEN (Stand NACH der Aktion)',
    is_array($antwort) && (int) ($antwort['undirected_spurs'] ?? -1) === 0);
$pruefe('… der Stummel steht weiter drin (ihn erreicht niemand)',
    is_array($antwort) && (int) ($antwort['undirected_stubs'] ?? -1) === 1);
$pruefe('source ist "editor" (Handgriff, nicht Sync)', (static function (PDO $pdo): bool {
    $s = $pdo->query('SELECT properties_json FROM map_features WHERE public_id = "seg-d"');
    $p = json_decode((string) $s->fetchColumn(), true);
    return ($p['flow']['source'] ?? '') === 'editor';
})($pdo));

echo "\n=== C · dir: reverse auf einem schon gerichteten Abschnitt ===\n";
$pdo = baueFluss();
avesmapsWikiPathSetFlow($pdo, 'seg-b', ['dir' => 'reverse'], false, 7);
$nachher = richtungen($pdo);
$pruefe('seg-b ist umgedreht', $nachher['seg-b'] === 'reverse');
$pruefe('💣 seg-a und seg-c unberührt', $nachher['seg-a'] === 'forward' && $nachher['seg-c'] === 'forward');

echo "\n=== D · scope=segment: flip dreht NUR diesen Abschnitt ===\n";
$pdo = baueFluss();
$antwort = avesmapsWikiPathSetFlow($pdo, 'seg-b', ['flip' => true, 'scope' => 'segment'], false, 7);
$nachher = richtungen($pdo);
$pruefe('seg-b gedreht', $nachher['seg-b'] === 'reverse');
$pruefe('💣 seg-a und seg-c NICHT gedreht (das ist Thomas\' Wunsch)',
    $nachher['seg-a'] === 'forward' && $nachher['seg-c'] === 'forward');
$pruefe('flipped = 1', is_array($antwort) && (int) ($antwort['flipped'] ?? -1) === 1);

echo "\n=== E · Gegenprobe: ohne scope bleibt flip WAY-WEIT ===\n";
$pdo = baueFluss();
$antwort = avesmapsWikiPathSetFlow($pdo, 'seg-b', ['flip' => true], false, 7);
$nachher = richtungen($pdo);
$pruefe('alle drei gerichteten sind gedreht',
    $nachher['seg-a'] === 'reverse' && $nachher['seg-b'] === 'reverse' && $nachher['seg-c'] === 'reverse');
$pruefe('der dirlose Abzweig bleibt dirlos (flip erfindet keine Richtung)', $nachher['seg-d'] === null);
$pruefe('flipped = 3', is_array($antwort) && (int) ($antwort['flipped'] ?? -1) === 3);

echo "\n=== F · scope=segment auf einem dirlosen Abschnitt sagt es KLAR ===\n";
$pdo = baueFluss();
$geworfen = null;
try {
    avesmapsWikiPathSetFlow($pdo, 'seg-d', ['flip' => true, 'scope' => 'segment'], false, 7);
} catch (Throwable $e) {
    $geworfen = $e->getMessage();
}
// ⚠️ flip erfindet nie eine Richtung. Ein Einzel-flip auf einem dirlosen Abschnitt liefe sonst
// leer durch und sähe für den Editor wie ein verschluckter Klick aus.
$pruefe('wirft eine verständliche Absage statt leer zu laufen',
    $geworfen !== null && stripos($geworfen, 'keine Richtung') !== false);
$pruefe('und hat nichts geschrieben', richtungen($pdo)['seg-d'] === null);

echo "\n=== G · Die Ausschlüsse am Eingang ===\n";
$pdo = baueFluss();
foreach ([
    ['dir + set_dir',          ['dir' => 'forward', 'set_dir' => true]],
    ['dir + flip',             ['dir' => 'forward', 'flip' => true]],
    ['unbekannter dir-Wert',   ['dir' => 'seitlich']],
    ['unbekannter scope-Wert', ['flip' => true, 'scope' => 'quatsch']],
    ['scope ohne Wunsch',      ['scope' => 'segment']],
] as [$was, $opt]) {
    $geworfen = null;
    try {
        avesmapsWikiPathSetFlow($pdo, 'seg-a', $opt, true, 7);
    } catch (Throwable $e) {
        $geworfen = $e->getMessage();
    }
    $pruefe("$was wird abgewiesen", $geworfen !== null);
}
$pruefe('💣 nach allen Absagen ist der Fluss unverändert',
    richtungen($pdo) === ['seg-a' => 'forward', 'seg-b' => 'forward', 'seg-c' => 'forward',
                          'seg-d' => null, 'seg-e' => null]);

echo "\n=== H · scope gilt NUR für flip, nicht für den Faktor ===\n";
// 🔴 Der Strömungsfaktor ist per Owner-Design way-weit (Ursprungsentwurf §6). Ein `scope` an ihm
// wäre eine Regel mit zwei Bedeutungen -- er muss alle vier Abschnitte treffen, auch mit scope.
$pdo = baueFluss();
avesmapsWikiPathSetFlow($pdo, 'seg-b', ['flip' => true, 'scope' => 'segment', 'factor' => 2.5], false, 7);
$faktoren = [];
foreach ($pdo->query('SELECT public_id, properties_json FROM map_features ORDER BY public_id') as $r) {
    $p = json_decode((string) $r['properties_json'], true);
    $faktoren[(string) $r['public_id']] = $p['flow']['factor'] ?? null;
}
$pruefe('der Faktor steht auf ALLEN fuenf Abschnitten', count(array_filter($faktoren, static fn($f) => (float) $f === 2.5)) === 5);
$pruefe('… während der flip nur seg-b gedreht hat', richtungen($pdo)['seg-a'] === 'forward');

echo "\n=== I - Der Endpunkt reicht scope und dir wirklich durch ===\n";
// BOMBE: ZWEI MUTATIONEN SIND HIER ENTWISCHT, bis dieser Abschnitt da war -- "scope kommt nicht
// an" und "dir kommt nicht an" liessen sich im Endpunkt auf `null` festnageln, und ALLE Tests
// blieben gruen: die Bibliothek war gedeckt, die LEITUNG dorthin nicht. Dieselbe Luecke wie am
// 19.08.2026 im Wege-Editor (Schreibweg getestet, Leser nie).
// ROT: Geschnitten wird per TOKENIZER, nicht per Regex. Der Argumentblock traegt Kommentare, und
// in denen stehen Klammern -- ein Klammernzaehler ueber den Rohtext zaehlt sie mit. Genau daran
// ist am 02.09.2026 ein Verdrahtungstest umgefallen (380 Zeilen echten Code gefressen).
$endpunktQuelle = file_get_contents(__DIR__ . '/../../../edit/wiki/paths.php');
$pruefe('der Endpunkt ist lesbar', is_string($endpunktQuelle) && $endpunktQuelle !== '');
$tokens = token_get_all((string) $endpunktQuelle);
$optionsQuelle = null;
$anzahl = count($tokens);
for ($i = 0; $i < $anzahl && $optionsQuelle === null; $i++) {
    $t = $tokens[$i];
    if (!is_array($t) || $t[0] !== T_STRING || $t[1] !== 'avesmapsWikiPathSetFlow') {
        continue;
    }
    $start = null;
    $tiefe = 0;
    $stueck = '';
    $letztesEcht = '';
    for ($j = $i; $j < $anzahl; $j++) {
        $istArray = is_array($tokens[$j]);
        $tx = $istArray ? $tokens[$j][1] : $tokens[$j];
        $istKommentar = $istArray && in_array($tokens[$j][0], [T_COMMENT, T_DOC_COMMENT], true);
        if ($start === null) {
            // Nur ein Array-LITERAL nehmen, keinen Array-ZUGRIFF. Das erste '[' hinter dem
            // Funktionsnamen gehoert zu `$payload['public_id']` -- ein Literal steht dagegen
            // immer am Anfang eines Arguments, also direkt hinter '(' oder ','.
            if ($tx === '[' && in_array($letztesEcht, ['(', ','], true)) {
                $start = $j; $tiefe = 1; $stueck = '[';
            }
            if (!$istKommentar && trim($tx) !== '') { $letztesEcht = $tx; }
            continue;
        }
        $stueck .= $tx;
        if ($istKommentar) { continue; }
        if ($tx === '[') { $tiefe++; }
        if ($tx === ']') {
            $tiefe--;
            if ($tiefe === 0) { $optionsQuelle = $stueck; break; }
        }
    }
}
$pruefe('der Argumentblock von set_flow ist auffindbar', is_string($optionsQuelle) && $optionsQuelle !== '');

// Der Block wird AUSGEFUEHRT, mit einem Rumpf, wie der Browser ihn schickt.
// WARNUNG zum `eval` unten -- es ist hier Absicht und kein Einfallstor: ausgefuehrt wird
// ausschliesslich ein Stueck des EIGENEN Endpunkts aus dem Repo (per Tokenizer geschnitten),
// nie eine Eingabe von aussen; dieser Test laeuft nur in der CLI. Das ist das Hausmuster fuer
// Verdrahtungstests (vgl. api/_internal/map/__tests__/aenderungen-sprungpunkt-karte-test.php,
// AGENTS.md §11). Die Alternative -- den Block per Regex lesen -- ist genau die Pruefung, die
// den Fehler NICHT findet: ein Regex kennt keinen Geltungsbereich.
$payload = ['public_id' => 'seg-b', 'flip' => true, 'scope' => 'segment'];
$optionen = eval('return ' . $optionsQuelle . ';');
$pruefe('scope kommt am set_flow-Aufruf an', ($optionen['scope'] ?? null) === 'segment');
$pruefe('flip kommt an', ($optionen['flip'] ?? null) === true);

$payload = ['public_id' => 'seg-d', 'dir' => 'reverse'];
$optionen = eval('return ' . $optionsQuelle . ';');
$pruefe('dir kommt am set_flow-Aufruf an', ($optionen['dir'] ?? null) === 'reverse');
// WARNUNG: Ohne scope im Rumpf darf der Endpunkt NICHTS erfinden -- ueber die Vorgabe ("way")
// entscheidet die Bibliothek. Zwei Stellen mit derselben Vorgabe laufen auseinander.
// WARNUNG: `?? 'FEHLT'` taugt hier NICHT -- der Null-Koaleszenz-Operator kann "Schluessel
// fehlt" nicht von "Wert ist null" unterscheiden, und genau das ist die Frage. array_key_exists.
$pruefe('ohne scope reicht der Endpunkt den Schluessel mit null durch (die Vorgabe macht die Bibliothek)',
    array_key_exists('scope', $optionen) && $optionen['scope'] === null);

// Gegenprobe am echten Aufruf: genau diese Optionen, durch die echte Bibliothek.
$pdo = baueFluss();
avesmapsWikiPathSetFlow($pdo, 'seg-d', $optionen, false, 7);
$pruefe('... und damit setzt die Bibliothek genau diesen Abschnitt', richtungen($pdo)['seg-d'] === 'reverse');
$pruefe('... die Kette bleibt unberuehrt', richtungen($pdo)['seg-a'] === 'forward');

echo "\n=== J - Der Verlauf-Sync darf Handarbeit an Abzweigungen NICHT loeschen ===\n";
// BOMBE: DAS WAR DER SCHWERSTE BEFUND DES KONSISTENZ-AGENTEN, und mein Entwurf behauptete das
// GEGENTEIL ("gilt fuer Abzweigungen ohnehin nicht, weil der Verlauf-Sync sie nie erreicht").
// Das war eine Annahme, nicht eine Messung -- und sie war falsch.
// avesmapsPathFlowPlanWrites macht `unset($new['dir'], $new['source'])` fuer JEDEN Abschnitt, der
// nicht in der abgeleiteten Tafel steht, unabhaengig von `source`. Ein Editor richtet 22 Deltaarme
// von Hand, der naechste "Verlauf uebernehmen" am Grossen Fluss loescht sie still -- gemessen:
// delta-1 wird auf null gesetzt, delta-2 behaelt nur seinen Faktor.
// ROT: DIE GRENZE IST DIE HAUPTKETTE. Der Verlauf-Sync besitzt die KETTE (ein Editor-Flip dort
// wird weiterhin ueberschrieben, Anforderung 4 des Ursprungsentwurfs), der Editor besitzt die
// ABZWEIGUNGEN. Genau diese Grenze zieht avesmapsPathFlowPlanSetDir seit dem 06.07.2026 schon
// ("Anchors off the chain (spurs) ... are only protected, never consulted") -- der Sync-Pfad zog
// sie nicht, und das war im Bestand bisher fast unsichtbar, weil es kaum Abzweig-Richtungen gab
// (live genau EINE, am Grossen Fluss).
$kette = [
    'a' => [[0, 0], [10, 0]],
    'b' => [[10, 0], [20, 0]],
    'c' => [[20, 0], [30, 0]],
    'd' => [[20, 0], [20, 5]],
];
$stand = [
    'a' => ['dir' => 'forward', 'source' => 'verlauf-sync'],
    'b' => ['dir' => 'forward', 'source' => 'editor'],
    'c' => ['dir' => 'forward', 'source' => 'verlauf-sync'],
    'd' => ['dir' => 'reverse', 'source' => 'editor', 'factor' => 2.5],
];
$geschuetzt = avesmapsPathFlowEditorSpurDirs($kette, $stand);
$pruefe('der Abzweig mit Editor-Richtung ist geschuetzt', $geschuetzt === ['d']);
$pruefe('... der Editor-Flip AUF der Kette ist NICHT geschuetzt (der Sync besitzt die Kette)',
    !in_array('b', $geschuetzt, true));
// WARNUNG: Nur `source: editor` ist geschuetzt. Eine Abzweig-Richtung, die der Sync SELBST
// geschrieben hat, darf er auch wieder raeumen -- sonst wuerde eine einmal abgeleitete
// Armrichtung fuer immer festbacken, auch wenn der Wiki-Kurs sie nicht mehr hergibt.
// (Diese Zusicherung fehlte zuerst: eine Mutation durfte die source-Pruefung streichen, und
// alles blieb gruen. Gefunden von der Mutationsprobe.)
$standSync = $kette;
$standSync = [
    'a' => ['dir' => 'forward', 'source' => 'verlauf-sync'],
    'd' => ['dir' => 'reverse', 'source' => 'verlauf-sync'],
];
$pruefe('eine vom SYNC geschriebene Abzweig-Richtung ist NICHT geschuetzt',
    avesmapsPathFlowEditorSpurDirs($kette, $standSync) === []);
$standOhneQuelle = ['d' => ['dir' => 'reverse']];
$pruefe('... und eine ohne jede Quellenangabe auch nicht',
    avesmapsPathFlowEditorSpurDirs($kette, $standOhneQuelle) === []);

// Jetzt der Sync-Plan: die Ableitung kennt nur die Kette.
$abgeleitet = ['a' => 'forward', 'b' => 'forward', 'c' => 'forward'];
$plan = avesmapsPathFlowPlanWrites($abgeleitet, $stand, $geschuetzt);
$pruefe('BOMBE: der Abzweig bleibt unangetastet', !isset($plan['writes']['d']));
$pruefe('... seine Richtung ist noch da', ($stand['d']['dir'] ?? null) === 'reverse');

// Gegenprobe: OHNE den Schutz loescht er ihn (das ist der Zustand von vorher).
$ohne = avesmapsPathFlowPlanWrites($abgeleitet, $stand);
$pruefe('Gegenprobe: ohne Schutz wird der Abzweig geloescht',
    isset($ohne['writes']['d']) && !isset($ohne['writes']['d']['flow']['dir']));

// Und der Sync raeumt weiter auf, was er aufraeumen soll: eine verwaiste KETTEN-Richtung.
$standB = $stand;
$standB['c'] = ['dir' => 'reverse', 'source' => 'verlauf-sync'];
$planB = avesmapsPathFlowPlanWrites(['a' => 'forward', 'b' => 'forward'], $standB,
    avesmapsPathFlowEditorSpurDirs($kette, $standB));
$pruefe('eine nicht mehr abgeleitete KETTEN-Richtung wird weiter geraeumt',
    isset($planB['writes']['c']) && !isset($planB['writes']['c']['flow']['dir']));

echo "\n=== K - Die drei Nachtraege sind verdrahtet ===\n";

// --- K1: Reicht der EINZIGE Aufrufer von PlanWrites den Schutz durch? -------------------------
// BOMBE: Test J prueft PlanWrites DIREKT. Ohne diese Zusicherung koennte der Sync-Pfad den
// dritten Parameter weglassen, und alles bliebe gruen -- die Regel waere an keinem Erzeuger
// gebunden. avesmapsWikiPathFlowDeriveForWay laesst sich hier nicht fahren (Routing-Kontext,
// Staging-Tabellen), also wird ihr Rumpf per Reflection gelesen.
$rf = new ReflectionFunction('avesmapsWikiPathFlowDeriveForWay');
$zeilen = file($rf->getFileName());
$rumpf = implode('', array_slice($zeilen, $rf->getStartLine() - 1, $rf->getEndLine() - $rf->getStartLine() + 1));
$pruefe('der Sync-Pfad ruft PlanWrites', strpos($rumpf, 'avesmapsPathFlowPlanWrites(') !== false);
$pruefe('BOMBE: ... und reicht den Abzweig-Schutz hinein',
    strpos($rumpf, 'avesmapsPathFlowEditorSpurDirs(') !== false);

// Und die Zahl der Aufrufer: kommt je einer dazu, braucht er dieselbe Zeile.
$repoWurzel = dirname(__DIR__, 4);
$aufrufer = 0;
foreach (['api/_internal/wiki/path-flow.php'] as $datei) {
    $t = (string) file_get_contents($repoWurzel . '/' . $datei);
    // Die Definition selbst nicht mitzaehlen -> auf "function " davor pruefen.
    $pos = 0;
    while (($pos = strpos($t, 'avesmapsPathFlowPlanWrites(', $pos)) !== false) {
        $davor = substr($t, max(0, $pos - 30), 30);
        if (strpos($davor, 'function ') === false) { $aufrufer++; }
        $pos += 10;
    }
}
$pruefe('es gibt genau EINEN Aufrufer (gezaehlt, nicht vermutet)', $aufrufer === 1);

// --- K2: Haengt der Revisionsbump an writes? -------------------------------------------------
// BOMBE: "die Kette ist fertig" ist jetzt ok:true statt eines Wurfs -- der Klick laeuft also bis
// zum Bump durch. Ohne Riegel entwertet er den ETag der ~21-MB-Nutzlast fuer JEDEN Besucher,
// ohne dass sich ein Byte geaendert hat. Geprueft wird die BEDINGUNG, ausgefuehrt.
$endpunkt = (string) file_get_contents($repoWurzel . '/api/edit/wiki/paths.php');
$pruefe('der Endpunkt traegt den writes-Riegel fuer set_flow',
    strpos($endpunkt, "\$action !== 'set_flow' || (int) (\$response['writes'] ?? 0) > 0") !== false);
// Die Bedingung als Ausdruck fahren, in beiden Richtungen.
$bedingung = static function (string $action, array $response): bool {
    return $action !== 'set_flow' || (int) ($response['writes'] ?? 0) > 0;
};
$pruefe('set_flow mit 0 writes bumpt NICHT', $bedingung('set_flow', ['writes' => 0]) === false);
$pruefe('set_flow mit 1 write bumpt', $bedingung('set_flow', ['writes' => 1]) === true);
$pruefe('eine andere Aktion bumpt weiter wie bisher', $bedingung('derive_flow', []) === true);

// --- K3: Das Antwortfeld scope beschreibt die WIRKUNG ----------------------------------------
$pdo = baueFluss();
$a = avesmapsWikiPathSetFlow($pdo, 'seg-b', ['flip' => true, 'scope' => 'segment'], true, 7);
$pruefe('Einzel-flip meldet scope=segment', ($a['scope'] ?? '') === 'segment');
$pdo = baueFluss();
$a = avesmapsWikiPathSetFlow($pdo, 'seg-d', ['dir' => 'forward'], true, 7);
$pruefe('BOMBE: dir meldet scope=segment, auch ohne scope im Rumpf', ($a['scope'] ?? '') === 'segment');
$pdo = baueFluss();
$a = avesmapsWikiPathSetFlow($pdo, 'seg-b', ['flip' => true], true, 7);
$pruefe('way-weiter flip meldet scope=way', ($a['scope'] ?? '') === 'way');
$pdo = baueFluss();
// set_dir laeuft way-weit, auch wenn jemand scope:segment mitschickt -- scope gilt nur dem flip.
$a = avesmapsWikiPathSetFlow($pdo, 'seg-a', ['set_dir' => true, 'scope' => 'segment'], true, 7);
$pruefe('BOMBE: set_dir meldet scope=way, obwohl segment geschickt wurde', ($a['scope'] ?? '') === 'way');

echo "\n";
if ($fehler > 0) {
    echo "$fehler Zusicherung(en) NICHT erfüllt\n";
    exit(1);
}
echo "alle Zusicherungen erfüllt\n";
