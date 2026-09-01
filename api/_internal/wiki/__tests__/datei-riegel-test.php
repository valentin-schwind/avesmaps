<?php

declare(strict_types=1);

/**
 * DER REPOWEITE SCANNER, DEN `datei-riegel.php:26` SEIT JEHER VERSPRICHT.
 *
 * 🔴 WARUM ES IHN GIBT: der Kopf des Riegels verweist als eigentliche Autoritaet auf genau diese
 * Datei -- „der laeuft ueber das ganze Repo\" -- und sie hat bis zum 01.09.2026 NICHT EXISTIERT.
 * Zwei Zeilen darueber warnt derselbe Kopf davor, einer Aufzaehlung zu glauben („eine Zahl liest
 * sich wie eine vollstaendige Liste, und niemand zaehlt nach\"). Genau das ist an ihm selbst
 * eingetreten: er behauptete „ES GIBT GENAU ZWEI FETCHER\", es waren vier.
 *
 * 🔴 DIE REGEL DES EIGENTUEMERS (01.09.2026, mit Abschaltdrohung): es darf NIRGENDS ein Bild live
 * vom Wiki geholt werden, ausser wenn ein Editor auf einen der beiden „Hole Wiki-Wappen\"-Knoepfe
 * drueckt. Zwei Sperren haben das schon gekostet.
 *
 * 💣 DIE TEUERSTE LUECKE LAG NICHT IM PHP. Riegel, Drossel und Ausgabefilter sitzen alle
 * serverseitig; ein `<img src=\"<Wiki-Adresse>\">` im Browser geht an ALLEN vorbei, weil unser Server
 * die Anfrage nie sieht. Gefunden wurden zehn fest verdrahtete Wiki-Bildadressen in
 * js/map-features/map-features-place-extras.js -- ausgeliefert an JEDEN Besucher. Deshalb prueft
 * dieser Scanner BEIDE Seiten, und Abschnitt 1 ist der wichtigere.
 *
 * Lauf:  php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/datei-riegel-test.php
 */

// 🪤 Slashes vereinheitlichen: `dirname()` liefert auf Windows Backslashes, die gesammelten Pfade
// tragen Slashes. Ohne das greift die Ausnahmeliste unten NIE, und der Test meldet ein Dutzend
// Fehlalarme -- die man dann einzeln „wegerklaert", bis er nichts mehr sagt.
$wurzel = str_replace('\\', '/', dirname(__DIR__, 4));
$pruefungen = 0;
$pruefe = static function (bool $bedingung, string $text) use (&$pruefungen): void {
    assert($bedingung, $text);
    $pruefungen++;
};

/**
 * Kommentare entfernen, bevor irgendetwas gesucht wird.
 *
 * 🪤 OHNE DAS SCHLAEGT DER SCANNER AN SEINEN EIGENEN WARNUNGEN AN. Jede Stelle, die eine
 * Wiki-Adresse beseitigt hat, erklaert im Kommentar, was dort stand -- und mehrere Dateien nennen
 * `wiki-aventurica` in ihrer Begruendung. Ein Test, der Kommentare mitliest, ist am Tag seiner
 * Entstehung rot und wird dann mit Ausnahmen zugeschuettet, bis er nichts mehr sagt.
 */
function avesmapsRiegelTestOhneKommentare(string $text): string
{
    $text = preg_replace('~/\*.*?\*/~s', ' ', $text) ?? $text;
    $text = preg_replace('~^\s*(//|\*|#).*$~m', ' ', $text) ?? $text;
    // Zeilenkommentare hinter Code (` // ...`) -- konservativ: nur wenn ein Leerzeichen davor steht.
    return preg_replace('~\s//[^\n\r]*~', ' ', $text) ?? $text;
}

