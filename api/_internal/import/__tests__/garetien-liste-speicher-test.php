<?php

declare(strict_types=1);

// Der Zwischenspeicher der Arbeitsliste (garetien-liste-speicher.php): der FESTE Teil der Objekte
// liegt im Speicher, der WECHSELNDE wird bei jedem Aufruf frisch eingetragen.
//
// 🔴 DIE ZUSAGE, DIE DIESER TEST HAELT: mit Speicher kommt BIT FUER BIT dieselbe Antwort wie ohne --
// nach JEDER Art von Handlung, die das Fenster ausloest (Haekchen, Uebernahme, Staette, Namensvermerk,
// Ablehnen am Item und am Objekt, Verbund eines frueheren Laufs), und nach jeder Aenderung, die den
// festen Teil ungueltig macht (neues Item, neuer Lauf, neue Artbezeichnung, Frist, kaputte Datei).
// Verglichen werden avesmapsGaretienArbeitslisteObjekte, die Arbeitsliste in allen Reitern, der
// `keys`-Nachschlag und „Imports in der Naehe".
// ⭐ Und er beweist, dass der Speicher WIRKLICH gelesen wird: eine Aenderung am festen Teil, die die
// Signatur nicht sieht, bleibt bis zum Ablauf der Frist unsichtbar (Abschnitt L) -- ohne diesen Beweis
// waere „dieselbe Antwort" auch dann gruen, wenn der Speicher nie getroffen wird.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
//           -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-liste-speicher-test.php

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'.\n");
    exit(2);
}

require_once __DIR__ . '/../garetien-uebernahme.php';
require_once __DIR__ . '/../garetien-liste.php';

$pruefungen = 0;

// 0. AUS IST DIE VORGABE -- die Bibliothek laeuft ohne Speicher, bis jemand ihn einschaltet.
assert(avesmapsGaretienListeSpeicherOrt() === '', 'ohne Einschalten ist der Speicher aus');
$pruefungen++;

$ort = sys_get_temp_dir() . '/avesmaps-garetien-liste-speicher-test-' . getmypid() . '-' . bin2hex(random_bytes(4));
register_shutdown_function(static function () use ($ort): void {
    foreach (glob($ort . '/*') ?: [] as $datei) {
        @unlink($datei);
    }
    @rmdir($ort);
});
$dateien = static fn(): array => glob($ort . '/liste-*.ser.gz') ?: [];

$pdo = avesmapsGaretienPlanTestPdo();
avesmapsGaretienKandidatenVergessen();
avesmapsGaretienBaueSyncPlan($pdo, 1, 1);
$pdo->exec('CREATE TABLE settlement_place (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, name TEXT, place_type TEXT,
    settlement_public_id TEXT, settlement_name TEXT, wiki_url TEXT, origin TEXT, is_active INTEGER DEFAULT 1,
    created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)');

// Der erste Unterschied zweier Antworten als Pfad -- sonst sagt ein roter Vergleich nur „ungleich".
$ersterUnterschied = static function ($a, $b, string $pfad = '') use (&$ersterUnterschied): ?string {
    if ($a === $b) {
        return null;
    }
    if (is_array($a) && is_array($b)) {
        if (array_keys($a) !== array_keys($b)) {
            return $pfad . ': Schluessel ' . json_encode(array_keys($a)) . ' gegen ' . json_encode(array_keys($b));
        }
        foreach ($a as $k => $v) {
            $u = $ersterUnterschied($v, $b[$k], $pfad . '/' . $k);
            if ($u !== null) {
                return $u;
            }
        }

        return $pfad;
    }

    return $pfad . ': ' . json_encode($a, JSON_UNESCAPED_UNICODE) . ' gegen ' . json_encode($b, JSON_UNESCAPED_UNICODE);
};

