<?php

declare(strict_types=1);

// „innerhalb" -- die Regelsprache der Vorkommen, umgestellt am 19.08.2026.
//
// Eine Regelzeile liest sich seither als Enthaltensein-Satz mit drei weglassbaren Teilen:
//     [Landschaftsart] innerhalb von [Flaeche] innerhalb von [Klimazone]
// Vorher hiess dieselbe Zeile „ist DIESE EINE Flaeche = Mittelaventurien UND ist sie selbst ein
// Gebirge?" -- eine Frage, die keine Flaeche je bejahen kann (eine ecosystem_region hat genau ein
// kind und einen region_type). Live gemessen: 0 Flaechen, waehrend derselbe Satz fuer Siedlungen
// 124 Treffer lieferte, weil der Siedlungszweig Art und Ort UNABHAENGIG prueft.
//
// 🔴 „innerhalb" ist die VORHANDENE Zuordnung aus „Zugehoerigkeit rechnen"
// (`ecosystem_region_overlap`, Anteil >= 10 %), nie eine zweite Geometrierechnung -- siehe
// .superpowers/sdd/2026-08-15-wiki-zuweisung-vereinheitlichung/regelsprache-innerhalb-bericht.md
// fuer die Messung (929 Regionen, 6.188 Zeilen, 14,2 s wenn man es je Anfrage neu rechnete).

require_once __DIR__ . '/../lore-rule.php';
require_once __DIR__ . '/../lore-rule-store.php';
require_once __DIR__ . '/../lore-rule-match.php';

$zones = ['polar', 'subpolar', 'boreal', 'gemaessigt', 'subtropen_winterfeucht',
    'trockene_subtropen', 'subtropisch', 'tropisch'];
$term = static fn (array $o = []): array => array_merge(
    ['area_public_id' => null, 'types' => [], 'climate_from' => null, 'climate_to' => null, 'join_op' => 'und'],
    $o
);
$GEBIRGE = [['kind' => 'topographie', 'region_type' => 'gebirge']];
$WALD = [['kind' => 'vegetation', 'region_type' => 'wald']];

// Der Abnahmefall des Owners, verkleinert: Mittelaventurien enthaelt die Koschberge, nicht das
// Khoramgebirge (live 1,1 % -- unter der Schwelle, also gar keine Zeile).
$mittelaventurien = ['public_id' => 'mav', 'kind' => 'derographisch', 'region_type' => 'region',
    'zones' => ['gemaessigt'], 'container_public_ids' => []];
$koschberge = ['public_id' => 'kosch', 'kind' => 'topographie', 'region_type' => 'gebirge',
    'zones' => ['gemaessigt'], 'container_public_ids' => ['mav']];
$khoram = ['public_id' => 'khoram', 'kind' => 'topographie', 'region_type' => 'gebirge',
    'zones' => ['tropisch'], 'container_public_ids' => []];
$farindel = ['public_id' => 'farindel', 'kind' => 'vegetation', 'region_type' => 'wald',
    'zones' => ['gemaessigt'], 'container_public_ids' => ['mav']];

// --- A. Art + Flaeche = „innerhalb" ---------------------------------------------------------
// Der Fall, der die Umstellung ausgeloest hat. Vor dem 19.08.2026 war die linke Seite false,
// weil die Koschberge nicht „Mittelaventurien heissen".
$gebirgeInMav = $term(['area_public_id' => 'mav', 'types' => $GEBIRGE]);
assert(avesmapsLoreRuleTermMatchesArea($gebirgeInMav, $koschberge, $zones) === true,
    'die Koschberge sind ein Gebirge UND liegen in Mittelaventurien');
assert(avesmapsLoreRuleTermMatchesArea($gebirgeInMav, $khoram, $zones) === false,
    'das Khoramgebirge ist ein Gebirge, liegt aber nicht drin');
assert(avesmapsLoreRuleTermMatchesArea($gebirgeInMav, $farindel, $zones) === false,
    'der Farindel liegt drin, ist aber kein Gebirge');
assert(avesmapsLoreRuleTermMatchesArea($gebirgeInMav, $mittelaventurien, $zones) === false,
    'Mittelaventurien liegt in sich selbst, ist aber kein Gebirge');

