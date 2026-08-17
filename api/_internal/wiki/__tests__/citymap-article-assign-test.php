<?php

declare(strict_types=1);

/**
 * Der MASSENLAUF der Karten-Wikizuweisung: jede Karte bekommt die Wikiseite ihrer PUBLIKATION.
 * Lauf (aus dem Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll api/_internal/wiki/__tests__/citymap-article-assign-test.php
 * Exit 0 = alle Zusicherungen gehalten.
 *
 * 🔴 KEIN avesmapsCitymapsEnsureTables() -- dessen DDL ist MySQL samt information_schema. Genau
 * deshalb steht es beim AUFRUFER (api/edit/map/citymaps.php) und nicht in der Bibliothek; die
 * Fixture unten baut ihre `citymap`-Tabelle selbst, mit denselben Spalten.
 *
 * ⚠️ Die Fixture ist SYNTHETISCH, aber jede Zeile bildet eine am 17.08.2026 live gemessene Form ab
 * (Bericht: .superpowers/sdd/2026-08-15-wiki-zuweisung-vereinheitlichung/
 * nachlauf-kartenzuweisung-bericht.md). Echte Wiki-Titel in Massen gehoeren nicht ins Repo
 * (docs/repository-data-policy.md) -- die FORMEN sind, worauf es ankommt.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}
if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: pdo_sqlite fehlt -- mit -d extension=php_pdo_sqlite.dll starten.\n");
    exit(2);
}
if (!function_exists('mb_strtolower')) {
    fwrite(STDERR, "FATAL: mbstring fehlt -- mit -d extension=php_mbstring.dll starten.\n");
    exit(2);
}

// Die Laufzeit-Abhaengigkeiten, die sonst der Endpunkt laedt.
require_once __DIR__ . '/../../political/territory.php';   // avesmapsPoliticalSlug
require_once __DIR__ . '/../sync.php';                     // avesmapsWikiSyncPageUrl
require_once __DIR__ . '/../publication-sync.php';         // avesmapsWikiAventuricaPageTitleFromUrl
require_once __DIR__ . '/../citymap-article-assign.php';

// 🔴 Die zwei Herkunftswerte kommen aus api/_internal/app/citymaps.php -- dort steht die Spalte.
// Jene Datei zieht die halbe App nach; hier werden nur die Konstanten gebraucht, und sie werden
// NICHT abgeschrieben, sondern aus der Quelldatei gelesen. Weicht eine ab, faellt dieser Test um,
// statt gegen eine veraltete Kopie gruen zu bleiben.
$citymapsLib = file_get_contents(__DIR__ . '/../../app/citymaps.php');
preg_match("/const AVESMAPS_CITYMAP_ARTICLE_ORIGIN_PUBLICATION = '([^']+)'/", $citymapsLib, $mPub);
preg_match("/const AVESMAPS_CITYMAP_ARTICLE_ORIGIN_MANUAL = '([^']+)'/", $citymapsLib, $mMan);
assert(($mPub[1] ?? '') !== '', 'AVESMAPS_CITYMAP_ARTICLE_ORIGIN_PUBLICATION nicht in app/citymaps.php gefunden');
assert(($mMan[1] ?? '') !== '', 'AVESMAPS_CITYMAP_ARTICLE_ORIGIN_MANUAL nicht in app/citymaps.php gefunden');
define('AVESMAPS_CITYMAP_ARTICLE_ORIGIN_PUBLICATION', $mPub[1]);
define('AVESMAPS_CITYMAP_ARTICLE_ORIGIN_MANUAL', $mMan[1]);

const BASIS = 'https://de.wiki-aventurica.de/wiki/';

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 1. REIN: die Publikationsseite hinter einer map_url
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// Der Normalfall.
$treffer = avesmapsCitymapPublicationArticleFromMapUrl(BASIS . 'In%20den%20Dschungeln%20Meridianas');
assert($treffer !== null);
assert($treffer['title'] === 'In den Dschungeln Meridianas');
assert($treffer['key'] === avesmapsPoliticalSlug('In den Dschungeln Meridianas'));

// 💣 DIE ZUSICHERUNG, DIE DEN LIVE-BEFUND TRAEGT: `Die Helden des Schwarzen Auges (DSA3)` steht im
// Bestand in ZWEI Rohformen -- einmal mit Leerzeichen, einmal mit Unterstrichen. Beide MUESSEN auf
// EINEN Titel, EINEN Schluessel und EINE Adresse fallen, sonst bekommt eine Seite zwei
// `article_title` und der Konfliktzentrums-Schluessel zerfaellt.
$mitLeer = avesmapsCitymapPublicationArticleFromMapUrl(BASIS . 'Die%20Helden%20des%20Schwarzen%20Auges%20(DSA3)');
$mitUnter = avesmapsCitymapPublicationArticleFromMapUrl(BASIS . 'Die_Helden_des_Schwarzen_Auges_(DSA3)');
assert($mitLeer !== null && $mitUnter !== null);
assert($mitLeer['title'] === $mitUnter['title'], 'Unterstrich- und Leerzeichenform ergeben verschiedene Titel');
assert($mitLeer['url'] === $mitUnter['url'], 'Unterstrich- und Leerzeichenform ergeben verschiedene Adressen');
assert($mitLeer['key'] === $mitUnter['key'], 'Unterstrich- und Leerzeichenform ergeben verschiedene Schluessel');
assert($mitLeer['title'] === 'Die Helden des Schwarzen Auges (DSA3)');

// 🔴 Die Adresse kommt aus avesmapsWikiSyncPageUrl -- demselben Bauer, aus dem
// `wiki_sync_pages.wiki_url` entsteht. Eine Handzuweisung schreibt genau diese Form.
assert($treffer['url'] === avesmapsWikiSyncPageUrl('In den Dschungeln Meridianas'));

// Was KEINE Publikationsseite ist, ergibt null -- Fankarte, Shoplink, gar kein Link.
assert(avesmapsCitymapPublicationArticleFromMapUrl('https://www.deviantart.com/crumpled/art/2010-Malkillabad-462780391') === null);
assert(avesmapsCitymapPublicationArticleFromMapUrl('https://www.f-shop.de/search?sSearch=12002') === null);
assert(avesmapsCitymapPublicationArticleFromMapUrl('') === null);
// Ein Titel ohne ein einziges alphanumerisches Zeichen ergaebe einen leeren Schluessel.
assert(avesmapsCitymapPublicationArticleFromMapUrl(BASIS . '---') === null);
// ⚠️ Geprueft statt abgeschnitten: ein Titel ueber der Spaltenbreite gilt als nicht zuweisbar.
assert(avesmapsCitymapPublicationArticleFromMapUrl(BASIS . rawurlencode(str_repeat('Lang', 100))) === null);

echo "map_url -> Publikationsseite ok\n";

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 2. REIN: Teil 3 des Bauschluessels
// ═══════════════════════════════════════════════════════════════════════════════════════════════

assert(avesmapsCitymapWikiKeySourceSlug('stadtplanindex:al-anfa:al-anfa-und-der-tiefe-s-den:stadtplan')
    === 'al-anfa-und-der-tiefe-s-den');
// ⚠️ Alles, was nicht genau vier Teile hat, ist „unbekannt" -- und nimmt damit am Riegel nicht teil.
assert(avesmapsCitymapWikiKeySourceSlug('') === '');
assert(avesmapsCitymapWikiKeySourceSlug('kartenindex:titel:quelle') === '');
assert(avesmapsCitymapWikiKeySourceSlug('a:b:c:d:e') === '');

echo "Teil 3 ok\n";

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 3. Der Lauf gegen eine Fixture
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Baut eine frische Fixture-Datenbank. Jede Zeile bildet eine live gemessene Form ab. */
function fixture(): PDO
{
    $pdo = new PDO('sqlite::memory:', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('CREATE TABLE citymap (
        id INTEGER PRIMARY KEY, public_id TEXT, title TEXT, status TEXT, origin TEXT,
        wiki_key TEXT, map_url TEXT,
        article_url TEXT, article_key TEXT, article_title TEXT,
        article_origin TEXT NOT NULL DEFAULT \'manual\', no_article INTEGER NOT NULL DEFAULT 0
    )');
    $einfuegen = $pdo->prepare(
        'INSERT INTO citymap (id, public_id, title, status, origin, wiki_key, map_url,
                              article_url, article_key, article_title, no_article)
         VALUES (:id, :pid, :t, :st, :o, :wk, :mu, :au, :ak, :at, :na)'
    );
    $zeilen = [
        // 1+2: zwei Karten aus DERSELBEN Publikation -- der Regelfall (140 Seiten, 363 Karten).
        [1, 'Stadtplan von Al\'Anfa (In den Dschungeln Meridianas)', 'approved', 'wiki',
            'stadtplanindex:al-anfa:in-den-dschungeln-meridianas:stadtplan',
            BASIS . 'In%20den%20Dschungeln%20Meridianas', null, null, null, 0],
        [2, 'Umgebungskarte Al\'Anfa (In den Dschungeln Meridianas)', 'approved', 'wiki',
            'stadtplanindex:al-anfa:in-den-dschungeln-meridianas:umgebung',
            BASIS . 'In%20den%20Dschungeln%20Meridianas', null, null, null, 0],
        // 3: Fankarte auf DeviantArt -- keine Publikation, bleibt unberuehrt (125 live).
        [3, '2010 Malkillabad', 'approved', 'manual', '',
            'https://www.deviantart.com/crumpled/art/2010-Malkillabad-462780391', null, null, null, 0],
        // 4: wiki-geboren, aber die Quellenzelle war unaufloesbar -> gar kein map_url (41 live).
        [4, 'Stadtplan von Cumrat (HdR S.217)', 'approved', 'wiki',
            'stadtplanindex:cumrat:hdr-s-217:stadtplan', '', null, null, null, 0],
        // 5: traegt SCHON eine Zuweisung -- muss unberuehrt bleiben.
        [5, 'Stadtplan von Gareth (Herz des Reiches)', 'approved', 'wiki',
            'stadtplanindex:gareth:herz-des-reiches:stadtplan',
            BASIS . 'Herz%20des%20Reiches',
            'https://de.wiki-aventurica.de/wiki/Gareth', 'gareth', 'Gareth', 0],
        // 6: Merker „Kein Wiki-Artikel vorhanden" -- eine Entscheidung, die kein Lauf umstoesst.
        [6, 'Eigene Karte von Havena', 'approved', 'manual', '',
            BASIS . 'Die%20Siebenwindk%C3%BCste', null, null, null, 1],
        // 7: nicht freigegeben -- faellt schon durch den status-Filter.
        [7, 'Unterdrueckte Karte', 'suppressed', 'wiki',
            'kartenindex:x:am-grossen-fluss:regional', BASIS . 'Am%20Gro%C3%9Fen%20Fluss', null, null, null, 0],
        // 8: von Hand umgehaengtes map_url -- Teil 3 passt nicht mehr. ERLAUBT, weil origin='manual'
        //    (live: 22 solche Karten). Der Riegel darf davon NICHT ausloesen.
        [8, 'Handkarte', 'approved', 'manual',
            'stadtplanindex:ort:alte-quelle:stadtplan', BASIS . 'Am%20Gro%C3%9Fen%20Fluss', null, null, null, 0],
    ];
    foreach ($zeilen as [$id, $t, $st, $o, $wk, $mu, $au, $ak, $at, $na]) {
        $einfuegen->execute(['id' => $id, 'pid' => 'p' . $id, 't' => $t, 'st' => $st, 'o' => $o,
            'wk' => $wk, 'mu' => $mu, 'au' => $au, 'ak' => $ak, 'at' => $at, 'na' => $na]);
    }

    return $pdo;
}

