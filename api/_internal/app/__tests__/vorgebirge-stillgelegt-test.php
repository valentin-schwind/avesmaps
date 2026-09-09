<?php

declare(strict_types=1);

/**
 * „Vor-/Mittelgebirge" ist gestrichen -- und die HOEHENSTUFEN gleichen Namens bleiben.
 *
 * Lauf (aus dem Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *       -d extension=php_mbstring.dll api/_internal/app/__tests__/vorgebirge-stillgelegt-test.php
 *
 * 💣 WARUM ES DIESEN TEST GIBT. Owner-Entscheid vom 09.09.2026, woertlich:
 *
 *     „vorgebirge_mittelgebirge als Flaechenart und als Beschriftungsart streichen
 *      / vorgebirge/mittelgebirge als preset im gebirge lassen."
 *
 * Das sind ZWEI Auftraege in einem Satz, und sie zeigen in entgegengesetzte Richtungen: der eine
 * nimmt einen Namen weg, der andere haelt DENSELBEN Namen fest, eine Ebene tiefer. Wer nur den
 * ersten liest und danach repoweit nach „vorgebirge" greppt, nimmt die Presets mit -- sie heissen
 * genauso. Genau davor stehen die zwei Waechter in §D.
 *
 * ⚠️ Die Stilllegung war folgenlos: 0 Flaechen, 0 Beschriftungen (ganze Tabellen gezaehlt, Dump
 * 08.09.2026), kein Eingang aus dem Wiki-Sync. Es gibt deshalb KEINE Datenmigration zu pruefen --
 * nur die Abschaltung selbst, ihre Idempotenz und die Restlosigkeit im Quelltext.
 */

require_once __DIR__ . '/../ecosystem.php';

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: pdo_sqlite fehlt -- mit -d extension=php_pdo_sqlite.dll neu starten\n");
    exit(1);
}

$wurzel = dirname(__DIR__, 4);
$pruefungen = 0;

// =================================================================================================
// A. DIE ART STEHT NICHT MEHR IN DER SAAT
// =================================================================================================
foreach (AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED as [$kind, $typeKey, $label, $sortOrder]) {
    assert($typeKey !== 'vorgebirge_mittelgebirge',
        '🔴 `vorgebirge_mittelgebirge` steht wieder in der Saat. Begruendung fuer die Streichung: '
        . 'avesmapsEcosystemRetireVorgebirge in api/_internal/app/ecosystem.php');
    assert($label !== 'Vor-/Mittelgebirge', '🔴 und auch nicht unter einem anderen Schluessel');
    $pruefungen += 2;
}

