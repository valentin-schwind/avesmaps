<?php

declare(strict_types=1);

/**
 * DER WAECHTER: `properties.wiki_region` wird an GENAU EINER Stelle geschrieben.
 * Entwurf: docs/superpowers/specs/2026-09-15-landschaft-wiki-eine-quelle-design.md §6
 *
 * 🔴 WARUM ES IHN GIBT. Bis zum 15.09.2026 schrieben ZEHN Stellen das Wiki-Nest einer Beschriftung, und nur
 * zwei fragten, ob sie an einer Flaeche haengt. Jede der uebrigen konnte Schild und Flaeche auseinanderbringen
 * -- und die naechste, die jemand baut, kann es wieder. Dieser Test wird ROT, sobald irgendwo im api/-Baum
 * ausserhalb des Trichters (api/_internal/app/landschaft-wiki.php) das Feld gesetzt oder entfernt wird.
 *
 * ⚠️ Gelesen wird mit PHPs Tokenizer, NIE mit einem Regex-Kommentarentferner: ein Blockkommentar-Entferner
 * frisst hinter einem `_internal/wiki/*-Libs` in einem Zeilenkommentar 380 Zeilen echten Code (AGENTS.md §11,
 * „Einen eigenen Knoten nachtraeglich an einen Wiki-Artikel binden").
 *
 * Lauf: php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/landschaft-wiki-schreiber-waechter-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

$wurzel = realpath(__DIR__ . '/../../../..');
assert(is_string($wurzel) && is_dir($wurzel . '/api'), 'die Repo-Wurzel ist gefunden');

function waechterOhneKommentare(string $quelle): string
{
    $raus = '';
    foreach (token_get_all($quelle) as $token) {
        if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
            // Zeilenzahl erhalten, damit die Meldung die richtige Zeile nennt.
            $raus .= str_repeat("\n", substr_count($token[1], "\n"));
            continue;
        }
        $raus .= is_array($token) ? $token[1] : $token;
    }

    return str_replace("\r\n", "\n", $raus);
}

/** @return list<string> */
function waechterDateien(string $verzeichnis, string $endung): array
{
    $dateien = [];
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($verzeichnis, FilesystemIterator::SKIP_DOTS));
    foreach ($iterator as $datei) {
        $pfad = str_replace('\\', '/', $datei->getPathname());
        if (!str_ends_with($pfad, $endung) || str_contains($pfad, '/__tests__/') || str_contains($pfad, '/third-party/')) {
            continue;
        }
        $dateien[] = $pfad;
    }
    sort($dateien);

    return $dateien;
}

$trichter = 'api/_internal/app/landschaft-wiki.php';
$schreibMuster = [
    'Zuweisung' => '~\[\s*[\'"]wiki_region[\'"]\s*\]\s*=(?![=>])~',
    'Entfernen' => '~unset\s*\([^;]*\[\s*[\'"]wiki_region[\'"]\s*\]~',
];

// ---- 1. Im api/-Baum schreibt NUR der Trichter --------------------------------------------------------
$fundstellen = [];
foreach (waechterDateien($wurzel . '/api', '.php') as $pfad) {
    $relativ = substr($pfad, strlen(str_replace('\\', '/', $wurzel)) + 1);
    $text = waechterOhneKommentare((string) file_get_contents($pfad));
    foreach ($schreibMuster as $art => $muster) {
        if (preg_match_all($muster, $text, $treffer, PREG_OFFSET_CAPTURE) > 0) {
            foreach ($treffer[0] as [$gefunden, $position]) {
                $fundstellen[] = [$relativ, substr_count(substr($text, 0, $position), "\n") + 1, $art, $gefunden];
            }
        }
    }
}
$fremd = array_values(array_filter($fundstellen, static fn (array $f): bool => $f[0] !== $trichter));
assert($fremd === [],
    "1: 🔴 `properties.wiki_region` wird am Trichter VORBEI geschrieben -- jede dieser Stellen kann Beschriftung und "
    . "Flaeche auseinanderbringen. Schreiben ueber avesmapsLandschaftWikiNestSetzen / avesmapsLandschaftWikiBeschriftungFestlegen "
    . "(api/_internal/app/landschaft-wiki.php):\n" . implode("\n", array_map(
        static fn (array $f): string => "  {$f[0]}:{$f[1]} ({$f[2]}) {$f[3]}",
        $fremd
    )));

// ---- 2. Und im Trichter selbst GENAU zwei Stellen, beide in der einen reinen Funktion -------------------
$imTrichter = array_values(array_filter($fundstellen, static fn (array $f): bool => $f[0] === $trichter));
assert(count($imTrichter) === 2,
    '2: im Trichter genau EINE Zuweisung und EIN Entfernen, gefunden: ' . count($imTrichter));
