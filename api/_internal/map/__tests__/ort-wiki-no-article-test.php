<?php

declare(strict_types=1);

/**
 * Die drei Wiki-Textfelder eines Ortes (Einwohner · Lage · Oberhaupt) und ihre vier Kopplungen --
 * Wiki-Nest, Server, zwei Formulare. Lauf (aus dem Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       api/_internal/map/__tests__/ort-wiki-no-article-test.php
 *
 * 🔴 DER DRITTE ZUSTAND, DER DIESER DATEI IHREN NAMEN GAB, IST AUSGEBAUT (Owner-Entscheid
 * 09.09.2026, nach Durchsicht aller 10 Traeger). Warum es ihn gab -- damit ihn niemand aus
 * Versehen wieder einfuehrt: `avesmapsEnrichMapFeatureWikiUrl` (api/app/map-features.php) RIET die
 * Wiki-Adresse eines Ortes aus seinem NAMEN, sobald `properties.wiki_url` leer war. „Geloescht" und
 * „nie gesetzt" waren fuer sie dasselbe -- ein entfernter Wiki-Link kehrte beim naechsten
 * Kartenladen zurueck (Discord #38). Nur eine NEGATIVE Aussage brach das, und die war
 * `properties.wiki_no_article`.
 * ⭐ Commit `420f12cfc` hat das Raten zurueckgebaut: der Server schlaegt nichts mehr vor, 》Trennen《
 * haelt von allein, und der Merker hatte keinen Gegenstand mehr. Sein Aequivalent ist die
 * WIKI-ZUWEISUNG -- das Nest `wiki_settlement`, NIE `properties.wiki_url`.
 * ⚠️ DER DATEINAME BLEIBT. Die Zusicherungen unten sind die Rueckbau-Waechter des Merkers, und wer
 * in einem Jahr `git log --follow` auf ihn ansetzt, findet ihn nur unter diesem Namen. Der
 * ausfuehrliche Waechter mit dem Owner-Wortlaut steht in
 * api/_internal/conflicts/__tests__/kein-wiki-eintrag-ist-weg-test.php.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

require __DIR__ . '/../features.php';

// ── 1) 🔴 DER RECHNER FASST DEN MERKER NICHT MEHR AN -- IN KEINE RICHTUNG ─────────────────────
// Hier standen drei Abschnitte: „abwesend heisst nicht geaendert" (die tragende Zusicherung, gegen
// die Ladeluecke eines Deploys -- eine gecachte index.html ohne das Feld haette sonst bei JEDEM
// Speichern die Entscheidung des Konfliktzentrums zurueckgenommen), „ausdruecklich gesetzt und
// ausdruecklich entfernt" samt der Formen von avesmapsReadBoolean, und der WIDERSPRUCHS-RIEGEL
// (Adresse UND „kein Artikel" zugleich wurde ABGELEHNT, nie still aufgeloest -- er prueft gegen den
// GESPEICHERTEN Merker, nicht nur gegen den gesendeten).
// Alle drei sind am 09.09.2026 mit dem Merker gefallen; der Riegel hatte danach keinen verbotenen
// Zustand mehr zu bewachen, weil eine der beiden Aussagen nicht mehr existiert.
// 💣 WAS BLEIBT, IST DIE ZUSICHERUNG IN BEIDE RICHTUNGEN, und beide werden gebraucht: der Rechner
// darf einen Altbestand-Schluessel weder WEGRAEUMEN (das gehoert der einmaligen Bestandsreparatur,
// Schritt 4 -- ein Schreibpfad, der nebenbei aufraeumt, veraendert die Bestandszahl bei jedem
// Speichern) noch ANLEGEN (das waere der Merker durch die Hintertuer zurueck).
$bestand = ['name' => 'Havena', 'wiki_no_article' => true];
$unberuehrt = avesmapsApplyPointWikiFields($bestand, ['name' => 'Havena'], '');
assert(($unberuehrt['wiki_no_article'] ?? null) === true,
    'der Rechner raeumt den Altbestand-Merker weg -- das gehoert der einmaligen Bestandsreparatur');
foreach ([true, 'true', 1, '1', 'on', false, '0', null] as $wert) {
    assert(
        !array_key_exists('wiki_no_article', avesmapsApplyPointWikiFields([], ['wiki_no_article' => $wert], '')),
        'ein Rumpf legt den ausgebauten Merker wieder an: ' . var_export($wert, true)
    );
}
// ⚠️ UND DER VERBOTENE ZUSTAND IST KEINER MEHR -- eine Adresse neben einem Altbestand-Schluessel
// laeuft heute durch. Das ist die Folge des Ausbaus, kein uebersehener Riegel: „es gibt keinen
// Artikel" ist keine Aussage des Systems mehr, also kann ihr auch nichts widersprechen.
$mitBeidem = avesmapsApplyPointWikiFields(
    ['wiki_no_article' => true],
    ['name' => 'Havena'],
    'https://de.wiki-aventurica.de/wiki/Havena'
);
assert(is_array($mitBeidem), 'der gefallene Widerspruchs-Riegel wirft wieder');

// ── 4) DIE DREI TEXTFELDER ────────────────────────────────────────────────────────────────────
// Abwesend = nicht geaendert, leer = loeschen, Wert = beschnitten gespeichert.
$vorher = ['einwohner' => '9.400', 'lage' => 'Albernia · Mittelreich', 'oberhaupt' => 'Gräfin Yppolita'];
$ohneFelder = avesmapsApplyPointWikiFields($vorher, ['name' => 'Havena'], '');
foreach (array_keys(AVESMAPS_POINT_WIKI_TEXT_FIELDS) as $feld) {
    assert(($ohneFelder[$feld] ?? null) === $vorher[$feld], "ein Payload ohne \"$feld\" loescht die Angabe");
}
$geleert = avesmapsApplyPointWikiFields($vorher, ['einwohner' => '', 'lage' => '   ', 'oberhaupt' => ''], '');
foreach (array_keys(AVESMAPS_POINT_WIKI_TEXT_FIELDS) as $feld) {
    assert(!array_key_exists($feld, $geleert), "ein ausdruecklich geleertes \"$feld\" bleibt stehen");
}
$geschrieben = avesmapsApplyPointWikiFields([], ['einwohner' => '  9.400  ', 'oberhaupt' => 'Gräfin Yppolita'], '');
assert($geschrieben['einwohner'] === '9.400', 'die Raender werden nicht beschnitten');
assert($geschrieben['oberhaupt'] === 'Gräfin Yppolita');
assert(!array_key_exists('lage', $geschrieben), 'ein nicht geschicktes Feld entsteht aus dem Nichts');

// 💣 Die Laengen sind MEHRBYTE-sicher zu schneiden: `substr` risse ein „ä" mitten durch und
// hinterliesse ungueltiges UTF-8 im properties_json.
$langesWort = str_repeat('ä', 260);
$gekappt = avesmapsApplyPointWikiFields([], ['einwohner' => $langesWort], '');
assert(mb_strlen($gekappt['einwohner'], 'UTF-8') === AVESMAPS_POINT_WIKI_TEXT_FIELDS['einwohner']);
assert(mb_check_encoding($gekappt['einwohner'], 'UTF-8'), 'die Kappung zerschneidet ein Mehrbyte-Zeichen');

// 🔴 UND DIE LAENGEN SIND ABGELESEN, NICHT GEWAEHLT: sie sind die des Wiki-Nests. Weichen sie ab,
// kaeme ein gesynctes Feld laenger aus dem Wiki, als die Karte es speichern kann -- die Sync-Vorschau
// zeigte dann bei jedem Speichern denselben Unterschied noch einmal.
$nest = file_get_contents(__DIR__ . '/../../wiki/settlements.php');
assert(is_string($nest));
foreach (AVESMAPS_POINT_WIKI_TEXT_FIELDS as $feld => $laenge) {
    assert(
        preg_match("/'" . $feld . "' => mb_substr\(.+, 0, (\d+), 'UTF-8'\)/", $nest, $treffer) === 1,
        "die Nest-Laenge fuer \"$feld\" ist nicht auffindbar -- der Vergleich waere blind"
    );
    assert(
        (int) $treffer[1] === $laenge,
        "die Kartenlaenge fuer \"$feld\" ($laenge) weicht von der des Wiki-Nests ({$treffer[1]}) ab"
    );
}

// ── 5) DIE ANTWORT TRAEGT ALLE DREI ───────────────────────────────────────────────────────────
// 💣 Der Kartendialog baut seinen Marker-Eintrag aus GENAU dieser Antwort neu
// (updateLocationMarkerFromFeature, js/map-features/map-features-location-editing.js). Fehlte eines
// der drei, saehe der Dialog beim naechsten Oeffnen einen Stand als „nicht gesetzt", den er selbst
// gerade gespeichert hat -- und das naechste Speichern schriebe die Leere fest.
// 🔴 ES WAREN VIER: `wiki_no_article` reiste mit, damit das Haekchen nach dem Speichern nicht leer
// zurueckkam. Gefallen am 09.09.2026 mit dem Merker -- und die Gegenprobe steht darunter, weil eine
// Antwort, die ihn wieder mitschickt, im Browser ein Feld wiederbelebte, das keine Oberflaeche mehr
// anzeigt und kein Schreibweg mehr speichert.
$antwort = avesmapsBuildPointFeatureResponse('loc-1', 'Havena', 'grossstadt', 12.0, 34.0, [
    'wiki_no_article' => true,
    'einwohner' => '9.400',
    'lage' => 'Albernia · Mittelreich',
    'oberhaupt' => 'Gräfin Yppolita',
], 4711);
assert(!array_key_exists('wiki_no_article', $antwort), 'die Antwort traegt den ausgebauten Merker wieder');
assert($antwort['einwohner'] === '9.400');
assert($antwort['lage'] === 'Albernia · Mittelreich');
assert($antwort['oberhaupt'] === 'Gräfin Yppolita');
$leereAntwort = avesmapsBuildPointFeatureResponse('loc-2', 'Ort', 'dorf', 1.0, 2.0, [], 1);
assert($leereAntwort['einwohner'] === '');

// ── 6) DIE VERDRAHTUNG ────────────────────────────────────────────────────────────────────────
// ⚠️ EINE TEXTPROBE, und sie ist als solche benannt: die zwei Schreibwege brauchen eine PDO-
// Verbindung und lassen sich hier nicht fahren. Sie beantwortet genau eine Frage -- ruft der
// Schreibweg den gemeinsamen Rechner ueberhaupt? --, und das ist dieselbe Frage (und dasselbe
// Muster) wie in powerline-inherit-test.php nebenan. Ueber das VERHALTEN sagt sie nichts; das sagen
// die Zusicherungen 1-5.
// 💣 Der Anlege-Weg steht ausdruecklich mit drin: der Dialog „Ort bearbeiten" ist im Anlege-Fall
// derselbe, samt Haekchen -- ohne ihn waere es dort ein Haekchen, das nichts merkt.
$quelle = file_get_contents(__DIR__ . '/../features.php');
assert(is_string($quelle));
foreach (['avesmapsUpdatePointFeatureDetails', 'avesmapsCreatePointFeature'] as $funktion) {
    assert(
        preg_match('/function ' . $funktion . '\(.*?\n\}/s', $quelle, $rumpf) === 1,
        "der Schreibweg \"$funktion\" laesst sich isolieren"
    );
    assert(
        str_contains($rumpf[0], 'avesmapsApplyPointWikiFields('),
        "der Schreibweg \"$funktion\" fragt den gemeinsamen Rechner nicht"
    );
    // 🪤 HIER STAND EINE ZUSICHERUNG, DIE NIE ETWAS MESSEN KONNTE: „der Schreibweg schreibt den
    // Merker an dem Rechner vorbei" (`!str_contains($rumpf[0], "\$properties['wiki_no_article']")`).
    // Gemessen am 09.09.2026 gegen HEAD: das Wort stand in KEINEM der beiden Rumpfe -- der Merker
    // lebte vollstaendig in `avesmapsApplyPointWikiFields`. Die Zusicherung war in beiden Baeumen
    // gruen und beschrieb einen Zustand, den es nie gab. Gefunden hat sie ein Pruefagent.
    // ⭐ Was BLEIBT, ist die Zusicherung darueber -- „ruft der Schreibweg den gemeinsamen Rechner?"
    // --, und die ist echt: sie faellt, sobald jemand die drei Textfelder an ihm vorbei schreibt.
}

// ── 7) DIE KOPPLUNG UEBER DIE SPRACHGRENZE ────────────────────────────────────────────────────
// 💣 `AVESMAPS_POINT_WIKI_TEXT_FIELDS` hier und `AVESMAPS_WIKI_ASSIGN_ORT_KARTENFELDER` drueben sind
// EIN Wert in zwei Sprachen. Waechst nur einer, ist der Fehler still: ein viertes Feld im Server
// waere im Browser kein Sync-Ziel (die Vorschau boete es nie an), und umgekehrt zeigte das Bauteil
// eine Zeile, deren Haken der Server wegwirft. Die JS-Tests koennen diese Richtung nicht sehen --
// sie kennen die PHP-Tabelle nicht.
$ortJs = file_get_contents(__DIR__ . '/../../../../js/ui/wiki-assign-ort.js');
assert(is_string($ortJs));
assert(
    preg_match('/const AVESMAPS_WIKI_ASSIGN_ORT_KARTENFELDER = \[([^\]]*)\]/', $ortJs, $kartenfelder) === 1,
    'AVESMAPS_WIKI_ASSIGN_ORT_KARTENFELDER laesst sich nicht lesen -- die Kopplung waere blind'
);
foreach (array_keys(AVESMAPS_POINT_WIKI_TEXT_FIELDS) as $feld) {
    assert(
        str_contains($kartenfelder[1], '"' . $feld . '"'),
        "das Kartenfeld \"$feld\" kennt der Server, aber nicht der Browser -- der Sync koennte es nie fuellen"
    );
}

// 💣 UND BEIDE PAYLOAD-BAUER MUESSEN JEDES FELD SCHICKEN. Schickt einer es nicht, laesst der Server
// die Angabe zwar in Ruhe (Zusicherung 4) -- aber die Oberflaeche kann sie dann nie AENDERN, und das
// sieht aus wie ein kaputtes Eingabefeld. Zwei Bauer, dieselbe Liste: die Bauform, in der ein Feld
// verlorengeht (AGENTS.md §11).
// 🪤 UND DIE PROBE WIRD AUF DEN FUNKTIONSRUMPF EINGEENGT, nicht auf die Datei. Die erste Fassung
// suchte den blossen Feldnamen im ganzen Dokument und blieb GRUEN, als die Mutation „lage" aus dem
// Bauer entfernte -- der Name steht im selben Dokument noch als `dtEditLage`, im Zustandsbauer und in
// Kommentaren. Genau die Blindheit, an der Aufgabe 5 mit ihrer Stylesheet-Probe haengengeblieben ist.
$bauer = [
    'Kartendialog' => [
        __DIR__ . '/../../../../js/review/review-locations.js',
        '/function buildLocationEditPayload\(.*?\n\}/s',
    ],
    'Orte-Editor' => [
        __DIR__ . '/../../../../html/wiki-sync-settlement-editor.html',
        '/function buildSettlementSavePayload\(.*?\n\}/s',
    ],
];
foreach ($bauer as $wo => [$datei, $muster]) {
    $inhalt = file_get_contents($datei);
    assert(is_string($inhalt));
    assert(preg_match($muster, $inhalt, $rumpfTreffer) === 1, "der Payload-Bauer \"$wo\" laesst sich nicht isolieren");
    foreach (array_keys(AVESMAPS_POINT_WIKI_TEXT_FIELDS) as $feld) {
        assert(
            str_contains($rumpfTreffer[0], '"' . $feld . '"'),
            "der Payload-Bauer \"$wo\" schickt das Feld \"$feld\" nicht"
        );
    }
    // 🔴 UMGEDREHT AM 09.09.2026: der Merker ist global ausgebaut, KEIN Payload-Bauer schickt
    // ihn mehr. Die drei Textfelder darueber bleiben -- an ihnen haengt der eigentliche Befund.
    // 🪤 GEMESSEN WIRD DER RUMPF OHNE KOMMENTARE. Solange die Zusicherung „steht drin" hiess,
    // war das egal; als „steht NICHT drin" wird jeder kuenftige Kommentar mit dem Wort zum
    // falschen Roten -- und direkt ueber dem Bauer steht einer. Der Nachbartest hat den Filter
    // laengst (avesmapsWegTestRumpfOhneKommentare); hier fehlte er.
    $ohneKommentare = implode("\n", array_filter(
        preg_split('/\r?\n/', preg_replace('#/\*.*?\*/#s', '', $rumpfTreffer[0]) ?? $rumpfTreffer[0]) ?: [],
        static fn (string $zeile): bool => !str_starts_with(ltrim($zeile), '//')
    ));
    assert(
        !str_contains($ohneKommentare, 'wiki_no_article'),
        "der Payload-Bauer \"$wo\" schickt den gefallenen Merker wieder"
    );
}