// --- B. „liegt in" ist REFLEXIV ---------------------------------------------------------------
// 💣 Ohne die Reflexivitaet verloere „Wald innerhalb des Farindelwald" ausgerechnet den
// Farindelwald -- und niemand kaeme darauf, dass genau das die Ursache ist.
$waldImFarindel = $term(['area_public_id' => 'farindel', 'types' => $WALD]);
assert(avesmapsLoreRuleTermMatchesArea($waldImFarindel, $farindel, $zones) === true,
    'eine Flaeche liegt in sich selbst');
assert(avesmapsLoreRuleFlaecheLiegtIn($farindel, 'farindel') === true);
assert(avesmapsLoreRuleFlaecheLiegtIn($farindel, 'mav') === true);
assert(avesmapsLoreRuleFlaecheLiegtIn($farindel, 'khoram') === false);
// Fehlt der Schluessel ganz, ist die Flaeche in nichts ausser sich selbst -- der sichere Ausgang.
assert(avesmapsLoreRuleFlaecheLiegtIn(['public_id' => 'x'], 'mav') === false,
    'ohne container_public_ids liegt eine Flaeche nirgends, nie ueberall');

// --- C. Art LEER + Flaeche gesetzt = die Flaeche SELBST, nicht alles darin ---------------------
// 🔴 Owner 18.08.2026: „ist die landschaftsart leer gilt der Flaechenname". Das ist zugleich der
// Riegel, der bestehende Regeln stehen laesst: eine Regel, die nur eine Flaeche nennt, spraenge
// sonst von 1 auf bis zu 647 Treffer (so viele Regionen liegen live in Aventurien) -- ohne dass
// jemand sie angefasst haette. Live betroffen waere „Alveranie".
$nurMav = $term(['area_public_id' => 'mav']);
assert(avesmapsLoreRuleTermMatchesArea($nurMav, $mittelaventurien, $zones) === true);
assert(avesmapsLoreRuleTermMatchesArea($nurMav, $koschberge, $zones) === false,
    'ohne Art nennt die Bedingung einen ORT, keine Auswahl -- die Koschberge sind nicht gemeint');
assert(avesmapsLoreRuleTermMatchesArea($nurMav, $farindel, $zones) === false);

// --- D. Flaeche LEER + Art gesetzt = alle dieser Art, ueberall ---------------------------------
// „ist der Flaechennamen leer gelten alle landschaftsarten" -- die Form der Live-Regel „Alprute".
$alleGebirge = $term(['types' => $GEBIRGE]);
assert(avesmapsLoreRuleTermMatchesArea($alleGebirge, $koschberge, $zones) === true);
assert(avesmapsLoreRuleTermMatchesArea($alleGebirge, $khoram, $zones) === true,
    'ohne Flaeche schraenkt nichts ein -- auch das Khoramgebirge zaehlt');
assert(avesmapsLoreRuleTermMatchesArea($alleGebirge, $farindel, $zones) === false);

// --- E. Der Klimateil wirkt weiter ZUSAETZLICH -------------------------------------------------
// Die Form der Live-Regel „Vierblaettrige Einbeere". Sie darf sich durch „innerhalb" nicht
// veraendern (am Livebestand gemessen: 70 Treffer bei 5 %, 68 bei 90 % -- praktisch unbewegt).
$gebirgeInMavTropisch = $term(['area_public_id' => 'mav', 'types' => $GEBIRGE,
    'climate_from' => 'tropisch', 'climate_to' => 'tropisch']);
assert(avesmapsLoreRuleTermMatchesArea($gebirgeInMavTropisch, $koschberge, $zones) === false,
    'die Koschberge liegen drin und sind ein Gebirge -- aber nicht in den Tropen');
$waldGemaessigt = $term(['types' => $WALD, 'climate_from' => 'boreal', 'climate_to' => 'gemaessigt']);
assert(avesmapsLoreRuleTermMatchesArea($waldGemaessigt, $farindel, $zones) === true);

// --- F. Der Siedlungszweig sagt DASSELBE wie der Flaechenzweig ---------------------------------
// 🔴 Die Auflage, unter der diese Umstellung gebaut wurde: nicht ein dritter Weg, sondern die
// beiden vorhandenen angeglichen. Beide rufen avesmapsLoreRuleFlaecheErfuelltArtUndOrt.
$areasById = ['mav' => $mittelaventurien, 'kosch' => $koschberge,
    'khoram' => $khoram, 'farindel' => $farindel];

