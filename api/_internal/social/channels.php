<?php

declare(strict_types=1);

// The channel registry: everything about a network that is NOT a credential (Entwurf §3).
//
// Declarative on purpose. A new network is an entry here plus an adapter -- not a rebuild -- and the
// UI renders whatever stands here, INCLUDING the entries nobody can use yet: a channel without
// access is shown greyed out, never hidden. Whoever looks at the hub should learn what would be
// possible, not silently see a shorter list.
//
// 🔴 CREDENTIALS ARE NOT HERE. They live in api/config.local.php under 'social' (account ids, app
// secrets, the endpoints' own app_token) and -- for the rotating access token -- in the `social_token`
// table, because a token the server refreshes by itself cannot live in a hand-edited PHP file
// (owner decision 2026-08-10). Everything in this file is safe to render into the browser.
//
// 💣 DAS ICON IST DATEN, KEIN CODE. Es steht hier neben der Beschriftung und nicht als
// Schluesselliste im Client -- sonst kennt der Browser eine Zuordnung, die der Server nicht kennt,
// und der naechste Kanal bekommt seins an einer zweiten Stelle (oder gar nicht). Es ist Schmuck:
// die Bedeutung traegt die Beschriftung daneben, denn fuer Netze gibt es keine Emoji, die man
// erraten koennte.
//
// 💣 max_hashtags === null means ALL, not "many". Instagram takes every tag; writing 30 here would be
// a limit nobody imposed, and the composer would silently truncate the editor's tags.
//
// 💣 `ai_label` HEISST „UNSER System bringt dort eine KI-Erklärung an", nicht „das Netz kennt so ein
// Feld". Der Unterschied war bis zum 18.08.2026 rein akademisch und ist es seither nicht mehr: Meta
// KENNT `provenance_info` an `/photos` und lehnt es für unsere App trotzdem ab. Wer hier „aber laut
// Doku kann Facebook das doch" liest und den Wert zurückdreht, baut den Fehlschlag wieder ein --
// die Begründung steht am Facebook-Eintrag.
//
// 💣 Deshalb DREI Felder und keine Herleitung. „nimmt eine Erklärung an, verlangt aber kein Bild,
// ALSO braucht die Erklärung eins" wäre für Facebook zufällig richtig und für den nächsten Kanal
// geraten -- `ai_label_needs_media` sagt es stattdessen aus. Bei Instagram steht `false`, weil dort
// ohnehin nie ein Beitrag ohne Bild entsteht (`requires_media`), die Erklärung also immer ankommt;
// `true` hiesse dort „kann fehlschlagen" und wäre schlicht falsch.
//
// 💣 Und das dritte, seit 18.08.2026: `ai_label_manual` heisst „das NETZ hat ein Label, wir setzen es
// nur nicht -- trag es dort von Hand nach". Es ist NICHT die Verneinung von `ai_label`: Mastodon hat
// überhaupt kein solches Feld, dort gibt es nichts nachzutragen, und ein aus `!ai_label` abgeleiteter
// Hinweis schickte den Editor auf eine Suche nach einem Schalter, den es nicht gibt. Zwei
// verschiedene Aussagen, zwei Felder -- dieselbe Regel wie eine Zeile höher.
/**
 * @var array<string, array{label: string, account: string, max_chars: int|null,
 *      max_hashtags: int|null, requires_media: bool, clickable_links: bool, ai_label: bool,
 *      ai_label_needs_media: bool, ai_label_manual: bool}>
 */
