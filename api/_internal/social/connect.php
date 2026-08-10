<?php

declare(strict_types=1);

// Einen Kanal-Zugang einrichten: EIN kurzlebiger Token hinein, ein dauerhafter Seiten-Token in die
// Datenbank. Der Server macht die drei Schritte, an denen sich am 10.08.2026 ein Mensch dreimal
// gestoßen hat -- Tausch, Seite heraussuchen, nachprüfen.
//
// 💣 DIE REIHENFOLGE IST DER GANZE PUNKT. Erst tauschen, DANN /me/accounts. Umgekehrt kommt ein
// Seiten-Token heraus, der nach ungefähr einer Stunde tot ist -- und er sieht dabei exakt aus wie der
// richtige, wird anstandslos gespeichert und postet auch. Genau so ging es am 10.08.2026 zweimal
// schief. Deshalb macht das hier eine Funktion und nicht ein Mensch mit drei Browser-Tabs.
//
// 🔴 ES WIRD NUR ABGELEGT, WAS DIE NACHPRÜFUNG BESTEHT. Ein Token, der die Prüfung nicht besteht,
// wird NICHT gespeichert -- lieber gar kein Zugang als einer, der in einer Stunde still aufhört. Die
// Absage nennt den gemessenen Grund, nicht "hat nicht geklappt".
//
// 🔴 KEIN TOKEN VERLÄSST DIESE DATEI. Weder in der Antwort, noch in einer Fehlermeldung, noch in einem
// Protokoll. Was zurückgeht, ist der Name der Seite und "läuft nie ab".

require_once __DIR__ . '/channels.php';
require_once __DIR__ . '/store.php';
require_once __DIR__ . '/adapters/facebook.php';

/**
 * Welche Kanäle können sich selbst einrichten? Die Antwort steht im REGISTER (`connect`), nicht hier
 * als Schlüsselliste -- sonst stünde dieselbe Entscheidung an zwei Stellen, und der Hub böte
 * „einrichten" für einen Kanal an, den dieser Weg gar nicht kennt.
 */
function avesmapsSocialConnectSupports(string $key): bool
{
    $channel = avesmapsSocialChannel($key);

    return is_array($channel) && ($channel['connect'] ?? null) === 'facebook_page';
}

/**
 * Eine GET-Anfrage an Graph. Gibt Status und dekodierten Rumpf zurück.
 *
 * ⚠️ Die Adresse trägt hier zwangsläufig Geheimnisse (Metas Tauschendpunkt kennt nur GET). Sie wird
 * deshalb nirgends protokolliert und nie in eine Fehlermeldung übernommen -- zurück geht immer nur
 * Metas eigener `error.message`.
 *
 * @return array{status: int, data: array<string, mixed>}
 */
function avesmapsSocialGraphGet(string $url): array
{
    if (!function_exists('curl_init')) {
        return ['status' => 0, 'data' => []];
    }
    $handle = curl_init($url);
    if ($handle === false) {
        return ['status' => 0, 'data' => []];
    }
    curl_setopt_array($handle, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => AVESMAPS_SOCIAL_FACEBOOK_TIMEOUT,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_FOLLOWLOCATION => false,
    ]);
    $body = curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    curl_close($handle);

    $data = is_string($body) ? json_decode($body, true) : null;

    return ['status' => $status, 'data' => is_array($data) ? $data : []];
}

/**
 * Metas Fehlertext aus einer Antwort, oder null. Rein -- der Text ist die Diagnose und wandert
 * unverändert zum Editor.
 *
 * @param array<string, mixed> $data
 */
function avesmapsSocialGraphError(array $data): ?string
{
    if (!is_array($data['error'] ?? null)) {
        return null;
    }
    $code = (int) ($data['error']['code'] ?? 0);
    $message = trim((string) ($data['error']['message'] ?? ''));

    return 'Facebook: ' . ($message === '' ? 'ohne Begründung' : $message)
        . ($code > 0 ? ' (Code ' . $code . ')' : '');
}

/**
 * Die eigene Zeile aus /me/accounts heraussuchen. Rein und testbar.
 *
 * 💣 Gesucht wird über die KENNUNG aus der Konfiguration, nie über den Namen. Es dürfen mehrere Seiten
 * "Avesmaps" heißen -- am 10.08.2026 gab es genau das bei den Unternehmens-Portfolios --, und die
 * falsche zu erwischen hieße: der Beitrag steht öffentlich auf einer fremden Seite.
 *
 * @param array<string, mixed> $accounts Die Antwort von /me/accounts.
 * @return array{name: string, access_token: string}|null
 */
