<?php

declare(strict_types=1);

/**
 * Die vier Farbstufen einer Karte (Owner 07.09.2026: „nur Graustufe, Brauntoene, Farbig, Unbekannt").
 *
 * Bis dahin war es der Tri-Bool `is_color`, und dessen „nein" hiess dem Leser gegenueber
 * „schwarzweiss", waehrend der Editor dasselbe Feld „nein" nannte -- zwei Namen fuer einen Wert, und
 * fuer eine Sepia-Karte gab es gar keinen. Dieser Test haelt die drei Stellen fest, an denen der Umbau
 * still danebengehen kann:
 *
 *   1. den Normalisierer (ein fremder Wert darf keine Stufe erfinden),
 *   2. den BACKFILL des Bestands -- 449 der 536 Karten tragen ihre Farbigkeit heute in `is_color`,
 *   3. den UEBERGANGS-RUECKFALL des Wiki-Sandkastens, ohne den ein Sync anboete, 298 wiki-eigenen
 *      Karten ihre Farbigkeit zu nehmen.
 *
 * Gefahren wird gegen SQLite; die zwei Schreibwege des Backfills sind portabel formuliert.
 */

require_once __DIR__ . '/../citymaps.php';
require_once __DIR__ . '/../../wiki/citymap-sync.php';

// ---------------------------------------------------------------- 1. Der Normalisierer -------------
// Die drei Stufen kommen unveraendert durch.
assert(avesmapsCitymapColorMode('graustufen') === 'graustufen');
assert(avesmapsCitymapColorMode('braun') === 'braun');
assert(avesmapsCitymapColorMode('farbig') === 'farbig');

// 🔴 NULL BLEIBT „UNBEKANNT" -- die Kernregel der ganzen Datei (§3.1). Niemand hat es erfasst ist nie
// „es ist nicht farbig".
assert(avesmapsCitymapColorMode(null) === null);
assert(avesmapsCitymapColorMode('') === null);
assert(avesmapsCitymapColorMode('unbekannt') === null);

// Ein fremder Wert faellt auf „unbekannt", NIE auf eine Stufe. Das Auswahlfeld bietet genau vier
// Antworten an; ein anderer Wert kommt aus einer handgebauten Anfrage, und „wir wissen es nicht" ist
// dafuer die ehrliche Antwort -- ein Rueckfall auf 'graustufen' waere eine erfundene Tatsache.
assert(avesmapsCitymapColorMode('neon') === null);
assert(avesmapsCitymapColorMode('schwarzweiss') === null, 'die vom Owner verworfene Stufe erfindet nichts');

// 💣 DIE ZWEI ALTEN TRI-BOOL-ANTWORTEN BLEIBEN LESBAR. Ein Melde-Formular oder ein Editor aus einem
// offenen Tab schickt noch '1'/'0', und sie hiessen unveraendert farbig bzw. graustufen. Ohne diese
// Uebersetzung faellt so eine Antwort still auf „unbekannt" -- der Mensch hat geantwortet, und niemand
// merkt, dass die Antwort verlorenging.
assert(avesmapsCitymapColorMode('1') === 'farbig');
assert(avesmapsCitymapColorMode('0') === 'graustufen');
assert(avesmapsCitymapColorMode(true) === 'farbig');
assert(avesmapsCitymapColorMode(false) === 'graustufen');

// Die Tafel ist geschlossen und deutsch (AGENTS.md §8: Option-Slugs werden nie uebersetzt).
assert(AVESMAPS_CITYMAP_COLOR_MODES === ['graustufen', 'braun', 'farbig']);
assert(!in_array('', AVESMAPS_CITYMAP_COLOR_MODES, true), "'' ist kein Mitglied -- unbekannt ist NULL");
echo "farbstufen-normalisierer ok\n";