const AVESMAPS_SOCIAL_CHANNELS = [
    // The rehearsal channel (Entwurf §10). It runs the ENTIRE chain -- licence gate, JPEG conversion,
    // crop, storage, reachability probe, per-channel composition, status write -- and then, instead of
    // calling a network, records what it would have sent.
    //
    // Its character and hashtag limits are the STRICTEST of the real channels (Mastodon's 500,
    // Facebook's two), so a post that passes the probe passes everywhere. requires_media stays FALSE
    // on purpose, unlike Instagram: the probe must be able to rehearse a text-only post as well, and
    // the picture path is exercised simply by attaching one.
    'probe' => [
        'label' => 'Probe',
        'icon' => '🧪',
        'account' => 'nur intern — sendet nichts',
        'note' => '',
        'max_chars' => 500,
        'max_hashtags' => 2,
        'requires_media' => false,
        'shows_media' => false,
        'clickable_links' => true,
        // Wie viele Zeichen eine Adresse im Netz drueben ZAEHLT -- null heisst „so lang, wie sie ist".
        // Mastodon rechnet jede als 23 (`characters_reserved_per_url`); unser Zaehler tat es bis zum
        // 05.09.2026 nicht, und ein kurzer Link zaehlte damit zu WENIG -- der Beitrag fiel erst im Relais.
        'url_chars' => null,
        // Die Probe sendet an kein Netz, kann also auch nichts erklären. Sie schreibt die Erklärung
        // aber IN ihren Merkzettel (adapters/probe.php) -- das ist der Sinn der Generalprobe.
        'ai_label' => false,
        'ai_label_needs_media' => false,
        // Nichts nachzutragen: es gibt keinen Beitrag, an dem man etwas nachtragen könnte.
        'ai_label_manual' => false,
    ],
    // Der einzige Kanal, der auf avesmaps SELBST veröffentlicht: das Fenster „Neuigkeiten"
    // (Tabelle `changelog_entry`). Er braucht kein fremdes Konto und ist deshalb -- wie die Probe --
    // ohne jede Konfiguration nutzbar.
    //
    // 🔴 Schlüssel `changelog`, Beschriftung „Neuigkeiten". Dieselbe Trennung, die AGENTS.md §11 für
    // dieses Fenster ohnehin festhält: umbenannt wird, was Menschen lesen, nicht das, woran Code
    // hängt. Der Schlüssel steht in `social_post_target.channel_key` -- er umzutaufen hiesse, jede
    // gespeicherte Zeile mitzuziehen.
    //
    // 💣 Hashtags: KEINE. Im Verlaufsfenster stünden sie als toter Text unter einer Meldung, die
    // niemand nach Schlagworten durchsucht. max_hashtags = 0 kappt sie, statt sie mitzuschleppen.
    'changelog' => [
        'label' => 'Neuigkeiten',
        'icon' => '📰',
        'account' => 'auf avesmaps.de',
        'links' => [
            ['label' => 'Fenster ansehen', 'url' => 'https://avesmaps.de/'],
        ],
        'note' => 'nutzt die Titelzeile · Bild wird nicht übernommen',
        // Die Überschrift ist VARCHAR(190); der Rumpf ist TEXT. 2 000 Zeichen sind reichlich für
        // eine Meldung und halten das Fenster lesbar.
        'max_chars' => 2000,
        'max_hashtags' => 0,
        'requires_media' => false,
        'shows_media' => false,
        'clickable_links' => true,
        'url_chars' => null,
        // „Neuigkeiten" schreibt in unsere EIGENE Tabelle, nicht an ein fremdes Netz -- es gibt
        // niemanden, dem etwas zu erklären wäre.
        'ai_label' => false,
        'ai_label_needs_media' => false,
        // Und nichts nachzutragen: das Fenster kennt keine Kennzeichnung, es gibt drüben keinen
        // Schalter. Dieselbe Lage wie bei Mastodon, aus demselben Grund.
        'ai_label_manual' => false,
    ],
    // 🔴 Instagram wird über die FACEBOOK-SEITE eingerichtet und bedient (Entwurf §12.4). @avesmaps
    // hängt als `instagram_business_account` an der Seite, also ist es derselbe Wirt, dieselbe App und
    // derselbe Seiten-Token wie bei Facebook -- und der läuft nicht ab. Deshalb `facebook_page`,
    // obwohl hier „Instagram" steht.
    //
    // 💣 EIGENE Token-Zeile, obwohl es derselbe Token ist. Läse Instagram Facebooks Zeile mit, meldete
    // der Hub den Kanal als eingerichtet, sobald Facebook es ist -- auch wenn dieser Token die beiden
    // Instagram-Rechte gar nicht trägt. Genau so lag es am 10.08.2026 in der Tabelle.
    'instagram' => [
        'label' => 'Instagram',
        'links' => [
            ['label' => 'Profil', 'url' => 'https://www.instagram.com/avesmaps/'],
            ['label' => 'Token holen', 'url' => 'https://developers.facebook.com/tools/explorer/{facebook.app_id}/'],
            ['label' => 'Token prüfen', 'url' => 'https://developers.facebook.com/tools/debug/accesstoken/'],
            ['label' => 'Freigaben der App', 'url' => 'https://www.facebook.com/settings?tab=business_tools'],
        ],
        'facts' => [
            ['label' => 'Instagram-Kennung', 'value' => '{instagram.user_id}'],
            ['label' => 'über Seite', 'value' => '{facebook.page_id}'],
        ],
        'icon' => '📷',
        'account' => '@avesmaps',
        'connect' => 'facebook_page',
        'connect_scopes' => ['instagram_basic', 'instagram_content_publish'],
        'note' => 'läuft über die Facebook-Seite',
        'max_chars' => 2200,
        'max_hashtags' => null,
        'requires_media' => true,
        'shows_media' => true,
        'clickable_links' => false,
        'url_chars' => null,
        // `is_ai_generated` am Behälter. ⭐ Der einzige Kanal, bei dem die Erklärung IMMER ankommt --
        // er verlangt ohnehin ein Bild, und genau daran hängt sie. Seit dem 18.08.2026 auch der
        // EINZIGE überhaupt: gemessen an Beitrag 30, der auf Instagram gekennzeichnet durchging und
        // auf Facebook am selben Häkchen scheiterte.
        'ai_label' => true,
        'ai_label_needs_media' => false,
        // Nichts nachzutragen -- wir setzen es selbst.
        'ai_label_manual' => false,
    ],
    // 💣 `connect` ist der EINRICHTUNGSweg, nicht der Sendeweg. Steht hier ein Wert, kann der Server
    // den Zugang selbst herstellen (api/_internal/social/connect.php) und der Hub zeigt „einrichten".
    // Fehlt der Schlüssel, gibt es keinen -- dann bleibt nur die Konfiguration von Hand. Er steht im
    // Register und nicht im Client, weil sonst der Browser entscheiden müsste, was der Server kann.
    //
    // 💣 `connect_scopes` sind die Rechte, die der Token für DIESEN Kanal vorweisen muss, und sie
    // stehen je Kanal, nicht einmal für den Weg: Facebook und Instagram teilen sich Seite, App und
    // Token, brauchen aber verschiedene Rechte. Ein Token ohne sie wird NICHT abgelegt -- lieber kein
    // Zugang als einer, der erst beim ersten öffentlichen Beitrag auffliegt.
    'facebook' => [
        'label' => 'Facebook',
        'links' => [
            ['label' => 'Seite', 'url' => 'https://www.facebook.com/avesmaps'],
            ['label' => 'Token holen', 'url' => 'https://developers.facebook.com/tools/explorer/{facebook.app_id}/'],
            ['label' => 'Token prüfen', 'url' => 'https://developers.facebook.com/tools/debug/accesstoken/'],
            ['label' => 'Freigaben der App', 'url' => 'https://www.facebook.com/settings?tab=business_tools'],
            ['label' => 'App-Einstellungen', 'url' => 'https://developers.facebook.com/apps/{facebook.app_id}/settings/basic/'],
        ],
        'facts' => [
            ['label' => 'Seiten-Kennung (Graph)', 'value' => '{facebook.page_id}'],
            ['label' => 'App', 'value' => '{facebook.app_id}'],
        ],
        'icon' => '📘',
        'account' => 'Seite Avesmaps',
        'connect' => 'facebook_page',
        'connect_scopes' => ['pages_manage_posts'],
        'note' => '',
        'max_chars' => 63206,
        'max_hashtags' => 2,
        'requires_media' => false,
        'shows_media' => true,
        'clickable_links' => true,
        'url_chars' => null,
        // 🔴 `false` SEIT DEM 18.08.2026, UND ZWAR GEMESSEN: Meta lehnt `provenance_info` für unsere
        // App mit `(#100) Missing Permission` ab. Nicht „Invalid parameter" -- das Feld ist echt und
        // wird erkannt, wir dürfen es nur nicht setzen. Metas `/photos`-Doku nennt dafür KEINE eigene
        // Berechtigung (nur CREATE_CONTENT, pages_manage_posts, pages_read_engagement,
        // pages_show_list -- die haben wir alle nachweislich); die Hürde ist undokumentiert und
        // hängt mutmasslich am fehlenden App-Review bzw. der fehlenden Unternehmensverifizierung.
        //
        // ⭐ Der Beweis ist ein kontrollierter Vergleich, kein Verdacht: Beitrag 30 (mit Häkchen)
        // scheiterte, Beitrag 28 vom Vortag ging mit demselben Bild, demselben Token und derselben
        // Seite durch -- einziger Unterschied `ai_declared`. Häkchen zurückgenommen, „Erneut"
        // gedrückt, sofort veröffentlicht. Über die ganze Historie ist Facebook GENAU EINMAL
        // gescheitert, und zwar beim einzigen Beitrag mit Erklärung.
        //
        // 💣 Diese Zeile ist mit dem Adapter GEKOPPELT: `avesmapsSocialFacebookRequest` schickt das
        // Feld nur, wenn hier `true` steht. Sie zurückzudrehen, ohne dass Meta die Berechtigung
        // erteilt hat, macht jeden bebilderten Facebook-Beitrag wieder unsendbar.
        'ai_label' => false,
        // 🪤 `false` FOLGT aus der Zeile darüber, es ist keine eigene Aussage: dass `/feed` das Feld
        // nicht kennt, stimmt weiterhin -- nur kommt man dort gar nicht mehr hin. Stünde hier noch
        // `true`, widerspräche der Hub sich selbst („nur an einem Bild" neben „gar nicht").
        'ai_label_needs_media' => false,
        // 🔴 Und HIER steht die Handarbeit: Facebook HAT ein KI-Label („KI-Info" am Beitrag, neben
        // dem Zeitstempel), wir können es nur nicht setzen. Der einzige Kanal mit dieser Lage --
        // deshalb ein eigenes Feld und keine Ableitung aus `!ai_label` (siehe Kopf der Datei).
        'ai_label_manual' => true,
    ],
    // 💣 DIE ZEICHENZAHL IST INSTANZABHÄNGIG, NICHT 500 PER GESETZ. Jede Mastodon-Instanz stellt sie
    // selbst ein; es gibt Instanzen mit 1 500 und mit 5 000. Die 500 hier sind deshalb GEMESSEN, nicht
    // geglaubt: `GET https://rollenspiel.social/api/v2/instance` ->
    // configuration.statuses.max_characters = 500, abgefragt am 11.08.2026 gegen Mastodon 4.6.5.
    // Wer die Instanz wechselt, misst neu -- eine geerbte Zahl waere ein Beitrag, der oeffentlich
    // abprallt, oder einer, der unnoetig gekuerzt wird.
    //
    // 🔧 OFFEN, bewusst: dieselbe Antwort nennt `characters_reserved_per_url = 23` -- Mastodon zaehlt
    // JEDE Verknuepfung als 23 Zeichen, auch eine kuerzere. Unser Zaehler zaehlt sie echt. Bei langen
    // Adressen sind wir damit strenger als noetig (harmlos); nur bei einer sehr kurzen (avesmaps.de =
    // 11) sind wir zu grosszuegig, und ein Beitrag in den letzten zwoelf Zeichen vor 500 kann drueben
    // abprallen. Der Adapter erklaert diesen 422 im Klartext. Es hier zu beheben hiesse, den
    // GEMEINSAMEN Zaehler (compose.php) und die Oberflaeche mitzuaendern -- eigene Arbeit.
    'mastodon' => [
        'label' => 'Mastodon',
        'links' => [
            ['label' => 'Profil', 'url' => '{mastodon.base_url}/@Avesmaps'],
            ['label' => 'Token holen', 'url' => '{mastodon.base_url}/settings/applications'],
        ],
        'facts' => [
            ['label' => 'Instanz', 'value' => '{mastodon.base_url}'],
        ],
        'icon' => '🐘',
        'account' => '@Avesmaps@rollenspiel.social',
        // 💣 DIE ERWARTUNG WIRD VORHER GESETZT, NICHT HINTERHER. Der Chip sagt nach dem Absenden
        // „wartet auf Versand" -- aber wer anhakt und drückt, rechnet mit „sofort draußen" und hält
        // die Verzögerung für einen Fehler. Dieser Kanal ist der einzige, der nicht direkt sendet
        // (Feld `relay`), und genau das gehört in die Zeile, die man VOR dem Klick liest.
        // 🪤 HIER STAND „bis zu 30 Min." — DER TAKT AUS DEM WORKFLOW, UND ER WAR EINE ZUSAGE, DIE
        // GITHUB NIE GEHALTEN HAT. Gemessen am 01.09.2026 (Fall #113): der Zeitplan `*/30` lief in
        // Wahrheit alle 2,3 bis 7,0 Stunden (Mittel 4,6 h, zehn Läufe nachgezählt) — geplante Läufe
        // sind dort „best effort" und werden bei Last ersatzlos verworfen. Ein Melder hielt das
        // zurecht für einen Fehler.
        // ⭐ Seit demselben Tag stößt der Server den Lauf beim Freigeben selbst an
        // (`avesmapsSocialRelayAnstossen`), der Zeitplan ist nur noch das Netz darunter.
        // ⚠️ Deshalb steht hier bewusst KEINE Zahl mehr: sie hinge an GitHubs Laune und am
        // Vorhandensein des Tokens. Wie lange es im Einzelfall wirklich dauert, sagt der Chip am
        // Beitrag — der zählt echte Sekunden, statt eine Frist zu versprechen.
        'note' => 'Versand über GitHub, meist sofort',
        'max_chars' => 500,
        'max_hashtags' => 4,
        'requires_media' => false,
        'shows_media' => true,
        'clickable_links' => true,
        // 🔴 Gemessen an `api/v2/instance` (`characters_reserved_per_url`), nicht geglaubt -- dieselbe
        // Antwort, aus der die 500 stammen. Jede Adresse zaehlt drueben genau so viel, egal wie lang.
        'url_chars' => 23,
        // 🔴 Mastodon kennt KEIN solches Feld: `POST /api/v1/statuses` nimmt status, media_ids, poll,
        // sensitive, spoiler_text, visibility, language, scheduled_at … und nichts zur Herkunft
        // (Doku gemessen 16.08.2026). Bewusste Lücke, keine Baustelle -- es gibt drüben nichts zu
        // setzen. Sollte Mastodon je eins bekommen, ist DIESE Zeile die Stelle.
        'ai_label' => false,
        'ai_label_needs_media' => false,
        // 🔴 Und nichts nachzutragen -- eben WEIL es drüben kein Feld gibt. Das ist der Unterschied
        // zu Facebook, das eins hat und es uns nur verwehrt, und genau dafür gibt es dieses dritte
        // Feld: ein aus `!ai_label` abgeleiteter Hinweis schickte den Editor hier auf die Suche nach
        // einem Schalter, den Mastodon nicht kennt.
        'ai_label_manual' => false,
        // 🔴 DIESER KANAL SENDET NICHT VOM SERVER (Entwurf 2026-08-30-mastodon-relais-design.md).
        // rollenspiel.social verwirft die Pakete unserer Ausgangsadresse -- gemessen am 30.08.2026
        // mit api/edit/admin/ausgang-check.php: Phase `tcp`, Port 80 UND 443, während dieselbe
        // Adresse jedes andere Ziel in 17 ms erreicht. Die Instanz-Administration hat eine Ausnahme
        // geprüft und abgelehnt (Shared-Hosting-Adresse mit fremder Reputation) und um eine
        // Alternative gebeten. Der Beitrag wandert daher in eine Warteschlange, die ein
        // GitHub-Workflow abholt und von SEINER Adresse aus sendet.
        //
        // 💣 Ein Feld im Register, kein `$key === 'mastodon'` im Ablauf. Trifft es je einen zweiten
        // Kanal, ist das eine Datenzeile -- und die Weiche bleibt an EINER Stelle.
        //
        // ⚠️ Mastodon ist der einzige Kanal, bei dem das gefahrlos ist: sein `Idempotency-Key` hängt
        // an der Beitrags-ID, ein zweiter Versand liefert also den ursprünglichen Beitrag zurück
        // statt einen zweiten anzulegen. Bei Instagram wäre ein Doppelversand nicht reparabel.
        'relay' => 'github',
    ],
];