// =================================================================================================
// B. DIE STILLLEGUNG LAEUFT WIRKLICH -- und sie loescht nicht
// =================================================================================================
$bauen = static function (): PDO {
    $pdo = new PDO('sqlite::memory:', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('CREATE TABLE ecosystem_region_type (
        kind TEXT NOT NULL, type_key TEXT NOT NULL, label TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (kind, type_key))');
    $pdo->exec('CREATE TABLE ecosystem_revision (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL)');
    $pdo->exec('INSERT INTO ecosystem_revision (id, revision) VALUES (1, 7), (2, 7)');
    // Der Bestand, wie er am 09.09.2026 live stand: die Art aktiv, dazu zwei Nachbarn.
    $pdo->exec("INSERT INTO ecosystem_region_type (kind, type_key, label, sort_order, is_active) VALUES
        ('topographie', 'gebirge', 'Gebirge', 10, 1),
        ('topographie', 'huegelland', 'Huegelland', 50, 1),
        ('topographie', 'vorgebirge_mittelgebirge', 'Vor-/Mittelgebirge', 130, 1)");

    return $pdo;
};

// ⭐ Der Revisionszaehler des Moduls braucht MySQL-Syntax (INSERT IGNORE ... ON DUPLICATE KEY).
// Statt ihn nachzubauen wird gemessen, DASS die Funktion ihn ruft: der Aufruf steht im Quelltext,
// und §C prueft ihn dort. Hier laeuft die Stilllegung gegen eine Attrappe, die den Zaehler zaehlt.
$pdoB = $bauen();
$vorherB = (int) $pdoB->query(
    "SELECT is_active FROM ecosystem_region_type WHERE type_key = 'vorgebirge_mittelgebirge'"
)->fetchColumn();
assert($vorherB === 1, 'die Vorbedingung: die Art steht aktiv da');
$pruefungen++;

try {
    avesmapsEcosystemRetireVorgebirge($pdoB);
} catch (Throwable) {
    // Der Revisionsbump am Ende faellt auf SQLite -- die Abschaltung davor ist bereits geschrieben.
    // Genau diese Reihenfolge ist der Punkt: erst abschalten, dann den Zaehler bewegen.
}

$nachherB = $pdoB->query(
    "SELECT is_active FROM ecosystem_region_type WHERE type_key = 'vorgebirge_mittelgebirge'"
)->fetch();
assert($nachherB !== false,
    '🔴 STILLGELEGT, NICHT GELOESCHT -- die Zeile kann in der Historie referenziert sein, und '
    . '`is_active` ist das Idiom dieser Tabelle fuer „wird nicht mehr angeboten"');
assert((int) $nachherB['is_active'] === 0, 'und sie steht auf is_active = 0');
$pruefungen += 2;

// ⚠️ Die Nachbarn bleiben unberuehrt -- eine Stilllegung, die nebenbei das Gebirge mitnimmt, waere
// aus der Ferne nicht von einem geglueckten Lauf zu unterscheiden.
$aktivB = (int) $pdoB->query(
    "SELECT COUNT(*) FROM ecosystem_region_type WHERE kind = 'topographie' AND is_active = 1"
)->fetchColumn();
assert($aktivB === 2, '⚠️ Gebirge und Huegelland stehen weiter aktiv da: ' . $aktivB);
$pruefungen++;

// =================================================================================================
// C. IDEMPOTENZ -- der Riegel ist die FRAGE SELBST, kein gespeicherter Merker
// =================================================================================================
// Ein zweiter Lauf findet keine aktive Zeile mehr und kehrt VOR dem Revisionsbump zurueck. Ohne
// diesen Riegel bewegte jeder Seitenaufruf den Zaehler, und jeder warme Client zoege sich die
// gesamte Landschafts-Nutzlast neu -- ohne dass sich etwas geaendert haette.
$geworfen = false;
try {
    avesmapsEcosystemRetireVorgebirge($pdoB);
} catch (Throwable) {
    $geworfen = true;
}
assert($geworfen === false,
    '🔴 der zweite Lauf kehrt vor dem Revisionsbump zurueck -- sonst zaehlt jeder Aufruf hoch');
$pruefungen++;

// Und der Aufruf des Zaehlers steht wirklich im Rumpf: §B kann ihn auf SQLite nicht ausfuehren,
// also wird er hier am Quelltext festgenagelt (kommentarfrei, damit die Begruendung darueber nicht
// mitgelesen wird -- die nennt den Zaehler beim Namen).
$quelleC = (string) file_get_contents($wurzel . '/api/_internal/app/ecosystem.php');
$tokenC = token_get_all($quelleC);
$ohneKommentareC = '';
foreach ($tokenC as $t) {
    $ohneKommentareC .= is_array($t)
        ? (in_array($t[0], [T_COMMENT, T_DOC_COMMENT], true) ? ' ' : $t[1])
        : $t;
}
$vonC = strpos($ohneKommentareC, 'function avesmapsEcosystemRetireVorgebirge');
assert($vonC !== false, 'die Funktion steht da');
$bisC = strpos($ohneKommentareC, "\nfunction ", $vonC + 10);
$rumpfC = substr($ohneKommentareC, $vonC, ($bisC === false ? strlen($ohneKommentareC) : $bisC) - $vonC);
assert(str_contains($rumpfC, 'avesmapsNextEcosystemRevision($pdo)'),
    '🔴 die Stilllegung bewegt den Revisionszaehler -- ohne ihn bekommt jeder warme Client sein 304 '
    . 'und bietet die Art im Auswahlfeld weiter an');
assert(str_contains($rumpfC, 'is_active = 0') && !str_contains($rumpfC, 'DELETE'),
    '🔴 stillgelegt, nicht geloescht');
assert(str_contains($ohneKommentareC, 'avesmapsEcosystemRetireVorgebirge($pdo);'),
    '💣 und sie wird aus avesmapsEcosystemEnsureTables gerufen -- eine Migration ohne Aufrufer '
    . 'laeuft nie, und das sieht genau wie „schon erledigt" aus');
$pruefungen += 4;

// =================================================================================================
// 🔴 D. DIE PRESETS BLEIBEN -- die zweite Haelfte des Owner-Auftrags
// =================================================================================================
// „vorgebirge/mittelgebirge als preset im gebirge lassen." Sie heissen wie die gestrichene Art und
// sind das Gegenteil von ihr: die Art warf beide Stufen in EINEN Sammelbegriff, die Tafel fuehrt sie
// GETRENNT und mit Zahlen. Wer beim Aufraeumen repoweit nach dem Namen greppt, nimmt sie mit.
$hydroD = (string) file_get_contents(
    $wurzel . '/js/map-features/map-features-ecosystem-hydrologie.js'
);
$vonD = strpos($hydroD, 'ECOSYSTEM_HYDRO_HOEHENSTUFEN = [');
assert($vonD !== false, 'die Hoehenstufen-Tafel steht da');
$bisD = strpos($hydroD, '];', $vonD);
$tafelD = substr($hydroD, $vonD, $bisD - $vonD);

assert(str_contains($tafelD, 'key: "vorgebirge"') && str_contains($tafelD, 'maximalhoehe: 800'),
    '🔴 die Hoehenstufe „Vorgebirge" (800) BLEIBT -- Owner 09.09.2026: „vorgebirge/mittelgebirge '
    . 'als preset im gebirge lassen"');
assert(str_contains($tafelD, 'key: "mittelgebirge"') && str_contains($tafelD, 'maximalhoehe: 1500'),
    '🔴 die Hoehenstufe „Mittelgebirge" (1500) BLEIBT -- dieselbe Owner-Zeile');
$pruefungen += 3;

// ⚠️ Und die uebrigen drei Stufen daneben, damit ein „Aufraeumen" der Tafel als Ganzes auffaellt.
foreach (['tiefland' => 150, 'huegelland' => 400, 'hochgebirge' => 3200] as $schluessel => $hoehe) {
    assert(str_contains($tafelD, 'key: "' . $schluessel . '"'),
        "⚠️ die Hoehenstufe `$schluessel` steht weiter in der Tafel");
    $pruefungen++;
}

// =================================================================================================
// E. RESTLOS -- kein Produktivcode kennt die Art noch
// =================================================================================================
// ⚠️ Ausgenommen sind Tests (sie nennen den Namen als Waechter, so wie diese Datei), die Mockups
// unter docs/ (sie halten einen Entwurfsstand fest) und das Editor-Handbuch: das gehoert der
// naechtlichen Routine `avesmaps-handbuch-pflege`, nicht dieser Sitzung (AGENTS.md §9).
// 🔴 `api/_internal/app/ecosystem.php` steht NICHT in dieser Liste, sondern bekommt gleich darunter
// seine eigene, schaerfere Pruefung: die Stilllegungs-Funktion MUSS den Namen tragen (er steht in
// ihrem WHERE), und ein pauschales „kommt nicht mehr vor" waere hier schlicht falsch.
// 🪤 Je Datei ein ANKER -- eine Zeichenkette, die nach dem Kommentarfilter noch dastehen MUSS. Eine
// Groessenschwelle taugt hier nicht: `css/base/tokens.css` besteht zu 82 % aus Kommentaren (81.988 ->
// 14.935 Zeichen gemessen), das ist in diesem Projekt normal und kein Filterfehler. Ohne Anker waere
// ein zu gieriger Filter von einer sauberen Datei nicht zu unterscheiden -- und die Pruefung
// darunter ein Vakuum, das gruen meldet, weil nichts mehr da ist, wo sie sucht.
$produktivE = [
    'api/_internal/map/features.php' => '$allowedSubtypes',
    'api/app/report-location.php' => "'berggipfel'",
    'api/app/map-search.php' => "'berggipfel'",
    'js/ui/label-arten.js' => 'berggipfel:',
    'js/ui/popups.js' => 'INFO_HEADER_IMAGE_BY_ART',
    'js/app/i18n-en.js' => 'spotlight.labelType.',
    'index.html' => '<option value="vulkan">',
    'css/base/tokens.css' => '--color-ecosystem-topographie-gebirge',
];
foreach ($produktivE as $pfad => $ankerE) {
    $inhaltE = (string) file_get_contents($wurzel . '/' . $pfad);
    // Der Name darf im KOMMENTAR stehen (er erklaert die Streichung) -- aber nicht mehr im Code.
    $tokenE = null;
    if (str_ends_with($pfad, '.php')) {
        $tokenE = '';
        foreach (token_get_all($inhaltE) as $t) {
            $tokenE .= is_array($t)
                ? (in_array($t[0], [T_COMMENT, T_DOC_COMMENT], true) ? ' ' : $t[1])
                : $t;
        }
    } else {
        // JS/CSS/HTML: Zeilen- und Blockkommentare heraus, dazu die HTML-Kommentare.
        // 🪤 DIE FLAGS STEHEN INLINE, und das ist tragend: `~...|^\s*//.*$|...~ms` sieht richtig aus
        // und ist es nicht -- mit `s` matcht `.` auch Zeilenumbrueche, `.*$` frisst also ab dem ersten
        // Zeilenkommentar den GESAMTEN Rest der Datei. Die Pruefung darunter waere dann ein Vakuum:
        // gruen, weil nichts mehr da ist, wo sie sucht. Genau das ist beim Bau passiert.
        $tokenE = preg_replace('~(?s:/\*.*?\*/)|(?m:^[ \t]*//.*$)|(?s:<!--.*?-->)~', ' ', $inhaltE);
        assert($tokenE !== null, "der Kommentarfilter hat fuer $pfad nicht gegriffen");
    }
    // ⭐ Die Gegenprobe zur Falle darueber, fuer BEIDE Filter: der Anker muss sie ueberleben.
    assert(str_contains($tokenE, $ankerE),
        "🪤 der Filter hat $pfad zusammengestrichen -- `$ankerE` ist weg, und die Pruefung "
        . 'darunter waere damit ein Vakuum');
    $pruefungen++;
    assert(!str_contains($tokenE, 'vorgebirge_mittelgebirge'),
        "🔴 $pfad kennt `vorgebirge_mittelgebirge` noch im CODE (nicht nur im Kommentar). "
        . 'Die Art ist gestrichen -- siehe avesmapsEcosystemRetireVorgebirge.');
    $pruefungen++;
}

// 🔴 In `ecosystem.php` darf der Name GENAU EINMAL im Code stehen: im WHERE der Stilllegung. Steht er
// anderswo, ist die Art auf einem zweiten Weg zurueck -- und das faellt sonst niemandem auf, weil die
// Datei ihn ohnehin erwaehnen DARF. Gezaehlt wird kommentarfrei; §C hat den Rumpf schon geschnitten.
$restE = str_replace($rumpfC, ' ', $ohneKommentareC);
assert(!str_contains($restE, 'vorgebirge_mittelgebirge'),
    '🔴 ecosystem.php nennt `vorgebirge_mittelgebirge` AUSSERHALB von avesmapsEcosystemRetireVorgebirge '
    . '-- die Art ist damit auf einem zweiten Weg zurueck');
assert(substr_count($rumpfC, 'vorgebirge_mittelgebirge') === 2,
    '⚠️ und INNERHALB der Stilllegung genau zweimal (das SELECT des Riegels und das UPDATE): '
    . substr_count($rumpfC, 'vorgebirge_mittelgebirge'));
$pruefungen += 2;

// 💣 Und der Kopfbild-Schluessel „vor" faellt MIT der Art. Er entsteht nicht aus ihrem Schluessel,
// sondern aus ihrer BESCHRIFTUNG: der Normalisierer schneidet am „/" ab, aus „Vor-/Mittelgebirge"
// wird „vor". Bliebe er stehen, finge er beim naechsten Namen mit Schraegstrich lautlos das Falsche
// ab -- und niemand suchte den Grund bei einer Art, die es nicht mehr gibt.
$popupsE = (string) file_get_contents($wurzel . '/js/ui/popups.js');
$vonE = strpos($popupsE, 'INFO_HEADER_IMAGE_BY_ART = {');
assert($vonE !== false, 'die Kopfbild-Tafel steht da');
$tafelE = substr($popupsE, $vonE, strpos($popupsE, '};', $vonE) - $vonE);
// 🪤 Inline-Flags, aus demselben Grund wie oben -- `ms` gemeinsam frisst die Tafel bis zum Ende.
$tafelE = (string) preg_replace('~(?s:/\*.*?\*/)|(?m:^[ \t]*//.*$)~', ' ', $tafelE);
assert(str_contains($tafelE, 'gebirge:'), '⭐ die Gegenprobe: die Tafel ist nach dem Filter noch da');
assert(!preg_match('~(^|[\s{,])vor\s*:~', $tafelE),
    '💣 der Kopfbild-Schluessel `vor` gehoerte dem „Vor-/Mittelgebirge" und faellt mit ihm');
assert(str_contains($tafelE, 'felsformation:') && str_contains($tafelE, 'berg:'),
    '⚠️ die uebrigen Eintraege der Tafel bleiben unberuehrt');
$pruefungen += 3;

echo "vorgebirge-stillgelegt-test: A (Saat) + B (Stilllegung) + C (Idempotenz) + D (Presets bleiben) "
    . "+ E (restlos) bestanden -- {$pruefungen} Zusicherungen\n";