function avesmapsSocialFacebookPickPage(array $accounts, string $pageId): ?array
{
    foreach (is_array($accounts['data'] ?? null) ? $accounts['data'] : [] as $row) {
        if (!is_array($row) || (string) ($row['id'] ?? '') !== $pageId) {
            continue;
        }
        $token = trim((string) ($row['access_token'] ?? ''));
        if ($token === '') {
            return null;
        }

        return ['name' => (string) ($row['name'] ?? ''), 'access_token' => $token];
    }

    return null;
}

/**
 * Die Nachprüfung: taugt dieser Token als DAUERHAFTER Seiten-Token? Rein, und die eine Stelle, an der
 * der Fehlgriff vom 10.08.2026 strukturell unmöglich wird.
 *
 * Fällt GESCHLOSSEN aus: was nicht nachweislich in Ordnung ist, gilt als nicht in Ordnung. Ein
 * fehlendes Feld ist kein Freibrief -- Metas Antwort ohne `expires_at` beweist nicht "läuft nie ab",
 * sie beweist gar nichts.
 *
 * @param array<string, mixed> $debug Die Antwort von /debug_token.
 * @return string|null Deutsche Absage, oder null wenn alles stimmt.
 */
function avesmapsSocialFacebookVerifyPageToken(array $debug, string $pageId): ?string
{
    $data = is_array($debug['data'] ?? null) ? $debug['data'] : null;
    if ($data === null) {
        return 'Facebook konnte den Token nicht prüfen. Es wurde nichts gespeichert.';
    }
    if (($data['is_valid'] ?? false) !== true) {
        return 'Der Token gilt nicht. Es wurde nichts gespeichert.';
    }

    // 💣 TYP `PAGE`, nicht `USER`. Ein Nutzer-Token trägt dieselben Rechte, sieht in jeder Liste gleich
    // aus und wäre am 09.10.2026 verfallen -- am 10.08.2026 lag genau er kurzzeitig in der Tabelle.
    $type = strtoupper(trim((string) ($data['type'] ?? '')));
    if ($type !== 'PAGE') {
        return 'Das ist ein ' . ($type === 'USER' ? 'Nutzer' : $type) . '-Token, kein Seiten-Token. '
            . 'Der Seiten-Token entsteht erst aus ihm — genau das macht dieser Knopf, es wurde nur '
            . 'nichts Brauchbares zurückgeliefert.';
    }

    // 💣 Die Seite muss DIE konfigurierte sein. Sonst läge hier ein gültiger Token für eine fremde
    // Seite, und der erste Beitrag stünde dort.
    $profileId = (string) ($data['profile_id'] ?? '');
    if ($profileId !== '' && $profileId !== $pageId) {
        return 'Der Token gehört zur Seite ' . $profileId . ', konfiguriert ist aber ' . $pageId
            . '. Es wurde nichts gespeichert.';
    }

    // 🔴 `expires_at === 0` ist der EINZIGE Beweis für "läuft nie ab". Jede andere Zahl ist ein Datum,
    // und ein Datum heißt: der Kanal hört an diesem Tag ohne Vorwarnung auf.
    if (!array_key_exists('expires_at', $data)) {
        return 'Facebook hat kein Ablaufdatum gemeldet. Ohne diesen Nachweis wird nichts gespeichert.';
    }
    $expires = (int) $data['expires_at'];
    if ($expires !== 0) {
        return 'Dieser Token läuft am ' . date('d.m.Y H:i', $expires) . ' ab. Ein dauerhafter '
            . 'Seiten-Token entsteht nur aus einem LANGLEBIGEN Nutzer-Token — der Tausch davor ist '
            . 'offenbar fehlgeschlagen. Es wurde nichts gespeichert.';
    }

    // Ohne Schreibrecht wäre der Zugang eingerichtet und trotzdem stumm; das fällt sonst erst beim
    // ersten Beitrag auf.
    $scopes = is_array($data['scopes'] ?? null) ? $data['scopes'] : [];
    if (!in_array('pages_manage_posts', $scopes, true)) {
        return 'Dem Token fehlt pages_manage_posts — er könnte lesen, aber nichts veröffentlichen. '
            . 'Es wurde nichts gespeichert.';
    }

    return null;
}

/**
 * Der ganze Weg: kurzlebiger Nutzer-Token hinein, geprüfter Seiten-Token in `social_token`.
 *
 * @param array<string, mixed> $social Der 'social'-Block der Konfiguration.
 * @return array{ok: bool, error?: string, page_name?: string, page_id?: string}
 */