/**
 * @return array<string, mixed>|null The channel, or null for an unknown key. Never a default row --
 *   a typo must fail loudly, not post with invented limits.
 */
function avesmapsSocialChannel(string $key): ?array
{
    return AVESMAPS_SOCIAL_CHANNELS[$key] ?? null;
}

/** @return list<string> */
function avesmapsSocialChannelKeys(): array
{
    return array_keys(AVESMAPS_SOCIAL_CHANNELS);
}

/**
 * Does this channel have a way to reach its network?
 *
 * @param array<string, mixed> $socialConfig The 'social' block of config.local.php.
 * @param list<string>         $tokenKeys    Channel keys that have a row in `social_token`.
 */
function avesmapsSocialChannelIsConfigured(string $key, array $socialConfig, array $tokenKeys): bool
{
    if (avesmapsSocialChannel($key) === null) {
        return false;
    }
    // Two channels need no credentials at all: the probe (that IS its purpose, Entwurf §10) and the
    // "Neuigkeiten" window, which publishes on avesmaps itself -- there is no foreign account to hold
    // an account for. Both are therefore always available.
    if ($key === 'probe' || $key === 'changelog') {
        return true;
    }

    $entry = is_array($socialConfig[$key] ?? null) ? $socialConfig[$key] : [];
    // A stored token row counts as access on its own: the refreshed token lives in the database, and
    // config.local.php then only carries the account id.
    $hasToken = in_array($key, $tokenKeys, true)
        || trim((string) ($entry['access_token'] ?? '')) !== '';
    if (!$hasToken) {
        return false;
    }

    // Beyond the token, each network needs the thing it is ADDRESSED BY. A token without it reaches
    // nobody, and finding that out at publish time means a post that failed in public.
    return match ($key) {
        'instagram' => trim((string) ($entry['user_id'] ?? '')) !== '',
        'facebook' => trim((string) ($entry['page_id'] ?? '')) !== '',
        'mastodon' => trim((string) ($entry['base_url'] ?? '')) !== '',
        default => false,
    };
}

