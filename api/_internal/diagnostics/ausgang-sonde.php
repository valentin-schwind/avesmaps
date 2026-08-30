<?php

declare(strict_types=1);

// Kommt DIESER Server nach draussen -- und wenn nicht, in welcher Phase bleibt er stecken?
// (Vorfall vom 30.08.2026: Mastodon nahm keinen Beitrag mehr an.)
//
// 💣 DIE FRAGE, DIE DER ADAPTER NICHT BEANTWORTEN KANN. `social_post_target.error` sagt
// „Connection timed out after 8006 milliseconds" und ist damit am Ende seines Lateins: cURL nennt
// denselben Satz, ob die NAMENSAUFLOESUNG haengt, die TCP-Verbindung oder der TLS-Handschlag. Das
// sind drei verschiedene Ursachen mit drei verschiedenen Reparaturen -- eine falsche DNS-Antwort
// auf dem Server sieht von aussen exakt aus wie eine Firewall-Sperre auf der Gegenseite. Diese
// Datei liest die Phase aus den cURL-Zeitmarken und nennt die ANGESTEUERTE Adresse dazu.
//
// 🔴 KEINE FREIE ADRESSE AUS DER ANFRAGE. Die Ziele stehen als feste Liste unten. Ein Endpunkt,
// der eine mitgeschickte URL abruft, ist ein offener Weiterleiter: er holt fuer jeden Aufrufer
// alles, was VON HIER aus erreichbar ist -- auch das Verwaltungsnetz des Hosters und jeden Dienst,
// der nur auf localhost hoert. Der Erkenntnisgewinn einer freien Adresse waere ein einziger
// Diagnosefall, der Preis ein dauerhaftes Loch.
//
// 🔴 ES WIRD NICHTS GESPEICHERT und nichts protokolliert -- wie beim Nachbarn proxy-signals.php.
// Die Antwort beschreibt einen Augenblick, nicht einen Verlauf.

require_once __DIR__ . '/../bootstrap.php';

// Wie lange eine einzelne Sonde hoechstens haelt. 💣 KURZ, WEIL JEDE SEKUNDE EIN PHP-ARBEITER IST
// (AGENTS.md §10, der Pool-Haenger vom 17.07.2026): drei Ziele in Folge sind im schlimmsten Fall
// die Summe dieser Werte, und der Aufrufer wartet sie ab.
// ⚠️ Der Verbindungsdeckel ist mit ABSICHT derselbe wie im Mastodon-Adapter (8 s). Ein grosszuegiger
// Wert hier liesse eine Verbindung gelingen, an der der echte Absendeweg scheitert -- die Sonde soll
// seine Lage messen, nicht ihre eigene.
const AVESMAPS_AUSGANG_CONNECT_TIMEOUT = 8;
const AVESMAPS_AUSGANG_TOTAL_TIMEOUT = 12;

/**
 * Die Ziele. Fest, benannt, und jedes mit einem Grund.
 *
 * ⚠️ `ausgangs_ip` fragt einen FREMDEN Dienst nach unserer eigenen Adresse -- das ist der einzige
 * Weg, sie von hier aus zu erfahren, denn der Server sieht immer nur seine INNERE Adresse. Es geht
 * dabei nichts von uns hinaus ausser der Anfrage selbst.
 *
 * @return array<string, array{url: string, zweck: string}>
 */
function avesmapsAusgangZiele(): array
{
    return [
        'ausgangs_ip' => [
            'url' => 'https://api.ipify.org',
            'zweck' => 'Mit welcher Adresse tritt dieser Server nach aussen auf?',
        ],
        'mastodon' => [
            'url' => 'https://rollenspiel.social/api/v1/instance',
            'zweck' => 'Das Ziel, das seit dem 30.08.2026 nicht mehr antwortet.',
        ],
        'kontrolle' => [
            'url' => 'https://graph.facebook.com/',
            'zweck' => 'Ein Ziel, das nachweislich geht -- trennt „unser Ausgang ist tot" von'
                . ' „genau dieses eine Ziel ist zu".',
        ],
    ];
}

/**
 * In welcher Phase blieb der Abruf stecken?
 *
 * 💣 GELESEN WIRD DIE ERSTE NULL, NICHT DIE LETZTE ZAHL. cURL fuellt seine Zeitmarken der Reihe
 * nach; was nach dem Abbruch kommt, bleibt auf 0.0 stehen. Wer stattdessen die groesste Zahl sucht,
 * liest bei einem Verbindungsabbruch die DNS-Zeit und meldet „bei der Namensaufloesung war alles
 * gut" -- richtig, aber keine Antwort auf die Frage.
 *
 * ⚠️ `tls` kann es nur bei https geben. Bei http bleibt `appconnect_time` immer 0, und ohne diese
 * Unterscheidung meldete jede einfache http-Verbindung einen TLS-Fehler, den es nicht gibt.
 *
 * @param array<string, mixed> $info Das Ergebnis von curl_getinfo().
 */
function avesmapsAusgangPhase(array $info, int $errno, bool $istHttps): string
{
    if ($errno === 0) {
        return 'antwort';
    }
    if ((float) ($info['namelookup_time'] ?? 0.0) <= 0.0) {
        return 'dns';
    }
    if ((float) ($info['connect_time'] ?? 0.0) <= 0.0) {
        return 'tcp';
    }
    if ($istHttps && (float) ($info['appconnect_time'] ?? 0.0) <= 0.0) {
        return 'tls';
    }
    if ((float) ($info['starttransfer_time'] ?? 0.0) <= 0.0) {
        return 'warten_auf_antwort';
    }

    return 'uebertragung';
}

/**
 * Was die Phase im Klartext bedeutet -- fuer den Menschen, der die Antwort liest.
 */
