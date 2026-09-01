<?php

declare(strict_types=1);

/**
 * Wappen-Angaben aendern, ohne ein neues Bild hochzuladen (Fall #112).
 * Ausfuehren (vom Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       api/_internal/wiki/__tests__/wappen-angaben-ohne-bild-test.php
 * Exit 0 = alle Zusicherungen erfuellt.
 *
 * 💣 WARUM ES DAS GIBT (Thomas, 01.09.2026): „Aktuell kann man nur bei der Erstellung der Wappen
 * die Quelle eingeben und nicht im Nachgang." Beide Wappen-Uploads -- der fuer Orte und der fuer
 * Herrschaftsgebiete -- verlangten IMMER Bilddaten und antworteten ohne Datei und ohne Adresse mit
 * „Bitte eine Bilddatei hochladen oder eine Bild-URL angeben."
 *
 * 💣 UND DIE GEFAEHRLICHE STELLE IST NICHT DIE ERLAUBNIS, SONDERN DAS AUFRAEUMEN. Der Endpunkt
 * loescht am Ende die Datei des VORHERIGEN Wappens. Auf dem neuen Weg IST das vorherige Wappen das
 * jetzige -- wuerde `url` mitgeschrieben oder der Aufraeumer nicht gesperrt, loeschte ein blosses
 * Korrigieren der Lizenz das angezeigte Bild und liesse eine Adresse zurueck, hinter der nichts
 * mehr liegt.
 *
 * Geprueft werden die zwei reinen Regeln aus api/_internal/wiki/settlements.php. Sie stehen dort
 * und nicht im Endpunkt, weil ein Endpunkt-Skript sich nicht einbinden laesst, ohne zu laufen.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos. "
        . "Erneut fahren mit: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require_once __DIR__ . '/../../bootstrap.php';
require_once __DIR__ . '/../settlements.php';

$pruefungen = 0;
$zaehl = static function () use (&$pruefungen): void { $pruefungen++; };

$WAPPEN = [
    'url' => '/uploads/wappen/own/ort-abc123.png',
    'source' => 'own',
    'license_status' => 'ai_generated',
    'author' => '',
    'note' => '',
    'uploaded_by' => 'Nottel',
    'uploaded_at' => '2026-08-01T10:00:00Z',
];

// ══ 1. WANN es der Weg „nur die Angaben" ist ════════════════════════════════════════════════════
assert(avesmapsSettlementCoatMetadataOnly(false, '', $WAPPEN) === true,
    'kein Bild, keine Adresse, aber ein vorhandenes Wappen -> nur die Angaben');
$zaehl();

// 🔴 Sobald ein Bild kommt, ist es der normale Upload -- sonst bliebe die alte Adresse stehen und
// das frisch hochgeladene Bild waere nirgends verlinkt.
assert(avesmapsSettlementCoatMetadataOnly(true, '', $WAPPEN) === false, 'mit Datei ist es ein Upload');
$zaehl();
assert(avesmapsSettlementCoatMetadataOnly(false, 'https://beispiel.de/w.png', $WAPPEN) === false,
    'mit Bild-Adresse ebenso');
$zaehl();

// ⚠️ Ohne vorhandenes Wappen gibt es nichts zu beschreiben -- die alte Absage bleibt genau dafuer
// stehen. Ein leerer Weg hier wuerde ein `coat` ohne Bild anlegen.
assert(avesmapsSettlementCoatMetadataOnly(false, '', null) === false, 'ohne Wappen bleibt die Absage');
$zaehl();
assert(avesmapsSettlementCoatMetadataOnly(false, '', []) === false, 'ein leeres Objekt ist kein Wappen');
$zaehl();
// 🔴 Gemessen wird die ADRESSE, nicht die blosse Anwesenheit des Objekts.
assert(avesmapsSettlementCoatMetadataOnly(false, '', ['source' => 'own']) === false,
    'ein coat OHNE url beschreibt kein Bild');
$zaehl();
assert(avesmapsSettlementCoatMetadataOnly(false, '', ['url' => '   ']) === false,
    'und eine Adresse aus Leerzeichen ist keine');
$zaehl();
// ⚠️ Eine Adresse aus Leerzeichen im Formular zaehlt als „keine Adresse" -- sonst liefe der
// Upload-Zweig mit einer leeren URL an und scheiterte erst beim Abruf.
assert(avesmapsSettlementCoatMetadataOnly(false, '   ', $WAPPEN) === true,
    'Leerzeichen im Adressfeld sind keine Adresse');
$zaehl();

// ══ 2. WAS sich aendert -- und vor allem, was NICHT ═════════════════════════════════════════════
$neu = avesmapsSettlementCoatMergeMetadata($WAPPEN, 'public_domain', 'VolkoV', 'Aus dem Briefspiel.');
assert($neu['license_status'] === 'public_domain', 'die Lizenz wird gesetzt');
$zaehl();
assert($neu['author'] === 'VolkoV', 'der Urheber ebenso');
$zaehl();
assert($neu['note'] === 'Aus dem Briefspiel.', 'und der Kommentar');
$zaehl();

// 💣 DIE VIER FELDER, DIE BLEIBEN MUESSEN.
// `url` ist die gefaehrlichste: der Aufraeumer am Ende des Endpunkts loescht die Datei der
// VORHERIGEN Adresse. Zeigten beide auf dieselbe Datei und liefe er mit, loeschte ein blosses
// Korrigieren der Lizenz das angezeigte Bild.
assert($neu['url'] === $WAPPEN['url'], 'die Bild-Adresse bleibt unberuehrt');
$zaehl();
// `source` entscheidet, ob ein Wiki-Abgleich ueberschreiben darf (avesmapsWikiSettlementBulkRecordCoats:
// source='own' wird NIE ueberschrieben). Es zu verlieren gaebe das eigene Wappen zum Ueberschreiben frei.
assert($neu['source'] === 'own', 'die Herkunft bleibt -- an ihr haengt der Ueberschreib-Schutz');
$zaehl();
// `uploaded_by`/`uploaded_at` bezeugen, WER WANN DAS BILD hochgeladen hat. Eine Korrektur an der
// Lizenz hat daran nichts geaendert; sie mitzuschreiben waere ein gefaelschter Nachweis.
assert($neu['uploaded_by'] === 'Nottel' && $neu['uploaded_at'] === '2026-08-01T10:00:00Z',
    'der Upload-Nachweis bleibt stehen -- er gilt dem BILD, nicht den Angaben');
$zaehl();

// ⚠️ Und nichts kommt dazu: genau die sieben Schluessel wie vorher.
assert(array_keys($neu) === array_keys($WAPPEN), 'es entstehen keine neuen Schluessel');
$zaehl();

// ⚠️ Unbekannte Zusatzfelder eines aelteren Bestands ueberleben ebenfalls -- der Weg beschreibt
// drei Felder, er baut das Wappen nicht neu.
$mitExtra = avesmapsSettlementCoatMergeMetadata(
    array_merge($WAPPEN, ['attribution' => 'Wiki Aventurica']), 'public_domain', '', '');
assert(($mitExtra['attribution'] ?? null) === 'Wiki Aventurica',
    'ein fremdes Zusatzfeld ueberlebt, statt beim Speichern zu verschwinden');
$zaehl();

// 🔴 Leeren MUSS moeglich sein: wer einen falsch eingetragenen Urheber loeschen will, muss das
// koennen. Ein Rueckfall auf den Bestand waere hier eine Einbahnstrasse.
$geleert = avesmapsSettlementCoatMergeMetadata(
    array_merge($WAPPEN, ['author' => 'Falsch', 'note' => 'Falsch']), 'ai_generated', '', '');
assert($geleert['author'] === '' && $geleert['note'] === '',
    'ein falscher Urheber laesst sich wieder loeschen');
$zaehl();

// ══ 3. Der Endpunkt benutzt WIRKLICH diese zwei Regeln ══════════════════════════════════════════
// 🪤 Ohne diese Gegenprobe koennte der Endpunkt seine eigene Fassung tragen, waehrend hier eine
// unbenutzte Bibliotheksregel gruen gemessen wird -- die Divergenz, vor der AGENTS.md warnt.
// ⚠️ Kommentare werden vorher entfernt: ein Quelltext-Test, der die ERKLAERUNG trifft statt des
// Aufrufs, ist im Haus schon mehrfach gruen geblieben, ohne etwas zu pruefen.
$endpunkt = (string) file_get_contents(__DIR__ . '/../../../edit/wiki/settlement-coat-upload.php');
$ohneKommentare = preg_replace('#/\*[\s\S]*?\*/|^\s*//.*$#m', '', $endpunkt) ?? '';
assert(str_contains($ohneKommentare, 'avesmapsSettlementCoatMetadataOnly('),
    'der Endpunkt fragt die Weiche wirklich hier ab');
