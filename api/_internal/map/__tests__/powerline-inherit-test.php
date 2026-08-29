<?php

declare(strict_types=1);

/**
 * Was ein NEU entstehendes Kraftlinien-Segment von seiner Linie erbt. Lauf (aus dem
 * Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       api/_internal/map/__tests__/powerline-inherit-test.php
 *
 * 💣 Diese Liste stand ZWEIMAL abgeschrieben nebeneinander -- einmal in
 * avesmapsCreatePowerlineFeature ("Nodix anhaengen"), einmal in avesmapsReorderPowerlineLine
 * ("Umsortieren") -- und in beiden fehlte `wiki_no_article`. Ein frisch entstandenes Segment ohne
 * den Merker bringt den Fall im Konfliktzentrum mit segments = 1 zurueck, obwohl niemand etwas
 * entschieden hat. Seit 15.08.2026 gibt es nur noch EINE Liste, und dieser Test ist der Grund,
 * warum sie eine bleibt.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

require __DIR__ . '/../features.php';

// Eine Linie mit allem, was eine Linie tragen kann.
$voll = avesmapsPowerlineInheritedLineFields([
    'name' => 'Hexenband',
    'show_label' => true,
    'description' => 'Die alte Ader.',
    'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Hexenband',
    'wiki_no_article' => true,
    'curve' => 26.0,
    // Nichts davon darf mitwandern: das Wiki-Nest gehoert dem Abgleich, die Endpunkte dem Segment.
    'wiki_powerline' => ['wiki_url' => 'https://de.wiki-aventurica.de/wiki/Hexenband'],
    'from_public_id' => 'nodix-a',
    'to_public_id' => 'nodix-b',
]);

assert($voll['show_label'] === true);
assert($voll['description'] === 'Die alte Ader.');
assert($voll['wiki_url'] === 'https://de.wiki-aventurica.de/wiki/Hexenband');
// 💣 Der Mutationstoeter: genau dieses Feld fehlte in beiden Abschriften.
assert(($voll['wiki_no_article'] ?? null) === true, 'der Merker wandert mit');
// Die Kurvenform (29.08.2026) -- eine Eigenschaft der LINIE, nicht des einzelnen Stuecks. Ohne sie
// laege ein spaeter angehaengtes Segment kerzengerade zwischen zwei gebogenen.
assert($voll['curve'] === 26.0, 'die Kurvenform gehoert in die EINE Erb-Liste');

// 🔴 Und NUR die oben zugesicherten -- hier steht bewusst KEINE Zahl mehr (sie war „vier" und wurde
// mit der Kurvenform am 29.08.2026 falsch; eine Zahl liest sich wie eine vollstaendige Liste, und
// niemand zaehlt nach). Ein Segment, das das Wiki-Nest miterbte, behauptete Wiki-Daten, die zu ihm
// nie jemand geholt hat; geerbte Endpunkte machten aus dem neuen Segment eine Kopie des alten.
assert(!array_key_exists('wiki_powerline', $voll), 'das Wiki-Nest bleibt beim Abgleich');
assert(!array_key_exists('from_public_id', $voll) && !array_key_exists('to_public_id', $voll), 'die Endpunkte gehoeren dem Segment');
assert(!array_key_exists('name', $voll), 'den Namen setzt der Aufrufer, er wird nicht geerbt');

// Eine Linie ohne Merker liefert den Schluessel GAR NICHT -- nicht `false`.
// ⚠️ Als `false` wird der Merker nirgends abgelegt (der Linien-Schreibweg loescht ihn), und ein
// `false` liesse sich spaeter nicht von "nie entschieden" unterscheiden.
$ohne = avesmapsPowerlineInheritedLineFields([
    'show_label' => false,
    'description' => '',
    'wiki_url' => '',
]);
assert(!array_key_exists('wiki_no_article', $ohne), 'kein Merker heisst kein Schluessel, nicht false');
assert($ohne['show_label'] === false && $ohne['description'] === '' && $ohne['wiki_url'] === '');
// ⚠️ Und die Kurve faellt hier auf GERADE zurueck, nicht auf einen fehlenden Schluessel: sie ist
// eine Zahl mit einem sinnvollen Nullwert, kein dritter Zustand wie der Merker darueber.
assert($ohne['curve'] === 0.0, 'ohne Wert erbt ein neues Segment eine gerade Linie');

// Ein falsywertiger Merker zaehlt nicht als gesetzt -- sonst schleppte eine alte Zeile mit
// `wiki_no_article: false` den Schluessel ewig weiter.
$falsy = avesmapsPowerlineInheritedLineFields(['wiki_no_article' => false]);
assert(!array_key_exists('wiki_no_article', $falsy));

// Gar keine Linie (erstes Segment eines neuen Namens): leere, aber vollstaendige Felder.
$leer = avesmapsPowerlineInheritedLineFields(null);
assert($leer['show_label'] === false);
assert($leer['description'] === '');
assert($leer['wiki_url'] === '');
assert(!array_key_exists('wiki_no_article', $leer));

// --- Beide Erzeuger fragen dieselbe Liste, keiner schreibt sie ab ------------------------------
// 💣 Der eigentliche Befund war nicht das fehlende Feld, sondern die ZWEITE Abschrift. Ohne diese
// Probe koennte jemand die Liste an einer Stelle wieder ausschreiben, und der Test oben bliebe gruen.
$source = file_get_contents(__DIR__ . '/../features.php');
assert(is_string($source));
assert(
    preg_match('/function avesmapsCreatePowerlineFeature\(.*?\n\}/s', $source, $createMatch) === 1
    && preg_match('/function avesmapsReorderPowerlineLine\(.*?\n\}/s', $source, $reorderMatch) === 1,
    'beide Erzeuger lassen sich isolieren'
);
foreach (['anhaengen' => $createMatch[0], 'umsortieren' => $reorderMatch[0]] as $label => $body) {
    assert(
        str_contains($body, 'avesmapsPowerlineInheritedLineFields('),
        "der Erzeuger \"$label\" fragt die gemeinsame Erbliste"
    );
    assert(
        !preg_match("/'show_label'\s*=>\s*\(bool\)/", $body),
        "der Erzeuger \"$label\" schreibt sie nicht wieder ab"
    );
}

fwrite(STDOUT, "powerline-inherit-test: alle Zusicherungen erfuellt\n");
