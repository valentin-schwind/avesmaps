<?php

declare(strict_types=1);

/**
 * Der DRITTE ZUSTAND eines Ortes („es gibt keinen Wiki-Artikel") und seine drei Wiki-Textfelder.
 * Lauf (aus dem Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       api/_internal/map/__tests__/ort-wiki-no-article-test.php
 *
 * 🔴 WARUM ES DIESEN MERKER GIBT (Discord #38): `avesmapsEnrichMapFeatureWikiUrl`
 * (api/app/map-features.php) raet die Wiki-Adresse eines Ortes aus seinem NAMEN, sobald
 * `properties.wiki_url` leer ist. „Geloescht" und „nie gesetzt" sind fuer sie dasselbe -- ein
 * entfernter Wiki-Link kehrt beim naechsten Kartenladen zurueck und wird beim naechsten Speichern zu
 * echten Daten. Nur eine NEGATIVE Aussage bricht das, und die ist `properties.wiki_no_article`.
 * Bis zum 16.08.2026 konnte sie nur das Konfliktzentrum setzen; seither auch die zwei
 * Ort-Oberflaechen, ueber avesmapsApplyPointWikiFields.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

require __DIR__ . '/../features.php';

// ── 1) ABWESEND HEISST „NICHT GEAENDERT" ──────────────────────────────────────────────────────
// 💣 DIE tragende Zusicherung. Der Kraftlinien-Schreibweg daneben liest `?? false`, und das ist dort
// richtig -- er hat EINEN Schreiber. `update_point` hat zwei plus die Ladeluecke eines Deploys: eine
// gecachte index.html ohne das Feld (AGENTS.md §7) naehme sonst bei JEDEM Speichern die Entscheidung
// des Konfliktzentrums zurueck, ohne dass jemand etwas anklickt.
$bestand = ['name' => 'Havena', 'wiki_no_article' => true];
$unberuehrt = avesmapsApplyPointWikiFields($bestand, ['name' => 'Havena'], '');
assert(($unberuehrt['wiki_no_article'] ?? null) === true, 'ein Payload ohne den Schluessel loescht den Merker');

// ── 2) AUSDRUECKLICH GESETZT UND AUSDRUECKLICH ENTFERNT ───────────────────────────────────────
$gesetzt = avesmapsApplyPointWikiFields([], ['wiki_no_article' => true], '');
assert(($gesetzt['wiki_no_article'] ?? null) === true);
// ⚠️ Als `false` wird der Merker NIRGENDS abgelegt -- der Schluessel verschwindet. Ein gespeichertes
// `false` liesse sich spaeter nicht von „nie entschieden" unterscheiden (dieselbe Regel wie bei den
// Kraftlinien, avesmapsPowerlineInheritedLineFields).
$entfernt = avesmapsApplyPointWikiFields(['wiki_no_article' => true], ['wiki_no_article' => false], '');
assert(!array_key_exists('wiki_no_article', $entfernt), 'ein abgewaehltes Haekchen hinterlaesst `false` statt nichts');
// Die Formen, die ein JSON-Rumpf wirklich liefert (avesmapsReadBoolean).
foreach ([true, 'true', 1, '1', 'on'] as $wahr) {
    assert((avesmapsApplyPointWikiFields([], ['wiki_no_article' => $wahr], '')['wiki_no_article'] ?? null) === true);
}
foreach ([false, 'false', 0, '0', '', null, 'vielleicht'] as $falsch) {
    assert(!array_key_exists('wiki_no_article', avesmapsApplyPointWikiFields(['wiki_no_article' => true], ['wiki_no_article' => $falsch], '')));
}

// ── 3) DER WIDERSPRUCH WIRD ABGELEHNT, NICHT AUFGELOEST ───────────────────────────────────────
// 🔴 Ein stummer Vorrang waere eine Regel, die niemand kennt, und der Merker wird an drei Stellen
// gelesen (Editor, Konfliktzentrum, Anreicherung). Vorbild und gemeinsame Formulierung:
// avesmapsAssertWikiClaimNotContradictory.
$geworfen = false;
try {
    avesmapsApplyPointWikiFields([], ['wiki_no_article' => true], 'https://de.wiki-aventurica.de/wiki/Havena');
} catch (InvalidArgumentException $exception) {
    $geworfen = true;
    // ⚠️ Der Satz muss den AUSWEG nennen, den es in DIESER Oberflaeche gibt: das flache Adressfeld ist
    // im Kartendialog versteckt -- „den Link leeren" (der Wortlaut der Kraftlinie) zeigte auf ein
    // Feld, das der Editor nirgends sieht.
    assert(str_contains($exception->getMessage(), 'Zuweisung entfernen'), $exception->getMessage());
    assert(str_contains($exception->getMessage(), 'Ort'), $exception->getMessage());
}
assert($geworfen, 'Adresse UND kein Artikel wird stillschweigend gespeichert');

// 💣 UND ER PRUEFT GEGEN DEN GESPEICHERTEN MERKER, wenn der Payload keinen mitbringt. Ohne das
// waere der verbotene Zustand ueber jeden alten Schreiber herstellbar -- genau die Luecke, die der
// zweite Kraftlinien-Schreibweg hatte, bis sie 2026 geschlossen wurde.
$geworfenStill = false;
try {
    avesmapsApplyPointWikiFields(['wiki_no_article' => true], ['name' => 'Havena'], 'https://de.wiki-aventurica.de/wiki/Havena');
} catch (InvalidArgumentException) {
    $geworfenStill = true;
}
assert($geworfenStill, 'ein Payload ohne Merker umgeht den Widerspruchs-Riegel');

// Und die erlaubten Kombinationen bleiben erlaubt.
assert(avesmapsApplyPointWikiFields([], ['wiki_no_article' => false], 'https://de.wiki-aventurica.de/wiki/Havena') !== null);
assert(avesmapsApplyPointWikiFields([], ['wiki_no_article' => true], '') !== null);

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

// ── 5) DIE ANTWORT TRAEGT ALLE VIER ───────────────────────────────────────────────────────────
// 💣 Der Kartendialog baut seinen Marker-Eintrag aus GENAU dieser Antwort neu
// (updateLocationMarkerFromFeature, js/map-features/map-features-location-editing.js). Fehlte eines
// der vier, saehe der Dialog beim naechsten Oeffnen einen Stand als „nicht gesetzt", den er selbst
// gerade gespeichert hat -- und das naechste Speichern schriebe die Leere fest.
$antwort = avesmapsBuildPointFeatureResponse('loc-1', 'Havena', 'grossstadt', 12.0, 34.0, [
    'wiki_no_article' => true,
    'einwohner' => '9.400',
    'lage' => 'Albernia · Mittelreich',
    'oberhaupt' => 'Gräfin Yppolita',
], 4711);
assert($antwort['wiki_no_article'] === true, 'die Antwort verschweigt den Merker');
assert($antwort['einwohner'] === '9.400');
assert($antwort['lage'] === 'Albernia · Mittelreich');
assert($antwort['oberhaupt'] === 'Gräfin Yppolita');
$leereAntwort = avesmapsBuildPointFeatureResponse('loc-2', 'Ort', 'dorf', 1.0, 2.0, [], 1);
assert($leereAntwort['wiki_no_article'] === false && $leereAntwort['einwohner'] === '');

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
    assert(
        !str_contains($rumpf[0], "\$properties['wiki_no_article']"),
        "der Schreibweg \"$funktion\" schreibt den Merker an dem Rechner vorbei"
    );
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
    assert(str_contains($rumpfTreffer[0], 'wiki_no_article'), "der Payload-Bauer \"$wo\" schickt den Merker nicht");
}

// 🔴 UND: EINE ZUWEISUNG LOESCHT DEN MERKER. Beides zugleich ist der verbotene Zustand -- und wer
// gerade einen Artikel zuweist, hat die frueheren „es gibt keinen" widerlegt. Wortgleiches Vorbild:
// der Kraftlinien-Abgleich (api/_internal/wiki/powerlines.php).
// ⚠️ Ebenfalls Textprobe, aus demselben Grund (avesmapsWikiSettlementAssignTo braucht eine PDO).
assert(
    preg_match('/function avesmapsWikiSettlementAssignTo\(.*?\n\}/s', $nest, $assign) === 1,
    'avesmapsWikiSettlementAssignTo laesst sich isolieren'
);
assert(
    str_contains($assign[0], "unset(\$props['wiki_no_article'])"),
    'eine Zuweisung laesst den Merker stehen -- der Ort behauptete dann beides zugleich'
);
// Und `clear_assign` gerade NICHT: eine Verbindung zu loesen heisst nicht, dass es keinen Artikel gibt.
assert(
    preg_match('/function avesmapsWikiSettlementClearAssign\(.*?\n\}/s', $nest, $clear) === 1,
    'avesmapsWikiSettlementClearAssign laesst sich isolieren'
);
assert(
    !str_contains($clear[0], 'wiki_no_article'),
    'das Loesen fasst den Merker an -- „diese Verbindung war falsch" ist nicht „es gibt keinen Artikel"'
);

fwrite(STDOUT, "ort-wiki-no-article-test: alle Zusicherungen erfuellt\n");
