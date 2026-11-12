<?php

declare(strict_types=1);

/**
 * Das Legacy-Orakel für die Kategorie-Abfragen des WikiSync (WI-0253 C-2): lässt die ECHTEN Legacy-Funktionen (`dump-category-layer.php`, `place-kinds.php`,
 * `sync-monitor*.php`) auf feste und mit festem Saatwert erzeugte Eingaben laufen und schreibt Eingabe und Ergebnis als Fixture
 * `apps/server/test/fixtures/wiki-kategorien-orakel.json`. Der Test `wiki-kategorien-auswerten.test.ts` hält die TypeScript-Rechnung dagegen; wer sie ändert, ändert damit nicht
 * die Erwartung – die kommt allein von hier.
 *
 *   # Legacy nur lesen: aus dem Discovery-Mirror in ein Wegwerfverzeichnis entpacken (der Mirror selbst bleibt unberührt)
 *   git --git-dir=C:/GIT/.discovery/avesmaps.git archive HEAD api/_internal | tar -x -C <Wegwerfverzeichnis>
 *   php -d extension=mbstring scripts/dev/wiki-kategorien-orakel.php <Wegwerfverzeichnis> apps/server/test/fixtures/wiki-kategorien-orakel.json [zufall]
 *
 * Gemessen wird nichts am Wiki: Die Eingaben sind erfunden oder nach den Fällen gebaut, die Legacy in Kommentaren nennt (Al’Anfa, „Abgeleitet von Horas (Myranor)“, …). Der Parameter
 * `zufall` (Anzahl, Standard 120) erzeugt zusätzlich Kontexte aus den Bausteinen der Erkennung mit festem Saatwert; einmal mit 20.000 gelaufen und ohne Abweichung (Legacy-Stand a7f2dac86).
 */

if (PHP_SAPI !== 'cli' || $argc < 3) {
    fwrite(STDERR, "Aufruf: php -d extension=mbstring wiki-kategorien-orakel.php <legacy-wurzel> <fixture.json> [zufall]\n");
    exit(2);
}
$root = rtrim($argv[1], '/\\');
$datei = $argv[2];
$zufallAnzahl = isset($argv[3]) ? (int) $argv[3] : 120;

foreach ([
    '/api/_internal/bootstrap.php',
    '/api/_internal/political/territory.php',
    '/api/_internal/wiki/sync.php',
    '/api/_internal/wiki/sync-monitor.php',
    '/api/_internal/wiki/place-kinds.php',
    '/api/_internal/wiki/locations.php',
    '/api/_internal/wiki/settlements.php',
    '/api/_internal/wiki/dump-category-layer.php',
] as $teil) {
    require $root . $teil;
}

/** @param list<string> $kategorien */
function seite(array $kategorien): array
{
    return ['categories' => array_map(static fn(string $name): array => ['title' => 'Kategorie:' . $name], $kategorien)];
}

