<?php

declare(strict_types=1);

// Linkchecker: the HTTP probe + the SSRF guard (Spec §1.4). The cURL setup follows the hardest existing
// example in this repo, api/_internal/wiki/dump-fetch.php:424.
//
// The two predicates below are PURE (no DNS, no socket) and unit-tested in __tests__/link-url-test.php;
// requiring this file only defines functions. avesmapsLinkCheckProbe() is the one function that talks to
// the network -- nothing here touches the database.

const AVESMAPS_LINK_PROBE_TIMEOUT_SECONDS = 15;
const AVESMAPS_LINK_PROBE_CONNECT_TIMEOUT_SECONDS = 8;
const AVESMAPS_LINK_PROBE_MAX_REDIRECTS = 5;
const AVESMAPS_LINK_PROBE_USER_AGENT = 'AvesmapsLinkBot/1.0 (+https://avesmaps.de)';

// Politeness: at least this much between two requests to the SAME host (plus jitter). Per host, not
// global -- probing f-shop.de must not be slowed down by the wiki request that came before it.
const AVESMAPS_LINK_PROBE_HOST_DELAY_MICROSECONDS = 600000;
const AVESMAPS_LINK_PROBE_HOST_JITTER_MICROSECONDS = 250000;

// Many shops dislike HEAD and answer 405/501 -- and some misconfigured ones answer 400. Those are not a
// statement about the link, so retry them once with a ranged GET before judging.
const AVESMAPS_LINK_PROBE_GET_FALLBACK_CODES = [400, 405, 501];

// PURE. Is this string a URL we are willing to fetch at all? http/https only: file://, gopher:// and
// dict:// are the classic SSRF/LFI vectors, and a scheme-less string is a typo, not a link.
function avesmapsLinkCheckIsProbeableUrl(string $url): bool
{
    $url = trim($url);
    if ($url === '') {
        return false;
    }
    $parts = parse_url($url);
    if (!is_array($parts)) {
        return false;
    }
    $scheme = strtolower(trim((string) ($parts['scheme'] ?? '')));
    if ($scheme !== 'http' && $scheme !== 'https') {
        return false;
    }
    return trim((string) ($parts['host'] ?? '')) !== '';
}

// PURE. Is this IP in a range we must never reach? Blocks on ANY doubt -- an unparseable address is
// blocked, never waved through.
//
// PHP's own range filters already cover loopback, RFC1918, link-local, IPv6 ULA, unspecified and the
// reserved ranges; re-implementing those by hand would only add bugs. They do NOT cover CGNAT
// (100.64.0.0/10, RFC6598), so that range gets an explicit check.
function avesmapsLinkCheckIsBlockedIp(string $ip): bool
{
    $ip = trim($ip);
    if ($ip === '' || filter_var($ip, FILTER_VALIDATE_IP) === false) {
        return true;
    }
    // NO_PRIV_RANGE: 10/8, 172.16/12, 192.168/16, fc00::/7.
    // NO_RES_RANGE:  0/8, 127/8, 169.254/16 (cloud metadata!), 240/4, ::, ::1, ::ffff:0:0/96, fe80::/10.
    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) {
        return true;
    }
    // CGNAT 100.64.0.0/10 -> second octet 64..127. Compared octet-wise on purpose: ip2long() is signed
    // and the masking arithmetic is where this kind of check usually goes wrong.
    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false) {
        $octets = explode('.', $ip);
        if ((int) $octets[0] === 100 && (int) $octets[1] >= 64 && (int) $octets[1] <= 127) {
            return true;
        }
    }
    return false;
}

// Classify a host into exactly one of three outcomes -- 'public' | 'blocked' | 'unresolvable'.
//
// The middle and the last are NOT the same thing, and conflating them is a real bug:
//   blocked      = we REFUSE to ask (private/loopback/metadata space, garbage). That is a statement
//                  about us, and says nothing about whether the link works -> no verdict.
//   unresolvable = the domain does not exist any more. That is the DNS row of the §1.3 state table,
//                  i.e. genuine evidence the link is failing -> it must feed the fail streak. A
//                  vanished domain is the most common way a shop link dies; reporting it as "blocked"
//                  would keep such a link green forever.
//
// Resolution requires ALL addresses to be public -- all, not any: a host resolving to both a public and
// a private address must not slip through on the public one. A bare IP literal is checked without DNS.
function avesmapsLinkCheckClassifyHost(string $host): string
{
    $host = trim($host, " \t\n\r\0\x0B[]"); // strip IPv6 literal brackets
    if ($host === '') {
        return 'blocked';
    }
    if (filter_var($host, FILTER_VALIDATE_IP) !== false) {
        return avesmapsLinkCheckIsBlockedIp($host) ? 'blocked' : 'public';
    }

    $ips = [];
    $v4 = @gethostbynamel($host);
    if (is_array($v4)) {
        $ips = $v4;
    }
    $records = @dns_get_record($host, DNS_AAAA);
    if (is_array($records)) {
        foreach ($records as $record) {
            if (!empty($record['ipv6'])) {
                $ips[] = (string) $record['ipv6'];
            }
        }
    }
    if ($ips === []) {
        return 'unresolvable';
    }
    foreach ($ips as $ip) {
        if (avesmapsLinkCheckIsBlockedIp((string) $ip)) {
            return 'blocked';
        }
    }
    return 'public';
}

