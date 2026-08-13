<?php

declare(strict_types=1);

// Reine Torwaechter-Entscheidung des Lesepfads (Task 4b, Schritt 1): darf eine Anfrage an
// api/app/lore.php ueberhaupt bedient werden, oder verdient sie den 400 "place_invalid"?
// avesmapsLoreRequestHasSubject ist reine Logik -- kein PDO, kein $_GET -- daher isoliert
// testbar ohne HTTP- oder DB-Fixture. Das ist die "eine reine Funktion" aus Schritt 1 des
// Briefs: drei bereits genormte Zeichenketten hinein, ein bool heraus.

require_once __DIR__ . '/../lore.php';

// Ein brauchbarer Ortsschluessel allein reicht -- das alte Verhalten bleibt unveraendert.
assert(avesmapsLoreRequestHasSubject('punin', '', '') === true, 'Ortsschluessel allein genuegt');

// area allein genuegt -- der Fall, den Task 4b erst erreichbar macht: eine Flaeche ohne
// zugehoerigen Ortsschluessel darf trotzdem ihre Lebensraum-Regel treffen.
assert(avesmapsLoreRequestHasSubject('', 'a2', '') === true, 'area allein genuegt');

// location allein genuegt -- derselbe Fall fuer eine Siedlung OHNE Wiki-Artikel (Anlass der
// Aufgabe: 2.885 von 4.883 Siedlungen).
assert(avesmapsLoreRequestHasSubject('', '', 'p1') === true, 'location allein genuegt');

// Mehrere Ortsschluessel (Kommaliste, Territorienkette) zusammen mit Identitaet genuegen erst
// recht -- keiner der drei Werte darf den anderen verdraengen.
assert(avesmapsLoreRequestHasSubject('darpatien,reichsforst', 'a2', 'p1') === true,
    'Kommaliste plus area plus location genuegen zusammen');

// Nur wenn ALLE DREI leer sind, darf die Anfrage den 400 bekommen.
assert(avesmapsLoreRequestHasSubject('', '', '') === false,
    'ganz ohne Ortsschluessel, area und location bleibt der 400 bestehen');

echo "lore-request-has-subject: OK\n";