function avesmapsAusgangPhaseText(string $phase): string
{
    return match ($phase) {
        'antwort' => 'Antwort erhalten.',
        'dns' => 'Der Name liess sich nicht aufloesen. Das ist ein DNS-Problem auf DIESEM Server,'
            . ' nicht auf der Gegenseite.',
        'tcp' => 'Die Verbindung kam nicht zustande. Die Gegenseite verwirft unsere Pakete still'
            . ' (Firewall) oder ist nicht da -- ein „Connection refused" saehe anders aus.',
        'tls' => 'Die Verbindung stand, der TLS-Handschlag scheiterte. Die Gegenseite nimmt uns'
            . ' also auf Paketebene an und weist uns erst danach ab.',
        'warten_auf_antwort' => 'Verbindung und TLS standen, es kam nur keine Antwort mehr.',
        default => 'Die Antwort brach mitten in der Uebertragung ab.',
    };
}

/**
 * Eine IP aus der Antwort eines Echo-Dienstes -- oder ''.
 *
 * 💣 GEPRUEFT, NIE DURCHGEREICHT. Hier landet der Rumpf eines FREMDEN Dienstes in unserer eigenen
 * Diagnoseantwort. Ohne diese Pruefung stuende dort, was immer dieser Dienst geschickt hat -- eine
 * Fehlerseite, eine Werbezeile, beliebiger Text. Was keine Adresse ist, ist keine Auskunft.
 */
function avesmapsAusgangIpAusText(string $rumpf): string
{
    $kandidat = trim($rumpf);
    if ($kandidat === '' || strlen($kandidat) > 64) {
        return '';
    }

    return filter_var($kandidat, FILTER_VALIDATE_IP) === false ? '' : $kandidat;
}

/**
 * Eine einzelne Sonde. Gibt IMMER einen Befund zurueck -- ein Fehlschlag ist hier ein Ergebnis,
 * keine Ausnahme.
 *
 * @return array<string, mixed>
 */
function avesmapsAusgangSonde(string $url, string $zweck): array
{
    $befund = [
        'url' => $url,
        'zweck' => $zweck,
        'ok' => false,
        'phase' => 'dns',
        'phase_text' => avesmapsAusgangPhaseText('dns'),
        'http_status' => 0,
        'fehler_code' => 0,
        'fehler' => '',
        // 💣 DIE ANGESTEUERTE ADRESSE IST EIN EIGENER BEFUND. Weicht sie von dem ab, was die Welt
        // aufloest, liegt die Ursache bei uns -- nicht bei der Gegenseite.
        'ziel_ip' => '',
        'dns_ms' => 0,
        'tcp_ms' => 0,
        'tls_ms' => 0,
        'gesamt_ms' => 0,
    ];

    if (!function_exists('curl_init')) {
        $befund['fehler'] = 'cURL steht auf diesem Server nicht zur Verfuegung.';

        return $befund;
    }

    $handle = curl_init($url);
    if ($handle === false) {
        $befund['fehler'] = 'Die Adresse liess sich nicht oeffnen.';

        return $befund;
    }

    curl_setopt_array($handle, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => AVESMAPS_AUSGANG_TOTAL_TIMEOUT,
        CURLOPT_CONNECTTIMEOUT => AVESMAPS_AUSGANG_CONNECT_TIMEOUT,
        // ⚠️ Keine Weiterleitungen: gemessen wird die Verbindung zu DIESER Adresse, nicht die zu
        // irgendeiner, auf die sie zeigt.
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
        // Derselbe Absender wie im echten Absendeweg. Wer mit einem anderen Namen anklopft, misst
        // eine andere Anfrage als die, die scheitert.
        CURLOPT_HTTPHEADER => ['User-Agent: Avesmaps (https://avesmaps.de)'],
    ]);

    $rumpf = curl_exec($handle);
    $errno = curl_errno($handle);
    $fehler = (string) curl_error($handle);
    $info = curl_getinfo($handle);
    curl_close($handle);

    $istHttps = str_starts_with(strtolower($url), 'https://');
    $phase = avesmapsAusgangPhase(is_array($info) ? $info : [], $errno, $istHttps);

    $befund['ok'] = $errno === 0;
    $befund['phase'] = $phase;
    $befund['phase_text'] = avesmapsAusgangPhaseText($phase);
    $befund['http_status'] = (int) ($info['http_code'] ?? 0);
    $befund['fehler_code'] = $errno;
    $befund['fehler'] = $fehler;
    $befund['ziel_ip'] = (string) ($info['primary_ip'] ?? '');
    $befund['dns_ms'] = (int) round(((float) ($info['namelookup_time'] ?? 0.0)) * 1000);
    $befund['tcp_ms'] = (int) round(((float) ($info['connect_time'] ?? 0.0)) * 1000);
    $befund['tls_ms'] = (int) round(((float) ($info['appconnect_time'] ?? 0.0)) * 1000);
    $befund['gesamt_ms'] = (int) round(((float) ($info['total_time'] ?? 0.0)) * 1000);

    if ($errno === 0 && is_string($rumpf)) {
        $ip = avesmapsAusgangIpAusText($rumpf);
        if ($ip !== '') {
            $befund['gemeldete_ausgangs_ip'] = $ip;
        }
    }

    return $befund;
}

/**
 * Alle Ziele der Reihe nach.
 *
 * @return array<string, mixed>
 */
function avesmapsAusgangBefund(): array
{
    $ziele = [];
    foreach (avesmapsAusgangZiele() as $name => $ziel) {
        $ziele[$name] = avesmapsAusgangSonde($ziel['url'], $ziel['zweck']);
    }

    return ['ziele' => $ziele];
}
