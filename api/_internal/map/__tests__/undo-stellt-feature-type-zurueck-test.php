<?php

declare(strict_types=1);

/**
 * Ein Undo muss GENAU die Spalten zurueckschreiben, die seine Aktion gesetzt hat -- nicht weniger.
 *
 * 💣 DER BEFUND, DER DIESEN TEST ERZWUNGEN HAT: `avesmapsUndoColumnsForAuditAction` liess bei vier
 * Aktionen `feature_type` aus, obwohl ihr UPDATE ihn schreibt. Sichtbar wurde das an einer Kreuzung:
 * „Zu Ort konvertieren" ist eine ECHTE, gewollte Funktion (js/ui/popups.js, Kachel
 * `convert-crossing-to-location`) und laeuft durch `update_point`, das die Spalte auf 'location'
 * setzt. Das Undo holte Name, Subtyp und properties_json zurueck und liess die Spalte stehen --
 * uebrig blieb `feature_type='location'` neben `feature_subtype='crossing'`, die EINZIGE Zeile im
 * Bestand, deren Spalte ihrem eigenen properties_json widerspricht (1 von 18.703, Dump 04.09.2026).
 *
 * 🔴 DIE ERWARTUNG WIRD AUS DEM QUELLTEXT GERECHNET, NICHT ABGESCHRIEBEN. Eine von Hand gepflegte
 * Liste waere die zweite Wahrheit, die genau so auseinanderlaeuft wie die, die hier gerissen ist:
 * der Test liest jedes `UPDATE map_features ... SET ...` samt der Audit-Aktion, die dieselbe Funktion
 * schreibt, und haelt die Undo-Liste dagegen. Damit faellt er in BEIDE Richtungen auf -- eine neue
 * Spalte im UPDATE ohne Undo ebenso wie eine Undo-Spalte, die niemand schreibt.
 *
 * ⚠️ VEREINIGT wird je Aktion, weil ZWEI Funktionen dieselbe Aktion schreiben koennen:
 * `avesmapsUpdatePathGroupDetails` protokolliert `update_path_details`, setzt aber kein
 * `feature_type`. Massgeblich ist der vollstaendigste Schreiber -- nur er muss umkehrbar sein; fuer
 * den kleineren ist die zusaetzliche Spalte ein Selbstzuweisung (before == aktuell).
 *
 * Lauf (aus dem Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 \
 *     api/_internal/map/__tests__/undo-stellt-feature-type-zurueck-test.php
 * Exit 0 = alle Zusicherungen bestanden.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

require __DIR__ . '/../features.php';

$checks = 0;
$wurzel = dirname(__DIR__, 4);

// Spalten, die JEDES Undo ohnehin selbst neu setzt bzw. aus der Geometrie nachrechnet -- sie gehoeren
// nie in die Undo-Liste (avesmapsBuildUndoFeatureUpdates schreibt revision/updated_by und leitet die
// vier bbox-Spalten aus geometry_json ab).
$buchhaltung = ['revision', 'updated_by', 'min_x', 'min_y', 'max_x', 'max_y'];

/**
 * Liest aus einer Quelldatei je Audit-Aktion die Vereinigung der Spalten, die ihre Funktionen per
 * `UPDATE map_features ... SET ...` schreiben.
 *
 * ⚠️ Zeilenendenneutral: die Arbeitskopie traegt CRLF, `actions/checkout` im Deploy-Tor LF
 * (AGENTS.md §9). Ein Muster ueber `\r\n` waere hier gruen und in der CI rot.
 */
function avesmapsTestSammleSchreibspalten(string $quelltext, array $buchhaltung): array {
    $quelltext = str_replace("\r\n", "\n", $quelltext);
    $treffer = [];

    // Die Datei in Funktionsruempfe schneiden -- eine Aktion gehoert der Funktion, die sie schreibt.
    $grenzen = [];
    if (preg_match_all('/^function (avesmaps\w+)\s*\(/m', $quelltext, $m, PREG_OFFSET_CAPTURE)) {
        foreach ($m[1] as $i => $eintrag) {
            $grenzen[] = ['name' => $eintrag[0], 'start' => $m[0][$i][1]];
        }
    }

    foreach ($grenzen as $i => $fn) {
        $ende = $grenzen[$i + 1]['start'] ?? strlen($quelltext);
        $rumpf = substr($quelltext, $fn['start'], $ende - $fn['start']);

        $spalten = [];
        if (preg_match_all('/UPDATE map_features\s*SET (.*?)WHERE/s', $rumpf, $sets)) {
            foreach ($sets[1] as $set) {
                if (preg_match_all('/(\w+)\s*=\s*:/', $set, $cols)) {
                    foreach ($cols[1] as $col) {
                        if (!in_array($col, $buchhaltung, true)) {
                            $spalten[$col] = true;
                        }
                    }
                }
            }
        }
        if ($spalten === []) {
            continue;
        }

        // Die Audit-Aktion(en), die dieselbe Funktion protokolliert (3. Argument des Log-Aufrufs).
        if (!preg_match_all('/WriteMapAuditLog\(\s*\$pdo\s*,[^,]*,\s*\'([a-z_]+)\'/', $rumpf, $akt)) {
            continue;
        }
        foreach ($akt[1] as $aktion) {
            foreach (array_keys($spalten) as $col) {
                $treffer[$aktion][$col] = true;
            }
        }
    }

    $fertig = [];
    foreach ($treffer as $aktion => $spalten) {
        $liste = array_keys($spalten);
        sort($liste);
        $fertig[$aktion] = $liste;
    }

    return $fertig;
}