// ── 8) DIE VERDRAHTUNG FORMULARFELD ↔ PAYLOAD-BAUER ───────────────────────────────────────────
// 🪤 SIE WAR UNBEWACHT, und der Pruefer hat es gemessen: `name="einwohner"` aus index.html entfernt
// -- ALLE 156 JS-Tests blieben gruen. `formData.get("einwohner")` liefert dann fuer immer `null`,
// der Schluessel faellt aus dem Payload, der Server laesst den alten Wert stehen (Zusicherung 4) --
// der Editor tippt, speichert, und beim naechsten Oeffnen steht wieder der alte Wert. Lautlos.
// 💣 Die Probe darueber prueft den RUMPF des Bauers; sie kann nicht sehen, ob das Formular den
// Namen ueberhaupt liefert. Das `name`-Attribut ist die andere Haelfte derselben Kopplung.
// ⚠️ Der Orte-Editor braucht das nicht: er liest `$("dtEditEinwohner").value`, also die KENNUNG --
// und die steht schon in der Rumpf-Probe.
$kartenMarkup = file_get_contents(__DIR__ . '/../../../../index.html');
assert(is_string($kartenMarkup));
foreach (array_keys(AVESMAPS_POINT_WIKI_TEXT_FIELDS) as $feld) {
    assert(
        preg_match('/<input id="location-edit-' . $feld . '"[^>]*\sname="' . $feld . '"/', $kartenMarkup) === 1,
        "das Feld \"$feld\" im Kartendialog traegt kein passendes name-Attribut -- FormData liefert "
        . 'dann fuer immer null und der Schluessel faellt aus dem Payload'
    );
}