/** Alle Dateien unter $verzeichnis mit einer der Endungen, ohne __tests__ und ohne third-party. */
function avesmapsRiegelTestDateien(string $wurzel, string $verzeichnis, array $endungen): array
{
    $basis = $wurzel . '/' . $verzeichnis;
    if (!is_dir($basis)) {
        return [];
    }
    $gefunden = [];
    $lauf = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($basis, FilesystemIterator::SKIP_DOTS)
    );
    foreach ($lauf as $eintrag) {
        $pfad = str_replace('\\', '/', $eintrag->getPathname());
        if (!$eintrag->isFile()) {
            continue;
        }
        if (str_contains($pfad, '/__tests__/') || str_contains($pfad, '/third-party/')
            || str_contains($pfad, '/.claude/') || str_contains($pfad, '/node_modules/')) {
            continue;
        }
        if (!in_array(strtolower($eintrag->getExtension()), $endungen, true)) {
            continue;
        }
        $gefunden[] = $pfad;
    }
    sort($gefunden);
    return $gefunden;
}

// =====================================================================================
// ABSCHNITT 1 -- KEINE WIKI-BILDADRESSE IM AUSGELIEFERTEN CODE
// =====================================================================================
// 🔴 Das ist die Haelfte, an der jede bisherige Reparatur vorbeigelaufen ist. Eine Wiki-Adresse in
// js/ oder html/ landet frueher oder spaeter in einem `<img src>`, und dann holt sie der BROWSER --
// ohne unseren Server, also ohne jede Sperre, die wir bauen koennen.
//
// ⚠️ ARTIKEL-Links (`/wiki/<Titel>`) sind ausdruecklich erlaubt: ein `<a href>` loest keine Anfrage
// aus, und die Karte verlinkt bewusst ins Wiki. Gesucht wird nur, was ein BILD adressiert.

$bildMuster = '~https?://[a-z0-9.-]*wiki-aventurica\.de/[^"\'\s)]*'
    . '(?:/images/|Spezial:Dateipfad|Special:FilePath|\.(?:png|jpe?g|gif|svg|webp))~i';

$treffer = [];
foreach ([['js', ['js']], ['html', ['html']], ['css', ['css']]] as [$verzeichnis, $endungen]) {
    foreach (avesmapsRiegelTestDateien($wurzel, $verzeichnis, $endungen) as $pfad) {
        $roh = (string) file_get_contents($pfad);
        if (!str_contains($roh, 'wiki-aventurica')) {
            continue;
        }
        $ohne = avesmapsRiegelTestOhneKommentare($roh);
        if (preg_match_all($bildMuster, $ohne, $funde)) {
            foreach ($funde[0] as $fund) {
                $treffer[] = str_replace($wurzel . '/', '', $pfad) . '  ->  ' . substr($fund, 0, 90);
            }
        }
    }
}
$pruefe($treffer === [],
    "Im ausgelieferten Code steht eine WIKI-BILDADRESSE. Der Browser holt so ein Bild DIREKT beim\n"
    . "Wiki -- an Riegel, Drossel und Ausgabefilter vorbei, weil unser Server die Anfrage nie sieht.\n"
    . "Genau diese Bauform hat zweimal die Sperre unserer Ausgangs-IP ausgeloest.\n"
    . "Ein Bild gehoert auf UNSEREN Server (/uploads/...), geholt vom Lauf \"Hole Wiki-Wappen\".\n"
    . "Gefunden:\n  " . implode("\n  ", $treffer));

