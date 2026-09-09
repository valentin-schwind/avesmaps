<?php

declare(strict_types=1);

/**
 * Die einmalige Bestandsreparatur zum Ausbau von `properties.wiki_no_article` (Schritt 4 von vier).
 * Lauf (aus dem Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll \
 *       api/_internal/map/__tests__/wiki-merker-bereinigung-test.php
 *
 * ⚠️ ABLAUF, NICHT BAUER: gefahren wird `avesmapsWikiMerkerBereinigen` selbst, an einer echten
 * (SQLite-)Karte. Eine Probe am Quelltext saehe nicht, ob der Trockenlauf wirklich nichts schreibt --
 * und genau das ist die Zusicherung, an der ein Bestandslauf haengt.
 *
 * 🔴 DIE ERWARTETE ZAHL WIRD VOR DEM LAUF AUSGESPROCHEN (AGENTS.md §11, „der Trockenlauf ist die
 * Messung"): **7 Traeger -- 2 Orte, 5 Kraftliniensegmente, 0 inaktive**, live gezaehlt am
 * 09.09.2026 an der Kartennutzlast (Revision 119767). Weicht der echte Trockenlauf davon ab, wird
 * gemessen statt gefahren -- 1070 statt der erwarteten ~50 haben beim Wegquellen-Lauf eine ganze
 * fremde Datenklasse entlarvt.
 * 🪤 Hier stand „10", die Zahl aus dem Dump vom Vortag; vier Traeger hatten ihren Merker inzwischen
 * durch eine Zuweisung verloren. Eine gegengehaltene Zahl ist nur so gut wie ihre Frische.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

require __DIR__ . '/../../bootstrap.php';
require __DIR__ . '/../features.php';
require __DIR__ . '/../wiki-merker-bereinigung.php';

/**
 * Die MySQL-eigene Anweisung im Revisions-Zaehler, an der TREIBER-Naht uebersetzt statt die Funktion
 * nachzubauen -- sonst prueft der Test eine Kopie und nicht den Code, der live laeuft.
 */
final class AvesmapsMerkerBereinigungTestPdo extends PDO
{
    /** Wie oft `map_revision` angefasst wurde -- der Trockenlauf darf das NIE. */
    public int $revisionsBumps = 0;

    public function exec(string $statement): int|false
    {
        if (str_contains($statement, 'ON DUPLICATE KEY UPDATE revision = revision + 1')) {
            $this->revisionsBumps++;
            $statement = 'INSERT INTO map_revision (id, revision) VALUES (1, 2)
                          ON CONFLICT(id) DO UPDATE SET revision = map_revision.revision + 1';
        }

        return parent::exec($statement);
    }
}

$pdo = new AvesmapsMerkerBereinigungTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE map_features (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT, name TEXT, feature_type TEXT, feature_subtype TEXT,
    geometry_type TEXT, geometry_json TEXT, properties_json TEXT,
    is_active INTEGER DEFAULT 1, revision INTEGER DEFAULT 0, updated_at TEXT
)');
$pdo->exec('CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER)');

/** Setzt die Karte auf einen bekannten Bestand zurueck. */
$seed = static function (PDO $pdo): void {
    $pdo->exec('DELETE FROM map_features');
    $pdo->exec('DELETE FROM map_revision');
    $insert = $pdo->prepare(
        'INSERT INTO map_features (public_id, name, feature_type, properties_json, is_active, revision, updated_at)
         VALUES (?, ?, ?, ?, ?, 7, ?)'
    );
    $zeilen = [
        // public_id, name, art, properties, aktiv
        ['loc-1', 'Ochsenweide', 'location', ['name' => 'Ochsenweide', 'wiki_no_article' => true], 1],
        ['loc-2', 'Auengrund', 'location', ['name' => 'Auengrund', 'wiki_no_article' => true, 'einwohner' => '120'], 1],
        ['pl-1', 'Drachenblick', 'powerline', ['name' => 'Drachenblick', 'wiki_no_article' => true], 1],
        // 🔴 Eine WEICH GELOESCHTE Zeile -- sie wird mitgeraeumt (siehe Kopf der Bibliothek).
        ['pl-2', 'Drachenblick', 'powerline', ['name' => 'Drachenblick', 'wiki_no_article' => true], 0],
        // 🔴 Der Merker als `false` -- auch das ist ein Schluessel und faellt.
        ['lab-1', 'Farindel', 'label', ['text' => 'Farindel', 'wiki_no_article' => false], 1],
        // 💣 DER VORFILTER-FEHLTREFFER: das Wort steht im TEXT, nicht als Schluessel. Diese Zeile
        // darf gezaehlt, aber NICHT angefasst werden.
        ['loc-3', 'Testort', 'location', ['name' => 'Testort', 'description' => 'siehe wiki_no_article im Handbuch'], 1],
        // Eine ganz unbeteiligte Zeile.
        ['loc-4', 'Havena', 'location', ['name' => 'Havena', 'wiki_settlement' => ['wiki_key' => 'havena']], 1],
    ];
    foreach ($zeilen as [$publicId, $name, $art, $props, $aktiv]) {
        $insert->execute([$publicId, $name, $art, json_encode((object) $props, JSON_UNESCAPED_UNICODE), $aktiv, '2026-01-01 00:00:00']);
    }
};