// ── 3a. Die VORSCHAU zaehlt und schreibt NICHTS ──────────────────────────────────────────────
$pdo = fixture();
$vorschau = avesmapsCitymapAssignPublicationArticles($pdo, true);
assert($vorschau['dry_run'] === true);
assert($vorschau['total'] === 7, 'status=suppressed gehoert nicht in die Grundmenge'); // 8 Zeilen, 1 suppressed
assert($vorschau['citymaps_affected'] === 3, 'erwartet 1, 2, 8 — bekommen: ' . $vorschau['citymaps_affected']);
assert($vorschau['articles_linked'] === 2, 'zwei verschiedene Seiten (IdDM, Am Grossen Fluss)');
assert($vorschau['applied'] === 0, 'eine Vorschau darf NICHTS schreiben');
assert($vorschau['skipped']['already_assigned'] === 1);
assert($vorschau['skipped']['no_article_flag'] === 1);
assert($vorschau['skipped']['no_publication'] === 2, 'DeviantArt + leeres map_url');
// 💣 Und das ist die Zusicherung, die „schreibt nichts" wirklich prueft -- die Zahl `applied` ist
// nur eine Behauptung der Funktion ueber sich selbst. Hier wird die TABELLE gelesen.
$offen = (int) $pdo->query("SELECT COUNT(*) FROM citymap WHERE article_url IS NOT NULL AND article_url <> ''")->fetchColumn();
assert($offen === 1, 'nach der Vorschau darf nur die eine vorbelegte Zuweisung stehen, gezaehlt: ' . $offen);