// Ein Ort in den Koschbergen: sie sind ein Gebirge und liegen in Mittelaventurien -> Treffer.
$ortInKosch = avesmapsLoreRuleSubjectFromPlace(
    ['public_id' => 'p-kosch', 'zone' => 'gemaessigt', 'area_public_ids' => ['kosch']], $areasById);
assert(avesmapsLoreRuleTermMatchesSubject($gebirgeInMav, $ortInKosch, $zones) === true);

// 💣 Der Fall, der die alte Fassung ueberfuehrt: ein Ort, der im Farindel (Wald, in Mav) UND im
// Khoramgebirge (Gebirge, NICHT in Mav) liegt. Unabhaengig geprueft waere „Gebirge innerhalb
// Mittelaventurien" erfuellt -- Gebirge ueber das Khoram, Mittelaventurien ueber den Farindel.
// Es muss aber DIESELBE Flaeche beides erfuellen, und keine tut es.
$ortDazwischen = avesmapsLoreRuleSubjectFromPlace(
    ['public_id' => 'p-mix', 'zone' => 'gemaessigt', 'area_public_ids' => ['farindel', 'khoram']],
    $areasById
);
assert(avesmapsLoreRuleTermMatchesSubject($gebirgeInMav, $ortDazwischen, $zones) === false,
    'Art und Ort muessen dieselbe Flaeche treffen -- sonst ist es die alte, unabhaengige Pruefung');

// Und die Gegenprobe, die nicht null ist: derselbe Ort trifft „Wald innerhalb Mittelaventurien".
$waldInMav = $term(['area_public_id' => 'mav', 'types' => $WALD]);
assert(avesmapsLoreRuleTermMatchesSubject($waldInMav, $ortDazwischen, $zones) === true,
    'GEGENPROBE: derselbe Ort, dieselbe Form -- der Farindel erfuellt beides');

// 💣 Zwei Flaechen DERSELBEN Art, nur eine davon im Behaelter -- der Grund, warum
// avesmapsLoreRuleSubjectFromPlace nicht mehr nach (kind|region_type) dedupliziert. Der
// Alkrawald steht ABSICHTLICH vorn: eine Entdopplung, die den ersten Wald behaelt, wirft
// ausgerechnet den Farindel weg und beantwortet die Regel mit false.
$alkrawald = ['public_id' => 'alkra', 'kind' => 'vegetation', 'region_type' => 'wald',
    'zones' => ['gemaessigt'], 'container_public_ids' => []];
$areasById['alkra'] = $alkrawald;
$ortInZweiWaeldern = avesmapsLoreRuleSubjectFromPlace(
    ['public_id' => 'p-waelder', 'zone' => 'gemaessigt', 'area_public_ids' => ['alkra', 'farindel']],
    $areasById
);
assert(count($ortInZweiWaeldern['flaechen']) === 2,
    'zwei Waelder sind zwei Flaechen -- fuer „innerhalb" sind sie nicht dasselbe');
assert(avesmapsLoreRuleTermMatchesSubject($waldInMav, $ortInZweiWaeldern, $zones) === true,
    'der zweite Wald liegt in Mittelaventurien -- eine Entdopplung nach Art verloere ihn');

// Ein Ort ohne jede Flaeche kann keine Art- und keine Ortsbedingung erfuellen.
$ortImNirgendwo = avesmapsLoreRuleSubjectFromPlace(
    ['public_id' => 'p-leer', 'zone' => 'gemaessigt', 'area_public_ids' => []], $areasById);
assert(avesmapsLoreRuleTermMatchesSubject($alleGebirge, $ortImNirgendwo, $zones) === false);
assert(avesmapsLoreRuleTermMatchesSubject($nurMav, $ortImNirgendwo, $zones) === false);
assert(avesmapsLoreRuleTermMatchesSubject(
    $term(['climate_from' => 'gemaessigt', 'climate_to' => 'gemaessigt']), $ortImNirgendwo, $zones) === true,
    'eine reine Klimabedingung trifft ihn trotzdem -- er liegt ja in einer Zone');

