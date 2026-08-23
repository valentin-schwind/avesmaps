<?php

declare(strict_types=1);

/**
 * Der Aufraeum-Lauf fuer die Altlast in den Wappenfeldern. Kein Netz. Lauf:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *       api/_internal/wiki/__tests__/wappen-aufraeumen-test.php
 *
 * 🔴 Was hier gewacht wird, ist nicht die Treffsicherheit der Regel -- die kann eine Heuristik
 * nicht liefern -- sondern die SICHERUNGEN drumherum: dass eigene Uploads nie angefasst werden,
 * dass ein Probelauf die Vorgabe ist, dass geraeumt wird OHNE den Ort zu leeren, und dass jede
 * Raeumung eine Spur hinterlaesst.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'. Neu starten mit: "
        . "php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../wappen-aufraeumen.php';

$W = 'https://de.wiki-aventurica.de/wiki/Spezial:Dateipfad/';
$urteil = static fn (string $datei, string $quelle = 'wiki'): array
    => avesmapsWappenAufraeumenUrteil(['coat' => ['url' => $W . rawurlencode($datei), 'source' => $quelle]]);

// ---- 1. Wofuer der Lauf gebaut ist: Infobox-Fotos im Wappenfeld -------------------------------
// Genau diese Namen standen am 23.08.2026 in den 502ern des Editors und sind Ortsfotos.
foreach (['Drachenmuseum Sofus.jpg', 'Auraleth by Fil.jpg', 'Etilia-Statue2023 RvB.jpg', 'AB A186.jpg'] as $foto) {
    assert($urteil($foto)['tun'] === true, "$foto ist ein Kandidat -- ein Foto ist kein Wappen");
}

// ---- 2. Was er in Ruhe laesst -----------------------------------------------------------------
foreach (['Wappen Gareth Stadt 1. Var 3.png', 'Wappen Ferdok.webp', 'Coat of arms of Havena.svg'] as $wappen) {
    assert($urteil($wappen)['tun'] === false, "$wappen bleibt -- der Name sagt Wappen");
}

// 🔴 EIGENE UPLOADS SIND TABU, egal wie die Datei heisst. Ein Mensch hat sie ausgewaehlt; eine
// Namensheuristik darf diese Entscheidung nicht ueberstimmen.
assert($urteil('Irgendein Bild.jpg', 'own')['tun'] === false, 'DER KERN: source=own wird nie angefasst');
assert($urteil('Urlaubsfoto.jpg', 'own')['grund'] === 'eigener Upload', 'und der Grund sagt es auch');

// ⚠️ Eine lokal abgelegte Kopie heisst <sha1>.png und sagt NICHTS ueber ihren Ursprung. Kein Beleg
// dafuer, dass es ein Wappen ist -- aber auch keiner fuers Gegenteil, und ohne Beleg wird nicht
// geloescht.
$hash = str_repeat('a', 40) . '.png';
$lokal = avesmapsWappenAufraeumenUrteil(['coat' => ['url' => '/uploads/wappen/cache/' . $hash, 'source' => 'wiki']]);
assert($lokal['tun'] === false, 'eine lokale Kopie wird nicht geraeumt -- ihr Name verraet nichts');

// ---- 3. 🪤 DIE BEKANNTE SCHWAECHE, damit sie niemand fuer einen Fehler haelt -------------------
// Ein Wappen MUSS nicht „Wappen" heissen. Die Zwergenreich-Wappen aus dem eigenen Bestand
// (Bath Molokh, Bath Ammar) heissen nach ihrem Reich -- die Heuristik haelt sie fuer Fotos.
// 🔴 GENAU DESHALB ist der Probelauf die Vorgabe und ein Mensch sieht die Liste, bevor etwas
// verschwindet. Wer diese Zusicherung „repariert", muss zuerst eine bessere Regel haben.
assert($urteil('Bath Molokh.svg')['tun'] === true,
    'bekannte Schwaeche: ein Wappen ohne das Wort „Wappen" im Namen wird als Kandidat gefuehrt. '
    . 'Das ist der Grund fuer den Probelauf -- keine Rechtfertigung fuers Loeschen ohne Ansicht.');

// ---- 4. Leere und kaputte Formen werfen nicht -------------------------------------------------
assert(avesmapsWappenAufraeumenUrteil([])['tun'] === false, 'ohne coat-Feld nichts zu tun');
assert(avesmapsWappenAufraeumenUrteil(['coat' => ['url' => '']])['tun'] === false, 'leer bleibt leer');
assert(avesmapsWappenAufraeumenUrteil(['coat' => 'kein array'])['tun'] === false, 'kaputte Form wirft nicht');

// ---- 5. Der Probelauf ist die VORGABE ---------------------------------------------------------
// 💣 Die Signatur traegt die Sicherung: wer avesmapsWappenAufraeumenLauf($pdo) ohne zweites
// Argument ruft -- und das tut jeder, der den Aufruf abschreibt -- aendert NICHTS.
$sig = new ReflectionFunction('avesmapsWappenAufraeumenLauf');
$scharfParam = $sig->getParameters()[1] ?? null;
assert($scharfParam !== null && $scharfParam->getName() === 'scharf', 'der zweite Parameter heisst scharf');
assert($scharfParam->isDefaultValueAvailable() && $scharfParam->getDefaultValue() === false,
    'DER KERN VON TEIL 5: die Vorgabe ist der PROBELAUF. Ein Aufraeumer, der beim blossen Aufruf '
    . 'loescht, ist eine Falle.');

// ---- 6. DER ABLAUF gegen eine echte Datenbank -------------------------------------------------
// 🔴 Der Schreibweg wird hier WIRKLICH AUSGEFUEHRT. Ein Modul, dessen DB-Haelfte nie lief, geht
// live und antwortet mit einem leeren Rumpf -- das ist im Haus schon zweimal passiert.
// 🔴 Die EINE MySQL-eigene Anweisung wird an der TREIBER-Naht uebersetzt, nicht in der Lib
// umgeschrieben: `ON DUPLICATE KEY UPDATE` (avesmapsWikiSyncNextMapRevision) kennt SQLite nicht.
// AGENTS.md §9 -- wer die Produktionsform verbiegt, damit ein Test laeuft, hat den Test gegen die
// Produktion gedreht. Dasselbe Rezept wie in wege-gruppe-schreiben-test.php.
final class AvesmapsWappenAufraeumenTestPdo extends PDO
{
    public function exec(string $statement): int|false
    {
        if (str_contains($statement, 'ON DUPLICATE KEY UPDATE revision = revision + 1')) {
            $statement = 'INSERT INTO map_revision (id, revision) VALUES (1, 2)
                          ON CONFLICT(id) DO UPDATE SET revision = map_revision.revision + 1';
        }

        return parent::exec($statement);
    }
}

$db = new AvesmapsWappenAufraeumenTestPdo('sqlite::memory:', null, null,
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$db->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY, public_id TEXT, name TEXT,
    feature_type TEXT, feature_subtype TEXT, properties_json TEXT, revision INTEGER DEFAULT 0)');
$db->exec('CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
$db->exec('CREATE TABLE map_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, feature_id INTEGER,
    action TEXT, actor_user_id INTEGER, before_json TEXT, after_json TEXT)');

$einfuegen = $db->prepare('INSERT INTO map_features (id, public_id, name, feature_type, properties_json)
    VALUES (:id, :pid, :name, :typ, :pj)');
$bestand = [
    [1, 'loc-1', 'Gareth',   ['coat' => ['url' => $W . 'Wappen%20Gareth.png', 'source' => 'wiki']]],
    [2, 'loc-2', 'Auraleth', ['coat' => ['url' => $W . 'Auraleth%20by%20Fil.jpg', 'source' => 'wiki']]],
    [3, 'loc-3', 'Sofus',    ['coat' => ['url' => $W . 'Drachenmuseum%20Sofus.jpg', 'source' => 'wiki'],
                              'is_ruined' => true]],
    [4, 'loc-4', 'Eigenes',  ['coat' => ['url' => $W . 'Urlaubsfoto.jpg', 'source' => 'own']]],
];
foreach ($bestand as [$id, $pid, $name, $props]) {
    $einfuegen->execute([':id' => $id, ':pid' => $pid, ':name' => $name, ':typ' => 'location',
        ':pj' => json_encode($props, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
}

// 6a. Der PROBELAUF findet die zwei Fotos -- und aendert NICHTS.
$probe = avesmapsWappenAufraeumenLauf($db);
assert($probe['dry_run'] === true, 'der Probelauf sagt von sich, dass er einer ist');
assert($probe['kandidaten'] === 2,
    'zwei Fotos gefunden -- nicht das Wappen, nicht der eigene Upload; gemeldet: ' . $probe['kandidaten']);
assert($probe['geraeumt'] === 0, 'DER KERN: der Probelauf schreibt nicht');
$nochDa = (int) $db->query("SELECT COUNT(*) FROM map_features WHERE properties_json LIKE '%coat%'")->fetchColumn();
assert($nochDa === 4, 'nach dem Probelauf stehen alle vier Wappenfelder noch da');
assert((int) $db->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 0,
    'und ein Probelauf protokolliert auch nichts');

// 🔴 Die Liste nennt Ort UND Datei -- ohne beides kann ein Mensch das Urteil nicht pruefen, und
// dann ist der Probelauf nur eine Zahl.
$orte = array_column($probe['liste'], 'ort');
sort($orte);
assert($orte === ['Auraleth', 'Sofus'], 'die Liste nennt die betroffenen Orte: ' . implode(', ', $orte));
assert($probe['liste'][0]['datei'] !== '', 'und den Dateinamen, um den es geht');

// 6b. Die SCHARFE Fahrt raeumt genau diese zwei.
$fahrt = avesmapsWappenAufraeumenLauf($db, true, 42);
assert($fahrt['geraeumt'] === 2, 'zwei geraeumt, gemeldet: ' . $fahrt['geraeumt']);

$nachher = [];
foreach ($db->query('SELECT id, properties_json FROM map_features ORDER BY id') as $z) {
    $nachher[(int) $z['id']] = json_decode((string) $z['properties_json'], true);
}
assert(isset($nachher[1]['coat']), 'das echte Wappen steht noch');
assert(!isset($nachher[2]['coat']), 'das Foto ist weg');
assert(!isset($nachher[3]['coat']), 'das zweite Foto auch');
assert(isset($nachher[4]['coat']), 'DER KERN: der eigene Upload ist unangetastet');

// 🔴 Geraeumt wird das WAPPENFELD, nicht der Datensatz. Ein unset auf der falschen Ebene haette
// hier den ganzen Ort geleert, und die Zusicherungen davor waeren trotzdem gruen gewesen.
assert(($nachher[3]['is_ruined'] ?? null) === true, 'die uebrigen Eigenschaften bleiben stehen');
assert((int) $db->query('SELECT COUNT(*) FROM map_features')->fetchColumn() === 4, 'keine Zeile geloescht');

// 🔴 KEIN coat_none: der naechste Abgleich soll hier ein echtes Wappen eintragen duerfen.
assert(!isset($nachher[2]['coat_none']), 'geraeumt heisst nicht „dieser Ort hat kein Wappen"');

// 6c. Jede Raeumung hinterlaesst eine Spur.
$spuren = $db->query("SELECT feature_id, actor_user_id FROM map_audit_log WHERE action = 'wappen_aufraeumen'")
    ->fetchAll(PDO::FETCH_ASSOC);
assert(count($spuren) === 2, 'eine Protokollzeile je geraeumtem Ort, gefunden: ' . count($spuren));
assert((int) $spuren[0]['actor_user_id'] === 42, 'und sie nennt, wer es war');

// 6d. Ein zweiter Lauf findet nichts mehr -- er konvergiert.
$nochmal = avesmapsWappenAufraeumenLauf($db, true, 42);
assert($nochmal['kandidaten'] === 0, 'der Lauf konvergiert, findet beim zweiten Mal: ' . $nochmal['kandidaten']);

// ---- 7. Die VERDRAHTUNG -- ein gruener Test an einer Funktion, die niemand ruft, beweist nichts -
$endpunkt = (string) file_get_contents(dirname(__DIR__, 3) . '/edit/wiki/settlements.php');
assert(strpos($endpunkt, "wappen-aufraeumen.php'") !== false, 'der Endpunkt laedt die Lib');
assert(strpos($endpunkt, "'cleanup_coats'") !== false, 'und kennt die Aktion');
$block = substr($endpunkt, (int) strpos($endpunkt, "'cleanup_coats'"), 900);
assert(strpos($block, 'avesmapsWappenAufraeumenLauf') !== false, 'die Aktion ruft den Lauf');

// 🔴 Die scharfe Fahrt haengt an 'admin' UND an der ausdruecklichen Bestaetigung.
assert(strpos($block, "'admin'") !== false && strpos($block, 'avesmapsUserCan') !== false,
    'DER KERN VON TEIL 7: geloescht wird nur mit admin');
assert(strpos($block, '$isApply()') !== false, 'und nur mit dry_run:false + confirm:apply');

// ⚠️ Und die Absage sagt WARUM -- eine stille Ruecknahme auf den Probelauf waere von aussen nicht
// von „es gab nichts zu tun" zu unterscheiden.
assert(strpos($block, 'avesmapsErrorResponse') !== false,
    'eine Absage wegen fehlender Rechte wird gesagt, nicht verschwiegen');

echo "OK: wappen-aufraeumen-test -- alle Zusicherungen gehalten\n";