echo "Vorschau ok\n";

// ── 3b. Der SCHARFE Lauf ─────────────────────────────────────────────────────────────────────
$pdo = fixture();
$lauf = avesmapsCitymapAssignPublicationArticles($pdo, false);
assert($lauf['dry_run'] === false);
assert($lauf['applied'] === 3, 'geschrieben: ' . $lauf['applied']);

$zeile1 = $pdo->query('SELECT * FROM citymap WHERE id = 1')->fetch();
assert($zeile1['article_title'] === 'In den Dschungeln Meridianas');
assert($zeile1['article_url'] === avesmapsWikiSyncPageUrl('In den Dschungeln Meridianas'));
assert($zeile1['article_key'] === avesmapsPoliticalSlug('In den Dschungeln Meridianas'));
// 🔴 DIE TRAGENDE ZUSICHERUNG: ohne diese Marke meldete das Konfliktzentrum 136 Gruppen.
assert($zeile1['article_origin'] === AVESMAPS_CITYMAP_ARTICLE_ORIGIN_PUBLICATION);

// ⚠️ Die vorhandene Zuweisung steht unveraendert -- der Lauf ERGAENZT, er ersetzt nicht.
$zeile5 = $pdo->query('SELECT * FROM citymap WHERE id = 5')->fetch();
assert($zeile5['article_url'] === 'https://de.wiki-aventurica.de/wiki/Gareth', 'eine vorhandene Zuweisung wurde ueberfahren');
assert($zeile5['article_title'] === 'Gareth');
assert($zeile5['article_origin'] === AVESMAPS_CITYMAP_ARTICLE_ORIGIN_MANUAL, 'die Herkunft einer fremden Zuweisung wurde umgeschrieben');