// ── 9) `maxlength` IST DIESELBE ZAHL WIE IM SERVER ────────────────────────────────────────────
// 💣 Sonst ist es die VIERTE Kopie der Laengen (Nest, Server, zwei Formulare). Server↔Nest ist
// oben gesichert, Server↔Markup war es nicht: eine hoehere Zahl im Formular liesse den Editor
// tippen, was der Server dann stumm abschneidet -- und die naechste Sync-Vorschau zeigte den
// Unterschied wieder und wieder.
$markupQuellen = [
    'Kartendialog' => [$kartenMarkup, '/<input id="location-edit-%s"[^>]*maxlength="(\d+)"/'],
    'Orte-Editor' => [
        file_get_contents(__DIR__ . '/../../../../html/wiki-sync-settlement-editor.html'),
        '/id="dtEdit%s"[^>]*maxlength="(\d+)"/',
    ],
];
$kennung = ['einwohner' => 'Einwohner', 'lage' => 'Lage', 'oberhaupt' => 'Oberhaupt'];
foreach ($markupQuellen as $wo => [$inhalt, $muster]) {
    assert(is_string($inhalt));
    foreach (AVESMAPS_POINT_WIKI_TEXT_FIELDS as $feld => $laenge) {
        $name = $wo === 'Orte-Editor' ? $kennung[$feld] : $feld;
        assert(
            preg_match(sprintf($muster, $name), $inhalt, $gefunden) === 1,
            "das maxlength von \"$feld\" ist in \"$wo\" nicht auffindbar -- der Vergleich waere blind"
        );
        assert(
            (int) $gefunden[1] === $laenge,
            "das maxlength von \"$feld\" in \"$wo\" ({$gefunden[1]}) weicht von der Serverlaenge ($laenge) ab"
        );
    }
}