$trichterText = waechterOhneKommentare((string) file_get_contents($wurzel . '/' . $trichter));
$start = strpos($trichterText, 'function avesmapsLandschaftWikiNestSetzen(');
assert($start !== false, '2: die reine Setzfunktion existiert');
$rest = substr($trichterText, $start + 10);
$ende = preg_match('~\nfunction ~', $rest, $m, PREG_OFFSET_CAPTURE) === 1 ? $start + 10 + $m[0][1] : strlen($trichterText);
$zeileStart = substr_count(substr($trichterText, 0, $start), "\n") + 1;
$zeileEnde = substr_count(substr($trichterText, 0, $ende), "\n") + 1;
foreach ($imTrichter as $f) {
    assert($f[1] >= $zeileStart && $f[1] <= $zeileEnde,
        "2: 💣 im Trichter steht eine zweite Schreibstelle ausserhalb von avesmapsLandschaftWikiNestSetzen (Zeile {$f[1]})");
}

// ---- 3. Ein Rumpfschluessel `'wiki_region' =>` nur, wo er ueber einen Schreibweg des Trichters laeuft ------
// Ein Array mit diesem Schluessel ist entweder ein Rumpf fuer create_label/update_label (der Trichter
// entscheidet) oder eine neue, eigene Ablage -- und die haette dieser Test sonst nicht gesehen.
$erlaubteRuempfe = [
    // Nur der deutsche Feldtitel im Verlauf, kein Properties-Rumpf oder Wiki-Schreiber.
    'api/_internal/map/audit-path-group.php' => 1,
];
$ruempfe = [];
foreach (waechterDateien($wurzel . '/api', '.php') as $pfad) {
    $relativ = substr($pfad, strlen(str_replace('\\', '/', $wurzel)) + 1);
    $anzahl = preg_match_all('~[\'"]wiki_region[\'"]\s*=>~', waechterOhneKommentare((string) file_get_contents($pfad)));
    if ($anzahl > 0) {
        $ruempfe[$relativ] = $anzahl;
    }
}
assert($ruempfe === $erlaubteRuempfe,
    "3: ein Array-Schluessel `'wiki_region' =>` ist dazugekommen oder weggefallen. Laeuft er durch create_label/"
    . "update_label, gehoert er in die Liste; sonst ist er ein zweiter Schreiber:\n" . json_encode($ruempfe, JSON_PRETTY_PRINT));

// ---- 4. Die Schreibwege rufen den Trichter wirklich -----------------------------------------------------
// Die Abläufe selbst faehrt landschaft-wiki-eine-quelle-test.php; hier steht nur, WER ihn ruft -- damit ein
// Umbau, der einen Aufruf verliert, nicht erst an einer fehlenden Zusicherung auffaellt.
function waechterRumpf(string $text, string $funktion): string
{
    $start = strpos($text, 'function ' . $funktion . '(');
    assert($start !== false, "4: die Funktion {$funktion} existiert");
    $offen = strpos($text, '{', $start);
    $tiefe = 0;
    for ($i = $offen, $n = strlen($text); $i < $n; $i++) {
        if ($text[$i] === '{') {
            $tiefe++;
        } elseif ($text[$i] === '}') {
            $tiefe--;
            if ($tiefe === 0) {
                return substr($text, $offen, $i - $offen + 1);
            }
        }
    }

    return substr($text, $offen);
}

$naehte = [
    'api/_internal/map/features.php' => [
        'avesmapsCreateLabelFeature' => 'avesmapsLandschaftWikiBeschriftungFestlegen(',
        'avesmapsUpdateLabelFeature' => 'avesmapsLandschaftWikiBeschriftungFestlegen(',
        'avesmapsUndoAuditChange' => 'avesmapsLandschaftWikiRueckgaengigAngleichen(',
    ],
    'api/_internal/app/ecosystem.php' => [
        'avesmapsCreateEcosystemRegion' => 'avesmapsLandschaftWikiBeschriftungenAngleichen(',
        'avesmapsUpdateEcosystemRegion' => 'avesmapsLandschaftWikiBeschriftungenAngleichen(',
        'avesmapsEcosystemRestoreAuditRow' => 'avesmapsLandschaftWikiNachRegionsWechsel(',
        'avesmapsEcosystemPushWikiRegionToLabels' => 'avesmapsLandschaftWikiBeschriftungenAngleichen(',
        'avesmapsEcosystemClearWikiRegionFromLabels' => 'avesmapsLandschaftWikiBeschriftungenAngleichen(',
    ],
    'api/_internal/wiki/regions.php' => [
        'avesmapsWikiRegionAssign' => 'avesmapsLandschaftWikiGebundeneBeschriftungen(',
        'avesmapsWikiRegionAssignAll' => 'avesmapsLandschaftWikiGebundeneBeschriftungen(',
        'avesmapsWikiRegionAssignLabels' => 'avesmapsLandschaftWikiRegionSetzen(',
    ],
];
foreach ($naehte as $datei => $funktionen) {
    $text = waechterOhneKommentare((string) file_get_contents($wurzel . '/' . $datei));
    foreach ($funktionen as $funktion => $aufruf) {
        assert(str_contains(waechterRumpf($text, $funktion), $aufruf),
            "4: {$datei} {$funktion} muss {$aufruf}...) rufen -- sonst schreibt dieser Weg wieder an der Region vorbei");
    }
}
$oeko = waechterOhneKommentare((string) file_get_contents($wurzel . '/api/_internal/app/ecosystem.php'));
assert(substr_count(waechterRumpf($oeko, 'avesmapsEcosystemRestoreAuditRow'), 'avesmapsLandschaftWikiNachReaktivierung(') === 2,
    '4: BEIDE Wege, die eine Region zurueckholen, gleichen ihre Beschriftungen an');