function avesmapsSocialConnectFacebook(PDO $pdo, array $social, string $shortLivedToken): array
{
    $settings = is_array($social['facebook'] ?? null) ? $social['facebook'] : [];
    $appId = trim((string) ($settings['app_id'] ?? ''));
    $appSecret = trim((string) ($settings['app_secret'] ?? ''));
    $pageId = trim((string) ($settings['page_id'] ?? ''));
    $version = trim((string) ($settings['graph_version'] ?? '')) !== ''
        ? trim((string) $settings['graph_version'])
        : AVESMAPS_SOCIAL_FACEBOOK_GRAPH_VERSION;

    // Jede Absage nennt den fehlenden Schlüssel. "Nicht eingerichtet" wäre wahr und nutzlos.
    foreach ([['app_id', $appId], ['app_secret', $appSecret], ['page_id', $pageId]] as [$name, $value]) {
        if ($value === '') {
            return ['ok' => false, 'error' => 'In api/config.local.php fehlt social.facebook.' . $name . '.'];
        }
    }
    if (trim($shortLivedToken) === '') {
        return ['ok' => false, 'error' => 'Es wurde kein Token eingefügt.'];
    }

    $base = 'https://graph.facebook.com/' . $version;

    // Schritt 1 -- TAUSCHEN. Muss vor Schritt 2 stehen (siehe Kopf der Datei).
    $exchange = avesmapsSocialGraphGet($base . '/oauth/access_token?' . http_build_query([
        'grant_type' => 'fb_exchange_token',
        'client_id' => $appId,
        'client_secret' => $appSecret,
        'fb_exchange_token' => trim($shortLivedToken),
    ]));
    $error = avesmapsSocialGraphError($exchange['data']);
    if ($error !== null) {
        return ['ok' => false, 'error' => 'Der Tausch in einen langlebigen Token schlug fehl. ' . $error];
    }
    $longLived = trim((string) ($exchange['data']['access_token'] ?? ''));
    if ($longLived === '') {
        return ['ok' => false, 'error' => 'Der Tausch lieferte keinen Token zurück (HTTP '
            . $exchange['status'] . '). Es wurde nichts gespeichert.'];
    }

    // Schritt 2 -- die Seite holen, MIT dem langlebigen Token.
    $accounts = avesmapsSocialGraphGet($base . '/me/accounts?' . http_build_query([
        'fields' => 'name,id,access_token',
        'access_token' => $longLived,
    ]));
    $error = avesmapsSocialGraphError($accounts['data']);
    if ($error !== null) {
        return ['ok' => false, 'error' => 'Die Seitenliste ließ sich nicht abrufen. ' . $error];
    }
    $page = avesmapsSocialFacebookPickPage($accounts['data'], $pageId);
    if ($page === null) {
        // Der häufigste echte Grund, und er kostete am 10.08.2026 die meiste Zeit: die Seite ist der
        // App nicht freigegeben. Die Absage nennt den Weg, nicht nur den Zustand.
        return ['ok' => false, 'error' => 'Die Seite ' . $pageId . ' war in der Antwort nicht dabei. '
            . 'Meist ist sie der App nicht freigegeben: Facebook → Einstellungen → '
            . 'Business-Integrationen → Avesmaps → „Ansehen und bearbeiten" → unter „Pages" die Seite '
            . 'anhaken. Es wurde nichts gespeichert.'];
    }

    // Schritt 3 -- NACHPRÜFEN, bevor irgendetwas gespeichert wird.
    $debug = avesmapsSocialGraphGet($base . '/debug_token?' . http_build_query([
        'input_token' => $page['access_token'],
        // Der App-Token, nicht der Nutzer-Token: nur er darf fremde Tokens prüfen.
        'access_token' => $appId . '|' . $appSecret,
    ]));
    $error = avesmapsSocialGraphError($debug['data']);
    if ($error !== null) {
        return ['ok' => false, 'error' => 'Die Nachprüfung schlug fehl. ' . $error];
    }
    $refusal = avesmapsSocialFacebookVerifyPageToken($debug['data'], $pageId);
    if ($refusal !== null) {
        return ['ok' => false, 'error' => $refusal];
    }

    // Erst jetzt. expires_at bleibt NULL -- das ist hier nicht "unbekannt", sondern nachgewiesen "nie".
    avesmapsSocialTokenSet($pdo, 'facebook', $page['access_token'], null);

    return ['ok' => true, 'page_name' => $page['name'], 'page_id' => $pageId];
}