// Alle Leser des Speichers auf einmal.
$faelle = static function (PDO $pdo): array {
    $objekte = avesmapsGaretienArbeitslisteObjekte($pdo, 1);
    $schluessel = array_slice(array_keys($objekte['objekte']), 0, 3);
    $ziel = '';
    foreach ($objekte['objekte'] as $key => $objekt) {
        if (($objekt['geometrie'] ?? []) !== []) {
            $ziel = (string) $key;
            break;
        }
    }

    return [
        'objekte' => $objekte,
        'alle' => avesmapsGaretienArbeitsliste($pdo, 1, []),
        'offen' => avesmapsGaretienArbeitsliste($pdo, 1, ['stand' => 'offen']),
        'uebernommen' => avesmapsGaretienArbeitsliste($pdo, 1, ['stand' => 'uebernommen']),
        'abgelehnt' => avesmapsGaretienArbeitsliste($pdo, 1, ['stand' => 'abgelehnt']),
        'keys' => avesmapsGaretienArbeitsliste($pdo, 1, ['keys' => $schluessel]),
        'naehe' => $ziel === '' ? [] : avesmapsGaretienNaehe($pdo, 1, $ziel, 5.0),
    ];
};

// Mit Speicher dieselbe Antwort wie ohne. Gibt die Antwort MIT Speicher zurueck.
$gleich = static function (PDO $pdo, string $wann) use ($ort, $faelle, $ersterUnterschied, &$pruefungen): array {
    avesmapsGaretienListeSpeicherOrt('');
    $ohne = $faelle($pdo);
    avesmapsGaretienListeSpeicherOrt($ort);
    $mit = $faelle($pdo);
    avesmapsGaretienListeSpeicherOrt('');
    assert($mit === $ohne, $wann . ': mit Speicher dieselbe Antwort wie ohne -- erster Unterschied '
        . $ersterUnterschied($mit, $ohne));
    $pruefungen++;

    return $mit;
};
$objektNamens = static function (array $antwort, string $name): array {
    foreach ($antwort['objekte']['objekte'] as $objekt) {
        if ($objekt['name'] === $name) {
            return $objekt;
        }
    }
    throw new RuntimeException($name . ' nicht gefunden');
};
$itemsVon = static function (PDO $pdo, string $muster): array {
    $lauf = avesmapsSyncPlanOpenRun($pdo, AVESMAPS_GARETIEN_PLAN_KIND);
    $stmt = $pdo->prepare('SELECT id, entity_key, change_type FROM sync_plan_item WHERE run_id = :r AND entity_key LIKE :m ORDER BY id');
    $stmt->execute([':r' => (int) $lauf['id'], ':m' => $muster]);
    $zeilen = $stmt->fetchAll(PDO::FETCH_ASSOC);
    assert($zeilen !== [], 'Vorbedingung: Items fuer ' . $muster);

    return $zeilen;
};
$setze = static function (PDO $pdo, int $id, ?string $state, ?string $note): void {
    $pdo->prepare('UPDATE sync_plan_item SET apply_state = :s, apply_note = :n WHERE id = :id')
        ->execute([':s' => $state, ':n' => $note, ':id' => $id]);
};

// --- A. Kalt: der erste Aufruf baut und legt ab ----------------------------------------------------
$a = $gleich($pdo, 'A kalt');
assert(count($dateien()) === 1, 'A: genau eine Datei abgelegt, nicht ' . count($dateien()));
$pruefungen++;
$ohneItem = null;
foreach ($a['objekte']['objekte'] as $key => $objekt) {
    if ($objekt['items'] === []) {
        $ohneItem = (string) $key;
        break;
    }
}
assert($ohneItem !== null, 'Vorbedingung: die Fixture hat ein Objekt OHNE Vorschlag');
$pruefungen++;

// --- B. Warm: dieselbe Datei, dieselbe Antwort ------------------------------------------------------
$gleich($pdo, 'B warm');
assert(count($dateien()) === 1, 'B: kein zweiter Eintrag, solange nichts Festes sich aendert');
$pruefungen++;