$geschrieben = [];
foreach (['/api/_internal/map/features.php', '/api/_internal/wiki/locations.php'] as $rel) {
    $quelle = file_get_contents($wurzel . $rel);
    assert(is_string($quelle) && $quelle !== '', "die Quelle {$rel} ist lesbar");
    $checks++;
    foreach (avesmapsTestSammleSchreibspalten($quelle, $buchhaltung) as $aktion => $spalten) {
        $geschrieben[$aktion] = array_values(array_unique(array_merge($geschrieben[$aktion] ?? [], $spalten)));
        sort($geschrieben[$aktion]);
    }
}

// Der Parser muss ueberhaupt etwas gefunden haben -- sonst waere jede Zusicherung darunter ein Vakuum.
assert(count($geschrieben) >= 8, 'der Parser findet die Schreibwege (gefunden: ' . count($geschrieben) . ')');
$checks++;
foreach (['update_point', 'wiki_sync_update_point', 'update_powerline_details', 'update_path_details', 'update_label'] as $pflicht) {
    assert(isset($geschrieben[$pflicht]), "der Parser findet den Schreibweg von {$pflicht}");
    $checks++;
}

// ---- A) Die Undo-Liste spiegelt das UPDATE, Aktion fuer Aktion --------------------------------

foreach ($geschrieben as $aktion => $spalten) {
    $undo = avesmapsUndoColumnsForAuditAction($aktion);
    if ($undo === []) {
        // Nicht umkehrbar (z. B. reine Fortschreibungen) -- das ist eine eigene Entscheidung und
        // wird hier nicht erzwungen.
        continue;
    }
    $undoSortiert = $undo;
    sort($undoSortiert);
    assert(
        $undoSortiert === $spalten,
        "{$aktion}: Undo-Liste [" . implode(', ', $undoSortiert) . '] muss das UPDATE spiegeln [' . implode(', ', $spalten) . ']'
    );
    $checks++;
}

// ---- B) Die vier Aktionen, die feature_type schreiben, stellen ihn auch zurueck ---------------

foreach (['update_point', 'wiki_sync_update_point', 'update_powerline_details', 'update_path_details'] as $aktion) {
    assert(in_array('feature_type', $geschrieben[$aktion], true), "{$aktion} schreibt feature_type");
    $checks++;
    assert(
        in_array('feature_type', avesmapsUndoColumnsForAuditAction($aktion), true),
        "{$aktion}: das Undo stellt feature_type zurueck"
    );
    $checks++;
    // Das Redo greift dieselbe Liste ab -- sonst waere die Wiederherstellung eine halbe.
    assert(
        avesmapsUndoColumnsForAuditAction('undo_' . $aktion) === avesmapsUndoColumnsForAuditAction($aktion),
        "{$aktion}: Redo und Undo fassen dieselben Spalten an"
    );
    $checks++;
}

// ---- C) update_label bleibt AUSSEN VOR, weil sein UPDATE feature_type nicht anfasst -----------

assert(!in_array('feature_type', $geschrieben['update_label'], true), 'update_label schreibt feature_type NICHT');
$checks++;
assert(
    !in_array('feature_type', avesmapsUndoColumnsForAuditAction('update_label'), true),
    'update_label: das Undo fasst feature_type nicht an -- eine Spalte, die die Aktion nie gesetzt hat, darf sie auch nicht zurueckschreiben'
);
$checks++;

// ---- D) Alteintraege ohne feature_type im Nachher-Stand bleiben rueckgaengig zu machen --------
// Der Riegel avesmapsAssertUndoPatchStillCurrent wirft, wenn eine Undo-Spalte weder im Nachher-Stand
// steht noch herleitbar ist. Ohne diese Deckung haette der Umbau JEDES alte Undo dieser vier
// Aktionen unbrauchbar gemacht -- der teuerste denkbare Rueckschlag.
$erwarteterTyp = [
    'update_point' => 'location',
    'wiki_sync_update_point' => 'location',
    'update_powerline_details' => 'powerline',
    'update_path_details' => 'path',
];
foreach ($erwarteterTyp as $aktion => $typ) {
    $inferiert = avesmapsInferUndoAfterColumnValue($aktion, 'feature_type');
    assert($inferiert['found'] === true, "{$aktion}: feature_type ist fuer Alteintraege herleitbar");
    $checks++;
    assert($inferiert['value'] === $typ, "{$aktion}: hergeleitet wird '{$typ}'");
    $checks++;
}

