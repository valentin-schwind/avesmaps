<?php

declare(strict_types=1);

/**
 * Der DRITTE ZUSTAND eines WEGES („es gibt keinen Wiki-Artikel"), Aufgabe 5c.
 * Lauf (aus dem Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       api/_internal/map/__tests__/weg-wiki-no-article-test.php
 *
 * 🔴 WARUM ES DIESEN TEST GIBT. Aufgabe 5b hat gemessen, dass der Weg den Merker
 * `properties.wiki_no_article` bereits SPEICHERN konnte und von ZWEI Lesern geehrt wurde --
 * `avesmapsEnrichMapFeatureWikiUrl` (api/app/map-features.php) laesst das Adressraten sein, und die
 * Konfliktregel nimmt den Weg aus der Beobachtungsliste (api/_internal/conflicts/rules.php) --, dass
 * ihn aber NIEMAND schreiben konnte: `avesmapsUpdatePathFeatureDetails` las ihn nicht, und keiner der
 * zwei Weg-Payload-Bauer schickte ihn. Zwei Leser ohne Schreiber sind kein Zustand, sondern totes
 * Feld.
 *
 * 🔴 UND DER OWNER-ENTSCHEID VOM 16.08.2026, den dieser Test festnagelt: haekelt jemand „Kein
 * Wiki-Artikel vorhanden" an, LEERT DER SERVER eine gespeicherte `properties.wiki_url`. Er
 * VERWEIGERT nicht -- eine Absage waere hier ohne Ausweg, weil der Weg in keiner seiner zwei
 * Oberflaechen ein Adressfeld hat.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

require __DIR__ . '/../features.php';

// ── 1) ABWESEND HEISST „NICHT GEAENDERT" ──────────────────────────────────────────────────────
// 💣 DIE tragende Zusicherung, und sie ist dieselbe wie beim Ort: `update_path_details` hat ZWEI
// Schreiber (buildPathEditPayload, saveDraft) plus die Ladeluecke eines Deploys. Ein `?? false`
// naehme bei JEDEM Speichern die Entscheidung des Konfliktzentrums zurueck, ohne dass jemand etwas
// anklickt. Ein Schreiber, der ein Feld nicht kennt, darf es nicht leeren.
$bestand = ['name' => 'Reichsstraße 1', 'wiki_no_article' => true];
$unberuehrt = avesmapsApplyPathWikiNoArticle($bestand, ['name' => 'Reichsstraße 1']);
assert(($unberuehrt['wiki_no_article'] ?? null) === true, 'ein Payload ohne den Schluessel loescht den Merker');

// ── 2) AUSDRUECKLICH GESETZT UND AUSDRUECKLICH ENTFERNT ───────────────────────────────────────
$gesetzt = avesmapsApplyPathWikiNoArticle([], ['wiki_no_article' => true]);
assert(($gesetzt['wiki_no_article'] ?? null) === true, 'ein gesetztes Haekchen kommt nicht an');
// ⚠️ Als `false` wird der Merker NIRGENDS abgelegt -- der Schluessel verschwindet. Ein gespeichertes
// `false` liesse sich spaeter nicht von „nie entschieden" unterscheiden (dieselbe Regel wie bei
// avesmapsPowerlineInheritedLineFields und avesmapsApplyPointWikiFields).
$entfernt = avesmapsApplyPathWikiNoArticle(['wiki_no_article' => true], ['wiki_no_article' => false]);
assert(!array_key_exists('wiki_no_article', $entfernt), 'ein abgewaehltes Haekchen hinterlaesst `false` statt nichts');
// Die Formen, die ein JSON-Rumpf wirklich liefert (avesmapsReadBoolean).
foreach ([true, 'true', 1, '1', 'on'] as $wahr) {
    assert((avesmapsApplyPathWikiNoArticle([], ['wiki_no_article' => $wahr])['wiki_no_article'] ?? null) === true);
}
foreach ([false, 'false', 0, '0', '', null, 'vielleicht'] as $falsch) {
    assert(!array_key_exists('wiki_no_article', avesmapsApplyPathWikiNoArticle(['wiki_no_article' => true], ['wiki_no_article' => $falsch])));
}

// ── 3) DAS ANHAKEN LEERT DIE GESPEICHERTE FLACHE ADRESSE (Owner-Entscheid 16.08.2026) ─────────
// 🔴 Die Begruendung steht ausgeschrieben an der Schreibstelle: das Haekchen sagt „es gibt keinen
// Artikel", eine gespeicherte Adresse widerspricht dem, und der Ort macht es seit dem 16.08.2026
// genauso. Die Alternative -- eine Absage des Servers -- waere beim Weg ohne Ausweg: er hat in
// KEINER seiner zwei Oberflaechen ein Adressfeld, und `update_path_details` schickt `wiki_url` gar
// nicht mit; der Editor bekaeme eine Absage, die er nirgends beheben kann.
$mitAdresse = ['name' => 'Aguera', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Aguera'];
$geleert = avesmapsApplyPathWikiNoArticle($mitAdresse, ['wiki_no_article' => true]);
assert(($geleert['wiki_no_article'] ?? null) === true);
assert(
    !array_key_exists('wiki_url', $geleert),
    'das Anhaken laesst die gespeicherte Adresse stehen -- der Weg behauptete beides zugleich, und der '
    . 'Widerspruchs-Riegel machte jedes weitere Speichern unmoeglich'
);
// ⚠️ BEIM ABWAEHLEN WIRD NICHTS ZURUECKGEHOLT und nichts angefasst: eine geloeschte Adresse zu
// erraten ist genau der Fehler, den der Merker beseitigt (Discord #38).
$abgewaehlt = avesmapsApplyPathWikiNoArticle($mitAdresse, ['wiki_no_article' => false]);
assert(
    ($abgewaehlt['wiki_url'] ?? null) === 'https://de.wiki-aventurica.de/wiki/Aguera',
    'ein abgewaehltes Haekchen loescht die Adresse mit -- das Abwaehlen darf gar nichts an ihr tun'
);
// Und ohne Merker im Payload bleibt sie ebenfalls unangetastet.
assert((avesmapsApplyPathWikiNoArticle($mitAdresse, [])['wiki_url'] ?? null) === 'https://de.wiki-aventurica.de/wiki/Aguera');

// 🔴 DER WIDERSPRUCH IST DANACH UNERREICHBAR -- das ist die Zusicherung, nicht „der Riegel wirft".
// Er steht NACH dem Leeren und kann deshalb heute nicht zuschlagen; nimmt jemand das `unset` heraus,
// wird aus dem still gespeicherten Widerspruch eine laute Absage (genau diese Mutation ist gefahren).
foreach ([[], ['wiki_url' => ''], $mitAdresse, ['wiki_url' => 'https://x/wiki/Y', 'wiki_no_article' => true]] as $vorher) {
    foreach ([[], ['wiki_no_article' => true], ['wiki_no_article' => false]] as $rumpf) {
        $ergebnis = avesmapsApplyPathWikiNoArticle($vorher, $rumpf);
        assert(
            !(!empty($ergebnis['wiki_no_article']) && trim((string) ($ergebnis['wiki_url'] ?? '')) !== ''),
            'der verbotene Zustand „Adresse UND kein Artikel" ist erreichbar: ' . var_export($ergebnis, true)
        );
    }
}

// ⚠️ Und der geteilte Riegel ist scharf -- die Gegenprobe, dass die Schleife oben nicht bloss
// deshalb gruen ist, weil nie etwas geprueft wuerde. Es ist DERSELBE (avesmapsAssertWikiClaimNot-
// Contradictory), den Ort und Kraftlinie rufen; einen zweiten gibt es nicht.
$geworfen = false;
try {
    avesmapsAssertWikiClaimNotContradictory('https://x/wiki/Y', true, 'Ein Weg', 'Bitte abwählen.');
} catch (InvalidArgumentException $exception) {
    $geworfen = true;
    assert(str_contains($exception->getMessage(), 'Ein Weg'), $exception->getMessage());
}
assert($geworfen, 'der geteilte Widerspruchs-Riegel wirft gar nicht mehr');

// ── 4) DIE ANTWORT TRAEGT DEN MERKER AUSDRUECKLICH, AUCH ALS `false` ──────────────────────────
// 💣 applyPathFeatureResponse (js/map-features/map-features-path-lifecycle.js) MISCHT die Antwort in
// die vorhandenen Eigenschaften (`{...alt, ...neu}`). Ein WEGGELASSENER Schluessel loescht dort
// nichts -- ein gerade abgewaehltes Haekchen saehe beim naechsten Oeffnen des Dialogs wieder gesetzt
// aus, obwohl der Server es geloescht hat. Dieselbe Pflicht wie bei avesmapsBuildPointFeatureResponse.
$geometrie = ['type' => 'LineString', 'coordinates' => [[1.0, 2.0], [3.0, 4.0]]];
$antwortGesetzt = avesmapsBuildLineStringFeatureResponse('path-1', 'Aguera', 'Flussweg', $geometrie, ['wiki_no_article' => true], 7);
assert($antwortGesetzt['properties']['wiki_no_article'] === true, 'die Antwort verschweigt den gesetzten Merker');
$antwortLeer = avesmapsBuildLineStringFeatureResponse('path-2', 'Strasse-9', 'Strasse', $geometrie, [], 8);
assert(
    array_key_exists('wiki_no_article', $antwortLeer['properties'])
        && $antwortLeer['properties']['wiki_no_article'] === false,
    'die Antwort laesst den geloeschten Merker weg -- der Kartendialog mischt sie in seine alten '
    . 'Eigenschaften und behielte damit das abgewaehlte Haekchen'
);

// ── 5) DIE VERDRAHTUNG DES SCHREIBWEGS ────────────────────────────────────────────────────────
// ⚠️ EINE TEXTPROBE, und sie ist als solche benannt: `avesmapsUpdatePathFeatureDetails` braucht eine
// PDO-Verbindung und laesst sich hier nicht fahren. Sie beantwortet genau eine Frage -- ruft der
// Schreibweg den gemeinsamen Rechner ueberhaupt? --, dasselbe Muster wie in
// ort-wiki-no-article-test.php nebenan. Ueber das VERHALTEN sagt sie nichts; das sagen 1-4.
$quelle = file_get_contents(__DIR__ . '/../features.php');
assert(is_string($quelle));
assert(
    preg_match('/function avesmapsUpdatePathFeatureDetails\(.*?\n\}/s', $quelle, $rumpf) === 1,
    'der Schreibweg avesmapsUpdatePathFeatureDetails laesst sich isolieren'
);
assert(
    str_contains($rumpf[0], 'avesmapsApplyPathWikiNoArticle('),
    'der Schreibweg fragt den gemeinsamen Rechner nicht'
);
assert(
    !str_contains($rumpf[0], "\$properties['wiki_no_article']"),
    'der Schreibweg schreibt den Merker an dem Rechner vorbei'
);

// ── 6) BEIDE PAYLOAD-BAUER SCHICKEN IHN ───────────────────────────────────────────────────────
// 💣 „Eine Regel, die einen von zwei Erzeugern bindet, ist keine Regel" (AGENTS.md §11). Schickt nur
// einer den Merker, laesst der Server ihn zwar in Ruhe (Zusicherung 1) -- aber die eine Oberflaeche
// koennte ihn nie AENDERN, und das sieht aus wie ein kaputtes Haekchen.
// 🪤 GEPRUEFT WIRD DER FUNKTIONSRUMPF, NICHT DIE DATEI, und Kommentare fliegen vorher raus. Genau
// daran ist die Probe in Aufgabe 5b zweimal blind gewesen: sie fand ihren eigenen Kommentar
// (Nachbesserung 1) und spaeter einen Blockkommentar (Nachbesserung 3).
function avesmapsWegTestRumpfOhneKommentare(string $rumpf): string {
    // Blockkommentare zuerst -- sie koennen mehrere Zeilen umfassen.
    $ohne = preg_replace('#/\*.*?\*/#s', '', $rumpf) ?? $rumpf;

    return implode("\n", array_filter(
        preg_split('/\r?\n/', $ohne) ?: [],
        static fn (string $zeile): bool => !str_starts_with(ltrim($zeile), '//')
    ));
}