// ⚠️ Der Merker bleibt eine Entscheidung: Karte 6 haette eine Publikationsseite und wird trotzdem
// nicht angefasst.
$zeile6 = $pdo->query('SELECT * FROM citymap WHERE id = 6')->fetch();
assert(($zeile6['article_url'] ?? null) === null, 'no_article = 1 wurde ueberschrieben');

// Karte 3, 4 und 7 bleiben leer.
foreach ([3, 4, 7] as $id) {
    $zeile = $pdo->query('SELECT article_url FROM citymap WHERE id = ' . $id)->fetch();
    assert(($zeile['article_url'] ?? null) === null, "Karte {$id} haette leer bleiben muessen");
}

echo "scharfer Lauf ok\n";

// ── 3c. IDEMPOTENZ: ein zweiter Lauf schreibt nichts mehr ────────────────────────────────────
$zweiter = avesmapsCitymapAssignPublicationArticles($pdo, false);
assert($zweiter['applied'] === 0, 'ein zweiter Lauf hat erneut geschrieben: ' . $zweiter['applied']);
assert($zweiter['citymaps_affected'] === 0);
assert($zweiter['skipped']['already_assigned'] === 4, 'jetzt tragen 4 Karten eine Zuweisung');

echo "Idempotenz ok\n";