// ── Kontinent ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** @var list<array{id:string,titel:string,kategorien:list<string>}> $kontinent */
$kontinent = [
    ['id' => 'nichts', 'titel' => 'Gareth', 'kategorien' => []],
    ['id' => 'aventurien-artikel', 'titel' => 'Gareth', 'kategorien' => ['Dorf', 'Aventurien-Artikel']],
    ['id' => 'myranor-artikel', 'titel' => 'Horasia', 'kategorien' => ['Myranor-Artikel']],
    ['id' => 'ort-in-myranor', 'titel' => 'Neu-Horas', 'kategorien' => ['Dorf', 'Ort in Myranor']],
    ['id' => 'staat-myranor', 'titel' => 'Zwerch', 'kategorien' => ['Staat (Myranor)']],
    ['id' => 'nav-staaten-myranor', 'titel' => 'Zwerch', 'kategorien' => ['Nav Staaten Myranor']],
    ['id' => 'abgeleitet-von-horas', 'titel' => 'Wiedererstandenes Reich des Horas', 'kategorien' => ['Abgeleitet von Horas (Myranor)', 'Aventurien-Artikel']],
    ['id' => 'abgeleitet-mit-leerzeichen', 'titel' => 'Horas-Reich', 'kategorien' => ['  Abgeleitet von Horas (Myranor)', 'Aventurien-Artikel']],
    ['id' => 'abgeleitet-grossgeschrieben', 'titel' => 'Horas-Reich', 'kategorien' => ['ABGELEITET VON Horas (Myranor)']],
    ['id' => 'abgeleitet-ohne-grenze', 'titel' => 'Horas-Reich', 'kategorien' => ['Abgeleitet vonHoras Myranor']],
    ['id' => 'uthuria', 'titel' => 'Tamaran', 'kategorien' => ['Ort auf Uthuria']],
    ['id' => 'uthuria-im-titel', 'titel' => 'Uthuria-Hafen', 'kategorien' => []],
    ['id' => 'tharun', 'titel' => 'Tharun-Stadt', 'kategorien' => ['Tharun-Artikel']],
    ['id' => 'lahmaria', 'titel' => 'Lahmaria-Insel', 'kategorien' => ['Lahmaria-Artikel']],
    ['id' => 'rakshazar', 'titel' => 'Rakshazar-Siedlung', 'kategorien' => ['Rakshazar-Artikel']],
    ['id' => 'riesland', 'titel' => 'Kalgor', 'kategorien' => ['Ort im Riesland']],
    ['id' => 'guldenland', 'titel' => 'Mysobien', 'kategorien' => ['Güldenland-Artikel']],
    ['id' => 'gueldenland', 'titel' => 'Mysobien', 'kategorien' => ['Gueldenland-Artikel']],
    ['id' => 'rastabor', 'titel' => 'Rastabor', 'kategorien' => ['Dorf']],
    ['id' => 'vesayama', 'titel' => 'Vesayama', 'kategorien' => []],
    ['id' => 'al-anfa-kolonien', 'titel' => 'Al’Anfa', 'kategorien' => ['Geographisch: Meridiana; Kolonien: Uthuria', 'Aventurien-Artikel']],
    ['id' => 'kolonie-singular', 'titel' => 'Al’Anfa', 'kategorien' => ['Kolonie Uthuria', 'Aventurien-Artikel']],
    ['id' => 'kolonialbesitz', 'titel' => 'Brabak', 'kategorien' => ['Kolonialbesitz in Myranor', 'Aventurien-Artikel']],
    ['id' => 'protektorat', 'titel' => 'Brabak', 'kategorien' => ['Protektorat Tharun', 'Aventurien-Artikel']],
    ['id' => 'aussenposten', 'titel' => 'Brabak', 'kategorien' => ['Außenposten in Uthuria', 'Aventurien-Artikel']],
    ['id' => 'aussenposten-ss', 'titel' => 'Brabak', 'kategorien' => ['Aussenposten in Uthuria', 'Aventurien-Artikel']],
    ['id' => 'exklave', 'titel' => 'Brabak', 'kategorien' => ['Exklave: Myranor', 'Aventurien-Artikel']],
    ['id' => 'dependance', 'titel' => 'Brabak', 'kategorien' => ['Dependance, Rakshazar', 'Aventurien-Artikel']],
    ['id' => 'kolonie-zu-weit', 'titel' => 'Brabak', 'kategorien' => ['Kolonien a b c Uthuria', 'Aventurien-Artikel']],
    ['id' => 'kolonie-zwei-woerter', 'titel' => 'Brabak', 'kategorien' => ['Kolonien nahe der Uthuria', 'Aventurien-Artikel']],
    ['id' => 'kolonie-ohne-grenze', 'titel' => 'Brabak', 'kategorien' => ['Kolonienuthuria', 'Aventurien-Artikel']],
    ['id' => 'kolonie-vor-buchstabe', 'titel' => 'Brabak', 'kategorien' => ['Dekolonie Uthuria', 'Aventurien-Artikel']],
    ['id' => 'nav-staaten-aventurien', 'titel' => 'Wiedererstandenes Reich des Horas', 'kategorien' => ['Nav Staaten Aventurien', 'Abgeleitet von Horas (Myranor)', 'Ort in Myranor']],
    ['id' => 'nav-staaten-aventurien-titel', 'titel' => 'Horasreich', 'kategorien' => ['NavStaatenAventurien', 'Myranor']],
    ['id' => 'reihenfolge-myranor-vor-aventurien', 'titel' => 'Streitort', 'kategorien' => ['Aventurien-Artikel', 'Myranor-Artikel']],
    ['id' => 'reihenfolge-rakshazar-vor-uthuria', 'titel' => 'Streitort', 'kategorien' => ['Uthuria', 'Rakshazar']],
    ['id' => 'umlaute-akzente', 'titel' => 'Ôrt', 'kategorien' => ['Ünbekannt']],
    ['id' => 'unterstriche', 'titel' => 'Ort_in_Myranor', 'kategorien' => []],
    ['id' => 'sprungmarke', 'titel' => 'Ort#Myranor', 'kategorien' => ['Dorf']],
    ['id' => 'sonderzeichen', 'titel' => "Ort — \"A'B\" (Stadt)", 'kategorien' => ['Dorf (Siedlung)', '!!!']],
    ['id' => 'grossschreibung', 'titel' => 'MYRANOR-ORT', 'kategorien' => []],
    ['id' => 'nbsp', 'titel' => "Brabak", 'kategorien' => ["Kolonien:\u{00A0}Uthuria", 'Aventurien-Artikel']],
    ['id' => 'tab', 'titel' => "Brabak", 'kategorien' => ["Kolonien\tUthuria", 'Aventurien-Artikel']],
];

