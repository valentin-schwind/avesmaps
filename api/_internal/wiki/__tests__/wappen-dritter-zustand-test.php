<?php

declare(strict_types=1);

/**
 * DER DRITTE ZUSTAND: „dieser Ort / dieses Gebiet hat kein Wappen, und das bleibt so."
 * Owner-Entscheid 23.08.2026. Lauf:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/wappen-dritter-zustand-test.php
 *
 * 🔴 DAS IST EIN VOLLSTAENDIGKEITS-TEST, kein Verhaltenstest. Die Gefahr liegt nicht darin, dass
 * das Entfernen nicht funktioniert -- sie liegt darin, dass EIN Schreibweg die Entscheidung
 * uebergeht und sie beim naechsten Abgleich still verschwindet. Genau diese Fehlerklasse hat das
 * Projekt schon zweimal bezahlt (14.08.: eine Sperre in zwei von vier Erzeugern; 17.08.: ein
 * Stempler, der jedes mitgeschickte Feld traf).
 *
 * Geprueft wird deshalb die VERDRAHTUNG in den echten Quellen, nicht eine nachgebaute Regel.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'. Neu starten mit: "
        . "php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

$ROOT = dirname(__DIR__, 4);
$lies = static function (string $rel) use ($ROOT): string {
    $pfad = $ROOT . '/' . $rel;
    assert(is_file($pfad), "Datei existiert: $rel");
    return (string) file_get_contents($pfad);
};

$settlements = $lies('api/_internal/wiki/settlements.php');
$upload      = $lies('api/edit/wiki/settlement-coat-upload.php');
$mapFeatures = $lies('api/app/map-features.php');

/** Der Rumpf einer PHP-Funktion (bis zur naechsten Funktion auf Spaltenanfang). */
$rumpf = static function (string $quelle, string $name): string {
    $ab = strpos($quelle, 'function ' . $name . '(');
    assert($ab !== false, "Funktion $name existiert");
    $bis = strpos($quelle, "\nfunction ", $ab + 1);
    return substr($quelle, $ab, $bis === false ? null : $bis - $ab);
};

// ---- 1. Entfernen SETZT den Zustand, es loescht nicht nur --------------------------------------
$clear = $rumpf($settlements, 'avesmapsWikiSettlementClearCoat');
assert(strpos($clear, "\$props['coat_none'] = true") !== false,
    'DER KERN: Entfernen setzt coat_none. Ein blosses unset($props[\'coat\']) genuegt NICHT -- '
    . 'der naechste Abgleich traegt das Wiki-Wappen wieder ein und die Entscheidung des Editors '
    . 'verschwindet, ohne dass es jemandem auffaellt.');
assert(strpos($clear, "unset(\$props['coat'])") !== false,
    'und das bisherige Wappen geht dabei natuerlich weg');

// ---- 2. Der MASSENLAUF respektiert ihn ---------------------------------------------------------
$bulk = $rumpf($settlements, 'avesmapsWikiSettlementBulkRecordCoats');
// 💣 Die GENAUE Bedingung samt continue, nicht das blosse Wort: in derselben Funktion steht
// weiter unten ein unset(...coat_none), und ein strpos darauf ist immer wahr -- die erste Fassung
// dieses Tests hat die Mutation „Pruefung entfernt" deshalb ueberlebt.
$posPruefung = strpos($bulk, "(\$props['coat_none'] ?? false) === true");
assert($posPruefung !== false,
    'der Massenlauf fragt coat_none ausdruecklich ab -- sonst macht er jede Entfernen-Entscheidung '
    . 'rueckgaengig');
$nachPruefung = substr($bulk, $posPruefung, 120);
assert(strpos($nachPruefung, 'continue') !== false,
    'und ueberspringt den Datensatz dann auch wirklich');
$posSchreiben = strpos($bulk, "\$props['coat'] = [");
assert($posSchreiben === false || $posPruefung < $posSchreiben,
    '💣 und er fragt sie VOR dem Schreiben. Eine Pruefung danach ist keine Pruefung.');

