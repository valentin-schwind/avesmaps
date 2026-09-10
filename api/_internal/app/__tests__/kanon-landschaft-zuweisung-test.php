<?php

declare(strict_types=1);

/**
 * DIE WIKI-ZUWEISUNG EINER LANDSCHAFTSFLAECHE MACHT IHR ETIKETT.
 *
 * Ausfuehren (aus dem Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *       api/_internal/app/__tests__/kanon-landschaft-zuweisung-test.php
 *
 * 🚩 DER BEFUND (Owner-Meldung 10.09.2026, mit Bild): der Urwald „Altenforst" trug am Kopf
 * INOFFIZIELL │ Briefspiel und darunter eine Wiki-Zeile INOFFIZIELL │ Wiki-Artikel -- waehrend
 * seine Zuweisung stimmt und in den HAUPTRAUM zeigt. „das ging mal alles richtig. jetzt ist es
 * wieder kaputt sowas darf nicht passieren."
 *
 * 💣 DIE ZUWEISUNG WAR DA, GERECHNET UND RICHTIG -- ABGELEGT UNTER EINEM SCHLUESSEL, DEN NIEMAND
 * FRAGT. Seit Schritt 5 des Quellen-Umbaus (03.09.2026) traegt die FLAECHE die Quellen einer
 * gebundenen Beschriftung, und `avesmapsLabelQuellenSchluessel` holt Quellen UND Etikett unter
 * `ecosystem:<region_public_id>`. Der Namensraum entstand dagegen in
 * avesmapsMapFeaturesWikiNamespaces als `region:<label_public_id>`. Die Raenge 1 und 2 der
 * Kanon-Regel waren fuer jede gebundene Landschaft damit unerreichbar; es entschieden immer die
 * Quellen (Raenge 3 und 4).
 *
 * 🔴 UND ES GING IN BEIDE RICHTUNGEN FALSCH -- die zweite Haelfte ist die schlimmere und stand in
 * keiner Meldung: eine Flaeche aus ns 222 MIT einer offiziellen Quelle behauptete „offiziell",
 * also Kanon fuer Fanmaterial. Beide Faelle stehen unten als §2 und §3.
 *
 * ⚠️ SICHTBAR WURDE ES ERST DURCH DIE QUELLEN. Ohne Verweis gibt es gar kein Etikett; mit
 * Verweisen ohne Ableitung gilt die Vorgabe „offiziell". Eine Flaeche sah also so lange richtig
 * aus, bis ihr jemand die erste INOFFIZIELLE Quelle eintrug -- genau das tut der
 * Garetien-Importer dieser Tage reihenweise. Deshalb las es sich als „seit ein paar Tagen kaputt",
 * obwohl der Haken seit dem 08.09.2026 (Rang 1/2) offenstand.
 *
 * 🪤 UND EIN SATZ IM CODE HAT DEN FEHLER GEDECKT: der Docblock von
 * avesmapsFeatureSourcesKanonLeerEintraege behauptete, `ecosystem` koenne „per Konstruktion nie ein
 * Etikett bekommen". Das galt nur fuer die Raenge 1 und 2; die Raenge 3 und 4 liefen fuer sie seit
 * jeher, weil avesmapsFeatureSourcesDeriveKanon ueber `array_keys($refs)` laeuft und keine
 * Objektart ausnimmt. Wer den Satz las, zaehlte nicht nach.
 */

require_once __DIR__ . '/../feature-sources.php';

if (assert_options(ASSERT_ACTIVE) !== 1 || ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: mit -d zend.assertions=1 starten, sonst ist assert() wirkungslos.\n");
    exit(1);
}

const KLZ_HAUPT = 'https://de.wiki-aventurica.de/wiki/Altenforst';
const KLZ_NS222 = 'https://de.wiki-aventurica.de/wiki/Inoffiziell:Altenforst';

$katalog = [
    1 => ['label' => 'Herzogtum Weiden', 'type' => 'briefspiel', 'official' => 0],
    2 => ['label' => 'Geographia Aventurica', 'type' => 'regionalspielhilfe', 'official' => 1],
];

