<?php

declare(strict_types=1);

if (!defined('AVESMAPS_VISITOR_ANALYTICS_ENABLED')) {
    define('AVESMAPS_VISITOR_ANALYTICS_ENABLED', true);
}
// The shipped salt, and it is not a secret -- it is in the repository, which is the point of
// finding A23. It stays the DEFAULT on purpose: changing this string would invalidate every hash
// already stored, so a returning visitor would count as new and the daily figures would step.
// What changed is that it can now be overridden. Doing so is a one-line config change.
const AVESMAPS_VISITOR_SALT_FALLBACK = 'avesmaps-visitor-salt-override-me';

// ⚠️ Kept because it is the older override point and something may already use it: a define()
// placed BEFORE this file is required still wins. The constant itself is no longer read by the
// hash -- avesmapsVisitorSalt() is.
if (!defined('AVESMAPS_VISITOR_SALT')) {
    define('AVESMAPS_VISITOR_SALT', AVESMAPS_VISITOR_SALT_FALLBACK);
}

function avesmapsVisitorAnalyticsEnabled(): bool {
    return AVESMAPS_VISITOR_ANALYTICS_ENABLED === true;
}

// 💣 DER PLATZHALTER IST TRAGEND, ER IST KEINE KOSMETIK.
//
// `hour` steht im UNIQUE-Schluessel uq_visitor_metric und ist bei dreizehn der fuenfzehn Metriken
// bedeutungslos -- nur `pageview` und `map_load` tragen eine Stunde (siehe $hourly in
// api/app/track.php). Solange die Spalte NULL-faehig war, griff ON DUPLICATE KEY UPDATE fuer diese
// Zeilen NIE: nach dem SQL-Standard gelten zwei NULL als VERSCHIEDEN, MySQL erlaubt im
// UNIQUE-Index beliebig viele davon. Jedes Ereignis legte also eine NEUE Zeile mit count=1 an,
// statt eine vorhandene hochzuzaehlen.
//
// 🪤 Und deshalb fiel es vom 28.06.2026 bis zum 25.08.2026 niemandem auf: der Lesepfad rechnet
// ohnehin `SUM(count) ... GROUP BY dimension`, die ANGEZEIGTEN ZAHLEN blieben also richtig.
// Sichtbar war der Fehler allein an der Zeilenzahl -- und die steht ausgerechnet in der Karte
// "Speicher", wo sie niemand mit dieser Ursache verbindet.
//
// Die Zahl ist dieselbe wie bei der Schwestertabelle api_metric
// (AVESMAPS_API_METRICS_KEINE_STUNDE), und der Test haelt fest, dass sie es bleibt: zwei
// verschiedene Zahlen fuer dieselbe Aussage waeren beim naechsten gemeinsamen Leser eine Falle.
const AVESMAPS_VISITOR_KEINE_STUNDE = 24;

/**
 * Die EINE Naht, an der aus "keine Stunde" der Platzhalter wird.
 *
 * 🔴 Sie sitzt IM Schreiber, nicht in seinen Aufrufern -- eine Regel, die nur einen von mehreren
 * Erzeugern bindet, ist keine Regel (AGENTS.md, die Vier-Erzeuger-Falle).
 *
 * ⚠️ Alles ausserhalb von 0..23 wird zum Platzhalter, nicht zu 0. Eine stillschweigende 0 waere
 * schlimmer als der Fehler, den diese Funktion behebt: sie stuende als MITTERNACHT in der Heatmap
 * und machte aus zu vielen Zeilen falsche Zahlen.
 */
function avesmapsVisitorStunde(?int $hour): int {
    if ($hour === null || $hour < 0 || $hour > 23) {
        return AVESMAPS_VISITOR_KEINE_STUNDE;
    }

    return $hour;
}

