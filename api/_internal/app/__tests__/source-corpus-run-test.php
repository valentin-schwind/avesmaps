<?php

declare(strict_types=1);

/**
 * „Titel aus den Seiten holen" — die Regeln des Laufs.
 *
 * 🔴 SIE SIND AN ECHTEN DATEN GEMESSEN, nicht ausgedacht: docs/quellen-mapping-tabelle.html haelt
 * 133 Zeilen fest, jede Seite am 02.09.2026 wirklich abgerufen. Jede Ausnahme unten hat dort einen
 * Fall, und dieser Test faehrt genau diese Faelle.
 *
 * Fahren: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *             -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/source-corpus-run-test.php
 */

require_once __DIR__ . '/../../bootstrap.php';
require_once __DIR__ . '/../source-corpus-run.php';

$anzahl = 0;
$zaehl = static function () use (&$anzahl): void {
    $anzahl++;
};
$seite = static fn(string $titel, int $status = 200): array =>
    ['ok' => $titel !== '' || $status === 200, 'status' => $status, 'title' => $titel];

// ══ 1 · Der Normalfall ══════════════════════════════════════════════════════════════════════════

$u = 'https://westlande.de/albernia/index.php?title=Apfeldorn';
$r = avesmapsSourceTitleVerdict(['url' => $u, 'label' => 'Albernisches Briefspiel'], $seite('Apfeldorn'));
assert($r['aktion'] === 'ersetzen' && $r['titel'] === 'Apfeldorn',
    'ein Sammelname weicht dem Titel der Seite');
$zaehl();

// „fuellen" ist ein EIGENER Fall: 15 Zeilen hatten am 02.09.2026 gar keinen Titel, und dort gibt
// es nichts zu ersetzen -- die Oberflaeche soll das unterscheiden koennen.
$r = avesmapsSourceTitleVerdict(['url' => $u, 'label' => ''], $seite('Apfeldorn'));
assert($r['aktion'] === 'fuellen', 'eine leere Zeile wird GEFUELLT, nicht ersetzt');
$zaehl();

assert(avesmapsSourceTitleVerdict(['url' => $u, 'label' => 'Apfeldorn'], $seite('Apfeldorn'))['aktion'] === 'aussen',
    'was schon richtig steht, wird nicht angefasst');
$zaehl();

// ══ 2 · Die Startseite ══════════════════════════════════════════════════════════════════════════

// 💣 Hier macht der Lauf es SCHLECHTER: die Ueberschrift einer Wiki-Startseite heisst „Hauptseite".
$r = avesmapsSourceTitleVerdict(['url' => 'https://www.garetien.de', 'label' => 'Briefspiel (Garetien)'], $seite('Hauptseite'));
assert($r['aktion'] === 'aussen' && strpos($r['grund'], 'Startseite') === 0,
    'eine Startseite bleibt aussen vor -- „Hauptseite" sagt weniger als der heutige Name');
$zaehl();
assert(avesmapsSourceUrlIsStartPage('https://wiki.punin.de/') === true, 'mit Schraegstrich');
$zaehl();
assert(avesmapsSourceUrlIsStartPage('https://wiki.punin.de') === true, 'ohne Schraegstrich');
$zaehl();

// 💣 DIE FALLE, DIE MICH AM 02.09.2026 ERWISCHT HAT: nur den Pfad zu pruefen ist zu wenig.
// `herzogtum-weiden.net/?view=article&id=94:drachenstein` hat den Pfad „/" und IST ein Artikel --
// Joomla traegt die Seite in der ABFRAGE. Drei echte Artikel waeren so ausgenommen worden,
// darunter der eine, dessen Titel LEER war und der „Baronie Drachenstein" heisst.
$joomla = 'https://www.herzogtum-weiden.net/?view=article&id=94:drachenstein';
assert(avesmapsSourceUrlIsStartPage($joomla) === false,
    'eine Adresse mit Abfrage ist KEINE Startseite, auch wenn ihr Pfad leer ist');
