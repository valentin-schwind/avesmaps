<?php

declare(strict_types=1);

/**
 * Der DRITTE ZUSTAND einer KRAFTLINIE („es gibt keinen Wiki-Artikel") -- nachdem sein Haekchen
 * gefallen ist. Lauf (aus dem Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       api/_internal/map/__tests__/kraftlinie-wiki-no-article-test.php
 *
 * 🔴 WARUM ES DIESEN TEST GIBT, UND WARUM ERST JETZT. Bis zum 16.08.2026 trug der Kraftlinien-Editor
 * das Haekchen „Kein Wiki-Artikel vorhanden", und `avesmapsUpdatePowerlineLine` las den Merker als
 * `$payload['wiki_no_article'] ?? false`. Das war RICHTIG, solange der Editor ihn bei jedem Speichern
 * mitschickte -- der Wert kam ja aus dem Haekchen. Mit dem Owner-Entscheid vom 16.08.2026 (das
 * Haekchen faellt in vier Oberflaechen; entschieden wird im Konfliktzentrum) schickt saveLine ihn nur
 * noch, wenn eine ZUWEISUNG ihn beantwortet hat -- und `?? false` haette ab da bei JEDEM Speichern
 * einer Linie die Entscheidung des Konfliktzentrums geloescht. Lautlos, und hinterher nicht von
 * „nie entschieden" zu unterscheiden (AGENTS.md §10).
 *
 * 💣 DIE ZWEI HAELFTEN GEHOEREN ZUSAMMEN und duerfen nicht einzeln zurueckgedreht werden: der Client
 * schickt nur noch bei einer Aenderung, der Server liest Abwesenheit als „nicht geaendert". Wer eine
 * davon anfasst, braucht die andere im selben Zug -- diese Datei ist die Wache darueber.
 *
 * ⚠️ Geprueft wird die REINE Haelfte (avesmapsApplyPowerlineWikiNoArticle). Der Linien-Schreibweg
 * selbst laeuft in einer Transaktion mit `FOR UPDATE`, `avesmapsNextMapRevision` und dem Protokoll --
 * gegen sqlite gefahren muesste man ihn dafuer verbiegen, und genau davor warnt AGENTS.md §9
 * („ein SQLite-Test kann eine MySQL-Regression ERZWINGEN"). Die Verdrahtung des einen Aufrufers wird
 * deshalb am Quelltext festgenagelt, nicht nachgestellt.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

require __DIR__ . '/../features.php';

// ── 1) ABWESEND HEISST „NICHT GEAENDERT" ──────────────────────────────────────────────────────
// 💣 DIE tragende Zusicherung dieser Datei. Sie ist die Bedingung dafuer, dass das Haekchen fallen
// durfte: ein Objekt, dem das Konfliktzentrum den Merker gesetzt hat, behaelt ihn, wenn der Editor
// die Linie speichert.
$bestand = ['name' => 'Hexenband', 'wiki_no_article' => true];
$unberuehrt = avesmapsApplyPowerlineWikiNoArticle($bestand, ['name' => 'Hexenband'], '');
assert(
    ($unberuehrt['wiki_no_article'] ?? null) === true,
    'ein Rumpf ohne den Schluessel loescht den Merker -- genau das tat `?? false` bis zum 16.08.2026, '
    . 'und seit der Editor ihn nicht mehr mitschickt, waere es ein stiller Verlust bei jedem Speichern'
);
// Und ohne gespeicherten Merker entsteht auch keiner.
assert(!array_key_exists('wiki_no_article', avesmapsApplyPowerlineWikiNoArticle(['name' => 'x'], [], '')));

// ── 2) AUSDRUECKLICH GESETZT UND AUSDRUECKLICH ENTFERNT ───────────────────────────────────────
// 🔴 Der Schluessel kommt heute nur noch aus EINEM Anlass -- eine Zuweisung hat den Merker
// beantwortet (`kein_artikel_geaendert` in html/wiki-sync-powerline-editor.html). Beide Richtungen
// muessen trotzdem durchkommen: die Reparatur-Verben des Konfliktzentrums schreiben denselben Merker.
$gesetzt = avesmapsApplyPowerlineWikiNoArticle([], ['wiki_no_article' => true], '');
assert(($gesetzt['wiki_no_article'] ?? null) === true, 'ein ausdruecklich gesetzter Merker kommt nicht an');
// ⚠️ Als `false` wird er NIRGENDS abgelegt -- der Schluessel verschwindet. Ein gespeichertes `false`
// liesse sich spaeter nicht von „nie entschieden" unterscheiden (dieselbe Regel wie bei
// avesmapsPowerlineInheritedLineFields, avesmapsApplyPointWikiFields und avesmapsApplyPathWikiNoArticle).
$entfernt = avesmapsApplyPowerlineWikiNoArticle(['wiki_no_article' => true], ['wiki_no_article' => false], '');
assert(!array_key_exists('wiki_no_article', $entfernt), 'ein entfernter Merker hinterlaesst `false` statt nichts');
// Die Formen, die ein JSON-Rumpf wirklich liefert (avesmapsReadBoolean).
foreach ([true, 'true', 1, '1', 'on'] as $wahr) {
    assert((avesmapsApplyPowerlineWikiNoArticle([], ['wiki_no_article' => $wahr], '')['wiki_no_article'] ?? null) === true);
}
foreach ([false, 'false', 0, '0', '', null, 'vielleicht'] as $falsch) {
    assert(!array_key_exists(
        'wiki_no_article',
        avesmapsApplyPowerlineWikiNoArticle(['wiki_no_article' => true], ['wiki_no_article' => $falsch], '')
    ));
}

// ── 3) DER WIDERSPRUCHS-RIEGEL BLEIBT SCHARF ──────────────────────────────────────────────────
// 🔴 ANDERS ALS BEIM WEG WIRD HIER NICHTS GELEERT, sondern ABGELEHNT -- und das ist kein Versehen:
// die Kraftlinie hat einen ausdruecklichen Adresswert im Rumpf (`wiki_url`), der Weg hat in keiner
// seiner zwei Oberflaechen ein Adressfeld. Eine Absage ist hier also behebbar; dort waere sie es nicht.
$geworfen = false;
try {
    avesmapsApplyPowerlineWikiNoArticle([], ['wiki_no_article' => true], 'https://de.wiki-aventurica.de/wiki/Hexenband');
} catch (InvalidArgumentException $exception) {
    $geworfen = true;
    assert(str_contains($exception->getMessage(), 'Eine Kraftlinie'), $exception->getMessage());
}
assert($geworfen, 'Adresse UND Merker zugleich wird angenommen -- der Riegel ist stumpf');

// 💣 UND DER GEFAEHRLICHERE FALL: der Merker steht GESPEICHERT, der Rumpf sagt nichts, und eine
// Adresse kommt hinzu. Genau so sieht eine Zuweisung aus, deren Client den Merker NICHT beantwortet.
// Sie muss auffallen, statt still einen widerspruechlichen Datensatz zu schreiben -- deshalb prueft
// die reine Regel gegen den EFFEKTIVEN Merker, nicht nur gegen den gesendeten.
$geworfen2 = false;
try {
    avesmapsApplyPowerlineWikiNoArticle(['wiki_no_article' => true], [], 'https://de.wiki-aventurica.de/wiki/Hexenband');
} catch (InvalidArgumentException $exception) {
    $geworfen2 = true;
}
assert(
    $geworfen2,
    'ein GESPEICHERTER Merker neben einer frisch zugewiesenen Adresse laeuft durch -- die Linie stuende '
    . 'mit Artikel UND „kein Artikel" da, und jedes weitere Speichern liefe in den Riegel'
);

// Der verbotene Zustand ist auf keinem Weg erreichbar.
foreach ([[], ['wiki_no_article' => true], ['wiki_no_article' => false]] as $vorher) {
    foreach ([[], ['wiki_no_article' => true], ['wiki_no_article' => false]] as $rumpf) {
        foreach (['', 'https://de.wiki-aventurica.de/wiki/Hexenband'] as $adresse) {
            try {
                $ergebnis = avesmapsApplyPowerlineWikiNoArticle($vorher, $rumpf, $adresse);
            } catch (InvalidArgumentException $exception) {
                continue; // abgelehnt ist der gewollte Ausgang
            }
            assert(
                !(!empty($ergebnis['wiki_no_article']) && trim($adresse) !== ''),
                'der verbotene Zustand „Adresse UND kein Artikel" ist erreichbar: ' . var_export($ergebnis, true)
            );
        }
    }
}

// ── 4) DER EINE AUFRUFER IST VERDRAHTET ───────────────────────────────────────────────────────
// 💣 EINE REINE FUNKTION, DIE NIEMAND RUFT, IST GRUEN UND WIRKUNGSLOS. Der Linien-Schreibweg laesst
// sich nicht gegen sqlite fahren (siehe Kopf), also wird seine Verdrahtung am Quelltext geprueft --
// und zugleich, dass das alte `?? false` nicht zurueckkommt.
$quelle = file_get_contents(__DIR__ . '/../features.php');
assert(is_string($quelle));
assert(
    preg_match('/function avesmapsUpdatePowerlineLine\(.*?\n\}/s', $quelle, $rumpfTreffer) === 1,
    'avesmapsUpdatePowerlineLine laesst sich nicht isolieren'
);
$code = implode("\n", array_filter(
    preg_split('/\r?\n/', preg_replace('#/\*.*?\*/#s', '', $rumpfTreffer[0]) ?? $rumpfTreffer[0]) ?: [],
    static fn (string $zeile): bool => !str_starts_with(ltrim($zeile), '//')
));
assert(
    str_contains($code, 'avesmapsApplyPowerlineWikiNoArticle('),
    'der Linien-Schreibweg ruft die reine Regel nicht -- sie ist dann gruen und wirkungslos'
);
assert(
    preg_match("/wiki_no_article'\]\s*\?\?/", $code) !== 1,
    'das alte `?? false` ist zurueck -- ohne ein Bedienelement, das den Merker setzen kann, loescht es '
    . 'bei jedem Speichern die Entscheidung des Konfliktzentrums'
);
assert(
    str_contains($code, "array_key_exists('wiki_no_article'"),
    'der Schreibweg fragt nicht mehr, OB der Rumpf den Merker ueberhaupt mitbringt'
);