// ---- 3. Eine ausdrueckliche Zuweisung HEBT ihn auf ---------------------------------------------
// Sonst muesste ein Editor erst entsperren, bevor er ein Wappen setzen darf -- eine Sackgasse.
foreach ([
    ['settlements.php / SetWikiCoat', $rumpf($settlements, 'avesmapsWikiSettlementSetWikiCoat')],
    ['settlement-coat-upload.php',    $upload],
] as [$wo, $quelle]) {
    $posAuf = strpos($quelle, "unset(\$props['coat_none'])");
    $posSetzt = strpos($quelle, "\$props['coat'] = [");
    assert($posAuf !== false, "$wo hebt coat_none auf");
    assert($posSetzt !== false && $posAuf < $posSetzt,
        "$wo hebt es VOR dem Setzen auf");
}

// ---- 4. Die AUSGABE zeigt dann wirklich nichts -------------------------------------------------
// 💣 Es genuegt nicht, properties.coat zu entfernen: der Leser faellt sonst auf
// wiki_settlement.wappen_url zurueck und zeigt doch wieder das Wiki-Wappen. Genau dieser Rueckfall
// ist der Grund, warum der Schalter „Wappen: Aus" das Problem verschlimmert hat.
// 🪤 KOMMENTARE RAUS, BEVOR GESUCHT WIRD. Ein neuer Erklaerblock nannte `coat_none` und stand vor
// dem echten Zweig -- strpos traf den Kommentar und mass danach das falsche Fenster. Genau diese
// Fehlerklasse ist im Haus schon mehrfach aufgetreten; sie kostet jedes Mal die Suche nach einer
// Regression, die es nicht gibt.
$mfCode = (string) preg_replace('#^\s*//.*$#m', '',
    (string) preg_replace('#/\*.*?\*/#s', '', $mapFeatures));
$posNone = strpos($mfCode, "coat_none");
assert($posNone !== false, 'map-features.php kennt coat_none');
$fenster = substr($mfCode, $posNone, 500);
assert(strpos($fenster, "unset(\$properties['coat'])") !== false,
    'die Ausgabe entfernt das eigene Wappen');
// 💣 Die GENAUE Zuweisung, nicht das Wort: das Fenster reicht bis in den foreach-Block darunter,
// in dem „wappen_url" ohnehin steht -- die erste Fassung hat die Mutation deshalb ueberlebt.
assert(strpos($fenster, "\$properties['wiki_settlement']['wappen_url'] = ''") !== false,
    'DER KERN VON TEIL 4: sie raeumt AUCH wiki_settlement.wappen_url weg -- sonst zeigt der Ort '
    . 'trotz „kein Wappen" das des Wikis, und der Browser fragt es sogar dort an.');

// ---- 5. Territorium: der Zustand existiert bereits, er braucht nur einen Knopf ------------------
// ⭐ avesmapsResolveGatedCoatUrl entscheidet mit array_key_exists: ein Override, der DA ist und
// leer, heisst schon immer „bewusst kein Wappen" (kein Fall-through auf den Wiki-Stand). Diese
// Zusicherung haelt fest, dass der neue Knopf sich darauf verlassen darf.
// 🪤 Diese Zusicherung las bis zum 23.08.2026 den RUMPF von avesmapsResolveGatedCoatUrl und suchte
// dort nach `array_key_exists`. Beim Umbau auf die zwei Herkunfts-Schalter wurde jene Funktion ein
// duenner Wrapper um avesmapsResolveGatedCoat -- der Test brach, obwohl das VERHALTEN unveraendert
// war. Deshalb misst er jetzt das Verhalten statt den Quelltext: das ueberlebt den naechsten Umbau,
// und es ist ohnehin die Aussage, auf die sich der Knopf verlaesst.
require_once dirname(__DIR__, 3) . '/_internal/coat-url.php';
$pdTest = 'public_domain';