// Sleep just long enough that this host has not been hit within the last ~600ms. Static per process, so
// it bounds one check_step / one CLI run. Mirrors avesmapsWikiSyncThrottleWikiRequest (wiki/sync.php:212),
// but keyed by host instead of global.
function avesmapsLinkCheckThrottleHost(string $host): void
{
    static $lastRequestAt = [];
    $key = strtolower($host);
    if (isset($lastRequestAt[$key])) {
        $elapsedMicroseconds = (int) ((microtime(true) - $lastRequestAt[$key]) * 1000000);
        $wait = AVESMAPS_LINK_PROBE_HOST_DELAY_MICROSECONDS - $elapsedMicroseconds;
        if ($wait > 0) {
            usleep($wait + random_int(0, AVESMAPS_LINK_PROBE_HOST_JITTER_MICROSECONDS));
        }
    }
    $lastRequestAt[$key] = microtime(true);
}

// One HTTP request. $useHead=false sends a ranged GET (Range: bytes=0-0) so a server that dislikes HEAD
// still answers without shipping us a whole page body.
function avesmapsLinkCheckRequest(string $url, bool $useHead): array
{
    $ch = curl_init();
    $options = [
        CURLOPT_URL => $url,
        CURLOPT_RETURNTRANSFER => true,
        // SSL verification ON (a link that only "works" with a broken cert is not working).
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        // Bounded redirects, and no scheme downgrade into file:// / gopher:// on the redirect chain.
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => AVESMAPS_LINK_PROBE_MAX_REDIRECTS,
        CURLOPT_CONNECTTIMEOUT => AVESMAPS_LINK_PROBE_CONNECT_TIMEOUT_SECONDS,
        CURLOPT_TIMEOUT => AVESMAPS_LINK_PROBE_TIMEOUT_SECONDS,
        CURLOPT_USERAGENT => AVESMAPS_LINK_PROBE_USER_AGENT,
        CURLOPT_FAILONERROR => false, // we inspect the status code ourselves (state.php decides)
        CURLOPT_ACCEPT_ENCODING => '',
    ];
    // CURLOPT_PROTOCOLS is deprecated from PHP 8.4 on; prefer the string form where it exists so this
    // stays warning-free on new PHP while still working on STRATO's older build.
    if (defined('CURLOPT_PROTOCOLS_STR')) {
        $options[CURLOPT_PROTOCOLS_STR] = 'http,https';
        $options[CURLOPT_REDIR_PROTOCOLS_STR] = 'http,https';
    } else {
        $options[CURLOPT_PROTOCOLS] = CURLPROTO_HTTP | CURLPROTO_HTTPS;
        $options[CURLOPT_REDIR_PROTOCOLS] = CURLPROTO_HTTP | CURLPROTO_HTTPS;
    }
    if ($useHead) {
        $options[CURLOPT_NOBODY] = true;
    } else {
        $options[CURLOPT_HTTPGET] = true;
        $options[CURLOPT_HTTPHEADER] = ['Range: bytes=0-0'];
    }
    curl_setopt_array($ch, $options);

    curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $effectiveUrl = (string) curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
    $primaryIp = (string) curl_getinfo($ch, CURLINFO_PRIMARY_IP);
    curl_close($ch);

    // Post-flight guard. The pre-flight check cannot see redirect hops (this PHP build has no
    // CURLOPT_OPENSOCKETFUNCTION), so a public host could bounce us into private space. PRIMARY_IP is
    // the peer of the LAST connection: if that landed somewhere private, discard the result entirely
    // rather than caching a status we obtained from the inside of the network.
    if ($primaryIp !== '' && avesmapsLinkCheckIsBlockedIp($primaryIp)) {
        return ['http_status' => 0, 'redirect_url' => '', 'blocked' => true];
    }

    return [
        'http_status' => $status,
        'redirect_url' => ($effectiveUrl !== '' && $effectiveUrl !== $url) ? $effectiveUrl : '',
        'blocked' => false,
    ];
}

// Probe one URL. Returns ['http_status' => int, 'redirect_url' => string, 'blocked' => bool].
// http_status 0 means no HTTP answer at all (timeout, DNS, TLS) -- state.php reads that as an
// inconclusive failure, never as death. blocked=true means we refused to ask (bad scheme / private
// address); the caller must not treat that as evidence about the link.
function avesmapsLinkCheckProbe(string $url): array
{
    $url = trim($url);
    if (!avesmapsLinkCheckIsProbeableUrl($url) || !function_exists('curl_init')) {
        return ['http_status' => 0, 'redirect_url' => '', 'blocked' => true];
    }

    $host = (string) (parse_url($url, PHP_URL_HOST) ?: '');
    $classification = avesmapsLinkCheckClassifyHost($host);
    if ($classification === 'blocked') {
        return ['http_status' => 0, 'redirect_url' => '', 'blocked' => true];
    }
    if ($classification === 'unresolvable') {
        // The domain is gone. Report it as an ordinary inconclusive failure (blocked=false,
        // http_status=0) -- exactly what the DNS row of §1.3 calls for -- so it feeds the fail streak
        // and the link eventually goes dead. Marking it "blocked" here would mean no verdict ever.
        return ['http_status' => 0, 'redirect_url' => '', 'blocked' => false];
    }

    avesmapsLinkCheckThrottleHost($host);
    $result = avesmapsLinkCheckRequest($url, true);

    if (!$result['blocked'] && in_array($result['http_status'], AVESMAPS_LINK_PROBE_GET_FALLBACK_CODES, true)) {
        avesmapsLinkCheckThrottleHost($host);
        $result = avesmapsLinkCheckRequest($url, false);
    }
    return $result;
}
