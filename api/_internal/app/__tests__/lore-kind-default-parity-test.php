<?php

declare(strict_types=1);

// Die Vorgabe „ist diese Art oeffentlich sichtbar?" steht ZWEIMAL im Haus, und das ist Absicht:
//
//   avesmapsLoreKindDefaultEnabled       (lore.php)        -- Infobox, Dialog, Editor
//   avesmapsLoreSearchKindDefaultEnabled (lore-search.php) -- die Kartensuche
//
// Der heisse Suchpfad darf lore.php nicht laden (dessen Nachbarn machen DDL und Spaltenproben,
// siehe den Kommentarkopf von lore-search.php), also traegt er eine eigene Kopie. Eine Kopie ohne
// Waechter laeuft irgendwann auseinander -- dann steht eine Art in der Infobox und fehlt in der
// Suche, ohne dass irgendwo ein Fehler auftaucht.
//
// 🪤 Genau das war bis zum 19.08.2026 der ZUSTAND, nur gewollt: `spezies` war in beiden
// Kopien AUS. Beim Freischalten musste jede einzeln angefasst werden -- dieser Test ist der
// Waechter, den es dabei noch nicht gab.

if (!assert_options(ASSERT_ACTIVE)) {
    fwrite(STDERR, "FATAL: run with -d zend.assertions=1 -- assert() is a no-op otherwise
");
    exit(1);
}

require_once __DIR__ . '/../lore.php';
require_once __DIR__ . '/../lore-search.php';

// Beide Listen fuehren dieselben vier Arten (die Reihenfolge darf abweichen -- die eine reiht nach
// Anzeige, die andere nicht).
$kinds = AVESMAPS_LORE_KINDS;
$searchKinds = AVESMAPS_LORE_SEARCH_KINDS;
sort($kinds);
sort($searchKinds);
assert($kinds === $searchKinds, 'beide Kopien kennen dieselben Arten');

// Und sie sagen fuer jede Art dasselbe.
foreach (AVESMAPS_LORE_KINDS as $kind) {
    assert(
        avesmapsLoreKindDefaultEnabled($kind) === avesmapsLoreSearchKindDefaultEnabled($kind),
        'Vorgabe laeuft auseinander bei: ' . $kind
    );
    assert(
        avesmapsLoreKindSettingKey($kind) === avesmapsLoreSearchSettingKey($kind),
        'Einstellungsschluessel laeuft auseinander bei: ' . $kind
    );
}

// Der Stand seit dem 19.08.2026: alle vier an. Ausdruecklich hingeschrieben und nicht nur als
// Gleichheit geprueft -- zwei Kopien, die gemeinsam auf AUS fallen, waeren ebenfalls „einig".
foreach (AVESMAPS_LORE_KINDS as $kind) {
    assert(avesmapsLoreKindDefaultEnabled($kind) === true, 'Vorgabe AN erwartet bei: ' . $kind);
}

echo "lore-kind-default-parity ok
";
