<?php

declare(strict_types=1);

/**
 * DIE WIKI-ADRESSE KOMMT AUS DER ZUWEISUNG -- SIE WIRD NICHT MEHR AUS DEM NAMEN GERATEN.
 *
 * 🔴 OWNER-ENTSCHEID 08.09.2026, woertlich: „ich will dass du die regel zurückbaust, er soll das
 * gar nicht machen" und „wenn key dann url, wenn kein key keine url".
 *
 * 💣 WAS VORHER GALT UND WARUM ES WEG MUSSTE. `avesmapsEnrichMapFeatureWikiUrl` fuellte
 * `properties.wiki_url` aus dem NAMEN des Objekts: normalisierter Name -> gleichnamige Seite in
 * `wiki_sync_pages` -> deren Adresse. Der Schluessel im Zuweisungs-Nest spielte dabei KEINE Rolle
 * -- er war mit `wiki_url` ueberhaupt nicht verdrahtet. Am Livebestand vom 08.09.2026 gemessen:
 *   4442 Objekte, bei denen Rateweg und Zuweisung dasselbe sagen (Name = Artikelname),
 *     49 Objekte, bei denen der geratene Link auf einen ANDEREN Artikel zeigt als die Zuweisung,
 *    160 Objekte mit Link OHNE jede Zuweisung („Phantome"),
 *    171 Objekte MIT Zuweisung und OHNE Link („stumm" -- ihr Artikel heisst anders als sie).
 *
 * 💣 DER ANLASS WAR EIN DOPPELTER NAME. Zwei Waelder heissen „Falkenforst" -- einer in den
 * Nordmarken (der offizielle Artikel), einer in Weiden. Im Wiki gibt es GENAU EINE Seite dieses
 * Namens, also hing der Rateweg sie an BEIDE. Ein Editor konnte die Zuweisung loesen, so oft er
 * wollte: beim naechsten Lesen stand die Adresse wieder da, weil sie nirgends gespeichert war,
 * sondern jedes Mal neu erzeugt wurde. Dieselbe Ursache wie Discord #38 (d373ce6c4, 20.07.2026),
 * dort mit dem Merker `wiki_no_article` als Notausgang NEBEN der Regel behandelt statt mit einer
 * Rangfolge.
 *
 * 🔴 DIE NEUE REGEL, und sie hat keine dritte Quelle: eine ausdrueckliche Adresse in
 * `properties.wiki_url` gilt (Kraftlinien speichern sie dort), sonst die Adresse aus dem
 * Zuweisungs-Nest, sonst NICHTS.
 *
 * 🔴 `wiki_no_article` WURDE HIER BIS ZUM 09.09.2026 GEEHRT, und der Satz an dieser Stelle lautete:
 * „Wer ihn hier streicht, streicht keine tote Zeile, sondern die Zusicherung, dass ein kuenftiger
 * Erzeuger ihn nicht uebergeht." Er stimmte -- solange der Merker anderswo gelesen wurde. Genau das
 * ist mit dem Ausbau entfallen (Owner-Entscheid nach Durchsicht aller 10 Traeger), und damit war der
 * Riegel wirklich tot.
 * ⚠️ GEMESSEN, DASS DIE NUTZLAST SICH DABEI NICHT AENDERT -- an der LIVE-Nutzlast, nicht am Dump:
 * solange der Riegel stand, war ein Traeger genau ein Objekt, dessen ZUWEISUNGSNEST eine Adresse
 * trug, waehrend die flache `wiki_url` leer blieb. Am 09.09.2026 gezaehlt (Revision 119767):
 * **0 von 12.318 Objekten.** Deshalb blieb `AVESMAPS_MAP_FEATURES_PAYLOAD_VERSION` stehen; ein Bump
 * kostete jeden warmen Besucher rund 3 MB fuer dieselben Bytes. Die ausfuehrliche Begruendung samt
 * der Falle, die dabei aufflog, steht im Kopf von api/app/map-features.php.
 *
 * Kein HTTP, keine Datenbank: `map-features.php` fuehrt beim Laden seine Arbeit aus (Top-Level
 * `try`) und laesst sich nicht requiren. Die Funktion wird deshalb per TOKENIZER ausgeschnitten
 * und AUSGEFUEHRT -- nicht gelesen.
 * 💣 Tokenizer und nicht Klammernzaehlen auf dem Rohtext: ein Zaehler, der beim ersten `{` nach
 * dem Funktionskopf beginnt, endet bei einem `[] = []` nach zwei Zeichen, und ein
 * Blockkommentar-Entferner frisst an einem `/*` in einem Zeilenkommentar hunderte Zeilen echten
 * Code (AGENTS.md §11, eigene-knoten-Verdrahtungstest).
 *
 * Lauf (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 api/app/__tests__/wiki-url-aus-der-zuweisung-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'.\n");
    exit(2);
}

$wurzel = dirname(__DIR__, 3); // __tests__ -> app -> api -> <Repo>
$quelle = (string) file_get_contents($wurzel . '/api/app/map-features.php');
assert($quelle !== '', 'map-features.php nicht lesbar.');

/**
 * Schneidet eine Funktion per Tokenizer aus dem Quelltext.
 *
 * 🔴 Ueber die TOKEN, nicht ueber den Rohtext: nur so zaehlen Klammern in Zeichenketten und
 * Kommentaren nicht mit.
 */
