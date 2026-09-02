<?php

declare(strict_types=1);

/**
 * Der KORPUS — die Sammlung, aus der eine Quelle stammt.
 *
 * Entwurf: docs/superpowers/specs/2026-09-01-bekannte-quellen-design.md
 * Mockup:  docs/bekannte-quellen-mockup.html
 *
 * 🔴 DER SCHLUESSEL IST DIE REGISTRIERBARE DOMAIN AUS `sources.url` UND WIRD NIE GESPEICHERT.
 * Er wird bei Bedarf gerechnet. Damit ist jede vorhandene Zeile mit Adresse per Konstruktion
 * schon zugeordnet -- es gibt nichts zu migrieren, keinen Einmal-Lauf, keine Spalte an `sources`.
 * Gespeichert wird nur das NICHT Ableitbare: wie der Korpus HEISST und was er festlegt.
 * Live gemessen 01.09.2026: 1.019 Zeilen mit Adresse auf 15 registrierbaren Domains.
 *
 * 💣 DIES IST KEIN ZWEITES QUELLENSYSTEM (AGENTS.md §5). Es legt keine Quelle an, es verknuepft
 * nichts und es kennt `feature_sources` nicht. Es ist eine BESCHRIFTUNG ueber `sources`, mehr
 * nicht -- wer hier anfaengt, Quellen zu speichern, baut den Lore-Fehler von 2026-07-21 nach.
 */

/**
 * ⚠️ DIE RICHTUNG DER ABHAENGIGKEIT IST TRAGEND: der Korpus haengt an den Quellen, nie umgekehrt.
 * Er ist eine Beschriftung UEBER `sources`, also darf `feature-sources.php` ihn NICHT einbinden --
 * sonst steht ein Zirkel da, und `require_once` loest ihn stumm falsch auf (die Datei, die noch
 * laedt, gilt als geladen, und ihre Funktionen fehlen dann genau dort, wo man sie ruft).
 * 💣 Und ohne diese Zeile faellt `avesmapsPdoDriverName` aus, sobald jemand NUR dieses Modul
 * einbindet -- ein Test tut genau das. Ein fehlender Geschwister-Helfer ist live ein Fatal Error
 * mit LEEREM Rumpf und im Testfeld gruen; das hat dieses Haus schon zweimal bezahlt.
 */
require_once __DIR__ . '/feature-sources.php';
// 💣 Und der Bootstrap dazu: `avesmapsNormalizeSingleLine` wohnt DORT, nicht bei den Quellen.
// Ohne diese Zeile faellt der Schreibweg mit „undefined function" um, sobald ihn jemand ohne
// Endpunkt einbindet -- live ein Fatal Error mit LEEREM Rumpf, im Testfeld gruen, weil der Test
// den Bootstrap selbst schon geladen hatte. Genau diese Klasse Fehler hat dieses Haus zweimal
// bezahlt; eine eigene Kopie der Funktion waere die zweite Wahrheit daneben.
require_once __DIR__ . '/../bootstrap.php';

