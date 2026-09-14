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

// ---- 4b. DER DOMMEL-FALL, EINE OBJEKTART WEITER (Owner 10.09.2026: „fix dommel fall nach") ------
//
// 🔴 RANG 5: keine Zuweisung, keine verwertbare Quelle -- kein Etikett. Eine Flaeche, deren
// Verweise ausschliesslich PUBLIKATIONEN sind, hat niemanden, der etwas ueber ihren Kanon sagt.
// Ohne den ausdruecklichen Leer-Eintrag faellt resolveFeatureKanon (js/ui/popups.js) fuer sie auf
// die Vorgabe „offiziell" zurueck -- ein FEHLENDER Eintrag heisst dort „offiziell", nicht „nichts".
//
// 💣 UND ES HEILT EINEN WIDERSPRUCH, DEN NIEMAND GEMELDET HAT: die zweite Tuer
// (avesmapsFeatureSourcesKanonAusEingaben) meldet `['kanon' => '']` seit jeher TYPUNABHAENGIG.
// Dasselbe Objekt sagte also „offiziell", solange man nur die Seite lud, und verlor sein Etikett in
// dem Moment, in dem jemand eine Quelle speicherte. Der Fall unten haelt beide Tueren gegeneinander.

$nurPublikation = ['ecosystem:eco-leer' => [['source_id' => 2, 'reference_kind' => 'beschrieben']]];
$kanonPub = avesmapsFeatureSourcesDeriveKanon($katalog, $nurPublikation, $raeume);
assert(!isset($kanonPub['ecosystem:eco-leer']),
    '4b-1: eine Publikation macht keinen Kanon -- die Ableitung schweigt (Owner 08.09.2026)');

$leerEintraege = avesmapsFeatureSourcesKanonLeerEintraege($nurPublikation, $kanonPub);
assert(($leerEintraege['ecosystem:eco-leer']['kanon'] ?? null) === '',
    '4b-2: DER DOMMEL-FALL -- das Schweigen muss AUSDRUECKLICH gesagt werden, sonst gilt im Browser '
    . 'die Vorgabe „offiziell". `ecosystem` gehoert dafuer in $bedient');

// ⚠️ Und der Riegel dagegen, dass der Leer-Eintrag zu weit greift: eine Flaeche, ueber die etwas
// GESAGT ist, kommt dort gar nicht an -- weder die zugewiesene noch die mit echter Quelle.
$mitAussage = ['ecosystem:eco-haupt' => [['source_id' => 1]], 'ecosystem:eco-leer' => [['source_id' => 1]]];
$leerZwei = avesmapsFeatureSourcesKanonLeerEintraege(
    $mitAussage,
    avesmapsFeatureSourcesDeriveKanon($katalog, $mitAussage, $raeume)
);
assert($leerZwei === [],
    '4b-3: was ein Etikett hat (Rang 1-4), bekommt keinen Leer-Eintrag -- sonst loeschte er es');

// 💣 DIE ZWEI TUEREN MUESSEN DASSELBE SAGEN. Genau daran hing der Widerspruch: der Lesepfad
// schwieg (und der Browser sagte „offiziell"), der Schreibpfad meldete „kein Etikett".
$schreibpfad = avesmapsFeatureSourcesKanonAusEingaben('ecosystem', ['eco-leer'], $katalog, $nurPublikation, $raeume);
assert(($schreibpfad['eco-leer']['kanon'] ?? null) === '',
    '4b-4: der Schreibpfad sagte das schon immer');
assert(($schreibpfad['eco-leer']['kanon'] ?? null) === ($leerEintraege['ecosystem:eco-leer']['kanon'] ?? null),
    '4b-5: und der Lesepfad sagt jetzt DASSELBE -- ein Objekt darf nicht davon abhaengen, ob gerade '
    . 'jemand gespeichert hat');

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