function avesmapsTestSchneideFunktion(string $quelle, string $name): string
{
    $token = token_get_all($quelle);
    $start = null;
    $text = '';
    $tiefe = 0;
    $drin = false;

    foreach ($token as $i => $t) {
        if ($start === null) {
            if (!is_array($t) || $t[0] !== T_FUNCTION) {
                continue;
            }
            // Naechstes bedeutsames Token muss der gesuchte Name sein.
            for ($j = $i + 1; $j < count($token); $j++) {
                $n = $token[$j];
                if (is_array($n) && ($n[0] === T_WHITESPACE || $n[0] === T_COMMENT || $n[0] === T_DOC_COMMENT)) {
                    continue;
                }
                if (is_array($n) && $n[0] === T_STRING && $n[1] === $name) {
                    $start = $i;
                }
                break;
            }
            if ($start === null) {
                continue;
            }
        }

        $stueck = is_array($t) ? $t[1] : $t;
        $text .= $stueck;
        if ($stueck === '{') {
            $tiefe++;
            $drin = true;
        } elseif ($stueck === '}') {
            $tiefe--;
            if ($drin && $tiefe === 0) {
                return $text;
            }
        }
    }

    return '';
}

$rumpf = avesmapsTestSchneideFunktion($quelle, 'avesmapsEnrichMapFeatureWikiUrl');
assert($rumpf !== '', 'avesmapsEnrichMapFeatureWikiUrl nicht gefunden -- umbenannt?');

/**
 * Attrappe des Namensabgleichs -- NUR damit die ALTE Fassung ueberhaupt laeuft und dieser Test ein
 * ehrliches Rot zeigt (falsches Verhalten) statt eines Fatals (fehlende Abhaengigkeit).
 *
 * 🔴 Nach dem Umbau ruft sie niemand mehr; Abschnitt 7 nagelt genau das fest. Wer sie hier
 * entfernt, nimmt dem Test die Faehigkeit, einen Rueckbau des Rueckbaus als Rot zu zeigen.
 */
if (!function_exists('avesmapsWikiSyncCreateMatchKey')) {
    function avesmapsWikiSyncCreateMatchKey(string $wert): string
    {
        return mb_strtolower(trim($wert), 'UTF-8');
    }
}

// ⚠️ `eval` ist hier bewusst und ungefaehrlich: die Eingabe ist AUSSCHLIESSLICH der eigene
// Repo-Quelltext (`api/app/map-features.php`, per Tokenizer auf eine Funktion beschnitten), nie
// eine Eingabe von aussen. Es ist das Hausmuster fuer Funktionen, die in einem Endpunkt wohnen und
// sich nicht requiren lassen (AGENTS.md §11, aenderungen-sprungpunkt-karte-test.php).
eval($rumpf);
assert(
    function_exists('avesmapsEnrichMapFeatureWikiUrl'),
    'Die ausgeschnittene Funktion liess sich nicht ausfuehren.'
);

/**
 * Ruft die Funktion und fuellt jeden Parameter, den sie noch hat.
 *
 * 🔴 Sie nimmt heute NUR die Properties. Ein zweiter (`$row`) oder dritter (ein Rate-Register)
 * Parameter waere der Beweis, dass der Rueckbau zurueckgebaut wurde -- deshalb werden sie hier
 * gefuellt uebergeben statt weggelassen: der Test soll den Rateweg SEHEN, nicht umgehen.
 */