// Dasselbe fuer PHP: eine Wiki-Bildadresse als LITERAL (z. B. in Saatdaten) landet ueber die
// Datenbank in genau denselben `<img src>`.
// 💣 Genau so ist es passiert: die Saat in api/_internal/app/game-literature.php schrieb eine
// Wiki-Cover-Adresse in `adventure.cover_url`, und der Literatur-Editor baute daraus sein Bild.
// Der Wert hatte die Umbenennung adventures.php -> game-literature.php unbeschadet ueberlebt.
$treffer = [];
foreach (avesmapsRiegelTestDateien($wurzel, 'api', ['php']) as $pfad) {
    $roh = (string) file_get_contents($pfad);
    if (!str_contains($roh, 'wiki-aventurica')) {
        continue;
    }
    // ⚠️ Der Aufloeser darf eine Bildadresse BAUEN -- das ist seine Aufgabe, und was er baut, wird
    // vom Riegel bewacht. Verboten ist die fest verdrahtete Adresse eines KONKRETEN Bildes.
    $ohne = avesmapsRiegelTestOhneKommentare($roh);
    if (preg_match_all($bildMuster, $ohne, $funde)) {
        foreach ($funde[0] as $fund) {
            // Eine Adresse ohne Dateinamen ist ein Baustein (Praefix), kein konkretes Bild.
            if (preg_match('~(?:/images/|Dateipfad/|FilePath/)$~i', $fund)) {
                continue;
            }
            $treffer[] = str_replace($wurzel . '/', '', $pfad) . '  ->  ' . substr($fund, 0, 90);
        }
    }
}
$pruefe($treffer === [],
    "In api/ steht die fest verdrahtete Adresse eines konkreten WIKI-BILDES. Ueber die Datenbank\n"
    . "landet so ein Wert in einem `<img src>` des Editors und wird vom Browser direkt geholt.\n"
    . "Gefunden:\n  " . implode("\n  ", $treffer));

// =====================================================================================
// ABSCHNITT 2 -- JEDER AUSGEHENDE FETCHER FRAGT DEN RIEGEL
// =====================================================================================
// 🔴 Hier stand die Zahl, die falsch war. Statt einer Aufzaehlung wird GEZAEHLT: jede Datei unter
// api/, die einen ausgehenden Abruf macht, muss den Riegel fragen -- oder mit Begruendung auf der
// Ausnahmeliste stehen.

/**
 * Die Ausnahmen, jede mit ihrem Grund. 🔴 Wer hier etwas eintraegt, erklaert WARUM.
 * ⚠️ „Faellt mir gerade nichts ein\" ist kein Grund -- dann gehoert der Riegel davor.
 */
$ausnahmen = [
    // Der Riegel selbst und seine Nachbarn definieren die Frage, sie stellen sie nicht.
    'api/_internal/wiki/datei-riegel.php' => 'definiert den Riegel',
    'api/_internal/wiki/drossel.php' => 'definiert die Drossel',
    // Text, nicht Bild: die MediaWiki-API ist ausdruecklich ausgenommen (siehe datei-riegel.php).
    'api/_internal/wiki/sync.php' => 'MediaWiki-API (Artikeltext), ausdruecklich ausgenommen',
    'api/_internal/wiki/datei-adresse.php' => 'fragt api.php nach der Bildadresse, holt kein Bild',
    // Der XML-Dump ist eine Datei, aber ein anderer Wirt und ein anderer Vorgang.
    'api/_internal/wiki/dump-fetch.php' => 'offline.wiki-aventurica.de, XML-Dump statt Bild',
    // Feste fremde Wirte -- der Riegel gilt dem Wiki, nicht dem Internet.
    'api/_internal/import/garetien-abruf.php' => 'garetien.de / koschwiki.de',
    'api/_internal/diagnostics/ausgang-sonde.php' => 'feste Zielliste, kein Wiki',
    'api/_internal/social/connect.php' => 'Graph-API',
    'api/_internal/social/media.php' => 'eigener Server',
    'api/_internal/social/relay.php' => 'api.github.com',
    'api/_internal/social/adapters/facebook.php' => 'Graph-API',
    'api/_internal/social/adapters/instagram.php' => 'Graph-API',
    'api/_internal/social/adapters/mastodon.php' => 'Mastodon-Instanz',
    'api/_internal/discord/post-message.php' => 'discord.com',
    'api/discord/register-commands.php' => 'discord.com',
    'api/_internal/mail/mailer.php' => 'SMTP, kein HTTP',
];