// 💣 UND DER RUECKFALL MUSS IN DERSELBEN SUMME STEHEN. Ohne diese Zusicherung ueberlebt seine
// Entfernung JEDEN Test dieses Feldes: die reine Uebersetzung bliebe gruen, die Nutzlast liesse
// sie nur nie laufen -- und sechs Landschaftsflaechen stuenden wieder stumm da. Gefunden von der
// Mutationsprobe, nicht vom Autor.
assert(str_contains($nutzlast, '$kanonRaeume += avesmapsEcosystemNamespacesAusBeschriftungen($kanonRaeume, $labelRegions[\'by_label\'])'),
    '6d: die Kartennutzlast muss den Beschriftungs-Rueckfall wirklich aufrufen -- und mit `+=`, '
    . 'damit die Aussage der FLAECHE gewinnt');
assert(str_contains($nutzlast, '$labelRegions = avesmapsEcosystemReadLabelRegionMap($pdo);'),
    '6e: und die Bindung dafuer VOR der Kanon-Rechnung lesen');

$lib = klzOhneKommentare(__DIR__ . '/../feature-sources.php');
assert(str_contains($lib, "'ecosystem' => 'avesmapsEcosystemRegionWikiNamespaces'"),
    '6c: und an der zweiten Tuer (avesmapsFeatureSourcesWikiNamespacesFuerKennungen), sonst kippt '
    . 'das Etikett im Moment des Speicherns -- siehe §5');

// ---- 8. DAS SCHILD SPRINGT EIN, WENN DIE FLAECHE SCHWEIGT ---------------------------------------
//
// 🚩 Owner-Messung 10.09.2026, eine Stunde nach dem Dommel-Nachtrag: von den 9 Flaechen mit
// `{kanon: ''}` tragen SECHS einen Hauptraum-Artikel an ihrer Beschriftung, waehrend
// `ecosystem_region.wiki_url` leer ist (Albernia, Moosgrunder Tann, Madas Auge, Charyptik, Inirk,
// Dirak). Sie muessten „offiziell" sagen und sagten gar nichts.
//
// 💣 DAS WAR EINE REGRESSION DES DOMMEL-NACHTRAGS, keine alte Luecke: vorher griff fuer sie im
// Browser die Vorgabe „offiziell", und die war ZUFAELLIG richtig. Der ausdrueckliche Leer-Eintrag
// hat den Zufall beseitigt und damit sichtbar gemacht, dass der Namensraum-Leser eine Haelfte der
// Zuweisung nie gesehen hat. **Ein Zufall, der das Richtige tut, faellt erst auf, wenn man ihn
// wegnimmt.**

$rueckfall = avesmapsEcosystemNamespacesAusBeschriftungen(
    [
        'region:lbl-albernia' => 0,     // Schild im Hauptraum, Flaeche schweigt
        'region:lbl-inoff' => 222,      // Schild in ns 222, Flaeche schweigt
        'ecosystem:eco-eigen' => 0,     // Flaeche sagt Hauptraum ...
        'region:lbl-eigen' => 222,      // ... ihr Schild widerspricht
    ],
    [
        'lbl-albernia' => 'eco-albernia',
        'lbl-inoff' => 'eco-inoff',
        'lbl-eigen' => 'eco-eigen',
        'lbl-stumm' => 'eco-stumm',     // Schild ohne Namensraum
    ]
);

assert(($rueckfall['ecosystem:eco-albernia'] ?? null) === 0,
    '8a: DER GEMELDETE FALL -- schweigt die Flaeche, gilt der Artikel ihrer Beschriftung');
assert(($rueckfall['ecosystem:eco-inoff'] ?? null) === 222,
    '8b: und zwar in beide Richtungen, ns 222 genauso');
assert(!array_key_exists('ecosystem:eco-eigen', $rueckfall),
    '8c: 🔴 DIE FLAECHE ENTSCHEIDET. Hat sie eine eigene Adresse, wird sie NIE ueberstimmt -- die '
    . 'Beschriftung traegt nur eine Kopie (avesmapsEcosystemPushWikiRegionToLabels)');
assert(!array_key_exists('ecosystem:eco-stumm', $rueckfall),
    '8d: ein Schild ohne Namensraum erfindet keinen');