// Ein Override, der DA ist und LEER: heisst „bewusst kein Wappen" -- kein Rueckfall auf das Wiki.
assert(avesmapsResolveGatedCoatUrl(['coat_of_arms_url' => ''], '', 'https://wiki/w.png', $pdTest) === '',
    'DER KERN VON TEIL 5: ein leerer Override heisst „kein Wappen" und faellt NICHT auf den '
    . 'Wiki-Stand zurueck -- darauf setzt der Entfernen-Knopf im Monitor auf');

// Und OHNE Override greift der Wiki-Stand ganz normal -- sonst waere die Zusicherung darueber
// trivial erfuellt (jede Antwort waere leer).
assert(avesmapsResolveGatedCoatUrl([], '', 'https://wiki/w.png', $pdTest) !== '',
    'ohne Override liefert der Wiki-Stand weiterhin ein Wappen');

// ---- 6. Beide Oberflaechen haben den Knopf, und beide verlangen eine Bestaetigung --------------
$editor  = $lies('html/wiki-sync-settlement-editor.html');
$monitor = $lies('html/wiki-sync-monitor.html');
assert(strpos($editor, 'data-coat-clear-trigger') !== false, 'Siedlungs-Editor hat den Knopf');
assert(strpos($editor, 'settlementCoatClear') !== false, 'und seinen Handler');
assert(strpos($monitor, 'data-remove-coat') !== false, 'Territorien-Monitor hat den Knopf');
assert(strpos($monitor, 'async function removeCoat') !== false, 'und seinen Handler');

// 💣 dry_run:false UND confirm:"apply" -- der Endpunkt verlangt beides ($isApply in
// api/edit/wiki/settlements.php). Ein blosses apply:true laesst ihn im Probelauf: der Knopf haette
// Erfolg gemeldet und nichts getan.
$posClear = strpos($editor, 'action: "clear_coat"');
assert($posClear !== false, 'der Editor ruft clear_coat');
$aufruf = substr($editor, $posClear, 200);
assert(strpos($aufruf, 'dry_run: false') !== false && strpos($aufruf, 'confirm: "apply"') !== false,
    'und zwar scharf -- mit dry_run:false UND confirm:"apply", sonst laeuft er als Probelauf');

// ---- 7. Ein WAPPENFELD nimmt nur Wappen -------------------------------------------------------
// 🔴 Owner 23.08.2026: "wir ziehen aber keine bilder von orten und wir wollen das auch gar nicht".
// 🪤 Der Parser las 'wappen', 'bild', 'wappenbild', 'bilddatei'. Hat ein Ort im Wiki kein Wappen,
// aber ein Foto in der Infobox, landete das Foto im WAPPENFELD -- und wurde danach ueberall wie
// ein Wappen behandelt und geladen. Daher kamen "Drachenmuseum Sofus.jpg", "Auraleth by Fil.jpg"
// und "Etilia-Statue2023 RvB.jpg" in den Fehlermeldungen des Editors.
// 🔴 ALLE DREI Objektarten, nicht nur der Ort: Regionen lasen 'bild' sogar ZUERST, Wege
// ausschliesslich. Eine Regel, die eine von drei Stellen bindet, ist keine Regel.
foreach ([
    ['Ort', $settlements],
    ['Region', $lies('api/_internal/wiki/regions.php')],
    ['Weg', $lies('api/_internal/wiki/paths.php')],
] as [$art, $quelle]) {
    foreach (["'bild'", "'bilddatei'"] as $fremd) {
        assert(strpos($quelle, 'MonitorField($norm, [' . $fremd) === false
            && strpos($quelle, ", $fremd") === false,
            "$art: das Bild-/Wappenfeld liest kein $fremd mehr -- ein beliebiges Foto aus der "
            . "Wiki-Infobox ist kein Wappen (Owner 23.08.2026)");
    }
}
$stellen = substr_count($settlements, "avesmapsWikiSyncMonitorField(\$norm, ['wappen', 'wappenbild'])");
assert($stellen === 2,
    "💣 BEIDE Lesestellen sind umgestellt (gefunden: $stellen von 2). Der Ort wird an zwei Orten "
    . "geparst; eine Regel, die nur eine davon bindet, ist keine Regel.");

echo "OK: wappen-dritter-zustand-test -- alle Zusicherungen gehalten\n";