function avesmapsVisitorAnalyticsEnsureTables(PDO $pdo): void {
    // ⚠️ CREATE TABLE IF NOT EXISTS aendert eine VORHANDENE Tabelle nicht. Diese Form gilt also
    // fuer Neuinstallationen; der Bestand wird einmalig per sql/2026-08-25-visitor-metric-stunde.sql
    // nachgezogen. Bewusst KEINE information_schema-Sonde an dieser Stelle: sie laeuft bei jedem
    // Beacon, und genau diese Last nennt AGENTS.md §10 beim Namen.
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS visitor_metric (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            day DATE NOT NULL,
            hour TINYINT UNSIGNED NOT NULL DEFAULT 24,
            actor_type ENUM('visitor','editor','bot') NOT NULL DEFAULT 'visitor',
            metric VARCHAR(40) NOT NULL,
            dimension VARCHAR(190) NOT NULL DEFAULT '',
            count INT UNSIGNED NOT NULL DEFAULT 0,
            PRIMARY KEY (id),
            UNIQUE KEY uq_visitor_metric (day, hour, actor_type, metric, dimension),
            KEY idx_visitor_metric_metric (metric, day)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS visitor_daily_seen (
            day DATE NOT NULL,
            visitor_hash CHAR(64) NOT NULL,
            PRIMARY KEY (day, visitor_hash)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

function avesmapsVisitorActorType(?array $user): string {
    return ($user !== null && ($user['id'] ?? 0)) ? 'editor' : 'visitor';
}

function avesmapsVisitorClientIp(): string {
    return (string) ($_SERVER['REMOTE_ADDR'] ?? '');
}

// 💣 THE SALT WAS PUBLISHED AND, ON THIS SERVER, UNCHANGEABLE (finding A23). The `if (!defined)`
// above looks like an override point and is not one here: the constant is fixed the moment this
// file is required, and the only place a deployment can keep a secret -- api/config.local.php,
// which is gitignored -- is read LAZILY by avesmapsLoadApiConfig() inside the request handler,
// long afterwards. Every installation therefore ran the same salt, and it is in the repository.
//
// ⚠️ Why that is worse here than a published secret usually is: the hash covers an IP address and
// a user agent. The IPv4 space is small enough to walk in seconds, so a known salt makes a stored
// hash reversible -- and the privacy notice promises that it is not. This function is what makes
// the promise keepable; whether it IS kept depends on the config entry being set.
//
// Three sources, in order: a define() before this file (the old mechanism, still honoured), then
// config.local.php, then the shipped default. Resolved once per request -- avesmapsLoadApiConfig
// reads a file and does not cache, and this runs on every tracked hit.
// Hand the resolver the config an endpoint has ALREADY loaded, so it does not load it again.
//
// 💣 avesmapsLoadApiConfig uses `require`, not `require_once` -- it has to, because it returns
// the array the file yields, and a second `require_once` would hand back `true` instead. So a
// second call really RE-EXECUTES api/config.local.php. Harmless for a file that only returns an
// array, which is its documented shape -- but this was the first place in the project to call
// the loader twice in one request, and it did so on the two hottest analytics paths (a beacon
// per page view, a ping per minute per visitor) on shared hosting.
//
// ⚠️ Priming is a SAVING, not a contract. An endpoint that forgets it gets exactly the previous
// behaviour -- the resolver loads the config itself. Nothing breaks, it just costs what it cost
// before.
//
// Getter and setter in one function because a static cannot otherwise be shared between two.
function avesmapsVisitorSaltPrimedConfig(?array $config = null): ?array {
    static $primed = null;
    if (is_array($config)) {
        $primed = $config;
    }

    return $primed;
}

function avesmapsVisitorSalt(): string {
    static $resolved = null;
    if (is_string($resolved)) {
        return $resolved;
    }

    if (defined('AVESMAPS_VISITOR_SALT')) {
        $defined = trim((string) AVESMAPS_VISITOR_SALT);
        if ($defined !== '' && $defined !== AVESMAPS_VISITOR_SALT_FALLBACK) {
            return $resolved = $defined;
        }
    }

    // ⚠️ Guarded and wrapped: this file is required by five endpoints, and a analytics helper must
    // never be the reason one of them dies. An unreadable config falls through to the default,
    // which is exactly the behaviour before this change.
    // The primed config first -- see avesmapsVisitorSaltPrimedConfig for why loading it again is
    // not free.
    $primed = avesmapsVisitorSaltPrimedConfig();
    if ($primed !== null) {
        $configured = trim((string) ($primed['analytics']['visitor_salt'] ?? ''));
        if ($configured !== '') {
            return $resolved = $configured;
        }

        return $resolved = AVESMAPS_VISITOR_SALT_FALLBACK;
    }

    if (function_exists('avesmapsLoadApiConfig') && function_exists('avesmapsApiRoot')) {
        try {
            $config = avesmapsLoadApiConfig(avesmapsApiRoot());
            $configured = trim((string) ($config['analytics']['visitor_salt'] ?? ''));
            if ($configured !== '') {
                return $resolved = $configured;
            }
        } catch (Throwable) {
            // fall through to the default
        }
    }

    return $resolved = AVESMAPS_VISITOR_SALT_FALLBACK;
}

// ⚠️ Is the salt still the published one? The visitor-metrics surface can say so out loud rather
// than leaving the privacy promise to be taken on trust.
function avesmapsVisitorSaltIsConfigured(): bool {
    return avesmapsVisitorSalt() !== AVESMAPS_VISITOR_SALT_FALLBACK;
}

function avesmapsVisitorDailyHash(): string {
    $ip = avesmapsVisitorClientIp();
    $ua = (string) ($_SERVER['HTTP_USER_AGENT'] ?? '');
    $salt = gmdate('Ymd') . '|' . avesmapsVisitorSalt();
    return hash('sha256', $salt . '|' . $ip . '|' . $ua);
}

function avesmapsVisitorReferrerSource(string $referrer): string {
    $referrer = trim($referrer);
    if ($referrer === '') {
        return 'direkt';
    }
    $host = strtolower((string) parse_url($referrer, PHP_URL_HOST));
    if ($host === '') {
        return 'direkt';
    }
    $host = preg_replace('/^www\\./', '', $host);
    $engines = ['google' => 'Google', 'bing' => 'Bing', 'duckduckgo' => 'DuckDuckGo', 'ecosia' => 'Ecosia'];
    foreach ($engines as $needle => $label) {
        if (str_contains($host, $needle)) {
            return $label;
        }
    }
    return substr($host, 0, 60);
}

function avesmapsVisitorDeviceClass(string $ua): string {
    $ua = strtolower($ua);
    if (str_contains($ua, 'ipad') || str_contains($ua, 'tablet')) {
        return 'tablet';
    }
    if (str_contains($ua, 'mobi') || str_contains($ua, 'android') || str_contains($ua, 'iphone')) {
        return 'mobil';
    }
    return 'desktop';
}

// $day ist fast immer null und heisst dann "heute". Gesetzt wird er nur von der Verweildauer:
// ein Besuch, der um 23:58 endet und um 00:14 verbucht wird, gehoert in den VORTAG. Ohne den
// Parameter waere die Buchung auf den Tag der Aufraeumung datiert -- und die letzte Stunde des
// Tages waere systematisch leer.
// ⚠️ Der Wert muss ein UTC-Datum sein, wie UTC_DATE() es liefert; woher der Aufrufer es nimmt,
// steht bei avesmapsVisitorLadeLiveLauf.
function avesmapsVisitorIncrement(PDO $pdo, string $actorType, string $metric, string $dimension = '', ?int $hour = null, ?string $day = null, int $um = 1): void {
    $metric = substr(trim($metric), 0, 40);
    if ($metric === '' || $um < 1) {
        return;
    }
    $dimension = substr(trim($dimension), 0, 190);
    $statement = $pdo->prepare(
        'INSERT INTO visitor_metric (day, hour, actor_type, metric, dimension, count)
        VALUES (COALESCE(:day, UTC_DATE()), :hour, :actor_type, :metric, :dimension, :um)
        ON DUPLICATE KEY UPDATE count = count + VALUES(count)'
    );
    $statement->execute([
        'day' => $day,
        'um' => $um,
        // 💣 Nie das rohe $hour: ausserhalb des strict mode -- und dieser Server laeuft ausserhalb,
        // siehe die stille Kuerzung von app_setting in AGENTS.md §10 -- macht MySQL aus einem
        // ausdruecklichen NULL in einer NOT-NULL-Spalte stillschweigend eine 0. Die Zeile stuende
        // dann als MITTERNACHT in der Heatmap.
        'hour' => avesmapsVisitorStunde($hour),
        'actor_type' => $actorType === 'editor' ? 'editor' : 'visitor',
        'metric' => $metric,
        'dimension' => $dimension,
    ]);
}

function avesmapsVisitorPurgeOldSeen(PDO $pdo): void {
    $pdo->exec("DELETE FROM visitor_daily_seen WHERE day < UTC_DATE()");
}

function avesmapsVisitorRecordUnique(PDO $pdo, string $actorType): void {
    $hash = avesmapsVisitorDailyHash();
    $insert = $pdo->prepare('INSERT IGNORE INTO visitor_daily_seen (day, visitor_hash) VALUES (UTC_DATE(), :hash)');
    $insert->execute(['hash' => $hash]);
    if ($insert->rowCount() > 0) {
        avesmapsVisitorIncrement($pdo, $actorType, 'unique');
        avesmapsVisitorPurgeOldSeen($pdo);
    }
}

// Mockup: docs/besucherstatistik-verweildauer-mockup.html.
// Die dritte Linie des Besucher-Diagramms: WIE VIELE EDITOREN waren an dem Tag da -- Koepfe, nicht
// Klicks. Das ist dieselbe Groesse wie "Eindeutige" daneben, nur fuer die andere Sorte Mensch, und
// sie wird seit dem 28.06.2026 ohnehin geschrieben (actor_type='editor', metric='unique'). Gemessen
// wird also nichts Neues, nur gelesen.
//
// 💣 Sie wird NUR dem Besucher-Diagramm zugemischt. Im Editoren-Reiter liest derselbe Leser mit
// $actorType='editor', und dort waere `editors` Zeile fuer Zeile identisch mit `uniques`: zwei
// deckungsgleiche Kurven in einem Bild sind keine Auskunft, sondern ein Fehler, der wie Absicht
// aussieht. Der Aufrufer entscheidet das oben, damit die Bedingung an EINER Stelle steht.
//
// 💣 Die Tage werden VEREINIGT, nicht zugeordnet. Ein Tag, an dem ein Editor da war und kein Gast,
// hat gar keine Besucherzeile -- wer nur in vorhandene Zeilen einsetzt, laesst diesen Tag aus der
// Zeitachse fallen, und die Linie springt ueber das Loch hinweg, als waere dort niemand gewesen.
// Umgekehrt bekommt jeder Besuchertag ohne Editor ausdruecklich die 0, sonst zeichnet der Browser
// aus einem fehlenden Wert eine Luecke statt einer Null.
function avesmapsVisitorMergeEditorHeads(PDO $pdo, array $dailyRows, int $days): array {
    $statement = $pdo->prepare(
        "SELECT day, SUM(count) AS editors
        FROM visitor_metric
        WHERE actor_type = 'editor' AND metric = 'unique'
            AND day >= DATE_SUB(UTC_DATE(), INTERVAL :d DAY)
        GROUP BY day"
    );
    $statement->execute(['d' => $days]);

    return avesmapsVisitorMergeEditorRows($dailyRows, $statement->fetchAll(PDO::FETCH_ASSOC));
}

// Die Vereinigung selbst, ohne Datenbank -- damit sie pruefbar ist, ohne die Abfrage fuer einen Test
// zu verbiegen. ⚠️ Eine SQLite-Fixture koennte `DATE_SUB(UTC_DATE(), INTERVAL :d DAY)` oben nicht
// ausfuehren, und die Abfrage danach umzuschreiben hiesse, den Test gegen die Produktion zu drehen
// (AGENTS.md §9, Fehler 1093).
function avesmapsVisitorMergeEditorRows(array $dailyRows, array $editorRows): array {
    $byDay = [];
    foreach ($dailyRows as $row) {
        $day = (string) ($row['day'] ?? '');
        if ($day === '') {
            continue;
        }
        // Ausdruecklich die 0, nicht "kein Wert": aus einem fehlenden Feld zeichnet der Browser eine
        // Luecke, aus der 0 einen Punkt auf der Nulllinie. Nur das zweite ist wahr.
        $row['editors'] = 0;
        $byDay[$day] = $row;
    }
    foreach ($editorRows as $row) {
        $day = (string) ($row['day'] ?? '');
        if ($day === '') {
            continue;
        }
        if (!isset($byDay[$day])) {
            $byDay[$day] = ['day' => $day, 'views' => 0, 'uniques' => 0, 'routes' => 0, 'editors' => 0];
        }
        $byDay[$day]['editors'] = (int) ($row['editors'] ?? 0);
    }
    // Nach Tag, nicht nach Eintreffen: die Zeitachse des Diagramms IST diese Reihenfolge.
    ksort($byDay);

    return array_values($byDay);
}

function avesmapsVisitorReadMetrics(PDO $pdo, string $actorType, int $days): array {
    $days = max(1, min(3660, $days));
    $actorType = $actorType === 'editor' ? 'editor' : 'visitor';

    $daily = $pdo->prepare(
        "SELECT day, SUM(CASE WHEN metric = 'pageview' THEN count ELSE 0 END) AS views,
                SUM(CASE WHEN metric = 'unique' THEN count ELSE 0 END) AS uniques,
                SUM(CASE WHEN metric = 'route' THEN count ELSE 0 END) AS routes
        FROM visitor_metric
        WHERE actor_type = :a AND day >= DATE_SUB(UTC_DATE(), INTERVAL :d DAY)
        GROUP BY day ORDER BY day"
    );
    $daily->execute(['a' => $actorType, 'd' => $days]);
    $dailyRows = $daily->fetchAll(PDO::FETCH_ASSOC);
    if ($actorType === 'visitor') {
        $dailyRows = avesmapsVisitorMergeEditorHeads($pdo, $dailyRows, $days);
    }

    $heat = $pdo->prepare(
        // ⚠️ `hour < :keine` statt des frueheren `hour IS NOT NULL`: seit der Platzhalter existiert,
        // gibt es keine NULL mehr, und der alte Filter waere immer wahr. Er faengt beide Bestaende
        // ab -- eine noch nicht nachgezogene NULL-Zeile faellt ebenfalls heraus, weil jeder
        // Vergleich mit NULL unbekannt ist. Fuer die Heatmap ist das richtig: sie liest nur
        // `pageview`, und das trug schon immer eine echte Stunde.
        "SELECT DAYOFWEEK(day) AS dow, hour, SUM(count) AS c
        FROM visitor_metric
        WHERE actor_type = :a AND metric = 'pageview' AND hour < :keine
            AND day >= DATE_SUB(UTC_DATE(), INTERVAL :d DAY)
        GROUP BY dow, hour"
    );
    $heat->execute(['a' => $actorType, 'd' => $days, 'keine' => AVESMAPS_VISITOR_KEINE_STUNDE]);

    $top = static function (string $metric, int $minCount) use ($pdo, $actorType, $days): array {
        $statement = $pdo->prepare(
            "SELECT dimension, SUM(count) AS c FROM visitor_metric
            WHERE actor_type = :a AND metric = :m AND dimension <> ''
                AND day >= DATE_SUB(UTC_DATE(), INTERVAL :d DAY)
            GROUP BY dimension HAVING c >= :min ORDER BY c DESC LIMIT 8"
        );
        $statement->execute(['a' => $actorType, 'm' => $metric, 'd' => $days, 'min' => $minCount]);
        return $statement->fetchAll(PDO::FETCH_ASSOC);
    };

    return [
        'daily' => $dailyRows,
        'heatmap' => $heat->fetchAll(PDO::FETCH_ASSOC),
        'search' => $top('search', 1),
        'referrer' => $top('referrer', 1),
        'device' => $top('device', 1),
        'map_mode' => $top('map_mode', 1),
        // Der Untergrund und die Landschaften-Ebene stehen NEBEN der Ansicht, nicht darin: seit dem
        // 26.08.2026 ist „Original" keine Ansicht mehr, sondern ein Untergrund (AGENTS.md §11,
        // „Der Kartenfaecher"). Gezaehlt werden beide erst seit dem 29.08.2026 -- rueckwirkend gibt
        // es dazu nichts, und ein leerer Ring ist hier die Wahrheit, kein Fehler.
        'map_style' => $top('map_style', 1),
        'eco_kind' => $top('eco_kind', 1),
        'route' => $top('route', 3),
        'route_waypoint' => $top('route_waypoint', 3),
        'transport' => $top('transport', 1),
        'route_option' => $top('route_option', 1),
        'display_toggle' => $top('display_toggle', 1),
        'language' => $top('language', 1),
    ];
}

function avesmapsVisitorStorageInfo(PDO $pdo): array {
    try {
        $tables = $pdo->query(
            "SELECT table_name AS t, table_rows AS `rows`, data_length + index_length AS bytes
            FROM information_schema.TABLES
            WHERE table_schema = DATABASE() AND table_name IN ('visitor_metric','visitor_daily_seen')"
        )->fetchAll(PDO::FETCH_ASSOC);
        $total = $pdo->query(
            "SELECT SUM(data_length + index_length) AS bytes FROM information_schema.TABLES WHERE table_schema = DATABASE()"
        )->fetchColumn();
        return ['tables' => $tables, 'database_bytes' => (int) $total];
    } catch (Throwable $exception) {
        return ['tables' => [], 'database_bytes' => 0];
    }
}

function avesmapsVisitorRecentActivity(PDO $pdo, int $limit = 12): array {
    $limit = max(1, min(50, $limit));
    $items = [];
    try {
        $reviews = $pdo->query(
            "SELECT location_name, stars, created_at FROM map_reviews
            WHERE is_hidden = 0 AND is_spam = 0 ORDER BY created_at DESC LIMIT 25"
        )->fetchAll(PDO::FETCH_ASSOC);
        foreach ($reviews as $row) {
            $items[] = [
                'type' => 'Bewertung',
                'label' => (string) ($row['location_name'] ?? ''),
                'detail' => ((int) ($row['stars'] ?? 0)) . '★',
                'at' => (string) ($row['created_at'] ?? ''),
            ];
        }
    } catch (Throwable $exception) {
        // map_reviews may not exist on this install
    }
    try {
        $reports = $pdo->query(
            "SELECT name, status, created_at FROM location_reports
            ORDER BY created_at DESC LIMIT 25"
        )->fetchAll(PDO::FETCH_ASSOC);
        foreach ($reports as $row) {
            $items[] = [
                'type' => 'Meldung',
                'label' => (string) ($row['name'] ?? ''),
                'detail' => (string) ($row['status'] ?? ''),
                'at' => (string) ($row['created_at'] ?? ''),
            ];
        }
    } catch (Throwable $exception) {
        // location_reports may not exist on this install
    }
    usort($items, static function (array $a, array $b): int {
        return strcmp((string) $b['at'], (string) $a['at']);
    });
    return array_slice($items, 0, $limit);
}

function avesmapsVisitorLanguage(): string {
    $raw = (string) ($_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? '');
    $first = strtolower(trim(explode(',', $raw)[0] ?? ''));
    $code = substr($first, 0, 2);
    return preg_match('/^[a-z]{2}$/', $code) ? $code : '?';
}

// --- Live presence -----------------------------------------------------------
// "Who is on the site right now", as opposed to the day-aggregated counters above.
// One short-lived row per present visitor, keyed by the same anonymous daily hash
// as visitor_daily_seen -- the IP is never stored, and a row outlives its visitor
// by minutes rather than a day, so this is strictly less retentive than what the
// analytics module already keeps.

if (!defined('AVESMAPS_VISITOR_LIVE_WINDOW_SECONDS')) {
    // Must stay comfortably above the client ping interval (60s), so one dropped
    // beacon does not make a present visitor blink out of the panel.
    define('AVESMAPS_VISITOR_LIVE_WINDOW_SECONDS', 150);
}
if (!defined('AVESMAPS_VISITOR_LIVE_PURGE_MINUTES')) {
    define('AVESMAPS_VISITOR_LIVE_PURGE_MINUTES', 15);
}

function avesmapsVisitorEnsureLiveTable(PDO $pdo): void {
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS visitor_live (
            visitor_hash CHAR(64) NOT NULL,
            actor_type ENUM('visitor','editor') NOT NULL DEFAULT 'visitor',
            state ENUM('active','reading','hidden') NOT NULL DEFAULT 'reading',
            first_seen DATETIME NULL,
            last_seen DATETIME NOT NULL,
            PRIMARY KEY (visitor_hash),
            KEY idx_visitor_live_last_seen (last_seen)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    // ⚠️ CREATE TABLE IF NOT EXISTS aendert eine VORHANDENE Tabelle nicht -- der Bestand braucht
    // die Spalte nachtraeglich. Das hier ist der Nachzieher, und er darf hier stehen, obwohl
    // AGENTS.md §10 DDL auf heissen Pfaden verbietet: diese Funktion laeuft NICHT bei jedem Ping,
    // sondern nur im Fehlerzweig von heartbeat.php, also einmal nach dem Deploy.
    //
    // 🔴 Die Spalte ist NULL-faehig, und das ist Absicht: eine Zeile aus der Zeit VOR dem Umbau
    // hat keinen bekannten Anfang. Sie mit NOW() zu fuellen machte aus ihr einen Besuch, der
    // gerade erst begonnen hat; sie mit last_seen zu fuellen einen von null Sekunden. Beides waere
    // erfunden. NULL heisst "unbekannt", und der Buchhalter laesst solche Zeilen aus.
    try {
        $pdo->exec('ALTER TABLE visitor_live ADD COLUMN first_seen DATETIME NULL AFTER state');
    } catch (PDOException $exception) {
        // Spalte ist schon da -- der Normalfall ab dem zweiten Lauf.
    }
}

// --- Verweildauer ------------------------------------------------------------------------------
// Entwurf: docs/superpowers/specs/2026-08-25-verweildauer-design.md
//
// 🔴 Gemessen wird die Zeit mit der Karte IM VORDERGRUND, nicht "der Tab war offen". Das ist keine
// Wahl, sondern die einzige messbare Groesse: der Ping schweigt bei unsichtbarem Tab, und ein seit
// gestern im Hintergrund liegender Tab ist von einem geschlossenen nicht zu unterscheiden.

if (!defined('AVESMAPS_VISITOR_DWELL_MAX_SECONDS')) {
    // 12 Stunden -- die Obergrenze aus dem Owner-Wunsch. Alles darueber faellt in EINEN Korb.
    define('AVESMAPS_VISITOR_DWELL_MAX_SECONDS', 43200);
}

/**
 * Der Korb, in dem ein Besuch dieser Laenge gezaehlt wird: seine Untergrenze in Sekunden,
 * fuenfstellig mit fuehrenden Nullen.
 *
 * 💣 Die Nullen sind tragend, nicht Kosmetik. `dimension` ist VARCHAR; der Leser sortiert die
 * Koerbe als ZEICHENKETTE, und ohne Auffuellung stuende "1200" vor "300".
 *
 * ⭐ Fein gespeichert, grob gezeigt: die Anzeige darf ihre elf Balken spaeter anders schneiden,
 * ohne die Geschichte neu zu deuten. Und der Median wird aus Koerben interpoliert -- bei
 * 10-Sekunden-Koerben am kurzen Ende ist er auf zehn Sekunden genau, bei Minutenkoerben waere er
 * es nur auf eine Minute, und genau dort liegt die Haelfte aller Besuche.
 *
 * 🔴 Rein und ohne Datenbank -- dieselbe Trennung wie bei avesmapsVisitorMergeEditorRows. Eine
 * SQLite-Fixture koennte die Abfragen drumherum nicht ausfuehren, und sie dafuer umzuschreiben
 * hiesse, den Test gegen die Produktion zu drehen (AGENTS.md §9).
 */
function avesmapsVisitorDwellBucket(int $seconds): string {
    if ($seconds < 0) {
        $seconds = 0;
    }
    if ($seconds >= AVESMAPS_VISITOR_DWELL_MAX_SECONDS) {
        return (string) AVESMAPS_VISITOR_DWELL_MAX_SECONDS;
    }
    if ($seconds < 300) {
        $unten = intdiv($seconds, 10) * 10;      // bis 5 min: 10-Sekunden-Schritte
    } elseif ($seconds < 3600) {
        $unten = intdiv($seconds, 60) * 60;      // bis 60 min: Minutenschritte
    } else {
        $unten = intdiv($seconds, 300) * 300;    // bis 12 h: 5-Minuten-Schritte
    }

    return str_pad((string) $unten, 5, '0', STR_PAD_LEFT);
}

/**
 * Die Dauer zwischen zwei MySQL-Zeitstempeln in Sekunden.
 *
 * 💣 BEIDE Werte muessen von DERSELBEN Uhr stammen -- deshalb liefert avesmapsVisitorLadeLiveLauf
 * auch das `jetzt` der Datenbank mit, statt es hier per PHP zu nehmen. Laeuft die DB-Sitzung in
 * einer anderen Zone als PHP, waere die Differenz sonst um den Zonenversatz falsch, und zwar
 * lautlos und immer gleich -- der unauffaelligste Fehler, den diese Rechnung haben kann.
 *
 * ⚠️ Nie negativ: eine Zeile aus dem Bestand kann einen spaeteren Anfang als Ende tragen.
 */
function avesmapsVisitorDauerSekunden(string $von, string $bis): int {
    $a = strtotime($von);
    $b = strtotime($bis);
    if ($a === false || $b === false) {
        return 0;
    }

    return max(0, $b - $a);
}

/**
 * Die Felder eines laufenden Besuchs -- samt zwei Werten, die die DATENBANK rechnet und nicht PHP.
 *
 * 💣 `jetzt` kommt von hier, damit die Dauer aus zwei Zeitstempeln DERSELBEN Uhr entsteht
 * (siehe avesmapsVisitorDauerSekunden).
 *
 * 💣 `utc_tag` ist der UTC-Kalendertag, an dem der Besuch ANFING. `visitor_metric.day` ist UTC
 * (UTC_DATE()), die Spalte `first_seen` aber steht in der Zonenzeit der DB-Sitzung. Laeuft die auf
 * Europe/Berlin, ist ein Besuch vom 26. um 01:30 in Wahrheit der 25. um 23:30 UTC -- ein Fenster
 * von ein bis zwei Stunden je Tag, in dem die Buchung auf dem falschen Tag laege. Der Ausdruck
 * verschiebt first_seen um genau den Versatz, den die DB selbst zwischen NOW() und UTC_TIMESTAMP()
 * meldet; er braucht keine Zeitzonentabellen, die auf geteiltem Hosting oft fehlen.
 */
const AVESMAPS_VISITOR_LIVE_FELDER =
    'visitor_hash, actor_type, first_seen, last_seen, NOW() AS jetzt,
     DATE(TIMESTAMPADD(SECOND, TIMESTAMPDIFF(SECOND, NOW(), UTC_TIMESTAMP()), first_seen)) AS utc_tag';

function avesmapsVisitorLadeLiveLauf(PDO $pdo): ?array {
    $statement = $pdo->prepare(
        'SELECT ' . AVESMAPS_VISITOR_LIVE_FELDER . ' FROM visitor_live WHERE visitor_hash = :hash'
    );
    $statement->execute(['hash' => avesmapsVisitorDailyHash()]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);

    return is_array($row) ? $row : null;
}

/**
 * DER BUCHHALTER. Schreibt EINEN beendeten Besuch in die Tagesstatistik.
 *
 * 💣 Es gibt genau DREI Ausgaenge aus einem Besuch -- der `gone`-Beacon beim Schliessen des Tabs,
 * der Neustart (ein Ping auf eine Zeile, die laengst kalt ist) und die Aufraeumung. Alle drei
 * gehen durch DIESE Funktion. Eine Regel, die nur einen von mehreren Erzeugern bindet, ist keine
 * Regel -- das hat das Projekt am 14.08. (Verkehrsmittel-Sperre in zwei von vier) und am 15.08.
 * (Ausstiegsregel in einem von vier) je einen Tag gekostet. Der Preis waere hier ein Histogramm,
 * das je nach Ausgang zaehlt oder nicht, und das sieht aus wie ein Datenmangel, nicht wie ein
 * Fehler. Gewacht von dwell-buchhalter-test.php, das die Aufrufer im Quelltext zaehlt.
 *
 * 🔴 Eine Zeile ohne `first_seen` wird uebersprungen, nicht geraten: sie stammt aus der Zeit vor
 * dem Umbau, ihr Anfang ist unbekannt, und eine erfundene Dauer ist schlechter als keine.
 */
function avesmapsVisitorFinishLiveRun(PDO $pdo, array $lauf, bool $endeIstJetzt = false): void {
    $anfang = (string) ($lauf['first_seen'] ?? '');
    if ($anfang === '') {
        return;
    }
    $ende = $endeIstJetzt ? (string) ($lauf['jetzt'] ?? '') : (string) ($lauf['last_seen'] ?? '');
    if ($ende === '') {
        return;
    }

    $sekunden = avesmapsVisitorDauerSekunden($anfang, $ende);
    $actorType = (string) ($lauf['actor_type'] ?? 'visitor');
    // ⚠️ Der Tag des ANFANGS, nie der Tag der Buchung -- siehe AVESMAPS_VISITOR_LIVE_FELDER.
    $tag = (string) ($lauf['utc_tag'] ?? '');
    $tag = $tag !== '' ? $tag : null;

    // Drei Zeilen: der Korb traegt das Histogramm, die zwei Zaehler den EXAKTEN Durchschnitt.
    // Aus Koerben liesse sich nur ein genaeherter rechnen, und der stuende dann neben einem
    // Median, der ohnehin genaehert ist -- zwei Naeherungen, von denen eine vermeidbar war.
    avesmapsVisitorIncrement($pdo, $actorType, 'dwell', avesmapsVisitorDwellBucket($sekunden), null, $tag);
    avesmapsVisitorIncrement($pdo, $actorType, 'dwell_sessions', '', null, $tag);
    if ($sekunden > 0) {
        avesmapsVisitorIncrement($pdo, $actorType, 'dwell_seconds', '', null, $tag, $sekunden);
    }
}

/**
 * Ist der Besuch dieser Zeile zu Ende, obwohl die Zeile noch steht?
 *
 * ⚠️ Gemessen am ANWESENHEITSFENSTER (150 s), nicht an der Aufraeumfrist (15 min): wer nach einer
 * Pause von mehr als zweieinhalb Minuten wieder pingt, war in der Zwischenzeit nicht da. Ohne diese
 * Erkennung verschmelzen der Morgen- und der Abendbesuch desselben Anschlusses zu EINEM Besuch von
 * zwoelf Stunden -- der Tages-Hash ist derselbe.
 *
 * ⚠️ Der Preis in die andere Richtung: eine Pause von mehr als 150 s zaehlt als zwei Besuche. Das
 * ist die kuerzende Richtung, und die ist hier die sichere.
 */
function avesmapsVisitorLiveLaufIstAus(array $lauf): bool {
    $letzte = (string) ($lauf['last_seen'] ?? '');
    $jetzt = (string) ($lauf['jetzt'] ?? '');
    if ($letzte === '' || $jetzt === '') {
        return false;
    }

    return avesmapsVisitorDauerSekunden($letzte, $jetzt) > AVESMAPS_VISITOR_LIVE_WINDOW_SECONDS;
}

/**
 * Ein Ping. Bucht vorher den vorigen Besuch, falls dieser Ping in Wahrheit ein neuer ist.
 *
 * 💣 `first_seen` steht NICHT einfach im ON-DUPLICATE-Zweig. Naehme der Upsert es mit, waere jeder
 * Besuch genau einen Ping lang und das Histogramm haette genau einen Balken -- gefuellt, plausibel
 * und vollstaendig falsch. Neu gesetzt wird der Anfang nur beim ausdruecklichen Neuanfang; das
 * COALESCE daneben faengt die Zeilen aus der Zeit vor dieser Spalte.
 *
 * ⚠️ Kostet eine zusaetzliche Leseabfrage je Ping (Primaerschluessel). Bewusst NICHT dem Client
 * ueberlassen ("ich fange neu an"): faellt das Flag aus, verschmelzen zwei Besuche lautlos, und
 * lautlos falsch ist teurer als ein Indexzugriff.
 */
function avesmapsVisitorRecordLive(PDO $pdo, string $actorType, string $state): void {
    $lauf = avesmapsVisitorLadeLiveLauf($pdo);
    $neuAnfangen = false;
    if ($lauf !== null && avesmapsVisitorLiveLaufIstAus($lauf)) {
        avesmapsVisitorFinishLiveRun($pdo, $lauf);
        $neuAnfangen = true;
    }

    $statement = $pdo->prepare(
        'INSERT INTO visitor_live (visitor_hash, actor_type, state, first_seen, last_seen)
        VALUES (:hash, :actor_type, :state, NOW(), NOW())
        ON DUPLICATE KEY UPDATE
            actor_type = VALUES(actor_type),
            state = VALUES(state),
            first_seen = IF(:neu, NOW(), COALESCE(first_seen, NOW())),
            last_seen = VALUES(last_seen)'
    );
    $statement->execute([
        'hash' => avesmapsVisitorDailyHash(),
        'actor_type' => $actorType === 'editor' ? 'editor' : 'visitor',
        'state' => in_array($state, ['active', 'reading', 'hidden'], true) ? $state : 'reading',
        'neu' => $neuAnfangen ? 1 : 0,
    ]);
}

// Closing the tab removes the row at once instead of letting it linger for the
// length of the window -- the difference between "left" and "idle" is worth a
// beacon on pagehide.
//
// 💣 Erst buchen, dann loeschen. Das ist der GENAUE der drei Ausgaenge: hier steht die echte
// Sekundenzahl bis zum Schliessen, waehrend die anderen beiden auf den letzten Ping abrunden.
function avesmapsVisitorForgetLive(PDO $pdo): void {
    $lauf = avesmapsVisitorLadeLiveLauf($pdo);
    if ($lauf !== null) {
        avesmapsVisitorFinishLiveRun($pdo, $lauf, true);
    }
    $statement = $pdo->prepare('DELETE FROM visitor_live WHERE visitor_hash = :hash');
    $statement->execute(['hash' => avesmapsVisitorDailyHash()]);
}

// 💣 Auch hier: erst buchen, dann loeschen. Diese Funktion loeschte bis zum 26.08.2026 nur -- und
// sie ist der Ausgang, den die MEISTEN Besuche nehmen, weil ein `pagehide`-Beacon vor allem auf
// Mobilgeraeten oft nicht mehr abgeht. Wer die Reihenfolge dreht, verliert genau die.
function avesmapsVisitorPurgeLive(PDO $pdo): void {
    $kalt = $pdo->query(
        'SELECT ' . AVESMAPS_VISITOR_LIVE_FELDER . ' FROM visitor_live
        WHERE last_seen < DATE_SUB(NOW(), INTERVAL ' . AVESMAPS_VISITOR_LIVE_PURGE_MINUTES . ' MINUTE)'
    )->fetchAll(PDO::FETCH_ASSOC);
    foreach ($kalt as $lauf) {
        avesmapsVisitorFinishLiveRun($pdo, $lauf);
    }

    $pdo->exec(
        'DELETE FROM visitor_live
        WHERE last_seen < DATE_SUB(NOW(), INTERVAL ' . AVESMAPS_VISITOR_LIVE_PURGE_MINUTES . ' MINUTE)'
    );
}

/**
 * Die Verweildauer eines Zeitraums: die Koerbe fuer das Histogramm, dazu Anzahl und Sekundensumme
 * fuer den exakten Durchschnitt. Den Median rechnet der Browser aus den Koerben.
 */
function avesmapsVisitorReadDwell(PDO $pdo, string $actorType, int $days): array {
    $days = max(1, min(3660, $days));
    $actorType = $actorType === 'editor' ? 'editor' : 'visitor';

    $koerbe = $pdo->prepare(
        "SELECT dimension, SUM(count) AS c FROM visitor_metric
        WHERE actor_type = :a AND metric = 'dwell' AND dimension <> ''
            AND day >= DATE_SUB(UTC_DATE(), INTERVAL :d DAY)
        GROUP BY dimension ORDER BY dimension"
    );
    $koerbe->execute(['a' => $actorType, 'd' => $days]);

    $summen = $pdo->prepare(
        "SELECT metric, SUM(count) AS c FROM visitor_metric
        WHERE actor_type = :a AND metric IN ('dwell_sessions','dwell_seconds')
            AND day >= DATE_SUB(UTC_DATE(), INTERVAL :d DAY)
        GROUP BY metric"
    );
    $summen->execute(['a' => $actorType, 'd' => $days]);
    $gezaehlt = [];
    foreach ($summen->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $gezaehlt[(string) $row['metric']] = (int) $row['c'];
    }

    return [
        'buckets' => array_map(static function (array $row): array {
            return ['from_seconds' => (int) $row['dimension'], 'count' => (int) $row['c']];
        }, $koerbe->fetchAll(PDO::FETCH_ASSOC)),
        'sessions' => $gezaehlt['dwell_sessions'] ?? 0,
        'seconds_total' => $gezaehlt['dwell_seconds'] ?? 0,
        'max_seconds' => AVESMAPS_VISITOR_DWELL_MAX_SECONDS,
    ];
}

// Presence snapshot for the Status panel. Editors get a row too (so a signed-in
// owner is not counted among the visitors), but they are reported by the editor
// list in api/edit/map/presence.php, which knows their names -- hence only the
// visitor side is summarised here. Aliases are backticked throughout: `rows` once
// cost a deploy cycle by colliding with a MySQL 8 reserved word.
function avesmapsVisitorReadLive(PDO $pdo): array {
    avesmapsVisitorPurgeLive($pdo);
    $statement = $pdo->query(
        "SELECT
            SUM(actor_type = 'visitor') AS `total`,
            SUM(actor_type = 'visitor' AND state = 'active') AS `active`,
            SUM(actor_type = 'visitor' AND state = 'reading') AS `reading`,
            SUM(actor_type = 'visitor' AND state = 'hidden') AS `hidden`
        FROM visitor_live
        WHERE last_seen >= DATE_SUB(NOW(), INTERVAL " . AVESMAPS_VISITOR_LIVE_WINDOW_SECONDS . " SECOND)"
    );
    $row = $statement->fetch(PDO::FETCH_ASSOC) ?: [];

    return [
        'total' => (int) ($row['total'] ?? 0),
        'active' => (int) ($row['active'] ?? 0),
        'reading' => (int) ($row['reading'] ?? 0),
        'hidden' => (int) ($row['hidden'] ?? 0),
        'window_seconds' => AVESMAPS_VISITOR_LIVE_WINDOW_SECONDS,
    ];
}

function avesmapsVisitorEnsureGeoTable(PDO $pdo): void {
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS visitor_geo_range (
            ip_start VARBINARY(16) NOT NULL,
            ip_end VARBINARY(16) NOT NULL,
            country CHAR(2) NOT NULL DEFAULT '',
            region VARCHAR(80) NOT NULL DEFAULT '',
            PRIMARY KEY (ip_start)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
}

// Normalises an IPv4 or IPv6 address to a comparable 16-byte key (IPv4 stored as
// an IPv4-mapped IPv6 address), so a single VARBINARY(16) range table covers both.
function avesmapsVisitorIpKey(string $ip): ?string {
    $packed = @inet_pton($ip);
    if ($packed === false) {
        return null;
    }
    if (strlen($packed) === 4) {
        return "\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\xff\xff" . $packed;
    }
    if (strlen($packed) === 16) {
        return $packed;
    }
    return null;
}

// Resolves an IP to {country, region}. Region is only populated for DE rows in
// the dataset; other countries return an empty region. The IP is used only here
// and never stored. Returns empty strings when the range table is missing/unmatched.
function avesmapsVisitorGeoLookup(PDO $pdo, string $ip): array {
    $empty = ['country' => '', 'region' => ''];
    $key = avesmapsVisitorIpKey($ip);
    if ($key === null) {
        return $empty;
    }
    $keyHex = strtoupper(bin2hex($key));
    try {
        $statement = $pdo->prepare(
            "SELECT country, region, HEX(ip_end) AS ip_end_hex FROM visitor_geo_range
            WHERE ip_start <= UNHEX(:ip) ORDER BY ip_start DESC LIMIT 1"
        );
        $statement->execute(['ip' => $keyHex]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if ($row && (string) $row['ip_end_hex'] >= $keyHex) {
            return ['country' => (string) $row['country'], 'region' => (string) $row['region']];
        }
    } catch (Throwable $exception) {
        // visitor_geo_range not imported yet -- degrade to "unknown"
    }
    return $empty;
}

// Best-effort bot classification from the User-Agent: declared crawlers, headless
// browsers and HTTP libraries. Not foolproof against spoofed UAs (see design notes).
function avesmapsVisitorIsBot(string $userAgent): bool {
    if (trim($userAgent) === '') {
        return true;
    }
    return (bool) preg_match(
        '/bot\b|crawl|spider|slurp|headless|phantom|puppeteer|playwright|python-requests|\bcurl\/|\bwget\b|libwww|scrapy|facebookexternalhit|embedly|whatsapp|telegrambot|discordbot|semrush|ahrefs|mj12|dotbot|petalbot|yandex|baidu|sogou|ia_archiver|googlebot|applebot|duckduckbot|bingbot/i',
        $userAgent
    );
}

// Geo breakdown for the "Herkunft" panel: DE Bundesländer (real-visitor clicks) for
// the map, and other countries with a real-visitor/bot split for the bar list.
function avesmapsVisitorReadGeo(PDO $pdo, int $days): array {
    $days = max(1, min(3660, $days));
    try {
        $regions = $pdo->prepare(
            "SELECT dimension, SUM(count) AS c FROM visitor_metric
            WHERE metric = 'region' AND actor_type = 'visitor' AND dimension <> ''
                AND day >= DATE_SUB(UTC_DATE(), INTERVAL :d DAY)
            GROUP BY dimension ORDER BY c DESC"
        );
        $regions->execute(['d' => $days]);
        $countries = $pdo->prepare(
            "SELECT dimension,
                    SUM(CASE WHEN actor_type = 'visitor' THEN count ELSE 0 END) AS visitors,
                    SUM(CASE WHEN actor_type = 'bot' THEN count ELSE 0 END) AS bots
            FROM visitor_metric
            WHERE metric = 'country' AND dimension <> '' AND dimension <> 'DE'
                AND day >= DATE_SUB(UTC_DATE(), INTERVAL :d DAY)
            GROUP BY dimension
            HAVING SUM(CASE WHEN actor_type IN ('visitor','bot') THEN count ELSE 0 END) > 0
            ORDER BY SUM(CASE WHEN actor_type IN ('visitor','bot') THEN count ELSE 0 END) DESC LIMIT 40"
        );
        $countries->execute(['d' => $days]);
        return [
            'regions' => $regions->fetchAll(PDO::FETCH_ASSOC),
            'countries' => $countries->fetchAll(PDO::FETCH_ASSOC),
        ];
    } catch (Throwable $exception) {
        return ['regions' => [], 'countries' => []];
    }
}