/**
 * Die Adresse der Stelle, an der man den TOKEN dieses Kanals herbekommt -- oder '' wenn es keine
 * gibt oder ein Baustein fehlt.
 *
 * Die Vorlage steht als `admin_url` im Register und trägt Platzhalter der Form `{kanal.schluessel}`,
 * die aus der Konfiguration gefüllt werden. Beides zusammen, weil die Adresse aus BEIDEM entsteht:
 * die Form gehört zum Netz (die kennt das Register), der Wert zum Konto (den kennt nur der Server).
 *
 * ⚠️ Bei Meta ist das der **Graph API Explorer**, NICHT das App-Dashboard. Im Dashboard stehen
 * Einstellungen und das App-Geheimnis; der Knopf „Generate Access Token" steht nur im Explorer.
 * Der erste Anlauf zeigte aufs Dashboard, und der Owner suchte dort vergeblich (11.08.2026).
 *
 * 💣 Bleibt ein Platzhalter offen, kommt '' zurück -- NIE eine halb gefüllte Adresse. Ein Link auf
 * `.../apps/{facebook.app_id}/` sieht aus wie ein Link, führt aber ins Leere, und wer ihn anklickt,
 * sucht den Fehler bei Meta statt in der eigenen Konfiguration.
 *
 * ⚠️ Instagram und Facebook zeigen auf DIESELBE Meta-App -- die Kennung steht nur unter `facebook`.
 * Deshalb nennt die Vorlage den Kanal ausdrücklich, statt „der eigene Block" zu meinen.
 *
 * @param array<string, mixed> $socialConfig
 */
