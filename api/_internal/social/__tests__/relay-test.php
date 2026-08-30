<?php

declare(strict_types=1);

/**
 * Das Mastodon-Relais (Entwurf docs/superpowers/specs/2026-08-30-mastodon-relais-design.md).
 *
 * 🔴 Wie beim Nachbarn publish-test.php braucht der eigentliche Ablauf eine Datenbank und wird live
 * geprueft. Was HIER festgenagelt wird, sind die Entscheidungen, die ohne DB feststehen -- und die
 * drei, an denen dieses Vorhaben scheitern koennte:
 *   1. die Weiche steht NACH den Pruefungen (sonst wandert ein zu langer Beitrag in die
 *      Warteschlange und scheitert erst eine halbe Stunde spaeter),
 *   2. der Riegel faellt im Zweifel ZU,
 *   3. der Not-Aus gilt auch fuer den Umweg.
 *
 * Ausfuehren:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       api/_internal/social/__tests__/relay-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op.\n");
    exit(2);
}

require __DIR__ . '/../../bootstrap.php';
require __DIR__ . '/../relay.php';

$ohneKommentare = static function (string $pfad): string {
    // ⚠️ Kommentare RAUS, bevor irgendetwas gesucht wird. Sonst schlaegt eine Zusicherung an der
    // Warnung an, die vor genau diesem Muster warnt -- und der naechste Leser loescht den
    // Kommentar statt des Fehlers.
    return (string) preg_replace('~/\*.*?\*/|//[^\n]*~s', '', (string) file_get_contents($pfad));
};

// ------------------------------------------------------------------------------------------------
// 1. Das Register. Mastodon geht ueber das Relais, die anderen NICHT.
// ------------------------------------------------------------------------------------------------
$relaisKanaele = avesmapsSocialRelayChannelKeys();
assert(in_array('mastodon', $relaisKanaele, true), 'Mastodon geht ueber das Relais');

// 🔴 Die eigentliche Zusicherung ist die AUSSCHLIESSUNG. Ein zweiter Kanal, der versehentlich
// `relay` bekommt, hoerte lautlos auf, direkt zu senden -- seine Beitraege lägen in einer
// Warteschlange, die der Workflow gar nicht abholt (er kennt nur Mastodon).
foreach (['facebook', 'instagram', 'changelog', 'probe'] as $direkt) {
    assert(
        !in_array($direkt, $relaisKanaele, true),
        "{$direkt} sendet direkt vom Server und darf kein relay tragen"
    );
}

// ------------------------------------------------------------------------------------------------
// 2. Der Riegel. 💣 Im Zweifel ZU -- `hash_equals('', '')` ist wahr, ein unkonfigurierter Server
//    liesse sonst jeden herein.
// ------------------------------------------------------------------------------------------------
assert(avesmapsSocialRelayTokenOk(['relay_token' => 'geheim'], 'geheim'), 'der richtige Schluessel oeffnet');
assert(!avesmapsSocialRelayTokenOk(['relay_token' => 'geheim'], 'falsch'), 'ein falscher Schluessel nicht');
assert(!avesmapsSocialRelayTokenOk(['relay_token' => ''], ''), 'ohne konfigurierten Schluessel bleibt zu');
assert(!avesmapsSocialRelayTokenOk([], ''), 'ohne Eintrag ueberhaupt bleibt zu');
assert(!avesmapsSocialRelayTokenOk(['relay_token' => 'geheim'], ''), 'ohne mitgeschickten Schluessel bleibt zu');

// 🔴 Und es ist ein EIGENER Schluessel. Wer hier `app_token` liest, verschmilzt die Rechte der
// Routine mit denen des Relais -- dann kann man eines nicht mehr allein widerrufen.
$relayQuelle = $ohneKommentare(__DIR__ . '/../relay.php');
assert(str_contains($relayQuelle, "relay_token"), 'der Riegel liest social.relay_token');
foreach (['app_token', 'discord'] as $fremd) {
    assert(!str_contains($relayQuelle, $fremd), "das Relais fasst {$fremd} nicht an");
}

// ------------------------------------------------------------------------------------------------
// 3. 💣 DIE WEICHE STEHT NACH DEN PRUEFUNGEN. Das ist die teuerste Zusicherung dieser Datei:
//    stuende sie davor, wanderte ein zu langer Beitrag in die Warteschlange und scheiterte erst
//    eine halbe Stunde spaeter an etwas, das im Augenblick des Klicks schon feststand -- und die
//    Rueckmeldung erreichte ihren Verfasser nie.
// ------------------------------------------------------------------------------------------------
$publishQuelle = $ohneKommentare(__DIR__ . '/../publish.php');
$weicheBei = strpos($publishQuelle, "\$channel['relay']");
$limitBei = strpos($publishQuelle, 'avesmapsSocialCheckTarget');
$bildBei = strpos($publishQuelle, '$mediaReachable');
$notausBei = strpos($publishQuelle, '$enabled');
assert(is_int($weicheBei), 'die Relais-Weiche steht im Dispatch');
assert(is_int($limitBei) && $limitBei < $weicheBei, 'das Zeichenlimit wird VOR dem Einreihen geprueft');
assert(is_int($bildBei) && $bildBei < $weicheBei, 'die Bilderreichbarkeit wird VOR dem Einreihen geprueft');
assert(is_int($notausBei) && $notausBei < $weicheBei, 'der Not-Aus greift VOR dem Einreihen');