// --- C. Haekchen -----------------------------------------------------------------------------------
$pdo->exec("UPDATE sync_plan_item SET selected = 1 - selected WHERE id IN (SELECT id FROM sync_plan_item ORDER BY id LIMIT 3)");
$c = $gleich($pdo, 'C Haekchen');
assert($c['objekte']['angehakt'] !== $a['objekte']['angehakt'] || $c['objekte']['objekte'] !== $a['objekte']['objekte'],
    'C: die Haekchen kommen sichtbar an (der Vergleich darf nicht gegen einen unveraenderten Stand laufen)');
$pruefungen++;

// --- D. Uebernahme ---------------------------------------------------------------------------------
$gardel = $itemsVon($pdo, 'ggp:Gewaesser:Fluss:Garetien:Gardel!Gardel%');
$setze($pdo, (int) $gardel[0]['id'], 'done', 'region-gardel');
$d = $gleich($pdo, 'D Uebernahme');
assert($objektNamens($d, 'Gardel')['stand'] === 'uebernommen', 'D: die Gardel steht mit Speicher auf uebernommen');
// 💣 AM ITEM SELBST, nicht nur am Objekt: der Vergleich mit/ohne Speicher laeuft auf beiden Seiten durch
// dasselbe Eintragen und saehe einen Fehler dort nie -- die Mutationsprobe hat genau das gezeigt.
$itemStand = array_column($objektNamens($d, 'Gardel')['items'], 'apply_state', 'id');
assert(($itemStand[(int) $gardel[0]['id']] ?? null) === 'done', 'D: das Item traegt `apply_state` = done: ' . json_encode($itemStand));
$pruefungen += 2;

// --- E. Staette -------------------------------------------------------------------------------------
$pdo->exec("INSERT INTO settlement_place (public_id, name, place_type, origin) VALUES ('staette-speicher', 'Probe', 'Tempel', 'garetien')");
$setze($pdo, (int) $gardel[0]['id'], 'done', 'staette-speicher');
$e = $gleich($pdo, 'E Staette');
assert($objektNamens($e, 'Gardel')['innerorts_uebernommen'] === true, 'E: „uebernommen · innerorts" kommt mit Speicher an');
$pruefungen++;

// --- F. Namensvermerk --------------------------------------------------------------------------------
$setze($pdo, (int) $gardel[0]['id'], 'done', avesmapsGaretienNameVermerkBauen('Pfad-1', 'Gardel', false, null, []));
$f = $gleich($pdo, 'F Namensvermerk');
$ergaenzt = array_filter($objektNamens($f, 'Gardel')['items'], static fn(array $i): bool => $i['name_ergaenzt'] === true);
assert(count($ergaenzt) === 1, 'F: `name_ergaenzt` kommt mit Speicher an');
$pruefungen++;

// --- G. Entscheidungen am Item: Ablehnung und dauerhafte Uebernahme ----------------------------------
$muehlsee = $itemsVon($pdo, 'ggp:Gewaesser:See:Garetien:Muehlsee%');
foreach ($muehlsee as $item) {
    $pdo->prepare("INSERT INTO sync_decision (kind, entity_key, change_type, declined_at) VALUES (:k, :e, :c, '2026-09-23 10:00:00')")
        ->execute([':k' => AVESMAPS_GARETIEN_PLAN_KIND, ':e' => $item['entity_key'], ':c' => $item['change_type']]);
}
$alke = $itemsVon($pdo, 'ggp:Gewaesser:Bach:Garetien:Alke!Alke%');
$pdo->prepare("INSERT INTO sync_decision (kind, entity_key, change_type, applied_at) VALUES (:k, :e, :c, '2026-09-23 10:00:00')")
    ->execute([':k' => AVESMAPS_GARETIEN_PLAN_KIND, ':e' => $alke[0]['entity_key'], ':c' => $alke[0]['change_type']]);