$zaehl();
assert(str_contains($ohneKommentare, 'avesmapsSettlementCoatMergeMetadata('),
    'und baut das Wappen wirklich hiermit');
$zaehl();
// 💣 DER AUFRAEUMER MUSS GESPERRT SEIN. Ohne `!$nurAngaben` loescht ein blosses Korrigieren der
// Lizenz die Bilddatei, die weiterhin angezeigt wird -- und `$docroot` ist auf diesem Weg gar
// nicht definiert.
assert(preg_match('/if \(!\$nurAngaben && is_array\(\$previous\)/', $ohneKommentare) === 1,
    'das Aufraeumen der alten Bilddatei ist auf dem Angaben-Weg gesperrt');
$zaehl();
// 🔴 Und der Upload-Stempel wird NUR im Bild-Zweig gesetzt.
$angabenZweig = substr($ohneKommentare, (int) strpos($ohneKommentare, 'if ($nurAngaben) {'));
$angabenZweig = substr($angabenZweig, 0, (int) strpos($angabenZweig, '} else {'));
assert(!str_contains($angabenZweig, 'uploaded_at'),
    'der Angaben-Weg setzt keinen neuen Upload-Stempel');
$zaehl();

// ══ 4. Die zweite Tuer: der Territorien-Dialog kann es auch ═════════════════════════════════════
// 💣 Eine Sperre, die eine von zwei Tueren zuhaelt, ist keine Sperre -- derselbe Satz steht im
// Kopf des Siedlungs-Uploads ueber der SVG-Freigabe. Beide Wappen-Dialoge hatten denselben
// Defekt; einen zu reparieren und den anderen nicht, haette die Meldung halb offen gelassen.
$monitor = (string) file_get_contents(__DIR__ . '/../../../../html/wiki-sync-monitor.html');
// 🪤 DEFINITION UND AUFRUF GETRENNT PRUEFEN. Ein blosses str_contains('saveCoatFieldsOnly') ist
// schon durch die AUFRUFZEILE erfuellt -- die Funktion koennte geloescht sein und der Test bliebe
// gruen, waehrend der Dialog mit einem ReferenceError abbricht. Genau diese Mutation hat den Test
// in seiner ersten Fassung ueberlebt.
assert(preg_match('/function saveCoatFieldsOnly\s*\(/', $monitor) === 1,
    'der Territorien-Dialog DEFINIERT einen Weg fuer „nur die Angaben"');
