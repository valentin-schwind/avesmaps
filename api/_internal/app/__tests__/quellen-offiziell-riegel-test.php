<?php

declare(strict_types=1);

/**
 * DER „OFFIZIELL“-RIEGEL: nur eine AUSDRUECKLICHE Wahl schreibt `is_official` einer bestehenden Katalogzeile,
 * und nie einer wiki-gepflegten.
 *
 * 💣 WARUM ES DAS GIBT (03.09.2026, Abnahmelauf von Schritt 3 des Quellen-Umbaus): der Katalog-Upsert schrieb den
 * Kanon-Haken des Eingabeformulars BEDINGUNGSLOS in die bestehende Zeile. Ein Editor, der eine bekannte Adresse
 * eintrug und den Haken nie anfasste, legte damit „offiziell = nein“ fest -- katalogweit. Live an „Geographia
 * Aventurica“ (1.319 Objekte) ausgeloest; das ✎ verweigert dieselbe Aenderung mit `wiki_owned_field`, der
 * Eintrage-Weg kannte den Riegel nicht. Dieselbe Klasse wie Meldung #105 (die Art, `source_type_chosen`).
 *
 * Geprueft werden:
 *   1. avesmapsSourceOfficialWriteAllowed -- die Wahrheitstafel (neu · nicht gewaehlt · gewaehlt · wiki-gepflegt)
 *   2. der ON-DUPLICATE-Teil des Upserts mit und ohne Schreiberlaubnis
 *   3. die Vorgaben per Reflection: der Editor-Eintrag sagt NEIN, der Upsert (Wiki-Abgleich, Importe) bleibt bei JA
 *   4. der Bericht „verknuepft statt neu“ nennt die Verweigerung
 *   5. der Endpunkt liest `is_official_chosen` und reicht es an BEIDE Eintrage-Aufrufe (einzeln und verteilt)
 *
 * Aus der Wurzel des Repos:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/app/__tests__/quellen-offiziell-riegel-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos. "
        . "Erneut fahren mit: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

function avesmapsNextMapRevision(PDO $pdo): int
{
    return 1;
}

require_once __DIR__ . '/../../bootstrap.php';
require_once __DIR__ . '/../feature-sources.php';

$pruefungen = 0;
$zaehl = static function () use (&$pruefungen): void { $pruefungen++; };

// ── 1) Die Wahrheitstafel ─────────────────────────────────────────────────────────────────────
assert(avesmapsSourceOfficialWriteAllowed(false, null) === true, 'eine NEUE Zeile braucht den Wert -- der Haken gilt, wie er steht');
$zaehl();
assert(avesmapsSourceOfficialWriteAllowed(true, null) === true, '… auch mit Wahl');
$zaehl();
assert(avesmapsSourceOfficialWriteAllowed(false, ['id' => 58, 'is_official' => 1, 'wiki_key' => null]) === false,
    'nicht gewaehlt: eine bestehende Zeile bleibt unberuehrt -- der Fall Geographia Aventurica');
$zaehl();
assert(avesmapsSourceOfficialWriteAllowed(true, ['id' => 58, 'is_official' => 1, 'wiki_key' => null]) === true,
    'gewaehlt und nicht wiki-gepflegt: darf schreiben');
$zaehl();
assert(avesmapsSourceOfficialWriteAllowed(true, ['id' => 58, 'is_official' => 1, 'wiki_key' => 'wiki:geographia-aventurica']) === false,
    'gewaehlt, aber wiki-gepflegt: NIE -- das ✎ verweigert dasselbe mit wiki_owned_field');
$zaehl();
assert(avesmapsSourceOfficialWriteAllowed(true, ['id' => 58, 'wiki_key' => '  ']) === true, 'ein leerer Schluessel ist keiner');
$zaehl();

// ── 2) Der Upsert: mit Erlaubnis der Korpus-Riegel, ohne Erlaubnis gar nichts ────────────────
$mit = avesmapsSourceUpsertOnDuplicateSql(false, false, true);
$ohne = avesmapsSourceUpsertOnDuplicateSql(false, false, false);
$vorgabe = avesmapsSourceUpsertOnDuplicateSql(false, false);
assert(str_contains($mit, "is_official = IF(own_fields NOT LIKE '%,is_official,%', VALUES(is_official), is_official)"),
    'mit Erlaubnis schreibt der Upsert -- hinter dem Korpus-Riegel own_fields');
$zaehl();
assert(str_contains($ohne, 'is_official = is_official,') && !str_contains($ohne, 'VALUES(is_official)'),
    'ohne Erlaubnis bleibt is_official, was es war');
$zaehl();
assert($vorgabe === $mit, 'die Vorgabe des SQL-Bauers ist JA -- Wiki-Abgleich und Importe aendern ihr Verhalten nicht');
$zaehl();
foreach ([$mit, $ohne] as $sql) {
    assert(str_contains($sql, "license = IF(VALUES(license) = '', license, VALUES(license))"), 'die Nachbarfelder verrutschen nicht');
    $zaehl();
}

// ── 3) Die Vorgaben, per Reflection festgenagelt ─────────────────────────────────────────────
$add = new ReflectionFunction('avesmapsAddFeatureSource');
$params = [];
foreach ($add->getParameters() as $p) {
    $params[$p->getName()] = $p;
}
assert(isset($params['officialChosen']) && $params['officialChosen']->isDefaultValueAvailable()
    && $params['officialChosen']->getDefaultValue() === false,
    'avesmapsAddFeatureSource: die Wahl heisst officialChosen und ist per Vorgabe NEIN -- Gemeinschaftsmeldung und Import verknuepfen nur');
$zaehl();
$upsert = new ReflectionFunction('avesmapsFeatureSourceUpsert');
$uparams = [];
foreach ($upsert->getParameters() as $p) {
    $uparams[$p->getName()] = $p;
}
assert(isset($uparams['setOfficial']) && $uparams['setOfficial']->getDefaultValue() === true,
    'avesmapsFeatureSourceUpsert: setOfficial ist per Vorgabe JA -- der Abgleich pflegt den Wert seit jeher');
$zaehl();
$rumpf = file_get_contents(__DIR__ . '/../feature-sources.php');
$addRumpf = substr($rumpf, strpos($rumpf, 'function avesmapsAddFeatureSource('));
$addRumpf = substr($addRumpf, 0, strpos($addRumpf, "\nfunction ", 10));
assert(str_contains($addRumpf, 'avesmapsSourceOfficialWriteAllowed($officialChosen, $bestehendeZeile)'),
    'der Eintrage-Weg fragt den Riegel mit SEINER Wahl und dem Bestand');
$zaehl();
assert(str_contains($addRumpf, 'is_official, wiki_key FROM sources WHERE url_hash'),
    'und liest dafuer den wiki_key des Bestands -- ohne ihn kann der Riegel die Wiki-Pflege nicht sehen');
$zaehl();
assert(str_contains($addRumpf, '$license, $attribution, $retype, $setOfficial);'),
    'und reicht die Antwort des Riegels an den Upsert -- ein Riegel, den niemand weiterreicht, ist keiner');
$zaehl();

// ── 4) Der Bericht nennt die Verweigerung ─────────────────────────────────────────────────────
$bericht = avesmapsFeatureSourceLinkedReport(['id' => 58, 'label' => 'Geographia Aventurica', 'is_official' => 1], 'Geographia Aventurica', true, true);
assert($bericht['official_refused'] === true && $bericht['official_changed'] === false,
    'gewaehlt, aber verweigert: refused ja, changed nein -- gemeldet wird, was wirklich gespeichert ist');
$zaehl();
$bericht = avesmapsFeatureSourceLinkedReport(['id' => 58, 'label' => 'Geographia Aventurica', 'is_official' => 1], 'Geographia Aventurica', true);
assert($bericht['official_refused'] === false, 'die Vorgabe des Berichts ist „nicht verweigert“');
$zaehl();

// ── 5) Der Endpunkt reicht die Wahl an BEIDE Eintrage-Aufrufe ────────────────────────────────
$endpunkt = '';
foreach (token_get_all((string) file_get_contents(__DIR__ . '/../../../edit/map/feature-sources.php')) as $token) {
    if (is_array($token)) {
        if (in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
            continue;
        }
        $endpunkt .= $token[1];
    } else {
        $endpunkt .= $token;
    }
}
assert(str_contains($endpunkt, "\$offiziellGewaehlt = (\$payload['is_official_chosen'] ?? false) === true;"),
    'der Endpunkt liest is_official_chosen als eigenen Schluessel, strikt true');
$zaehl();
assert(substr_count($endpunkt, ', $artGewaehlt, $offiziellGewaehlt);') === 2,
    'und reicht ihn an beide Eintrage-Aufrufe -- den einzelnen und den verteilten (eine Regel, die einen von zwei bindet, ist keine)');
$zaehl();

echo "quellen-offiziell-riegel: {$pruefungen} Pruefungen bestanden\n";