$wikiEndpunkt = waechterOhneKommentare((string) file_get_contents($wurzel . '/api/edit/wiki/regions.php'));
assert(str_contains($wikiEndpunkt, "avesmapsUserCan(\$user, 'edit')"),
    '4: der Regionen-Endpunkt reicht das Bearbeitungsrecht an „Label zuweisen" -- ohne es duerfte ein Reviewer Flaechen beschreiben');
$endpunkt = waechterOhneKommentare((string) file_get_contents($wurzel . '/api/edit/map/features.php'));
// ⚠️ Der Endpunkt laeuft beim Einbinden und laesst sich nicht ausfuehren -- deshalb am Quelltext, und zwar
// BEIDE Haelften: das Abholen UND das Herausgeben. Nur das Abholen zu pruefen liesse ein `labels`, das nie in
// der Antwort ankommt, gruen (Mutationsprobe M19, 15.09.2026).
assert(str_contains($endpunkt, 'avesmapsLandschaftWikiMitgezogeneAbholen(')
    && str_contains($endpunkt, "['labels' => \$mitgezogen]"),
    '4: der Karten-Endpunkt reicht die mitgezogenen Geschwister als `labels` heraus');
$landschaftEndpunkt = waechterOhneKommentare((string) file_get_contents($wurzel . '/api/edit/map/ecosystem.php'));
assert(str_contains($landschaftEndpunkt, "'landschaft_wiki_bestand' =>") && str_contains($landschaftEndpunkt, 'avesmapsLandschaftWikiBestand('),
    '4: der Landschaften-Endpunkt bietet den Bestandslauf an');

// ---- 5. Im Browser: wer ein Nest in einen Rumpf legt, ist bekannt --------------------------------------
// 🔴 Der Server entscheidet fuer jede gebundene Beschriftung selbst -- ein Browser-Rumpf kann die Invariante
// nicht brechen. Gezaehlt wird trotzdem: ein NEUER Absender soll bewusst angesehen werden.
$bekannteAbsender = [
    // Label einer frisch gezeichneten Region (create_label, gebunden -> der Server nimmt die Region).
    'js/map-features/map-features-ecosystem-draw.js' => 1,
    // Umbenennen aus dem Flaechendialog (update_label, gebunden -> an die Region gereicht, dort ein Nulllauf):
    // EIN Rumpf, zwei Formen in derselben Zeile (Schnappschuss oder ausdrueckliches `null`).
    'js/map-features/map-features-ecosystem-properties.js' => 2,
    // Label duplizieren (create_label; gebunden -> Region, frei -> die Kopie).
    'js/map-features/map-features-labels.js' => 1,
    // Beschriftungsdialog (create_label / update_label nur bei angefasster Zuweisung).
    'js/review/review-labels.js' => 1,
    // KEIN Rumpf: der Zustand fuer den Zuweisungskasten (avesmapsWikiAssignLandschaftslabelZustand).
    'js/review/review-label-wiki.js' => 2,
];
$absender = [];
foreach (waechterDateien($wurzel . '/js', '.js') as $pfad) {
    $relativ = substr($pfad, strlen(str_replace('\\', '/', $wurzel)) + 1);
    $text = (string) file_get_contents($pfad);
    // Auch in Anfuehrungszeichen (`"wiki_region": …`, `rumpf["wiki_region"] = …`) -- Befund des Pruefagenten.
    $anzahl = preg_match_all(
        '~(?<![\w.])[\'"]?wiki_region[\'"]?\s*:(?!:)|\.wiki_region\s*=(?!=)|\[\s*[\'"]wiki_region[\'"]\s*\]\s*=(?!=)~',
        $text
    );
    if ($anzahl > 0) {
        $absender[$relativ] = $anzahl;
    }
}
// 🪤 `===` vergleicht bei Arrays auch die REIHENFOLGE der Schluessel -- beide Seiten werden sortiert.
ksort($absender);
ksort($bekannteAbsender);
assert($absender === $bekannteAbsender,
    "5: ein Browser-Absender von `wiki_region` ist dazugekommen oder weggefallen -- pruefen, dass er ueber "
    . "create_label/update_label geht, dann in die Liste:\n" . json_encode($absender, JSON_PRETTY_PRINT));

echo "OK -- landschaft-wiki-schreiber-waechter: der Trichter ist der einzige Schreiber\n";