function avesmapsSocialChannelResolve(?string $template, array $socialConfig): string
{
    $template = trim((string) $template);
    if ($template === '') {
        return '';
    }

    $offen = false;
    $url = (string) preg_replace_callback(
        '/\{([a-z_]+)\.([a-z_]+)\}/',
        static function (array $treffer) use ($socialConfig, &$offen): string {
            $entry = is_array($socialConfig[$treffer[1]] ?? null) ? $socialConfig[$treffer[1]] : [];
            $wert = trim((string) ($entry[$treffer[2]] ?? ''));
            if ($wert === '') {
                $offen = true;
            }

            return rtrim($wert, '/');
        },
        $template
    );

    return $offen ? '' : $url;
}

/**
 * Die Verweise bzw. Kennungen eines Kanals, mit den Werten aus der Konfiguration gefüllt.
 *
 * 🔴 DAS IST DER PLATZ, AN DEM MAN IN SECHS MONATEN NACHSIEHT (Owner 11.08.2026). Ein Zugang wird
 * einmal eingerichtet und dann sehr lange nicht mehr angefasst -- und genau dann weiß niemand mehr,
 * welche Seite, welche Kennung, wo der Token herkommt und wo man ihn prüft. Deshalb steht es
 * gesammelt im Hub und nicht verteilt in Notizen, Chatverläufen und Metas Menüs.
 *
 * 💣 Ein Eintrag, dessen Platzhalter sich nicht füllen lässt, FÄLLT WEG -- er wird nicht halb
 * angezeigt. „Instanz: {mastodon.base_url}" wäre eine Zeile, die aussieht wie eine Auskunft und
 * keine ist.
 *
 * @param list<array{label: string, url?: string, value?: string}>|null $entries
 * @param array<string, mixed>                                         $socialConfig
 * @return list<array{label: string, url?: string, value?: string}>
 */