// ── 3d. DER RIEGEL ───────────────────────────────────────────────────────────────────────────
//
// 🔴 Teil 3 und map_url entstehen aus DEMSELBEN `$source`. Sie koennen nur auseinanderlaufen, wenn
// ein Mensch map_url von Hand geaendert hat -- dann ist die Karte `origin='manual'`. Eine Abweichung
// bei einer NICHT von Hand bearbeiteten Karte widerlegt diese Herleitung, und dann wird nicht
// geschrieben.

// Zuerst die Gegenprobe: die vorhandene handgesetzte Abweichung (Karte 8) loest NICHT aus.
$pdo = fixture();
$mitHand = avesmapsCitymapAssignPublicationArticles($pdo, true);
assert($mitHand['key_mismatch']['total'] === 1, 'die Handkarte weicht ab und muss gezaehlt werden');
assert($mitHand['key_mismatch']['unexplained'] === 0, 'origin=manual erklaert die Abweichung');

// Und jetzt dieselbe Abweichung an einer WIKI-Karte: der Lauf muss abbrechen.
$pdo = fixture();
$pdo->exec("UPDATE citymap SET origin = 'wiki' WHERE id = 8");
$geworfen = false;
try {
    avesmapsCitymapAssignPublicationArticles($pdo, true);
} catch (InvalidArgumentException $fehler) {
    $geworfen = true;
    // Die Zahl muss in der Meldung stehen -- sonst weiss der Owner nicht, wie gross der Schaden waere.
    assert(str_contains($fehler->getMessage(), '1'), 'die Meldung nennt die Zahl nicht');
}
assert($geworfen === true, 'der Riegel hat nicht ausgeloest');

// 💣 UND ER MUSS AUCH DEN SCHARFEN LAUF STOPPEN, nicht nur die Vorschau -- sonst waere er ein
// Hinweis statt eines Riegels.
$pdo = fixture();
$pdo->exec("UPDATE citymap SET origin = 'wiki' WHERE id = 8");
$geworfenScharf = false;
try {
    avesmapsCitymapAssignPublicationArticles($pdo, false);
} catch (InvalidArgumentException) {
    $geworfenScharf = true;
}
assert($geworfenScharf === true, 'der scharfe Lauf lief trotz gebrochener Annahme');
$geschrieben = (int) $pdo->query("SELECT COUNT(*) FROM citymap WHERE article_origin = '"
    . AVESMAPS_CITYMAP_ARTICLE_ORIGIN_PUBLICATION . "'")->fetchColumn();
assert($geschrieben === 0, 'trotz Abbruch wurden Zeilen geschrieben: ' . $geschrieben);

echo "Riegel ok\n";

