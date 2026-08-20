<?php

declare(strict_types=1);

/**
 * Die KARTEN in der Kollisionsprüfung (Aufgabe 9 der Wiki-Zuweisung, Entwurf
 * docs/superpowers/specs/2026-08-15-wiki-zuweisung-vereinheitlichung-design.md §8).
 *
 * 🔴 SIE LÄUFT GEGEN EINE ECHTE DATENBANK, und das ist hier der ganze Punkt: der Fehler, den sie
 * fangen soll, sitzt im ABFRAGETEXT von avesmapsConflictLoadCitymapRows -- in der Spalte, die dort
 * steht. `citymap` führt DREI Spalten, die nach „wiki" aussehen, und genau zwei davon wären falsch:
 *
 *   `wiki_key`    BAUSCHLÜSSEL `index:stadt:quelle:variante` -- keine Seitenidentität.
 *   `map_url`     der Karten-Link; bei einer Wiki-Karte die PUBLIKATION, in der die Karte steckt.
 *   `article_url` DER EIGENE ARTIKEL der Karte. Nur er gehört in die Kollisionsprüfung.
 *
 * Eine Probe, die die Zeilen fertig hereinreicht, bliebe grün, egal welche der drei die Abfrage
 * liest. Eine In-Memory-SQLite ist das Kleinste, was den ECHTEN Abfragetext ausführt -- dasselbe
 * Muster wie __tests__/conflict-keeper-test.php.
 *
 * Lauf (Windows), aus der Wurzel:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll api/_internal/conflicts/__tests__/conflict-citymap-test.php
 *
 * DIE ZWEI FÄLLE AUS DEM AUFTRAG:
 *   A) Eine Karte und ein Ort auf DEMSELBEN Artikel  => EIN Fall, zwei Parteien.
 *   B) Eine Karte mit Bauschlüssel und OHNE eigenen Artikel => KEIN Fall.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1' -- "
        . "assert() waere wirkungslos und diese Probe meldete falsches Gruen.\n");
    exit(2);
}
if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: pdo_sqlite ist nicht geladen -- erneut mit -d extension=php_pdo_sqlite.dll starten\n");
    exit(2);
}

require __DIR__ . '/../rules.php';

$pruefungen = 0;
$pruef = static function (bool $bedingung, string $meldung) use (&$pruefungen): void {
    $pruefungen++;
    assert($bedingung, $meldung);
};

const ART_GARETH = 'https://de.wiki-aventurica.de/wiki/Gareth';
const ART_FLUCH = 'https://de.wiki-aventurica.de/wiki/Der_Fluch_des_Hexers';

// ⚠️ NICHT die echte DDL: die ist MySQL. Die Spaltennamen sind dieselben -- daran hängt der Beweis.
$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec(
    'CREATE TABLE citymap (
        public_id TEXT NOT NULL,
        title TEXT NOT NULL,
        wiki_key TEXT NULL,
        map_url TEXT NOT NULL DEFAULT "",
        article_url TEXT NULL,
        article_key TEXT NULL,
        article_title TEXT NULL,
        -- WOHER der Artikel stammt (Nachlauf 17.08.2026). Dieselbe Vorgabe wie in der echten DDL
        -- (NOT NULL, Vorgabe manual): was es vor der Spalte gab, war von Hand gesetzt.
        article_origin TEXT NOT NULL DEFAULT "manual",
        no_article INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT "approved"
     )'
);
$karte = $pdo->prepare(
    'INSERT INTO citymap (public_id, title, wiki_key, map_url, article_url, article_key, article_title, article_origin, no_article, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
);
// (1) DIE KARTE MIT EIGENEM ARTIKEL. Sie trägt gleichzeitig einen Bauschlüssel UND eine map_url auf
//     die Publikation -- alle drei Spalten sind gefüllt, und nur eine davon ist die richtige.
$karte->execute(['C-GARETH', 'Stadtplan von Gareth (Der Fluch des Hexers)',
    'stadtplan:gareth:der-fluch-des-hexers:farbe', ART_FLUCH, ART_GARETH, 'gareth', 'Gareth', 'manual', 0, 'approved']);
// (2) 🔴 DIE KARTE OHNE EIGENEN ARTIKEL -- Fall B des Auftrags. Bauschlüssel ja, map_url ja, Artikel
//     nein. 💣 Ihre `map_url` zeigt AUF DENSELBEN ARTIKEL wie der Ort unten: läse die Abfrage `map_url`,
//     stünde hier ein Fall, den es nicht gibt.
$karte->execute(['C-OHNE', 'Stadtplan von Gareth (s/w)',
    'stadtplan:gareth:der-fluch-des-hexers:sw', ART_GARETH, null, null, null, 'manual', 0, 'approved']);
// (3) Eine von uns gezeichnete Karte mit dem dritten Zustand -- ebenfalls kein Anspruch.
$karte->execute(['C-EIGEN', 'Eigener Plan von Warunk', null, '', null, null, null, 'manual', 1, 'approved']);
// (4) Eine VERBORGENE Karte mit Artikel: für den Leser nicht da, also auch keine Kollision.
$karte->execute(['C-VERBORGEN', 'Alter Plan von Gareth', null, '', ART_GARETH, 'gareth', 'Gareth', 'manual', 0, 'suppressed']);
// (5) 🔴 DIE KARTE AUS DEM MASSENLAUF (17.08.2026): ihr `article_url` ist die Seite der PUBLIKATION,
//     in der sie abgedruckt ist -- nicht ihr eigener Artikel. Sie beansprucht die Seite also gar
//     nicht und gehoert NICHT in die Kollisionspruefung.
//     💣 OHNE diesen Ausschluss meldete das Konfliktzentrum live 136 Gruppen mit 482 Objekten (363
//     Karten auf 140 Publikationsseiten, 123 davon gemischt mit dem Literaturwerk, das denselben
//     Artikel traegt) -- die schwerste Kategorie, geflutet an einem Tag. Ihre `article_url` zeigt
//     hier bewusst AUF DENSELBEN Artikel wie Karte (1) und der Ort unten: faellt der Ausschluss,
//     steht sofort ein Fall mehr da.
$karte->execute(['C-PUBLIKATION', 'Stadtplan von Gareth (Massenlauf)', null, '',
    ART_GARETH, 'gareth', 'Gareth', 'wiki_publication', 0, 'approved']);

// ── 1) DER LADER LIEST `article_url`, UND NUR SIE ────────────────────────────────────────────
$zeilen = avesmapsConflictLoadCitymapRows($pdo);
$pruef(count($zeilen) === 1,
    'der Lader liefert ' . count($zeilen) . ' statt einer Zeile -- er liest die falsche Spalte oder '
    . 'vergisst einen Filter: ' . json_encode($zeilen, JSON_UNESCAPED_UNICODE));
$pruef($zeilen[0]['id'] === 'C-GARETH', 'der Lader liefert die falsche Karte: ' . $zeilen[0]['id']);
$pruef($zeilen[0]['wiki_url'] === ART_GARETH,
    'der Anspruch der Karte ist nicht ihr eigener Artikel: ' . $zeilen[0]['wiki_url']);
$pruef($zeilen[0]['type'] === 'citymap', 'die Partei traegt den falschen Typ: ' . $zeilen[0]['type']);
$pruef($zeilen[0]['label'] === 'Stadtplan von Gareth (Der Fluch des Hexers)', 'der Titel fehlt in der Partei');
// ⚠️ Keine Position: eine Karte liegt nirgends auf der Karte -- „Auf der Karte zeigen" entfaellt.
$pruef($zeilen[0]['position'] === null, 'die Karte behauptet eine Position auf der Karte');
// 🔴 Und sie ist NICHT aus dem Konfliktzentrum loesbar (`unlinkable` haengt an claim_source ===
// 'wiki_url'): geloest wird im Karten-Editor, wie bei Territorium und Literatur.
$pruef($zeilen[0]['claim_source'] === 'citymap', 'die Herkunft des Anspruchs ist falsch benannt');

// ── 1b) 🔴 UND DIE ZUWEISUNG AUS DEM MASSENLAUF BLEIBT DRAUSSEN ──────────────────────────────
// Sie steht in der Fixture als Karte (5) mit demselben Artikel wie (1). Waere sie dabei, lieferte
// der Lader zwei Zeilen -- die Zusicherung oben faellt dann schon. Hier wird ausdruecklich
// nachgesehen, DASS es die richtige ist, statt sich auf die blosse Anzahl zu verlassen.
$pruef(
    !in_array('C-PUBLIKATION', array_column($zeilen, 'id'), true),
    'eine Zuweisung mit article_origin = wiki_publication steht in der Kollisionspruefung -- '
    . 'das flutet sie mit der Publikation jeder Karte'
);

// ── 2) 💣 UND DER TYP STEHT IM SCHILD -- sonst stuende „citymap" auf dem Bildschirm ──────────
$pruef((AVESMAPS_CONFLICT_TYPE_LABELS['citymap'] ?? '') === 'Karte',
    'die Objektart „citymap" hat kein deutsches Schild');

// ── 3) FALL A: EINE KARTE UND EIN ORT AUF DEMSELBEN ARTIKEL => EIN FALL ──────────────────────
$ort = [
    'type' => 'location', 'id' => 'L-GARETH', 'label' => 'Gareth', 'subtype' => 'metropole',
    'wiki_url' => ART_GARETH, 'position' => ['lat' => 500.0, 'lng' => 500.0], 'claim_source' => 'wiki_url',
];
$faelle = avesmapsConflictRuleSharedArticle(array_merge([$ort], $zeilen));
$pruef(count($faelle) === 1,
    'aus Karte + Ort auf einem Artikel werden ' . count($faelle) . ' Faelle statt genau einem');
$pruef(count($faelle[0]['parties']) === 2, 'der Fall hat nicht genau zwei Parteien');
$typen = array_map(static fn(array $p): string => $p['type'], $faelle[0]['parties']);
sort($typen);
$pruef($typen === ['citymap', 'location'],
    'die Parteien sind nicht Karte und Ort: ' . implode(' | ', $typen));
$schilder = array_map(static fn(array $p): string => $p['type_label'], $faelle[0]['parties']);
$pruef(in_array('Karte', $schilder, true), 'die Karte erscheint ohne ihr Schild: ' . implode(' | ', $schilder));

// ── 4) FALL B: EINE KARTE MIT BAUSCHLUESSEL UND OHNE ARTIKEL => KEIN FALL ────────────────────
// 💣 Die Grundmenge wird eigens geleert. Eine Probe, die den Fall-A-Bestand stehen liesse, bewiese
// nichts: dort steht ohnehin ein Fall, und „es gibt keinen zweiten" ist eine andere Aussage.
$nurOhne = array_values(array_filter($zeilen, static fn(array $z): bool => $z['id'] === 'C-OHNE'));
$pruef($nurOhne === [], 'die Karte ohne eigenen Artikel ist ueberhaupt im Lader gelandet');
$pruef(avesmapsConflictRuleSharedArticle([$ort]) === [],
    'ein Ort allein erzeugt einen Fall -- dann bewiese Fall A nichts');

// ── 5) 🔴 DER BAUSCHLUESSEL IST KEIN ANSPRUCH ────────────────────────────────────────────────
// Zwei Karten teilen sich denselben Bauschluessel-Stamm und dieselbe Publikation. Waere eine der
// beiden Spalten der Anspruch, staende hier ein Fall.
$pruef(count(avesmapsConflictLoadCitymapRows($pdo)) === 1,
    'der Bauschluessel oder die Publikation erzeugen einen zweiten Anspruch');

// ── 6) EINE FEHLENDE SPALTE REISST DIE LISTE NICHT MIT ───────────────────────────────────────
// Genau der Zustand einer Installation, deren self-healing ALTER noch nicht gelaufen ist.
$alt = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$alt->exec('CREATE TABLE citymap (public_id TEXT, title TEXT, status TEXT)');
$pruef(avesmapsConflictLoadCitymapRows($alt) === [], 'eine fehlende Spalte wirft statt leer zu liefern');
// Und eine ganz fehlende Tabelle ebenso wenig.
$leer = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pruef(avesmapsConflictLoadCitymapRows($leer) === [], 'eine fehlende Tabelle wirft statt leer zu liefern');

// ── 7) 🔴 DER LADER IST AUCH WIRKLICH ANGESCHLOSSEN ──────────────────────────────────────────
// 💣 OHNE DIESE ZUSICHERUNG PRUEFT DIE GANZE DATEI EINE FUNKTION, DIE NIEMAND RUFT. Alles darueber
// ruft `avesmapsConflictLoadCitymapRows` selbst auf; ob `avesmapsConflictDetectAll` sie in seine
// `$claimRows` mischt, stuende nirgends -- und genau das ist die eine Zeile, die man beim Bauen
// vergisst. Eine Textprobe („im Quelltext kommt der Name vor") maesse die FORM des Codes; hier
// laeuft der ECHTE Sammellauf.
// ⚠️ Dafuer braucht er `map_features` (avesmapsConflictLoadMapRows hat als einziger Lader KEIN
// try/catch -- ohne die Tabelle waere der Lauf gar nicht erreichbar). Die uebrigen Tabellen fehlen
// absichtlich: ihre Lader fangen das ab, und so bleibt uebrig, was diese Probe messen will.
$gesamt = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$gesamt->exec(
    // ⚠️ `updated_at` gehoert dazu, seit avesmapsConflictLoadLabelRows es liest (Regel
    // label.duplicate, 20.08.2026): die Beteiligten eines Dubletten-Falls sehen einander sonst zum
    // Verwechseln aehnlich. In `sql/schema.sql` ist die Spalte NOT NULL, die Fixture war also
    // schlicht unvollstaendig -- ohne sie bricht dieser Lauf mit "no such column".
    'CREATE TABLE map_features (
        public_id TEXT NOT NULL, name TEXT NOT NULL, feature_type TEXT NOT NULL,
        feature_subtype TEXT NOT NULL DEFAULT "", properties_json TEXT NOT NULL DEFAULT "{}",
        geometry_json TEXT NULL, is_active INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT ""
     )'
);
$gesamt->prepare(
    'INSERT INTO map_features (public_id, name, feature_type, feature_subtype, properties_json, geometry_json)
     VALUES (?, ?, ?, ?, ?, ?)'
)->execute(['L-GARETH', 'Gareth', 'location', 'metropole',
    json_encode(['wiki_url' => ART_GARETH]), json_encode(['coordinates' => [500.0, 500.0]])]);
$gesamt->exec(
    'CREATE TABLE citymap (
        public_id TEXT NOT NULL, title TEXT NOT NULL, wiki_key TEXT NULL,
        map_url TEXT NOT NULL DEFAULT "", article_url TEXT NULL, article_key TEXT NULL,
        article_title TEXT NULL, article_origin TEXT NOT NULL DEFAULT "manual",
        no_article INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT "approved"
     )'
);
$gesamt->prepare('INSERT INTO citymap (public_id, title, wiki_key, map_url, article_url, status) VALUES (?, ?, ?, ?, ?, ?)')
    ->execute(['C-GARETH', 'Stadtplan von Gareth (Der Fluch des Hexers)',
        'stadtplan:gareth:der-fluch-des-hexers:farbe', ART_FLUCH, ART_GARETH, 'approved']);

$gesamtFaelle = avesmapsConflictDetectAll($gesamt);
$geteilt = array_values(array_filter(
    $gesamtFaelle,
    static fn(array $fall): bool => $fall['rule_id'] === 'wiki.shared_article'
));
$pruef(count($geteilt) === 1,
    'der Sammellauf findet ' . count($geteilt) . ' Kollisionen statt einer -- der Karten-Lader haengt '
    . 'nicht in avesmapsConflictDetectAll');
$gesamtTypen = array_map(static fn(array $p): string => $p['type'], $geteilt[0]['parties']);
sort($gesamtTypen);
$pruef($gesamtTypen === ['citymap', 'location'],
    'die Karte fehlt im Sammellauf: ' . implode(' | ', $gesamtTypen));
// 🔴 UND SIE STEHT NICHT AUF DER BEOBACHTUNGSLISTE. Eine Karte OHNE Artikel ist kein Befund -- die
// weit ueberwiegende Mehrheit ist von uns gezeichnet. Stuenden die Karten in `$rows` statt in
// `$claimRows`, waeren es live mehrere hundert Zeilen „kein Wiki-Schluessel".
$gesamt->prepare('INSERT INTO citymap (public_id, title, wiki_key, map_url, article_url, status) VALUES (?, ?, ?, ?, ?, ?)')
    ->execute(['C-OHNE', 'Eigener Plan von Warunk', null, '', null, 'approved']);
$beobachtung = array_values(array_filter(
    avesmapsConflictDetectAll($gesamt),
    static fn(array $fall): bool => $fall['rule_id'] === 'wiki.missing_key'
));
$pruef(array_filter($beobachtung, static fn(array $f): bool => $f['subject_type'] === 'citymap') === [],
    'eine Karte ohne Artikel steht auf der Beobachtungsliste -- dort gehoert sie nicht hin');

echo 'conflict-citymap: ' . $pruefungen . " Zusicherungen erfuellt\n";