$zaehl();
assert(avesmapsSourceTitleVerdict(['url' => $joomla, 'label' => ''], $seite('Baronie Drachenstein'))['aktion'] === 'fuellen',
    'und sie wird gefuellt statt ausgenommen');
$zaehl();

// ══ 3 · Der Anker ═══════════════════════════════════════════════════════════════════════════════

// 💣 Drei Adressen zeigten auf …Orbatal#Doggenried / #Botzenberg / #Steinau_in_den_Bergen -- drei
// verschiedene Orte, EIN <h1>. Ohne diese Regel truegen alle drei denselben Titel.
$anker = 'https://westlande.de/albernia/index.php?title=Die_wichtigsten_Siedlungen_in_Orbatal#Doggenried';
$r = avesmapsSourceTitleVerdict(['url' => $anker, 'label' => 'Albernisches Briefspiel'], $seite('Die wichtigsten Siedlungen in Orbatal'));
assert($r['aktion'] === 'aussen' && strpos($r['grund'], 'Anker') === 0,
    'eine Ankeradresse bleibt aussen vor -- die Sprungmarke ist genauer als die Ueberschrift');
$zaehl();
// ⚠️ Der gelesene Titel reist trotzdem mit: die Oberflaeche soll zeigen koennen, WAS sie verwirft.
assert($r['titel'] === 'Die wichtigsten Siedlungen in Orbatal', 'und nennt trotzdem, was dort steht');
$zaehl();

// ══ 4 · Wenn die Seite nichts hergibt ═══════════════════════════════════════════════════════════

$tot = avesmapsSourceTitleVerdict(['url' => 'https://www.garetien.de/index.php/Garetien:Retokuppe', 'label' => 'X'],
    ['ok' => false, 'status' => 404, 'title' => '']);
assert($tot['aktion'] === 'aussen' && strpos($tot['grund'], '404') !== false,
    'eine tote Adresse wird als solche benannt, nicht als „unveraendert" verschwiegen');
$zaehl();

// ⚠️ HTTP 200 OHNE Ueberschrift ist ein eigener Fall -- rommilyser-mark.de ist Joomla mit leerer
// <h1>, und ein JPG hat gar keine. Beides ist kein Fehler des Links.
$leer = avesmapsSourceTitleVerdict(['url' => 'https://www.westlande.de/kartenwerk/Albernia_Orte_extralarge.jpg', 'label' => 'X'],
    ['ok' => true, 'status' => 200, 'title' => '']);
assert($leer['aktion'] === 'aussen' && strpos($leer['grund'], 'Ueberschrift') !== false,
    'erreichbar, aber ohne Ueberschrift -- eigener Grund, nicht „tot"');
$zaehl();
assert($leer['grund'] !== $tot['grund'], 'und die zwei Gruende sind unterscheidbar');
$zaehl();

// 🔴 NIE einen leeren Titel schreiben. Ohne diesen Riegel loeschte der Lauf gute Titel, sobald
// eine Seite kurz nichts hergibt -- der schlimmste denkbare Ausgang.
foreach ([['ok' => true, 'status' => 200, 'title' => ''], ['ok' => false, 'status' => 500, 'title' => '']] as $fall) {
    assert(avesmapsSourceTitleVerdict(['url' => $u, 'label' => 'Guter Titel'], $fall)['aktion'] === 'aussen',
        'ein leerer Seitentitel loescht NIE einen vorhandenen');
}
$zaehl();

// ══ 5 · Das Schreiben ═══════════════════════════════════════════════════════════════════════════

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
avesmapsEnsureFeatureSourceTables($pdo);
$anlegen = $pdo->prepare('INSERT INTO sources (url, url_hash, label, source_type, is_official) VALUES (:u, :h, :l, "sonstiges", 0)');
$ids = [];
foreach (['Alt A' => 'https://westlande.de/a', 'Alt B' => 'https://westlande.de/b'] as $label => $adresse) {
    $anlegen->execute(['u' => $adresse, 'h' => hash('sha256', $adresse), 'l' => $label]);
    $ids[$label] = (int) $pdo->lastInsertId();
}