function avesmapsSocialChannelResolveList(?array $entries, array $socialConfig, string $field): array
{
    $out = [];
    foreach (is_array($entries) ? $entries : [] as $entry) {
        if (!is_array($entry)) {
            continue;
        }
        $wert = avesmapsSocialChannelResolve((string) ($entry[$field] ?? ''), $socialConfig);
        if ($wert === '') {
            continue;
        }
        $out[] = ['label' => (string) ($entry['label'] ?? ''), $field => $wert];
    }

    return $out;
}

/**
 * The list the editor panel renders: every channel with its limits, and whether it can be used.
 *
 * 🔴 Carries NO credential -- this travels to the client. The keys below are pinned by
 * channels-test.php precisely so that a field added here cannot reach the browser unnoticed.
 *
 * @param array<string, mixed> $socialConfig
 * @param list<string>         $tokenKeys
 * @return list<array<string, mixed>>
 */
function avesmapsSocialChannelList(array $socialConfig, array $tokenKeys, array $tokenExpiry = []): array
{
    $list = [];
    foreach (AVESMAPS_SOCIAL_CHANNELS as $key => $channel) {
        $list[] = [
            'key' => $key,
            'label' => $channel['label'],
            'icon' => $channel['icon'],
            'account' => $channel['account'],
            'note' => $channel['note'],
            'max_chars' => $channel['max_chars'],
            'max_hashtags' => $channel['max_hashtags'],
            'requires_media' => $channel['requires_media'],
            // Zeigt der Kanal das Bild ueberhaupt? Die Zeile „✓ Passt fuer …" im Hub darf nur die
            // Kanaele nennen, bei denen das Bild ankommt -- Probe und Neuigkeiten tun das nicht.
            // Als Feld im Register statt als Schluesselliste im Client: sonst steht dieselbe
            // Entscheidung an zwei Stellen und laeuft beim naechsten Kanal auseinander.
            'shows_media' => $channel['shows_media'],
            // Nimmt dieses Netz eine KI-Erklärung entgegen? Wie `shows_media` ein Feld im REGISTER
            // und keine Schlüsselliste im Client -- sonst kennt der Browser eine Zuordnung, die der
            // Server nicht kennt, und der nächste Kanal bekommt seine an einer zweiten Stelle.
            'ai_label' => $channel['ai_label'],
            // Und ob sie dort ein Bild bräuchte -- heute nirgends `true`, seit Facebook ganz
            // ausgefallen ist. Die Struktur bleibt: sie beschreibt `/feed` weiterhin richtig und ist
            // am Tag der Meta-Freigabe sofort wieder die Wahrheit.
            'ai_label_needs_media' => $channel['ai_label_needs_media'],
            // Und ob der Editor sie dort von Hand nachtragen muss (Facebook: ja).
            'ai_label_manual' => $channel['ai_label_manual'],
            'clickable_links' => $channel['clickable_links'],
            // Wie das Netz Adressen zaehlt (Mastodon 23): der Browser-Zaehler misst damit wie der Server.
            'url_chars' => $channel['url_chars'],
            'configured' => avesmapsSocialChannelIsConfigured($key, $socialConfig, $tokenKeys),
            // Kann der Server den Zugang selbst herstellen? Nur DASS es geht reist mit, nie WIE --
            // der Weg samt App-Geheimnis bleibt serverseitig.
            'connectable' => ($channel['connect'] ?? null) !== null,
            // Wo man den Zugang dieses Kanals verwaltet. Leer, wenn es keine Konsole gibt oder ein
            // Baustein fehlt -- der Client zeigt dann keinen Link (siehe avesmapsSocialChannelAdminUrl).
            'links' => avesmapsSocialChannelResolveList($channel['links'] ?? null, $socialConfig, 'url'),
            'facts' => avesmapsSocialChannelResolveList($channel['facts'] ?? null, $socialConfig, 'value'),
            // 💣 DREI Zustände, nicht zwei. 'never' ist eine Zusage, null ist deren ABWESENHEIT --
            // kein gespeicherter Zugang, also auch kein Wissen über seinen Ablauf (der Token kann in
            // der Konfiguration stehen). Die beiden zusammenzuwerfen hieße, „läuft nie ab" zu
            // behaupten, wo niemand nachgesehen hat -- und genau diese Behauptung kostete am
            // 10.08.2026 zwei Anläufe. Ein Datum ist eine Vorwarnung, kein Fehler.
            'access_expires' => array_key_exists($key, $tokenExpiry)
                ? ($tokenExpiry[$key] === null ? 'never' : (string) $tokenExpiry[$key])
                : null,
        ];
    }

    return $list;
}
