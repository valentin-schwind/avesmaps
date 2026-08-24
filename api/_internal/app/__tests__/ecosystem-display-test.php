<?php

declare(strict_types=1);

// Die Pruefung der Darstellungstafel. Entwurf §8
// (docs/superpowers/specs/2026-08-24-landschaften-darstellung-design.md).
//
// 🔴 DER SERVER KENNT DIE VORGABEN NICHT und fuehrt KEINE Artenliste -- er prueft Form und
// Schranken, ueber die Namen entscheidet der Browser. Dieselbe Arbeitsteilung wie bei den
// Zoombaendern (api/_internal/app/zoom-bands.php): laege die Tafel auch hier, gaebe es sie zweimal
// und sie liefen auseinander.
//
// Aus der Wurzel des Repos:
//   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/ecosystem-display-test.php

require_once __DIR__ . '/../app-setting.php';
require_once __DIR__ . '/../ecosystem-display.php';

/**
 * SQLite spricht kein MySQL. Zwei Stellen werden uebersetzt, sonst nichts:
 *  - das CREATE TABLE aus avesmapsAppSettingEnsureTable (ENGINE=InnoDB kennt SQLite nicht)
 *  - das ON DUPLICATE KEY UPDATE aus avesmapsAppSettingSet
 * ⭐ Woertlich die Huelle aus api/_internal/app/__tests__/zoom-bands-test.php -- dieselbe Frage,
 * dieselbe Antwort. 💣 Uebersetzt wird NUR der Dialekt, nie die REGEL: wer die Produktionsform
 * verbiegt, damit ein Test laeuft, hat den Test gegen die Produktion gedreht (AGENTS.md §9,
 * MySQL-Fehler 1093).
 */
final class AvesmapsEcosystemDisplayTestPdo extends PDO
{
    public function exec($statement): int|false
    {
        if (str_contains((string) $statement, 'CREATE TABLE IF NOT EXISTS app_setting')) {
            return parent::exec(
                'CREATE TABLE IF NOT EXISTS app_setting (
                    setting_key TEXT PRIMARY KEY,
                    setting_value TEXT NOT NULL,
                    updated_at TEXT
                )'
            );
        }
        return parent::exec($statement);
    }

    public function prepare($query, $options = []): PDOStatement|false
    {
        $query = str_replace(
            'ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
            'ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value',
            (string) $query
        );
        return parent::prepare($query, $options);
    }
}

// ---- A. Form ---------------------------------------------------------------------------------
assert(avesmapsEcosystemDisplayValidate('nein') === null, 'ein String ist keine Tafel');
assert(avesmapsEcosystemDisplayValidate(42) === null, 'eine Zahl auch nicht');
// 💣 Eine blanke JSON-Liste kaeme sonst glatt durch: `$x['farbe'] ?? []` findet keinen Schluessel
// und liefert leere Zeilen, statt abzulehnen. Genau dieser Test war bei den Zoombaendern ROT.
assert(avesmapsEcosystemDisplayValidate([1, 2, 3]) === null, 'eine Liste ist keine Tafel');
// ⚠️ Eine LEERE Tafel bleibt gueltig: JSON `{}` und `[]` sind nach json_decode(..., true)
// ununterscheidbar, und `{}` (nichts uebersteuert) ist ein gueltiger Fall.
assert(is_array(avesmapsEcosystemDisplayValidate([])), 'eine leere Tafel ist gueltig');

// ---- B. Namensfarben --------------------------------------------------------------------------
$ok = avesmapsEcosystemDisplayValidate(['farbe' => ['wald' => '#bfeec8']]);
assert($ok['farbe']['wald'] === '#bfeec8', 'ein Sechsstellen-Hexwert geht durch');
assert(avesmapsEcosystemDisplayValidate(['farbe' => ['wald' => 'rot']]) === null, 'ein Farbname nicht');
assert(avesmapsEcosystemDisplayValidate(['farbe' => ['wald' => '#fff']]) === null, 'auch keine Kurzform');
assert(avesmapsEcosystemDisplayValidate(['farbe' => ['WALD' => '#ffffff']]) === null,
    'Grossbuchstaben im Schluessel nicht');
assert(avesmapsEcosystemDisplayValidate(['farbe' => ['wald' => 123]]) === null, 'und keine Zahl');