// Und sie setzt `queued` -- nicht `sent` (das hiesse „steht draussen") und nicht `failed`.
$weicheBlock = substr($publishQuelle, $weicheBei, 400);
assert(str_contains($weicheBlock, "'queued'"), 'die Weiche reiht ein');
assert(!str_contains($weicheBlock, "'sent'"), 'die Weiche behauptet NIE, es sei gesendet');

// ------------------------------------------------------------------------------------------------
// 4. Der Not-Aus gilt auch fuer den Umweg. ⚠️ Ein Not-Aus, den ein zweiter Versandweg umgeht,
//    ist keiner.
// ------------------------------------------------------------------------------------------------
$nextQuelle = $ohneKommentare(__DIR__ . '/../../../social/relay-next.php');
assert(str_contains($nextQuelle, "'enabled'"), 'relay-next.php fragt den Not-Aus');
$notausNextBei = strpos($nextQuelle, "'enabled'");
$claimBei = strpos($nextQuelle, 'avesmapsSocialRelayClaimNext');
assert(is_int($claimBei) && $notausNextBei < $claimBei, 'der Not-Aus steht vor dem Herausgeben');

// 🔴 Der Riegel steht vor der Methodenpruefung -- fuer einen Unbefugten ist 401 die bessere
// Antwort als 405, sie verraet nicht einmal die erlaubte Methode (Befund A33).
foreach (['relay-next.php', 'relay-result.php'] as $datei) {
    $quelle = $ohneKommentare(__DIR__ . '/../../../social/' . $datei);
    $riegel = strpos($quelle, 'avesmapsSocialRelayTokenOk');
    $methode = strpos($quelle, "!== 'POST'");
    assert(is_int($riegel) && is_int($methode), "{$datei} hat Riegel und Methodenpruefung");
    assert($riegel < $methode, "{$datei}: der Riegel steht vor der Methodenpruefung");
}

// ------------------------------------------------------------------------------------------------
// 5. Der Verfall. 💣 Ohne ihn liegt ein Beitrag, dessen Lauf abgebrochen ist, FUER IMMER in
//    `sending` -- im Hub sieht das aus wie „wird gerade gesendet" und ist ein Totalausfall.
// ------------------------------------------------------------------------------------------------
assert(
    AVESMAPS_SOCIAL_RELAY_STALE_MINUTES > 30,
    'der Verfall muss ueber dem 30-Minuten-Takt liegen, sonst greifen sich zwei Laeufe denselben Beitrag'
);
assert(str_contains($relayQuelle, 'avesmapsSocialRelayReleaseStale'), 'es gibt einen Verfall');
// ⚠️ Und er laeuft VOR dem Herausgeben, nicht irgendwo sonst -- sonst haengt der verschollene
// Beitrag bis zum naechsten Zufall.
$verfallBei = strpos($relayQuelle, 'avesmapsSocialRelayReleaseStale($pdo)');
$suchBei = strpos($relayQuelle, 'FROM social_post_target t');
assert(is_int($verfallBei) && is_int($suchBei) && $verfallBei < $suchBei,
    'der Verfall laeuft, bevor der naechste Beitrag gesucht wird');

// 💣 Kein `INTERVAL` im SQL: das kennt SQLite nicht, und die Produktionsform darf man nicht
// verbiegen, damit ein Test laeuft (AGENTS.md §9, die 1093-Falle). Gerechnet wird gegen die Uhr
// der Datenbank, uebergeben als gewoehnlicher Parameter.
assert(!str_contains($relayQuelle, 'INTERVAL'), 'kein INTERVAL -- das laeuft nicht auf beiden');
assert(str_contains($relayQuelle, 'CURRENT_TIMESTAMP'), 'die Zeit kommt aus der Datenbank, nicht aus PHP');

// ------------------------------------------------------------------------------------------------
// 6. Der Anspruch. 💣 Zwei gleichzeitige Laeufe duerfen nicht denselben Beitrag bekommen.
// ------------------------------------------------------------------------------------------------
assert(
    str_contains($relayQuelle, 'rowCount() !== 1'),
    'der Anspruch gilt nur, wenn der UPDATE genau eine Zeile getroffen hat'
);
// 🔴 Nur freigegebene Beitraege. Ein Entwurf hat noch niemand gesehen.
assert(str_contains($relayQuelle, "'released'"), 'nur freigegebene Beitraege verlassen die Warteschlange');

// ------------------------------------------------------------------------------------------------
// 7. Die Rueckmeldung ueberschreibt kein `sent`. ⚠️ Hat jemand denselben Beitrag inzwischen von
//    Hand gesendet, stuende der Chip sonst auf Rot, waehrend der Beitrag oeffentlich draussen ist.
// ------------------------------------------------------------------------------------------------
assert(
    str_contains($relayQuelle, "!== 'sending'"),
    'geschrieben wird nur auf ein Ziel, das wirklich uebernommen wurde'
);

echo "relay ok\n";