$bausteine = [
    'Gareth', 'Havena', 'Al’Anfa', 'Horas', 'Wiedererstandenes Reich', 'Dorf', 'Stadt', 'Aventurien-Artikel', 'Myranor-Artikel', 'Ort in Myranor', 'Staat (Myranor)',
    'Nav Staaten Aventurien', 'Nav Staaten Myranor', 'Abgeleitet von Horas (Myranor)', 'Abgeleitet von Gareth', 'Kolonien: Uthuria', 'Kolonie Myranor', 'Kolonialbesitz Tharun',
    'Protektorat Rakshazar', 'Außenposten Lahmaria', 'Exklave Riesland', 'Dependance Güldenland', 'Uthuria', 'Tharun', 'Lahmaria', 'Rakshazar', 'Riesland', 'Güldenland',
    'Gueldenland', 'Rastabor', 'Vesayama', 'Spielerwelten Ort', 'Briefspielartikel', 'Inoffizielle Siedlung', 'Geographisch: Meridiana', 'Kolonien', 'nahe der', 'in', 'am Meer',
    'ß-Straße', 'Äußerste Insel', 'Ünterland', '42', 'x',
];
mt_srand(25102026);
$zufall = [];
for ($i = 0; $i < $zufallAnzahl; $i++) {
    $titel = $bausteine[mt_rand(0, count($bausteine) - 1)];
    $kategorien = [];
    for ($k = mt_rand(0, 5); $k > 0; $k--) {
        $kategorien[] = $bausteine[mt_rand(0, count($bausteine) - 1)];
    }
    $zufall[] = ['id' => 'zufall-' . $i, 'titel' => $titel, 'kategorien' => $kategorien];
}
$kontinent = array_merge($kontinent, $zufall);

$kontinentFaelle = [];
foreach ($kontinent as $fall) {
    // Die Legacy-Funktion nimmt die Seiten nach ANGEFRAGTEM Titel und rechnet Titel + Kategorien (Assembler, dump-category-layer.php).
    $karte = avesmapsWikiDumpCategoryAssembleContinentMap([$fall['titel'] => seite($fall['kategorien'])]);
    $norm = avesmapsWikiSyncMonitorNormalizeTitle($fall['titel']);
    $fall['erwartet'] = $norm === '' ? null : ($karte[$norm] ?? null);
    $kontinentFaelle[] = $fall;
}

// ── Klassen- und Bauwerkskarte ─────────────────────────────────────────────────────────────────────────────────────────────────────

$klassen = [
    ['id' => 'einfach', 'kategorien' => [
        'Dorf' => ['Almada', 'Bärenau'],
        'Kleinstadt' => ['Fasar'],
        "Mittelgro\u{00DF}e Stadt" => ['Havena'],
        "Gro\u{00DF}stadt" => ['Vinsalt'],
        "Metropole (Siedlungsgr\u{00F6}\u{00DF}e)" => ['Gareth'],
    ]],
    ['id' => 'erster-gewinnt', 'kategorien' => [
        'Dorf' => ['Doppel'],
        'Kleinstadt' => ['Doppel', 'Einzel'],
        "Gro\u{00DF}stadt" => ['Doppel'],
    ]],
    ['id' => 'normalisierung', 'kategorien' => [
        'Dorf' => ['Alt_Dorf', 'Mit#Sprung', '  Mit Rand  ', ''],
        'Kleinstadt' => ['Alt Dorf'],
    ]],
    ['id' => 'fremde-kategorie', 'kategorien' => [
        'Ganz anders' => ['Wird ignoriert'],
        'Dorf' => ['Zählt'],
    ]],
    ['id' => 'leer', 'kategorien' => []],
];
$klassenFaelle = [];
foreach ($klassen as $fall) {
    $fall['erwartet'] = avesmapsWikiDumpCategoryAssembleClassMap($fall['kategorien'])['map'];
    $klassenFaelle[] = $fall;
}