// ---- C. Flaechentoene (Schluessel kind:type) --------------------------------------------------
$ok = avesmapsEcosystemDisplayValidate(['flaeche' => ['vegetation:wald' => '#3f6b2c']]);
assert($ok['flaeche']['vegetation:wald'] === '#3f6b2c', 'ein kind:type-Schluessel geht durch');
assert(avesmapsEcosystemDisplayValidate(['flaeche' => ['wald' => '#3f6b2c']]) === null,
    'ohne Ebene nicht -- der Schluessel traegt beide Teile');

// ---- D. Deckkraft ------------------------------------------------------------------------------
$ok = avesmapsEcosystemDisplayValidate(['deckkraft' => ['vegetation:wald' => 0.72]]);
assert($ok['deckkraft']['vegetation:wald'] === 0.72, '0 bis 1 geht durch');
assert(avesmapsEcosystemDisplayValidate(['deckkraft' => ['vegetation:wald' => 1.5]]) === null, 'ueber 1 nicht');
assert(avesmapsEcosystemDisplayValidate(['deckkraft' => ['vegetation:wald' => -0.1]]) === null, 'unter 0 nicht');
// 💣 KEINE STRINGS. "0.5" sieht aus wie eine Zahl und ist keine; JSON kennt den Unterschied.
assert(avesmapsEcosystemDisplayValidate(['deckkraft' => ['vegetation:wald' => '0.5']]) === null,
    'ein String nicht');

// ---- E. Die globale Deckkraft je Ebene ---------------------------------------------------------
$ok = avesmapsEcosystemDisplayValidate(['global' => ['vegetation' => ['an' => true, 'wert' => 0.72]]]);
assert($ok['global']['vegetation']['an'] === true, 'das Haekchen geht durch');
assert($ok['global']['vegetation']['wert'] === 0.72, 'und sein Wert');
assert(avesmapsEcosystemDisplayValidate(['global' => ['vegetation' => ['an' => 'ja']]]) === null,
    'ein String ist kein Haekchen');

// ---- F. Groessenzeile --------------------------------------------------------------------------
$neun = [9, 11, 13, 14, 16, 18, 19, 21, 21];
$ok = avesmapsEcosystemDisplayValidate(['groesse' => ['wald' => $neun]]);
assert($ok['groesse']['wald'][0] === 9.0, 'neun Zahlen gehen durch');
assert(count($ok['groesse']['wald']) === 9, 'und es bleiben neun');
assert(avesmapsEcosystemDisplayValidate(['groesse' => ['wald' => [9, 200]]]) === null, '200 pt nicht');
assert(avesmapsEcosystemDisplayValidate(['groesse' => ['wald' => [1]]]) === null, '1 pt auch nicht');
// 💣 Eine Zeile ist eine LISTE: 0, 1, 2, … ohne Luecke. Ein Objekt {"2": 12} laese der Browser an
// der falschen Zoomstufe -- er zaehlt den INDEX, nicht einen Schluessel.
assert(avesmapsEcosystemDisplayValidate(['groesse' => ['wald' => [2 => 12.0]]]) === null,
    'ein Objekt ist keine Zeile');
assert(avesmapsEcosystemDisplayValidate(['groesse' => ['wald' => array_fill(0, 12, 12.0)]]) === null,
    'mehr als neun Stufen gibt es nicht');

// ---- G. Vorgaben (Band, max. Namen, Prioritaet) ------------------------------------------------
$ok = avesmapsEcosystemDisplayValidate(['vorgabe' => ['wald' => ['ab' => 2, 'bis' => 5, 'curveMax' => 2, 'prio' => 4]]]);
assert($ok['vorgabe']['wald']['ab'] === 2, 'ein Band geht durch');
assert($ok['vorgabe']['wald']['prio'] === 4, 'und die Prioritaet');
// 🔴 „aus" ist als bis < ab kodiert und MUSS durchgehen -- es ist ein gueltiger Zustand, kein
// Fehler (Entwurf §5.3). Ein eigener Schalter daneben waere eine dritte Wahrheit ueber dieselbe Sache.
$aus = avesmapsEcosystemDisplayValidate(['vorgabe' => ['wald' => ['ab' => 0, 'bis' => -1]]]);
assert($aus !== null && $aus['vorgabe']['wald']['bis'] === -1, '„aus" (bis < ab) ist gueltig');
assert(avesmapsEcosystemDisplayValidate(['vorgabe' => ['wald' => ['ab' => 9]]]) === null, 'z9 gibt es nicht');
assert(avesmapsEcosystemDisplayValidate(['vorgabe' => ['wald' => ['ab' => -2]]]) === null, 'z-2 auch nicht');
assert(avesmapsEcosystemDisplayValidate(['vorgabe' => ['wald' => ['prio' => 9]]]) === null, 'Prioritaet 9 nicht');
assert(avesmapsEcosystemDisplayValidate(['vorgabe' => ['wald' => ['curveMax' => 4]]]) === null, 'vier Namen nicht');