// --- G. avesmapsLoreRuleEvaluate erbt die neue Bedeutung ---------------------------------------
// Die Editor-Vorschau rechnet ueber avesmapsLoreRuleTermMatchesArea und aendert sich deshalb
// MIT, ohne eigenes Zutun. Vor dem 19.08.2026 stand hier 0.
$alleFlaechen = [$mittelaventurien, $koschberge, $khoram, $farindel];
$allePlaetze = [
    ['public_id' => 'p-kosch', 'zone' => 'gemaessigt', 'area_public_ids' => ['kosch']],
    ['public_id' => 'p-khoram', 'zone' => 'tropisch', 'area_public_ids' => ['khoram']],
];
$ergebnis = avesmapsLoreRuleEvaluate([$gebirgeInMav], $alleFlaechen, $allePlaetze, $zones);
assert($ergebnis['areas'] === ['kosch'], 'genau EIN Gebirge liegt in Mittelaventurien');
assert($ergebnis['places'] === ['p-kosch'], 'und genau der Ort darin');

// --- H. Der Partnerzeilen-Einsortierer: zwei Rollen, eine Schwelle ------------------------------
$ziel = ['zones' => [], 'container_public_ids' => []];
avesmapsLoreRulePartnerzeileEinsortieren(
    ['partner_public_id' => 'klima-1', 'partner_kind' => 'klima', 'partner_region_type' => 'boreal', 'share' => 0.6],
    $ziel
);
avesmapsLoreRulePartnerzeileEinsortieren(
    ['partner_public_id' => 'mav', 'partner_kind' => 'derographisch', 'partner_region_type' => 'region', 'share' => 0.9],
    $ziel
);
// 💣 Unter der Schwelle ist eine Randberuehrung Rauschen -- fuer BEIDE Rollen, nicht nur fuer die
// Klimazone. Ohne diese Zeile kaeme eine Fassung durch, die den Behaelter ungeprueft uebernimmt.
avesmapsLoreRulePartnerzeileEinsortieren(
    ['partner_public_id' => 'streift-nur', 'partner_kind' => 'topographie', 'partner_region_type' => 'gebirge',
        'share' => AVESMAPS_CLIMATE_REGION_MIN_SHARE / 2],
    $ziel
);
avesmapsLoreRulePartnerzeileEinsortieren(
    ['partner_public_id' => 'klima-2', 'partner_kind' => 'klima', 'partner_region_type' => 'subpolar',
        'share' => AVESMAPS_CLIMATE_REGION_MIN_SHARE / 2],
    $ziel
);
// Eine LEERE Zeile (LEFT JOIN ohne Partner) darf nichts eintragen und nicht werfen.
avesmapsLoreRulePartnerzeileEinsortieren(['share' => null], $ziel);
assert($ziel['zones'] === ['boreal'], 'nur der Klimapartner ueber der Schwelle');
assert($ziel['container_public_ids'] === ['mav'], 'nur der Behaelter ueber der Schwelle');

// --- I. Die Leser: Behaelter kommen aus ecosystem_region_overlap, und zwar in BEIDEN Zweigen ----
if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: the pdo_sqlite driver is missing -- this half would silently pass\n");
    exit(1);
}
$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec(
    'CREATE TABLE ecosystem_region (
        id INTEGER PRIMARY KEY, public_id TEXT NOT NULL, kind TEXT NOT NULL,
        region_type TEXT NULL, name TEXT NOT NULL DEFAULT \'\', wiki_region_key TEXT NULL,
        is_active INTEGER NOT NULL DEFAULT 1
    )'
);
$einfuegen = $pdo->prepare(
    'INSERT INTO ecosystem_region (id, public_id, kind, region_type, name, wiki_region_key, is_active)
     VALUES (?, ?, ?, ?, ?, ?, 1)'
);
$einfuegen->execute([1, 'mav', 'derographisch', 'region', 'Mittelaventurien', null]);
$einfuegen->execute([2, 'kosch', 'topographie', 'gebirge', 'Koschberge', null]);
$einfuegen->execute([3, 'khoram', 'topographie', 'gebirge', 'Khoramgebirge', null]);
// 💣 Almada steht fuer die 51 derographischen Regionen OHNE Art. Der Vorschlagskatalog des
// Regeleditors bietet sie an; bis zum 19.08.2026 filterte avesmapsLoreRuleReadAreas sie mit
// `region_type IS NOT NULL` heraus, und „Flaechenname = Almada" ergab 0 Treffer OHNE Erklaerung.
$einfuegen->execute([4, 'almada', 'derographisch', null, 'Almada', null]);
$einfuegen->execute([5, 'klima-gem', 'klima', 'gemaessigt', 'Gemaessigte Zone', null]);