$zaehl();
assert(preg_match('/await saveCoatFieldsOnly\s*\(/', $monitor) === 1,
    'und er RUFT ihn auch -- eine ungerufene Funktion ist toter Code');
$zaehl();
// 🔴 Er geht ueber `set_field_override` -- den Weg, den dieser Editor fuer jedes andere Feld schon
// nimmt. Eine eigene Schreibweise waere die zweite Wahrheit ueber dieselben drei Felder.
// 🪤 Gesucht wird IM RUMPF dieser Funktion, nicht in der ganzen Datei: alle drei Feldnamen stehen
// auch in `openWappenDialog`, ein dateiweites str_contains haette also nichts gemessen.
$rumpfStart = (int) strpos($monitor, 'async function saveCoatFieldsOnly');
$rumpf = substr($monitor, $rumpfStart, (int) strpos($monitor, 'async function uploadCoat') - $rumpfStart);
foreach (['coat_of_arms_license_status', 'coat_of_arms_author', 'coat_of_arms_note'] as $feld) {
    assert(str_contains($rumpf, $feld), 'er schreibt ' . $feld);
    $zaehl();
}
assert(str_contains($rumpf, 'set_field_override'), 'und zwar ueber den vorhandenen Feld-Setzer');
$zaehl();
// ⚠️ Und diese drei Feldnamen muessen in der Allowlist des Setzers stehen, sonst antwortet er
// „Feld … ist nicht editierbar." -- was im Dialog wie ein Serverfehler aussaehe.
$identity = (string) file_get_contents(__DIR__ . '/../sync-monitor-identity.php');
foreach (['coat_of_arms_license_status', 'coat_of_arms_author', 'coat_of_arms_note'] as $feld) {
    assert(preg_match("/'" . $feld . "' =>/", $identity) === 1,
        $feld . ' steht in der Allowlist der editierbaren Felder');
    $zaehl();
}

fwrite(STDOUT, "OK -- {$pruefungen} Zusicherungen erfuellt (Wappen-Angaben ohne neues Bild).\n");
exit(0);