// 💣 UNEINIGE SCHILDER ERBEN NICHTS -- dieselbe Regel wie bei den Wegsegmenten. 13 von 1026
// Flaechen tragen zwei oder drei Beschriftungen; tragen zwei davon verschiedene Raeume, ist nicht
// entscheidbar, welcher gilt, und „im Zweifel offiziell" waere die unsichere Richtung.
assert(avesmapsEcosystemNamespacesAusBeschriftungen(
    ['region:a' => 0, 'region:b' => 222],
    ['a' => 'eco-uneinig', 'b' => 'eco-uneinig']
) === [], '8e: uneinige Schilder derselben Flaeche erben nichts');
assert(avesmapsEcosystemNamespacesAusBeschriftungen(
    ['region:a' => 0, 'region:b' => 0],
    ['a' => 'eco-einig', 'b' => 'eco-einig']
) === ['ecosystem:eco-einig' => 0], '8f: einige schon');

// ---- 8b. Und das Etikett kommt am Ende wirklich heraus -----------------------------------------
$mitSchild = klzGebundenesLabel('lbl-albernia', 'eco-albernia', KLZ_HAUPT);
$raeumeGesamt = avesmapsMapFeaturesWikiNamespaces([$mitSchild]) + avesmapsEcosystemRegionWikiNamespaces($pdo);
$raeumeGesamt += avesmapsEcosystemNamespacesAusBeschriftungen($raeumeGesamt, ['lbl-albernia' => 'eco-albernia']);
$kanonSchild = avesmapsFeatureSourcesDeriveKanon(
    $katalog,
    ['ecosystem:eco-albernia' => [['source_id' => 2, 'reference_kind' => 'beschrieben']]],
    $raeumeGesamt
);
assert(($kanonSchild['ecosystem:eco-albernia']['kanon'] ?? null) === 'offiziell',
    '8g: eine Flaeche mit reiner Publikation und einem Hauptraum-Artikel AM SCHILD sagt wieder '
    . '„offiziell" statt gar nichts -- der Fall, den der Dommel-Nachtrag stumm gemacht hatte');

// ⚠️ Und die drei ohne Artikel am Schild bleiben stumm -- Rang 5 gilt fuer sie weiter.
$kanonStumm = avesmapsFeatureSourcesDeriveKanon(
    $katalog,
    ['ecosystem:eco-stumm' => [['source_id' => 2, 'reference_kind' => 'beschrieben']]],
    $raeumeGesamt
);
assert(!isset($kanonStumm['ecosystem:eco-stumm']),
    '8h: ohne Artikel auf BEIDEN Seiten bleibt es bei „kein Etikett"');

// 💣 UND DIE ZWEITE TUER FUEHRT DENSELBEN RUECKFALL (Quelltext, weil ihr DB-Weg zwei volle
// Lesevorgaenge braucht, die eine SQLite-Fixture nicht nachstellt).
$libQuelle = klzOhneKommentare(__DIR__ . '/../feature-sources.php');
assert(str_contains($libQuelle, 'avesmapsEcosystemRaeumeAusBeschriftungen($pdo, $alle)'),
    '8i: der Schreibpfad ruft den Rueckfall ebenfalls -- sonst kippt das Etikett im Moment des '
    . 'Speicherns, der Schwanenbruch-Fehler in dritter Auflage');
assert(str_contains($libQuelle, 'return avesmapsEcosystemNamespacesAusBeschriftungen('),
    '8j: und zwar ueber DIESELBE reine Uebersetzung, nicht ueber eine zweite Fassung');

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
assert(isset($fassung[1]) && (int) $fassung[1] >= 26,
    '7a: die Nutzlastversion muss mit dieser Aenderung gestiegen sein (>= 26) -- der Fix aendert den\n    INHALT der Antwort, ohne ein Kartenobjekt anzufassen');
assert(str_contains((string) file_get_contents(__DIR__ . '/../../../app/map-features.php'), '// 24 (10.09.2026)')
    && str_contains((string) file_get_contents(__DIR__ . '/../../../app/map-features.php'), '// 26 (10.09.2026)'),
    '7b: und BEIDE Schritte tragen ihren Grund in der Liste ueber der Konstante -- der Altenforst-Fix\n    und der Dommel-Nachtrag gehen einzeln live und haben deshalb je einen eigenen Eintrag');

echo "OK: kanon-landschaft-zuweisung-test.php\n";