$pdo->exec('CREATE TABLE ecosystem_region_overlap (region_id INTEGER, other_region_id INTEGER, share REAL)');
$paar = $pdo->prepare('INSERT INTO ecosystem_region_overlap (region_id, other_region_id, share) VALUES (?, ?, ?)');
$paar->execute([2, 1, 0.99]);   // Koschberge liegen in Mittelaventurien
$paar->execute([1, 2, 0.02]);   // dieselbe Beruehrung aus Sicht von Mittelaventurien: Rauschen
$paar->execute([2, 5, 1.0]);    // Koschberge liegen in der Gemaessigten Zone
$paar->execute([4, 1, 1.0]);    // Almada liegt in Mittelaventurien
$paar->execute([2, 4, 0.4]);    // Koschberge liegen (teils) in Almada

$flaechen = avesmapsLoreRuleReadAreas($pdo);
$nachId = array_column($flaechen, null, 'public_id');
assert(!isset($nachId['klima-gem']), 'ein Klimaband ist keine Flaeche im Sinne einer Regel');
assert(isset($nachId['almada']), 'eine Region OHNE Art gehoert in den Kandidatenbestand');
assert($nachId['almada']['region_type'] === '', 'keine Art heisst leerer String, nicht null');
$koschContainer = $nachId['kosch']['container_public_ids'];
sort($koschContainer);
assert($koschContainer === ['almada', 'mav'], 'beide Behaelter, das Klimaband nicht');
assert($nachId['kosch']['zones'] === ['gemaessigt'], 'der Klimapartner wurde zur Zone, nicht zum Behaelter');
assert($nachId['mav']['container_public_ids'] === [],
    '0,02 ist unter der Schwelle -- Mittelaventurien liegt NICHT in den Koschbergen');

// 🔴 Und der GLEICHE Zweig: der Einzelleser des oeffentlichen Lesepfads muss dasselbe sagen.
// Sagten die zwei Verschiedenes, waere genau das der Befund, den diese Umstellung beseitigt.
$einzeln = avesmapsLoreRuleReadSubjectForArea($pdo, 'kosch');
assert($einzeln !== null);
$einzelContainer = $einzeln['flaechen'][0]['container_public_ids'];
sort($einzelContainer);
assert($einzelContainer === $koschContainer, 'Einzelleser und Bestandsleser antworten gleich');
assert($einzeln['zones'] === $nachId['kosch']['zones']);

// Und die Regel greift ueber den echten Leser -- die Gegenprobe zu allen Nullen oben.
assert(avesmapsLoreRuleTermMatchesSubject($gebirgeInMav, $einzeln, $zones) === true,
    'GEGENPROBE ueber die Datenbank: die Koschberge liegen laut ecosystem_region_overlap in Mittelaventurien');
$khoramSubjekt = avesmapsLoreRuleReadSubjectForArea($pdo, 'khoram');
assert($khoramSubjekt !== null);
assert(avesmapsLoreRuleTermMatchesSubject($gebirgeInMav, $khoramSubjekt, $zones) === false);

// --- J. Almada als Behaelter: der Fall, den die 51 typenlosen Regionen bisher nicht konnten -----
$gebirgeInAlmada = $term(['area_public_id' => 'almada', 'types' => $GEBIRGE]);
assert(avesmapsLoreRuleTermMatchesSubject($gebirgeInAlmada, $einzeln, $zones) === true,
    'eine Region ohne eigene Art ist trotzdem ein gueltiger Behaelter');
$nurAlmada = $term(['area_public_id' => 'almada']);
$almadaSubjekt = avesmapsLoreRuleReadSubjectForArea($pdo, 'almada');
assert($almadaSubjekt !== null, 'und sie ist selbst erreichbar -- vorher war sie es nicht');
assert(avesmapsLoreRuleTermMatchesSubject($nurAlmada, $almadaSubjekt, $zones) === true);

echo "lore-regel-innerhalb: OK\n";