$g = $gleich($pdo, 'G Entscheidungen');
assert($objektNamens($g, 'Muehlsee')['stand'] === 'abgelehnt', 'G: die Ablehnung kommt mit Speicher an');
assert($objektNamens($g, 'Alke')['stand'] === 'uebernommen', 'G: der dauerhafte Uebernahme-Vermerk kommt an');
$alkeApplied = array_column($objektNamens($g, 'Alke')['items'], 'applied', 'id');
assert(($alkeApplied[(int) $alke[0]['id']] ?? null) === true, 'G: das Item traegt `applied` = true: ' . json_encode($alkeApplied));
$pruefungen += 3;

// --- H. Ablehnung eines Objekts OHNE Vorschlag (am Objektschluessel) -----------------------------------
$pdo->prepare("INSERT INTO sync_decision (kind, entity_key, change_type, declined_at) VALUES (:k, :e, :c, '2026-09-23 10:00:00')")
    ->execute([':k' => AVESMAPS_GARETIEN_PLAN_KIND, ':e' => $ohneItem, ':c' => AVESMAPS_GARETIEN_OBJEKT_ENTSCHEIDUNG]);
$h = $gleich($pdo, 'H Objekt ohne Vorschlag abgelehnt');
assert($h['objekte']['objekte'][$ohneItem]['stand'] === 'abgelehnt', 'H: die Ablehnung am Objektschluessel kommt an');
$pruefungen++;

// --- I. Verbund eines FRUEHEREN Laufs -- und ein neuer Lauf ist ein neuer Schluessel ---------------------
$pdo->exec("DELETE FROM sync_decision WHERE entity_key LIKE 'ggp:Gewaesser:Bach:Garetien:Alke%'");
$setze($pdo, (int) $alke[count($alke) - 1]['id'], 'done', avesmapsGaretienVerbundVermerk('area-9', 'region-9', 'Speicher-Verbund'));
avesmapsGaretienKandidatenVergessen();
avesmapsGaretienBaueSyncPlan($pdo, 1, 1);
$i = $gleich($pdo, 'I Verbund frueherer Lauf');
assert($objektNamens($i, 'Alke')['verbund_angelegt'] === 'Speicher-Verbund',
    'I: der Verbund des frueheren Laufs kommt mit Speicher an: ' . json_encode($objektNamens($i, 'Alke')['verbund_angelegt']));
assert(count($dateien()) === 2, 'I: der neue Lauf hat einen eigenen Eintrag, nicht ' . count($dateien()));
$pruefungen += 2;

// --- J. Ein neues Item im offenen Lauf aendert die Signatur -> Neubau ------------------------------------
$lauf = avesmapsSyncPlanOpenRun($pdo, AVESMAPS_GARETIEN_PLAN_KIND);
avesmapsSyncPlanAddItem($pdo, (int) $lauf['id'], [
    'entity_key' => 'ggp:Gewaesser:Bach:Garetien:Speicherbach!Speicherbach',
    'change_type' => 'new',
    'label' => 'Speicherbach',
    'after' => ['name' => 'Speicherbach', 'typ' => 'Bach', 'wiki' => 'ggp', 'ebene' => 'Gewaesser'],
    'selected' => 0,
]);
$j = $gleich($pdo, 'J neues Item');
$gefunden = array_filter($j['objekte']['objekte'], static fn(array $o): bool => $o['name'] === 'Speicherbach');
assert(count($gefunden) === 1, 'J: das neue Objekt steht mit Speicher in der Liste');
$pruefungen++;