$erg = avesmapsSourceCorpusTitleApply($pdo, [
    ['source_id' => $ids['Alt A'], 'label' => 'Neu A', 'expect' => 'Alt A'],
    // 💣 Zwischen Vorschlag und Uebernahme koennen Minuten liegen. Wer die Zeile in der Zeit von
    // Hand richtiggestellt hat, darf nicht ueberschrieben werden -- `expect` passt dann nicht.
    ['source_id' => $ids['Alt B'], 'label' => 'Neu B', 'expect' => 'inzwischen anders'],
]);
assert($erg['applied'] === 1 && $erg['skipped'] === 1, 'nur die Zeile mit passendem Altstand wird geschrieben');
$zaehl();
$stand = [];
foreach ($pdo->query('SELECT id, label FROM sources') as $z) {
    $stand[(int) $z['id']] = (string) $z['label'];
}
assert($stand[$ids['Alt A']] === 'Neu A', 'die eine ist geaendert');
$zaehl();
assert($stand[$ids['Alt B']] === 'Alt B', 'die andere UNBERUEHRT -- die Handarbeit ueberlebt');
$zaehl();

// ⚠️ Und ein leerer Titel kommt gar nicht erst durch, egal was der Aufrufer schickt.
$leerSchreib = avesmapsSourceCorpusTitleApply($pdo, [['source_id' => $ids['Alt A'], 'label' => '   ', 'expect' => 'Neu A']]);
assert($leerSchreib['applied'] === 0, 'ein leerer Titel wird nicht geschrieben');
$zaehl();

// ══ 6 · Die Rechen-Haelfte fasst KEINE Nutztabelle an ═══════════════════════════════════════════

// 🔴 Dieselbe Regel wie bei jeder Uebernahme-Vorschau des Hauses (sync-plan-purity-test.php):
// wer vorschlaegt, schreibt nicht. Sonst waere schon das ANSEHEN ein Schreibvorgang.
$quelltext = (string) file_get_contents(__DIR__ . '/../source-corpus-run.php');
$ohneKommentare = preg_replace('#/\*[\s\S]*?\*/|^[ \t]*//.*$#m', '', $quelltext) ?? '';
$probeAb = strpos($ohneKommentare, 'function avesmapsSourceCorpusTitleProbe');
$applyAb = strpos($ohneKommentare, 'function avesmapsSourceCorpusTitleApply');
assert($probeAb !== false && $applyAb !== false && $applyAb > $probeAb, 'beide Haelften stehen da');
$zaehl();
$probeRumpf = substr($ohneKommentare, $probeAb, $applyAb - $probeAb);
assert(preg_match('/\b(INSERT|UPDATE|DELETE)\b/i', $probeRumpf) !== 1,
    'die Probe schreibt NICHTS -- kein INSERT, kein UPDATE, kein DELETE');
$zaehl();

// ⚠️ Und sie ist BEGRENZT: STRATO vertraegt keinen langen Lauf in einem Request, der Client treibt
// die Wiederholung (wie beim Linkchecker und beim Dump).
assert(AVESMAPS_SOURCE_TITLE_BATCH > 0 && AVESMAPS_SOURCE_TITLE_BATCH <= 20,
    'ein Schritt holt eine handhabbare Zahl Seiten');
$zaehl();
assert(strpos($probeRumpf, 'array_slice') !== false, 'und schneidet seinen Teil wirklich heraus');
$zaehl();

echo "OK — {$anzahl} Zusicherungen (Titel-Lauf: Regeln, Ausnahmen, Schreiben)\n";