$ungebunden = [];
foreach (avesmapsRiegelTestDateien($wurzel, 'api', ['php']) as $pfad) {
    $rel = str_replace($wurzel . '/', '', $pfad);
    if (isset($ausnahmen[$rel])) {
        continue;
    }
    $ohne = avesmapsRiegelTestOhneKommentare((string) file_get_contents($pfad));
    // 🪤 NUR ECHTE AUSGAENGE. Die erste Fassung nahm jedes `file_get_contents($...)` und meldete
    // damit 24 Dateien, die schlicht eine LOKALE Datei mit variablem Pfad lesen (Cache-Ablage,
    // SVG-Abzug, Datenbank-Dump). Ein Test, der beim ersten Lauf zwei Dutzend Fehlalarme wirft,
    // wird mit Ausnahmen zugeschuettet, bis er nichts mehr sagt.
    // Gemessen wird deshalb `curl_exec(` -- und `file_get_contents` nur, wenn dieselbe Datei einen
    // HTTP-Stream-Kontext baut (so holt sync.php die MediaWiki-API).
    $holtEtwas = str_contains($ohne, 'curl_exec(')
        || (str_contains($ohne, 'stream_context_create')
            && str_contains($ohne, 'file_get_contents(')
            && preg_match('~[\'"]https?[\'"]\s*=>~', $ohne) === 1);
    if (!$holtEtwas) {
        continue;
    }
    // 🪤 GEZAEHLT, NICHT GESUCHT. Ein blosses str_contains fragt „steht der Riegel irgendwo in der
    // Datei" -- und probe.php hat ZWEI Fetcher: entfernt man den Riegel aus einem, findet der Test
    // ihn im anderen und bleibt gruen. Die Mutationsprobe hat genau das aufgedeckt.
    // Also: mindestens ein Riegel je Ausgang.
    $ausgaenge = substr_count($ohne, 'curl_exec(');
    $riegel = substr_count($ohne, 'avesmapsWikiDateiAbrufErlaubt');
    if ($riegel < max(1, $ausgaenge)) {
        $ungebunden[] = $rel . ($ausgaenge > 1 ? " ({$ausgaenge} Ausgaenge, nur {$riegel} Riegel)" : '');
    }
}
$pruefe($ungebunden === [],
    "Diese Datei(en) machen einen ausgehenden Abruf, fragen aber den Riegel nicht:\n  "
    . implode("\n  ", $ungebunden) . "\n"
    . "Entweder `avesmapsWikiDateiAbrufErlaubt(\$url)` davorsetzen (und BEVOR die Drossel gefragt\n"
    . "wird -- ein geriegelter Abruf hat nie eine Anfrage gestellt), oder mit Begruendung in die\n"
    . "Ausnahmeliste in diesem Test eintragen.");

// =====================================================================================
// ABSCHNITT 3 -- DER RIEGEL IST ZU, UND DIE ZWEI KNOEPFE KOENNEN IHN TROTZDEM PASSIEREN
// =====================================================================================
require_once dirname(__DIR__) . '/datei-riegel.php';

$pruefe(AVESMAPS_WIKI_DATEI_ABRUF_ERLAUBT === false,
    "AVESMAPS_WIKI_DATEI_ABRUF_ERLAUBT steht auf true -- damit darf JEDE Stelle im Haus Bilder beim\n"
    . "Wiki holen. Der Eigentuemer hat das am 01.09.2026 ausdruecklich untersagt. Wer einen einzelnen\n"
    . "Weg wieder braucht, huellt IHN in avesmapsWikiAusdruecklicherAbruf -- nicht diese Konstante.");

$wikiBild = 'https://de.wiki-aventurica.de/de/images/thumb/5/55/Beispiel.jpg';
$pruefe(avesmapsWikiDateiAbrufErlaubt($wikiBild) === false, 'Ein Wiki-Bild ist ausserhalb eines Laufs nicht geriegelt.');
$pruefe(avesmapsWikiDateiAbrufErlaubt('https://example.invalid/bild.png') === true,
    'Der Riegel gilt dem Wiki, nicht dem Internet -- ein fremder Wirt darf.');