// --- K. Eine neue Artbezeichnung ist ein neuer Schluessel; der Vorrat bleibt gedeckelt --------------------
$pdo->exec('CREATE TABLE IF NOT EXISTS ecosystem_region_type (kind TEXT, type_key TEXT, label TEXT)');
$pdo->exec("INSERT INTO ecosystem_region_type (kind, type_key, label) VALUES ('vegetation', 'probe', 'Probewald')");
$vorher = $dateien();
$gleich($pdo, 'K Artbezeichnung');
$nachher = $dateien();
assert(array_diff($nachher, $vorher) !== [], 'K: eine neue Artbezeichnung legt einen NEUEN Eintrag an');
// 🔴 Gemessen an der ZAHL VORHER, nicht an der Konstante: der Test las sie zuerst selbst und blieb gruen,
// als der Deckel auf 99 stand. Vorher lagen zwei (Lauf A, Lauf I), der dritte Schluessel verdraengt den aeltesten.
assert(count($vorher) === 2 && count($nachher) === 2,
    'K: der Vorrat wird aufgeraeumt -- vorher ' . count($vorher) . ', nachher ' . count($nachher) . ' Dateien (Quote!)');
$pruefungen += 2;
$schluesselA = avesmapsGaretienListeSpeicherSchluessel(['id' => 5, 'created_at' => 'x'], 1, ['Wald']);
assert($schluesselA !== avesmapsGaretienListeSpeicherSchluessel(['id' => 5, 'created_at' => 'x'], 1, ['Wald', 'Moor']),
    'K: die Artbezeichnungen stehen im Schluessel');
assert($schluesselA !== avesmapsGaretienListeSpeicherSchluessel(['id' => 5, 'created_at' => 'y'], 1, ['Wald']),
    'K: der Anlegezeitpunkt des Laufs steht im Schluessel');
assert($schluesselA !== avesmapsGaretienListeSpeicherSchluessel(['id' => 5, 'created_at' => 'x'], 2, ['Wald']),
    'K: der Import-Lauf steht im Schluessel');
$pruefungen += 3;

// --- L. Der Speicher wird WIRKLICH gelesen -- und die Frist beendet ihn ------------------------------------
// Eine Aenderung am FESTEN Teil, die die Signatur nicht sieht (in Produktion schreibt niemand so -- der
// Lauf ist nach dem Oeffnen fest). Mit Speicher bleibt der alte Name stehen, bis die Frist ablaeuft.
avesmapsGaretienListeSpeicherOrt($ort);
avesmapsGaretienArbeitslisteObjekte($pdo, 1); // warm
$gardelNeu = $itemsVon($pdo, 'ggp:Gewaesser:Fluss:Garetien:Gardel!Gardel%');
$after = json_decode((string) $pdo->query('SELECT after_json FROM sync_plan_item WHERE id = ' . (int) $gardelNeu[0]['id'])->fetchColumn(), true);
$after['name'] = 'Gardel-umbenannt';
$pdo->prepare('UPDATE sync_plan_item SET after_json = :a WHERE id = :id')
    ->execute([':a' => json_encode($after, JSON_UNESCAPED_UNICODE), ':id' => (int) $gardelNeu[0]['id']]);
$namen = static fn(array $objekte): array => array_column($objekte['objekte'], 'name');
$mitSpeicher = $namen(avesmapsGaretienArbeitslisteObjekte($pdo, 1));
avesmapsGaretienListeSpeicherOrt('');
$ohneSpeicher = $namen(avesmapsGaretienArbeitslisteObjekte($pdo, 1));
assert(in_array('Gardel', $mitSpeicher, true) && !in_array('Gardel-umbenannt', $mitSpeicher, true),
    'L: MIT Speicher kommt der feste Teil aus der Datei (der alte Name) -- sonst waere jeder Vergleich oben wertlos');
assert(in_array('Gardel-umbenannt', $ohneSpeicher, true), 'L: ohne Speicher der neue Name');
foreach ($dateien() as $datei) {
    touch($datei, time() - AVESMAPS_GARETIEN_LISTE_SPEICHER_FRIST_SEKUNDEN - 5);
}
$gleich($pdo, 'L nach Ablauf der Frist');
$pruefungen += 2;

