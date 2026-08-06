<?php

declare(strict_types=1);

/**
 * Finding A29: the key every throttle in the house buckets by came straight out of a request header,
 * unchecked. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/__tests__/client-ip-test.php
 * Exit 0 = all asserts passed.
 *
 * avesmapsClientIpAddress reads only $_SERVER, so this is a real behavioural test rather than an
 * assertion about source text -- the whole function can be exercised by setting two keys.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../bootstrap.php';

$ipFor = static function (?string $forwardedFor, ?string $remoteAddress): string {
    unset($_SERVER['HTTP_X_FORWARDED_FOR'], $_SERVER['REMOTE_ADDR']);
    if ($forwardedFor !== null) {
        $_SERVER['HTTP_X_FORWARDED_FOR'] = $forwardedFor;
    }
    if ($remoteAddress !== null) {
        $_SERVER['REMOTE_ADDR'] = $remoteAddress;
    }

    return avesmapsClientIpAddress();
};

// --- The ordinary cases ---------------------------------------------------------------------------
assert($ipFor(null, '203.0.113.7') === '203.0.113.7', 'no header: the peer address is the key');
assert($ipFor(null, '2001:db8::1') === '2001:db8::1', 'IPv6 counts as an address');

// --- 💣 DER KOPF WIRD NICHT MEHR GELESEN (A29, zweite Haelfte, 06.08.2026) -------------------------
//
// Ohne Zwischenserver gehoert X-Forwarded-For dem AUFRUFER. Jeder Wert war ein frischer
// Drossel-Eimer; die Pruefung auf eine gueltige IP (864fe864) nahm dem nur die Bequemlichkeit --
// eine syntaktisch richtige, FREMDE Adresse wurde weiterhin geglaubt.
//
// 📊 Gemessen, nicht angenommen: api/edit/admin/proxy-check.php meldete am 06.08.2026
// `forwarded_header_present: false` und `proxy_evidence_headers: []`. Es kommt kein Kopf an.
assert($ipFor('198.51.100.9', '203.0.113.7') === '203.0.113.7', 'ein weitergereichter Wert wird ignoriert');
assert($ipFor('  198.51.100.9  ', '203.0.113.7') === '203.0.113.7', 'auch sauber formatiert');
assert($ipFor('198.51.100.9, 203.0.113.7', '10.0.0.1') === '10.0.0.1', 'und eine ganze Kette ebenso');
assert($ipFor('not-an-ip', '203.0.113.7') === '203.0.113.7', 'Muell erst recht');
assert($ipFor('<script>alert(1)</script>', '203.0.113.7') === '203.0.113.7', 'and so does markup');
assert($ipFor(str_repeat('a', 64), '203.0.113.7') === '203.0.113.7', 'and a 64-character filler');

// 💣 DIE EIGENSCHAFT, DIE DEN AUSWEG SCHLIESST: der Kopf darf den Eimer NICHT beeinflussen. Egal
// was drinsteht -- derselbe Nachbar, derselbe Eimer. Vorher kaufte jeder neue Wert einen neuen.
$eimer = [
    $ipFor(null, '203.0.113.7'),
    $ipFor('198.51.100.9', '203.0.113.7'),
    $ipFor('203.0.113.99', '203.0.113.7'),
    $ipFor('junk-one', '203.0.113.7'),
    $ipFor('junk-two', '203.0.113.7'),
    $ipFor('1.1.1.1, 2.2.2.2, 3.3.3.3', '203.0.113.7'),
];
assert(count(array_unique($eimer)) === 1, 'kein Kopfwert kauft einen zweiten Eimer -- alle sechs sind derselbe');
assert($eimer[0] === '203.0.113.7', 'und es ist der des echten Gegenuebers');

// 💣 UND DIE GEGENRICHTUNG, die genauso schlimm war: wer die Adresse eines FREMDEN schickte, sperrte
// diesen aus. Zwei verschiedene Gegenueber duerfen sich nicht ueber den Kopf denselben Eimer teilen.
assert(
    $ipFor('198.51.100.9', '203.0.113.7') !== $ipFor('198.51.100.9', '203.0.113.8'),
    'derselbe gefaelschte Kopf sperrt keinen Fremden mehr aus'
);

// --- The privacy half -----------------------------------------------------------------------------
//
// ⚠️ ip_hash is hash_hmac over this return value. While it could be arbitrary text, the column was
// not the hash of an address at all -- which is not what a schema reader looking for a privacy answer
// would conclude from its name.
assert(filter_var($ipFor('198.51.100.9', '203.0.113.7'), FILTER_VALIDATE_IP) !== false, 'what gets hashed is an address');
assert(filter_var($ipFor(null, '203.0.113.7'), FILTER_VALIDATE_IP) !== false, 'on the fallback path too');

// --- The unknown case is grouped, not scattered ---------------------------------------------------
//
// ⚠️ Empty is deliberate and is the SAFE direction: everyone whose address cannot be established
// shares one bucket. Returning the junk instead would hand each of them a private one.
assert($ipFor(null, 'not-an-ip') === '', 'an unusable peer address yields no key rather than a junk key');
assert($ipFor(null, null) === '', 'and a missing one likewise');
assert($ipFor('junk', 'also-junk') === '', 'junk on both sides collapses to the same empty bucket');

// --- ✅ DIE LUECKE IST ZU, und dieser Marker war genau dafuer gedacht ------------------------------
//
// 💣 Hier stand: „a forged but well-formed address is still trusted -- the open half of A29", mit
// dem Vermerk, die Zusicherung sei zum UMDREHEN gedacht, nicht zum Loeschen. Sie ist umgedreht.
//
// Die Entscheidung, die dahinter fehlte: darf X-Forwarded-For ueberhaupt geglaubt werden? Das hing
// daran, ob ein Zwischenserver davorsteht -- mit einem waere REMOTE_ADDR fuer jeden Besucher
// derselbe Wert, und die Umstellung darauf haette die ganze Seite in EINEN Eimer geworfen. Beantwortet
// am 06.08.2026 durch api/edit/admin/proxy-check.php: kein Kopf, kein Beweis-Kopf, kein
// Zwischenserver.
assert(
    $ipFor('198.51.100.9', '203.0.113.7') === '203.0.113.7',
    'eine gefaelschte, aber wohlgeformte Adresse wird NICHT mehr geglaubt -- A29 ist zu'
);

// 🔴 UND DER WEG ZURUECK, falls je ein Zwischenserver davorkommt, ist NICHT „den Kopf wieder
// pauschal glauben", sondern eine Liste der Adressen, denen man ihn glaubt. Diese Zusicherung haelt
// fest, dass niemand den alten Zweig einfach wieder einbaut: taucht `HTTP_X_FORWARDED_FOR` in
// bootstrap.php wieder auf, soll das eine bewusste Entscheidung sein und keine Ruecknahme aus
// Versehen.
$bootstrapSource = file_get_contents(__DIR__ . '/../bootstrap.php');
assert(is_string($bootstrapSource) && $bootstrapSource !== '', 'bootstrap.php ist lesbar');
$funktion = null;
if (preg_match('/function avesmapsClientIpAddress\(\): string \{(.*?)\n\}/s', $bootstrapSource, $treffer) === 1) {
    $funktion = $treffer[1];
}
assert(is_string($funktion), 'der Schluesselbildner laesst sich isolieren');
assert(
    !preg_match('/^\s*[^\/\n].*HTTP_X_FORWARDED_FOR/m', $funktion),
    'der Schluesselbildner LIEST den Kopf nicht mehr -- nur die Kommentare erwaehnen ihn'
);

echo "client-ip ok\n";