$bauwerke = [
    ['id' => 'einfach', 'arten' => ['Festung' => ['Greifenburg'], 'Tempel' => ['Rondratempel']]],
    ['id' => 'erste-art-gewinnt', 'arten' => ['Steinkreis' => ['Feuersturm-Tempel', 'Steinkreis von Gareth'], 'Kultstätte' => ['Feuersturm-Tempel', 'Anderswo']]],
    ['id' => 'normalisierung', 'arten' => ['Turm' => ['Hoher_Turm', 'Mit#Sprung', ''], 'Ruine' => ['Hoher Turm']]],
    ['id' => 'leer', 'arten' => []],
];
$bauwerkFaelle = [];
foreach ($bauwerke as $fall) {
    $fall['erwartet'] = avesmapsWikiDumpCategoryAssembleBuildingMap($fall['arten'])['map'];
    $bauwerkFaelle[] = $fall;
}

// ── Die Liste der Arten ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** @var list<array{id:string,seiten:list<list<string>>}> $artenFaelle */
$artenEingaben = [
    ['id' => 'keine-online', 'seiten' => [[]]],
    ['id' => 'eine-seite', 'seiten' => [['Kategorie:Brunnen', 'Kategorie:Steinkreis', 'Kategorie:Mauer', 'Kategorie:Neue Art']]],
    ['id' => 'zwei-seiten', 'seiten' => [['Kategorie:Aa', 'Kategorie:Bb'], ['Kategorie:Bb', 'Category:Cc', 'Kategorie:Damm', 'Kategorie: Dd ']]],
    ['id' => 'mit-legacy-schon-dabei', 'seiten' => [['Kategorie:Tempel', 'Kategorie:Festung', 'Kategorie:Straße']]],
];
$artenFaelle = [];
foreach ($artenEingaben as $fall) {
    $seiten = $fall['seiten'];
    $aufruf = 0;
    $fetcher = static function (string $kategorie, ?string $weiter) use (&$aufruf, $seiten): array {
        $titel = $seiten[$aufruf] ?? [];
        $aufruf++;

        return ['titles' => $titel, 'continue' => $aufruf < count($seiten) ? 'weiter' . $aufruf : null];
    };
    $ergebnis = avesmapsWikiDumpCategoryFetchBuildingTypes([], null, null, $fetcher);
    $fall['erwartet'] = $ergebnis['types'];
    $artenFaelle[] = $fall;
}

$ausgeschlossen = [];
foreach (['Straße', 'Strasse', 'Reichsstraße', 'Reichsstrasse', 'Mauer', 'Damm', 'Deich', 'Kanalisation', 'Äquadukt', 'Aequadukt', ' mauer ', 'MAUER', 'Tempel', 'Brücke', 'Bauwerk', ''] as $art) {
    $ausgeschlossen[] = ['art' => $art, 'erwartet' => avesmapsWikiSettlementIsExcludedBuildingType($art)];
}

$titel = [];
foreach (['Gareth', 'Alt_Name', ' Rand ', 'Ort#Sprung', '#nur', 'A_B#C_D', "Tab\tTitel", 'Über_Ort', ''] as $roh) {
    $titel[] = ['roh' => $roh, 'erwartet' => avesmapsWikiSyncMonitorNormalizeTitle($roh)];
}

$fixture = [
    'hinweis' => 'Erzeugt von scripts/dev/wiki-kategorien-orakel.php aus Legacy a7f2dac86. Nicht von Hand ändern.',
    'kontinent' => $kontinentFaelle,
    'klassen' => $klassenFaelle,
    'bauwerke' => $bauwerkFaelle,
    'arten' => $artenFaelle,
    'ausgeschlossen' => $ausgeschlossen,
    'titel' => $titel,
    'bauwerkListe' => [
        'arten' => AVESMAPS_WIKI_SETTLEMENT_LEGACY_BUILDING_TYPES,
        'kern' => AVESMAPS_PLACE_KIND_LEGACY_PREFIX_LENGTH,
    ],
    'klassenKategorien' => AVESMAPS_WIKI_CATEGORY_TO_CLASS,
];

file_put_contents(
    $datei,
    json_encode($fixture, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . "\n",
);
fwrite(STDOUT, count($kontinentFaelle) . ' Kontinent-Fälle, ' . count($klassenFaelle) . ' Klassen, ' . count($bauwerkFaelle) . " Bauwerke geschrieben\n");