// ---------------------------------------------------------------- 2. Der Backfill -------------------
$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE citymap (id INTEGER PRIMARY KEY, is_color INTEGER NULL, color_mode TEXT NULL)');
$pdo->exec("INSERT INTO citymap (id, is_color, color_mode) VALUES
    (1, 1, NULL),      -- farbig, noch nicht migriert
    (2, 0, NULL),      -- graustufen, noch nicht migriert
    (3, NULL, NULL),   -- unbekannt, war es immer
    (4, 1, 'braun'),   -- ein Editor war schneller als der Backfill
    (5, NULL, 'farbig')-- schon migriert
");

// Der Backfill-Kern, wortgleich zu avesmapsCitymapsEnsureColorModeBackfill. Der Aufruf selbst laesst
// sich hier nicht fahren -- er ruft avesmapsCitymapsEnsureTables, und dessen DDL ist MySQL. Deshalb
// haelt der Quelltext-Vergleich unten die zwei Fassungen zeichengleich.
$backfill = "UPDATE citymap SET
            color_mode = CASE WHEN is_color = 1 THEN 'farbig' ELSE 'graustufen' END,
            is_color = NULL
         WHERE color_mode IS NULL AND is_color IS NOT NULL";

$pdo->exec($backfill);
$nach = static function (PDO $pdo): array {
    $out = [];
    foreach ($pdo->query('SELECT id, is_color, color_mode FROM citymap ORDER BY id')->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $out[(int) $row['id']] = [$row['is_color'], $row['color_mode']];
    }

    return $out;
};

// ⚠️ Verglichen wird die STUFE und OB die alte Spalte geleert wurde -- nie der Rohwert von is_color:
// SQLite liefert hier int(1), MySQL den String '1', und ein === darauf machte diesen Test
// treiberabhaengig, ohne dass es um den Treiber ginge.
$stand = $nach($pdo);
assert($stand[1] === [null, 'farbig'], 'is_color=1 wird farbig');
assert($stand[2] === [null, 'graustufen'], 'is_color=0 wird graustufen -- NICHT schwarzweiss');
assert($stand[3] === [null, null], 'unbekannt bleibt unbekannt');
// ⚠️ Diese Zeile behaelt ihr altes is_color -- der Backfill fasst sie nicht an, weil ihr color_mode
// schon etwas sagt. Das ist eine LEICHE, und sie ist harmlos: nach dem Umbau liest die Spalte niemand
// mehr (der Lesepfad selektiert color_mode, der Editor schreibt color_mode, der Sync vergleicht
// color_mode). Sie steht hier ausgeschrieben, damit der naechste Leser sie nicht fuer einen Fehler
// haelt und „aufraeumt" -- ein zusaetzliches Leeren waere ein Schreibvorgang ohne Zweck.
assert($stand[4][1] === 'braun', 'eine vom Editor gesetzte Stufe wird NICHT ueberschrieben');
assert($stand[4][0] !== null, 'und ihr altes is_color bleibt als Leiche stehen');
assert($stand[5] === [null, 'farbig'], 'eine schon migrierte Zeile bleibt, wie sie ist');

// 💣 DER RIEGEL: EINE ANGEFASSTE ZEILE IST FUER IHN UNSICHTBAR. Genau das macht ihn selbstbegrenzend
// und ersetzt einen Marker. Ohne das Leeren von is_color liefe er bei jedem Endpunkt-Aufruf erneut --
// und sobald ein Editor eine Karte bewusst auf „unbekannt" zuruecksetzt, schriebe der naechste
// Lesezugriff „farbig" zurueck: eine Entscheidung, die sich von selbst rueckgaengig macht.
$pdo->exec("UPDATE citymap SET color_mode = NULL WHERE id = 1"); // Editor: „doch unbekannt"
$pdo->exec($backfill);
assert($nach($pdo)[1] === [null, null], 'ein bewusstes „unbekannt" ueberlebt den naechsten Lauf');

// Und ein zweiter Lauf ohne Zutun aendert nichts mehr (Idempotenz).
$vorher = $nach($pdo);
$pdo->exec($backfill);
assert($nach($pdo) === $vorher, 'der zweite Lauf ist ein No-op');

// 🔴 DER BACKFILL DARF NICHT IN avesmapsCitymapsEnsureTables STEHEN. Die Funktion wird aus der
// RECHEN-Haelfte des Kartensammlungs-Syncs erreicht, und die schreibt in keine Nutztabelle
// (sync-plan-purity-test.php haelt das fest -- es hat den ersten Entwurf genau hier gefangen).
$libQuelle = file_get_contents(__DIR__ . '/../citymaps.php');
assert(is_string($libQuelle));
$ensureAnfang = strpos($libQuelle, 'function avesmapsCitymapsEnsureTables(');
$ensureEnde = strpos($libQuelle, 'function avesmapsCitymapsEnsureColorModeBackfill(');
assert($ensureAnfang !== false && $ensureEnde !== false && $ensureEnde > $ensureAnfang);
$ensureRumpf = substr($libQuelle, $ensureAnfang, $ensureEnde - $ensureAnfang);
assert(!str_contains($ensureRumpf, 'UPDATE citymap SET'), 'die Ensure-Funktion schreibt keine Daten');
assert(str_contains($ensureRumpf, "ADD COLUMN color_mode VARCHAR(16) NULL"),
    'sie legt die Spalte aber an -- ohne sie liefe der Sync in „Unknown column"');

// Und die im Test gefahrene Anweisung IST die des Produktivcodes -- ein Test gegen eine abgeschriebene
// Fassung prueft sich selbst.
$backfillAnfang = strpos($libQuelle, 'function avesmapsCitymapsEnsureColorModeBackfill(');
$backfillRumpf = substr($libQuelle, $backfillAnfang);
foreach (["color_mode = CASE WHEN is_color = 1 THEN 'farbig' ELSE 'graustufen' END",
    'is_color = NULL',
    'WHERE color_mode IS NULL AND is_color IS NOT NULL'] as $stueck) {
    assert(str_contains($backfillRumpf, $stueck), "der Produktivcode traegt: {$stueck}");
}
echo "farbstufen-backfill ok\n";

// ---------------------------------------------------------------- 3. Der Sandkasten-Rueckfall ------
// 💣 OHNE IHN BOETE DER SYNC AN, 298 WIKI-KARTEN IHRE FARBIGKEIT ZU NEHMEN. Zwischen dem Deploy und dem
// naechsten „Dump holen" liegen Stunden bis Tage, und in diesem Fenster ist `color_mode` im Sandkasten
// leer, waehrend `citymap.color_mode` schon migriert ist -- der Plan meldete dann „gewuenscht:
// unbekannt", vorangehakt, weil es wie eine echte Wiki-Aenderung aussieht.
assert(avesmapsCitymapStagingColorMode(['color_mode' => 'braun', 'is_color' => 1]) === 'braun',
    'die neue Spalte gewinnt, sobald sie etwas sagt');
assert(avesmapsCitymapStagingColorMode(['color_mode' => null, 'is_color' => 1]) === 'farbig');
assert(avesmapsCitymapStagingColorMode(['color_mode' => '', 'is_color' => 0]) === 'graustufen');
assert(avesmapsCitymapStagingColorMode(['color_mode' => null, 'is_color' => null]) === null,
    'unbekannt bleibt unbekannt -- der Rueckfall erfindet nichts');
assert(avesmapsCitymapStagingColorMode([]) === null, 'eine Zeile ohne beide Spalten ebenso');

// 🔴 BEIDE Leser des Sandkastens muessen ihn fahren: die Rechen-Haelfte (die den Plan baut) UND die
// Uebernahme (die ihn gegen den Sandkasten NEU rechnet). Faehrt ihn nur einer, schreibt die Uebernahme
// genau die Loeschung, die die Vorschau nie angeboten hat.
foreach ([
    __DIR__ . '/../../wiki/citymap-sync.php' => 'die Rechen-Haelfte',
    __DIR__ . '/../../wiki/citymap-plan-apply.php' => 'die Uebernahme',
] as $datei => $wer) {
    $quelle = file_get_contents($datei);
    assert(is_string($quelle));
    assert(str_contains($quelle, "\$catalog['color_mode'] = avesmapsCitymapStagingColorMode(\$catalog);"),
        "{$wer} faehrt den Uebergangs-Rueckfall");
}
echo "farbstufen-sandkasten ok\n";

// ---------------------------------------------------------------- 4. Die offene Altmeldung ---------
// 💣 EINE MELDUNG, DIE VOR DEM UMBAU EINGEREICHT WURDE UND NOCH OFFEN IN `map_reports` LIEGT, TRAEGT IN
// IHREM payload_json DEN ALTEN SCHLUESSEL `is_color` -- so hat das damalige Formular ihn verschickt.
// avesmapsCreateCitymapFromReport (api/edit/reports/locations.php) schickt dieses gespeicherte Payload
// beim GENEHMIGEN erneut durch avesmapsNormalizeCitymapReportPayload. Ohne den Rueckfall bekaeme die
// daraus angelegte Karte „unbekannt", obwohl der Melder geantwortet hat -- lautlos, und dem Pruefer
// faellt nichts auf, weil er das Formular nie gesehen hat.
$basis = ['title' => 'Stadtplan von Gareth', 'map_url' => 'https://example.org/g'];

$alt = avesmapsNormalizeCitymapReportPayload($basis + ['is_color' => '1']);
assert($alt['citymap']['color_mode'] === 'farbig', 'eine Altmeldung behaelt ihre Farbigkeit');
$alt0 = avesmapsNormalizeCitymapReportPayload($basis + ['is_color' => '0']);
assert($alt0['citymap']['color_mode'] === 'graustufen');

// 🔴 UND DER RUECKFALL DARF EINE HEUTIGE ANTWORT NICHT UEBERSCHREIBEN. Gemessen wird, OB der neue
// Schluessel da ist -- nicht, ob er einen Wert hat: ein heutiges Formular schickt `color_mode: ''`, und
// das ist die ANTWORT „unbekannt", keine Luecke. Faellt man auch darauf zurueck, schlaegt ein
// mitgeschicktes altes is_color die bewusste Wahl des Melders.
$neuLeer = avesmapsNormalizeCitymapReportPayload($basis + ['color_mode' => '', 'is_color' => '1']);
assert($neuLeer['citymap']['color_mode'] === null, "ein ausdrueckliches „unbekannt\" schlaegt den Rueckfall");
// 🪤 UND DIESE ZEILE IST DIE, DIE DEN UNTERSCHIED WIRKLICH MISST. Die darueber tut es NICHT: ein
// `??`-Rueckfall (`$data['color_mode'] ?? $data['is_color']`) behandelt '' voellig richtig, weil ??
// auf NULL prueft und nicht auf leer -- eine Mutation auf ?? blieb hier gruen, und der Kommentar am
// Produktivcode behauptete trotzdem, array_key_exists sei tragend. Nur ein AUSDRUECKLICHES null
// trennt die beiden Fassungen, und genau das schickt ein Client, der seine Leerwerte auf null
// normalisiert statt auf ''.
$neuNull = avesmapsNormalizeCitymapReportPayload($basis + ['color_mode' => null, 'is_color' => '1']);
assert($neuNull['citymap']['color_mode'] === null,
    "auch ein ausdrueckliches null ist eine ANTWORT -- der Schluessel ist da, also greift kein Rueckfall");
$neuGesetzt = avesmapsNormalizeCitymapReportPayload($basis + ['color_mode' => 'braun', 'is_color' => '1']);
assert($neuGesetzt['citymap']['color_mode'] === 'braun', 'und eine ausdrueckliche Stufe erst recht');

// Ohne beide Schluessel bleibt es bei unbekannt -- der Rueckfall erfindet nichts.
assert(avesmapsNormalizeCitymapReportPayload($basis)['citymap']['color_mode'] === null);
echo "farbstufen-altmeldung ok\n";

echo "citymap-farbstufen ok\n";