/** Eine an eine Flaeche GEBUNDENE Beschriftung, wie avesmapsMapFeatureRowToGeoJsonFeature sie liefert. */
function klzGebundenesLabel(string $labelId, string $regionId, string $wikiUrl): array
{
    return ['properties' => [
        'feature_type' => 'label',
        'public_id' => $labelId,
        'ecosystem_region_public_id' => $regionId,
        'wiki_region' => ['wiki_key' => 'wiki:altenforst', 'wiki_url' => $wikiUrl],
        'wiki_url' => $wikiUrl,
    ]];
}

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
// Nur die drei Spalten, die der Leser anfasst -- die Produktionsform steht in ecosystem.php.
$pdo->exec('CREATE TABLE ecosystem_region (public_id TEXT, wiki_url TEXT, is_active INTEGER)');
$pdo->exec("INSERT INTO ecosystem_region (public_id, wiki_url, is_active) VALUES
    ('eco-haupt',   '" . KLZ_HAUPT . "', 1),
    ('eco-ns222',   '" . KLZ_NS222 . "', 1),
    ('eco-leer',    NULL,                1),
    ('eco-fremd',   'https://garetien.de/Altenforst', 1),
    ('eco-papierkorb', '" . KLZ_HAUPT . "', 0)");

// ---- 1. Der Leser selbst -----------------------------------------------------------------------

$raeume = avesmapsEcosystemRegionWikiNamespaces($pdo);

assert(($raeume['ecosystem:eco-haupt'] ?? null) === 0,
    '1a: der Hauptraum meldet sich als 0, nicht als null -- sonst ist „verbunden" nicht von '
    . '„gar nicht verbunden" zu unterscheiden');
assert(($raeume['ecosystem:eco-ns222'] ?? null) === 222,
    '1b: ns 222 wird als solcher gelesen');
assert(!array_key_exists('ecosystem:eco-leer', $raeume),
    '1c: ohne Adresse gibt es keine Aussage -- kein Eintrag, nicht etwa 0');
assert(!array_key_exists('ecosystem:eco-fremd', $raeume),
    '1d: 💣 EIN FREMDER WIRT BEKOMMT NIEMALS DEN HAUPTRAUM. Ohne die Wirtspruefung in '
    . 'avesmapsWikiNamespaceFromWikiUrlMitHauptraum waere eine Briefspielseite im Kopf ihres '
    . 'Objekts kanonisch');
assert(!array_key_exists('ecosystem:eco-papierkorb', $raeume),
    '1e: eine Flaeche im Papierkorb beschriftet nichts mehr');

// ---- 2. Der gemeldete Fall: Hauptraum schlaegt die inoffizielle Quelle --------------------------

$features = [klzGebundenesLabel('lbl-altenforst', 'eco-haupt', KLZ_HAUPT)];
$refs = ['ecosystem:eco-haupt' => [['source_id' => 1]]];
$kanon = avesmapsFeatureSourcesDeriveKanon(
    $katalog,
    $refs,
    avesmapsMapFeaturesWikiNamespaces($features) + $raeume
);

assert(($kanon['ecosystem:eco-haupt']['kanon'] ?? null) === 'offiziell',
    '2a: DER GEMELDETE FALL -- Hauptraum-Zuweisung plus Briefspielquelle ergibt „offiziell". '
    . 'Owner 08.09.2026: „wenn editoren weitere, inoffizielle quellen hinzufügen, dann stehn die '
    . 'als z.b. inoffiziell | briefspiel dran, aber das objekt bleibt offiziell."');
assert(!isset($kanon['ecosystem:eco-haupt']['bezeichner_type']),
    '2b: „offiziell" ist immer die VOLLE Pille ohne Bezeichner (Owner 03.09.2026)');

// 🔴 Die Gegenprobe, die den Fehler ueberhaupt sichtbar macht: DIESELBE Beschriftung frei
// gestellt war immer schon richtig. Genau diese Ungleichheit war der Fehler.
$frei = $features[0];
unset($frei['properties']['ecosystem_region_public_id']);
$kanonFrei = avesmapsFeatureSourcesDeriveKanon(
    $katalog,
    ['region:lbl-altenforst' => [['source_id' => 1]]],
    avesmapsMapFeaturesWikiNamespaces([$frei])
);
assert(($kanonFrei['region:lbl-altenforst']['kanon'] ?? null) === 'offiziell',
    '2c: dieselbe Beschriftung FREI war nie betroffen -- gebunden und frei muessen dasselbe sagen');

// ---- 3. Die andere Richtung: ns 222 schlaegt die OFFIZIELLE Quelle ------------------------------

$kanon222 = avesmapsFeatureSourcesDeriveKanon(
    $katalog,
    ['ecosystem:eco-ns222' => [['source_id' => 2]]],
    avesmapsMapFeaturesWikiNamespaces([klzGebundenesLabel('lbl-2', 'eco-ns222', KLZ_NS222)]) + $raeume
);
assert(($kanon222['ecosystem:eco-ns222']['kanon'] ?? null) === 'inoffiziell',
    '3a: 💣 DIE SCHLIMMERE HAELFTE -- ns 222 schlaegt eine offizielle Quellzeile (Owner 08.09.2026: '
    . '„wenn der zugewiesen is und das ding is inoffiziell im wiki, gilt das"). Ohne den Leser '
    . 'behauptete Fanmaterial Kanon');
assert(($kanon222['ecosystem:eco-ns222']['bezeichner_label'] ?? null) === 'Wiki Aventurica',
    '3b: bei ns 222 ist der Bezeichner der KORPUSNAME, nicht die Art der Quelle');

// ---- 4. Ohne Zuweisung entscheiden die Quellen weiter, genau wie bisher -------------------------

$kanonLeer = avesmapsFeatureSourcesDeriveKanon(
    $katalog,
    ['ecosystem:eco-leer' => [['source_id' => 1]]],
    $raeume
);
assert(($kanonLeer['ecosystem:eco-leer']['kanon'] ?? null) === 'inoffiziell'
    && ($kanonLeer['ecosystem:eco-leer']['bezeichner_type'] ?? null) === 'briefspiel',
    '4: ohne Zuweisung UND nur mit externen Quellen bleibt es „inoffiziell │ Art" -- die zweite '
    . 'Haelfte der Owner-Regel vom 10.09.2026 darf der Fix nicht mitnehmen');

// ---- 5. DIE ZWEITE TUER: der Nachtrag nach einer Schreibaktion ----------------------------------
//
// 💣 EINE REGEL, DIE EINEN VON ZWEI ERZEUGERN BINDET, IST KEINE REGEL. Der Lesepfad (die
// Kartennutzlast) und der Schreibpfad (die Antwort einer Quellen-Aktion, `kanon_je_kennung`)
// holen ihre Namensraeume getrennt. Waere nur der Lesepfad angeschlossen, kippte das Etikett im
// Moment des Speicherns von „offiziell" auf „inoffiziell" und bliebe dort bis zum Neuladen --
// derselbe Fehler, der am 09.09.2026 am „Schwanenbruch" gemeldet wurde.

$raeumeSchreibweg = avesmapsFeatureSourcesWikiNamespacesFuerKennungen($pdo, 'ecosystem', ['eco-haupt', 'eco-ns222']);
assert(($raeumeSchreibweg['ecosystem:eco-haupt'] ?? null) === 0
    && ($raeumeSchreibweg['ecosystem:eco-ns222'] ?? null) === 222,
    '5a: der Schreibpfad kennt die Zuweisung einer Landschaftsflaeche genauso wie der Lesepfad');
assert(avesmapsFeatureSourcesWikiNamespacesFuerKennungen($pdo, 'ecosystem', ['eco-leer']) === [],
    '5b: und er erfindet keine, wo keine ist');
assert(avesmapsFeatureSourcesWikiNamespacesFuerKennungen($pdo, 'citymap', ['c-1']) === [],
    '5c: citymap bleibt bewusst draussen -- ihre `article_url` benennt oft die PUBLIKATION, in der '
    . 'die Karte erschienen ist, nicht einen Artikel, den die Karte fuer sich beansprucht');

// ---- 6. Rueckbau-Waechter: der Leser haengt an BEIDEN Tueren ------------------------------------
//
// ⭐ Gemessen am kommentarfreien Quelltext (PHP-Tokenizer): roh gelesen schluegen die Zusicherungen
// an den Begruendungen dieses Fixes selbst an. Dieselbe Lehre wie in
// api/_internal/conflicts/__tests__/kein-wiki-eintrag-ist-weg-test.php.
function klzOhneKommentare(string $pfad): string
{
    $code = '';
    foreach (token_get_all((string) file_get_contents($pfad)) as $token) {
        if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
            continue;
        }
        $code .= is_array($token) ? $token[1] : $token;
    }

    return $code;
}

