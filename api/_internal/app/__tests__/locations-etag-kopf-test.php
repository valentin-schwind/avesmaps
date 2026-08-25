<?php
// api/_internal/app/__tests__/locations-etag-kopf-test.php
declare(strict_types=1);

/**
 * MELDUNG #96: `GET /api/locations/` liefert beim Client keinen ETag aus.
 *
 * 💣 DER BEFUND IST NICHT „der ETag fehlt", SONDERN „er kommt nur auf der 304 an". Live gemessen am
 * 25.08.2026, mit und ohne gzip:
 *
 *   200  ->  kein `ETag`, kein `Content-Length`, `Transfer-Encoding: chunked`,
 *            `Vary: User-Agent,Accept-Encoding,X-Forwarded-For` -- die hinteren zwei setzt der Code nicht
 *   304  ->  `ETag: W/"loc-1-89628"` steht unveraendert da
 *
 * Der Riegel selbst ist also heil: `If-None-Match` erreicht das PHP, die 304 kommt korrekt, und ein
 * absichtlich falscher Tag liefert weiter 200 mit vollem Rumpf. Nur ERFAHREN konnte ein Client den
 * Tag nie -- die einzige Antwort, die ihn traegt, bekommt man erst, wenn man ihn schon hat. Ein
 * lupenreiner Fangschluss, und deshalb sah der Endpunkt in jedem Unit-Test korrekt aus.
 *
 * ⭐ Die Abhilfe ist ein ZWEITER Kopf unter eigenem Namen (`X-Avesmaps-ETag`), weil `X-`-Koepfe die
 * 200 nachweislich ueberleben -- `X-Robots-Tag` und `X-Powered-By` standen in derselben Messung da.
 * Derselbe Weg wie `X-Avesmaps-SHA256` beim SVG-Export.
 *
 * ⚠️ WAS DIESER TEST NICHT KANN: messen, was auf dem Server ankommt. Im CLI-SAPI ist `header()` ein
 * Leerlauf und `headers_list()` leer. Er wacht deshalb ueber die drei Dinge, die im Code stehen und
 * beim Umbauen einzeln verlorengehen koennen; der Beweis, dass der Kopf durchkommt, ist die Messung
 * gegen die Live-Seite (siehe api/README.md).
 *
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/locations-etag-kopf-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'.\n");
    exit(2);
}

// ⚠️ Nur LESEN, nicht einbinden: api/locations/index.php IST der Endpunkt und wuerde beim `require`
// eine Datenbankverbindung aufbauen und mit `exit` enden.
$endpunkt = (string) file_get_contents(__DIR__ . '/../../../locations/index.php');
assert($endpunkt !== '', 'api/locations/index.php ist lesbar');

// ---- 1. Der zweite Kopf wird gesendet -----------------------------------------------------------
assert(str_contains($endpunkt, "header('X-Avesmaps-ETag: ' . \$etag);"),
    'api/locations/index.php sendet X-Avesmaps-ETag');
assert(str_contains($endpunkt, "header('ETag: ' . \$etag);"),
    'und den echten ETag weiterhin -- verschwindet die Zwischenschicht je, ist er wieder der richtige Weg');

// ---- 2. Beide Koepfe kommen aus DERSELBEN Funktion ----------------------------------------------
// 🔴 200 und 304 muessen denselben Tag nennen. Stuende der zweite Kopf nur am 200er-Zweig, bekaeme
// ein Client auf der 304 einen anderen (oder gar keinen) Wert und fiele beim naechsten Mal auf die
// volle Ladung zurueck -- lautlos, denn die Antwort waere ja gueltig.
assert(substr_count($endpunkt, 'avesmapsSendLocationsCacheHeaders($etag);') === 2,
    'genau zwei Aufrufe: der 304-Zweig und der 200-Zweig, gezaehlt: '
    . substr_count($endpunkt, 'avesmapsSendLocationsCacheHeaders($etag);'));
assert(substr_count($endpunkt, "header('X-Avesmaps-ETag") === 1,
    'und der Kopf steht genau EINMAL im Code -- in der gemeinsamen Funktion');

// ---- 3. Ein fremder Browser-Client darf beide auch LESEN ----------------------------------------
// 💣 Ohne `Access-Control-Expose-Headers` gibt `response.headers.get('X-Avesmaps-ETag')` bei einem
// `fetch()` von fremder Herkunft `null` zurueck -- der Kopf ist da, aber unsichtbar. Genau die
// Clients, fuer die dieser Endpunkt existiert, saehen ihn also nicht.
$bootstrap = (string) file_get_contents(__DIR__ . '/../../bootstrap.php');
assert(preg_match('/Access-Control-Expose-Headers:[^\']*/', $bootstrap, $treffer) === 1,
    'avesmapsApplyCorsPolicy gibt Antwortkoepfe frei');
foreach (['ETag', 'X-Avesmaps-ETag'] as $kopf) {
    assert(str_contains($treffer[0], $kopf), "die Freigabe nennt '$kopf': " . $treffer[0]);
}

// ---- 4. Die Nutzlast-Version steht im Tag -------------------------------------------------------
// 💣 Sonst behaelt ein Client mit warmem Tag seine alte Kopie ueber eine 304, obwohl sich die FORM
// der Antwort geaendert hat -- der Fehler, den der Kommentar an der Konstante beschreibt.
assert(preg_match('/\$etag = \'W\/"loc-\' \. AVESMAPS_LOCATIONS_PAYLOAD_VERSION \. \'-\' \. \$revision/', $endpunkt) === 1,
    'der Tag traegt Nutzlast-Version UND Kartenrevision');

fwrite(STDOUT, "OK locations-etag-kopf-test\n");