// ── 5) UND DAS BEDIENELEMENT IST WEG -- DIE ANDERE HAELFTE DESSELBEN ENTSCHEIDS ───────────────
// 🔴 Ohne diese Zusicherung liesse sich das Haekchen wieder einbauen, ohne dass etwas rot wird: der
// Server ist ja jetzt tolerant. Genau dann waere aber der Merker im Editor setzbar UND im
// Konfliktzentrum -- zwei Orte fuer eine Entscheidung, mit verschiedener Reichweite.
// 🪤 UND DIE KOMMENTARE FLIEGEN VORHER RAUS -- diese Zusicherung war OHNE das Ausfiltern GRUEN,
// waehrend saveLine den Merker wieder bedingungslos schickte (gemessen, 16.08.2026): sie fand das
// Wort `kein_artikel_geaendert` im erklaerenden Kommentar zwei Zeilen darueber. Genau dieselbe
// Blindheit hatte weg-wiki-no-article-test.php schon zweimal (Nachbesserungen 1 und 3).
$editor = file_get_contents(__DIR__ . '/../../../../html/wiki-sync-powerline-editor.html');
assert(is_string($editor));
$ohneKommentare = static function (string $quelle): string {
    $ohne = preg_replace('#/\*.*?\*/#s', '', $quelle) ?? $quelle;

    return implode("\n", array_filter(
        preg_split('/\r?\n/', $ohne) ?: [],
        static fn (string $zeile): bool => !str_starts_with(ltrim($zeile), '//')
    ));
};
$editorCode = $ohneKommentare($editor);
assert(
    !str_contains($editorCode, 'keinArtikelGeaendert'),
    'der Kraftlinien-Editor haengt wieder einen Rueckruf fuer das Haekchen ein'
);
// 💣 GEPRUEFT WIRD DIE FORM, NICHT DAS WORT: der Merker darf NUR in dieser einen Bedingung
// geschrieben werden. Ein blosses „irgendwo steht kein_artikel_geaendert" liesse eine zweite,
// bedingungslose Schreibstelle daneben durchgehen.
assert(
    preg_match(
        '/if \(zuweisung\.kein_artikel_geaendert === true\) \{\s*\n\s*rumpf\.wiki_no_article = /',
        $editorCode
    ) === 1,
    'saveLine schickt den Merker nicht mehr genau unter der Bedingung „seit dem Laden veraendert" -- '
    . 'bedingungslos gesendet naehme ein Speichern der Beschreibung die Entscheidung des '
    . 'Konfliktzentrums zurueck'
);
// 🪤 GEZAEHLT WIRD DER SCHREIBVORGANG, NICHT DAS WORT. Ein erster Entwurf dieser Zusicherung
// verlangte „`wiki_no_article` steht genau einmal da" und war rot bei korrektem Code: die Datei nennt
// den Merker auch in einer Feldliste am Zeilenende (die das Kommentar-Filter nicht sieht, weil sie
// hinter Code steht) und LIEST ihn in wikiAssignZustand -- beides muss bleiben, das Lesen traegt den
// geladenen Stand, ohne den eine Zuweisung den Merker nicht beantworten koennte.
assert(
    substr_count($editorCode, 'rumpf.wiki_no_article') === 1,
    'der Kraftlinien-Editor schreibt `wiki_no_article` an mehr als einer Stelle in den Rumpf: '
    . substr_count($editorCode, 'rumpf.wiki_no_article') . ' Fundstellen -- eine zweite, '
    . 'bedingungslose Schreibstelle neben der Bedingung waere genau der stille Verlust'
);
// ⚠️ Und der LESEweg bleibt: ohne ihn kennt das Bauteil den geladenen Stand nicht, und eine Zuweisung
// koennte den Merker nicht mehr beantworten (`kein_artikel_geaendert` waere immer false).
assert(
    str_contains($editorCode, 's.wiki_no_article === true'),
    'der Kraftlinien-Editor liest den gespeicherten Merker nicht mehr -- dann kann eine Zuweisung ihn '
    . 'auch nicht mehr beantworten, und die Linie stuende mit Artikel UND Merker da'
);
$register = file_get_contents(__DIR__ . '/../../../../js/ui/wiki-assign-registry.js');
assert(is_string($register));
assert(
    preg_match('/kraftlinie:\s*\{.*?keinArtikelHaken:\s*(true|false)/s', $register, $hakenTreffer) === 1,
    'die Erklaerung `kraftlinie` fuehrt `keinArtikelHaken` gar nicht mehr -- dann fehlt auch ihre Begruendung'
);
assert(
    $hakenTreffer[1] === 'false',
    'die Erklaerung `kraftlinie` bietet das Haekchen wieder an -- der Owner hat es am 16.08.2026 '
    . 'abgewaehlt; wer es zurueckholt, braucht einen neuen Entscheid UND das `?? false` zurueck'
);

fwrite(STDOUT, "kraftlinie-wiki-no-article-test: alle Zusicherungen erfuellt\n");