$nutzlast = klzOhneKommentare(__DIR__ . '/../../../app/map-features.php');
assert(str_contains($nutzlast, 'avesmapsEcosystemRegionWikiNamespaces($pdo)'),
    '6a: 💣 DER LESER MUSS IN DER KARTENNUTZLAST STEHEN. Ohne diese Zeile ist der ganze Fix '
    . 'wirkungslos, und zwar STILL: „kein Etikett" bzw. „die Quellen entscheiden" ist ein voellig '
    . 'gueltiger Zustand, kein Test wird rot, und der Altenforst steht wieder auf INOFFIZIELL');
assert(preg_match('/avesmapsMapFeaturesWikiNamespaces\(\$features\)\s*\+\s*avesmapsPoliticalTerritoryWikiNamespaces\(\$pdo\)\s*\+\s*avesmapsEcosystemRegionWikiNamespaces\(\$pdo\)/', $nutzlast) === 1,
    '6b: und zwar in DERSELBEN Summe wie die anderen beiden -- ein zweiter DeriveKanon-Aufruf '
    . 'waere eine zweite Wahrheit ueber dasselbe Etikett');

$lib = klzOhneKommentare(__DIR__ . '/../feature-sources.php');
assert(str_contains($lib, "'ecosystem' => 'avesmapsEcosystemRegionWikiNamespaces'"),
    '6c: und an der zweiten Tuer (avesmapsFeatureSourcesWikiNamespacesFuerKennungen), sonst kippt '
    . 'das Etikett im Moment des Speicherns -- siehe §5');