// ── 3e. Das RENNEN: die Luecken-Pruefung steht in der WHERE-KLAUSEL, nicht nur in PHP ────────
//
// 💣 Zwischen Vorschau und scharfem Lauf liegt eine Rueckfrage — Zeit, in der ein zweiter Editor
// dieselbe Karte zuweisen kann. Die PHP-Schleife hat ihre Kandidatenliste da laengst gebaut; nur die
// WHERE-Klausel des UPDATE kann das noch auffangen. Ein Trigger stellt genau dieses Rennen nach:
// waehrend Karte 1 geschrieben wird, bekommt Karte 2 von „jemand anderem" eine Zuweisung.
// ⚠️ SQLite feuert Trigger nicht rekursiv (Vorgabe), das innere UPDATE loest also nichts weiter aus.
$pdo = fixture();
$pdo->exec("CREATE TRIGGER rennen AFTER UPDATE ON citymap WHEN NEW.id = 1
            BEGIN
              UPDATE citymap SET article_url = 'https://fremd.example/artikel',
                                 article_title = 'Fremd', article_key = 'fremd',
                                 article_origin = 'manual'
               WHERE id = 2;
            END");
$rennen = avesmapsCitymapAssignPublicationArticles($pdo, false);
assert($rennen['applied'] === 2, 'die dazwischengekommene Zuweisung wurde ueberfahren, geschrieben: ' . $rennen['applied']);
$zeile2 = $pdo->query('SELECT * FROM citymap WHERE id = 2')->fetch();
assert($zeile2['article_url'] === 'https://fremd.example/artikel', 'die fremde Zuweisung wurde ueberschrieben');
assert($zeile2['article_origin'] === AVESMAPS_CITYMAP_ARTICLE_ORIGIN_MANUAL, 'die fremde Herkunft wurde umgeschrieben');

echo "Rennen ok
";

// ── 3f. Der Konflikt-Detektor laesst wiki_publication aus ────────────────────────────────────
//
// 💣 DIE ZUSICHERUNG, DIE DEN GANZEN UMBAU TRAEGT — und sie prueft VERHALTEN, nicht Wortlaut: die
// WHERE-Klausel wird aus api/_internal/conflicts/rules.php HERAUSGELESEN und gegen die Fixture
// AUSGEFUEHRT. Faellt der Ausschluss dort heraus, liefert genau diese Abfrage hier drei Karten mehr
// — und ohne ihn meldete das Konfliktzentrum live 136 Gruppen mit 482 Objekten.
// ⚠️ Herausgelesen statt abgeschrieben: eine Kopie der Klausel im Test waere die zweite Wahrheit,
// die still weitergruent, waehrend die Produktion schon etwas anderes tut.
$regeln = file_get_contents(__DIR__ . '/../../conflicts/rules.php');
preg_match(
    '/"(SELECT public_id, title, article_url FROM citymap\s+WHERE.*?)"/s',
    $regeln,
    $mSql
);
assert(($mSql[1] ?? '') !== '', 'die Abfrage aus avesmapsConflictLoadCitymapRows wurde nicht gefunden — Muster nachziehen');

$pdo = fixture();
avesmapsCitymapAssignPublicationArticles($pdo, false);
$konfliktZeilen = $pdo->query($mSql[1])->fetchAll();
// Nur die von HAND zugewiesene Karte 5 bleibt im Blick — die drei frisch verknuepften nicht.
assert(count($konfliktZeilen) === 1, 'im Konfliktzentrum stehen ' . count($konfliktZeilen) . ' statt 1 Karte');
assert($konfliktZeilen[0]['public_id'] === 'p5');

// ⚠️ UND DER `IS NULL`-ZWEIG — als das, was er ist: VORSORGE, kein heutiger Fall. Die Spalte ist
// `NOT NULL DEFAULT 'manual'`, ein NULL kann dort gar nicht stehen (die Fixture oben lehnt es
// entsprechend ab). Geprueft wird deshalb gegen ein AUSDRUECKLICH nullable Schema — genau die Lage,
// gegen die der Zweig versichert: ohne ihn faellt dann JEDE Karte aus der Konfliktliste, auch die
// von Hand zugewiesene, und niemand bemerkt einen stillen Totalausfall.
$nullbar = new PDO('sqlite::memory:', null, null, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
]);
$nullbar->exec('CREATE TABLE citymap (
    id INTEGER PRIMARY KEY, public_id TEXT, title TEXT, status TEXT,
    article_url TEXT, article_origin TEXT NULL
)');
$nullbar->exec("INSERT INTO citymap (id, public_id, title, status, article_url, article_origin)
                VALUES (1, 'p1', 'Handkarte', 'approved', 'https://de.wiki-aventurica.de/wiki/Gareth', NULL)");
$mitNull = $nullbar->query($mSql[1])->fetchAll();
assert(count($mitNull) === 1, 'bei nullbarer Herkunft verschwindet die Handzuweisung aus der Konfliktliste');

echo "Konflikt-Ausschluss ok
";
echo "ALLE ZUSICHERUNGEN GEHALTEN
";