/** Alle Zeilen als public_id => [merker(bool|null), revision, updated_at]. */
$karte = static function (PDO $pdo): array {
    $rows = $pdo->query('SELECT public_id, properties_json, revision, updated_at FROM map_features')->fetchAll(PDO::FETCH_ASSOC);
    $out = [];
    foreach ($rows as $row) {
        $props = json_decode((string) $row['properties_json'], true);
        $props = is_array($props) ? $props : [];
        $out[(string) $row['public_id']] = [
            'hat_merker' => array_key_exists('wiki_no_article', $props),
            'props' => $props,
            'revision' => (int) $row['revision'],
            'updated_at' => (string) $row['updated_at'],
        ];
    }

    return $out;
};

/**
 * Legt EINE Zeile mit einer bestimmten rohen Ablage an -- fuer die Abschnitte, die es auf die
 * genaue Schreibweise des gespeicherten JSON abgesehen haben.
 * ⚠️ Bewusst neben `$seed`: dieselbe Tabelle, andere Frage. `$seed` baut einen Bestand, das hier
 * baut eine FORM.
 */
$einfuegen = $pdo->prepare(
    'INSERT INTO map_features (public_id, name, feature_type, properties_json, is_active, revision, updated_at)
     VALUES (?, ?, \'location\', ?, 1, 7, \'2026-01-01 00:00:00\')'
);

// ── 1) DER TROCKENLAUF ZAEHLT UND SCHREIBT NICHTS ─────────────────────────────────────────────
// 🔴 Die tragende Zusicherung eines Bestandslaufs. Ein Trockenlauf, der doch schreibt, ist die
// gefaehrlichste Bauform ueberhaupt: man faehrt ihn, weil man SEHEN will, was passiert.
$seed($pdo);
$vorher = $karte($pdo);
$pdo->revisionsBumps = 0;
$probe = avesmapsWikiMerkerBereinigen($pdo, true);
assert($probe['ok'] === true);
assert($probe['dry_run'] === true);
// FUENF echte Traeger (drei aktive Merker, ein weich geloeschter, ein `false`) -- nicht sechs.
assert($probe['total'] === 5, 'der Trockenlauf zaehlt falsch: ' . var_export($probe['total'], true));
assert($probe['done'] === 0, 'der Trockenlauf hat geschrieben');
assert($probe['remaining'] === 5);
assert($probe['revision'] === null, 'der Trockenlauf hat eine Revision gezogen');
assert($pdo->revisionsBumps === 0, 'der Trockenlauf hat map_revision angefasst');
assert($karte($pdo) == $vorher, 'der Trockenlauf hat die Karte veraendert');

// 💣 DER VORFILTER-FEHLTREFFER IST GEZAEHLT, ABER NICHT GEMEINT. `like_treffer` ist 6, `total` ist 5
// -- die Differenz ist die Zeile, die das Wort nur im Text traegt. Ohne diese Trennung raeumte der
// Lauf einer Beschreibung ihren Inhalt weg, und niemand saehe es.
assert($probe['like_treffer'] === 6, 'der Vorfilter trifft anders als erwartet: ' . var_export($probe['like_treffer'], true));
assert($probe['total'] < $probe['like_treffer'], 'Vorfilter und Treffer sind dasselbe -- die Probe misst nichts');

// Die Aufschluesselung, an der der echte Lauf gegen die erwartete Zahl gehalten wird.
assert($probe['per_type'] === ['location' => 2, 'powerline' => 2, 'label' => 1],
    'die Aufschluesselung stimmt nicht: ' . json_encode($probe['per_type']));
assert($probe['inactive'] === 1, 'die weich geloeschte Zeile wird nicht als solche gemeldet');
assert(count($probe['sample']) === 5, 'die Stichprobe fehlt');

// ── 2) SCHARF: DER SCHLUESSEL FAELLT, DIE NACHBARN BLEIBEN ────────────────────────────────────
$seed($pdo);
$pdo->revisionsBumps = 0;
$lauf = avesmapsWikiMerkerBereinigen($pdo, false);
assert($lauf['done'] === 5, 'nicht alle Traeger geraeumt: ' . var_export($lauf['done'], true));
assert($lauf['failed'] === [], 'Fehlschlaege: ' . json_encode($lauf['failed']));
assert($lauf['remaining'] === 0, 'es bleibt etwas uebrig');
$nachher = $karte($pdo);
foreach (['loc-1', 'loc-2', 'pl-1', 'pl-2', 'lab-1'] as $id) {
    assert($nachher[$id]['hat_merker'] === false, "\"$id\" traegt den Merker noch");
}
// ⚠️ Und die uebrigen Eigenschaften ueberleben -- der Merker ist ein Schluessel IN der Ablage, nicht
// die Ablage. Ohne diese Zeile koennte der Lauf `properties_json` auf `{}` setzen und waere gruen.
assert($nachher['loc-2']['props'] === ['name' => 'Auengrund', 'einwohner' => '120'],
    'die Nachbar-Eigenschaften sind mitgegangen: ' . json_encode($nachher['loc-2']['props']));
assert($nachher['loc-1']['props'] === ['name' => 'Ochsenweide']);

// 💣 DIE ZEILE MIT DEM WORT IM TEXT IST UNANGETASTET -- Zeichen fuer Zeichen.
assert($nachher['loc-3']['props'] === ['name' => 'Testort', 'description' => 'siehe wiki_no_article im Handbuch'],
    'der Vorfilter-Fehltreffer wurde angefasst: ' . json_encode($nachher['loc-3']['props']));
assert($nachher['loc-3']['revision'] === 7, 'der Fehltreffer bekam eine neue Revision');
assert($nachher['loc-4']['props'] === ['name' => 'Havena', 'wiki_settlement' => ['wiki_key' => 'havena']],
    'eine unbeteiligte Zeile wurde angefasst');
assert($nachher['loc-4']['revision'] === 7, 'eine unbeteiligte Zeile bekam eine neue Revision');

// ── 3) EIN Revisions-Bump fuer den GANZEN Lauf, nicht einer je Zeile ──────────────────────────
// 💣 Fuenf Bumps waeren fuenf ungueltige Kartennutzlasten fuer jeden warmen Besucher statt einer.
assert($pdo->revisionsBumps === 1, 'nicht genau ein Revisions-Bump: ' . $pdo->revisionsBumps);
assert(is_int($lauf['revision']) && $lauf['revision'] > 0, 'die Revision wird nicht gemeldet');
$revisionen = array_unique(array_map(
    static fn (string $id): int => $nachher[$id]['revision'],
    ['loc-1', 'loc-2', 'pl-1', 'pl-2', 'lab-1']
));
assert(count($revisionen) === 1, 'die geschriebenen Zeilen tragen verschiedene Revisionen');
assert((int) reset($revisionen) === $lauf['revision'], 'die gemeldete Revision steht nicht an den Zeilen');

// ── 4) `updated_at` BLEIBT STEHEN ─────────────────────────────────────────────────────────────
// 🔴 Die Spalte beantwortet „wann hat zuletzt jemand etwas entschieden" -- eine Wartungsreparatur
// ist das nicht. Dieselbe Regel wie bei `repair_geometry_bounds`.
foreach (['loc-1', 'loc-2', 'pl-1', 'pl-2', 'lab-1'] as $id) {
    assert($nachher[$id]['updated_at'] === '2026-01-01 00:00:00',
        "\"$id\" hat einen neuen Zeitstempel bekommen: " . $nachher[$id]['updated_at']);
}

// ── 5) DER LAUF IST WIEDERHOLBAR, UND DER ZWEITE FASST map_revision NICHT AN ──────────────────
// ⚠️ Genau so wird die Gegenprobe gefahren („0 verbleibende Traeger"), und sie darf nichts kosten.
$pdo->revisionsBumps = 0;
$zweiter = avesmapsWikiMerkerBereinigen($pdo, false);
assert($zweiter['total'] === 0, 'der zweite Lauf findet noch Traeger: ' . $zweiter['total']);
assert($zweiter['done'] === 0 && $zweiter['failed'] === []);
assert($zweiter['revision'] === null, 'ein Lauf ohne Arbeit meldet eine Revision');
assert($pdo->revisionsBumps === 0,
    'ein Lauf ohne Arbeit bumpt die Revision -- die Gegenprobe kostete dann jedem warmen Besucher die Nutzlast');

// ── 6) DER DECKEL GREIFT ──────────────────────────────────────────────────────────────────────
// ⚠️ `remaining` sagt, wie viel noch aussteht -- daran erkennt der Owner, dass ein zweiter Lauf noetig ist.
$seed($pdo);
$gedeckelt = avesmapsWikiMerkerBereinigen($pdo, false, 2);
assert($gedeckelt['done'] === 2, 'der Deckel greift nicht: ' . $gedeckelt['done']);
assert($gedeckelt['total'] === 5);
assert($gedeckelt['remaining'] === 3, 'remaining rechnet falsch: ' . $gedeckelt['remaining']);
$rest = avesmapsWikiMerkerBereinigen($pdo, true);
assert($rest['total'] === 3, 'nach dem gedeckelten Lauf stehen nicht drei Traeger aus');

// ── 7) EIN FEHLSCHLAG WIRD GEMELDET, NICHT GESCHLUCKT ─────────────────────────────────────────
// 💣 Ein verschluckter SQL-Fehler saehe exakt aus wie „nichts zu bereinigen" -- und dieser Bericht
// IST die Abnahme des Laufs.
// 🪤 ERZWUNGEN UEBER EINEN TRIGGER, NICHT UEBER EINE KAPUTTE ANWEISUNG. Der erste Anlauf liess
// `prepare()` eine Anweisung mit unbekannter Spalte bauen -- SQLite prueft das SOFORT, die Ausnahme
// flog am `try` des Laufs vorbei (der `prepare` steht VOR der Schleife), und der Test starb, statt
// etwas zu messen. Ein Trigger bereitet sauber vor und wirft erst beim Schreiben, also genau dort,
// wo der Lauf ihn auffangen soll.
// ⚠️ Nebenbefund, benannt statt versteckt: ein fehlgeschlagenes `prepare` (fehlende Tabelle) reisst
// den ganzen Lauf ab, statt ihn Zeile fuer Zeile melden zu lassen. Das ist vertretbar -- eine
// fehlende `map_features` ist kein Datenfall, sondern ein kaputter Server --, aber es ist eine
// andere Zusicherung als die hier.
$seed($pdo);
$pdo->exec('CREATE TRIGGER schreibsperre BEFORE UPDATE ON map_features
            BEGIN SELECT RAISE(ABORT, \'schreibgesperrt fuer die Probe\'); END');
$pdo->revisionsBumps = 0;
$kaputt = avesmapsWikiMerkerBereinigen($pdo, false, 1);
$pdo->exec('DROP TRIGGER schreibsperre');
assert($kaputt['done'] === 0, 'der Fehlschlag wurde als Erfolg gezaehlt');
assert(count($kaputt['failed']) === 1, 'der Fehlschlag wurde geschluckt: ' . json_encode($kaputt['failed']));
assert($kaputt['failed'][0]['public_id'] === 'loc-1', 'der Bericht nennt das falsche Objekt');
assert(str_contains($kaputt['failed'][0]['error'], 'schreibgesperrt'),
    'der Fehlschlag traegt nicht die echte Begruendung: ' . $kaputt['failed'][0]['error']);
assert($kaputt['remaining'] === 5, 'remaining verschweigt den Fehlschlag: ' . $kaputt['remaining']);
// ⚠️ Und die Transaktion steht nicht offen -- sonst haengte die naechste Zeile an einer Sperre.
assert($pdo->inTransaction() === false, 'nach dem Fehlschlag steht eine Transaktion offen');
// 🔴 Der Traeger steht unveraendert da: ein zurueckgerollter Schreibvorgang darf nichts halb tun.
assert($karte($pdo)['loc-1']['hat_merker'] === true, 'der Rollback hat nicht zurueckgerollt');

// ── 8) 🔴 DIE ARCHIVE WERDEN NICHT ANGEFASST ──────────────────────────────────────────────────
// Ein Protokoll ist ein Archiv, sonst waere es keins (Owner-Entscheid 09.09.2026). Gemessen am
// kommentarfreien Quelltext: die Bibliothek nennt AUSSCHLIESSLICH `map_features` und `map_revision`.
$code = '';
foreach (token_get_all((string) file_get_contents(__DIR__ . '/../wiki-merker-bereinigung.php')) as $stueck) {
    if (is_array($stueck)) {
        if ($stueck[0] === T_COMMENT || $stueck[0] === T_DOC_COMMENT) {
            continue;
        }
        $code .= $stueck[1];
        continue;
    }
    $code .= $stueck;
}
// Gegenprobe gegen einen leeren Leser -- sonst erfuellt eine leere Zeichenkette jedes „kommt nicht vor".
assert(str_contains($code, 'avesmapsWikiMerkerBereinigen'), 'der Tokenizer liefert nichts -- Abschnitt 8 waere ein Vakuum');
foreach (['wiki_sync_cases', 'map_feature_legacy_properties', 'map_audit_log', 'citymap', 'ecosystem_region'] as $archiv) {
    assert(
        !str_contains($code, $archiv),
        "die Bereinigung nennt `$archiv` -- Archive und fremde Ablagen bleiben unberuehrt "
        . '(Owner-Entscheid 09.09.2026), und `citymap.no_article` ist ein anderes Feld'
    );
}

// ── 8b) 💣 EINE MYSQL-REGEL, DIE DIESER TEST GAR NICHT FAHREN KANN ────────────────────────────
// `map_features.updated_at` traegt `ON UPDATE CURRENT_TIMESTAMP(3)` (api/_internal/map/features.php,
// DDL). Auf MySQL ist `updated_at = updated_at` im UPDATE deshalb TRAGEND: die ausdrueckliche
// Zuweisung unterdrueckt die Automatik. SQLite kennt kein `ON UPDATE` -- streicht jemand die Zeile,
// bleibt Abschnitt 4 oben GRUEN, und live wandern die Zeitstempel aller Traeger trotzdem.
// 🔴 Deshalb hier eine QUELLTEXT-Probe neben der Ablauf-Probe, und sie ist als solche benannt. Das
// ist dieselbe Klasse wie Error 1093 (AGENTS.md §9), nur andersherum: dort ERZWANG eine
// SQLite-Fixture eine MySQL-Regression, hier VERSTECKT sie eine.
// ⚠️ Warum der Zeitstempel ueberhaupt stehenbleiben muss: er beantwortet „wann hat zuletzt jemand
// etwas entschieden". Eine Wartungsreparatur ist keine Entscheidung -- dieselbe Regel und dasselbe
// Mittel wie in `avesmapsPoliticalRepairGeometryBounds`.
$libRoh = (string) file_get_contents(__DIR__ . '/../wiki-merker-bereinigung.php');
$lib = '';
foreach (token_get_all($libRoh) as $stueck) {
    if (is_array($stueck)) {
        if ($stueck[0] === T_COMMENT || $stueck[0] === T_DOC_COMMENT) {
            continue;
        }
        $lib .= $stueck[1];
        continue;
    }
    $lib .= $stueck;
}
// Gegenprobe gegen einen leeren Leser -- sonst erfuellt eine leere Zeichenkette jede Suche.
assert(str_contains($lib, 'UPDATE map_features'), 'der Tokenizer liefert nichts -- Abschnitt 8b waere ein Vakuum');
// ⭐ Verglichen wird die GANZE SET-Klausel, nicht ein Teilmuster: so faellt sowohl ein FEHLENDES
// `updated_at = updated_at` auf als auch ein ausdruecklich gesetzter Zeitstempel -- und dazu jede
// dritte Spalte, die jemand hier unbemerkt mitschreiben liesse.
// 🪤 Der erste Anlauf prueft das mit `updated_at\s*=\s*(?!updated_at)` und war ROT, obwohl der Code
// stimmte: `\s*` darf LEER matchen, dann steht der Lookahead auf dem Leerzeichen vor `updated_at`
// und schlaegt an. Eine Zusicherung, die man erst „hinbiegen" muss, misst am Ende etwas anderes als
// gedacht -- der ganze Vergleich ist schaerfer UND einfacher.
assert(
    preg_match('/UPDATE map_features\s+SET\s+(.+?)\s+WHERE/s', $lib, $setKlausel) === 1,
    'die SET-Klausel des UPDATE laesst sich nicht isolieren -- die Zusicherung waere blind'
);
$setNormalisiert = preg_replace('/\s+/', ' ', trim($setKlausel[1]));
assert(
    $setNormalisiert === 'properties_json = :pj, revision = :rev, updated_at = updated_at',
    "die SET-Klausel ist eine andere als erwartet -- gefunden: \"$setNormalisiert\".\n"
    . '  Erwartet: `properties_json = :pj, revision = :rev, updated_at = updated_at`. Fehlt die '
    . 'letzte Zuweisung, wandern auf MySQL die Zeitstempel aller Traeger (ON UPDATE '
    . 'CURRENT_TIMESTAMP), und dieser Test kann das auf SQLite NICHT sehen.'
);

// ── 8c) 💣 DIE WEITE JSON-FORM -- die Form, in der der Bestand WIRKLICH steht ─────────────────
// 🔴 DER TEUERSTE BEFUND DIESES SCHRITTS, und er war unsichtbar, weil JEDE Fixture oben in der
// engen Form steht (`{"a":"b"}`). Am Dump vom 08.09.2026 gezaehlt: **10.029 von 43.807** Ablagen
// stehen in der WEITEN Form (`{"a": "b"}`, Leerzeichen nach `:` und `,`) -- die `json_encode` NIE
// erzeugt --, darunter **5 der 11 Traeger**.
// 💣 Ein Riegel, der den neu kodierten String BYTE-GENAU gegen den gespeicherten haelt, lehnt diese
// Zeilen also ab. Genau so stand er hier, und der Lauf haette die Mehrheit seiner Arbeit verweigert:
// „Gegenprobe 0 verbleibende Traeger" waere nie erreichbar gewesen. Kein Test hat es gezeigt.
// ⭐ Deshalb steht die weite Form jetzt in dieser Fixture, und zwar mit allem, was der naheliegende
// Regex-Flicken zerschneiden wuerde: einem Leerzeichen INNERHALB einer Zeichenkette nach einem
// Doppelpunkt und nach einem Komma.
$pdo->exec('DELETE FROM map_features');
$pdo->exec('DELETE FROM map_revision');
$weiteFormen = [
    'w-1' => ['{"name": "Ochsenweide (am Bodrin)", "feature_type": "location", "wiki_no_article": true}',
              '{"name":"Ochsenweide (am Bodrin)","feature_type":"location"}'],
    'w-2' => ['{"wiki_no_article": true, "beschreibung": "Ein Satz: mit Doppelpunkt, und Komma."}',
              '{"beschreibung":"Ein Satz: mit Doppelpunkt, und Komma."}'],
];
foreach ($weiteFormen as $publicId => [$vorher, $_]) {
    $einfuegen->execute([$publicId, $publicId, $vorher]);
}
$weitLauf = avesmapsWikiMerkerBereinigen($pdo, false);
assert(
    $weitLauf['done'] === 2,
    'die weite JSON-Form wird abgelehnt -- ' . $weitLauf['done'] . ' von 2 geschrieben, Fehlschlaege: '
    . json_encode($weitLauf['failed'])
);
$weitGespeichert = [];
foreach ($pdo->query('SELECT public_id, properties_json FROM map_features')->fetchAll(PDO::FETCH_ASSOC) as $row) {
    $weitGespeichert[(string) $row['public_id']] = (string) $row['properties_json'];
}
foreach ($weiteFormen as $publicId => [$vorher, $soll]) {
    // ⚠️ Die Ablage wird dabei in die ENGE Form ueberfuehrt -- das ist gewollt und harmlos: der
    // Inhalt ist derselbe, und jeder Leser dekodiert ohnehin. Was NICHT passieren darf, ist ein
    // Verlust IM Inhalt, und genau das misst der Vergleich.
    assert(
        $weitGespeichert[$publicId] === $soll,
        "\"$publicId\": aus der weiten Form ist etwas anderes geworden als erwartet.\n"
        . "  vorher:   $vorher\n  erwartet: $soll\n  bekommen: " . $weitGespeichert[$publicId]
    );
    // 💣 Und der Text INNERHALB der Zeichenketten ist unangetastet -- der Regex-Flicken, der
    // Leerraum nach `:` und `,` wegwirft, haette hier hineingeschnitten.
    $entschluesselt = json_decode($weitGespeichert[$publicId], true);
    foreach ((array) json_decode($vorher, true) as $schluessel => $wert) {
        if ($schluessel === 'wiki_no_article') {
            continue;
        }
        assert($entschluesselt[$schluessel] === $wert,
            "\"$publicId\": der Wert von \"$schluessel\" hat sich veraendert");
    }
}

// ── 8d) 💣 EIN VERLORENER SCHREIBVORGANG WIRD GEMELDET, NICHT VERURSACHT ──────────────────────
// 🔴 Der Lauf liest ALLE Zeilen in EINEM SELECT vor der Schleife und schreibt danach die GANZE
// Ablage aus diesem Schnappschuss zurueck. Speichert ein Editor waehrenddessen dasselbe Objekt,
// machte der Lauf dessen Aenderung wortlos rueckgaengig -- und meldete Erfolg. Vorgefuehrt von
// einem Pruefagenten an einer echten Fixture; der Riegel ist `AND revision = :erwartet` plus die
// Pruefung von `rowCount()`.
// 💣 DIE NAHT LIEGT ZWISCHEN SELECT UND UPDATE, und von aussen ist sie nicht erreichbar -- ein
// `UPDATE` vor dem Aufruf aendert nur den Schnappschuss, den der Lauf dann liest (so stand diese
// Probe zuerst da und bewies nichts). Gebraucht wird ein PDO, das GENAU an dieser Naht dazwischenfunkt.
final class AvesmapsMerkerFremdschreiberPdo extends PDO
{
    public bool $hatDazwischengefunkt = false;

    public function query(string $query, ?int $fetchMode = null, mixed ...$args): PDOStatement|false
    {
        $ergebnis = parent::query($query);
        // Nach dem Schnappschuss des Laufs -- und nur einmal -- schreibt ein Fremder dieselbe Zeile.
        if (!$this->hatDazwischengefunkt && str_contains($query, 'wiki_no_article')) {
            $this->hatDazwischengefunkt = true;
            parent::exec(
                'UPDATE map_features SET revision = revision + 1,'
                . ' properties_json = \'{"name":"V","einwohner":"4711","wiki_no_article":true}\''
                . ' WHERE public_id = \'v-1\''
            );
        }

        return $ergebnis;
    }

    public function exec(string $statement): int|false
    {
        if (str_contains($statement, 'ON DUPLICATE KEY UPDATE revision = revision + 1')) {
            $statement = 'INSERT INTO map_revision (id, revision) VALUES (1, 2)
                          ON CONFLICT(id) DO UPDATE SET revision = map_revision.revision + 1';
        }

        return parent::exec($statement);
    }
}
$fremd = new AvesmapsMerkerFremdschreiberPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$fremd->exec('CREATE TABLE map_features (
    id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, name TEXT, feature_type TEXT,
    properties_json TEXT, is_active INTEGER DEFAULT 1, revision INTEGER DEFAULT 0, updated_at TEXT
)');
$fremd->exec('CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
$fremd->exec("INSERT INTO map_features (public_id, name, feature_type, properties_json, is_active, revision, updated_at)
    VALUES ('v-1', 'V', 'location', '{\"name\":\"V\",\"wiki_no_article\":true}', 1, 7, '2026-01-01 00:00:00')");

$verloren = avesmapsWikiMerkerBereinigen($fremd, false);
assert($fremd->hatDazwischengefunkt, 'die Probe hat gar nicht dazwischengefunkt -- sie misst nichts');
// 🔴 DER LAUF SCHREIBT NICHT, ER MELDET.
assert($verloren['done'] === 0,
    'der Lauf hat die fremde Speicherung ueberschrieben und Erfolg gemeldet');
assert(count($verloren['failed']) === 1, 'der verlorene Schreibvorgang wurde nicht gemeldet');
assert(str_contains($verloren['failed'][0]['error'], 'jemand anderem geschrieben'),
    'die Meldung nennt den Grund nicht: ' . $verloren['failed'][0]['error']);
// ⚠️ Und die fremde Eigenschaft steht unversehrt da -- das ist der eigentliche Schaden, den der
// Riegel verhindert.
$vNachher = json_decode((string) $fremd->query("SELECT properties_json FROM map_features WHERE public_id = 'v-1'")->fetchColumn(), true);
assert(($vNachher['einwohner'] ?? null) === '4711',
    'die fremde Speicherung ist weg: ' . json_encode($vNachher));
// ⚠️ Der Merker steht dann natuerlich noch -- ein zweiter Lauf holt die Zeile. Genau das sagt
// `remaining`, und genau dafuer ist der Lauf wiederholbar.
assert(array_key_exists('wiki_no_article', $vNachher), 'die Zeile wurde doch angefasst');
assert($verloren['remaining'] === 1, 'remaining verschweigt die uebersprungene Zeile');
// 💣 UND DER KARTENSTEMPEL BLEIBT UNANGETASTET: geschrieben wurde nichts.
assert($verloren['revision'] === null, 'ein Lauf ohne Schreibvorgang meldet eine Revision');

// ── 8e) 💣 UND DIE ZWEITE VERTEIDIGUNGSLINIE: DAS RESTRENNEN ─────────────────────────────────
// 🔴 Der Vorabgleich (8d) faengt die fremde Speicherung, solange sie VOR ihm passiert. Zwischen ihm
// und dem UPDATE bleibt ein Fenster -- dafuer ist `AND revision = :erwartet` samt `rowCount()` da.
// 🪤 EINE MUTATIONSPROBE HAT GEZEIGT, DASS DIESE LINIE UNGEPRUEFT WAR: `rowCount()` liess sich
// abschalten, ohne dass ein Test rot wurde, weil der Vorabgleich in jedem bisherigen Fall vorher
// zuschlug. Eine zweite Reihe, die nie gefahren wird, ist keine zweite Reihe.
// ⭐ Nachgebaut ueber `PDO::ATTR_STATEMENT_CLASS`: die Anweisung, die den Vorabgleich ausfuehrt,
// schiebt danach selbst die Revision weiter -- genau die Naht, die von aussen nicht erreichbar ist.
final class AvesmapsMerkerRestrennenStatement extends PDOStatement
{
    public static bool $hatZugeschlagen = false;

    private function __construct(private PDO $wirt) {}

    public function execute(?array $params = null): bool
    {
        $ergebnis = parent::execute($params);
        // Nur beim Vorabgleich, und nur einmal: der Fremde schreibt NACH der Pruefung.
        if (!self::$hatZugeschlagen && str_contains($this->queryString, 'SELECT revision FROM map_features')) {
            self::$hatZugeschlagen = true;
            $this->wirt->exec("UPDATE map_features SET revision = revision + 1 WHERE public_id = 'r-1'");
        }

        return $ergebnis;
    }
}
// Die uebersetzende Testklasse als Wirt -- ein blanker PDO kennt kein ON DUPLICATE KEY, und der
// Lauf scheiterte dann schon am Revisions-Zaehler statt am gemeinten Riegel.
$restrennen = new AvesmapsMerkerBereinigungTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$restrennen->exec('CREATE TABLE map_features (
    id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, name TEXT, feature_type TEXT,
    properties_json TEXT, is_active INTEGER DEFAULT 1, revision INTEGER DEFAULT 0, updated_at TEXT
)');
$restrennen->exec('CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
$restrennen->exec("INSERT INTO map_features (public_id, name, feature_type, properties_json, is_active, revision, updated_at)
    VALUES ('r-1', 'R', 'location', '{\"name\":\"R\",\"wiki_no_article\":true}', 1, 7, '2026-01-01 00:00:00')");
// ⚠️ Erst JETZT die Anweisungsklasse setzen -- sonst schlaegt sie schon beim Aufbau zu.
$restrennen->setAttribute(PDO::ATTR_STATEMENT_CLASS, [AvesmapsMerkerRestrennenStatement::class, [$restrennen]]);
AvesmapsMerkerRestrennenStatement::$hatZugeschlagen = false;

$rest = avesmapsWikiMerkerBereinigen($restrennen, false);
assert(AvesmapsMerkerRestrennenStatement::$hatZugeschlagen,
    'die Probe hat gar nicht dazwischengefunkt -- sie misst nichts');
assert($rest['done'] === 0, 'der Lauf hat trotz bewegter Zeile geschrieben');
assert(count($rest['failed']) === 1, 'das Restrennen wurde nicht gemeldet: ' . json_encode($rest['failed']));
assert(str_contains($rest['failed'][0]['error'], 'jemand anderem geschrieben'),
    'die Meldung nennt den Grund nicht: ' . $rest['failed'][0]['error']);
// 🔴 Und die Zeile ist unangetastet -- der Merker steht noch, ein zweiter Lauf holt sie.
$rNachher = (string) $restrennen->query("SELECT properties_json FROM map_features WHERE public_id = 'r-1'")->fetchColumn();
assert(str_contains($rNachher, 'wiki_no_article'), 'die Zeile wurde doch geschrieben: ' . $rNachher);

// ── 9) DIE VERDRAHTUNG DES ENDPUNKTS ──────────────────────────────────────────────────────────
// 💣 EINE REINE FUNKTION, DIE NIEMAND RICHTIG RUFT, IST GRUEN UND WIRKUNGSLOS -- und die
// Trockenlauf-Vorgabe entscheidet sich AM AUFRUF, nicht in der Bibliothek: `avesmapsWikiMerkerBereinigen`
// bekommt den Trockenlauf als PARAMETER. Ein Endpunkt, der `false` durchreicht, weil er `apply`
// falsch liest, macht aus jeder Vorschau einen Schreibvorgang.
// ⚠️ Textprobe, und sie ist als solche benannt: der Endpunkt braucht Sitzung, Konfiguration und
// PDO; hier laesst er sich nicht fahren. Sie beantwortet drei Fragen -- Riegel, Vorgabe, Aufruf.
$endpunktRoh = (string) file_get_contents(__DIR__ . '/../../../edit/admin/wiki-merker-bereinigung.php');
assert($endpunktRoh !== '', 'der Endpunkt ist nicht lesbar');
$endpunkt = '';
foreach (token_get_all($endpunktRoh) as $stueck) {
    if (is_array($stueck)) {
        if ($stueck[0] === T_COMMENT || $stueck[0] === T_DOC_COMMENT) {
            continue;
        }
        $endpunkt .= $stueck[1];
        continue;
    }
    $endpunkt .= $stueck;
}
assert(str_contains($endpunkt, 'avesmapsWikiMerkerBereinigen('), 'der Endpunkt ruft den Lauf gar nicht');

// 🔴 NUR ADMIN. Der Lauf schreibt quer durch den Kartenbestand und bumpt die Kartenrevision --
// dieselbe Begruendung wie beim Datenbank-Backup nebenan, das ebenfalls admin statt edit verlangt.
assert(
    preg_match("/avesmapsRequireUserWithCapability\(\s*'admin'\s*\)/", $endpunkt) === 1,
    'der Endpunkt verlangt nicht die Faehigkeit `admin`'
);

// 💣 DER TROCKENLAUF IST DIE VORGABE, und geprueft wird die FORM, nicht das Wort: `=== true`.
// Ein `!empty($payload['apply'])` liesse `apply: 1`, `apply: "false"` und jeden truthy Tippfehler
// als Schreibvorgang durch -- genau die Klasse Fehler, gegen die die Vorgabe gebaut ist.
assert(
    preg_match('/\$scharf\s*=\s*\(\$payload\[\x27apply\x27\]\s*\?\?\s*false\)\s*===\s*true;/', $endpunkt) === 1,
    'die Trockenlauf-Vorgabe steht nicht als ausdrueckliches `=== true` da'
);
// Und der Trockenlauf wird als NEGATION des scharfen Laufs weitergereicht -- nicht andersherum.
// 🪤 Diese Zeile war beim ersten Anlauf ROT, und das war ihr Wert: nicht der Endpunkt war falsch,
// sondern die Zusicherung -- die Regexe kamen durch zwei Ebenen (Skript, PHP-Zeichenkette) und
// verloren dabei ihre Escapes. Eine Negativ-Zusicherung haette das ueberlebt; diese hier nicht,
// und deshalb ist sie die richtige Bauform.
assert(
    preg_match('/avesmapsWikiMerkerBereinigen\(\s*\$pdo\s*,\s*!\$scharf\s*,/', $endpunkt) === 1,
    'der Endpunkt reicht den Trockenlauf verkehrt herum durch -- dann schreibt die Vorschau'
);

// ── 10) 💣 DIE ABLAGE UEBERLEBT DEN LAUF ZEICHENGENAU -- ausser dem einen Schluessel ─────────
// `json_decode($s, true)` + `json_encode` ist KEIN Roundtrip, und beide Abweichungen treffen genau
// diesen Lauf (gemessen 09.09.2026):
//   · `{"a":{}}` wird `{"a":[]}` -- ein leeres Objekt kommt als leeres ARRAY zurueck.
//   · 🔴 Die Zeile, die NUR den Merker traegt, wird zu `[]` statt `{}` -- die ganze Ablage waere
//     danach ein JSON-Array, wo jeder Leser ein Objekt erwartet. Und das ist hier der NORMALFALL.
//   · `{"curve":26.0}` wird `{"curve":26}` ohne `JSON_PRESERVE_ZERO_FRACTION`. Die Kraftlinien
//     tragen `curve` als Gleitkommazahl, und die Haelfte der Traeger sind Kraftliniensegmente.
// ⚠️ Diese Zusicherungen sind der Grund, warum die Bibliothek NICHT `avesmapsEncodeJson()` benutzt.
// Wer sie „vereinfacht", faellt hier auf.
$pdo->exec('DELETE FROM map_features');
$pdo->exec('DELETE FROM map_revision');
$formen = [
    // public_id => [roh gespeichertes JSON, erwartetes JSON danach]
    'f-nur-merker'  => ['{"wiki_no_article":true}', '{}'],
    'f-leeres-nest' => ['{"name":"X","field_origins":{},"wiki_no_article":true}', '{"name":"X","field_origins":{}}'],
    'f-tief'        => ['{"wiki_settlement":{"wiki_key":"x","nest":{}},"wiki_no_article":true}', '{"wiki_settlement":{"wiki_key":"x","nest":{}}}'],
    'f-gleitkomma'  => ['{"curve":26.0,"wiki_no_article":true}', '{"curve":26.0}'],
    'f-unicode'     => ['{"name":"Fürstentum Kosch","wiki_no_article":true}', '{"name":"Fürstentum Kosch"}'],
    'f-schraeg'     => ['{"wiki_url":"https://de.wiki-aventurica.de/wiki/X","wiki_no_article":true}', '{"wiki_url":"https://de.wiki-aventurica.de/wiki/X"}'],
    'f-null'        => ['{"lage":null,"wiki_no_article":true}', '{"lage":null}'],
    'f-leere-liste' => ['{"tags":[],"wiki_no_article":true}', '{"tags":[]}'],
];
foreach ($formen as $publicId => [$vorher, $_]) {
    $einfuegen->execute([$publicId, $publicId, $vorher]);
}
$formLauf = avesmapsWikiMerkerBereinigen($pdo, false);
assert($formLauf['done'] === count($formen),
    'nicht alle Formen geraeumt: ' . $formLauf['done'] . ', Fehlschlaege: ' . json_encode($formLauf['failed']));
$gespeichert = [];
foreach ($pdo->query('SELECT public_id, properties_json FROM map_features')->fetchAll(PDO::FETCH_ASSOC) as $row) {
    $gespeichert[(string) $row['public_id']] = (string) $row['properties_json'];
}
foreach ($formen as $publicId => [$vorher, $soll]) {
    assert(
        $gespeichert[$publicId] === $soll,
        "\"$publicId\": die Ablage hat den Lauf nicht zeichengenau ueberlebt.\n"
        . "  vorher:   $vorher\n  erwartet: $soll\n  bekommen: " . $gespeichert[$publicId]
    );
}

// ── 11) 🔴 UND WAS DER LAUF NICHT ZEICHENGENAU KANN, SCHREIBT ER GAR NICHT ────────────────────
// 💣 Eine Ganzzahl jenseits von PHP_INT_MAX kommt als Gleitkommazahl zurueck -- in JEDER Form.
// Der Riegel meldet die Zeile, statt eine Zahl still zu veraendern. Ohne ihn waere die Zusicherung
// darueber nur so gut wie die Liste der Faelle, an die jemand gedacht hat.
$pdo->exec('DELETE FROM map_features');
$pdo->exec('DELETE FROM map_revision');
$einfuegen->execute(['f-riesig', 'f-riesig', '{"n":12345678901234567890,"wiki_no_article":true}']);
$pdo->revisionsBumps = 0;
$riegel = avesmapsWikiMerkerBereinigen($pdo, false);
assert($riegel['done'] === 0, 'die nicht darstellbare Zahl wurde geschrieben');
// 💣 UND DER LAUF HAT `map_revision` NICHT ANGEFASST. Genau hier sass ein Befund: die Revision
// wurde VOR dem Riegel gezogen, also bumpte ein Lauf, an dem jede Zeile scheitert, trotzdem den
// Kartenstempel -- und machte die ~3,2 MB Nutzlast fuer jeden warmen Besucher ungueltig, ohne ein
// einziges Byte zu aendern. Abschnitt 5 deckte das nicht ab (dort ist `total === 0`, hier werden
// Zeilen GEFUNDEN und keine geschrieben).
assert($pdo->revisionsBumps === 0,
    'ein Lauf, an dem jede Zeile am Riegel scheitert, bumpt trotzdem die Kartenrevision');
assert($riegel['revision'] === null, 'ein Lauf ohne Schreibvorgang meldet eine Revision');
assert(count($riegel['failed']) === 1, 'der Riegel meldet nichts: ' . json_encode($riegel['failed']));
assert(str_contains($riegel['failed'][0]['error'], 'Dekodier-Zyklus'),
    'der Riegel meldet die falsche Begruendung: ' . $riegel['failed'][0]['error']);
$unveraendert = (string) $pdo->query("SELECT properties_json FROM map_features WHERE public_id = 'f-riesig'")->fetchColumn();
assert($unveraendert === '{"n":12345678901234567890,"wiki_no_article":true}',
    'die Zeile wurde trotz Riegel veraendert: ' . $unveraendert);

fwrite(STDOUT, "wiki-merker-bereinigung-test: alle Zusicherungen erfuellt\n");