function ruf(array $properties, array $row): array
{
    $spiegel = new ReflectionFunction('avesmapsEnrichMapFeatureWikiUrl');
    $args = [$properties];
    if ($spiegel->getNumberOfParameters() >= 2) {
        $args[] = $row;
    }
    if ($spiegel->getNumberOfParameters() >= 3) {
        $args[] = ['falkenforst' => 'https://de.wiki-aventurica.de/wiki/Falkenforst'];
    }

    return $spiegel->invokeArgs($args);
}

$fehler = 0;
$pruefe = static function (string $was, bool $ok) use (&$fehler): void {
    if (!$ok) {
        $fehler++;
        fwrite(STDERR, "ROT: {$was}\n");
    }
};

// ---------------------------------------------------------------------------
// 1) DER FALKENFORST-FALL: gleicher Name wie eine Wiki-Seite, KEINE Zuweisung -> KEIN Link.
//    Das ist die Zusicherung, um die es dem Owner ging.
// ---------------------------------------------------------------------------
$ohneZuweisung = ruf(
    ['name' => 'Falkenforst', 'feature_type' => 'label'],
    ['name' => 'Falkenforst', 'feature_type' => 'label']
);
$pruefe(
    'ohne Zuweisung entsteht keine Adresse (der Rateweg ist zurueckgebaut)',
    trim((string) ($ohneZuweisung['wiki_url'] ?? '')) === ''
);

// ---------------------------------------------------------------------------
// 2) MIT Zuweisung gilt DEREN Adresse -- je Objektart ein eigenes Nest.
// ---------------------------------------------------------------------------
$faelle = [
    'wiki_settlement' => ['location', 'https://de.wiki-aventurica.de/wiki/Gareth'],
    'wiki_path'       => ['path',     'https://de.wiki-aventurica.de/wiki/Reichsstrasse'],
    'wiki_region'     => ['label',    'https://de.wiki-aventurica.de/wiki/Charyptisch'],
];
foreach ($faelle as $nest => [$typ, $adresse]) {
    $aus = ruf(
        ['name' => 'Charyptik', 'feature_type' => $typ, $nest => ['wiki_key' => 'k', 'wiki_url' => $adresse]],
        ['name' => 'Charyptik', 'feature_type' => $typ]
    );
    $pruefe("{$nest}: die zugewiesene Adresse gilt", (string) ($aus['wiki_url'] ?? '') === $adresse);
}

