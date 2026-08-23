<?php

declare(strict_types=1);

/**
 * DIE ZWEI WAPPEN-UPLOADS SIND GLEICH. Owner-Auftrag 23.08.2026: „vereinheitliche den upload
 * dialog und die buttons daneben". Lauf:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/wappen-upload-gleichstand-test.php
 *
 * 🔴 Der Sinn ist nicht, den heutigen Zustand einzufrieren, sondern zu verhindern, dass die beiden
 * Dialoge WIEDER auseinanderlaufen. Sie taten es jahrelang unbemerkt: Territorium 5 MB / SVG /
 * Bild-URL, Siedlung 2 MB / kein SVG / nur Datei -- niemandem faellt das auf, weil man immer nur
 * einen von beiden offen hat.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'. Neu starten mit: "
        . "php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

$ROOT = dirname(__DIR__, 4);
$lies = static function (string $rel) use ($ROOT): string {
    $pfad = $ROOT . '/' . $rel;
    assert(is_file($pfad), "Datei existiert: $rel");
    return (string) file_get_contents($pfad);
};

$siedlung   = $lies('api/edit/wiki/settlement-coat-upload.php');
$territorium = $lies('api/_internal/wiki/sync-monitor-identity.php');
$dialogSied = $lies('html/wiki-sync-settlement-editor.html');
$dialogTerr = $lies('html/wiki-sync-monitor.html');

// ---- 1. Dieselbe Groessengrenze ---------------------------------------------------------------
assert(strpos($siedlung, '5 * 1024 * 1024') !== false,
    'Siedlung: 5 MB wie das Territorium (war 2 MB)');
assert(strpos($territorium, '$maxBytes = 5 * 1024 * 1024') !== false,
    'Territorium: unveraendert 5 MB -- laeuft der Wert hier weg, gehoert der andere nachgezogen');

// ---- 2. Dieselben Formate ---------------------------------------------------------------------
// 💣 SVG ist der Grund, warum dieser Test existiert: es war bei der Siedlung ausdruecklich
// verboten („XSS-Risiko bei eigenen Uploads") und beim Territorium seit jeher erlaubt -- also
// stand die Tuer ohnehin offen, nur die Dialoge waren verschieden.
foreach (['png', 'jpeg', 'svg+xml', 'gif', 'webp'] as $typ) {
    assert(strpos($siedlung, "image/$typ") !== false, "Siedlung nimmt image/$typ");
    assert(strpos($territorium, "image/$typ") !== false, "Territorium nimmt image/$typ");
}

// ---- 3. 🔴 DIE KOPPLUNG, DIE HIER AM WICHTIGSTEN IST -----------------------------------------
// SVG ist nur deshalb erlaubt, weil /uploads/wappen/.htaccess jedem .svg eine CSP mitgibt. Faellt
// die Datei weg, faellt die Begruendung -- und dann gehoert SVG an BEIDEN Uploads zurueckgedreht.
// Ohne diese Zusicherung merkt das niemand: ein geloeschtes .htaccess sieht man in keinem Dialog.
$htaccess = $ROOT . '/uploads/wappen/.htaccess';
assert(is_file($htaccess),
    '💣 uploads/wappen/.htaccess fehlt -- damit ist die Begruendung fuer erlaubtes SVG weg. '
    . 'Entweder die Datei zurueckholen oder SVG an BEIDEN Uploads sperren.');
$schutz = (string) file_get_contents($htaccess);
assert(strpos($schutz, 'Content-Security-Policy') !== false && strpos($schutz, 'sandbox') !== false,
    'und sie setzt weiterhin CSP + sandbox fuer .svg');
assert(strpos($schutz, '.svg') !== false, 'und zwar fuer .svg-Dateien');

// 🔴 Und sie muss im Deploy stehen, sonst liegt sie nur im Repo. Genau das war sie zwei Laeufe
// lang (23.08.2026): im Repo, in der Allowlist, und trotzdem ohne Wirkung auf dem Server.
$workflow = $lies('.github/workflows/deploy-avesmaps-strato.yml');
assert(strpos($workflow, 'uploads/wappen/.htaccess') !== false,
    'die .htaccess steht in der Deploy-Allowlist -- sonst kommt sie nie auf den Server');

// ---- 4. Beide nehmen Datei ODER Bild-URL ------------------------------------------------------
assert(strpos($siedlung, "\$_POST['coat_url']") !== false, 'Siedlung nimmt eine Bild-URL an');
assert(strpos($siedlung, '$_FILES[\'coat\']') !== false, 'und weiterhin eine Datei');
assert(strpos($territorium, '$sourceUrl') !== false, 'Territorium nimmt eine Bild-URL an');

// ---- 5. 🔴 Der URL-Zweig der Siedlung geht ueber den SSRF-GESCHUETZTEN Fetcher ----------------
// Die Adresse kommt aus einem Eingabefeld. Ohne Riegel liesse sich der Server damit auf
// 169.254.169.254 (Cloud-Metadaten) schicken. avesmapsLinkCheckFetchBody hat den Riegel,
// avesmapsWikiSyncMonitorHttpGetBinary hat ihn nicht.
$posUrl = strpos($siedlung, "\$_POST['coat_url']");
$abUrl = substr($siedlung, $posUrl, 2500);
assert(strpos($abUrl, 'avesmapsLinkCheckFetchBody') !== false,
    'DER KERN VON TEIL 5: der URL-Zweig nutzt den Fetcher MIT SSRF-Riegel, nicht den ohne');
assert(strpos($abUrl, 'avesmapsWikiAusdruecklicherAbruf') !== false,
    'und ist als ausdrueckliche Editor-Aktion gewickelt -- sonst blockt ihn der Datei-Riegel');

// 💣 Und der Fetcher muss auch GELADEN sein. Fehlt das require, ist der ganze Zweig ein Fatal
// Error -- und ein Fatal antwortet mit LEEREM Rumpf, was im Browser wie ein Netzfehler aussieht.
assert(strpos($siedlung, "linkcheck/probe.php") !== false,
    'und linkcheck/probe.php wird requiret');

// ---- 6. Der Typ kommt aus den BYTES, nicht aus dem Content-Type der Gegenseite ----------------
assert(strpos($siedlung, '->buffer(') !== false,
    'finfo->buffer auf den Bytes -- die Ulisses-CDN meldet "image/jpg", was kein MIME-Typ ist; '
    . 'wer dem Header glaubt, lehnt gueltige Bilder ab und nimmt ungueltige an');

// ---- 7. Und die Dialoge sagen dasselbe --------------------------------------------------------
foreach ([['Siedlung', $dialogSied], ['Territorium', $dialogTerr]] as [$wo, $markup]) {
    assert(strpos($markup, 'Datei ODER URL angeben. Maximale Größe 5 MB.') !== false,
        "$wo: derselbe Hinweistext -- unterschiedliche Angaben sind schlimmer als gar keine");
}
assert(strpos($dialogSied, 'id="seWappenUrl"') !== false, 'Siedlungs-Dialog hat das URL-Feld');

// 💣 UND DER HANDLER SCHICKT SIE AUCH. Das Feld allein ist Deko: die erste Fassung dieses Tests
// war gruen, waehrend uploadSettlementCoat den Wert gar nicht anfasste -- ein Eingabefeld, in das
// man tippt und in dem nichts passiert. Ein gruener Test ohne Verdrahtung beweist nichts.
$posUpload = strpos($dialogSied, 'async function uploadSettlementCoat');
assert($posUpload !== false, 'uploadSettlementCoat existiert');
$rumpfUpload = substr($dialogSied, $posUpload, 1800);
assert(strpos($rumpfUpload, 'seWappenUrl') !== false,
    'DER KERN: der Upload-Handler LIEST das URL-Feld');
assert(strpos($rumpfUpload, 'formData.append("coat_url"') !== false,
    'und schickt es unter genau dem Namen, den der Server liest: coat_url');
// ⚠️ Ein stehengebliebener Wert wuerde beim NAECHSTEN Ort mitgeschickt.
assert(strpos($dialogSied, 'urlInputReset') !== false,
    'und leert es beim Oeffnen -- sonst verpasst eine alte Adresse dem naechsten Ort ein Wappen');

// ---- 8. Und sie SEHEN gleich aus ---------------------------------------------------------------
// 🔴 Owner 23.08.2026: "diese beiden solltest du auch visuell gleichziehen". Die Wappen-Aktionen
// sind in BEIDEN Editoren leichte Textlinks (.dt-link), nicht Knoepfe. Im Territorien-Monitor
// standen sie als drei gefuellte Knoepfe zwischen "Eltern sperren" und "Editieren" -- die haben
// mit dem Wappen nichts zu tun, und ein Wappen zu tauschen ist eine Nebenhandlung (AGENTS.md §12).
foreach ([['Siedlungs-Editor', $dialogSied], ['Territorien-Monitor', $dialogTerr]] as [$wo, $markup]) {
    assert(strpos($markup, 'class="dt-link"') !== false,
        "$wo: die Wappen-Aktionen sind Textlinks (.dt-link), keine Knoepfe");
    // ⚠️ .dt-link kommt aus editor-page.css -- ohne sie waere die Zeile unformatiert.
    assert(strpos($markup, 'css/components/editor-page.css') !== false,
        "$wo laedt editor-page.css, wo .dt-link definiert ist");
}
$editorCss = $lies('css/components/editor-page.css');
assert(strpos($editorCss, '.dt-link') !== false, '.dt-link ist dort auch wirklich definiert');

// 💣 Und im Monitor darf keiner der Wappen-Knoepfe zurueckkommen: die alte Form hatte sie als
// edbtn in der dt-actions-Reihe. Faellt einer dorthin zurueck, laufen die Oberflaechen wieder
// auseinander -- und das faellt niemandem auf, weil man immer nur eine von beiden offen hat.
$posActions = strpos($dialogTerr, 'class="dt-actions">${lockBtn}');
assert($posActions !== false, 'die Knopfreihe existiert noch (fuer Eltern/Editieren)');
$actionsZeile = substr($dialogTerr, $posActions, 160);
foreach (['coatLocalBtn', 'coatRestoreBtn', 'coatRemoveBtn'] as $altBtn) {
    assert(strpos($actionsZeile, $altBtn) === false,
        "kein $altBtn mehr in der Knopfreihe -- die Wappen-Aktionen stehen in der Linkzeile");
}

echo "OK: wappen-upload-gleichstand-test -- alle Zusicherungen gehalten\n";