// --- M. Eine kaputte Datei wird uebergangen und neu geschrieben ---------------------------------------------
foreach ($dateien() as $datei) {
    file_put_contents($datei, 'kaputt');
}
$gleich($pdo, 'M kaputte Datei');
$gueltig = array_filter($dateien(), static fn(string $d): bool => is_string(@gzdecode((string) file_get_contents($d))));
assert($gueltig !== [], 'M: nach dem Uebergehen liegt wieder ein lesbarer Eintrag da');
$pruefungen++;

// --- N. Nicht schreibbar: die Antwort kommt trotzdem ---------------------------------------------------------
file_put_contents($ort . '/blockiert.txt', 'eine Datei, kein Verzeichnis');
avesmapsGaretienListeSpeicherOrt('');
$ohne = avesmapsGaretienArbeitslisteObjekte($pdo, 1);
avesmapsGaretienListeSpeicherOrt($ort . '/blockiert.txt/unter');
$mitBlockiert = avesmapsGaretienArbeitslisteObjekte($pdo, 1);
avesmapsGaretienListeSpeicherOrt('');
assert($mitBlockiert === $ohne, 'N: faellt offen aus -- ohne schreibbares Verzeichnis dieselbe Antwort, kein Fehler');
$pruefungen++;

// --- P. Die tragenden Stellen im Quelltext -------------------------------------------------------------------
$ohneKommentare = static function (string $php): string {
    $raus = '';
    foreach (token_get_all($php) as $token) {
        if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
            continue;
        }
        $raus .= is_array($token) ? $token[1] : $token;
    }

    return $raus;
};
$rumpf = static function (string $code, string $funktion): string {
    $ab = strpos($code, 'function ' . $funktion . '(');
    assert($ab !== false, $funktion . ' steht nicht im Code');
    $bis = strpos($code, "\nfunction ", $ab + 10);

    return substr($code, $ab, $bis === false ? null : $bis - $ab);
};
$liste = $ohneKommentare(str_replace("\r\n", "\n", (string) file_get_contents(__DIR__ . '/../garetien-liste.php')));
$fest = $rumpf($liste, 'avesmapsGaretienListeFestBauen');
foreach (['selected', 'apply_state', 'apply_note'] as $spalte) {
    assert(!preg_match('/SELECT[^;]*\b' . $spalte . '\b/', $fest),
        '🔴 der feste Bau liest die wechselnde Spalte `' . $spalte . '` nicht -- sie stuende sonst im Speicher');
}
foreach (['avesmapsSyncPlanDecisions', 'avesmapsSettlementPlacePublicIds', 'avesmapsGaretienVerbundVermerkeFruehererLaeufe'] as $leser) {
    assert(!str_contains($fest, $leser . '('), '🔴 der feste Bau ruft den wechselnden Leser ' . $leser . ' nicht');
}
$pruefungen += 6;
$speicher = $ohneKommentare(str_replace("\r\n", "\n", (string) file_get_contents(__DIR__ . '/../garetien-liste-speicher.php')));
$schluesselRumpf = $rumpf($speicher, 'avesmapsGaretienListeSpeicherSchluessel');
assert(str_contains($schluesselRumpf, 'avesmapsGaretienListeSpeicherCodeStempel()'),
    '🔴 der Codestempel steht im Schluessel -- ein Deploy macht den Speicher sofort ungueltig');
assert(str_contains($rumpf($speicher, 'avesmapsGaretienListeSpeicherCodeStempel'), 'get_included_files()'),
    '🔴 der Codestempel ueberdeckt ALLE eingebundenen Dateien, keine ausgewaehlte Liste');
assert(str_contains($rumpf($speicher, 'avesmapsGaretienListeSpeicherLesen'), "'allowed_classes' => false"),
    '🔴 der Speicher wird ohne Klassen entpackt');
assert(!str_contains($speicher, 'LOCK_EX') && !str_contains($speicher, 'flock('),
    '💣 keine Dateisperre -- sie hat auf STRATOs NFS den PHP-Pool festgefahren');
