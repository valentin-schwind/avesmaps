<?php

declare(strict_types=1);

// Sitzt ein Zwischenserver vor Avesmaps? (Befund A29, Owner-Auftrag vom 06.08.2026.)
//
// 💣 DIE FRAGE IST EINE TATSACHENFRAGE, UND SIE ENTSCHEIDET EINE EINZEILIGE REPARATUR IN DIE EINE
// ODER DIE ANDERE RICHTUNG. Vier Drosseln im Haus buendeln nach `avesmapsClientIpAddress()`:
//   * ohne Zwischenserver ist `REMOTE_ADDR` richtig, und `X-Forwarded-For` gehoert dem Aufrufer;
//   * mit Zwischenserver ist `REMOTE_ADDR` fuer JEDEN Besucher derselbe Wert -- die Drossel wuerfe
//     nach fuenf Meldungen die ganze Seite in einen Eimer und sperrte alle aus.
// Falsch raten ist also teuer, und aus den gespeicherten Daten laesst es sich nicht mehr ablesen:
// `remote_ip` wird bewusst nicht mehr geschrieben, und ein Hash verraet keine Topologie.
//
// 🔴 WAS DIESE DATEI NIE TUT: eine Adresse zeigen oder speichern. Sie beantwortet Ja/Nein-Fragen
// ueber die EIGENE Anfrage des Aufrufers und gibt Zahlen und Wahrheitswerte zurueck -- keine
// Adressen, keine Kopfzeilen-INHALTE, nur Kopfzeilen-NAMEN aus einer festen Liste. Eine Diagnose,
// die zur Beantwortung einer Datenschutzfrage Adressen ausgibt, hat die Frage nicht verstanden.
// Bewacht von einer Zusicherung, die die ganze Antwort nach etwas durchsucht, das eine IP sein
// koennte.
//
// 🔴 UND SIE RECHNET DIE REGEL NICHT NACH. `client_key_source` entsteht, indem der ECHTE
// `avesmapsClientIpAddress()` laeuft und sein Ergebnis mit den Kandidaten verglichen wird -- nicht,
// indem seine Verzweigung hier ein zweites Mal geschrieben wird. Eine abgeschriebene Regel driftet,
// und dann beschriebe die Diagnose eine andere Funktion als die, die die Drosseln benutzen.

// Koepfe, deren blosse ANWESENHEIT von einem Zwischenserver erzaehlt. Nur Namen, nie Werte.
// ⚠️ `X-Forwarded-For` steht bewusst NICHT hier: den kann der Aufrufer selbst setzen, er wird
// getrennt gezaehlt und getrennt gelesen.
const AVESMAPS_PROXY_EVIDENCE_HEADERS = [
    'HTTP_VIA' => 'Via',
    'HTTP_X_REAL_IP' => 'X-Real-IP',
    'HTTP_FORWARDED' => 'Forwarded',
    'HTTP_X_FORWARDED_PROTO' => 'X-Forwarded-Proto',
    'HTTP_X_FORWARDED_HOST' => 'X-Forwarded-Host',
    'HTTP_X_FORWARDED_PORT' => 'X-Forwarded-Port',
    'HTTP_CF_CONNECTING_IP' => 'CF-Connecting-IP',
    'HTTP_TRUE_CLIENT_IP' => 'True-Client-IP',
    'HTTP_X_CLUSTER_CLIENT_IP' => 'X-Cluster-Client-IP',
];

/**
 * Alles, was sich ueber die eigene Anfrage sagen laesst, ohne eine Adresse zu nennen.
 */
function avesmapsProxySignals(): array {
    $forwardedRaw = trim((string) ($_SERVER['HTTP_X_FORWARDED_FOR'] ?? ''));
    $remoteAddress = trim((string) ($_SERVER['REMOTE_ADDR'] ?? ''));

    $entries = [];
    if ($forwardedRaw !== '') {
        foreach (explode(',', $forwardedRaw) as $candidate) {
            $entries[] = trim($candidate);
        }
    }

    $validEntries = array_values(array_filter(
        $entries,
        static fn(string $entry): bool => filter_var($entry, FILTER_VALIDATE_IP) !== false
    ));

    $evidence = [];
    foreach (AVESMAPS_PROXY_EVIDENCE_HEADERS as $serverKey => $headerName) {
        if (trim((string) ($_SERVER[$serverKey] ?? '')) !== '') {
            $evidence[] = $headerName;
        }
    }

    // 🔴 Der echte Schluesselbildner, nicht seine Nachbildung -- und genau deshalb hat sich diese
    // Zeile am 06.08.2026 von selbst mitgeaendert: seit der Kopf nicht mehr gelesen wird, antwortet
    // sie `remote_addr`, wo sie vorher `forwarded` gesagt haette. Eine nachgebaute Verzweigung haette
    // hier weiter das Alte behauptet, und die Diagnose beschriebe eine Funktion, die es nicht gibt.
    $clientKey = avesmapsClientIpAddress();
    $keySource = 'none';
    if ($clientKey !== '') {
        // ⚠️ `forwarded` ist seit dem 06.08.2026 nicht mehr erreichbar -- ausser der weitergereichte
        // Wert IST zufaellig das Gegenueber. Der Zweig bleibt stehen, weil er nichts behauptet,
        // sondern vergleicht: kaeme der Kopf je wieder zu Ehren (Liste vertrauenswuerdiger
        // Adressen), sagt diese Zeile es ohne Zutun.
        $keySource = in_array($clientKey, $validEntries, true) ? 'forwarded' : 'remote_addr';
    }

    return [
        // Kam der Weiterreich-Kopf ueberhaupt an? Das ist die eigentliche Frage.
        'forwarded_header_present' => $forwardedRaw !== '',
        // Wie viele Stationen -- als ZAHL. 0 = keiner, 1 = einer, mehr = eine Kette.
        'forwarded_entry_count' => count($entries),
        'forwarded_entries_all_valid_ips' => $entries !== [] && count($validEntries) === count($entries),
        'remote_addr_present' => $remoteAddress !== '',
        'remote_addr_is_valid_ip' => filter_var($remoteAddress, FILTER_VALIDATE_IP) !== false,
        // ⚠️ Ein Vergleich, kein Wert. Bei einem Zwischenserver, der korrekt weiterreicht, sind die
        // beiden verschieden -- REMOTE_ADDR ist dann er selbst.
        'remote_addr_differs_from_forwarded' => $remoteAddress !== '' && $validEntries !== [] && $remoteAddress !== $validEntries[0],
        // Welchen Zweig nimmt die Drossel FUER DIESE ANFRAGE? Aus dem echten Aufruf abgeleitet.
        'client_key_source' => $keySource,
        // Nur Namen. Ein `Via` oder `X-Real-IP`, das der Aufrufer nicht selbst gesetzt hat, ist der
        // deutlichste Hinweis, den es ohne Auskunft des Hosters gibt.
        'proxy_evidence_headers' => $evidence,
        // 💣 Die Einschraenkung reist MIT der Antwort, nicht nur in der Doku: wer diesen Endpunkt
        // mit einem selbst gesetzten X-Forwarded-For aufruft, misst sich selbst.
        'caveat' => 'Nur aussagekraeftig, wenn die Anfrage OHNE eigenen X-Forwarded-For-Kopf gestellt wurde.',
    ];
}