// ---- 7. Der Riegel, der in diesem Projekt schon mehrfach vergessen wurde ------------------------
//
// 💣 `feature_kanon` reist in der Kartennutzlast, deren ETag an `map_revision` + Nutzlastversion
// haengt -- eine CODEaenderung bewegt die Revision nicht. Ohne den Versionssprung bekaeme jeder
// warme Browser sein 304 samt der alten Tafel und saehe den Altenforst weiter auf INOFFIZIELL:
// der Fix waere ausgerechnet fuer den Besucher unsichtbar, der ihn gemeldet hat
// (AGENTS.md §10, Klimastempel / Tempowerte / Wappen-Notaus).
// ⚠️ Gemessen wird „hat diese Aenderung ueberholt", nicht der genaue Wert -- die Zahl steigt auch
// aus fremden Gruenden, und ein fester Wert waere beim naechsten Bump einer anderen Sitzung rot.
preg_match('/AVESMAPS_MAP_FEATURES_PAYLOAD_VERSION = (\\d+);/', $nutzlast, $fassung);
assert(isset($fassung[1]) && (int) $fassung[1] >= 24,
    '7a: die Nutzlastversion muss mit dieser Aenderung gestiegen sein (>= 24)');
assert(str_contains((string) file_get_contents(__DIR__ . '/../../../app/map-features.php'), '// 24 (10.09.2026)'),
    '7b: und traegt ihren Grund in der Liste ueber der Konstante');

echo "OK: kanon-landschaft-zuweisung-test.php\n";
