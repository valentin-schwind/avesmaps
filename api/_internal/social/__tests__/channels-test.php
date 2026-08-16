<?php

declare(strict_types=1);

/**
 * Unit test for the channel registry. Run, from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/social/__tests__/channels-test.php
 *
 * What is worth guarding here is not the data (that is a table anyone can read) but the two rules
 * that decide what the editor SEES:
 *   1. A channel without credentials comes out configured=false -- it must never vanish from the
 *      list, and it must never come out true, because that would offer a publish button that fails.
 *   2. 'probe' is configured WITHOUT any credentials. That is the whole point of Stufe 1: the chain
 *      is exercisable before a single access token exists (Entwurf §10).
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../channels.php';

// ---- the registry itself -----------------------------------------------------------------------

assert(avesmapsSocialChannel('probe') !== null, 'the probe channel exists');
assert(avesmapsSocialChannel('instagram') !== null, 'instagram is registered even without access');
assert(avesmapsSocialChannel('bluesky') === null, 'an unknown key yields null, never a default row');

$instagram = avesmapsSocialChannel('instagram');
assert($instagram['requires_media'] === true, 'instagram without a picture is not a post');
assert($instagram['clickable_links'] === false, 'instagram has no clickable links -- the adapter must know');
assert($instagram['max_chars'] === 2200, 'instagram: 2200 characters');
assert($instagram['max_hashtags'] === null, 'instagram takes ALL hashtags -- null, not a large number');

$facebook = avesmapsSocialChannel('facebook');
assert($facebook['max_hashtags'] === 2, 'facebook: two hashtags, more reads as spam');
assert($facebook['clickable_links'] === true, 'facebook takes a link');

$mastodon = avesmapsSocialChannel('mastodon');
assert($mastodon['max_chars'] === 500, 'mastodon: 500 characters');
assert($mastodon['max_hashtags'] === 4, 'mastodon: four');

// ---- die KI-Kennzeichnung (Entwurf 2026-08-16-ki-kennzeichnung-design.md) ------------------------
//
// Gemessen an Metas bzw. Mastodons Doku am 16.08.2026, nicht geraten. Die Luecken stehen hier
// ausdruecklich, weil ein spaeterer Leser sie sonst fuer Nachlaessigkeit haelt und „nachruestet".
assert($facebook['ai_label'] === true, 'Facebook nimmt provenance_info entgegen');
// 💣 ... aber NUR an /photos. `/feed` kennt das Feld nicht, ein unbebilderter Beitrag geht dort also
// unweigerlich ohne Kennzeichnung raus -- daran haengt der Warnsatz im Hub.
assert($facebook['ai_label_needs_media'] === true, 'und zwar nur an einem BILD');
assert($instagram['ai_label'] === true, 'Instagram nimmt is_ai_generated entgegen');
assert($instagram['ai_label_needs_media'] === false,
    'dort kann sie nie mangels Bild verlorengehen -- Instagram verlangt ohnehin eins');
// 🔴 Mastodon hat kein solches Feld: POST /api/v1/statuses kennt keins. Bewusste Luecke.
assert($mastodon['ai_label'] === false, 'Mastodon kennt keine KI-Erklaerung');
assert(avesmapsSocialChannel('changelog')['ai_label'] === false,
    'Neuigkeiten schreibt in unsere eigene Tabelle -- da ist niemandem etwas zu erklaeren');
assert(avesmapsSocialChannel('probe')['ai_label'] === false,
    'die Probe sendet an kein Netz; sie schreibt die Erklaerung nur in ihren Merkzettel');

// Every entry carries every key. A row missing one would read as null downstream, and null means
// "no limit" -- a typo in the table would silently REMOVE a limit rather than break loudly.
foreach (avesmapsSocialChannelKeys() as $key) {
    $channel = avesmapsSocialChannel($key);
    foreach (['label', 'account', 'note', 'max_chars', 'max_hashtags',
              'requires_media', 'shows_media', 'clickable_links',
              'ai_label', 'ai_label_needs_media'] as $field) {
        assert(array_key_exists($field, $channel), $key . ' carries the field ' . $field);
    }
    assert(is_bool($channel['requires_media']), $key . ': requires_media is a real bool');
    assert(is_bool($channel['shows_media']), $key . ': shows_media is a real bool');
    assert(is_bool($channel['clickable_links']), $key . ': clickable_links is a real bool');
    assert(is_bool($channel['ai_label']), $key . ': ai_label is a real bool');
    assert(is_bool($channel['ai_label_needs_media']), $key . ': ai_label_needs_media is a real bool');
    // 💣 Ein Kanal, der gar keine KI-Erklaerung annimmt, kann dafuer auch kein Bild brauchen. Die
    // Umkehrung liesse den Hub warnen, wo es nichts zu warnen gibt.
    assert(!($channel['ai_label_needs_media'] && !$channel['ai_label']),
        $key . ': ai_label_needs_media ohne ai_label ist ein Widerspruch');
    // 💣 Und wer ohnehin ein Bild VERLANGT, kann die Erklaerung nie mangels Bild verlieren -- dort
    // `true` zu schreiben hiesse „kann fehlschlagen" und waere schlicht falsch.
    assert(!($channel['requires_media'] && $channel['ai_label_needs_media']),
        $key . ': wer ohnehin ein Bild verlangt, braucht ai_label_needs_media nicht');
    // A channel that DEMANDS a picture but would not show it is a contradiction -- it would refuse
    // every text-only post for a picture nobody ever sees.
    assert(!($channel['requires_media'] && !$channel['shows_media']),
        $key . ': requires_media without shows_media makes no sense');
}

// ---- availability -------------------------------------------------------------------------------

// The probe needs NOTHING. This is the assertion that makes Stufe 1 testable at all.
assert(avesmapsSocialChannelIsConfigured('probe', [], []) === true,
    'the probe channel is configured out of the box -- no config, no token');

// And so does "Neuigkeiten": it publishes on avesmaps ITSELF, so there is no foreign account whose
// credentials could be missing. It is the only channel that is both always available AND real.
assert(avesmapsSocialChannelIsConfigured('changelog', [], []) === true,
    'the changelog channel needs no credentials -- it writes into our own database');
assert(avesmapsSocialChannel('changelog')['label'] === 'Neuigkeiten',
    'label "Neuigkeiten", key `changelog` -- the same split AGENTS.md §11 already documents for that '
    . 'window: the key is stored in social_post_target.channel_key and renaming it would drag every '
    . 'saved row along');

assert(avesmapsSocialChannelIsConfigured('instagram', [], []) === false,
    'no credentials, no instagram');
assert(avesmapsSocialChannelIsConfigured('instagram', ['instagram' => ['user_id' => '1']], []) === false,
    'a user id without a token is not access');
assert(avesmapsSocialChannelIsConfigured('instagram', ['instagram' => ['access_token' => 't']], []) === false,
    'and a token without a user id addresses nobody');
assert(avesmapsSocialChannelIsConfigured('instagram', ['instagram' => ['user_id' => '1', 'access_token' => 't']], []) === true,
    'user id plus token is access');
// 🔴 The rotating token lives in the DATABASE (owner decision 2026-08-10), so a token ROW alone is
// enough on that side -- config.local.php then only ever carries the account id.
assert(avesmapsSocialChannelIsConfigured('instagram', ['instagram' => ['user_id' => '1']], ['instagram']) === true,
    'a stored token row counts as access, that is where the refreshed token lives');

assert(avesmapsSocialChannelIsConfigured('facebook', ['facebook' => ['page_id' => '1', 'access_token' => 't']], []) === true,
    'facebook: page and token');
assert(avesmapsSocialChannelIsConfigured('facebook', ['facebook' => ['access_token' => 't']], []) === false,
    'a facebook token without a page addresses nobody');
assert(avesmapsSocialChannelIsConfigured('mastodon', ['mastodon' => ['base_url' => 'https://x', 'access_token' => 't']], []) === true,
    'mastodon: instance and token');
assert(avesmapsSocialChannelIsConfigured('mastodon', ['mastodon' => ['access_token' => 't']], []) === false,
    'a mastodon token without an instance addresses nobody');

// Whitespace is not a credential. '   ' passes a naive !== '' check and would show a channel as
// ready that cannot reach anything.
assert(avesmapsSocialChannelIsConfigured('instagram', ['instagram' => ['user_id' => '  ', 'access_token' => '  ']], []) === false,
    'whitespace is not a credential');

assert(avesmapsSocialChannelIsConfigured('nope', [], []) === false,
    'an unknown channel is never configured');
assert(avesmapsSocialChannelIsConfigured('nope', [], ['nope']) === false,
    'not even with a stray token row -- an unregistered key has no adapter and no limits');

// ---- the list the UI renders ----------------------------------------------------------------------

$list = avesmapsSocialChannelList([], []);
assert(count($list) === count(avesmapsSocialChannelKeys()),
    'EVERY channel is listed, including the ones without access -- greyed out, not hidden (Entwurf §3)');

$byKey = [];
foreach ($list as $row) {
    $byKey[$row['key']] = $row;
}
assert($byKey['probe']['configured'] === true, 'probe usable');
assert($byKey['facebook']['configured'] === false, 'facebook listed but not usable');
assert($byKey['facebook']['account'] !== '',
    'even an unconfigured channel says which account it WOULD be -- that is why it stays visible');
assert($byKey['instagram']['requires_media'] === true,
    'the limits travel to the client too: the hub greys instagram out until a picture is attached');

// 🔴 No secret may travel. This list is rendered into the editor panel.
foreach ($list as $row) {
    assert(!isset($row['access_token']), 'no access token ever leaves the server in the channel list');
    assert(!isset($row['app_secret']), 'no app secret either');
    assert(array_keys($row) === ['key', 'label', 'icon', 'account', 'note', 'max_chars',
        'max_hashtags', 'requires_media', 'shows_media', 'ai_label', 'ai_label_needs_media',
        'clickable_links', 'configured', 'connectable', 'links', 'facts', 'access_expires'],
        'the row carries exactly these seventeen keys -- a field added here reaches the browser');
    // 🔴 `connect_scopes` steht im Register, darf aber NICHT mitreisen: was ein Token vorweisen muss,
    // ist eine Serverentscheidung. Im Browser waere es eine Liste, die jemand fuer eine Einstellung
    // haelt.
    assert(!isset($row['connect_scopes']), 'die Rechteliste bleibt serverseitig');
    // Das Icon ist Schmuck, aber es muss DA sein: eine leere Marke in der Entwurfsliste sieht aus
    // wie ein Darstellungsfehler, nicht wie ein fehlendes Feld.
    assert($row['icon'] !== '', 'jeder Kanal hat ein Icon (' . $row['key'] . ')');
}

// ---- wann der Zugang ablaeuft ----------------------------------------------------------------------

// 💣 DREI Zustaende, nicht zwei. Ohne Zeile wissen wir NICHTS -- der Token kann in der Konfiguration
// stehen. Das als „laeuft nie ab" anzuzeigen waere eine Behauptung ohne Messung, und genau die kostete
// am 10.08.2026 zwei Anlaeufe.
$mitAblauf = avesmapsSocialChannelList(
    ['facebook' => ['page_id' => '1'], 'mastodon' => ['base_url' => 'https://x']],
    ['facebook', 'mastodon'],
    ['facebook' => null, 'mastodon' => '2026-10-09 12:00:00']
);
// ⚠️ Eigener Name: $byKey traegt weiter unten noch die erste Liste, und ein stilles Ueberschreiben
// haette die dortigen Zusicherungen gegen die falschen Daten laufen lassen.
$byAblauf = [];
foreach ($mitAblauf as $row) {
    $byAblauf[$row['key']] = $row;
}
assert($byAblauf['facebook']['access_expires'] === 'never',
    'eine Zeile OHNE Ablaufdatum ist die Zusage „laeuft nie ab"');
assert($byAblauf['mastodon']['access_expires'] === '2026-10-09 12:00:00',
    'eine Zeile MIT Datum reicht das Datum durch -- es ist eine Vorwarnung, kein Fehler');
assert($byAblauf['instagram']['access_expires'] === null,
    'ein Kanal ohne Zeile ist NULL und niemals „never" -- Nichtwissen ist keine Zusage');
assert($byAblauf['probe']['access_expires'] === null,
    'auch die Probe: sie ist nutzbar, aber sie hat keinen Zugang, dessen Ablauf man kennen koennte');

// ---- der Einrichtungsweg ---------------------------------------------------------------------------

// Nur DASS es geht reist mit, nie WIE: der Weg braucht das App-Geheimnis und bleibt serverseitig.
assert($byKey['facebook']['connectable'] === true, 'Facebook kann sich selbst einrichten');
assert($byKey['probe']['connectable'] === false, 'die Probe hat keinen Zugang und braucht keinen');
// 💣 Instagram ist seit 11.08.2026 einrichtbar, und zwar ueber DENSELBEN Weg wie Facebook: es haengt
// als instagram_business_account an derselben Seite (Entwurf §12.4, gemessen). Der frueher hier
// erwartete eigene Weg (graph.instagram.com, eigene Rechtenamen) ist damit verworfen.
assert($byKey['instagram']['connectable'] === true, 'Instagram inzwischen auch, ueber die Seite');
// 🔴 Die geforderten Rechte bleiben SERVERSEITIG. Sie stehen im Register, aber nicht in der Liste,
// die in den Browser reist -- dort waeren sie eine Landkarte der App-Rechte fuer jeden Mitleser.
assert(!array_key_exists('connect_scopes', $byKey['instagram']),
    'die geforderten Rechte reisen NICHT zum Client');
assert((AVESMAPS_SOCIAL_CHANNELS['instagram']['connect_scopes'] ?? []) === ['instagram_basic', 'instagram_content_publish'],
    'im Register stehen sie aber, und zwar die Instagram-eigenen');
assert((AVESMAPS_SOCIAL_CHANNELS['facebook']['connect_scopes'] ?? []) === ['pages_manage_posts'],
    'und Facebook fordert etwas anderes, obwohl es derselbe Token ist');

// 🔴 „Einrichtbar" heisst NICHT „eingerichtet". Facebook ist beides getrennt: der Knopf steht auch
// da, wenn noch kein Token existiert -- genau dafuer ist er da -- und verschwindet danach nicht,
// weil ein Token ersetzt werden koennen muss.
assert($byKey['facebook']['configured'] === false && $byKey['facebook']['connectable'] === true,
    'nicht eingerichtet und trotzdem einrichtbar -- die beiden Felder duerfen nie zusammenfallen');

// Config for one channel must not configure another.
$onlyMastodon = avesmapsSocialChannelList(['mastodon' => ['base_url' => 'https://x', 'access_token' => 't']], []);
$byKey = [];
foreach ($onlyMastodon as $row) {
    $byKey[$row['key']] = $row;
}
assert($byKey['mastodon']['configured'] === true, 'mastodon is configured');
assert($byKey['instagram']['configured'] === false, 'instagram is not, and does not borrow it');

// ---- Konten, Kennungen, Konsolen -------------------------------------------------------------

// 🔴 Der Platz, an dem man in SECHS MONATEN nachsieht (Owner 11.08.2026). Ein Zugang wird einmal
// eingerichtet und dann sehr lange nicht mehr angefasst; was hier fehlt, sucht spaeter jemand in
// Notizen, Chatverlaeufen und Metas Menues.
$mitKonto = avesmapsSocialChannelList([
    'facebook' => ['app_id' => 'APP1', 'page_id' => 'PAGE1'],
    'instagram' => ['user_id' => 'IG1'],
    'mastodon' => ['base_url' => 'https://rollenspiel.social/'],
], [], []);
$byKonto = [];
foreach ($mitKonto as $row) {
    $byKonto[$row['key']] = $row;
}

$fbLinks = [];
foreach ($byKonto['facebook']['links'] as $link) {
    $fbLinks[$link['label']] = $link['url'];
}
// ⚠️ „Token holen" fuehrt in den EXPLORER. Im App-Dashboard stehen nur Einstellungen und das
// App-Geheimnis -- den Knopf „Generate Access Token" gibt es dort nicht, und der Owner suchte ihn
// dort vergeblich (11.08.2026).
assert($fbLinks['Token holen'] === 'https://developers.facebook.com/tools/explorer/APP1/',
    'Token holen fuehrt in den Explorer, nicht ins Dashboard');
assert(isset($fbLinks['Seite']), 'die Seite selbst steht auch dabei -- man will auch mal nachsehen');

$fbFacts = [];
foreach ($byKonto['facebook']['facts'] as $fact) {
    $fbFacts[$fact['label']] = $fact['value'];
}
assert(in_array('PAGE1', $fbFacts, true), 'die Seiten-Kennung steht zum Abschreiben da');

$mLinks = [];
foreach ($byKonto['mastodon']['links'] as $link) {
    $mLinks[$link['label']] = $link['url'];
}
// Der Schraegstrich am Ende der Instanz darf sich nicht verdoppeln.
assert($mLinks['Token holen'] === 'https://rollenspiel.social/settings/applications',
    'die Instanz-Adresse wird eingesetzt, ohne doppelten Schraegstrich');

assert($byKonto['probe']['links'] === [] && $byKonto['probe']['facts'] === [],
    'die Probe hat kein Konto und deshalb auch nichts nachzuschlagen');

// 💣 Ein Eintrag, dessen Platzhalter sich nicht fuellen laesst, FAELLT WEG -- er wird nicht halb
// angezeigt. „Instanz: {mastodon.base_url}" waere eine Zeile, die aussieht wie eine Auskunft und
// keine ist.
$ohne = avesmapsSocialChannelList([], [], []);
foreach ($ohne as $row) {
    foreach ($row['links'] as $link) {
        assert(mb_strpos($link['url'], '{') === false,
            $row['key'] . ': kein offener Platzhalter im Link');
    }
    foreach ($row['facts'] as $fact) {
        assert(mb_strpos($fact['value'], '{') === false,
            $row['key'] . ': kein offener Platzhalter in der Kennung');
    }
}
$byOhne = [];
foreach ($ohne as $row) {
    $byOhne[$row['key']] = $row;
}
assert($byOhne['mastodon']['links'] === [], 'ohne Instanz kein einziger Mastodon-Link');
assert($byOhne['facebook']['facts'] === [], 'ohne Kennungen keine Kennungszeilen');
// Ein Link OHNE Platzhalter bleibt trotzdem stehen -- er braucht keine Konfiguration. Sonst waere
// die Seite selbst weg, nur weil die App-Kennung fehlt.
assert(count($byOhne['facebook']['links']) === 3,
    'Seite, Token-Pruefer und Freigaben stehen auch ohne App-Kennung da');

fwrite(STDOUT, "channels-test: OK\n");