// ⚠️ Die BEDINGUNG steht je Oberflaeche woanders, und deshalb nennt die Tabelle zwei Ruempfe: der
// Kartendialog holt sie sich aus pathWikiKeinArtikelFuerPayload (js/review/review-path-wiki.js), der
// Wege-Editor traegt sie in `saveDraft` selbst. Eine gemeinsame Probe am Payload-Bauer haette den
// Kartendialog faelschlich als „bedingungslos" gemeldet -- gemessen, nicht angenommen.
$bauer = [
    'Kartendialog' => [
        'datei' => __DIR__ . '/../../../../js/review/review-paths.js',
        'muster' => '/function buildPathEditPayload\(.*?\n\}/s',
        'bedingungDatei' => __DIR__ . '/../../../../js/review/review-path-wiki.js',
        'bedingungMuster' => '/function pathWikiKeinArtikelFuerPayload\(.*?\n\}/s',
    ],
    'Wege-Editor' => [
        'datei' => __DIR__ . '/../../../../js/pages/wege-editor.js',
        'muster' => '/\n\tfunction saveDraft\(\).*?\n\t\}/s',
        'bedingungDatei' => __DIR__ . '/../../../../js/pages/wege-editor.js',
        'bedingungMuster' => '/\n\tfunction saveDraft\(\).*?\n\t\}/s',
    ],
];
foreach ($bauer as $wo => $stelle) {
    $inhalt = file_get_contents($stelle['datei']);
    assert(is_string($inhalt));
    assert(preg_match($stelle['muster'], $inhalt, $rumpfTreffer) === 1, "der Payload-Bauer \"$wo\" laesst sich nicht isolieren");
    $code = avesmapsWegTestRumpfOhneKommentare($rumpfTreffer[0]);
    assert(
        preg_match('/(^|[^A-Za-z0-9_$])wiki_no_article\s*[=:]/', $code) === 1,
        "der Payload-Bauer \"$wo\" schickt den Merker nicht (Kommentare zaehlen nicht)"
    );

    // 💣 UND ER SCHICKT IHN NUR BEI EINER AENDERUNG UND NUR AUS EINEM BEREITEN BAUTEIL. Ohne die
    // erste Bedingung naehme ein alter offener Dialog beim naechsten beliebigen Speichern die
    // Entscheidung eines zweiten Editors zurueck (Owner-Entscheid 16.08.2026, anstelle eines
    // `expected_revision`); ohne die zweite schickte ein Blindgaenger ein `false` und loeschte den
    // Merker, ohne dass jemand etwas angeklickt hat.
    $bedingung = $stelle['bedingungDatei'] === $stelle['datei'] ? $inhalt : file_get_contents($stelle['bedingungDatei']);
    assert(is_string($bedingung));
    assert(
        preg_match($stelle['bedingungMuster'], $bedingung, $bedingungTreffer) === 1,
        "die Bedingung von \"$wo\" laesst sich nicht isolieren"
    );
    $bedingungCode = avesmapsWegTestRumpfOhneKommentare($bedingungTreffer[0]);
    assert(
        str_contains($bedingungCode, 'kein_artikel_geaendert'),
        "\"$wo\" schickt den Merker bedingungslos -- er muss ihn nur bei einer AENDERUNG mitschicken"
    );
    assert(
        preg_match('/(^|[^A-Za-z0-9_$])bereit\b/', $bedingungCode) === 1,
        "\"$wo\" fragt nicht, ob das Bauteil ueberhaupt bereit ist -- ein Blindgaenger loeschte den Merker"
    );
}