// 💣 Abschnitt L faengt das Fehlen nur mit dem PHP des Tors (8.3, Linux: haelt die Dateizeit nach touch()
// fest) -- unter Windows bliebe er gruen, und der Fehler kaeme erst im Deploy-Tor. Deshalb auch am Quelltext.
$leserRumpf = $rumpf($speicher, 'avesmapsGaretienListeSpeicherLesen');
$statLeeren = strpos($leserRumpf, 'clearstatcache(true, $datei);');
$istDatei = strpos($leserRumpf, 'is_file($datei)');
assert($statLeeren !== false && $istDatei !== false && $statLeeren < $istDatei,
    '💣 der Leser leert den Stat-Zwischenspeicher der Datei, BEVOR er ihre Zeit liest');
$pruefungen += 5;
$endpunkt = $ohneKommentare(str_replace("\r\n", "\n", (string) file_get_contents(__DIR__ . '/../../../edit/map/garetien-import.php')));
$einschalten = strpos($endpunkt, "avesmapsGaretienListeSpeicherOrt(sys_get_temp_dir()");
$ersteListe = strpos($endpunkt, "\$action === 'liste'");
assert($einschalten !== false && $ersteListe !== false && $einschalten < $ersteListe,
    '🔴 der Endpunkt schaltet den Speicher ein, BEVOR `liste`, `naehe` und `innerorts_kandidaten` ihn brauchen');
// 🔴 Der Ensure der Importtabellen laeuft auf den LESEWEGEN hoechstens einmal je Frist und Dateistand --
// sein Aufruf steht dort INNERHALB von avesmapsSchemaEnsureOnce(...). Gemessen an der Klammer, nicht an
// einem festen Zeichenfenster: ein Kommentar im Aufruf verschoebe jedes Fenster.
// 🔴 Die SCHREIBWEGE (fetch/upload/plan) behalten den Roh-Ensure -- die Hausregel (AGENTS.md §10); sonst
// legte nach einer eingespielten Sicherung erst der Marker-Ablauf die Tabellen wieder an.
$aufrufAb = strpos($endpunkt, 'avesmapsSchemaEnsureOnce(');
assert($aufrufAb !== false, '🔴 der Endpunkt ruft avesmapsSchemaEnsureOnce');
$tiefe = 0;
$aufrufBis = null;
for ($k = $aufrufAb + strlen('avesmapsSchemaEnsureOnce'); $k < strlen($endpunkt); $k++) {
    if ($endpunkt[$k] === '(') {
        $tiefe++;
    } elseif ($endpunkt[$k] === ')') {
        $tiefe--;
        if ($tiefe === 0) {
            $aufrufBis = $k;
            break;
        }
    }
}
assert($aufrufBis !== null, 'die Klammer von avesmapsSchemaEnsureOnce schliesst');
$aufruf = substr($endpunkt, $aufrufAb, $aufrufBis - $aufrufAb + 1);
assert(str_contains($aufruf, "'garetien-importer-tabellen'") && str_contains($aufruf, 'avesmapsGaretienEnsureTables($pdo)'),
    '🔴 der Tabellen-Ensure steht in avesmapsSchemaEnsureOnce, unter seinem Marker');
assert(str_contains($endpunkt, "if (in_array(\$action, ['fetch', 'upload', 'plan'], true)) {\n        avesmapsGaretienEnsureTables(\$pdo);\n    } else {\n        avesmapsSchemaEnsureOnce("),
    '🔴 roh NUR auf den drei Schreibwegen, sonst gedrosselt');
assert(substr_count($endpunkt, 'avesmapsGaretienEnsureTables($pdo)') === 2,
    '🔴 und nirgends sonst -- ein dritter, roher Aufruf liefe wieder bei JEDEM Aufruf');
$pruefungen += 5;

echo "OK -- garetien-liste-speicher ({$pruefungen} Pruefungen)\n";