// 🔴 UND KEINER DER ZWEI WIKI-SCHREIBWEGE FASST DEN MERKER MEHR AN.
// Hier stand: „eine Zuweisung LOESCHT den Merker" (beides zugleich war der verbotene Zustand, und
// wer einen Artikel zuweist, hat das fruehere „es gibt keinen" widerlegt) -- und `clear_assign`
// gerade NICHT, denn eine Verbindung zu loesen heisst nicht, dass es keinen Artikel gibt. Diese
// Unterscheidung war die feinste des ganzen Merkers; sie ist am 09.09.2026 mit ihm gefallen.
// ⚠️ Ebenfalls Textprobe, aus demselben Grund (beide brauchen eine PDO). Gemessen wird der
// kommentarfreie Rumpf: die Begruendung oben nennt das Wort, das unten nicht vorkommen darf.
// ⚠️ VON DEN ZWEI IST NUR EINE EIN MUTATIONSTOETER, und das steht hier, damit niemand die Schleife
// fuer doppelt so scharf haelt, wie sie ist: gegen HEAD gemessen (09.09.2026) trug
// `avesmapsWikiSettlementAssignTo` das Wort und faellt bei einem Rueckbau, `…ClearAssign` trug es
// NIE -- dass das Loesen den Merker nicht anfasst, war der Entscheid, nicht eine Aenderung. Ihre
// Haelfte der Schleife ist ein reiner Waechter gegen einen kuenftigen Erzeuger.
foreach (['avesmapsWikiSettlementAssignTo', 'avesmapsWikiSettlementClearAssign'] as $funktion) {
    assert(
        preg_match('/function ' . $funktion . '\(.*?\n\}/s', $nest, $rumpfTreffer) === 1,
        "$funktion laesst sich isolieren"
    );
    $ohneKommentare = implode("\n", array_filter(
        preg_split('/\r?\n/', preg_replace('#/\*.*?\*/#s', '', $rumpfTreffer[0]) ?? $rumpfTreffer[0]) ?: [],
        static fn (string $zeile): bool => !str_starts_with(ltrim($zeile), '//')
    ));
    assert(
        !str_contains($ohneKommentare, 'wiki_no_article'),
        "$funktion fasst den ausgebauten Merker wieder an -- er ist am 09.09.2026 global gefallen"
    );
}

fwrite(STDOUT, "ort-wiki-no-article-test: alle Zusicherungen erfuellt\n");
