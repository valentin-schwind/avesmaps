<?php

declare(strict_types=1);

// Die Kutsche fährt nicht querfeldein.
//
// 🔴 REGELWERK, NICHT PHYSIK. Das offizielle DSA-Landreisekapitel verbietet der Kutsche mehrere
// Wegarten rundheraus -- Pfade, Querfeldein, Wüsten, Eisgebiete -- statt sie über eine Steigung
// langsamer zu machen. Wüstenpfad und Pfad sind seit 2026-07-30 abgebildet (der eine hart, der
// andere als abgewählte Voreinstellung); Querfeldein war die letzte offene Wegart.
//
// 💣 ZWEI ERZEUGER, NICHT EINER. `avesmapsConnectClientCompatibleDetachedGraphComponents` baut die
// Komponentenbrücken, der Wegpunkt-Anker baut noch einmal eigene Querfeldein-Kanten. Wer nur den
// ersten absichert, lässt die Sperre genau an den Stellen offen, die der Nutzer selbst eingibt --
// dasselbe Muster, das V13 beim Wasser schon einmal gekostet hat.
//
// Lauf:  php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/carriage-offroad-test.php

// request.php trägt die Transportmittel-Konstanten, client-graph.php die Regeln. Beide sind beim
// Einbinden nebenwirkungsfrei (nur Funktionen und Konstanten) -- keine Datenbank, kein HTTP.
require_once __DIR__ . '/../request.php';
require_once __DIR__ . '/../client-graph.php';

// ---- die Wegart bietet der Kutsche nichts mehr an ------------------------------------------------
$offered = avesmapsClientRouteTransportOptions('Querfeldein');
assert(!in_array('horseCarriage', $offered, true), 'Querfeldein bietet der Kutsche keinen Platz mehr');
assert(in_array('caravan', $offered, true), 'die Karawane kommt querfeldein weiterhin durch');
assert(in_array('groupFoot', $offered, true), 'Fussgaenger ohnehin');
assert(in_array('lightRider', $offered, true), 'und Reiter auch');

// Die anderen Wegarten bleiben unberührt -- besonders die, an denen schon eine Regel hängt.
assert(!in_array('horseCarriage', avesmapsClientRouteTransportOptions('Wuestenpfad'), true), 'Wueste bleibt gesperrt');
assert(in_array('horseCarriage', avesmapsClientRouteTransportOptions('Pfad'), true), 'der Pfad BIETET die Kutsche weiterhin an');
assert(!in_array('horseCarriage', avesmapsClientRouteDefaultAllowedTransports('Pfad'), true), 'waehlt sie aber nicht vor');
assert(in_array('horseCarriage', avesmapsClientRouteTransportOptions('Strasse'), true), 'auf der Strasse faehrt sie');
assert(in_array('horseCarriage', avesmapsClientRouteTransportOptions('Gebirgspass'), true), 'und ueber den Pass auch');

// ---- die Sperre wirkt über den gemeinsamen Torwaechter -------------------------------------------
// 🔴 Das ist der Aufruf, den BEIDE Querfeldein-Erzeuger machen müssen. Prüft ihn direkt, damit der
// Test nicht davon abhängt, einen ganzen Graphen zu bauen.
assert(
    avesmapsIsClientTransportAllowedForPath('Querfeldein', 'horseCarriage') === false,
    'der Torwaechter sperrt die Kutsche querfeldein'
);
assert(
    avesmapsIsClientTransportAllowedForPath('Querfeldein', 'groupFoot') === true,
    'und laesst die Fussgruppe durch'
);

// 💣 Eine gespeicherte Liste darf die Sperre nicht aushebeln. `resolve…` filtert eine gespeicherte
// Liste auf das, was die Wegart ANBIETET -- genau der Mechanismus, der die Kutsche schon vom
// Wuestenpfad fernhaelt, auch wenn ein Editor sie dort einmal angehakt hat.
$withStoredCarriage = ['properties' => ['transport_domain' => 'land', 'allowed_transports' => ['horseCarriage', 'groupFoot']]];
assert(
    avesmapsIsClientTransportAllowedForPath('Querfeldein', 'horseCarriage', $withStoredCarriage) === false,
    'auch eine gespeicherte Kutsche kommt querfeldein nicht durch'
);
assert(
    avesmapsIsClientTransportAllowedForPath('Querfeldein', 'groupFoot', $withStoredCarriage) === true,
    'die uebrigen Eintraege der Liste bleiben gueltig'
);

echo "carriage-offroad-test: all asserts passed\n";