// ---- H. Die Kurvenfeinheiten -------------------------------------------------------------------
$ok = avesmapsEcosystemDisplayValidate(['kurve' => ['polyDegree' => 3, 'trackingPct' => 20]]);
assert($ok['kurve']['polyDegree'] === 3.0, 'eine Zahl geht durch');
assert(avesmapsEcosystemDisplayValidate(['kurve' => ['polyDegree' => 'drei']]) === null, 'ein Wort nicht');

// ---- I. Deckel ----------------------------------------------------------------------------------
$riesig = ['farbe' => []];
for ($i = 0; $i < 6000; $i += 1) {
    $riesig['farbe']['a' . $i] = '#ffffff';
}
assert(avesmapsEcosystemDisplayValidate($riesig) === null, 'eine Tafel ueber dem Byte-Deckel faellt raus');

// ---- J. Schreiben, Lesen, Zuruecksetzen ---------------------------------------------------------
$pdo = new AvesmapsEcosystemDisplayTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
avesmapsAppSettingEnsureTable($pdo);

$leer = avesmapsEcosystemDisplayRead($pdo);
assert($leer['display'] === null, 'ohne Zeile gibt es keine Tafel');
assert($leer['stamp'] === '', 'und keinen Stempel');

$tafel = avesmapsEcosystemDisplayValidate(['farbe' => ['wald' => '#123456']]);
assert(avesmapsEcosystemDisplayWrite($pdo, $tafel) === true, 'das Schreiben meldet Erfolg');
$zurueck = avesmapsEcosystemDisplayRead($pdo);
assert($zurueck['display']['farbe']['wald'] === '#123456', 'und der Wert steht wirklich da');
assert($zurueck['stamp'] !== '', 'der Stempel ebenso');

// ⚠️ Unlesbares JSON gilt als „nichts gespeichert", nicht als Fehler: die Karte darf an einem
// kaputten Einstellungswert nicht haengenbleiben.
$pdo->exec("UPDATE app_setting SET setting_value = '{kaputt' WHERE setting_key = 'ecosystem_display'");
assert(avesmapsEcosystemDisplayRead($pdo)['display'] === null, 'kaputtes JSON gilt als nichts');

// 🔴 Zuruecksetzen LOESCHT die Zeile, statt eine Kopie der Vorgabe zu hinterlassen -- die veraltete
// sonst beim naechsten Mal, wenn jemand die Vorgabe im Browser aendert, und niemand merkt es, weil
// in der Datenbank etwas steht.
avesmapsEcosystemDisplayWrite($pdo, $tafel);
avesmapsEcosystemDisplayReset($pdo);
$nachher = avesmapsEcosystemDisplayRead($pdo);
assert($nachher['display'] === null, 'nach dem Zuruecksetzen ist die Zeile weg');
assert($nachher['stamp'] !== '', 'der Stempel bleibt und ist neu');
$zeilen = $pdo->query("SELECT COUNT(*) FROM app_setting WHERE setting_key = 'ecosystem_display'")->fetchColumn();
assert((int) $zeilen === 0, 'die Zeile ist wirklich geloescht, nicht geleert');

// ---- K. 💣 Der Schreiber LIEST ZURUECK ----------------------------------------------------------
// Ein Speichern, das nicht ankommt, meldet das. `setting_value` war einmal VARCHAR(255): MySQL
// schnitt ausserhalb des strikten Modus STILL ab, json_decode lieferte NULL, und der Leser fiel auf
// seine Konstante zurueck -- von „es wurde nie etwas gespeichert" nicht zu unterscheiden.
$eng = new AvesmapsEcosystemDisplayTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
avesmapsAppSettingEnsureTable($eng);
// SQLite kuerzt nicht von selbst -- ein Trigger stellt MySQLs stille Kuerzung nach.
$eng->exec("CREATE TRIGGER kuerzen AFTER INSERT ON app_setting BEGIN
    UPDATE app_setting SET setting_value = substr(NEW.setting_value, 1, 12) WHERE setting_key = NEW.setting_key;
END");
assert(avesmapsEcosystemDisplayWrite($eng, $tafel) === false,
    'eine gekuerzte Ablage meldet FALSE statt stillen Erfolg');

echo "ecosystem-display: alle Zusicherungen gruen\n";
