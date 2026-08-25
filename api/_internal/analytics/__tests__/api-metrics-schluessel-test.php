<?php

declare(strict_types=1);

/**
 * Die reinen Funktionen der API-Zaehlbibliothek: Endpunktschluessel, Zone, Statusklasse und der
 * Zeilenbau. Kein Datenbankzugriff -- alles hier ist eine Abbildung von Eingabe auf Ausgabe.
 *
 * Entwurf: docs/superpowers/specs/2026-08-25-api-nutzung-design.md
 *
 * Lauf aus dem Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/analytics/__tests__/api-metrics-schluessel-test.php
 * Exit 0 = alle Zusicherungen halten.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos. "
        . "Neu starten mit: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../api-metrics.php';

// --- Der Endpunktschluessel ------------------------------------------------------------------
assert(avesmapsApiMetricsEndpunktSchluessel('/api/app/map-features.php') === 'app/map-features');
assert(avesmapsApiMetricsEndpunktSchluessel('/api/route/index.php') === 'route/index');
assert(avesmapsApiMetricsEndpunktSchluessel('/api/edit/map/features.php') === 'edit/map/features');
// Ein Unterverzeichnis der Seite davor darf nicht durchschlagen.
assert(avesmapsApiMetricsEndpunktSchluessel('/kunden/web/api/app/coat.php') === 'app/coat');

// 💣 NIEMALS DIE ABFRAGE. Kaeme der Schluessel aus REQUEST_URI, stuenden Suchbegriffe und
// Kennungen echter Besucher in einer Betriebstabelle, und die Dimension waere unbegrenzt.
// Der Test haelt fest, dass ein Fragezeichen es nie in den Schluessel schafft.
assert(!str_contains(avesmapsApiMetricsEndpunktSchluessel('/api/app/coat.php?wiki_key=geheim'), '?'));
assert(!str_contains(avesmapsApiMetricsEndpunktSchluessel('/api/app/map-search.php?q=Gareth'), 'Gareth'));

// Unbrauchbares faellt auf einen festen Namen, nie auf die Adresse.
assert(avesmapsApiMetricsEndpunktSchluessel('') === 'unbekannt');
assert(avesmapsApiMetricsEndpunktSchluessel('/nichts/dergleichen.php') === 'unbekannt');

// --- Die vier Zonen --------------------------------------------------------------------------
assert(avesmapsApiMetricsZone('route/index') === 'offen');
assert(avesmapsApiMetricsZone('locations/index') === 'offen');
assert(avesmapsApiMetricsZone('app/map-features') === 'app');
assert(avesmapsApiMetricsZone('edit/map/features') === 'edit');
assert(avesmapsApiMetricsZone('discord/interactions') === 'sonstige');
assert(avesmapsApiMetricsZone('unbekannt') === 'sonstige');

// --- Die Statusklassen -----------------------------------------------------------------------
assert(avesmapsApiMetricsStatusKlasse(200, true) === '2xx');
assert(avesmapsApiMetricsStatusKlasse(204, true) === '2xx');
assert(avesmapsApiMetricsStatusKlasse(304, true) === '3xx');
assert(avesmapsApiMetricsStatusKlasse(404, true) === '4xx');
assert(avesmapsApiMetricsStatusKlasse(500, true) === '5xx');

// 🔴 DER FALL, FUER DEN DIE TAFEL GEBAUT WIRD: die Anfrage ist nie durch den Trichter gekommen.
// Ein Fatal Error antwortet mit leerem Rumpf, und der Statuscode ist dann bedeutungslos --
// PHP meldet in diesem Zustand oft weiterhin 200.
assert(avesmapsApiMetricsStatusKlasse(200, false) === 'leer');
assert(avesmapsApiMetricsStatusKlasse(500, false) === 'leer');
assert(avesmapsApiMetricsStatusKlasse(null, false) === 'leer');

// --- Der Fehlercode ist ein geschlossenes Vokabular -------------------------------------------
// 💣 Ein dynamisch gebauter Code (mit einer Kennung darin) blaehte die Dimension auf wie
// REQUEST_URI. Alles ausserhalb von ^[a-z0-9_]{1,40}$ wird eingesammelt.
assert(avesmapsApiMetricsFehlerCode('server_error') === 'server_error');
assert(avesmapsApiMetricsFehlerCode('not_found') === 'not_found');
assert(avesmapsApiMetricsFehlerCode('Fehler bei Gareth (id 4711)') === 'sonstiger_code');
assert(avesmapsApiMetricsFehlerCode(str_repeat('a', 41)) === 'sonstiger_code');
assert(avesmapsApiMetricsFehlerCode(null) === 'sonstiger_code');
assert(avesmapsApiMetricsFehlerCode(42) === 'sonstiger_code');

// --- Der Zeilenbau ---------------------------------------------------------------------------
$KEINE = AVESMAPS_API_METRICS_KEINE_STUNDE;

// Eine gesunde Antwort: zwei Zeilen, kein Fehlereintrag.
$gut = avesmapsApiMetricsZeilenFuerAnfrage('/api/app/map-features.php', 200, true, null, 14);
assert(count($gut) === 2, 'gesunde Antwort: antwort + stunde');
assert($gut[0] === ['metric' => 'antwort', 'dimension' => 'app/map-features|2xx', 'hour' => $KEINE]);
assert($gut[1] === ['metric' => 'stunde', 'dimension' => '', 'hour' => 14]);

// Ein Fehler: die dritte Zeile kommt dazu.
$schlecht = avesmapsApiMetricsZeilenFuerAnfrage('/api/edit/wiki/sync.php', 500, true, 'server_error', 3);
assert(count($schlecht) === 3, 'Fehler: antwort + stunde + fehler');
assert($schlecht[2] === ['metric' => 'fehler', 'dimension' => 'edit/wiki/sync|server_error', 'hour' => $KEINE]);

// Eine leere Antwort zaehlt als Fehler -- sonst faehrt der schlimmste Fall ohne Eintrag.
$leer = avesmapsApiMetricsZeilenFuerAnfrage('/api/edit/map/paths-editor.php', 200, false, null, 9);
assert(count($leer) === 3);
assert($leer[0]['dimension'] === 'edit/map/paths-editor|leer');
assert($leer[2] === ['metric' => 'fehler', 'dimension' => 'edit/map/paths-editor|fatal', 'hour' => $KEINE]);

// 2xx und 3xx erzeugen NIE eine Fehlerzeile, auch wenn versehentlich ein Code mitkommt.
$mitCode = avesmapsApiMetricsZeilenFuerAnfrage('/api/app/coat.php', 200, true, 'server_error', 1);
assert(count($mitCode) === 2, '2xx bekommt keine Fehlerzeile');

// Die Stunde ist auf 0..23 begrenzt; alles andere waere ein Datenfehler in der Tabelle.
foreach ([0, 23] as $h) {
    $z = avesmapsApiMetricsZeilenFuerAnfrage('/api/app/coat.php', 200, true, null, $h);
    assert($z[1]['hour'] === $h);
}

// --- Der Notausschalter liest zur LAUFZEIT aus der Konfiguration ------------------------------
// 💣 KEINE Konstante beim Einbinden. Genau daran haengt der Verdacht, dass der Schalter des
// Besucher-Moduls wirkungslos ist: dort wird die Konstante definiert, BEVOR config.local.php
// geladen ist, und ein `define(..., false)` dort kaeme zu spaet.
assert(avesmapsApiMetricsAktiv([]) === true, 'ohne Eintrag: an');
assert(avesmapsApiMetricsAktiv(['api_metrics' => ['enabled' => false]]) === false);
assert(avesmapsApiMetricsAktiv(['api_metrics' => ['enabled' => true]]) === true);

echo "OK: api-metrics-schluessel-test\n";
