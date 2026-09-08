<?php

declare(strict_types=1);

/**
 * DIE QUELLEN EINES WEGS GEHOEREN ALLEN SEINEN ABSCHNITTEN (08.09.2026).
 *
 * 🔴 Owner: „Quellen wirklich verteilen -> das wollen wir." Die Alternative -- der Kopf liest die
 * Quellen der Nachbarabschnitte bloss mit -- wurde verworfen, weil ein Abschnitt dann ein
 * „INOFFIZIELL │ Briefspiel" truege, waehrend sein Quellenkasten leer ist.
 *
 * Geprueft wird GEGEN SQLITE und mit wirklich gefahrenem Lauf (kein Quelltext-Lesen):
 *   1. die Verteilung selbst -- eine Quelle an einem Abschnitt landet an allen seiner Gruppe
 *   2. der Trockenlauf zaehlt und schreibt NICHTS
 *   3. ein Grabstein (`suppressed`) wird respektiert, die Quelle nicht dorthin verteilt
 *   4. eine Namensgruppe mit ZWEI wiki_keys ist NICHT ein Weg -- sie wird uebersprungen
 *   5. Vorlagenuebernahme: origin, reference_kind, pages, note reisen mit
 *   6. Wiederholbarkeit: ein zweiter Lauf findet nichts mehr
 *   7. der Deckel und der Revisionsstempel
 *
 * Aus der Wurzel des Repos:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll -d extension=php_mbstring.dll api/_internal/app/__tests__/wegquellen-verteilen-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

$GLOBALS['avesmapsTestRevisionBumps'] = 0;
function avesmapsNextMapRevision(PDO $pdo): int
{
    $GLOBALS['avesmapsTestRevisionBumps']++;

    return $GLOBALS['avesmapsTestRevisionBumps'];
}

require_once __DIR__ . '/../../bootstrap.php';
require_once __DIR__ . '/../feature-sources.php';

$pruefungen = 0;
$pruefe = static function (bool $bedingung, string $was) use (&$pruefungen): void {
    assert($bedingung, $was);
    $pruefungen++;
};

/** Eine frische Welt: Wege, Katalog, Verknuepfungen. */
$welt = static function (): PDO {
    $pdo = new PDO('sqlite::memory:');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    avesmapsEnsureFeatureSourceTables($pdo);
    $pdo->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY, public_id TEXT, name TEXT,
        feature_type TEXT, feature_subtype TEXT, is_active INTEGER, properties_json TEXT)');
    $weg = $pdo->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, is_active, properties_json)
        VALUES (?, ?, "path", ?, ?, ?)');
    $mitKey = static fn (string $k): string => json_encode(['wiki_path' => ['wiki_key' => $k]]);

    // Der gemeldete Fall: drei Abschnitte, die Quelle haengt nur an einem.
    $weg->execute(['w-1', 'Yasamirer Stieg', 'Strasse', 1, $mitKey('yasamirer-stieg')]);
    $weg->execute(['w-2', 'Yasamirer Stieg', 'Strasse', 1, $mitKey('yasamirer-stieg')]);
    $weg->execute(['w-3', 'Yasamirer Stieg', 'Strasse', 1, '{}']);          // unzugewiesen -- gehoert dazu
    // Ein Grabstein: an w-5 wurde die Quelle bewusst entfernt.
    $weg->execute(['w-4', 'Hagweg', 'Weg', 1, $mitKey('hagweg')]);
    $weg->execute(['w-5', 'Hagweg', 'Weg', 1, $mitKey('hagweg')]);
    // Zwei gleichnamige Wege mit VERSCHIEDENEN Artikeln -- kein Weg, sondern zwei.
    $weg->execute(['x-1', 'Nôrrnstieg', 'Pfad', 1, $mitKey('noerrnstieg-nord')]);
    $weg->execute(['x-2', 'Nôrrnstieg', 'Pfad', 1, $mitKey('noerrnstieg-sued')]);
    // Ein einteiliger Weg und ein geloeschter Abschnitt.
    $weg->execute(['e-1', 'Einzelweg', 'Pfad', 1, $mitKey('einzelweg')]);
    $weg->execute(['t-1', 'Yasamirer Stieg', 'Strasse', 0, $mitKey('yasamirer-stieg')]);  // inaktiv
    // Ohne Namen -- bildet keine Gruppe.
    $weg->execute(['n-1', '', 'Pfad', 1, '{}']);
    $weg->execute(['n-2', '', 'Pfad', 1, '{}']);

    $pdo->exec("INSERT INTO sources (id, url, url_hash, label, source_type, is_official)
        VALUES (1, 'https://a/1', 'h1', 'Herzogtum Weiden', 'briefspiel', 0),
               (2, 'https://a/2', 'h2', 'Heldentrutz', 'regionalspielhilfe', 1)");
    $fs = $pdo->prepare('INSERT INTO feature_sources (entity_type, entity_public_id, source_id, status, origin, reference_kind, pages, note)
        VALUES ("path", ?, ?, ?, ?, ?, ?, ?)');
    $fs->execute(['w-1', 1, 'approved', 'manual', null, 'S. 42', 'Notiz']);
    $fs->execute(['w-4', 2, 'approved', 'wiki_publication', 'ergaenzend', 'S. 7', null]);
    $fs->execute(['w-5', 2, 'suppressed', 'wiki_publication', 'ergaenzend', null, null]);  // Grabstein
    $fs->execute(['x-1', 1, 'approved', 'manual', null, null, null]);
    $fs->execute(['e-1', 1, 'approved', 'manual', null, null, null]);

    return $pdo;
};

$zeilen = static function (PDO $pdo, string $pid): array {
    $st = $pdo->prepare('SELECT source_id, status, origin, reference_kind, pages, note
        FROM feature_sources WHERE entity_type = "path" AND entity_public_id = ? ORDER BY source_id');
    $st->execute([$pid]);

    return $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
};

// ---- 1. Der TROCKENLAUF zaehlt und schreibt nichts --------------------------------------------
$pdo = $welt();
$vorher = (int) $pdo->query('SELECT COUNT(*) FROM feature_sources')->fetchColumn();
$trocken = avesmapsFeatureSourcesVerteileWegQuellen($pdo, 9, true, 500);
$pruefe($trocken['ok'] === true && $trocken['trocken'] === true, 'der Trockenlauf meldet sich als solcher');
$pruefe((int) $pdo->query('SELECT COUNT(*) FROM feature_sources')->fetchColumn() === $vorher,
    'der Trockenlauf schreibt KEINE Zeile');
$pruefe($GLOBALS['avesmapsTestRevisionBumps'] === 0, 'und stempelt die Karte nicht');
// w-2 und w-3 fehlt Quelle 1 -> 2 Verknuepfungen. Der Hagweg: w-5 hat einen Grabstein, also nichts.
$pruefe($trocken['verknuepfungen_neu'] === 2,
    'gezaehlt werden genau die zwei fehlenden Verknuepfungen des Yasamirer Stiegs');
$pruefe($trocken['uebersprungen_uneindeutig'] === 1,
    'die Namensgruppe mit zwei wiki_keys wird uebersprungen');

// ---- 2. Der SCHARFE Lauf verteilt ------------------------------------------------------------
$pdo = $welt();
$scharf = avesmapsFeatureSourcesVerteileWegQuellen($pdo, 9, false, 500);
$pruefe($scharf['verknuepfungen_neu'] === 2, 'scharf entstehen dieselben zwei Verknuepfungen');
$pruefe(count($zeilen($pdo, 'w-2')) === 1 && count($zeilen($pdo, 'w-3')) === 1,
    'beide Abschnitte tragen die Quelle ihres Wegs jetzt auch');
$pruefe($GLOBALS['avesmapsTestRevisionBumps'] === 1,
    'der Kartenstempel wird EINMAL gesetzt -- ohne ihn bekaeme jeder warme Browser sein 304');

// 🔴 DIE VORLAGE REIST MIT. Ohne sie stuende die Quelle am Nachbarabschnitt ohne Seitenangabe da,
// und der Editor haelt zwei Zeilen derselben Quelle fuer zwei verschiedene Belege.
$neu = $zeilen($pdo, 'w-2')[0];
$pruefe($neu['pages'] === 'S. 42' && $neu['note'] === 'Notiz' && $neu['origin'] === 'manual',
    'Seitenangabe, Notiz und Herkunft werden von der Vorlage uebernommen');
$pruefe($neu['status'] === 'approved', 'und die neue Zeile ist sichtbar');

// ---- 3. DER GRABSTEIN WIRD RESPEKTIERT --------------------------------------------------------
// 💣 w-5 hat die Quelle bewusst entfernt (`suppressed`). Sie ihm zurueckzugeben waere, seine
// Entscheidung stillschweigend umzudrehen -- dieselbe Klasse wie das Adressraten bei Discord #38.
$hagweg = $zeilen($pdo, 'w-5');
$pruefe(count($hagweg) === 1 && $hagweg[0]['status'] === 'suppressed',
    'der Grabstein bleibt ein Grabstein -- keine zweite Zeile daneben');

// ---- 4. UNEINDEUTIGE GRUPPEN BLEIBEN UNBERUEHRT ----------------------------------------------
$pruefe($zeilen($pdo, 'x-2') === [],
    'zwei gleichnamige Wege mit verschiedenen Artikeln tauschen keine Quellen');

// ---- 5. EINTEILIGE WEGE UND NAMENLOSE ABSCHNITTE ----------------------------------------------
$pruefe(count($zeilen($pdo, 'e-1')) === 1, 'ein einteiliger Weg bleibt, wie er ist');
$pruefe($zeilen($pdo, 'n-1') === [] && $zeilen($pdo, 'n-2') === [],
    'namenlose Abschnitte bilden keine Gruppe');
// ⚠️ Der INAKTIVE Abschnitt bekommt nichts: er liegt nicht auf der Karte.
$pruefe($zeilen($pdo, 't-1') === [], 'ein geloeschter Abschnitt wird nicht bedient');

// ---- 6. WIEDERHOLBAR --------------------------------------------------------------------------
$GLOBALS['avesmapsTestRevisionBumps'] = 0;
$zweiter = avesmapsFeatureSourcesVerteileWegQuellen($pdo, 9, false, 500);
$pruefe($zweiter['verknuepfungen_neu'] === 0, 'ein zweiter Lauf findet nichts mehr zu tun');
$pruefe($GLOBALS['avesmapsTestRevisionBumps'] === 0, 'und stempelt die Karte dann auch nicht');

// ---- 7. DER DECKEL ----------------------------------------------------------------------------
$pdo = $welt();
$gedeckelt = avesmapsFeatureSourcesVerteileWegQuellen($pdo, 9, false, 1);
$pruefe($gedeckelt['verknuepfungen_neu'] === 1, 'der Deckel greift');
$pruefe($gedeckelt['offen'] >= 1, 'und meldet, was liegen bleibt');
$pruefe((int) $pdo->query('SELECT COUNT(*) FROM feature_sources')->fetchColumn() === 6,
    'genau eine Zeile ist dazugekommen');

// ---- 8. DIE VERDRAHTUNG -----------------------------------------------------------------------
// 💣 Ohne sie ist alles darueber Theorie. Am Zeilenanfang gesucht: ein auskommentierter Aufruf
// ist keine Verdrahtung. Kommentare werden vorher entfernt -- mit dem Tokenizer, nicht mit zwei
// preg_replace (ein `/*` in einem ZEILENkommentar frisst sonst hunderte Zeilen, AGENTS.md).
$endpunktPfad = __DIR__ . '/../../../edit/map/feature-sources.php';
assert(is_file($endpunktPfad), 'der Endpunkt muss unter ' . $endpunktPfad . ' liegen');
$roh = (string) file_get_contents($endpunktPfad);
$code = '';
foreach (token_get_all($roh) as $token) {
    if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
        continue;
    }
    $code .= is_array($token) ? $token[1] : $token;
}
$pruefe(strpos($code, "'verteile_wegquellen'") !== false,
    'der Endpunkt kennt die Aktion');
$pruefe(strpos($code, 'avesmapsFeatureSourcesVerteileWegQuellen($pdo, $userId, !$scharf') !== false,
    'und ruft den Verteiler mit dem Trockenlauf als Vorgabe');
$pruefe(preg_match('/verteile_wegquellen.{0,400}avesmapsUserCan\(\$user, \'admin\'\)/s', $code) === 1,
    'nur Admins duerfen ihn fahren');
// ⚠️ Ohne diesen Eintrag verlangte der Endpunkt eine `entity_public_id` -- der Sammellauf fragt
// aber nach ALLEN Wegen und hat keine.
// 🪤 Die LISTE pruefen, nicht ihre exakte Zeichenfolge: genau daran ist der Nachbartest
// (quellen-label-takeover-test.php) umgefallen, als diese Aktion dazukam.
// 🪤 DIE LISTE ABLESEN, NICHT IHRE EXAKTE ZEICHENFOLGE PRUEFEN. Hier stand die Aufzaehlung
// woertlich -- und die Zusicherung fiel um, als sie einen dritten Eintrag bekam
// (`verteile_wegquellen`, 08.09.2026), obwohl an der Sache nichts falsch war. Ein Test, der eine
// Aufzaehlung festnagelt, bricht bei jeder Erweiterung.
// ⚠️ Ohne Regex: der erste Anlauf schrieb sie per Skript in die Datei und machte aus `\x27` ein
// echtes Anfuehrungszeichen -- die Datei war danach nicht mehr parsebar.
$liste = strstr($code, 'in_array($action, [');
$liste = $liste === false ? '' : substr($liste, 0, (int) strpos($liste, ']'));
$pruefe(str_contains($liste, "'verteile_wegquellen'"),
    'er steht in der Liste der Aktionen ohne entity_public_id');

echo 'wegquellen-verteilen-test.php: ' . $pruefungen . " Zusicherungen erfuellt\n";
