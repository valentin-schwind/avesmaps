<?php

declare(strict_types=1);

/**
 * Die ABWEICHUNG: eine einzelne Quelle behauptet ein korpuseigenes Feld GEGEN ihren Korpus.
 * Ausfuehren (vom Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/quellen-abweichung-test.php
 *
 * 💣 WARUM ES DAS GIBT. Seit dem 02.09.2026 gehoeren Art, Lizenz, Nennung und Kanon dem KORPUS und
 * werden auf ALLE seine Quellen durchgeschrieben. Live gemessen stehen aber drei Zeilen dagegen --
 * und keine davon ist Lizenz oder Nennung: „Der Preis der Macht" (horaswiki.de) ist ein Abenteuer
 * und offiziell, waehrend sein Korpus „Briefspiel" und „nicht offiziell" sagt. Ein Griff an die Art
 * des Korpus buegelte ihn platt, ohne Meldung. Owner-Entscheid: alle vier Felder abweichbar.
 *
 * 🔴 ZWEI ERZEUGER, ZWEI RIEGEL. Der Korpus-Durchschrieb ist der eine; der UPSERT ist der andere,
 * und er schrieb `is_official` bis dahin BEDINGUNGSLOS. Eine Regel, die einen von zwei Erzeugern
 * bindet, ist keine Regel -- diese Lehre steht in AGENTS.md §11 dreimal.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

require_once __DIR__ . '/../feature-sources.php';
require_once __DIR__ . '/../source-corpus.php';

$pruefungen = 0;
$zaehl = static function () use (&$pruefungen): void { $pruefungen++; };

// ---- 1. Die reinen Helfer -----------------------------------------------------------------------
// 💣 DIE BEGRENZENDEN KOMMATA SIND TRAGEND. Ohne sie traefe ein `LIKE '%,license,%'` die erste und
// die letzte Angabe nicht -- eine Quelle, die als EINZIGES Feld ihre Lizenz besitzt, verloere sie
// beim naechsten Korpus-Speichern still.
assert(avesmapsSourceOwnFieldsFormat(['license']) === ',license,',
    'eine einzelne Angabe wird beidseitig begrenzt');
$zaehl();
assert(avesmapsSourceOwnFieldsFormat([]) === '',
    'die leere Liste ist die LEERE Zeichenkette, nicht "," -- sonst besitzt jede Zeile scheinbar etwas');
$zaehl();
// ⚠️ Die Reihenfolge ist die der Whitelist, nicht die der Eingabe: sonst haengt der gespeicherte
// Wert davon ab, in welcher Reihenfolge die Haekchen im DOM stehen, und jedes Neuzeichnen koennte
// eine „Aenderung" erzeugen, die keine ist.
assert(avesmapsSourceOwnFieldsFormat(['is_official', 'license']) === ',license,is_official,',
    'die Reihenfolge kommt aus der Whitelist, nicht aus der Eingabe');
$zaehl();
assert(avesmapsSourceOwnFieldsFormat(['garetien', 'license']) === ',license,',
    'unbekannte Namen fallen weg');
$zaehl();
assert(avesmapsSourceOwnFieldsParse(',license,is_official,') === ['license', 'is_official'],
    'und zurueck wird eine Liste');
$zaehl();
assert(avesmapsSourceOwnFieldsParse('') === [] && avesmapsSourceOwnFieldsParse(null) === [],
    'leer und null ergeben die leere Liste');
$zaehl();
// 🔴 Der Feldname geht NIE aus einer Anfrage in SQL: er wird gegen die Whitelist geprueft.
$geworfen = false;
try {
    avesmapsSourceOwnFieldsSqlGuard("license'; DROP TABLE sources; --");
} catch (InvalidArgumentException $e) {
    $geworfen = true;
}
assert($geworfen, 'ein fremder Feldname wird abgelehnt, nicht in SQL gereicht');
$zaehl();
assert(avesmapsSourceOwnFieldsSqlGuard('license') === "own_fields NOT LIKE '%,license,%'",
    'und der Riegel sucht die BEGRENZTE Form');
$zaehl();

// ---- 2. Der Durchschrieb ueberspringt, was die Zeile besitzt -------------------------------------
$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('CREATE TABLE sources (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT, url_hash TEXT UNIQUE,
    wiki_key TEXT NULL, label TEXT, source_type TEXT NOT NULL DEFAULT "sonstiges",
    is_official INTEGER NOT NULL DEFAULT 0, license TEXT NOT NULL DEFAULT "",
    attribution TEXT NOT NULL DEFAULT "", own_fields TEXT NOT NULL DEFAULT "",
    created_by INTEGER NULL, created_at TEXT NOT NULL DEFAULT "2026-01-01 00:00:00")');
$pdo->exec('CREATE TABLE feature_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT,
    entity_public_id TEXT, source_id INTEGER, status TEXT DEFAULT "approved", origin TEXT DEFAULT "manual",
    reference_kind TEXT NULL, pages TEXT NULL, note TEXT NULL, created_by INTEGER NULL,
    created_at TEXT NOT NULL DEFAULT "2026-01-01 00:00:00",
    UNIQUE(entity_type, entity_public_id, source_id))');
$pdo->exec('CREATE TABLE source_corpus (corpus_key TEXT PRIMARY KEY, label TEXT NOT NULL DEFAULT "",
    form TEXT NOT NULL DEFAULT "", source_type TEXT NOT NULL DEFAULT "", license TEXT NOT NULL DEFAULT "",
    attribution TEXT NOT NULL DEFAULT "", is_official INTEGER NOT NULL DEFAULT 0,
    updated_by INTEGER NULL, updated_at TEXT NULL)');

$lege = static function (PDO $pdo, int $id, string $url, string $typ, int $off, string $eigen): void {
    $pdo->prepare('INSERT INTO sources (id, url, url_hash, label, source_type, is_official, license, own_fields)
        VALUES (?, ?, ?, ?, ?, ?, "", ?)')
        ->execute([$id, $url, hash('sha256', $url), 'X', $typ, $off, $eigen]);
    $pdo->prepare('INSERT INTO feature_sources (entity_type, entity_public_id, source_id) VALUES ("settlement", ?, ?)')
        ->execute(['ort-' . $id, $id]);
};
// Zwei Zeilen desselben Wirts: eine gewoehnliche, eine die ihre Art und ihren Kanon SELBST besitzt.
$lege($pdo, 1, 'https://horaswiki.de/wiki/Irendor', 'briefspiel', 0, '');
$lege($pdo, 2, 'https://www.horaswiki.de/wiki/Der_Preis_der_Macht', 'abenteuer', 1,
    avesmapsSourceOwnFieldsFormat(['source_type', 'is_official']));

$ergebnis = avesmapsSourceCorpusSave($pdo, 'horaswiki.de', [
    'label' => 'LieblichesFeld-Wiki',
    'source_type' => 'briefspiel',
    'is_official' => false,
    'license' => 'cc-by-sa-4.0',
], 9, true);
assert(($ergebnis['ok'] ?? false) === true, 'der Korpus laesst sich speichern');
$zaehl();

$lies = static fn(PDO $pdo, int $id): array => $pdo->query(
    'SELECT source_type, is_official, license FROM sources WHERE id = ' . $id)->fetch(PDO::FETCH_ASSOC);

$gewoehnlich = $lies($pdo, 1);
assert($gewoehnlich['source_type'] === 'briefspiel' && (int) $gewoehnlich['is_official'] === 0
    && $gewoehnlich['license'] === 'cc-by-sa-4.0',
    'die gewoehnliche Zeile bekommt alle drei Werte des Korpus');
$zaehl();

$abweichend = $lies($pdo, 2);
// 🔴 DER KERN DES GANZEN: die zwei besessenen Felder bleiben, das dritte wandert mit.
assert($abweichend['source_type'] === 'abenteuer',
    'die selbst besessene Art ueberlebt den Durchschrieb -- „Der Preis der Macht" bleibt ein Abenteuer');
$zaehl();
assert((int) $abweichend['is_official'] === 1,
    'und der selbst besessene Kanon-Haken ebenso');
$zaehl();
// ⚠️ Und das ist die Gegenprobe, ohne die der Riegel auch „schreibt gar nichts mehr" heissen
// koennte: was die Zeile NICHT besitzt, wandert weiterhin mit.
assert($abweichend['license'] === 'cc-by-sa-4.0',
    'was sie nicht besitzt, bekommt sie trotzdem -- der Riegel gilt je FELD, nicht je Zeile');
$zaehl();

// ---- 3. Der zweite Erzeuger: der Upsert ---------------------------------------------------------
// 💣 `is_official` war das EINZIGE Feld, das der Upsert bedingungslos ueberschrieb -- und es wirkt
// katalogweit. Die SQL ist MySQL (`VALUES(...)`) und gegen SQLite nicht fahrbar; geprueft wird
// deshalb die erzeugte Anweisung, so wie es `quellen-art-korrigieren-test.php` daneben schon tut.
$sql = avesmapsSourceUpsertOnDuplicateSql(false, true);
foreach (['is_official', 'source_type'] as $feld) {
    assert(str_contains($sql, avesmapsSourceOwnFieldsSqlGuard($feld)),
        'der Upsert traegt den Riegel fuer ' . $feld);
    $zaehl();
}
// ⚠️ Lizenz und Nennung brauchen ihn NICHT: sie FUELLEN dort nur Luecken
// (`IF(VALUES(license) = '', license, VALUES(license))`), koennen also nie etwas ueberschreiben.
// Der Riegel waere dort eine zweite Regel fuer denselben Zweck.
assert(str_contains($sql, "license = IF(VALUES(license) = '', license, VALUES(license))"),
    'die Lizenz fuellt weiterhin nur -- dort braucht es keinen zweiten Riegel');
$zaehl();

// ---- 4. Beide Riegel kommen aus DERSELBEN Quelle -------------------------------------------------
// 🪤 Zwei handgeschriebene `NOT LIKE`-Ausdruecke liefen beim ersten neuen Feld auseinander, und der
// Fehler waere STILL: eine Abweichung, die nur einer der beiden Erzeuger respektiert.
$tokenlos = static function (string $php): string {
    $raus = '';
    foreach (token_get_all($php) as $stueck) {
        if (is_array($stueck) && in_array($stueck[0], [T_COMMENT, T_DOC_COMMENT], true)) {
            continue;
        }
        $raus .= is_array($stueck) ? $stueck[1] : $stueck;
    }
    return $raus;
};
// ⚠️ GEZAEHLT, NICHT VERBOTEN: der Ausdruck DARF genau einmal dastehen -- in der Funktion, die ihn
// baut. Ein blankes „kommt nicht vor" schlaegt an ihrer eigenen Definition an, und das ist beim
// Bau dieses Tests prompt passiert.
$erwartet = ['feature-sources.php' => 1, 'source-corpus.php' => 0];
foreach ($erwartet as $datei => $anzahl) {
    $quelltext = $tokenlos((string) file_get_contents(__DIR__ . '/../' . $datei));
    assert(preg_match_all("/own_fields NOT LIKE '%,/", $quelltext) === $anzahl,
        $datei . ': der Riegel steht ' . $anzahl . '-mal woertlich da -- alles andere ruft avesmapsSourceOwnFieldsSqlGuard');
    $zaehl();
}
// Und die zwei Erzeuger RUFEN ihn wirklich, statt ihn nur zu kennen.
foreach (['feature-sources.php' => 2, 'source-corpus.php' => 1] as $datei => $mindestens) {
    $quelltext = $tokenlos((string) file_get_contents(__DIR__ . '/../' . $datei));
    assert(substr_count($quelltext, 'avesmapsSourceOwnFieldsSqlGuard(') >= $mindestens,
        $datei . ' ruft den Riegel');
    $zaehl();
}

// ---- 5. Die Whitelist ist DIESELBE wie die des Korpus --------------------------------------------
// 🔴 „Jedes Feld, das der Korpus vorgibt, darf die einzelne Quelle ueberschreiben." Eine Liste mit
// Ausnahmen merkt sich niemand -- und ausgerechnet die zwei, die der Owner NICHT genannt hat, sind
// die einzigen, die den Fall im Bestand heute schon haben.
$a = AVESMAPS_SOURCE_OWNABLE_FIELDS;
$b = AVESMAPS_SOURCE_CORPUS_OWNED_FIELDS;
sort($a);
sort($b);
assert($a === $b, 'abweichbar ist genau, was der Korpus vorgibt -- keine Ausnahme');
$zaehl();

fwrite(STDOUT, "OK -- {$pruefungen} Zusicherungen erfuellt (Abweichung vom Korpus).\n");
exit(0);