// ---------------------------------------------------------------------------
// 3) Die Zuweisung schlaegt den Namen. GENAU DIESE 49 Objekte aendern sich live:
//    das Nest zeigt auf einen anderen Artikel als der gleichnamige.
// ---------------------------------------------------------------------------
$anders = ruf(
    [
        'name' => 'Falkenforst',
        'feature_type' => 'label',
        'wiki_region' => ['wiki_key' => 'brydia', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Brydia'],
    ],
    ['name' => 'Falkenforst', 'feature_type' => 'label']
);
$pruefe(
    'die Zuweisung schlaegt den gleichnamigen Artikel',
    (string) ($anders['wiki_url'] ?? '') === 'https://de.wiki-aventurica.de/wiki/Brydia'
);

// ---------------------------------------------------------------------------
// 4) Ein Nest OHNE Adresse ist keine Adresse -- und kein Anlass, doch zu raten.
// ---------------------------------------------------------------------------
$nestLeer = ruf(
    ['name' => 'Falkenforst', 'feature_type' => 'label', 'wiki_region' => ['wiki_key' => 'falkenforst', 'wiki_url' => '']],
    ['name' => 'Falkenforst', 'feature_type' => 'label']
);
$pruefe('leeres wiki_url im Nest erzeugt keine Adresse', trim((string) ($nestLeer['wiki_url'] ?? '')) === '');

// ---------------------------------------------------------------------------
// 5) Eine bereits gespeicherte Adresse bleibt unangetastet (Kraftlinien speichern sie direkt).
// ---------------------------------------------------------------------------
$schonDa = ruf(
    ['name' => 'Mittellandlinie', 'feature_type' => 'powerline', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Mittellandlinie'],
    ['name' => 'Mittellandlinie', 'feature_type' => 'powerline']
);
$pruefe(
    'eine gespeicherte Adresse bleibt stehen',
    (string) ($schonDa['wiki_url'] ?? '') === 'https://de.wiki-aventurica.de/wiki/Mittellandlinie'
);

// ---------------------------------------------------------------------------
// 5b) DIE ZUWEISUNG SCHLAEGT DIE GESPEICHERTE ADRESSE (Owner 08.09.2026).
//
// 💣 DIESER ABSCHNITT IST DER GRUND, WARUM 5 ALLEIN NICHT REICHT. Abschnitt 5 prueft mit einem
// Objekt OHNE Nest -- und ohne Nest gibt die Funktion die Properties sowieso unveraendert zurueck,
// mit oder ohne Rangfolge. Er war damit ein VAKUUM: eine Fassung, die die Frueh-Kehr ersatzlos
// streicht, bestand ihn. Gefunden von einer Mutationsprobe (M3), nicht vom Autor.
// 🔴 Am Livebestand vom 08.09.2026 gibt es diesen Fall 43-mal, und in jedem einzelnen ist die
// Zuweisung die richtige Adresse: „Alfwalden" trug gespeichert `/Alfensen`, „Goldklamm (Rorwhed)"
// trug `/Goldklamm_(Kosch)`.
// ---------------------------------------------------------------------------
$beides = ruf(
    [
        'name' => 'Alfwalden',
        'feature_type' => 'location',
        'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Alfensen',
        'wiki_settlement' => ['wiki_key' => 'alfwalden', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Alfwalden'],
    ],
    ['name' => 'Alfwalden', 'feature_type' => 'location']
);
$pruefe(
    'die Zuweisung schlaegt die gespeicherte flache Adresse',
    (string) ($beides['wiki_url'] ?? '') === 'https://de.wiki-aventurica.de/wiki/Alfwalden'
);

// ---------------------------------------------------------------------------
// 5c) Kraftlinien haben sehr wohl ein Nest -- und es gilt.
//
// 🪤 Der Kommentar an der Funktion behauptete zuerst „Kraftlinien und Karten haben keins". Am
// Livebestand gemessen ist das falsch: 82 Segmente tragen `wiki_powerline.wiki_url`, 13 davon
// (die ganze Kraftlinie „Faecher der Macht") hatten deshalb weder Link noch Kanon-Etikett.
// ---------------------------------------------------------------------------
$kraftlinie = ruf(
    [
        'name' => 'Fächer der Macht',
        'feature_type' => 'powerline',
        'wiki_powerline' => ['wiki_key' => 'faecher-der-macht', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Fächer_der_Macht'],
    ],
    ['name' => 'Fächer der Macht', 'feature_type' => 'powerline']
);
$pruefe(
    'die Zuweisung einer Kraftlinie gilt',
    (string) ($kraftlinie['wiki_url'] ?? '') === 'https://de.wiki-aventurica.de/wiki/Fächer_der_Macht'
);

// ---------------------------------------------------------------------------
// 5d) DIE NEST-LISTE IST NICHT ABGESCHRIEBEN, SIE WIRD GEGENGEHALTEN.
//
// 💣 `AVESMAPS_CONFLICT_CLAIM_BLOCKS` (api/_internal/conflicts/core.php) ist die eine Liste der
// Zuweisungs-Nester. Sie war dort schon einmal abgeschrieben, und die Abschrift kannte
// `wiki_powerline` nicht (der Kommentar in repair.php:179 sagt es). `map-features.php` ist ein
// Endpunkt und laedt die Konflikt-Bibliothek nicht -- die Liste steht dort also zwangslaeufig ein
// zweites Mal. Dann muss wenigstens ein Test die beiden gegeneinander halten.
// ---------------------------------------------------------------------------
require_once $wurzel . '/api/_internal/conflicts/core.php';
preg_match("/foreach \(\[([^\]]*)\] as \\\$nest\)/", $rumpf, $listeTreffer);
preg_match_all("/'(\w+)'/", (string) ($listeTreffer[1] ?? ''), $namen);
$imLesepfad = $namen[1] ?? [];
sort($imLesepfad);
$imKonflikt = AVESMAPS_CONFLICT_CLAIM_BLOCKS;
sort($imKonflikt);
$pruefe(
    'die Nest-Liste des Lesepfads deckt sich mit AVESMAPS_CONFLICT_CLAIM_BLOCKS ('
        . implode(', ', $imLesepfad) . ' gegen ' . implode(', ', $imKonflikt) . ')',
    $imLesepfad === $imKonflikt
);

// ---------------------------------------------------------------------------
// 5e) UND BEIDE LESER GEBEN DIESELBE ANTWORT. `avesmapsConflictExtractClaim` beantwortet dieselbe
// Frage fuer das Konfliktzentrum; liefe seine Rangfolge auseinander, nennte die Karte einen anderen
// Artikel als der Fall, der ihn beanstandet.
// ---------------------------------------------------------------------------
$anspruch = avesmapsConflictExtractClaim([
    'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Alfensen',
    'wiki_settlement' => ['wiki_key' => 'alfwalden', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Alfwalden'],
]);
$pruefe(
    'das Konfliktzentrum nennt denselben Artikel wie die Karte',
    (string) ($anspruch['wiki_url'] ?? '') === (string) ($beides['wiki_url'] ?? '')
);
$pruefe(
    'und weist ihn dem NEST zu -- daran haengt die Absage beim „Trennen"',
    (string) ($anspruch['claim_source'] ?? '') === 'wiki_settlement'
);

// ---------------------------------------------------------------------------
// 6) DER MERKER SCHWEIGT NICHT MEHR -- er ist ausgebaut (Owner-Entscheid 09.09.2026).
// ---------------------------------------------------------------------------
// 🔴 UMGEDREHT: hier stand „`wiki_no_article` schweigt, auch gegen eine Zuweisung". Ein
// Altbestand-Traeger, der zugleich eine ZUWEISUNG hat, bekommt seither ihre Adresse -- der Merker
// entscheidet nichts mehr. Genau dieser Fall (Altenau) war der EINZIGE im ganzen Bestand, an dem
// der Wegfall des Riegels ueberhaupt sichtbar wurde; er ist am 09.09.2026 korrigiert worden.
$keinArtikel = ruf(
    [
        'name' => 'Falkenforst',
        'feature_type' => 'label',
        'wiki_no_article' => true,
        'wiki_region' => ['wiki_key' => 'falkenforst', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Falkenforst'],
    ],
    ['name' => 'Falkenforst', 'feature_type' => 'label']
);
$pruefe(
    'ein Altbestand-Merker haelt die Zuweisung nicht mehr auf',
    trim((string) ($keinArtikel['wiki_url'] ?? '')) === 'https://de.wiki-aventurica.de/wiki/Falkenforst'
);
// ⚠️ Und OHNE Zuweisung bleibt es bei nichts -- der Merker erzeugt keine Adresse, er verhindert
// auch keine. Er ist schlicht kein Eingang mehr.
$nurMerker = ruf(
    ['name' => 'Falkenforst', 'feature_type' => 'label', 'wiki_no_article' => true],
    ['name' => 'Falkenforst', 'feature_type' => 'label']
);
$pruefe(
    'ohne Zuweisung entsteht weiterhin keine Adresse',
    trim((string) ($nurMerker['wiki_url'] ?? '')) === ''
);

// ---------------------------------------------------------------------------
// 7) DER RATEWEG IST WIRKLICH WEG -- am Quelltext, nicht am Verhalten.
//    ⚠️ Verhalten allein reichte nicht: eine Fassung, die erst das Nest liest und NUR BEI LEERE
//    raet, bestuende die Abschnitte 1-6 und liesse die 160 Phantome stehen.
// ---------------------------------------------------------------------------
$pruefe('kein Namensabgleich mehr in der Funktion', !str_contains($rumpf, 'avesmapsWikiSyncCreateMatchKey'));
$pruefe('kein Rate-Register mehr in der Funktion', !str_contains($rumpf, 'wikiLocationLinks'));
$pruefe(
    'die Volltabellen-Abfrage auf wiki_sync_pages ist aus dem Nutzlast-Aufbau raus',
    !str_contains($quelle, 'avesmapsLoadWikiSyncLocationLinks')
);

if ($fehler > 0) {
    fwrite(STDERR, "\n{$fehler} Zusicherung(en) rot.\n");
    exit(1);
}

echo "OK: die Wiki-Adresse kommt aus der Zuweisung, nicht aus dem Namen.\n";
