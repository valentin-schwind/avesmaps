<?php

declare(strict_types=1);

/**
 * Waechter fuer die SELBSTHEILENDEN SPALTEN von `wiki_dump_hybrid_state`.
 *
 * 💣 `CREATE TABLE IF NOT EXISTS` legt keine Spalte nach. Steht die Tabelle schon, tut die
 * Anweisung gar nichts -- und jede Spalte, die spaeter dazukam, fehlt auf jeder Installation, die
 * aelter ist als sie. Am 24.08.2026 hat das den ganzen Dump-Lauf gekostet: `override_deity` war im
 * Code, aber nicht in der Livetabelle, und der Fehler kam als „Internal server error." an.
 *
 * Dieser Test haelt fest, dass die Nachruest-Liste mit der Tabellendefinition Schritt haelt. Er
 * liest QUELLTEXT und faehrt keine Datenbank: `SHOW COLUMNS` ist MySQL-Sprache, und eine
 * SQLite-Fixture wuerde hier entweder luegen oder die Produktion zu sich herunterziehen
 * (AGENTS.md §9, „Ein SQLite-Test kann eine MySQL-Regression ERZWINGEN").
 *
 * Lauf (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/wiki/__tests__/hybrid-state-spalten-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- die Zusicherungen waeren wirkungslos.\n");
    exit(2);
}

$quelle = (string) file_get_contents(__DIR__ . '/../dump-hybrid-state.php');

$geprueft = 0;
$pruefe = static function (bool $bedingung, string $text) use (&$geprueft): void {
    $geprueft++;
    if (!$bedingung) {
        fwrite(STDERR, "ROT: {$text}\n");
        exit(1);
    }
};

// --- Die Spalten aus der CREATE-TABLE-Definition ------------------------------------------------
$anfang = strpos($quelle, 'CREATE TABLE IF NOT EXISTS wiki_dump_hybrid_state');
$pruefe($anfang !== false, 'die Tabellendefinition ist auffindbar');
$ende = strpos($quelle, 'ENGINE=InnoDB', (int) $anfang);
$block = substr($quelle, (int) $anfang, (int) $ende - (int) $anfang);

$definiert = [];
foreach (explode("\n", $block) as $zeile) {
    $zeile = trim($zeile);
    // Kommentarzeilen und Schluesseldefinitionen sind keine Spalten.
    if ($zeile === '' || str_starts_with($zeile, '--') || preg_match('/^(PRIMARY|UNIQUE|KEY|CREATE)/i', $zeile) === 1) {
        continue;
    }
    if (preg_match('/^([a-z_]+)\s+[A-Z]/', $zeile, $treffer) === 1) {
        $definiert[] = $treffer[1];
    }
}
$pruefe(count($definiert) >= 10, 'die Spalten der Definition wurden gelesen (' . count($definiert) . ' gefunden)');
$pruefe(in_array('override_deity', $definiert, true), 'override_deity steht in der Definition');

// --- Die Spalten aus der Nachruest-Liste ---------------------------------------------------------
$listeAnfang = strpos($quelle, '$nachzuruesten = [');
$pruefe($listeAnfang !== false, 'die Nachruest-Liste ist auffindbar');
$listeEnde = strpos($quelle, '];', (int) $listeAnfang);
$listenBlock = substr($quelle, (int) $listeAnfang, (int) $listeEnde - (int) $listeAnfang);
preg_match_all("/'([a-z_]+)'\s*=>/", $listenBlock, $treffer);
$nachgeruestet = $treffer[1];

$pruefe(in_array('override_deity', $nachgeruestet, true), 'override_deity wird nachgeruestet -- der Fall vom 24.08.2026');

// 🔴 DIE ZUSICHERUNG, DIE ZAEHLT: jede Spalte, die nicht seit dem ersten Tag existiert, MUSS in der
// Nachruest-Liste stehen. Wer kuenftig eine Spalte in die Definition schreibt und die Liste
// vergisst, baut denselben Ausfall noch einmal -- und er faellt erst live auf, weil eine frische
// Installation ihn nie sieht.
$vonAnfangAn = ['id', 'run_id', 'normalized_title', 'created_at', 'updated_at'];
$fehlend = array_values(array_diff($definiert, $nachgeruestet, $vonAnfangAn));
$pruefe(
    $fehlend === [],
    'jede spaeter hinzugefuegte Spalte wird auch nachgeruestet -- es fehlen: ' . implode(', ', $fehlend)
);

// ⚠️ Und andersherum: nichts nachruesten, was es in der Definition gar nicht gibt -- das waere ein
// ALTER TABLE ins Leere, das bei jedem Lauf scheitert.
$ueberzaehlig = array_values(array_diff($nachgeruestet, $definiert));
$pruefe($ueberzaehlig === [], 'die Liste ruestet nichts nach, was die Definition nicht kennt: ' . implode(', ', $ueberzaehlig));

// --- Und die Sonde muss vor dem ALTER stehen ----------------------------------------------------
// 💣 MySQL kennt kein `ADD COLUMN IF NOT EXISTS`; ohne die Sonde scheitert der zweite Lauf.
$pruefe(str_contains($quelle, 'SHOW COLUMNS FROM wiki_dump_hybrid_state'), 'es wird gefragt, bevor geaendert wird');
$pruefe(
    strpos($quelle, 'SHOW COLUMNS FROM wiki_dump_hybrid_state') < strpos($quelle, 'ALTER TABLE wiki_dump_hybrid_state'),
    'die Sonde steht VOR dem ALTER -- die Reihenfolge ist die Regel'
);
// 🪤 Geprueft wird die AUSGEFUEHRTE Anweisung, nicht der Dateitext: die Zeichenkette steht auch
// in der Erklaerung darueber, und ein Test, der Kommentare mitliest, meldet seinen eigenen
// Hinweis als Fehler. (Genau das ist beim Schreiben dieses Tests passiert.)
$pruefe(
    preg_match('/exec\([^;]*ADD COLUMN IF NOT EXISTS/', $quelle) !== 1,
    'die ausgefuehrte Anweisung benutzt kein ADD COLUMN IF NOT EXISTS -- das kann MySQL nicht'
);

echo "hybrid-state-spalten-test: {$geprueft} Zusicherungen gruen\n";
