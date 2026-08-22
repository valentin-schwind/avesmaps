<?php

declare(strict_types=1);

// Die FELDHERKUNFT DES WEGES -- und der ganze Punkt dieser Probe sind seine MEHREREN Schreibwege.
//
// 💣 Der Weg ist die Objektart mit den meisten Schreibern auf demselben Feld:
//   avesmapsUpdatePathFeatureDetails  -- ein Abschnitt
//   avesmapsUpdatePathGroupDetails    -- die WEG-EBENE (19.08.2026), eine Schleife ueber ALLE
//                                        Abschnitte einer Namensgruppe
//   avesmapsCreatePathFeature         -- ein frisch gezeichneter Weg
// Eine Regel, die nur den ersten bindet, ist keine Regel. Genau diese Fehlerklasse ist am
// 14.08.2026 die Verkehrsmittel-Sperre gewesen (zwei von vier Erzeugern gebunden, die Kutsche fuhr
// querfeldein) und am 17.08.2026 der Literatur-Stempler.
//
// 🔴 GEZAEHLT WIRD, NICHT AUFGEZAEHLT: die Probe sucht jeden Schreiber, der den Wegtyp AUS DEM
// RUMPF liest, und verlangt von jedem den Stempel. Genau so hat sie den Anlege-Schreibweg gefunden,
// den der Autor uebersehen hatte -- eine Zahl im Kommentar haette das nicht getan, sie liest sich
// wie eine vollstaendige Liste (das war die eigentliche Falle am 14.08.).
//
// Run: php -d zend.assertions=1 -d assert.exception=1 api/_internal/map/__tests__/weg-feld-herkunft-test.php

require_once __DIR__ . '/../field-origins.php';

$fehler = 0;
$pruefe = static function (bool $bedingung, string $was) use (&$fehler): void {
    if (!$bedingung) {
        $fehler++;
        fwrite(STDERR, "ROT: {$was}\n");
    }
};

$wurzel = dirname(__DIR__, 4);
$features = (string) file_get_contents($wurzel . '/api/_internal/map/features.php');

/**
 * 🪤 Ein Funktionsrumpf wird bis zur NAECHSTEN Funktion geschnitten, nicht auf eine geratene
 * Zeichenzahl. Ein Fenster von 14000 Zeichen reichte beim ersten Lauf in die naechste Funktion
 * hinein und meldete deren Stempel als den eigenen -- ein falsches GRUEN, also die schlimmere
 * Richtung.
 */
$rumpfVon = static function (string $quelle, string $funktion): string {
    $von = strpos($quelle, "function {$funktion}(");
    if ($von === false) {
        return '';
    }
    $rest = substr($quelle, $von + 1);
    $bis = strpos($rest, "\nfunction ");

    return $bis === false ? $rest : substr($rest, 0, $bis);
};

// ══ 1) DIE FELDLISTE: EIN Feld, und `name` steht bewusst nicht darin ═══════════════════════════
// 🔴 Den Namen schreibt `assign_to` serverseitig auf den ganzen Namensverbund
// (avesmapsWikiPathEffectiveEditName: „ein zugewiesener Wiki-Weg BESITZT den Namen"). Das Formular
// kann ihn gar nicht gegen das Wiki setzen -- eine Herkunft dafuer gehoert an die ZUWEISUNG, und
// sie hier zu fuehren hiesse, bei jedem Speichern eines zugewiesenen Weges `manual` auf einen Wert
// zu stempeln, den der Server selbst gerade durchgesetzt hat.
$serverFelder = [];
if (preg_match('/const AVESMAPS_PATH_WIKI_ORIGIN_FIELDS\s*=\s*\[(.*?)\];/s', $features, $treffer) === 1) {
    preg_match_all('/[\'"]([a-z_]+)[\'"]/', $treffer[1], $namen);
    $serverFelder = $namen[1];
}
$pruefe($serverFelder === ['feature_subtype'],
    'die Feldliste des Weges ist nicht mehr genau [feature_subtype]: ' . json_encode($serverFelder));
$pruefe(!in_array('name', $serverFelder, true),
    '`name` steht in der Feldliste des Weges -- er gehoert an `assign_to`, nicht an das Speichern');