// ══ 1 · Der Schluessel ══════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ KEINE Public-Suffix-Liste, sondern eine kleine Tabelle -- und das ist eine bewusste Grenze.
 * Die echte Regel („registrierbare Domain") braucht Mozillas Public Suffix List mit ueber 9.000
 * Eintraegen, die gepflegt werden will. Unser Bestand braucht sie nicht: alle 15 gemessenen
 * Domains enden auf `.de`, `.net`, `.com` oder `.org`; die zehn haeufigsten mehrteiligen Endungen
 * stehen unten mit drin. Ein Wirt unter einer NICHT gelisteten mehrteiligen Endung
 * (`beispiel.co.za`) bekaeme `co.za` als Korpus -- sichtbar falsch, in EINER Zeile zu heilen, und
 * bis dahin gruppiert er zu GROB statt zu fein. Das ist die harmlosere Richtung: zwei Wirte
 * landen in einem Topf, statt dass ein Wirt in zwei zerfaellt.
 */
const AVESMAPS_SOURCE_CORPUS_MULTI_LABEL_TLDS = [
    'co.uk', 'org.uk', 'me.uk', 'com.au', 'net.au', 'org.au',
    'co.jp', 'com.br', 'co.nz', 'com.tr',
];

/**
 * Die registrierbare Domain einer Adresse. '' wenn keine zu erkennen ist.
 *
 * ⭐ Sie loest eine Falle der ersten Entwurfsfassung nebenbei: `wiki.punin.de` und `punin.de`,
 * `horaswiki.de` und `wiki.horaswiki.de` fallen von selbst zusammen. Der erste Entwurf brauchte
 * dafuer noch einen Mehrfachschluessel („mehrere Domains zeigen auf einen Korpus").
 *
 * 💣 Eine URL-LOSE Quelle hat KEINEN Korpus. 357 Katalogzeilen sind Wiki-Publikationen ohne
 * Adresse (gemessen 01.09.2026: 100 % offiziell, 0 Briefspiele, 0 ohne Titel) -- allesamt Werke,
 * deren Identitaet ihr Titel ist. Sie brauchen keinen und bekommen keinen.
 */
function avesmapsSourceCorpusKey(string $url): string
{
    $url = trim($url);
    if ($url === '') {
        return '';
    }
    $host = (string) (parse_url($url, PHP_URL_HOST) ?: '');
    if ($host === '') {
        // ⚠️ Eine Adresse ohne Schema (`herzogtum-weiden.net/seite`) parst PHP als PFAD, nicht als
        // Host -- `parse_url` liefert dann gar nichts. Zweiter Versuch mit vorangestelltem Schema,
        // sonst waere jede handgetippte Adresse ohne `https://` korpuslos.
        $host = (string) (parse_url('https://' . ltrim($url, '/'), PHP_URL_HOST) ?: '');
    }
    $host = strtolower(rtrim($host, '.'));
    if ($host === '' || strpos($host, '.') === false) {
        return ''; // `localhost`, eine nackte IP-Komponente, Unsinn
    }
    // Eine IPv4-Adresse ist kein Korpus (und ihre „letzten zwei Labels" waeren Unfug).
    if (preg_match('/^\d{1,3}(\.\d{1,3}){3}$/', $host) === 1) {
        return '';
    }
    $teile = explode('.', $host);
    if (count($teile) < 2) {
        return '';
    }
    $letzteZwei = implode('.', array_slice($teile, -2));
    if (count($teile) >= 3 && in_array($letzteZwei, AVESMAPS_SOURCE_CORPUS_MULTI_LABEL_TLDS, true)) {
        return implode('.', array_slice($teile, -3));
    }

    return $letzteZwei;
}

// ══ 2 · Was ein Korpus festlegt ═════════════════════════════════════════════════════════════════

/**
 * 🔴 DREI Formen, nicht zwei -- und die dritte ist der Normalfall bei etwas Neuem.
 *
 * `werk`        Der TITEL steht vorn („Geographia Aventurica"), der Korpus hinter dem ⓘ.
 * `belegstelle` Der KORPUSNAME steht vorn („Briefspiel (Weiden)"), der Titel hinter dem ⓘ.
 * `''`          Unentschieden -- verhaelt sich wie `werk`.
 *
 * 💣 Die dritte ist tragend. Das Verhaeltnis Titel/Zeilen trennt die beiden anderen am Bestand
 * messerscharf (Werke 0,98-1,00 gegen Belegstellen 0,10-0,15, dazwischen NICHTS) -- aber bei
 * einem NEUEN Korpus sagt es nichts: eine Zeile ergibt immer 1,00 und saehe aus wie ein Werk.
 * Wer die Form dort raet, trifft in gut der Haelfte der Faelle daneben und behauptet dabei, es
 * gemessen zu haben. `''` verhaelt sich wie `werk` -- das ist exakt das heutige Verhalten, also
 * kein Rueckschritt, und die offene Entscheidung steht sichtbar in der Korpusliste.
 */
const AVESMAPS_SOURCE_CORPUS_FORMS = ['', 'werk', 'belegstelle'];

function avesmapsSourceCorpusNormalizeForm(string $form): string
{
    $form = strtolower(trim($form));

    return in_array($form, AVESMAPS_SOURCE_CORPUS_FORMS, true) ? $form : '';
}

/** Steht bei diesem Korpus der Korpusname vorn? `''` verhaelt sich wie `werk` -> nein. */
function avesmapsSourceCorpusShowsCorpusName(string $form): bool
{
    return avesmapsSourceCorpusNormalizeForm($form) === 'belegstelle';
}

/**
 * Der VORSCHLAG fuer die Form, aus Zeilenzahl und Zahl verschiedener Titel. Nie eine Entscheidung.
 *
 * Gemessen 01.09.2026: f-shop 637/623 = 0,98 · ulisses 242/242 = 1,00 · westlande 39/4 = 0,10 ·
 * weiden 33/4 = 0,12 · kahet 16/2 = 0,12 · punin 33/5 = 0,15.
 *
 * ⚠️ Unter `AVESMAPS_SOURCE_CORPUS_FORM_MIN_ROWS` Zeilen wird NICHT vorgeschlagen -- dort ist das
 * Verhaeltnis kein Signal, sondern Arithmetik. Sechs der 15 Domains haben genau eine Zeile.
 */
const AVESMAPS_SOURCE_CORPUS_FORM_MIN_ROWS = 3;
const AVESMAPS_SOURCE_CORPUS_FORM_RATIO = 0.5;

function avesmapsSourceCorpusFormSuggestion(int $rows, int $distinctTitles): string
{
    if ($rows < AVESMAPS_SOURCE_CORPUS_FORM_MIN_ROWS || $distinctTitles <= 0) {
        return '';
    }

    return ($distinctTitles / $rows) < AVESMAPS_SOURCE_CORPUS_FORM_RATIO ? 'belegstelle' : 'werk';
}

/**
 * Der VORSCHLAG fuer die Art eines Belegstellen-Korpus: die Mehrheit der GETROFFENEN Aussagen.
 *
 * 💣 NICHT die schlichte Mehrheit. `herzogtum-weiden.net` steht live auf `sonstiges: 22` gegen
 * `briefspiel: 11` -- und `sonstiges` ist im Haus die NICHT-Aussage (avesmapsNormalizeSourceType
 * macht aus `''` beim Anlegen `sonstiges`). Die schlichte Mehrheit ergaebe „sonstiges" und
 * schriebe damit genau den Defekt fest, den dieser Umbau beseitigen soll. Ohne `sonstiges` steht
 * es 11:0 fuer `briefspiel`.
 *
 * ⚠️ Gleichstand -> '' (keine Aussage). Ein Muenzwurf saehe aus wie eine Messung.
 *
 * @param array<string,int> $counts  Art => Anzahl
 */
function avesmapsSourceCorpusTypeSuggestion(array $counts): string
{
    $beste = '';
    $bestN = 0;
    $gleichstand = false;
    foreach ($counts as $art => $n) {
        $art = (string) $art;
        $n = (int) $n;
        if ($art === '' || $art === 'sonstiges' || $n <= 0) {
            continue; // keine Aussage
        }
        if ($n > $bestN) {
            $beste = $art;
            $bestN = $n;
            $gleichstand = false;
        } elseif ($n === $bestN && $art !== $beste) {
            $gleichstand = true;
        }
    }

    return $gleichstand ? '' : $beste;
}

// ══ 3 · Ablage ══════════════════════════════════════════════════════════════════════════════════

/**
 * 🔴 Rund 15 Zeilen, und sie tragen NUR das nicht Ableitbare. Kein `url`, keine `source_id`, kein
 * Bezug auf ein Objekt -- der Bezug entsteht jedes Mal neu aus `avesmapsSourceCorpusKey()`.
 *
 * ⚠️ Selbstheilende DDL wie im ganzen Haus (AGENTS.md §5); SQLite kommt ausschliesslich aus Tests
 * und steht als zweite Fassung DANEBEN, nie als Verbiegung der Produktionsform (die Lehre aus dem
 * MySQL-1093-Fall, AGENTS.md §9).
 */
function avesmapsEnsureSourceCorpusTable(PDO $pdo): void
{
    if (avesmapsPdoDriverName($pdo) === 'sqlite') {
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS source_corpus (
                corpus_key TEXT PRIMARY KEY,
                label TEXT NOT NULL DEFAULT "",
                form TEXT NOT NULL DEFAULT "",
                source_type TEXT NOT NULL DEFAULT "",
                license TEXT NOT NULL DEFAULT "",
                attribution TEXT NOT NULL DEFAULT "",
                is_official INTEGER NOT NULL DEFAULT 0,
                updated_by INTEGER NULL,
                updated_at TEXT NULL
            )'
        );

        return;
    }
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS source_corpus (
            corpus_key VARCHAR(190) NOT NULL PRIMARY KEY,
            label VARCHAR(200) NOT NULL DEFAULT '',
            form VARCHAR(16) NOT NULL DEFAULT '',
            source_type VARCHAR(32) NOT NULL DEFAULT '',
            license VARCHAR(32) NOT NULL DEFAULT '',
            attribution VARCHAR(200) NOT NULL DEFAULT '',
            is_official TINYINT(1) NOT NULL DEFAULT 0,
            updated_by INT NULL,
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
}

/**
 * Alle Korpora als { corpus_key => zeile }. Faellt OFFEN aus: kein Korpus heisst „wie heute".
 *
 * 💣 Der Rueckfall ist NICHT still. Ein leeres Ergebnis heisst „es gibt keine Korpora" und sieht
 * damit exakt so aus wie „die Tabelle war nicht lesbar" -- deshalb protokolliert der Fehlerfall,
 * statt zu schlucken. Genau diese Verwechslung hat „Was ist hier?" am 15.08.2026 gekostet: ein
 * `catch (Throwable) { return []; }` machte aus einem SQL-Fehler ein glaubwuerdiges „hier liegt
 * nichts".
 */
function avesmapsSourceCorpusReadAll(PDO $pdo): array
{
    try {
        avesmapsEnsureSourceCorpusTable($pdo);
        $rows = $pdo->query(
            'SELECT corpus_key, label, form, source_type, license, attribution, is_official
               FROM source_corpus'
        );
        if ($rows === false) {
            return [];
        }
    } catch (Throwable $fehler) {
        error_log('avesmapsSourceCorpusReadAll: ' . $fehler->getMessage());

        return [];
    }
    $korpora = [];
    foreach ($rows->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
        $key = (string) $row['corpus_key'];
        if ($key === '') {
            continue;
        }
        $korpora[$key] = [
            'corpus_key' => $key,
            'label' => (string) $row['label'],
            'form' => avesmapsSourceCorpusNormalizeForm((string) $row['form']),
            'source_type' => (string) $row['source_type'],
            'license' => (string) $row['license'],
            'attribution' => (string) $row['attribution'],
            'is_official' => (int) $row['is_official'] === 1,
            'known' => true,
        ];
    }

    return $korpora;
}

/**
 * 🔴 DIE FELDER, DIE EIN KORPUS TRAEGT. Was nicht darinsteht, kann kein Aufrufer setzen -- die
 * Weisse Liste steht hier und nicht im Endpunkt, damit sie EINE ist.
 */
const AVESMAPS_SOURCE_CORPUS_FIELDS = ['label', 'form', 'source_type', 'license', 'attribution', 'is_official'];

/**
 * Ab wie vielen Objekten eine Aenderung am Korpus rueckgefragt wird.
 *
 * ⭐ Dieselbe Zahl wie beim Bearbeiten einer Katalogzeile (`AVESMAPS_FEATURE_SOURCE_CONFIRM_THRESHOLD`)
 * und aus demselben Grund: eine Umbenennung trifft JEDEN Beleg dieses Wirts auf einmal.
 * ⚠️ Bewusst eine eigene Konstante -- die zwei Schwellen beschreiben verschiedene Dinge und
 * duerfen unabhaengig wandern; gleich sind sie heute, nicht per Gesetz.
 */
const AVESMAPS_SOURCE_CORPUS_CONFIRM_THRESHOLD = 10;

/**
 * Einen Korpus anlegen oder aendern. Gibt den gespeicherten Stand zurueck.
 *
 * 🔴 GESCHRIEBEN WIRD NUR, WAS DER AUFRUFER NENNT. Ein vollstaendig mitgeschicktes Formular
 * machte jede gewollte Ausnahme platt -- dieselbe Regel wie beim Bearbeiten einer Quelle und
 * bei der Weg-Ebene, und `avesmapsUpsertGameLiterature` ist genau daran schon einmal gescheitert.
 *
 * 💣 UND ES WIRD ZURUECKGELESEN. Eine stille MySQL-Kuerzung ist von „nichts wurde gespeichert"
 * nicht zu unterscheiden -- der Speichern-Knopf der Tempowerte tat deshalb wochenlang nichts
 * (AGENTS.md §10). Ein Schreiber, dessen Wert zaehlt, liest ihn zurueck.
 *
 * @param array<string,mixed> $felder nur die angefassten Felder
 * @return array{ok:bool, corpus?:array, error?:array}
 */
function avesmapsSourceCorpusSave(PDO $pdo, string $corpusKey, array $felder, int $userId = 0, bool $confirm = false): array
{
    $fehler = static fn(int $status, string $code, string $message, array $extra = []): array =>
        ['ok' => false, 'error' => ['status' => $status, 'code' => $code, 'message' => $message] + $extra];

    $corpusKey = trim($corpusKey);
    if ($corpusKey === '' || $corpusKey !== avesmapsSourceCorpusKey('https://' . $corpusKey . '/')) {
        // 💣 Der Schluessel wird gegen die EIGENE Regel geprueft, nicht bloss auf „nicht leer".
        // Sonst legte ein Tippfehler (`www.herzogtum-weiden.net`) einen zweiten Korpus an, den
        // nie wieder jemand trifft -- die Adresse loest ihn ja auf `herzogtum-weiden.net` auf.
        return $fehler(400, 'invalid_corpus_key', 'Das ist kein gueltiger Korpusschluessel: ' . $corpusKey);
    }

    $unbekannt = array_diff(array_keys($felder), AVESMAPS_SOURCE_CORPUS_FIELDS);
    if ($unbekannt !== []) {
        return $fehler(400, 'invalid_request', 'Unbekanntes Feld: ' . implode(', ', $unbekannt));
    }
    if ($felder === []) {
        return $fehler(400, 'invalid_request', 'Es wurde kein Feld angefasst.');
    }

    avesmapsEnsureSourceCorpusTable($pdo);
    $reichweite = avesmapsSourceCorpusUsage($pdo, $corpusKey);
    // 🔴 Die Rueckfrage ist ein EIGENER Schluessel, kein Rueckschluss aus dem Wert -- dieselbe Form
    // wie `source_type_chosen` und `confirm_catalog`. Ein alter Client, der ihn nicht kennt, darf
    // einen weit zitierten Korpus nicht unbemerkt umbenennen.
    if (!$confirm && $reichweite['objects'] >= AVESMAPS_SOURCE_CORPUS_CONFIRM_THRESHOLD) {
        return $fehler(409, 'corpus_confirm_required',
            'Diese Aenderung gilt fuer alle ' . $reichweite['objects'] . ' Objekte dieses Korpus.',
            ['objects' => $reichweite['objects'], 'sources' => $reichweite['sources']]);
    }

    $spalten = [];
    $werte = ['k' => $corpusKey];
    foreach ($felder as $name => $wert) {
        if ($name === 'form') {
            $wert = avesmapsSourceCorpusNormalizeForm((string) $wert);
        } elseif ($name === 'is_official') {
            $wert = $wert === true || $wert === 1 || $wert === '1' ? 1 : 0;
        } elseif ($name === 'source_type') {
            // ⚠️ Dieselbe Weisse Liste wie an der Quelle -- sonst traegt der Korpus eine Art, die
            // es an keiner Quelle geben kann.
            $wert = avesmapsNormalizeSourceType((string) $wert);
        } elseif ($name === 'license') {
            $wert = avesmapsNormalizeSourceLicense((string) $wert);
        } else {
            $wert = avesmapsNormalizeSingleLine((string) $wert, 200);
        }
        $spalten[$name] = $wert;
        $werte[$name] = $wert;
    }

    $vorhanden = $pdo->prepare('SELECT corpus_key FROM source_corpus WHERE corpus_key = :k LIMIT 1');
    $vorhanden->execute(['k' => $corpusKey]);
    if ($vorhanden->fetchColumn() === false) {
        $namen = array_keys($spalten);
        $pdo->prepare(
            'INSERT INTO source_corpus (corpus_key, ' . implode(', ', $namen) . ')
             VALUES (:k, :' . implode(', :', $namen) . ')'
        )->execute($werte);
    } else {
        $setzen = [];
        foreach (array_keys($spalten) as $name) {
            $setzen[] = $name . ' = :' . $name;
        }
        $pdo->prepare('UPDATE source_corpus SET ' . implode(', ', $setzen) . ' WHERE corpus_key = :k')->execute($werte);
    }

    // 💣 ZURUECKLESEN, nicht glauben.
    $alle = avesmapsSourceCorpusReadAll($pdo);
    if (!isset($alle[$corpusKey])) {
        return $fehler(500, 'corpus_not_stored', 'Der Korpus liess sich nicht speichern.');
    }
    foreach ($spalten as $name => $erwartet) {
        $ist = $alle[$corpusKey][$name] ?? null;
        if ($name === 'is_official') {
            $ist = $ist === true ? 1 : 0;
        }
        if ((string) $ist !== (string) $erwartet) {
            return $fehler(500, 'corpus_not_stored',
                'Das Feld „' . $name . '" kam nicht so an, wie es geschickt wurde.');
        }
    }

    return ['ok' => true, 'corpus' => $alle[$corpusKey] + $reichweite];
}

/**
 * Wie weit reicht ein Korpus: wie viele Katalogzeilen, an wie vielen Objekten.
 *
 * 🔴 GERECHNET, NICHT GESPEICHERT -- wie der Schluessel selbst. Es gibt keine Zaehlerspalte, die
 * mit der Wirklichkeit auseinanderlaufen koennte.
 *
 * 💣 Und der Vergleich laeuft ueber `avesmapsSourceCorpusKey`, NICHT ueber ein `LIKE '%domain%'`.
 * Ein LIKE traefe auch eine Adresse, die den Namen bloss im Pfad fuehrt
 * (`fremd.example/artikel/herzogtum-weiden.net`), und es waere eine ZWEITE Fassung der
 * Schluesselregel -- genau die Divergenz, die dieses Haus schon mehrfach bezahlt hat.
 * ⚠️ Der Preis ist eine Volltabellenabfrage ueber `sources` (1.376 Zeilen live, nur id + url).
 * Sie laeuft nur, wenn ein Editor eine Adresse prueft -- also auf Knopfdruck, nicht im Zeichenweg.
 *
 * @return array{sources:int, objects:int}
 */
function avesmapsSourceCorpusUsage(PDO $pdo, string $corpusKey): array
{
    if ($corpusKey === '') {
        return ['sources' => 0, 'objects' => 0];
    }
    try {
        $alle = $pdo->query("SELECT id, url FROM sources WHERE url <> ''");
        if ($alle === false) {
            return ['sources' => 0, 'objects' => 0];
        }
        $ids = [];
        foreach ($alle->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
            if (avesmapsSourceCorpusKey((string) $row['url']) === $corpusKey) {
                $ids[] = (int) $row['id'];
            }
        }
        if ($ids === []) {
            return ['sources' => 0, 'objects' => 0];
        }
        $platzhalter = implode(',', array_fill(0, count($ids), '?'));
        $zaehl = $pdo->prepare(
            "SELECT COUNT(*) FROM feature_sources
              WHERE status = 'approved' AND source_id IN (" . $platzhalter . ')'
        );
        $zaehl->execute($ids);

        return ['sources' => count($ids), 'objects' => (int) $zaehl->fetchColumn()];
    } catch (Throwable $fehler) {
        // ⚠️ Laut, nicht still: eine 0 sieht sonst aus wie „dieser Korpus ist neu".
        error_log('avesmapsSourceCorpusUsage: ' . $fehler->getMessage());

        return ['sources' => 0, 'objects' => 0];
    }
}

/**
 * Der Korpus zu einer Adresse — rein, ohne PDO, damit die Regel ohne Datenbank pruefbar ist.
 *
 * 🔴 Ein UNBEKANNTER Korpus ist kein Fehler: er bekommt seinen Schluessel als Beschriftung und die
 * Form `''`. Genau das ist der Zustand „neue Domain" aus §3.4 des Entwurfs -- der Editor sieht
 * `herzogtum-weiden.net` stehen und darf es ueberschreiben. Ohne diesen Fall muesste jede neue
 * Domain erst angelegt werden, bevor jemand eine Quelle eintragen kann.
 *
 * @param array<string,array> $corpora  aus avesmapsSourceCorpusReadAll()
 */
function avesmapsSourceCorpusForUrl(array $corpora, string $url): ?array
{
    $key = avesmapsSourceCorpusKey($url);
    if ($key === '') {
        return null; // URL-lose Quelle: ein Werk, das seinen Titel selbst traegt
    }
    if (isset($corpora[$key])) {
        return $corpora[$key];
    }

    return [
        'corpus_key' => $key,
        'label' => $key,
        'form' => '',
        'source_type' => '',
        'license' => '',
        'attribution' => '',
        'is_official' => false,
        'known' => false,
    ];
}