// ── 7) JEDE ZUWEISUNG LOESCHT DEN MERKER -- UND DIE LISTE DER ZUWEISER WIRD GEZAEHLT ──────────
// 🔴 Wer gerade einen Artikel zuweist, hat das fruehere „es gibt keinen" widerlegt. Wortgleiches
// Vorbild: der Ort (avesmapsWikiSettlementAssignTo) und der Kraftlinien-Abgleich.
//
// 🪤 HIER STAND EINE ZAHL, UND SIE WAR FALSCH. Die erste Fassung dieser Zusicherung lief ueber die
// feste Liste `['avesmapsWikiPathAssign', 'avesmapsWikiPathAssignTo']` -- „der Weg hat ZWEI
// Zuweiser". Es sind DREI: `avesmapsWikiPathAssignAll` (der Massenlauf `assign_all` des
// WikiSync-Panels) fehlte, und weder der Kommentar noch der Test haetten das je gemeldet. Gefunden
// hat es die Konsistenz-Pruefung, nicht dieser Test. Genau die Falle aus AGENTS.md §11: eine ZAHL
// liest sich wie eine vollstaendige Liste, und niemand zaehlt nach.
//
// ⭐ DESHALB ZAEHLT DIE PROBE SELBST. Gesucht wird JEDE Funktion im Haus, die `['wiki_path'] = `
// schreibt; jede muss den Merker loeschen. Ein VIERTER Zuweiser faellt damit von selbst durch,
// ohne dass jemand eine Liste nachzieht -- neue Stellen scheitern GESCHLOSSEN.
// ⚠️ Ausnahmen sind einzeln benannt und begruendet, nicht pauschal: die zwei Stellen in
// path-verlauf.php sind keine Zuweiser, sondern NACHSTEMPLER -- sie lesen ein VORHANDENES
// `$props['wiki_path']`, aendern `source`/`course_hash`/`course_hops` darin und steigen aus, wenn
// gar keines da ist (:58-75, :1376-1381). Ein Nachstempeln ist keine neue Zuweisung und darf den
// Merker deshalb nicht anfassen.
// ⚠️ Ebenfalls Textprobe -- jeder dieser Wege braucht eine PDO.
const AVESMAPS_WEG_TEST_KEINE_ZUWEISER = [
    // Funktion => Grund, warum sie den Merker NICHT loeschen darf.
    'avesmapsWikiPathVerlaufBackfillDecision' => 'Nachstempler: liest ein VORHANDENES wiki_path und setzt nur source/course_hash darin',
    'avesmapsWikiPathVerlaufRestampKeeps' => 'Nachstempler: setzt nur course_hash/course_hops eines VORHANDENEN wiki_path und steigt sonst aus',
];
$zuweiserGefunden = [];
foreach (['wiki/paths.php', 'wiki/path-verlauf.php'] as $relativ) {
    $inhaltZuweiser = file_get_contents(__DIR__ . '/../../' . $relativ);
    assert(is_string($inhaltZuweiser), "die Datei $relativ ist nicht lesbar");
    assert(
        preg_match_all('/^function (\w+)\(.*?\n\}/ms', $inhaltZuweiser, $funktionen, PREG_SET_ORDER) > 0,
        "in $relativ laesst sich keine einzige Funktion isolieren -- die Probe waere blind"
    );
    foreach ($funktionen as [$rumpfText, $name]) {
        if (!str_contains($rumpfText, "['wiki_path'] = ")) {
            continue;
        }
        $zuweiserGefunden[] = $name;
        if (array_key_exists($name, AVESMAPS_WEG_TEST_KEINE_ZUWEISER)) {
            assert(
                !str_contains($rumpfText, 'wiki_no_article'),
                "\"$name\" fasst den Merker an, ist aber als Ausnahme gefuehrt ("
                . AVESMAPS_WEG_TEST_KEINE_ZUWEISER[$name] . ')'
            );
            continue;
        }
        assert(
            str_contains($rumpfText, "unset(\$props['wiki_no_article'])"),
            "der Zuweiser \"$name\" ($relativ) laesst den Merker stehen -- der Weg behauptete danach, "
            . 'einen Artikel zu haben UND keinen, und fiele ueber conflicts/rules.php still aus der '
            . 'Beobachtungsliste. Ist er in Wahrheit ein Nachstempler, gehoert er mit Begruendung in '
            . 'AVESMAPS_WEG_TEST_KEINE_ZUWEISER.'
        );
    }
}
// 💣 Die Gegenprobe, dass die Suche ueberhaupt etwas findet: ein kaputtes Muster faende NULL
// Funktionen und liesse die Schleife oben lautlos durchlaufen.
assert(
    count($zuweiserGefunden) >= 3,
    'die Suche nach Zuweisern findet weniger als die drei bekannten -- das Muster greift nicht mehr: '
    . implode(', ', $zuweiserGefunden)
);