// Und sie deckt sich mit dem, was der Browser als Kartenziel fuehrt.
// ⚠️ Vom Beginn der Objektart bis zur naechsten geschnitten. Ein Muster mit fester Einrueckung war
// beim ersten Lauf zu streng und meldete die Objektart als verschwunden, obwohl sie dastand.
$registry = (string) file_get_contents($wurzel . '/js/ui/wiki-assign-registry.js');
$wegBlock = '';
$wegVon = strpos($registry, 'weg: {');
if ($wegVon !== false) {
    $rest = substr($registry, $wegVon + 6);
    $wegBlock = preg_match('/\n\t[a-z]+:\s*\{/', $rest, $t, PREG_OFFSET_CAPTURE) === 1
        ? substr($rest, 0, $t[0][1])
        : $rest;
}
$pruefe($wegBlock !== '', 'die Objektart `weg` steht nicht mehr im Feldregister');
preg_match_all('/karte:\s*"([a-z_]*)"/', $wegBlock, $ziele);
$browserFelder = array_values(array_filter($ziele[1], static fn(string $z): bool => $z !== ''));
$pruefe($browserFelder === $serverFelder,
    'Server- und Browser-Feldliste des Weges weichen ab: '
    . json_encode($serverFelder) . ' gegen ' . json_encode($browserFelder));

// ══ 2) 🔴 JEDER SCHREIBER DES WEGTYPS STEMPELT ═════════════════════════════════════════════════
// 🔴 Gesucht wird `avesmapsReadPathSubtype($payload[` -- nur wer den Wegtyp aus dem RUMPF liest,
// aendert ihn auch. avesmapsUpdatePathFeatureGeometry liest ihn aus dem GESPEICHERTEN Feature und
// laesst ihn, wie er ist; sie zu stempeln waere eine Herkunft fuer eine Aenderung, die es nicht
// gab. Der erste Entwurf dieser Probe suchte nur nach dem Funktionsnamen und meldete sie
// faelschlich.
$zeilen = explode("\n", $features);
$schreibwege = [];
foreach ($zeilen as $nr => $zeile) {
    if (!str_contains($zeile, 'avesmapsReadPathSubtype($payload[')) {
        continue;
    }
    for ($i = $nr; $i >= 0; $i--) {
        if (preg_match('/^function\s+(\w+)/', $zeilen[$i], $treffer) === 1) {
            $schreibwege[$treffer[1]] = true;
            break;
        }
    }
}
$pruefe(count($schreibwege) >= 3,
    'weniger als DREI Weg-Schreibwege gefunden -- die Probe misst nichts mehr: '
    . json_encode(array_keys($schreibwege)));
// ⚠️ Die drei bekannten muessen dabei sein. Verschwindet einer, ist entweder der Umbau echt oder
// das Suchmuster kaputt -- beides will man sehen.
foreach (['avesmapsUpdatePathFeatureDetails', 'avesmapsUpdatePathGroupDetails', 'avesmapsCreatePathFeature'] as $erwartet) {
    $pruefe(isset($schreibwege[$erwartet]),
        "der bekannte Schreibweg {$erwartet} wurde nicht gefunden -- Suchmuster oder Umbau pruefen");
}

foreach (array_keys($schreibwege) as $funktion) {
    $rumpf = $rumpfVon($features, $funktion);
    $pruefe(str_contains($rumpf, 'avesmapsFieldOriginsStempeln('),
        "der Schreibweg {$funktion} setzt den Wegtyp, stempelt aber keine Herkunft -- eine Regel, "
        . 'die einen von mehreren Erzeugern bindet, ist keine Regel');
    $pruefe(str_contains($rumpf, 'AVESMAPS_PATH_WIKI_ORIGIN_FIELDS'),
        "der Schreibweg {$funktion} liest `wiki_uebernommen` nicht gegen die Feldliste des Weges");
}

// ══ 3) 💣 DIE WEG-EBENE STEMPELT JE ABSCHNITT, NICHT EINMAL FUER DIE GRUPPE ════════════════════
// Eine Namensgruppe kann gemischt sein: in einer ueber Art+Name gebildeten Gruppe traegt nicht
// jeder Abschnitt denselben Wegtyp. Fuer die, die den gewaehlten Typ schon haben, aendert sich
// nichts -- einmal fuer die Gruppe gestempelt, bekaemen genau sie eine Herkunft fuer eine
// Aenderung, die bei ihnen gar nicht stattgefunden hat.
$gruppe = $rumpfVon($features, 'avesmapsUpdatePathGroupDetails');
$schleifeVon = strpos($gruppe, 'foreach ($features as $feature)');
$stempelVon = strpos($gruppe, 'avesmapsFieldOriginsStempeln(');
$pruefe($schleifeVon !== false && $stempelVon !== false && $stempelVon > $schleifeVon,
    'der Stempel der Weg-Ebene steht AUSSERHALB der Abschnitts-Schleife -- dann traegt ein '
    . 'unveraenderter Abschnitt eine Herkunft fuer eine Aenderung, die es bei ihm nicht gab');