// ---- E) Der Ablauf, wirklich gefahren: Kreuzung -> Ort und zurueck ----------------------------

$nest = ['name' => 'Kreuzung', 'feature_type' => 'junction', 'feature_subtype' => 'crossing'];
$vorher = [
    'id' => 11075,
    'public_id' => 'b0fcaada-9d80-4107-90fc-b60eea4b1b36',
    'feature_type' => 'junction',
    'feature_subtype' => 'crossing',
    'name' => 'Kreuzung',
    'properties_json' => json_encode($nest, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
    'is_active' => 1,
];
$ortNest = ['name' => 'Neuer Ort', 'feature_type' => 'location', 'feature_subtype' => 'dorf'];
$nachher = [
    'public_id' => 'b0fcaada-9d80-4107-90fc-b60eea4b1b36',
    'feature_type' => 'location',
    'name' => 'Neuer Ort',
    'feature_subtype' => 'dorf',
    'properties_json' => $ortNest,
];
// Der Stand, wie er nach „Zu Ort konvertieren" wirklich in der Tabelle steht.
$aktuell = [
    'id' => 11075,
    'public_id' => 'b0fcaada-9d80-4107-90fc-b60eea4b1b36',
    'feature_type' => 'location',
    'feature_subtype' => 'dorf',
    'name' => 'Neuer Ort',
    'properties_json' => json_encode($ortNest, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
    'is_active' => 1,
];

$updates = avesmapsBuildUndoFeatureUpdates('update_point', $aktuell, $vorher, $nachher, 500, 7);

assert(array_key_exists('feature_type', $updates), 'das Undo fasst feature_type ueberhaupt an -- genau das fehlte');
$checks++;
assert($updates['feature_type'] === 'junction', "die Kreuzung ist wieder eine Kreuzung (ist: '" . (string) ($updates['feature_type'] ?? '') . "')");
$checks++;
assert($updates['feature_subtype'] === 'crossing', 'der Subtyp kommt zurueck');
$checks++;
assert($updates['name'] === 'Kreuzung', 'der Name kommt zurueck');
$checks++;
$zurueck = json_decode((string) $updates['properties_json'], true);
assert(is_array($zurueck) && ($zurueck['feature_type'] ?? '') === 'junction', 'auch das Nest traegt wieder junction');
$checks++;

// ---- F) Die Regression selbst: der widerspruechliche Zustand entsteht nicht mehr --------------
// Der beobachtete Fehler ist genau diese Paarung -- Spalte 'location', Subtyp 'crossing'.
$ergebnis = array_merge($aktuell, $updates);
assert(
    !($ergebnis['feature_type'] === 'location' && $ergebnis['feature_subtype'] === 'crossing'),
    'nach dem Undo steht nie wieder feature_type=location neben feature_subtype=crossing'
);
$checks++;
assert(
    $ergebnis['feature_type'] === ($zurueck['feature_type'] ?? ''),
    'Spalte und properties_json sagen nach dem Undo dasselbe'
);
$checks++;

// ---- G) Ein gewoehnlicher Ort bleibt unberuehrt (die Spalte ist dort eine Selbstzuweisung) ----

$ortVorher = [
    'id' => 42, 'public_id' => 'p', 'feature_type' => 'location', 'feature_subtype' => 'dorf',
    'name' => 'Altname', 'properties_json' => json_encode(['name' => 'Altname'], JSON_UNESCAPED_SLASHES), 'is_active' => 1,
];
$ortAktuell = array_merge($ortVorher, [
    'name' => 'Neuname',
    'feature_subtype' => 'stadt',
    'properties_json' => json_encode(['name' => 'Neuname'], JSON_UNESCAPED_SLASHES),
]);
$ortNachher = ['feature_type' => 'location', 'name' => 'Neuname', 'feature_subtype' => 'stadt', 'properties_json' => ['name' => 'Neuname']];
$ortUpdates = avesmapsBuildUndoFeatureUpdates('update_point', $ortAktuell, $ortVorher, $ortNachher, 501, 7);
assert($ortUpdates['feature_type'] === 'location', 'ein normaler Ort bleibt ein Ort');
$checks++;
assert($ortUpdates['name'] === 'Altname' && $ortUpdates['feature_subtype'] === 'dorf', 'Name und Art kommen zurueck wie bisher');
$checks++;

fwrite(STDOUT, "OK -- {$checks} Zusicherungen bestanden.\n");