$wegNest = file_get_contents(__DIR__ . '/../../wiki/paths.php');
assert(is_string($wegNest));
// Und `clear_assign` gerade NICHT: eine Verbindung zu loesen heisst nicht, dass es keinen Artikel gibt.
assert(
    preg_match('/function avesmapsWikiPathClearAssign\(.*?\n\}/s', $wegNest, $clear) === 1,
    'avesmapsWikiPathClearAssign laesst sich isolieren'
);
assert(
    !str_contains($clear[0], 'wiki_no_article'),
    'das Loesen fasst den Merker an -- „diese Verbindung war falsch" ist nicht „es gibt keinen Artikel"'
);

// ── 8) DER WEGE-EDITOR BEKOMMT DEN MERKER UEBERHAUPT ──────────────────────────────────────────
// 💣 Die Liste in api/edit/map/paths-editor.php ist eine WEISSE LISTE: was dort nicht steht, erreicht
// den Editor nie. Ohne diese Zeile staende sein Haekchen bei JEDEM Weg leer da -- auch bei einem, fuer
// den laengst jemand entschieden hat --, waehrend der Kartendialog daneben es richtig zeigt (der
// Kartenpayload reicht alle Eigenschaften durch). Zwei Oberflaechen, zwei Wahrheiten.
$editorListe = file_get_contents(__DIR__ . '/../../../edit/map/paths-editor.php');
assert(is_string($editorListe));
assert(
    preg_match("/'wiki_no_article' => !empty\(\\\$properties\['wiki_no_article'\]\)/", $editorListe) === 1,
    'die Wegeliste des Editors gibt den Merker nicht heraus -- sein Haekchen startet bei jedem Weg leer'
);

fwrite(STDOUT, "weg-wiki-no-article-test: alle Zusicherungen erfuellt\n");