// ⚠️ Und er haengt an `$wantsSubtype`: ohne diese Bedingung zaehlte er eine Aenderung, die von
// woanders kommt.
$pruefe(preg_match('/if \(\$wantsSubtype\) \{[^{}]*avesmapsFieldOriginsStempeln\(/s', $gruppe) === 1,
    'der Stempel der Weg-Ebene laeuft auch, wenn `feature_subtype` gar nicht angefasst wurde');

// ══ 4) DIE RECHNUNG SELBST, an den Faellen, die der Weg wirklich kennt ═════════════════════════
// (a) Ein gemischter Verbund: der Abschnitt, der den Typ schon traegt, wird NICHT angefasst.
$unveraendert = avesmapsFieldOriginsStempeln(
    ['feature_subtype' => 'wiki'],
    ['feature_subtype' => 'Reichsstrasse'],
    ['feature_subtype' => 'Reichsstrasse'],
    []
);
$pruefe($unveraendert === ['feature_subtype' => 'wiki'],
    'ein Abschnitt, dessen Typ sich nicht aendert, bekam eine neue Herkunft: ' . json_encode($unveraendert));

// (b) Der Sammel-Wechsel von Hand: `manual`, weil die Anfrage nichts aus dem Wiki nennt.
$vonHand = avesmapsFieldOriginsStempeln(
    [],
    ['feature_subtype' => 'Weg'],
    ['feature_subtype' => 'Strasse'],
    []
);
$pruefe($vonHand === ['feature_subtype' => 'manual'],
    'ein Sammel-Wechsel ohne Wiki-Angabe gilt nicht als von Hand: ' . json_encode($vonHand));

// (c) Und die Sync-Uebernahme: die Oberflaeche nennt das Feld, also `wiki`.
$ausWiki = avesmapsFieldOriginsStempeln(
    ['feature_subtype' => 'manual'],
    ['feature_subtype' => 'Weg'],
    ['feature_subtype' => 'Gebirgspass'],
    ['feature_subtype']
);
$pruefe($ausWiki === ['feature_subtype' => 'wiki'],
    'das ↺ befreit den handgesetzten Wegtyp nicht: ' . json_encode($ausWiki));

// (d) 💣 Ein Client, der `name` als Wiki-Uebernahme NENNT, bekommt dafuer keine Herkunft: die
// Filterung laesst nur die erlaubten Felder durch, und `name` ist beim Weg keines. Ohne diesen
// Riegel legte ein Client eine Herkunft fuer ein Feld an, das niemand fortschreibt.
$mitName = avesmapsFieldOriginsAusWikiLesen(
    ['wiki_uebernommen' => ['name', 'feature_subtype', 'geometry']],
    ['feature_subtype']
);
$pruefe($mitName === ['feature_subtype'],
    'die Filterung laesst fremde Felder durch: ' . json_encode($mitName));

// ══ 5) 🔴 UND DER LESEWEG GIBT SIE AUCH HERAUS ════════════════════════════════════════════════
// Die Projektion des Wege-Editors ist eine WEISSE LISTE (der Kommentar dort sagt es). Ohne diese
// Zeile stempelte der Server gepflegt vor sich hin, und die Oberflaeche saehe nie etwas davon --
// genau der Zustand, in dem die Landschaft vier Tage lang steckte.
$leseweg = (string) file_get_contents($wurzel . '/api/edit/map/paths-editor.php');
// 🪤 Geprueft wird der PAYLOAD-SCHLUESSEL (`'field_origins' =>`), nicht das blosse Vorkommen: die
// Zeile darunter liest `$properties['field_origins']`, und ein `str_contains` auf den nackten Namen
// war damit auch dann noch gruen, wenn der Schluessel im Ergebnis umbenannt war.
$pruefe(preg_match("/'field_origins'\s*=>/", $leseweg) === 1,
    'api/edit/map/paths-editor.php gibt `field_origins` nicht heraus -- die weisse Liste laesst die '
    . 'Herkunft nicht durch, und der Editor kann sie nicht kennen');

if ($fehler > 0) {
    fwrite(STDERR, "weg-feld-herkunft: {$fehler} Zusicherung(en) verletzt\n");
    exit(1);
}
echo 'weg-feld-herkunft: alle Zusicherungen erfuellt (' . count($schreibwege) . " Schreibwege gezaehlt)\n";