// 🔴 Die Ausnahme MUSS wirken, sonst sind die zwei „Hole Wiki-Wappen\"-Knoepfe kaputt -- und genau
// das war bis zum 01.09.2026 der Grund, warum der Riegel offen stehen musste.
$drin = avesmapsWikiAusdruecklicherAbruf(static fn(): bool => avesmapsWikiDateiAbrufErlaubt($wikiBild));
$pruefe($drin === true, 'Innerhalb eines ausdruecklichen Laufs muss das Wiki erreichbar sein.');
$pruefe(avesmapsWikiDateiAbrufErlaubt($wikiBild) === false, 'Nach dem Lauf muss der Riegel wieder zu sein.');

try {
    avesmapsWikiAusdruecklicherAbruf(static function (): void { throw new RuntimeException('Abbruch'); });
} catch (Throwable) {
    // erwartet
}
$pruefe(avesmapsWikiDateiAbrufErlaubt($wikiBild) === false,
    'Nach einem Wurf im Lauf bleibt der Riegel offen -- das `finally` im Wrapper greift nicht.');

// =====================================================================================
// ABSCHNITT 4 -- DIE ZWEI LAEUFE BENUTZEN DIE AUSNAHME AUCH WIRKLICH
// =====================================================================================
// 💣 Ohne diese Zusicherung faellt der Umbau vom 01.09.2026 lautlos zurueck: der Riegel bliebe zu,
// die Knoepfe meldeten „Wappen konnte nicht heruntergeladen werden\", und der naechste Leser machte
// die Konstante wieder auf, statt die Huelle zu suchen.
foreach ([
    'api/_internal/wiki/settlements-coat-localize.php' => 'avesmapsWikiSettlementLocalizeCoats',
    'api/_internal/wiki/sync-monitor-identity.php' => 'avesmapsWikiSyncMonitorLocalizeCoats',
] as $rel => $funktion) {
    $ohne = avesmapsRiegelTestOhneKommentare((string) file_get_contents($wurzel . '/' . $rel));
    // 🪤 GEPRUEFT WIRD DIE HUELLE, NICHT DIE DATEI. `sync-monitor-identity.php` ruft den Wrapper auch
    // an einer ganz anderen Stelle (Upload per Bild-URL); ein blosses str_contains findet DEN und
    // bleibt gruen, waehrend der Lauf selbst ungeschuetzt ist. Auch das hat die Mutationsprobe
    // aufgedeckt. Also: der innere Lauf muss existieren UND aus dem Wrapper heraus gerufen werden.
    $pruefe(str_contains($ohne, $funktion . 'Ausfuehren'),
        "$rel hat keinen inneren Lauf \"{$funktion}Ausfuehren\" -- die Huelle, die den Riegel oeffnet,\n"
        . "fehlt oder wurde zurueckgebaut.");
    $pruefe(preg_match('~avesmapsWikiAusdruecklicherAbruf\s*\([^;]{0,400}' . preg_quote($funktion, '~') . 'Ausfuehren~s', $ohne) === 1,
        "$rel ruft \"{$funktion}Ausfuehren\" nicht aus avesmapsWikiAusdruecklicherAbruf heraus -- der\n"
        . "Lauf kaeme am geschlossenen Riegel nicht vorbei, und der Knopf des Eigentuemers waere kaputt.");
    $pruefe(str_contains($ohne, "require_once __DIR__ . '/datei-riegel.php'"),
        "$rel bindet datei-riegel.php nicht selbst ein -- ein fehlendes require waere ein Fatal mit\n"
        . "LEEREM Rumpf, im Browser nicht von einem Netzfehler zu unterscheiden.");
}

echo "datei-riegel: {$pruefungen} Pruefungen bestanden.\n";
